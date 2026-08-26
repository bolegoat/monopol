import { useState } from "react"
import { TOKEN_ICONS } from "../game/mockState"
import { getSocket, type Session } from "../net/socket"

const COLORS = ["#22c55e", "#a855f7", "#3b82f6", "#f59e0b", "#ef4444", "#06b6d4"]

export function loadProfile(): { name: string; icon: string; color: string } {
  try {
    const raw = localStorage.getItem("bt-profile")
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { name: "", icon: TOKEN_ICONS[0], color: COLORS[0] }
}

function saveProfile(p: { name: string; icon: string; color: string }) {
  localStorage.setItem("bt-profile", JSON.stringify(p))
}

type Props = {
  initialCode?: string
  onSession: (s: Session) => void
  onOffline: () => void
}

export function Home({ initialCode, onSession, onOffline }: Props) {
  const [profile, setProfile] = useState(loadProfile)
  const [joinCode, setJoinCode] = useState(initialCode ?? "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const update = (patch: Partial<typeof profile>) => {
    const next = { ...profile, ...patch }
    setProfile(next)
    saveProfile(next)
  }

  const createRoom = () => {
    setBusy(true)
    setError(null)
    getSocket().emit("room:create", profile, (res) => {
      setBusy(false)
      if (res.ok && res.code && res.token) onSession({ code: res.code, token: res.token })
      else setError(res.error ?? "Could not create room.")
    })
  }

  const joinRoom = () => {
    const code = joinCode.trim().toUpperCase()
    if (code.length < 4) {
      setError("Enter the room code your friend shared.")
      return
    }
    setBusy(true)
    setError(null)
    getSocket().emit("room:join", code, profile, (res) => {
      setBusy(false)
      if (res.ok && res.token) onSession({ code, token: res.token })
      else setError(res.error ?? "Could not join room.")
    })
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md animate-fadein">
        <div className="mb-8 text-center">
          <h1 className="font-display text-5xl font-extrabold tracking-tight text-night-50">
            Balkan <span className="text-accent-400">Tycoon</span>
          </h1>
          <p className="mt-2 text-sm text-night-400">Buy the Balkans before your friends do.</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-night-900/80 p-5 shadow-xl shadow-black/30">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-night-400">Nickname</label>
          <input
            value={profile.name}
            onChange={(e) => update({ name: e.target.value.slice(0, 16) })}
            placeholder="e.g. Luka"
            className="w-full rounded-lg border border-white/10 bg-night-950 px-3 py-2 text-night-50 outline-none placeholder:text-night-600 focus:border-accent-500/60"
          />

          <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-night-400">Token</label>
          <div className="flex flex-wrap gap-1.5">
            {TOKEN_ICONS.map((icon) => (
              <button
                key={icon}
                onClick={() => update({ icon })}
                className={`h-10 w-10 rounded-lg text-xl transition ${
                  profile.icon === icon ? "bg-accent-500/25 ring-2 ring-accent-500" : "bg-night-800 hover:bg-night-700"
                }`}
              >
                {icon}
              </button>
            ))}
          </div>

          <label className="mb-2 mt-4 block text-xs font-semibold uppercase tracking-wider text-night-400">Color</label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => update({ color: c })}
                style={{ backgroundColor: c }}
                className={`h-8 w-8 rounded-full transition ${
                  profile.color === c ? "ring-2 ring-night-50 ring-offset-2 ring-offset-night-900" : "opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          )}

          <button
            onClick={createRoom}
            disabled={busy}
            className="mt-5 w-full rounded-xl bg-accent-500 py-3 font-display text-base font-bold text-night-950 transition hover:bg-accent-400 disabled:opacity-50"
          >
            Create room
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-night-600">
            <div className="h-px flex-1 bg-white/10" /> or join a friend <div className="h-px flex-1 bg-white/10" />
          </div>

          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
              onKeyDown={(e) => e.key === "Enter" && joinRoom()}
              placeholder="CODE"
              className="w-full rounded-lg border border-white/10 bg-night-950 px-3 py-2.5 text-center font-display text-lg tracking-[0.3em] text-night-50 outline-none placeholder:text-night-600 focus:border-accent-500/60"
            />
            <button
              onClick={joinRoom}
              disabled={busy}
              className="shrink-0 rounded-lg bg-night-700 px-5 font-semibold text-night-50 transition hover:bg-night-600 disabled:opacity-50"
            >
              Join
            </button>
          </div>
        </div>

        <p className="mt-6 text-center">
          <button onClick={onOffline} className="text-sm text-night-500 underline-offset-4 hover:text-night-300 hover:underline">
            Practice solo vs bots →
          </button>
        </p>
      </div>
    </div>
  )
}
