import { useState } from "react"
import { BOARD, COUNTRIES } from "../game/board"
import { netWorth } from "../game/engine"
import type { Action, GameState } from "../game/engineTypes"

type Tab = "activity" | "chat" | "trades" | "properties"

const TABS: { id: Tab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "chat", label: "Chat" },
  { id: "trades", label: "Trades" },
  { id: "properties", label: "Props" },
]

function ActivityTab({ state }: { state: GameState }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {state.log.map((e) => (
        <li
          key={e.id}
          className="flex items-start gap-2 rounded-md bg-night-800/70 px-2 py-1.5 text-[13px] leading-snug ring-1 ring-night-700"
        >
          <span>{e.icon}</span>
          <span style={{ color: e.color === "#ece9f5" ? undefined : e.color }}>{e.text}</span>
        </li>
      ))}
    </ul>
  )
}

function ChatTab() {
  const messages = [
    { who: "Luka", color: "#22c55e", text: "bro sell me Split" },
    { who: "Ana", color: "#a855f7", text: "€40 and I'm thinking" },
    { who: "Marko", color: "#3b82f6", text: "absolutely not 😂" },
  ]
  return (
    <div className="flex flex-col gap-2">
      {messages.map((m, i) => (
        <p key={i} className="text-[13px] leading-snug">
          <span className="font-bold" style={{ color: m.color }}>
            {m.who}:{" "}
          </span>
          <span className="text-white/80">{m.text}</span>
        </p>
      ))}
      <p className="mt-2 rounded-md bg-night-800/50 px-2 py-1.5 text-center text-[11px] text-white/30">
        Chat is local for now — goes online in Phase 3
      </p>
    </div>
  )
}

function TradesTab({
  state,
  myId,
  dispatch,
}: {
  state: GameState
  myId?: string
  dispatch?: (a: Action) => void
}) {
  const t = state.pendingTrade
  if (!t)
    return (
      <div className="rounded-lg bg-night-800/70 p-4 text-center text-[13px] text-white/40 ring-1 ring-night-700">
        🤝 No active trade offers.
      </div>
    )

  const from = state.players.find((p) => p.id === t.from)!
  const to = state.players.find((p) => p.id === t.to)!
  const viewerId = myId ?? state.currentId
  const isIncoming = t.to === viewerId
  const tileName = (id: string) => BOARD.find((x) => x.id === id)?.name ?? id

  return (
    <div className="animate-[fadein_0.2s_ease-out] space-y-2 rounded-lg bg-night-800/70 p-3 ring-1 ring-blue-500/40">
      <p className="text-xs font-bold uppercase tracking-wider text-blue-300">
        {isIncoming ? "Incoming offer" : "Offer in progress"}
      </p>
      <p className="text-[13px] text-white/70">
        <strong style={{ color: from.color }}>{from.name}</strong> →{" "}
        <strong style={{ color: to.color }}>{to.name}</strong>
      </p>
      <div className="space-y-1 text-xs">
        <p className="text-emerald-300">
          Gives: {t.giveTiles.map(tileName).join(", ") || "—"}
          {t.giveCash > 0 && ` + €${t.giveCash}`}
        </p>
        <p className="text-accent-300">
          Wants: {t.wantTiles.map(tileName).join(", ") || "—"}
          {t.wantCash > 0 && ` + €${t.wantCash}`}
        </p>
      </div>
      {isIncoming && dispatch ? (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => dispatch({ type: "TRADE_ACCEPT" })}
            className="flex-1 rounded-lg bg-green-600 py-1.5 text-sm font-bold text-white transition hover:bg-green-500 active:scale-95"
          >
            Accept
          </button>
          <button
            onClick={() => dispatch({ type: "TRADE_DECLINE" })}
            className="flex-1 rounded-lg bg-night-700 py-1.5 text-sm font-semibold text-white/80 transition hover:bg-night-600 active:scale-95"
          >
            Decline
          </button>
        </div>
      ) : (
        <p className="pt-1 text-center text-[11px] text-white/35">
          Waiting for {to.name} to respond…
        </p>
      )}
    </div>
  )
}

function PropertiesTab({ state }: { state: GameState }) {
  const owned = BOARD.filter((t) => state.props[t.id]?.ownerId)
  if (owned.length === 0)
    return <p className="pt-4 text-center text-sm text-white/30">No properties owned yet.</p>

  return (
    <ul className="flex flex-col gap-1.5">
      {owned.map((tile) => {
        const ps = state.props[tile.id]
        const owner = state.players.find((p) => p.id === ps!.ownerId)!
        return (
          <li
            key={tile.id}
            className={`flex items-center justify-between rounded-md bg-night-800/70 px-2 py-1.5 text-[13px] ring-1 ring-night-700 ${
              ps!.mortgaged ? "opacity-40 saturate-0" : ""
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: owner.color }} />
              {tile.kind === "city" && COUNTRIES[tile.country!].flag} {tile.name}
              {ps!.level > 0 && (
                <span>{ps!.level === 4 ? "🏨" : "🏠".repeat(ps!.level)}</span>
              )}
            </span>
            <span className="text-white/50">{owner.name}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function SidePanel({
  state,
  connectedIds,
  myId,
  dispatch,
}: {
  state: GameState
  connectedIds?: Set<string>
  myId?: string
  dispatch?: (a: Action) => void
}) {
  const [tab, setTab] = useState<Tab>("activity")
  const hasIncoming = !!state.pendingTrade && state.pendingTrade.to === (myId ?? state.currentId)

  return (
    <aside className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-3 overflow-hidden">
      {/* players */}
      <section className="rounded-xl bg-night-900/80 p-3 ring-1 ring-night-600">
        <h2 className="mb-2 text-xs font-bold tracking-widest text-white/40 uppercase">Players</h2>
        <ul className="flex flex-col gap-2">
          {[...state.players]
            .sort((a, b) => netWorth(state, b) - netWorth(state, a))
            .map((p) => {
              const isCurrent = p.id === state.currentId && state.phase !== "game-over"
              const offline = connectedIds ? !connectedIds.has(p.id) : false
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 transition ${p.bankrupt || offline ? "opacity-40 saturate-0" : ""}`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isCurrent ? "animate-pulse bg-accent" : "ring-1 ring-white/20"
                    }`}
                  />
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm shadow ring-1 ring-black/40"
                    style={{ background: p.color }}
                  >
                    {p.icon}
                  </span>
                  <span className={`flex-1 truncate text-sm ${isCurrent ? "font-bold" : ""}`}>
                    {offline && "📴 "}
                    {p.name}
                    {p.inJail && " ⛓️"}
                    {p.getOutCards > 0 && ` 🔑${p.getOutCards}`}
                    {p.bankrupt && " 💀"}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-emerald-300">
                    €{p.cash}
                  </span>
                </li>
              )
            })}
        </ul>
      </section>

      {/* tabs */}
      <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-night-900/80 ring-1 ring-night-600">
        <div className="flex border-b border-night-600">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 px-2 py-2 text-xs font-semibold transition ${
                tab === t.id
                  ? "border-b-2 border-accent text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {t.label}
              {t.id === "trades" && hasIncoming && tab !== "trades" && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 animate-pulse rounded-full bg-blue-400" />
              )}
            </button>
          ))}
        </div>
        <div key={tab} className="animate-[fadein_0.25s_ease-out] flex-1 overflow-y-auto p-2.5">
          {tab === "activity" && <ActivityTab state={state} />}
          {tab === "chat" && <ChatTab />}
          {tab === "trades" && <TradesTab state={state} myId={myId} dispatch={dispatch} />}
          {tab === "properties" && <PropertiesTab state={state} />}
        </div>
      </section>
    </aside>
  )
}
