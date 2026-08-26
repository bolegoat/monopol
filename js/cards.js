/* ============================================================================
 * Balkan Tycoon — cards.js
 * The randomized Balkan Surprise & Kafana Event decks plus their effects.
 * Cards are plain data + an apply(game, player, choice) function so the
 * engine stays UI-agnostic; the modal view is built by Game._cardView()
 * into a JSON-safe snapshot (dynamic choice labels resolved host-side).
 *
 * Effect helpers route every fine through game._pay() so the Kafana Jackpot
 * house rule (taxes & fines feed the center pot) applies automatically.
 * Strictly no emojis — icons are SVG keys from icons.js.
 * ========================================================================== */

"use strict";

(function () {
  const fmt = (n) => `€${n}`;
  const eachRival = (game, p, fn) => {
    for (const o of game.players) if (o.id !== p.id && !o.bankrupt) fn(o);
  };

  /* ---------- shared effect builders ---------- */

  const payPerBuilding = (houseFee, hotelFee) => (game, p) => {
    let houses = 0, hotels = 0;
    for (const t of game.ownedTiles(p)) {
      const h = game.props[t.id].houses || 0;
      if (h >= ECONOMY.maxHouses) hotels += 1;
      else houses += h;
    }
    const total = houses * houseFee + hotels * hotelFee;
    if (total > 0) {
      game._pay(p, total, null);
      game._log("road", "#f59e0b",
        `${p.name} owes ${fmt(total)} in tolls (${houses} houses, ${hotels} hotels)`);
    } else {
      game._log("check", "#22c55e", `${p.name} owns no buildings — no tolls due`);
    }
  };

  /* ================= BALKAN SURPRISE deck ================= */

  const SURPRISE = [
    {
      key: "key", tint: "#b48cf2", title: "Get Out of Jail Free",
      text: "The guard's cousin owes your uncle a favor. Keep this card — it smells like burek.",
      apply(game, p) { p.getOutCards += 1; },
    },
    {
      key: "flag", tint: "#8be0a6", title: "Advance to START",
      text: "A generous aunt drives you home from the border. Collect the full welcome.",
      async apply(game, p) {
        const dist = (0 - p.position + TILES.length) % TILES.length;
        await game._movePawn(p, dist, true);
        await game._resolveLanding(p, 1);
      },
    },
    {
      key: "plane", tint: "#9cc8e8", title: "Direct Flight",
      text: "A friend at the counter upgrades you. Fly to the nearest airport — landing rights not included.",
      async apply(game, p) {
        let steps = 0;
        for (let i = 1; i <= TILES.length; i++) {
          if (TILES[(p.position + i) % TILES.length].kind === "airport") { steps = i; break; }
        }
        await game._movePawn(p, steps, true);
        await game._resolveLanding(p, 1);
      },
    },
    {
      key: "arrowUp", tint: "#9cc8e8", title: "Tailwind",
      text: "The jugo wind at your back. Move forward 3 spaces.",
      async apply(game, p) { await game._movePawn(p, 3, true); await game._resolveLanding(p, 1); },
    },
    {
      key: "cornerUpLeft", tint: "#ffb264", title: "Wrong Turn",
      text: "The GPS gave up somewhere near Niš. Move back 3 spaces.",
      async apply(game, p) { await game._movePawn(p, -3, false); await game._resolveLanding(p, 1); },
    },
    {
      key: "banknote", tint: "#8be0a6", title: "Bank Error in Your Favor",
      text: "The exchange lady counted dinars as euros. Collect €75 and say nothing.",
      apply(game, p) { p.cash += 75; },
    },
    {
      key: "passport", tint: "#b48cf2", title: "Diaspora Remittance",
      text: "Your cousin in Vienna finally paid you back. Collect €150 — 'for the family'.",
      apply(game, p) { p.cash += 150; },
    },
    {
      key: "rings", tint: "#ff9ecf", title: "Kum's Wedding",
      text: "Three hundred guests, one open bar. Pay every other player a €20 gift envelope.",
      apply(game, p) {
        for (const o of game.players) if (o.id !== p.id && !o.bankrupt) game._pay(p, 20, o);
      },
    },
    {
      key: "shield", tint: "#b48cf2", title: "Customs Inspection",
      text: "The trunk does not match the manifest, cousin. The inspector proposes a deal:",
      choicesFn(game, p) {
        const fee = 50 * TILES.filter((t) => t.kind === "airport" && game.props[t.id].owner === p.id).length;
        return [
          { id: "pay", label: `Pay ${fmt(fee)} fine`, disabled: p.cash < fee && !canLiquidate(game, p, fee) },
          { id: "skip", label: "Forfeit next turn" },
        ];
      },
      apply(game, p, choice) {
        if (choice === "skip") {
          p.skipTurns += 1;
          game._log("clock", "#f59e0b", `${p.name} forfeits the next turn`);
        } else {
          const fee = 50 * TILES.filter((t) => t.kind === "airport" && game.props[t.id].owner === p.id).length;
          if (fee > 0) game._pay(p, fee, null);
          game._log("stamp", "#ef4444", `${p.name} paid ${fmt(fee)} at customs`);
        }
      },
    },
    {
      key: "road", tint: "#ffb264", title: "Highway Toll Construction",
      text: "New autoput exits past your properties. Pay €25 per house and €100 per hotel.",
      apply: payPerBuilding(25, 100),
    },
    {
      key: "coffee", tint: "#ffd166", title: "Direct to the Kafana",
      text: "Skip the commute — appear straight at the kafana. No START bonus for taxi dodgers.",
      async apply(game, p) {
        const pos = tileIndex("kafana");
        p.position = pos;
        game.hooks.teleportPawn(p, pos);
        await game._resolveLanding(p, 1);
      },
    },
    {
      key: "star", tint: "#ffd166", title: "Slava Feast",
      text: "It is your family's slava and the whole street knows it. Pay every other player €25.",
      apply(game, p) {
        for (const o of game.players) if (o.id !== p.id && !o.bankrupt) game._pay(p, 25, o);
      },
    },
    {
      key: "mail", tint: "#ff9ecf", title: "Wedding Envelopes",
      text: "You attended four weddings this season. Collect €25 from every other player.",
      apply(game, p) {
        for (const o of game.players) if (o.id !== p.id && !o.bankrupt) game._pay(o, 25, p);
      },
    },
  ];

  /* ================= KAFANA EVENT deck ================= */

  const EVENT = [
    {
      key: "sun", tint: "#ffd166", title: "Tourist Season",
      text: "The coast is packed, the prices are criminal, the ice cream is worth it. Collect €100.",
      apply(game, p) { p.cash += 100; },
    },
    {
      key: "alert", tint: "#ffb264", title: "Roadworks Again",
      text: "The bridge has been 'temporarily' under construction since 1998. Pay €50.",
      apply(game, p) { game._pay(p, 50, null); },
    },
    {
      key: "shield", tint: "#ffb264", title: "Border Chaos",
      text: "Six hours in line, two stamps, forty euros of 'processing fees'. Pay €40.",
      apply(game, p) { game._pay(p, 40, null); },
    },
    {
      key: "droplet", tint: "#9cc8e8", title: "Fuel Price Update",
      text: "Overnight hike at every pump in the country. Every player pays €20.",
      apply(game, p) {
        for (const o of game.players) if (!o.bankrupt) game._pay(o, 20, null);
      },
    },
    {
      key: "phone", tint: "#8be0a6", title: "Family Connection",
      text: "Someone who knows someone made a call. The richest rival sends you €50.",
      apply(game, p) {
        const richest = game.players
          .filter((o) => o.id !== p.id && !o.bankrupt)
          .sort((a, b) => b.cash - a.cash)[0];
        if (richest) game._pay(richest, 50, p);
        else p.cash += 50;
      },
    },
    {
      key: "coffee", tint: "#ffd166", title: "Cash-Only Kafana",
      text: "No card terminal, of course. The ATM charges a heroic fee. Pay €30.",
      apply(game, p) { game._pay(p, 30, null); },
    },
    {
      key: "receipt", tint: "#ffb264", title: "Accountant Vanished",
      text: "He left for cigarettes in 2019. The audit lands today. Pay €35.",
      apply(game, p) { game._pay(p, 35, null); },
    },
    {
      key: "mail", tint: "#8be0a6", title: "Wedding Season",
      text: "Three envelopes given, two received — net positive weekend. Collect €40.",
      apply(game, p) { p.cash += 40; },
    },
    {
      key: "bottle", tint: "#ffd166", title: "Distillery Tour",
      text: "The rakija barrel tasting got generous. Collect €60 and a recipe.",
      apply(game, p) { p.cash += 60; },
    },
    {
      key: "rings", tint: "#ff9ecf", title: "Kum Calls in a Favor",
      text: "His kid needs a deposit on an apartment in Split. Lend every rival €15.",
      apply(game, p) {
        eachRival(game, p, (o) => game._pay(p, 15, o));
      },
    },
    {
      key: "globe", tint: "#9cc8e8", title: "Charter Season Bonus",
      text: "German tourists discovered your bus line. Collect €80.",
      apply(game, p) { p.cash += 80; },
    },
    {
      key: "crown", tint: "#ffd166", title: "Harvest Windfall",
      text: "Peppers, corn and questionable accounting. Collect €70 tax-free.",
      apply(game, p) { p.cash += 70; },
    },
  ];

  /** Can forced liquidation (houses then deeds) plausibly cover `amount`? */
  function canLiquidate(game, p, amount) {
    let pool = p.cash;
    for (const t of game.ownedTiles(p)) {
      const h = game.props[t.id].houses || 0;
      if (h > 0) pool += h * Math.round(t.houseCost * ECONOMY.sellRate);
      else pool += Math.round(t.price * ECONOMY.sellRate);
    }
    return pool >= amount;
  }

  window.BT = Object.assign(window.BT || {}, { CARDS: { SURPRISE, EVENT } });
})();
