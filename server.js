/* ============================================================================
 * Balkanski Tajkun — server.js
 * Single-file authoritative game server.
 *
 *  - express.static('public') serves the client
 *  - Socket.io rooms with 5-letter codes, locked token (color) assignment
 *  - THE SERVER owns the whole game state: money, positions, deeds,
 *    houses/hotels, jail, rent, decks. Clients only render and request
 *    actions; every mutation is validated here.
 *  - Deterministic dice: on playerRollDice the server draws d1/d2 with a
 *    CSPRNG and derives one shared seed. From that seed it generates the
 *    exact impulse/torque/spawn vectors that EVERY client replays through
 *    an identical Three.js + Cannon.js simulation, so all screens show the
 *    same tumble landing on the same faces.
 *  - Trading: offer -> target accept/decline -> atomic swap executed here.
 *  - NO AUCTIONS: declining to buy ("Preskoci") simply advances the turn.
 * ========================================================================== */

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

/* ============================== BOARD DATA ============================== */

const ECONOMY = {
  startCash: 1500,
  goReward: 200,
  jailFee: 50,
  jailTurnsMax: 3,
  houseCostRate: 0.5,
  sellRate: 0.5,
  baseRentRate: 0.1,
  monopolyMultiplier: 2,
  houseMultipliers: [1, 5, 12, 28, 40], // level 0..4 (4 = hotel)
  airportRent: [25, 50, 100, 200],
  utilityMultipliers: [4, 10],
};

const COUNTRIES = {
  mk: { id: "mk", name: "Sjeverna Makedonija", color: "#955436" },
  al: { id: "al", name: "Albanija", color: "#6ec3ea" },
  me: { id: "me", name: "Crna Gora", color: "#e0449b" },
  ba: { id: "ba", name: "Bosna i Hercegovina", color: "#f7941d" },
  bg: { id: "bg", name: "Bugarska", color: "#ed1b24" },
  rs: { id: "rs", name: "Srbija", color: "#e6c519" },
  hr: { id: "hr", name: "Hrvatska", color: "#1fb25a" },
  si: { id: "si", name: "Slovenija", color: "#2b4bd8" },
};

const city = (id, name, country, price) => ({
  id, kind: "city", name, country, price,
  baseRent: Math.round(price * ECONOMY.baseRentRate),
  houseCost: Math.round(price * ECONOMY.houseCostRate),
});
const airport = (id, name) => ({ id, kind: "airport", name, price: 200 });
const utilityTile = (id, name) => ({ id, kind: "utility", name, price: 150 });
const cornerTile = (id, c, name, sub) => ({ id, kind: "corner", corner: c, name, sub });
const surpriseTile = () => ({ kind: "surprise", name: "IZNENAĐENJE", icon: "?" });
const eventTile = () => ({ kind: "event", name: "BALKAN DOGAĐAJ", icon: "!" });

/* Ring order: bottom (MK+AL) -> left (ME+BA) -> top (BG+RS) -> right (HR+SI).
 * Index 0 = START (bottom-right corner), movement counter-clockwise. */
const TILES = [
  cornerTile("start", "start", "START", "Primi €200 pri prolasku"), // 0
  city("bitola", "Bitola", "mk", 60),                               // 1
  surpriseTile(),                                                   // 2
  city("ohrid", "Ohrid", "mk", 60),                                 // 3
  city("skoplje", "Skoplje", "mk", 80),                             // 4
  airport("zl-skopje", "ZRAČNA LUKA SKOPJE"),                       // 5
  city("skadar", "Skadar", "al", 100),                              // 6
  eventTile(),                                                      // 7
  city("drac", "Drač", "al", 100),                                  // 8
  city("tirana", "Tirana", "al", 120),                              // 9

  cornerTile("zatvor", "jail", "ZATVOR", "Samo u posjeti"),         // 10
  city("niksic", "Nikšić", "me", 140),                              // 11
  utilityTile("struja", "ELEKTRIČNA MREŽA"),                        // 12
  city("budva", "Budva", "me", 140),                                // 13
  city("podgorica", "Podgorica", "me", 160),                        // 14
  airport("zl-sarajevo", "ZRAČNA LUKA SARAJEVO"),                   // 15
  city("mostar", "Mostar", "ba", 180),                              // 16
  surpriseTile(),                                                   // 17
  city("banja-luka", "Banja Luka", "ba", 180),                      // 18
  city("sarajevo", "Sarajevo", "ba", 200),                          // 19

  cornerTile("parking", "parking", "BESPLATAN PARKING", "Odmaraj besplatno"), // 20
  city("varna", "Varna", "bg", 220),                                // 21
  eventTile(),                                                      // 22
  city("plovdiv", "Plovdiv", "bg", 220),                            // 23
  city("sofija", "Sofija", "bg", 240),                              // 24
  airport("zl-beograd", "ZRAČNA LUKA BEOGRAD"),                     // 25
  city("nis", "Niš", "rs", 260),                                    // 26
  city("novi-sad", "Novi Sad", "rs", 260),                          // 27
  utilityTile("vodovod", "VODOVOD"),                                // 28
  city("beograd", "Beograd", "rs", 280),                            // 29

  cornerTile("idi-zatvor", "gotojail", "IDI U ZATVOR", "Odmah u zatvor"), // 30
  city("osijek", "Osijek", "hr", 300),                              // 31
  city("split", "Split", "hr", 300),                                // 32
  surpriseTile(),                                                   // 33
  city("zagreb", "Zagreb", "hr", 320),                              // 34
  airport("zl-zagreb", "ZRAČNA LUKA ZAGREB"),                       // 35
  eventTile(),                                                      // 36
  city("maribor", "Maribor", "si", 350),                            // 37
  { kind: "tax", name: "CARINA / POREZ", amount: 100 },             // 38
  city("ljubljana", "Ljubljana", "si", 400),                        // 39
];
TILES.forEach((t, i) => { t.index = i; if (!t.id) t.id = "t" + i; });
const TILE_BY_ID = Object.fromEntries(TILES.map((t) => [t.id, t]));

const GROUPS = {};
for (const c of Object.keys(COUNTRIES)) {
  GROUPS[c] = TILES.filter((t) => t.kind === "city" && t.country === c).map((t) => t.id);
}
const tileIndex = (id) => TILE_BY_ID[id].index;

/* ================================ DECKS ================================= */

const DECKS = {
  surprise: [
    { text: "Banka ti isplaćuje dividendu. Primaj €50.", act: { gain: 50 } },
    { text: "Prebrzo si vozio obalom. Plati €30 kazne.", act: { pay: 30 } },
    { text: "Vraćaš se na START. Primi €200.", act: { moveTo: 0 } },
    { text: "Idi u ZATVOR. Ne prolaziš kroz START.", act: { jail: true } },
    { text: "Porezni povrat: primaj €20.", act: { gain: 20 } },
    { text: "Naprijed 3 polja.", act: { moveBy: 3 } },
    { text: "Vrati se 3 polja unazad.", act: { moveBy: -3 } },
    { text: "Osvojio si natjecanje u pripremi rakije. Primaj €100.", act: { gain: 100 } },
    { text: "Račun za struju stigao je ranije. Plati €60.", act: { pay: 60 } },
    { text: "Baština iz Bake: primaj €150.", act: { gain: 150 } },
  ],
  event: [
    { text: "Grand marketing u Splitu: primaj €120.", act: { gain: 120 } },
    { text: "Poslovni put: idi na ZRAČNU LUKU ZAGREB.", act: { moveTo: 35 } },
    { text: "Cestarine na autocesti A1: plati €90.", act: { pay: 90 } },
    { text: "Rođendan! Svaki igrač ti daruje €30.", act: { collectEach: 30 } },
    { text: "Idi na BESPLATAN PARKING.", act: { moveTo: 20 } },
    { text: "Poplava u podrumu: popravak košta €80.", act: { pay: 80 } },
    { text: "Vraćaš knjige gradskoj knjižnici: primaj €10.", act: { gain: 10 } },
    { text: "Poslovni skup: idi na SOFIJU.", act: { moveTo: 24 } },
    { text: "Godišnji odmor u Crnoj Gori: plati €70.", act: { pay: 70 } },
    { text: "Loterijski dobici: primaj €100.", act: { gain: 100 } },
  ],
};

/* ============================ LOBBY / ROOMS ============================= */

const TOKENS = [
  { color: "#e0393f", name: "crveni" },
  { color: "#2f6fed", name: "plavi" },
  { color: "#23a55a", name: "zeleni" },
  { color: "#f2b722", name: "žuti" },
  { color: "#8b5cf6", name: "ljubičasti" },
  { color: "#f07f2d", name: "narančasti" },
];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_PLAYERS = 6;
const DICE_RESOLVE_MS = 3400;   // matches client physics window + snap
const TURN_TIMEOUT_MS = 90_000; // idle decisions are auto-played
const OFFER_TTL_MS = 60_000;

/** @type {Map<string, Room>} */
const rooms = new Map();

let ioRef = null; // assigned once the io server exists

const fail = (socketId, message) => {
  const s = ioRef?.sockets?.sockets?.get(socketId);
  if (s) s.emit("error", { message });
};

function newCode() {
  for (;;) {
    let code = "";
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
}

const cleanName = (raw) => {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 16);
  return s || "Igrač";
};

function createRoom(hostSocket, name) {
  const room = {
    code: newCode(),
    hostId: hostSocket.id,
    status: "lobby",
    players: [],
    phase: null,
    current: -1,
    owners: {},        // tileId -> socketId | undefined
    houses: {},        // tileId -> 0..4
    lastRoll: null,
    pendingTile: null, // active buy decision
    doublesRun: 0,
    deckPos: { surprise: 0, event: 0 },
    log: [], seq: 0,
    offers: new Map(),
    timers: {},
    deadline: null,
  };
  rooms.set(room.code, room);
  addPlayer(room, hostSocket, name);
  return room;
}

function addPlayer(room, socket, name) {
  const used = new Set(room.players.map((p) => p.token));
  const token = TOKENS.find((t) => !used.has(t.color)) ?? TOKENS[room.players.length % TOKENS.length];
  room.players.push({
    id: socket.id, name: cleanName(name), token: token.color,
    money: 0, pos: 0, inJail: false, jailTurns: 0, alive: true,
  });
}

function freeTokens(room) {
  const used = new Set(room.players.map((p) => p.token));
  return TOKENS.filter((t) => !used.has(t.color)).map((t) => t.color);
}

/* ============================== LOGGING ================================= */

function log(room, text) {
  room.log.push({ seq: ++room.seq, text });
  if (room.log.length > 200) room.log.splice(0, room.log.length - 200);
}

const fmt = (n) => `€${Number(n).toLocaleString("hr-HR")}`;

/* ============================ SNAPSHOTS ================================= */

const currentId = (room) =>
  (room.current >= 0 && room.players[room.current] ? room.players[room.current].id : null);
const cur = (room) => room.players[room.current];
const playerName = (room, id) => room.players.find((p) => p.id === id)?.name ?? "Igrač";

function countDeeds(room, pid) {
  return Object.values(room.owners).filter((o) => o === pid).length;
}

function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    phase: room.phase,
    current: currentId(room),
    players: room.players.map((p) => ({
      id: p.id, name: p.name, token: p.token, money: p.money,
      pos: p.pos, inJail: p.inJail, alive: p.alive,
      deeds: countDeeds(room, p.id),
    })),
    owners: room.owners,
    houses: room.houses,
    lastRoll: room.lastRoll,
    pendingTile: room.pendingTile,
    freeTokens: freeTokens(room),
    log: room.log.slice(-60),
    deadline: room.deadline,
  };
}

const lobbyState = (room) => ({
  code: room.code, hostId: room.hostId,
  players: room.players.map((p) => ({ id: p.id, name: p.name, token: p.token })),
  freeTokens: freeTokens(room),
});

const broadcastState = (io, room) => io.to(room.code).emit("state", publicState(room));
const broadcastLobby = (io, room) => io.to(room.code).emit("lobby", lobbyState(room));

/* ======================= DETERMINISTIC DICE SEEDS ======================= */

/** mulberry32 — tiny deterministic PRNG; the same seed replays identically
 *  on every client, so shared vectors guarantee identical trajectories. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rr = (rng, min, max) => min + rng() * (max - min);

function generateDicePayload() {
  const d1 = 1 + crypto.randomInt(6);
  const d2 = 1 + crypto.randomInt(6);
  const seed = crypto.randomInt(1, 2147483647);
  const rng = mulberry32(seed);
  return {
    d1, d2, seed,
    spawn1: [rr(rng, -1.3, -0.7), rr(rng, 2.6, 3.8), rr(rng, -0.8, 0.8)],
    spawn2: [rr(rng, 0.7, 1.3), rr(rng, 2.6, 3.8), rr(rng, -0.8, 0.8)],
    spin1: [rr(rng, 0, Math.PI * 2), rr(rng, 0, Math.PI * 2), rr(rng, 0, Math.PI * 2)],
    spin2: [rr(rng, 0, Math.PI * 2), rr(rng, 0, Math.PI * 2), rr(rng, 0, Math.PI * 2)],
    impulse1: [rr(rng, -3, 3), rr(rng, 7.5, 11.5), rr(rng, -3, 3)],
    impulse2: [rr(rng, -3, 3), rr(rng, 7.5, 11.5), rr(rng, -3, 3)],
    torque1: [rr(rng, -17, 17), rr(rng, -17, 17), rr(rng, -17, 17)],
    torque2: [rr(rng, -17, 17), rr(rng, -17, 17), rr(rng, -17, 17)],
  };
}

/* =========================== MONEY MECHANICS ============================ */

function gain(room, p, amount) {
  p.money += amount;
  log(room, `${p.name} prima ${fmt(amount)}.`);
}

/**
 * Pay `amount` from player index pIdx to creditor index (null = bank).
 * Auto-liquidates buildings at half price when short; bankrupts otherwise.
 * @returns {boolean} true when fully paid.
 */
function pay(room, pIdx, amount, creditorIdx) {
  const p = room.players[pIdx];
  if (amount <= 0 || !p.alive) return p.alive;

  if (p.money < amount) liquidateAll(room, pIdx);

  if (p.money >= amount) {
    p.money -= amount;
    if (creditorIdx == null) log(room, `${p.name} plaća ${fmt(amount)} banci.`);
    else {
      const c = room.players[creditorIdx];
      c.money += amount;
      log(room, `${p.name} plaća ${fmt(amount)} igraču ${c.name}.`);
    }
    return true;
  }

  /* Bankruptcy: everything goes to the creditor (or back to the bank). */
  const shortfall = amount - Math.max(p.money, 0);
  if (creditorIdx != null) {
    const c = room.players[creditorIdx];
    c.money += p.money + shortfall; // creditor always receives the full debt
    transferDeeds(room, pIdx, creditorIdx);
    log(room, `${p.name} je bankrotirao. Sve nekretnine preuzima ${c.name}.`);
  } else {
    resetDeeds(room, pIdx);
    log(room, `${p.name} je bankrotirao prema banci.`);
  }
  p.money = 0;
  p.alive = false;
  checkWin(room);
  return false;
}

function liquidateAll(room, pIdx) {
  const p = room.players[pIdx];
  let sold = 0;
  for (const [tileId, lvl] of Object.entries(room.houses)) {
    if (lvl > 0 && room.owners[tileId] === p.id) {
      sold += Math.round(TILE_BY_ID[tileId].houseCost * ECONOMY.sellRate) * lvl;
      room.houses[tileId] = 0;
    }
  }
  if (sold > 0) {
    p.money += sold;
    log(room, `${p.name} prodaje sve zgrade za ${fmt(sold)}.`);
  }
}

function transferDeeds(room, fromIdx, toIdx) {
  const from = room.players[fromIdx], to = room.players[toIdx];
  for (const [tileId, owner] of Object.entries(room.owners)) {
    if (owner === from.id) room.owners[tileId] = to.id;
  }
  for (const tileId of Object.keys(room.houses)) room.houses[tileId] = 0;
}
function resetDeeds(room, pIdx) {
  const from = room.players[pIdx];
  for (const [tileId, owner] of Object.entries(room.owners)) {
    if (owner === from.id) delete room.owners[tileId];
  }
  for (const tileId of Object.keys(room.houses)) room.houses[tileId] = 0;
}

const groupOwned = (room, country, pid) => GROUPS[country].every((id) => room.owners[id] === pid);
const airportsOwned = (room, pid) => TILES.filter((t) => t.kind === "airport" && room.owners[t.id] === pid).length;
const utilitiesOwned = (room, pid) => TILES.filter((t) => t.kind === "utility" && room.owners[t.id] === pid).length;

function rentFor(room, tile, ownerId) {
  if (tile.kind === "city") {
    const lvl = room.houses[tile.id] || 0;
    if (lvl === 0) {
      const mono = groupOwned(room, tile.country, ownerId);
      return tile.baseRent * (mono ? ECONOMY.monopolyMultiplier : 1);
    }
    return tile.baseRent * ECONOMY.houseMultipliers[lvl];
  }
  if (tile.kind === "airport") return ECONOMY.airportRent[airportsOwned(room, ownerId) - 1] ?? 25;
  if (tile.kind === "utility") {
    const mult = ECONOMY.utilityMultipliers[utilitiesOwned(room, ownerId) - 1] ?? 4;
    const dice = (room.lastRoll?.d1 ?? 1) + (room.lastRoll?.d2 ?? 1);
    return dice * mult;
  }
  return 0;
}

/* ============================= TURN ENGINE ============================== */

function clearTimers(room) {
  for (const k of ["turn", "dice"]) {
    if (room.timers[k]) { clearTimeout(room.timers[k]); room.timers[k] = null; }
  }
  room.deadline = null;
}

function armTurnTimer(io, room) {
  clearTimers(room);
  room.deadline = Date.now() + TURN_TIMEOUT_MS;
  room.timers.turn = setTimeout(() => autoAction(io, room), TURN_TIMEOUT_MS);
}

function autoAction(io, room) {
  if (room.status !== "playing") return;
  log(room, "Isteklo je vrijeme za odluku — sustav odigrava umjesto tebe.");
  switch (room.phase) {
    case "roll": doRoll(io, room); break;
    case "buy": resolveBuy(io, room, false); break;
    case "jail": jailPay(io, room); break;
    case "end": endTurn(io, room); break;
  }
}

function startGame(io, room) {
  room.status = "playing";
  for (const p of room.players) {
    p.money = ECONOMY.startCash;
    p.pos = 0; p.inJail = false; p.jailTurns = 0; p.alive = true;
  }
  room.owners = {}; room.houses = {}; room.lastRoll = null;
  room.doublesRun = 0; room.pendingTile = null;
  room.deckPos = {
    surprise: crypto.randomInt(DECKS.surprise.length),
    event: crypto.randomInt(DECKS.event.length),
  };
  room.offers.clear();
  log(room, "Igra je počela. Sretno!");
  beginTurn(io, room, crypto.randomInt(room.players.length));
}

function restartGame(io, room) {
  if (room.status !== "over") return;
  startGame(io, room);
}

function beginTurn(io, room, idx) {
  room.current = idx;
  room.doublesRun = 0;
  room.lastRoll = null;
  room.phase = cur(room).inJail ? "jail" : "roll";
  armTurnTimer(io, room);
  broadcastState(io, room);
}

function nextAliveIdx(room, from) {
  for (let step = 1; step <= room.players.length; step++) {
    const i = (from + step) % room.players.length;
    if (room.players[i].alive) return i;
  }
  return -1;
}

function endTurn(io, room) {
  if (checkWin(room)) { broadcastState(io, room); return; }
  const nxt = nextAliveIdx(room, room.current);
  if (nxt === -1) { checkWin(room); broadcastState(io, room); return; }
  beginTurn(io, room, nxt);
}

function checkWin(room) {
  const alive = room.players.filter((p) => p.alive);
  if (room.status === "playing" && alive.length <= 1) {
    room.status = "over";
    room.phase = "gameover";
    clearTimers(room);
    log(room, alive.length === 1 ? `${alive[0].name} je pobjednik!` : "Svi su bankrotirali.");
    return true;
  }
  return false;
}

/* ------------------------------ ROLLING --------------------------------- */

function doRoll(io, room) {
  const payload = generateDicePayload();
  room.lastRoll = { d1: payload.d1, d2: payload.d2 };
  room.phase = "rolling";
  clearTimers(room);
  io.to(room.code).emit("diceRolled", { roller: cur(room).id, ...payload });
  log(room, `${cur(room).name} baca kocke...`);
  broadcastState(io, room);
  room.timers.dice = setTimeout(() => applyRoll(io, room), DICE_RESOLVE_MS);
}

function applyRoll(io, room) {
  if (room.status !== "playing" || room.phase !== "rolling") return;
  const p = cur(room);
  const { d1, d2 } = room.lastRoll;
  const total = d1 + d2;
  const doubles = d1 === d2;

  /* Attempting to leave jail by rolling a double */
  if (p.inJail) {
    if (doubles) {
      p.inJail = false; p.jailTurns = 0;
      log(room, `${p.name} bacanjem para izlazi iz zatvora!`);
      movePlayer(io, room, p, total, { extraOnDouble: false });
    } else {
      p.jailTurns += 1;
      if (p.jailTurns >= ECONOMY.jailTurnsMax) {
        log(room, `${p.name} ne uspijeva treći put — plaća kauciju ${fmt(ECONOMY.jailFee)}.`);
        if (!pay(room, room.current, ECONOMY.jailFee, null)) { finishMove(io, room, false); return; }
        p.inJail = false; p.jailTurns = 0;
        movePlayer(io, room, p, total, { extraOnDouble: false });
      } else {
        log(room, `${p.name} ostaje u zatvoru (${p.jailTurns}/${ECONOMY.jailTurnsMax}).`);
        room.phase = "end";
        armTurnTimer(io, room);
        broadcastState(io, room);
      }
    }
    return;
  }

  room.doublesRun = doubles ? room.doublesRun + 1 : 0;

  /* Three consecutive doubles -> straight to jail */
  if (doubles && room.doublesRun >= 3) {
    log(room, `${p.name} baca treći par uzastopno — ide u ZATVOR!`);
    sendToJail(io, room, p);
    return;
  }

  movePlayer(io, room, p, total, { extraOnDouble: doubles });
}

function movePlayer(io, room, p, steps, { extraOnDouble }) {
  const old = p.pos;
  p.pos = (p.pos + steps) % 40;
  if (p.pos < old) {
    gain(room, p, ECONOMY.goReward);
    log(room, `${p.name} prolazi kroz START.`);
  }
  landOn(io, room, p, { extraOnDouble });
}

function sendToJail(io, room, p) {
  p.pos = tileIndex("zatvor");
  p.inJail = true;
  p.jailTurns = 0;
  room.doublesRun = 0;
  log(room, `${p.name} završava u ZATVORU.`);
  room.phase = "end";
  armTurnTimer(io, room);
  broadcastState(io, room);
}

/* ------------------------------ LANDING --------------------------------- */

function landOn(io, room, p, ctx) {
  const tile = TILES[p.pos];
  room.phase = "resolving";

  switch (tile.kind) {
    case "corner": {
      if (tile.corner === "gotojail") { sendToJail(io, room, p); return; }
      log(room, `${p.name} staje na polju ${tile.name}.`);
      break;
    }
    case "tax": {
      log(room, `${p.name} staje na CARINI / POREZU.`);
      pay(room, room.current, tile.amount, null);
      break;
    }
    case "surprise":
    case "event": {
      drawCard(io, room, p, tile.kind);
      return; // card effects own the continuation
    }
    case "city":
    case "airport":
    case "utility": {
      const owner = room.owners[tile.id];
      if (!owner) {
        if (p.money >= tile.price) {
          room.pendingTile = tile.id;
          room.phase = "buy";
          armTurnTimer(io, room);
          broadcastState(io, room);
          return;
        }
        log(room, `${tile.name}: ${p.name} nema dovoljno novca za kupnju.`);
      } else if (owner === p.id) {
        log(room, `${p.name} staje na svojem polju ${tile.name}.`);
      } else {
        const ownerIdx = room.players.findIndex((pl) => pl.id === owner);
        const rent = rentFor(room, tile, owner);
        log(room, `${tile.name}: najamnica iznosi ${fmt(rent)}.`);
        pay(room, room.current, rent, ownerIdx);
      }
      break;
    }
  }

  finishMove(io, room, ctx.extraOnDouble === true);
}

function drawCard(io, room, p, deckKind) {
  const deck = DECKS[deckKind];
  room.deckPos[deckKind] = (room.deckPos[deckKind] + 1) % deck.length;
  const card = deck[room.deckPos[deckKind]];
  const deckName = deckKind === "surprise" ? "IZNENAĐENJE" : "BALKAN DOGAĐAJ";
  log(room, `${deckName}: ${card.text}`);
  io.to(room.code).emit("cardDrawn", { deck: deckName, text: card.text, seq: room.seq });
  const a = card.act;

  if (a.gain) gain(room, p, a.gain);
  if (a.pay) pay(room, room.current, a.pay, null);
  if (a.collectEach) {
    for (let i = 0; i < room.players.length; i++) {
      if (i !== room.current && room.players[i].alive) pay(room, i, a.collectEach, room.current);
    }
  }
  if (a.jail) { sendToJail(io, room, p); return; }
  if (a.moveTo != null) {
    const old = p.pos;
    p.pos = a.moveTo % 40;
    if (p.pos < old) { gain(room, p, ECONOMY.goReward); log(room, `${p.name} prolazi kroz START.`); }
    landOn(io, room, p, {}); // chain the landing
    return;
  }
  if (a.moveBy != null) {
    p.pos = ((p.pos + a.moveBy) % 40 + 40) % 40;
    landOn(io, room, p, {});
    return;
  }
  finishMove(io, room, false);
}

function finishMove(io, room, extraOnDouble) {
  /* Current player may have gone bankrupt paying during this move. */
  if (!cur(room).alive) {
    if (checkWin(room)) { broadcastState(io, room); return; }
    const nxt = nextAliveIdx(room, room.current);
    if (nxt === -1) { broadcastState(io, room); return; }
    beginTurn(io, room, nxt);
    return;
  }
  if (extraOnDouble && !cur(room).inJail) room.phase = "roll"; // throw again
  else room.phase = "end";
  armTurnTimer(io, room);
  broadcastState(io, room);
}

/* ------------------------------- BUYING --------------------------------- */

function resolveBuy(io, room, buy) {
  const p = cur(room);
  const tile = TILE_BY_ID[room.pendingTile];
  room.pendingTile = null;
  if (!tile) { room.phase = "end"; armTurnTimer(io, room); broadcastState(io, room); return; }

  if (buy && p.money >= tile.price && !room.owners[tile.id]) {
    p.money -= tile.price;
    room.owners[tile.id] = p.id;
    log(room, `${p.name} kupuje ${tile.name} za ${fmt(tile.price)}.`);
  } else if (!buy) {
    // NO auction: skipping simply moves the game forward.
    log(room, `${p.name} preskače kupnju (${tile.name}).`);
  }
  /* A double roll still earns the extra throw after the decision. */
  finishMove(io, room, room.doublesRun > 0);
}

/* ------------------------------- JAIL PAY ------------------------------- */

function jailPay(io, room) {
  const p = cur(room);
  if (!p.inJail || room.phase !== "jail") return;
  if (p.money < ECONOMY.jailFee) return fail(p.id, "Nemaš dovoljno novca za kauciju.");
  p.money -= ECONOMY.jailFee;
  p.inJail = false; p.jailTurns = 0;
  log(room, `${p.name} plaća kauciju ${fmt(ECONOMY.jailFee)} i izlazi iz zatvora.`);
  room.phase = "roll";
  armTurnTimer(io, room);
  broadcastState(io, room);
}

/* --------------------------- BUILD / SELL ------------------------------- */

function canBuild(room, pid, tile) {
  if (!tile || tile.kind !== "city") return false;
  if (room.owners[tile.id] !== pid) return false;
  if (!groupOwned(room, tile.country, pid)) return false;
  const levels = GROUPS[tile.country].map((id) => room.houses[id] || 0);
  const minLvl = Math.min(...levels);
  return (room.houses[tile.id] || 0) === minLvl && minLvl < 4; // even build, hotel at 4
}
function canSell(room, pid, tile) {
  if (!tile || tile.kind !== "city") return false;
  if (room.owners[tile.id] !== pid) return false;
  const levels = GROUPS[tile.country].map((id) => room.houses[id] || 0);
  const maxLvl = Math.max(...levels);
  return (room.houses[tile.id] || 0) === maxLvl && maxLvl > 0;
}

function build(io, room, socketId, tileId) {
  const p = room.players.find((x) => x.id === socketId);
  const tile = TILE_BY_ID[tileId];
  if (!p?.alive || room.status !== "playing") return fail(socketId, "Gradnja nije moguća.");
  if (!canBuild(room, socketId, tile)) return fail(socketId, "Gradnja je moguća samo na kompletnoj boji s ravnomjernom razinom.");
  if (p.money < tile.houseCost) return fail(socketId, "Nemaš dovoljno novca za kuću.");
  p.money -= tile.houseCost;
  room.houses[tile.id] = (room.houses[tile.id] || 0) + 1;
  const lvl = room.houses[tile.id];
  log(room, lvl === 4 ? `${p.name} gradi HOTEL na polju ${tile.name}.` : `${p.name} gradi kuću na polju ${tile.name}.`);
  broadcastState(io, room);
}

function sellBuilding(io, room, socketId, tileId) {
  const p = room.players.find((x) => x.id === socketId);
  const tile = TILE_BY_ID[tileId];
  if (!p?.alive || room.status !== "playing") return fail(socketId, "Prodaja nije moguća.");
  if (!canSell(room, socketId, tile)) return fail(socketId, "Prodaja nije moguća (ravnomjerna razina).");
  room.houses[tile.id] -= 1;
  const refund = Math.round(tile.houseCost * ECONOMY.sellRate);
  p.money += refund;
  log(room, `${p.name} prodaje zgradu na polju ${tile.name} za ${fmt(refund)}.`);
  broadcastState(io, room);
}

/* =============================== TRADING ================================ */

const arrIds = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 40) : []);
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(v) || 0)));

const serializeOffer = (room, offer) => ({
  id: offer.id, from: offer.from, to: offer.to,
  fromName: playerName(room, offer.from), toName: playerName(room, offer.to),
  giveTiles: offer.giveTiles, giveMoney: offer.giveMoney,
  getTiles: offer.getTiles, getMoney: offer.getMoney,
});

function validateTrade(room, fromId, toId, giveTiles, getTiles, giveMoney, getMoney) {
  const from = room.players.find((p) => p.id === fromId);
  const to = room.players.find((p) => p.id === toId);
  if (!from?.alive || !to?.alive) return "Igrač više nije u igri.";
  if (giveMoney > from.money) return "Nemaš toliko novca.";
  if (getMoney > to.money) return `${to.name} nema toliko novca.`;
  for (const id of giveTiles) {
    const t = TILE_BY_ID[id];
    if (!t || room.owners[id] !== fromId) return "Ne posjeduješ jedno od ponuđenih polja.";
    if ((room.houses[id] || 0) > 0) return `Polje ${t.name} ima zgrade — prvo ih prodaj.`;
  }
  for (const id of getTiles) {
    const t = TILE_BY_ID[id];
    if (!t || room.owners[id] !== toId) return `${to.name} ne posjeduje jedno od traženih polja.`;
    if ((room.houses[id] || 0) > 0) return `Polje ${t.name} ima zgrade — prvo ih prodaj.`;
  }
  return null;
}

function tradeOffer(io, room, socket, body) {
  if (socket.id !== currentId(room) || !["roll", "end"].includes(room.phase))
    return fail(socket.id, "Trguješ samo tijekom svoga poteza.");
  const giveTiles = arrIds(body?.giveTiles);
  const getTiles = arrIds(body?.getTiles);
  const giveMoney = clampInt(body?.giveMoney, 0, 999999);
  const getMoney = clampInt(body?.getMoney, 0, 999999);
  if (!body?.to || body.to === socket.id) return fail(socket.id, "Odaberi igrača za razmjenu.");
  if (!giveTiles.length && !getTiles.length && !giveMoney && !getMoney)
    return fail(socket.id, "Ponuda je prazna.");

  const err = validateTrade(room, socket.id, body.to, giveTiles, getTiles, giveMoney, getMoney);
  if (err) return fail(socket.id, err);

  /* One live offer per pair: replace any stale one. */
  for (const [oid, o] of room.offers)
    if (o.from === socket.id || o.to === socket.id) room.offers.delete(oid);

  const offer = {
    id: crypto.randomBytes(6).toString("hex"),
    from: socket.id, to: body.to,
    giveTiles, giveMoney, getTiles, getMoney,
    expires: Date.now() + OFFER_TTL_MS,
  };
  room.offers.set(offer.id, offer);
  const toSock = io.sockets.sockets.get(body.to);
  if (toSock) toSock.emit("tradeIncoming", serializeOffer(room, offer));
  socket.emit("tradeSent", serializeOffer(room, offer));
}

function tradeRespond(io, room, socket, { offerId, accept }) {
  const offer = room.offers.get(String(offerId || ""));
  if (!offer || offer.to !== socket.id) return fail(socket.id, "Ponuda više nije dostupna.");
  room.offers.delete(offer.id);

  if (!accept) {
    const from = io.sockets.sockets.get(offer.from);
    if (from) from.emit("tradeResolved", { accepted: false, byName: playerName(room, socket.id) });
    log(room, `${playerName(room, socket.id)} odbija ponudu igrača ${playerName(room, offer.from)}.`);
    broadcastState(io, room);
    return;
  }

  /* Re-validate atomically at execution time. */
  const err = validateTrade(room, offer.from, offer.to, offer.giveTiles, offer.getTiles, offer.giveMoney, offer.getMoney);
  if (err) {
    const from = io.sockets.sockets.get(offer.from);
    if (from) from.emit("tradeResolved", { expired: true, message: err });
    broadcastState(io, room);
    return;
  }

  const from = room.players.find((p) => p.id === offer.from);
  const to = room.players.find((p) => p.id === offer.to);
  from.money -= offer.giveMoney; to.money += offer.giveMoney;
  to.money -= offer.getMoney;   from.money += offer.getMoney;
  for (const id of offer.giveTiles) room.owners[id] = offer.to;
  for (const id of offer.getTiles) room.owners[id] = offer.from;

  log(room, `Razmjena je izvršena: ${from.name} i ${to.name} mijenjaju polja i novac.`);
  io.to(room.code).emit("tradeResolved", { accepted: true, fromName: from.name, toName: to.name });
  broadcastState(io, room);
}

function sweepOffers(io) {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const [oid, o] of room.offers) {
      if (o.expires < now) {
        room.offers.delete(oid);
        const from = io.sockets.sockets.get(o.from);
        if (from) from.emit("tradeResolved", { expired: true, message: "Ponuda je istekla." });
      }
    }
  }
}

/* ============================ SOCKET WIRING ============================= */

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/api/board", (_req, res) =>
  res.json({ tiles: TILES, groups: GROUPS, countries: COUNTRIES, economy: ECONOMY }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });
ioRef = io;
setInterval(() => sweepOffers(io), 15000);

io.on("connection", (socket) => {
  let room = null;

  socket.on("createRoom", ({ name } = {}) => {
    if (room) return;
    room = createRoom(socket, name);
    socket.join(room.code);
    socket.emit("joined", { code: room.code, playerId: socket.id });
    broadcastLobby(io, room);
  });

  socket.on("joinRoom", ({ code, name } = {}) => {
    if (room) return;
    const r = rooms.get(String(code || "").toUpperCase().trim());
    if (!r) return fail(socket.id, "Soba ne postoji. Provjeri šifru.");
    if (r.status === "playing") return fail(socket.id, "Igra je već u tijeku.");
    if (r.players.length >= MAX_PLAYERS) return fail(socket.id, "Soba je puna.");
    room = r;
    addPlayer(r, socket, name);
    socket.join(r.code);
    socket.emit("joined", { code: r.code, playerId: socket.id });
    broadcastLobby(io, r);
  });

  socket.on("pickToken", ({ color } = {}) => {
    if (!room || room.status !== "lobby") return;
    const me = room.players.find((p) => p.id === socket.id);
    if (!me) return;
    const taken = room.players.some((p) => p.token === color && p.id !== me.id);
    if (taken) return fail(socket.id, "Ta boja je već zauzeta.");
    me.token = color;
    broadcastLobby(io, room);
  });

  socket.on("leaveRoom", () => leave());

  socket.on("startGame", () => {
    if (!room || socket.id !== room.hostId || room.status !== "lobby") return;
    if (room.players.length < 2) return fail(socket.id, "Potrebna su najmanje 2 igrača.");
    startGame(io, room);
    io.to(room.code).emit("gameStarted", publicState(room));
  });

  socket.on("restartGame", () => {
    if (!room || socket.id !== room.hostId || room.status !== "over") return;
    restartGame(io, room);
  });

  socket.on("playerRollDice", () => {
    if (!room || room.status !== "playing") return;
    if (socket.id !== currentId(room)) return fail(socket.id, "Nije tvoj potez.");
    if (room.phase === "jail") return void doRoll(io, room); // roll for freedom
    if (room.phase !== "roll") return fail(socket.id, "Kocke se već vrte.");
    doRoll(io, room);
  });

  socket.on("decideBuy", ({ buy } = {}) => {
    if (!room || room.status !== "playing") return;
    if (socket.id !== currentId(room) || room.phase !== "buy")
      return fail(socket.id, "Odluka o kupnji nije na redu.");
    resolveBuy(io, room, Boolean(buy));
  });

  socket.on("jailPay", () => {
    if (!room || room.status !== "playing") return;
    if (socket.id !== currentId(room) || room.phase !== "jail")
      return fail(socket.id, "Nisi na redu za odluku u zatvoru.");
    jailPay(io, room);
  });

  socket.on("build", ({ tileId } = {}) => { if (room) build(io, room, socket.id, tileId); });
  socket.on("sell", ({ tileId } = {}) => { if (room) sellBuilding(io, room, socket.id, tileId); });

  socket.on("tradeOffer", (body) => { if (room) tradeOffer(io, room, socket, body); });
  socket.on("tradeRespond", (body) => { if (room) tradeRespond(io, room, socket, body || {}); });

  socket.on("endTurn", () => {
    if (!room || room.status !== "playing") return;
    if (socket.id !== currentId(room) || room.phase !== "end")
      return fail(socket.id, "Potez još ne možeš završiti.");
    clearTimers(room);
    log(room, `${playerName(room, socket.id)} završava potez.`);
    endTurn(io, room);
  });

  function leave() {
    if (!room) return;
    const r = room;
    room = null;
    socket.leave(r.code);

    const me = r.players.find((p) => p.id === socket.id);
    if (!me) return;

    if (r.status === "lobby") {
      r.players = r.players.filter((p) => p.id !== socket.id);
      if (!r.players.length) { clearTimers(r); rooms.delete(r.code); return; }
      if (r.hostId === socket.id) r.hostId = r.players[0].id;
      broadcastLobby(io, r);
      return;
    }

    /* In-game departure counts as forfeit: deeds return to the bank. */
    me.alive = false;
    resetDeeds(r, r.players.indexOf(me));
    log(r, `${me.name} napušta igru.`);
    for (const [oid, o] of r.offers) {
      if (o.from === socket.id || o.to === socket.id) r.offers.delete(oid);
    }
    if (currentId(r) === socket.id && r.status === "playing") endTurn(io, r);
    else { checkWin(r); broadcastState(io, r); }
  }

  socket.on("disconnect", () => leave());
});

httpServer.listen(PORT, () => {
  console.log(`Balkanski Tajkun server radi na portu ${PORT}`);
});
