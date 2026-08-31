/* ============================================================================
 * Balkan Tycoon — mp.js
 * Multiplayer controller. Host-authoritative model:
 *
 *   - The HOST client runs the real Game engine. Every state change is
 *     snapshotted and broadcast (host:state); fine-grained visuals (pawn
 *     hops, dice results, log lines) stream as host:event messages.
 *   - GUESTS keep a hydrated "view" Game (for UI accessors) and send their
 *     intentions as player:action messages (roll / end-turn / modal answers).
 *   - The 45s turn timer is owned by the host; on timeout the host auto-rolls
 *     or auto-ends the turn. Prompts (buy/card/jail) are time-boxed too.
 *   - Trading: offer, relay to target, accept / decline / counter; the host
 *     validates and applies atomically, then broadcasts the new state.
 *   - Host migration: the relay promotes the next connected seat; the new
 *     host rebuilds the engine from the latest snapshot and carries on. A
 *     demoted host tears its engine down and follows the new one.
 *
 * Absent players never block the match:
 *   - A dropped seat keeps its chair but is auto-played after AUTO_SKIP_MS,
 *     and any prompt the host is waiting on from them resolves instantly
 *     with a safe default (skip the buy, decline the trade, roll in jail).
 *   - Presence drives the greyed-out avatars, badges and reconnect sounds.
 *   - The relay's history buffer is replayed into the session-log panel so a
 *     returning player can read exactly what they missed.
 * ========================================================================== */

"use strict";

(function () {
  const { Game, UI } = window.BT;

  /** A disconnected player's turn is auto-played after this long. */
  const AUTO_SKIP_MS = 10_000;

  /* history entry type -> [icon key, color] for the session-log panel */
  const SESSION_STYLE = {
    player_disconnected: ["wifiOff", "#f59e0b"],
    player_reconnected: ["plug", "#22c55e"],
    host_migrated: ["crown", "#f4b73f"],
    property_bought: ["building", "#3b82f6"],
    property_auctioned: ["banknote", "#f4b73f"],
    house_built: ["house", "#22c55e"],
    trade_offer: ["mail", "#c084fc"],
    trade_accepted: ["exchange", "#22c55e"],
    trade_declined: ["ban", "#ef4444"],
    turn_skipped: ["clock", "#f59e0b"],
    player_bankrupt: ["skull", "#ef4444"],
    match_started: ["flag", "#f4b73f"],
    match_over: ["crown", "#f4b73f"],
  };

  /** Relay history entry -> session-log row. */
  function sessionEntry(e) {
    const [icon, color] = SESSION_STYLE[e && e.type] || ["clock", "#8b98a8"];
    return { icon, color, text: (e && e.text) || "", timestamp: e && e.timestamp };
  }

  /* Fallback seat palette (lobby normally assigns from PLAYER_COLORS). */
  const SEAT_PRESETS = [
    { icon: "meeple", color: "#EF4444" },
    { icon: "meeple", color: "#06B6D4" },
    { icon: "meeple", color: "#10B981" },
    { icon: "meeple", color: "#F59E0B" },
    { icon: "meeple", color: "#8B5CF6" },
    { icon: "meeple", color: "#EC4899" },
  ];

  class MPController {
    constructor(deps) {
      this.net = deps.net;
      this.dice = deps.dice;
      this.pawnLayer = deps.pawnLayer;

      this.isHost = false;
      this.hostId = null;
      this.roster = [];
      this.settings = null; // match configuration from the lobby
      this.game = null;
      this.myId = null;
      this.started = false;
      this.pendingPrompts = new Map(); // promptId -> { resolve, playerId, fallback }
      this._promptSeq = 0;
      this._turnTimeout = null;
      this._turnDeadline = null;
      this._timerInterval = null;
      this._animating = new Set();
      this.presence = new Map(); // playerId -> connected
      this._skipTimer = null;

      // the relay must know whether our engine survived a transport blip
      this.net.isHostResumable = () => this.isHost && this.started;

      this._wireNet();
    }

    get mySeat() { return this.roster.find((p) => p.id === this.myId); }
    get currentIsMe() { return this.game && this.game.current.id === this.myId; }

    /** Configured turn-timer seconds (null = unlimited). */
    _turnSec() {
      const t = this.settings ? this.settings.turnTimer : 45;
      return Number(t) > 0 ? Number(t) : null;
    }

    _wireNet() {
      const net = this.net;

      net.on("room:state", (room) => {
        this.roster = room.players;
        this.hostId = room.hostId;
        const amHost = room.hostId === this.myId;

        if (this.started) {
          // authority moved while we were playing: stand down and follow
          if (this.isHost && !amHost) this._demote();
          // a rejoining guest gets whatever is left of the live turn timer
          if (!this.isHost) {
            const dl = Number(room.turnDeadline);
            this._turnDeadline = dl && dl > Date.now() ? dl : this._turnDeadline;
            this._renderTimerFromSnapshot();
          }
          this._syncPresence(room.players);
          return;
        }

        this.isHost = amHost;
        this._syncPresence(room.players);
        window.BT.Lobby.onRoomState(room, this.myId);
      });

      /* ----- session history (replayed on rejoin) ----- */

      net.on("room:event", (entry) => UI.pushSessionEvent(sessionEntry(entry)));
      net.on("room:history", (entries) => {
        UI.setSessionLog((entries || []).map(sessionEntry));
        if (entries && entries.length) UI.showSessionLog(true);
      });

      /* ----- transport blips ----- */

      net.on("net:offline", () => {
        UI.setConnState(false);
        UI.log("wifiOff", "#f59e0b", "Connection lost \u2014 reconnecting\u2026");
      });

      net.on("net:resumed", () => {
        UI.setConnState(true);
        UI.log("plug", "#22c55e", "Reconnected \u2014 resyncing the table\u2026");
      });

      net.on("game:started", (players, settings) => {
        this.roster = players;
        this.settings = settings || null;
        this._beginMatch();
      });

      net.on("host:state", (snapshot) => {
        if (this.isHost || !this.game) return;
        this.game.applySnapshot(snapshot);
        this._reconcilePawns();
        window.BT.game = this.game;
        UI.sync(this.game);
        UI.refreshBuildIfOpen(this.game);
        this._renderTimerFromSnapshot();
      });

      net.on("host:event", (event) => this._onHostEvent(event));

      net.on("player:action", (action, fromId) => {
        if (this.isHost) this._onGuestAction(action, fromId);
      });

      /* ----- trading -----
       * An offer is broadcast to the whole room rather than whispered to the
       * target. A trade rearranges the board for everybody, so a deal only two
       * people could see meant the rest of the table found out a monopoly had
       * been assembled after it was too late to do anything about it. Only the
       * two parties can act: the target accepts, declines or counters, the
       * sender can withdraw, everyone else watches. */

      net.on("trade:offer", (trade, fromId) => {
        if (!this.game || this.game.phase === "over") {
          if (trade && trade.to === this.myId) {
            this.net.sendTradeResponse({ accept: false, trade: { ...trade, from: fromId } });
          }
          return;
        }
        const full = { ...trade, from: fromId };
        const role = trade.to === this.myId ? "target" : fromId === this.myId ? "sender" : "watch";
        const from = this._playerName(fromId);
        const meta = { fromId, toId: trade.to, tradeId: trade.id, role };

        UI.incomingTrade(this.game, trade, from, {
          onAccept: role === "target"
            ? () => this.net.sendTradeResponse({ accept: true, trade: full })
            : null,
          onDecline: role === "target"
            ? () => this.net.sendTradeResponse({ accept: false, trade: full })
            : null,
          onCounter: role === "target"
            ? () => {
              this.net.sendTradeResponse({ accept: false, trade: full, counter: true });
              this.openTradeComposer(fromId, {
                giveCash: trade.wantCash, giveTiles: trade.wantTiles,
                wantCash: trade.giveCash, wantTiles: trade.giveTiles,
              });
            }
            : null,
          onWithdraw: role === "sender"
            ? () => this.net.withdrawTrade(trade.id)
            : null,
        }, meta);
      });

      /* The room's copy of an offer closing: dismiss the card everywhere so no
       * seat is left staring at a deal that has already been settled. */
      net.on("trade:closed", ({ id, outcome, byName, fromName } = {}) => {
        if (id) UI.dismissTrade(id);
        if (!outcome) return;
        const style = {
          accepted: ["exchange", "#22c55e", "accepted"],
          declined: ["ban", "#ef4444", "declined"],
          withdrawn: ["trash", "#f59e0b", "withdrew"],
          stale: ["ban", "#8b98a8", "expired"],
        }[outcome];
        if (!style) return;
        const who = byName || "Someone";
        UI.log(style[0], style[1], outcome === "withdrawn"
          ? who + " withdrew their trade offer"
          : who + " " + style[2] + " " + (fromName ? fromName + "\u2019s" : "the") + " trade offer");
      });

      net.on("trade:respond", (payload, fromId) => {
        if (!this.isHost || !this.game) return;
        const trade = payload && payload.trade;
        if (!trade) return;
        const target = this._playerName(fromId);
        const sender = this._playerName(trade.from);
        if (payload.accept && trade.to === fromId) {
          const ok = this.game.applyTrade(trade);
          if (ok) {
            window.BT.sfx.deal();
            this.net.sendEvent({ kind: "deal" });
            this._roomLog("trade_accepted", target + " accepted " + sender + "\u2019s trade", fromId, target);
          } else {
            this._hostLog("ban", "#ef4444",
              target + " accepted a trade that is no longer legal — balances or deeds changed");
          }
        } else if (!payload.accept) {
          this._roomLog("trade_declined", target + " declined " + sender + "\u2019s trade", fromId, target);
        }
        this._broadcastState();
      });

      net.on("host:migrated", ({ hostId, state }) => {
        if (hostId && hostId !== this.myId) return; // only the promoted seat acts
        this.isHost = true;
        this.hostId = this.myId;
        UI.log("crown", "#f4b73f", "You are now the host \u2014 the game continues.");
        if (this.started && state) {
          this.game = Game.fromSnapshot(state, this._hostHooks());
          window.BT.game = this.game;
          UI.game = this.game;
          // the previous host may have died mid-animation: land on a safe phase
          if (this.game.phase === "busy") this.game.phase = "turn-end";
          UI.sync(this.game);
          this._broadcastState();
          this._armTurnTimer();
          this._armAutoSkip();
        }
      });

      net.on("chat:message", ({ name, color, text }) => UI.log("mail", color, name + ": " + text));
      net.on("error", (msg) => UI.log("alert", "#ef4444", String(msg)));

      net.on("room:closed", ({ reason } = {}) => {
        // relay tore the room down (everyone left) — never leave a client hanging
        UI.log("alert", "#ef4444", "The room was closed" + (reason === "everyone-left" ? " — everyone disconnected." : "."));
        this.started = false;
        this.game = null;
        this.isHost = false;
        this._clearTurnTimer();
        clearTimeout(this._skipTimer);
        this._skipTimer = null;
        this.presence = new Map();
        UI.setPresence(new Map());
        UI.clearTrades();
        UI.showSessionLog(false);
        UI.setConnState(true);
        window.BT.myPlayerId = null;
        window.BT.mpActive = false;
        window.BT.Lobby.openHome();
      });
    }

    leave() {
      this.net.leave();
      window.BT.Lobby.openHome();
    }

    /* ================= presence ================= */

    /**
     * Fold a roster snapshot into the presence map and react to the deltas:
     * grey the seat out everywhere, play the drop/return sound, and make sure
     * an absent player can never hold the table hostage.
     */
    _syncPresence(players) {
      const next = new Map();
      for (const p of players || []) next.set(p.id, p.connected !== false);

      const first = this.presence.size === 0;
      const changes = [];
      for (const [id, on] of next) {
        const was = this.presence.get(id);
        if (!first && was !== undefined && was !== on) changes.push([id, on]);
      }

      this.presence = next;
      UI.setPresence(next);
      for (const [id, on] of next) this.pawnLayer.setPresence(id, on);

      for (const [id, on] of changes) {
        const name = this._playerName(id);
        if (on) {
          window.BT.sfx.online();
          UI.log("plug", "#22c55e", name + " reconnected");
        } else {
          window.BT.sfx.offline();
          UI.log("wifiOff", "#f59e0b", name + " disconnected \u2014 play continues without them");
          UI.dismissTradesFrom(id); // their pending offers are dead letters
        }
        UI.pulsePlayer(id, on ? "online" : "offline");
        if (!on) this._onSeatOffline(id);
      }

      // reconnects cancel a pending auto-skip, drops arm one
      if (changes.length) this._armAutoSkip();
    }

    /** Host-side: unblock anything that was waiting on the seat that dropped. */
    _onSeatOffline(playerId) {
      if (!this.isHost || !this.game) return;
      this._autoAnswerPrompts(playerId, "disconnected");
    }

    /** Resolve every pending remote prompt for `playerId` with its fallback. */
    _autoAnswerPrompts(playerId, why) {
      for (const [id, entry] of [...this.pendingPrompts]) {
        if (entry.playerId !== playerId) continue;
        this.pendingPrompts.delete(id);
        this._hostLog("clock", "#f59e0b",
          this._playerName(playerId) + " is " + why + " \u2014 auto-answering for them");
        entry.resolve(entry.fallback);
      }
    }

    /**
     * Host-side watchdog: if the player on turn is offline, play their turn
     * for them after AUTO_SKIP_MS instead of waiting out the full turn timer.
     */
    _armAutoSkip() {
      clearTimeout(this._skipTimer);
      this._skipTimer = null;
      const g = this.game;
      if (!this.isHost || !g || g.phase === "over") return;
      const cur = g.current;
      if (!cur || this.presence.get(cur.id) !== false) return; // present: nothing to do

      this._skipTimer = setTimeout(() => {
        this._skipTimer = null;
        const game = this.game;
        if (!this.isHost || !game || game.phase === "over") return;
        const p = game.current;
        if (!p || this.presence.get(p.id) !== false) return; // came back in time

        this._hostLog("clock", "#f59e0b", p.name + " is offline \u2014 auto-playing their turn");
        this._roomLog("turn_skipped", p.name + " was auto-played while disconnected", p.id, p.name);
        this._autoAnswerPrompts(p.id, "disconnected");
        if (game.phase === "awaiting-roll" || game.phase === "awaiting-jail-roll") game.roll();
        else if (game.phase === "turn-end") void game.endTurn();
        this._armAutoSkip(); // still their turn (doubles / busy)? keep pushing
      }, AUTO_SKIP_MS);
    }

    /** Push a durable history entry (host only; replayed to rejoining players). */
    _roomLog(type, text, playerId, name) {
      if (!this.isHost) return;
      this.net.sendRoomLog({ type, text, playerId: playerId || null, name: name || null });
    }

    /**
     * Authority moved to somebody else: stop driving, rebuild the engine as a
     * read-only view and follow the new host's snapshots from here on.
     */
    _demote() {
      this.isHost = false;
      this._clearTurnTimer();
      clearTimeout(this._skipTimer);
      this._skipTimer = null;
      // anything we were waiting on is the new host's problem now
      for (const [id, entry] of [...this.pendingPrompts]) {
        this.pendingPrompts.delete(id);
        entry.resolve(entry.fallback);
      }
      if (this.game) {
        this.game = Game.fromSnapshot(this.game.serialize(), this._guestHooks());
        window.BT.game = this.game;
        UI.game = this.game;
        UI.sync(this.game);
      }
      UI.log("globe", "#f4b73f", this._playerName(this.hostId) + " is hosting now \u2014 following their table.");
    }

    /* ================= match lifecycle ================= */

    _beginMatch() {
      this.started = true;
      window.BT.Lobby.closeMenu();
      UI.showSessionLog(true);
      UI.setConnState(true);

      const defs = this.roster.map((seat, i) => ({
        id: seat.id,
        name: seat.name,
        icon: "meeple",
        color: seat.color || SEAT_PRESETS[i % SEAT_PRESETS.length].color,
        tokenStyle: Number.isFinite(seat.tokenStyle) ? seat.tokenStyle : undefined,
      }));
      const s = this.settings;
      const config = s ? {
        startCash: s.startCash,
        goReward: s.goReward,
        jailFee: s.jailFee,
        maxRounds: s.maxRounds,
        rules: s.rules,
      } : undefined;

      if (this.isHost) {
        this.game = new Game(defs, this._hostHooks(), { config });
        this.game.players.forEach((p, i) => { p.id = defs[i].id; p.seat = i; });
        this.game._log("globe", "#f4b73f", "Match started — good luck!");
        this._broadcastState();
        this._armTurnTimer();
      } else {
        this.game = new Game(defs, this._guestHooks(), { silent: true, config });
        this.game.players.forEach((p, i) => { p.id = defs[i].id; p.seat = i; });
      }

      window.BT.game = this.game;
      UI.game = this.game;
      this.game.players.forEach((p, i) => this.pawnLayer.addPlayer(p, i));
      this._syncPresence(this.roster);
      UI.sync(this.game);
      this._startClock();
      this._armAutoSkip();
    }

    /* ================= host: engine hooks ================= */

    _hostHooks() {
      const self = this;
      return {
        log(iconKey, color, text) {
          UI.log(iconKey, color, text);
          self.net.sendEvent({ kind: "log", icon: iconKey, color, text });
        },
        stateChanged() {
          UI.sync(self.game);
          UI.refreshBuildIfOpen(self.game);
          self._broadcastState();
          self._armTurnTimer();
          self._armAutoSkip();
        },
        rollDice(cb) {
          // Draw the result ONCE here, stream it to every client, then let
          // each screen play the identical guided animation on the same
          // fixed timeline — same faces, same duration, no drift, no delay.
          const d1 = 1 + Math.floor(Math.random() * 6);
          const d2 = 1 + Math.floor(Math.random() * 6);
          UI.showLastRoll(d1, d2);
          self.net.sendEvent({ kind: "roll-result", d1, d2 });
          self.dice.roll((a, b, total) => cb(a, b, total), [d1, d2]);
        },
        async movePawn(player, from, steps, hooks) {
          /* `seq` lets a guest throw away a stale walk. Two moves for the same
           * pawn can overlap (doubles, or a card that moves you again), and
           * without a sequence number the older animation's completion handler
           * would land the pawn on the older target — which is exactly the
           * "he sees me one field further along" desync. */
          self._moveSeq = (self._moveSeq || 0) + 1;
          self.net.sendEvent({
            kind: "pawn-move", playerId: player.id, from, steps, seq: self._moveSeq,
          });
          self._movingPawn = player.id;
          const pos = await self.pawnLayer.hopTo(player.id, from, steps, hooks);
          self._movingPawn = null;
          UI.flashTile(pos);
          return pos;
        },
        teleportPawn(player, pos) {
          self.pawnLayer.placeAt(player.id, pos);
          self.net.sendEvent({ kind: "teleport", playerId: player.id, pos });
        },
        removePawn(player) {
          self.pawnLayer.removePlayer(player.id);
          self.net.sendEvent({ kind: "remove-pawn", playerId: player.id });
        },
        setJailed(player, jailed) {
          self.pawnLayer.setJailed(player.id, jailed);
          if (jailed) window.BT.sfx.jail();
          self.net.sendEvent({ kind: "jailed", playerId: player.id, jailed });
        },
        /* Presence of this hook is what stops the engine liquidating for the
         * player. The debt then rides along in the state snapshot, so the
         * debtor's own client raises the settle window — no prompt plumbing
         * needed, and it survives their reload. The timer below is the only
         * safety net: if they never answer, the bank steps in so the rest of
         * the table is not held hostage. */
        debtRaised(player) {
          self._armDebtTimeout(player);
        },
        promptBuy(player, tile, price) {
          if (player.id === self.myId) return UI.promptBuy(player, tile, price);
          return self._promptRemote(player, { type: "buy", tileId: tile.id, price }, false);
        },
        showCard(card) {
          const p = self.game.current;
          if (p.id === self.myId) return UI.showCard(card);
          return self._promptRemote(p, { type: "card", card }, true);
        },
        jailChoice(player) {
          if (player.id === self.myId) {
            UI.setStatusRaw("<strong>" + player.name + "</strong> is in prison\u2026");
            return UI.jailChoice(player);
          }
          UI.setStatusRaw("Waiting for <strong>" + player.name + "</strong> (prison)\u2026");
          return self._promptRemote(player, { type: "jail" }, "roll");
        },
        auctionStep(ctx) {
          if (ctx.player.id === self.myId) return UI.auctionStep(ctx);
          return self._promptRemote(
            self.game.player(ctx.player.id),
            { type: "auction", ctx },
            { pass: true },
          );
        },
        boughtProperty(player, tile) {
          UI.muteNextCashSound(); // the purchase sound already covers the money
          UI.celebratePurchase(tile.id, player);
          self.net.sendEvent({ kind: "bought", playerId: player.id, tileId: tile.id });
          self._roomLog("property_bought",
            player.name + " bought " + tile.name + " for \u20ac" + tile.price, player.id, player.name);
        },
        builtOn(player, tile, level) {
          UI.muteNextCashSound();
          if (level >= 4) window.BT.sfx.hotel(); else window.BT.sfx.build();
          self.net.sendEvent({ kind: "built", playerId: player.id, tileId: tile.id, level });
          self._roomLog("house_built",
            player.name + (level >= 4 ? " opened a hotel on " : " built house #" + level + " on ") + tile.name,
            player.id, player.name);
        },
        soldOn(player, tile) {
          UI.muteNextCashSound();
          window.BT.sfx.sell();
          self.net.sendEvent({ kind: "sold", playerId: player.id, tileId: tile.id });
        },
        paidRent(payer, owner, amount) {
          UI.muteNextCashSound();
          window.BT.sfx.rent(amount);
          self.net.sendEvent({ kind: "money", how: "rent", playerId: payer.id, toId: owner.id, amount });
        },
        paidTax(player, amount) {
          UI.muteNextCashSound();
          window.BT.sfx.tax(amount);
          self.net.sendEvent({ kind: "money", how: "tax", playerId: player.id, amount });
        },
        bankrupted(player) {
          window.BT.sfx.bankrupt();
          self.net.sendEvent({ kind: "bankrupt", playerId: player.id });
          self._roomLog("player_bankrupt", player.name + " went bankrupt", player.id, player.name);
        },
        gameOver(winner, reason) {
          window.BT.sfx.win();
          UI.showGameOver(winner, reason);
          self.net.sendEvent({ kind: "game-over", winnerId: winner ? winner.id : null, reason });
          self._roomLog("match_over", (winner ? winner.name : "Nobody") + " won \u2014 " + reason,
            winner ? winner.id : null, winner ? winner.name : null);
          self._clearTurnTimer();
          clearTimeout(self._skipTimer);
        },
      };
    }

    _guestHooks() {
      const noop = () => {};
      return {
        log: noop, stateChanged: noop,
        rollDice: (cb) => cb(1, 1, 2),
        movePawn: async (_p, from) => from,
        teleportPawn: noop, removePawn: noop, setJailed: noop,
        promptBuy: async () => false, showCard: async () => {}, jailChoice: async () => "roll",
        boughtProperty: noop, builtOn: noop, soldOn: noop, bankrupted: noop,
        paidRent: noop, paidTax: noop,
        gameOver: noop,
      };
    }

    /* ================= host: remote prompts ================= */

    /**
     * Ask a remote player something (buy / card / jail / auction) and never
     * hang on the answer: an offline seat is answered immediately with the
     * safe default, and everyone else is time-boxed to the turn timer.
     */
    /**
     * Host-side safety net for a debt nobody is answering.
     *
     * It only ever fires for a seat that has actually LEFT. A player who is
     * present gets as long as they want: settling is a real decision — which
     * houses to sell, which deed to hock, whether to concede — and having the
     * bank liquidate your portfolio because you thought about it for a minute is
     * the opposite of playing the game. An absent player still cannot hold the
     * rest of the table hostage.
     */
    _armDebtTimeout(player) {
      clearTimeout(this._debtTimer);
      const tick = () => {
        const g = this.game;
        const p = g && g.player(player.id);
        if (!p || !p.debtAmount) { this._clearDebtTimeout(); return; } // dealt with
        if (this.presence.get(p.id) === false) {
          this._hostLog("clock", "#f59e0b",
            p.name + " left mid-debt \u2014 the bank settles it for them");
          this._clearDebtTimeout();
          g.forceSettle(p);
          return;
        }
        this._debtTimer = setTimeout(tick, 5000);
      };
      // one grace period before the first check, then poll while it is unpaid
      this._debtTimer = setTimeout(tick, 8000);
    }

    _clearDebtTimeout() {
      clearTimeout(this._debtTimer);
      this._debtTimer = null;
    }

    _promptRemote(player, prompt, fallback) {
      // already gone? do not even send it — resolve on the spot
      if (this.presence.get(player.id) === false) {
        this._hostLog("clock", "#f59e0b", player.name + " is offline \u2014 auto-answering for them");
        return Promise.resolve(fallback);
      }
      const id = "pr" + (++this._promptSeq);
      this.net.sendEvent({ kind: "prompt", to: player.id, prompt: { ...prompt, id } });
      return new Promise((resolve) => {
        this.pendingPrompts.set(id, { resolve, playerId: player.id, fallback });
        /* Only time a prompt out when the table asked for a clock. On an
         * unlimited timer a purchase offer used to be silently withdrawn after
         * 45 seconds — which is exactly the window a player needs to go and
         * mortgage something before deciding. Absent seats are still covered:
         * _onSeatOffline answers their prompts the moment they drop. */
        const secs = this._turnSec();
        if (secs == null) return;
        setTimeout(() => {
          const entry = this.pendingPrompts.get(id);
          if (!entry) return;
          this.pendingPrompts.delete(id);
          this._hostLog("clock", "#f59e0b", player.name + " took too long \u2014 auto-continuing");
          entry.resolve(fallback);
        }, secs * 1000);
      });
    }

    /* ================= host: guest actions ================= */

    /**
     * Host-side gate on a player touching their own deeds. Mirrors UI.canManage
     * so the client and the authority agree: your own turn always, any turn when
     * the table allows it, and always while you owe money — that prompt exists
     * so you can raise cash, and locking the controls would make it a dead end.
     */
    _mayManage(g, p) {
      if (!g || !p || p.bankrupt || g.phase === "over") return false;
      if (p.debtAmount > 0) return true;
      if (g.rules && g.rules.buildAnytime) return true;
      return g.current && g.current.id === p.id;
    }

    _onGuestAction(action, fromId) {
      const g = this.game;
      if (!g || g.phase === "over") return;

      switch (action && action.kind) {
        case "roll":
          if (fromId === g.current.id && (g.phase === "awaiting-roll" || g.phase === "awaiting-jail-roll")) {
            g.roll();
          }
          break;
        case "end-turn":
          if (fromId === g.current.id && g.phase === "turn-end") void g.endTurn();
          break;
        /* The engine keeps its own copy of the roster, so a rename has to be
         * pushed into it or the ledger, the log and every deed card keep using
         * the name the player joined with. */
        case "rename": {
          const p = g.player(fromId);
          const name = String(action.name || "").trim().slice(0, 16);
          if (!p || !name || p.name === name) break;
          const was = p.name;
          p.name = name;
          this._hostLog("users", "#8b98a8", was + " is now " + name);
          g._changed();
          break;
        }
        case "prompt-response": {
          const entry = this.pendingPrompts.get(action.id);
          if (entry && entry.playerId === fromId) {
            this.pendingPrompts.delete(action.id);
            entry.resolve(action.value);
          }
          break;
        }
        case "build": {
          const p = g.player(fromId);
          const tile = tileById(String(action.tileId));
          if (!p || !tile || !g.props[tile.id] || g.props[tile.id].owner !== fromId) break;
          if (!this._mayManage(g, p)) break;
          g.build(p, tile.id);
          break;
        }
        case "sell": {
          const p = g.player(fromId);
          const tile = tileById(String(action.tileId));
          if (!p || !tile || !g.props[tile.id] || g.props[tile.id].owner !== fromId) break;
          if (!this._mayManage(g, p)) break;
          g.sellHouse(p, tile.id);
          break;
        }
        /* Deed actions. The engine's can* guards cover the rules; the host adds
         * the two checks a client must never be trusted with — that the deed is
         * really theirs, and that it is really their turn. */
        /* Settling is the debtor's own call, so it is checked against the
         * sender rather than the current turn — a debt can outlive the roll
         * that caused it. */
        case "settle-debt": {
          const p = g.player(fromId);
          if (p && p.debtAmount > 0 && g.settleDebt(p)) this._clearDebtTimeout();
          break;
        }
        case "declare-bankrupt": {
          const p = g.player(fromId);
          if (p && !p.bankrupt) { g.declareBankrupt(p); this._clearDebtTimeout(); }
          break;
        }
        case "mortgage":
        case "unmortgage":
        case "sell-field": {
          const p = g.player(fromId);
          const tile = tileById(String(action.tileId));
          if (!p || !tile || !g.props[tile.id] || g.props[tile.id].owner !== fromId) break;
          if (!this._mayManage(g, p)) break;
          if (action.kind === "mortgage") g.mortgage(p, tile.id);
          else if (action.kind === "unmortgage") g.unmortgage(p, tile.id);
          else g.sellField(p, tile.id);
          break;
        }
      }
    }
    /* ================= host: broadcast + timer ================= */

    _hostLog(iconKey, color, text) {
      UI.log(iconKey, color, text);
      this.net.sendEvent({ kind: "log", icon: iconKey, color, text });
    }

    /**
     * Push the authoritative state to every guest.
     *
     * This used to bail out whenever the engine was in the `busy` phase, which
     * covers the entire resolution of a turn: the roll, the move, the purchase,
     * the rent, the card. So a guest's ledger did not move until the turn was
     * over, and every payment inside it was invisible while it happened — a
     * buyer's balance stayed full after they bought, and rent landed in the
     * landlord's column seconds later, out of context. From the other side of
     * the table that is indistinguishable from "he didn't pay".
     *
     * The reason for the old guard was pawn drift, not money: a snapshot landing
     * mid-hop would yank a pawn to its destination. That is handled properly on
     * the guest (`_animating`) and here (`_movingPawn`), so state can stream
     * continuously and only the walk itself is protected.
     */
    _broadcastState() {
      if (!this.isHost || !this.game) return;
      this.net.sendState(this.game.serialize());
      this.net.sendEvent({
        kind: "turn",
        deadline: this._turnDeadline,
        currentId: this.game.current ? this.game.current.id : null,
      });
    }

    _armTurnTimer() {
      this._clearTurnTimer();
      const g = this.game;
      if (!this.isHost || !g || g.phase === "over") {
        this.net.sendEvent({ kind: "turn", deadline: null, currentId: null });
        this._renderTimerFromSnapshot();
        return;
      }
      if (!["awaiting-roll", "awaiting-jail-roll", "turn-end"].includes(g.phase)) {
        // mid-animation / mid-prompt: no countdown to show rather than a dead 0
        this.net.sendEvent({ kind: "turn", deadline: null, currentId: g.current.id });
        this._renderTimerFromSnapshot();
        return;
      }

      const secs = this._turnSec();
      if (secs == null) { // unlimited
        this.net.sendEvent({ kind: "turn", deadline: null, currentId: g.current.id });
        return;
      }

      this._turnDeadline = Date.now() + secs * 1000;
      const deadline = this._turnDeadline;
      this.net.sendEvent({ kind: "turn", deadline, currentId: g.current.id });
      this._turnTimeout = setTimeout(() => {
        if (this._turnDeadline !== deadline || !this.game) return;
        const phase = this.game.phase;
        this._hostLog("clock", "#f59e0b", this.game.current.name + " timed out — auto-playing");
        if (phase === "awaiting-roll" || phase === "awaiting-jail-roll") this.game.roll();
        else if (phase === "turn-end") void this.game.endTurn();
      }, secs * 1000);
      this._renderTimerFromSnapshot();
    }

    _clearTurnTimer() {
      if (this._turnTimeout) clearTimeout(this._turnTimeout);
      this._turnTimeout = null;
      this._turnDeadline = null;
    }

    /* ================= guest: host events ================= */

    _onHostEvent(event) {
      if (this.isHost) return;
      const g = this.game;
      switch (event.kind) {
        case "log":
          UI.log(event.icon, event.color, event.text);
          break;
        case "roll-result":
          // Same predetermined faces the host (and every other screen) got —
          // interrupt-safe so a late event always resyncs the animation.
          UI.showLastRoll(event.d1, event.d2);
          this.dice.roll(() => {}, [event.d1, event.d2], { interrupt: true });
          break;
        case "pawn-move": {
          const pawn = this.pawnLayer.pawns.get(event.playerId);
          /* The host's `from` is authoritative. This used to hop from the
           * guest's own belief of where the pawn stood, so any drift — a
           * dropped event, or a snapshot landing mid-hop — made the pawn walk
           * from the wrong tile and stop a field short or long. It looked like
           * the player moved one square too far, and stayed wrong until the
           * next snapshot silently snapped it back. Re-seat on the host's
           * start tile first, then animate, then land on the exact target
           * rather than wherever the animation happened to finish. */
          if (pawn && pawn.pos !== event.from) {
            this.pawnLayer.placeAt(event.playerId, event.from);
          }
          /* Supersede any walk already in flight for this pawn. Two overlapping
           * moves used to both run to completion, and whichever finished LAST
           * won — so a stale animation could plant the pawn a field away from
           * where the host says it is and leave it there until the next
           * snapshot. Now only the newest sequence is allowed to land. */
          const seq = Number(event.seq) || 0;
          this._moveSeqs = this._moveSeqs || new Map();
          this._moveSeqs.set(event.playerId, seq);
          this._animating.add(event.playerId);
          const ring = window.BT.TILES.length;
          const target = (((event.from + event.steps) % ring) + ring) % ring;
          this.pawnLayer
            .hopTo(event.playerId, event.from, event.steps, { onPassGo: () => {} })
            .then(() => {
              if (this._moveSeqs.get(event.playerId) !== seq) return; // superseded
              this._animating.delete(event.playerId);
              /* Land on from+steps, computed from the host's own numbers, rather
               * than on wherever the animation happened to stop or on a snapshot
               * that may still be describing the tile we left. Any real drift is
               * corrected by _reconcilePawns on the next snapshot. */
              this.pawnLayer.placeAt(event.playerId, target);
              UI.flashTile(target);
              /* Re-resolve the player: applySnapshot rebuilds the whole roster,
               * so `player` captured when the event arrived is very likely a
               * discarded object by now. Writing the landing tile into it left
               * the live roster still pointing at the tile we came FROM — which
               * is what made a pawn look a field off and then snap back to
               * "default" the moment the next snapshot reconciled it. */
              const live = this.game && this.game.player(event.playerId);
              if (live) live.position = target;
            });
          break;
        }
        case "teleport": {
          if (this.pawnLayer.pawns.get(event.playerId)) {
            this.pawnLayer.placeAt(event.playerId, event.pos);
          }
          break;
        }
        case "remove-pawn":
          this.pawnLayer.removePlayer(event.playerId);
          break;
        case "jailed":
          this.pawnLayer.setJailed(event.playerId, event.jailed);
          if (event.jailed) window.BT.sfx.jail();
          break;
        case "turn":
          this._turnDeadline = event.deadline || null;
          this._renderTimerFromSnapshot();
          break;
        case "deal":
          window.BT.sfx.deal();
          break;
        case "bought": {
          const buyer = g && g.player(event.playerId);
          UI.muteNextCashSound();
          UI.celebratePurchase(event.tileId, buyer || { id: event.playerId, color: "#f0b64a" });
          break;
        }
        case "built":
          UI.muteNextCashSound();
          if (event.level >= 4) window.BT.sfx.hotel(); else window.BT.sfx.build();
          break;
        case "sold":
          UI.muteNextCashSound();
          window.BT.sfx.sell();
          break;
        case "money":
          // the specific sound replaces the generic cash whoosh
          UI.muteNextCashSound();
          if (event.how === "rent") window.BT.sfx.rent(event.amount);
          else if (event.how === "tax") window.BT.sfx.tax(event.amount);
          break;
        case "bankrupt":
          window.BT.sfx.bankrupt();
          break;
        case "prompt":
          if (event.to === this.myId) this._answerPrompt(event.prompt);
          break;
        case "game-over": {
          const winner = g ? g.player(event.winnerId) : null;
          UI.showGameOver(winner, event.reason);
          break;
        }
      }
    }

    _answerPrompt(prompt) {
      const g = this.game;
      const me = g.player(this.myId);
      const respond = (value) => this.net.sendAction({ kind: "prompt-response", id: prompt.id, value });
      switch (prompt.type) {
        case "buy":
          UI.promptBuy(me, tileById(prompt.tileId), prompt.price).then(respond);
          break;
        case "card":
          UI.showCard(prompt.card).then(() => respond(true));
          break;
        case "jail":
          UI.jailChoice(me).then(respond);
          break;
        case "auction":
          UI.auctionStep(prompt.ctx).then(respond);
          break;
      }
    };

    /** After a snapshot, snap any non-animating pawns to their true tiles. */
    _reconcilePawns() {
      if (!this.game) return;
      for (const p of this.game.players) {
        const pawn = this.pawnLayer.pawns.get(p.id);
        if (!pawn) {
          if (!p.bankrupt) this.pawnLayer.addPlayer(p, p.seat);
          continue;
        }
        if (p.bankrupt) { this.pawnLayer.removePlayer(p.id); continue; }
        this.pawnLayer.setJailed(p.id, p.inJail);
        if (!this._animating.has(p.id) && pawn.pos !== p.position) {
          this.pawnLayer.placeAt(p.id, p.position);
        }
      }
    }

    /* ================= actions from THIS client ================= */

    clickRoll() {
      if (!this.game) return;
      if (this.isHost) this.game.roll();
      else this.net.sendAction({ kind: "roll" });
    }

    clickEndTurn() {
      if (!this.game) return;
      if (this.isHost) void this.game.endTurn();
      else this.net.sendAction({ kind: "end-turn" });
    }

    clickBuild(tileId) {
      if (!this.game) return;
      if (this.isHost) this.game.build(this.game.player(this.myId), tileId);
      else this.net.sendAction({ kind: "build", tileId });
    }

    clickSettleDebt() {
      if (!this.game) return;
      if (this.isHost) {
        const p = this.game.player(this.myId);
        if (p && this.game.settleDebt(p)) this._clearDebtTimeout();
      } else this.net.sendAction({ kind: "settle-debt" });
    }

    clickDeclareBankrupt() {
      if (!this.game) return;
      if (this.isHost) {
        this.game.declareBankrupt(this.game.player(this.myId));
        this._clearDebtTimeout();
      } else this.net.sendAction({ kind: "declare-bankrupt" });
    }

    clickMortgage(tileId) {
      if (!this.game) return;
      if (this.isHost) this.game.mortgage(this.game.player(this.myId), tileId);
      else this.net.sendAction({ kind: "mortgage", tileId });
    }

    clickUnmortgage(tileId) {
      if (!this.game) return;
      if (this.isHost) this.game.unmortgage(this.game.player(this.myId), tileId);
      else this.net.sendAction({ kind: "unmortgage", tileId });
    }

    clickSellField(tileId) {
      if (!this.game) return;
      if (this.isHost) this.game.sellField(this.game.player(this.myId), tileId);
      else this.net.sendAction({ kind: "sell-field", tileId });
    }

    clickSell(tileId) {
      if (!this.game) return;
      if (this.isHost) this.game.sellHouse(this.game.player(this.myId), tileId);
      else this.net.sendAction({ kind: "sell", tileId });
    }

    sendChat(text) { this.net.sendChat(text); }

    /* ================= trading ================= */

    openTradeComposer(prefillTo, prefill) {
      if (!this.game) return;
      UI.openTrade(this.game, this.myId, {
        prefillTo: prefillTo || null,
        prefill: prefill || null,
        onSend: (trade) => {
          // A stable id is what lets every seat's copy of the card be dismissed
          // together when the offer is answered or pulled.
          const withId = { ...trade, id: "t" + this.myId.slice(0, 6) + "-" + Date.now().toString(36) };
          this.net.sendTradeOffer(withId);
          UI.log("exchange", "#22c55e",
            "Offer sent to " + this._playerName(trade.to) + " — the whole table can see it.");
        },
      });
    }

    /* ================= timer display ================= */

    _startClock() {
      if (this._timerInterval) clearInterval(this._timerInterval);
      this._timerInterval = setInterval(() => this._renderTimerFromSnapshot(), 500);
    }

    _renderTimerFromSnapshot() {
      if (!this._turnDeadline) { UI.setTurnTimer(null); return; }
      const left = Math.max(0, Math.round((this._turnDeadline - Date.now()) / 1000));
      UI.setTurnTimer(left, this._turnSec() || 45);
    }

    _playerName(id) {
      const seat = this.roster.find((p) => p.id === id);
      return (seat && seat.name) || (this.game && this.game.player(id) ? this.game.player(id).name : "Player");
    }
  }

  window.BT = Object.assign(window.BT || {}, { MPController, SEAT_PRESETS });
})();
