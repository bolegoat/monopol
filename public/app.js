/* ============================================================================
 * Balkanski Tajkun — app.js
 * Client: rendering + input ONLY. The server owns every rule.
 *
 *  - Synchronized dice: on `diceRolled` every client replays the exact same
 *    Three.js + Cannon.js simulation seeded by the server payload
 *    { d1, d2, seed, spawn1/2, spin1/2, impulse1/2, torque1/2 }.
 *    Fixed 1/60 timestep => identical tumble everywhere; a final short slerp
 *    snaps both dice onto the server-declared faces, so every screen settles
 *    on the identical orientation at (approximately) the same instant.
 *  - Trade overlay: two columns (DAJEŠ / TRAŽIŠ), chips + novac, offer ->
 *    PRIHVATI / ODBIJ modal on the target, atomic execution on the server.
 * ========================================================================== */

"use strict";

/* ============================== UTILITIES =============================== */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => `€${Number(n || 0).toLocaleString("hr-HR")}`;

let toastTimer = null;
function toast(message, kind = "err") {
  const el = $("#toast");
  el.textContent = message;
  el.className = kind === "info" ? "show info" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 3200);
}

/* ============================ CLIENT STATE ============================== */

const S = {
  socket: null,
  myId: null,
  code: null,
  snap: null,      // latest authoritative snapshot
  board: null,     // { tiles, groups, countries, economy }
  tileEls: [],     // index -> element
  seenCardSeq: 0,
  buyModalKey: null,
  animTimers: [],
};

/* Ring geometry mirrors the server: 0 = START bottom-right, CCW. */
function gridPos(i) {
  if (i === 0) return { r: 11, c: 11 };
  if (i <= 9) return { r: 11, c: 11 - i };
  if (i === 10) return { r: 11, c: 1 };
  if (i <= 19) return { r: 21 - i, c: 1 };
  if (i === 20) return { r: 1, c: 1 };
  if (i <= 29) return { r: 1, c: i - 19 };
  if (i === 30) return { r: 1, c: 11 };
  return { r: i - 29, c: 11 };
}
const tileSideOf = (i) =>
  (i >= 1 && i <= 9) ? "bottom" :
  (i >= 11 && i <= 19) ? "left" :
  (i >= 21 && i <= 29) ? "top" :
  (i >= 31 && i <= 39) ? "right" : null;

/* ================================ SOCKET ================================ */

function connect() {
  S.socket = io();
  const sock = S.socket;

  sock.on("joined", ({ code, playerId }) => {
    S.myId = playerId;
    S.code = code;
    $("#lobby-code").textContent = code;
    showScreen("lobby");
  });

  sock.on("lobby", renderLobby);
  sock.on("gameStarted", onGameStarted);
  sock.on("state", onState);
  sock.on("diceRolled", (payload) => Dice.playSeeded(payload));
  sock.on("cardDrawn", onCardDrawn);
  sock.on("tradeIncoming", showIncomingTrade);
  sock.on("tradeSent", () => { closeOverlay("#overlay-trade"); toast("Ponuda je poslana.", "info"); });
  sock.on("tradeResolved", (r) => {
    if (r.accepted) toast(`Razmjena između ${r.fromName} i ${r.toName} je izvršena.`, "info");
    else if (r.expired) toast(r.message || "Ponuda je istekla.");
    else toast(`${r.byName} odbija tvoju ponudu.`);
    closeOverlay("#modal-trade-incoming");
  });
  sock.on("error", (e) => toast(e?.message || "Greška."));
  sock.on("connect_error", () => toast("Veza s poslužiteljem je prekinuta."));
}

/* ============================= SCREEN ROUTER ============================ */

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`#screen-${name}`).classList.add("active");
}

/* ================================ HOME ================================== */

function initHome() {
  $("#btn-create").addEventListener("click", () => {
    const name = $("#inp-name").value.trim();
    if (!name) return homeErr("Upiši svoje ime.");
    S.socket.emit("createRoom", { name });
  });
  $("#btn-join").addEventListener("click", () => {
    const name = $("#inp-name").value.trim();
    const code = $("#inp-code").value.trim().toUpperCase();
    if (!name) return homeErr("Upiši svoje ime.");
    if (code.length !== 5) return homeErr("Šifra sobe ima točno 5 slova.");
    S.socket.emit("joinRoom", { code, name });
  });
  $("#inp-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#btn-join").click();
  });
  $("#inp-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
  });
}
const homeErr = (msg) => { $("#home-err").textContent = msg; };

/* ================================ LOBBY ================================= */

function renderLobby(room) {
  $("#lobby-code").textContent = room.code;
  const slots = $("#lobby-slots");
  slots.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const p = room.players[i];
    const div = document.createElement("div");
    if (p) {
      div.className = "slot";
      div.innerHTML = `<span class="dot" style="background:${p.token}"></span>
        <span class="nm">${esc(p.name)}</span>
        ${p.id === room.hostId ? '<span class="tag">Domaćin</span>' : ""}`;
      if (p.id === S.myId) div.style.borderColor = "var(--gold)";
    } else {
      div.className = "slot empty";
      div.textContent = "Slobodno mjesto";
    }
    slots.appendChild(div);
  }

  const toks = $("#lobby-tokens");
  toks.innerHTML = "";
  const me = room.players.find((p) => p.id === S.myId);
  for (const color of ["#e0393f", "#2f6fed", "#23a55a", "#f2b722", "#8b5cf6", "#f07f2d"]) {
    const b = document.createElement("button");
    b.className = "tok";
    const taken = room.players.some((p) => p.token === color);
    const mine = me && me.token === color;
    b.disabled = taken && !mine;
    if (mine) b.classList.add("selected");
    b.innerHTML = `<span class="dot" style="background:${color}"></span>`;
    b.title = mine ? "Tvoja boja" : "";
    b.addEventListener("click", () => S.socket.emit("pickToken", { color }));
    toks.appendChild(b);
  }

  const amHost = room.hostId === S.myId;
  const canStart = amHost && room.players.length >= 2;
  $("#btn-start").disabled = !canStart;
  $("#lobby-note").textContent =
    room.players.length < 2 ? "Čekaju se još igrači (najmanje 2)." :
    amHost ? "Svi su spremni — pokreni igru kad želiš." :
    "Čekaj dok domaćin ne pokrene igru.";
}

function initLobby() {
  $("#btn-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(S.code); toast("Šifra sobe je kopirana.", "info"); }
    catch { toast("Kopiranje nije dopušteno u ovom pregledniku."); }
  });
  $("#btn-start").addEventListener("click", () => S.socket.emit("startGame"));
  $("#btn-leave").addEventListener("click", () => location.reload());
}

/* ================================ BOARD ================================= */

async function loadBoard() {
  if (S.board) return S.board;
  const res = await fetch("/api/board");
  S.board = await res.json();
  return S.board;
}

function buildBoard() {
  const { tiles } = S.board;
  const boardEl = $("#board");
  boardEl.innerHTML = "";
  S.tileEls = [];

  tiles.forEach((t, idx) => {
    const el = document.createElement("div");
    const side = tileSideOf(idx);
    el.className = "tile";
    el.dataset.idx = idx;

    if (t.kind === "corner") {
      el.classList.add("corner");
      if (t.corner === "jail") el.classList.add("jail-tile");
      if (t.corner === "gotojail") el.classList.add("goto-tile");
      el.innerHTML = `<div class="cname">${esc(t.name)}</div><div class="csub">${esc(t.sub)}</div>`;
    } else {
      let bandHtml = "";
      if (t.kind === "city") {
        const col = S.board.countries[t.country].color;
        bandHtml = `<div class="band" style="background:${col}"></div>`;
        el.dataset.groupColor = col;
      } else if (t.kind === "airport") {
        bandHtml = `<div class="band" style="background:#454a52">ZL</div>`;
      } else if (t.kind === "utility") {
        const mark = t.id === "struja" ? "E" : "V";
        bandHtml = `<div class="band" style="background:#2f5a5e">${mark}</div>`;
      } else {
        // surprise / event / tax: no color band
        el.classList.add("special");
      }

      const iconGlyph = t.kind === "surprise" ? "?" : t.kind === "event" ? "!" : t.kind === "tax" ? "€" : "";
      const iconHtml = iconGlyph ? `<div class="glyph">${iconGlyph}</div>` : "";
      const priceHtml = t.price ? `<div class="tprice mono">${eur(t.price)}</div>`
        : t.kind === "tax" ? `<div class="tprice mono">${eur(t.amount)}</div>` : "";

      if (side) el.classList.add(`side-${side}`);
      el.innerHTML = `${iconHtml}${bandHtml}
        <div class="tname">${esc(t.name)}${priceHtml}</div>
        <div class="own-strip" style="display:none"></div>
        <div class="builds"></div>`;
      el.addEventListener("click", () => showTileInfo(t));
    }

    const gp = gridPos(idx);
    el.style.gridRow = gp.r;
    el.style.gridColumn = gp.c;
    boardEl.appendChild(el);
    S.tileEls[idx] = el;
  });

  /* Center arena */
  const center = document.createElement("div");
  center.className = "board-center";
  center.innerHTML = `
    <canvas id="dice-stage"></canvas>
    <div class="center-brand"><h2>BALKANSKI TAJKUN</h2><span>Vlasnička igra</span></div>
    <div id="turn-line"></div>
    <div id="roll-line"></div>`;
  boardEl.appendChild(center);
}

function showTileInfo(t) {
  const lines = [];
  lines.push(`${t.name}${t.price ? ` — ${eur(t.price)}` : ""}`);
  if (t.kind === "city") {
    lines.push(`Osnovna najamnica: ${eur(t.baseRent)}`);
    lines.push(`Kuća/hotel: ${eur(t.houseCost)} po razini`);
    lines.push(`Najamnica s kompletnom bojom: ${eur(t.baseRent * 2)}`);
  } else if (t.kind === "airport") {
    lines.push("Najamnica: €25 / €50 / €100 / €200 ovisno o broju zračnih luka koje posjeduješ.");
  } else if (t.kind === "utility") {
    lines.push("Najamnica: bacanje kockica × 4, odnosno × 10 s obje mreže.");
  } else if (t.kind === "tax") {
    lines.push(`Plati ${eur(t.amount)}.`);
  }
  toast(lines.join("  |  "), "info");
}

/* ============================ GAME RENDERING ============================ */

function onGameStarted(snap) {
  loadBoard().then(() => {
    buildBoard();
    Dice.ensure($("#dice-stage"));
    closeOverlay("#overlay-gameover");
    showScreen("game");
    applySnap(snap, true);
  });
}

function onState(snap) {
  if (!snap || snap.status === "lobby") return;
  S.snap = snap;
  if ($("#screen-game").classList.contains("active")) applySnap(snap, false);
}

function applySnap(snap, fresh) {
  if (snap.status === "over") onGameOver(snap);
  else closeOverlay("#overlay-gameover");
  renderPlayers(snap);
  renderDeedsAndHouses(snap);
  renderTokens(snap, fresh);
  renderLog(snap);
  renderTurnUi(snap);
  renderBuildPanel(snap);
  handleBuyModal(snap);
}

function me() { return S.snap?.players.find((p) => p.id === S.myId); }
const isMyTurn = () => S.snap && S.snap.current === S.myId && S.snap.status === "playing";

function renderPlayers(snap) {
  const list = $("#players-list");
  list.innerHTML = "";
  for (const p of snap.players) {
    const row = document.createElement("div");
    row.className = "pl-row" +
      (p.id === snap.current && snap.status === "playing" ? " current" : "") +
      (p.alive ? "" : " dead");
    row.innerHTML = `
      <span class="dot" style="background:${p.token}"></span>
      <span class="nm">${esc(p.name)}${p.inJail ? ' <span class="badge-jail">U zatvoru</span>' : ""}${p.alive ? "" : ' <span class="badge-dead">Bankrotirao</span>'}</span>
      <span class="cash mono">${eur(p.money)}</span>`;
    list.appendChild(row);
  }
}

function renderDeedsAndHouses(snap) {
  S.tileEls.forEach((el, idx) => {
    if (!el) return;
    const t = S.board.tiles[idx];
    const strip = el.querySelector(".own-strip");
    const builds = el.querySelector(".builds");

    /* Ownership strip */
    const owner = snap.owners[t.id];
    if (owner && strip) {
      const op = snap.players.find((p) => p.id === owner);
      strip.style.display = "block";
      strip.style.background = op ? op.token : "transparent";
    } else if (strip) strip.style.display = "none";

    /* Houses / hotel */
    if (builds) {
      const lvl = snap.houses[t.id] || 0;
      if (lvl > 0) {
        builds.innerHTML = lvl === 4
          ? '<span class="hotel"></span>'
          : Array.from({ length: lvl }, () => '<span class="h"></span>').join("");
      } else builds.innerHTML = "";
    }
  });
}

function renderLog(snap) {
  const feed = $("#log-feed");
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.innerHTML = snap.log.map((l) => `<div>${esc(l.text)}</div>`).join("");
  if (atBottom || true) feed.scrollTop = feed.scrollHeight;
}

/* ------------------------------- PAWNS ---------------------------------- */

function pawnOffset(i, n) {
  if (n <= 1) return { dx: 0, dy: 0 };
  const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { dx: Math.cos(ang) * 16, dy: Math.sin(ang) * 13 };
}

function clearAnims() {
  S.animTimers.forEach(clearInterval);
  S.animTimers = [];
}

function placePawn(el, idx, pIdx, pCount) {
  const gp = gridPos(idx);
  const off = pawnOffset(pIdx, pCount);
  el.style.left = `calc(${(gp.c - 0.5) / 11 * 100}% + ${off.dx}px)`;
  el.style.top = `calc(${(gp.r - 0.5) / 11 * 100}% + ${off.dy}px)`;
}

function renderTokens(snap, fresh) {
  const layer = $("#tokens-layer");
  if (!layer.childElementCount || layer.dataset.code !== snap.code) {
    layer.innerHTML = "";
    layer.dataset.code = snap.code;
    snap.players.forEach(() => {
      const el = document.createElement("div");
      el.className = "pawn";
      layer.appendChild(el);
    });
  }
  clearAnims();

  snap.players.forEach((p, pIdx) => {
    const el = layer.children[pIdx];
    el.style.background = p.token;
    el.style.display = p.alive ? "block" : "none";
    el.classList.toggle("current", p.id === snap.current && snap.status === "playing");
    el.title = p.name;

    const prev = el.dataset.pos != null ? Number(el.dataset.pos) : null;
    el.dataset.pos = String(p.pos);

    if (fresh || prev == null || prev === p.pos) {
      placePawn(el, p.pos, pIdx, snap.players.length);
      return;
    }

    /* Hop animation forward along the ring */
    let steps = (p.pos - prev + 40) % 40;
    if (steps > 12) steps = 0; // long jumps (cards/jail) teleport
    if (!steps) { placePawn(el, p.pos, pIdx, snap.players.length); return; }

    let cur = prev, k = 0;
    placePawn(el, cur, pIdx, snap.players.length);
    const iv = setInterval(() => {
      k += 1;
      cur = (cur + 1) % 40;
      placePawn(el, cur, pIdx, snap.players.length);
      if (k >= steps) clearInterval(iv);
    }, 95);
    S.animTimers.push(iv);
  });
}

/* ------------------------------ TURN UI --------------------------------- */

function btn(label, cls, onClick, disabled = false) {
  const b = document.createElement("button");
  b.className = `btn ${cls}`;
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

function renderTurnUi(snap) {
  const wrap = $("#actions");
  wrap.innerHTML = "";
  const note = $("#status-note");
  const curP = snap.players.find((p) => p.id === snap.current);
  const mine = isMyTurn();
  const phase = snap.phase;

  $("#turn-line").textContent = snap.status === "over"
    ? "IGRA JE ZAVRŠENA"
    : mine ? "TVOJ POTEZ" : `NA POTEZU: ${(curP?.name ?? "").toUpperCase()}`;

  /* Roll readout */
  const rl = $("#roll-line");
  if (snap.lastRoll && snap.phase !== "rolling") {
    const { d1, d2 } = snap.lastRoll;
    rl.textContent = `Bacanje: ${d1} + ${d2} = ${d1 + d2}${d1 === d2 ? " — PAR!" : ""}`;
  } else if (phase === "rolling") {
    rl.textContent = "Kocke se vrte...";
  } else {
    rl.textContent = "";
  }

  if (snap.status === "over") {
    note.textContent = "";
    return;
  }

  if (!mine) {
    note.textContent = phase === "rolling" ? "Protivnik baca kocke..." : `Čekaj svoj potez.`;
    wrap.appendChild(btn("BACI KOCKE", "primary big", () => {}, true));
    return;
  }

  switch (phase) {
    case "roll": {
      note.textContent = "Baci kocke za početak poteza.";
      wrap.appendChild(btn("BACI KOCKE", "primary big", () => S.socket.emit("playerRollDice")));
      wrap.appendChild(btn("TRGOVINA", "", openTradeOverlay));
      break;
    }
    case "jail": {
      note.textContent = "U zatvoru si — plati kauciju ili pokušaj baciti par.";
      wrap.appendChild(btn("BACI KOCKE (PAR ZA IZLAZ)", "primary big", () => S.socket.emit("playerRollDice")));
      wrap.appendChild(btn(`PLATI KAUCIJU ${eur(50)}`, "", () => S.socket.emit("jailPay")));
      break;
    }
    case "rolling": {
      note.textContent = "Kocke se vrte...";
      wrap.appendChild(btn("...", "primary big", () => {}, true));
      break;
    }
    case "buy": {
      note.textContent = "Odluka o kupnji je otvorena.";
      break;
    }
    case "end": {
      note.textContent = "Upravljaj gradnjom ili završi potez.";
      wrap.appendChild(btn("ZAVRŠI POTEZ", "primary big", () => S.socket.emit("endTurn")));
      wrap.appendChild(btn("TRGOVINA", "", openTradeOverlay));
      break;
    }
    default: note.textContent = "";
  }
}

/* ----------------------------- BUILD PANEL ------------------------------ */

function renderBuildPanel(snap) {
  const panel = $("#build-panel");
  const list = $("#build-list");
  const p = me();
  const minePhase = isMyTurn() && ["roll", "end"].includes(snap.phase);
  if (!p || !p.alive || !minePhase) { panel.style.display = "none"; return; }

  const groups = S.board.groups;
  const rows = [];
  for (const [cid, ids] of Object.entries(groups)) {
    if (!ids.every((id) => snap.owners[id] === S.myId)) continue;
    for (const id of ids) {
      const t = S.board.tiles.find((x) => x.id === id);
      const lvl = snap.houses[id] || 0;
      const canB = lvl < 4 && lvl === Math.min(...ids.map((x) => snap.houses[x] || 0)) && p.money >= t.houseCost;
      const canS = lvl > 0 && lvl === Math.max(...ids.map((x) => snap.houses[x] || 0));
      rows.push({ cid, t, lvl, canB, canS });
    }
  }
  if (!rows.length) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  list.innerHTML = "";
  for (const r of rows) {
    const item = document.createElement("div");
    item.className = "build-item";
    item.innerHTML = `
      <span class="swatch" style="background:${S.board.countries[r.cid].color}"></span>
      <span class="bn">${esc(r.t.name)}</span>
      <span class="lvl">${r.lvl === 4 ? "HOTEL" : `Kuća × ${r.lvl}`}</span>`;
    const sell = btn("PRODAJ", "mini danger", () => S.socket.emit("sell", { tileId: r.t.id }), !r.canS);
    const buy = btn(r.lvl === 3 ? "HOTEL" : "+ KUĆA", "mini", () => S.socket.emit("build", { tileId: r.t.id }), !r.canB);
    buy.title = `Cijena: ${eur(r.t.houseCost)}`;
    item.append(sell, buy);
    list.appendChild(item);
  }
}

/* ------------------------------ BUY MODAL ------------------------------- */

function handleBuyModal(snap) {
  const key = snap.phase === "buy" && isMyTurn() ? `${snap.current}:${snap.pendingTile}` : null;
  if (!key) {
    if (S.buyModalKey) { closeOverlay("#modal-buy"); S.buyModalKey = null; }
    return;
  }
  if (key === S.buyModalKey) return;
  S.buyModalKey = key;
  const t = S.board.tiles.find((x) => x.id === snap.pendingTile);
  if (!t) return;
  $("#buy-name").textContent = t.name;
  $("#buy-sub").textContent = t.kind === "city"
    ? `${S.board.countries[t.country].name} — najamnica raste s kućama i hotelom.`
    : t.kind === "airport"
      ? "Prihod ovisi o broju tvojih zračnih luka."
      : "Prihod ovisi o bacanju kockica.";
  const bb = $("#btn-buy");
  bb.textContent = `KUPI ZA ${eur(t.price)}`;
  bb.onclick = () => { S.socket.emit("decideBuy", { buy: true }); closeOverlay("#modal-buy"); };
  $("#btn-skip").onclick = () => { S.socket.emit("decideBuy", { buy: false }); closeOverlay("#modal-buy"); };
  openOverlay("#modal-buy");
}

/* ------------------------------ CARD MODAL ------------------------------ */

let cardAutoClose = null;
function onCardDrawn(card) {
  if (card.seq <= S.seenCardSeq) return;
  S.seenCardSeq = card.seq;
  $("#card-deck").textContent = card.deck;
  $("#card-text").textContent = card.text;
  openOverlay("#modal-card");
  clearTimeout(cardAutoClose);
  cardAutoClose = setTimeout(() => closeOverlay("#modal-card"), 6000);
}
function initCardModal() {
  $("#btn-card-ok").addEventListener("click", () => {
    clearTimeout(cardAutoClose);
    closeOverlay("#modal-card");
  });
}

/* =========================== TRADE (TRGOVINA) =========================== */

const TradeUI = {
  giveTiles: new Set(),
  getTiles: new Set(),

  reset() {
    this.giveTiles.clear();
    this.getTiles.clear();
    $("#tt-give-money").value = 0;
    $("#tt-get-money").value = 0;
    $("#tt-give-range").value = 0;
    $("#tt-get-range").value = 0;
  },

  open() {
    const snap = S.snap;
    if (!isMyTurn() || !["roll", "end"].includes(snap.phase))
      return toast("Trguješ samo tijekom svoga poteza.");
    this.reset();
    this.renderTargetOptions();
    this.renderGive();
    this.renderGet();
    openOverlay("#overlay-trade");
  },

  renderTargetOptions() {
    const sel = $("#tt-target");
    sel.innerHTML = "";
    for (const p of S.snap.players) {
      if (p.id === S.myId || !p.alive) continue;
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} — ${eur(p.money)}`;
      sel.appendChild(opt);
    }
    sel.onchange = () => { this.getTiles.clear(); this.renderGet(); };
  },

  chip(tile, selected, onToggle) {
    const c = document.createElement("button");
    c.type = "button";
    const color = tile.kind === "city" ? S.board.countries[tile.country].color : "#454a52";
    c.className = "chip" + (selected ? " on" : "");
    c.innerHTML = `<span class="sw" style="background:${color}"></span>${esc(tile.name)}`;
    c.addEventListener("click", onToggle);
    return c;
  },

  myDeeds() {
    return Object.entries(S.snap.owners)
      .filter(([, o]) => o === S.myId)
      .map(([id]) => S.board.tiles.find((t) => t.id === id))
      .filter(Boolean);
  },
  theirDeeds(pid) {
    return Object.entries(S.snap.owners)
      .filter(([, o]) => o === pid)
      .map(([id]) => S.board.tiles.find((t) => t.id === id))
      .filter(Boolean);
  },

  renderGive() {
    const wrap = $("#tt-give-chips");
    wrap.innerHTML = "";
    const deeds = this.myDeeds();
    if (!deeds.length) wrap.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Još ne posjeduješ polja.</span>';
    for (const t of deeds) {
      wrap.appendChild(this.chip(t, this.giveTiles.has(t.id), () => {
        this.giveTiles.has(t.id) ? this.giveTiles.delete(t.id) : this.giveTiles.add(t.id);
        this.renderGive();
      }));
    }
    const cash = me()?.money ?? 0;
    const range = $("#tt-give-range");
    range.max = String(Math.max(cash, 0));
    range.value = $("#tt-give-money").value || 0;
  },

  renderGet() {
    const wrap = $("#tt-get-chips");
    wrap.innerHTML = "";
    const pid = $("#tt-target").value;
    const deeds = pid ? this.theirDeeds(pid) : [];
    if (!pid) wrap.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Odaberi igrača.</span>';
    else if (!deeds.length) wrap.innerHTML = '<span style="color:var(--muted);font-size:.8rem">Ovaj igrač ne posjeduje polja.</span>';
    for (const t of deeds) {
      wrap.appendChild(this.chip(t, this.getTiles.has(t.id), () => {
        this.getTiles.has(t.id) ? this.getTiles.delete(t.id) : this.getTiles.add(t.id);
        this.renderGet();
      }));
    }
    const target = S.snap.players.find((p) => p.id === pid);
    const cash = target?.money ?? 0;
    const range = $("#tt-get-range");
    range.max = String(Math.max(cash, 0));
    range.value = $("#tt-get-money").value || 0;
  },

  send() {
    const payload = {
      to: $("#tt-target").value,
      giveTiles: [...this.giveTiles],
      getTiles: [...this.getTiles],
      giveMoney: Number($("#tt-give-money").value) || 0,
      getMoney: Number($("#tt-get-money").value) || 0,
    };
    if (!payload.to) return toast("Odaberi igrača za razmjenu.");
    S.socket.emit("tradeOffer", payload);
  },
};

function openTradeOverlay() { TradeUI.open(); }

function showIncomingTrade(offer) {
  const nameOf = (id) => {
    const t = S.board?.tiles.find((x) => x.id === id);
    return t ? t.name : id;
  };
  const li = (items, money) => {
    const ul = [];
    for (const id of items) ul.push(`<li>${esc(nameOf(id))}</li>`);
    if (money > 0) ul.push(`<li><strong>${eur(money)} novca</strong></li>`);
    return ul.length ? ul.join("") : "<li>ništa</li>";
  };
  $("#ti-from").innerHTML =
    `Igrač <strong>${esc(offer.fromName)}</strong> nudi sljedeću razmjenu:`;
  $("#ti-get").innerHTML = li(offer.giveTiles, offer.giveMoney);
  $("#ti-give").innerHTML = li(offer.getTiles, offer.getMoney);
  $("#btn-trade-accept").onclick = () => {
    S.socket.emit("tradeRespond", { offerId: offer.id, accept: true });
    closeOverlay("#modal-trade-incoming");
  };
  $("#btn-trade-decline").onclick = () => {
    S.socket.emit("tradeRespond", { offerId: offer.id, accept: false });
    closeOverlay("#modal-trade-incoming");
  };
  openOverlay("#modal-trade-incoming");
}

function initTradeUi() {
  const sync = (rangeSel, numSel) => {
    $(rangeSel).addEventListener("input", (e) => { $(numSel).value = e.target.value; });
    $(numSel).addEventListener("input", (e) => {
      const max = Number($(rangeSel).max || 0);
      const v = Math.min(Math.max(Number(e.target.value) || 0, 0), max);
      $(rangeSel).value = v;
    });
  };
  sync("#tt-give-range", "#tt-give-money");
  sync("#tt-get-range", "#tt-get-money");
  $("#tt-target").addEventListener("change", () => TradeUI.renderGet());
  $("#btn-trade-send").addEventListener("click", () => TradeUI.send());
  $("#btn-trade-cancel").addEventListener("click", () => closeOverlay("#overlay-trade"));
}

/* ---------------------------- OVERLAY HELPERS --------------------------- */

const openOverlay = (sel) => $(sel).classList.add("open");
const closeOverlay = (sel) => $(sel).classList.remove("open");

/* ======================= SYNCHRONIZED 3D DICE =========================== *
 * Both dice are thrown with vectors generated on the server from a shared
 * seed. Every browser steps Cannon.js at a fixed 1/60 s, so the sequence of
 * physics states is bit-for-bit reproducible across machines; the settle
 * detector ends the tumble and a brief slerp locks both dice onto the exact
 * server-declared faces. Result: identical animation, timing and outcome
 * on every connected screen.                                             */

const Dice = (() => {
  const DIE_SIZE = 1.1, DIE_RADIUS = 0.14, CEILING = 7.2;
  const SETTLE_SPEED = 0.14, SETTLE_FRAMES = 6;
  const MAX_ROLL_MS = 2500, SNAP_MS = 260;

  /* Face values per BoxGeometry material order (px,nx,py,ny,pz,nz). */
  const FACE_VALUES = { px: 1, nx: 6, py: 2, ny: 5, pz: 3, nz: 4 };
  const FACE_NORMALS = {
    1: [0, 0, 1], 6: [0, 0, -1], 2: [0, 1, 0], 5: [0, -1, 0], 3: [1, 0, 0], 4: [-1, 0, 0],
  };

  const available = () => Boolean(window.THREE && window.CANNON);

  const api = {
    manager: null,

    ensure(canvas) {
      if (!available()) return;
      if (!this.manager) this.manager = new Manager(canvas);
    },

    /** Entry point for the authoritative payload. */
    playSeeded(payload) {
      if (!payload) return;
      if (!this.manager || !available()) {
        /* 2D fallback keeps the game playable without WebGL. */
        const rl = $("#roll-line");
        if (rl) rl.textContent = `Kocke: ${payload.d1} + ${payload.d2} = ${payload.d1 + payload.d2}`;
        return;
      }
      this.manager.throwFromPayload(payload);
    },
  };

  function roundedBoxGeometry(size, radius, seg) {
    const geo = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
    const pos = geo.attributes.position;
    const inner = size / 2 - radius;
    const v = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      c.set(
        Math.max(-inner, Math.min(inner, v.x)),
        Math.max(-inner, Math.min(inner, v.y)),
        Math.max(-inner, Math.min(inner, v.z)));
      n.copy(v).sub(c);
      if (n.lengthSq() > 1e-8) {
        n.normalize().multiplyScalar(radius).add(c);
        pos.setXYZ(i, n.x, n.y, n.z);
      }
    }
    geo.computeVertexNormals();
    return geo;
  }

  function pipLayout(value) {
    const a = 0.27, b = 0.5, c = 0.73;
    switch (value) {
      case 1: return [[b, b]];
      case 2: return [[a, a], [c, c]];
      case 3: return [[a, a], [b, b], [c, c]];
      case 4: return [[a, a], [c, a], [a, c], [c, c]];
      case 5: return [[a, a], [c, a], [b, b], [a, c], [c, c]];
      default: return [[a, a], [c, a], [a, b], [c, b], [a, c], [c, c]];
    }
  }

  function faceTexture(value) {
    const Sz = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = Sz;
    const ctx = cv.getContext("2d");
    const bg = ctx.createRadialGradient(Sz / 2, Sz / 2, Sz * 0.1, Sz / 2, Sz / 2, Sz * 0.75);
    bg.addColorStop(0, "#faf5e8"); bg.addColorStop(0.75, "#f1ead8"); bg.addColorStop(1, "#ddd3ba");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, Sz, Sz);
    ctx.strokeStyle = "rgba(120,105,70,.35)";
    ctx.lineWidth = Sz * 0.045;
    ctx.strokeRect(Sz * 0.06, Sz * 0.06, Sz * 0.88, Sz * 0.88);
    const pr = Sz * 0.085;
    for (const [fx, fy] of pipLayout(value)) {
      const x = fx * Sz, y = fy * Sz;
      const g = ctx.createRadialGradient(x, y, pr * 0.15, x, y, pr);
      g.addColorStop(0, "#05060a"); g.addColorStop(0.72, "#161a22"); g.addColorStop(1, "rgba(22,26,34,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  /** Quaternion whose local face normal for `value` points straight up. */
  function canonicalQuat(value) {
    const n = FACE_NORMALS[value];
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(n[0], n[1], n[2]).normalize(),
      new THREE.Vector3(0, 1, 0));
  }

  class Manager {
    constructor(canvas) {
      this.canvas = canvas;
      const parent = canvas.parentElement;
      const w = parent.clientWidth || 400, h = parent.clientHeight || 400;

      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
      this.camera.position.set(0, 12.5, 0.001);
      this.camera.lookAt(0, 0, 0);

      const visHalf = 12.5 * Math.tan(THREE.MathUtils.degToRad(15));
      const reach = DIE_SIZE * 0.88;
      this.arena = Math.min((visHalf - reach) * 0.94, 5.4);

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const key = new THREE.DirectionalLight(0xfff2d8, 0.95);
      key.position.set(4, 10, 6);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = key.shadow.camera.bottom = -8;
      key.shadow.camera.right = key.shadow.camera.top = 8;
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(0x9db8ff, 0.35);
      rim.position.set(-6, 6, -4);
      this.scene.add(rim);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.ShadowMaterial({ opacity: 0.32 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      this.scene.add(floor);

      const world = (this.world = new CANNON.World());
      world.gravity.set(0, -9.82 * 3, 0);
      world.broadphase = new CANNON.NaiveBroadphase();
      world.solver.iterations = 14;

      this.matDice = new CANNON.Material("dice");
      this.matGround = new CANNON.Material("ground");
      world.addContactMaterial(new CANNON.ContactMaterial(this.matDice, this.matGround, { friction: 0.25, restitution: 0.62 }));
      world.addContactMaterial(new CANNON.ContactMaterial(this.matDice, this.matDice, { friction: 0.25, restitution: 0.62 }));

      const ground = new CANNON.Body({ mass: 0, material: this.matGround, shape: new CANNON.Plane() });
      ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      world.add(ground);

      const ceiling = new CANNON.Body({ mass: 0, material: this.matGround, shape: new CANNON.Plane() });
      ceiling.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
      ceiling.position.set(0, CEILING, 0);
      world.add(ceiling);

      const A = this.arena;
      const walls = [
        { p: [0, 0, -A], ax: [0, 0, 1], a: 0 },
        { p: [0, 0, A], ax: [0, 1, 0], a: Math.PI },
        { p: [-A, 0, 0], ax: [0, 1, 0], a: Math.PI / 2 },
        { p: [A, 0, 0], ax: [0, 1, 0], a: -Math.PI / 2 },
      ];
      for (const wd of walls) {
        const wl = new CANNON.Body({ mass: 0, material: this.matGround, shape: new CANNON.Plane() });
        wl.position.set(wd.p[0], wd.p[1], wd.p[2]);
        wl.quaternion.setFromAxisAngle(new CANNON.Vec3(wd.ax[0], wd.ax[1], wd.ax[2]), wd.a);
        world.add(wl);
      }

      const geo = roundedBoxGeometry(DIE_SIZE, DIE_RADIUS, 4);
      const materials = ["px", "nx", "py", "ny", "pz", "nz"].map(
        (f) => new THREE.MeshPhongMaterial({ map: faceTexture(FACE_VALUES[f]), shininess: 32, specular: 0x333333 }));
      const half = DIE_SIZE / 2;

      this.dice = [];
      for (let i = 0; i < 2; i++) {
        const mesh = new THREE.Mesh(geo, materials);
        mesh.castShadow = true;
        this.scene.add(mesh);
        const physHalf = half * 0.94;
        const body = new CANNON.Body({
          mass: 1, material: this.matDice,
          shape: new CANNON.Box(new CANNON.Vec3(physHalf, physHalf, physHalf)),
          linearDamping: 0.35, angularDamping: 0.45,
        });
        body.allowSleep = false;
        world.add(body);
        this.dice.push({ mesh, body });
      }

      this.rolling = false;
      this._snapAnim = null;
      this._acc = 0;
      this._lastT = 0;

      const onResize = () => this.resize();
      window.addEventListener("resize", onResize);
      if (window.ResizeObserver) new ResizeObserver(onResize).observe(parent);
      requestAnimationFrame(() => this.loop());
    }

    resize() {
      const parent = this.canvas.parentElement;
      const w = parent.clientWidth, h = parent.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    }

    /** Deterministic throw driven entirely by the server payload. */
    throwFromPayload(pl) {
      const targets = [canonicalQuat(pl.d1), canonicalQuat(pl.d2)];
      const spawns = [pl.spawn1, pl.spawn2];
      const spins = [pl.spin1, pl.spin2];
      const impulses = [pl.impulse1, pl.impulse2];
      const torques = [pl.torque1, pl.torque2];

      this.dice.forEach((d, i) => {
        const b = d.body;
        b.position.set(spawns[i][0], spawns[i][1], spawns[i][2]);
        b.quaternion.setFromEuler(spins[i][0], spins[i][1], spins[i][2]);
        b.velocity.set(impulses[i][0], impulses[i][1], impulses[i][2]);
        b.angularVelocity.set(torques[i][0], torques[i][1], torques[i][2]);
        b.wakeUp && b.wakeUp();
      });

      this.targets = targets;
      this.rolling = true;
      this._stableFrames = 0;
      this._snapAnim = null;
      this._done = false;
      this._startedAt = performance.now();
      this._lastT = this._startedAt;
      this._acc = 0;
    }

    _beginSnap() {
      if (this._snapAnim) return;
      const half = DIE_SIZE / 2 * 0.98;
      const targets = this.dice.map((d, i) => ({
        from: d.mesh.quaternion.clone(),
        to: this.targets[i].clone(),
      }));
      for (const d of this.dice) {
        d.body.velocity.set(0, 0, 0);
        d.body.angularVelocity.set(0, 0, 0);
        d.body.position.y = Math.max(half, Math.min(d.body.position.y, CEILING - half));
      }
      this._snapAnim = { startedAt: performance.now(), dur: SNAP_MS, targets };
    }

    loop() {
      requestAnimationFrame(() => this.loop());
      const now = performance.now();

      if (this.rolling) {
        if (this._snapAnim) {
          const k = Math.min((now - this._snapAnim.startedAt) / this._snapAnim.dur, 1);
          const s = k * k * (3 - 2 * k);
          const q = new THREE.Quaternion();
          this._snapAnim.targets.forEach((t, i) => {
            q.copy(t.from).slerp(t.to, s);
            const d = this.dice[i];
            d.mesh.quaternion.copy(q);
            d.body.quaternion.copy(q);
          });
          if (k >= 1) { this._snapAnim = null; this.rolling = false; }
        } else {
          /* Fixed-step accumulator: identical physics on any refresh rate. */
          let dt = (now - this._lastT) / 1000;
          this._lastT = now;
          if (dt > 0.1) dt = 0.1;
          this._acc += dt;
          while (this._acc >= 1 / 60) {
            this.world.step(1 / 60);
            this._acc -= 1 / 60;
          }

          const calm = this.dice.every((d) =>
            d.body.velocity.length() < SETTLE_SPEED &&
            d.body.angularVelocity.length() < SETTLE_SPEED);
          const elapsed = now - this._startedAt;

          if (elapsed > 650 && calm) {
            this._stableFrames += 1;
            if (this._stableFrames >= SETTLE_FRAMES) this._beginSnap();
          } else {
            this._stableFrames = 0;
            if (elapsed > MAX_ROLL_MS) this._beginSnap(); // fail-safe
          }
        }
      }

      if (!this._snapAnim) {
        for (const d of this.dice) {
          d.mesh.position.copy(d.body.position);
          d.mesh.quaternion.copy(d.body.quaternion);
        }
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  return api;
})();

/* ============================== GAME OVER =============================== */

function onGameOver(snap) {
  const alive = snap.players.filter((p) => p.alive);
  $("#over-winner").textContent = alive.length === 1
    ? `${alive[0].name} je pobjednik!`
    : "Nema pobjednika — svi su bankrotirali.";
  const amHost = snap.hostId === S.myId;
  $("#btn-restart").style.display = amHost ? "inline-block" : "none";
  $("#over-wait").style.display = amHost ? "none" : "block";
  openOverlay("#overlay-gameover");
}

function initGameOver() {
  $("#btn-restart").addEventListener("click", () => S.socket.emit("restartGame"));
}

/* ================================ BOOT ================================== */

(async function boot() {
  await loadBoard();
  connect();
  initHome();
  initLobby();
  initCardModal();
  initTradeUi();
  initGameOver();
})();
