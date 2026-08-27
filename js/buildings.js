/* ============================================================================
 * Balkan Tycoon — buildings.js
 * Procedural Three.js houses & hotels rendered on top of city tiles.
 * A tilted orthographic overlay (1 world unit = 1 CSS px at ground level)
 * is pinned exactly over the CSS board; building bases are projected from
 * each tile's color-banner zone so they always align, at any board size.
 *
 *   Houses (1-4): green gable cottages (#10B981) with white roof trim,
 *                 chimney and door; laid out side by side with 2px gaps.
 *   Hotel  (max 1): blue modern resort (#3B82F6), multi-tiered roof,
 *                 window grid, entrance with awning; replaces the houses.
 *   New pieces drop in from Y + drop height with an easeOutBounce bounce.
 * ========================================================================== */

"use strict";

(function () {
  if (!window.THREE) return; // WebGL libs failed to load — skip silently

  const HOUSE_GAP = 2;    // exact spacing between adjacent houses (px)
  const DROP_MULT = 0.42; // drop height ≈ 2 house-heights above the banner ("Y + 2")
  const DROP_MS = 650;
  const GROW_MS = 170;    // quick scale-in when selling down
  const DIE_MS = 150;     // shrink-out when a piece is removed
  const ELEV_DEG = 58;    // camera tilt from the ground plane

  /* ---------- module state ---------- */

  let renderer = null, scene = null, camera = null, dirLight = null;
  let boardEl = null, canvasEl = null;
  let SIN_E = 1, COS_E = 1;
  let tilePx = 0;
  let ro = null, resizeTimer = 0;

  const placed = new Map(); // tileId -> { group|null, count }
  let lastGame = null;      // remembered so a resize can rebuild everything
  const drops = [];         // { group, t0, dur, fromY }
  const grows = [];         // { group, t0, dur }
  const dying = [];         // { group, t0, dur }
  let rafId = 0;

  const houseW = () => tilePx * 0.185;

  /* ---------- easing ---------- */

  function easeOutBounce(x) {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }

  /* ---------- shared materials ---------- */

  let MATS = null;
  function materials() {
    if (MATS) return MATS;
    MATS = {
      wall: new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.55, metalness: 0.04 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x0d9166, roughness: 0.6 }),
      trim: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 }),
      chimney: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 }),
      door: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 }),
      hotelWall: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.42, metalness: 0.08 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0xbfdbfe, roughness: 0.18, metalness: 0.35,
        emissive: 0x1e3a5f, emissiveIntensity: 0.35,
      }),
    };
    return MATS;
  }

  /* ---------- geometry helpers ---------- */

  /** Triangular prism (gable roof), ridge parallel to the X axis. */
  function gableGeometry(w, h, d) {
    const x = w / 2, z = d / 2;
    const v = [
      -x, 0, z, x, 0, z, 0, h, z,          // front gable triangle (+z)
      x, 0, -z, -x, 0, -z, 0, h, -z,       // back gable (-z)
      -x, 0, z, 0, h, z, 0, h, -z,         // left slope quad
      -x, 0, z, 0, h, -z, -x, 0, -z,
      0, h, z, x, 0, z, x, 0, -z,          // right slope quad
      0, h, z, x, 0, -z, 0, h, -z,
      -x, 0, -z, x, 0, -z, x, 0, z,        // underside
      -x, 0, -z, x, 0, z, -x, 0, z,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function mesh(geo, mat, x, y, z, cast) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = cast !== false;
    return m;
  }

  /* ---------- procedural house: green cottage, white trim, chimney ---------- */

  function makeHouse() {
    const M = materials();
    const T = tilePx;
    const g = new THREE.Group();

    const w = T * 0.185, d = T * 0.155, wallH = T * 0.105, roofH = T * 0.075;
    const t = Math.max(1.1, T * 0.02); // trim thickness

    const body = mesh(new THREE.BoxGeometry(w, wallH, d), M.wall);
    body.position.y = wallH / 2;
    g.add(body);

    const roof = mesh(gableGeometry(w * 1.14, roofH, d * 1.18), M.roof);
    roof.position.y = wallH;
    g.add(roof);

    // white trim ring under both eaves + ridge beam along the top
    g.add(mesh(new THREE.BoxGeometry(w * 1.17, t, d * 1.21), M.trim, 0, wallH - t / 2));
    g.add(mesh(new THREE.BoxGeometry(w * 1.2, t, t), M.trim, 0, wallH + roofH));

    // chimney on one roof slope, with a darker cap
    const chX = w * 0.26, chH = wallH * 0.95;
    g.add(mesh(new THREE.BoxGeometry(t * 2.1, chH, t * 2.1), M.chimney, chX, wallH + roofH * 0.55));
    g.add(mesh(new THREE.BoxGeometry(t * 2.7, t * 0.9, t * 2.7), M.door, chX, wallH + roofH * 0.55 + chH / 2));

    // front door
    g.add(mesh(new THREE.BoxGeometry(w * 0.26, wallH * 0.62, 0.6), M.door, -w * 0.12, wallH * 0.31, d / 2));

    return g;
  }

  /* ---------- procedural hotel: blue multi-tier resort ---------- */

  function makeHotel() {
    const M = materials();
    const T = tilePx;
    const g = new THREE.Group();

    const w = T * 0.34, d = T * 0.205;
    const h1 = T * 0.15, h2 = T * 0.085;
    const t = Math.max(1, T * 0.016);

    const tier1 = mesh(new THREE.BoxGeometry(w, h1, d), M.hotelWall);
    tier1.position.y = h1 / 2;
    g.add(tier1);

    // second tier setback (multi-tiered silhouette)
    const tier2 = mesh(new THREE.BoxGeometry(w * 0.6, h2, d * 0.72), M.hotelWall);
    tier2.position.set(-w * 0.06, h1 + h2 / 2, -d * 0.06);
    g.add(tier2);

    // white slab roofs capping both tiers
    g.add(mesh(new THREE.BoxGeometry(w * 1.05, t, d * 1.05), M.trim, 0, h1 + t / 2));
    g.add(mesh(new THREE.BoxGeometry(w * 0.64, t, d * 0.76), M.trim, -w * 0.06, h1 + h2 + t / 2, -d * 0.06));

    // window grid on the main facade (glass panes slightly proud of the wall)
    const pane = Math.max(1.2, T * 0.032);
    const rows = Math.max(2, Math.floor(h1 / (pane * 1.9)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 4; c++) {
        const wx = -w * 0.33 + c * (w * 0.22);
        const wy = h1 * 0.28 + r * ((h1 * 0.52) / Math.max(rows - 1, 1));
        g.add(mesh(new THREE.BoxGeometry(pane, pane * 1.25, 0.5), M.glass, wx, wy, d / 2, false));
      }
    }
    for (let c = 0; c < 2; c++) {
      g.add(mesh(
        new THREE.BoxGeometry(pane, pane * 1.1, 0.5), M.glass,
        -w * 0.24 + c * (w * 0.24), h1 + h2 * 0.5, d * 0.30, false,
      ));
    }

    // ground-floor entrance: recessed door + awning slab on pillars
    const doorW = w * 0.2;
    g.add(mesh(new THREE.BoxGeometry(doorW, h1 * 0.42, 0.7), M.door, w * 0.26, h1 * 0.21, d / 2));
    g.add(mesh(new THREE.BoxGeometry(doorW * 1.7, t, d * 0.16), M.trim, w * 0.26, h1 * 0.46, d / 2 + d * 0.07));
    g.add(mesh(new THREE.BoxGeometry(t, h1 * 0.44, t), M.trim, w * 0.26 - doorW * 0.75, h1 * 0.22, d / 2 + d * 0.13));
    g.add(mesh(new THREE.BoxGeometry(t, h1 * 0.44, t), M.trim, w * 0.26 + doorW * 0.75, h1 * 0.22, d / 2 + d * 0.13));

    return g;
  }

  /* ---------- layout: piece offsets inside a tile ----------
   * 1 house: centered on the banner zone.
   * 2-4 houses: side by side with exact HOUSE_GAP spacing.
   * Hotel: single centered mesh. */

  function layoutFor(count) {
    if (count <= 1) return [0];
    const hw = houseW();
    const total = count * hw + (count - 1) * HOUSE_GAP;
    const out = [];
    for (let i = 0; i < count; i++) out.push(-total / 2 + hw / 2 + i * (hw + HOUSE_GAP));
    return out;
  }

  /**
   * @param {number} count house level (4 = hotel)
   * @param {number} faceYaw local yaw applied to each piece. The group itself
   *   is yawed so the row of houses runs along the tile's inner edge; this
   *   counter-yaw keeps every model's facade pointed at the camera, so a hotel
   *   on the left/right columns reads as a building instead of a thin sliver.
   */
  function buildFor(count, faceYaw) {
    const group = new THREE.Group();
    const yaw = faceYaw || 0;
    if (count >= 4) {
      const hotel = makeHotel();
      hotel.rotation.y = yaw;
      group.add(hotel);
    } else {
      for (const dx of layoutFor(count)) {
        const house = makeHouse();
        house.position.x = dx;
        house.rotation.y = yaw;
        group.add(house);
      }
    }
    return group;
  }

  /* ---------- anchoring: banner zone -> world ground coords ----------
   * The color banner (flag header) sits on the center-facing rim of every
   * rotated tile card. We measure the live [data-banner] element rect and
   * project its CENTER into board space, so buildings always pin exactly
   * onto the inward-facing color bar — whatever the edge, banner height,
   * or board size:
   *   bottom row: banner at tile top, houses facing up-screen
   *   top row:    banner at tile bottom, facing down-screen
   *   left col:   banner on right rim, facing right
   *   right col:  banner on left rim, facing left
   * Ortho camera tilted by ELEV: screen-x maps 1:1 to world-x, but depth
   * compresses by sin(ELEV) — invert that so bases land exactly on the
   * banner zone. Height shifts visuals up-screen (natural drop parallax). */

  const SIDE_YAW = { bottom: Math.PI, top: 0, left: Math.PI / 2, right: -Math.PI / 2 };

  /* Every facade ends up pointing this way in world space — straight at the
   * tilted camera, which is what the bottom row already did. */
  const VIEW_YAW = Math.PI;

  function anchorFor(index) {
    const UI = window.BT.UI;
    const el = UI.tileEls && UI.tileEls[index];
    if (!el) return null;
    const banner = el.querySelector("[data-banner]");
    if (!banner) return null;
    const br = boardEl.getBoundingClientRect();
    const b = banner.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    const side = window.BT.tileSide(index);
    const bx = b.left - br.left + b.width / 2 - br.width / 2;
    const by = b.top - br.top + b.height / 2 - br.height / 2;
    return { x: bx, z: by / SIN_E, yaw: SIDE_YAW[side] || 0 };
  }

  /* ---------- scene lifecycle ---------- */

  function init() {
    boardEl = document.getElementById("board");
    if (!boardEl || !window.BT.UI || !UI_ready()) return false;

    canvasEl = document.createElement("canvas");
    canvasEl.className = "buildings-canvas";
    canvasEl.setAttribute("aria-hidden", "true");
    boardEl.appendChild(canvasEl);

    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    dirLight = new THREE.DirectionalLight(0xfff2d8, 0.85);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    scene.add(dirLight);
    const rim = new THREE.DirectionalLight(0x9db8ff, 0.32);
    rim.position.set(160, 120, -100);
    scene.add(rim);

    // invisible shadow catcher lying on the board surface
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.ShadowMaterial({ opacity: 0.2 }),
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    scene.add(catcher);

    const elev = THREE.MathUtils.degToRad(ELEV_DEG);
    SIN_E = Math.sin(elev);
    COS_E = Math.cos(elev);
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000);
    const DIST = 3200;
    camera.position.set(0, DIST * SIN_E, DIST * COS_E);
    camera.lookAt(0, 0, 0);

    resize();

    ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => resize(), 60);
    });
    ro.observe(boardEl);
    return true;
  }

  function UI_ready() {
    return window.BT.UI.tileParts && window.BT.UI.tileParts.size > 0;
  }

  function measureTilePx() {
    const el = window.BT.UI.tileEls[1]; // first city tile
    if (!el) return 0;
    return el.getBoundingClientRect().width || 0;
  }

  function resize() {
    if (!renderer || !boardEl) return;
    const w = boardEl.clientWidth, h = boardEl.clientHeight;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    camera.left = -w / 2; camera.right = w / 2;
    camera.top = h / 2; camera.bottom = -h / 2;
    camera.updateProjectionMatrix();

    dirLight.position.set(-w * 0.45, w * 0.85, w * 0.5);
    const s = Math.max(w, h) * 0.85;
    dirLight.shadow.camera.left = -s; dirLight.shadow.camera.right = s;
    dirLight.shadow.camera.top = s; dirLight.shadow.camera.bottom = -s;
    dirLight.shadow.camera.near = 1; dirLight.shadow.camera.far = w * 4;
    dirLight.shadow.camera.updateProjectionMatrix();

    const t = measureTilePx();
    if (!t) return;
    if (!tilePx) {
      tilePx = t;
    } else if (Math.abs(t - tilePx) > 1.5) {
      tilePx = t;
      rebuildAll(); // board resized: rebuild every piece at the new scale
      if (lastGame) sync(lastGame); // …and re-anchor them immediately
    }
  }

  function disposeGroup(group) {
    group.traverse((obj) => { if (obj.geometry) obj.geometry.dispose(); });
  }

  /** Keep a removed group around just long enough to shrink out. */
  function killGroup(group) {
    scene.add(group); // re-add so the shrink animation is visible
    dying.push({ group, t0: performance.now(), dur: DIE_MS });
  }

  function rebuildAll() {
    for (const [, rec] of placed) {
      if (!rec.group) continue;
      scene.remove(rec.group);
      disposeGroup(rec.group);
    }
    placed.clear();
    drops.length = grows.length = dying.length = 0;
    scheduleRender();
  }

  /* ---------- animations ---------- */

  function animateDrop(group) {
    const fromY = tilePx * DROP_MULT; // start Y + drop height above the base
    group.position.y = fromY;
    drops.push({ group, t0: performance.now(), dur: DROP_MS, fromY });
    startLoop();
  }

  function animateGrow(group) {
    group.scale.setScalar(0.01);
    grows.push({ group, t0: performance.now(), dur: GROW_MS });
    startLoop();
  }

  function stepDrops(now) {
    let active = false;
    for (let i = drops.length - 1; i >= 0; i--) {
      const a = drops[i];
      const k = Math.min((now - a.t0) / a.dur, 1);
      a.group.position.y = a.fromY * (1 - easeOutBounce(k)); // elastic bounce.out
      if (k >= 1) {
        a.group.position.y = 0;
        drops.splice(i, 1);
      } else active = true;
    }
    return active;
  }

  function stepGrows(now) {
    let active = false;
    for (let i = grows.length - 1; i >= 0; i--) {
      const a = grows[i];
      const k = Math.min((now - a.t0) / a.dur, 1);
      a.group.scale.setScalar(0.01 + 0.99 * (1 - Math.pow(1 - k, 3)));
      if (k >= 1) {
        a.group.scale.setScalar(1);
        grows.splice(i, 1);
      } else active = true;
    }
    return active;
  }

  function stepDying(now) {
    let active = false;
    for (let i = dying.length - 1; i >= 0; i--) {
      const a = dying[i];
      const k = Math.min((now - a.t0) / a.dur, 1);
      a.group.scale.setScalar(Math.max(0.01, 1 - k));
      if (k >= 1) {
        scene.remove(a.group);
        disposeGroup(a.group);
        dying.splice(i, 1);
      } else active = true;
    }
    return active;
  }

  function loop() {
    rafId = 0;
    const now = performance.now();
    const active =
      stepDrops(now) ||
      stepGrows(now) ||
      stepDying(now);
    renderer.render(scene, camera);
    if (active) startLoop();
  }

  function startLoop() {
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function scheduleRender() {
    if (renderer) startLoop();
  }

  /* ---------- public sync: diff engine state -> meshes ---------- */

  function sync(game) {
    if (!renderer) { if (!init()) return; }
    if (!game) return;
    lastGame = game;
    if (!tilePx) { resize(); if (!tilePx) return; }

    for (const [tileId] of window.BT.UI.tileParts) {
      const tile = window.BT.tileById(tileId);
      if (!tile || tile.kind !== "city") continue;
      const ps = game.props[tileId];
      const want = ps && ps.owner ? Math.min(ps.houses || 0, 4) : 0;
      const rec = placed.get(tileId);
      const cur = rec ? rec.count : -1; // -1: never painted this session
      if (want === cur) continue;

      const index = window.BT.tileIndex(tileId);
      const anchor = anchorFor(index);

      // tear down whatever stands there now
      if (rec && rec.group) {
        scene.remove(rec.group);
        disposeGroup(rec.group);
      }

      if (want === 0 || !anchor) {
        if (rec && rec.group) killGroup(rec.group); // sold off: shrink away
        placed.set(tileId, { group: null, count: want });
        scheduleRender();
        continue;
      }

      // group yaw lines the row up with the tile edge; the per-piece counter-yaw
      // (VIEW_YAW - anchor.yaw) turns every facade back toward the camera
      const group = buildFor(want, VIEW_YAW - anchor.yaw);
      group.position.set(anchor.x, 0, anchor.z);
      group.rotation.y = anchor.yaw;
      scene.add(group);
      placed.set(tileId, { group, count: want });

      if (cur < 0) scheduleRender();          // first paint after load: static
      else if (want > cur) animateDrop(group); // upgrade purchased: bounce in
      else animateGrow(group);                 // sold down: quick pop back
    }
  }

  function reset() {
    if (scene) rebuildAll();
  }

  /** True once the WebGL overlay is live, i.e. 3D pieces replace the 2D pips. */
  function active() {
    return Boolean(renderer && scene);
  }

  /** Diagnostics: what is placed where (console / test use only). */
  function debug() {
    const out = [];
    for (const [tileId, rec] of placed) {
      out.push({
        tileId,
        count: rec.count,
        placed: Boolean(rec.group),
        pos: rec.group ? [Math.round(rec.group.position.x), Math.round(rec.group.position.z)] : null,
        inScene: rec.group ? Boolean(rec.group.parent) : false,
      });
    }
    return { tilePx, sinE: SIN_E, entries: out };
  }

  window.BT = Object.assign(window.BT || {}, { Buildings: { sync, reset, active, debug } });
})();
