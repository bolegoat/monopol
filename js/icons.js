/* ============================================================================
 * Balkan Tycoon — icons.js
 * Clean stroke-style SVG icon set (no emojis), player meeple token, and a
 * flag background builder that layers a PNG (public/flags/{id}.png) over an
 * inline-SVG fallback so cards look right before real PNGs are added.
 * ========================================================================== */

"use strict";

(function () {
  const ICONS = {
    dice: '<rect x="3" y="3" width="18" height="18" rx="4.5"/><circle cx="8.4" cy="8.4" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.6" cy="8.4" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="8.4" cy="15.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.6" cy="15.6" r="1.25" fill="currentColor" stroke="none"/>',
    house: '<path d="M3 11.4 12 4l9 7.4"/><path d="M5.5 10.6V20h13v-9.4"/><path d="M10 20v-5h4v5"/>',
    building: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 7.5h2m2 0h2M9 11.5h2m2 0h2M9 15.5h2m2 0h2"/><path d="M10.5 20.5v-2.5h3v2.5"/>',
    exchange: '<path d="M4 7.5h13"/><path d="m13.5 4 3.5 3.5L13.5 11"/><path d="M20 16.5H7"/><path d="m10.5 13-3.5 3.5 3.5 3.5"/>',
    arrowRight: '<path d="M4.5 12h14"/><path d="m13 6.5 5.5 5.5-5.5 5.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.2"/>',
    plane: '<path d="M21.5 3.2 12 12.7"/><path d="M21.5 3.2 15.4 21l-3.4-8.3L3.7 9.3 21.5 3.2z"/>',
    zap: '<path d="M13 2.5 4 13.5h6.5L10 21.5l9-11h-6.5l.5-8z"/>',
    bottle: '<path d="M10 2.5h4"/><path d="M10.5 2.5v3.6L8.2 9.2a5.6 5.6 0 0 0-1.2 3.4v6.9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6.9a5.6 5.6 0 0 0-1.2-3.4l-2.3-3.1V2.5"/><path d="M7.2 14.5h9.6"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.1-2.6 3.6"/><circle cx="12" cy="17.1" r=".6" fill="currentColor" stroke="none"/>',
    sparkles: '<path d="m12 3.5 1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8L12 3.5z"/><path d="m19 15 .9 2.1 2.1.9-2.1.9L19 21l-.9-2.1-2.1-.9 2.1-.9L19 15z"/>',
    shield: '<path d="M12 3 5 5.8v5.1c0 4.7 2.9 8.3 7 9.9 4.1-1.6 7-5.2 7-9.9V5.8L12 3z"/><path d="M9.2 11.8l2 2 3.6-4"/>',
    flag: '<path d="M5.5 21V3.8"/><path d="M5.5 4.6h12l-2.6 3.7 2.6 3.7h-12"/>',
    bars: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M9.3 3.5v17m5.4-17v17M4 9h16M4 15h16"/>',
    coffee: '<path d="M4.5 8.5H16v6.5a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5V8.5z"/><path d="M16 9.5h2.3a2.6 2.6 0 0 1 0 5.2H16"/><path d="M8 3v2.2m4-2.2v2.2"/>',
    alert: '<path d="M12 3.8 2.8 19.4h18.4L12 3.8z"/><path d="M12 9.8v4.4"/><circle cx="12" cy="16.9" r=".65" fill="currentColor" stroke="none"/>',
    crown: '<path d="m3.5 7 4.4 3L12 4l4.1 6 4.4-3-1.6 10.2H5.1L3.5 7z"/><path d="M5.5 20.5h13"/>',
    skull: '<circle cx="12" cy="10" r="6.8"/><path d="M8.4 16v4m7.2-4v4M12 16.8V20"/><circle cx="9.6" cy="9.8" r="1" fill="currentColor" stroke="none"/><circle cx="14.4" cy="9.8" r="1" fill="currentColor" stroke="none"/>',
    banknote: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.2 9.8v.01m11.6 4.4v.01"/>',
    key: '<circle cx="7.8" cy="15.5" r="4"/><path d="m10.8 12.7 9.4-9.4"/><path d="m16 7.5 2.6 2.6M13.4 10.1l2 2"/>',
    repeat: '<path d="m17 2.5 4 4-4 4"/><path d="M3 11.5v-1a4 4 0 0 1 4-4h14"/><path d="m7 21.5-4-4 4-4"/><path d="M21 12.5v1a4 4 0 0 1-4 4H3"/>',
    eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5s1.3-6.1 3.9-8.5z"/>',
    sun: '<circle cx="12" cy="12" r="3.9"/><path d="M12 2.8v2.3m0 13.8v2.3M2.8 12h2.3m13.8 0h2.3M5.2 5.2l1.6 1.6m10.4 10.4 1.6 1.6m0-13.6-1.6 1.6M6.8 17.2l-1.6 1.6"/>',
    phone: '<path d="M5 4h3.6l1.6 4.4-2.1 1.6a12.5 12.5 0 0 0 5.5 5.5l1.6-2.1L19.5 15V18.6A1.9 1.9 0 0 1 17.5 20.5 15.6 15.6 0 0 1 3.5 6.5 1.9 1.9 0 0 1 5 4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
    gift: '<rect x="3.5" y="8" width="17" height="4" rx="0.8"/><path d="M5.2 12v7.5a1.5 1.5 0 0 0 1.5 1.5h10.6a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M12 8v13"/><path d="M12 8s-4.3.3-4.3-2.5C7.7 3.4 10.6 3.6 12 8zM12 8s4.3.3 4.3-2.5C16.3 3.4 13.4 3.6 12 8z"/>',
    star: '<path d="m12 3.4 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.6l5.9-.9L12 3.4z"/>',
    unlock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 7.7-1.5"/><circle cx="12" cy="15.2" r="1" fill="currentColor" stroke="none"/>',
    droplet: '<path d="M12 3.2s6.3 6.9 6.3 11.2a6.3 6.3 0 0 1-12.6 0C5.7 10.1 12 3.2 12 3.2z"/>',
    receipt: '<path d="M5.5 3h13v18l-2.2-1.4-2.1 1.4-2.2-1.4L9.8 21l-2.1-1.4L5.5 21V3z"/><path d="M9 8h6m-6 4h6"/>',
    cornerUpLeft: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9H15a5 5 0 0 1 5 5v6"/>',
    arrowUp: '<path d="M12 20V4.5"/><path d="m6 10.5 6-6 6 6"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    x: '<path d="M5.5 5.5l13 13m0-13-13 13"/>',
    /* Filled building piece, shaped like the moulded Monopoly plastic: gable
     * roof with overhanging eaves. Solid, because the stroke icons above turn
     * to mush at the 8-15px sizes the tile pips and chips render at. Houses and
     * hotels share this one silhouette and differ only in colour and size,
     * exactly like the real green houses and red hotels. */
    houseSolid: '<path fill="currentColor" stroke="none" d="M12 2.4 23.4 11.7h-3.2v9.9H3.8v-9.9H0.6L12 2.4z"/>',
    /* filled player token */
    meeple: '<path fill="currentColor" stroke="none" d="M12 2.1a3.5 3.5 0 0 0-3.5 3.5c0 1 .45 1.95 1.17 2.56C6.05 9.3 4.3 11.4 4.3 13.95h5.25L7.8 21.9h8.4l-1.75-7.95h5.25c0-2.55-1.75-4.65-5.37-5.79A3.49 3.49 0 0 0 12 2.1z"/>',
    /* lobby / cards additions (all emoji-free) */
    rings: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="M12 6.8 10.4 4h3.2L12 6.8z"/>',
    road: '<path d="M7.5 3.5 4 20.5M16.5 3.5 20 20.5"/><path d="M12 4v3m0 3.5v3m0 3.5v3"/>',
    passport: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M12 7v6m-3-3h6M9 17.5h6"/>',
    stamp: '<path d="M7 14.5c0-2.6 1.4-3.4 1.9-5a3.1 3.1 0 1 1 6.2 0c.5 1.6 1.9 2.4 1.9 5z"/><path d="M5 17.5h14M4 20.5h16"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/>',
    users: '<circle cx="9" cy="8.2" r="3.2"/><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M15.5 5.4a3.2 3.2 0 0 1 0 5.7M17.4 14.7c1.9.7 3.1 2.3 3.1 4.8"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    minus: '<path d="M5.5 12h13"/>',
    chevronDown: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3.2v2.3m0 13v2.3M4.8 4.8l1.6 1.6m11.2 11.2 1.6 1.6M3.2 12h2.3m13 0h2.3M4.8 19.2l1.6-1.6M17.6 6.4l1.6-1.6"/>',
    /* audio + presence */
    volume: '<path d="M4 9.5h3l4.5-3.8v12.6L7 14.5H4z"/><path d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path d="M17.8 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    volumeMute: '<path d="M4 9.5h3l4.5-3.8v12.6L7 14.5H4z"/><path d="m15.5 9.8 5 4.4m0-4.4-5 4.4"/>',
    music: '<circle cx="7" cy="17.5" r="2.8"/><circle cx="17.5" cy="15.5" r="2.8"/><path d="M9.8 17.5V6.2l10.5-2.1v11.4"/>',
    plug: '<path d="M9 3.5v5m6-5v5"/><path d="M6.5 8.5h11v2.8a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.8v3.7"/>',
    history: '<path d="M3.6 12a8.4 8.4 0 1 0 2.6-6"/><path d="M3.4 3.6v3h3"/><path d="M12 8v4.3l3 1.8"/>',
    sliders: '<path d="M5 6.5h14M5 12h14M5 17.5h14"/><circle cx="9.5" cy="6.5" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="17.5" r="2" fill="currentColor" stroke="none"/>',
    coins: '<ellipse cx="12" cy="6.6" rx="6.6" ry="2.9"/><path d="M5.4 6.6v4.2c0 1.6 3 2.9 6.6 2.9s6.6-1.3 6.6-2.9V6.6"/><path d="M5.4 10.8V15c0 1.6 3 2.9 6.6 2.9s6.6-1.3 6.6-2.9v-4.2"/>',
    wifiOff: '<path d="m2.5 2.5 19 19"/><path d="M8.4 15.6a5 5 0 0 1 6-.8"/><path d="M5.2 12.1a9.6 9.6 0 0 1 4.1-2.3"/><path d="M2 8.6a14 14 0 0 1 6-3.2"/><path d="M14.3 5.6A14 14 0 0 1 22 8.6"/><path d="M14.9 9.9a9.6 9.6 0 0 1 3.9 2.2"/><circle cx="12" cy="19.2" r=".8" fill="currentColor" stroke="none"/>',
  };

  /** Render an icon by name. */
  function icon(name, cls = "") {
    const body = ICONS[name] || ICONS.help;
    return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
      `aria-hidden="true">${body}</svg>`;
  }

  /* Emoji → icon name (log lines / cards produced by the engine stay
   * emoji-keyed; the UI translates them to clean SVG). */
  const EMOJI_ICONS = {
    "🎲": "dice", "🏁": "flag", "💰": "banknote", "🙅": "ban", "😅": "alert",
    "🏠": "house", "🚨": "alert", "👑": "crown", "🏙️": "building", "🏙": "building",
    "💵": "banknote", "🔑": "key", "🚔": "shield", "⛓️": "bars", "⛓": "bars",
    "🔓": "unlock", "🏚️": "house", "🏚": "house", "🏦": "building", "💀": "skull",
    "🔁": "repeat", "🚧": "alert", "🛃": "shield", "⛽": "droplet", "📞": "phone",
    "🏖️": "sun", "🏖": "sun", "💒": "mail", "✈": "plane", "✈️": "plane",
    "🚀": "arrowUp", "↩️": "cornerUpLeft", "↩": "cornerUpLeft", "🎁": "gift",
    "🎂": "star", "💌": "mail", "🌐": "globe", "☕": "coffee", "👀": "eye",
    "🤝": "exchange", "🚫": "ban", "⏱️": "clock", "⏱": "clock", "🏨": "building",
    "📉": "repeat", "🎉": "sparkles", "✅": "check", "⚠️": "alert", "⚠": "alert",
    "💬": "mail", "🥃": "bottle", "🎡": "sparkles", "❓": "help", "🧿": "eye",
    "🔌": "plug", "📬": "mail", "🔊": "volume", "🔇": "volumeMute", "🎵": "music",
    "🏗️": "building", "🏗": "building", "💸": "coins", "📡": "wifiOff",
  };

  /** Emoji (or name) → SVG, falling back to a neutral dot. */
  function anyIcon(key, cls = "") {
    if (!key) return icon("help", cls);
    if (ICONS[key]) return icon(key, cls);
    if (EMOJI_ICONS[key]) return icon(EMOJI_ICONS[key], cls);
    return icon("help", cls);
  }

  /* Flag backgrounds: real PNG first (public/flags/{id}.png), inline-SVG
   * underneath so it always renders. The PNG layer is only added for countries
   * listed in BT.FLAG_PNGS, so a country that ships SVG-only never fires a
   * request for a file that does not exist.
   * NOTE: single quotes inside url() — this string is embedded in a
   * double-quoted style="" attribute. */
  function flagBg(cid) {
    const BT = window.BT || {};
    const svg = encodeURIComponent((BT.FLAGS && BT.FLAGS[cid]) || "");
    const layers = [];
    if (BT.FLAG_PNGS && BT.FLAG_PNGS.has(cid)) layers.push("url('public/flags/" + cid + ".png')");
    layers.push("url('data:image/svg+xml," + svg + "')");
    const size = layers.map(() => "cover").join(",");
    const pos = layers.map(() => "center").join(",");
    return "background-image:" + layers.join(",") +
      ";background-size:" + size + ";background-position:" + pos + ";";
  }

  window.BT = Object.assign(window.BT || {}, { icon, anyIcon, EMOJI_ICONS, flagBg, ICONS });
})();
