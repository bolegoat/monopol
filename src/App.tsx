import { useEffect, useReducer, useState } from "react"
import { createGame, reducer } from "./game/engine"
import { DEFAULT_PLAYERS } from "./game/mockState"
import type { GameState } from "./game/engineTypes"
import type { Action } from "./game/engineTypes"
import { Board } from "./components/Board"
import { Header } from "./components/Header"
import { SidePanel } from "./components/SidePanel"
import { ActionBar } from "./components/ActionBar"
import { BuyDialog } from "./components/Modals"
import { GameOverOverlay } from "./components/GameOver"
import { Home } from "./screens/Home"
import { Lobby } from "./screens/Lobby"
import { getSocket, loadSession, saveSession, sendAction, useRoom, type Session } from "./net/socket"

type Mode = "home" | "offline" | "online"

function GameView({
  state,
  dispatch,
  onRestart,
  restartLabel,
  myId,
  roomCode,
  turnDeadline,
  connectedPlayers,
}: {
  state: GameState
  dispatch: (a: Action) => void
  onRestart: () => void
  restartLabel: string
  myId?: string
  roomCode?: string
  turnDeadline?: number | null
  connectedPlayers?: string[]
}) {
  const isMyTurn = !myId || state.currentId === myId
  const connectedIds = new Set(roomCode ? (connectedPlayers ?? []) : [])
  return (
    <div className="relative flex h-full flex-col gap-3 p-3">
      <Header state={state} roomCode={roomCode} turnDeadline={turnDeadline} />
      <main className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 min-w-0 flex-1">
          <Board state={state} dispatch={dispatch} isMyTurn={isMyTurn} />
        </div>
        <SidePanel state={state} connectedIds={roomCode ? connectedIds : undefined} myId={myId} dispatch={dispatch} />
      </main>
      <ActionBar state={state} dispatch={dispatch} isMyTurn={isMyTurn} myId={myId} />

      {state.phase === "awaiting-buy" && (
        <BuyDialog
          state={state}
          isMyTurn={isMyTurn}
          onBuy={() => dispatch({ type: "BUY" })}
          onDecline={() => dispatch({ type: "DECLINE_BUY" })}
        />
      )}
      {state.phase === "game-over" && <GameOverOverlay state={state} onRestart={onRestart} restartLabel={restartLabel} />}
    </div>
  )
}

function OfflineGame({ onExit }: { onExit: () => void }) {
  const [round, setRound] = useState(0)
  const [state, dispatch] = useReducer(
    (s: GameState, a: Action) => reducer(s, a),
    undefined,
    () => createGame(DEFAULT_PLAYERS),
  )
  return (
    <>
      <button
        onClick={onExit}
        className="fixed top-3 right-3 z-40 rounded-lg bg-night-800 px-3 py-1.5 text-xs font-semibold text-night-300 hover:bg-night-700"
      >
        ← Menu
      </button>
      <GameView
        key={round}
        state={state}
        dispatch={dispatch}
        onRestart={() => setRound((r) => r + 1)}
        restartLabel="Play again"
      />
    </>
  )
}

export default function App() {
  const [mode, setMode] = useState<Mode>("home")
  const [session, setSession] = useState<Session | null>(null)
  const { room } = useRoom(session)

  const inviteCode = new URLSearchParams(location.search).get("room") ?? ""

  // auto-rejoin a stored session (page reload mid-game)
  useEffect(() => {
    if (mode === "online" || session) return
    const stored = loadSession()
    if (stored && !inviteCode) {
      setSession(stored)
      setMode("online")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startOnline = (s: Session) => {
    saveSession(s)
    setSession(s)
    setMode("online")
    history.replaceState(null, "", "/")
  }

  const exitOnline = () => {
    getSocket().emit("room:leave")
    saveSession(null)
    setSession(null)
    setMode("home")
  }

  if (mode === "offline") {
    return <OfflineGame onExit={() => setMode("home")} />
  }

  if (mode === "online" && room) {
    const myId = session?.token ?? ""
    if (room.status === "lobby") {
      return (
        <>
          <MenuButton onExit={exitOnline} />
          <Lobby room={room} myId={myId} />
        </>
      )
    }
    if (room.game) {
      const isHost = room.hostId === myId
      return (
        <GameView
          state={room.game}
          dispatch={sendAction}
          myId={myId}
          roomCode={room.code}
          turnDeadline={room.turnDeadline}
          connectedPlayers={room.players.filter((p) => p.connected).map((p) => p.id)}
          onRestart={isHost ? () => getSocket().emit("game:back-to-lobby") : () => {}}
          restartLabel={isHost ? "Back to lobby" : "Waiting for host…"}
        />
      )
    }
  }

  return <Home initialCode={inviteCode} onSession={startOnline} onOffline={() => setMode("offline")} />
}

function MenuButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      onClick={onExit}
      className="fixed top-3 right-3 z-40 rounded-lg bg-night-800 px-3 py-1.5 text-xs font-semibold text-night-300 hover:bg-night-700"
    >
      ← Leave
    </button>
  )
}
