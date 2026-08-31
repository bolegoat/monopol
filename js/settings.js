/* ============================================================================
 * Balkan Tycoon — settings.js
 * Sound panel: mute-all toggle plus the effects volume slider. State lives in
 * BT.Audio (persisted to localStorage); this module is purely the DOM binding,
 * and it keeps the top-bar speaker button in sync with the current level.
 * There is no music control because there is no music — see js/sfx.js.
 * ========================================================================== */

"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);
  const Audio = window.BT && window.BT.Audio;
  if (!Audio) return; // sfx.js failed to load — skip silently

  const els = {
    btn: $("#btn-audio"),
    btnIc: $("#audio-btn-ic"),
    modal: $("#modal-audio"),
    mute: $("#audio-mute"),
    sfx: $("#audio-sfx"),
    sfxVal: $("#audio-sfx-val"),
    test: $("#btn-audio-test"),
    close: $("#btn-audio-close"),
  };
  if (!els.btn || !els.modal) return;

  const pct = (v) => Math.round(v * 100) + "%";

  /** Reflect BT.Audio state onto every control. */
  function render(s) {
    els.mute.checked = s.muted;
    els.sfx.value = String(Math.round(s.sfx * 100));
    els.sfxVal.textContent = pct(s.sfx);
    els.sfx.disabled = s.muted;
    els.modal.querySelectorAll(".audio-row").forEach((row) => row.classList.toggle("is-off", s.muted));

    const silent = s.muted || s.sfx <= 0;
    els.btnIc.innerHTML = window.BT.icon(silent ? "volumeMute" : "volume", "icon-btn__svg");
    els.btn.classList.toggle("is-muted", silent);
    els.btn.title = silent ? "Sound muted — click to open sound settings" : "Sound settings";
  }

  Audio.onChange(render);

  /* ---------- controls ---------- */

  els.mute.addEventListener("change", () => Audio.setMuted(els.mute.checked));

  els.sfx.addEventListener("input", () => {
    els.sfxVal.textContent = pct(Number(els.sfx.value) / 100);
    Audio.setSfx(Number(els.sfx.value) / 100);
  });

  els.test.addEventListener("click", () => {
    if (els.mute.checked) Audio.setMuted(false); // testing implies you want sound
    window.BT.sfx.deal();
    setTimeout(() => window.BT.sfx.diceLand(), 380);
  });

  /* ---------- open / close ---------- */

  const open = () => {
    render(Audio.settings);
    els.modal.hidden = false;
  };
  const close = () => { els.modal.hidden = true; };

  els.btn.addEventListener("click", open);
  els.close.addEventListener("click", close);
  els.modal.addEventListener("click", (e) => { if (e.target === els.modal) close(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.modal.hidden) close();
    // M toggles mute from anywhere except while typing in a field. activeElement
    // can legitimately be null (right after a focused node is removed), and
    // reading .tagName off it used to throw and swallow the whole handler.
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if ((e.key === "m" || e.key === "M") && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
      Audio.toggleMute();
    }
  });

  render(Audio.settings);
})();
