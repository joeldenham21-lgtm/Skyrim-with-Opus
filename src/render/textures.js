/**
 * WYRMHOLD — procedural PBR texture bakery.
 *
 * The game ships zero image files. Every material is written as a small GLSL
 * "surface recipe" and baked on the GPU at boot into a seamless albedo /
 * ORM (occlusion-roughness-metalness) / normal set. Because the recipes are
 * analytic we can re-bake at any resolution when the player changes the
 * texture-quality setting, and every texture tiles perfectly.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared GLSL: periodic (therefore seamless) noise toolbox
// ---------------------------------------------------------------------------

export const GLSL_NOISE = /* glsl */`
// All noise below is *periodic*: it repeats exactly every 1.0 in uv, so every
// baked texture tiles seamlessly. Frequencies are vec2 so a recipe can stretch
// a pattern along one axis (wood grain, strata) without breaking the tiling.
// Rule for recipes: never pre-scale the uv you hand to a noise function —
// raise the frequency instead. Integer offsets are fine.

float vhash(vec2 i, vec2 period){
  i = mod(i, max(period, vec2(1.0)));
  return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 vhash2(vec2 i, vec2 period){
  i = mod(i, max(period, vec2(1.0)));
  return fract(sin(vec2(dot(i, vec2(127.1,311.7)), dot(i, vec2(269.5,183.3)))) * 43758.5453123);
}
vec2 ghash(vec2 i, vec2 period){
  vec2 h = vhash2(i, period) * 2.0 - 1.0;
  return normalize(h + vec2(1e-5, 2e-5));
}
float vnoise(vec2 uv, vec2 period){
  vec2 p = uv * period;
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = vhash(i, period), b = vhash(i + vec2(1,0), period);
  float c = vhash(i + vec2(0,1), period), d = vhash(i + vec2(1,1), period);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float gnoise(vec2 uv, vec2 period){
  vec2 p = uv * period;
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float a = dot(ghash(i, period), f);
  float b = dot(ghash(i+vec2(1,0), period), f-vec2(1,0));
  float c = dot(ghash(i+vec2(0,1), period), f-vec2(0,1));
  float d = dot(ghash(i+vec2(1,1), period), f-vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y) * 0.72 + 0.5;
}
float vnoise(vec2 uv, float period){ return vnoise(uv, vec2(period)); }
float gnoise(vec2 uv, float period){ return gnoise(uv, vec2(period)); }

float fbm(vec2 uv, vec2 baseF, int oct, float gain){
  float a = 0.5, s = 0.0, n = 0.0;
  vec2 f = baseF;
  for (int i = 0; i < 10; i++){
    if (i >= oct) break;
    s += a * gnoise(uv, f);
    n += a; a *= gain; f *= 2.0;
  }
  return s / max(n, 1e-5);
}
float fbmV(vec2 uv, vec2 baseF, int oct, float gain){
  float a = 0.5, s = 0.0, n = 0.0;
  vec2 f = baseF;
  for (int i = 0; i < 10; i++){
    if (i >= oct) break;
    s += a * vnoise(uv, f);
    n += a; a *= gain; f *= 2.0;
  }
  return s / max(n, 1e-5);
}
/* ridged fbm — crests and creases */
float rfbm(vec2 uv, vec2 baseF, int oct, float gain){
  float a = 0.5, s = 0.0, n = 0.0, prev = 1.0;
  vec2 f = baseF;
  for (int i = 0; i < 10; i++){
    if (i >= oct) break;
    float v = 1.0 - abs(gnoise(uv, f) * 2.0 - 1.0);
    v *= v; v *= prev; prev = v;
    s += a * v; n += a; a *= gain; f *= 2.0;
  }
  return s / max(n, 1e-5);
}
float fbm(vec2 uv, float f, int oct, float g){ return fbm(uv, vec2(f), oct, g); }
float fbmV(vec2 uv, float f, int oct, float g){ return fbmV(uv, vec2(f), oct, g); }
float rfbm(vec2 uv, float f, int oct, float g){ return rfbm(uv, vec2(f), oct, g); }

/* worley F1 distance, tiles */
float worley(vec2 uv, vec2 period){
  vec2 p = uv * period;
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = vhash2(i + g, period);
    d = min(d, length(g + o - f));
  }
  return clamp(d, 0.0, 1.0);
}
/* .x = F1, .y = F2-F1 (edge mask), .z = per-cell random id */
vec3 worleyCell(vec2 uv, vec2 period){
  vec2 p = uv * period;
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = vhash2(i + g, period);
    float d = length(g + o - f);
    if (d < d1){ d2 = d1; d1 = d; id = i + g; }
    else if (d < d2) d2 = d;
  }
  return vec3(clamp(d1, 0.0, 1.0), d2 - d1, vhash(id, period));
}
float worley(vec2 uv, float p){ return worley(uv, vec2(p)); }
vec3 worleyCell(vec2 uv, float p){ return worleyCell(uv, vec2(p)); }

vec2 warp(vec2 uv, vec2 f, float amt){
  return uv + amt * vec2(gnoise(uv, f) - 0.5, gnoise(uv + 5.0, f) - 0.5);
}
vec2 warp(vec2 uv, float f, float amt){ return warp(uv, vec2(f), amt); }
/* smoothstep that also accepts reversed edges (a > b inverts the ramp).
   GLSL leaves edge0 >= edge1 undefined, and recipes read better when they can
   write sstep(0.2, 0.05, d) for "fade in as d gets small". */
float sstep(float a, float b, float x){
  return a < b ? smoothstep(a, b, x) : 1.0 - smoothstep(b, a, x);
}
vec3 hsvShift(vec3 c, float h, float s, float v){
  const vec3 k = vec3(0.57735);
  float ca = cos(h * 6.2831853);
  vec3 r = c * ca + cross(k, c) * sin(h * 6.2831853) + k * dot(k, c) * (1.0 - ca);
  float l = dot(r, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3(l), r, s) * v, 0.0, 1.0);
}
`;

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const MAIN = /* glsl */`
uniform int uOut;      // 0 albedo (+cutout alpha), 1 orm, 2 normal
uniform float uSize;
uniform float uBump;
varying vec2 vUv;

#ifndef HAS_CUTOUT
float cut(vec2 uv){ return 1.0; }
#endif

void main(){
  vec3 alb; float rough, metal, ao, h;
  if (uOut == 2){
    float e = 1.0 / uSize;
    float hc, hx, hy;
    surf(vUv,                 alb, rough, metal, ao, hc);
    surf(vUv + vec2(e, 0.0),  alb, rough, metal, ao, hx);
    surf(vUv + vec2(0.0, e),  alb, rough, metal, ao, hy);
    float s = uBump * uSize * 0.012;
    vec3 n = normalize(vec3(-(hx - hc) * s, -(hy - hc) * s, 1.0));
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  } else {
    surf(vUv, alb, rough, metal, ao, h);
    if (uOut == 0) gl_FragColor = vec4(alb, cut(vUv));
    else gl_FragColor = vec4(ao, rough, metal, 1.0);
  }
}
`;

// ---------------------------------------------------------------------------
// Surface recipes
// ---------------------------------------------------------------------------
// Signature: void surf(vec2 uv, out vec3 alb, out float rough, out float metal,
//                      out float ao, out float h)
// `h` is a height field in roughly [0,1] used to derive the normal map.

export const RECIPES = {

  // ---------------------------------------------------------- terrain (hero)
  grass: {
    tier: 'hero', bump: 0.9, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      vec2 w = warp(uv, 5.0, 0.06);
      float clump = fbm(w, 4.0, 4, 0.55);
      float blade = fbmV(uv, vec2(96.0, 96.0), 3, 0.5);
      float fine  = gnoise(uv, 224.0);
      float dry   = sstep(0.52, 0.86, fbm(uv + 13.0, 3.0, 3, 0.5));
      float dirt  = sstep(0.62, 0.85, fbm(uv + 4.0, 10.0, 4, 0.5));
      vec3 deep   = vec3(0.038, 0.076, 0.030);
      vec3 mid    = vec3(0.078, 0.140, 0.050);
      vec3 pale   = vec3(0.132, 0.176, 0.070);
      vec3 straw  = vec3(0.190, 0.166, 0.082);
      vec3 soil   = vec3(0.086, 0.068, 0.048);
      alb = mix(deep, mid, sstep(0.3, 0.72, clump));
      alb = mix(alb, pale, sstep(0.55, 0.95, clump + blade * 0.35) * 0.8);
      alb = mix(alb, straw, dry * 0.34);
      alb = mix(alb, soil, dirt * 0.7);
      alb *= 0.86 + 0.28 * blade;
      alb *= 0.94 + 0.12 * fine;
      vec3 cw = worleyCell(uv, 44.0);
      float peb = sstep(0.14, 0.03, cw.x) * step(0.86, cw.z);
      alb = mix(alb, vec3(0.30, 0.29, 0.27) * (0.6 + 0.5 * cw.z), peb * 0.85);
      rough = mix(0.94, 0.72, blade * 0.6) - peb * 0.18;
      metal = 0.0;
      ao = mix(0.62, 1.0, sstep(0.15, 0.8, clump * 0.6 + blade * 0.6));
      h = blade * 0.55 + clump * 0.4 + peb * 0.5 + fine * 0.08;
    }`
  },

  rock: {
    tier: 'hero', bump: 1.35, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      vec2 w = warp(uv, 3.0, 0.12);
      float body   = fbm(w, 4.0, 6, 0.52);
      vec3  cell   = worleyCell(w, 7.0);
      float crack  = 1.0 - sstep(0.0, 0.055, cell.y);
      float crack2 = 1.0 - sstep(0.0, 0.03, worleyCell(w + 3.0, 21.0).y);
      float grain  = fbmV(uv, 150.0, 3, 0.5);
      float mica   = step(0.972, vnoise(uv, 420.0));
      float lichen = sstep(0.58, 0.86, fbm(uv + 21.0, 7.0, 4, 0.55));
      vec3 base = mix(vec3(0.128, 0.128, 0.134), vec3(0.235, 0.226, 0.212), body);
      base = mix(base, vec3(0.086, 0.082, 0.086), cell.z * 0.45);
      base *= 0.88 + 0.24 * grain;
      base = mix(base, vec3(0.042, 0.042, 0.048), crack * 0.85);
      base = mix(base, vec3(0.052, 0.048, 0.05), crack2 * 0.4);
      base = mix(base, vec3(0.176, 0.204, 0.132), lichen * 0.55);
      base += mica * 0.28;
      alb = base;
      rough = clamp(mix(0.88, 0.64, grain) + crack * 0.08 - mica * 0.4, 0.18, 0.98);
      metal = 0.0;
      ao = mix(1.0, 0.42, crack * 0.9) * mix(1.0, 0.78, 1.0 - body);
      h = body * 0.7 + grain * 0.14 - crack * 0.55 - crack2 * 0.22 + cell.x * 0.2;
    }`
  },

  cliff: {
    tier: 'hero', bump: 1.7, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      // sedimentary strata running horizontally, broken by vertical fractures
      float strataN = fbm(uv, vec2(4.0, 12.0), 4, 0.5);
      float strata  = fract(uv.y * 11.0 + strataN * 1.6);
      float band    = sstep(0.0, 0.12, strata) * (1.0 - sstep(0.86, 1.0, strata));
      float ledge   = sstep(0.46, 0.5, strata);
      vec3  cell    = worleyCell(warp(uv, 2.0, 0.1), vec2(6.0, 3.0));
      float frac    = 1.0 - sstep(0.0, 0.05, cell.y);
      float grain   = fbmV(uv, 170.0, 3, 0.5);
      float weath   = sstep(0.55, 0.9, fbm(uv + 9.0, 3.0, 3, 0.5));
      vec3 c1 = vec3(0.118, 0.113, 0.108);
      vec3 c2 = vec3(0.198, 0.184, 0.166);
      vec3 c3 = vec3(0.076, 0.072, 0.074);
      alb = mix(c1, c2, band);
      alb = mix(alb, c3, ledge * 0.45 + frac * 0.7);
      alb = mix(alb, vec3(0.156, 0.176, 0.126), weath * 0.22);
      alb *= 0.85 + 0.3 * grain;
      rough = clamp(mix(0.92, 0.7, grain) + frac * 0.06, 0.3, 0.99);
      metal = 0.0;
      ao = mix(1.0, 0.4, frac) * mix(0.8, 1.0, band);
      h = band * 0.45 + cell.x * 0.35 + grain * 0.16 - frac * 0.7 - ledge * 0.18;
    }`
  },

  snow: {
    tier: 'hero', bump: 0.55, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float dunes = fbm(warp(uv, 2.0, 0.08), 3.0, 5, 0.55);
      float wind  = fbm(uv, vec2(24.0, 5.0), 4, 0.5);
      float gran  = fbmV(uv, 260.0, 3, 0.5);
      float spark = sstep(0.988, 0.999, vnoise(uv, 260.0));
      float crust = sstep(0.55, 0.78, dunes + wind * 0.3);
      vec3 white = vec3(0.86, 0.90, 0.96);
      vec3 blue  = vec3(0.62, 0.72, 0.88);
      alb = mix(blue, white, sstep(0.2, 0.85, dunes * 0.6 + wind * 0.5 + 0.2));
      alb *= 0.95 + 0.09 * gran;
      alb += spark * 0.16;
      rough = clamp(mix(0.52, 0.30, crust) - spark * 0.12, 0.05, 0.9);
      metal = 0.0;
      ao = mix(0.82, 1.0, dunes);
      h = dunes * 0.6 + wind * 0.3 + gran * 0.1;
    }`
  },

  dirt: {
    tier: 'hero', bump: 1.1, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      vec2 w = warp(uv, 4.0, 0.09);
      float body = fbm(w, 5.0, 5, 0.53);
      vec3  cw   = worleyCell(uv, 30.0);
      float peb  = sstep(0.20, 0.05, cw.x);
      float pid  = cw.z;
      float grain = fbmV(uv, 200.0, 3, 0.5);
      float wet  = sstep(0.6, 0.9, fbm(uv + 30.0, 2.0, 3, 0.5));
      float root = sstep(0.72, 0.9, rfbm(uv, 9.0, 4, 0.5));
      vec3 c1 = vec3(0.106, 0.079, 0.054);
      vec3 c2 = vec3(0.196, 0.150, 0.101);
      alb = mix(c1, c2, body);
      alb = mix(alb, vec3(0.32, 0.30, 0.28) * (0.55 + 0.6 * pid), peb * 0.9);
      alb = mix(alb, vec3(0.062, 0.048, 0.036), wet * 0.5);
      alb = mix(alb, vec3(0.132, 0.104, 0.062), root * 0.5);
      alb *= 0.88 + 0.24 * grain;
      rough = clamp(mix(0.95, 0.74, peb) - wet * 0.22, 0.25, 0.99);
      metal = 0.0;
      ao = mix(0.68, 1.0, body) * mix(1.0, 0.85, root);
      h = body * 0.5 + peb * 0.6 + grain * 0.12 + root * 0.15;
    }`
  },

  sand: {
    tier: 'hero', bump: 0.8, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float rip = sin(uv.y * 6.2831853 * 31.0 + fbm(uv, 4.0, 4, 0.5) * 9.0) * 0.5 + 0.5;
      float big = fbm(warp(uv, 3.0, 0.07), 4.0, 4, 0.5);
      float gran = fbmV(uv, 340.0, 2, 0.5);
      vec3 cw = worleyCell(uv, 26.0);
      float shell = sstep(0.12, 0.02, cw.x) * step(0.93, cw.z);
      alb = mix(vec3(0.208, 0.180, 0.140), vec3(0.312, 0.281, 0.223), big * 0.7 + rip * 0.3);
      alb = mix(alb, vec3(0.148, 0.126, 0.100), sstep(0.55, 0.9, big) * 0.4);
      alb = mix(alb, vec3(0.72, 0.70, 0.66), shell * 0.8);
      alb *= 0.93 + 0.14 * gran;
      rough = clamp(0.9 - gran * 0.1 - shell * 0.35, 0.3, 0.99);
      metal = 0.0;
      ao = mix(0.86, 1.0, rip * 0.5 + big * 0.5);
      h = rip * 0.35 + big * 0.5 + gran * 0.1 + shell * 0.4;
    }`
  },

  forestFloor: {
    tier: 'hero', bump: 1.2, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      vec2 w = warp(uv, 4.0, 0.1);
      float humus = fbm(w, 5.0, 5, 0.55);
      float moss  = sstep(0.45, 0.78, fbm(uv + 7.0, 7.0, 4, 0.55));
      float needle = fbmV(uv, vec2(180.0, 60.0), 3, 0.5);
      float leaf  = worley(warp(uv, 8.0, 0.05), 22.0);
      float leafM = sstep(0.35, 0.08, leaf);
      float twig  = sstep(0.8, 0.95, rfbm(uv, 14.0, 3, 0.5));
      vec3 soil = mix(vec3(0.056, 0.041, 0.030), vec3(0.118, 0.088, 0.058), humus);
      alb = soil;
      alb = mix(alb, vec3(0.176, 0.115, 0.052), leafM * 0.55);
      alb = mix(alb, vec3(0.088, 0.142, 0.062), moss * 0.72);
      alb = mix(alb, vec3(0.098, 0.075, 0.045), twig * 0.6);
      alb *= 0.85 + 0.3 * needle;
      rough = clamp(0.95 - moss * 0.1, 0.5, 0.99);
      metal = 0.0;
      ao = mix(0.5, 1.0, humus * 0.6 + moss * 0.4);
      h = humus * 0.45 + leafM * 0.3 + needle * 0.2 + twig * 0.35 + moss * 0.15;
    }`
  },

  // ---------------------------------------------------------------- organics
  bark: {
    tier: 'prop', bump: 1.9, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float fib = fbm(uv, vec2(26.0, 4.0), 4, 0.5);
      vec3 cell = worleyCell(uv, vec2(9.0, 2.0));
      float ridge = 1.0 - sstep(0.0, 0.09, cell.y);
      float plate = cell.z;
      float grain = fbmV(uv, vec2(80.0, 12.0), 3, 0.5);
      float moss = sstep(0.62, 0.88, fbm(uv + 3.0, 6.0, 4, 0.55));
      vec3 c1 = vec3(0.086, 0.066, 0.048);
      vec3 c2 = vec3(0.168, 0.132, 0.096);
      alb = mix(c1, c2, fib * 0.6 + plate * 0.4);
      alb = mix(alb, vec3(0.032, 0.024, 0.018), ridge * 0.8);
      alb = mix(alb, vec3(0.096, 0.146, 0.068), moss * 0.65);
      alb *= 0.86 + 0.26 * grain;
      rough = clamp(0.94 - grain * 0.08, 0.55, 0.99);
      metal = 0.0;
      ao = mix(1.0, 0.34, ridge);
      h = fib * 0.35 + plate * 0.4 + grain * 0.1 - ridge * 0.85;
    }`
  },

  foliage: {
    tier: 'prop', bump: 0.9, cutout: true, glsl: /* glsl */`
    // Bushes and ferns are built from crossed quads, so this card needs a
    // silhouette: overlapping sprigs radiating from the base of the quad.
    float sprigMask(vec2 uv){
      float m = 0.0;
      // A fan of narrow fronds rooted along the bottom edge, spread across the
      // full width so the card silhouette reads as foliage from every angle.
      for (int i = 0; i < 11; i++){
        float fi = float(i);
        vec2 r = vhash2(vec2(fi, 5.0), vec2(32.0));
        float baseX = 0.08 + (fi + r.x * 0.7) / 11.0 * 0.84;
        float a = (baseX - 0.5) * 1.5 + (r.y - 0.5) * 0.45;   // fan outward
        float len = 0.52 + r.x * 0.44;
        vec2 d = uv - vec2(baseX, 0.0);
        float ca = cos(a), sa = sin(a);
        vec2 q = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
        q.x += q.y * q.y * 0.30;
        if (q.y < 0.0 || q.y > len) continue;
        float along = q.y / len;
        float halfW = 0.020 + 0.030 * sin(along * 3.14159);
        halfW *= (1.0 - along * 0.55);
        // serrate the edge so it never reads as a smooth ribbon
        halfW *= 0.62 + 0.55 * vnoise(vec2(along, fi * 0.13), vec2(34.0, 6.0));
        if (abs(q.x) < halfW) m = 1.0;
      }
      return m;
    }
    float cut(vec2 uv){ return sprigMask(uv); }
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float cluster = fbm(warp(uv, 6.0, 0.07), 7.0, 4, 0.55);
      float leafn = worley(uv, 30.0);
      float vein = sstep(0.55, 0.9, rfbm(uv, vec2(24.0, 38.0), 3, 0.5));
      float dry = sstep(0.6, 0.92, fbm(uv + 17.0, 3.0, 3, 0.5));
      vec3 dark = vec3(0.028, 0.062, 0.024);
      vec3 lit  = vec3(0.098, 0.176, 0.062);
      vec3 aut  = vec3(0.212, 0.132, 0.042);
      alb = mix(dark, lit, sstep(0.25, 0.8, cluster + leafn * 0.4));
      alb = mix(alb, aut, dry * 0.4);
      alb = mix(alb, alb * 1.35, vein * 0.4);
      rough = 0.82 - vein * 0.1;
      metal = 0.0;
      ao = mix(0.45, 1.0, cluster);
      h = cluster * 0.5 + (1.0 - leafn) * 0.35 + vein * 0.2;
    }`
  },

  // --------------------------------------------------------------- man-made
  plank: {
    tier: 'prop', bump: 1.5, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float rows = 6.0, cols = 2.0;
      float ry = uv.y * rows, row = floor(ry), fy = fract(ry);
      float off = floor(vhash(vec2(row, 3.0), vec2(rows)) * 2.0) * 0.5;
      float rx = uv.x * cols + off, col = floor(rx), fx = fract(rx);
      float seamY = sstep(0.0, 0.035, fy) * (1.0 - sstep(0.965, 1.0, fy));
      float seamX = sstep(0.0, 0.012, fx) * (1.0 - sstep(0.988, 1.0, fx));
      float seam = min(seamY, seamX);
      float tint = vhash(vec2(col, row), vec2(cols, rows));
      float grain = fbm(uv + tint * 8.0, vec2(60.0, 8.0), 4, 0.55);
      float knot = sstep(0.88, 1.0, 1.0 - worley(uv + tint * 3.0, vec2(3.0, 6.0)));
      vec3 c1 = vec3(0.126, 0.086, 0.052);
      vec3 c2 = vec3(0.226, 0.166, 0.104);
      alb = mix(c1, c2, grain * 0.8 + tint * 0.25);
      alb = mix(alb, vec3(0.062, 0.042, 0.026), knot * 0.7);
      alb *= mix(0.35, 1.0, seam);
      rough = clamp(0.86 - grain * 0.12, 0.45, 0.99);
      metal = 0.0;
      ao = mix(0.25, 1.0, seam);
      h = grain * 0.2 + seam * 0.6 - knot * 0.2;
    }`
  },

  stoneWall: {
    tier: 'prop', bump: 1.8, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float rows = 8.0, cols = 4.0;
      float ry = uv.y * rows, row = floor(ry), fy = fract(ry);
      float shift = mod(row, 2.0) * 0.5;
      float rx = uv.x * cols + shift, col = floor(rx), fx = fract(rx);
      float id = vhash(vec2(col, row), vec2(cols, rows));
      float mx = 0.05 + id * 0.02;
      float my = mx * cols / rows;
      float inside = sstep(0.0, mx, fx) * (1.0 - sstep(1.0 - mx, 1.0, fx))
                   * sstep(0.0, my, fy) * (1.0 - sstep(1.0 - my, 1.0, fy));
      float mortar = 1.0 - inside;
      float pit = fbm(uv + id * 9.0, 26.0, 4, 0.55);
      float wear = fbm(uv + 4.0, 3.0, 4, 0.5);
      float moss = sstep(0.58, 0.86, fbm(uv + 12.0, 6.0, 4, 0.55)) * sstep(0.2, 0.65, 1.0 - uv.y);
      vec3 stone = mix(vec3(0.146, 0.140, 0.130), vec3(0.238, 0.228, 0.212), id * 0.7 + pit * 0.4);
      stone *= 0.86 + 0.26 * pit;
      vec3 mort = vec3(0.176, 0.170, 0.158) * (0.7 + 0.5 * fbm(uv, 40.0, 3, 0.5));
      alb = mix(stone, mort, mortar);
      alb = mix(alb, vec3(0.086, 0.126, 0.066), moss * 0.6);
      alb *= mix(1.0, 0.82, wear);
      rough = clamp(mix(0.84, 0.95, mortar) - pit * 0.05, 0.5, 0.99);
      metal = 0.0;
      ao = mix(1.0, 0.34, mortar) * mix(1.0, 0.9, pit);
      h = inside * 0.7 + pit * 0.18 - moss * 0.05;
    }`
  },

  thatch: {
    tier: 'prop', bump: 1.6, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float straw = fbmV(uv, vec2(160.0, 12.0), 3, 0.5);
      float band = fract(uv.y * 9.0);
      float lay = sstep(0.0, 0.25, band) * (1.0 - sstep(0.75, 1.0, band));
      float clump = fbm(uv, vec2(7.0, 3.0), 4, 0.55);
      float rot = sstep(0.6, 0.9, fbm(uv + 5.0, 3.0, 3, 0.5));
      vec3 c1 = vec3(0.196, 0.156, 0.078);
      vec3 c2 = vec3(0.298, 0.246, 0.128);
      alb = mix(c1, c2, straw * 0.7 + clump * 0.4);
      alb = mix(alb, vec3(0.086, 0.072, 0.044), rot * 0.6);
      alb *= mix(0.62, 1.0, lay);
      rough = 0.96;
      metal = 0.0;
      ao = mix(0.4, 1.0, lay * 0.7 + clump * 0.3);
      h = straw * 0.35 + lay * 0.5 + clump * 0.2;
    }`
  },

  shingle: {
    tier: 'prop', bump: 1.5, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float rows = 12.0, cols = 8.0;
      float ry = uv.y * rows, row = floor(ry), fy = fract(ry);
      float rx = uv.x * cols + mod(row, 2.0) * 0.5, col = floor(rx), fx = fract(rx);
      float id = vhash(vec2(col, row), vec2(cols, rows));
      float gap = sstep(0.0, 0.05, fx) * (1.0 - sstep(0.95, 1.0, fx)) * sstep(0.0, 0.09, fy);
      float bevel = sstep(0.0, 0.4, fy);
      float grain = fbm(uv + id * 5.0, vec2(50.0, 24.0), 3, 0.5);
      vec3 c = mix(vec3(0.086, 0.075, 0.062), vec3(0.152, 0.132, 0.108), id * 0.6 + grain * 0.5);
      float moss = sstep(0.68, 0.92, fbm(uv + 8.0, 6.0, 3, 0.55));
      alb = mix(c, vec3(0.078, 0.112, 0.058), moss * 0.55);
      alb *= mix(0.4, 1.0, gap) * mix(0.75, 1.0, bevel);
      rough = 0.9 - grain * 0.06;
      metal = 0.0;
      ao = mix(0.3, 1.0, gap) * mix(0.7, 1.0, bevel);
      h = gap * 0.65 + bevel * 0.25 + grain * 0.1;
    }`
  },

  iron: {
    tier: 'prop', bump: 0.9, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float hammer = fbm(warp(uv, 12.0, 0.03), 22.0, 4, 0.55);
      float scratch = rfbm(uv, vec2(40.0, 14.0), 4, 0.5);
      float rust = sstep(0.56, 0.86, fbm(uv + 6.0, 7.0, 5, 0.55));
      float pit = sstep(0.9, 1.0, 1.0 - worley(uv, 60.0));
      vec3 steelC = vec3(0.126, 0.132, 0.140) * (0.8 + 0.5 * hammer);
      vec3 rustC = vec3(0.176, 0.086, 0.038);
      alb = mix(steelC, rustC, rust * 0.8);
      alb = mix(alb, alb * 1.5, sstep(0.6, 0.95, scratch) * 0.5);
      rough = clamp(mix(0.42, 0.86, rust) + hammer * 0.08 - sstep(0.7, 1.0, scratch) * 0.16, 0.12, 0.98);
      metal = mix(1.0, 0.15, rust * 0.85);
      ao = mix(1.0, 0.82, rust) * mix(1.0, 0.7, pit);
      h = hammer * 0.4 + scratch * 0.12 - pit * 0.5 - rust * 0.1;
    }`
  },

  steel: {
    tier: 'prop', bump: 0.6, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float polish = fbm(uv, vec2(30.0, 6.0), 4, 0.5);
      float scratch = rfbm(uv, vec2(70.0, 10.0), 4, 0.5);
      float tarnish = sstep(0.7, 0.95, fbm(uv + 11.0, 5.0, 4, 0.5));
      alb = mix(vec3(0.55, 0.57, 0.60), vec3(0.72, 0.74, 0.78), polish);
      alb = mix(alb, vec3(0.30, 0.28, 0.26), tarnish * 0.6);
      rough = clamp(0.18 + polish * 0.16 + tarnish * 0.35 - sstep(0.6, 1.0, scratch) * 0.08, 0.05, 0.9);
      metal = 1.0 - tarnish * 0.2;
      ao = 1.0 - tarnish * 0.12;
      h = scratch * 0.1 + polish * 0.06;
    }`
  },

  gold: {
    tier: 'detail', bump: 0.7, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float hammer = fbm(warp(uv, 10.0, 0.05), 16.0, 4, 0.55);
      float grime = sstep(0.66, 0.92, fbm(uv + 2.0, 8.0, 4, 0.5));
      alb = mix(vec3(0.86, 0.66, 0.28), vec3(1.0, 0.82, 0.42), hammer);
      alb = mix(alb, vec3(0.22, 0.16, 0.08), grime * 0.5);
      rough = clamp(0.18 + hammer * 0.14 + grime * 0.4, 0.06, 0.9);
      metal = 1.0 - grime * 0.25;
      ao = 1.0 - grime * 0.2;
      h = hammer * 0.35;
    }`
  },

  cloth: {
    tier: 'prop', bump: 1.1, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float wx = sin(uv.x * 6.2831853 * 80.0) * 0.5 + 0.5;
      float wy = sin(uv.y * 6.2831853 * 80.0) * 0.5 + 0.5;
      float weave = mix(wx, wy, step(0.5, fract(uv.y * 80.0)));
      float fold = fbm(warp(uv, 3.0, 0.09), 4.0, 4, 0.55);
      float fuzz = fbmV(uv, 300.0, 2, 0.5);
      float stain = sstep(0.66, 0.92, fbm(uv + 19.0, 7.0, 4, 0.5));
      vec3 dye = vec3(0.126, 0.108, 0.086);
      alb = mix(dye * 0.7, dye * 1.5, fold);
      alb = mix(alb, vec3(0.062, 0.052, 0.042), stain * 0.5);
      alb *= 0.82 + 0.32 * weave;
      alb *= 0.93 + 0.13 * fuzz;
      rough = clamp(0.94 - weave * 0.06, 0.6, 1.0);
      metal = 0.0;
      ao = mix(0.68, 1.0, weave * 0.5 + fold * 0.5);
      h = weave * 0.3 + fold * 0.5 + fuzz * 0.1;
    }`
  },

  leather: {
    tier: 'prop', bump: 1.3, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      vec3 cell = worleyCell(warp(uv, 14.0, 0.02), 46.0);
      float pebble = sstep(0.0, 0.22, cell.y);
      float wear = fbm(uv, 4.0, 5, 0.5);
      float crease = 1.0 - sstep(0.0, 0.045, worleyCell(warp(uv, 3.0, 0.14), 6.0).y);
      vec3 c = mix(vec3(0.092, 0.058, 0.036), vec3(0.176, 0.116, 0.070), wear);
      c = mix(c, c * 1.4, cell.z * 0.4);
      alb = mix(c, vec3(0.048, 0.030, 0.020), crease * 0.7);
      rough = clamp(0.78 - wear * 0.12 + crease * 0.1, 0.35, 0.96);
      metal = 0.0;
      ao = mix(1.0, 0.5, crease) * mix(0.86, 1.0, pebble);
      h = pebble * 0.35 + wear * 0.2 - crease * 0.7;
    }`
  },

  ice: {
    tier: 'prop', bump: 0.8, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float body = fbm(warp(uv, 2.0, 0.14), 3.0, 5, 0.55);
      vec3 cell = worleyCell(uv, 9.0);
      float frac = 1.0 - sstep(0.0, 0.03, cell.y);
      float bub = sstep(0.86, 1.0, 1.0 - worley(uv, 40.0));
      float frost = sstep(0.6, 0.9, rfbm(uv, 18.0, 4, 0.5));
      alb = mix(vec3(0.42, 0.58, 0.70), vec3(0.70, 0.82, 0.90), body);
      alb = mix(alb, vec3(0.92, 0.96, 1.0), frost * 0.6 + bub * 0.5);
      alb = mix(alb, vec3(0.28, 0.42, 0.56), frac * 0.5);
      rough = clamp(0.08 + frost * 0.5 + frac * 0.2, 0.03, 0.85);
      metal = 0.0;
      ao = mix(1.0, 0.7, frac);
      h = body * 0.5 - frac * 0.6 + frost * 0.2 + bub * 0.15;
    }`
  },

  bone: {
    tier: 'detail', bump: 1.0, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float body = fbm(uv, 5.0, 5, 0.5);
      float pore = sstep(0.82, 1.0, 1.0 - worley(uv, 70.0));
      float crack = 1.0 - sstep(0.0, 0.04, worleyCell(warp(uv, 4.0, 0.1), 8.0).y);
      float stain = sstep(0.55, 0.88, fbm(uv + 3.0, 7.0, 4, 0.5));
      alb = mix(vec3(0.42, 0.40, 0.34), vec3(0.62, 0.59, 0.50), body);
      alb = mix(alb, vec3(0.22, 0.19, 0.13), stain * 0.6 + crack * 0.5);
      rough = clamp(0.72 + stain * 0.2, 0.4, 0.98);
      metal = 0.0;
      ao = mix(1.0, 0.45, crack) * mix(1.0, 0.8, pore);
      h = body * 0.4 - crack * 0.7 - pore * 0.25;
    }`
  },

  runestone: {
    tier: 'prop', bump: 1.6, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float body = fbm(warp(uv, 3.0, 0.1), 5.0, 5, 0.5);
      float grain = fbmV(uv, 180.0, 3, 0.5);
      // carved angular glyph strokes on a 6x6 lattice
      vec2 g = uv * 6.0;
      vec2 gi = floor(g), gf = fract(g);
      float id = vhash(gi, vec2(6.0));
      float strokes = 0.0;
      if (id > 0.35){
        float a = step(abs(gf.x - 0.5), 0.055) * step(0.15, gf.y) * step(gf.y, 0.85);
        float b = step(abs(gf.y - (0.3 + id * 0.4)), 0.05) * step(0.2, gf.x) * step(gf.x, 0.8);
        float dir = id > 0.7 ? 1.0 : -1.0;
        float shift = id > 0.7 ? 0.0 : 0.6;
        float c = step(abs((gf.x - 0.2) - (gf.y - 0.2) * dir - shift), 0.05)
                * step(0.15, gf.x) * step(gf.x, 0.85) * step(0.15, gf.y) * step(gf.y, 0.85);
        strokes = clamp(a + b + c, 0.0, 1.0);
      }
      float moss = sstep(0.62, 0.9, fbm(uv + 4.0, 7.0, 4, 0.55));
      vec3 c1 = mix(vec3(0.118, 0.114, 0.110), vec3(0.198, 0.190, 0.178), body);
      c1 *= 0.86 + 0.26 * grain;
      alb = mix(c1, c1 * 0.35, strokes);
      alb = mix(alb, vec3(0.086, 0.126, 0.062), moss * 0.55);
      rough = clamp(0.9 - grain * 0.08, 0.5, 0.99);
      metal = 0.0;
      ao = mix(1.0, 0.28, strokes) * mix(1.0, 0.9, moss);
      h = body * 0.35 + grain * 0.12 - strokes * 0.9;
    }`
  },

  // ----------------------------------------------------- alpha-cutout cards
  // These bake an alpha channel into the albedo so foliage can be built from
  // a handful of crossed quads instead of thousands of blade triangles.
  needles: {
    tier: 'prop', bump: 1.0, cutout: true, glsl: /* glsl */`
    float sprayMask(vec2 uv){
      // a central twig with needle pairs fanning back along it
      float m = 0.0;
      float stem = 1.0 - smoothstep(0.012, 0.030, abs(uv.x - 0.5));
      stem *= step(0.06, uv.y) * (1.0 - smoothstep(0.86, 1.0, uv.y));
      m = max(m, stem);
      for (int i = 0; i < 22; i++){
        float fi = float(i);
        float t = fi / 21.0;
        float y = 0.08 + t * 0.82;
        float side = mod(fi, 2.0) * 2.0 - 1.0;
        float jitter = vhash(vec2(fi, 3.0), vec2(64.0));
        float len = (0.30 - t * 0.20) * (0.72 + jitter * 0.55);
        float droop = 0.20 + jitter * 0.16;
        vec2 d = uv - vec2(0.5, y);
        // rotate into the needle's local frame
        float a = side * (0.72 + jitter * 0.25);
        float ca = cos(a), sa = sin(a);
        vec2 q = vec2(d.x * ca + d.y * sa, -d.x * sa + d.y * ca);
        q.y += q.x * q.x * droop * 3.0;
        float along = clamp(q.x * side / max(len, 1e-3), 0.0, 1.0);
        float halfW = (0.010 + 0.008 * (1.0 - along)) * (1.0 - along * 0.85);
        float needle = (1.0 - step(halfW, abs(q.y))) * step(0.0, q.x * side) * (1.0 - step(len, q.x * side));
        m = max(m, needle);
      }
      return m;
    }
    float cut(vec2 uv){ return sprayMask(uv) > 0.5 ? 1.0 : 0.0; }
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float t = uv.y;
      float shade = fbm(uv, vec2(18.0, 6.0), 3, 0.5);
      float dry = sstep(0.55, 0.95, fbm(uv + 5.0, 4.0, 3, 0.5));
      vec3 deep = vec3(0.018, 0.042, 0.024);
      vec3 lit  = vec3(0.052, 0.104, 0.042);
      alb = mix(deep, lit, shade * 0.7 + t * 0.35);
      alb = mix(alb, vec3(0.152, 0.108, 0.048), dry * 0.35);
      rough = 0.78;
      metal = 0.0;
      ao = mix(0.55, 1.0, t * 0.5 + shade * 0.5);
      h = shade * 0.4 + sprayMask(uv) * 0.5;
    }`
  },

  leaves: {
    tier: 'prop', bump: 1.0, cutout: true, glsl: /* glsl */`
    float leafMask(vec2 uv){
      float m = 0.0;
      // Many small, well-separated leaves. Fewer/larger ones merge into a
      // single blob and the card reads as a painted rectangle at any distance.
      for (int i = 0; i < 22; i++){
        float fi = float(i);
        vec2 r = vhash2(vec2(fi, 7.0), vec2(64.0));
        float r2 = vhash(vec2(fi, 19.0), vec2(64.0));
        vec2 c = vec2(0.10 + r.x * 0.80, 0.10 + r.y * 0.80);
        float a = r2 * 6.2831853;
        float ca = cos(a), sa = sin(a);
        vec2 d = uv - c;
        vec2 q = vec2(d.x * ca + d.y * sa, -d.x * sa + d.y * ca);
        float rx = 0.032 + r.x * 0.026;
        float ry = 0.070 + r.y * 0.048;
        // teardrop: widest a third of the way up, drawn to a point at the tip
        float t = clamp((q.y + ry) / (2.0 * ry), 0.0, 1.0);
        float wprof = sin(pow(t, 0.62) * 3.14159);
        if (abs(q.y) < ry && abs(q.x) < rx * wprof) m = 1.0;
      }
      return m;
    }
    float cut(vec2 uv){ return leafMask(uv); }
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float v = fbm(uv, 12.0, 3, 0.5);
      float vein = sstep(0.6, 0.95, rfbm(uv, vec2(20.0, 34.0), 3, 0.5));
      float aut = sstep(0.62, 0.95, fbm(uv + 13.0, 5.0, 3, 0.5));
      alb = mix(vec3(0.048, 0.106, 0.036), vec3(0.132, 0.216, 0.078), v);
      alb = mix(alb, vec3(0.238, 0.148, 0.046), aut * 0.55);
      alb = mix(alb, alb * 1.4, vein * 0.5);
      rough = 0.74;
      metal = 0.0;
      ao = mix(0.6, 1.0, v);
      h = v * 0.4 + vein * 0.3 + leafMask(uv) * 0.4;
    }`
  },

  // A tuft of individual blades on a transparent card. Grass built from solid
  // tapered geometry reads as a green cone at any distance; a cutout card with
  // real gaps between blades reads as grass.
  grassTuft: {
    tier: 'prop', bump: 0.6, cutout: true, glsl: /* glsl */`
    float bladeMask(vec2 uv, out float alongOut, out float idOut){
      float m = 0.0; alongOut = 0.0; idOut = 0.0;
      for (int i = 0; i < 26; i++){
        float fi = float(i);
        vec2 r = vhash2(vec2(fi, 11.0), vec2(64.0));
        float r2 = vhash(vec2(fi, 29.0), vec2(64.0));
        float rootX = 0.06 + r.x * 0.88;
        float h     = 0.42 + r.y * 0.56;          // blade height
        float lean  = (r2 - 0.5) * 0.62;          // sideways drift at the tip
        float w     = 0.006 + r.y * 0.010;
        // Blades are cut off below the card's base so the tuft has no seam.
        float t = clamp(uv.y / max(h, 1e-3), 0.0, 1.0);
        if (uv.y > h) continue;
        // quadratic bend, strongest near the tip
        float x = rootX + lean * t * t;
        float halfW = w * (1.0 - t * 0.86) + 0.0015;
        if (abs(uv.x - x) < halfW){
          m = 1.0;
          alongOut = t;
          idOut = r2;
        }
      }
      return m;
    }
    float cut(vec2 uv){ float a, id; return bladeMask(uv, a, id); }
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      float along, id;
      float m = bladeMask(uv, along, id);
      // Dark and slightly blue at the root, warmer and paler at the tip; every
      // blade gets its own bias so a lawn is not one flat colour.
      vec3 root = vec3(0.030, 0.058, 0.026);
      vec3 mid  = vec3(0.078, 0.150, 0.048);
      vec3 tip  = vec3(0.150, 0.205, 0.074);
      vec3 dry  = vec3(0.205, 0.176, 0.078);
      alb = mix(root, mid, sstep(0.0, 0.45, along));
      alb = mix(alb, tip, sstep(0.4, 1.0, along));
      alb = mix(alb, dry, sstep(0.62, 0.95, id) * along * 0.8);
      alb *= 0.80 + 0.44 * id;
      rough = 0.72;
      metal = 0.0;
      ao = mix(0.42, 1.0, along);
      h = m * (0.35 + along * 0.4);
    }`
  },

  fur: {
    tier: 'prop', bump: 1.4, glsl: /* glsl */`
    void surf(vec2 uv, out vec3 alb, out float rough, out float metal, out float ao, out float h){
      vec2 w = warp(uv, 5.0, 0.05);
      float strand = fbmV(w, vec2(200.0, 32.0), 3, 0.5);
      float clump = fbm(w, 8.0, 4, 0.55);
      float guard = sstep(0.62, 0.9, fbm(w + 3.0, 12.0, 3, 0.5));
      vec3 c1 = vec3(0.062, 0.050, 0.040);
      vec3 c2 = vec3(0.168, 0.140, 0.112);
      alb = mix(c1, c2, clump * 0.6 + strand * 0.5);
      alb = mix(alb, vec3(0.24, 0.21, 0.18), guard * 0.4);
      rough = 0.9 - strand * 0.08;
      metal = 0.0;
      ao = mix(0.5, 1.0, clump * 0.5 + strand * 0.5);
      h = strand * 0.5 + clump * 0.4 + guard * 0.2;
    }`
  },
};

// ---------------------------------------------------------------------------
// Bakery
// ---------------------------------------------------------------------------

const SIZES = {
  hero: [256, 384, 512, 1024, 2048],
  prop: [128, 192, 256, 512, 768],
  detail: [128, 128, 256, 256, 512],
};

export class TextureBakery {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    /** @type {Map<string,{albedo:THREE.Texture,orm:THREE.Texture,normal:THREE.Texture}>} */
    this.sets = new Map();
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this._scene = new THREE.Scene().add(this._quad);
    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._targets = [];
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  sizeFor(tier, quality) {
    const arr = SIZES[tier] || SIZES.prop;
    return arr[Math.max(0, Math.min(arr.length - 1, quality | 0))];
  }

  /** Bakes one recipe into three textures. Synchronous, ~1-30ms depending on size. */
  bake(name, quality, aniso) {
    const recipe = RECIPES[name];
    if (!recipe) throw new Error('unknown recipe ' + name);
    const size = this.sizeFor(recipe.tier, quality);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: (recipe.cutout ? '#define HAS_CUTOUT 1\n' : '') +
        GLSL_NOISE + '\n' + recipe.glsl + '\n' + MAIN,
      uniforms: {
        uOut: { value: 0 },
        uSize: { value: size },
        uBump: { value: recipe.bump ?? 1 },
      },
      depthTest: false, depthWrite: false,
    });
    this._quad.material = mat;

    const out = {};
    const keys = ['albedo', 'orm', 'normal'];
    const prevTarget = this.renderer.getRenderTarget();
    for (let i = 0; i < 3; i++) {
      const rt = new THREE.WebGLRenderTarget(size, size, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        colorSpace: i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        generateMipmaps: true,
        depthBuffer: false,
        stencilBuffer: false,
      });
      rt.texture.name = `${name}.${keys[i]}`;
      rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
      rt.texture.anisotropy = Math.min(aniso, this.maxAniso);
      mat.uniforms.uOut.value = i;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this._scene, this._cam);
      out[keys[i]] = rt.texture;
      this._targets.push(rt);
    }
    this.renderer.setRenderTarget(prevTarget);
    mat.dispose();

    out.size = size;
    this.sets.set(name, out);
    return out;
  }

  get(name) { return this.sets.get(name); }

  /** Yields the recipe names in bake order (heroes first so the world looks right early). */
  static bakeOrder() {
    const heroes = [], props = [], details = [];
    for (const [k, v] of Object.entries(RECIPES)) {
      (v.tier === 'hero' ? heroes : v.tier === 'prop' ? props : details).push(k);
    }
    return [...heroes, ...props, ...details];
  }

  disposeAll() {
    for (const rt of this._targets) rt.dispose();
    this._targets.length = 0;
    this.sets.clear();
  }
}

// ---------------------------------------------------------------------------
// Small CPU-side utility textures
// ---------------------------------------------------------------------------

/** RGBA white noise — used for dithering, TAA jitter and particle variation. */
export function makeNoiseTexture(size = 256, seed = 7) {
  const data = new Uint8Array(size * size * 4);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = rnd() * 255;
    data[i * 4 + 1] = rnd() * 255;
    data[i * 4 + 2] = rnd() * 255;
    data[i * 4 + 3] = rnd() * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  t.name = 'blueish-noise';
  return t;
}

/** Radial soft particle sprite (smoke, sparks, dust). */
export function makeSoftSprite(size = 128, hardness = 0.35, seed = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, size * hardness * 0.5, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Streaked lens-dirt overlay for bloom/flare. */
export function makeLensDirt(size = 512, seed = 11) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 220; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 2 + rnd() * rnd() * 40;
    const a = 0.03 + rnd() * 0.16;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,250,240,${a})`);
    grad.addColorStop(1, 'rgba(255,250,240,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 40; i++) {
    const y = rnd() * size;
    g.strokeStyle = `rgba(255,248,235,${0.02 + rnd() * 0.06})`;
    g.lineWidth = 0.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(size * 0.3, y + (rnd() - 0.5) * 60, size * 0.7, y + (rnd() - 0.5) * 60, size, y + (rnd() - 0.5) * 30);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
