import http from "node:http"
import path from "node:path"
import { Server } from "socket.io"
import type { Socket } from "socket.io"
import { createGame, reducer } from "../src/game/engine"
import type { Action, GameState, PlayerDef } from "../src/game/engineTypes"
import { PRESETS, TURN_TIMER_OPTIONS, type LobbyPlayer, type PublicRoom, type RoomSettings, type ClientToServerEvents, type ServerToClientEvents } from "../src/net/protocol"

type Profile = Pick<PlayerDef, "name" | "icon" | "color">

type Seat = {
  id: string // socket id (updated on reconnect)
  token: string
  name: string
  icon: string
  color: string
  ready: boolean
  connected: boolean
}

type Room = {
  code: string
  hostToken: string
  seats: Seat[]
  settings: RoomSettings
  status: "lobby" | "playing" | "finished"
  game: GameState | null
  turnDeadline: number | null
  timer: ReturnType<typeof setTimeout> | null
}

const PORT = Number(process.env.PORT ?? 3001)
const rooms = new Map<string, Room>()

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

function newCode(): string {
  for (;;) {
    let code = ""
    const bytes = crypto.getRandomValues(new Uint8Array(5))
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length]
    if (!rooms.has(code)) return code
  }
}

function sanitizeProfile(p: unknown): Profile {
  const raw = (p ?? {}) as Partial<Profile>
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 16) : ""
  return {
    name: name || "Player",
    icon: typeof raw.icon === "string" && raw.icon ? raw.icon : "🎲",
    color: typeof raw.color === "string" && raw.color ? raw.color : "#22c55e",
  }
}

function lobbyPlayers(room: Room): LobbyPlayer[] {
  return room.seats.map((s) => ({
    id: s.token,
    name: s.name,
    icon: s.icon,
    color: s.color,
    ready: s.ready,
    connected: s.connected,
    isHost: s.token === room.hostToken,
  }))
}

function publicRoom(room: Room): PublicRoom {
  return {
    code: room.code,
    hostId: room.hostToken,
    players: lobbyPlayers(room),
    settings: room.settings,
    status: room.status,
    game: room.game,
    turnDeadline: room.turnDeadline,
  }
}

const AUTO_PLAY: Partial<Record<GameState["phase"], Action>> = {
  "awaiting-roll": { type: "ROLL" },
  "awaiting-jail": { type: "ROLL_JAIL" },
  "awaiting-buy": { type: "DECLINE_BUY" },
  "turn-end": { type: "END_TURN" },
}

function rollDice(): [number, number] {
  return [
    1 + crypto.getRandomValues(new Uint8Array(1))[0] % 6,
    1 + crypto.getRandomValues(new Uint8Array(1))[0] % 6,
  ]
}

/** Clear + re-arm the auto-play timer; must run before every broadcast. */
function armTurnTimer(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  room.timer = null
  room.turnDeadline = null

  if (room.status !== "playing" || !room.game || room.game.phase === "game-over") return
  const secs = room.settings.turnSeconds
  if (!secs) return

  room.turnDeadline = Date.now() + secs * 1000
  room.timer = setTimeout(() => {
    room.timer = null
    room.turnDeadline = null
    const g = room.game
    let action = g ? AUTO_PLAY[g.phase] : undefined
    if (!g || !action) return
    if (action.type === "ROLL" || action.type === "ROLL_JAIL") action = { type: action.type, dice: rollDice() }
    room.game = reducer(g, action)
    if (room.game.phase === "game-over") room.status = "finished"
    broadcast(room)
  }, secs * 1000)
}

function deleteRoom(room: Room) {
  if (room.timer) clearTimeout(room.timer)
  rooms.delete(room.code)
}

function broadcast(room: Room) {
  armTurnTimer(room)
  io.to(room.code).emit("room:state", publicRoom(room))
}


function seatBySocket(room: Room, socketId: string) {
  return room.seats.find((s) => s.id === socketId)
}

function startGame(room: Room) {
  // engine player ids = seat tokens, so identity survives reconnects
  const defs = room.seats.map((s) => ({ id: s.token, name: s.name, icon: s.icon, color: s.color }))
  const preset = PRESETS[room.settings.preset]
  room.game = createGame(defs, {
    startingCash: preset.startingCash,
    goReward: preset.goReward,
    maxTurns: preset.maxTurns,
  })
  room.status = "playing"
}

/* ---------- http + static serving for production ---------- */

const httpServer = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400).end()
    return
  }
  const distDir = path.join(import.meta.dirname, "..", "dist")
  const rel = req.url.split("?")[0]
  const file = path.join(distDir, rel === "/" ? "index.html" : rel)
  import("node:fs").then((fs) => {
    if (!file.startsWith(distDir) || !fs.existsSync(file)) {
      fs.readFile(path.join(distDir, "index.html"), (err, data) => {
        if (err) { res.writeHead(404).end("Not found"); return }
        res.writeHead(200, { "Content-Type": "text/html" }).end(data)
      })
      return
    }
    const ext = path.extname(file)
    const mime =
      ext === ".js" ? "text/javascript" :
      ext === ".css" ? "text/css" :
      ext === ".html" ? "text/html" :
      ext === ".svg" ? "image/svg+xml" :
      ext === ".woff2" ? "font/woff2" : "application/octet-stream"
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return }
      res.writeHead(200, { "Content-Type": mime }).end(data)
    })
  })
})

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
})

io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  let currentRoomCode: string | null = null

  const joinRoomChannel = (room: Room) => {
    currentRoomCode = room.code
    void socket.join(room.code)
    broadcast(room)
  }

  const leaveCurrentRoom = () => {
    if (!currentRoomCode) return
    const room = rooms.get(currentRoomCode)
    currentRoomCode = null
    if (!room) return
    const idx = room.seats.findIndex((s) => s.id === socket.id)
    if (idx === -1) return

    if (room.status === "lobby") {
      const seat = room.seats[idx]
      room.seats.splice(idx, 1)
      if (room.hostToken === seat.token) {
        if (room.seats.length > 0) room.hostToken = room.seats[0].token
        else { deleteRoom(room); io.to(room.code).emit("error", "Room closed"); return }
      }
      if (room.seats.length === 0) return
      broadcast(room)
    } else {
      const seat = room.seats[idx]
      seat.connected = false
      // everyone gone mid-game → tear the room down
      if (!room.seats.some((s) => s.connected)) {
        deleteRoom(room)
        return
      }
      // keep host powers with someone present
      if (room.hostToken === seat.token) {
        const next = room.seats.find((s) => s.connected)
        if (next) room.hostToken = next.token
      }
      broadcast(room)
    }
  }

  socket.on("room:create", (rawProfile, cb) => {
    const profile = sanitizeProfile(rawProfile)
    const room: Room = {
      code: newCode(),
      hostToken: "",
      seats: [],
      settings: { preset: "standard", turnSeconds: 60 },
      status: "lobby",
      game: null,
      turnDeadline: null,
      timer: null,
    }
    const token = crypto.randomUUID()
    room.hostToken = token
    room.seats.push({ id: socket.id, token, ...profile, ready: false, connected: true })
    rooms.set(room.code, room)
    cb?.({ ok: true, code: room.code, token })
    joinRoomChannel(room)
  })

  socket.on("room:join", (codeRaw, rawProfile, cb) => {
    const code = String(codeRaw ?? "").trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) {
      cb?.({ ok: false, error: "Room not found — check the code." })
      return
    }
    if (room.status !== "lobby") {
      cb?.({ ok: false, error: "Game already in progress." })
      return
    }
    if (room.seats.length >= 6) {
      cb?.({ ok: false, error: "Room is full (6 players max)." })
      return
    }

    const profile = sanitizeProfile(rawProfile)
    const takenColors = new Set(room.seats.map((s) => s.color))
    if (takenColors.has(profile.color)) {
      profile.color = ["#22c55e", "#a855f7", "#3b82f6", "#f59e0b", "#ef4444", "#06b6d4"].find((c) => !takenColors.has(c))!
    }
    const token = crypto.randomUUID()
    room.seats.push({ id: socket.id, token, ...profile, ready: false, connected: true })
    cb?.({ ok: true, token })
    joinRoomChannel(room)
  })

  // rejoin an in-progress game by stored token (page reload / dropped tab)
  socket.on("room:rejoin", (codeRaw, tokenRaw, cb) => {
    const code = String(codeRaw ?? "").trim().toUpperCase()
    const token = String(tokenRaw ?? "")
    const room = rooms.get(code)
    const seat = room?.seats.find((s) => s.token === token)
    if (!room || !seat) {
      cb?.({ ok: false, error: "Session expired." })
      return
    }
    seat.id = socket.id
    seat.connected = true
    cb?.({ ok: true })
    joinRoomChannel(room)
  })

  socket.on("player:update", (patch) => {
    const room = rooms.get(currentRoomCode ?? "")
    if (!room || room.status !== "lobby") return
    const seat = seatBySocket(room, socket.id)
    if (!seat) return
    const p = sanitizeProfile({ ...seat, ...(typeof patch === "object" ? patch : {}) })
    seat.name = p.name
    seat.icon = p.icon
    seat.color = p.color
    broadcast(room)
  })

  socket.on("player:ready", (ready) => {
    const room = rooms.get(currentRoomCode ?? "")
    if (!room || room.status !== "lobby") return
    const seat = seatBySocket(room, socket.id)
    if (!seat) return
    seat.ready = Boolean(ready)
    broadcast(room)
  })

  socket.on("settings:update", (settings) => {
    const room = rooms.get(currentRoomCode ?? "")
    if (!room || room.status !== "lobby") return
    if (seatBySocket(room, socket.id)?.token !== room.hostToken) return
    if (!settings || !(settings.preset in PRESETS)) return
    const turnSeconds = Number(settings.turnSeconds ?? 60)
    room.settings = {
      preset: settings.preset,
      turnSeconds: TURN_TIMER_OPTIONS.includes(turnSeconds as (typeof TURN_TIMER_OPTIONS)[number]) ? turnSeconds : 60,
    }
    broadcast(room)
  })

  socket.on("game:start", () => {
    const room = rooms.get(currentRoomCode ?? "")
    if (!room || room.status !== "lobby") return
    if (seatBySocket(room, socket.id)?.token !== room.hostToken) return
    if (room.seats.length < 2) return
    if (!room.seats.every((s) => s.ready)) return
    startGame(room)
    broadcast(room)
  })

  socket.on("game:action", (raw) => {
    const room = rooms.get(currentRoomCode ?? "")
    if (!room || !room.game || room.status !== "playing") return
    const action = raw as Action
    if (!action || typeof action.type !== "string") return

    const needsTurn =
      action.type === "ROLL" || action.type === "BUY" || action.type === "DECLINE_BUY" ||
      action.type === "PAY_JAIL" || action.type === "USE_JAIL_CARD" || action.type === "ROLL_JAIL" ||
      action.type === "END_TURN"
    const myToken = seatBySocket(room, socket.id)?.token
    if (needsTurn && room.game.currentId !== myToken) return
    if ((action.type === "BUILD" || action.type === "SELL_BUILDING") && room.game.props[(action as { tileId: string }).tileId]?.ownerId !== myToken) return

    // server rolls the dice — clients never send dice values
    let cleanAction: Action = action
    if (action.type === "ROLL" || action.type === "ROLL_JAIL") {
      cleanAction = { type: action.type, dice: rollDice() }
    }
    if (action.type === "BUILD" || action.type === "SELL_BUILDING") {
      if (typeof (action as { tileId?: unknown }).tileId !== "string") return
    }

    // trades are identified by the sender's seat, never by client-supplied ids
    if (action.type === "TRADE_OFFER") {
      const myToken = seatBySocket(room, socket.id)?.token
      if (!myToken || myToken === action.to) return
      cleanAction = {
        type: "TRADE_OFFER",
        actorId: myToken,
        to: String(action.to),
        giveCash: Number(action.giveCash) || 0,
        giveTiles: Array.isArray(action.giveTiles) ? action.giveTiles.map(String) : [],
        wantCash: Number(action.wantCash) || 0,
        wantTiles: Array.isArray(action.wantTiles) ? action.wantTiles.map(String) : [],
      }
    } else if (action.type === "TRADE_ACCEPT" || action.type === "TRADE_DECLINE") {
      const t = room.game.pendingTrade
      const myToken = seatBySocket(room, socket.id)?.token
      if (!t || !myToken || t.to !== myToken) return
      cleanAction = { type: action.type, actorId: myToken }
    }

    room.game = reducer(room.game, cleanAction)
    if (room.game.phase === "game-over") room.status = "finished"
    broadcast(room)
  })

  socket.on("game:back-to-lobby", () => {
    const room = rooms.get(currentRoomCode ?? "")
    if (!room || room.status !== "finished") return
    if (seatBySocket(room, socket.id)?.token !== room.hostToken) return
    room.game = null
    room.status = "lobby"
    for (const s of room.seats) s.ready = false
    broadcast(room)
  })

  socket.on("room:leave", () => {
    leaveCurrentRoom()
  })

  socket.on("disconnect", () => {
    leaveCurrentRoom()
  })
})

httpServer.listen(PORT, () => {
  console.log(`Balkan Tycoon server on http://localhost:${PORT}`)
})

