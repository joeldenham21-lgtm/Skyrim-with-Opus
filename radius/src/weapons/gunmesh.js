// Procedural weapon and hand meshes, v2. buildGun(id, { lod, inst }) -> THREE.Group with named parts (mag, slide|bolt|
// handle|hammer|trigger|barrels|pump|lever|belt|bipod|selector, muzzle, eject), mount anchors (mount_top, mount_dovetail,
// mount_muzzle, mount_under, mount_side, mount_stock, mount_pad) and userData describing hip/ADS poses, hand grips, sight
// line and cycle type. Every weapon in data/weapons.js is assembled from a shared parts kit: side-profile extrusions with
// bevels for receivers, frames and furniture; lathes for barrels, cans and tubes; repeated notch geometry for rails,
// serrations, ribs and vents; merged per material with creased normals so machined edges stay crisp and round surfaces
// stay smooth. Materials come from ctx.materials.get(kind, params) when the texture library has landed and fall back to a
// shared wear shader (edge lightening, grime, scratches, wood grain, grip patterns) driven by the instance's condition.
// attachmesh.js builds attachments, magazines and pickup items with the same kit; applyAttachments/setMagazine install them.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { WEAPONS, MAGAZINES, ATTACHMENTS } from '../data/index.js';
import { buildAttachment, buildMag } from './attachmesh.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- context
// main.js does not hand ctx to this module; weapons.js may call setContext(ctx), otherwise the debug handle is used.
let CTX = null;
export function setContext(ctx) { CTX = ctx; }
const ctxOf = () => CTX || (typeof globalThis !== 'undefined' && globalThis.__radius && globalThis.__radius.ctx) || null;

// ---------------------------------------------------------------- materials
const WEAR_FRAG = /* glsl */`
{
  vec3 op = vOPos * 55.0 + uSeed;
  float n2 = vnoise3(op * 4.1);
  float n3 = vnoise3(op * 13.0);
  // grime gathers in soft blotches and in the recesses
  float grime = smoothstep(0.45, 0.85, vnoise3(op * 0.35) * 0.75 + n3 * 0.25) * uWear.y;
  diffuseColor.rgb *= 1.0 - grime * 0.3;
  // edge wear: normal turn per metre of surface (resolution independent), high on bevels, rims and knurls
  float curv = length(fwidth(vNormal)) / max(length(fwidth(vOPos)), 1e-6);
  float edge = smoothstep(220.0, 700.0, curv) * smoothstep(0.3, 0.75, n2) * uWear.x;
  // long scratches along the bore axis
  float sc = smoothstep(0.935, 0.97, vnoise(vec2(vOPos.z * 70.0 + uSeed, vOPos.y * 260.0 + vOPos.x * 170.0)));
  sc *= smoothstep(0.45, 0.7, n2) * uWear.z;
  float bare = clamp(edge + sc * 0.8, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uBare, bare);
  // wood grain: fibres along the stock, wandering with low-frequency noise
  float fibre = 0.5 + 0.5 * sin(vOPos.y * 420.0 + vOPos.x * 300.0 + vOPos.z * 14.0 + fbm3(vOPos.zy * 30.0 + uSeed) * 12.0);
  float grain = smoothstep(0.3, 0.9, fibre) * uWear.w;
  diffuseColor.rgb *= 1.0 - grain * 0.26 - uWear.w * (n2 - 0.5) * 0.2;
  // machined and moulded surface patterns: 1 vertical grooves (bakelite grips), 2 diamond checkering, 3 stippled polymer, 4 ridges along the bore
  float pat = 0.0;
  if (uPattern.x > 0.5 && uPattern.x < 1.5) pat = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(vOPos.z * 2600.0 + vOPos.x * 500.0));
  else if (uPattern.x > 1.5 && uPattern.x < 2.5) pat = smoothstep(0.1, 0.7, 0.5 + 0.5 * sin((vOPos.z + vOPos.y) * 3600.0) * sin((vOPos.z - vOPos.y) * 3600.0));
  else if (uPattern.x > 2.5 && uPattern.x < 3.5) pat = vnoise3(vOPos * 1900.0) * 0.8;
  else if (uPattern.x > 3.5) pat = smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(vOPos.z * 3400.0));
  diffuseColor.rgb *= 1.0 - pat * 0.24 * uPattern.y;
  roughnessFactor = clamp(roughnessFactor + (n3 - 0.5) * 0.18 + grime * 0.2 - bare * 0.3 + pat * 0.14 * uPattern.y, 0.06, 1.0);
}`;

// The viewmodel sits centimetres from the torch and the muzzle flash, where inverse-square lighting is hundreds of
// times the daylight level and burns it to white. Spot and point irradiance is capped per fragment (x: spot, y: point);
// the sun, moon and hemisphere are untouched so the gun still reads the time of day.
export const lightCap = { value: new THREE.Vector2(4.5, 7.0) };
const NO_CAP = { value: new THREE.Vector2(1e4, 1e4) };
// Bounce onto the viewmodel: the torch head rides ahead of the hands (render/lighting.js), so what lights them is the
// beam coming back off the ground, plus a little sky by day. A wrapped half-Lambert from below-ahead in view space,
// diffuse only, viewmodel materials only. hands.js drives the colour each frame from the scene lights.
export const viewFill = { value: new THREE.Color(0, 0, 0) };
const NO_FILL = { value: new THREE.Color(0, 0, 0) };
const FILL_DIR = { value: new THREE.Vector3(0.12, -0.72, -0.68).normalize() };
const FILL_FRAG = /* glsl */`
#include <lights_fragment_end>
reflectedLight.indirectDiffuse += uFill * (0.72 + 0.28 * dot(geometryNormal, uFillDir)) * BRDF_Lambert(material.diffuseColor);`;
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin
  .replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( uLightCap.y ) );')
  .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );', 'getSpotLightInfo( spotLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( uLightCap.x ) );');

export function weathered({ color, roughness, metalness = 0, wear = [0.6, 0.5, 0.3, 0], bare = 0x888888, seed = 0, side = THREE.DoubleSide, fill = true, cap = true, pattern = 0, patternK = 1, emissive = 0, emissiveIntensity = 0 }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side, emissive, emissiveIntensity });
  const uniforms = { uWear: { value: new THREE.Vector4(...wear) }, uBare: { value: new THREE.Color(bare) }, uSeed: { value: seed }, uLightCap: cap ? lightCap : NO_CAP, uFill: fill ? viewFill : NO_FILL, uFillDir: FILL_DIR, uPattern: { value: new THREE.Vector2(pattern, patternK) } };
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vOPos; uniform vec4 uWear; uniform vec3 uBare; uniform float uSeed; uniform vec2 uLightCap; uniform vec3 uFill; uniform vec3 uFillDir; uniform vec2 uPattern;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${WEAR_FRAG}`)
      .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
      .replace('#include <lights_fragment_end>', FILL_FRAG);
  };
  m.customProgramCacheKey = () => 'radius-wear';
  m.userData.shared = true; m.userData.wear = uniforms;
  return m;
}
// Viewmodel patch for a material from the texture library: keeps its maps and shader, adds the light cap and the fill.
function viewmodelPatch(src, fill) {
  const m = src.clone();
  const prev = src.onBeforeCompile;
  const uniforms = { uLightCap: lightCap, uFill: fill ? viewFill : NO_FILL, uFillDir: FILL_DIR };
  m.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    if (shader.fragmentShader.includes('#include <lights_fragment_begin>')) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uLightCap; uniform vec3 uFill; uniform vec3 uFillDir;')
        .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
        .replace('#include <lights_fragment_end>', FILL_FRAG);
    }
  };
  const prevKey = src.customProgramCacheKey ? src.customProgramCacheKey.bind(src) : null;
  m.customProgramCacheKey = () => (prevKey ? prevKey() : 'lib') + '-viewmodel' + (fill ? '-fill' : '');
  m.userData.shared = true;
  return m;
}

// Palette. lib: the ctx.materials kind asked for first. wear vector: [edge, grime, scratches, wood grain].
const PALETTE = {
  // no environment map in this renderer: high metalness has nothing to reflect and reads as black, so gunmetal is a dark
  // grey dielectric-leaning blend with bright worn edges rather than a mirror
  gunmetal:   { lib: 'gunmetal', color: 0x4b5058, roughness: 0.52, metalness: 0.36, wear: [0.9, 0.45, 0.7, 0], bare: 0xa8acb0, seed: 1.7 },
  steel:      { lib: 'steel', color: 0x6b7076, roughness: 0.4, metalness: 0.45, wear: [0.8, 0.35, 0.6, 0], bare: 0xc0c4c8, seed: 3.1 },
  steelDark:  { lib: 'gunmetal', color: 0x3e4247, roughness: 0.62, metalness: 0.3, wear: [0.75, 0.6, 0.45, 0], bare: 0x8e9297, seed: 4.2 },
  painted:    { lib: 'paintedmetal', color: 0x2c2e31, roughness: 0.72, metalness: 0.18, wear: [0.85, 0.5, 0.5, 0], bare: 0x8d9094, seed: 5.9 },
  anodised:   { lib: 'paintedmetal', color: 0x1d1f22, roughness: 0.48, metalness: 0.32, wear: [0.7, 0.35, 0.35, 0], bare: 0x9a9ea3, seed: 6.6 },
  bore:       { lib: null, color: 0x08090a, roughness: 0.9, metalness: 0.3, wear: [0, 0.2, 0, 0], bare: 0x111111, seed: 0.3 },
  wood:       { lib: 'wood', color: 0x7a4a22, roughness: 0.62, metalness: 0, wear: [0.55, 0.55, 0.15, 1.0], bare: 0xa8804e, seed: 2.9 },
  woodDark:   { lib: 'wood', color: 0x553417, roughness: 0.6, metalness: 0, wear: [0.5, 0.6, 0.1, 1.0], bare: 0x86633c, seed: 6.4 },
  woodPale:   { lib: 'wood', color: 0x8c6236, roughness: 0.66, metalness: 0, wear: [0.5, 0.5, 0.12, 1.0], bare: 0xb08a5a, seed: 7.3 },
  laminate:   { lib: 'wood', color: 0x6a3f1c, roughness: 0.5, metalness: 0, wear: [0.5, 0.45, 0.15, 1.0], bare: 0x9a6a3c, seed: 8.1 },
  bakelite:   { lib: 'bakelite', color: 0x7a4426, roughness: 0.42, metalness: 0.04, wear: [0.55, 0.45, 0.25, 0.3], bare: 0xb07046, seed: 9.1, pattern: 1 },
  bakelitePlain: { lib: 'bakelite', color: 0x7a4426, roughness: 0.42, metalness: 0.04, wear: [0.55, 0.45, 0.25, 0.3], bare: 0xb07046, seed: 9.4 },
  plum:       { lib: 'bakelite', color: 0x4a2c39, roughness: 0.58, metalness: 0.02, wear: [0.5, 0.45, 0.2, 0], bare: 0x7c5468, seed: 10.2, pattern: 3, patternK: 0.5 },
  polymer:    { lib: 'rubber', color: 0x232426, roughness: 0.78, metalness: 0.02, wear: [0.55, 0.45, 0.25, 0], bare: 0x5a5c5e, seed: 11.5, pattern: 3, patternK: 0.7 },
  polymerGrip:{ lib: 'rubber', color: 0x232426, roughness: 0.82, metalness: 0.02, wear: [0.5, 0.45, 0.2, 0], bare: 0x5a5c5e, seed: 11.9, pattern: 2, patternK: 0.8 },
  tan:        { lib: 'paintedmetal', color: 0x8b7b5c, roughness: 0.7, metalness: 0.05, wear: [0.6, 0.5, 0.3, 0], bare: 0xb9a985, seed: 12.4, pattern: 3, patternK: 0.4 },
  rubber:     { lib: 'rubber', color: 0x26251f, roughness: 0.92, metalness: 0, wear: [0.35, 0.4, 0, 0], bare: 0x44423e, seed: 3.3 },
  brass:      { lib: null, color: 0xffffff, roughness: 0.34, metalness: 0.9, wear: [0.25, 0.3, 0.3, 0], bare: 0xe8d090, seed: 5.5, side: THREE.FrontSide, fill: false, cap: false },
  copper:     { lib: null, color: 0xb87333, roughness: 0.4, metalness: 0.7, wear: [0.3, 0.3, 0.2, 0], bare: 0xd8a070, seed: 5.7 },
  glove:      { lib: 'fabric', color: 0x5c5f47, roughness: 0.95, metalness: 0, wear: [0.25, 0.55, 0, 0.55], bare: 0x767a5d, seed: 7.7 },
  cuff:       { lib: 'fabric', color: 0x474a3d, roughness: 0.97, metalness: 0, wear: [0.15, 0.55, 0, 0.7], bare: 0x5c6050, seed: 8.8 },
  leather:    { lib: 'leather', color: 0x3b2a1e, roughness: 0.8, metalness: 0, wear: [0.5, 0.5, 0.2, 0], bare: 0x6b5240, seed: 13.3 },
  canvas:     { lib: 'canvas', color: 0x5a5a48, roughness: 0.96, metalness: 0, wear: [0.3, 0.6, 0, 0.4], bare: 0x7a7a66, seed: 14.1 },
  canvasDark: { lib: 'canvas', color: 0x3c3f36, roughness: 0.96, metalness: 0, wear: [0.3, 0.6, 0, 0.4], bare: 0x5c6054, seed: 14.6 },
  olive:      { lib: 'paintedmetal', color: 0x4a5236, roughness: 0.7, metalness: 0.1, wear: [0.8, 0.5, 0.4, 0], bare: 0x8c9084, seed: 15.2 },
  orange:     { lib: 'paintedmetal', color: 0xc45a1c, roughness: 0.55, metalness: 0.05, wear: [0.6, 0.4, 0.3, 0], bare: 0xe0a070, seed: 15.8 },
  cardboard:  { lib: 'paper', color: 0x9a8562, roughness: 0.95, metalness: 0, wear: [0.3, 0.55, 0.1, 0.3], bare: 0xb8a684, seed: 16.4 },
  paper:      { lib: 'paper', color: 0xd8d2c0, roughness: 0.92, metalness: 0, wear: [0.2, 0.5, 0, 0], bare: 0xe6e2d4, seed: 17.0 },
  greyPaint:  { lib: 'paintedmetal', color: 0x545c50, roughness: 0.68, metalness: 0.15, wear: [0.85, 0.55, 0.45, 0], bare: 0x9aa094, seed: 17.7 },
  redPlastic: { lib: null, color: 0x8a2418, roughness: 0.5, metalness: 0.02, wear: [0.4, 0.4, 0.2, 0], bare: 0xc06050, seed: 18.3 },
  whitePlastic:{ lib: null, color: 0xc9c4b4, roughness: 0.6, metalness: 0.02, wear: [0.3, 0.5, 0.1, 0], bare: 0xe0dcd0, seed: 18.9 },
  tin:        { lib: 'steel', color: 0x8a8d88, roughness: 0.45, metalness: 0.55, wear: [0.6, 0.5, 0.5, 0], bare: 0xc8cac4, seed: 19.5 },
  rust:       { lib: 'rust', color: 0x6a4028, roughness: 0.9, metalness: 0.1, wear: [0.5, 0.7, 0.3, 0], bare: 0x9a6a48, seed: 20.1 },
  ivory:      { lib: null, color: 0xcfc3a5, roughness: 0.5, metalness: 0, wear: [0.3, 0.4, 0.1, 0], bare: 0xe6dcc4, seed: 20.7 },
};
// glass is not a wear material: a dark tinted disc with a coloured coating flash
function glassMaterial(tint = 0x1a2430, opacity = 0.62) {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.12, metalness: 0.3, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  m.userData.shared = true;
  return m;
}
const LEGACY = { steel: 'gunmetal', steelDark: 'steelDark', bore: 'bore', bakelite: 'bakelite', wood: 'wood', woodDark: 'woodDark', rubber: 'rubber', brass: 'brass', glove: 'glove', cuff: 'cuff' };

const MAT_CACHE = new Map();
const GLASS = {};
// One material per (kind, wear level, world|viewmodel). wear 0..1 from the instance condition, quantised to four steps.
function getMat(kind, wearLevel = 0, world = false) {
  if (kind === 'glass' || kind === 'glassRed' || kind === 'glassGreen' || kind === 'glassAmber') {
    if (!GLASS[kind]) GLASS[kind] = glassMaterial(kind === 'glassRed' ? 0x3a1420 : kind === 'glassGreen' ? 0x142a1c : kind === 'glassAmber' ? 0x3a2a10 : 0x1a2430);
    return GLASS[kind];
  }
  const key = kind + '|' + wearLevel + '|' + (world ? 'w' : 'v');
  let m = MAT_CACHE.get(key); if (m) return m;
  const p = PALETTE[kind] || PALETTE.gunmetal;
  const w = wearLevel / 3;
  const ctx = ctxOf();
  let lib = null;
  if (p.lib && ctx && ctx.materials && ctx.materials.get) {
    try { lib = ctx.materials.get(p.lib, { color: p.color, roughness: p.roughness, metalness: p.metalness, wear: 0.35 + w * 0.6, seed: p.seed }); } catch (e) { lib = null; }
    // the stub returns a bare MeshStandardMaterial; only a material with maps or a shader patch is the real library
    if (lib && !(lib.map || lib.normalMap || lib.roughnessMap || lib.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile && lib.userData.procedural)) lib = null;
  }
  if (lib) m = world ? lib : viewmodelPatch(lib, p.fill !== false);
  else {
    const wear = [p.wear[0] * (0.5 + w * 0.9), p.wear[1] * (0.45 + w * 1.1), p.wear[2] * (0.35 + w * 1.3), p.wear[3]];
    m = weathered({ color: p.color, roughness: p.roughness, metalness: p.metalness, wear, bare: p.bare, seed: p.seed, side: p.side, fill: world ? false : p.fill !== false, cap: world ? false : p.cap !== false, pattern: p.pattern || 0, patternK: p.patternK ?? 1 });
  }
  m.name = key;
  MAT_CACHE.set(key, m);
  return m;
}
// A kit: M.gunmetal, M.wood ... resolved lazily for a wear level; M.barrel/M.bolt/M.frame follow the parts condition.
export function matKit({ wear = 0, world = false, parts = null } = {}) {
  const lvl = (c) => (c >= 85 ? 0 : c >= 60 ? 1 : c >= 35 ? 2 : 3);
  const base = parts ? lvl((parts.barrel + parts.bolt + parts.frame) / 3) : Math.min(3, Math.max(0, Math.round(wear * 3)));
  const kit = { world, level: base, get: (k, l = base) => getMat(k, l, world) };
  for (const k of Object.keys(PALETTE)) Object.defineProperty(kit, k, { get: () => getMat(k, base, world) });
  for (const k of ['glass', 'glassRed', 'glassGreen', 'glassAmber']) Object.defineProperty(kit, k, { get: () => getMat(k) });
  Object.defineProperty(kit, 'barrel', { get: () => getMat('gunmetal', parts ? lvl(parts.barrel) : base, world) });
  Object.defineProperty(kit, 'bolt', { get: () => getMat('steel', parts ? lvl(parts.bolt) : base, world) });
  Object.defineProperty(kit, 'frame', { get: () => getMat('gunmetal', parts ? lvl(parts.frame) : base, world) });
  return kit;
}
// legacy kit used by weapons.js (materials().brass) and old callers
let MAT = null;
export function materials() {
  if (MAT) return MAT;
  MAT = {};
  for (const [legacy, kind] of Object.entries(LEGACY)) Object.defineProperty(MAT, legacy, { get: () => getMat(kind, 1, false) });
  return MAT;
}

// ---------------------------------------------------------------- level of detail
// Builders read LOD through these helpers: hi keeps bevels, pins, notches and 16-segment rounds; lo (enemy-held) drops them.
let LOD = 'hi';
export const hi = () => LOD === 'hi';
const SEG = () => (LOD === 'hi' ? 16 : 8);
const SEG_S = () => (LOD === 'hi' ? 10 : 6);
const BEV = (b) => (LOD === 'hi' ? b : 0);

// ---------------------------------------------------------------- geometry helpers
// Side profile: points in (u, v) = (toward the muzzle, up). Extruded across x (the gun's width), centred.
export function shapeFrom(pts) {
  const s = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) s.moveTo(p[0], p[1]);
    else if (p[0] === 'q') s.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  return s;
}
export function side(pts, width, bevel = 0.0015, curveSegments = 8) {
  bevel = BEV(bevel); if (!hi()) curveSegments = Math.max(3, curveSegments >> 1);
  const shape = shapeFrom(pts);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0005, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments, steps: 1 });
  g.rotateY(Math.PI / 2);                       // (u, v, w) -> (w, v, -u)
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}
// same profile but extruded in the (u, v) plane of a top view: points are (x, u) and the extrusion runs along y
export function top(pts, height, bevel = 0.001, curveSegments = 8) {
  bevel = BEV(bevel); if (!hi()) curveSegments = Math.max(3, curveSegments >> 1);
  const shape = shapeFrom(pts);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0005, height - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments, steps: 1 });
  g.rotateX(-Math.PI / 2);                      // (x, u, w) -> (x, w, -u)
  g.translate(0, -(height - bevel * 2) / 2, 0);
  return g;
}
// a cross-section (x, y) extruded along z, centred; the front (-z) at -len/2
export function prism(pts, len, bevel = 0.0008, curveSegments = 6) {
  bevel = BEV(bevel); if (!hi()) curveSegments = Math.max(3, curveSegments >> 1);
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts), { depth: Math.max(0.0005, len - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments, steps: 1 });
  g.translate(0, 0, -(len - bevel * 2) / 2);
  return g;
}
// rectangle (u0..u1, v0..v1) with optional chamfer on the profile corners
export function rect(u0, u1, v0, v1, width, bevel = 0.0015, ch = 0) {
  if (ch <= 0 || !hi()) return side([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], width, bevel);
  return side([[u0 + ch, v0], [u1 - ch, v0], [u1, v0 + ch], [u1, v1 - ch], [u1 - ch, v1], [u0 + ch, v1], [u0, v1 - ch], [u0, v0 + ch]], width, bevel);
}
// U-shaped trigger guard hanging from vTop between u0 and u1, depth d, bar thickness t
export function guardU(u0, u1, vTop, d, t, width) {
  const r = Math.min(d * 0.5, 0.012);
  return side([
    [u0, vTop], [u0, vTop - d + r], ['q', u0, vTop - d, u0 + r, vTop - d], [u1 - r, vTop - d], ['q', u1, vTop - d, u1, vTop - d + r], [u1, vTop],
    [u1 - t, vTop], [u1 - t, vTop - d + r], ['q', u1 - t, vTop - d + t, u1 - r, vTop - d + t], [u0 + r, vTop - d + t], ['q', u0 + t, vTop - d + t, u0 + t, vTop - d + r], [u0 + t, vTop],
  ], width, 0.0007, 6);
}
// cylinder along z: rear radius rb at +z end, front radius rf at -z end. Centred on origin, length len.
export function cylZ(rb, rf, len, seg = 0, open = false) { const g = new THREE.CylinderGeometry(rf, rb, len, seg || SEG(), 1, open); g.rotateX(-Math.PI / 2); return g; }
export function cylY(rBottom, rTop, len, seg = 0) { return new THREE.CylinderGeometry(rTop, rBottom, len, seg || SEG_S(), 1); }
export function cylX(r0, r1, len, seg = 0) { const g = new THREE.CylinderGeometry(r1, r0, len, seg || SEG_S(), 1); g.rotateZ(-Math.PI / 2); return g; }
export function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
export function sphere(r, seg = 0) { seg = seg || SEG_S(); return new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)); }
// ring in the ZY plane (axis along x): angle 0 = forward (-z), 90 = up. a0 = start angle, arc = sweep
export function ringX(R, tube, a0 = 0, arc = Math.PI * 2, seg = 0, tubeSeg = 0) { const g = new THREE.TorusGeometry(R, tube, tubeSeg || (hi() ? 6 : 4), seg || SEG(), arc); g.rotateZ(a0); g.rotateY(Math.PI / 2); return g; }
// ring in the XY plane (axis along z): angle 0 = right (+x), 90 = up
export function ringZ(R, tube, a0 = 0, arc = Math.PI * 2, seg = 0, tubeSeg = 0) { const g = new THREE.TorusGeometry(R, tube, tubeSeg || (hi() ? 6 : 4), seg || SEG(), arc); g.rotateZ(a0); return g; }
// ring in the XZ plane (axis along y)
export function ringY(R, tube, seg = 0, tubeSeg = 0) { const g = new THREE.TorusGeometry(R, tube, tubeSeg || (hi() ? 6 : 4), seg || SEG()); g.rotateX(Math.PI / 2); return g; }
export function at(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; }
// lathe along z from a profile of [r, u] points, u forward (toward -z): barrels, cans, tubes, knobs, bullets
export function latheZ(profile, seg = 0) {
  const pts = profile.map(([r, u]) => new THREE.Vector2(Math.max(0, r), u));
  const g = new THREE.LatheGeometry(pts, seg || SEG());
  g.rotateX(-Math.PI / 2);
  return g;
}
// a lathe with a bored front end: the profile ends with the crown and the first depth of the bore (dark inside)
export function boredZ(rOut, rIn, len, depth = 0.012, seg = 0) { return latheZ([[rIn, len - depth], [rIn, len], [rOut, len], [rOut, 0]], seg); }
// slant the -z end of a geometry: z += x * k for vertices at the front (muzzle brakes)
export function slantFront(g, zFront, k) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { if (p.getZ(i) < zFront + 1e-4) p.setZ(i, p.getZ(i) + p.getX(i) * k); } g.computeVertexNormals(); return g; }
// mirror a geometry across x, keeping the winding outward
export function mirrorX(g) {
  const c = (g.index ? g.toNonIndexed() : g.clone()); c.scale(-1, 1, 1);
  const p = c.attributes.position;
  for (let i = 0; i < p.count; i += 3) { const x1 = p.getX(i + 1), y1 = p.getY(i + 1), z1 = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x1, y1, z1); }
  return c;
}
// Picatinny rail along z, centred, top surface at y = h (base at y = 0): a continuous base bar plus milled teeth every
// 10 mm (slot 5.3 mm) with the 45 degree flanks that the clamps grab. lo: one bar.
export function railZ(len, h = 0.0085, w = 0.0212, teeth = true) {
  const geos = [box(w * 0.86, h - 0.0038, len)]; geos[0].translate(0, (h - 0.0038) / 2, 0);
  if (!hi() || !teeth) { const t = box(w, 0.0038, len); t.translate(0, h - 0.0019, 0); geos.push(t); return mergeGeometries(geos.map((g) => g.toNonIndexed()), false); }
  const n = Math.floor(len / 0.01), half = w / 2, base = h - 0.0038;
  const tooth = shapeFrom([[-half, 0], [half, 0], [half, 0.0016], [half - 0.0024, 0.0038], [-(half - 0.0024), 0.0038], [-half, 0.0016]]);
  for (let i = 0; i < n; i++) {
    const g = new THREE.ExtrudeGeometry(tooth, { depth: 0.0047, bevelEnabled: false, steps: 1 });
    g.translate(0, base, -len / 2 + i * 0.01 + 0.00265 - 0.0047 / 2 + 0.0047 / 2);
    geos.push(g);
  }
  return mergeGeometries(geos.map((g) => g.toNonIndexed()), false);
}
// n thin transverse cuts (slide serrations, cover ribs): boxes w wide (x), hh tall, d thick, starting at z0 stepping pitch toward -z
export function serrations(geos, n, x, y, z0, pitch, w, hh, d) { for (let i = 0; i < n; i++) geos.push(at(box(w, hh, d), x, y, z0 - i * pitch)); return geos; }
// n slots (vent holes, brake ports) as dark inset boxes through a wall
export function slotRow(geos, n, x, y, z0, pitch, w, hh, d, rz = 0) { for (let i = 0; i < n; i++) geos.push(at(box(w, hh, d), x, y, z0 - i * pitch, 0, 0, rz)); return geos; }
// small pins and rivet heads across the receiver (both ends visible)
export function pin(x, y, z, r, len) { return at(cylX(r, r, len, hi() ? 8 : 5), x, y, z); }
export function screw(x, y, z, r, axis = 'x') {
  const g = axis === 'x' ? cylX(r, r, 0.0012, 8) : axis === 'y' ? cylY(r, r, 0.0012, 8) : cylZ(r, r, 0.0012, 8);
  const slot = axis === 'x' ? box(0.0016, r * 1.6, r * 0.35) : axis === 'y' ? box(r * 1.6, 0.0016, r * 0.35) : box(r * 1.6, r * 0.35, 0.0016);
  return [at(g, x, y, z), at(slot, x, y, z)];
}
// a knurled ring: cylinder with alternating radius around the rim (adjustment turrets, thumb screws)
export function knurlZ(R, len, teeth = 18) {
  const g = new THREE.CylinderGeometry(R, R, len, teeth * 2, 1); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); const r = Math.hypot(x, y); if (r > R * 0.5) { const a = Math.atan2(y, x); const k = (Math.round(a / (Math.PI / teeth)) % 2 === 0) ? 1 : 0.9; p.setXY(i, x * k, y * k); } }
  return g;
}
// hexagonal nut / cap along z
export function hexZ(R, len) { return cylZ(R, R, len, 6); }

// box-projected UVs in metres so library maps (wood grain, paint) have something to tile on
function boxUV(g, scale = 3) {
  const p = g.attributes.position, n = g.attributes.normal; const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i)); let u, v;
    if (nx >= ny && nx >= nz) { u = p.getZ(i); v = p.getY(i); } else if (ny >= nz) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
export function finalize(geos) {
  const list = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); if (n.attributes.normal) n.deleteAttribute('normal'); return n; });
  const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
  merged.scale(10, 10, 10);                     // the crease hash works at 1 cm; scale so it resolves 1 mm
  const c = toCreasedNormals(merged, 50 * DEG);
  c.scale(0.1, 0.1, 0.1);
  boxUV(c);
  c.computeBoundingSphere();
  return c;
}
export function mesh(geos, mat, name) {
  const m = new THREE.Mesh(finalize(geos), mat);
  m.castShadow = LOD !== 'hi'; m.receiveShadow = true; m.frustumCulled = LOD !== 'hi'; m.name = name || '';
  return m;
}
// a moving part. Geometries authored in gun space unless local=true; pivot p => mesh at p, geometry shifted by -p.
export function part(name, geos, mat, p = [0, 0, 0], local = false) {
  if (!local) for (const g of geos) g.translate(-p[0], -p[1], -p[2]);
  const m = mesh(geos, mat, name);
  m.position.set(p[0], p[1], p[2]);
  m.userData.base = { p: m.position.clone(), r: new THREE.Euler() };
  return m;
}
// a part built with the same pivot as its parent moving part: geometry is already parent-local, so sit at the origin
export function sub(m) { m.position.set(0, 0, 0); m.userData.base.p.set(0, 0, 0); return m; }
// a named node (group) with a base pose so hands.js and weapons.js can animate it
export function node(name, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); g.userData.base = { p: g.position.clone(), r: new THREE.Euler() }; return g; }
export class Parts {
  constructor() { this.map = new Map(); }
  add(mat, g) { if (!this.map.has(mat)) this.map.set(mat, []); this.map.get(mat).push(g); return g; }
  addAll(mat, gs) { for (const g of gs) this.add(mat, g); }
  into(group, name = 'body') { for (const [mat, geos] of this.map) group.add(mesh(geos, mat, name)); this.map.clear(); return group; }
  // one named mesh per material with a prefix (removable furniture: cover, handguard, stock)
  named(group, name) { for (const [mat, geos] of this.map) { const m = mesh(geos, mat, name); m.userData.removable = name; group.add(m); } this.map.clear(); return group; }
}
export function marker(name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); return o; }
// Euler that maps local x/y axes to the given world axes (z = x cross y; y re-orthogonalised)
export function basisEuler(xa, ya) {
  const x = new THREE.Vector3(...xa).normalize(), y = new THREE.Vector3(...ya).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize(); y.crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const e = new THREE.Euler().setFromRotationMatrix(m);
  return [e.x, e.y, e.z];
}
// hand pose from the palm-normal axis (local x, re-orthogonalised) and the wrist/forearm direction (local +z)
export function handEuler(palmX, wristZ) {
  const z = new THREE.Vector3(...wristZ).normalize(), x = new THREE.Vector3(...palmX);
  x.addScaledVector(z, -x.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return [e.x, e.y, e.z];
}
// standard grips: the right hand on a pistol grip at (x,y,z) with the palm facing +x; the left under a fore-end
const GRIP_R = (p, kind = 'rifle', wrist = [0.2, -0.4, 0.9]) => ({ p, r: handEuler([1, 0, 0], wrist), pose: kind });
const GRIP_L = (p, kind = 'foreend', wrist = [-0.85, -0.45, 0.3]) => ({ p, r: handEuler([0.25, 1, 0.1], wrist), pose: kind });
const GRIP_L_PISTOL = (p) => ({ p, r: handEuler([0.8, 0.1, 0.55], [-0.45, -0.4, 0.8]), pose: 'support' });
const GRIP_R_RIFLE_WRIST = (p) => ({ p, r: handEuler([0.9, 0.3, -0.3], [0.1, 0.7, 0.7]), pose: 'wrist' });

// ---------------------------------------------------------------- shared components
// front sight post with protective ears (AK/SKS/SVD wings or a full hood), base at (0, yBase, z)
function frontSight(P, M, z, yBase, opts = {}) {
  const { postH = 0.024, ears = 'wings', baseW = 0.026, baseL = 0.03, baseH = 0.02 } = opts;
  P.add(M.gunmetal, at(rect(-baseL / 2, baseL / 2, 0, baseH, baseW, 0.001, 0.003), 0, yBase, z));
  const top = yBase + baseH;
  P.add(M.gunmetal, at(cylY(0.0016, 0.0013, postH, 6), 0, top + postH / 2, z));               // the post
  if (hi()) P.add(M.gunmetal, at(cylY(0.004, 0.004, 0.004, 8), 0, top + 0.002, z));           // its threaded collar
  if (ears === 'wings') {
    P.add(M.gunmetal, at(ringZ(0.011, 0.0018, 0.15, Math.PI - 0.3, 12, 5), 0, top + 0.006, z)); // hood over the post
    P.add(M.gunmetal, at(box(0.0032, postH + 0.004, 0.0075), 0.012, top + (postH + 0.004) / 2 - 0.002, z));
    P.add(M.gunmetal, at(box(0.0032, postH + 0.004, 0.0075), -0.012, top + (postH + 0.004) / 2 - 0.002, z));
  } else if (ears === 'hood') {
    P.add(M.gunmetal, at(ringZ(0.0105, 0.0016, -0.2, Math.PI * 1.4, 12, 5), 0, top + postH * 0.55, z));
  } else if (ears === 'blade') {
    P.add(M.gunmetal, at(box(0.0025, postH, 0.006), 0, top + postH / 2, z));
  }
  return top + postH;   // sight tip height
}
// tangent rear sight: block at u0..u1, a leaf on top with a notch cut by two blocks, a slider
function rearTangent(P, M, u0, u1, yBase, opts = {}) {
  const { w = 0.028, blockH = 0.03, leafW = 0.012, leafL = 0.06 } = opts;
  P.add(M.gunmetal, at(rect(u0, u1, 0, blockH, w, 0.001, 0.003), 0, yBase, 0));
  const y = yBase + blockH;
  const leafU0 = u0 + 0.004, leafU1 = leafU0 + leafL;
  P.add(M.gunmetal, at(rect(leafU0, leafU1, 0, 0.005, leafW, 0.0005), 0, y, 0));                 // the leaf (down, 100 m)
  // notch at the rear of the leaf: two blocks with a 1.6 mm gap
  P.add(M.gunmetal, at(box(leafW / 2 - 0.0008, 0.004, 0.006), leafW / 4 + 0.0004, y + 0.007, -leafU0 - 0.003));
  P.add(M.gunmetal, at(box(leafW / 2 - 0.0008, 0.004, 0.006), -leafW / 4 - 0.0004, y + 0.007, -leafU0 - 0.003));
  if (hi()) {
    P.add(M.steel, at(box(leafW + 0.004, 0.0035, 0.006), 0, y + 0.0065, -leafU0 - 0.03));        // slider
    P.add(M.gunmetal, at(cylX(0.002, 0.002, w + 0.002, 6), 0, y - 0.004, -leafU0 + 0.002));      // leaf pivot pin
    P.add(M.gunmetal, at(box(0.006, 0.003, 0.02), 0, y + 0.0015, -leafU1 + 0.006));              // leaf spring
  }
  return { y: y + 0.009, z: -leafU0 - 0.003 };   // notch height and position
}
// pistol rear sight: a dovetailed block with a square notch; front blade
function pistolSights(geos, uRear, uFront, yTop, w = 0.02) {
  geos.push(at(box(w * 0.5 - 0.001, 0.0045, 0.0055), w * 0.25 + 0.0005, yTop + 0.00225, -uRear));
  geos.push(at(box(w * 0.5 - 0.001, 0.0045, 0.0055), -w * 0.25 - 0.0005, yTop + 0.00225, -uRear));
  geos.push(at(box(w, 0.0025, 0.0055), 0, yTop + 0.00125, -uRear));
  geos.push(at(box(0.0026, 0.0055, 0.005), 0, yTop + 0.00275, -uFront));
  return yTop + 0.0055;
}
// a dark inset panel for an ejection port (right side unless x < 0)
function ejectionPort(P, M, x, y0, y1, u0, u1) { P.add(M.bore, at(box(0.0012, y1 - y0, u1 - u0), x, (y0 + y1) / 2, -(u0 + u1) / 2)); }
// sling swivel loop at (x, y, z), axis along x
function swivel(P, M, x, y, z, R = 0.006) { P.add(M.gunmetal, at(ringX(R, 0.0013, 0, Math.PI * 2, 12, 5), x, y, z)); if (hi()) P.add(M.gunmetal, at(box(0.004, 0.004, 0.008), x, y + R + 0.002, z)); }
// a rubber or steel butt pad at the rear face of a stock (u = rear, negative), v0..v1 tall
function buttplate(P, M, mat, uRear, v0, v1, w, thick = 0.008) { P.add(mat, side([[uRear, v0], [uRear + thick, v0 + 0.002], [uRear + thick, v1 - 0.002], [uRear, v1]], w, 0.0015, 4)); if (hi()) { P.addAll(M.gunmetal, screw(0, v1 - 0.012, -uRear + 0.0005, 0.0025, 'z')); P.addAll(M.gunmetal, screw(0, v0 + 0.012, -uRear + 0.0005, 0.0025, 'z')); } }
// a Harris-style bipod folded under the fore-end: two legs with feet, a hinge block. Named 'bipod' node by the caller.
export function bipodGeos(M, z, y, opts = {}) {
  const { legLen = 0.19, spread = 0.02, folded = true } = opts;
  const P = new Parts();
  P.add(M.painted, at(box(0.03, 0.016, 0.026), 0, y, z));                                     // hinge block
  if (hi()) { P.add(M.steel, pin(0, y, z, 0.003, 0.034)); P.add(M.painted, at(knurlZ(0.006, 0.006, 12), 0, y - 0.006, z + 0.016)); }
  for (const s of [-1, 1]) {
    const geos = [];
    const leg = cylZ(0.0045, 0.004, legLen, 8), inner = cylZ(0.0032, 0.003, legLen * 0.5, 8);
    if (folded) { leg.translate(0, 0, -legLen / 2); inner.translate(0, 0, -legLen * 0.95); } else { leg.rotateX(-Math.PI / 2 + 0.12); leg.translate(0, -legLen / 2, 0); inner.rotateX(-Math.PI / 2 + 0.12); inner.translate(0, -legLen * 0.95, 0); }
    geos.push(at(leg, s * spread, y - 0.004, z), at(inner, s * spread, y - 0.004, z));
    geos.push(at(folded ? cylZ(0.006, 0.006, 0.012, 8) : cylY(0.006, 0.006, 0.012, 8), s * spread, y - 0.004 + (folded ? 0 : -legLen * 1.2), z + (folded ? -legLen * 1.2 : 0)));   // rubber foot
    P.addAll(M.painted, geos.slice(0, 2)); P.add(M.rubber, geos[2]);
  }
  return P;
}

// ---------------------------------------------------------------- Kalashnikov family
// Shared receiver, fire control, gas system and furniture; the spec chooses barrel length, blocks, muzzle device, cover,
// handguard, stock, grip and magazine. Bore at y = 0.05, receiver rear face at u = 0, front trunnion at u = 0.262.
const AK_SPECS = {
  akm:    { barrelEnd: 0.737, gas: 0.52, fsb: 0.67, hg: [0.31, 0.525], hgKind: 'wood', cover: 'ribbed', muzzle: 'slant', stock: 'wood', grip: 'bakelite', mag: 'mag_ak762_30', sight: 'tangent', cal: 7.62 },
  akms:   { barrelEnd: 0.737, gas: 0.52, fsb: 0.67, hg: [0.31, 0.525], hgKind: 'wood', cover: 'ribbed', muzzle: 'slant', stock: 'underfold', grip: 'bakelite', mag: 'mag_ak762_30', sight: 'tangent', cal: 7.62 },
  ak74m:  { barrelEnd: 0.737, gas: 0.52, fsb: 0.67, hg: [0.31, 0.525], hgKind: 'black', cover: 'smooth', muzzle: 'ak74', stock: 'polyfold', grip: 'black', mag: 'mag_ak545_30', sight: 'tangent', cal: 5.45 },
  aks74u: { barrelEnd: 0.47, gas: 0.43, fsb: null, hg: [0.31, 0.415], hgKind: 'wood', cover: 'hinged', muzzle: 'booster', stock: 'triangle', grip: 'bakelite', mag: 'mag_ak545_30', sight: 'cover', cal: 5.45 },
  ak105:  { barrelEnd: 0.60, gas: 0.52, fsb: null, hg: [0.31, 0.5], hgKind: 'black', cover: 'smooth', muzzle: 'ak105', stock: 'polyfold', grip: 'black', mag: 'mag_ak545_30', sight: 'tangent', cal: 5.45 },
  ak12:   { barrelEnd: 0.737, gas: 0.54, fsb: null, hg: [0.31, 0.525], hgKind: 'rail', cover: 'rail', muzzle: 'ak12', stock: 'telescope', grip: 'ergo', mag: 'mag_ak545_30', sight: 'rail', cal: 5.45 },
  rpk74:  { barrelEnd: 0.92, gas: 0.62, fsb: 0.85, hg: [0.31, 0.62], hgKind: 'plum', cover: 'smooth', muzzle: 'rpk', stock: 'club', grip: 'plum', mag: 'mag_ak545_45', sight: 'tangent', cal: 5.45, heavy: true, bipod: 0.8 },
  saiga:  { barrelEnd: 0.69, gas: 0.54, fsb: null, hg: [0.31, 0.53], hgKind: 'black', cover: 'smooth', muzzle: 'saiga', stock: 'polyfix', grip: 'black', mag: 'mag_saiga8', sight: 'tangent', cal: 12 },
  vityaz: { barrelEnd: 0.50, gas: null, fsb: 0.47, hg: [0.31, 0.44], hgKind: 'black', cover: 'hinged', muzzle: 'cap', stock: 'polyfold', grip: 'black', mag: 'mag_vityaz30', sight: 'cover', cal: 9 },
  bizon:  { barrelEnd: 0.48, gas: null, fsb: 0.455, hg: [0.31, 0.42], hgKind: 'bizon', cover: 'hinged', muzzle: 'cap', stock: 'triangle', grip: 'bakelite', mag: 'mag_bizon64', sight: 'cover', cal: 9 },
};
function akStock(M, kind, g) {
  const P = new Parts();
  let padU = -0.352, padV = [-0.096, 0.03], padW = 0.045;
  if (kind === 'wood' || kind === 'club') {
    const belly = kind === 'club' ? -0.128 : -0.094;
    P.add(M.laminate, side([[0.0, 0.043], [-0.34, 0.03], ['q', -0.352, 0.028, -0.352, 0.016], [-0.352, -0.085], ['q', -0.35, -0.096, -0.34, belly], kind === 'club' ? ['q', -0.2, -0.13, -0.16, -0.06] : [-0.2, -0.06], [-0.03, -0.008], [0.0, 0.0]], 0.042, 0.002));
    buttplate(P, M, M.gunmetal, -0.36, -0.096, 0.03, 0.045);
    swivel(P, M, -0.023, -0.03, 0.25);
    if (hi()) { P.addAll(M.gunmetal, screw(0.0215, 0.02, 0.012, 0.003, 'x')); P.addAll(M.gunmetal, screw(0.0215, -0.012, 0.032, 0.003, 'x')); }
    padU = -0.36;
  } else if (kind === 'polyfold' || kind === 'polyfix') {
    P.add(M.polymer, side([[0.0, 0.04], [-0.05, 0.036], [-0.33, 0.028], ['q', -0.345, 0.028, -0.345, 0.014], [-0.345, -0.08], ['q', -0.345, -0.09, -0.335, -0.09], [-0.22, -0.078], ['q', -0.1, -0.05, -0.04, -0.012], [0.0, 0.0]], 0.036, 0.002));
    if (hi()) for (let i = 0; i < 6; i++) P.add(M.polymer, at(box(0.0375, 0.0035, 0.004), 0, 0.006 - i * 0.014, 0.2 + i * 0.012));   // moulded ribs on the sides
    buttplate(P, M, M.rubber, -0.353, -0.09, 0.028, 0.038);
    if (kind === 'polyfold') { P.add(M.gunmetal, at(box(0.03, 0.05, 0.016), -0.004, 0.012, 0.005)); P.add(M.steel, pin(-0.019, 0.012, 0.005, 0.004, 0.006)); }   // hinge block and pin
    swivel(P, M, -0.02, -0.02, 0.26); padU = -0.353; padV = [-0.09, 0.028]; padW = 0.038;
  } else if (kind === 'triangle') {
    // AKS-74U skeleton: two stamped struts to a buttplate, a diagonal brace, hinge on the left rear of the receiver
    const strut = (y0, y1) => at(box(0.008, 0.012, 0.33), -0.006, 0, 0.165, Math.atan2(y1 - y0, 0.33), 0, 0);
    const s1 = strut(0.028, 0.03); s1.translate(0, 0.03, 0); P.add(M.painted, s1);
    const s2 = strut(-0.02, -0.09); s2.translate(0, -0.055, 0); P.add(M.painted, s2);
    P.add(M.painted, at(box(0.008, 0.01, 0.2), -0.006, -0.02, 0.18, 0.55, 0, 0));           // brace
    P.add(M.painted, side([[-0.325, 0.036], [-0.34, 0.032], ['q', -0.345, 0.0, -0.34, -0.09], [-0.325, -0.095], [-0.318, -0.04]], 0.03, 0.001));   // buttplate
    P.add(M.painted, at(box(0.02, 0.046, 0.02), -0.012, 0.006, 0.01));                        // hinge block
    P.add(M.steel, pin(-0.012, 0.006, 0.01, 0.0045, 0.024));
    padU = -0.345; padV = [-0.095, 0.036]; padW = 0.03;
  } else if (kind === 'underfold') {
    // AKMS: two struts from the receiver bottom to a stamped shoulder piece
    for (const s of [-1, 1]) P.add(M.painted, at(box(0.007, 0.014, 0.31), s * 0.014, -0.012, 0.16));
    P.add(M.painted, side([[-0.31, 0.03], [-0.322, 0.024], ['q', -0.33, -0.03, -0.322, -0.078], [-0.31, -0.086], [-0.302, -0.03]], 0.046, 0.001));   // shoulder piece
    P.add(M.painted, at(box(0.036, 0.008, 0.04), 0, -0.006, 0.31));
    P.add(M.steel, pin(0, -0.024, 0.012, 0.0045, 0.04)); P.add(M.painted, at(box(0.044, 0.02, 0.03), 0, -0.016, 0.012));  // hinge
    padU = -0.33; padV = [-0.086, 0.03]; padW = 0.046;
  } else if (kind === 'telescope') {
    // AK-12: hinge, a square tube with locking notches, a sliding butt with an adjustable cheek riser
    P.add(M.painted, at(box(0.026, 0.038, 0.24), 0, 0.014, 0.135));
    if (hi()) slotRow(P.map.get(M.painted) ? P.map.get(M.painted) : [], 0, 0, 0, 0, 0, 0, 0, 0);
    if (hi()) for (let i = 0; i < 4; i++) P.add(M.bore, at(box(0.002, 0.006, 0.006), 0.0135, -0.002, 0.16 + i * 0.022));
    P.add(M.polymer, side([[-0.24, 0.046], [-0.33, 0.04], ['q', -0.345, 0.04, -0.345, 0.024], [-0.345, -0.07], ['q', -0.345, -0.086, -0.33, -0.086], [-0.24, -0.02], [-0.22, 0.0]], 0.036, 0.002));   // butt
    P.add(M.polymer, at(box(0.03, 0.012, 0.09), 0, 0.05, 0.29));                              // cheek riser
    buttplate(P, M, M.rubber, -0.352, -0.086, 0.04, 0.038);
    P.add(M.gunmetal, at(box(0.032, 0.05, 0.02), 0, 0.012, 0.008)); P.add(M.steel, pin(-0.017, 0.012, 0.008, 0.004, 0.006));
    padU = -0.352; padV = [-0.086, 0.04]; padW = 0.038;
  }
  P.named(g, 'stock');
  g.add(marker('mount_pad', 0, (padV[0] + padV[1]) / 2, -padU));
  g.userData.padSpec = { v: padV, w: padW };
}
function akMuzzle(M, kind, u, r) {
  const P = new Parts(); const g = new THREE.Group(); g.name = 'muzzle_device';
  let len = 0.02;
  if (kind === 'slant') { len = 0.036; P.add(M.gunmetal, slantFront(at(cylZ(0.011, 0.011, 0.036), 0, 0, -u - 0.018), -u - 0.036, 0.55)); if (hi()) P.add(M.gunmetal, at(ringZ(0.0105, 0.0015), 0, 0, -u - 0.004)); }
  else if (kind === 'ak74') {
    len = 0.08;
    P.add(M.gunmetal, at(latheZ([[0.0085, 0], [0.011, 0.004], [0.0125, 0.008], [0.0125, 0.045], [0.014, 0.05], [0.014, 0.075], [0.0115, 0.08], [0.006, 0.08], [0.006, 0.078]]), 0, 0, -u));
    if (hi()) { P.add(M.bore, at(box(0.03, 0.011, 0.028), 0, 0.001, -u - 0.03)); P.add(M.bore, at(box(0.006, 0.0025, 0.02), 0.0, 0.0128, -u - 0.062)); P.add(M.bore, at(box(0.006, 0.0025, 0.02), 0.006, 0.0125, -u - 0.062)); P.add(M.bore, at(box(0.006, 0.0025, 0.02), -0.006, 0.0125, -u - 0.062)); }   // side chamber cut and top vents
    P.add(M.gunmetal, at(box(0.003, 0.02, 0.026), 0, 0.001, -u - 0.03));   // the divider inside the chamber
  }
  else if (kind === 'booster') { len = 0.075; P.add(M.gunmetal, at(latheZ([[0.0085, 0], [0.0125, 0.004], [0.0125, 0.02], [0.019, 0.026], [0.019, 0.05], [0.0165, 0.07], [0.012, 0.075], [0.0065, 0.075], [0.0065, 0.072]]), 0, 0, -u)); if (hi()) P.add(M.gunmetal, at(ringZ(0.0185, 0.0012), 0, 0, -u - 0.05)); }
  else if (kind === 'ak105') { len = 0.06; P.add(M.gunmetal, at(latheZ([[0.0085, 0], [0.0125, 0.004], [0.0125, 0.03], [0.014, 0.034], [0.014, 0.058], [0.011, 0.06], [0.006, 0.06], [0.006, 0.058]]), 0, 0, -u)); if (hi()) P.add(M.bore, at(box(0.03, 0.011, 0.018), 0, 0.001, -u - 0.018)); }
  else if (kind === 'ak12') { len = 0.07; P.add(M.gunmetal, at(latheZ([[0.0085, 0], [0.0115, 0.004], [0.0135, 0.008], [0.0135, 0.066], [0.011, 0.07], [0.0055, 0.07], [0.0055, 0.068]]), 0, 0, -u)); if (hi()) { for (let i = 0; i < 4; i++) { P.add(M.bore, at(box(0.03, 0.005, 0.006), 0, 0.004, -u - 0.02 - i * 0.011)); P.add(M.bore, at(box(0.004, 0.03, 0.006), 0, 0.0, -u - 0.02 - i * 0.011)); } } }
  else if (kind === 'rpk') { len = 0.05; P.add(M.gunmetal, at(latheZ([[0.009, 0], [0.012, 0.004], [0.012, 0.046], [0.0095, 0.05], [0.006, 0.05], [0.006, 0.048]]), 0, 0, -u)); if (hi()) for (let i = 0; i < 5; i++) P.add(M.bore, at(box(0.03, 0.0025, 0.018), 0, 0, -u - 0.028, 0, 0, i * Math.PI / 5)); }
  else if (kind === 'saiga') { len = 0.012; P.add(M.gunmetal, at(latheZ([[r, 0], [r + 0.0015, 0.003], [r + 0.0015, 0.012], [r - 0.002, 0.012], [r - 0.002, 0.01]]), 0, 0, -u)); }
  else if (kind === 'cap') { len = 0.014; P.add(M.gunmetal, at(knurlZ(r + 0.002, 0.014, 14), 0, 0, -u - 0.007)); P.add(M.bore, at(cylZ(r - 0.0025, r - 0.0025, 0.002, 10), 0, 0, -u - 0.0135)); }
  P.into(g, 'muzzle_device');
  g.position.y = 0.05; g.userData.length = len;
  return g;
}
function buildAK(M, s, id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const wide = s.cal === 12 ? 0.038 : 0.034;
  // ---- stamped receiver: body, trunnion rivets, reinforcing plate above the mag well, axis pins, side rail
  P.add(M.frame, side([[0.0, 0.0], [0.262, 0.0], [0.262, 0.046], [0.0, 0.046]], wide, 0.0015));
  if (hi()) {
    for (const x of [wide / 2 + 0.0006, -wide / 2 - 0.0006]) {
      P.add(M.frame, at(box(0.0012, 0.026, 0.05), x, 0.026, -0.095));                          // reinforcing plate
      for (const [u, v] of [[0.03, 0.012], [0.03, 0.036], [0.25, 0.012], [0.25, 0.036], [0.225, 0.02], [0.06, 0.008]]) P.add(M.steel, at(cylX(0.0028, 0.0028, 0.0016, 8), x, v, -u));   // rivets
    }
    P.add(M.steel, pin(0, 0.02, -0.062, 0.0032, wide + 0.003)); P.add(M.steel, pin(0, 0.02, -0.092, 0.0032, wide + 0.003));   // hammer and trigger pins
    P.add(M.steel, pin(0, 0.04, -0.045, 0.0026, wide + 0.003));                                                             // selector axis
  }
  ejectionPort(P, M, wide / 2 - 0.0002, 0.03, 0.046, 0.1, 0.16);
  // side rail (dovetail) on the left
  P.add(M.gunmetal, at(box(0.0035, 0.014, 0.14), -wide / 2 - 0.0017, 0.026, -0.1));
  if (hi()) { P.add(M.gunmetal, at(box(0.005, 0.006, 0.01), -wide / 2 - 0.0024, 0.026, -0.04)); P.add(M.gunmetal, at(box(0.005, 0.006, 0.01), -wide / 2 - 0.0024, 0.026, -0.16)); }
  // ---- fire control: trigger guard with the flat mag-catch front, mag release paddle, selector lever with its detent plate
  P.add(M.gunmetal, guardU(0.042, 0.128, -0.002, 0.03, 0.004, 0.012));
  P.add(M.gunmetal, at(box(0.014, 0.014, 0.03), 0.0, -0.01, -0.135));                            // mag catch housing
  g.add(part('magrelease', [side([[0.112, -0.006], [0.14, -0.006], [0.138, -0.018], [0.122, -0.026], [0.112, -0.022]], 0.008, 0.0008)], M.gunmetal, [0, -0.006, -0.128]));
  const sel = part('selector', [
    at(side([[0.0, -0.004], [0.075, -0.003], [0.078, 0.003], [0.0, 0.006]], 0.003, 0.0005), wide / 2 + 0.002, 0.04, -0.045),
    at(cylX(0.0045, 0.0045, 0.004, 10), wide / 2 + 0.002, 0.04, -0.045),
    at(box(0.004, 0.008, 0.012), wide / 2 + 0.003, 0.043, -0.118),
  ], M.gunmetal, [0, 0.04, -0.045]);
  sel.rotation.z = 0; sel.userData.base.r.copy(sel.rotation); sel.userData.angles = { safe: 0.32, auto: 0.0, semi: -0.3 };
  g.add(sel);
  if (hi()) { P.add(M.gunmetal, at(box(0.0014, 0.004, 0.003), wide / 2 + 0.0008, 0.046, -0.116)); P.add(M.gunmetal, at(box(0.0014, 0.004, 0.003), wide / 2 + 0.0008, 0.032, -0.118)); }   // detent notches
  g.add(part('trigger', [side([[0.072, -0.006], [0.08, -0.006], ['q', 0.084, -0.02, 0.078, -0.027], [0.071, -0.024]], 0.006, 0.0008)], M.gunmetal, [0, -0.006, -0.075]));
  swivel(P, M, -wide / 2 - 0.004, 0.01, 0.005, 0.005);
  // ---- pistol grip
  {
    const Q = new Parts();
    const gm = s.grip === 'bakelite' ? M.bakelite : s.grip === 'plum' ? M.plum : M.polymerGrip;
    if (s.grip === 'ergo') Q.add(gm, side([[0.035, 0.0], [0.052, -0.006], [0.036, -0.06], [0.03, -0.1], ['q', 0.0, -0.108, -0.012, -0.092], [-0.004, -0.04], [-0.02, -0.004], [0.0, 0.0]], 0.032, 0.0025));
    else Q.add(gm, side([[0.035, 0.0], [0.05, -0.004], [0.018, -0.095], ['q', 0.002, -0.1, -0.006, -0.09], [-0.02, -0.004], [0.0, 0.0]], 0.03, 0.0022));
    if (hi()) Q.addAll(M.gunmetal, screw(0, -0.098, -0.008, 0.0035, 'y'));
    Q.named(g, 'grip');
  }
  // ---- dust cover
  {
    const Q = new Parts(); const cw = wide - 0.003;
    if (s.cover === 'hinged') {
      Q.add(M.frame, side([[0.02, 0.046], [0.262, 0.046], [0.262, 0.058], ['q', 0.262, 0.07, 0.246, 0.07], [0.036, 0.07], ['q', 0.02, 0.07, 0.02, 0.058]], cw, 0.0015));
      Q.add(M.gunmetal, at(cylX(0.005, 0.005, cw + 0.006, 10), 0, 0.062, -0.258));                                        // front hinge
      // flip rear sight on the cover: a U-shaped leaf with a notch
      Q.add(M.gunmetal, at(box(0.02, 0.003, 0.022), 0, 0.0715, -0.052));
      Q.add(M.gunmetal, at(box(0.008, 0.012, 0.002), 0.006, 0.078, -0.044)); Q.add(M.gunmetal, at(box(0.008, 0.012, 0.002), -0.006, 0.078, -0.044));
      Q.add(M.gunmetal, at(box(0.02, 0.004, 0.002), 0, 0.075, -0.044));
      if (hi()) Q.add(M.gunmetal, at(cylX(0.0018, 0.0018, 0.024, 6), 0, 0.0735, -0.062));
    } else if (s.cover === 'rail') {
      Q.add(M.frame, side([[0.02, 0.046], [0.262, 0.046], [0.262, 0.07], [0.02, 0.07]], cw, 0.0015));
      Q.add(M.painted, at(railZ(0.22, 0.0085), 0, 0.07, -0.14));
      Q.add(M.gunmetal, at(cylX(0.005, 0.005, cw + 0.006, 10), 0, 0.062, -0.258));
      // rear aperture sight at the back of the rail
      Q.add(M.gunmetal, at(box(0.018, 0.004, 0.02), 0, 0.0805, -0.035)); Q.add(M.gunmetal, at(box(0.014, 0.012, 0.0025), 0, 0.0885, -0.03));
      Q.add(M.bore, at(cylZ(0.0018, 0.0018, 0.003, 8), 0, 0.0895, -0.03));
    } else {
      Q.add(M.frame, side([[0.02, 0.046], [0.262, 0.046], [0.262, 0.056], ['q', 0.262, 0.07, 0.246, 0.07], [0.036, 0.07], ['q', 0.02, 0.07, 0.02, 0.056]], cw, 0.0015));
      if (s.cover === 'ribbed' && hi()) for (let i = 0; i < 7; i++) Q.add(M.frame, at(box(cw + 0.0016, 0.0016, 0.004), 0, 0.0704, -0.08 - i * 0.022));   // transverse ribs
      if (hi()) Q.add(M.gunmetal, at(box(0.014, 0.008, 0.006), 0, 0.048, -0.021));                                       // recoil spring guide button
    }
    Q.named(g, 'cover');
  }
  // ---- rear sight
  let rear;
  if (s.sight === 'tangent') rear = rearTangent(P, M, 0.262, 0.31, 0.044, { w: wide - 0.006, blockH: 0.03 });
  else if (s.sight === 'cover') rear = { y: 0.086, z: -0.044 };
  else rear = { y: 0.0905, z: -0.03 };
  // ---- barrel assembly
  const rBarrel = s.cal === 12 ? 0.0125 : s.heavy ? 0.011 : 0.0095;
  const bEnd = s.barrelEnd;
  P.add(M.barrel, at(latheZ([[0.013, 0], [0.013, 0.048], [rBarrel + 0.0015, 0.05], [rBarrel + 0.0015, Math.min(bEnd - 0.262 - 0.05, (s.gas || bEnd) - 0.262)], [rBarrel, Math.min(bEnd - 0.262 - 0.04, (s.gas || bEnd) - 0.26)], [rBarrel - 0.0008, bEnd - 0.262]]), 0, 0.05, -0.262));
  P.add(M.bore, at(cylZ(rBarrel - 0.004, rBarrel - 0.004, 0.002, 12), 0, 0.05, -bEnd + 0.0009));
  // gas system
  if (s.gas) {
    P.add(M.gunmetal, at(cylZ(0.0068, 0.0068, s.gas - 0.30, 12), 0, 0.074, -(0.30 + (s.gas - 0.30) / 2)));                  // gas tube
    P.add(M.gunmetal, rect(s.gas, s.gas + 0.03, 0.036, 0.086, 0.026, 0.001, 0.003));                                         // gas block
    if (hi()) { P.add(M.gunmetal, at(cylY(0.005, 0.005, 0.02, 8), 0, 0.066, -(s.gas + 0.015))); P.add(M.gunmetal, at(box(0.03, 0.006, 0.008), 0, 0.04, -(s.gas + 0.008))); }  // gas port boss, bayonet lug
    if (!s.fsb) frontSight(P, M, -(s.gas + 0.015), 0.086, { postH: 0.02, baseL: 0.028, baseH: 0.004 });   // combined block: sight on the gas block
    P.add(M.gunmetal, at(box(0.02, 0.006, 0.01), 0, 0.03, -(s.gas + 0.02)));                                                  // handguard retainer cam
    if (s.gas < 0.5) P.add(M.gunmetal, at(cylZ(0.0025, 0.0025, 0.24, 6), 0, 0.037, -0.42));                                    // cleaning rod
    else P.add(M.gunmetal, at(cylZ(0.0025, 0.0025, bEnd - 0.34, 6), 0, 0.037, -(0.32 + (bEnd - 0.34) / 2)));
  } else {
    // blowback: a block that only carries the handguard retainer and front sight
    P.add(M.gunmetal, rect(s.fsb - 0.015, s.fsb + 0.015, 0.036, 0.062, 0.026, 0.001, 0.003));
  }
  let tip;
  if (s.fsb) tip = frontSight(P, M, -s.fsb, 0.04, { postH: 0.03, baseH: 0.024 }); else tip = 0.086 + 0.004 + 0.02;
  if (s.fsb && hi()) swivel(P, M, -0.017, 0.045, -(s.fsb - 0.02), 0.005);
  // front sight tip sits at the same height as the rear notch on an AK: keep the sight line level
  const fsZ = s.fsb ? -s.fsb : -((s.gas || 0.43) + 0.015);
  g.add(marker('mount_muzzle', 0, 0.05, -bEnd));
  const md = akMuzzle(M, s.muzzle, bEnd, rBarrel); g.add(md);
  g.add(marker('muzzle', 0, 0.05, -bEnd - md.userData.length - 0.003));
  // ---- handguards
  {
    const Q = new Parts(); const [h0, h1] = s.hg;
    if (s.hgKind === 'wood' || s.hgKind === 'plum') {
      const wm = s.hgKind === 'wood' ? M.laminate : M.plum;
      Q.add(wm, side([[h0, 0.024], [h1 - 0.012, 0.024], ['q', h1, 0.024, h1, 0.04], [h1 - 0.012, 0.046], [h0, 0.046]], 0.044, 0.002));      // lower
      Q.add(wm, side([[h0 + 0.03, 0.028], [h1 - 0.03, 0.028], [h1 - 0.03, 0.03], [h0 + 0.03, 0.03]], 0.05, 0.0015));                       // palm swell
      if (s.gas) Q.add(wm, side([[h0 + 0.015, 0.064], [h1 - 0.01, 0.064], [h1 - 0.01, 0.084], ['q', h1 - 0.01, 0.09, h1 - 0.02, 0.09], [h0 + 0.02, 0.09], ['q', h0 + 0.015, 0.09, h0 + 0.015, 0.084]], 0.028, 0.0015)); // upper
      Q.add(M.gunmetal, rect(h0 - 0.006, h0 + 0.004, 0.02, 0.05, 0.048, 0.001));                                                          // rear ferrule
      Q.add(M.gunmetal, rect(h1 - 0.012, h1 - 0.002, 0.02, 0.05, 0.046, 0.001));                                                          // front retainer band
      if (hi()) Q.add(M.gunmetal, at(box(0.006, 0.01, 0.014), 0.026, 0.035, -(h1 - 0.007)));                                               // retainer latch
    } else if (s.hgKind === 'black') {
      Q.add(M.polymer, side([[h0, 0.022], [h1 - 0.01, 0.022], ['q', h1, 0.022, h1, 0.038], [h1 - 0.01, 0.046], [h0, 0.046]], 0.042, 0.002));
      if (hi()) for (let i = 0; i < 7; i++) Q.add(M.polymer, at(box(0.0445, 0.006, 0.0025), 0, 0.03, -(h0 + 0.03 + i * 0.022)));            // moulded ridges
      if (s.gas) Q.add(M.polymer, side([[h0 + 0.015, 0.064], [h1 - 0.01, 0.064], [h1 - 0.01, 0.084], ['q', h1 - 0.01, 0.09, h1 - 0.02, 0.09], [h0 + 0.02, 0.09], ['q', h0 + 0.015, 0.09, h0 + 0.015, 0.084]], 0.028, 0.0015));
      Q.add(M.gunmetal, rect(h0 - 0.006, h0 + 0.004, 0.02, 0.05, 0.046, 0.001)); Q.add(M.gunmetal, rect(h1 - 0.012, h1 - 0.002, 0.02, 0.05, 0.044, 0.001));
    } else if (s.hgKind === 'rail') {
      Q.add(M.painted, side([[h0, 0.02], [h1 - 0.006, 0.02], ['q', h1, 0.02, h1, 0.034], [h1 - 0.006, 0.048], [h0, 0.048]], 0.04, 0.0015));
      Q.add(M.painted, side([[h0 + 0.01, 0.064], [h1 - 0.006, 0.064], [h1 - 0.006, 0.088], [h0 + 0.01, 0.088]], 0.03, 0.0015));
      Q.add(M.painted, at(railZ(h1 - h0 - 0.04, 0.0085), 0, 0.02 - 0.0085, -(h0 + h1) / 2, Math.PI));                                      // bottom rail
      for (const sx of [-1, 1]) Q.add(M.painted, at(railZ(h1 - h0 - 0.06, 0.007), sx * 0.02, 0.034, -(h0 + h1) / 2, 0, 0, sx * -Math.PI / 2)); // side rails
      Q.add(M.painted, at(railZ(h1 - h0 - 0.03, 0.0085), 0, 0.088, -(h0 + h1) / 2));                                                        // top rail
      if (hi()) for (let i = 0; i < 6; i++) { Q.add(M.bore, at(box(0.0412, 0.006, 0.01), 0, 0.028, -(h0 + 0.03 + i * 0.03))); }             // vent slots
    } else if (s.hgKind === 'bizon') {
      Q.add(M.polymer, side([[h0, 0.036], [h1 - 0.008, 0.036], ['q', h1, 0.036, h1, 0.046], [h1 - 0.006, 0.05], [h0, 0.05]], 0.04, 0.002));
      Q.add(M.gunmetal, rect(h0 - 0.006, h0 + 0.004, 0.03, 0.054, 0.046, 0.001));
    }
    Q.named(g, 'handguard');
  }
  // ---- bolt carrier with charging handle (right), visible through the cover gap
  const bolt = part('bolt', [at(box(0.016, 0.014, 0.05), wide / 2 - 0.002, 0.04, -0.11), at(side([[0.0, -0.006], [0.02, -0.006], [0.024, 0.0], [0.02, 0.008], [0.0, 0.008]], 0.012, 0.001), wide / 2 + 0.01, 0.04, -0.11)], M.bolt, [0, 0, -0.11]);
  g.add(bolt);
  g.add(marker('eject', wide / 2 + 0.004, 0.05, -0.12));
  // ---- stock, magazine well anchor, bipod
  akStock(M, s.stock, g);
  g.add(marker('mount_stock', 0, 0.02, 0.0));
  g.add(marker('mount_dovetail', -wide / 2 - 0.0035, 0.033, -0.1));
  if (s.cover === 'rail') g.add(marker('mount_top', 0, 0.0785, -0.13));
  if (s.hgKind === 'rail') { g.add(marker('mount_under', 0, 0.0115, -(s.hg[0] + s.hg[1]) / 2)); g.add(marker('mount_side', -0.0272, 0.034, -(s.hg[0] + s.hg[1]) / 2)); }
  if (s.bipod) { const bp = new THREE.Group(); bp.name = 'bipod'; bipodGeos(M, -s.bipod, 0.03, { legLen: 0.2, spread: 0.018 }).into(bp, 'bipod'); bp.userData.base = { p: bp.position.clone(), r: new THREE.Euler() }; g.add(bp); }
  P.into(g);
  // magazine node: swappable child, pivot at the feed lips
  let magNode;
  if (s.mag === 'mag_bizon64') { magNode = node('mag', 0, 0.026, -0.40); magNode.userData.travel = [0, -0.06, -0.2]; }
  else { magNode = node('mag', 0, 0.004, -0.15); magNode.userData.travel = [0, -0.2, -0.06]; }
  g.add(magNode);
  const isShort = bEnd < 0.55;
  g.userData = {
    id, family: 'ak', sightY: rear.y, sightLine: { rear: [0, rear.y, rear.z], front: [0, tip, fsZ] },
    hip: { p: [0.13, -0.15, -0.2], r: [0.03, -0.1, 0.03] },
    ads: { p: [0.0, -rear.y - 0.008, 0.08], r: [0.012, 0, 0] },
    grips: { right: GRIP_R([0.0, -0.05, -0.016], 'rifle'), left: GRIP_L([0, 0.024, isShort ? -0.37 : -0.42], 'foreend') },
    lowerRot: [0.45, 0.35, 0.25], magTravel: magNode.userData.travel, cycle: 'bolt', slideTravel: 0.11, ejectDir: [1, 0.5, 0.35],
    mounts: WEAPONS[id] ? WEAPONS[id].mounts : {}, defaultMag: s.mag,
  };
  return g;
}

// ---------------------------------------------------------------- AR family: M4A1, HK416, SCAR-L
// Bore at y = 0.05. Lower receiver rear face at u = 0 (buffer tube threads), upper 0..0.2 with the flat-top rail.
function arStock(M, kind, g) {
  const P = new Parts();
  if (kind === 'm4' || kind === 'hk') {
    // collapsible stock body riding on the buffer tube, extended two notches
    const u0 = -0.09, u1 = -0.265;
    P.add(M.polymer, side([[u0, 0.052], [u1 + 0.01, 0.052], ['q', u1, 0.052, u1, 0.04], [u1, -0.045], ['q', u1, -0.06, u1 + 0.012, -0.06], [u0 + 0.03, -0.012], [u0, 0.006]], 0.038, 0.002));
    P.add(M.polymer, side([[u0 - 0.02, 0.058], [u1 + 0.02, 0.058], [u1 + 0.02, 0.034], [u0 - 0.02, 0.034]], 0.042, 0.002));      // saddle over the tube
    if (hi()) { P.add(M.polymer, at(box(0.016, 0.01, 0.03), 0, 0.006, -u0 + 0.03)); P.add(M.steel, pin(0, 0.004, -u0 + 0.03, 0.003, 0.02)); }   // release lever
    buttplate(P, M, M.rubber, u1 - 0.006, -0.06, 0.052, 0.04, 0.006);
    swivel(P, M, -0.021, -0.02, -u1 + 0.05, 0.005);
    P.named(g, 'stock');
    g.add(marker('mount_pad', 0, -0.004, -u1 + 0.006));
    g.userData.padSpec = { v: [-0.06, 0.052], w: 0.04 };
  } else {
    // SCAR: side-folding polymer stock with a cheek riser and a telescoping butt
    P.add(M.tan, side([[0.0, 0.06], [-0.24, 0.056], [-0.27, 0.05], ['q', -0.285, 0.05, -0.285, 0.036], [-0.285, -0.07], ['q', -0.285, -0.084, -0.27, -0.084], [-0.2, -0.05], ['q', -0.1, -0.012, -0.03, -0.006], [0.0, 0.0]], 0.036, 0.002));
    P.add(M.tan, at(box(0.03, 0.014, 0.1), 0, 0.066, 0.19));                                   // cheek riser
    P.add(M.tan, at(box(0.026, 0.034, 0.03), 0, 0.03, 0.012));                                // hinge block
    P.add(M.steel, pin(0, 0.03, 0.012, 0.0035, 0.03));
    if (hi()) for (let i = 0; i < 3; i++) P.add(M.bore, at(box(0.0375, 0.005, 0.005), 0, 0.02 - i * 0.02, 0.24));   // adjustment holes
    buttplate(P, M, M.rubber, -0.293, -0.084, 0.05, 0.036, 0.008);
    P.named(g, 'stock');
    g.add(marker('mount_pad', 0, -0.017, 0.293));
    g.userData.padSpec = { v: [-0.084, 0.05], w: 0.036 };
  }
}
function a2FlashHider(M, u) {
  const g = new THREE.Group(); g.name = 'muzzle_device'; const P = new Parts();
  P.add(M.gunmetal, at(latheZ([[0.0075, 0], [0.011, 0.004], [0.011, 0.014], [0.0105, 0.02], [0.0112, 0.05], [0.0095, 0.055], [0.005, 0.055], [0.005, 0.053]]), 0, 0, -u));
  if (hi()) for (let i = 0; i < 5; i++) P.add(M.bore, at(box(0.03, 0.0025, 0.026), 0, 0, -u - 0.037, 0, 0, Math.PI / 2 + (i - 2) * Math.PI / 5 * 0.72));   // five slots, solid bottom
  P.into(g, 'muzzle_device'); g.position.y = 0.05; g.userData.length = 0.055; return g;
}
function buildAR(M, s, id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const scar = s.kind === 'scar', hk = s.kind === 'hk416';
  const upperM = scar ? M.tan : M.painted, lowerM = scar ? M.polymer : M.painted;
  const railTop = scar ? 0.078 : 0.072;
  // ---- upper receiver
  if (scar) {
    // monolithic aluminium upper: receiver and handguard in one long extrusion with full-length top rail
    P.add(upperM, side([[-0.01, 0.03], [0.5, 0.03], [0.5, 0.078], [-0.01, 0.078]], 0.04, 0.0018));
    P.add(upperM, at(railZ(0.5, 0.0085), 0, 0.078, -0.245));
    for (const sx of [-1, 1]) P.add(upperM, at(railZ(0.2, 0.007), sx * 0.02, 0.05, -0.38, 0, 0, sx * -Math.PI / 2));
    P.add(upperM, at(railZ(0.22, 0.0085), 0, 0.03, -0.37, Math.PI));
    if (hi()) for (let i = 0; i < 8; i++) { P.add(M.bore, at(box(0.0412, 0.008, 0.012), 0, 0.058, -(0.24 + i * 0.03))); }   // vent slots
    if (hi()) for (let i = 0; i < 4; i++) P.add(upperM, at(box(0.004, 0.012, 0.16), 0, 0.02, -(0.22 + 0.08), 0, 0, 0));
  } else {
    P.add(upperM, side([[-0.005, 0.03], [0.2, 0.03], [0.2, 0.072], [-0.005, 0.072]], 0.036, 0.0018));
    P.add(upperM, at(railZ(0.19, 0.0085), 0, 0.072, -0.1));
    // brass deflector, forward assist, ejection port with its spring door
    P.add(upperM, at(side([[0.075, 0.036], [0.096, 0.036], [0.096, 0.062], [0.08, 0.066], [0.075, 0.062]], 0.014, 0.001), 0.023, 0, 0));
    P.add(upperM, at(cylZ(0.008, 0.008, 0.03, 12), 0.022, 0.05, -0.05)); if (hi()) P.add(M.steel, at(cylZ(0.006, 0.0055, 0.006, 10), 0.022, 0.05, -0.032));
    ejectionPort(P, M, 0.0178, 0.04, 0.062, 0.1, 0.16);
    P.add(upperM, at(box(0.0016, 0.024, 0.062), 0.0195, 0.038, -0.13, 0.5, 0, 0));           // port door, hanging open
    if (hi()) { P.add(M.steel, pin(0, 0.028, -0.052, 0.0032, 0.04)); P.add(M.steel, pin(0, 0.028, -0.176, 0.0032, 0.04)); }   // takedown and pivot pins
    // delta ring and barrel nut
    P.add(M.gunmetal, at(latheZ([[0.012, 0], [0.019, 0.004], [0.019, 0.022], [0.016, 0.03]]), 0, 0.05, -0.2));
  }
  // ---- charging handle at the rear of the upper (T-handle with the left latch); the carrier behind the port
  const handle = part('handle', [at(box(0.012, 0.007, 0.06), 0, 0.064, -0.02), at(box(0.036, 0.007, 0.012), 0, 0.064, 0.008), at(box(0.006, 0.01, 0.014), -0.02, 0.064, 0.008)], M.gunmetal, [0, 0.064, 0.008]);
  if (!scar) g.add(handle);
  const bolt = part('bolt', [at(box(0.012, 0.018, 0.05), 0.012, 0.051, -0.128)], M.bolt, [0, 0.05, -0.128]);
  if (scar) { bolt.add(sub(part('handle', [at(box(0.024, 0.014, 0.012), -0.03, 0.06, -0.14), at(cylX(0.005, 0.005, 0.02, 8), -0.026, 0.06, -0.14)], M.gunmetal, [0, 0.05, -0.128]))); }
  g.add(bolt);
  g.add(marker('eject', 0.02, 0.05, -0.13));
  // ---- lower receiver: mag well, trigger guard, grip, selector, mag release, bolt catch
  P.add(lowerM, side([[0.0, 0.0], [0.03, -0.004], [0.09, -0.004], [0.09, -0.06], [0.16, -0.06], [0.165, -0.004], [0.2, -0.004], [0.2, 0.03], [0.0, 0.03]], scar ? 0.034 : 0.032, 0.0018));
  if (scar) P.add(lowerM, side([[0.09, -0.06], [0.16, -0.06], [0.16, -0.062], [0.09, -0.062]], 0.04, 0.001));
  P.add(lowerM, guardU(0.04, 0.095, -0.004, 0.026, 0.0035, 0.01));
  const sel = part('selector', [at(side([[0.0, -0.003], [0.024, -0.002], [0.026, 0.002], [0.0, 0.004]], 0.003, 0.0005), -0.018, 0.02, -0.04), at(cylX(0.0045, 0.0045, 0.004, 10), -0.018, 0.02, -0.04)], M.gunmetal, [0, 0.02, -0.04]);
  sel.userData.angles = { safe: 0, semi: -1.5, auto: -3.0 }; g.add(sel);
  if (hi()) { P.add(M.gunmetal, at(cylX(0.004, 0.004, 0.004, 10), 0.017, 0.006, -0.085)); P.add(M.gunmetal, at(box(0.006, 0.014, 0.008), 0.017, 0.006, -0.088)); }   // mag release
  if (hi()) P.add(M.gunmetal, at(side([[0.075, 0.012], [0.092, 0.012], [0.092, 0.026], [0.075, 0.026]], 0.004, 0.0005), -0.018, 0, 0));   // bolt catch
  g.add(part('trigger', [side([[0.062, -0.006], [0.07, -0.006], ['q', 0.074, -0.018, 0.068, -0.026], [0.061, -0.024]], 0.006, 0.0008)], M.gunmetal, [0, -0.006, -0.066]));
  {
    const Q = new Parts();
    Q.add(M.polymerGrip, side([[0.03, 0.0], [0.045, -0.004], [0.02, -0.08], ['q', 0.004, -0.09, -0.008, -0.078], [-0.02, -0.004], [0.0, 0.0]], 0.03, 0.0022));
    if (hi()) Q.add(M.polymerGrip, at(box(0.032, 0.006, 0.006), 0, -0.036, -0.02));  // finger nub
    Q.named(g, 'grip');
  }
  // ---- barrel, gas system, handguard
  const bEnd = scar ? 0.62 : 0.637;
  P.add(M.barrel, at(latheZ([[0.012, 0], [0.012, 0.02], [0.0095, 0.024], [0.0095, 0.2], [0.0085, 0.24], [0.0085, bEnd - 0.2 - 0.02], [0.0075, bEnd - 0.2]]), 0, 0.05, -0.2));
  P.add(M.bore, at(cylZ(0.0035, 0.0035, 0.002, 10), 0, 0.05, -bEnd + 0.0009));
  let front, rear;
  if (s.kind === 'm4') {
    // KAC RAS quad rail with heat shield rows of holes, FSB with the sling swivel and bayonet lug, gas tube
    const h0 = 0.23, h1 = 0.42;
    for (const [rx, y, x] of [[0, 0.069, 0], [Math.PI, 0.031, 0], [Math.PI / 2, 0.05, -0.019], [-Math.PI / 2, 0.05, 0.019]]) { const r = railZ(h1 - h0, 0.0085, 0.021); if (rx === Math.PI / 2) { r.rotateZ(Math.PI / 2); } else if (rx === -Math.PI / 2) { r.rotateZ(-Math.PI / 2); } else if (rx) r.rotateX(rx); r.translate(x, y, -(h0 + h1) / 2); P.add(M.painted, r); }
    P.add(M.painted, at(cylZ(0.02, 0.02, h1 - h0, 8), 0, 0.05, -(h0 + h1) / 2, 0, Math.PI / 8));
    if (hi()) for (let i = 0; i < 12; i++) for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) P.add(M.bore, at(cylZ(0.0025, 0.0025, 0.002, 6), Math.cos(a) * 0.0195, 0.05 + Math.sin(a) * 0.0195, -(h0 + 0.012 + i * 0.015)));
    P.add(M.gunmetal, at(cylZ(0.0035, 0.0035, 0.26, 8), 0, 0.066, -0.33));                                             // gas tube
    // FSB
    P.add(M.gunmetal, side([[0.44, 0.03], [0.485, 0.03], [0.485, 0.07], [0.478, 0.074], [0.447, 0.074], [0.44, 0.07]], 0.024, 0.001));
    P.add(M.gunmetal, at(cylZ(0.012, 0.012, 0.045, 12), 0, 0.05, -0.4625));
    front = frontSight(P, M, -0.462, 0.074, { postH: 0.026, baseH: 0.006, baseL: 0.024, baseW: 0.022 });
    if (hi()) { P.add(M.gunmetal, at(box(0.014, 0.008, 0.012), 0, 0.028, -0.47)); swivel(P, M, 0, 0.022, -0.478, 0.005); }
  } else if (hk) {
    // free-float quad rail, longer; flip-up front sight (deployed) on the rail; low-profile gas block inside
    const h0 = 0.23, h1 = 0.5;
    P.add(M.painted, at(cylZ(0.021, 0.021, h1 - h0, 8), 0, 0.05, -(h0 + h1) / 2, 0, Math.PI / 8));
    for (const [rx, y, x] of [[0, 0.07, 0], [Math.PI, 0.03, 0], [Math.PI / 2, 0.05, -0.0195], [-Math.PI / 2, 0.05, 0.0195]]) { const r = railZ(h1 - h0 - 0.01, 0.0085, 0.021); if (rx === Math.PI / 2) r.rotateZ(Math.PI / 2); else if (rx === -Math.PI / 2) r.rotateZ(-Math.PI / 2); else if (rx) r.rotateX(rx); r.translate(x, y, -(h0 + h1) / 2); P.add(M.painted, r); }
    if (hi()) for (let i = 0; i < 14; i++) for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) P.add(M.bore, at(box(0.006, 0.004, 0.012), Math.cos(a) * 0.02, 0.05 + Math.sin(a) * 0.02, -(h0 + 0.015 + i * 0.018), 0, 0, a - Math.PI / 2));
    P.add(M.gunmetal, at(box(0.008, 0.026, 0.02), 0, 0.078 + 0.013, -0.49)); P.add(M.gunmetal, at(box(0.018, 0.004, 0.02), 0, 0.0805, -0.49));
    front = 0.078 + 0.026; frontSight(P, M, -0.49, 0.0805, { postH: 0.02, baseH: 0.002, baseL: 0.018, baseW: 0.018, ears: 'wings' }); front = 0.0825 + 0.02;
  } else {
    // SCAR: folding front sight (deployed) on the rail at the front, gas regulator knob
    P.add(M.gunmetal, at(box(0.006, 0.024, 0.016), 0, 0.0985, -0.47)); P.add(M.gunmetal, at(box(0.018, 0.004, 0.016), 0, 0.0885, -0.47));
    front = frontSight(P, M, -0.47, 0.0865, { postH: 0.02, baseH: 0.004, baseL: 0.016, baseW: 0.018 });
    if (hi()) P.add(M.gunmetal, at(knurlZ(0.007, 0.01, 12), 0, 0.072, -0.455));
  }
  // rear sight: flip-up aperture at the rear of the rail (deployed)
  {
    const y0 = railTop + 0.0085, uz = scar ? -0.03 : -0.02;
    P.add(M.gunmetal, at(box(0.02, 0.005, 0.024), 0, y0 + 0.0025, uz));
    P.add(M.gunmetal, at(box(0.018, 0.02, 0.0025), 0, y0 + 0.015, uz - 0.006));
    P.add(M.bore, at(cylZ(0.0022, 0.0022, 0.0035, 8), 0, y0 + 0.0185, uz - 0.006));
    if (hi()) P.add(M.gunmetal, at(knurlZ(0.004, 0.006, 10), 0.012, y0 + 0.014, uz - 0.006, 0, Math.PI / 2));
    rear = { y: y0 + 0.0185, z: uz - 0.006 };
  }
  // ---- buffer tube and stock
  if (!scar) {
    P.add(M.anodised, at(cylZ(0.0145, 0.0145, 0.19, 12), 0, 0.044, 0.095));
    P.add(M.anodised, at(hexZ(0.019, 0.008), 0, 0.044, 0.006));                                      // castle nut
    if (hi()) for (let i = 0; i < 5; i++) P.add(M.bore, at(box(0.006, 0.003, 0.006), 0, 0.03, 0.06 + i * 0.022));   // adjustment holes
  }
  arStock(M, scar ? 'scar' : s.kind === 'hk416' ? 'hk' : 'm4', g);
  g.add(marker('mount_stock', 0, 0.044, 0.0));
  g.add(marker('mount_muzzle', 0, 0.05, -bEnd));
  const md = a2FlashHider(M, bEnd); g.add(md);
  g.add(marker('muzzle', 0, 0.05, -bEnd - 0.058));
  g.add(marker('mount_top', 0, railTop + 0.0085, -0.1));
  if (scar) { g.add(marker('mount_under', 0, 0.0215, -0.37)); g.add(marker('mount_side', -0.027, 0.05, -0.38)); }
  else if (hk) { g.add(marker('mount_under', 0, 0.0215, -0.4)); g.add(marker('mount_side', -0.028, 0.05, -0.4)); }
  else { g.add(marker('mount_under', 0, 0.0225, -0.35)); g.add(marker('mount_side', -0.0275, 0.05, -0.35)); }
  P.into(g);
  const magNode = node('mag', 0, -0.004, -0.125); magNode.userData.travel = [0, -0.2, -0.02]; g.add(magNode);
  g.userData = {
    id, family: 'ar', sightY: rear.y, sightLine: { rear: [0, rear.y, rear.z], front: [0, front, scar ? -0.47 : hk ? -0.49 : -0.462] },
    hip: { p: [0.13, -0.15, -0.2], r: [0.03, -0.1, 0.03] },
    ads: { p: [0.0, -rear.y - 0.008, 0.06], r: [0.012, 0, 0] },
    grips: { right: GRIP_R([0.0, -0.05, -0.012], 'rifle'), left: GRIP_L([0, 0.026, -0.36], 'foreend') },
    lowerRot: [0.45, 0.35, 0.25], magTravel: [0, -0.2, -0.02], cycle: 'bolt', slideTravel: 0.08, ejectDir: [1, 0.5, 0.35],
    mounts: WEAPONS[id] ? WEAPONS[id].mounts : {}, defaultMag: 'mag_stanag30',
  };
  return g;
}

// ---------------------------------------------------------------- pistols
// Frame at the origin; bore height per gun; slide is the cycling part; the magazine node sits in the grip, tilted with it.
function pistolUD(id, sightY, adsZ, gripP, magPivot, travel, extra = {}) {
  return Object.assign({
    id, family: 'pistol', sightY, sightLine: extra.sightLine || null,
    hip: { p: [0.13, -0.14, -0.31], r: [0.0, -0.06, 0.02] },
    ads: { p: [0, -sightY - 0.002, adsZ], r: [0, 0, 0] },
    grips: { right: GRIP_R(gripP, 'pistol', [0.15, -0.35, 0.92]), left: GRIP_L_PISTOL([gripP[0] - 0.024, gripP[1] - 0.018, gripP[2] - 0.028]) },
    lowerRot: [0.35, 0.2, 0.15], magTravel: [0, -0.16, 0.02], cycle: 'slide', slideTravel: travel, ejectDir: [1, 0.6, 0.25],
    mounts: WEAPONS[id] ? WEAPONS[id].mounts : {},
  }, extra);
}
function buildPM(M, id, pb = false) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  // frame with the grip frame; dust cover under the slide; rounded trigger guard; safety and slide stop; lanyard loop
  P.add(M.frame, side([[-0.006, -0.002], [0.122, -0.002], [0.122, -0.012], [0.078, -0.014], [0.048, -0.014], [0.036, -0.022], [0.012, -0.098], [-0.026, -0.104], ['q', -0.036, -0.06, -0.022, -0.02], [-0.012, -0.004]], 0.024, 0.0015));
  P.add(M.frame, rect(0.046, 0.122, -0.012, 0.0, 0.026, 0.001));
  P.add(M.frame, at(ringX(0.0165, 0.0021, Math.PI - 0.35, Math.PI + 0.7, 18, 6), 0, -0.017, -0.06));
  P.add(M.gunmetal, at(box(0.0025, 0.005, 0.02), -0.0135, 0.004, -0.05));                                       // slide stop
  P.add(M.gunmetal, at(ringX(0.004, 0.001, 0, Math.PI * 2, 10, 5), 0, -0.108, 0.02));                            // lanyard loop
  P.add(M.gunmetal, at(cylX(0.0065, 0.0065, 0.0014, 12), 0.0175, -0.056, 0.004)); P.add(M.gunmetal, at(cylX(0.0065, 0.0065, 0.0014, 12), -0.0175, -0.056, 0.004));   // grip medallions
  if (hi()) { P.add(M.steel, pin(0, -0.006, -0.03, 0.0025, 0.026)); P.add(M.steel, pin(0, -0.03, 0.006, 0.0025, 0.026)); P.addAll(M.gunmetal, screw(0, -0.09, 0.012, 0.003, 'z')); }
  P.add(M.bakelite, side([[0.033, -0.022], [0.010, -0.096], [-0.022, -0.1], ['q', -0.032, -0.06, -0.019, -0.022]], 0.034, 0.0022));   // wrap-around grip
  P.into(g);
  // slide: PB keeps a shorter slide with the suppressor sleeve ahead of it
  const sLen = pb ? 0.098 : 0.13;
  const slideGeos = [
    side([[-0.004, 0.0], [sLen - 0.004, 0.0], [sLen, 0.006], [sLen, 0.022], [sLen - 0.006, 0.030], [0.0, 0.030], [-0.004, 0.024]], 0.026, 0.0018),
    at(cylZ(0.0065, 0.0065, 0.012, 14), 0, 0.014, -(sLen - 0.002)),                             // barrel bushing / muzzle
  ];
  pistolSights(slideGeos, 0.008, pb ? 0.085 : 0.115, 0.030, 0.02);
  if (hi()) serrations(slideGeos, 6, 0, 0.014, -0.012, 0.0045, 0.0272, 0.018, 0.0012);
  const slide = part('slide', slideGeos, M.bolt, [0, 0, 0]);
  slide.add(sub(part('port', [at(box(0.001, 0.011, 0.024), 0.0135, 0.02, -0.072)], M.bore, [0, 0, 0])));
  slide.add(sub(part('safety', [at(box(0.003, 0.006, 0.012), -0.0145, 0.02, 0.0), at(cylX(0.0035, 0.0035, 0.003, 8), -0.0145, 0.023, -0.005)], M.gunmetal, [0, 0, 0])));  // safety lever, left rear
  if (!pb) slide.add(sub(part('bore', [at(cylZ(0.0045, 0.0045, 0.002, 12), 0, 0.014, -(sLen + 0.0045))], M.bore, [0, 0, 0])));
  g.add(slide);
  let muzzleZ = -(sLen + 0.006);
  if (pb) {
    // integral expansion sleeve around the barrel and the detachable front can with its knurled collar
    P.add(M.gunmetal, at(latheZ([[0.009, 0], [0.0145, 0.004], [0.0145, 0.06], [0.0125, 0.064]]), 0, 0.014, -0.096));
    P.add(M.gunmetal, at(knurlZ(0.0155, 0.012, 16), 0, 0.014, -0.164));
    P.add(M.gunmetal, at(latheZ([[0.0125, 0], [0.016, 0.003], [0.016, 0.13], [0.013, 0.134], [0.006, 0.134], [0.006, 0.13]]), 0, 0.014, -0.17));
    if (hi()) for (let i = 0; i < 4; i++) P.add(M.gunmetal, at(ringZ(0.0163, 0.0008), 0, 0.014, -0.2 - i * 0.025));
    P.add(M.bore, at(cylZ(0.0045, 0.0045, 0.002, 12), 0, 0.014, -0.302));
    P.into(g);
    muzzleZ = -0.306;
  }
  g.add(part('hammer', [side([[-0.002, -0.001], [-0.004, 0.012], [-0.018, 0.02], [-0.02, 0.016], [-0.01, 0.006], [-0.006, -0.001]], 0.008, 0.0008)], M.gunmetal, [-0.003, 0, 0]));
  g.add(part('trigger', [side([[0.052, -0.019], [0.059, -0.019], ['q', 0.062, -0.03, 0.058, -0.04], [0.052, -0.038]], 0.006, 0.0008)], M.gunmetal, [0.0, -0.019, -0.055]));
  const mag = node('mag', 0, -0.018, -0.018); mag.rotation.x = -18 * DEG; mag.userData.base.r.copy(mag.rotation); g.add(mag);
  g.add(marker('muzzle', 0, 0.014, muzzleZ));
  g.add(marker('eject', 0.016, 0.026, -0.072));
  g.add(marker('mount_muzzle', 0, 0.014, muzzleZ + 0.004));
  g.userData = pistolUD(id, 0.0355, -0.30, [0.0, -0.062, -0.002], null, 0.03, { sightLine: { rear: [0, 0.0355, -0.008], front: [0, 0.0355, pb ? -0.085 : -0.115] }, defaultMag: 'mag_pm8' });
  return g;
}
function buildAPS(M, id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  P.add(M.frame, side([[-0.008, -0.002], [0.15, -0.002], [0.15, -0.014], [0.06, -0.016], [0.044, -0.024], [0.02, -0.11], [-0.03, -0.118], ['q', -0.044, -0.07, -0.028, -0.022], [-0.014, -0.004]], 0.03, 0.0015));
  P.add(M.frame, rect(0.06, 0.15, -0.014, 0.0, 0.032, 0.001));
  P.add(M.frame, at(ringX(0.018, 0.0022, Math.PI - 0.4, Math.PI + 0.75, 18, 6), 0, -0.02, -0.075));
  P.add(M.gunmetal, at(box(0.0025, 0.005, 0.024), -0.0165, 0.004, -0.06));
  P.add(M.gunmetal, at(box(0.012, 0.03, 0.004), 0, -0.1, 0.028));                                           // holster-stock lug on the backstrap
  P.add(M.gunmetal, at(ringX(0.0045, 0.001, 0, Math.PI * 2, 10, 5), 0, -0.122, 0.018));
  if (hi()) { P.add(M.steel, pin(0, -0.008, -0.04, 0.0025, 0.032)); P.addAll(M.gunmetal, screw(0.0205, -0.07, 0.004, 0.003, 'x')); P.addAll(M.gunmetal, screw(-0.0205, -0.07, 0.004, 0.003, 'x')); }
  P.add(M.bakelite, side([[0.04, -0.026], [0.016, -0.108], [-0.026, -0.114], ['q', -0.04, -0.07, -0.024, -0.026]], 0.04, 0.0022));
  P.into(g);
  const slideGeos = [
    side([[-0.006, 0.0], [0.152, 0.0], [0.156, 0.006], [0.156, 0.024], [0.15, 0.031], [0.0, 0.031], [-0.006, 0.024]], 0.03, 0.0018),
    at(cylZ(0.0075, 0.0075, 0.012, 14), 0, 0.015, -0.154),
    at(cylX(0.008, 0.008, 0.016, 12), 0, 0.034, -0.018),                                                   // rear sight drum
    at(box(0.006, 0.004, 0.006), 0, 0.041, -0.014),                                                       // drum notch blade
    at(box(0.0026, 0.006, 0.005), 0, 0.034, -0.142),                                                      // front blade
  ];
  if (hi()) { serrations(slideGeos, 7, 0, 0.015, -0.014, 0.0045, 0.0312, 0.018, 0.0012); slideGeos.push(at(knurlZ(0.0082, 0.006, 14), 0, 0.034, -0.018, 0, Math.PI / 2)); }
  const slide = part('slide', slideGeos, M.bolt, [0, 0, 0]);
  slide.add(sub(part('port', [at(box(0.001, 0.012, 0.028), 0.0155, 0.02, -0.085)], M.bore, [0, 0, 0])));
  slide.add(sub(part('selector', [at(box(0.003, 0.012, 0.014), -0.0165, 0.022, -0.006)], M.gunmetal, [0, 0, 0])));      // safety / auto selector, left rear
  slide.add(sub(part('bore', [at(cylZ(0.0045, 0.0045, 0.002, 12), 0, 0.015, -0.1605)], M.bore, [0, 0, 0])));
  g.add(slide);
  g.add(part('hammer', [side([[-0.004, -0.001], [-0.006, 0.014], [-0.022, 0.022], [-0.024, 0.018], [-0.012, 0.006], [-0.008, -0.001]], 0.008, 0.0008)], M.gunmetal, [-0.005, 0, 0]));
  g.add(part('trigger', [side([[0.062, -0.021], [0.07, -0.021], ['q', 0.074, -0.034, 0.07, -0.046], [0.062, -0.044]], 0.006, 0.0008)], M.gunmetal, [0.0, -0.021, -0.066]));
  const mag = node('mag', 0, -0.022, -0.012); mag.rotation.x = -16 * DEG; mag.userData.base.r.copy(mag.rotation); g.add(mag);
  g.add(marker('muzzle', 0, 0.015, -0.162)); g.add(marker('eject', 0.018, 0.028, -0.085)); g.add(marker('mount_muzzle', 0, 0.015, -0.158));
  g.userData = pistolUD(id, 0.043, -0.30, [0.0, -0.07, 0.0], null, 0.034, { sightLine: { rear: [0, 0.043, -0.014], front: [0, 0.04, -0.142] }, defaultMag: 'mag_aps20', magTravel: [0, -0.18, 0.02] });
  return g;
}
function buildTT(M, id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  P.add(M.frame, side([[-0.004, -0.002], [0.135, -0.002], [0.135, -0.012], [0.07, -0.014], [0.05, -0.016], [0.04, -0.026], [0.016, -0.1], [-0.028, -0.11], ['q', -0.038, -0.06, -0.022, -0.022], [-0.01, -0.004]], 0.022, 0.0015));
  P.add(M.frame, rect(0.055, 0.135, -0.012, 0.0, 0.024, 0.001));
  P.add(M.frame, at(ringX(0.0165, 0.002, Math.PI - 0.35, Math.PI + 0.7, 18, 6), 0, -0.02, -0.066));
  P.add(M.gunmetal, at(box(0.0025, 0.005, 0.022), -0.0125, 0.003, -0.05));
  P.add(M.gunmetal, at(box(0.02, 0.006, 0.008), 0, -0.108, 0.012));                                   // heel magazine catch
  P.add(M.gunmetal, at(ringX(0.0045, 0.001, 0, Math.PI * 2, 10, 5), 0, -0.114, 0.022));
  if (hi()) { P.add(M.steel, pin(0, -0.007, -0.038, 0.0025, 0.024)); }
  // grip panels with vertical grooves and the star medallion
  for (const sx of [-1, 1]) {
    P.add(M.bakelite, at(side([[0.03, -0.026], [0.012, -0.096], [-0.024, -0.104], ['q', -0.034, -0.06, -0.02, -0.026]], 0.004, 0.0015), sx * 0.0125, 0, 0));
    if (hi()) { P.add(M.gunmetal, at(cylX(0.0075, 0.0075, 0.0012, 12), sx * 0.015, -0.056, 0.004)); P.add(M.gunmetal, at(cylX(0.004, 0.004, 0.0016, 5), sx * 0.0155, -0.056, 0.004)); }
  }
  P.into(g);
  const slideGeos = [
    side([[-0.004, 0.0], [0.14, 0.0], [0.144, 0.006], [0.144, 0.02], [0.138, 0.027], [0.0, 0.027], [-0.004, 0.022]], 0.022, 0.0018),
    at(cylZ(0.0075, 0.0075, 0.014, 14), 0, 0.013, -0.14),
  ];
  pistolSights(slideGeos, 0.006, 0.128, 0.027, 0.016);
  if (hi()) serrations(slideGeos, 8, 0, 0.013, -0.01, 0.0032, 0.0232, 0.016, 0.001);
  const slide = part('slide', slideGeos, M.bolt, [0, 0, 0]);
  slide.add(sub(part('port', [at(box(0.001, 0.01, 0.024), 0.0115, 0.017, -0.08)], M.bore, [0, 0, 0])));
  slide.add(sub(part('bore', [at(cylZ(0.0045, 0.0045, 0.002, 12), 0, 0.013, -0.1465)], M.bore, [0, 0, 0])));
  g.add(slide);
  // the round Tokarev hammer with its serrated spur
  const hammerGeos = [at(cylX(0.0075, 0.0075, 0.007, 12), 0, 0.016, 0.008), side([[-0.002, 0.006], [-0.006, 0.02], [-0.018, 0.024], [-0.019, 0.02], [-0.008, 0.012], [-0.004, 0.006]], 0.007, 0.0006)];
  if (hi()) serrations(hammerGeos, 4, 0, 0.0245, 0.008, 0.0025, 0.0075, 0.002, 0.0008);
  g.add(part('hammer', hammerGeos, M.gunmetal, [0, 0.014, 0.004]));
  g.add(part('trigger', [side([[0.056, -0.021], [0.063, -0.021], ['q', 0.066, -0.032, 0.062, -0.042], [0.056, -0.04]], 0.006, 0.0008)], M.gunmetal, [0.0, -0.021, -0.059]));
  const mag = node('mag', 0, -0.024, -0.016); mag.rotation.x = -14 * DEG; mag.userData.base.r.copy(mag.rotation); g.add(mag);
  g.add(marker('muzzle', 0, 0.013, -0.149)); g.add(marker('eject', 0.014, 0.024, -0.08)); g.add(marker('mount_muzzle', 0, 0.013, -0.146));
  g.userData = pistolUD(id, 0.0325, -0.30, [0.0, -0.064, 0.0], null, 0.032, { sightLine: { rear: [0, 0.0325, -0.006], front: [0, 0.0325, -0.128] }, defaultMag: 'mag_tt8' });
  return g;
}
function buildGlock(M, id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  // polymer frame: squared dust cover with the accessory rail, finger grooves, flared grip
  P.add(M.polymer, side([[-0.004, -0.002], [0.13, -0.002], [0.13, -0.016], [0.078, -0.018], [0.05, -0.02], [0.042, -0.03], [0.02, -0.108], ['q', 0.006, -0.116, -0.012, -0.112], [-0.03, -0.108], ['q', -0.038, -0.06, -0.024, -0.024], [-0.016, -0.004]], 0.026, 0.0015));
  P.add(M.polymer, rect(0.05, 0.13, -0.016, 0.0, 0.0285, 0.001));
  P.add(M.polymer, side([[0.04, -0.02], [0.076, -0.02], [0.076, -0.026], [0.04, -0.026], [0.04, -0.03], [0.08, -0.03], [0.08, -0.034], [0.04, -0.034]], 0.026, 0.0006));   // rail slots (two)
  P.add(M.polymer, side([[0.04, -0.02], [0.092, -0.036], [0.096, -0.035], [0.098, -0.03], [0.095, -0.022], [0.094, -0.006], [0.04, -0.006], [0.038, -0.06]], 0.028, 0.0015)); // trigger guard with the hook
  if (hi()) for (let i = 0; i < 3; i++) P.add(M.polymer, at(box(0.029, 0.005, 0.008), 0, -0.05 - i * 0.02, 0.006 - i * 0.004));   // finger grooves
  P.add(M.polymerGrip, side([[0.026, -0.03], [0.014, -0.104], [-0.022, -0.1], ['q', -0.032, -0.06, -0.018, -0.03]], 0.029, 0.0018));   // textured grip panels
  P.add(M.gunmetal, at(box(0.0025, 0.004, 0.022), -0.0145, 0.002, -0.06));                                  // slide stop
  P.add(M.gunmetal, at(box(0.003, 0.003, 0.012), 0.0145, -0.004, -0.09)); P.add(M.gunmetal, at(box(0.003, 0.003, 0.012), -0.0145, -0.004, -0.09));   // takedown tabs
  P.add(M.gunmetal, at(box(0.004, 0.006, 0.006), -0.015, -0.028, -0.038));                                  // mag release
  if (hi()) { P.add(M.steel, pin(0, -0.006, -0.036, 0.002, 0.028)); P.add(M.steel, pin(0, -0.012, 0.002, 0.002, 0.028)); }
  P.into(g);
  const slideGeos = [
    side([[-0.006, 0.0], [0.182, 0.0], [0.186, 0.004], [0.186, 0.024], [0.184, 0.028], [0.0, 0.028], [-0.006, 0.022]], 0.0255, 0.0016),
    at(box(0.006, 0.003, 0.028), 0.0105, 0.02, -0.15),                                                     // extractor
  ];
  pistolSights(slideGeos, 0.008, 0.168, 0.028, 0.018);
  if (hi()) serrations(slideGeos, 6, 0, 0.014, -0.012, 0.005, 0.0267, 0.02, 0.0016);
  const slide = part('slide', slideGeos, M.painted, [0, 0, 0]);
  slide.add(sub(part('port', [at(box(0.001, 0.012, 0.03), 0.0128, 0.02, -0.11)], M.bore, [0, 0, 0])));
  slide.add(sub(part('barrelend', [at(cylZ(0.0075, 0.0075, 0.004, 14), 0, 0.014, -0.186), at(cylZ(0.0045, 0.0045, 0.002, 12), 0, 0.014, -0.1875)], M.bolt, [0, 0, 0])));
  g.add(slide);
  g.add(part('trigger', [side([[0.056, -0.023], [0.064, -0.023], ['q', 0.068, -0.036, 0.064, -0.048], [0.056, -0.046]], 0.007, 0.0008), at(box(0.0025, 0.014, 0.003), 0, -0.038, -0.0625)], M.polymer, [0.0, -0.023, -0.06]));
  const mag = node('mag', 0, -0.026, -0.016); mag.rotation.x = -17 * DEG; mag.userData.base.r.copy(mag.rotation); g.add(mag);
  g.add(marker('muzzle', 0, 0.014, -0.19)); g.add(marker('eject', 0.015, 0.024, -0.11)); g.add(marker('mount_muzzle', 0, 0.014, -0.186));
  g.add(marker('mount_under', 0, -0.036, -0.075)); g.add(marker('mount_top', 0, 0.028, -0.03));
  g.userData = pistolUD(id, 0.0335, -0.30, [0.0, -0.066, -0.002], null, 0.036, { sightLine: { rear: [0, 0.0335, -0.008], front: [0, 0.0335, -0.168] }, defaultMag: 'mag_glock17', magTravel: [0, -0.17, 0.02] });
  return g;
}
function buildM9(M, id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  P.add(M.frame, side([[-0.004, -0.002], [0.14, -0.002], [0.14, -0.014], [0.086, -0.016], [0.06, -0.018], [0.05, -0.028], [0.024, -0.104], [-0.024, -0.112], ['q', -0.036, -0.06, -0.022, -0.022], [-0.012, -0.004]], 0.026, 0.0015));
  P.add(M.frame, rect(0.058, 0.14, -0.014, 0.0, 0.028, 0.001));
  P.add(M.frame, side([[0.05, -0.02], [0.098, -0.02], [0.106, -0.03], [0.104, -0.044], ['q', 0.1, -0.05, 0.094, -0.048], [0.056, -0.05], [0.05, -0.044], [0.05, -0.024]], 0.008, 0.0008)); // rounded trigger guard with front hook
  P.add(M.gunmetal, at(box(0.0025, 0.005, 0.024), -0.0145, 0.004, -0.058));
  P.add(M.gunmetal, at(ringX(0.0045, 0.001, 0, Math.PI * 2, 10, 5), 0, -0.114, 0.02));
  P.add(M.gunmetal, at(box(0.004, 0.006, 0.006), -0.015, -0.03, -0.036));
  if (hi()) { P.add(M.steel, pin(0, -0.008, -0.04, 0.0025, 0.028)); P.add(M.gunmetal, at(box(0.006, 0.01, 0.014), 0.0145, -0.008, -0.1)); }   // disassembly latch, right
  for (const sx of [-1, 1]) { P.add(M.polymerGrip, at(side([[0.036, -0.03], [0.018, -0.1], [-0.02, -0.106], ['q', -0.032, -0.06, -0.018, -0.03]], 0.004, 0.0015), sx * 0.0145, 0, 0)); if (hi()) P.addAll(M.gunmetal, screw(sx * 0.0168, -0.066, 0.003, 0.0028, 'x')); }
  P.into(g);
  // open-top slide: rails on both sides, bridged at the rear and front; the barrel shows in the cut-out
  const slideGeos = [
    side([[-0.006, 0.0], [0.05, 0.0], [0.05, 0.03], [0.0, 0.03], [-0.006, 0.024]], 0.026, 0.0016),
    side([[0.148, 0.0], [0.182, 0.0], [0.186, 0.005], [0.186, 0.022], [0.18, 0.028], [0.148, 0.028]], 0.026, 0.0016),
    at(side([[0.05, 0.0], [0.148, 0.0], [0.148, 0.02], [0.05, 0.02]], 0.007, 0.0012), 0.0095, 0, 0),
    at(side([[0.05, 0.0], [0.148, 0.0], [0.148, 0.02], [0.05, 0.02]], 0.007, 0.0012), -0.0095, 0, 0),
  ];
  pistolSights(slideGeos, 0.01, 0.172, 0.03, 0.018);
  if (hi()) serrations(slideGeos, 5, 0, 0.016, -0.014, 0.005, 0.0272, 0.02, 0.0016);
  const slide = part('slide', slideGeos, M.bolt, [0, 0, 0]);
  slide.add(sub(part('safety', [at(box(0.003, 0.008, 0.016), -0.0145, 0.026, -0.016), at(box(0.003, 0.008, 0.016), 0.0145, 0.026, -0.016)], M.gunmetal, [0, 0, 0])));   // ambidextrous decocker
  g.add(slide);
  P.add(M.barrel, at(cylZ(0.0085, 0.008, 0.125, 14), 0, 0.016, -0.1225));                                    // exposed barrel
  P.add(M.gunmetal, at(box(0.016, 0.014, 0.024), 0, 0.01, -0.095));                                          // locking block
  P.add(M.bore, at(cylZ(0.0045, 0.0045, 0.002, 12), 0, 0.016, -0.1845));
  P.into(g);
  g.add(part('hammer', [at(cylX(0.006, 0.006, 0.007, 12), 0, 0.02, 0.006), side([[-0.002, 0.008], [-0.004, 0.02], [-0.016, 0.026], [-0.018, 0.021], [-0.008, 0.012], [-0.004, 0.008]], 0.007, 0.0006)], M.gunmetal, [0, 0.016, 0.004]));
  g.add(part('trigger', [side([[0.062, -0.023], [0.07, -0.023], ['q', 0.074, -0.036, 0.07, -0.048], [0.062, -0.046]], 0.007, 0.0008)], M.gunmetal, [0.0, -0.023, -0.066]));
  const mag = node('mag', 0, -0.03, -0.014); mag.rotation.x = -16 * DEG; mag.userData.base.r.copy(mag.rotation); g.add(mag);
  g.add(marker('muzzle', 0, 0.016, -0.19)); g.add(marker('eject', 0.015, 0.024, -0.1)); g.add(marker('mount_muzzle', 0, 0.016, -0.186));
  g.add(marker('mount_under', 0, -0.014, -0.11)); g.add(marker('mount_top', 0, 0.03, -0.028));
  g.userData = pistolUD(id, 0.0355, -0.30, [0.0, -0.068, -0.002], null, 0.036, { sightLine: { rear: [0, 0.0355, -0.01], front: [0, 0.0355, -0.172] }, defaultMag: 'mag_m9_15', magTravel: [0, -0.17, 0.02] });
  return g;
}
function build1911(M, id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  P.add(M.frame, side([[-0.004, -0.002], [0.134, -0.002], [0.134, -0.014], [0.074, -0.016], [0.05, -0.018], [0.042, -0.028], [0.022, -0.104], [-0.022, -0.11], ['q', -0.036, -0.06, -0.026, -0.028], [-0.03, -0.012], [-0.012, -0.004]], 0.024, 0.0015));
  P.add(M.frame, rect(0.052, 0.134, -0.014, 0.0, 0.026, 0.001));
  P.add(M.frame, side([[0.042, -0.02], [0.084, -0.02], ['q', 0.098, -0.02, 0.098, -0.034], ['q', 0.098, -0.048, 0.084, -0.048], [0.05, -0.048], [0.042, -0.04]], 0.008, 0.0008));
  P.add(M.frame, side([[0.042, -0.02], [0.084, -0.02], ['q', 0.094, -0.02, 0.094, -0.034], ['q', 0.094, -0.044, 0.084, -0.044], [0.05, -0.044], [0.046, -0.04]], 0.0, 0.0));   // guard inner edge (thin)
  // beavertail grip safety, arched checkered mainspring housing, thumb safety, slide stop
  P.add(M.gunmetal, side([[-0.012, -0.004], [-0.03, -0.012], ['q', -0.04, -0.03, -0.034, -0.05], [-0.024, -0.03]], 0.014, 0.001));
  P.add(M.polymerGrip, side([[-0.018, -0.05], ['q', -0.032, -0.08, -0.024, -0.108], [-0.014, -0.108], [-0.006, -0.05]], 0.02, 0.001));
  P.add(M.gunmetal, at(side([[-0.014, 0.0], [0.004, 0.0], [0.006, 0.006], [-0.014, 0.008]], 0.003, 0.0005), -0.0135, 0.008, 0));
  P.add(M.gunmetal, at(box(0.0025, 0.005, 0.03), -0.0135, 0.004, -0.058));
  P.add(M.gunmetal, at(box(0.004, 0.006, 0.006), -0.014, -0.03, -0.04));                                    // mag release
  if (hi()) { P.add(M.steel, pin(0, -0.006, -0.03, 0.0025, 0.026)); P.add(M.steel, pin(0, -0.026, 0.008, 0.0025, 0.026)); }
  for (const sx of [-1, 1]) { P.add(M.woodChecker, at(side([[0.032, -0.03], [0.016, -0.1], [-0.02, -0.104], ['q', -0.03, -0.06, -0.018, -0.03]], 0.0045, 0.0015), sx * 0.0135, 0, 0)); if (hi()) { P.addAll(M.gunmetal, screw(sx * 0.016, -0.036, -0.002, 0.0028, 'x')); P.addAll(M.gunmetal, screw(sx * 0.016, -0.096, 0.01, 0.0028, 'x')); } }
  P.into(g);
  const slideGeos = [
    side([[-0.006, 0.0], [0.194, 0.0], [0.198, 0.006], [0.198, 0.022], [0.19, 0.03], [0.0, 0.03], [-0.006, 0.024]], 0.024, 0.0018),
    at(cylZ(0.0085, 0.0085, 0.01, 14), 0, 0.015, -0.198),                                                 // barrel bushing
  ];
  pistolSights(slideGeos, 0.008, 0.184, 0.03, 0.018);
  if (hi()) serrations(slideGeos, 7, 0, 0.015, -0.012, 0.0036, 0.0252, 0.018, 0.001);
  const slide = part('slide', slideGeos, M.bolt, [0, 0, 0]);
  slide.add(sub(part('port', [at(box(0.001, 0.012, 0.028), 0.0125, 0.02, -0.1)], M.bore, [0, 0, 0])));
  slide.add(sub(part('bore', [at(cylZ(0.0058, 0.0058, 0.002, 12), 0, 0.015, -0.2035)], M.bore, [0, 0, 0])));
  g.add(slide);
  g.add(part('hammer', [side([[-0.002, -0.001], [-0.006, 0.014], [-0.022, 0.024], [-0.026, 0.02], [-0.014, 0.008], [-0.008, -0.001]], 0.008, 0.0008)], M.gunmetal, [-0.003, 0, 0]));
  g.add(part('trigger', [at(box(0.012, 0.012, 0.006), 0, -0.032, -0.062), at(box(0.006, 0.01, 0.003), 0, -0.032, -0.0665)], M.gunmetal, [0.0, -0.021, -0.062]));
  const mag = node('mag', 0, -0.03, -0.012); mag.rotation.x = -14 * DEG; mag.userData.base.r.copy(mag.rotation); g.add(mag);
  g.add(marker('muzzle', 0, 0.015, -0.206)); g.add(marker('eject', 0.014, 0.026, -0.1)); g.add(marker('mount_muzzle', 0, 0.015, -0.203));
  g.userData = pistolUD(id, 0.0355, -0.30, [0.0, -0.066, -0.002], null, 0.04, { sightLine: { rear: [0, 0.0355, -0.008], front: [0, 0.0355, -0.184] }, defaultMag: 'mag_1911_7' });
  return g;
}
