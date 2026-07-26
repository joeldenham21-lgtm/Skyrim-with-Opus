/**
 * WYRMHOLD — sky, atmosphere and image-based lighting.
 *
 * A single full-screen shader evaluates: Rayleigh + Mie single scattering
 * through a spherical atmosphere, a raymarched volumetric cloud slab with
 * Beer–Powder lighting, a star field with a Milky Way band, two moons
 * (Masser and Secunda) with phase and craters, and an aurora curtain.
 *
 * The same shader is rendered into a small cubemap and run through PMREM, so
 * the world's ambient light always matches the sky you can actually see.
 */

import * as THREE from 'three';
import { GLSL_NOISE } from './textures.js';
import { clamp, saturate, lerp, TAU } from '../core/math.js';

const SKY_FRAG = /* glsl */`
precision highp float;

uniform mat4  uProjInv;
uniform mat3  uCamRot;
uniform vec3  uSunDir;
uniform vec3  uMoonDir;
uniform vec3  uMoon2Dir;
uniform float uTime;
uniform float uSunIntensity;
uniform float uTurbidity;
uniform float uCloudCover;      // 0..1
uniform float uCloudDensity;
uniform float uCloudHeight;
uniform float uCloudSpeed;
uniform vec2  uWind;
uniform float uStarStrength;
uniform float uAuroraStrength;
uniform float uMoonPhase;
uniform float uMoon2Phase;
uniform float uFogAmount;
uniform vec3  uFogColor;
uniform float uExposure;
uniform int   uCloudSteps;
uniform int   uLightSteps;
uniform int   uAtmoSteps;
uniform float uRainAmount;
uniform float uHorizonHaze;

varying vec2 vUv;

const float PI = 3.141592653589793;
const float RE = 6371000.0;      // planet radius
const float RA = 6471000.0;      // atmosphere radius
const vec3  BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float BETA_M = 21e-6;
const float HR = 8000.0;
const float HM = 1200.0;

// --- 3D value noise built from the shared 2D toolbox -------------------------
float hash13(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * noise3(p); n += a; a *= 0.5; p *= 2.02;
  }
  return s / max(n, 1e-5);
}

// --- helpers ----------------------------------------------------------------
vec2 raySphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e20, -1e20);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
float phaseR(float mu){ return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseM(float mu, float g){
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) /
         ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}
float hg(float mu, float g){
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

// --- atmosphere -------------------------------------------------------------
vec3 atmosphere(vec3 dir, vec3 sunDir){
  vec3 ro = vec3(0.0, RE + 500.0, 0.0);
  vec2 t = raySphere(ro, dir, RA);
  if (t.y < 0.0) return vec3(0.0);
  float tMax = t.y;
  vec2 tg = raySphere(ro, dir, RE);
  if (tg.x > 0.0) tMax = min(tMax, tg.x);

  int steps = uAtmoSteps;
  float segment = tMax / float(steps);
  float tCur = 0.0;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float mu = dot(dir, sunDir);
  float pr = phaseR(mu);
  float pm = phaseM(mu, 0.76);
  float mieBoost = 1.0 + uTurbidity * 2.0;

  for (int i = 0; i < 24; i++){
    if (i >= steps) break;
    vec3 p = ro + dir * (tCur + segment * 0.5);
    float h = length(p) - RE;
    float hr = exp(-h / HR) * segment;
    float hm = exp(-h / HM) * segment * mieBoost;
    odR += hr; odM += hm;

    vec2 tl = raySphere(p, sunDir, RA);
    float lSeg = tl.y / float(uLightSteps);
    float lt = 0.0, odRL = 0.0, odML = 0.0;
    bool shadowed = false;
    for (int j = 0; j < 8; j++){
      if (j >= uLightSteps) break;
      vec3 lp = p + sunDir * (lt + lSeg * 0.5);
      float lh = length(lp) - RE;
      if (lh < 0.0){ shadowed = true; break; }
      odRL += exp(-lh / HR) * lSeg;
      odML += exp(-lh / HM) * lSeg * mieBoost;
      lt += lSeg;
    }
    if (!shadowed){
      vec3 tau = BETA_R * (odR + odRL) + vec3(BETA_M * 1.1) * (odM + odML);
      vec3 att = exp(-tau);
      sumR += att * hr;
      sumM += att * hm;
    }
    tCur += segment;
  }
  return uSunIntensity * (sumR * BETA_R * pr + sumM * BETA_M * pm);
}

// --- stars ------------------------------------------------------------------
vec3 starField(vec3 dir){
  vec3 c = vec3(0.0);
  // three density layers so bright stars stay sparse
  for (int k = 0; k < 3; k++){
    float scale = 220.0 + float(k) * 340.0;
    vec3 p = dir * scale;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float r = hash13(id + float(k) * 13.0);
    if (r > 0.9955 - float(k) * 0.0012){
      vec3 off = vec3(hash13(id + 1.7), hash13(id + 3.3), hash13(id + 5.9)) - 0.5;
      float d = length(f - off * 0.6);
      float bright = pow(fract(r * 91.7), 3.0);
      float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + bright * 6.0) + r * 100.0);
      float s = (1.0 - smoothstep(0.0, 0.055, d)) * bright * twinkle;
      vec3 tint = mix(vec3(0.72, 0.80, 1.0), vec3(1.0, 0.86, 0.68), fract(r * 37.3));
      c += s * tint * (2.2 - float(k) * 0.5);
    }
  }
  // Milky Way band
  float band = 1.0 - abs(dot(normalize(dir), normalize(vec3(0.42, 0.30, -0.86))));
  float mw = smoothstep(0.72, 1.0, band);
  float mwn = fbm3(dir * 9.0 + 3.0, 4);
  c += mw * mw * mwn * vec3(0.10, 0.11, 0.17) * 0.9;
  return c;
}

// --- moons ------------------------------------------------------------------
vec3 moonDisc(vec3 dir, vec3 mdir, float radius, float phase, vec3 tint, float craters){
  float d = dot(dir, mdir);
  float ang = acos(clamp(d, -1.0, 1.0));
  if (ang > radius * 3.0) return vec3(0.0);
  vec3 c = vec3(0.0);
  if (ang < radius){
    // local frame on the moon disc
    vec3 up = abs(mdir.y) > 0.95 ? vec3(1,0,0) : vec3(0,1,0);
    vec3 tx = normalize(cross(up, mdir));
    vec3 ty = cross(mdir, tx);
    vec2 uvd = vec2(dot(dir, tx), dot(dir, ty)) / radius;
    float r2 = dot(uvd, uvd);
    float z = sqrt(max(0.0, 1.0 - r2));
    vec3 n = normalize(tx * uvd.x + ty * uvd.y + mdir * z);
    // craters + maria
    float m = fbm3(n * 5.0 + 11.0, 4);
    float cr = 1.0 - smoothstep(0.0, 0.35, abs(fbm3(n * 14.0, 3) - 0.5)) * craters;
    float shade = mix(0.65, 1.0, m) * mix(0.75, 1.0, cr);
    // phase terminator
    float term = dot(n, normalize(vec3(cos(phase * 6.2831853), 0.35, sin(phase * 6.2831853))));
    float lightMask = smoothstep(-0.12, 0.18, term);
    c += tint * shade * (0.06 + lightMask) * (1.0 - smoothstep(radius * 0.86, radius, ang));
  }
  // soft halo
  c += tint * 0.055 * exp(-ang / (radius * 1.1)) * (0.4 + 0.6 * smoothstep(0.0, 1.0, phase));
  return c;
}

// --- clouds -----------------------------------------------------------------
float cloudShape(vec3 p){
  vec3 q = p * 0.00042;
  q.xz += uWind * uTime * uCloudSpeed * 0.00004;
  float base = fbm3(q, 4);
  // billow detail
  float det = fbm3(q * 5.3 + vec3(0.0, uTime * 0.006, 0.0), 3);
  float shape = base - (1.0 - uCloudCover) * 0.72;
  shape = max(0.0, shape);
  shape *= smoothstep(0.0, 0.28, shape);
  shape -= det * 0.18 * (1.0 - uCloudCover * 0.5);
  return max(0.0, shape) * uCloudDensity;
}

vec4 clouds(vec3 ro, vec3 rd, vec3 sunDir, vec3 sunCol, vec3 skyCol){
  if (uCloudSteps <= 0 || rd.y < -0.06) return vec4(0.0);
  float base = uCloudHeight;
  float top  = uCloudHeight + 1400.0 + 900.0 * uCloudDensity;
  float t0 = (base - ro.y) / max(rd.y, 0.001);
  float t1 = (top  - ro.y) / max(rd.y, 0.001);
  if (t1 < 0.0) return vec4(0.0);
  t0 = max(t0, 0.0);
  float span = min(t1 - t0, 46000.0);
  if (span <= 0.0) return vec4(0.0);

  int steps = uCloudSteps;
  float dt = span / float(steps);
  float mu = dot(rd, sunDir);
  float ph = mix(hg(mu, 0.76), hg(mu, -0.28), 0.4) * 4.0;

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  float t = t0 + dt * fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);

  for (int i = 0; i < 64; i++){
    if (i >= steps || trans < 0.01) break;
    vec3 p = ro + rd * t;
    float hRel = clamp((p.y - base) / (top - base), 0.0, 1.0);
    // vertical profile: flat bottom, rounded top
    float prof = smoothstep(0.0, 0.12, hRel) * (1.0 - smoothstep(0.55, 1.0, hRel));
    float d = cloudShape(p) * prof;
    if (d > 0.001){
      // light march toward the sun
      float ld = 0.0;
      float ls = 220.0;
      for (int j = 0; j < 6; j++){
        if (j >= uLightSteps) break;
        vec3 lp = p + sunDir * (ls * float(j) + ls * 0.5);
        float lhRel = clamp((lp.y - base) / (top - base), 0.0, 1.0);
        float lprof = smoothstep(0.0, 0.12, lhRel) * (1.0 - smoothstep(0.55, 1.0, lhRel));
        ld += cloudShape(lp) * lprof * ls;
      }
      float beer = exp(-ld * 0.55);
      float powder = 1.0 - exp(-d * dt * 2.2);
      vec3 lum = sunCol * ph * beer * (0.35 + 0.65 * powder) * 3.2
               + skyCol * (0.35 + 0.65 * hRel) * 1.5;
      // rain clouds go dark and heavy
      lum *= mix(1.0, 0.34, uRainAmount);
      float dens = d * dt * 0.6;
      float a = 1.0 - exp(-dens);
      acc += lum * a * trans;
      trans *= 1.0 - a;
    }
    t += dt;
  }
  float fade = smoothstep(-0.06, 0.09, rd.y);
  return vec4(acc, (1.0 - trans)) * fade;
}

// --- aurora -----------------------------------------------------------------
vec3 aurora(vec3 rd){
  if (uAuroraStrength <= 0.001 || rd.y < 0.02) return vec3(0.0);
  vec3 col = vec3(0.0);
  float t = uTime * 0.05;
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    float h = 0.18 + fi * 0.13;
    float tt = (h - 0.0) / max(rd.y, 0.02);
    vec2 p = rd.xz * tt * 2.4;
    float n = fbm3(vec3(p * 0.55 + vec2(t * (1.0 + fi * 0.3), t * 0.35), fi * 3.1), 4);
    float curtain = smoothstep(0.52, 0.78, n);
    float vert = exp(-abs(rd.y - (0.16 + fi * 0.1)) * 7.0);
    vec3 tint = mix(vec3(0.16, 1.0, 0.52), vec3(0.42, 0.32, 1.0), fi * 0.3 + n * 0.35);
    col += curtain * vert * tint * (0.5 - fi * 0.08);
  }
  return col * uAuroraStrength * smoothstep(0.0, 0.25, rd.y);
}

// ----------------------------------------------------------------------------
void main(){
  vec4 clip = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 vpos = uProjInv * clip;
  vec3 rd = normalize(uCamRot * (vpos.xyz / vpos.w));

  vec3 sunDir = uSunDir;
  float sunUp = sunDir.y;

  vec3 sky = atmosphere(rd, sunDir);

  // night sky: stars fade in as the sun sets
  float night = 1.0 - smoothstep(-0.10, 0.06, sunUp);
  if (night > 0.001){
    vec3 stars = starField(rd) * uStarStrength * night;
    stars *= smoothstep(-0.04, 0.10, rd.y);
    sky += stars;
    sky += aurora(rd) * night;
    // moonlit air glow
    float mmu = max(0.0, dot(rd, uMoonDir));
    sky += vec3(0.020, 0.028, 0.052) * night * (0.5 + 0.9 * pow(mmu, 3.0));
  }

  // sun disc with limb darkening
  float sunAng = acos(clamp(dot(rd, sunDir), -1.0, 1.0));
  float sunR = 0.0092;
  if (sunAng < sunR * 6.0){
    float core = 1.0 - smoothstep(sunR * 0.82, sunR, sunAng);
    float limb = 1.0 - 0.45 * pow(clamp(sunAng / sunR, 0.0, 1.0), 2.0);
    vec3 sunTint = mix(vec3(1.0, 0.44, 0.16), vec3(1.0, 0.96, 0.90), smoothstep(-0.02, 0.22, sunUp));
    sky += core * limb * sunTint * uSunIntensity * 26.0;
    sky += exp(-sunAng * 90.0) * sunTint * uSunIntensity * 1.6;
  }

  if (night > 0.001){
    sky += moonDisc(rd, uMoonDir,  0.036, uMoonPhase,  vec3(0.95, 0.90, 0.82), 1.0) * night * 2.2;
    sky += moonDisc(rd, uMoon2Dir, 0.017, uMoon2Phase, vec3(0.86, 0.92, 1.0), 0.7) * night * 1.4;
  }

  // Clouds are the most expensive term, so everything they need — including a
  // second atmosphere evaluation for the up-facing sky colour — is skipped
  // entirely when the cloud layer is disabled.
  if (uCloudSteps > 0){
    vec3 skyAvg = atmosphere(normalize(vec3(rd.x, max(rd.y, 0.22), rd.z)), sunDir);
    vec3 sunCol = mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.94, 0.86), smoothstep(-0.05, 0.30, sunUp))
                  * uSunIntensity * max(0.02, smoothstep(-0.14, 0.12, sunUp));
    vec4 cl = clouds(vec3(0.0, 1000.0, 0.0), rd, sunDir, sunCol, skyAvg);
    sky = mix(sky, cl.rgb, clamp(cl.a, 0.0, 1.0));
  }

  // horizon haze / fog blend so the sky meets the terrain fog cleanly
  float horizon = 1.0 - smoothstep(0.0, 0.22, abs(rd.y));
  vec3 haze = uFogColor * uHorizonHaze;
  sky = mix(sky, haze, horizon * uFogAmount * 0.5 * smoothstep(-0.25, 0.05, rd.y));

  // Below the horizon the scattering integral is bright pale haze. Wherever the
  // terrain runs out — past the view distance, seen from a hilltop — that haze
  // reads as a flat white plain stretching to the edge of the world. Fade it
  // into the fog colour so distant land simply dissolves into aerial
  // perspective instead.
  float below = smoothstep(0.0, -0.055, rd.y);
  sky = mix(sky, uFogColor * 0.62, below);

  gl_FragColor = vec4(max(sky, vec3(0.0)) * uExposure, 1.0);
}
`;

const SKY_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const SKY_SCALE = 0.32;

const CLOUD_STEPS = { off: 0, low: 12, medium: 20, high: 34, ultra: 56 };
const ATMO_STEPS = { off: 6, low: 6, medium: 10, high: 14, ultra: 20 };
const LIGHT_STEPS = { off: 2, low: 2, medium: 3, high: 4, ultra: 6 };

export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      depthTest: false, depthWrite: false,
      uniforms: {
        uProjInv: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.4).normalize() },
        uMoonDir: { value: new THREE.Vector3(-0.3, 0.5, -0.4).normalize() },
        uMoon2Dir: { value: new THREE.Vector3(0.5, 0.4, -0.7).normalize() },
        uTime: { value: 0 },
        uSunIntensity: { value: 22 },
        uTurbidity: { value: 0.35 },
        uCloudCover: { value: 0.45 },
        uCloudDensity: { value: 1.0 },
        uCloudHeight: { value: 2200 },
        uCloudSpeed: { value: 1.0 },
        uWind: { value: new THREE.Vector2(1, 0.35) },
        uStarStrength: { value: 1.0 },
        uAuroraStrength: { value: 0.0 },
        uMoonPhase: { value: 0.35 },
        uMoon2Phase: { value: 0.7 },
        uFogAmount: { value: 0.4 },
        uFogColor: { value: new THREE.Color(0.55, 0.62, 0.72) },
        // Absolute scale of the whole lighting rig. The raw scattering
        // integral lands around 10x too bright, which drowns the sun in sky
        // ambient and makes every downstream threshold (bloom, exposure)
        // meaningless. Everything — sky, IBL, fog — is scaled together, so
        // only the absolute level changes, never the look.
        uExposure: { value: SKY_SCALE },
        uCloudSteps: { value: 34 },
        uLightSteps: { value: 4 },
        uAtmoSteps: { value: 14 },
        uRainAmount: { value: 0 },
        uHorizonHaze: { value: 1.0 },
      },
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // --- IBL --------------------------------------------------------------
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.envSize = 64;
    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.envSize, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this._envTarget = null;
    this._envAge = 1e9;
    this._envCam = new THREE.PerspectiveCamera(90, 1, 0.1, 10);

    // Colours derived on the CPU for the directional/ambient lights.
    this.sunColor = new THREE.Color(1, 1, 1);
    this.sunIrradiance = 1;
    this.ambientColor = new THREE.Color(0.2, 0.25, 0.35);
    this.fogColor = new THREE.Color(0.55, 0.62, 0.72);
  }

  setQuality(cloudQuality) {
    const u = this.material.uniforms;
    u.uCloudSteps.value = CLOUD_STEPS[cloudQuality] ?? 20;
    u.uAtmoSteps.value = ATMO_STEPS[cloudQuality] ?? 10;
    u.uLightSteps.value = LIGHT_STEPS[cloudQuality] ?? 3;
  }

  /**
   * @param {object} env  { sunDir, moonDir, moon2Dir, time, cloudCover, ... }
   */
  update(env, camera) {
    const u = this.material.uniforms;
    u.uSunDir.value.copy(env.sunDir);
    u.uMoonDir.value.copy(env.moonDir);
    u.uMoon2Dir.value.copy(env.moon2Dir);
    u.uTime.value = env.time;
    u.uCloudCover.value = env.cloudCover;
    u.uCloudDensity.value = env.cloudDensity;
    u.uCloudHeight.value = env.cloudHeight;
    u.uTurbidity.value = env.turbidity;
    u.uWind.value.set(env.windX, env.windZ);
    u.uAuroraStrength.value = env.aurora;
    u.uStarStrength.value = env.stars;
    u.uMoonPhase.value = env.moonPhase;
    u.uMoon2Phase.value = env.moon2Phase;
    u.uFogAmount.value = env.fogAmount;
    u.uFogColor.value.copy(env.fogColor);
    u.uRainAmount.value = env.rain;
    u.uSunIntensity.value = env.sunIntensity;
    u.uHorizonHaze.value = env.horizonHaze ?? 1;

    if (camera) {
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    }

    this._computeLightColors(env);
  }

  /** Cheap CPU approximation of the same scattering, for the scene lights. */
  _computeLightColors(env) {
    const h = clamp(env.sunDir.y, -1, 1);
    // Optical depth grows sharply near the horizon.
    const airMass = 1 / Math.max(0.045, h + 0.15);
    const t = env.turbidity;
    const bR = [5.8, 13.5, 33.1];
    const r = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const tauR = bR[i] * 0.045 * airMass;
      const tauM = 2.1 * (0.12 + t * 0.5) * airMass * 0.06;
      r[i] = Math.exp(-(tauR + tauM));
    }
    const daylight = saturate((h + 0.09) / 0.25);
    const cloudDim = 1 - env.cloudCover * 0.62 - env.rain * 0.22;
    this.sunIrradiance = env.sunIntensity * SKY_SCALE * daylight * Math.max(0.15, cloudDim);
    const warm = 1 - saturate((h - 0.02) / 0.3);
    this.sunColor.setRGB(
      r[0],
      r[1] * (1 - warm * 0.22),
      r[2] * (1 - warm * 0.52)
    );
    const mx = Math.max(this.sunColor.r, this.sunColor.g, this.sunColor.b, 1e-4);
    this.sunColor.multiplyScalar(1 / mx);

    // Ambient: blue-shifted sky dome, dropping to moonlight at night.
    const night = saturate((-h + 0.02) / 0.16);
    const dayAmb = 0.9 * daylight * (0.45 + env.cloudCover * 0.55);
    this.ambientColor.setRGB(
      dayAmb * 0.36 + night * 0.020,
      dayAmb * 0.46 + night * 0.028,
      dayAmb * 0.70 + night * 0.052
    );
    // Sunset bleeds warmth into the ambient term.
    const dusk = saturate(1 - Math.abs(h - 0.02) / 0.16) * daylight;
    this.ambientColor.r += dusk * 0.16;
    this.ambientColor.g += dusk * 0.06;

    // Fog inherits the horizon colour so distant terrain melts into the sky.
    // The magnitude matters as much as the hue: this value is mixed into a
    // linear HDR buffer before tone mapping, so it is scaled to sit near the
    // brightness of a sunlit surface rather than in display range.
    // The level must track the *sun*, not just "is it day": at dusk the ground
    // loses its key light entirely, and a fog colour that stays at noon
    // brightness turns every distant hill into a flat salmon cut-out.
    const fogDay = saturate((h + 0.09) / 0.26);
    const level = (0.030 + fogDay * 0.62) * SKY_SCALE * 7.0;
    // Warming only the red channel over a blue base gives magenta, not sunset.
    // Interpolate the whole hue instead: cool blue by day, orange at dusk.
    const dayR = 0.36, dayG = 0.44, dayB = 0.58;
    const duskR = 0.62, duskG = 0.40, duskB = 0.30;
    this.fogColor.setRGB(
      lerp(dayR, duskR, warm) * level,
      lerp(dayG, duskG, warm) * level,
      lerp(dayB, duskB, warm) * level
    );
    const heavy = saturate(env.cloudCover * 0.6 + env.rain * 0.6 + env.fogAmount * 0.4);
    this.fogColor.lerp(new THREE.Color(0.50 * level, 0.53 * level, 0.58 * level), heavy * 0.7);
  }

  /** Draws the sky into whatever target is currently bound. */
  render(renderer, target) {
    const prev = renderer.getRenderTarget();
    if (target !== undefined) renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    if (target !== undefined) renderer.setRenderTarget(prev);
  }

  /**
   * Re-bakes the environment cubemap + PMREM. Costs ~1-3ms so it is called at
   * most a few times per second, and only when the sky has actually changed.
   */
  updateEnvironment(scene, force = false) {
    this._envAge++;
    if (!force && this._envAge < 20) return;
    this._envAge = 0;

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const u = this.material.uniforms;

    // Temporarily drop cloud cost for the tiny cube faces.
    const savedSteps = u.uCloudSteps.value, savedAtmo = u.uAtmoSteps.value, savedLight = u.uLightSteps.value;
    u.uCloudSteps.value = Math.min(savedSteps, 8);
    u.uAtmoSteps.value = Math.min(savedAtmo, 6);
    u.uLightSteps.value = 2;

    const savedProj = u.uProjInv.value.clone();
    const savedRot = u.uCamRot.value.clone();

    const cam = this._envCam;
    cam.fov = 90; cam.aspect = 1; cam.near = 0.1; cam.far = 10;
    cam.updateProjectionMatrix();

    const dirs = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
    ];
    const ups = [
      [0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, -1, 0]
    ];
    u.uProjInv.value.copy(cam.projectionMatrixInverse);

    for (let i = 0; i < 6; i++) {
      cam.position.set(0, 0, 0);
      cam.up.set(ups[i][0], ups[i][1], ups[i][2]);
      cam.lookAt(dirs[i][0], dirs[i][1], dirs[i][2]);
      cam.updateMatrixWorld(true);
      u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
      renderer.setRenderTarget(this.cubeRT, i);
      renderer.render(this.scene, this.camera);
    }

    u.uCloudSteps.value = savedSteps;
    u.uAtmoSteps.value = savedAtmo;
    u.uLightSteps.value = savedLight;
    u.uProjInv.value.copy(savedProj);
    u.uCamRot.value.copy(savedRot);
    renderer.setRenderTarget(prevTarget);

    const old = this._envTarget;
    this._envTarget = this.pmrem.fromCubemap(this.cubeRT.texture);
    scene.environment = this._envTarget.texture;
    if (old) old.dispose();
  }

  dispose() {
    this.material.dispose();
    this.quad.geometry.dispose();
    this.cubeRT.dispose();
    this._envTarget?.dispose();
    this.pmrem.dispose();
  }
}
