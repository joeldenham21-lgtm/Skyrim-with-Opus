// Worn gear: the vests, helmets, chest rigs, packs and masks from data/armor.js, built as real objects that hang
// on a body. A mimic is what it carries, so it has to LOOK like what it carries: a recruit in a soft nylon carrier
// reads light and killable, an elite in a 6B43 reads as a wall with pouches on it. Class drives coverage — panel
// height, wrap angle, plate bulge, collar, groin flap, shoulder pads, side plates — so the threat read is silhouette
// first, at any distance, in any light.
//
// House rules this file keeps (see weapons/gunmesh.js):
//   - every piece merges to ONE geometry and draws with ONE shared material, so twenty actors wearing the same vest
//     cost twenty draw calls, not two hundred. Colour and surface (roughness, metalness, wear, fabric) ride in vertex
//     attributes instead of separate materials.
//   - built once per id and cached; callers get a clone that shares geometry and material.
//   - nothing is a plain box: panels are lofted bands that follow an elliptical torso, plates are chamfered slabs
//     with a bulge, straps are swept ribbons, helmets are ellipsoid shells with a per-azimuth cut so ear cutouts,
//     cheek flaps and nape skirts fall out of one function.
//   - procedural wear in the fragment shader: blotched grime that pools low on the piece, dust on upward faces,
//     edge rub back to bare nylon or bright metal, long scuffs, a fabric weave and a wrinkle normal.
//
// Exports (buildVest/buildHelmet/buildPack keep their original names and signatures):
//   buildVest(id)              -> Group | null   CHEST-BONE local space (the chest bone rests at world y 1.32)
//   buildHelmet(id)            -> Group | null   HEAD-BONE local space (the head bone rests at world y 1.66)
//   buildPack(id)              -> Group | null   chest-bone local, rides the back at +z
//   buildRig(id, {overVest})   -> Group | null   chest-bone local; overVest false pulls it in onto a bare torso
//   buildMask(id)              -> Group | null   head-bone local, a respirator cup or a full rubber head
//   buildHeadgear(id)          -> Group | null   head-bone local, headlamp and night sights on a brow bracket
//   buildGear(id, opts)        -> Group | null   dispatch by ARMOR[id].kind, for a loadout's `kit` entries
//   gearBone(id) / GEAR_BONE                     which bone a kind belongs on: 'chest' or 'head'
//   prewarmGear(ids?)          -> n              build prototypes behind the loading screen, not mid-fight
//   fadeGear(group, 0..1)                        collapse a piece by hand as its wearer dissolves
//   setGearGrime(0..1), gearMaterial(), visorMaterial(), setContext(ctx), disposeGear()
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { ARMOR } from '../data/index.js';

const TAU = Math.PI * 2, HALF_PI = Math.PI / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// deterministic 3-integer hash in 0..1: the same piece looks the same on every actor and every run
function h3(a, b, c) {
  let n = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177 | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- context (optional; only used for a grime dial)
let CTX = null;
export function setContext(ctx) { CTX = ctx; }
const ctxOf = () => CTX || (typeof globalThis !== 'undefined' && globalThis.__radius && globalThis.__radius.ctx) || null;

// =====================================================================================================
// One material for every piece of gear in the world. Colour comes from the vertex colour attribute, surface
// behaviour from aSurf = (roughness, metalness, wearAmount, fabricAmount). Wear is object-space so a piece
// weathers the same way on every actor, which is what mass-issued kit actually looks like.
// =====================================================================================================
const GEAR_VERT_HEAD = `
varying vec3 vGPos; varying float vNy; varying vec4 vSurf;
attribute vec4 aSurf;`;
const GEAR_VERT_BODY = `
vGPos = position; vNy = objectNormal.y; vSurf = aSurf;`;
const GEAR_FRAG_HEAD = `
varying vec3 vGPos; varying float vNy; varying vec4 vSurf;
uniform vec3 uDirt, uDust, uBareSoft, uBareHard; uniform float uGrime;
float g_grime = 0.0;`;
// grime, dust, rub-through and weave. Frequencies are quoted per metre so they read the same on a helmet and a pack.
const GEAR_FRAG_SURF = /* glsl */`
  vec3 g_op = vGPos * 20.0;
  float g_n1 = vnoise3(g_op * 1.7);
  float g_n2 = vnoise3(g_op * 6.0);
  float g_n3 = vnoise3(g_op * 17.0);
  // dirt pools low on the piece and in soft blotches everywhere else
  float g_low = smoothstep(0.22, -0.30, vGPos.y);
  g_grime = clamp(smoothstep(0.40, 0.86, vnoise3(g_op * 0.45) * 0.7 + g_n2 * 0.3) + g_low * 0.30, 0.0, 1.0) * uGrime * vSurf.z;
  diffuseColor.rgb *= 1.0 - g_grime * 0.34;
  diffuseColor.rgb = mix(diffuseColor.rgb, uDirt, g_grime * 0.30);
  // ash and dust settle on anything facing the sky
  float g_up = clamp(vNy, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uDust, g_up * g_up * 0.20 * (0.35 + 0.65 * g_n1) * uGrime);
  // edge rub: normal turn per metre, so chamfers, seams and pouch corners go bare first
  float g_curv = length(fwidth(vNormal)) / max(length(fwidth(vGPos)), 1e-6);
  float g_edge = smoothstep(70.0, 340.0, g_curv) * smoothstep(0.28, 0.78, g_n1);
  float g_sc = smoothstep(0.90, 0.99, vnoise(vec2(vGPos.x * 60.0 + vGPos.z * 24.0, vGPos.y * 190.0)));
  float g_bare = clamp(g_edge + g_sc * 0.5, 0.0, 1.0) * uGrime;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uBareSoft, uBareHard, vSurf.y), g_bare * mix(0.42, 0.85, vSurf.y));
  // cordura weave, fabric only
  float g_weave = 0.5 + 0.5 * sin(vGPos.x * 430.0 + vGPos.z * 140.0) * sin(vGPos.y * 430.0);
  diffuseColor.rgb *= 1.0 - smoothstep(0.30, 0.95, g_weave) * 0.11 * vSurf.w;
  roughnessFactor = clamp(vSurf.x + (g_n3 - 0.5) * 0.16 + g_grime * 0.16 - g_bare * 0.24, 0.05, 1.0);`;
// wrinkles: a low-frequency normal wobble, strong on cloth, faint on shells. No map, no mip, no aliasing budget.
const GEAR_FRAG_NORMAL = /* glsl */`
  normal = normalize(normal + (vec3(vnoise3(vGPos * 34.0 + 2.3), vnoise3(vGPos * 34.0 + 9.1), vnoise3(vGPos * 34.0 + 15.7)) - 0.5) * (0.26 * vSurf.w + 0.07));`;

let GEAR_MAT = null;
export function gearMaterial() {
  if (GEAR_MAT) return GEAR_MAT;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0 });
  const uniforms = {
    uGrime: { value: 1 },
    uDirt: { value: new THREE.Color(0x2a271f) },
    uDust: { value: new THREE.Color(0x6a6656) },
    uBareSoft: { value: new THREE.Color(0x8a8574) },
    uBareHard: { value: new THREE.Color(0xb6b8ba) },
  };
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GEAR_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${GEAR_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${GEAR_FRAG_HEAD}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${GEAR_FRAG_SURF}`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vSurf.y * (1.0 - g_grime * 0.45);')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>${GEAR_FRAG_NORMAL}`);
  };
  m.customProgramCacheKey = () => 'radius-gear';
  m.userData.shared = true; m.userData.u = uniforms;
  GEAR_MAT = m;
  return m;
}
// Visor glass: smoked, scratched, and thin enough that the face blot behind it still burns through. depthWrite off
// so the mimic's billboarded face (renderOrder 3) draws over it instead of being clipped away.
let VISOR_MAT = null;
export function visorMaterial() {
  if (VISOR_MAT) return VISOR_MAT;
  VISOR_MAT = new THREE.MeshStandardMaterial({ color: 0x141a1d, roughness: 0.22, metalness: 0.25, transparent: true, opacity: 0.58, side: THREE.DoubleSide, depthWrite: false });
  VISOR_MAT.userData.shared = true;
  return VISOR_MAT;
}

// ---------------------------------------------------------------- surfaces: (roughness, metalness, wear, fabric)
// There is no environment map on this material, so high metalness has nothing to reflect and reads as black
// (see ARCHITECTURE, Conventions). Metal here stays a dark dielectric-leaning blend and earns its shine from
// the edge rub instead, the same compromise weapons/gunmesh.js makes.
const S = {
  fabric: [0.96, 0.00, 1.00, 1.00],
  fabricStiff: [0.90, 0.00, 0.85, 0.70],
  webbing: [0.94, 0.00, 1.00, 0.85],
  leather: [0.70, 0.02, 0.95, 0.20],
  rubber: [0.86, 0.03, 0.55, 0.00],
  plate: [0.60, 0.14, 0.80, 0.00],
  shell: [0.64, 0.10, 0.90, 0.00],
  steel: [0.46, 0.34, 1.00, 0.00],
  alloy: [0.40, 0.38, 0.85, 0.00],
  foam: [0.98, 0.00, 0.40, 0.15],
};

// ---------------------------------------------------------------- families: Soviet olive, modern black, coyote
const FAM = {
  sov: { helm: 0x505738, shell: 0x565b3c, shell2: 0x474b31, plate: 0x3b402f, strap: 0x484c33, pouch: 0x50553a, hard: 0x424636, metal: 0x74787a, cover: 0x5e6041, hide: 0x3a2a1c },
  khk: { helm: 0x655e41, shell: 0x6b6446, shell2: 0x585235, plate: 0x413d2d, strap: 0x5b563a, pouch: 0x655e41, hard: 0x4a4634, metal: 0x74787a, cover: 0x726a48, hide: 0x40301f },
  // The mimic body is albedo 0.02. Black nylon at its true value is invisible on it and the threat read dies,
  // so the modern family is a charcoal that still reads black next to olive but holds a silhouette against the void.
  blk: { helm: 0x4a4c53, shell: 0x45474d, shell2: 0x35373c, plate: 0x2a2c31, strap: 0x3b3d43, pouch: 0x4a4c53, hard: 0x303237, metal: 0x64686b, cover: 0x4e5057, hide: 0x342b22 },
  coy: { helm: 0x6e5c3e, shell: 0x74603f, shell2: 0x5f4e33, plate: 0x463c2b, strap: 0x6a5738, pouch: 0x6f5b3b, hard: 0x4d4230, metal: 0x74787a, cover: 0x7c6845, hide: 0x4a3822 },
  grn: { helm: 0x47523e, shell: 0x3f4a38, shell2: 0x333c2e, plate: 0x2c332a, strap: 0x39422f, pouch: 0x3c4633, hard: 0x333a2c, metal: 0x6d7174, cover: 0x45503a, hide: 0x33261a },
};

// =====================================================================================================
// Geometry builder. Everything a piece needs lands in one triangle soup with colour + surface per vertex; the
// soup becomes one creased-normal BufferGeometry. Degenerate triangles (sphere poles, collapsed quads) are
// dropped on the way in so the crease pass never sees a NaN normal.
// =====================================================================================================
const _c = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _vn = new THREE.Vector3();
class Build {
  constructor() { this.p = []; this.col = []; this.srf = []; this.c = [0.5, 0.5, 0.5]; this.s = S.fabric; }
  // tint(hex, surface) sets the colour and surface for everything pushed after it
  tint(hex, surf = S.fabric) { _c.setHex(hex); this.c = [_c.r, _c.g, _c.b]; this.s = surf; return this; }
  vert(x, y, z) {
    this.p.push(x, y, z);
    this.col.push(this.c[0], this.c[1], this.c[2]);
    this.srf.push(this.s[0], this.s[1], this.s[2], this.s[3]);
  }
  tri(a, b, c) {
    _va.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _vb.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    if (_vn.crossVectors(_va, _vb).lengthSq() < 1e-14) return;      // collapsed: a pole fan or a zero-width cap
    this.vert(a[0], a[1], a[2]); this.vert(b[0], b[1], b[2]); this.vert(c[0], c[1], c[2]);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  // bake a three.js geometry (boxes, chamfered slabs, cylinders, rings) into the soup
  geo(g, mat) {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = src.attributes.position;
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < pos.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const t = k === 0 ? a : k === 1 ? b : c;
        _va.set(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        if (mat) _va.applyMatrix4(mat);
        t[0] = _va.x; t[1] = _va.y; t[2] = _va.z;
      }
      this.tri(a, b, c);
    }
    if (src !== g) src.dispose();
    g.dispose();
    return this;
  }
  get empty() { return this.p.length === 0; }
  finish() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.srf, 4));
    g.scale(10, 10, 10);                       // the crease hash resolves 1 cm; scale so it resolves 1 mm
    const out = toCreasedNormals(g, 0.85);     // ~49 degrees: chamfers stay crisp, shells stay round
    out.scale(0.1, 0.1, 0.1);
    out.computeBoundingSphere();
    this.p.length = 0; this.col.length = 0; this.srf.length = 0;
    return out;
  }
}

// ---------------------------------------------------------------- torso: an ellipse per height, chest-bone local
// The body is enemies/mimic.js BODY_PARTS: chest 0.40 x 0.22 tapering to a 0.27 x 0.17 waist. These radii are the
// skin; gear rides a few millimetres outside it.
const TORSO = [
  [0.34, 0.182, 0.104], [0.24, 0.202, 0.117], [0.12, 0.196, 0.115], [0.02, 0.180, 0.107],
  [-0.08, 0.163, 0.100], [-0.18, 0.157, 0.098], [-0.30, 0.166, 0.104],
];
// returns a fresh [rx, rz]: this runs at build time only, never per frame, and a shared temp would alias
function torsoR(y) {
  if (y >= TORSO[0][0]) return [TORSO[0][1], TORSO[0][2]];
  for (let i = 1; i < TORSO.length; i++) {
    if (y >= TORSO[i][0]) {
      const t = (y - TORSO[i][0]) / (TORSO[i - 1][0] - TORSO[i][0]);
      return [lerp(TORSO[i][1], TORSO[i - 1][1], t), lerp(TORSO[i][2], TORSO[i - 1][2], t)];
    }
  }
  const L = TORSO[TORSO.length - 1];
  return [L[1], L[2]];
}
// the head is a 0.19 x 0.22 box centred at head-local y 0.13; the skull it stands in for is an ellipsoid
const SKULL = { cx: 0.004, cy: 0.130, cz: 0.008, rx: 0.098, ry: 0.126, rz: 0.112 };

// ---------------------------------------------------------------- primitives
const win = (u) => Math.sin(Math.PI * clamp01(u));     // 0 at the ends, 1 in the middle

// A band wrapped round the torso: the workhorse. Angle 0 faces front (-z), positive toward +x. `out` is the gap
// from the skin, `t` the thickness of the panel, `bulge` an extra swell in the middle (a plate under the cloth),
// `sag` drops the bottom hem in the middle (soft armour hangs), `jit` roughens the outer face (worn cloth).
function band(B, o) {
  const { y0, y1, a0, a1, t, seg = 12, rows = 2, out = 0.008, bulge = 0, sag = 0, jit = 0,
    capTop = true, capBot = true, capSide = true, rx: fx = 0, rz: fz = 0, seed = 1 } = o;
  const O = [], I = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows, y = lerp(y0, y1, v);
    const ro = [], ri = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, a = lerp(a0, a1, u);
      const yy = y - sag * win(u) * (1 - v);
      const R = torsoR(yy);
      const rx = (fx || R[0]), rz = (fz || R[1]);
      const jn = jit ? (h3(i * 7 + seed, j * 13, 5) - 0.5) * jit : 0;
      const ri0 = out + jn * 0.4;
      const ro0 = out + t + bulge * win(u) * win(v) + jn;
      const sa = Math.sin(a), ca = Math.cos(a);
      ri.push([sa * (rx + ri0), yy, -ca * (rz + ri0)]);
      ro.push([sa * (rx + ro0), yy, -ca * (rz + ro0)]);
    }
    O.push(ro); I.push(ri);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
    B.quad(O[j][i], O[j + 1][i], O[j + 1][i + 1], O[j][i + 1]);            // outer
    B.quad(I[j][i], I[j][i + 1], I[j + 1][i + 1], I[j + 1][i]);            // inner
  }
  if (capTop) for (let i = 0; i < seg; i++) B.quad(O[rows][i], I[rows][i], I[rows][i + 1], O[rows][i + 1]);
  if (capBot) for (let i = 0; i < seg; i++) B.quad(O[0][i], O[0][i + 1], I[0][i + 1], I[0][i]);
  if (capSide) for (let j = 0; j < rows; j++) {
    B.quad(O[j][0], I[j][0], I[j + 1][0], O[j + 1][0]);
    B.quad(O[j][seg], O[j + 1][seg], I[j + 1][seg], I[j][seg]);
  }
  return B;
}

// An ellipsoid shell with a per-azimuth cut: one function covers a steel pot, a high-cut composite with ear
// cutouts, and a titanium dome with cheek flaps down to the jaw. Past the equator the surface drops straight
// instead of curving back in, so flaps hang rather than hug.
function dome(B, o) {
  const { cx = 0, cy = 0, cz = 0, rx, ry, rz, t, segU = 16, segV = 4, cut, flare = 0, skirt = 1.35, rim = true } = o;
  const pt = (u, v, shrink) => {
    const a = (u / segU) * TAU;
    const th = lerp(0, cut(a), v / segV);
    const k = 1 + flare * Math.max(0, (v / segV - 0.62) / 0.38);
    const sr = Math.sin(Math.min(th, HALF_PI));
    const yy = th <= HALF_PI ? Math.cos(th) : -Math.sin(th - HALF_PI) * skirt;
    return [cx + sr * Math.sin(a) * (rx - shrink) * k, cy + yy * (ry - shrink), cz - sr * Math.cos(a) * (rz - shrink) * k];
  };
  const O = [], I = [];
  for (let v = 0; v <= segV; v++) {
    const ro = [], ri = [];
    for (let u = 0; u <= segU; u++) { ro.push(pt(u, v, 0)); ri.push(pt(u, v, t)); }
    O.push(ro); I.push(ri);
  }
  for (let v = 0; v < segV; v++) for (let u = 0; u < segU; u++) {
    B.quad(O[v][u], O[v][u + 1], O[v + 1][u + 1], O[v + 1][u]);
    B.quad(I[v][u], I[v + 1][u], I[v + 1][u + 1], I[v][u + 1]);
  }
  if (rim) for (let u = 0; u < segU; u++) B.quad(O[segV][u], O[segV][u + 1], I[segV][u + 1], I[segV][u]);
  return B;
}
// The rim edge of a dome, as points, so a brim or a chin strap can be hung from it.
function domeEdge(o, u01, inset = 0) {
  const { cx = 0, cy = 0, cz = 0, rx, ry, rz, cut, flare = 0, skirt = 1.35 } = o;
  const a = u01 * TAU, th = cut(a), k = 1 + flare;
  const sr = Math.sin(Math.min(th, HALF_PI));
  const yy = th <= HALF_PI ? Math.cos(th) : -Math.sin(th - HALF_PI) * skirt;
  return [cx + sr * Math.sin(a) * (rx - inset) * k, cy + yy * (ry - inset), cz - sr * Math.cos(a) * (rz - inset) * k];
}

// A swept ribbon along a path: shoulder straps, chin straps, compression straps, drag handles.
function ribbon(B, pts, w, t, up = [0, 1, 0]) {
  const n = pts.length; if (n < 2) return B;
  const rings = [];
  const T = new THREE.Vector3(), U = new THREE.Vector3(), Sd = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (T.lengthSq() < 1e-12) T.set(0, 0, 1);
    T.normalize();
    U.set(up[0], up[1], up[2]);
    if (Math.abs(U.dot(T)) > 0.95) U.set(1, 0, 0);
    Sd.crossVectors(T, U).normalize(); N.crossVectors(Sd, T).normalize();
    P.set(pts[i][0], pts[i][1], pts[i][2]);
    const hw = w / 2, ht = t / 2;
    rings.push([
      [P.x + Sd.x * hw + N.x * ht, P.y + Sd.y * hw + N.y * ht, P.z + Sd.z * hw + N.z * ht],
      [P.x - Sd.x * hw + N.x * ht, P.y - Sd.y * hw + N.y * ht, P.z - Sd.z * hw + N.z * ht],
      [P.x - Sd.x * hw - N.x * ht, P.y - Sd.y * hw - N.y * ht, P.z - Sd.z * hw - N.z * ht],
      [P.x + Sd.x * hw - N.x * ht, P.y + Sd.y * hw - N.y * ht, P.z + Sd.z * hw - N.z * ht],
    ]);
  }
  // ring corners run +side+up, -side+up, -side-up, +side-up; this winding puts the outward face out
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    B.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]);
  }
  const F = rings[0], L = rings[n - 1];
  B.quad(F[0], F[1], F[2], F[3]);
  B.quad(L[3], L[2], L[1], L[0]);
  return B;
}
// a quadratic path sampler for ribbons
function arcPts(p0, p1, ctrl, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = 1 - t;
    out.push([s * s * p0[0] + 2 * s * t * ctrl[0] + t * t * p1[0], s * s * p0[1] + 2 * s * t * ctrl[1] + t * t * p1[1], s * s * p0[2] + 2 * s * t * ctrl[2] + t * t * p1[2]]);
  }
  return out;
}

// A chamfered slab: the plate, the buckle, the pouch lid. Never a bare box.
function slab(w, h, d, ch = 0.006, bevel = 0.0015) {
  const s = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  const c = Math.min(ch, w * 0.4, h * 0.4);
  s.moveTo(x0 + c, y0); s.lineTo(x1 - c, y0); s.lineTo(x1, y0 + c); s.lineTo(x1, y1 - c);
  s.lineTo(x1 - c, y1); s.lineTo(x0 + c, y1); s.lineTo(x0, y1 - c); s.lineTo(x0, y0 + c); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0006, d - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - bevel * 2) / 2);
  return g;
}
// Bend a flat XY slab (built at z = 0) onto the torso ellipse at angle `a`, standing `off` off the skin.
function wrapSlab(B, g, a, y, off) {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.attributes.position;
  const a3 = [0, 0, 0], b3 = [0, 0, 0], c3 = [0, 0, 0];
  const map = (i, t) => {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const yy = y + py;
    const R = torsoR(yy);
    const ang = a + px / Math.max(0.05, R[0]);
    const rr = off + pz;
    t[0] = Math.sin(ang) * (R[0] + rr); t[1] = yy; t[2] = -Math.cos(ang) * (R[1] + rr);
  };
  for (let i = 0; i < pos.count; i += 3) { map(i, a3); map(i + 1, b3); map(i + 2, c3); B.tri(a3, b3, c3); }
  if (src !== g) src.dispose();
  g.dispose();
  return B;
}

// A buckle: a chamfered frame with a bar across it. Twelve triangles of "someone strapped this on".
function buckle(B, x, y, z, w = 0.026, h = 0.019, rx = 0, ry = 0) {
  _m4.makeRotationY(ry); const rot = _m4.clone(); rot.multiply(new THREE.Matrix4().makeRotationX(rx)); rot.setPosition(x, y, z);
  B.geo(slab(w, h, 0.005, 0.003, 0.001), rot);
  const bar = new THREE.Matrix4().copy(rot); bar.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0035));
  B.geo(new THREE.BoxGeometry(w * 0.9, 0.004, 0.004), bar);
  return B;
}

// =====================================================================================================
// Vests. One builder, driven by a spec: coverage angles, panel height, plate bulge, pouch count, and the extras
// that only show up on the heavy classes. Class 2 is a bib. Class 6 is a house.
// =====================================================================================================
// fa/ba: half-span of the front and back panel in radians (pi/2 = wraps to the side seam)
const VEST = {
  vest_paca: { fam: 'blk', t: 0.019, top: 0.27, bot: -0.02, fa: 1.02, ba: 0.98, sag: 0.014, jit: 0.007, bulge: 0.004, pouches: 0, collar: 0, groin: 0, sidePlate: 0, arms: 0, cummer: 0, pals: 0, shoulder: 'thin', drag: 0 },
  vest_6b2: { fam: 'sov', t: 0.030, top: 0.28, bot: -0.09, fa: 1.30, ba: 1.16, sag: 0.010, jit: 0.005, bulge: 0.006, pouches: 0, collar: 0.5, groin: 0, sidePlate: 0, arms: 0, cummer: 0, pals: 0, shoulder: 'wide', quilt: 5, drag: 0 },
  vest_kirasa: { fam: 'sov', t: 0.032, top: 0.26, bot: -0.15, fa: 1.20, ba: 0.92, sag: 0.008, jit: 0.005, bulge: 0.016, pouches: 2, collar: 0.6, groin: 0, sidePlate: 0, arms: 0, cummer: 1, pals: 0, shoulder: 'wide', drag: 0 },
  vest_6b23_1: { fam: 'khk', t: 0.034, top: 0.27, bot: -0.14, fa: 1.42, ba: 1.34, sag: 0.008, jit: 0.005, bulge: 0.018, pouches: 3, collar: 1, groin: 0.7, sidePlate: 0, arms: 0, cummer: 1, pals: 2, shoulder: 'wide', drag: 0 },
  vest_6b23_2: { fam: 'khk', t: 0.040, top: 0.28, bot: -0.16, fa: 1.48, ba: 1.42, sag: 0.006, jit: 0.004, bulge: 0.024, pouches: 4, collar: 1.1, groin: 1, sidePlate: 1, arms: 0, cummer: 1, pals: 3, shoulder: 'yoke', drag: 1 },
  vest_zhuk: { fam: 'blk', t: 0.036, top: 0.26, bot: -0.09, fa: 0.86, ba: 0.82, sag: 0.004, jit: 0.003, bulge: 0.030, pouches: 3, collar: 0, groin: 0, sidePlate: 0, arms: 0, cummer: 2, pals: 3, shoulder: 'yoke', drag: 1, hardPlate: 1 },
  vest_iotv: { fam: 'coy', t: 0.042, top: 0.28, bot: -0.15, fa: 1.36, ba: 1.30, sag: 0.005, jit: 0.004, bulge: 0.028, pouches: 4, collar: 1, groin: 0.8, sidePlate: 1, arms: 0.5, cummer: 1, pals: 3, shoulder: 'yoke', drag: 1, hardPlate: 1 },
  vest_fort: { fam: 'grn', t: 0.044, top: 0.28, bot: -0.17, fa: 1.44, ba: 1.36, sag: 0.005, jit: 0.004, bulge: 0.026, pouches: 3, collar: 1.2, groin: 1, sidePlate: 0.6, arms: 1, cummer: 1, pals: 2, shoulder: 'yoke', drag: 1, hardPlate: 1 },
  vest_6b43: { fam: 'sov', t: 0.050, top: 0.29, bot: -0.19, fa: 1.52, ba: 1.48, sag: 0.004, jit: 0.004, bulge: 0.034, pouches: 4, collar: 1.3, groin: 1.15, sidePlate: 1.2, arms: 1, cummer: 1, pals: 3, shoulder: 'yoke', drag: 1, hardPlate: 1 },
};

// mag pouches across the belly of the front panel
function magPouches(B, F, n, yTop, off, wide) {
  if (n <= 0) return;
  const spread = n <= 2 ? 0.34 : n === 3 ? 0.52 : 0.66;
  const half = wide ? 0.175 : 0.150;
  const h = 0.105, y0 = yTop - h;
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : lerp(-spread, spread, i / (n - 1));
    B.tint(F.pouch, S.fabricStiff);
    band(B, { y0, y1: yTop, a0: a - half, a1: a + half, t: 0.036, seg: 4, rows: 2, out: off, seed: 3 + i * 5, jit: 0.0025 });
    B.tint(F.strap, S.webbing);
    band(B, { y0: yTop - 0.014, y1: yTop + 0.020, a0: a - half - 0.012, a1: a + half + 0.012, t: 0.044, seg: 4, rows: 1, out: off, seed: 11 + i });   // the lid
    band(B, { y0: y0 - 0.004, y1: yTop - 0.008, a0: a - 0.026, a1: a + 0.026, t: 0.040, seg: 2, rows: 1, out: off, capTop: false });                 // the pull tab
    B.tint(F.metal, S.steel);
    const R = torsoR(y0 + 0.02);
    buckle(B, Math.sin(a) * (R[0] + off + 0.037), y0 + 0.012, -Math.cos(a) * (R[1] + off + 0.037), 0.020, 0.013, 0, a);   // on the pouch face, not floating off it
  }
}
// PALS: rows of webbing loops across a panel. Cheap, and it is what makes modern kit read as modern kit.
function palsRows(B, F, rows, y0, y1, a0, a1, off) {
  if (rows <= 0) return;
  B.tint(F.strap, S.webbing);
  for (let i = 0; i < rows; i++) {
    const y = lerp(y0, y1, (i + 0.5) / rows);
    band(B, { y0: y - 0.008, y1: y + 0.008, a0, a1, t: 0.005, seg: Math.max(4, Math.round((a1 - a0) * 6)), rows: 1, out: off, capTop: false, capBot: false });
  }
}

function buildVestGeo(id) {
  const def = ARMOR[id]; if (!def) return null;
  const sp = VEST[id] || VEST.vest_6b23_1;
  const F = FAM[sp.fam] || FAM.sov;
  const cls = def.cls || 2;
  const zones = def.zones || ['torso'];
  const B = new Build();
  const off = 0.009, t = sp.t;
  const yTop = sp.top, yBot = zones.includes('stomach') ? sp.bot : Math.max(sp.bot, -0.04);

  // ---- front and back panels ----
  B.tint(F.shell, S.fabric);
  band(B, { y0: yBot, y1: yTop, a0: -sp.fa, a1: sp.fa, t, seg: 12, rows: 3, out: off, bulge: sp.bulge, sag: sp.sag, jit: sp.jit, seed: 1 });
  B.tint(F.shell2, S.fabric);
  band(B, { y0: yBot + 0.02, y1: yTop, a0: Math.PI - sp.ba, a1: Math.PI + sp.ba, t: t * 0.92, seg: 12, rows: 3, out: off, bulge: sp.bulge * 0.8, sag: sp.sag * 0.6, jit: sp.jit, seed: 21 });

  // ---- the plate you can see under the cloth: a chamfered slab bulging the front, a smaller one at the back ----
  if (sp.hardPlate) {
    B.tint(F.plate, S.plate);
    wrapSlab(B, slab(0.24, 0.29, 0.014, 0.030, 0.002), 0, yTop - 0.155, off + t - 0.002);
    wrapSlab(B, slab(0.23, 0.27, 0.012, 0.028, 0.002), Math.PI, yTop - 0.150, off + t * 0.92 - 0.002);
  } else if (cls >= 3) {
    B.tint(F.plate, S.plate);
    wrapSlab(B, slab(0.21, 0.24, 0.010, 0.026, 0.002), 0, yTop - 0.140, off + t - 0.003);
  }
  // 6B2's titanium pockets: quilted rows stitched across the front
  if (sp.quilt) {
    B.tint(F.shell2, S.fabricStiff);
    for (let i = 0; i < sp.quilt; i++) {
      const y = lerp(yBot + 0.03, yTop - 0.03, sp.quilt > 1 ? i / (sp.quilt - 1) : 0.5);
      band(B, { y0: y - 0.003, y1: y + 0.003, a0: -sp.fa + 0.10, a1: sp.fa - 0.10, t: 0.004, seg: 8, rows: 1, out: off + t, capTop: false, capBot: false });
    }
  }

  // ---- cummerbund / side straps closing the gap between the panels ----
  const gap0 = sp.fa, gap1 = Math.PI - sp.ba;
  if (sp.cummer && gap1 > gap0 + 0.03) {
    B.tint(F.cover, S.fabricStiff);
    const cy0 = Math.max(yBot + 0.02, -0.12), cy1 = Math.min(yTop - 0.06, 0.13);
    for (const sgn of [1, -1]) {
      band(B, { y0: cy0, y1: cy1, a0: sgn * (gap0 - 0.06), a1: sgn * (gap1 + 0.06), t: sp.cummer === 2 ? 0.020 : 0.026, seg: 5, rows: 2, out: off, jit: sp.jit, seed: 40 + sgn });
    }
    // side armour pockets: the class-4-and-up tell that the sides are covered too
    if (sp.sidePlate) {
      B.tint(F.plate, S.plate);
      for (const sgn of [1, -1]) {
        const ac = sgn * (gap0 + gap1) * 0.5;
        band(B, { y0: cy0 + 0.012, y1: cy1 - 0.008, a0: ac - 0.20 * sp.sidePlate, a1: ac + 0.20 * sp.sidePlate, t: 0.016, seg: 4, rows: 2, out: off + 0.024, bulge: 0.006, seed: 55 + sgn });
      }
    }
  } else if (!sp.cummer) {
    B.tint(F.strap, S.webbing);
    for (const sgn of [1, -1]) for (const y of [yTop - 0.07, yTop - 0.17]) {
      band(B, { y0: y - 0.016, y1: y + 0.016, a0: sgn * (gap0 - 0.04), a1: sgn * (gap1 + 0.04), t: 0.006, seg: 4, rows: 1, out: off + t * 0.4, capTop: false, capBot: false });
    }
  }

  // ---- collar: the throat guard that makes a heavy vest read heavy from behind ----
  if (sp.collar > 0) {
    B.tint(F.cover, S.fabricStiff);
    const ch = 0.045 * sp.collar;
    band(B, { y0: yTop - 0.005, y1: yTop + ch, a0: -Math.PI * 0.72, a1: Math.PI * 0.72, t: 0.020, seg: 10, rows: 2, out: off + 0.004, rx: 0.082, rz: 0.074, seed: 61 });
  }
  // ---- groin flap: it swings, and it is the fastest way to read "stomach covered" ----
  if (sp.groin > 0) {
    B.tint(F.shell, S.fabric);
    const gh = 0.13 * sp.groin;
    band(B, { y0: yBot - gh, y1: yBot + 0.012, a0: -0.62, a1: 0.62, t: t * 0.7, seg: 6, rows: 2, out: off + 0.004, sag: 0.012, jit: sp.jit, seed: 71 });
  }
  // ---- shoulder pads for the vests that cover 'arms'. The deltoid is 29 cm across, so these ride on their own
  // wider ellipse: on a torso-radius band they would vanish inside the arm. ----
  if (sp.arms > 0 || zones.includes('arms')) {
    const k = sp.arms || 1;
    for (const sgn of [1, -1]) {
      const ac = sgn * 1.52;
      B.tint(F.shell2, S.fabricStiff);
      band(B, { y0: yTop - 0.135 * k, y1: yTop + 0.040, a0: ac - 0.36, a1: ac + 0.36, t: 0.028 * k, seg: 5, rows: 3, out: 0.010, bulge: 0.010, jit: 0.004, rx: 0.250, rz: 0.165, sag: 0.010, seed: 80 + sgn });
      B.tint(F.plate, S.plate);
      band(B, { y0: yTop - 0.115 * k, y1: yTop + 0.020, a0: ac - 0.25, a1: ac + 0.25, t: 0.009, seg: 4, rows: 3, out: 0.010 + 0.028 * k + 0.002, bulge: 0.005, rx: 0.250, rz: 0.165, seed: 88 + sgn });
    }
  }

  // ---- shoulder straps over the top: front anchor, over the trapezius, back anchor ----
  B.tint(F.strap, S.webbing);
  const sw = sp.shoulder === 'yoke' ? 0.062 : sp.shoulder === 'wide' ? 0.048 : 0.034;
  for (const sgn of [1, -1]) {
    const xf = sgn * 0.082, xb = sgn * 0.092;
    const rF = torsoR(yTop - 0.01), rB = torsoR(yTop - 0.01);
    ribbon(B, arcPts(
      [xf, yTop - 0.012, -(rF[1] + off + t * 0.6)],
      [xb, yTop - 0.018, rB[1] + off + t * 0.5],
      [sgn * 0.135, yTop + 0.075, 0], 5), sw, 0.010, [0, 0, 1]);
    B.tint(F.metal, S.steel);
    buckle(B, xf * 1.02, yTop - 0.055, -(rF[1] + off + t + 0.006), 0.024, 0.016, 0.2, 0);
    B.tint(F.strap, S.webbing);
  }
  // ---- drag handle across the shoulder blades ----
  if (sp.drag) {
    B.tint(F.strap, S.webbing);
    const rB = torsoR(yTop - 0.03);
    ribbon(B, arcPts([-0.055, yTop - 0.030, rB[1] + off + t], [0.055, yTop - 0.030, rB[1] + off + t], [0, yTop - 0.010, rB[1] + off + t + 0.035], 4), 0.030, 0.008, [0, 1, 0]);
  }

  // ---- webbing and pouches ----
  palsRows(B, F, sp.pals, yBot + 0.045, yTop - 0.155, -sp.fa * 0.78, sp.fa * 0.78, off + t + 0.001);
  magPouches(B, F, sp.pouches, Math.min(yTop - 0.155, 0.06), off + t + 0.004, cls >= 4);
  // an admin pouch on the strong side of the heavier carriers
  if (cls >= 4) {
    B.tint(F.pouch, S.fabricStiff);
    band(B, { y0: -0.055, y1: 0.045, a0: 0.86, a1: 1.20, t: 0.032, seg: 4, rows: 2, out: off + t * 0.6, jit: 0.003, seed: 95 });
    B.tint(F.strap, S.webbing);
    band(B, { y0: 0.032, y1: 0.058, a0: 0.84, a1: 1.22, t: 0.038, seg: 4, rows: 1, out: off + t * 0.6 });
  }
  // a bandage or a grenade riding high on the strap of anything better than a bib
  if (cls >= 3) {
    B.tint(F.pouch, S.fabricStiff);
    band(B, { y0: yTop - 0.115, y1: yTop - 0.045, a0: -1.16, a1: -0.94, t: 0.030, seg: 3, rows: 2, out: off + t * 0.6, jit: 0.003, seed: 97 });
  }
  return B.finish();
}

// =====================================================================================================
// Helmets. One ellipsoid shell whose cut angle varies with azimuth: raise it at the sides for a high-cut
// composite, drop it at the front quarters for Altyn's cheek flaps, drop it at the back for a nape skirt.
// =====================================================================================================
// cut(a) is the polar angle the shell reaches at azimuth a (a = 0 faces front). Past pi/2 the surface hangs
// straight down instead of curving back in. Calibrated against the head: the brow sits at head-local y 0.17,
// the ear at 0.09, the jaw at 0.02, so a front cut near 1.45 rad clears the eyes and a side cut near 2.05 rad
// covers the ear. Everything that separates a steel pot from a titanium dome lives in these three numbers.
const HELM = {
  helm_ssh68: {
    fam: 'sov', mat: S.steel, col: 'helm', rx: 0.108, ry: 0.132, rz: 0.118, t: 0.007, flare: 0.10, segU: 16, segV: 4,
    cut: (a) => 1.74 - 0.32 * Math.cos(a) + 0.28 * Math.abs(Math.sin(a)), brim: 1, liner: 1, strap: 'single', shroud: 0, rails: 0, cover: 0,
  },
  helm_6b7: {
    fam: 'sov', mat: S.shell, col: 'cover', rx: 0.106, ry: 0.128, rz: 0.116, t: 0.010, flare: 0.03, segU: 16, segV: 4,
    cut: (a) => 1.76 - 0.32 * Math.cos(a) + 0.30 * Math.abs(Math.sin(a)) + 0.08 * Math.max(0, -Math.cos(a)), brim: 0, liner: 1, strap: 'side', shroud: 0, rails: 0, cover: 1, nape: 0.5,
  },
  helm_6b47: {
    fam: 'khk', mat: S.shell, col: 'helm', rx: 0.102, ry: 0.124, rz: 0.114, t: 0.009, flare: 0, segU: 16, segV: 4,
    cut: (a) => 1.61 - 0.31 * Math.cos(a) + 0.18 * Math.abs(Math.sin(a)), brim: 0, liner: 1, strap: 'four', shroud: 1, rails: 1, cover: 0,
  },
  helm_kiver: {
    fam: 'sov', mat: S.shell, col: 'cover', rx: 0.110, ry: 0.130, rz: 0.120, t: 0.013, flare: 0.02, segU: 16, segV: 5,
    cut: (a) => 1.80 - 0.36 * Math.cos(a) + 0.30 * Math.abs(Math.sin(a)) + 0.10 * Math.max(0, -Math.cos(a)), brim: 0, liner: 1, strap: 'cup', shroud: 0, rails: 0, cover: 1, nape: 1,
  },
  helm_zsh: {
    fam: 'blk', mat: S.shell, col: 'helm', rx: 0.114, ry: 0.136, rz: 0.124, t: 0.012, flare: 0, segU: 16, segV: 5,
    cut: (a) => 1.82 - 0.34 * Math.cos(a) + 0.34 * Math.abs(Math.sin(a)), brim: 0, liner: 1, strap: 'cup', shroud: 0, rails: 0, cover: 0, ears: 1, nape: 0.8,
  },
  helm_altyn: {
    fam: 'sov', mat: S.alloy, col: 'metal', rx: 0.112, ry: 0.134, rz: 0.122, t: 0.014, flare: 0, segU: 16, segV: 5, skirt: 1.6,
    // the extra term is the cheek flap: it peaks in the front quarter and dies at the nose and the nape
    cut: (a) => 1.76 - 0.28 * Math.cos(a) + 0.26 * Math.abs(Math.sin(a)) + 0.50 * Math.sin(a) * Math.sin(a) * (0.5 + 0.5 * Math.cos(a)),
    brim: 0, liner: 1, strap: 'cup', shroud: 0, rails: 0, cover: 0, bolts: 1, nape: 1,
  },
  helm_ach: {
    fam: 'coy', mat: S.shell, col: 'helm', rx: 0.104, ry: 0.126, rz: 0.116, t: 0.009, flare: 0, segU: 16, segV: 4,
    cut: (a) => 1.63 - 0.30 * Math.cos(a) + 0.16 * Math.abs(Math.sin(a)), brim: 0, liner: 1, strap: 'four', shroud: 1, rails: 0.6, cover: 0, pads: 1,
  },
};

function buildHelmetGeo(id) {
  const def = ARMOR[id]; if (!def) return null;
  const sp = HELM[id] || HELM.helm_6b7;
  const F = FAM[sp.fam] || FAM.sov;
  const B = new Build(), G = new Build();
  const shellCol = F[sp.col] || F.hard;
  const geom = { cx: SKULL.cx, cy: SKULL.cy + 0.012, cz: SKULL.cz, rx: sp.rx, ry: sp.ry, rz: sp.rz, t: sp.t, cut: sp.cut, flare: sp.flare, segU: sp.segU, segV: sp.segV, skirt: sp.skirt || 1.35 };

  B.tint(shellCol, sp.mat);
  dome(B, geom);

  // ---- a rolled rim round the cut edge: the lip of a steel pot, the trim of a composite ----
  {
    const n = 16;
    const drop = sp.brim ? 0.020 : 0.011;
    const kOut = 1 + (sp.brim ? 0.10 : 0.028);       // the pot flares, the composite just rolls over
    const kIn = 1 - (sp.t + 0.004) / SKULL.rz;
    const push = (p, k, dy) => [SKULL.cx + (p[0] - SKULL.cx) * k, p[1] - dy, SKULL.cz + (p[2] - SKULL.cz) * k];
    B.tint(sp.cover ? F.strap : shellCol, sp.cover ? S.webbing : sp.mat);
    for (let i = 0; i < n; i++) {
      const p0 = domeEdge(geom, i / n, 0), p1 = domeEdge(geom, (i + 1) / n, 0);
      const s0 = push(p0, kOut, drop), s1 = push(p1, kOut, drop);
      const u0 = push(p0, kIn, drop * 0.75), u1 = push(p1, kIn, drop * 0.75);
      B.quad(p0, p1, s1, s0);                        // the outer skirt of the lip
      B.quad(s0, s1, u1, u0);                        // rolled under
      B.quad(u0, u1, domeEdge(geom, (i + 1) / n, sp.t), domeEdge(geom, i / n, sp.t));
    }
  }
  // ---- the cloth cover, stitched on: a seam band and a scrim loop ----
  if (sp.cover) {
    B.tint(F.cover, S.fabric);
    dome(B, Object.assign({}, geom, { rx: sp.rx + 0.004, ry: sp.ry + 0.004, rz: sp.rz + 0.004, t: 0.003, segV: Math.max(3, sp.segV - 1), cut: (a) => sp.cut(a) * 0.86, rim: true }));
    B.tint(F.strap, S.webbing);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const p = domeEdge(geom, a / TAU, -0.006);
      B.geo(slab(0.020, 0.012, 0.006, 0.003, 0.001), new THREE.Matrix4().makeRotationY(-a).setPosition(p[0] * 1.02, p[1] + 0.030, p[2] * 1.02));
    }
  }
  // ---- NVG shroud and side rails: the modern tell ----
  if (sp.shroud) {
    B.tint(F.hard, S.plate);
    B.geo(slab(0.044, 0.030, 0.012, 0.005, 0.0015), new THREE.Matrix4().makeRotationX(0.35).setPosition(SKULL.cx, SKULL.cy + 0.078, SKULL.cz - sp.rz - 0.006));
    B.tint(F.metal, S.steel);
    B.geo(new THREE.BoxGeometry(0.016, 0.008, 0.020), new THREE.Matrix4().makeTranslation(SKULL.cx, SKULL.cy + 0.066, SKULL.cz - sp.rz - 0.016));
  }
  if (sp.rails) {
    B.tint(F.hard, S.plate);
    for (const sgn of [1, -1]) {
      const g = new THREE.BoxGeometry(0.011, 0.014, 0.086);
      B.geo(g, new THREE.Matrix4().makeRotationY(sgn * 0.30).setPosition(sgn * (sp.rx * 1.01), SKULL.cy + 0.008, SKULL.cz + 0.004));
      for (let i = 0; i < 4; i++) {                    // the teeth, so it reads as a rail and not a strip
        const t = new THREE.BoxGeometry(0.014, 0.004, 0.007);
        B.geo(t, new THREE.Matrix4().makeRotationY(sgn * 0.30).setPosition(sgn * (sp.rx * 1.03), SKULL.cy + 0.016, SKULL.cz - 0.030 + i * 0.020));
      }
    }
  }
  // ---- ear cups on the flight helmets ----
  if (sp.ears) {
    B.tint(F.hard, S.rubber);
    for (const sgn of [1, -1]) {
      const g = new THREE.CylinderGeometry(0.040, 0.044, 0.022, 10, 1);
      g.rotateZ(HALF_PI);
      B.geo(g, new THREE.Matrix4().makeTranslation(sgn * (sp.rx * 0.96), SKULL.cy - 0.030, SKULL.cz + 0.006));
    }
  }
  // ---- Altyn's bolt heads round the crown ----
  if (sp.bolts) {
    B.tint(F.metal, S.alloy);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3, th = 1.05;
      const x = SKULL.cx + Math.sin(th) * Math.sin(a) * sp.rx, y = geom.cy + Math.cos(th) * sp.ry, z = SKULL.cz - Math.sin(th) * Math.cos(a) * sp.rz;
      const g = new THREE.CylinderGeometry(0.008, 0.009, 0.006, 6, 1);
      B.geo(g, new THREE.Matrix4().makeRotationX(0.6).setPosition(x * 1.01, y * 1.0, z * 1.01));
    }
  }
  // ---- suspension pads showing under the rim ----
  if (sp.pads || sp.liner) {
    B.tint(0x1c1d1a, S.foam);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.6;
      const p = domeEdge(geom, a / TAU, sp.t + 0.010);
      B.geo(slab(0.032, 0.024, 0.010, 0.006, 0.0015), new THREE.Matrix4().makeRotationY(-a).setPosition(p[0] * 0.94, p[1] + 0.026, p[2] * 0.94));
    }
  }
  // ---- nape pad ----
  if (sp.nape) {
    B.tint(F.cover, S.fabricStiff);
    const p = domeEdge(geom, 0.5, 0);
    B.geo(slab(0.086, 0.040 * sp.nape, 0.016, 0.010, 0.002), new THREE.Matrix4().makeTranslation(SKULL.cx, p[1] - 0.012, p[2] + 0.006));
  }

  // ---- chin straps ----
  B.tint(F.strap, S.webbing);
  const jaw = SKULL.cy - 0.128, chin = SKULL.cz - 0.084;
  if (sp.strap === 'single' || sp.strap === 'side') {
    for (const sgn of [1, -1]) {
      const p = domeEdge(geom, sgn > 0 ? 0.25 : 0.75, 0.004);
      ribbon(B, arcPts([p[0], p[1] + 0.004, p[2]], [SKULL.cx + sgn * 0.020, jaw + 0.010, chin], [sgn * 0.088, jaw + 0.030, chin - 0.020], 4), 0.016, 0.005, [0, 1, 0]);
    }
    B.tint(F.hide, S.leather);
    B.geo(slab(0.052, 0.026, 0.010, 0.008, 0.0015), new THREE.Matrix4().makeRotationX(0.35).setPosition(SKULL.cx, jaw + 0.008, chin + 0.006));
  } else if (sp.strap === 'four') {
    for (const sgn of [1, -1]) for (const fwd of [1, -1]) {
      const p = domeEdge(geom, (sgn > 0 ? 0.25 : 0.75) + fwd * 0.085, 0.004);
      ribbon(B, arcPts([p[0], p[1] + 0.004, p[2]], [SKULL.cx + sgn * 0.026, jaw + 0.016, chin + 0.010], [sgn * 0.080, jaw + 0.042, chin + fwd * 0.030], 4), 0.013, 0.004, [0, 1, 0]);
    }
    B.tint(F.hard, S.rubber);
    B.geo(slab(0.048, 0.030, 0.014, 0.010, 0.002), new THREE.Matrix4().makeRotationX(0.30).setPosition(SKULL.cx, jaw + 0.012, chin + 0.008));
  } else {                                                   // a padded chin cup on the heavy shells
    for (const sgn of [1, -1]) {
      const p = domeEdge(geom, sgn > 0 ? 0.22 : 0.78, 0.004);
      ribbon(B, arcPts([p[0], p[1] + 0.002, p[2]], [SKULL.cx + sgn * 0.024, jaw + 0.020, chin + 0.014], [sgn * 0.078, jaw + 0.048, chin - 0.006], 4), 0.018, 0.006, [0, 1, 0]);
    }
    B.tint(F.hard, S.rubber);
    const cup = new THREE.SphereGeometry(0.036, 8, 5, 0, TAU, 0, 1.1);
    cup.scale(1.0, 0.6, 0.9); cup.rotateX(Math.PI);
    B.geo(cup, new THREE.Matrix4().makeTranslation(SKULL.cx, jaw + 0.026, chin + 0.024));
  }

  // ---- the visor, in front of the face where the data says so ----
  if (def.visor) {
    const vy0 = SKULL.cy - 0.082, vy1 = SKULL.cy + 0.042;
    // the frame and the two arms it swings on
    B.tint(F.metal, S.alloy);
    for (const sgn of [1, -1]) {
      const g = new THREE.BoxGeometry(0.009, 0.030, 0.011);
      B.geo(g, new THREE.Matrix4().makeRotationX(-0.5).setPosition(sgn * (sp.rx * 0.90), SKULL.cy - 0.010, SKULL.cz - sp.rz * 0.62));
      const pivot = new THREE.CylinderGeometry(0.012, 0.012, 0.008, 8, 1); pivot.rotateZ(HALF_PI);
      B.geo(pivot, new THREE.Matrix4().makeTranslation(sgn * (sp.rx * 0.96), SKULL.cy + 0.008, SKULL.cz - sp.rz * 0.50));
    }
    const seg = 8, spanA = 1.02, rvx = sp.rx * 1.02, rvz = sp.rz * 1.02;
    const ring = (y, r) => {
      const out = [];
      for (let i = 0; i <= seg; i++) {
        const a = lerp(-spanA, spanA, i / seg);
        out.push([SKULL.cx + Math.sin(a) * (rvx + r), y, SKULL.cz - Math.cos(a) * (rvz + r)]);
      }
      return out;
    };
    // frame bands across the top and bottom of the aperture, both faces (the gear material is single sided)
    const sheet = (rowA, rowB) => {
      for (let i = 0; i < seg; i++) {
        B.quad(rowA[i], rowA[i + 1], rowB[i + 1], rowB[i]);
        B.quad(rowB[i], rowB[i + 1], rowA[i + 1], rowA[i]);
      }
    };
    sheet(ring(vy1, 0.002), ring(vy1 - 0.014, 0.002));
    sheet(ring(vy0 + 0.012, 0.002), ring(vy0, 0.002));
    // the glass itself, on its own material so the face blot burns through it
    G.tint(0x141a1d, S.plate);
    const gTop = ring(vy1 - 0.012, 0.0), gBot = ring(vy0 + 0.010, 0.0);
    for (let i = 0; i < seg; i++) G.quad(gTop[i], gTop[i + 1], gBot[i + 1], gBot[i]);
  }
  return { shell: B.finish(), glass: G.empty ? null : G.finish() };
}

// =====================================================================================================
// Chest rigs and belt kit. These layer OVER a vest, so they sit further out and carry the magazines.
// =====================================================================================================
const RIG = {
  rig_belt: { fam: 'sov', mags: 2, y: -0.155, h: 0.100, belt: 1, harness: 0, panel: 0, out: 0.052, dump: 0 },
  rig_6sh112: { fam: 'sov', mags: 4, y: -0.020, h: 0.115, belt: 1, harness: 1, panel: 0.6, out: 0.056, dump: 1 },
  rig_alpha: { fam: 'khk', mags: 6, y: -0.010, h: 0.120, belt: 0, harness: 1, panel: 1, out: 0.058, dump: 1 },
  rig_tv110: { fam: 'blk', mags: 6, y: -0.005, h: 0.125, belt: 0, harness: 1, panel: 1, out: 0.062, dump: 1, soft: 1 },
  rig_smersh: { fam: 'grn', mags: 8, y: -0.020, h: 0.115, belt: 1, harness: 1, panel: 0.8, out: 0.058, dump: 1, back: 1 },
};
// `lift` is how far the rig stands off the skin: the table is written for a rig worn over body armour, and a
// mimic with no vest wants it pulled in or it floats.
function buildRigGeo(id, lift = 0) {
  const def = ARMOR[id]; if (!def) return null;
  const sp = RIG[id] || RIG.rig_6sh112;
  const F = FAM[sp.fam] || FAM.sov;
  const B = new Build();
  const off = sp.out + lift;
  const rows = sp.mags > 4 ? 2 : 1;
  const perRow = Math.ceil(sp.mags / rows);

  // the soft insert a TV-110 wears under its pouches
  if (sp.soft) {
    B.tint(F.shell, S.fabric);
    band(B, { y0: sp.y - 0.075, y1: sp.y + 0.135, a0: -1.05, a1: 1.05, t: 0.022, seg: 9, rows: 2, out: off - 0.028, bulge: 0.008, jit: 0.004, seed: 5 });
  }
  // the backing panel the pouches are sewn to
  if (sp.panel) {
    B.tint(F.shell2, S.fabricStiff);
    band(B, { y0: sp.y - 0.055 * sp.panel, y1: sp.y + 0.085 * sp.panel, a0: -0.92, a1: 0.92, t: 0.012, seg: 8, rows: 2, out: off - 0.014, jit: 0.004, seed: 6 });
  }
  // magazine pouches: what the rig is FOR, and the read for how long this thing can keep shooting
  const half = 0.135;
  for (let r = 0; r < rows; r++) {
    const n = r === rows - 1 ? sp.mags - perRow * r : perRow;
    const y1 = sp.y + (rows === 1 ? sp.h : (r === 0 ? sp.h + 0.055 : sp.h - 0.075));
    const y0 = y1 - sp.h;
    const spread = n <= 2 ? 0.40 : n <= 3 ? 0.58 : 0.74;   // wider than this and the outer pouch sits where the arm swings
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : lerp(-spread, spread, i / (n - 1));
      B.tint(F.pouch, S.fabricStiff);
      band(B, { y0, y1, a0: a - half, a1: a + half, t: 0.038, seg: 4, rows: 2, out: off, jit: 0.003, seed: 120 + i + r * 9 });
      B.tint(F.strap, S.webbing);
      band(B, { y0: y1 - 0.016, y1: y1 + 0.022, a0: a - half - 0.014, a1: a + half + 0.014, t: 0.046, seg: 4, rows: 1, out: off, seed: 140 + i });
      band(B, { y0: y0 + 0.004, y1: y1 - 0.010, a0: a - 0.024, a1: a + 0.024, t: 0.042, seg: 2, rows: 1, out: off, capTop: false });
    }
  }
  // the harness: two straps over the shoulders, joined across the back
  if (sp.harness) {
    B.tint(F.strap, S.webbing);
    const yTop = sp.y + sp.h + 0.06;
    for (const sgn of [1, -1]) {
      const rF = torsoR(yTop);
      ribbon(B, arcPts([sgn * 0.070, yTop, -(rF[1] + off - 0.020)], [sgn * 0.086, yTop - 0.02, rF[1] + 0.030], [sgn * 0.130, 0.34, 0], 5), 0.042, 0.009, [0, 0, 1]);
    }
    band(B, { y0: 0.055, y1: 0.085, a0: Math.PI - 0.60, a1: Math.PI + 0.60, t: 0.008, seg: 5, rows: 1, out: 0.020, capTop: false, capBot: false });
  }
  // the belt
  if (sp.belt) {
    B.tint(F.strap, S.leather);
    band(B, { y0: -0.215, y1: -0.170, a0: -Math.PI * 0.94, a1: Math.PI * 0.94, t: 0.010, seg: 14, rows: 1, out: 0.016, jit: 0.002, seed: 7 });
    B.tint(F.metal, S.steel);
    const R = torsoR(-0.192);
    buckle(B, 0, -0.192, -(R[1] + 0.030), 0.040, 0.032);
  }
  // a dump pouch on the weak side, and SMERSH's twin back pouches
  if (sp.dump) {
    B.tint(F.pouch, S.fabric);
    band(B, { y0: -0.185, y1: -0.075, a0: -1.42, a1: -1.02, t: 0.042, seg: 4, rows: 2, out: 0.024, sag: 0.014, jit: 0.006, seed: 8 });
  }
  if (sp.back) {
    B.tint(F.pouch, S.fabricStiff);
    for (const sgn of [1, -1]) band(B, { y0: -0.055, y1: 0.075, a0: Math.PI + sgn * 0.30, a1: Math.PI + sgn * 0.74, t: 0.052, seg: 4, rows: 2, out: 0.018, jit: 0.004, seed: 160 + sgn });
  }
  return B.finish();
}

// =====================================================================================================
// Backpacks. Body, lid, side pockets, compression straps and — on the raid pack — an external frame that the
// description says creaks. Chest-bone local, riding the back at +z.
// =====================================================================================================
const PACK = {
  pack_tortilla: { fam: 'sov', w: 0.235, h: 0.300, d: 0.115, y: 0.075, pockets: 0, frame: 0, lid: 0.7, roll: 0, straps: 1 },
  pack_pilgrim: { fam: 'khk', w: 0.255, h: 0.345, d: 0.135, y: 0.085, pockets: 1, frame: 0, lid: 1, roll: 0, straps: 2 },
  pack_attack2: { fam: 'coy', w: 0.275, h: 0.385, d: 0.160, y: 0.090, pockets: 1, frame: 0, lid: 1, roll: 1, straps: 3 },
  pack_6sh118: { fam: 'sov', w: 0.295, h: 0.440, d: 0.185, y: 0.100, pockets: 2, frame: 1, lid: 1, roll: 1, straps: 3 },
};
function buildPackGeo(id) {
  if (id === 'pack_none') return null;
  const def = ARMOR[id]; if (!def) return null;
  const sp = PACK[id] || PACK.pack_pilgrim;
  const F = FAM[sp.fam] || FAM.sov;
  const B = new Build();
  const R = torsoR(sp.y);
  const z0 = R[1] + 0.020;                                   // the face of the pack that touches the back
  const zc = z0 + sp.d / 2;

  // body: a chamfered slab, softened by a lofted back panel that follows the spine
  B.tint(F.shell, S.fabric);
  B.geo(slab(sp.w, sp.h, sp.d, 0.030, 0.004), new THREE.Matrix4().makeTranslation(0, sp.y, zc));
  band(B, { y0: sp.y - sp.h / 2, y1: sp.y + sp.h / 2, a0: Math.PI - 0.66, a1: Math.PI + 0.66, t: 0.020, seg: 6, rows: 2, out: 0.010, jit: 0.005, seed: 9 });
  // lid
  if (sp.lid) {
    B.tint(F.shell2, S.fabric);
    B.geo(slab(sp.w * 0.98, sp.h * 0.24 * sp.lid, sp.d * 1.05, 0.024, 0.003), new THREE.Matrix4().makeRotationX(-0.16).setPosition(0, sp.y + sp.h * 0.44, zc + 0.006));
    B.tint(F.strap, S.webbing);
    // the lid straps run down the OUTSIDE of the pack, not the face against the spine
    const lz = zc + sp.d / 2;
    for (const sgn of [1, -1]) ribbon(B, [[sgn * sp.w * 0.24, sp.y + sp.h * 0.50, lz + 0.004], [sgn * sp.w * 0.24, sp.y + sp.h * 0.30, lz + 0.010], [sgn * sp.w * 0.24, sp.y + sp.h * 0.24, lz + 0.002]], 0.020, 0.006, [0, 0, 1]);
    B.tint(F.metal, S.steel);
    for (const sgn of [1, -1]) buckle(B, sgn * sp.w * 0.24, sp.y + sp.h * 0.27, lz + 0.014, 0.024, 0.018, -0.15, 0);
  }
  // side pockets
  if (sp.pockets) {
    B.tint(F.pouch, S.fabric);
    for (const sgn of [1, -1]) {
      B.geo(slab(sp.d * 0.62, sp.h * 0.44, 0.075, 0.018, 0.003), new THREE.Matrix4().makeRotationY(sgn * HALF_PI).setPosition(sgn * (sp.w / 2 + 0.030), sp.y - sp.h * 0.10, zc));
      if (sp.pockets > 1) B.geo(slab(sp.d * 0.52, sp.h * 0.20, 0.060, 0.014, 0.003), new THREE.Matrix4().makeRotationY(sgn * HALF_PI).setPosition(sgn * (sp.w / 2 + 0.026), sp.y + sp.h * 0.22, zc));
    }
  }
  // a bedroll strapped under the lid
  if (sp.roll) {
    B.tint(F.cover, S.fabricStiff);
    const g = new THREE.CylinderGeometry(0.042, 0.042, sp.w * 0.86, 10, 1); g.rotateZ(HALF_PI);
    B.geo(g, new THREE.Matrix4().makeTranslation(0, sp.y - sp.h * 0.42, zc + sp.d / 2 + 0.024));
  }
  // compression straps across the back of the pack
  B.tint(F.strap, S.webbing);
  for (let i = 0; i < sp.straps; i++) {
    const y = lerp(sp.y - sp.h * 0.34, sp.y + sp.h * 0.26, sp.straps === 1 ? 0.5 : i / (sp.straps - 1));
    ribbon(B, [[-sp.w / 2 - 0.006, y, zc], [-sp.w * 0.30, y, zc + sp.d / 2 + 0.006], [sp.w * 0.30, y, zc + sp.d / 2 + 0.006], [sp.w / 2 + 0.006, y, zc]], 0.026, 0.007, [0, 1, 0]);
    B.tint(F.metal, S.steel); buckle(B, sp.w * 0.16, y, zc + sp.d / 2 + 0.014, 0.022, 0.016); B.tint(F.strap, S.webbing);
  }
  // shoulder straps over the trapezius to the front of the chest
  for (const sgn of [1, -1]) {
    const rF = torsoR(0.16);
    ribbon(B, arcPts([sgn * 0.080, sp.y + sp.h * 0.44, z0 + 0.010], [sgn * 0.088, 0.06, -(rF[1] + 0.016)], [sgn * 0.135, 0.36, -0.02], 6), 0.052, 0.014, [0, 0, 1]);
  }
  // the frame: aluminium tubing you can see standing proud of the fabric
  if (sp.frame) {
    B.tint(F.metal, S.alloy);
    for (const sgn of [1, -1]) {
      const g = new THREE.CylinderGeometry(0.008, 0.008, sp.h * 0.94, 6, 1);
      B.geo(g, new THREE.Matrix4().makeTranslation(sgn * (sp.w / 2 - 0.014), sp.y, zc + sp.d / 2 + 0.012));
    }
    for (const yy of [sp.y + sp.h * 0.40, sp.y - sp.h * 0.40]) {
      const g = new THREE.CylinderGeometry(0.007, 0.007, sp.w - 0.028, 6, 1); g.rotateZ(HALF_PI);
      B.geo(g, new THREE.Matrix4().makeTranslation(0, yy, zc + sp.d / 2 + 0.012));
    }
  }
  return B.finish();
}

// =====================================================================================================
// Masks. A respirator cup, a GP-5 with the filter bolted to the face, a GP-7 with it on the cheek.
// =====================================================================================================
const MASK = {
  mask_resp: { fam: 'blk', full: 0, lens: 0, filter: 'twin', col: 0x4a4c4e },
  mask_gp5: { fam: 'sov', full: 1, lens: 2, filter: 'front', col: 0x2c2d28 },
  mask_gp7: { fam: 'sov', full: 1, lens: 1, filter: 'side', col: 0x35362f },
};
function buildMaskGeo(id) {
  const def = ARMOR[id]; if (!def) return null;
  const sp = MASK[id] || MASK.mask_resp;
  const F = FAM[sp.fam] || FAM.sov;
  const B = new Build(), G = new Build();
  const grow = 0.011;
  const eyeY = SKULL.cy + 0.020;
  // the front of the face at eye height, which is where lenses and filters bolt on
  const fz = sp.full ? SKULL.cz - (SKULL.rz + grow) * 0.99 : SKULL.cz - SKULL.rz * 0.80;

  B.tint(sp.col, S.rubber);
  if (sp.full) {
    // a GP-5 is not a mask, it is a rubber head: the shell wraps the whole skull and seals under the jaw
    dome(B, { cx: SKULL.cx, cy: SKULL.cy + 0.004, cz: SKULL.cz, rx: SKULL.rx + grow, ry: SKULL.ry + 0.008, rz: SKULL.rz + grow, t: 0.006, segU: 14, segV: 5, skirt: 1.25, cut: (a) => 2.16 + 0.12 * Math.cos(a) });
  } else {
    const cup = new THREE.SphereGeometry(0.072, 10, 6, 0, TAU, 0, 1.25);
    cup.scale(1.0, 0.78, 0.62); cup.rotateX(HALF_PI * 1.06);
    B.geo(cup, new THREE.Matrix4().makeTranslation(SKULL.cx, SKULL.cy - 0.050, fz - 0.006));
    B.tint(F.strap, S.webbing);
    for (const sgn of [1, -1]) ribbon(B, arcPts([SKULL.cx + sgn * 0.055, SKULL.cy - 0.030, fz + 0.010], [SKULL.cx + sgn * 0.030, SKULL.cy + 0.020, SKULL.cz + SKULL.rz], [sgn * 0.118, SKULL.cy + 0.005, SKULL.cz], 4), 0.012, 0.004, [0, 1, 0]);
  }
  // eye lenses: a metal rim standing proud of the rubber and a fogged disc behind it
  if (sp.lens) {
    const twin = sp.lens === 2;
    const xs = twin ? [0.040, -0.040] : [0];
    for (const x of xs) {
      const z = fz + (twin ? 0.012 : 0.004);       // the shell curves away toward the temples
      B.tint(F.metal, S.steel);
      const rim = new THREE.CylinderGeometry(twin ? 0.032 : 0.062, twin ? 0.034 : 0.064, 0.012, 12, 1, true);
      rim.rotateX(HALF_PI);
      B.geo(rim, new THREE.Matrix4().makeTranslation(SKULL.cx + x, eyeY, z - 0.004));
      G.tint(0x1a2226, S.plate);
      const disc = new THREE.CircleGeometry(twin ? 0.030 : 0.060, 12); disc.rotateY(Math.PI);
      G.geo(disc, new THREE.Matrix4().makeTranslation(SKULL.cx + x, eyeY, z - 0.008));
    }
  }
  // filter cans
  B.tint(F.hard, S.steel);
  if (sp.filter === 'front') {
    const can = new THREE.CylinderGeometry(0.036, 0.038, 0.070, 10, 1); can.rotateX(HALF_PI);
    B.geo(can, new THREE.Matrix4().makeTranslation(SKULL.cx, SKULL.cy - 0.062, fz - 0.026));
  } else if (sp.filter === 'side') {
    const can = new THREE.CylinderGeometry(0.032, 0.034, 0.062, 10, 1); can.rotateX(HALF_PI); can.rotateY(0.5);
    B.geo(can, new THREE.Matrix4().makeTranslation(SKULL.cx - 0.070, SKULL.cy - 0.044, fz + 0.014));
  } else {
    for (const sgn of [1, -1]) {
      const can = new THREE.CylinderGeometry(0.026, 0.028, 0.024, 8, 1); can.rotateX(HALF_PI);
      B.geo(can, new THREE.Matrix4().makeTranslation(SKULL.cx + sgn * 0.056, SKULL.cy - 0.050, fz - 0.020));
    }
  }
  return { shell: B.finish(), glass: G.empty ? null : G.finish() };
}

// =====================================================================================================
// Headgear: the headlamp everything can see, and the two night sights. They ride on a brow bracket so they
// still make sense under a helmet, with the tubes at eye height where a mimic would actually look through them.
// =====================================================================================================
const HEADGEAR = {
  head_lamp: { fam: 'sov', kind: 'lamp', lens: 0.026 },
  head_pnv57: { fam: 'sov', kind: 'nvg', tubes: 2, r: 0.026, len: 0.086, bulk: 1 },
  head_1pn138: { fam: 'blk', kind: 'nvg', tubes: 2, r: 0.021, len: 0.070, bulk: 0.7 },
};
function buildHeadgearGeo(id) {
  const def = ARMOR[id]; if (!def) return null;
  const sp = HEADGEAR[id] || HEADGEAR.head_lamp;
  const F = FAM[sp.fam] || FAM.sov;
  const B = new Build(), G = new Build();
  const browY = SKULL.cy + 0.052, browZ = SKULL.cz - SKULL.rz - 0.004;

  // the head strap, all the way round
  B.tint(F.strap, S.webbing);
  dome(B, { cx: SKULL.cx, cy: SKULL.cy, cz: SKULL.cz, rx: SKULL.rx + 0.006, ry: SKULL.ry + 0.004, rz: SKULL.rz + 0.006, t: 0.004, segU: 14, segV: 1, skirt: 1.1, cut: () => 1.62, rim: true });

  if (sp.kind === 'lamp') {
    B.tint(F.hard, S.plate);
    B.geo(slab(0.058, 0.038, 0.030, 0.008, 0.002), new THREE.Matrix4().makeRotationX(0.10).setPosition(SKULL.cx, browY, browZ - 0.016));
    B.tint(F.metal, S.steel);
    const bez = new THREE.CylinderGeometry(sp.lens + 0.004, sp.lens + 0.002, 0.012, 12, 1, true); bez.rotateX(HALF_PI);
    B.geo(bez, new THREE.Matrix4().makeTranslation(SKULL.cx, browY, browZ - 0.032));
    G.tint(0x2a2c22, S.plate);
    const lens = new THREE.CircleGeometry(sp.lens, 12); lens.rotateY(Math.PI);
    G.geo(lens, new THREE.Matrix4().makeTranslation(SKULL.cx, browY, browZ - 0.037));
  } else {
    // the bracket, then the tubes on it
    B.tint(F.hard, S.plate);
    B.geo(slab(0.070, 0.030, 0.016, 0.006, 0.002), new THREE.Matrix4().makeRotationX(0.22).setPosition(SKULL.cx, browY + 0.010, browZ - 0.008));
    B.geo(slab(0.020, 0.034, 0.012, 0.004, 0.0015), new THREE.Matrix4().makeRotationX(-0.30).setPosition(SKULL.cx, browY - 0.010, browZ - 0.020));
    B.tint(F.metal, S.alloy);
    for (let i = 0; i < sp.tubes; i++) {
      const x = SKULL.cx + (sp.tubes === 1 ? 0 : (i === 0 ? -1 : 1) * (sp.r + 0.006));
      const tube = new THREE.CylinderGeometry(sp.r, sp.r * 1.06, sp.len, 12, 1); tube.rotateX(HALF_PI);
      B.geo(tube, new THREE.Matrix4().makeTranslation(x, SKULL.cy + 0.018, browZ - 0.030 - sp.len / 2));
      const ring = new THREE.CylinderGeometry(sp.r * 1.16, sp.r * 1.10, 0.010, 12, 1, true); ring.rotateX(HALF_PI);
      B.geo(ring, new THREE.Matrix4().makeTranslation(x, SKULL.cy + 0.018, browZ - 0.030 - sp.len));
      G.tint(0x101a14, S.plate);
      const obj = new THREE.CircleGeometry(sp.r * 0.94, 12); obj.rotateY(Math.PI);
      G.geo(obj, new THREE.Matrix4().makeTranslation(x, SKULL.cy + 0.018, browZ - 0.032 - sp.len));
    }
    // the battery pack on the back of the strap: the reason a mimic keeps walking into the dark
    if (sp.bulk > 0.8) {
      B.tint(F.hard, S.plate);
      B.geo(slab(0.052, 0.036, 0.026, 0.007, 0.002), new THREE.Matrix4().makeTranslation(SKULL.cx, SKULL.cy + 0.010, SKULL.cz + SKULL.rz + 0.018));
    }
  }
  return { shell: B.finish(), glass: G.empty ? null : G.finish() };
}

// =====================================================================================================
// Cache and assembly. Each id is built once; callers get a clone that shares geometry and material, so a
// squad of eight in matching 6B23s costs eight Object3Ds and no new GPU memory.
// =====================================================================================================
const CACHE = new Map();
// main.js is not ours to edit, so the builders publish themselves on the debug handle the first time anything
// asks for a piece (by then window.__radius exists). Tools and any module that needs a piece before ctx is
// threaded through can reach them at ctx-free `window.__radius.gearmesh`.
let published = false;
function publish() {
  if (published) return;
  const r = typeof globalThis !== 'undefined' ? globalThis.__radius : null;
  if (!r) return;
  published = true;
  if (!r.gearmesh) r.gearmesh = { buildVest, buildHelmet, buildPack, buildRig, buildMask, buildHeadgear, buildGear, gearBone, prewarmGear, fadeGear, setGearGrime, gearMaterial };
}
// main.js sets window.__radius on its first synchronous line, after the module graph has evaluated, so a
// microtask is the earliest this can land. The call in assemble() is the belt to that pair of braces.
if (typeof queueMicrotask === 'function') queueMicrotask(publish);
function assemble(key, build, id = key) {
  publish();
  if (!CACHE.has(key)) {
    let g = null;
    try {
      const r = build();
      if (r) {
        const shell = r.shell !== undefined ? r.shell : r;
        const glass = r.glass !== undefined ? r.glass : null;
        if (shell || glass) {
          g = new THREE.Group();
          g.name = key;
          if (shell) { const m = new THREE.Mesh(shell, gearMaterial()); m.name = 'gear'; m.castShadow = true; m.receiveShadow = false; g.add(m); }
          if (glass) { const m = new THREE.Mesh(glass, visorMaterial()); m.name = 'gearGlass'; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2; g.add(m); }
          g.userData.gear = true; g.userData.gearId = id;
        }
      }
    } catch (e) { console.warn('[gearmesh] failed to build', key, e); g = null; }
    CACHE.set(key, g);
  }
  const proto = CACHE.get(key);
  if (!proto) return null;
  const inst = proto.clone();                    // shares geometry and material; only the Object3Ds are new
  for (const c of inst.children) if (c.isMesh) c.onBeforeRender = followBody;   // Object3D.copy does not carry it
  return inst;
}

// ---- dying with the body ----
// A mimic folds and goes to ash over its last two seconds. Its gear is a rigid prop on the bones, so without
// this it sits there solid, floating, until the entity is removed. Each piece finds the dissolve uniform on
// the skinned body it hangs from and collapses with it. The lookup runs inside onBeforeRender, which only
// fires for a mesh that is about to be drawn, so gear off screen costs nothing. Whoever owns mimic.js can
// drive it explicitly with fadeGear() instead and this hook stands down.
function findDissolve(o) {
  for (let p = o.parent, i = 0; p && i < 8; p = p.parent, i++) {
    const u = p.isMesh && p.material && p.material.userData ? p.material.userData.u : null;
    if (u && u.uDissolve) return u.uDissolve;
  }
  return null;
}
function followBody() {                          // called as a method on the mesh; three passes render args we do not need
  const ud = this.userData;
  if (ud.manual) return;
  if (ud.dis === undefined) ud.dis = findDissolve(this);
  if (!ud.dis) return;
  const d = ud.dis.value;
  const k = d > 0.02 ? Math.max(0, 1 - d * 1.35) : 1;
  if (this.scale.x !== k) this.scale.setScalar(k);
  this.visible = k > 0.06;
}
// Drive the collapse by hand: v runs 0 (worn) to 1 (gone). Calling it once takes the automatic hook off.
export function fadeGear(group, v) {
  if (!group) return;
  const k = Math.max(0, 1 - clamp01(v) * 1.35);
  group.traverse((o) => { if (o.isMesh) { o.userData.manual = true; o.scale.setScalar(k); o.visible = k > 0.06; } });
}

// ---- the exported builders. Signatures are fixed: callers pass an ARMOR id and get a Group or null. ----

// Body armour. Attach to the CHEST bone (mimic.js: rig.B.chest.add(buildVest(id))).
export function buildVest(id) {
  if (!id || !ARMOR[id]) return null;
  return assemble(id, () => buildVestGeo(id));
}
// Helmets. Attach to the HEAD bone. Visored models come back with a second, translucent mesh.
export function buildHelmet(id) {
  if (!id || !ARMOR[id]) return null;
  return assemble(id, () => buildHelmetGeo(id));
}
// Backpacks. Attach to the CHEST bone; the pack is authored on the back at +z.
export function buildPack(id) {
  if (!id || id === 'pack_none' || !ARMOR[id]) return null;
  return assemble(id, () => buildPackGeo(id));
}
// Chest rigs and belt kit. Attach to the CHEST bone. The default sits the rig where it would ride over body
// armour; pass { overVest: false } for a mimic wearing nothing under it, or it hangs in the air.
export function buildRig(id, opts = {}) {
  if (!id || !ARMOR[id]) return null;
  const bare = opts.overVest === false;
  return assemble(bare ? id + '|bare' : id, () => buildRigGeo(id, bare ? -0.026 : 0), id);
}
// Respirators and gas masks. Attach to the HEAD bone.
export function buildMask(id) {
  if (!id || !ARMOR[id]) return null;
  return assemble(id, () => buildMaskGeo(id));
}
// Headlamps and night sights. Attach to the HEAD bone.
export function buildHeadgear(id) {
  if (!id || !ARMOR[id]) return null;
  return assemble(id, () => buildHeadgearGeo(id));
}
// Dispatch by catalogue kind, for callers that just have an id (a loadout's `kit` entries, for instance).
export function buildGear(id, opts = {}) {
  const d = ARMOR[id]; if (!d) return null;
  switch (d.kind) {
    case 'vest': return buildVest(id);
    case 'helmet': return buildHelmet(id);
    case 'backpack': return buildPack(id);
    case 'rig': return buildRig(id, opts);
    case 'mask': return buildMask(id);
    case 'headgear': return buildHeadgear(id);
    default: return null;
  }
}
// Build prototypes ahead of time so the first mimic wearing a new model does not cost a hitch mid-fight.
// A cold piece costs 10-15 ms (the crease pass), which is a dropped frame the first time each model appears;
// the 16 vests and helmets together are about a quarter of a second and 3 MB, so this belongs behind the
// loading screen, or spread a few ids per frame. Returns how many prototypes it built this call.
export function prewarmGear(ids = null) {
  const list = ids || Object.keys(ARMOR).filter((id) => {
    const k = ARMOR[id].kind;
    return (k === 'vest' || k === 'helmet') && !ARMOR[id].hidden;
  });
  let n = 0;
  for (const id of list) { if (!CACHE.has(id)) { buildGear(id); n++; } }
  return n;
}

// Which bone a piece belongs on, so a caller does not have to know the table.
export const GEAR_BONE = { vest: 'chest', rig: 'chest', backpack: 'chest', helmet: 'head', mask: 'head', headgear: 'head' };
export function gearBone(id) { const d = ARMOR[id]; return d ? (GEAR_BONE[d.kind] || 'chest') : null; }

// Global grime dial (0 = factory fresh, 1 = issued and lived in). Shared: it moves every piece at once.
export function setGearGrime(v) { gearMaterial().userData.u.uGrime.value = clamp01(v); }

// Teardown only. Clones share their prototype's geometry, so anything still in the scene breaks after this;
// call it when the whole world is going away, not on a Tide reset.
export function disposeGear() {
  for (const g of CACHE.values()) if (g) g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  CACHE.clear();
}

// The optional context hook: a future swap onto ctx.materials reads the library through here.
export function gearContext() { return ctxOf(); }
