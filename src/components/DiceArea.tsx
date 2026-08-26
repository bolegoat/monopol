import { useEffect, useRef, useState } from "react"
import type { GameState } from "../game/engineTypes"
import type { Action } from "../game/engineTypes"

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
}

function Die({ value, rolling }: { value: number; rolling: boolean }) {
  return (
    <div
      className={`grid h-[clamp(44px,5vw,72px)] w-[clamp(44px,5vw,72px)] grid-cols-3 grid-rows-3 gap-1 rounded-xl bg-white p-1.5 shadow-lg shadow-black/40 ${
        rolling ? "animate-[wiggle_0.18s_ease-in-out_infinite]" : ""
      }`}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const r = Math.floor(i / 3)
        const c = i % 3
        const on = PIPS[value]?.some(([pr, pc]) => pr === r && pc === c)
        return (
          <span key={i} className="flex items-center justify-center">
            {on && <span className="h-full w-full rounded-full bg-night-900" />}
          </span>
        )
      })}
    </div>
  )
}

type Props = {
  state: GameState
  dispatch: (a: Action) => void
  isMyTurn?: boolean
}

export function DiceArea({ state, dispatch, isMyTurn = true }: Props) {
  const [display, setDisplay] = useState<[number, number]>([3, 5])
  const [rolling, setRolling] = useState(false)
  const scramble = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (scramble.current) clearInterval(scramble.current)
      if (timeout.current) clearTimeout(timeout.current)
    },
    [],
  )

  const startRoll = () => {
    if (rolling) return
    setRolling(true)
    scramble.current = setInterval(() => {
      setDisplay([rand(), rand()])
    }, 90)
    timeout.current = setTimeout(() => {
      if (scramble.current) clearInterval(scramble.current)
      setRolling(false)
    }, 900)
  }

  const p = state.players.find((x) => x.id === state.currentId)!
  const latest = state.log[0]
  const canRoll =
    isMyTurn && !rolling && (state.phase === "awaiting-roll" || state.phase === "awaiting-jail")

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-center">
        <div className="font-display text-xl font-black tracking-widest text-accent">
          BALKAN TYCOON
        </div>
        <div className="mt-0.5 flex items-center justify-center gap-1.5 text-xs text-white/60">
          Turn {state.turn} ·{" "}
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]"
            style={{ background: p.color }}
          >
            {p.icon}
          </span>
          <strong style={{ color: p.color }}>{p.name}</strong> is playing
          {p.inJail ? " ⛓️" : ""}
        </div>
      </div>

      {state.phase !== "awaiting-jail" && (
        <>
          <div className="flex items-center gap-4">
            <Die value={display[0]} rolling={rolling} />
            <Die value={display[1]} rolling={rolling} />
          </div>
          <div className="text-sm text-white/70">
            Total: <span className="font-bold text-white">{display[0] + display[1]}</span>
          </div>
        </>
      )}

      {state.lastDrawn && state.phase !== "awaiting-jail" && (
        <div className="animate-[fadein_0.25s_ease-out] max-w-56 rounded-xl bg-night-700/80 px-4 py-2 text-center text-xs ring-1 ring-accent/40">
          <span className="mr-1">{state.lastDrawn.icon}</span>
          {state.lastDrawn.text}
        </div>
      )}

      {state.phase === "awaiting-jail" ? (
        <JailInline state={state} dispatch={dispatch} onAnimate={startRoll} isMyTurn={isMyTurn} />
      ) : (
        <button
          onClick={() => {
            startRoll()
            dispatch({ type: "ROLL" })
          }}
          disabled={!canRoll}
          className="rounded-lg bg-accent px-8 py-2.5 font-bold text-night-950 shadow-md shadow-accent/20 transition hover:brightness-110 active:scale-95 disabled:opacity-40"
        >
          {rolling ? "ROLLING…" : isMyTurn ? "ROLL DICE" : "Not your turn…"}
        </button>
      )}

      {latest && (
        <div className="max-w-64 truncate text-center text-xs text-white/45">
          {latest.icon} {latest.text}
        </div>
      )}
    </div>
  )
}

function JailInline({
  state,
  dispatch,
  onAnimate,
  isMyTurn = true,
}: {
  state: GameState
  dispatch: (a: Action) => void
  onAnimate: () => void
  isMyTurn?: boolean
}) {
  const p = state.players.find((x) => x.id === state.currentId)!
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="text-sm font-bold text-red-300">
        ⛓️ In prison · attempt {p.jailTurns + 1}/3
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={() => {
            onAnimate()
            dispatch({ type: "ROLL_JAIL" })
          }}
          disabled={!isMyTurn}
          className="rounded-lg bg-accent px-6 py-2 text-sm font-bold text-night-950 transition hover:brightness-110 active:scale-95 disabled:opacity-40"
        >
          Roll for doubles
        </button>
        <button
          onClick={() => dispatch({ type: "PAY_JAIL" })}
          disabled={!isMyTurn || p.cash < 30}
          className="rounded-lg bg-night-700 px-4 py-2 text-sm font-semibold text-white/80 transition enabled:hover:bg-night-600 disabled:opacity-40"
        >
          Pay €30 bail
        </button>
        {p.getOutCards > 0 && (
          <button
            onClick={() => dispatch({ type: "USE_JAIL_CARD" })}
            disabled={!isMyTurn}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            🔑 Use card ({p.getOutCards})
          </button>
        )}
      </div>
    </div>
  )
}

function rand(): number {
  return 1 + Math.floor(Math.random() * 6)
}
