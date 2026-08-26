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

  const badge = (color, style, cls) =>
    window.BT.Tokens.badge(color, style, cls || "");

  const kindColor = (tile) =>
    tile.kind === "city" ? COUNTRIES[tile.country].color
      : tile.kind === "airport" ? "#4f7d99"
      : "#8f8a3f";

  /** hex (#rgb/#rrggbb) -> rgba() string with alpha `a`. */
  function hexA(hex, a) {
    let h = String(hex).replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  /* ================= Board rendering ================= */

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
            '<span class="tile__flagbadge" style="' + flagBg(tile.country) + '"></span>' +
            price +
          "</div>" +
          '<div class="tile__group" style="background:' + COUNTRIES[tile.country].color + '"></div>');
      case "airport":
      case "utility": {
        const ic = tile.kind === "airport" ? "plane" : tile.id === "balkan-electric" ? "zap" : "bottle";
        return (
          '<div class="tile__figure" data-banner>' + icon(ic) + "</div>" +
          '<div class="tile__body"><span class="tile__name">' + tile.name + "</span></div>" +
          '<div class="tile__footer">' + price + "</div>" +
          '<div class="tile__group" style="background:' + kindColor(tile) + '"></div>');
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
        const ic = { start: "flag", jail: "bars", kafana: "coffee", "go-to-jail": "alert" }[tile.corner];
        return (
          '<div class="tile__figure">' + icon(ic) + "</div>" +
          '<div class="tile__body"><span class="tile__name">' + tile.name + "</span></div>" +
          '<div class="tile__sub">' + (tile.sub || "") + "</div>");
      }
      default:
        return "";
    }
  }
  UI.renderBoard = function () {
    const board = $("#board");
    UI.tileEls = [];
    UI.tileParts.clear();

    TILES.forEach((tile, index) => {
      const pos = gridPos(index);
      const el = document.createElement("div");
      el.className = "tile tile--" + tile.kind + " tile-" + tileSide(index);
      if (tile.kind === "corner") el.classList.add("tile--corner-" + tile.corner);
      el.style.gridRow = String(pos.row);
      el.style.gridColumn = String(pos.col);
      el.dataset.pos = String(index);
      el.dataset.tileId = tile.id;
      el.title = tile.kind === "city"
        ? tile.name + ", " + COUNTRIES[tile.country].name
        : tile.name;
      // group color for the hover glow (set as custom props)
      el.style.setProperty("--gc-55", hexA(kindColor(tile), 0.5));
      // inward-facing card: content + strips rotate/invert per edge via CSS
      el.innerHTML =
        '<div class="tile__card">' +
          tileInnerHTML(tile) +
          '<div class="tile__tint"></div>' +
          '<div class="tile__owner"></div>' +
        "</div>";

      board.appendChild(el);
      UI.tileEls[index] = el;
      UI.tileParts.set(tile.id, {
        el,
        ownerBar: el.querySelector(".tile__owner"),
        housesBox: el.querySelector("[data-houses]"),
      });
    });

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

  /** Repaint ownership strips + house pips + player-color state from engine. */
  UI.renderTiles = function (game) {
    for (const [tileId, parts] of UI.tileParts) {
      const ps = game.props[tileId];
      const tile = tileById(tileId);
      if (!ps) continue;
      const owner = ps.owner ? game.player(ps.owner) : null;
      if (owner) {
        parts.el.classList.add("is-owned");
        parts.el.style.setProperty("--oc-15", hexA(owner.color, 0.16));
        parts.el.style.setProperty("--oc-glow", hexA(owner.color, 0.55));
      } else {
        parts.el.classList.remove("is-owned");
      }
      parts.ownerBar.style.background = owner ? owner.color : "transparent";
      parts.ownerBar.classList.toggle("is-owned", Boolean(owner));
      if (parts.housesBox && tile.kind === "city") {
        const n = ps.houses;
        parts.housesBox.innerHTML = n >= 4
          ? icon("building", "ic-house ic-hotel")
          : Array.from({ length: n }, () => icon("house", "ic-house")).join("");
      }
    }
    // keep the 3D houses/hotels overlay in step with engine state
    if (window.BT.Buildings) window.BT.Buildings.sync(game);
  };

  /* ================= Side panel ================= */

  UI.renderPlayers = function (game) {
    const list = $("#player-list");
    list.innerHTML = "";
    for (const p of game.players) {
      const li = document.createElement("li");
      li.className = "player-card";
      if (p.id === game.current.id && game.phase !== "over") li.classList.add("is-turn");
      if (p.bankrupt) li.classList.add("is-bankrupt");

      const chips = game.ownedTiles(p).map((t) => {
        const h = game.props[t.id].houses;
        const houses = h >= 4
          ? icon("building", "ic-chip")
          : h > 0 ? Array.from({ length: h }, () => icon("house", "ic-chip")).join("") : "";
        return '<span class="prop-chip"><i style="background:' + kindColor(t) + '"></i>' +
          t.name + houses + "</span>";
      }).join("");

      const tag = p.bankrupt
        ? '<span class="player-card__tag">Bankrupt</span>'
        : p.inJail
          ? '<span class="player-card__tag">In jail</span>'
          : p.getOutCards > 0
            ? '<span class="player-card__tag player-card__tag--key">' + icon("key", "ic-tag") + "&times;" + p.getOutCards + "</span>"
            : "";

      li.innerHTML =
        '<div class="player-card__head">' +
          badge(p.color, p.tokenStyle, "player-token") +
          '<span class="player-card__name">' + p.name + " " + tag + "</span>" +
          '<span class="player-card__cash ' + (p.cash < 100 ? "is-low" : "") + '">&euro;' + p.cash + "</span>" +
        "</div>" +
        '<div class="player-card__props">' + (chips || '<span class="player-card__empty">No properties yet</span>') + "</div>";
      list.appendChild(li);
    }
  };
  /* ================= Action log (bottom, newest last) ================= */

  UI.log = function (iconKey, color, text) {
    const list = $("#log-list");
    const li = document.createElement("li");
    li.className = "log-entry";
    const safe = String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    li.innerHTML =
      '<span class="log-entry__icon" style="color:' + (color || "#8b98a8") + '">' + anyIcon(iconKey) + "</span>" +
      '<span class="log-entry__text" style="color:' + (color || "inherit") + '">' + safe + "</span>";
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.appendChild(li);
    while (list.children.length > 80) list.firstChild.remove();
    if (stick) list.scrollTop = list.scrollHeight; // autoscroll unless user scrolled up
  };

  /* ================= Status chrome ================= */

  UI.setTurnChip = function (game) {
    const chip = $("#turn-chip");
    if (!game || game.phase === "over") return;
    chip.innerHTML = "<strong>" + game.current.name + "</strong>&nbsp;&middot; Round " + game.round;
  };

  UI.setStatusRaw = function (html) {
    $("#action-status").innerHTML = html;
  };

  UI.setStatus = function (game) {
    const el = $("#action-status");
    const p = game.current;
    const mine = !window.BT.myPlayerId || window.BT.myPlayerId === p.id;
    if (!mine && game.phase !== "over") {
      el.innerHTML = "Waiting for <strong>" + p.name + "</strong>&hellip;";
      return;
    }
    switch (game.phase) {
      case "awaiting-roll":
        el.innerHTML = "<strong>" + p.name + "</strong> — roll the dice";
        break;
      case "awaiting-jail-roll":
        el.innerHTML = "<strong>" + p.name + "</strong> is in prison — roll for doubles";
        break;
      case "busy":
        el.innerHTML = "<strong>" + p.name + "</strong> is on the move&hellip;";
        break;
      case "turn-end":
        el.innerHTML = "<strong>" + p.name + "</strong> — build or end the turn";
        break;
      case "over":
        el.innerHTML = "Game over";
        break;
    }
  };

  UI.refreshButtons = function (game) {
    const phase = game.phase;
    const mine = !window.BT.myPlayerId || window.BT.myPlayerId === game.current.id;
    $("#btn-roll").disabled = !mine || !(phase === "awaiting-roll" || phase === "awaiting-jail-roll");
    $("#btn-roll").innerHTML =
      '<span class="btn-ic">' + icon("dice") + "</span>" +
      (phase === "awaiting-jail-roll" ? "Roll Doubles" : "Roll Dice");
    $("#btn-end-turn").disabled = !mine || phase !== "turn-end";
    const canBuild =
      (phase === "awaiting-roll" || phase === "turn-end") &&
      game.buildableGroups(game.current).length > 0;
    $("#btn-build").disabled = !mine || !canBuild;
    $("#btn-trade").disabled =
      phase === "over" ||
      game.current.bankrupt ||
      game.players.filter((p) => !p.bankrupt).length < 2;
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
    UI.renderPlayers(game);
    UI.renderTiles(game);
    UI.setTurnChip(game);
    UI.setStatus(game);
    UI.refreshButtons(game);
    UI.refreshBuildIfOpen(game);
  };
  /* ================= Modals (Promise-based) ================= */

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  UI.hydrateIcons = function (root) {
    (root || document).querySelectorAll("[data-icon]").forEach((el) => {
      el.innerHTML = icon(el.dataset.icon);
    });
  };

  UI.promptBuy = function (player, tile, price) {
    return new Promise((resolve) => {
      const isCity = tile.kind === "city";
      const flag = $("#buy-colorbar");
      if (isCity) {
        const c = COUNTRIES[tile.country];
        flag.style.cssText = flagBg(tile.country);
        flag.classList.add("has-name");
        flag.innerHTML = "<span>" + c.name + "</span>";
        $("#buy-country").innerHTML =
          "Base rent &euro;" + tile.baseRent + " &middot; House &euro;" + tile.houseCost;
      } else if (tile.kind === "airport") {
        flag.style.cssText = "background:linear-gradient(150deg,#2c4a60,#1b2f40)";
        flag.innerHTML = icon("plane");
        $("#buy-country").textContent = "Rent: 25 / 50 / 100 / 200 per airport owned";
      } else {
        flag.style.cssText = "background:linear-gradient(150deg,#4a4a24,#2e2e16)";
        flag.innerHTML = icon(tile.id === "balkan-electric" ? "zap" : "bottle");
        $("#buy-country").textContent = "Rent: 4x dice (10x dice if you own both)";
      }
      $("#buy-name").textContent = tile.name;
      $("#buy-price").innerHTML = "&euro;" + price;
      $("#buy-rent").textContent = player.name + " \u00b7 cash after purchase: \u20ac" + (player.cash - price);

      openModal("#modal-buy");
      const done = (wants) => { closeModal("#modal-buy"); resolve(wants); };
      $("#btn-buy").onclick = () => done(true);
      $("#btn-pass").onclick = () => done(false);
    });
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

      openModal("#modal-card");
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
      $("#jail-note").textContent =
        player.name + " is in prison (attempt " + (player.jailTurns + 1) + " of 3). " +
        "Roll doubles, pay \u20ac" + ECONOMY.jailFee + " bail" +
        (player.getOutCards > 0 ? " or use your card" : "") + ".";
      $("#btn-jail-pay").disabled = player.cash < ECONOMY.jailFee;
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

  UI.openBuild = function (game) {
    const list = $("#build-list");
    UI._buildGame = game;
    const render = () => {
      const p = game.current;
      list.innerHTML = "";
      const groups = game.buildableGroups(p);
      if (!groups.length) {
        list.innerHTML = '<p class="modal-note" style="text-align:center">You need a full country set first.</p>';
        return;
      }
      for (const cid of groups) {
        const c = COUNTRIES[cid];
        const head = document.createElement("div");
        head.className = "build-group";
        head.innerHTML = '<i style="background:' + c.color + '"></i>' + c.name +
          '<em>house &euro;' + tileById(COUNTRY_GROUPS[cid][0]).houseCost + "</em>";
        list.appendChild(head);
        for (const tileId of COUNTRY_GROUPS[cid]) {
          const tile = tileById(tileId);
          const ps = game.props[tileId];
          const row = document.createElement("div");
          row.className = "build-row";
          const houses = ps.houses >= 4
            ? icon("building", "ic-chip") + " Hotel"
            : ps.houses > 0 ? Array.from({ length: ps.houses }, () => icon("house", "ic-chip")).join("") : "none";
          row.innerHTML =
            '<span class="build-row__color" style="background:' + c.color + '"></span>' +
            '<span><span class="build-row__name">' + tile.name + '</span><br>' +
            '<span class="build-row__houses">' + houses + " &middot; rent &euro;" + game.rentFor(tile) + "</span></span>";
          const minus = document.createElement("button");
          minus.className = "build-row__btn";
          minus.innerHTML = icon("x", "ic-btn");
          minus.disabled = !game.canSellOn(p, tile);
          minus.onclick = () => UI.sellHandler && UI.sellHandler(tileId);
          const plus = document.createElement("button");
          plus.className = "build-row__btn";
          plus.textContent = "+";
          plus.disabled = !game.canBuildOn(p, tile);
          plus.onclick = () => UI.buildHandler && UI.buildHandler(tileId);
          row.append(minus, plus);
          list.appendChild(row);
        }
      }
    };
    UI._buildRender = render;
    render();
    openModal("#modal-build");
    $("#btn-build-close").onclick = () => closeModal("#modal-build");
  };

  UI.refreshBuildIfOpen = function (game) {
    if ($("#modal-build").hidden || !UI._buildRender) return;
    UI._buildGame = game;
    UI._buildRender();
  };

  UI.showGameOver = function (winner, reason) {
    $("#gameover-title").textContent = winner ? winner.name + " wins!" : "Game over";
    $("#gameover-text").textContent = winner
      ? reason + " — final net worth \u20ac" + (UI.game ? UI.game.netWorth(winner) : "?") + "."
      : reason;
    openModal("#modal-gameover");
  };
  /* ================= Multiplayer: lobby / timer / trade ================= */

  UI.setRoomChip = function (code) {
    const chip = $("#room-chip");
    if (!code) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = code;
    chip.title = "Room code — click to copy";
    chip.onclick = () => {
      navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
      chip.textContent = "Copied";
      setTimeout(() => { chip.textContent = code; }, 900);
    };
  };

  UI.setTurnTimer = function (seconds) {
    const el = $("#turn-timer");
    if (seconds == null) { el.hidden = true; return; }
    el.hidden = false;
    $("#timer-value").textContent = seconds;
    el.classList.toggle("is-low", seconds <= 10);
  };

  /* ---------- trade composer: balances + money sliders ---------- */

  UI.openTrade = function (game, myId, opts) {
    const me = game.player(myId);
    const others = game.players.filter((p) => p.id !== myId && !p.bankrupt);
    if (!me || !others.length) return;
    const prefill = opts.prefill || {};
    const prefillTo = opts.prefillTo;

    const targetSel = $("#trade-target");
    targetSel.innerHTML = others
      .map((p) => '<option value="' + p.id + '"' + (p.id === prefillTo ? " selected" : "") + ">" +
        p.name + " \u00b7 \u20ac" + p.cash + "</option>")
      .join("");

    const giveCash = $("#trade-give-cash");
    const wantCash = $("#trade-want-cash");
    const giveSlider = $("#trade-give-slider");
    const wantSlider = $("#trade-want-slider");
    giveCash.value = prefill.giveCash || 0;
    wantCash.value = prefill.wantCash || 0;

    const giveSet = new Set(prefill.giveTiles || []);
    const wantSet = new Set(prefill.wantTiles || []);
    const filters = { give: "", want: "" };

    const syncSliders = () => {
      giveCash.max = me.cash;
      giveSlider.max = me.cash;
      giveSlider.value = Math.min(Number(giveCash.value) || 0, me.cash);
      const target = game.player(targetSel.value);
      const theirMax = target ? target.cash : 0;
      wantCash.max = theirMax;
      wantSlider.max = theirMax;
      wantSlider.value = Math.min(Number(wantCash.value) || 0, theirMax);
    const tokenHtml = (p) => window.BT.Tokens.badge(
      p.color,
      Number.isFinite(p.tokenStyle) ? p.tokenStyle : window.BT.Tokens.hashStyle(p.name || "?"),
    );
    $("#trade-me-token").outerHTML = tokenHtml(me).replace("class=", 'id="trade-me-token" class=');
    $("#trade-them-token").outerHTML = tokenHtml(target || { color: "#555" })
      .replace("class=", 'id="trade-them-token" class=');
      $("#trade-me-name").textContent = me.name;
      $("#trade-me-cash").innerHTML = "&euro;" + me.cash;
      $("#trade-them-cash").innerHTML = target ? "&euro;" + target.cash : "";
    };

    /** Quick-cash steppers: +10 / +50 / +100 / Max, clamped to balance. */
    const wireSteppers = (which) => {
      const row = document.querySelector('.stepper-row[data-stepper-for="' + which + '"]');
      if (!row) return;
      const input = which === "give" ? giveCash : wantCash;
      const cap = () => (which === "give" ? me.cash : (game.player(targetSel.value) || { cash: 0 }).cash);
      row.querySelectorAll(".step-btn").forEach((b) => {
        b.onclick = () => {
          const cur = Math.floor(Number(input.value) || 0);
          input.value = b.hasAttribute("data-max")
            ? cap()
            : Math.min(cap(), cur + Number(b.dataset.add));
          const slider = which === "give" ? giveSlider : wantSlider;
          slider.value = Math.min(Number(input.value), Number(slider.max) || 0);
        };
      });
    };

    const propRow = (tile, set) => {
      const isCity = tile.kind === "city";
      const lead = isCity
        ? '<i class="tp-flag" style="' + flagBg(tile.country) + '"></i>'
        : '<i class="tp-dot" style="background:' + kindColor(tile) + '"></i>';
      const tag = '<em class="tp-tag" style="background:' + kindColor(tile) + '"></em>';
      const row = document.createElement("div");
      row.className = "trade-prop" + (set.has(tile.id) ? " is-selected" : "");
      row.dataset.name = tile.name.toLowerCase();
      row.innerHTML =
        lead + "<span>" + tile.name + "</span>" + tag +
        (set.has(tile.id) ? icon("check", "ic-pick") : "") +
        '<span class="trade-prop__price">&euro;' + tile.price + "</span>";
      row.onclick = () => {
        if (set.has(tile.id)) set.delete(tile.id); else set.add(tile.id);
        row.classList.toggle("is-selected", set.has(tile.id));
        const pick = row.querySelector(".ic-pick");
        if (pick) pick.remove();
        if (set.has(tile.id)) row.insertAdjacentHTML("beforeend", icon("check", "ic-pick"));
      };
      return row;
    };

    const renderColumns = () => {
      const target = game.player(targetSel.value);
      const giveBox = $("#trade-give-props");
      const wantBox = $("#trade-want-props");
      giveBox.innerHTML = "";
      wantBox.innerHTML = "";
      const mine = game.ownedTiles(me).filter((t) => game.props[t.id].houses === 0)
        .filter((t) => t.name.toLowerCase().includes(filters.give));
      const theirs = target
        ? game.ownedTiles(target).filter((t) => game.props[t.id].houses === 0)
          .filter((t) => t.name.toLowerCase().includes(filters.want))
        : [];
      if (!mine.length) giveBox.innerHTML = '<p class="trade-none">No tradable properties</p>';
      if (!theirs.length) wantBox.innerHTML = '<p class="trade-none">No tradable properties</p>';
      for (const t of mine) giveBox.appendChild(propRow(t, giveSet));
      for (const t of theirs) wantBox.appendChild(propRow(t, wantSet));
    };

    // two-way money binding: number input <-> slider, clamped to balance
    giveCash.addEventListener("input", () => {
      giveCash.value = Math.min(Math.max(0, Math.floor(Number(giveCash.value) || 0)), me.cash);
      giveSlider.value = giveCash.value;
    });
    giveSlider.addEventListener("input", () => { giveCash.value = giveSlider.value; });
    wantCash.addEventListener("input", () => {
      const target = game.player(targetSel.value);
      wantCash.value = Math.min(Math.max(0, Math.floor(Number(wantCash.value) || 0)), target ? target.cash : 0);
      wantSlider.value = wantCash.value;
    });
    wantSlider.addEventListener("input", () => { wantCash.value = wantSlider.value; });
    targetSel.onchange = () => {
      wantCash.value = 0;
      giveSet.clear();
      wantSet.clear();
      syncSliders();
      renderColumns();
    };

    giveCash.addEventListener("input", () => { // keep slider in sync when steppers change cash
      giveSlider.value = Math.min(Number(giveCash.value) || 0, me.cash);
    });
    wantCash.addEventListener("input", () => {
      const target = game.player(targetSel.value);
      wantSlider.value = Math.min(Number(wantCash.value) || 0, target ? target.cash : 0);
    });
    $("#trade-give-filter").addEventListener("input", (e) => {
      filters.give = e.target.value.trim().toLowerCase();
      renderColumns();
    });
    $("#trade-want-filter").addEventListener("input", (e) => {
      filters.want = e.target.value.trim().toLowerCase();
      renderColumns();
    });

    syncSliders();
    renderColumns();
    wireSteppers("give");
    wireSteppers("want");
    openModal("#modal-trade");
    $("#btn-trade-cancel").onclick = () => closeModal("#modal-trade");
    $("#btn-trade-send").onclick = () => {
      const trade = {
        to: targetSel.value,
        giveCash: Math.max(0, Math.floor(Number(giveCash.value) || 0)),
        wantCash: Math.max(0, Math.floor(Number(wantCash.value) || 0)),
        giveTiles: [...giveSet],
        wantTiles: [...wantSet],
      };
      if (trade.giveCash > me.cash) trade.giveCash = me.cash;
      const target = game.player(trade.to);
      if (target && trade.wantCash > target.cash) trade.wantCash = target.cash;
      if (!trade.giveCash && !trade.wantCash && !trade.giveTiles.length && !trade.wantTiles.length) return;
      closeModal("#modal-trade");
      opts.onSend(trade);
    };
  };

  /* ---------- incoming trade ---------- */

  UI.incomingTrade = function (game, trade, fromName, handlers) {
    const names = (ids) => ids.map((id) => (tileById(id) || {}).name).filter(Boolean).join(", ") || "—";
    $("#trade-incoming-from").textContent = fromName + " proposes:";
    $("#trade-incoming-summary").innerHTML =
      "<div><strong>" + fromName + " gives:</strong> " +
      (trade.giveCash ? "&euro;" + trade.giveCash + " " : "") + names(trade.giveTiles) + "</div>" +
      "<div><strong>You give:</strong> " +
      (trade.wantCash ? "&euro;" + trade.wantCash + " " : "") + names(trade.wantTiles) + "</div>";
    const modal = document.querySelector("#modal-trade-incoming .modal");
    modal.classList.remove("deal-in");
    void modal.offsetWidth; // restart animation
    modal.classList.add("deal-in");
    openModal("#modal-trade-incoming");
    window.BT.sfx && window.BT.sfx.receive();
    const done = (fn) => { closeModal("#modal-trade-incoming"); fn(); };
    $("#btn-trade-accept").onclick = () => done(handlers.onAccept);
    $("#btn-trade-decline").onclick = () => done(handlers.onDecline);
    $("#btn-trade-counter").onclick = () => done(handlers.onCounter);
  };

  window.BT = Object.assign(window.BT || {}, { UI });
})();
