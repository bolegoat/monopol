import { createGame, reducer } from "./src/game/engine"
import { BOARD } from "./src/game/board"
import type { Action, GameState } from "./src/game/engineTypes"

let g: GameState = createGame([
  { name: "A", icon: "x", color: "#fff" },
  { name: "B", icon: "y", color: "#f00" },
  { name: "C", icon: "z", color: "#00f" },
  { name: "D", icon: "w", color: "#ff0" },
])

function act(): Action {
  if (g.phase === "awaiting-buy")
    return Math.random() < 0.5 ? { type: "BUY" } : { type: "DECLINE_BUY" }
  if (g.phase === "awaiting-jail")
    return Math.random() < 0.5 ? { type: "ROLL_JAIL" } : { type: "PAY_JAIL" }
  if (g.phase === "awaiting-roll") return { type: "ROLL" }
  return { type: "END_TURN" }
}

for (let i = 0; i < 5000; i++) {
  const cur = g.players.find((p) => p.id === g.currentId)!
  const bad =
    !Number.isInteger(cur.position) || cur.position < 0 || cur.position > 39 || !BOARD[cur.position]
  if (bad) {
    console.log("PREFLIGHT FAIL iter", i, cur.name, JSON.stringify(cur.position))
    break
  }
  try {
    g = reducer(g, act())
  } catch (e) {
    console.log("crash iter", i, "action for", cur.name, "at pos", cur.position)
    console.log("positions:", JSON.stringify(g.players.map((p) => ({ n: p.name, pos: p.position }))))
    console.log("log head:", g.log.slice(0, 8).map((l) => l.text))
    throw e
  }
  if (g.phase === "game-over") {
    console.log("game finished cleanly at iter", i)
    break
  }
}
console.log("sim ended, phase:", g.phase)
