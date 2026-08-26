import { createGame, reducer } from "../src/game/engine"
import type { GameState } from "../src/game/engineTypes"

let g: GameState = createGame([
  { id: "a", name: "Ana", icon: "🛵", color: "#a855f7" },
  { id: "b", name: "Bane", icon: "⚽", color: "#3b82f6" },
])

function expect(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`ok: ${msg}`)
}

// harness shortcut: hand Ana two properties and Bane one
g.props["ohrid"].ownerId = "a"
g.props["skopje"].ownerId = "a"
g.props["nis"].ownerId = "b"
const anaCash0 = g.players[0].cash

// invalid: trading a property you don't own must be rejected
g = reducer(g, {
  type: "TRADE_OFFER",
  to: "b",
  giveCash: 0,
  giveTiles: ["nis"],
  wantCash: 0,
  wantTiles: [],
})
expect(g.pendingTrade === null, "cannot offer someone else's property")

// valid offer: Ohrid for Niš + €20
g = reducer(g, {
  type: "TRADE_OFFER",
  to: "b",
  giveCash: 0,
  giveTiles: ["ohrid"],
  wantCash: 20,
  wantTiles: ["nis"],
})
expect(g.pendingTrade?.from === "a" && g.pendingTrade.to === "b", "offer recorded")

// only the recipient may accept/decline
const beforeDecline = g.pendingTrade
g = reducer(g, { type: "TRADE_DECLINE", actorId: "a" })
expect(g.pendingTrade === beforeDecline, "non-recipient cannot decline")

// out-of-turn: recipient responds even though Ana is still the current player
g = reducer(g, { type: "TRADE_DECLINE", actorId: "b" })
expect(g.pendingTrade === null, "recipient declined")

g = reducer(g, {
  type: "TRADE_OFFER",
  to: "b",
  giveCash: 10,
  giveTiles: ["ohrid", "skopje"],
  wantCash: 20,
  wantTiles: ["nis"],
})
expect(g.pendingTrade !== null, "second offer recorded")
g = reducer(g, { type: "TRADE_ACCEPT", actorId: "b" })

expect(g.pendingTrade === null, "trade cleared after accept")
expect(g.props["ohrid"].ownerId === "b" && g.props["skopje"].ownerId === "b", "properties transferred")
expect(g.props["nis"].ownerId === "a", "counterpart property transferred")
expect(g.players[0].cash === anaCash0 - 10 + 20, `cash netted correctly (${g.players[0].cash})`)
expect(g.players[1].cash === 600 + 10 - 20, `other side cash correct (${g.players[1].cash})`)

console.log("PASS: trades work end-to-end")
