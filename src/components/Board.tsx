import { useMemo } from "react"
import { BOARD, COUNTRIES, tileSide } from "../game/board"
import type { Action, GameState, PlayerState } from "../game/engineTypes"
import type { Tile as TileType } from "../game/types"
import { Tile } from "./Tile"
import { DiceArea } from "./DiceArea"

function gridPos(index: number): { row: number; col: number } {
  if (index <= 10) return { row: 1, col: index + 1 }
  if (index < 20) return { row: index - 9, col: 11 }
  if (index <= 30) return { row: 11, col: 31 - index }
  return { row: 41 - index, col: 1 }
}

type Props = {
  state: GameState
  dispatch: (a: Action) => void
  isMyTurn?: boolean
}

export function Board({ state, dispatch, isMyTurn = true }: Props) {
  const playersByTile = useMemo(() => {
    const map = new Map<number, PlayerState[]>()
    for (const p of state.players.filter((x) => !x.bankrupt)) {
      const list = map.get(p.position) ?? []
      list.push(p)
      map.set(p.position, list)
    }
    return map
  }, [state.players])

  const ownerOf = (tile: TileType) =>
    state.props[tile.id]?.ownerId
      ? state.players.find((p) => p.id === state.props[tile.id].ownerId)
      : undefined

  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="my-auto aspect-square w-full max-w-full grid grid-cols-[1.5fr_repeat(9,1fr)_1.5fr] grid-rows-[1.5fr_repeat(9,1fr)_1.5fr] gap-[3px] rounded-xl bg-night-900/60 p-2 ring-1 ring-night-600">
        {BOARD.map((tile, i) => {
          const { row, col } = gridPos(i)
          const side = tileSide(i)
          const ps = state.props[tile.id]
          const isPending = state.pendingTileId === tile.id
          return (
            <div
              key={tile.id}
              style={{ gridRow: row, gridColumn: col }}
              className={`min-h-0 min-w-0 ${isPending ? "animate-pulse rounded-sm ring-2 ring-accent" : ""}`}
            >
              <Tile
                tile={tile}
                index={i}
                side={side === "corner" ? "top" : side}
                owner={ownerOf(tile)}
                upgrades={ps?.level ?? 0}
                mortgaged={ps?.mortgaged ?? false}
                playersHere={playersByTile.get(i) ?? []}
              />
            </div>
          )
        })}

        {/* center */}
        <div
          style={{ gridRow: "2 / 11", gridColumn: "2 / 11" }}
          className="flex min-h-0 items-center justify-center"
        >
          <DiceArea state={state} dispatch={dispatch} isMyTurn={isMyTurn} />
        </div>

        {/* group legend */}
        <div
          style={{ gridRow: 10, gridColumn: "3 / 11", alignSelf: "end" }}
          className="pointer-events-none flex flex-wrap items-end justify-center gap-x-3 gap-y-0.5 pb-1 text-[9px] text-white/40"
        >
          {Object.values(COUNTRIES).map((c) => (
            <span key={c.id}>
              {c.flag} {c.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
