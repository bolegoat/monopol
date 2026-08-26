import { useState } from "react"
import { PRESETS, TURN_TIMER_OPTIONS, type PresetId, type PublicRoom } from "../net/protocol"
import { getSocket } from "../net/socket"

type Props = {
  room: PublicRoom
  myId: string
}

export function Lobby({ room, myId }: Props) {
  const [copied, setCopied] = useState(false)
  const me = room.players.find((p) => p.id === myId)
  const isHost = room.hostId === myId
  const allReady = room.players.length >= 2 && room.players.every((p) => p.ready)
  const joinLink = `${location.origin}/?room=${room.code}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl animate-fadein">
        <h1 className="font-display text-3xl font-extrabold text-night-50">
          Room <span className="text-accent-400 tracking-[0.25em]">{room.code}</span>
        </h1>
        <p className="mt-1 text-sm text-night-400">Share the code (or link) with up to 5 friends.</p>

        <button
          onClick={copyLink}
          className="mt-3 w-full rounded-xl border border-white/10 bg-night-900/80 px-4 py-2.5 text-left text-sm text-night-300 transition hover:border-accent-500/40"
        >
          <span className="text-night-500">Join link: </span>
          <span className="underline decoration-dotted underline-offset-4">{joinLink}</span>
          <span className="ml-2 font-semibold text-accent-400">{copied ? "Copied!" : "Copy"}</span>
        </button>

        {/* players */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: Math.max(room.players.length, 2) }).map((_, i) => {
            const p = room.players[i]
            if (!p) {
              return (
                <div key={`empty-${i}`} className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-night-600">
                  Waiting for a player…
                  <div className="mt-2 text-2xl opacity-40">🪑</div>
                </div>
              )
            }
            return (
              <div
                key={p.id}
                style={{ borderColor: `${p.color}55` }}
                className={`flex items-center gap-3 rounded-2xl border bg-night-900/80 p-4 ${p.connected ? "" : "opacity-40"}`}
              >
                <span
                  style={{ backgroundColor: `${p.color}30`, color: p.color }}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl"
                >
                  {p.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-night-50">
                    {p.name}
                    {p.id === myId && <span className="ml-1.5 text-xs font-normal text-night-400">(you)</span>}
                  </p>
                  <p className={`text-xs font-semibold ${p.ready ? "text-green-400" : "text-night-500"}`}>
                    {p.isHost ? "👑 Host" : p.ready ? "✓ Ready" : "Not ready"}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* settings */}
        <div className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-night-900/80 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display font-bold text-night-50">Match length</h2>
              <p className="text-xs text-night-400">
                Starting cash €{PRESETS[room.settings.preset].startingCash} · GO reward €{PRESETS[room.settings.preset].goReward} ·{" "}
                {PRESETS[room.settings.preset].maxTurns} turns
              </p>
            </div>
            <div className="flex rounded-lg border border-white/10 bg-night-950 p-1">
              {(Object.keys(PRESETS) as PresetId[]).map((id) => (
                <button
                  key={id}
                  disabled={!isHost}
                  onClick={() => getSocket().emit("settings:update", { ...room.settings, preset: id })}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                    room.settings.preset === id ? "bg-accent-500 text-night-950" : "text-night-400 hover:text-night-200"
                  } disabled:opacity-50`}
                >
                  {PRESETS[id].label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display font-bold text-night-50">Turn timer</h2>
              <p className="text-xs text-night-400">Auto-plays slow or absent players so nobody stalls the game.</p>
            </div>
            <div className="flex rounded-lg border border-white/10 bg-night-950 p-1">
              {TURN_TIMER_OPTIONS.map((secs) => (
                <button
                  key={secs}
                  disabled={!isHost}
                  onClick={() => getSocket().emit("settings:update", { ...room.settings, turnSeconds: secs })}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                    room.settings.turnSeconds === secs
                      ? "bg-accent-500 text-night-950"
                      : "text-night-400 hover:text-night-200"
                  } disabled:opacity-50`}
                >
                  {secs === 0 ? "Off" : `${secs}s`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* actions */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => getSocket().emit("player:ready", !(me?.ready ?? false))}
            className={`flex-1 rounded-xl py-3 font-display text-base font-bold transition ${
              me?.ready
                ? "bg-night-700 text-night-100 hover:bg-night-600"
                : "bg-green-500 text-night-950 hover:bg-green-400"
            }`}
          >
            {me?.ready ? "Cancel ready" : "I'm ready"}
          </button>
          {isHost && (
            <button
              disabled={!allReady}
              onClick={() => getSocket().emit("game:start")}
              className="flex-[2] rounded-xl bg-accent-500 py-3 font-display text-base font-bold text-night-950 transition hover:bg-accent-400 disabled:opacity-40"
            >
              {room.players.length < 2
                ? "Need at least 2 players"
                : allReady
                  ? "Start game 🎲"
                  : "Waiting for everyone to ready up"}
            </button>
          )}
        </div>

        <p className="mt-4 text-center">
          <button
            onClick={() => getSocket().emit("room:leave")}
            className="text-sm text-night-500 underline-offset-4 hover:text-night-300 hover:underline"
          >
            Leave room
          </button>
        </p>
      </div>
    </div>
  )
}
