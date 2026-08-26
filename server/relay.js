/* ============================================================================
 * Balkan Tycoon — relay.js
 * Multiplayer relay server (socket.io). Serves the static game AND mediates
 * rooms. Authority model: HOST-AUTHORITATIVE — the host client runs the game
 * engine; this server manages rooms, relays events/actions, stores the latest
 * state snapshot (for late join + host migration) and broadcasts chat.
 *
 * Message schema (socket.io events)
 * ─────────────────────────────────
 * client → server
 *   room:create   (profile, cb -> { ok, code, token })
 *   room:join     (code, profile, cb -> { ok, token })
 *   room:rejoin   (code, token, cb -> { ok, isHost })
 *   room:leave    ()
 *   lobby:ready   (ready:boolean)
 *   game:start    ()                                  [host]
 *   host:state    (snapshot)                          [host → server → guests]
 *   host:event    (event)                             [host → server → guests]
 *        event = { kind:"log", icon, color, text }
 *              | { kind:"pawn-move", playerId, from, steps }
 *              | { kind:"teleport", playerId, pos }
 *              | { kind:"roll-result", d1, d2 }
 *              | { kind:"turn", deadline }            (45s turn timer)
 *              | { kind:"prompt", to, prompt }        (buy/card/jail modal)
 *              | { kind:"game-over", winnerId, reason }
 *   player:action (action)                            [guest → server → host]
 *        action = { kind:"roll" } | { kind:"end-turn" }
 *               | { kind:"prompt-response", id, value }
 *               | { kind:"build", tileId } | { kind:"sell", tileId }
 *   trade:offer   ({ to, giveCash, giveTiles, wantCash, wantTiles })
 *   trade:respond ({ accept:boolean, trade })         [target → server → host]
 *   chat:send     (text)
 *
 * server → client
 *   room:state    ({ code, hostId, players:[{id,name,icon,color,ready,
 *                 connected,isHost}], status, state?, turnDeadline? })
 *   game:started  (roster)
 *   host:event    (event)           relayed to everyone (incl. sender echo=false)
 *   player:action (action, fromId)  relayed to host only
 *   trade:offer   (trade, fromId)   relayed to target only
 *   trade:respond (payload, fromId) relayed to host only
 *   host:migrated ({ hostId, state })  new host must take over the engine
 *   chat:message  ({ name, color, text, system })
 *   error         (message)
 * ========================================================================== */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.join(import.meta.dirname, "..");
const MAX_PLAYERS = 6;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/* Lobby palette (must match js/tokens.js PLAYER_COLORS). */
const PALETTE = [
  "#EF4444", "#06B6D4", "#10B981", "#F59E0B",
  "#8B5CF6", "#EC4899", "#F97316", "#3B82F6",
];

/** Clamp a lobby match-settings payload into a safe shape. */
function sanitizeSettings(raw) {
  const r = raw ?? {};
  const cash = Number(r.startCash);
  const max = Number(r.maxPlayers);
  const timer = r.turnTimer == null ? null : Number(r.turnTimer);
  return {
    startCash: [500, 800, 1000, 1500, 2000].includes(cash) ? cash : 1500,
    maxPlayers: Number.isFinite(max) ? Math.min(6, Math.max(2, Math.floor(max))) : 4,
    turnTimer: [30, 45, 60].includes(timer) ? timer : null,
    rules: {
      kafanaJackpot: r.rules?.kafanaJackpot !== false,
      doubleRent: r.rules?.doubleRent !== false,
      auctions: r.rules?.auctions === true,
    },
  };
}

function firstFreeColor(seats) {
  const taken = new Set(seats.map((s) => String(s.color).toUpperCase()));
  return PALETTE.find((c) => !taken.has(c)) ?? PALETTE[seats.length % PALETTE.length];
}

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {string} hostToken
 * @property {Seat[]} seats
 * @property {"lobby"|"playing"|"finished"} status
 * @property {object|null} state   latest host snapshot (for migration/late join)
 * @property {number|null} turnDeadline
 */

/**
 * @typedef {Object} Seat
 * @property {string} id      socket id (refreshed on reconnect)
 * @property {string} token   stable player id (survives reconnects)
 * @property {boolean} ready
 * @property {boolean} connected
 */

function newCode() {
  for (;;) {
    let code = "";
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
}

function sanitizeProfile(p) {
  const raw = p ?? {};
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 16) : "";
  const style = Number(raw.tokenStyle);
  return {
    name: name || "Player",
    icon: "meeple",
    color: typeof raw.color === "string" && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : null,
    tokenStyle: Number.isFinite(style) ? Math.min(7, Math.max(0, Math.floor(style))) : null,
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostToken,
    status: room.status,
    state: room.state,
    turnDeadline: room.turnDeadline,
    settings: room.settings,
    players: room.seats.map((s) => ({
      id: s.token,
      name: s.name,
      icon: s.icon,
      color: s.color,
      tokenStyle: s.tokenStyle,
      ready: s.ready,
      connected: s.connected,
      isHost: s.token === room.hostToken,
    })),
  };
}

const broadcast = (room) => io.to(room.code).emit("room:state", publicRoom(room));

/** Tear a room down and tell any connected clients so they never hang. */
const closeRoom = (room, reason) => {
  io.to(room.code).emit("room:closed", { reason });
  rooms.delete(room.code);
};

function seatBySocket(room, socketId) {
  return room.seats.find((s) => s.id === socketId);
}

function hostSocket(room) {
  const seat = room.seats.find((s) => s.token === room.hostToken);
  return seat ? seat.id : null;
}

/* ---------- static file serving (single-port deploy) ---------- */

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const httpServer = http.createServer((req, res) => {
  if (!req.url) { res.writeHead(400).end(); return; }
  const rel = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" }).end(data);
  });
});

const io = new Server(httpServer, { cors: { origin: "*" } });

/* Lightweight event log — invaluable when debugging multiplayer rooms. */
function slog(socket, msg) {
  console.log(`[relay] ${new Date().toISOString().slice(11, 19)} ${socket.id.slice(0, 6)} ${msg}`);
}

io.on("connection", (socket) => {
  let currentCode = null;
  slog(socket, "connected");

  const room = () => rooms.get(currentCode ?? "");

  const systemChat = (r, text) =>
    io.to(r.code).emit("chat:message", { name: "Lobby", color: "#f4b73f", text, system: true });

  const leaveRoom = () => {
    const r = room();
    currentCode = null;
    if (!r) return;
    const idx = r.seats.findIndex((s) => s.id === socket.id);
    if (idx === -1) return;
    const seat = r.seats[idx];

    if (r.status === "lobby") {
      r.seats.splice(idx, 1);
      systemChat(r, `${seat.name} left the lobby`);
      if (r.seats.length === 0) { closeRoom(r, "empty"); return; }
      if (r.hostToken === seat.token) migrateHost(r);
      broadcast(r);
      return;
    }

    // in-progress: keep the seat, mark offline
    seat.connected = false;
    systemChat(r, `${seat.name} disconnected`);
    if (!r.seats.some((s) => s.connected)) { closeRoom(r, "everyone-left"); return; }
    if (r.hostToken === seat.token) migrateHost(r);
    broadcast(r);
  };

  function migrateHost(r) {
    const next = r.seats.find((s) => s.connected);
    if (!next) return;
    r.hostToken = next.token;
    systemChat(r, `${next.name} is now the host`);
    io.to(next.id).emit("host:migrated", { hostId: next.token, state: r.state });
  }

  /* ----- lobby ----- */

  socket.on('room:create', (rawProfile, rawSettings, cb) => {
    slog(socket, "room:create");
    const profile = sanitizeProfile(rawProfile);
    if (!profile.color) profile.color = firstFreeColor([]);
    const token = crypto.randomUUID();
    const r = {
      code: newCode(),
      hostToken: token,
      seats: [{ id: socket.id, token, ...profile, ready: true, connected: true }],
      status: "lobby",
      settings: sanitizeSettings(rawSettings),
      state: null,
      turnDeadline: null,
    };
    rooms.set(r.code, r);
    currentCode = r.code;
    void socket.join(r.code);
    cb?.({ ok: true, code: r.code, token });
    broadcast(r);
  });

  socket.on('room:join', (codeRaw, rawProfile, cb) => {
    slog(socket, "room:join " + String(codeRaw ?? ""));
    const code = String(codeRaw ?? "").trim().toUpperCase();
    const r = rooms.get(code);
    if (!r) return void cb?.({ ok: false, error: "Room not found — check the code." });
    if (r.status !== "lobby") return void cb?.({ ok: false, error: "Game already in progress." });
    const cap = (r.settings && r.settings.maxPlayers) || MAX_PLAYERS;
    if (r.seats.length >= Math.min(cap, MAX_PLAYERS)) {
      return void cb?.({ ok: false, error: `Room is full (${cap} players max).` });
    }

    const profile = sanitizeProfile(rawProfile);
    profile.color = firstFreeColor(r.seats);
    const token = crypto.randomUUID();
    r.seats.push({ id: socket.id, token, ...profile, ready: false, connected: true });
    currentCode = r.code;
    void socket.join(r.code);
    systemChat(r, `${profile.name} joined the lobby`);
    cb?.({ ok: true, token });
    broadcast(r);
  });

  socket.on('room:rejoin', (codeRaw, tokenRaw, cb) => {
    slog(socket, "room:rejoin");
    const code = String(codeRaw ?? "").trim().toUpperCase();
    const token = String(tokenRaw ?? "");
    const r = rooms.get(code);
    const seat = r?.seats.find((s) => s.token === token);
    if (!r || !seat) return void cb?.({ ok: false, error: "Session expired." });
    if (seat.id !== socket.id && io.sockets.sockets.has(seat.id)) {
      // the seat is alive on another socket (second tab / device) — never hijack
      return void cb?.({ ok: false, error: "This player is already connected." });
    }
    seat.id = socket.id;
    seat.connected = true;
    currentCode = r.code;
    void socket.join(r.code);
    systemChat(r, `${seat.name} reconnected`);

    if (r.status !== "lobby" && r.hostToken === seat.token) {
      // the reload wiped the host's live engine — hand authority to another
      // connected seat; the returning player continues as a guest
      const next = r.seats.find((s) => s.connected && s.token !== seat.token);
      if (next) {
        r.hostToken = next.token;
        systemChat(r, `${next.name} is now the host`);
        io.to(next.id).emit("host:migrated", { hostId: next.token, state: r.state });
      }
    }
    cb?.({ ok: true, isHost: r.hostToken === token });
    broadcast(r);
    if (r.status !== "lobby") {
      // mid-match rejoin: rebuild the client view from the stored snapshot
      socket.emit("game:started", publicRoom(r).players, r.settings);
      if (r.state) socket.emit("host:state", r.state);
    }
  });

  socket.on('lobby:ready', (ready) => {
    slog(socket, "lobby:ready " + Boolean(ready));
    const r = room();
    if (!r || r.status !== "lobby") return;
    const seat = seatBySocket(r, socket.id);
    if (!seat) return;
    seat.ready = Boolean(ready);
    broadcast(r);
  });

  /** Host-only: update the match settings shown to everyone. */
  socket.on("lobby:settings", (raw) => {
    const r = room();
    if (!r || r.status !== "lobby") return;
    if (seatBySocket(r, socket.id)?.token !== r.hostToken) return;
    const prevMax = (r.settings && r.settings.maxPlayers) || MAX_PLAYERS;
    r.settings = sanitizeSettings(raw);
    // shrinking below the current roster would strand seats — clamp instead
    if (r.seats.length > r.settings.maxPlayers) {
      r.settings.maxPlayers = Math.min(prevMax, Math.min(MAX_PLAYERS, r.seats.length));
    }
    broadcast(r);
  });

  /** Claim a color if it is still free. */
  socket.on("lobby:color", (hexRaw) => {
    const r = room();
    if (!r || r.status !== "lobby") return;
    const seat = seatBySocket(r, socket.id);
    if (!seat) return;
    const hex = String(hexRaw ?? "").toUpperCase();
    if (!PALETTE.includes(hex)) return;
    if (r.seats.some((s) => s !== seat && String(s.color).toUpperCase() === hex)) return;
    seat.color = hex.toLowerCase();
    broadcast(r);
  });

  /** Pick a token face style. */
  socket.on("lobby:avatar", (idxRaw) => {
    const r = room();
    if (!r || r.status !== "lobby") return;
    const seat = seatBySocket(r, socket.id);
    if (!seat) return;
    const idx = Number(idxRaw);
    if (!Number.isFinite(idx)) return;
    seat.tokenStyle = Math.min(7, Math.max(0, Math.floor(idx)));
    broadcast(r);
  });

  socket.on('game:start', () => {
    slog(socket, "game:start");
    const r = room();
    if (!r || r.status !== "lobby") return;
    if (seatBySocket(r, socket.id)?.token !== r.hostToken) return;
    if (r.seats.length < 2 || !r.seats.every((s) => s.ready)) return;
    r.status = "playing";
    io.to(r.code).emit("game:started", publicRoom(r).players, r.settings);
    broadcast(r);
  });

  /* ----- host → guests relays ----- */

  socket.on("host:state", (snapshot) => {
    const r = room();
    if (!r || seatBySocket(r, socket.id)?.token !== r.hostToken) return;
    r.state = snapshot; // stored for late join + host migration
    const peers = [...io.sockets.adapter.rooms.get(r.code) ?? []];
    slog(socket, `host:state -> room ${r.code} peers=[${peers.map(s => s.slice(0, 6)).join(",")}]`);
    socket.to(r.code).emit("host:state", snapshot);
  });

  socket.on("host:event", (event) => {
    const r = room();
    if (!r || seatBySocket(r, socket.id)?.token !== r.hostToken) return;
    if (!event || typeof event.kind !== "string") return;
    if (event.kind === "turn" && event.deadline) r.turnDeadline = Number(event.deadline);
    if (event.kind === "game-over") r.status = "finished";
    if (event.kind !== "log") slog(socket, `host:event ${event.kind}`);
    socket.to(r.code).emit("host:event", event);
  });

  /* ----- guest → host relays ----- */

  socket.on("player:action", (action) => {
    const r = room();
    if (!r) return;
    const seat = seatBySocket(r, socket.id);
    const hostId = hostSocket(r);
    if (!seat || !hostId) return;
    io.to(hostId).emit("player:action", action, seat.token);
  });

  /* ----- trading relays ----- */

  socket.on("trade:offer", (trade) => {
    const r = room();
    if (!r || r.status !== "playing") return;
    const from = seatBySocket(r, socket.id);
    const target = r.seats.find((s) => s.token === trade?.to);
    if (!from || !target || from.token === target.token || !target.connected) return;
    io.to(target.id).emit("trade:offer", trade, from.token);
  });

  socket.on("trade:respond", (payload) => {
    const r = room();
    if (!r) return;
    const seat = seatBySocket(r, socket.id);
    const hostId = hostSocket(r);
    if (!seat || !hostId) return;
    io.to(hostId).emit("trade:respond", payload, seat.token);
  });

  /* ----- chat ----- */

  socket.on("chat:send", (text) => {
    const r = room();
    const seat = r ? seatBySocket(r, socket.id) : null;
    if (!seat) return;
    const clean = String(text ?? "").slice(0, 140).trim();
    if (!clean) return;
    io.to(r.code).emit("chat:message", { name: seat.name, color: seat.color, text: clean, system: false });
  });

  socket.on("room:leave", leaveRoom);
  socket.on("disconnect", leaveRoom);
});

httpServer.listen(PORT, () => {
  console.log(`Balkan Tycoon multiplayer on http://localhost:${PORT}`);
});
