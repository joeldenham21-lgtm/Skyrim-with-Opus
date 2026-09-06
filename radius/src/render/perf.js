// Performance governor: dynamic internal resolution with FXAA + a CAS sharpening upscale, frame pacing stats,
// and an F3 overlay. The DOM HUD stays at native resolution; only the 3D chain scales.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// AMD FidelityFX CAS (robust contrast adaptive sharpening), single pass, sampling the lower-res chain output
const CASShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) }, uSharp: { value: 0.35 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharp; varying vec2 vUv;
    void main(){
      vec3 a = texture2D(tDiffuse, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
      vec3 b = texture2D(tDiffuse, vUv + vec2(0.0, -uTexel.y)).rgb;
      vec3 c = texture2D(tDiffuse, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
      vec3 d = texture2D(tDiffuse, vUv + vec2(-uTexel.x, 0.0)).rgb;
      vec3 e = texture2D(tDiffuse, vUv).rgb;
      vec3 f = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
      vec3 g = texture2D(tDiffuse, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
      vec3 h = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
      vec3 i = texture2D(tDiffuse, vUv + vec2(uTexel.x, uTexel.y)).rgb;
      vec3 mn = min(min(min(d, e), min(f, b)), h);
      vec3 mn2 = min(min(min(a, c), min(g, i)), mn);
      mn += mn2;
      vec3 mx = max(max(max(d, e), max(f, b)), h);
      vec3 mx2 = max(max(max(a, c), max(g, i)), mx);
      mx += mx2;
      vec3 rcpM = 1.0 / max(mx, vec3(1e-4));
      vec3 amp = clamp(min(mn, 2.0 - mx) * rcpM, 0.0, 1.0);
      amp = sqrt(amp);
      float peak = -1.0 / mix(8.0, 5.0, uSharp);
      vec3 w = amp * peak;
      vec3 rcpW = 1.0 / (1.0 + 4.0 * w);
      vec3 col = clamp(((b + d + f + h) * w + e) * rcpW, 0.0, 1.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPerf(ctx) {
  const S = () => ctx.state.data.settings;
  const steps = [1.0, 0.9, 0.8, 0.7, 0.62, 0.55, 0.5];
  let stepIdx = 0, ema = 1000 / 60, since = 0, cool = 0, lastApplied = -1;
  const fxaa = new ShaderPass(FXAAShader);
  const cas = new ShaderPass(CASShader);
  let overlay = null;
  const api = {
    fxaa, cas, scale: 1,
    get frameMs() { return ema; },
    // internal render size for the current scale
    internalSize() { const s = ctx.renderer.getDrawingBufferSize(new THREE.Vector2()); const k = api.scale; return { w: Math.max(320, Math.round(s.x * k)), h: Math.max(180, Math.round(s.y * k)), full: s }; },
    applyScale() {
      const post = ctx.post; if (!post || !post.composer) return;
      const { w, h, full } = api.internalSize();
      // the chain renders at internal size; the final passes write to the full canvas
      post.composer.setSize(w, h);
      post.bloom?.setSize?.(Math.round(w / 2), Math.round(h / 2));
      fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
      cas.material.uniforms.uTexel.value.set(1 / w, 1 / h);
      cas.material.uniforms.uSharp.value = 0.2 + 0.5 * (1 - api.scale);
      post.uniforms?.uRes?.value.set(w, h);
      lastApplied = api.scale;
      ctx.events.emit('renderScale', api.scale, w, h, full);
    },
    ensurePasses() {
      const c = ctx.post?.composer; if (!c) return;
      const p = c.passes; const n = p.length;
      if (n < 2 || p[n - 2] !== fxaa || p[n - 1] !== cas) {
        const i1 = p.indexOf(fxaa); if (i1 >= 0) p.splice(i1, 1);
        const i2 = p.indexOf(cas); if (i2 >= 0) p.splice(i2, 1);
        for (const x of p) x.renderToScreen = false;
        c.addPass(fxaa); c.addPass(cas);
        fxaa.enabled = S().quality !== 'low';
        api.applyScale();
      }
    },
    setScale(s) { api.scale = Math.max(0.5, Math.min(1, s)); stepIdx = steps.findIndex((v) => v <= api.scale + 1e-6); if (stepIdx < 0) stepIdx = steps.length - 1; api.applyScale(); },
    toggleOverlay() { if (!overlay) { overlay = document.createElement('div'); overlay.id = 'perf'; overlay.style.cssText = 'position:fixed;left:10px;top:10px;z-index:50;font:11px/1.5 IBM Plex Mono,monospace;color:#e0a458;background:rgba(0,0,0,.55);padding:6px 8px;pointer-events:none;white-space:pre'; document.body.appendChild(overlay); } else { overlay.remove(); overlay = null; } },
    update(dt, rawMs) {
      const s = S();
      const target = s.targetFps || 100;
      const budget = 1000 / target;
      ema = ema * 0.9 + rawMs * 0.1;
      const maxScale = s.resolutionScale ?? 1;
      if (s.dynamicResolution !== false) {
        cool -= dt;
        if (ema > budget * 1.08 && cool <= 0 && stepIdx < steps.length - 1) { stepIdx++; cool = 0.75; since = 0; }
        else if (ema < budget * 0.8) { since += dt; if (since > 2.0 && stepIdx > 0 && cool <= 0) { stepIdx--; cool = 1.0; since = 0; } }
        else since = 0;
      } else stepIdx = 0;
      const want = Math.min(maxScale, steps[stepIdx]);
      if (Math.abs(want - api.scale) > 1e-6) { api.scale = want; }
      api.ensurePasses();
      if (api.scale !== lastApplied) api.applyScale();
      if (overlay) {
        const info = ctx.renderer.info; const { w, h, full } = api.internalSize();
        overlay.textContent = `${(1000 / ema).toFixed(0)} fps  ${ema.toFixed(1)} ms  target ${target}\nrender ${w}×${h} of ${full.x}×${full.y}  scale ${api.scale.toFixed(2)}\ncalls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  ent ${ctx.enemies?.list.length ?? 0}\nquality ${s.quality}`;
      }
    },
  };
  ctx.events.on('keydown', (code) => { if (code === 'F3') api.toggleOverlay(); });
  return api;
}
