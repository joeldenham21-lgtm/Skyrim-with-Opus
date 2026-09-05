// Post chain: bloom -> RadiusPass (grade, tone map, anomaly distortion, aberration, vignette, grain, hurt, tide, shock).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GLSL_NOISE, GLSL_ACES } from './glsl.js';
import { clamp01, damp } from '../core/math.js';

const RadiusShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 1.0 },
    uVignette: { value: 0.32 },
    uHurt: { value: 0 },          // 0..1 red-brown flash
    uLowHp: { value: 0 },         // 0..1 persistent low-health vignette/desat
    uAberration: { value: 0.0 },  // extra chromatic aberration
    uDistort: { value: 0 },       // anomaly distortion strength
    uDistortCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uTide: { value: 0 },
    uShock: { value: 0 },         // fragment shock: radial ring + inversion
    uFlash: { value: 0 },         // muzzle/explosion white
    uNight: { value: 0 },
    uDeath: { value: 0 },         // desaturate + hold
    uBlur: { value: 0 },          // gas / stun blur
    uExposure: { value: 1.0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_NOISE}
    ${GLSL_ACES}
    uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uHurt, uLowHp, uAberration, uDistort, uTide, uShock, uFlash, uNight, uDeath, uBlur, uExposure;
    uniform vec2 uRes, uDistortCenter; varying vec2 vUv;
    vec3 sampleBlur(vec2 uv, float r){
      vec3 s = vec3(0.0); float w = 0.0;
      for (int i = 0; i < 8; i++){ float a = float(i) * 0.785 + uTime; vec2 o = vec2(cos(a), sin(a)) * r; s += texture2D(tDiffuse, uv + o).rgb; w += 1.0; }
      return s / w;
    }
    void main(){
      vec2 uv = vUv;
      vec2 cen = uv - 0.5;
      float r2 = dot(cen, cen);
      // anomaly heat-haze / lens distortion around a screen point
      if (uDistort > 0.001) {
        vec2 d = uv - uDistortCenter;
        float dl = length(d);
        float ring = exp(-dl * dl * 9.0) ;
        float wob = fbm3(uv * 9.0 + vec2(uTime * 0.9, -uTime * 0.6)) - 0.5;
        uv += d * ring * uDistort * (0.06 * sin(uTime * 5.0 + dl * 30.0) + 0.02) + wob * ring * uDistort * 0.03;
      }
      // shock ring
      if (uShock > 0.001) {
        float ring = sin(length(cen) * 40.0 - (1.0 - uShock) * 30.0) * uShock * 0.02;
        uv += normalize(cen + 1e-4) * ring;
      }
      // chromatic aberration: baseline on the edges + extra
      float ab = (0.0022 + uAberration * 0.012 + uHurt * 0.006) * (0.4 + r2 * 2.5);
      vec2 dir = cen * ab;
      vec3 col;
      if (uBlur > 0.001) {
        float br = uBlur * 0.012;
        col.r = sampleBlur(uv + dir, br).r; col.g = sampleBlur(uv, br).g; col.b = sampleBlur(uv - dir, br).b;
      } else {
        col.r = texture2D(tDiffuse, uv + dir).r; col.g = texture2D(tDiffuse, uv).g; col.b = texture2D(tDiffuse, uv - dir).b;
      }
      col *= uExposure;
      // tone map
      col = aces(col);
      // grade: lifted blacks, cool shadows, warm highlights, desaturate
      float l = luma(col);
      vec3 shadows = vec3(0.86, 0.9, 1.0), highs = vec3(1.04, 1.0, 0.95);
      col *= mix(shadows, highs, smoothstep(0.1, 0.8, l));
      col = mix(vec3(l), col, 0.78 - uLowHp * 0.3 - uDeath * 0.85);
      col = col * 0.94 + 0.022;                       // lift
      col = pow(col, vec3(1.06));                       // slight contrast
      // night tint
      col = mix(col, col * vec3(0.72, 0.8, 1.0), uNight * 0.5);
      // hurt: red-brown bloom from the edges
      float edge = smoothstep(0.08, 0.7, r2);
      col = mix(col, vec3(0.42, 0.08, 0.05), uHurt * (0.35 + edge * 0.6));
      col = mix(col, vec3(0.28, 0.05, 0.04), uLowHp * edge * 0.75 * (0.75 + 0.25 * sin(uTime * 6.0)));
      // shock: brief inversion pulse
      col = mix(col, 1.0 - col, uShock * uShock * 0.6);
      // vignette
      float v = 1.0 - smoothstep(0.3, 1.7, r2 * (2.2 + uVignette * 3.0)) * 0.7;
      col *= v;
      // film grain: animated, luminance-weighted (stronger in shadows)
      float g = hash21(gl_FragCoord.xy + fract(uTime * 13.7) * 977.0) - 0.5;
      col += g * uGrain * (0.018 + 0.03 * (1.0 - l)) * (1.0 + uDeath * 3.0 + uTide * 2.0);
      // flashes
      col += vec3(1.0, 0.95, 0.85) * uFlash;
      col = mix(col, vec3(1.0), uTide * uTide);
      gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
    }`,
};

export function createPost(ctx) {
  const { renderer, scene, camera } = ctx;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: (ctx.quality === 'low' || window.__radiusFast) ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.65, 0.88);
  const pass = new ShaderPass(RadiusShader);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(pass);
  const u = pass.uniforms;
  const st = { hurt: 0, flash: 0, shock: 0, shake: 0, shakeT: 0, aberration: 0, distort: 0, blur: 0, tide: 0, death: 0 };
  const shakeVec = new THREE.Vector3();
  const api = {
    composer, bloom, pass, uniforms: u, st,
    resize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      composer.setSize(s.x, s.y); bloom.setSize(s.x, s.y); u.uRes.value.set(s.x, s.y);
    },
    damageFlash(strength = 0.8) { st.hurt = Math.max(st.hurt, strength); },
    flash(v = 0.6) { st.flash = Math.max(st.flash, v); },
    shock(v = 1) { st.shock = Math.max(st.shock, v); },
    shake(v = 0.5) { st.shake = Math.max(st.shake, v); },
    setAnomaly(strength, screenX = 0.5, screenY = 0.5, aberration = 0) { st.distort = strength; u.uDistortCenter.value.set(screenX, screenY); st.aberration = aberration; },
    setBlur(v) { st.blur = v; },
    setTide(v) { st.tide = v; },
    setDeath(v) { st.death = v; },
    // returns camera offset applied by the player controller each frame
    shakeOffset(out) { const s = st.shake; if (s <= 0.001) return out.set(0, 0, 0); st.shakeT += 1; return out.set((Math.sin(st.shakeT * 1.7) + Math.sin(st.shakeT * 3.1)) * 0.012 * s, (Math.sin(st.shakeT * 2.3) + Math.sin(st.shakeT * 4.7)) * 0.01 * s, 0); },
    update(dt, t) {
      u.uTime.value = t;
      st.hurt = damp(st.hurt, 0, 4.5, dt);
      st.flash = damp(st.flash, 0, 22, dt);
      st.shock = damp(st.shock, 0, 3.0, dt);
      st.shake = damp(st.shake, 0, 5.5, dt);
      const s = ctx.state.data.settings;
      u.uHurt.value = st.hurt;
      u.uFlash.value = st.flash;
      u.uShock.value = st.shock;
      u.uAberration.value = damp(u.uAberration.value, st.aberration, 6, dt);
      u.uDistort.value = damp(u.uDistort.value, st.distort, 6, dt);
      u.uBlur.value = damp(u.uBlur.value, st.blur, 4, dt);
      u.uTide.value = st.tide;
      u.uDeath.value = damp(u.uDeath.value, st.death, 1.2, dt);
      u.uGrain.value = s.grain;
      u.uNight.value = ctx.time ? ctx.time.night : 0;
      const hp = ctx.player ? ctx.player.hp / 100 : 1;
      u.uLowHp.value = damp(u.uLowHp.value, clamp01((0.3 - hp) / 0.3), 3, dt);
      u.uVignette.value = 0.32 + u.uLowHp.value * 0.5;
      bloom.strength = 0.42 + (ctx.time ? ctx.time.night * 0.25 : 0);
      // exposure: night is dark but not blind; flashlight compensation handled by lights
      u.uExposure.value = 1.0;
    },
    render() { composer.render(); },
  };
  api.resize();
  return api;
}
