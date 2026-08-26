import { netWorth } from "../game/engine"
import type { GameState } from "../game/engineTypes"

export function GameOverOverlay({
  state,
  onRestart,
  restartLabel = "Play again",
}: {
  state: GameState
  onRestart: () => void
  restartLabel?: string
}) {
  const standings = [...state.players].sort((a, b) => netWorth(state, b) - netWorth(state, a))
  const winner = state.winner?.playerId
    ? state.players.find((p) => p.id === state.winner!.playerId)
    : undefined

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur">
      <div className="animate-[fadein_0.3s_ease-out] w-80 rounded-2xl bg-night-800 p-6 text-center ring-1 ring-accent/50 shadow-2xl">
        <div className="text-5xl">🏆</div>
        <h1 className="font-display mt-2 text-2xl font-black text-accent">
          {winner ? `${winner.name} wins!` : "Game over"}
        </h1>
        <p className="mt-1 text-xs text-white/40">{state.winner?.reason}</p>
        <ul className="mt-4 space-y-1.5 text-left">
          {standings.map((p, i) => (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                i === 0 ? "bg-accent/10 ring-1 ring-accent/40" : "bg-night-900/70"
              } ${p.bankrupt ? "opacity-40 saturate-0" : ""}`}
            >
              <span className="w-5 text-xs font-bold text-white/30">#{i + 1}</span>
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm"
                style={{ background: p.color }}
              >
                {p.icon}
              </span>
              <span className="flex-1 truncate text-sm">{p.name}</span>
              <span className="text-sm font-bold tabular-nums text-emerald-300">
                €{netWorth(state, p)}
              </span>
            </li>
          ))}
        </ul>
        <button
          onClick={onRestart}
          className="mt-5 w-full rounded-lg bg-accent py-2.5 font-bold text-night-950 transition hover:brightness-110 active:scale-95"
        >
          {restartLabel}
        </button>
      </div>
    </div>
  )
}
