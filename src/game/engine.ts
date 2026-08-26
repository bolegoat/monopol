import { BOARD } from "./board"
import type { CountryId } from "./types"
import { ECONOMY } from "./engineTypes"
import type { Action, GameOptions, GameState, PlayerDef, PlayerState, PropState } from "./engineTypes"

/* ---------- constants ---------- */

const JAIL_POS = 10
const AIRPORT_FEES = [15, 30, 50, 70, 90, 115]
const COASTAL_CITIES = new Set(["split", "rijeka", "podgorica"])

export const GROUPS: Record<CountryId, [string, string, string]> = {
  mk: ["bitola", "ohrid", "skopje"],
  me: ["niksic", "cetinje", "podgorica"],
  ba: ["tuzla", "mostar", "sarajevo"],
  si: ["kranj", "maribor", "ljubljana"],
  hr: ["osijek", "rijeka", "split"],
  rs: ["nis", "novi-sad", "beograd"],
}

/* ---------- random ---------- */

function rnd(maxExclusive: number): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] % maxExclusive
}

const rollDie = () => 1 + rnd(6)

function shuffle(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/* ---------- setup ---------- */

export function createGame(defs: PlayerDef[], opts: GameOptions = {}): GameState {
  const players: PlayerState[] = defs.map((d, i) => ({
    id: d.id ?? `p${i + 1}`,
    name: d.name,
    icon: d.icon,
    color: d.color,
    cash: opts.startingCash ?? ECONOMY.startingCash,
    position: 0,
    inJail: false,
    jailTurns: 0,
    getOutCards: 0,
    discountNext: false,
    rentShield: false,
    bankrupt: false,
  }))

  const props: Record<string, PropState> = {}
  for (const tile of BOARD) {
    if (tile.kind === "city" || tile.kind === "airport") {
      props[tile.id] = { ownerId: null, level: 0, mortgaged: false }
    }
  }

  const state: GameState = {
    players,
    props,
    currentId: players[0].id,
    turn: 1,
    maxTurns: opts.maxTurns ?? ECONOMY.maxTurns,
    dice: null,
    rolledDoubles: false,
    doublesCount: 0,
    phase: "awaiting-roll",
    pendingTileId: null,
    log: [],
    logSeq: 0,
    winner: null,
    eventDeck: shuffle(12),
    surpriseDeck: shuffle(12),
    lastDrawn: null,
    goReward: opts.goReward ?? ECONOMY.goReward,
    pendingTrade: null,
  }
  log(state, "🎲", "#ece9f5", `Game started. ${players[0].name} goes first.`)
  return state
}

/* ---------- helpers ---------- */

function log(g: GameState, icon: string, color: string, text: string) {
  g.logSeq += 1
  g.log.unshift({ id: g.logSeq, icon, color, text })
  if (g.log.length > 50) g.log.pop()
}

const player = (g: GameState, id: string) => g.players.find((p) => p.id === id)!
const currentPlayer = (g: GameState) => player(g, g.currentId)
const tileById = (id: string) => BOARD.find((t) => t.id === id)!
export const propOf = (g: GameState, tileId: string) => g.props[tileId]

function ownsGroup(g: GameState, playerId: string, country: CountryId): boolean {
  return GROUPS[country].every((id) => g.props[id].ownerId === playerId)
}

function airportsOwned(g: GameState, playerId: string): number {
  return BOARD.filter((t) => t.kind === "airport" && g.props[t.id]?.ownerId === playerId).length
}

/** Rent per the plan's table: level multipliers on base rent, hotel is flat by tier. */
export function rentFor(g: GameState, tileId: string): number {
  const tile = tileById(tileId)
  const ps = g.props[tileId]
  if (!ps || !ps.ownerId || ps.mortgaged) return 0

  if (tile.kind === "airport") {
    return AIRPORT_FEES[Math.min(airportsOwned(g, ps.ownerId), 6) - 1] ?? 15
  }
  if (tile.kind !== "city" || tile.baseRent == null) return 0

  const price = tile.price ?? 100
  const groupBonus = ownsGroup(g, ps.ownerId, tile.country!) ? 1.5 : 1
  switch (ps.level) {
    case 0:
      return Math.round(tile.baseRent * groupBonus)
    case 4:
      return price <= 60 ? 90 : price <= 100 ? 125 : price <= 140 ? 160 : 200
    default: {
      const mult = ps.level === 1 ? 3 : ps.level === 2 ? 5 : 8
      return Math.round(tile.baseRent * mult)
    }
  }
}

export function netWorth(g: GameState, p: PlayerState): number {
  let total = p.cash
  for (const tile of BOARD) {
    const ps = g.props[tile.id]
    if (ps?.ownerId !== p.id) continue
    total += tile.price ?? 0
    if (tile.kind === "city" && ps.level > 0) {
      total += ps.level * (tile.upgradeCost ?? 0) * 0.5
    }
  }
  return Math.round(total)
}

/* ---------- money & bankruptcy ---------- */

function liquidate(g: GameState, p: PlayerState, target: number) {
  // sell buildings first (most expensive groups first for determinism)
  const owned = () =>
    BOARD.filter((t) => t.kind === "city" && g.props[t.id]?.ownerId === p.id && g.props[t.id].level > 0)
  while (p.cash < target && owned().length > 0) {
    const t = owned()[0]
    const ps = g.props[t.id]
    ps.level -= 1
    p.cash += Math.ceil((t.upgradeCost ?? 20) / 2)
    log(g, "🏚️", "#f59e0b", `${p.name} sold a building on ${t.name}`)
  }
  // then mortgage properties
  const mortgageable = () =>
    BOARD.filter((t) => (t.kind === "city" || t.kind === "airport") && g.props[t.id]?.ownerId === p.id && !g.props[t.id].mortgaged)
  while (p.cash < target && mortgageable().length > 0) {
    const t = mortgageable()[0]
    g.props[t.id].mortgaged = true
    p.cash += Math.floor((t.price ?? 0) / 2)
    log(g, "🏦", "#f59e0b", `${p.name} mortgaged ${t.name}`)
  }
}

function bankruptPlayer(g: GameState, p: PlayerState, creditorId: string | null) {
  p.bankrupt = true
  if (g.pendingTrade && (g.pendingTrade.from === p.id || g.pendingTrade.to === p.id)) g.pendingTrade = null
  log(g, "💀", "#ef4444", `${p.name} is bankrupt!`)
  for (const tile of BOARD) {
    const ps = g.props[tile.id]
    if (ps?.ownerId === p.id) {
      ps.ownerId = creditorId
      ps.level = 0
      ps.mortgaged = false
    }
  }
  const alive = g.players.filter((x) => !x.bankrupt)
  if (alive.length === 1) endGame(g, alive[0].id, "last player standing")
}

function pay(g: GameState, fromId: string, amount: number, toId: string | null) {
  const from = player(g, fromId)
  if (from.cash < amount) liquidate(g, from, amount)
  const paid = Math.min(from.cash, amount)
  from.cash -= paid
  if (toId) player(g, toId).cash += paid
  if (paid < amount) bankruptPlayer(g, from, toId)
}

/* ---------- movement ---------- */

function moveTo(g: GameState, playerId: string, target: number, collectGo = true) {
  const p = player(g, playerId)
  if (collectGo && target < p.position) {
    p.cash += g.goReward
    log(g, "🏁", "#22c55e", `${p.name} passed GO and collected €${g.goReward}`)
  }
  p.position = target
}

function moveSteps(g: GameState, playerId: string, steps: number) {
  const p = player(g, playerId)
  const target = (((p.position + steps) % 40) + 40) % 40
  moveTo(g, playerId, target, steps > 0)
}

function nextAirportPos(from: number): number {
  for (let i = 1; i <= 40; i++) {
    const pos = (from + i) % 40
    if (BOARD[pos].kind === "airport") return pos
  }
  return from
}

/* ---------- jail ---------- */

function sendToJail(g: GameState, playerId: string) {
  const p = player(g, playerId)
  p.position = JAIL_POS
  p.inJail = true
  p.jailTurns = 0
  g.doublesCount = 0
  g.rolledDoubles = false
  log(g, "🚨", "#ef4444", `${p.name} was sent to Prison`)
}

/* ---------- turn flow ---------- */

function afterResolution(g: GameState) {
  const p = currentPlayer(g)
  if (p.bankrupt || p.inJail) {
    g.phase = "turn-end"
    return
  }
  if (g.rolledDoubles && g.phase === "turn-end") {
    g.phase = "awaiting-roll"
  }
}

function chargeRent(g: GameState, tenantId: string, tileId: string) {
  const tile = tileById(tileId)
  const ps = g.props[tileId]
  const owner = player(g, ps.ownerId!)
  const rent = rentFor(g, tileId)
  const tenant = player(g, tenantId)
  if (rent <= 0) return

  if (tenant.rentShield && rent <= 40) {
    tenant.rentShield = false
    log(g, "🛡️", "#3b82f6", `Surprise shield cancelled the €${rent} rent on ${tile.name}!`)
    return
  }
  log(g, "💰", "#ef4444", `${tenant.name} paid ${owner.name} €${rent} rent for ${tile.name}`)
  pay(g, tenantId, rent, owner.id)
}

function resolveLanding(g: GameState, playerId: string) {
  const p = player(g, playerId)
  const tile = BOARD[p.position]

  switch (tile.kind) {
    case "city":
    case "airport": {
      const ps = g.props[tile.id]
      if (!ps.ownerId) {
        const price = (tile.price ?? 0) - (p.discountNext ? 10 : 0)
        if (p.cash >= price) {
          g.phase = "awaiting-buy"
          g.pendingTileId = tile.id
        } else {
          log(g, "😅", "#f59e0b", `${p.name} can't afford ${tile.name}`)
          g.phase = "turn-end"
        }
      } else if (ps.ownerId === playerId) {
        log(g, "🏠", "#22c55e", `${p.name} is home at ${tile.name}`)
        g.phase = "turn-end"
      } else if (ps.mortgaged) {
        log(g, "🏦", "#f59e0b", `${tile.name} is mortgaged — no rent`)
        g.phase = "turn-end"
      } else {
        chargeRent(g, playerId, tile.id)
        g.phase = "turn-end"
      }
      break
    }
    case "tax":
      log(g, tile.icon ?? "💸", "#ef4444", `${p.name} paid €${tile.amount} ${tile.name.toLowerCase()}`)
      pay(g, playerId, tile.amount ?? 0, null)
      g.phase = "turn-end"
      break
    case "event":
      drawEventCard(g, playerId)
      break
    case "surprise":
      drawSurpriseCard(g, playerId)
      break
    case "go-to-jail":
      sendToJail(g, playerId)
      g.phase = "turn-end"
      break
    default:
      g.phase = "turn-end"
  }
}

/* ---------- cards ---------- */

function drawEventCard(g: GameState, playerId: string) {
  const idx = g.eventDeck.shift()!
  g.eventDeck.push(idx)
  const p = player(g, playerId)
  const others = g.players.filter((o) => o.id !== playerId && !o.bankrupt)
  const richest = [...others].sort((a, b) => b.cash - a.cash)[0] ?? p
  const poorest = [...g.players].sort((a, b) => a.cash - b.cash)[0]
  const coastal = BOARD.some((t) => COASTAL_CITIES.has(t.id) && g.props[t.id]?.ownerId === playerId)
  const hasUpgradedCity = BOARD.some(
    (t) => t.kind === "city" && g.props[t.id]?.ownerId === playerId && g.props[t.id].level > 0,
  )

  g.lastDrawn = { deck: "event", icon: "🎡", text: EVENT_TEXTS[idx] }

  switch (idx) {
    case 0: // Family connection
      if (others.length) {
        log(g, "📞", "#f59e0b", `Family connection: ${richest.name} pays ${p.name} €15 ("someone knows someone")`)
        pay(g, richest.id, 15, playerId)
      }
      break
    case 1: // Tourist season
      if (coastal) {
        log(g, "🏖️", "#22c55e", `Tourist season! ${p.name} collected €25`)
        p.cash += 25
      } else {
        log(g, "☕", "#ef4444", `${p.name} paid €10 for overpriced coastal coffee`)
        pay(g, playerId, 10, null)
      }
      break
    case 2: // Roadworks again
      log(g, "🚧", "#f59e0b", `Roadworks again! ${p.name} moves back 2 spaces`)
      moveSteps(g, playerId, -2)
      resolveLanding(g, playerId)
      return
    case 3: // Fuel prices
      log(g, "⛽", "#ef4444", `Fuel prices up — everyone pays €5`)
      for (const o of g.players.filter((x) => !x.bankrupt)) pay(g, o.id, 5, null)
      break
    case 4: // Questionable side business
      if (rnd(2) === 0) {
        log(g, "🕶️", "#22c55e", `Side business paid off! ${p.name} received €40`)
        p.cash += 40
      } else {
        log(g, "🕵️", "#ef4444", `Side business flopped. ${p.name} paid €20`)
        pay(g, playerId, 20, null)
      }
      break
    case 5: // Wedding envelope
      log(g, "💌", "#22c55e", `${p.name} received €20, then paid €10 for unexpected guests`)
      p.cash += 20
      pay(g, playerId, 10, null)
      break
    case 6: // Parking inspector
      if (hasUpgradedCity) {
        log(g, "🅿️", "#22c55e", `Parking inspector respected ${p.name}'s parking empire`)
      } else {
        log(g, "🅿️", "#ef4444", `${p.name} paid €25 parking fine`)
        pay(g, playerId, 25, null)
      }
      break
    case 7: { // Family group chat
      log(g, "📱", "#f59e0b", `Family group chat: everyone sends €5 to ${poorest.name}`)
      for (const o of g.players.filter((x) => !x.bankrupt && x.id !== poorest.id)) {
        pay(g, o.id, 5, poorest.id)
      }
      break
    }
    case 8:
      log(g, "🍽️", "#ef4444", `Cash-only restaurant: ${p.name} paid €15`)
      pay(g, playerId, 15, null)
      break
    case 9:
      p.discountNext = true
      log(g, "🤝", "#22c55e", `${p.name} knows a guy — next property €10 cheaper`)
      break
    case 10:
      log(g, "🛃", "#ef4444", `Border crossing chaos: ${p.name} paid €12 in "fees"`)
      pay(g, playerId, 12, null)
      break
    case 11:
      log(g, "🧾", "#ef4444", `${p.name}'s accountant left the room. €18 gone.`)
      pay(g, playerId, 18, null)
      break
  }
  g.phase = "turn-end"
}

function drawSurpriseCard(g: GameState, playerId: string) {
  const idx = g.surpriseDeck.shift()!
  g.surpriseDeck.push(idx)
  const p = player(g, playerId)
  const others = g.players.filter((o) => o.id !== playerId && !o.bankrupt)
  const lastPlace = [...g.players.filter((x) => !x.bankrupt)].sort((a, b) => netWorth(g, a) - netWorth(g, b))[0]

  g.lastDrawn = { deck: "surprise", icon: "❓", text: SURPRISE_TEXTS[idx] }

  switch (idx) {
    case 0: { // nearest airport
      const target = nextAirportPos(p.position)
      log(g, "✈️", "#f59e0b", `${p.name} flies to the nearest airport`)
      moveTo(g, playerId, target, true)
      resolveLanding(g, playerId)
      return
    }
    case 1:
      log(g, "🚀", "#f59e0b", `${p.name} moves forward 3 spaces`)
      moveSteps(g, playerId, 3)
      resolveLanding(g, playerId)
      return
    case 2:
      log(g, "↩️", "#f59e0b", `${p.name} moves back 2 spaces`)
      moveSteps(g, playerId, -2)
      resolveLanding(g, playerId)
      return
    case 3: {
      if (others.length) {
        const victim = others[rnd(others.length)]
        log(g, "💸", "#22c55e", `${victim.name} owes ${p.name} €20. No refunds.`)
        pay(g, victim.id, 20, playerId)
      }
      break
    }
    case 4:
      log(g, "🎂", "#ef4444", `${p.name} pays everyone €5`)
      for (const o of others) pay(g, playerId, 5, o.id)
      break
    case 5:
      log(g, "🎁", "#22c55e", `${p.name} received €30 from the bank`)
      p.cash += 30
      break
    case 6:
      p.getOutCards += 1
      log(g, "🔑", "#22c55e", `${p.name} got a Get-Out-of-Jail card`)
      break
    case 7:
      p.rentShield = true
      log(g, "🛡️", "#3b82f6", `${p.name} is shielded from the next rent up to €40`)
      break
    case 8: {
      if (lastPlace && lastPlace.id !== playerId) {
        log(g, "🔄", "#a855f7", `${p.name} swaps places with ${lastPlace.name}`)
        ;[p.position, lastPlace.position] = [lastPlace.position, p.position]
      }
      break
    }
    case 9:
      log(g, "🧳", "#22c55e", `Travel refund: ${p.name} received €20`)
      p.cash += 20
      break
    case 10:
      log(g, "🛃", "#22c55e", `Customs refund: ${p.name} received €10`)
      p.cash += 10
      break
    case 11:
      log(g, "🏁", "#22c55e", `${p.name} advances to GO and collects €${g.goReward}`)
      moveTo(g, playerId, 0, false)
      p.cash += g.goReward
      break
  }
  g.phase = "turn-end"
}

const EVENT_TEXTS = [
  "Family connection — someone knows someone.",
  "Tourist season!",
  "Roadworks again.",
  "Fuel price update.",
  "Questionable side business.",
  "Wedding envelope.",
  "Parking inspector.",
  "Family group chat.",
  "Cash-only restaurant.",
  "You know a guy.",
  "Border crossing.",
  "Your accountant left the room.",
]

const SURPRISE_TEXTS = [
  "Fly to the nearest airport.",
  "Move forward 3 spaces.",
  "Move back 2 spaces.",
  "A friend owes you €20.",
  "Pay every player €5.",
  "Receive €30 from the bank.",
  "Get out of jail free.",
  "Rent shield up to €40.",
  "Swap places with the last-place player.",
  "€20 travel refund.",
  "€10 customs refund.",
  "Advance to GO.",
]

/* ---------- game over ---------- */

function endGame(g: GameState, winnerId: string | null, reason: string) {
  g.winner = winnerId ? { playerId: winnerId, reason } : { playerId: "", reason }
  g.phase = "game-over"
  if (winnerId) {
    const w = player(g, winnerId)
    log(g, "🏆", "#f4b73f", `${w.name} wins! (${reason})`)
  } else {
    log(g, "🏁", "#f4b73f", `Game over (${reason})`)
  }
}

/* ---------- reducer ---------- */

export function reducer(state: GameState, action: Action): GameState {
  if (action.type === "ROLL_JAIL") return rollInJail(state, action.dice)
  if (state.phase === "game-over") return state

  const g: GameState = structuredClone(state)
  const p = currentPlayer(g)

  switch (action.type) {
    case "ROLL": {
      if (g.phase !== "awaiting-roll") return state
      const dice = action.dice ?? ([rollDie(), rollDie()] as [number, number])
      g.dice = dice
      const doubles = dice[0] === dice[1]
      g.rolledDoubles = doubles
      const total = dice[0] + dice[1]
      log(g, "🎲", "#ece9f5", `${p.name} rolled ${total}${doubles ? " (doubles!)" : ""}`)

      if (doubles) {
        g.doublesCount += 1
        if (g.doublesCount >= 3) {
          log(g, "🚔", "#ef4444", `Three doubles in a row — the police were watching`)
          sendToJail(g, p.id)
          g.phase = "turn-end"
          return g
        }
      }
      moveSteps(g, p.id, total)
      resolveLanding(g, p.id)
      afterResolution(g)
      return g
    }

    case "BUY": {
      if (g.phase !== "awaiting-buy" || !g.pendingTileId) return state
      const tile = tileById(g.pendingTileId)
      const buyer = currentPlayer(g)
      let price = tile.price ?? 0
      if (buyer.discountNext) {
        price -= 10
        buyer.discountNext = false
      }
      if (buyer.cash < price) return state
      buyer.cash -= price
      g.props[tile.id].ownerId = buyer.id
      log(g, "🏙️", "#3b82f6", `${buyer.name} bought ${tile.name} for €${price}`)
      g.pendingTileId = null
      g.phase = "turn-end"
      afterResolution(g)
      return g
    }

    case "DECLINE_BUY": {
      if (g.phase !== "awaiting-buy") return state
      const tile = tileById(g.pendingTileId!)
      log(g, "🙅", "#f59e0b", `${currentPlayer(g).name} declined to buy ${tile.name}`)
      g.pendingTileId = null
      g.phase = "turn-end"
      afterResolution(g)
      return g
    }

    case "PAY_JAIL": {
      if (g.phase !== "awaiting-jail") return state
      log(g, "💵", "#f59e0b", `${p.name} paid €${ECONOMY.jailFee} bail`)
      pay(g, p.id, ECONOMY.jailFee, null)
      p.inJail = false
      p.jailTurns = 0
      g.phase = p.bankrupt ? "turn-end" : "awaiting-roll"
      return g
    }

    case "USE_JAIL_CARD": {
      if (g.phase !== "awaiting-jail" || p.getOutCards < 1) return state
      p.getOutCards -= 1
      p.inJail = false
      p.jailTurns = 0
      log(g, "🔑", "#22c55e", `${p.name} used a Get-Out-of-Jail card`)
      g.phase = "awaiting-roll"
      return g
    }

    case "BUILD": {
      if (!canBuild(g, p.id, action.tileId)) return state
      const tile = tileById(action.tileId)
      const cost = tile.upgradeCost ?? 20
      p.cash -= cost
      g.props[action.tileId].level += 1
      const lvl = g.props[action.tileId].level
      log(g, lvl === 4 ? "🏨" : "🏠", "#22c55e", `${p.name} built ${lvl === 4 ? "a hotel" : "a house"} on ${tile.name}`)
      return g
    }

    case "SELL_BUILDING": {
      const ps = g.props[action.tileId]
      if (!ps || ps.ownerId !== p.id || ps.level === 0) return state
      const tile = tileById(action.tileId)
      ps.level -= 1
      p.cash += Math.ceil((tile.upgradeCost ?? 20) / 2)
      log(g, "📉", "#f59e0b", `${p.name} sold a building on ${tile.name}`)
      return g
    }

    case "END_TURN": {
      if (g.phase !== "turn-end") return state
      g.turn += 1
      g.doublesCount = 0
      g.rolledDoubles = false
      g.lastDrawn = null
      if (g.turn > g.maxTurns) {
        finishByScore(g)
        return g
      }
      const order = g.players.map((x) => x.id)
      const curIdx = order.indexOf(g.currentId)
      let nextId = g.currentId
      for (let i = 1; i <= order.length; i++) {
        const candidate = player(g, order[(curIdx + i) % order.length])
        if (!candidate.bankrupt) {
          nextId = candidate.id
          break
        }
      }
      g.currentId = nextId
      g.phase = player(g, nextId).inJail ? "awaiting-jail" : "awaiting-roll"
      log(g, "🔁", "#ece9f5", `${player(g, nextId).name}'s turn`)
      return g
    }

    case "TRADE_OFFER": {
      if (g.phase === "game-over") return state
      const actor = g.players.find((x) => x.id === (action.actorId ?? g.currentId))
      if (!actor || actor.bankrupt) return state
      if (!isValidTrade(g, actor.id, action.to, action.giveCash, action.giveTiles, action.wantCash, action.wantTiles)) {
        return state
      }
      g.pendingTrade = {
        from: actor.id,
        to: action.to,
        giveCash: Math.max(0, Math.floor(action.giveCash)),
        giveTiles: [...action.giveTiles],
        wantCash: Math.max(0, Math.floor(action.wantCash)),
        wantTiles: [...action.wantTiles],
      }
      log(g, "🤝", "#3b82f6", `${actor.name} offered ${player(g, action.to).name} a trade`)
      return g
    }

    case "TRADE_ACCEPT": {
      const t = g.pendingTrade
      const actor = g.players.find((x) => x.id === (action.actorId ?? g.currentId))
      if (!t || !actor || t.to !== actor.id || g.phase === "game-over") return state
      if (!isValidTrade(g, t.from, t.to, t.giveCash, t.giveTiles, t.wantCash, t.wantTiles)) {
        g.pendingTrade = null
        return state
      }
      const from = player(g, t.from)
      from.cash -= t.giveCash - t.wantCash
      actor.cash += t.giveCash - t.wantCash
      for (const tileId of t.giveTiles) g.props[tileId].ownerId = t.to
      for (const tileId of t.wantTiles) g.props[tileId].ownerId = t.from
      const names = [
        ...t.giveTiles.map((id) => tileById(id).name),
        ...t.wantTiles.map((id) => tileById(id).name),
      ]
      const net = t.giveCash - t.wantCash
      log(
        g,
        "🤝",
        "#22c55e",
        `${actor.name} accepted the trade${names.length ? `: ${names.join(", ")}` : ""}${
          net !== 0 ? ` (€${Math.abs(net)} ${net > 0 ? "to" : "from"} ${from.name})` : ""
        }`,
      )
      g.pendingTrade = null
      return g
    }

    case "TRADE_DECLINE": {
      const t = g.pendingTrade
      const actor = g.players.find((x) => x.id === (action.actorId ?? g.currentId))
      if (!t || !actor || t.to !== actor.id || g.phase === "game-over") return state
      g.pendingTrade = null
      log(g, "🚫", "#ef4444", `${actor.name} declined the trade`)
      return g
    }
  }
  return state
}

/** Both players alive & distinct; each side owns its tiles (unimproved); cash covers the offer. */
function isValidTrade(
  g: GameState,
  fromId: string,
  toId: string,
  giveCash: number,
  giveTiles: string[],
  wantCash: number,
  wantTiles: string[],
): boolean {
  if (fromId === toId) return false
  const from = player(g, fromId)
  const to = player(g, toId)
  if (!from || !to || from.bankrupt || to.bankrupt) return false
  if (giveCash < 0 || wantCash < 0 || from.cash < giveCash || to.cash < wantCash) return false
  const seen = new Set<string>()
  for (const id of giveTiles) {
    const ps = g.props[id]
    if (!ps || ps.ownerId !== fromId || ps.level > 0 || seen.has(id)) return false
    seen.add(id)
  }
  for (const id of wantTiles) {
    const ps = g.props[id]
    if (!ps || ps.ownerId !== toId || ps.level > 0 || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

function rollInJail(state: GameState, forced?: [number, number]): GameState {
  if (state.phase !== "awaiting-jail") return state
  const g: GameState = structuredClone(state)
  const p = currentPlayer(g)
  const dice = forced ?? ([rollDie(), rollDie()] as [number, number])
  g.dice = dice
  const doubles = dice[0] === dice[1]
  const total = dice[0] + dice[1]
  log(g, "🎲", "#ece9f5", `${p.name} rolled ${total} in jail`)

  if (doubles) {
    p.inJail = false
    p.jailTurns = 0
    g.doublesCount = 0
    g.rolledDoubles = false
    log(g, "🔓", "#22c55e", `Doubles! ${p.name} leaves prison`)
    moveSteps(g, p.id, total)
    resolveLanding(g, p.id)
    return g
  }

  p.jailTurns += 1
  if (p.jailTurns >= 3) {
    log(g, "💵", "#ef4444", `Third attempt failed — ${p.name} pays €${ECONOMY.jailFee} and moves`)
    pay(g, p.id, ECONOMY.jailFee, null)
    p.inJail = false
    p.jailTurns = 0
    if (!p.bankrupt) {
      moveSteps(g, p.id, total)
      resolveLanding(g, p.id)
    }
  } else {
    log(g, "⛓️", "#f59e0b", `${p.name} stays in prison`)
    g.phase = "turn-end"
  }
  return g
}

export function canBuild(g: GameState, playerId: string, tileId: string): boolean {
  const tile = tileById(tileId)
  if (tile.kind !== "city" || !tile.country) return false
  const ps = g.props[tileId]
  if (!ps || ps.ownerId !== playerId || ps.level >= 4 || ps.mortgaged) return false
  if (!ownsGroup(g, playerId, tile.country)) return false
  if (GROUPS[tile.country].some((id) => g.props[id].mortgaged)) return false
  // even-build rule: can't raise above the group minimum + 0
  const levels = GROUPS[tile.country].map((id) => g.props[id].level)
  return ps.level <= Math.min(...levels)
}

function finishByScore(g: GameState) {
  g.pendingTrade = null
  const alive = g.players.filter((p) => !p.bankrupt)
  const best = [...alive].sort((a, b) => netWorth(g, b) - netWorth(g, a))[0]
  endGame(g, best?.id ?? null, "highest net worth after turn limit")
}
