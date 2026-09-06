// Mimic — a human-shaped absence. Matte black, edges shiver, a smeared white blot of a face that always
// turns toward you, a rifle it should not be able to hold. v2: it is what it carries. A loadout rolled from the
// catalogue (a worn weapon with counted rounds, spare magazines, a vest and helmet resolved like the player's
// armour, grenades, a torch on the gun at night) decides how it fights: aimed shots, bursts, suppression from
// cover, a shotgunner's rush, a marksman's glint before the shot. Reloads are audible windows. Squads (squad.js)
// give it a role; alone it holds cover, flanks and skips closer when you are not looking. One a day is a stalker.
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
import { WEAPONS, AMMO, ARMOR, defaultAmmo, resolveHit, zoneFromHit } from '../data/index.js';
import { weaponEffects } from '../player/inventory.js';
import { rollLoadout, pickClass, dropsFor, roundsInGun, consumeRound, bestSpare } from './loadout.js';
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
  else { const b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r; const disc = b * b - 4 * a * c; if (disc < 0) return -1; t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) t = 0; }
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
const SPEED = { patrol: 1.55, suspicious: 2.4, engage: 3.4, search: 2.6, stalk: 2.2 };
const SHOT_FALLBACK = { pistol: 'shot_pm', smg: 'shot_pm', rifle: 'shot_akm', shotgun: 'shot_toz', sniper: 'shot_mosin', mg: 'shot_akm' };

// how a weapon class fights: gaps between rounds, string lengths, pauses, preferred range
function fireProfile(wdef, cdef) {
  const auto = wdef.modes.includes('auto');
  const gap = Math.max(60 / (wdef.rpm || 400), 0.075);
  const role = cdef.role;
  if (role === 'sniper' || (wdef.cls === 'sniper' && wdef.modes[0] === 'bolt')) return { kind: 'sniper', gap: Math.max(gap, 1.4), burst: [1, 1], cooldown: [1.6, 3.2], hold: [60, 120], aimT: 1.2 };
  if (wdef.cls === 'sniper') return { kind: 'sniper', gap: Math.max(gap, 0.6), burst: [1, 2], cooldown: [1.4, 2.8], hold: [45, 100], aimT: 1.2 };
  if (wdef.cls === 'mg' || role === 'gunner') return { kind: 'mg', gap, burst: [8, 15], cooldown: [2.0, 3.5], hold: [15, 45] };
  if (wdef.cls === 'shotgun') return { kind: 'shotgun', gap: Math.max(gap, wdef.modes[0] === 'pump' ? 0.7 : 0.45), burst: [2, 3], cooldown: [1.0, 1.8], hold: [4, 14] };
  if (auto) return { kind: 'burst', gap, burst: wdef.cls === 'smg' ? [4, 7] : [3, 5], cooldown: [1.2, 2.5], hold: [8, 30] };
  if (wdef.modes[0] === 'bolt') return { kind: 'semi', gap: Math.max(gap, 1.3), burst: [1, 1], cooldown: [0.8, 1.6], hold: [12, 40] };
  return { kind: 'semi', gap: Math.max(gap, 0.38), burst: [2, 4], cooldown: [1.0, 2.0], hold: [8, 30] };
}

class Mimic extends Enemy {
  constructor(ctx, position, opts = {}) {
    const tide = ctx.state.data.tideLevel || 1;
    const poi = opts.poi ? ctx.world.poi(opts.poi) : null;
    const loadout = opts.loadout || rollLoadout(opts.cls || pickClass(poi ? poi.kind : 'marsh', tide), tide);
    super(ctx, 'mimic', position, Object.assign({ hp: loadout.def.hp || 90 }, opts));
    this.radius = 0.32; this.height = 1.85; this.speed = SPEED.patrol;
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
    // visuals
    this.buildVisuals();
    // AI state
    this.target = null; this.waitT = 0; this.turnT = 0; this.searchT = 0; this.lookYaw = 0; this.lookT = 0; this.lookPitch = 0; this.lookAbs = this.yaw;
    this.lastVisT = -1e9; this.lastAlertT = -1e9; this.losT = -1e9; this.percT = 0;
    this.burstLeft = 0; this.shotT = 0; this.cooldown = 1.0; this.repositionT = 8; this.hitsSince = 0; this.cover = null; this.aimT = 0; this.aiming = false;
    this.reloadT = 0; this.reloadStage = 0; this.reloadPlan = null; this.dry = false; this.cycleT = 0;
    this.grenadeT = 0; this.grenadeTarget = new THREE.Vector3();
    this.radioT = rng.range(2, 8); this.glitchT = rng.range(2, 5); this.glitchLeft = 0;
    this.staggerT = 0; this.unobservedT = 0; this.obsT = 0; this.observed = true; this.skipCool = 0; this.moveSpeed = 0;
    this.staticLoop = null; this.loopRetry = 0; this.spotted = false; this.staticT = 0; this.crouch = 0;
    this.deathDuration = 2.2; this.ashDone = false; this.piled = false; this.stoppedHit = false;
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
  // hearing: 12 m for footsteps, 40 m for gunshots (overrides the base ranges)
  playerAudibility() {
    const d = this.distanceToPlayer();
    const steps = d < 12 ? this.player.noise * (1 - d / 12) : 0;
    const shots = this.ctx.director?.recentShotAt(this.position, 40) || 0;
    if (shots > 0.05) { if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastSeenT = this.time; if (this.aware < 0.45) this.aware = 0.45; }
    return clamp01(steps * 1.2 + shots * 1.6);
  }
  // vision with smoke: a cloud between the eyes and the player hides them
  playerVisibility(fovDeg, maxDay) {
    const p = this.player; if (p.dead || p.inBase) return 0;
    const w = this.ctx.world;
    if (w.smokeBlocks && w.smoke && w.smoke.length && w.smokeBlocks(this.eyePos(_v), p.eye)) return 0;
    return super.playerVisibility(fovDeg, maxDay);
  }
  onSpotted() {
    this.sound('mimic_spot', { gain: 0.9, max: 80 });
    this.cooldown = this.profile.kind === 'sniper' ? 0.4 : 0.9; this.hitsSince = 0; this.repositionT = rng.range(6, 10);
    this.spotted = true; this.radioT = Math.min(this.radioT, 0.6);
    if (this.squad) this.squad.notify('spotted', this); else this.pickCover(false);
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
  damage(amount, info = {}) {
    if (!this.alive) return false;
    if (this.stalker && !this.provoked && (!info.source || info.source === 'player' || info.source === this.player)) this.provoked = true;
    if (info.kind === 'blast') { if (info.grenade && info.source && info.source.type === 'mimic') amount *= 0.35; if (this.loadout.helmet) amount *= 0.9; return super.damage(amount, info); }
    if (info.kind === 'melee' || info.kind === 'slash' || info.kind === 'shock') return super.damage(amount, info);
    const zone = this.zoneOf(info);
    const given = info.ammo ? (typeof info.ammo === 'string' ? AMMO[info.ammo] : info.ammo) : null;
    const headMult = info.headshot ? 1.8 : 1;
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
    if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastVisT = this.time;
    if (this.alive && this.state !== 'engage' && !this.stalker) this.aware = 1;
    if (this.squad) this.squad.notify('hit', this);
    this.rig.rig?.startGlitch(0.6); this.glitchLeft = 0.08; this.rig.setState?.({ hit: 1 });
  }
  onDeath() {
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
  // solo cover: best within 25 m with a line of sight to the player. flank: prefer +-30..60 deg around the player
  pickCover(flank) {
    const w = this.ctx.world, p = this.player.position;
    const curA = Math.atan2(this.position.z - p.z, this.position.x - p.x);
    let best = null, bs = -1e9;
    _v3.set(p.x, p.y + this.player.eyeHeight, p.z);
    const hold = this.profile.hold;
    for (const c of w.coverPoints) {
      const dm = c.distanceTo(this.position); if (dm > 25 || dm < 1.5) continue;
      const dp = Math.hypot(c.x - p.x, c.z - p.z); if (dp < Math.max(5, hold[0] * 0.6) || dp > Math.max(45, hold[1])) continue;
      if (this.cover && c.distanceTo(this.cover) < 2) continue;
      _v.set(c.x, c.y + 1.6, c.z);
      if (!w.lineOfSight(_v, _v3)) continue;
      const ang = Math.abs(angleDelta(curA, Math.atan2(c.z - p.z, c.x - p.x)));
      let score = -Math.abs(dp - (hold[0] + hold[1]) * 0.5) * 0.12 - dm * 0.05;
      if (flank) score += (ang > 30 * DEG && ang < 70 * DEG) ? 2.0 : -ang * 0.5;
      else score += -ang * 0.3;
      if (score > bs) { bs = score; best = c; }
    }
    if (best) { if (!this.cover) this.cover = new THREE.Vector3(); this.cover.copy(best); this.target = best.clone(); return true; }
    const d = clamp(this.distanceToPlayer(), Math.max(9, hold[0]), Math.max(18, hold[1] * 0.7));
    for (let i = 0; i < 8; i++) {
      const off = flank ? (rng.chance(0.5) ? 1 : -1) * rng.range(30, 60) * DEG : rng.range(-18, 18) * DEG;
      const a = curA + off + (i > 3 ? rng.range(-1, 1) : 0);
      const pt = this.walkablePoint(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, _v);
      if (!pt) continue;
      _v2.set(pt.x, pt.y + 1.6, pt.z);
      if (!w.lineOfSight(_v2, _v3)) continue;
      this.cover = null; this.target = pt.clone(); return true;
    }
    this.target = null; return false;
  }
  alertPack() {
    for (const e of this.ctx.enemies.list) {
      if (e === this || !e.alive || (e.type !== 'mimic' && e.type !== 'seeker') || e.stalker) continue;
      if (e.position.distanceTo(this.position) > 30) continue;
      if (e.aware < 0.6) e.aware = 0.6;
      if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3(); e.lastSeenPlayer.copy(this.player.position); e.lastSeenT = this.time;
    }
  }
  muzzleWorld(out, dirOut) {
    const o = this.muzzleObj;
    if (o) { o.updateWorldMatrix(true, false); out.setFromMatrixPosition(o.matrixWorld); if (dirOut) dirOut.set(-o.matrixWorld.elements[8], -o.matrixWorld.elements[9], -o.matrixWorld.elements[10]).normalize(); return out; }
    this.eyePos(out); out.y -= 0.3; if (dirOut) dirOut.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); return out;
  }
  syncRoot() { this.root.position.copy(this.position); this.root.rotation.y = this.yaw; }
  // ---- the weapon ----
  roundsLeft() { return roundsInGun(this.weapon); }
  spreadDeg(first) {
    const p = this.player;
    let s = this.baseSpread;
    if (this.moveSpeed > 0.5) s *= 1.6;
    if (p.moving) s *= p.sprinting ? 1.45 : 1.2;
    if (first && (this.profile.kind === 'semi' || this.profile.kind === 'sniper')) s *= 0.7;
    if (this.crouch > 0.5) s *= 0.85;
    s += this.burstN * (this.profile.kind === 'mg' ? 0.25 : 0.4);
    return s;
  }
  fireOne(muzzle, dist, first) {
    const p = this.player, ctx = this.ctx;
    _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.62, p.position.z);
    _dir.subVectors(_v3, muzzle).normalize();
    const spread = this.spreadDeg(first);
    const ammo = this.ammo, range = this.profile.kind === 'sniper' ? 160 : this.profile.kind === 'shotgun' ? 25 : 70;
    if (ctx.ballistics && !ctx.ballistics.isStub) ctx.ballistics.shoot(muzzle, _dir, { source: 'enemy', damage: ammo.damage, ammo, ammoId: this.ammoId, shooter: this, spreadDeg: spread, pellets: ammo.pellets || 1, range, tracer: !this.suppressed || !!ammo.tracer, kind: 'bullet', weapon: this.weapon });
    else for (let i = 0; i < (ammo.pellets || 1); i++) enemyShoot(ctx, this, muzzle, _dir, ammo.damage, spread + (ammo.spread || 0));
    consumeRound(this.weapon);
    if (!this.suppressed || Math.random() < 0.3) ctx.vfx.muzzleFlash(muzzle, _dir);
    const noise = this.fx.noise;
    playAny(ctx, this.shotNames, { pos: muzzle, gain: this.suppressed ? 0.35 : 1.0, max: this.suppressed ? 70 : 240, ref: this.suppressed ? 3 : 4, rate: this.suppressed ? 0.85 : 1 });
    if (this.rig.rig) this.rig.rig.kick = 1; this.rig.setState?.({ hit: 0, kick: 1 });
    this.burstN++;
    this.weapon.dirt = Math.min(1, (this.weapon.dirt || 0) + 0.004);
  }
  // reload behind cover: 2.4 s of audible mechanics in which it does not fire (the tell)
  beginReload() {
    const w = this.weapon, wd = this.wdef;
    this.reloadT = 0; this.reloadStage = 0; this.burstLeft = 0; this.aiming = false;
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
    const t0 = this.reloadT; this.reloadT += dt; const t = this.reloadT;
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
  finishReload() { this.reloadPlan = null; this.cooldown = rng.range(0.4, 1.0); this.setState(this.orders && this.orders.role === 'ambush' ? 'engage' : 'engage'); }
  // the gun's low ready between shots for bolt/pump actions
  cycleAfterShot() {
    const m = this.wdef.modes[0];
    if (m === 'bolt') { this.cycleT = Math.max(0.9, this.profile.gap - 0.3); this.sound('bolt_open', { gain: 0.6, max: 40 }); this.cycleSound = 'bolt_close'; }
    else if (m === 'pump') { this.cycleT = 0.55; this.cycleSound = 'bolt_close'; }
    else if (m === 'break' && this.roundsLeft() === 0) { this.cycleT = 0; }
  }
  // grenade: pin squelch and a radio bark, a second of wind-up, then the arc
  canThrowGrenade(d) {
    if (this.grenades <= 0 || this.stunned > 0 || this.stalker) return false;
    if (d < 6 || d > 25) return false;
    const sq = this.ctx.squads; if (!sq) return false;
    if (!sq.canThrow(this) || sq.playerHoldT < 6) return false;
    if (this.lastSeenPlayer && this.time - this.lastSeenT > 8) return false;
    const p = this.player;
    this.eyePos(_v);
    const los = this.ctx.world.lineOfSight(_v, p.eye) || this.ctx.world.lineOfSight(_v2.set(_v.x, _v.y + 1.3, _v.z), _v3.set(p.eye.x, p.eye.y + 0.8, p.eye.z));
    return los;
  }
  beginGrenade() {
    this.grenadeT = 0; this.burstLeft = 0; this.aiming = false;
    this.grenadeTarget.copy(this.player.position).add(_v.set(rng.range(-1.5, 1.5), 0, rng.range(-1.5, 1.5)));
    playAny(this.ctx, ['grenade_pin', 'click'], { pos: this.position, hrtf: true, gain: 0.8, max: 40, rate: 0.8 });
    this.sound('mimic_radio', { gain: 0.7, max: 70, rate: 1.15 });
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
    if (o.hasTarget) { if (!this.target) this.target = new THREE.Vector3(); this.target.copy(o.target); }
    else if (o.hold) this.target = null;
    return o.role;
  }
  // sniper range keeping: back off under 55 m to a far spot with a line of sight, close in beyond 130 m
  holdRange(d, dt) {
    const hold = this.profile.hold, p = this.player.position, sq = this.ctx.squads;
    if (this.target) return;
    if (d < hold[0] - 5) {
      const c = sq ? sq.bestCover(this.position, 60, (c, dm) => { const dp = Math.hypot(c.x - p.x, c.z - p.z); if (dp < hold[0] || dp > hold[1]) return null; return -dm * 0.1 - Math.abs(dp - (hold[0] + hold[1]) * 0.5) * 0.05; }, true, 1.6) : null;
      if (c) { this.target = c.clone(); return; }
      _dir.set(this.position.x - p.x, 0, this.position.z - p.z).normalize();
      const pt = this.walkablePoint(this.position.x + _dir.x * 25, this.position.z + _dir.z * 25, _v); if (pt) this.target = pt.clone();
    } else if (d > hold[1] + 10) {
      _dir.set(p.x - this.position.x, 0, p.z - this.position.z).normalize();
      const pt = this.walkablePoint(this.position.x + _dir.x * 20, this.position.z + _dir.z * 20, _v); if (pt) this.target = pt.clone();
    }
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
    // perception: every frame until engaged, then every 0.12 s (two rays a time is the budget)
    let vis = 0;
    if (this.stalker && this.state === 'stalk') { this.aware = Math.max(this.aware, 0.55); if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(p.position); this.lastSeenT = t; }
    else {
      this.percT += dt;
      if (!this.engaged || this.percT >= 0.12) { const r = this.perceive(this.percT, { fov: 150, maxDay: 80, visGain: 1.5, hearGain: 1.2, decay: 0.08 }); vis = r.vis; this.percT = 0; if (vis > 0.05) this.lastVisT = t; }
      else vis = t - this.lastVisT < 0.2 ? 0.5 : 0;
    }
    if (this.state === 'suspicious' && this.stateT < 2.5 && vis < 0.6 && this.hitsSince === 0 && this.aware > 0.95) this.aware = 0.95;
    this.skipCool = Math.max(0, this.skipCool - dt); this.staggerT = Math.max(0, this.staggerT - dt); this.grenadeCool = Math.max(0, this.grenadeCool - dt);
    this.obsT += dt; if (this.obsT > 0.15) { this.obsT = 0; this.observed = this.observedByPlayer(); }
    this.unobservedT = this.observed ? 0 : this.unobservedT + dt;

    const prevX = this.position.x, prevZ = this.position.z;
    let headYaw = 0, headPitch = 0, aim = 0, aimPitch = 0, aimYaw = 0, speed = 0, track = false, crouch = 0;
    // global state promotion
    if (this.engaged && t - this.lastVisT < 6 && this.state !== 'engage' && this.state !== 'reload' && this.state !== 'grenade') this.setState('engage');
    else if (!this.engaged && this.aware >= 0.4 && (this.state === 'patrol' || this.state === 'watch' || this.state === 'idle')) { this.setState('suspicious'); this.turnT = 1.2; this.target = null; if (!this.squad) this.sound('mimic_radio', { gain: 0.5, max: 70 }); this.radioT = rng.range(4, 9); }
    const role = this.orders ? this.orders.role : null;

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
        const ls = this.lastSeenPlayer || p.position;
        if (this.turnT > 0) { this.turnT -= dt; this.faceToward(ls.x, ls.z, dt, 4); headYaw = this.faceAngleTo(ls.x, ls.z) * 0.6; }
        else {
          if (!this.target) { this.target = ls.clone(); this.waitT = 0; }
          const rem = this.staggerT > 0 ? 99 : this.moveToward(this.target, SPEED.suspicious, dt, { stop: 2.5 });
          if (rem <= 2.5) {
            this.waitT += dt; this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(1, 2.5); this.lookYaw = rng.range(-1.3, 1.3); }
            headYaw = this.lookYaw;
            if (this.waitT > 4) { if (this.aware < 0.4) { this.setState('patrol'); this.target = null; } else if (this.lastSeenPlayer && this.lastSeenPlayer.distanceTo(this.target) > 3) { this.target = this.lastSeenPlayer.clone(); this.waitT = 0; } }
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
        if (this.provoked || this.closeT > 20) { this.aware = 1; this.engaged = true; this.stalker = false; this.sound('mimic_spot', { gain: 0.9, max: 80 }); this.pickCover(false); this.setState('engage'); break; }
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
        aim = 0.3; crouch = this.cover && this.position.distanceTo(this.cover) < 2 ? 1 : 0.4; track = true;
        this.faceToward(this.lastSeenPlayer ? this.lastSeenPlayer.x : p.position.x, this.lastSeenPlayer ? this.lastSeenPlayer.z : p.position.z, dt, 4);
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
        const ambush = role === 'ambush';
        if ((t - this.lastVisT > 6 || !this.engaged) && !ambush) { this.setState('search'); this.target = this.lastSeenPlayer ? this.lastSeenPlayer.clone() : null; this.searchT = 0; this.waitT = 0; this.aiming = false; break; }
        if (!this.squad && t - this.lastAlertT > 2) { this.lastAlertT = t; this.alertPack(); }
        // where to be
        if (this.squad) this.applyOrders();
        else { this.repositionT -= dt; if ((this.repositionT <= 0 || this.hitsSince >= 2) && this.profile.kind !== 'sniper') { this.hitsSince = 0; this.repositionT = rng.range(6, 10); this.pickCover(true); if (this.target) this.radioT = Math.min(this.radioT, 0.4); } }
        if (this.profile.kind === 'sniper') this.holdRange(d, dt);
        if (this.profile.kind === 'shotgun' && d > 14 && (!this.squad || role !== 'watch')) { _dir.set(this.position.x - p.position.x, 0, this.position.z - p.position.z).normalize(); if (!this.target) this.target = new THREE.Vector3(); this.target.copy(p.position).addScaledVector(_dir, 8); }
        if (this.target && this.staggerT <= 0 && !ambush) {
          const rem = this.moveToward(this.target, role === 'watch' ? SPEED.suspicious : SPEED.engage, dt, { stop: 0.6, face: false });
          if (rem <= 0.6) { this.target = null; if (this.orders) this.orders.hasTarget = false; }
        }
        const inCover = this.cover && this.position.distanceTo(this.cover) < 1.6;
        crouch = inCover && this.moveSpeed < 0.3 && this.profile.kind !== 'shotgun' ? 0.6 : 0;
        this.faceToward(p.position.x, p.position.z, dt, 9);
        // may it fire? base and arrived flankers fire; watchers and walking flankers only when pressed
        let mayFire = true;
        if (role === 'flank') mayFire = this.orders.fire || d < 12 || this.hitsSince > 0;
        else if (role === 'watch') mayFire = d < 18 || this.hitsSince > 0;
        else if (ambush) mayFire = d < 15 || this.hitsSince > 0;
        else if (role === 'regroup') mayFire = d < 10 || this.hitsSince > 0;
        if (this.profile.kind === 'mg' && !inCover && this.moveSpeed > 0.5) mayFire = false;
        if (this.dry) mayFire = false;
        aimPitch = Math.atan2(p.eye.y - 0.25 - (this.position.y + 1.5), Math.max(1, d));
        aimYaw = this.faceAngleTo(p.position.x, p.position.z);
        if (ambush && mayFire) { this.orders.role = 'base'; this.squad.state = 'combat'; this.squad.radioT = 0.2; }
        // grenade?
        if (mayFire && !ambush && this.burstLeft === 0 && this.cooldown < 0.5 && this.canThrowGrenade(d)) { this.beginGrenade(); break; }
        // ammunition
        if (this.roundsLeft() === 0 && !this.dry) { if (this.beginReload()) break; }
        if (this.cycleT > 0) { this.cycleT -= dt; if (this.cycleT <= 0 && this.cycleSound) { this.sound(this.cycleSound, { gain: 0.6, max: 40 }); this.cycleSound = null; } }
        else if (!p.dead && d < (this.profile.kind === 'sniper' ? 160 : 70) && this.staggerT <= 0 && mayFire) {
          if (this.burstLeft > 0) {
            this.shotT -= dt;
            if (this.shotT <= 0) {
              this.syncRoot(); this.muzzleWorld(_v4);
              _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.62, p.position.z);
              const los = ctx.world.lineOfSight(_v4, _v3);
              if (los) { this.losT = t; this.fireOne(_v4, d, this.burstN === 0); this.burstLeft--; this.shotT = this.profile.gap; if (this.roundsLeft() === 0) this.burstLeft = 0; if (this.burstLeft > 0 && this.wdef.modes[0] === 'bolt') this.cycleAfterShot(); }
              else { this.burstLeft = 0; }
              if (this.burstLeft === 0) { this.cooldown = rng.range(this.profile.cooldown[0], this.profile.cooldown[1]) + (this.moveSpeed > 0.5 ? 0.5 : 0); if (this.wdef.modes[0] === 'bolt' || this.wdef.modes[0] === 'pump') this.cycleAfterShot(); this.aiming = false; }
            }
          } else if (this.profile.kind === 'sniper') {
            // the marksman: a still second of glint and (with a laser) a red line, then the shot
            this.cooldown -= dt;
            if (!this.aiming) { if (this.cooldown <= 0 && vis > 0.02 && this.moveSpeed < 0.3) { this.aiming = true; this.aimT = 0; } }
            else {
              this.aimT += dt;
              if (vis <= 0 && t - this.lastVisT > 0.5) this.aiming = false;
              else if (this.aimT >= this.profile.aimT) { this.burstLeft = 1; this.burstN = 0; this.shotT = 0; }
            }
          } else {
            this.cooldown -= dt;
            if (this.cooldown <= 0 && (vis > 0.02 || (this.profile.kind === 'mg' && t - this.lastVisT < 4))) { this.burstLeft = rng.int(this.profile.burst[0], this.profile.burst[1]); this.burstN = 0; this.shotT = 0; }
          }
        }
        break;
      }
      case 'search': {
        aim = 0.6; this.searchT += dt;
        if (this.engaged && t - this.lastVisT < 1) { this.setState('engage'); if (!this.squad) this.pickCover(false); break; }
        if (this.squad && this.squad.hasKnown && this.squad.lastKnownT > this.lastSeenT) { this.target = this.squad.lastKnown.clone(); this.lastSeenT = this.squad.lastKnownT; }
        if (this.target) {
          const rem = this.staggerT > 0 ? 99 : this.moveToward(this.target, SPEED.search, dt, { stop: 1.5 });
          headYaw = Math.sin(t * 1.3) * 0.7;
          if (rem <= 1.5) { this.target = null; this.waitT = 0; this.lookT = 0; }
        } else {
          this.waitT += dt; this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(0.8, 2); this.lookYaw = rng.range(-1.3, 1.3); this.lookAbs = this.yaw + rng.range(-2.2, 2.2); }
          this.faceToward(this.position.x - Math.sin(this.lookAbs), this.position.z - Math.cos(this.lookAbs), dt, 2.2);
          headYaw = this.lookYaw;
          if (this.waitT > 5) { const ls = this.lastSeenPlayer || this.position; const pt = ctx.world.randomPoint(rng, ls.x, ls.z, 8); if (pt && this.searchT < 25) { this.target = pt; } else { this.setState('patrol'); this.target = null; } }
        }
        aimYaw = headYaw * 0.6;
        if (!this.engaged && this.aware < 0.3 && this.searchT > 12) { this.setState('patrol'); this.target = null; }
        break;
      }
    }
    if (track || (this.aware > 0.5 && d < 40)) { headYaw = this.faceAngleTo(p.position.x, p.position.z); headPitch = Math.atan2(p.eye.y - (this.position.y + 1.65), Math.max(1, d)); }
    this.trySkip(dt);
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    speed = dt > 0 ? mv / dt : 0;
    this.moveSpeed = damp(this.moveSpeed, speed, 8, dt);
    this.crouch = damp(this.crouch, crouch, 6, dt);
    // weapon light: night, a light in the loadout, hunting or fighting
    this.wantLight = this.hasLight && ctx.time.night > 0.45 && (this.state === 'engage' || this.state === 'search' || this.state === 'reload' || this.state === 'grenade' || (this.state === 'suspicious' && this.aware > 0.6)) && d < 80;
    scheduleLights(ctx);

    // ---- sound ----
    if (!this.squad && !this.stalker) { this.radioT -= dt; if (this.radioT <= 0) { this.radioT = this.engaged ? rng.range(2, 5) : rng.range(4, 12); if (d < 80) this.sound('mimic_radio', { gain: this.engaged ? 0.7 : 0.45, max: 80 }); } }
    if (!this.staticLoop) { this.loopRetry -= dt; if (this.loopRetry <= 0) { this.loopRetry = 1; if (ctx.audio.ready) this.staticLoop = this.loopSound('mimic_static', { gain: 0, max: 60, ref: 3 }); } }
    if (this.staticLoop) {
      this.staticLoop.setGain(clamp01(this.aware) * clamp01(1 - d / 40) * (this.orders && this.orders.role === 'ambush' ? 0.3 : 0.8), 0.2);
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

export function registerMimic(ctx) {
  rng = ctx.rng.fork(31);
  ctx.enemies.registerType('mimic', Mimic);
}
