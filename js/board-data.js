/* ============================================================================
 * Balkan Tycoon — board-data.js
 * The complete 40-tile ring: 8 countries, 4 airports, 2 utilities,
 * 3 Surprise, 3 Balkan Events, 1 border tax and 4 corner tiles.
 *
 * Ring order mirrors the classic layout (Start bottom-right, move
 * counter-clockwise): Bottom = MK+AL, Left = ME+BA, Top = BG+RS,
 * Right = HR+SI. Prices rise progressively from Start to End.
 * ========================================================================== */

"use strict";

/* ---------- Countries (8 standalone color groups) ---------- */

const COUNTRIES = {
  mk: {
    id: "mk",
    name: "North Macedonia",
    short: "MK",
    color: "#955436", // brown / low tier
    textOn: "#ffffff",
    flavor: "Three cities. One questionable business plan.",
  },
  al: {
    id: "al",
    name: "Albania",
    short: "AL",
    color: "#6ec3ea", // light blue / low tier
    textOn: "#0b2a3a",
    flavor: "The riviera is open for business.",
  },
  me: {
    id: "me",
    name: "Montenegro",
    short: "ME",
    color: "#e0449b", // pink / mid tier
    textOn: "#ffffff",
    flavor: "Mountains, coast, and creative accounting.",
  },
  ba: {
    id: "ba",
    name: "Bosnia & Herzegovina",
    short: "BA",
    color: "#f7941d", // orange / mid tier
    textOn: "#3a1d00",
    flavor: "Great coffee. Even better rent prices.",
  },
  bg: {
    id: "bg",
    name: "Bulgaria",
    short: "BG",
    color: "#ed1b24", // red / mid-high tier
    textOn: "#ffffff",
    flavor: "Roses, rakia and rising rents.",
  },
  rs: {
    id: "rs",
    name: "Serbia",
    short: "RS",
    color: "#ffd500", // yellow / high tier
    textOn: "#3a2f00",
    flavor: "Where every deal comes with rakija.",
  },
  hr: {
    id: "hr",
    name: "Croatia",
    short: "HR",
    color: "#1fb25a", // green / high tier
    textOn: "#ffffff",
    flavor: "Tourist season pays for everything.",
  },
  si: {
    id: "si",
    name: "Slovenia",
    short: "SI",
    color: "#2b4bd8", // dark blue / premium tier
    textOn: "#ffffff",
    flavor: "Small country. Premium vibes. Premium invoices.",
  },
};

/* ---------- Compact inline SVG flags (viewBox 0 0 24 16) ---------- */

const FLAGS = {
  mk: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="16" fill="#d20000"/>
    <g fill="#ffe600">
      <circle cx="12" cy="8" r="2.2"/>
      <path d="M12 0 L13.4 6.4 L10.6 6.4 Z"/><path d="M12 16 L10.6 9.6 L13.4 9.6 Z"/>
      <path d="M0 8 L8 9.2 L8 6.8 Z"/><path d="M24 8 L16 6.8 L16 9.2 Z"/>
      <path d="M3.4 1 L10 6 L8.2 7.4 Z"/><path d="M20.6 15 L14 10 L15.8 8.6 Z"/>
      <path d="M20.6 1 L14 6 L15.8 7.4 Z"/><path d="M3.4 15 L10 10 L8.2 8.6 Z"/>
    </g></svg>`,
  al: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="16" fill="#e41e20"/>
    <polygon fill="#111" points="12,2.5 13.6,4.6 18,3.4 15.2,6.6 19.4,7.6 15.4,9 17.6,12.6 13.4,10.2 12,13.4 10.6,10.2 6.4,12.6 8.6,9 4.6,7.6 8.8,6.6 6,3.4 10.4,4.6"/>
  </svg>`,
  me: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="16" fill="#c40308"/>
    <rect x="1.2" y="1.2" width="21.6" height="13.6" fill="none" stroke="#d3ae3b" stroke-width="1.6"/>
    <polygon fill="#d3ae3b" points="12,4 13.2,5.4 16.4,4.6 14.4,7 17.4,7.8 14.4,8.8 15.8,11.6 12.8,9.8 12,12.2 11.2,9.8 8.2,11.6 9.6,8.8 6.6,7.8 9.6,7 7.6,4.6 10.8,5.4"/>
  </svg>`,
  ba: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="16" fill="#002395"/>
    <polygon fill="#fecb00" points="8,0 21,8 21,16 8,16"/>
    <g fill="#fff"><circle cx="9" cy="1.6" r="1"/><circle cx="11.6" cy="4.6" r="1"/><circle cx="14.2" cy="7.6" r="1"/><circle cx="16.8" cy="10.6" r="1"/><circle cx="19.4" cy="13.6" r="1"/></g>
  </svg>`,
  bg: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="5.33" fill="#fff"/><rect y="5.33" width="24" height="5.34" fill="#00966e"/><rect y="10.67" width="24" height="5.33" fill="#d62612"/>
  </svg>`,
  rs: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="5.33" fill="#c6363c"/><rect y="5.33" width="24" height="5.34" fill="#0c4076"/><rect y="10.67" width="24" height="5.33" fill="#fff"/>
    <g transform="translate(6.4,3.4)"><path d="M0 0 h4.4 v5 a2.2 2.2 0 0 1 -4.4 0 Z" fill="#c6363c" stroke="#fff" stroke-width=".5"/><rect x="1.7" y="1" width="1" height="3.4" fill="#fff"/><rect x=".5" y="2.2" width="3.4" height="1" fill="#fff"/></g>
  </svg>`,
  hr: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="5.33" fill="#f00"/><rect y="5.33" width="24" height="5.34" fill="#fff"/><rect y="10.67" width="24" height="5.33" fill="#171796"/>
    <g transform="translate(9.6,1.2)"><rect width="4.8" height="5.4" fill="#fff" stroke="#d00" stroke-width=".4"/><rect x="0" y="0" width="1.6" height="1.8" fill="#f00"/><rect x="3.2" y="0" width="1.6" height="1.8" fill="#f00"/><rect x="1.6" y="1.8" width="1.6" height="1.8" fill="#f00"/><rect x="0" y="3.6" width="1.6" height="1.8" fill="#f00"/><rect x="3.2" y="3.6" width="1.6" height="1.8" fill="#f00"/></g>
  </svg>`,
  si: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="5.33" fill="#fff"/><rect y="5.33" width="24" height="5.34" fill="#005da4"/><rect y="10.67" width="24" height="5.33" fill="#ed1c24"/>
    <g transform="translate(6.6,1.4)"><path d="M0 0 h4.6 v4 a2.3 2.3 0 0 1 -4.6 0 Z" fill="#005da4" stroke="#fff" stroke-width=".4"/><polygon points=".7,3 1.6,1.4 2.3,2.4 3,1.4 3.9,3" fill="#fff"/><g fill="#fd0"><circle cx="1" cy=".8" r=".35"/><circle cx="2.3" cy=".5" r=".35"/><circle cx="3.6" cy=".8" r=".35"/></g></g>
  </svg>`,
};

/* ---------- Economy constants (balanced, classic-derived) ---------- */

const ECONOMY = {
  startCash: 1500,
  goReward: 200,
  jailFee: 50,
  houseCostRate: 0.5, // house price = 50% of tile price
  sellRate: 0.5, // sell-back = 50% of house cost
  baseRentRate: 0.1, // base rent = 10% of tile price
  monopolyMultiplier: 2, // full group, undeveloped = 2x base rent
  houseMultipliers: [1, 5, 12, 28, 40], // level 0..4 (4 = hotel)
  airportRent: [25, 50, 100, 200], // by airports owned 1..4
  utilityMultipliers: [4, 10], // x dice total, by utilities owned
  maxHouses: 4,
};

/* ---------- Tile constructors ---------- */

const city = (id, name, country, price) => ({
  id, kind: "city", name, country, price,
  baseRent: Math.round(price * ECONOMY.baseRentRate),
  houseCost: Math.round(price * ECONOMY.houseCostRate),
});
const airport = (id, name) => ({ id, kind: "airport", name, icon: "✈", price: 200 });
const utility = (id, name, icon) => ({ id, kind: "utility", name, icon, price: 150 });
const surprise = (id) => ({ id, kind: "surprise", name: "Surprise", icon: "?" });
const eventTile = (id) => ({ id, kind: "event", name: "Balkan Event", icon: "🎡" });

/* ---------- The 40-tile ring ----------
 * Index = board position. Movement starts at 0 (Start, bottom-right) and
 * proceeds counter-clockwise: bottom → left → top → right. */

const TILES = [
  /* --- Bottom side: Start → Jail (North Macedonia + Albania) --- */
  { id: "start", kind: "corner", corner: "start", name: "START", icon: "🏁", sub: `Collect €${ECONOMY.goReward}` }, // 0
  city("bitola", "Bitola", "mk", 60), // 1
  surprise("surprise-1"), // 2
  city("ohrid", "Ohrid", "mk", 60), // 3
  city("skopje", "Skopje", "mk", 80), // 4
  airport("skopje-airport", "Skopje Airport"), // 5
  city("shkoder", "Shkodër", "al", 100), // 6
  eventTile("event-1"), // 7
  city("durres", "Durrës", "al", 100), // 8
  city("tirana", "Tirana", "al", 120), // 9

  /* --- Left side: Jail → Kafana (Montenegro + Bosnia & Herzegovina) --- */
  { id: "jail", kind: "corner", corner: "jail", name: "JAIL", icon: "⛓", sub: "Just visiting" }, // 10
  city("niksic", "Nikšić", "me", 140), // 11
  utility("balkan-electric", "Balkan Electric", "⚡"), // 12
  city("budva", "Budva", "me", 140), // 13
  city("podgorica", "Podgorica", "me", 160), // 14
  airport("sarajevo-airport", "Sarajevo Airport"), // 15
  city("mostar", "Mostar", "ba", 180), // 16
  surprise("surprise-2"), // 17
  city("banja-luka", "Banja Luka", "ba", 180), // 18
  city("sarajevo", "Sarajevo", "ba", 200), // 19

  /* --- Top side: Kafana → Go to Jail (Bulgaria + Serbia) --- */
  { id: "kafana", kind: "corner", corner: "kafana", name: "KAFANA", icon: "☕", sub: "Free parking" }, // 20
  city("varna", "Varna", "bg", 220), // 21
  eventTile("event-2"), // 22
  city("plovdiv", "Plovdiv", "bg", 220), // 23
  city("sofia", "Sofia", "bg", 240), // 24
  airport("belgrade-airport", "Belgrade Nikola Tesla Airport"), // 25
  city("nis", "Niš", "rs", 260), // 26
  city("novi-sad", "Novi Sad", "rs", 260), // 27
  utility("rakija-distillery", "Rakija Distillery", "🥃"), // 28
  city("belgrade", "Belgrade", "rs", 280), // 29

  /* --- Right side: Go to Jail → Start (Croatia + Slovenia) --- */
  { id: "go-to-jail", kind: "corner", corner: "go-to-jail", name: "GO TO JAIL", icon: "🚨", sub: "Bribe failed" }, // 30
  city("osijek", "Osijek", "hr", 300), // 31
  city("split", "Split", "hr", 300), // 32
  surprise("surprise-3"), // 33
  city("zagreb", "Zagreb", "hr", 320), // 34
  airport("zagreb-airport", "Zagreb Franjo Tuđman Airport"), // 35
  eventTile("event-3"), // 36
  city("maribor", "Maribor", "si", 350), // 37
  { id: "border-crossing", kind: "tax", name: "Border Crossing", icon: "🛃", amount: 100 }, // 38
  city("ljubljana", "Ljubljana", "si", 400), // 39
];

/* ---------- Board geometry helpers (11x11 CSS grid) ---------- */

const GRID_SIZE = 11;

/**
 * Maps a board index (0..39) to 1-based grid coordinates.
 * Start (0) sits at the bottom-right corner; movement runs
 * counter-clockwise (left along the bottom, up the left side,
 * right along the top, down the right side).
 */
function gridPos(index) {
  if (index === 0) return { row: 11, col: 11 };
  if (index >= 1 && index <= 9) return { row: 11, col: 11 - index }; // bottom, right→left
  if (index === 10) return { row: 11, col: 1 };
  if (index >= 11 && index <= 19) return { row: 21 - index, col: 1 }; // left, bottom→top
  if (index === 20) return { row: 1, col: 1 };
  if (index >= 21 && index <= 29) return { row: 1, col: index - 19 }; // top, left→right
  if (index === 30) return { row: 1, col: 11 };
  return { row: index - 29, col: 11 }; // right (31..39), top→bottom
}

/** Which edge a tile sits on (drives tile orientation styling). */
function tileSide(index) {
  if (index >= 1 && index <= 9) return "bottom";
  if (index >= 11 && index <= 19) return "left";
  if (index >= 21 && index <= 29) return "top";
  if (index >= 31 && index <= 39) return "right";
  return "corner";
}

const tileById = (id) => TILES.find((t) => t.id === id);
const tileIndex = (id) => TILES.findIndex((t) => t.id === id);

/** City ids grouped by country (for monopoly checks). */
const COUNTRY_GROUPS = Object.fromEntries(
  Object.keys(COUNTRIES).map((cid) => [
    cid,
    TILES.filter((t) => t.kind === "city" && t.country === cid).map((t) => t.id),
  ]),
);

/* Expose to the other classic scripts / console debugging. */
window.BT = Object.assign(window.BT || {}, {
  COUNTRIES, FLAGS, ECONOMY, TILES, GRID_SIZE,
  gridPos, tileSide, tileById, tileIndex, COUNTRY_GROUPS,
});
