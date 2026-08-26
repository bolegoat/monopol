import type { MockPlayer } from "../game/types"
import type { Tile } from "../game/types"
import { COUNTRIES } from "../game/board"

type Props = {
  tile: Tile
  index: number
  side: "top" | "right" | "bottom" | "left"
  owner?: MockPlayer
  upgrades?: number
  mortgaged?: boolean
  playersHere: MockPlayer[]
}

const UPGRADE_ICON = ["", "🏠", "🏠🏠", "🏠🏠🏠", "🏨"]

export function Tile({ tile, index, side, owner, upgrades = 0, mortgaged, playersHere }: Props) {
  const country = tile.country ? COUNTRIES[tile.country] : undefined

  const barClass =
    side === "top"
      ? "bottom-0 left-0 right-0 h-[16%]"
      : side === "bottom"
        ? "top-0 left-0 right-0 h-[16%]"
        : side === "left"
          ? "right-0 top-0 bottom-0 w-[16%]"
          : "left-0 top-0 bottom-0 w-[16%]"

  return (
    <div
      data-tile-index={index}
      className={[
        "relative flex h-full w-full flex-col items-center justify-center gap-[2px] overflow-hidden rounded-sm",
        "border border-night-600 bg-night-800/80 px-0.5 text-center",
        mortgaged ? "opacity-40 saturate-0" : "",
      ].join(" ")}
      style={owner ? { boxShadow: `inset 0 0 0 2px ${owner.color}` } : undefined}
      title={`${tile.name}${country ? ` — ${country.name}` : ""}`}
    >
      {(country || tile.kind === "airport") && (
        <div className={`absolute ${barClass}`} style={{ background: country?.color ?? "#64748b" }} />
      )}

      {country && <span className="text-[9px] leading-none">{country.flag}</span>}

      <span className="line-clamp-2 text-[8px] font-semibold uppercase leading-[1.1] tracking-wide hyphens-auto break-words">
        {tile.name}
      </span>

      {upgrades > 0 && <span className="text-[8px] leading-none">{UPGRADE_ICON[upgrades]}</span>}

      {tile.kind === "city" && (
        <span className="text-[8px] font-medium leading-none text-emerald-300">€{tile.price}</span>
      )}

      {tile.kind === "airport" && <span className="text-sm leading-none">✈️</span>}
      {tile.kind === "event" && <span className="text-sm leading-none">🎡</span>}
      {tile.kind === "surprise" && <span className="text-sm leading-none">❓</span>}
      {tile.kind === "tax" && (
        <>
          <span className="text-xs leading-none">{tile.icon}</span>
          <span className="text-[8px] leading-none text-red-300">€{tile.amount}</span>
        </>
      )}

      {playersHere.length > 0 && (
        <div className="absolute -bottom-0.5 left-1/2 flex -translate-x-1/2 gap-px">
          {playersHere.map((p) => (
            <span
              key={p.id}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] shadow-md ring-1 ring-black/40"
              style={{ background: p.color }}
              title={p.name}
            >
              {p.icon}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
