import { useEffect, useState } from "react"
import type { GameState } from "../game/engineTypes"

function useCountdown(deadline: number | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!deadline) {
      setRemaining(null)
      return
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    tick()
    const iv = setInterval(tick, 500)
    return () => clearInterval(iv)
  }, [deadline])
  return remaining
}

export function Header({
  state,
  roomCode,
  turnDeadline,
}: {
  state: GameState
  roomCode?: string
  turnDeadline?: number | null
}) {
  const seconds = useCountdown(turnDeadline)
  const p = state.players.find((x) => x.id === state.currentId)
  return (
    <header className="flex items-center justify-between rounded-xl bg-night-900/80 px-4 py-2.5 ring-1 ring-night-600">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-lg font-black tracking-wide text-accent">
          BALKAN TYCOON
        </span>
        {roomCode && (
          <span className="text-xs text-white/40">
            Room <span className="font-mono font-bold text-white/70">{roomCode}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-sm text-white/60">
        {p && (
          <span className="flex items-center gap-1.5">
            Now playing:
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs"
              style={{ background: p.color }}
            >
              {p.icon}
            </span>
            <strong className="text-white">{p.name}</strong>
          </span>
        )}
        {seconds != null && (
          <span
            className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold tabular-nums ${
              seconds <= 10 ? "bg-red-500/20 text-red-300" : "bg-night-700 text-night-200"
            }`}
          >
            ⏱ {seconds}s
          </span>
        )}
        <span>
          Turn <strong className="text-white">{Math.min(state.turn, state.maxTurns)}</strong> /{" "}
          {state.maxTurns}
        </span>
        <button className="text-white/40 transition hover:text-white" title="Sound (coming in Phase 6)">
          🔊
        </button>
      </div>
    </header>
  )
}
