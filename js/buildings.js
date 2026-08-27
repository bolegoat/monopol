/* ============================================================================
 * Balkan Tycoon — buildings.js
 * Procedural Three.js houses & hotels rendered on top of city tiles.
 * A tilted orthographic overlay (1 world unit = 1 CSS px at ground level)
 * is pinned exactly over the CSS board; building bases are projected from
 * each tile's color-banner zone so they always align, at any board size.
 *
 * Pieces follow the physical Monopoly set: houses are small green gable
 * cottages, the hotel is one big red building of the same shape. Same
 * silhouette, different size and colour — that is what makes them readable
 * as a pair at ~18px on screen.
 *
 *   Houses (1-4): green (--house), laid out side by side with 2px gaps.
 *   Hotel  (max 1): red (--hotel), roughly twice the footprint; replaces them.
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

  /* Piece dimensions as fractions of a tile's short side. The hotel is the
   * same shape scaled up, so the two never read as different objects. */
  /* Walls are deliberately tall relative to the footprint: the camera looks
   * down at 58 degrees, so a low building shows almost no wall and flattens
   * into its own roof. The hotel gains depth as well as width, so it reads as
   * a bigger building rather than a wider slab. */
  const HOUSE = { w: 0.185, d: 0.160, wall: 0.100, roof: 0.082, chim: 0.030 };
  const HOTEL = { w: 0.300, d: 0.215, wall: 0.132, roof: 0.104, chim: 0.036 };

  const houseW = () => tilePx * HOUSE.w;

  /* ---------- easing ---------- */

  function easeOutBounce(x) {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }

  /* ---------- shared materials ---------- */

  /* Matte moulded-plastic look: high roughness, no metalness, no emissive.
   * Roofs are a darker shade of the same hue rather than a contrasting colour,
   * so the roof plane separates from the walls without the piece turning into
   * two-tone noise at small sizes. */
  let MATS = null;
  function materials() {
    if (MATS) return MATS;
    const plastic = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 });
    MATS = {
      houseWall: plastic(0x18a957),
      houseRoof: plastic(0x0e7a3c),
      hotelWall: plastic(0xe1362c),
      hotelRoof: plastic(0xa81e17),
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

  /**
   * Gable roof over a w x d footprint.
   *
   * gableGeometry puts the ridge on Z, and every piece ends up yawed to
   * VIEW_YAW, so Z runs toward the camera. That orientation is load-bearing
   * for legibility and must not be "corrected": with the ridge receding from
   * the viewer you see a wall rectangle, the gable triangle above it, and both
   * roof slopes catching different amounts of light — which is what reads as a
   * house. Turn the ridge across the screen instead and all four of those
   * collapse into one slanted plane that looks like a flat coloured slab.
   */
  function gableRoofMesh(w, h, d, mat) {
    return mesh(gableGeometry(w, h, d), mat);
  }

  /* ---------- the piece: walls, gable roof, chimney ----------
   * Houses and hotels are the same three parts at different scales. The old
   * versions carried white trim rings, doors, a window grid and an awning on
   * pillars; at the ~18px a piece actually occupies on screen none of that
   * resolved into anything but visual noise, so it is gone. What is left is
   * the silhouette, which is the only thing legible at this size. */

  function makePiece(spec, wallMat, roofMat) {
    const T = tilePx;
    const g = new THREE.Group();
    const w = T * spec.w, d = T * spec.d;
    const wallH = T * spec.wall, roofH = T * spec.roof;

    const body = mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    body.position.y = wallH / 2;
    g.add(body);

    // eaves overhang the walls slightly, which is what reads as "house"
    const roof = gableRoofMesh(w * 1.08, roofH, d * 1.12, roofMat);
    roof.position.y = wallH;
    g.add(roof);

    // chimney set on one roof slope, tall enough to clear the ridge line
    const c = Math.max(1.2, T * spec.chim);
    g.add(mesh(new THREE.BoxGeometry(c, roofH, c), wallMat,
      w * 0.27, wallH + roofH * 0.9, -d * 0.12));

    return g;
  }

  function makeHouse() {
    const M = materials();
    return makePiece(HOUSE, M.houseWall, M.houseRoof);
  }

  function makeHotel() {
    const M = materials();
    return makePiece(HOTEL, M.hotelWall, M.hotelRoof);
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
