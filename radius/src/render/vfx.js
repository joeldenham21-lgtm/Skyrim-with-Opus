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
    // impact by surface type: 'metal' | 'concrete' | 'wood' | 'mud' | 'grass' | 'flesh' | 'ash' | 'glass'
    impact(pos, normal, surface) {
      switch (surface) {
        case 'metal': api.spark(pos, normal, 14); api.light(pos, 0xffc070, 3, 0.08, 6); break;
        case 'concrete': api.spark(pos, normal, 4, [1.0, 0.85, 0.6]); api.dustPuff(pos, normal, 8, [0.5, 0.49, 0.46], 0.45); break;
        case 'wood': api.dustPuff(pos, normal, 8, [0.4, 0.3, 0.2], 0.35); break;
        case 'grass': api.dustPuff(pos, normal, 6, [0.32, 0.36, 0.22], 0.5); break;
        case 'water': api.dustPuff(pos, normal, 10, [0.6, 0.65, 0.65], 0.4); break;
        case 'ash': api.dustPuff(pos, normal, 14, [0.12, 0.12, 0.13], 0.5); api.spark(pos, normal, 3, [0.8, 0.85, 1.0]); break;
        case 'glass': api.spark(pos, normal, 18, [0.85, 0.95, 1.0]); break;
        default: api.dustPuff(pos, normal, 8, [0.42, 0.38, 0.32], 0.5);
      }
    },
    tracer(from, to, width = 0.02) {
      const e = tracers[trHead]; trHead = (trHead + 1) % TR;
      const len = from.distanceTo(to);
      e.m.position.copy(from).lerp(to, 0.5);
      e.m.scale.set(width, width, Math.max(len, 0.01));
      e.m.lookAt(to);
      e.m.visible = true; e.m.material.opacity = 0.9; e.t = 0; e.life = 0.07;
    },
    // scale is the weapon's flash multiplier: a ported brake throws a bigger one, a can barely any.
    // weapons.js has always passed it; this took only (pos, dir) and every muzzle flashed the same size.
    muzzleFlash(pos, dir, scale = 1) {
      const k = Math.max(0.25, Math.min(2.5, scale));
      flashSprite.position.copy(pos).addScaledVector(dir, 0.08 * k);
      flashSprite.scale.setScalar((0.35 + rnd() * 0.2) * k);
      flashSprite.material.rotation = rnd() * 6.28;
      flashSprite.material.opacity = Math.min(1, 0.55 + 0.45 * k); flashT = 0.05;
      api.light(pos, 0xffc080, 14 * k, 0.07, 14);
      api.spark(pos, dir, Math.max(2, Math.round(5 * k)), [1.0, 0.8, 0.4]);
    },
    explosion(pos, radius = 3, color = 0xff9a50) {
      api.light(pos, color, 120, 0.35, radius * 8);
      const up = new THREE.Vector3(0, 1, 0);
      api.spark(pos, up, 60, [1.0, 0.7, 0.3]);
      api.dustPuff(pos, up, 40, [0.28, 0.25, 0.22], radius * 0.8);
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
