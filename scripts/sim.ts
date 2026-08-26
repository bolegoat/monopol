import { createGame, reducer } from "../src/game/engine"
import type { GameState } from "../src/game/engineTypes"

function stepRandom(g: GameState): GameState {
  if (g.phase === "awaiting-buy")
    return reducer(g, Math.random() < 0.5 ? { type: "BUY" } : { type: "DECLINE_BUY" })
  if (g.phase === "awaiting-jail")
    return reducer(g, Math.random() < 0.5 ? { type: "ROLL_JAIL" } : { type: "PAY_JAIL" })
  if (g.phase === "awaiting-roll") return reducer(g, { type: "ROLL" })
  if (g.phase === "turn-end") return reducer(g, { type: "END_TURN" })
  return g
}

let games = 0
for (let sim = 0; sim < 300; sim++) {
  let g = createGame([
    { name: "A", icon: "☕", color: "#22c55e" },
    { name: "B", icon: "⚽", color: "#3b82f6" },
    { name: "C", icon: "🎒", color: "#a855f7" },
    { name: "D", icon: "🛵", color: "#f59e0b" },
  ])
  games++
  for (let i = 0; i < 5000; i++) {
    const before = g.players.map((p) => p.position)
    try {
      g = stepRandom(g)
      if (g.phase === "game-over") break
      for (const p of g.players) {
        if (!Number.isInteger(p.position) || p.position < 0 || p.position > 39) {
          console.log("BAD POSITION", JSON.stringify(p), "before:", JSON.stringify(before))
          console.log("log:", g.log.slice(0, 8).map((l) => l.text))
          process.exit(1)
        }
      }
      if (!Number.isInteger(g.turn) || g.turn < 1) {
        console.log("BAD TURN", g.turn, "log:", g.log.slice(0, 8).map((l) => l.text))
        process.exit(1)
      }
      for (const p of g.players) {
        if (!Number.isInteger(p.cash)) {
          console.log("BAD CASH", JSON.stringify(p), "log:", g.log.slice(0, 8).map((l) => l.text))
          process.exit(1)
        }
      }
    } catch (e) {
      console.log("CRASH at game", games, "iter", i, "phase", g.phase)
      console.log(
        "positions:",
        JSON.stringify(g.players.map((p) => ({ n: p.name, pos: p.position, cash: p.cash }))),
      )
      console.log("before:", JSON.stringify(before))
      console.log("log:", g.log.slice(0, 10).map((l) => l.text))
      throw e
    }
  }
}
console.log(`OK — ${games} full games simulated without invalid state`)

