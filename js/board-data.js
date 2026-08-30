/* ============================================================================
 * Balkan Tycoon — board-data.js
 * The complete 40-tile ring: 9 countries / 23 cities, 4 airports, 2 utilities,
 * 3 Surprise, 3 Balkan Events, 1 border tax and 4 corner tiles.
 *
 * Layout: START sits in the TOP-LEFT corner and play runs CLOCKWISE —
 * top row left to right, down the right column, bottom row right to left,
 * up the left column, back to START.
 *
 *   0  START (top-left)        10  JAIL (top-right)
 *   20 KAFANA (bottom-right)   30  GO TO JAIL (bottom-left)
 *
 * Country order = GDP per capita, poorest first, so the price ladder climbs
 * with real economic weight (see GDP_ORDER / CITY_PRICES below):
 *   top    XK 2 + BA 3
 *   right  MK 3 + AL 3
 *   bottom ME 2 + RS 2 + BG 2
 *   left   HR 4 + SI 2
 *
 * City distribution (CITY_DISTRIBUTION below is the single source of truth):
 *   Kosovo 2 · Bosnia 3 · N. Macedonia 3 · Albania 3 · Montenegro 2 ·
 *   Serbia 2 · Bulgaria 2 · Croatia 4 · Slovenia 2
 * validateBoard() enforces those counts, the GDP price ladder, one airport per
 * side, and a spacing rule so cities never clump into long unbroken runs.
 * ========================================================================== */

"use strict";

/* ---------- Countries (9 color groups, cheapest tier first) ----------
 * gdpPerCapita: nominal USD, 2025 estimates. Seven come from the IMF World
 * Economic Outlook as tabulated by Worldometer; Kosovo (not in that table)
 * comes from Trading Economics. Figures are for ordering flavour, not
 * accounting — refresh them whenever, the tier order is what matters.
 *   https://www.worldometers.info/gdp/gdp-per-capita/?metric=nominal&region=europe&source=imf&year=2025
 *   https://tradingeconomics.com/kosovo/gdp-per-capita
 */

const COUNTRIES = {
  xk: {
    id: "xk",
    name: "Kosovo",
    short: "XK",
    color: "#955436", // brown / tier 1
    textOn: "#ffffff",
    gdpPerCapita: 5899,
    flavor: "Youngest market on the board, oldest tricks in the book.",
  },
  ba: {
    id: "ba",
    name: "Bosnia & Herzegovina",
    short: "BA",
    color: "#6ec3ea", // light blue / tier 2
    textOn: "#0b2a3a",
    gdpPerCapita: 9568,
    flavor: "Great coffee. Even better rent prices.",
  },
  mk: {
    id: "mk",
    name: "North Macedonia",
    short: "MK",
    color: "#e0449b", // pink / tier 3
    textOn: "#ffffff",
    gdpPerCapita: 10546,
    flavor: "Two cities. One questionable business plan.",
  },
  al: {
    id: "al",
    name: "Albania",
    short: "AL",
    color: "#f7941d", // orange / tier 4
    textOn: "#3a1d00",
    gdpPerCapita: 11235,
    flavor: "The riviera is open for business.",
  },
  me: {
    id: "me",
    name: "Montenegro",
    short: "ME",
    color: "#ed1b24", // red / tier 5
    textOn: "#ffffff",
    gdpPerCapita: 14784,
    flavor: "Mountains, coast, and creative accounting.",
  },
  rs: {
    id: "rs",
    name: "Serbia",
    short: "RS",
    color: "#ffd500", // yellow / tier 6
    textOn: "#3a2f00",
    gdpPerCapita: 15284,
    flavor: "Where every deal comes with rakija.",
  },
  bg: {
    id: "bg",
    name: "Bulgaria",
    short: "BG",
    color: "#17a398", // teal / tier 7
    textOn: "#03231f",
    gdpPerCapita: 17435,
    flavor: "Rose oil, Black Sea sun, and paperwork in triplicate.",
  },
  hr: {
    id: "hr",
    name: "Croatia",
    short: "HR",
    color: "#1fb25a", // green / tier 8
    textOn: "#ffffff",
    gdpPerCapita: 27376,
    flavor: "Tourist season pays for everything.",
  },
  si: {
    id: "si",
    name: "Slovenia",
    short: "SI",
    color: "#2b4bd8", // dark blue / tier 9
    textOn: "#ffffff",
    gdpPerCapita: 37357,
    flavor: "Small country. Premium vibes. Premium invoices.",
  },
};

/* ---------- GDP price ladder ----------
 * GDP_ORDER is just the COUNTRIES keys, which are declared poorest-first, so a
 * country's tier is its index here.
 *
 * CITY_PRICES lists every city price explicitly, cheapest first, one row per
 * country. It used to be a fixed 3-wide matrix with a special case that let a
 * 2-city country borrow the cheapest and dearest slot of its tier — which
 * could not express Croatia's four cities at all. Spelling the rows out is
 * both shorter and lets each group be any size.
 *
 * The ladder must rise monotonically across the whole ring: the last city of
 * every tier is cheaper than the first city of the next. validateBoard()
 * enforces that, plus row lengths against CITY_DISTRIBUTION, so a price can
 * never silently drift out of order. */

const GDP_ORDER = Object.keys(COUNTRIES);

const CITY_PRICES = {
  xk: [60, 80],                //  1 Kosovo
  ba: [100, 100, 120],         //  2 Bosnia & Herzegovina
  mk: [140, 140, 160],         //  3 North Macedonia
  al: [180, 180, 200],         //  4 Albania
  me: [220, 240],              //  5 Montenegro
  rs: [260, 280],              //  6 Serbia
  bg: [300, 320],              //  7 Bulgaria
  hr: [340, 340, 360, 380],    //  8 Croatia — the long set
  si: [420, 460],              //  9 Slovenia — the premium pair
};

/** The price the ladder expects for city #n (0-based) of a country. */
function tierPrice(countryId, n) {
  const row = CITY_PRICES[countryId];
  return row && n < row.length ? row[n] : null;
}

/* ---------- Flags ----------
 * Every country has a hand-drawn inline SVG fallback below (see FLAGS), and
 * most also have a proper flag file in public/flags/{id}.svg which is layered
 * on top of it. FLAG_FILES lists which files actually exist so flagBg() can
 * skip the image layer for the rest — otherwise the browser requests a file
 * that is not there and every one of that country's tiles logs a failed
 * request. Add an id here when you drop a new flag in.
 *
 * Kosovo is deliberately absent: it has no file, so it renders from the inline
 * SVG alone (six stars in an arc over the gold map). */

const FLAG_EXT = "svg";
const FLAG_FILES = new Set(["al", "ba", "bg", "hr", "me", "mk", "rs", "si"]);

/* ---------- Compact inline SVG flags (viewBox 0 0 24 16) ---------- */

const FLAGS = {
  bg: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="16" fill="#ffffff"/>
    <rect y="5.33" width="24" height="5.34" fill="#00966e"/>
    <rect y="10.67" width="24" height="5.33" fill="#d62612"/>
  </svg>`,
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
  xk: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="16" fill="#244aa5"/>
    <path fill="#d0a650" d="M8.35 7.2q1.15-1.5 2.6-1.35 1.2.12 2.05-.35.95-.5 1.85.1.85.55 1.05 1.6.25 1.25-.5 2.2-.6.8-.55 1.55.05.9-.85 1.15-1.1.3-2.1-.35-.75-.5-1.65-.6-1.2-.15-1.75-1.15-.6-1.1-.2-2.8z"/>
    <g fill="#fff" stroke="none">
      <path transform="translate(5.5 4.15)" d="M0-1.25 .294-.405 1.189-.386 .476 .155 .735 1.011 0 .5 -.735 1.011 -.476 .155 -1.189-.386 -.294-.405Z"/>
      <path transform="translate(8.1 3.1)" d="M0-1.25 .294-.405 1.189-.386 .476 .155 .735 1.011 0 .5 -.735 1.011 -.476 .155 -1.189-.386 -.294-.405Z"/>
      <path transform="translate(10.7 2.6)" d="M0-1.25 .294-.405 1.189-.386 .476 .155 .735 1.011 0 .5 -.735 1.011 -.476 .155 -1.189-.386 -.294-.405Z"/>
      <path transform="translate(13.3 2.6)" d="M0-1.25 .294-.405 1.189-.386 .476 .155 .735 1.011 0 .5 -.735 1.011 -.476 .155 -1.189-.386 -.294-.405Z"/>
      <path transform="translate(15.9 3.1)" d="M0-1.25 .294-.405 1.189-.386 .476 .155 .735 1.011 0 .5 -.735 1.011 -.476 .155 -1.189-.386 -.294-.405Z"/>
      <path transform="translate(18.5 4.15)" d="M0-1.25 .294-.405 1.189-.386 .476 .155 .735 1.011 0 .5 -.735 1.011 -.476 .155 -1.189-.386 -.294-.405Z"/>
    </g></svg>`,
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
  mortgageRate: 0.5, // raise 50% of the tile price against the deed
  unmortgageInterest: 0.1, // buying it back costs the loan plus 10%
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
/* `label` is the short form painted on the board tile; `name` stays the full
 * official title for the deed card, the action log and trades. Only needed
 * where the real name is too long to sit on a tile without wrapping to three
 * or four lines. */
const airport = (id, name, label) => ({
  id, kind: "airport", name, label: label || name, icon: "✈", price: 200,
});
const utility = (id, name, icon) => ({ id, kind: "utility", name, icon, price: 150 });
const surprise = (id) => ({ id, kind: "surprise", name: "Surprise", icon: "?" });
const eventTile = (id) => ({ id, kind: "event", name: "Balkan Event", icon: "🎡" });

/* ---------- The 40-tile ring ----------
 * Index = board position. START is 0 (top-left corner) and play runs
 * clockwise: top row → right column → bottom row → left column.
 *
 * Countries appear in GDP order, so the ring gets steadily more expensive the
 * further you travel from START. Group sizes are deliberately uneven — the
 * board opens with a cheap pair you can complete early, and the run-up to the
 * priciest corner is Croatia's four-city set, which is the hardest thing on the
 * board to finish and the most punishing once it is:
 *
 *   top     Kosovo 2      + Bosnia 3                (5 cities)
 *   right   N. Macedonia 3 + Albania 3              (6)
 *   bottom  Montenegro 2  + Serbia 2 + Bulgaria 2   (6)
 *   left    Croatia 4     + Slovenia 2              (6)
 *
 * Each side carries exactly one airport, and no more than two cities ever sit
 * side by side — validateBoard() enforces both, along with the price ladder. */

const TILES = [
  /* --- Top row, left to right: Start → Jail (Kosovo 2 + Bosnia 3) --- */
  { id: "start", kind: "corner", corner: "start", name: "START", icon: "🏁", sub: `Collect €${ECONOMY.goReward}` }, // 0
  city("prizren", "Prizren", "xk", 60), // 1
  city("prishtina", "Prishtina", "xk", 80), // 2
  surprise("surprise-1"), // 3
  eventTile("event-1"), // 4
  city("mostar", "Mostar", "ba", 100), // 5
  city("banja-luka", "Banja Luka", "ba", 100), // 6
  airport("sarajevo-airport", "Sarajevo Airport"), // 7
  city("sarajevo", "Sarajevo", "ba", 120), // 8
  surprise("surprise-2"), // 9

  /* --- Right column, top to bottom: Jail → Kafana (N. Macedonia 3 + Albania 3) --- */
  { id: "jail", kind: "corner", corner: "jail", name: "JAIL", icon: "⛓", sub: "Just visiting" }, // 10
  city("bitola", "Bitola", "mk", 140), // 11
  city("ohrid", "Ohrid", "mk", 140), // 12
  utility("balkan-electric", "Balkan Electric", "⚡"), // 13
  city("skopje", "Skopje", "mk", 160), // 14
  city("shkoder", "Shkodër", "al", 180), // 15
  airport("skopje-airport", "Skopje Airport"), // 16
  city("durres", "Durrës", "al", 180), // 17
  city("tirana", "Tirana", "al", 200), // 18
  eventTile("event-2"), // 19

  /* --- Bottom row, right to left: Kafana → Go to Jail (Montenegro 2 + Serbia 2 + Bulgaria 2) --- */
  { id: "kafana", kind: "corner", corner: "kafana", name: "KAFANA", icon: "☕", sub: "Free parking" }, // 20
  city("budva", "Budva", "me", 220), // 21
  city("podgorica", "Podgorica", "me", 240), // 22
  airport("belgrade-airport", "Belgrade Nikola Tesla Airport", "Belgrade Airport"), // 23
  city("novi-sad", "Novi Sad", "rs", 260), // 24
  city("belgrade", "Belgrade", "rs", 280), // 25
  utility("rakija-distillery", "Rakija Distillery", "🥃"), // 26
  city("plovdiv", "Plovdiv", "bg", 300), // 27
  city("sofia", "Sofia", "bg", 320), // 28
  surprise("surprise-3"), // 29

  /* --- Left column, bottom to top: Go to Jail → Start (Croatia 4 + Slovenia 2) --- */
  { id: "go-to-jail", kind: "corner", corner: "go-to-jail", name: "GO TO JAIL", icon: "🚨", sub: "Bribe failed" }, // 30
  city("osijek", "Osijek", "hr", 340), // 31
  city("rijeka", "Rijeka", "hr", 340), // 32
  eventTile("event-3"), // 33
  city("split", "Split", "hr", 360), // 34
  city("zagreb", "Zagreb", "hr", 380), // 35
  airport("zagreb-airport", "Zagreb Franjo Tuđman Airport", "Zagreb Airport"), // 36
  city("maribor", "Maribor", "si", 420), // 37
  { id: "border-crossing", kind: "tax", name: "Border Crossing", icon: "🛃", amount: 100 }, // 38
  city("ljubljana", "Ljubljana", "si", 460), // 39
];

/* ---------- Board geometry helpers (11x11 CSS grid) ---------- */

const GRID_SIZE = 11;

/**
 * Maps a board index (0..39) to 1-based grid coordinates.
 * START (0) sits at the top-left corner and movement runs clockwise:
 * right along the top, down the right side, left along the bottom,
 * up the left side.
 */
function gridPos(index) {
  if (index === 0) return { row: 1, col: 1 };
  if (index >= 1 && index <= 9) return { row: 1, col: index + 1 };   // top, left→right
  if (index === 10) return { row: 1, col: 11 };
  if (index >= 11 && index <= 19) return { row: index - 9, col: 11 }; // right, top→bottom
  if (index === 20) return { row: 11, col: 11 };
  if (index >= 21 && index <= 29) return { row: 11, col: 31 - index }; // bottom, right→left
  if (index === 30) return { row: 11, col: 1 };
  return { row: 41 - index, col: 1 }; // left (31..39), bottom→top
}

/** Which edge a tile sits on (drives tile orientation styling). */
function tileSide(index) {
  if (index >= 1 && index <= 9) return "top";
  if (index >= 11 && index <= 19) return "right";
  if (index >= 21 && index <= 29) return "bottom";
  if (index >= 31 && index <= 39) return "left";
  return "corner";
}

/**
 * Which corner of the board a corner tile occupies: "tl" | "tr" | "br" | "bl".
 * Corner content (the jail cell, for one) has to lean toward the board centre,
 * so it needs to know which way "inward" is.
 */
function cornerAnchor(index) {
  const { row, col } = gridPos(index);
  return (row === 1 ? "t" : "b") + (col === 1 ? "l" : "r");
}

/** Unit-ish vector pointing from a corner tile toward the board centre. */
function inwardVec(anchor) {
  return {
    x: String(anchor).includes("l") ? 1 : -1,
    y: String(anchor).includes("t") ? 1 : -1,
  };
}

/* ---------- Jail geometry ----------
 * Shared by the CSS cell (css/styles.css) and the pawn placement in
 * movement.js so the bars and the prisoners can never disagree.
 *   CELL_INSET  gap between the cell and the two inner tile edges
 *   CELL_SIZE   cell width/height, both as a fraction of the tile
 * The derived cell centre offset from the tile centre is
 *   CELL_INSET + CELL_SIZE / 2 - 0.5  along each inward axis. */

const JAIL_GEO = {
  CELL_INSET: 0.05,
  CELL_SIZE: 0.58,
  /** Distance of the cell centre from the tile centre, along the inward axes. */
  get CELL_OFFSET() { return 0.5 - this.CELL_INSET - this.CELL_SIZE / 2; },
  /** Cluster shrink factor so a group of prisoners fits inside the cell. */
  CELL_SPREAD: 0.5,
  /**
   * Visiting slots as [outwardX, outwardY] multipliers of the tile size,
   * queued along the L-shaped band between the cell and the two outer edges.
   * None of them overlap the cell, and the outermost corner is used last so
   * the "just visiting" label stays legible until the board is packed.
   */
  YARD_SLOTS: [
    [0.10, 0.29],
    [0.29, 0.10],
    [-0.14, 0.29],
    [0.29, -0.14],
    [-0.38, 0.29],
    [0.29, 0.29],
  ],
};

const tileById = (id) => TILES.find((t) => t.id === id);
const tileIndex = (id) => TILES.findIndex((t) => t.id === id);

/** City ids grouped by country (for monopoly checks). */
const COUNTRY_GROUPS = Object.fromEntries(
  Object.keys(COUNTRIES).map((cid) => [
    cid,
    TILES.filter((t) => t.kind === "city" && t.country === cid).map((t) => t.id),
  ]),
);

/* ---------- Board balance spec + self-check ----------
 * CITY_DISTRIBUTION is the contract the ring above must satisfy: 23 cities
 * across 9 countries, sized so the board has a shape rather than a uniform
 * grind. Kosovo opens with a cheap pair that can be completed on the first
 * lap, the mid-board runs full three-city sets, the bottom row is three quick
 * pairs, and Croatia's four-city set guards the approach to Slovenia's
 * premium pair.
 *
 * The spacing rule: with 23 cities on a 40-tile ring you can never separate
 * every city (that would need 23 gaps and only 17 non-city tiles exist), so
 * "not too close" is enforced as a maximum unbroken run — no more than
 * MAX_CITY_RUN cities in a row, i.e. an airport / utility / card / corner
 * always breaks the chain within two tiles. */

const CITY_DISTRIBUTION = { xk: 2, ba: 3, mk: 3, al: 3, me: 2, rs: 2, bg: 2, hr: 4, si: 2 };
const MAX_CITY_RUN = 2;

/**
 * Verify the ring against CITY_DISTRIBUTION. Returns a report instead of
 * throwing so a mismatch degrades to a console warning rather than a black
 * screen. Runs once at load in dev; also handy from the console.
 * @returns {{ok:boolean, errors:string[], counts:Record<string,number>}}
 */
function validateBoard() {
  const errors = [];
  const counts = {};
  for (const t of TILES) {
    if (t.kind === "city") counts[t.country] = (counts[t.country] || 0) + 1;
  }

  if (TILES.length !== 40) errors.push(`ring has ${TILES.length} tiles, expected 40`);

  // START must own the top-left corner, with play running clockwise
  const startAt = gridPos(0);
  if (startAt.row !== 1 || startAt.col !== 1) {
    errors.push(`START is at row ${startAt.row}/col ${startAt.col}, expected top-left (1/1)`);
  }
  if (gridPos(1).col !== 2) errors.push("play does not run clockwise from START");

  // GDP ladder: tiers must be declared poorest-first and prices must match
  let prevGdp = -Infinity;
  let prevTierTop = null;
  for (const cid of GDP_ORDER) {
    const gdp = COUNTRIES[cid].gdpPerCapita;
    if (!(gdp > prevGdp)) {
      errors.push(`${cid}: GDP per capita ${gdp} breaks the poorest-first order`);
    }
    prevGdp = gdp;

    const cities = TILES.filter((t) => t.kind === "city" && t.country === cid);
    cities.forEach((t, n) => {
      const want = tierPrice(cid, n);
      if (t.price !== want) {
        errors.push(`${t.id}: price ${t.price}, tier ${GDP_ORDER.indexOf(cid) + 1} expects ${want}`);
      }
    });

    // every price row must be as long as the group it prices, and the ladder
    // must keep climbing across the tier boundary
    const row = CITY_PRICES[cid];
    if (!row) {
      errors.push(`${cid}: no CITY_PRICES row`);
    } else {
      if (row.length !== CITY_DISTRIBUTION[cid]) {
        errors.push(`${cid}: ${row.length} prices for ${CITY_DISTRIBUTION[cid]} cities`);
      }
      for (let i = 1; i < row.length; i++) {
        if (row[i] < row[i - 1]) errors.push(`${cid}: prices fall at index ${i} (${row[i - 1]} -> ${row[i]})`);
      }
      if (prevTierTop !== null && row[0] <= prevTierTop) {
        errors.push(`${cid}: opens at ${row[0]}, not above the previous tier's ${prevTierTop}`);
      }
      prevTierTop = row[row.length - 1];
    }
  }

  for (const [cid, want] of Object.entries(CITY_DISTRIBUTION)) {
    const got = counts[cid] || 0;
    if (!COUNTRIES[cid]) errors.push(`spec country "${cid}" has no COUNTRIES entry`);
    if (got !== want) errors.push(`${cid}: ${got} cities, expected ${want}`);
  }
  for (const cid of Object.keys(counts)) {
    if (!(cid in CITY_DISTRIBUTION)) errors.push(`${cid}: not in CITY_DISTRIBUTION but has cities`);
  }

  // duplicate ids would silently break props/trades
  const seen = new Set();
  for (const t of TILES) {
    if (seen.has(t.id)) errors.push(`duplicate tile id "${t.id}"`);
    seen.add(t.id);
  }

  // minimum spacing: walk the ring (wrapping) and measure city runs
  let run = 0, worst = 0, worstAt = -1;
  for (let i = 0; i < TILES.length * 2; i++) {
    const tile = TILES[i % TILES.length];
    if (tile.kind === "city") {
      run += 1;
      if (run > worst) { worst = run; worstAt = i % TILES.length; }
    } else {
      run = 0;
    }
  }
  if (worst > MAX_CITY_RUN) {
    errors.push(`${worst} cities in a row (ending at tile ${worstAt}) — max ${MAX_CITY_RUN}`);
  }

  // one airport per side, so no edge of the board is a transport dead zone
  const airportsBySide = {};
  TILES.forEach((t, i) => {
    if (t.kind !== "airport") return;
    const side = tileSide(i);
    airportsBySide[side] = (airportsBySide[side] || 0) + 1;
  });
  for (const side of ["top", "right", "bottom", "left"]) {
    const n = airportsBySide[side] || 0;
    if (n !== 1) errors.push(`${side} side has ${n} airports, expected 1`);
  }

  return { ok: errors.length === 0, errors, counts };
}

/* Expose to the other classic scripts / console debugging. */
window.BT = Object.assign(window.BT || {}, {
  COUNTRIES, FLAGS, FLAG_FILES, FLAG_EXT, ECONOMY, TILES, GRID_SIZE,
  gridPos, tileSide, tileById, tileIndex, COUNTRY_GROUPS,
  cornerAnchor, inwardVec, JAIL_GEO,
  CITY_DISTRIBUTION, GDP_ORDER, CITY_PRICES, tierPrice, validateBoard,
});

/* Fail loud in the console (never fatal) if the ring drifts from the spec. */
(() => {
  const report = validateBoard();
  if (!report.ok) console.warn("[board] distribution check failed:", report.errors);
})();
