// Slider — a mimic that runs on all fours, too fast, joints wrong. It lies flat in the grass or under a wreck
// as a dark patch you would walk past, clicks its tongue at you from thirty metres, and when you look away it
// rises, screeches and comes in zigzags at eight metres a second. After a lunge (or a bullet) it runs out of
// your sight, waits, and comes again from somewhere else.
//
// v2: they hunt in pairs. One shows itself at twenty metres and clicks to hold your eyes; the other comes at
// your back while you are turned. They lie on roofs and in doorways and drop onto you from the eave. If you
// hold your sights on one for most of a second it breaks off with a mocking click. A flashbang stuns it, smoke
// breaks its charge.
//
// Body: a skinned quadruped rig (one draw call) — low elongated torso, four long limbs solved with two-bone IK
// so the knees and elbows point at the sky, a small head hung below the shoulders with the mimic's smeared
// face. Matte black shiver material shared with the mimic (edge jitter ~0.03 m at ~20 Hz, noise dissolve).
// When the characters module lands a real quadruped (buildQuadruped without the stub flag) that rig is used.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './common.js';
import { makeBodyMaterial, skinify, makeFace } from './mimic.js';
import { buildQuadruped } from './charmesh.js';
import { hash3 } from '../core/rng.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';

// ---- module temporaries ----
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _cand = new THREE.Vector3(), _cam = new THREE.Vector3();
const _hip = new THREE.Vector3(), _foot = new THREE.Vector3(), _pole = new THREE.Vector3(), _axis = new THREE.Vector3(), _upper = new THREE.Vector3(), _knee = new THREE.Vector3(), _fore = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);
const COS_AIM = Math.cos(6 * DEG);

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
const SPEED = { charge: 8, retreat: 6, stalk: 3.2, drop: 9 };
const GRAVITY = 22;

class Slider extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'slider', position, Object.assign({ hp: 60 }, opts));
    this.radius = 0.55; this.height = 0.3; this.speed = SPEED.charge;
    // ---- rig: the characters module's quadruped when it is real, else the built-in skinned rig ----
    this.rig = null;
    let ext = null;
    try { ext = buildQuadruped({ kind: 'slider' }); } catch (e) { ext = null; }
    if (ext && ext.root && !ext.stub) { this.rig = ext; this.root.add(ext.root); }
    else if (ext && ext.dispose) ext.dispose();
    if (!this.rig) {
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
    }
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
    // v2: pairs, roofs, the aimed-at break, stun, smoke
    this.pairId = opts.pairId ?? null; this.partner = null; this.role = null; this.struck = false; this.pairT = rng.range(0.3, 1.2);
    this.aimedT = 0; this.decoyT = 0; this.resumeDecoy = false; this.mockT = 0;
    this.stunLeft = 0; this.stunSeen = false; this.smokeT = 0; this.smoked = false;
    this.onRoof = false; this.hideKind = null; this.dropVel = new THREE.Vector3(); this.dropOnto = false;
    this.deathDuration = 2.1; this.ashDone = false;
    // ambush: settle into a registered hiding spot if one is close and still out of view
    if (!opts.wanderer) this.settleIntoHide();
    this.findPartner();
    this.setState('hidden');
    this.syncRoot(); this.root.updateMatrixWorld(true);
    this.animate(0.016, this.distanceToPlayer());
  }
  // ---- hiding spots: ground patches, doorways and roofs. A spot is a roof when it is tagged so or lies well above the terrain.
  hideKindOf(h) {
    if (h.kind) return h.kind;
    const w = this.ctx.world;
    return h.position.y - w.getHeight(h.position.x, h.position.z) > 1.6 ? 'roof' : 'ground';
  }
  settleIntoHide() {
    const w = this.ctx.world; let best = null, bd = 7;
    for (const h of w.hidingSpots) { const d = h.position.distanceTo(this.position); if (d < bd) { bd = d; best = h; } }
    if (!best) return;
    const ox = this.position.x, oy = this.position.y, oz = this.position.z;
    this.position.copy(best.position);
    if (this.observedByPlayer(70) || this.distanceToPlayer() < 25) { this.position.set(ox, oy, oz); return; }
    this.hideKind = this.hideKindOf(best);
    this.onRoof = this.hideKind === 'roof';
    if (this.onRoof) { this.position.y = w.groundHeight(this.position.x, this.position.z, best.position.y + 0.5).y; this.home.copy(this.position); }
  }
  // ---- pairs: the other slider of this POI (or the same pairId) hunts with this one ----
  findPartner() {
    if (this.partner) return;
    for (const e of this.ctx.enemies.list) {
      if (e === this || e.type !== 'slider' || !e.alive || e.partner) continue;
      const match = this.pairId != null ? e.pairId === this.pairId : (!!this.poi && e.poi === this.poi && e.position.distanceTo(this.position) < 45);
      if (!match) continue;
      this.partner = e; e.partner = this;
      if (this.pairId == null) { this.pairId = 'p' + Math.floor(rng() * 1e6); e.pairId = this.pairId; }
      break;
    }
  }
  partnerAlive() { return !!(this.partner && this.partner.alive && !this.partner.removeMe); }
  // the pair wakes: the one more in front of the player shows itself, the other goes round the back
  pairEngage() {
    const q = this.partner, p = this.player, f = p.forward;
    const dotA = ((this.position.x - p.position.x) * f.x + (this.position.z - p.position.z) * f.z) / Math.max(1, this.distanceToPlayer());
    const dotB = ((q.position.x - p.position.x) * f.x + (q.position.z - p.position.z) * f.z) / Math.max(1, q.distanceToPlayer());
    const decoy = dotA >= dotB ? this : q, striker = decoy === this ? q : this;
    decoy.startDecoy();
    striker.startStrike();
  }
  startDecoy() {
    this.role = 'decoy'; this.struck = false; this.decoyT = 0; this.resumeDecoy = false;
    this.target = this.pickDecoyPoint();
    this.setState('decoy'); this.setEngaged(true);
    this.clickT = rng.range(0.4, 0.9);
  }
  startStrike() {
    this.role = 'striker'; this.struck = false;
    this.setEngaged(true);
    this.setState('circle');
    this.circleDir = rng.chance(0.5) ? 1 : -1;
    this.target = this.pickApproachPoint(true);
    this.watchedT = 0; this.clickT = 1e9;   // the striker keeps quiet
  }
  onStateChange(s) {
    if (s === 'hidden') { this.riseTarget = 0; this.radius = 0.55; this.height = 0.3; }
    else { this.riseTarget = 1; this.radius = 0.45; this.height = 1.0; }
    if (s !== 'drop') this.flying = false;
  }
  setEngaged(v) {
    if (v && !this.engaged) { this.engaged = true; this.aware = 1; this.ctx.director?.notify('spotted', { enemy: this }); }
    else if (!v && this.engaged) { this.engaged = false; this.ctx.director?.notify('lost', { enemy: this }); }
  }
  // ---- helpers ----
  bearingFromPlayer() { const p = this.player.position; return Math.atan2(this.position.z - p.z, this.position.x - p.x); }
  viewBearing() { const f = this.player.forward; return Math.atan2(f.z, f.x); }
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
  // come again from a different bearing: a point ~13 m from the player, 100-180 degrees around from the last approach.
  // a striker takes the player's back instead: within 40 degrees of straight behind.
  pickApproachPoint(behind = false) {
    const p = this.player.position;
    for (let i = 0; i < 10; i++) {
      const a = behind
        ? this.viewBearing() + Math.PI + rng.range(-40, 40) * DEG + (i > 4 ? rng.range(-0.8, 0.8) : 0)
        : this.approachBearing + this.circleDir * rng.range(100, 180) * DEG + (i > 4 ? rng.range(-0.8, 0.8) : 0);
      const pt = this.walkable(p.x + Math.cos(a) * rng.range(12, 14.5), p.z + Math.sin(a) * rng.range(12, 14.5), _v);
      if (pt) return pt.clone();
    }
    return this.player.position.clone();
  }
  // the decoy's stage: 18-22 m out, inside the player's view, with a line of sight so the silhouette reads
  pickDecoyPoint() {
    const p = this.player.position, vb = this.viewBearing();
    let best = null, bs = -1e9;
    for (let i = 0; i < 8; i++) {
      const a = vb + rng.range(-28, 28) * DEG, d = rng.range(18, 22);
      const pt = this.walkable(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, _cand);
      if (!pt) continue;
      let score = -pt.distanceTo(this.position) * 0.05;
      if (this.ctx.world.lineOfSight(this.player.eye, _v2.set(pt.x, pt.y + 0.6, pt.z))) score += 3;
      if (score > bs) { bs = score; best = pt.clone(); }
    }
    return best || this.walkable(p.x + Math.cos(vb) * 20, p.z + Math.sin(vb) * 20, _v)?.clone() || this.position.clone();
  }
  startCharge() {
    this.setState('charge');
    this.setEngaged(true);
    this.approachBearing = this.bearingFromPlayer();
    this.sound('slider_screech', { gain: 1.0, max: 90, ref: 4 });
    this.startGlitch(1.2); this.glitchLeft = 0.08;
    this.watchedT = 0; this.smoked = false;
  }
  startRetreat() {
    this.setState('retreat');
    this.target = this.pickRetreatPoint();
    this.waitT = rng.range(4, 10);
  }
  // the roof ambush: a leap from the eave. onto = true lands on the player; otherwise it jumps down toward them and charges
  startDrop(onto) {
    const p = this.player;
    this.setState('drop'); this.flying = true; this.dropOnto = onto; this.setEngaged(true);
    this.approachBearing = this.bearingFromPlayer();
    const tx = p.position.x + p.forward.x * (onto ? 0.2 : 1.5), tz = p.position.z + p.forward.z * (onto ? 0.2 : 1.5);
    const dx = tx - this.position.x, dz = tz - this.position.z, dist = Math.hypot(dx, dz) || 1;
    const T = Math.max(onto ? 0.42 : 0.55, dist / SPEED.drop);
    this.dropVel.set(dx / T, onto ? 2.4 : 1.8, dz / T);
    this.sound('slider_screech', { gain: 1.0, max: 90, ref: 4, rate: 1.15 });
    this.startGlitch(1.2); this.glitchLeft = 0.08;
  }
  // it breaks off with a click when your sights sit on it
  mock() {
    this.aimedT = 0; this.mockT = 3;
    this.sound('slider_click', { gain: 0.8, max: 60, ref: 3, rate: rng.range(1.45, 1.6) });
    this.startGlitch(1); this.glitchLeft = 0.08;
    if (this.role === 'decoy' && this.partnerAlive() && !this.partner.struck) this.resumeDecoy = true;
    this.startRetreat(); this.waitT = rng.range(1.5, 4);
  }
  // ---- reactions ----
  onHit(amount, info) {
    this.sound('slider_hit', { gain: 0.8 });
    this.flinch = 1; this.startGlitch(0.8); this.glitchLeft = 0.07;
    if (!this.alive) return;
    if (this.stunLeft > 0) return;
    switch (this.state) {
      case 'hidden': if (this.onRoof) this.startDrop(this.distanceToPlayer() < 5); else this.startCharge(); break;
      case 'charge': if (this.stateT > 0.4) this.startRetreat(); break;
      case 'lunge': case 'drop': break;
      case 'decoy': this.role = null; this.resumeDecoy = false; this.startRetreat(); break;
      case 'circle': if (this.distanceToPlayer() < 16 && rng.chance(0.4)) this.startCharge(); else this.startRetreat(); break;
      case 'retreat': if (this.stateT > 3 && rng.chance(0.3)) { this.target = this.pickRetreatPoint(); } break;
    }
  }
  onDeath() {
    this.sound('slider_death', { gain: 1.0, max: 90 });
    this.target = null; this.flying = false;
    if (this.partner && this.partner.partner === this) { this.partner.partner = null; if (this.partner.state === 'decoy') { this.partner.role = null; } }
    this.partner = null;
    this.setEngaged(false);
    if (this.rig) this.rig.setState?.({ dead: true, speed: 0 });
  }
  deathTick(dt) {
    const t = this.deathT;
    if (this.rig) {
      this.rig.update?.(dt);
      this.faceU.uFade.value = Math.max(0, 1 - t / 0.3); this.faceU.uTime.value = this.time; this.face.visible = t < 0.35;
      if (t >= 0.55 && !this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.2, this.position.z), 70); }
      if (t >= 1.2) this.rig.root.visible = false;
      return;
    }
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
  onDispose() { this.face.material.dispose(); if (this.rig) this.rig.dispose?.(); else this.mesh.skeleton.dispose(); if (this.partner && this.partner.partner === this) this.partner.partner = null; }

  // ---- the aimed-at test: the camera axis within 6 degrees of the body while it is up ----
  aimedAt(dt, d) {
    if (this.rise < 0.3 || d > 60 || this.player.dead) { this.aimedT = Math.max(0, this.aimedT - dt * 2); return; }
    this.ctx.camera.getWorldDirection(_cam);
    _v.set(this.position.x, this.position.y + 0.5, this.position.z).sub(this.player.eye);
    const l = _v.length() || 1; _v.divideScalar(l);
    if (_cam.dot(_v) > COS_AIM && this.observed && !this.smoked) this.aimedT += dt; else this.aimedT = Math.max(0, this.aimedT - dt * 2);
  }
  // flashbang: gear sets e.stunned (seconds or a flag). Track our own timer so either convention works.
  stunTick(dt) {
    const s = this.stunned;
    if (s) { if (!this.stunSeen) { this.stunSeen = true; this.stunLeft = Math.max(this.stunLeft, typeof s === 'number' ? s : 4); } }
    else this.stunSeen = false;
    if (this.stunLeft > 0) {
      this.stunLeft -= dt;
      if (this.state !== 'stunned') { this.setState('stunned'); this.flying = false; this.target = null; this.startGlitch(1.5); this.glitchLeft = 0.3; }
      if (this.stunLeft <= 0) { this.stunLeft = 0; this.aware = 0.6; this.startRetreat(); }
      return true;
    }
    return false;
  }

  // ---- AI ----
  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time, w = ctx.world;
    if (this.state !== 'drop') this.followGround(dt, 40);
    const d = this.distanceToPlayer();
    const prevX = this.position.x, prevZ = this.position.z;
    // throttled "is the player looking at me" test
    this.obsT += dt; if (this.obsT > 0.12) { this.obsT = 0; this.observed = this.observedByPlayer(40); }
    this.flinch = damp(this.flinch, 0, 7, dt);
    this.mockT = Math.max(0, this.mockT - dt);
    if (!this.partner && this.pairT > 0) { this.pairT -= dt; if (this.pairT <= 0) this.findPartner(); }
    let headYaw = 0, headPitch = 0, torsoY = TORSO_Y, crouch = 0, stretch = 0;
    // head tracking values (computed without a per-frame closure)
    const trackYaw = angleDelta(this.yaw, Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z)));
    const trackPitch = Math.atan2(p.eye.y - (this.position.y + TORSO_Y * 0.7), Math.max(1, d));
    const canCharge = !p.dead && !p.inBase && ((d < 15 && !this.observed) || d < 6);
    const stunned = this.stunTick(dt);
    // the aimed-at break: decoys and circlers always; a charge only while it is still far
    this.aimedAt(dt, d);
    if (!stunned && this.aimedT > 0.8 && this.mockT <= 0 && (this.state === 'decoy' || this.state === 'circle' || (this.state === 'charge' && d > 7))) this.mock();

    switch (this.state) {
      case 'stunned': {
        // blind and deaf for a few seconds: down low, head thrashing, the pose snapping wrong
        crouch = 0.6; headYaw = Math.sin(t * 9) * 0.9; headPitch = Math.sin(t * 7.3) * 0.4;
        if (this.glitchLeft <= 0 && rng.chance(dt * 6)) { this.startGlitch(1.2); this.glitchLeft = 0.08; }
        break;
      }
      case 'hidden': {
        // a dark patch. the clicks are the only tell.
        this.aware = damp(this.aware, d < 30 && !p.inBase ? 0.5 : 0, 0.8, dt);
        this.clickT -= dt;
        if (this.clickT <= 0) { this.clickT = rng.range(1.5, 4); if (d < 30 && !p.inBase) this.sound('slider_click', { gain: 0.55, max: 36, ref: 2, rate: rng.range(0.9, 1.15) }); }
        torsoY = HIDDEN_Y;
        if (this.onRoof) {
          // from the eave: onto the player when they pass under, or down and at them when they look away
          const below = p.position.y < this.position.y - 1.2;
          if (!p.dead && !p.inBase && d < 5 && below) this.startDrop(true);
          else if (canCharge && d < 15) this.startDrop(false);
        } else if (d < 30 && !p.dead && !p.inBase && this.partnerAlive() && this.partner.state === 'hidden' && !this.partner.onRoof) {
          // a pair wakes together once the player is close enough to be worked
          this.pairT -= dt;
          if (this.pairT <= 0 || canCharge) this.pairEngage();
        } else if (canCharge) this.startCharge();
        break;
      }
      case 'drop': {
        headYaw = trackYaw; headPitch = trackPitch; stretch = 1;
        this.dropVel.y -= GRAVITY * dt;
        this.position.addScaledVector(this.dropVel, dt);
        this.faceToward(p.position.x, p.position.z, dt, 16);
        const g = w.groundHeight(this.position.x, this.position.z, this.position.y + 0.2);
        const landed = this.dropVel.y < 0 && this.position.y <= g.y + 0.02;
        if (landed || this.stateT > 2.5) {
          this.position.y = Math.max(this.position.y, g.y); this.flying = false; this.groundY = g.y;
          const stillHigh = this.position.y - w.getHeight(this.position.x, this.position.z) > 1.4;
          if (stillHigh && this.stateT < 2.5) { this.startDrop(this.dropOnto); break; }   // caught the eave: hop again
          this.sound('slider_lunge', { gain: 1.0, max: 40 });
          if (d < 2.6 && !p.dead) { this.hurtPlayer(25, 'slash'); ctx.post.shake(1.0); this.struck = true; this.startRetreat(); }
          else { ctx.post.shake(0.25); if (d < 15 && !p.dead && !p.inBase) this.startCharge(); else this.startRetreat(); }
          this.onRoof = false;
        }
        break;
      }
      case 'decoy': {
        // the show: up on its feet at twenty metres, in your face and clicking, so you look at it and not behind you
        headYaw = trackYaw; headPitch = trackPitch;
        this.decoyT += dt;
        if (!this.target) this.target = this.pickDecoyPoint();
        const rem = this.moveToward(this.target, SPEED.stalk, dt, { stop: 0.8, face: false, allowWater: true });
        this.faceToward(p.position.x, p.position.z, dt, 6);
        if (rem <= 0.8) { crouch = 0.25 + 0.1 * Math.sin(t * 1.3); torsoY = TORSO_Y - 0.08; }
        this.clickT -= dt;
        if (this.clickT <= 0) { this.clickT = rng.range(0.9, 1.6); this.sound('slider_click', { gain: 0.8, max: 60, ref: 3, rate: rng.range(1.15, 1.4) }); }
        const partnerDone = !this.partnerAlive() || this.partner.struck || this.partner.state === 'hidden';
        if (d < 9 || partnerDone || this.decoyT > 28 || p.dead || p.inBase) { this.role = null; this.target = null; this.resumeDecoy = false; if (canCharge) this.startCharge(); else this.startRetreat(); }
        else if ((d > 26 || (rem <= 0.8 && Math.abs(angleDelta(this.viewBearing(), this.bearingFromPlayer())) > 50 * DEG)) && this.stateT > 1.5) { this.target = this.pickDecoyPoint(); this.stateT = 0; }
        break;
      }
      case 'charge': {
        headYaw = trackYaw; headPitch = trackPitch;
        // smoke between us: the charge breaks
        this.smokeT -= dt;
        if (this.smokeT <= 0) { this.smokeT = 0.2; this.smoked = !!(w.smokeBlocks && w.smokeBlocks(this.eyePos(_v2), p.eye)); if (this.smoked) { this.sound('slider_click', { gain: 0.6, max: 40, ref: 2, rate: 0.8 }); this.startRetreat(); this.waitT = rng.range(2, 4); break; } }
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
            this.lungeHit = true; this.struck = true;
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
        // a decoy that broke off comes back to the show while its partner is still working
        if (this.resumeDecoy && !this.target) { if (this.partnerAlive() && !this.partner.struck) { this.startDecoy(); break; } this.resumeDecoy = false; }
        this.clickT -= dt; if (this.clickT <= 0) { this.clickT = rng.range(2, 5); if (d < 45 && this.role !== 'striker') this.sound('slider_click', { gain: 0.5, max: 45, ref: 2, rate: rng.range(0.85, 1.1) }); }
        if (!this.target) {
          // wait low at the retreat point, then choose a new bearing
          torsoY = TORSO_Y - 0.18; crouch = 0.35;
          this.waitT -= dt;
          this.faceToward(p.position.x, p.position.z, dt, 3);
          if (this.waitT <= 0) { this.circleDir = rng.chance(0.5) ? 1 : -1; this.target = this.pickApproachPoint(this.role === 'striker'); this.watchedT = 0; }
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
          if (w.isWater(_v.x, _v.z) || Math.abs(_v.x) > w.half - 6 || Math.abs(_v.z) > w.half - 6) this.circleDir = -this.circleDir;
          this.moveToward(_v, SPEED.stalk, dt, { stop: 0.4, face: false, allowWater: true });
          this.faceToward(p.position.x, p.position.z, dt, 6);
        }
        // the player has gone: go to ground again
        if (d > 60 || p.inBase) { this.lostT += dt; if (this.lostT > 12) { this.lostT = 0; this.setEngaged(false); this.aware = 0; this.home.copy(this.position); this.setState('hidden'); this.target = null; this.role = null; this.struck = false; this.onRoof = false; } } else this.lostT = 0;
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
    if (this.rig) return this.animateRig(dt, d);
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
    const air = this.state === 'drop' ? 1 : 0;
    const y = lerp(HIDDEN_Y, torsoY, up) + bob - this.crouch * 0.16 + Math.sin(this.breath) * 0.012 * (1 - g) * rise + this.stretch * 0.02;
    const pitch = (0.13 * Math.sin(ph) * g + 0.02 * Math.sin(this.breath)) * rise - this.crouch * 0.25 + this.stretch * 0.08 + this.flinch * 0.3 + air * clamp(-this.dropVel.y * 0.06, -0.3, 0.5);
    const roll = (0.06 * Math.sin(ph + 1.2) * g) * rise + this.flinch * 0.15;
    // feet: hidden splay vs gait targets in mesh space; in the air the limbs reach forward and down
    for (let i = 0; i < 4; i++) {
      const L = LEGS[i], lp = this.legPhase[i], s = Math.sin(lp), c = Math.cos(lp);
      const swing = Math.max(0, s);
      const fz = L.rest[2] + S * c * g + this.stretch * (L.fwd < 0 ? -0.18 : 0.12) - this.crouch * 0.12 * L.fwd - air * (L.fwd < 0 ? 0.25 : -0.1);
      const fy = Math.pow(swing, 0.7) * lift * g + air * (L.fwd < 0 ? 0.05 : 0.3);
      const fx = L.rest[0] + L.side * (0.04 * Math.sin(lp * 0.5 + i) * g + this.crouch * 0.08 + air * 0.1);
      _foot.set(lerp(L.flat[0], fx, up), lerp(0, fy, up), lerp(L.flat[2], fz, up));
      this.footPos[i].lerp(_foot, Math.min(1, dt * 30));
      // footfall: the foot comes down when its swing ends
      const down = s < 0 ? 1 : 0;
      if (down && !this.legWasDown[i] && L.fwd > 0 && g > 0.25 && d < 45 && this.stepT <= 0 && !air) { this.stepT = 0.09; this.sound('slider_step', { gain: 0.25 + 0.35 * clamp01(this.moveSpeed / 8), max: 45, ref: 2, rate: 1.15 + Math.random() * 0.25 }); }
      this.legWasDown[i] = down;
    }
    this.stepT -= dt;
    this.pose(dt, pitch, roll, y, this.crouch, this.stretch, 0);
    // face: on the head, turned to the camera; only shows once it has risen
    this.syncRoot();
    this.B.head.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(this.B.head.matrixWorld);
    this.placeFace(_v, t, rise);
    this.mu.uTime.value = t;
    this.mu.uShiver.value = lerp(0.3, 1, rise) + this.flinch * 2 + (this.state === 'charge' || this.state === 'drop' ? 0.5 : 0) + (this.state === 'stunned' ? 0.8 : 0);
  }
  // the characters module's rig drives the skeleton; we feed it the state and place the face on its head
  animateRig(dt, d) {
    const rig = this.rig, t = this.time;
    rig.setState?.({ speed: this.moveSpeed, crouch: Math.max(this.crouch, 1 - this.rise), hidden: 1 - this.rise, hit: this.flinch, dead: false, glitch: this.glitchOn ? 1 : 0, aimAt: this.player.eye, airborne: this.state === 'drop' });
    rig.update?.(dt);
    this.syncRoot();
    const head = rig.bones && rig.bones.head;
    if (head) { head.updateWorldMatrix(true, false); _v.setFromMatrixPosition(head.matrixWorld); }
    else _v.set(this.position.x, this.position.y + 0.5, this.position.z);
    this.placeFace(_v, t, this.rise);
  }
  placeFace(headWorld, t, rise) {
    _v2.copy(this.ctx.player.eye).sub(headWorld); const fl = _v2.length() || 1; _v2.divideScalar(fl);
    headWorld.addScaledVector(_v2, 0.1);
    this.root.worldToLocal(this.face.position.copy(headWorld));
    this.face.lookAt(this.ctx.player.eye);
    this.faceU.uTime.value = t;
    this.faceU.uFade.value = this.alive ? clamp01((rise - 0.25) / 0.5) * (0.7 + 0.3 * clamp01(this.aware)) : 0;
    this.faceU.uGlow.value = 1.9 + clamp01(this.aware) * 1.1 + this.ctx.time.night * 0.5;
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
