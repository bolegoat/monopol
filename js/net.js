/* ============================================================================
 * Balkan Tycoon — net.js
 * Thin socket.io client wrapper: rooms, relays, chat. Promise-based API.
 * Requires the socket.io client script (served by server/relay.js).
 *
 * Connection resilience
 * ─────────────────────
 *   - A 5s heartbeat (net:ping) keeps the relay's presence view fresh and
 *     lets it evict half-open sockets.
 *   - socket.io reconnects transparently; on every reconnect we silently
 *     re-identify with room:rejoin so the seat is picked back up. Hosts pass
 *     resumeHost so authority is not handed away for a blip (their engine is
 *     still in memory), while a page reload deliberately does not.
 *   - Local synthetic events for the UI: "net:offline", "net:resumed".
 * ========================================================================== */

"use strict";

(function () {
  const PING_MS = 5000;

  class NetClient {
    constructor() {
      this.socket = null;
      this.code = null;
      this.token = null;
      this._handlers = new Map(); // event -> Set<fn>
      this._pingTimer = 0;
      this._everConnected = false;
      /** Set by mp.js: true while this client is the live host engine. */
      this.isHostResumable = () => false;
    }

    get connected() { return Boolean(this.socket?.connected); }

    /** Connect + create a room. @returns {Promise<{code, token}>} */
    createRoom(profile, settings) {
      return this._connect().then(
        () =>
          new Promise((resolve, reject) => {
            this.socket.emit("room:create", profile, settings || null, (res) => {
              if (!res?.ok) return reject(new Error(res?.error || "Could not create room"));
              this.code = res.code;
              this.token = res.token;
              this._saveSession();
              resolve(res);
            });
          }),
      );
    }

    /** Connect + join a room by 5-char code. */
    joinRoom(code, profile) {
      return this._connect().then(
        () =>
          new Promise((resolve, reject) => {
            this.socket.emit("room:join", code, profile, (res) => {
              if (!res?.ok) return reject(new Error(res?.error || "Could not join room"));
              this.code = code.trim().toUpperCase();
              this.token = res.token;
              this._saveSession();
              resolve(res);
            });
          }),
      );
    }

    /**
     * Rejoin using the stored session.
     * @param {{resumeHost?:boolean}} [opts] resumeHost keeps host authority —
     *        only true for transport reconnects where our engine survived.
     */
    rejoin(opts) {
      const code = localStorage.getItem("bt_room");
      const token = localStorage.getItem("bt_token");
      if (!code || !token) return Promise.reject(new Error("No saved session"));
      return this._connect().then(
        () =>
          new Promise((resolve, reject) => {
            this.socket.emit("room:rejoin", code, token, { resumeHost: Boolean(opts && opts.resumeHost) }, (res) => {
              if (!res?.ok) return reject(new Error(res?.error || "Rejoin failed"));
              this.code = code;
              this.token = token;
              resolve(res);
            });
          }),
      );
    }

    /** Silent re-identify after socket.io reconnects us. */
    _resumeSeat() {
      if (!this.socket || !this.code || !this.token) return;
      let resumeHost = false;
      try { resumeHost = Boolean(this.isHostResumable()); } catch (e) { /* ignore */ }
      this.socket.emit("room:rejoin", this.code, this.token, { resumeHost }, (res) => {
        if (res?.ok) this._fan("net:resumed", res);
        else this._fan("error", res?.error || "Could not resume the session");
      });
    }

    /** Dispatch to registered handlers (server events + local synthetics). */
    _fan(event, ...args) {
      const set = this._handlers.get(event);
      if (set) for (const fn of [...set]) fn(...args);
    }

    _startHeartbeat() {
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => {
        if (this.socket?.connected) this.socket.emit("net:ping", () => {});
      }, PING_MS);
    }

    hasSession() {
      return Boolean(localStorage.getItem("bt_room") && localStorage.getItem("bt_token"));
    }

    leave() {
      this.socket?.emit("room:leave");
      clearInterval(this._pingTimer);
      this._pingTimer = 0;
      this.code = null;
      this.token = null;
      localStorage.removeItem("bt_room");
      localStorage.removeItem("bt_token");
    }

    _saveSession() {
      localStorage.setItem("bt_room", this.code);
      localStorage.setItem("bt_token", this.token);
    }

    _connect() {
      if (this.socket) return Promise.resolve();
      if (typeof io !== "function") {
        return Promise.reject(new Error("Multiplayer server not reachable. Start it with: npm run mp"));
      }
      return new Promise((resolve, reject) => {
        this.socket = io({ transports: ["websocket", "polling"] });
        this.socket.on("connect", () => {
          if (this._everConnected) this._resumeSeat(); // transport came back
          this._everConnected = true;
          this._startHeartbeat();
          resolve();
        });
        this.socket.on("connect_error", (err) => reject(err));
        this.socket.on("disconnect", (reason) => this._fan("net:offline", reason));
        // fan-out for registered handlers
        for (const event of NetClient.EVENTS) {
          this.socket.on(event, (...args) => this._fan(event, ...args));
        }
      });
    }

    on(event, fn) {
      if (!this._handlers.has(event)) this._handlers.set(event, new Set());
      this._handlers.get(event).add(fn);
    }

    /* ----- emits ----- */
    setReady(ready) { this.socket?.emit("lobby:ready", ready); }
    sendSettings(settings) { this.socket?.emit("lobby:settings", settings); }
    setColor(hex) { this.socket?.emit("lobby:color", hex); }
    setAvatar(idx) { this.socket?.emit("lobby:avatar", idx); }
    startGame() { this.socket?.emit("game:start"); }
    sendState(snapshot) { this.socket?.emit("host:state", snapshot); }
    sendEvent(event) { this.socket?.emit("host:event", event); }
    sendAction(action) { this.socket?.emit("player:action", action); }
    sendTradeOffer(trade) { this.socket?.emit("trade:offer", trade); }
    sendTradeResponse(payload) { this.socket?.emit("trade:respond", payload); }
    /** Sender-only: pull an offer back off the table. */
    withdrawTrade(id) { this.socket?.emit("trade:withdraw", { id }); }
    /** Change your display name (lobby or mid-match). */
    setName(name) { this.socket?.emit("lobby:name", name); }
    sendChat(text) { this.socket?.emit("chat:send", text); }
    /** Host-only: push a match-history entry (replayed to rejoining players). */
    sendRoomLog(entry) { this.socket?.emit("room:log", entry); }
  }

  NetClient.EVENTS = [
    "room:state",
    "game:started",
    "host:state",
    "host:event",
    "player:action",
    "trade:offer",
    "trade:respond",
    "trade:closed",
    "host:migrated",
    "room:event",
    "room:history",
    "chat:message",
    "room:closed",
    "error",
  ];

  window.BT = Object.assign(window.BT || {}, { NetClient });
})();
