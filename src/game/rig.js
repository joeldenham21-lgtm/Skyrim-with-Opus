/**
 * WYRMHOLD — humanoid rigs and procedural animation.
 *
 * There are no imported character models. Every figure is assembled from
 * primitives into a proper joint hierarchy and animated entirely in code:
 * a weighted blend of hand-authored pose generators (idle, walk, run, swim,
 * attack, cast, block, stagger, death) driven by sine phases and spring
 * damping, with secondary motion on the cloak and hair.
 *
 * Nords keep their hoods up, which is both period-appropriate and the reason
 * we never have to draw a face.
 */

import * as THREE from 'three';
import { clamp, saturate, lerp, damp, TAU, Rand } from '../core/math.js';

const CAPSULE = new Map();
function capsule(r, h, seg = 8) {
  const key = `${r.toFixed(3)}|${h.toFixed(3)}|${seg}`;
  if (!CAPSULE.has(key)) CAPSULE.set(key, new THREE.CapsuleGeometry(r, h, 3, seg));
  return CAPSULE.get(key);
}
const BOXES = new Map();
function box(w, h, d) {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  if (!BOXES.has(key)) BOXES.set(key, new THREE.BoxGeometry(w, h, d, 1, 1, 1));
  return BOXES.get(key);
}
const SPHERES = new Map();
function sphere(r, seg = 10) {
  const key = `${r.toFixed(3)}|${seg}`;
  if (!SPHERES.has(key)) SPHERES.set(key, new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)));
  return SPHERES.get(key);
}

/** A joint is just a named Object3D with its rest pose remembered. */
function joint(parent, name, x, y, z) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  o.userData.rest = o.position.clone();
  parent.add(o);
  return o;
}

function part(parentJoint, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  parentJoint.add(m);
  return m;
}

// ---------------------------------------------------------------------------

export const BODY_PRESETS = {
  player: { height: 1.82, build: 1.0, shoulders: 1.0 },
  villager: { height: 1.74, build: 0.92, shoulders: 0.94 },
  bandit: { height: 1.80, build: 1.06, shoulders: 1.08 },
  draugr: { height: 1.78, build: 0.86, shoulders: 0.96 },
  troll: { height: 2.65, build: 1.9, shoulders: 1.7 },
  guard: { height: 1.84, build: 1.1, shoulders: 1.14 },
};

/**
 * Builds a humanoid. `mats` supplies the material palette:
 * { cloth, leather, iron, fur, skin, metal }
 */
export function buildHumanoid(mats, opts = {}) {
  const preset = BODY_PRESETS[opts.preset || 'villager'];
  const H = (opts.height ?? preset.height);
  const B = (opts.build ?? preset.build);
  const S = (opts.shoulders ?? preset.shoulders);
  const rand = new Rand(opts.seed ?? 1);

  const root = new THREE.Group();
  root.name = 'humanoid';

  const scale = H / 1.8;
  const cloth = mats.cloth, leather = mats.leather, iron = mats.iron, fur = mats.fur;
  const skin = mats.skin || leather;

  // --- hierarchy ----------------------------------------------------------
  const pelvis = joint(root, 'pelvis', 0, 0.92 * scale, 0);
  const spine = joint(pelvis, 'spine', 0, 0.14 * scale, 0);
  const chest = joint(spine, 'chest', 0, 0.20 * scale, 0);
  const neck = joint(chest, 'neck', 0, 0.17 * scale, 0);
  const head = joint(neck, 'head', 0, 0.09 * scale, 0);

  const shoulderL = joint(chest, 'shoulderL', 0.19 * scale * S, 0.10 * scale, 0);
  const shoulderR = joint(chest, 'shoulderR', -0.19 * scale * S, 0.10 * scale, 0);
  const elbowL = joint(shoulderL, 'elbowL', 0, -0.28 * scale, 0);
  const elbowR = joint(shoulderR, 'elbowR', 0, -0.28 * scale, 0);
  const handL = joint(elbowL, 'handL', 0, -0.26 * scale, 0);
  const handR = joint(elbowR, 'handR', 0, -0.26 * scale, 0);

  const hipL = joint(pelvis, 'hipL', 0.10 * scale, -0.04 * scale, 0);
  const hipR = joint(pelvis, 'hipR', -0.10 * scale, -0.04 * scale, 0);
  const kneeL = joint(hipL, 'kneeL', 0, -0.42 * scale, 0);
  const kneeR = joint(hipR, 'kneeR', 0, -0.42 * scale, 0);
  const footL = joint(kneeL, 'footL', 0, -0.40 * scale, 0);
  const footR = joint(kneeR, 'footR', 0, -0.40 * scale, 0);

  // --- geometry ------------------------------------------------------------
  const torsoMat = opts.torsoMat || cloth;
  const legMat = opts.legMat || leather;
  const armMat = opts.armMat || cloth;
  const bootMat = opts.bootMat || leather;

  const SEG = opts.detail === 'high' ? 14 : 10;
  const cap = (r, h) => capsule(r, h, SEG);
  const sph = (r) => sphere(r, SEG);
  const hair = mats.hair || mats.fur || cloth;

  // --- torso: hips, a waisted midriff and a wider chest yoke ----------------
  part(pelvis, cap(0.128 * scale * B, 0.09 * scale), legMat, 0, 0.02 * scale, 0, 0, 0, 0, 1.04, 1, 0.86);
  part(spine, cap(0.142 * scale * B, 0.15 * scale), torsoMat, 0, 0.08 * scale, 0, 0, 0, 0, 1.06, 1, 0.76);
  part(chest, cap(0.166 * scale * B * S, 0.15 * scale), torsoMat, 0, 0.07 * scale, 0, 0, 0, 0, 1.14, 1, 0.74);
  // shoulder yoke — a straight capsule across the top of the chest reads as
  // collarbones and stops the arms looking like they grow out of the ribs.
  part(chest, cap(0.070 * scale * B, 0.30 * scale * S), torsoMat,
    0, 0.115 * scale, -0.005 * scale, 0, 0, Math.PI / 2, 1, 1, 0.85);
  // tunic skirt over the hips
  if (opts.skirt !== false) {
    part(pelvis, cap(0.170 * scale * B, 0.16 * scale), torsoMat,
      0, -0.10 * scale, 0, 0, 0, 0, 1.0, 1, 0.80);
  }
  // belt + buckle
  part(spine, box(0.33 * scale * B, 0.048 * scale, 0.25 * scale * B), leather, 0, -0.012 * scale, 0);
  part(spine, box(0.055 * scale, 0.055 * scale, 0.022 * scale), iron,
    0, -0.012 * scale, 0.128 * scale * B);
  // chest strap running over one shoulder
  if (opts.strap !== false) {
    part(chest, box(0.052 * scale, 0.36 * scale, 0.018 * scale), leather,
      0.055 * scale, 0.02 * scale, 0.115 * scale * B, 0.06, 0, 0.42);
  }

  // --- head -----------------------------------------------------------------
  // Skull, jaw and brow as three pieces: a bare sphere reads as a ball on a
  // stick from any angle a player actually looks at it from.
  part(head, sph(0.104 * scale), skin, 0, 0.026 * scale, 0, 0, 0, 0, 0.94, 1.10, 1.00);
  part(head, sph(0.076 * scale), skin, 0, -0.028 * scale, 0.026 * scale, 0, 0, 0, 0.92, 0.88, 1.02);
  part(head, box(0.135 * scale, 0.030 * scale, 0.045 * scale), skin,
    0, 0.055 * scale, 0.078 * scale, -0.22, 0, 0);
  // eye sockets, in shadow — two small dark recesses do more than a face texture
  for (const s of [1, -1]) {
    part(head, sph(0.020 * scale), mats.bone || iron,
      s * 0.040 * scale, 0.030 * scale, 0.082 * scale, 0, 0, 0, 1.2, 0.7, 0.5);
  }
  part(head, sph(0.026 * scale), skin, 0, 0.006 * scale, 0.092 * scale, 0, 0, 0, 0.6, 0.8, 0.8);

  if (opts.hood !== false) {
    const hoodMat = opts.hoodMat || cloth;
    part(head, sph(0.140 * scale), hoodMat, 0, 0.030 * scale, -0.020 * scale, 0, 0, 0, 1.0, 1.04, 1.02);
    // cowl falling behind the neck
    part(head, cap(0.098 * scale, 0.12 * scale), hoodMat, 0, -0.02 * scale, -0.075 * scale, 0.5, 0, 0, 1.25, 1, 1.0);
    // the opening: a ring that frames the face
    part(head, cap(0.030 * scale, 0.20 * scale), hoodMat,
      0, 0.030 * scale, 0.082 * scale, 0, 0, Math.PI / 2, 1, 1, 0.6);
  } else if (opts.hair !== false) {
    part(head, sph(0.118 * scale), hair, 0, 0.030 * scale, -0.012 * scale, 0, 0, 0, 1.0, 1.02, 1.0);
    // a fall of hair down the back of the neck
    part(head, cap(0.075 * scale, 0.12 * scale), hair,
      0, -0.045 * scale, -0.052 * scale, 0.22, 0, 0, 1.1, 1, 0.62);
    if (opts.braids) {
      for (const s of [1, -1]) {
        part(head, cap(0.020 * scale, 0.18 * scale), hair,
          s * 0.095 * scale, -0.070 * scale, -0.010 * scale, 0.18, 0, s * 0.14);
      }
    }
  }
  if (opts.beard) {
    part(head, cap(0.062 * scale, 0.075 * scale), hair,
      0, -0.055 * scale, 0.048 * scale, 0.26, 0, 0, 1.05, 1, 0.85);
  }
  if (opts.helmet) {
    part(head, sph(0.142 * scale), iron, 0, 0.035 * scale, 0, 0, 0, 0, 1.0, 0.95, 1.02);
    part(head, box(0.29 * scale, 0.032 * scale, 0.29 * scale), iron, 0, 0.098 * scale, 0);
    // nasal bar
    part(head, box(0.026 * scale, 0.105 * scale, 0.022 * scale), iron,
      0, 0.020 * scale, 0.128 * scale);
    for (const s of [1, -1]) {
      part(head, cap(0.020 * scale, 0.15 * scale), mats.bone || iron,
        s * 0.135 * scale, 0.095 * scale, 0, 0.2, 0, s * 1.0);
    }
  }

  // --- arms -----------------------------------------------------------------
  for (const [sh, el, ha, side] of [[shoulderL, elbowL, handL, 1], [shoulderR, elbowR, handR, -1]]) {
    if (opts.pauldrons) {
      part(sh, sph(0.092 * scale * S), iron, 0, 0.005 * scale, 0, 0, 0, 0, 1.15, 0.8, 1.05);
      part(sh, box(0.16 * scale * S, 0.022 * scale, 0.14 * scale), iron,
        side * 0.03 * scale, -0.045 * scale, 0, 0, 0, side * 0.3);
    } else {
      // deltoid
      part(sh, sph(0.062 * scale * B * S), armMat, 0, -0.012 * scale, 0, 0, 0, 0, 1.05, 1.15, 1.0);
    }
    part(sh, cap(0.055 * scale * B, 0.20 * scale), armMat, 0, -0.14 * scale, 0);
    part(el, cap(0.047 * scale * B, 0.19 * scale), armMat, 0, -0.13 * scale, 0, 0, 0, 0, 1, 1, 0.94);
    // cuff where the sleeve ends
    part(el, cap(0.052 * scale * B, 0.035 * scale), leather, 0, -0.225 * scale, 0);
    // hand: palm plus a thumb, which is what makes a fist read as a hand
    part(ha, box(0.052 * scale, 0.085 * scale, 0.038 * scale), skin, 0, -0.035 * scale, 0);
    part(ha, sph(0.026 * scale), skin, 0, -0.072 * scale, 0.004 * scale, 0, 0, 0, 1.0, 0.8, 1.0);
    part(ha, cap(0.017 * scale, 0.030 * scale), skin,
      side * 0.026 * scale, -0.038 * scale, 0.014 * scale, 0.4, 0, side * -0.5);
  }

  // --- legs -----------------------------------------------------------------
  for (const [hp, kn, ft] of [[hipL, kneeL, footL], [hipR, kneeR, footR]]) {
    part(hp, cap(0.082 * scale * B, 0.28 * scale), legMat, 0, -0.20 * scale, 0);
    part(kn, cap(0.062 * scale * B, 0.26 * scale), legMat, 0, -0.19 * scale, 0);
    // boot: shaft, foot and a raised toe
    part(kn, cap(0.068 * scale * B, 0.10 * scale), bootMat, 0, -0.335 * scale, 0);
    part(ft, box(0.096 * scale, 0.058 * scale, 0.215 * scale), bootMat, 0, -0.030 * scale, 0.040 * scale);
    part(ft, box(0.098 * scale, 0.022 * scale, 0.225 * scale), leather, 0, -0.058 * scale, 0.042 * scale);
    part(ft, sph(0.045 * scale), bootMat, 0, -0.028 * scale, 0.128 * scale, 0, 0, 0, 1.0, 0.85, 0.7);
  }

  // --- cloak (secondary motion) -------------------------------------------
  let cloak = null;
  if (opts.cloak) {
    const cw = 0.46 * scale, ch = 0.85 * scale;
    const g = new THREE.PlaneGeometry(cw, ch, 5, 7);
    g.translate(0, -ch / 2, 0);
    const m = new THREE.Mesh(g, opts.cloakMat || cloth);
    m.castShadow = true;
    m.receiveShadow = true;
    m.material.side = THREE.DoubleSide;
    const anchor = joint(chest, 'cloak', 0, 0.14 * scale, -0.12 * scale);
    anchor.add(m);
    cloak = { anchor, mesh: m, geo: g, rest: g.attributes.position.array.slice(), w: cw, h: ch };
  }

  const joints = {
    root, pelvis, spine, chest, neck, head,
    shoulderL, shoulderR, elbowL, elbowR, handL, handR,
    hipL, hipR, kneeL, kneeR, footL, footR,
  };
  for (const k in joints) if (joints[k].userData) joints[k].userData.restQuat = joints[k].quaternion.clone();

  return { root, joints, cloak, scale, height: H };
}

// ---------------------------------------------------------------------------
// Animator
// ---------------------------------------------------------------------------

const _e = new THREE.Euler();
const _v = new THREE.Vector3();

export class Animator {
  constructor(rig) {
    this.rig = rig;
    this.j = rig.joints;
    this.phase = 0;
    this.state = 'idle';
    this.speed = 0;          // 0..1 normalised locomotion speed
    this.moveBlend = 0;
    this.crouch = 0;
    this.swim = 0;
    this.airborne = 0;
    this.lookPitch = 0;
    this.lean = 0;
    this.leanTarget = 0;
    this.actionTime = 0;
    this.action = null;      // { name, dur, t }
    this.hitTime = 0;
    this.deadT = 0;
    this.blockAmt = 0;
    this.aimAmt = 0;
    this.castAmt = 0;
    this.breath = Math.random() * 10;
    this.stepEvent = null;
    this._lastStepPhase = 0;
    this.handOffsetL = new THREE.Vector3();
    this.handOffsetR = new THREE.Vector3();
  }

  play(name, dur = 0.6) {
    this.action = { name, dur, t: 0 };
  }
  get busy() { return !!this.action; }

  /** @param {object} s locomotion state */
  update(dt, s) {
    const j = this.j;
    this.speed = damp(this.speed, s.speed01 ?? 0, 12, dt);
    this.crouch = damp(this.crouch, s.crouch ? 1 : 0, 10, dt);
    this.swim = damp(this.swim, s.swimming ? 1 : 0, 6, dt);
    this.airborne = damp(this.airborne, s.grounded ? 0 : 1, 8, dt);
    this.blockAmt = damp(this.blockAmt, s.blocking ? 1 : 0, 16, dt);
    this.aimAmt = damp(this.aimAmt, s.aiming ? 1 : 0, 12, dt);
    this.castAmt = damp(this.castAmt, s.casting ? 1 : 0, 14, dt);
    this.lookPitch = damp(this.lookPitch, clamp(s.pitch ?? 0, -0.8, 0.8), 14, dt);
    this.leanTarget = clamp((s.turnRate ?? 0) * -0.22, -0.32, 0.32);
    this.lean = damp(this.lean, this.leanTarget, 7, dt);
    this.breath += dt;

    const strideHz = lerp(1.05, 2.55, this.speed) * (1 - this.crouch * 0.3);
    if (s.grounded && !s.swimming) {
      this.phase += dt * strideHz * TAU * (0.25 + this.speed * 1.4);
    } else if (s.swimming) {
      this.phase += dt * 1.6 * TAU * 0.5;
    }
    this.phase = this.phase % TAU;

    // footstep events at the two contact points of the cycle
    if (s.grounded && this.speed > 0.06) {
      const p = this.phase / TAU;
      if ((this._lastStepPhase < 0.25 && p >= 0.25) || (this._lastStepPhase < 0.75 && p >= 0.75)) {
        this.stepEvent = { strength: this.speed };
      }
      this._lastStepPhase = p;
    }

    if (this.action) {
      this.action.t += dt;
      if (this.action.t >= this.action.dur) this.action = null;
    }
    if (this.hitTime > 0) this.hitTime -= dt;
    if (s.dead) this.deadT = Math.min(1, this.deadT + dt * 2.2);

    this._pose(dt, s);
  }

  _pose(dt, s) {
    const j = this.j;
    const p = this.phase;
    const sp = this.speed;
    const sw = Math.sin(p), sw2 = Math.sin(p * 2);

    // ---- reset to rest -----------------------------------------------------
    for (const k in j) j[k].rotation.set(0, 0, 0);
    j.pelvis.position.copy(j.pelvis.userData.rest);

    // ---- idle breathing ----------------------------------------------------
    const br = Math.sin(this.breath * 1.35) * 0.5 + 0.5;
    const idleW = 1 - sp;
    j.chest.rotation.x += br * 0.035 * idleW;
    j.spine.rotation.y += Math.sin(this.breath * 0.42) * 0.03 * idleW;
    j.pelvis.position.y += br * 0.010 * idleW * this.rig.scale;

    // ---- locomotion --------------------------------------------------------
    // Sign convention, because getting it wrong makes everyone moonwalk:
    // the rig faces +Z, so a POSITIVE rotation.x on a hip swings that thigh
    // BACKWARD. Left leg reaches forward at p = pi/2 (heel strike) and pushes
    // off at p = 3pi/2, so its swing phase is centred on p = 0.
    const legAmp = lerp(0.28, 0.95, sp) * (1 - this.swim);
    const armAmp = lerp(0.22, 0.72, sp) * (1 - this.swim);
    const swR = Math.sin(p + Math.PI);
    j.hipL.rotation.x += -sw * legAmp;
    j.hipR.rotation.x += -swR * legAmp;

    // Knee flexes through the swing (peaking just after toe-off) and gives a
    // little on loading right after the heel lands.
    const knee = (ph) => {
      const swingF = Math.max(0, Math.cos(ph - 0.2));
      const load = Math.max(0, Math.sin(ph + 0.35));
      return (swingF * swingF * 1.45 + load * 0.22) * legAmp;
    };
    j.kneeL.rotation.x += knee(p);
    j.kneeR.rotation.x += knee(p + Math.PI);

    // Ankle: toes down at push-off, toes up just before the heel lands.
    const ankle = (ph) => (Math.max(0, -Math.sin(ph)) * 0.55 - Math.max(0, Math.sin(ph)) * 0.25) * legAmp;
    j.footL.rotation.x += ankle(p);
    j.footR.rotation.x += ankle(p + Math.PI);

    // Arms swing against the leg on the same side.
    j.shoulderL.rotation.x += sw * armAmp;
    j.shoulderR.rotation.x += swR * armAmp;
    j.shoulderL.rotation.z += 0.10 + sp * 0.05;
    j.shoulderR.rotation.z += -0.10 - sp * 0.05;
    j.elbowL.rotation.x += -0.28 - sp * 0.45 - Math.max(0, -sw) * 0.3;
    j.elbowR.rotation.x += -0.28 - sp * 0.45 - Math.max(0, sw) * 0.3;

    // vertical bob + counter-rotation (hips lead the forward leg, chest resists)
    j.pelvis.position.y += (-Math.abs(sw2) * 0.045 * sp) * this.rig.scale;
    j.pelvis.rotation.y += -sw * 0.10 * sp;
    j.chest.rotation.y += sw * 0.16 * sp;
    j.pelvis.rotation.z += this.lean * 0.6;
    j.chest.rotation.z += this.lean * 0.5;
    j.spine.rotation.x += sp * 0.14;      // lean into the run

    // ---- crouch -------------------------------------------------------------
    if (this.crouch > 0.001) {
      const c = this.crouch;
      j.pelvis.position.y -= 0.30 * c * this.rig.scale;
      j.hipL.rotation.x += 0.55 * c;
      j.hipR.rotation.x += 0.55 * c;
      j.kneeL.rotation.x += -1.05 * c;
      j.kneeR.rotation.x += -1.05 * c;
      j.footL.rotation.x += 0.5 * c;
      j.footR.rotation.x += 0.5 * c;
      j.spine.rotation.x += 0.34 * c;
      j.neck.rotation.x += -0.22 * c;
    }

    // ---- airborne ------------------------------------------------------------
    if (this.airborne > 0.001) {
      const a = this.airborne;
      const up = clamp((s.vy ?? 0) * 0.12, -1, 1);
      j.hipL.rotation.x += lerp(0.5, -0.35, saturate(up * 0.5 + 0.5)) * a;
      j.hipR.rotation.x += lerp(0.2, -0.15, saturate(up * 0.5 + 0.5)) * a;
      j.kneeL.rotation.x += -0.9 * a;
      j.kneeR.rotation.x += -0.35 * a;
      j.shoulderL.rotation.z += 0.55 * a;
      j.shoulderR.rotation.z += -0.55 * a;
      j.shoulderL.rotation.x += -0.5 * a;
      j.shoulderR.rotation.x += -0.5 * a;
    }

    // ---- swimming -------------------------------------------------------------
    if (this.swim > 0.001) {
      const w = this.swim;
      j.pelvis.rotation.x += 1.15 * w;
      j.pelvis.position.y += 0.18 * w * this.rig.scale;
      const st = Math.sin(this.breath * 3.1);
      j.hipL.rotation.x += st * 0.5 * w;
      j.hipR.rotation.x += -st * 0.5 * w;
      j.shoulderL.rotation.x += (-1.3 + Math.sin(this.breath * 2.6) * 0.9) * w;
      j.shoulderR.rotation.x += (-1.3 + Math.sin(this.breath * 2.6 + Math.PI) * 0.9) * w;
      j.neck.rotation.x += -0.7 * w;
    }

    // ---- aim / block / cast ----------------------------------------------------
    if (this.blockAmt > 0.001) {
      const b = this.blockAmt;
      j.shoulderL.rotation.x += -1.15 * b;
      j.shoulderL.rotation.z += 0.55 * b;
      j.elbowL.rotation.x += -1.35 * b;
      j.shoulderR.rotation.x += -0.35 * b;
      j.elbowR.rotation.x += -0.8 * b;
      j.spine.rotation.x += 0.16 * b;
    }
    if (this.aimAmt > 0.001) {
      const a = this.aimAmt;
      j.shoulderL.rotation.x += -1.52 * a;
      j.shoulderL.rotation.z += 0.18 * a;
      j.elbowL.rotation.x += -0.10 * a;
      j.shoulderR.rotation.x += -1.30 * a;
      j.shoulderR.rotation.z += -0.42 * a;
      j.elbowR.rotation.x += -1.15 * a;
      j.chest.rotation.y += -0.30 * a;
      j.spine.rotation.y += -0.16 * a;
    }
    if (this.castAmt > 0.001) {
      const c = this.castAmt;
      const puls = Math.sin(this.breath * 9) * 0.06;
      j.shoulderR.rotation.x += (-1.15 + puls) * c;
      j.shoulderR.rotation.z += -0.30 * c;
      j.elbowR.rotation.x += -0.55 * c;
      j.chest.rotation.y += -0.12 * c;
    }

    // ---- one-shot actions --------------------------------------------------------
    if (this.action) {
      const a = this.action;
      const t = saturate(a.t / a.dur);
      const ease = t < 0.35 ? (t / 0.35) : 1 - (t - 0.35) / 0.65;
      switch (a.name) {
        case 'attack1': {
          const wind = saturate(t / 0.3), strike = saturate((t - 0.3) / 0.25), rec = saturate((t - 0.55) / 0.45);
          j.shoulderR.rotation.x += lerp(0, -2.35, wind) + lerp(0, 3.0, strike) - lerp(0, 0.75, rec);
          j.shoulderR.rotation.z += lerp(0, -0.85, wind) + lerp(0, 0.95, strike);
          j.elbowR.rotation.x += lerp(0, -1.5, wind) + lerp(0, 1.35, strike);
          j.chest.rotation.y += lerp(0, 0.75, wind) - lerp(0, 1.35, strike);
          j.spine.rotation.y += lerp(0, 0.35, wind) - lerp(0, 0.6, strike);
          break;
        }
        case 'attack2': {
          const wind = saturate(t / 0.28), strike = saturate((t - 0.28) / 0.27);
          j.shoulderR.rotation.x += lerp(0, -1.1, wind) + lerp(0, 1.5, strike);
          j.shoulderR.rotation.z += lerp(0, 1.15, wind) - lerp(0, 2.1, strike);
          j.elbowR.rotation.x += lerp(0, -1.75, wind) + lerp(0, 1.5, strike);
          j.chest.rotation.y += lerp(0, -0.6, wind) + lerp(0, 1.25, strike);
          break;
        }
        case 'power': {
          const wind = saturate(t / 0.45), strike = saturate((t - 0.45) / 0.22);
          j.shoulderR.rotation.x += lerp(0, -2.75, wind) + lerp(0, 3.7, strike);
          j.shoulderL.rotation.x += lerp(0, -1.6, wind) + lerp(0, 2.2, strike);
          j.elbowR.rotation.x += lerp(0, -1.2, wind) + lerp(0, 1.1, strike);
          j.spine.rotation.x += lerp(0, -0.42, wind) + lerp(0, 0.85, strike);
          j.chest.rotation.y += lerp(0, 0.55, wind) - lerp(0, 1.1, strike);
          break;
        }
        case 'shoot': {
          const rel = saturate(t / 0.18);
          j.shoulderL.rotation.x += -1.52;
          j.shoulderR.rotation.x += -1.3 + rel * 0.5;
          j.elbowR.rotation.x += -1.15 + rel * 1.0;
          j.chest.rotation.y += -0.30;
          break;
        }
        case 'castfire': {
          j.shoulderR.rotation.x += -1.6 * ease;
          j.shoulderR.rotation.z += -0.5 * ease;
          j.elbowR.rotation.x += -0.35 * ease;
          j.spine.rotation.x += -0.2 * ease;
          break;
        }
        case 'hit': {
          const k = Math.sin(t * Math.PI);
          j.spine.rotation.x += -0.42 * k;
          j.chest.rotation.z += 0.30 * k;
          j.neck.rotation.x += -0.30 * k;
          j.shoulderL.rotation.z += 0.5 * k;
          j.shoulderR.rotation.z += -0.5 * k;
          break;
        }
        case 'stagger': {
          const k = Math.sin(t * Math.PI);
          j.spine.rotation.x += -0.8 * k;
          j.pelvis.position.y -= 0.12 * k * this.rig.scale;
          j.hipL.rotation.x += 0.6 * k;
          j.kneeR.rotation.x += -0.9 * k;
          break;
        }
        case 'roar': {
          const k = Math.sin(t * Math.PI);
          j.spine.rotation.x += -0.55 * k;
          j.neck.rotation.x += -0.75 * k;
          j.shoulderL.rotation.z += 1.1 * k;
          j.shoulderR.rotation.z += -1.1 * k;
          j.shoulderL.rotation.x += -0.6 * k;
          j.shoulderR.rotation.x += -0.6 * k;
          break;
        }
      }
    }

    // ---- death -------------------------------------------------------------------
    if (this.deadT > 0.001) {
      const d = this.deadT;
      const e = d * d * (3 - 2 * d);
      j.pelvis.rotation.x += 1.45 * e;
      j.pelvis.position.y -= 0.72 * e * this.rig.scale;
      j.spine.rotation.x += 0.30 * e;
      j.neck.rotation.x += 0.45 * e;
      j.hipL.rotation.x += 0.75 * e; j.hipR.rotation.x += 0.35 * e;
      j.kneeL.rotation.x += -0.95 * e; j.kneeR.rotation.x += -0.45 * e;
      j.shoulderL.rotation.z += 1.25 * e; j.shoulderR.rotation.z += -0.9 * e;
    }

    // ---- head look ---------------------------------------------------------------
    j.neck.rotation.x += this.lookPitch * 0.42;
    j.head.rotation.x += this.lookPitch * 0.32;
    j.head.rotation.y += (s.headYaw ?? 0) * 0.5;

    // ---- cloak secondary motion ---------------------------------------------------
    // Simulating and re-uploading a cloth patch per actor per frame is not worth
    // paying for on someone forty metres away.
    if (this.rig.cloak && (s.near !== false)) this._cloak(dt, s);
  }

  _cloak(dt, s) {
    const c = this.rig.cloak;
    const pos = c.geo.attributes.position;
    const rest = c.rest;
    const t = this.breath;
    const speed = this.speed;
    const windX = s.windX ?? 0, windZ = s.windZ ?? 0, windS = s.windStrength ?? 0.2;
    for (let i = 0; i < pos.count; i++) {
      const rx = rest[i * 3], ry = rest[i * 3 + 1], rz = rest[i * 3 + 2];
      const down = saturate(-ry / c.h);              // 0 at the shoulders, 1 at the hem
      const flap = Math.sin(t * (3.2 + speed * 5) + rx * 3.4 + down * 5.2);
      const back = down * down * (0.10 + speed * 0.55 + windS * 0.22);
      pos.setXYZ(i,
        rx + flap * 0.035 * down * (0.4 + windS),
        ry + down * (speed * 0.12) - Math.abs(flap) * 0.02 * down,
        rz - back + flap * 0.045 * down);
    }
    pos.needsUpdate = true;
    c.geo.computeVertexNormals();
  }
}

// ---------------------------------------------------------------------------
// Creature rigs (non-humanoid)
// ---------------------------------------------------------------------------

export function buildQuadruped(mats, opts = {}) {
  const L = opts.length ?? 1.4;
  const H = opts.height ?? 0.85;
  const B = opts.build ?? 1;
  const body = mats.fur;
  const root = new THREE.Group();

  const core = joint(root, 'core', 0, H, 0);
  const chest = joint(core, 'chest', 0, 0.03, L * 0.30);
  const neck = joint(chest, 'neck', 0, 0.08, L * 0.16);
  const head = joint(neck, 'head', 0, 0.06, L * 0.16);
  const hipC = joint(core, 'hipC', 0, 0, -L * 0.30);
  const tail = joint(hipC, 'tail', 0, 0.04, -L * 0.10);

  part(core, capsule(0.20 * B, L * 0.55, 8), body, 0, 0, 0, Math.PI / 2, 0, 0);
  part(chest, capsule(0.21 * B, L * 0.16, 8), body, 0, 0, 0, Math.PI / 2, 0, 0);
  part(neck, capsule(0.11 * B, L * 0.16, 7), body, 0, 0.02, L * 0.06, 1.15, 0, 0);
  part(head, capsule(0.105 * B, L * 0.16, 8), body, 0, 0, L * 0.06, 1.45, 0, 0, 0.9, 1, 1);
  // ears
  for (const s of [1, -1]) part(head, box(0.035, 0.09, 0.02), body, s * 0.06, 0.09, -0.02, 0, 0, s * 0.25);
  // snout
  part(head, box(0.075, 0.07, 0.16), body, 0, -0.02, L * 0.16, 0, 0, 0);
  part(tail, capsule(0.045, L * 0.28, 6), body, 0, 0, -L * 0.14, Math.PI / 2 - 0.4, 0, 0);

  const legs = [];
  const legDefs = [
    ['fl', 0.13 * B, 0.06, L * 0.26], ['fr', -0.13 * B, 0.06, L * 0.26],
    ['bl', 0.14 * B, 0.04, -L * 0.26], ['br', -0.14 * B, 0.04, -L * 0.26],
  ];
  for (const [name, x, y, z] of legDefs) {
    const hip = joint(core, 'hip_' + name, x, y, z);
    const knee = joint(hip, 'knee_' + name, 0, -H * 0.46, 0);
    const foot = joint(knee, 'foot_' + name, 0, -H * 0.42, 0);
    part(hip, capsule(0.055 * B, H * 0.34, 6), body, 0, -H * 0.23, 0);
    part(knee, capsule(0.042 * B, H * 0.30, 6), body, 0, -H * 0.21, 0);
    part(foot, box(0.075, 0.05, 0.12), body, 0, -0.02, 0.02);
    legs.push({ hip, knee, foot, front: name[0] === 'f', left: name[1] === 'l' });
  }

  return { root, joints: { core, chest, neck, head, hipC, tail }, legs, height: H, length: L, scale: H / 0.85 };
}

export class QuadAnimator {
  constructor(rig) { this.rig = rig; this.phase = 0; this.speed = 0; this.breath = Math.random() * 9; this.deadT = 0; this.action = null; }
  play(name, dur = 0.5) { this.action = { name, dur, t: 0 }; }
  update(dt, s) {
    this.speed = damp(this.speed, s.speed01 ?? 0, 10, dt);
    this.breath += dt;
    this.phase = (this.phase + dt * lerp(2.2, 7.5, this.speed) * (0.3 + this.speed)) % TAU;
    if (this.action) { this.action.t += dt; if (this.action.t >= this.action.dur) this.action = null; }
    if (s.dead) this.deadT = Math.min(1, this.deadT + dt * 2.4);

    const j = this.rig.joints;
    for (const k in j) j[k].rotation.set(0, 0, 0);
    const p = this.phase;
    const amp = lerp(0.20, 0.95, this.speed);
    for (const leg of this.rig.legs) {
      const off = (leg.front ? 0 : Math.PI * 0.55) + (leg.left ? 0 : Math.PI);
      const ph = p + off;
      // Same convention as the humanoid: +rotation.x swings a limb backward,
      // and the swing phase (knee folded, foot off the ground) is centred on
      // the moment the limb reaches its rearmost point and starts forward.
      leg.hip.rotation.x = -Math.sin(ph) * amp;
      const swing = Math.max(0, Math.cos(ph - 0.25));
      // A foreleg folds its carpus backward; a hind leg folds its stifle forward.
      leg.knee.rotation.x = (leg.front ? 1 : -1) * swing * swing * amp * 1.35;
      leg.foot.rotation.x = (leg.front ? -1 : 1) * Math.max(0, -Math.sin(ph)) * amp * 0.35;
    }
    j.core.position.y = this.rig.height + (-Math.abs(Math.sin(p * 2)) * 0.05 * this.speed);
    j.core.rotation.x = this.speed * 0.10 + Math.sin(p * 2) * 0.04 * this.speed;
    j.neck.rotation.x = -0.15 + Math.sin(this.breath * 1.2) * 0.05 - this.speed * 0.2;
    j.head.rotation.x = 0.12 + Math.sin(this.breath * 1.7) * 0.06;
    j.tail.rotation.y = Math.sin(this.breath * 2.4 + p) * 0.3;
    j.tail.rotation.x = -0.2 + Math.sin(p * 2) * 0.18 * this.speed;

    if (this.action) {
      const t = saturate(this.action.t / this.action.dur);
      const k = Math.sin(t * Math.PI);
      if (this.action.name === 'bite') {
        j.neck.rotation.x += -0.75 * k;
        j.head.rotation.x += 0.85 * k;
        j.core.position.y += 0.12 * k;
      } else if (this.action.name === 'hit') {
        j.core.rotation.z += 0.3 * k;
        j.neck.rotation.x += 0.4 * k;
      }
    }
    if (this.deadT > 0.001) {
      const e = this.deadT;
      j.core.rotation.z += 1.5 * e;
      j.core.position.y = lerp(j.core.position.y, 0.22, e);
      j.neck.rotation.x += 0.6 * e;
    }
  }
}
