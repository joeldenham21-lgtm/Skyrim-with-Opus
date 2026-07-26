/**
 * WYRMHOLD — terrain rendering.
 *
 * A distance-driven quadtree over the whole 4 km map. Each node becomes a
 * fixed-vertex-count chunk, so a distant chunk costs exactly as much as a near
 * one — only its footprint changes. Cracks between LOD levels are hidden with
 * skirts rather than stitching, which keeps chunk generation independent and
 * therefore cheap enough to stream a couple per frame without a hitch.
 *
 * The material is a patched MeshStandardMaterial so it keeps three's PBR,
 * cascaded shadows and image-based lighting, while splatting six procedural
 * material sets by height, slope, biome and live weather.
 */

import * as THREE from 'three';
import { WORLD_SIZE, WORLD_HALF, SEA_LEVEL } from './heightfield.js';
import { settings } from '../core/settings.js';
import { clamp, saturate, lerp } from '../core/math.js';

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

const TERRAIN_PARS = /* glsl */`
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vOcc;
varying float vSteep;

uniform sampler2D tBiome;

uniform sampler2D tGrassA; uniform sampler2D tGrassN; uniform sampler2D tGrassO;
uniform sampler2D tRockA;  uniform sampler2D tRockN;  uniform sampler2D tRockO;
uniform sampler2D tSnowA;  uniform sampler2D tSnowN;  uniform sampler2D tSnowO;
uniform sampler2D tDirtA;  uniform sampler2D tDirtN;  uniform sampler2D tDirtO;
#if TERRAIN_MATS > 4
uniform sampler2D tForestA; uniform sampler2D tForestN; uniform sampler2D tForestO;
uniform sampler2D tSandA;   uniform sampler2D tSandN;   uniform sampler2D tSandO;
#endif

uniform float uWorldSize;
uniform float uSnowLine;
uniform float uSnowAmount;
uniform float uWetness;
uniform float uSeaLevel;
uniform float uLakeLevel;
uniform vec2  uTile;          // near / far tiling in metres
uniform float uMacro;

float thash(vec2 p){ return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453123); }
float tnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(thash(i), thash(i + vec2(1,0)), f.x),
             mix(thash(i + vec2(0,1)), thash(i + vec2(1,1)), f.x), f.y);
}
float tfbm(vec2 p){
  return tnoise(p) * 0.55 + tnoise(p * 2.13) * 0.28 + tnoise(p * 4.31) * 0.17;
}

/* smoothstep that tolerates reversed edges. GLSL leaves edge0 >= edge1
   undefined, and on some drivers it silently returns 1.0 — which is how the
   whole map once ended up sand-coloured. */
float tstep(float a, float b, float x){
  return a < b ? smoothstep(a, b, x) : 1.0 - smoothstep(b, a, x);
}

/* Albedo maps are tagged sRGB. three decodes them inside <map_fragment>, which
   we replace wholesale — so the decode has to happen here or every ground
   material comes out roughly twice as bright and washed out. */
vec3 sRGBToLinear(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 albedoTex(sampler2D t, vec2 uv){ return sRGBToLinear(texture2D(t, uv).rgb); }
`;

const TERRAIN_FRAG = /* glsl */`
  // ---- world-space UVs -----------------------------------------------------
  vec2 uvFlat = vWPos.xz / uTile.x;
  // A fixed diagonal wall projection ruled the hillsides with stripes; project
  // onto whichever vertical plane the slope actually faces instead. The switch
  // is invisible because the rock texture is stochastic.
  vec2 uvWall = (abs(vWNormal.x) > abs(vWNormal.z))
    ? vec2(vWPos.z, vWPos.y) / uTile.x
    : vec2(vWPos.x, vWPos.y) / uTile.x;
  vec2 uvRock = mix(uvFlat, uvWall, smoothstep(0.28, 0.66, vSteep));

  vec2 bUv = vWPos.xz / uWorldSize + 0.5;
  vec4 biome = texture2D(tBiome, clamp(bUv, 0.002, 0.998));
  float moisture = biome.r;
  float rocky    = biome.g;
  float road     = biome.b;
  float forest   = biome.a;
  // The road mask is baked at ~10 m per texel, so bilinear filtering smears a
  // seven-metre track into a thirty-metre stain. Put the edge back.
  road = smoothstep(0.34, 0.74, road);

  // ---- splat weights -------------------------------------------------------
  float macro = tfbm(vWPos.xz * 0.0035);
  float macro2 = tfbm(vWPos.xz * 0.021 + 11.0);

  float steep = smoothstep(0.24, 0.62, vSteep + (macro2 - 0.5) * 0.22 + rocky * 0.12);
  float alt   = vWPos.y;

  float snowT = uSnowLine - uSnowAmount * 340.0 + (macro - 0.5) * 90.0;
  float wSnow = smoothstep(snowT, snowT + 90.0, alt) * (1.0 - smoothstep(0.34, 0.72, vSteep));
  wSnow = max(wSnow, uSnowAmount * (1.0 - smoothstep(0.22, 0.55, vSteep)) * smoothstep(-10.0, 40.0, alt) * 0.9);

  float wRock = steep * (0.55 + rocky * 0.5);
  wRock = clamp(wRock, 0.0, 1.0);

  float wDirt = clamp(road * 1.35 + (1.0 - moisture) * 0.16 * (1.0 - steep), 0.0, 1.0);

#if TERRAIN_MATS > 4
  float wSand = tstep(6.5, -1.0, alt - uSeaLevel) * (1.0 - steep * 0.8);
  wSand = max(wSand, tstep(2.2, -0.6, abs(alt - uLakeLevel)) * (1.0 - steep) * 0.85);
  float wForest = forest * forest * (1.0 - steep) * (1.0 - wSnow) * 0.85;
#else
  float wSand = 0.0;
  float wForest = 0.0;
  wDirt = clamp(wDirt + tstep(6.5, -1.0, alt - uSeaLevel) * 0.9, 0.0, 1.0);
#endif

  // Green is the ground colour of this province: let grass hold the meadows
  // instead of being crowded out by four kinds of brown.
  float wGrass = clamp(1.0 - wRock - wSnow - wDirt - wSand - wForest, 0.0, 1.0);
  wGrass *= smoothstep(-2.0, 6.0, alt - uSeaLevel);
  wGrass *= 1.0 + moisture * 0.55;

  float wsum = wGrass + wRock + wSnow + wDirt + wSand + wForest + 1e-4;
  wGrass /= wsum; wRock /= wsum; wSnow /= wsum; wDirt /= wsum; wSand /= wsum; wForest /= wsum;

  // ---- sample ---------------------------------------------------------------
  vec3 alb = vec3(0.0), nrm = vec3(0.0);
  vec3 orm = vec3(0.0);

  alb += albedoTex(tGrassA, uvFlat) * wGrass;
  orm += texture2D(tGrassO, uvFlat).rgb * wGrass;
  nrm += (texture2D(tGrassN, uvFlat).rgb * 2.0 - 1.0) * wGrass;

  alb += albedoTex(tRockA, uvRock) * wRock;
  orm += texture2D(tRockO, uvRock).rgb * wRock;
  nrm += (texture2D(tRockN, uvRock).rgb * 2.0 - 1.0) * wRock;

  alb += albedoTex(tSnowA, uvFlat) * wSnow;
  orm += texture2D(tSnowO, uvFlat).rgb * wSnow;
  nrm += (texture2D(tSnowN, uvFlat).rgb * 2.0 - 1.0) * wSnow;

  alb += albedoTex(tDirtA, uvFlat) * wDirt;
  orm += texture2D(tDirtO, uvFlat).rgb * wDirt;
  nrm += (texture2D(tDirtN, uvFlat).rgb * 2.0 - 1.0) * wDirt;

#if TERRAIN_MATS > 4
  alb += albedoTex(tForestA, uvFlat) * wForest;
  orm += texture2D(tForestO, uvFlat).rgb * wForest;
  nrm += (texture2D(tForestN, uvFlat).rgb * 2.0 - 1.0) * wForest;

  alb += albedoTex(tSandA, uvFlat) * wSand;
  orm += texture2D(tSandO, uvFlat).rgb * wSand;
  nrm += (texture2D(tSandN, uvFlat).rgb * 2.0 - 1.0) * wSand;
#endif

  // ---- distance ------------------------------------------------------------
  // Past a hundred metres a 2.6 m tile is well under a pixel, so it mips to its
  // own average and the whole hillside goes flat. Blending in a second sample
  // at ten times the scale keeps real structure out there; flattening the
  // normal and floor-ing roughness kills the specular sparkle that reads as
  // grain on distant slopes.
  float camDist = length(vWPos - cameraPosition);
  float farB = smoothstep(70.0, 300.0, camDist);
  if (farB > 0.002){
    vec2 uvFar = vWPos.xz / uTile.y;
    vec3 albFar = albedoTex(tGrassA, uvFar) * (wGrass + wForest)
                + albedoTex(tRockA,  uvFar) * (wRock + wDirt + wSand)
                + albedoTex(tSnowA,  uvFar) * wSnow;
    alb = mix(alb, albFar, farB * 0.8);
    nrm = mix(nrm, vec3(0.0, 0.0, 1.0), farB);
    orm.g = mix(orm.g, max(orm.g, 0.72), farB);
  }

  // large-scale colour variation hides the tiling completely
  alb *= mix(1.0 - uMacro, 1.0 + uMacro, macro);
  alb *= 0.93 + 0.14 * macro2;
  // A slight hue drift with the macro field: real ground is never one colour
  // over a kilometre, and a pure brightness ramp still reads as flat.
  alb *= mix(vec3(1.06, 1.00, 0.90), vec3(0.92, 1.02, 1.06), macro);

  // wetness darkens and smooths, and pools in the hollows
  float wet = uWetness * (0.55 + 0.45 * vOcc) * (1.0 - wSnow * 0.85);
  alb *= mix(1.0, 0.58, wet);

  diffuseColor.rgb *= alb;
  vTerrainRough = clamp(mix(orm.g, 0.12, wet * 0.8), 0.03, 1.0);
  vTerrainAO = clamp(orm.r * vOcc, 0.0, 1.0);
  vTerrainNormal = normalize(vec3(nrm.xy, max(nrm.z, 0.25)));
`;

/**
 * Builds the terrain material by grafting the splat code into three's standard
 * shader. Keeping MeshStandardMaterial as the base means we inherit CSM,
 * environment lighting, fog and shadow receiving for free.
 */
export function makeTerrainMaterial(bakery, opts = {}) {
  const mats = settings.get('textureQuality') >= 2 ? 6 : 4;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
    side: THREE.DoubleSide,   // LOD skirts are cheaper to double-side than to wind perfectly
  });
  mat.defines = { TERRAIN_MATS: mats };

  const tex = n => bakery.get(n);
  const g = tex('grass'), r = tex('rock'), s = tex('snow'), d = tex('dirt');
  const f = tex('forestFloor'), sa = tex('sand');

  const uniforms = {
    tBiome: { value: opts.biomeTexture },
    tGrassA: { value: g.albedo }, tGrassN: { value: g.normal }, tGrassO: { value: g.orm },
    tRockA: { value: r.albedo }, tRockN: { value: r.normal }, tRockO: { value: r.orm },
    tSnowA: { value: s.albedo }, tSnowN: { value: s.normal }, tSnowO: { value: s.orm },
    tDirtA: { value: d.albedo }, tDirtN: { value: d.normal }, tDirtO: { value: d.orm },
    tForestA: { value: f.albedo }, tForestN: { value: f.normal }, tForestO: { value: f.orm },
    tSandA: { value: sa.albedo }, tSandN: { value: sa.normal }, tSandO: { value: sa.orm },
    uWorldSize: { value: WORLD_SIZE },
    uSnowLine: { value: 230 },
    uSnowAmount: { value: 0 },
    uWetness: { value: 0 },
    uSeaLevel: { value: SEA_LEVEL },
    uLakeLevel: { value: opts.lakeLevel ?? 22 },
    uTile: { value: new THREE.Vector2(2.6, 27) },
    uMacro: { value: 0.34 },
  };
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aOcc;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        varying float vOcc;
        varying float vSteep;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);
        vOcc = aOcc;
        vSteep = 1.0 - vWNormal.y;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${TERRAIN_PARS}
        float vTerrainRough; float vTerrainAO; vec3 vTerrainNormal;`)
      .replace('#include <map_fragment>', TERRAIN_FRAG)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = vTerrainRough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = 0.0;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 vp = -vViewPosition;
          vec3 q0 = dFdx(vp), q1 = dFdy(vp);
          vec2 st0 = dFdx(vWPos.xz), st1 = dFdy(vWPos.xz);
          vec3 Tv = q0 * st1.y - q1 * st0.y;
          vec3 Bv = -q0 * st1.x + q1 * st0.x;
          float sc = max(max(dot(Tv, Tv), dot(Bv, Bv)), 1e-12);
          Tv *= inversesqrt(sc); Bv *= inversesqrt(sc);
          mat3 tbn = mat3(normalize(Tv), normalize(Bv), normal);
          normal = normalize(tbn * vTerrainNormal);
        }`)
      .replace('#include <aomap_fragment>', `
        {
          float ao = vTerrainAO;
          reflectedLight.indirectDiffuse *= ao;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ao, material.roughness );
          #endif
        }`);
  };
  mat.customProgramCacheKey = () => 'wyrm-terrain-' + mats;
  return mat;
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

class Chunk {
  constructor(grid) {
    this.grid = grid;
    const n = grid + 1;
    const vertCount = n * n + (n * 4);            // grid + skirt ring
    this.positions = new Float32Array(vertCount * 3);
    this.normals = new Float32Array(vertCount * 3);
    this.occ = new Float32Array(vertCount);
    const quadCount = grid * grid + grid * 4;
    this.indices = new Uint32Array(quadCount * 6);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    this.geometry.setAttribute('aOcc', new THREE.BufferAttribute(this.occ, 1));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.mesh = new THREE.Mesh(this.geometry, null);
    this.mesh.frustumCulled = false;   // the quadtree already culled it
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.key = null;
    this.lastUsed = 0;
  }

  /** Fills the buffers for a square region of the world. */
  build(hf, ox, oz, size) {
    const grid = this.grid, n = grid + 1;
    const step = size / grid;
    const heights = this._h || (this._h = new Float32Array((n + 2) * (n + 2)));
    const hn = n + 2;

    // Sample one ring beyond the chunk so normals at the seams are correct.
    for (let j = 0; j < hn; j++) {
      const z = oz + (j - 1) * step;
      for (let i = 0; i < hn; i++) {
        heights[j * hn + i] = hf.heightAt(ox + (i - 1) * step, z);
      }
    }

    const pos = this.positions, nor = this.normals, occ = this.occ;
    let minY = Infinity, maxY = -Infinity;
    const inv2s = 1 / (2 * step);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const vi = j * n + i;
        const hi = (j + 1) * hn + (i + 1);
        const h = heights[hi];
        pos[vi * 3] = i * step;
        pos[vi * 3 + 1] = h;
        pos[vi * 3 + 2] = j * step;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;

        const hl = heights[hi - 1], hr = heights[hi + 1];
        const hd = heights[hi - hn], hu = heights[hi + hn];
        let nx = (hl - hr) * inv2s, ny = 1, nz = (hd - hu) * inv2s;
        const il = 1 / Math.hypot(nx, ny, nz);
        nor[vi * 3] = nx * il; nor[vi * 3 + 1] = ny * il; nor[vi * 3 + 2] = nz * il;

        // Cheap curvature AO: how much lower is this vertex than its neighbours?
        const avg = (hl + hr + hd + hu) * 0.25;
        occ[vi] = clamp(1.0 - (avg - h) / (step * 1.6 + 1e-4) * 0.65, 0.35, 1.0);
      }
    }

    // --- skirt ------------------------------------------------------------
    const skirtDrop = Math.max(2.5, step * 1.6);
    let sv = n * n;
    const skirtBase = sv;
    const addSkirt = (i, j) => {
      const src = j * n + i;
      pos[sv * 3] = pos[src * 3];
      pos[sv * 3 + 1] = pos[src * 3 + 1] - skirtDrop;
      pos[sv * 3 + 2] = pos[src * 3 + 2];
      nor[sv * 3] = nor[src * 3]; nor[sv * 3 + 1] = nor[src * 3 + 1]; nor[sv * 3 + 2] = nor[src * 3 + 2];
      occ[sv] = occ[src];
      return sv++;
    };
    const skirtIdx = { top: [], bottom: [], left: [], right: [] };
    for (let i = 0; i < n; i++) skirtIdx.top.push(addSkirt(i, 0));
    for (let i = 0; i < n; i++) skirtIdx.bottom.push(addSkirt(i, n - 1));
    for (let j = 0; j < n; j++) skirtIdx.left.push(addSkirt(0, j));
    for (let j = 0; j < n; j++) skirtIdx.right.push(addSkirt(n - 1, j));

    // --- indices ----------------------------------------------------------
    const idx = this.indices;
    let k = 0;
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    for (let i = 0; i < grid; i++) {
      // top edge (j = 0), winding outward
      let a = 0 * n + i, b = a + 1, c = skirtIdx.top[i], d = skirtIdx.top[i + 1];
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
      // bottom edge
      a = (n - 1) * n + i; b = a + 1; c = skirtIdx.bottom[i]; d = skirtIdx.bottom[i + 1];
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
      // left edge
      a = i * n; b = a + n; c = skirtIdx.left[i]; d = skirtIdx.left[i + 1];
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
      // right edge
      a = i * n + (n - 1); b = a + n; c = skirtIdx.right[i]; d = skirtIdx.right[i + 1];
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }

    const geo = this.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.aOcc.needsUpdate = true;
    geo.index.needsUpdate = true;
    geo.setDrawRange(0, k);
    geo.boundingSphere = geo.boundingSphere || new THREE.Sphere();
    geo.boundingSphere.center.set(size * 0.5, (minY + maxY) * 0.5, size * 0.5);
    geo.boundingSphere.radius = Math.hypot(size * 0.707, (maxY - minY) * 0.5 + skirtDrop) + 1;

    this.mesh.position.set(ox, 0, oz);
    this.mesh.updateMatrix();
    this.minY = minY; this.maxY = maxY;
    this.size = size;
  }

  dispose() { this.geometry.dispose(); }
}

// ---------------------------------------------------------------------------

export class Terrain {
  constructor(hf, bakery, biomeTexture) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = makeTerrainMaterial(bakery, { biomeTexture, lakeLevel: hf.lakeLevel });

    this.grid = 32;
    this.pool = [];
    this.active = new Map();       // key -> chunk
    this.cache = new Map();        // key -> chunk (built, currently unused)
    this.maxCache = 220;
    this.buildQueue = [];
    // Generating a chunk costs ~1.5 ms of noise evaluation, so this is really
    // "how many chunks may appear this frame". Phones get one.
    this.frameBudgetMs = settings.effectivePlatform === 'mobile' ? 1.6 : 3.0;
    this._tmpBox = new THREE.Box3();
    this._tmpSphere = new THREE.Sphere();
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._visited = new Set();
    this.stats = { chunks: 0, built: 0, queued: 0 };
  }

  setGrid(grid) {
    grid = clamp(Math.round(grid / 4) * 4, 12, 64);
    if (grid === this.grid) return;
    this.grid = grid;
    for (const c of this.active.values()) { this.group.remove(c.mesh); c.dispose(); }
    for (const c of this.cache.values()) c.dispose();
    for (const c of this.pool) c.dispose();
    this.active.clear(); this.cache.clear(); this.pool.length = 0;
    this.buildQueue.length = 0;
  }

  _acquire() {
    if (this.pool.length) return this.pool.pop();
    const c = new Chunk(this.grid);
    c.mesh.material = this.material;
    return c;
  }

  _release(chunk) {
    this.group.remove(chunk.mesh);
    if (this.cache.size < this.maxCache) {
      this.cache.set(chunk.key, chunk);
    } else {
      // evict the least recently used entry, then keep this one
      let oldest = null, oldestT = Infinity;
      for (const [k, c] of this.cache) if (c.lastUsed < oldestT) { oldestT = c.lastUsed; oldest = k; }
      if (oldest !== null) { const c = this.cache.get(oldest); this.cache.delete(oldest); this.pool.push(c); }
      this.cache.set(chunk.key, chunk);
    }
  }

  /** Recomputes which chunks should exist and streams in the missing ones. */
  update(camera, dt, frame) {
    const vd = settings.get('viewDistance');
    const detail = settings.get('terrainDetail');
    this.setGrid(32 * detail);

    const maxDist = clamp(1500 * vd, 500, 3400);
    const lodFactor = 2.15 * clamp(vd, 0.5, 2.0);
    const minSize = 64;

    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);

    const cx = camera.position.x, cz = camera.position.z;
    const wanted = this._visited;
    wanted.clear();
    this.buildQueue.length = 0;

    const visit = (ox, oz, size) => {
      const half = size * 0.5;
      const ccx = ox + half, ccz = oz + half;
      const dx = Math.max(0, Math.abs(cx - ccx) - half);
      const dz = Math.max(0, Math.abs(cz - ccz) - half);
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist) return;

      if (size > minSize && dist < size * lodFactor) {
        const h = size * 0.5;
        visit(ox, oz, h); visit(ox + h, oz, h);
        visit(ox, oz + h, h); visit(ox + h, oz + h, h);
        return;
      }

      // Frustum test against a conservative box (terrain height range).
      this._tmpSphere.center.set(ccx, 220, ccz);
      this._tmpSphere.radius = Math.hypot(half * 1.42, 460);
      if (!this._frustum.intersectsSphere(this._tmpSphere)) return;

      const key = `${ox}|${oz}|${size}`;
      wanted.add(key);
      if (this.active.has(key)) { this.active.get(key).lastUsed = frame; return; }
      const cached = this.cache.get(key);
      if (cached) {
        this.cache.delete(key);
        cached.lastUsed = frame;
        this.active.set(key, cached);
        this.group.add(cached.mesh);
        return;
      }
      this.buildQueue.push({ key, ox, oz, size, dist });
    };

    visit(-WORLD_HALF, -WORLD_HALF, WORLD_SIZE);

    // Retire chunks that are no longer wanted.
    for (const [key, chunk] of this.active) {
      if (!wanted.has(key)) { this.active.delete(key); this._release(chunk); }
    }

    // Build nearest-first, within a time budget so streaming never stutters.
    // A frame that has already blown its deadline gets no discretionary work:
    // piling chunk generation onto a slow frame is what turns one dropped
    // frame into a visible stutter.
    this.buildQueue.sort((a, b) => a.dist - b.dist);
    const target = 1 / Math.max(24, settings.get('targetFps'));
    const behind = dt > target * 1.6 && this.active.size > 24;
    const budget = behind ? 0 : this.frameBudgetMs;
    const t0 = performance.now();
    let built = 0;
    for (const job of this.buildQueue) {
      if (budget <= 0 && built > 0) break;
      if (built > 0 && performance.now() - t0 > budget) break;
      const chunk = this._acquire();
      chunk.key = job.key;
      chunk.lastUsed = frame;
      chunk.build(this.hf, job.ox, job.oz, job.size);
      this.active.set(job.key, chunk);
      this.group.add(chunk.mesh);
      built++;
    }
    this.stats.chunks = this.active.size;
    this.stats.built = built;
    this.stats.queued = Math.max(0, this.buildQueue.length - built);
  }

  /** Blocks until every currently-wanted chunk exists (used during loading). */
  buildAllPending(camera, frame, maxMs = 4000) {
    const t0 = performance.now();
    let guard = 0;
    do {
      const before = this.stats.queued;
      const saved = this.frameBudgetMs;
      this.frameBudgetMs = 1e9;
      this.update(camera, 0, frame);
      this.frameBudgetMs = saved;
      if (this.stats.queued === 0) break;
      if (++guard > 12) break;
      if (performance.now() - t0 > maxMs) break;
    } while (true);
  }

  setEnv(env) {
    const u = this.material.userData.uniforms;
    u.uSnowAmount.value = env.snowCover ?? 0;
    u.uWetness.value = env.wetness ?? 0;
    u.uSnowLine.value = env.snowLine ?? 230;
  }

  dispose() {
    for (const c of this.active.values()) c.dispose();
    for (const c of this.cache.values()) c.dispose();
    for (const c of this.pool) c.dispose();
    this.material.dispose();
  }
}
