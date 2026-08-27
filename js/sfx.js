/* ============================================================================
 * Balkan Tycoon — sfx.js
 * Procedural WebAudio engine. No audio assets: every sound is synthesised,
 * mixed through a shared bus and tuned to sit together instead of beeping
 * over each other.
 *
 * Signal chain
 * ────────────
 *   voices ──┬─────────────────────────────► busVol ──┐
 *            └─► send ─► convolver (plate) ─► busVol ─┤
 *                                                     │
 *   music bus ────────────────────────────────────────┤
 *                                                     ▼
 *                        master ─► saturator ─► limiter ─► destination
 *
 * The saturator is a soft tanh curve and the limiter a fast compressor, so
 * overlapping hits round off instead of clipping — that is most of what makes
 * a synth kit read as "clean" rather than "harsh".
 *
 * Everything is pitched in A minor pentatonic (see HZ) so unrelated events
 * still sound like they belong to the same game.
 *
 * Public API
 * ──────────
 *   BT.Audio.settings / setMusic(v) / setSfx(v) / setMuted(b) / toggleMute()
 *   BT.Audio.onChange(fn) / unlock() / state
 *
 *   ui         click()  open()  close()
 *   dice       diceShake()  diceLand()
 *   money      coin()  cashIn(mag)  cashOut(mag)  rent()  tax()
 *   property   buy()  build()  hotel()  sell()
 *   trade      receive()  deal()  decline()
 *   turn flow  turn()  warn()  card()  bid()  jail()
 *   presence   offline()  online()
 *   endgame    bankrupt()  win()
 *
 * Autoplay policy: muted on first load, nothing is built until the player
 * unmutes, context resumed on the first real gesture.
 * ========================================================================== */

"use strict";

(function () {
  const STORE_KEY = "bt_audio";
  const DEFAULTS = { music: 0.4, sfx: 0.7, muted: true };

  /* A minor pentatonic — the whole kit is built from these. */
  const HZ = {
    A1: 55, E2: 82.41, A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, G3: 196,
    A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880,
    C6: 1046.5, D6: 1174.66, E6: 1318.51, A6: 1760,
  };

  const settings = load();
  const listeners = new Set();

  let ctx = null;   // AudioContext | false (unsupported)
  let master = null, musicVol = null, sfxVol = null;
  let musicSend = null, sfxSend = null;
  let ambience = null;
  let motifTimer = 0;
  let unlocked = false;

  /* ================= settings ================= */

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!raw || typeof raw !== "object") return { ...DEFAULTS };
      return {
        music: clamp01(Number(raw.music), DEFAULTS.music),
        sfx: clamp01(Number(raw.sfx), DEFAULTS.sfx),
        muted: raw.muted !== false, // anything but an explicit false stays muted
      };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  function clamp01(n, fallback) {
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  }

  /** Perceptual curve — a 50% slider should sound like half volume. */
  const curve = (v) => Math.pow(clamp01(v, 0), 1.7);

  function emit() {
    for (const fn of listeners) {
      try { fn({ ...settings }); } catch (e) { /* a listener must never break audio */ }
    }
  }

  /* ================= graph ================= */

  /** Short plate-ish impulse response, generated once. */
  function impulse(c, seconds, decay) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, decay);
        // one-pole lowpass on the noise keeps the tail warm, not hissy
        lp += 0.32 * ((Math.random() * 2 - 1) - lp);
        data[i] = lp * env;
      }
      // a couple of early reflections give it a room instead of a wash
      for (const [ms, g] of [[11, 0.5], [23, 0.34], [37, 0.22]]) {
        const at = Math.floor((ms / 1000) * c.sampleRate) + ch * 13;
        if (at < len) data[at] += g;
      }
    }
    return buf;
  }

  /** tanh-ish soft clip: rounds transients instead of squaring them off. */
  function satCurve() {
    const n = 1024;
    const c = new Float32Array(n);
    const k = 1.6;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return c;
  }

  /** Lazily build the context + mix buses. Returns the context or null. */
  function ac() {
    if (ctx === false) return null;
    if (ctx) {
      if (ctx.state === "suspended" && unlocked) void ctx.resume();
      return ctx;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error("no WebAudio");
      ctx = new Ctor();

      // master -> saturator -> limiter -> out
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.14;

      const sat = ctx.createWaveShaper();
      sat.curve = satCurve();
      sat.oversample = "2x";

      master = ctx.createGain();
      master.connect(sat).connect(limiter).connect(ctx.destination);

      // per-bus volume, each with its own reverb send
      const makeBus = (sendAmount, verbLen, verbDecay) => {
        const vol = ctx.createGain();
        vol.connect(master);
        const send = ctx.createGain();
        send.gain.value = sendAmount;
        const verb = ctx.createConvolver();
        verb.buffer = impulse(ctx, verbLen, verbDecay);
        send.connect(verb).connect(vol);
        return { vol, send };
      };

      const sfxBus = makeBus(0.16, 0.9, 2.6);
      const musicBus = makeBus(0.5, 2.4, 2.0);
      sfxVol = sfxBus.vol; sfxSend = sfxBus.send;
      musicVol = musicBus.vol; musicSend = musicBus.send;

      applyVolumes(0);
      return ctx;
    } catch (e) {
      ctx = false;
      return null;
    }
  }

  function applyVolumes(ramp = 0.08) {
    if (!ctx || ctx === false) return;
    const t = ctx.currentTime;
    const set = (node, value) => {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(value, t + ramp);
    };
    set(master, settings.muted ? 0 : 0.9);
    set(musicVol, curve(settings.music) * 0.42); // ambience always sits back
    set(sfxVol, curve(settings.sfx) * 0.85);
  }

  /** Audible right now? Returns the context, or null to skip all synthesis. */
  function live() {
    if (settings.muted) return null;
    const c = ac();
    if (!c) return null;
    if (c.state === "suspended") {
      void c.resume();
      if (!unlocked) return null; // gesture still pending
    }
    return c;
  }

  /** Now, with a hair of lead time so scheduled envelopes never clip. */
  const now = () => ctx.currentTime + 0.002;

  /* ================= primitives ================= */

  let noiseBuf = null;
  function noise(c) {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(c.sampleRate * 2);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      lp += 0.04 * (white - lp);      // brown-ish floor
      data[i] = white * 0.6 + lp * 4; // keeps some air without hiss
    }
    return noiseBuf;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  /** ±cents of pitch drift so repeats never sound machine-gunned. */
  const human = (freq, cents = 9) => freq * Math.pow(2, rnd(-cents, cents) / 1200);

  /**
   * One enveloped oscillator voice.
   * @param {object} o
   *   t      start time            freq   base pitch (Hz)
   *   dur    tail length (s)       type   oscillator shape
   *   gain   peak gain             atk    attack (s, default 5ms)
   *   glide  pitch target          detune cents
   *   lp     lowpass cutoff        q      filter Q
   *   pan    -1..1                 send   reverb amount 0..1
   *   bus    override output       hum    humanize cents
   */
  function tone(o) {
    const c = ctx;
    if (!c) return;
    const t = o.t;
    const freq = o.hum === 0 ? o.freq : human(o.freq, o.hum || 6);
    const dur = Math.max(0.02, o.dur);
    const peak = Math.max(0.0004, o.gain == null ? 0.08 : o.gain);
    const atk = o.atk == null ? 0.005 : o.atk;

    const osc = c.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(8, o.glide), t + dur * 0.9);
    if (o.detune) osc.detune.value = o.detune;

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = osc.connect(env);
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lp;
      f.Q.value = o.q == null ? 0.7 : o.q;
      node = env.connect(f);
    }
    out(node, o);
    osc.start(t);
    osc.stop(t + dur + 0.06);
  }

  /** Route a finished voice to its bus (and the reverb send). */
  function out(node, o) {
    const c = ctx;
    let tail = node;
    if (o.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      tail = node.connect(p);
    }
    const bus = o.bus === "music" ? musicVol : sfxVol;
    const send = o.bus === "music" ? musicSend : sfxSend;
    tail.connect(bus);
    if (o.send && send) {
      const s = c.createGain();
      s.gain.value = o.send;
      tail.connect(s).connect(send);
    }
  }

  /** Filtered noise transient: ticks, rattles, drawers, paper. */
  function hit(o) {
    const c = ctx;
    if (!c) return;
    const t = o.t;
    const dur = Math.max(0.01, o.dur);
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    src.playbackRate.value = rnd(0.85, 1.25);

    const f = c.createBiquadFilter();
    f.type = o.filter || "bandpass";
    f.frequency.setValueAtTime(o.freq || 1800, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.sweep), t + dur);
    f.Q.value = o.q == null ? 1.1 : o.q;

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(Math.max(0.0004, o.gain), t + Math.min(0.004, dur * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    out(src.connect(f).connect(env), o);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /**
   * Two-operator FM ping — the metallic core of coins, bells and registers.
   * A short, high modulator index gives the strike, then it decays to a
   * near-pure tone, which is what stops it sounding like a plain beep.
   */
  function ping(o) {
    const c = ctx;
    if (!c) return;
    const t = o.t;
    const freq = human(o.freq, o.hum == null ? 14 : o.hum);
    const dur = Math.max(0.04, o.dur);
    const peak = Math.max(0.0004, o.gain == null ? 0.06 : o.gain);

    const carrier = c.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = freq;

    const mod = c.createOscillator();
    mod.type = "sine";
    mod.frequency.value = freq * (o.ratio || 3.4);

    const modGain = c.createGain();
    modGain.gain.setValueAtTime(freq * (o.index == null ? 2.4 : o.index), t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.04, t + Math.min(0.09, dur * 0.5));
    mod.connect(modGain).connect(carrier.frequency);

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    out(carrier.connect(env), o);
    mod.start(t); mod.stop(t + dur + 0.05);
    carrier.start(t); carrier.stop(t + dur + 0.05);
  }

  /** Wooden knock: pitched thump with a fast downward bend. */
  function knock(o) {
    tone({ ...o, type: "triangle", glide: (o.freq || 160) * 0.55, dur: o.dur || 0.09, atk: 0.002, lp: 900 });
    hit({ ...o, filter: "bandpass", freq: (o.freq || 160) * 7, q: 1.4, dur: 0.035, gain: (o.gain || 0.08) * 0.55 });
  }

  /* ================= ambience ================= */

  function startAmbience() {
    const c = live();
    if (!c || ambience) return;

    const nodes = [];
    const bed = c.createGain();
    bed.gain.value = 0;
    bed.connect(musicVol);
    const bedSend = c.createGain();
    bedSend.gain.value = 0.45;
    bed.connect(bedSend).connect(musicSend);

    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 340;
    lp.Q.value = 0.5;
    lp.connect(bed);

    // drone stack: root, fifth, octave — quiet, wide, slightly detuned
    for (const [freq, type, gain, detune] of [
      [HZ.A1, "sine", 0.5, 0], [HZ.E2, "sine", 0.26, 7],
      [HZ.A2, "triangle", 0.12, -6], [HZ.E3, "triangle", 0.05, 9],
    ]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.value = gain;
      osc.connect(g).connect(lp);
      osc.start();
      nodes.push(osc, g);
    }

    // distant traffic
    const air = c.createBufferSource();
    air.buffer = noise(c);
    air.loop = true;
    const airF = c.createBiquadFilter();
    airF.type = "bandpass";
    airF.frequency.value = 430;
    airF.Q.value = 0.7;
    const airG = c.createGain();
    airG.gain.value = 0.035;
    air.connect(airF).connect(airG).connect(bed);
    air.start();
    nodes.push(air, airF, airG);

    // slow breathing on the cutoff
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    lfo.frequency.value = 0.038;
    lfoG.gain.value = 130;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    nodes.push(lfo, lfoG, lp, bed, bedSend);

    bed.gain.setValueAtTime(0.0001, c.currentTime);
    bed.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 4);

    ambience = {
      stop() {
        const t = c.currentTime;
        bed.gain.cancelScheduledValues(t);
        bed.gain.setValueAtTime(bed.gain.value, t);
        bed.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        setTimeout(() => {
          for (const n of nodes) {
            try { n.stop && n.stop(); } catch (e) { /* already stopped */ }
            try { n.disconnect(); } catch (e) { /* already gone */ }
          }
        }, 1000);
      },
    };

    // sparse pentatonic motif, drenched in the plate so it floats
    const SCALE = [HZ.A3, HZ.C4, HZ.D4, HZ.E4, HZ.G4, HZ.A4];
    clearInterval(motifTimer);
    motifTimer = setInterval(() => {
      if (!ambience || settings.muted || !ctx || ctx.state !== "running") return;
      if (Math.random() < 0.5) return; // leave gaps
      const t = now();
      const root = SCALE[Math.floor(Math.random() * SCALE.length)];
      const pan = rnd(-0.5, 0.5);
      tone({ t, freq: root, dur: 2.6, type: "triangle", gain: 0.05, atk: 0.05, lp: 1400, pan, send: 0.7, bus: "music" });
      if (Math.random() < 0.5) {
        tone({ t: t + 0.42, freq: root * 1.5, dur: 2.2, type: "sine", gain: 0.035, atk: 0.06, pan: -pan, send: 0.8, bus: "music" });
      }
    }, 5600);
  }

  function stopAmbience() {
    clearInterval(motifTimer);
    motifTimer = 0;
    if (!ambience) return;
    ambience.stop();
    ambience = null;
  }

  function syncAmbience() {
    if (settings.muted || settings.music <= 0) stopAmbience();
    else if (unlocked) startAmbience();
  }

  /* ================= unlock ================= */

  function unlock() {
    unlocked = true;
    const c = ac();
    if (c && c.state === "suspended") void c.resume();
    syncAmbience();
  }

  for (const evt of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(evt, () => unlock(), { once: true, passive: true });
  }

  /* ================= settings API ================= */

  const Audio = {
    get settings() { return { ...settings }; },

    setMusic(v) {
      settings.music = clamp01(Number(v), DEFAULTS.music);
      save(); applyVolumes(); syncAmbience(); emit();
    },

    setSfx(v) {
      settings.sfx = clamp01(Number(v), DEFAULTS.sfx);
      save(); applyVolumes(); emit();
    },

    setMuted(muted) {
      settings.muted = Boolean(muted);
      save();
      if (settings.muted) {
        applyVolumes();
        stopAmbience();
      } else {
        unlocked = true; // flipping the switch IS a gesture
        ac();
        applyVolumes();
        syncAmbience();
      }
      emit();
    },

    toggleMute() {
      Audio.setMuted(!settings.muted);
      return settings.muted;
    },

    onChange(fn) {
      if (typeof fn === "function") listeners.add(fn);
      return () => listeners.delete(fn);
    },

    unlock,

    get state() {
      return {
        context: ctx === false ? "unsupported" : ctx ? ctx.state : "not-created",
        unlocked,
        ambience: Boolean(ambience),
        muted: settings.muted,
      };
    },
  };

  /* ================= the kit ================= */

  /* Money magnitude -> how many coins and how loud, so €20 and €2,000 do not
   * sound identical. Returns 0..1. */
  const mag = (amount) => {
    const n = Math.abs(Number(amount) || 0);
    return Math.min(1, Math.log10(1 + n / 25) / 2);
  };

  const sfx = {
    /* ---------- interface ---------- */

    click() {
      const c = live(); if (!c) return;
      const t = now();
      hit({ t, dur: 0.014, gain: 0.035, filter: "bandpass", freq: 2400, q: 1.6 });
      tone({ t, freq: HZ.A5, dur: 0.03, gain: 0.018, type: "sine", atk: 0.001 });
    },

    open() {
      const c = live(); if (!c) return;
      const t = now();
      hit({ t, dur: 0.14, gain: 0.03, filter: "lowpass", freq: 900, sweep: 2600, q: 0.6 });
      tone({ t: t + 0.01, freq: HZ.E4, dur: 0.16, gain: 0.035, type: "sine", atk: 0.008, send: 0.3 });
      tone({ t: t + 0.05, freq: HZ.A4, dur: 0.2, gain: 0.03, type: "sine", atk: 0.01, send: 0.4 });
    },

    close() {
      const c = live(); if (!c) return;
      const t = now();
      hit({ t, dur: 0.1, gain: 0.026, filter: "lowpass", freq: 2200, sweep: 500, q: 0.6 });
      tone({ t, freq: HZ.A3, dur: 0.12, gain: 0.028, type: "sine", glide: HZ.E3 });
    },

    /* ---------- dice ---------- */

    /** Dice rattling in a cupped hand: wooden, not hissy. */
    diceShake() {
      const c = live(); if (!c) return;
      const t = now();
      for (let i = 0; i < 8; i++) {
        const at = t + i * 0.052 + rnd(0, 0.016);
        hit({ t: at, dur: rnd(0.02, 0.038), gain: rnd(0.035, 0.06),
              filter: "bandpass", freq: rnd(700, 1500), q: 2.2, pan: rnd(-0.35, 0.35) });
      }
    },

    /** Dice hitting the felt: two or three wooden knocks plus a table thump. */
    diceLand() {
      const c = live(); if (!c) return;
      const t = now();
      const hits = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < hits; i++) {
        const at = t + i * rnd(0.05, 0.1);
        knock({ t: at, freq: rnd(170, 260), gain: 0.11 - i * 0.02, pan: rnd(-0.4, 0.4), send: 0.12 });
      }
      tone({ t, freq: 74, dur: 0.24, gain: 0.075, type: "sine", glide: 46, atk: 0.004 });
    },

    /* ---------- money ---------- */

    /** A single coin landing. */
    coin() {
      const c = live(); if (!c) return;
      const t = now();
      ping({ t, freq: rnd(1800, 2400), dur: 0.16, gain: 0.05, ratio: 2.7, index: 3, send: 0.35 });
      hit({ t, dur: 0.02, gain: 0.02, filter: "highpass", freq: 4200, q: 0.7 });
    },

    /**
     * Money arriving — a short cascade of coins, scaled by the amount.
     * @param {number} [amount] used to pick coin count + level
     */
    cashIn(amount) {
      const c = live(); if (!c) return;
      const t = now();
      const m = amount == null ? 0.5 : mag(amount);
      const coins = 3 + Math.round(m * 4);
      for (let i = 0; i < coins; i++) {
        ping({
          t: t + i * rnd(0.035, 0.06), freq: rnd(1500, 2600), dur: rnd(0.12, 0.22),
          gain: (0.028 + m * 0.03) * rnd(0.8, 1.1), ratio: 2.7, index: 2.6,
          pan: rnd(-0.4, 0.4), send: 0.4,
        });
      }
      // a warm confirmation under the coins
      tone({ t, freq: HZ.A4, dur: 0.28, gain: 0.03 + m * 0.02, type: "sine", atk: 0.01, send: 0.3 });
      tone({ t: t + 0.09, freq: HZ.C5, dur: 0.3, gain: 0.026 + m * 0.018, type: "sine", atk: 0.012, send: 0.35 });
    },

    /** Money leaving — same coins, falling, with paper underneath. */
    cashOut(amount) {
      const c = live(); if (!c) return;
      const t = now();
      const m = amount == null ? 0.5 : mag(amount);
      hit({ t, dur: 0.2, gain: 0.03 + m * 0.02, filter: "bandpass", freq: 1700, sweep: 420, q: 0.9 });
      const coins = 2 + Math.round(m * 3);
      for (let i = 0; i < coins; i++) {
        ping({
          t: t + i * rnd(0.04, 0.07), freq: rnd(900, 1500) * Math.pow(0.86, i), dur: rnd(0.1, 0.18),
          gain: (0.024 + m * 0.022) * rnd(0.8, 1.05), ratio: 2.4, index: 2.2,
          pan: rnd(-0.35, 0.35), send: 0.35,
        });
      }
      tone({ t, freq: HZ.A3, dur: 0.3, gain: 0.028 + m * 0.016, type: "sine", glide: HZ.E3, atk: 0.008, send: 0.3 });
    },

    /** Rent paid to another player: coins out plus a heavier landing. */
    rent(amount) {
      const c = live(); if (!c) return;
      sfx.cashOut(amount);
      const t = now();
      knock({ t: t + 0.14, freq: 120, gain: 0.07, send: 0.2 });
    },

    /** Tax / fine to the bank: officious stamp. */
    tax(amount) {
      const c = live(); if (!c) return;
      const t = now();
      knock({ t, freq: 150, gain: 0.1, dur: 0.1, send: 0.18 });      // stamp
      hit({ t: t + 0.005, dur: 0.05, gain: 0.05, filter: "bandpass", freq: 900, q: 1.1 });
      tone({ t: t + 0.06, freq: HZ.D4, dur: 0.24, gain: 0.03, type: "triangle", glide: HZ.A3, lp: 2200, send: 0.25 });
      if (amount != null) sfx.cashOut(amount * 0.6);
    },

    /* ---------- property ---------- */

    /** Bought: register bell, drawer, then the deed stamped. */
    buy() {
      const c = live(); if (!c) return;
      const t = now();
      ping({ t, freq: HZ.E6, dur: 0.24, gain: 0.055, ratio: 2.1, index: 2.2, send: 0.4 });
      ping({ t: t + 0.015, freq: HZ.A6, dur: 0.18, gain: 0.032, ratio: 2.1, index: 1.8, send: 0.45 });
      hit({ t: t + 0.1, dur: 0.16, gain: 0.045, filter: "bandpass", freq: 2200, sweep: 700, q: 0.9 });
      tone({ t: t + 0.16, freq: HZ.A4, dur: 0.22, gain: 0.05, type: "triangle", lp: 2600, send: 0.3 });
      tone({ t: t + 0.26, freq: HZ.E5, dur: 0.34, gain: 0.045, type: "triangle", lp: 3000, send: 0.4 });
      knock({ t: t + 0.3, freq: 110, gain: 0.075, send: 0.2 });
    },

    /** House raised: two hammer taps and a beam settling. */
    build() {
      const c = live(); if (!c) return;
      const t = now();
      knock({ t, freq: 320, gain: 0.09, dur: 0.07, pan: -0.15 });
      knock({ t: t + 0.11, freq: 300, gain: 0.075, dur: 0.07, pan: 0.15 });
      tone({ t: t + 0.16, freq: HZ.G4, dur: 0.24, gain: 0.045, type: "triangle", lp: 2400, send: 0.3 });
      tone({ t: t + 0.16, freq: HZ.D4, dur: 0.26, gain: 0.03, type: "sine", send: 0.3 });
    },

    /** Hotel: the same idea, bigger and lower. */
    hotel() {
      const c = live(); if (!c) return;
      const t = now();
      knock({ t, freq: 240, gain: 0.1, dur: 0.09 });
      [HZ.A3, HZ.E4, HZ.A4, HZ.C5].forEach((f, i) => {
        tone({ t: t + 0.06 + i * 0.055, freq: f, dur: 0.42, gain: 0.045, type: "triangle", lp: 2600, send: 0.45 });
      });
      tone({ t, freq: 60, dur: 0.4, gain: 0.06, type: "sine", glide: 44 });
    },

    /** Sold back: a small reverse of build. */
    sell() {
      const c = live(); if (!c) return;
      const t = now();
      hit({ t, dur: 0.14, gain: 0.035, filter: "bandpass", freq: 1500, sweep: 500, q: 0.9 });
      tone({ t, freq: HZ.G4, dur: 0.2, gain: 0.035, type: "triangle", glide: HZ.D4, lp: 2200 });
    },

    /* ---------- trading ---------- */

    /** Incoming offer: two-note pluck, unmistakable but polite. */
    receive() {
      const c = live(); if (!c) return;
      const t = now();
      ping({ t, freq: HZ.E5, dur: 0.2, gain: 0.05, ratio: 2, index: 1.6, send: 0.4 });
      ping({ t: t + 0.12, freq: HZ.A5, dur: 0.3, gain: 0.042, ratio: 2, index: 1.4, send: 0.5 });
    },

    /** Accepted: rising pentatonic run with a handshake thump. */
    deal() {
      const c = live(); if (!c) return;
      const t = now();
      [HZ.A4, HZ.C5, HZ.E5, HZ.A5].forEach((f, i) => {
        tone({ t: t + i * 0.075, freq: f, dur: 0.34, gain: 0.055, type: "triangle", lp: 3200, send: 0.4, pan: -0.2 + i * 0.13 });
      });
      knock({ t, freq: 130, gain: 0.055 });
    },

    /** Declined: soft muted fall, no buzzer. */
    decline() {
      const c = live(); if (!c) return;
      const t = now();
      tone({ t, freq: HZ.D4, dur: 0.18, gain: 0.05, type: "sine", glide: HZ.C4, lp: 1400 });
      tone({ t: t + 0.12, freq: HZ.A3, dur: 0.3, gain: 0.042, type: "sine", glide: 190, lp: 1200, send: 0.25 });
    },

    /* ---------- turn flow ---------- */

    /** Your turn: warm marimba double-note. */
    turn() {
      const c = live(); if (!c) return;
      const t = now();
      tone({ t, freq: HZ.A4, dur: 0.3, gain: 0.05, type: "triangle", lp: 2200, atk: 0.006, send: 0.35 });
      tone({ t, freq: HZ.A5, dur: 0.16, gain: 0.018, type: "sine", atk: 0.004 });
      tone({ t: t + 0.13, freq: HZ.E5, dur: 0.4, gain: 0.042, type: "triangle", lp: 2600, atk: 0.006, send: 0.45 });
    },

    /** Clock running down: two dry ticks, deliberately unmusical-quiet. */
    warn() {
      const c = live(); if (!c) return;
      const t = now();
      for (let i = 0; i < 2; i++) {
        hit({ t: t + i * 0.16, dur: 0.02, gain: 0.03, filter: "bandpass", freq: 1900, q: 3 });
        tone({ t: t + i * 0.16, freq: HZ.E4, dur: 0.05, gain: 0.022, type: "sine", atk: 0.001 });
      }
    },

    /** Card drawn: paper slide plus a light chime. */
    card() {
      const c = live(); if (!c) return;
      const t = now();
      hit({ t, dur: 0.22, gain: 0.04, filter: "bandpass", freq: 900, sweep: 3200, q: 0.5 });
      ping({ t: t + 0.1, freq: HZ.D6, dur: 0.3, gain: 0.032, ratio: 2.4, index: 1.6, send: 0.55 });
    },

    bid() {
      const c = live(); if (!c) return;
      const t = now();
      ping({ t, freq: HZ.A5, dur: 0.08, gain: 0.035, ratio: 2, index: 1.2 });
    },

    /** Cell door: metal clang, no music. */
    jail() {
      const c = live(); if (!c) return;
      const t = now();
      hit({ t, dur: 0.1, gain: 0.07, filter: "bandpass", freq: 1400, q: 1.2 });
      ping({ t, freq: 420, dur: 0.5, gain: 0.055, ratio: 1.41, index: 4, send: 0.5 });
      ping({ t: t + 0.02, freq: 610, dur: 0.4, gain: 0.035, ratio: 1.73, index: 3.4, send: 0.5 });
      tone({ t, freq: 90, dur: 0.3, gain: 0.06, type: "sine", glide: 58 });
    },

    /* ---------- presence ---------- */

    offline() {
      const c = live(); if (!c) return;
      const t = now();
      tone({ t, freq: HZ.A4, dur: 0.2, gain: 0.04, type: "sine", glide: HZ.E4, lp: 1600 });
      tone({ t: t + 0.15, freq: HZ.D4, dur: 0.34, gain: 0.034, type: "sine", glide: HZ.A3, lp: 1400, send: 0.3 });
    },

    online() {
      const c = live(); if (!c) return;
      const t = now();
      tone({ t, freq: HZ.D5, dur: 0.14, gain: 0.038, type: "sine" });
      tone({ t: t + 0.1, freq: HZ.A5, dur: 0.28, gain: 0.04, type: "triangle", lp: 3000, send: 0.4 });
    },

    /* ---------- endgame ---------- */

    bankrupt() {
      const c = live(); if (!c) return;
      const t = now();
      [HZ.A4, HZ.G4, HZ.E4, HZ.C4, HZ.A3].forEach((f, i) => {
        tone({ t: t + i * 0.1, freq: f, dur: 0.5, gain: 0.05, type: "triangle", lp: 1600, send: 0.5 });
      });
      tone({ t: t + 0.42, freq: 55, dur: 1.1, gain: 0.07, type: "sine", glide: 40, send: 0.4 });
    },

    win() {
      const c = live(); if (!c) return;
      const t = now();
      [HZ.A4, HZ.C5, HZ.E5, HZ.A5, HZ.C6].forEach((f, i) => {
        tone({ t: t + i * 0.1, freq: f, dur: 0.55, gain: 0.06, type: "triangle", lp: 3400, send: 0.5, pan: -0.3 + i * 0.15 });
      });
      for (let i = 0; i < 6; i++) {
        ping({ t: t + 0.5 + i * 0.05, freq: rnd(1600, 2800), dur: 0.4, gain: 0.03, ratio: 2.7, index: 2.4, pan: rnd(-0.6, 0.6), send: 0.6 });
      }
      tone({ t: t + 0.5, freq: HZ.A2, dur: 1.4, gain: 0.05, type: "sine", send: 0.5 });
    },
  };

  window.BT = Object.assign(window.BT || {}, { sfx, Audio });
})();
