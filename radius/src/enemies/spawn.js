// Spawn — a dog-sized many-legged crawler, translucent black. Packs of three to six live in the buildings and
// the rail cutting, scuttling short dashes around their spot. When one sees you (or hears a shot) the pack
// comes in erratic arcs, fast, and bites. Shoot one and it skitters back three metres, then returns. They die
// curled up: the legs fold under, the body flips, and it crumbles to ash.
//
// v2: a pack has a nest, a hole with a lip of turned earth. Disturb it (a shot within twenty metres, one of the
// pack killed) and two more come out of it, up to three times before the Tide. They hate the torch: caught in
// the beam they scatter sideways out of it and come back in from the dark side, round to your back; the bites
// come from behind. Bites stack: the second within a few seconds opens a bleed.
//
// Build: one skinned mesh per spawn (thorax, a three-segment abdomen with a glowing membrane in each joint,
// a tiny head with two amber pinpoints, six two-segment legs on two-bone IK), a dark oily material (fresnel
// rim with a thin-film shift, chitin mottling) that shares one program across the pack. Gait: alternating
// tripods, exaggerated lift, jittered.
//
// This is the model the rest of the bestiary is measured against, so it is worth writing down WHY it works:
// every mass is a ring-stack ellipsoid rather than a box, so the same triangles buy a curve and a many-sided
// outline; the masses are chained with shrinking radii and a small drop between them, so the silhouette
// pinches and droops four times in 0.36 m; every leg has a coxa knot and a knee knot fatter than the
// segments they join, so the joints read; and the material's fresnel term brightens the albedo, adds
// emissive AND drops roughness at grazing angles, so the outline edge is brighter than the interior under
// any light. That last one was silently doing nothing: the whole block was injected at
// <lights_fragment_begin>, which in three's meshphysical shader runs AFTER <lights_physical_fragment> has
// already copied diffuseColor and roughnessFactor into `material`. Only the emissive term was landing. The
// albedo and roughness work now goes in at <color_fragment> and <roughnessmap_fragment> where it is read.
//
// Colour: DESIGN called it translucent black and the albedo was Color(0.018, 0.020, 0.026), which is black
// with two red pinpoints for company. The body now sits at a readable blue-black, the abdomen warms toward
// the tip, the legs are DARKER than the body so it appears to float, and three amber intersegmental
// membranes pulse with its breathing. Nothing else in the bestiary has bands: at forty metres in fog that
// is the whole identification.
// When the characters module lands a real crawler (buildCrawler without the stub flag) that rig is used.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './common.js';
import { buildCrawler } from './charmesh.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { hash3 } from '../core/rng.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _cam = new THREE.Vector3();
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

// Bind a geometry 1:1 to a bone and mark what it is. aPart = (tone, band): tone -1 legs, 0 thorax and head,
// 1..3 the abdomen segments (which warm toward the tip); band 0 or the intersegmental membrane index. aGlow
// stays the eye channel. One attribute pair is what lets the whole creature keep to one draw call while
// carrying five different materials.
function bind(g, bone, glow = 0, tone = 0, band = 0) {
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), gl = new Float32Array(n), pt = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; gl[i] = glow; pt[i * 2] = tone; pt[i * 2 + 1] = band; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  g.setAttribute('aPart', new THREE.BufferAttribute(pt, 2));
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
  // A dorsal keel: the top centre strip is lifted into a low crest. Costs no triangles and it is the whole
  // from-above read — this thing is 0.40 m tall and mostly seen looking down at it, where a smooth ellipsoid
  // is a pebble. With the crest the back has a spine, a highlight line and a direction.
  if (o.keel) {
    const pos = g.attributes.position, n = pos.count;
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i), py = pos.getY(i);
      const uy = py / ry, ux = Math.abs(px) / rx;
      if (uy > 0.42 && ux < 0.5) pos.setY(i, py + o.keel * ((uy - 0.42) / 0.58) * (1 - ux / 0.5));
    }
  }
  jitterVerts(g, o.jitter ?? 0.006);
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _m.makeRotationFromEuler(_e); _m.setPosition(x, y, z);
  g.applyMatrix4(_m); g.computeVertexNormals();
  return bind(g, bi(bone), o.glow || 0, o.tone || 0, o.band || 0);
}
// a tapered box (limb segments, mandibles)
function box(w, h, d, x, y, z, bone, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const pos = g.attributes.position, n = pos.count;
  for (let i = 0; i < n; i++) { const py = pos.getY(i); const s = lerp(o.bottom ?? 1, o.top ?? 1, (py + h / 2) / h); pos.setXYZ(i, pos.getX(i) * s, py, pos.getZ(i) * s); }
  jitterVerts(g, o.jitter ?? 0.004);
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _m.makeRotationFromEuler(_e); _m.setPosition(x, y, z);
  g.applyMatrix4(_m); g.computeVertexNormals();
  return bind(g, bi(bone), 0, o.tone || 0, 0);
}
let sharedGeo = null;
function buildGeometry() {
  if (sharedGeo) return sharedGeo;
  const parts = [
    blob(0.10, 0.075, 0.135, 0, BODY_Y, -0.04, 'body', { jitter: 0.008, keel: 0.024 }),           // thorax
    blob(0.115, 0.088, 0.14, 0, BODY_Y, 0.16, 'abdomen', { jitter: 0.009, keel: 0.027, tone: 1 }),  // abdomen, three segments
    blob(0.095, 0.074, 0.11, 0, BODY_Y - 0.006, 0.275, 'abdomen', { jitter: 0.008, keel: 0.021, tone: 2 }),
    blob(0.066, 0.05, 0.078, 0, BODY_Y - 0.016, 0.36, 'abdomen', { jitter: 0.007, keel: 0.014, tone: 3 }),
    blob(0.048, 0.04, 0.056, 0, BODY_Y - 0.015, -0.19, 'head', { jitter: 0.005 }),               // head
    blob(0.011, 0.011, 0.011, -0.023, BODY_Y - 0.002, -0.226, 'head', { seg: 8, ring: 6, jitter: 0, glow: 1 }),
    blob(0.011, 0.011, 0.011, 0.023, BODY_Y - 0.002, -0.226, 'head', { seg: 8, ring: 6, jitter: 0, glow: 1 }),
    box(0.012, 0.012, 0.058, -0.018, BODY_Y - 0.035, -0.238, 'head', { ry: 0.4, rx: 0.3, jitter: 0.002 }),   // mandibles
    box(0.012, 0.012, 0.058, 0.018, BODY_Y - 0.035, -0.238, 'head', { ry: -0.4, rx: 0.3, jitter: 0.002 }),
    // Intersegmental membranes. Real arthropods have soft arthrodial membrane in every joint of the abdomen;
    // in this one it is the only place the light inside gets out. Each is a thin disc a centimetre wider than
    // the pinch it sits in, so all that shows is a glowing rim, and the three of them pulse with the breath.
    // Three amber bands on a low dark shape is the forty-metre identification and nothing else has it.
    blob(0.099, 0.077, 0.013, 0, BODY_Y + 0.002, 0.078, 'abdomen', { seg: 10, ring: 4, jitter: 0.002, band: 1 }),
    blob(0.105, 0.082, 0.011, 0, BODY_Y - 0.002, 0.223, 'abdomen', { seg: 10, ring: 4, jitter: 0.002, band: 2 }),
    blob(0.092, 0.070, 0.009, 0, BODY_Y - 0.011, 0.325, 'abdomen', { seg: 10, ring: 4, jitter: 0.002, band: 3 }),
    // two cerci off the tip, so the abdomen ends in a fork instead of a full stop
    box(0.010, 0.010, 0.062, -0.019, BODY_Y - 0.006, 0.416, 'abdomen', { rx: -0.55, ry: 0.30, bottom: 0.3, jitter: 0.002, tone: 3 }),
    box(0.010, 0.010, 0.062, 0.019, BODY_Y - 0.006, 0.416, 'abdomen', { rx: -0.55, ry: -0.30, bottom: 0.3, jitter: 0.002, tone: 3 }),
  ];
  for (const L of LEGS) {
    const hx = L.hip[0], hy = BODY_Y + L.hip[1], hz = L.hip[2];
    parts.push(blob(0.024, 0.02, 0.024, hx, hy, hz, L.c, { seg: 8, ring: 6, jitter: 0.003, tone: -1 }));                // coxa knot
    parts.push(box(0.03, L1, 0.03, hx, hy - L1 / 2, hz, L.c, { bottom: 0.78, jitter: 0.004, tone: -1 }));               // femur
    parts.push(blob(0.02, 0.016, 0.02, hx, hy - L1, hz, L.t, { seg: 8, ring: 6, jitter: 0.003, tone: -1 }));            // knee
    parts.push(box(0.021, L2, 0.017, hx, hy - L1 - L2 / 2, hz, L.t, { bottom: 0.42, jitter: 0.003, tone: -1 }));        // tibia to a point
  }
  sharedGeo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  sharedGeo.userData.shared = true;
  return sharedGeo;
}

// ---- material: dark translucent chitin. Fresnel rim with an oily thin-film shift, mottling, amber eyes ----
// The fresnel term is the whole reason this creature reads at near-black albedo: at grazing angles it
// brightens the albedo, adds emissive AND drops roughness, so the silhouette edge always carries more value
// than the interior whatever the light is doing. It used to be injected entirely at <lights_fragment_begin>,
// which runs after <lights_physical_fragment> has already taken its copies of diffuseColor and
// roughnessFactor — so two thirds of it was dead code. The albedo work is now at <color_fragment> and the
// roughness at <roughnessmap_fragment>, where they are actually read.
function chitinCompile(shader) {
  const u = this.userData.u;
  for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
  for (const k in u) shader.uniforms[k] = u[k];
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aGlow; attribute vec2 aPart; varying float vGlow; varying vec2 vPart; varying vec3 vObjPos;')
    .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n vGlow = aGlow; vPart = aPart; vObjPos = transformed;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nuniform float uTime, uSeed, uFlinch, uBreath, uTone;
      uniform vec3 uBody, uAbd, uLeg, uBand;
      varying float vGlow; varying vec2 vPart; varying vec3 vObjPos;`)
    // fresnel and the thin-film palette, computed once and used by everything below
    .replace('#include <clipping_planes_fragment>', /* glsl */`#include <clipping_planes_fragment>
      float fr = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.6);
      float mot = fbm3d(vObjPos * 26.0 + uSeed);
      vec3 oil = 0.5 + 0.5 * cos(6.2831 * (fr * 1.4 + mot * 0.6 + vec3(0.0, 0.33, 0.67)) + uSeed);
      float band = vPart.y;`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      {
        // the palette lives in the vertex attribute, so one draw call carries four materials: a blue-black
        // thorax, an abdomen that warms toward the tip, legs DARKER than the body so the mass appears to
        // float clear of the ground, and the soft membrane in each abdominal joint
        vec3 base = vPart.x < -0.5 ? uLeg : mix(uBody, uAbd, clamp(vPart.x / 3.0, 0.0, 1.0));
        base = mix(base, base * vec3(1.10, 1.0, 0.92), uTone);
        if (band > 0.5) base = uBand * 0.35;
        diffuseColor.rgb = base * (0.75 + 0.5 * mot);
        diffuseColor.rgb += (vec3(0.06, 0.08, 0.075) + oil * 0.05) * fr;
      }`)
    .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor - 0.28 * fr - 0.12 * mot + (band > 0.5 ? 0.45 : 0.0), 0.12, 1.0);`)
    .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        totalEmissiveRadiance += (vec3(0.03, 0.045, 0.04) + oil * 0.03) * fr * (0.8 + 1.5 * uFlinch);
        // the three bands breathe out of step with each other, and with every other spawn in the pack
        float bp = uBreath + band * 1.9 + uSeed;
        // held so the peak just kisses the bloom threshold (0.88) and the trough is still clearly lit: at
        // forty metres in fog this is the only thing you can see of the creature, and it is the whole ID
        totalEmissiveRadiance += uBand * (band > 0.5 ? 1.0 : 0.0) * (2.3 + 1.8 * sin(bp)) * (1.0 + uFlinch * 1.4);
        float slot = floor(uTime * 3.0 + uSeed);
        float flick = 0.78 + 0.22 * step(0.35, hash11(slot)) * (0.5 + 0.5 * sin(uTime * 11.0 + uSeed));
        totalEmissiveRadiance += vec3(1.40, 0.50, 0.12) * vGlow * flick;
      }`);
}
function makeChitin(tone = 0) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.12 });
  mat.userData.u = {
    uTime: { value: 0 }, uSeed: { value: Math.random() * 60 }, uFlinch: { value: 0 }, uBreath: { value: 0 },
    uTone: { value: tone },
    uBody: { value: new THREE.Color(0x14161c) },   // blue-black, readable, still the darkest body in the zone
    uAbd: { value: new THREE.Color(0x1c1712) },    // the tip warms toward the membranes
    uLeg: { value: new THREE.Color(0x0e1014) },    // darker than the body: the legs vanish, the body floats
    uBand: { value: new THREE.Color(0x7a3a10) },
  };
  mat.onBeforeCompile = chitinCompile;
  mat.customProgramCacheKey = () => 'radius-chitin';
  return mat;
}

// Dev hook for the smoke harness, matching enemies/slider.js: the mesh and its material in isolation.
if (typeof globalThis !== 'undefined') {
  globalThis.__beasts = Object.assign(globalThis.__beasts || {}, {
    spawnGeometry: buildGeometry, spawnMaterial: makeChitin, spawnBones: BONES, spawnLegs: LEGS,
  });
}

// ---- the nest: a hole with a lip of turned earth and a few shed carapaces. One low mesh, two materials. ----
let earthMat = null, holeMat = null;
function nestMesh(ctx, pos) {
  if (!earthMat) {
    earthMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.13, 0.10), roughness: 1, metalness: 0, vertexColors: true });
    holeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.012, 0.012, 0.014), roughness: 0.9, metalness: 0 });
  }
  const g = new THREE.Group();
  // the lip: a ring of lumps, irregular in height and radius
  const lip = new THREE.TorusGeometry(0.55, 0.16, 6, 18);
  lip.rotateX(Math.PI / 2);
  const pos3 = lip.attributes.position, n = pos3.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos3.getX(i), y = pos3.getY(i), z = pos3.getZ(i);
    const a = Math.atan2(z, x); const k = 0.75 + 0.5 * hash3(Math.round(a * 4) + 9, 3, 7);
    pos3.setXYZ(i, x * k, Math.max(-0.02, y * (0.6 + 0.6 * hash3(i, 5, 2))) + 0.02, z * k);
    const sh = 0.7 + 0.6 * hash3(i, 11, 3); col[i * 3] = sh; col[i * 3 + 1] = sh * 0.95; col[i * 3 + 2] = sh * 0.9;
  }
  lip.setAttribute('color', new THREE.BufferAttribute(col, 3)); lip.computeVertexNormals();
  const lipM = new THREE.Mesh(lip, earthMat); lipM.receiveShadow = true; g.add(lipM);
  // the hole: a dark disc sunk a little, and three shed shells around it
  const hole = new THREE.CircleGeometry(0.42, 14); hole.rotateX(-Math.PI / 2);
  const holeM = new THREE.Mesh(hole, holeMat); holeM.position.y = 0.01; g.add(holeM);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.SphereGeometry(0.09, 7, 5, 0, TAU, 0, Math.PI * 0.5); s.scale(1, 0.55, 1.3); jitterVerts(s, 0.01);
    const m = new THREE.Mesh(s, holeMat); const a = i * 2.2 + 0.4; m.position.set(Math.cos(a) * 0.75, 0.03, Math.sin(a) * 0.75); m.rotation.y = a; m.castShadow = true; g.add(m);
  }
  g.position.copy(pos); g.position.y += 0.005;
  ctx.scene.add(g);
  return g;
}
const nests = new Map();          // key: the shared pack/nest Vector3 (identity) -> nest
const MAX_EMITS = 3, NEST_CAP = 8;
function nestFor(ctx, key, poi) {
  let n = nests.get(key);
  if (n) return n;
  const y = ctx.world.groundHeight(key.x, key.z, ctx.world.getHeight(key.x, key.z) + 2.5).y;
  n = { key, position: new THREE.Vector3(key.x, y, key.z), poi, emitted: 0, cool: 0, pending: false, mesh: null };
  n.mesh = nestMesh(ctx, n.position);
  nests.set(key, n);
  return n;
}
function clearNests() {
  for (const n of nests.values()) { if (n.mesh) { n.mesh.parent?.remove(n.mesh); n.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } }
  nests.clear();
}
// would a thing here be in the player's view?
function seenByPlayer(ctx, x, y, z) {
  ctx.camera.getWorldDirection(_cam);
  _v.set(x, y + 0.3, z).sub(ctx.player.eye);
  const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
  if (_cam.dot(_v) < Math.cos(62 * DEG)) return false;
  return ctx.world.lineOfSight(ctx.player.eye, _v2.set(x, y + 0.3, z));
}
function nestAlive(ctx, nest) { let n = 0; for (const e of ctx.enemies.list) if (e.type === 'spawn' && e.alive && e.nest === nest) n++; return n; }
// two more come out of the hole, out of the player's sight
function tryEmit(ctx, nest) {
  if (!nest.pending || nest.cool > 0 || nest.emitted >= MAX_EMITS) return false;
  if (ctx.player.dead || ctx.mode !== 'playing') return false;
  if (nestAlive(ctx, nest) >= NEST_CAP) return false;
  const w = ctx.world; let placed = 0;
  for (let i = 0; i < 16 && placed < 2; i++) {
    const a = rng.range(0, TAU), rr = i < 8 ? rng.range(0.7, 2.2) : rng.range(2.2, 6);
    const x = nest.position.x + Math.cos(a) * rr, z = nest.position.z + Math.sin(a) * rr;
    if (Math.abs(x) > w.half - 6 || Math.abs(z) > w.half - 6 || w.isWater(x, z)) continue;
    const y = w.groundHeight(x, z, nest.position.y + 1.5).y;
    if (Math.abs(y - nest.position.y) > 1.5 || w.pointInSolid(x, y + 0.3, z)) continue;
    if (seenByPlayer(ctx, x, y, z)) continue;
    const e = ctx.enemies.spawn('spawn', _v3.set(x, y, z), { nest: nest.key, pack: nest.key, poi: nest.poi, yaw: Math.atan2(-(ctx.player.position.x - x), -(ctx.player.position.z - z)), fromNest: true });
    if (!e) break;
    e.aware = 1; if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3(); e.lastSeenPlayer.copy(ctx.player.position); e.lastSeenT = ctx.elapsed;
    e.setState('swarm'); e.headT = 0; e.biteCool = rng.range(0.6, 1.4);
    placed++;
  }
  if (!placed) return false;
  nest.emitted++; nest.cool = 5; nest.pending = false;
  // the hole breathes out: dust and a chorus of skittering
  ctx.vfx.dustPuff(_v.set(nest.position.x, nest.position.y + 0.1, nest.position.z), THREE.Object3D.DEFAULT_UP, 12, [0.14, 0.12, 0.1], 0.5);
  ctx.audio.play('spawn_skitter', { pos: nest.position, hrtf: true, gain: 0.9, max: 45, ref: 2, rate: 0.8 });
  ctx.audio.play('spawn_skitter', { pos: nest.position, hrtf: true, gain: 0.7, max: 45, ref: 2, rate: 1.25 });
  return true;
}
function disturb(nest) { if (nest.emitted < MAX_EMITS) nest.pending = true; }
let nestFrame = -1;
function updateNests(ctx, dt) {
  if (ctx.frame === nestFrame) return; nestFrame = ctx.frame;
  for (const n of nests.values()) {
    n.cool = Math.max(0, n.cool - dt);
    if (!n.pending && n.emitted < MAX_EMITS && ctx.director && ctx.director.recentShotAt(n.position, 20) > 0.05) disturb(n);
    if (n.pending) tryEmit(ctx, n);
  }
}

// ---- the torch: how much of the light is on a point (the hand torch, the headlamp, the weapon light) ----
function beamAt(ctx, x, y, z) {
  const L = ctx.lighting; if (!L) return 0;
  const torch = ctx.state.data.flashlight && ctx.state.data.flashlight.on ? (L.flashLevel ?? 1) : 0;
  const lamp = L.headlampLevel || 0, wl = L.weaponLightLevel || 0;
  if (torch + lamp + wl < 0.2) return 0;
  ctx.camera.getWorldDirection(_cam);
  _v.set(x, y, z).sub(ctx.player.eye); const d = _v.length() || 1; const c = _v.dot(_cam) / d;
  let b = 0;
  if (torch > 0.2) b = Math.max(b, torch * clamp01((c - COS_T_OUT) / (COS_T_IN - COS_T_OUT)) * clamp01(1.3 - d / 26));
  if (lamp > 0.2) b = Math.max(b, lamp * clamp01((c - COS_H_OUT) / (COS_H_IN - COS_H_OUT)) * clamp01(1.3 - d / 18));
  if (wl > 0.2) b = Math.max(b, wl * clamp01((c - COS_W_OUT) / (COS_W_IN - COS_W_OUT)) * clamp01(1.3 - d / 28));
  return b;
}
const COS_T_OUT = Math.cos(23 * DEG), COS_T_IN = Math.cos(14 * DEG), COS_H_OUT = Math.cos(31 * DEG), COS_H_IN = Math.cos(20 * DEG), COS_W_OUT = Math.cos(16 * DEG), COS_W_IN = Math.cos(9 * DEG);

// bites within eight seconds of one another stack; the second opens a bleed
const bites = { n: 0, t: -1e9 };

let rng = null;
const SPEED = { dash: 2.6, swarm: 4.5 };

class Spawn extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'spawn', position, Object.assign({ hp: 25 }, opts));
    this.radius = 0.35; this.height = 0.4; this.speed = SPEED.swarm;
    this.pack = opts.pack || opts.packId || opts.nest || null;
    const nestKey = opts.nest || opts.pack || null;
    this.nest = nestKey && typeof nestKey === 'object' && 'x' in nestKey ? nestFor(ctx, nestKey, this.poi) : null;
    // ---- rig: the characters module's crawler when it is real, else the built-in skinned rig ----
    this.rig = null;
    let ext = null;
    try { ext = buildCrawler({ kind: 'spawn' }); } catch (e) { ext = null; }
    if (ext && ext.root && !ext.stub) { this.rig = ext; this.root.add(ext.root); }
    else if (ext && ext.dispose) ext.dispose();
    if (!this.rig) {
      const bones = this.bones = []; const B = this.B = {};
      const mk = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); B[name] = b; return b; };
      mk('body', null, 0, BODY_Y, 0);
      mk('abdomen', B.body, 0, -0.004, 0.09);
      mk('head', B.body, 0, -0.012, -0.15);
      for (const L of LEGS) mk(L.c, B.body, L.hip[0], L.hip[1], L.hip[2]);
      for (const L of LEGS) mk(L.t, B[L.c], 0, -L1, 0);
      // A pack of five clones reads as one object repeated. Each spawn gets its own size, its own warm/cold
      // tilt and its own band phase, so five of them in the grass are five animals — which is the whole
      // point of a creature that only ever appears in threes to sixes.
      const size = this.size = rng.range(0.84, 1.18);
      this.material = makeChitin(rng.range(-0.35, 1.0)); this.mu = this.material.userData.u;
      // and its own band colour, a little either side of the ember, so a pack is a scatter of amber
      // pinpricks at slightly different hues and rates rather than one animation played five times
      this.mu.uBand.value.offsetHSL(rng.range(-0.02, 0.03), rng.range(-0.10, 0.08), rng.range(-0.04, 0.05));
      const mesh = this.mesh = new THREE.SkinnedMesh(buildGeometry(), this.material);
      mesh.castShadow = true; mesh.receiveShadow = false;
      // the scale has to be on before bind(), or the bind matrix is captured at 1 and the skinning applies
      // it twice
      mesh.scale.setScalar(size);
      mesh.add(B.body); mesh.bind(new THREE.Skeleton(bones));
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0), 0.9 * size);
      this.radius *= size; this.height *= size;
      this.root.add(mesh);
    }
    // ---- animation ----
    this.phase = rng.range(0, TAU); this.gait = 0; this.moveSpeed = 0; this.flinch = 0; this.bite = 0; this.twitch = 0; this.twitchT = rng.range(1, 4);
    this.stance = rng.range(0.84, 1.16);      // how wide it stands: the last of the four per-animal dials
    this.legJit = new Float32Array(6); for (let i = 0; i < 6; i++) this.legJit[i] = rng.range(-0.3, 0.3);
    this.footPos = LEGS.map((L) => new THREE.Vector3(L.rest[0], 0, L.rest[2]));
    this.headYaw = 0; this.breath = rng.range(0, TAU); this.roll = 0;
    // ---- AI ----
    this.target = null; this.pauseT = rng.range(0.5, 3); this.headT = 0; this.heading = this.yaw; this.biteCool = 0; this.biteWind = 0; this.rear = 0; this.skitterT = rng.range(0, 0.4);
    this.los = false; this.losT = rng.range(0, 0.2); this.packC = new THREE.Vector3().copy(this.position); this.packN = 1; this.packT = rng.range(0, 0.5);
    this.beam = 0; this.beamT = rng.range(0, 0.1); this.scatterT = 0; this.aroundT = 0; this.stunLeft = 0; this.stunSeen = false;
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
  // a pack arriving together must not all bite in the same instant
  onStateChange(s) { if (s === 'swarm') { this.biteCool = Math.max(this.biteCool, rng.range(0.15, 0.7)); this.biteWind = 0; } }
  onSpotted() {
    if (this.state !== 'retreat' && this.state !== 'stunned') this.setState('swarm');
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
    this.flinch = 1; if (this.mu) this.mu.uFlinch.value = 1;
    if (!this.alive || this.stunLeft > 0) return;
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
    if (this.nest) { disturb(this.nest); tryEmit(this.ctx, this.nest); }
    if (this.rig) this.rig.setState?.({ dead: true, speed: 0 });
  }
  deathTick(dt) {
    const t = this.deathT;
    if (this.rig) { this.rig.update?.(dt); if (t >= 0.8 && !this.ashDone) { this.ashDone = true; this.rig.root.visible = false; this.crumble(); } return; }
    // curl: the legs fold under, the body hops and flips onto its back, then it crumbles
    const f = clamp01(t / 0.5), fe = 1 - Math.pow(1 - f, 2.5);
    for (let i = 0; i < 6; i++) { const L = LEGS[i]; _foot.set(L.side * lerp(0.3, 0.07, fe), lerp(0, 0.11, fe), L.fwd * lerp(0.25, 0.05, fe) + 0.02); this.footPos[i].lerp(_foot, Math.min(1, dt * 14)); }
    const hop = Math.sin(Math.min(1, t / 0.45) * Math.PI) * 0.12;
    this.pose(dt, 0.35 * fe, Math.PI * fe, BODY_Y - 0.11 * fe + hop, 0);
    // the bands go out as it curls up: the breath stops, so the light in the joints stops with it
    this.breath += dt * 2.4 * (1 - f);
    this.mu.uTime.value = this.time; this.mu.uBreath.value = this.breath;
    this.mu.uBand.value.multiplyScalar(Math.max(0, 1 - dt * 2.2));
    this.mu.uFlinch.value = clamp01(1 - t);
    if (t >= 0.8 && !this.ashDone) { this.ashDone = true; this.mesh.visible = false; this.crumble(); }
  }
  crumble() {
    // a low crumble: dark motes that fall and a small puff, not the mimic's rising plume
    const vfx = this.ctx.vfx, now = this.ctx.elapsed, px = this.position.x, py = this.position.y, pz = this.position.z;
    for (let i = 0; i < 18; i++) {
      const a = rng.range(0, TAU), rr = rng.range(0, 0.28), sh = rng.range(0.04, 0.09);
      vfx.dust.emit(px + Math.cos(a) * rr, py + rng.range(0.05, 0.28), pz + Math.sin(a) * rr, Math.cos(a) * rng.range(0.1, 0.35), rng.range(0.1, 0.45), Math.sin(a) * rng.range(0.1, 0.35), sh, sh, sh * 1.15, rng.range(1.0, 2.0), rng.range(0.1, 0.24), 0.5, 1, now);
    }
    vfx.dustPuff(_v.set(px, py + 0.1, pz), THREE.Object3D.DEFAULT_UP, 5, [0.1, 0.1, 0.11], 0.3);
  }
  onDispose() { if (this.rig) this.rig.dispose?.(); else { this.mesh.skeleton.dispose(); this.material.dispose(); } }
  // flashbang: gear sets e.stunned (seconds or a flag); either convention works
  stunTick(dt) {
    const s = this.stunned;
    if (s) { if (!this.stunSeen) { this.stunSeen = true; this.stunLeft = Math.max(this.stunLeft, typeof s === 'number' ? s : 4); } }
    else this.stunSeen = false;
    if (this.stunLeft > 0) {
      this.stunLeft -= dt;
      if (this.state !== 'stunned') { this.setState('stunned'); this.target = null; this.biteWind = 0; }
      if (this.stunLeft <= 0) { this.stunLeft = 0; this.setState(this.engaged ? 'swarm' : 'return'); this.headT = 0; }
      return true;
    }
    return false;
  }
  // the bite: through the vest if the player wears one; the second within eight seconds opens a bleed
  biteNow() {
    const ctx = this.ctx, now = this.time;
    bites.n = now - bites.t < 8 ? bites.n + 1 : 1; bites.t = now;
    if (ctx.damage && ctx.damage.other) ctx.damage.other(7, { kind: 'melee', source: this, bleed: false }); else this.hurtPlayer(7, 'melee');
    if (bites.n >= 2 && !ctx.player.dead && !ctx.debug.god) ctx.state.data.bleeding = true;
    this.sound('spawn_bite', { gain: 0.9, max: 30, ref: 1.5, rate: rng.range(0.9, 1.15) });
  }

  // ---- AI ----
  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time;
    this.followGround(dt, 40);
    const d = this.distanceToPlayer();
    const prevX = this.position.x, prevZ = this.position.z;
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.2; _v.set(this.position.x, this.position.y + 0.3, this.position.z); _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.65, p.position.z); this.los = d < 34 && ctx.world.lineOfSight(_v, _v2) && !(ctx.world.smokeBlocks && ctx.world.smokeBlocks(_v, _v2)); }
    const stunned = this.stunTick(dt);
    if (!stunned) this.perceive(dt, { visGain: 4, hearGain: 4, decay: 0.15 });
    if (this.nest) updateNests(ctx, dt);
    // pack centre, refreshed twice a second
    this.packT -= dt;
    if (this.packT <= 0) {
      this.packT = 0.5; let n = 0; _v3.set(0, 0, 0);
      for (const e of ctx.enemies.list) { if (e.type !== 'spawn' || !e.alive) continue; if (this.pack ? e.pack !== this.pack : e.position.distanceTo(this.position) > 8) continue; _v3.add(e.position); n++; }
      if (n > 0) { this.packC.copy(_v3).divideScalar(n); this.packN = n; }
    }
    // the light on it, sampled ten times a second
    this.beamT -= dt; if (this.beamT <= 0) { this.beamT = 0.1; this.beam = d < 30 ? beamAt(ctx, this.position.x, this.position.y + 0.2, this.position.z) : 0; }
    this.biteCool = Math.max(0, this.biteCool - dt);
    this.flinch = damp(this.flinch, 0, 6, dt);
    let headYaw = 0, speed = 0;
    const hd = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
    // where it stands relative to your face: > 0.35 is in front of you
    const facing = hd > 0.05 ? ((this.position.x - p.position.x) * p.forward.x + (this.position.z - p.position.z) * p.forward.z) / hd : 1;

    switch (this.state) {
      case 'stunned': {
        // blind: it spins on the spot, legs going, biting at nothing
        this.yaw += dt * 5 * Math.sin(t * 2.3);
        headYaw = Math.sin(t * 11) * 0.8; this.twitch = 1;
        break;
      }
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
      case 'scatter': {
        // out of the beam, sideways, fast
        this.scatterT -= dt;
        _v.set(this.position.x + Math.sin(this.heading) * 2.5, this.position.y, this.position.z + Math.cos(this.heading) * 2.5);
        this.moveToward(_v, SPEED.swarm, dt, { stop: 0.1, turnRate: 18, allowWater: true });
        speed = SPEED.swarm;
        if (this.scatterT <= 0 || (this.beam < 0.15 && this.stateT > 0.25)) { this.setState('swarm'); this.headT = 0; this.biteCool = Math.max(this.biteCool, 0.3); }
        break;
      }
      case 'swarm': {
        if (!this.engaged || p.dead || p.inBase) { this.setState('return'); break; }
        headYaw = angleDelta(this.yaw, Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z)));
        // caught in the light: break sideways out of it
        if (this.beam > 0.35 && hd > 1.6 && this.biteWind <= 0) {
          ctx.camera.getWorldDirection(_cam);
          const cross = _cam.x * (this.position.z - p.position.z) - _cam.z * (this.position.x - p.position.x);   // which side of the beam axis it is on
          const side = cross >= 0 ? 1 : -1;
          const beamYaw = Math.atan2(_cam.x, _cam.z);
          this.heading = beamYaw + side * (Math.PI / 2 + rng.range(-0.3, 0.3));
          this.scatterT = rng.range(0.4, 0.7);
          this.setState('scatter');
          this.sound('spawn_skitter', { gain: 0.7, max: 35, ref: 1.5, rate: 1.6 });
          break;
        }
        if (this.biteWind > 0) {
          // the tell: it rears up on its hind legs for a beat, then snaps down
          this.faceToward(p.position.x, p.position.z, dt, 14);
          this.biteWind -= dt;
          if (this.biteWind <= 0) { this.bite = 1; if (hd < 1.7) this.biteNow(); }
        } else if (hd < 1.2 && (facing < 0.35 || this.aroundT > 2.5)) {
          // on you, from behind: face, wind up, bite
          this.faceToward(p.position.x, p.position.z, dt, 14);
          if (this.biteCool <= 0) { this.biteCool = rng.range(1.25, 1.8); this.biteWind = 0.22; this.sound('spawn_skitter', { gain: 0.5, max: 30, ref: 1.5, rate: 1.7 }); }
        } else {
          // a new heading every 0.4-0.8 s: toward your back, never through the beam; a gentle pull toward the pack
          this.aroundT = hd < 3 && facing >= 0.35 ? this.aroundT + dt : 0;
          this.headT -= dt;
          if (this.headT <= 0) {
            this.headT = rng.range(0.4, 0.8);
            // the goal: a point behind you, round the side it is already on
            const sideOf = (this.position.x - p.position.x) * p.forward.z - (this.position.z - p.position.z) * p.forward.x >= 0 ? 1 : -1;
            const back = hd < 6 && facing > -0.2 ? 1 : 0;
            const gx = p.position.x - p.forward.x * 1.4 * back + p.forward.z * sideOf * 1.2 * back, gz = p.position.z - p.forward.z * 1.4 * back - p.forward.x * sideOf * 1.2 * back;
            let a = Math.atan2(gx - this.position.x, gz - this.position.z);
            a += clamp(rng.gauss() * 0.6, -1.3, 1.3) * clamp01((hd - 1.5) / 4);
            if (this.packN > 1) { const pc = this.packC; const dp = Math.hypot(pc.x - this.position.x, pc.z - this.position.z); if (dp > 5) { const ap = Math.atan2(pc.x - this.position.x, pc.z - this.position.z); a += angleDelta(a, ap) * 0.25; } }
            // the dark side: if the step ahead is lit, swing round it
            if (this.beam > 0.05 || ctx.state.data.flashlight.on) {
              const bx = this.position.x + Math.sin(a) * 2.5, bz = this.position.z + Math.cos(a) * 2.5;
              if (beamAt(ctx, bx, this.position.y + 0.2, bz) > 0.4) a += sideOf * rng.range(60, 90) * DEG;
            }
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
    if (this.rig) {
      this.rig.setState?.({ speed: this.moveSpeed, hit: this.flinch, bite: this.bite, rear: this.biteWind > 0 ? 1 : 0, dead: false, aimAt: this.player.eye });
      this.rig.update?.(dt);
      return;
    }
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
    this.rear = damp(this.rear, this.biteWind > 0 ? 1 : 0, 22, dt);
    // the bands pulse with the breath, and it breathes faster once it has seen you: a pack going from idle
    // to hunting is a dozen amber bands quickening together, which is a group read nothing else in the
    // bestiary has and it costs one line
    this.breath += dt * (2.4 + 4.5 * clamp01(this.aware) + 3.0 * this.gait);
    const ph = this.phase;
    const bob = 0.012 * Math.sin(2 * ph) * g;
    const y = BODY_Y + bob + Math.sin(this.breath) * 0.004 + this.twitch * 0.015 - this.bite * 0.02 + this.rear * 0.05;
    const pitch = 0.05 * Math.sin(2 * ph + 0.5) * g - this.bite * 0.55 * (1 - Math.min(1, this.bite * 1.6)) + this.bite * 0.25 + this.rear * 0.55 + this.flinch * 0.25 + this.twitch * 0.1;
    const roll = 0.06 * Math.sin(ph) * g + this.twitch * 0.1 * Math.sin(t * 40);
    for (let i = 0; i < 6; i++) {
      const L = LEGS[i], lp = ph + L.off * TAU + this.legJit[i] * g, s = Math.sin(lp), c = Math.cos(lp);
      const swing = Math.max(0, s);
      const fz = L.rest[2] * this.stance + S * c * g + this.bite * 0.05;
      const fy = Math.pow(swing, 0.6) * lift * g + this.twitch * 0.02 * (i % 2) + (L.fwd < 0 ? this.rear * 0.12 : 0);
      const fx = L.rest[0] * this.stance + L.side * 0.02 * Math.sin(lp * 0.5 + i) * g;
      _foot.set(fx, fy, fz);
      this.footPos[i].lerp(_foot, Math.min(1, dt * 40));
    }
    this.pose(dt, pitch, roll, y, Math.sin(ph) * 0.06 * g);
    this.mu.uTime.value = t;
    this.mu.uBreath.value = this.breath;
    this.mu.uFlinch.value = damp(this.mu.uFlinch.value, 0, 5, dt);
  }
  pose(dt, pitch, roll, y, yawWobble) {
    const B = this.B, body = B.body;
    body.position.set(0, y, 0);
    body.rotation.set(pitch, yawWobble, roll);
    body.updateMatrix();
    // the abdomen pumps, the head turns to what it wants
    B.abdomen.rotation.set(0.12 * Math.sin(this.phase * 2 + 1) * this.gait + 0.05 * Math.sin(this.breath) + this.bite * 0.15, 0, 0);
    B.head.rotation.set(-this.bite * 0.35 + this.rear * 0.3 + 0.04 * Math.sin(this.breath * 1.3), this.headYaw, 0);
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
  // nests reset with the zone; a shot near a nest with nobody left alive to tick it still wakes it
  ctx.events.on('gameStart', clearNests);
  ctx.events.on('tide', clearNests);
  ctx.events.on('weaponFired', () => {
    const p = ctx.player.position;
    for (const n of nests.values()) { if (n.emitted >= MAX_EMITS) continue; if (Math.hypot(n.position.x - p.x, n.position.z - p.z) < 20) { disturb(n); tryEmit(ctx, n); } }
  });
}
