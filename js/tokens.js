/* ============================================================================
 * Balkan Tycoon — tokens.js
 * Procedural minimalist SVG player tokens: rounded character discs with 8
 * distinct high-contrast stylized eye faces. STRICTLY no emojis / unicode
 * pictographs — every token is generated vector markup.
 *
 *   BT.PLAYER_COLORS   8 fixed slot colors (locked per lobby seat)
 *   BT.TOKEN_STYLES    face style ids
 *   BT.Tokens.face(i)      eyes/mouth group only (for board pawns)
 *   BT.Tokens.badge(color, i, cls)  full disc badge markup
 * ========================================================================== */

"use strict";

(function () {
  /* ---------- the 8 lobby colors (spec palette) ---------- */
  const PLAYER_COLORS = [
    { id: "crimson", name: "Crimson Red", hex: "#EF4444" },
    { id: "cyan", name: "Electric Cyan", hex: "#06B6D4" },
    { id: "emerald", name: "Emerald Green", hex: "#10B981" },
    { id: "amber", name: "Amber Gold", hex: "#F59E0B" },
    { id: "violet", name: "Royal Purple", hex: "#8B5CF6" },
    { id: "pink", name: "Hot Pink", hex: "#EC4899" },
    { id: "orange", name: "Neon Orange", hex: "#F97316" },
    { id: "cobalt", name: "Cobalt Blue", hex: "#3B82F6" },
  ];

  const STYLES = ["focused", "shades", "squint", "wink", "sleepy", "determined", "visor", "cheeky"];

  const INK = "#10151d"; // pupil / glasses ink on white eyes
  const EYE = "#ffffff"; // sclera / line work

  /* Face groups are drawn on a 44x44 viewBox, disc centre at 22,22.
   * Only the features — the disc itself is drawn by badge()/pawn CSS. */
  function faceSVG(styleIndex) {
    const s = ((Number(styleIndex) || 0) % STYLES.length + STYLES.length) % STYLES.length;
    let g = "";
    switch (STYLES[s]) {
      case "shades": // shady sunglasses
        g =
          '<rect x="9" y="17" width="26" height="8.6" rx="4.2" fill="' + INK + '"/>' +
          '<path d="M13 19.4h5.5M25.5 19.4H31" stroke="rgba(255,255,255,.55)" stroke-width="1.7" stroke-linecap="round"/>' +
          '<path d="M9.2 19.5c-1 .8-1.4 1.8-1.3 3M34.8 19.5c1 .8 1.4 1.8 1.3 3" stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
          '<path d="M17 30.5q5 3.2 10 0" stroke="' + EYE + '" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
        break;
      case "squint": // retro happy squint
        g =
          '<path d="M11.5 21.5q4.5-6.5 9.5-.5" stroke="' + EYE + '" stroke-width="3" stroke-linecap="round" fill="none"/>' +
          '<path d="M23 21q5-6 9.5.5" stroke="' + EYE + '" stroke-width="3" stroke-linecap="round" fill="none"/>' +
          '<path d="M16.5 29.5q5.5 4.5 11 0" stroke="' + EYE + '" stroke-width="2.6" stroke-linecap="round" fill="none"/>';
        break;
      case "wink":
        g =
          '<circle cx="16" cy="20.5" r="4.6" fill="' + EYE + '"/><circle cx="17.4" cy="21.4" r="2.2" fill="' + INK + '"/>' +
          '<circle cx="16.9" cy="19.6" r=".8" fill="' + EYE + '"/>' +
          '<path d="M24 20.5q4.5-4.5 8 0" stroke="' + EYE + '" stroke-width="2.8" stroke-linecap="round" fill="none"/>' +
          '<path d="M17.5 30q4.5 2.6 9-.5" stroke="' + EYE + '" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
        break;
      case "sleepy": // half-lidded
        g =
          '<path d="M11.5 20h9" stroke="' + EYE + '" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M23.5 20h9" stroke="' + EYE + '" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M12.5 24.5q3.5 2.6 7 0M24.5 24.5q3.5 2.6 7 0" stroke="' + EYE + '" stroke-width="2" stroke-linecap="round" fill="none"/>' +
          '<ellipse cx="22" cy="31.5" rx="2.6" ry="1.9" fill="' + EYE + '" opacity=".85"/>';
        break;
      case "determined": // angled brows over focused eyes
        g =
          '<path d="M11 14.5l8.5 2.6M33 14.5l-8.5 2.6" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
          '<circle cx="15.8" cy="21.8" r="4.2" fill="' + EYE + '"/><circle cx="28.2" cy="21.8" r="4.2" fill="' + EYE + '"/>' +
          '<circle cx="16.8" cy="22.6" r="2" fill="' + INK + '"/><circle cx="27.2" cy="22.6" r="2" fill="' + INK + '"/>' +
          '<path d="M18 30.8h8" stroke="' + EYE + '" stroke-width="2.4" stroke-linecap="round"/>';
        break;
      case "visor": // cyber visor band
        g =
          '<rect x="8.5" y="16.5" width="27" height="9" rx="4.5" fill="' + INK + '"/>' +
          '<rect x="10.5" y="18.4" width="23" height="2.6" rx="1.3" fill="#06b6d4" opacity=".85"/>' +
          '<rect x="10.5" y="22.4" width="14" height="1.6" rx=".8" fill="rgba(255,255,255,.35)"/>' +
          '<path d="M17.5 30.5q4.5 2.4 9 0" stroke="' + EYE + '" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
        break;
      case "cheeky": // raised brow + smirk
        g =
          '<path d="M11.5 14.8q4-1.8 8 .4" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
          '<circle cx="15.8" cy="21" r="4.2" fill="' + EYE + '"/><circle cx="28.2" cy="21" r="4.2" fill="' + EYE + '"/>' +
          '<circle cx="14.9" cy="20.2" r="1.9" fill="' + INK + '"/><circle cx="29.1" cy="20.2" r="1.9" fill="' + INK + '"/>' +
          '<path d="M17 29.5q5.5 3.6 10.5-.8" stroke="' + EYE + '" stroke-width="2.5" stroke-linecap="round" fill="none"/>';
        break;
      default: // focused gamer eyes
        g =
          '<circle cx="15.8" cy="20.6" r="4.7" fill="' + EYE + '"/><circle cx="28.2" cy="20.6" r="4.7" fill="' + EYE + '"/>' +
          '<circle cx="17.2" cy="21.6" r="2.3" fill="' + INK + '"/><circle cx="26.8" cy="21.6" r="2.3" fill="' + INK + '"/>' +
          '<circle cx="16.4" cy="19.4" r=".9" fill="' + EYE + '"/><circle cx="27.6" cy="19.4" r=".9" fill="' + EYE + '"/>' +
          '<path d="M18 30.2q4 2.2 8 0" stroke="' + EYE + '" stroke-width="2.3" stroke-linecap="round" fill="none"/>';
    }
    return '<svg class="tokface" viewBox="0 0 44 44" aria-hidden="true"><g>' + g + "</g></svg>";
  }

  /** Full 36px-style disc badge with glowing color ring. */
  function badge(colorHex, styleIndex, cls = "") {
    const c = /^#[0-9a-f]{3,8}$/i.test(String(colorHex)) ? colorHex : "#EF4444";
    return (
      '<span class="ptoken' + (cls ? " " + cls : "") + '" style="--pc:' + c + '">' +
      '<svg viewBox="0 0 44 44" aria-hidden="true">' +
      '<circle cx="22" cy="22" r="21" fill="' + c + '"/>' +
      '<ellipse cx="15" cy="11.5" rx="12" ry="6.5" fill="#ffffff" opacity=".16"/>' +
      '<path d="M4.5 28a18.5 18.5 0 0 0 35 0" fill="rgba(0,0,0,.14)"/>' +
      '<circle cx="22" cy="22" r="20" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.6"/>' +
      faceSVG(styleIndex).replace(/^<svg[^>]*>|<\/svg>$/g, "") +
      "</svg></span>"
    );
  }

  /** Deterministic fallback style from a name/id string. */
  function hashStyle(seedStr) {
    let h = 0;
    for (const ch of String(seedStr || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % STYLES.length;
  }

  window.BT = Object.assign(window.BT || {}, {
    PLAYER_COLORS,
    TOKEN_STYLES: STYLES,
    Tokens: { face: faceSVG, badge, hashStyle, styleName: (i) => STYLES[((i % STYLES.length) + STYLES.length) % STYLES.length] },
  });
})();
