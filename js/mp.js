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
 *     host rebuilds the engine from the latest snapshot and carries on.
 * ========================================================================== */

"use strict";

(function () {
  const { Game, UI } = window.BT;

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
      this.roster = [];
      this.settings = null; // match configuration from the lobby
      this.game = null;
      this.myId = null;
      this.started = false;
      this.pendingPrompts = new Map();
      this._promptSeq = 0;
      this._turnTimeout = null;
      this._turnDeadline = null;
      this._timerInterval = null;
      this._animating = new Set();

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
        const amHost = room.hostId === this.myId;
        if (amHost !== this.isHost && this.started) return;
        this.isHost = amHost;
        if (!this.started) {
          window.BT.Lobby.onRoomState(room, this.myId);
        }
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

      net.on("trade:offer", (trade, fromId) => {
        const from = this._playerName(fromId);
        UI.incomingTrade(this.game, trade, from, {
          onAccept: () => this.net.sendTradeResponse({ accept: true, trade: { ...trade, from: fromId, to: this.myId } }),
          onDecline: () => this.net.sendTradeResponse({ accept: false, trade: { ...trade, from: fromId, to: this.myId } }),
          onCounter: () => this.openTradeComposer(fromId, {
            giveCash: trade.wantCash, giveTiles: trade.wantTiles,
            wantCash: trade.giveCash, wantTiles: trade.giveTiles,
          }),
        });
      });

      net.on("trade:respond", (payload, fromId) => {
        if (!this.isHost || !this.game) return;
        const trade = payload && payload.trade;
        if (!trade) return;
        if (payload.accept && trade.to === fromId) {
          const ok = this.game.applyTrade(trade);
          if (ok) {
            window.BT.sfx.deal();
            this.net.sendEvent({ kind: "deal" });
          } else {
            this._hostLog("ban", "#ef4444", "Trade failed validation (state changed)");
          }
        } else if (!payload.accept) {
          this._hostLog("ban", "#ef4444",
            this._playerName(fromId) + " declined " + this._playerName(trade.from) + "\u2019s trade offer");
        }
        this._broadcastState();
      });

      net.on("host:migrated", ({ state }) => {
        this.isHost = true;
        UI.log("globe", "#f4b73f", "You are now the host — game continues.");
        if (this.started && state) {
          this.game = Game.fromSnapshot(state, this._hostHooks());
          window.BT.game = this.game;
          if (this.game.phase === "busy") this.game.phase = "turn-end";
          UI.sync(this.game);
          this._broadcastState();
          this._armTurnTimer();
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
        window.BT.myPlayerId = null;
        window.BT.mpActive = false;
        window.BT.Lobby.openHome();
      });
    }

    leave() {
      this.net.leave();
      window.BT.Lobby.openHome();
    }
    /* ================= match lifecycle ================= */

    _beginMatch() {
      this.started = true;
      window.BT.Lobby.closeMenu();

      const defs = this.roster.map((seat, i) => ({
        id: seat.id,
        name: seat.name,
        icon: "meeple",
        color: seat.color || SEAT_PRESETS[i % SEAT_PRESETS.length].color,
        tokenStyle: Number.isFinite(seat.tokenStyle) ? seat.tokenStyle : undefined,
      }));
      const config = this.settings ? {
        startCash: this.settings.startCash,
        rules: this.settings.rules,
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
      this.game.players.forEach((p, i) => this.pawnLayer.addPlayer(p, i));
      UI.sync(this.game);
      this._startClock();
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
          self.net.sendEvent({ kind: "pawn-move", playerId: player.id, from, steps });
          const pos = await self.pawnLayer.hopTo(player.id, from, steps, hooks);
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
          self.net.sendEvent({ kind: "jailed", playerId: player.id, jailed });
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
        gameOver(winner, reason) {
          UI.showGameOver(winner, reason);
          self.net.sendEvent({ kind: "game-over", winnerId: winner ? winner.id : null, reason });
          self._clearTurnTimer();
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
        gameOver: noop,
      };
    }

    /* ================= host: remote prompts ================= */

    _promptRemote(player, prompt, fallback) {
      const id = "pr" + (++this._promptSeq);
      this.net.sendEvent({ kind: "prompt", to: player.id, prompt: { ...prompt, id } });
      return new Promise((resolve) => {
        this.pendingPrompts.set(id, resolve);
        setTimeout(() => {
          if (this.pendingPrompts.delete(id)) {
            this._hostLog("clock", "#f59e0b", player.name + " took too long — auto-continuing");
            resolve(fallback);
          }
        }, (this._turnSec() || 45) * 1000);
      });
    }

    /* ================= host: guest actions ================= */

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
        case "prompt-response": {
          const resolve = this.pendingPrompts.get(action.id);
          if (resolve) { this.pendingPrompts.delete(action.id); resolve(action.value); }
          break;
        }
        case "build": {
          const p = g.player(fromId);
          const tile = tileById(String(action.tileId));
          if (p && tile && g.props[tile.id] && g.props[tile.id].owner === fromId) g.build(p, tile.id);
          break;
        }
        case "sell": {
          const p = g.player(fromId);
          const tile = tileById(String(action.tileId));
          if (p && tile && g.props[tile.id] && g.props[tile.id].owner === fromId) g.sellHouse(p, tile.id);
          break;
        }
      }
    }
    /* ================= host: broadcast + timer ================= */

    _hostLog(iconKey, color, text) {
      UI.log(iconKey, color, text);
      this.net.sendEvent({ kind: "log", icon: iconKey, color, text });
    }

    /** Snapshots go out only from stable phases (never mid-animation). */
    _broadcastState() {
      if (!this.isHost || !this.game) return;
      if (this.game.phase === "busy") return;
      this.net.sendState(this.game.serialize());
      this.net.sendEvent({ kind: "turn", deadline: this._turnDeadline, currentId: this.game.current.id });
    }

    _armTurnTimer() {
      this._clearTurnTimer();
      const g = this.game;
      if (!this.isHost || !g || g.phase === "over") return;
      if (!["awaiting-roll", "awaiting-jail-roll", "turn-end"].includes(g.phase)) return;

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
          this._animating.add(event.playerId);
          const player = g && g.player(event.playerId);
          const pawn = this.pawnLayer.pawns.get(event.playerId);
          const from = pawn ? pawn.pos : event.from;
          this.pawnLayer
            .hopTo(event.playerId, from, event.steps, { onPassGo: () => {} })
            .then((pos) => {
              this._animating.delete(event.playerId);
              UI.flashTile(pos);
              if (player) player.position = pos;
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
          break;
        case "turn":
          this._turnDeadline = event.deadline || null;
          this._renderTimerFromSnapshot();
          break;
        case "deal":
          window.BT.sfx.deal();
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
          this.net.sendTradeOffer(trade);
          UI.log("exchange", "#22c55e", "Trade offer sent to " + this._playerName(trade.to) + ".");
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
      UI.setTurnTimer(left);
    }

    _playerName(id) {
      const seat = this.roster.find((p) => p.id === id);
      return (seat && seat.name) || (this.game && this.game.player(id) ? this.game.player(id).name : "Player");
    }
  }

  window.BT = Object.assign(window.BT || {}, { MPController, SEAT_PRESETS });
})();
