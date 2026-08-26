/* ============================================================================
 * Balkan Tycoon — dice3d.js
 * Real 3D physics dice: Three.js rendering + Cannon.js simulation.
 * Two chamfered dice with dark recessed pips are thrown with random
 * force/torque, bounce off the ground plane and arena walls, then settle.
 * Rock-solid landing logic: damped bodies, inset collision box, top-face
 * normal detection (dot with world UP), and an anti-cocked guard that
 * nudges tilted dice — falling back to a quaternion slerp-to-flat snap.
 * The settled top faces are reported via onRollComplete(d1, d2, total).
 * ========================================================================== */

"use strict";

(function () {
  const DIE_SIZE = 1.1;
  const DIE_RADIUS = 0.14; // rounded corner radius
  const CEILING = 7.2; // invisible ceiling of the bounding box
  const SETTLE_SPEED = 0.12;
  const SETTLE_FRAMES = 8;
  const MAX_ROLL_MS = 2600; // fail-safe: force stabilization & fire callback
  const SETTLE_DOT = 0.985; // below this the die is cocked (tilted / leaning).
  // NOTE: the nominal spec threshold 0.88 proved too permissive in testing —
  // a die leaning ~28 deg off a wall reads exactly 0.88 and would be reported
  // tilted. 0.985 only accepts visually flat faces; anything else goes
  // through the nudge -> grace-window -> slerp-snap pipeline below.
  const COCKED_GRACE_MS = 1800; // nudge window before the hard slerp fallback
  const SNAP_MS = 260; // duration of the slerp-to-flat fallback

  /* --- predetermined (network-synced) rolls ---
   * Multiplayer rolls are drawn once on the host and streamed to every
   * client, so each screen animates the SAME faces. The motion is a fixed
   * timeline: free physics tumble for TUMBLE_MS, then a guided slerp onto
   * the exact target faces. Identical duration everywhere = no drift. */
  const FORCED_TUMBLE_MS = 950; // free-physics tumble before guided landing
  const FORCED_LAND_MS = 420;   // guided slerp onto the predetermined faces

  /* Face values per local axis (BoxGeometry material order px,nx,py,ny,pz,nz).
   * Opposite faces always sum to 7. */
  const FACE_VALUES = { px: 1, nx: 6, py: 2, ny: 5, pz: 3, nz: 4 };

  /* Local-space face normal per value (unit vectors):
   * 1:(0,0,1)  6:(0,0,-1)  2:(0,1,0)  5:(0,-1,0)  3:(1,0,0)  4:(-1,0,0) */
  const FACE_NORMALS = (() => {
    const axisToNormal = {
      px: [1, 0, 0], nx: [-1, 0, 0],
      py: [0, 1, 0], ny: [0, -1, 0],
      pz: [0, 0, 1], nz: [0, 0, -1],
    };
    const byValue = {};
    for (const [axis, value] of Object.entries(FACE_VALUES)) byValue[value] = axisToNormal[axis];
    return byValue;
  })();

  /* ---------- Rounded-box geometry (clamped-corner trick) ---------- */
  function roundedBoxGeometry(size, radius, seg) {
    const geo = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
    const pos = geo.attributes.position;
    const inner = size / 2 - radius;
    const v = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      c.set(
        Math.max(-inner, Math.min(inner, v.x)),
        Math.max(-inner, Math.min(inner, v.y)),
        Math.max(-inner, Math.min(inner, v.z)),
      );
      n.copy(v).sub(c);
      if (n.lengthSq() > 1e-8) {
        n.normalize().multiplyScalar(radius).add(c);
        pos.setXYZ(i, n.x, n.y, n.z);
      }
    }
    geo.computeVertexNormals();
    return geo;
  }

  /* ---------- Face textures: ivory face, rounded edge shading, pips ---------- */
  function pipLayout(value) {
    const a = 0.27, b = 0.5, c = 0.73;
    switch (value) {
      case 1: return [[b, b]];
      case 2: return [[a, a], [c, c]];
      case 3: return [[a, a], [b, b], [c, c]];
      case 4: return [[a, a], [c, a], [a, c], [c, c]];
      case 5: return [[a, a], [c, a], [b, b], [a, c], [c, c]];
      default: return [[a, a], [c, a], [a, b], [c, b], [a, c], [c, c]];
    }
  }

  function faceTexture(value) {
    const S = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const ctx = cv.getContext("2d");

    // ivory base with a soft radial vignette (fake bevel lighting)
    const bg = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
    bg.addColorStop(0, "#faf5e8");
    bg.addColorStop(0.75, "#f1ead8");
    bg.addColorStop(1, "#ddd3ba");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    // subtle inset rounded edge (rounded-corner illusion on the flat face)
    ctx.strokeStyle = "rgba(120, 105, 70, 0.35)";
    ctx.lineWidth = S * 0.045;
    const r = S * 0.14;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(S * 0.03, S * 0.03, S * 0.94, S * 0.94, r);
    else ctx.rect(S * 0.03, S * 0.03, S * 0.94, S * 0.94);
    ctx.stroke();

    // dark recessed pips: inner shadow ring + deep centre
    const pr = S * 0.085;
    for (const [fx, fy] of pipLayout(value)) {
      const x = fx * S, y = fy * S;
      const grad = ctx.createRadialGradient(x, y, pr * 0.15, x, y, pr);
      grad.addColorStop(0, "#05060a");
      grad.addColorStop(0.72, "#161a22");
      grad.addColorStop(1, "rgba(22,26,34,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fill();
      // tiny bottom highlight = recessed look
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = S * 0.012;
      ctx.beginPath();
      ctx.arc(x, y + pr * 0.18, pr * 0.72, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------- DiceManager ---------- */

  class DiceManager {
    /**
     * @param {HTMLCanvasElement} canvas overlay canvas in the board centre
     */
    constructor(canvas) {
      this.canvas = canvas;
      this.available = Boolean(window.THREE && window.CANNON);
      this.rolling = false;
      this._stableFrames = 0;
      this._rollStartedAt = 0;
      this._onComplete = null;
      this._done = false;   // single-fire guard for the result callback
      this._cockedAt = 0;   // anti-tilt grace window start
      this._snap = null;    // active slerp-to-flat fallback
      this._forced = null;  // predetermined faces (network rolls)
      this.dice = []; // { mesh, body }
      if (this.available) this._init();
    }

    _init() {
      const parent = this.canvas.parentElement;
      const w = parent.clientWidth || 400;
      const h = parent.clientHeight || 400;

      /* --- renderer / scene / camera --- */
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this.scene = new THREE.Scene();

      this.camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
      // fixed FOV, looking straight down into the centre arena
      this.camera.position.set(0, 12.5, 0.001);
      this.camera.lookAt(0, 0, 0);
      // Strict collision arena: walls sit just inside the visible frustum at
      // ground level, which is exactly the inner boundary of the tile ring —
      // dice can never tumble under or behind the board edges.
      const visHalf = 12.5 * Math.tan(THREE.MathUtils.degToRad(30 / 2));
      const reach = DIE_SIZE * 0.88; // conservative rotated half-reach of a die
      this.arena = (visHalf - reach) * 0.94;

      /* --- lights --- */
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const key = new THREE.DirectionalLight(0xfff2d8, 0.95);
      key.position.set(4, 10, 6);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = key.shadow.camera.bottom = -8;
      key.shadow.camera.right = key.shadow.camera.top = 8;
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(0x9db8ff, 0.35);
      rim.position.set(-6, 6, -4);
      this.scene.add(rim);

      /* --- shadow-catcher floor (invisible, shows soft shadows) --- */
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.ShadowMaterial({ opacity: 0.35 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      this.scene.add(floor);

      /* --- physics world --- */
      const world = (this.world = new CANNON.World());
      world.gravity.set(0, -9.82 * 3, 0); // slightly heavy = snappy rolls
      world.broadphase = new CANNON.NaiveBroadphase();
      world.solver.iterations = 14;

      this.matDice = new CANNON.Material("dice");
      this.matGround = new CANNON.Material("ground");
      // grippier + bouncier: dice tumble dynamically and ricochet off each
      // other and the walls instead of sliding to a dead stop
      world.addContactMaterial(new CANNON.ContactMaterial(this.matDice, this.matGround, {
        friction: 0.25, restitution: 0.65,
      }));
      world.addContactMaterial(new CANNON.ContactMaterial(this.matDice, this.matDice, {
        friction: 0.25, restitution: 0.65,
      }));

      // ground plane
      const groundBody = new CANNON.Body({ mass: 0, material: this.matGround, shape: new CANNON.Plane() });
      groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      world.add(groundBody);

      // invisible ceiling — dice can never fly out of view
      const ceilingBody = new CANNON.Body({ mass: 0, material: this.matGround, shape: new CANNON.Plane() });
      ceilingBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2); // faces down
      ceilingBody.position.set(0, CEILING, 0);
      world.add(ceilingBody);

      // four invisible vertical walls forming the strict bounding box
      const A = this.arena;
      const wallDefs = [
        { pos: [0, 0, -A], rot: [0, 0, 1], angle: 0 },                 // far   (faces +z)
        { pos: [0, 0, A], rot: [0, 1, 0], angle: Math.PI },            // near  (faces -z)
        { pos: [-A, 0, 0], rot: [0, 1, 0], angle: Math.PI / 2 },       // left  (faces +x)
        { pos: [A, 0, 0], rot: [0, 1, 0], angle: -Math.PI / 2 },       // right (faces -x)
      ];
      for (const def of wallDefs) {
        const wall = new CANNON.Body({ mass: 0, material: this.matGround, shape: new CANNON.Plane() });
        wall.position.set(def.pos[0], def.pos[1], def.pos[2]);
        wall.quaternion.setFromAxisAngle(new CANNON.Vec3(def.rot[0], def.rot[1], def.rot[2]), def.angle);
        world.add(wall);
      }

      /* --- the two dice --- */
      const geo = roundedBoxGeometry(DIE_SIZE, DIE_RADIUS, 4);
      const materials = ["px", "nx", "py", "ny", "pz", "nz"].map(
        (face) => new THREE.MeshPhongMaterial({
          map: faceTexture(FACE_VALUES[face]),
          shininess: 32,
          specular: 0x333333,
        }),
      );
      const half = DIE_SIZE / 2;

      for (let i = 0; i < 2; i++) {
        const mesh = new THREE.Mesh(geo, materials);
        mesh.castShadow = true;
        mesh.position.set(i === 0 ? -1.4 : 1.4, half, i === 0 ? 0.4 : -0.4);
        this.scene.add(mesh);

        // Physics box is slightly inset vs the chamfered visual cube so the
        // rounded corners can never act as sharp physical balance points.
        const physHalf = half * 0.94;
        const body = new CANNON.Body({
          mass: 1,
          material: this.matDice,
          shape: new CANNON.Box(new CANNON.Vec3(physHalf, physHalf, physHalf)),
          linearDamping: 0.4, // kills perpetual sliding / micro-drift
          angularDamping: 0.5, // kills endless micro-wobble on edges
        });
        body.position.set(mesh.position.x, physHalf, mesh.position.z);
        body.allowSleep = false;
        world.add(body);

        this.dice.push({ mesh, body });
      }

      /* --- resize handling --- */
      const onResize = () => this._resize();
      window.addEventListener("resize", onResize);
      if (window.ResizeObserver) new ResizeObserver(onResize).observe(parent);

      this._animate = this._animate.bind(this);
      requestAnimationFrame(this._animate);
    }

    _resize() {
      if (!this.available) return;
      const parent = this.canvas.parentElement;
      const w = parent.clientWidth, h = parent.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    }

    /**
     * Throw both dice.
     * @param {(d1:number, d2:number, total:number) => void} onRollComplete
     * @param {[number, number]?} forced predetermined faces — when given
     *        (network play) the dice always land exactly on these values
     *        after a fixed-duration tumble, identical on every client.
     * @param {{interrupt?:boolean}?} opts interrupt replaces a roll in flight
     */
    roll(onRollComplete, forced = null, opts = {}) {
      if (this.rolling && !(forced && opts.interrupt)) return;
      this.rolling = true;
      this._onComplete = onRollComplete;
      this._forced = forced && Number.isFinite(forced[0]) && Number.isFinite(forced[1])
        ? [Math.min(6, Math.max(1, Math.floor(forced[0]))), Math.min(6, Math.max(1, Math.floor(forced[1])))]
        : null;
      this._snap = null; // a new throw always cancels any tween in flight

      // Backgrounded tabs get timers/rAF clamped hard; a host waiting on a
      // frozen dice animation would stall every client. Predetermined rolls
      // are pure eye-candy — report the values immediately when hidden.
      if (this._forced && typeof document !== "undefined" && document.hidden) {
        const [fd1, fd2] = this._forced;
        setTimeout(() => {
          this.rolling = false;
          if (this._onComplete) this._onComplete(fd1, fd2, fd1 + fd2);
        }, 30);
        return;
      }

      if (!this.available) {
        // graceful 2D fallback if WebGL libs failed to load
        const d1 = this._forced ? this._forced[0] : 1 + Math.floor(Math.random() * 6);
        const d2 = this._forced ? this._forced[1] : 1 + Math.floor(Math.random() * 6);
        setTimeout(() => {
          this.rolling = false;
          if (this._onComplete) this._onComplete(d1, d2, d1 + d2);
        }, 700);
        return;
      }

      const rand = (min, max) => min + Math.random() * (max - min);
      this.dice.forEach((d, i) => {
        // True-random tumble: randomized spawn offsets, a strong upward
        // throw with scattered lateral velocity, and wild spin on every
        // axis so no two trajectories ever repeat.
        d.body.position.set(rand(-0.8, 0.8) + (i === 0 ? -0.5 : 0.5), rand(2.6, 3.8), rand(-0.8, 0.8));
        d.body.velocity.set(rand(-3, 3), rand(8, 12), rand(-3, 3));
        d.body.angularVelocity.set(rand(-18, 18), rand(-18, 18), rand(-18, 18));
        d.body.quaternion.setFromEuler(rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2));
        d.body.wakeUp && d.body.wakeUp();
      });

      this._stableFrames = 0;
      this._settled = false;
      this._done = false;      // result callback fires exactly once
      this._cockedAt = 0;      // when the anti-tilt grace window started
      this._snap = null;       // active slerp-to-flat fallback
      this._rollStartedAt = performance.now();
    }

    /** Current top faces of both dice (debug / tests / net assertions). */
    get faces() {
      if (!this.available || !this.dice.length) return null;
      return [this._topValue(this.dice[0].body), this._topValue(this.dice[1].body)];
    }

    /** Build a quaternion that puts `value` flat on top, with a random
     * spin around the world UP axis so guided landings never look repeated. */
    _targetQuaternion(value) {
      const UP = new THREE.Vector3(0, 1, 0);
      const n = FACE_NORMALS[value];
      const local = new THREE.Vector3(n[0], n[1], n[2]);
      const fix = new THREE.Quaternion().setFromUnitVectors(local, UP);
      const yaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2);
      return yaw.multiply(fix);
    }

    /** Guided landing for predetermined rolls: tween every die from its
     * current pose onto the exact target face while easing down to rest. */
    _beginForcedLanding() {
      const half = DIE_SIZE / 2;
      const targets = this.dice.map((d, i) => ({
        from: d.mesh.quaternion.clone(),
        to: this._targetQuaternion(this._forced[i]),
        fromY: d.body.position.y,
      }));
      for (const d of this.dice) {
        d.body.velocity.set(0, 0, 0);
        d.body.angularVelocity.set(0, 0, 0);
      }
      this._snap = {
        startedAt: performance.now(),
        dur: FORCED_LAND_MS,
        targets,
        settleY: half, // ease height down to the resting pose as well
      };
    }

    /** Fail-safe: hard-stop the dice, then slerp them flat and report. */
    _forceSettle() {
      for (const d of this.dice) {
        d.body.velocity.set(0, 0, 0);
        d.body.angularVelocity.set(0, 0, 0);
      }
      this._beginSnap();
    }

    /**
     * Top-face normal detection: transform each face's local normal by the
     * body quaternion and dot it with world UP (0,1,0). The face whose
     * transformed normal is closest to +1.0 is the winning roll value.
     * Returns { value, dot } — dot < SETTLE_DOT means the die is cocked.
     */
    _topFace(body) {
      let bestValue = 1, bestDot = -Infinity;
      const world = new CANNON.Vec3();
      for (let value = 1; value <= 6; value++) {
        const n = FACE_NORMALS[value];
        body.quaternion.vmult(new CANNON.Vec3(n[0], n[1], n[2]), world);
        if (world.y > bestDot) { bestDot = world.y; bestValue = value; }
      }
      return { value: bestValue, dot: bestDot };
    }

    _topValue(body) {
      return this._topFace(body).value;
    }

    /** Anti-tilt stage 1: tiny upward impulse + torque "nudge" to shake a
     * cocked die off its edge / wall lean so it can settle flat on its own. */
    _nudgeCocked(die) {
      const b = die.body;
      b.velocity.y += 2.4;
      b.velocity.x += (Math.random() - 0.5) * 1.6;
      b.velocity.z += (Math.random() - 0.5) * 1.6;
      b.angularVelocity.x += (Math.random() - 0.5) * 9;
      b.angularVelocity.z += (Math.random() - 0.5) * 9;
      b.wakeUp && b.wakeUp();
    }

    /** Anti-tilt stage 2 fallback: build target quaternions that carry each
     * die's winning face normal exactly onto world UP (any rotation about UP
     * keeps the face flat), then tween there with a smooth slerp. */
    _beginSnap() {
      if (this._snap) return;
      const UP = new THREE.Vector3(0, 1, 0);
      const n = new THREE.Vector3();
      const targets = [];
      for (const d of this.dice) {
        const { value } = this._topFace(d.body);
        const local = FACE_NORMALS[value];
        n.set(local[0], local[1], local[2]).applyQuaternion(d.mesh.quaternion).normalize();
        const fix = new THREE.Quaternion().setFromUnitVectors(n, UP);
        targets.push({
          from: d.mesh.quaternion.clone(),
          to: fix.multiply(d.mesh.quaternion.clone()).normalize(),
        });
      }
      const half = DIE_SIZE / 2;
      for (const d of this.dice) {
        d.body.velocity.set(0, 0, 0);
        d.body.angularVelocity.set(0, 0, 0);
        if (d.body.position.y < half || d.body.position.y > CEILING) d.body.position.y = half;
      }
      this._snap = { startedAt: performance.now(), dur: SNAP_MS, targets };
    }

    /** Advance the snap slerp; k in [0,1]. */
    _stepSnap(k) {
      const q = new THREE.Quaternion();
      const s = this._snap;
      s.targets.forEach((t, i) => {
        q.copy(t.from).slerp(t.to, k);
        const d = this.dice[i];
        d.mesh.quaternion.copy(q);
        d.body.quaternion.copy(q); // keep physics in sync for the final read
        if (s.settleY != null && Number.isFinite(t.fromY)) {
          const y = t.fromY + (s.settleY - t.fromY) * k;
          d.mesh.position.y = y;
          d.body.position.y = y;
        }
      });
    }

    _finishRoll() {
      if (this._done) return; // never fire the turn callback twice
      this._done = true;
      // Predetermined rolls always report the network values — the physics
      // tumble is pure eye-candy and must never override them.
      const d1 = this._forced ? this._forced[0] : this._topValue(this.dice[0].body);
      const d2 = this._forced ? this._forced[1] : this._topValue(this.dice[1].body);
      this.rolling = false;
      const cb = this._onComplete;
      this._onComplete = null;
      if (cb) cb(d1, d2, d1 + d2);
    }

    _animate() {
      requestAnimationFrame(this._animate);
      if (!this.available) return;

      if (this.rolling) {
        const now = performance.now();
        const elapsed = now - this._rollStartedAt;

        if (this._snap) {
          /* guided tween in progress: own the transform until flat */
          const k = Math.min((now - this._snap.startedAt) / this._snap.dur, 1);
          const s = k * k * (3 - 2 * k); // smoothstep easing on the slerp
          this._stepSnap(s);
          if (k >= 1) {
            this._snap = null;
            this._settled = true;
            this._finishRoll(); // force-trigger: legal flat face, fired once
          }
        } else if (this._forced && elapsed >= FORCED_TUMBLE_MS) {
          /* predetermined roll: free tumble done — land on the exact faces */
          this._beginForcedLanding();
        } else {
          // fixed-timestep accumulator: identical physics on any refresh rate
          let frame = (now - (this._lastT || now)) / 1000;
          this._lastT = now;
          if (frame > 0.1) frame = 0.1;
          this._acc = (this._acc || 0) + frame;
          while (this._acc >= 1 / 60) {
            this.world.step(1 / 60);
            this._acc -= 1 / 60;
          }

          const settledEnough = this.dice.every(
            (d) => d.body.velocity.length() < SETTLE_SPEED && d.body.angularVelocity.length() < SETTLE_SPEED,
          );

          if (this._forced) {
            // predetermined rolls ignore early rest — the timeline is fixed
            this._stableFrames = 0;
          } else if (elapsed > 700 && settledEnough) {
            this._stableFrames += 1;
            if (this._stableFrames >= SETTLE_FRAMES) {
              /* rest detected — verify every die landed legally flat */
              const cocked = this.dice.filter((d) => this._topFace(d.body).dot < SETTLE_DOT);
              if (!cocked.length) {
                this._finishRoll();
              } else if (!this._cockedAt) {
                this._cockedAt = now; // start the grace clock
                cocked.forEach((d) => this._nudgeCocked(d));
                this._stableFrames = 0;
              } else if (now - this._cockedAt > COCKED_GRACE_MS) {
                this._beginSnap(); // still tilted after the window: slerp flat
              } else {
                this._stableFrames = 0; // nudged: wait for it to re-settle
              }
            }
          } else {
            this._stableFrames = 0;
            const deadline = this._cockedAt ? MAX_ROLL_MS + COCKED_GRACE_MS : MAX_ROLL_MS;
            if (elapsed > deadline) this._forceSettle(); // fail-safe stabilization
          }
        }
      }

      // sync meshes to physics (unless the snap tween owns them)
      if (!this._snap) {
        for (const d of this.dice) {
          d.mesh.position.copy(d.body.position);
          d.mesh.quaternion.copy(d.body.quaternion);
        }
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  window.BT = Object.assign(window.BT || {}, { DiceManager });
})();
