/* ============================================================================
 * Balkan Tycoon — sfx.js
 * Tiny WebAudio synth for UI feedback (no audio assets). Strictly optional:
 * every call is guarded so muted/unsupported browsers just skip it.
 *
 *   BT.sfx.deal()    trade accepted — bright major arpeggio
 *   BT.sfx.receive() incoming trade offer — soft two-tone ping
 *   BT.sfx.card()    event/surprise card flip — quick sweep
 *   BT.sfx.bid()     auction bid tick
 *   BT.sfx.win()     victory fanfare-ish triad
 * ========================================================================== */

"use strict";

(function () {
  let ctx = null;

  function ac() {
    if (ctx === false) return null;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    } catch (e) {
      ctx = false;
      return null;
    }
  }

  /** One enveloped oscillator note. */
  function note(t0, freq, dur, type, vol, glideTo) {
    const c = ac();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  window.BT = Object.assign(window.BT || {}, {
    sfx: {
      deal() {
        const c = ac(); if (!c) return;
        const t = c.currentTime;
        note(t, 523.25, 0.16, "triangle", 0.12);
        note(t + 0.09, 659.25, 0.18, "triangle", 0.11);
        note(t + 0.18, 783.99, 0.26, "triangle", 0.10);
      },
      receive() {
        const c = ac(); if (!c) return;
        const t = c.currentTime;
        note(t, 740, 0.14, "sine", 0.08);
        note(t + 0.11, 988, 0.2, "sine", 0.07);
      },
      card() {
        const c = ac(); if (!c) return;
        note(c.currentTime, 320, 0.22, "triangle", 0.09, 620);
      },
      bid() {
        const c = ac(); if (!c) return;
        note(c.currentTime, 880, 0.07, "square", 0.045);
      },
      win() {
        const c = ac(); if (!c) return;
        const t = c.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(t + i * 0.12, f, 0.3, "triangle", 0.11));
      },
    },
  });
})();
