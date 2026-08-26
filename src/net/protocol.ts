import type { GameState, PlayerDef } from "../game/engineTypes"

export const PRESETS = {
  quick: { label: "Quick", startingCash: 450, goReward: 70, maxTurns: 70 },
  standard: { label: "Standard", startingCash: 600, goReward: 80, maxTurns: 100 },
  extended: { label: "Extended", startingCash: 800, goReward: 100, maxTurns: 130 },
} as const

export type PresetId = keyof typeof PRESETS

export type RoomSettings = {
  preset: PresetId
  /** 0 = off; otherwise seconds per turn before auto-play kicks in */
  turnSeconds: number
}

export const TURN_TIMER_OPTIONS = [0, 30, 60, 90] as const

export type LobbyPlayer = {
  id: string
  name: string
  icon: string
  color: string
  ready: boolean
  connected: boolean
  isHost: boolean
}

export type RoomStatus = "lobby" | "playing" | "finished"

export type PublicRoom = {
  code: string
  hostId: string
  players: LobbyPlayer[]
  settings: RoomSettings
  status: RoomStatus
  game: GameState | null
  /** epoch ms when the current player gets auto-played; null when timer off */
  turnDeadline: number | null
}

/* ---------- client -> server ---------- */

export type ClientToServerEvents = {
  "room:create": (
    profile: Pick<PlayerDef, "name" | "icon" | "color">,
    cb: (res: { ok: boolean; code?: string; token?: string; error?: string }) => void
  ) => void
  "room:join": (
    code: string,
    profile: Pick<PlayerDef, "name" | "icon" | "color">,
    cb: (res: { ok: boolean; token?: string; error?: string }) => void
  ) => void
  "room:rejoin": (
    code: string,
    token: string,
    cb: (res: { ok: boolean; error?: string }) => void
  ) => void
  "player:update": (profile: Partial<Pick<PlayerDef, "name" | "icon" | "color">>) => void
  "player:ready": (ready: boolean) => void
  "settings:update": (settings: RoomSettings) => void
  "game:start": () => void
  "game:action": (action: unknown) => void
  "game:back-to-lobby": () => void
  "room:leave": () => void
}

/* ---------- server -> client ---------- */

export type ServerToClientEvents = {
  "room:state": (room: PublicRoom) => void
  error: (message: string) => void
}
