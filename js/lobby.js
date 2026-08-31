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
    turnTimer: null, // seconds, null = unlimited. Default is fully manual play:
                     // a clock that plays your turn for you is the opposite of
                     // what most tables want, so it is opt-in.
    goReward: 200,
    jailFee: 50,
    maxRounds: 60,
    rules: {
      kafanaJackpot: true,
      doubleRent: true,
      auctions: false,
      mortgages: true,
      evenBuild: true,
      rentInJail: true,
      buildAnytime: true,
    },
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
    // one settings form is shared by the create pane, the staging room and the
    // local hot-seat pane, so make sure it is parented where it is about to be
    // shown before we reveal anything
    if (id === "pane-create") {
      const grid = $("#settings-grid");
      const host = $("#pane-create");
      if (grid && grid.parentElement !== host) host.insertBefore(grid, $("#menu-error"));
      const slot = $("#local-rules-slot");
      if (slot) slot.hidden = true;
    }
    for (const p of PANES) show($("#" + p), p === id);
  }

  /** The nickname to seat under, from whichever pane the player is looking at. */
  function nickname() {
    const join = $("#join-nick");
    const onJoin = $("#pane-join") && !$("#pane-join").hidden;
    const raw = onJoin && join && join.value.trim()
      ? join.value
      : $("#menu-nick").value;
    return (raw || "").trim().slice(0, 14);
  }

  function profile() {
    return { name: nickname() || "Player" };
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

  /* Numeric chip/segment groups: element id -> settings key. */
  const CHIP_SETS = [
    ["#set-cash", "startCash", ".chip"],
    ["#set-max", "maxPlayers", ".seg"],
    ["#set-go", "goReward", ".chip"],
    ["#set-bail", "jailFee", ".chip"],
  ];

  const TOGGLES = [
    ["rule-jackpot", "kafanaJackpot"],
    ["rule-double", "doubleRent"],
    ["rule-auction", "auctions"],
    ["rule-mortgage", "mortgages"],
    ["rule-even", "evenBuild"],
    ["rule-jailrent", "rentInJail"],
    ["rule-anytime", "buildAnytime"],
  ];

  /**
   * May the settings be edited right now?
   *
   * This used to be a plain `state.isHost`, which is false until a room snapshot
   * comes back — so on the Create pane, before the room exists, every chip and
   * every switch was inert. You set up the match and nothing you clicked stuck.
   * Outside a room there is no host to be: whoever is looking at the form owns it.
   */
  const settingsEditable = () => !state.inRoom || state.isHost;

  /** Push settings to the relay if we are in a live room. */
  function pushSettings() {
    if (state.inRoom) cb.sendSettings(readSettingsFromDOM());
  }

  function bindSettings() {
    for (const [sel, key, itemSel] of CHIP_SETS) {
      const box = $(sel);
      if (!box) continue;
      box.addEventListener("click", (e) => {
        const b = e.target.closest(itemSel);
        if (!b || !settingsEditable()) return;
        state.settings[key] = Number(b.dataset.v);
        renderSettings();
        pushSettings();
      });
    }

    $("#set-timer").addEventListener("change", (e) => {
      if (!settingsEditable()) return;
      state.settings.turnTimer = e.target.value === "" ? null : Number(e.target.value);
      renderSettings();
      pushSettings();
    });

    $("#set-rounds").addEventListener("change", (e) => {
      if (!settingsEditable()) return;
      state.settings.maxRounds = Number(e.target.value);
      renderSettings();
      pushSettings();
    });

    for (const [id, key] of TOGGLES) {
      const el = $("#" + id);
      if (!el) continue;
      el.addEventListener("change", (e) => {
        if (!settingsEditable()) { e.target.checked = Boolean(state.settings.rules[key]); return; }
        state.settings.rules[key] = e.target.checked;
        pushSettings();
      });
    }
  }

  /** Reflect state.settings onto the shared settings-grid DOM. */
  function renderSettings() {
    const s = state.settings;
    for (const [sel, key, itemSel] of CHIP_SETS) {
      document.querySelectorAll(sel + " " + itemSel).forEach((b) =>
        b.classList.toggle("is-active", Number(b.dataset.v) === Number(s[key])));
    }
    $("#set-timer").value = s.turnTimer == null ? "" : String(s.turnTimer);
    $("#set-rounds").value = String(s.maxRounds == null ? 60 : s.maxRounds);
    for (const [id, key] of TOGGLES) {
      const el = $("#" + id);
      if (el) el.checked = Boolean(s.rules[key]);
    }

    const grid = $("#settings-grid");
    grid.classList.toggle("is-readonly", state.inRoom && !state.isHost);
    grid.classList.toggle("is-live", state.inRoom && state.isHost);
    const editable = settingsEditable();
    ["#set-timer", "#set-rounds"].concat(TOGGLES.map(([id]) => "#" + id)).forEach((sel) => {
      const el = $(sel);
      if (el) el.disabled = !editable;
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
        (p.connected === false
          ? '<span class="stage-badge offline">' + icon("alert", "ic-sb") + "Disconnected</span>"
          : p.ready
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
    // the shareable link, so nobody has to read five characters down a phone
    const link = $("#invite-link");
    if (link) link.value = window.BT.UI.inviteUrl(room.code);

    // keep the rename field showing the name we are actually seated under,
    // unless it is being typed in right now
    const nick = $("#stage-nick");
    const me = room.players.find((p) => p.id === state.myId);
    if (nick && me && document.activeElement !== nick) nick.value = me.name;

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
      if (savedNick) {
        $("#menu-nick").value = savedNick;
        $("#join-nick").value = savedNick;
      }
    } catch (e) { /* ignore */ }

    // keep the two nickname fields in step so it never matters which you typed in
    const mirror = (from, to) => $(from).addEventListener("input", () => {
      $(to).value = $(from).value;
    });
    mirror("#menu-nick", "#join-nick");
    mirror("#join-nick", "#menu-nick");
    $("#join-nick").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#menu-code").focus();
    });

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
    $("#btn-copy-link").addEventListener("click", () => {
      const input = $("#invite-link");
      const btn = $("#btn-copy-link");
      if (!input || !input.value) return;
      const done = () => {
        btn.innerHTML = icon("check") + "Copied";
        setTimeout(() => { btn.innerHTML = icon("link") + "Copy link"; }, 1300);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, done);
      else { input.select(); done(); }
    });

    /* Rename after joining. You land in somebody's room as "Player", and until
     * now the only way to fix that was to leave and come back. */
    const doRename = () => {
      const input = $("#stage-nick");
      const name = (input.value || "").trim().slice(0, 14);
      if (!name) return;
      try { localStorage.setItem("bt_nick", name); } catch (e) { /* private mode */ }
      $("#menu-nick").value = name;
      cb.setName(name);
    };
    $("#btn-rename").addEventListener("click", doRename);
    $("#stage-nick").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doRename(); }
    });

    /* Local hot-seat games get the same house rules form, folded away. */
    $("#btn-local-rules").addEventListener("click", () => {
      const pane = $("#pane-local");
      let slot = $("#local-rules-slot");
      if (!slot) {
        slot = document.createElement("div");
        slot.id = "local-rules-slot";
        slot.className = "rules-body";
        pane.insertBefore(slot, $("#btn-start-game"));
      }
      if (slot.contains($("#settings-grid"))) {
        slot.hidden = !slot.hidden;
      } else {
        slot.appendChild($("#settings-grid"));
        slot.hidden = false;
      }
      $("#btn-local-rules").textContent = slot.hidden
        ? "House rules & match settings"
        : "Hide house rules";
      renderSettings();
    });

    $("#btn-stage-leave").addEventListener("click", () => cb.leaveRoom());
    $("#btn-lobby-ready").addEventListener("click", () => {
      const me = state.room && state.room.players.find((p) => p.id === state.myId);
      cb.setReady(!(me && me.ready));
    });
    $("#btn-lobby-start").addEventListener("click", () => cb.startMatch());
  }

  /** Land on the join pane with a code pre-filled (invite links). */
  function openJoin(code) {
    $("#screen-menu").hidden = false;
    switchPane("pane-join");
    if (code) $("#menu-code").value = String(code).toUpperCase();
    error("#join-error", "");
    const saved = ($("#menu-nick").value || "").trim();
    if (saved) {
      // a returning player already has a name: walk straight into the room
      $("#join-nick").value = saved;
      $("#btn-join-room").click();
    } else {
      $("#join-nick").focus();
    }
  }

  window.BT = Object.assign(window.BT || {}, {
    Lobby: {
      init, onRoomState, closeMenu, openHome, openJoin,
      get settings() { return state.settings; },
    },
  });
})();
