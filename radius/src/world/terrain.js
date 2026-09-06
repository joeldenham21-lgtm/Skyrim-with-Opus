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
  // outside the marsh the ground never sinks under the water table: a soft floor so only the marsh floods
  const floor = lerp(0.9 + 0.7 * fbm2(x * 0.03 + 5, z * 0.03, 2), -4, marsh);
  h = floor + Math.log1p(Math.exp(Math.max(-30, Math.min(30, h - floor))));
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
  const marshW = (1 - smoothstep(0.55, 1.15, dm)) * 0.92;
  h = lerp(h, -1.0, marshW);
  const floor = lerp(0.9 + 0.7 * fbm2(x * 0.03 + 5, z * 0.03, 2), -4, marshW);
  h = floor + Math.log1p(Math.exp(Math.max(-30, Math.min(30, h - floor))));
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

  // ---- bake: the expensive procedural splat is rendered once from above into a texture; the runtime shader samples it ----
  const BAKE = 4096;
  const bakeTarget = new THREE.WebGLRenderTarget(BAKE, BAKE, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 8 });
  bakeTarget.texture.colorSpace = THREE.NoColorSpace;
  const bakeMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`attribute vec4 aSurf; attribute float aWet; varying vec4 vSurf; varying float vWet; varying vec3 vWPos;
      void main(){ vSurf = aSurf; vWet = aWet; vWPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`${GLSL_NOISE}
      varying vec4 vSurf; varying float vWet; varying vec3 vWPos;
      void main(){
        vec2 wp = vWPos.xz;
        float macro = fbm3(wp * 0.035);
        float micro = vnoise(wp * 1.7) * 0.6 + vnoise(wp * 5.3) * 0.4;
        float clump = worley(wp * 0.9);
        vec3 grassA = vec3(0.40, 0.38, 0.22), grassB = vec3(0.30, 0.31, 0.16), grassC = vec3(0.52, 0.47, 0.28);
        vec3 grass = mix(grassA, grassB, smoothstep(0.3, 0.8, clump)); grass = mix(grass, grassC, smoothstep(0.55, 0.9, micro) * 0.6);
        vec3 mud = mix(vec3(0.26, 0.23, 0.18), vec3(0.17, 0.15, 0.12), smoothstep(0.2, 0.7, micro));
        float cracks = smoothstep(0.02, 0.07, worley(wp * 1.6));
        mud *= 0.8 + 0.25 * cracks;
        vec3 road = mix(vec3(0.36, 0.33, 0.28), vec3(0.30, 0.28, 0.25), smoothstep(0.3, 0.7, vnoise(wp * 3.0)));
        road *= 0.9 + 0.2 * smoothstep(0.6, 0.9, vnoise(wp * 12.0));
        vec3 rock = mix(vec3(0.37, 0.36, 0.34), vec3(0.28, 0.30, 0.26), smoothstep(0.4, 0.7, vnoise(wp * 0.8)));
        rock = mix(rock, vec3(0.42, 0.44, 0.30), smoothstep(0.62, 0.8, fbm3(wp * 0.3)) * 0.5);
        vec4 w = vSurf; w.x *= 0.8 + 0.5 * macro; w.y *= 0.8 + 0.6 * (1.0 - macro); w /= max(w.x + w.y + w.z + w.w, 1e-3);
        vec3 alb = grass * w.x + mud * w.y + road * w.z + rock * w.w;
        alb = mix(alb, alb * vec3(0.55, 0.55, 0.6), vWet * 0.7);
        alb *= 0.85 + 0.3 * macro;
        float rough = mix(0.97, 0.55, vWet * vWet) * (0.85 + 0.3 * fbm3(wp * 1.4));
        gl_FragColor = vec4(alb, rough);
      }`,
  });
  let baked = false;
  function bakeAlbedo() {
    if (baked || !ctx.renderer) return;
    const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 400);
    cam.position.set(0, 200, 0); cam.up.set(0, 0, 1); cam.lookAt(0, 0, 0);   // top of the image is +z so v = (z + HALF) / SIZE cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const r = ctx.renderer; const prevRT = r.getRenderTarget(); const prevMat = mesh.material;
    mesh.material = bakeMat;
    const bakeScene = new THREE.Scene(); const parent = mesh.parent; bakeScene.add(mesh);
    r.setRenderTarget(bakeTarget); r.setClearColor(0x000000, 1); r.clear(); r.render(bakeScene, cam);
    r.setRenderTarget(prevRT); mesh.material = prevMat; if (parent) parent.add(mesh);
    baked = true;
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.0 });
  // optional 2 m ground detail (pebbles, cracks, stubble) from the procedural material library when it is present
  const detail = ctx.materials && ctx.materials.terrainDetail ? (ctx.materials.terrainDetail() || null) : null;
  const hasDetail = !!(detail && detail.normalMap);
  mat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uBake = { value: bakeTarget.texture };
    if (hasDetail) { shader.uniforms.uDetailNormal = { value: detail.normalMap }; shader.uniforms.uDetailRough = { value: detail.roughnessMap || detail.normalMap }; shader.defines = Object.assign(shader.defines || {}, { RADIUS_DETAIL: 1 }); }
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aSurf; attribute float aWet; varying vec4 vSurf; varying float vWet; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurf = aSurf; vWet = aWet; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec4 vSurf; varying float vWet; varying vec3 vWPos; uniform float uTime; uniform sampler2D uBake;\n#ifdef RADIUS_DETAIL\nuniform sampler2D uDetailNormal; uniform sampler2D uDetailRough;\n#endif`)
      .replace('#include <map_fragment>', /* glsl */`
        vec2 wp = vWPos.xz;
        vec2 buv = (wp + vec2(${HALF}.0)) / ${SIZE}.0;
        vec4 bake = texture2D(uBake, buv);
        // one cheap high-frequency variation on top of the bake keeps the ground alive at arm's length
        float micro = vnoise(wp * 5.3);
        vec3 alb = bake.rgb * (0.9 + 0.2 * micro);
        diffuseColor.rgb *= alb;
        float bakeRough = bake.a;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = bakeRough;\n#ifdef RADIUS_DETAIL\nroughnessFactor *= 0.85 + 0.3 * texture2D(uDetailRough, vWPos.xz * 0.5).r;\n#endif`)
      .replace('#include <normal_fragment_begin>', /* glsl */`
        #include <normal_fragment_begin>
        {
          // fake bump from noise gradient so the ground has grain up close
          vec2 wp2 = vWPos.xz; float e = 0.05;
          float fade = 1.0 - smoothstep(20.0, 60.0, length(vWPos - cameraPosition));
          #ifndef RADIUS_DETAIL
          float g0 = vnoise(wp2 * 6.0), gx = vnoise((wp2 + vec2(e, 0.0)) * 6.0), gz = vnoise((wp2 + vec2(0.0, e)) * 6.0);
          vec2 grad = vec2(gx - g0, gz - g0) / e;
          normal = normalize(normal - vec3(grad.x, 0.0, grad.y) * 0.08 * fade * (1.0 - vSurf.z * 0.6));
          #endif
          #ifdef RADIUS_DETAIL
          {
            vec3 dn = texture2D(uDetailNormal, wp2 * 0.5).xyz * 2.0 - 1.0;
            float dfade = 1.0 - smoothstep(12.0, 40.0, length(vWPos - cameraPosition));
            normal = normalize(normal + vec3(dn.x, 0.0, dn.y) * 0.55 * dfade);
          }
          #endif
        }
      `);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.name = 'terrain';
  scene.add(mesh);

  // ---- water (marsh) ----
  // a half-float height texture lets the water know how deep it is: shallow edges show the mud, deep water goes dark
  const heightTex = (() => {
    const data = new Uint16Array(V * V);
    // encode metres to half float
    const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    const toHalf = (v) => { f32[0] = v; const x = u32[0]; const sign = (x >> 16) & 0x8000; let exp = ((x >> 23) & 0xff) - 112; let mant = (x >> 13) & 0x3ff; if (exp <= 0) return sign; if (exp >= 31) return sign | 0x7c00; return sign | (exp << 10) | mant; };
    for (let i = 0; i < V * V; i++) data[i] = toHalf(heights[i]);
    const t = new THREE.DataTexture(data, V, V, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  })();
  const waterUniforms = Object.assign({ uTime: { value: 0 }, uHorizon: { value: new THREE.Color(0.5, 0.55, 0.6) }, uZenith: { value: new THREE.Color(0.3, 0.34, 0.4) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 0.95, 0.9) }, uSunI: { value: 1 }, uNight: { value: 0 }, uHeight: { value: heightTex }, uWind: { value: new THREE.Vector2(0.8, 0.3) }, uStorm: { value: 0 } }, fogUniforms);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE, 64, 64).rotateX(-Math.PI / 2),
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
        uniform float uTime, uNight, uSunI, uStorm; uniform vec3 uHorizon, uZenith, uSunDir, uSunColor; uniform sampler2D uHeight; uniform vec2 uWind;
        varying vec3 vW; varying vec3 vV;
        // a cheap copy of the sky for reflections: gradient, cloud lid, sun
        vec3 skyFor(vec3 d){
          float up = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
          vec2 cuv = d.xz / (up * 1.6 + 0.24);
          float c1 = fbm3(cuv * 1.7 + vec2(uTime * 0.008, uTime * 0.004));
          float c2 = vnoise(cuv * 3.9 - vec2(uTime * 0.013, -uTime * 0.006) + 5.0);
          float cloud = smoothstep(0.32, 0.72, c1 * 0.7 + c2 * 0.45);
          vec3 cloudCol = mix(uZenith * 0.78, uHorizon * 1.05, 1.0 - cloud);
          col = mix(col, cloudCol, cloud * 0.78 * smoothstep(-0.02, 0.12, d.y));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(sd, 90.0) * 0.5 + pow(sd, 8.0) * 0.12) * uSunI;
          return col;
        }
        void main(){
          vec2 p = vW.xz;
          float lum = clamp(dot(uHorizon, vec3(0.3, 0.5, 0.2)) * 1.9, 0.04, 1.0);
          // depth below the surface from the height texture (grid covers -HALF..HALF)
          vec2 huv = (p + vec2(${HALF}.0)) / ${SIZE}.0;
          float ground = texture2D(uHeight, huv).r;
          float depth = max(0.0, ${WATER_LEVEL}.0 - ground);
          // ripples: two wind-driven layers and a fine chop, stretched along the wind
          vec2 wdir = normalize(uWind);
          vec2 pw = vec2(dot(p, wdir), dot(p, vec2(-wdir.y, wdir.x)));
          float e = 0.12;
          #define RIP(q) (fbm3((q) * vec2(0.35, 0.9) + vec2(uTime * 0.18, uTime * 0.05)) * 0.7 + vnoise((q) * vec2(1.6, 3.2) - vec2(uTime * 0.35, 0.0)) * 0.3 + vnoise((q) * 7.0 + uTime * 0.9) * 0.12 * (1.0 + uStorm * 3.0))
          float n0 = RIP(pw), nx = RIP(pw + vec2(e, 0.0)), nz = RIP(pw + vec2(0.0, e));
          float amp = 0.045 + 0.06 * uStorm;
          vec2 g = vec2(n0 - nx, n0 - nz) / e * amp;
          vec2 gw = g.x * wdir + g.y * vec2(-wdir.y, wdir.x);
          vec3 n = normalize(vec3(gw.x, 1.0, gw.y));
          vec3 v = normalize(vV);
          vec3 r = reflect(-v, n); r.y = abs(r.y);
          float cosT = max(dot(n, v), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          // what is under the water: shallow shows the mud through a tint, deep goes olive-black
          vec3 shallow = vec3(0.22, 0.20, 0.13) * lum;
          vec3 deep = vec3(0.05, 0.06, 0.045) * lum;
          float dk = smoothstep(0.0, 1.4, depth);
          vec3 under = mix(shallow, deep, dk);
          // scum and duckweed drift slowly with the wind
          float scum = smoothstep(0.55, 0.75, fbm3(p * 0.12 + uTime * 0.01 * wdir + 40.0)) * (1.0 - dk * 0.6);
          under = mix(under, vec3(0.25, 0.27, 0.12) * lum, scum * 0.75);
          // reflection with a sun/moon glint
          vec3 refl = skyFor(r);
          float glint = pow(max(dot(r, uSunDir), 0.0), 400.0) * uSunI * 2.5;
          refl += uSunColor * glint;
          vec3 col = mix(under, refl, fres);
          // shore: a thin pale wet line and foam flecks where the water meets the mud
          float shore = 1.0 - smoothstep(0.0, 0.12, depth);
          float foam = shore * smoothstep(0.55, 0.8, vnoise(p * 6.0 + uTime * 0.4)) * 0.5;
          col = mix(col, vec3(0.55, 0.55, 0.5) * lum, foam);
          // shallow water is see-through; deep water is not
          float alpha = mix(0.35, 0.95, smoothstep(0.0, 0.6, depth)) + fres * 0.05;
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
      if (!baked) { bakeAlbedo(); if (!mesh.parent) scene.add(mesh); }
      if (mat.userData.shader) mat.userData.shader.uniforms.uTime.value = t;
      waterUniforms.uTime.value = t;
      if (ctx.lighting) { const L = ctx.lighting; waterUniforms.uHorizon.value.copy(L.horizon); waterUniforms.uZenith.value.copy(L.zenith); waterUniforms.uSunColor.value.copy(L.sunColor); waterUniforms.uSunDir.value.copy(L.sunDir); waterUniforms.uSunI.value = L.sun ? Math.min(1, L.sun.intensity) : 1; waterUniforms.uNight.value = ctx.time.night; waterUniforms.uStorm.value = L.storm || 0; water.material.uniforms.fogColor.value.copy(ctx.scene.fog.color); water.material.uniforms.fogDensity.value = ctx.scene.fog.density; }
    },
  };
  return api;
}
