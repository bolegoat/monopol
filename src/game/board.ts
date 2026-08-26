import type { Country, CountryId, Tile } from "./types"

export const COUNTRIES: Record<CountryId, Country> = {
  mk: {
    id: "mk",
    name: "North Macedonia",
    flag: "🇲🇰",
    color: "#f59e0b",
    flavor: "Three cities. One questionable business plan.",
  },
  me: {
    id: "me",
    name: "Montenegro",
    flag: "🇲🇪",
    color: "#ef4444",
    flavor: "Mountains, coast, and creative accounting.",
  },
  ba: {
    id: "ba",
    name: "Bosnia & Herzegovina",
    flag: "🇧🇦",
    color: "#3b82f6",
    flavor: "Great coffee. Even better rent prices.",
  },
  si: {
    id: "si",
    name: "Slovenia",
    flag: "🇸🇮",
    color: "#22c55e",
    flavor: "Small country. Premium vibes. Premium invoices.",
  },
  hr: {
    id: "hr",
    name: "Croatia",
    flag: "🇭🇷",
    color: "#ec4899",
    flavor: "Tourist season pays for everything.",
  },
  rs: {
    id: "rs",
    name: "Serbia",
    flag: "🇷🇸",
    color: "#8b5cf6",
    flavor: "Where every deal comes with rakija.",
  },
}

const city = (
  id: string,
  name: string,
  country: CountryId,
  price: number,
  baseRent: number,
  upgradeCost: number,
): Tile => ({ id, kind: "city", name, country, price, baseRent, upgradeCost })

const airport = (id: string, name: string): Tile => ({
  id,
  kind: "airport",
  name,
  icon: "✈️",
  price: 100,
})

const event = (id: string): Tile => ({
  id,
  kind: "event",
  name: "Balkan Event",
  icon: "🎡",
})

const surprise = (id: string): Tile => ({
  id,
  kind: "surprise",
  name: "Surprise",
  icon: "❓",
})

const tax = (id: string, name: string, amount: number, icon: string): Tile => ({
  id,
  kind: "tax",
  name,
  amount,
  icon,
})

export const BOARD: Tile[] = [
  // 0 — top-left corner
  { id: "go", kind: "go", name: "GO", icon: "🏁" },
  city("bitola", "Bitola", "mk", 40, 4, 20),
  event("ev-1"),
  city("ohrid", "Ohrid", "mk", 50, 6, 20),
  tax("income-tax", "Earnings Tax", 45, "📉"),
  airport("skopje-airport", "Skopje Airport"),
  city("skopje", "Skopje", "mk", 60, 8, 25),
  surprise("sp-1"),
  city("niksic", "Nikšić", "me", 60, 8, 25),
  tax("luxury-tax", "Luxury Tax", 25, "💎"),
  // 10 — top-right corner
  { id: "jail", kind: "jail", name: "In Prison", icon: "⛓️" },
  city("cetinje", "Cetinje", "me", 70, 10, 25),
  surprise("sp-2"),
  city("podgorica", "Podgorica", "me", 80, 12, 30),
  airport("podgorica-airport", "Podgorica Airport"),
  city("tuzla", "Tuzla", "ba", 80, 12, 30),
  event("ev-2"),
  city("mostar", "Mostar", "ba", 90, 14, 30),
  city("sarajevo", "Sarajevo", "ba", 100, 16, 35),
  airport("sarajevo-airport", "Sarajevo Airport"),
  // 20 — bottom-right corner
  { id: "free-parking", kind: "free-parking", name: "Vacation", icon: "🏖️" },
  city("kranj", "Kranj", "si", 100, 16, 35),
  tax("customs", "Customs Fee", 30, "🛃"),
  city("maribor", "Maribor", "si", 110, 18, 35),
  city("ljubljana", "Ljubljana", "si", 120, 20, 40),
  airport("ljubljana-airport", "Ljubljana Airport"),
  city("osijek", "Osijek", "hr", 120, 20, 40),
  event("ev-3"),
  city("rijeka", "Rijeka", "hr", 135, 22, 40),
  city("split", "Split", "hr", 150, 26, 45),
  // 30 — bottom-left corner
  { id: "go-to-jail", kind: "go-to-jail", name: "Go to Prison", icon: "🚨" },
  city("nis", "Niš", "rs", 140, 24, 45),
  airport("zagreb-airport", "Zagreb Airport"),
  city("novi-sad", "Novi Sad", "rs", 160, 28, 45),
  event("ev-4"),
  city("beograd", "Beograd", "rs", 180, 32, 45),
  surprise("sp-3"),
  airport("belgrade-airport", "Belgrade Airport"),
  tax("parking-inspector", "Parking Inspector", 35, "🚦"),
  surprise("sp-4"),
]

/** Which side of the board a tile sits on, based on its index. */
export function tileSide(index: number): "top" | "right" | "bottom" | "left" | "corner" {
  if (index <= 10) return index === 0 || index === 10 ? "corner" : "top"
  if (index < 20) return "right"
  if (index <= 30) return index === 20 || index === 30 ? "corner" : "bottom"
  return "left"
}
