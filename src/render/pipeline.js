/**
 * WYRMHOLD — rendering pipeline.
 *
 * Forward HDR render into a half-float buffer, then a hand-written post chain:
 *
 *   sky (scaled) → opaque → water → SSAO → SSR → god rays
 *   → composite (AO + reflections + volumetric fog + shafts)
 *   → TAA resolve / temporal upscale (output resolution)
 *   → bloom mip chain → auto-exposure
 *   → final grade (tonemap, DoF, motion blur, CA, grain, vignette, sharpen)
 *
 * Everything after the composite runs at output resolution, so a render scale
 * below 100% costs only the expensive geometry passes — that is what makes the
 * "4K on a laptop" and "60fps on a phone" modes possible.
 */

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { makeNoiseTexture, makeLensDirt } from './textures.js';
import { clamp, saturate } from '../core/math.js';

// ---------------------------------------------------------------------------
// Shared shader chunks
// ---------------------------------------------------------------------------

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DEPTH_UTIL = /* glsl */`
uniform mat4 uProjInv;
uniform float uNear;
uniform float uFar;

float rawDepth(sampler2D t, vec2 uv){ return texture2D(t, uv).x; }
float linearDepth(float d){
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
vec3 viewPos(vec2 uv, float d){
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * c;
  return v.xyz / v.w;
}
`;

const LUMA = /* glsl */`
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// ---------------------------------------------------------------------------
// Fullscreen pass helper
// ---------------------------------------------------------------------------

const QUAD_GEO = new THREE.PlaneGeometry(2, 2);
const QUAD_CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class Pass {
  constructor(fragmentShader, uniforms = {}, defines = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(QUAD_GEO, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  get u() { return this.material.uniforms; }
  setDefine(k, v) {
    if (this.material.defines[k] === v) return;
    this.material.defines[k] = v;
    this.material.needsUpdate = true;
  }
  render(renderer, target = null) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, QUAD_CAM);
  }
  dispose() { this.material.dispose(); }
}

// ---------------------------------------------------------------------------
// Pass shaders
// ---------------------------------------------------------------------------

const BLIT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform float uScale;
varying vec2 vUv;
void main(){ gl_FragColor = texture2D(tDiffuse, vUv) * uScale; }
`;

const SSAO_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDepth;
uniform sampler2D tNoise;
uniform vec2 uRes;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uBias;
uniform float uIntensity;
uniform mat4 uProj;
varying vec2 vUv;
${DEPTH_UTIL}

vec3 viewNormal(vec2 uv, vec3 c){
  vec3 dx1 = viewPos(uv + vec2(uTexel.x, 0.0), rawDepth(tDepth, uv + vec2(uTexel.x, 0.0))) - c;
  vec3 dx2 = c - viewPos(uv - vec2(uTexel.x, 0.0), rawDepth(tDepth, uv - vec2(uTexel.x, 0.0)));
  vec3 dy1 = viewPos(uv + vec2(0.0, uTexel.y), rawDepth(tDepth, uv + vec2(0.0, uTexel.y))) - c;
  vec3 dy2 = c - viewPos(uv - vec2(0.0, uTexel.y), rawDepth(tDepth, uv - vec2(0.0, uTexel.y)));
  vec3 dx = abs(dx1.z) < abs(dx2.z) ? dx1 : dx2;
  vec3 dy = abs(dy1.z) < abs(dy2.z) ? dy1 : dy2;
  return normalize(cross(dx, dy));
}

void main(){
  float d = rawDepth(tDepth, vUv);
  if (d >= 0.99999){ gl_FragColor = vec4(1.0); return; }
  vec3 p = viewPos(vUv, d);
  vec3 n = viewNormal(vUv, p);
  if (n.z < 0.0) n = -n;

  vec4 rnd = texture2D(tNoise, vUv * uRes / 64.0);
  float ang = rnd.x * 6.2831853;
  float ca = cos(ang), sa = sin(ang);

  // Horizon-style occlusion: sample a disc in view space, project, compare.
  float occ = 0.0;
  float radius = uRadius / max(1.0, -p.z * 0.06);
  for (int i = 0; i < SSAO_SAMPLES; i++){
    float fi = (float(i) + 0.5) / float(SSAO_SAMPLES);
    float a = fi * 6.2831853 * 3.0 + ang;
    float r = radius * sqrt(fi) * (0.55 + 0.45 * rnd.y);
    vec2 off = vec2(cos(a), sin(a)) * r;
    off = vec2(off.x * ca - off.y * sa, off.x * sa + off.y * ca);
    vec2 suv = vUv + off * uTexel * 42.0;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sd = rawDepth(tDepth, suv);
    if (sd >= 0.99999) continue;
    vec3 sp = viewPos(suv, sd);
    vec3 dir = sp - p;
    float len = length(dir);
    if (len < 1e-4) continue;
    dir /= len;
    float ndl = max(0.0, dot(n, dir) - uBias);
    float atten = 1.0 / (1.0 + len * len * 0.35);
    occ += ndl * atten;
  }
  occ = occ / float(SSAO_SAMPLES);
  float ao = clamp(1.0 - occ * uIntensity * 3.4, 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

const BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uDir;
varying vec2 vUv;
${DEPTH_UTIL}
void main(){
  float dc = linearDepth(rawDepth(tDepth, vUv));
  float sum = 0.0, wsum = 0.0;
  for (int i = -4; i <= 4; i++){
    float fi = float(i);
    vec2 uv = vUv + uDir * uTexel * fi;
    float w = exp(-fi * fi / 8.0);
    float ds = linearDepth(rawDepth(tDepth, uv));
    w *= exp(-abs(ds - dc) * 1.6);
    sum += texture2D(tDiffuse, uv).r * w;
    wsum += w;
  }
  float v = sum / max(wsum, 1e-4);
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

const SSR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform mat4 uProj;
uniform float uWetness;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
${DEPTH_UTIL}
${LUMA}

vec3 viewNormal(vec2 uv, vec3 c){
  vec3 dx1 = viewPos(uv + vec2(uTexel.x, 0.0), rawDepth(tDepth, uv + vec2(uTexel.x, 0.0))) - c;
  vec3 dx2 = c - viewPos(uv - vec2(uTexel.x, 0.0), rawDepth(tDepth, uv - vec2(uTexel.x, 0.0)));
  vec3 dy1 = viewPos(uv + vec2(0.0, uTexel.y), rawDepth(tDepth, uv + vec2(0.0, uTexel.y))) - c;
  vec3 dy2 = c - viewPos(uv - vec2(0.0, uTexel.y), rawDepth(tDepth, uv - vec2(0.0, uTexel.y)));
  vec3 dx = abs(dx1.z) < abs(dx2.z) ? dx1 : dx2;
  vec3 dy = abs(dy1.z) < abs(dy2.z) ? dy1 : dy2;
  return normalize(cross(dx, dy));
}

void main(){
  gl_FragColor = vec4(0.0);
  float d = rawDepth(tDepth, vUv);
  if (d >= 0.9999) return;
  vec3 p = viewPos(vUv, d);
  vec3 n = viewNormal(vUv, p);
  if (n.z < 0.0) n = -n;

  // Only near-horizontal surfaces reflect, and only when wet. This is the
  // rain-slicked-ground effect; open water has its own planar reflection.
  float upness = smoothstep(0.72, 0.95, n.z * 0.0 + dot(normalize(n), normalize(vec3(0.0, 0.0, 1.0))));
  // n is in view space; reconstruct "world up" in view space via the proj-free trick
  float flat_ = smoothstep(0.55, 0.9, abs(n.z));
  float mask = uWetness;
  if (mask < 0.01) return;

  vec3 v = normalize(p);
  vec3 r = reflect(v, n);
  if (r.z > -0.02) return;

  float stride = 0.55 + 0.45 * fract(sin(dot(vUv, vec2(12.9, 78.2))) * 43758.5);
  vec3 sp = p;
  vec3 hitColor = vec3(0.0);
  float hit = 0.0;
  for (int i = 0; i < SSR_STEPS; i++){
    sp += r * stride * (1.0 + float(i) * 0.55);
    vec4 clip = uProj * vec4(sp, 1.0);
    if (clip.w <= 0.0) break;
    vec2 suv = (clip.xy / clip.w) * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float sd = rawDepth(tDepth, suv);
    vec3 spos = viewPos(suv, sd);
    float diff = spos.z - sp.z;
    if (diff > 0.0 && diff < 1.6 + float(i) * 0.4){
      hitColor = texture2D(tDiffuse, suv).rgb;
      // fade at screen edges and with grazing angle
      vec2 e = abs(suv - 0.5) * 2.0;
      float edge = 1.0 - smoothstep(0.65, 1.0, max(e.x, e.y));
      hit = edge;
      break;
    }
  }
  float fres = pow(1.0 - max(0.0, dot(-v, n)), 4.0);
  gl_FragColor = vec4(hitColor, hit * mask * uIntensity * mix(0.15, 1.0, fres));
}
`;

const GODRAY_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uSunVisible;
uniform float uDensity;
uniform float uDecay;
uniform float uWeight;
varying vec2 vUv;

void main(){
  if (uSunVisible <= 0.001){ gl_FragColor = vec4(0.0); return; }
  vec2 delta = (vUv - uSunUv) * uDensity / float(GODRAY_STEPS);
  vec2 uv = vUv;
  float illum = 1.0;
  float acc = 0.0;
  for (int i = 0; i < GODRAY_STEPS; i++){
    uv -= delta;
    float d = texture2D(tDepth, clamp(uv, 0.0, 1.0)).x;
    float s = step(0.9995, d);     // only unoccluded sky contributes
    acc += s * illum;
    illum *= uDecay;
  }
  acc = acc / float(GODRAY_STEPS) * uWeight * uSunVisible;
  // Shafts must fall off hard with angular distance from the sun. Without the
  // squared proximity term this becomes a uniform additive haze over the whole
  // frame, which reads as fog and destroys contrast everywhere.
  float prox = 1.0 - smoothstep(0.0, 0.85, length(vUv - uSunUv));
  gl_FragColor = vec4(vec3(acc * prox * prox), 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tSSR;
uniform sampler2D tGodray;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogFalloff;
uniform float uFogMax;
uniform float uAOStrength;
uniform float uSSRStrength;
uniform float uGodrayStrength;
uniform float uTime;
uniform float uUnderwater;
uniform vec3 uUnderwaterColor;
varying vec2 vUv;
${DEPTH_UTIL}
${LUMA}

void main(){
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  float d = rawDepth(tDepth, vUv);
  bool isSky = d >= 0.99999;

  // --- ambient occlusion (indirect only, so surfaces keep their key light) --
  #ifdef USE_AO
  if (!isSky){
    float ao = texture2D(tAO, vUv).r;
    ao = mix(1.0, ao, uAOStrength);
    // Preserve highlights: AO is scaled back where the pixel is already bright.
    float l = luma(col);
    float protect = smoothstep(1.2, 5.0, l);
    col *= mix(ao, 1.0, protect);
  }
  #endif

  // --- screen-space reflections -------------------------------------------
  #ifdef USE_SSR
  if (!isSky){
    vec4 ssr = texture2D(tSSR, vUv);
    col = mix(col, col + ssr.rgb * 0.9, ssr.a * uSSRStrength);
  }
  #endif

  // --- volumetric height fog with sun in-scattering ------------------------
  if (!isSky){
    vec3 vp = viewPos(vUv, d);
    vec3 wp = (uViewInv * vec4(vp, 1.0)).xyz;
    vec3 toCam = wp - uCamPos;
    float dist = length(toCam);
    vec3 dir = toCam / max(dist, 1e-4);

    // Analytic integral of exp(-falloff*h) along the ray.
    float hC = uCamPos.y - uFogHeight;
    float hD = dir.y;
    float fd = uFogDensity;
    float amount;
    if (abs(hD) < 1e-4){
      amount = fd * exp(-uFogFalloff * max(hC, 0.0)) * dist;
    } else {
      amount = fd * exp(-uFogFalloff * max(hC, 0.0)) * (1.0 - exp(-uFogFalloff * hD * dist)) / (uFogFalloff * hD);
    }
    amount = clamp(amount, 0.0, uFogMax);
    float mu = max(0.0, dot(dir, uSunDir));
    vec3 fogC = mix(uFogColor, uFogSunColor, pow(mu, 8.0) * 0.55);
    col = mix(col, fogC, amount);
  }

  // --- light shafts --------------------------------------------------------
  #ifdef USE_GODRAY
  float gr = texture2D(tGodray, vUv).r;
  col += gr * uSunColor * uGodrayStrength;
  #endif

  // --- underwater tint -----------------------------------------------------
  if (uUnderwater > 0.001){
    float dist = isSky ? 400.0 : length(viewPos(vUv, d));
    float ab = 1.0 - exp(-dist * 0.055);
    col = mix(col, uUnderwaterColor * (0.4 + 0.6 * luma(col)), ab * uUnderwater);
    col *= mix(1.0, 0.72, uUnderwater);
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

const TAA_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform vec2 uTexelCur;
uniform vec2 uTexelOut;
uniform mat4 uPrevViewProj;
uniform mat4 uViewInv;
uniform float uBlend;
uniform float uFirst;
varying vec2 vUv;
${DEPTH_UTIL}
${LUMA}

vec3 rgb2ycocg(vec3 c){
  return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
              0.5 * c.r - 0.5 * c.b,
             -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 ycocg2rgb(vec3 c){
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

void main(){
  vec3 cur = texture2D(tCurrent, vUv).rgb;
  if (uFirst > 0.5){ gl_FragColor = vec4(cur, 1.0); return; }

  float d = rawDepth(tDepth, vUv);
  vec3 vp = viewPos(vUv, d);
  vec4 wp = uViewInv * vec4(vp, 1.0);
  vec4 prevClip = uPrevViewProj * wp;
  vec2 prevUv = (prevClip.xy / max(prevClip.w, 1e-5)) * 0.5 + 0.5;

  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0){
    gl_FragColor = vec4(cur, 1.0); return;
  }

  vec3 hist = texture2D(tHistory, prevUv).rgb;

  // Neighbourhood clamp in YCoCg — kills ghosting without over-blurring.
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec3 s = rgb2ycocg(texture2D(tCurrent, vUv + vec2(float(x), float(y)) * uTexelCur).rgb);
    m1 += s; m2 += s * s;
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));
  vec3 minC = mean - sigma * 1.35;
  vec3 maxC = mean + sigma * 1.35;
  vec3 hy = clamp(rgb2ycocg(hist), minC, maxC);
  hist = ycocg2rgb(hy);

  // Reduce history weight where the reprojection moved a lot (disocclusion).
  float vel = length((prevUv - vUv) / uTexelOut);
  float blend = uBlend * exp(-vel * 0.012);
  vec3 outc = mix(cur, hist, clamp(blend, 0.0, 0.97));
  gl_FragColor = vec4(max(outc, vec3(0.0)), 1.0);
}
`;

const BLOOM_DOWN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uSoft;
uniform float uFirstPass;
uniform sampler2D tExposure;
uniform float uAutoExposure;
uniform float uManualExposure;
uniform float uClampMax;
varying vec2 vUv;
${LUMA}
vec3 tap(vec2 uv){ return texture2D(tDiffuse, uv).rgb; }
void main(){
  // 13-tap Call-of-Duty style downsample — stable, no fireflies.
  vec2 t = uTexel;
  vec3 a = tap(vUv + t * vec2(-2.0,  2.0));
  vec3 b = tap(vUv + t * vec2( 0.0,  2.0));
  vec3 c = tap(vUv + t * vec2( 2.0,  2.0));
  vec3 d = tap(vUv + t * vec2(-2.0,  0.0));
  vec3 e = tap(vUv);
  vec3 f = tap(vUv + t * vec2( 2.0,  0.0));
  vec3 g = tap(vUv + t * vec2(-2.0, -2.0));
  vec3 h = tap(vUv + t * vec2( 0.0, -2.0));
  vec3 i = tap(vUv + t * vec2( 2.0, -2.0));
  vec3 j = tap(vUv + t * vec2(-1.0,  1.0));
  vec3 k = tap(vUv + t * vec2( 1.0,  1.0));
  vec3 l = tap(vUv + t * vec2(-1.0, -1.0));
  vec3 m = tap(vUv + t * vec2( 1.0, -1.0));
  vec3 col = e * 0.125;
  col += (a + c + g + i) * 0.03125;
  col += (b + d + f + h) * 0.0625;
  col += (j + k + l + m) * 0.125;
  if (uFirstPass > 0.5){
    // Work in *exposed* space. The incoming buffer is scene-linear, so an
    // absolute threshold would bloom everything at noon and nothing at night.
    // From here the chain is exposed, and the final pass adds it after it has
    // applied exposure itself.
    float ae = mix(1.0, texture2D(tExposure, vec2(0.5)).r, uAutoExposure) * uManualExposure;
    col *= ae;
    float l2 = luma(col);
    float knee = uThreshold * uSoft + 1e-5;
    float soft = clamp(l2 - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    float contrib = max(max(soft, l2 - uThreshold), 0.0) / max(l2, 1e-5);
    col *= contrib;
    // One sun-disc pixel is thousands of times brighter than the scene; without
    // a ceiling the mip chain smears it over the whole frame as flat haze.
    col = min(col, vec3(uClampMax));
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

const BLOOM_UP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uScale;
varying vec2 vUv;
void main(){
  vec2 t = uTexel * uRadius;
  vec3 c = vec3(0.0);
  c += texture2D(tDiffuse, vUv + t * vec2(-1.0,  1.0)).rgb * 0.0625;
  c += texture2D(tDiffuse, vUv + t * vec2( 0.0,  1.0)).rgb * 0.125;
  c += texture2D(tDiffuse, vUv + t * vec2( 1.0,  1.0)).rgb * 0.0625;
  c += texture2D(tDiffuse, vUv + t * vec2(-1.0,  0.0)).rgb * 0.125;
  c += texture2D(tDiffuse, vUv).rgb * 0.25;
  c += texture2D(tDiffuse, vUv + t * vec2( 1.0,  0.0)).rgb * 0.125;
  c += texture2D(tDiffuse, vUv + t * vec2(-1.0, -1.0)).rgb * 0.0625;
  c += texture2D(tDiffuse, vUv + t * vec2( 0.0, -1.0)).rgb * 0.125;
  c += texture2D(tDiffuse, vUv + t * vec2( 1.0, -1.0)).rgb * 0.0625;
  gl_FragColor = vec4(c * uScale, 1.0);
}
`;

const EXPOSURE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uSpeedUp;
uniform float uSpeedDown;
uniform float uKey;
uniform float uMin;
uniform float uMax;
varying vec2 vUv;
${LUMA}
void main(){
  float acc = 0.0;
  const int N = 5;
  for (int y = 0; y < N; y++)
  for (int x = 0; x < N; x++){
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / float(N);
    // centre-weighted so the sky doesn't dominate metering
    float w = 1.0 - 0.55 * length(uv - 0.5) * 2.0;
    acc += log(max(luma(texture2D(tScene, uv).rgb), 1e-4)) * max(w, 0.15);
  }
  float avg = exp(acc / float(N * N));
  float target = clamp(uKey / max(avg, 1e-4), uMin, uMax);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (prev <= 0.0) prev = target;
  float speed = target < prev ? uSpeedDown : uSpeedUp;
  float e = prev + (target - prev) * clamp(uDt * speed, 0.0, 1.0);
  gl_FragColor = vec4(e, e, e, 1.0);
}
`;

const FINAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform sampler2D tNoise;
uniform sampler2D tDirt;
uniform sampler2D tExposure;
uniform vec2 uRes;
uniform vec2 uTexel;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uVignette;
uniform float uGrain;
uniform float uChroma;
uniform float uSharpen;
uniform float uMotionBlur;
uniform float uDofStrength;
uniform float uDofFocus;
uniform float uDofRange;
uniform float uBrightness;
uniform float uSaturation;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uLensDirt;
uniform float uFlare;
uniform vec2 uSunUv;
uniform float uSunVisible;
uniform vec3 uSunColor;
uniform mat4 uPrevViewProj;
uniform mat4 uViewInv;
uniform float uAutoExposure;
uniform float uHurt;
varying vec2 vUv;
${DEPTH_UTIL}
${LUMA}

// --- tone mapping -----------------------------------------------------------
vec3 acesFilm(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 reinhard(vec3 x){ return x / (1.0 + x); }
vec3 neutral(vec3 c){
  const float sp = 0.076, sl = 0.8, d = 0.15;
  float p = max(c.r, max(c.g, c.b));
  float pn;
  if (p < sl) pn = p;
  else {
    float nn = 1.0 - sl;
    pn = 1.0 - nn * nn / (p + nn - sl);
  }
  float g = p > 0.0 ? pn / p : 1.0;
  vec3 cc = c * g;
  float dd = 1.0 - 1.0 / (d * (p - pn) + 1.0);
  return mix(cc, vec3(pn), dd * sp / 0.076 * 0.0 + dd);
}
// AgX (Troy Sobotka) — the filmic default; gorgeous highlight roll-off.
vec3 agxDefaultContrast(vec3 x){
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 col){
  const mat3 inSet = mat3(
    0.8425640, 0.0784336, 0.0792237,
    0.0423889, 0.8784736, 0.0791661,
    0.0423889, 0.0784336, 0.8791430);
  const mat3 outSet = mat3(
     1.1968790, -0.0980190, -0.0990297,
    -0.0528968,  1.1519110, -0.0989000,
    -0.0529716, -0.0980190,  1.1510810);
  const float minEv = -12.47393, maxEv = 4.026069;
  col = inSet * max(col, vec3(0.0));
  col = clamp(log2(max(col, 1e-10)), minEv, maxEv);
  col = (col - minEv) / (maxEv - minEv);
  col = agxDefaultContrast(col);
  col = outSet * col;
  // slight saturation restore, AgX is intentionally desaturating
  float l = luma(col);
  col = mix(vec3(l), col, 1.18);
  return clamp(col, 0.0, 1.0);
}
vec3 tonemap(vec3 c){
  #if TONEMAP == 0
    return agx(c);
  #elif TONEMAP == 1
    return acesFilm(c);
  #elif TONEMAP == 2
    return neutral(c);
  #else
    return reinhard(c);
  #endif
}

vec3 grade(vec3 c){
  c = pow(max(c, vec3(0.0)), uGamma);
  c = c * uGain + uLift;
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  return c;
}

void main(){
  vec2 uv = vUv;
  float dRaw = rawDepth(tDepth, uv);

  // --- motion blur (camera reprojection) ----------------------------------
  vec2 mbDir = vec2(0.0);
  #ifdef USE_MOTIONBLUR
  {
    vec3 vp = viewPos(uv, dRaw);
    vec4 wp = uViewInv * vec4(vp, 1.0);
    vec4 pc = uPrevViewProj * wp;
    vec2 prevUv = (pc.xy / max(pc.w, 1e-5)) * 0.5 + 0.5;
    mbDir = (uv - prevUv) * uMotionBlur * 0.5;
    float m = length(mbDir);
    if (m > 0.05) mbDir *= 0.05 / m;
  }
  #endif

  // --- depth of field CoC --------------------------------------------------
  float coc = 0.0;
  #ifdef USE_DOF
  {
    float lin = linearDepth(dRaw);
    coc = clamp(abs(lin - uDofFocus) / max(uDofRange, 0.001), 0.0, 1.0);
    coc = pow(coc, 1.6) * uDofStrength;
  }
  #endif

  // --- gather (DoF + motion blur share one loop) ---------------------------
  vec3 col = vec3(0.0);
  #if defined(USE_DOF) || defined(USE_MOTIONBLUR)
  {
    float radius = coc * 14.0;
    float total = 0.0;
    const int TAPS = 10;
    for (int i = 0; i < TAPS; i++){
      float fi = float(i) / float(TAPS - 1);
      // golden-angle spiral for the bokeh, plus a linear sweep for motion
      float a = fi * 6.2831853 * 3.883222;
      vec2 off = vec2(cos(a), sin(a)) * sqrt(fi) * radius * uTexel;
      off += mbDir * (fi - 0.5);
      col += texture2D(tDiffuse, uv + off).rgb;
      total += 1.0;
    }
    col /= total;
  }
  #else
    col = texture2D(tDiffuse, uv).rgb;
  #endif

  // --- chromatic aberration ------------------------------------------------
  if (uChroma > 0.001){
    vec2 d2 = (uv - 0.5);
    float r2 = dot(d2, d2);
    vec2 off = d2 * r2 * uChroma * 0.035;
    col.r = texture2D(tDiffuse, uv + off).r;
    col.b = texture2D(tDiffuse, uv - off).b;
  }

  // --- contrast-adaptive sharpen ------------------------------------------
  if (uSharpen > 0.001){
    vec3 n1 = texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb;
    vec3 n2 = texture2D(tDiffuse, uv - vec2(0.0, uTexel.y)).rgb;
    vec3 n3 = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb;
    vec3 n4 = texture2D(tDiffuse, uv - vec2(uTexel.x, 0.0)).rgb;
    vec3 mn = min(min(n1, n2), min(n3, n4));
    vec3 mx = max(max(n1, n2), max(n3, n4));
    vec3 amt = clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
    vec3 sharp = col * 5.0 - (n1 + n2 + n3 + n4);
    col = mix(col, clamp(sharp * 0.2 + col * 0.0 + col, 0.0, 64.0), amt * uSharpen * 0.28);
  }

  // --- exposure ------------------------------------------------------------
  float ae = mix(1.0, texture2D(tExposure, vec2(0.5)).r, uAutoExposure);
  col *= uExposure * ae * uBrightness;

  // --- bloom (already exposed by the extraction pass) ----------------------
  vec3 bloom = texture2D(tBloom, uv).rgb;
  #ifdef USE_LENSDIRT
  {
    vec3 dirt = texture2D(tDirt, uv).rgb;
    bloom += bloom * dirt * uLensDirt * 3.0;
  }
  #endif
  col += bloom * uBloom;

  // --- anamorphic-ish lens flare ------------------------------------------
  #ifdef USE_FLARE
  if (uSunVisible > 0.001){
    vec2 d2 = uSunUv - uv;
    float streak = exp(-abs(d2.y) * 480.0) * exp(-abs(d2.x) * 7.0);
    col += uSunColor * streak * uFlare * uSunVisible * 0.18;
    for (int i = 1; i <= 3; i++){
      vec2 gp = mix(uSunUv, vec2(1.0) - uSunUv, float(i) * 0.42);
      float g = exp(-length(uv - gp) * (34.0 + float(i) * 12.0));
      col += uSunColor * g * uFlare * uSunVisible * (0.10 / float(i));
    }
  }
  #endif

  // --- tone map + grade ----------------------------------------------------
  col = tonemap(col);
  col = grade(col);

  // --- damage flash --------------------------------------------------------
  if (uHurt > 0.001){
    float edge = smoothstep(0.25, 0.95, length(uv - 0.5) * 1.42);
    col = mix(col, vec3(0.42, 0.03, 0.02), edge * uHurt * 0.85);
  }

  // --- vignette ------------------------------------------------------------
  if (uVignette > 0.001){
    vec2 d2 = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float v = 1.0 - smoothstep(0.42, 1.05, length(d2) * 1.25);
    col *= mix(1.0, v, uVignette);
  }

  // --- grain + dither ------------------------------------------------------
  if (uGrain > 0.001){
    vec3 n = texture2D(tNoise, uv * uRes / 256.0 + vec2(fract(uTime * 7.3), fract(uTime * 5.1))).rgb;
    float l = luma(col);
    // more grain in the shadows, like real film
    col += (n - 0.5) * uGrain * (0.35 + 0.65 * (1.0 - l));
  }
  col += (texture2D(tNoise, uv * uRes / 256.0).r - 0.5) * (1.0 / 255.0);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const FXAA_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
varying vec2 vUv;
${LUMA}
void main(){
  vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(tDiffuse, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(tDiffuse, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  vec3 rgbM  = texture2D(tDiffuse, vUv).rgb;
  float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.0625, 0.0078125);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, -8.0, 8.0) * uTexel;
  vec3 rgbA = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0/3.0 - 0.5)).rgb +
                     texture2D(tDiffuse, vUv + dir * (2.0/3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb +
                                   texture2D(tDiffuse, vUv + dir * 0.5).rgb);
  float lB = luma(rgbB);
  gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Colour grades
// ---------------------------------------------------------------------------

const GRADES = {
  neutral: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1.0 },
  nordic: { lift: [-0.012, 0.0, 0.024], gamma: [1.03, 1.0, 0.965], gain: [0.965, 1.0, 1.075], sat: 0.92 },
  ember: { lift: [0.022, 0.004, -0.012], gamma: [0.96, 1.0, 1.06], gain: [1.08, 1.0, 0.90], sat: 1.06 },
  bleak: { lift: [0.012, 0.012, 0.016], gamma: [1.05, 1.05, 1.03], gain: [0.95, 0.96, 0.98], sat: 0.62 },
  saga: { lift: [-0.024, -0.020, -0.012], gamma: [1.10, 1.06, 1.0], gain: [1.06, 1.02, 1.02], sat: 1.14 },
};

// Halton(2,3) — the standard TAA jitter sequence.
function halton(index, base) {
  let f = 1, r = 0, i = index;
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
  return r;
}
const JITTER = [];
for (let i = 1; i <= 16; i++) JITTER.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5]);

/** Adds/removes boolean #defines on a pass, recompiling only when it changed. */
function setFlags(pass, flags) {
  const d = pass.material.defines;
  let changed = false;
  for (const [k, on] of Object.entries(flags)) {
    const has = k in d;
    if (on && !has) { d[k] = 1; changed = true; }
    else if (!on && has) { delete d[k]; changed = true; }
  }
  if (changed) pass.material.needsUpdate = true;
}

// ---------------------------------------------------------------------------

export class Pipeline {
  constructor(renderer, scene, camera, sky) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sky = sky;

    this.outW = 1; this.outH = 1;
    this.renW = 1; this.renH = 1;
    this.frame = 0;
    this.enabled = true;

    this.noiseTex = makeNoiseTexture(256, 17);
    this.dirtTex = makeLensDirt(512, 23);

    this._prevViewProj = new THREE.Matrix4();
    this._viewProj = new THREE.Matrix4();
    this._jitterIdx = 0;
    this._historyValid = false;

    this.stats = { drawCalls: 0, triangles: 0, gpuPasses: 0 };

    this._buildPasses();
    this._targets = {};
    this.bloomLevels = 6;
  }

  // -------------------------------------------------------------------------
  _buildPasses() {
    this.blit = new Pass(BLIT_FRAG, { tDiffuse: { value: null }, uScale: { value: 1 } });

    this.ssao = new Pass(SSAO_FRAG, {
      tDepth: { value: null }, tNoise: { value: this.noiseTex },
      uRes: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.0 }, uBias: { value: 0.035 }, uIntensity: { value: 1 },
      uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uNear: { value: 0.1 }, uFar: { value: 1000 },
    }, { SSAO_SAMPLES: 12 });

    this.blur = new Pass(BLUR_FRAG, {
      tDiffuse: { value: null }, tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(1, 0) },
      uProjInv: { value: new THREE.Matrix4() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
    });

    this.ssr = new Pass(SSR_FRAG, {
      tDiffuse: { value: null }, tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() }, uProj: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
      uWetness: { value: 0 }, uIntensity: { value: 1 }, uTime: { value: 0 },
    }, { SSR_STEPS: 14 });

    this.godray = new Pass(GODRAY_FRAG, {
      tDepth: { value: null }, uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uSunVisible: { value: 0 }, uDensity: { value: 0.86 },
      uDecay: { value: 0.955 }, uWeight: { value: 1.0 },
    }, { GODRAY_STEPS: 28 });

    this.composite = new Pass(COMPOSITE_FRAG, {
      tDiffuse: { value: null }, tDepth: { value: null }, tAO: { value: null },
      tSSR: { value: null }, tGodray: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uNear: { value: 0.1 }, uFar: { value: 1000 },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color(0.55, 0.62, 0.72) },
      uFogSunColor: { value: new THREE.Color(1, 0.85, 0.6) },
      uFogDensity: { value: 0.012 }, uFogHeight: { value: 0 },
      uFogFalloff: { value: 0.012 }, uFogMax: { value: 0.92 },
      uAOStrength: { value: 1 }, uSSRStrength: { value: 1 }, uGodrayStrength: { value: 1 },
      uTime: { value: 0 }, uUnderwater: { value: 0 },
      uUnderwaterColor: { value: new THREE.Color(0.12, 0.28, 0.34) },
    });

    this.taa = new Pass(TAA_FRAG, {
      tCurrent: { value: null }, tHistory: { value: null }, tDepth: { value: null },
      uTexelCur: { value: new THREE.Vector2() }, uTexelOut: { value: new THREE.Vector2() },
      uPrevViewProj: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
      uBlend: { value: 0.9 }, uFirst: { value: 1 },
    });

    this.fxaa = new Pass(FXAA_FRAG, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } });

    this.bloomDown = new Pass(BLOOM_DOWN_FRAG, {
      tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 1.0 }, uSoft: { value: 0.6 }, uFirstPass: { value: 0 },
      tExposure: { value: null }, uAutoExposure: { value: 1 }, uManualExposure: { value: 1 },
      uClampMax: { value: 5.0 },
    });
    this.bloomUp = new Pass(BLOOM_UP_FRAG, {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.1 },
      uScale: { value: 1 },
    });
    // Upsampling accumulates into the larger mip with additive blending, which
    // avoids sampling the very texture we are writing to.
    this.bloomUp.material.blending = THREE.AdditiveBlending;
    this.bloomUp.material.transparent = true;

    this.exposurePass = new Pass(EXPOSURE_FRAG, {
      tScene: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 },
      uSpeedUp: { value: 1.6 }, uSpeedDown: { value: 0.6 }, uKey: { value: 0.19 },
      // A wide auto-exposure range lets a frame full of dark conifers drag the
      // exposure up until the sunlit ground clips. Keep it on a short leash.
      uMin: { value: 0.30 }, uMax: { value: 3.2 },
    });

    this.final = new Pass(FINAL_FRAG, {
      tDiffuse: { value: null }, tBloom: { value: null }, tDepth: { value: null },
      tNoise: { value: this.noiseTex }, tDirt: { value: this.dirtTex }, tExposure: { value: null },
      uRes: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() },
      uProjInv: { value: new THREE.Matrix4() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
      uTime: { value: 0 }, uExposure: { value: 1 }, uBloom: { value: 0.75 },
      uVignette: { value: 0.4 }, uGrain: { value: 0.18 }, uChroma: { value: 0.22 },
      uSharpen: { value: 0.4 }, uMotionBlur: { value: 0.4 },
      uDofStrength: { value: 0 }, uDofFocus: { value: 10 }, uDofRange: { value: 30 },
      uBrightness: { value: 1 }, uSaturation: { value: 1 },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uLensDirt: { value: 0.5 }, uFlare: { value: 1 },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) }, uSunVisible: { value: 0 },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uPrevViewProj: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() },
      uAutoExposure: { value: 1 }, uHurt: { value: 0 },
    }, { TONEMAP: 0 });
  }

  // -------------------------------------------------------------------------
  _makeRT(w, h, opts = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      type: opts.type ?? THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: opts.minFilter ?? THREE.LinearFilter,
      magFilter: opts.magFilter ?? THREE.LinearFilter,
      depthBuffer: !!opts.depth,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    if (opts.depthTexture) {
      const dt = new THREE.DepthTexture(Math.max(1, w | 0), Math.max(1, h | 0));
      dt.type = THREE.UnsignedIntType;
      dt.format = THREE.DepthFormat;
      dt.minFilter = dt.magFilter = THREE.NearestFilter;
      rt.depthTexture = dt;
    }
    return rt;
  }

  _disposeTargets() {
    const t = this._targets;
    for (const k of Object.keys(t)) {
      const v = t[k];
      if (!v) continue;
      if (Array.isArray(v)) v.forEach(x => x && x.dispose());
      else v.dispose();
    }
    this._targets = {};
  }

  /**
   * @param {number} outW output (canvas) width in device pixels
   * @param {number} renderScale internal resolution multiplier
   */
  setSize(outW, outH, renderScale) {
    outW = Math.max(2, Math.round(outW));
    outH = Math.max(2, Math.round(outH));
    const renW = Math.max(2, Math.round(outW * renderScale));
    const renH = Math.max(2, Math.round(outH * renderScale));
    if (outW === this.outW && outH === this.outH && renW === this.renW && renH === this.renH) return;

    this.outW = outW; this.outH = outH;
    this.renW = renW; this.renH = renH;
    this._disposeTargets();

    const t = this._targets;
    t.hdr = this._makeRT(renW, renH, { depth: true, depthTexture: true });
    t.opaque = this._makeRT(Math.max(2, renW >> 1), Math.max(2, renH >> 1));
    t.ao = this._makeRT(Math.max(2, renW >> 1), Math.max(2, renH >> 1), { type: THREE.UnsignedByteType });
    t.aoBlur = this._makeRT(Math.max(2, renW >> 1), Math.max(2, renH >> 1), { type: THREE.UnsignedByteType });
    t.ssr = this._makeRT(Math.max(2, renW >> 1), Math.max(2, renH >> 1));
    t.godray = this._makeRT(Math.max(2, renW >> 2), Math.max(2, renH >> 2), { type: THREE.UnsignedByteType });
    t.composite = this._makeRT(renW, renH);
    t.taaA = this._makeRT(outW, outH);
    t.taaB = this._makeRT(outW, outH);
    t.post = this._makeRT(outW, outH);
    t.sky = null; // sized on demand from cloud quality

    // bloom mip chain
    t.bloom = [];
    let bw = outW >> 1, bh = outH >> 1;
    for (let i = 0; i < this.bloomLevels; i++) {
      t.bloom.push(this._makeRT(Math.max(2, bw), Math.max(2, bh)));
      bw >>= 1; bh >>= 1;
      if (bw < 4 || bh < 4) { this._activeBloom = i + 1; break; }
      this._activeBloom = i + 1;
    }
    // Dedicated metering buffer. The bloom chain cannot be used for this: it
    // is thresholded and already exposed, so metering from it is a feedback
    // loop that pins the exposure at its limit.
    t.meter = this._makeRT(32, 32);
    t.exposureA = this._makeRT(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    t.exposureB = this._makeRT(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this._taaPing = true;
    this._expPing = true;

    this._historyValid = false;
    this._resizeSkyTarget();
  }

  _resizeSkyTarget() {
    const q = settings.get('cloudQuality');
    const div = q === 'ultra' ? 1 : q === 'high' ? 2 : q === 'medium' ? 2 : 3;
    const w = Math.max(8, Math.round(this.renW / div));
    const h = Math.max(8, Math.round(this.renH / div));
    if (this._targets.sky && this._targets.sky.width === w && this._targets.sky.height === h) return;
    this._targets.sky?.dispose();
    this._targets.sky = this._makeRT(w, h);
  }

  // -------------------------------------------------------------------------
  applySettings() {
    const s = settings;
    // AA / AO / SSR sample counts
    this.ssao.setDefine('SSAO_SAMPLES', s.get('ssao') === 'high' ? 16 : 8);
    this.ssr.setDefine('SSR_STEPS', s.get('preset') === 'potato' ? 8 : 16);
    this.godray.setDefine('GODRAY_STEPS', s.get('volumetrics') === 'high' ? 40 : s.get('volumetrics') === 'off' ? 16 : 26);

    const useAO = s.get('ssao') !== 'off';
    const useSSR = s.get('ssr');
    const useGR = s.get('godrays');
    setFlags(this.composite, { USE_AO: useAO, USE_SSR: useSSR, USE_GODRAY: useGR });

    this.final.setDefine('TONEMAP', { agx: 0, aces: 1, neutral: 2, reinhard: 3 }[s.get('tonemap')] ?? 0);
    setFlags(this.final, {
      USE_MOTIONBLUR: s.get('motionBlur') > 0.01,
      USE_DOF: s.get('dof') !== 'off',
      USE_FLARE: s.get('lensFlare'),
      USE_LENSDIRT: s.get('lensFlare'),
    });

    const g = GRADES[s.get('grade')] || GRADES.neutral;
    this.final.u.uLift.value.fromArray(g.lift);
    this.final.u.uGamma.value.fromArray(g.gamma);
    this.final.u.uGain.value.fromArray(g.gain);
    this.final.u.uSaturation.value = g.sat;
    this.final.u.uBloom.value = s.get('bloom') ? s.get('bloomIntensity') : 0;
    this.final.u.uVignette.value = s.get('vignette');
    this.final.u.uGrain.value = s.get('filmGrain');
    this.final.u.uChroma.value = s.get('chromatic');
    this.final.u.uSharpen.value = s.get('sharpen');
    this.final.u.uMotionBlur.value = s.get('motionBlur');
    this.final.u.uBrightness.value = s.get('brightness');
    this.final.u.uExposure.value = Math.pow(2, s.get('exposure'));
    this.final.u.uAutoExposure.value = s.get('autoExposure') ? 1 : 0;
    const flare = s.get('lensFlare');
    this.final.u.uLensDirt.value = flare ? 0.55 : 0;
    this.final.u.uFlare.value = flare ? 1 : 0;

    this.ssao.u.uIntensity.value = s.get('ssaoIntensity');
    this.taa.u.uBlend.value = s.get('taaStrength');

    this._resizeSkyTarget();
    this.sky.setQuality(s.get('cloudQuality'));
  }

  /** Applies the TAA sub-pixel jitter to the camera projection. */
  applyJitter(camera) {
    const aa = settings.get('antialiasing');
    camera.clearViewOffset?.();
    if (aa !== 'taa') { this._jitterX = 0; this._jitterY = 0; return; }
    const j = JITTER[this._jitterIdx % JITTER.length];
    this._jitterIdx++;
    this._jitterX = j[0]; this._jitterY = j[1];
    // Jitter via the projection matrix so it doesn't disturb culling.
    camera.projectionMatrix.elements[8] += (this._jitterX * 2) / this.renW;
    camera.projectionMatrix.elements[9] += (this._jitterY * 2) / this.renH;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  // -------------------------------------------------------------------------
  /**
   * @param {object} env  world/lighting state from World
   * @param {object} hooks { renderOpaque(target), renderWater(target, opaqueTex) }
   */
  render(dt, env, hooks) {
    const r = this.renderer, t = this._targets, cam = this.camera;
    this.frame++;
    const time = env.timeSec;

    const projInv = cam.projectionMatrixInverse;
    const viewInv = cam.matrixWorld;
    this._viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const setDepthU = (p) => {
      p.u.uProjInv.value.copy(projInv);
      p.u.uNear.value = cam.near;
      p.u.uFar.value = cam.far;
    };

    r.setRenderTarget(null);
    r.autoClear = true;

    // ---------------------------------------------------- 1. sky (scaled)
    this.sky.update(env, cam);
    this.sky.render(r, t.sky);

    // upscale sky into the HDR buffer, then draw the world on top
    r.setRenderTarget(t.hdr);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    this.blit.u.tDiffuse.value = t.sky.texture;
    this.blit.u.uScale.value = 1;
    this.blit.render(r, t.hdr);

    // ---------------------------------------------------- 2. opaque geometry
    r.autoClear = false;
    hooks.renderOpaque(t.hdr);

    // ---------------------------------------------------- 3. water & transparents
    if (hooks.renderWater) {
      this.blit.u.tDiffuse.value = t.hdr.texture;
      this.blit.render(r, t.opaque);
      r.setRenderTarget(t.hdr);
      hooks.renderWater(t.hdr, t.opaque.texture);
    }
    r.autoClear = true;

    // ---------------------------------------------------- 4. SSAO
    const useAO = settings.get('ssao') !== 'off';
    if (useAO) {
      setDepthU(this.ssao);
      this.ssao.u.tDepth.value = t.hdr.depthTexture;
      this.ssao.u.uRes.value.set(t.ao.width, t.ao.height);
      this.ssao.u.uTexel.value.set(1 / t.ao.width, 1 / t.ao.height);
      this.ssao.u.uProj.value.copy(cam.projectionMatrix);
      this.ssao.u.uRadius.value = 1.0;
      this.ssao.render(r, t.ao);

      setDepthU(this.blur);
      this.blur.u.tDepth.value = t.hdr.depthTexture;
      this.blur.u.uTexel.value.set(1 / t.ao.width, 1 / t.ao.height);
      this.blur.u.tDiffuse.value = t.ao.texture;
      this.blur.u.uDir.value.set(1, 0);
      this.blur.render(r, t.aoBlur);
      this.blur.u.tDiffuse.value = t.aoBlur.texture;
      this.blur.u.uDir.value.set(0, 1);
      this.blur.render(r, t.ao);
    }

    // ---------------------------------------------------- 5. SSR
    const wetness = env.wetness || 0;
    const useSSR = settings.get('ssr') && wetness > 0.01;
    if (useSSR) {
      setDepthU(this.ssr);
      this.ssr.u.tDiffuse.value = t.hdr.texture;
      this.ssr.u.tDepth.value = t.hdr.depthTexture;
      this.ssr.u.uTexel.value.set(1 / t.ssr.width, 1 / t.ssr.height);
      this.ssr.u.uProj.value.copy(cam.projectionMatrix);
      this.ssr.u.uWetness.value = wetness;
      this.ssr.u.uTime.value = time;
      this.ssr.render(r, t.ssr);
    }

    // ---------------------------------------------------- 6. god rays
    const useGR = settings.get('godrays');
    let sunUv = this._sunScreenUv(env.sunDir, cam);
    if (useGR) {
      this.godray.u.tDepth.value = t.hdr.depthTexture;
      this.godray.u.uSunUv.value.copy(sunUv.uv);
      this.godray.u.uSunVisible.value = sunUv.visible * saturate(env.sunDir.y * 4 + 0.15);
      this.godray.u.uWeight.value = 1.2;
      this.godray.render(r, t.godray);
    }

    // ---------------------------------------------------- 7. composite
    const c = this.composite;
    setDepthU(c);
    c.u.tDiffuse.value = t.hdr.texture;
    c.u.tDepth.value = t.hdr.depthTexture;
    c.u.tAO.value = t.ao.texture;
    c.u.tSSR.value = t.ssr.texture;
    c.u.tGodray.value = t.godray.texture;
    c.u.uViewInv.value.copy(viewInv);
    c.u.uCamPos.value.setFromMatrixPosition(viewInv);
    c.u.uSunDir.value.copy(env.sunDir);
    c.u.uSunColor.value.copy(env.sunColor);
    c.u.uFogColor.value.copy(env.fogColor);
    c.u.uFogSunColor.value.copy(env.fogSunColor);
    c.u.uFogDensity.value = env.fogDensity;
    c.u.uFogHeight.value = env.fogHeight;
    c.u.uFogFalloff.value = env.fogFalloff;
    c.u.uFogMax.value = env.fogMax;
    c.u.uAOStrength.value = useAO ? 1 : 0;
    c.u.uSSRStrength.value = useSSR ? 1 : 0;
    c.u.uGodrayStrength.value = useGR ? env.godrayStrength : 0;
    c.u.uTime.value = time;
    c.u.uUnderwater.value = env.underwater || 0;
    c.render(r, t.composite);

    // ---------------------------------------------------- 8. AA / upscale
    const aa = settings.get('antialiasing');
    let sceneTex;
    if (aa === 'taa') {
      const src = this._taaPing ? t.taaA : t.taaB;
      const dst = this._taaPing ? t.taaB : t.taaA;
      const p = this.taa;
      setDepthU(p);
      p.u.tCurrent.value = t.composite.texture;
      p.u.tHistory.value = src.texture;
      p.u.tDepth.value = t.hdr.depthTexture;
      p.u.uTexelCur.value.set(1 / this.renW, 1 / this.renH);
      p.u.uTexelOut.value.set(1 / this.outW, 1 / this.outH);
      p.u.uPrevViewProj.value.copy(this._prevViewProj);
      p.u.uViewInv.value.copy(viewInv);
      p.u.uFirst.value = this._historyValid ? 0 : 1;
      p.render(r, dst);
      sceneTex = dst.texture;
      this._taaCurrent = dst;
      this._taaPing = !this._taaPing;
      this._historyValid = true;
    } else if (aa === 'fxaa') {
      this.blit.u.tDiffuse.value = t.composite.texture;
      this.blit.render(r, t.taaA);
      this.fxaa.u.tDiffuse.value = t.taaA.texture;
      this.fxaa.u.uTexel.value.set(1 / this.outW, 1 / this.outH);
      this.fxaa.render(r, t.taaB);
      sceneTex = t.taaB.texture;
      this._historyValid = false;
    } else {
      this.blit.u.tDiffuse.value = t.composite.texture;
      this.blit.render(r, t.taaA);
      sceneTex = t.taaA.texture;
      this._historyValid = false;
    }

    // ---------------------------------------------------- 9. bloom
    const doBloom = settings.get('bloom') && settings.get('bloomIntensity') > 0.001;
    const levels = this._activeBloom || 1;
    if (doBloom) {
      let src = sceneTex;
      let srcW = this.outW, srcH = this.outH;
      for (let i = 0; i < levels; i++) {
        const dst = t.bloom[i];
        this.bloomDown.u.tDiffuse.value = src;
        this.bloomDown.u.uTexel.value.set(1 / srcW, 1 / srcH);
        this.bloomDown.u.uFirstPass.value = i === 0 ? 1 : 0;
        this.bloomDown.u.uThreshold.value = env.bloomThreshold ?? 1.0;
        this.bloomDown.u.tExposure.value = this._expTex || t.exposureA.texture;
        this.bloomDown.u.uAutoExposure.value = settings.get('autoExposure') ? 1 : 0;
        this.bloomDown.u.uManualExposure.value = Math.pow(2, settings.get('exposure')) * settings.get('brightness');
        this.bloomDown.render(r, dst);
        src = dst.texture; srcW = dst.width; srcH = dst.height;
      }
      // Walk back up, adding each mip into the one above it.
      r.autoClear = false;
      for (let i = levels - 2; i >= 0; i--) {
        const small = t.bloom[i + 1], dst = t.bloom[i];
        this.bloomUp.u.tDiffuse.value = small.texture;
        this.bloomUp.u.uTexel.value.set(1 / small.width, 1 / small.height);
        this.bloomUp.u.uScale.value = 0.55;
        this.bloomUp.render(r, dst);
      }
      r.autoClear = true;
    }

    // ---------------------------------------------------- 10. auto exposure
    if (settings.get('autoExposure')) {
      // Meter the un-exposed scene, wide-tapped down to 32x32.
      this.bloomDown.u.tDiffuse.value = sceneTex;
      this.bloomDown.u.uTexel.value.set(5 / this.outW, 5 / this.outH);
      this.bloomDown.u.uFirstPass.value = 0;
      this.bloomDown.render(r, t.meter);

      const src = this._expPing ? t.exposureA : t.exposureB;
      const dst = this._expPing ? t.exposureB : t.exposureA;
      this.exposurePass.u.tScene.value = t.meter.texture;
      this.exposurePass.u.tPrev.value = src.texture;
      this.exposurePass.u.uDt.value = dt;
      this.exposurePass.u.uKey.value = env.exposureKey ?? 0.18;
      this.exposurePass.render(r, dst);
      this._expTex = dst.texture;
      this._expPing = !this._expPing;
    }

    // ---------------------------------------------------- 11. final grade
    const f = this.final;
    setDepthU(f);
    f.u.tDiffuse.value = sceneTex;
    f.u.tBloom.value = doBloom ? t.bloom[0].texture : t.bloom[0].texture;
    f.u.tDepth.value = t.hdr.depthTexture;
    f.u.tExposure.value = this._expTex || t.exposureA.texture;
    f.u.uRes.value.set(this.outW, this.outH);
    f.u.uTexel.value.set(1 / this.outW, 1 / this.outH);
    f.u.uTime.value = time;
    f.u.uBloom.value = doBloom ? settings.get('bloomIntensity') : 0;
    f.u.uSunUv.value.copy(sunUv.uv);
    f.u.uSunVisible.value = sunUv.visible;
    f.u.uSunColor.value.copy(env.sunColor);
    f.u.uPrevViewProj.value.copy(this._prevViewProj);
    f.u.uViewInv.value.copy(viewInv);
    f.u.uDofStrength.value = env.dofStrength ?? 0;
    f.u.uDofFocus.value = env.dofFocus ?? 12;
    f.u.uDofRange.value = env.dofRange ?? 40;
    f.u.uHurt.value = env.hurt ?? 0;
    f.render(r, null);

    this._prevViewProj.copy(this._viewProj);
    this.stats.drawCalls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
  }

  _sunScreenUv(sunDir, cam) {
    const v = (this._sunV ||= new THREE.Vector3());
    const uv = (this._sunUv ||= new THREE.Vector2());
    v.copy(sunDir).multiplyScalar(900).add(cam.position);
    v.project(cam);
    const inFront = v.z < 1;
    uv.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(uv.x - 0.5), Math.abs(uv.y - 0.5));
    const visible = inFront ? saturate(1.15 - off * 1.55) : 0;
    return { uv, visible };
  }

  dispose() {
    this._disposeTargets();
    for (const k of ['blit', 'ssao', 'blur', 'ssr', 'godray', 'composite', 'taa', 'fxaa', 'bloomDown', 'bloomUp', 'exposurePass', 'final']) {
      this[k]?.dispose();
    }
    this.noiseTex.dispose();
    this.dirtTex.dispose();
  }
}
