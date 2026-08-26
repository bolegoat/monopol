# Balkan Tycoon

Multiplayer Balkan-flavored property tycoon game. Dark-theme board, 3D physics
dice (Three.js + Cannon.js), 8 countries, 40 tiles, host-authoritative
multiplayer over Socket.IO.

## Play online (multiplayer)

1. Start the relay server (serves the game **and** the multiplayer rooms):

   ```bash
   npm run mp        # server/relay.js on http://localhost:3000
   ```

2. Open `http://localhost:3000` on every player's device.

3. First screen:
   - **Create Game** — set starting capital, max players, turn timer and house
     rules, then **Create Room**. You get a private 5-character room code.
   - **Join Game** — enter a friend's 5-character room code.

4. In the staging room every player picks a **token face** and a **color**
   (taken colors lock live), marks **Ready**, and the host presses
   **Start Match**. Match settings stay host-controlled and live-sync to
   everyone.

5. Dice are drawn once by the host and streamed to all clients — every screen
   plays the identical guided animation and lands on the exact same faces, in
   sync, with no delay.

Rejoining: if you reload mid-lobby or mid-match the client silently resumes
your seat (a live seat can never be hijacked by a second tab; if the host
leaves mid-match authority migrates to the next connected player).

## Local hot-seat

`Play a local hot-seat game instead` on the first screen runs the full game
offline on one screen.

## Development

```bash
npm run dev        # Vite dev server (proxies /socket.io to localhost:3000)
npm run mp         # multiplayer relay on :3000
npm run lint       # oxlint
```

## Architecture

| File                 | Role                                                            |
| -------------------- | --------------------------------------------------------------- |
| `server/relay.js`    | Socket.IO rooms/relay: lobby, settings, colors, relays, snapshots, host migration |
| `index.html`         | Game shell + pre-game menu (create / join / staging room)        |
| `js/board-data.js`   | 40-tile ring, 8 countries, inline SVG flags, grid geometry       |
| `js/game.js`         | Authoritative game engine (runs on the host client)              |
| `js/net.js`          | Promise-based Socket.IO client wrapper                           |
| `js/mp.js`           | MPController: host-authoritative sync, prompts, turn timer       |
| `js/dice3d.js`       | Physics dice; supports predetermined network rolls               |
| `js/ui.js`           | Board rendering, panels, modals, trade composer                  |
| `js/buildings.js`    | Procedural Three.js houses/hotels on tile banners                |
| `css/styles.css`     | Dark theme, 11x11 board grid, inward-facing tile orientation     |

### Dice synchronization

The host draws `d1, d2`, broadcasts `roll-result`, and every client (host
included) feeds the values into `dice.roll(cb, [d1, d2])`: a free physics
tumble for a fixed 950 ms, then a guided 420 ms landing onto the exact faces.
Identical inputs + fixed timeline = identical result on every screen.
