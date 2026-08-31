/* ============================================================================
 * Balkan Tycoon — ui.js
 * Reference-style tile cards (flag header, price bottom-left), players panel
 * with ownership lists, bottom action log (newest last, scrollable), SVG
 * icons everywhere, and the reworked trade modal with balances + sliders.
 * ========================================================================== */

"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);
  const icon = (name, cls) => window.BT.icon(name, cls);
  const anyIcon = (key, cls) => window.BT.anyIcon(key, cls);
  const flagBg = (cid) => window.BT.flagBg(cid);

  const UI = {
    tileEls: [],
    tileParts: new Map(),
    game: null,
  };

  /**
   * Whose hands are on this keyboard.
   *
   * Online that is the seat token; in a local hot-seat game everybody shares one
   * screen, so "me" is simply whoever is on turn. Every affordance on the board
   * (is this my plot? may I build here?) keys off this one answer rather than
   * each caller re-deriving it and getting it subtly wrong.
   */
  UI.localPlayerId = function (game) {
    if (window.BT.myPlayerId) return window.BT.myPlayerId;
    return game && game.current ? game.current.id : null;
  };

  /** The player object this client is acting for, or null. */
  UI.me = function (game) {
    const id = UI.localPlayerId(game);
    return id && game ? game.player(id) : null;
  };

  /** Is it my move? (Always true in hot-seat.) */
  UI.myTurn = function (game) {
    if (!game || !game.current) return false;
    return !window.BT.myPlayerId || window.BT.myPlayerId === game.current.id;
  };

  /**
   * May this client change its own deeds right now? Building outside your turn
   * is a house rule; when it is off you may still act during your own turn, and
   * always while you are settling a debt — that prompt exists precisely so you
   * can raise cash.
   */
  UI.canManage = function (game) {
    const me = UI.me(game);
    if (!game || !me || me.bankrupt || game.phase === "over") return false;
    if (me.debtAmount > 0) return true;
    if (game.rules && game.rules.buildAnytime) return true;
    return UI.myTurn(game);
  };

  const badge = (color, style, cls) =>
    window.BT.Tokens.badge(color, style, cls || "");

  const kindColor = (tile) =>
    tile.kind === "city" ? COUNTRIES[tile.country].color
      : tile.kind === "airport" ? "#4f7d99"
      : "#8f8a3f";

  /** HTML-escape any player/tile supplied string before it hits innerHTML. */
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  /** hex (#rgb/#rrggbb) -> rgba() string with alpha `a`. */
  function hexA(hex, a) {
    let h = String(hex).replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  /**
   * Ink colour for text sitting on `hex`: whichever of near-black or white has
   * more contrast against it. Uses real sRGB relative luminance, not a
   * brightness average, because the two disagree badly on saturated hues.
   *
   * The 0.1791 threshold is the exact crossover where white and black give
   * equal WCAG contrast (solve 1.05/(L+0.05) = (L+0.05)/0.05). Every colour in
   * the current seat palette lands above it and so takes dark ink; the branch
   * exists for custom or relayed seat colours that may be genuinely dark.
   */
  function inkOn(hex) {
    let h = String(hex).replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.1791 ? "#0b0f16" : "#ffffff";
  }

  /** First letter of a player name, for the ownership plate. */
  const initialOf = (name) => (String(name || "").trim().charAt(0) || "?").toUpperCase();

  /* Plate tags, memoised per game in a WeakMap rather than on the game object,
   * which would ride along into serialize() and out over the wire. */
  const tagCache = new WeakMap();

  /**
   * A short, unique tag per player for the ownership plate.
   *
   * An initial is the friendly choice, but it is not always unique — the
   * default roster is "Player 1".."Player 4", which all collide on P, and two
   * humans called Marko and Milan collide just as hard. So any initial shared
   * by more than one player falls back to that player's seat number. Unique
   * initials are left alone, because "Z" on Zagreb beats "3".
   */
  function plateTags(game) {
    if (!game.players || !game.players.length) return new Map();
    // key the cache on the actual names: players can rename mid-match, and a
    // cache keyed on the game alone pinned the tag they joined with forever
    const key = game.players.map((p) => p.id + ":" + p.name).join("|");
    const hit = tagCache.get(game);
    if (hit && hit.key === key) return hit.tags;
    let tags;
    // never cache an empty roster: a snapshot could arrive mid-hydration and
    // we would pin blank tags for the rest of the match
    const seen = new Map();
    for (const p of game.players) {
      const i = initialOf(p.name);
      seen.set(i, (seen.get(i) || 0) + 1);
    }
    tags = new Map();
    for (const p of game.players) {
      const i = initialOf(p.name);
      tags.set(p.id, seen.get(i) > 1 ? String((p.seat || 0) + 1) : i);
    }
    tagCache.set(game, { key, tags });
    return tags;
  }

  /* ================= Board rendering ================= */

  /* The prison is the one corner with real internals: a barred cell leaning
   * toward the board centre, and an exercise yard on the outer edge. Pawns
   * doing time stand inside the cell (movement.js puts them there and the
   * front bar layer draws over them); anyone merely passing through waits in
   * the yard, so the two states never look alike. */
  function jailInnerHTML(tile) {
    return (
      '<div class="jail">' +
        '<div class="jail__yard">' +
          '<span class="jail__tag">' + icon("eye", "ic-jail") + "Just visiting</span>" +
        "</div>" +
        '<div class="jail__cell jail-box">' +
          '<div class="jail__floor" aria-hidden="true"></div>' +
          '<div class="jail__window" aria-hidden="true"></div>' +
          '<div class="jail__plaque">' + icon("lock", "ic-jail") + "<b>" + esc(tile.name) + "</b></div>" +
        "</div>" +
      "</div>"
    );
  }

  /* The ownership chip rides INSIDE the footer, on the same row as the flag
   * badge and the price. It used to be a full-width band pinned across the
   * outer rim, which sat on top of both of them and forced the footer to pad
   * itself out of the way — so on every owned city the flag was half-covered. */
  const ownerChip = () =>
    '<span class="tile__owner">' +
      '<span class="tile__crown" aria-hidden="true">' + icon("crown") + "</span>" +
      '<span class="tile__ownertag"></span>' +
    "</span>";

  /* Plain-language stamp for a mortgaged plot. Whether a deed is hocked changes
   * what landing on it costs, so it belongs on the board, not three clicks deep
   * in a manager. */
  const mortgageStamp = () =>
    '<div class="tile__mtg"><b title="Mortgaged — collects no rent">' +
      icon("banknote") + "<span>Mortgaged</span></b></div>";

  function tileInnerHTML(tile) {
    const price = '<span class="tile__price">&euro;' + tile.price + "</span>";
    switch (tile.kind) {
      case "city":
        return (
          '<div class="tile__banner" data-banner style="' + flagBg(tile.country) + '">' +
            '<div class="tile__houses" data-houses></div>' +
          "</div>" +
          '<div class="tile__body"><span class="tile__name">' + tile.name + "</span></div>" +
          '<div class="tile__footer">' +
            ownerChip() +
            '<span class="tile__flagbadge" style="' + flagBg(tile.country) + '"></span>' +
            price +
          "</div>" +
          '<div class="tile__group" style="background:' + COUNTRIES[tile.country].color + '"></div>' +
          mortgageStamp());
      case "airport":
      case "utility": {
        const ic = tile.kind === "airport" ? "plane" : tile.id === "balkan-electric" ? "zap" : "bottle";
        return (
          '<div class="tile__figure" data-banner>' + icon(ic) + "</div>" +
          // short board label where one exists; the full name lives on the deed
          '<div class="tile__body"><span class="tile__name">' + esc(tile.label || tile.name) + "</span></div>" +
          '<div class="tile__footer">' + ownerChip() + price + "</div>" +
          '<div class="tile__group" style="background:' + kindColor(tile) + '"></div>' +
          mortgageStamp());
      }
      case "surprise":
        return (
          '<div class="tile__figure">' + icon("help") + "</div>" +
          '<div class="tile__body"><span class="tile__name">Surprise</span></div>' +
          '<div class="tile__footer"></div>');
      case "event":
        return (
          '<div class="tile__figure">' + icon("sparkles") + "</div>" +
          '<div class="tile__body"><span class="tile__name">Balkan Event</span></div>' +
          '<div class="tile__footer"></div>');
      case "tax":
        return (
          '<div class="tile__figure">' + icon("shield") + "</div>" +
          '<div class="tile__body"><span class="tile__name">' + tile.name + "</span></div>" +
          '<div class="tile__footer"><span class="tile__price tile__price--tax">&euro;' + tile.amount + "</span></div>");
      case "corner": {
        if (tile.corner === "jail") return jailInnerHTML(tile);
        const ic = { start: "flag", kafana: "coffee", "go-to-jail": "alert" }[tile.corner];
        return (
          '<div class="tile__figure">' + icon(ic) + "</div>" +
          '<div class="tile__body"><span class="tile__name">' + tile.name + "</span></div>" +
          '<div class="tile__sub">' + (tile.sub || "") + "</div>");
      }
      default:
        return "";
    }
  }
  /**
   * The front half of the cell bars, as its own grid item stacked on the jail
   * tile. It has to live outside the tile so it can paint ABOVE the pawn layer
   * — that is what puts the prisoners behind bars instead of in front of them.
   * Cell geometry comes from BT.JAIL_GEO via CSS custom properties, the same
   * numbers movement.js uses to seat the pawns.
   */
  function renderJailBars(board) {
    const geo = window.BT.JAIL_GEO;
    board.style.setProperty("--jail-inset", geo.CELL_INSET * 100 + "%");
    board.style.setProperty("--jail-size", geo.CELL_SIZE * 100 + "%");

    board.querySelectorAll(".jail-front").forEach((el) => el.remove());
    const index = TILES.findIndex((t) => t.kind === "corner" && t.corner === "jail");
    if (index < 0) return;

    const pos = gridPos(index);
    const front = document.createElement("div");
    front.className = "jail-front tile--at-" + window.BT.cornerAnchor(index);
    front.setAttribute("aria-hidden", "true");
    front.style.gridRow = String(pos.row);
    front.style.gridColumn = String(pos.col);
    front.innerHTML = '<div class="jail-box jail-front__cell"><i class="jail__bars"></i></div>';
    board.appendChild(front);
  }

  UI.renderBoard = function () {
    const board = $("#board");
    UI.tileEls = [];
    UI.tileParts.clear();

    TILES.forEach((tile, index) => {
      const pos = gridPos(index);
      const el = document.createElement("div");
      el.className = "tile tile--" + tile.kind + " tile-" + tileSide(index);
      if (tile.kind === "corner") {
        // tile--at-{tl,tr,br,bl} tells corner internals which way is "inward"
        el.classList.add("tile--corner-" + tile.corner, "tile--at-" + window.BT.cornerAnchor(index));
      }
      el.style.gridRow = String(pos.row);
      el.style.gridColumn = String(pos.col);
      el.dataset.pos = String(index);
      el.dataset.tileId = tile.id;
      el.title = tile.kind === "city"
        ? tile.name + ", " + COUNTRIES[tile.country].name
        : tile.name;
      // group color for the hover glow (set as custom props)
      el.style.setProperty("--gc-55", hexA(kindColor(tile), 0.5));
      // inward-facing card: content + strips rotate/invert per edge via CSS.
      // The ownership chip is built by tileInnerHTML, inside the footer, so only
      // buyable tiles carry one — a corner or a tax square can never change
      // hands and would be dead markup on 12 of 40 tiles.
      el.innerHTML =
        '<div class="tile__card">' +
          tileInnerHTML(tile) +
          '<div class="tile__tint"></div>' +
        "</div>";

      board.appendChild(el);
      UI.tileEls[index] = el;
      UI.tileParts.set(tile.id, {
        el,
        ownerTag: el.querySelector(".tile__ownertag"),
        priceEl: el.querySelector(".tile__price"),
        housesBox: el.querySelector("[data-houses]"),
      });
    });

    renderJailBars(board);
    UI.measureCells();
    if (!UI._cellRO && window.ResizeObserver) {
      UI._cellRO = new ResizeObserver(() => UI.measureCells());
      UI._cellRO.observe(board);
    }
  };

  /** Feed the CSS orientation transforms the live grid cell dimensions. */
  UI.measureCells = function () {
    const board = $("#board");
    const ref = UI.tileEls[1]; // any side tile: short = track depth, long = ring track
    if (!board || !ref) return;
    const r = ref.getBoundingClientRect();
    if (!r.width || !r.height) return;
    board.style.setProperty("--cell-short", Math.round(r.width) + "px");
    board.style.setProperty("--cell-long", Math.round(r.height) + "px");
  };

  UI.flashTile = function (pos) {
    const el = UI.tileEls[pos];
    if (!el) return;
    el.classList.add("is-active");
    setTimeout(() => el.classList.remove("is-active"), 1200);
  };

  /* -------------------------------------------------------------------------
   * Ownership on the board
   *
   * A 4px hairline is not enough to answer "whose is that?" from across the
   * table, so a claimed plot is marked three ways at once, each readable at a
   * different distance:
   *
   *   ring + wash   a 2px seat-colour ring around the tile and a colour wash
   *                 falling from the inner edge — peripheral vision, tells you
   *                 the plot is taken before you focus on it
   *   owner plate   a solid seat-colour band on the inner rim carrying the
   *                 owner's initial in auto-contrast ink — colour alone fails
   *                 when two seats sit close on the wheel, and it also covers
   *                 colour-blind players
   *   rent readout  the price pill becomes the live rent in the owner's colour,
   *                 so the cost of landing there is on the board, not in a modal
   *
   * A completed country adds a crown to the plate and brightens the ring, since
   * a full set is the single most important thing to notice on the board.
   * ---------------------------------------------------------------------- */

  const OC_PROPS = ["--oc", "--oc-ink", "--oc-24", "--oc-55", "--oc-glow"];

  /** Does `owner` hold every tile of this tile's set (country, or all airports/utilities)? */
  function ownsFullSet(game, tile, owner) {
    if (!owner) return false;
    if (tile.kind === "city") return game.ownsGroup(owner, tile.country);
    return TILES.filter((t) => t.kind === tile.kind)
      .every((t) => game.props[t.id].owner === owner.id);
  }

  /**
   * What landing here costs right now, short enough for the price pill.
   * Utilities are dice-multiplied, so they show the multiplier instead of a
   * number that would be a lie until the dice land.
   */
  function rentLabel(game, tile, ps) {
    if (tile.kind === "utility") {
      const n = TILES.filter((t) => t.kind === "utility" && game.props[t.id].owner === ps.owner).length;
      return "\u00d7" + ECONOMY.utilityMultipliers[Math.min(Math.max(n, 1), 2) - 1];
    }
    return "\u20ac" + game.rentFor(tile);
  }

  /** Hover tooltip: everything about the plot in one line. */
  function tileTitle(game, tile, ps, owner, mono) {
    const base = tile.kind === "city"
      ? tile.name + ", " + COUNTRIES[tile.country].name
      : tile.name;
    if (!owner) return base + " \u2014 \u20ac" + tile.price + ", unowned";
    const h = ps.houses || 0;
    const dev = tile.kind !== "city" ? ""
      : h >= ECONOMY.maxHouses ? ", hotel"
      : h ? ", " + h + (h > 1 ? " houses" : " house")
      : "";
    const rent = rentLabel(game, tile, ps) + (tile.kind === "utility" ? " the dice roll" : "");
    return base + " \u2014 " + owner.name + (mono ? " (full set)" : "") + dev + ", rent " + rent;
  }

  /** Repaint one tile's ownership layers. No-ops unless something changed. */
  function paintOwnership(game, tile, ps, owner, parts) {
    const el = parts.el;
    const mono = ownsFullSet(game, tile, owner);
    const rent = owner ? rentLabel(game, tile, ps) : "";
    // rent is in the signature because a neighbour changing hands can move
    // this tile's rent (airport ladder, utility multiplier, set bonus)
    const tag = owner ? plateTags(game).get(owner.id) || "" : "";
    const hocked = Boolean(owner && ps.mortgaged);
    const me = UI.localPlayerId(game);
    const mine = Boolean(owner && me && owner.id === me);
    // can I do something with this plot right now? drives the board affordance
    const can = mine && (
      game.canBuildOn(owner, tile) || game.canSellOn(owner, tile) ||
      game.canMortgage(owner, tile) || game.canUnmortgage(owner, tile) ||
      game.canSellField(owner, tile));
    const sig = owner
      ? owner.id + "|" + owner.color + "|" + tag + "|" + rent + "|" + (mono ? 1 : 0) +
        (hocked ? "|m" : "") + (mine ? "|me" : "") + (can ? "|c" : "")
      : "";
    if (parts.ownSig === sig) return;
    parts.ownSig = sig;

    el.classList.toggle("is-owned", Boolean(owner));
    el.classList.toggle("is-monopoly", mono);
    el.classList.toggle("is-mine", mine);
    el.classList.toggle("is-actionable", can);
    // a mortgaged plot is still owned but earns nothing, and that has to be
    // visible on the board itself — otherwise you have to open the manager to
    // find out why landing on someone's city cost you nothing
    el.classList.toggle("is-hocked", hocked);

    if (owner) {
      el.style.setProperty("--oc", owner.color);
      el.style.setProperty("--oc-ink", inkOn(owner.color));
      el.style.setProperty("--oc-24", hexA(owner.color, 0.24));
      el.style.setProperty("--oc-55", hexA(owner.color, 0.55));
      el.style.setProperty("--oc-glow", hexA(owner.color, 0.55));
    } else {
      // clear, or a sold-off tile keeps glowing in its old owner's colour
      for (const prop of OC_PROPS) el.style.removeProperty(prop);
    }

    if (parts.ownerTag) parts.ownerTag.textContent = tag;
    if (parts.priceEl) {
      parts.priceEl.textContent = owner ? "R " + rent : "\u20ac" + tile.price;
      parts.priceEl.classList.toggle("tile__price--rent", Boolean(owner));
    }
    // aria-label, not title: deed.js draws its own hover card for property
    // tiles and strips `title` so the two tooltips cannot both appear. Keeping
    // the text on aria-label preserves it for screen readers.
    el.removeAttribute("title");
    el.setAttribute("aria-label", tileTitle(game, tile, ps, owner, mono));
  }

  /** Repaint ownership layers + house pips from engine state. */
  UI.renderTiles = function (game) {
    for (const [tileId, parts] of UI.tileParts) {
      const ps = game.props[tileId];
      const tile = tileById(tileId);
      if (!ps) continue;
      const owner = ps.owner ? game.player(ps.owner) : null;
      paintOwnership(game, tile, ps, owner, parts);

      if (parts.housesBox && tile.kind === "city") {
        // The 3D overlay owns the buildings when WebGL is up; the flat pips are
        // only a fallback so a no-WebGL browser still shows development level.
        const flat = !(window.BT.Buildings && window.BT.Buildings.active());
        const n = flat ? ps.houses : 0;
        if (parts.hSig !== n) {
          parts.hSig = n;
          parts.housesBox.innerHTML = n >= ECONOMY.maxHouses
            ? icon("houseSolid", "ic-house ic-hotel")
            : Array.from({ length: n }, () => icon("houseSolid", "ic-house")).join("");
        }
      }
    }
    /* The kafana pot, on the tile it will be won from AND on the HUD next to
     * the log. Taxes vanishing into a pot and reappearing in someone's balance
     * turns later is invisible bookkeeping otherwise — you could not see the
     * prize sitting there, or that it existed at all. */
    const jackpot = Boolean(game.rules && game.rules.kafanaJackpot);
    const pot = jackpot ? (game.kafanaPot || 0) : 0;
    const kaf = UI.tileParts.get("kafana");
    if (kaf) {
      const sub = kaf.el.querySelector(".tile__sub");
      if (sub) {
        const txt = !jackpot ? "Free parking"
          : pot > 0 ? "POT " + money(pot)
          : "Pot empty";
        if (sub.textContent !== txt) sub.textContent = txt;
      }
      kaf.el.classList.toggle("has-pot", pot > 0);
    }
    const potChip = $("#hud-pot");
    if (potChip) {
      potChip.hidden = !jackpot;
      const val = $("#hud-pot-val");
      if (val) val.textContent = money(pot);
    }

    // a deed changing hands while the spotlight is up must move the glow with it
    if (UI._spotlightId) UI._applySpotlight(game);

    // keep the 3D houses/hotels overlay in step with engine state
    if (window.BT.Buildings) window.BT.Buildings.sync(game);
  };

  /* ================= Side panel: player fields ================= */

  /* Online presence: playerId -> false when that seat has dropped. Empty in
   * local hot-seat, where everybody is by definition at the table. */
  UI.presence = new Map();

  /* ---------------------------------------------------------------------------
   * The roster reads like a ledger: one dense line per player, seat colour as
   * a rule down the left, money right-aligned in tabular figures so the digits
   * stack. Rows are built once and then patched in place — that is what lets
   * the cash roll and the +/- deltas float instead of the whole list flashing.
   * ------------------------------------------------------------------------ */

  const money = (n) => "\u20ac" + Math.round(n).toLocaleString("en-US");

  /** Tally holdings + monopoly progress per country group. */
  function holdings(game, p) {
    const out = { airports: 0, utilities: 0, houses: 0, hotels: 0, sets: [] };
    const byCountry = new Map();
    for (const t of game.ownedTiles(p)) {
      if (t.kind === "city") {
        byCountry.set(t.country, (byCountry.get(t.country) || 0) + 1);
        const h = game.props[t.id].houses || 0;
        if (h >= ECONOMY.maxHouses) out.hotels += 1;
        else out.houses += h;
      } else if (t.kind === "airport") out.airports += 1;
      else if (t.kind === "utility") out.utilities += 1;
    }
    // keep the board's own cheap-to-premium order so the pips read left to right
    for (const cid of Object.keys(COUNTRIES)) {
      const owned = byCountry.get(cid);
      if (!owned) continue;
      out.sets.push({ cid, owned, total: COUNTRY_GROUPS[cid].length });
    }
    return out;
  }

  /* Segmented pips: how far along each colour set the player is. */
  function setPips(sets) {
    return sets.map(({ cid, owned, total }) => {
      const c = COUNTRIES[cid];
      const full = owned === total;
      const cells = Array.from({ length: total },
        (_, i) => '<i' + (i < owned ? ' class="on"' : "") + "></i>").join("");
      return '<span class="setpip' + (full ? " is-full" : "") + '" style="--gc:' + c.color +
        '" title="' + esc(c.name) + " " + owned + "/" + total + (full ? " — full set" : "") + '">' +
        cells + "</span>";
    }).join("");
  }

  /* Compact asset counters — only what the player actually has. Houses and
   * hotels use the same piece glyph, tinted green and red, so the counters
   * match the pieces standing on the board. */
  const ASSETS = [
    ["houses", "houseSolid", "pa--house"],
    ["hotels", "houseSolid", "pa--hotel"],
    ["airports", "plane", ""],
    ["utilities", "zap", ""],
  ];

  function assetRow(h, p) {
    const cells = ASSETS
      .filter(([k]) => h[k] > 0)
      .map(([k, ic, cls]) =>
        '<span class="pa' + (cls ? " " + cls : "") + '">' + icon(ic, "ic-pa") + h[k] + "</span>");
    if (p.getOutCards > 0) {
      cells.push('<span class="pa pa--key" title="Get-Out-of-Jail">' + icon("key", "ic-pa") + p.getOutCards + "</span>");
    }
    return cells.join("");
  }

  /** Build the static skeleton of one ledger row. */
  function makeRow(p) {
    const li = document.createElement("li");
    li.className = "pl";
    li.dataset.playerId = p.id;
    li.style.setProperty("--pc", p.color);
    li.style.setProperty("--pc-14", hexA(p.color, 0.14));
    li.style.setProperty("--pc-50", hexA(p.color, 0.5));
    li.innerHTML =
      '<div class="pl__worth"><i></i></div>' +
      '<div class="pl__row">' +
        badge(p.color, p.tokenStyle, "pl__tok") +
        '<span class="pl__id">' +
          '<span class="pl__name"></span>' +
          '<span class="pl__flags"></span>' +
        "</span>" +
        '<span class="pl__delta"></span>' +
        '<b class="pl__cash"></b>' +
      "</div>" +
      '<div class="pl__meta">' +
        '<span class="pl__sets"></span>' +
        '<span class="pl__assets"></span>' +
      "</div>" +
      '<div class="pl__clock"><i></i></div>';
    return {
      el: li,
      name: li.querySelector(".pl__name"),
      flags: li.querySelector(".pl__flags"),
      cash: li.querySelector(".pl__cash"),
      sets: li.querySelector(".pl__sets"),
      assets: li.querySelector(".pl__assets"),
      worth: li.querySelector(".pl__worth i"),
      clock: li.querySelector(".pl__clock i"),
      delta: li.querySelector(".pl__delta"),
      shown: p.cash, // last painted cash value, for the roll animation
    };
  }

  UI._rows = new Map();

  /* ---------------------------------------------------------------------------
   * Money pacing
   *
   * A payment used to land in 420ms with an easeOutCubic, which front-loads the
   * movement: most of the change happened in the first fifth of an already short
   * animation, so a rent payment was over before you could look up and see whose
   * balance moved. Two changes fix that:
   *
   *   - the duration scales with the amount, so €20 stays brisk while a €900
   *     rent takes long enough to follow, instead of one fixed tempo for both
   *   - the easing is in-out rather than out, so the digits tick steadily
   *     through the middle of the roll rather than blurring past
   *
   * The +/- chip also holds long enough to actually be read, and its CSS
   * animation length is driven from here so the two cannot drift apart.
   * ------------------------------------------------------------------------ */

  const CASH_ROLL_MIN_MS = 650;   // a small fee
  const CASH_ROLL_MAX_MS = 1700;  // a ruinous rent
  const CASH_ROLL_REF = 1000;     // amount that earns the full duration
  const DELTA_HOLD_MS = 2300;

  function rollDuration(diff) {
    const a = Math.abs(diff);
    // log scale: mid-sized sums should not feel sluggish just because a huge
    // one exists, so €100 sits nearer the fast end than a linear ramp gives
    const k = Math.min(1, Math.log10(1 + a / 25) / Math.log10(1 + CASH_ROLL_REF / 25));
    return Math.round(CASH_ROLL_MIN_MS + (CASH_ROLL_MAX_MS - CASH_ROLL_MIN_MS) * k);
  }

  const easeInOutQuad = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  /** Roll a cash figure from its current value to the new one. */
  function rollCash(row, to) {
    const from = row.shown;
    row.shown = to;
    if (from === to) { row.cash.textContent = money(to); return; }
    if (Math.abs(to - from) < 2 || document.hidden) {
      row.cash.textContent = money(to);
      return;
    }
    cancelAnimationFrame(row.raf);
    const t0 = performance.now();
    const dur = rollDuration(to - from);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      row.cash.textContent = money(from + (to - from) * easeInOutQuad(k));
      if (k < 1) row.raf = requestAnimationFrame(step);
    };
    row.raf = requestAnimationFrame(step);
  }

  /** Float a +/- amount off the row. */
  function showDelta(row, amount) {
    const el = row.delta;
    el.textContent = (amount > 0 ? "+" : "\u2212") + money(Math.abs(amount));
    el.className = "pl__delta " + (amount > 0 ? "is-up" : "is-down");
    // keep the chip up for at least as long as the figure is still moving
    const hold = Math.max(DELTA_HOLD_MS, rollDuration(amount) + 700);
    el.style.setProperty("--delta-ms", hold + "ms");
    void el.offsetWidth; // restart
    el.classList.add("is-live");
    clearTimeout(row.deltaTimer);
    row.deltaTimer = setTimeout(() => el.classList.remove("is-live"), hold);
  }

  UI.renderPlayers = function (game) {
    const list = $("#player-list");
    if (!list) return;
    const myId = window.BT.myPlayerId;

    // rebuild the skeleton only when the roster itself changes
    const ids = game.players.map((p) => p.id).join("|");
    if (UI._rowsKey !== ids) {
      UI._rowsKey = ids;
      UI._rows.clear();
      list.innerHTML = "";
      for (const p of game.players) {
        const row = makeRow(p);
        UI._rows.set(p.id, row);
        list.appendChild(row.el);
      }
    }

    const worths = game.players.map((p) => game.netWorth(p));
    const topWorth = Math.max(1, ...worths);
    let loudest = null; // biggest cash move this tick, for the sound

    game.players.forEach((p, i) => {
      const row = UI._rows.get(p.id);
      if (!row) return;
      const el = row.el;
      const h = holdings(game, p);
      const isTurn = p.id === game.current.id && game.phase !== "over";
      const online = !UI.presence.size || UI.presence.get(p.id) !== false;

      el.classList.toggle("is-turn", isTurn);
      el.classList.toggle("is-bankrupt", p.bankrupt);
      el.classList.toggle("is-me", p.id === myId);
      el.classList.toggle("is-offline", !online);
      el.classList.toggle("is-broke", !p.bankrupt && p.cash < 100);

      if (row.name.textContent !== p.name) row.name.textContent = p.name;

      const flags =
        (!online ? '<b class="pf pf--off" title="Disconnected">' + icon("wifiOff", "ic-pf") + "</b>" : "") +
        (p.bankrupt ? '<b class="pf pf--out" title="Bankrupt">OUT</b>'
          : p.inJail ? '<b class="pf pf--jail" title="In prison">' + icon("lock", "ic-pf") + "</b>" : "") +
        (p.id === myId ? '<b class="pf pf--you">YOU</b>' : "");
      if (row.flagsHtml !== flags) { row.flags.innerHTML = flags; row.flagsHtml = flags; }

      // money: roll the figure, float the delta, remember the biggest mover
      const delta = p.cash - row.shown;
      if (Math.abs(delta) >= 1) {
        showDelta(row, delta);
        if (!loudest || Math.abs(delta) > Math.abs(loudest.delta)) loudest = { p, delta };
      }
      rollCash(row, p.cash);

      const pips = setPips(h.sets);
      if (row.pipsHtml !== pips) { row.sets.innerHTML = pips; row.pipsHtml = pips; }
      const assets = assetRow(h, p);
      if (row.assetsHtml !== assets) { row.assets.innerHTML = assets; row.assetsHtml = assets; }

      const share = p.bankrupt ? 0 : Math.max(0.02, worths[i] / topWorth);
      row.worth.style.transform = "scaleX(" + share.toFixed(3) + ")";
      row.el.title = p.name + " \u00b7 net worth " + money(worths[i]);
    });

    UI._cashSound(loudest, myId, game);
  };

  /**
   * One money sound per repaint, from the local player's point of view — in
   * hot-seat that means whoever is on turn. Playing every side of every
   * transaction at once just turns into noise.
   */
  UI._cashSound = function (loudest, myId, game) {
    if (!loudest || !window.BT.sfx) return;
    const mine = myId ? loudest.p.id === myId : loudest.p.id === game.current.id;
    if (!mine) return;
    if (UI._skipCashSfx) { UI._skipCashSfx = false; return; }
    if (loudest.delta > 0) window.BT.sfx.cashIn(loudest.delta);
    else window.BT.sfx.cashOut(loudest.delta);
  };

  /** Suppress the next money sound (the caller is playing a richer one). */
  UI.muteNextCashSound = function () { UI._skipCashSfx = true; };

  /**
   * Online-mode presence update.
   * @param {Map<string,boolean>|Record<string,boolean>} map playerId -> connected
   */
  UI.setPresence = function (map) {
    UI.presence = map instanceof Map ? new Map(map) : new Map(Object.entries(map || {}));
    const g = (window.BT.mp && window.BT.mp.game) || UI.game || window.BT.game;
    if (g) UI.renderPlayers(g);
  };

  /** Per-row turn-timer fill (online play). `frac` 0..1, null clears it. */
  UI.setRowClock = function (playerId, frac) {
    for (const [id, row] of UI._rows) {
      const active = id === playerId && frac != null;
      row.el.classList.toggle("has-clock", active);
      if (active) row.clock.style.transform = "scaleX(" + Math.max(0, Math.min(1, frac)).toFixed(3) + ")";
    }
  };

  /* ---------------------------------------------------------------------------
   * Player spotlight
   *
   * "Who owns what" is the question you ask most often and the board answers it
   * worst: a seat-coloured chip and a rail per tile is enough to identify one
   * plot you are already looking at, but not to see an empire at a glance —
   * especially with five other colours competing for attention.
   *
   * Hovering a player in the roster drops the rest of the board back and lights
   * their plots, their pawn and their row. One gesture, and their whole position
   * is the only thing on screen.
   * ------------------------------------------------------------------------ */

  UI._spotlightId = null;

  UI.spotlightPlayer = function (playerId) {
    const app = $("#app");
    UI._spotlightId = playerId || null;
    if (app) app.classList.toggle("is-spotlight", Boolean(UI._spotlightId));
    UI._applySpotlight((window.BT.mp && window.BT.mp.game) || UI.game || window.BT.game);
  };

  UI._applySpotlight = function (game) {
    const id = UI._spotlightId;
    for (const [tileId, parts] of UI.tileParts) {
      const ps = game && game.props[tileId];
      parts.el.classList.toggle("is-lit", Boolean(id && ps && ps.owner === id));
    }
    for (const [rowId, row] of UI._rows) row.el.classList.toggle("is-lit", rowId === id);
    document.querySelectorAll(".pawn").forEach((el) => {
      el.classList.toggle("is-lit", Boolean(id) && el.dataset.playerId === id);
    });
  };

  /** Flash a row when that seat drops or comes back. */
  UI.pulsePlayer = function (playerId, kind) {
    const row = UI._rows.get(playerId);
    if (!row) return;
    const cls = kind === "online" ? "just-online" : "just-offline";
    row.el.classList.remove("just-online", "just-offline");
    void row.el.offsetWidth; // restart the animation
    row.el.classList.add(cls);
    setTimeout(() => row.el.classList.remove(cls), 1500);
  };
  /* ================= Action log (bottom, newest last) ================= */

  /** How many log lines the centre of the table shows at once. */
  const LOG_LINES = 4;

  /* Four lines, newest last, and the older ones simply fall off the top. There
   * is no scrollback here on purpose: this is a running commentary you read out
   * of the corner of your eye, and the full history already lives in the
   * session log for anyone who needs to go back through it. */
  UI.log = function (iconKey, color, text) {
    const list = $("#log-list");
    if (!list) return;
    const li = document.createElement("li");
    li.className = "log-entry";
    const safe = String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    li.innerHTML =
      '<span class="log-entry__icon" style="color:' + (color || "#8b98a8") + '">' + anyIcon(iconKey) + "</span>" +
      '<span class="log-entry__text" style="color:' + (color || "inherit") + '" title="' + safe + '">' +
        safe + "</span>";
    list.appendChild(li);
    while (list.children.length > LOG_LINES) list.firstChild.remove();
  };

  /* ================= Status chrome ================= */

  /* ---------------------------------------------------------------------------
   * Whose turn it is
   *
   * This used to be a small grey pill tucked into the top bar next to the room
   * code, which is the one place on screen nobody looks at while playing. It is
   * now the first row of the centre HUD: the seat token at full size, the name
   * at headline weight, a seat-coloured rail down the edge and, when the table
   * is waiting on you, a slow glow on the whole banner. You should be able to
   * tell whose move it is from the other side of the room.
   * ------------------------------------------------------------------------ */

  UI.setTurnChip = function (game) {
    const box = $("#hud-turn");
    if (!box || !game || !game.current) return;
    const p = game.current;
    const mine = UI.myTurn(game);
    const over = game.phase === "over";

    box.classList.toggle("is-mine", mine && !over);
    box.style.setProperty("--pc", p.color);
    box.style.setProperty("--pc-14", hexA(p.color, 0.14));
    box.style.setProperty("--pc-50", hexA(p.color, 0.5));
    box.style.setProperty("--pc-55", hexA(p.color, 0.55));

    const seat = $("#hud-turn-seat");
    const seatSig = p.id + "|" + p.color + "|" + p.tokenStyle;
    if (seat && seat.dataset.sig !== seatSig) {
      seat.dataset.sig = seatSig;
      seat.innerHTML = badge(p.color, p.tokenStyle);
    }

    const name = $("#hud-turn-name");
    if (name) name.textContent = over ? "Match over" : p.name;

    const sub = $("#hud-turn-sub");
    if (sub) {
      sub.textContent = over ? "final standings"
        : mine ? "your turn"
        : "their turn — waiting";
    }

    const round = $("#hud-round");
    if (round) {
      round.hidden = over;
      round.textContent = "R" + game.round +
        (game.config && game.config.maxRounds ? "/" + game.config.maxRounds : "");
    }

    // a soft cue the first time a turn becomes yours
    if (mine && !over && UI._turnCueFor !== p.id + ":" + game.round && game.phase === "awaiting-roll") {
      UI._turnCueFor = p.id + ":" + game.round;
      window.BT.sfx && window.BT.sfx.turn();
    }
  };

  UI.setStatusRaw = function (html) {
    $("#action-status").innerHTML = html;
  };

  UI.setStatus = function (game) {
    const el = $("#action-status");
    if (!el) return;
    const p = game.current;
    const me = UI.me(game);
    if (me && me.debtAmount > 0) {
      el.innerHTML = "You are <strong>&euro;" + me.debtAmount +
        "</strong> short — raise it or concede";
      return;
    }
    if (game.phase === "settling") {
      const debtor = game.players.find((x) => x.debtAmount > 0);
      el.innerHTML = debtor
        ? "Waiting for <strong>" + esc(debtor.name) + "</strong> to settle a debt&hellip;"
        : "Settling&hellip;";
      return;
    }
    if (UI.offerPending()) {
      el.innerHTML = game.doublesCount > 0
        ? "Buy it or skip &mdash; you roll again after this"
        : "Buy it, or just end your turn. The board is yours in the meantime.";
      return;
    }
    if (!UI.myTurn(game) && game.phase !== "over") {
      el.innerHTML = "Waiting for <strong>" + esc(p.name) + "</strong>&hellip;";
      return;
    }
    switch (game.phase) {
      case "awaiting-roll":
        el.innerHTML = "Roll the dice to move";
        break;
      case "awaiting-jail-roll":
        el.innerHTML = "In prison — roll for doubles to get out";
        break;
      case "busy":
        el.innerHTML = "<strong>" + esc(p.name) + "</strong> is on the move&hellip;";
        break;
      case "turn-end":
        el.innerHTML = "Build, trade, or end your turn";
        break;
      case "over":
        el.innerHTML = "Match over";
        break;
      default:
        el.innerHTML = "";
    }
  };

  UI.refreshButtons = function (game) {
    const phase = game.phase;
    const mine = UI.myTurn(game);
    const me = UI.me(game);
    const stuck = Boolean(me && me.debtAmount > 0);

    const roll = $("#btn-roll");
    roll.disabled = stuck || !mine || !(phase === "awaiting-roll" || phase === "awaiting-jail-roll");
    const label = $("#btn-roll-label");
    if (label) label.textContent = phase === "awaiting-jail-roll" ? "Roll Doubles" : "Roll Dice";

    /* An open offer keeps the engine in `busy`, but the turn is still yours and
     * walking away from a plot you decided not to buy should just be "end turn".
     * The exception is doubles: you owe the table another roll, so ending here
     * would be a lie. */
    const offer = UI.offerPending();
    const rollsAgain = offer && game.doublesCount > 0;
    $("#btn-end-turn").disabled =
      stuck || !mine || !(phase === "turn-end" || (offer && !rollsAgain));

    // Trading is not turn-locked: a deal is a conversation, and forcing everyone
    // to wait for their own turn to even open the composer killed half of them.
    $("#btn-trade").disabled =
      phase === "over" || !me || me.bankrupt ||
      game.players.filter((p) => !p.bankrupt).length < 2;

    // Building, mortgaging and selling live on the board itself now — click a
    // plot you own and the inspector carries its controls. There is no separate
    // sheet to enable a button for.
  };

  UI.showLastRoll = function (d1, d2) {
    const el = $("#last-roll");
    el.textContent = d1 + " + " + d2 + " = " + (d1 + d2) + (d1 === d2 ? "  ·  doubles" : "");
    el.classList.add("is-visible");
    clearTimeout(UI._rollTimer);
    UI._rollTimer = setTimeout(() => el.classList.remove("is-visible"), 3600);
  };

  /** One place to repaint everything from engine state. */
  UI.sync = function (game) {
    if (!game) return;
    UI.game = UI.game || game;
    UI.renderPlayers(game);
    UI.renderTiles(game);
    UI.setTurnChip(game);
    UI.setStatus(game);
    UI.refreshButtons(game);
    UI.refreshInspect(game);
    // a pending buy prompt re-checks affordability after any state change, so
    // mortgaging mid-prompt enables the Buy button without reopening anything
    if (UI._buyRefresh) UI._buyRefresh();
    if (UI._debtRefresh) UI._debtRefresh();
    UI.checkOwnDebt(game);
    UI._runDeferredEndTurn(game);
  };

  /* End Turn during an open offer means "no thanks, and I'm done". The engine
   * needs a beat to close the landing out first (and online that beat is a round
   * trip), so the intent is parked and spent the moment the turn is actually
   * endable. It is dropped rather than remembered if anything else came up —
   * doubles to re-roll, a debt to settle, or the turn moving on without us. */
  UI.endTurnHandler = null;

  UI._runDeferredEndTurn = function (game) {
    if (!UI._endWhenReady) return;
    if (!UI.myTurn(game) || game.phase === "settling" || game.phase === "over" ||
        game.phase === "awaiting-roll" || game.phase === "awaiting-jail-roll") {
      UI._endWhenReady = false;
      return;
    }
    if (game.phase !== "turn-end") return; // still resolving; wait for the next sync
    UI._endWhenReady = false;
    if (UI.endTurnHandler) UI.endTurnHandler();
  };

  UI.settleHandler = null;
  UI.bankruptHandler = null;

  /**
   * Online, the debt lives in synced state rather than in a prompt promise, so
   * each client raises its own settle window when the roster says it owes
   * something. That also means it survives a reload or a reconnect mid-debt.
   */
  UI.checkOwnDebt = function (game) {
    if (!window.BT.mpActive || !window.BT.myPlayerId) return;
    const mine = game.player(window.BT.myPlayerId);
    if (mine && mine.debtAmount > 0 && !UI._debtRefresh) UI.openDebt(game, mine);
  };

  /**
   * Re-resolve a player from the live engine by id.
   *
   * Guests rebuild their whole roster from each snapshot (`applySnapshot` maps
   * every player into a fresh object), so any UI that captured a player object
   * when a prompt opened is holding a corpse: its `cash` never moves again. That
   * is what made the settle prompt refuse to unlock — a player could sell half
   * their portfolio, watch their balance climb in the ledger, and still be told
   * they were short, with no way out but bankruptcy.
   */
  function liveOf(game, playerish) {
    const id = playerish && playerish.id;
    return (id && game && game.player(id)) || playerish;
  }

  /**
   * Mandatory settle prompt. Deliberately has no dismiss: the engine has
   * stopped in the `settling` phase and will not advance until this is
   * answered, so an escape hatch would just wedge the game.
   */
  UI.openDebt = function (game, playerRef) {
    UI._debtPlayerId = playerRef && playerRef.id;
    UI._debtPlayer = playerRef;
    const refresh = () => {
      // always work from the live roster, never the object this closed over
      const g = (window.BT.mp && window.BT.mp.game) || UI.game || window.BT.game || game;
      const player = liveOf(g, { id: UI._debtPlayerId }) || playerRef;
      UI._debtPlayer = player;
      const d = (player.bankrupt ? null : g.debtOf(player));
      if (!d) { // settled or conceded — the prompt has done its job
        UI._debtRefresh = null;
        closeModal("#modal-debt");
        return;
      }
      game = g;
      const short = d.amount - player.cash;
      $("#debt-amount").innerHTML = "\u20ac" + d.amount;
      $("#debt-who").textContent = d.to ? "owed to " + d.to.name : "owed to the bank";
      $("#debt-note").textContent = short > 0
        ? "\u20ac" + player.cash + " in hand \u00b7 \u20ac" + short + " short \u00b7 \u20ac"
          + game.raisableCash(player) + " still raisable"
        : "\u20ac" + player.cash + " in hand \u2014 enough to settle";
      $("#btn-debt-pay").disabled = short > 0;
      UI.renderRaiseList(game, "#debt-raise-list");
    };
    refresh();
    UI._debtRefresh = refresh;
    openModal("#modal-debt");
    $("#btn-debt-pay").onclick = () => UI.settleHandler && UI.settleHandler();
    $("#btn-debt-bankrupt").onclick = () => UI.bankruptHandler && UI.bankruptHandler();
  };
  /* ================= Modals (Promise-based) ================= */

  function openModal(id, silent) {
    $(id).hidden = false;
    if (!silent && window.BT.sfx) window.BT.sfx.open();
  }

  function closeModal(id, silent) {
    $(id).hidden = true;
    if (!silent && window.BT.sfx) window.BT.sfx.close();
  }

  /** The modal currently on top, if any. */
  function topModal() {
    const open = [...document.querySelectorAll(".modal-overlay")].filter((m) => !m.hidden);
    return open.length ? open[open.length - 1] : null;
  }

  /* Enter takes the primary action, Escape the safe one — so a whole turn can
   * be played without reaching for the mouse. */
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const modal = topModal();
    if (!modal) return;
    if (e.key === "Enter") {
      const primary = modal.querySelector(".btn-primary:not(:disabled)");
      if (primary) { e.preventDefault(); primary.click(); }
    } else if (e.key === "Escape") {
      const secondary = [...modal.querySelectorAll(".btn:not(.btn-primary):not(:disabled)")][0];
      if (secondary) { e.preventDefault(); secondary.click(); }
    }
  });

  UI.hydrateIcons = function (root) {
    (root || document).querySelectorAll("[data-icon]").forEach((el) => {
      el.innerHTML = icon(el.dataset.icon);
    });
  };

  /* ---------------------------------------------------------------------------
   * The property offer
   *
   * Landing on an unowned plot used to open a modal carrying Buy and Skip. The
   * overlay covered the board, which is the one thing you need in order to do
   * anything about being short of the asking price — so if the cash was not
   * already in hand, Skip was the only move available, and the prompt sat there
   * demanding an answer before you could sell or mortgage a single deed.
   *
   * It is a bar in the middle of the table now. Nothing is blocked: the board
   * stays live, tiles stay clickable, the assets sheet opens over the top, and
   * the offer is still sitting there when you come back with the money. Buy
   * enables itself the moment you can afford it. Ending your turn is treated as
   * declining, so you are never forced to click Skip.
   * ------------------------------------------------------------------------ */

  /** Tile id the open offer refers to, so the deed card can join in. */
  UI.offerTileId = null;

  UI.promptBuy = function (player, tile, price) {
    return new Promise((resolve) => {
      const box = $("#hud-offer");
      const isCity = tile.kind === "city";
      UI.offerTileId = tile.id;

      const flag = $("#offer-flag");
      if (isCity) {
        flag.style.cssText = flagBg(tile.country);
        flag.innerHTML = "";
      } else {
        flag.style.cssText = "background:linear-gradient(150deg," + kindColor(tile) + ",#12171f)";
        flag.innerHTML = icon(
          tile.kind === "airport" ? "plane" : tile.id === "balkan-electric" ? "zap" : "bottle");
      }

      $("#offer-name").textContent = tile.name;
      $("#offer-price").innerHTML = "&euro;" + price;

      const detail = isCity
        ? COUNTRIES[tile.country].name + " \u00b7 base rent \u20ac" + tile.baseRent +
          " \u00b7 house \u20ac" + tile.houseCost
        : tile.kind === "airport"
          ? "Transport \u00b7 rent 25 / 50 / 100 / 200 by airports owned"
          : "Utility \u00b7 rent 4\u00d7 the dice, 10\u00d7 with both";

      const buyBtn = $("#btn-offer-buy");
      const refresh = () => {
        const g = (window.BT.mp && window.BT.mp.game) || UI.game || window.BT.game;
        const live = (g && g.player(player.id)) || player;
        const cash = live.cash;
        const short = price - cash;
        const afford = short <= 0;
        buyBtn.disabled = !afford;
        buyBtn.innerHTML = "Buy \u20ac" + price;
        box.classList.toggle("is-short", !afford);
        $("#offer-sub").textContent = afford
          ? detail + " \u00b7 \u20ac" + (cash - price) + " left after buying"
          : "\u20ac" + short + " short \u2014 click a plot you own to mortgage or sell it";
      };
      refresh();
      UI._buyRefresh = refresh;

      box.hidden = false;
      window.BT.sfx && window.BT.sfx.open();

      /* The engine's last repaint happened before this offer existed, so the
       * status line still said "roll the dice" and End Turn was still locked.
       * Nothing else is going to call sync until the offer is answered. */
      const liveGame = () => (window.BT.mp && window.BT.mp.game) || UI.game || window.BT.game;

      const done = (wants) => {
        if (UI._buyResolve !== done) return; // already answered
        UI._buyResolve = null;
        UI._buyRefresh = null;
        UI.offerTileId = null;
        box.hidden = true;
        box.classList.remove("is-short");
        const g = liveGame();
        if (g) { UI.setStatus(g); UI.refreshButtons(g); }
        UI.refreshInspect();
        resolve(wants);
      };
      UI._buyResolve = done;

      const g0 = liveGame();
      if (g0) { UI.setStatus(g0); UI.refreshButtons(g0); }

      buyBtn.onclick = () => done(true);
      $("#btn-offer-skip").onclick = () => done(false);
      // the plot is on the table: point the inspector at it so its own Buy
      // button and rent ladder are one glance away
      if (window.BT.Deed) window.BT.Deed.show(tile.id);
    });
  };

  /** Is a purchase offer waiting on this client? */
  UI.offerPending = function () { return Boolean(UI._buyResolve); };

  /**
   * Answer an open offer with "no thanks".
   * @param {boolean} andEndTurn also finish the turn once the engine allows it
   * @returns {boolean} whether there was an offer to answer
   */
  UI.declineOffer = function (andEndTurn) {
    const done = UI._buyResolve;
    if (!done) return false;
    if (andEndTurn) UI._endWhenReady = true;
    done(false);
    return true;
  };

  /** Buy from outside the offer bar (the deed card in the inspector). */
  UI.acceptOffer = function () {
    const done = UI._buyResolve;
    if (!done || $("#btn-offer-buy").disabled) return false;
    done(true);
    return true;
  };

  /** Glassmorphism Balkan Surprise / Kafana Event card. `view` is a
   * JSON-safe snapshot: {key,title,text,tint,choices?,forId?}.
   * Resolves with the chosen choice id (or undefined for plain OK cards). */
  UI.showCard = function (view) {
    return new Promise((resolve) => {
      const tint = view.tint || "#b48cf2";
      const fx = $("#card-fx");
      fx.style.setProperty("--card-tint", tint);
      $("#card-icon").innerHTML = anyIcon(view.key);
      $("#card-deck").textContent = view.deckLabel || "Balkan Surprise";
      $("#card-title").textContent = view.title;
      $("#card-text").textContent = view.text;

      const box = $("#card-choices");
      box.innerHTML = "";
      const finish = (val) => { closeModal("#modal-card"); resolve(val); };
      const choices = view.choices && view.choices.length ? view.choices : null;
      if (choices) {
        for (const ch of choices) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn" + (ch.id === choices[choices.length - 1].id ? " btn-primary" : "");
          b.textContent = ch.label;
          b.disabled = Boolean(ch.disabled);
          b.onclick = () => finish(ch.id);
          box.appendChild(b);
        }
      } else {
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "btn btn-primary";
        ok.id = "btn-card-ok";
        ok.textContent = "OK";
        ok.onclick = () => finish(undefined);
        box.appendChild(ok);
      }

      openModal("#modal-card", true); // the card has its own paper-slide sound
      window.BT.sfx && window.BT.sfx.card();
    });
  };

  /* ---------- property auction (house rule) ---------- */

  /** One bidding decision. `ctx` = {tile, highBid, highBidderName, minBid,
   * player:{name,cash}, canRaise}. Resolves {bid} or {pass:true}. */
  UI.auctionStep = function (ctx) {
    return new Promise((resolve) => {
      const tile = (typeof tileById === "function" && tileById(ctx.tile.id)) || ctx.tile;
      if (tile.kind === "city") {
        const c = COUNTRIES[tile.country];
        $("#auc-colorbar").style.cssText = window.BT.flagBg(tile.country);
        $("#auc-colorbar").classList.add("has-name");
        $("#auc-colorbar").innerHTML = "<span>" + c.name + "</span>";
      } else {
        $("#auc-colorbar").style.cssText =
          tile.kind === "airport"
            ? "background:linear-gradient(150deg,#2c4a60,#1b2f40)"
            : "background:linear-gradient(150deg,#4a4a24,#2e2e16)";
        $("#auc-colorbar").innerHTML = icon(tile.kind === "airport" ? "plane" : "bottle");
        $("#auc-colorbar").classList.remove("has-name");
      }
      $("#auc-name").textContent = tile.name;
      $("#auc-price").innerHTML = "&euro;" + ctx.tile.price;
      $("#auc-high").innerHTML = ctx.highBid > 0 ? "&euro;" + ctx.highBid : "&mdash;";
      $("#auc-leader").textContent = ctx.highBidderName || "\u2014";
      $("#auc-note").innerHTML =
        "<strong>" + ctx.player.name + "</strong>, your move &middot; cash <strong>&euro;" +
        ctx.player.cash + "</strong> &middot; minimum bid &euro;" + ctx.minBid;
      const input = $("#auc-bid");
      input.max = ctx.player.cash;
      input.value = Math.min(ctx.canRaise ? ctx.minBid : 0, ctx.player.cash);
      input.disabled = !ctx.canRaise;

      const bidBtn = $("#btn-auc-bid");
      bidBtn.disabled = !ctx.canRaise;
      const done = (val) => { closeModal("#modal-auction"); resolve(val); };
      bidBtn.onclick = () => {
        const v = Math.floor(Number(input.value) || 0);
        if (v < ctx.minBid || v > ctx.player.cash) return;
        done({ bid: v });
      };
      $("#btn-auc-pass").onclick = () => done({ pass: true });

      document.querySelectorAll("#auc-steppers .step-btn").forEach((b) => {
        b.onclick = () => {
          if (!ctx.canRaise) return;
          input.value = Math.min(ctx.player.cash,
            Math.max(ctx.minBid, (Math.floor(Number(input.value) || 0)) + Number(b.dataset.add)));
        };
      });

      openModal("#modal-auction");
    });
  };

  UI.jailChoice = function (player) {
    return new Promise((resolve) => {
      const g = (window.BT.mp && window.BT.mp.game) || UI.game || window.BT.game;
      const bail = g && g.config ? g.config.jailFee : ECONOMY.jailFee;
      $("#jail-note").textContent =
        player.name + " is in prison (attempt " + (player.jailTurns + 1) + " of 3). " +
        "Roll doubles, pay \u20ac" + bail + " bail" +
        (player.getOutCards > 0 ? " or use your card" : "") + ".";
      const pay = $("#btn-jail-pay");
      pay.textContent = bail > 0 ? "Pay \u20ac" + bail + " bail" : "Walk out free";
      pay.disabled = player.cash < bail;
      $("#btn-jail-card").hidden = player.getOutCards < 1;
      openModal("#modal-jail");
      const done = (choice) => { closeModal("#modal-jail"); resolve(choice); };
      $("#btn-jail-roll").onclick = () => done("roll");
      $("#btn-jail-pay").onclick = () => done("pay");
      $("#btn-jail-card").onclick = () => done("card");
    });
  };
  /* Build/sell handlers are injected by main.js (local) or mp.js (network). */
  UI.buildHandler = null;
  UI.sellHandler = null;

  UI.mortgageHandler = null;
  UI.unmortgageHandler = null;
  UI.sellFieldHandler = null;

  /** Re-render the docked property inspector (deed.js owns the markup). */
  UI.refreshInspect = function () {
    if (window.BT.Deed) window.BT.Deed.refresh();
  };

  /* ---------------------------------------------------------------------------
   * "Raise cash" list
   *
   * Inlined into the two prompts that a shortfall can block: the buy prompt and
   * the settle-debt prompt. Nothing is ever sold on a player's behalf, so every
   * prompt that can be blocked by a lack of money has to carry the means to fix
   * it — otherwise "you are €40 short" is a dead end and the only way out is
   * bankruptcy.
   * ------------------------------------------------------------------------ */

  UI.renderRaiseList = function (game, listSel) {
    const list = $(listSel);
    if (!list) return 0;
    const p = UI.me(game);
    list.innerHTML = "";
    if (!p) return 0;
    const owned = game.ownedTiles(p);
    if (!owned.length) {
      list.innerHTML = '<p class="raise-none">You hold no deeds to raise cash against.</p>';
      return 0;
    }

    let actionable = 0;
    /* Only ever offers actions that RAISE money. Buying a deed back deliberately
     * has no place here: it costs cash, and having it sit next to "mortgage" in a
     * panel headed "raise cash" turned the two into a toggle you could bounce
     * between while getting steadily poorer. It lives in the property inspector,
     * where spending is the point. */
    const mini = (act, tileId, label, ic, enabled, title) => {
      const b = document.createElement("button");
      b.className = "build-row__btn";
      b.innerHTML = window.BT.icon(ic, "ic-btn") + label;
      b.title = title;
      b.disabled = !enabled;
      if (enabled) {
        actionable += 1;
        b.onclick = () => {
          const map = {
            sell: UI.sellHandler,
            mortgage: UI.mortgageHandler,
            "sell-field": UI.sellFieldHandler,
          };
          const fn = map[act];
          if (typeof fn === "function") fn(tileId);
        };
      }
      return b;
    };

    const eur = (n) => "\u20ac" + n;
    for (const t of owned) {
      const ps = game.props[t.id];
      const row = document.createElement("div");
      row.className = "raise-row";
      const swatch = t.kind === "city" ? COUNTRIES[t.country].color : kindColor(t);
      row.innerHTML =
        '<span class="raise-row__c" style="background:' + swatch + '"></span>' +
        '<span class="raise-row__n">' + esc(t.name) +
          "<small>" + (ps.mortgaged ? "mortgaged \u2014 nothing left to raise" :
            ps.houses >= ECONOMY.maxHouses ? "hotel" :
            ps.houses ? ps.houses + (ps.houses > 1 ? " houses" : " house") : "undeveloped") +
          "</small></span>";
      const acts = document.createElement("span");
      acts.className = "raise-row__acts";
      // only offer to sell a house where a house actually stands: a greyed-out
      // "+€15" against an empty plot reads as a broken button, not a rule
      if (t.kind === "city" && (ps.houses || 0) > 0) {
        const gain = Math.round(t.houseCost * ECONOMY.sellRate);
        acts.appendChild(mini("sell", t.id, "House +" + eur(gain), "minus",
          game.canSellOn(p, t), "Sell a house back to the bank for " + eur(gain)));
      }
      if (game.rules.mortgages && !ps.mortgaged) {
        const gain = Math.round(t.price * ECONOMY.mortgageRate);
        acts.appendChild(mini("mortgage", t.id, "Hock +" + eur(gain), "banknote",
          game.canMortgage(p, t),
          "Mortgage the deed for " + eur(gain) + " — you keep the plot, it earns nothing"));
      }
      const sale = Math.round(t.price * ECONOMY.sellRate);
      acts.appendChild(mini("sell-field", t.id, "Sell +" + eur(sale), "coins",
        game.canSellField(p, t),
        "Sell the deed back to the bank for " + eur(sale) + " — you lose the plot"));
      row.appendChild(acts);
      list.appendChild(row);
    }
    return actionable;
  };

  UI.showGameOver = function (winner, reason) {
    $("#gameover-title").textContent = winner ? winner.name + " wins!" : "Game over";
    $("#gameover-text").textContent = winner
      ? reason + " — final net worth \u20ac" + (UI.game ? UI.game.netWorth(winner) : "?") + "."
      : reason;
    openModal("#modal-gameover");
  };
  /* ================= Multiplayer: lobby / timer / trade ================= */

  /** The joinable URL for a room code, safe to paste anywhere. */
  UI.inviteUrl = function (code) {
    if (!code) return "";
    return location.origin + location.pathname + "?room=" + encodeURIComponent(code);
  };

  /**
   * Room chip in the top bar. Copies the full invite LINK, not just the code —
   * telling a friend to open a site and type five characters is a step nobody
   * should have to relay over voice chat.
   */
  UI.setRoomChip = function (code) {
    const chip = $("#invite-chip");
    if (!chip) return;
    if (!code) { chip.hidden = true; delete chip.dataset.code; return; }
    chip.hidden = false;
    chip.dataset.code = code;
    chip.classList.remove("is-reconnecting");
    const codeEl = $("#invite-code");
    if (codeEl) codeEl.textContent = code;
    chip.title = "Copy the invite link for room " + code;
    chip.onclick = () => {
      const url = UI.inviteUrl(code);
      const done = () => {
        chip.classList.add("is-copied");
        const hint = chip.querySelector(".invite-chip__hint");
        if (hint) hint.textContent = "link copied";
        setTimeout(() => {
          chip.classList.remove("is-copied");
          if (hint) hint.textContent = "copy invite";
        }, 1400);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
      else done();
    };
  };

  /** Transport state: flips the room chip into a "reconnecting" pill. */
  UI.setConnState = function (online) {
    const chip = $("#invite-chip");
    if (!chip) return;
    const hint = chip.querySelector(".invite-chip__hint");
    if (online) {
      chip.classList.remove("is-reconnecting");
      if (hint) hint.textContent = "copy invite";
      return;
    }
    if (!chip.dataset.code) return;
    chip.hidden = false;
    chip.classList.add("is-reconnecting");
    if (hint) hint.textContent = "reconnecting\u2026";
  };

  /**
   * Turn clock. Also drives the thin fill along the active ledger row, so you
   * can read the remaining time without looking away from the players.
   * @param {number|null} seconds remaining, null hides the clock
   * @param {number} [total] configured turn length, for the row fill
   */
  UI.setTurnTimer = function (seconds, total) {
    const el = $("#turn-timer");
    if (seconds == null) {
      el.hidden = true;
      UI.setRowClock(null, null);
      UI._lastWarn = null;
      return;
    }
    el.hidden = false;
    $("#timer-value").textContent = seconds;
    const low = seconds <= 10;
    el.classList.toggle("is-low", low);

    const g = (window.BT.mp && window.BT.mp.game) || UI.game || window.BT.game;
    if (g && total > 0) UI.setRowClock(g.current.id, seconds / total);

    // one tick at 10s and one at 5s, only for the player on the clock
    const mine = g && (!window.BT.myPlayerId || window.BT.myPlayerId === g.current.id);
    if (mine && (seconds === 10 || seconds === 5) && UI._lastWarn !== seconds) {
      UI._lastWarn = seconds;
      window.BT.sfx && window.BT.sfx.warn();
    }
    if (seconds > 10) UI._lastWarn = null;
  };

  /* ---------- trade composer: balances + money sliders ---------- */

  /* ---------------------------------------------------------------------------
   * Trade composer
   *
   * Two changes worth knowing about:
   *
   *   - The "trade with" control is no longer a native <select>. A native
   *     dropdown draws its popup with the platform palette, so our near-white
   *     text landed on the UA's white popup and every name was invisible. It is
   *     now a row of seat-coloured chips carrying the token and the balance,
   *     which cannot be restyled out from under us and reads better anyway.
   *   - Every listener is assigned with .onX rather than addEventListener. The
   *     old version added a fresh set on every open, so by the fourth trade of a
   *     match each keystroke ran four handlers and the sliders fought them.
   * ------------------------------------------------------------------------ */

  UI.openTrade = function (game, myId, opts) {
    const me = game.player(myId);
    const others = game.players.filter((p) => p.id !== myId && !p.bankrupt);
    if (!me || !others.length) return;
    const prefill = opts.prefill || {};

    let toId = others.some((p) => p.id === opts.prefillTo) ? opts.prefillTo : others[0].id;
    const target = () => game.player(toId);

    const giveCash = $("#trade-give-cash");
    const wantCash = $("#trade-want-cash");
    const giveSlider = $("#trade-give-slider");
    const wantSlider = $("#trade-want-slider");
    const warn = $("#trade-warn");
    giveCash.value = prefill.giveCash || 0;
    wantCash.value = prefill.wantCash || 0;

    const giveSet = new Set(prefill.giveTiles || []);
    const wantSet = new Set(prefill.wantTiles || []);
    const filters = { give: "", want: "" };

    const tokenOf = (p) => badge(
      p.color,
      Number.isFinite(p.tokenStyle) ? p.tokenStyle : window.BT.Tokens.hashStyle(p.name || "?"),
    );

    /* --- the party picker --- */
    const renderPicker = () => {
      const box = $("#trade-target-pick");
      if (!box) return;
      box.innerHTML = "";
      for (const p of others) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "party-opt" + (p.id === toId ? " is-active" : "");
        b.style.setProperty("--po", p.color);
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", p.id === toId ? "true" : "false");
        b.innerHTML = tokenOf(p) + "<span>" + esc(p.name) + "</span><em>\u20ac" + p.cash + "</em>";
        b.onclick = () => {
          if (toId === p.id) return;
          toId = p.id;
          wantCash.value = 0;
          wantSet.clear();
          renderPicker();
          syncHeads();
          renderColumns();
          validate();
        };
        box.appendChild(b);
      }
    };

    const syncHeads = () => {
      const t = target();
      giveCash.max = me.cash;
      giveSlider.max = me.cash;
      giveSlider.value = Math.min(Number(giveCash.value) || 0, me.cash);
      const theirMax = t ? t.cash : 0;
      wantCash.max = theirMax;
      wantSlider.max = theirMax;
      wantSlider.value = Math.min(Number(wantCash.value) || 0, theirMax);
      const tok = $("#trade-me-token");
      if (tok) tok.innerHTML = tokenOf(me);
      $("#trade-me-name").textContent = me.name;
      $("#trade-me-cash").innerHTML = "&euro;" + me.cash;
    };

    /** Quick-cash steppers: +10 / +50 / +100 / Max, clamped to balance. */
    const wireSteppers = (which) => {
      const row = document.querySelector('.stepper-row[data-stepper-for="' + which + '"]');
      if (!row) return;
      const input = which === "give" ? giveCash : wantCash;
      const slider = which === "give" ? giveSlider : wantSlider;
      const cap = () => (which === "give" ? me.cash : (target() || { cash: 0 }).cash);
      row.querySelectorAll(".step-btn").forEach((b) => {
        b.onclick = () => {
          const cur = Math.floor(Number(input.value) || 0);
          input.value = b.hasAttribute("data-max")
            ? cap()
            : Math.min(cap(), cur + Number(b.dataset.add));
          slider.value = Math.min(Number(input.value), Number(slider.max) || 0);
          validate();
        };
      });
    };

    const propRow = (tile, set) => {
      const isCity = tile.kind === "city";
      const ps = game.props[tile.id];
      const lead = isCity
        ? '<i class="tp-flag" style="' + flagBg(tile.country) + '"></i>'
        : '<i class="tp-dot" style="background:' + kindColor(tile) + '"></i>';
      const tag = '<em class="tp-tag" style="background:' + kindColor(tile) + '"></em>';
      const row = document.createElement("div");
      row.className = "trade-prop" + (set.has(tile.id) ? " is-selected" : "");
      row.dataset.name = tile.name.toLowerCase();
      row.innerHTML =
        lead + "<span>" + esc(tile.name) + (ps.mortgaged ? " (mortgaged)" : "") + "</span>" + tag +
        (set.has(tile.id) ? icon("check", "ic-pick") : "") +
        '<span class="trade-prop__price">&euro;' + tile.price + "</span>";
      row.onclick = () => {
        if (set.has(tile.id)) set.delete(tile.id); else set.add(tile.id);
        row.classList.toggle("is-selected", set.has(tile.id));
        const pick = row.querySelector(".ic-pick");
        if (pick) pick.remove();
        if (set.has(tile.id)) row.insertAdjacentHTML("beforeend", icon("check", "ic-pick"));
        validate();
      };
      return row;
    };

    const renderColumns = () => {
      const t = target();
      const giveBox = $("#trade-give-props");
      const wantBox = $("#trade-want-props");
      giveBox.innerHTML = "";
      wantBox.innerHTML = "";
      // a developed plot cannot change hands: sell the houses down first
      const tradable = (p) => game.ownedTiles(p).filter((x) => game.props[x.id].houses === 0);
      const mine = tradable(me).filter((x) => x.name.toLowerCase().includes(filters.give));
      const theirs = t ? tradable(t).filter((x) => x.name.toLowerCase().includes(filters.want)) : [];
      if (!mine.length) giveBox.innerHTML = '<p class="trade-none">Nothing tradable (sell houses first)</p>';
      if (!theirs.length) wantBox.innerHTML = '<p class="trade-none">Nothing tradable</p>';
      for (const x of mine) giveBox.appendChild(propRow(x, giveSet));
      for (const x of theirs) wantBox.appendChild(propRow(x, wantSet));
    };

    /** Read the composer, clamped. */
    const readTrade = () => {
      const t = target();
      return {
        to: toId,
        giveCash: Math.min(Math.max(0, Math.floor(Number(giveCash.value) || 0)), me.cash),
        wantCash: Math.min(Math.max(0, Math.floor(Number(wantCash.value) || 0)), t ? t.cash : 0),
        giveTiles: [...giveSet],
        wantTiles: [...wantSet],
      };
    };

    /** Say up front why an offer cannot be sent instead of silently ignoring it. */
    const validate = () => {
      const trade = readTrade();
      const empty = !trade.giveCash && !trade.wantCash &&
        !trade.giveTiles.length && !trade.wantTiles.length;
      let msg = "";
      if (empty) msg = "Put something on the table first.";
      else if (!game.validateTrade({ ...trade, from: myId })) msg = "That offer is not legal any more — balances or deeds changed.";
      if (warn) { warn.hidden = !msg; warn.textContent = msg; }
      $("#btn-trade-send").disabled = Boolean(msg);
      return !msg;
    };

    // two-way money binding: number input <-> slider, clamped to balance
    giveCash.oninput = () => {
      giveCash.value = Math.min(Math.max(0, Math.floor(Number(giveCash.value) || 0)), me.cash);
      giveSlider.value = giveCash.value;
      validate();
    };
    giveSlider.oninput = () => { giveCash.value = giveSlider.value; validate(); };
    wantCash.oninput = () => {
      const t = target();
      wantCash.value = Math.min(Math.max(0, Math.floor(Number(wantCash.value) || 0)), t ? t.cash : 0);
      wantSlider.value = wantCash.value;
      validate();
    };
    wantSlider.oninput = () => { wantCash.value = wantSlider.value; validate(); };

    const giveFilter = $("#trade-give-filter");
    const wantFilter = $("#trade-want-filter");
    giveFilter.value = "";
    wantFilter.value = "";
    giveFilter.oninput = (e) => { filters.give = e.target.value.trim().toLowerCase(); renderColumns(); };
    wantFilter.oninput = (e) => { filters.want = e.target.value.trim().toLowerCase(); renderColumns(); };

    renderPicker();
    syncHeads();
    renderColumns();
    wireSteppers("give");
    wireSteppers("want");
    validate();
    openModal("#modal-trade");
    $("#btn-trade-cancel").onclick = () => closeModal("#modal-trade");
    $("#btn-trade-send").onclick = () => {
      if (!validate()) return;
      closeModal("#modal-trade");
      opts.onSend(readTrade());
    };
  };

  /* ================= Incoming trades: left-side dock ================= */

  /* Offers arrive as cards in a fixed column on the left edge, newest on top.
   * Each card slides in from off-screen (300ms ease-out), lists what you get
   * and what you give with a tag per item, and previews both inventories on
   * hover so you can see exactly what is changing hands. */

  const ASSET_TAGS = {
    city: { label: "City", icon: "building" },
    airport: { label: "Airport", icon: "plane" },
    utility: { label: "Power", icon: "zap" },
    cash: { label: "Cash", icon: "coins" },
  };

  let tradeSeq = 0;

  const tradeDock = () => $("#trade-dock");

  /**
   * The left column only takes up space when it has something in it. Because it
   * is a real flex column rather than a floating overlay, an empty one would sit
   * there pushing the board sideways for no reason.
   */
  UI.syncDock = function () {
    const dock = $("#left-dock");
    if (!dock) return;
    const cards = tradeDock() ? tradeDock().children.length : 0;
    const slog = $("#session-log");
    const hasLog = slog && !slog.hidden;
    dock.classList.toggle("is-empty", cards === 0 && !hasLog);
    // the board is sized from its container, so it has to re-measure
    if (UI.measureCells) requestAnimationFrame(() => UI.measureCells());
  };

  function assetTag(kind) {
    const t = ASSET_TAGS[kind] || ASSET_TAGS.city;
    return '<em class="tc-tag tc-tag--' + kind + '">' + icon(t.icon, "ic-tag") + t.label + "</em>";
  }

  /** One row inside a "you receive" / "you give" column. */
  function tradeItemRow(tile) {
    const lead = tile.kind === "city"
      ? '<i class="tc-flag" style="' + flagBg(tile.country) + '"></i>'
      : '<i class="tc-dot" style="background:' + kindColor(tile) + '"></i>';
    return '<li class="tc-item" data-tile="' + esc(tile.id) + '">' +
      lead + '<span class="tc-name">' + esc(tile.name) + "</span>" +
      assetTag(tile.kind) + "</li>";
  }

  function cashItemRow(amount) {
    return '<li class="tc-item tc-item--cash">' +
      '<i class="tc-dot tc-dot--cash">' + icon("coins", "ic-coin") + "</i>" +
      '<span class="tc-name">&euro;' + amount + "</span>" +
      assetTag("cash") + "</li>";
  }

  function tradeColumn(kind, title, cash, tileIds) {
    const tiles = (tileIds || []).map((id) => tileById(id)).filter(Boolean);
    const rows = (cash > 0 ? cashItemRow(cash) : "") + tiles.map(tradeItemRow).join("");
    return '<section class="tc-col tc-col--' + kind + '">' +
      '<h4 class="tc-col__title">' + title +
        '<b class="tc-col__n">' + (tiles.length + (cash > 0 ? 1 : 0)) + "</b></h4>" +
      '<ul class="tc-items">' + (rows || '<li class="tc-item tc-item--none">nothing</li>') + "</ul>" +
      "</section>";
  }

  /** Inventory grid for one side of the deal, traded rows highlighted. */
  function invGrid(game, player, markIds, mark) {
    if (!player) return "";
    const marked = new Set(markIds || []);
    const cells = game.ownedTiles(player).map((t) => {
      const lead = t.kind === "city"
        ? '<i class="tc-flag" style="' + flagBg(t.country) + '"></i>'
        : '<i class="tc-dot" style="background:' + kindColor(t) + '"></i>';
      const h = game.props[t.id].houses || 0;
      const pips = h >= ECONOMY.maxHouses
        ? icon("houseSolid", "ic-inv ic-inv--hotel")
        : Array.from({ length: h }, () => icon("houseSolid", "ic-inv ic-inv--house")).join("");
      return '<span class="inv-cell' + (marked.has(t.id) ? " is-" + mark : "") + '">' +
        lead + esc(t.name) + pips + "</span>";
    });
    return '<div class="tc-inv__block">' +
      '<div class="tc-inv__head">' + esc(player.name) +
        '<b>&euro;' + player.cash + "</b></div>" +
      '<div class="tc-inv__grid">' +
        (cells.length ? cells.join("") : '<span class="inv-cell is-empty">no property</span>') +
      "</div></div>";
  }

  /**
   * Show a trade offer as a dock card.
   *
   * Every seat at the table gets one. A deal reshapes the board for everybody,
   * so an offer that only two people could see meant the rest of the table
   * discovered a monopoly had been assembled after the fact. The two parties get
   * buttons — the target can accept, decline or counter, the sender can withdraw
   * — and everyone else gets the same card with a "watching" line instead.
   *
   * @param {object} game engine (or hydrated view)
   * @param {object} trade { giveCash, giveTiles, wantCash, wantTiles, from?, to? }
   * @param {string} fromName sender display name
   * @param {{onAccept?:Function, onDecline?:Function, onCounter?:Function, onWithdraw?:Function}} handlers
   * @param {{fromId?:string, toId?:string, tradeId?:string, role?:"target"|"sender"|"watch"}} [meta]
   * @returns {string} card id (pass to UI.dismissTrade)
   */
  UI.incomingTrade = function (game, trade, fromName, handlers, meta) {
    const dock = tradeDock();
    if (!dock) return "";
    const m = meta || {};
    const id = m.tradeId || ("tc" + ++tradeSeq);
    if (dock.querySelector('[data-trade-id="' + id + '"]')) return id; // idempotent
    const fromId = m.fromId || trade.from || null;
    const toId = m.toId || trade.to || null;
    const role = m.role || "target";
    const sender = fromId && game ? game.player(fromId) : null;
    const receiver = toId && game ? game.player(toId) : null;
    const me = game ? game.player(UI.localPlayerId(game)) : null;

    const card = document.createElement("article");
    card.className = "trade-card" + (role === "watch" ? " is-spectator" : "");
    card.dataset.tradeId = id;
    if (fromId) card.dataset.fromId = fromId;
    if (toId) card.dataset.toId = toId;
    const tint = sender || receiver;
    if (tint) {
      card.style.setProperty("--pc", tint.color);
      card.style.setProperty("--pc-45", hexA(tint.color, 0.45));
    }

    /* Column headings are written from the reader's point of view, which is not
     * the same sentence for all three roles. */
    const headline =
      role === "target" ? "<b>" + esc(fromName) + "</b> sends you:"
        : role === "sender" ? "You offered <b>" + esc(receiver ? receiver.name : "them") + "</b>:"
        : "<b>" + esc(fromName) + "</b> &rarr; <b>" + esc(receiver ? receiver.name : "?") + "</b>";

    const getTitle = role === "target" ? "You receive" : (receiver ? esc(receiver.name) + " gets" : "They get");
    const giveTitle = role === "target" ? "You give" : (sender ? esc(sender.name) + " gets" : "They give");

    let footer;
    if (role === "target") {
      footer =
        '<footer class="tc-actions">' +
          '<button class="tc-btn tc-btn--ok" type="button" data-act="accept">' +
            icon("check", "ic-tag") + "Accept</button>" +
          (handlers.onCounter
            ? '<button class="tc-btn tc-btn--alt" type="button" data-act="counter" title="Counter-offer">' +
              icon("exchange", "ic-tag") + "</button>"
            : "") +
          '<button class="tc-btn tc-btn--no" type="button" data-act="decline">' +
            icon("x", "ic-tag") + "Decline</button>" +
        "</footer>";
    } else if (role === "sender") {
      footer =
        '<footer class="tc-actions">' +
          '<button class="tc-btn tc-btn--no" type="button" data-act="withdraw">' +
            icon("trash", "ic-tag") + "Withdraw offer</button>" +
        "</footer>";
    } else {
      footer = '<div class="tc-watch">' + icon("eye") + "waiting on " +
        esc(receiver ? receiver.name : "them") + "</div>";
    }

    card.innerHTML =
      '<header class="tc-head">' +
        (sender ? badge(sender.color, sender.tokenStyle, "tc-avatar") : icon("users", "tc-avatar-ic")) +
        '<span class="tc-from">' + headline + "</span>" +
        (role === "target" ? '<span class="tc-me">FOR YOU</span>' : "") +
        '<span class="tc-badge">' + icon("exchange", "ic-tag") + "Trade</span>" +
      "</header>" +
      '<div class="tc-cols">' +
        tradeColumn("get", getTitle, trade.giveCash, trade.giveTiles) +
        tradeColumn("give", giveTitle, trade.wantCash, trade.wantTiles) +
      "</div>" +
      footer +
      '<div class="tc-inv" hidden>' +
        invGrid(game, sender, trade.giveTiles, "get") +
        invGrid(game, role === "target" ? me : receiver, trade.wantTiles, "give") +
      "</div>";

    dock.prepend(card);
    // slide in from the left on the next frame so the transition actually runs
    requestAnimationFrame(() => card.classList.add("is-in"));

    /* hover anywhere over the items reveals both inventories */
    const inv = card.querySelector(".tc-inv");
    const showInv = () => { inv.hidden = false; requestAnimationFrame(() => inv.classList.add("is-in")); };
    const hideInv = () => { inv.classList.remove("is-in"); inv.hidden = true; };
    card.querySelectorAll(".tc-items").forEach((box) => {
      box.addEventListener("mouseenter", showInv);
      box.addEventListener("focusin", showInv);
    });
    card.addEventListener("mouseleave", hideInv);

    const finish = (fn, sound) => {
      if (card.dataset.done) return;
      card.dataset.done = "1";
      if (sound && window.BT.sfx && window.BT.sfx[sound]) window.BT.sfx[sound]();
      closeTradeCard(card);
      if (typeof fn === "function") fn();
    };

    const wire = (act, fn, sound) => {
      const b = card.querySelector('[data-act="' + act + '"]');
      if (b) b.onclick = () => finish(fn, sound);
    };
    wire("accept", handlers.onAccept, "deal");
    wire("decline", handlers.onDecline, "decline");
    wire("counter", handlers.onCounter, null);
    wire("withdraw", handlers.onWithdraw, "decline");

    if (role === "target") window.BT.sfx && window.BT.sfx.receive();
    dock.classList.remove("is-pinged");
    void dock.offsetWidth;
    dock.classList.add("is-pinged");
    UI.syncDock();
    return id;
  };

  function closeTradeCard(card) {
    card.classList.add("is-out");
    setTimeout(() => { card.remove(); UI.syncDock(); }, 260);
  }

  /** Drop a specific offer card (stale trade, sender left, host applied it). */
  UI.dismissTrade = function (id) {
    const card = tradeDock() && tradeDock().querySelector('[data-trade-id="' + id + '"]');
    if (card && !card.dataset.done) { card.dataset.done = "1"; closeTradeCard(card); }
  };

  /** Drop every pending offer involving one player (dropped / bankrupt). */
  UI.dismissTradesFrom = function (playerId) {
    const dock = tradeDock();
    if (!dock) return 0;
    const id = String(playerId);
    const cards = [...dock.querySelectorAll(
      '[data-from-id="' + id + '"], [data-to-id="' + id + '"]')].filter((c) => !c.dataset.done);
    cards.forEach((c) => { c.dataset.done = "1"; closeTradeCard(c); });
    return cards.length;
  };

  UI.clearTrades = function () {
    const dock = tradeDock();
    if (dock) dock.innerHTML = "";
    UI.syncDock();
  };

  /* ================= Session log (collapsible, left dock) ================= */

  /* Everything that happened while you were away: disconnects, trades,
   * purchases and host migrations, each with a wall-clock timestamp. The
   * relay replays its ring buffer on rejoin so a returning player can read
   * back the whole match. */

  const clockOf = (timestamp) => {
    const d = new Date(Number(timestamp) || Date.now());
    return d.toTimeString().slice(0, 8);
  };

  UI.showSessionLog = function (show) {
    const box = $("#session-log");
    if (box) box.hidden = !show;
    UI.syncDock();
  };

  UI.pushSessionEvent = function (entry) {
    const list = $("#session-log-list");
    const box = $("#session-log");
    if (!list || !box || !entry) return;
    if (box.hidden) { box.hidden = false; UI.syncDock(); }
    const li = document.createElement("li");
    li.className = "slog-entry";
    li.innerHTML =
      '<span class="slog-ic" style="color:' + (entry.color || "#8b98a8") + '">' +
        anyIcon(entry.icon || "clock") + "</span>" +
      '<span class="slog-tx">' + esc(entry.text || "") + "</span>" +
      '<time class="slog-at">' + clockOf(entry.timestamp) + "</time>";
    list.appendChild(li);
    while (list.children.length > 120) list.firstChild.remove();
    $("#session-log-count").textContent = String(list.children.length);
    list.scrollTop = list.scrollHeight;
  };

  /** Replace the whole log (used when the relay replays history on rejoin). */
  UI.setSessionLog = function (entries) {
    const list = $("#session-log-list");
    if (!list) return;
    list.innerHTML = "";
    for (const e of entries || []) UI.pushSessionEvent(e);
    $("#session-log-count").textContent = String(list.children.length);
  };

  /* ================= Purchase feedback ================= */

  /** Coins arcing from a player's card to the tile they just bought. */
  function coinFlight(fromEl, toEl, color) {
    if (!fromEl || !toEl || typeof toEl.animate !== "function") return;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "coin-fx";
    document.body.appendChild(layer);

    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;

    for (let i = 0; i < 7; i++) {
      const coin = document.createElement("span");
      coin.className = "coin";
      if (color) coin.style.setProperty("--coin-tint", color);
      coin.style.left = x0 + "px";
      coin.style.top = y0 + "px";
      layer.appendChild(coin);
      const jitter = (Math.random() - 0.5) * 34;
      const lift = -60 - Math.random() * 50;
      coin.animate([
        { transform: "translate(-50%,-50%) scale(.5)", opacity: 0 },
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.14 },
        {
          transform: "translate(calc(-50% + " + ((x1 - x0) / 2 + jitter) + "px), calc(-50% + " +
            ((y1 - y0) / 2 + lift) + "px)) scale(1.05)",
          opacity: 1, offset: 0.6,
        },
        {
          transform: "translate(calc(-50% + " + (x1 - x0) + "px), calc(-50% + " + (y1 - y0) + "px)) scale(.35)",
          opacity: 0,
        },
      ], {
        duration: 620 + i * 45,
        delay: i * 42,
        easing: "cubic-bezier(.32,.72,.35,1)",
        fill: "forwards",
      });
    }
    setTimeout(() => layer.remove(), 1300);
  }

  /**
   * "You bought it" moment: the tile pops with a shadow pulse and coins fly
   * from the buyer's panel card onto the board.
   * @param {string} tileId
   * @param {{id:string,color:string}} player buyer
   */
  UI.celebratePurchase = function (tileId, player) {
    const index = window.BT.tileIndex(tileId);
    const tileEl = UI.tileEls[index];
    if (tileEl) {
      tileEl.classList.remove("just-bought");
      void tileEl.offsetWidth;
      tileEl.classList.add("just-bought");
      setTimeout(() => tileEl.classList.remove("just-bought"), 900);
    }
    // the roster row, not a ".player-card" — that class has not existed since
    // the ledger replaced the old cards, so every coin flew from the status line
    const row = player && $('.pl[data-player-id="' + String(player.id) + '"]');
    coinFlight(row || $("#action-status"), tileEl, player && player.color);
    window.BT.sfx && window.BT.sfx.buy();
  };

  /* ================= Match settings viewer ================= */

  /* Every player should be able to check what this table actually agreed to
   * without asking the host. Read-only on purpose: the rules are fixed once the
   * match starts, and pretending otherwise would be worse than not showing them.
   */
  UI.showRules = function (game) {
    const box = $("#rules-view");
    if (!box) return;
    const c = (game && game.config) || window.BT.DEFAULT_CONFIG;
    const r = c.rules || {};
    const yn = (on) => '<b class="' + (on ? "is-on" : "is-off") + '">' + (on ? "On" : "Off") + "</b>";
    const rows = [
      ["Starting capital", "<b>" + money(c.startCash) + "</b>"],
      ["Salary for passing START", "<b>" + money(c.goReward) + "</b>"],
      ["Prison bail", "<b>" + (c.jailFee ? money(c.jailFee) : "free") + "</b>"],
      ["Match length", "<b>" + (c.maxRounds ? c.maxRounds + " rounds" : "last tycoon standing") + "</b>"],
      ["Kafana pot", yn(r.kafanaJackpot)],
      ["Double rent on full sets", yn(r.doubleRent)],
      ["Auction declined properties", yn(r.auctions)],
      ["Mortgages", yn(r.mortgages)],
      ["Even building", yn(r.evenBuild)],
      ["Rent while in prison", yn(r.rentInJail)],
      ["Build any time", yn(r.buildAnytime)],
    ];
    if (game && game.rules && game.rules.kafanaJackpot) {
      rows.push(["Pot right now", "<b>" + money(game.kafanaPot || 0) + "</b>"]);
    }
    box.innerHTML = rows
      .map(([k, v]) => '<div class="rules-row"><span>' + k + "</span>" + v + "</div>")
      .join("");
    openModal("#modal-rules");
    $("#btn-rules-close").onclick = () => closeModal("#modal-rules");
  };

  window.BT = Object.assign(window.BT || {}, { UI });
})();
