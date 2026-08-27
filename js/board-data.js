/* ============================================================================
 * Balkan Tycoon — board-data.js
 * The complete 40-tile ring: 8 countries, 4 airports, 2 utilities,
 * 4 Surprise, 3 Balkan Events, 1 border tax and 4 corner tiles.
 *
 * Layout: START sits in the TOP-LEFT corner and play runs CLOCKWISE —
 * top row left to right, down the right column, bottom row right to left,
 * up the left column, back to START.
 *
 *   0  START (top-left)        10  JAIL (top-right)
 *   20 KAFANA (bottom-right)   30  GO TO JAIL (bottom-left)
 *
 * Country order = GDP per capita, poorest first, so the price ladder climbs
 * with real economic weight (see GDP_ORDER / TIER_PRICES below):
 *   top    XK + BA
 *   right  MK + AL
 *   bottom ME + RS
 *   left   HR + SI
 *
 * City distribution (CITY_DISTRIBUTION below is the single source of truth):
 *   North Macedonia 2 · Albania 3 · Slovenia 2 · everyone else 3
 * validateBoard() enforces those counts, the GDP price ladder, and a
 * minimum-spacing rule so cities never clump into long unbroken runs.
 * ========================================================================== */

"use strict";

/* ---------- Countries (8 color groups, cheapest tier first) ----------
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
  hr: {
    id: "hr",
    name: "Croatia",
    short: "HR",
    color: "#1fb25a", // green / tier 7
    textOn: "#ffffff",
    gdpPerCapita: 27376,
    flavor: "Tourist season pays for everything.",
  },
  si: {
    id: "si",
    name: "Slovenia",
    short: "SI",
    color: "#2b4bd8", // dark blue / tier 8
    textOn: "#ffffff",
    gdpPerCapita: 37357,
    flavor: "Small country. Premium vibes. Premium invoices.",
  },
};

/* ---------- GDP price ladder ----------
 * GDP_ORDER is just the COUNTRIES keys, which are declared poorest-first, so
 * a country's tier is its index here. TIER_PRICES holds the three city prices
 * for each tier; a two-city country (MK, SI) takes the cheapest and dearest
 * slot of its tier and skips the middle one. validateBoard() checks the ring
 * against this table, so prices can never silently drift out of order. */

const GDP_ORDER = Object.keys(COUNTRIES);

const TIER_PRICES = [
  [60, 60, 80],     // 1 Kosovo
  [100, 100, 120],  // 2 Bosnia & Herzegovina
  [140, 140, 160],  // 3 North Macedonia   (2 cities -> 140 / 160)
  [180, 180, 200],  // 4 Albania
  [220, 220, 240],  // 5 Montenegro
  [260, 260, 280],  // 6 Serbia
  [300, 300, 320],  // 7 Croatia
  [350, 350, 400],  // 8 Slovenia          (2 cities -> 350 / 400)
];

/** The price the ladder expects for city #n (0-based) of a country. */
function tierPrice(countryId, n, cityCount) {
  const row = TIER_PRICES[GDP_ORDER.indexOf(countryId)];
  if (!row) return null;
  return cityCount === 2 ? (n === 0 ? row[0] : row[2]) : row[n];
}

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
  xk: `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="16" fill="#244aa5"/>
    <path fill="#d0a650" d="M9 6.4l1.9-1.1 2.2.5 1.7 1.3.9 1.9-.7 1.6-1.6 1.5-2.3.5-1.9-.9-1.1-1.7.2-2z"/>
    <g fill="#fff">
      <path d="M7.1 3.2l.35.75.8.1-.6.55.15.8-.7-.4-.7.4.15-.8-.6-.55.8-.1z"/>
      <path d="M9.6 2.2l.35.75.8.1-.6.55.15.8-.7-.4-.7.4.15-.8-.6-.55.8-.1z"/>
      <path d="M12 1.9l.35.75.8.1-.6.55.15.8-.7-.4-.7.4.15-.8-.6-.55.8-.1z"/>
      <path d="M14.4 2.2l.35.75.8.1-.6.55.15.8-.7-.4-.7.4.15-.8-.6-.55.8-.1z"/>
      <path d="M16.9 3.2l.35.75.8.1-.6.55.15.8-.7-.4-.7.4.15-.8-.6-.55.8-.1z"/>
      <path d="M12 13.1l.35.75.8.1-.6.55.15.8-.7-.4-.7.4.15-.8-.6-.55.8-.1z"/>
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
 * Index = board position. START is 0 (top-left corner) and play runs
 * clockwise: top row → right column → bottom row → left column.
 * Each side carries one airport, and prices climb with the GDP tiers. */

const TILES = [
  /* --- Top row, left to right: Start → Jail (Kosovo 3 + Bosnia 3) --- */
  { id: "start", kind: "corner", corner: "start", name: "START", icon: "🏁", sub: `Collect €${ECONOMY.goReward}` }, // 0
  city("prizren", "Prizren", "xk", 60), // 1
  city("peja", "Peja", "xk", 60), // 2
  surprise("surprise-1"), // 3
  city("prishtina", "Prishtina", "xk", 80), // 4
  eventTile("event-1"), // 5
  city("mostar", "Mostar", "ba", 100), // 6
  city("banja-luka", "Banja Luka", "ba", 100), // 7
  airport("sarajevo-airport", "Sarajevo Airport"), // 8
  city("sarajevo", "Sarajevo", "ba", 120), // 9

  /* --- Right column, top to bottom: Jail → Kafana (N. Macedonia 2 + Albania 3) --- */
  { id: "jail", kind: "corner", corner: "jail", name: "JAIL", icon: "⛓", sub: "Just visiting" }, // 10
  city("ohrid", "Ohrid", "mk", 140), // 11
  utility("balkan-electric", "Balkan Electric", "⚡"), // 12
  city("skopje", "Skopje", "mk", 160), // 13
  airport("skopje-airport", "Skopje Airport"), // 14
  city("shkoder", "Shkodër", "al", 180), // 15
  surprise("surprise-2"), // 16
  city("durres", "Durrës", "al", 180), // 17
  eventTile("event-2"), // 18
  city("tirana", "Tirana", "al", 200), // 19

  /* --- Bottom row, right to left: Kafana → Go to Jail (Montenegro 3 + Serbia 3) --- */
  { id: "kafana", kind: "corner", corner: "kafana", name: "KAFANA", icon: "☕", sub: "Free parking" }, // 20
  city("niksic", "Nikšić", "me", 220), // 21
  city("budva", "Budva", "me", 220), // 22
  surprise("surprise-3"), // 23
  city("podgorica", "Podgorica", "me", 240), // 24
  airport("belgrade-airport", "Belgrade Nikola Tesla Airport"), // 25
  city("nis", "Niš", "rs", 260), // 26
  city("novi-sad", "Novi Sad", "rs", 260), // 27
  utility("rakija-distillery", "Rakija Distillery", "🥃"), // 28
  city("belgrade", "Belgrade", "rs", 280), // 29

  /* --- Left column, bottom to top: Go to Jail → Start (Croatia 3 + Slovenia 2) --- */
  { id: "go-to-jail", kind: "corner", corner: "go-to-jail", name: "GO TO JAIL", icon: "🚨", sub: "Bribe failed" }, // 30
  city("osijek", "Osijek", "hr", 300), // 31
  eventTile("event-3"), // 32
  city("split", "Split", "hr", 300), // 33
  surprise("surprise-4"), // 34
  city("zagreb", "Zagreb", "hr", 320), // 35
  airport("zagreb-airport", "Zagreb Franjo Tuđman Airport"), // 36
  city("maribor", "Maribor", "si", 350), // 37
  { id: "border-crossing", kind: "tax", name: "Border Crossing", icon: "🛃", amount: 100 }, // 38
  city("ljubljana", "Ljubljana", "si", 400), // 39
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
 * CITY_DISTRIBUTION is the contract the ring above must satisfy. Two cheap
 * cities keep North Macedonia and Slovenia as short (and therefore cheaper
 * to complete) sets at the two ends of the price curve; everyone else runs
 * the standard three.
 *
 * MIN_CITY_GAP is the spacing rule: with 22 cities on a 40-tile ring you can
 * never separate every city (that would need 22 gaps and only 18 non-city
 * tiles exist), so "not too close" is enforced as a maximum unbroken run —
 * no more than MAX_CITY_RUN cities in a row, i.e. every pair of cities is at
 * most MAX_CITY_RUN deep before an airport / utility / card / corner breaks
 * the chain. */

const CITY_DISTRIBUTION = { mk: 2, al: 3, si: 2, hr: 3, ba: 3, rs: 3, me: 3, xk: 3 };
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
  for (const cid of GDP_ORDER) {
    const gdp = COUNTRIES[cid].gdpPerCapita;
    if (!(gdp > prevGdp)) {
      errors.push(`${cid}: GDP per capita ${gdp} breaks the poorest-first order`);
    }
    prevGdp = gdp;

    const cities = TILES.filter((t) => t.kind === "city" && t.country === cid);
    cities.forEach((t, n) => {
      const want = tierPrice(cid, n, cities.length);
      if (t.price !== want) {
        errors.push(`${t.id}: price ${t.price}, tier ${GDP_ORDER.indexOf(cid) + 1} expects ${want}`);
      }
    });
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

  return { ok: errors.length === 0, errors, counts };
}

/* Expose to the other classic scripts / console debugging. */
window.BT = Object.assign(window.BT || {}, {
  COUNTRIES, FLAGS, ECONOMY, TILES, GRID_SIZE,
  gridPos, tileSide, tileById, tileIndex, COUNTRY_GROUPS,
  cornerAnchor, inwardVec, JAIL_GEO,
  CITY_DISTRIBUTION, GDP_ORDER, TIER_PRICES, tierPrice, validateBoard,
});

/* Fail loud in the console (never fatal) if the ring drifts from the spec. */
(() => {
  const report = validateBoard();
  if (!report.ok) console.warn("[board] distribution check failed:", report.errors);
})();
