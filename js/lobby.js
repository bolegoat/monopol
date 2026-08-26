/* ============================================================================
 * Balkan Tycoon — lobby.js
 * Pre-game experience: landing screen (Create / Join / Local), host match
 * settings configurator (starting capital, max players, turn timer, house
 * rules), and the real-time staging room (roster, 8-color picker with live
 * locking, procedural SVG token faces, ready/start flow).
 *
 * Networking itself stays in mp.js/net.js; this module only renders and
 * reports intent through the callbacks handed to BT.Lobby.init().
 * ========================================================================== */

"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);
  const icon = (name, cls) => window.BT.icon(name, cls);
  const Tokens = () => window.BT.Tokens;

  const DEFAULT_SETTINGS = {
    startCash: 1500,
    maxPlayers: 4,
    turnTimer: 45, // seconds, null = unlimited
    rules: { kafanaJackpot: true, doubleRent: true, auctions: true },
  };

  const NAMES = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];

  const state = {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    room: null,
    myId: null,
    isHost: false,
    localCount: 4,
    inRoom: false,
  };

  let cb = {}; // injected callbacks

  /* ================= helpers ================= */

  function show(el, yes) { el.hidden = !yes; }

  const PANES = ["pane-home", "pane-create", "pane-join", "pane-local", "pane-room"];

  function switchPane(id) {
    for (const p of PANES) show($("#" + p), p === id);
  }

  function profile() {
    return { name: ($("#menu-nick").value || "").trim().slice(0, 14) || "Player" };
  }

  function readSettingsFromDOM() {
    return JSON.parse(JSON.stringify(state.settings));
  }

  function error(which, msg) {
    const el = $(which);
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  /* ================= match settings binding ================= */

  function bindSettings() {
    $("#set-cash").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b || !state.isHost) return;
      state.settings.startCash = Number(b.dataset.v);
      renderSettings();
      if (state.inRoom) cb.sendSettings(readSettingsFromDOM());
    });
    $("#set-max").addEventListener("click", (e) => {
      const b = e.target.closest(".seg");
      if (!b || !state.isHost) return;
      state.settings.maxPlayers = Number(b.dataset.v);
      renderSettings();
      if (state.inRoom) cb.sendSettings(readSettingsFromDOM());
    });
    $("#set-timer").addEventListener("change", (e) => {
      if (!state.isHost) return;
      state.settings.turnTimer = e.target.value === "" ? null : Number(e.target.value);
      renderSettings();
      if (state.inRoom) cb.sendSettings(readSettingsFromDOM());
    });
    for (const [id, key] of [
      ["rule-jackpot", "kafanaJackpot"],
      ["rule-double", "doubleRent"],
      ["rule-auction", "auctions"],
    ]) {
      $("#" + id).addEventListener("change", (e) => {
        if (!state.isHost) return;
        state.settings.rules[key] = e.target.checked;
        if (state.inRoom) cb.sendSettings(readSettingsFromDOM());
      });
    }
  }

  /** Reflect state.settings onto the shared settings-grid DOM. */
  function renderSettings() {
    const s = state.settings;
    document.querySelectorAll("#set-cash .chip").forEach((b) =>
      b.classList.toggle("is-active", Number(b.dataset.v) === Number(s.startCash)));
    document.querySelectorAll("#set-max .seg").forEach((b) =>
      b.classList.toggle("is-active", Number(b.dataset.v) === Number(s.maxPlayers)));
    $("#set-timer").value = s.turnTimer == null ? "" : String(s.turnTimer);
    $("#rule-jackpot").checked = Boolean(s.rules.kafanaJackpot);
    $("#rule-double").checked = Boolean(s.rules.doubleRent);
    $("#rule-auction").checked = Boolean(s.rules.auctions);

    const grid = $("#settings-grid");
    grid.classList.toggle("is-readonly", state.inRoom && !state.isHost);
    grid.classList.toggle("is-live", state.inRoom && state.isHost);
    const editable = !state.inRoom || state.isHost;
    ["#set-timer", "#rule-jackpot", "#rule-double", "#rule-auction"].forEach((sel) => {
      $(sel).disabled = !editable;
    });
  }

  /* ================= local hot-seat ================= */

  function renderNameFields() {
    const wrap = $("#name-fields");
    wrap.innerHTML = "";
    for (let i = 0; i < state.localCount; i++) {
      const c = window.BT.PLAYER_COLORS[i];
      const row = document.createElement("div");
      row.className = "name-field";
      row.innerHTML =
        Tokens().badge(c.hex, i) +
        '<input type="text" maxlength="14" placeholder="' + NAMES[i] + '" data-seat="' + i +
        '" aria-label="Player ' + (i + 1) + ' name" />';
      wrap.appendChild(row);
    }
  }

  /* ================= staging room ================= */

  function enterRoomPane() {
    // relocate the shared settings grid into the collapsible box
    const grid = $("#settings-grid");
    $("#rules-slot").appendChild(grid);
    state.inRoom = true;
    switchPane("pane-room");
    renderSettings();
  }

  function exitRoomPane() {
    const grid = $("#settings-grid");
    $("#pane-create").insertBefore(grid, $("#menu-error"));
    state.inRoom = false;
    state.room = null;
    renderSettings();
    switchPane("pane-home");
  }

  function renderRoster() {
    const room = state.room;
    if (!room) return;
    const list = $("#stage-list");
    list.innerHTML = "";
    for (const p of room.players) {
      const li = document.createElement("li");
      li.className = "stage-row" + (p.id === state.myId ? " is-me" : "") +
        (p.connected ? "" : " is-offline");
      li.innerHTML =
        Tokens().badge(
          p.color,
          Number.isFinite(p.tokenStyle) ? p.tokenStyle : Tokens().hashStyle(p.name),
        ) +
        '<span class="stage-row__name">' + esc(p.name) +
        (p.id === state.myId ? ' <em>(you)</em>' : "") + "</span>" +
        (p.isHost ? '<span class="stage-badge host">' + icon("crown", "ic-sb") + "Host</span>" : "") +
        (p.ready
          ? '<span class="stage-badge ready">' + icon("check", "ic-sb") + "Ready</span>"
          : '<span class="stage-badge waiting">' + icon("clock", "ic-sb") + "Waiting</span>");
      list.appendChild(li);
    }
    const cap = (room.settings && room.settings.maxPlayers) || state.settings.maxPlayers;
    $("#stage-count").textContent = room.players.length + "/" + cap;
  }

  function renderPickers() {
    const me = state.room && state.room.players.find((p) => p.id === state.myId);
    if (!me) return;
    const taken = new Map(); // normalized color -> seatId
    for (const p of state.room.players) {
      taken.set(String(p.color).toUpperCase(), p.id);
    }

    /* color swatches — taken colors are locked in real time */
    const row = $("#swatch-row");
    row.innerHTML = "";
    for (const c of window.BT.PLAYER_COLORS) {
      const holder = c.hex.toUpperCase();
      const owner = taken.get(holder);
      const mine = owner === state.myId;
      const locked = Boolean(owner) && !mine;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (mine ? " is-mine" : "") + (locked ? " is-taken" : "");
      b.style.setProperty("--sw", c.hex);
      b.title = c.name + (locked ? " — taken" : "");
      b.disabled = locked;
      b.innerHTML = (mine ? icon("check", "ic-sw") : "") + (locked ? icon("lock", "ic-sw") : "");
      b.onclick = () => cb.setColor(c.hex);
      row.appendChild(b);
    }

    /* token face styles previewed in your own color */
    const srow = $("#style-row");
    srow.innerHTML = "";
    const activeStyle = Number.isFinite(me.tokenStyle) ? me.tokenStyle : Tokens().hashStyle(me.name);
    for (let i = 0; i < window.BT.TOKEN_STYLES.length; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "style-opt" + (i === activeStyle ? " is-active" : "");
      b.title = window.BT.TOKEN_STYLES[i];
      b.innerHTML = Tokens().badge(me.color, i);
      b.querySelector(".ptoken").classList.add("ptoken--sm");
      b.onclick = () => cb.setAvatar(i);
      srow.appendChild(b);
    }
    $("#color-note").textContent = "";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  function renderActions() {
    const room = state.room;
    if (!room) return;
    const me = room.players.find((p) => p.id === state.myId);
    const startBtn = $("#btn-lobby-start");
    const readyBtn = $("#btn-lobby-ready");
    const canStart = room.players.length >= 2 &&
      room.players.length <= ((room.settings && room.settings.maxPlayers) || 6) &&
      room.players.every((p) => p.ready);
    startBtn.hidden = !state.isHost;
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? "Start Match" :
      "Waiting for players (" + room.players.filter((p) => p.ready).length + "/" + room.players.length + " ready)";
    readyBtn.hidden = state.isHost;
    readyBtn.classList.toggle("btn-primary", !(me && me.ready));
    readyBtn.innerHTML = (me && me.ready)
      ? icon("check") + " Ready — tap to undo"
      : icon("check") + " Mark Ready";
  }

  /* ---------- public entry points (called by mp.js) ---------- */

  /** A room snapshot arrived while we are pre-game. */
  function onRoomState(room, myId) {
    state.room = room;
    state.myId = myId;
    state.isHost = room.hostId === myId;
    if (room.settings) state.settings = Object.assign({}, state.settings, room.settings,
      { rules: Object.assign({}, state.settings.rules, room.settings.rules) });

    // mid-match snapshot (rejoin flow): mp.js rebuilds the game — skip lobby UI
    if (!state.inRoom && room.status !== "lobby") return;
    if (!state.inRoom) enterRoomPane();

    const codeBtn = $("#room-code-big");
    if (codeBtn.dataset.code !== room.code) {
      codeBtn.dataset.code = room.code;
      codeBtn.textContent = room.code;
    }
    $("#settings-hint").textContent = state.isHost ? "you control these" : "host-controlled";
    renderRoster();
    renderPickers();
    renderActions();
    renderSettings();
  }

  /** Match starting — collapse the whole menu. */
  function closeMenu() {
    $("#screen-menu").hidden = true;
  }

  function openHome() {
    $("#screen-menu").hidden = false;
    exitRoomPane();
    try { localStorage.setItem("bt_nick", $("#menu-nick").value.trim()); } catch (e) { /* private mode */ }
  }

  /* ================= init ================= */

  function init(callbacks) {
    cb = callbacks;

    try {
      const savedNick = localStorage.getItem("bt_nick");
      if (savedNick) $("#menu-nick").value = savedNick;
    } catch (e) { /* ignore */ }

    /* navigation */
    $("#btn-path-create").addEventListener("click", () => { switchPane("pane-create"); error("#menu-error", ""); });
    $("#btn-path-join").addEventListener("click", () => { switchPane("pane-join"); error("#join-error", ""); });
    $("#btn-path-local").addEventListener("click", () => switchPane("pane-local"));
    document.querySelectorAll("[data-back]").forEach((b) =>
      b.addEventListener("click", () => { switchPane("pane-home"); }));

    bindSettings();
    renderSettings();
    renderNameFields();

    /* local hot-seat */
    $("#local-count").addEventListener("click", (e) => {
      const b = e.target.closest(".seg");
      if (!b) return;
      state.localCount = Number(b.dataset.count);
      document.querySelectorAll("#local-count .seg").forEach((x) =>
        x.classList.toggle("is-active", x === b));
      renderNameFields();
    });
    $("#btn-start-game").addEventListener("click", () => {
      const inputs = [...document.querySelectorAll("#name-fields input")];
      const defs = inputs.map((input, i) => ({
        name: input.value.trim() || NAMES[i],
        color: window.BT.PLAYER_COLORS[i].hex,
        tokenStyle: i % window.BT.TOKEN_STYLES.length,
      }));
      cb.startLocal(defs);
    });

    /* join flow */
    $("#menu-code").addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    $("#menu-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#btn-join-room").click();
    });
    $("#btn-join-room").addEventListener("click", async () => {
      const code = $("#menu-code").value.trim();
      if (code.length !== 5) return error("#join-error", "Enter the full 5-character room code.");
      error("#join-error", "");
      $("#btn-join-room").disabled = true;
      try {
        await cb.joinRoom(code, profile());
      } catch (err) {
        error("#join-error", err.message || "Could not join that room.");
      }
      $("#btn-join-room").disabled = false;
    });

    /* create flow */
    $("#btn-create-room").addEventListener("click", async () => {
      $("#btn-create-room").disabled = true;
      error("#menu-error", "");
      try {
        await cb.createRoom(profile(), readSettingsFromDOM());
      } catch (err) {
        error("#menu-error", err.message || "Could not reach the server. Start it with: npm run mp");
      }
      $("#btn-create-room").disabled = false;
    });

    /* staging */
    $("#room-code-big").addEventListener("click", () => {
      const code = $("#room-code-big").dataset.code;
      navigator.clipboard && code && navigator.clipboard.writeText(code).catch(() => {});
      $("#room-code-big").textContent = "COPIED";
      setTimeout(() => { $("#room-code-big").textContent = code || ""; }, 900);
    });
    $("#btn-stage-leave").addEventListener("click", () => cb.leaveRoom());
    $("#btn-lobby-ready").addEventListener("click", () => {
      const me = state.room && state.room.players.find((p) => p.id === state.myId);
      cb.setReady(!(me && me.ready));
    });
    $("#btn-lobby-start").addEventListener("click", () => cb.startMatch());
  }

  window.BT = Object.assign(window.BT || {}, {
    Lobby: {
      init, onRoomState, closeMenu, openHome,
      get settings() { return state.settings; },
    },
  });
})();
