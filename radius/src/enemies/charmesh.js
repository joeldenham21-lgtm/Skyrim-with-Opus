// Characters. The mimic is a human-shaped absence (DESIGN §6): matte black, featureless, edges shivering, a
// smeared white blot for a face. That only works if the SHAPE is unmistakably a man — the moment it reads as a
// stack of boxes the horror turns into a placeholder. So this file builds people, from the skeleton out:
//
//   proportion   Drillis & Contini stature fractions, on a 1.92 m frame at unit scale: ankle 0.039H, knee 0.276H,
//                hip joint 0.521H, shoulder joint 0.810H, elbow 0.635H, wrist 0.492H, chin 0.865H, crown 1.0H.
//                The old rig had the hip joint at 0.479H and the knee at 0.245H — a long torso on short legs,
//                which is the single loudest "procedural human" tell there is.
//   silhouette   lofted, not boxed: an elliptical torso that narrows at the waist and swells at the chest, a
//                deltoid cap that makes the shoulder read, tapered limbs with an elbow and a calf, a jacket hem
//                that breaks over the hips, trousers that bunch above the boot, a boot with a sole and a toe.
//   variety      six builds (lean / regular / broad / heavy / wiry / stocky) x three head coverings (bare, hood,
//                field cap) x two coat lengths. A patrol of four is four different men.
//   skinning     two bones per vertex with a real blend across every joint, so an elbow bends instead of
//                shearing. Feet get their own bone and stay flat on the ground through the stride.
//
// Contract (enemies/mimic.js drives it; slider/spawn/seeker keep their own meshes for now):
//   buildHumanoid({ loadout, height }) -> {
//     root, bones{ hips spine chest neck head shL shR foL foR thL thR snL snR ftL ftR gun, handR }, material,
//     rig (the poser: stepFlag, flinch, kick, glitchOn, startGlitch(), muzzle, B, pose()),
//     attach(gunGroup|null), wear(vestId, helmetId, packId), setState(s), update(dt), dispose() }
//   The returned object has no `stub` flag, which is how mimic.js knows to use it.
//
// Cost: ~2.0 k triangles and ONE draw call per body (the old box rig was 380 triangles in one call). Geometry is
// built once per variant and shared; only the skeleton and the material are per actor, so twenty mimics in the
// same build cost twenty skeletons and one buffer.
import * as THREE from 'three';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { ARMOR } from '../data/index.js';
import { buildVest, buildHelmet, buildPack, buildRig, buildMask, buildHeadgear } from './gearmesh.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
function dampAngle(a, b, r, dt) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * (1 - Math.exp(-r * dt)); }
function h3(a, b, c) {
  let n = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177 | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const _m4 = new THREE.Matrix4(), _c = new THREE.Color(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _pole = new THREE.Vector3(), _axis = new THREE.Vector3();
const _upper = new THREE.Vector3(), _elbow = new THREE.Vector3(), _fore = new THREE.Vector3(), _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

const ctxOf = () => (typeof globalThis !== 'undefined' && globalThis.__radius && globalThis.__radius.ctx) || null;

// =====================================================================================================
// Material. One program, one instance per actor (the death dissolve and the shiver level are per actor, so the
// uniforms cannot be shared). Colour rides in the vertex colour attribute; aSurf is (roughness, metalness,
// shiver mask, sheen). The rim uniforms ARE shared — every body catches the same sky.
// =====================================================================================================
const SHARED = { uRim: { value: 1 }, uRimCol: { value: new THREE.Color(0.16, 0.18, 0.21) } };
let skyT = -1;
function refreshSky(elapsed) {
  if (elapsed === skyT) return;
  skyT = elapsed;
  const ctx = ctxOf(); if (!ctx || !ctx.lighting) return;
  const h = ctx.lighting.horizon, z = ctx.lighting.zenith;
  if (!h || !z) return;
  // the rim is the sky reflected off a wet shoulder: mostly horizon, a little zenith, and it dies at night
  const c = SHARED.uRimCol.value;
  c.setRGB(h.r * 0.55 + z.r * 0.45, h.g * 0.55 + z.g * 0.45, h.b * 0.55 + z.b * 0.45);
  const night = ctx.time ? ctx.time.night : 0;
  const k = 0.72 * (1 - night * 0.55);
  c.multiplyScalar(k);
}

const CHAR_VERT = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf;
attribute vec4 aSurf; attribute float aPhase; attribute vec3 aJit;
uniform float uTime, uShiver, uSeed;`;
const CHAR_FRAG = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf;
uniform float uDissolve, uGrime, uRim; uniform vec3 uRimCol, uDust;`;

function charCompile(shader) {
  const u = this.userData.u;
  for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
  for (const k in u) shader.uniforms[k] = u[k];
  shader.uniforms.uRim = SHARED.uRim;
  shader.uniforms.uRimCol = SHARED.uRimCol;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${CHAR_VERT}`)
    .replace('#include <skinning_vertex>', /* glsl */`#include <skinning_vertex>
      {
        float ph = aPhase * 61.7 + uSeed;
        float slot = floor(uTime * 20.0 + aPhase * 5.0);
        float n1 = hash11(slot + ph) - 0.5;
        float n2 = hash11(slot * 1.31 + ph * 0.7 + 3.1) - 0.5;
        float spike = step(0.945, hash11(slot * 0.11 + ph * 3.3));
        float amp = uShiver * (0.016 + spike * 0.050) * vSurfShiver;
        transformed += (objectNormal * n1 * 0.7 + aJit * n2) * amp;
      }
      vCPos = transformed;
      vCN = objectNormal;
      vWN = normalize(mat3(modelMatrix) * objectNormal);`)
    // aSurf has to be read before the shiver block uses its mask
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSurf = aSurf;\n  float vSurfShiver = aSurf.z;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${CHAR_FRAG}`)
    .replace('#include <clipping_planes_fragment>', /* glsl */`#include <clipping_planes_fragment>
      float dsv = 0.0;
      if (uDissolve > 0.0) {
        float dn = fbm3d(vCPos * 4.0);
        float th = uDissolve * 1.15 - 0.05;
        if (dn < th) discard;
        dsv = smoothstep(th + 0.07, th, dn);
      }`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      {
        // cloth is never one value: a low-frequency mottle, dust settling on what faces the sky, and a wet
        // sheen along the shoulders and the top of the pack
        float n1 = vnoise3(vCPos * 9.0);
        float n2 = vnoise3(vCPos * 31.0);
        diffuseColor.rgb *= 0.80 + 0.45 * n1 + 0.12 * n2;
        float up = clamp(vCN.y, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDust, up * up * 0.16 * uGrime * (0.35 + 0.65 * n1));
        float mud = smoothstep(0.34, -0.06, vCPos.y) * uGrime;      // everything below the knee is wet
        diffuseColor.rgb = mix(diffuseColor.rgb, uDust * 0.55, mud * 0.30 * (0.4 + 0.6 * n2));
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.29, 0.28), dsv);`)
    .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      roughnessFactor = clamp(vSurf.x + (vnoise3(vCPos * 44.0) - 0.5) * 0.13 - vSurf.w * 0.18, 0.05, 1.0);`)
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vSurf.y;')
    .replace('#include <opaque_fragment>', /* glsl */`#include <opaque_fragment>
      {
        // Sky rim. On an overcast day the whole dome is the key light, so a matte black shape still carries a
        // pale edge — and that edge is the only thing separating a mimic from a birch trunk at forty metres.
        float fres = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float dist = length(vViewPosition);
        float k = pow(fres, 2.4) * smoothstep(2.5, 12.0, dist) * (0.40 + 0.60 * clamp(vWN.y * 0.55 + 0.55, 0.0, 1.0));
        gl_FragColor.rgb += uRimCol * (k * uRim * (1.0 - dsv));
      }`);
}

export function makeCharMaterial(o = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.userData.u = {
    uTime: { value: 0 }, uShiver: { value: o.shiver ?? 1 }, uDissolve: { value: 0 },
    uSeed: { value: Math.random() * 100 }, uGrime: { value: o.grime ?? 1 },
    uDust: { value: new THREE.Color(0x6a6656) },
  };
  mat.onBeforeCompile = charCompile;
  mat.customProgramCacheKey = () => 'radius-char';
  return mat;
}
// Global dial: 0 kills the sky rim, 1 is the tuned value.
export function setCharRim(v) { SHARED.uRim.value = Math.max(0, v); }

// =====================================================================================================
// Geometry builder. Triangles go into one soup carrying colour, surface and two-bone skin weights; the soup
// becomes one creased-normal, indexed BufferGeometry. Nothing here runs per frame.
// =====================================================================================================
// surfaces: [roughness, metalness, shiverMask, sheen]
const SF = {
  cloth: [0.97, 0.00, 1.00, 0.00],
  coat: [0.93, 0.00, 1.00, 0.06],
  wool: [0.99, 0.00, 1.00, 0.00],
  leather: [0.66, 0.02, 0.70, 0.26],
  rubber: [0.78, 0.02, 0.45, 0.16],
  skin: [0.82, 0.00, 1.10, 0.10],
  hard: [0.55, 0.10, 0.35, 0.30],
};
// the mimic is an absence: everything is within a whisker of black, and the form is carried by roughness
const COL = {
  cloth: 0x0a0a0b,
  clothB: 0x0d0d0e,
  coat: 0x090a09,
  wool: 0x0c0c0d,
  glove: 0x070708,
  boot: 0x060607,
  sole: 0x0b0b0c,
  skin: 0x0e0e10,
  hard: 0x101012,
};

class Skin {
  constructor() { this.p = []; this.col = []; this.srf = []; this.si = []; this.sw = []; this.c = [0.04, 0.04, 0.042]; this.s = SF.cloth; }
  tint(hex, surf) { _c.setHex(hex); this.c = [_c.r, _c.g, _c.b]; if (surf) this.s = surf; return this; }
  vert(v) {
    this.p.push(v[0], v[1], v[2]);
    this.col.push(this.c[0], this.c[1], this.c[2]);
    this.srf.push(this.s[0], this.s[1], this.s[2], this.s[3]);
    const w = v[5] || 0;
    this.si.push(v[3] | 0, (v[4] === undefined ? v[3] : v[4]) | 0, 0, 0);
    this.sw.push(1 - w, w, 0, 0);
  }
  tri(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;             // collapsed: a pole fan or a zero-width cap
    this.vert(a); this.vert(b); this.vert(c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get tris() { return this.p.length / 9; }
  // Weld, crease and index in one pass over flat arrays. three's toCreasedNormals + mergeVertices do the same
  // job through BufferAttribute accessors and string hashes and cost 170 ms a body, which is a dropped frame
  // every time a new build type spawns; this is the same result in about a tenth of the time.
  finish(scale = 1, creaseCos = 0.5) {
    const p = this.p, N = p.length / 3;
    if (!N) return null;
    const tris = N / 3;
    const fx = new Float32Array(tris), fy = new Float32Array(tris), fz = new Float32Array(tris);
    for (let t = 0; t < tris; t++) {
      const i = t * 9;
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fx[t] = nx / l; fy[t] = ny / l; fz[t] = nz / l;
    }
    // buckets of coincident vertices, keyed on the millimetre. Numeric keys: three 12-bit fields in a double.
    const buckets = new Map(), bkey = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const qx = Math.round(p[i * 3] * 1000) + 2048, qy = Math.round(p[i * 3 + 1] * 1000) + 2048, qz = Math.round(p[i * 3 + 2] * 1000) + 2048;
      const k = (qx * 4096 + qy) * 4096 + qz;
      bkey[i] = k;
      const b = buckets.get(k);
      if (b) b.push(i); else buckets.set(k, [i]);
    }
    // crease: a vertex takes the average of the faces at its position that are within the crease angle of its own
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
    // index: inside a bucket, merge vertices that agree on normal, colour, surface and bones
    const col = this.col, srf = this.srf, si = this.si, sw = this.sw;
    const oP = [], oN = [], oC = [], oS = [], oI = [], oW = [], index = new Uint32Array(N);
    const seen = new Map();
    for (let i = 0; i < N; i++) {
      const k = bkey[i];
      let list = seen.get(k);
      if (!list) { list = []; seen.set(k, list); }
      let hit = -1;
      for (let a = 0; a < list.length; a += 2) {          // the bucket holds [outIdx, srcIdx] pairs
        const oi = list[a], src = list[a + 1];
        if (nrm[i * 3] * nrm[src * 3] + nrm[i * 3 + 1] * nrm[src * 3 + 1] + nrm[i * 3 + 2] * nrm[src * 3 + 2] < 0.9995) continue;
        if (col[i * 3] !== col[src * 3] || col[i * 3 + 1] !== col[src * 3 + 1] || col[i * 3 + 2] !== col[src * 3 + 2]) continue;
        if (srf[i * 4] !== srf[src * 4] || srf[i * 4 + 1] !== srf[src * 4 + 1] || srf[i * 4 + 2] !== srf[src * 4 + 2] || srf[i * 4 + 3] !== srf[src * 4 + 3]) continue;
        if (si[i * 4] !== si[src * 4] || si[i * 4 + 1] !== si[src * 4 + 1] || sw[i * 4] !== sw[src * 4]) continue;
        hit = oi; break;
      }
      if (hit < 0) {
        hit = oP.length / 3;
        oP.push(p[i * 3] * scale, p[i * 3 + 1] * scale, p[i * 3 + 2] * scale);
        oN.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
        oC.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
        oS.push(srf[i * 4], srf[i * 4 + 1], srf[i * 4 + 2], srf[i * 4 + 3]);
        oI.push(si[i * 4], si[i * 4 + 1], 0, 0);
        oW.push(sw[i * 4], sw[i * 4 + 1], 0, 0);
        list.push(hit, i);
      }
      index[i] = hit;
    }
    const M = oP.length / 3;
    const phase = new Float32Array(M), jdir = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      const kx = Math.round(oP[i * 3] * 1000) + 7, ky = Math.round(oP[i * 3 + 1] * 1000) + 3, kz = Math.round(oP[i * 3 + 2] * 1000) + 11;
      const a = h3(kx, ky, kz), b = h3(ky, kz, kx), c = h3(kz, kx, ky);
      phase[i] = a;
      const jx = b - 0.5, jy = c - 0.5, jz = a - 0.5, jl = Math.hypot(jx, jy, jz) || 1;
      jdir[i * 3] = jx / jl; jdir[i * 3 + 1] = jy / jl; jdir[i * 3 + 2] = jz / jl;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(oP, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(oN, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(oC, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(oS, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(oI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(oW, 4));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aJit', new THREE.BufferAttribute(jdir, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    this.p.length = 0; this.col.length = 0; this.srf.length = 0; this.si.length = 0; this.sw.length = 0;
    return g;
  }
}

// ---------------------------------------------------------------- rings and lofts
// A horizontal ring: angle 0 faces front (-z), positive toward +x. `pow` above 2 squares the section off, which
// is what a padded torso and a boot do and a cylinder does not. rzF/rzB let the back be flatter than the chest.
function ringY(y, rx, rzF, rzB, o = {}) {
  const { seg = 14, pow = 2.2, cx = 0, cz = 0, b0 = 0, b1 = b0, w = 0, jit = 0, seed = 1 } = o;
  const k = 2 / pow, out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU, sa = Math.sin(a), ca = Math.cos(a);
    const sx = sa === 0 ? 0 : Math.sign(sa) * Math.pow(Math.abs(sa), k);
    const cp = ca === 0 ? 0 : Math.sign(ca) * Math.pow(Math.abs(ca), k);
    const rz = ca >= 0 ? rzF : rzB;
    const j = jit ? (h3(i * 13 + seed, Math.round(y * 900), 7) - 0.5) * jit : 0;
    out.push([cx + sx * (rx + j), y, cz - cp * (rz + j), b0, b1, w]);
  }
  return out;
}
// A cross-section in the XY plane at depth z: angle 0 is up (+y). Used for feet, which run along -z.
function ringZ(z, rx, ryT, ryB, o = {}) {
  const { seg = 12, pow = 2.6, cx = 0, cy = 0, b0 = 0, b1 = b0, w = 0 } = o;
  const k = 2 / pow, out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU, sa = Math.sin(a), ca = Math.cos(a);
    const sx = sa === 0 ? 0 : Math.sign(sa) * Math.pow(Math.abs(sa), k);
    const cp = ca === 0 ? 0 : Math.sign(ca) * Math.pow(Math.abs(ca), k);
    const ry = ca >= 0 ? ryT : ryB;
    out.push([cx + sx * rx, cy + cp * ry, z, b0, b1, w]);
  }
  return out;
}
// Connect a stack of rings. `flip` reverses the winding for stacks that run along -z instead of +y.
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
function centreOf(ring) {
  let x = 0, y = 0, z = 0;
  for (const v of ring) { x += v[0]; y += v[1]; z += v[2]; }
  const n = ring.length;
  return [x / n, y / n, z / n, ring[0][3], ring[0][4], ring[0][5]];
}
// `outward` true winds the fan so its normal points along the stack direction
function capRing(S, ring, c, outward) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (outward) S.tri(c, b, a); else S.tri(c, a, b);
  }
}

// =====================================================================================================
// Skeleton. Unit space: crown at 1.92 m, then every build scales. Bone rests are the joint centres, so the
// proportion table above is literally what you see. Chest at 1.32 and head at 1.66 are load bearing: worn gear
// (enemies/gearmesh.js) is authored in those two bones' local space.
// =====================================================================================================
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'foL', 'foR', 'thL', 'thR', 'snL', 'snR', 'ftL', 'ftR', 'gun'];
const BI = {}; BONES.forEach((n, i) => { BI[n] = i; });

const Y = {
  hips: 1.030, spine: 1.180, chest: 1.320, neck: 1.560, head: 1.660,
  shoulder: 1.555, elbow: 1.220, wrist: 0.945,
  hip: 1.000, knee: 0.530, ankle: 0.075, crown: 1.920,
};
const L1 = Y.shoulder - Y.elbow;      // 0.335 humerus
const L2 = Y.elbow - Y.wrist;         // 0.275 forearm to the grip
// The rifle at low ready and at the shoulder, chest-bone local.
const GUN_REST = [0.072, -0.010, -0.175];
const GUN_AIM = [0.062, 0.272, -0.150];

// ---------------------------------------------------------------- builds
// sh: shoulder joint half-span. chest/waist/hip: torso half-widths. gut: belly. arm/thigh/calf: limb radii.
const BUILDS = [
  { id: 'lean', s: 0.995, sh: 0.172, chest: 0.183, waist: 0.140, hip: 0.156, gut: 0.00, arm: 0.049, fore: 0.042, thigh: 0.084, calf: 0.058, head: 0.98, slouch: 0.020, neck: 0.056 },
  { id: 'reg', s: 1.000, sh: 0.181, chest: 0.194, waist: 0.152, hip: 0.164, gut: 0.10, arm: 0.054, fore: 0.045, thigh: 0.090, calf: 0.062, head: 1.00, slouch: 0.000, neck: 0.060 },
  { id: 'broad', s: 0.988, sh: 0.197, chest: 0.211, waist: 0.169, hip: 0.176, gut: 0.20, arm: 0.061, fore: 0.050, thigh: 0.097, calf: 0.067, head: 1.02, slouch: -0.014, neck: 0.067 },
  { id: 'heavy', s: 0.968, sh: 0.192, chest: 0.214, waist: 0.194, hip: 0.190, gut: 0.60, arm: 0.063, fore: 0.051, thigh: 0.105, calf: 0.071, head: 1.03, slouch: 0.030, neck: 0.069 },
  { id: 'wiry', s: 1.028, sh: 0.169, chest: 0.176, waist: 0.136, hip: 0.150, gut: 0.00, arm: 0.046, fore: 0.040, thigh: 0.080, calf: 0.056, head: 0.96, slouch: 0.048, neck: 0.053 },
  { id: 'stocky', s: 0.952, sh: 0.187, chest: 0.203, waist: 0.172, hip: 0.180, gut: 0.34, arm: 0.058, fore: 0.048, thigh: 0.099, calf: 0.068, head: 1.04, slouch: 0.012, neck: 0.065 },
];
const BASE_SCALE = 0.968;            // unit crown 1.92 -> 1.859, which is the mimic's standing capsule

// ---------------------------------------------------------------- the body
function buildBodyGeo(build, headKind, coat, seed) {
  const P = build;
  const S = new Skin();
  const seg = 14, legSeg = 12, armSeg = 10;
  const gut = P.gut, hem = coat === 'coat' ? 0.760 : 0.905;
  const rr = (i) => h3(seed * 97 + i, 31, 7) - 0.5;   // this actor's own crookedness, stable per variant

  // ---- torso: hem -> waist -> chest -> trapezius. Front and back radii differ; the belly rides the front only.
  const tj = 0.006;
  S.tint(coat === 'coat' ? COL.coat : COL.cloth, coat === 'coat' ? SF.coat : SF.cloth);
  const flare = coat === 'coat' ? 0.052 : 0.020;
  const torso = [
    ringY(hem, P.hip + flare, P.hip * 0.80 + flare * 0.8 + gut * 0.010, P.hip * 0.80 + flare * 0.8, { seg, pow: 2.1, jit: tj, seed: 3 }),
    ringY(hem + 0.055, P.hip + flare * 0.55, P.hip * 0.78 + gut * 0.012, P.hip * 0.79, { seg, pow: 2.1, jit: tj, seed: 4 }),
    ringY(0.985, P.hip * 0.99, P.hip * 0.76 + gut * 0.016, P.hip * 0.77, { seg, pow: 2.1, jit: tj, seed: 5 }),
    ringY(1.070, P.waist * 1.02, P.waist * 0.74 + gut * 0.030, P.waist * 0.74, { seg, pow: 2.2, b0: BI.hips, b1: BI.spine, w: 0.35, jit: tj, seed: 6 }),
    ringY(1.150, P.waist * 1.03, P.waist * 0.73 + gut * 0.026, P.waist * 0.74, { seg, pow: 2.3, b0: BI.spine, jit: tj, seed: 7 }),
    ringY(1.245, P.chest * 0.93, P.chest * 0.62 + gut * 0.012, P.chest * 0.62, { seg, pow: 2.4, b0: BI.spine, b1: BI.chest, w: 0.45, jit: tj, seed: 8 }),
    ringY(1.320, P.chest, P.chest * 0.615, P.chest * 0.60, { seg, pow: 2.4, b0: BI.chest, jit: tj, seed: 9, cx: rr(1) * 0.006 }),
    ringY(1.400, P.chest * 1.015, P.chest * 0.585, P.chest * 0.565, { seg, pow: 2.4, b0: BI.chest, jit: tj, seed: 10 }),
    ringY(1.468, P.chest * 0.975, P.chest * 0.520, P.chest * 0.500, { seg, pow: 2.3, b0: BI.chest, jit: tj * 0.6, seed: 11 }),
    ringY(1.522, P.chest * 0.820, P.chest * 0.430, P.chest * 0.430, { seg, pow: 2.1, b0: BI.chest, cy: 0, jit: tj * 0.6, seed: 12 }),
    ringY(1.560, P.chest * 0.520, P.chest * 0.360, P.chest * 0.380, { seg, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.35, cz: 0.004 }),
  ];
  // the shoulders are not level: one rides a centimetre higher on everybody
  const tilt = rr(2) * 0.016;
  for (let r = 8; r < torso.length; r++) for (const v of torso[r]) v[1] += tilt * (v[0] > 0 ? 1 : -1) * ((r - 7) / 3);
  loft(S, torso, { capA: true });

  // ---- neck and head. The head bone sits at the jaw pivot; the skull is an ovoid above it.
  const hs = P.head, skullY = 1.790, rx = 0.082 * hs, ry = 0.125 * hs, rz = 0.102 * hs;
  S.tint(COL.skin, SF.skin);
  const neck = [
    ringY(1.545, P.neck * 1.12, P.neck * 1.05, P.neck * 1.15, { seg: 10, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.55, cz: 0.006 }),
    ringY(1.615, P.neck, P.neck * 0.96, P.neck * 1.02, { seg: 10, pow: 2.0, b0: BI.neck, cz: 0.004 }),
    ringY(1.672, P.neck * 0.99, P.neck * 0.98, P.neck * 1.06, { seg: 10, pow: 2.0, b0: BI.neck, b1: BI.head, w: 0.6, cz: 0.002 }),
  ];
  loft(S, neck);
  const hy = [1.668, 1.700, 1.735, 1.775, 1.815, 1.855, 1.888, 1.908];
  const head = hy.map((y, i) => {
    const t = clamp((y - skullY) / ry, -1, 1);
    let k = Math.sqrt(Math.max(0.02, 1 - t * t));
    // jaw: narrower and pushed forward at the bottom, so the skull is not a rugby ball
    const low = clamp01((1.760 - y) / 0.095);
    const kx = k * (1 - low * 0.30), kzF = k * (1 - low * 0.10), kzB = k * (1 - low * 0.34);
    return ringY(y, rx * kx, rz * kzF, rz * kzB, {
      seg: 12, pow: 2.15, cx: 0.004 + rr(3) * 0.004, cz: 0.006 - low * 0.012,
      b0: BI.head, jit: i > 0 && i < 6 ? 0.003 : 0,
    });
  });
  loft(S, head, { capB: true, cB: [0.004, 1.918, 0.006, BI.head, BI.head, 0] });

  // ---- head covering
  if (headKind === 'hood') buildHood(S, P, rx, rz, skullY, seed);
  else if (headKind === 'cap') buildCap(S, P, rx, rz, seed);

  // ---- collar: a stand-up jacket collar that breaks the neck line
  S.tint(coat === 'coat' ? COL.coat : COL.clothB, SF.cloth);
  const cy0 = 1.500, cy1 = 1.500 + (coat === 'coat' ? 0.085 : 0.062);
  loft(S, [
    ringY(cy0, P.chest * 0.62, P.chest * 0.46, P.chest * 0.46, { seg: 12, pow: 2.0, b0: BI.chest, cz: 0.004 }),
    ringY(cy1 - 0.02, P.chest * 0.56, P.chest * 0.42, P.chest * 0.44, { seg: 12, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.3, cz: 0.006, jit: 0.004, seed: 21 }),
    ringY(cy1, P.chest * 0.60, P.chest * 0.44, P.chest * 0.47, { seg: 12, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.4, cz: 0.008, jit: 0.005, seed: 22 }),
  ], { capB: true });

  // ---- arms
  for (const side of [-1, 1]) {
    const bs = side < 0 ? BI.shL : BI.shR, bf = side < 0 ? BI.foL : BI.foR;
    const x = side * P.sh, dz = -0.010;
    const jitS = side < 0 ? 40 : 60;
    const rings = [
      // the deltoid: half on the chest so the shoulder does not tear open when the arm comes up
      ringY(Y.shoulder + 0.052, P.arm * 1.28, P.arm * 1.24, P.arm * 1.22, { seg: armSeg, pow: 2.2, cx: x, cz: dz, b0: BI.chest, b1: bs, w: 0.45 }),
      ringY(Y.shoulder - 0.010, P.arm * 1.40, P.arm * 1.32, P.arm * 1.30, { seg: armSeg, pow: 2.2, cx: x + side * 0.006, cz: dz, b0: BI.chest, b1: bs, w: 0.70, jit: 0.004, seed: jitS }),
      ringY(Y.shoulder - 0.080, P.arm * 1.16, P.arm * 1.12, P.arm * 1.10, { seg: armSeg, pow: 2.2, cx: x + side * 0.004, cz: dz, b0: bs, jit: 0.004, seed: jitS + 1 }),
      ringY(Y.shoulder - 0.190, P.arm * 0.98, P.arm * 0.96, P.arm * 0.95, { seg: armSeg, pow: 2.2, cx: x, cz: dz, b0: bs, jit: 0.004, seed: jitS + 2 }),
      ringY(Y.elbow + 0.055, P.arm * 0.90, P.arm * 0.90, P.arm * 0.90, { seg: armSeg, pow: 2.2, cx: x, cz: dz, b0: bs, b1: bf, w: 0.25 }),
      ringY(Y.elbow, P.arm * 0.92, P.arm * 0.94, P.arm * 0.98, { seg: armSeg, pow: 2.1, cx: x, cz: dz, b0: bs, b1: bf, w: 0.5 }),      // the elbow itself
      ringY(Y.elbow - 0.055, P.fore * 1.14, P.fore * 1.14, P.fore * 1.12, { seg: armSeg, pow: 2.2, cx: x, cz: dz, b0: bf, w: 0, jit: 0.004, seed: jitS + 3 }),
      ringY(Y.elbow - 0.150, P.fore * 0.98, P.fore * 0.98, P.fore * 0.96, { seg: armSeg, pow: 2.2, cx: x, cz: dz, b0: bf, jit: 0.004, seed: jitS + 4 }),
      ringY(Y.wrist + 0.038, P.fore * 0.86, P.fore * 0.84, P.fore * 0.84, { seg: armSeg, pow: 2.2, cx: x, cz: dz, b0: bf }),           // the cuff
      ringY(Y.wrist + 0.022, P.fore * 0.96, P.fore * 0.92, P.fore * 0.92, { seg: armSeg, pow: 2.2, cx: x, cz: dz, b0: bf, jit: 0.005, seed: jitS + 5 }),
    ];
    S.tint(coat === 'coat' ? COL.coat : COL.cloth, coat === 'coat' ? SF.coat : SF.cloth);
    loft(S, rings, { capA: true });
    // the glove: a mitten around the grip, wider across the knuckles than the wrist
    S.tint(COL.glove, SF.leather);
    const hand = [
      ringY(Y.wrist + 0.020, P.fore * 0.92, P.fore * 0.88, P.fore * 0.88, { seg: armSeg, pow: 2.3, cx: x, cz: dz, b0: bf }),
      ringY(Y.wrist - 0.020, P.fore * 1.00, P.fore * 0.86, P.fore * 0.90, { seg: armSeg, pow: 2.5, cx: x - side * 0.004, cz: dz - 0.006, b0: bf }),
      ringY(Y.wrist - 0.062, P.fore * 1.04, P.fore * 0.80, P.fore * 0.88, { seg: armSeg, pow: 2.6, cx: x - side * 0.008, cz: dz - 0.012, b0: bf }),
      ringY(Y.wrist - 0.092, P.fore * 0.86, P.fore * 0.60, P.fore * 0.70, { seg: armSeg, pow: 2.6, cx: x - side * 0.012, cz: dz - 0.016, b0: bf }),
    ];
    loft(S, hand, { capB: true });
  }

  // ---- legs: trousers over the leg, bunched above the boot
  for (const side of [-1, 1]) {
    const bt = side < 0 ? BI.thL : BI.thR, bs = side < 0 ? BI.snL : BI.snR;
    const x = side * (P.hip * 0.56), sd = side < 0 ? 200 : 230;
    const bunch = 0.010 + h3(seed + sd, 5, 9) * 0.014;
    S.tint(COL.cloth, SF.cloth);
    const rings = [
      ringY(1.055, P.thigh * 1.02, P.thigh * 1.02, P.thigh * 1.02, { seg: legSeg, pow: 2.2, cx: x, b0: BI.hips, b1: bt, w: 0.25 }),
      ringY(Y.hip - 0.020, P.thigh * 1.06, P.thigh * 1.06, P.thigh * 1.04, { seg: legSeg, pow: 2.2, cx: x, b0: BI.hips, b1: bt, w: 0.65, jit: 0.005, seed: sd }),
      ringY(Y.hip - 0.120, P.thigh * 1.00, P.thigh * 1.02, P.thigh * 1.00, { seg: legSeg, pow: 2.2, cx: x, b0: bt, jit: 0.006, seed: sd + 1 }),
      ringY(Y.hip - 0.260, P.thigh * 0.90, P.thigh * 0.93, P.thigh * 0.91, { seg: legSeg, pow: 2.2, cx: x, b0: bt, jit: 0.006, seed: sd + 2 }),
      ringY(Y.knee + 0.075, P.thigh * 0.80, P.thigh * 0.84, P.thigh * 0.82, { seg: legSeg, pow: 2.2, cx: x, b0: bt, b1: bs, w: 0.22 }),
      ringY(Y.knee, P.thigh * 0.79, P.thigh * 0.84, P.thigh * 0.80, { seg: legSeg, pow: 2.1, cx: x, b0: bt, b1: bs, w: 0.5 }),            // the knee
      ringY(Y.knee - 0.070, P.calf * 1.16, P.calf * 1.18, P.calf * 1.20, { seg: legSeg, pow: 2.2, cx: x, b0: bs, jit: 0.005, seed: sd + 3 }),
      ringY(Y.knee - 0.150, P.calf * 1.10, P.calf * 1.12, P.calf * 1.22, { seg: legSeg, pow: 2.2, cx: x, cz: 0.006, b0: bs, jit: 0.006, seed: sd + 4 }),   // the calf
      ringY(0.290, P.calf * 0.92, P.calf * 0.94, P.calf * 0.98, { seg: legSeg, pow: 2.2, cx: x, b0: bs, jit: 0.005, seed: sd + 5 }),
      ringY(0.238, P.calf * 0.94 + bunch, P.calf * 0.96 + bunch, P.calf * 0.98 + bunch, { seg: legSeg, pow: 2.3, cx: x, b0: bs, jit: 0.009, seed: sd + 6 }),  // bunched over the boot
      ringY(0.206, P.calf * 0.86 + bunch * 0.4, P.calf * 0.90 + bunch * 0.4, P.calf * 0.92 + bunch * 0.4, { seg: legSeg, pow: 2.3, cx: x, b0: bs, jit: 0.007, seed: sd + 7 }),
    ];
    loft(S, rings, { capA: true });
    buildBoot(S, P, side, x, bs, side < 0 ? BI.ftL : BI.ftR, seed);
  }
  return S;
}

// The boot: a shaft the trouser sits on, an ankle, a foot swept forward with a heel and a toe, and a sole that
// stands proud all the way round. The sole is the only part of a mimic that ever catches a highlight.
function buildBoot(S, P, side, x, boneShin, boneFoot, seed) {
  const seg = 12;
  const w = P.calf * 0.86, tw = w * 1.02;
  S.tint(COL.boot, SF.leather);
  loft(S, [
    ringY(0.212, w * 1.04, w * 1.06, w * 1.08, { seg, pow: 2.4, cx: x, b0: boneShin }),
    ringY(0.150, w * 0.98, w * 1.00, w * 1.06, { seg, pow: 2.4, cx: x, b0: boneShin, jit: 0.004, seed: seed + 11 }),
    ringY(0.100, w * 0.94, w * 0.98, w * 1.08, { seg, pow: 2.5, cx: x, cz: 0.004, b0: boneShin, b1: boneFoot, w: 0.4 }),
  ]);
  // the foot, swept from the heel forward. Sections are XY rounded rectangles; the sole is flat, the instep domed.
  const fz = [0.082, 0.040, -0.012, -0.070, -0.120, -0.152];
  const fw = [0.048, 0.055, 0.058, 0.056, 0.047, 0.030];
  const ft = [0.092, 0.104, 0.098, 0.078, 0.058, 0.040];      // instep height above the sole
  const foot = fz.map((z, i) => ringZ(z, fw[i] * (P.calf / 0.062), 0.024 + ft[i], 0.024, {
    seg, pow: 2.9, cx: x, cy: 0.024, b0: boneFoot,
  }));
  loft(S, foot, { flip: true, capA: true, capB: true });
  // the sole: a slab under the foot with a welt that overhangs, in a different surface so it separates
  S.tint(COL.sole, SF.rubber);
  const sz = [0.086, 0.030, -0.040, -0.110, -0.156];
  const sw2 = [0.052, 0.060, 0.062, 0.050, 0.032];
  const sole = sz.map((z, i) => ringZ(z, sw2[i] * (P.calf / 0.062), 0.026, 0.026, { seg: 10, pow: 3.4, cx: x, cy: 0.026, b0: boneFoot }));
  loft(S, sole, { flip: true, capA: true, capB: true });
}

// A hood: a cowl on the head with a fabric fall that breaks over the shoulders. The dome rides the head bone, the
// fall rides the chest — which is exactly how a hood behaves when the man inside it turns to look at you.
function buildHood(S, P, rx, rz, skullY, seed) {
  S.tint(COL.wool, SF.wool);
  const seg = 14;
  const R = 0.030;                               // slack between skull and cloth
  const hy = [1.690, 1.740, 1.800, 1.860, 1.905, 1.930];
  const rings = hy.map((y, i) => {
    const t = clamp((y - (skullY + 0.012)) / (0.125 + R), -1, 1);
    const k = Math.sqrt(Math.max(0.05, 1 - t * t));
    const s = 1 + (i === 0 ? 0.10 : 0);
    return ringY(y, (rx + R) * k * s, (rz + R * 0.7) * k * s, (rz + R * 1.5) * k * s, {
      seg, pow: 2.1, cx: 0.004, cz: 0.010 + (1 - k) * 0.012, b0: BI.head, jit: 0.006, seed: seed + 70 + i,
    });
  });
  loft(S, rings, { capB: true, cB: [0.004, 1.944, 0.020, BI.head, BI.head, 0] });
  // the fall: a short cape from the nape onto the shoulders, open at the front
  const fall = [];
  for (const [y, r, w] of [[1.680, 0.108, 0.0], [1.610, 0.150, 0.35], [1.545, 0.196, 0.75], [1.500, 0.222, 1.0]]) {
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = lerp(0.72, TAU - 0.72, i / seg);
      const sa = Math.sin(a), ca = Math.cos(a);
      const j = (h3(i * 17 + seed, Math.round(y * 500), 3) - 0.5) * 0.012;
      ring.push([0.004 + sa * (r + j), y - Math.abs(sa) * 0.010, 0.010 - ca * (r * 0.82 + j), BI.head, BI.chest, w]);
    }
    fall.push(ring);
  }
  for (let r = 0; r < fall.length - 1; r++) for (let i = 0; i < seg; i++) {
    S.quad(fall[r][i], fall[r + 1][i], fall[r + 1][i + 1], fall[r][i + 1]);
    S.quad(fall[r][i + 1], fall[r + 1][i + 1], fall[r + 1][i], fall[r][i]);   // the underside, so it is not a one-sided sheet
  }
}

// A soft field cap: a low crown with a slack top and a stitched peak. Reads at thirty metres as "not a helmet".
function buildCap(S, P, rx, rz, seed) {
  S.tint(COL.wool, SF.wool);
  const seg = 12;
  const rings = [];
  for (const [y, k, s] of [[1.836, 1.06, 1], [1.862, 1.05, 1], [1.892, 0.92, 1], [1.916, 0.62, 1]]) {
    rings.push(ringY(y, rx * k + 0.010, rz * k + 0.010, rz * k + 0.012, { seg, pow: 2.1, cx: 0.004, cz: 0.006, b0: BI.head, jit: 0.005, seed: seed + 90 }));
  }
  loft(S, rings, { capB: true, cB: [0.004, 1.926, 0.006, BI.head, BI.head, 0] });
  // the peak
  S.tint(COL.hard, SF.hard);
  const pk = [];
  for (const [z, y, w] of [[-rz - 0.006, 1.836, 0.90], [-rz - 0.055, 1.827, 0.86], [-rz - 0.092, 1.816, 0.66]]) {
    const row = [];
    for (let i = 0; i <= 6; i++) { const t = (i / 6) * 2 - 1; row.push([0.004 + t * rx * w, y + Math.abs(t) * 0.006, z + Math.abs(t) * 0.014, BI.head, BI.head, 0]); }
    pk.push(row);
  }
  for (let r = 0; r < pk.length - 1; r++) for (let i = 0; i < 6; i++) {
    S.quad(pk[r][i], pk[r][i + 1], pk[r + 1][i + 1], pk[r + 1][i]);
    S.quad(pk[r + 1][i], pk[r + 1][i + 1], pk[r][i + 1], pk[r][i]);
  }
}

// A rifle silhouette for the rare case that gunmesh hands back nothing: still unmistakably armed at 40 m.
function buildStandinGun() {
  const S = new Skin();
  S.tint(COL.hard, SF.hard);
  const box = (w, h, d, x, y, z, rx) => {
    const g = new THREE.BoxGeometry(w, h, d);
    _e.set(rx || 0, 0, 0); _m4.makeRotationFromEuler(_e); _m4.setPosition(x, y, z);
    g.applyMatrix4(_m4);
    const pos = g.toNonIndexed().attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      S.tri([pos.getX(i), pos.getY(i), pos.getZ(i), BI.gun, BI.gun, 0],
        [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1), BI.gun, BI.gun, 0],
        [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2), BI.gun, BI.gun, 0]);
    }
    g.dispose();
  };
  box(0.048, 0.072, 0.34, 0, 0, -0.02);
  box(0.022, 0.024, 0.36, 0, 0.012, -0.37);
  box(0.046, 0.052, 0.19, 0, -0.004, -0.27);
  box(0.042, 0.082, 0.25, 0, -0.030, 0.30, 0.11);
  box(0.032, 0.16, 0.06, 0, -0.105, -0.02, 0.30);
  box(0.030, 0.095, 0.042, 0, -0.082, 0.125, -0.34);
  return S.finish(1);
}

// =====================================================================================================
// Variant cache. A build is 15-25 ms of lofting and creasing, so it happens once per (build, head, coat) and
// every actor after that shares the buffer. The first call also starts a slow background prewarm so the first
// mimic of each type does not cost a frame mid-fight.
// =====================================================================================================
const GEO = new Map();
let standinGeo = null;
function variantGeo(key, build, headKind, coat, seed) {
  let g = GEO.get(key);
  if (g !== undefined) return g;
  try {
    const S = buildBodyGeo(build, headKind, coat, seed);
    g = S.finish(BASE_SCALE * build.s);
  } catch (e) { console.warn('[charmesh] body build failed', key, e); g = null; }
  GEO.set(key, g);
  return g;
}
const VARIANTS = [];
for (const b of BUILDS) for (const h of ['bare', 'hood', 'cap']) for (const c of ['jacket', 'coat']) VARIANTS.push([b, h, c]);
const vkey = (b, h, c) => `${b.id}|${h}|${c}`;
// the geometry is shared, so its crookedness must come from the VARIANT, never from whoever asked for it first
function variantSeed(key) { let n = 0; for (let i = 0; i < key.length; i++) n = (n * 131 + key.charCodeAt(i)) | 0; return Math.abs(n % 9973); }
let prewarmI = 0, prewarmOn = false;
function startPrewarm() {
  if (prewarmOn || typeof setTimeout !== 'function') return;
  prewarmOn = true;
  const step = () => {
    // walk the list in an order that covers all six builds before it doubles back on head coverings
    while (prewarmI < VARIANTS.length) {
      const [b, h, c] = VARIANTS[(prewarmI * 7) % VARIANTS.length];
      prewarmI++;
      if (GEO.has(vkey(b, h, c))) continue;
      variantGeo(vkey(b, h, c), b, h, c, variantSeed(vkey(b, h, c)));
      break;
    }
    if (prewarmI < VARIANTS.length) setTimeout(step, 400);
  };
  setTimeout(step, 900);
}
// Build every body variant now (for a loading screen). Returns how many it built.
export function prewarmHumanoids(limit = 999) {
  let n = 0;
  for (const [b, h, c] of VARIANTS) {
    if (n >= limit) break;
    if (GEO.has(vkey(b, h, c))) continue;
    variantGeo(vkey(b, h, c), b, h, c, variantSeed(vkey(b, h, c))); n++;
  }
  return n;
}

// =====================================================================================================
// The poser. Bones in a fixed order, procedural gait, two-bone IK arms on the rifle, head tracking, the pose
// glitch, and a collapse when the thing dies.
// =====================================================================================================
class Poser {
  constructor(build, geometry, material) {
    const s = this.s = BASE_SCALE * build.s;
    this.L1 = L1 * s; this.L2 = L2 * s;
    const bones = this.bones = [], B = this.B = {};
    const mk = (name, parent, x, y, z) => {
      const b = new THREE.Bone(); b.name = name; b.position.set(x * s, y * s, z * s);
      if (parent) parent.add(b); bones.push(b); B[name] = b; return b;
    };
    mk('hips', null, 0, Y.hips, 0);
    mk('spine', B.hips, 0, Y.spine - Y.hips, 0);
    mk('chest', B.spine, 0, Y.chest - Y.spine, 0);
    mk('neck', B.chest, 0, Y.neck - Y.chest, 0);
    mk('head', B.neck, 0, Y.head - Y.neck, 0);
    mk('shL', B.chest, -build.sh, Y.shoulder - Y.chest, -0.012);
    mk('shR', B.chest, build.sh, Y.shoulder - Y.chest, -0.012);
    mk('foL', B.shL, 0, -L1, 0);
    mk('foR', B.shR, 0, -L1, 0);
    mk('thL', B.hips, -build.hip * 0.56, Y.hip - Y.hips, 0);
    mk('thR', B.hips, build.hip * 0.56, Y.hip - Y.hips, 0);
    mk('snL', B.thL, 0, Y.knee - Y.hip, 0);
    mk('snR', B.thR, 0, Y.knee - Y.hip, 0);
    mk('ftL', B.snL, 0, Y.ankle - Y.knee, 0);
    mk('ftR', B.snR, 0, Y.ankle - Y.knee, 0);
    mk('gun', B.chest, GUN_REST[0], GUN_REST[1], GUN_REST[2]);

    this.restHips = B.hips.position.clone();
    this.gunRest = new THREE.Vector3(GUN_REST[0] * s, GUN_REST[1] * s, GUN_REST[2] * s);
    this.gunAim = new THREE.Vector3(GUN_AIM[0] * s, GUN_AIM[1] * s, GUN_AIM[2] * s);
    this.shPosL = B.shL.position.clone(); this.shPosR = B.shR.position.clone();

    const mesh = this.mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = false;
    mesh.add(B.hips);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0 * s, 0), 1.5 * s);

    // gun-local space is NOT scaled with the body: a short man carries the same rifle as a tall one
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.012, -0.56); B.gun.add(this.muzzle);
    this.gripR = new THREE.Vector3(0, -0.052, -0.012);
    this.gripL = new THREE.Vector3(0, 0.020, -0.30);

    this.phase = Math.random() * TAU; this.stepFlag = 0; this.gait = 0; this.aim = 0; this.kick = 0;
    this.headYaw = 0; this.headPitch = 0; this.flinch = 0; this.bob = 0; this.crouch = 0; this.deadT = 0;
    this.breath = Math.random() * TAU; this.sway = Math.random() * TAU;
    this.glitch = new Float32Array(BONES.length * 3); this.glitchOn = false;
  }
  attachSkinned(geometry, material) {
    const m = new THREE.SkinnedMesh(geometry, material);
    m.castShadow = true; m.bind(this.mesh.skeleton, this.mesh.bindMatrix);
    m.boundingSphere = this.mesh.boundingSphere; m.frustumCulled = false;
    return m;
  }
  startGlitch(strength = 1) {
    const gl = this.glitch;
    for (let i = 0; i < gl.length; i++) gl[i] = (Math.random() - 0.5) * 0.5 * strength * (Math.random() < 0.5 ? 1 : 0.2);
    this.glitchOn = true;
  }
  dispose() { this.mesh.skeleton.dispose(); }

  pose(c) {
    const B = this.B, s = this.s, dt = Math.min(0.1, c.dt || 0);
    if (c.dead) return this.poseDead(dt, c);
    const speed = c.speed || 0;
    this.gait = damp(this.gait, clamp01(speed / 3.0), 6, dt);
    const g = this.gait;
    const crouch = this.crouch = damp(this.crouch, c.crouch || 0, 7, dt);
    const stride = (c.stride ?? 1.42) * s;
    const prev = this.phase;
    this.phase += (speed / stride) * TAU * 0.5 * dt;
    if (this.phase > 1e5) this.phase -= 1e5;
    this.stepFlag = 0;
    if (Math.floor(this.phase / Math.PI + 0.5) !== Math.floor(prev / Math.PI + 0.5) && g > 0.15) this.stepFlag = 1;
    const ph = this.phase;
    this.breath += dt * (1.1 + speed * 0.35); this.sway += dt * 0.55;

    // ---- legs. Swing about x, knee bends through the swing, ankle keeps the boot flat.
    const swing = 0.60 * g * (0.55 + 0.45 * clamp01(speed / 2.2));
    const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
    const thL = sL * swing + crouch * 0.62, thR = sR * swing + crouch * 0.62;
    B.thL.rotation.set(thL, 0, 0.025 + crouch * 0.10);
    B.thR.rotation.set(thR, 0, -0.025 - crouch * 0.10);
    const kL = Math.max(0, Math.cos(ph - 0.35)), kR = Math.max(0, Math.cos(ph + Math.PI - 0.35));
    const snL = -(kL * kL * 1.05 * g + crouch * 1.15), snR = -(kR * kR * 1.05 * g + crouch * 1.15);
    B.snL.rotation.set(snL, 0, 0); B.snR.rotation.set(snR, 0, 0);
    // the foot stays level with the ground and rolls onto the toe as the leg swings back
    const toeL = clamp(-sL, 0, 1) * 0.55 * g, toeR = clamp(-sR, 0, 1) * 0.55 * g;
    B.ftL.rotation.set(clamp(-(thL + snL) + toeL, -0.7, 0.9), 0, 0);
    B.ftR.rotation.set(clamp(-(thR + snR) + toeR, -0.7, 0.9), 0, 0);

    // ---- hips: vertical bob, lateral weight shift onto the planted leg, lean into the walk
    this.bob = damp(this.bob, g, 6, dt);
    const idle = 1 - g;
    B.hips.position.set(
      this.restHips.x + (Math.sin(ph) * 0.020 * this.bob + Math.sin(this.sway * 0.7) * 0.006 * idle) * s,
      this.restHips.y - ((0.5 + 0.5 * Math.cos(2 * ph)) * 0.036 * this.bob + crouch * 0.30) * s,
      this.restHips.z + Math.sin(this.sway * 0.43) * 0.004 * idle * s);
    B.hips.rotation.set(-(0.055 + 0.075 * g + (c.lean || 0) + crouch * 0.22), Math.sin(ph) * 0.055 * g, -Math.sin(ph) * 0.05 * g);
    B.spine.rotation.set(0.02 - 0.045 * g + crouch * 0.10, -Math.sin(ph) * 0.05 * g, Math.sin(ph) * 0.02 * g);

    // ---- chest: flinch, breathing, the turn toward what it is looking at
    this.flinch = damp(this.flinch, 0, 9, dt);
    const br = Math.sin(this.breath) * (0.010 + 0.016 * clamp01(speed / 3));
    B.chest.rotation.set(-0.02 + this.flinch * 0.35 + br * 0.5 + crouch * 0.16,
      (c.chestYaw ?? clamp((c.headYaw || 0) * 0.28, -0.34, 0.34)) + Math.sin(ph) * 0.03 * g,
      this.flinch * 0.2 + Math.sin(this.sway * 0.9) * 0.012 * idle);

    // ---- head: neck takes a third, skull the rest; aiming tips it down onto the stock
    this.aim = damp(this.aim, c.aim || 0, 7, dt);
    const aimTuck = this.aim * 0.30;
    this.headYaw = dampAngle(this.headYaw, clamp(c.headYaw || 0, -1.35, 1.35), c.headRate ?? 6, dt);
    this.headPitch = damp(this.headPitch, clamp(c.headPitch || 0, -0.6, 0.5), 6, dt);
    B.neck.rotation.set(this.headPitch * 0.35 + aimTuck * 0.55 + Math.sin(this.breath * 0.5) * 0.006, this.headYaw * 0.35, 0);
    B.head.rotation.set(this.headPitch * 0.65 + aimTuck * 0.45, this.headYaw * 0.65, (c.headTilt || 0) + Math.sin(this.sway * 1.3) * 0.02 * idle);

    // ---- the rifle: low ready to shouldered, plus recoil
    this.kick = damp(this.kick, 0, 18, dt);
    const gn = B.gun;
    gn.position.lerpVectors(this.gunRest, this.gunAim, this.aim);
    gn.position.y += (Math.sin(ph * 2) * 0.014 * g - crouch * 0.05) * s;
    gn.position.z += this.kick * 0.05 * s;
    const pitch = lerp(-0.46, clamp(c.aimPitch || 0, -0.9, 0.7), this.aim) + this.kick * 0.09;
    gn.rotation.set(pitch, lerp(0.22, clamp(c.aimYaw || 0, -0.45, 0.45), this.aim) + Math.sin(ph) * 0.02 * g, lerp(0.14, 0.02, this.aim));
    gn.updateMatrix();

    // ---- arms follow the rifle
    this.solveArm(B.shL, B.foL, this.shPosL, _v.copy(this.gripL).applyMatrix4(gn.matrix), -1);
    this.solveArm(B.shR, B.foR, this.shPosR, _v.copy(this.gripR).applyMatrix4(gn.matrix), 1);

    if (this.glitchOn) this.applyGlitch(s);
  }
  // Death: the knees give first, then the spine curls and the rifle drops. 0.6 s, which is when the ash starts.
  poseDead(dt, c) {
    this.deadT += dt;
    const B = this.B, s = this.s;
    const f = clamp01(this.deadT / 0.62), fe = 1 - Math.pow(1 - f, 3);
    B.thL.rotation.set(0.95 * fe, 0, 0.03); B.thR.rotation.set(0.82 * fe, 0, -0.05);
    B.snL.rotation.set(-1.95 * fe, 0, 0); B.snR.rotation.set(-1.75 * fe, 0, 0);
    B.ftL.rotation.set(0.7 * fe, 0, 0); B.ftR.rotation.set(0.6 * fe, 0, 0);
    B.hips.position.set(this.restHips.x, this.restHips.y - 0.62 * fe * s, this.restHips.z - 0.06 * fe * s);
    B.hips.rotation.set(-0.35 * fe, 0.1 * fe, 0.08 * fe);
    B.spine.rotation.set(-0.55 * fe, 0, 0);
    B.chest.rotation.set(-0.72 * fe, -0.12 * fe, 0.1 * fe);
    B.neck.rotation.set(0.45 * fe, 0, 0); B.head.rotation.set(0.35 * fe, 0.1 * fe, 0);
    const gn = B.gun;
    gn.position.set(this.gunRest.x, this.gunRest.y - 0.26 * fe * s, this.gunRest.z + 0.06 * fe * s);
    gn.rotation.set(-0.46 - 0.9 * fe, 0.22, 0.14 + 0.5 * fe);
    gn.updateMatrix();
    this.solveArm(B.shL, B.foL, this.shPosL, _v.copy(this.gripL).applyMatrix4(gn.matrix), -1);
    this.solveArm(B.shR, B.foR, this.shPosR, _v.copy(this.gripR).applyMatrix4(gn.matrix), 1);
    this.mesh.scale.set(1 - 0.22 * fe, 1, 1 - 0.16 * fe);
  }
  applyGlitch(s) {
    const gl = this.glitch;
    for (let i = 0; i < BONES.length; i++) {
      const bn = this.bones[i];
      bn.rotation.x += gl[i * 3]; bn.rotation.y += gl[i * 3 + 1]; bn.rotation.z += gl[i * 3 + 2];
    }
    this.B.hips.position.x += gl[1] * 0.2 * s;
    this.B.hips.position.y += Math.abs(gl[2]) * 0.12 * s;
  }
  solveArm(upperBone, foreBone, shoulder, target, side) {
    const a1 = this.L1, a2 = this.L2;
    _dir.subVectors(target, shoulder);
    let d = _dir.length();
    const maxD = (a1 + a2) * 0.995;
    if (d > maxD) d = maxD; if (d < 0.02) d = 0.02;
    _dir.normalize();
    const cosA = clamp((a1 * a1 + d * d - a2 * a2) / (2 * a1 * d), -1, 1);
    const ang = Math.acos(cosA);
    _pole.set(0.75 * side, -0.45, 0.65).normalize();
    _axis.crossVectors(_dir, _pole);
    if (_axis.lengthSq() < 1e-6) _axis.set(side, 0, 0);
    _axis.normalize();
    _upper.copy(_dir).applyAxisAngle(_axis, ang);
    _elbow.copy(shoulder).addScaledVector(_upper, a1);
    _fore.subVectors(target, _elbow).normalize();
    upperBone.quaternion.setFromUnitVectors(DOWN, _upper);
    _q.copy(upperBone.quaternion).invert();
    _fore.applyQuaternion(_q);
    foreBone.quaternion.setFromUnitVectors(DOWN, _fore);
    upperBone.rotation.setFromQuaternion(upperBone.quaternion);
    foreBone.rotation.setFromQuaternion(foreBone.quaternion);
  }
  boneWorld(name, out) { const b = this.B[name]; b.updateWorldMatrix(true, false); return out.setFromMatrixPosition(b.matrixWorld); }
  muzzleWorld(out, dirOut) {
    this.muzzle.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(this.muzzle.matrixWorld);
    if (dirOut) dirOut.set(-this.muzzle.matrixWorld.elements[8], -this.muzzle.matrixWorld.elements[9], -this.muzzle.matrixWorld.elements[10]).normalize();
    return out;
  }
}

// =====================================================================================================
// The rig that mimic.js holds: body, worn gear, weapon, and the state the AI pushes at it.
// =====================================================================================================
let actorN = 0;
class Humanoid {
  constructor(opts) {
    const lo = opts.loadout || null;
    const n = actorN++;
    const wl = lo && lo.weapon ? lo.weapon.id.length : 3, vl = lo && lo.vest ? lo.vest.id.length : 5;
    const r1 = h3(n * 31 + 7, wl * 13, 3), r2 = h3(n * 17 + 5, vl * 11, 19), r3 = h3(n * 53 + 2, wl + vl, 41);
    const hasHelmet = !!(lo && lo.helmet && lo.helmet.id);
    const pick = (a, r) => a[Math.min(a.length - 1, (r * a.length) | 0)];

    // a heavier man under heavier armour reads right, so nudge the build by armour class
    const cls = lo && lo.vest && ARMOR[lo.vest.id] ? (ARMOR[lo.vest.id].cls || 2) : 2;
    let pool = BUILDS;
    if (cls >= 5) pool = [BUILDS[2], BUILDS[3], BUILDS[5], BUILDS[1]];
    else if (cls <= 2) pool = [BUILDS[0], BUILDS[1], BUILDS[4], BUILDS[5]];
    const build = pick(pool, r1);
    const headKind = hasHelmet ? (r2 < 0.18 ? 'hood' : 'bare') : pick(['hood', 'cap', 'hood', 'bare', 'cap'], r2);
    const coat = (r3 < 0.22 && cls <= 3) ? 'coat' : 'jacket';

    this.build = build; this.headKind = headKind; this.coat = coat;
    this.gearScale = BASE_SCALE * build.s;
    this.kit = (lo && lo.kit) ? lo.kit.map((k) => k.id).filter((id) => ARMOR[id]) : [];
    if (lo && lo.pack && lo.pack.id) this.kit.push(lo.pack.id);

    const key = vkey(build, headKind, coat);
    const geo = variantGeo(key, build, headKind, coat, variantSeed(key));
    if (!geo) throw new Error('charmesh: body geometry failed');
    startPrewarm();

    this.material = makeCharMaterial({ shiver: 1, grime: 1 });
    this.rig = new Poser(build, geo, this.material);
    this.root = new THREE.Group();
    this.root.add(this.rig.mesh);
    this.bones = Object.assign({}, this.rig.B);
    this.bones.handR = this.rig.B.gun;
    this.worn = []; this.gun = null; this.standin = null;
    this.s = { speed: 0, aiming: 0, crouch: 0, hit: 0, dead: false, glitch: 0, headYaw: 0, headPitch: 0, aimYaw: 0, aimPitch: 0, headRate: 4 };
  }
  // The weapon rides a bone on the chest, not the hand: the rifle's position is what drives the arms, which is
  // how a shouldered weapon actually works and the only way both hands stay on it.
  attach(g) {
    if (!g) {
      if (!this.standin) {
        if (!standinGeo) standinGeo = buildStandinGun();
        if (standinGeo) { this.standin = new THREE.Mesh(standinGeo, this.material); this.standin.castShadow = true; this.standin.frustumCulled = false; this.rig.B.gun.add(this.standin); }
      }
      return;
    }
    this.gun = g;
    g.position.set(0, 0, 0);
    this.rig.B.gun.add(g);
    const gr = g.userData && g.userData.grips;
    if (gr && gr.right && gr.right.p) this.rig.gripR.set(gr.right.p[0], gr.right.p[1] + 0.010, gr.right.p[2]);
    if (gr && gr.left && gr.left.p) this.rig.gripL.set(gr.left.p[0], gr.left.p[1] - 0.008, Math.max(-0.40, gr.left.p[2]));
  }
  // Worn kit. Vest and helmet come from the loadout through mimic.js; the rig, pack, mask and night sights come
  // from the loadout's `kit`, which nothing was putting on a body before.
  wear(vestId, helmetId, packId) {
    for (const g of this.worn) { if (g.parent) g.parent.remove(g); }
    this.worn.length = 0;
    const B = this.rig.B, sc = this.gearScale;
    const put = (g, bone) => {
      if (!g) return false;
      g.scale.setScalar(sc);
      g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.receiveShadow = false; } });
      bone.add(g); this.worn.push(g); return true;
    };
    let hasVest = false;
    try { hasVest = put(vestId ? buildVest(vestId) : null, B.chest); } catch (e) { /* a missing model must never kill a spawn */ }
    try { put(helmetId ? buildHelmet(helmetId) : null, B.head); } catch (e) { /* as above */ }
    try { put(packId ? buildPack(packId) : null, B.chest); } catch (e) { /* as above */ }
    for (const id of this.kit) {
      const d = ARMOR[id]; if (!d) continue;
      try {
        if (d.kind === 'rig') put(buildRig(id, { overVest: hasVest }), B.chest);
        else if (d.kind === 'backpack') { if (!packId) put(buildPack(id), B.chest); }
        else if (d.kind === 'mask') put(buildMask(id), B.head);
        else if (d.kind === 'headgear') put(buildHeadgear(id), B.head);
      } catch (e) { /* as above */ }
    }
    this.hasVest = hasVest;
  }
  set flinch(v) { this.rig.flinch = Math.max(this.rig.flinch, v); }
  get flinch() { return this.rig.flinch; }
  setState(s) { Object.assign(this.s, s); if (s && s.hit) this.rig.flinch = Math.max(this.rig.flinch, 1); }
  update(dt) {
    const s = this.s;
    const ctx = ctxOf();
    if (ctx) refreshSky(ctx.elapsed);
    this.rig.pose({
      dt, speed: s.speed || 0, aim: s.aiming || 0, aimPitch: s.aimPitch || 0, aimYaw: s.aimYaw || 0,
      headYaw: s.headYaw || 0, headPitch: s.headPitch || 0, headRate: s.headRate || 4,
      crouch: s.crouch || 0, dead: !!s.dead,
    });
  }
  dispose() {
    this.rig.dispose();
    this.material.dispose();
    for (const g of this.worn) if (g.parent) g.parent.remove(g);
    this.worn.length = 0;
  }
}

// =====================================================================================================
// Exports
// =====================================================================================================
export function buildHumanoid(opts = {}) {
  try { return new Humanoid(opts); }
  catch (e) { console.warn('[charmesh] buildHumanoid failed, falling back', e); return simpleRig(opts.height || 1.8, 0.28); }
}

// The other three shapes still belong to their own files (enemies/slider.js, spawn.js, seeker.js build their own
// meshes). They keep the stub flag so those files go on using what they have.
function simpleRig(height, radius, color = 0x0a0a0c) {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.1, height - radius * 2), 4, 8), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.position.y = height / 2; m.castShadow = true; root.add(m);
  const hand = new THREE.Object3D(); hand.position.set(radius, height * 0.62, -radius * 0.5); root.add(hand);
  const head = new THREE.Object3D(); head.position.set(0, height * 0.93, 0); root.add(head);
  return {
    root, bones: { handR: hand, head, hips: root }, material: m.material, stub: true,
    attach(g) { if (g) hand.add(g); }, wear() {}, setState() {}, update() {}, dispose() { m.geometry.dispose(); m.material.dispose(); },
  };
}
export function buildQuadruped(opts = {}) { return simpleRig(0.9, 0.3); }
export function buildCrawler(opts = {}) { return simpleRig(0.35, 0.3); }
export function buildHeavy(opts = {}) { return simpleRig(3.0, 0.6, 0x1a1c18); }

// Teardown for a full world reset. Actors still in the scene share these buffers, so only call it when
// everything is going away.
export function disposeChar() {
  for (const g of GEO.values()) if (g) g.dispose();
  GEO.clear();
  if (standinGeo) { standinGeo.dispose(); standinGeo = null; }
}
