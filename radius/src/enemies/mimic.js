// Mimic — a human-shaped absence. Matte black, edges shiver, a smeared white blot of a face that always
// turns toward you, a rifle it should not be able to hold. v2: it is what it carries. A loadout rolled from the
// catalogue (a worn weapon with counted rounds, spare magazines, a vest and helmet resolved like the player's
// armour, grenades, a torch on the gun at night) decides how it fights: aimed shots, bursts, suppression from
// cover, a shotgunner's rush, a marksman's glint before the shot. Reloads are audible windows. Squads (squad.js)
// give it a role; alone it holds cover, flanks and skips closer when you are not looking. One a day is a stalker.
//
// v3 — a person with a rifle who wants to live:
//   * Cover is scored by whether it actually breaks your sightline, not by whether it is nearby. A candidate
//     has to give a firing angle when the mimic stands and take that angle away when it drops. It then fights
//     from behind it: down, up for a burst, down again. You get windows, not a standing target.
//   * It does not know where you are. It knows where it last SAW you, where a noise CAME FROM (with an error
//     that shrinks as it gets better), and whatever came over the radio. Shoot it from a hedge and it hunts the
//     hedge, not your feet.
//   * It keeps rounds on the hole you went into (suppression), posts a grenade into it if you stay, and calls a
//     contact so the others can move while it shoots.
//   * It tops up the magazine in a lull instead of running dry in the open, and reloads behind the cover.
//   * It has morale. Hurt, alone, with friends dying beside it, it breaks contact, calls it in, and comes back.
//   * Losing you starts a hunt, not an amnesia: it clears the ground around the last contact in a pattern and
//     sets an overwatch on it, silent, before it gives up.
//   * It sees your torch. At night a beam swung across it is a contact.
//
// ALL of that gets sharper along ONE dial: SKILL, below. Nothing else in this file hard-codes a difficulty.
//
// This file also exports the shared skinned humanoid rig (Rig) and the shiver/dissolve body material, which
// the Seeker reuses at 1.65x scale under its armour plates, and the Slider borrows for its body and face.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './common.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { hash3 } from '../core/rng.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';
import { WEAPONS, AMMO, ARMOR, MAGAZINES, defaultAmmo, resolveHit, zoneFromHit } from '../data/index.js';
import { weaponEffects } from '../player/inventory.js';
import { rollLoadout, pickClass, dropsFor, roundsInGun, consumeRound, bestSpare, classRank } from './loadout.js';
import { buildHumanoid } from './charmesh.js';
import { buildVest, buildHelmet } from './gearmesh.js';
import { buildGun } from '../weapons/gunmesh.js';
import { playAny } from './squad.js';
import { glowTexture } from '../render/textures.js';

// ---- module temporaries (no per-frame allocation) ----
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _upv = new THREE.Vector3();
const _pole = new THREE.Vector3(), _axis = new THREE.Vector3(), _upper = new THREE.Vector3(), _elbow = new THREE.Vector3(), _fore = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _so = new THREE.Vector3(), _sd = new THREE.Vector3(), _sp = new THREE.Vector3(), _n = new THREE.Vector3();
const _bel = new THREE.Vector3(), _aim = new THREE.Vector3(), _post = new THREE.Vector3(), _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

// =====================================================================================================
// Body material: matte black, roughness 1, edge shiver (vertex jitter at ~20 Hz with per-vertex phase),
// noise dissolve for death. One program shared by every instance (same onBeforeCompile source).
// =====================================================================================================
function shiverCompile(shader) {
  const u = this.userData.u;
  for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
  for (const k in u) shader.uniforms[k] = u[k];
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nattribute float aPhase; attribute vec3 aJit; uniform float uTime, uShiver, uSeed; varying vec3 vObjPos;`)
    .replace('#include <skinning_vertex>', /* glsl */`#include <skinning_vertex>
      {
        float ph = aPhase * 61.7 + uSeed;
        float slot = floor(uTime * 20.0 + aPhase * 5.0);
        float n1 = hash11(slot + ph) - 0.5;
        float n2 = hash11(slot * 1.31 + ph * 0.7 + 3.1) - 0.5;
        float spike = step(0.94, hash11(slot * 0.11 + ph * 3.3));
        float amp = uShiver * (0.028 + spike * 0.07);
        transformed += (objectNormal * n1 * 0.7 + aJit * n2) * amp;
      }
      vObjPos = transformed;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nuniform float uDissolve, uGrime; varying vec3 vObjPos;`)
    .replace('#include <clipping_planes_fragment>', /* glsl */`#include <clipping_planes_fragment>
      float dsv = 0.0;
      if (uDissolve > 0.0) {
        float dn = fbm3d(vObjPos * 4.0);
        float th = uDissolve * 1.15 - 0.05;
        if (dn < th) discard;
        dsv = smoothstep(th + 0.07, th, dn);
      }`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      if (uGrime > 0.0) {
        float gr = fbm3d(vObjPos * 7.0);
        diffuseColor.rgb *= mix(1.0, 0.5 + 0.9 * gr, uGrime);
        float rust = smoothstep(0.58, 0.78, fbm3d(vObjPos * 2.6 + 7.0)) * uGrime;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.14, 0.07), rust * 0.7);
        float scuff = smoothstep(0.7, 0.9, vnoise3(vObjPos * 40.0)) * uGrime;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.22, 0.2), scuff * 0.5);
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.29, 0.28), dsv);`)
    .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      if (uGrime > 0.0) roughnessFactor = clamp(roughnessFactor - 0.25 * uGrime * smoothstep(0.55, 0.8, fbm3d(vObjPos * 5.0 + 3.0)), 0.5, 1.0);`);
}
export function makeBodyMaterial(o = {}) {
  const c = o.color || [o.albedo ?? 0.02, o.albedo ?? 0.02, (o.albedo ?? 0.02) * 1.1];
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: o.roughness ?? 1, metalness: 0 });
  mat.userData.u = { uTime: { value: 0 }, uShiver: { value: o.shiver ?? 1 }, uDissolve: { value: 0 }, uSeed: { value: Math.random() * 100 }, uGrime: { value: o.grime ?? 0 } };
  mat.onBeforeCompile = shiverCompile;
  return mat;
}

// =====================================================================================================
// Face blot: an emissive, smeared, flickering white disc on a small plane that always turns toward the
// camera. HDR white (x3) so bloom catches it; fogged like everything else so it dies into the haze.
// =====================================================================================================
const FACE_VERT = /* glsl */`
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main(){ vUv = uv; vec3 transformed = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
    #include <fog_vertex>
  }`;
const FACE_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime, uSeed, uFade, uGlow; varying vec2 vUv;
  #include <fog_pars_fragment>
  void main(){
    vec2 p = vUv - 0.5;
    float t = uTime;
    float slot = floor(t * 14.0);
    float flick = 0.82 + 0.34 * hash11(slot + uSeed);
    p.x *= 1.0 + 0.36 * (hash11(uSeed + 1.0) - 0.5);
    p += 0.045 * vec2(sin(t * 1.7 + uSeed), cos(t * 1.1 + uSeed * 2.0));
    float n = fbm3(p * 5.0 + uSeed + vec2(t * 0.15, -t * 0.1)) - 0.5;
    float d = length(p * vec2(1.0, 1.3)) / (0.30 * flick) + n * 0.6;
    float a = smoothstep(1.0, 0.42, d);
    vec2 q = p - vec2(0.12, -0.15);
    float tail = smoothstep(0.32, 0.0, length(q * vec2(1.0, 2.4))) * (0.45 + 0.35 * sin(t * 0.7 + uSeed));
    a = clamp(a + tail * 0.5, 0.0, 1.0);
    gl_FragColor = vec4(vec3(1.0, 0.98, 0.94) * uGlow, a * uFade);
    #include <fog_fragment>
  }`;
let faceGeo = null;
export function makeFace(size = 0.24, glow = 3.0) {
  if (!faceGeo) { faceGeo = new THREE.PlaneGeometry(1, 1.12); faceGeo.userData.shared = true; }
  const uniforms = Object.assign({ uTime: { value: 0 }, uSeed: { value: Math.random() * 50 }, uFade: { value: 1 }, uGlow: { value: glow } }, fogUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: FACE_VERT, fragmentShader: FACE_FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
  const m = new THREE.Mesh(faceGeo, mat);
  m.scale.setScalar(size); m.renderOrder = 3;
  return m;
}

// =====================================================================================================
// Skinned humanoid rig. Bones in a fixed order; segments are irregular tapered boxes bound 1:1 to bones.
// Everything animates procedurally: gait, two-bone IK arms holding the gun, head tracking, pose glitches.
// =====================================================================================================
const BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'foL', 'foR', 'thL', 'thR', 'snL', 'snR', 'gun'];

// Give any geometry the skinning + shiver attributes, bound 1:1 to one bone. Jitter directions and phases are
// hashed from the rest position so coincident vertices of adjacent faces move together.
export function skinify(g, bone) {
  const pos = g.attributes.position, n = pos.count;
  const phase = new Float32Array(n), jdir = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const kx = Math.round(px * 1000) + 7, ky = Math.round(py * 1000) + 3, kz = Math.round(pz * 1000) + 11;
    const h1 = hash3(kx, ky, kz), h2 = hash3(ky, kz, kx), h3 = hash3(kz, kx, ky);
    phase[i] = h1;
    const jx = h2 - 0.5, jy = h3 - 0.5, jz = h1 - 0.5; const jl = Math.hypot(jx, jy, jz) || 1;
    jdir[i * 3] = jx / jl; jdir[i * 3 + 1] = jy / jl; jdir[i * 3 + 2] = jz / jl;
    si[i * 4] = bone; sw[i * 4] = 1;
  }
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aJit', new THREE.BufferAttribute(jdir, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}
export const boneIndex = (name) => BONE_NAMES.indexOf(name);
// One irregular tapered box segment in mesh space. o: { top, bottom (taper), rx, ry, rz, jitter }
function segment(w, h, d, x, y, z, bone, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const pos = g.attributes.position, n = pos.count;
  const jit = o.jitter ?? 0.012;
  for (let i = 0; i < n; i++) {
    let px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const t = (py + h / 2) / h;
    const sc = lerp(o.bottom ?? 1, o.top ?? 1, t);
    px *= sc; pz *= sc;
    const kx = Math.round(px * 1000) + 7, ky = Math.round(py * 1000) + 3, kz = Math.round(pz * 1000) + 11;
    pos.setXYZ(i, px + (hash3(kx, ky, kz) - 0.5) * jit, py + (hash3(ky, kz, kx) - 0.5) * jit, pz + (hash3(kz, kx, ky) - 0.5) * jit);
  }
  _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _m.makeRotationFromEuler(_e); _m.setPosition(x, y, z);
  g.applyMatrix4(_m);
  g.computeVertexNormals();
  return skinify(g, bone);
}

// parts: [w,h,d, x,y,z, boneName, opts]. Returns a merged geometry in mesh space.
export function buildParts(parts, s = 1) {
  const geos = parts.map(([w, h, d, x, y, z, bone, o]) => segment(w * s, h * s, d * s, x * s, y * s, z * s, BONE_NAMES.indexOf(bone), o));
  const g = mergeGeometries(geos, false);
  for (const gg of geos) gg.dispose();
  return g;
}

// Rest-pose body: a lean human silhouette. Shoulders slightly uneven, head a little too narrow.
export const BODY_PARTS = [
  [0.30, 0.20, 0.19, 0, 0.93, 0, 'hips', { top: 1.05 }],
  [0.27, 0.21, 0.17, 0, 1.21, 0.005, 'spine', { bottom: 1.0, top: 1.12 }],
  [0.40, 0.31, 0.22, 0, 1.46, 0, 'chest', { bottom: 0.84, top: 1.0 }],
  [0.10, 0.11, 0.10, 0, 1.62, 0, 'neck', {}],
  [0.19, 0.25, 0.22, 0.004, 1.79, 0.01, 'head', { top: 0.86, bottom: 0.92, rz: 0.03, jitter: 0.02 }],
  [0.13, 0.12, 0.15, -0.25, 1.535, 0, 'shL', { jitter: 0.02 }],
  [0.13, 0.12, 0.15, 0.25, 1.545, 0.01, 'shR', { jitter: 0.02 }],
  [0.11, 0.30, 0.11, -0.21, 1.39, 0, 'shL', { top: 1.0, bottom: 0.85 }],
  [0.11, 0.30, 0.11, 0.21, 1.39, 0, 'shR', { top: 1.0, bottom: 0.85 }],
  [0.09, 0.27, 0.09, -0.21, 1.105, 0, 'foL', { top: 1.0, bottom: 0.8 }],
  [0.09, 0.27, 0.09, 0.21, 1.105, 0, 'foR', { top: 1.0, bottom: 0.8 }],
  [0.08, 0.11, 0.05, -0.21, 0.915, 0, 'foL', {}],
  [0.08, 0.11, 0.05, 0.21, 0.915, 0, 'foR', {}],
  [0.15, 0.45, 0.16, -0.11, 0.695, 0, 'thL', { top: 1.0, bottom: 0.78 }],
  [0.15, 0.45, 0.16, 0.11, 0.695, 0, 'thR', { top: 1.0, bottom: 0.78 }],
  [0.12, 0.43, 0.12, -0.11, 0.255, 0, 'snL', { top: 1.0, bottom: 0.8 }],
  [0.12, 0.43, 0.12, 0.11, 0.255, 0, 'snR', { top: 1.0, bottom: 0.8 }],
  [0.11, 0.07, 0.26, -0.11, 0.04, -0.06, 'snL', {}],
  [0.11, 0.07, 0.26, 0.11, 0.04, -0.06, 'snR', {}],
];
// A crude rifle silhouette: dark boxes, gun-local space, muzzle toward -z. Positioned at the gun bone's rest.
export const GUN_REST = [0.06, 1.34, -0.20];
export const RIFLE_PARTS = [
  [0.05, 0.075, 0.40, 0, 0, 0, 'gun', { jitter: 0.004 }],
  [0.024, 0.024, 0.38, 0, 0.012, -0.39, 'gun', { jitter: 0.002 }],
  [0.05, 0.055, 0.20, 0, 0.0, -0.28, 'gun', { jitter: 0.004 }],
  [0.045, 0.085, 0.26, 0, -0.03, 0.31, 'gun', { rx: 0.12, jitter: 0.004 }],
  [0.035, 0.17, 0.065, 0, -0.11, -0.03, 'gun', { rx: 0.3, jitter: 0.003 }],
  [0.035, 0.10, 0.045, 0, -0.085, 0.13, 'gun', { rx: -0.35, jitter: 0.003 }],
  [0.02, 0.03, 0.03, 0, 0.055, 0.05, 'gun', { jitter: 0.002 }],
];
export function offsetParts(parts, ox, oy, oz) { return parts.map((p) => [p[0], p[1], p[2], p[3] + ox, p[4] + oy, p[5] + oz, p[6], p[7]]); }

export const RIG_DEFAULTS = { L1: 0.30, L2: 0.27, muzzle: [0, 0.012, -0.58], gripR: [0.0, -0.10, 0.13], gripL: [0.0, -0.04, -0.18] };

let sharedBodyGeo = null;
export class Rig {
  // o: { scale, material, parts (mesh-space body parts, default BODY_PARTS + rifle), gunParts, geometry (shared), muzzle, gripR, gripL, L1, L2 }
  constructor(o = {}) {
    const s = this.s = o.scale ?? 1;
    this.L1 = (o.L1 ?? RIG_DEFAULTS.L1) * s; this.L2 = (o.L2 ?? RIG_DEFAULTS.L2) * s;
    const bones = this.bones = []; const B = this.B = {};
    const mk = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x * s, y * s, z * s); if (parent) parent.add(b); bones.push(b); B[name] = b; return b; };
    mk('hips', null, 0, 0.95, 0);
    mk('spine', B.hips, 0, 0.17, 0);
    mk('chest', B.spine, 0, 0.20, 0);
    mk('neck', B.chest, 0, 0.28, 0);
    mk('head', B.neck, 0, 0.06, 0);
    mk('shL', B.chest, -0.21, 0.22, 0);
    mk('shR', B.chest, 0.21, 0.22, 0);
    mk('foL', B.shL, 0, -0.30, 0);
    mk('foR', B.shR, 0, -0.30, 0);
    mk('thL', B.hips, -0.11, -0.03, 0);
    mk('thR', B.hips, 0.11, -0.03, 0);
    mk('snL', B.thL, 0, -0.45, 0);
    mk('snR', B.thR, 0, -0.45, 0);
    mk('gun', B.chest, GUN_REST[0], GUN_REST[1] - 1.32, GUN_REST[2]);
    // rest offsets we return to each frame
    this.rest = { hips: B.hips.position.clone(), gun: B.gun.position.clone() };
    this.gunRest = new THREE.Vector3(GUN_REST[0] * s, (GUN_REST[1] - 1.32) * s, GUN_REST[2] * s);
    this.gunAim = new THREE.Vector3(0.085 * s, 0.16 * s, -0.24 * s);

    let geo = o.geometry;
    if (!geo) {
      if (o.parts) geo = buildParts(o.parts, s);
      else { if (!sharedBodyGeo) { sharedBodyGeo = buildParts(BODY_PARTS.concat(offsetParts(RIFLE_PARTS, GUN_REST[0], GUN_REST[1], GUN_REST[2])), 1); sharedBodyGeo.userData.shared = true; } geo = sharedBodyGeo; }
    }
    const mesh = this.mesh = new THREE.SkinnedMesh(geo, o.material);
    mesh.castShadow = true; mesh.receiveShadow = false;
    mesh.add(B.hips);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0 * s, 0), 1.7 * s);
    this.muzzle = new THREE.Object3D(); const mz = o.muzzle ?? RIG_DEFAULTS.muzzle; this.muzzle.position.set(mz[0] * s, mz[1] * s, mz[2] * s); B.gun.add(this.muzzle);
    const gr = o.gripR ?? RIG_DEFAULTS.gripR, gl = o.gripL ?? RIG_DEFAULTS.gripL;
    this.gripR = new THREE.Vector3(gr[0] * s, gr[1] * s, gr[2] * s); this.gripL = new THREE.Vector3(gl[0] * s, gl[1] * s, gl[2] * s);
    this.shPosL = B.shL.position.clone(); this.shPosR = B.shR.position.clone();
    // animation state
    this.phase = Math.random() * TAU; this.stepFlag = 0; this.gait = 0; this.aim = 0; this.kick = 0; this.headYaw = 0; this.headPitch = 0; this.flinch = 0;
    this.glitch = new Float32Array(BONE_NAMES.length * 3); this.glitchOn = false; this.gunSway = 0;
    this.bob = 0;
  }
  // attach a second skinned mesh (armour plates) that shares this skeleton
  attach(geometry, material) {
    const m = new THREE.SkinnedMesh(geometry, material);
    m.castShadow = true; m.bind(this.mesh.skeleton, this.mesh.bindMatrix);
    m.boundingSphere = this.mesh.boundingSphere;
    return m;
  }
  dispose() { this.mesh.skeleton.dispose(); }
  // c: { speed, dt, moveX, moveZ (local movement dir), aim 0..1, aimPitch, aimYaw, headYaw, headPitch, stride, lean, crouch, still }
  pose(c) {
    const B = this.B, s = this.s, dt = c.dt;
    const sf = clamp01(c.speed / 3.2);
    this.gait = damp(this.gait, sf, 6, dt);
    const g = this.gait;
    const stride = (c.stride ?? 1.35) * s;
    const prev = this.phase;
    this.phase += (c.speed / stride) * TAU * 0.5 * dt;
    // footfalls: each half cycle plants a foot
    this.stepFlag = 0;
    const a = Math.floor(prev / Math.PI + 0.5), b = Math.floor(this.phase / Math.PI + 0.5);
    if (b !== a && g > 0.15) this.stepFlag = 1;
    const ph = this.phase;
    // legs: swing about x (positive = forward), knees bend in the swing
    const swing = 0.62 * g * (0.55 + 0.45 * clamp01(c.speed / 2));
    const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
    B.thL.rotation.set(sL * swing + (c.crouch || 0) * 0.5, 0, 0.02);
    B.thR.rotation.set(sR * swing + (c.crouch || 0) * 0.5, 0, -0.02);
    const kL = Math.max(0, Math.cos(ph - 0.35)), kR = Math.max(0, Math.cos(ph + Math.PI - 0.35));
    B.snL.rotation.set(-(kL * kL * 1.05 * g + (c.crouch || 0) * 0.9), 0, 0);
    B.snR.rotation.set(-(kR * kR * 1.05 * g + (c.crouch || 0) * 0.9), 0, 0);
    // hips: bob, sway, lean into the walk
    this.bob = damp(this.bob, g, 6, dt);
    B.hips.position.set(this.rest.hips.x + Math.sin(ph) * 0.018 * s * g, this.rest.hips.y - (0.5 + 0.5 * Math.cos(2 * ph)) * 0.035 * s * this.bob - (c.crouch || 0) * 0.28 * s, this.rest.hips.z);
    B.hips.rotation.set(-(0.10 * g + (c.lean || 0)), Math.sin(ph) * 0.05 * g, -Math.sin(ph) * 0.03 * g);   // -x leans the torso into the walk
    B.spine.rotation.set(0.02 - 0.04 * g, -Math.sin(ph) * 0.05 * g, 0);
    // flinch: torso jerk
    this.flinch = damp(this.flinch, 0, 9, dt);
    B.chest.rotation.set(-0.03 + this.flinch * 0.35, (c.chestYaw || 0) + Math.sin(ph) * 0.03 * g, this.flinch * 0.2);
    // head tracks a target, otherwise faces forward with a slow drift
    this.headYaw = dampAngle(this.headYaw, clamp(c.headYaw || 0, -1.35, 1.35), c.headRate ?? 6, dt);
    this.headPitch = damp(this.headPitch, clamp(c.headPitch || 0, -0.6, 0.5), 6, dt);
    B.neck.rotation.set(this.headPitch * 0.35, this.headYaw * 0.35, 0);
    B.head.rotation.set(this.headPitch * 0.65, this.headYaw * 0.65, (c.headTilt || 0));
    // gun: low ready -> shouldered aim; recoil kick
    this.aim = damp(this.aim, c.aim || 0, 7, dt);
    this.kick = damp(this.kick, 0, 18, dt);
    const gn = B.gun;
    gn.position.lerpVectors(this.gunRest, this.gunAim, this.aim);
    gn.position.y += Math.sin(ph * 2) * 0.012 * s * g; gn.position.z += this.kick * 0.05 * s;
    const pitch = lerp(-0.42, clamp(c.aimPitch || 0, -0.9, 0.7), this.aim) + this.kick * 0.09;
    gn.rotation.set(pitch, lerp(0.16, clamp(c.aimYaw || 0, -0.45, 0.45), this.aim) + Math.sin(ph) * 0.02 * g, lerp(0.08, 0.0, this.aim));
    gn.updateMatrix();
    // arms: two-bone IK so both hands stay on the rifle
    this.solveArm(B.shL, B.foL, this.shPosL, _v.copy(this.gripL).applyMatrix4(gn.matrix), -1);
    this.solveArm(B.shR, B.foR, this.shPosR, _v.copy(this.gripR).applyMatrix4(gn.matrix), 1);
    // pose glitch: the whole pose snaps to a slightly wrong frame
    if (this.glitchOn) {
      const gl = this.glitch;
      for (let i = 0; i < BONE_NAMES.length; i++) { const bn = this.bones[i]; bn.rotation.x += gl[i * 3]; bn.rotation.y += gl[i * 3 + 1]; bn.rotation.z += gl[i * 3 + 2]; }
      B.hips.position.x += gl[1] * 0.2 * s; B.hips.position.y += Math.abs(gl[2]) * 0.12 * s;
    }
  }
  startGlitch(strength = 1) {
    const gl = this.glitch;
    for (let i = 0; i < gl.length; i++) gl[i] = (Math.random() - 0.5) * 0.5 * strength * (Math.random() < 0.5 ? 1 : 0.2);
    this.glitchOn = true;
  }
  solveArm(upperBone, foreBone, shoulder, target, side) {
    const L1 = this.L1, L2 = this.L2;
    _dir.subVectors(target, shoulder); let d = _dir.length();
    const maxD = (L1 + L2) * 0.995; if (d > maxD) { d = maxD; } if (d < 0.02) { d = 0.02; }
    _dir.normalize();
    const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const ang = Math.acos(cosA);
    _pole.set(0.75 * side, -0.45, 0.65).normalize();
    _axis.crossVectors(_dir, _pole); if (_axis.lengthSq() < 1e-6) _axis.set(side, 0, 0); _axis.normalize();
    _upper.copy(_dir).applyAxisAngle(_axis, ang);
    _elbow.copy(shoulder).addScaledVector(_upper, L1);
    _fore.subVectors(target, _elbow).normalize();
    upperBone.quaternion.setFromUnitVectors(DOWN, _upper);
    _q.copy(upperBone.quaternion).invert();
    _fore.applyQuaternion(_q);
    foreBone.quaternion.setFromUnitVectors(DOWN, _fore);
    // Euler mirrors so the glitch pass can add to .rotation safely
    upperBone.rotation.setFromQuaternion(upperBone.quaternion); foreBone.rotation.setFromQuaternion(foreBone.quaternion);
  }
  // world position of a bone origin (after the root has been synced). writes out.
  boneWorld(name, out) { const b = this.B[name]; b.updateWorldMatrix(true, false); return out.setFromMatrixPosition(b.matrixWorld); }
  muzzleWorld(out, dirOut) { this.muzzle.updateWorldMatrix(true, false); out.setFromMatrixPosition(this.muzzle.matrixWorld); if (dirOut) { dirOut.set(-this.muzzle.matrixWorld.elements[8], -this.muzzle.matrixWorld.elements[9], -this.muzzle.matrixWorld.elements[10]).normalize(); } return out; }
}

// =====================================================================================================
// Enemy fire helper: uses ballistics when live, otherwise a capsule test against the player.
// =====================================================================================================
function rayCapsule(o, dir, cx, cz, y0, y1, r, maxD) {
  const ox = o.x - cx, oz = o.z - cz, a = dir.x * dir.x + dir.z * dir.z;
  let t;
  if (a < 1e-9) { if (ox * ox + oz * oz > r * r) return -1; t = 0; }
  else { const b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r; const disc = b * b - 4 * a * c; if (disc < 0) return -1; t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) { if (c > 0) return -1; t = 0; } }
  if (t > maxD) return -1;
  const y = o.y + dir.y * t; if (y >= y0 && y <= y1) return t;
  if (Math.abs(dir.y) > 1e-9) for (const cy of [y0, y1]) { const tt = (cy - o.y) / dir.y; if (tt < 0 || tt > maxD) continue; const x = o.x + dir.x * tt - cx, z = o.z + dir.z * tt - cz; if (x * x + z * z <= r * r) return tt; }
  return -1;
}
export function enemyShoot(ctx, shooter, origin, dir, damage, spreadDeg) {
  if (ctx.ballistics && !ctx.ballistics.isStub) { return ctx.ballistics.shoot(origin, dir, { source: 'enemy', damage, spreadDeg, tracer: true, kind: 'bullet', range: 120, shooter }); }
  // fallback: cone spread, world occlusion, player capsule, whiz, impact
  _so.copy(origin);
  const a = spreadDeg * DEG * Math.sqrt(Math.random()), phi = Math.random() * TAU;
  _right.crossVectors(dir, UP); if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); _right.normalize(); _upv.crossVectors(_right, dir);
  _sd.copy(dir).addScaledVector(_right, Math.sin(a) * Math.cos(phi)).addScaledVector(_upv, Math.sin(a) * Math.sin(phi)).normalize();
  const hit = ctx.world.raycast(_so, _sd, 120);
  const maxD = hit ? hit.distance : 120;
  const p = ctx.player;
  const t = p.dead ? -1 : rayCapsule(_so, _sd, p.position.x, p.position.z, p.position.y, p.position.y + (p.crouched ? 1.3 : 1.8), 0.35, maxD);
  if (t >= 0) {
    _sp.copy(_so).addScaledVector(_sd, t);
    ctx.vfx.tracer(_so, _sp, 0.02);
    p.damage(damage, { kind: 'bullet', source: shooter });
    return [{ kind: 'player', point: _sp.clone() }];
  }
  // near miss: whiz
  const tc = _sp.subVectors(p.eye, _so).dot(_sd);
  if (tc > 0 && tc < maxD) { _sp.copy(_so).addScaledVector(_sd, tc); if (_sp.distanceTo(p.eye) < 1.5) ctx.audio.play('bullet_whiz', { pos: _sp, gain: 0.7, hrtf: true }); }
  if (hit) { ctx.vfx.tracer(_so, hit.point, 0.02); ctx.vfx.impact(hit.point, hit.normal, hit.surface); return [{ kind: 'world', point: hit.point, surface: hit.surface }]; }
  _sp.copy(_so).addScaledVector(_sd, 120); ctx.vfx.tracer(_so, _sp, 0.02);
  return [];
}

// =====================================================================================================
// Worn gear on the skinned rig (used until gearmesh/charmesh deliver real pieces): plates skinned to the chest,
// spine and shoulders for a vest, a dome (with a visor slab on visored models) on the head for a helmet.
// =====================================================================================================
function fallbackGearGeometry(vestDef, helmetDef) {
  const parts = [];
  if (vestDef) {
    const heavy = vestDef.cls >= 4;
    parts.push([0.40, 0.30, 0.07, 0, 1.46, -0.135, 'chest', { top: 0.92, jitter: 0.008 }]);
    parts.push([0.38, 0.30, 0.06, 0, 1.45, 0.125, 'chest', { top: 0.9, jitter: 0.008 }]);
    parts.push([0.30, 0.10, 0.06, 0, 1.27, -0.115, 'spine', { jitter: 0.006 }]);
    if (vestDef.zones.includes('stomach')) parts.push([0.28, 0.09, 0.05, 0, 1.165, -0.105, 'spine', { jitter: 0.006 }]);
    if (heavy) { parts.push([0.09, 0.22, 0.20, -0.215, 1.44, 0, 'chest', { jitter: 0.008 }]); parts.push([0.09, 0.22, 0.20, 0.215, 1.44, 0, 'chest', { jitter: 0.008 }]); }
    if (vestDef.zones.includes('arms')) { parts.push([0.17, 0.12, 0.19, -0.26, 1.575, 0, 'shL', { rz: 0.25, top: 0.85, jitter: 0.01 }]); parts.push([0.17, 0.12, 0.19, 0.26, 1.575, 0.01, 'shR', { rz: -0.25, top: 0.85, jitter: 0.01 }]); }
    // magazine pouches across the front
    parts.push([0.07, 0.11, 0.05, -0.09, 1.36, -0.165, 'chest', { jitter: 0.006 }]); parts.push([0.07, 0.11, 0.05, 0.0, 1.35, -0.17, 'chest', { jitter: 0.006 }]); parts.push([0.07, 0.11, 0.05, 0.09, 1.36, -0.165, 'chest', { jitter: 0.006 }]);
  }
  let geo = parts.length ? buildParts(parts, 1) : null;
  if (helmetDef) {
    const dome = new THREE.SphereGeometry(0.138, 12, 8, 0, TAU, 0, Math.PI * (helmetDef.cls >= 4 ? 0.62 : 0.55));
    dome.scale(1.0, 0.88, 1.08);
    _m.makeTranslation(0.004, 1.815, 0.012); dome.applyMatrix4(_m);
    skinify(dome, boneIndex('head'));
    const extra = [dome];
    if (helmetDef.visor) { const vis = new THREE.BoxGeometry(0.2, 0.09, 0.03); _m.makeTranslation(0.004, 1.78, -0.115); vis.applyMatrix4(_m); skinify(vis, boneIndex('head')); extra.push(vis); }
    if (helmetDef.cls <= 2) { const brim = new THREE.CylinderGeometry(0.15, 0.155, 0.02, 12, 1, true); _m.makeTranslation(0.004, 1.74, 0.012); brim.applyMatrix4(_m); skinify(brim, boneIndex('head')); extra.push(brim); }
    const merged = mergeGeometries(geo ? [geo, ...extra] : extra, false);
    if (geo) geo.dispose(); for (const g of extra) g.dispose();
    geo = merged;
  }
  return geo;
}

// The legacy rig behind the charmesh API: root, bones, attach(gun), wear(vest, helmet), setState(s), update(dt).
let sharedBodyNoGun = null;
class LegacyRig {
  constructor(material) {
    if (!sharedBodyNoGun) { sharedBodyNoGun = buildParts(BODY_PARTS, 1); sharedBodyNoGun.userData.shared = true; }
    this.material = material;
    this.rig = new Rig({ material, geometry: sharedBodyNoGun });
    this.root = new THREE.Group(); this.root.add(this.rig.mesh);
    this.bones = this.rig.B; this.bones.handR = this.rig.B.gun;
    this.gun = null; this.gear = null; this.gearMat = null; this.legacy = true; this.stub = false;
    this.s = { speed: 0, aiming: 0, crouch: 0, hit: 0, dead: false, glitch: 0, headYaw: 0, headPitch: 0, aimYaw: 0, aimPitch: 0, headRate: 4 };
    this.gunSil = null;
  }
  attach(g) {
    if (!g) { if (!this.gunSil) { this.gunSil = new THREE.Mesh(buildParts(RIFLE_PARTS, 1), this.material); this.gunSil.castShadow = true; this.rig.B.gun.add(this.gunSil); } return; }
    this.gun = g; g.position.set(0, -0.08, 0.1); this.rig.B.gun.add(g);
    const gr = g.userData?.grips;
    if (gr?.right?.p) { this.rig.gripR.set(gr.right.p[0], gr.right.p[1] - 0.08, gr.right.p[2] + 0.1); }
    if (gr?.left?.p) { this.rig.gripL.set(gr.left.p[0], gr.left.p[1] - 0.08, Math.max(-0.34, gr.left.p[2] + 0.1)); }
  }
  wear(vestId, helmetId) {
    if (this.gear) { this.root.remove(this.gear); this.gear.geometry.dispose(); this.gear = null; }
    const vd = vestId ? ARMOR[vestId] : null, hd = helmetId ? ARMOR[helmetId] : null;
    if (!vd && !hd) return;
    // real pieces from gearmesh when they exist, plates otherwise
    let anyReal = false;
    const v = vd ? buildVest?.(vestId) : null, h = hd ? buildHelmet?.(helmetId) : null;
    if (v) { this.rig.B.chest.add(v); anyReal = true; }
    if (h) { this.rig.B.head.add(h); anyReal = true; }
    if (anyReal) return;
    const geo = fallbackGearGeometry(vd, hd); if (!geo) return;
    if (!this.gearMat) this.gearMat = makeBodyMaterial({ color: vd && vd.cls >= 4 ? [0.075, 0.08, 0.07] : [0.095, 0.105, 0.075], roughness: 0.92, shiver: 0.18, grime: 1 });
    this.gear = this.rig.attach(geo, this.gearMat); this.root.add(this.gear);
  }
  setState(s) { Object.assign(this.s, s); }
  update(dt) {
    const s = this.s;
    this.rig.pose({ dt, speed: s.speed || 0, aim: s.aiming || 0, aimPitch: s.aimPitch || 0, aimYaw: s.aimYaw || 0, headYaw: s.headYaw || 0, headPitch: s.headPitch || 0, chestYaw: clamp((s.headYaw || 0) * 0.25, -0.3, 0.3), headRate: s.headRate || 4, crouch: s.crouch || 0 });
  }
  dispose() { this.rig.dispose(); if (this.gear) this.gear.geometry.dispose(); if (this.gearMat) this.gearMat.dispose(); if (this.gunSil) this.gunSil.geometry.dispose(); }
}

// =====================================================================================================
// Weapon lights: a pool of four spot lights with visible additive cones, handed to the nearest mimics that want
// one (night, engaged or searching, a light in the loadout). Lights stay in the scene at zero when idle so the
// light count never changes.
// =====================================================================================================
const CONE_VERT = /* glsl */`
  varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  void main(){ vUv = uv; vT = 1.0 - uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const CONE_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime, uIntensity; varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  void main(){
    float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float fall = pow(1.0 - vT, 2.0) * smoothstep(0.0, 0.05, vT);
    float dust = 0.75 + 0.5 * vnoise(vec2(vUv.x * 7.0, vT * 18.0 - uTime * 0.6));
    float a = (0.10 + 0.55 * edge * edge) * fall * uIntensity * dust;
    gl_FragColor = vec4(vec3(0.95, 0.93, 1.0) * a, a);
  }`;
let coneGeo = null;
const LIGHTS = []; let lightSchedT = -1e9; const wantList = [];
function makeLightEntry(ctx) {
  if (!coneGeo) { const L = 16, r = Math.tan(0.2) * L; coneGeo = new THREE.ConeGeometry(r, L, 20, 1, true); _m.makeTranslation(0, -L / 2, 0); coneGeo.applyMatrix4(_m); _m.makeRotationX(Math.PI / 2); coneGeo.applyMatrix4(_m); coneGeo.userData.shared = true; }
  const light = new THREE.SpotLight(0xf2efff, 0, 45, 0.2, 0.5, 1.4); light.castShadow = false;
  light.target.position.set(0, 0, -10);
  const cone = new THREE.Mesh(coneGeo, new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  cone.renderOrder = 4; cone.frustumCulled = false; cone.visible = false;
  const holder = new THREE.Group(); holder.add(light); holder.add(light.target); holder.add(cone);
  ctx.scene.add(holder);
  const e = { light, cone, holder, owner: null, level: 0 };
  LIGHTS.push(e);
  return e;
}
function releaseLight(ctx, e) {
  if (e.owner) { e.owner.lightEntry = null; e.owner = null; }
  e.light.intensity = 0; e.cone.visible = false; e.cone.material.uniforms.uIntensity.value = 0; e.level = 0;
  ctx.scene.attach(e.holder);
}
function scheduleLights(ctx) {
  if (ctx.elapsed - lightSchedT < 0.3) return;
  lightSchedT = ctx.elapsed;
  wantList.length = 0;
  const p = ctx.player.position;
  for (const e of ctx.enemies.list) if (e.alive && e.type === 'mimic' && e.wantLight) { e._ld = e.position.distanceTo(p); wantList.push(e); }
  wantList.sort((a, b) => a._ld - b._ld);
  if (wantList.length > 4) wantList.length = 4;
  for (const e of LIGHTS) if (e.owner && (!wantList.includes(e.owner) || !e.owner.alive)) releaseLight(ctx, e);
  for (const m of wantList) {
    if (m.lightEntry) continue;
    let e = LIGHTS.find((x) => !x.owner);
    if (!e && LIGHTS.length < 4) e = makeLightEntry(ctx);
    if (!e) break;
    e.owner = m; m.lightEntry = e;
    const mount = m.muzzleObj || m.rigBones?.handR || m.root;
    mount.add(e.holder); e.holder.position.set(0, 0.02, 0.05); e.holder.rotation.set(0, 0, 0);
    e.cone.visible = true;
  }
}

// =====================================================================================================
// The Mimic
// =====================================================================================================
let rng = null;
const SPEED = { patrol: 1.55, suspicious: 2.4, engage: 3.4, search: 2.6, stalk: 2.2, posture: 1.5, break: 3.9 };
// The capsule crouches with the pose (STAND_H -> CROUCH_H), so getting down behind a wall really does put the
// wall between it and your rounds — and CROUCH_EYE is where its eyes are when it is down there, which is the
// height cover is tested at. Without this the crouch would be an animation and cover would be a decoration.
const STAND_H = 1.85, CROUCH_H = 1.25, CROUCH_EYE = CROUCH_H * 0.9;
const DETOUR_R = [4, 7, 11];   // how far to one side a mimic steps to get round something in its way
const SHOT_FALLBACK = { pistol: 'shot_pm', smg: 'shot_pm', rifle: 'shot_akm', shotgun: 'shot_toz', sniper: 'shot_mosin', mg: 'shot_akm' };

// =====================================================================================================
// THE ONE DIFFICULTY DIAL
// -----------------------------------------------------------------------------------------------------
// A mimic's SKILL PROGRESS is a single 0..1 number built from four inputs, and every tactical number in this
// file is a lerp along it. Nothing else here is allowed to hard-code a difficulty; if a fight feels wrong,
// this table is the only place to touch.
//
//   progress = (tide-1)*tide + (security-1)*security + classRank*classRank + director.pressure*pressure
//
//   tide       1..3   the Tide level (game/tide.js raises it; 3 is the deep zone)
//   security   1..5   the Explorer's clearance (game/missions.js raises it as you earn)
//   classRank  0..4   recruit / regular / shotgunner-gunner / veteran-sniper / elite (enemies/loadout.js)
//   pressure   0..1   the Director's live pressure: night, Tide, and the noise you have been making lately
//
// Worked examples:
//   day one, Tide 1, clearance 1, a recruit at the checkpoint, quiet zone  -> 0.00  (see the "at 0" column)
//   Tide 2, clearance 3, a regular, mid-firefight                          -> 0.66
//   Tide 3, clearance 5, an elite at night with the zone lit up            -> 1.00  (clamped from 1.56)
//
// At 0 a mimic takes a second to shoot back, sprays wide from a standing position, never flanks, never throws,
// runs its magazine dry and breaks the moment it is hurt: a nervous player with a Makarov wins that fight.
// At 1 it answers in a fifth of a second from behind a wall, leads you, three rounds at a time, tops up in the
// gaps, puts fire on the hole you hid in, posts a grenade into it, and calls the whole treeline down on you.
// =====================================================================================================
export const SKILL = {
  // ---- how far along the curve a mimic stands (0..1) ----
  tide: 0.30,        // per Tide level above the first      (1..3 -> 0.00 .. 0.60)
  security: 0.13,    // per clearance level above the first (1..5 -> 0.00 .. 0.52)
  classRank: 0.08,   // recruit .. elite                    (0..4 -> 0.00 .. 0.32)
  pressure: 0.12,    // ctx.director.pressure
  max: 1,

  // ---- and what changes along it: [at 0, at 1] ----
  react:    [1.05, 0.18],  // s between acquiring you and the first round leaving the barrel
  spread:   [1.80, 0.65],  // multiplier on the weapon's cone
  bias:     [2.60, 0.45],  // deg of uncorrected aim error, re-rolled per burst (a recruit misses to one side)
  settle:   [1.10, 0.22],  // s over which that bias decays once it is shooting at you
  lead:     [0.00, 0.80],  // how much of your velocity it leads
  burst:    [1.45, 0.78],  // multiplier on burst length: sprays early, three-round answers late
  cool:     [1.55, 0.55],  // multiplier on the pause between bursts
  peek:     [0.20, 0.95],  // chance a cover fight is fought from behind the cover instead of standing on it
  hunker:   [0.55, 1.90],  // s spent down between peeks (a good one gives you almost no window)
  flank:    [0.15, 0.85],  // willingness to go around instead of trading rounds
  grenade:  [0.10, 0.90],  // willingness to throw one at all
  holdT:    [9.0, 3.0],    // s you must sit in one hole before a grenade is posted into it
  suppress: [0.00, 0.85],  // willingness to keep rounds on a position it cannot see into
  share:    [2.60, 0.35],  // s between seeing you and the contact reaching everyone else
  shareR:   [22, 55],      // m that callout carries
  earErr:   [10, 1.6],     // m of error when it works out where a noise came from
  morale:   [0.44, 0.13],  // the morale it breaks at (a recruit runs early, an elite dies in place)
  rally:    [17, 6],       // s a broken one stays broken before it comes back
  reload:   [1.30, 0.78],  // multiplier on reload time
  aim:      [1.55, 0.62],  // multiplier on the marksman's settle before the shot
  disc:     [0.10, 0.95],  // reload discipline: chance of topping up in a lull instead of running dry
  giveUp:   [15, 48],      // s of hunting an empty position before it lets go
  push:     [0.10, 0.85],  // willingness to close on a hurt or pinned player
};
export function skillProgress(tide, security, rank, pressure) {
  return clamp(Math.max(0, (tide | 0) - 1) * SKILL.tide + Math.max(0, (security | 0) - 1) * SKILL.security
    + Math.max(0, rank) * SKILL.classRank + clamp01(pressure) * SKILL.pressure, 0, SKILL.max);
}
const SKILL_KEYS = Object.keys(SKILL).filter((k) => Array.isArray(SKILL[k]));
// mix the table into `out` at progress p. `out` belongs to the mimic, so this allocates nothing.
function mixSkill(out, p) {
  for (let i = 0; i < SKILL_KEYS.length; i++) { const k = SKILL_KEYS[i], r = SKILL[k]; out[k] = r[0] + (r[1] - r[0]) * p; }
  out.p = p;
  return out;
}

// =====================================================================================================
// Shared tactical budget. Perception and firing rays are per-mimic and already bounded (see the cost note at
// the end of this file); everything ELSE that wants a raycast — cover scoring, peek validation, break-contact
// routes — draws from one per-frame pool, so six mimics cannot stampede the collision grid on a phone.
// =====================================================================================================
const TACTICAL_PER_FRAME = 8;
let losFrame = -1, losLeft = 0;
function losBudget(ctx, want) {
  if (ctx.frame !== losFrame) { losFrame = ctx.frame; losLeft = TACTICAL_PER_FRAME; }
  if (losLeft < want) return false;
  losLeft -= want; return true;
}
// recent friendly deaths, for morale. A ring of eight, written by the one that dies, read by the ones nearby.
const DEATHS = [];
function noteDeath(x, z, t) { DEATHS.push({ x, z, t }); if (DEATHS.length > 8) DEATHS.shift(); }
function deathsNear(x, z, t, r = 24, within = 14) {
  let n = 0;
  for (let i = 0; i < DEATHS.length; i++) { const d = DEATHS[i]; if (t - d.t > within || Math.hypot(d.x - x, d.z - z) > r) continue; n++; }
  return n;
}
// how long the player has held one spot — the grenade trigger. Squads keep their own; this is for the loners,
// and it is computed once a frame however many mimics ask.
const HOLD = { x: 0, z: 0, t: 0, since: 0, last: -1, frame: -1 };
function playerHold(ctx) {
  if (HOLD.frame === ctx.frame) return HOLD.t;
  HOLD.frame = ctx.frame;
  const p = ctx.player.position, now = ctx.elapsed;
  if (HOLD.last < 0 || Math.hypot(p.x - HOLD.x, p.z - HOLD.z) > 2.5) { HOLD.x = p.x; HOLD.z = p.z; HOLD.since = now; }
  HOLD.last = now; HOLD.t = now - HOLD.since;
  return HOLD.t;
}
// ---- the fields ----
// A mimic has walked past these things every day of its life. It does not path into one, it does not take a
// firing position inside one, and steering pushes it out of the edge of one — which means an anomaly is a wall
// to them as well as to you, and a wall you can use: nothing following you goes through a gravity well.
// Returns the anomaly whose radius (plus pad) contains the point, or null.
export function anomalyNear(ctx, x, z, pad = 2) {
  const list = ctx.anomalies && ctx.anomalies.list; if (!list || !list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || !a.position) continue;
    const r = (a.radius || 6) + pad;
    if (Math.abs(a.position.x - x) > r || Math.abs(a.position.z - z) > r) continue;
    if (Math.hypot(a.position.x - x, a.position.z - z) < r) return a;
  }
  return null;
}
// scratch for cover scoring; module-level so a pick allocates nothing
const CAND = []; for (let i = 0; i < 8; i++) CAND.push({ c: null, s: 0 });
let candN = 0;
function candPush(c, s) {
  if (candN < CAND.length) { CAND[candN].c = c; CAND[candN].s = s; candN++; }
  else { let worst = 0; for (let i = 1; i < candN; i++) if (CAND[i].s < CAND[worst].s) worst = i; if (s > CAND[worst].s) { CAND[worst].c = c; CAND[worst].s = s; } }
}
function candSort() { for (let i = 1; i < candN; i++) { const v = CAND[i].c, s = CAND[i].s; let j = i - 1; while (j >= 0 && CAND[j].s < s) { CAND[j + 1].c = CAND[j].c; CAND[j + 1].s = CAND[j].s; j--; } CAND[j + 1].c = v; CAND[j + 1].s = s; } }

// How a weapon class fights: gaps between rounds, string lengths, pauses, the band it wants to be in
// (`hold` = [min, max] metres), the range past which it will not bother pulling the trigger (`max`), and
// whether it closes (`close` 1), holds where it is (0), or backs off to keep its distance (-1).
function fireProfile(wdef, cdef) {
  const auto = wdef.modes.includes('auto');
  const gap = Math.max(60 / (wdef.rpm || 400), 0.075);
  const role = cdef.role, cls = wdef.cls;
  if (role === 'sniper' || (cls === 'sniper' && wdef.modes[0] === 'bolt')) return { kind: 'sniper', gap: Math.max(gap, 1.4), burst: [1, 1], cooldown: [1.6, 3.2], hold: [60, 120], max: 165, aimT: 1.2, close: -1 };
  if (cls === 'sniper') return { kind: 'sniper', gap: Math.max(gap, 0.6), burst: [1, 2], cooldown: [1.4, 2.8], hold: [45, 100], max: 150, aimT: 1.2, close: -1 };
  if (cls === 'mg' || role === 'gunner') return { kind: 'mg', gap, burst: [8, 15], cooldown: [2.0, 3.5], hold: [18, 55], max: 95, close: 0 };
  if (cls === 'shotgun') return { kind: 'shotgun', gap: Math.max(gap, wdef.modes[0] === 'pump' ? 0.7 : 0.45), burst: [2, 3], cooldown: [1.0, 1.8], hold: [4, 13], max: 26, close: 1 };
  if (cls === 'pistol') return { kind: 'semi', gap: Math.max(gap, 0.30), burst: [2, 4], cooldown: [0.9, 1.7], hold: [5, 18], max: 38, close: 1 };
  if (auto) return { kind: 'burst', gap, burst: cls === 'smg' ? [4, 7] : [3, 5], cooldown: [1.2, 2.5], hold: cls === 'smg' ? [6, 24] : [14, 45], max: cls === 'smg' ? 58 : 92, close: cls === 'smg' ? 1 : 0 };
  if (wdef.modes[0] === 'bolt') return { kind: 'semi', gap: Math.max(gap, 1.3), burst: [1, 1], cooldown: [0.8, 1.6], hold: [22, 60], max: 115, close: -1 };
  return { kind: 'semi', gap: Math.max(gap, 0.38), burst: [2, 4], cooldown: [1.0, 2.0], hold: [12, 40], max: 82, close: 0 };
}

class Mimic extends Enemy {
  constructor(ctx, position, opts = {}) {
    const tide = ctx.state.data.tideLevel || 1;
    const poi = opts.poi ? ctx.world.poi(opts.poi) : null;
    const loadout = opts.loadout || rollLoadout(opts.cls || pickClass(poi ? poi.kind : 'marsh', tide), tide);
    super(ctx, 'mimic', position, Object.assign({ hp: loadout.def.hp || 90 }, opts));
    this.radius = 0.32; this.height = STAND_H; this.speed = SPEED.patrol;
    this.loadout = loadout; this.cls = loadout.cls; this.cdef = loadout.def; this.role = loadout.def.role || null;
    this.weapon = loadout.weapon; this.wdef = WEAPONS[this.weapon.id]; this.fx = weaponEffects(this.weapon);
    this.ammoId = this.weapon.mag?.ammo || this.weapon.chamber || loadout.ammoId || defaultAmmo(this.wdef.cal);
    this.ammo = AMMO[this.ammoId] || AMMO[defaultAmmo(this.wdef.cal)];
    this.profile = fireProfile(this.wdef, this.cdef);
    this.suppressed = this.fx.noise < 0.6;
    this.shotNames = [`shot_${this.weapon.id}`, `shot_${this.wdef.build || this.weapon.id}`, SHOT_FALLBACK[this.wdef.cls] || 'shot_akm'];
    if (this.suppressed) this.shotNames.unshift(`shot_${this.weapon.id}_sup`, 'shot_suppressed');
    this.baseSpread = (this.wdef.moa * 2.2 + 2.5) * (this.cdef.accuracy || 1) * this.fx.moa;
    this.pieces = [];
    if (loadout.helmet && ARMOR[loadout.helmet.id]) this.pieces.push({ def: ARMOR[loadout.helmet.id], inst: loadout.helmet, slot: 'helmet' });
    if (loadout.vest && ARMOR[loadout.vest.id]) this.pieces.push({ def: ARMOR[loadout.vest.id], inst: loadout.vest, slot: 'vest' });
    this.grenades = loadout.grenades | 0; this.grenadeId = loadout.grenadeId; this.grenadeCool = 0;
    this.stalker = !!opts.stalker; this.provoked = false; this.closeT = 0; this.whisperT = rng.range(20, 40); this.stalkD = rng.range(60, 100); this.stalkRollT = 0;
    this.squad = null; this.orders = null; this.stunned = 0; this.wantLight = false; this.lightEntry = null; this.hasLight = this.fx.light > 0;
    const poiR = poi ? Math.min(poi.r * 0.8, 40) : 22; this.poiR = poiR;
    // ---- skill: the one curve (SKILL, above). Re-mixed every 2 s because director.pressure moves. ----
    this.rank = classRank(this.cls);
    this.skill = mixSkill({}, skillProgress(tide, ctx.state.data.securityLevel || 1, this.rank, ctx.director?.pressure || 0));
    this.skillT = rng.range(0, 2);
    // visuals
    this.buildVisuals();
    // AI state
    this.target = null; this.waitT = 0; this.turnT = 0; this.searchT = 0; this.lookYaw = 0; this.lookT = 0; this.lookPitch = 0; this.lookAbs = this.yaw;
    this.lastVisT = -1e9; this.lastAlertT = -1e9; this.losT = -1e9; this.percT = 0;
    this.burstLeft = 0; this.burstN = 0; this.shotT = 0; this.cooldown = 1.0; this.repositionT = 8; this.hitsSince = 0; this.cover = null; this.aimT = 0; this.aiming = false;
    this.reloadT = 0; this.reloadStage = 0; this.reloadPlan = null; this.dry = false; this.cycleT = 0;
    this.grenadeT = 0; this.grenadeTarget = new THREE.Vector3();
    this.radioT = rng.range(2, 8); this.glitchT = rng.range(2, 5); this.glitchLeft = 0;
    this.staggerT = 0; this.unobservedT = 0; this.obsT = 0; this.observed = true; this.skipCool = 0; this.moveSpeed = 0;
    this.staticLoop = null; this.loopRetry = 0; this.spotted = false; this.staticT = 0; this.crouch = 0;
    this.deathDuration = 2.2; this.ashDone = false; this.piled = false; this.stoppedHit = false;
    // ---- v3 tactical state ----
    this.beliefR = 0;                                   // metres of error on lastSeenPlayer (0 = actually saw you)
    this.beliefSeed = rng();                            // this mimic's own way of being wrong
    this.magCap = this.weapon.mag ? (MAGAZINES[this.weapon.mag.id]?.cap || 30) : (this.wdef.internal || 6);
    this.tgt = new THREE.Vector3(); this.reloadReturn = 'engage';
    this.morale = 1; this.moraleT = 0; this.rallyT = 0; this.calledHelp = false; this.hurtT = -1e9;
    this.peekPos = new THREE.Vector3(); this.hunkerPos = new THREE.Vector3(); this.posture = 'open';   // open | hunker | peek
    this.postureFor = new THREE.Vector3(); this.postureSet = false;
    this.postureT = 0; this.coverT = -1e9; this.coverGood = false; this.coverCrouch = false; this.exposed = 1; this.disciplined = false;
    this.suppressT = 0; this.suppressLeft = 0; this.suppressPos = new THREE.Vector3();
    this.aimBiasY = 0; this.aimBiasP = 0; this.biasAge = 0; this.reactT = 0;
    this.searchNodes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.searchN = 0; this.searchI = 0; this.overwatchT = 0; this.listenT = 0; this.overwatchPending = false;
    this.soloRole = null; this.soloRoleT = -1e9; this.flankSide = rng.chance(0.5) ? 1 : -1;
    this.shareT = -1e9; this.litT = -1e9; this.tacReloadT = 0; this.radioSaidT = -1e9;
    this.detour = new THREE.Vector3(); this.detourT = 0; this.stuckT = 0; this.nodeT = 0;
    this._mvTarget = new THREE.Vector3(); this._mvWanted = false;
    this.lookPt = new THREE.Vector3(); this.lookValid = false;   // where it is actually looking (never through a wall)
    this.setState(this.stalker ? 'stalk' : opts.idle ? 'idle' : 'watch');
    this.waitT = rng.range(5, 16); this.lookT = rng.range(1, 3);
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
    this.animate(0.016, 0, {});
  }
  buildVisuals() {
    const lo = this.loadout;
    let hr = null;
    try { hr = buildHumanoid({ loadout: lo, height: 1.8 }); } catch (e) { hr = null; }
    if (!hr || hr.stub) {
      if (hr && hr.dispose) hr.dispose();
      this.material = makeBodyMaterial({ albedo: 0.02 });
      this.rig = new LegacyRig(this.material);
    } else {
      this.rig = hr; this.material = hr.material || null;
    }
    this.matU = this.material?.userData?.u || null;
    this.root.add(this.rig.root);
    this.rigBones = this.rig.bones || {};
    // the gun in the right hand: gunmesh's low LOD when it exists, the legacy silhouette otherwise
    let gun = null;
    try { gun = buildGun(this.weapon.id, { lod: 'lo', inst: this.weapon }); } catch (e) { gun = null; }
    if (gun) { gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); }
    this.gun = gun;
    this.rig.attach?.(gun);
    this.muzzleObj = gun ? (gun.getObjectByName('muzzle') || gun) : (this.rig.rig?.muzzle || null);
    // worn armour
    this.rig.wear?.(lo.vest?.id || null, lo.helmet?.id || null, null);
    // the face blot on the head
    this.face = makeFace(0.24, 3.0); this.root.add(this.face); this.faceU = this.face.material.uniforms;
    this.headBone = this.rigBones.head || null;
    // marksman tell: a lens glint (and a laser line when the loadout has one)
    if (this.profile.kind === 'sniper' || this.fx.laser) {
      const tex = glowTexture();
      this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.4, 2.2, 1.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.glint.scale.setScalar(0.22); this.glint.visible = false; this.glint.renderOrder = 5;
      (this.muzzleObj || this.root).add(this.glint); this.glint.position.set(0, 0.05, 0.15);
    }
    if (this.fx.laser) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      this.laser = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.1), transparent: true, opacity: 0.8, fog: false, depthWrite: false }));
      this.laser.frustumCulled = false; this.laser.visible = false; this.ctx.scene.add(this.laser);
    }
  }
  get eyeY() { return this.position.y + this.height * 0.9; }

  // ---- what it believes ----
  // The mimic's whole model of you is `lastSeenPlayer` plus `beliefR`, the metres it may be wrong by. Only a
  // sighting sets beliefR to 0; everything else — a shot heard, a radio call, a round in the vest — hands it a
  // guess. The offset is stable per mimic and per second, so two of them guess two different wrong places and
  // neither of them walks onto your feet.
  believe(pos, radius, t, weight = 0.5) {
    if (!pos) return;
    if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3();
    // a sighting in the last second and a bit outranks anybody's guess
    if (radius > 0.05 && t - this.lastVisT < 1.2) return;
    if (radius > 0.05 && radius > this.beliefR + 3 && t - this.lastSeenT < 2.5) return;
    if (radius > 0.05) {
      const a = (this.beliefSeed + Math.floor(t * 0.7) * 0.317) * TAU;
      const rr = radius * (0.3 + 0.7 * Math.abs(Math.sin(this.beliefSeed * 37.1 + Math.floor(t * 0.7))));
      this.lastSeenPlayer.set(pos.x + Math.cos(a) * rr, pos.y, pos.z + Math.sin(a) * rr);
    } else this.lastSeenPlayer.copy(pos);
    this.lastSeenT = t; this.beliefR = Math.max(0, radius);
  }
  // Hearing. Footsteps carry 14 m; gunfire carries as far as the round was loud (the Director scales its reach
  // by the shot's noise, so a suppressed weapon is a third of the problem). What it learns is where the NOISE
  // was, with an error that shrinks along the skill curve — not where you are standing now.
  playerAudibility() {
    const d = this.distanceToPlayer(), t = this.time, s = this.skill;
    const steps = d < 14 ? this.player.noise * (1 - d / 14) : 0;
    const dir = this.ctx.director;
    const shots = dir && dir.nearestShot ? dir.nearestShot(this.position, 55, _bel) : 0;
    if (shots > 0.05) {
      this.believe(_bel, s.earErr * (1.15 - shots * 0.55), t, 0.55);
      if (this.aware < 0.45) this.aware = 0.45;
    } else if (steps > 0.14) {
      this.believe(this.player.position, s.earErr * 0.5 * (1.1 - steps * 0.6), t, 0.35);
    }
    return clamp01(steps * 1.2 + shots * 1.6);
  }
  // Vision. Smoke blocks it. At night your torch is not just extra range for it — a beam swung across a mimic
  // is a contact, and it knows it has been lit.
  playerVisibility(fovDeg, maxDay) {
    const p = this.player; if (p.dead || p.inBase) return 0;
    const w = this.ctx.world;
    if (w.smokeBlocks && w.smoke && w.smoke.length && w.smokeBlocks(this.eyePos(_v), p.eye)) return 0;
    let vis = super.playerVisibility(fovDeg, maxDay);
    const night = this.ctx.time.night;
    if (vis > 0 && night > 0.3 && this.ctx.state.data.flashlight.on) {
      const dx = this.position.x - p.eye.x, dz = this.position.z - p.eye.z;
      const dl = Math.hypot(dx, dz) || 1;
      const facing = (dx / dl) * p.forward.x + (dz / dl) * p.forward.z;
      if (facing > 0.80 && dl < 75) { vis = clamp01(vis + (facing - 0.80) * 3.4 * night); this.litT = this.time; }
    }
    return vis;
  }
  // Awareness integrator. Same contract as the base class, except hearing no longer hands over your position:
  // playerAudibility has already filed its guess through believe().
  perceive(dt, opts = {}) {
    const vis = this.playerVisibility(opts.fov, opts.maxDay);
    const hear = this.playerAudibility(opts.hearing);
    const gain = Math.max(vis * (opts.visGain ?? 1.4), hear * (opts.hearGain ?? 1.0));
    if (gain > 0.02) this.aware = clamp01(this.aware + gain * dt);
    else this.aware = Math.max(0, this.aware - dt * (opts.decay ?? 0.08));
    if (vis > 0.05) { this.believe(this.player.position, 0, this.time, 1); this.lastVisT = this.time; }
    if (this.aware >= 1 && !this.engaged) { this.engaged = true; this.ctx.director?.notify('spotted', { enemy: this }); this.onSpotted?.(); }
    if (this.aware <= 0.05 && this.engaged) { this.engaged = false; this.ctx.director?.notify('lost', { enemy: this }); }
    return { vis, hear };
  }
  onSpotted() {
    const s = this.skill;
    this.sound('mimic_spot', { gain: 0.9, max: 80 });
    // reaction time — the seconds between "there" and the first round. Most of the early game lives here.
    this.reactT = s.react * rng.range(0.8, 1.25);
    this.cooldown = this.reactT * (this.profile.kind === 'sniper' ? 1.25 : 1);
    this.hitsSince = 0; this.repositionT = rng.range(6, 10);
    this.spotted = true; this.radioT = Math.min(this.radioT, 0.6);
    this.shareT = this.time + s.share * rng.range(0.7, 1.3);   // the callout is not instant either
    this.rollBias(); this.posture = 'open';
    if (this.squad) this.squad.notify('spotted', this); else this.pickCover(this.wantFlank(), { force: true });
    this.setState('engage');
  }
  // ---- armour: real vests and helmets from the catalogue, resolved like the player's ----
  zoneOf(info) {
    const pt = info.point;
    if (!pt) return info.headshot ? 'head' : 'torso';
    const h01 = clamp01((pt.y - this.position.y) / this.height);
    let lat = 0.3;
    const ox = pt.x - this.position.x, oz = pt.z - this.position.z;
    let dx = info.dir ? info.dir.x : pt.x - this.player.eye.x, dz = info.dir ? info.dir.z : pt.z - this.player.eye.z;
    const dl = Math.hypot(dx, dz); if (dl > 1e-4) { dx /= dl; dz /= dl; lat = clamp01(Math.abs(ox * dz - oz * dx) / this.radius); }
    return zoneFromHit(h01, lat);
  }
  armorPieces() { return this.pieces; }
  damage(amount, info = {}) {
    if (!this.alive) return false;
    if (this.stalker && !this.provoked && (!info.source || info.source === 'player' || info.source === this.player)) this.provoked = true;
    if (info.kind === 'blast') { if (info.grenade && info.source && info.source.type === 'mimic') amount *= 0.35; if (this.loadout.helmet) amount *= 0.9; return super.damage(amount, info); }
    if (info.kind === 'melee' || info.kind === 'slash' || info.kind === 'shock') return super.damage(amount, info);
    // v2 ballistics hands over the round and where it landed (amount = base x falloff, no zone multiplier);
    // older callers pass a finished amount with a headshot flag
    const v2 = info.h01 != null;
    const zone = v2 ? (info.zone || zoneFromHit(info.h01, info.lateral01 ?? 0.3)) : this.zoneOf(info);
    const given = info.ammo ? (typeof info.ammo === 'string' ? AMMO[info.ammo] : info.ammo) : null;
    const headMult = !v2 && info.headshot ? 1.8 : 1;
    let a, mult = 1;
    if (given) { a = given; mult = amount > 0 && given.damage > 0 ? amount / (given.damage * headMult) : 1; }
    else a = { damage: amount / headMult, pen: info.pen ?? 3, kind: 'fmj' };
    const r = resolveHit(a, zone, this.pieces, { mult });
    this.stoppedHit = false;
    if (r.armorHit && r.armorHit.inst) {
      r.armorHit.inst.durability = Math.max(0, (r.armorHit.inst.durability ?? r.armorHit.def.durability) - r.armorDamage);
      if (!r.penetrated) {
        this.stoppedHit = true;
        this.sound(zone === 'head' ? 'helmet_ring' : 'armor_hit', { gain: 0.9, max: 70 });
        if (info.point) { _n.copy(info.dir || _dir.set(0, 0, 1)).negate(); this.ctx.vfx.spark?.(info.point, _n, zone === 'head' ? 10 : 6, [1.0, 0.8, 0.5]); }
      } else if (this.ctx.audio.has?.('armor_pen')) this.sound('armor_pen', { gain: 0.6, max: 50 });
    }
    this.lastZone = zone;
    return super.damage(r.damage, info);
  }
  onHit(amount, info) {
    if (this.stoppedHit) { this.sound('mimic_hit', { gain: 0.35, rate: 0.7 }); this.rig.flinch = 0.4; }
    else { this.sound('mimic_hit', { gain: 0.8 }); if (this.rig.rig) this.rig.rig.flinch = 1; }
    this.staggerT = this.stoppedHit ? 0.12 : 0.3; this.hitsSince++;
    // Being hit does not tell it where you are. If it cannot see you it works back along the round and takes
    // THAT with an error — shoot from a hedge at eighty metres and it hunts the hedge, not your boots.
    const seen = this.time - this.lastVisT < 0.6;
    if (seen) this.believe(this.player.position, 0, this.time, 1);
    else {
      if (info && info.dir) {
        const dl = Math.hypot(info.dir.x, info.dir.z) || 1;
        const back = clamp(this.distanceToPlayer(), 8, 70);
        _bel.set(this.position.x - (info.dir.x / dl) * back, this.player.position.y, this.position.z - (info.dir.z / dl) * back);
      } else _bel.copy(this.player.position);
      this.believe(_bel, Math.max(3, this.skill.earErr * 0.75), this.time, 0.9);
    }
    this.hurtT = this.time;
    this.morale = clamp01(this.morale - (this.stoppedHit ? 0.05 : 0.10 + amount / Math.max(40, this.maxHp)));
    if (this.alive && this.state !== 'engage' && this.state !== 'fallback' && !this.stalker) this.aware = 1;
    if (this.squad) this.squad.notify('hit', this);
    this.rig.rig?.startGlitch(0.6); this.glitchLeft = 0.08; this.rig.setState?.({ hit: 1 });
  }
  onDeath() {
    noteDeath(this.position.x, this.position.z, this.time);
    this.sound('mimic_death', { gain: 1.0 });
    this.target = null; this.wantLight = false;
    if (this.lightEntry) releaseLight(this.ctx, this.lightEntry);
    if (this.laser) this.laser.visible = false; if (this.glint) this.glint.visible = false;
    if (this.squad) this.squad.notify('killed', this);
    this.rig.setState?.({ dead: true, speed: 0, aiming: 0 });
  }
  deathTick(dt) {
    const t = this.deathT, rig = this.rig;
    if (rig.legacy) {
      const R = rig.rig, B = R.B;
      // fold inward over 0.6 s: knees give, spine curls, arms drop, the whole thing narrows
      const f = clamp01(t / 0.6), fe = 1 - Math.pow(1 - f, 3);
      B.thL.rotation.x = 0.9 * fe; B.thR.rotation.x = 0.8 * fe; B.snL.rotation.x = -1.9 * fe; B.snR.rotation.x = -1.7 * fe;
      B.hips.position.y = R.rest.hips.y - 0.62 * fe; B.hips.rotation.x = -0.35 * fe;
      B.spine.rotation.x = -0.55 * fe; B.chest.rotation.x = -0.7 * fe; B.neck.rotation.x = -0.5 * fe;
      B.gun.rotation.x = -0.42 - 0.9 * fe; B.gun.position.y = R.gunRest.y - 0.25 * fe;
      B.gun.updateMatrix();
      R.solveArm(B.shL, B.foL, R.shPosL, _v.copy(R.gripL).applyMatrix4(B.gun.matrix), -1);
      R.solveArm(B.shR, B.foR, R.shPosR, _v.copy(R.gripR).applyMatrix4(B.gun.matrix), 1);
      R.mesh.scale.set(1 - 0.25 * fe, 1, 1 - 0.2 * fe);
      if (rig.gear) rig.gear.scale.copy(R.mesh.scale);
    } else rig.update?.(dt);
    this.faceU.uFade.value = Math.max(0, 1 - t / 0.35);
    if (this.matU) this.matU.uTime.value = this.time;
    if (rig.gearMat) rig.gearMat.userData.u.uTime.value = this.time;
    this.faceU.uTime.value = this.time;
    if (t >= 0.6) {
      if (!this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.3, this.position.z), 90); rig.root.traverse((o) => { if (o.isMesh) o.castShadow = false; }); }
      const dv = clamp01((t - 0.6) / 1.2);
      if (this.matU) { this.matU.uDissolve.value = dv; this.matU.uShiver.value = 1 + (t - 0.6) * 2; }
      if (rig.gearMat) rig.gearMat.userData.u.uDissolve.value = dv;
      if (this.gun) { this.gun.visible = dv < 0.7; }
      if (!this.matU) rig.root.visible = dv < 0.8;
    }
    this.face.visible = t < 0.4;
    // what it carried stays where it folded
    if (t >= 1.75 && !this.piled) {
      this.piled = true;
      const drops = dropsFor(this.loadout);
      if (drops.length && this.ctx.loot?.spawnPile) { try { this.ctx.loot.spawnPile(_v.set(this.position.x, this.groundY, this.position.z).clone(), drops); } catch (e) { console.warn('loot.spawnPile failed', e); } }
      this.drops = drops;
    }
  }
  onDispose() {
    this.face.material.dispose(); this.rig.dispose?.();
    if (this.lightEntry) releaseLight(this.ctx, this.lightEntry);
    if (this.laser) { this.ctx.scene.remove(this.laser); this.laser.geometry.dispose(); this.laser.material.dispose(); }
    if (this.glint) this.glint.material.dispose();
    if (this.squad) this.squad.remove(this);
  }

  // ---- helpers ----
  faceAngleTo(x, z) { return angleDelta(this.yaw, Math.atan2(-(x - this.position.x), -(z - this.position.z))); }
  walkablePoint(x, z, out) {
    const w = this.ctx.world;
    if (Math.abs(x) > w.half - 6 || Math.abs(z) > w.half - 6) return null;
    if (w.isWater(x, z)) return null;
    const y = w.groundHeight(x, z, w.getHeight(x, z) + 2).y;
    if (w.pointInSolid(x, y + 0.6, z)) return null;
    if (w.isInBase(_v2.set(x, y, z))) return null;
    if (anomalyNear(this.ctx, x, z, 2.2)) return null;   // it lives here; it does not walk into the fields
    return out.set(x, y, z);
  }
  pickPatrolPoint() {
    const w = this.ctx.world;
    const near = [];
    for (const c of w.coverPoints) { if (Math.hypot(c.x - this.home.x, c.z - this.home.z) < this.poiR && c.distanceTo(this.position) > 4) near.push(c); }
    if (near.length && rng.chance(0.55)) return rng.pick(near).clone();
    const p = w.randomPoint(rng, this.home.x, this.home.z, this.poiR) || this.home.clone();
    if (p.distanceTo(this.position) < 3) return this.home.clone();
    return p;
  }
  setTarget(v) { if (v) { this.tgt.copy(v); this.target = this.tgt; } else this.target = null; return this.target; }
  wantFlank() { return this.profile.close >= 0 && rng.chance(this.skill.flank); }

  // ---- not walking into walls ----
  // moveToward (enemies/common.js) is pure steering: pointed straight at a wall it presses into it forever,
  // and a hunt that ends with a mimic nose-first against a barn is not a hunt. Every state's movement goes
  // through this override, so when nothing is actually moving it commits to a detour a few metres to one side
  // and follows THAT until it is round the obstruction.
  moveToward(target, speed, dt, opts = {}) {
    const dist = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    if (dist > 2.5) { this._mvWanted = true; this._mvTarget.copy(target); }
    if (this.detourT > 0 && dist > 3) { super.moveToward(this.detour, speed, dt, opts); return dist; }
    const rem = super.moveToward(target, speed, dt, opts);
    // hard guarantee, whatever the steering did: it does not end a step inside a field. If avoidance has
    // pushed it into the edge of one, it is pushed straight back out along the radius.
    const a = anomalyNear(this.ctx, this.position.x, this.position.z, 1.2);
    if (a) {
      const dx = this.position.x - a.position.x, dz = this.position.z - a.position.z;
      const dl = Math.hypot(dx, dz) || 1, r = (a.radius || 6) + 1.2;
      this.position.x = a.position.x + (dx / dl) * r; this.position.z = a.position.z + (dz / dl) * r;
      this.stuckT = 1.2;   // and it counts as being stopped, so it looks for a way round rather than pressing on
    }
    return rem;
  }
  stuckTick(dt, moved) {
    const target = this._mvWanted ? this._mvTarget : null;
    this._mvWanted = false;
    if (this.detourT > 0) {
      this.detourT -= dt;
      if (this.detourT <= 0 || Math.hypot(this.position.x - this.detour.x, this.position.z - this.detour.z) < 1.3) { this.detourT = 0; this.stuckT = 0; }
      return;
    }
    if (!target || this.staggerT > 0 || this.posture === 'hunker') { this.stuckT = 0; return; }
    this.stuckT = moved < 0.4 * dt ? this.stuckT + dt : 0;      // under 0.4 m/s counts as going nowhere
    if (this.stuckT < 1.2) return;
    this.stuckT = 0;
    const dx = target.x - this.position.x, dz = target.z - this.position.z;
    const dl = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? this.flankSide : -this.flankSide;
      const px = (-dz / dl) * s, pz = (dx / dl) * s;
      for (let i = 0; i < DETOUR_R.length; i++) {
        const r = DETOUR_R[i];
        if (!this.walkablePoint(this.position.x + px * r + (dx / dl) * 1.5, this.position.z + pz * r + (dz / dl) * 1.5, _v2)) continue;
        this.detour.copy(_v2); this.detourT = 3.5; this.flankSide = s; return;
      }
    }
    this.flankSide = -this.flankSide;
    this.nodeT = 1e3;   // nothing works from here: give up on this waypoint entirely
  }

  // ---- cover ----
  // Cover is not "a rock near me". A point is worth taking when STANDING on it gives a firing angle and
  // DROPPING behind it takes that angle away; setupPosture then works out which of the two ways it does that.
  // Candidates are scored without any rays; only the best four cost one each, and a pick takes the whole
  // per-frame tactical budget or waits for the next frame, so a squad of six cannot stampede the grid.
  pickCover(flank, opts = {}) {
    const ctx = this.ctx, w = ctx.world, p = this.player.position, t = this.time;
    if (t - this.coverT < (opts.force ? 0.9 : 2.4)) return false;
    if (!losBudget(ctx, TACTICAL_PER_FRAME)) return false;   // a cover pick owns the frame's rays or waits
    this.coverT = t;
    const eye = _v3.set(p.x, p.y + this.player.eyeHeight, p.z);
    const hold = this.profile.hold;
    const near = opts.maxD ?? 26;
    const lo = Math.max(4, hold[0] * 0.6), hi = Math.max(20, hold[1]);
    const mid = (hold[0] + Math.min(hi, hold[1])) * 0.5;
    const curA = Math.atan2(this.position.z - p.z, this.position.x - p.x);
    candN = 0;
    const cps = w.coverPoints;
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      const dm = Math.hypot(c.x - this.position.x, c.z - this.position.z); if (dm > near || dm < 1.2) continue;
      const dp = Math.hypot(c.x - p.x, c.z - p.z); if (dp < lo || dp > hi) continue;
      if (anomalyNear(ctx, c.x, c.z, 2.2)) continue;
      if (this.cover && !opts.force && Math.hypot(c.x - this.cover.x, c.z - this.cover.z) < 2) continue;
      const ang = Math.abs(angleDelta(curA, Math.atan2(c.z - p.z, c.x - p.x)));
      let s = -Math.abs(dp - mid) * 0.12 - dm * 0.06;
      if (flank) s += (ang > 28 * DEG && ang < 75 * DEG) ? 2.2 : -ang * 0.6;
      else s += -ang * 0.35;
      candPush(c, s);
    }
    if (candN) {
      candSort();
      const n = Math.min(candN, 4);
      for (let i = 0; i < n; i++) {
        const c = CAND[i].c;
        if (!w.lineOfSight(_v.set(c.x, c.y + 1.55, c.z), eye)) continue;
        if (!this.cover) this.cover = new THREE.Vector3();
        this.cover.copy(c); this.setupPosture(eye); this.setTarget(this.hunkerPos);
        return true;
      }
    }
    return this.improviseCover(flank, eye);
  }
  // No cover point works: pick open ground at the range this weapon wants, on the flank if it is minded to.
  improviseCover(flank, eye) {
    const w = this.ctx.world, p = this.player.position, hold = this.profile.hold;
    const curA = Math.atan2(this.position.z - p.z, this.position.x - p.x);
    const d = clamp(this.distanceToPlayer(), Math.max(7, hold[0]), Math.max(16, hold[1] * 0.7));
    for (let i = 0; i < 4; i++) {
      const off = flank ? (rng.chance(0.5) ? 1 : -1) * rng.range(30, 65) * DEG : rng.range(-20, 20) * DEG;
      const a = curA + off + (i > 3 ? rng.range(-1, 1) : 0);
      const pt = this.walkablePoint(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, _v2);
      if (!pt) continue;
      if (!w.lineOfSight(_post.set(pt.x, pt.y + 1.6, pt.z), eye)) continue;
      this.cover = null; this.coverGood = false; this.posture = 'open'; this.setTarget(pt);
      return true;
    }
    this.target = null; return false;
  }
  // How to fight from `this.cover`. Two shapes of cover, both real:
  //   vertical (a low wall, a bonnet, a berm) — crouching behind it breaks the sightline; it fights down and up.
  //   lateral  (a corner, a trunk, a truck)   — one shoulder of it is in shadow; it fights in and out.
  // Costs at most 3 rays and leaves peekPos as the place it stands to shoot, `cover` as the place it hides.
  setupPosture(eye) {
    const w = this.ctx.world, c = this.cover, p = this.player.position;
    this.coverGood = false; this.coverCrouch = false; this.posture = 'open';
    this.peekPos.copy(c); this.hunkerPos.copy(c);
    this.postureFor.copy(c); this.postureSet = true;
    if (!w.lineOfSight(_v.set(c.x, c.y + CROUCH_EYE, c.z), eye)) { this.coverGood = true; this.coverCrouch = true; return; }
    let dx = c.x - p.x, dz = c.z - p.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const px = -dz * 0.9, pz = dx * 0.9;
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? this.flankSide : -this.flankSide;
      const hx = c.x + px * s, hz = c.z + pz * s;
      if (!this.walkablePoint(hx, hz, _v2)) continue;
      if (w.lineOfSight(_v.set(hx, _v2.y + 1.45, hz), eye)) continue;
      this.hunkerPos.copy(_v2); this.coverGood = true; this.coverCrouch = false; return;
    }
    // nothing here casts a shadow: it is a firing position, not cover. Stand and trade, and move on sooner.
    this.repositionT = Math.min(this.repositionT, rng.range(2.5, 4.5));
  }
  // The squad hands out cover points of its own (squad.js orderBase/orderFlank/orderWatch). Whenever the point
  // under our feet changes, work the posture out again — one budgeted call, not one a frame.
  refreshPosture() {
    if (!this.cover) { this.postureSet = false; this.coverGood = false; return; }
    if (this.postureSet && this.postureFor.distanceToSquared(this.cover) < 0.4) return;
    if (!losBudget(this.ctx, 3)) return;
    const p = this.player;
    this.setupPosture(_v3.set(p.position.x, p.position.y + p.eyeHeight, p.position.z));
  }
  // The peek cycle: down behind it, up for a burst, down again. Returns whether it may shoot this frame.
  // A recruit barely bothers (SKILL.peek 0.2) and stands there to be shot; an elite gives you a half second.
  postureTick(dt) {
    const s = this.skill;
    if (!this.cover || !this.coverGood) { if (this.posture !== 'open') { this.posture = 'open'; } this.exposed = damp(this.exposed, 1, 7, dt); return true; }
    if (Math.hypot(this.position.x - this.cover.x, this.position.z - this.cover.z) > 2.4) { this.posture = 'open'; this.exposed = damp(this.exposed, 1, 7, dt); return true; }
    if (this.posture === 'open') {
      this.disciplined = rng.chance(s.peek);
      this.posture = this.disciplined ? 'hunker' : 'peek';
      this.postureT = this.disciplined ? s.hunker * rng.range(0.6, 1.4) : 0;
    }
    if (this.posture === 'hunker') {
      this.postureT -= dt;
      this.exposed = damp(this.exposed, 0, 7, dt);
      if (this.postureT <= 0 && this.roundsLeft() > 0 && !this.dry && this.cooldown <= 0.2) { this.posture = 'peek'; this.postureT = 0; this.disciplined = rng.chance(s.peek); }
      return false;
    }
    this.postureT += dt;
    this.exposed = damp(this.exposed, 1, 8, dt);
    // a disciplined one goes back down the moment its burst is spent; an undisciplined one stands there
    const spent = this.burstLeft === 0 && this.cooldown > 0.25;
    if (this.postureT > (this.disciplined ? 3.6 : 9) || (this.disciplined && this.postureT > 0.55 && spent) || this.roundsLeft() === 0) {
      this.posture = 'hunker'; this.postureT = s.hunker * rng.range(0.6, 1.4);
    }
    return this.exposed > 0.5;
  }
  // Where it wants its feet this frame given the posture. Writes into _post and returns it, or null.
  posturePoint() {
    if (!this.cover || !this.coverGood) return null;
    return _post.copy(this.posture === 'peek' ? this.peekPos : this.hunkerPos);
  }

  // ---- the radio ----
  // Call the contact in. The delay and the reach are on the curve: an early mimic shouts to whoever is nearly
  // on top of it, two and a half seconds late; a late one puts the whole treeline onto you in a third of one.
  alertPack(mult = 1, quiet = false) {
    const t = this.time, s = this.skill;
    const bel = this.lastSeenPlayer; if (!bel) return;
    const R = s.shareR * mult;
    this.ctx.director?.notify('contact', { pos: bel, weight: clamp01(0.95 - this.beliefR * 0.03), radius: this.beliefR });
    if (this.squad) this.squad.notify('spotted', this);
    let n = 0, side = this.flankSide;
    for (const e of this.ctx.enemies.list) {
      if (e === this || !e.alive || (e.type !== 'mimic' && e.type !== 'seeker') || e.stalker) continue;
      if (e.position.distanceTo(this.position) > R) continue;
      if (e.aware < 0.65) e.aware = 0.65;
      if (e.believe) e.believe(bel, this.beliefR + 2, t, 0.7);
      else { if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3(); e.lastSeenPlayer.copy(bel); e.lastSeenT = t; }
      // a loose role for mimics with nobody to give them one: the near one trades, the rest go around
      if (e.type === 'mimic' && !e.squad && t - e.soloRoleT > 4) {
        const mine = Math.hypot(this.position.x - bel.x, this.position.z - bel.z);
        const theirs = Math.hypot(e.position.x - bel.x, e.position.z - bel.z);
        e.soloRole = theirs > mine + 4 ? 'flank' : 'base'; e.soloRoleT = t; e.flankSide = side; side = -side;
      }
      if (++n >= 8) break;
    }
    // Nothing here moved without a noise. If the call actually reached somebody, the handset was keyed, and
    // you can hear it: information in this game never travels silently between two of them.
    if (n > 0 && !quiet && !this.stalker && t - this.radioSaidT > 2.5) {
      this.radioSaidT = t;
      this.sound('mimic_radio', { gain: 0.72, max: Math.max(70, R + 25), rate: 1.08 });
    }
  }
  muzzleWorld(out, dirOut) {
    const o = this.muzzleObj;
    if (o) { o.updateWorldMatrix(true, false); out.setFromMatrixPosition(o.matrixWorld); if (dirOut) dirOut.set(-o.matrixWorld.elements[8], -o.matrixWorld.elements[9], -o.matrixWorld.elements[10]).normalize(); return out; }
    this.eyePos(out); out.y -= 0.3; if (dirOut) dirOut.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); return out;
  }
  syncRoot() { this.root.position.copy(this.position); this.root.rotation.y = this.yaw; }
  onStateChange(s) {
    if (s !== 'engage') { this.suppressLeft = 0; this.suppressT = 0; }
    if (s !== 'engage' && s !== 'reload' && s !== 'grenade') { this.posture = 'open'; this.exposed = 1; }
    if (s === 'engage' || s === 'search') this.aiming = false;
  }
  // ---- the weapon ----
  roundsLeft() { return roundsInGun(this.weapon); }
  spreadDeg(first) {
    const p = this.player;
    let s = this.baseSpread * this.skill.spread;
    if (this.moveSpeed > 0.5) s *= 1.6;
    if (p.moving) s *= p.sprinting ? 1.45 : 1.2;
    if (first && (this.profile.kind === 'semi' || this.profile.kind === 'sniper')) s *= 0.7;
    if (this.crouch > 0.5) s *= 0.85;
    s += this.burstN * (this.profile.kind === 'mg' ? 0.25 : 0.4);
    return s;
  }
  // A fresh burst starts from a fresh wrong place. The bias decays over SKILL.settle, so a good mimic walks
  // rounds onto you inside a second and a recruit empties a magazine a metre to your left and never notices.
  rollBias() {
    const b = this.skill.bias * DEG;
    this.aimBiasY = (Math.random() * 2 - 1) * b;
    this.aimBiasP = (Math.random() * 2 - 1) * b * 0.55;
    this.biasAge = 0;
  }
  // aimAt: a world point. `wide` adds degrees (suppression sprays). `lead` allows it to lead your velocity.
  fireOne(muzzle, aimAt, first, wide = 0, lead = false) {
    const p = this.player, ctx = this.ctx, s = this.skill;
    _aim.copy(aimAt);
    if (lead && s.lead > 0.01) {
      const flight = Math.max(0.05, _aim.distanceTo(muzzle) / 430);
      _aim.x += p.velocity.x * flight * s.lead; _aim.z += p.velocity.z * flight * s.lead;
    }
    _dir.subVectors(_aim, muzzle).normalize();
    if (this.aimBiasY || this.aimBiasP) {
      const k = Math.exp(-this.biasAge / Math.max(0.05, s.settle));
      _right.crossVectors(_dir, UP); if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0); _right.normalize();
      _upv.crossVectors(_right, _dir);
      _dir.addScaledVector(_right, Math.tan(this.aimBiasY * k)).addScaledVector(_upv, Math.tan(this.aimBiasP * k)).normalize();
    }
    const spread = this.spreadDeg(first) + wide;
    const ammo = this.ammo, range = this.profile.kind === 'sniper' ? 160 : this.profile.kind === 'shotgun' ? 25 : 70;
    if (ctx.ballistics && !ctx.ballistics.isStub) ctx.ballistics.shoot(muzzle, _dir, { source: 'enemy', damage: ammo.damage, ammo, ammoId: this.ammoId, shooter: this, spreadDeg: spread, pellets: ammo.pellets || 1, range, cls: this.wdef.cls, tracer: this.suppressed ? false : undefined, kind: 'bullet', weapon: this.weapon, what: this.cdef.name });
    else for (let i = 0; i < (ammo.pellets || 1); i++) enemyShoot(ctx, this, muzzle, _dir, ammo.damage, spread + (ammo.spread || 0));
    consumeRound(this.weapon);
    if (!this.suppressed || Math.random() < 0.3) ctx.vfx.muzzleFlash(muzzle, _dir);
    const noise = this.fx.noise;
    playAny(ctx, this.shotNames, { pos: muzzle, gain: this.suppressed ? 0.35 : 1.0, max: this.suppressed ? 70 : 240, ref: this.suppressed ? 3 : 4, rate: this.suppressed ? 0.85 : 1 });
    if (this.rig.rig) this.rig.rig.kick = 1; this.rig.setState?.({ hit: 0, kick: 1 });
    this.burstN++;
    this.weapon.dirt = Math.min(1, (this.weapon.dirt || 0) + 0.004);
  }
  // Reload discipline. A mimic with any of it does not empty the magazine into a wall and then stand there
  // working the bolt: it tops up in the lull, down behind the cover or with the sightline broken. A recruit
  // (SKILL.disc 0.10) almost never does, and running it dry is how you beat one.
  wantTacticalReload(vis) {
    if (this.dry || this.reloadPlan || this.burstLeft > 0) return false;
    const left = this.roundsLeft();
    if (left === 0) return true;
    if (left > this.magCap * 0.34) return false;
    if (!bestSpare(this.loadout) && !(this.wdef.internal && this.loadout.loose > 0)) return false;
    const safe = (this.posture === 'hunker' && this.exposed < 0.55) || (vis <= 0.02 && this.time - this.lastVisT > 1.2);
    if (!safe) return false;
    if (this.time < this.tacReloadT) return false;
    this.tacReloadT = this.time + 5;
    return rng.chance(this.skill.disc);
  }
  // reload behind cover: 2.4 s of audible mechanics in which it does not fire (the tell)
  beginReload() {
    const w = this.weapon, wd = this.wdef;
    this.reloadT = 0; this.reloadStage = 0; this.burstLeft = 0; this.aiming = false; this.suppressLeft = 0;
    if (wd.internal && !wd.defaultMag) { // tubes and break-open: shells one at a time from the loose rounds
      if (this.loadout.loose <= 0) { this.dry = true; return false; }
      this.reloadPlan = { kind: wd.modes[0] === 'break' ? 'break' : 'tube', n: Math.min(wd.internal - w.tube.length, this.loadout.loose, wd.modes[0] === 'break' ? 2 : 4), done: 0 };
    } else {
      const spare = bestSpare(this.loadout);
      if (!spare) { this.dry = true; return false; }
      this.reloadPlan = { kind: wd.clip ? 'clip' : 'mag', spare };
    }
    this.setState('reload');
    return true;
  }
  reloadTick(dt) {
    const pl = this.reloadPlan; if (!pl) { this.setState('engage'); return; }
    const t0 = this.reloadT; this.reloadT += dt / Math.max(0.4, this.skill.reload); const t = this.reloadT;
    const at = (x) => t0 < x && t >= x;
    const w = this.weapon;
    if (pl.kind === 'mag') {
      if (at(0.05)) this.sound('reload_magout', { gain: 0.7, max: 45 });
      if (at(1.3)) this.sound('reload_magin', { gain: 0.7, max: 45 });
      if (at(2.0) && !w.chamber) this.sound('reload_chamber', { gain: 0.6, max: 40 });
      if (t >= 2.4) { const old = w.mag; w.mag = pl.spare; const i = this.loadout.mags.indexOf(pl.spare); if (i >= 0) this.loadout.mags.splice(i, 1); if (old) this.loadout.mags.push(old); w.chamber = w.mag.ammo; this.ammoId = w.mag.ammo || this.ammoId; this.ammo = AMMO[this.ammoId] || this.ammo; this.finishReload(); }
    } else if (pl.kind === 'clip') {
      if (at(0.05)) this.sound('bolt_open', { gain: 0.7, max: 45 });
      if (at(0.9) || at(1.25) || at(1.6)) this.sound('mag_load_round', { gain: 0.5, max: 35 });
      if (at(2.1)) this.sound('bolt_close', { gain: 0.7, max: 45 });
      if (t >= 2.4) { const i = this.loadout.mags.indexOf(pl.spare); if (i >= 0) this.loadout.mags.splice(i, 1); w.mag = pl.spare; w.chamber = w.mag.ammo; this.finishReload(); }
    } else if (pl.kind === 'break') {
      if (at(0.05)) this.sound('break_open', { gain: 0.7, max: 45 });
      if (at(0.9) || at(1.5)) { this.sound('shell_insert', { gain: 0.6, max: 35 }); if (pl.done < pl.n && this.loadout.loose > 0) { w.tube.push(this.ammoId); this.loadout.loose--; pl.done++; } }
      if (at(2.1)) this.sound('break_close', { gain: 0.7, max: 45 });
      if (t >= 2.4) { w.chamber = w.tube.length ? this.ammoId : null; this.finishReload(); }
    } else { // tube: one shell per 0.55 s
      const k = Math.floor(t / 0.55);
      if (k > pl.done && pl.done < pl.n && this.loadout.loose > 0) { this.sound('shell_insert', { gain: 0.6, max: 35 }); w.tube.push(this.ammoId); this.loadout.loose--; pl.done++; }
      if (pl.done >= pl.n || this.loadout.loose <= 0) { if (t >= pl.n * 0.55 + 0.6) { if (this.wdef.modes[0] === 'pump') this.sound('bolt_close', { gain: 0.6, max: 40 }); w.chamber = w.tube.length ? this.ammoId : null; this.finishReload(); } }
    }
  }
  finishReload() {
    this.reloadPlan = null; this.dry = false;
    this.cooldown = rng.range(0.3, 0.9) * this.skill.cool; this.rollBias();
    const back = this.reloadReturn || 'engage'; this.reloadReturn = 'engage';
    this.setState(back);
  }
  // the gun's low ready between shots for bolt/pump actions
  cycleAfterShot() {
    const m = this.wdef.modes[0];
    if (m === 'bolt') { this.cycleT = Math.max(0.9, this.profile.gap - 0.3); this.sound('bolt_open', { gain: 0.6, max: 40 }); this.cycleSound = 'bolt_close'; }
    else if (m === 'pump') { this.cycleT = 0.55; this.cycleSound = 'bolt_close'; }
    else if (m === 'break' && this.roundsLeft() === 0) { this.cycleT = 0; }
  }
  // Grenades. Two reasons to post one: it can see you and wants you out of there, or — the one that matters —
  // it CANNOT see you, it knows which hole you went into, and you have been sitting in it. Willingness and the
  // patience it needs before it bothers are both on the curve; a recruit almost never throws.
  canThrowGrenade(d) {
    const s = this.skill, ctx = this.ctx, o = this.orders;
    if (this.grenades <= 0 || this.stunned > 0 || this.stalker) return false;
    // the squad has told him to post one in (squad.js). The call went out a second ago; he does not re-decide.
    if (o && o.frag > 0 && this.time >= o.frag) {
      if (this.time > o.frag + 8 || d < 5 || d > 34 || !this.lastSeenPlayer || this.time - this.lastSeenT > 12) { o.frag = 0; return false; }
      return true;
    }
    if (d < 6 || d > 28) return false;
    const sq = ctx.squads;
    if (sq && !sq.canThrow(this)) return false;
    if (!sq && this.grenadeCool > 0) return false;
    if (!this.lastSeenPlayer || this.time - this.lastSeenT > 9) return false;
    if ((sq ? sq.playerHoldT : playerHold(ctx)) < s.holdT) return false;
    if (!rng.chance(s.grenade)) return false;
    const p = this.player;
    this.eyePos(_v);
    if (ctx.world.lineOfSight(_v, p.eye) || ctx.world.lineOfSight(_v2.set(_v.x, _v.y + 1.3, _v.z), _v3.set(p.eye.x, p.eye.y + 0.8, p.eye.z))) return true;
    // blind: it will arc one onto the last place it had you, if that place is worth trusting
    return this.time - this.lastVisT < 14 && this.beliefR < 5;
  }
  beginGrenade() {
    this.grenadeT = 0; this.burstLeft = 0; this.aiming = false;
    if (this.orders) this.orders.frag = 0;
    const at = this.time - this.lastVisT < 1 ? this.player.position : (this.lastSeenPlayer || this.player.position);
    this.grenadeTarget.copy(at).add(_v.set(rng.range(-1.5, 1.5), 0, rng.range(-1.5, 1.5)));
    playAny(this.ctx, ['grenade_pin', 'click'], { pos: this.position, hrtf: true, gain: 0.8, max: 40, rate: 0.8 });
    this.sound('mimic_radio', { gain: 0.7, max: 70, rate: 1.15 });
    if (!this.squad) this.grenadeCool = 40;
    this.setState('grenade');
  }
  grenadeTick(dt) {
    this.grenadeT += dt;
    this.faceToward(this.grenadeTarget.x, this.grenadeTarget.z, dt, 8);
    if (this.grenadeT >= 1.0) {
      this.grenades--;
      this.syncRoot(); this.eyePos(_v); _v.y -= 0.2; _v.x -= Math.sin(this.yaw) * 0.4; _v.z -= Math.cos(this.yaw) * 0.4;
      this.ctx.squads?.throwGrenade(this, _v, this.grenadeTarget, this.grenadeId);
      this.rig.rig?.startGlitch(0.5); this.glitchLeft = 0.06;
      this.cooldown = 1.2; this.setState('engage');
    }
  }
  trySkip(dt) {
    if (this.skipCool > 0 || !this.target || this.state === 'idle' || this.state === 'watch' || this.state === 'reload' || this.state === 'grenade') return;
    const d = this.distanceToPlayer(); if (d < 12 || d > (this.stalker ? 110 : 70) || this.unobservedT < 2) return;
    if (this.state === 'patrol' && d > 45) return;
    if (Math.random() > 1 - Math.pow(this.orders && this.orders.role === 'flank' ? 0.55 : 0.75, dt)) return;
    const dx = this.target.x - this.position.x, dz = this.target.z - this.position.z; const rem = Math.hypot(dx, dz);
    const step = Math.min(rng.range(4, 8), rem - 1); if (step < 2.5) return;
    const nx = this.position.x + (dx / rem) * step, nz = this.position.z + (dz / rem) * step;
    if (Math.hypot(nx - this.player.position.x, nz - this.player.position.z) < 9) return;
    const pt = this.walkablePoint(nx, nz, _v); if (!pt) return;
    const ox = this.position.x, oy = this.position.y, oz = this.position.z;
    this.position.copy(pt);
    if (this.observedByPlayer(62)) { this.position.set(ox, oy, oz); return; }
    this.ctx.vfx.ash(_v2.set(ox, oy + 0.6, oz), 10);
    this.sound('mimic_skip', { gain: 0.7, max: 60 });
    this.skipCool = 3; this.unobservedT = 0; this.rig.rig?.startGlitch(0.8); this.glitchLeft = 0.07; this.rig.setState?.({ glitch: 1 });
  }
  // squad orders -> movement target for this frame; returns the role
  applyOrders() {
    const o = this.orders; if (!o || !this.squad) return null;
    if (o.hasTarget) this.setTarget(o.target);
    else if (o.hold) this.target = null;
    return o.role;
  }
  // sniper range keeping: back off under 55 m to a far spot with a line of sight, close in beyond 130 m
  holdRange(d, dt) {
    const hold = this.profile.hold, p = this.player.position, sq = this.ctx.squads;
    if (this.target) return;
    if (d < hold[0] - 5) {
      const c = sq ? sq.bestCover(this.position, 60, (c, dm) => { const dp = Math.hypot(c.x - p.x, c.z - p.z); if (dp < hold[0] || dp > hold[1]) return null; return -dm * 0.1 - Math.abs(dp - (hold[0] + hold[1]) * 0.5) * 0.05; }, true, 1.6) : null;
      if (c) { this.setTarget(c); return; }
      _dir.set(this.position.x - p.x, 0, this.position.z - p.z).normalize();
      const pt = this.walkablePoint(this.position.x + _dir.x * 25, this.position.z + _dir.z * 25, _v); if (pt) this.setTarget(pt);
    } else if (d > hold[1] + 10) {
      _dir.set(p.x - this.position.x, 0, p.z - this.position.z).normalize();
      const pt = this.walkablePoint(this.position.x + _dir.x * 20, this.position.z + _dir.z * 20, _v); if (pt) this.setTarget(pt);
    }
  }

  // ---- morale ----
  // Hit points, friends folding beside it, rounds coming from somewhere it cannot answer, being alone and
  // being empty. Below SKILL.morale it breaks contact — and calls it in on the way out, which is how a fight
  // you were winning turns into a fight with the next two squads.
  updateMorale(dt) {
    this.moraleT -= dt; if (this.moraleT > 0) return;
    const step = 0.5; this.moraleT = step;
    const t = this.time, hpF = clamp01(this.hp / this.maxHp);
    let friends = 0;
    if (this.squad) friends = Math.max(0, this.squad.alive - 1);
    else for (const e of this.ctx.enemies.list) { if (e !== this && e.alive && e.type === 'mimic' && e.position.distanceTo(this.position) < 28) { if (++friends >= 3) break; } }
    const dn = deathsNear(this.position.x, this.position.z, t);
    const target = clamp01(0.20 + hpF * 0.62 + Math.min(friends, 3) * 0.10 + this.skill.p * 0.24 + this.rank * 0.03
      - dn * 0.20 - (t - this.hurtT < 3 ? 0.14 : 0) - (this.dry ? 0.16 : 0));
    this.morale = damp(this.morale, target, 1.1, step);
  }
  // Somewhere out of the sightline, away from the player, that it can reach. One ray when the budget allows.
  breakPoint() {
    const w = this.ctx.world, p = this.player.position;
    const away = Math.atan2(this.position.z - p.z, this.position.x - p.x);
    const eye = _v3.set(p.x, p.y + this.player.eyeHeight, p.z);
    const canRay = losBudget(this.ctx, 3);
    for (let i = 0; i < 5; i++) {
      const a = away + rng.range(-0.7, 0.7);
      const r = rng.range(18, 34);
      const pt = this.walkablePoint(this.position.x + Math.cos(a) * r, this.position.z + Math.sin(a) * r, _v2);
      if (!pt) continue;
      if (canRay && i < 3 && w.lineOfSight(_post.set(pt.x, pt.y + 1.5, pt.z), eye)) continue;   // still in the open
      return this.setTarget(pt);
    }
    _dir.set(this.position.x - p.x, 0, this.position.z - p.z).normalize();
    const pt = this.walkablePoint(this.position.x + _dir.x * 22, this.position.z + _dir.z * 22, _v2);
    return pt ? this.setTarget(pt) : null;
  }
  beginBreak() {
    this.rallyT = this.skill.rally * rng.range(0.8, 1.25);
    this.calledHelp = false; this.burstLeft = 0; this.aiming = false;
    this.cover = null; this.coverGood = false; this.posture = 'open'; this.exposed = 1;
    this.breakPoint();
    this.sound('mimic_radio', { gain: 0.9, max: 100, rate: 1.3 });
    this.setState('fallback');
  }

  // ---- suppression ----
  // Rounds onto the position it last believed you held, so you cannot lean back out of it. It costs real
  // ammunition out of a real magazine, so it will not do it under half a magazine, and a recruit never does.
  wantSuppress(d, vis) {
    const s = this.skill;
    if (s.suppress < 0.05 || this.dry || this.stalker) return false;
    if (this.profile.kind === 'sniper' || this.profile.kind === 'shotgun') return false;
    if (vis > 0.02 || this.time - this.lastVisT < 0.7) return false;
    if (!this.lastSeenPlayer || this.time - this.lastSeenT > 7) return false;
    if (d > this.profile.max * 0.8 || d < 5) return false;
    if (this.roundsLeft() < Math.max(4, this.magCap * 0.45)) return false;
    if (this.beliefR > 6) return false;
    return rng.chance(s.suppress * 0.6);
  }
  // Covering fire. The squad has given this man an ARC — the ground a friend is crossing — and he cannot see
  // the player. He puts rounds into the arc rather than watching his mate run across it. It costs him real
  // rounds out of a real magazine, so only a squad with somebody running it spends them this way.
  wantCover(vis) {
    const o = this.orders;
    if (!o || !o.hasSector || this.dry || this.stalker) return false;
    if (this.profile.kind === 'sniper' || this.profile.kind === 'shotgun') return false;
    if (vis > 0.02 || this.time - this.lastVisT < 0.7) return false;
    if (this.roundsLeft() < Math.max(3, this.magCap * 0.3)) return false;
    const d = Math.hypot(o.sector.x - this.position.x, o.sector.z - this.position.z);
    if (d > this.profile.max * 0.9 || d < 3) return false;
    return rng.chance(clamp01(0.3 + this.skill.suppress * 0.7));
  }
  beginSuppress(at) {
    this.suppressPos.copy(at || this.lastSeenPlayer);
    this.suppressPos.y += 1.1;
    this.suppressLeft = Math.max(2, Math.round(rng.int(this.profile.burst[0], this.profile.burst[1]) * this.skill.burst));
    this.suppressT = 0; this.burstN = 0; this.rollBias();
    this.sound('mimic_radio', { gain: 0.6, max: 80, rate: 1.1 });
  }

  // ---- the hunt ----
  // Losing you is not forgetting you. Clear the contact itself, then the two nearest pieces of cover in the
  // arc it came from, then the place someone would have run to — pausing at each one to listen. It finishes by
  // watching the ground from cover, silent, which is when most people stand up.
  planSearch() {
    const w = this.ctx.world, ls = this.lastSeenPlayer || this.position;
    this.searchN = 0; this.searchI = 0; this.nodeT = 0;
    const spread = clamp(4 + this.beliefR, 4, 16);
    this.searchNodes[this.searchN++].copy(ls);
    const base = Math.atan2(this.position.z - ls.z, this.position.x - ls.x);
    const cps = w.coverPoints;
    candN = 0;
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      const dp = Math.hypot(c.x - ls.x, c.z - ls.z); if (dp > spread + 9 || dp < 2) continue;
      if (anomalyNear(this.ctx, c.x, c.z, 2.2)) continue;
      const a = Math.abs(angleDelta(base, Math.atan2(c.z - ls.z, c.x - ls.x)));
      candPush(c, -dp * 0.1 - a * 0.35);
    }
    candSort();
    const take = Math.min(candN, 2);
    for (let i = 0; i < take && this.searchN < this.searchNodes.length; i++) this.searchNodes[this.searchN++].copy(CAND[i].c);
    const px = ls.x - Math.cos(base) * (spread + 7), pz = ls.z - Math.sin(base) * (spread + 7);
    if (this.searchN < this.searchNodes.length && this.walkablePoint(px, pz, _v2)) this.searchNodes[this.searchN++].copy(_v2);
  }
  // Somewhere to watch the contact from: cover within 30 m of here with a sightline onto the last known spot,
  // 8-45 m off it. Four rays at most, budgeted. It walks there and then goes quiet.
  pickOverwatch() {
    const ctx = this.ctx, w = ctx.world, ls = this.lastSeenPlayer;
    if (!ls || !losBudget(ctx, 4)) return false;
    const eye = _v3.set(ls.x, ls.y + 1.4, ls.z);
    candN = 0;
    const cps = w.coverPoints;
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      const dm = Math.hypot(c.x - this.position.x, c.z - this.position.z); if (dm > 30) continue;
      const dp = Math.hypot(c.x - ls.x, c.z - ls.z); if (dp < 8 || dp > 45) continue;
      if (anomalyNear(ctx, c.x, c.z, 2.2)) continue;
      candPush(c, -dm * 0.08 - Math.abs(dp - 22) * 0.06);
    }
    if (!candN) return false;
    candSort();
    const n = Math.min(candN, 4);
    for (let i = 0; i < n; i++) {
      const c = CAND[i].c;
      if (!w.lineOfSight(_v.set(c.x, c.y + 1.5, c.z), eye)) continue;
      if (!this.cover) this.cover = new THREE.Vector3();
      this.cover.copy(c); this.hunkerPos.copy(c); this.peekPos.copy(c);
      this.coverGood = false; this.postureSet = false;
      this.searchNodes[0].copy(c); this.searchN = 1; this.searchI = 0; this.listenT = 0; this.nodeT = 0;
      this.overwatchPending = true;
      return true;
    }
    return false;
  }

  // ---- AI ----
  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time;
    this.followGround(dt);
    const d = this.distanceToPlayer();
    // flashbang: stands still, blind, silent
    if (this.stunned > 0) {
      this.stunned -= dt; this.aware = 0; this.engaged = false; this.burstLeft = 0; this.aiming = false; this.wantLight = false;
      if (this.glitchLeft <= 0 && rng.chance(0.3)) { this.rig.rig?.startGlitch(0.9); this.glitchLeft = 0.05; }
      this.animate(dt, d, { headYaw: Math.sin(t * 7) * 0.4, speed: 0 });
      return;
    }
    // The one curve, re-mixed every 2 s: director.pressure moves DURING a fight, so a loud contact in a deep
    // Tide sharpens the mimics that are still standing rather than only the next batch.
    this.skillT -= dt;
    if (this.skillT <= 0) {
      this.skillT = 2;
      const sd = ctx.state.data;
      mixSkill(this.skill, skillProgress(sd.tideLevel || 1, sd.securityLevel || 1, this.rank, ctx.director?.pressure || 0));
    }
    this.updateMorale(dt);
    // Perception, on a cadence rather than every frame: 0.12 s in a fight, 0.2 s suspicious, 0.35 s idle.
    // Two rays a call is the budget, so an idle mimic beside you costs about six rays a second, not a hundred.
    let vis = 0;
    if (this.stalker && this.state === 'stalk') { this.aware = Math.max(this.aware, 0.55); this.believe(p.position, 0, t, 1); }
    else {
      this.percT += dt;
      const every = this.engaged ? 0.12 : this.aware > 0.35 ? 0.2 : 0.35;
      if (this.percT >= every) { const r = this.perceive(this.percT, { fov: 150, maxDay: 80, visGain: 1.5, hearGain: 1.2, decay: 0.08 }); vis = r.vis; this.percT = 0; }
      else vis = t - this.lastVisT < 0.25 ? 0.5 : 0;
    }
    if (vis > 0.02 || this.burstLeft > 0) this.biasAge += dt;
    // Certainty decays. Squads write their shared point straight into lastSeenPlayer (squad.js), and a round in
    // the vest hands over a direction, not a grid reference: anything it has not actually SEEN in the last
    // second is a guess, and suppression and blind grenades treat it as one.
    if (t - this.lastVisT > 1.2 && this.beliefR < 2.5) this.beliefR = 2.5;
    if (this.state === 'suspicious' && this.stateT < 2.5 && vis < 0.6 && this.hitsSince === 0 && this.aware > 0.95) this.aware = 0.95;
    this.skipCool = Math.max(0, this.skipCool - dt); this.staggerT = Math.max(0, this.staggerT - dt); this.grenadeCool = Math.max(0, this.grenadeCool - dt);
    this.obsT += dt; if (this.obsT > (this.engaged ? 0.22 : 0.15)) { this.obsT = 0; this.observed = this.observedByPlayer(); }
    this.unobservedT = this.observed ? 0 : this.unobservedT + dt;
    // the contact call: not instant, and it reaches as far as this mimic is good (SKILL.share / shareR)
    if (this.shareT > 0 && t >= this.shareT) { this.shareT = -1e9; this.alertPack(1, true); this.radioSaidT = t; this.sound('mimic_radio', { gain: 0.8, max: 90, rate: 1.12 }); }

    const prevX = this.position.x, prevZ = this.position.z;
    let headYaw = 0, headPitch = 0, aim = 0, aimPitch = 0, aimYaw = 0, speed = 0, track = false, crouch = 0;
    // global state promotion; a retreating or ambushing squad member stays in engage and holds its orders
    const role = this.orders && this.squad ? this.orders.role : null;
    const holdRole = role === 'ambush' || role === 'regroup';
    const fixed = this.state === 'reload' || this.state === 'grenade' || this.state === 'fallback';
    if (holdRole && !fixed && this.state !== 'engage') this.setState('engage');
    else if (this.engaged && t - this.lastVisT < 6 && !fixed && this.state !== 'engage' && this.state !== 'stalk') this.setState('engage');
    else if (!this.engaged && this.aware >= 0.4 && !fixed && (this.state === 'patrol' || this.state === 'watch' || this.state === 'idle')) { this.setState('suspicious'); this.turnT = 1.2; this.target = null; if (!this.squad) this.sound('mimic_radio', { gain: 0.5, max: 70 }); this.radioT = rng.range(4, 9); }

    switch (this.state) {
      case 'idle': {
        this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(2.5, 7); this.lookYaw = rng.chance(0.4) ? 0 : rng.range(-1.1, 1.1); }
        headYaw = this.lookYaw;
        break;
      }
      case 'watch': {
        this.waitT -= dt;
        this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(1.5, 3.5); this.lookYaw = rng.range(-1.2, 1.2); this.lookPitch = rng.range(-0.15, 0.1); }
        headYaw = this.lookYaw; headPitch = this.lookPitch;
        if (this.waitT <= 0) { this.setState('patrol'); this.target = null; }
        break;
      }
      case 'patrol': {
        if (!this.target) this.target = this.pickPatrolPoint();
        if (this.staggerT <= 0) { const rem = this.moveToward(this.target, SPEED.patrol, dt, { stop: 0.7 }); if (rem <= 0.7 || this.stateT > 45) { this.target = null; this.setState('watch'); this.waitT = rng.range(3, 8); this.lookT = 0; } }
        headYaw = Math.sin(t * 0.35 + this.glitchT * 0.1) * 0.25;
        break;
      }
      case 'suspicious': {
        // It heard something. It goes to look — but at the NOISE, wide of it by however wrong it is, and it
        // stops short of the spot rather than walking onto it.
        const ls = this.lastSeenPlayer || p.position;
        if (this.turnT > 0) { this.turnT -= dt; this.faceToward(ls.x, ls.z, dt, 4); headYaw = this.faceAngleTo(ls.x, ls.z) * 0.6; }
        else {
          const stop = clamp(2.5 + this.beliefR * 0.35, 2.5, 8);
          if (!this.target) { this.setTarget(ls); this.waitT = 0; }
          const rem = this.staggerT > 0 ? 99 : this.moveToward(this.target, SPEED.suspicious, dt, { stop });
          if (rem <= stop) {
            this.waitT += dt; this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(1, 2.5); this.lookYaw = rng.range(-1.3, 1.3); }
            headYaw = this.lookYaw;
            if (this.waitT > 4) {
              if (this.aware < 0.4) { this.setState('patrol'); this.target = null; }
              else if (this.lastSeenPlayer && this.lastSeenPlayer.distanceTo(this.target) > 3) { this.setTarget(this.lastSeenPlayer); this.waitT = 0; }
              else { this.setState('search'); this.searchT = 0; this.searchN = 0; this.target = null; }
            }
          } else headYaw = this.faceAngleTo(this.target.x, this.target.z) * 0.5;
        }
        aim = 0.5;
        if (this.aware < 0.25 && this.stateT > 6) { this.setState('patrol'); this.target = null; }
        break;
      }
      case 'stalk': {
        // shadows the player from behind, out of sight; never first to fire
        const night = ctx.time.night > 0.5;
        this.stalkRollT -= dt; if (this.stalkRollT <= 0) { this.stalkRollT = rng.range(15, 25); this.stalkD = night ? rng.range(18, 25) : rng.range(60, 100); }
        const want = this.stalkD;
        if (d <= 25 && night) this.closeT += dt; else this.closeT = Math.max(0, this.closeT - dt * 0.5);
        if (this.provoked || this.closeT > 20) { this.aware = 1; this.engaged = true; this.stalker = false; this.sound('mimic_spot', { gain: 0.9, max: 80 }); this.rollBias(); this.cooldown = this.skill.react; this.pickCover(this.wantFlank(), { force: true }); this.setState('engage'); break; }
        _dir.set(-p.forward.x, 0, -p.forward.z);
        const side = Math.sin(t * 0.07) * 12;
        if (!this.target) this.target = new THREE.Vector3();
        if (!this.walkablePoint(p.position.x + _dir.x * want - _dir.z * side, p.position.z + _dir.z * want + _dir.x * side, this.target)) this.target.copy(p.position).addScaledVector(_dir, want);
        const rem = Math.hypot(this.target.x - this.position.x, this.target.z - this.position.z);
        if (this.observed && d < 90) { this.faceToward(p.position.x, p.position.z, dt, 3); }   // seen: it stands and looks back
        else if (rem > 3) { const sp = rem > 25 ? SPEED.engage : rem > 8 ? SPEED.stalk : SPEED.patrol; if (this.staggerT <= 0) this.moveToward(this.target, sp, dt, { stop: 2 }); }
        else this.faceToward(p.position.x, p.position.z, dt, 2);
        track = true;
        this.whisperT -= dt; if (this.whisperT <= 0) { this.whisperT = rng.range(30, 60); if (d < 110) this.sound('mimic_radio', { gain: 0.32, max: 110, rate: 0.72 }); }
        break;
      }
      case 'reload': {
        // Reloading is a window and it knows it: it gets behind something first if it can, and it gives ground
        // if you are close and there is nothing to get behind.
        const atCov = !!this.cover && this.position.distanceTo(this.cover) < 2;
        aim = 0.3; crouch = atCov ? 1 : 0.4; track = true;
        if (this.staggerT <= 0) {
          if (!atCov && this.cover && this.position.distanceTo(this.cover) < 22) this.moveToward(this.coverGood ? this.hunkerPos : this.cover, SPEED.engage, dt, { stop: 0.5, face: false });
          else if (!this.cover && d < 12) { _dir.set(this.position.x - p.position.x, 0, this.position.z - p.position.z).normalize(); this.moveToward(_v.set(this.position.x + _dir.x * 6, this.position.y, this.position.z + _dir.z * 6), SPEED.suspicious, dt, { stop: 0.5, face: false }); }
        }
        const la = this.lastSeenPlayer || p.position;
        this.faceToward(la.x, la.z, dt, 4);
        this.reloadTick(dt);
        break;
      }
      case 'grenade': {
        aim = 0.2; track = true;
        this.grenadeTick(dt);
        break;
      }
      case 'engage': {
        aim = 1; track = true;
        const s = this.skill;
        const ambush = role === 'ambush';
        // lost you: the hunt, not amnesia. A mimic that is deliberately down behind cover cannot see you by
        // design — give it longer before it decides you have gone, or it would hunt its own hiding place.
        const holding = this.coverGood && !!this.cover && Math.hypot(this.position.x - this.cover.x, this.position.z - this.cover.z) < 2.4;
        if ((t - this.lastVisT > (holding ? 12 : 6) || !this.engaged) && !holdRole) { this.setState('search'); this.searchN = 0; this.searchI = 0; this.searchT = 0; this.waitT = 0; this.listenT = 0; this.overwatchT = 0; this.aiming = false; this.target = null; break; }
        // morale: break contact, call it in on the way out, come back with whoever heard
        if (!holdRole && !ambush && this.morale < s.morale && this.stateT > 1.2) { this.beginBreak(); break; }
        if (!this.squad && t - this.lastAlertT > 2) { this.lastAlertT = t; this.alertPack(); }
        // ---- where to be ----
        if (this.squad) this.applyOrders();
        else {
          this.repositionT -= dt;
          if ((this.repositionT <= 0 || this.hitsSince >= 2) && this.profile.kind !== 'sniper') {
            this.hitsSince = 0; this.repositionT = rng.range(5, 9);
            if (this.pickCover(this.soloRole === 'flank' || this.wantFlank())) this.radioT = Math.min(this.radioT, 0.4);
          }
        }
        this.refreshPosture();
        if (this.profile.kind === 'sniper') this.holdRange(d, dt);
        // the band this weapon wants to fight in: a shotgunner and an SMG close, a marksman keeps its distance,
        // and anything with the nerve for it (SKILL.push) closes on a player it can see is hurt
        const wantsClose = this.profile.close > 0 || (p.hp < 45 && p.hp > 0 && rng.chance(s.push * dt * 0.5));
        if (wantsClose && d > this.profile.hold[1] && !ambush && (!this.squad || role !== 'watch')
            && (!this.cover || Math.hypot(this.cover.x - p.position.x, this.cover.z - p.position.z) > this.profile.hold[1] * 1.3)) {
          _dir.set(this.position.x - p.position.x, 0, this.position.z - p.position.z).normalize();
          this.setTarget(_v.set(p.position.x + _dir.x * this.profile.hold[0], p.position.y, p.position.z + _dir.z * this.profile.hold[0]));
          this.cover = null; this.coverGood = false; this.posture = 'open';
        }
        // ---- posture: down behind the cover, up for a burst, down again ----
        const atCover = !!this.cover && Math.hypot(this.position.x - this.cover.x, this.position.z - this.cover.z) < 2.4;
        const postureOk = this.postureTick(dt);
        // a mimic that is deliberately down behind its cover still counts as holding a good position, so the
        // squad (squad.js orderBase) does not re-shuffle it every three seconds for not shooting
        if (vis > 0.02 || (this.coverGood && atCover)) this.losT = t;
        const stand = atCover ? this.posturePoint() : null;
        const moveTo = stand || this.target;
        const stop = stand ? 0.16 : 0.6;
        // Nobody with a rifle wants to be standing on you. A shotgunner will come to arm's length; everybody
        // else gives ground rather than closing inside four metres, which is what stops a firefight ending
        // with four men pressed against the player's chest.
        const minStand = this.profile.kind === 'shotgun' ? 2.4 : 4.2;
        if (d < minStand && this.staggerT <= 0 && !ambush && role !== 'ambush') {
          _dir.set(this.position.x - p.position.x, 0, this.position.z - p.position.z);
          if (_dir.lengthSq() < 0.01) _dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          _dir.normalize();
          const pt = this.walkablePoint(p.position.x + _dir.x * (minStand + 3.5), p.position.z + _dir.z * (minStand + 3.5), _v);
          if (pt) this.moveToward(pt, SPEED.engage, dt, { stop: 0.4, face: false });
          crouch = 0;
        } else if (moveTo && this.staggerT <= 0 && !ambush) {
          const rem = this.moveToward(moveTo, stand ? SPEED.posture : (role === 'watch' ? SPEED.suspicious : SPEED.engage), dt, { stop, face: false });
          if (!stand && rem <= stop) { this.target = null; if (this.orders) this.orders.hasTarget = false; }
        }
        if (this.coverGood && atCover) { crouch = (1 - this.exposed) * (this.coverCrouch ? 0.95 : 0.5); aim = 0.35 + 0.65 * this.exposed; }
        else if (atCover && this.moveSpeed < 0.3 && this.profile.kind !== 'shotgun') crouch = 0.6;
        // ---- where it is looking ----
        // Not at you. At you IF it can see you; at the arc the squad gave it while a friend crosses; otherwise
        // at the place it last believed you were. A mimic that tracks your feet through a barn wall is the
        // single most obvious tell that an enemy is cheating, and this is where that stops.
        const seeing = vis > 0.02 || t - this.lastVisT < 1.0;
        const ord = this.orders;
        if (seeing) this.lookPt.set(p.position.x, p.eye.y - 0.25, p.position.z);
        else if (ord && ord.hasSector && this.suppressLeft > 0) this.lookPt.set(ord.sector.x, ord.sector.y + 1.2, ord.sector.z);
        else if (this.lastSeenPlayer) this.lookPt.set(this.lastSeenPlayer.x, this.lastSeenPlayer.y + 1.4, this.lastSeenPlayer.z);
        else if (ord && ord.hasSector) this.lookPt.set(ord.sector.x, ord.sector.y + 1.2, ord.sector.z);
        // nothing at all: it watches its own arc, not you. A planted ambush that tracks you through a wall is
        // not an ambush, it is a turret with a story.
        else this.lookPt.set(this.position.x - Math.sin(this.yaw) * 20, this.position.y + 1.5, this.position.z - Math.cos(this.yaw) * 20);
        this.lookValid = true;
        this.faceToward(this.lookPt.x, this.lookPt.z, dt, seeing ? 9 : 4.5);
        // ---- is it allowed to act? base and arrived flankers are; watchers and moving flankers only when pressed ----
        let mayAct = true;
        if (role === 'flank') mayAct = this.orders.fire || d < 12 || this.hitsSince > 0;
        else if (role === 'watch') mayAct = d < 18 || this.hitsSince > 0;
        else if (ambush) mayAct = d < 15 || this.hitsSince > 0;
        else if (role === 'regroup') mayAct = d < 10 || this.hitsSince > 0;
        else if (this.soloRole === 'flank' && t - this.soloRoleT < 12 && this.moveSpeed > 1.2 && d > 18) mayAct = this.hitsSince > 0;
        let mayFire = mayAct && postureOk && !this.dry;
        if (this.profile.kind === 'mg' && !atCover && this.moveSpeed > 0.5) mayFire = false;
        aimPitch = Math.atan2(this.lookPt.y - (this.position.y + 1.5), Math.max(1, Math.hypot(this.lookPt.x - this.position.x, this.lookPt.z - this.position.z)));
        aimYaw = this.faceAngleTo(this.lookPt.x, this.lookPt.z);
        if (ambush && mayFire) { this.orders.role = 'base'; this.squad.state = 'combat'; this.squad.radioT = 0.2; }
        // the between-burst clock runs even while it is down behind the cover: that is what it is waiting on
        if (this.burstLeft === 0 && this.suppressLeft === 0 && this.cycleT <= 0) this.cooldown -= dt;
        // ---- ammunition: top up in the lull rather than running dry in the open ----
        if (this.wantTacticalReload(vis)) { this.reloadReturn = 'engage'; if (this.beginReload()) break; }
        // ---- grenade: out of that hole, please. It throws from behind the cover, not from on top of it ----
        if (mayAct && !ambush && !this.dry && this.burstLeft === 0 && this.suppressLeft === 0 && this.cooldown < 0.5 && this.canThrowGrenade(d)) { this.beginGrenade(); break; }
        // ---- the trigger ----
        if (this.cycleT > 0) { this.cycleT -= dt; if (this.cycleT <= 0 && this.cycleSound) { this.sound(this.cycleSound, { gain: 0.6, max: 40 }); this.cycleSound = null; } }
        else if (!p.dead && d < this.profile.max && this.staggerT <= 0 && mayFire) {
          if (this.suppressLeft > 0) {
            // suppression: rounds onto the position it believes you are in. No line of sight, and none faked —
            // the rounds go where it thinks you are and hit whatever is actually there.
            this.suppressT -= dt;
            if (this.suppressT <= 0) {
              this.syncRoot(); this.muzzleWorld(_v4);
              this.fireOne(_v4, this.suppressPos, this.burstN === 0, 1.3, false);
              this.suppressLeft--; this.suppressT = this.profile.gap;
              if (this.roundsLeft() === 0) this.suppressLeft = 0;
              if (this.suppressLeft === 0) {
                this.cooldown = rng.range(this.profile.cooldown[0], this.profile.cooldown[1]) * s.cool * 1.5;
                if (this.wdef.modes[0] === 'bolt' || this.wdef.modes[0] === 'pump') this.cycleAfterShot();
              }
            }
          } else if (this.burstLeft > 0) {
            this.shotT -= dt;
            if (this.shotT <= 0) {
              this.syncRoot(); this.muzzleWorld(_v4);
              _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.62, p.position.z);
              const los = ctx.world.lineOfSight(_v4, _v3);
              if (los) { this.losT = t; this.fireOne(_v4, _v3, this.burstN === 0, 0, true); this.burstLeft--; this.shotT = this.profile.gap; if (this.roundsLeft() === 0) this.burstLeft = 0; if (this.burstLeft > 0 && this.wdef.modes[0] === 'bolt') this.cycleAfterShot(); }
              else { this.burstLeft = 0; }
              if (this.burstLeft === 0) { this.cooldown = rng.range(this.profile.cooldown[0], this.profile.cooldown[1]) * s.cool + (this.moveSpeed > 0.5 ? 0.5 : 0); if (this.wdef.modes[0] === 'bolt' || this.wdef.modes[0] === 'pump') this.cycleAfterShot(); this.aiming = false; }
            }
          } else if (this.profile.kind === 'sniper') {
            // the marksman: a still second of glint and (with a laser) a red line, then the shot
            if (!this.aiming) { if (this.cooldown <= 0 && vis > 0.02 && this.moveSpeed < 0.3) { this.aiming = true; this.aimT = 0; this.rollBias(); } }
            else {
              this.aimT += dt;
              if (vis <= 0 && t - this.lastVisT > 0.5) this.aiming = false;
              else if (this.aimT >= this.profile.aimT * s.aim) { this.burstLeft = 1; this.burstN = 0; this.shotT = 0; }
            }
          } else {
            if (this.cooldown <= 0) {
              if (vis > 0.02 || (this.profile.kind === 'mg' && t - this.lastVisT < 4)) {
                this.burstLeft = Math.max(1, Math.round(rng.int(this.profile.burst[0], this.profile.burst[1]) * s.burst));
                this.burstN = 0; this.shotT = 0; this.rollBias();
              } else if (this.wantSuppress(d, vis)) this.beginSuppress();
              else if (this.wantCover(vis)) this.beginSuppress(this.orders.sector);
            }
          }
        }
        break;
      }
      case 'fallback': {
        // Broken. It is not routing — it is breaking contact the way a person does: backwards, fast, calling
        // it in, reloading on the move, and still dangerous if you walk into it. Then it comes back.
        aim = 0.3; this.rallyT -= dt;
        if (!this.calledHelp && this.stateT > 0.4) {
          this.calledHelp = true;
          this.alertPack(1.5, true); this.radioSaidT = t;
          this.sound('mimic_radio', { gain: 0.9, max: 110, rate: 1.38 });   // "falling back" — the same word the squads use
        }
        if (!this.target) this.breakPoint();
        if (this.target && this.staggerT <= 0) { const rem = this.moveToward(this.target, SPEED.break, dt, { stop: 1.0 }); if (rem <= 1.0) this.target = null; }
        headYaw = clamp(this.faceAngleTo(p.position.x, p.position.z), -1.2, 1.2) * 0.7;
        // reload as it goes; it comes back loaded
        if (this.roundsLeft() < this.magCap * 0.5 && !this.reloadPlan && !this.dry && this.stateT > 1) { this.reloadReturn = 'fallback'; if (this.beginReload()) break; }
        // still shoots anything that follows it into the open
        if (d < 10 && this.roundsLeft() > 0 && this.staggerT <= 0 && vis > 0.02) {
          this.cooldown -= dt;
          if (this.burstLeft > 0) {
            this.shotT -= dt;
            if (this.shotT <= 0) {
              this.syncRoot(); this.muzzleWorld(_v4);
              _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.62, p.position.z);
              if (ctx.world.lineOfSight(_v4, _v3)) { this.fireOne(_v4, _v3, this.burstN === 0, 0.8, false); this.burstLeft--; this.shotT = this.profile.gap; }
              else this.burstLeft = 0;
              if (this.burstLeft === 0) this.cooldown = rng.range(0.8, 1.6);
            }
          } else if (this.cooldown <= 0) { this.burstLeft = Math.max(1, rng.int(this.profile.burst[0], this.profile.burst[1]) - 1); this.burstN = 0; this.shotT = 0; this.rollBias(); }
          aim = 1; track = true;
        }
        if (this.rallyT <= 0) {
          this.morale = Math.max(this.morale, this.skill.morale + 0.3);
          this.target = null; this.searchN = 0; this.searchT = 0; this.overwatchT = 0;
          this.setState(this.aware > 0.35 ? 'search' : 'patrol');
        }
        break;
      }
      case 'search': {
        // The hunt. Clear the contact, then the cover around it, then where someone would have run to, with a
        // pause to listen at each. It finishes by watching the ground from cover, silent — which is when most
        // people stand up. SKILL.giveUp decides how long it is willing to do this for.
        aim = 0.6; this.searchT += dt;
        const s = this.skill;
        if (this.engaged && t - this.lastVisT < 1) { this.setState('engage'); this.posture = 'open'; if (!this.squad) this.pickCover(this.wantFlank(), { force: true }); break; }
        // the radio hands over something better than what it has
        if (this.squad && this.squad.hasKnown && this.squad.lastKnownT > this.lastSeenT + 0.5) { this.believe(this.squad.lastKnown, 0, this.squad.lastKnownT, 0.85); this.searchN = 0; this.overwatchT = 0; }
        else {
          const dir = ctx.director;
          if (dir && dir.contact && dir.contactConfidence() > 0.35 && dir.contact.t > this.lastSeenT + 1) { this.believe(dir.contact.position, dir.contact.radius, dir.contact.t, 0.7); this.searchN = 0; this.overwatchT = 0; }
        }
        if (this.wantTacticalReload(vis)) { this.reloadReturn = 'search'; if (this.beginReload()) break; }
        // The squad is sweeping and this man has been given a lane (squad.js orderSweep). He walks HIS lane,
        // not his own guess, which is what turns four searchers into a line.
        const so = this.orders;
        if (so && so.job === 'sweep' && so.hasTarget) {
          if (!this.searchN || this.searchI >= this.searchN || this.searchNodes[0].distanceToSquared(so.target) > 16) {
            this.searchNodes[0].copy(so.target); this.searchN = 1; this.searchI = 0; this.nodeT = 0; this.overwatchPending = false;
          }
        } else if (!this.searchN) this.planSearch();
        if (this.overwatchT > 0) {
          // holding a firing position on the contact, saying nothing
          this.overwatchT -= dt; crouch = 0.55;
          const ls = this.lastSeenPlayer || this.position;
          this.faceToward(ls.x, ls.z, dt, 1.8);
          this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(1.6, 3.4); this.lookYaw = rng.range(-0.8, 0.8); }
          headYaw = this.lookYaw; aimYaw = headYaw * 0.4;
          if (this.overwatchT <= 0) { this.searchN = 0; this.waitT = 0; }
        } else if (this.listenT > 0) {
          // stopped, listening: it turns its whole body through the arc rather than sweeping its head
          this.listenT -= dt;
          this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(0.7, 1.6); this.lookYaw = rng.range(-1.2, 1.2); this.lookAbs = this.yaw + rng.range(-1.8, 1.8); }
          this.faceToward(this.position.x - Math.sin(this.lookAbs), this.position.z - Math.cos(this.lookAbs), dt, 2.0);
          headYaw = this.lookYaw; aimYaw = headYaw * 0.5;
        } else if (this.searchI < this.searchN) {
          const node = this.searchNodes[this.searchI];
          const rem = this.staggerT > 0 ? 99 : this.moveToward(node, SPEED.search, dt, { stop: 1.6 });
          headYaw = Math.sin(t * 1.15 + this.searchI * 2.1) * 0.8; aimYaw = headYaw * 0.5;
          this.nodeT += dt;
          // a waypoint it cannot reach (the far side of a wall, a fence, a ditch) is written off, not leaned on
          if (rem <= 1.6 || this.nodeT > 9) {
            const reached = rem <= 1.6;
            this.searchI++; this.nodeT = 0;
            if (reached && this.overwatchPending) { this.overwatchPending = false; this.overwatchT = rng.range(7, 15); }
            else if (reached) this.listenT = rng.range(1.1, 2.4);
            else this.overwatchPending = false;
          }
        } else if (this.searchT < s.giveUp) {
          // the ground is clear: either take a position on it and watch, or widen the pattern
          if (!(rng.chance(0.45) && this.pickOverwatch())) {
            const ls = this.lastSeenPlayer || this.position;
            const pt = ctx.world.randomPoint(rng, ls.x, ls.z, 8 + this.searchT * 0.5);
            if (pt) { this.searchNodes[0].copy(pt); this.searchN = 1; this.searchI = 0; this.nodeT = 0; }
            else { this.searchN = 0; this.searchT = s.giveUp; }
          }
        } else { this.setState('patrol'); this.target = null; this.searchN = 0; }
        if (!this.engaged && this.aware < 0.3 && this.searchT > s.giveUp * 0.6) { this.setState('patrol'); this.target = null; this.searchN = 0; }
        break;
      }
    }
    if (track || (this.aware > 0.5 && d < 40)) {
      const L = this.lookValid ? this.lookPt : _look.set(p.position.x, p.eye.y, p.position.z);
      headYaw = this.faceAngleTo(L.x, L.z);
      headPitch = Math.atan2(L.y - (this.position.y + 1.65), Math.max(1, Math.hypot(L.x - this.position.x, L.z - this.position.z)));
    }
    this.lookValid = false;
    const mv0 = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.stuckTick(dt, mv0);
    this.trySkip(dt);
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    speed = dt > 0 ? mv / dt : 0;
    this.moveSpeed = damp(this.moveSpeed, speed, 8, dt);
    this.crouch = damp(this.crouch, crouch, 6, dt);
    this.height = lerp(STAND_H, CROUCH_H, clamp01(this.crouch));
    // weapon light: night, a light in the loadout, hunting or fighting
    this.wantLight = this.hasLight && ctx.time.night > 0.45 && (this.state === 'engage' || this.state === 'search' || this.state === 'reload' || this.state === 'grenade' || this.state === 'fallback' || (this.state === 'suspicious' && this.aware > 0.6)) && d < 80;
    scheduleLights(ctx);

    // ---- sound ----
    // it goes quiet while it is listening or sitting on an overwatch: no radio, and the static bed drops
    const quiet = this.overwatchT > 0 || (this.state === 'search' && this.listenT > 0);
    if (!this.squad && !this.stalker) { this.radioT -= dt; if (this.radioT <= 0) { this.radioT = quiet ? rng.range(6, 12) : this.engaged ? rng.range(2, 5) : rng.range(4, 12); if (d < 80 && !quiet) this.sound('mimic_radio', { gain: this.engaged ? 0.7 : 0.45, max: 80 }); } }
    if (!this.staticLoop) { this.loopRetry -= dt; if (this.loopRetry <= 0) { this.loopRetry = 1; if (ctx.audio.ready) this.staticLoop = this.loopSound('mimic_static', { gain: 0, max: 60, ref: 3 }); } }
    if (this.staticLoop) {
      this.staticLoop.setGain(clamp01(this.aware) * clamp01(1 - d / 40) * (quiet || (this.orders && this.orders.role === 'ambush') ? 0.3 : 0.8), 0.2);
      this.staticT -= dt; if (this.staticT <= 0) { this.staticT = 0.3; this.staticLoop.set('level', clamp01(this.aware)); }
    }
    this.animate(dt, d, { headYaw, headPitch, aim, aimPitch, aimYaw, speed: this.moveSpeed, crouch: this.crouch });
  }
  animate(dt, d, c = {}) {
    const rig = this.rig, ctx = this.ctx, t = this.time;
    // pose glitch schedule: every 2-5 s the pose snaps wrong for ~60 ms
    if (this.glitchLeft > 0) { this.glitchLeft -= dt; if (this.glitchLeft <= 0 && rig.rig) rig.rig.glitchOn = false; }
    else { this.glitchT -= dt; if (this.glitchT <= 0) { this.glitchT = rng.range(2, 5); this.glitchLeft = 0.06; rig.rig?.startGlitch(1); if (!rig.legacy) rig.setState?.({ glitch: 1 }); } }
    const p = ctx.player;
    rig.setState?.({ speed: c.speed || 0, aiming: c.aim || 0, aimAt: (c.aim || 0) > 0.3 ? p.eye : null, crouch: c.crouch || 0, hit: 0, dead: false, glitch: this.glitchLeft > 0 ? 1 : 0, headYaw: c.headYaw || 0, headPitch: c.headPitch || 0, aimYaw: c.aimYaw || 0, aimPitch: c.aimPitch || 0, headRate: this.state === 'engage' ? 9 : 4 });
    rig.update?.(dt);
    const R = rig.rig;
    if (R && R.stepFlag && d < 60) { this.sound('mimic_step', { gain: 0.35 + 0.25 * clamp01((c.speed || 0) / 3), max: 40, rate: 0.9 + Math.random() * 0.2 }); }
    // face: sits on the head, turns to the camera
    this.syncRoot();
    if (this.headBone) { this.headBone.updateWorldMatrix(true, false); _v.setFromMatrixPosition(this.headBone.matrixWorld); _v.y += 0.12; }
    else { _v.set(this.position.x, this.position.y + this.height * 0.93, this.position.z); }
    _v2.copy(p.eye).sub(_v); const fl = _v2.length() || 1; _v2.divideScalar(fl);
    _v.addScaledVector(_v2, 0.125);
    this.root.worldToLocal(this.face.position.copy(_v));
    this.face.lookAt(p.eye);
    this.faceU.uTime.value = t;
    this.faceU.uFade.value = this.alive ? 0.85 + 0.15 * clamp01(this.aware) : 0;
    this.faceU.uGlow.value = 2.4 + clamp01(this.aware) * 1.6 + ctx.time.night * 0.6;
    if (this.matU) { this.matU.uTime.value = t; this.matU.uShiver.value = 1 + (R ? R.flinch * 2 : 0) + (this.state === 'engage' ? 0.3 : 0); }
    if (rig.gearMat) rig.gearMat.userData.u.uTime.value = t;
    // marksman tell
    if (this.glint) { const on = this.aiming && this.alive; this.glint.visible = on; if (on) { const k = 1.6 + 1.2 * Math.abs(Math.sin(t * 23)) + (Math.sin(t * 61) > 0.8 ? 1.5 : 0); this.glint.material.color.setRGB(k, k * 0.95, k * 0.85); this.glint.scale.setScalar(0.16 + 0.1 * clamp01(d / 60)); } }
    if (this.laser) {
      const on = this.alive && (this.aiming || (this.state === 'engage' && this.fx.laser && this.profile.kind !== 'sniper')) && d < 120;
      this.laser.visible = on;
      if (on) { this.muzzleWorld(_v3, _dir); const hit = ctx.world.raycast(_v3, _dir, 80); const L = hit ? hit.distance : 80; const a = this.laser.geometry.attributes.position; a.setXYZ(0, _v3.x, _v3.y, _v3.z); a.setXYZ(1, _v3.x + _dir.x * L, _v3.y + _dir.y * L, _v3.z + _dir.z * L); a.needsUpdate = true; }
    }
    // the weapon light: level, cone, and the beam finding the player
    const le = this.lightEntry;
    if (le) {
      const want = this.wantLight && this.alive ? 1 : 0;
      le.level = damp(le.level, want, 8, dt);
      le.light.intensity = 26 * le.level; le.cone.material.uniforms.uIntensity.value = 0.55 * le.level; le.cone.material.uniforms.uTime.value = t; le.cone.visible = le.level > 0.02;
      if (le.level > 0.3 && !p.dead) {
        this.muzzleWorld(_v3, _dir);
        _v2.set(p.eye.x - _v3.x, p.eye.y - _v3.y, p.eye.z - _v3.z); const bd = _v2.length() || 1; _v2.divideScalar(bd);
        if (bd < 30 && _v2.dot(_dir) > Math.cos(0.24)) {
          const facing = clamp01((-_v2.dot(p.forward) - 0.2) / 0.8);
          if (facing > 0.05 && ctx.world.lineOfSight(_v3, p.eye)) ctx.post.flash?.(0.02 + 0.06 * facing * le.level * clamp01(1.3 - bd / 30));
        }
      }
    }
  }
}

// =====================================================================================================
// What the AI costs, in line-of-sight rays (each one is a terrain ray plus a DDA walk of the collider grid).
// Per mimic, per second, at the worst — a near mimic in a fight:
//   perception      2 rays x 8.3/s engaged, x5/s suspicious, x2.9/s idle   (was 2 rays EVERY FRAME when not
//                                                                           engaged: ~120/s on a 60 Hz phone)
//   observed test   1 ray  x 4.5/s engaged, x6.7/s otherwise
//   firing          1 ray  per round that leaves the barrel, suppression fires none
//   torch beam      1 ray  x up to 60/s but only inside 30 m at night with a light, and only while lit
// and everything tactical — cover scoring (a pick takes the whole frame budget), posture (<=3), overwatch
// (<=4), break routes (<=3) — comes out of ONE pool of 8 rays a frame shared by every mimic alive
// (TACTICAL_PER_FRAME), so no number of mimics can spend more than 8 tactical rays in a frame, ever.
// Measured on a headless run of this file (flat world, 14 cover points, a scripted player, 60 Hz):
//   3 mimics in a firefight   0.7 rays/frame      7 mimics in a firefight   2.4 rays/frame
// Net: a squad of six now costs less than the old code did idling.
// =====================================================================================================
export function registerMimic(ctx) {
  rng = ctx.rng.fork(31);
  const clearMemory = () => { DEATHS.length = 0; HOLD.last = -1; HOLD.t = 0; losFrame = -1; };
  ctx.events.on('gameStart', clearMemory);
  ctx.events.on('tide', clearMemory);
  ctx.enemies.registerType('mimic', Mimic);
}
