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
  const STEP_MS = 240;          // per-tile cadence (200ms hop + glide settle)
  const ARRIVAL_PAUSE_MS = 400; // pause on destination before modals
  const HOP_CLASS = "hop";

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  /* Cluster layouts (fraction of tile size, relative to tile centre).
   * Chosen per number of pawns currently occupying the tile. */
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
      this.layer.appendChild(el);
      this.pawns.set(player.id, { el, seat, pos: player.position });
      this._relayout();
    }

    removePlayer(playerId) {
      const p = this.pawns.get(playerId);
      if (p) p.el.remove();
      this.pawns.delete(playerId);
      this._relayout();
    }

    setJailed(playerId, jailed) {
      const p = this.pawns.get(playerId);
      if (p) p.el.classList.toggle("is-jailed", jailed);
    }

    /* ---------- dynamic 2x2 cluster stacking ---------- */

    /** Occupants of a tile ordered by seat for stable slot assignment. */
    _occupants(pos) {
      return [...this.pawns.entries()]
        .filter(([, p]) => p.pos === pos)
        .sort((a, b) => a[1].seat - b[1].seat);
    }

    /** Recompute every pawn's anchor (called after any position change). */
    _relayout() {
      const byTile = new Map();
      for (const [id, p] of this.pawns) {
        if (!byTile.has(p.pos)) byTile.set(p.pos, []);
        byTile.get(p.pos).push(id);
      }
      for (const [pos] of byTile) {
        const occupants = this._occupants(pos);
        const layout = CLUSTER_LAYOUTS[Math.min(occupants.length, 6)];
        occupants.forEach(([id], i) => {
          const pawn = this.pawns.get(id);
          const [fx, fy] = layout[i];
          this._apply(pawn, pos, fx, fy);
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

    _replayHop(pawn) {
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
        if (animate) this._replayHop(pawn); // …while bouncing translateY(-16px) scale(1.1)
        if (animate) await wait(STEP_MS);
        if (dir > 0 && pos === 0 && hooks.onPassGo) hooks.onPassGo();
      }
      pawn.el.style.zIndex = "";

      await wait(animate ? ARRIVAL_PAUSE_MS : 30); // settle before buy/rent modals open
      return pos;
    }
  }

  window.BT = Object.assign(window.BT || {}, { PawnLayer });
})();
