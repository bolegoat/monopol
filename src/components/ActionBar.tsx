import { useState } from "react"
import type { Action, GameState } from "../game/engineTypes"
import { BuildPanel, TradeDialog } from "./Modals"

type Props = {
  state: GameState
  dispatch: (a: Action) => void
  isMyTurn?: boolean
  myId?: string
}

export function ActionBar({ state, dispatch, isMyTurn = true, myId }: Props) {
  const [buildOpen, setBuildOpen] = useState(false)
  const [tradeOpen, setTradeOpen] = useState(false)
  const p = state.players.find((x) => x.id === state.currentId)!
  const canEnd = isMyTurn && state.phase === "turn-end"
  const canBuild =
    isMyTurn &&
    (state.phase === "turn-end" || state.phase === "awaiting-roll" || state.phase === "awaiting-buy")
  const canTrade =
    state.phase !== "game-over" &&
    !state.pendingTrade &&
    state.players.filter((x) => !x.bankrupt).length > 1

  return (
    <footer className="relative flex items-center gap-3 rounded-xl bg-night-900/80 px-4 py-2.5 ring-1 ring-night-600">
      <span className="flex items-center gap-2 text-lg font-bold tabular-nums">
        <span className="h-4 w-4 rounded-full" style={{ background: p.color }} />
        <span className="text-emerald-300">€{p.cash}</span>
      </span>
      <div className="mx-auto flex gap-2">
        <button
          onClick={() => setBuildOpen(true)}
          disabled={!canBuild}
          className="rounded-lg bg-night-700 px-4 py-1.5 text-sm font-semibold text-white/80 transition enabled:hover:bg-night-600 enabled:hover:text-white active:scale-95 disabled:opacity-40"
        >
          Build
        </button>
        <button
          onClick={() => setTradeOpen(true)}
          disabled={!canTrade}
          title={state.pendingTrade ? "A trade is already on the table" : "Propose a trade"}
          className="rounded-lg bg-night-700 px-4 py-1.5 text-sm font-semibold text-white/80 transition enabled:hover:bg-night-600 enabled:hover:text-white active:scale-95 disabled:opacity-40"
        >
          Trade 🤝
        </button>
        <button
          disabled
          title="Shown in the player list as 🔑"
          className="rounded-lg bg-night-700 px-4 py-1.5 text-sm font-semibold text-white/80"
        >
          Cards {p.getOutCards > 0 && `(${p.getOutCards})`}
        </button>
      </div>
      <button
        onClick={() => dispatch({ type: "END_TURN" })}
        disabled={!canEnd}
        className="rounded-lg bg-accent px-6 py-1.5 text-sm font-bold text-night-950 transition enabled:hover:brightness-110 active:scale-95 disabled:opacity-40"
      >
        End Turn
      </button>

      {buildOpen && (
        <BuildPanel state={state} dispatch={dispatch} onClose={() => setBuildOpen(false)} />
      )}
      {tradeOpen && (
        <TradeDialog state={state} myId={myId} onClose={() => setTradeOpen(false)} onSend={dispatch} />
      )}
    </footer>
  )
}
