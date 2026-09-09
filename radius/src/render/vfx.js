// GPU particle pools + tracers + muzzle flash + pooled point lights. Everything here is fire-and-forget.
import * as THREE from 'three';
import { GLSL_NOISE } from './glsl.js';

const VERT = /* glsl */`
  attribute vec3 aVel; attribute float aBorn, aLife, aSize, aGrav, aKind; attribute vec3 aColor;
  uniform float uTime, uScale; varying float vT; varying vec3 vColor; varying float vKind;
  void main(){
    float age = uTime - aBorn; float t = age / aLife; vT = t; vColor = aColor; vKind = aKind;
    vec3 p = position + aVel * age + vec3(0.0, -0.5 * aGrav * age * age, 0.0);
    // drag: ash and dust slow down
    if (aKind > 0.5) p = position + aVel * (1.0 - exp(-age * 2.0)) / 2.0 + vec3(0.0, -0.5 * aGrav * age * age, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = aSize * (aKind > 0.5 ? (0.6 + t * 1.6) : (1.0 - t * 0.7));
    gl_PointSize = (t < 0.0 || t > 1.0) ? 0.0 : size * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime; varying float vT; varying vec3 vColor; varying float vKind;
  void main(){
    vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
    if (d > 1.0 || vT > 1.0 || vT < 0.0) discard;
    float a;
    if (vKind > 0.5) { // soft smoky puff with noise breakup
      float n = vnoise(gl_PointCoord * 5.0 + vColor.rg * 10.0 + uTime * 0.4);
      a = smoothstep(1.0, 0.2, d) * (0.5 + 0.5 * n) * (1.0 - vT) * (1.0 - vT);
    } else {          // hot spark
      a = pow(1.0 - d, 1.8) * (1.0 - vT * vT);
    }
    gl_FragColor = vec4(vColor, a);
  }`;

function makePool(scene, count, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const born = new Float32Array(count).fill(-1e9), life = new Float32Array(count).fill(1), size = new Float32Array(count), grav = new Float32Array(count), kind = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aBorn', new THREE.BufferAttribute(born, 1));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aGrav', new THREE.BufferAttribute(grav, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 5;
  scene.add(points);
  let head = 0, dirty = false;
  return {
    points, mat,
    emit(x, y, z, vx, vy, vz, r, g, b, lifeS, sizeM, gravity, k, now) {
      const i = head; head = (head + 1) % count;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      born[i] = now; life[i] = lifeS; size[i] = sizeM; grav[i] = gravity; kind[i] = k;
      dirty = true;
    },
    flush() { if (!dirty) return; for (const k in geo.attributes) geo.attributes[k].needsUpdate = true; dirty = false; },
  };
}

export function createVfx(ctx) {
  const { scene } = ctx;
  const sparks = makePool(scene, 3000, true);
  const dust = makePool(scene, 3000, false);
  let now = 0;
  const rnd = () => Math.random();
  // tracers: pooled stretched boxes
  const TR = 32;
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracers = [];
  for (let i = 0; i < TR; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.visible = false; m.frustumCulled = false; scene.add(m); tracers.push({ m, t: 0, life: 0 });
  }
  let trHead = 0;
  // pooled point lights (muzzle, explosions, arcs)
  const LIGHTS = 6;
  const lights = [];
  // These stay visible for the life of the scene and are gated by intensity alone. Toggling
  // Object3D.visible removes a light from the render state, which changes NUM_POINT_LIGHTS — part of
  // three's program cache key — so every muzzle flash and spark made every lit material swap shader
  // programs, and the first firefight was a burst of multi-millisecond compile stalls.
  for (let i = 0; i < LIGHTS; i++) { const l = new THREE.PointLight(0xffffff, 0, 30, 1.8); l.visible = true; scene.add(l); lights.push({ l, t: 0, life: 0, peak: 0 }); }
  let lHead = 0;
  // muzzle flash sprite
  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.25, 'rgba(255,190,90,0.8)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
  flashSprite.renderOrder = 20; scene.add(flashSprite);
  let flashT = 0;

  const v = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const api = {
    sparks, dust, flashTex,
    get now() { return now; },
    light(pos, color, intensity, life = 0.12, distance = 25) {
      const e = lights[lHead]; lHead = (lHead + 1) % LIGHTS;
      e.l.position.copy(pos); e.l.color.set(color); e.l.intensity = intensity; e.l.distance = distance; e.t = 0; e.life = life; e.peak = intensity;
    },
    spark(pos, normal, n = 12, color = [1.0, 0.75, 0.35]) {
      for (let i = 0; i < n; i++) {
        const s = 2 + rnd() * 6;
        v.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(0.7).add(normal).normalize().multiplyScalar(s);
        sparks.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, color[0], color[1] * (0.7 + rnd() * 0.3), color[2], 0.25 + rnd() * 0.4, 0.06 + rnd() * 0.05, 14, 0, now);
      }
    },
    dustPuff(pos, normal, n = 10, color = [0.42, 0.38, 0.32], size = 0.5) {
      for (let i = 0; i < n; i++) {
        v.set(rnd() - 0.5, rnd() * 0.5, rnd() - 0.5).normalize().multiplyScalar(0.6).add(normal).multiplyScalar(1.2 + rnd() * 1.6);
        const sh = 0.85 + rnd() * 0.3;
        dust.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, color[0] * sh, color[1] * sh, color[2] * sh, 0.7 + rnd() * 0.8, size * (0.8 + rnd() * 0.8), 0.6, 1, now);
      }
    },
    // Heavy matter thrown off a hit: chips, clods, splinters, droplets. These go into the DUST pool, which is
    // normally blended, but with kind 0 so they fly ballistically and shrink instead of billowing and slowing —
    // the smoky kind is for what hangs in the air, this is for what lands.
    debris(pos, normal, n, color, speed = 4, size = 0.05, spread = 0.8, gravity = 12, life = 0.6) {
      for (let i = 0; i < n; i++) {
        const s = speed * (0.4 + rnd());
        v.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(spread).add(normal).normalize().multiplyScalar(s);
        const sh = 0.8 + rnd() * 0.4;
        dust.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, color[0] * sh, color[1] * sh, color[2] * sh,
          life * (0.6 + rnd() * 0.8), size * (0.6 + rnd() * 0.8), gravity, 0, now);
      }
    },
    // What is left hanging after the hit. Slow, growing, short-lived; this is what sells a hard surface.
    smoke(pos, normal, n = 6, color = [0.5, 0.49, 0.47], size = 0.5, life = 1.2, rise = 0.5) {
      for (let i = 0; i < n; i++) {
        v.set((rnd() - 0.5) * 0.7, rnd() * 0.4 + rise, (rnd() - 0.5) * 0.7).addScaledVector(normal, 0.5 + rnd() * 0.5);
        const sh = 0.85 + rnd() * 0.3;
        dust.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, color[0] * sh, color[1] * sh, color[2] * sh,
          life * (0.7 + rnd() * 0.6), size * (0.7 + rnd() * 0.7), -0.25, 1, now);
      }
    },
    // A round into a body: a fine mist that hangs for a moment, heavier droplets thrown along the round's
    // path, and a little spray back toward the shooter. Deliberately not additive — glowing blood reads as fire.
    blood(pos, normal, amount = 1) {
      const k = Math.max(0.3, Math.min(2.5, amount));
      const DARK = [0.30, 0.03, 0.03], MIST = [0.42, 0.06, 0.06];
      for (let i = 0; i < Math.round(10 * k); i++) {
        v.set((rnd() - 0.5) * 1.2, (rnd() - 0.2) * 0.9, (rnd() - 0.5) * 1.2).addScaledVector(normal, 1.4 + rnd());
        const sh = 0.8 + rnd() * 0.4;
        dust.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, MIST[0] * sh, MIST[1] * sh, MIST[2] * sh,
          0.32 + rnd() * 0.3, 0.13 + rnd() * 0.14, 1.2, 1, now);
      }
      api.debris(pos, normal, Math.round(9 * k), DARK, 5.5, 0.035, 0.55, 15, 0.7);
    },
    // impact by family. Anything unknown still gets the old generic puff, so callers cannot break.
    impact(pos, normal, surface) {
      switch (surface) {
        case 'metal':
          api.spark(pos, normal, 14); api.light(pos, 0xffc070, 3, 0.08, 6);
          api.debris(pos, normal, 3, [0.45, 0.44, 0.42], 5, 0.03, 0.6, 14, 0.5); break;
        case 'concrete':
          api.spark(pos, normal, 4, [1.0, 0.85, 0.6]);
          api.dustPuff(pos, normal, 6, [0.55, 0.54, 0.51], 0.4);
          api.debris(pos, normal, 6, [0.52, 0.51, 0.48], 4.5, 0.045, 0.7, 13, 0.7);
          api.smoke(pos, normal, 4, [0.58, 0.57, 0.54], 0.5, 1.3); break;
        case 'brick':
          api.spark(pos, normal, 2, [1.0, 0.8, 0.55]);
          api.dustPuff(pos, normal, 7, [0.52, 0.31, 0.24], 0.42);
          api.debris(pos, normal, 7, [0.48, 0.27, 0.20], 4.5, 0.05, 0.7, 13, 0.7); break;
        case 'stone':
          api.spark(pos, normal, 5, [1.0, 0.9, 0.7]);
          api.dustPuff(pos, normal, 5, [0.48, 0.47, 0.45], 0.38);
          api.debris(pos, normal, 8, [0.42, 0.41, 0.39], 5.5, 0.05, 0.7, 14, 0.8); break;
        case 'wood':
          api.dustPuff(pos, normal, 5, [0.42, 0.32, 0.21], 0.3);
          // splinters: long-lived, thrown along the surface rather than straight back
          api.debris(pos, normal, 9, [0.46, 0.34, 0.21], 5, 0.055, 1.1, 12, 0.9); break;
        case 'grass':
          api.dustPuff(pos, normal, 4, [0.34, 0.37, 0.23], 0.45);
          api.debris(pos, normal, 8, [0.30, 0.38, 0.18], 3.6, 0.05, 1.2, 9, 1.0); break;
        case 'foliage':
          api.debris(pos, normal, 12, [0.26, 0.35, 0.16], 3.2, 0.06, 1.4, 7, 1.3); break;
        case 'mud':
          // a wet hit throws clods and almost no dust
          api.debris(pos, normal, 10, [0.26, 0.21, 0.15], 4, 0.07, 0.8, 15, 0.8);
          api.dustPuff(pos, normal, 3, [0.33, 0.29, 0.23], 0.35); break;
        case 'sand':
          api.dustPuff(pos, normal, 9, [0.62, 0.57, 0.44], 0.5);
          api.debris(pos, normal, 8, [0.60, 0.55, 0.42], 4, 0.045, 0.9, 13, 0.6); break;
        case 'snow':
          api.dustPuff(pos, normal, 12, [0.86, 0.88, 0.92], 0.55);
          api.debris(pos, normal, 8, [0.90, 0.92, 0.95], 3.4, 0.05, 1.0, 10, 0.8); break;
        case 'water': api.splash(pos, normal, 1); break;
        case 'cloth':
          api.dustPuff(pos, normal, 4, [0.38, 0.36, 0.31], 0.3);
          api.debris(pos, normal, 5, [0.40, 0.38, 0.33], 3, 0.04, 1.2, 9, 0.8); break;
        case 'rubber':
          api.debris(pos, normal, 6, [0.10, 0.10, 0.11], 3.6, 0.045, 0.9, 13, 0.7); break;
        case 'flesh': api.blood(pos, normal, 1); break;
        case 'ash': api.dustPuff(pos, normal, 14, [0.12, 0.12, 0.13], 0.5); api.spark(pos, normal, 3, [0.8, 0.85, 1.0]); break;
        case 'glass':
          api.spark(pos, normal, 18, [0.85, 0.95, 1.0]);
          api.debris(pos, normal, 10, [0.72, 0.82, 0.88], 5, 0.035, 1.0, 14, 0.9); break;
        default: api.dustPuff(pos, normal, 8, [0.42, 0.38, 0.32], 0.5);
      }
    },
    // Water: a column of droplets straight up regardless of the surface normal, a low spreading ring, and
    // a mist that hangs. A round into water does not behave like a round into a wall.
    splash(pos, normal, amount = 1) {
      const k = Math.max(0.3, Math.min(3, amount));
      const UP = _up;
      for (let i = 0; i < Math.round(14 * k); i++) {
        const a = rnd() * Math.PI * 2, r = rnd() * 0.55;
        v.set(Math.cos(a) * r * 2.4, 3.2 + rnd() * 3.4, Math.sin(a) * r * 2.4);
        dust.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 0.62, 0.70, 0.72, 0.5 + rnd() * 0.45, 0.05 + rnd() * 0.06, 13, 0, now);
      }
      // the ring: low, outward, flat
      for (let i = 0; i < Math.round(8 * k); i++) {
        const a = rnd() * Math.PI * 2;
        v.set(Math.cos(a) * (2.2 + rnd()), 0.5 + rnd() * 0.5, Math.sin(a) * (2.2 + rnd()));
        dust.emit(pos.x, pos.y + 0.02, pos.z, v.x, v.y, v.z, 0.70, 0.76, 0.78, 0.45 + rnd() * 0.3, 0.16 + rnd() * 0.1, 4, 1, now);
      }
      api.smoke(pos, UP, 3, [0.74, 0.78, 0.80], 0.4, 0.8, 0.3);
    },
    tracer(from, to, width = 0.02) {
      const e = tracers[trHead]; trHead = (trHead + 1) % TR;
      const len = from.distanceTo(to);
      e.m.position.copy(from).lerp(to, 0.5);
      e.m.scale.set(width, width, Math.max(len, 0.01));
      e.m.lookAt(to);
      e.m.visible = true; e.m.material.opacity = 0.9; e.t = 0; e.life = 0.07;
    },
    // A muzzle report has three parts and they do not last the same length of time: a hot core that is gone
    // within a frame or two, propellant gas that expands and cools ahead of the muzzle over a tenth of a
    // second, and smoke that drifts for a second or more. scale is the weapon's flash multiplier — a ported
    // brake throws a wide one, a suppressor almost none — so a can ends up mostly smoke, which is what a
    // suppressed weapon actually looks like.
    muzzleFlash(pos, dir, scale = 1) {
      const k = Math.max(0.25, Math.min(2.5, scale));
      // hot core
      flashSprite.position.copy(pos).addScaledVector(dir, 0.08 * k);
      flashSprite.scale.setScalar((0.35 + rnd() * 0.2) * k);
      flashSprite.material.rotation = rnd() * 6.28;
      flashSprite.material.opacity = Math.min(1, 0.55 + 0.45 * k); flashT = 0.045;
      api.light(pos, 0xffc080, 14 * k, 0.07, 14);
      // burning propellant thrown forward, tight to the bore axis and fast
      for (let i = 0; i < Math.max(3, Math.round(9 * k)); i++) {
        const sp = 9 + rnd() * 16;
        v.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.22).add(dir).normalize().multiplyScalar(sp);
        sparks.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 1.0, 0.72 + rnd() * 0.2, 0.30 + rnd() * 0.2,
          0.05 + rnd() * 0.09, 0.05 + rnd() * 0.05, 6, 0, now);
      }
      // gas: expands ahead of the muzzle and cools
      for (let i = 0; i < Math.max(2, Math.round(5 * k)); i++) {
        v.set((rnd() - 0.5) * 1.4, (rnd() - 0.3) * 0.9, (rnd() - 0.5) * 1.4).addScaledVector(dir, 2.6 + rnd() * 2.2);
        dust.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 0.52, 0.50, 0.47, 0.22 + rnd() * 0.2, 0.10 + rnd() * 0.10, -0.2, 1, now);
      }
      // smoke that lingers — the whole visible signature of a suppressed shot
      const smokeN = Math.max(2, Math.round(4 / Math.max(0.5, k)));
      for (let i = 0; i < smokeN; i++) {
        v.set((rnd() - 0.5) * 0.5, 0.35 + rnd() * 0.5, (rnd() - 0.5) * 0.5).addScaledVector(dir, 0.7 + rnd() * 0.9);
        const sh = 0.58 + rnd() * 0.16;
        dust.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, sh, sh, sh * 0.98, 0.9 + rnd() * 1.0, 0.13 + rnd() * 0.12, -0.3, 1, now);
      }
    },
    explosion(pos, radius = 3, color = 0xff9a50) {
      api.light(pos, color, 120, 0.35, radius * 8);
      const up = _up;
      // fireball: a short-lived bright core that expands, under the sparks rather than lost among them
      for (let i = 0; i < 26; i++) {
        v.set(rnd() - 0.5, rnd() * 0.7, rnd() - 0.5).normalize().multiplyScalar(3 + rnd() * 7 * radius * 0.3);
        sparks.emit(pos.x, pos.y + 0.2, pos.z, v.x, v.y, v.z, 1.0, 0.55 + rnd() * 0.3, 0.18 + rnd() * 0.2,
          0.12 + rnd() * 0.18, radius * (0.22 + rnd() * 0.2), 1.5, 1, now);
      }
      api.spark(pos, up, 60, [1.0, 0.7, 0.3]);
      // fragments thrown flat and far — this is what actually kills you and it should be visible
      api.debris(pos, up, 26, [0.32, 0.30, 0.28], 16, 0.05, 2.4, 16, 1.1);
      api.dustPuff(pos, up, 40, [0.28, 0.25, 0.22], radius * 0.8);
      // the column that stands after it, and the ring of dust kicked off the ground
      api.smoke(pos, up, 14, [0.24, 0.22, 0.20], radius * 0.55, 2.6, 1.4);
      for (let i = 0; i < 18; i++) {
        const a = rnd() * Math.PI * 2;
        v.set(Math.cos(a) * (5 + rnd() * 6), 0.4 + rnd() * 0.7, Math.sin(a) * (5 + rnd() * 6));
        dust.emit(pos.x, pos.y + 0.05, pos.z, v.x, v.y, v.z, 0.40, 0.37, 0.33, 1.1 + rnd() * 0.9, radius * 0.3, 0.5, 1, now);
      }
      ctx.post?.shake(0.8); ctx.post?.flash(0.35);
    },
    // fragment pop: cold glass shards
    shatter(pos, color = [0.9, 0.7, 0.9]) {
      const up = new THREE.Vector3(0, 0.6, 0);
      api.spark(pos, up, 40, color); api.light(pos, 0xff9ad0, 30, 0.25, 12);
      api.dustPuff(pos, up, 10, [0.7, 0.55, 0.7], 0.6);
    },
    // mimic death: fold and dissolve into ash
    ash(pos, n = 80) {
      for (let i = 0; i < n; i++) {
        v.set(rnd() - 0.5, rnd() * 0.8, rnd() - 0.5).multiplyScalar(1.4);
        const y = pos.y + (rnd() - 0.2) * 1.6;
        const sh = 0.06 + rnd() * 0.06;
        dust.emit(pos.x + (rnd() - 0.5) * 0.5, y, pos.z + (rnd() - 0.5) * 0.5, v.x, v.y + 0.6, v.z, sh, sh, sh * 1.1, 1.5 + rnd() * 2.0, 0.25 + rnd() * 0.5, -0.15, 1, now);
      }
    },
    update(dt, t) {
      now = t;
      sparks.mat.uniforms.uTime.value = t; dust.mat.uniforms.uTime.value = t;
      const h = ctx.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
      sparks.mat.uniforms.uScale.value = h * 0.9; dust.mat.uniforms.uScale.value = h * 0.9;
      sparks.flush(); dust.flush();
      for (const e of tracers) { if (!e.m.visible) continue; e.t += dt; e.m.material.opacity = Math.max(0, 0.9 * (1 - e.t / e.life)); if (e.t >= e.life) e.m.visible = false; }
      for (const e of lights) { if (e.life <= 0) continue; e.t += dt; const k = 1 - e.t / e.life; e.l.intensity = e.peak * k * k; if (e.t >= e.life) { e.life = 0; e.l.intensity = 0; } }
      if (flashT > 0) { flashT -= dt; flashSprite.material.opacity = Math.max(0, flashT / 0.05); if (flashT <= 0) flashSprite.material.opacity = 0; }
    },
  };
  return api;
}
