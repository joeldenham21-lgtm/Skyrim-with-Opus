// Spawn — a dog-sized many-legged crawler, translucent black. Packs of three to six live in the buildings and
// the rail cutting, scuttling short dashes around their spot. When one sees you (or hears a shot) the pack
// comes in erratic arcs, fast, and bites. Shoot one and it skitters back three metres, then returns. They die
// curled up: the legs fold under, the body flips, and it crumbles to ash.
//
// Build: one skinned mesh per spawn (thorax, a three-segment abdomen, a tiny head with two dull red pinpoints,
// six two-segment legs on two-bone IK), a dark oily material (fresnel rim with a thin-film shift, chitin
// mottling) that shares one program across the pack. Gait: alternating tripods, exaggerated lift, jittered.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './common.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { hash3 } from '../core/rng.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3();
const _hip = new THREE.Vector3(), _foot = new THREE.Vector3(), _pole = new THREE.Vector3(), _axis = new THREE.Vector3(), _upper = new THREE.Vector3(), _knee = new THREE.Vector3(), _fore = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);

// ---- rig ----
const BONES = ['body', 'abdomen', 'head', 'cL1', 'cL2', 'cL3', 'cR1', 'cR2', 'cR3', 'tL1', 'tL2', 'tL3', 'tR1', 'tR2', 'tR3'];
const bi = (n) => BONES.indexOf(n);
const L1 = 0.20, L2 = 0.245, BODY_Y = 0.19;
// legs: hip in body-local space, rest foot in mesh space, tripod phase
const LEGS = [
  { c: 'cL1', t: 'tL1', side: -1, fwd: -1, hip: [-0.085, -0.01, -0.11], rest: [-0.30, 0, -0.28], off: 0.0 },
  { c: 'cL2', t: 'tL2', side: -1, fwd: 0, hip: [-0.095, -0.005, -0.03], rest: [-0.37, 0, -0.02], off: 0.5 },
  { c: 'cL3', t: 'tL3', side: -1, fwd: 1, hip: [-0.085, -0.01, 0.06], rest: [-0.31, 0, 0.26], off: 0.0 },
  { c: 'cR1', t: 'tR1', side: 1, fwd: -1, hip: [0.085, -0.01, -0.11], rest: [0.30, 0, -0.28], off: 0.5 },
  { c: 'cR2', t: 'tR2', side: 1, fwd: 0, hip: [0.095, -0.005, -0.03], rest: [0.37, 0, -0.02], off: 0.0 },
  { c: 'cR3', t: 'tR3', side: 1, fwd: 1, hip: [0.085, -0.01, 0.06], rest: [0.31, 0, 0.26], off: 0.5 },
];

// bind a geometry 1:1 to a bone and mark its glow (the eyes)
function bind(g, bone, glow = 0) {
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), gl = new Float32Array(n);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; gl[i] = glow; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return g;
}
function jitterVerts(g, jit) {
  const pos = g.attributes.position, n = pos.count;
  for (let i = 0; i < n; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const kx = Math.round(px * 2000) + 7, ky = Math.round(py * 2000) + 3, kz = Math.round(pz * 2000) + 11;
    pos.setXYZ(i, px + (hash3(kx, ky, kz) - 0.5) * jit, py + (hash3(ky, kz, kx) - 0.5) * jit, pz + (hash3(kz, kx, ky) - 0.5) * jit);
  }
}
// a squashed sphere segment
function blob(rx, ry, rz, x, y, z, bone, o = {}) {
  const g = new THREE.SphereGeometry(1, o.seg ?? 12, o.ring ?? 9);
  g.scale(rx, ry, rz);
  jitterVerts(g, o.jitter ?? 0.006);
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _m.makeRotationFromEuler(_e); _m.setPosition(x, y, z);
  g.applyMatrix4(_m); g.computeVertexNormals();
  return bind(g, bi(bone), o.glow || 0);
}
// a tapered box (limb segments, mandibles)
function box(w, h, d, x, y, z, bone, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const pos = g.attributes.position, n = pos.count;
  for (let i = 0; i < n; i++) { const py = pos.getY(i); const s = lerp(o.bottom ?? 1, o.top ?? 1, (py + h / 2) / h); pos.setXYZ(i, pos.getX(i) * s, py, pos.getZ(i) * s); }
  jitterVerts(g, o.jitter ?? 0.004);
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _m.makeRotationFromEuler(_e); _m.setPosition(x, y, z);
  g.applyMatrix4(_m); g.computeVertexNormals();
  return bind(g, bi(bone), 0);
}
let sharedGeo = null;
function buildGeometry() {
  if (sharedGeo) return sharedGeo;
  const parts = [
    blob(0.10, 0.075, 0.135, 0, BODY_Y, -0.04, 'body', { jitter: 0.008 }),                       // thorax
    blob(0.115, 0.088, 0.14, 0, BODY_Y, 0.16, 'abdomen', { jitter: 0.009 }),                     // abdomen, three segments
    blob(0.095, 0.074, 0.11, 0, BODY_Y - 0.006, 0.275, 'abdomen', { jitter: 0.008 }),
    blob(0.066, 0.05, 0.078, 0, BODY_Y - 0.016, 0.36, 'abdomen', { jitter: 0.007 }),
    blob(0.048, 0.04, 0.056, 0, BODY_Y - 0.015, -0.19, 'head', { jitter: 0.005 }),               // head
    blob(0.011, 0.011, 0.011, -0.023, BODY_Y - 0.002, -0.226, 'head', { seg: 8, ring: 6, jitter: 0, glow: 1 }),
    blob(0.011, 0.011, 0.011, 0.023, BODY_Y - 0.002, -0.226, 'head', { seg: 8, ring: 6, jitter: 0, glow: 1 }),
    box(0.012, 0.012, 0.058, -0.018, BODY_Y - 0.035, -0.238, 'head', { ry: 0.4, rx: 0.3, jitter: 0.002 }),   // mandibles
    box(0.012, 0.012, 0.058, 0.018, BODY_Y - 0.035, -0.238, 'head', { ry: -0.4, rx: 0.3, jitter: 0.002 }),
  ];
  for (const L of LEGS) {
    const hx = L.hip[0], hy = BODY_Y + L.hip[1], hz = L.hip[2];
    parts.push(blob(0.024, 0.02, 0.024, hx, hy, hz, L.c, { seg: 8, ring: 6, jitter: 0.003 }));                          // coxa knot
    parts.push(box(0.03, L1, 0.03, hx, hy - L1 / 2, hz, L.c, { bottom: 0.78, jitter: 0.004 }));                          // femur
    parts.push(blob(0.02, 0.016, 0.02, hx, hy - L1, hz, L.t, { seg: 8, ring: 6, jitter: 0.003 }));                     // knee
    parts.push(box(0.021, L2, 0.017, hx, hy - L1 - L2 / 2, hz, L.t, { bottom: 0.42, jitter: 0.003 }));                  // tibia to a point
  }
  sharedGeo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  sharedGeo.userData.shared = true;
  return sharedGeo;
}

// ---- material: dark translucent chitin. fresnel rim with an oily thin-film shift, mottling, dull red eyes ----
function chitinCompile(shader) {
  const u = this.userData.u;
  for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
  for (const k in u) shader.uniforms[k] = u[k];
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow; varying vec3 vObjPos;')
    .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n vGlow = aGlow; vObjPos = transformed;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nuniform float uTime, uSeed, uFlinch; varying float vGlow; varying vec3 vObjPos;`)
    .replace('#include <lights_fragment_begin>', /* glsl */`
      {
        vec3 vv = normalize(vViewPosition);
        float fr = pow(1.0 - clamp(dot(normal, vv), 0.0, 1.0), 2.6);
        float mot = fbm3d(vObjPos * 26.0 + uSeed);
        vec3 oil = 0.5 + 0.5 * cos(6.2831 * (fr * 1.4 + mot * 0.6 + vec3(0.0, 0.33, 0.67)) + uSeed);
        diffuseColor.rgb *= 0.75 + 0.5 * mot;
        diffuseColor.rgb += (vec3(0.06, 0.08, 0.075) + oil * 0.05) * fr;
        totalEmissiveRadiance += (vec3(0.03, 0.045, 0.04) + oil * 0.03) * fr * (0.8 + 1.5 * uFlinch);
        roughnessFactor = clamp(roughnessFactor - 0.28 * fr - 0.12 * mot, 0.12, 1.0);
        float slot = floor(uTime * 3.0 + uSeed);
        float flick = 0.78 + 0.22 * step(0.35, hash11(slot)) * (0.5 + 0.5 * sin(uTime * 11.0 + uSeed));
        totalEmissiveRadiance += vec3(1.25, 0.08, 0.035) * vGlow * flick;
      }
      #include <lights_fragment_begin>`);
}
function makeChitin() {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.018, 0.02, 0.026), roughness: 0.42, metalness: 0.12 });
  mat.userData.u = { uTime: { value: 0 }, uSeed: { value: Math.random() * 60 }, uFlinch: { value: 0 } };
  mat.onBeforeCompile = chitinCompile;
  return mat;
}

let rng = null;
const SPEED = { dash: 2.6, swarm: 4.5 };

class Spawn extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'spawn', position, Object.assign({ hp: 25 }, opts));
    this.radius = 0.35; this.height = 0.4; this.speed = SPEED.swarm;
    this.pack = opts.pack || opts.packId || null;
    // ---- rig ----
    const bones = this.bones = []; const B = this.B = {};
    const mk = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); B[name] = b; return b; };
    mk('body', null, 0, BODY_Y, 0);
    mk('abdomen', B.body, 0, -0.004, 0.09);
    mk('head', B.body, 0, -0.012, -0.15);
    for (const L of LEGS) mk(L.c, B.body, L.hip[0], L.hip[1], L.hip[2]);
    for (const L of LEGS) mk(L.t, B[L.c], 0, -L1, 0);
    this.material = makeChitin(); this.mu = this.material.userData.u;
    const mesh = this.mesh = new THREE.SkinnedMesh(buildGeometry(), this.material);
    mesh.castShadow = true; mesh.receiveShadow = false;
    mesh.add(B.body); mesh.bind(new THREE.Skeleton(bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 0.9);
    this.root.add(mesh);
    // ---- animation ----
    this.phase = rng.range(0, TAU); this.gait = 0; this.moveSpeed = 0; this.flinch = 0; this.bite = 0; this.twitch = 0; this.twitchT = rng.range(1, 4);
    this.legJit = new Float32Array(6); for (let i = 0; i < 6; i++) this.legJit[i] = rng.range(-0.3, 0.3);
    this.footPos = LEGS.map((L) => new THREE.Vector3(L.rest[0], 0, L.rest[2]));
    this.headYaw = 0; this.breath = rng.range(0, TAU); this.roll = 0;
    // ---- AI ----
    this.target = null; this.pauseT = rng.range(0.5, 3); this.headT = 0; this.heading = this.yaw; this.biteCool = 0; this.skitterT = rng.range(0, 0.4);
    this.los = false; this.losT = rng.range(0, 0.2); this.packC = new THREE.Vector3().copy(this.position); this.packN = 1; this.packT = rng.range(0, 0.5);
    this.deathDuration = 1.15; this.ashDone = false;
    this.setState('idle');
    this.syncRoot(); this.root.updateMatrixWorld(true);
    this.animate(0.016, this.distanceToPlayer());
  }
  // ---- perception: 18 m with a line of sight from its low eye (32 m once it is on you); shots within 40 m ----
  playerVisibility() {
    const p = this.player; if (p.dead || p.inBase) return 0;
    const d = this.distanceToPlayer();
    const range = this.state === 'idle' || this.state === 'return' ? 18 : 32;
    if (d > range) return 0;
    return this.los ? clamp01(1.5 - d / range) : 0;
  }
  playerAudibility() {
    const d = this.distanceToPlayer();
    const shots = this.ctx.director?.recentShotAt(this.position, 40) || 0;
    if (shots > 0.05) { if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastSeenT = this.time; return 1; }
    const steps = d < 7 ? this.player.noise * (1 - d / 7) : 0;
    return clamp01(steps * 1.3);
  }
  onSpotted() {
    if (this.state !== 'retreat') this.setState('swarm');
    this.headT = 0;
    this.sound('spawn_skitter', { gain: 0.7, max: 40, ref: 2, rate: 1.2 });
    // the pack comes with it
    for (const e of this.ctx.enemies.list) {
      if (e === this || e.type !== 'spawn' || !e.alive) continue;
      if ((this.pack && e.pack === this.pack) || e.position.distanceTo(this.position) < 12) { if (e.aware < 1) e.aware = 1; if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3(); e.lastSeenPlayer.copy(this.player.position); e.lastSeenT = this.time; }
    }
  }
  onHit(amount) {
    this.sound('spawn_skitter', { gain: 0.8, max: 40, ref: 2, rate: 1.5 });
    this.flinch = 1; this.mu.uFlinch.value = 1;
    if (!this.alive) return;
    this.setState('retreat'); this.aware = 1;
    // a point three metres away from the player
    const p = this.player.position;
    _dir.set(this.position.x - p.x, 0, this.position.z - p.z); const l = _dir.length();
    if (l < 0.1) _dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); else _dir.divideScalar(l);
    _dir.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rng.range(-0.7, 0.7));
    if (!this.target) this.target = new THREE.Vector3();
    this.target.copy(this.position).addScaledVector(_dir, 3);
  }
  onDeath() {
    this.sound('spawn_death', { gain: 0.9, max: 60, ref: 2 });
    this.target = null;
  }
  deathTick(dt) {
    const t = this.deathT;
    // curl: the legs fold under, the body hops and flips onto its back, then it crumbles
    const f = clamp01(t / 0.5), fe = 1 - Math.pow(1 - f, 2.5);
    for (let i = 0; i < 6; i++) { const L = LEGS[i]; _foot.set(L.side * lerp(0.3, 0.07, fe), lerp(0, 0.11, fe), L.fwd * lerp(0.25, 0.05, fe) + 0.02); this.footPos[i].lerp(_foot, Math.min(1, dt * 14)); }
    const hop = Math.sin(Math.min(1, t / 0.45) * Math.PI) * 0.12;
    this.pose(dt, 0.35 * fe, Math.PI * fe, BODY_Y - 0.11 * fe + hop, 0);
    this.mu.uTime.value = this.time; this.mu.uFlinch.value = clamp01(1 - t);
    if (t >= 0.8 && !this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.15, this.position.z), 22); this.ctx.vfx.dustPuff(_v, THREE.Object3D.DEFAULT_UP, 6, [0.1, 0.1, 0.11], 0.35); this.mesh.visible = false; }
  }
  onDispose() { this.mesh.skeleton.dispose(); }

  // ---- AI ----
  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time;
    this.followGround(dt, 40);
    const d = this.distanceToPlayer();
    const prevX = this.position.x, prevZ = this.position.z;
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.2; _v.set(this.position.x, this.position.y + 0.3, this.position.z); _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.65, p.position.z); this.los = d < 34 && ctx.world.lineOfSight(_v, _v2); }
    this.perceive(dt, { visGain: 4, hearGain: 4, decay: 0.15 });
    // pack centre, refreshed twice a second
    this.packT -= dt;
    if (this.packT <= 0) {
      this.packT = 0.5; let n = 0; _v3.set(0, 0, 0);
      for (const e of ctx.enemies.list) { if (e.type !== 'spawn' || !e.alive) continue; if (this.pack ? e.pack !== this.pack : e.position.distanceTo(this.position) > 8) continue; _v3.add(e.position); n++; }
      if (n > 0) { this.packC.copy(_v3).divideScalar(n); this.packN = n; }
    }
    this.biteCool = Math.max(0, this.biteCool - dt);
    this.flinch = damp(this.flinch, 0, 6, dt);
    let headYaw = 0, speed = 0;
    const hd = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);

    switch (this.state) {
      case 'idle': {
        // short dashes and pauses around home; the pack keeps loosely together
        if (this.target) {
          const rem = this.moveToward(this.target, SPEED.dash, dt, { stop: 0.15, turnRate: 16 });
          if (rem <= 0.15 || this.stateT > 30) { this.target = null; this.pauseT = rng.range(1, 4); }
          speed = SPEED.dash;
        } else {
          this.pauseT -= dt; headYaw = Math.sin(t * 1.7 + this.phase) * 0.5;
          if (this.pauseT <= 0) {
            const c = this.packN > 1 && rng.chance(0.4) ? this.packC : this.home;
            const pt = ctx.world.randomPoint(rng, c.x, c.z, 1.8, 6);
            if (pt && pt.distanceTo(this.position) > 0.4 && !ctx.world.isInBase(pt)) { this.target = pt; this.stateT = 0; this.sound('spawn_skitter', { gain: 0.35, max: 30, ref: 1.5, rate: rng.range(0.9, 1.2) }); }
            else this.pauseT = rng.range(0.5, 2);
          }
        }
        break;
      }
      case 'swarm': {
        if (!this.engaged || p.dead || p.inBase) { this.setState('return'); break; }
        headYaw = angleDelta(this.yaw, Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z)));
        if (hd < 1.2) {
          // on you: face and bite
          this.faceToward(p.position.x, p.position.z, dt, 14);
          if (this.biteCool <= 0) { this.biteCool = 0.9; this.bite = 1; this.hurtPlayer(7, 'melee'); this.sound('spawn_bite', { gain: 0.9, max: 30, ref: 1.5, rate: rng.range(0.9, 1.15) }); }
        } else {
          // a new heading every 0.4-0.8 s, biased toward the player; a gentle pull toward the pack
          this.headT -= dt;
          if (this.headT <= 0) {
            this.headT = rng.range(0.4, 0.8);
            let a = Math.atan2(p.position.x - this.position.x, p.position.z - this.position.z);
            a += clamp(rng.gauss() * 0.6, -1.3, 1.3) * clamp01((hd - 1.5) / 4);
            if (this.packN > 1) { const pc = this.packC; const dp = Math.hypot(pc.x - this.position.x, pc.z - this.position.z); if (dp > 5) { const ap = Math.atan2(pc.x - this.position.x, pc.z - this.position.z); a += angleDelta(a, ap) * 0.25; } }
            this.heading = a;
          }
          _v.set(this.position.x + Math.sin(this.heading) * 2.5, this.position.y, this.position.z + Math.cos(this.heading) * 2.5);
          this.moveToward(_v, SPEED.swarm, dt, { stop: 0.1, turnRate: 12, allowWater: true });
          speed = SPEED.swarm;
        }
        break;
      }
      case 'retreat': {
        if (this.target) { const rem = this.moveToward(this.target, SPEED.swarm, dt, { stop: 0.2, turnRate: 16, allowWater: true }); if (rem <= 0.2 || this.stateT > 0.8) this.target = null; speed = SPEED.swarm; }
        else { this.setState(this.engaged ? 'swarm' : 'return'); this.headT = 0; }
        break;
      }
      case 'return': {
        if (this.engaged && !p.inBase && !p.dead) { this.setState('swarm'); this.headT = 0; break; }
        const rem = this.moveToward(this.home, SPEED.dash, dt, { stop: 0.4, turnRate: 12 });
        speed = SPEED.dash;
        if (rem <= 0.4 || this.stateT > 25) { this.setState('idle'); this.target = null; this.pauseT = rng.range(1, 3); }
        break;
      }
    }
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.moveSpeed = damp(this.moveSpeed, dt > 0 ? mv / dt : 0, 12, dt);
    this.headYaw = dampAngle(this.headYaw, clamp(headYaw, -0.9, 0.9), 8, dt);
    // skittering: granular bursts while it moves
    this.skitterT -= dt;
    if (this.moveSpeed > 0.6 && this.skitterT <= 0 && d < 40) { this.skitterT = rng.range(0.25, 0.5); this.sound('spawn_skitter', { gain: 0.2 + 0.4 * clamp01(this.moveSpeed / SPEED.swarm), max: 40, ref: 1.5, rate: rng.range(0.85, 1.3) }); }
    this.animate(dt, d);
  }
  syncRoot() { this.root.position.copy(this.position); this.root.rotation.y = this.yaw; }

  // ---- animation ----
  animate(dt, d) {
    const t = this.time;
    const S = 0.085, lift = 0.075;
    const sf = clamp01(this.moveSpeed / 1.5);
    this.gait = damp(this.gait, sf, 12, dt);
    const g = this.gait;
    // stride rate follows speed, capped so the legs still read at full sprint
    const rate = Math.min(9.5, this.moveSpeed / (4 * S)) * TAU;
    this.phase += rate * dt;
    // idle twitch: the whole body jerks now and then
    this.twitchT -= dt; if (this.twitchT <= 0) { this.twitchT = rng.range(1, 4); this.twitch = 1; }
    this.twitch = damp(this.twitch, 0, 14, dt);
    this.bite = damp(this.bite, 0, 7, dt);
    this.breath += dt * 2.4;
    const ph = this.phase;
    const bob = 0.012 * Math.sin(2 * ph) * g;
    const y = BODY_Y + bob + Math.sin(this.breath) * 0.004 + this.twitch * 0.015 - this.bite * 0.02;
    const pitch = 0.05 * Math.sin(2 * ph + 0.5) * g - this.bite * 0.55 * (1 - Math.min(1, this.bite * 1.6)) + this.bite * 0.25 + this.flinch * 0.25 + this.twitch * 0.1;
    const roll = 0.06 * Math.sin(ph) * g + this.twitch * 0.1 * Math.sin(t * 40);
    for (let i = 0; i < 6; i++) {
      const L = LEGS[i], lp = ph + L.off * TAU + this.legJit[i] * g, s = Math.sin(lp), c = Math.cos(lp);
      const swing = Math.max(0, s);
      const fz = L.rest[2] + S * c * g + this.bite * 0.05;
      const fy = Math.pow(swing, 0.6) * lift * g + this.twitch * 0.02 * (i % 2);
      const fx = L.rest[0] + L.side * 0.02 * Math.sin(lp * 0.5 + i) * g;
      _foot.set(fx, fy, fz);
      this.footPos[i].lerp(_foot, Math.min(1, dt * 40));
    }
    this.pose(dt, pitch, roll, y, Math.sin(ph) * 0.06 * g);
    this.mu.uTime.value = t;
    this.mu.uFlinch.value = damp(this.mu.uFlinch.value, 0, 5, dt);
  }
  pose(dt, pitch, roll, y, yawWobble) {
    const B = this.B, body = B.body;
    body.position.set(0, y, 0);
    body.rotation.set(pitch, yawWobble, roll);
    body.updateMatrix();
    // the abdomen pumps, the head turns to what it wants
    B.abdomen.rotation.set(0.12 * Math.sin(this.phase * 2 + 1) * this.gait + 0.05 * Math.sin(this.breath) + this.bite * 0.15, 0, 0);
    B.head.rotation.set(-this.bite * 0.35 + 0.04 * Math.sin(this.breath * 1.3), this.headYaw, 0);
    _qi.copy(body.quaternion).invert();
    for (let i = 0; i < 6; i++) {
      const L = LEGS[i];
      _hip.set(L.hip[0], L.hip[1], L.hip[2]).applyMatrix4(body.matrix);
      _pole.set(L.side * 1.0, 0.85, L.fwd * 0.25).normalize();
      this.solveLeg(B[L.c], B[L.t], _hip, this.footPos[i], _pole);
    }
  }
  solveLeg(upBone, loBone, hip, foot, pole) {
    _dir.subVectors(foot, hip); let dd = _dir.length();
    const maxD = (L1 + L2) * 0.995; if (dd > maxD) dd = maxD; if (dd < 0.03) dd = 0.03;
    _dir.normalize();
    const cosA = clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1);
    const ang = Math.acos(cosA);
    _axis.crossVectors(_dir, pole); if (_axis.lengthSq() < 1e-6) _axis.set(0, 0, 1); _axis.normalize();
    _upper.copy(_dir).applyAxisAngle(_axis, ang);
    _knee.copy(hip).addScaledVector(_upper, L1);
    _fore.subVectors(foot, _knee).normalize();
    _upper.applyQuaternion(_qi); _fore.applyQuaternion(_qi);
    upBone.quaternion.setFromUnitVectors(DOWN, _upper);
    _q.copy(upBone.quaternion).invert();
    _fore.applyQuaternion(_q);
    loBone.quaternion.setFromUnitVectors(DOWN, _fore);
  }
}

export function registerSpawn(ctx) {
  rng = ctx.rng.fork(47);
  ctx.enemies.registerType('spawn', Spawn);
}
