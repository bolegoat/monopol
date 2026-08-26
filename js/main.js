/* ============================================================================
 * Balkan Tycoon — main.js
 * Boot: render the board behind the pre-game menu, init the 3D dice + pawn
 * layer, then wire the menu flows:
 *   - local hot-seat  -> engine runs in-page
 *   - online create   -> NetClient room + MPController (host-authoritative)
 *   - online join     -> same, guest side
 * ========================================================================== */

"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);
  const { UI, DiceManager, PawnLayer, Game, NetClient, MPController } = window.BT;

  /* ---------- static boot ---------- */

  UI.renderBoard();
  UI.hydrateIcons();

  const dice = new DiceManager($("#dice-canvas"));
  const pawnLayer = new PawnLayer($("#board"), UI.tileEls);

  let game = null; // local-mode engine
  let mp = null;   // online-mode controller

  /* ---------- local game (hot-seat) ---------- */

  function startLocalGame(defs) {
    window.BT.myPlayerId = null; // no turn lock locally
    window.BT.mpActive = false;
    window.BT.Lobby.closeMenu();
    UI.setRoomChip(null);

    game = new Game(defs, {
      log: UI.log,
      stateChanged: () => UI.sync(game),

      rollDice: (cb) =>
        dice.roll((d1, d2, total) => {
          UI.showLastRoll(d1, d2);
          cb(d1, d2, total);
        }),

      movePawn: async (player, from, steps, hooks) => {
        const pos = await pawnLayer.hopTo(player.id, from, steps, hooks);
        UI.flashTile(pos);
        return pos;
      },
      teleportPawn: (player, pos) => pawnLayer.placeAt(player.id, pos),
      removePawn: (player) => pawnLayer.removePlayer(player.id),
      setJailed: (player, jailed) => pawnLayer.setJailed(player.id, jailed),

      promptBuy: (player, tile, price) => UI.promptBuy(player, tile, price),
      showCard: (card) => UI.showCard(card),
      auctionStep: (ctx) => UI.auctionStep(ctx),
      jailChoice: (player) => {
        UI.setStatusRaw(`<strong>${player.name}</strong> is in prison…`);
        return UI.jailChoice(player);
      },
      gameOver: (winner, reason) => {
        window.BT.sfx.win();
        UI.showGameOver(winner, reason);
      },
    }, {
      config: { startCash: window.BT.Lobby.settings.startCash, rules: window.BT.Lobby.settings.rules },
    });

    UI.game = game;
    window.BT.game = game;
    UI.buildHandler = (tileId) => game.build(game.current, tileId);
    UI.sellHandler = (tileId) => game.sellHouse(game.current, tileId);
    defs.forEach((_, i) => pawnLayer.addPlayer(game.players[i], i));
    UI.sync(game);
    UI.log("dice", "#f4b73f", "Match started — good luck!");
  }

  /* ---------- online plumbing ---------- */

  function connectMP(mode, code, profile, settings) {
    const net = new NetClient();
    // Wire the controller BEFORE the request goes out — the relay broadcasts
    // room:state right after the ack, and a late-registered handler would
    // drop that first snapshot (stranding the player on the join pane).
    mp = new MPController({ net, dice, pawnLayer });
    window.BT.mp = mp;
    const p = mpPromise(net, mode, code, profile, settings);
    return p.then((res) => {
      mp.myId = res.token;
      window.BT.myPlayerId = res.token;
      window.BT.mpActive = true;
      UI.setRoomChip(res.code || code || "");
      UI.buildHandler = (tileId) => mp.clickBuild(tileId);
      UI.sellHandler = (tileId) => mp.clickSell(tileId);
      return res;
    });
  }

  /** Silent session resume after a page reload (lobby or mid-match). */
  function resumeSession() {
    const token = localStorage.getItem("bt_token");
    if (!token) return;
    const net = new NetClient();
    mp = new MPController({ net, dice, pawnLayer });
    mp.myId = token;
    window.BT.mp = mp;
    window.BT.myPlayerId = token;
    window.BT.mpActive = true;
    net.rejoin().then((res) => {
      UI.setRoomChip(net.code || "");
      UI.buildHandler = (tileId) => mp.clickBuild(tileId);
      UI.sellHandler = (tileId) => mp.clickSell(tileId);
      return res;
    }).catch(() => {
      // stale session — forget it quietly and stay on the menu
      net.leave();
      if (net.socket) net.socket.disconnect();
      mp = null;
      window.BT.mp = null;
      window.BT.myPlayerId = null;
      window.BT.mpActive = false;
      UI.setRoomChip(null);
    });
  }

  function mpPromise(net, mode, code, profile, settings) {
    return mode === "create"
      ? net.createRoom(profile, settings)
      : net.joinRoom(code, profile);
  }

  /* ---------- menu wiring ---------- */

  window.BT.Lobby.init({
    startLocal(defs) {
      if (mp) { try { mp.net.leave(); } catch (e) { /* ignore */ } mp = null; }
      startLocalGame(defs);
    },

    async createRoom(profile, settings) {
      await connectMP("create", null, profile, settings);
    },

    async joinRoom(code, profile) {
      await connectMP("join", code, profile, null);
    },

    setReady(ready) { mp && mp.net.setReady(ready); },
    setColor(hex) { mp && mp.net.setColor(hex); },
    setAvatar(i) { mp && mp.net.setAvatar(i); },
    sendSettings(s) { mp && mp.net.sendSettings(s); },
    startMatch() { mp && mp.net.startGame(); },

    leaveRoom() {
      if (mp) { try { mp.net.leave(); } catch (e) { /* ignore */ } mp = null; }
      UI.setRoomChip(null);
      window.BT.myPlayerId = null;
      window.BT.mpActive = false;
      window.BT.Lobby.openHome();
    },
  });

  /* ---------- action bar ---------- */

  $("#btn-roll").addEventListener("click", () => (mp ? mp.clickRoll() : game && game.roll()));
  $("#btn-end-turn").addEventListener("click", () => (mp ? mp.clickEndTurn() : game && game.endTurn()));
  $("#btn-build").addEventListener("click", () => {
    const g = mp ? mp.game : game;
    if (g) UI.openBuild(g);
  });
  $("#btn-trade").addEventListener("click", () => {
    if (mp) return mp.openTradeComposer();
    if (!game) return;
    // local hot-seat: both players are present — apply the trade directly
    UI.openTrade(game, game.current.id, {
      onSend: (trade) => {
        if (game.applyTrade({ ...trade, from: game.current.id })) window.BT.sfx.deal();
      },
    });
  });

  /* ---------- saved-session resume (page reload mid-lobby/match) ---------- */
  if (new NetClient().hasSession()) resumeSession();
})();
