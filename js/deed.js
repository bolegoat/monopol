/* ============================================================================
 * Balkan Tycoon — deed.js
 * Directional hover tooltip: a clean Balkan property deed card that follows
 * the pointer across any property tile and always opens toward the board:
 *   bottom edge tiles -> opens UP, top edge -> DOWN,
 *   left edge -> RIGHT, right edge -> LEFT.
 * Positioning is viewport-aware (clamped on-screen after measurement).
 * Strictly no emoji characters: typography, SVG icons and CSS badges only.
 * ========================================================================== */

"use strict";

(function () {
  const GAP = 10;  // px between the tile and the deed card
  const EDGE = 8;  // minimum distance to the viewport edge

  let tip = null;
  let curTileEl = null;

  const EURO = "\u20ac";
  const DOT = "\u00b7";
  const euro = (n) => EURO + n;

  /* ---------- helpers ---------- */

  function icon(name, cls) {
    return window.BT.icon(name, cls || "ic-deed");
  }

  /** Player token face SVG (falls back to the meeple glyph). */
  function face(p) {
    if (window.BT.Tokens) {
      return window.BT.Tokens.face(
        Number.isFinite(p.tokenStyle) ? p.tokenStyle : window.BT.Tokens.hashStyle(p.name),
      ).replace('class="tokface"', 'class="ic-deed"');
    }
    return icon("meeple", "ic-deed");
  }

  function activeGame() {
    return (window.BT.mp && window.BT.mp.game) || window.BT.game || null;
  }

  /** Which engine build-level a row key corresponds to (for highlighting). */
  function liveLevel(g, tile) {
    const ps = g.props[tile.id];
    if (!ps || !ps.owner) return null;
    if (ps.houses >= 4) return "hotel";
    if (ps.houses > 0) return "h" + ps.houses;
    return g.ownsGroup(g.player(ps.owner), tile.country) ? "mono" : "base";
  }

  const LEVEL_TEXT = {
    base: "Base rent", mono: "Full country set",
    h1: "1 house", h2: "2 houses", h3: "3 houses", hotel: "a hotel",
  };

  /* ---------- deed card builders (emoji-free by design) ---------- */

  function head(bannerColor, badgeStyle, iconName, name, subline, price) {
    return (
      '<i class="deed__banner" style="background:' + bannerColor + '"></i>' +
      '<header class="deed__head">' +
        '<span class="deed__badge"' + (badgeStyle ? ' style="' + badgeStyle + '"' : "") + ">" +
          (iconName ? icon(iconName, "ic-deed ic-deed--fig") : "") + "</span>" +
        '<span class="deed__titles">' +
          "<strong>" + name + "</strong>" +
          "<em>" + subline + "</em>" +
        "</span>" +
        '<span class="deed__price">' + euro(price) + "</span>" +
      "</header>"
    );
  }

  function rentRow(label, value, key, liveKey) {
    return (
      '<div class="deed__row' + (key === liveKey ? " is-live" : "") + '">' +
        "<span>" + label + "</span><b>" + euro(value) + "</b>" +
      "</div>"
    );
  }

  function costRow(iconName, label, value) {
    return (
      '<span class="deed__cost">' + icon(iconName) + label +
      " <b>" + value + "</b></span>"
    );
  }

  function cityDeed(tile) {
    const c = COUNTRIES[tile.country];
    const b = tile.baseRent;
    const hc = tile.houseCost;
    const g = activeGame();
    const lv = g ? liveLevel(g, tile) : null;

    let html =
      head(c.color, window.BT.flagBg(tile.country), null,
        tile.name, c.name + " " + DOT + " Group " + c.short, tile.price);

    html += '<div class="deed__table">' +
      rentRow("Base Rent", b, "base", lv) +
      rentRow("Full Country Set", b * ECONOMY.monopolyMultiplier, "mono", lv) +
      rentRow("With 1 House", b * ECONOMY.houseMultipliers[1], "h1", lv) +
      rentRow("With 2 Houses", b * ECONOMY.houseMultipliers[2], "h2", lv) +
      rentRow("With 3 Houses", b * ECONOMY.houseMultipliers[3], "h3", lv) +
      rentRow("With Hotel / Kafana", b * ECONOMY.houseMultipliers[4], "hotel", lv) +
      "</div>";

    html += '<div class="deed__costs">' +
      costRow("house", "House", euro(hc) + " each") +
      costRow("building", "Hotel", euro(hc) + " + 4 houses") +
      costRow("banknote", "Mortgage", euro(Math.round(tile.price / 2))) +
      "</div>";

    if (g && lv) {
      const p = g.player(g.props[tile.id].owner);
      html +=
        '<div class="deed__live">' +
          '<span class="deed__token" style="background:' + p.color + '">' + face(p) + "</span>" +
          "Owned by <strong>" + p.name + "</strong>" + DOT + " currently " +
          LEVEL_TEXT[lv] +
        "</div>";
    }
    return html;
  }

  function airportDeed(tile) {
    const g = activeGame();
    const ps = g && g.props[tile.id];
    const count = ps && ps.owner
      ? TILES.filter((t) => t.kind === "airport" && g.props[t.id].owner === ps.owner).length
      : 0;
    const lv = count ? "a" + Math.min(count, 4) : null;

    let html =
      head("#4f7d99", "background:linear-gradient(150deg,#2c4a60,#1b2f40)", "plane",
        tile.name, "Balkan Air " + DOT + " Transport group", tile.price);

    html += '<div class="deed__table">' +
      rentRow("With 1 Airport", ECONOMY.airportRent[0], "a1", lv) +
      rentRow("With 2 Airports", ECONOMY.airportRent[1], "a2", lv) +
      rentRow("With 3 Airports", ECONOMY.airportRent[2], "a3", lv) +
      rentRow("With 4 Airports", ECONOMY.airportRent[3], "a4", lv) +
      "</div>";

    html += '<div class="deed__costs">' +
      costRow("plane", "Rent", "doubles per airport owned") +
      costRow("banknote", "Mortgage", euro(Math.round(tile.price / 2))) +
      "</div>";

    if (g && lv) {
      const p = g.player(ps.owner);
      html +=
        '<div class="deed__live">' +
          '<span class="deed__token" style="background:' + p.color + '">' + face(p) + "</span>" +
          "Owned by <strong>" + p.name + "</strong>" + DOT + " currently " +
          count + " airport" + (count > 1 ? "s" : "") +
        "</div>";
    }
    return html;
  }

  function utilityDeed(tile) {
    const g = activeGame();
    const ps = g && g.props[tile.id];
    const both = ps && ps.owner
      ? TILES.filter((t) => t.kind === "utility" && g.props[t.id].owner === ps.owner).length === 2
      : false;

    const oneKey = ps && ps.owner && !both ? "u1" : null;

    let html =
      head("#8f8a3f", "background:linear-gradient(150deg,#4a4a24,#2e2e16)",
        tile.id === "balkan-electric" ? "zap" : "bottle",
        tile.name, "Utility " + DOT + " Services group", tile.price);

    html += '<div class="deed__table">' +
      rentRow("One Utility Owned", 28, "u1", oneKey) +
      rentRow("Both Utilities Owned", 70, "u2", both ? "u2" : null) +
      "</div>";

    html += '<p class="deed__note">Rent is ' +
      "<b>4" + "\u00d7" + "</b> the dice total, or <b>10" + "\u00d7" +
      "</b> when both utilities are owned. Shown at a roll of 7.</p>";

    html += '<div class="deed__costs">' +
      costRow("zap", "Rent", "dice multiplier") +
      costRow("banknote", "Mortgage", euro(Math.round(tile.price / 2))) +
      "</div>";

    if (g && ps && ps.owner) {
      const p = g.player(ps.owner);
      html +=
        '<div class="deed__live">' +
          '<span class="deed__token" style="background:' + p.color + '">' + face(p) + "</span>" +
          "Owned by <strong>" + p.name + "</strong>" + DOT + " currently " +
          (both ? "both utilities" : "one utility") +
        "</div>";
    }
    return html;
  }

  function contentFor(tile) {
    if (tile.kind === "city") return cityDeed(tile);
    if (tile.kind === "airport") return airportDeed(tile);
    return utilityDeed(tile);
  }

  /* ---------- directional placement ---------- */

  function placeFor(el) {
    const side = window.BT.tileSide(Number(el.dataset.pos)); // bottom/left/top/right
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;

    let x, y;
    if (side === "bottom") {        // bottom edge: open UP above the tile
      x = r.left + r.width / 2 - w / 2;
      y = r.top - h - GAP;
    } else if (side === "top") {    // top edge: open DOWN below the tile
      x = r.left + r.width / 2 - w / 2;
      y = r.bottom + GAP;
    } else if (side === "left") {   // left edge: open RIGHT into the board
      x = r.right + GAP;
      y = r.top + r.height / 2 - h / 2;
    } else {                        // right edge: open LEFT into the board
      x = r.left - w - GAP;
      y = r.top + r.height / 2 - h / 2;
    }

    // viewport-aware clamp: never spill off-screen, whatever the window does
    x = Math.min(Math.max(x, EDGE), window.innerWidth - w - EDGE);
    y = Math.min(Math.max(y, EDGE), window.innerHeight - h - EDGE);

    tip.style.left = Math.round(x) + "px";
    tip.style.top = Math.round(y) + "px";

    // entry animation slides in from the opening direction
    tip.classList.remove("deed--up", "deed--down", "deed--left", "deed--right", "anim");
    tip.classList.add(
      side === "bottom" ? "deed--up"
        : side === "top" ? "deed--down"
        : side === "left" ? "deed--right" : "deed--left",
    );
    void tip.offsetWidth; // restart the CSS animation
    tip.classList.add("anim");
  }

  /* ---------- wiring ---------- */

  function isPropertyTile(el) {
    const idx = Number(el.dataset.pos);
    const tile = TILES[idx];
    return Boolean(tile && (tile.kind === "city" || tile.kind === "airport" || tile.kind === "utility"));
  }

  function hide() {
    curTileEl = null;
    if (tip) tip.hidden = true;
  }

  function onMouseMove(e) {
    const el = e.target && e.target.closest ? e.target.closest(".tile") : null;
    const target = el && isPropertyTile(el) ? el : null;
    if (target === curTileEl) return;
    curTileEl = target;
    if (!target) { hide(); return; }

    const tile = TILES[Number(target.dataset.pos)];
    target.removeAttribute("title"); // the deed replaces the native tooltip
    tip.innerHTML = contentFor(tile);
    tip.hidden = false;
    placeFor(target);
  }

  function init() {
    tip = document.createElement("div");
    tip.className = "deed";
    tip.hidden = true;
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");
    document.body.appendChild(tip);

    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
