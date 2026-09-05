// Mimic — a human-shaped absence. Matte black, edges shiver, a smeared white blot of a face that always
// turns toward you, a rifle it should not be able to hold. Patrols POIs, stands very still watching, fires
// short bursts from cover, flanks, and skips closer when you are not looking.
//
// This file also exports the shared skinned humanoid rig (Rig) and the shiver/dissolve body material, which
// the Seeker reuses at 1.65x scale under its armour plates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './common.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { hash3 } from '../core/rng.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';

// ---- module temporaries (no per-frame allocation) ----
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _upv = new THREE.Vector3();
const _pole = new THREE.Vector3(), _axis = new THREE.Vector3(), _upper = new THREE.Vector3(), _elbow = new THREE.Vector3(), _fore = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _so = new THREE.Vector3(), _sd = new THREE.Vector3(), _sp = new THREE.Vector3();
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
    B.hips.rotation.set(0.10 * g + (c.lean || 0), Math.sin(ph) * 0.05 * g, -Math.sin(ph) * 0.03 * g);
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
// The Mimic
// =====================================================================================================
let rng = null;
const SPEED = { patrol: 1.55, suspicious: 2.4, engage: 3.4, search: 2.6 };

class Mimic extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'mimic', position, Object.assign({ hp: 90 }, opts));
    this.radius = 0.32; this.height = 1.85; this.speed = SPEED.patrol;
    this.material = makeBodyMaterial({ albedo: 0.02 });
    this.rig = new Rig({ material: this.material });
    this.root.add(this.rig.mesh);
    this.face = makeFace(0.24, 3.0);
    this.root.add(this.face);
    this.faceU = this.face.material.uniforms;
    const poi = opts.poi ? ctx.world.poi(opts.poi) : null;
    this.poiR = poi ? Math.min(poi.r * 0.8, 40) : 22;
    // AI state
    this.target = null;               // movement target (Vector3) or null
    this.waitT = 0; this.turnT = 0; this.searchT = 0; this.lookYaw = 0; this.lookT = 0; this.lookPitch = 0; this.lookAbs = this.yaw;
    this.lastVisT = -1e9; this.lastAlertT = -1e9;
    this.burstLeft = 0; this.shotT = 0; this.cooldown = 1.0; this.repositionT = 8; this.hitsSince = 0; this.cover = null;
    this.radioT = rng.range(2, 8); this.glitchT = rng.range(2, 5); this.glitchLeft = 0;
    this.staggerT = 0; this.unobservedT = 0; this.obsT = 0; this.observed = true; this.skipCool = 0; this.moveSpeed = 0;
    this.staticLoop = null; this.loopRetry = 0; this.spotted = false; this.staticT = 0;
    this.deathDuration = 2.2; this.ashDone = false;
    // a fresh mimic stands and watches first (a still figure among the trunks), then starts its rounds
    this.setState(opts.idle ? 'idle' : 'watch');
    this.waitT = rng.range(5, 16); this.lookT = rng.range(1, 3);
    // first sync so the face and muzzle are placed before the first render
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
    this.animate(0.016, 0);
  }
  // hearing: 12 m for footsteps, 40 m for gunshots (overrides the base ranges)
  playerAudibility() {
    const d = this.distanceToPlayer();
    const steps = d < 12 ? this.player.noise * (1 - d / 12) : 0;
    const shots = this.ctx.director?.recentShotAt(this.position, 40) || 0;
    if (shots > 0.05) { if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastSeenT = this.time; if (this.aware < 0.45) this.aware = 0.45; }
    return clamp01(steps * 1.2 + shots * 1.6);
  }
  onSpotted() {
    this.sound('mimic_spot', { gain: 0.9, max: 80 });
    this.cooldown = 0.9; this.hitsSince = 0; this.repositionT = rng.range(6, 10);
    this.spotted = true; this.radioT = Math.min(this.radioT, 0.6);
    this.pickCover(false);
    this.setState('engage');
  }
  onHit(amount, info) {
    this.sound('mimic_hit', { gain: 0.8 });
    this.rig.flinch = 1; this.staggerT = 0.3; this.hitsSince++;
    if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastVisT = this.time;
    if (this.alive && this.state !== 'engage') { this.aware = 1; }
    this.rig.startGlitch(0.6); this.glitchLeft = 0.08;
  }
  onDeath() {
    this.sound('mimic_death', { gain: 1.0 });
    this.target = null;
  }
  deathTick(dt) {
    const t = this.deathT, rig = this.rig, B = rig.B;
    // fold inward over 0.6 s: knees give, spine curls, arms drop, the whole thing narrows
    const f = clamp01(t / 0.6), fe = 1 - Math.pow(1 - f, 3);
    B.thL.rotation.x = 0.9 * fe; B.thR.rotation.x = 0.8 * fe; B.snL.rotation.x = -1.9 * fe; B.snR.rotation.x = -1.7 * fe;
    B.hips.position.y = rig.rest.hips.y - 0.62 * fe; B.hips.rotation.x = 0.35 * fe;
    B.spine.rotation.x = 0.55 * fe; B.chest.rotation.x = 0.7 * fe; B.neck.rotation.x = 0.5 * fe;
    B.gun.rotation.x = -0.42 - 0.9 * fe; B.gun.position.y = rig.gunRest.y - 0.25 * fe;
    B.gun.updateMatrix();
    rig.solveArm(B.shL, B.foL, rig.shPosL, _v.copy(rig.gripL).applyMatrix4(B.gun.matrix), -1);
    rig.solveArm(B.shR, B.foR, rig.shPosR, _v.copy(rig.gripR).applyMatrix4(B.gun.matrix), 1);
    rig.mesh.scale.set(1 - 0.25 * fe, 1, 1 - 0.2 * fe);
    this.faceU.uFade.value = Math.max(0, 1 - t / 0.35);
    this.material.userData.u.uTime.value = this.time;
    this.faceU.uTime.value = this.time;
    if (t >= 0.6) {
      if (!this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.3, this.position.z), 90); rig.mesh.castShadow = false; }
      this.material.userData.u.uDissolve.value = clamp01((t - 0.6) / 1.2);
      this.material.userData.u.uShiver.value = 1 + (t - 0.6) * 2;
    }
    this.face.visible = t < 0.4;
  }
  onDispose() { this.face.material.dispose(); this.rig.dispose(); }

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
  // a point at the POI: a cover point sometimes, otherwise a random walkable spot around home
  pickPatrolPoint() {
    const w = this.ctx.world;
    const near = [];
    for (const c of w.coverPoints) { if (Math.hypot(c.x - this.home.x, c.z - this.home.z) < this.poiR && c.distanceTo(this.position) > 4) near.push(c); }
    if (near.length && rng.chance(0.55)) return rng.pick(near).clone();
    const p = w.randomPoint(rng, this.home.x, this.home.z, this.poiR) || this.home.clone();
    if (p.distanceTo(this.position) < 3) return this.home.clone();
    return p;
  }
  // best cover within 25 m with a line of sight to the player. flank: prefer +-30..60 deg around the player
  pickCover(flank) {
    const w = this.ctx.world, p = this.player.position;
    const curA = Math.atan2(this.position.z - p.z, this.position.x - p.x);
    let best = null, bs = -1e9;
    _v3.set(p.x, p.y + this.player.eyeHeight, p.z);
    for (const c of w.coverPoints) {
      const dm = c.distanceTo(this.position); if (dm > 25 || dm < 1.5) continue;
      const dp = Math.hypot(c.x - p.x, c.z - p.z); if (dp < 5 || dp > 45) continue;
      if (this.cover && c.distanceTo(this.cover) < 2) continue;
      _v.set(c.x, c.y + 1.6, c.z);
      if (!w.lineOfSight(_v, _v3)) continue;
      const ang = Math.abs(angleDelta(curA, Math.atan2(c.z - p.z, c.x - p.x)));
      let score = -Math.abs(dp - 16) * 0.12 - dm * 0.05;
      if (flank) score += (ang > 30 * DEG && ang < 70 * DEG) ? 2.0 : -ang * 0.5;
      else score += -ang * 0.3;
      if (score > bs) { bs = score; best = c; }
    }
    if (best) { this.cover = best.clone(); this.target = this.cover.clone(); return true; }
    // no cover registered here: a stand-off point, flanking around the player
    const d = clamp(this.distanceToPlayer(), 9, 18);
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
      if (e === this || !e.alive || (e.type !== 'mimic' && e.type !== 'seeker')) continue;
      if (e.position.distanceTo(this.position) > 30) continue;
      if (e.aware < 0.6) e.aware = 0.6;
      if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3(); e.lastSeenPlayer.copy(this.player.position); e.lastSeenT = this.time;
    }
  }
  fireOne(muzzle, dist) {
    const p = this.player;
    _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.62, p.position.z);
    _dir.subVectors(_v3, muzzle).normalize();
    // ~70 % of rounds find a standing target at 15 m, falling with distance, worse on the move (either side)
    const spread = 1.5 + dist * 0.05 + p.speed * 0.4 + (this.moveSpeed > 0.5 ? 2.0 : 0);
    enemyShoot(this.ctx, this, muzzle, _dir, 8, spread);
    this.ctx.vfx.muzzleFlash(muzzle, _dir);
    this.sound('mimic_shot', { pos: muzzle, gain: 1.0, max: 220, ref: 4 });
    this.rig.kick = 1;
  }
  trySkip(dt) {
    if (this.skipCool > 0 || !this.target || this.state === 'idle' || this.state === 'watch') return;
    // only where it can matter: within earshot of the player, and while on the player's trail or close by
    const d = this.distanceToPlayer(); if (d < 12 || d > 70 || this.unobservedT < 2) return;
    if (this.state === 'patrol' && d > 45) return;
    if (Math.random() > 1 - Math.pow(0.75, dt)) return;
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
    this.skipCool = 3; this.unobservedT = 0; this.rig.startGlitch(0.8); this.glitchLeft = 0.07;
  }

  // ---- AI ----
  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time;
    this.followGround(dt);
    const d = this.distanceToPlayer();
    const { vis } = this.perceive(dt, { fov: 150, maxDay: 80, visGain: 1.5, hearGain: 1.2, decay: 0.08 });
    if (vis > 0.05) this.lastVisT = t;
    // a far, faint sighting gets a dwell: it turns and stares before it decides you are real. Up close (or under
    // fire) contact is immediate.
    if (this.state === 'suspicious' && this.stateT < 2.5 && vis < 0.6 && this.hitsSince === 0 && this.aware > 0.95) this.aware = 0.95;
    this.skipCool = Math.max(0, this.skipCool - dt); this.staggerT = Math.max(0, this.staggerT - dt);
    // observation bookkeeping for skips (throttled LOS)
    this.obsT += dt; if (this.obsT > 0.15) { this.obsT = 0; this.observed = this.observedByPlayer(); }
    this.unobservedT = this.observed ? 0 : this.unobservedT + dt;

    const prevX = this.position.x, prevZ = this.position.z;
    let headYaw = 0, headPitch = 0, aim = 0, aimPitch = 0, aimYaw = 0, speed = 0, track = false;
    // global state promotion
    if (this.engaged && t - this.lastVisT < 6 && this.state !== 'engage') this.setState('engage');
    else if (!this.engaged && this.aware >= 0.4 && (this.state === 'patrol' || this.state === 'watch' || this.state === 'idle')) { this.setState('suspicious'); this.turnT = 1.2; this.target = null; this.sound('mimic_radio', { gain: 0.5, max: 70 }); this.radioT = rng.range(4, 9); }

    switch (this.state) {
      case 'idle': {
        // stands unnaturally still; now and then the head turns to something
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
        headYaw = Math.sin(t * 0.35 + this.rig.phase * 0.1) * 0.25;
        break;
      }
      case 'suspicious': {
        const ls = this.lastSeenPlayer || p.position;
        if (this.turnT > 0) { this.turnT -= dt; this.faceToward(ls.x, ls.z, dt, 4); headYaw = this.faceAngleTo(ls.x, ls.z) * 0.6; }
        else {
          if (!this.target) { this.target = ls.clone(); this.waitT = 0; }
          const rem = this.staggerT > 0 ? 99 : this.moveToward(this.target, SPEED.suspicious, dt, { stop: 2.5 });
          if (rem <= 2.5) {
            // look around, then either go back to patrolling or investigate the newer noise
            this.waitT += dt; this.lookT -= dt; if (this.lookT <= 0) { this.lookT = rng.range(1, 2.5); this.lookYaw = rng.range(-1.3, 1.3); }
            headYaw = this.lookYaw;
            if (this.waitT > 4) { if (this.aware < 0.4) { this.setState('patrol'); this.target = null; } else if (this.lastSeenPlayer && this.lastSeenPlayer.distanceTo(this.target) > 3) { this.target = this.lastSeenPlayer.clone(); this.waitT = 0; } }
          } else headYaw = this.faceAngleTo(this.target.x, this.target.z) * 0.5;
        }
        if (this.aware < 0.25 && this.stateT > 6) { this.setState('patrol'); this.target = null; }
        break;
      }
      case 'engage': {
        aim = 1; track = true;
        if (t - this.lastVisT > 6 || !this.engaged) { this.setState('search'); this.target = this.lastSeenPlayer ? this.lastSeenPlayer.clone() : null; this.searchT = 0; this.waitT = 0; break; }
        if (t - this.lastAlertT > 2) { this.lastAlertT = t; this.alertPack(); }
        // move between cover points, keep the body on the player
        if (this.target && this.staggerT <= 0) {
          const rem = this.moveToward(this.target, SPEED.engage, dt, { stop: 0.6, face: false });
          if (rem <= 0.6) this.target = null;
        }
        this.faceToward(p.position.x, p.position.z, dt, 9);
        this.repositionT -= dt;
        if (this.repositionT <= 0 || this.hitsSince >= 2) { this.hitsSince = 0; this.repositionT = rng.range(6, 10); this.pickCover(true); if (this.target) this.radioT = Math.min(this.radioT, 0.4); }
        // fire: bursts of 3-5 with a line of sight from the muzzle
        aimPitch = Math.atan2(p.eye.y - 0.25 - (this.position.y + 1.5), Math.max(1, d));
        aimYaw = this.faceAngleTo(p.position.x, p.position.z);
        if (!p.dead && d < 60 && this.staggerT <= 0) {
          if (this.burstLeft > 0) {
            this.shotT -= dt;
            if (this.shotT <= 0) {
              this.syncRoot(); this.rig.muzzleWorld(_v4);
              _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.62, p.position.z);
              if (ctx.world.lineOfSight(_v4, _v3)) { this.fireOne(_v4, d); this.burstLeft--; this.shotT = 0.09; }
              else { this.burstLeft = 0; }
              if (this.burstLeft === 0) this.cooldown = rng.range(1.2, 2.5) + (this.moveSpeed > 0.5 ? 0.5 : 0);
            }
          } else {
            this.cooldown -= dt;
            if (this.cooldown <= 0 && vis > 0.02) { this.burstLeft = rng.int(3, 5); this.shotT = 0; }
          }
        }
        break;
      }
      case 'search': {
        aim = 0.6; this.searchT += dt;
        if (this.engaged && t - this.lastVisT < 1) { this.setState('engage'); this.pickCover(false); break; }
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
        if (!this.engaged && this.aware < 0.3 && this.searchT > 12) { this.setState('patrol'); this.target = null; }
        break;
      }
    }
    if (track || (this.aware > 0.5 && d < 40)) { headYaw = this.faceAngleTo(p.position.x, p.position.z); headPitch = Math.atan2(p.eye.y - (this.position.y + 1.65), Math.max(1, d)); }
    this.trySkip(dt);
    // speed for the gait
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    speed = dt > 0 ? mv / dt : 0;
    this.moveSpeed = damp(this.moveSpeed, speed, 8, dt);

    // ---- sound ----
    this.radioT -= dt;
    if (this.radioT <= 0) { this.radioT = this.engaged ? rng.range(2, 5) : rng.range(4, 12); if (d < 80) this.sound('mimic_radio', { gain: this.engaged ? 0.7 : 0.45, max: 80 }); }
    if (!this.staticLoop) { this.loopRetry -= dt; if (this.loopRetry <= 0) { this.loopRetry = 1; if (ctx.audio.ready) this.staticLoop = this.loopSound('mimic_static', { gain: 0, max: 60, ref: 3 }); } }
    if (this.staticLoop) {
      this.staticLoop.setGain(clamp01(this.aware) * clamp01(1 - d / 40) * 0.8, 0.2);
      this.staticT -= dt; if (this.staticT <= 0) { this.staticT = 0.3; this.staticLoop.set('level', clamp01(this.aware)); }
    }

    this.animate(dt, d, { headYaw, headPitch, aim, aimPitch, aimYaw, speed: this.moveSpeed });
  }
  syncRoot() { this.root.position.copy(this.position); this.root.rotation.y = this.yaw; }
  animate(dt, d, c = {}) {
    const rig = this.rig, ctx = this.ctx, t = this.time;
    // pose glitch schedule: every 2-5 s the pose snaps wrong for ~60 ms
    if (this.glitchLeft > 0) { this.glitchLeft -= dt; if (this.glitchLeft <= 0) rig.glitchOn = false; }
    else { this.glitchT -= dt; if (this.glitchT <= 0) { this.glitchT = rng.range(2, 5); this.glitchLeft = 0.06; rig.startGlitch(1); } }
    rig.pose({ dt, speed: c.speed || 0, aim: c.aim || 0, aimPitch: c.aimPitch || 0, aimYaw: c.aimYaw || 0, headYaw: c.headYaw || 0, headPitch: c.headPitch || 0, chestYaw: clamp((c.headYaw || 0) * 0.25, -0.3, 0.3), headRate: this.state === 'engage' ? 9 : 4 });
    if (rig.stepFlag && d < 60) { this.sound('mimic_step', { gain: 0.35 + 0.25 * clamp01((c.speed || 0) / 3), max: 40, rate: 0.9 + Math.random() * 0.2 }); }
    // face: sits on the head, turns to the camera, fades with fog distance handled by the fog chunk
    this.syncRoot();
    rig.boneWorld('head', _v); _v.y += 0.12;
    _v2.copy(ctx.player.eye).sub(_v); const fl = _v2.length() || 1; _v2.divideScalar(fl);
    _v.addScaledVector(_v2, 0.125);
    this.root.worldToLocal(this.face.position.copy(_v));
    this.face.lookAt(ctx.player.eye);
    this.faceU.uTime.value = t;
    this.faceU.uFade.value = this.alive ? 0.85 + 0.15 * clamp01(this.aware) : 0;
    this.faceU.uGlow.value = 2.4 + clamp01(this.aware) * 1.6 + ctx.time.night * 0.6;
    this.material.userData.u.uTime.value = t;
    this.material.userData.u.uShiver.value = 1 + this.rig.flinch * 2 + (this.state === 'engage' ? 0.3 : 0);
  }
}

export function registerMimic(ctx) {
  rng = ctx.rng.fork(31);
  ctx.enemies.registerType('mimic', Mimic);
}
