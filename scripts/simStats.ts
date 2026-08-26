import { createGame, reducer, canBuild, netWorth } from "../src/game/engine"
import { BOARD } from "../src/game/board"
import type { Action, GameState } from "../src/game/engineTypes"

function tryBuild(g: GameState): GameState {
  let again = true
  while (again) {
    again = false
    const p = g.players.find((x) => x.id === g.currentId)!
    for (const tile of BOARD) {
      if (tile.kind === "city" && canBuild(g, p.id, tile.id)) {
        g = reducer(g, { type: "BUILD", tileId: tile.id })
        again = true
        break
      }
    }
  }
  return g
}

function step(g: GameState): GameState {
  const a: Action =
    g.phase === "awaiting-buy"
      ? Math.random() < 0.8
        ? { type: "BUY" }
        : { type: "DECLINE_BUY" }
      : g.phase === "awaiting-jail"
        ? Math.random() < 0.5
          ? { type: "ROLL_JAIL" }
          : { type: "PAY_JAIL" }
        : g.phase === "awaiting-roll"
          ? { type: "ROLL" }
          : { type: "END_TURN" }
  return reducer(g, a)
}

const turns: number[] = []
let bankruptEnds = 0
let limitEnds = 0

for (let sim = 0; sim < 100; sim++) {
  let g = createGame([
    { name: "A", icon: "x", color: "#fff" },
    { name: "B", icon: "y", color: "#f00" },
    { name: "C", icon: "z", color: "#00f" },
    { name: "D", icon: "w", color: "#ff0" },
  ])
  while (g.phase !== "game-over") {
    if (g.phase === "awaiting-buy") {
      const buy = Math.random() < 0.8
      g = reducer(g, buy ? { type: "BUY" } : { type: "DECLINE_BUY" })
    } else if (g.phase === "turn-end") {
      g = tryBuild(g)
      g = reducer(g, { type: "END_TURN" })
    } else g = step(g)
  }
  turns.push(g.turn)
  const alive = g.players.filter((p) => !p.bankrupt).length
  if (alive === 1) bankruptEnds++
  else limitEnds++
}

const avg = Math.round(turns.reduce((a, b) => a + b, 0) / turns.length)
console.log(
  `avg turns: ${avg} | min ${Math.min(...turns)} max ${Math.max(...turns)} | bankruptcy endings: ${bankruptEnds} | turn-limit endings: ${limitEnds}`,
)
// sample final standings
let g = createGame([
  { name: "A", icon: "x", color: "#fff" },
  { name: "B", icon: "y", color: "#f00" },
  { name: "C", icon: "z", color: "#00f" },
  { name: "D", icon: "w", color: "#ff0" },
])
while (g.phase !== "game-over") {
  if (g.phase === "awaiting-buy") g = reducer(g, Math.random() < 0.8 ? { type: "BUY" } : { type: "DECLINE_BUY" })
  else if (g.phase === "turn-end") {
    g = tryBuild(g)
    g = reducer(g, { type: "END_TURN" })
  } else g = step(g)
}
console.log(
  "sample standings:",
  [...g.players]
    .map((p) => `${p.name}: €${netWorth(g, p)}${p.bankrupt ? " (bankrupt)" : ""}`)
    .join(" | "),
)

