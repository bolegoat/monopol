/* ============================================================================
 * Balkan Tycoon — net.js
 * Thin socket.io client wrapper: rooms, relays, chat. Promise-based API.
 * Requires the socket.io client script (served by server/relay.js).
 * ========================================================================== */

"use strict";

(function () {
  class NetClient {
    constructor() {
      this.socket = null;
      this.code = null;
      this.token = null;
      this._handlers = new Map(); // event -> Set<fn>
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

    /** Rejoin after a page reload using the stored session. */
    rejoin() {
      const code = localStorage.getItem("bt_room");
      const token = localStorage.getItem("bt_token");
      if (!code || !token) return Promise.reject(new Error("No saved session"));
      return this._connect().then(
        () =>
          new Promise((resolve, reject) => {
            this.socket.emit("room:rejoin", code, token, (res) => {
              if (!res?.ok) return reject(new Error(res?.error || "Rejoin failed"));
              this.code = code;
              this.token = token;
              resolve(res);
            });
          }),
      );
    }

    hasSession() {
      return Boolean(localStorage.getItem("bt_room") && localStorage.getItem("bt_token"));
    }

    leave() {
      this.socket?.emit("room:leave");
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
        this.socket.on("connect", () => resolve());
        this.socket.on("connect_error", (err) => reject(err));
        // fan-out for registered handlers
        for (const event of NetClient.EVENTS) {
          this.socket.on(event, (...args) => {
            const set = this._handlers.get(event);
            if (set) for (const fn of set) fn(...args);
          });
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
    sendChat(text) { this.socket?.emit("chat:send", text); }
  }

  NetClient.EVENTS = [
    "room:state",
    "game:started",
    "host:state",
    "host:event",
    "player:action",
    "trade:offer",
    "trade:respond",
    "host:migrated",
    "chat:message",
    "room:closed",
    "error",
  ];

  window.BT = Object.assign(window.BT || {}, { NetClient });
})();
