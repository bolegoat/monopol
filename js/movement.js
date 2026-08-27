/* ============================================================================
 * Balkan Tycoon — movement.js
 * Pawn layer + step-by-step "hop" animation.
 * Pawns never jump straight to the target tile: they advance one tile at a
 * time, playing a 200ms parabolic bounce on every intermediate tile, then
 * pause 400ms on the destination before the game opens any modal.
 * Multiple pawns on one tile are auto-arranged in a 2x2 mini-grid cluster.
 * ========================================================================== */

"use strict";

(function () {
  const STEP_MS = 240;          // per-tile cadence for an ordinary dice move
  const ARRIVAL_PAUSE_MS = 400; // pause on destination before modals
  const HOP_CLASS = "hop";

  /* Long moves get a faster cadence instead of a longer wait.
   * A dice roll is 2-12 tiles, but a card can send a pawn most of the way
   * around the ring: "advance to Ljubljana" from tile 3 is 36 hops, which at
   * the full cadence is a nine-second crawl with the whole game frozen behind
   * it. So the trip is budgeted rather than priced per tile — anything up to
   * seven hops keeps the original feel, and longer journeys speed up to land
   * inside the budget, down to a floor that keeps each hop visible. */
  const TRAVEL_BUDGET_MS = 1800;
  const MIN_STEP_MS = 46;

  const stepCadence = (steps) => {
    const n = Math.abs(steps) || 1;
    return Math.max(MIN_STEP_MS, Math.min(STEP_MS, Math.round(TRAVEL_BUDGET_MS / n)));
  };

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  /* Cluster layouts (fraction of tile size, relative to tile centre).
   * Chosen per number of pawns currently occupying the tile. */
  /* Prison zones, keyed by board index: where a locked-up pawn stands (inside
   * the cell) versus a pawn that is only visiting (out in the yard). Derived
   * from BT.JAIL_GEO so the pawns land exactly inside the CSS cell. */
  const JAIL_ZONES = (() => {
    const { TILES, cornerAnchor, inwardVec, JAIL_GEO } = window.BT;
    const out = {};
    TILES.forEach((tile, index) => {
      if (tile.kind !== "corner" || tile.corner !== "jail") return;
      const v = inwardVec(cornerAnchor(index));
      out[index] = {
        cell: { x: v.x * JAIL_GEO.CELL_OFFSET, y: v.y * JAIL_GEO.CELL_OFFSET },
        cellSpread: JAIL_GEO.CELL_SPREAD,
        // slots are authored in "outward" space, so flip them per corner
        yardSlots: JAIL_GEO.YARD_SLOTS.map(([ox, oy]) => [-v.x * ox, -v.y * oy]),
      };
    });
    return out;
  })();

  const CLUSTER_LAYOUTS = {
    1: [[0, 0]],
    2: [[-0.21, 0], [0.21, 0]],
    3: [[-0.21, -0.21], [0.21, -0.21], [0, 0.23]],
    4: [[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.23], [0.21, 0.23]],
    5: [[0, 0], [-0.26, -0.24], [0.26, -0.24], [-0.26, 0.26], [0.26, 0.26]],
    6: [[-0.27, -0.25], [0, -0.28], [0.27, -0.25], [-0.27, 0.27], [0, 0.3], [0.27, 0.27]],
  };

  class PawnLayer {
    /**
     * @param {HTMLElement} boardEl the .board grid element
     * @param {HTMLElement[]} tileEls tile elements indexed by board position 0..39
     */
    constructor(boardEl, tileEls) {
      this.board = boardEl;
      this.tiles = tileEls;
      this.layer = document.createElement("div");
      this.layer.className = "pawn-layer";
      boardEl.appendChild(this.layer);
      this.pawns = new Map(); // playerId -> { el, seat, pos }
    }

    addPlayer(player, seat) {
      const el = document.createElement("div");
      el.className = "pawn";
      el.style.background = player.color;
      const style = Number.isFinite(player.tokenStyle)
        ? player.tokenStyle
        : window.BT.Tokens.hashStyle(player.name);
      el.innerHTML = window.BT.Tokens.face(style); // procedural SVG token face
      el.title = player.name;
      el.classList.toggle("is-jailed", Boolean(player.inJail));
      this.layer.appendChild(el);
      this.pawns.set(player.id, {
        el, seat, pos: player.position, jailed: Boolean(player.inJail),
      });
      this._relayout();
    }

    removePlayer(playerId) {
      const p = this.pawns.get(playerId);
      if (p) p.el.remove();
      this.pawns.delete(playerId);
      this._relayout();
    }

    /**
     * Lock a pawn up or let it out. Jailed pawns move inside the cell (behind
     * the bars); everyone else standing on the tile waits in the yard, so
     * "doing time" and "just passing through" never look the same.
     */
    setJailed(playerId, jailed) {
      const p = this.pawns.get(playerId);
      if (!p) return;
      p.jailed = Boolean(jailed);
      p.el.classList.toggle("is-jailed", p.jailed);
      this._relayout();
    }

    /**
     * Online presence on the board: a dropped player greys out and gets a
     * warning pip; coming back brightens the pawn with a short pulse.
     * @param {string} playerId
     * @param {boolean} connected
     */
    setPresence(playerId, connected) {
      const p = this.pawns.get(playerId);
      if (!p) return;
      const wasOffline = p.el.classList.contains("is-offline");
      if (wasOffline === !connected) return; // nothing changed
      p.el.classList.toggle("is-offline", !connected);

      const existing = p.el.querySelector(".pawn__warn");
      if (!connected) {
        if (!existing) {
          const warn = document.createElement("span");
          warn.className = "pawn__warn";
          warn.title = "Disconnected";
          warn.innerHTML = window.BT.icon("alert");
          p.el.appendChild(warn);
        }
      } else {
        if (existing) existing.remove();
        p.el.classList.remove("just-online");
        void p.el.offsetWidth; // restart the reconnect pulse
        p.el.classList.add("just-online");
        setTimeout(() => p.el.classList.remove("just-online"), 950);
      }
    }

    /* ---------- dynamic 2x2 cluster stacking ---------- */

    /** Occupants of a tile ordered by seat for stable slot assignment. */
    _occupants(pos) {
      return [...this.pawns.entries()]
        .filter(([, p]) => p.pos === pos)
        .sort((a, b) => a[1].seat - b[1].seat);
    }

    /** Lay a group of pawns out around a point, shrunk to fit its zone. */
    _placeGroup(entries, pos, center, spread) {
      if (!entries.length) return;
      const layout = CLUSTER_LAYOUTS[Math.min(entries.length, 6)];
      entries.forEach(([id], i) => {
        const [ox, oy] = layout[Math.min(i, layout.length - 1)];
        this._apply(this.pawns.get(id), pos, center.x + ox * spread, center.y + oy * spread);
      });
    }

    /** Recompute every pawn's anchor (called after any position change). */
    _relayout() {
      const occupied = new Set();
      for (const [, p] of this.pawns) occupied.add(p.pos);

      for (const pos of occupied) {
        const occupants = this._occupants(pos);
        const zones = JAIL_ZONES[pos];

        if (zones) {
          // the prison splits in two: locked in the cell, or out in the yard
          const jailed = occupants.filter(([, p]) => p.jailed);
          const visiting = occupants.filter(([, p]) => !p.jailed);
          this._placeGroup(jailed, pos, zones.cell, zones.cellSpread);
          visiting.forEach(([id], i) => {
            const [fx, fy] = zones.yardSlots[Math.min(i, zones.yardSlots.length - 1)];
            this._apply(this.pawns.get(id), pos, fx, fy);
          });
          // slimmer tokens so both zones stay uncluttered on a corner tile
          for (const [id] of occupants) this.pawns.get(id).el.classList.add("pawn--jail");
          continue;
        }
        for (const [id] of occupants) this.pawns.get(id).el.classList.remove("pawn--jail");

        const layout = CLUSTER_LAYOUTS[Math.min(occupants.length, 6)];
        occupants.forEach(([id], i) => {
          const [fx, fy] = layout[i];
          this._apply(this.pawns.get(id), pos, fx, fy);
        });
      }
    }

    _apply(pawn, pos, fx, fy) {
      const tile = this.tiles[pos];
      const x = tile.offsetLeft + tile.offsetWidth * (0.5 + fx);
      const y = tile.offsetTop + tile.offsetHeight * (0.5 + fy);
      // percentage anchors => positions stay correct when the board resizes
      pawn.el.style.left = (x / this.board.clientWidth) * 100 + "%";
      pawn.el.style.top = (y / this.board.clientHeight) * 100 + "%";
    }

    /* ---------- placement & movement ---------- */

    /** Instant placement (initial spawn, jail teleport, card swaps). */
    placeAt(playerId, pos) {
      const pawn = this.pawns.get(playerId);
      if (!pawn) return;
      pawn.pos = pos;
      this._relayout();
    }

    /**
     * Restart the bounce. `ms` keeps the CSS animation inside the current
     * cadence, so a sped-up long move reads as quick hops rather than a
     * half-finished bounce being cut off on every tile.
     */
    _replayHop(pawn, ms) {
      pawn.el.style.setProperty("--hop-ms", Math.max(90, Math.round(ms * 0.85)) + "ms");
      pawn.el.classList.remove(HOP_CLASS);
      void pawn.el.offsetWidth; // restart the CSS animation
      pawn.el.classList.add(HOP_CLASS);
    }

    /**
     * Move `steps` tiles one hop at a time.
     * @param {string} playerId
     * @param {number} fromPos current board index
     * @param {number} steps signed step count (negative = backwards card moves)
     * @param {{onPassGo?: (() => void)}} hooks fired when passing Start moving forward
     * @returns {Promise<number>} the final board index
     */
    async hopTo(playerId, fromPos, steps, hooks = {}) {
      const pawn = this.pawns.get(playerId);
      if (!pawn || steps === 0) return fromPos;

      const dir = steps > 0 ? 1 : -1;
      const total = TILES.length;
      const stepMs = stepCadence(steps);
      let pos = fromPos;
      // A backgrounded tab gets its timers clamped to 1/min — a host that
      // switches windows must never stall the whole match, so skip the
      // per-hop theatrics while hidden and snap the pawn instead.
      const animate = !document.hidden;

      pawn.el.style.zIndex = "9"; // hop above any stationary pawns
      for (let stepIndex = 0; stepIndex < Math.abs(steps); stepIndex++) {
        pos = (((pos + dir) % total) + total) % total; // stepIndex++ one tile at a time
        pawn.pos = pos;
        this._relayout();          // glides via CSS transition…
        if (animate) this._replayHop(pawn, stepMs); // …while bouncing translateY(-16px) scale(1.1)
        if (animate) await wait(stepMs);
        if (dir > 0 && pos === 0 && hooks.onPassGo) hooks.onPassGo();
      }
      pawn.el.style.zIndex = "";

      await wait(animate ? ARRIVAL_PAUSE_MS : 30); // settle before buy/rent modals open
      return pos;
    }
  }

  window.BT = Object.assign(window.BT || {}, { PawnLayer });
})();
