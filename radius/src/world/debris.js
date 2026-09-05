// Airborne debris of the zone. Floating concrete and rock over the anomaly fields and the northern ridge
// (one InstancedMesh, slow spin and bob, satellites, the odd trickle of dust), the Column's rising motes
// (Points, additive, visible from the whole map), the air texture around the camera (ash flakes that
// catch the torch beam), and a rare tumble of leaves and paper along the wind.
import * as THREE from 'three';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { clamp01, TAU } from '../core/math.js';
import { noise2 } from '../core/rng.js';

const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), e3 = new THREE.Euler();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const WIND_FALLBACK = { dir: new THREE.Vector3(0.6, 0, 0.8).normalize(), strength: 0.5 };

// ---- a chipped slab: an icosahedron pulled toward a box, then roughened ----
function chunkGeometry(rnd) {
  let g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1;
    const bx = x / m, by = y / m, bz = z / m;                  // projected onto the unit cube
    const k = 0.42;
    let nx = x + (bx - x) * k, ny = y + (by - y) * k, nz = z + (bz - z) * k;
    const n = 1 + 0.16 * noise2(nx * 1.9 + 3.1, nz * 1.9 - ny * 1.3) + 0.08 * noise2(ny * 4.2, nx * 4.2 + 7.7);
    p.setXYZ(i, nx * n, ny * n * 0.82, nz * n);
  }
  if (g.index) g = g.toNonIndexed();   // unshared vertices: flat faces read as broken concrete
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function chunkMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vWorld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position;
        #ifdef USE_INSTANCING
          vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vLocal; varying vec3 vWorld;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 alb = diffuseColor.rgb;
          float seed = hash21(floor(vWorld.xz * 0.01) + 0.5);
          vec3 q = vLocal * 2.6 + seed * 9.0;
          // aggregate speckle and pitted cells
          float spk = vnoise3(q * 9.0);
          float cells = worley(vLocal.xy * 4.0 + vLocal.z * 2.0 + seed * 3.0);
          alb *= 0.86 + 0.22 * spk;
          alb *= 0.75 + 0.35 * smoothstep(0.0, 0.5, cells);
          // cracks: thin dark lines
          float crack = 1.0 - smoothstep(0.015, 0.05, worley(q.xy * 0.9 + q.z * 0.7));
          alb *= 1.0 - crack * 0.55;
          // rust bleeding down from the rebar; soot on the underside
          float rust = smoothstep(0.55, 0.85, vnoise3(vec3(q.x * 2.0, q.y * 0.35, q.z * 2.0))) * smoothstep(0.4, -0.6, vLocal.y);
          alb = mix(alb, vec3(0.30, 0.15, 0.07), rust * 0.55);
          alb *= 1.0 - smoothstep(0.1, -0.7, vLocal.y) * 0.3;
          diffuseColor.rgb = alb;
        }`);
  };
  mat.customProgramCacheKey = () => 'radius-debris-chunk';
  return mat;
}

// ---- the Column's motes: pale points rising 600 m up the pillar of light ----
function columnMotes(ctx, count, rnd) {
  const pos = new Float32Array(count * 3), polar = new Float32Array(count * 2), seed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = Math.pow(rnd(), 0.6) * 40, a = rnd() * TAU;
    pos[i * 3] = 0; pos[i * 3 + 1] = rnd() * 600; pos[i * 3 + 2] = 0;
    polar[i * 2] = r; polar[i * 2 + 1] = a;
    seed[i * 3] = rnd(); seed[i * 3 + 1] = rnd(); seed[i * 3 + 2] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const col = ctx.sky.columnPosition;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(col.x, 300, col.z), 380);
  const sky = ctx.sky.uniforms;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: sky.uNight, uTide: sky.uTide, uCol: { value: new THREE.Vector3(col.x, 0, col.z) }, uScale: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      attribute vec2 aPolar; attribute vec3 aSeed;
      uniform float uTime, uNight, uTide, uScale; uniform vec3 uCol;
      varying float vA;
      void main(){
        float y = mod(position.y + uTime * (3.0 + aSeed.x * 9.0), 600.0);
        float ang = aPolar.y + uTime * (0.02 + aSeed.x * 0.04);
        float r = aPolar.x * (0.85 + 0.15 * sin(uTime * 0.2 + aSeed.y * 6.2832));
        vec3 p = uCol + vec3(cos(ang) * r, y, sin(ang) * r);
        p.x += sin(uTime * 0.31 + aSeed.y * 20.0) * 2.5;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.6 + aSeed.z * 2.6) * uScale;
        float fade = smoothstep(0.0, 50.0, y) * (1.0 - smoothstep(380.0, 600.0, y));
        float tw = 0.7 + 0.3 * sin(uTime * 2.5 + aSeed.y * 40.0);
        vA = fade * tw * (0.32 + 0.55 * uNight) * (1.0 - uTide);
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.25, d) * vA;
        gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * a, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'debris-column-motes';
  pts.renderOrder = 3;
  return pts;
}

// ---- air texture: ash flakes drifting in a box around the camera, brighter in the torch beam ----
function airMotes(ctx, count, rnd) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rnd() * 24; pos[i * 3 + 1] = rnd() * 24; pos[i * 3 + 2] = rnd() * 24;
    seed[i * 3] = rnd(); seed[i * 3 + 1] = rnd(); seed[i * 3 + 2] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uCamDir: { value: new THREE.Vector3(0, 0, -1) }, uWind: { value: new THREE.Vector2(0.6, 0.8) }, uTorch: { value: 0 }, uTint: { value: new THREE.Color(0.5, 0.5, 0.5) }, uScale: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending, fog: false,
    vertexShader: /* glsl */`
      attribute vec3 aSeed;
      uniform float uTime, uTorch, uScale; uniform vec3 uCam, uCamDir, uTint; uniform vec2 uWind;
      varying float vA; varying vec3 vC;
      void main(){
        vec3 drift = vec3(uWind.x, -0.12, uWind.y) * uTime * (0.25 + aSeed.z * 0.35)
                   + vec3(sin(uTime * 0.6 + aSeed.y * 9.0), cos(uTime * 0.45 + aSeed.y * 5.0), sin(uTime * 0.5 + aSeed.y * 7.0)) * 0.6;
        vec3 rel = mod(position + drift - uCam + 12.0, 24.0) - 12.0;
        vec3 p = uCam + rel;
        float d = length(rel);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.3 + aSeed.x * 2.0) * uScale * clamp(3.0 / max(d, 1.0), 0.6, 1.6);
        float a = smoothstep(12.0, 7.0, d) * smoothstep(0.35, 1.2, d);
        float beam = smoothstep(0.86, 0.975, dot(rel / max(d, 1e-3), uCamDir)) * uTorch * smoothstep(16.0, 3.0, d);
        vA = a * (0.07 + 0.06 * aSeed.x) + beam * 0.5 * a;
        vC = mix(uTint, vec3(1.0, 0.93, 0.8), clamp(beam * 1.5, 0.0, 1.0));
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.3, d) * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vC, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  pts.name = 'debris-air';
  return pts;
}

// ---- leaves and paper: small quads tumbling along the wind ----
function leafMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLeafUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec2 vLeafUv;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 alb = diffuseColor.rgb;
          float paper = smoothstep(0.4, 0.5, vColor.b);
          // paper: ruled lines, a typed block, a damp stain. leaf: midrib, veins, rot spots
          float lines = smoothstep(0.42, 0.47, abs(fract(vLeafUv.y * 7.0) - 0.5)) * step(0.12, vLeafUv.x) * step(vLeafUv.x, 0.9);
          float stain = smoothstep(0.55, 0.8, vnoise(vLeafUv * 3.0 + 4.0));
          vec3 paperCol = alb * (1.0 - lines * 0.4) * (1.0 - stain * 0.3);
          float rib = 1.0 - smoothstep(0.012, 0.03, abs(vLeafUv.y - 0.5));
          float veins = 1.0 - smoothstep(0.01, 0.03, abs(fract((vLeafUv.x * 5.0 + (vLeafUv.y - 0.5) * 2.0)) - 0.5) * 0.2);
          float rot = smoothstep(0.6, 0.85, vnoise(vLeafUv * vec2(6.0, 4.0)));
          vec3 leafCol = alb * (1.0 - rib * 0.35 - veins * 0.12) * mix(1.0, 0.45, rot);
          diffuseColor.rgb = mix(leafCol, paperCol, paper);
        }`);
  };
  mat.customProgramCacheKey = () => 'radius-leaf';
  return mat;
}

export function createDebris(ctx) {
  const { scene, world } = ctx;
  const M = world.map;
  const rng = ctx.rng.fork(2291);

  // ---------------- floating chunks ----------------
  const MAXC = 128;
  const chunkMesh = new THREE.InstancedMesh(chunkGeometry(rng.fork(1)), chunkMaterial(), MAXC);
  chunkMesh.castShadow = true; chunkMesh.receiveShadow = false;
  chunkMesh.name = 'debris-chunks';
  chunkMesh.frustumCulled = false;
  scene.add(chunkMesh);
  const chunks = [];      // { x, y, z, sx, sy, sz, axis, spin, bobA, bobP, bobT, driftR, driftT, phase, parent, orbR, orbS, orbI, big }
  const CONCRETE = new THREE.Color(0x6e6b66), ROCK = new THREE.Color(0x55524c), PALE = new THREE.Color(0x8a877f);
  const tint = new THREE.Color();
  function rollChunks(salt) {
    chunks.length = 0;
    const r = rng.fork(100 + salt);
    const fields = ['field_a', 'field_b', 'field_c', 'vents', 'north'].map((id) => M.poi(id));
    for (const f of fields) {
      const n = f.kind === 'ridge' ? r.int(8, 11) : r.int(6, 9);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * f.r * 1.1;
        const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
        const ground = world.getHeight(x, z);
        const s = f.kind === 'ridge' ? r.range(0.9, 2.6) : r.range(0.55, 2.0);
        const big = { x, y: ground + r.range(5, 25) + s, z, sx: s * r.range(0.7, 1.3), sy: s * r.range(0.5, 1.05), sz: s * r.range(0.7, 1.3),
          axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), spin: r.range(0.03, 0.12) * (r() < 0.5 ? 1 : -1), ang: r() * TAU,
          bobA: r.range(0.25, 1.0), bobT: r.range(7, 15), bobP: r() * TAU, driftR: r.range(0.3, 1.5), driftT: r.range(20, 40), phase: r() * TAU,
          tone: r(), parent: null, big: true };
        chunks.push(big);
        const sats = r() < 0.6 ? r.int(1, 3) : 0;
        for (let k = 0; k < sats && chunks.length < MAXC; k++) {
          chunks.push({ x, y: big.y, z, sx: s * r.range(0.12, 0.3), sy: s * r.range(0.1, 0.25), sz: s * r.range(0.12, 0.3),
            axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), spin: r.range(0.3, 0.9), ang: r() * TAU,
            bobA: 0, bobT: 1, bobP: 0, driftR: 0, driftT: 1, phase: r() * TAU, tone: r(), parent: big,
            orbR: s * r.range(1.8, 3.2), orbS: r.range(0.12, 0.35) * (r() < 0.5 ? 1 : -1), orbI: r.range(-0.6, 0.6), big: false });
        }
        if (chunks.length >= MAXC) break;
      }
    }
    chunkMesh.count = chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      tint.copy(c.tone < 0.5 ? CONCRETE : ROCK).lerp(PALE, c.tone * 0.5);
      chunkMesh.setColorAt(i, tint);
    }
    chunkMesh.instanceColor.needsUpdate = true;
    placeChunks(0, 0);
  }
  function placeChunks(t, dt) {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      c.ang += c.spin * dt;
      if (c.parent) {
        const p = c.parent, a = c.phase + t * c.orbS;    // parents precede satellites, so p.cx is this frame's position
        v3.set(p.cx + Math.cos(a) * c.orbR, p.cy + Math.sin(a) * c.orbR * c.orbI + Math.sin(t * 0.7 + c.phase) * 0.15, p.cz + Math.sin(a) * c.orbR);
        c.cx = v3.x; c.cy = v3.y; c.cz = v3.z;
      } else {
        const dr = t / c.driftT * TAU + c.phase;
        v3.set(c.x + Math.cos(dr) * c.driftR, c.y + Math.sin(t / c.bobT * TAU + c.bobP) * c.bobA, c.z + Math.sin(dr) * c.driftR);
        c.cx = v3.x; c.cy = v3.y; c.cz = v3.z;
      }
      q4.setFromAxisAngle(c.axis, c.ang);
      s3.set(c.sx, c.sy, c.sz);
      m4.compose(v3, q4, s3);
      chunkMesh.setMatrixAt(i, m4);
    }
    chunkMesh.instanceMatrix.needsUpdate = true;
  }
  rollChunks(0);
  let dustT = 0;
  function trickle(t) {
    // now and then a chunk sheds a little dust that falls away beneath it
    const p = ctx.player.position;
    const cand = [];
    for (const c of chunks) if (c.big && Math.hypot(c.cx - p.x, c.cz - p.z) < 110) cand.push(c);
    if (!cand.length || Math.random() > 0.55) return;
    const c = cand[Math.floor(Math.random() * cand.length)];
    const night = ctx.time.night;
    const lum = 0.28 * (0.25 + 0.75 * (1 - night));
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - 0.5) * c.sx * 1.2, oz = (Math.random() - 0.5) * c.sz * 1.2;
      ctx.vfx.dust.emit(c.cx + ox, c.cy - c.sy * 0.6, c.cz + oz, (Math.random() - 0.5) * 0.25, -0.35 - Math.random() * 0.4, (Math.random() - 0.5) * 0.25,
        lum, lum * 0.97, lum * 0.92, 2.2 + Math.random() * 1.6, 0.22 + Math.random() * 0.3, 0.35, 1, t);
    }
  }

  // ---------------- the Column's motes ----------------
  const column = columnMotes(ctx, 1500, rng.fork(2));
  scene.add(column);

  // ---------------- air texture ----------------
  const air = airMotes(ctx, 400, rng.fork(3));
  scene.add(air);

  // ---------------- leaves and paper ----------------
  const LEAVES = 14;
  const leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 0.09), leafMaterial(), LEAVES);
  leafMesh.castShadow = false; leafMesh.frustumCulled = false; leafMesh.name = 'debris-leaves';
  const LEAF = new THREE.Color(0x5a4520), LEAF2 = new THREE.Color(0x6f6535), PAPER = new THREE.Color(0xb8b09c);
  const leaves = [];
  for (let i = 0; i < LEAVES; i++) { leaves.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, ttl: 0, phase: 0, scale: 1 }); m4.makeScale(0, 0, 0); leafMesh.setMatrixAt(i, m4); leafMesh.setColorAt(i, LEAF); }
  leafMesh.visible = false;
  scene.add(leafMesh);
  let spawnT = 5 + Math.random() * 8;
  function spawnLeaves(windState) {
    const p = ctx.player.position;
    const n = 1 + Math.floor(Math.random() * 3);
    const side = tmpA.set(windState.dir.z, 0, -windState.dir.x);
    for (let k = 0; k < n; k++) {
      const l = leaves.find((x) => !x.active); if (!l) return;
      l.active = true;
      l.pos.copy(p).addScaledVector(windState.dir, -(7 + Math.random() * 9)).addScaledVector(side, (Math.random() - 0.5) * 8);
      l.pos.y = world.getHeight(l.pos.x, l.pos.z) + 0.2 + Math.random() * 1.8;
      l.vel.copy(windState.dir).multiplyScalar(1.5 + 3 * windState.strength).add(tmpB.set((Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6));
      l.rot.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
      l.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      l.life = 0; l.ttl = 5 + Math.random() * 5; l.phase = Math.random() * TAU;
      const paper = Math.random() < 0.25;
      l.scale = paper ? 1.4 + Math.random() * 0.8 : 0.8 + Math.random() * 0.5;
      leafMesh.setColorAt(leaves.indexOf(l), paper ? PAPER : (Math.random() < 0.5 ? LEAF : LEAF2));
      leafMesh.instanceColor.needsUpdate = true;
    }
  }
  function updateLeaves(dt, t, windState) {
    let any = false;
    for (let i = 0; i < LEAVES; i++) {
      const l = leaves[i];
      if (!l.active) continue;
      any = true;
      l.life += dt;
      const lift = 1.4 + Math.sin(t * 3.1 + l.phase) * 1.3 + Math.sin(t * 7.3 + l.phase * 2.0) * 0.5;
      l.vel.y += (-2.4 + lift) * dt;
      const tx = windState.dir.x * (1.2 + 3.2 * windState.strength), tz = windState.dir.z * (1.2 + 3.2 * windState.strength);
      l.vel.x += (tx - l.vel.x) * Math.min(1, dt * 1.5) + Math.sin(t * 2.3 + l.phase) * dt * 0.8;
      l.vel.z += (tz - l.vel.z) * Math.min(1, dt * 1.5) + Math.cos(t * 1.9 + l.phase) * dt * 0.8;
      l.pos.addScaledVector(l.vel, dt);
      const gy = world.getHeight(l.pos.x, l.pos.z) + 0.03;
      if (l.pos.y < gy) { l.pos.y = gy; l.vel.y = Math.abs(l.vel.y) * 0.25 + 0.2; l.vel.x *= 0.7; l.vel.z *= 0.7; }
      l.rot.x += l.spin.x * dt; l.rot.y += l.spin.y * dt; l.rot.z += l.spin.z * dt;
      const fade = Math.min(1, l.life / 0.5) * clamp01((l.ttl - l.life) / 0.6);
      if (l.life >= l.ttl || l.pos.distanceTo(ctx.player.position) > 45) { l.active = false; m4.makeScale(0, 0, 0); leafMesh.setMatrixAt(i, m4); continue; }
      q4.setFromEuler(l.rot);
      s3.setScalar(l.scale * fade);
      m4.compose(l.pos, q4, s3);
      leafMesh.setMatrixAt(i, m4);
    }
    leafMesh.visible = any;
    if (any) leafMesh.instanceMatrix.needsUpdate = true;
  }

  ctx.events.on('tide', () => rollChunks(ctx.state.data.tideLevel | 0));

  const camDir = new THREE.Vector3();
  const size = new THREE.Vector2();
  return {
    chunks: chunkMesh, column, air, leaves: leafMesh,
    reset() { rollChunks(ctx.state.data.tideLevel | 0); },
    update(dt, t) {
      const windState = (ctx.flora && ctx.flora.wind) || WIND_FALLBACK;
      placeChunks(t, dt);
      dustT -= dt;
      if (dustT <= 0) { dustT = 0.35 + Math.random() * 0.3; trickle(t); }
      // uniforms shared by the point systems
      ctx.renderer.getDrawingBufferSize(size);
      const px = size.y / 540;
      column.material.uniforms.uTime.value = t;
      column.material.uniforms.uScale.value = px;
      const au = air.material.uniforms;
      au.uTime.value = t; au.uScale.value = px;
      au.uCam.value.copy(ctx.player.eye);
      ctx.camera.getWorldDirection(camDir); au.uCamDir.value.copy(camDir);
      au.uWind.value.set(windState.dir.x, windState.dir.z);
      const torch = ctx.lighting ? clamp01(ctx.lighting.flashlight.intensity / 30) : 0;
      au.uTorch.value = torch;
      if (ctx.lighting) au.uTint.value.copy(ctx.lighting.horizon).multiplyScalar(1.15).addScalar(0.015);
      // leaves: rare, only outdoors, only when there is wind to carry them
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = (7 + Math.random() * 16) * (1.5 - windState.strength * 0.8);
        if (!ctx.player.inBase && windState.strength > 0.3 && ctx.mode === 'playing') spawnLeaves(windState);
      }
      updateLeaves(dt, t, windState);
    },
  };
}
