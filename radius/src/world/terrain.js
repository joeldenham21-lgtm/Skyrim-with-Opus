// Heightfield terrain: noise + hand-placed features from map.js. CPU height grid is the source of truth
// for both the mesh and getHeight(), so physics and visuals always agree.
import * as THREE from 'three';
import { fbm2, noise2, ridged2, hash2 } from '../core/rng.js';
import { clamp01, smoothstep, lerp } from '../core/math.js';
import { SIZE, HALF, WATER_LEVEL, POIS, ROADS, RAIL, distToPolyline, poi } from './map.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';

const N = 320;            // cells per side (2 m cells)
const CELL = SIZE / N;

function baseHeight(x, z) {
  // broad rolling hills + ridged detail, domain warped
  const wx = x + 40 * noise2(x * 0.004 + 3.1, z * 0.004);
  const wz = z + 40 * noise2(x * 0.004, z * 0.004 + 7.7);
  let h = 11 * fbm2(wx * 0.0055, wz * 0.0055, 4);
  h += 3.2 * ridged2(wx * 0.02, wz * 0.02, 3) - 1.2;
  h += 0.9 * fbm2(x * 0.07, z * 0.07, 3);
  h += 0.25 * noise2(x * 0.3, z * 0.3);
  return h;
}

export function computeHeight(x, z) {
  let h = baseHeight(x, z);
  // marsh basin: pulled down toward a flat wet floor
  const m = poi('marsh');
  const dm = Math.hypot(x - m.x, z - m.z) / m.r;
  const marsh = 1 - smoothstep(0.55, 1.15, dm);
  h = lerp(h, -1.6 + 0.5 * fbm2(x * 0.05, z * 0.05, 3), marsh * 0.92);
  // church hill
  const c = poi('church');
  const dc = Math.hypot(x - c.x, z - c.z);
  h += 15 * (1 - smoothstep(0, 75, dc)) * (1 - smoothstep(0, 75, dc));
  // northern ridge climbs toward the Column; the whole edge rises into a bowl
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
  h += 26 * smoothstep(0.86, 1.0, edge);
  h += 22 * smoothstep(0.72, 1.0, -z / HALF) * (1 - smoothstep(0.86, 1.0, edge) * 0.5);
  // village, substation, checkpoint and the base sit on gentle plateaus (applied last so the edge rise never buries them)
  for (const id of ['zarya', 'object12', 'vanno', 'checkpoint']) {
    const p = poi(id); const d = Math.hypot(x - p.x, z - p.z) / p.r;
    const w = 1 - smoothstep(0.55, 1.2, d);
    const plateau = plateauHeight(p);
    h = lerp(h, plateau + 0.35 * fbm2(x * 0.06, z * 0.06, 2), w * 0.9);
  }
  // rail cutting: constant grade line; cut through hills, embank over lows
  const rr = distToPolyline(x, z, RAIL.pts);
  const railH = 1.5 + 4.0 * rr.t;
  const railW = 1 - smoothstep(RAIL.width * 0.5, RAIL.width * 0.5 + 14, rr.d);
  h = lerp(h, railH, railW);
  // roads: flatten to a smoothed version of the terrain along the centreline
  for (const road of ROADS) {
    const r = distToPolyline(x, z, road.pts);
    const w = 1 - smoothstep(road.width * 0.5, road.width * 0.5 + 6, r.d);
    if (w > 0) {
      const smoothH = baseHeightSmooth(x, z);
      h = lerp(h, smoothH - 0.15, w * 0.9);
    }
  }
  return h;
}
const plateauHeight = (p) => (p.id === 'vanno' ? 5.5 : baseHeight(p.x, p.z) * 0.6 + 2.0);
function baseHeightSmooth(x, z) {
  // low-frequency only, so the road does not bump with the detail octaves
  const wx = x + 40 * noise2(x * 0.004 + 3.1, z * 0.004);
  const wz = z + 40 * noise2(x * 0.004, z * 0.004 + 7.7);
  let h = 11 * fbm2(wx * 0.0055, wz * 0.0055, 3);
  const m = poi('marsh');
  const dm = Math.hypot(x - m.x, z - m.z) / m.r;
  h = lerp(h, -1.0, (1 - smoothstep(0.55, 1.15, dm)) * 0.92);
  const c = poi('church'); const dc = Math.hypot(x - c.x, z - c.z);
  h += 15 * Math.pow(1 - smoothstep(0, 75, dc), 2);
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
  h += 26 * smoothstep(0.86, 1.0, edge) + 22 * smoothstep(0.72, 1.0, -z / HALF);
  for (const id of ['zarya', 'object12', 'vanno', 'checkpoint']) {
    const p = poi(id); const d = Math.hypot(x - p.x, z - p.z) / p.r;
    h = lerp(h, plateauHeight(p), (1 - smoothstep(0.55, 1.2, d)) * 0.9);
  }
  return h + 0.3;
}

export function createTerrain(ctx) {
  const { scene } = ctx;
  const V = N + 1;
  const heights = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) heights[j * V + i] = computeHeight(-HALF + i * CELL, -HALF + j * CELL);

  const getHeight = (x, z) => {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = Math.max(0, Math.min(N - 1, Math.floor(fx))), j = Math.max(0, Math.min(N - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const h00 = heights[j * V + i], h10 = heights[j * V + i + 1], h01 = heights[(j + 1) * V + i], h11 = heights[(j + 1) * V + i + 1];
    // match the triangle split used by PlaneGeometry (diagonal from (i,j+1) to (i+1,j))
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };
  const getNormal = (x, z, out) => {
    const e = 0.6;
    const hl = getHeight(x - e, z), hr = getHeight(x + e, z), hd = getHeight(x, z - e), hu = getHeight(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  };

  // ---- geometry ----
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const surf = new Float32Array(pos.count * 4);   // grass, mud, road, rock
  const wet = new Float32Array(pos.count);
  const nrm = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const h = getHeight(x, z);
    pos.setY(k, h);
    getNormal(x, z, nrm);
    const slope = 1 - nrm.y;
    let road = 0;
    for (const r of ROADS) { const d = distToPolyline(x, z, r.pts).d; road = Math.max(road, 1 - smoothstep(r.width * 0.5 - 0.5, r.width * 0.5 + 1.2, d)); }
    const rail = 1 - smoothstep(RAIL.width * 0.5 - 1, RAIL.width * 0.5 + 2.5, distToPolyline(x, z, RAIL.pts).d);
    road = Math.max(road, rail * 0.8);
    const rock = smoothstep(0.22, 0.5, slope) + smoothstep(18, 30, h) * 0.6;
    const wetness = clamp01((0.6 - h) / 2.2) + 0.25 * (fbm2(x * 0.03, z * 0.03, 3) + 0.5) * clamp01((3 - h) / 3);
    const mudN = 0.5 + 0.5 * fbm2(x * 0.02 + 9, z * 0.02, 3);
    let mud = clamp01(wetness * 1.3 + smoothstep(0.55, 0.85, mudN) * 0.7);
    let grass = clamp01(1 - mud - rock);
    const sum = grass + mud + rock + road + 1e-4;
    surf[k * 4] = grass / sum; surf[k * 4 + 1] = mud / sum; surf[k * 4 + 2] = road / sum; surf[k * 4 + 3] = rock / sum;
    wet[k] = clamp01(wetness);
  }
  geo.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
  geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.uniforms.uTime = { value: 0 };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aSurf; attribute float aWet; varying vec4 vSurf; varying float vWet; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurf = aSurf; vWet = aWet; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec4 vSurf; varying float vWet; varying vec3 vWPos; uniform float uTime;`)
      .replace('#include <map_fragment>', /* glsl */`
        vec2 wp = vWPos.xz;
        float macro = fbm3(wp * 0.035);
        float micro = vnoise(wp * 1.7) * 0.6 + vnoise(wp * 5.3) * 0.4;
        float clump = worley(wp * 0.9);
        // dead grass: yellow-olive tufts with darker roots
        vec3 grassA = vec3(0.40, 0.38, 0.22), grassB = vec3(0.30, 0.31, 0.16), grassC = vec3(0.52, 0.47, 0.28);
        vec3 grass = mix(grassA, grassB, smoothstep(0.3, 0.8, clump)); grass = mix(grass, grassC, smoothstep(0.55, 0.9, micro) * 0.6);
        // mud: dark, glossy when wet, with cracked cells
        vec3 mud = mix(vec3(0.26, 0.23, 0.18), vec3(0.17, 0.15, 0.12), smoothstep(0.2, 0.7, micro));
        float cracks = smoothstep(0.02, 0.07, worley(wp * 1.6));
        mud *= 0.8 + 0.25 * cracks;
        // road: packed dirt with tyre ruts and gravel
        vec3 road = mix(vec3(0.36, 0.33, 0.28), vec3(0.30, 0.28, 0.25), smoothstep(0.3, 0.7, vnoise(wp * 3.0)));
        road *= 0.9 + 0.2 * smoothstep(0.6, 0.9, vnoise(wp * 12.0));
        // rock: grey with lichen
        vec3 rock = mix(vec3(0.37, 0.36, 0.34), vec3(0.28, 0.30, 0.26), smoothstep(0.4, 0.7, vnoise(wp * 0.8)));
        rock = mix(rock, vec3(0.42, 0.44, 0.30), smoothstep(0.62, 0.8, fbm3(wp * 0.3)) * 0.5);
        vec4 w = vSurf; w.x *= 0.8 + 0.5 * macro; w.y *= 0.8 + 0.6 * (1.0 - macro); w /= max(w.x + w.y + w.z + w.w, 1e-3);
        vec3 alb = grass * w.x + mud * w.y + road * w.z + rock * w.w;
        alb = mix(alb, alb * vec3(0.55, 0.55, 0.6), vWet * 0.7);
        alb *= 0.85 + 0.3 * macro;
        diffuseColor.rgb *= alb;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(0.97, 0.55, vWet * vWet);`)
      .replace('#include <normal_fragment_begin>', /* glsl */`
        #include <normal_fragment_begin>
        {
          // fake bump from noise gradient so the ground has grain up close
          vec2 wp2 = vWPos.xz; float e = 0.05;
          float b0 = fbm3(wp2 * 1.4), bx = fbm3((wp2 + vec2(e, 0.0)) * 1.4), bz = fbm3((wp2 + vec2(0.0, e)) * 1.4);
          float g0 = vnoise(wp2 * 6.0), gx = vnoise((wp2 + vec2(e, 0.0)) * 6.0), gz = vnoise((wp2 + vec2(0.0, e)) * 6.0);
          vec2 grad = (vec2(bx - b0, bz - b0) * 0.9 + vec2(gx - g0, gz - g0) * 0.25) / e;
          float fade = 1.0 - smoothstep(20.0, 60.0, length(vWPos - cameraPosition));
          normal = normalize(normal - vec3(grad.x, 0.0, grad.y) * 0.22 * fade * (1.0 - vSurf.z * 0.6));
        }
      `);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.name = 'terrain';
  scene.add(mesh);

  // ---- water (marsh) ----
  const waterUniforms = Object.assign({ uTime: { value: 0 }, uHorizon: { value: new THREE.Color(0.5, 0.55, 0.6) }, uNight: { value: 0 } }, fogUniforms);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: Object.assign(waterUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog)), transparent: true, depthWrite: false, fog: true,
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        varying vec3 vW; varying vec3 vV;
        void main(){ vec3 transformed = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vV = -mv.xyz; gl_Position = projectionMatrix * mv;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_NOISE}
        #include <fog_pars_fragment>
        uniform float uTime, uNight; uniform vec3 uHorizon; varying vec3 vW; varying vec3 vV;
        void main(){
          vec2 p = vW.xz;
          float e = 0.15;
          float n0 = fbm3(p * 0.6 + uTime * 0.03) + 0.35 * vnoise(p * 3.0 - uTime * 0.08);
          float nx = fbm3((p + vec2(e, 0.0)) * 0.6 + uTime * 0.03) + 0.35 * vnoise((p + vec2(e, 0.0)) * 3.0 - uTime * 0.08);
          float nz = fbm3((p + vec2(0.0, e)) * 0.6 + uTime * 0.03) + 0.35 * vnoise((p + vec2(0.0, e)) * 3.0 - uTime * 0.08);
          vec3 n = normalize(vec3((n0 - nx) / e * 0.06, 1.0, (n0 - nz) / e * 0.06));
          vec3 v = normalize(vV);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          float lum = clamp(dot(uHorizon, vec3(0.3, 0.5, 0.2)) * 1.9, 0.04, 1.0);
          vec3 deep = vec3(0.06, 0.07, 0.06) * lum;
          vec3 refl = mix(uHorizon * 0.55, uHorizon * 0.95, fres);
          vec3 col = mix(deep, refl, 0.35 + 0.6 * fres);
          // scum and duckweed patches
          float scum = smoothstep(0.55, 0.75, fbm3(p * 0.12 + 40.0));
          col = mix(col, vec3(0.25, 0.27, 0.12) * lum, scum * 0.7);
          float alpha = 0.82 + 0.15 * fres;
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    })
  );
  water.position.y = WATER_LEVEL;
  water.renderOrder = 2;
  scene.add(water);

  const api = {
    mesh, water, heights, N, CELL, size: SIZE, half: HALF, waterLevel: WATER_LEVEL,
    getHeight, getNormal,
    isWater(x, z) { return getHeight(x, z) < WATER_LEVEL; },
    // surface material under a point, for footsteps/impacts
    getSurface(x, z) {
      const h = getHeight(x, z);
      if (h < WATER_LEVEL) return 'water';
      const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
      const i = Math.max(0, Math.min(N, Math.round(fx))), j = Math.max(0, Math.min(N, Math.round(fz)));
      const k = (j * V + i) * 4;
      const g = surf[k], m = surf[k + 1], r = surf[k + 2], rk = surf[k + 3];
      const mx = Math.max(g, m, r, rk);
      return mx === r ? 'road' : mx === m ? 'mud' : mx === rk ? 'rock' : 'grass';
    },
    // ray vs heightfield, coarse march then bisection. returns distance or -1
    raycast(origin, dir, maxDist, out) {
      let t = 0, step = 1.0;
      let px = origin.x, py = origin.y, pz = origin.z;
      let prevAbove = py > getHeight(px, pz);
      if (!prevAbove) { if (out) { out.set(px, py, pz); } return 0; }
      while (t < maxDist) {
        t += step;
        px = origin.x + dir.x * t; py = origin.y + dir.y * t; pz = origin.z + dir.z * t;
        if (Math.abs(px) > HALF || Math.abs(pz) > HALF) return -1;
        const above = py > getHeight(px, pz);
        if (!above) {
          let lo = t - step, hi = t;
          for (let i = 0; i < 6; i++) { const mid = (lo + hi) * 0.5; const my = origin.y + dir.y * mid; if (my > getHeight(origin.x + dir.x * mid, origin.z + dir.z * mid)) lo = mid; else hi = mid; }
          t = (lo + hi) * 0.5;
          if (out) out.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
          return t;
        }
        // adaptive: bigger steps when high above ground
        step = Math.max(0.5, Math.min(4, (py - getHeight(px, pz)) * 0.5));
      }
      return -1;
    },
    update(dt, t) {
      if (mat.userData.shader) mat.userData.shader.uniforms.uTime.value = t;
      waterUniforms.uTime.value = t;
      if (ctx.lighting) { waterUniforms.uHorizon.value.copy(ctx.lighting.horizon); waterUniforms.uNight.value = ctx.time.night; water.material.uniforms.fogColor.value.copy(ctx.scene.fog.color); water.material.uniforms.fogDensity.value = ctx.scene.fog.density; }
    },
  };
  return api;
}
