import { useState } from "react"
import { BOARD } from "../game/board"
import { GROUPS, canBuild } from "../game/engine"
import type { Action, GameState } from "../game/engineTypes"
import type { Tile } from "../game/types"

type Props = {
  state: GameState
  onBuy: () => void
  onDecline: () => void
  isMyTurn?: boolean
}

export function BuyDialog({ state, onBuy, onDecline, isMyTurn = true }: Props) {
  const tile = BOARD.find((t) => t.id === state.pendingTileId)
  if (!tile) return null
  const player = state.players.find((p) => p.id === state.currentId)!
  const price = (tile.price ?? 0) - (player.discountNext ? 10 : 0)
  const discount = player.discountNext

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="animate-[fadein_0.2s_ease-out] w-72 rounded-2xl bg-night-800 p-5 text-center ring-1 ring-night-600 shadow-2xl">
        <div className="mb-1 text-xs font-bold tracking-widest text-white/40 uppercase">
          For sale
        </div>
        <div className="font-display mb-3 text-xl font-black">{tile.name}</div>
        <div className="mb-4 space-y-1 text-sm">
          <p className="text-white/60">
            Price:{" "}
            <span className="font-bold text-white">
              €{price}
              {discount && <span className="text-emerald-300"> (-€10)</span>}
            </span>
          </p>
          <p className="text-white/60">
            Base rent: <span className="font-bold text-emerald-300">€{tile.baseRent ?? "—"}</span>
          </p>
          <p className="text-white/40 text-xs">Your cash after buying: €{player.cash - price}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onBuy}
            disabled={!isMyTurn || player.cash < price}
            className="flex-1 rounded-lg bg-accent py-2 font-bold text-night-950 transition hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            Buy €{price}
          </button>
          <button
            onClick={onDecline}
            disabled={!isMyTurn}
            className="flex-1 rounded-lg bg-night-700 py-2 font-semibold text-white/80 transition hover:bg-night-600 active:scale-95 disabled:opacity-40"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  )
}

const tradeable = (state: GameState, playerId: string) =>
  BOARD.filter((t) => (t.kind === "city" || t.kind === "airport") && state.props[t.id]?.ownerId === playerId)

export function TradeDialog({
  state,
  myId,
  onClose,
  onSend,
}: {
  state: GameState
  myId?: string
  onClose: () => void
  onSend: (a: Action) => void
}) {
  const me = state.players.find((x) => x.id === (myId ?? state.currentId))!
  const others = state.players.filter((x) => x.id !== me.id && !x.bankrupt)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [giveTiles, setGiveTiles] = useState<string[]>([])
  const [wantTiles, setWantTiles] = useState<string[]>([])
  const [giveCash, setGiveCash] = useState(0)
  const [wantCash, setWantCash] = useState(0)
  const target = others.find((x) => x.id === targetId) ?? null

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const valid =
    !!target &&
    giveCash >= 0 &&
    wantCash >= 0 &&
    me.cash >= giveCash &&
    target.cash >= wantCash &&
    (giveTiles.length + wantTiles.length + giveCash + wantCash > 0)

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-[fadein_0.2s_ease-out] max-h-[85%] w-[520px] overflow-y-auto rounded-2xl bg-night-800 p-5 ring-1 ring-night-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-black">🤝 Propose a trade</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">✕</button>
        </div>

        {!target ? (
          <div className="space-y-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/40">Trade with</p>
            {others.map((x) => (
              <button
                key={x.id}
                onClick={() => setTargetId(x.id)}
                className="flex w-full items-center gap-3 rounded-lg bg-night-900/70 px-3 py-2.5 text-left ring-1 ring-night-700 transition hover:ring-accent/60"
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm"
                  style={{ background: x.color }}
                >
                  {x.icon}
                </span>
                <span className="flex-1 text-sm font-semibold">{x.name}</span>
                <span className="text-xs text-emerald-300">€{x.cash}</span>
                <span className="text-xs text-white/30">
                  {tradeable(state, x.id).length} props
                </span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* you give */}
            <div className="rounded-xl bg-night-900/70 p-3 ring-1 ring-night-700">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">You give</p>
                <div className="flex items-center gap-1 text-xs text-night-400">
                  €
                  <input
                    type="number"
                    min={0}
                    max={me.cash}
                    value={giveCash || ""}
                    placeholder="0"
                    onChange={(e) => setGiveCash(Math.min(me.cash, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-20 rounded-md border border-white/10 bg-night-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-accent-500/60"
                  />
                </div>
              </div>
              <PropPicker tiles={tradeable(state, me.id)} selected={giveTiles} onToggle={(id) => toggle(giveTiles, setGiveTiles, id)} />
            </div>

            <div className="py-1.5 text-center text-lg">🔄</div>

            {/* you get */}
            <div className="rounded-xl bg-night-900/70 p-3 ring-1 ring-night-700">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-accent-300">You get from {target.name}</p>
                <div className="flex items-center gap-1 text-xs text-night-400">
                  €
                  <input
                    type="number"
                    min={0}
                    max={target.cash}
                    value={wantCash || ""}
                    placeholder="0"
                    onChange={(e) => setWantCash(Math.min(target.cash, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-20 rounded-md border border-white/10 bg-night-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-accent-500/60"
                  />
                </div>
              </div>
              <PropPicker tiles={tradeable(state, target.id)} selected={wantTiles} onToggle={(id) => toggle(wantTiles, setWantTiles, id)} />
            </div>

            <p className="mt-2 text-center text-[11px] text-white/35">
              Properties with houses or hotels can't be traded — sell the buildings first.
            </p>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setTargetId(null)}
                className="rounded-lg bg-night-700 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-night-600"
              >
                ← Back
              </button>
              <button
                disabled={!valid}
                onClick={() => {
                  onSend({
                    type: "TRADE_OFFER",
                    to: target.id,
                    giveCash,
                    giveTiles,
                    wantCash,
                    wantTiles,
                  })
                  onClose()
                }}
                className="flex-1 rounded-lg bg-accent py-2 font-bold text-night-950 transition hover:brightness-110 active:scale-95 disabled:opacity-40"
              >
                Send offer to {target.name}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PropPicker({
  tiles,
  selected,
  onToggle,
}: {
  tiles: Tile[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  if (tiles.length === 0)
    return <p className="py-2 text-center text-xs text-white/30">No tradable properties</p>
  return (
    <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
      {tiles.map((t) => (
        <label
          key={t.id}
          className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ring-1 transition ${
            selected.includes(t.id)
              ? "bg-accent/15 ring-accent/60"
              : "bg-night-800/60 ring-transparent hover:bg-night-700/60"
          }`}
        >
          <input type="checkbox" checked={selected.includes(t.id)} onChange={() => onToggle(t.id)} className="accent-accent-500" />
          <span className="truncate">{t.name}</span>
        </label>
      ))}
    </div>
  )
}

export function BuildPanel({
  state,
  dispatch,
  onClose,
}: {
  state: GameState
  dispatch: (a: { type: "BUILD"; tileId: string } | { type: "SELL_BUILDING"; tileId: string }) => void
  onClose: () => void
}) {
  const p = state.players.find((x) => x.id === state.currentId)!
  const ownedCities = BOARD.filter(
    (t) => t.kind === "city" && state.props[t.id]?.ownerId === p.id,
  )

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-[fadein_0.2s_ease-out] max-h-[80%] w-[420px] overflow-y-auto rounded-2xl bg-night-800 p-5 ring-1 ring-night-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-black">🏗️ Build</h2>
          <span className="text-sm font-bold text-emerald-300">€{p.cash}</span>
        </div>
        {ownedCities.length === 0 && (
          <p className="py-6 text-center text-sm text-white/40">
            You don't own any cities yet. Buy some first.
          </p>
        )}
        <ul className="space-y-2">
          {ownedCities.map((t) => {
            const ps = state.props[t.id]
            const sellable = ps.level > 0 && groupOk(state, p.id, t)
            return (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-lg bg-night-900/70 px-3 py-2 ring-1 ring-night-700"
              >
                <div>
                  <span className="text-sm font-semibold">{t.name}</span>
                  <span className="ml-2 text-xs">
                    {ps.level === 4 ? "🏨 hotel" : "🏠".repeat(ps.level) || <span className="text-white/30">empty</span>}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => dispatch({ type: "SELL_BUILDING", tileId: t.id })}
                    disabled={!sellable}
                    title={sellable ? undefined : "Requires the full unmortgaged country group"}
                    className="rounded bg-night-700 px-2.5 py-1 text-xs font-semibold text-white/70 transition enabled:hover:bg-night-600 disabled:opacity-30"
                  >
                    Sell +€{Math.ceil((t.upgradeCost ?? 20) / 2)}
                  </button>
                  <button
                    onClick={() => dispatch({ type: "BUILD", tileId: t.id })}
                    disabled={!canBuild(state, p.id, t.id)}
                    title={
                      canBuild(state, p.id, t.id)
                        ? undefined
                        : "Complete the country group first — buildings must be even"
                    }
                    className="rounded bg-accent px-2.5 py-1 text-xs font-bold text-night-950 transition enabled:hover:brightness-110 disabled:opacity-30"
                  >
                    Build {ps.level === 3 ? "🏨" : "🏠"} −€{t.upgradeCost}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-night-700 py-2 text-sm font-semibold text-white/80 transition hover:bg-night-600"
        >
          Close
        </button>
      </div>
    </div>
  )
}

function groupOk(state: GameState, playerId: string, tile: Tile): boolean {
  if (tile.kind !== "city" || !tile.country) return false
  return GROUPS[tile.country].every((id) => state.props[id].ownerId === playerId)
}
