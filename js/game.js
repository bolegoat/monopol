/* ============================================================================
 * Balkan Tycoon — game.js
 * Hot-seat game engine: turn flow, economy, rent, cards, jail, building and
 * bankruptcy. Rendering/IO is delegated to injected hooks so the engine
 * stays UI-agnostic (ui.js wires it to the DOM, dice and pawn layer).
 * ========================================================================== */

"use strict";

(function () {
  const JAIL_POS = 10;
  const START_POS = 0;

  const fmt = (n) => `€${n}`;

  /* ---------- Card decks (data + effects live in cards.js) ---------- */

  const SURPRISE_CARDS = window.BT.CARDS.SURPRISE;
  const EVENT_CARDS = window.BT.CARDS.EVENT;

  /* Default match configuration (overridable from the lobby). Every number the
   * economy leans on is here rather than baked into ECONOMY, so a table can
   * agree its own house rules and the engine reads them from one place. */
  const DEFAULT_CONFIG = {
    startCash: ECONOMY.startCash,
    goReward: ECONOMY.goReward,
    jailFee: ECONOMY.jailFee,
    maxRounds: 60,           // 0 = play until one tycoon is left standing
    rules: {
      doubleRent: true,      // full color set doubles undeveloped base rent
      kafanaJackpot: false,  // taxes & fines pile up in the kafana pot
      auctions: false,       // declined properties go to public bidding
      mortgages: true,       // deeds can be mortgaged to raise cash
      evenBuild: true,       // houses must go up evenly across a country
      rentInJail: true,      // a jailed owner still collects rent
      buildAnytime: true,    // build / mortgage outside your own turn
    },
  };

  const numOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /* ---------- Game ---------- */

  class Game {
    /**
     * @param {{name:string, icon:string, color:string, tokenStyle?:number}[]} playerDefs
     * @param {object} hooks UI/IO hooks:
     *   log(icon, color, text)
     *   stateChanged()
     *   movePawn(player, fromPos, steps, {onPassGo}) -> Promise<finalPos>
     *   teleportPawn(player, pos)
     *   promptBuy(player, tile, price) -> Promise<boolean>
     *   boughtProperty(player, tile)          purchase confirmed (fx + sfx)
     *   builtOn(player, tile, level)          house/hotel raised (fx + sfx)
     *   soldOn(player, tile)                  house sold back
     *   paidRent(payer, owner, amount, tile)  rent about to change hands
     *   paidTax(player, amount, tile)         tax/fine to the bank
     *   bankrupted(player, creditor|null)     knocked out
     *   showCard(cardView) -> Promise<choiceId|void>
     *   jailChoice(player) -> Promise<"roll"|"pay"|"card">
     *   auctionStep(ctx) -> Promise<{bid:number}|{pass:true}>
     *   gameOver(winner, reason)
     * @param {object} opts { silent?:boolean, config?:{startCash,rules} }
     */
    constructor(playerDefs, hooks, opts = {}) {
      this.config = Game.normalizeConfig(opts.config);
      this.rules = this.config.rules;
      this.kafanaPot = 0;
      this.hooks = hooks;
      this.players = playerDefs.map((d, i) => ({
        id: `p${i + 1}`,
        seat: i,
        name: d.name,
        icon: d.icon,
        color: d.color,
        tokenStyle: Number.isFinite(d.tokenStyle) ? d.tokenStyle : null,
        cash: this.config.startCash,
        position: START_POS,
        inJail: false,
        jailTurns: 0,
        // flat fields, not an object: players are shallow-copied into snapshots
        debtAmount: 0,
        debtTo: null,
        getOutCards: 0,
        skipTurns: 0,
        bankrupt: false,
      }));
      this.props = {};
      for (const t of TILES) {
        if (t.kind === "city" || t.kind === "airport" || t.kind === "utility") {
          this.props[t.id] = { owner: null, houses: 0, mortgaged: false };
        }
      }
      this.turnIdx = 0;
      this.round = 1;
      this.phase = "awaiting-roll"; // awaiting-roll | awaiting-jail-roll | busy | turn-end | over
      this.doublesCount = 0;
      this.lastDice = null; // [d1, d2]
      this.surpriseDeck = shuffle(SURPRISE_CARDS.map((_, i) => i));
      this.eventDeck = shuffle(EVENT_CARDS.map((_, i) => i));
      if (!opts.silent) this._log("🎲", "#ece9f5", `Game started — ${this.current.name} rolls first.`);
    }

    /** Clamp any lobby/relay settings payload into a complete config. */
    static normalizeConfig(cfg) {
      const c = cfg || {};
      return {
        startCash: Number(c.startCash) > 0 ? Number(c.startCash) : DEFAULT_CONFIG.startCash,
        goReward: Math.max(0, numOr(c.goReward, DEFAULT_CONFIG.goReward)),
        jailFee: Math.max(0, numOr(c.jailFee, DEFAULT_CONFIG.jailFee)),
        maxRounds: Math.max(0, numOr(c.maxRounds, DEFAULT_CONFIG.maxRounds)),
        rules: Object.assign({}, DEFAULT_CONFIG.rules, c.rules || {}),
      };
    }

    /* ---------- accessors ---------- */

    get current() { return this.players[this.turnIdx]; }
    get goReward() { return this.config.goReward; }
    get jailFee() { return this.config.jailFee; }
    player(id) { return this.players.find((p) => p.id === id); }
    alive() { return this.players.filter((p) => !p.bankrupt); }

    ownsGroup(player, countryId) {
      return COUNTRY_GROUPS[countryId].every((id) => this.props[id].owner === player.id);
    }

    ownedTiles(player) {
      return TILES.filter((t) => this.props[t.id] && this.props[t.id].owner === player.id);
    }

    netWorth(p) {
      let total = p.cash;
      for (const t of this.ownedTiles(p)) {
        const ps = this.props[t.id];
        total += t.price || 0;
        total += (ps.houses || 0) * (t.houseCost || 0);
        // a mortgaged deed is worth its price minus the loan still outstanding
        if (ps.mortgaged) total -= Math.round((t.price || 0) * ECONOMY.mortgageRate);
      }
      return total;
    }

    /* ---------- mortgages ----------
     * A mortgage raises half the tile price now against the deed. The plot stays
     * yours but earns nothing until you buy it back, which costs the loan plus
     * interest — so it is a way to survive a bad turn, not free money.
     * Houses must come off first: you cannot borrow against a developed plot. */

    canMortgage(player, tile) {
      if (!this.rules.mortgages) return false;
      const ps = this.props[tile.id];
      return Boolean(ps) && ps.owner === player.id && !ps.mortgaged && (ps.houses || 0) === 0;
    }

    /** What buying the deed back costs right now. */
    unmortgageCost(tile) {
      return Math.round(tile.price * ECONOMY.mortgageRate * (1 + ECONOMY.unmortgageInterest));
    }

    canUnmortgage(player, tile) {
      if (!this.rules.mortgages) return false;
      const ps = this.props[tile.id];
      if (!ps || ps.owner !== player.id || !ps.mortgaged) return false;
      return player.cash >= this.unmortgageCost(tile);
    }

    mortgage(player, tileId) {
      const tile = tileById(tileId);
      if (!this.canMortgage(player, tile)) return false;
      const raised = Math.round(tile.price * ECONOMY.mortgageRate);
      this.props[tile.id].mortgaged = true;
      player.cash += raised;
      this._log("🏦", "#f59e0b", `${player.name} mortgaged ${tile.name} for ${fmt(raised)}`);
      if (this.hooks.mortgaged) this.hooks.mortgaged(player, tile, raised);
      this._changed();
      return true;
    }

    unmortgage(player, tileId) {
      const tile = tileById(tileId);
      if (!this.canUnmortgage(player, tile)) return false;
      const cost = this.unmortgageCost(tile);
      this.props[tile.id].mortgaged = false;
      player.cash -= cost;
      this._log("🔑", "#22c55e", `${player.name} cleared the mortgage on ${tile.name} for ${fmt(cost)}`);
      if (this.hooks.unmortgaged) this.hooks.unmortgaged(player, tile, cost);
      this._changed();
      return true;
    }

    /* Selling a deed back to the bank at half price. Mortgaged plots are
     * excluded because their value has already been drawn down; clear the
     * mortgage first, or let bankruptcy hand them over. */
    canSellField(player, tile) {
      const ps = this.props[tile.id];
      return Boolean(ps) && ps.owner === player.id && (ps.houses || 0) === 0 && !ps.mortgaged;
    }

    sellField(player, tileId) {
      const tile = tileById(tileId);
      if (!this.canSellField(player, tile)) return false;
      const paid = Math.round(tile.price * ECONOMY.sellRate);
      this.props[tile.id].owner = null;
      player.cash += paid;
      this._log("🏦", "#f59e0b", `${player.name} sold ${tile.name} back to the bank for ${fmt(paid)}`);
      if (this.hooks.soldField) this.hooks.soldField(player, tile, paid);
      this._changed();
      return true;
    }

    /** Tiles `player` could still raise cash against, dearest first. */
    mortgageable(player) {
      return this.ownedTiles(player)
        .filter((t) => this.canMortgage(player, t))
        .sort((a, b) => b.price - a.price);
    }

    rentFor(tile) {
      const ps = this.props[tile.id];
      if (!ps || !ps.owner) return 0;
      if (ps.mortgaged) return 0; // a mortgaged plot collects nothing
      const holder = this.player(ps.owner);
      if (!holder || holder.bankrupt) return 0;
      // house rule: a landlord doing time can be barred from collecting
      if (holder.inJail && !this.rules.rentInJail) return 0;
      if (tile.kind === "airport") {
        const count = TILES.filter(
          (t) => t.kind === "airport" && this.props[t.id].owner === ps.owner,
        ).length;
        return ECONOMY.airportRent[Math.min(count, 4) - 1];
      }
      if (tile.kind === "utility") {
        const count = TILES.filter(
          (t) => t.kind === "utility" && this.props[t.id].owner === ps.owner,
        ).length;
        const diceTotal = this.lastDice ? this.lastDice[0] + this.lastDice[1] : 7;
        return ECONOMY.utilityMultipliers[Math.min(count, 2) - 1] * diceTotal;
      }
      const owner = this.player(ps.owner);
      if (ps.houses > 0) return tile.baseRent * ECONOMY.houseMultipliers[ps.houses];
      const monopolyBonus = this.rules.doubleRent && this.ownsGroup(owner, tile.country)
        ? ECONOMY.monopolyMultiplier : 1;
      return tile.baseRent * monopolyBonus;
    }

    buildableGroups(player) {
      return Object.keys(COUNTRIES).filter((cid) =>
        this.ownsGroup(player, cid)
        // a country with a mortgaged deed is owned but frozen, so it must not
        // be offered in the build list where nothing in it can be built
        && !COUNTRY_GROUPS[cid].some((id) => this.props[id].mortgaged));
    }

    canBuildOn(player, tile) {
      if (tile.kind !== "city" || !this.ownsGroup(player, tile.country)) return false;
      // nothing gets built in a country while any of its deeds is mortgaged
      if (COUNTRY_GROUPS[tile.country].some((id) => this.props[id].mortgaged)) return false;
      const ps = this.props[tile.id];
      if (ps.houses >= ECONOMY.maxHouses) return false;
      if (player.cash < tile.houseCost) return false;
      if (!this.rules.evenBuild) return true;
      const levels = COUNTRY_GROUPS[tile.country].map((id) => this.props[id].houses);
      return ps.houses === Math.min(...levels); // even-build rule
    }

    canSellOn(player, tile) {
      if (tile.kind !== "city") return false;
      const ps = this.props[tile.id];
      if (!ps || ps.owner !== player.id || ps.houses <= 0) return false;
      if (!this.rules.evenBuild) return true;
      const levels = COUNTRY_GROUPS[tile.country].map((id) => this.props[id].houses);
      return ps.houses === Math.max(...levels); // sell from the most built first
    }

    /* ---------- logging / state ---------- */

    _log(icon, color, text) { this.hooks.log(icon, color, text); }
    _changed() { this.hooks.stateChanged(); }

    /* ---------- money ---------- */

    /** Force-sell houses, then properties, until `p` can cover `amount`. */
    _liquidate(p, amount) {
      const sellables = () =>
        TILES.filter((t) => t.kind === "city" && this.props[t.id].owner === p.id && this.props[t.id].houses > 0);
      while (p.cash < amount && sellables().length) {
        const t = sellables().sort((a, b) => b.houseCost - a.houseCost)[0];
        this.props[t.id].houses -= 1;
        p.cash += Math.round(t.houseCost * ECONOMY.sellRate);
        this._log("🏚️", "#f59e0b", `${p.name} sold a house on ${t.name}`);
      }
      // mortgage before selling: a mortgage is recoverable, a sale is not, and
      // both raise the same 50%, so there is never a reason to sell first
      while (p.cash < amount) {
        const t = this.mortgageable(p)[0];
        if (!t) break;
        this.mortgage(p, t.id);
      }

      // last resort: hand deeds back to the bank. Already-mortgaged plots are
      // skipped because their value has been drawn down once already.
      const sellProps = () => TILES.filter((t) => {
        const ps = this.props[t.id];
        return ps && ps.owner === p.id && ps.houses === 0 && !ps.mortgaged;
      });
      while (p.cash < amount && sellProps().length) {
        const t = sellProps().sort((a, b) => b.price - a.price)[0];
        this.props[t.id].owner = null;
        p.cash += Math.round(t.price * ECONOMY.sellRate);
        this._log("🏦", "#f59e0b", `${p.name} sold ${t.name} back to the bank`);
      }
    }

    _bankrupt(p, creditor) {
      p.bankrupt = true;
      p.debtAmount = 0;
      p.debtTo = null;
      this._log("💀", "#ef4444", `${p.name} is bankrupt!`);
      if (this.hooks.bankrupted) this.hooks.bankrupted(p, creditor || null);

      /* Everything they still hold goes to whoever bankrupted them — cash
       * included. Handing over the deeds but quietly deleting the cash left in
       * hand loses money that should have changed hands, which is exactly the
       * kind of silent shortfall that reads as "he didn't pay me". */
      const purse = Math.max(0, Math.round(p.cash));
      p.cash = 0;
      if (purse > 0) {
        if (creditor && !creditor.bankrupt) {
          creditor.cash += purse;
          this._log("💵", "#f59e0b",
            `${creditor.name} took ${fmt(purse)} from ${p.name}'s estate`);
        } else {
          this._creditPayment(purse, null);
        }
      }

      const taken = [];
      for (const t of TILES) {
        const ps = this.props[t.id];
        if (ps && ps.owner === p.id) {
          ps.owner = creditor ? creditor.id : null;
          ps.houses = 0;
          // debts follow the deed to the creditor; the bank clears them
          if (!creditor) ps.mortgaged = false;
          taken.push(t.name);
        }
      }
      if (taken.length) {
        this._log("🏦", "#f59e0b", creditor
          ? `${creditor.name} inherited ${taken.length} ${taken.length === 1 ? "deed" : "deeds"} from ${p.name}`
          : `${taken.length} ${taken.length === 1 ? "deed" : "deeds"} returned to the bank`);
      }
      this.hooks.teleportPawn(p, p.position); // refresh pawn (bankrupt styling)
      this.hooks.removePawn && this.hooks.removePawn(p);
      if (this.alive().length === 1) this._endGame(this.alive()[0], "last tycoon standing");
    }

    /** Route a payment to its recipient, or to the bank / kafana pot. */
    _creditPayment(paid, to) {
      if (paid <= 0) return;
      if (to && !to.bankrupt) { to.cash += paid; return; }
      if (to) return; // creditor already out: the money dies with the estate
      if (this.rules.kafanaJackpot && this.phase !== "over") {
        // Say so out loud. Money leaving a player for the pot and reappearing
        // in someone else's balance turns later reads like cash materialising
        // out of nowhere, which is indistinguishable from a bug unless the pot
        // is visible in the log.
        this.kafanaPot += paid;
        this._log("coffee", "#f4b73f",
          `${fmt(paid)} went into the kafana pot (now ${fmt(this.kafanaPot)})`);
      }
    }

    /**
     * Take `amount` off `from`.
     *
     * When they cannot cover it the shortfall becomes a DEBT they clear
     * themselves. The engine never sells their houses, mortgages their deeds or
     * declares them bankrupt on their behalf — play stops in the `settling`
     * phase until they either pay or concede. That is the whole point: a bad
     * turn is a decision, not an automatic sell-off.
     *
     * The automatic path survives only for headless use (no `debtRaised` hook),
     * because without a prompt on the other end a match would sit forever
     * waiting for an answer that never comes.
     */
    _pay(from, amount, to) {
      amount = Math.max(0, Math.round(amount));
      if (amount <= 0 || from.bankrupt) return;

      if (from.cash >= amount) {
        from.cash -= amount;
        this._creditPayment(amount, to);
        // stream the movement immediately: a balance that only updates when the
        // turn ends looks exactly like a payment that never happened
        this._changed();
        return;
      }

      if (!this.hooks.debtRaised) {
        // headless fallback only
        this._liquidate(from, amount);
        const paid = Math.min(from.cash, amount);
        from.cash -= paid;
        this._creditPayment(paid, to);
        if (paid < amount) this._bankrupt(from, to || null);
        this._changed();
        return;
      }

      const paid = from.cash;
      from.cash = 0;
      this._creditPayment(paid, to);
      const owed = amount - paid;
      /* A second shortfall in the same turn (a card that fines you while you
       * already owe rent) has to stack rather than replace, or the first debt
       * silently evaporates. Different creditors are folded into the bank,
       * which is the only party that can always be paid. */
      if (from.debtAmount > 0) {
        const sameCreditor = (from.debtTo || null) === (to ? to.id : null);
        from.debtAmount += owed;
        if (!sameCreditor) from.debtTo = null;
      } else {
        from.debtAmount = owed;
        from.debtTo = to ? to.id : null;
      }
      this.phase = "settling";
      this._log("⚠️", "#ef4444",
        `${from.name} is ${fmt(owed)} short${to ? " paying " + to.name : ""} and must raise it`);
      this._changed();
      this.hooks.debtRaised(from, from.debtAmount, to || null);
    }

    /* ---------- settling a debt by hand ---------- */

    debtOf(p) {
      return p && p.debtAmount > 0
        ? { amount: p.debtAmount, to: p.debtTo ? this.player(p.debtTo) : null }
        : null;
    }

    /** Everything they could still turn into cash, for the settle prompt. */
    raisableCash(p) {
      let total = 0;
      for (const t of this.ownedTiles(p)) {
        const ps = this.props[t.id];
        total += (ps.houses || 0) * Math.round(t.houseCost * ECONOMY.sellRate);
        if (!ps.mortgaged) {
          total += this.rules.mortgages
            ? Math.round(t.price * ECONOMY.mortgageRate)
            : Math.round(t.price * ECONOMY.sellRate);
        }
      }
      return total;
    }

    canSettle(p) {
      return Boolean(p && p.debtAmount > 0 && p.cash >= p.debtAmount);
    }

    settleDebt(p) {
      if (!this.canSettle(p)) return false;
      const owed = p.debtAmount;
      const to = p.debtTo ? this.player(p.debtTo) : null;
      p.cash -= owed;
      p.debtAmount = 0;
      p.debtTo = null;
      this._creditPayment(owed, to);
      this._log("💵", "#22c55e", `${p.name} settled ${fmt(owed)}${to ? " with " + to.name : ""}`);
      if (this.phase === "settling") this.phase = "turn-end";
      this._changed();
      return true;
    }

    /**
     * Last resort for an online match: the debtor has stopped responding, so
     * fall back to the old automatic behaviour rather than leaving everyone
     * else stuck behind them. Never reached in normal play — the host arms this
     * on a timer and cancels it the moment the debt is settled by hand.
     */
    forceSettle(p) {
      if (!p || !p.debtAmount) return false;
      const owed = p.debtAmount;
      this._liquidate(p, owed);
      if (p.cash >= owed) return this.settleDebt(p);
      const to = p.debtTo ? this.player(p.debtTo) : null;
      if (p.cash > 0) { this._creditPayment(p.cash, to); p.cash = 0; }
      return this.declareBankrupt(p);
    }

    /** The player's own call, never the engine's. Only while actually in debt,
     * so a misclick can never knock somebody out of a healthy game. */
    declareBankrupt(p) {
      if (!p || p.bankrupt || !(p.debtAmount > 0)) return false;
      const to = p.debtTo ? this.player(p.debtTo) : null;
      p.debtAmount = 0;
      p.debtTo = null;
      if (this.phase === "settling") this.phase = "turn-end";
      this._bankrupt(p, to);
      this._changed();
      return true;
    }

    /* ---------- movement ---------- */

    async _movePawn(p, steps, collectGo) {
      const from = p.position;
      const finalPos = await this.hooks.movePawn(p, from, steps, {
        onPassGo: () => {
          if (!collectGo || !this.goReward) return;
          p.cash += this.goReward;
          this._log("🏁", "#22c55e", `${p.name} passed START and collected ${fmt(this.goReward)}`);
          this._changed();
        },
      });
      p.position = finalPos;
      /* Publish the landing tile. Without this the only snapshot covering a move
       * was whatever went out mid-hop (from passing START), which still described
       * the tile the pawn had left — so a guest's roster and its pawn disagreed
       * until something unrelated happened to broadcast again. */
      this._changed();
    }

    async _sendToJail(p) {
      p.inJail = true;
      p.jailTurns = 0;
      this.doublesCount = 0;
      p.position = JAIL_POS;
      this.hooks.teleportPawn(p, JAIL_POS);
      // move the pawn into the cell (and slam the door) rather than leaving it
      // standing in the visiting yard
      if (this.hooks.setJailed) this.hooks.setJailed(p, true);
      this._log("🚨", "#ef4444", `${p.name} was sent to prison`);
    }

    /* ---------- landing resolution ---------- */

    async _resolveLanding(p, depth = 0) {
      if (p.bankrupt || depth > 3) return;
      const tile = TILES[p.position];

      switch (tile.kind) {
        case "city":
        case "airport":
        case "utility": {
          const ps = this.props[tile.id];
          if (!ps.owner) {
            /* Always offer it, even when the cash is not there yet. It used to
             * skip straight past with a "can't afford" line, which robbed the
             * player of the chance to mortgage or sell something and then buy —
             * the whole point of holding property. The prompt stays open while
             * they raise the money and only refuses the purchase if they still
             * cannot cover it when they commit. */
            {
              this._changed();
              // movement is already parked here: the pawn stops on the tile and
              // nothing advances until this prompt resolves
              const wants = await this.hooks.promptBuy(p, tile, tile.price);
              if (wants && p.cash >= tile.price) {
                this._buy(p, tile);
              } else if (wants) {
                this._log("😅", "#f59e0b",
                  `${p.name} could not cover ${tile.name} (${fmt(tile.price)})`);
              } else if (this.rules.auctions && this.alive().length > 1) {
                this._log("ban", "#f59e0b", `${p.name} passed — ${tile.name} goes to auction`);
                await this._runAuction(p, tile);
              } else {
                this._log("ban", "#f59e0b", `${p.name} skipped ${tile.name}`);
                await wait(500); // brief beat before play resumes
              }
            }
          } else if (ps.owner === p.id) {
            this._log("🏠", "#22c55e", `${p.name} is home at ${tile.name}`);
          } else {
            const owner = this.player(ps.owner);
            const rent = this.rentFor(tile);
            if (owner.bankrupt) {
              this._log("ban", "#8b98a8", `${tile.name} has no landlord — ${p.name} stays for free`);
            } else if (rent <= 0) {
              // say WHY it was free, or a mortgaged plot reads as a missed payment
              this._log("banknote", "#f59e0b", ps.mortgaged
                ? `${tile.name} is mortgaged — ${owner.name} collects nothing from ${p.name}`
                : `${owner.name} is in prison and collects no rent on ${tile.name}`);
            } else {
              this._log("💰", "#ef4444",
                `${p.name} owes ${owner.name} ${fmt(rent)} rent for ${tile.name}`);
              if (this.hooks.paidRent) this.hooks.paidRent(p, owner, rent, tile);
              this._pay(p, rent, owner);
            }
          }
          break;
        }
        case "tax":
          this._log("shield", "#ef4444", `${p.name} owes ${fmt(tile.amount)} at the ${tile.name}`);
          if (this.hooks.paidTax) this.hooks.paidTax(p, tile.amount, tile);
          this._pay(p, tile.amount, null);
          break;
        case "surprise":
          await this._drawCard(p, "surprise");
          break;
        case "event":
          await this._drawCard(p, "event");
          break;
        case "corner":
          if (tile.corner === "go-to-jail") await this._sendToJail(p);
          else if (tile.corner === "kafana") {
            if (this.rules.kafanaJackpot && this.kafanaPot > 0) {
              const pot = this.kafanaPot;
              this.kafanaPot = 0;
              p.cash += pot;
              this._log("coffee", "#f4b73f", `${p.name} landed in the kafana and pockets the ${fmt(pot)} pot`);
              this._changed();
            } else if (this.rules.kafanaJackpot) {
              this._log("coffee", "#f4b73f", `${p.name} is chilling in the kafana — the pot is empty`);
            } else {
              this._log("coffee", "#f4b73f", `${p.name} is chilling in the kafana`);
            }
          }
          else if (tile.corner === "jail")
            this._log("eye", "#8b98a8", `${p.name} is just visiting the prison`);
          break;
      }
    }

    /** JSON-safe modal view of a card; dynamic choice labels resolved here. */
    _cardView(card) {
      const choices = card.choicesFn
        ? card.choicesFn(this, this.current)
        : card.choices || null;
      return {
        key: card.key,
        title: card.title,
        text: card.text,
        tint: card.tint || "#b48cf2",
        choices: choices ? choices.map((c) => ({ id: c.id, label: c.label, disabled: Boolean(c.disabled) })) : null,
      };
    }

    async _drawCard(p, deck) {
      const deckArr = deck === "surprise" ? this.surpriseDeck : this.eventDeck;
      const cards = deck === "surprise" ? SURPRISE_CARDS : EVENT_CARDS;
      const idx = deckArr.shift();
      deckArr.push(idx);
      const card = cards[idx];
      this._log(card.key, "#c084fc", `${p.name} drew “${card.title}”`);
      const view = this._cardView(card);
      view.forId = p.id;
      view.deckLabel = deck === "surprise" ? "Balkan Surprise" : "Kafana Event";
      const choice = await this.hooks.showCard(view);
      if (!p.bankrupt) await card.apply(this, p, choice); // some cards move the pawn & re-resolve
    }

    /* ---------- auctions (house rule) ---------- */

    /**
     * Public bidding for an unowned tile. Each alive player in turn either
     * raises or passes; the last non-passed player wins at the current high
     * bid. If nobody ever bids the property stays with the bank.
     */
    async _runAuction(initiator, tile) {
      const parts = this.alive();
      const MIN_INCREMENT = 10;
      let highBidder = null;
      let highBid = 0;
      const passed = new Set();
      let turnIdx = parts.findIndex((x) => x.id === initiator.id);
      let guard = parts.length * 40 + 10;

      while (guard-- > 0) {
        const active = parts.filter((pl) => !passed.has(pl.id));
        if (!active.length) break;
        if (highBidder && active.length === 1) break; // winner takes current bid

        turnIdx = (turnIdx + 1) % parts.length;
        const pl = parts[turnIdx];
        if (passed.has(pl.id)) continue;

        const ctx = {
          tile: { id: tile.id, name: tile.name, kind: tile.kind, country: tile.country, price: tile.price },
          highBid,
          highBidderName: highBidder ? this.player(highBidder).name : null,
          minBid: highBid + MIN_INCREMENT,
          player: { id: pl.id, name: pl.name, cash: pl.cash },
          canRaise: pl.cash >= highBid + MIN_INCREMENT,
        };
        const ans = await this.hooks.auctionStep(ctx);
        const bid = ans && Number(ans.bid);
        if (Number.isFinite(bid) && bid >= ctx.minBid && bid <= pl.cash) {
          highBid = Math.floor(bid);
          highBidder = pl.id;
          this._log("banknote", "#f4b73f", `${pl.name} bids ${fmt(highBid)} for ${tile.name}`);
        } else {
          passed.add(pl.id);
          if (ans && Number.isFinite(bid)) {
            this._log("ban", "#f59e0b", `${pl.name}'s bid was out of range — counted as a pass`);
          }
        }
      }

      if (highBidder) {
        const w = this.player(highBidder);
        w.cash -= highBid;
        this.props[tile.id].owner = w.id;
        this.props[tile.id].houses = 0;
        this._log("crown", "#22c55e", `${w.name} won ${tile.name} at auction for ${fmt(highBid)}`);
        if (tile.kind === "city" && this.ownsGroup(w, tile.country)) {
          this._log("crown", "#f4b73f", `${w.name} now owns all of ${COUNTRIES[tile.country].name}!`);
        }
      } else {
        this._log("ban", "#8b98a8", `No bids — ${tile.name} stays with the bank`);
      }
      this._changed();
    }

    _buy(p, tile) {
      if (p.cash < tile.price) return false; // never let a purchase go on credit
      p.cash -= tile.price;
      this.props[tile.id].owner = p.id;
      this.props[tile.id].houses = 0;
      this.props[tile.id].mortgaged = false;
      this._log("🏙️", "#3b82f6",
        `${p.name} bought ${tile.name} for ${fmt(tile.price)} — ${fmt(p.cash)} left`);
      if (this.hooks.boughtProperty) this.hooks.boughtProperty(p, tile);
      if (tile.kind === "city" && this.ownsGroup(p, tile.country)) {
        this._log("👑", "#f4b73f", `${p.name} now owns all of ${COUNTRIES[tile.country].name}!`);
      }
      this._changed(); // the price leaving their balance is news, not bookkeeping
      return true;
    }

    /* ---------- building ---------- */

    build(p, tileId) {
      const tile = tileById(tileId);
      if (!this.canBuildOn(p, tile)) return false;
      p.cash -= tile.houseCost;
      this.props[tile.id].houses += 1;
      const n = this.props[tile.id].houses;
      this._log(n >= 4 ? "🏨" : "🏠", "#22c55e",
        `${p.name} built ${n >= 4 ? "a HOTEL" : `house #${n}`} on ${tile.name}`);
      if (this.hooks.builtOn) this.hooks.builtOn(p, tile, n);
      this._changed();
      return true;
    }

    sellHouse(p, tileId) {
      const tile = tileById(tileId);
      if (!this.canSellOn(p, tile)) return false;
      this.props[tile.id].houses -= 1;
      p.cash += Math.round(tile.houseCost * ECONOMY.sellRate);
      this._log("📉", "#f59e0b", `${p.name} sold a house on ${tile.name}`);
      if (this.hooks.soldOn) this.hooks.soldOn(p, tile);
      this._changed();
      return true;
    }

    /* ---------- turn flow ---------- */

    /** UI entry: ROLL button. Routes to normal or jail roll depending on phase. */
    roll() {
      if (this.phase === "awaiting-roll") this._rollNormal();
      else if (this.phase === "awaiting-jail-roll") this._rollJail();
    }

    _rollNormal() {
      const p = this.current;
      this.phase = "busy";
      this._changed();
      this.hooks.rollDice(async (d1, d2, total) => {
        this.lastDice = [d1, d2];
        const doubles = d1 === d2;
        this._log("🎲", "#ece9f5", `${p.name} rolled ${d1} + ${d2} = ${total}${doubles ? " (doubles!)" : ""}`);

        if (doubles) {
          this.doublesCount += 1;
          if (this.doublesCount >= 3) {
            this._log("🚔", "#ef4444", `Three doubles in a row — the police were watching`);
            await this._sendToJail(p);
            this._finishTurn();
            return;
          }
        } else {
          this.doublesCount = 0;
        }

        await this._movePawn(p, total, true);
        await this._resolveLanding(p);

        if (!p.bankrupt && !p.inJail && doubles) {
          this.phase = "awaiting-roll"; // doubles roll again
          this._log("🔁", "#f4b73f", `${p.name} rolls again (doubles)`);
        } else {
          this._finishTurn();
        }
        this._changed();
      });
    }

    _rollJail() {
      const p = this.current;
      this.phase = "busy";
      this._changed();
      this.hooks.rollDice(async (d1, d2, total) => {
        this.lastDice = [d1, d2];
        const doubles = d1 === d2;
        this._log("🎲", "#ece9f5", `${p.name} rolled ${d1} + ${d2} in prison`);

        if (doubles) {
          p.inJail = false;
          p.jailTurns = 0;
          this._log("🔓", "#22c55e", `Doubles! ${p.name} walks free`);
          this.hooks.setJailed && this.hooks.setJailed(p, false);
          await this._movePawn(p, total, true);
          await this._resolveLanding(p);
        } else {
          p.jailTurns += 1;
          if (p.jailTurns >= 3) {
            this._log("💵", "#ef4444", `Third failed attempt — ${p.name} pays ${fmt(this.jailFee)} bail`);
            this._pay(p, this.jailFee, null);
            if (!p.bankrupt) {
              p.inJail = false;
              this.hooks.setJailed && this.hooks.setJailed(p, false);
              await this._movePawn(p, total, true);
              await this._resolveLanding(p);
            }
          } else {
            this._log("⛓️", "#f59e0b", `${p.name} stays in prison (${p.jailTurns}/3 attempts)`);
          }
        }
        this._finishTurn();
        this._changed();
      });
    }

    _finishTurn() {
      // a debt raised during this turn's landing must not be papered over
      if (this.phase === "settling") { this._changed(); return; }
      if (this.phase !== "over") this.phase = "turn-end";
      this._changed();
    }

    /** UI entry: END TURN button. */
    async endTurn() {
      if (this.phase !== "turn-end") return;
      this.doublesCount = 0;

      // advance to the next non-bankrupt player, consuming any skipped turns
      const n = this.players.length;
      for (let i = 1; i <= n * 2; i++) {
        const idx = (this.turnIdx + i) % n;
        if (this.players[idx].bankrupt) continue;
        if (idx <= this.turnIdx) this.round += 1;
        this.turnIdx = idx;
        if (this.players[idx].skipTurns > 0) {
          const skipped = this.players[idx];
          skipped.skipTurns -= 1;
          this._log("clock", "#f59e0b", `${skipped.name} forfeits this turn`);
          if (i >= n * 2 - 1) break;
          continue;
        }
        break;
      }

      if (this.config.maxRounds > 0 && this.round > this.config.maxRounds) {
        const winner = this.alive().sort((a, b) => this.netWorth(b) - this.netWorth(a))[0];
        this._endGame(winner, "highest net worth when the season ended");
        return;
      }

      const p = this.current;
      this._log("🔁", "#ece9f5", `${p.name}'s turn`);
      this.phase = "busy";
      this._changed();

      if (p.inJail) {
        const choice = await this.hooks.jailChoice(p);
        if (p.bankrupt) { this._finishTurn(); return; }
        if (choice === "pay") {
          this._pay(p, this.jailFee, null);
          if (p.bankrupt) { this._finishTurn(); return; }
          p.inJail = false;
          this._log("💵", "#f59e0b", `${p.name} paid ${fmt(this.jailFee)} bail`);
        } else if (choice === "card") {
          p.getOutCards -= 1;
          p.inJail = false;
          this._log("🔑", "#22c55e", `${p.name} used a Get-Out-of-Jail card`);
        }
        if (!p.inJail) this.hooks.setJailed && this.hooks.setJailed(p, false);
        this.phase = p.inJail ? "awaiting-jail-roll" : "awaiting-roll";
      } else {
        this.phase = "awaiting-roll";
      }
      this._changed();
    }

    /* ---------- trading ---------- */

    validateTrade({ from, to, giveCash, giveTiles, wantCash, wantTiles }) {
      const a = this.player(from), b = this.player(to);
      if (!a || !b || from === to || a.bankrupt || b.bankrupt) return false;
      giveCash = Math.max(0, Math.floor(giveCash || 0));
      wantCash = Math.max(0, Math.floor(wantCash || 0));
      if (a.cash < giveCash || b.cash < wantCash) return false;
      const seen = new Set();
      for (const id of giveTiles || []) {
        const ps = this.props[id];
        if (!ps || ps.owner !== from || ps.houses > 0 || seen.has(id)) return false;
        seen.add(id);
      }
      for (const id of wantTiles || []) {
        const ps = this.props[id];
        if (!ps || ps.owner !== to || ps.houses > 0 || seen.has(id)) return false;
        seen.add(id);
      }
      return true;
    }

    /** Apply a validated trade. Returns true on success. */
    applyTrade(trade) {
      if (!this.validateTrade(trade)) return false;
      const a = this.player(trade.from), b = this.player(trade.to);
      const giveCash = Math.max(0, Math.floor(trade.giveCash || 0));
      const wantCash = Math.max(0, Math.floor(trade.wantCash || 0));
      a.cash -= giveCash; b.cash += giveCash;
      b.cash -= wantCash; a.cash += wantCash;
      for (const id of trade.giveTiles || []) this.props[id].owner = trade.to;
      for (const id of trade.wantTiles || []) this.props[id].owner = trade.from;
      const names = [...(trade.giveTiles || []), ...(trade.wantTiles || [])].map((id) => tileById(id).name);
      const net = giveCash - wantCash;
      this._log("🤝", "#22c55e",
        `${a.name} ⇄ ${b.name}: trade completed${names.length ? ` (${names.join(", ")})` : ""}` +
        `${net !== 0 ? ` — ${fmt(Math.abs(net))} to ${net > 0 ? b.name : a.name}` : ""}`);
      this._changed();
      return true;
    }

    /* ---------- multiplayer sync (snapshots) ---------- */

    serialize() {
      return {
        players: this.players.map((p) => ({ ...p })),
        props: JSON.parse(JSON.stringify(this.props)),
        turnIdx: this.turnIdx,
        round: this.round,
        phase: this.phase,
        doublesCount: this.doublesCount,
        lastDice: this.lastDice && [...this.lastDice],
        surpriseDeck: [...this.surpriseDeck],
        eventDeck: [...this.eventDeck],
        kafanaPot: this.kafanaPot,
        config: JSON.parse(JSON.stringify(this.config)),
      };
    }

    applySnapshot(s) {
      this.players = s.players.map((p) => ({ ...p }));
      this.props = JSON.parse(JSON.stringify(s.props));
      this.turnIdx = s.turnIdx;
      this.round = s.round;
      this.phase = s.phase;
      this.doublesCount = s.doublesCount || 0;
      this.lastDice = s.lastDice ? [...s.lastDice] : null;
      this.surpriseDeck = [...(s.surpriseDeck || [])];
      this.eventDeck = [...(s.eventDeck || [])];
      this.kafanaPot = s.kafanaPot || 0;
      // always normalise: a snapshot rebuilt by fromSnapshot() has no config of
      // its own yet, and half-initialised rules crash every rule lookup
      this.config = Game.normalizeConfig(s.config || this.config);
      this.rules = this.config.rules;
    }

    /** Rebuild an engine from a snapshot (used on host migration / late hydrate). */
    static fromSnapshot(snapshot, hooks) {
      const g = Object.create(Game.prototype);
      Object.assign(g, { hooks });
      g.applySnapshot(snapshot);
      return g;
    }

    _endGame(winner, reason) {
      this.phase = "over";
      this._log("🏆", "#f4b73f", `${winner ? winner.name : "Nobody"} wins — ${reason}!`);
      this._changed();
      this.hooks.gameOver(winner, reason);
    }
  }

  window.BT = Object.assign(window.BT || {}, {
    Game, SURPRISE_CARDS, EVENT_CARDS, DEFAULT_CONFIG,
  });
})();
