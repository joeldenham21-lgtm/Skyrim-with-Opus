/**
 * WYRMHOLD — water.
 *
 * Sea, lake and river share one material built on MeshStandardMaterial, so
 * they inherit the sky's image-based reflections, the sun's specular highlight,
 * cascaded shadows and fog for free. On top of that we graft:
 *
 *   • Gerstner swell in the vertex stage (with analytic normals)
 *   • three layers of scrolling ripple normals in the fragment stage
 *   • depth read from the baked world heightmap → absorption, shoreline
 *     transparency and foam that always lines up with the terrain
 *   • screen-space refraction from the copied opaque buffer
 *   • caustic shimmer in the shallows
 */

import * as THREE from 'three';
import { WORLD_SIZE, SEA_LEVEL } from './heightfield.js';
import { settings } from '../core/settings.js';

const WATER_PARS = /* glsl */`
uniform sampler2D tHeight;
uniform sampler2D tOpaque;
uniform vec2  uOpaqueTexel;
uniform float uTime;
uniform float uWorldSize;
uniform float uWaterLevel;
uniform vec3  uDeepColor;
uniform vec3  uShallowColor;
uniform vec3  uFoamColor;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uChoppy;
uniform float uFoamWidth;
uniform float uRefraction;
uniform float uCaustics;
uniform vec2  uWindDir;
uniform float uFlow;

varying vec3 vWorld;
varying float vLevel;
varying vec3 vWaveNormal;
varying float vWaveCrest;
varying vec4 vScreen;

float wHash(vec2 p){ return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453123); }
float wNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1,0)), f.x),
             mix(wHash(i + vec2(0,1)), wHash(i + vec2(1,1)), f.x), f.y);
}
float wFbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ s += a * wNoise(p); p *= 2.07; a *= 0.5; }
  return s;
}

/** Terrain height under a world position, from the baked map. */
float terrainH(vec2 xz){
  vec2 uv = xz / uWorldSize + 0.5;
  return texture2D(tHeight, clamp(uv, 0.001, 0.999)).r;
}
`;

const WATER_VERT_WAVES = /* glsl */`
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;

  // --- Gerstner swell -------------------------------------------------------
  vec3 disp = vec3(0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bino = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;
  {
    const int NW = 4;
    vec2 dirs[4];
    dirs[0] = normalize(uWindDir);
    dirs[1] = normalize(uWindDir + vec2( 0.75, -0.55));
    dirs[2] = normalize(uWindDir + vec2(-0.62,  0.80));
    dirs[3] = normalize(uWindDir * 0.4 + vec2( 0.35,  0.92));
    float lens[4]; lens[0] = 62.0; lens[1] = 31.0; lens[2] = 17.0; lens[3] = 9.0;
    float amps[4]; amps[0] = 0.72; amps[1] = 0.34; amps[2] = 0.16; amps[3] = 0.08;
    for (int i = 0; i < NW; i++){
      float L = lens[i] * uWaveScale;
      float k = 6.2831853 / L;
      float c = sqrt(9.81 / k);
      float A = amps[i] * uWaveScale;
      float f = k * (dot(dirs[i], wp.xz) - c * uTime * uWaveSpeed);
      float sf = sin(f), cf = cos(f);
      float Q = uChoppy / (k * A * float(NW) + 1e-4);
      disp.xz += Q * A * dirs[i] * cf;
      disp.y  += A * sf;
      tang += vec3(-Q * A * k * dirs[i].x * dirs[i].x * sf,
                    dirs[i].x * A * k * cf,
                   -Q * A * k * dirs[i].x * dirs[i].y * sf);
      bino += vec3(-Q * A * k * dirs[i].x * dirs[i].y * sf,
                    dirs[i].y * A * k * cf,
                   -Q * A * k * dirs[i].y * dirs[i].y * sf);
      crest += max(0.0, sf) * amps[i];
    }
  }

  // Flatten the swell where the water is shallow, so it never clips the bed.
  float bed = terrainH(wp.xz);
  float depth0 = max(0.0, uWaterLevel - bed);
  float shallow = smoothstep(0.0, 4.5, depth0);
  disp *= shallow;

  // Water meshes carry no rotation or scale (the plane is pre-rotated in its
  // geometry), so the world-space displacement can be added directly.
  transformed += disp;
  vWorld = wp + disp;
  vLevel = wp.y;
  vWaveCrest = crest * shallow;
  vWaveNormal = normalize(cross(normalize(bino), normalize(tang)));
  if (vWaveNormal.y < 0.0) vWaveNormal = -vWaveNormal;
`;

const WATER_FRAG = /* glsl */`
  // --- ripple normals -------------------------------------------------------
  vec2 fw = normalize(uWindDir) * uTime * uFlow;
  vec2 p1 = vWorld.xz * 0.34 + fw * 0.9;
  vec2 p2 = vWorld.xz * 0.85 - fw * 1.5 + 17.0;
  vec2 p3 = vWorld.xz * 2.30 + fw * 2.4 + 91.0;
  float e = 0.55;
  float n1 = wFbm(p1), n2 = wFbm(p2), n3 = wFbm(p3);
  float hx = (wFbm(p1 + vec2(e, 0.0)) - n1) * 1.0
           + (wFbm(p2 + vec2(e, 0.0)) - n2) * 0.55
           + (wFbm(p3 + vec2(e, 0.0)) - n3) * 0.28;
  float hz = (wFbm(p1 + vec2(0.0, e)) - n1) * 1.0
           + (wFbm(p2 + vec2(0.0, e)) - n2) * 0.55
           + (wFbm(p3 + vec2(0.0, e)) - n3) * 0.28;

  vec3 rippleN = normalize(vec3(-hx * 2.4, 1.0, -hz * 2.4));
  vec3 wN = normalize(vWaveNormal + vec3(rippleN.x, 0.0, rippleN.z) * 1.35);

  // --- depth / shoreline ----------------------------------------------------
  // vLevel is the *undisplaced* surface height, which is constant for the sea
  // and lake but varies along the river as it falls toward the coast.
  float bedH = terrainH(vWorld.xz);
  float depth = vLevel - bedH;
  if (depth < 0.03) discard;
  float shoreT = smoothstep(0.0, uFoamWidth, depth);
  float absorb = 1.0 - exp(-depth * 0.36);

  // --- refraction -----------------------------------------------------------
  vec2 sUv = vScreen.xy / max(vScreen.w, 1e-4) * 0.5 + 0.5;
  vec2 rOff = wN.xz * uRefraction * (0.02 + 0.05 * min(depth, 6.0));
  vec3 refr = texture2D(tOpaque, clamp(sUv + rOff, 0.002, 0.998)).rgb;

  vec3 waterCol = mix(uShallowColor, uDeepColor, absorb);
  vec3 body = mix(refr * mix(vec3(1.0), waterCol * 2.6, absorb), waterCol, absorb * 0.72);

  // --- caustic shimmer in the shallows --------------------------------------
  float caus = 0.0;
  if (uCaustics > 0.001){
    float c1 = wFbm(vWorld.xz * 1.6 + fw * 1.2);
    float c2 = wFbm(vWorld.xz * 1.6 - fw * 0.8 + 3.0);
    caus = pow(1.0 - abs(c1 - c2) * 2.4, 6.0);
    caus *= uCaustics * (1.0 - smoothstep(0.0, 3.2, depth)) * shoreT;
    body += vec3(0.55, 0.75, 0.72) * caus * 0.9;
  }

  // --- foam ------------------------------------------------------------------
  float foamNoise = wFbm(vWorld.xz * 1.9 + fw * 2.6);
  float shoreFoam = (1.0 - shoreT) * smoothstep(0.42, 0.92, foamNoise + 0.18);
  float crestFoam = smoothstep(0.55, 0.95, vWaveCrest * 1.6) * smoothstep(0.35, 0.9, foamNoise);
  float foam = clamp(shoreFoam * 0.85 + crestFoam * 0.45, 0.0, 1.0);
  body = mix(body, uFoamColor, foam * 0.92);

  diffuseColor.rgb = body;
  diffuseColor.a = max(smoothstep(0.03, 0.40, depth), foam * 0.95);

  vWaterRough = mix(0.06, 0.34, foam) + caus * 0.1;
  vWaterNormal = wN;
`;

export function makeWaterMaterial(opts) {
  const q = settings.get('waterQuality');
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0.0,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    envMapIntensity: 1.35,
  });

  const uniforms = {
    tHeight: { value: opts.heightTexture },
    tOpaque: { value: null },
    uOpaqueTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    uTime: { value: 0 },
    uWorldSize: { value: WORLD_SIZE },
    uWaterLevel: { value: opts.level ?? SEA_LEVEL },
    uDeepColor: { value: new THREE.Color(opts.deep ?? 0x0a2129) },
    uShallowColor: { value: new THREE.Color(opts.shallow ?? 0x2f6f6a) },
    uFoamColor: { value: new THREE.Color(0xdfe9ec) },
    uWaveScale: { value: opts.waveScale ?? 1 },
    uWaveSpeed: { value: 1 },
    uChoppy: { value: q === 'low' ? 0 : 0.85 },
    uFoamWidth: { value: opts.foamWidth ?? 2.4 },
    uRefraction: { value: q === 'low' ? 0 : 1 },
    uCaustics: { value: q === 'ultra' ? 1 : q === 'high' ? 0.55 : 0 },
    uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
    uFlow: { value: 0.05 },
  };
  mat.userData.uniforms = uniforms;
  mat.userData.isWater = true;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WATER_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WATER_VERT_WAVES}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vScreen = gl_Position;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_PARS}\nfloat vWaterRough; vec3 vWaterNormal;`)
      .replace('#include <map_fragment>', WATER_FRAG)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = vWaterRough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = 0.0;`)
      .replace('#include <normal_fragment_maps>', `
        normal = normalize((viewMatrix * vec4(vWaterNormal, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'wyrm-water';
  return mat;
}

// ---------------------------------------------------------------------------

/** Builds a ribbon mesh following a polyline, with a per-point width. */
function ribbonGeometry(points, widths, levels, segsAcross = 6) {
  const pos = [], idx = [], nrm = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx2, nz2] = points[Math.min(n - 1, i + 1)];
    let dx = nx2 - px, dz = nz2 - pz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const sx = -dz, sz = dx;
    const w = widths[i];
    for (let k = 0; k <= segsAcross; k++) {
      const t = k / segsAcross * 2 - 1;
      pos.push(x + sx * w * t, levels[i], z + sz * w * t);
      nrm.push(0, 1, 0);
    }
  }
  const stride = segsAcross + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < segsAcross; k++) {
      const a = i * stride + k, b = a + 1, c = a + stride, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class WaterSystem {
  constructor(hf, heightTexture) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.materials = [];

    const q = settings.get('waterQuality');
    const seaSegs = q === 'ultra' ? 320 : q === 'high' ? 192 : q === 'medium' ? 96 : 32;

    // --- sea ---------------------------------------------------------------
    const seaSize = WORLD_SIZE * 2.6;
    const seaGeo = new THREE.PlaneGeometry(seaSize, seaSize, seaSegs, seaSegs);
    seaGeo.rotateX(-Math.PI / 2);
    this.seaMat = makeWaterMaterial({
      heightTexture, level: SEA_LEVEL,
      deep: 0x071a24, shallow: 0x2c6f74, waveScale: 1.0, foamWidth: 1.8,
    });
    this.sea = new THREE.Mesh(seaGeo, this.seaMat);
    this.sea.position.set(0, SEA_LEVEL, 0);
    this.sea.receiveShadow = false;
    this.sea.renderOrder = 10;
    this.group.add(this.sea);
    this.materials.push(this.seaMat);

    // --- lake --------------------------------------------------------------
    const lake = hf.loc('lake');
    const lakeGeo = new THREE.PlaneGeometry(lake.radius * 3.6, lake.radius * 3.6,
      q === 'low' ? 16 : 64, q === 'low' ? 16 : 64);
    lakeGeo.rotateX(-Math.PI / 2);
    this.lakeMat = makeWaterMaterial({
      heightTexture, level: hf.lakeLevel,
      deep: 0x0d2320, shallow: 0x35706a, waveScale: 0.34, foamWidth: 0.9,
    });
    this.lake = new THREE.Mesh(lakeGeo, this.lakeMat);
    this.lake.position.set(lake.x, hf.lakeLevel, lake.z);
    this.lake.renderOrder = 11;
    this.group.add(this.lake);
    this.materials.push(this.lakeMat);

    // --- river -------------------------------------------------------------
    const pts = [], widths = [], levels = [];
    const river = [
      [180, -1240], [140, -1000], [40, -760], [-40, -520], [-90, -300],
      [-120, -60], [-150, 180], [-180, 420], [-230, 700], [-300, 1000],
      [-360, 1280], [-420, 1560],
    ];
    // resample for a smooth ribbon
    for (let i = 0; i < river.length - 1; i++) {
      for (let s = 0; s < 6; s++) {
        const t = s / 6;
        const x = river[i][0] + (river[i + 1][0] - river[i][0]) * t;
        const z = river[i][1] + (river[i + 1][1] - river[i][1]) * t;
        pts.push([x, z]);
        const u = (i + t) / (river.length - 1);
        widths.push(9 + u * 26);
        levels.push(hf.waterAt(x, z) ?? 0);
      }
    }
    const riverGeo = ribbonGeometry(pts, widths, levels, 8);
    this.riverMat = makeWaterMaterial({
      heightTexture, level: 0,
      deep: 0x11312e, shallow: 0x3d7d72, waveScale: 0.18, foamWidth: 1.1,
    });
    this.river = new THREE.Mesh(riverGeo, this.riverMat);
    this.river.renderOrder = 12;
    this.group.add(this.river);
    this.materials.push(this.riverMat);

    for (const m of this.group.children) m.frustumCulled = true;
  }

  /** River water level is per-vertex, so its material samples the mesh height. */
  update(env, camPos) {
    const t = env.timeSec;
    for (const m of this.materials) {
      const u = m.userData.uniforms;
      u.uTime.value = t;
      u.uWindDir.value.set(env.windX, env.windZ).normalize();
      u.uWaveSpeed.value = 0.55 + env.windStrength * 0.9;
      u.uWaveScale.value = (m === this.seaMat ? 1.0 : m === this.lakeMat ? 0.34 : 0.18)
        * (0.6 + env.windStrength * 0.8);
    }
    // Keep the sea centred on the camera so its tessellation follows the player.
    this.sea.position.x = Math.round(camPos.x / 64) * 64;
    this.sea.position.z = Math.round(camPos.z / 64) * 64;
    this.river.position.y = 0;
  }

  setOpaqueTexture(tex, w, h) {
    for (const m of this.materials) {
      m.userData.uniforms.tOpaque.value = tex;
      m.userData.uniforms.uOpaqueTexel.value.set(1 / w, 1 / h);
    }
  }

  dispose() {
    for (const c of this.group.children) c.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
