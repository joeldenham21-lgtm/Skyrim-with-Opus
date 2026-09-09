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
// Body: ONE skinned mesh, one draw call, built the way the SPAWN is built — the model in this game that
// works. The spawn's lesson, written down because the rest of the bestiary needs it:
//
//   1. Every mass is a stack of rings lofted into a continuous surface, NEVER a box. A box spends its
//      triangles on six flat plates and gives a four-corner outline however hard you taper it. The same
//      triangles spent on rings buy a curve, and the outline gets as many sides as the ring has segments.
//      The old slider was nineteen boxes; that is the entire reason it read as debris.
//   2. Masses are CHAINED with shrinking radii and a small drop between them, so the outline pinches at
//      every junction. The spawn's abdomen reverses direction four times in 0.36 m. That is what makes a
//      dark shape read as a body rather than a blob.
//   3. The MATERIAL carries the value range the albedo cannot. chitinCompile's fresnel term brightens the
//      albedo, adds emissive AND drops roughness at grazing angles, so the silhouette edge is brighter than
//      the interior whatever the light is doing. mimic.js's makeBodyMaterial had flat roughness 1.0 and no
//      view-dependent term at all, which is exactly why everything wearing it read as a paper cutout.
//
// On top of that, the design's own brief for this creature: "a mimic that runs on all fours, too fast,
// JOINTS WRONG". So the parts are human — a human torso worn horizontally (wide shoulders, a waist that
// pinches 47 % across and 40 % deep, a wide pelvis), human hands planted palm-down at the front, human feet
// at the back — and the
// articulation is impossible: every limb is a STUBBY upper segment and a very long lower one, which is what
// opens the joint angle past ninety degrees, so the fore elbow folds up and back above the shoulder line and
// the hind knee up and forward over the creature's own back. In outline the spine hangs BELOW two arches
// that no mammal has. The hind feet are on backwards, heel first. Every joint is a ball-jointed-doll joint
// (turned-in cap, gap, ball, gap, turned-in cap) so a limb pinches twice where a human limb pinches once,
// and the rings facing into the gaps carry the ember channel, so the cracks between the pieces glow.
//
// Colour: the mimic is cold olive; this is warm brown-black, torn open along the spine with wet resin
// underneath and bone-grey hands and feet at ground level. Value below the mimic, hue opposite to it — which
// is how you tell the two apart at forty metres when value alone has collapsed.
//
// If the characters module ever lands a quadruped denser than this one, that rig is used instead.
import * as THREE from 'three';
import { Enemy } from './common.js';
import { makeFace } from './mimic.js';
import { buildQuadruped } from './charmesh.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { hash3 } from '../core/rng.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';

// ---- module temporaries ----
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _cand = new THREE.Vector3(), _cam = new THREE.Vector3();
const _hip = new THREE.Vector3(), _foot = new THREE.Vector3(), _pole = new THREE.Vector3(), _axis = new THREE.Vector3(), _upper = new THREE.Vector3(), _knee = new THREE.Vector3(), _fore = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _col = new THREE.Color();
const _face = new THREE.Vector3(), _fwd = new THREE.Vector3(), _perp = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const UPV = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);
const COS_AIM = Math.cos(6 * DEG);

// ---- rig layout ----
// Fore limbs hang from the chest line, hind from the pelvis; every limb gets its own wrist/ankle bone so the
// hands and feet stay flat on the ground however impossibly the joint above them is folded.
const BONES = ['body', 'chest', 'neck', 'head', 'jaw', 'pelvis',
  'upFL', 'upFR', 'upHL', 'upHR', 'loFL', 'loFR', 'loHL', 'loHR', 'ftFL', 'ftFR', 'ftHL', 'ftHR'];
const bi = (n) => BONES.indexOf(n);
// Limb lengths. The lower segment is LONGER than the upper on both pairs, which no primate is, and the hind
// pair is longer again than the fore — so the haunch arch spikes higher than the shoulder arch and the
// silhouette is asymmetric front to back instead of four identical legs.
// Both pairs are a STUBBY upper segment and an enormously long lower one. That is not decoration: with a
// short upper and a long lower the interior angle at the shoulder opens past ninety degrees, which is the
// only way the joint apex can rise ABOVE the spine while the hand is still on the ground. It is also, by
// itself, an unmistakably wrong limb.
const LF1 = 0.30, LF2 = 0.66, LH1 = 0.30, LH2 = 0.58;
// The body is carried LOW — lower than the joints above it. That is the whole silhouette: the spine hangs
// under two arches, which is a thing no mammal on four legs does.
const TORSO_Y = 0.36, HIDDEN_Y = 0.13;
// legs: hip (body-local), rest foot and flat foot (mesh space), IK pole up and flat, phase offset.
// The poles are the whole "joints wrong" brief: fore folds UP AND BACK, hind folds UP AND FORWARD.
const LEGS = [
  { up: 'upFL', lo: 'loFL', ft: 'ftFL', side: -1, fwd: -1, L1: LF1, L2: LF2, hip: [-0.185, 0.006, -0.33],
    rest: [-0.305, 0, -0.672], flat: [-1.00, 0, -0.44], poleUp: [-0.55, 1.0, 0.15], poleFlat: [-1.0, 0.34, -0.16], off: 0.50 },
  { up: 'upFR', lo: 'loFR', ft: 'ftFR', side: 1, fwd: -1, L1: LF1, L2: LF2, hip: [0.185, -0.010, -0.33],
    rest: [0.288, 0, -0.638], flat: [1.02, 0, -0.40], poleUp: [0.60, 1.0, 0.12], poleFlat: [1.0, 0.34, -0.16], off: 0.63 },
  { up: 'upHL', lo: 'loHL', ft: 'ftHL', side: -1, fwd: 1, L1: LH1, L2: LH2, hip: [-0.155, 0.0, 0.34],
    rest: [-0.296, 0, 0.278], flat: [-0.93, 0, 0.58], poleUp: [-0.42, 1.0, -0.44], poleFlat: [-1.0, 0.30, 0.18], off: 0.0 },
  { up: 'upHR', lo: 'loHR', ft: 'ftHR', side: 1, fwd: 1, L1: LH1, L2: LH2, hip: [0.155, 0.0, 0.34],
    rest: [0.282, 0, 0.318], flat: [0.95, 0, 0.60], poleUp: [0.38, 1.0, -0.48], poleFlat: [1.0, 0.30, 0.18], off: 0.12 },
];
// where the head sits at rest, in mesh space: slung under and forward of the chest prow
const HEAD_Y = 0.175, HEAD_Z = -0.780;
const COS_FACE = Math.cos(58 * DEG);
// how many triangles a foreign rig carries, so we only adopt one that is at least as detailed as ours
function rigTris(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh && o.geometry) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return n;
}

// =====================================================================================================
// Geometry kit. A triangle soup that welds, creases and indexes itself, and rings/lofts to fill it.
// A vertex is [x, y, z, boneA, boneB, weightOnB]; colour and surface are recorded once per tint() as a span,
// because a creature is a handful of materials over several thousand triangles.
// =====================================================================================================
// surface: [roughness, metalness, shiver mask, sheen]
const SF = {
  cloth: [0.95, 0.00, 1.00, 0.10],
  torn: [0.92, 0.00, 1.35, 0.14],
  resin: [0.22, 0.06, 0.70, 0.80],     // set tar, still wet. The sheen channel is what catches the sky
  bone: [0.70, 0.00, 0.55, 0.18],
  skull: [0.55, 0.00, 1.05, 0.26],
  hard: [0.45, 0.06, 0.30, 0.34],
  gap: [0.90, 0.00, 0.35, 0.00],
  maw: [0.85, 0.00, 0.50, 0.00],
};
// wear: [edge rub, grime, surface pattern (1 = telogreika quilt, 2 = weave), joint ember]
const WR = {
  none: [0, 0, 0, 0],
  cloth: [0.90, 1.0, 1, 0],
  trous: [0.75, 1.0, 0, 0],
  torn: [1.00, 0.9, 0, 0.40],          // the frayed edge of the split, faintly lit all down the spine
  resin: [0.30, 0.4, 0, 0],
  bone: [0.90, 0.6, 0, 0],
  hard: [1.00, 0.5, 0, 0],
  gap: [0.00, 0.3, 0, 1],
  maw: [0.00, 0.0, 0, 1.7],            // the jaw interior: only ever seen when the jaw opens to screech
};
// The mimic is a cold olive uniform. This is the same uniform gone WARM: wet, brown-black, split open.
// Values sit under the mimic's and well above black, with one light accent — the hands and feet.
const COL = {
  cloth: 0x2c241c, clothB: 0x342a20, trouser: 0x241e18,
  torn: 0x8a4a2a,
  resin: 0x1b1613, resinB: 0x241c17,
  bone: 0x4a463f, boneB: 0x5c574c,
  skull: 0x2b272b, socket: 0x151216,
  hard: 0x403b31, gap: 0x0d0a08, maw: 0xc2551a,
};

class Soup {
  constructor() {
    this.cap = 4096; this.n = 0;
    this.p = new Float32Array(this.cap * 3);
    this.b = new Float32Array(this.cap * 3);
    this.spans = []; this.s = SF.cloth; this.w = WR.cloth;
    this.tint(COL.cloth, SF.cloth, WR.cloth);
  }
  tint(hex, surf, wear) {
    _col.setHex(hex);
    const s = surf || this.s, w = wear || this.w;
    this.spans.push(this.n, _col.r, _col.g, _col.b, s[0], s[1], s[2], s[3], w[0], w[1], w[2], w[3]);
    this.s = s; this.w = w;
    return this;
  }
  grow() {
    this.cap *= 2;
    const p = new Float32Array(this.cap * 3); p.set(this.p); this.p = p;
    const b = new Float32Array(this.cap * 3); b.set(this.b); this.b = b;
  }
  vert(v) {
    if (this.n >= this.cap) this.grow();
    const i = this.n * 3;
    this.p[i] = v[0]; this.p[i + 1] = v[1]; this.p[i + 2] = v[2];
    this.b[i] = v[3] || 0; this.b[i + 1] = v[4] === undefined ? (v[3] || 0) : v[4]; this.b[i + 2] = v[5] || 0;
    this.n++;
  }
  tri(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;      // collapsed: a pole fan or a zero-width seam
    this.vert(a); this.vert(b); this.vert(c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get tris() { return this.n / 3; }
  // Weld on the millimetre, crease, index. Same job as toCreasedNormals + mergeVertices, about a tenth of
  // the cost, because it works on flat arrays instead of BufferAttribute accessors and string keys.
  finish(creaseCos = 0.45) {
    const p = this.p, N = this.n;
    if (!N) return null;
    const spans = this.spans, sn = spans.length / 12;
    const mat = new Uint16Array(N);
    for (let k = 0; k < sn; k++) {
      const from = spans[k * 12], to = k + 1 < sn ? spans[(k + 1) * 12] : N;
      for (let i = from; i < to; i++) mat[i] = k;
    }
    const tris = N / 3;
    const fx = new Float32Array(tris), fy = new Float32Array(tris), fz = new Float32Array(tris);
    for (let t = 0; t < tris; t++) {
      const i = t * 9;
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fx[t] = nx / l; fy[t] = ny / l; fz[t] = nz / l;
    }
    const buckets = new Map(), bkey = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const qx = Math.round(p[i * 3] * 1000) + 2048, qy = Math.round(p[i * 3 + 1] * 1000) + 2048, qz = Math.round(p[i * 3 + 2] * 1000) + 2048;
      const k = (qx * 4096 + qy) * 4096 + qz;
      bkey[i] = k;
      const bk = buckets.get(k);
      if (bk) bk.push(i); else buckets.set(k, [i]);
    }
    const nrm = new Float32Array(N * 3);
    for (const list of buckets.values()) {
      const n = list.length;
      for (let a = 0; a < n; a++) {
        const i = list[a], ti = (i / 3) | 0;
        let nx = 0, ny = 0, nz = 0;
        for (let b = 0; b < n; b++) {
          const tj = (list[b] / 3) | 0;
          if (fx[ti] * fx[tj] + fy[ti] * fy[tj] + fz[ti] * fz[tj] >= creaseCos) { nx += fx[tj]; ny += fy[tj]; nz += fz[tj]; }
        }
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-9) { nrm[i * 3] = fx[ti]; nrm[i * 3 + 1] = fy[ti]; nrm[i * 3 + 2] = fz[ti]; }
        else { nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l; }
      }
    }
    const bo = this.b;
    const oP = new Float32Array(N * 3), oN = new Float32Array(N * 3), oC = new Float32Array(N * 3);
    const oS = new Float32Array(N * 4), oI = new Uint16Array(N * 4), oW = new Float32Array(N * 4);
    const oR = new Float32Array(N * 4);
    const index = new Uint32Array(N);
    const seen = new Map();
    let M = 0;
    for (let i = 0; i < N; i++) {
      const k = bkey[i];
      let list = seen.get(k);
      if (!list) { list = []; seen.set(k, list); }
      let hit = -1;
      for (let a = 0; a < list.length; a += 2) {
        const oi = list[a], src = list[a + 1];
        if (mat[i] !== mat[src]) continue;
        if (bo[i * 3] !== bo[src * 3] || bo[i * 3 + 1] !== bo[src * 3 + 1] || bo[i * 3 + 2] !== bo[src * 3 + 2]) continue;
        if (nrm[i * 3] * nrm[src * 3] + nrm[i * 3 + 1] * nrm[src * 3 + 1] + nrm[i * 3 + 2] * nrm[src * 3 + 2] < 0.9995) continue;
        hit = oi; break;
      }
      if (hit < 0) {
        hit = M++;
        const o3 = hit * 3, o4 = hit * 4, sp = mat[i] * 12;
        oP[o3] = p[i * 3]; oP[o3 + 1] = p[i * 3 + 1]; oP[o3 + 2] = p[i * 3 + 2];
        oN[o3] = nrm[i * 3]; oN[o3 + 1] = nrm[i * 3 + 1]; oN[o3 + 2] = nrm[i * 3 + 2];
        oC[o3] = spans[sp + 1]; oC[o3 + 1] = spans[sp + 2]; oC[o3 + 2] = spans[sp + 3];
        oS[o4] = spans[sp + 4]; oS[o4 + 1] = spans[sp + 5]; oS[o4 + 2] = spans[sp + 6]; oS[o4 + 3] = spans[sp + 7];
        oR[o4] = spans[sp + 8]; oR[o4 + 1] = spans[sp + 9]; oR[o4 + 2] = spans[sp + 10]; oR[o4 + 3] = spans[sp + 11];
        oI[o4] = bo[i * 3]; oI[o4 + 1] = bo[i * 3 + 1];
        oW[o4] = 1 - bo[i * 3 + 2]; oW[o4 + 1] = bo[i * 3 + 2];
        list.push(hit, i);
      }
      index[i] = hit;
    }
    const phase = new Float32Array(M), jdir = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      const kx = Math.round(oP[i * 3] * 1000) + 7, ky = Math.round(oP[i * 3 + 1] * 1000) + 3, kz = Math.round(oP[i * 3 + 2] * 1000) + 11;
      const a = hash3(kx, ky, kz), b = hash3(ky, kz, kx), c = hash3(kz, kx, ky);
      phase[i] = a;
      const jx = b - 0.5, jy = c - 0.5, jz = a - 0.5, jl = Math.hypot(jx, jy, jz) || 1;
      jdir[i * 3] = jx / jl; jdir[i * 3 + 1] = jy / jl; jdir[i * 3 + 2] = jz / jl;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(oP.subarray(0, M * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(oN.subarray(0, M * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(oC.subarray(0, M * 3), 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(oS.subarray(0, M * 4), 4));
    g.setAttribute('aWear', new THREE.BufferAttribute(oR.subarray(0, M * 4), 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(oI.subarray(0, M * 4), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(oW.subarray(0, M * 4), 4));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aJit', new THREE.BufferAttribute(jdir, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.35, 0), 1.5);
    this.p = null; this.b = null; this.spans.length = 0; this.n = 0;
    return g;
  }
}

// ---------------------------------------------------------------- rings and lofts
// Horizontal ring (limbs, head): angle 0 faces front (-z), positive toward +x. `pow` above 2 squares the
// section off, which is what a padded sleeve does and a cylinder does not.
function ringY(y, rx, rzF, rzB, o = {}) {
  const { seg = 12, pow = 2.2, cx = 0, cz = 0, b0 = 0, b1 = b0, w = 0, jit = 0, seed = 1 } = o;
  const k = 2 / pow, out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU, sa = Math.sin(a), ca = Math.cos(a);
    const sx = sa === 0 ? 0 : Math.sign(sa) * Math.pow(Math.abs(sa), k);
    const cp = ca === 0 ? 0 : Math.sign(ca) * Math.pow(Math.abs(ca), k);
    const rz = ca >= 0 ? rzF : rzB;
    const j = jit ? (hash3(i * 13 + seed, Math.round(y * 900), 7) - 0.5) * jit : 0;
    out.push([cx + sx * (rx + j), y, cz - cp * (rz + j), b0, b1, w]);
  }
  return out;
}
// Cross-section in the XY plane at depth z (torso, hands, feet): angle 0 is UP (+y), positive toward +x.
function sectZ(z, rx, ryT, ryB, o = {}) {
  const { seg = 18, pow = 2.3, cx = 0, cy = 0, b0 = 0, b1 = b0, w = 0, jit = 0, seed = 1 } = o;
  const k = 2 / pow, out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU, sa = Math.sin(a), ca = Math.cos(a);
    const sx = sa === 0 ? 0 : Math.sign(sa) * Math.pow(Math.abs(sa), k);
    const cp = ca === 0 ? 0 : Math.sign(ca) * Math.pow(Math.abs(ca), k);
    const ry = ca >= 0 ? ryT : ryB;
    const j = jit ? (hash3(i * 17 + seed, Math.round(z * 900), 3) - 0.5) * jit : 0;
    out.push([cx + sx * (rx + j), cy + cp * (ry + j), z, b0, b1, w]);
  }
  return out;
}
// Connect a stack of rings. Winding assumes the stack runs along +y (ringY) or +z (sectZ); anything built
// top-down or forward must pass flip or its faces point inward and the part vanishes under back-face culling.
function loft(S, rings, o = {}) {
  const { flip = false, capA = false, capB = false, cA = null, cB = null } = o;
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) S.quad(A[i], A[j], B[j], B[i]);
      else S.quad(A[i], B[i], B[j], A[j]);
    }
  }
  if (capA) capRing(S, rings[0], cA || centreOf(rings[0]), flip);
  if (capB) capRing(S, rings[rings.length - 1], cB || centreOf(rings[rings.length - 1]), !flip);
}
// Only part of the way round: used to loft the same stack twice, once as torn cloth over the flanks and once
// as bare resin along the split back, so the two surfaces are separate objects with a real edge between them.
function loftArc(S, rings, i0, count, flip = false) {
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    for (let k = 0; k < count - 1; k++) {
      const i = (i0 + k) % n, j = (i0 + k + 1) % n;
      if (flip) S.quad(A[i], A[j], B[j], B[i]);
      else S.quad(A[i], B[i], B[j], A[j]);
    }
  }
}
// The lip where the split cloth stops and the resin begins: a quad strip between two stacks at one index.
function seam(S, ringsA, ringsB, idx, flip = false) {
  for (let r = 0; r < ringsA.length - 1; r++) {
    const a0 = ringsA[r][idx], a1 = ringsA[r + 1][idx], b0 = ringsB[r][idx], b1 = ringsB[r + 1][idx];
    if (flip) S.quad(a0, a1, b1, b0); else S.quad(a0, b0, b1, a1);
  }
}
function centreOf(ring) {
  let x = 0, y = 0, z = 0;
  for (const v of ring) { x += v[0]; y += v[1]; z += v[2]; }
  const n = ring.length;
  return [x / n, y / n, z / n, ring[0][3], ring[0][4], ring[0][5]];
}
function capRing(S, ring, c, outward) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (outward) S.tri(c, b, a); else S.tri(c, a, b);
  }
}
// Scale a ring about its own centre and slide it along the stack axis. Every mass ends in one of these
// rather than a flat disc: a rim that turns in, then a dome.
function shrinkRing(ring, k, dy) {
  const c = centreOf(ring), out = [];
  for (const v of ring) out.push([c[0] + (v[0] - c[0]) * k, v[1] + dy, c[2] + (v[2] - c[2]) * k, v[3], v[4], v[5]]);
  return out;
}
// Key sections in, evenly spaced rings out, so one profile description serves both detail levels.
//   key = { y, rx, rf, rb, pow, b0, b1, w, jit, seed }
function resampleY(keys, step, seg) {
  const out = [];
  const emit = (k) => out.push(ringY(k.y, k.rx, k.rf ?? k.rx, k.rb ?? (k.rf ?? k.rx), {
    seg, pow: k.pow ?? 2.2, cx: k.cx || 0, cz: k.cz || 0,
    b0: k.b0 || 0, b1: k.b1 === undefined ? (k.b0 || 0) : k.b1, w: k.w || 0, jit: k.jit || 0, seed: k.seed || 1,
  }));
  for (let i = 0; i < keys.length - 1; i++) {
    const A = keys[i], B = keys[i + 1];
    const n = Math.max(1, Math.round(Math.abs(B.y - A.y) / step));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      emit({
        y: lerp(A.y, B.y, t), rx: lerp(A.rx, B.rx, t),
        rf: lerp(A.rf ?? A.rx, B.rf ?? B.rx, t), rb: lerp(A.rb ?? A.rf ?? A.rx, B.rb ?? B.rf ?? B.rx, t),
        pow: lerp(A.pow ?? 2.2, B.pow ?? 2.2, t), cx: lerp(A.cx || 0, B.cx || 0, t), cz: lerp(A.cz || 0, B.cz || 0, t),
        b0: A.b0, b1: A.b1, w: lerp(A.w || 0, B.w === undefined ? (A.w || 0) : B.w, t),
        jit: lerp(A.jit || 0, B.jit || 0, t), seed: (A.seed || 1) + j,
      });
    }
  }
  emit(keys[keys.length - 1]);
  return out;
}
// A ball joint: five rings of a slightly squared sphere with domed poles. The piece a ball-jointed doll has
// between two limb segments, and the thing you actually watch when the limb folds.
function ball(S, cx, cy, cz, r, o = {}) {
  const { seg = 12, rings = seg <= 8 ? 3 : 5, pow = 2.5, b0 = 0, b1 = b0, w = 0.5, sz = 1.0, col = COL.hard, surf = SF.hard, wear = WR.hard } = o;
  const R = [];
  for (let i = 0; i < rings; i++) {
    const t = -0.93 + 1.86 * i / (rings - 1);
    const k = Math.sqrt(Math.max(0.03, 1 - t * t));
    R.push(ringY(cy + t * r, r * k, r * k * sz, r * k * sz, { seg, pow, cx, cz, b0, b1, w }));
  }
  S.tint(col, surf, wear);
  loft(S, R, { capA: true, capB: true, cA: [cx, cy - r, cz, b0, b1, w], cB: [cx, cy + r, cz, b0, b1, w] });
}
// The ball-jointed-doll "peanut": two balls a short way apart on the bone axis, so the limb folds in two
// stages and the OUTLINE PINCHES TWICE. Elbows and knees get this; shoulders, hips and wrists get one ball.
function peanut(S, cx, cy, cz, r, gap, o = {}) {
  ball(S, cx, cy + gap * 0.5, cz, r, Object.assign({}, o, { w: o.wA ?? 0.28 }));
  ball(S, cx, cy - gap * 0.5, cz, r * 0.94, Object.assign({}, o, { w: o.wB ?? 0.72 }));
}

// =====================================================================================================
// The creature. Everything is authored in mesh space at the bind pose — limbs hanging straight down from
// their joints, hands and feet flat — and the IK folds them into the impossible arches at run time.
// =====================================================================================================
// The torso is a HUMAN torso worn horizontally: shoulders wide, waist 39 % narrower, pelvis wide again. A
// dog's chest is deep and narrow, a spider has no waist; this reads as a man lying prone, which is the
// point. cy sags in the middle, so the spine hangs BELOW the two joint arches.
const TKEY = [
  { z: -0.660, rx: 0.068, rt: 0.054, rb: 0.050, cy: 0.030, pow: 2.0 },
  { z: -0.580, rx: 0.114, rt: 0.092, rb: 0.086, cy: 0.026, pow: 2.1 },
  { z: -0.480, rx: 0.158, rt: 0.118, rb: 0.110, cy: 0.016, pow: 2.2 },
  { z: -0.380, rx: 0.206, rt: 0.130, rb: 0.130, cy: 0.006, pow: 2.5 },   // shoulders, widest
  { z: -0.260, rx: 0.196, rt: 0.124, rb: 0.154, cy: -0.006, pow: 2.6 },  // chest, deep, hangs low
  { z: -0.140, rx: 0.162, rt: 0.107, rb: 0.150, cy: -0.021, pow: 2.5 },  // ribs
  { z: 0.000, rx: 0.110, rt: 0.076, rb: 0.086, cy: -0.031, pow: 2.3 },   // waist: 47 % narrower AND
  { z: 0.140, rx: 0.139, rt: 0.089, rb: 0.106, cy: -0.023, pow: 2.3 },   // 40 % shallower than the chest
  { z: 0.280, rx: 0.187, rt: 0.116, rb: 0.140, cy: -0.006, pow: 2.5 },   // pelvis
  { z: 0.400, rx: 0.168, rt: 0.104, rb: 0.110, cy: 0.006, pow: 2.4 },
  { z: 0.520, rx: 0.099, rt: 0.067, rb: 0.069, cy: 0.014, pow: 2.2 },
  { z: 0.640, rx: 0.042, rt: 0.030, rb: 0.032, cy: 0.016, pow: 2.0 },
];
function torsoBone(z) {
  const C = bi('chest'), B = bi('body'), P = bi('pelvis');
  if (z <= -0.42) return [C, C, 0];
  if (z < -0.12) return [C, B, (z + 0.42) / 0.30];
  if (z <= 0.14) return [B, B, 0];
  if (z < 0.42) return [B, P, (z - 0.14) / 0.28];
  return [B, P, 1];
}
// The cloth shell is the same stack pushed out; the window closes at both ends so the two stacks share their
// end rings exactly and one cap closes the whole thing.
function clothOff(t) { return 0.016 * Math.sin(Math.PI * clamp01((t - 0.06) / 0.88)); }
function torsoRings(seg, step, swell) {
  const out = [];
  for (let i = 0; i < TKEY.length - 1; i++) {
    const A = TKEY[i], B = TKEY[i + 1];
    const n = Math.max(1, Math.round((B.z - A.z) / step));
    for (let j = 0; j < n; j++) {
      const u = j / n, z = lerp(A.z, B.z, u), t = (z - TKEY[0].z) / (TKEY[TKEY.length - 1].z - TKEY[0].z);
      const o = swell ? clothOff(t) : 0;
      const bn = torsoBone(z);
      out.push(sectZ(z, lerp(A.rx, B.rx, u) + o, lerp(A.rt, B.rt, u) + o, lerp(A.rb, B.rb, u) + o, {
        seg, pow: lerp(A.pow, B.pow, u), cy: TORSO_Y + lerp(A.cy, B.cy, u),
        b0: bn[0], b1: bn[1], w: bn[2], jit: swell ? 0.006 : 0.003, seed: i * 31 + j,
      }));
    }
  }
  const L = TKEY[TKEY.length - 1], bn = torsoBone(L.z);
  out.push(sectZ(L.z, L.rx, L.rt, L.rb, { seg, pow: L.pow, cy: TORSO_Y + L.cy, b0: bn[0], b1: bn[1], w: bn[2] }));
  return out;
}
function buildTorso(S, seg, step) {
  const T = torsoRings(seg, step, false);      // the resin core: what shows through the split
  const C = torsoRings(seg, step, true);       // the cloth over the flanks and belly
  const half = Math.max(1, Math.round(seg * 2 / 18));
  const iTop = seg - half, nTop = half * 2 + 1;
  const iSide = half, nSide = seg - half * 2 + 1;
  // the tear is ragged: each cloth ring's two boundary vertices ride up or down a little
  for (let r = 0; r < C.length; r++) {
    for (const idx of [half, seg - half]) {
      const v = C[r][idx], k = (hash3(r * 7 + idx, 13, 5) - 0.5);
      v[1] += k * 0.030; v[0] *= 1 + k * 0.06;
    }
  }
  S.tint(COL.resin, SF.resin, WR.resin);
  loftArc(S, T, iTop, nTop);
  S.tint(COL.cloth, SF.cloth, WR.cloth);
  loftArc(S, C, iSide, nSide);
  S.tint(COL.torn, SF.torn, WR.torn);
  seam(S, C, T, half, false);
  seam(S, C, T, seg - half, true);
  S.tint(COL.resin, SF.resin, WR.resin);
  capRing(S, T[0], centreOf(T[0]), false);
  capRing(S, T[T.length - 1], centreOf(T[T.length - 1]), true);
  return [T, C];
}
// The vertebrae standing out of the split, and the two shoulder blades. Both are hard resin, and both are
// what makes the back read at forty metres when the flanks have gone to one value.
function buildRidge(S, T, seg) {
  S.tint(COL.resinB, SF.resin, WR.resin);
  const step = seg >= 16 ? 2 : 3;
  for (let r = 3; r < T.length - 3; r += step) {
    const b = T[r][0], h = 0.020 + 0.026 * Math.sin(Math.PI * (r / T.length));
    const bn = [b[3], b[4], b[5]];
    const R = [
      ringY(b[1] - 0.012, 0.016, 0.034, 0.034, { seg: 6, cz: b[2], b0: bn[0], b1: bn[1], w: bn[2] }),
      ringY(b[1] + h * 0.55, 0.011, 0.026, 0.024, { seg: 6, cz: b[2], b0: bn[0], b1: bn[1], w: bn[2] }),
      ringY(b[1] + h, 0.004, 0.011, 0.010, { seg: 6, cz: b[2] + 0.004, b0: bn[0], b1: bn[1], w: bn[2] }),
    ];
    loft(S, R, { capB: true });
  }
  // scapulae: two blades over the shoulders, tilted out, standing proud of the split
  const bn = [bi('chest'), bi('chest'), 0];
  for (const s of [-1, 1]) {
    const R = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      R.push(ringY(TORSO_Y + 0.104 + t * 0.062, lerp(0.030, 0.012, t), lerp(0.072, 0.040, t), lerp(0.062, 0.034, t),
        { seg: 8, cx: s * (0.072 + t * 0.036), cz: -0.288 + t * 0.020, b0: bn[0], b1: bn[1], w: bn[2] }));
    }
    loft(S, R, { capA: true, capB: true });
  }
}
// Torn tabs of cloth hanging off the split. Cheap, and they break the long straight tear line in outline.
function buildFlaps(S, C, seg) {
  S.tint(COL.clothB, SF.torn, WR.torn);
  const half = Math.max(1, Math.round(seg * 2 / 18));
  const spots = [[0.20, -1], [0.38, 1], [0.55, -1], [0.72, 1], [0.86, -1]];
  for (const [t, s] of spots) {
    const r = Math.min(C.length - 2, Math.max(1, Math.round(t * (C.length - 1))));
    const a = C[r][s < 0 ? seg - half : half];
    const bn = [a[3], a[4], a[5]];
    const R = [];
    for (let i = 0; i < 3; i++) {
      const u = i / 2;
      R.push(ringY(a[1] - u * 0.105, lerp(0.030, 0.009, u), lerp(0.040, 0.012, u), lerp(0.036, 0.010, u),
        { seg: 6, cx: a[0] * (1 + u * 0.30), cz: a[2] + u * 0.026 * (s < 0 ? -1 : 1), b0: bn[0], b1: bn[1], w: bn[2], jit: u * 0.012, seed: r * 3 }));
    }
    loft(S, R, { flip: true, capB: true });
  }
}
// Neck, skull and jaw. The head is deliberately the LEAST detailed thing on the body and carries exactly one
// shape event: a shallow oval socket where a face should be, carved into the skull rings themselves so it has
// no free edges. Blank reads as a deletion from a finished figure; blank on an unfinished body reads as a
// placeholder, which is what the old head was.
const SKEY = [
  { y: 0.092, rx: 0.020, rf: 0.022, rb: 0.020, pow: 2.0 },
  { y: 0.074, rx: 0.050, rf: 0.058, rb: 0.056, pow: 2.1 },
  { y: 0.050, rx: 0.072, rf: 0.082, rb: 0.078, pow: 2.2 },
  { y: 0.020, rx: 0.082, rf: 0.089, rb: 0.086, pow: 2.4 },
  { y: -0.008, rx: 0.080, rf: 0.087, rb: 0.083, pow: 2.5 },
  { y: -0.034, rx: 0.070, rf: 0.078, rb: 0.072, pow: 2.5 },
  { y: -0.058, rx: 0.055, rf: 0.062, rb: 0.056, pow: 2.4 },
  { y: -0.080, rx: 0.036, rf: 0.042, rb: 0.038, pow: 2.2 },
  { y: -0.096, rx: 0.016, rf: 0.019, rb: 0.017, pow: 2.0 },
];
function buildHead(S, seg) {
  const bC = bi('chest'), bN = bi('neck'), bH = bi('head'), bJ = bi('jaw');
  // neck: down and forward off the chest, so the head hangs UNDER the shoulder line
  S.tint(COL.resin, SF.resin, WR.resin);
  const N = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    N.push(ringY(lerp(TORSO_Y + 0.028, HEAD_Y + 0.072, t), lerp(0.082, 0.050, t), lerp(0.088, 0.056, t), lerp(0.080, 0.050, t),
      { seg: seg - 2, pow: 2.3, cz: lerp(-0.570, HEAD_Z + 0.022, t), b0: t < 0.35 ? bC : bN, b1: t < 0.35 ? bN : bH, w: t < 0.35 ? t / 0.35 * 0.85 : (t - 0.35) / 0.65 * 0.9 }));
  }
  loft(S, N, { flip: true });
  // skull, top-down, with the socket carved into it
  const R = [];
  for (let i = 0; i < SKEY.length - 1; i++) {
    const A = SKEY[i], B = SKEY[i + 1];
    const n = Math.abs(B.y - A.y) > 0.030 ? 2 : 1;
    for (let j = 0; j < n; j++) {
      const t = j / n;
      R.push(ringY(HEAD_Y + lerp(A.y, B.y, t), lerp(A.rx, B.rx, t), lerp(A.rf, B.rf, t), lerp(A.rb, B.rb, t),
        { seg, pow: lerp(A.pow, B.pow, t), cx: 0.004, cz: HEAD_Z, b0: bH, b1: bH, w: 0, jit: 0.004, seed: i * 5 + j }));
    }
  }
  const last = SKEY[SKEY.length - 1];
  R.push(ringY(HEAD_Y + last.y, last.rx, last.rf, last.rb, { seg, pow: last.pow, cx: 0.004, cz: HEAD_Z, b0: bH, b1: bH, w: 0 }));
  // carve: a shallow oval dip on the front face, 62 x 78 mm, 6 mm deep
  const sy = HEAD_Y - 0.008;
  for (const ring of R) {
    for (const v of ring) {
      const dy = (v[1] - sy) / 0.042, dx = (v[0] - 0.004) / 0.034;
      const front = clamp01((HEAD_Z - v[2]) / 0.070);
      const k = Math.max(0, 1 - dy * dy - dx * dx);
      if (k <= 0) continue;
      v[2] += 0.0062 * k * front;
    }
  }
  const band = [];
  for (let i = 0; i < R.length; i++) if (Math.abs(R[i][0][1] - sy) < 0.055) band.push(i);
  const b0 = band.length ? band[0] : 3, b1 = band.length ? band[band.length - 1] : 5;
  const q = Math.max(2, Math.round(seg * 3 / 14));
  S.tint(COL.skull, SF.skull, WR.bone);
  loft(S, R.slice(0, b0 + 1), { flip: true, capA: true });
  loft(S, R.slice(b1), { flip: true, capB: true });
  const mid = R.slice(b0, b1 + 1);
  loftArc(S, mid, q, seg - q * 2 + 1, true);
  S.tint(COL.socket, SF.skull, WR.none);
  loftArc(S, mid, seg - q, q * 2 + 1, true);
  // jaw: a wedge on its own bone. Its top and the skull's underside are the maw, and they only ever show
  // when the jaw drops for the screech.
  const J = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    J.push(ringY(HEAD_Y - 0.048 - t * 0.070, lerp(0.052, 0.026, t), lerp(0.064, 0.030, t), lerp(0.044, 0.020, t),
      { seg: seg - 4, pow: 2.3, cx: 0.002, cz: HEAD_Z - 0.026 - t * 0.030, b0: bJ, b1: bJ, w: 0 }));
  }
  S.tint(COL.skull, SF.skull, WR.bone);
  loft(S, J, { flip: true, capB: true });
  S.tint(COL.maw, SF.maw, WR.maw);
  capRing(S, J[0], centreOf(J[0]), true);
  const roof = ringY(HEAD_Y - 0.052, 0.046, 0.056, 0.038, { seg: seg - 4, pow: 2.3, cx: 0.002, cz: HEAD_Z - 0.026, b0: bH, b1: bH, w: 0 });
  capRing(S, roof, centreOf(roof), false);
}

// One limb, authored hanging straight down from its joint. Every mass turns in to a narrow rim, leaves a gap,
// meets a ball, leaves a gap and turns out again — so the outline pinches TWICE per joint, which is the doll
// read. The rings facing into the gaps carry the ember channel, so the cracks between the pieces glow.
function buildLimb(S, L, seg) {
  const hx = L.hip[0], hy = TORSO_Y + L.hip[1], hz = L.hip[2];
  const bT = L.fwd < 0 ? bi('chest') : bi('pelvis');
  const bU = bi(L.up), bD = bi(L.lo), bF = bi(L.ft);
  const fore = L.fwd < 0;
  // Arms are thinner than legs, as they were on the person this used to be: the front pair reads as arms
  // planted on their hands, the back pair as haunches. Four identical limbs read as an animal.
  const rA = fore ? 0.053 : 0.072;                 // upper segment base radius
  const rB = fore ? 0.043 : 0.052;                 // lower segment base radius
  const kneeY = hy - L.L1, wristY = hy - L.L1 - L.L2;
  const cloth = fore ? COL.cloth : COL.trouser;
  const clothW = fore ? WR.cloth : WR.trous;
  // shoulder / hip ball
  ball(S, hx, hy, hz, rA * 1.10, { seg, b0: bT, b1: bU, w: 0.5, col: COL.hard });
  // upper segment: out at the deltoid, in above the joint. 16 %, because 5 % does not read.
  const at = (o) => Object.assign({ cx: hx, cz: hz, b0: bU, b1: bD }, o);
  const U = resampleY([
    at({ y: hy - 0.014, rx: rA * 0.66, w: 0.02 }),
    at({ y: hy - 0.050, rx: rA * 1.02, w: 0.03 }),
    at({ y: hy - L.L1 * 0.30, rx: rA * 1.24, w: 0.05, jit: 0.004 }),
    at({ y: hy - L.L1 * 0.64, rx: rA * 0.94, w: 0.10, jit: 0.004 }),
    at({ y: kneeY + 0.062, rx: rA * 0.78, w: 0.15 }),
    at({ y: kneeY + 0.038, rx: rA * 0.46, w: 0.20 }),
  ], 0.055, seg);
  S.tint(COL.gap, SF.gap, WR.gap);
  loft(S, U.slice(0, 2), { flip: true, capA: true });
  S.tint(cloth, SF.cloth, clothW);
  loft(S, U.slice(1, U.length - 1), { flip: true });
  S.tint(COL.gap, SF.gap, WR.gap);
  loft(S, U.slice(U.length - 2), { flip: true, capB: true });
  // the elbow / knee peanut: two balls, so the limb folds in two stages
  peanut(S, hx, kneeY, hz, rA * 0.92, 0.030, { seg, b0: bU, b1: bD, col: COL.hard });
  // lower segment: the forearm and calf belly, then in hard to the wrist
  const D = resampleY([
    at({ y: kneeY - 0.038, rx: rB * 0.50, w: 0.82 }),
    at({ y: kneeY - 0.064, rx: rB * 0.94, w: 0.94 }),
    at({ y: kneeY - L.L2 * 0.22, rx: rB * 1.26, b0: bD, b1: bF, w: 0.0, jit: 0.004 }),
    at({ y: kneeY - L.L2 * 0.58, rx: rB * 0.88, b0: bD, b1: bF, w: 0.06, jit: 0.003 }),
    at({ y: wristY + 0.058, rx: rB * 0.66, b0: bD, b1: bF, w: 0.16 }),
    at({ y: wristY + 0.034, rx: rB * 0.44, b0: bD, b1: bF, w: 0.26 }),
  ], 0.055, seg);
  S.tint(COL.gap, SF.gap, WR.gap);
  loft(S, D.slice(0, 2), { flip: true, capA: true });
  S.tint(fore ? cloth : COL.resin, fore ? SF.cloth : SF.resin, fore ? clothW : WR.resin);
  loft(S, D.slice(1, D.length - 1), { flip: true });
  S.tint(COL.gap, SF.gap, WR.gap);
  loft(S, D.slice(D.length - 2), { flip: true, capB: true });
  // wrist / ankle
  ball(S, hx, wristY, hz, rB * 0.92, { seg: Math.max(8, seg - 2), rings: 4, b0: bD, b1: bF, w: 0.5, col: COL.hard });
  if (fore) buildHand(S, L, seg, hx, wristY, hz, bF);
  else buildFoot(S, L, seg, hx, wristY, hz, bF);
}
// A human hand, palm down, thumb out, three fingers fused. Bone-grey: with the body in the 0.12-0.17 band
// these are the only light values on the creature and they are at ground level, so what you see coming
// through the grass is four pale patches moving very fast.
function buildHand(S, L, seg, x, y, z, b) {
  const n = Math.max(8, seg - 2), cy = y - 0.026;
  S.tint(COL.bone, SF.bone, WR.bone);
  const P = [
    sectZ(z + 0.040, 0.030, 0.017, 0.015, { seg: n, pow: 2.6, cx: x, cy, b0: b, b1: b, w: 0 }),
    sectZ(z - 0.004, 0.049, 0.020, 0.018, { seg: n, pow: 2.9, cx: x, cy, b0: b, b1: b, w: 0 }),
    sectZ(z - 0.056, 0.054, 0.018, 0.016, { seg: n, pow: 3.0, cx: x + L.side * 0.004, cy: cy - 0.002, b0: b, b1: b, w: 0 }),
    sectZ(z - 0.086, 0.049, 0.014, 0.013, { seg: n, pow: 3.0, cx: x + L.side * 0.006, cy: cy - 0.004, b0: b, b1: b, w: 0 }),
  ];
  loft(S, P, { flip: true, capA: true });
  const digit = (cx0, cz0, cx1, cz1, r0, r1, drop) => {
    const R = [
      sectZ(cz0, r0, r0 * 0.78, r0 * 0.72, { seg: 6, pow: 2.6, cx: cx0, cy: cy - 0.002, b0: b, b1: b, w: 0 }),
      sectZ(lerp(cz0, cz1, 0.55), lerp(r0, r1, 0.55), lerp(r0, r1, 0.55) * 0.74, lerp(r0, r1, 0.55) * 0.68,
        { seg: 6, pow: 2.6, cx: lerp(cx0, cx1, 0.55), cy: cy - 0.002 - drop * 0.5, b0: b, b1: b, w: 0 }),
      sectZ(cz1, r1, r1 * 0.70, r1 * 0.66, { seg: 6, pow: 2.4, cx: cx1, cy: cy - 0.002 - drop, b0: b, b1: b, w: 0 }),
    ];
    loft(S, R, { flip: true, capB: true });
  };
  S.tint(COL.boneB, SF.bone, WR.bone);
  for (let i = -1; i <= 1; i++) {
    const cx = x + L.side * 0.006 + i * 0.031;
    digit(cx, z - 0.084, cx + i * 0.012, z - 0.150 - Math.abs(i) * -0.008, 0.015, 0.010, 0.008);
  }
  // the thumb, out to the side: the detail that stops it reading as a paw
  digit(x + L.side * 0.048, z - 0.010, x + L.side * 0.090, z - 0.062, 0.016, 0.010, 0.006);
}
// A human foot put on BACKWARDS: heel forward, toes trailing behind. A cheap, deeply wrong read, and it is
// the thing you see last as it goes past you.
function buildFoot(S, L, seg, x, y, z, b) {
  const n = Math.max(8, seg - 2), cy = y - 0.028;
  S.tint(COL.bone, SF.bone, WR.bone);
  const P = [
    sectZ(z - 0.052, 0.031, 0.022, 0.019, { seg: n, pow: 2.5, cx: x, cy, b0: b, b1: b, w: 0 }),
    sectZ(z + 0.006, 0.044, 0.025, 0.021, { seg: n, pow: 2.8, cx: x, cy, b0: b, b1: b, w: 0 }),
    sectZ(z + 0.072, 0.049, 0.019, 0.017, { seg: n, pow: 3.0, cx: x - L.side * 0.004, cy: cy - 0.002, b0: b, b1: b, w: 0 }),
    sectZ(z + 0.114, 0.043, 0.014, 0.013, { seg: n, pow: 3.0, cx: x - L.side * 0.008, cy: cy - 0.004, b0: b, b1: b, w: 0 }),
  ];
  loft(S, P, { capA: true });
  S.tint(COL.boneB, SF.bone, WR.bone);
  for (let i = -1; i <= 1; i++) {
    const cx = x - L.side * 0.008 + i * 0.028;
    const R = [
      sectZ(z + 0.112, 0.014, 0.011, 0.010, { seg: 6, pow: 2.6, cx, cy: cy - 0.003, b0: b, b1: b, w: 0 }),
      sectZ(z + 0.148, 0.010, 0.008, 0.007, { seg: 6, pow: 2.4, cx: cx + i * 0.008, cy: cy - 0.007, b0: b, b1: b, w: 0 }),
    ];
    loft(S, R, { capB: true });
  }
}

const GEO = [null, null];
function buildGeometry(lod = 0) {
  if (GEO[lod]) return GEO[lod];
  const segT = lod ? 12 : 18, segL = lod ? 8 : 12, segH = lod ? 10 : 14;
  const step = lod ? 0.105 : 0.055;
  const S = new Soup();
  const [T, C] = buildTorso(S, segT, step);
  buildRidge(S, T, segT);
  if (!lod) buildFlaps(S, C, segT);
  buildHead(S, segH);
  for (const L of LEGS) buildLimb(S, L, segL);
  const g = S.finish();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.35, 0), 1.6);
  g.userData.shared = true;
  GEO[lod] = g;
  return g;
}

// =====================================================================================================
// Material. One program for every slider (customProgramCacheKey), one instance per actor because the
// dissolve and the flinch are per actor. This is the SPAWN's material language, not the mimic's: a fresnel
// term that brightens the albedo, adds emissive AND drops roughness at grazing angles, so the silhouette
// edge is brighter than the interior under any light. On top of it, weathered() from weapons/gunmesh.js:
// curvature-driven edge rub to bare cloth, axial scratches, the telogreika quilt as a per-vertex pattern,
// wet mud low down and a thin-film sheen where the resin shows through the split.
const SHARED = {
  uRim: { value: 0.70 }, uRimCol: { value: new THREE.Color(0.16, 0.18, 0.21) },
  uFill: { value: new THREE.Color(0.30, 0.32, 0.34) },
};
const FILL_K = 3.0;
let skyT = -1;
function refreshSky(ctx) {
  if (!ctx || ctx.elapsed === skyT || !ctx.lighting) return;
  skyT = ctx.elapsed;
  const h = ctx.lighting.horizon, z = ctx.lighting.zenith;
  if (!h || !z) return;
  const night = ctx.time ? ctx.time.night : 0;
  SHARED.uRimCol.value.setRGB(h.r * 0.55 + z.r * 0.45, h.g * 0.55 + z.g * 0.45, h.b * 0.55 + z.b * 0.45)
    .multiplyScalar(0.70 * (1 - night * 0.55));
  SHARED.uFill.value.setRGB(h.r * 0.5 + z.r * 0.5, h.g * 0.5 + z.g * 0.5, h.b * 0.5 + z.b * 0.5)
    .multiplyScalar(FILL_K * (1 - night * 0.72));
}

const SL_VERT = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf; varying vec4 vWear; varying float vPh;
attribute vec4 aSurf; attribute vec4 aWear; attribute float aPhase; attribute vec3 aJit;
uniform float uTime, uShiver, uSeed;`;
const SL_FRAG = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf; varying vec4 vWear; varying float vPh;
uniform float uDissolve, uGrime, uRim, uEmber, uMaw, uHit, uTime, uSeed;
uniform vec3 uRimCol, uDust, uBare, uMud, uEmberCol, uMawCol, uFill;`;

function sliderCompile(shader) {
  const u = this.userData.u;
  for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
  for (const k in u) shader.uniforms[k] = u[k];
  shader.uniforms.uRim = SHARED.uRim;
  shader.uniforms.uRimCol = SHARED.uRimCol;
  shader.uniforms.uFill = SHARED.uFill;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${SL_VERT}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSurf = aSurf;\n  vWear = aWear;\n  vPh = aPhase;\n  float vShv = aSurf.z;')
    .replace('#include <skinning_vertex>', /* glsl */`#include <skinning_vertex>
      {
        float ph = aPhase * 61.7 + uSeed;
        float slot = floor(uTime * 20.0 + aPhase * 5.0);
        float n1 = hash11(slot + ph) - 0.5;
        float n2 = hash11(slot * 1.31 + ph * 0.7 + 3.1) - 0.5;
        float spike = step(0.945, hash11(slot * 0.11 + ph * 3.3));
        float amp = uShiver * (0.012 + spike * 0.034) * vShv;
        transformed += (objectNormal * n1 * 0.7 + aJit * n2) * amp;
      }
      vCPos = transformed;
      vCN = objectNormal;
      vWN = normalize(mat3(modelMatrix) * objectNormal);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${SL_FRAG}`)
    .replace('#include <clipping_planes_fragment>', /* glsl */`#include <clipping_planes_fragment>
      float dsv = 0.0;
      if (uDissolve > 0.0) {
        float dn = fbm3d(vCPos * 4.0);
        float th = uDissolve * 1.15 - 0.05;
        if (dn < th) discard;
        dsv = smoothstep(th + 0.07, th, dn);
      }
      float fres = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
      float fr = pow(fres, 2.6);
      float wetN = fbm3d(vCPos * 22.0 + uSeed);
      vec3 oil = 0.5 + 0.5 * cos(6.2831 * (fr * 1.4 + wetN * 0.6 + vec3(0.0, 0.33, 0.67)) + uSeed);`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      {
        float n1 = vnoise3(vCPos * 9.0);
        float n2 = vnoise3(vCPos * 31.0);
        diffuseColor.rgb *= 0.80 + 0.44 * n1 + 0.12 * n2;
        // the quilt it still half is: on a creature lying along z the channels run round the body, not up it
        if (vWear.z > 0.5) {
          float pat = smoothstep(0.30, 0.70, 0.5 + 0.5 * sin(vCPos.z * 175.0 + n1 * 2.2));
          diffuseColor.rgb *= 1.0 - 0.30 * (pat - 0.5);
        }
        // curvature-driven edge rub: the one change that stops cloth reading as a cutout
        float curv = length(fwidth(vNormal)) / max(length(fwidth(vCPos)), 1e-6);
        float edge = smoothstep(150.0, 560.0, curv) * smoothstep(0.28, 0.72, n2) * vWear.x;
        float sc = smoothstep(0.930, 0.972, vnoise(vec2(vCPos.z * 70.0 + uSeed, vCPos.x * 260.0 + vCPos.y * 170.0))) * vWear.x;
        diffuseColor.rgb = mix(diffuseColor.rgb, uBare, clamp(edge + sc * 0.75, 0.0, 0.85));
        // wet: the resin under the split catches the sky as a thin film, purple-green
        diffuseColor.rgb += (vec3(0.045, 0.058, 0.055) + oil * 0.075) * fr * vSurf.w * 2.6;
        // it lives on its belly. Pale grit on what faces up, wet ground on what drags.
        float up = clamp(vCN.y, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDust, up * up * 0.20 * uGrime * vWear.y * (0.35 + 0.65 * n1));
        float low = smoothstep(0.24, -0.03, vCPos.y) * uGrime * vWear.y;
        diffuseColor.rgb = mix(diffuseColor.rgb, uMud, low * 0.46 * (0.4 + 0.6 * n2));
        diffuseColor.rgb += (vec3(0.05, 0.06, 0.062) + oil * 0.03) * fr * 0.8;
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.30, 0.29), dsv);`)
    .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      roughnessFactor = clamp(vSurf.x + (vnoise3(vCPos * 44.0) - 0.5) * 0.13 - fr * 0.30 - vSurf.w * 0.20, 0.05, 1.0);`)
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vSurf.y;')
    // a torch at a metre is hundreds of times daylight and burns the thing to a white cut-out; cap the local
    // lights per fragment the way the viewmodel does. Sun, moon and hemisphere are untouched.
    .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
      .replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( 7.0 ) );')
      .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );', 'getSpotLightInfo( spotLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( 5.0 ) );'))
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += uFill * (0.40 + 0.60 * clamp(vWN.y * 0.5 + 0.5, 0.0, 1.0)) * BRDF_Lambert(material.diffuseColor);`)
    .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        float jw = step(1.2, vWear.w);              // the maw: only lit while the jaw is open
        float jt = vWear.w * (1.0 - jw);            // the joint gaps and the torn seam
        totalEmissiveRadiance += uEmberCol * (uEmber * jt * (0.55 + 0.45 * sin(uTime * 2.4 + vPh * 30.0)) * (1.0 + uHit * 1.6));
        totalEmissiveRadiance += uMawCol * (uMaw * jw * (0.82 + 0.18 * sin(uTime * 9.0 + vPh * 12.0)));
        // the spawn's edge: a self-lit rim that survives shadow, so the outline never goes flat
        totalEmissiveRadiance += (vec3(0.030, 0.040, 0.038) + oil * 0.030) * fr * (0.7 + 1.5 * uHit) * (0.30 + vSurf.w);
      }`)
    .replace('#include <opaque_fragment>', /* glsl */`#include <opaque_fragment>
      {
        float dist = length(vViewPosition);
        float gate = mix(0.38, 1.0, smoothstep(1.5, 14.0, dist));
        float k = pow(fres, 1.9) * gate * (0.40 + 0.60 * clamp(vWN.y * 0.55 + 0.55, 0.0, 1.0));
        gl_FragColor.rgb += uRimCol * (k * uRim * (1.0 - dsv));
      }`);
}
function makeSliderMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.userData.u = {
    uTime: { value: 0 }, uShiver: { value: 0.6 }, uDissolve: { value: 0 }, uSeed: { value: Math.random() * 100 },
    uGrime: { value: 1 }, uHit: { value: 0 },
    uDust: { value: new THREE.Color(0x8a8578) },     // pale grit on what faces the sky
    uMud: { value: new THREE.Color(0x2e2419) },      // wet ground on what drags
    uBare: { value: new THREE.Color(0x6a6152) },     // rubbed through to faded cloth
    uEmber: { value: 0.40 }, uEmberCol: { value: new THREE.Color(0xb45a1e) },
    uMaw: { value: 0 }, uMawCol: { value: new THREE.Color(0xc2551a) },
  };
  mat.onBeforeCompile = sliderCompile;
  mat.customProgramCacheKey = () => 'radius-slider';
  return mat;
}

// Dev hook for the smoke harness (tools/scenarios/ent-beasts-*.mjs): the mesh and its material in isolation,
// so silhouette, palette and shader compilation can be judged without booting a world. Costs one property on
// the global object; nothing in the game reads it.
if (typeof globalThis !== 'undefined') {
  globalThis.__beasts = Object.assign(globalThis.__beasts || {}, {
    sliderGeometry: buildGeometry, sliderMaterial: makeSliderMaterial, sliderBones: BONES, sliderLegs: LEGS,
    sliderRefreshSky: refreshSky,
  });
}

let rng = null;
const SPEED = { charge: 8, retreat: 6, stalk: 3.2, drop: 9 };
const GRAVITY = 22;

class Slider extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'slider', position, Object.assign({ hp: 60 }, opts));
    this.radius = 0.55; this.height = 0.3; this.speed = SPEED.charge;
    // ---- rig: the characters module's quadruped if it ever lands one denser than this, else our own.
    // The gate is on triangle count rather than the stub flag, because charmesh's placeholder is a capsule
    // and adopting a thinner rig than the one below would be a downgrade, not an upgrade.
    this.rig = null;
    let ext = null;
    try { ext = buildQuadruped({ kind: 'slider' }); } catch (e) { ext = null; }
    if (ext && ext.root && !ext.stub && rigTris(ext.root) >= 3500) { this.rig = ext; this.root.add(ext.root); }
    else if (ext && ext.dispose) ext.dispose();
    if (!this.rig) {
      // The skeleton array is indexed by skinIndex, so its ORDER has to be the order of BONES, not the order
      // the bones happen to get created in. It used to be creation order — body, chest, neck, head, pelvis,
      // then upFL, loFL, upFR, loFR... — against a BONES list that groups all the uppers, then all the
      // lowers. Everything from index 6 on was therefore bound to the wrong bone, which is why the old
      // slider's limbs floated away from its body in every render. Building the array out of BONES itself
      // removes the whole class of bug; enemies/spawn.js avoids it by creating its legs in two passes.
      const B = this.B = {};
      const mk = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); B[name] = b; return b; };
      mk('body', null, 0, TORSO_Y, 0);
      mk('chest', B.body, 0, 0.005, -0.30);
      mk('neck', B.chest, 0, -0.005, -0.300);
      mk('head', B.neck, 0, -0.185, -0.180);
      mk('jaw', B.head, 0, -0.048, -0.026);
      mk('pelvis', B.body, 0, -0.008, 0.34);
      for (const L of LEGS) {
        mk(L.up, B.body, L.hip[0], L.hip[1], L.hip[2]);
        mk(L.lo, B[L.up], 0, -L.L1, 0);
        mk(L.ft, B[L.lo], 0, -L.L2, 0);
      }
      const bones = this.bones = BONES.map((n) => B[n]);
      this.material = makeSliderMaterial();
      this.mu = this.material.userData.u;
      const mesh = this.mesh = new THREE.SkinnedMesh(buildGeometry(0), this.material);
      mesh.castShadow = true; mesh.receiveShadow = false;
      mesh.add(B.body); mesh.bind(new THREE.Skeleton(bones));
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.35, 0), 1.6);
      this.root.add(mesh);
      this.lod = 0; this.lodT = rng.range(0, 0.7);
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
    this.jaw = 0; this.jawWant = 0; this.headRoll = rng.range(0.18, 0.34) * (rng.chance(0.5) ? 1 : -1);
    // ---- AI state ----
    this.clickT = rng.range(1, 3); this.target = null; this.waitT = 0; this.obsT = 0; this.observed = true; this.watchedT = 0;
    this.approachBearing = 0; this.lungeHit = false; this.leapT = 0; this.awayT = 0; this.lostT = 0; this.circleDir = 1;
    // v2: pairs, roofs, the aimed-at break, stun, smoke
    this.pairId = opts.pairId ?? null; this.partner = null; this.role = null; this.struck = false; this.pairT = rng.range(0.3, 1.2); this.engageT = rng.range(0.3, 1.2);
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
    else { this.riseTarget = 1; this.radius = 0.45; this.height = 0.8; }   // the joint arches top out at 0.63
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
    // a striker that has had its go is a slider again: it clicks, it circles
    if (this.role === 'striker' && this.struck) { this.role = null; this.clickT = rng.range(1, 3); }
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
    this.pose(dt, 0, 0, TORSO_Y - 0.26 * fe, 0.25 * fe, 0.35 * fe, 0.9 * fe);
    this.faceU.uFade.value = Math.max(0, 1 - t / 0.3); this.faceU.uTime.value = this.time;
    this.mu.uTime.value = this.time;
    if (t >= 0.55) {
      if (!this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.2, this.position.z), 70); this.mesh.castShadow = false; }
      this.mu.uDissolve.value = clamp01((t - 0.55) / 1.3);
      this.mu.uShiver.value = 1 + (t - 0.55) * 2;
    }
    this.face.visible = t < 0.35;
  }
  onDispose() {
    this.face.material.dispose();
    if (this.rig) this.rig.dispose?.();
    else { this.mesh.skeleton.dispose(); this.material.dispose(); }
    if (this.partner && this.partner.partner === this) this.partner.partner = null;
  }

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
    if (!this.partner) { this.pairT -= dt; if (this.pairT <= 0) { this.pairT = 2; this.findPartner(); } }
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
          this.engageT -= dt;
          if (this.engageT <= 0 || canCharge) this.pairEngage();
        } else if (canCharge) this.startCharge();
        break;
      }
      case 'drop': {
        headYaw = trackYaw; headPitch = trackPitch; stretch = 1;
        this.dropVel.y -= GRAVITY * dt;
        this.position.addScaledVector(this.dropVel, dt);
        w.resolveCapsule(this.position, 0.3, 0.6, 0.2);
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
    const S = 0.34, lift = 0.24;
    const sf = clamp01(this.moveSpeed / 3);
    this.gait = damp(this.gait, sf, 9, dt);
    const g = this.gait;
    const rate = (this.moveSpeed / (4 * S)) * TAU;
    this.phase += rate * dt;
    // deliberately wrong timing: per-leg wander, and every so often one leg runs a double beat
    this.doubleT -= dt;
    if (this.doubleT <= 0 && g > 0.3) { this.doubleT = rng.range(0.8, 2.5); this.legDouble[rng.int(0, 3)] = TAU; }
    // the jaw: shut except on the charge and the lunge, when it comes open and the maw shows
    const st = this.state;
    this.jawWant = st === 'charge' || st === 'lunge' || st === 'drop' ? 1 : st === 'stunned' ? 0.45 : this.mockT > 0 ? 0.35 : 0;
    this.jaw = damp(this.jaw, this.jawWant, st === 'charge' ? 14 : 7, dt);
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
    this.mu.uShiver.value = lerp(0.25, 0.75, rise) + this.flinch * 1.5 + (this.state === 'charge' || this.state === 'drop' ? 0.4 : 0) + (this.state === 'stunned' ? 0.7 : 0);
    this.shade(dt, d, rise);
  }
  // the material's per-frame dials, plus the distance geometry swap. Both LODs are bound to the same
  // skeleton, so the swap is one assignment and no second draw call.
  shade(dt, d, rise) {
    refreshSky(this.ctx);
    const u = this.mu;
    u.uHit.value = this.flinch;
    // the joints leak more when it is hurt and in the beat before it comes at you
    u.uEmber.value = 0.40 + this.flinch * 0.95 + (this.state === 'charge' || this.state === 'lunge' ? 0.35 : 0);
    // the jaw interior is the tell: dark until the jaw drops, then a mouthful of ember
    u.uMaw.value = this.jaw * this.jaw * 1.35;
    if (!this.mesh) return;
    this.lodT -= dt;
    if (this.lodT <= 0) {
      this.lodT = 0.5;
      const l = d > 38 ? 1 : 0;
      if (l !== this.lod) { this.lod = l; this.mesh.geometry = buildGeometry(l); }
    }
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
  // The blot lives IN the socket. It used to be a camera-facing plane parented to the root, sitting proud of
  // the skull and turning to you from any angle, which reads as a lamp stuck on the head. Now it sits at the
  // socket, billboards only within 58 degrees of the skull's own facing, and past that it slides to the
  // socket rim and is occluded by the head — which is far worse to look at than a blot that always faces you.
  placeFace(headWorld, t, rise) {
    const head = this.B && this.B.head;
    if (head) {
      head.updateWorldMatrix(true, false);
      _face.set(0.004, -0.008, -0.088).applyMatrix4(head.matrixWorld);
      _fwd.set(0, 0, -1).applyQuaternion(head.getWorldQuaternion(_fq)).normalize();
    } else { _face.copy(headWorld); _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
    _v2.copy(this.ctx.player.eye).sub(_face); const fl = _v2.length() || 1; _v2.divideScalar(fl);
    const dp = clamp(_v2.dot(_fwd), -1, 1);
    if (dp < COS_FACE) {
      _perp.copy(_v2).addScaledVector(_fwd, -dp);
      const pl = _perp.length();
      if (pl > 1e-4) _perp.divideScalar(pl); else _perp.set(1, 0, 0);
      _v2.copy(_fwd).multiplyScalar(COS_FACE).addScaledVector(_perp, Math.sqrt(Math.max(0, 1 - COS_FACE * COS_FACE)));
    }
    _face.addScaledVector(_v2, 0.016);
    _v3.copy(_face).addScaledVector(_v2, 1);
    this.root.worldToLocal(this.face.position.copy(_face));
    this.face.lookAt(_v3);
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
    // the head hangs under the shoulder line AND is permanently cocked over — one small, countable
    // wrongness on an otherwise correct skeleton, which is what the uncanny-valley work says disturbs
    B.neck.rotation.set(flat + this.headPitch * 0.3, this.headYaw * 0.4, this.headRoll * 0.45 * this.rise);
    B.head.rotation.set(flat * 0.5 + this.headPitch * 0.7 + (gl ? gl[6] * 0.5 : 0), this.headYaw * 0.6 + (gl ? gl[7] * 0.4 : 0), this.headRoll * this.rise + (gl ? gl[5] * 0.2 : 0));
    if (B.jaw) B.jaw.rotation.set(this.jaw * 0.9, 0, 0);
    // legs
    _qi.copy(body.quaternion).invert();
    for (let i = 0; i < 4; i++) {
      const L = LEGS[i], up = B[L.up], lo = B[L.lo];
      _hip.set(L.hip[0], L.hip[1], L.hip[2]).applyMatrix4(body.matrix);
      _foot.copy(this.footPos[i]);
      // THE joints-wrong dial. Flat: the limbs lie splayed out sideways. Up: the fore elbow folds up and
      // back and the hind knee up and forward, both apexing ABOVE the spine, which no mammal can do.
      const r = this.rise;
      _pole.set(lerp(L.poleFlat[0], L.poleUp[0], r), lerp(L.poleFlat[1], L.poleUp[1], r) + fold * 0.5,
        lerp(L.poleFlat[2], L.poleUp[2], r)).normalize();
      this.solveLeg(up, lo, _hip, _foot, _pole, L.L1, L.L2);
      // whatever the joint above it is doing, the hand or foot stays flat on the ground
      const ft = B[L.ft];
      if (ft) {
        _q.copy(body.quaternion).multiply(up.quaternion).multiply(lo.quaternion).invert();
        _fq.setFromAxisAngle(UPV, L.side * 0.12);
        ft.quaternion.copy(_q).multiply(_fq);
      }
    }
  }
  solveLeg(upBone, loBone, hip, foot, pole, L1, L2) {
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
