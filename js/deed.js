/* ============================================================================
 * Balkan Tycoon — deed.js
 * The property inspector: a full Balkan deed card rendered into its own column
 * in the side panel, plus the build / mortgage / sell controls for plots you
 * own.
 *
 * This used to be a tooltip that followed the pointer and opened INTO the
 * board, which meant the instant you hovered a plot to read it you lost sight
 * of the houses standing on it and of any pawn parked there — the two things
 * you were almost certainly checking. Docking it fixes that outright: nothing
 * on the board is ever covered, the card is big enough to read, it holds real
 * buttons, and it stays put after the pointer leaves the board so you can walk
 * over and click them.
 *
 * That is also where property management lives now. There is no separate
 * "manage" mode: you look at a plot, and the things you can do to it are right
 * there under the rent table.
 * Strictly no emoji characters: typography, SVG icons and CSS badges only.
 * ========================================================================== */

"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);

  const EURO = "\u20ac";
  const DOT = "\u00b7";
  const euro = (n) => EURO + n;

  /** Currently inspected tile id, and whether a click pinned it. */
  let curId = null;
  let pinned = false;

  /* Player names come from a lobby text field and land in innerHTML below, so
   * they have to be escaped rather than trusted. */
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

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

  function costRow(iconName, label, value, iconCls) {
    return (
      '<span class="deed__cost">' + icon(iconName, iconCls) + label +
      " <b>" + value + "</b></span>"
    );
  }

  /** Which pawns are standing on this tile right now. */
  function whoIsHere(g, tile) {
    if (!g) return "";
    const idx = window.BT.tileIndex(tile.id);
    const here = g.players.filter((p) => !p.bankrupt && p.position === idx);
    if (!here.length) return "";
    return '<div class="deed__here">' +
      '<span class="deed__here-lbl">Standing here</span>' +
      here.map((p) =>
        '<span class="deed__who"><span class="deed__token" style="background:' + p.color + '">' +
        face(p) + "</span>" + esc(p.name) + "</span>").join("") +
      "</div>";
  }

  /**
   * What is actually built here, as pieces rather than a sentence: filled slots
   * are green houses, empty slots spell out how much room is left, and a hotel
   * replaces the lot with one red piece. Current rent sits on the right, because
   * that is the number the development is really telling you about.
   */
  function devStrip(g, tile) {
    const ps = g && g.props[tile.id];
    if (!ps || !ps.owner) return "";

    // a mortgaged deed earns nothing, so development is moot until it is cleared
    if (ps.mortgaged) {
      return '<div class="deed__dev is-hocked">' +
        '<span class="deed__pieces">' + icon("banknote", "ic-pc") + "</span>" +
        '<span class="deed__devtx">Mortgaged &mdash; collects no rent</span>' +
        '<b class="deed__devrent">buy back ' + euro(g.unmortgageCost(tile)) + "</b>" +
        "</div>";
    }

    const max = ECONOMY.maxHouses;
    const built = ps.houses || 0;
    const piece = (cls) => '<i class="deed__pc deed__pc--' + cls + '">' +
      icon("houseSolid", "ic-pc") + "</i>";

    let pieces, label;
    if (built >= max) {
      pieces = piece("hotel");
      label = "Hotel built";
    } else {
      pieces = Array.from({ length: max },
        (_, i) => (i < built ? piece("house") : '<i class="deed__pc deed__pc--empty"></i>')).join("");
      label = built
        ? built + (built > 1 ? " houses built" : " house built")
        : "No houses built";
    }

    return '<div class="deed__dev">' +
      '<span class="deed__pieces">' + pieces + "</span>" +
      '<span class="deed__devtx">' + label + "</span>" +
      '<b class="deed__devrent">' + euro(g.rentFor(tile)) + "</b>" +
      "</div>";
  }

  function cityDeed(tile) {
    const c = COUNTRIES[tile.country];
    const b = tile.baseRent;
    const hc = tile.houseCost;
    const g = activeGame();
    const lv = g ? liveLevel(g, tile) : null;

    let html =
      head(c.color, window.BT.flagBg(tile.country), null,
        esc(tile.name), esc(c.name) + " " + DOT + " Group " + c.short, tile.price);

    html += '<div class="deed__table">' +
      rentRow("Base Rent", b, "base", lv) +
      rentRow("Full Country Set", b * ECONOMY.monopolyMultiplier, "mono", lv) +
      rentRow("With 1 House", b * ECONOMY.houseMultipliers[1], "h1", lv) +
      rentRow("With 2 Houses", b * ECONOMY.houseMultipliers[2], "h2", lv) +
      rentRow("With 3 Houses", b * ECONOMY.houseMultipliers[3], "h3", lv) +
      rentRow("With Hotel / Kafana", b * ECONOMY.houseMultipliers[4], "hotel", lv) +
      "</div>";

    html += devStrip(g, tile);

    html += '<div class="deed__costs">' +
      costRow("houseSolid", "House", euro(hc) + " each", "ic-deed ic-deed--house") +
      costRow("houseSolid", "Hotel", euro(hc) + " + 4 houses", "ic-deed ic-deed--hotel") +
      costRow("banknote", "Mortgage", euro(Math.round(tile.price / 2))) +
      "</div>";

    if (g && lv) {
      const p = g.player(g.props[tile.id].owner);
      const owned = COUNTRY_GROUPS[tile.country]
        .filter((id) => g.props[id].owner === p.id).length;
      const total = COUNTRY_GROUPS[tile.country].length;
      html +=
        '<div class="deed__live">' +
          '<span class="deed__token" style="background:' + p.color + '">' + face(p) + "</span>" +
          "Owned by <strong>" + esc(p.name) + "</strong> " + DOT + " " +
          (owned === total
            ? "holds all of " + esc(c.name)
            : owned + " of " + total + " " + c.short + " cities") +
        "</div>";
    }
    return html + whoIsHere(g, tile);
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
        esc(tile.name), "Balkan Air " + DOT + " Transport group", tile.price);

    html += '<div class="deed__table">' +
      rentRow("With 1 Airport", ECONOMY.airportRent[0], "a1", lv) +
      rentRow("With 2 Airports", ECONOMY.airportRent[1], "a2", lv) +
      rentRow("With 3 Airports", ECONOMY.airportRent[2], "a3", lv) +
      rentRow("With 4 Airports", ECONOMY.airportRent[3], "a4", lv) +
      "</div>";

    html += devStrip(g, tile);

    html += '<div class="deed__costs">' +
      costRow("plane", "Rent", "doubles per airport owned") +
      costRow("banknote", "Mortgage", euro(Math.round(tile.price / 2))) +
      "</div>";

    if (g && lv) {
      const p = g.player(ps.owner);
      html +=
        '<div class="deed__live">' +
          '<span class="deed__token" style="background:' + p.color + '">' + face(p) + "</span>" +
          "Owned by <strong>" + esc(p.name) + "</strong> " + DOT + " currently " +
          count + " airport" + (count > 1 ? "s" : "") +
        "</div>";
    }
    return html + whoIsHere(g, tile);
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
        esc(tile.name), "Utility " + DOT + " Services group", tile.price);

    html += '<div class="deed__table">' +
      rentRow("One Utility Owned", 28, "u1", oneKey) +
      rentRow("Both Utilities Owned", 70, "u2", both ? "u2" : null) +
      "</div>";

    html += devStrip(g, tile);

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
          "Owned by <strong>" + esc(p.name) + "</strong> " + DOT + " currently " +
          (both ? "both utilities" : "one utility") +
        "</div>";
    }
    return html + whoIsHere(g, tile);
  }

  /* ---------- the action strip: this is the property manager ---------- */

  function actionStrip(g, tile) {
    const UI = window.BT.UI;
    const me = UI.me(g);
    const ps = g && g.props[tile.id];
    if (!g || !me || !ps) return "";

    if (ps.owner !== me.id) {
      // not yours: say what it would take, rather than showing dead buttons
      if (!ps.owner) {
        return '<div class="deed-acts"><p class="deed-acts__note">Unclaimed &mdash; ' +
          euro(tile.price) + " if you land on it.</p></div>";
      }
      return "";
    }

    const allow = UI.canManage(g);
    const sellRate = ECONOMY.sellRate;
    const btn = (act, label, ic, enabled, title, cls) =>
      '<button class="btn' + (cls ? " " + cls : "") + '" type="button" data-deed-act="' + act +
      '" data-tile="' + esc(tile.id) + '"' + (enabled && allow ? "" : " disabled") +
      ' title="' + esc(title) + '">' + window.BT.icon(ic) + label + "</button>";

    const parts = [];
    if (tile.kind === "city") {
      parts.push(btn("build", "Build " + euro(tile.houseCost), "plus",
        g.canBuildOn(me, tile), "Raise a house here for " + euro(tile.houseCost)));
      parts.push(btn("sell", "Sell house", "minus",
        g.canSellOn(me, tile),
        "Sell a house back for " + euro(Math.round(tile.houseCost * sellRate))));
    }
    if (g.rules.mortgages) {
      if (ps.mortgaged) {
        parts.push(btn("unmortgage", "Buy back " + euro(g.unmortgageCost(tile)), "key",
          g.canUnmortgage(me, tile), "Clear the mortgage for " + euro(g.unmortgageCost(tile)),
          tile.kind === "city" ? "" : "btn--wide"));
      } else {
        parts.push(btn("mortgage", "Mortgage " + euro(Math.round(tile.price * ECONOMY.mortgageRate)),
          "banknote", g.canMortgage(me, tile),
          "Raise " + euro(Math.round(tile.price * ECONOMY.mortgageRate)) + " against this deed",
          tile.kind === "city" ? "" : "btn--wide"));
      }
    }
    parts.push(btn("sell-field", "Sell to bank " + euro(Math.round(tile.price * sellRate)), "coins",
      g.canSellField(me, tile),
      "Hand the deed back for " + euro(Math.round(tile.price * sellRate)), "btn--wide"));

    let note = "";
    if (!allow) note = "You can only change your deeds on your own turn.";
    else if (tile.kind === "city" && !g.ownsGroup(me, tile.country)) {
      note = "You need every city in " + esc(COUNTRIES[tile.country].name) + " before you can build.";
    } else if (tile.kind === "city" && COUNTRY_GROUPS[tile.country].some((id) => g.props[id].mortgaged)) {
      note = "Nothing can be built while a deed in this country is mortgaged.";
    }

    return '<div class="deed-acts">' + parts.join("") +
      (note ? '<p class="deed-acts__note">' + note + "</p>" : "") + "</div>";
  }

  function contentFor(tile) {
    if (tile.kind === "city") return cityDeed(tile);
    if (tile.kind === "airport") return airportDeed(tile);
    return utilityDeed(tile);
  }

  /* ---------- rendering into the docked panel ---------- */

  function isPropertyTile(el) {
    const idx = Number(el.dataset.pos);
    const tile = TILES[idx];
    return Boolean(tile && (tile.kind === "city" || tile.kind === "airport" || tile.kind === "utility"));
  }

  function render() {
    const slot = $("#inspect-slot");
    if (!slot) return;
    const tile = curId && window.BT.tileById(curId);
    if (!tile) {
      slot.innerHTML = '<p class="inspect-empty">Hover a property to inspect it.<br />' +
        "Click a plot you own to build, mortgage or sell.</p>";
      return;
    }
    const g = activeGame();
    const card = document.createElement("div");
    card.className = "deed";
    card.innerHTML = contentFor(tile) + actionStrip(g, tile);
    slot.innerHTML = "";
    slot.appendChild(card);

    card.querySelectorAll("[data-deed-act]").forEach((b) => {
      b.onclick = () => {
        const UI = window.BT.UI;
        const id = b.dataset.tile;
        const map = {
          build: UI.buildHandler,
          sell: UI.sellHandler,
          mortgage: UI.mortgageHandler,
          unmortgage: UI.unmortgageHandler,
          "sell-field": UI.sellFieldHandler,
        };
        const fn = map[b.dataset.deedAct];
        if (typeof fn === "function") fn(id);
        // the deed will be re-rendered by UI.sync once the engine reports back;
        // repaint straight away so a local click never feels dropped
        setTimeout(render, 0);
      };
    });
  }

  /* ---------- wiring ---------- */

  function show(tileId, viaClick) {
    if (viaClick) pinned = curId === tileId ? !pinned : true;
    if (curId === tileId && !viaClick) return;
    curId = tileId;
    render();
  }

  function onMouseMove(e) {
    if (pinned) return;
    const el = e.target && e.target.closest ? e.target.closest(".tile") : null;
    if (!el || !isPropertyTile(el)) return; // leaving the board keeps the last card up
    const tile = TILES[Number(el.dataset.pos)];
    el.removeAttribute("title"); // the deed replaces the native tooltip
    show(tile.id, false);
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest(".tile") : null;
    if (!el || !isPropertyTile(el)) return;
    const tile = TILES[Number(el.dataset.pos)];
    show(tile.id, true);
  }

  function init() {
    const board = document.getElementById("board");
    if (!board) return;
    board.addEventListener("mousemove", onMouseMove, { passive: true });
    board.addEventListener("click", onClick);
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.BT = Object.assign(window.BT || {}, {
    Deed: {
      refresh: render,
      show: (tileId) => show(tileId, true),
      clear: () => { curId = null; pinned = false; render(); },
      get pinned() { return pinned; },
    },
  });
})();
