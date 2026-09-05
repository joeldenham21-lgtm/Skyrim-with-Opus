// Slider — a mimic that runs on all fours, too fast, joints wrong. It lies flat in the grass or under a wreck
// as a dark patch you would walk past, clicks its tongue at you from thirty metres, and when you look away it
// rises, screeches and comes in zigzags at eight metres a second. After a lunge (or a bullet) it runs out of
// your sight, waits, and comes again from somewhere else.
//
// Body: a skinned quadruped rig (one draw call) — low elongated torso, four long limbs solved with two-bone IK
// so the knees and elbows point at the sky, a small head hung below the shoulders with the mimic's smeared
// face. Matte black shiver material shared with the mimic (edge jitter ~0.03 m at ~20 Hz, noise dissolve).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './common.js';
import { makeBodyMaterial, skinify, makeFace } from './mimic.js';
import { hash3 } from '../core/rng.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';

// ---- module temporaries ----
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _cand = new THREE.Vector3();
const _hip = new THREE.Vector3(), _foot = new THREE.Vector3(), _pole = new THREE.Vector3(), _axis = new THREE.Vector3(), _upper = new THREE.Vector3(), _knee = new THREE.Vector3(), _fore = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);

// ---- rig layout ----
const BONES = ['body', 'chest', 'neck', 'head', 'pelvis', 'upFL', 'upFR', 'upHL', 'upHR', 'loFL', 'loFR', 'loHL', 'loHR'];
const bi = (n) => BONES.indexOf(n);
// human-ish limbs on a body carried high: the joints bend out and up, but only so far that it still reads as a
// person on all fours and not as a spider
const L1 = 0.42, L2 = 0.46;                    // upper / lower limb lengths
const TORSO_Y = 0.66, HIDDEN_Y = 0.09;
// legs: [name, side(-1 left / +1 right), fwd(-1 front / +1 hind), hip (body-local), rest foot (mesh), hidden foot (mesh), phase offset]
const LEGS = [
  { up: 'upFL', lo: 'loFL', side: -1, fwd: -1, hip: [-0.15, -0.03, -0.34], rest: [-0.33, 0, -0.50], flat: [-0.90, 0, -0.80], off: 0.50 },
  { up: 'upFR', lo: 'loFR', side: 1, fwd: -1, hip: [0.15, -0.03, -0.34], rest: [0.33, 0, -0.50], flat: [0.90, 0, -0.80], off: 0.63 },
  { up: 'upHL', lo: 'loHL', side: -1, fwd: 1, hip: [-0.15, -0.02, 0.36], rest: [-0.31, 0, 0.50], flat: [-0.90, 0, 0.82], off: 0.0 },
  { up: 'upHR', lo: 'loHR', side: 1, fwd: 1, hip: [0.15, -0.02, 0.36], rest: [0.31, 0, 0.50], flat: [0.90, 0, 0.82], off: 0.12 },
];

// One irregular tapered box in mesh space, bound to a bone. Taper along y (top/bottom) and z (front/back).
function part(w, h, d, x, y, z, bone, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 2);
  const pos = g.attributes.position, n = pos.count, jit = o.jitter ?? 0.012;
  for (let i = 0; i < n; i++) {
    let px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const ty = (py + h / 2) / h, tz = (pz + d / 2) / d;
    const sy = lerp(o.bottom ?? 1, o.top ?? 1, ty), sz = lerp(o.front ?? 1, o.back ?? 1, tz);
    px *= sy * sz; pz *= sy; py *= sz;
    const kx = Math.round(px * 1000) + 7, ky = Math.round(py * 1000) + 3, kz = Math.round(pz * 1000) + 11;
    pos.setXYZ(i, px + (hash3(kx, ky, kz) - 0.5) * jit, py + (hash3(ky, kz, kx) - 0.5) * jit, pz + (hash3(kz, kx, ky) - 0.5) * jit);
  }
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _m.makeRotationFromEuler(_e); _m.setPosition(x, y, z);
  g.applyMatrix4(_m); g.computeVertexNormals();
  return skinify(g, bi(bone));
}

let sharedGeo = null;
function buildGeometry() {
  if (sharedGeo) return sharedGeo;
  const parts = [
    // torso: three masses along the spine, the rear narrower; a ridge of vertebrae
    part(0.30, 0.21, 0.50, 0, TORSO_Y, 0.02, 'body', { top: 0.86, back: 0.9, jitter: 0.018 }),
    part(0.10, 0.06, 0.62, 0, TORSO_Y + 0.11, 0.0, 'body', { back: 0.7, jitter: 0.02 }),
    part(0.34, 0.24, 0.32, 0, TORSO_Y + 0.005, -0.30, 'chest', { front: 0.82, top: 0.9, jitter: 0.016 }),
    part(0.26, 0.19, 0.30, 0, TORSO_Y - 0.01, 0.34, 'pelvis', { back: 0.66, top: 0.9, jitter: 0.016 }),
    // neck slopes down and forward; the head hangs under the shoulder line
    part(0.11, 0.11, 0.25, 0, TORSO_Y - 0.10, -0.61, 'neck', { rx: -0.72, front: 0.85, jitter: 0.01 }),
    part(0.14, 0.15, 0.18, 0.004, TORSO_Y - 0.225, -0.735, 'head', { rx: 0.25, top: 0.85, front: 0.8, jitter: 0.02 }),
    part(0.07, 0.05, 0.06, -0.005, TORSO_Y - 0.28, -0.79, 'head', { rx: 0.3, jitter: 0.015 }),   // jaw
  ];
  for (const L of LEGS) {
    const hx = L.hip[0], hy = TORSO_Y + L.hip[1], hz = L.hip[2];
    parts.push(part(0.11, 0.10, 0.12, hx + L.side * 0.02, hy + 0.01, hz, L.up, { jitter: 0.02 }));                       // shoulder / hip knot
    parts.push(part(0.10, L1, 0.10, hx, hy - L1 / 2, hz, L.up, { bottom: 0.72, jitter: 0.012 }));                       // upper limb
    parts.push(part(0.085, 0.085, 0.085, hx, hy - L1, hz, L.lo, { jitter: 0.02 }));                                       // knee knot
    parts.push(part(0.075, L2, 0.075, hx, hy - L1 - L2 / 2 + 0.02, hz, L.lo, { bottom: 0.68, jitter: 0.01 }));         // lower limb
    parts.push(part(0.09, 0.035, 0.17, hx, hy - L1 - L2 + 0.03, hz - 0.05, L.lo, { front: 0.55, jitter: 0.012 }));      // long flat foot (a hand, nearly)
  }
  sharedGeo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  sharedGeo.userData.shared = true;
  return sharedGeo;
}

let rng = null;
const SPEED = { charge: 8, retreat: 6, stalk: 3.2 };

class Slider extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'slider', position, Object.assign({ hp: 60 }, opts));
    this.radius = 0.55; this.height = 0.3; this.speed = SPEED.charge;
    // ---- rig ----
    const bones = this.bones = []; const B = this.B = {};
    const mk = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); B[name] = b; return b; };
    mk('body', null, 0, TORSO_Y, 0);
    mk('chest', B.body, 0, 0.005, -0.30);
    mk('neck', B.chest, 0, -0.03, -0.22);
    mk('head', B.neck, 0, -0.145, -0.185);
    mk('pelvis', B.body, 0, -0.01, 0.34);
    for (const L of LEGS) { mk(L.up, B.body, L.hip[0], L.hip[1], L.hip[2]); mk(L.lo, B[L.up], 0, -L1, 0); }
    this.material = makeBodyMaterial({ albedo: 0.02 });
    this.mu = this.material.userData.u;
    const mesh = this.mesh = new THREE.SkinnedMesh(buildGeometry(), this.material);
    mesh.castShadow = true; mesh.receiveShadow = false;
    mesh.add(B.body); mesh.bind(new THREE.Skeleton(bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 2.0);
    this.root.add(mesh);
    this.face = makeFace(0.15, 2.2); this.faceU = this.face.material.uniforms; this.faceU.uFade.value = 0;
    this.root.add(this.face);
    // ---- animation state ----
    this.rise = 0; this.riseTarget = 0; this.phase = rng.range(0, TAU); this.moveSpeed = 0; this.gait = 0;
    this.legPhase = new Float32Array(4); this.legWander = new Float32Array(4); this.legDouble = new Float32Array(4); this.legExtra = new Float32Array(4); this.legWasDown = new Uint8Array(4);
    this.footPos = LEGS.map((L) => new THREE.Vector3(L.flat[0], L.flat[1], L.flat[2]));
    this.flinch = 0; this.crouch = 0; this.stretch = 0; this.headYaw = 0; this.headPitch = 0; this.roll = 0; this.pitch = 0;
    this.glitchT = rng.range(1.5, 4); this.glitchLeft = 0; this.glitch = new Float32Array(8);
    this.doubleT = rng.range(0.8, 2.5); this.stepT = 0; this.breath = rng.range(0, TAU);
    // ---- AI state ----
    this.clickT = rng.range(1, 3); this.target = null; this.waitT = 0; this.obsT = 0; this.observed = true; this.watchedT = 0;
    this.approachBearing = 0; this.lungeHit = false; this.leapT = 0; this.awayT = 0; this.lostT = 0; this.circleDir = 1;
    this.deathDuration = 2.1; this.ashDone = false;
    // ambush: settle into a registered hiding spot if one is close and still out of view
    if (!opts.wanderer) this.settleIntoHide();
    this.setState('hidden');
    this.syncRoot(); this.root.updateMatrixWorld(true);
    this.animate(0.016, this.distanceToPlayer());
  }
  settleIntoHide() {
    const w = this.ctx.world; let best = null, bd = 7;
    for (const h of w.hidingSpots) { const d = h.position.distanceTo(this.position); if (d < bd) { bd = d; best = h; } }
    if (!best) return;
    const ox = this.position.x, oy = this.position.y, oz = this.position.z;
    this.position.copy(best.position);
    if (this.observedByPlayer(70) || this.distanceToPlayer() < 25) this.position.set(ox, oy, oz);
  }
  onStateChange(s) {
    if (s === 'hidden') { this.riseTarget = 0; this.radius = 0.55; this.height = 0.3; }
    else { this.riseTarget = 1; this.radius = 0.45; this.height = 1.0; }
  }
  setEngaged(v) {
    if (v && !this.engaged) { this.engaged = true; this.aware = 1; this.ctx.director?.notify('spotted', { enemy: this }); }
    else if (!v && this.engaged) { this.engaged = false; this.ctx.director?.notify('lost', { enemy: this }); }
  }
  // ---- helpers ----
  bearingFromPlayer() { const p = this.player.position; return Math.atan2(this.position.z - p.z, this.position.x - p.x); }
  // would a thing at (x,y,z) be inside the player's view cone with a line of sight?
  seenByPlayer(x, y, z, halfAngle = 55) {
    const cam = this.ctx.camera; cam.getWorldDirection(_dir);
    _v.set(x, y + 0.5, z).sub(this.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    if (_dir.dot(_v) < Math.cos(halfAngle * DEG)) return false;
    return this.ctx.world.lineOfSight(this.player.eye, _v2.set(x, y + 0.5, z));
  }
  walkable(x, z, out) {
    const w = this.ctx.world;
    if (Math.abs(x) > w.half - 6 || Math.abs(z) > w.half - 6) return null;
    if (w.isWater(x, z)) return null;
    const y = w.groundHeight(x, z, w.getHeight(x, z) + 2).y;
    if (w.pointInSolid(x, y + 0.5, z)) return null;
    if (w.isInBase(_v3.set(x, y, z))) return null;
    return out.set(x, y, z);
  }
  // a point 20-30 m from the player, preferably out of their view and not too far from here
  pickRetreatPoint() {
    const p = this.player.position, cur = this.bearingFromPlayer();
    let best = null, bs = -1e9;
    for (let i = 0; i < 14; i++) {
      const a = cur + rng.range(-1, 1) * (i < 7 ? 110 : 180) * DEG, d = rng.range(20, 30);
      const pt = this.walkable(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, _cand);
      if (!pt) continue;
      let score = -pt.distanceTo(this.position) * 0.06;
      if (!this.seenByPlayer(pt.x, pt.y, pt.z, 60)) score += 3;
      if (!this.ctx.world.lineOfSight(this.player.eye, _v2.set(pt.x, pt.y + 0.5, pt.z))) score += 1.5;
      if (score > bs) { bs = score; best = pt.clone(); }
    }
    return best || this.walkable(p.x + Math.cos(cur) * 24, p.z + Math.sin(cur) * 24, _v)?.clone() || this.home.clone();
  }
  // come again from a different bearing: a point ~13 m from the player, 100-180 degrees around from the last approach
  pickApproachPoint() {
    const p = this.player.position;
    for (let i = 0; i < 10; i++) {
      const a = this.approachBearing + this.circleDir * rng.range(100, 180) * DEG + (i > 4 ? rng.range(-0.8, 0.8) : 0);
      const pt = this.walkable(p.x + Math.cos(a) * rng.range(12, 14.5), p.z + Math.sin(a) * rng.range(12, 14.5), _v);
      if (pt) return pt.clone();
    }
    return this.player.position.clone();
  }
  startCharge() {
    this.setState('charge');
    this.setEngaged(true);
    this.approachBearing = this.bearingFromPlayer();
    this.sound('slider_screech', { gain: 1.0, max: 90, ref: 4 });
    this.startGlitch(1.2); this.glitchLeft = 0.08;
    this.watchedT = 0;
  }
  startRetreat() {
    this.setState('retreat');
    this.target = this.pickRetreatPoint();
    this.waitT = rng.range(4, 10);
  }
  // ---- reactions ----
  onHit(amount, info) {
    this.sound('slider_hit', { gain: 0.8 });
    this.flinch = 1; this.startGlitch(0.8); this.glitchLeft = 0.07;
    if (!this.alive) return;
    switch (this.state) {
      case 'hidden': this.startCharge(); break;
      case 'charge': if (this.stateT > 0.4) this.startRetreat(); break;
      case 'lunge': break;
      case 'circle': if (this.distanceToPlayer() < 16 && rng.chance(0.4)) this.startCharge(); else this.startRetreat(); break;
      case 'retreat': if (this.stateT > 3 && rng.chance(0.3)) { this.target = this.pickRetreatPoint(); } break;
    }
  }
  onDeath() {
    this.sound('slider_death', { gain: 1.0, max: 90 });
    this.target = null;
    this.setEngaged(false);
  }
  deathTick(dt) {
    const t = this.deathT;
    // crumple: the limbs fold up and in, the body drops, the head goes last
    const f = clamp01(t / 0.55), fe = 1 - Math.pow(1 - f, 3);
    this.rise = lerp(this.rise, 0.0, fe);
    for (let i = 0; i < 4; i++) { const L = LEGS[i]; _foot.set(L.side * (0.5 - 0.22 * fe), 0, L.fwd * (0.45 - 0.15 * fe)); this.footPos[i].lerp(_foot, Math.min(1, dt * 12)); }
    this.crouch = fe; this.flinch = damp(this.flinch, 0, 6, dt);
    this.pose(dt, 0, 0, TORSO_Y - 0.36 * fe, 0.25 * fe, 0.35 * fe, 0.9 * fe);
    this.faceU.uFade.value = Math.max(0, 1 - t / 0.3); this.faceU.uTime.value = this.time;
    this.mu.uTime.value = this.time;
    if (t >= 0.55) {
      if (!this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.2, this.position.z), 70); this.mesh.castShadow = false; }
      this.mu.uDissolve.value = clamp01((t - 0.55) / 1.3);
      this.mu.uShiver.value = 1 + (t - 0.55) * 2;
    }
    this.face.visible = t < 0.35;
  }
  onDispose() { this.face.material.dispose(); this.mesh.skeleton.dispose(); }

  // ---- AI ----
  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time;
    this.followGround(dt, 40);
    const d = this.distanceToPlayer();
    const prevX = this.position.x, prevZ = this.position.z;
    // throttled "is the player looking at me" test
    this.obsT += dt; if (this.obsT > 0.12) { this.obsT = 0; this.observed = this.observedByPlayer(40); }
    this.flinch = damp(this.flinch, 0, 7, dt);
    let headYaw = 0, headPitch = 0, torsoY = TORSO_Y, crouch = 0, stretch = 0;
    // head tracking values (computed without a per-frame closure)
    const trackYaw = angleDelta(this.yaw, Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z)));
    const trackPitch = Math.atan2(p.eye.y - (this.position.y + TORSO_Y * 0.7), Math.max(1, d));
    const canCharge = !p.dead && !p.inBase && ((d < 15 && !this.observed) || d < 6);

    switch (this.state) {
      case 'hidden': {
        // a dark patch. the clicks are the only tell.
        this.aware = damp(this.aware, d < 30 && !p.inBase ? 0.5 : 0, 0.8, dt);
        this.clickT -= dt;
        if (this.clickT <= 0) { this.clickT = rng.range(1.5, 4); if (d < 30 && !p.inBase) this.sound('slider_click', { gain: 0.55, max: 36, ref: 2, rate: rng.range(0.9, 1.15) }); }
        torsoY = HIDDEN_Y;
        if (canCharge) this.startCharge();
        break;
      }
      case 'charge': {
        headYaw = trackYaw; headPitch = trackPitch;
        // zigzag: lateral sinusoid across the line to the player, amplitude 1.5 m, period 0.7 s
        _dir.set(p.position.x - this.position.x, 0, p.position.z - this.position.z); const len = _dir.length() || 1; _dir.divideScalar(len);
        const lat = Math.sin((this.stateT / 0.7) * TAU) * 1.5 * clamp01((d - 2) / 5);
        _v.set(p.position.x - _dir.z * lat, p.position.y, p.position.z + _dir.x * lat);
        if (this.rise > 0.6) this.moveToward(_v, SPEED.charge, dt, { stop: 0.6, face: false, allowWater: true });
        this.faceToward(p.position.x, p.position.z, dt, 14);
        stretch = clamp01(this.moveSpeed / 6);
        if (d < 2.2 && this.rise > 0.6) { this.setState('lunge'); this.lungeHit = false; this.leapT = 0; this.sound('slider_lunge', { gain: 1.0, max: 40 }); }
        else if (this.stateT > 12 || p.dead || p.inBase) this.startRetreat();
        break;
      }
      case 'lunge': {
        headYaw = trackYaw; headPitch = trackPitch;
        this.faceToward(p.position.x, p.position.z, dt, 16);
        if (this.stateT < 0.25) { crouch = clamp01(this.stateT / 0.2); }
        else {
          if (!this.lungeHit) {
            this.lungeHit = true;
            if (d < 2.6 && !p.dead) { this.hurtPlayer(25, 'slash'); ctx.post.shake(0.9); }
            else ctx.post.shake(0.25);
            this.leapT = 0.22;
          }
          stretch = 1;
          if (this.leapT > 0) { this.leapT -= dt; _dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); _v.copy(this.position).addScaledVector(_dir, 3); this.moveToward(_v, 7, dt, { stop: 0.3, face: false, allowWater: true }); }
          if (this.stateT > 0.6) this.startRetreat();
        }
        break;
      }
      case 'retreat': {
        if (this.target) { const rem = this.moveToward(this.target, SPEED.retreat, dt, { stop: 1.0, allowWater: true }); if (rem <= 1.0 || this.stateT > 9) { this.setState('circle'); this.target = null; this.clickT = rng.range(1, 2.5); } }
        else this.startRetreat();
        headYaw = Math.sin(t * 2.1) * 0.5;
        break;
      }
      case 'circle': {
        headYaw = trackYaw; headPitch = trackPitch;
        this.clickT -= dt; if (this.clickT <= 0) { this.clickT = rng.range(2, 5); if (d < 45) this.sound('slider_click', { gain: 0.5, max: 45, ref: 2, rate: rng.range(0.85, 1.1) }); }
        if (!this.target) {
          // wait low at the retreat point, then choose a new bearing
          torsoY = TORSO_Y - 0.18; crouch = 0.35;
          this.waitT -= dt;
          this.faceToward(p.position.x, p.position.z, dt, 3);
          if (this.waitT <= 0) { this.circleDir = rng.chance(0.5) ? 1 : -1; this.target = this.pickApproachPoint(); this.watchedT = 0; }
        } else if (d > 15.5) {
          const rem = this.moveToward(this.target, SPEED.retreat, dt, { stop: 1.0, allowWater: true });
          if (rem <= 1.0) { this.target = this.player.position.clone(); }
        } else {
          // inside fifteen metres: go when they look away; when watched, stalk sideways low and slow
          if (canCharge || this.watchedT > 10) { this.startCharge(); break; }
          this.watchedT += dt; crouch = 0.45; torsoY = TORSO_Y - 0.16;
          const b = this.bearingFromPlayer() + this.circleDir * 0.35;
          const r = clamp(d, 11, 14);
          _v.set(p.position.x + Math.cos(b) * r, p.position.y, p.position.z + Math.sin(b) * r);
          if (this.ctx.world.isWater(_v.x, _v.z) || Math.abs(_v.x) > this.ctx.world.half - 6 || Math.abs(_v.z) > this.ctx.world.half - 6) this.circleDir = -this.circleDir;
          this.moveToward(_v, SPEED.stalk, dt, { stop: 0.4, face: false, allowWater: true });
          this.faceToward(p.position.x, p.position.z, dt, 6);
        }
        // the player has gone: go to ground again
        if (d > 60 || p.inBase) { this.lostT += dt; if (this.lostT > 12) { this.lostT = 0; this.setEngaged(false); this.aware = 0; this.home.copy(this.position); this.setState('hidden'); this.target = null; } } else this.lostT = 0;
        break;
      }
    }
    if (this.state !== 'hidden') this.setEngaged(true);
    // rise / crouch / stretch blending
    this.rise = damp(this.rise, this.riseTarget, this.riseTarget > this.rise ? 11 : 6, dt);
    this.crouch = damp(this.crouch, crouch, 12, dt);
    this.stretch = damp(this.stretch, stretch, 8, dt);
    this.headYaw = dampAngle(this.headYaw, clamp(headYaw, -1.25, 1.25), this.state === 'hidden' ? 2 : 9, dt);
    this.headPitch = damp(this.headPitch, clamp(headPitch, -0.5, 0.6), 6, dt);
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.moveSpeed = damp(this.moveSpeed, dt > 0 ? mv / dt : 0, 10, dt);
    this.animate(dt, d, torsoY);
  }
  syncRoot() { this.root.position.copy(this.position); this.root.rotation.y = this.yaw; }
  startGlitch(s = 1) { for (let i = 0; i < 8; i++) this.glitch[i] = (Math.random() - 0.5) * s * (Math.random() < 0.5 ? 0.5 : 0.12); this.glitchOn = true; }

  // ---- animation ----
  animate(dt, d, torsoY = TORSO_Y) {
    const t = this.time;
    // pose glitch: every 1.5-4 s the pose snaps wrong for ~60 ms
    if (this.glitchLeft > 0) { this.glitchLeft -= dt; if (this.glitchLeft <= 0) this.glitchOn = false; }
    else { this.glitchT -= dt; if (this.glitchT <= 0) { this.glitchT = rng.range(1.5, 4); this.glitchLeft = 0.06; this.startGlitch(1); } }
    // gait: phase runs with speed; one cycle covers four half-strides of ground
    const S = 0.42, lift = 0.30;
    const sf = clamp01(this.moveSpeed / 3);
    this.gait = damp(this.gait, sf, 9, dt);
    const g = this.gait;
    const rate = (this.moveSpeed / (4 * S)) * TAU;
    this.phase += rate * dt;
    // deliberately wrong timing: per-leg wander, and every so often one leg runs a double beat
    this.doubleT -= dt;
    if (this.doubleT <= 0 && g > 0.3) { this.doubleT = rng.range(0.8, 2.5); this.legDouble[rng.int(0, 3)] = TAU; }
    for (let i = 0; i < 4; i++) {
      this.legWander[i] = damp(this.legWander[i], Math.sin(t * (0.7 + i * 0.23) + i * 2.1) * 0.35, 1.5, dt);
      // a double beat: the leg runs at twice the rate for one whole cycle, then is back in step
      if (this.legDouble[i] > 0) { const step = Math.min(this.legDouble[i], rate * dt); this.legDouble[i] -= step; this.legExtra[i] += step; }
      this.legPhase[i] = this.phase + LEGS[i].off * TAU + this.legWander[i] + this.legExtra[i];
    }
    // body: bob, rocking pitch, roll; low to the ground; breathing when still
    this.breath += dt * 1.7;
    const ph = this.phase;
    const bob = (-0.045 * Math.cos(ph + 0.4) + 0.012 * Math.cos(2 * ph)) * g;
    const rise = this.rise, up = 1 - Math.pow(1 - rise, 2);
    const y = lerp(HIDDEN_Y, torsoY, up) + bob - this.crouch * 0.16 + Math.sin(this.breath) * 0.012 * (1 - g) * rise + this.stretch * 0.02;
    const pitch = (0.13 * Math.sin(ph) * g + 0.02 * Math.sin(this.breath)) * rise - this.crouch * 0.25 + this.stretch * 0.08 + this.flinch * 0.3;
    const roll = (0.06 * Math.sin(ph + 1.2) * g) * rise + this.flinch * 0.15;
    // feet: hidden splay vs gait targets in mesh space
    for (let i = 0; i < 4; i++) {
      const L = LEGS[i], lp = this.legPhase[i], s = Math.sin(lp), c = Math.cos(lp);
      const swing = Math.max(0, s);
      const fz = L.rest[2] + S * c * g + this.stretch * (L.fwd < 0 ? -0.18 : 0.12) - this.crouch * 0.12 * L.fwd;
      const fy = Math.pow(swing, 0.7) * lift * g;
      const fx = L.rest[0] + L.side * (0.04 * Math.sin(lp * 0.5 + i) * g + this.crouch * 0.08);
      _foot.set(lerp(L.flat[0], fx, up), lerp(0, fy, up), lerp(L.flat[2], fz, up));
      this.footPos[i].lerp(_foot, Math.min(1, dt * 30));
      // footfall: the foot comes down when its swing ends
      const down = s < 0 ? 1 : 0;
      if (down && !this.legWasDown[i] && L.fwd > 0 && g > 0.25 && d < 45 && this.stepT <= 0) { this.stepT = 0.09; this.sound('slider_step', { gain: 0.25 + 0.35 * clamp01(this.moveSpeed / 8), max: 45, ref: 2, rate: 1.15 + Math.random() * 0.25 }); }
      this.legWasDown[i] = down;
    }
    this.stepT -= dt;
    this.pose(dt, pitch, roll, y, this.crouch, this.stretch, 0);
    // face: on the head, turned to the camera; only shows once it has risen
    this.syncRoot();
    this.B.head.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(this.B.head.matrixWorld);
    _v2.copy(this.ctx.player.eye).sub(_v); const fl = _v2.length() || 1; _v2.divideScalar(fl);
    _v.addScaledVector(_v2, 0.1);
    this.root.worldToLocal(this.face.position.copy(_v));
    this.face.lookAt(this.ctx.player.eye);
    this.faceU.uTime.value = t;
    this.faceU.uFade.value = this.alive ? clamp01((rise - 0.25) / 0.5) * (0.7 + 0.3 * clamp01(this.aware)) : 0;
    this.faceU.uGlow.value = 1.9 + clamp01(this.aware) * 1.1 + this.ctx.time.night * 0.5;
    this.mu.uTime.value = t;
    this.mu.uShiver.value = lerp(0.3, 1, rise) + this.flinch * 2 + (this.state === 'charge' ? 0.5 : 0);
  }
  // write the skeleton: torso transform, spine, head, two-bone IK legs
  pose(dt, pitch, roll, y, crouch, stretch, fold) {
    const B = this.B, gl = this.glitchOn ? this.glitch : null;
    const body = B.body;
    body.position.set(gl ? gl[0] * 0.1 : 0, y + (gl ? Math.abs(gl[1]) * 0.08 : 0), 0);
    body.rotation.set(pitch + (gl ? gl[2] * 0.4 : 0), gl ? gl[3] * 0.3 : 0, roll + (gl ? gl[4] * 0.3 : 0));
    body.updateMatrix();
    // spine: the chest dips with the crouch, the pelvis rides high when stretched
    B.chest.rotation.set(-crouch * 0.25 + stretch * 0.1 + (gl ? gl[5] * 0.3 : 0), 0, 0);
    B.pelvis.rotation.set(crouch * 0.2 - stretch * 0.12, 0, 0);
    // the head hangs under the shoulders; when hidden the neck lifts so the head lies flat, chin on the ground
    const flat = lerp(0.6, 0, this.rise) + fold * 0.6;
    B.neck.rotation.set(flat + this.headPitch * 0.3, this.headYaw * 0.4, 0);
    B.head.rotation.set(flat * 0.5 + this.headPitch * 0.7 + (gl ? gl[6] * 0.5 : 0), this.headYaw * 0.6 + (gl ? gl[7] * 0.4 : 0), 0);
    // legs
    _qi.copy(body.quaternion).invert();
    for (let i = 0; i < 4; i++) {
      const L = LEGS[i], up = B[L.up], lo = B[L.lo];
      _hip.set(L.hip[0], L.hip[1], L.hip[2]).applyMatrix4(body.matrix);
      _foot.copy(this.footPos[i]);
      _pole.set(L.side * lerp(1.0, 0.45, this.rise), lerp(0.25, 1.0, this.rise) + fold * 0.6, L.fwd * 0.3 * this.rise).normalize();
      this.solveLeg(up, lo, _hip, _foot, _pole);
    }
  }
  solveLeg(upBone, loBone, hip, foot, pole) {
    _dir.subVectors(foot, hip); let dd = _dir.length();
    const maxD = (L1 + L2) * 0.995; if (dd > maxD) dd = maxD; if (dd < 0.05) dd = 0.05;
    _dir.normalize();
    const cosA = clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1);
    const ang = Math.acos(cosA);
    _axis.crossVectors(_dir, pole); if (_axis.lengthSq() < 1e-6) _axis.set(0, 0, 1); _axis.normalize();
    _upper.copy(_dir).applyAxisAngle(_axis, ang);
    _knee.copy(hip).addScaledVector(_upper, L1);
    _fore.subVectors(foot, _knee).normalize();
    // into the body bone's space, then the upper bone's
    _upper.applyQuaternion(_qi); _fore.applyQuaternion(_qi);
    upBone.quaternion.setFromUnitVectors(DOWN, _upper);
    _q.copy(upBone.quaternion).invert();
    _fore.applyQuaternion(_q);
    loBone.quaternion.setFromUnitVectors(DOWN, _fore);
  }
}

export function registerSlider(ctx) {
  rng = ctx.rng.fork(41);
  ctx.enemies.registerType('slider', Slider);
}
