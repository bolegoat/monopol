import type { PlayerDef } from "./engineTypes"

export const TOKEN_ICONS = ["☕", "🛵", "⚽", "🎒", "🐱", "🌭", "🕶️", "🔑"]

export const PLAYER_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
]

export const DEFAULT_PLAYERS: PlayerDef[] = [
  { name: "Luka", icon: "☕", color: "#22c55e" },
  { name: "Ana", icon: "🛵", color: "#a855f7" },
  { name: "Marko", icon: "⚽", color: "#3b82f6" },
  { name: "Ivan", icon: "🎒", color: "#f59e0b" },
]
