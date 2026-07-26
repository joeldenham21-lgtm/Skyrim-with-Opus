/**
 * WYRMHOLD — vegetation and rock scatter.
 *
 * Everything you can see growing is generated here: conifers, birches, dead
 * trees, boulders, bushes, ferns, reeds and grass. Placement is a pure function
 * of world position (hash-based), so a tree is always in the same spot without
 * storing anything, and cells can be thrown away and rebuilt for free.
 *
 * All of it draws through a handful of InstancedMeshes that are refilled only
 * when the player crosses a cell boundary — a few times a minute, not per frame.
 */

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { hash2, clamp, saturate, lerp, TAU, Rand } from '../core/math.js';

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/** Merges an array of {positions, normals, uvs, indices} into one geometry. */
function mergeParts(parts) {
  let vc = 0, ic = 0;
  for (const p of parts) { vc += p.pos.length / 3; ic += p.idx.length; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    nor.set(p.nor, vo * 3);
    uv.set(p.uv, vo * 2);
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    vo += p.pos.length / 3;
    io += p.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** A tapered, optionally curved tube along +Y. */
function tubePart(segments, radial, hFn, rFn, offsetFn, uvRepeat = 3) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const y = hFn(t);
    const r = rFn(t);
    const [ox, oz] = offsetFn(t);
    for (let i = 0; i <= radial; i++) {
      const a = i / radial * TAU;
      const cx = Math.cos(a), cz = Math.sin(a);
      pos.push(ox + cx * r, y, oz + cz * r);
      nor.push(cx, 0.18, cz);
      uv.push(i / radial * 1.0, t * uvRepeat);
    }
  }
  const stride = radial + 1;
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < radial; i++) {
      const a = s * stride + i, b = a + 1, c = a + stride, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // normalise the ring normals
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
  return { pos, nor, uv, idx };
}

/** A double-sided quad card, positioned/oriented in space. */
function cardPart(cx, cy, cz, w, h, yaw, pitch, roll = 0, droop = 0) {
  const pos = [], nor = [], uv = [], idx = [];
  const cy_ = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // local frame: X = across, Y = along the card, Z = normal
  const rot = (x, y, z) => {
    // roll about Y, then pitch about X, then yaw about Y
    let x1 = x * cr + z * sr, y1 = y, z1 = -x * sr + z * cr;
    let x2 = x1, y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
    return [x2 * cy_ + z2 * sy, y2, -x2 * sy + z2 * cy_];
  };
  const corners = [[-w / 2, 0, 0], [w / 2, 0, 0], [-w / 2, h, 0], [w / 2, h, 0]];
  for (let i = 0; i < 4; i++) {
    let [x, y, z] = corners[i];
    z += droop * (y / Math.max(h, 1e-4)) * (y / Math.max(h, 1e-4)) * h;   // sag toward the tip
    const [rx, ry, rz] = rot(x, y - h * 0.5, z);
    pos.push(cx + rx, cy + ry + h * 0.5, cz + rz);
    const [nx, ny, nz] = rot(0, 0, 1);
    nor.push(nx, ny, nz);
  }
  uv.push(0, 0, 1, 0, 0, 1, 1, 1);
  idx.push(0, 1, 2, 2, 1, 3);
  return { pos, nor, uv, idx };
}

export function makePine(rand, opts = {}) {
  const height = opts.height ?? rand.float(9, 19);
  const trunkR = height * rand.float(0.016, 0.024);
  const lean = rand.float(0, 0.05);
  const leanA = rand.float(0, TAU);
  const off = t => [Math.cos(leanA) * lean * height * t * t, Math.sin(leanA) * lean * height * t * t];

  const trunk = tubePart(6, 7,
    t => t * height,
    t => trunkR * (1 - t * 0.88) + 0.02,
    off, Math.round(height / 2.2));

  const foliage = [];
  const levels = opts.levels ?? Math.round(lerp(8, 14, rand.next()));
  const startT = 0.16;
  for (let l = 0; l < levels; l++) {
    const t = startT + (1 - startT) * (l / (levels - 1));
    const y = t * height;
    const [ox, oz] = off(t);
    // conical silhouette, fullest at a third of the way up
    const taper = Math.pow(1 - t, 0.82) * (t < 0.25 ? t / 0.25 : 1);
    const radius = height * 0.22 * taper + 0.25;
    const count = Math.max(3, Math.round(lerp(4, 8, taper)));
    const baseA = rand.float(0, TAU);
    for (let i = 0; i < count; i++) {
      const a = baseA + i / count * TAU + rand.float(-0.2, 0.2);
      const r = radius * rand.float(0.55, 1.0);
      const cw = radius * rand.float(0.9, 1.35);
      const ch = radius * rand.float(0.85, 1.25);
      const px = ox + Math.cos(a) * r * 0.42;
      const pz = oz + Math.sin(a) * r * 0.42;
      const pitch = -Math.PI / 2 + rand.float(0.18, 0.55);   // branches droop
      foliage.push(cardPart(px, y, pz, cw * 2.0, ch * 2.0, a, pitch, 0, -0.25));
      foliage.push(cardPart(px, y + ch * 0.18, pz, cw * 1.7, ch * 1.7, a + Math.PI / 2.2, pitch * 0.9, 0, -0.2));
    }
  }
  // crown
  foliage.push(cardPart(off(1)[0], height * 0.9, off(1)[1], height * 0.10, height * 0.16, rand.float(0, TAU), 0));
  foliage.push(cardPart(off(1)[0], height * 0.9, off(1)[1], height * 0.10, height * 0.16, rand.float(0, TAU) + 1.57, 0));

  return { trunk: mergeParts([trunk]), foliage: mergeParts(foliage), height };
}

export function makeBirch(rand, opts = {}) {
  const height = opts.height ?? rand.float(7, 14);
  const trunkR = height * rand.float(0.012, 0.018);
  const lean = rand.float(0.02, 0.10);
  const leanA = rand.float(0, TAU);
  const off = t => [Math.cos(leanA) * lean * height * t * t, Math.sin(leanA) * lean * height * t * t];

  const parts = [tubePart(7, 7, t => t * height * 0.72, t => trunkR * (1 - t * 0.62) + 0.015, off, Math.round(height / 2))];
  const leaves = [];
  const branchCount = rand.int(4, 7);
  for (let b = 0; b < branchCount; b++) {
    const bt = lerp(0.42, 0.95, b / Math.max(1, branchCount - 1)) + rand.float(-0.05, 0.05);
    const by = bt * height * 0.72;
    const a = rand.float(0, TAU);
    const len = height * rand.float(0.18, 0.36);
    const [bx, bz] = off(bt);
    const ex = bx + Math.cos(a) * len, ez = bz + Math.sin(a) * len;
    const ey = by + len * rand.float(0.5, 0.95);
    parts.push(tubePart(3, 5,
      t => by + (ey - by) * t,
      t => trunkR * 0.45 * (1 - t * 0.8) + 0.008,
      t => [bx + (ex - bx) * t, bz + (ez - bz) * t], 2));
    // leaf clusters along the outer half of the branch
    const clusters = rand.int(3, 6);
    for (let c = 0; c < clusters; c++) {
      const t = lerp(0.45, 1.0, c / Math.max(1, clusters - 1));
      const cx = bx + (ex - bx) * t, cz = bz + (ez - bz) * t, cy = by + (ey - by) * t;
      const s = height * rand.float(0.07, 0.13);
      for (let k = 0; k < 3; k++) {
        leaves.push(cardPart(cx + rand.float(-s, s) * 0.4, cy + rand.float(-s, s) * 0.4, cz + rand.float(-s, s) * 0.4,
          s * 2.4, s * 2.4, rand.float(0, TAU), rand.float(-0.8, 0.3), rand.float(-0.5, 0.5), -0.1));
      }
    }
  }
  return { trunk: mergeParts(parts), foliage: mergeParts(leaves), height };
}

export function makeDeadTree(rand, opts = {}) {
  const height = opts.height ?? rand.float(5, 11);
  const trunkR = height * rand.float(0.018, 0.030);
  const lean = rand.float(0.03, 0.14);
  const leanA = rand.float(0, TAU);
  const off = t => [Math.cos(leanA) * lean * height * t * t, Math.sin(leanA) * lean * height * t * t];
  const parts = [tubePart(6, 6, t => t * height, t => trunkR * (1 - t * 0.9) + 0.02, off, Math.round(height / 2))];
  const branches = rand.int(4, 8);
  for (let b = 0; b < branches; b++) {
    const bt = rand.float(0.35, 0.92);
    const by = bt * height;
    const a = rand.float(0, TAU);
    const len = height * rand.float(0.16, 0.40);
    const [bx, bz] = off(bt);
    const droop = rand.float(-0.2, 0.8);
    parts.push(tubePart(4, 5,
      t => by + len * t * droop,
      t => trunkR * 0.4 * (1 - t * 0.92) + 0.006,
      t => [bx + Math.cos(a) * len * t, bz + Math.sin(a) * len * t], 2));
  }
  return { trunk: mergeParts(parts), foliage: null, height };
}

export function makeRock(rand, opts = {}) {
  const size = opts.size ?? rand.float(0.6, 3.4);
  const detail = opts.detail ?? 2;
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const n = new Rand(rand.int(0, 1e9));
  const seedA = n.float(0, 100), seedB = n.float(0, 100);
  const sx = rand.float(0.75, 1.4), sy = rand.float(0.55, 1.05), sz = rand.float(0.75, 1.4);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = v.x * 2.2 + seedA, ny = v.y * 2.2, nz = v.z * 2.2 + seedB;
    const bump =
      0.30 * Math.sin(nx * 1.7 + Math.cos(nz * 1.3)) +
      0.18 * Math.sin(ny * 3.1 + Math.cos(nx * 2.7)) +
      0.10 * Math.sin(nz * 5.3 + Math.sin(ny * 4.1));
    const r = 1 + bump * 0.30;
    v.multiplyScalar(r);
    v.x *= sx; v.y *= sy; v.z *= sz;
    // flatten and settle the base so it sits in the ground
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.25;
    v.multiplyScalar(size);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  // planar UVs work fine for a noisy stone material
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = (pos.getX(i) * 0.5 + pos.getZ(i) * 0.3) * 0.35;
    uvs[i * 2 + 1] = (pos.getY(i) * 0.6 + pos.getZ(i) * 0.2) * 0.35;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

export function makeBush(rand) {
  const s = rand.float(0.5, 1.3);
  const cards = [];
  const count = rand.int(7, 12);
  for (let i = 0; i < count; i++) {
    const a = rand.float(0, TAU);
    const r = rand.float(0, s * 0.5);
    const y = rand.float(0.05, s * 0.85);
    cards.push(cardPart(Math.cos(a) * r, y, Math.sin(a) * r,
      s * rand.float(1.0, 1.7), s * rand.float(0.9, 1.5),
      rand.float(0, TAU), rand.float(-0.5, 0.5), rand.float(-0.4, 0.4), -0.15));
  }
  return mergeParts(cards);
}

export function makeFern(rand) {
  const s = rand.float(0.4, 0.9);
  const cards = [];
  const fronds = rand.int(5, 9);
  for (let i = 0; i < fronds; i++) {
    const a = i / fronds * TAU + rand.float(-0.3, 0.3);
    cards.push(cardPart(0, 0.05, 0, s * 0.55, s * 1.5, a, -0.55 + rand.float(-0.2, 0.2), 0, -0.55));
  }
  return mergeParts(cards);
}

/** A clump of tapered grass blades, built from real geometry (no alpha test). */
export function makeGrassClump(rand, blades = 4, height = 0.55) {
  const pos = [], nor = [], uv = [], idx = [];
  let vo = 0;
  for (let b = 0; b < blades; b++) {
    const a = rand.float(0, TAU);
    const bx = Math.cos(a) * rand.float(0, 0.14);
    const bz = Math.sin(a) * rand.float(0, 0.14);
    const h = height * rand.float(0.62, 1.4);
    const w = 0.022 * rand.float(0.75, 1.5);
    const dirA = rand.float(0, TAU);
    const bend = rand.float(0.18, 0.55) * h;
    const dx = Math.cos(dirA), dz = Math.sin(dirA);
    const SEG = 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const y = h * t;
      const curve = bend * t * t;
      const hw = w * (1 - t * 0.92);
      const px = bx + dx * curve, pz = bz + dz * curve;
      // side vector perpendicular to the blade direction
      pos.push(px - dz * hw, y, pz + dx * hw);
      pos.push(px + dz * hw, y, pz - dx * hw);
      const nl = Math.hypot(dx, 0.55, dz) || 1;
      nor.push(-dx / nl, 0.55 / nl, -dz / nl);
      nor.push(-dx / nl, 0.55 / nl, -dz / nl);
      uv.push(0, t); uv.push(1, t);
    }
    for (let s = 0; s < SEG; s++) {
      const a0 = vo + s * 2, b0 = a0 + 1, c0 = a0 + 2, d0 = a0 + 3;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
    vo += (SEG + 1) * 2;
  }
  return mergeParts([{ pos, nor, uv, idx }]);
}

// ---------------------------------------------------------------------------
// Wind + distance fade material patch
// ---------------------------------------------------------------------------

export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0.35) },
  uWindStrength: { value: 0.35 },
  uGustiness: { value: 0.5 },
  uFadeStart: { value: 400 },
  uFadeEnd: { value: 480 },
  uCamPos: { value: new THREE.Vector3() },
  uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uTranslucency: { value: 0 },
  uSnowCover: { value: 0 },
};

/**
 * Adds wind sway, a dithered distance fade, and (for foliage) a cheap
 * translucency term so leaves glow when the sun is behind them.
 * `flex` scales how much the top of the object moves.
 */
export function applyWind(material, { flex = 1, translucency = 0, snowTint = 0, heightRef = 4, gradient = 0, mapSize = 512 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, windUniforms);
    shader.uniforms.uFlex = { value: flex };
    shader.uniforms.uHeightRef = { value: heightRef };
    shader.uniforms.uTransAmt = { value: translucency };
    shader.uniforms.uSnowTint = { value: snowTint };
    shader.uniforms.uGradLow = { value: 1 - gradient };
    shader.uniforms.uMapSize = { value: mapSize };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        uniform float uGustiness;
        uniform float uFlex;
        uniform float uHeightRef;
        uniform vec3 uCamPos;
        uniform float uFadeStart;
        uniform float uFadeEnd;
        varying float vFade;
        varying float vFoliageH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
            vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
            vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float hRel = clamp(transformed.y / uHeightRef, 0.0, 1.6);
          vFoliageH = hRel;
          float ph = uTime * 1.35 + origin.x * 0.11 + origin.z * 0.13;
          float gust = 0.65 + 0.35 * sin(uTime * 0.31 + origin.x * 0.013 + origin.z * 0.017);
          float sway = sin(ph) * 0.6 + sin(ph * 2.31 + 1.7) * 0.28 + sin(ph * 4.7 + 0.3) * 0.12;
          float amt = uWindStrength * uFlex * gust * hRel * hRel;
          vec2 w = normalize(uWindDir + vec2(1e-5));
          vec3 push = vec3(w.x, -abs(sway) * 0.12, w.y) * sway * amt;
          #ifdef USE_INSTANCING
            transformed += (push);
          #else
            transformed += push;
          #endif
          float d = distance(wp4.xz, uCamPos.xz);
          // Fade at both ends: out at range, and *in* very close, so the
          // third-person camera never ends up buried inside a fern.
          vFade = (1.0 - smoothstep(uFadeStart, uFadeEnd, d)) * smoothstep(0.35, 1.5, d);
        }`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunDirView;
        uniform vec3 uSunColor;
        uniform float uTransAmt;
        uniform float uSnowTint;
        uniform float uSnowCover;
        uniform float uGradLow;
        uniform float uMapSize;
        varying float vFade;
        varying float vFoliageH;`)
      .replace('#include <alphatest_fragment>', `
        #ifdef USE_ALPHATEST
        {
          // Mip-mapping averages a cutout's alpha toward zero, so a distant
          // conifer quietly loses every needle and becomes a bare pole. Scale
          // alpha back up by the mip level actually being sampled.
          vec2 dx = dFdx(vMapUv) * uMapSize;
          vec2 dy = dFdy(vMapUv) * uMapSize;
          float lod = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)) + 1e-8);
          diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.42;
          if (diffuseColor.a < alphaTest) discard;
        }
        #endif`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          // Dithered distance fade — objects dissolve instead of popping.
          float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          if (vFade < dth) discard;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // darker toward the base, so blades and leaves read as volumes
        diffuseColor.rgb *= mix(uGradLow, 1.0, clamp(vFoliageH, 0.0, 1.0));
        if (uSnowTint > 0.001 && uSnowCover > 0.001){
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.93),
                                 uSnowCover * uSnowTint * clamp(vFoliageH, 0.0, 1.0) * 0.8);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (uTransAmt > 0.001){
          // Light passing through the leaf toward the viewer.
          float back = pow(clamp(dot(normalize(vViewPosition), -uSunDirView), 0.0, 1.0), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * back * uTransAmt * 2.2;
        }`);
  };
  const key = `wyrm-wind-${flex}-${translucency}-${snowTint}-${heightRef}-${gradient}-${material.uuid}`;
  material.customProgramCacheKey = () => key;
  return material;
}

/**
 * Shadow casters use MeshDepthMaterial, which knows nothing about our wind
 * patch — without this the shadow of a swaying branch stays put. This builds a
 * matching depth material so silhouettes and shadows agree.
 */
export function makeWindDepthMaterial(sourceMat, windOpts) {
  const d = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: sourceMat.alphaTest > 0 ? sourceMat.map : null,
    alphaTest: sourceMat.alphaTest || 0,
    side: sourceMat.side,
  });
  return applyWind(d, windOpts);
}

// ---------------------------------------------------------------------------
// Scatter system
// ---------------------------------------------------------------------------

const CELL = 128;

class ScatterType {
  constructor(name, opts) {
    Object.assign(this, opts);
    this.name = name;
    this.mesh = new THREE.InstancedMesh(opts.geometry, opts.material, opts.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = opts.castShadow !== false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'scatter:' + name;
    if (opts.depthMaterial) this.mesh.customDepthMaterial = opts.depthMaterial;
    if (opts.tintVariation) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(opts.capacity * 3), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // A second mesh carries the same instances for the shadow pass at reduced
    // range, which keeps distant forests out of the shadow cascades.
    this.activeCells = new Set();
  }
}

export class ScatterSystem {
  constructor(hf, bakery) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    this.types = [];
    this.cellCache = new Map();
    this._lastCell = null;
    this._dirty = true;
    this.stats = { instances: 0 };

    this._buildMaterials(bakery);
    this._buildTypes();
    for (const t of this.types) this.group.add(t.mesh);
  }

  _buildMaterials(bakery) {
    const mk = (setName, extra = {}) => {
      const s = bakery.get(setName);
      const m = new THREE.MeshStandardMaterial({
        map: s.albedo, normalMap: s.normal, roughnessMap: s.orm, metalnessMap: s.orm, aoMap: s.orm,
        roughness: 1, metalness: 1, ...extra,
      });
      m.normalScale.set(1.1, 1.1);
      return m;
    };
    const windOf = {
      bark: { flex: 0.10, heightRef: 14 },
      needle: { flex: 0.55, translucency: 0.40, snowTint: 1, heightRef: 14, gradient: 0.25, mapSize: bakery.get('needles').size },
      leaf: { flex: 0.75, translucency: 0.60, snowTint: 0.8, heightRef: 12, gradient: 0.2, mapSize: bakery.get('leaves').size },
      grass: { flex: 1.6, translucency: 0.85, snowTint: 1, heightRef: 0.6, gradient: 0.55 },
      fern: { flex: 1.1, translucency: 0.8, snowTint: 0.7, heightRef: 1.2, gradient: 0.45, mapSize: bakery.get('foliage').size },
    };
    this.windOf = windOf;
    this.barkMat = applyWind(mk('bark'), windOf.bark);
    this.needleMat = applyWind(mk('needles', {
      alphaTest: 0.22, side: THREE.DoubleSide,
    }), windOf.needle);
    this.leafMat = applyWind(mk('leaves', {
      alphaTest: 0.22, side: THREE.DoubleSide,
    }), windOf.leaf);
    this.rockMat = mk('rock');
    this.grassMat = applyWind(mk('grass', { side: THREE.DoubleSide }), windOf.grass);
    this.fernMat = applyWind(mk('foliage', {
      alphaTest: 0.22, side: THREE.DoubleSide,
    }), windOf.fern);

    this.depthOf = new Map([
      [this.barkMat, makeWindDepthMaterial(this.barkMat, windOf.bark)],
      [this.needleMat, makeWindDepthMaterial(this.needleMat, windOf.needle)],
      [this.leafMat, makeWindDepthMaterial(this.leafMat, windOf.leaf)],
      [this.grassMat, makeWindDepthMaterial(this.grassMat, windOf.grass)],
      [this.fernMat, makeWindDepthMaterial(this.fernMat, windOf.fern)],
    ]);
  }

  _buildTypes() {
    const q = settings.get('preset');
    const budget = settings.get('foliageDistance');
    const rand = new Rand(90210);

    // --- pines: three silhouettes so a forest never looks stamped ----------
    const pines = [];
    for (let i = 0; i < 3; i++) pines.push(makePine(rand, { height: [11, 15, 19][i] }));

    const addTree = (name, built, capacity, opts) => {
      const trunkMat = opts.trunkMat || this.barkMat;
      this.types.push(new ScatterType(name + ':trunk', {
        ...opts,
        geometry: built.trunk, material: trunkMat,
        depthMaterial: this.depthOf.get(trunkMat),
        capacity, tintVariation: true, castShadow: true, height: built.height,
      }));
      if (built.foliage && opts.foliageMat) {
        this.types.push(new ScatterType(name + ':foliage', {
          ...opts,
          geometry: built.foliage, material: opts.foliageMat,
          depthMaterial: this.depthOf.get(opts.foliageMat),
          capacity, tintVariation: true, castShadow: true, height: built.height,
          pairedWith: name + ':trunk',
        }));
      }
    };

    const pineFilter = (b, slope, h) => {
      if (h < 3 || h > 400) return 0;
      if (slope > 0.44) return 0;
      return b.forest * (1 - saturate((h - 250) / 130));
    };
    for (let i = 0; i < 3; i++) {
      addTree('pine' + i, pines[i], Math.round(900 * clamp(budget, 0.3, 1.6)), {
        radius: 620 * budget, density: 0.0016, filter: pineFilter,
        scale: [0.75, 1.35], foliageMat: this.needleMat,
        groupSeed: 1, variantIndex: i, variants: 3,
      });
    }

    const birch = makeBirch(rand, { height: 11 });
    addTree('birch', birch, Math.round(320 * clamp(budget, 0.3, 1.6)), {
      radius: 480 * budget, density: 0.00055,
      filter: (b, slope, h) => (h < 4 || h > 190 || slope > 0.36) ? 0 : b.moisture * b.forest * 0.9,
      scale: [0.8, 1.3], foliageMat: this.leafMat,
      groupSeed: 2, variantIndex: 0, variants: 1,
    });

    const dead = makeDeadTree(rand, { height: 8 });
    addTree('dead', dead, 220, {
      radius: 420 * budget, density: 0.00028,
      filter: (b, slope, h) => (h < 2 || slope > 0.5) ? 0 : (0.35 - b.moisture * 0.3) * (0.4 + b.rocky * 0.8),
      scale: [0.7, 1.4], foliageMat: null,
      groupSeed: 3, variantIndex: 0, variants: 1,
    });

    // --- rocks -------------------------------------------------------------
    for (let i = 0; i < 3; i++) {
      const g = makeRock(rand, { size: [0.5, 1.2, 2.6][i], detail: i === 2 ? 2 : 1 });
      this.types.push(new ScatterType('rock' + i, {
        geometry: g, material: this.rockMat, depthMaterial: null,
        capacity: Math.round([700, 500, 260][i] * clamp(budget, 0.3, 1.6)),
        radius: [260, 420, 620][i] * budget,
        density: [0.0022, 0.0011, 0.00045][i],
        filter: (b, slope, h) => saturate(0.25 + b.rocky * 1.1 + slope * 1.4) * (h > 1 ? 1 : 0),
        scale: [0.6, 1.6], tintVariation: true,
        groupSeed: 4, variantIndex: i, variants: 3,
      }));
    }

    // --- undergrowth --------------------------------------------------------
    const bush = makeBush(rand);
    this.types.push(new ScatterType('bush', {
      geometry: bush, material: this.fernMat, capacity: Math.round(900 * clamp(budget, 0.3, 1.6)),
      radius: 190 * budget, density: 0.0042,
      filter: (b, slope, h) => (h < 1 || slope > 0.5) ? 0 : (0.25 + b.moisture * 0.9) * (0.3 + b.forest),
      scale: [0.7, 1.5], tintVariation: true, castShadow: false,
      depthMaterial: this.depthOf.get(this.fernMat),
      groupSeed: 5, variantIndex: 0, variants: 1,
    }));

    const fern = makeFern(rand);
    this.types.push(new ScatterType('fern', {
      geometry: fern, material: this.fernMat, capacity: Math.round(1400 * clamp(budget, 0.3, 1.6)),
      radius: 140 * budget, density: 0.010,
      filter: (b, slope, h) => (h < 1 || slope > 0.55) ? 0 : b.forest * b.moisture * 1.4,
      scale: [0.7, 1.4], tintVariation: true, castShadow: false,
      depthMaterial: this.depthOf.get(this.fernMat),
      groupSeed: 6, variantIndex: 0, variants: 1,
    }));
  }

  // -------------------------------------------------------------------------
  /** Deterministically generates the instances for one cell. */
  _buildCell(ci, cj) {
    const hf = this.hf;
    const ox = ci * CELL, oz = cj * CELL;
    const out = new Map();
    const area = CELL * CELL;

    for (const type of this.types) {
      if (type.pairedWith) continue;   // foliage mirrors its trunk
      const count = Math.min(240, Math.round(area * type.density));
      if (count <= 0) continue;
      const seed = (type.groupSeed ?? 1) * 1013;
      const list = [];
      for (let k = 0; k < count; k++) {
        // Variants of one group share positions, then claim a share each, so
        // three pine silhouettes populate one forest instead of three stacked.
        if (type.variants > 1) {
          const pick = Math.floor(hash2(ci * 3 + k * 31, cj * 5 + k * 17, seed + 555) * type.variants);
          if (pick !== type.variantIndex) continue;
        }
        const x = ox + hash2(ci * 7919 + k, cj * 104729, seed) * CELL;
        const z = oz + hash2(ci * 104729 + k, cj * 7919 + 13, seed + 7) * CELL;

        // Filtering runs against the baked height map, which is ~50x cheaper
        // than the analytic field; only accepted instances pay for the exact
        // height so they sit flush with the mesh.
        const hFast = hf.fastHeight(x, z);
        if (hFast < 0.5 && hf.isWater(x, z)) continue;
        const slope = hf.fastSlope(x, z);
        const biome = hf.sampleBiome(x, z);
        if (biome.road > 0.25) continue;
        const w = type.filter(biome, slope, hFast);
        if (w <= 0) continue;
        if (hash2(ci * 31 + k, cj * 17 + k, seed + 991) > w) continue;
        if (hf.isWater(x, z)) continue;

        let blocked = false;
        for (const L of hf.locations) {
          if (L.kind === 'water' || L.kind === 'peak') continue;
          if (Math.hypot(x - L.x, z - L.z) < L.radius * 0.82) { blocked = true; break; }
        }
        if (blocked) continue;

        const h = hf.heightAt(x, z);
        const s = lerp(type.scale[0], type.scale[1], hash2(ci + k, cj - k, seed + 77));
        const yaw = hash2(ci - k, cj + k, seed + 313) * TAU;
        const isRock = type.name.startsWith('rock');
        const tilt = (hash2(ci + k * 3, cj + k * 5, seed + 41) - 0.5) * (isRock ? 0.7 : 0.10);
        const tiltA = hash2(ci + k * 9, cj + k * 11, seed + 61) * TAU;
        const sink = isRock ? -s * 0.28 : -0.15;
        list.push({ x, y: h + sink, z, s, yaw, tilt, tiltA, tint: hash2(ci * 13 + k, cj * 29 + k, seed + 131) });
      }
      out.set(type.name, list);
    }
    return out;
  }

  _cellData(ci, cj) {
    const key = ci + ':' + cj;
    let d = this.cellCache.get(key);
    if (!d) {
      d = this._buildCell(ci, cj);
      this.cellCache.set(key, d);
      if (this.cellCache.size > 900) {
        // trim the oldest half — cells are cheap to rebuild
        const it = this.cellCache.keys();
        for (let i = 0; i < 300; i++) { const k = it.next().value; if (k !== undefined) this.cellCache.delete(k); }
      }
    }
    return d;
  }

  /** Refills every InstancedMesh from the cells currently in range. */
  rebuild(camPos) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sv = new THREE.Vector3();
    const col = new THREE.Color();
    let total = 0;

    const ccx = Math.floor(camPos.x / CELL), ccz = Math.floor(camPos.z / CELL);

    for (const type of this.types) {
      const radius = type.radius;
      const cells = Math.ceil(radius / CELL);
      const arr = type.mesh.instanceMatrix.array;
      const carr = type.mesh.instanceColor ? type.mesh.instanceColor.array : null;
      let n = 0;
      const cap = type.mesh.instanceMatrix.count;
      const srcName = type.pairedWith || type.name;

      for (let j = -cells; j <= cells && n < cap; j++) {
        for (let i = -cells; i <= cells && n < cap; i++) {
          const cx = (ccx + i) * CELL + CELL * 0.5;
          const cz = (ccz + j) * CELL + CELL * 0.5;
          if (Math.hypot(cx - camPos.x, cz - camPos.z) > radius + CELL) continue;
          const data = this.cellCache.get((ccx + i) + ':' + (ccz + j));
          if (!data) continue;   // not warmed yet; it will appear next refill
          const list = data.get(srcName);
          if (!list) continue;
          for (const it of list) {
            if (n >= cap) break;
            const d = Math.hypot(it.x - camPos.x, it.z - camPos.z);
            if (d > radius) continue;
            e.set(it.tilt * Math.cos(it.tiltA), it.yaw, it.tilt * Math.sin(it.tiltA));
            q.setFromEuler(e);
            v.set(it.x, it.y, it.z);
            sv.set(it.s, it.s, it.s);
            m.compose(v, q, sv);
            m.toArray(arr, n * 16);
            if (carr) {
              const t = it.tint;
              // Subtle, hue-consistent variation: a forest should look varied,
              // not tie-dyed.
              const v = lerp(0.84, 1.12, t);
              col.setRGB(v * lerp(0.98, 1.03, (t * 7) % 1), v, v * lerp(1.02, 0.96, (t * 3) % 1));
              carr[n * 3] = col.r; carr[n * 3 + 1] = col.g; carr[n * 3 + 2] = col.b;
            }
            n++;
          }
        }
      }
      type.mesh.count = n;
      type.mesh.instanceMatrix.needsUpdate = true;
      if (type.mesh.instanceColor) type.mesh.instanceColor.needsUpdate = true;
      total += n;
    }
    this.stats.instances = total;
  }

  /**
   * Builds a few not-yet-cached cells per frame, nearest first. Doing this
   * ahead of the refill means crossing a cell boundary never costs a hitch.
   * Returns true if anything new was generated.
   */
  warmCells(camPos, budget = 3) {
    let maxRadius = 0;
    for (const t of this.types) maxRadius = Math.max(maxRadius, t.radius);
    const cells = Math.ceil(maxRadius / CELL);
    const ccx = Math.floor(camPos.x / CELL), ccz = Math.floor(camPos.z / CELL);
    const todo = [];
    for (let j = -cells; j <= cells; j++) {
      for (let i = -cells; i <= cells; i++) {
        const key = (ccx + i) + ':' + (ccz + j);
        if (this.cellCache.has(key)) continue;
        const cx = (ccx + i) * CELL + CELL * 0.5, cz = (ccz + j) * CELL + CELL * 0.5;
        const d = Math.hypot(cx - camPos.x, cz - camPos.z);
        if (d > maxRadius + CELL) continue;
        todo.push({ i: ccx + i, j: ccz + j, d });
      }
    }
    if (!todo.length) return false;
    todo.sort((a, b) => a.d - b.d);
    for (let n = 0; n < Math.min(budget, todo.length); n++) {
      this._cellData(todo[n].i, todo[n].j);
    }
    return true;
  }

  update(camPos, env, warmBudget = 3) {
    const built = warmBudget > 0 ? this.warmCells(camPos, warmBudget) : false;
    const ci = Math.floor(camPos.x / (CELL * 0.5));
    const cj = Math.floor(camPos.z / (CELL * 0.5));
    const key = ci + ':' + cj;
    if (key !== this._lastCell || this._dirty || built) {
      this._lastCell = key;
      this._dirty = false;
      this.rebuild(camPos);
    }
    windUniforms.uTime.value = env.timeSec;
    windUniforms.uWindDir.value.set(env.windX, env.windZ);
    windUniforms.uWindStrength.value = 0.10 + env.windStrength * 0.75;
    windUniforms.uCamPos.value.copy(camPos);
    windUniforms.uSunColor.value.copy(env.sunColor).multiplyScalar(env.sunIrradiance ?? 1);
    windUniforms.uSnowCover.value = env.snowCover ?? 0;
    if (env.sunDirView) windUniforms.uSunDirView.value.copy(env.sunDirView);
  }

  markDirty() { this._dirty = true; }

  dispose() {
    for (const t of this.types) { t.mesh.geometry.dispose(); t.mesh.dispose(); }
    for (const m of [this.barkMat, this.needleMat, this.leafMat, this.rockMat, this.grassMat, this.fernMat]) m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Grass — a denser, shorter-range system of its own
// ---------------------------------------------------------------------------

const GRASS_TILE = 24;

export class GrassField {
  constructor(hf, scatter) {
    this.hf = hf;
    this.material = scatter.grassMat;
    this.group = new THREE.Group();
    this.group.name = 'grass';
    const rand = new Rand(4242);
    this.geometry = makeGrassClump(rand, 5, 0.55);
    this.capacity = 30000;
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
    this._lastTile = null;
    this._dirty = true;
  }

  rebuild(camPos) {
    const density = settings.get('grassDensity');
    const range = 26 + 58 * settings.get('grassDistance');
    if (density <= 0.001) { this.mesh.count = 0; return; }

    const hf = this.hf;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
    const arr = this.mesh.instanceMatrix.array;
    const carr = this.mesh.instanceColor.array;
    let n = 0;

    const perTile = Math.round(GRASS_TILE * GRASS_TILE * 0.9 * density);
    const tx = Math.floor(camPos.x / GRASS_TILE), tz = Math.floor(camPos.z / GRASS_TILE);
    const tiles = Math.ceil(range / GRASS_TILE);

    for (let j = -tiles; j <= tiles && n < this.capacity; j++) {
      for (let i = -tiles; i <= tiles && n < this.capacity; i++) {
        const ox = (tx + i) * GRASS_TILE, oz = (tz + j) * GRASS_TILE;
        if (Math.hypot(ox + GRASS_TILE / 2 - camPos.x, oz + GRASS_TILE / 2 - camPos.z) > range + GRASS_TILE) continue;
        for (let k = 0; k < perTile && n < this.capacity; k++) {
          const h1 = hash2(tx + i + k * 131, tz + j, 12345);
          const h2 = hash2(tx + i, tz + j + k * 977, 54321);
          const x = ox + h1 * GRASS_TILE, z = oz + h2 * GRASS_TILE;
          if (Math.hypot(x - camPos.x, z - camPos.z) > range) continue;
          if (hf.isWater(x, z)) continue;
          const slope = hf.slopeAt(x, z, 1.5);
          if (slope > 0.42) continue;
          const y = hf.heightAt(x, z);
          if (y < 0.5) continue;
          const b = hf.sampleBiome(x, z);
          if (b.road > 0.35) continue;
          const chance = saturate((0.25 + b.moisture * 1.15) * (1 - slope * 1.4)) * (1 - saturate((y - 260) / 90));
          if (hash2(tx + i + k, tz + j - k, 777) > chance) continue;

          const s = lerp(0.65, 1.5, hash2(tx + i - k, tz + j + k, 246));
          e.set(0, hash2(tx + i * 3, tz + j * 5 + k, 802) * TAU, 0);
          q.setFromEuler(e);
          v.set(x, y - 0.04, z);
          sv.set(s, s * lerp(0.8, 1.5, hash2(k, tx + i, 909)), s);
          m.compose(v, q, sv);
          m.toArray(arr, n * 16);
          const t = hash2(tx + i + k * 3, tz + j + k * 7, 313);
          const dry = saturate(1 - b.moisture);
          col.setRGB(lerp(0.72, 1.18, t) * lerp(1.0, 1.25, dry),
                     lerp(0.80, 1.16, 1 - t),
                     lerp(0.70, 1.02, (t * 5) % 1) * lerp(1.0, 0.72, dry));
          carr[n * 3] = col.r; carr[n * 3 + 1] = col.g; carr[n * 3 + 2] = col.b;
          n++;
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(camPos) {
    const key = Math.floor(camPos.x / 8) + ':' + Math.floor(camPos.z / 8);
    if (key !== this._lastTile || this._dirty) {
      this._lastTile = key;
      this._dirty = false;
      this.rebuild(camPos);
    }
  }

  markDirty() { this._dirty = true; }
  dispose() { this.geometry.dispose(); this.mesh.dispose(); }
}
