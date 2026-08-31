/* ============================================================================
 * Balkan Tycoon â€” main.js
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
  UI.syncDock(); // the left column starts collapsed until there is something in it

  const dice = new DiceManager($("#dice-canvas"));
  const pawnLayer = new PawnLayer($("#board"), UI.tileEls);
  // exposed for console debugging, same as BT.game / BT.mp
  window.BT.dice = dice;
  window.BT.pawnLayer = pawnLayer;

  let game = null; // local-mode engine
  let mp = null;   // online-mode controller

  /* ---------- local game (hot-seat) ---------- */

  function startLocalGame(defs) {
    window.BT.myPlayerId = null; // no turn lock locally
    window.BT.mpActive = false;
    window.BT.Lobby.closeMenu();
    UI.setRoomChip(null);
    // local play has no presence / relay history to show
    UI.setPresence(new Map());
    UI.clearTrades();
    UI.showSessionLog(false);

    game = new Game(defs, {
      log: UI.log,
      stateChanged: () => UI.sync(game),

      /* Draw the numbers fairly, then animate them. Letting the physics decide
       * meant the spawn band, the velocity ranges and the cocked-die snap were
       * all quietly weighting the outcome â€” see randomDice() in dice3d.js. */
      rollDice: (cb) =>
        dice.roll((d1, d2, total) => {
          UI.showLastRoll(d1, d2);
          cb(d1, d2, total);
        }, window.BT.randomDice()),

      movePawn: async (player, from, steps, hooks) => {
        const pos = await pawnLayer.hopTo(player.id, from, steps, hooks);
        UI.flashTile(pos);
        return pos;
      },
      teleportPawn: (player, pos) => pawnLayer.placeAt(player.id, pos),
      removePawn: (player) => pawnLayer.removePlayer(player.id),
      setJailed: (player, jailed) => {
        pawnLayer.setJailed(player.id, jailed);
        if (jailed) window.BT.sfx.jail();
      },

      promptBuy: (player, tile, price) => UI.promptBuy(player, tile, price),
      boughtProperty: (player, tile) => {
        UI.muteNextCashSound(); // the purchase sound already covers the money
        UI.celebratePurchase(tile.id, player);
      },
      builtOn: (player, tile, level) => {
        UI.muteNextCashSound();
        if (level >= ECONOMY.maxHouses) window.BT.sfx.hotel();
        else window.BT.sfx.build();
      },
      soldOn: () => { UI.muteNextCashSound(); window.BT.sfx.sell(); },
      paidRent: (_payer, _owner, amount) => { UI.muteNextCashSound(); window.BT.sfx.rent(amount); },
      paidTax: (_player, amount) => { UI.muteNextCashSound(); window.BT.sfx.tax(amount); },
      bankrupted: () => window.BT.sfx.bankrupt(),
      // presence of this hook is what switches the engine from selling a
      // player's property for them to asking them to deal with it
      debtRaised: (player) => UI.openDebt(game, player),
      showCard: (card) => UI.showCard(card),
      auctionStep: (ctx) => UI.auctionStep(ctx),
      jailChoice: (player) => {
        UI.setStatusRaw(`<strong>${player.name}</strong> is in prisonâ€¦`);
        return UI.jailChoice(player);
      },
      gameOver: (winner, reason) => {
        window.BT.sfx.win();
        UI.showGameOver(winner, reason);
      },
    }, { config: window.BT.Lobby.settings });

    UI.game = game;
    window.BT.game = game;
    UI.buildHandler = (tileId) => game.build(game.current, tileId);
    UI.sellHandler = (tileId) => game.sellHouse(game.current, tileId);
    UI.mortgageHandler = (tileId) => game.mortgage(game.current, tileId);
    UI.unmortgageHandler = (tileId) => game.unmortgage(game.current, tileId);
    UI.sellFieldHandler = (tileId) => game.sellField(game.current, tileId);
    // resolve the debtor by id, never by a captured object: the settle prompt
    // outlives any single repaint and the roster can be rebuilt underneath it
    const debtor = () => game.player(UI._debtPlayerId) || game.current;
    UI.settleHandler = () => game.settleDebt(debtor());
    UI.bankruptHandler = () => game.declareBankrupt(debtor());
    defs.forEach((_, i) => pawnLayer.addPlayer(game.players[i], i));
    UI.sync(game);
    UI.log("dice", "#f4b73f", "Match started â€” good luck!");
  }

  /* ---------- online plumbing ---------- */

  function connectMP(mode, code, profile, settings) {
    const net = new NetClient();
    // Wire the controller BEFORE the request goes out â€” the relay broadcasts
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
      UI.settleHandler = () => mp.clickSettleDebt();
      UI.bankruptHandler = () => mp.clickDeclareBankrupt();
      UI.mortgageHandler = (tileId) => mp.clickMortgage(tileId);
      UI.unmortgageHandler = (tileId) => mp.clickUnmortgage(tileId);
      UI.sellFieldHandler = (tileId) => mp.clickSellField(tileId);
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
      UI.settleHandler = () => mp.clickSettleDebt();
      UI.bankruptHandler = () => mp.clickDeclareBankrupt();
      UI.mortgageHandler = (tileId) => mp.clickMortgage(tileId);
      UI.unmortgageHandler = (tileId) => mp.clickUnmortgage(tileId);
      UI.sellFieldHandler = (tileId) => mp.clickSellField(tileId);
      return res;
    }).catch(() => {
      // stale session â€” forget it quietly and stay on the menu
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
    setName(name) { mp && mp.net.setName(name); },
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

  const activeGame = () => (mp ? mp.game : game);

  /** Open the trade composer, optionally aimed at a specific player. */
  function openTrade(prefillTo) {
    if (mp) return mp.openTradeComposer(prefillTo || null);
    const g = game;
    if (!g) return;
    // local hot-seat: both sides are at the table, so apply it immediately
    UI.openTrade(g, g.current.id, {
      prefillTo: prefillTo && prefillTo !== g.current.id ? prefillTo : null,
      onSend: (trade) => {
        UI.muteNextCashSound(); // the deal chime covers the cash movement
        if (g.applyTrade({ ...trade, from: g.current.id })) window.BT.sfx.deal();
      },
    });
  }

  const endTurn = () => (mp ? mp.clickEndTurn() : game && game.endTurn());
  UI.endTurnHandler = endTurn;

  $("#btn-roll").addEventListener("click", () => (mp ? mp.clickRoll() : game && game.roll()));
  $("#btn-end-turn").addEventListener("click", () => {
    /* With a property offer open the engine is still mid-landing, so there is
     * nothing to end yet. Decline the plot and let UI.sync spend the intent the
     * moment the turn becomes endable â€” one click, not two. */
    if (UI.declineOffer(true)) return;
    endTurn();
  });
  $("#btn-trade").addEventListener("click", () => openTrade());
  $("#btn-rules").addEventListener("click", () => UI.showRules(activeGame()));

  /* ---------- input polish ---------- */

  /* One quiet tick for every real control, wired once at the document level so
   * new markup (trade cards, lobby swatches) gets it for free. */
  document.addEventListener("pointerdown", (e) => {
    const hit = e.target.closest("button, .path-card, .swatch, .style-opt, .trade-prop, .pl, summary");
    if (!hit || hit.disabled || hit.getAttribute("aria-disabled") === "true") return;
    window.BT.sfx.click();
  }, { passive: true });

  /* Hover a player in the ledger to light up everything they own. */
  const roster = $("#player-list");
  roster.addEventListener("pointerover", (e) => {
    const row = e.target.closest(".pl");
    UI.spotlightPlayer(row ? row.dataset.playerId : null);
  });
  roster.addEventListener("pointerleave", () => UI.spotlightPlayer(null));
  // keyboard parity: tabbing through the roster lights the same thing
  roster.addEventListener("focusin", (e) => {
    const row = e.target.closest(".pl");
    if (row) UI.spotlightPlayer(row.dataset.playerId);
  });
  roster.addEventListener("focusout", () => UI.spotlightPlayer(null));

  /* Click a player in the ledger to open a trade aimed at them. */
  $("#player-list").addEventListener("click", (e) => {
    const row = e.target.closest(".pl");
    const g = activeGame();
    if (!row || !g || g.phase === "over") return;
    const id = row.dataset.playerId;
    const me = window.BT.myPlayerId;
    if (!id || (me && id === me) || $("#btn-trade").disabled) return;
    const target = g.player(id);
    if (!target || target.bankrupt) return;
    openTrade(id);
  });

  /* Keyboard: R roll, E end turn, T trade. Modals handle their own
   * Enter/Escape (see ui.js), and anything typed in a field is left alone. */
  const KEYS = { r: "#btn-roll", e: "#btn-end-turn", t: "#btn-trade" };

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (!$("#screen-menu").hidden) return; // pre-game menu owns the keyboard
    if ([...document.querySelectorAll(".modal-overlay")].some((m) => !m.hidden)) return;

    let sel = KEYS[e.key.toLowerCase()];
    // space rolls too, unless a button already has focus and will handle it
    if (!sel && e.key === " " && !(el && el.tagName === "BUTTON")) sel = "#btn-roll";
    if (!sel) return;
    const btn = $(sel);
    if (!btn || btn.disabled) return;
    e.preventDefault();
    btn.click();
  });

  /* ---------- invite links ----------
   * A room code you have to read out loud and have someone type in is one step
   * too many. ?room=CODE drops a guest straight onto the join pane with the code
   * filled in, and joins as soon as they have a nickname.
   */
  function inviteCode() {
    try {
      const raw = new URLSearchParams(location.search).get("room");
      const code = String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      return code.length === 5 ? code : null;
    } catch (e) { return null; }
  }

  /** Strip ?room= once it has been used, so a reload does not re-trigger it. */
  function clearInviteParam() {
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
  }

  /* ---------- saved-session resume (page reload mid-lobby/match) ---------- */
  const invited = inviteCode();
  if (new NetClient().hasSession()) {
    resumeSession();
    if (invited) clearInviteParam();
  } else if (invited) {
    window.BT.Lobby.openJoin(invited);
    clearInviteParam();
  }
})();
