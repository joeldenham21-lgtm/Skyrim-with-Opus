// Seeker — a mimic three metres tall welded into a powered suit. Slow, heavy, sweeping a searchlight from the
// lamp in its dome. The light finding you is the scare: the screen floods, the hum rises, then the MG. It cannot
// skip; it just keeps coming. Only after Tide level 2, only at Object 12 and the church.
//
// It is the only MANUFACTURED thing in the bestiary, and that is its whole identity. Everything else in the zone
// is cloth and absence; this is olive-drab paint over plate steel, chipped back to bare metal on every rim, weld
// and boss, weeping rust down from the fasteners, with the mimic's own cloth showing in the gaps at the neck,
// armpit, elbow and knee — and a dull ember burning in those gaps, because what is inside the suit is still one
// of them. It is therefore the LIGHTEST-valued creature in the game (plate 0x4a5040, sRGB 0.29, against ground
// 0.45 and sky 0.55) and the one you can see coming.
//
// Geometry is lofted, not boxed. Every mass is a stack of superellipse rings with two-bone skin weights blended
// across each joint, so an elbow bends instead of shearing; every plate has real thickness with a rim you can
// see in outline; every joint reads as [tapered mass] gap (ball) gap [tapered mass], which is the doll-limb
// signature that no toy soldier has. ~16 k triangles at LOD0 over 3.17 m — 5,100 per metre, against the spawn's
// 5,900 — in ONE draw call, with two cheaper regenerations of the same skeleton behind a THREE.LOD.
//
// It drives the shared skinned Rig from mimic.js (bone names and rest positions unchanged, so the poser, the
// two-bone arm IK, the gun bone and the death collapse all still work) but none of its box geometry.
import * as THREE from 'three';
import { Enemy } from './common.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { glowTexture } from '../render/textures.js';
import { Rig, boneIndex, enemyShoot } from './mimic.js';
import { playAny } from './squad.js';
import { roundsInGun, consumeRound } from './loadout.js';
import { SEEKER, AMMO, WEAPONS, MAGAZINES, ITEMS, defaultAmmo, resolveHit, zoneFromHit } from '../data/index.js';
import { makeWeapon, makeMag, makeGear } from '../player/inventory.js';
import { clamp, clamp01, damp, angleDelta, lerp, TAU, DEG } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _axis = new THREE.Vector3();
const _m = new THREE.Matrix4(), _col = new THREE.Color();
const SCALE = 1.65;

// the suit: one class-6 piece over every zone, its own durability; the lens is the hole in it
const SUIT_DEF = { id: 'seeker_suit', name: 'Seeker suit', kind: 'vest', cls: SEEKER.cls || 6, zones: ['head', 'torso', 'stomach', 'arms', 'legs'], durability: 400 };
// the heavy gun and its belt: what it fires is what it drops
function seekerLoadout() {
  const weaponId = (SEEKER.weapons && SEEKER.weapons.find((id) => WEAPONS[id])) || 'pkm';
  const wdef = WEAPONS[weaponId];
  const ammoId = defaultAmmo(wdef.cal);
  const weapon = makeWeapon(weaponId, { condition: 55 + Math.random() * 30, ammo: ammoId });
  if (weapon.mag) weapon.mag.rounds = MAGAZINES[weapon.mag.id].cap;
  const boxes = [];
  if (wdef.defaultMag) for (let i = 0; i < 2; i++) boxes.push(makeMag(wdef.defaultMag, ammoId, MAGAZINES[wdef.defaultMag].cap));
  return { weapon, wdef, ammoId, ammo: AMMO[ammoId], boxes, suit: { durability: SUIT_DEF.durability } };
}

// =====================================================================================================
// SURFACE LANGUAGE
// aSurf = (roughness, metalness, shiverMask, sheen). aWear = (edgeWear, grime, pattern, ember).
// No environment map exists in this renderer, so metalness only subtracts diffuse: everything here stays
// low-metal and carries its metal read in roughness, sheen and the bare-steel reveal instead.
// =====================================================================================================
// There is no environment map in this renderer, so metalness has nothing to reflect and only subtracts
// diffuse: every value here stays near zero and the metal read is carried by roughness and sheen instead.
const SF = {
  paint:  [0.62, 0.03, 0.10, 0.18],
  paintW: [0.70, 0.02, 0.12, 0.10],   // weathered, flatter paint on the big masses
  steel:  [0.40, 0.06, 0.05, 0.36],
  ram:    [0.34, 0.07, 0.03, 0.42],
  rod:    [0.22, 0.09, 0.02, 0.55],
  cloth:  [0.97, 0.00, 1.00, 0.02],
  rubber: [0.88, 0.01, 0.30, 0.08],
  sole:   [0.85, 0.01, 0.18, 0.05],
  glassy: [0.20, 0.04, 0.02, 0.60],
};
const COL = {
  plate:   0x5f6549,   // olive-drab paint. the value ladder: seeker 0.29 > mimic 0.14 > slider 0.10 > spawn 0.08
  plateB:  0x545a40,   // a second olive so overlapping lames separate
  plateC:  0x686e52,
  plateDk: 0x424636,
  shadow:  0x2a2e24,   // under a lame, inside a recess
  steel:   0x848a90,
  bright:  0xaaaeb4,
  ram:     0x4c5055,
  rod:     0xb8bcc0,
  cloth:   0x2d3327,   // the mimic's own jacket, showing through
  clothDk: 0x22271e,
  gap:     0x16120e,   // inside a joint gap, where the ember lives
  rubber:  0x33343a,
  sole:    0x46433c,
  hazard:  0xac6420,   // one chevron block on the right pauldron: the only saturated thing on the model
  hazardW: 0xa39c88,
  gun:     0x4a4e52,
  void:    0x1a1d17,   // the dished panel where a face was removed
  brass:   0x84693a,
};
// wear vectors: [edge, grime, pattern, ember] — pattern 1 rib, 2 cloth weave, 3 tread, 4 louvre, 5 knurl
const WR = {
  paint:  [1.00, 1.00, 0, 0],
  rim:    [1.00, 0.80, 0, 0],
  knurl:  [0.90, 0.90, 5, 0],
  rib:    [0.85, 1.00, 1, 0],
  cloth:  [0.25, 1.00, 2, 0],
  joint:  [0.30, 0.90, 2, 1],
  tread:  [0.50, 1.00, 3, 0],
  louvre: [0.80, 1.00, 4, 0],
  clean:  [0.45, 0.35, 0, 0],
  hot:    [0.30, 0.40, 0, 1],
};

function h3(a, b, c) {
  let n = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177 | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// -----------------------------------------------------------------------------------------------------
// Vertex soup -> one creased, indexed, skinned BufferGeometry. Colour, surface and wear are recorded once
// per tint() as a span rather than per vertex; the weld/crease/index pass is the same one charmesh.js uses.
// -----------------------------------------------------------------------------------------------------
class Soup {
  constructor() {
    this.cap = 8192; this.n = 0;
    this.p = new Float32Array(this.cap * 3);
    this.b = new Float32Array(this.cap * 3);
    this.spans = [];
    this.tint(COL.plate, SF.paint, WR.paint);
  }
  // 12 floats a span: [start, r,g,b, rough, metal, shiver, sheen, edge, grime, pattern, ember]
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
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;
    this.vert(a); this.vert(b); this.vert(c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get tris() { return this.n / 3; }
  finish(scale = 1, creaseCos = 0.55) {
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
    const oS = new Float32Array(N * 4), oWr = new Float32Array(N * 4), oI = new Uint16Array(N * 4), oW = new Float32Array(N * 4);
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
        oP[o3] = p[i * 3] * scale; oP[o3 + 1] = p[i * 3 + 1] * scale; oP[o3 + 2] = p[i * 3 + 2] * scale;
        oN[o3] = nrm[i * 3]; oN[o3 + 1] = nrm[i * 3 + 1]; oN[o3 + 2] = nrm[i * 3 + 2];
        oC[o3] = spans[sp + 1]; oC[o3 + 1] = spans[sp + 2]; oC[o3 + 2] = spans[sp + 3];
        oS[o4] = spans[sp + 4]; oS[o4 + 1] = spans[sp + 5]; oS[o4 + 2] = spans[sp + 6]; oS[o4 + 3] = spans[sp + 7];
        oWr[o4] = spans[sp + 8]; oWr[o4 + 1] = spans[sp + 9]; oWr[o4 + 2] = spans[sp + 10]; oWr[o4 + 3] = spans[sp + 11];
        oI[o4] = bo[i * 3]; oI[o4 + 1] = bo[i * 3 + 1];
        oW[o4] = 1 - bo[i * 3 + 2]; oW[o4 + 1] = bo[i * 3 + 2];
        list.push(hit, i);
      }
      index[i] = hit;
    }
    const phase = new Float32Array(M), jdir = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      const kx = Math.round(oP[i * 3] * 1000) + 7, ky = Math.round(oP[i * 3 + 1] * 1000) + 3, kz = Math.round(oP[i * 3 + 2] * 1000) + 11;
      const a = h3(kx, ky, kz), b = h3(ky, kz, kx), c = h3(kz, kx, ky);
      phase[i] = a;
      const jx = b - 0.5, jy = c - 0.5, jz = a - 0.5, jl = Math.hypot(jx, jy, jz) || 1;
      jdir[i * 3] = jx / jl; jdir[i * 3 + 1] = jy / jl; jdir[i * 3 + 2] = jz / jl;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(oP.subarray(0, M * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(oN.subarray(0, M * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(oC.subarray(0, M * 3), 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(oS.subarray(0, M * 4), 4));
    g.setAttribute('aWear', new THREE.BufferAttribute(oWr.subarray(0, M * 4), 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(oI.subarray(0, M * 4), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(oW.subarray(0, M * 4), 4));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aJit', new THREE.BufferAttribute(jdir, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0 * scale, 0), 2.1 * scale);
    g.userData.shared = true;
    this.p = null; this.b = null; this.spans.length = 0; this.n = 0;
    return g;
  }
}

// -----------------------------------------------------------------------------------------------------
// One primitive does nearly all of it: a closed superellipse ring in an arbitrary plane, lofted along a
// path. `pow` above 2 squares the section off (armour plate, boot, receiver); below 2 rounds it (hose,
// ram, ball joint). Winding is outward when the stack advances along v x u, so a stack going the other
// way passes flip.
// -----------------------------------------------------------------------------------------------------
// ru is the radius along u (angle 0), rv the radius along v (angle 90); ruN/rvN are the far halves. So:
//   up / down   ru = half-DEPTH  (front, ruN back)   rv = half-WIDTH  (right, rvN left)
//   fwd         ru = half-HEIGHT (up,    ruN down)   rv = half-WIDTH  (left,  rvN right)
//   right       ru = half-HEIGHT (up,    ruN down)   rv = half-DEPTH  (front, rvN back)
// Each preset already winds for its own direction, so flip is only for a stack that runs backwards
// along that preset's axis (a heel built toward +z, a left arm built toward -x).
const AX = {
  up:   { u: [0, 0, -1], v: [1, 0, 0] },   // rings in XZ, advances +y
  down: { u: [0, 0, -1], v: [-1, 0, 0] },  // rings in XZ, advances -y
  fwd:  { u: [0, 1, 0], v: [-1, 0, 0] },   // rings in XY, advances -z (forward)
  right:{ u: [0, 1, 0], v: [0, 0, -1] },   // rings in YZ, advances +x
};
function xring(c, u, v, ru, rv, o) {
  const seg = o.seg, pow = o.pow, k = 2 / pow;
  const ruN = o.ruN, rvN = o.rvN, jit = o.jit || 0, seed = o.seed || 1;
  const b0 = o.b0 || 0, b1 = o.b1 === undefined ? b0 : o.b1, w = o.w || 0;
  const out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const su = ca === 0 ? 0 : Math.sign(ca) * Math.pow(Math.abs(ca), k);
    const sv = sa === 0 ? 0 : Math.sign(sa) * Math.pow(Math.abs(sa), k);
    const RU = ca >= 0 ? ru : ruN, RV = sa >= 0 ? rv : rvN;
    const j = jit ? (h3(i * 13 + seed, Math.round(c[1] * 900), Math.round(c[0] * 900) + 5) - 0.5) * jit : 0;
    out.push([c[0] + u[0] * su * (RU + j) + v[0] * sv * (RV + j),
              c[1] + u[1] * su * (RU + j) + v[1] * sv * (RV + j),
              c[2] + u[2] * su * (RU + j) + v[2] * sv * (RV + j), b0, b1, w]);
  }
  return out;
}
function centreOf(ring) {
  let x = 0, y = 0, z = 0;
  for (const q of ring) { x += q[0]; y += q[1]; z += q[2]; }
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
function loftRings(S, rings, o = {}) {
  const flip = o.flip || false;
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) S.quad(A[i], A[j], B[j], B[i]);
      else S.quad(A[i], B[i], B[j], A[j]);
    }
  }
  if (o.capA) capRing(S, rings[0], o.cA || centreOf(rings[0]), flip);
  if (o.capB) capRing(S, rings[rings.length - 1], o.cB || centreOf(rings[rings.length - 1]), !flip);
}
// pts: [{ c:[x,y,z], ru, rv, ruN?, rvN?, pow?, b0?, b1?, w?, jit? }]
function mass(S, pts, o = {}) {
  const ax = o.ax || (o.u ? { u: o.u, v: o.v } : AX.up);
  const seg = o.seg || 12, pow = o.pow ?? 2.4;
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    rings.push(xring(p.c, o.u || ax.u, o.v || ax.v, p.ru, p.rv === undefined ? p.ru : p.rv, {
      seg, pow: p.pow ?? pow,
      ruN: p.ruN ?? p.ru, rvN: p.rvN ?? (p.rv === undefined ? p.ru : p.rv),
      b0: p.b0 ?? o.b0, b1: p.b1 ?? o.b1, w: p.w ?? o.w,
      jit: p.jit ?? o.jit, seed: (o.seed || 1) + i * 7,
    }));
  }
  loftRings(S, rings, { flip: !!o.flip, capA: o.capA !== false, capB: o.capB !== false });
  return rings;
}
// A raised band around a body: inner rim on the surface, out to rOut, back in. Reads as a weld or a strap.
function band(S, y0, y1, rIn, rOut, o = {}) {
  const b = o.bev ?? (y1 - y0) * 0.30;
  const zf = o.zf ?? 1, cz = o.cz || 0, cx = o.cx || 0;
  mass(S, [
    { c: [cx, y0, cz], ru: rIn * zf, rv: rIn },
    { c: [cx, y0 + b, cz], ru: rOut * zf, rv: rOut },
    { c: [cx, y1 - b, cz], ru: rOut * zf, rv: rOut },
    { c: [cx, y1, cz], ru: rIn * zf, rv: rIn },
  ], Object.assign({ seg: o.seg || 14, pow: o.pow ?? 3.0, capA: false, capB: false }, o));
}
// A bolt boss / rivet head: a tiny knurled drum standing off a surface along its own normal. dir is 'x',
// 'y', 'z' or any vector; the ring frame is built so the winding stays outward whichever way it points.
function boss(S, c, dir, r, h, o = {}) {
  let n = typeof dir === 'string' ? (dir === 'y' ? [0, 1, 0] : dir === 'z' ? [0, 0, -1] : [1, 0, 0]) : dir;
  const L = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / L, n[1] / L, n[2] / L];
  const t = Math.abs(n[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
  let u = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];   // v x u = n
  const at = (k, rr) => ({ c: [c[0] + n[0] * k, c[1] + n[1] * k, c[2] + n[2] * k], ru: rr, rv: rr });
  mass(S, [at(0, r * 0.9), at(h * 0.5, r), at(h, r * 0.78)], Object.assign({ u, v, seg: o.seg || 6, pow: 2.6 }, o));
}
// A flexible run — hose, cable, ammo belt — swept along a poly-line with a sag.
function hose(S, a, b, r, o = {}) {
  const n = o.n || 7, sag = o.sag ?? 0.05, bow = o.bow || [0, 0, 0];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = Math.sin(t * Math.PI);
    pts.push({
      c: [lerp(a[0], b[0], t) + bow[0] * s, lerp(a[1], b[1], t) - sag * s + bow[1] * s, lerp(a[2], b[2], t) + bow[2] * s],
      ru: r * (0.8 + 0.25 * Math.sin(t * Math.PI)), rv: r * (0.8 + 0.25 * Math.sin(t * Math.PI)),
    });
  }
  // sweep along the dominant axis of the run so the winding stays outward
  const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), dz = Math.abs(b[2] - a[2]);
  let ax = AX.up, flip = false;
  if (dx >= dy && dx >= dz) { ax = AX.right; flip = b[0] < a[0]; }
  else if (dz >= dy) { ax = AX.fwd; flip = b[2] > a[2]; }
  else { ax = AX.up; flip = b[1] < a[1]; }
  mass(S, pts, Object.assign({ ax, seg: o.seg || 6, pow: 2.0, flip }, o));
}

// =====================================================================================================
// The suit. Unit space: ground y = 0, crown 1.92, x right, -z forward — the same space mimic.js's Rig
// authors its bones in, so nothing about the skeleton has to move. finish() multiplies by SCALE.
// =====================================================================================================
const B = {};
for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'foL', 'foR', 'thL', 'thR', 'snL', 'snR', 'gun']) B[n] = boneIndex(n);
const SH_X = 0.21, SH_Y = 1.54, EL_Y = 1.24, WR_Y = 0.97;
const TH_X = 0.11, TH_Y = 0.92, KN_Y = 0.47, AN_Y = 0.115;

// A control polyline resampled into n rings. Every mass in the suit is authored as four or five control
// sections and then spun up to whatever ring count the detail level asks for, which is what makes LOD a
// number rather than a decimator. Bones are declared once per mass so only the weight interpolates.
function resample(ctrl, n) {
  const out = [];
  const last = ctrl.length - 1;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const f = t * last, a = Math.min(last - 1, Math.floor(f)), u = f - a;
    const A = ctrl[a], B = ctrl[a + 1];
    const ar = A.rv === undefined ? A.ru : A.rv, br = B.rv === undefined ? B.ru : B.rv;
    out.push({
      c: [lerp(A.c[0], B.c[0], u), lerp(A.c[1], B.c[1], u), lerp(A.c[2], B.c[2], u)],
      ru: lerp(A.ru, B.ru, u), rv: lerp(ar, br, u),
      ruN: lerp(A.ruN === undefined ? A.ru : A.ruN, B.ruN === undefined ? B.ru : B.ruN, u),
      rvN: lerp(A.rvN === undefined ? ar : A.rvN, B.rvN === undefined ? br : B.rvN, u),
      pow: lerp(A.pow === undefined ? 2.4 : A.pow, B.pow === undefined ? 2.4 : B.pow, u),
      w: lerp(A.w || 0, B.w || 0, u),
    });
  }
  return out;
}

// One arm. side -1 left, +1 right. Bone chain chest -> sh -> fo; every mass declares one bone PAIR so the
// blend across a joint is continuous instead of switching bones halfway along a limb.
function buildArm(S, D, side) {
  const sg = (n) => Math.max(D < 0.4 ? 4 : 5, Math.round(n * D));
  const rg = (n) => Math.max(2, Math.round(n * D));
  const fine = D > 0.42;
  const bs = side < 0 ? B.shL : B.shR, bf = side < 0 ? B.foL : B.foR;
  const X = (SH_X + 0.052) * side;   // outboard of the bone: at the bone the limb is buried in the chest
  const AB = { b0: B.chest, b1: bs }, LB = { b0: bs, b1: bf }, FB = { b0: bf, b1: bf };

  // --- pauldron: three overlapping lames over the shoulder, each with a bare-steel lip along its edge.
  // Weighted mostly to the chest so they hang off the yoke and only follow the arm a third of the way.
  // This is the mass that makes a three-metre thing read as three metres.
  for (let l = 0; l < 3; l++) {
    S.tint(l === 1 ? COL.plateB : COL.plate, SF.paint, WR.paint);
    const y = SH_Y + 0.100 - l * 0.092, w0 = 0.10 + l * 0.07, w1 = 0.26 + l * 0.12;
    const H = (h) => h * (1 - 0.14 * l);
    mass(S, resample([
      { c: [X - side * 0.030, y + 0.006, -0.008], ru: H(0.076), rv: 0.140, pow: 3.8, w: w0 },
      { c: [X + side * 0.060, y + 0.002, -0.016], ru: H(0.086), rv: 0.158, pow: 4.0, w: lerp(w0, w1, 0.35) },
      { c: [X + side * 0.140, y - 0.030, -0.028], ru: H(0.074), rv: 0.152, pow: 4.0, w: lerp(w0, w1, 0.72) },
      { c: [X + side * 0.200, y - 0.072, -0.038], ru: H(0.050), rv: 0.126, pow: 4.2, w: w1 },
    ], rg(7)), Object.assign({ ax: AX.right, seg: sg(14), flip: side < 0 }, AB));
    S.tint(COL.steel, SF.steel, WR.rim);
    mass(S, resample([
      { c: [X + side * 0.182, y - 0.058, -0.036], ru: H(0.048), rv: 0.130, pow: 3.6, w: w1 },
      { c: [X + side * 0.212, y - 0.074, -0.042], ru: H(0.030), rv: 0.112, pow: 3.6, w: w1 },
      { c: [X + side * 0.226, y - 0.086, -0.046], ru: H(0.014), rv: 0.086, pow: 3.6, w: w1 },
    ], rg(3)), Object.assign({ ax: AX.right, seg: sg(12), flip: side < 0 }, AB));
    if (fine) for (const dz of [-0.10, 0.02]) boss(S, [X + side * 0.115, y + 0.070 - l * 0.004, dz], [side * 0.3, 1, -0.2], 0.017, 0.022, Object.assign({ seg: sg(7) }, AB, { w: lerp(w0, w1, 0.6) }));
  }
  // hazard block on the right pauldron only: the one saturated mark on the whole creature
  if (side > 0 && fine) {
    S.tint(COL.hazard, SF.paintW, [0.9, 1.0, 0, 0]);
    mass(S, resample([
      { c: [X + 0.048, SH_Y + 0.098, -0.030], ru: 0.026, rv: 0.090, pow: 3.4, w: 0.16 },
      { c: [X + 0.128, SH_Y + 0.088, -0.042], ru: 0.022, rv: 0.082, pow: 3.4, w: 0.20 },
    ], rg(3)), Object.assign({ ax: AX.right, seg: sg(10) }, AB));
    S.tint(COL.hazardW, SF.paintW, [0.9, 1.0, 0, 0]);
    mass(S, resample([
      { c: [X + 0.132, SH_Y + 0.087, -0.042], ru: 0.021, rv: 0.080, pow: 3.4, w: 0.20 },
      { c: [X + 0.196, SH_Y + 0.074, -0.052], ru: 0.017, rv: 0.068, pow: 3.4, w: 0.24 },
    ], rg(3)), Object.assign({ ax: AX.right, seg: sg(10) }, AB));
  }
  // deltoid cap: the piece that belongs to the torso, under the lames
  S.tint(COL.plateDk, SF.paint, WR.paint);
  mass(S, resample([
    { c: [X, SH_Y + 0.052, -0.006], ru: 0.086, rv: 0.082, pow: 2.8, w: 0.45 },
    { c: [X, SH_Y - 0.030, -0.008], ru: 0.108, rv: 0.100, pow: 2.9, w: 0.80 },
    { c: [X, SH_Y - 0.120, -0.008], ru: 0.096, rv: 0.090, pow: 3.0, w: 1.0 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(14), capA: false }, AB));

  // --- upper arm: cloth core, then the rerebrace over it, swelling at the deltoid and pinching above
  // the elbow. Every silhouette line reverses at least once between two joints.
  S.tint(COL.cloth, SF.cloth, WR.cloth);
  mass(S, resample([
    { c: [X, SH_Y - 0.05, 0], ru: 0.074, rv: 0.072, w: 0 },
    { c: [X, EL_Y + 0.075, 0], ru: 0.058, rv: 0.056, w: 0.10 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(12), pow: 2.2, capA: false }, LB));
  S.tint(COL.plate, SF.paint, WR.paint);
  mass(S, resample([
    { c: [X, SH_Y - 0.100, -0.006], ru: 0.100, rv: 0.094, pow: 2.9, w: 0 },
    { c: [X, SH_Y - 0.190, -0.006], ru: 0.092, rv: 0.086, pow: 3.0, w: 0.02 },
    { c: [X, EL_Y + 0.155, -0.006], ru: 0.083, rv: 0.078, pow: 3.0, w: 0.05 },
    { c: [X, EL_Y + 0.100, -0.004], ru: 0.074, rv: 0.070, pow: 3.1, w: 0.08 },
  ], rg(6)), Object.assign({ ax: AX.down, seg: sg(14), capA: false }, LB));
  S.tint(COL.steel, SF.steel, WR.rim);
  band(S, EL_Y + 0.086, EL_Y + 0.114, 0.072, 0.090, Object.assign({ seg: sg(14), cx: X, pow: 3.0 }, LB, { w: 0.10 }));

  // --- elbow: the doll joint. Cap in, gap, ball split 50/50 across the two bones, gap, cap in. In outline
  // the limb pinches twice, which no human limb does and every ball-jointed doll does.
  S.tint(COL.gap, SF.cloth, WR.joint);
  mass(S, [
    { c: [X, EL_Y + 0.082, 0], ru: 0.054, rv: 0.052, w: 0.15 },
    { c: [X, EL_Y + 0.055, 0], ru: 0.049, rv: 0.047, w: 0.35 },
  ], Object.assign({ ax: AX.down, seg: sg(12), pow: 2.0, capA: false, capB: false }, LB));
  S.tint(COL.ram, SF.ram, WR.knurl);
  mass(S, resample([
    { c: [X, EL_Y + 0.058, 0], ru: 0.048, rv: 0.046, pow: 2.0, w: 0.5 },
    { c: [X, EL_Y + 0.020, 0], ru: 0.081, rv: 0.077, pow: 2.0, w: 0.5 },
    { c: [X, EL_Y - 0.014, 0], ru: 0.078, rv: 0.074, pow: 2.0, w: 0.5 },
    { c: [X, EL_Y - 0.036, 0], ru: 0.060, rv: 0.058, pow: 2.0, w: 0.5 },
  ], rg(6)), Object.assign({ ax: AX.down, seg: sg(14), capA: false, capB: false }, LB));
  S.tint(COL.gap, SF.cloth, WR.joint);
  mass(S, [
    { c: [X, EL_Y - 0.038, 0], ru: 0.049, rv: 0.047, w: 0.66 },
    { c: [X, EL_Y - 0.064, 0], ru: 0.053, rv: 0.051, w: 0.85 },
  ], Object.assign({ ax: AX.down, seg: sg(12), pow: 2.0, capA: false, capB: false }, LB));
  // couter: a domed cop over the front of the elbow with a flared lip
  S.tint(COL.plateB, SF.paint, WR.paint);
  mass(S, resample([
    { c: [X, EL_Y + 0.056, -0.044], ru: 0.030, rv: 0.058, pow: 2.6, w: 0.5 },
    { c: [X, EL_Y + 0.016, -0.072], ru: 0.042, rv: 0.076, pow: 2.6, w: 0.5 },
    { c: [X, EL_Y - 0.016, -0.082], ru: 0.048, rv: 0.082, pow: 2.6, w: 0.5 },
    { c: [X, EL_Y - 0.052, -0.062], ru: 0.036, rv: 0.068, pow: 2.6, w: 0.5 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(14) }, LB));

  // --- forearm: vambrace over cloth, swelling below the elbow and pinching at the wrist
  S.tint(COL.cloth, SF.cloth, WR.cloth);
  mass(S, resample([
    { c: [X, EL_Y - 0.055, 0], ru: 0.054, rv: 0.052, w: 1 },
    { c: [X, WR_Y + 0.060, 0], ru: 0.045, rv: 0.043, w: 1 },
  ], rg(3)), Object.assign({ ax: AX.down, seg: sg(12), pow: 2.2, capA: false, capB: false }, LB));
  S.tint(COL.plate, SF.paint, WR.paint);
  mass(S, resample([
    { c: [X, EL_Y - 0.062, -0.004], ru: 0.070, rv: 0.066, pow: 3.0, w: 0.86 },
    { c: [X, EL_Y - 0.130, -0.004], ru: 0.084, rv: 0.078, pow: 3.0, w: 1 },
    { c: [X, WR_Y + 0.090, -0.002], ru: 0.070, rv: 0.066, pow: 3.1, w: 1 },
    { c: [X, WR_Y + 0.020, -0.002], ru: 0.057, rv: 0.054, pow: 3.2, w: 1 },
  ], rg(6)), Object.assign({ ax: AX.down, seg: sg(14), capA: false, capB: false }, LB));
  S.tint(COL.steel, SF.steel, WR.rim);
  band(S, WR_Y + 0.016, WR_Y + 0.046, 0.055, 0.072, Object.assign({ seg: sg(14), cx: X, pow: 3.0 }, FB));

  // --- gauntlet: a fist with a thumb and three fused finger masses over a knuckle plate. Never a mitten.
  S.tint(COL.plateDk, SF.paint, WR.paint);
  mass(S, resample([
    { c: [X, WR_Y + 0.018, -0.004], ru: 0.055, rv: 0.052, pow: 3.0 },
    { c: [X, WR_Y - 0.018, -0.010], ru: 0.064, rv: 0.060, pow: 3.0 },
    { c: [X, WR_Y - 0.056, -0.016], ru: 0.062, rv: 0.056, pow: 3.0 },
    { c: [X, WR_Y - 0.086, -0.014], ru: 0.052, rv: 0.046, pow: 3.1 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(12) }, FB));
  S.tint(COL.steel, SF.steel, WR.knurl);
  mass(S, resample([
    { c: [X - side * 0.044, WR_Y - 0.022, -0.040], ru: 0.030, rv: 0.026, pow: 2.8 },
    { c: [X, WR_Y - 0.030, -0.046], ru: 0.034, rv: 0.030, pow: 2.8 },
    { c: [X + side * 0.044, WR_Y - 0.026, -0.040], ru: 0.028, rv: 0.024, pow: 2.8 },
  ], rg(4)), Object.assign({ ax: AX.right, seg: sg(10), flip: side < 0 }, FB));
  for (let f = 0; f < 3; f++) {
    const zz = -0.052 - f * 0.036, dy = -0.030 - f * 0.010;
    mass(S, resample([
      { c: [X - side * 0.034, WR_Y + dy, zz], ru: 0.024 - f * 0.003, rv: 0.022, pow: 2.4 },
      { c: [X, WR_Y + dy - 0.004, zz], ru: 0.026 - f * 0.003, rv: 0.024, pow: 2.4 },
      { c: [X + side * 0.034, WR_Y + dy - 0.006, zz], ru: 0.022 - f * 0.003, rv: 0.020, pow: 2.4 },
    ], rg(3)), Object.assign({ ax: AX.right, seg: sg(9), flip: side < 0 }, FB));
  }
  mass(S, resample([    // thumb, across the grip
    { c: [X - side * 0.056, WR_Y - 0.006, -0.016], ru: 0.024, rv: 0.022, pow: 2.2 },
    { c: [X - side * 0.048, WR_Y - 0.026, -0.040], ru: 0.021, rv: 0.019, pow: 2.2 },
    { c: [X - side * 0.036, WR_Y - 0.046, -0.062], ru: 0.017, rv: 0.015, pow: 2.2 },
  ], rg(3)), Object.assign({ ax: AX.fwd, seg: sg(8) }, FB));

  // --- hydraulics: a ram across the elbow and one across the shoulder, plus a hose down the outside
  S.tint(COL.ram, SF.ram, WR.knurl);
  mass(S, resample([
    { c: [X + side * 0.088, SH_Y - 0.100, 0.044], ru: 0.030, rv: 0.030, pow: 2.2, w: 0.1 },
    { c: [X + side * 0.086, SH_Y - 0.180, 0.048], ru: 0.026, rv: 0.026, pow: 2.2, w: 0.05 },
    { c: [X + side * 0.084, EL_Y + 0.100, 0.050], ru: 0.024, rv: 0.024, pow: 2.2, w: 0 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(10) }, LB));
  S.tint(COL.rod, SF.rod, WR.clean);
  mass(S, resample([
    { c: [X + side * 0.084, EL_Y + 0.105, 0.050], ru: 0.013, rv: 0.013, pow: 2.0, w: 0.5 },
    { c: [X + side * 0.078, EL_Y - 0.030, 0.052], ru: 0.012, rv: 0.012, pow: 2.0, w: 0.9 },
  ], rg(3)), Object.assign({ ax: AX.down, seg: sg(8) }, LB));
  if (fine) {
    S.tint(COL.ram, SF.ram, WR.knurl);   // shoulder ram, up onto the pauldron
    mass(S, resample([
      { c: [X + side * 0.020, SH_Y + 0.060, 0.078], ru: 0.026, rv: 0.026, pow: 2.2, w: 0.2 },
      { c: [X + side * 0.070, SH_Y - 0.050, 0.070], ru: 0.022, rv: 0.022, pow: 2.2, w: 0.6 },
    ], rg(3)), Object.assign({ ax: AX.down, seg: sg(9) }, AB));
    S.tint(COL.rubber, SF.rubber, WR.rib);
    hose(S, [X + side * 0.104, SH_Y + 0.02, 0.058], [X + side * 0.058, EL_Y - 0.10, 0.058], 0.017,
      Object.assign({ seg: sg(8), n: rg(8), sag: 0.03, bow: [side * 0.03, 0, 0.024] }, LB, { w: 0.5 }));
  }
}

// One leg. Bone chain hips -> th -> sn. Stance is wide and toed out; the ankle sits outboard of the hip.
function buildLeg(S, D, side) {
  const sg = (n) => Math.max(D < 0.4 ? 4 : 5, Math.round(n * D));
  const rg = (n) => Math.max(2, Math.round(n * D));
  const fine = D > 0.42;
  const bt = side < 0 ? B.thL : B.thR, bn = side < 0 ? B.snL : B.snR;
  const X = TH_X * side;
  const XK = (TH_X + 0.030) * side;     // knee outboard of the hip
  const XA = (TH_X + 0.050) * side;     // ankle outboard again: a wide, planted stance
  const toe = side > 0 ? 0.17 : -0.11;  // one foot turned out further than the other
  const TB = { b0: B.hips, b1: bt }, KB = { b0: bt, b1: bn }, NB = { b0: bn, b1: bn };

  // --- thigh: cloth core, cuisse over the front, and a real counter-curve — out below the hip, in at
  // the knee. Five per cent does not read in outline; sixteen does.
  S.tint(COL.cloth, SF.cloth, WR.cloth);
  mass(S, resample([
    { c: [X, TH_Y + 0.03, 0], ru: 0.106, rv: 0.103, w: 0.5 },
    { c: [lerp(X, XK, 0.5), TH_Y - 0.22, 0], ru: 0.096, rv: 0.093, w: 1 },
    { c: [XK, KN_Y + 0.085, 0], ru: 0.080, rv: 0.078, w: 1 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(12), pow: 2.2, capA: false }, TB));
  S.tint(COL.plate, SF.paintW, WR.paint);
  mass(S, resample([
    { c: [X, TH_Y + 0.050, -0.006], ru: 0.126, rv: 0.120, pow: 2.9, w: 0.45 },
    { c: [lerp(X, XK, 0.22), TH_Y - 0.075, -0.008], ru: 0.148, rv: 0.138, pow: 2.9, w: 0.92 },
    { c: [lerp(X, XK, 0.62), TH_Y - 0.260, -0.008], ru: 0.122, rv: 0.114, pow: 3.0, w: 1 },
    { c: [XK, KN_Y + 0.115, -0.006], ru: 0.099, rv: 0.095, pow: 3.1, w: 1 },
  ], rg(7)), Object.assign({ ax: AX.down, seg: sg(16), capA: false }, TB));
  S.tint(COL.plateB, SF.paint, WR.paint);   // cuisse: an overlapping plate down the front of the thigh
  mass(S, resample([
    { c: [X, TH_Y - 0.010, -0.100], ru: 0.036, rv: 0.110, pow: 3.2, w: 0.55 },
    { c: [lerp(X, XK, 0.30), TH_Y - 0.130, -0.122], ru: 0.044, rv: 0.120, pow: 3.2, w: 1 },
    { c: [lerp(X, XK, 0.62), TH_Y - 0.270, -0.116], ru: 0.040, rv: 0.110, pow: 3.2, w: 1 },
    { c: [XK, KN_Y + 0.135, -0.098], ru: 0.032, rv: 0.092, pow: 3.2, w: 1 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(14) }, TB));
  S.tint(COL.steel, SF.steel, WR.rim);
  band(S, TH_Y - 0.104, TH_Y - 0.060, 0.140, 0.158, Object.assign({ seg: sg(16), cx: lerp(X, XK, 0.15), pow: 3.0 }, TB, { w: 0.95 }));
  if (fine) for (const a of [0.6, 2.5, 3.9]) boss(S, [X + Math.sin(a) * 0.126, TH_Y - 0.190, -Math.cos(a) * 0.112], [Math.sin(a), 0, -Math.cos(a)], 0.018, 0.024, Object.assign({ seg: sg(7) }, TB, { w: 1 }));

  // --- knee: gap, ball across both bones, gap, then a flared poleyn over it
  S.tint(COL.gap, SF.cloth, WR.joint);
  mass(S, [
    { c: [XK, KN_Y + 0.098, 0], ru: 0.075, rv: 0.073, w: 0.15 },
    { c: [XK, KN_Y + 0.068, 0], ru: 0.069, rv: 0.067, w: 0.35 },
  ], Object.assign({ ax: AX.down, seg: sg(12), pow: 2.0, capA: false, capB: false }, KB));
  S.tint(COL.ram, SF.ram, WR.knurl);
  mass(S, resample([
    { c: [XK, KN_Y + 0.070, 0], ru: 0.068, rv: 0.066, pow: 2.0, w: 0.5 },
    { c: [XK, KN_Y + 0.022, 0], ru: 0.106, rv: 0.102, pow: 2.0, w: 0.5 },
    { c: [XK, KN_Y - 0.018, 0], ru: 0.103, rv: 0.099, pow: 2.0, w: 0.5 },
    { c: [XK, KN_Y - 0.050, 0], ru: 0.079, rv: 0.077, pow: 2.0, w: 0.5 },
  ], rg(6)), Object.assign({ ax: AX.down, seg: sg(14), capA: false, capB: false }, KB));
  S.tint(COL.gap, SF.cloth, WR.joint);
  mass(S, [
    { c: [XK, KN_Y - 0.052, 0], ru: 0.069, rv: 0.067, w: 0.68 },
    { c: [XK, KN_Y - 0.082, 0], ru: 0.075, rv: 0.073, w: 0.9 },
  ], Object.assign({ ax: AX.down, seg: sg(12), pow: 2.0, capA: false, capB: false }, KB));
  S.tint(COL.plateC, SF.paint, WR.paint);
  mass(S, resample([
    { c: [XK, KN_Y + 0.076, -0.062], ru: 0.036, rv: 0.078, pow: 2.6, w: 0.5 },
    { c: [XK, KN_Y + 0.024, -0.100], ru: 0.050, rv: 0.100, pow: 2.6, w: 0.5 },
    { c: [XK, KN_Y - 0.020, -0.114], ru: 0.056, rv: 0.108, pow: 2.6, w: 0.5 },
    { c: [XK, KN_Y - 0.068, -0.088], ru: 0.042, rv: 0.092, pow: 2.6, w: 0.5 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(14) }, KB));

  // --- shin: greave over cloth, calf swelling 16 % and pinching hard at the ankle
  S.tint(COL.cloth, SF.cloth, WR.cloth);
  mass(S, resample([
    { c: [XK, KN_Y - 0.075, 0], ru: 0.077, rv: 0.075, w: 1 },
    { c: [XA, AN_Y + 0.10, 0], ru: 0.058, rv: 0.056, w: 1 },
  ], rg(3)), Object.assign({ ax: AX.down, seg: sg(12), pow: 2.2, capA: false, capB: false }, KB));
  S.tint(COL.plate, SF.paintW, WR.paint);
  mass(S, resample([
    { c: [XK, KN_Y - 0.088, -0.004], ru: 0.096, rv: 0.092, pow: 3.0, w: 0.85 },
    { c: [lerp(XK, XA, 0.28), KN_Y - 0.190, -0.006], ru: 0.114, rv: 0.107, pow: 3.0, w: 1 },
    { c: [lerp(XK, XA, 0.70), AN_Y + 0.165, -0.004], ru: 0.084, rv: 0.080, pow: 3.1, w: 1 },
    { c: [XA, AN_Y + 0.085, -0.002], ru: 0.067, rv: 0.063, pow: 3.2, w: 1 },
  ], rg(7)), Object.assign({ ax: AX.down, seg: sg(14), capA: false, capB: false }, KB));
  S.tint(COL.plateB, SF.paint, WR.paint);   // greave down the front of the shin
  mass(S, resample([
    { c: [XK, KN_Y - 0.115, -0.078], ru: 0.032, rv: 0.088, pow: 3.2, w: 1 },
    { c: [lerp(XK, XA, 0.5), KN_Y - 0.255, -0.090], ru: 0.036, rv: 0.086, pow: 3.2, w: 1 },
    { c: [XA, AN_Y + 0.115, -0.066], ru: 0.026, rv: 0.066, pow: 3.2, w: 1 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(14) }, KB));
  S.tint(COL.steel, SF.steel, WR.rim);
  band(S, KN_Y - 0.136, KN_Y - 0.100, 0.092, 0.110, Object.assign({ seg: sg(14), cx: XK, pow: 3.0 }, NB));
  // ankle bellows: ribbed, the last soft thing before the ground
  S.tint(COL.rubber, SF.rubber, WR.rib);
  const bell = [];
  const nb = Math.max(3, Math.round(8 * D));
  for (let i = 0; i <= nb; i++) {
    const t = i / nb, r = 0.056 + (i % 2 ? 0.015 : 0);
    bell.push({ c: [XA, AN_Y + 0.100 - t * 0.066, 0], ru: r, rv: r * 0.95, pow: 2.2 });
  }
  mass(S, bell, Object.assign({ ax: AX.down, seg: sg(12), capA: false, capB: false }, NB));

  // --- boot: a real foot with a heel break, a toe and a proud sole welt, turned out
  const fx = XA + side * 0.012, ty = AN_Y - 0.005;
  const ct = Math.cos(toe), st = Math.sin(toe) * side;
  const P = (dz, dx) => [fx + dx * ct - dz * st, 0, dz * ct + dx * st];
  S.tint(COL.plateDk, SF.paint, WR.paint);
  const foot = [[0.115, 0.070, 0.070, 0.052], [0.040, 0.092, 0.098, 0.070], [-0.070, 0.098, 0.092, 0.072],
                [-0.180, 0.088, 0.068, 0.062], [-0.258, 0.062, 0.038, 0.044]];
  mass(S, resample(foot.map(([dz, rx, ryT, ryB]) => {
    const p = P(dz, 0);
    return { c: [p[0], ty + 0.052, p[2]], ru: ryT, rv: rx, ruN: ryB, rvN: rx, pow: 2.8 };
  }), rg(7)), Object.assign({ ax: AX.fwd, seg: sg(14) }, NB));
  // sole: a slab standing proud of the upper all the way round, with tread
  S.tint(COL.sole, SF.sole, WR.tread);
  mass(S, resample([[0.128, 0.076], [0.030, 0.104], [-0.090, 0.108], [-0.200, 0.094], [-0.270, 0.060]].map(([dz, rx]) => {
    const p = P(dz, 0);
    return { c: [p[0], ty + 0.012, p[2]], ru: 0.024, rv: rx, pow: 3.6 };
  }), rg(7)), Object.assign({ ax: AX.fwd, seg: sg(14) }, NB));
  // toe cap and heel counter in bare steel: the two places a boot actually wears through
  S.tint(COL.steel, SF.steel, WR.rim);
  mass(S, resample([[-0.160, 0.064, 0.090], [-0.220, 0.056, 0.078], [-0.266, 0.036, 0.058]].map(([dz, ry, rx]) => {
    const p = P(dz, 0);
    return { c: [p[0], ty + 0.056, p[2]], ru: ry, rv: rx, pow: 3.0 };
  }), rg(4)), Object.assign({ ax: AX.fwd, seg: sg(12) }, NB));
  mass(S, resample([[0.050, 0.080, 0.088], [0.100, 0.072, 0.076], [0.130, 0.056, 0.058]].map(([dz, ry, rx]) => {
    const p = P(dz, 0);
    return { c: [p[0], ty + 0.058, p[2]], ru: ry, rv: rx, pow: 3.0 };
  }), rg(4)), Object.assign({ ax: AX.fwd, seg: sg(12), flip: true }, NB));
  // ankle collar plate over the bellows
  S.tint(COL.plateC, SF.paint, WR.paint);
  mass(S, resample([
    { c: [XA, AN_Y + 0.108, -0.026], ru: 0.030, rv: 0.078, pow: 3.0 },
    { c: [XA, AN_Y + 0.058, -0.040], ru: 0.036, rv: 0.086, pow: 3.0 },
    { c: [XA, AN_Y + 0.020, -0.032], ru: 0.028, rv: 0.078, pow: 3.0 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(12) }, NB));

  // --- hydraulics down the outside of the leg
  S.tint(COL.ram, SF.ram, WR.knurl);
  mass(S, resample([
    { c: [X + side * 0.140, TH_Y - 0.030, 0.058], ru: 0.032, rv: 0.032, pow: 2.2, w: 0.6 },
    { c: [X + side * 0.132, TH_Y - 0.230, 0.062], ru: 0.028, rv: 0.028, pow: 2.2, w: 1 },
    { c: [XK + side * 0.118, KN_Y + 0.100, 0.064], ru: 0.026, rv: 0.026, pow: 2.2, w: 1 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(10) }, TB));
  S.tint(COL.rod, SF.rod, WR.clean);
  mass(S, resample([
    { c: [XK + side * 0.118, KN_Y + 0.105, 0.064], ru: 0.015, rv: 0.015, pow: 2.0, w: 0.5 },
    { c: [XA + side * 0.098, KN_Y - 0.100, 0.060], ru: 0.014, rv: 0.014, pow: 2.0, w: 0.95 },
  ], rg(3)), Object.assign({ ax: AX.down, seg: sg(8) }, KB));
  if (fine) {
    S.tint(COL.rubber, SF.rubber, WR.rib);
    hose(S, [X + side * 0.104, TH_Y + 0.05, 0.088], [XA + side * 0.062, AN_Y + 0.16, 0.072], 0.018,
      Object.assign({ seg: sg(8), n: rg(9), sag: 0.02, bow: [side * 0.048, 0, 0.024] }, KB, { w: 0.6 }));
  }
}

// The torso, the pelvis, the yoke and the pack.
function buildTorso(S, D) {
  const sg = (n) => Math.max(D < 0.4 ? 4 : 5, Math.round(n * D));
  const rg = (n) => Math.max(2, Math.round(n * D));
  const fine = D > 0.42;

  // --- soft core: the mimic inside the suit. Never seen whole, but it closes every gap.
  S.tint(COL.clothDk, SF.cloth, WR.cloth);
  mass(S, resample([
    { c: [0, 0.84, 0], ru: 0.140, rv: 0.172, w: 0 },
    { c: [0, 1.10, 0], ru: 0.126, rv: 0.158, w: 0.9 },
  ], rg(4)), { ax: AX.up, seg: sg(12), pow: 2.4, b0: B.hips, b1: B.spine });
  mass(S, resample([
    { c: [0, 1.08, 0], ru: 0.128, rv: 0.160, w: 0 },
    { c: [0, 1.34, 0], ru: 0.146, rv: 0.180, w: 0.7 },
    { c: [0, 1.60, 0], ru: 0.130, rv: 0.158, w: 1 },
  ], rg(5)), { ax: AX.up, seg: sg(12), pow: 2.4, b0: B.spine, b1: B.chest });

  // --- pelvis shell and belt
  S.tint(COL.plate, SF.paintW, WR.paint);
  mass(S, resample([
    { c: [0, 0.79, 0], ru: 0.146, ruN: 0.148, rv: 0.176, pow: 3.0, w: 0 },
    { c: [0, 0.90, 0], ru: 0.168, ruN: 0.164, rv: 0.208, pow: 3.0, w: 0.08 },
    { c: [0, 1.00, 0], ru: 0.160, ruN: 0.156, rv: 0.198, pow: 3.0, w: 0.30 },
    { c: [0, 1.07, 0], ru: 0.142, ruN: 0.140, rv: 0.176, pow: 3.0, w: 0.55 },
  ], rg(6)), { ax: AX.up, seg: sg(18), capA: false, capB: false, b0: B.hips, b1: B.spine });
  S.tint(COL.steel, SF.steel, WR.knurl);
  band(S, 0.950, 1.008, 0.198, 0.226, { seg: sg(18), pow: 3.0, zf: 0.80, b0: B.hips, b1: B.spine, w: 0.2 });
  if (fine) for (const a of [0.35, 1.4, 2.4, 3.9, 4.9, 5.9]) boss(S, [Math.sin(a) * 0.222, 0.979, -Math.cos(a) * 0.182], [Math.sin(a), 0.12, -Math.cos(a)], 0.020, 0.026, { seg: sg(7), b0: B.hips, b1: B.spine, w: 0.2 });
  // tassets: ten hanging plates round the hips. In outline this is what breaks the leg line.
  S.tint(COL.plateB, SF.paint, WR.paint);
  const nT = Math.max(4, rg(10));
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * TAU + 0.2, ca = Math.cos(a), sa = Math.sin(a);
    const x0 = sa * 0.188, z0 = -ca * 0.156;
    mass(S, resample([
      { c: [x0 * 1.00, 0.948, z0 * 1.00], ru: 0.036, rv: 0.046, pow: 3.2 },
      { c: [x0 * 1.10, 0.885, z0 * 1.10], ru: 0.042, rv: 0.054, pow: 3.2 },
      { c: [x0 * 1.18, 0.812, z0 * 1.18], ru: 0.038, rv: 0.048, pow: 3.2 },
      { c: [x0 * 1.22, 0.760, z0 * 1.22], ru: 0.028, rv: 0.036, pow: 3.2 },
    ], rg(5)), { ax: AX.down, seg: sg(10), b0: B.hips, b1: B.hips });
  }

  // --- torso shell in two runs so each carries one bone pair: lofted, narrowing at the waist, swelling
  // at the chest, and deeper in front than behind.
  S.tint(COL.plate, SF.paintW, WR.paint);
  mass(S, resample([
    { c: [0, 1.04, 0], ru: 0.140, ruN: 0.130, rv: 0.184, pow: 3.0, w: 0.25 },
    { c: [0, 1.13, 0], ru: 0.152, ruN: 0.138, rv: 0.196, pow: 3.0, w: 0.65 },
    { c: [0, 1.23, 0], ru: 0.170, ruN: 0.148, rv: 0.216, pow: 3.0, w: 1 },
  ], rg(5)), { ax: AX.up, seg: sg(18), capA: false, capB: false, b0: B.hips, b1: B.spine });
  mass(S, resample([
    { c: [0, 1.22, 0], ru: 0.168, ruN: 0.147, rv: 0.214, pow: 3.0, w: 0 },
    { c: [0, 1.31, 0], ru: 0.186, ruN: 0.157, rv: 0.240, pow: 3.0, w: 0.35 },
    { c: [0, 1.39, 0], ru: 0.192, ruN: 0.165, rv: 0.250, pow: 3.0, w: 0.75 },
    { c: [0, 1.47, 0], ru: 0.184, ruN: 0.164, rv: 0.234, pow: 3.0, w: 1 },
    { c: [0, 1.545, 0], ru: 0.160, ruN: 0.152, rv: 0.196, pow: 3.0, w: 1 },
    { c: [0, 1.58, 0], ru: 0.142, ruN: 0.138, rv: 0.170, pow: 3.0, w: 1 },
  ], rg(9)), { ax: AX.up, seg: sg(18), capA: false, capB: false, b0: B.spine, b1: B.chest });

  // --- breastplate: three overlapping lames standing off the shell, each with a visible rim
  S.tint(COL.plateC, SF.paint, WR.paint);
  mass(S, resample([
    { c: [0, 1.500, -0.030], ru: 0.130, rv: 0.212, pow: 3.4, w: 1 },
    { c: [0, 1.445, -0.062], ru: 0.156, rv: 0.246, pow: 3.4, w: 1 },
    { c: [0, 1.360, -0.076], ru: 0.168, rv: 0.262, pow: 3.4, w: 1 },
    { c: [0, 1.296, -0.062], ru: 0.156, rv: 0.250, pow: 3.4, w: 1 },
  ], rg(6)), { ax: AX.down, seg: sg(18), b0: B.spine, b1: B.chest });
  S.tint(COL.plateB, SF.paint, WR.paint);
  mass(S, resample([
    { c: [0, 1.288, -0.056], ru: 0.140, rv: 0.234, pow: 3.4, w: 0.45 },
    { c: [0, 1.232, -0.068], ru: 0.148, rv: 0.240, pow: 3.4, w: 0.2 },
    { c: [0, 1.186, -0.056], ru: 0.136, rv: 0.224, pow: 3.4, w: 0 },
  ], rg(4)), { ax: AX.down, seg: sg(16), b0: B.spine, b1: B.chest });
  S.tint(COL.plateDk, SF.paint, WR.paint);
  mass(S, resample([
    { c: [0, 1.176, -0.048], ru: 0.124, rv: 0.208, pow: 3.4, w: 0 },
    { c: [0, 1.124, -0.056], ru: 0.128, rv: 0.208, pow: 3.4, w: 0.25 },
    { c: [0, 1.080, -0.042], ru: 0.112, rv: 0.188, pow: 3.4, w: 0.5 },
  ], rg(4)), { ax: AX.down, seg: sg(16), b0: B.spine, b1: B.hips });
  // an inspection hatch on the left breast: a raised panel with its own rim and four bolts
  if (fine) {
    S.tint(COL.plateDk, SF.paint, WR.knurl);
    mass(S, resample([
      { c: [-0.088, 1.452, -0.150], ru: 0.020, rv: 0.062, pow: 3.6, w: 1 },
      { c: [-0.088, 1.372, -0.164], ru: 0.024, rv: 0.068, pow: 3.6, w: 1 },
      { c: [-0.088, 1.316, -0.152], ru: 0.018, rv: 0.058, pow: 3.6, w: 1 },
    ], rg(4)), { ax: AX.down, seg: sg(12), b0: B.chest, b1: B.chest });
  }
  // rib welts across the chest: horizontal banding is what separates it from the mimic at forty metres
  S.tint(COL.steel, SF.steel, WR.rim);
  for (const y of [1.47, 1.40, 1.33, 1.26, 1.19]) band(S, y - 0.013, y + 0.013, 0.232, 0.252, { seg: sg(18), pow: 3.0, zf: 0.78, bev: 0.009, b0: B.spine, b1: B.chest, w: y > 1.3 ? 1 : 0.4 });
  // bosses down the sternum and along the shoulders
  S.tint(COL.bright, SF.steel, WR.knurl);
  if (fine) for (const [x, y, z] of [[-0.150, 1.492, -0.150], [0.150, 1.492, -0.150], [-0.188, 1.430, -0.192], [0.188, 1.430, -0.192],
                                     [-0.202, 1.356, -0.204], [0.202, 1.356, -0.204], [-0.190, 1.292, -0.186], [0.190, 1.292, -0.186],
                                     [-0.168, 1.222, -0.176], [0.168, 1.222, -0.176]]) {
    boss(S, [x, y, z], [x * 0.5, 0, -0.5], 0.021, 0.030, { seg: sg(8), b0: B.spine, b1: B.chest, w: y > 1.3 ? 1 : 0.4 });
  }

  // --- back plate and the pack
  S.tint(COL.plateB, SF.paintW, WR.paint);
  mass(S, resample([
    { c: [0, 1.52, 0.052], ru: 0.140, rv: 0.196, pow: 3.4, w: 1 },
    { c: [0, 1.40, 0.070], ru: 0.164, rv: 0.230, pow: 3.4, w: 1 },
    { c: [0, 1.26, 0.070], ru: 0.160, rv: 0.222, pow: 3.4, w: 0.4 },
    { c: [0, 1.14, 0.056], ru: 0.140, rv: 0.198, pow: 3.4, w: 0 },
  ], rg(6)), { ax: AX.down, seg: sg(16), b0: B.spine, b1: B.chest });
  S.tint(COL.plateDk, SF.paintW, WR.paint);
  mass(S, resample([   // the pack itself
    { c: [0, 1.53, 0.146], ru: 0.096, rv: 0.150, pow: 3.6, w: 1 },
    { c: [0, 1.46, 0.222], ru: 0.132, rv: 0.190, pow: 3.6, w: 1 },
    { c: [0, 1.34, 0.240], ru: 0.138, rv: 0.196, pow: 3.6, w: 0.7 },
    { c: [0, 1.22, 0.230], ru: 0.130, rv: 0.186, pow: 3.6, w: 0.2 },
    { c: [0, 1.14, 0.166], ru: 0.096, rv: 0.148, pow: 3.6, w: 0 },
  ], rg(7)), { ax: AX.down, seg: sg(16), b0: B.spine, b1: B.chest });
  S.tint(COL.steel, SF.steel, WR.rim);
  for (const y of [1.42, 1.32, 1.22]) band(S, y - 0.012, y + 0.012, 0.180, 0.198, { seg: sg(16), cz: 0.232, pow: 3.4, zf: 0.72, bev: 0.008, b0: B.spine, b1: B.chest, w: 0.6 });
  // louvred vent panel on the back of the pack
  if (fine) {
    S.tint(COL.shadow, SF.steel, WR.louvre);
    for (let i = 0; i < Math.max(2, rg(4)); i++) {
      const y = 1.24 + i * 0.042;
      mass(S, [
        { c: [-0.086, y, 0.368], ru: 0.015, rv: 0.030, pow: 3.4 },
        { c: [0.086, y, 0.368], ru: 0.015, rv: 0.030, pow: 3.4 },
      ], { ax: AX.right, seg: sg(8), b0: B.chest, b1: B.spine, w: 0.5 });
    }
  }
  // two pressure bottles strapped to the pack, and the exhaust stack between them
  S.tint(COL.ram, SF.ram, WR.knurl);
  for (const x of [-0.118, 0.118]) {
    mass(S, resample([
      { c: [x, 1.492, 0.300], ru: 0.046, rv: 0.046, pow: 2.0, w: 1 },
      { c: [x, 1.432, 0.318], ru: 0.062, rv: 0.062, pow: 2.0, w: 1 },
      { c: [x, 1.240, 0.318], ru: 0.062, rv: 0.062, pow: 2.0, w: 0.3 },
      { c: [x, 1.180, 0.300], ru: 0.044, rv: 0.044, pow: 2.0, w: 0 },
    ], rg(6)), { ax: AX.down, seg: sg(12), b0: B.spine, b1: B.chest });
  }
  S.tint(COL.gun, SF.steel, WR.knurl);
  mass(S, resample([
    { c: [0, 1.55, 0.256], ru: 0.036, rv: 0.036, pow: 2.2, w: 1 },
    { c: [0, 1.66, 0.246], ru: 0.032, rv: 0.032, pow: 2.2, w: 1 },
    { c: [0, 1.73, 0.230], ru: 0.046, rv: 0.046, pow: 2.4, w: 1 },
    { c: [0, 1.755, 0.226], ru: 0.038, rv: 0.038, pow: 2.4, w: 1 },
  ], rg(5)), { ax: AX.up, seg: sg(10), capA: false, b0: B.spine, b1: B.chest });
  if (fine) {
    S.tint(COL.rubber, SF.rubber, WR.rib);
    hose(S, [-0.118, 1.50, 0.300], [-0.206, 1.50, 0.030], 0.020, { seg: sg(8), n: rg(7), sag: 0.02, bow: [-0.02, 0.03, 0], b0: B.chest, b1: B.chest });
    hose(S, [0.118, 1.50, 0.300], [0.206, 1.50, 0.030], 0.020, { seg: sg(8), n: rg(7), sag: 0.02, bow: [0.02, 0.03, 0], b0: B.chest, b1: B.chest });
    hose(S, [-0.08, 1.20, 0.316], [0.08, 1.20, 0.316], 0.017, { seg: sg(8), n: rg(7), sag: 0.05, b0: B.spine, b1: B.spine });
    hose(S, [-0.150, 1.44, 0.300], [-0.150, 1.20, 0.290], 0.014, { seg: sg(7), n: rg(6), sag: 0, bow: [-0.03, 0, 0.02], b0: B.chest, b1: B.spine, w: 0.5 });
    hose(S, [0.150, 1.44, 0.300], [0.150, 1.20, 0.290], 0.014, { seg: sg(7), n: rg(6), sag: 0, bow: [0.03, 0, 0.02], b0: B.chest, b1: B.spine, w: 0.5 });
  }

  // --- shoulder yoke: a hard bar across the top of both shoulders, so the shoulders sit DEAD LEVEL on a
  // body that is otherwise asymmetric. That reads wrong at a glance, which is the whole point.
  S.tint(COL.plateDk, SF.paint, WR.paint);
  mass(S, resample([
    { c: [-0.278, SH_Y + 0.092, 0.006], ru: 0.044, rv: 0.086, pow: 3.4 },
    { c: [-0.150, SH_Y + 0.120, -0.006], ru: 0.052, rv: 0.098, pow: 3.4 },
    { c: [0, SH_Y + 0.128, -0.012], ru: 0.054, rv: 0.102, pow: 3.4 },
    { c: [0.150, SH_Y + 0.120, -0.006], ru: 0.052, rv: 0.098, pow: 3.4 },
    { c: [0.278, SH_Y + 0.092, 0.006], ru: 0.044, rv: 0.086, pow: 3.4 },
  ], rg(7)), { ax: AX.right, seg: sg(12), b0: B.chest, b1: B.chest });
  S.tint(COL.steel, SF.steel, WR.rim);
  if (fine) for (const x of [-0.19, 0, 0.19]) boss(S, [x, SH_Y + 0.166, -0.02], 'y', 0.026, 0.032, { seg: sg(8), b0: B.chest, b1: B.chest });

  // --- collar: a hard, pale, turned ring standing between the yoke and the dome. The doll tell.
  S.tint(COL.bright, SF.steel, WR.knurl);
  band(S, 1.570, 1.644, 0.096, 0.134, { seg: sg(18), pow: 2.6, bev: 0.016, b0: B.chest, b1: B.neck, w: 0.5 });
  S.tint(COL.gap, SF.cloth, WR.joint);   // the ember lives under the collar
  mass(S, [
    { c: [0, 1.556, 0], ru: 0.088, rv: 0.086, pow: 2.2, w: 0.3 },
    { c: [0, 1.646, 0], ru: 0.082, rv: 0.080, pow: 2.2, w: 0.9 },
  ], { ax: AX.up, seg: sg(14), capA: false, capB: false, b0: B.chest, b1: B.neck });
  // gorget plates flanking the neck
  S.tint(COL.plateC, SF.paint, WR.paint);
  for (const s of [-1, 1]) {
    mass(S, resample([
      { c: [s * 0.070, 1.606, -0.044], ru: 0.042, rv: 0.060, pow: 3.0, w: 0.4 },
      { c: [s * 0.128, 1.590, -0.038], ru: 0.046, rv: 0.062, pow: 3.0, w: 0.1 },
      { c: [s * 0.176, 1.560, -0.026], ru: 0.036, rv: 0.052, pow: 3.0, w: 0 },
    ], rg(4)), { ax: AX.right, seg: sg(10), flip: s < 0, b0: B.chest, b1: B.neck });
  }
}

// The dome: a sensor housing, not a face. One shape event on the front — the lamp — and nothing else.
function buildHead(S, D) {
  const sg = (n) => Math.max(D < 0.4 ? 4 : 5, Math.round(n * D));
  const rg = (n) => Math.max(2, Math.round(n * D));
  const fine = D > 0.42;
  const HB = { b0: B.neck, b1: B.head };

  // neck gaiter: ribbed, soft, embered
  S.tint(COL.gap, SF.cloth, WR.joint);
  const gt = [];
  const ng = Math.max(3, Math.round(7 * D));
  for (let i = 0; i <= ng; i++) {
    const t = i / ng, r = 0.076 + (i % 2 ? 0.011 : 0);
    gt.push({ c: [0, 1.628 + t * 0.058, 0], ru: r, rv: r * 0.95, pow: 2.2, w: 0.25 + t * 0.7 });
  }
  mass(S, gt, Object.assign({ ax: AX.up, seg: sg(14), capA: false, capB: false }, HB));

  // the dome. Small for the body, and darker than everything below it — a three-metre thing with a small
  // dark head reads taller, and the lamp is then the only thing in the frame that is looking at you.
  S.tint(COL.plateDk, SF.paint, WR.paint);
  mass(S, resample([
    { c: [0, 1.680, 0.006], ru: 0.100, rv: 0.108, pow: 2.7, w: 1 },
    { c: [0, 1.716, 0.006], ru: 0.130, rv: 0.140, pow: 2.7, w: 1 },
    { c: [0, 1.760, 0.006], ru: 0.148, rv: 0.154, pow: 2.7, w: 1 },
    { c: [0, 1.812, 0.006], ru: 0.146, rv: 0.150, pow: 2.7, w: 1 },
    { c: [0, 1.858, 0.006], ru: 0.126, rv: 0.130, pow: 2.7, w: 1 },
    { c: [0, 1.888, 0.006], ru: 0.082, rv: 0.086, pow: 2.7, w: 1 },
    { c: [0, 1.902, 0.006], ru: 0.030, rv: 0.032, pow: 2.7, w: 1 },
  ], rg(12)), Object.assign({ ax: AX.up, seg: sg(18), capA: false }, HB));
  // the brim: the last ring pushed out and dropped. A flared brim all the way round is the Soviet read.
  S.tint(COL.shadow, SF.paint, WR.paint);
  mass(S, resample([
    { c: [0, 1.702, 0.006], ru: 0.122, rv: 0.132, pow: 2.7, w: 1 },
    { c: [0, 1.688, 0.006], ru: 0.162, rv: 0.178, pow: 2.7, w: 1 },
    { c: [0, 1.672, 0.006], ru: 0.158, rv: 0.174, pow: 2.7, w: 1 },
    { c: [0, 1.662, 0.006], ru: 0.120, rv: 0.132, pow: 2.7, w: 1 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(18), capA: false, capB: false }, HB));

  // face plate: a blank, slightly dished panel where a face should be. It is the ONE deliberate deletion.
  S.tint(COL.shadow, SF.paint, WR.paint);
  mass(S, resample([
    { c: [0, 1.812, -0.100], ru: 0.026, rv: 0.084, pow: 3.2, w: 1 },
    { c: [0, 1.782, -0.122], ru: 0.032, rv: 0.096, pow: 3.2, w: 1 },
    { c: [0, 1.740, -0.134], ru: 0.038, rv: 0.104, pow: 3.2, w: 1 },
    { c: [0, 1.698, -0.116], ru: 0.032, rv: 0.092, pow: 3.2, w: 1 },
  ], rg(5)), Object.assign({ ax: AX.down, seg: sg(14) }, HB));
  S.tint(COL.void, SF.paint, WR.paint);
  mass(S, resample([
    { c: [0, 1.806, -0.140], ru: 0.014, rv: 0.062, pow: 3.4, w: 1 },
    { c: [0, 1.776, -0.152], ru: 0.017, rv: 0.068, pow: 3.4, w: 1 },
    { c: [0, 1.742, -0.148], ru: 0.014, rv: 0.062, pow: 3.4, w: 1 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(12) }, HB));

  // the lamp: a barrel standing off the face plate on two brackets, with a hood and a knurled bezel
  S.tint(COL.gun, SF.steel, WR.knurl);
  mass(S, resample([
    { c: [0, 1.762, -0.130], ru: 0.072, rv: 0.072, pow: 2.4, w: 1 },
    { c: [0, 1.762, -0.176], ru: 0.082, rv: 0.082, pow: 2.4, w: 1 },
    { c: [0, 1.762, -0.216], ru: 0.094, rv: 0.094, pow: 2.4, w: 1 },
  ], rg(5)), Object.assign({ ax: AX.fwd, seg: sg(16), capB: false }, HB));
  S.tint(COL.bright, SF.steel, WR.rim);
  mass(S, resample([
    { c: [0, 1.762, -0.214], ru: 0.096, rv: 0.096, pow: 2.4, w: 1 },
    { c: [0, 1.762, -0.240], ru: 0.106, rv: 0.106, pow: 2.4, w: 1 },
    { c: [0, 1.762, -0.256], ru: 0.088, rv: 0.088, pow: 2.4, w: 1 },
  ], rg(4)), Object.assign({ ax: AX.fwd, seg: sg(16), capA: false }, HB));
  S.tint(COL.plateDk, SF.paint, WR.paint);   // the hood over the top of the lamp
  mass(S, resample([
    { c: [0, 1.852, -0.120], ru: 0.048, rv: 0.096, pow: 3.0, w: 1 },
    { c: [0, 1.850, -0.186], ru: 0.054, rv: 0.110, pow: 3.0, w: 1 },
    { c: [0, 1.836, -0.248], ru: 0.048, rv: 0.112, pow: 3.0, w: 1 },
    { c: [0, 1.812, -0.286], ru: 0.032, rv: 0.100, pow: 3.0, w: 1 },
  ], rg(5)), Object.assign({ ax: AX.fwd, seg: sg(12) }, HB));
  if (fine) {
    S.tint(COL.ram, SF.ram, WR.knurl);        // the brackets the lamp swings in
    for (const s of [-1, 1]) {
      mass(S, resample([
        { c: [s * 0.104, 1.826, -0.126], ru: 0.020, rv: 0.026, pow: 2.6, w: 1 },
        { c: [s * 0.116, 1.780, -0.176], ru: 0.018, rv: 0.024, pow: 2.6, w: 1 },
        { c: [s * 0.110, 1.752, -0.202], ru: 0.016, rv: 0.022, pow: 2.6, w: 1 },
      ], rg(4)), Object.assign({ ax: AX.down, seg: sg(8) }, HB));
    }
  }

  // two sensor pods either side, a rear cowl and a stub antenna: the head has instruments, not features
  S.tint(COL.gun, SF.steel, WR.knurl);
  for (const s of [-1, 1]) {
    mass(S, resample([
      { c: [s * 0.120, 1.768, -0.050], ru: 0.038, rv: 0.036, pow: 2.6, w: 1 },
      { c: [s * 0.156, 1.762, -0.068], ru: 0.034, rv: 0.032, pow: 2.6, w: 1 },
      { c: [s * 0.178, 1.754, -0.082], ru: 0.024, rv: 0.022, pow: 2.6, w: 1 },
    ], rg(4)), Object.assign({ ax: AX.right, seg: sg(10), flip: s < 0 }, HB));
  }
  S.tint(COL.rod, SF.rod, WR.clean);
  mass(S, resample([
    { c: [0.104, 1.874, 0.086], ru: 0.011, rv: 0.011, pow: 2.0, w: 1 },
    { c: [0.114, 1.960, 0.100], ru: 0.008, rv: 0.008, pow: 2.0, w: 1 },
    { c: [0.122, 2.040, 0.110], ru: 0.005, rv: 0.005, pow: 2.0, w: 1 },
  ], rg(4)), Object.assign({ ax: AX.up, seg: sg(7) }, HB));
  S.tint(COL.shadow, SF.paint, WR.paint);   // rear cowl over the vents
  mass(S, resample([
    { c: [0, 1.836, 0.100], ru: 0.058, rv: 0.100, pow: 3.0, w: 1 },
    { c: [0, 1.800, 0.146], ru: 0.070, rv: 0.110, pow: 3.0, w: 1 },
    { c: [0, 1.732, 0.150], ru: 0.062, rv: 0.104, pow: 3.0, w: 1 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(12) }, HB));

  // louvres across the back of the dome: the only place air gets out
  S.tint(COL.shadow, SF.steel, WR.louvre);
  for (let i = 0; i < Math.max(2, rg(6)); i++) {
    const y = 1.742 + i * 0.026;
    mass(S, [
      { c: [-0.072, y, 0.196 + i * 0.002], ru: 0.010, rv: 0.026, pow: 3.4, w: 1 },
      { c: [0.072, y, 0.196 + i * 0.002], ru: 0.010, rv: 0.026, pow: 3.4, w: 1 },
    ], Object.assign({ ax: AX.right, seg: sg(8) }, HB));
  }
  S.tint(COL.steel, SF.steel, WR.rim);
  if (fine) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4, sa = Math.sin(a), ca = Math.cos(a);
    boss(S, [sa * 0.140, 1.694, 0.006 - ca * 0.130], [sa * 0.5, 1, -ca * 0.5], 0.018, 0.024, Object.assign({ seg: sg(8) }, HB, { w: 1 }));
  }
}

// The heavy MG, gun-bone local, muzzle down -z. A finned barrel shroud, a side box, a hanging belt and a
// folded bipod: at forty metres this is the shape that says "the big one is shooting".
const MG_GRIP_R = [0.0, -0.15, 0.17], MG_GRIP_L = [-0.02, -0.06, -0.20], MG_MUZZLE = [0, 0.02, -0.86];
function buildGun(S, D) {
  const sg = (n) => Math.max(D < 0.4 ? 4 : 5, Math.round(n * D));
  const rg = (n) => Math.max(2, Math.round(n * D));
  const fine = D > 0.42;
  const g = { b0: B.gun, b1: B.gun };
  S.tint(COL.gun, SF.steel, WR.knurl);
  mass(S, resample([   // receiver
    { c: [0, 0.005, 0.320], ru: 0.048, rv: 0.042, pow: 3.4 },
    { c: [0, 0.010, 0.180], ru: 0.066, rv: 0.058, pow: 3.4 },
    { c: [0, 0.012, 0.020], ru: 0.072, rv: 0.064, pow: 3.4 },
    { c: [0, 0.014, -0.120], ru: 0.064, rv: 0.056, pow: 3.4 },
    { c: [0, 0.016, -0.200], ru: 0.054, rv: 0.048, pow: 3.4 },
  ], rg(7)), Object.assign({ ax: AX.fwd, seg: sg(14) }, g));
  if (fine) {   // feed cover with a hinge
    S.tint(COL.plateDk, SF.paint, WR.knurl);
    mass(S, resample([
      { c: [0, 0.062, 0.150], ru: 0.020, rv: 0.052, pow: 3.4 },
      { c: [0, 0.070, 0.040], ru: 0.024, rv: 0.058, pow: 3.4 },
      { c: [0, 0.066, -0.070], ru: 0.020, rv: 0.050, pow: 3.4 },
    ], rg(4)), Object.assign({ ax: AX.fwd, seg: sg(10) }, g));
  }
  // finned barrel shroud: seventeen alternating rings. Reads as a machine at any distance.
  S.tint(COL.gun, SF.steel, WR.rib);
  const fins = [];
  const nf = Math.max(5, Math.round(17 * D));
  for (let i = 0; i <= nf; i++) {
    const t = i / nf, r = (i % 2 ? 0.060 : 0.042);
    fins.push({ c: [0, 0.018, lerp(-0.20, -0.62, t)], ru: r, rv: r, pow: 2.4 });
  }
  mass(S, fins, Object.assign({ ax: AX.fwd, seg: sg(14) }, g));
  S.tint(COL.bright, SF.steel, WR.clean);
  mass(S, resample([   // barrel and muzzle brake
    { c: [0, 0.018, -0.600], ru: 0.026, rv: 0.026, pow: 2.2 },
    { c: [0, 0.018, -0.760], ru: 0.024, rv: 0.024, pow: 2.2 },
    { c: [0, 0.018, -0.790], ru: 0.042, rv: 0.042, pow: 2.6 },
    { c: [0, 0.018, -0.840], ru: 0.040, rv: 0.040, pow: 2.6 },
    { c: [0, 0.018, -0.870], ru: 0.030, rv: 0.030, pow: 2.6 },
  ], rg(7)), Object.assign({ ax: AX.fwd, seg: sg(12) }, g));
  S.tint(COL.gun, SF.steel, WR.knurl);
  mass(S, resample([   // gas tube under the barrel
    { c: [0, -0.040, -0.220], ru: 0.018, rv: 0.018, pow: 2.2 },
    { c: [0, -0.042, -0.430], ru: 0.016, rv: 0.016, pow: 2.2 },
    { c: [0, -0.044, -0.640], ru: 0.015, rv: 0.015, pow: 2.2 },
  ], rg(4)), Object.assign({ ax: AX.fwd, seg: sg(8) }, g));
  mass(S, resample([   // carry handle
    { c: [0, 0.076, -0.120], ru: 0.020, rv: 0.016, pow: 3.0 },
    { c: [0, 0.104, -0.060], ru: 0.019, rv: 0.015, pow: 3.0 },
    { c: [0, 0.104, 0.010], ru: 0.019, rv: 0.015, pow: 3.0 },
    { c: [0, 0.078, 0.070], ru: 0.020, rv: 0.016, pow: 3.0 },
  ], rg(5)), Object.assign({ ax: AX.fwd, seg: sg(8), flip: true }, g));
  if (fine) {   // rear sight drum
    S.tint(COL.bright, SF.steel, WR.knurl);
    mass(S, resample([
      { c: [0, 0.056, 0.100], ru: 0.016, rv: 0.016, pow: 2.2 },
      { c: [0, 0.056, 0.070], ru: 0.022, rv: 0.022, pow: 2.2 },
      { c: [0, 0.056, 0.046], ru: 0.014, rv: 0.014, pow: 2.2 },
    ], rg(4)), Object.assign({ ax: AX.fwd, seg: sg(9) }, g));
  }
  S.tint(COL.plateDk, SF.paint, WR.paint);
  mass(S, resample([   // side box magazine
    { c: [-0.070, -0.052, 0.100], ru: 0.058, rv: 0.054, pow: 3.6 },
    { c: [-0.118, -0.058, 0.100], ru: 0.068, rv: 0.062, pow: 3.6 },
    { c: [-0.166, -0.058, 0.100], ru: 0.066, rv: 0.060, pow: 3.6 },
    { c: [-0.194, -0.054, 0.100], ru: 0.052, rv: 0.048, pow: 3.6 },
  ], rg(5)), Object.assign({ ax: AX.right, seg: sg(12), flip: true }, g));
  S.tint(COL.rubber, SF.rubber, WR.rib);
  mass(S, resample([   // grip
    { c: [0, -0.026, 0.208], ru: 0.026, rv: 0.030, pow: 2.6 },
    { c: [0.002, -0.086, 0.222], ru: 0.024, rv: 0.028, pow: 2.6 },
    { c: [0.004, -0.146, 0.238], ru: 0.026, rv: 0.030, pow: 2.6 },
  ], rg(4)), Object.assign({ ax: AX.down, seg: sg(10) }, g));
  S.tint(COL.plateDk, SF.paint, WR.paint);
  mass(S, resample([   // stock
    { c: [0, -0.016, 0.330], ru: 0.036, rv: 0.032, pow: 3.2 },
    { c: [0, -0.034, 0.410], ru: 0.042, rv: 0.034, pow: 3.2 },
    { c: [0, -0.052, 0.470], ru: 0.050, rv: 0.038, pow: 3.2 },
  ], rg(4)), Object.assign({ ax: AX.fwd, seg: sg(10), flip: true }, g));
  if (fine) {   // folded bipod under the shroud
    S.tint(COL.ram, SF.ram, WR.knurl);
    for (const s of [-1, 1]) {
      mass(S, resample([
        { c: [s * 0.030, -0.052, -0.540], ru: 0.012, rv: 0.012, pow: 2.2 },
        { c: [s * 0.046, -0.062, -0.400], ru: 0.011, rv: 0.011, pow: 2.2 },
        { c: [s * 0.054, -0.070, -0.270], ru: 0.010, rv: 0.010, pow: 2.2 },
      ], rg(4)), Object.assign({ ax: AX.fwd, seg: sg(7), flip: true }, g));
    }
  }
  // the belt: thirteen links out of the box and up to the feed. Hanging brass is the heavy-gun read.
  S.tint(COL.brass, SF.steel, WR.clean);
  const nl = Math.max(4, Math.round(13 * D));
  for (let i = 0; i < nl; i++) {
    const t = i / (nl - 1);
    const x = lerp(-0.078, -0.156, t), y = lerp(-0.024, -0.250, t) + Math.sin(t * 2.4) * 0.024, z = 0.100 + t * 0.055;
    mass(S, resample([
      { c: [x, y, z - 0.028], ru: 0.015, rv: 0.015, pow: 2.4 },
      { c: [x, y + 0.002, z], ru: 0.017, rv: 0.017, pow: 2.4 },
      { c: [x, y, z + 0.028], ru: 0.013, rv: 0.013, pow: 2.4 },
    ], rg(3)), Object.assign({ ax: AX.fwd, seg: sg(8), flip: true }, g));
  }
}

// -----------------------------------------------------------------------------------------------------
// Assemble, at a detail factor. LOD0 1.00, LOD1 0.52, LOD2 0.30 — same author, fewer segments and rings,
// bound to the SAME skeleton, so switching costs nothing but a visibility flag.
// -----------------------------------------------------------------------------------------------------
const GEO = [null, null, null];
const LOD_DETAIL = [1.0, 0.52, 0.30];
const LOD_DIST = [0, 26, 62];
function buildSuit(level) {
  if (GEO[level]) return GEO[level];
  const D = LOD_DETAIL[level];
  const S = new Soup();
  buildTorso(S, D);
  buildHead(S, D);
  buildArm(S, D, -1); buildArm(S, D, 1);
  buildLeg(S, D, -1); buildLeg(S, D, 1);
  buildGun(S, D);
  GEO[level] = S.finish(SCALE, 0.55);
  return GEO[level];
}

// =====================================================================================================
// Material. One program for the whole creature: paint that chips to bare steel off every curvature edge,
// rust that weeps DOWN from up-facing seams, four machined patterns on a vertex channel, dust on what
// faces the sky, mud at the feet, an ember in the joint gaps, and the distance-gated sky rim that lets a
// dark shape separate from a birch trunk at forty metres.
// =====================================================================================================
const RIM = { uRim: { value: 1.0 }, uRimCol: { value: new THREE.Color(0.16, 0.18, 0.21) } };
const SUIT_VERT = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf; varying vec4 vWear;
attribute vec4 aSurf; attribute vec4 aWear; attribute float aPhase; attribute vec3 aJit;
uniform float uTime, uShiver, uSeed;`;
const SUIT_FRAG = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf; varying vec4 vWear;
uniform float uDissolve, uGrime, uRim, uEmberK, uTime, uSeed;
uniform vec3 uRimCol, uDust, uMud, uBare, uRust, uEmber;`;
function suitCompile(shader) {
  const u = this.userData.u;
  for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
  for (const k in u) shader.uniforms[k] = u[k];
  shader.uniforms.uRim = RIM.uRim;
  shader.uniforms.uRimCol = RIM.uRimCol;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${SUIT_VERT}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSurf = aSurf;\n  vWear = aWear;\n  float vShiverMask = aSurf.z;')
    .replace('#include <skinning_vertex>', /* glsl */`#include <skinning_vertex>
      {
        float ph = aPhase * 61.7 + uSeed;
        float slot = floor(uTime * 20.0 + aPhase * 5.0);
        float n1 = hash11(slot + ph) - 0.5;
        float n2 = hash11(slot * 1.31 + ph * 0.7 + 3.1) - 0.5;
        float spike = step(0.955, hash11(slot * 0.11 + ph * 3.3));
        float amp = uShiver * (0.010 + spike * 0.034) * vShiverMask;
        transformed += (objectNormal * n1 * 0.7 + aJit * n2) * amp;
      }
      vCPos = transformed;
      vCN = objectNormal;
      vWN = normalize(mat3(modelMatrix) * objectNormal);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${SUIT_FRAG}`)
    .replace('#include <clipping_planes_fragment>', /* glsl */`#include <clipping_planes_fragment>
      float dsv = 0.0;
      if (uDissolve > 0.0) {
        float dn = fbm3d(vCPos * 3.0);
        float th = uDissolve * 1.15 - 0.05;
        if (dn < th) discard;
        dsv = smoothstep(th + 0.07, th, dn);
      }`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      float bare = 0.0;
      {
        vec3 op = vCPos + uSeed;
        float n1 = vnoise3(op * 2.6);
        float n2 = vnoise3(op * 9.0);
        float n3 = vnoise3(op * 34.0);
        diffuseColor.rgb *= 0.84 + 0.32 * n1 + 0.10 * n2;
        // paint chips off every curvature edge, rim, boss and weld, straight down to bare steel
        float curv = length(fwidth(vNormal)) / max(length(fwidth(vCPos)), 1e-6);
        float edge = smoothstep(120.0, 460.0, curv) * smoothstep(0.28, 0.70, n2) * vWear.x;
        float sc = smoothstep(0.928, 0.972, vnoise(vec2(vCPos.y * 42.0 + uSeed, vCPos.x * 150.0 + vCPos.z * 90.0)));
        bare = clamp(edge + sc * 0.8 * vWear.x, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uBare, bare);
        // rust weeps DOWN from up-facing seams and fasteners
        float src = smoothstep(0.10, 0.70, vCN.y) * smoothstep(0.50, 0.82, vnoise3(vCPos * 6.5 + 4.0));
        float run = smoothstep(0.40, 0.94, vnoise(vec2(vCPos.x * 26.0 + vCPos.z * 19.0 + uSeed, vCPos.y * 2.0)));
        float rust = clamp((src * 1.5 + bare * 0.55) * run, 0.0, 1.0) * uGrime * vWear.y;
        diffuseColor.rgb = mix(diffuseColor.rgb, uRust * (0.62 + 0.55 * n3), rust * 0.70);
        // machined and moulded patterns, per vertex: 1 ribs, 2 cloth weave, 3 sole tread, 4 louvre, 5 knurl
        float pat = 0.0, pk = vWear.z;
        if (pk > 0.5 && pk < 1.5) pat = smoothstep(0.30, 0.70, 0.5 + 0.5 * sin(vCPos.y * 96.0 + vCPos.z * 30.0));
        else if (pk > 1.5 && pk < 2.5) pat = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin((vCPos.x + vCPos.y) * 340.0) * sin((vCPos.x - vCPos.y) * 340.0));
        else if (pk > 2.5 && pk < 3.5) pat = smoothstep(0.30, 0.70, 0.5 + 0.5 * sin(vCPos.z * 150.0));
        else if (pk > 3.5 && pk < 4.5) pat = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(vCPos.y * 260.0));
        else if (pk > 4.5) pat = smoothstep(0.30, 0.72, vnoise3(vCPos * 190.0));
        diffuseColor.rgb *= 1.0 - pat * 0.22;
        // dust settles pale on what faces the sky; the feet stay wet
        float up = clamp(vCN.y, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDust, up * up * 0.30 * uGrime * (0.35 + 0.65 * n1));
        float mud = smoothstep(0.80, -0.05, vCPos.y) * uGrime;
        diffuseColor.rgb = mix(diffuseColor.rgb, uMud, mud * 0.34 * (0.4 + 0.6 * n2));
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.30, 0.28), dsv);`)
    .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      roughnessFactor = clamp(vSurf.x + (vnoise3(vCPos * 26.0) - 0.5) * 0.14 - vSurf.w * 0.20 - bare * 0.22, 0.05, 1.0);`)
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vSurf.y + bare * 0.05;')
    .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        float ph = vnoise3(vCPos * 5.0) * 20.0;
        float pulse = 0.58 + 0.42 * sin(uTime * 2.1 + ph) * (0.6 + 0.4 * sin(uTime * 7.3 + ph * 0.3));
        totalEmissiveRadiance += uEmber * (vWear.w * uEmberK * pulse);
      }`)
    .replace('#include <opaque_fragment>', /* glsl */`#include <opaque_fragment>
      {
        float fres = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float dist = length(vViewPosition);
        float k = pow(fres, 2.2) * (0.24 + 0.76 * smoothstep(2.5, 14.0, dist)) * (0.40 + 0.60 * clamp(vWN.y * 0.55 + 0.55, 0.0, 1.0));
        gl_FragColor.rgb += uRimCol * (k * uRim * (1.0 - dsv));
      }`);
}
function makeSuitMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.04 });
  mat.userData.u = {
    uTime: { value: 0 }, uShiver: { value: 1 }, uDissolve: { value: 0 }, uSeed: { value: Math.random() * 60 },
    uGrime: { value: 1 }, uEmberK: { value: 1 },
    uDust: { value: new THREE.Color(0x9a9688) },
    uMud: { value: new THREE.Color(0x45392c) },
    uBare: { value: new THREE.Color(0xa4a8ae) },
    uRust: { value: new THREE.Color(0x8a552f) },
    uEmber: { value: new THREE.Color(0xc2621e).multiplyScalar(0.90) },
  };
  mat.onBeforeCompile = suitCompile;
  mat.customProgramCacheKey = () => 'radius-seeker-suit';
  return mat;
}

// ---- visible searchlight cone: additive, brightest along the silhouette, dust drifting through it ----
const CONE_VERT = /* glsl */`
  varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  void main(){ vUv = uv; vT = 1.0 - uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const CONE_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime, uIntensity; varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  void main(){
    float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float fall = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.05, vT);
    float dust = 0.7 + 0.6 * vnoise(vec2(vUv.x * 9.0, vT * 22.0 - uTime * 0.7)) * vnoise(vec2(vUv.x * 23.0 + uTime * 0.2, vT * 60.0 - uTime * 1.5));
    float core = pow(1.0 - vT, 3.4) * 0.5;
    float a = (0.11 + 0.62 * edge * edge + core) * fall * uIntensity * dust;
    gl_FragColor = vec4(vec3(1.0, 0.92, 0.74) * a, a);
  }`;
let coneGeo = null;
function makeCone(length, angle) {
  if (!coneGeo) {
    const r = Math.tan(angle) * length;
    coneGeo = new THREE.CylinderGeometry(0.11, r, length, 26, 1, true);
    _m.makeTranslation(0, -length / 2, 0); coneGeo.applyMatrix4(_m);
    _m.makeRotationX(Math.PI / 2); coneGeo.applyMatrix4(_m);
    coneGeo.userData.shared = true;
  }
  const mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.8 } }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const m = new THREE.Mesh(coneGeo, mat); m.renderOrder = 4; m.frustumCulled = false;   // hangs off a bone; one call, never worth a mis-cull
  return m;
}

let rng = null;
class Seeker extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'seeker', position, Object.assign({ hp: SEEKER.hp || 700 }, opts));
    this.radius = 0.55; this.height = 3.0; this.speed = 1.2;
    this.loadout = seekerLoadout();
    this.weapon = this.loadout.weapon; this.wdef = this.loadout.wdef; this.ammo = this.loadout.ammo; this.ammoId = this.loadout.ammoId;
    this.pieces = [{ def: SUIT_DEF, inst: this.loadout.suit, slot: 'vest' }];
    this.reloadT = 0; this.reloading = false; this.dry = false; this.calledSquad = false; this.piled = false; this.burstN = 0; this.stunned = 0;
    this.shotNames = [`shot_${this.weapon.id}`, 'seeker_shot', 'shot_akm'];
    this.mat = makeSuitMaterial();
    this.bodyMat = this.mat; this.plateMat = this.mat;    // kept as names other passes reach for
    this.rig = new Rig({ scale: SCALE, material: this.mat, geometry: buildSuit(0), muzzle: MG_MUZZLE, gripR: MG_GRIP_R, gripL: MG_GRIP_L });
    // one skeleton, three geometries, one visibility switch. A near seeker costs ~16 k triangles; three of
    // them at range cost less than one.
    this.lod = new THREE.LOD();
    this.lod.addLevel(this.rig.mesh, LOD_DIST[0]);
    this.meshes = [this.rig.mesh];
    for (let l = 1; l < GEO.length; l++) {
      const m = this.rig.attach(buildSuit(l), this.mat);
      this.lod.addLevel(m, LOD_DIST[l]);
      this.meshes.push(m);
    }
    this.root.add(this.lod);
    // the lens: an emissive disc on the lamp; the searchlight and its cone hang from the head bone
    const head = this.rig.B.head;
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.2), fog: false });
    // discs face +z by default; the lamp looks down the head's -z, so flip the geometry (not the object:
    // beamTest reads the lens object's -z axis)
    const lensGeo = new THREE.CircleGeometry(0.082 * SCALE, 18); lensGeo.rotateY(Math.PI);
    this.lens = new THREE.Mesh(lensGeo, this.lensMat);
    this.lens.position.set(0, 0.100 * SCALE, -0.250 * SCALE); head.add(this.lens);
    // a soft corona so the lamp reads as a lamp at forty metres, where the disc is one pixel
    this.haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.0, 0.78, 0.42), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.geometry.userData.shared = true;   // three shares one BufferGeometry across every Sprite
    this.halo.scale.setScalar(0.42 * SCALE); this.halo.renderOrder = 5;
    this.halo.position.copy(this.lens.position); this.halo.position.z -= 0.012;
    this.halo.frustumCulled = false; head.add(this.halo);
    this.light = new THREE.SpotLight(0xffe4bb, 0, 60, 0.25, 0.4, 1.3);
    this.light.position.copy(this.lens.position); this.light.castShadow = false;
    this.light.target.position.set(0, 0.100 * SCALE, -12);
    head.add(this.light); head.add(this.light.target);
    this.cone = makeCone(26, 0.25); this.cone.position.copy(this.lens.position); head.add(this.cone);
    // the head sits forward of where a neck would put it — almost human, wrong
    this.rig.B.head.position.z -= 0.034 * SCALE; this.rig.B.neck.position.z -= 0.020 * SCALE;
    this.lightLevel = 1; this.flicker = 1;
    // AI
    this.target = null; this.waitT = rng.range(2, 5); this.sweepT = rng.range(0, 10); this.sweepDir = 1; this.lookYaw = 0;
    this.burstLeft = 0; this.shotT = 0; this.cooldown = 1.2; this.lastVisT = -1e9; this.lastAlertT = -1e9; this.hissT = rng.range(3, 8);
    this.humLoop = null; this.loopRetry = 0; this.flashed = false; this.inBeam = false; this.moveSpeed = 0; this.staggerT = 0; this.humT = 0; this.beamHold = 0;
    this.glitchT = rng.range(3, 7); this.glitchLeft = 0;
    this.ember = 1; this.rimT = -1;
    this.deathDuration = 3.6; this.ashDone = false; this.deathFlickerSeed = Math.random() * 10;
    const poi = opts.poi ? ctx.world.poi(opts.poi) : null;
    this.poiR = poi ? Math.min(poi.r * 0.7, 40) : 25;
    this.setState('patrol');
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
    this.animate(0.016, 0, {});
  }
  playerAudibility() {
    const d = this.distanceToPlayer();
    const steps = d < 10 ? this.player.noise * (1 - d / 10) : 0;
    const shots = this.ctx.director?.recentShotAt(this.position, 60) || 0;
    if (shots > 0.05) { if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastSeenT = this.time; if (this.aware < 0.5) this.aware = 0.5; }
    return clamp01(steps + shots * 1.5);
  }
  // armour: a class-6 suit over everything, resolved like any armour (AP gets through, ball does not), except the
  // lens (top 12 % of the capsule, from the front): x3 and straight through
  armorPieces() { return this.pieces; }
  damage(amount, info = {}) {
    if (!this.alive) return false;
    const pt = info.point;
    if (pt && info.kind !== 'blast' && pt.y > this.position.y + this.height * 0.88) {
      _v.set(pt.x - this.position.x, 0, pt.z - this.position.z).normalize();
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (_v.x * fx + _v.z * fz > 0.25) { this.lensHit = 1; return super.damage(amount * 3, info); }
    }
    if (info.kind === 'blast') return super.damage(amount * 0.5, info);
    if (info.kind === 'melee' || info.kind === 'slash') return super.damage(amount * 0.2, info);
    // zone from the capsule; the shot's own ammunition when ballistics passes it, a rifle-class guess otherwise
    const v2 = info.h01 != null;
    const h01 = v2 ? info.h01 : pt ? clamp01((pt.y - this.position.y) / this.height) : 0.6;
    const zone = info.zone || zoneFromHit(h01, info.lateral01 ?? 0.3);
    const given = info.ammo ? (typeof info.ammo === 'string' ? AMMO[info.ammo] : info.ammo) : null;
    const headMult = !v2 && info.headshot ? 1.8 : 1;
    let a, mult = 1;
    if (given) { a = given; mult = amount > 0 && given.damage > 0 ? amount / (given.damage * headMult) : 1; }
    else a = { damage: amount / headMult, pen: info.pen ?? 3, kind: 'fmj' };
    const r = resolveHit(a, zone, this.pieces, { mult });
    if (r.armorHit && r.armorHit.inst) r.armorHit.inst.durability = Math.max(0, (r.armorHit.inst.durability ?? SUIT_DEF.durability) - r.armorDamage);
    this.stoppedHit = !r.penetrated;
    if (!r.penetrated) { this.sound('armor_hit', { gain: 0.9, max: 80, rate: 0.8 }); if (pt) { _v2.copy(info.dir || _dir.set(0, 0, 1)).negate(); this.ctx.vfx.spark?.(pt, _v2, 8, [1.0, 0.8, 0.5]); } }
    return super.damage(r.damage, info);
  }
  onSpotted() {
    this.sound('seeker_spot', { gain: 1.0, max: 120, ref: 6 });
    this.humLoop?.set?.('intensity', 1); this.humT = 1.5;
    if (this.inBeam && !this.flashed) { this.flashed = true; this.ctx.post.flash(0.25); }
    this.cooldown = 2.2; this.setState('engage'); this.alertPack();   // the tell: light, hiss, hum, then the gun
    this.callSquad();
  }
  // it does not fight alone: the nearest squad within 150 m is told where you are
  callSquad() {
    const sq = this.ctx.squads; if (!sq) return;
    const s = sq.nearest(this.position, 150, (s) => s.alive > 0);
    if (!s) return;
    s.know(this.player.position, this.time); if (!s.inCombat) s.enterCombat(); s.converge(); s.radioT = 0.3;
    this.calledSquad = true; this.sound('mimic_radio', { gain: 0.8, max: 100, rate: 0.7 });
  }
  onHit(amount) {
    if (!this.stoppedHit) this.sound(amount > 60 ? 'seeker_hiss' : 'mimic_hit', { gain: 0.7 });
    this.stoppedHit = false;
    this.rig.flinch = 0.6; this.staggerT = 0.12;
    this.ember = 2.4;                                   // the suit dumps heat when it is hit
    if (this.lensHit) { this.lensHit = 0; this.flicker = 0.1; this.rig.startGlitch(1.2); this.glitchLeft = 0.1; }
  }
  onDeath() {
    this.sound('seeker_death', { gain: 1.0, max: 200, ref: 8 });
    this.sound('seeker_hiss', { gain: 0.9, rate: 0.7 });
    this.target = null;
  }
  deathTick(dt) {
    const t = this.deathT, rig = this.rig, Bn = rig.B, s = SCALE;
    // hydraulic collapse: knees give in two stages, torso slumps forward, head hangs
    const f1 = clamp01(t / 0.7), f2 = clamp01((t - 0.5) / 0.9);
    const e1 = 1 - Math.pow(1 - f1, 2), e2 = 1 - Math.pow(1 - f2, 3);
    Bn.thL.rotation.x = 0.55 * e1 + 0.5 * e2; Bn.thR.rotation.x = 0.7 * e1 + 0.3 * e2;
    Bn.snL.rotation.x = -(1.3 * e1 + 0.7 * e2); Bn.snR.rotation.x = -(1.5 * e1 + 0.5 * e2);
    // (a torso bone points up, so -x is the forward slump)
    Bn.hips.position.y = rig.rest.hips.y - (0.45 * e1 + 0.30 * e2) * s; Bn.hips.rotation.x = -(0.2 * e1 + 0.25 * e2); Bn.hips.rotation.z = 0.12 * e2;
    Bn.spine.rotation.x = -0.35 * e2; Bn.chest.rotation.x = -0.4 * e2; Bn.neck.rotation.x = -0.5 * e2; Bn.head.rotation.x = -0.4 * e2; Bn.head.rotation.y = 0.3 * e1;
    Bn.gun.rotation.x = -0.42 - 0.6 * e2; Bn.gun.position.y = rig.gunRest.y - 0.2 * s * e2; Bn.gun.updateMatrix();
    rig.solveArm(Bn.shL, Bn.foL, rig.shPosL, _v.copy(rig.gripL).applyMatrix4(Bn.gun.matrix), -1);
    rig.solveArm(Bn.shR, Bn.foR, rig.shPosR, _v.copy(rig.gripR).applyMatrix4(Bn.gun.matrix), 1);
    // the light dies with a flicker
    const fl = t < 1.1 ? (Math.sin(t * 47 + this.deathFlickerSeed) > (t / 1.1) * 1.6 - 0.6 ? 1 : 0.05) * (1 - t / 1.3) : 0;
    this.setLight(fl);
    const u = this.mat.userData.u;
    u.uTime.value = this.time;
    u.uEmberK.value = 1 + 2.5 * clamp01(1 - t / 1.4);   // the joints run away with it as the suit dies
    this.cone.material.uniforms.uTime.value = this.time;
    if (t >= 1.6) {
      if (!this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.9, this.position.z), 190); for (const m of this.meshes) m.castShadow = false; this.setLight(0); }
      const dv = clamp01((t - 1.6) / 1.6);
      u.uDissolve.value = dv;
      u.uShiver.value = 1 + dv * 2;
      u.uEmberK.value = 3.4 * (1 - dv);
    }
    // what the suit leaves behind: the belt box, a barrel, an armour kit, sometimes the Crown
    if (t >= 3.1 && !this.piled) {
      this.piled = true;
      const drops = [];
      const box = this.weapon.mag && this.weapon.mag.rounds > 0 ? this.weapon.mag : (this.loadout.boxes[0] || null);
      if (box) drops.push({ kind: 'mag', inst: box, id: box.id, count: 1 });
      for (const id of SEEKER.drops || []) {
        if (id === box?.id) continue;
        if (id === 'art_crown') { if (Math.random() < 0.2) drops.push({ kind: 'item', id, count: 1 }); continue; }
        if (ITEMS[id]) drops.push({ kind: 'item', id, count: 1 });
      }
      this.drops = drops;
      if (this.ctx.loot?.spawnPile) { try { this.ctx.loot.spawnPile(_v.set(this.position.x, this.groundY, this.position.z).clone(), drops); } catch (e) { console.warn('loot.spawnPile failed', e); } }
    }
  }
  onDispose() { this.rig.dispose(); this.lensMat.dispose(); this.haloMat.dispose(); this.cone.material.dispose(); }
  // intensity only: toggling a light's visibility changes the scene's light count and makes three recompile
  // every material in view, so the lamp stays in the light list at zero while it is dark
  setLight(level) {
    this.light.intensity = 46 * level;
    this.cone.material.uniforms.uIntensity.value = 0.8 * level;
    this.cone.visible = level > 0.01;
    this.lensMat.color.setRGB(0.4 + 2.8 * level, 0.35 + 2.55 * level, 0.25 + 1.95 * level);
    this.haloMat.opacity = 0.10 + 0.42 * level;
    this.halo.scale.setScalar((0.26 + 0.24 * level) * SCALE);
  }
  alertPack() {
    for (const e of this.ctx.enemies.list) {
      if (e === this || !e.alive || (e.type !== 'mimic' && e.type !== 'seeker')) continue;
      if (e.position.distanceTo(this.position) > 40) continue;
      if (e.aware < 0.6) e.aware = 0.6;
      if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3(); e.lastSeenPlayer.copy(this.player.position); e.lastSeenT = this.time;
    }
  }
  faceAngleTo(x, z) { return angleDelta(this.yaw, Math.atan2(-(x - this.position.x), -(z - this.position.z))); }
  // is the player inside the beam (axis from the lens, angle + a little penumbra) with a line of sight?
  beamTest() {
    const p = this.player; if (p.dead || p.inBase) return false;
    this.syncRoot();
    this.lens.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(this.lens.matrixWorld);
    _axis.set(-this.lens.matrixWorld.elements[8], -this.lens.matrixWorld.elements[9], -this.lens.matrixWorld.elements[10]).normalize();
    _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.6, p.position.z);
    _dir.subVectors(_v2, _v); const d = _dir.length(); if (d > 60 || d < 0.5) return false; _dir.divideScalar(d);
    if (_dir.dot(_axis) < Math.cos(0.25 + 0.06)) return false;
    return this.ctx.world.lineOfSight(_v, _v2);
  }
  fireOne(muzzle, dist) {
    const p = this.player, ctx = this.ctx;
    _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.6, p.position.z);
    _dir.subVectors(_v3, muzzle).normalize();
    // a heavy gun walked onto you: full-power rifle rounds, but a wide, climbing cone; few of a burst land
    const spread = 9 + this.burstN * 0.25 + (this.moveSpeed > 0.4 ? 3 : 0) + (p.moving ? 1.5 : 0);
    const ammo = this.ammo;
    if (ctx.ballistics && !ctx.ballistics.isStub) ctx.ballistics.shoot(muzzle, _dir, { source: 'enemy', damage: ammo.damage, ammo, ammoId: this.ammoId, shooter: this, spreadDeg: spread, pellets: 1, range: 90, cls: 'mg', kind: 'bullet', weapon: this.weapon, what: 'Seeker' });
    else enemyShoot(ctx, this, muzzle, _dir, ammo.damage, spread);
    consumeRound(this.weapon);
    this.burstN++;
    ctx.vfx.muzzleFlash(muzzle, _dir);
    playAny(ctx, this.shotNames, { pos: muzzle, gain: 1.0, max: 300, ref: 6 });
    this.rig.kick = 1;
    if (dist < 25) ctx.post.shake(0.06);
  }
  // the box is empty: a long, loud change (5 s) in which the gun is down and the light droops
  beginReload() {
    const spare = this.loadout.boxes.find((b) => b.rounds > 0);
    if (!spare) { this.dry = true; return false; }
    this.reloading = true; this.reloadT = 0; this.burstLeft = 0; this.reloadBox = spare;
    return true;
  }
  reloadTick(dt) {
    const t0 = this.reloadT; this.reloadT += dt; const t = this.reloadT;
    const at = (x) => t0 < x && t >= x;
    if (at(0.1)) { this.sound('reload_magout', { gain: 0.9, max: 70, rate: 0.6 }); this.sound('seeker_hiss', { gain: 0.5 }); }
    if (at(1.4) || at(2.2) || at(2.9)) this.sound('mag_load_round', { gain: 0.7, max: 60, rate: 0.7 });
    if (at(3.6)) this.sound('reload_magin', { gain: 0.9, max: 70, rate: 0.6 });
    if (at(4.4)) this.sound('bolt_open', { gain: 0.8, max: 60, rate: 0.7 });
    if (at(4.8)) this.sound('bolt_close', { gain: 0.8, max: 60, rate: 0.7 });
    if (t >= 5.0) {
      const w = this.weapon, old = w.mag;
      const i = this.loadout.boxes.indexOf(this.reloadBox); if (i >= 0) this.loadout.boxes.splice(i, 1);
      if (old) this.loadout.boxes.push(old);
      w.mag = this.reloadBox; w.chamber = w.mag.ammo; this.reloadBox = null; this.reloading = false; this.cooldown = 1.0; this.burstN = 0;
    }
  }
  syncRoot() { this.root.position.copy(this.position); this.root.rotation.y = this.yaw; }

  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time;
    this.followGround(dt);
    const d = this.distanceToPlayer();
    // perception: the beam is the eye. outside it the seeker is slow to notice you.
    // flashbang: the lamp swings down, the gun stops, it stands
    if (this.stunned > 0) {
      this.stunned -= dt; this.aware = 0; this.engaged = false; this.burstLeft = 0; this.inBeam = false;
      this.animate(dt, d, { headYaw: Math.sin(t * 5) * 0.6, headPitch: -0.5, speed: 0 });
      return;
    }
    // smoke between the lens and the player hides them from the beam and the eyes
    const smoked = ctx.world.smokeBlocks && ctx.world.smoke && ctx.world.smoke.length && ctx.world.smokeBlocks(this.eyePos(_v), p.eye);
    this.inBeam = !smoked && this.beamTest();
    const { vis } = smoked ? { vis: 0 } : this.perceive(dt, { fov: 110, maxDay: 60, visGain: 0.7, hearGain: 1.0, decay: 0.06 });
    if (this.inBeam) { this.aware = clamp01(this.aware + dt * 2.2); if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(p.position); this.lastSeenT = t; this.lastVisT = t; if (this.aware >= 1 && !this.engaged) { this.engaged = true; ctx.director?.notify('spotted', { enemy: this }); this.onSpotted(); } }
    else if (vis > 0.05) this.lastVisT = t;
    if (!this.engaged) this.flashed = false;
    this.staggerT = Math.max(0, this.staggerT - dt);
    const prevX = this.position.x, prevZ = this.position.z;
    let headYaw = 0, headPitch = 0, aim = 0, aimPitch = 0, aimYaw = 0;
    if (this.engaged && t - this.lastVisT < 8 && this.state !== 'engage') this.setState('engage');
    else if (!this.engaged && this.aware >= 0.45 && (this.state === 'patrol' || this.state === 'watch')) { this.setState('search'); this.target = this.lastSeenPlayer ? this.lastSeenPlayer.clone() : null; this.waitT = 0; this.sound('seeker_hiss', { gain: 0.6 }); }

    switch (this.state) {
      case 'watch': {
        this.waitT -= dt;
        headYaw = this.sweep(dt, 40 * DEG, 0.55);
        if (this.waitT <= 0) { this.setState('patrol'); this.target = null; }
        break;
      }
      case 'patrol': {
        if (!this.target) { this.target = ctx.world.randomPoint(rng, this.home.x, this.home.z, this.poiR) || this.home.clone(); }
        if (this.staggerT <= 0) { const rem = this.moveToward(this.target, 1.2, dt, { stop: 1.0, turnRate: 2.2 }); if (rem <= 1.0 || this.stateT > 60) { this.target = null; this.setState('watch'); this.waitT = rng.range(4, 10); } }
        headYaw = this.sweep(dt, 40 * DEG, 0.45);
        break;
      }
      case 'search': {
        if (this.engaged && t - this.lastVisT < 1) { this.setState('engage'); break; }
        if (this.target) { const rem = this.staggerT > 0 ? 99 : this.moveToward(this.target, 1.2, dt, { stop: 2.5, turnRate: 2.2 }); if (rem <= 2.5) { this.target = null; this.waitT = 0; } headYaw = this.sweep(dt, 30 * DEG, 0.9); }
        else { this.waitT += dt; headYaw = this.sweep(dt, 60 * DEG, 0.8); if (this.waitT > 7) { if (this.aware < 0.4) { this.setState('patrol'); this.target = null; } else { const ls = this.lastSeenPlayer || this.home; this.target = ctx.world.randomPoint(rng, ls.x, ls.z, 10) || null; this.waitT = 0; } } }
        if (this.aware < 0.2 && this.stateT > 15) { this.setState('patrol'); this.target = null; }
        break;
      }
      case 'engage': {
        aim = 1;
        if (t - this.lastVisT > 8 || !this.engaged) { this.setState('search'); this.target = this.lastSeenPlayer ? this.lastSeenPlayer.clone() : null; this.waitT = 0; break; }
        if (t - this.lastAlertT > 3) { this.lastAlertT = t; this.alertPack(); }
        // relentless: advance on the player, body squared to them, light locked on
        if (this.staggerT <= 0 && d > 6) this.moveToward(p.position, 1.2, dt, { stop: 6, face: false, allowWater: true });
        this.faceToward(p.position.x, p.position.z, dt, 2.6);
        headYaw = this.faceAngleTo(p.position.x, p.position.z);
        headPitch = Math.atan2(p.eye.y - (this.position.y + 1.7 * SCALE), Math.max(1, d));
        aimPitch = Math.atan2(p.eye.y - 0.3 - (this.position.y + 1.5 * SCALE), Math.max(1, d));
        aimYaw = headYaw;
        if (!this.calledSquad && this.stateT > 1) this.callSquad();
        if (this.reloading) { aim = 0.25; this.reloadTick(dt); }
        else if (roundsInGun(this.weapon) === 0 && !this.dry) { this.beginReload(); }
        else if (!p.dead && d < 70 && this.staggerT <= 0 && !this.dry) {
          if (this.burstLeft > 0) {
            this.shotT -= dt;
            if (this.shotT <= 0) {
              this.syncRoot(); this.rig.muzzleWorld(_v3);
              _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.6, p.position.z);
              if (ctx.world.lineOfSight(_v3, _v2) && Math.abs(headYaw) < 0.6) { this.fireOne(_v3, d); this.burstLeft--; this.shotT = Math.max(0.075, 60 / (this.wdef.rpm || 650)); if (roundsInGun(this.weapon) === 0) this.burstLeft = 0; }
              else this.burstLeft = 0;
              if (this.burstLeft === 0) this.cooldown = rng.range(2.0, 3.5);
            }
          } else { this.cooldown -= dt; if (this.cooldown <= 0 && (this.inBeam || vis > 0.05)) { this.burstLeft = rng.int(6, 12); this.burstN = 0; this.shotT = 0; } }
        }
        break;
      }
    }
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.moveSpeed = damp(this.moveSpeed, dt > 0 ? mv / dt : 0, 8, dt);
    // hydraulics + hum
    this.hissT -= dt; if (this.hissT <= 0) { this.hissT = rng.range(4, 9); if (d < 90) this.sound('seeker_hiss', { gain: 0.5 + 0.3 * clamp01(this.moveSpeed), max: 90 }); }
    if (!this.humLoop) { this.loopRetry -= dt; if (this.loopRetry <= 0) { this.loopRetry = 1; if (ctx.audio.ready) this.humLoop = this.loopSound('seeker_hum', { gain: 0.3, max: 120, ref: 6 }); } }
    if (this.humLoop) {
      this.humLoop.setGain((0.3 + 0.6 * clamp01(this.aware)) * clamp01(1 - d / 110), 0.3);
      // the hum rises when the beam has you; the loop's 'intensity' setter is a smoothed target, so a few Hz is plenty
      this.humT -= dt; if (this.humT <= 0) { this.humT = 0.25; this.humLoop.set('intensity', clamp01(0.25 + 0.45 * this.aware + (this.inBeam ? 0.5 : 0))); }
    }
    // the light finding you: a sustained glare while you stand in the beam looking into the lamp
    if (this.inBeam && !p.dead) {
      _dir.set(this.position.x - p.eye.x, this.position.y + 1.7 * SCALE - p.eye.y, this.position.z - p.eye.z).normalize();
      const facing = clamp01((_dir.dot(ctx.player.forward) - 0.3) / 0.7);
      this.beamHold = damp(this.beamHold, facing, 4, dt);
      if (this.beamHold > 0.02) ctx.post.flash(0.04 + 0.16 * this.beamHold * clamp01(1.2 - d / 40));
    } else this.beamHold = damp(this.beamHold, 0, 4, dt);
    this.animate(dt, d, { headYaw, headPitch, aim, aimPitch, aimYaw, speed: this.moveSpeed });
  }
  // slow sweep of the head/searchlight: +-range, rate in rad/s, with pauses at the ends
  sweep(dt, range, rate) {
    this.sweepT += dt * rate;
    const s = Math.sin(this.sweepT);
    return range * Math.sign(s) * Math.pow(Math.abs(s), 0.7);
  }
  // the rim light is the sky reflected off a wet shoulder, and it is what separates a dark mass from a
  // birch trunk at forty metres. Shared across every seeker, refreshed once a frame.
  refreshRim() {
    const ctx = this.ctx, t = ctx.elapsed;
    if (t === this.rimT) return;
    this.rimT = t;
    const L = ctx.lighting; if (!L || !L.horizon || !L.zenith) return;
    const h = L.horizon, z = L.zenith, c = RIM.uRimCol.value;
    c.setRGB(h.r * 0.55 + z.r * 0.45, h.g * 0.55 + z.g * 0.45, h.b * 0.55 + z.b * 0.45);
    c.multiplyScalar(0.60 * (1 - (ctx.time ? ctx.time.night : 0) * 0.55));
  }
  animate(dt, d, c) {
    const rig = this.rig, ctx = this.ctx, t = this.time, Bn = rig.B;
    if (this.glitchLeft > 0) { this.glitchLeft -= dt; if (this.glitchLeft <= 0) rig.glitchOn = false; }
    else { this.glitchT -= dt; if (this.glitchT <= 0) { this.glitchT = rng.range(3, 7); this.glitchLeft = 0.06; rig.startGlitch(0.7); } }
    rig.pose({ dt, speed: c.speed || 0, stride: 1.9, aim: c.aim || 0, aimPitch: c.aimPitch || 0, aimYaw: c.aimYaw || 0, headYaw: c.headYaw || 0, headPitch: c.headPitch || 0, headRate: 1.9, chestYaw: clamp((c.headYaw || 0) * 0.3, -0.35, 0.35), lean: 0.21 });
    // a powered suit carries its mass forward and low: the back hunches, the dome cranes up out of it, and
    // the whole thing rolls a little as it walks. Nothing here fights the poser; it is added after it.
    Bn.spine.rotation.x -= 0.15;
    Bn.chest.rotation.x -= 0.07;
    Bn.neck.rotation.x += 0.30;
    Bn.head.rotation.x += 0.16;
    Bn.hips.rotation.z += Math.sin(rig.phase) * 0.035 * rig.gait;
    if (rig.stepFlag) {
      if (d < 90) this.sound('seeker_step', { gain: 0.6 + 0.4 * clamp01(1 - d / 40), max: 90, ref: 5, rate: 0.9 + Math.random() * 0.15 });
      if (d < 12) ctx.post.shake(0.15 * (1 - d / 12) + 0.03);
    }
    // light: flicker recovers after a lens hit; the beam breathes very slightly
    this.flicker = damp(this.flicker, 1, 3, dt);
    const breathe = 0.94 + 0.06 * Math.sin(t * 2.1) + (Math.sin(t * 37.0) > 0.97 ? -0.08 : 0);
    this.setLight(this.flicker * breathe * (this.reloading ? 0.3 : 1));
    this.cone.material.uniforms.uTime.value = t;
    const u = this.mat.userData.u;
    u.uTime.value = t;
    u.uShiver.value = 1 + rig.flinch * 1.5;
    this.ember = damp(this.ember, 0.85 + 0.9 * clamp01(this.aware), 1.6, dt);
    u.uEmberK.value = this.ember;
    this.refreshRim();
  }
}

export function registerSeeker(ctx) {
  rng = ctx.rng.fork(37);
  ctx.enemies.registerType('seeker', Seeker);
}
