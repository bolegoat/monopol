import { useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import type { ClientToServerEvents, PublicRoom, ServerToClientEvents } from "./protocol"
import type { Action } from "../game/engineTypes"

export type Session = { code: string; token: string }

const SESSION_KEY = "bt-session"

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    return typeof s.code === "string" && typeof s.token === "string" ? s : null
  } catch {
    return null
  }
}

export function saveSession(s: Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) socket = io({ autoConnect: true })
  return socket
}

/**
 * Connects to the room channel and keeps the latest PublicRoom in state.
 * Tries token rejoin once when a stored session exists.
 */
export function useRoom(session: Session | null): { room: PublicRoom | null; connected: boolean } {
  const [room, setRoom] = useState<PublicRoom | null>(null)
  const [connected, setConnected] = useState(false)
  const triedRejoin = useRef(false)

  useEffect(() => {
    const s = getSocket()
    const onState = (r: PublicRoom) => setRoom(r)
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    s.on("room:state", onState)
    s.on("connect", onConnect)
    s.on("disconnect", onDisconnect)
    if (s.connected) setConnected(true)

    let rejoinHandler: (() => void) | null = null
    if (session && !triedRejoin.current) {
      triedRejoin.current = true
      rejoinHandler = () => {
        s.emit("room:rejoin", session.code, session.token, (res) => {
          if (!res.ok) saveSession(null)
        })
      }
      if (s.connected) rejoinHandler()
      else s.once("connect", rejoinHandler)
    }

    return () => {
      s.off("room:state", onState)
      s.off("connect", onConnect)
      s.off("disconnect", onDisconnect)
      if (rejoinHandler) s.off("connect", rejoinHandler)
    }
  }, [session?.code])

  return { room, connected }
}

/** Fire a game action to the server (no local mutation — server is authoritative). */
export function sendAction(action: Action) {
  getSocket().emit("game:action", action)
}
