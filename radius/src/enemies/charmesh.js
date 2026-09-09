// Characters. The mimic is a Soviet winter uniform with nothing inside it — a MENACING DOLL, not a matte-black
// absence and not a blocky toy soldier. The distinction is the whole file:
//
//   proportion   Drillis & Contini stature fractions on a 1.92 m frame: ankle 0.039H, knee 0.276H, hip joint
//                0.521H, shoulder 0.810H, elbow 0.629H, wrist 0.478H, chin 0.865H, crown 1.0H. Then exactly
//                three deviations and no fourth: the head is 6 % small (the oldest mannequin cue there is),
//                the skull is craned 18 mm forward of its pivot, and the arms are 4 % long so the fingertips
//                fall below mid-thigh. Correct skeleton, few and local wrongnesses — which is what the
//                uncanny-valley literature says actually disturbs, as against being wrong everywhere.
//   joints       A doll's limb is [tapered mass] · gap · (ball) · gap · [tapered mass], so in outline it
//                PINCHES TWICE where a human limb pinches once. Shoulders and wrists get one ball, elbows and
//                knees get the ball-jointed-doll "peanut" — two balls 26 mm apart, which is what lets a limb
//                fold past ninety degrees. The balls are pale hard turned material; the rings facing into the
//                gaps are near-black and carry the ember channel, so the crack between two pieces glows.
//   head         Deliberately the LEAST detailed thing on a fully detailed body, carrying one shape event: a
//                shallow oval socket where a face should be. Blank works when it reads as a deletion from a
//                finished figure and reads as placeholder when the body is unfinished too.
//   silhouette   Lofted, never boxed. Every mass ends in a dome, never a flat disc; every line between two
//                joints reverses at least once (16 %, not the 5 % that does not read); cloth crossing a hard
//                edge breaks slack-tight-slack; seams are 2 mm proud welts, because a doll's seams are
//                geometry. Six builds x six head coverings x two coat lengths: a patrol of four is four men.
//   colour       DESIGN §6 called this a matte-black absence and every vertex colour sat at sRGB 0.02-0.06,
//                which made a hole in the frame that no amount of geometry could rescue. The body now lives
//                in a value band beneath the ground (0.45) and well above black: mid-tones 0.12-0.24, frost
//                bloom on up-faces to 0.34, rubbed edges to 0.40, pale collar ring and ball joints, one warm
//                ember at the joints. It is still wrong, still cold olive, still does not belong in daylight
//                — but you can see it. §5 of the report asks for DESIGN §6 to be rewritten to match.
//   surface      weathered() from weapons/gunmesh.js, ported onto a body: curvature-driven edge rub to bare
//                faded cloth, axial scratches, and five per-vertex patterns (telogreika quilt, webbing weave,
//                fur, felt, knurled steel) carried in an attribute so ONE draw call holds all of them.
//   skinning     two bones per vertex with a real blend across every joint; ball joints split 50/50 across
//                the two bones so they ROLL instead of shearing. Feet get their own bone and stay flat.
//   LOD          the same profiles regenerated at three densities and swapped on one SkinnedMesh bound to one
//                skeleton — no decimator, no second draw call, no THREE.LOD. 10.8 k / 4.2 k / 2.5 k.
//
// Contract (enemies/mimic.js drives it; enemies/phantom.js reuses the whole rig):
//   buildHumanoid({ loadout, height }) -> {
//     root, bones{ hips spine chest neck head shL shR foL foR thL thR snL snR ftL ftR gun, handR }, material,
//     rig (the poser: stepFlag, flinch, kick, glitchOn, startGlitch(), muzzle, B, pose()),
//     attach(gunGroup|null), wear(vestId, helmetId, packId), setState(s), update(dt), dispose() }
//   The returned object has no `stub` flag, which is how mimic.js knows to use it.
//
// Cost: ~10.8 k triangles and ONE draw call per body at LOD0 — the spawn's density (5,900 tris per metre of
// height) applied to a 1.85 m figure. Geometry is built once per (build, head, coat, detail) and shared; only
// the skeleton and the material are per actor.
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
// Where each elbow wants to go. The firing arm's elbow rides out and slightly up (that is what shouldering a
// rifle does to it); the support arm's tucks down and in under the fore-end.
const POLE_R = new THREE.Vector3(0.92, -0.28, 0.52).normalize();
const POLE_L = new THREE.Vector3(-0.34, -0.90, 0.42).normalize();

const ctxOf = () => (typeof globalThis !== 'undefined' && globalThis.__radius && globalThis.__radius.ctx) || null;

// =====================================================================================================
// Material. One program, one instance per actor (the death dissolve and the shiver level are per actor, so the
// uniforms cannot be shared). Colour rides in the vertex colour attribute; aSurf is (roughness, metalness,
// shiver mask, sheen). The rim uniforms ARE shared — every body catches the same sky.
// =====================================================================================================
const SHARED = {
  uRim: { value: 0.75 }, uRimCol: { value: new THREE.Color(0.16, 0.18, 0.21) },
  uFill: { value: new THREE.Color(0.30, 0.32, 0.34) },
};
const FILL_K = 3.2;    // how much of the overcast dome the body is allowed to gather. Tuned by render.
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
  // the same sky, gathered as indirect diffuse. Scales with albedo, so it is what makes the palette read.
  SHARED.uFill.value.setRGB(h.r * 0.5 + z.r * 0.5, h.g * 0.5 + z.g * 0.5, h.b * 0.5 + z.b * 0.5)
    .multiplyScalar(FILL_K * (1 - night * 0.72));
}

const CHAR_VERT = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf; varying vec4 vWear; varying float vPh;
attribute vec4 aSurf; attribute vec4 aWear; attribute float aPhase; attribute vec3 aJit;
uniform float uTime, uShiver, uSeed;`;
const CHAR_FRAG = `
varying vec3 vCPos; varying vec3 vCN; varying vec3 vWN; varying vec4 vSurf; varying vec4 vWear; varying float vPh;
uniform float uDissolve, uGrime, uRim, uEmber, uTime, uSeed;
uniform vec3 uRimCol, uDust, uBare, uMud, uEmberCol, uFill;`;

function charCompile(shader) {
  const u = this.userData.u;
  for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
  for (const k in u) shader.uniforms[k] = u[k];
  shader.uniforms.uRim = SHARED.uRim;
  shader.uniforms.uRimCol = SHARED.uRimCol;
  shader.uniforms.uFill = SHARED.uFill;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${CHAR_VERT}`)
    .replace('#include <skinning_vertex>', /* glsl */`#include <skinning_vertex>
      {
        float ph = aPhase * 61.7 + uSeed;
        float slot = floor(uTime * 20.0 + aPhase * 5.0);
        float n1 = hash11(slot + ph) - 0.5;
        float n2 = hash11(slot * 1.31 + ph * 0.7 + 3.1) - 0.5;
        float spike = step(0.945, hash11(slot * 0.11 + ph * 3.3));
        float amp = uShiver * (0.022 + spike * 0.062) * vSurfShiver;
        transformed += (objectNormal * n1 * 0.7 + aJit * n2) * amp;
      }
      vCPos = transformed;
      vCN = objectNormal;
      vWN = normalize(mat3(modelMatrix) * objectNormal);`)
    // aSurf has to be read before the shiver block uses its mask
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSurf = aSurf;\n  vWear = aWear;\n  vPh = aPhase;\n  float vSurfShiver = aSurf.z;');
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
        // Cloth is never one value. This is weathered() from weapons/gunmesh.js brought onto a body: a
        // low-frequency mottle, curvature-driven edge rub down to bare faded cloth, woven/quilted/furred
        // surface patterns carried per-vertex so one draw call holds all of them, frost bloom on what faces
        // the sky, and wet mud below the knee.
        float n1 = vnoise3(vCPos * 9.0);
        float n2 = vnoise3(vCPos * 31.0);
        diffuseColor.rgb *= 0.82 + 0.40 * n1 + 0.12 * n2;

        // 1 telogreika quilt, 2 webbing weave, 3 fur, 4 felt, 5 knurled/pitted steel
        float pk = vWear.z;
        if (pk > 0.5) {
          float pat = 0.0;
          if (pk < 1.5)      pat = smoothstep(0.30, 0.70, 0.5 + 0.5 * sin(vCPos.y * 190.0 + n1 * 2.2));       // 33 mm channels
          else if (pk < 2.5) pat = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(vCPos.y * 620.0)) * 0.5
                                 + smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(vCPos.x * 620.0 + vCPos.z * 400.0)) * 0.5;
          else if (pk < 3.5) pat = smoothstep(0.42, 0.92, vnoise3(vCPos * vec3(240.0, 90.0, 240.0)));         // fur clumps
          else if (pk < 4.5) pat = smoothstep(0.40, 0.80, vnoise3(vCPos * 150.0)) * 0.6 + 0.2;                // matted felt
          else               pat = smoothstep(0.45, 0.75, 0.5 + 0.5 * sin(vCPos.y * 900.0 + vCPos.x * 900.0));
          diffuseColor.rgb *= 1.0 - 0.30 * (pat - 0.5);
        }

        // edge wear from curvature — the one change that stops cloth reading as a cutout
        float curv = length(fwidth(vNormal)) / max(length(fwidth(vCPos)), 1e-6);
        float edge = smoothstep(150.0, 560.0, curv) * smoothstep(0.28, 0.72, n2) * vWear.x;
        float sc = smoothstep(0.930, 0.972, vnoise(vec2(vCPos.y * 70.0 + uSeed, vCPos.x * 260.0 + vCPos.z * 170.0))) * vWear.x;
        diffuseColor.rgb = mix(diffuseColor.rgb, uBare, clamp(edge + sc * 0.75, 0.0, 0.9));

        // frost bloom: the wool has gone grey-white on every up-facing surface and never lifted
        float up = clamp(vCN.y, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDust, up * up * 0.34 * uGrime * vWear.y * (0.35 + 0.65 * n1));
        float mud = smoothstep(0.34, -0.06, vCPos.y) * uGrime * vWear.y;
        diffuseColor.rgb = mix(diffuseColor.rgb, uMud, mud * 0.42 * (0.4 + 0.6 * n2));
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.32, 0.30), dsv);`)
    .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      roughnessFactor = clamp(vSurf.x + (vnoise3(vCPos * 44.0) - 0.5) * 0.13 - vSurf.w * 0.18, 0.05, 1.0);`)
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vSurf.y;')
    // A torch at a metre is hundreds of times daylight and burns a mimic to a white cut-out. Cap the spot and
    // point contribution per fragment the way weapons/gunmesh.js caps it on the viewmodel; the sun, moon and
    // hemisphere are untouched, so the body still reads the time of day.
    .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
      .replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( 7.0 ) );')
      .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );', 'getSpotLightInfo( spotLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( 5.0 ) );'))
    // the sky fill: a wrapped hemisphere gather, diffuse only, so a jacket, a boot, a collar ring and a pale
    // felt overboot are four different values instead of four flavours of the same near-black
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += uFill * (0.40 + 0.60 * clamp(vWN.y * 0.5 + 0.5, 0.0, 1.0)) * BRDF_Lambert(material.diffuseColor);`)
    // the ember in the joint gaps: the only warm light on the thing, and the channel the AI writes its tells into
    .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      totalEmissiveRadiance += uEmberCol * (uEmber * vWear.w * (0.60 + 0.40 * sin(uTime * 2.2 + vPh * 30.0)));`)
    .replace('#include <opaque_fragment>', /* glsl */`#include <opaque_fragment>
      {
        // Sky rim. On an overcast day the whole dome is the key light, so a dark shape still carries a pale
        // edge — the thing that separates a mimic from a birch trunk at forty metres. It used to be gated
        // off below 2.5 m, which is why the edge was missing in every close portrait; it now holds a third
        // of its strength at arm's length and opens up with distance.
        float fres = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        float dist = length(vViewPosition);
        float gate = mix(0.34, 1.0, smoothstep(1.5, 14.0, dist));
        float k = pow(fres, 1.9) * gate * (0.40 + 0.60 * clamp(vWN.y * 0.55 + 0.55, 0.0, 1.0));
        gl_FragColor.rgb += uRimCol * (k * uRim * (1.0 - dsv));
      }`);
}

export function makeCharMaterial(o = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.userData.u = {
    uTime: { value: 0 }, uShiver: { value: o.shiver ?? 1 }, uDissolve: { value: 0 },
    uSeed: { value: Math.random() * 100 }, uGrime: { value: o.grime ?? 1 },
    uDust: { value: new THREE.Color(o.dust ?? 0x8e8a7c) },        // frost bloom on up-faces
    uMud: { value: new THREE.Color(o.mud ?? 0x3a3026) },          // wet ground below the knee
    uBare: { value: new THREE.Color(o.bare ?? 0x6a6656) },        // rubbed through to faded cloth
    uEmber: { value: o.ember ?? 0.45 },
    uEmberCol: { value: new THREE.Color(o.emberCol ?? 0xb45a1e) },
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
  cloth: [0.97, 0.00, 1.00, 0.02],
  coat: [0.93, 0.00, 1.00, 0.06],
  wool: [0.99, 0.00, 1.00, 0.00],
  fur: [0.99, 0.00, 1.25, 0.00],
  felt: [0.99, 0.00, 0.85, 0.00],
  leather: [0.58, 0.02, 0.70, 0.34],
  web: [0.62, 0.02, 0.85, 0.30],
  rubber: [0.85, 0.02, 0.45, 0.10],
  skin: [0.55, 0.00, 1.10, 0.24],
  hard: [0.45, 0.06, 0.30, 0.30],
  steel: [0.38, 0.26, 0.20, 0.30],
  gap: [0.90, 0.00, 0.35, 0.00],
};
// wear: [edge rub, grime/frost, surface pattern (1 quilt, 2 weave, 3 fur, 4 felt, 5 steel), joint ember]
const WR = {
  none: [0, 0, 0, 0],
  cloth: [0.85, 1.0, 1, 0],
  plain: [0.70, 1.0, 0, 0],
  coat: [0.90, 1.0, 0, 0],
  wool: [0.55, 1.0, 0, 0],
  fur: [0.40, 0.7, 3, 0],
  felt: [0.55, 0.9, 4, 0],
  web: [1.00, 0.8, 2, 0],
  leather: [1.00, 1.0, 0, 0],
  sole: [0.40, 1.0, 0, 0],
  skin: [0.00, 0.3, 0, 0],
  hard: [1.00, 0.8, 5, 0],
  ball: [1.00, 0.5, 0, 0],
  gap: [0.00, 0.4, 0, 1],
};
// DESIGN §6 called the mimic a matte-black absence and every value here used to sit at sRGB 0.02-0.06, which
// made a hole in the frame that no amount of geometry could rescue. It is now a Soviet winter uniform with
// nothing inside it: bleached of dye, bloomed grey-white with frost, its joints mechanical and pale. Body
// mid-tones live in 0.12-0.24, below the ground (0.45) and the sky (0.55) and well above black.
const COL = {
  cloth: 0x31382c,      // telogreika / jacket, cold olive
  clothB: 0x373f31,     // panel and pocket variation
  trouser: 0x262a20,    // greyer and bluer, so the two masses separate
  coat: 0x36372e,       // greatcoat
  wool: 0x3b3f33,       // cap and hood
  fur: 0x594f43,        // ushanka band
  web: 0x372e25,        // belt, sling, straps: warm brown-black, gloss is the contrast
  glove: 0x2e2821,
  boot: 0x2e2821,
  sole: 0x45423c,       // the one part that ever takes a highlight
  valenki: 0x6a6459,    // pale grey felt overboots, no heel. Reads at any range
  skin: 0x222227,       // waxy blue-grey, never flesh
  collar: 0x5e594e,     // the hard turned collar ring: the doll tell
  ball: 0x4a452f,       // ball joints, the same hard turned material
  socket: 0x141611,     // the depression where a face was removed
  gap: 0x0d0a08,        // inside the joint gaps, where the ember lives
  hard: 0x3c3f42,
  helmet: 0x4a5040,
};

class Skin {
  // Vertices land in growable typed arrays; colour and surface are recorded once per tint() as a span, not per
  // vertex, because a body is a handful of materials over thousands of triangles.
  constructor() {
    this.cap = 4096; this.n = 0;
    this.p = new Float32Array(this.cap * 3);
    this.b = new Float32Array(this.cap * 3);
    this.spans = []; this.s = SF.cloth; this.w = WR.cloth;
    this.tint(COL.cloth, SF.cloth, WR.cloth);
  }
  // One span per material change: colour, surface (roughness/metalness/shiver/sheen) and wear
  // (edge/grime/pattern/ember). Twelve floats per span, a handful of spans over thousands of triangles.
  tint(hex, surf, wear) {
    _c.setHex(hex);
    const s = surf || this.s, w = wear || this.w;
    this.spans.push(this.n, _c.r, _c.g, _c.b, s[0], s[1], s[2], s[3], w[0], w[1], w[2], w[3]);
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
    this.b[i] = v[3]; this.b[i + 1] = v[4] === undefined ? v[3] : v[4]; this.b[i + 2] = v[5] || 0;
    this.n++;
  }
  tri(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;             // collapsed: a pole fan or a zero-width cap
    this.vert(a); this.vert(b); this.vert(c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get tris() { return this.n / 3; }
  // Weld, crease and index in one pass over flat arrays. three's toCreasedNormals + mergeVertices do the same
  // job through BufferAttribute accessors and string hashes and cost 170 ms a body, which is a dropped frame
  // every time a new build type spawns; this is the same result in about a tenth of the time.
  finish(scale = 1, creaseCos = 0.5) {
    const p = this.p, N = this.n;
    if (!N) return null;
    // expand the material spans into per-vertex lookups
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
    // buckets of coincident vertices, keyed on the millimetre. Numeric keys: three 12-bit fields in a double.
    const buckets = new Map(), bkey = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const qx = Math.round(p[i * 3] * 1000) + 2048, qy = Math.round(p[i * 3 + 1] * 1000) + 2048, qz = Math.round(p[i * 3 + 2] * 1000) + 2048;
      const k = (qx * 4096 + qy) * 4096 + qz;
      bkey[i] = k;
      const bk = buckets.get(k);
      if (bk) bk.push(i); else buckets.set(k, [i]);
    }
    // crease: a vertex takes the average of the faces at its position within the crease angle of its own
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
    // index: inside a bucket, merge vertices that agree on normal, material span and bones
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
      for (let a = 0; a < list.length; a += 2) {          // the bucket holds [outIdx, srcIdx] pairs
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
    g.setAttribute('aWear', new THREE.BufferAttribute(oR.subarray(0, M * 4), 4));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(oI.subarray(0, M * 4), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(oW.subarray(0, M * 4), 4));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aJit', new THREE.BufferAttribute(jdir, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95 * scale, 0), 1.5 * scale);
    this.p = null; this.b = null; this.spans.length = 0; this.n = 0;
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
// Connect a stack of rings. The winding assumes the stack runs along +y; anything built top-down (arms, legs,
// boots) or forward (feet) must pass flip, or its faces point inwards and the part is invisible under
// front-face culling. capA/capB fan the end rings to their centroid, with the fan facing along the stack.
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

// ---------------------------------------------------------------- the doll language
// A limb on a doll is not a tube. It is [tapered mass] · gap · (ball) · gap · [tapered mass], so in outline it
// PINCHES TWICE where a human limb pinches once — which is the single cheapest way to make a figure read as
// articulated rather than moulded. Everything below exists to build that shape cheaply and repeatedly.

// Scale a ring about its own centre and slide it along y. Used for the turned-in ring at every mass end.
function shrinkRing(ring, k, dy) {
  const c = centreOf(ring), out = [];
  for (const v of ring) out.push([c[0] + (v[0] - c[0]) * k, v[1] + dy, c[2] + (v[2] - c[2]) * k, v[3], v[4], v[5]]);
  return out;
}
// Key sections in, evenly spaced rings out. Radii, powers and weights interpolate; bone indices step, because
// a bone index is a name, not a number. This is what lets one profile serve LOD0 and LOD1 from one description.
//   key = { y, rx, rf, rb, pow, b0, b1, w, jit, seed, seg }
function resample(keys, step, seg, extra) {
  const out = [];
  const emit = (k) => {
    const q = ringY(k.y, k.rx, k.rf ?? k.rx, k.rb ?? (k.rf ?? k.rx), {
      seg: k.seg || seg, pow: k.pow ?? 2.2, cx: k.cx || 0, cz: k.cz || 0,
      b0: k.b0 || 0, b1: k.b1 === undefined ? (k.b0 || 0) : k.b1, w: k.w || 0,
      jit: k.jit || 0, seed: k.seed || 1,
    });
    if (extra) extra(q, k);
    out.push(q);
  };
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
        jit: lerp(A.jit || 0, B.jit || 0, t), seed: (A.seed || 1) + j, seg: A.seg,
      });
    }
  }
  emit(keys[keys.length - 1]);
  return out;
}
// A ball joint. Five rings of a slightly squared sphere with domed poles: the piece a ball-jointed doll has
// between two limb segments, and the thing you actually see moving when the limb bends.
function ball(S, cx, cy, cz, r, o = {}) {
  const { seg = 14, rings = 5, pow = 2.5, b0 = 0, b1 = b0, w = 0.5, sy = 1.0, sz = 1.0, col = COL.ball, surf = SF.hard, wear = WR.ball } = o;
  const R = [];
  for (let i = 0; i < rings; i++) {
    const t = -0.92 + 1.84 * i / (rings - 1);
    const k = Math.sqrt(Math.max(0.03, 1 - t * t));
    R.push(ringY(cy + t * r * sy, r * k, r * k * sz, r * k * sz, { seg, pow, cx, cz, b0, b1, w }));
  }
  S.tint(col, surf, wear);
  loft(S, R, {
    capA: true, capB: true,
    cA: [cx, cy - r * sy, cz, b0, b1, w], cB: [cx, cy + r * sy, cz, b0, b1, w],
  });
}
// The BJD "peanut": two balls a short distance apart on the bone axis, so the limb folds in two stages and the
// outline pinches twice. Elbows and knees get this; wrists and shoulders get a single ball.
function peanut(S, cx, cy, cz, r, gap, o = {}) {
  const wA = o.wA ?? 0.30, wB = o.wB ?? 0.70;
  ball(S, cx, cy - gap * 0.5, cz, r, Object.assign({}, o, { w: wA }));
  ball(S, cx, cy + gap * 0.5, cz, r * (o.k2 ?? 0.94), Object.assign({}, o, { w: wB }));
}
// A limb mass. The stack is lofted in its own colour; the rings that face into a joint gap are lofted
// separately in the gap colour with the ember channel lit, so the crack between two pieces glows.
function limbMass(S, rings, o = {}) {
  const { col = COL.cloth, surf = SF.cloth, wear = WR.cloth, rA = 0, rB = 0, gap = true } = o;
  const n = rings.length;
  const gCol = gap ? COL.gap : col, gSurf = gap ? SF.gap : surf, gWear = gap ? WR.gap : wear;
  if (rA > 0) {
    const a = shrinkRing(rings[0], 0.58, -rA * 0.34);
    const c = centreOf(a); c[1] -= rA * 0.22;
    S.tint(gCol, gSurf, gWear);
    loft(S, [a, rings[0]], { capA: true, cA: c });
  }
  S.tint(col, surf, wear);
  loft(S, rings, { capA: rA <= 0, capB: rB <= 0 });
  if (rB > 0) {
    const b = shrinkRing(rings[n - 1], 0.58, rB * 0.34);
    const c = centreOf(b); c[1] += rB * 0.22;
    S.tint(gCol, gSurf, gWear);
    loft(S, [rings[n - 1], b], { capB: true, cB: c });
  }
}
// A seam welt: a two-ring band standing proud of the surface with its own tint. Seams on a doll are geometry,
// not a texture, and they have to survive to LOD1 — this is the cheapest detail in the file that does.
function welt(S, y, rx, rf, rb, o = {}) {
  const { seg = 16, pow = 2.2, cx = 0, cz = 0, b0 = 0, b1 = b0, w = 0, h = 0.010, proud = 1.024, col = COL.clothB, surf = SF.cloth, wear = WR.plain } = o;
  S.tint(col, surf, wear);
  loft(S, [
    ringY(y - h, rx, rf, rb, { seg, pow, cx, cz, b0, b1, w }),
    ringY(y - h * 0.4, rx * proud, rf * proud, rb * proud, { seg, pow, cx, cz, b0, b1, w }),
    ringY(y + h * 0.4, rx * proud, rf * proud, rb * proud, { seg, pow, cx, cz, b0, b1, w }),
    ringY(y + h, rx, rf, rb, { seg, pow, cx, cz, b0, b1, w }),
  ]);
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
  shoulder: 1.555, elbow: 1.207, wrist: 0.918,
  hip: 1.000, knee: 0.530, ankle: 0.075, crown: 1.920,
};
const L1 = Y.shoulder - Y.elbow;      // 0.335 humerus
const L2 = Y.elbow - Y.wrist;         // 0.275 forearm to the grip
// The rifle at low ready and at the shoulder, chest-bone local.
const GUN_REST = [0.072, -0.010, -0.175];
// Shouldered: the buttplate (gun-local z +0.27 on a Kalashnikov) lands in the shoulder pocket, the bore ends up
// at chin height and the receiver stands clear of the chest. Everything about the aiming pose falls out of this.
const GUN_AIM = [0.075, 0.300, -0.330];

// ---------------------------------------------------------------- builds
// sh: shoulder joint half-span. chest/waist/hip: torso half-widths. gut: belly. arm/thigh/calf: limb radii.
// head is scaled down 6 % from anatomical: a small head is the oldest mannequin cue there is, and it makes a
// 1.85 m figure read taller than it is.
const BUILDS = [
  { id: 'lean', s: 0.998, sh: 0.172, chest: 0.183, waist: 0.140, hip: 0.156, gut: 0.00, arm: 0.049, fore: 0.042, thigh: 0.084, calf: 0.058, head: 0.921, slouch: 0.020, neck: 0.056 },
  { id: 'reg', s: 1.000, sh: 0.181, chest: 0.194, waist: 0.152, hip: 0.164, gut: 0.10, arm: 0.054, fore: 0.045, thigh: 0.090, calf: 0.062, head: 0.940, slouch: 0.000, neck: 0.060 },
  { id: 'broad', s: 0.990, sh: 0.197, chest: 0.211, waist: 0.169, hip: 0.176, gut: 0.20, arm: 0.061, fore: 0.050, thigh: 0.097, calf: 0.067, head: 0.959, slouch: -0.014, neck: 0.067 },
  { id: 'heavy', s: 0.975, sh: 0.192, chest: 0.214, waist: 0.194, hip: 0.190, gut: 0.60, arm: 0.063, fore: 0.051, thigh: 0.105, calf: 0.071, head: 0.968, slouch: 0.030, neck: 0.069 },
  { id: 'wiry', s: 1.020, sh: 0.169, chest: 0.176, waist: 0.136, hip: 0.150, gut: 0.00, arm: 0.046, fore: 0.040, thigh: 0.080, calf: 0.056, head: 0.902, slouch: 0.048, neck: 0.053 },
  { id: 'stocky', s: 0.965, sh: 0.187, chest: 0.203, waist: 0.172, hip: 0.180, gut: 0.34, arm: 0.058, fore: 0.048, thigh: 0.099, calf: 0.068, head: 0.978, slouch: 0.012, neck: 0.065 },
];
const BASE_SCALE = 0.968;            // unit crown 1.92 -> 1.859, which is the mimic's standing capsule
const HEADS = ['bare', 'cap', 'hood', 'ushankaUp', 'ushankaDown', 'ssh60'];

// ---------------------------------------------------------------- the body
// Detail levels regenerate from the same profiles rather than decimating: LOD0 is the specified figure, LOD1
// drops the segment count, doubles the ring spacing, loses the quilt, the face socket and the fingers, and
// keeps every seam welt because welts are what a silhouette is made of.
function LODP(lod) {
  return lod === 0
    ? { segT: 16, segL: 14, segB: 12, segS: 10, step: 1.0, quilt: true, socket: true, welts: true, fingers: true, ballRings: 5, kit: true }
    : lod === 1
      ? { segT: 10, segL: 8, segB: 8, segS: 6, step: 2.0, quilt: false, socket: true, welts: true, fingers: false, ballRings: 3, kit: true }
      : { segT: 8, segL: 6, segB: 6, segS: 6, step: 3.4, quilt: false, socket: false, welts: false, fingers: false, ballRings: 3, kit: false };
}

function buildBodyGeo(build, headKind, coat, seed, lod = 0) {
  const P = build;
  const S = new Skin();
  const L = LODP(lod);
  const segT = L.segT, segL = L.segL, segB = L.segB;
  const gut = P.gut, isCoat = coat === 'coat';
  const hemY = isCoat ? 0.615 : 0.902;
  const rr = (i) => h3(seed * 97 + i, 31, 7) - 0.5;   // this actor's own crookedness, stable per variant
  const helmeted = headKind === 'ssh60';
  const clothCol = isCoat ? COL.coat : COL.cloth, clothSF = isCoat ? SF.coat : SF.cloth, clothWR = isCoat ? WR.coat : WR.cloth;
  const quilt = L.quilt && !isCoat ? 0.017 : 0;      // telogreika channels: 33 mm, and the base/elite tell at 40 m

  // ---- torso: seat -> waist -> chest -> trapezius, quilted in horizontal channels. The channels are real
  // geometry, not a texture: they are what makes the jacket read as wadded cotton in outline.
  const tj = 0.006;
  const ripple = (ring, k) => {
    if (!quilt || k.y < 0.95 || k.y > 1.53) return;
    const q = 1 + quilt * Math.sin(k.y * 190.4);
    const cx = k.cx || 0, cz = k.cz || 0;
    for (const v of ring) { v[0] = cx + (v[0] - cx) * q; v[2] = cz + (v[2] - cz) * q; }
  };
  const torsoKeys = [
    { y: 0.928, rx: P.hip * 0.95, rf: P.hip * 0.78 + gut * 0.008, rb: P.hip * 0.79, pow: 2.1, b0: BI.hips, jit: tj, seed: 3 },
    { y: 0.985, rx: P.hip * 1.00, rf: P.hip * 0.78 + gut * 0.016, rb: P.hip * 0.78, pow: 2.1, b0: BI.hips, jit: tj, seed: 5 },
    { y: 1.070, rx: P.waist * 1.02, rf: P.waist * 0.74 + gut * 0.030, rb: P.waist * 0.74, pow: 2.2, b0: BI.hips, b1: BI.spine, w: 0.35, jit: tj, seed: 6 },
    { y: 1.150, rx: P.waist * 1.03, rf: P.waist * 0.73 + gut * 0.026, rb: P.waist * 0.74, pow: 2.3, b0: BI.spine, jit: tj, seed: 7 },
    { y: 1.245, rx: P.chest * 0.93, rf: P.chest * 0.62 + gut * 0.012, rb: P.chest * 0.62, pow: 2.4, b0: BI.spine, b1: BI.chest, w: 0.45, jit: tj, seed: 8 },
    { y: 1.320, rx: P.chest, rf: P.chest * 0.615, rb: P.chest * 0.600, pow: 2.4, b0: BI.chest, cx: rr(1) * 0.006, jit: tj, seed: 9 },
    { y: 1.400, rx: P.chest * 1.015, rf: P.chest * 0.585, rb: P.chest * 0.565, pow: 2.4, b0: BI.chest, jit: tj, seed: 10 },
    { y: 1.468, rx: P.chest * 0.975, rf: P.chest * 0.520, rb: P.chest * 0.500, pow: 2.3, b0: BI.chest, jit: tj * 0.6, seed: 11 },
    { y: 1.522, rx: P.chest * 0.880, rf: P.chest * 0.440, rb: P.chest * 0.440, pow: 2.1, b0: BI.chest, jit: tj * 0.6, seed: 12 },
    { y: 1.562, rx: P.chest * 0.700, rf: P.chest * 0.390, rb: P.chest * 0.400, pow: 2.0, b0: BI.chest, jit: tj * 0.5, seed: 13 },
    { y: 1.594, rx: P.chest * 0.430, rf: P.chest * 0.330, rb: P.chest * 0.350, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.35, cz: 0.004 },
  ];
  const torso = resample(torsoKeys, (quilt ? 0.0110 : 0.0180) * L.step, segT, ripple);
  // the shoulders are not level: one rides a centimetre higher and six millimetres further forward on
  // everybody — EXCEPT under a helmet, where the shoulder board (below) pulls them dead level, which on an
  // otherwise crooked body is far worse to look at than the crookedness was
  const tilt = helmeted ? 0 : rr(2) * 0.020;
  const fwd = helmeted ? 0 : rr(6) * 0.012;
  for (const ring of torso) {
    const t = clamp01((ring[0][1] - 1.40) / 0.19);
    if (t <= 0) continue;
    for (const v of ring) { const k = clamp(v[0] * 6, -1, 1); v[1] += tilt * k * t; v[2] += fwd * k * t; }
  }
  S.tint(clothCol, clothSF, clothWR);
  loft(S, torso, { capA: true });

  // ---- the hem: cloth breaking over a hard thing is slack, tight, slack. A greatcoat carries its mass here
  // and the legs inside it are thinner than they should be, which is the whole point of a greatcoat.
  const flare = isCoat ? 0.115 : 0.030;
  const hemKeys = isCoat ? [
    { y: hemY, rx: P.hip * 1.00 + flare, rf: P.hip * 0.86 + flare, rb: P.hip * 0.88 + flare, pow: 2.0, b0: BI.hips, jit: 0.013, seed: 30 },
    { y: hemY + 0.055, rx: P.hip * 0.98 + flare * 0.80, rf: P.hip * 0.84 + flare * 0.8, rb: P.hip * 0.86 + flare * 0.8, pow: 2.0, b0: BI.hips, jit: 0.010, seed: 31 },
    { y: hemY + 0.190, rx: P.hip * 0.98 + flare * 0.46, rf: P.hip * 0.83 + flare * 0.46, rb: P.hip * 0.85 + flare * 0.46, pow: 2.0, b0: BI.hips, jit: 0.008, seed: 32 },
    { y: 0.960, rx: P.hip * 1.01 + flare * 0.16, rf: P.hip * 0.82 + flare * 0.2, rb: P.hip * 0.83 + flare * 0.2, pow: 2.1, b0: BI.hips, jit: 0.007, seed: 33 },
    { y: 1.030, rx: P.waist * 1.06, rf: P.waist * 0.80, rb: P.waist * 0.80, pow: 2.2, b0: BI.hips, b1: BI.spine, w: 0.25, jit: 0.005, seed: 34 },
  ] : [
    { y: hemY, rx: P.hip * 1.02 + flare, rf: P.hip * 0.84 + flare, rb: P.hip * 0.86 + flare, pow: 2.0, b0: BI.hips, jit: 0.011, seed: 30 },
    { y: hemY + 0.030, rx: P.hip * 1.00 + flare * 0.55, rf: P.hip * 0.81 + flare * 0.5, rb: P.hip * 0.83 + flare * 0.5, pow: 2.0, b0: BI.hips, jit: 0.006, seed: 31 },
    { y: hemY + 0.072, rx: P.hip * 1.03 + flare * 0.30, rf: P.hip * 0.83 + flare * 0.3, rb: P.hip * 0.84 + flare * 0.3, pow: 2.1, b0: BI.hips, jit: 0.009, seed: 32 },
    { y: 1.010, rx: P.hip * 0.99, rf: P.hip * 0.78 + gut * 0.014, rb: P.hip * 0.79, pow: 2.1, b0: BI.hips, jit: 0.005, seed: 33 },
  ];
  S.tint(clothCol, clothSF, isCoat ? WR.coat : WR.plain);
  loft(S, resample(hemKeys, 0.020 * L.step, segT), {});
  if (L.welts) welt(S, hemY + 0.008, P.hip * 1.02 + flare, P.hip * 0.84 + flare, P.hip * 0.86 + flare,
    { seg: segT, pow: 2.0, b0: BI.hips, h: 0.009, proud: 1.030, col: COL.clothB, surf: clothSF, wear: WR.leather });

  // ---- neck, and the hard turned collar ring that is the single loudest doll tell on the model
  const hs = P.head, skullY = 1.790, craneZ = -0.018;
  const rx = 0.082 * hs, ry = 0.125 * hs, rz = 0.102 * hs;
  const nk = P.neck;
  S.tint(COL.skin, SF.skin, WR.skin);
  loft(S, [
    ringY(1.535, nk * 1.14, nk * 1.06, nk * 1.16, { seg: segT, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.55, cz: 0.006 }),
    ringY(1.590, nk * 0.99, nk * 0.95, nk * 1.02, { seg: segT, pow: 2.0, b0: BI.neck, cz: 0.002 }),
    ringY(1.640, nk * 0.96, nk * 0.94, nk * 1.00, { seg: segT, pow: 2.0, b0: BI.neck, b1: BI.head, w: 0.5, cz: -0.004 }),
    ringY(1.684, nk * 0.98, nk * 0.98, nk * 1.06, { seg: segT, pow: 2.0, b0: BI.neck, b1: BI.head, w: 0.75, cz: -0.010 }),
  ]);
  // the turned collar: pale, hard, machined. 96 triangles, and it is what makes people say "doll".
  S.tint(COL.collar, SF.hard, WR.ball);
  loft(S, [
    ringY(1.586, nk * 1.00, nk * 0.96, nk * 1.03, { seg: segT, pow: 2.0, b0: BI.neck, cz: 0.002 }),
    ringY(1.594, nk * 1.07, nk * 1.03, nk * 1.10, { seg: segT, pow: 2.0, b0: BI.neck, cz: 0.002 }),
    ringY(1.606, nk * 1.08, nk * 1.04, nk * 1.11, { seg: segT, pow: 2.0, b0: BI.neck, cz: 0.001 }),
    ringY(1.614, nk * 1.01, nk * 0.97, nk * 1.04, { seg: segT, pow: 2.0, b0: BI.neck, cz: 0.000 }),
  ]);

  // ---- skull. The head is deliberately the LEAST detailed thing on the body — but it carries one shape
  // event, a shallow oval socket where a face should be, so it reads as a face REMOVED rather than a face
  // never modelled. That distinction is the whole difference between unsettling and unfinished.
  const hu = [-0.985, -0.86, -0.70, -0.52, -0.32, -0.10, 0.12, 0.34, 0.54, 0.72, 0.86, 0.955];
  const socketC = [0.003, skullY - 0.016 * hs, 0], socketR = [0.031 * hs / 0.94, 0.039 * hs / 0.94];
  const headRings = hu.map((t, i) => {
    const y = skullY + t * ry;
    const k = Math.sqrt(Math.max(0.02, 1 - t * t));
    const low = clamp01(-(t + 0.24) / 0.74);                       // jaw: narrower and pushed forward
    const kx = k * (1 - low * 0.30), kzF = k * (1 - low * 0.10), kzB = k * (1 - low * 0.34);
    const ring = ringY(y, rx * kx, rz * kzF, rz * kzB, {
      seg: segT, pow: 2.15, cx: 0.004 + rr(3) * 0.004, cz: 0.006 + craneZ - low * 0.012,
      b0: BI.head, jit: i > 0 && i < 9 ? 0.0025 : 0,
    });
    if (L.socket) for (const v of ring) {
      if (v[2] > socketC[2]) continue;                             // front of the skull only
      const dx = (v[0] - socketC[0]) / socketR[0], dy = (v[1] - socketC[1]) / socketR[1];
      const d = Math.hypot(dx, dy);
      const f = 1 - clamp01((d - 0.52) / 0.48);
      if (f > 0) v[2] += 0.0180 * hs * f * f * (3 - 2 * f);        // the hollow the socket sits in
    }
    return ring;
  });
  S.tint(COL.skin, SF.skin, WR.skin);
  loft(S, headRings, { capB: true, cB: [0.004, skullY + ry, 0.006 + craneZ, BI.head, BI.head, 0] });
  // The socket itself: a rim that stands a millimetre proud of the skull, a lip, and a floor pulled back
  // into the hollow the rings above made room for. Two bands and a fan — 64 triangles that turn "no face"
  // into "a face has been removed", which is the only version of blank that reads as designed.
  if (L.socket) {
    const ellipseZ = (px, py) => {                 // where the skull surface is at this point on its front
      const t = (py - skullY) / ry, u = (px - 0.004) / rx;
      const k = Math.sqrt(Math.max(0.02, 1 - t * t - u * u));
      return -(rz * k) + 0.006 + craneZ;
    };
    const oval = (sc, push) => {
      const ring = [];
      for (let i = 0; i < segT; i++) {
        const a = (i / segT) * TAU;
        const px = socketC[0] + 0.004 + Math.sin(a) * socketR[0] * sc;
        const py = socketC[1] + Math.cos(a) * socketR[1] * sc;
        ring.push([px, py, ellipseZ(px, py) + push, BI.head, BI.head, 0]);
      }
      return ring;
    };
    S.tint(COL.socket, SF.skin, WR.plain);
    const wall = [oval(1.00, -0.0012), oval(0.84, 0.0042), oval(0.52, 0.0082)];
    const cz0 = ellipseZ(socketC[0] + 0.004, socketC[1]) + 0.0100;
    loft(S, wall, { flip: true, capB: true, cB: [socketC[0] + 0.004, socketC[1], cz0, BI.head, BI.head, 0] });
  }

  // ---- head covering
  if (headKind === 'hood') buildHood(S, P, rx, rz, skullY, seed, L, craneZ);
  else if (headKind === 'cap') buildCap(S, P, rx, rz, seed, L, craneZ);
  else if (headKind === 'ushankaUp' || headKind === 'ushankaDown') buildUshanka(S, P, rx, ry, rz, skullY, seed, L, craneZ, headKind === 'ushankaDown');
  else if (headKind === 'ssh60') buildSsh(S, P, rx, ry, rz, skullY, seed, L, craneZ);

  // ---- jacket collar: a stand-up collar that breaks the neck line and half-hides the turned ring
  S.tint(isCoat ? COL.coat : COL.clothB, clothSF, WR.plain);
  const cTop = isCoat ? 1.646 : 1.612;
  loft(S, [
    ringY(1.536, nk * 1.44, nk * 1.36, nk * 1.46, { seg: segT, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.30, cz: 0.006 }),
    ringY(cTop - 0.028, nk * 1.52, nk * 1.42, nk * 1.54, { seg: segT, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.40, cz: 0.006, jit: 0.004, seed: 21 }),
    ringY(cTop, nk * 1.62, nk * 1.48, nk * 1.66, { seg: segT, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.45, cz: 0.006, jit: 0.005, seed: 22 }),
    ringY(cTop - 0.012, nk * 1.26, nk * 1.20, nk * 1.30, { seg: segT, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.45, cz: 0.006 }),
    ringY(1.542, nk * 1.10, nk * 1.06, nk * 1.14, { seg: segT, pow: 2.0, b0: BI.chest, b1: BI.neck, w: 0.25, cz: 0.006 }),
  ]);

  // ---- arms
  for (const side of [-1, 1]) {
    const bs = side < 0 ? BI.shL : BI.shR, bf = side < 0 ? BI.foL : BI.foR;
    const x = side * P.sh, dz = -0.010, jitS = side < 0 ? 40 : 60;
    const A = P.arm, F = P.fore;
    const eR = Math.max(A * 0.90, F * 1.16) * 1.06;          // elbow ball
    const sR = A * 1.16 * 1.04;                              // shoulder ball
    const wR = F * 0.94 * 1.06;                              // wrist ball

    // hand first (the stack runs upward), then wrist, forearm, elbow, upper arm, shoulder
    buildHand(S, P, side, x, dz, bf, seed, L);
    ball(S, x, Y.wrist + 0.030, dz, wR, { seg: segL, rings: L.ballRings, b0: bf, w: 0, sy: 0.86 });

    // forearm: swells 24 % below the elbow, pinches at the cuff. Five per cent does not read; sixteen does.
    const fore = resample([
      { y: Y.wrist + 0.062, rx: F * 0.82, rf: F * 0.80, rb: F * 0.80, pow: 2.2, cx: x, cz: dz, b0: bf },
      { y: Y.wrist + 0.086, rx: F * 0.98, rf: F * 0.96, rb: F * 0.96, pow: 2.2, cx: x, cz: dz, b0: bf, jit: 0.0022, seed: jitS + 3 },
      { y: Y.elbow - 0.100, rx: F * 1.24, rf: F * 1.22, rb: F * 1.20, pow: 2.2, cx: x, cz: dz, b0: bf, jit: 0.0022, seed: jitS + 4 },
      { y: Y.elbow - 0.044, rx: F * 1.00, rf: F * 1.00, rb: F * 0.98, pow: 2.15, cx: x, cz: dz, b0: bs, b1: bf, w: 0.86 },
    ], 0.026 * L.step, segL);
    limbMass(S, fore, { col: clothCol, surf: clothSF, wear: clothWR, rA: F * 0.86, rB: F * 1.00 });
    if (L.welts) welt(S, Y.wrist + 0.072, F * 0.90, F * 0.88, F * 0.88,
      { seg: segL, pow: 2.2, cx: x, cz: dz, b0: bf, h: 0.008, proud: 1.10, col: COL.clothB, surf: clothSF, wear: WR.leather });

    // the elbow peanut: two balls 26 mm apart, so the arm pinches twice and folds in two stages
    peanut(S, x, Y.elbow, dz, eR, 0.026, { seg: segL, rings: L.ballRings, b0: bs, b1: bf, wA: 0.72, wB: 0.30, sy: 0.92 });

    const upper = resample([
      { y: Y.elbow + 0.044, rx: A * 0.80, rf: A * 0.80, rb: A * 0.80, pow: 2.2, cx: x, cz: dz, b0: bs, b1: bf, w: 0.14 },
      { y: Y.elbow + 0.090, rx: A * 0.96, rf: A * 0.96, rb: A * 0.95, pow: 2.2, cx: x, cz: dz, b0: bs, jit: 0.0022, seed: jitS + 2 },
      { y: Y.shoulder - 0.160, rx: A * 1.22, rf: A * 1.20, rb: A * 1.18, pow: 2.2, cx: x, cz: dz, b0: bs, jit: 0.0022, seed: jitS + 1 },
      { y: Y.shoulder - 0.070, rx: A * 1.04, rf: A * 1.02, rb: A * 1.02, pow: 2.2, cx: x, cz: dz, b0: bs },
    ], 0.026 * L.step, segL);
    limbMass(S, upper, { col: clothCol, surf: clothSF, wear: clothWR, rA: A * 0.86, rB: A * 1.06 });

    // the shoulder ball, and above it the deltoid cap that meets the torso
    ball(S, x, Y.shoulder - 0.016, dz, sR, { seg: segL, rings: L.ballRings, b0: BI.chest, b1: bs, w: 0.55, sy: 0.94 });
    const delt = resample([
      { y: Y.shoulder + 0.004, rx: A * 1.30, rf: A * 1.24, rb: A * 1.22, pow: 2.2, cx: x + side * 0.004, cz: dz, b0: BI.chest, b1: bs, w: 0.42 },
      { y: Y.shoulder + 0.034, rx: A * 1.16, rf: A * 1.12, rb: A * 1.10, pow: 2.2, cx: x - side * 0.006, cz: dz, b0: BI.chest, b1: bs, w: 0.36 },
      { y: Y.shoulder + 0.056, rx: A * 0.74, rf: A * 0.72, rb: A * 0.70, pow: 2.2, cx: x - side * 0.016, cz: dz, b0: BI.chest, b1: bs, w: 0.30 },
    ], 0.022 * L.step, segL);
    limbMass(S, delt, { col: clothCol, surf: clothSF, wear: clothWR, rA: A * 1.10, rB: A * 0.70, gap: false });
    if (L.welts) welt(S, Y.shoulder + 0.010, A * 1.28, A * 1.22, A * 1.20,
      { seg: segL, pow: 2.2, cx: x + side * 0.004, cz: dz, b0: BI.chest, b1: bs, w: 0.42, h: 0.008, proud: 1.055, col: COL.clothB, surf: clothSF, wear: WR.leather });
  }

  // ---- the bunraku shoulder board: a hard bar under the cloth that makes both shoulders exactly level while
  // the rest of the body stays crooked. Only on helmeted men, and it is the reason they read as issued.
  if (helmeted) {
    S.tint(COL.hard, SF.steel, WR.hard);
    const by = Y.shoulder + 0.048, bz = -0.014;
    strap(S, [
      [-P.sh - 0.016, by - 0.010, bz], [-P.sh * 0.55, by + 0.006, bz - 0.006], [0, by + 0.012, bz - 0.008],
      [P.sh * 0.55, by + 0.006, bz - 0.006], [P.sh + 0.016, by - 0.010, bz],
    ], 0.058, 0.020, BI.chest, BI.chest, 0);
    for (const side of [-1, 1]) {
      loft(S, [
        ringY(by + 0.010, P.arm * 0.60, P.arm * 0.66, P.arm * 0.62, { seg: L.segS, pow: 2.6, cx: side * (P.sh + 0.006), cz: bz, b0: BI.chest, b1: side < 0 ? BI.shL : BI.shR, w: 0.35 }),
        ringY(by + 0.030, P.arm * 0.52, P.arm * 0.58, P.arm * 0.54, { seg: L.segS, pow: 2.6, cx: side * (P.sh + 0.006), cz: bz, b0: BI.chest, b1: side < 0 ? BI.shL : BI.shR, w: 0.35 }),
      ], { capA: true, capB: true });
    }
  }

  // ---- legs: trousers over the leg, bunched above the boot, with a real knee
  for (const side of [-1, 1]) {
    const bt = side < 0 ? BI.thL : BI.thR, bs = side < 0 ? BI.snL : BI.snR;
    const x = side * (P.hip * 0.56), sd = side < 0 ? 200 : 230;
    const bunch = 0.010 + h3(seed + sd, 5, 9) * 0.016;
    const T = P.thigh * (isCoat ? 0.90 : 1.0);      // the coat is full; what is under it is not
    const C = P.calf * (isCoat ? 0.94 : 1.0);
    const kR = Math.max(T * 0.90, C * 1.28) * 1.06;

    buildBoot(S, P, side, x, bs, side < 0 ? BI.ftL : BI.ftR, seed, L, side * (0.06 + h3(seed + sd, 3, 3) * 0.10));

    const shin = resample([
      { y: 0.234, rx: C * 1.00 + bunch, rf: C * 1.02 + bunch, rb: C * 1.04 + bunch, pow: 2.3, cx: x, b0: bs, jit: 0.010, seed: sd + 7 },
      { y: 0.268, rx: C * 0.90, rf: C * 0.92, rb: C * 0.94, pow: 2.2, cx: x, b0: bs, jit: 0.004, seed: sd + 6 },
      { y: 0.318, rx: C * 1.02 + bunch * 0.5, rf: C * 1.04 + bunch * 0.5, rb: C * 1.06 + bunch * 0.5, pow: 2.3, cx: x, b0: bs, jit: 0.009, seed: sd + 5 },
      { y: 0.392, rx: C * 1.22, rf: C * 1.20, rb: C * 1.30, pow: 2.2, cx: x, cz: 0.008, b0: bs, jit: 0.0028, seed: sd + 4 },
      { y: Y.knee - 0.108, rx: C * 1.14, rf: C * 1.14, rb: C * 1.20, pow: 2.2, cx: x, cz: 0.005, b0: bs, jit: 0.0028, seed: sd + 3 },
      { y: Y.knee - 0.052, rx: C * 0.94, rf: C * 0.96, rb: C * 0.96, pow: 2.15, cx: x, b0: bt, b1: bs, w: 0.86 },
    ], 0.028 * L.step, segL);
    S.tint(COL.trouser, SF.cloth, WR.plain);
    limbMass(S, shin, { col: COL.trouser, surf: SF.cloth, wear: WR.plain, rA: C * 1.00, rB: C * 0.98 });

    peanut(S, x, Y.knee, 0.004, kR, 0.028, { seg: segL, rings: L.ballRings, b0: bt, b1: bs, wA: 0.74, wB: 0.28, sy: 0.94 });

    const thigh = resample([
      { y: Y.knee + 0.052, rx: T * 0.80, rf: T * 0.84, rb: T * 0.82, pow: 2.2, cx: x, b0: bt, b1: bs, w: 0.16 },
      { y: Y.knee + 0.110, rx: T * 0.90, rf: T * 0.93, rb: T * 0.91, pow: 2.2, cx: x, b0: bt, jit: 0.0028, seed: sd + 2 },
      { y: Y.hip - 0.150, rx: T * 1.08, rf: T * 1.09, rb: T * 1.07, pow: 2.2, cx: x, b0: bt, jit: 0.0030, seed: sd + 1 },
      { y: Y.hip - 0.020, rx: T * 1.04, rf: T * 1.05, rb: T * 1.03, pow: 2.2, cx: x, b0: BI.hips, b1: bt, w: 0.68, jit: 0.0028, seed: sd },
      { y: 1.048, rx: T * 1.00, rf: T * 1.00, rb: T * 1.00, pow: 2.2, cx: x, b0: BI.hips, b1: bt, w: 0.25 },
    ], 0.030 * L.step, segL);
    limbMass(S, thigh, { col: COL.trouser, surf: SF.cloth, wear: WR.plain, rA: T * 0.86, rB: 0, gap: true });
  }

  // ---- personal kit: belt, sling and one hip item, chosen off the variant so a patrol is not five clones
  if (L.kit) buildPersonalKit(S, P, ['none', 'satchel', 'canteen'][seed % 3], seed, L);
  return S;
}

// The hand. A mitten is the most toy-like thing you can put on a figure, so this is a fist: a palm block, a
// fused finger mass wrapped forward around a grip with a knuckle welt across it, and a thumb laid over them.
// Simplified, never mitten-like — at two metres you can count that it has a thumb.
function buildHand(S, P, side, x, dz, bf, seed, L) {
  const F = P.fore, seg = L.segL, y = Y.wrist;
  const hx = x - side * 0.004;
  S.tint(COL.glove, SF.leather, WR.leather);
  // palm: from the heel of the hand up into the cuff
  loft(S, [
    ringY(y - 0.076, F * 0.86, F * 0.62, F * 0.70, { seg, pow: 2.6, cx: hx - side * 0.006, cz: dz - 0.010, b0: bf }),
    ringY(y - 0.052, F * 1.02, F * 0.72, F * 0.80, { seg, pow: 2.6, cx: hx - side * 0.004, cz: dz - 0.008, b0: bf }),
    ringY(y - 0.022, F * 1.06, F * 0.76, F * 0.84, { seg, pow: 2.5, cx: hx, cz: dz - 0.004, b0: bf }),
    ringY(y + 0.004, F * 0.94, F * 0.86, F * 0.86, { seg, pow: 2.3, cx: x, cz: dz, b0: bf }),
  ], { capA: true, capB: true });
  if (!L.fingers) return;
  // fused fingers: three sections running forward from the palm, curling down onto the grip
  const fseg = Math.max(6, seg - 2);
  const fz = [dz - 0.004, dz - 0.030, dz - 0.056, dz - 0.074];
  const fw = [F * 0.98, F * 1.00, F * 0.92, F * 0.66];
  const fh = [F * 0.86, F * 0.90, F * 0.80, F * 0.54];
  const fy = [y - 0.048, y - 0.056, y - 0.070, y - 0.086];
  const fingers = fz.map((z, i) => ringZ(z, fw[i], fh[i], fh[i] * 0.9, { seg: fseg, pow: 2.7, cx: hx - side * 0.004, cy: fy[i], b0: bf }));
  loft(S, fingers, { flip: true, capA: true, capB: true });
  // the knuckle: a welt across the back of the fingers, which is where a hand catches light
  S.tint(COL.web, SF.leather, WR.leather);
  loft(S, [
    ringZ(dz - 0.020, F * 1.00, F * 0.88, F * 0.92, { seg: fseg, pow: 2.7, cx: hx - side * 0.004, cy: y - 0.053, b0: bf }),
    ringZ(dz - 0.028, F * 1.03, F * 0.92, F * 0.95, { seg: fseg, pow: 2.7, cx: hx - side * 0.004, cy: y - 0.055, b0: bf }),
    ringZ(dz - 0.036, F * 1.00, F * 0.88, F * 0.92, { seg: fseg, pow: 2.7, cx: hx - side * 0.004, cy: y - 0.058, b0: bf }),
  ], { flip: true });
  // the thumb: laid across the front of the fingers, which is what a hand on a grip actually does
  S.tint(COL.glove, SF.leather, WR.leather);
  const tseg = Math.max(6, seg - 4);
  const tx = hx - side * F * 0.72;
  loft(S, [
    ringZ(dz + 0.004, F * 0.42, F * 0.44, F * 0.44, { seg: tseg, pow: 2.5, cx: tx, cy: y - 0.026, b0: bf }),
    ringZ(dz - 0.022, F * 0.40, F * 0.42, F * 0.42, { seg: tseg, pow: 2.5, cx: tx + side * F * 0.10, cy: y - 0.038, b0: bf }),
    ringZ(dz - 0.046, F * 0.34, F * 0.36, F * 0.36, { seg: tseg, pow: 2.5, cx: tx + side * F * 0.26, cy: y - 0.050, b0: bf }),
    ringZ(dz - 0.062, F * 0.24, F * 0.25, F * 0.25, { seg: tseg, pow: 2.5, cx: tx + side * F * 0.40, cy: y - 0.058, b0: bf }),
  ], { flip: true, capA: true, capB: true });
}

// The boot: a shaft the trouser bunches onto, an ankle that pinches, a foot swept forward with a heel break
// and a toe, and a sole that stands proud all the way round. One build in six wears valenki instead — pale
// grey felt cylinders with no defined heel, which is the most Eastern-European object on the model and the
// only part of a mimic that reads at any distance in any light.
function buildBoot(S, P, side, x, boneShin, boneFoot, seed, L, toe) {
  const seg = L.segB;
  const felt = (seed % 6) === 3;
  const col = felt ? COL.valenki : COL.boot, surf = felt ? SF.felt : SF.leather, wr = felt ? WR.felt : WR.leather;
  const w = P.calf * (felt ? 0.98 : 0.86);
  const ct = Math.cos(toe), st = Math.sin(toe);
  const spin = (ring) => { for (const v of ring) { const dx = v[0] - x, dz = v[2]; v[0] = x + dx * ct - dz * st; v[2] = dx * st + dz * ct; } return ring; };
  S.tint(col, surf, wr);
  loft(S, resample([
    { y: 0.100, rx: w * 0.92, rf: w * 0.96, rb: w * 1.06, pow: 2.5, cx: x, cz: 0.004, b0: boneShin, b1: boneFoot, w: 0.4 },
    { y: 0.148, rx: w * 0.94, rf: w * 0.98, rb: w * 1.04, pow: 2.4, cx: x, b0: boneShin, jit: 0.004, seed: seed + 11 },
    { y: 0.196, rx: w * 1.06, rf: w * 1.08, rb: w * 1.10, pow: 2.4, cx: x, b0: boneShin },
    { y: 0.222, rx: w * 1.02, rf: w * 1.04, rb: w * 1.06, pow: 2.4, cx: x, b0: boneShin },
  ], 0.022 * L.step, seg), { flip: true, capB: true });
  if (L.welts) welt(S, 0.200, w * 1.06, w * 1.08, w * 1.10,
    { seg, pow: 2.4, cx: x, b0: boneShin, h: 0.008, proud: 1.05, col: felt ? COL.valenki : COL.web, surf, wear: wr });
  // the foot, swept from the heel forward. Sections are XY rounded rectangles; the sole is flat, the instep
  // domed, and the profile reverses four times — heel out, ankle in, instep out, toe in.
  const k = P.calf / 0.062;
  const fz = [0.100, 0.070, 0.036, -0.006, -0.052, -0.100, -0.146, -0.180];
  const fw = [0.044, 0.052, 0.057, 0.060, 0.059, 0.055, 0.046, 0.029];
  const ft = felt
    ? [0.108, 0.106, 0.100, 0.092, 0.080, 0.066, 0.052, 0.038]
    : [0.086, 0.104, 0.108, 0.100, 0.086, 0.072, 0.056, 0.038];
  S.tint(col, surf, wr);
  loft(S, fz.map((z, i) => spin(ringZ(z, fw[i] * k, 0.024 + ft[i], 0.024, { seg, pow: 2.9, cx: x, cy: 0.024, b0: boneFoot }))),
    { flip: true, capA: true, capB: true });
  // the sole: a slab with a welt that overhangs, in a different material so it separates. Rubber is the one
  // surface on the whole creature that ever takes a proper highlight — keep it.
  S.tint(felt ? COL.valenki : COL.sole, felt ? SF.felt : SF.rubber, WR.sole);
  const sz = [0.104, 0.060, 0.010, -0.044, -0.100, -0.150, -0.186];
  const sw2 = [0.048, 0.058, 0.063, 0.064, 0.058, 0.047, 0.030];
  loft(S, sz.map((z, i) => spin(ringZ(z, sw2[i] * k, 0.027, 0.027, { seg, pow: 3.4, cx: x, cy: 0.027, b0: boneFoot }))),
    { flip: true, capA: true, capB: true });
}

// A hood: a cowl on the head with a fabric fall that breaks over the shoulders. The dome rides the head bone,
// the fall rides the chest — which is exactly how a hood behaves when the man inside it turns to look at you.
function buildHood(S, P, rx, rz, skullY, seed, L, craneZ) {
  S.tint(COL.wool, SF.wool, WR.wool);
  const seg = L.segT;
  const R = 0.030;                               // slack between skull and cloth
  const hy = [1.686, 1.720, 1.760, 1.804, 1.850, 1.890, 1.920, 1.936];
  const rings = hy.map((y, i) => {
    const t = clamp((y - (skullY + 0.012)) / (0.125 + R), -1, 1);
    const k = Math.sqrt(Math.max(0.05, 1 - t * t));
    const s = 1 + (i === 0 ? 0.12 : 0);
    return ringY(y, (rx + R) * k * s, (rz + R * 0.7) * k * s, (rz + R * 1.5) * k * s, {
      seg, pow: 2.1, cx: 0.004, cz: 0.010 + craneZ + (1 - k) * 0.012, b0: BI.head, jit: 0.006, seed: seed + 70 + i,
    });
  });
  loft(S, rings, { capB: true, cB: [0.004, 1.948, 0.020 + craneZ, BI.head, BI.head, 0] });
  // the fall: a short cape from the nape onto the shoulders, open at the front
  const fall = [];
  for (const [y, r, w] of [[1.680, 0.108, 0.0], [1.640, 0.130, 0.18], [1.610, 0.150, 0.35], [1.575, 0.174, 0.55], [1.545, 0.196, 0.75], [1.500, 0.222, 1.0]]) {
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = lerp(0.72, TAU - 0.72, i / seg);
      const sa = Math.sin(a), ca = Math.cos(a);
      const j = (h3(i * 17 + seed, Math.round(y * 500), 3) - 0.5) * 0.014;
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
function buildCap(S, P, rx, rz, seed, L, craneZ) {
  S.tint(COL.wool, SF.wool, WR.wool);
  const seg = L.segT;
  const rings = [];
  for (const [y, k] of [[1.828, 1.10], [1.852, 1.08], [1.874, 1.04], [1.896, 0.92], [1.916, 0.62]]) {
    rings.push(ringY(y, rx * k + 0.010, rz * k + 0.010, rz * k + 0.012, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head, jit: 0.005, seed: seed + 90 }));
  }
  loft(S, rings, { capB: true, cB: [0.004, 1.926, 0.006 + craneZ, BI.head, BI.head, 0] });
  // the band, then the peak
  S.tint(COL.web, SF.leather, WR.leather);
  loft(S, [
    ringY(1.822, rx * 1.10 + 0.010, rz * 1.10 + 0.010, rz * 1.10 + 0.012, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head }),
    ringY(1.832, rx * 1.14 + 0.010, rz * 1.14 + 0.010, rz * 1.14 + 0.012, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head }),
    ringY(1.842, rx * 1.10 + 0.010, rz * 1.10 + 0.010, rz * 1.10 + 0.012, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head }),
  ]);
  S.tint(COL.hard, SF.hard, WR.hard);
  const pk = [];
  for (const [z, y, w] of [[-rz - 0.006, 1.830, 0.90], [-rz - 0.055, 1.821, 0.86], [-rz - 0.092, 1.810, 0.66]]) {
    const row = [];
    for (let i = 0; i <= 6; i++) { const t = (i / 6) * 2 - 1; row.push([0.004 + t * rx * w, y + Math.abs(t) * 0.006, z + craneZ + Math.abs(t) * 0.014, BI.head, BI.head, 0]); }
    pk.push(row);
  }
  for (let r = 0; r < pk.length - 1; r++) for (let i = 0; i < 6; i++) {
    S.quad(pk[r][i], pk[r][i + 1], pk[r + 1][i + 1], pk[r + 1][i]);
    S.quad(pk[r + 1][i], pk[r + 1][i + 1], pk[r][i + 1], pk[r][i]);
  }
}

// The ushanka. Flaps UP widen the head silhouette by about forty per cent; flaps DOWN hang two lobes at the
// jaw. Either way the fur band around the brow is a different material from everything else on the model, and
// at forty metres the widened head is how you tell this man from the one beside him.
function buildUshanka(S, P, rx, ry, rz, skullY, seed, L, craneZ, down) {
  const seg = L.segT, R = 0.020;
  S.tint(COL.wool, SF.wool, WR.wool);
  const hy = [1.812, 1.842, 1.872, 1.900, 1.924, 1.940];
  const rings = hy.map((y, i) => {
    const t = clamp((y - (skullY + 0.010)) / (0.118 + R), -1, 1);
    const k = Math.sqrt(Math.max(0.06, 1 - t * t));
    return ringY(y, (rx + R) * k * 1.04, (rz + R) * k * 1.02, (rz + R) * k * 1.08, {
      seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head, jit: 0.007, seed: seed + 120 + i,
    });
  });
  loft(S, rings, { capB: true, cB: [0.004, 1.948, 0.006 + craneZ, BI.head, BI.head, 0] });
  // the fur band round the brow
  S.tint(COL.fur, SF.fur, WR.fur);
  loft(S, [
    ringY(1.796, (rx + R) * 1.06, (rz + R) * 1.06, (rz + R) * 1.10, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head, jit: 0.010, seed: seed + 130 }),
    ringY(1.812, (rx + R) * 1.15, (rz + R) * 1.14, (rz + R) * 1.20, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head, jit: 0.012, seed: seed + 131 }),
    ringY(1.832, (rx + R) * 1.13, (rz + R) * 1.12, (rz + R) * 1.18, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head, jit: 0.012, seed: seed + 132 }),
    ringY(1.848, (rx + R) * 1.02, (rz + R) * 1.02, (rz + R) * 1.06, { seg, pow: 2.1, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head, jit: 0.008, seed: seed + 133 }),
  ]);
  // the two flaps
  const fseg = Math.max(6, seg - 4);
  for (const side of [-1, 1]) {
    const cx = 0.004 + side * (rx + R) * 0.98;
    if (down) {
      loft(S, [
        ringY(1.812, rx * 0.42, rz * 0.50, rz * 0.52, { seg: fseg, pow: 2.4, cx, cz: 0.004 + craneZ, b0: BI.head, jit: 0.006, seed: seed + 140 }),
        ringY(1.760, rx * 0.46, rz * 0.54, rz * 0.56, { seg: fseg, pow: 2.4, cx: cx + side * 0.006, cz: 0.004 + craneZ, b0: BI.head, jit: 0.008, seed: seed + 141 }),
        ringY(1.706, rx * 0.42, rz * 0.50, rz * 0.52, { seg: fseg, pow: 2.4, cx: cx + side * 0.008, cz: 0.002 + craneZ, b0: BI.head, jit: 0.008, seed: seed + 142 }),
        ringY(1.672, rx * 0.28, rz * 0.34, rz * 0.34, { seg: fseg, pow: 2.4, cx: cx + side * 0.008, cz: 0.002 + craneZ, b0: BI.head, jit: 0.006, seed: seed + 143 }),
      ], { capA: true, capB: true });
    } else {
      loft(S, [
        ringY(1.840, rx * 0.44, rz * 0.52, rz * 0.54, { seg: fseg, pow: 2.4, cx, cz: 0.004 + craneZ, b0: BI.head, jit: 0.006, seed: seed + 145 }),
        ringY(1.888, rx * 0.50, rz * 0.56, rz * 0.58, { seg: fseg, pow: 2.4, cx: cx + side * 0.014, cz: 0.004 + craneZ, b0: BI.head, jit: 0.009, seed: seed + 146 }),
        ringY(1.930, rx * 0.46, rz * 0.50, rz * 0.52, { seg: fseg, pow: 2.4, cx: cx + side * 0.022, cz: 0.002 + craneZ, b0: BI.head, jit: 0.009, seed: seed + 147 }),
        ringY(1.958, rx * 0.28, rz * 0.32, rz * 0.32, { seg: fseg, pow: 2.4, cx: cx + side * 0.024, cz: 0.002 + craneZ, b0: BI.head, jit: 0.006, seed: seed + 148 }),
      ], { capA: true, capB: true });
    }
  }
}

// SSh-60: a continuous dome with a brim that flares all the way round and no separate visor. The flare is the
// entire tell — a helmet whose brim does not flare reads NATO — and it costs one ring pushed out 14 % and
// down 6 mm.
function buildSsh(S, P, rx, ry, rz, skullY, seed, L, craneZ) {
  const seg = L.segT, R = 0.016;
  S.tint(COL.helmet, SF.steel, WR.hard);
  const hy = [1.798, 1.822, 1.848, 1.874, 1.898, 1.918, 1.934];
  const rings = hy.map((y) => {
    const t = clamp((y - (skullY + 0.006)) / (0.120 + R), -1, 1);
    const k = Math.sqrt(Math.max(0.10, 1 - t * t));
    return ringY(y, (rx + R) * k * 1.05, (rz + R) * k * 1.03, (rz + R) * k * 1.06, {
      seg, pow: 2.05, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head,
    });
  });
  // the flared brim: one ring pushed out and down, and the shell rolled under it
  rings.unshift(ringY(1.786, (rx + R) * 1.14, (rz + R) * 1.14, (rz + R) * 1.18, { seg, pow: 2.05, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head }));
  rings.unshift(ringY(1.792, (rx + R) * 1.02, (rz + R) * 1.02, (rz + R) * 1.06, { seg, pow: 2.05, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head }));
  loft(S, rings, { capA: true, capB: true, cB: [0.004, 1.944, 0.006 + craneZ, BI.head, BI.head, 0] });
  // the liner band showing under the brim, and a chinstrap
  S.tint(COL.web, SF.leather, WR.web);
  loft(S, [
    ringY(1.770, (rx + R) * 0.96, (rz + R) * 0.96, (rz + R) * 1.00, { seg, pow: 2.05, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head }),
    ringY(1.790, (rx + R) * 1.00, (rz + R) * 1.00, (rz + R) * 1.04, { seg, pow: 2.05, cx: 0.004, cz: 0.006 + craneZ, b0: BI.head }),
  ]);
  strap(S, [
    [0.004 - (rx + R) * 0.95, 1.776, 0.004 + craneZ], [0.004 - (rx + R) * 0.70, 1.716, -0.020 + craneZ],
    [0.004, 1.700, -0.030 + craneZ],
    [0.004 + (rx + R) * 0.70, 1.716, -0.020 + craneZ], [0.004 + (rx + R) * 0.95, 1.776, 0.004 + craneZ],
  ], 0.016, 0.006, BI.head, BI.head, 0);
}

// A swept strap: shoulder slings, satchel straps, anything that crosses the body. Corners run +side+up,
// -side+up, -side-up, +side-up, which puts the outward face out.
function strap(S, pts, w, t, b0, b1, wgt) {
  const n = pts.length; if (n < 2) return;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], P = pts[i];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ty) > 0.94) { ux = 1; uy = 0; }
    let sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const nx = sy * tz - sz * ty, ny = sz * tx - sx * tz, nz = sx * ty - sy * tx;
    const hw = w / 2, ht = t / 2;
    rings.push([
      [P[0] + sx * hw + nx * ht, P[1] + sy * hw + ny * ht, P[2] + sz * hw + nz * ht, b0, b1, wgt],
      [P[0] - sx * hw + nx * ht, P[1] - sy * hw + ny * ht, P[2] - sz * hw + nz * ht, b0, b1, wgt],
      [P[0] - sx * hw - nx * ht, P[1] - sy * hw - ny * ht, P[2] - sz * hw - nz * ht, b0, b1, wgt],
      [P[0] + sx * hw - nx * ht, P[1] + sy * hw - ny * ht, P[2] + sz * hw - nz * ht, b0, b1, wgt],
    ]);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    S.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]);
  }
  const F = rings[0], L = rings[n - 1];
  S.quad(F[0], F[1], F[2], F[3]);
  S.quad(L[3], L[2], L[1], L[0]);
}
// Personal kit that is part of the man, not of his loadout: the belt everyone wears, the sling that says he
// carries a rifle even when you cannot see the rifle, and one of a satchel or a canteen on the hip. It lives in
// the body geometry, so it is free — no extra draw call, no extra material, and it varies with the build.
function buildPersonalKit(S, P, kind, seed, L) {
  const wa = P.waist, seg = L.segB;
  // ---- belt
  S.tint(COL.web, SF.leather, WR.leather);
  loft(S, [
    ringY(1.078, wa * 0.98, wa * 0.72, wa * 0.72, { seg, pow: 2.2, b0: BI.hips, b1: BI.spine, w: 0.35 }),
    ringY(1.086, wa * 1.06, wa * 0.79, wa * 0.79, { seg, pow: 2.2, b0: BI.hips, b1: BI.spine, w: 0.35 }),
    ringY(1.126, wa * 1.07, wa * 0.80, wa * 0.80, { seg, pow: 2.2, b0: BI.hips, b1: BI.spine, w: 0.45 }),
    ringY(1.134, wa * 0.99, wa * 0.73, wa * 0.73, { seg, pow: 2.2, b0: BI.hips, b1: BI.spine, w: 0.45 }),
  ], { capA: true, capB: true });
  const bz = -(wa * 0.79 + 0.006);
  S.tint(COL.collar, SF.steel, WR.hard);
  loft(S, [
    ringY(1.090, 0.028, 0.006, 0.006, { seg: 6, pow: 3.0, cz: bz, b0: BI.hips, b1: BI.spine, w: 0.4 }),
    ringY(1.124, 0.028, 0.006, 0.006, { seg: 6, pow: 3.0, cz: bz, b0: BI.hips, b1: BI.spine, w: 0.4 }),
  ], { capA: true, capB: true });
  // ---- rifle sling over the right shoulder, down across the chest to the left hip
  S.tint(COL.web, SF.web, WR.web);
  strap(S, [
    [0.10, 1.560, 0.055], [0.135, 1.520, -0.020], [0.115, 1.430, -0.098],
    [0.045, 1.320, -0.128], [-0.045, 1.220, -0.126], [-0.115, 1.140, -0.108],
  ], 0.032, 0.008, BI.chest, BI.spine, 0.35);
  if (kind === 'satchel') {
    // a canvas map bag on the left hip, and the strap that holds it there
    S.tint(COL.clothB, SF.cloth, WR.plain);
    const cx = -(wa * 0.86), cy = 0.985;
    loft(S, [
      ringY(cy - 0.085, 0.088, 0.052, 0.040, { seg: 10, pow: 2.8, cx, cz: 0.012, b0: BI.hips, jit: 0.006, seed: seed + 210 }),
      ringY(cy - 0.020, 0.094, 0.058, 0.044, { seg: 10, pow: 2.8, cx, cz: 0.010, b0: BI.hips, jit: 0.006, seed: seed + 211 }),
      ringY(cy + 0.055, 0.090, 0.054, 0.042, { seg: 10, pow: 2.8, cx, cz: 0.008, b0: BI.hips, jit: 0.005, seed: seed + 212 }),
    ], { capA: true, capB: true });
    S.tint(COL.web, SF.web, WR.web);
    strap(S, [
      [cx, cy + 0.050, -0.048], [-0.120, 1.200, -0.110], [-0.150, 1.380, -0.090],
      [-0.150, 1.500, -0.020], [-0.130, 1.545, 0.055], [-0.100, 1.500, 0.100],
    ], 0.030, 0.007, BI.chest, BI.hips, 0.35);
  } else if (kind === 'canteen') {
    S.tint(COL.clothB, SF.cloth, WR.plain);
    const cx = wa * 0.84, cy = 1.035;
    loft(S, [
      ringY(cy - 0.072, 0.050, 0.036, 0.030, { seg: 10, pow: 2.4, cx, cz: 0.030, b0: BI.hips, jit: 0.004, seed: seed + 220 }),
      ringY(cy + 0.010, 0.054, 0.040, 0.034, { seg: 10, pow: 2.4, cx, cz: 0.028, b0: BI.hips, jit: 0.004, seed: seed + 221 }),
      ringY(cy + 0.048, 0.046, 0.034, 0.030, { seg: 10, pow: 2.4, cx, cz: 0.026, b0: BI.hips, jit: 0.004, seed: seed + 222 }),
    ], { capA: true, capB: true });
    // and a small utility pouch behind the left hip
    loft(S, [
      ringY(1.055, 0.056, 0.034, 0.030, { seg: 8, pow: 2.8, cx: -wa * 0.70, cz: 0.075, b0: BI.hips, jit: 0.005, seed: seed + 225 }),
      ringY(1.125, 0.058, 0.036, 0.032, { seg: 8, pow: 2.8, cx: -wa * 0.70, cz: 0.072, b0: BI.hips, b1: BI.spine, w: 0.3, jit: 0.005, seed: seed + 226 }),
    ], { capA: true, capB: true });
  }
}

// A rifle silhouette for the rare case that gunmesh hands back nothing: still unmistakably armed at 40 m.
function buildStandinGun() {
  const S = new Skin();
  S.tint(COL.hard, SF.steel, WR.hard);
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
function variantGeo(key, build, headKind, coat, seed, lod = 0) {
  const k = lod ? `${key}#${lod}` : key;
  let g = GEO.get(k);
  if (g !== undefined) return g;
  try {
    const S = buildBodyGeo(build, headKind, coat, seed, lod);
    g = S.finish(BASE_SCALE * build.s);
  } catch (e) { console.warn('[charmesh] body build failed', k, e); g = null; }
  GEO.set(k, g);
  return g;
}
const VARIANTS = [];
for (const b of BUILDS) for (const h of HEADS) for (const c of ['jacket', 'coat']) VARIANTS.push([b, h, c]);
const vkey = (b, h, c) => `${b.id}|${h}|${c}`;
// the geometry is shared, so its crookedness must come from the VARIANT, never from whoever asked for it first
function variantSeed(key) { let n = 0; for (let i = 0; i < key.length; i++) n = (n * 131 + key.charCodeAt(i)) | 0; return Math.abs(n % 9973); }
const PREWARM_MAX = 18;
let prewarmI = 0, prewarmOn = false;
function startPrewarm() {
  if (prewarmOn || typeof setTimeout !== 'function') return;
  prewarmOn = true;
  // One variant is 20-70 ms of lofting, so it goes in an idle callback where a browser has spare frame time,
  // and the queue stops at PREWARM_MAX: the rarer combinations can pay for themselves when they first spawn.
  const idle = typeof requestIdleCallback === 'function'
    ? (fn, ms) => requestIdleCallback(() => fn(), { timeout: ms })
    : (fn, ms) => setTimeout(fn, ms);
  const step = () => {
    // walk the list in an order that covers all six builds before it doubles back on head coverings
    while (prewarmI < PREWARM_MAX) {
      const [b, h, c] = VARIANTS[(prewarmI * 7) % VARIANTS.length];
      prewarmI++;
      if (GEO.has(vkey(b, h, c))) continue;
      variantGeo(vkey(b, h, c), b, h, c, variantSeed(vkey(b, h, c)));
      break;
    }
    if (prewarmI < PREWARM_MAX) idle(step, 900);
  };
  idle(step, 1500);
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

    this.geos = [geometry, null, null]; this.lod = 0;
    const mesh = this.mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = false;
    mesh.add(B.hips);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0 * s, 0), 1.5 * s);

    // gun-local space is NOT scaled with the body: a short man carries the same rifle as a tall one
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.012, -0.56); B.gun.add(this.muzzle);
    this.gripR = new THREE.Vector3(0, -0.052, -0.012);
    this.gripL = new THREE.Vector3(0, 0.020, -0.26);

    this.phase = Math.random() * TAU; this.stepFlag = 0; this.gait = 0; this.aim = 0; this.kick = 0;
    this.headYaw = 0; this.headPitch = 0; this.flinch = 0; this.bob = 0; this.crouch = 0; this.deadT = 0;
    this.breath = Math.random() * TAU; this.sway = Math.random() * TAU;
    this.glitch = new Float32Array(BONES.length * 3); this.glitchOn = false;
  }
  // LOD without a decimator and without a second draw call: the same skeleton, the same bind matrix, three
  // geometries regenerated from the same profiles, and one assignment to swap between them.
  setDetail(l) {
    if (l === this.lod) return;
    const g = this.geos[l];
    if (!g) return;
    this.lod = l; this.mesh.geometry = g;
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
    // Stride length is what stops the feet skating: one full cycle (two steps) covers 2 x stride metres, and a
    // man walking at 1.5 m/s covers about 1.5 m in a cycle, lengthening as he runs.
    const stride = (c.stride ?? (0.62 + 0.10 * speed)) * s;
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
    const thL = sL * swing + crouch * 1.05, thR = sR * swing + crouch * 1.02;
    B.thL.rotation.set(thL, 0, 0.025 + crouch * 0.10);
    B.thR.rotation.set(thR, 0, -0.025 - crouch * 0.10);
    const kL = Math.max(0, Math.cos(ph - 0.35)), kR = Math.max(0, Math.cos(ph + Math.PI - 0.35));
    const snL = -(kL * kL * 1.05 * g + crouch * 2.10), snR = -(kR * kR * 1.05 * g + crouch * 2.04);
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
      this.restHips.y - ((0.5 + 0.5 * Math.cos(2 * ph)) * 0.036 * this.bob + crouch * 0.478) * s,
      this.restHips.z + Math.sin(this.sway * 0.43) * 0.004 * idle * s);
    B.hips.rotation.set(-(0.055 + 0.075 * g + (c.lean || 0) + crouch * 0.30), Math.sin(ph) * 0.055 * g, -Math.sin(ph) * 0.05 * g);
    B.spine.rotation.set(0.02 - 0.045 * g + crouch * 0.16, -Math.sin(ph) * 0.05 * g, Math.sin(ph) * 0.02 * g);

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

    // ---- arms follow the rifle. The support shoulder protracts (the scapula slides forward and in) and the
    // firing shoulder shrugs, which is what actually lets a man reach the fore-end of a shouldered rifle.
    const ai = this.aim;
    B.shL.position.set(this.shPosL.x + 0.034 * ai * s, this.shPosL.y + 0.008 * ai * s, this.shPosL.z - 0.052 * ai * s);
    B.shR.position.set(this.shPosR.x - 0.012 * ai * s, this.shPosR.y + 0.016 * ai * s, this.shPosR.z + 0.008 * ai * s);
    this.solveArm(B.shL, B.foL, B.shL.position, _v.copy(this.gripL).applyMatrix4(gn.matrix), -1, POLE_L);
    this.solveArm(B.shR, B.foR, B.shR.position, _v.copy(this.gripR).applyMatrix4(gn.matrix), 1, POLE_R);

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
    B.shL.position.copy(this.shPosL); B.shR.position.copy(this.shPosR);
    this.solveArm(B.shL, B.foL, B.shL.position, _v.copy(this.gripL).applyMatrix4(gn.matrix), -1, POLE_L);
    this.solveArm(B.shR, B.foR, B.shR.position, _v.copy(this.gripR).applyMatrix4(gn.matrix), 1, POLE_R);
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
  solveArm(upperBone, foreBone, shoulder, target, side, pole) {
    const a1 = this.L1, a2 = this.L2;
    _dir.subVectors(target, shoulder);
    let d = _dir.length();
    const maxD = (a1 + a2) * 0.995;
    if (d > maxD) d = maxD; if (d < 0.02) d = 0.02;
    _dir.normalize();
    const cosA = clamp((a1 * a1 + d * d - a2 * a2) / (2 * a1 * d), -1, 1);
    const ang = Math.acos(cosA);
    _pole.copy(pole || (side > 0 ? POLE_R : POLE_L)).normalize();
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
    // Six coverings, not three. A patrol of four sharing one silhouette destroys the whole effect, and the
    // head is where a silhouette is cheapest to change: an ushanka with the flaps up is forty per cent wider
    // than a bare skull, and a flared SSh-60 brim reads Soviet at forty metres.
    // A loadout helmet is worn on the head bone by gearmesh, so those men get a bare or hooded head under it;
    // everyone else wears his own, and one in six of those is in an SSh-60 whose flared brim is the single
    // loudest Soviet read on the model.
    const headKind = hasHelmet
      ? (r2 < 0.22 ? 'hood' : 'bare')
      : pick(['ushankaDown', 'cap', 'ssh60', 'hood', 'ushankaUp', 'cap', 'ushankaDown', 'bare', 'hood', 'ushankaUp'], r2);
    const coat = (r3 < 0.22 && cls <= 3) ? 'coat' : 'jacket';

    this.build = build; this.headKind = headKind; this.coat = coat;
    this.gearScale = BASE_SCALE * build.s;
    this.kit = (lo && lo.kit) ? lo.kit.map((k) => k.id).filter((id) => ARMOR[id]) : [];
    if (lo && lo.pack && lo.pack.id) this.kit.push(lo.pack.id);

    const key = vkey(build, headKind, coat);
    this.vkey = key; this.vseed = variantSeed(key);
    const geo = variantGeo(key, build, headKind, coat, this.vseed);
    if (!geo) throw new Error('charmesh: body geometry failed');
    startPrewarm();

    this.material = makeCharMaterial({ shiver: 1, grime: 1 });
    this.rig = new Poser(build, geo, this.material);
    this.root = new THREE.Group();
    this.root.add(this.rig.mesh);
    this.bones = Object.assign({}, this.rig.B);
    this.bones.handR = this.rig.B.gun;
    this.worn = []; this.gun = null; this.standin = null; this.lodPhase = n & 7;
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
    // A support hand out at the muzzle end of a full-length rifle is beyond a real arm once the butt is at the
    // shoulder, so it grips no further forward than the magazine well.
    if (gr && gr.left && gr.left.p) this.rig.gripL.set(gr.left.p[0], gr.left.p[1] - 0.008, Math.max(-0.26, gr.left.p[2]));
  }
  // Worn kit. Vest and helmet come from the loadout through mimic.js; the rig, pack, mask and night sights come
  // from the loadout's `kit`, which nothing was putting on a body before.
  wear(vestId, helmetId, packId) {
    for (const g of this.worn) { if (g.parent) g.parent.remove(g); }
    this.worn.length = 0;
    const B = this.rig.B, sc = this.gearScale, bd = this.build;
    // gearmesh is authored against the average torso (chest half-width 0.194) and the average skull. A broad man
    // needs his vest let out and a wiry one needs it taken in, or the panel floats or sinks into the chest.
    const wide = sc * lerp(1, bd.chest / 0.194, 0.72);
    const hsc = sc * bd.head;
    const put = (g, bone, head) => {
      if (!g) return false;
      if (head) g.scale.setScalar(hsc); else g.scale.set(wide, sc, wide);
      g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.receiveShadow = false; } });
      bone.add(g); this.worn.push(g); return true;
    };
    let hasVest = false;
    try { hasVest = put(vestId ? buildVest(vestId) : null, B.chest); } catch (e) { /* a missing model must never kill a spawn */ }
    try { put(helmetId ? buildHelmet(helmetId) : null, B.head, true); } catch (e) { /* as above */ }
    try { put(packId ? buildPack(packId) : null, B.chest); } catch (e) { /* as above */ }
    for (const id of this.kit) {
      const d = ARMOR[id]; if (!d) continue;
      try {
        if (d.kind === 'rig') put(buildRig(id, { overVest: hasVest }), B.chest);
        else if (d.kind === 'backpack') { if (!packId) put(buildPack(id), B.chest); }
        else if (d.kind === 'mask') put(buildMask(id), B.head, true);
        else if (d.kind === 'headgear') put(buildHeadgear(id), B.head, true);
      } catch (e) { /* as above */ }
    }
    this.hasVest = hasVest;
  }
  set flinch(v) { this.rig.flinch = Math.max(this.rig.flinch, v); }
  get flinch() { return this.rig.flinch; }
  setState(s) { Object.assign(this.s, s); if (s && s.hit) this.rig.flinch = Math.max(this.rig.flinch, 1); }
  // The far ones are cheap. A near mimic is ~11 k triangles, a mid one 3.6 k and a far one 1.2 k, all on the
  // one skeleton, so a patrol of twelve costs about 43 k rather than the 131 k the budget allows.
  setDetail(dist) {
    const l = dist < 22 ? 0 : dist < 55 ? 1 : 2;
    if (l === this.rig.lod) return;
    if (!this.rig.geos[l]) {
      this.rig.geos[l] = variantGeo(this.vkey, this.build, this.headKind, this.coat, this.vseed, l);
      if (!this.rig.geos[l]) { this.rig.geos[l] = this.rig.geos[0]; }
    }
    this.rig.setDetail(l);
  }
  update(dt) {
    const s = this.s;
    const ctx = ctxOf();
    if (ctx) {
      refreshSky(ctx.elapsed);
      // ctx.camera is parented to the player rig, so its .position is local; player.eye is the world eye
      if (ctx.player && ctx.player.eye && (ctx.frame & 7) === (this.lodPhase || 0)) {
        this.root.getWorldPosition(_v);
        this.setDetail(_v.distanceTo(ctx.player.eye));
      }
    }
    this.rig.pose({
      dt, speed: s.speed || 0, aim: s.aiming || 0, aimPitch: s.aimPitch || 0, aimYaw: s.aimYaw || 0,
      headYaw: s.headYaw || 0, headPitch: s.headPitch || 0, headRate: s.headRate || 4,
      crouch: s.crouch || 0, dead: !!s.dead,
    });
    // The joints leak more when the thing is hurt or about to skip. Held at 0.45 it glows without blooming
    // (post threshold 0.88); a hit or a glitch pushes it over 1.0 for as long as the flinch lasts, which
    // hands the AI a visual channel it did not have.
    const u = this.material.userData.u;
    if (u && u.uEmber) u.uEmber.value = 0.45 + this.rig.flinch * 1.10 + (s.glitch ? 0.85 : 0);
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

// Dev hook for the smoke harness (tools/scenarios/ent-humanoid-*.mjs): builds a named variant in isolation so
// its silhouette and palette can be judged against a flat sky, and reports triangle counts per detail level.
// Costs one property on the global object; nothing in the game reads it.
if (typeof globalThis !== 'undefined') {
  globalThis.__charmesh = {
    BUILDS, HEADS, buildHumanoid, makeCharMaterial, setCharRim,
    variants: () => VARIANTS.map(([b, h, c]) => ({ build: b.id, head: h, coat: c })),
    // one body, exactly as specified, with no loadout picker in the way
    make(buildId, headKind, coat, lod = 0) {
      const build = BUILDS.find((b) => b.id === buildId) || BUILDS[1];
      const key = vkey(build, headKind, coat);
      const geo = variantGeo(key, build, headKind, coat, variantSeed(key), lod);
      if (!geo) return null;
      const material = makeCharMaterial({ shiver: 1, grime: 1 });
      const rig = new Poser(build, geo, material);
      const root = new THREE.Group(); root.add(rig.mesh);
      if (!standinGeo) standinGeo = buildStandinGun();
      if (standinGeo) { const m = new THREE.Mesh(standinGeo, material); m.frustumCulled = false; rig.B.gun.add(m); }
      return { root, rig, material, build, tris: geo.index.count / 3 };
    },
    refresh(t) { refreshSky(t); },
    tris(buildId, headKind, coat, lod = 0) {
      const build = BUILDS.find((b) => b.id === buildId) || BUILDS[1];
      const key = vkey(build, headKind, coat);
      const g = variantGeo(key, build, headKind, coat, variantSeed(key), lod);
      return g ? g.index.count / 3 : 0;
    },
  };
}

// Teardown for a full world reset. Actors still in the scene share these buffers, so only call it when
// everything is going away.
export function disposeChar() {
  for (const g of GEO.values()) if (g) g.dispose();
  GEO.clear();
  if (standinGeo) { standinGeo.dispose(); standinGeo = null; }
}
