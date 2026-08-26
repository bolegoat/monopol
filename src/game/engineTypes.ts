import type { CountryId } from "./types"

export type PlayerState = {
  id: string
  name: string
  icon: string
  color: string
  cash: number
  position: number
  inJail: boolean
  jailTurns: number
  getOutCards: number
  discountNext: boolean
  rentShield: boolean
  bankrupt: boolean
}

export type PropState = {
  ownerId: string | null
  level: number // 0 = empty, 1-3 = houses, 4 = hotel
  mortgaged: boolean
}

export type Phase =
  | "awaiting-roll"
  | "awaiting-buy"
  | "awaiting-jail"
  | "turn-end"
  | "game-over"

export type LogEntry = {
  id: number
  icon: string
  color: string
  text: string
}

export type DrawnCard = {
  deck: "event" | "surprise"
  icon: string
  text: string
}

export type PendingTrade = {
  from: string
  to: string
  giveCash: number
  giveTiles: string[]
  wantCash: number
  wantTiles: string[]
}

export type GameState = {
  players: PlayerState[]
  props: Record<string, PropState>
  currentId: string
  turn: number
  maxTurns: number
  dice: [number, number] | null
  rolledDoubles: boolean
  doublesCount: number
  phase: Phase
  pendingTileId: string | null
  log: LogEntry[]
  logSeq: number
  winner: { playerId: string; reason: string } | null
  eventDeck: number[]
  surpriseDeck: number[]
  lastDrawn: DrawnCard | null
  goReward: number
  pendingTrade: PendingTrade | null
}

export type PlayerDef = {
  id?: string
  name: string
  icon: string
  color: string
}

export type GameOptions = {
  startingCash?: number
  goReward?: number
  maxTurns?: number
}

export type Action =
  | { type: "ROLL"; dice?: [number, number] }
  | { type: "BUY" }
  | { type: "DECLINE_BUY" }
  | { type: "PAY_JAIL" }
  | { type: "USE_JAIL_CARD" }
  | { type: "ROLL_JAIL"; dice?: [number, number] }
  | { type: "BUILD"; tileId: string }
  | { type: "SELL_BUILDING"; tileId: string }
  | { type: "END_TURN" }
  | { type: "TRADE_OFFER"; actorId?: string; to: string; giveCash: number; giveTiles: string[]; wantCash: number; wantTiles: string[] }
  | { type: "TRADE_ACCEPT"; actorId?: string }
  | { type: "TRADE_DECLINE"; actorId?: string }

export const ECONOMY = {
  startingCash: 600,
  goReward: 80,
  jailFee: 30,
  incomeTax: 45,
  luxuryTax: 25,
  maxTurns: 100,
} as const

export type CountryGroup = {
  country: CountryId
  tileIds: [string, string, string]
}
