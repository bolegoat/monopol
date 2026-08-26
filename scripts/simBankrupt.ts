import { createGame, reducer } from "../src/game/engine"

let g = createGame([
  { name: "Rich", icon: "☕", color: "#22c55e" },
  { name: "Poor", icon: "🎒", color: "#ef4444" },
])

g.props["nis"].ownerId = "p1"
g.props["novi-sad"].ownerId = "p1"
g.props["beograd"].ownerId = "p1"
for (const id of ["nis", "novi-sad", "beograd"]) g.props[id].level = 3

const poor = () => g.players.find((p) => p.id === "p2")!
poor().cash = 40
poor().position = 29 // Split; +6 lands on Beograd

g.currentId = "p2"
g.phase = "awaiting-roll"
g.turn = 5

console.log("before:", { cash: poor().cash, pos: poor().position })
g = reducer(g, { type: "ROLL", dice: [2, 4] })
console.log("after:", { cash: poor().cash, bankrupt: poor().bankrupt })
console.log("log:", g.log.slice(0, 5).map((l) => l.text))

if (!poor().bankrupt) {
  console.log("FAIL: expected bankruptcy")
  process.exit(1)
}
console.log("PASS: bankruptcy triggered correctly")

