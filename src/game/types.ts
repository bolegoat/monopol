export type TileKind =
  | "go"
  | "city"
  | "airport"
  | "event"
  | "surprise"
  | "tax"
  | "jail"
  | "free-parking"
  | "go-to-jail"

export type CountryId =
  | "mk"
  | "me"
  | "ba"
  | "si"
  | "hr"
  | "rs"

export type Country = {
  id: CountryId
  name: string
  flag: string
  color: string
  flavor: string
}

export type Tile = {
  id: string
  kind: TileKind
  name: string
  country?: CountryId
  price?: number
  baseRent?: number
  upgradeCost?: number
  icon?: string
  amount?: number
}

export type MockPlayer = {
  id: string
  name: string
  icon: string
  color: string
  cash: number
  position: number
  ready?: boolean
  bankrupt?: boolean
}

export type LogEntry = {
  id: number
  icon: string
  color: string
  text: string
}
