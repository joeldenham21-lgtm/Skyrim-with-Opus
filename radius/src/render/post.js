// Post chain: scene (with depth) -> ambient occlusion + carried-light beam cones -> sun shafts (mask + radial blur)
// -> bloom -> RadiusPass (halation, grade, tone map, anomaly distortion, aberration, rain, vignette, grain, hurt,
// tide, shock, night vision, mask, scope). Quality tiers are re-read every frame; passes rebuild lazily on change.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLSL_NOISE, GLSL_ACES } from './glsl.js';
import { clamp01, damp, smoothstep } from '../core/math.js';

const RadiusShader = {
  uniforms: {
    tDiffuse: { value: null },
    tRays: { value: null },
    uRaysColor: { value: new THREE.Color(0, 0, 0) },   // sun shaft tint * strength (black = off)
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
    uNvg: { value: 0 },          // 0 off, 1 gen1 (grainy, bloomy), 2 gen2 (clean)
    uMask: { value: 0 },         // 0 none, 1 respirator (light), 2 full mask (lenses)
    uScope: { value: 0 },        // scope vignette strength
    uHalation: { value: 0.16 },  // warm bleed around bright highlights
    uRain: { value: 0 },         // 0..1 rain streaks on the lens
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_NOISE}
    ${GLSL_ACES}
    uniform sampler2D tDiffuse, tRays; uniform vec3 uRaysColor;
    uniform float uTime, uGrain, uVignette, uHurt, uLowHp, uAberration, uDistort, uTide, uShock, uFlash, uNight, uDeath, uBlur, uExposure, uNvg, uMask, uScope, uHalation, uRain;
    uniform vec2 uRes, uDistortCenter; varying vec2 vUv;
    vec3 sampleBlur(vec2 uv, float r){
      vec3 s = vec3(0.0); float w = 0.0;
      for (int i = 0; i < 8; i++){ float a = float(i) * 0.785 + uTime; vec2 o = vec2(cos(a), sin(a)) * r; s += texture2D(tDiffuse, uv + o).rgb; w += 1.0; }
      return s / w;
    }
    // rain on the lens: two layers of slanted streaks falling through sparse cells
    float rainStreaks(vec2 uv, float t){
      float s = 0.0;
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      for (int L = 0; L < 2; L++) {
        float sc = L == 0 ? 60.0 : 104.0;
        float sp = L == 0 ? 5.5 : 8.5;
        vec2 p = (uv + vec2(uv.y * 0.07, 0.0)) * asp * vec2(sc, sc * 0.22);
        p.y += t * sp + float(L) * 7.3;
        vec2 cell = floor(p), f = fract(p);
        float h = hash21(cell + float(L) * 19.0);
        float on = step(0.74, h);
        float x = 0.25 + 0.5 * hash21(cell * 1.7 + 3.0);
        float len = 0.45 + 0.4 * hash21(cell * 2.9 + 11.0);
        float line = (1.0 - smoothstep(0.0, 0.14, abs(f.x - x))) * smoothstep(0.0, 0.18, f.y) * (1.0 - smoothstep(len - 0.2, len, f.y));
        s += on * line * (L == 0 ? 1.0 : 0.6);
      }
      return s;
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
      // sun shafts (soft, already blurred at low resolution)
      col += texture2D(tRays, uv).rgb * uRaysColor;
      // filmic halation: the brightest sources bleed a warm ring into their surroundings (short radius; bloom does the rest)
      if (uHalation > 0.001) {
        vec3 hal = vec3(0.0);
        vec2 hs = vec2(uRes.y / uRes.x, 1.0) * 0.011;
        for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472 + 0.3; vec3 s = texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * hs).rgb; hal += max(s - 0.75, 0.0); }
        col += hal * (uHalation / 6.0) * vec3(1.0, 0.5, 0.3);
      }
      col *= uExposure;
      // night vision: intensify, phosphor tint, tube bloom on bright sources, gen-1 grain and vignette
      if (uNvg > 0.5) {
        float lum = luma(col);
        float gain = uNvg > 1.5 ? 14.0 : 22.0;
        float v = 1.0 - exp(-lum * gain);
        float bloomK = smoothstep(0.35, 1.0, lum) * (uNvg > 1.5 ? 0.8 : 1.6);
        vec3 tint = uNvg > 1.5 ? vec3(0.78, 0.98, 0.72) : vec3(0.42, 1.0, 0.45);
        col = tint * (v + bloomK);
        float ng = hash21(gl_FragCoord.xy * 0.5 + fract(uTime * 7.3) * 611.0) - 0.5;
        col += ng * (uNvg > 1.5 ? 0.05 : 0.14) * (0.5 + v);
        col *= 1.0 - smoothstep(0.18, 0.6, r2) * (uNvg > 1.5 ? 0.55 : 0.85);
        // scanline-free, but tube edge: soft circular mask
      }
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
      // scope: black outside the tube, soft edge
      if (uScope > 0.001) { float sr = length(cen * vec2(uRes.x / uRes.y, 1.0)); col *= 1.0 - uScope * smoothstep(0.40, 0.46, sr); }
      // mask: lens edges and a breath fog band
      if (uMask > 0.5) {
        float lensA = length((cen - vec2(-0.16, -0.03)) * vec2(uRes.x / uRes.y, 1.0)), lensB = length((cen - vec2(0.16, -0.03)) * vec2(uRes.x / uRes.y, 1.0));
        float inside = uMask > 1.5 ? max(1.0 - smoothstep(0.30, 0.36, lensA), 1.0 - smoothstep(0.30, 0.36, lensB)) : 1.0 - smoothstep(0.62, 0.9, r2 * 2.0);
        col *= mix(0.06, 1.0, inside);
        float fog = (0.5 + 0.5 * sin(uTime * 1.3)) * 0.12 * (uMask > 1.5 ? 1.0 : 0.4);
        col = mix(col, vec3(0.8, 0.85, 0.85), fog * smoothstep(0.2, 0.55, -cen.y + 0.1) * inside);
      }
      // flashes
      col += vec3(1.0, 0.95, 0.85) * uFlash;
      col = mix(col, vec3(1.0), uTide * uTide);
      vec3 srgb = toSRGB(clamp(col, 0.0, 1.0));
      // rain on the lens, in display space: streaks catch light where the frame is bright and grey the darks a little
      if (uRain > 0.001) {
        float ls0 = luma(srgb);
        float rs = rainStreaks(vUv, uTime) * uRain;
        srgb += rs * (0.05 + 0.22 * ls0) * vec3(0.9, 0.95, 1.0);
        srgb = mix(srgb, vec3(ls0), uRain * 0.08);
      }
      // film grain in display space (perceptually even; no speckle in the blacks), a little stronger in shadow
      float g = hash21(gl_FragCoord.xy + fract(uTime * 13.7) * 977.0) - 0.5;
      float ls = luma(srgb);
      srgb += g * uGrain * (0.025 + 0.025 * (1.0 - ls)) * (1.0 + uDeath * 3.0 + uTide * 2.0);
      gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
    }`,
};

// ---- sun shafts: occlusion mask (sky and bright sources vs depth) radially blurred toward the sun ----
const RaysMaskShader = {
  uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1.78 }, uFalloff: { value: 3.0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_ACES}
    uniform sampler2D tColor; uniform highp sampler2D tDepth; uniform vec2 uSun; uniform float uAspect, uFalloff; varying vec2 vUv;
    void main(){
      float d = texture2D(tDepth, vUv).x;
      // only cleared pixels are sky: the Anomaly at 1.5 km still reads below 1.0 in a 24-bit buffer and blocks the shafts
      float sky = step(0.999995, d);
      vec3 c = texture2D(tColor, vUv).rgb; float lum = luma(c);
      vec2 dv = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = exp(-dot(dv, dv) * uFalloff);
      // haze near the sun is what the shafts are made of; emissive sources add a little
      float m = sky * (0.3 + 0.7 * smoothstep(0.15, 1.1, lum)) + smoothstep(0.8, 2.5, lum) * 0.35 * (1.0 - sky);
      gl_FragColor = vec4(vec3(m * fall), 1.0);
    }`,
};
const RaysBlurShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uDensity: { value: 0.9 }, uDecay: { value: 0.94 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uDensity, uDecay; varying vec2 vUv;
    void main(){
      vec2 uv = vUv; vec2 step = (uSun - uv) * uDensity / 16.0;
      float w = 1.0, wsum = 0.0; vec3 s = vec3(0.0);
      for (int i = 0; i < 16; i++) { s += texture2D(tDiffuse, uv).rgb * w; wsum += w; w *= uDecay; uv += step; }
      gl_FragColor = vec4(s / wsum, 1.0);
    }`,
};
const CopyShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }`,
};

// renders the scene and remembers which buffer (and so which depth texture) holds it this frame
class ScenePass extends RenderPass {
  constructor(scene, camera, st) { super(scene, camera); this.st = st; }
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    this.st.sceneTarget = this.renderToScreen ? null : readBuffer;
  }
}

// ambient occlusion (GTAO on the scene depth, normals reconstructed) then the carried-light beam cones, both into the write buffer
class AoBeamsPass extends Pass {
  constructor(ctx, st) {
    super(); this.ctx = ctx; this.st = st; this.gtao = null; this.beamSteps = 8; this.beams = true;
    this.copyMat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.quad = new FullScreenQuad(this.copyMat);
  }
  render(renderer, writeBuffer, readBuffer) {
    const depth = this.st.sceneTarget ? this.st.sceneTarget.depthTexture : null;
    if (this.gtao && depth && this.st.aoOn) {
      const g = this.gtao;
      g.gtaoMaterial.uniforms.tDepth.value = depth; g.pdMaterial.uniforms.tDepth.value = depth;
      g.render(renderer, writeBuffer, readBuffer);
    } else {
      this.copyMat.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(writeBuffer);
      this.quad.render(renderer);
    }
    if (this.beams && depth) {
      renderer.setRenderTarget(writeBuffer);
      const prev = renderer.autoClear; renderer.autoClear = false;
      this.ctx.lighting.renderBeams(renderer, this.ctx.camera, depth, writeBuffer.width, writeBuffer.height, this.beamSteps);
      renderer.autoClear = prev;
    }
  }
  setSize(w, h) { if (this.gtao) this.gtao.setSize(Math.max(8, Math.round(w * this.st.aoScale)), Math.max(8, Math.round(h * this.st.aoScale))); }
  dispose() { if (this.gtao) this.gtao.dispose(); this.copyMat.dispose(); this.quad.dispose(); }
}

// sun shafts: low-res mask + two radial blurs; the RadiusPass composites the result (needsSwap false: no colour output here)
class SunRaysPass extends Pass {
  constructor(st) {
    super(); this.st = st; this.needsSwap = false; this.scale = 1 / 4;
    this.rtA = new THREE.WebGLRenderTarget(64, 36, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(64, 36, { type: THREE.HalfFloatType, depthBuffer: false });
    this.maskMat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(RaysMaskShader.uniforms), vertexShader: RaysMaskShader.vertexShader, fragmentShader: RaysMaskShader.fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.blurMat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(RaysBlurShader.uniforms), vertexShader: RaysBlurShader.vertexShader, fragmentShader: RaysBlurShader.fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    this.quad = new FullScreenQuad(this.maskMat);
    this.clearColor = new THREE.Color(0, 0, 0);
  }
  get texture() { return this.rtA.texture; }
  render(renderer, writeBuffer, readBuffer) {
    const depth = this.st.sceneTarget ? this.st.sceneTarget.depthTexture : null;
    if (!depth) return;
    const sun = this.st.sunUv;
    this.maskMat.uniforms.tColor.value = readBuffer.texture; this.maskMat.uniforms.tDepth.value = depth;
    this.maskMat.uniforms.uSun.value.copy(sun); this.maskMat.uniforms.uAspect.value = readBuffer.width / readBuffer.height;
    renderer.setRenderTarget(this.rtA); this.quad.material = this.maskMat; this.quad.render(renderer);
    this.blurMat.uniforms.uSun.value.copy(sun);
    this.blurMat.uniforms.tDiffuse.value = this.rtA.texture; this.blurMat.uniforms.uDensity.value = 0.85; this.blurMat.uniforms.uDecay.value = 0.93;
    renderer.setRenderTarget(this.rtB); this.quad.material = this.blurMat; this.quad.render(renderer);
    this.blurMat.uniforms.tDiffuse.value = this.rtB.texture; this.blurMat.uniforms.uDensity.value = 0.35; this.blurMat.uniforms.uDecay.value = 0.96;
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
  }
  setSize(w, h) { const sw = Math.max(16, Math.round(w * this.scale)), sh = Math.max(9, Math.round(h * this.scale)); this.rtA.setSize(sw, sh); this.rtB.setSize(sw, sh); }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.maskMat.dispose(); this.blurMat.dispose(); this.quad.dispose(); }
}

const TIERS = {
  low:    { samples: 0, aoScale: 0,    aoSamples: 0,  raysScale: 1 / 5, beamSteps: 4 },
  medium: { samples: 2, aoScale: 0.25, aoSamples: 8,  raysScale: 1 / 4, beamSteps: 6 },
  high:   { samples: 4, aoScale: 0.5,  aoSamples: 12, raysScale: 1 / 3, beamSteps: 8 },
};

export function createPost(ctx) {
  const { renderer, scene, camera } = ctx;
  const pass = new ShaderPass(RadiusShader);
  pass.material.depthTest = false; pass.material.depthWrite = false;
  const u = pass.uniforms;
  const st = { hurt: 0, flash: 0, shock: 0, shake: 0, shakeT: 0, aberration: 0, distort: 0, blur: 0, tide: 0, death: 0, sceneTarget: null, aoOn: false, aoScale: 0, sunUv: new THREE.Vector2(0.5, 0.5), tier: null };
  const shakeVec = new THREE.Vector3();
  let composer = null, target = null, scenePass = null, aoPass = null, raysPass = null, bloom = null;
  const _p = new THREE.Vector3(), _sun = new THREE.Vector3();

  function currentTier() { const q = ctx.renderApi ? ctx.renderApi.quality : ctx.quality; return TIERS[q] ? q : 'high'; }
  function teardown() {
    if (composer) { composer.dispose(); composer = null; }
    if (aoPass) { aoPass.dispose(); aoPass = null; }
    if (raysPass) { raysPass.dispose(); raysPass = null; }
    if (bloom) { bloom.dispose(); bloom = null; }
    target = null; st.sceneTarget = null;
  }
  function build(q) {
    teardown();
    const T = TIERS[q];
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const samples = window.__radiusFast ? 0 : T.samples;
    target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(size.x, size.y), stencilBuffer: false });
    composer = new EffectComposer(renderer, target);
    scenePass = new ScenePass(scene, camera, st);
    aoPass = new AoBeamsPass(ctx, st);
    st.aoScale = T.aoScale; st.aoOn = T.aoScale > 0;
    aoPass.beamSteps = T.beamSteps;
    if (T.aoScale > 0) {
      const g = new GTAOPass(scene, camera, 8, 8);
      g.setGBuffer(target.depthTexture, undefined);     // depth from the scene render; normals reconstructed from it (no second scene pass)
      g.output = GTAOPass.OUTPUT.Default;
      g.blendIntensity = 0.72;
      g.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.0, thickness: 1.0, distanceFallOff: 1.0, scale: 1.0, samples: T.aoSamples, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 });
      aoPass.gtao = g;
    }
    raysPass = new SunRaysPass(st); raysPass.scale = T.raysScale; raysPass.enabled = false;
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.5, 0.85);
    composer.addPass(scenePass); composer.addPass(aoPass); composer.addPass(raysPass); composer.addPass(bloom); composer.addPass(pass);
    u.tRays.value = raysPass.texture;
    api.composer = composer; api.bloom = bloom; api.ao = aoPass.gtao; api.rays = raysPass;
    st.tier = q;
    api.resize();
  }

  const api = {
    composer: null, bloom: null, pass, uniforms: u, st, ao: null, rays: null,
    resize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!composer) return;
      composer.setSize(s.x, s.y); bloom.setSize(s.x, s.y); aoPass.setSize(s.x, s.y); raysPass.setSize(s.x, s.y); u.uRes.value.set(s.x, s.y);
    },
    damageFlash(strength = 0.8) { st.hurt = Math.max(st.hurt, strength); },
    flash(v = 0.6) { st.flash = Math.max(st.flash, v); },
    shock(v = 1) { st.shock = Math.max(st.shock, v); },
    shake(v = 0.5) { st.shake = Math.max(st.shake, v); },
    setAnomaly(strength, screenX = 0.5, screenY = 0.5, aberration = 0) { st.distort = strength; u.uDistortCenter.value.set(screenX, screenY); st.aberration = aberration; },
    setBlur(v) { st.blur = v; },
    setTide(v) { st.tide = v; },
    setDeath(v) { st.death = v; },
    setNvg(gen) { u.uNvg.value = gen || 0; },
    setMask(kind) { u.uMask.value = kind === 'respirator' ? 1 : kind ? 2 : 0; },
    setScope(v) { u.uScope.value = (v && typeof v === 'object') ? 1 : (v || 0); },
    // returns camera offset applied by the player controller each frame
    shakeOffset(out) { const s = st.shake; if (s <= 0.001) return out.set(0, 0, 0); st.shakeT += 1; return out.set((Math.sin(st.shakeT * 1.7) + Math.sin(st.shakeT * 3.1)) * 0.012 * s, (Math.sin(st.shakeT * 2.3) + Math.sin(st.shakeT * 4.7)) * 0.01 * s, 0); },
    update(dt, t) {
      const q = currentTier();
      if (q !== st.tier) build(q);
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
      const night = ctx.time ? ctx.time.night : 0;
      u.uNight.value = night;
      const hp = ctx.player ? ctx.player.hp / 100 : 1;
      u.uLowHp.value = damp(u.uLowHp.value, clamp01((0.3 - hp) / 0.3), 3, dt);
      u.uVignette.value = 0.32 + u.uLowHp.value * 0.5;
      // bloom: high threshold by day so only sources bloom; night lifts it; night vision tubes bloom every light hard
      const nvg = u.uNvg.value > 0.5;
      bloom.threshold = nvg ? 0.12 : 0.85;
      bloom.radius = nvg ? 0.7 : 0.5;
      bloom.strength = nvg ? 1.5 : 0.30 + night * 0.32;
      u.uHalation.value = nvg ? 0 : 0.16;
      // exposure: night is dark but not blind; flashlight compensation handled by lights
      u.uExposure.value = 1.0;
      // weather on the lens
      const L = ctx.lighting;
      const storm = L ? clamp01(L.storm) : 0;
      u.uRain.value = damp(u.uRain.value, smoothstep(0.15, 0.55, storm), 2.5, dt);
      // sun shafts: only with the sun up and in (or just outside) the frame; stronger low, in fog and in rain
      let raysStrength = 0;
      if (L && L.sunIntensity > 0.02 && st.aoScale >= 0 && raysPass) {
        camera.getWorldPosition(_p);
        _sun.copy(L.sunDir);
        _p.addScaledVector(_sun, 600).project(camera);
        if (_p.z < 1 && Number.isFinite(_p.x) && Number.isFinite(_p.y)) {
          const ux = _p.x * 0.5 + 0.5, uy = _p.y * 0.5 + 0.5;
          const outside = Math.max(0, -ux, ux - 1, -uy, uy - 1);
          const fade = 1 - smoothstep(0, 0.5, outside);
          if (fade > 0.001) {
            st.sunUv.set(ux, uy);
            const lowSun = 1 - smoothstep(0.03, 0.35, _sun.y);
            const fogK = clamp01((L.fogDensity || 0.0027) / 0.0027 - 0.5);
            raysStrength = (L.sunIntensity / 1.2) * fade * (0.30 + 0.8 * lowSun) * (1 + storm * 1.8) * (0.55 + 0.45 * fogK);
          }
        }
      }
      const active = raysStrength > 0.004;
      raysPass.enabled = active;
      if (active) u.uRaysColor.value.copy(L.sunColor).multiplyScalar(raysStrength * (nvg ? 0.3 : 0.42));
      else u.uRaysColor.value.setScalar(0);
    },
    render() { if (composer) composer.render(); },
  };
  build(currentTier());
  return api;
}
