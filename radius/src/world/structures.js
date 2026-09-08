// Built environment of the Pechorsk zone: checkpoint, convoy, the kolkhoz "Zarya", Object 12, the church,
// the rail cutting, marsh boards, the hunter's hut. Also the shared procedural-material and geometry
// library used by props.js and game/base_scene.js. Everything is generated; nothing is loaded.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { ROADS, RAIL, WATER_LEVEL, poi, distToPolyline, pointOnPolyline } from './map.js';

// ---------------------------------------------------------------------------------------------
// Materials. One MeshStandardMaterial per surface kind; all colour lives in vertex colours so that
// every piece of the zone that shares a kind can be merged into one draw call. The shader adds
// world-space noise: stains, streaks under ledges, cracks, rust blooms, plank grain, brick courses.
// ---------------------------------------------------------------------------------------------
export const timeUniform = { value: 0 };
const windUniform = { value: 0 };

const VERT_HEAD = /* glsl */`varying vec3 vWPos; varying vec3 vWNormal; varying vec2 vLuv; uniform float uTime; uniform float uWind;`;
const VERT_BODY = /* glsl */`
  vec4 wp4 = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4; wn = mat3(instanceMatrix) * wn;
  #endif
  vWPos = (modelMatrix * wp4).xyz; vWNormal = normalize(mat3(modelMatrix) * wn); vLuv = uv;`;

// per-kind fragment snippets: run after diffuseColor = color * vColor; may set wRough / wMetal / alpha
const KINDS = {
  concrete: /* glsl */`
    float n1 = fbm3(wp.xz * 0.33 + wp.y * 0.21); float n2 = vnoise3(wp * 6.5);
    vec3 c = diffuseColor.rgb * (0.80 + 0.40 * n1) * (0.88 + 0.24 * n2);
    float vert = 1.0 - abs(N.y);
    vec2 sc = vec2(wp.x * 2.9 + wp.z * 3.3, wp.y * 0.33);
    float streak = smoothstep(0.56, 0.86, vnoise(sc)) * smoothstep(0.25, 0.7, vnoise(sc * vec2(1.0, 5.0) + 3.0));
    c *= 1.0 - 0.30 * streak * vert;
    float wv = worley(wp.xz * 0.75 + wp.y * 0.9);
    c *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.03, wv)) * smoothstep(0.45, 0.7, n1);
    float seam = min(abs(fract(wp.x / 3.0 + 0.5) - 0.5), abs(fract(wp.y / 3.2 + 0.5) - 0.5));
    c *= 1.0 - 0.22 * (1.0 - smoothstep(0.004, 0.012, seam)) * vert;
    float moss = smoothstep(0.55, 0.82, fbm3(wp.xz * 0.9 + 5.0)) * clamp(N.y, 0.0, 1.0);
    c = mix(c, vec3(0.30, 0.34, 0.17), moss * 0.45);
    diffuseColor.rgb = c; wRough = 0.06 * n2 - 0.04 * streak;`,
  metal: /* glsl */`
    float r = fbm3d(wp * 1.25) + 0.15 * (1.0 - clamp(N.y, 0.0, 1.0));
    float rust = smoothstep(0.44, 0.74, r);
    vec3 rustC = mix(vec3(0.46, 0.27, 0.14), vec3(0.24, 0.12, 0.07), vnoise3(wp * 9.0));
    vec3 c = mix(diffuseColor.rgb * (0.86 + 0.28 * vnoise3(wp * 2.7)), rustC, rust);
    c *= 1.0 - 0.14 * smoothstep(0.72, 0.92, vnoise(vec2(wp.x * 38.0 + wp.z * 3.0, wp.y * 2.0 + wp.z * 30.0)));
    float bloom = smoothstep(0.62, 0.9, fbm3(wp.xy * 3.1 + wp.z * 2.0));
    c = mix(c, rustC * 1.15, bloom * 0.5);
    diffuseColor.rgb = c; wRough = 0.28 * rust + 0.1 * bloom; wMetal = -0.7 * rust;`,
  log: /* glsl */`
    vec2 gc = abs(N.x) > 0.6 ? vec2(wp.z, wp.y) : abs(N.y) > 0.6 ? vec2(wp.x, wp.z) : vec2(wp.x, wp.y);
    float grain = vnoise(vec2(gc.x * 0.8, gc.y * 21.0)); float grain2 = vnoise(vec2(gc.x * 3.3, gc.y * 62.0));
    vec3 c = diffuseColor.rgb * (0.76 + 0.34 * grain) * (0.9 + 0.16 * grain2);
    float silver = smoothstep(0.42, 0.8, fbm3(gc * 0.55 + 11.0));
    c = mix(c, vec3(0.44, 0.42, 0.37) * (0.8 + 0.3 * grain), silver * 0.5);
    float band = fract(gc.y / 0.27); float gap = 1.0 - smoothstep(0.0, 0.05, min(band, 1.0 - band));
    c *= 1.0 - 0.55 * gap * step(0.4, abs(N.y) < 0.6 ? 1.0 : 0.0);
    c *= 1.0 - 0.25 * smoothstep(0.6, 0.85, fbm3(wp.xz * 1.5 + wp.y)) * (1.0 - abs(N.y));
    diffuseColor.rgb = c; wRough = 0.05 * grain;`,
  plank: /* glsl */`
    vec2 gc = abs(N.x) > 0.6 ? vec2(wp.z, wp.y) : abs(N.y) > 0.6 ? vec2(wp.x, wp.z) : vec2(wp.x, wp.y);
    float grain = vnoise(vec2(gc.x * 1.1, gc.y * 26.0)); float grain2 = vnoise(vec2(gc.x * 4.0, gc.y * 70.0));
    vec3 c = diffuseColor.rgb * (0.74 + 0.36 * grain) * (0.9 + 0.16 * grain2);
    float bid = floor(gc.y / 0.19); float bj = hash11(bid * 3.7 + floor(gc.x / 2.4) * 11.0);
    c *= 0.86 + 0.28 * bj;
    float band = fract(gc.y / 0.19); float gap = 1.0 - smoothstep(0.0, 0.08, min(band, 1.0 - band));
    c *= 1.0 - 0.5 * gap;
    float silver = smoothstep(0.4, 0.8, fbm3(gc * 0.7 + 21.0));
    c = mix(c, vec3(0.47, 0.46, 0.42) * (0.8 + 0.3 * grain), silver * 0.45);
    diffuseColor.rgb = c; wRough = 0.05 * grain;`,
  brick: /* glsl */`
    vec2 bc = abs(N.x) > 0.6 ? vec2(wp.z, wp.y) : abs(N.y) > 0.6 ? vec2(wp.x, wp.z) : vec2(wp.x, wp.y);
    vec2 bs = vec2(0.25, 0.075); float row = floor(bc.y / bs.y); bc.x += mod(row, 2.0) * 0.125;
    vec2 f = fract(bc / bs); vec2 id = floor(bc / bs);
    float mortar = 1.0 - step(0.05, f.x) * step(0.14, f.y);
    vec3 brick = mix(vec3(0.56, 0.30, 0.21), vec3(0.40, 0.22, 0.17), hash21(id)) * (0.84 + 0.32 * vnoise(bc * 31.0));
    brick = mix(brick, vec3(0.30, 0.20, 0.16), smoothstep(0.6, 0.9, hash21(id + 7.0)) * 0.5);
    vec3 mortarC = vec3(0.56, 0.53, 0.47) * (0.8 + 0.3 * vnoise(bc * 43.0));
    vec3 c = mix(brick, mortarC, mortar) * diffuseColor.rgb;
    float eff = smoothstep(0.62, 0.85, fbm3(bc * 0.9 + 3.0)); c = mix(c, vec3(0.62, 0.60, 0.56), eff * 0.35);
    c *= 1.0 - 0.3 * smoothstep(0.55, 0.85, fbm3(wp.xz * 1.1 - wp.y * 0.5)) * (1.0 - abs(N.y));
    diffuseColor.rgb = c; wRough = 0.05 * mortar;`,
  corrugated: /* glsl */`
    float along = abs(N.x) > 0.6 ? wp.z : abs(N.y) > 0.6 ? wp.x : wp.x;
    float wave = sin(along / 0.076 * 6.2832);
    float r = fbm3d(wp * 1.6); float rust = smoothstep(0.40, 0.72, r + 0.1 * (1.0 - clamp(N.y, 0.0, 1.0)));
    vec3 rustC = mix(vec3(0.50, 0.28, 0.14), vec3(0.26, 0.13, 0.07), vnoise3(wp * 8.0));
    vec3 c = mix(diffuseColor.rgb * (0.9 + 0.2 * vnoise3(wp * 2.0)), rustC, rust);
    c *= 0.86 + 0.16 * wave;
    float sheet = 1.0 - smoothstep(0.0, 0.02, abs(fract(along / 0.9 + 0.5) - 0.5)); c *= 1.0 - 0.35 * sheet;
    diffuseColor.rgb = c; wRough = 0.25 * rust; wMetal = -0.6 * rust;`,
  canvas: /* glsl */`
    float n = fbm3(wp.xy * 2.2 + wp.z * 1.7);
    vec3 c = diffuseColor.rgb * (0.78 + 0.36 * n) * (0.92 + 0.12 * vnoise(vec2(wp.x * 60.0, wp.y * 60.0 + wp.z * 50.0)));
    c *= 1.0 - 0.3 * smoothstep(0.5, 0.85, fbm3(wp.xz * 1.4 + 9.0));
    float tear = worley(wp.xz * 1.3 + wp.y * 1.1);
    float edge = smoothstep(0.6, 1.0, abs(vLuv.x - 0.5) * 2.0);
    if (tear < 0.07 + 0.16 * edge) discard;
    diffuseColor.rgb = c; wRough = 0.05;`,
  sandbag: /* glsl */`
    vec3 c = diffuseColor.rgb * (0.82 + 0.34 * vnoise3(wp * 22.0)) * (0.9 + 0.2 * fbm3(wp.xz * 3.0 + wp.y));
    c *= 1.0 - 0.25 * smoothstep(0.55, 0.85, fbm3(wp.xz * 1.2 + 4.0));
    diffuseColor.rgb = c;`,
  glass: /* glsl */`
    float grime = smoothstep(0.35, 0.8, fbm3(wp.xy * 2.5 + wp.z * 2.0));
    vec3 c = mix(diffuseColor.rgb, vec3(0.30, 0.31, 0.27), grime * 0.7);
    float streak = smoothstep(0.6, 0.9, vnoise(vec2(wp.x * 6.0 + wp.z * 6.0, wp.y * 0.5)));
    c *= 1.0 - 0.3 * streak;
    diffuseColor.rgb = c; wRough = 0.5 * grime;`,
  stone: /* glsl */`
    float w = worley(wp.xz * 2.2 + wp.y * 2.0); float n = fbm3(wp.xz * 1.4 + wp.y);
    vec3 c = diffuseColor.rgb * (0.78 + 0.4 * n) * (0.7 + 0.5 * smoothstep(0.0, 0.25, w));
    float lich = smoothstep(0.58, 0.85, fbm3(wp.xz * 1.1 + 31.0)); c = mix(c, vec3(0.45, 0.47, 0.30), lich * 0.4);
    diffuseColor.rgb = c; wRough = 0.05;`,
  paint: /* glsl */`
    float flake = smoothstep(0.48, 0.62, fbm3(wp.xy * 4.0 + wp.z * 3.0) + 0.25 * vnoise3(wp * 25.0));
    vec3 under = vec3(0.42, 0.40, 0.35) * (0.8 + 0.3 * vnoise3(wp * 7.0));
    vec3 c = mix(diffuseColor.rgb * (0.9 + 0.2 * vnoise3(wp * 3.0)), under, flake);
    c *= 1.0 - 0.25 * smoothstep(0.5, 0.8, fbm3(wp.xz * 1.3 + wp.y * 0.7));
    diffuseColor.rgb = c; wRough = 0.2 * flake;`,
  scorch: /* glsl */`
    vec2 q = (vLuv - 0.5) * 2.0; float rad = length(q);
    float n = fbm3(wp.xz * 1.6 + 17.0);
    float a = (1.0 - smoothstep(0.35, 1.0, rad + (n - 0.5) * 0.5)) * (0.75 + 0.25 * vnoise(wp.xz * 9.0));
    diffuseColor.rgb = mix(vec3(0.05, 0.045, 0.04), vec3(0.16, 0.14, 0.12), smoothstep(0.3, 0.9, n));
    diffuseColor.a = a * 0.92; wRough = 0.1;`,
  chainlink: /* glsl */`
    float along = abs(N.x) > 0.6 ? wp.z : wp.x;
    vec2 q = vec2(along, wp.y) / 0.055;
    float d = min(abs(fract(q.x + q.y) - 0.5), abs(fract(q.x - q.y) - 0.5));
    float sag = smoothstep(0.5, 1.0, fbm3(wp.xz * 0.5));
    if (d > 0.09) discard;
    vec3 c = mix(vec3(0.42, 0.42, 0.40), vec3(0.36, 0.22, 0.12), smoothstep(0.4, 0.75, fbm3d(wp * 1.5)));
    diffuseColor.rgb = c * (0.8 + 0.3 * vnoise3(wp * 30.0)); wRough = 0.2; wMetal = 0.2;`,
  earth: /* glsl */`
    float macro = fbm3(wp.xz * 0.35); float micro = vnoise(wp.xz * 1.9) * 0.6 + vnoise(wp.xz * 5.7) * 0.4;
    vec3 gA = vec3(0.40, 0.38, 0.22), gB = vec3(0.30, 0.31, 0.16), gC = vec3(0.50, 0.46, 0.27);
    vec3 c = mix(gA, gB, smoothstep(0.3, 0.8, worley(wp.xz * 0.9))); c = mix(c, gC, smoothstep(0.55, 0.9, micro) * 0.6);
    c = mix(c, vec3(0.26, 0.23, 0.18), smoothstep(0.55, 0.8, fbm3(wp.xz * 0.6 + 8.0)) * 0.5);
    diffuseColor.rgb = c * (0.85 + 0.3 * macro) * diffuseColor.rgb;`,
  crt: /* glsl */`
    vec2 q = vLuv; float scan = 0.85 + 0.15 * sin(q.y * 620.0);
    float band = smoothstep(0.0, 0.08, abs(fract(q.y * 0.5 - uTime * 0.11) - 0.5));
    float txt = step(0.6, hash21(floor(q * vec2(48.0, 22.0)) + floor(uTime * 0.5))) * step(0.08, q.y) * step(q.y, 0.9) * step(0.05, q.x) * step(q.x, 0.95);
    float cur = step(0.5, fract(uTime * 1.4)) * step(abs(q.x - 0.25) , 0.012) * step(abs(q.y - 0.12), 0.02);
    vec3 g = vec3(0.35, 1.0, 0.45);
    diffuseColor.rgb = vec3(0.02, 0.04, 0.03);
    wEmissive = g * (0.35 + 1.4 * txt + 2.2 * cur) * scan * (0.7 + 0.3 * band) * (1.0 - 0.5 * smoothstep(0.7, 1.0, length(q - 0.5) * 1.6));`,
  tube: /* glsl */`
    float along = vLuv.x;
    float ends = smoothstep(0.0, 0.06, along) * smoothstep(1.0, 0.94, along);
    diffuseColor.rgb = vec3(0.85, 0.88, 0.82);
    wEmissive = vec3(0.86, 0.92, 0.80) * (0.55 + 0.45 * ends) * (0.9 + 0.1 * vnoise(vec2(along * 40.0, uTime * 3.0)));`,
  flag: /* glsl */`
    float weave = 0.9 + 0.1 * vnoise(vLuv * 220.0);
    float disc = 1.0 - smoothstep(0.17, 0.19, length((vLuv - vec2(0.5, 0.5)) * vec2(1.5, 1.0)));
    float ring = smoothstep(0.13, 0.145, length((vLuv - vec2(0.5, 0.5)) * vec2(1.5, 1.0))) * disc;
    vec3 c = mix(diffuseColor.rgb, vec3(0.86, 0.86, 0.82), ring);
    c *= weave * (0.85 + 0.25 * fbm3(vLuv * 6.0 + 2.0));
    c *= 1.0 - 0.3 * smoothstep(0.85, 1.0, vLuv.x);
    diffuseColor.rgb = c;`,
  poster: /* glsl */`
    float fade = 0.85 + 0.25 * fbm3(vLuv * 5.0 + wp.xz * 2.0);
    vec3 c = diffuseColor.rgb * fade;
    float stain = smoothstep(0.62, 0.9, fbm3(vLuv * 3.2 + 13.0)); c = mix(c, c * vec3(0.7, 0.62, 0.5), stain);
    float bandA = step(0.72, vLuv.y) * step(vLuv.y, 0.86); float bandB = step(0.16, vLuv.y) * step(vLuv.y, 0.19);
    vec3 accent = vec3(0.55, 0.14, 0.10);
    c = mix(c, accent * fade, (bandA + bandB) * 0.85);
    float blocks = step(0.55, hash21(floor(vLuv * vec2(9.0, 26.0)))) * step(0.3, vLuv.y) * step(vLuv.y, 0.66) * step(0.15, vLuv.x) * step(vLuv.x, 0.85);
    c = mix(c, vec3(0.12, 0.11, 0.10) * fade, blocks * 0.35);
    c *= 1.0 - 0.35 * smoothstep(0.85, 1.0, max(abs(vLuv.x - 0.5), abs(vLuv.y - 0.5)) * 2.0) * step(0.5, hash21(floor(wp.xz * 3.0)));
    diffuseColor.rgb = c;`,
};

const NORMAL_TWEAK = {
  log: /* glsl */`{ float ph = fract(vWPos.y / 0.27); float side = 1.0 - abs(vWNormal.y);
      vec3 bend = vec3(0.0, cos(ph * 6.2832) * 0.55, 0.0); normal = normalize(normal + bend * side); }`,
  corrugated: /* glsl */`{ float along = abs(vWNormal.x) > 0.6 ? vWPos.z : abs(vWNormal.y) > 0.6 ? vWPos.x : vWPos.x;
      float ph = along / 0.076 * 6.2832; vec3 t = abs(vWNormal.x) > 0.6 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      normal = normalize(normal + t * cos(ph) * 0.45); }`,
  sandbag: /* glsl */`{ vec3 g = vec3(vnoise3(vWPos * 18.0), vnoise3(vWPos * 18.0 + 7.0), vnoise3(vWPos * 18.0 + 13.0)) - 0.5; normal = normalize(normal + g * 0.35); }`,
  stone: /* glsl */`{ vec3 g = vec3(vnoise3(vWPos * 6.0), vnoise3(vWPos * 6.0 + 7.0), vnoise3(vWPos * 6.0 + 13.0)) - 0.5; normal = normalize(normal + g * 0.5); }`,
  concrete: /* glsl */`{ float fade = 1.0 - smoothstep(12.0, 40.0, length(vWPos - cameraPosition)); vec3 g = vec3(vnoise3(vWPos * 9.0), vnoise3(vWPos * 9.0 + 7.0), vnoise3(vWPos * 9.0 + 13.0)) - 0.5; normal = normalize(normal + g * 0.18 * fade); }`,
};

// vertex displacement (wind) for cloth kinds; runs after begin_vertex
const VERTEX_TWEAK = {
  canvas: /* glsl */`{ float f = aFlap; vec3 wpp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      float w = sin(uTime * 2.3 + wpp.x * 1.7 + wpp.z * 1.1) * 0.6 + sin(uTime * 4.1 + wpp.y * 3.0) * 0.4;
      transformed += objectNormal * w * 0.06 * f * (0.6 + 0.4 * uWind); }`,
  flag: /* glsl */`{ float u = uv.x; float w1 = sin(u * 6.0 - uTime * 4.2) * 0.12 * u; float w2 = sin(u * 11.0 - uTime * 6.5 + uv.y * 3.0) * 0.04 * u;
      float w3 = sin(uTime * 1.3) * 0.05 * u;
      transformed.z += (w1 + w2 + w3) * (0.7 + 0.3 * uWind); transformed.y -= 0.12 * u * u * (1.0 - 0.5 * uWind);
      objectNormal = normalize(objectNormal + vec3(0.0, 0.0, 0.0) + vec3(cos(u * 6.0 - uTime * 4.2) * 0.7 * u, 0.0, 0.0)); }`,
};

const materialCache = new Map();
// Create (or fetch) the shared material for a surface kind.
export function material(kind, opts = {}) {
  const key = kind + (opts.key || '');
  if (materialCache.has(key)) return materialCache.get(key);
  const params = Object.assign({ color: 0xffffff, roughness: 0.86, metalness: 0.0, vertexColors: true, side: THREE.FrontSide }, opts.params || {});
  // no environment map in the scene: metalness above ~0.3 renders as a black silhouette under the overcast sun
  if (kind === 'metal' || kind === 'corrugated') { params.roughness = 0.78; params.metalness = 0.22; }
  if (kind === 'glass') { params.roughness = 0.3; params.metalness = 0.15; }
  if (kind === 'canvas' || kind === 'chainlink' || kind === 'flag') { params.side = THREE.DoubleSide; }
  if (kind === 'scorch') { params.transparent = true; params.depthWrite = false; params.polygonOffset = true; params.polygonOffsetFactor = -2; params.polygonOffsetUnits = -2; }
  if (kind === 'crt' || kind === 'tube') { params.emissive = 0xffffff; params.emissiveIntensity = 1.0; params.roughness = 0.35; }   // the shader supplies the emissive shape; `emissive` carries the intensity
  if (kind === 'poster') { params.roughness = 0.95; }
  const mat = new THREE.MeshStandardMaterial(params);
  const snippet = KINDS[kind] || KINDS.concrete;
  const normalTweak = NORMAL_TWEAK[kind] || '';
  const vertexTweak = VERTEX_TWEAK[kind] || '';
  mat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.uniforms.uTime = timeUniform; shader.uniforms.uWind = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}\n${kind === 'canvas' ? 'attribute float aFlap;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexTweak}\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vWPos; varying vec3 vWNormal; varying vec2 vLuv; uniform float uTime;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nfloat wRough = 0.0; float wMetal = 0.0; vec3 wEmissive = vec3(0.0);\n{ vec3 wp = vWPos; vec3 N = vWNormal;\n${snippet}\n}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + wRough, 0.05, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = clamp(metalnessFactor + wMetal, 0.0, 1.0);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${normalTweak}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance = wEmissive * emissive;`);
  };
  mat.customProgramCacheKey = () => 'radius-' + key;
  materialCache.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const hashf = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

// bake vertex colours: base colour, per-element jitter, darkening toward `ground` (damp base), optional fn
export function colorize(geo, rgb, opts = {}) {
  const pos = geo.attributes.position; const n = pos.count;
  const col = new Float32Array(n * 3);
  const jit = opts.jitter ?? 0.06;
  const seed = opts.seed ?? (pos.getX(0) * 3.1 + pos.getZ(0) * 7.7);
  const ej = 1 + (hashf(seed, 1.3, 2.7) - 0.5) * 2 * jit;
  const ground = opts.ground, dampH = opts.dampH ?? 1.1, damp = opts.damp ?? 0.35;
  const top = opts.top;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let m = ej * (1 + (hashf(x * 0.7, y * 1.3, z * 0.9) - 0.5) * jit * 0.6);
    if (ground !== undefined) { const t = Math.max(0, Math.min(1, (y - ground) / dampH)); m *= 1 - damp * (1 - t) * (1 - t); }
    if (top !== undefined && opts.topDark) { const t = Math.max(0, Math.min(1, (top - y) / 0.8)); m *= 1 - opts.topDark * (1 - t); }
    let r = rgb[0] * m, g = rgb[1] * m, b = rgb[2] * m;
    if (opts.fn) { const o = opts.fn(x, y, z, i); if (o) { r *= o[0]; g *= o[1]; b *= o[2]; } }
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
export function placeMatrix(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _v.set(x, y, z); _s.set(sx, sy, sz);
  return _m.compose(_v, _q, _s).clone();
}
// strip attributes so every geometry merges (position, normal, uv, color)
export function normalizeGeo(geo) {
  const keep = ['position', 'normal', 'uv', 'color'];
  for (const k of Object.keys(geo.attributes)) if (!keep.includes(k)) geo.deleteAttribute(k);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
  return geo;
}

// A builder collects geometry per material kind for one site, then merges into one mesh per kind.
export function createBuilder(ctx, name, opts = {}) {
  const buckets = new Map();
  const group = new THREE.Group(); group.name = name;
  const api = {
    group,
    // add a transformed, coloured geometry to a kind bucket
    geo(kind, geometry, matrix, rgb, copts = {}) {
      if (matrix) geometry.applyMatrix4(matrix);
      if (rgb) colorize(geometry, rgb, copts); else if (!geometry.attributes.color) colorize(geometry, [1, 1, 1], copts);
      normalizeGeo(geometry);
      const key = kind + (copts.noShadow ? '|ns' : '');
      if (!buckets.has(key)) buckets.set(key, { kind, list: [], noShadow: !!copts.noShadow });
      buckets.get(key).list.push(geometry);
      return geometry;
    },
    box(kind, w, h, d, x, y, z, rgb, o = {}) {
      const g = new THREE.BoxGeometry(w, h, d, o.segs || 1, 1, o.segs || 1);
      return api.geo(kind, g, placeMatrix(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0), rgb, o);
    },
    cyl(kind, rt, rb, h, x, y, z, rgb, o = {}) {
      const g = new THREE.CylinderGeometry(rt, rb, h, o.seg || 10, 1, !!o.open);
      return api.geo(kind, g, placeMatrix(x, y, z, o.rx || 0, o.ry || 0, o.rz || 0), rgb, o);
    },
    finish(parent) {
      for (const [, b] of buckets) {
        if (!b.list.length) continue;
        const merged = mergeGeometries(b.list, false);
        for (const g of b.list) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, material(b.kind));
        mesh.castShadow = !b.noShadow && !opts.noShadow; mesh.receiveShadow = true;
        mesh.name = name + ':' + b.kind;
        group.add(mesh);
      }
      (parent || ctx.scene).add(group);
      buckets.clear();
      return group;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// Colliders. Rotated walls become a chain of axis-aligned boxes; doorways are simply gaps.
// ---------------------------------------------------------------------------------------------
export function wallCollider(world, x0, z0, x1, z1, y0, y1, thick, extra = {}) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 0.01) return;
  const axisAligned = Math.abs(dx) < 0.03 || Math.abs(dz) < 0.03;
  const n = axisAligned ? 1 : Math.max(1, Math.ceil(L / 0.9));
  const h = thick / 2;
  for (let i = 0; i < n; i++) {
    const ax = x0 + dx * (i / n), az = z0 + dz * (i / n), bx = x0 + dx * ((i + 1) / n), bz = z0 + dz * ((i + 1) / n);
    const minx = Math.min(ax, bx) - h, maxx = Math.max(ax, bx) + h, minz = Math.min(az, bz) - h, maxz = Math.max(az, bz) + h;
    world.addBox((minx + maxx) / 2, (y0 + y1) / 2, (minz + maxz) / 2, maxx - minx, y1 - y0, maxz - minz, extra);
  }
}
// a rotated rectangular slab (floor) as strips so the top is walkable everywhere inside
export function slabCollider(world, cx, cz, w, d, ry, top, thick, extra = {}) {
  if (Math.abs(ry) < 0.01) { world.addBox(cx, top - thick / 2, cz, w, thick, d, extra); return; }
  const c = Math.cos(ry), s = Math.sin(ry);
  const n = Math.max(2, Math.ceil(w / 0.8));
  for (let i = 0; i < n; i++) {
    const u0 = -w / 2 + (w * i) / n, u1 = -w / 2 + (w * (i + 1)) / n;
    const pts = [[u0, -d / 2], [u1, -d / 2], [u0, d / 2], [u1, d / 2]];
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const [u, v] of pts) { const x = cx + u * c + v * s, z = cz - u * s + v * c; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    world.addBox((minx + maxx) / 2, top - thick / 2, (minz + maxz) / 2, maxx - minx, thick, maxz - minz, extra);
  }
}
// axis box collider for a rotated small object: take its rotated AABB
export function objCollider(world, cx, cy, cz, w, h, d, ry, extra = {}) {
  const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
  world.addBox(cx, cy, cz, w * c + d * s, h, w * s + d * c, extra);
}
// terrain sampling under a rotated footprint
export function footprint(world, cx, cz, w, d, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  let min = Infinity, max = -Infinity;
  const nu = Math.max(2, Math.ceil(w)), nv = Math.max(2, Math.ceil(d));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = -w / 2 + (w * i) / nu, v = -d / 2 + (d * j) / nv;
    const h = world.getHeight(cx + u * c + v * s, cz - u * s + v * c);
    if (h < min) min = h; if (h > max) max = h;
  }
  return { min, max };
}
// local (u,v) in a rotated frame -> world (x,z)
export function frame(cx, cz, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return { x: (u, v) => cx + u * c + v * s, z: (u, v) => cz - u * s + v * c, ry, cx, cz };
}

// ---------------------------------------------------------------------------------------------
// Instancing, wires, registries
// ---------------------------------------------------------------------------------------------
const _c = new THREE.Color();
// InstancedMesh from a list of matrices (+ optional per-instance tints)
export function instanced(ctx, kind, geometry, matrices, tints, opts = {}) {
  if (!matrices.length) return null;
  normalizeGeo(geometry);
  if (!geometry.attributes.color) colorize(geometry, opts.rgb || [1, 1, 1], { jitter: 0 });
  const mesh = new THREE.InstancedMesh(geometry, material(kind, opts.matOpts || {}), matrices.length);
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
    if (tints) { const t = tints[i]; mesh.setColorAt(i, _c.setRGB(t[0], t[1], t[2])); }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = !opts.noShadow; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = opts.name || kind + '-instances';
  (opts.parent || ctx.scene).add(mesh);
  return mesh;
}

// Sagging wires: all spans of a site in one LineSegments; a vertex attribute lets the shader sway them.
let wireMaterial = null;
function getWireMaterial() {
  if (wireMaterial) return wireMaterial;
  wireMaterial = new THREE.LineBasicMaterial({ color: 0x17150f, transparent: true, opacity: 0.85 });
  wireMaterial.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway; uniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(uTime * 0.9 + position.z * 0.15 + position.x * 0.07) * 0.09 * aSway; transformed.y += sin(uTime * 1.7 + position.x * 0.21) * 0.05 * aSway;');
  };
  wireMaterial.customProgramCacheKey = () => 'radius-wire';
  return wireMaterial;
}
export function createWires(ctx) {
  const pts = [], sway = [];
  const api = {
    // catenary-ish span between two points with sag (m); segments
    span(a, b, sag = 0.6, n = 14) {
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        for (const t of [t0, t1]) {
          const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
          pts.push(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
          sway.push(4 * t * (1 - t));
        }
      }
    },
    // a wire hanging from a point to the ground (broken line)
    drop(a, groundPt, n = 8) {
      for (let i = 0; i < n; i++) {
        for (const t of [i / n, (i + 1) / n]) {
          const tt = t * t;
          pts.push(a.x + (groundPt.x - a.x) * t, a.y + (groundPt.y - a.y) * (1 - (1 - t) * (1 - t)) - 0.3 * Math.sin(t * Math.PI), a.z + (groundPt.z - a.z) * t);
          sway.push((1 - tt) * 0.5);
        }
      }
    },
    finish(name = 'wires') {
      if (!pts.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      g.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(sway), 1));
      g.computeBoundingSphere();
      const l = new THREE.LineSegments(g, getWireMaterial()); l.name = name; l.frustumCulled = true;
      ctx.scene.add(l); return l;
    },
  };
  return api;
}

// Wooden power pole geometry (shared by the village line and the road line)
export function poleGeometry(withArm = true) {
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.11, 0.16, 7.2, 8); pole.translate(0, 3.6, 0); colorize(pole, [0.36, 0.30, 0.22], { jitter: 0.1, ground: 0, dampH: 1.5 }); parts.push(pole);
  if (withArm) {
    const arm = new THREE.BoxGeometry(1.7, 0.1, 0.1); arm.translate(0, 6.6, 0); colorize(arm, [0.33, 0.28, 0.2], { jitter: 0 }); parts.push(arm);
    for (const u of [-0.7, 0, 0.7]) { const ins = new THREE.CylinderGeometry(0.05, 0.07, 0.16, 6); ins.translate(u, 6.75, 0); colorize(ins, [0.62, 0.62, 0.58], { jitter: 0 }); parts.push(ins); }
    const brace = new THREE.BoxGeometry(0.06, 0.9, 0.06); brace.rotateZ(0.6); brace.translate(-0.4, 6.15, 0); colorize(brace, [0.33, 0.28, 0.2], { jitter: 0 }); parts.push(brace);
  }
  for (const p of parts) normalizeGeo(p);
  return mergeGeometries(parts, false);
}
// A line of poles following a polyline with sagging wires; returns matrices used
export function poleLine(ctx, world, pts, wires, opts = {}) {
  const spacing = opts.spacing || 30, side = opts.side || 4.5, rnd = opts.rnd || Math.random;
  const mats = [], tops = [];
  let total = 0; for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  const n = Math.floor(total / spacing);
  for (let i = 0; i <= n; i++) {
    const t = Math.min(0.999, (i * spacing + spacing * 0.35) / total);
    const p = pointOnPolyline(pts, t);
    const px = -p.dz, pz = p.dx;   // perpendicular
    const x = p.x + px * side + (rnd() - 0.5) * 1.2, z = p.z + pz * side + (rnd() - 0.5) * 1.2;
    const y = world.getHeight(x, z) - 0.2;
    const tilt = (rnd() - 0.5) * 0.12 * (rnd() < 0.25 ? 3 : 1);
    const yaw = Math.atan2(p.dx, p.dz) + Math.PI / 2 + (rnd() - 0.5) * 0.2;
    mats.push(placeMatrix(x, y, z, tilt, yaw, tilt * 0.5));
    world.addCylinder(x, z, 0.18, y, y + 7, { surface: 'wood', tag: opts.tag || 'poles' });
    tops.push([V3(x + Math.cos(yaw) * 0.7 - Math.sin(tilt) * 6.6, y + 6.8, z - Math.sin(yaw) * 0.7), V3(x - Math.cos(yaw) * 0.7 - Math.sin(tilt) * 6.6, y + 6.8, z + Math.sin(yaw) * 0.7), V3(x - Math.sin(tilt) * 6.6, y + 6.8, z)]);
  }
  for (let i = 0; i < tops.length - 1; i++) {
    const cut = rnd() < (opts.cutChance ?? 0.12);
    for (let w = 0; w < 3; w++) {
      if (cut && w === 1) { const g = tops[i][w].clone(); g.x += (rnd() - 0.5) * 6; g.z += (rnd() - 0.5) * 6; g.y = world.getHeight(g.x, g.z) + 0.05; wires.drop(tops[i][w], g); continue; }
      wires.span(tops[i][w], tops[i + 1][w], 0.8 + rnd() * 0.5);
    }
  }
  return mats;
}

// Sandbag geometry (a squashed rounded box) and a ring/line layout
export function sandbagGeometry() {
  const g = new THREE.SphereGeometry(0.5, 8, 6);
  g.scale(0.62, 0.22, 0.4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const f = 1 + 0.12 * Math.sin(x * 9) * Math.cos(z * 7); p.setXYZ(i, x * f, y * (1 + 0.15 * Math.cos(x * 6)), z * f); }
  g.computeVertexNormals();
  colorize(g, [0.52, 0.47, 0.35], { jitter: 0 });
  return g;
}
export function sandbagWall(world, pts, rows, rnd, opts = {}) {
  // pts: polyline; bags along it, `rows` courses high, staggered
  const mats = [], tints = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 0.62));
    const yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    for (let r = 0; r < rows; r++) {
      const nn = n - (r % 2 === 1 ? 1 : 0);
      for (let i = 0; i < nn; i++) {
        if (r > 0 && rnd() < 0.08 * r) continue;
        const t = (i + 0.5 + (r % 2) * 0.5) / n;
        const x = ax + (bx - ax) * t + (rnd() - 0.5) * 0.06, z = az + (bz - az) * t + (rnd() - 0.5) * 0.06;
        const y = (opts.base ?? world.getHeight(x, z)) + 0.11 + r * 0.2;
        mats.push(placeMatrix(x, y, z, (rnd() - 0.5) * 0.1, yaw + (rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.12));
        const tn = 0.85 + rnd() * 0.3; tints.push([tn, tn * (0.97 + rnd() * 0.05), tn * (0.9 + rnd() * 0.1)]);
      }
    }
    if (opts.collide !== false) wallCollider(world, ax, az, bx, bz, (opts.base ?? world.getHeight(ax, az)) - 0.5, (opts.base ?? world.getHeight(ax, az)) + rows * 0.2 + 0.1, 0.55, { surface: 'mud', tag: opts.tag });
  }
  return { mats, tints };
}

// Registry helpers
export function addCover(world, x, z, y) { world.coverPoints.push(V3(x, y ?? world.getHeight(x, z), z)); }
export function addSpawn(world, poiId, kind, x, z, y) { world.spawnSpots.push({ position: V3(x, y ?? world.getHeight(x, z), z), poi: poiId, kind }); }
export function addLoot(world, poiId, kind, x, z, y) { world.lootSpots.push({ position: V3(x, y ?? world.getHeight(x, z), z), poi: poiId, kind }); }
export function addHide(world, poiId, x, z, y) { world.hidingSpots.push({ position: V3(x, y ?? world.getHeight(x, z), z), poi: poiId }); }

// ---------------------------------------------------------------------------------------------
// Building recipes
// ---------------------------------------------------------------------------------------------
// A wall along local u in a frame F, from u0..u1 at v, height y0..y1, thickness t, with openings
// [{u0,u1,y0,y1}] cut out (door: y0 = floor). Emits geometry + colliders for every solid piece.
export function wall(B, world, F, kind, rgb, u0, u1, v, y0, y1, t, openings = [], o = {}) {
  const pieces = [];   // [ua, ub, ya, yb]
  // Openings clipped to the wall; anything wholly outside it is not an opening.
  const ops = [];
  for (const op of openings) {
    const a = Math.max(u0, op.u0), b = Math.min(u1, op.u1), c = Math.max(y0, op.y0), d = Math.min(y1, op.y1);
    if (b - a > 0.01 && d - c > 0.01) ops.push({ u0: a, u1: b, y0: c, y1: d });
  }
  // Split into columns at every opening edge, so the set of openings crossing a column is constant, then
  // fill each column with the bands between them. Sweeping left to right with one cursor instead only ever
  // cut one opening per column: on a two-storey wall the upper window's sill ran from the floor all the way
  // up to it, bricking the window below solid behind its own frame and glass.
  const cuts = [u0, u1];
  for (const op of ops) cuts.push(op.u0, op.u1);
  cuts.sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const ua = cuts[i], ub = cuts[i + 1];
    if (ub - ua <= 0.01) continue;
    const um = (ua + ub) / 2;
    const bands = ops.filter((op) => op.u0 <= um && op.u1 >= um).map((op) => [op.y0, op.y1]).sort((a, b) => a[0] - b[0]);
    let ya = y0;
    for (const [ba, bb] of bands) { if (ba > ya) pieces.push([ua, ub, ya, ba]); ya = Math.max(ya, bb); }
    if (ya < y1) pieces.push([ua, ub, ya, y1]);
  }
  for (const [ua, ub, ya, yb] of pieces) {
    const w = ub - ua, h = yb - ya; if (w <= 0.01 || h <= 0.01) continue;
    const um = (ua + ub) / 2;
    B.box(kind, w, h, t, F.x(um, v), (ya + yb) / 2, F.z(um, v), rgb, { ry: F.ry, ground: o.ground ?? y0, jitter: o.jitter ?? 0.05, seed: o.seed });
    if (o.collide !== false) {
      const ax = F.x(ua, v), az = F.z(ua, v), bx = F.x(ub, v), bz = F.z(ub, v);
      wallCollider(world, ax, az, bx, bz, ya, yb, t, { surface: o.surface || (kind === 'log' || kind === 'plank' ? 'wood' : kind === 'metal' || kind === 'corrugated' ? 'metal' : 'concrete'), tag: o.tag });
    }
  }
}
// window dressing inside an opening: dark glass (maybe broken) and a painted frame
export function windowDress(B, F, u0, u1, v, y0, y1, t, rnd, o = {}) {
  const um = (u0 + u1) / 2, w = u1 - u0, h = y1 - y0;
  const fc = o.frame || [0.55, 0.66, 0.70];
  const fk = o.frameKind || 'paint';
  const fw = 0.09;
  B.box(fk, w + fw * 2, fw, t + 0.04, F.x(um, v), y1 + fw / 2, F.z(um, v), fc, { ry: F.ry, jitter: 0.08 });
  B.box(fk, w + fw * 2, fw, t + 0.04, F.x(um, v), y0 - fw / 2, F.z(um, v), fc, { ry: F.ry, jitter: 0.08 });
  B.box(fk, fw, h, t + 0.04, F.x(u0 - fw / 2, v), (y0 + y1) / 2, F.z(u0 - fw / 2, v), fc, { ry: F.ry, jitter: 0.08 });
  B.box(fk, fw, h, t + 0.04, F.x(u1 + fw / 2, v), (y0 + y1) / 2, F.z(u1 + fw / 2, v), fc, { ry: F.ry, jitter: 0.08 });
  B.box(fk, 0.05, h, 0.05, F.x(um, v), (y0 + y1) / 2, F.z(um, v), fc, { ry: F.ry, jitter: 0.08 });
  B.box(fk, w, 0.05, 0.05, F.x(um, v), (y0 + y1) / 2, F.z(um, v), fc, { ry: F.ry, jitter: 0.08 });
  const broken = rnd() < (o.broken ?? 0.45);
  if (!broken) B.box('glass', w - 0.02, h - 0.02, 0.02, F.x(um, v), (y0 + y1) / 2, F.z(um, v), [0.12, 0.14, 0.13], { ry: F.ry, jitter: 0, noShadow: true });
  else if (rnd() < 0.6) {
    // a shard of pane left in a corner
    const sw = w * (0.25 + rnd() * 0.3), sh = h * (0.3 + rnd() * 0.3);
    B.box('glass', sw, sh, 0.02, F.x(u0 + sw / 2, v), y1 - sh / 2, F.z(u0 + sw / 2, v), [0.12, 0.14, 0.13], { ry: F.ry, jitter: 0, noShadow: true });
  }
  if (o.shutters) {
    const sc = o.shutterColor || [0.32, 0.40, 0.42];
    const sw = w * 0.5;
    const lean = o.shutterSag ? 0.35 : 0;
    B.box('plank', sw, h + 0.1, 0.04, F.x(u0 - fw - sw / 2, v - t / 2 - 0.03), (y0 + y1) / 2, F.z(u0 - fw - sw / 2, v - t / 2 - 0.03), sc, { ry: F.ry, jitter: 0.1 });
    if (!o.shutterMissing) B.box('plank', sw, h + 0.1, 0.04, F.x(u1 + fw + sw / 2, v - t / 2 - 0.03), (y0 + y1) / 2 - lean * 0.3, F.z(u1 + fw + sw / 2, v - t / 2 - 0.03), sc, { ry: F.ry, rz: lean, jitter: 0.1 });
  }
}
// Sagging gable roof panel: a thin box with segments along the ridge, dipped in the middle, tilted by pitch
export function roofPanel(B, kind, rgb, F, uc, vc, ridgeY, halfSpan, length, pitch, side, sag, o = {}) {
  const slope = halfSpan / Math.cos(pitch);
  const g = new THREE.BoxGeometry(length, o.thick || 0.12, slope, 8, 1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const t = x / length + 0.5;
    p.setY(i, p.getY(i) - sag * Math.sin(t * Math.PI) * (0.5 + 0.5 * (0.5 - z / slope)) - (o.warp || 0) * Math.sin(t * 7.3) * 0.15);
  }
  g.computeVertexNormals();
  // tilt about the ridge: rotate around x by pitch*side, then offset so the top edge sits on the ridge
  g.translate(0, 0, side * slope / 2);
  g.rotateX(side * pitch);   // the far (eave) edge drops
  B.geo(kind, g, placeMatrix(F.x(uc, vc), ridgeY, F.z(uc, vc), 0, F.ry, 0), rgb, { jitter: o.jitter ?? 0.06, seed: o.seed });
}
// A triangular gable end (prism)
export function gableEnd(B, kind, rgb, F, u, v, y0, halfSpan, height, t, o = {}) {
  const shape = new THREE.Shape(); shape.moveTo(-halfSpan, 0); shape.lineTo(halfSpan, 0); shape.lineTo(0, height); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  // the triangle spans the v (depth) axis; its thickness runs along u
  B.geo(kind, g, placeMatrix(F.x(u, v), y0, F.z(u, v), 0, F.ry + Math.PI / 2, 0), rgb, { jitter: o.jitter ?? 0.05, ground: y0 - 3, seed: o.seed });
}
// Wheel: a dark rubber tyre with a rim, lying on its axle along local x
export function wheel(B, x, y, z, r, w, ry, o = {}) {
  const rubber = o.burnt ? [0.10, 0.10, 0.10] : [0.14, 0.14, 0.135];
  B.cyl('metal', r, r, w, x, y, z, rubber, { rx: Math.PI / 2, ry, seg: 14, jitter: 0.04 });   // axle across the vehicle (local v)
  B.cyl('metal', r * 0.55, r * 0.55, w + 0.04, x, y, z, o.rim || [0.34, 0.33, 0.30], { rx: Math.PI / 2, ry, seg: 10, jitter: 0.05 });
}

// URAL-style truck: long bonnet cab, flatbed with canvas hoops. F frame at the truck centre, facing +u.
export function truck(B, world, F, y, rnd, o = {}) {
  const tag = o.tag; const paint = o.paint || [0.34, 0.40, 0.29];
  const ry = F.ry;
  const P = (u, v) => [F.x(u, v), F.z(u, v)];
  // chassis rails
  let [x, z] = P(0, 0); B.box('metal', 7.2, 0.25, 1.0, x, y + 0.85, z, [0.16, 0.15, 0.14], { ry, jitter: 0.05 });
  // cab
  [x, z] = P(2.55, 0); B.box('metal', 1.6, 1.25, 2.3, x, y + 1.95, z, paint, { ry, jitter: 0.05, ground: y + 0.9 });
  [x, z] = P(3.85, 0); B.box('metal', 1.4, 0.85, 2.1, x, y + 1.55, z, paint, { ry, jitter: 0.05, ground: y + 0.9 });   // bonnet
  [x, z] = P(4.58, 0); B.box('metal', 0.1, 0.9, 1.6, x, y + 1.5, z, [0.12, 0.12, 0.11], { ry, jitter: 0 });   // grille
  [x, z] = P(3.36, 0); B.box('glass', 0.06, 0.7, 1.9, x, y + 2.15, z, [0.12, 0.14, 0.13], { ry, rz: -0.25, noShadow: true });   // windscreen
  [x, z] = P(2.55, 0); B.box('metal', 1.7, 0.08, 2.4, x, y + 2.62, z, paint, { ry, jitter: 0.05 });   // roof
  // bed + hoops + canvas
  [x, z] = P(-1.4, 0); B.box('plank', 4.4, 0.16, 2.3, x, y + 1.25, z, [0.33, 0.28, 0.20], { ry, jitter: 0.05 });
  for (const side of [-1, 1]) { [x, z] = P(-1.4, side * 1.12); B.box('plank', 4.4, 0.5, 0.06, x, y + 1.55, z, [0.35, 0.30, 0.21], { ry, jitter: 0.08 }); }
  if (!o.noCanvas) {
    const hoopMats = [];
    for (let i = 0; i < 4; i++) { const [hx, hz] = P(-3.2 + i * 1.2, 0); B.geo('metal', new THREE.TorusGeometry(1.15, 0.03, 5, 14, Math.PI), placeMatrix(hx, y + 1.75, hz, 0, ry + Math.PI / 2, 0), [0.25, 0.22, 0.2], { jitter: 0 }); }
    const cg = new THREE.CylinderGeometry(1.18, 1.18, 4.0, 16, 6, true, 0, Math.PI);
    cg.rotateZ(Math.PI / 2); cg.rotateX(0); cg.rotateY(Math.PI / 2);
    // aFlap: free edges flap
    const fp = new Float32Array(cg.attributes.position.count);
    const uvs = cg.attributes.uv;
    for (let i = 0; i < fp.length; i++) { const uu = uvs.getX(i), vv = uvs.getY(i); fp[i] = Math.pow(Math.abs(uu - 0.5) * 2, 2) * 0.8 + Math.pow(Math.abs(vv - 0.5) * 2, 3) * 0.5; }
    cg.setAttribute('aFlap', new THREE.BufferAttribute(fp, 1));
    const [cx, cz] = P(-1.4, 0);
    cg.applyMatrix4(placeMatrix(cx, y + 1.75, cz, 0, ry + Math.PI / 2, 0));
    colorize(cg, o.canvas || [0.36, 0.36, 0.25], { jitter: 0.03 });
    const cm = new THREE.Mesh(cg, material('canvas')); cm.castShadow = true; cm.receiveShadow = true; cm.name = 'canvas';
    ctx_scene(B).add(cm);
  }
  // wheels: 3 axles
  for (const u of [2.9, -0.6, -2.0]) for (const side of [-1, 1]) { const [wx, wz] = P(u, side * 1.05); wheel(B, wx, y + 0.62, wz, 0.62, 0.36, ry, { burnt: o.burnt }); }
  // exhaust, mirrors, spare
  [x, z] = P(1.6, 1.2); B.cyl('metal', 0.05, 0.05, 2.4, x, y + 2.0, z, [0.2, 0.18, 0.16], { seg: 6 });
  [x, z] = P(-3.7, 0); B.box('metal', 0.15, 0.55, 2.2, x, y + 1.0, z, [0.16, 0.15, 0.14], { ry });
  // collider + cover/hiding
  objCollider(world, F.x(0.2, 0), y + 1.4, F.z(0.2, 0), 7.4, 2.6, 2.5, ry, { surface: 'metal', tag });
  for (const side of [-1, 1]) addCover(world, F.x(0, side * 2.3), F.z(0, side * 2.3));
  addHide(world, o.poi, F.x(-1.2, 0), F.z(-1.2, 0));
}
function ctx_scene(B) { return B.group; }

// UAZ-469: boxy jeep, soft top rotted to the frame
export function uaz(B, world, F, y, rnd, o = {}) {
  const ry = F.ry, paint = o.burnt ? [0.27, 0.25, 0.23] : (o.paint || [0.35, 0.40, 0.30]);
  const P = (u, v) => [F.x(u, v), F.z(u, v)];
  let [x, z] = P(0, 0); B.box('metal', 3.9, 0.55, 1.75, x, y + 0.85, z, paint, { ry, jitter: 0.05, ground: y + 0.6 });
  [x, z] = P(1.3, 0); B.box('metal', 1.3, 0.35, 1.7, x, y + 1.28, z, paint, { ry, jitter: 0.05 });   // bonnet
  [x, z] = P(0.55, 0); B.box('glass', 0.05, 0.5, 1.55, x, y + 1.55, z, [0.12, 0.14, 0.13], { ry, rz: -0.2, noShadow: true });
  for (const side of [-1, 1]) { [x, z] = P(-0.6, side * 0.83); B.box('metal', 2.2, 0.3, 0.06, x, y + 1.28, z, paint, { ry, jitter: 0.05 }); }
  // frame hoops of the soft top
  for (const u of [0.45, -0.5, -1.5]) { [x, z] = P(u, 0); B.geo('metal', new THREE.TorusGeometry(0.85, 0.025, 5, 12, Math.PI), placeMatrix(x, y + 1.35, z, 0, ry + Math.PI / 2, 0), [0.2, 0.18, 0.16], { jitter: 0 }); }
  [x, z] = P(2.0, 0); B.box('metal', 0.08, 0.5, 1.5, x, y + 1.05, z, [0.14, 0.13, 0.12], { ry });
  for (const u of [1.3, -1.25]) for (const side of [-1, 1]) { const [wx, wz] = P(u, side * 0.8); wheel(B, wx, y + 0.42, wz, 0.42, 0.24, ry, { burnt: o.burnt }); }
  [x, z] = P(-2.0, 0.6); B.cyl('metal', 0.34, 0.34, 0.22, x, y + 1.0, z, [0.1, 0.1, 0.1], { ry, rz: Math.PI / 2, seg: 12 });   // spare on the back
  objCollider(world, F.x(0, 0), y + 0.9, F.z(0, 0), 4.0, 1.4, 1.9, ry, { surface: 'metal', tag: o.tag });
  for (const side of [-1, 1]) addCover(world, F.x(0, side * 1.7), F.z(0, side * 1.7));
}

// BTR-like hull: elongated, sloped sides, eight wheels, a small turret
export function btr(B, world, F, y, rnd, o = {}) {
  const ry = F.ry, paint = o.paint || [0.28, 0.32, 0.22];
  const P = (u, v) => [F.x(u, v), F.z(u, v)];
  const hull = new THREE.BoxGeometry(7.2, 1.1, 2.6, 1, 1, 1);
  const hp = hull.attributes.position;
  for (let i = 0; i < hp.count; i++) { const px = hp.getX(i), py = hp.getY(i), pz = hp.getZ(i); if (py > 0) hp.setZ(i, pz * 0.72); if (px > 3.0 && py > 0) hp.setX(i, px - 0.8); if (px > 3.0 && py < 0) hp.setX(i, px - 0.2); }
  hull.computeVertexNormals();
  let [x, z] = P(0, 0); B.geo('metal', hull, placeMatrix(x, y + 1.35, z, 0, ry, 0), paint, { jitter: 0.04, ground: y + 0.9 });
  [x, z] = P(-0.4, 0); B.box('metal', 6.4, 0.5, 2.9, x, y + 0.75, z, paint, { ry, jitter: 0.04, ground: y + 0.6 });   // lower hull
  [x, z] = P(1.0, 0); B.cyl('metal', 0.55, 0.62, 0.45, x, y + 2.1, z, paint, { seg: 12, jitter: 0.04 });   // turret
  [x, z] = P(1.9, 0.12); B.cyl('metal', 0.04, 0.05, 1.6, x, y + 2.15, z, [0.15, 0.14, 0.13], { rz: Math.PI / 2, ry: ry + (o.gunYaw || 0.4), seg: 6 });
  for (const u of [2.5, 1.3, -1.0, -2.2]) for (const side of [-1, 1]) { const [wx, wz] = P(u, side * 1.3); wheel(B, wx, y + 0.55, wz, 0.55, 0.32, ry); }
  // hatches open
  [x, z] = P(-1.5, 0.5); B.box('metal', 0.6, 0.04, 0.6, x, y + 2.15, z, paint, { ry, rx: 1.2, jitter: 0.04 });
  objCollider(world, F.x(0, 0), y + 1.2, F.z(0, 0), 7.2, 2.4, 3.0, ry, { surface: 'metal', tag: o.tag });
  for (const side of [-1, 1]) addCover(world, F.x(0.5, side * 2.4), F.z(0.5, side * 2.4));
  addCover(world, F.x(-4.5, 0), F.z(-4.5, 0));
}

// Rusted crawler tractor (DT-75 silhouette)
export function tractor(B, world, F, y, o = {}) {
  const ry = F.ry, paint = o.paint || [0.55, 0.22, 0.12];
  const P = (u, v) => [F.x(u, v), F.z(u, v)];
  let [x, z] = P(0.4, 0); B.box('metal', 2.4, 0.8, 1.0, x, y + 1.15, z, paint, { ry, jitter: 0.05, ground: y + 0.7 });   // hood
  [x, z] = P(-1.1, 0); B.box('metal', 1.2, 1.3, 1.3, x, y + 1.75, z, paint, { ry, jitter: 0.05 });   // cab
  [x, z] = P(-1.1, 0); B.box('metal', 1.3, 0.06, 1.45, x, y + 2.42, z, paint, { ry, jitter: 0.05 });
  [x, z] = P(-0.45, 0); B.box('glass', 0.04, 0.6, 1.1, x, y + 1.9, z, [0.12, 0.14, 0.13], { ry, noShadow: true });
  [x, z] = P(1.1, 0.3); B.cyl('metal', 0.05, 0.05, 1.1, x, y + 2.1, z, [0.15, 0.14, 0.13], { seg: 6 });
  for (const side of [-1, 1]) {
    [x, z] = P(0, side * 0.85); B.box('metal', 3.4, 0.5, 0.42, x, y + 0.45, z, [0.16, 0.15, 0.14], { ry, jitter: 0.05 });   // tracks
    for (const u of [1.3, -1.3]) { const [wx, wz] = P(u, side * 0.85); B.cyl('metal', 0.36, 0.36, 0.3, wx, y + 0.42, wz, [0.22, 0.2, 0.18], { rx: Math.PI / 2, ry, seg: 10 }); }
  }
  objCollider(world, F.x(-0.2, 0), y + 1.2, F.z(-0.2, 0), 3.6, 2.4, 2.2, ry, { surface: 'metal', tag: o.tag });
  for (const side of [-1, 1]) addCover(world, F.x(0, side * 2.0), F.z(0, side * 2.0));
}

// PAZ-style bus: long box body, window strip, tilted into a ditch
export function bus(B, world, F, y, rnd, o = {}) {
  const ry = F.ry, paint = o.paint || [0.62, 0.58, 0.40], roll = o.roll || 0;
  const P = (u, v) => [F.x(u, v), F.z(u, v)];
  let [x, z] = P(0, 0);
  B.box('metal', 7.6, 1.0, 2.4, x, y + 1.05, z, paint, { ry, rx: roll, jitter: 0.05, ground: y + 0.7 });   // lower body
  B.box('metal', 7.6, 0.3, 2.4, x, y + 2.35, z, paint, { ry, rx: roll, jitter: 0.05 });   // above windows
  B.box('metal', 7.7, 0.12, 2.5, x, y + 2.55, z, [0.5, 0.5, 0.46], { ry, rx: roll, jitter: 0.05 });   // roof
  // window pillars + glass strip
  for (let i = -3; i <= 3; i++) { const [px, pz] = P(i * 1.1, 0); B.box('metal', 0.1, 0.75, 2.42, px, y + 1.92, pz, paint, { ry, rx: roll, jitter: 0.05 }); }
  for (const side of [-1, 1]) { const [gx, gz] = P(0.3, side * 1.19); B.box('glass', 6.0, 0.7, 0.02, gx, y + 1.9, gz, [0.12, 0.14, 0.13], { ry, rx: roll, noShadow: true }); }
  [x, z] = P(3.85, 0); B.box('glass', 0.03, 0.8, 2.1, x, y + 1.9, z, [0.12, 0.14, 0.13], { ry, rx: roll, noShadow: true });
  [x, z] = P(-3.85, 0); B.box('metal', 0.1, 1.9, 2.2, x, y + 1.5, z, paint, { ry, rx: roll, jitter: 0.05 });
  for (const u of [2.5, -2.3]) for (const side of [-1, 1]) { const [wx, wz] = P(u, side * 1.05); wheel(B, wx, y + 0.5, wz, 0.5, 0.28, ry); }
  objCollider(world, F.x(0, 0), y + 1.4, F.z(0, 0), 7.8, 2.8, 2.6, ry, { surface: 'metal', tag: o.tag });
  for (const side of [-1, 1]) addCover(world, F.x(0, side * 2.2), F.z(0, side * 2.2));
  addHide(world, o.poi || 'marsh', F.x(-2.5, 0), F.z(-2.5, 0));
}

// ---------------------------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------------------------
const LOG = [0.42, 0.35, 0.26], LOG_DARK = [0.30, 0.25, 0.18], PLANK = [0.45, 0.40, 0.31], PLANK_GREY = [0.40, 0.39, 0.35];
const TRIM = [[0.55, 0.66, 0.70], [0.62, 0.62, 0.55], [0.40, 0.55, 0.45], [0.66, 0.60, 0.42]];
const CONC = [0.43, 0.42, 0.40];

// Log house (izba). F: frame at the house centre, +u along the ridge, door on the -v (street) side or an end.
// Returns { floorY, door: {x,z}, interiorSpots }
export function izba(B, world, F, rnd, o = {}) {
  const tag = o.tag, poiId = o.poi || 'zarya';
  const W = o.w || 7.5, D = o.d || 6.0, wallH = 2.6, t = 0.26;
  const fp = footprint(world, F.cx, F.cz, W + 1, D + 1, F.ry);
  const floorY = fp.max + (o.raise ?? 0.32);
  const plinthY0 = fp.min - 0.6;
  const trim = TRIM[Math.floor(rnd() * TRIM.length)];
  const logTint = [LOG[0] * (0.9 + rnd() * 0.2), LOG[1] * (0.9 + rnd() * 0.2), LOG[2] * (0.9 + rnd() * 0.2)];
  // plinth (fieldstone) and floor
  B.box('stone', W + 0.2, floorY - 0.12 - plinthY0, D + 0.2, F.cx, (floorY - 0.12 + plinthY0) / 2, F.cz, [0.40, 0.39, 0.36], { ry: F.ry, jitter: 0.08, ground: plinthY0 + 0.6 });
  B.box('plank', W - 0.1, 0.12, D - 0.1, F.cx, floorY - 0.06, F.cz, [0.36, 0.31, 0.23], { ry: F.ry, jitter: 0.04 });
  slabCollider(world, F.cx, F.cz, W + 0.2, D + 0.2, F.ry, floorY, floorY - plinthY0, { surface: 'wood', tag });
  const y0 = floorY, y1 = floorY + wallH;
  // door: on the -v side by default (street), 1.3 wide, offset toward one end
  const doorU = o.doorU ?? (W / 2 - 1.9) * (rnd() < 0.5 ? -1 : 1);
  const doorSide = o.doorSide ?? -1;
  const dv = doorSide * D / 2;
  const winH0 = y0 + 0.95, winH1 = y0 + 2.05;
  // walls
  const frontWins = [];
  for (let k = -1; k <= 1; k++) { const u = k * (W / 4 + 0.15) + (rnd() - 0.5) * 0.3; if (Math.abs(u - doorU) > 1.4 && Math.abs(u) < W / 2 - 1.1) frontWins.push(u); }
  const fOps = frontWins.map((u) => ({ u0: u - 0.5, u1: u + 0.5, y0: winH0, y1: winH1 }));
  fOps.push({ u0: doorU - 0.65, u1: doorU + 0.65, y0: y0, y1: y0 + 2.25 });
  const back = [{ u0: -1.6, u1: -0.6, y0: winH0, y1: winH1 }, { u0: 1.2, u1: 2.2, y0: winH0, y1: winH1 }].filter((w) => w.u1 < W / 2 - 0.6 && w.u0 > -W / 2 + 0.6);
  const sideOps = [{ u0: -0.5, u1: 0.5, y0: winH0, y1: winH1 }];
  // long walls at v = ±D/2
  wall(B, world, F, 'log', logTint, -W / 2, W / 2, dv, y0, y1, t, fOps, { tag, ground: y0 - 0.3, seed: rnd() * 100 });
  wall(B, world, F, 'log', logTint, -W / 2, W / 2, -dv, y0, y1, t, back, { tag, ground: y0 - 0.3, seed: rnd() * 100 });
  // end walls along v at u = ±W/2 (use a rotated frame)
  const Fe = frame(F.cx, F.cz, F.ry + Math.PI / 2);
  // in Fe, local u runs along old v; old (u=W/2, v) -> Fe (u = -v? ) compute: Fe.x(a,b) = cx + a cos(ry+90) + b sin(ry+90) = cx - a sin + b cos ; want F.x(W/2, v) = cx + (W/2) cos + v sin -> a = -v, b = W/2
  wall(B, world, Fe, 'log', logTint, -D / 2, D / 2, W / 2, y0, y1, t, sideOps, { tag, ground: y0 - 0.3, seed: rnd() * 100 });
  wall(B, world, Fe, 'log', logTint, -D / 2, D / 2, -W / 2, y0, y1, t, sideOps, { tag, ground: y0 - 0.3, seed: rnd() * 100 });
  // window dressing
  for (const w of fOps.slice(0, -1)) windowDress(B, F, w.u0, w.u1, dv, w.y0, w.y1, t, rnd, { frame: trim, shutters: true, shutterSag: rnd() < 0.3, shutterMissing: rnd() < 0.3 });
  for (const w of back) windowDress(B, F, w.u0, w.u1, -dv, w.y0, w.y1, t, rnd, { frame: trim });
  for (const w of sideOps) { windowDress(B, Fe, w.u0, w.u1, W / 2, w.y0, w.y1, t, rnd, { frame: trim }); windowDress(B, Fe, w.u0, w.u1, -W / 2, w.y0, w.y1, t, rnd, { frame: trim }); }
  // door frame + leaf hanging open
  const dfc = [trim[0] * 0.8, trim[1] * 0.8, trim[2] * 0.8];
  for (const s of [-1, 1]) B.box('plank', 0.1, 2.3, t + 0.06, F.x(doorU + s * 0.7, dv), y0 + 1.15, F.z(doorU + s * 0.7, dv), dfc, { ry: F.ry, jitter: 0.05 });
  B.box('plank', 1.5, 0.1, t + 0.06, F.x(doorU, dv), y0 + 2.3, F.z(doorU, dv), dfc, { ry: F.ry, jitter: 0.05 });
  if (rnd() < 0.7) {
    const open = 0.9 + rnd() * 1.2;
    const Fd = frame(F.x(doorU - 0.6, dv + doorSide * 0.12), F.z(doorU - 0.6, dv + doorSide * 0.12), F.ry + open * doorSide);
    B.box('plank', 1.15, 2.15, 0.05, Fd.x(0.58, 0), y0 + 1.08, Fd.z(0.58, 0), [0.38, 0.32, 0.22], { ry: Fd.ry, jitter: 0.05 });
  }
  // roof: ridge along u, sagging, overhang
  const pitch = 0.62 + rnd() * 0.12, half = D / 2 + 0.45, ridgeY = y1 + Math.tan(pitch) * half;
  const roofKind = rnd() < 0.45 ? 'corrugated' : 'plank';
  const roofC = roofKind === 'corrugated' ? [0.42, 0.40, 0.36] : PLANK_GREY;
  const sag = 0.18 + rnd() * 0.25;
  for (const side of [-1, 1]) roofPanel(B, roofKind, roofC, F, 0, 0, ridgeY, half, W + 1.0, pitch, side, sag, { seed: rnd() * 100, warp: 1 });
  B.box('plank', W + 1.1, 0.14, 0.2, F.cx, ridgeY + 0.02 - sag * 0.5, F.cz, [0.36, 0.32, 0.25], { ry: F.ry, jitter: 0 });
  for (const s of [-1, 1]) gableEnd(B, 'plank', PLANK, F, s * (W / 2 - 0.02), 0, y1 - 0.02, D / 2 + 0.02, Math.tan(pitch) * half - 0.1, 0.16, { seed: rnd() * 100 });
  // roof collider (approximate as a low box above the walls so bullets stop; not walkable in practice)
  objCollider(world, F.cx, ridgeY - 0.7, F.cz, W + 0.6, 1.2, D * 0.5, F.ry, { surface: 'wood', tag, noAvoid: true });
  // chimney
  const chU = (rnd() - 0.5) * W * 0.4;
  B.box('brick', 0.6, 1.5, 0.6, F.x(chU, 0.4), ridgeY + 0.35, F.z(chU, 0.4), [0.9, 0.9, 0.9], { ry: F.ry, jitter: 0 });
  // porch: platform at floor level, steps down to ground, canopy on two posts
  const pv = dv + doorSide * 0.9;
  const px = F.x(doorU, pv), pz = F.z(doorU, pv);
  B.box('plank', 1.8, 0.14, 1.5, px, floorY - 0.07, pz, PLANK, { ry: F.ry, jitter: 0.05 });
  slabCollider(world, px, pz, 1.8, 1.5, F.ry, floorY, 0.6, { surface: 'wood', tag });
  const gAt = world.getHeight(F.x(doorU, dv + doorSide * 2.2), F.z(doorU, dv + doorSide * 2.2));
  // treads butt against the porch edge (0.75 out) and each other, and are deeper than the player capsule radius:
  // a tread shallower than 0.35 lets the capsule touch the riser after next before the ground test lifts it
  const rise = floorY - gAt; const nSteps = rise > 0.2 ? Math.ceil(rise / 0.42) : 0;
  for (let i = 1; i <= nSteps; i++) {
    const sy = floorY - (rise * i) / nSteps; const sv = pv + doorSide * (0.75 + 0.46 * i - 0.23);
    B.box('plank', 1.8, 0.12, 0.46, F.x(doorU, sv), sy - 0.06, F.z(doorU, sv), PLANK, { ry: F.ry, jitter: 0.06 });
    slabCollider(world, F.x(doorU, sv), F.z(doorU, sv), 1.8, 0.46, F.ry, sy, 0.5, { surface: 'wood', tag });
  }
  for (const s of [-1, 1]) B.box('plank', 0.12, 2.3, 0.12, F.x(doorU + s * 0.8, pv + doorSide * 0.6), floorY + 1.15, F.z(doorU + s * 0.8, pv + doorSide * 0.6), PLANK, { ry: F.ry, jitter: 0.05 });
  B.box('plank', 2.0, 0.08, 1.9, F.x(doorU, pv + doorSide * 0.15), floorY + 2.4, F.z(doorU, pv + doorSide * 0.15), PLANK_GREY, { ry: F.ry, rx: doorSide * 0.28, jitter: 0.05 });
  // interior furniture
  const inner = interiorIzba(B, world, F, floorY, W, D, doorU, doorSide, rnd, tag, poiId);
  // registries
  addSpawn(world, poiId, 'interior', F.x(0, 0), F.z(0, 0), floorY);
  addSpawn(world, poiId, 'exterior', F.x(-W / 2 - 2.5, D / 2 + 1), F.z(-W / 2 - 2.5, D / 2 + 1));
  addCover(world, F.x(W / 2 + 0.9, -D / 2 - 0.4), F.z(W / 2 + 0.9, -D / 2 - 0.4));
  addCover(world, F.x(-W / 2 - 0.9, D / 2 + 0.4), F.z(-W / 2 - 0.9, D / 2 + 0.4));
  addHide(world, poiId, F.x(W / 2 + 1.0, D / 2 + 1.0), F.z(W / 2 + 1.0, D / 2 + 1.0));
  return { floorY, door: { x: F.x(doorU, dv + doorSide * 2.5), z: F.z(doorU, dv + doorSide * 2.5), inside: { x: F.x(doorU, dv - doorSide * 1.2), z: F.z(doorU, dv - doorSide * 1.2) } } };
}
function interiorIzba(B, world, F, y, W, D, doorU, doorSide, rnd, tag, poiId) {
  const back = -doorSide;   // v sign of the back wall
  // stove: a whitewashed brick mass in a corner away from the door
  const su = doorU > 0 ? -W / 2 + 1.0 : W / 2 - 1.0, sv = back * (D / 2 - 0.95);
  B.box('brick', 1.5, 1.9, 1.5, F.x(su, sv), y + 0.95, F.z(su, sv), [1.35, 1.32, 1.25], { ry: F.ry, jitter: 0.02 });
  B.box('metal', 0.5, 0.42, 0.1, F.x(su, sv - back * 0.78), y + 0.55, F.z(su, sv - back * 0.78), [0.05, 0.05, 0.05], { ry: F.ry });   // firebox mouth
  objCollider(world, F.x(su, sv), y + 0.95, F.z(su, sv), 1.5, 1.9, 1.5, F.ry, { surface: 'concrete', tag });
  // table + bench under the front windows, at the stove end so the door path stays clear
  const tu = su * 0.5, tv = -back * (D / 2 - 1.3);
  B.box('plank', 1.4, 0.06, 0.8, F.x(tu, tv), y + 0.76, F.z(tu, tv), [0.44, 0.38, 0.28], { ry: F.ry, jitter: 0.05 });
  for (const [a, b] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) B.box('plank', 0.07, 0.74, 0.07, F.x(tu + a, tv + b), y + 0.37, F.z(tu + a, tv + b), [0.38, 0.33, 0.24], { ry: F.ry, jitter: 0 });
  objCollider(world, F.x(tu, tv), y + 0.4, F.z(tu, tv), 1.4, 0.8, 0.8, F.ry, { surface: 'wood', tag });
  B.box('plank', 1.5, 0.05, 0.3, F.x(tu, tv + back * 0.75), y + 0.45, F.z(tu, tv + back * 0.75), [0.42, 0.36, 0.26], { ry: F.ry, jitter: 0.05 });
  objCollider(world, F.x(tu, tv + back * 0.75), y + 0.25, F.z(tu, tv + back * 0.75), 1.5, 0.5, 0.3, F.ry, { surface: 'wood', tag });
  // small things on the table: a tin cup, a plate
  B.cyl('metal', 0.05, 0.04, 0.1, F.x(tu + 0.3, tv - 0.15), y + 0.84, F.z(tu + 0.3, tv - 0.15), [0.6, 0.6, 0.58], { seg: 8 });
  B.cyl('paint', 0.14, 0.12, 0.02, F.x(tu - 0.35, tv + 0.1), y + 0.8, F.z(tu - 0.35, tv + 0.1), [0.85, 0.85, 0.8], { seg: 10 });
  // bed along the back wall opposite the stove
  const bu = -su * 0.9, bv = back * (D / 2 - 0.6);
  B.box('metal', 1.9, 0.08, 0.9, F.x(bu, bv), y + 0.42, F.z(bu, bv), [0.30, 0.32, 0.30], { ry: F.ry, jitter: 0.05 });
  B.box('canvas', 1.8, 0.18, 0.85, F.x(bu, bv), y + 0.55, F.z(bu, bv), [0.42, 0.40, 0.33], { ry: F.ry, jitter: 0.05 });
  for (const e of [-0.9, 0.9]) B.box('metal', 0.05, 0.9, 0.9, F.x(bu + e, bv), y + 0.5, F.z(bu + e, bv), [0.30, 0.32, 0.30], { ry: F.ry });
  objCollider(world, F.x(bu, bv), y + 0.35, F.z(bu, bv), 1.9, 0.7, 0.9, F.ry, { surface: 'wood', tag });
  // shelves on the end wall (loot)
  const shU = (doorU > 0 ? 1 : -1) * (W / 2 - 0.16), shV = back * 0.6;
  for (let i = 0; i < 3; i++) B.box('plank', 0.3, 0.04, 1.4, F.x(shU, shV), y + 1.1 + i * 0.42, F.z(shU, shV), [0.42, 0.37, 0.27], { ry: F.ry, jitter: 0.05 });
  for (let i = 0; i < 4; i++) { const jv = shV + (rnd() - 0.5) * 1.1, jy = y + 1.1 + Math.floor(rnd() * 3) * 0.42; B.cyl('glass', 0.06, 0.06, 0.16 + rnd() * 0.08, F.x(shU, jv), jy + 0.1, F.z(shU, jv), [0.35, 0.38, 0.25], { seg: 8, noShadow: true }); }
  addLoot(world, poiId, 'shelf', F.x(shU - Math.sign(shU) * 0.35, shV), F.z(shU - Math.sign(shU) * 0.35, shV), y + 1.2);
  addLoot(world, poiId, 'floor', F.x(bu, bv - back * 1.0), F.z(bu, bv - back * 1.0), y);
  // a stool, a bucket
  B.box('plank', 0.35, 0.04, 0.35, F.x(tu + 1.2, tv + 0.2), y + 0.45, F.z(tu + 1.2, tv + 0.2), [0.4, 0.35, 0.25], { ry: F.ry + 0.4, jitter: 0.05 });
  for (const [a, b] of [[-0.13, -0.13], [0.13, 0.13], [-0.13, 0.13]]) B.box('plank', 0.05, 0.45, 0.05, F.x(tu + 1.2 + a, tv + 0.2 + b), y + 0.22, F.z(tu + 1.2 + a, tv + 0.2 + b), [0.38, 0.33, 0.24], { ry: F.ry, jitter: 0 });
  B.cyl('metal', 0.16, 0.13, 0.3, F.x(su + 1.1, sv), y + 0.15, F.z(su + 1.1, sv), [0.4, 0.4, 0.38], { seg: 10, open: true });
  // cover inside: behind the stove, the window pillars
  addCover(world, F.x(su, sv - back * 1.6), F.z(su, sv - back * 1.6), y);
}

// Collapsed izba: roof down, two walls tilted, the chimney standing alone in the rubble.
export function ruinIzba(B, world, F, rnd, o = {}) {
  const tag = o.tag, poiId = o.poi || 'zarya';
  const W = o.w || 7.0, D = o.d || 5.6;
  const fp = footprint(world, F.cx, F.cz, W + 1, D + 1, F.ry);
  const y = fp.max + 0.25;
  B.box('stone', W + 0.2, y - 0.1 - (fp.min - 0.6), D + 0.2, F.cx, (y - 0.1 + fp.min - 0.6) / 2, F.cz, [0.40, 0.39, 0.36], { ry: F.ry, jitter: 0.08 });
  slabCollider(world, F.cx, F.cz, W + 0.2, D + 0.2, F.ry, y, 1.2, { surface: 'wood', tag });
  const dark = [0.26, 0.22, 0.16];
  // one standing end wall (partial) and one long wall leaning outward
  const Fe = frame(F.cx, F.cz, F.ry + Math.PI / 2);
  wall(B, world, Fe, 'log', dark, -D / 2, D / 2, W / 2, y, y + 2.4, 0.26, [{ u0: -0.5, u1: 0.5, y0: y + 0.95, y1: y + 2.05 }], { tag, ground: y - 0.3, seed: rnd() * 100 });
  B.box('log', W, 2.2, 0.26, F.x(0, -D / 2 - 0.35), y + 0.95, F.z(0, -D / 2 - 0.35), dark, { ry: F.ry, rx: -0.42, jitter: 0.06, ground: y });
  objCollider(world, F.x(0, -D / 2 - 0.5), y + 0.9, F.z(0, -D / 2 - 0.5), W, 1.8, 1.2, F.ry, { surface: 'wood', tag });
  B.box('log', W * 0.45, 1.1, 0.26, F.x(-W * 0.25, D / 2), y + 0.55, F.z(-W * 0.25, D / 2), dark, { ry: F.ry, jitter: 0.06, ground: y });
  objCollider(world, F.x(-W * 0.25, D / 2), y + 0.55, F.z(-W * 0.25, D / 2), W * 0.45, 1.1, 0.3, F.ry, { surface: 'wood', tag });
  // fallen roof panels lying across the footprint
  const g1 = new THREE.BoxGeometry(W * 0.9, 0.12, D * 0.62, 6, 1, 2);
  B.geo('plank', g1, placeMatrix(F.x(0.4, 0.2), y + 1.0, F.z(0.4, 0.2), 0.32, F.ry + 0.08, 0.05), PLANK_GREY, { jitter: 0.06 });
  const g2 = new THREE.BoxGeometry(W * 0.5, 0.12, D * 0.55, 4, 1, 2);
  B.geo('corrugated', g2, placeMatrix(F.x(-W * 0.3, -0.5), y + 0.45, F.z(-W * 0.3, -0.5), -0.5, F.ry - 0.3, 0.1), [0.42, 0.40, 0.36], { jitter: 0.06 });
  objCollider(world, F.x(0.4, 0.2), y + 0.9, F.z(0.4, 0.2), W * 0.8, 1.2, D * 0.5, F.ry, { surface: 'wood', tag, noAvoid: true });
  // loose beams
  for (let i = 0; i < 6; i++) {
    const u = (rnd() - 0.5) * W * 0.8, v = (rnd() - 0.5) * D * 0.8;
    B.cyl('log', 0.11, 0.13, 3 + rnd() * 3, F.x(u, v), y + 0.3 + rnd() * 0.8, F.z(u, v), dark, { rx: (rnd() - 0.5) * 0.6, ry: rnd() * Math.PI, rz: Math.PI / 2 + (rnd() - 0.5) * 0.5, seg: 7, jitter: 0.1 });
  }
  // chimney still standing
  B.box('brick', 0.7, 4.2, 0.7, F.x(W * 0.18, D * 0.15), y + 2.1, F.z(W * 0.18, D * 0.15), [0.95, 0.92, 0.9], { ry: F.ry, jitter: 0, ground: y });
  objCollider(world, F.x(W * 0.18, D * 0.15), y + 2.1, F.z(W * 0.18, D * 0.15), 0.7, 4.2, 0.7, F.ry, { surface: 'concrete', tag });
  addHide(world, poiId, F.x(-W * 0.25, D / 2 + 0.9), F.z(-W * 0.25, D / 2 + 0.9));
  addHide(world, poiId, F.x(0, -D / 2 - 1.5), F.z(0, -D / 2 - 1.5));
  addCover(world, F.x(W / 2 + 0.8, 0), F.z(W / 2 + 0.8, 0));
  addSpawn(world, poiId, 'hidden', F.x(-1, 1), F.z(-1, 1), y);
  addLoot(world, poiId, 'floor', F.x(W * 0.18 + 1.2, D * 0.15), F.z(W * 0.18 + 1.2, D * 0.15), y);
}

// Plank barn with a big double door (one leaf down), stalls inside, a cart
export function barn(B, world, F, rnd, o = {}) {
  const tag = o.tag, poiId = o.poi || 'zarya';
  const W = 14, D = 8, H = 3.4, t = 0.16;
  const fp = footprint(world, F.cx, F.cz, W + 1, D + 1, F.ry);
  const y = fp.max + 0.18;
  B.box('stone', W + 0.3, y - 0.05 - (fp.min - 0.6), D + 0.3, F.cx, (y - 0.05 + fp.min - 0.6) / 2, F.cz, [0.40, 0.39, 0.36], { ry: F.ry, jitter: 0.08 });
  B.box('plank', W, 0.1, D, F.cx, y - 0.05, F.cz, [0.30, 0.26, 0.19], { ry: F.ry, jitter: 0.04 });
  slabCollider(world, F.cx, F.cz, W + 0.3, D + 0.3, F.ry, y, 1.5, { surface: 'wood', tag });
  const c = [0.38, 0.33, 0.25];
  const gap = { u0: -1.6, u1: 1.6, y0: y, y1: y + 3.0 };
  wall(B, world, F, 'plank', c, -W / 2, W / 2, -D / 2, y, y + H, t, [gap, { u0: 4.2, u1: 5.2, y0: y + 1.6, y1: y + 2.4 }], { tag, ground: y - 0.3, seed: 1 });
  wall(B, world, F, 'plank', c, -W / 2, W / 2, D / 2, y, y + H, t, [{ u0: -4.5, u1: -1.5, y0: y + 0.4, y1: y + 2.6 }], { tag, ground: y - 0.3, seed: 2 });   // a hole where planks fell
  const Fe = frame(F.cx, F.cz, F.ry + Math.PI / 2);
  wall(B, world, Fe, 'plank', c, -D / 2, D / 2, W / 2, y, y + H, t, [], { tag, ground: y - 0.3, seed: 3 });
  wall(B, world, Fe, 'plank', c, -D / 2, D / 2, -W / 2, y, y + H, t, [{ u0: -0.6, u1: 0.6, y0: y, y1: y + 2.2 }], { tag, ground: y - 0.3, seed: 4 });
  steps(B, world, F.x(0, -D / 2 - 0.1), F.z(0, -D / 2 - 0.1), -Math.sin(F.ry), -Math.cos(F.ry), y, 3.4, tag);
  // door leaves: one hanging, one on the ground
  B.box('plank', 1.6, 2.9, 0.08, F.x(-2.3, -D / 2 - 0.5), y + 1.4, F.z(-2.3, -D / 2 - 0.5), c, { ry: F.ry + 1.1, jitter: 0.05 });
  objCollider(world, F.x(-2.3, -D / 2 - 0.5), y + 1.4, F.z(-2.3, -D / 2 - 0.5), 1.4, 2.9, 1.2, F.ry, { surface: 'wood', tag });
  B.box('plank', 1.6, 0.08, 2.9, F.x(2.2, -D / 2 - 1.9), y + 0.06, F.z(2.2, -D / 2 - 1.9), c, { ry: F.ry + 0.3, jitter: 0.05 });
  // roof
  const pitch = 0.5, half = D / 2 + 0.5, ridgeY = y + H + Math.tan(pitch) * half;
  for (const side of [-1, 1]) roofPanel(B, 'corrugated', [0.40, 0.38, 0.34], F, 0, 0, ridgeY, half, W + 1, pitch, side, 0.35, { warp: 1, seed: 7 + side });
  for (const s of [-1, 1]) gableEnd(B, 'plank', c, F, s * (W / 2 - 0.02), 0, y + H - 0.02, D / 2, Math.tan(pitch) * half - 0.1, 0.16);
  objCollider(world, F.cx, ridgeY - 0.9, F.cz, W, 1.5, D * 0.5, F.ry, { surface: 'metal', tag, noAvoid: true });
  // roof-support posts, stalls, hayloft edge
  for (const u of [-4.5, 0, 4.5]) for (const v of [-2.2, 2.2]) { B.box('log', 0.22, H, 0.22, F.x(u, v), y + H / 2, F.z(u, v), LOG_DARK, { ry: F.ry }); objCollider(world, F.x(u, v), y + H / 2, F.z(u, v), 0.22, H, 0.22, F.ry, { surface: 'wood', tag }); }
  for (const u of [-5.5, -3.5, 3.5, 5.5]) { B.box('plank', 0.06, 1.2, 2.4, F.x(u, D / 2 - 1.3), y + 0.6, F.z(u, D / 2 - 1.3), c, { ry: F.ry, jitter: 0.06 }); objCollider(world, F.x(u, D / 2 - 1.3), y + 0.6, F.z(u, D / 2 - 1.3), 0.1, 1.2, 2.4, F.ry, { surface: 'wood', tag }); }
  // cart
  const cu = 3.5, cv = -1.5;
  B.box('plank', 2.6, 0.5, 1.3, F.x(cu, cv), y + 0.95, F.z(cu, cv), [0.4, 0.34, 0.24], { ry: F.ry + 0.25, jitter: 0.05 });
  for (const s of [-1, 1]) B.cyl('plank', 0.6, 0.6, 0.08, F.x(cu, cv + s * 0.72), y + 0.6, F.z(cu, cv + s * 0.72), [0.36, 0.30, 0.22], { rx: Math.PI / 2, ry: F.ry + 0.25, seg: 12 });
  B.cyl('plank', 0.05, 0.05, 2.6, F.x(cu + 2.0, cv), y + 0.5, F.z(cu + 2.0, cv), [0.38, 0.33, 0.24], { rz: Math.PI / 2 + 0.25, ry: F.ry + 0.25, seg: 6 });
  objCollider(world, F.x(cu, cv), y + 0.7, F.z(cu, cv), 2.8, 1.2, 1.6, F.ry, { surface: 'wood', tag });
  // crates
  for (let i = 0; i < 3; i++) { const u = -5.5 + i * 0.8, v = -2.8 + (rnd() - 0.5) * 0.5; B.box('plank', 0.7, 0.6, 0.7, F.x(u, v), y + 0.3, F.z(u, v), [0.42, 0.36, 0.25], { ry: F.ry + (rnd() - 0.5) * 0.4, jitter: 0.08 }); objCollider(world, F.x(u, v), y + 0.3, F.z(u, v), 0.75, 0.6, 0.75, F.ry, { surface: 'wood', tag }); }
  addLoot(world, poiId, 'crate', F.x(-5.0, -1.9), F.z(-5.0, -1.9), y);
  addLoot(world, poiId, 'floor', F.x(4.5, 2.5), F.z(4.5, 2.5), y);
  addSpawn(world, poiId, 'interior', F.x(0, 0), F.z(0, 0), y);
  addSpawn(world, poiId, 'interior', F.x(5, 1), F.z(5, 1), y);
  addCover(world, F.x(0, -2.2 + 0.9), F.z(0, -2.2 + 0.9), y);
  addCover(world, F.x(cu - 2.0, cv), F.z(cu - 2.0, cv), y);
  addCover(world, F.x(-W / 2 - 0.9, -D / 2 - 0.6), F.z(-W / 2 - 0.9, -D / 2 - 0.6));
  addCover(world, F.x(W / 2 + 0.9, D / 2 + 0.6), F.z(W / 2 + 0.9, D / 2 + 0.6));
  addHide(world, poiId, F.x(cu, cv), F.z(cu, cv), y);
  addHide(world, poiId, F.x(-4.0, 3.0), F.z(-4.0, 3.0), y);
  return { y };
}

export function well(B, world, x, z, rnd, tag) {
  const y = world.getHeight(x, z);
  const ry = rnd() * Math.PI;
  const F = frame(x, z, ry);
  for (let i = 0; i < 4; i++) { const yy = y + 0.12 + i * 0.22; for (const s of [-1, 1]) { B.cyl('log', 0.1, 0.1, 1.4, F.x(0, s * 0.55), yy, F.z(0, s * 0.55), LOG_DARK, { rz: Math.PI / 2, ry, seg: 7 }); B.cyl('log', 0.1, 0.1, 1.4, F.x(s * 0.55, 0), yy + 0.11, F.z(s * 0.55, 0), LOG_DARK, { rz: Math.PI / 2, ry: ry + Math.PI / 2, seg: 7 }); } }
  for (const s of [-1, 1]) B.box('log', 0.14, 2.3, 0.14, F.x(s * 0.75, 0), y + 1.15, F.z(s * 0.75, 0), LOG_DARK, { ry });
  B.cyl('log', 0.12, 0.12, 1.6, x, y + 1.7, z, LOG_DARK, { rz: Math.PI / 2, ry, seg: 8 });   // windlass
  B.box('metal', 0.05, 0.4, 0.05, F.x(0.85, 0), y + 1.55, F.z(0.85, 0), [0.2, 0.18, 0.16], { ry, rz: 0.3 });
  B.box('plank', 2.0, 0.06, 1.2, x, y + 2.35, z, PLANK_GREY, { ry, rx: 0.5 });
  B.box('plank', 2.0, 0.06, 1.2, x, y + 2.35, z, PLANK_GREY, { ry, rx: -0.5 });
  B.cyl('metal', 0.13, 0.11, 0.26, F.x(0.2, 0.3), y + 1.05, F.z(0.2, 0.3), [0.4, 0.4, 0.38], { seg: 9, open: true });
  world.addBox(x, y + 0.5, z, 1.5, 1.0, 1.5, { surface: 'wood', tag });
  addCover(world, x + 1.3, z + 0.4);
}

export function busStop(B, world, x, z, ry, rnd, tag) {
  const F = frame(x, z, ry);
  const y = footprint(world, x, z, 4.5, 2.5, ry).max + 0.05;
  const band = (px, py, pz) => (py > y + 0.9 && py < y + 1.7 ? [0.55, 0.85, 0.9] : [1, 1, 1]);
  B.box('concrete', 4.2, 2.5, 0.16, F.x(0, 0.9), y + 1.25, F.z(0, 0.9), CONC, { ry, ground: y, fn: band, jitter: 0.03 });
  for (const s of [-1, 1]) B.box('concrete', 0.16, 2.5, 1.9, F.x(s * 2.0, 0), y + 1.25, F.z(s * 2.0, 0), CONC, { ry, ground: y, fn: band, jitter: 0.03 });
  B.box('concrete', 4.6, 0.18, 2.5, x, y + 2.55, z, CONC, { ry, jitter: 0.03 });
  B.box('concrete', 4.5, 0.18, 2.3, x, y + 0.03, z, [0.4, 0.4, 0.38], { ry, jitter: 0.03 });
  B.box('plank', 3.2, 0.06, 0.4, F.x(0, 0.55), y + 0.5, F.z(0, 0.55), [0.36, 0.30, 0.22], { ry, jitter: 0.06 });
  for (const s of [-1, 1]) B.box('concrete', 0.3, 0.42, 0.3, F.x(s * 1.4, 0.55), y + 0.24, F.z(s * 1.4, 0.55), CONC, { ry });
  wallCollider(world, F.x(-2.1, 0.9), F.z(-2.1, 0.9), F.x(2.1, 0.9), F.z(2.1, 0.9), y - 0.5, y + 2.6, 0.2, { tag });
  for (const s of [-1, 1]) wallCollider(world, F.x(s * 2.0, -0.95), F.z(s * 2.0, -0.95), F.x(s * 2.0, 0.9), F.z(s * 2.0, 0.9), y - 0.5, y + 2.6, 0.2, { tag });
  objCollider(world, F.x(0, 0.55), y + 0.25, F.z(0, 0.55), 3.2, 0.5, 0.4, ry, { surface: 'wood', tag });
  slabCollider(world, x, z, 4.5, 2.3, ry, y + 0.12, 0.6, { surface: 'concrete', tag });
  addCover(world, F.x(-2.6, 0), F.z(-2.6, 0));
  addCover(world, F.x(2.6, 0), F.z(2.6, 0));
  addSpawn(world, 'zarya', 'exterior', F.x(0, -3), F.z(0, -3));
}

export function plinth(B, world, x, z, rnd, tag) {
  const y = world.getHeight(x, z) + 0.05;
  const ry = rnd() * 0.3;
  B.box('concrete', 3.0, 0.4, 3.0, x, y + 0.2, z, CONC, { ry, ground: y, jitter: 0.03 });
  B.box('concrete', 2.0, 1.3, 2.0, x, y + 1.05, z, [0.46, 0.45, 0.43], { ry, ground: y + 0.4, jitter: 0.03 });
  B.box('concrete', 2.3, 0.15, 2.3, x, y + 1.75, z, CONC, { ry, jitter: 0.03 });
  for (const [a, b] of [[-0.25, 0.1], [0.28, -0.05]]) B.cyl('metal', 0.03, 0.03, 0.5, x + a, y + 2.0, z + b, [0.3, 0.2, 0.12], { rx: (rnd() - 0.5) * 0.6, rz: (rnd() - 0.5) * 0.6, seg: 5 });
  B.box('concrete', 0.7, 0.18, 0.5, x + 0.1, y + 1.9, z - 0.1, [0.5, 0.49, 0.47], { ry: ry + 0.2, jitter: 0 });   // the boots
  world.addBox(x, y + 0.2, z, 3.1, 0.4, 3.1, { tag, surface: 'concrete' });
  world.addBox(x, y + 1.1, z, 2.2, 1.6, 2.2, { tag, surface: 'concrete' });
  addCover(world, x + 1.8, z + 0.3); addCover(world, x - 1.8, z - 0.4);
}

// broken picket fence along a polyline, instanced pickets + merged rails
export function picketFence(B, world, pts, rnd, pickets, tag) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const L = Math.hypot(bx - ax, bz - az); const yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const nPost = Math.max(2, Math.ceil(L / 2.4));
    const gone = rnd() < 0.25;   // a whole section missing
    for (let i = 0; i <= nPost; i++) {
      const x = ax + dx * (i / nPost) * L, z = az + dz * (i / nPost) * L, y = world.getHeight(x, z);
      if (gone && i > 0 && i < nPost) continue;
      B.box('plank', 0.1, 1.25, 0.1, x, y + 0.5, z, [0.36, 0.32, 0.24], { ry: yaw, rz: (rnd() - 0.5) * 0.15, jitter: 0.1 });
    }
    if (gone) continue;
    const n = Math.floor(L / 0.19);
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.18) continue;
      const t = (i + 0.5) / n; const x = ax + dx * t * L, z = az + dz * t * L, y = world.getHeight(x, z);
      const lean = (rnd() - 0.5) * (rnd() < 0.1 ? 0.9 : 0.12);
      pickets.mats.push(placeMatrix(x, y + 0.45 - Math.abs(lean) * 0.2, z, lean * 0.3, yaw, lean));
      const tn = 0.8 + rnd() * 0.4; pickets.tints.push([tn, tn, tn]);
    }
    for (const h of [0.35, 0.85]) B.box('plank', L, 0.05, 0.04, (ax + bx) / 2, (world.getHeight(ax, az) + world.getHeight(bx, bz)) / 2 + h, (az + bz) / 2, [0.36, 0.32, 0.24], { ry: yaw, jitter: 0.08, noShadow: true });
    wallCollider(world, ax, az, bx, bz, world.getHeight(ax, az) - 0.5, world.getHeight(ax, az) + 0.9, 0.12, { surface: 'wood', tag, blocksBullets: false, passable: false });
  }
}

// ---------------------------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------------------------
function roadFrame(road, t) { const p = pointOnPolyline(road.pts, t); return { x: p.x, z: p.z, dx: p.dx, dz: p.dz, yaw: Math.atan2(p.dx, p.dz) }; }
// frame rotation whose +u axis runs along the road direction (frame u axis is (cos ry, -sin ry))
const roadRy = (p) => Math.atan2(-p.dz, p.dx);
// a flight of stone steps from a sill point outward along (dx,dz) down to the terrain, each rise <= 0.4
export function steps(B, world, x, z, dx, dz, topY, width, tag, kind = 'stone') {
  const gAt = world.getHeight(x + dx * 1.2, z + dz * 1.2);
  const rise = topY - gAt; if (rise < 0.2) return;
  const n = Math.ceil(rise / 0.4); const ry = Math.atan2(-dz, dx);
  for (let i = 1; i <= n; i++) {
    const sy = topY - (rise * i) / n, u = 0.46 * (i - 0.5) - 0.12;   // treads deeper than the capsule radius; the first tucks under the sill
    const sx = x + dx * u, sz = z + dz * u;
    B.box(kind, 0.46, 0.5, width, sx, sy - 0.25, sz, [0.42, 0.41, 0.38], { ry, jitter: 0.06 });
    objCollider(world, sx, sy - 0.25, sz, 0.46, 0.5, width, ry, { surface: 'concrete', tag });
  }
}
// perpendicular offset from a road point: side +1 = right of travel direction
function roadOff(p, side, along = 0) { return { x: p.x + (-p.dz) * side + p.dx * along, z: p.z + p.dx * side + p.dz * along }; }
// intersection of segments a-b and c-d ([x,z] pairs) -> { x, z, rdx, rdz (unit a-b), ldx, ldz (unit c-d) } | null
function segmentHit(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]]; const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  const rl = Math.hypot(r[0], r[1]), sl = Math.hypot(s[0], s[1]);
  return { x: a[0] + r[0] * t, z: a[1] + r[1] * t, rdx: r[0] / rl, rdz: r[1] / rl, ldx: s[0] / sl, ldz: s[1] / sl };
}

export function buildCheckpoint(ctx, world, rnd, sandbags) {
  const B = createBuilder(ctx, 'checkpoint'); const tag = 'checkpoint';
  const road = ROADS[0];
  const c = roadFrame(road, distToPolyline(22, 212, road.pts).t);
  const F = frame(c.x, c.z, roadRy(c));   // +u along the road, +v to its right
  B._world = world;
  const g = (u, v) => world.getHeight(F.x(u, v), F.z(u, v));
  // concrete blocks: a chicane of jersey-ish blocks staggered across the road
  const blocks = [[-9, -1.6], [-6.5, -1.9], [-3, 1.5], [-0.5, 1.8], [3, -1.7], [6, 1.6], [8.5, 1.9]];
  for (const [u, v] of blocks) {
    const x = F.x(u, v), z = F.z(u, v), y = world.getHeight(x, z);
    const ry = F.ry + (rnd() - 0.5) * 0.35;
    B.box('concrete', 1.7, 0.85, 0.75, x, y + 0.42, z, CONC, { ry, rz: (rnd() - 0.5) * 0.05, ground: y, jitter: 0.06 });
    B.box('concrete', 1.7, 0.2, 0.55, x, y + 0.95, z, [0.47, 0.46, 0.44], { ry, jitter: 0.06 });
    objCollider(world, x, y + 0.5, z, 1.7, 1.05, 0.75, ry, { surface: 'concrete', tag });
    addCover(world, F.x(u, v + (v > 0 ? 0.9 : -0.9)), F.z(u, v + (v > 0 ? 0.9 : -0.9)));
  }
  // striped barrier pole on a counterweight pivot, half raised (animated elsewhere: static here)
  const bp = { x: F.x(1.2, -3.6), z: F.z(1.2, -3.6) }; const by = world.getHeight(bp.x, bp.z);
  B.box('metal', 0.3, 1.2, 0.3, bp.x, by + 0.6, bp.z, [0.35, 0.36, 0.34], { ry: F.ry, ground: by });
  B.box('concrete', 0.9, 0.3, 0.9, bp.x, by + 0.15, bp.z, CONC, { ry: F.ry });
  world.addBox(bp.x, by + 0.6, bp.z, 0.6, 1.2, 0.6, { tag });
  const pole = new THREE.CylinderGeometry(0.05, 0.06, 6.0, 8); pole.rotateZ(Math.PI / 2); pole.translate(2.7, 0, 0);
  colorize(pole, [1, 1, 1], { jitter: 0, fn: (px) => (Math.floor((px + 0.3) / 0.6) % 2 === 0 ? [0.72, 0.12, 0.10] : [0.8, 0.78, 0.72]) });
  normalizeGeo(pole);
  const poleMesh = new THREE.Mesh(pole, material('paint')); poleMesh.castShadow = true;
  poleMesh.position.set(bp.x, by + 1.15, bp.z); poleMesh.rotation.set(0, F.ry + Math.PI, 0.35); B.group.add(poleMesh);
  B.box('metal', 0.5, 0.5, 0.5, bp.x - Math.cos(F.ry + Math.PI) * 0.6, by + 1.0, bp.z + Math.sin(F.ry + Math.PI) * 0.6, [0.2, 0.2, 0.19], { ry: F.ry });
  // guard booth: enterable, 2.6 x 2.6, brick base, plank upper, a window strip
  const bu = -2.5, bv = -5.2; const Fb = frame(F.x(bu, bv), F.z(bu, bv), F.ry + (rnd() - 0.5) * 0.2);
  const bfp = footprint(world, Fb.cx, Fb.cz, 3.2, 3.2, Fb.ry); const byy = bfp.max + 0.12;
  B.box('concrete', 3.0, byy - bfp.min + 0.5, 3.0, Fb.cx, (byy + bfp.min - 0.5) / 2, Fb.cz, CONC, { ry: Fb.ry, jitter: 0.04 });
  slabCollider(world, Fb.cx, Fb.cz, 3.0, 3.0, Fb.ry, byy, 1.0, { surface: 'concrete', tag });
  const bw = [0.44, 0.40, 0.31];
  // road-facing wall (+v) is a window strip; the door is on the east side wall; a small window at the back
  wall(B, world, Fb, 'plank', bw, -1.4, 1.4, 1.4, byy, byy + 2.5, 0.12, [{ u0: -1.0, u1: 1.0, y0: byy + 1.0, y1: byy + 1.9 }], { tag, ground: byy, seed: 3 });
  wall(B, world, Fb, 'plank', bw, -1.4, 1.4, -1.4, byy, byy + 2.5, 0.12, [{ u0: -0.3, u1: 0.3, y0: byy + 1.3, y1: byy + 1.9 }], { tag, ground: byy, seed: 4 });
  const Fbe = frame(Fb.cx, Fb.cz, Fb.ry + Math.PI / 2);
  wall(B, world, Fbe, 'plank', bw, -1.4, 1.4, 1.4, byy, byy + 2.5, 0.12, [{ u0: -0.9, u1: 0.9, y0: byy + 1.0, y1: byy + 1.9 }], { tag, ground: byy, seed: 5 });
  wall(B, world, Fbe, 'plank', bw, -1.4, 1.4, -1.4, byy, byy + 2.5, 0.12, [{ u0: -0.65, u1: 0.65, y0: byy, y1: byy + 2.2 }], { tag, ground: byy, seed: 6 });
  windowDress(B, Fb, -1.0, 1.0, 1.4, byy + 1.0, byy + 1.9, 0.12, rnd, { frame: [0.5, 0.5, 0.46], broken: 0.6 });
  windowDress(B, Fbe, -0.9, 0.9, 1.4, byy + 1.0, byy + 1.9, 0.12, rnd, { frame: [0.5, 0.5, 0.46], broken: 0.6 });
  windowDress(B, Fb, -0.3, 0.3, -1.4, byy + 1.3, byy + 1.9, 0.12, rnd, { frame: [0.5, 0.5, 0.46], broken: 0.3 });
  B.box('plank', 1.2, 2.15, 0.05, Fbe.x(-0.55, -1.75), byy + 1.08, Fbe.z(-0.55, -1.75), [0.40, 0.36, 0.28], { ry: Fbe.ry + 1.3, jitter: 0.05 });   // door leaf swung out
  steps(B, world, Fbe.x(0, -1.5), Fbe.z(0, -1.5), -Math.sin(Fbe.ry), -Math.cos(Fbe.ry), byy, 1.4, tag, 'concrete');
  B.box('corrugated', 3.5, 0.08, 3.5, Fb.cx, byy + 2.62, Fb.cz, [0.42, 0.40, 0.36], { ry: Fb.ry, rx: 0.08, jitter: 0.05 });
  objCollider(world, Fb.cx, byy + 2.6, Fb.cz, 3.4, 0.2, 3.4, Fb.ry, { surface: 'metal', tag, noAvoid: true });
  // inside: a shelf desk under the window, a stool, a phone box on the wall, a stove
  B.box('plank', 2.2, 0.05, 0.5, Fb.x(0, 1.05), byy + 0.85, Fb.z(0, 1.05), [0.42, 0.37, 0.27], { ry: Fb.ry, jitter: 0.05 });
  objCollider(world, Fb.x(0, 1.05), byy + 0.45, Fb.z(0, 1.05), 2.2, 0.9, 0.5, Fb.ry, { surface: 'wood', tag });
  B.box('metal', 0.18, 0.28, 0.1, Fb.x(-1.3, 0.3), byy + 1.5, Fb.z(-1.3, 0.3), [0.12, 0.12, 0.12], { ry: Fb.ry });
  B.cyl('metal', 0.22, 0.22, 0.8, Fb.x(1.0, -0.9), byy + 0.4, Fb.z(1.0, -0.9), [0.2, 0.2, 0.19], { seg: 10 });
  B.cyl('metal', 0.05, 0.05, 2.0, Fb.x(1.0, -0.9), byy + 1.8, Fb.z(1.0, -0.9), [0.2, 0.2, 0.19], { seg: 6 });
  world.addCylinder(Fb.x(1.0, -0.9), Fb.z(1.0, -0.9), 0.25, byy, byy + 0.8, { surface: 'metal', tag });
  addLoot(world, tag, 'shelf', Fb.x(0.4, 0.9), Fb.z(0.4, 0.9), byy + 0.9);
  addSpawn(world, tag, 'interior', Fb.cx, Fb.cz, byy);
  addCover(world, Fbe.x(0, -2.0), Fbe.z(0, -2.0));
  // sandbag ring by the booth, opening toward the road
  const rc = { x: F.x(3.5, -5.5), z: F.z(3.5, -5.5) };
  const ring = []; for (let i = 0; i <= 7; i++) { const a = F.ry + Math.PI * 0.15 + (i / 7) * Math.PI * 1.55; ring.push([rc.x + Math.cos(a) * 2.3, rc.z - Math.sin(a) * 2.3]); }
  const sb = sandbagWall(world, ring, 4, rnd, { tag });
  sandbags.mats.push(...sb.mats); sandbags.tints.push(...sb.tints);
  addCover(world, rc.x, rc.z); addSpawn(world, tag, 'exterior', rc.x, rc.z);
  addHide(world, tag, rc.x + 0.5, rc.z - 0.5);
  // rusted sign frame: two posts, the frame, the panel gone but for a bent corner
  const sp = { x: F.x(-7.5, 4.6), z: F.z(-7.5, 4.6) }; const sy = world.getHeight(sp.x, sp.z);
  for (const s of [-1, 1]) B.box('metal', 0.09, 3.4, 0.09, F.x(-7.5 + s * 1.3, 4.6), sy + 1.7, F.z(-7.5 + s * 1.3, 4.6), [0.28, 0.2, 0.14], { ry: F.ry, rz: s * 0.04 });
  B.box('metal', 2.9, 0.08, 0.08, sp.x, sy + 3.3, sp.z, [0.28, 0.2, 0.14], { ry: F.ry });
  B.box('metal', 2.9, 0.08, 0.08, sp.x, sy + 1.9, sp.z, [0.28, 0.2, 0.14], { ry: F.ry });
  B.box('paint', 1.1, 0.9, 0.03, F.x(-6.6, 4.6), sy + 2.7, F.z(-6.6, 4.6), [0.55, 0.52, 0.42], { ry: F.ry, rx: 0.5, rz: 0.15, jitter: 0.02 });
  world.addBox(sp.x, sy + 1.7, sp.z, 0.3, 3.4, 0.3, { tag });
  // burnt UAZ, off the road, nose in the ditch
  const uv = roadFrame(road, distToPolyline(22, 212, road.pts).t + 0.03);
  const up = roadOff(uv, 4.8, 0); const Fu = frame(up.x, up.z, roadRy(uv) + 0.7);
  uaz(B, world, Fu, world.getHeight(up.x, up.z) - 0.1, rnd, { tag, burnt: true, poi: tag });
  scorch(B, up.x, world.getHeight(up.x, up.z), up.z, 4.5);
  addHide(world, tag, Fu.x(-2.6, 0.4), Fu.z(-2.6, 0.4));
  // spawn/loot around
  addSpawn(world, tag, 'exterior', F.x(9, 6), F.z(9, 6)); addSpawn(world, tag, 'hidden', F.x(-9, -6), F.z(-9, -6));
  addLoot(world, tag, 'crate', F.x(5.5, -5.8), F.z(5.5, -5.8));
  B.box('plank', 0.8, 0.5, 0.6, F.x(5.5, -5.8), world.getHeight(F.x(5.5, -5.8), F.z(5.5, -5.8)) + 0.25, F.z(5.5, -5.8), [0.35, 0.36, 0.25], { ry: F.ry + 0.3, jitter: 0.06 });
  B.finish();
  return { pole: poleMesh, poleBase: F.ry + Math.PI };
}
// scorch decal, a plane hugging the terrain
export function scorch(B, x, y, z, size) {
  const g = new THREE.PlaneGeometry(size, size, 6, 6); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const world = B._world;
  for (let i = 0; i < p.count; i++) { const px = p.getX(i) + x, pz = p.getZ(i) + z; p.setY(i, (world ? world.getHeight(px, pz) : y) - y + 0.04); }
  g.computeVertexNormals();
  B.geo('scorch', g, placeMatrix(x, y, z), [1, 1, 1], { jitter: 0, noShadow: true });
}

export function buildConvoy(ctx, world, rnd) {
  const B = createBuilder(ctx, 'convoy'); B._world = world; const tag = 'convoy';
  const road = ROADS[0];
  const t0 = distToPolyline(48, 160, road.pts).t;
  // vehicles strung along the road: a URAL crossways, a BTR ahead, a second URAL burnt, a UAZ in the ditch
  const layout = [
    { dt: -0.028, side: -0.6, yaw: 0.25, kind: 'ural', burnt: false },
    { dt: -0.010, side: 1.2, yaw: -0.1, kind: 'btr' },
    { dt: 0.008, side: -1.4, yaw: 1.25, kind: 'ural', burnt: true },
    { dt: 0.024, side: 3.8, yaw: 0.9, kind: 'uaz' },
  ];
  for (const L of layout) {
    const p = roadFrame(road, t0 + L.dt); const o = roadOff(p, L.side, 0);
    const F = frame(o.x, o.z, roadRy(p) + L.yaw);
    const y = footprint(world, o.x, o.z, 4, 4, F.ry).min - 0.05;
    if (L.kind === 'ural') { truck(B, world, F, y, rnd, { tag, poi: tag, burnt: L.burnt, paint: L.burnt ? [0.27, 0.25, 0.23] : [0.34, 0.40, 0.29], canvas: L.burnt ? [0.14, 0.13, 0.12] : [0.36, 0.36, 0.25], noCanvas: false }); if (L.burnt) scorch(B, o.x, y, o.z, 9); }
    else if (L.kind === 'btr') btr(B, world, F, y, rnd, { tag, poi: tag });
    else uaz(B, world, F, y, rnd, { tag, poi: tag, paint: [0.36, 0.42, 0.32] });
    addSpawn(world, tag, 'hidden', F.x(-1, 0), F.z(-1, 0));
  }
  // spilled crates and ammo tins around the first truck's tail
  const p = roadFrame(road, t0 - 0.02);
  for (let i = 0; i < 9; i++) {
    const o = roadOff(p, -0.6 + (rnd() - 0.5) * 6, -5 - rnd() * 5);
    const y = world.getHeight(o.x, o.z); const open = rnd() < 0.4;
    const ry = rnd() * Math.PI, w = 0.55 + rnd() * 0.35;
    B.box('plank', w, w * 0.6, w * 0.8, o.x, y + w * 0.3 - (open ? 0.05 : 0), o.z, [0.36, 0.38, 0.26], { ry, rx: open ? 0.5 : 0, jitter: 0.08 });
    objCollider(world, o.x, y + w * 0.3, o.z, w, w * 0.6, w * 0.8, ry, { surface: 'wood', tag });
    if (i < 3) addLoot(world, tag, 'crate', o.x + 0.6, o.z + 0.2);
  }
  // a few loose olive tins
  for (let i = 0; i < 7; i++) { const o = roadOff(p, (rnd() - 0.5) * 8, -6 - rnd() * 8); const y = world.getHeight(o.x, o.z); B.box('metal', 0.34, 0.16, 0.18, o.x, y + 0.08, o.z, [0.30, 0.34, 0.22], { ry: rnd() * 3, jitter: 0.1 }); }
  addCover(world, roadOff(p, 5, -8).x, roadOff(p, 5, -8).z); addCover(world, roadOff(p, -5, 6).x, roadOff(p, -5, 6).z);
  addSpawn(world, tag, 'exterior', roadOff(p, 9, 14).x, roadOff(p, 9, 14).z); addSpawn(world, tag, 'exterior', roadOff(p, -9, -14).x, roadOff(p, -9, -14).z);
  addHide(world, tag, roadOff(p, -4, -9).x, roadOff(p, -4, -9).z);
  B.finish();
}

export function buildZarya(ctx, world, rnd, pickets) {
  const B = createBuilder(ctx, 'zarya'); B._world = world; const tag = 'zarya';
  const road = ROADS[0];
  const houses = [];
  // plots along the street: [t along road, side, setback, yawJitter, kind]
  const plots = [
    [0.735, 1, 13, 0.0, 'izba'], [0.755, -1, 12, 0.1, 'izba'], [0.78, 1, 15, -0.05, 'ruin'], [0.80, -1, 11, 0.05, 'izba'],
    [0.83, 1, 12, 0.08, 'izba'], [0.845, -1, 14, -0.12, 'izba'], [0.875, 1, 11, 0.0, 'ruin'], [0.895, -1, 13, 0.06, 'izba'], [0.915, 1, 14, -0.04, 'izba'],
  ];
  for (const [t, side, setback, jy, kind] of plots) {
    const p = roadFrame(road, t); const along = (rnd() - 0.5) * 3, jit = (rnd() - 0.5) * 2;
    let o = null;
    for (let k = 0; k < 3 && !o; k++) {   // step outward until the plot clears every other road
      const c = roadOff(p, side * (setback + k * 8) + jit, along);
      if (ROADS.every((r) => r === road || distToPolyline(c.x, c.z, r.pts).d > r.width * 0.5 + 8.5)) o = c;
    }
    if (!o || world.getHeight(o.x, o.z) < WATER_LEVEL + 0.3) continue;
    // house faces the street: its door side (-v) must point back toward the road
    const ry = roadRy(p) + jy + (rnd() - 0.5) * 0.15;
    const F = frame(o.x, o.z, side > 0 ? ry : ry + Math.PI);
    // gable end toward the street for some
    if (kind === 'ruin') ruinIzba(B, world, F, rnd, { tag, poi: tag });
    else {
      const h = izba(B, world, F, rnd, { tag, poi: tag, w: 7 + rnd() * 1.6, d: 5.6 + rnd() * 1.2 });
      houses.push(h);
      // picket fence around the plot, facing the street, with a gate gap
      const fx = (u, v) => [F.x(u, v), F.z(u, v)];
      picketFence(B, world, [fx(-6.5, -6.5), fx(-1.5, -6.6)], rnd, pickets, tag);
      picketFence(B, world, [fx(1.0, -6.6), fx(6.5, -6.5), fx(6.6, 2.0)], rnd, pickets, tag);
      if (rnd() < 0.6) picketFence(B, world, [fx(-6.6, 2.0), fx(-6.5, -6.5)], rnd, pickets, tag);
    }
  }
  // barn behind the north side near the west end
  const pb = roadFrame(road, 0.86); const ob = roadOff(pb, 34, 0);
  const Fb = frame(ob.x, ob.z, roadRy(pb) + 0.35);
  barn(B, world, Fb, rnd, { tag, poi: tag });
  // rusted tractor beside the barn
  const Ft = frame(Fb.x(9.5, 2.5), Fb.z(9.5, 2.5), Fb.ry + 0.8);
  tractor(B, world, Ft, footprint(world, Ft.cx, Ft.cz, 3, 3, Ft.ry).min - 0.05, { tag });
  // well near the centre, bus stop by the road, plinth in the square across from it
  const pc = roadFrame(road, 0.815);
  const ow = roadOff(pc, -8, 6); well(B, world, ow.x, ow.z, rnd, tag);
  const os = roadOff(pc, 5.5, -2); busStop(B, world, os.x, os.z, roadRy(pc), rnd, tag);
  const op = roadOff(pc, -9, -14); plinth(B, world, op.x, op.z, rnd, tag);
  // a low concrete kerb square around the plinth
  for (const [a, b, l, r] of [[0, -3.5, 7, 0], [0, 3.5, 7, 0], [-3.5, 0, 7, Math.PI / 2], [3.5, 0, 7, Math.PI / 2]]) { const x = op.x + a, z = op.z + b; if (rnd() < 0.8) B.box('concrete', l, 0.22, 0.25, x, world.getHeight(x, z) + 0.06, z, CONC, { ry: r, jitter: 0.05 }); }
  // village power line, tilted poles, from the east entrance to the west
  const wires = createWires(ctx);
  const linePts = []; for (let t = 0.72; t <= 0.935; t += 0.02) { const p = roadFrame(road, t); const o = roadOff(p, -6.5, 0); linePts.push([o.x, o.z]); }
  const pm = poleLine(ctx, world, linePts, wires, { spacing: 28, side: 0, rnd, tag, cutChance: 0.3 });
  instanced(ctx, 'log', poleGeometry(true), pm, null, { name: 'zarya-poles' });
  wires.finish('zarya-wires');
  // spots
  for (let i = 0; i < 6; i++) { const p = roadFrame(road, 0.73 + i * 0.04); const o = roadOff(p, (rnd() < 0.5 ? -1 : 1) * (18 + rnd() * 8), 0); addSpawn(world, tag, 'exterior', o.x, o.z); }
  addSpawn(world, tag, 'hidden', Fb.x(-8, 6), Fb.z(-8, 6));
  // reed-edge hiding spots toward the marsh (south-east of the village)
  for (let i = 0; i < 5; i++) { const x = -110 + i * 6 + (rnd() - 0.5) * 8, z = 95 + i * 4 + (rnd() - 0.5) * 6; if (world.getHeight(x, z) > WATER_LEVEL + 0.1) addHide(world, tag, x, z); }
  B.finish();
  return houses;
}

// ---------------------------------------------------------------------------------------------
// Object 12: substation
// ---------------------------------------------------------------------------------------------
function pylonGeometry() {
  const parts = [];
  const H = 22, b0 = 2.0, b1 = 0.7;
  const leg = (sx, sz) => {
    const g = new THREE.BoxGeometry(0.14, H, 0.14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + H / 2; const w = b0 + (b1 - b0) * (y / H); p.setX(i, p.getX(i) + sx * w); p.setZ(i, p.getZ(i) + sz * w); }
    g.translate(0, H / 2, 0); g.computeVertexNormals(); parts.push(g);
  };
  leg(1, 1); leg(1, -1); leg(-1, 1); leg(-1, -1);
  // X braces per face per level
  const levels = 7;
  for (let l = 0; l < levels; l++) {
    const y0 = (H * l) / levels, y1 = (H * (l + 1)) / levels; const w0 = b0 + (b1 - b0) * (y0 / H), w1 = b0 + (b1 - b0) * (y1 / H);
    for (const face of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dir of [1, -1]) {
        const ax = face[0] ? face[0] * w0 : -dir * w0, az = face[1] ? face[1] * w0 : -dir * w0;
        const bx = face[0] ? face[0] * w1 : dir * w1, bz = face[1] ? face[1] * w1 : dir * w1;
        const len = Math.hypot(bx - ax, y1 - y0, bz - az);
        const g = new THREE.BoxGeometry(0.06, len, 0.06);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(ax, y0, az), new THREE.Vector3(bx, y1, bz), new THREE.Vector3(1, 0, 0));
        g.rotateX(Math.PI / 2); g.applyMatrix4(m); g.translate((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2); parts.push(g);
      }
      // horizontal
      const hx = face[0] ? face[0] * w1 : 0, hz = face[1] ? face[1] * w1 : 0;
      const g = new THREE.BoxGeometry(face[0] ? 0.06 : w1 * 2, 0.06, face[1] ? 0.06 : w1 * 2); g.translate(hx, y1, hz); parts.push(g);
    }
  }
  // crossarms at two heights with insulator strings
  for (const [y, w] of [[16, 4.2], [19.5, 3.4]]) {
    const arm = new THREE.BoxGeometry(w * 2, 0.16, 0.16); arm.translate(0, y, 0); parts.push(arm);
    for (const s of [-1, 1]) { const ins = new THREE.CylinderGeometry(0.09, 0.12, 1.4, 6); ins.translate(s * (w - 0.3), y - 0.75, 0); parts.push(ins); }
  }
  const tip = new THREE.BoxGeometry(0.1, 2.0, 0.1); tip.translate(0, H + 1.0, 0); parts.push(tip);
  for (const p of parts) { colorize(p, [0.36, 0.34, 0.31], { jitter: 0.04, ground: 0, dampH: 2.0, damp: 0.3 }); normalizeGeo(p); }
  return mergeGeometries(parts, false);
}
function transformer(B, world, F, y, tag, rnd) {
  const ry = F.ry, paint = [0.32, 0.36, 0.34];
  B.box('metal', 2.4, 2.0, 1.6, F.cx, y + 1.35, F.cz, paint, { ry, jitter: 0.04, ground: y });
  B.box('concrete', 2.8, 0.35, 2.0, F.cx, y + 0.17, F.cz, CONC, { ry, jitter: 0.04, ground: y - 0.5 });
  // radiator fins on both long sides
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) B.box('metal', 0.06, 1.5, 0.5, F.x(-1.0 + i * 0.4, s * 1.05), y + 1.3, F.z(-1.0 + i * 0.4, s * 1.05), paint, { ry, jitter: 0.03 });
  // conservator tank on top, bushings (stacked discs)
  B.cyl('metal', 0.32, 0.32, 1.6, F.x(0, -0.4), y + 2.7, F.z(0, -0.4), paint, { rz: Math.PI / 2, ry, seg: 10 });
  for (const u of [-0.7, 0, 0.7]) {
    for (let d = 0; d < 5; d++) B.cyl('glass', 0.12 + (d % 2) * 0.05, 0.12 + (d % 2) * 0.05, 0.12, F.x(u, 0.35), y + 2.45 + d * 0.13, F.z(u, 0.35), [0.35, 0.28, 0.2], { seg: 8, noShadow: true });
    B.cyl('metal', 0.03, 0.03, 0.4, F.x(u, 0.35), y + 3.25, F.z(u, 0.35), [0.5, 0.5, 0.48], { seg: 5 });
  }
  objCollider(world, F.cx, y + 1.2, F.cz, 2.6, 2.4, 2.4, ry, { surface: 'metal', tag });
  for (const s of [-1, 1]) addCover(world, F.x(s * 2.2, 0), F.z(s * 2.2, 0));
  addHide(world, 'object12', F.x(0, 1.8), F.z(0, 1.8));
}
// distance from (x,z) to the nearest road centreline, minus that road's half width (negative = on the road)
function roadClearance(x, z) {
  let best = Infinity;
  for (const r of ROADS) { const d = distToPolyline(x, z, r.pts).d - r.width * 0.5; if (d < best) best = d; }
  return best;
}
// `gaps`: [segment, panel] pairs torn out; `roadMargin`: panels (and posts) this close to a road are missing too,
// so a road that crosses the fence line always passes through a hole, never a closed panel.
function chainFence(B, world, pts, rnd, posts, tag, gaps = [], roadMargin = 0) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 3.0);
    const yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n; const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = world.getHeight(x, z);
      if (roadMargin > 0 && roadClearance(x, z) < 0.6) continue;   // no post standing in the road
      posts.push(placeMatrix(x, y, z, (rnd() - 0.5) * 0.06, yaw, (rnd() - 0.5) * 0.06));
      world.addCylinder(x, z, 0.08, y, y + 2.2, { surface: 'metal', tag });
    }
    for (let i = 0; i < n; i++) {
      const gap = gaps.some(([gs, gi]) => gs === s && gi === i);
      if (gap) continue;
      if (roadMargin > 0 && roadClearance(ax + (bx - ax) * (i + 0.5) / n, az + (bz - az) * (i + 0.5) / n) < roadMargin) continue;
      const t0 = i / n, t1 = (i + 1) / n; const x = ax + (bx - ax) * (t0 + t1) / 2, z = az + (bz - az) * (t0 + t1) / 2;
      const y = (world.getHeight(ax + (bx - ax) * t0, az + (bz - az) * t0) + world.getHeight(ax + (bx - ax) * t1, az + (bz - az) * t1)) / 2;
      const sagged = rnd() < 0.15;
      const g = new THREE.PlaneGeometry(L / n, 2.0, 1, 1);
      B.geo('chainlink', g, placeMatrix(x, y + 1.05 - (sagged ? 0.35 : 0), z, sagged ? 0.35 : 0, yaw, 0), [1, 1, 1], { jitter: 0, noShadow: true });
      wallCollider(world, ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, y - 0.5, y + 2.0, 0.1, { surface: 'metal', tag, blocksBullets: false });
      B.box('metal', L / n, 0.05, 0.05, x, y + 2.05, z, [0.4, 0.4, 0.38], { ry: yaw, noShadow: true });
    }
  }
}
export function buildObject12(ctx, world, rnd) {
  const B = createBuilder(ctx, 'object12'); B._world = world; const tag = 'object12';
  const P = poi('object12'); const cx = P.x, cz = P.z;
  // control building: 12 x 8, two storeys, entrance on the west (toward the road junction), stair inside along the
  // north wall. Three roads meet at the POI centre, so the building sits in the south-east quarter of the compound.
  const F = frame(cx + 13, cz + 9, 0.12);
  const W = 12, D = 8, t = 0.35, S = 3.3;
  const fp = footprint(world, F.cx, F.cz, W + 2, D + 2, F.ry); const y = fp.max + 0.35;
  B.box('concrete', W + 0.6, y - fp.min + 0.8, D + 0.6, F.cx, (y + fp.min - 0.8) / 2, F.cz, [0.40, 0.39, 0.37], { ry: F.ry, jitter: 0.03 });
  slabCollider(world, F.cx, F.cz, W + 0.6, D + 0.6, F.ry, y, 1.5, { surface: 'concrete', tag });
  const wc = [0.46, 0.45, 0.43];
  const Fe = frame(F.cx, F.cz, F.ry + Math.PI / 2);
  const win = (u, y0) => ({ u0: u - 0.9, u1: u + 0.9, y0, y1: y0 + 1.3 });
  // south wall (v = +D/2): strip windows both floors
  wall(B, world, F, 'concrete', wc, -W / 2, W / 2, D / 2, y, y + 2 * S + 0.4, t, [win(-4, y + 1.1), win(-1, y + 1.1), win(2, y + 1.1), win(-4, y + S + 1.0), win(-1, y + S + 1.0), win(2, y + S + 1.0), win(5, y + S + 1.0)], { tag, ground: y, seed: 11 });
  wall(B, world, F, 'concrete', wc, -W / 2, W / 2, -D / 2, y, y + 2 * S + 0.4, t, [win(3, y + 1.4), win(-2, y + S + 1.0), win(3, y + S + 1.0)], { tag, ground: y, seed: 12 });
  // west end wall with the door; east end blank with a high vent
  wall(B, world, Fe, 'concrete', wc, -D / 2, D / 2, -W / 2, y, y + 2 * S + 0.4, t, [{ u0: 0.6, u1: 2.0, y0: y, y1: y + 2.4 }, win(-2, y + S + 1.0)], { tag, ground: y, seed: 13 });
  wall(B, world, Fe, 'concrete', wc, -D / 2, D / 2, W / 2, y, y + 2 * S + 0.4, t, [{ u0: -1, u1: 1, y0: y + S + 1.6, y1: y + S + 2.2 }], { tag, ground: y, seed: 14 });
  for (const w of [win(-4, y + 1.1), win(-1, y + 1.1), win(2, y + 1.1), win(-4, y + S + 1.0), win(-1, y + S + 1.0), win(2, y + S + 1.0), win(5, y + S + 1.0)]) windowDress(B, F, w.u0, w.u1, D / 2, w.y0, w.y1, t, rnd, { frame: [0.35, 0.36, 0.34], broken: 0.55 });
  for (const w of [win(3, y + 1.4), win(-2, y + S + 1.0), win(3, y + S + 1.0)]) windowDress(B, F, w.u0, w.u1, -D / 2, w.y0, w.y1, t, rnd, { frame: [0.35, 0.36, 0.34], broken: 0.55 });
  windowDress(B, Fe, -2.9, -1.1, -W / 2, y + S + 1.0, y + S + 2.3, t, rnd, { frame: [0.35, 0.36, 0.34] });
  // steel door leaf ajar
  B.box('metal', 1.3, 2.35, 0.08, Fe.x(2.0, -W / 2 - 0.5), y + 1.18, Fe.z(2.0, -W / 2 - 0.5), [0.30, 0.32, 0.30], { ry: Fe.ry + 1.0, jitter: 0.04 });
  // upper floor slab with a stair opening along the north wall at the west end
  const slabY = y + S;
  const holeU0 = -W / 2 + 0.3, holeU1 = -W / 2 + 4.6, holeV1 = -D / 2 + 1.6;
  // slab in three pieces around the stair well
  B.box('concrete', W / 2 - 0.05 - holeU1, 0.3, D - 0.1, F.x((holeU1 + W / 2 - 0.05) / 2, 0), slabY - 0.15, F.z((holeU1 + W / 2 - 0.05) / 2, 0), [0.42, 0.41, 0.39], { ry: F.ry, jitter: 0.03 });
  B.box('concrete', holeU1 + W / 2 - 0.05, 0.3, D / 2 - 0.05 - holeV1, F.x((holeU1 - W / 2 + 0.05) / 2, (holeV1 + D / 2 - 0.05) / 2), slabY - 0.15, F.z((holeU1 - W / 2 + 0.05) / 2, (holeV1 + D / 2 - 0.05) / 2), [0.42, 0.41, 0.39], { ry: F.ry, jitter: 0.03 });
  B.box('concrete', holeU0 + W / 2 - 0.05, 0.3, holeV1 + D / 2 - 0.05, F.x((holeU0 - W / 2 + 0.05) / 2, (holeV1 - D / 2 + 0.05) / 2), slabY - 0.15, F.z((holeU0 - W / 2 + 0.05) / 2, (holeV1 - D / 2 + 0.05) / 2), [0.42, 0.41, 0.39], { ry: F.ry, jitter: 0.03 });
  B.box('metal', holeU1 - holeU0, 0.05, 0.05, F.x((holeU0 + holeU1) / 2, holeV1), slabY + 1.0, F.z((holeU0 + holeU1) / 2, holeV1), [0.3, 0.3, 0.28], { ry: F.ry });   // rail around the well
  for (const u of [holeU0 + 0.1, holeU1 - 0.1]) B.box('metal', 0.05, 1.0, 0.05, F.x(u, holeV1), slabY + 0.5, F.z(u, holeV1), [0.3, 0.3, 0.28], { ry: F.ry });
  steps(B, world, Fe.x(1.3, -W / 2 - 0.2), Fe.z(1.3, -W / 2 - 0.2), -Math.cos(F.ry), Math.sin(F.ry), y, 1.6, tag, 'concrete');
  slabCollider(world, F.x((holeU1 + W / 2) / 2, 0), F.z((holeU1 + W / 2) / 2, 0), W / 2 - holeU1, D, F.ry, slabY, 0.3, { surface: 'concrete', tag });
  slabCollider(world, F.x((holeU0 + holeU1) / 2, (holeV1 + D / 2) / 2), F.z((holeU0 + holeU1) / 2, (holeV1 + D / 2) / 2), holeU1 - holeU0, D / 2 - holeV1, F.ry, slabY, 0.3, { surface: 'concrete', tag });
  // the stair: boxes rising along the north wall from the east toward the west, landing on the slab
  const nSt = 9;
  for (let i = 1; i <= nSt; i++) {
    const su = holeU1 + 0.2 - i * 0.42, sy = y + (S * i) / nSt, sv = -D / 2 + 0.95;
    B.box('concrete', 0.44, 0.2, 1.3, F.x(su, sv), sy - 0.1, F.z(su, sv), [0.44, 0.43, 0.41], { ry: F.ry, jitter: 0.03 });
    objCollider(world, F.x(su, sv), sy - 0.5, F.z(su, sv), 0.44, 1.0, 1.3, F.ry, { surface: 'concrete', tag });
    if (i % 3 === 0) B.box('metal', 0.05, 1.0, 0.05, F.x(su, sv + 0.7), sy + 0.5, F.z(su, sv + 0.7), [0.3, 0.3, 0.28], { ry: F.ry });
  }
  B.box('metal', nSt * 0.42, 0.05, 0.05, F.x(holeU1 - nSt * 0.21, -D / 2 + 1.65), y + S * 0.55 + 1.0, F.z(holeU1 - nSt * 0.21, -D / 2 + 1.65), [0.3, 0.3, 0.28], { ry: F.ry, rz: Math.atan2(S, nSt * 0.42) });   // handrail
  // roof slab + parapet + mast
  B.box('concrete', W + 0.5, 0.35, D + 0.5, F.cx, y + 2 * S + 0.55, F.cz, [0.40, 0.39, 0.37], { ry: F.ry, jitter: 0.03 });
  objCollider(world, F.cx, y + 2 * S + 0.55, F.cz, W + 0.5, 0.35, D + 0.5, F.ry, { surface: 'concrete', tag, noAvoid: true });
  B.cyl('metal', 0.04, 0.06, 6, F.x(4, -2), y + 2 * S + 3.6, F.z(4, -2), [0.3, 0.3, 0.28], { seg: 6 });
  // ground floor: switchgear cabinets in a row, a fallen one
  for (let i = 0; i < 6; i++) { const u = -1.5 + i * 1.0, v = D / 2 - 0.65; B.box('metal', 0.9, 2.2, 0.7, F.x(u, v), y + 1.1, F.z(u, v), [0.36, 0.40, 0.38], { ry: F.ry, jitter: 0.05 }); for (let k = 0; k < 3; k++) B.cyl('glass', 0.07, 0.07, 0.03, F.x(u - 0.25 + k * 0.25, v - 0.37), y + 1.6, F.z(u - 0.25 + k * 0.25, v - 0.37), [0.2, 0.2, 0.18], { rx: Math.PI / 2, ry: F.ry, seg: 8, noShadow: true }); }
  objCollider(world, F.x(1.0, D / 2 - 0.65), y + 1.1, F.z(1.0, D / 2 - 0.65), 6.0, 2.2, 0.75, F.ry, { surface: 'metal', tag });
  B.box('metal', 0.9, 0.7, 2.2, F.x(3.5, 0.5), y + 0.35, F.z(3.5, 0.5), [0.36, 0.40, 0.38], { ry: F.ry + 0.3, jitter: 0.05 });
  objCollider(world, F.x(3.5, 0.5), y + 0.35, F.z(3.5, 0.5), 1.2, 0.7, 2.3, F.ry, { surface: 'metal', tag });
  addCover(world, F.x(3.5, 1.8), F.z(3.5, 1.8), y); addCover(world, F.x(-3.0, 1.0), F.z(-3.0, 1.0), y);
  addLoot(world, tag, 'floor', F.x(-1, 0), F.z(-1, 0), y);
  addSpawn(world, tag, 'interior', F.x(2, -1), F.z(2, -1), y);
  // upstairs control room: console along the south windows, panel wall on the east, table, chair
  const cy = slabY;
  B.box('metal', 7, 0.9, 0.9, F.x(1, D / 2 - 1.2), cy + 0.45, F.z(1, D / 2 - 1.2), [0.40, 0.42, 0.40], { ry: F.ry, jitter: 0.04 });
  B.box('metal', 7, 0.5, 0.5, F.x(1, D / 2 - 1.0), cy + 1.1, F.z(1, D / 2 - 1.0), [0.40, 0.42, 0.40], { ry: F.ry, rx: -0.5, jitter: 0.04 });
  for (let i = 0; i < 12; i++) B.cyl('glass', 0.06, 0.06, 0.03, F.x(-2 + i * 0.55, D / 2 - 1.22), cy + 1.2, F.z(-2 + i * 0.55, D / 2 - 1.22), [0.16, 0.16, 0.14], { rx: Math.PI / 2 - 0.5, ry: F.ry, seg: 8, noShadow: true });
  objCollider(world, F.x(1, D / 2 - 1.2), cy + 0.6, F.z(1, D / 2 - 1.2), 7, 1.3, 1.1, F.ry, { surface: 'metal', tag });
  for (let i = 0; i < 4; i++) { const v = -2.5 + i * 1.2; B.box('metal', 0.5, 2.3, 1.1, F.x(W / 2 - 0.6, v), cy + 1.15, F.z(W / 2 - 0.6, v), [0.42, 0.44, 0.40], { ry: F.ry, jitter: 0.05 }); }
  objCollider(world, F.x(W / 2 - 0.6, -0.7), cy + 1.15, F.z(W / 2 - 0.6, -0.7), 0.6, 2.3, 4.8, F.ry, { surface: 'metal', tag });
  B.box('plank', 1.4, 0.05, 0.8, F.x(-2, 0.5), cy + 0.75, F.z(-2, 0.5), [0.42, 0.37, 0.27], { ry: F.ry + 0.2, jitter: 0.05 });
  for (const [a, b] of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) B.box('metal', 0.05, 0.73, 0.05, F.x(-2 + a, 0.5 + b), cy + 0.36, F.z(-2 + a, 0.5 + b), [0.3, 0.3, 0.28], { ry: F.ry + 0.2 });
  objCollider(world, F.x(-2, 0.5), cy + 0.4, F.z(-2, 0.5), 1.5, 0.8, 0.9, F.ry, { surface: 'wood', tag });
  B.box('metal', 0.45, 0.05, 0.45, F.x(-1, 1.6), cy + 0.45, F.z(-1, 1.6), [0.3, 0.32, 0.30], { ry: F.ry + 0.7 }); B.box('metal', 0.45, 0.5, 0.05, F.x(-1, 1.85), cy + 0.7, F.z(-1, 1.85), [0.3, 0.32, 0.30], { ry: F.ry + 0.7 });
  B.box('paint', 0.9, 1.1, 0.03, F.x(-3, -D / 2 + 0.2), cy + 1.8, F.z(-3, -D / 2 + 0.2), [0.75, 0.72, 0.62], { ry: F.ry, rz: 0.05, jitter: 0.02 });   // a schematic board
  addLoot(world, tag, 'shelf', F.x(-2, 0.5), F.z(-2, 0.5), cy + 0.8);
  addLoot(world, tag, 'shelf', F.x(3, D / 2 - 1.2), F.z(3, D / 2 - 1.2), cy + 1.0);
  addSpawn(world, tag, 'interior', F.x(2, -1.5), F.z(2, -1.5), cy);
  addCover(world, F.x(W / 2 - 1.5, 2.0), F.z(W / 2 - 1.5, 2.0), cy); addCover(world, F.x(-2, -1.5), F.z(-2, -1.5), cy);
  // a scatter of papers/boxes upstairs
  for (let i = 0; i < 4; i++) B.box('paint', 0.3, 0.005, 0.21, F.x(-3 + rnd() * 6, -2 + rnd() * 3), cy + 0.01, F.z(-3 + rnd() * 6, -2 + rnd() * 3), [0.8, 0.78, 0.7], { ry: rnd() * 3, noShadow: true });

  // transformer yard: 4 blocks on plinths in a jittered row, east of the road that leaves north-east
  const Y = frame(cx + 14, cz - 10, -0.08);
  const tPos = [[-4, -5], [-5, 4], [4, -6], [5, 5]];
  for (const [u, v] of tPos) { const x = Y.x(u + (rnd() - 0.5) * 2, v + (rnd() - 0.5) * 2), z = Y.z(u, v); const Ft = frame(x, z, Y.ry + (rnd() - 0.5) * 0.4); transformer(B, world, Ft, footprint(world, x, z, 3, 3, Ft.ry).max + 0.05, tag, rnd); }
  // bus-bar gantry: two lattice-ish portals with cross beams and insulators
  for (const u of [-1.5, 8]) {
    for (const v of [-8, 8]) { const x = Y.x(u, v), z = Y.z(u, v), gy = world.getHeight(x, z); B.box('metal', 0.25, 6.5, 0.25, x, gy + 3.25, z, [0.36, 0.34, 0.31], { ground: gy }); world.addBox(x, gy + 3, z, 0.4, 6.5, 0.4, { tag, surface: 'metal' }); }
    const x = Y.x(u, 0), z = Y.z(u, 0), gy = world.getHeight(x, z);
    B.box('metal', 0.2, 0.2, 16.4, x, gy + 6.4, z, [0.36, 0.34, 0.31], { ry: Y.ry });
    for (let k = 0; k < 5; k++) { const vv = -6 + k * 3; for (let d = 0; d < 4; d++) B.cyl('glass', 0.1 + (d % 2) * 0.05, 0.1 + (d % 2) * 0.05, 0.12, Y.x(u, vv), gy + 6.2 - d * 0.14, Y.z(u, vv), [0.35, 0.28, 0.2], { seg: 8, noShadow: true }); }
  }
  const wires = createWires(ctx);
  for (let k = 0; k < 5; k++) { const vv = -6 + k * 3; wires.span(V3(Y.x(-1.5, vv), world.getHeight(Y.x(-1.5, vv), Y.z(-1.5, vv)) + 5.6, Y.z(-1.5, vv)), V3(Y.x(8, vv), world.getHeight(Y.x(8, vv), Y.z(8, vv)) + 5.6, Y.z(8, vv)), 0.5 + rnd() * 0.3); }
  // fence with gaps, and a gate on the west (road) side
  const fencePts = [[cx - 26, cz - 20], [cx + 24, cz - 22], [cx + 26, cz + 20], [cx - 24, cz + 22], [cx - 26, cz - 20]];
  const posts = [];
  chainFence(B, world, fencePts, rnd, posts, tag, [[0, 3], [1, 5], [3, 9]], 3.4);
  const postG = new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6); postG.translate(0, 1.1, 0); colorize(postG, [0.38, 0.36, 0.33], { jitter: 0 });
  instanced(ctx, 'metal', postG, posts, null, { name: 'o12-posts', noShadow: true });
  // gate: where the road from the marsh side enters through the south fence (segment 2); tube-frame leaves with
  // mesh, one swung open along the road, the other hanging off its top hinge
  const [sa, sb] = [fencePts[2], fencePts[3]];
  const east = ROADS[1].pts; let hit = null;
  for (let i = 0; i < east.length - 1 && !hit; i++) hit = segmentHit(east[i], east[i + 1], sa, sb);
  const gx = hit ? hit.x : cx - 10, gz = hit ? hit.z : cz + 21; const gy = world.getHeight(gx, gz);
  const fl = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]), fdx = (sb[0] - sa[0]) / fl, fdz = (sb[1] - sa[1]) / fl;
  for (const s of [-1, 1]) { const px = gx + fdx * s * 3.2, pz = gz + fdz * s * 3.2; B.box('concrete', 0.5, 2.6, 0.5, px, gy + 1.3, pz, CONC, { ground: gy, ry: Math.atan2(-fdz, fdx) }); world.addBox(px, gy + 1.3, pz, 0.55, 2.6, 0.55, { tag }); }
  const leaf = (px, pz, ry, sagged) => { const Fl = frame(px, pz, ry); const rz = sagged ? -0.18 : 0; B.box('metal', 2.4, 0.06, 0.06, Fl.x(1.2, 0), gy + 2.0, Fl.z(1.2, 0), [0.4, 0.4, 0.38], { ry, rz }); B.box('metal', 2.4, 0.06, 0.06, Fl.x(1.2, 0), gy + 0.3 - (sagged ? 0.2 : 0), Fl.z(1.2, 0), [0.4, 0.4, 0.38], { ry, rz }); B.box('metal', 0.06, 1.76, 0.06, Fl.x(2.4, 0), gy + 1.15 - (sagged ? 0.3 : 0), Fl.z(2.4, 0), [0.4, 0.4, 0.38], { ry }); const g = new THREE.PlaneGeometry(2.3, 1.6); B.geo('chainlink', g, placeMatrix(Fl.x(1.2, 0), gy + 1.15 - (sagged ? 0.15 : 0), Fl.z(1.2, 0), 0, ry, rz), [1, 1, 1], { jitter: 0, noShadow: true }); wallCollider(world, Fl.x(0, 0), Fl.z(0, 0), Fl.x(2.4, 0), Fl.z(2.4, 0), gy, gy + 2.0, 0.12, { surface: 'metal', tag, blocksBullets: false }); };
  const fenceRy = Math.atan2(-fdz, fdx);
  leaf(gx - fdx * 3.0, gz - fdz * 3.0, fenceRy + 1.35, false);              // swung inward, off the road
  leaf(gx + fdx * 3.0, gz + fdz * 3.0, fenceRy + Math.PI - 1.0, true);     // hangs ajar from the other post, half across its side of the opening
  addCover(world, gx - fdx * 4.2, gz - fdz * 4.2); addCover(world, gx + fdx * 4.2, gz + fdz * 4.2);
  // water tower: tall cylinder with a wider tank on top, in the west of the compound
  const wx = cx - 16, wz = cz - 12, wy = world.getHeight(wx, wz);
  B.cyl('concrete', 1.4, 1.6, 0.6, wx, wy + 0.3, wz, CONC, { seg: 12, ground: wy });
  B.cyl('metal', 0.75, 0.8, 9, wx, wy + 5.1, wz, [0.34, 0.30, 0.26], { seg: 14, ground: wy, dampH: 3 });
  B.cyl('metal', 1.7, 1.7, 4.2, wx, wy + 11.7, wz, [0.36, 0.32, 0.27], { seg: 16 });
  B.cyl('metal', 0.2, 1.7, 0.7, wx, wy + 14.15, wz, [0.36, 0.32, 0.27], { seg: 16 });
  for (let i = 0; i < 22; i++) B.box('metal', 0.36, 0.03, 0.03, wx + 0.82, wy + 0.8 + i * 0.4, wz, [0.3, 0.27, 0.23], { noShadow: true });
  world.addCylinder(wx, wz, 0.9, wy, wy + 14, { tag, surface: 'metal' });
  addCover(world, wx + 1.6, wz + 0.2); addCover(world, wx - 1.6, wz - 0.2);
  // pylons marching south-east; the third has fallen
  const pylonG = pylonGeometry();
  const pm = []; const tops = [];
  const dir = { x: 0.62, z: 0.78 }; const spacing = 58;
  for (let i = 0; i < 6; i++) {
    const px = cx + 33 + dir.x * spacing * i + (rnd() - 0.5) * 4, pz = cz - 4 + dir.z * spacing * i + (rnd() - 0.5) * 4;
    if (Math.abs(px) > 300 || Math.abs(pz) > 300) break;
    const py = world.getHeight(px, pz) - 0.3;
    const yaw = Math.atan2(-dir.z, dir.x) + Math.PI / 2;   // crossarms (local x) perpendicular to the line
    if (i === 2) {
      // fallen sideways off the line: rotated about its local z so the mast lies along -local x, wires drooping
      pm.push(placeMatrix(px + 1.5, py + 0.9, pz + 2, 0, yaw, Math.PI / 2 - 0.15));
      const lx = -Math.cos(yaw), lz = Math.sin(yaw);   // world direction of the fallen mast
      wallCollider(world, px + 1.5, pz + 2, px + 1.5 + lx * 22, pz + 2 + lz * 22, py, py + 1.8, 2.4, { tag, surface: 'metal' });
      tops.push(null);
      addHide(world, tag, px + 3, pz + 5); addCover(world, px - 2, pz + 1);
      continue;
    }
    pm.push(placeMatrix(px, py, pz, 0, yaw, 0));
    for (const [sx, sz] of [[1.6, 1.6], [1.6, -1.6], [-1.6, 1.6], [-1.6, -1.6]]) world.addBox(px + sx * Math.cos(yaw) - sz * Math.sin(yaw), py + 2, pz + sx * Math.sin(yaw) + sz * Math.cos(yaw), 0.5, 4, 0.5, { tag, surface: 'metal' });
    const arm = (w, h) => [V3(px + Math.cos(yaw) * w, py + h, pz - Math.sin(yaw) * w), V3(px - Math.cos(yaw) * w, py + h, pz + Math.sin(yaw) * w)];
    tops.push([...arm(3.9, 14.6), ...arm(3.1, 18.1), V3(px, py + 23, pz)]);
    addCover(world, px + 2.4, pz + 2.4); addSpawn(world, tag, 'exterior', px + 6, pz - 4);
  }
  for (let i = 0; i < tops.length - 1; i++) {
    const a = tops[i], b = tops[i + 1];
    if (a && b) for (let w = 0; w < 5; w++) wires.span(a[w], b[w], 2.2 + rnd() * 0.8, 18);
    else if (a && !b) { for (let w = 0; w < 5; w++) { const g = a[w].clone(); g.x += dir.x * 28 + (rnd() - 0.5) * 6; g.z += dir.z * 28 + (rnd() - 0.5) * 6; g.y = world.getHeight(g.x, g.z) + 0.1; wires.drop(a[w], g, 12); } }
    else if (!a && b) { for (let w = 0; w < 5; w++) { const g = b[w].clone(); g.x -= dir.x * 26 + (rnd() - 0.5) * 6; g.z -= dir.z * 26 + (rnd() - 0.5) * 6; g.y = world.getHeight(g.x, g.z) + 0.1; wires.drop(b[w], g, 12); } }
  }
  // feed from the yard gantry to the first pylon
  if (tops[0]) for (let k = 0; k < 4; k++) wires.span(V3(Y.x(8, -6 + k * 3), world.getHeight(Y.x(8, -6 + k * 3), Y.z(8, -6 + k * 3)) + 5.6, Y.z(8, -6 + k * 3)), tops[0][k], 1.5);
  instanced(ctx, 'metal', pylonG, pm, null, { name: 'pylons' });
  wires.finish('o12-wires');
  // spots
  for (let i = 0; i < 5; i++) addSpawn(world, tag, 'exterior', cx + (rnd() - 0.5) * 44, cz + (rnd() - 0.5) * 40);
  addSpawn(world, tag, 'hidden', cx - 22, cz + 12); addSpawn(world, tag, 'hidden', cx + 20, cz + 15);
  addLoot(world, tag, 'crate', Y.x(0, 0), Y.z(0, 0));
  B.box('plank', 0.9, 0.6, 0.7, Y.x(0, 0), world.getHeight(Y.x(0, 0), Y.z(0, 0)) + 0.3, Y.z(0, 0), [0.36, 0.38, 0.26], { ry: Y.ry + 0.4, jitter: 0.06 });
  B.finish();
  return { y, F };
}

// ---------------------------------------------------------------------------------------------
// Church of St. Nikolai
// ---------------------------------------------------------------------------------------------
export function buildChurch(ctx, world, rnd) {
  const B = createBuilder(ctx, 'church'); B._world = world; const tag = 'church';
  // the church road ends at the POI centre: put the tower door there and run the nave axis on along the road
  const rp = ROADS[2].pts, ra = rp[rp.length - 2], rb = rp[rp.length - 1];
  const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]), rdx = (rb[0] - ra[0]) / rl, rdz = (rb[1] - ra[1]) / rl;
  const F = frame(rb[0] + rdx * 12.0, rb[1] + rdz * 12.0, Math.atan2(-rdz, rdx));   // +u along the road heading; the tower (-u) faces the road end
  const W = 11, D = 7, t = 0.3, H = 4.2;
  const fp = footprint(world, F.cx, F.cz, W + 6, D + 2, F.ry); const y = fp.max + 0.3;
  const dark = [0.30, 0.25, 0.18];
  B.box('stone', W + 6.4, y - 0.1 - (fp.min - 1.0), D + 0.4, F.x(-2, 0), (y - 0.1 + fp.min - 1.0) / 2, F.z(-2, 0), [0.42, 0.41, 0.38], { ry: F.ry, jitter: 0.08, ground: fp.min - 0.5, dampH: 2 });
  slabCollider(world, F.x(-2, 0), F.z(-2, 0), W + 6.4, D + 0.4, F.ry, y, 2.5, { surface: 'wood', tag });
  B.box('plank', W + 5.8, 0.1, D - 0.2, F.x(-2, 0), y - 0.05, F.cz, [0.34, 0.29, 0.21], { ry: F.ry, jitter: 0.04 });
  // nave walls: windows tall and narrow with arched tops (rectangular here, framed)
  const wins = [-2.5, 0.5, 3.5].map((u) => ({ u0: u - 0.4, u1: u + 0.4, y0: y + 1.4, y1: y + 3.2 }));
  wall(B, world, F, 'log', dark, -W / 2, W / 2, D / 2, y, y + H, t, wins, { tag, ground: y, seed: 21 });
  wall(B, world, F, 'log', dark, -W / 2, W / 2, -D / 2, y, y + H, t, wins, { tag, ground: y, seed: 22 });
  for (const w of wins) { windowDress(B, F, w.u0, w.u1, D / 2, w.y0, w.y1, t, rnd, { frame: [0.62, 0.60, 0.52], broken: 0.5 }); windowDress(B, F, w.u0, w.u1, -D / 2, w.y0, w.y1, t, rnd, { frame: [0.62, 0.60, 0.52], broken: 0.5 }); }
  const Fe = frame(F.cx, F.cz, F.ry + Math.PI / 2);
  wall(B, world, Fe, 'log', dark, -D / 2, D / 2, W / 2, y, y + H, t, [{ u0: -0.5, u1: 0.5, y0: y + 1.6, y1: y + 3.0 }], { tag, ground: y, seed: 23 });   // east (altar) end
  // west end opens into the tower base through a wide arch
  wall(B, world, Fe, 'log', dark, -D / 2, D / 2, -W / 2, y, y + H, t, [{ u0: -0.9, u1: 0.9, y0: y, y1: y + 2.6 }], { tag, ground: y, seed: 24 });
  // roof (steep) with the drum + collapsed dome
  const pitch = 0.78, half = D / 2 + 0.5, ridgeY = y + H + Math.tan(pitch) * half;
  for (const side of [-1, 1]) roofPanel(B, 'plank', [0.36, 0.35, 0.31], F, 0, 0, ridgeY, half, W + 1, pitch, side, 0.12, { warp: 1, seed: 25 + side });
  for (const s of [-1, 1]) gableEnd(B, 'plank', [0.40, 0.36, 0.28], F, s * (W / 2 - 0.02), 0, y + H - 0.02, D / 2 + 0.02, Math.tan(pitch) * half - 0.1, 0.16);
  objCollider(world, F.cx, ridgeY - 1.2, F.cz, W, 2.2, D * 0.4, F.ry, { surface: 'wood', tag, noAvoid: true });
  // the drum: octagonal, cracked open on one side (two arcs), no dome
  const du = 1.5;
  const drum = new THREE.CylinderGeometry(1.5, 1.5, 2.4, 8, 1, true, 0.4, Math.PI * 1.55);
  B.geo('plank', drum, placeMatrix(F.x(du, 0), ridgeY + 0.6, F.z(du, 0), 0, F.ry, 0), [0.42, 0.40, 0.34], { jitter: 0.04 });
  B.geo('plank', new THREE.CylinderGeometry(1.5, 1.5, 1.3, 8, 1, true, Math.PI * 1.95 + 0.4, Math.PI * 0.4), placeMatrix(F.x(du, 0), ridgeY + 0.1, F.z(du, 0), 0, F.ry, 0), [0.42, 0.40, 0.34], { jitter: 0.04 });
  // onion dome on the ground beside the nave, half buried, tilted
  const onion = new THREE.LatheGeometry([new THREE.Vector2(0.01, 0), new THREE.Vector2(0.9, 0.2), new THREE.Vector2(1.55, 0.9), new THREE.Vector2(1.5, 1.6), new THREE.Vector2(1.0, 2.2), new THREE.Vector2(0.35, 2.8), new THREE.Vector2(0.08, 3.4)], 16);
  const ox = F.x(du + 1.5, -(D / 2 + 3.2)), oz = F.z(du + 1.5, -(D / 2 + 3.2)), oy = world.getHeight(ox, oz);
  B.geo('metal', onion, placeMatrix(ox, oy - 0.5, oz, 1.15, F.ry + 0.6, 0.3), [0.30, 0.42, 0.38], { jitter: 0.03 });
  B.cyl('metal', 0.04, 0.04, 1.4, ox + 1.2, oy + 2.4, oz + 0.9, [0.55, 0.45, 0.22], { rx: 1.15 + 0.3, ry: F.ry + 0.6, seg: 5 });
  world.addBox(ox, oy + 0.9, oz, 3.4, 2.2, 3.2, { tag, surface: 'metal' });
  addCover(world, ox + 2.4, oz + 0.5); addHide(world, tag, ox - 1.2, oz + 2.4);
  // bell tower at the west end: 4 x 4 base (enterable from the nave and a west door), open stage, tent roof
  const TW = 4.2, tu = -W / 2 - TW / 2 + 0.15;
  const Ft = frame(F.x(tu, 0), F.z(tu, 0), F.ry);
  const Fte = frame(Ft.cx, Ft.cz, F.ry + Math.PI / 2);
  const TH = 6.5;
  wall(B, world, Ft, 'log', dark, -TW / 2, TW / 2, TW / 2, y, y + TH, t, [{ u0: -0.4, u1: 0.4, y0: y + 3.2, y1: y + 4.0 }], { tag, ground: y, seed: 31 });
  wall(B, world, Ft, 'log', dark, -TW / 2, TW / 2, -TW / 2, y, y + TH, t, [{ u0: -0.4, u1: 0.4, y0: y + 3.2, y1: y + 4.0 }], { tag, ground: y, seed: 32 });
  wall(B, world, Fte, 'log', dark, -TW / 2, TW / 2, -TW / 2, y, y + TH, t, [{ u0: -0.7, u1: 0.7, y0: y, y1: y + 2.3 }], { tag, ground: y, seed: 33 });   // west door
  steps(B, world, Fte.x(0, -TW / 2 - 0.1), Fte.z(0, -TW / 2 - 0.1), -Math.sin(Fte.ry), -Math.cos(Fte.ry), y, 2.0, tag);
  wall(B, world, Fte, 'log', dark, -TW / 2, TW / 2, TW / 2, y + 2.6, y + TH, t, [], { tag, ground: y, seed: 34 });   // above the arch into the nave
  // bell stage: 4 posts, rail, tent roof, bell
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box('log', 0.26, 2.6, 0.26, Ft.x(a * 1.85, b * 1.85), y + TH + 1.3, Ft.z(a * 1.85, b * 1.85), dark, { ry: F.ry });
  B.box('plank', TW + 0.3, 0.2, TW + 0.3, Ft.cx, y + TH + 0.1, Ft.cz, [0.36, 0.32, 0.25], { ry: F.ry });
  for (const s of [-1, 1]) { B.box('plank', TW, 0.08, 0.08, Ft.x(0, s * 1.85), y + TH + 1.0, Ft.z(0, s * 1.85), dark, { ry: F.ry }); B.box('plank', 0.08, 0.08, TW, Ft.x(s * 1.85, 0), y + TH + 1.0, Ft.z(s * 1.85, 0), dark, { ry: F.ry }); }
  const tent = new THREE.ConeGeometry(3.3, 2.8, 8, 1, false); B.geo('plank', tent, placeMatrix(Ft.cx, y + TH + 2.6 + 1.4, Ft.cz, 0, F.ry + Math.PI / 8, 0), [0.38, 0.36, 0.31], { jitter: 0.04 });
  B.box('metal', 0.06, 1.6, 0.06, Ft.cx, y + TH + 5.6, Ft.cz, [0.55, 0.45, 0.22], { rz: 0.08 }); B.box('metal', 0.7, 0.06, 0.06, Ft.cx, y + TH + 6.0, Ft.cz, [0.55, 0.45, 0.22], { ry: F.ry, rz: 0.08 }); B.box('metal', 0.45, 0.06, 0.06, Ft.cx, y + TH + 5.55, Ft.cz, [0.55, 0.45, 0.22], { ry: F.ry, rz: 0.08 + 0.5 });
  objCollider(world, Ft.cx, y + TH + 1.5, Ft.cz, TW + 0.3, 3.0, TW + 0.3, F.ry, { tag, surface: 'wood', noAvoid: true });
  // the bell (animated: separate mesh)
  const bellG = new THREE.LatheGeometry([new THREE.Vector2(0.02, 0), new THREE.Vector2(0.18, 0.05), new THREE.Vector2(0.28, 0.3), new THREE.Vector2(0.32, 0.6), new THREE.Vector2(0.42, 0.75), new THREE.Vector2(0.5, 0.78), new THREE.Vector2(0.5, 0.86), new THREE.Vector2(0.4, 0.88), new THREE.Vector2(0.3, 0.75), new THREE.Vector2(0.22, 0.4), new THREE.Vector2(0.14, 0.15), new THREE.Vector2(0.06, 0.12)], 14);
  bellG.translate(0, -0.9, 0); colorize(bellG, [0.36, 0.30, 0.18], { jitter: 0 }); normalizeGeo(bellG);
  const bell = new THREE.Mesh(bellG, material('metal')); bell.castShadow = true; bell.position.set(Ft.cx, y + TH + 2.45, Ft.cz); B.group.add(bell);
  B.box('log', 0.12, 0.12, 2.0, Ft.cx, y + TH + 2.5, Ft.cz, dark, { ry: F.ry });
  // inside the tower base: a ladder stub, a rope, a bench; loot
  B.box('plank', 0.3, 5.5, 0.05, Fte.x(1.6, 1.7), y + 2.8, Fte.z(1.6, 1.7), dark, { ry: Fte.ry, rz: 0.1 });
  for (let i = 0; i < 12; i++) B.box('plank', 0.5, 0.04, 0.04, Fte.x(1.6, 1.7), y + 0.4 + i * 0.42, Fte.z(1.6, 1.7), dark, { ry: Fte.ry });
  B.cyl('canvas', 0.02, 0.02, 4.5, Ft.x(0.3, 0.2), y + 3.5, Ft.z(0.3, 0.2), [0.5, 0.45, 0.35], { seg: 4, noShadow: true });
  addLoot(world, tag, 'floor', Ft.x(-1.2, -1.2), Ft.z(-1.2, -1.2), y);
  addSpawn(world, tag, 'interior', Ft.cx, Ft.cz, y);
  // nave interior: pews (benches), a fallen chandelier, the altar with an iconostasis wall of empty frames
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const u = -3.0 + i * 1.5, v = s * 1.6; B.box('plank', 0.5, 0.06, 2.4, F.x(u, v), y + 0.45, F.z(u, v), [0.40, 0.34, 0.24], { ry: F.ry, rz: rnd() < 0.15 ? 0.6 : 0, jitter: 0.06 }); B.box('plank', 0.06, 0.5, 2.4, F.x(u + 0.25, v), y + 0.6, F.z(u + 0.25, v), [0.40, 0.34, 0.24], { ry: F.ry, jitter: 0.06 }); objCollider(world, F.x(u, v), y + 0.4, F.z(u, v), 0.6, 0.9, 2.4, F.ry, { surface: 'wood', tag }); }
  const au = W / 2 - 1.2;
  B.box('plank', 1.2, 1.1, 2.6, F.x(au, 0), y + 0.55, F.z(au, 0), [0.42, 0.36, 0.26], { ry: F.ry, jitter: 0.04 });
  B.box('canvas', 1.3, 0.04, 2.7, F.x(au, 0), y + 1.12, F.z(au, 0), [0.50, 0.14, 0.12], { ry: F.ry, jitter: 0.03 });
  objCollider(world, F.x(au, 0), y + 0.55, F.z(au, 0), 1.3, 1.1, 2.7, F.ry, { surface: 'wood', tag });
  for (let i = 0; i < 5; i++) { const v = -2.4 + i * 1.2; B.box('plank', 0.06, 1.4, 0.9, F.x(W / 2 - 0.42, v), y + 2.1 + (i % 2) * 0.3, F.z(W / 2 - 0.42, v), [0.55, 0.45, 0.22], { ry: F.ry, jitter: 0.05 }); B.box('paint', 0.03, 1.2, 0.7, F.x(W / 2 - 0.4, v), y + 2.1 + (i % 2) * 0.3, F.z(W / 2 - 0.4, v), [0.25, 0.18, 0.12], { ry: F.ry, jitter: 0.05 }); }
  B.cyl('metal', 0.9, 0.9, 0.1, F.x(-0.5, 0.6), y + 0.3, F.z(-0.5, 0.6), [0.42, 0.34, 0.18], { rx: 0.5, seg: 12, open: true });
  world.addBox(F.x(-0.5, 0.6), y + 0.3, F.z(-0.5, 0.6), 1.8, 0.6, 1.8, { tag, surface: 'metal' });
  for (let i = 0; i < 9; i++) B.cyl('canvas', 0.02, 0.02, 0.15 + rnd() * 0.1, F.x(au - 0.2 + (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 2.2), y + 1.2, F.z(au - 0.2, (rnd() - 0.5) * 2.2), [0.85, 0.8, 0.6], { seg: 5, noShadow: true });   // candle stubs
  addLoot(world, tag, 'shelf', F.x(au - 1.0, 0), F.z(au - 1.0, 0), y + 1.15);
  addLoot(world, tag, 'floor', F.x(-2, -2.4), F.z(-2, -2.4), y);
  addSpawn(world, tag, 'interior', F.x(0, 0), F.z(0, 0), y); addCover(world, F.x(-1.5, 1.6), F.z(-1.5, 1.6), y); addCover(world, F.x(au - 1.4, 0), F.z(au - 1.4, 0), y);
  // graveyard: crosses south of the nave, tilted, on low mounds; a low stone wall around the yard
  const crossG = (() => {
    const parts = [new THREE.BoxGeometry(0.1, 2.0, 0.08), new THREE.BoxGeometry(0.9, 0.09, 0.08), new THREE.BoxGeometry(0.5, 0.08, 0.08), new THREE.BoxGeometry(0.6, 0.07, 0.08)];
    parts[0].translate(0, 1.0, 0); parts[1].translate(0, 1.45, 0); parts[2].translate(0, 1.78, 0); parts[3].rotateZ(0.5); parts[3].translate(0, 0.95, 0);
    for (const p of parts) { colorize(p, [0.36, 0.32, 0.25], { jitter: 0, ground: 0, dampH: 0.8 }); normalizeGeo(p); }
    return mergeGeometries(parts, false);
  })();
  const cm = [], ct = [];
  for (let i = 0; i < 26; i++) {
    const u = -6 + (i % 7) * 2.1 + (rnd() - 0.5) * 0.9, v = D / 2 + 4 + Math.floor(i / 7) * 2.6 + (rnd() - 0.5) * 0.8;
    const x = F.x(u, v), z = F.z(u, v), gy = world.getHeight(x, z);
    if (rnd() < 0.12) continue;
    const tilt = (rnd() - 0.5) * 0.5, tilt2 = (rnd() - 0.5) * 0.3;
    cm.push(placeMatrix(x, gy - 0.1, z, tilt2, F.ry + Math.PI / 2 + (rnd() - 0.5) * 0.5, tilt));
    const tn = 0.75 + rnd() * 0.5; ct.push([tn, tn, tn]);
    B.box('earth', 1.0, 0.25, 1.8, x, gy + 0.05, z, [1, 1, 1], { ry: F.ry + Math.PI / 2, jitter: 0.1, noShadow: true });
    world.addBox(x, gy + 0.9, z, 0.3, 1.8, 0.3, { tag, surface: 'wood', blocksBullets: false });
  }
  instanced(ctx, 'plank', crossG, cm, ct, { name: 'church-crosses' });
  // stone wall: rubble boxes around an ellipse, gaps at the gates
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    if (Math.abs(a - Math.PI * 1.0) < 0.21 || Math.abs(a - Math.PI * 1.5) < 0.1) continue;   // the road gate (-u) and a side gap
    if (rnd() < 0.1) continue;
    const u = Math.cos(a) * 15 - 2, v = Math.sin(a) * 13 + 1;
    const x = F.x(u, v), z = F.z(u, v), gy = world.getHeight(x, z);
    const h = 0.5 + rnd() * 0.45;
    B.box('stone', 1.6, h, 0.7, x, gy + h / 2 - 0.1, z, [0.44, 0.43, 0.40], { ry: F.ry - a + (rnd() - 0.5) * 0.3, rz: (rnd() - 0.5) * 0.1, jitter: 0.1, ground: gy });
    objCollider(world, x, gy + h / 2, z, 1.6, h, 0.7, F.ry - a, { tag, surface: 'rock' });
    if (i % 9 === 0) addCover(world, F.x(u * 0.92, v * 0.92), F.z(u * 0.92, v * 0.92));
  }
  for (let i = 0; i < 4; i++) addSpawn(world, tag, 'exterior', F.x(-14 + i * 9, 16), F.z(-14 + i * 9, 16));
  addSpawn(world, tag, 'hidden', F.x(6, D / 2 + 6), F.z(6, D / 2 + 6));
  addHide(world, tag, F.x(-W / 2 - 4, -D / 2 - 2), F.z(-W / 2 - 4, -D / 2 - 2));
  B.finish();
  return { bell };
}

// ---------------------------------------------------------------------------------------------
// Rail cutting: rails on sleepers, the derailed tank car, a signal box, level crossings
// ---------------------------------------------------------------------------------------------
export function buildRail(ctx, world, rnd) {
  const B = createBuilder(ctx, 'rail'); B._world = world; const tag = 'rail';
  const pts = RAIL.pts;
  const sleeperG = new THREE.BoxGeometry(2.5, 0.16, 0.24); sleeperG.translate(0, 0.08, 0); colorize(sleeperG, [0.30, 0.26, 0.20], { jitter: 0 });
  const sm = [], st = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1]; const L = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2; const dx = (bx - ax) / L, dz = (bz - az) / L;
    const n = Math.floor(L / 0.7);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n; const x = ax + dx * t * L, z = az + dz * t * L; const y = world.getHeight(x, z);
      if (Math.abs(x) > 318 || Math.abs(z) > 318) continue;
      sm.push(placeMatrix(x + (rnd() - 0.5) * 0.04, y - 0.02, z + (rnd() - 0.5) * 0.04, 0, yaw + (rnd() - 0.5) * 0.03, 0));
      const tn = 0.8 + rnd() * 0.4; st.push([tn, tn, tn]);
    }
    // rails: two long boxes per segment following the terrain in 24 m pieces
    const pieces = Math.ceil(L / 24);
    for (let i = 0; i < pieces; i++) {
      const t0 = i / pieces, t1 = (i + 1) / pieces;
      const x0 = ax + dx * t0 * L, z0 = az + dz * t0 * L, x1 = ax + dx * t1 * L, z1 = az + dz * t1 * L;
      const y0 = world.getHeight(x0, z0), y1 = world.getHeight(x1, z1);
      const len = Math.hypot(x1 - x0, z1 - z0, y1 - y0); const pitch = Math.atan2(y1 - y0, L / pieces);
      for (const side of [-0.75, 0.75]) {
        const cxp = (x0 + x1) / 2 - dz * side, czp = (z0 + z1) / 2 + dx * side;
        B.box('metal', len, 0.12, 0.07, cxp, (y0 + y1) / 2 + 0.2, czp, [0.34, 0.24, 0.16], { ry: yaw, rz: pitch, jitter: 0.03, noShadow: true });
      }
    }
  }
  instanced(ctx, 'plank', sleeperG, sm, st, { name: 'sleepers', noShadow: true });
  // derailed tank car on its side below the embankment near (-60,-160)
  const tx = -62, tz = -161; const ty = footprint(world, tx, tz, 12, 4, 0.2).min;
  const Fk = frame(tx, tz, 0.2);
  const tank = new THREE.CylinderGeometry(1.35, 1.35, 10.5, 18); tank.rotateZ(Math.PI / 2);
  B.geo('metal', tank, placeMatrix(tx, ty + 1.2, tz, 0.0, Fk.ry, 0.06), [0.20, 0.18, 0.16], { jitter: 0.03, ground: ty });
  for (const s of [-1, 1]) B.cyl('metal', 1.36, 1.2, 0.3, Fk.x(s * 5.3, 0), ty + 1.2, Fk.z(s * 5.3, 0), [0.22, 0.2, 0.17], { rz: Math.PI / 2, ry: Fk.ry, seg: 18 });
  B.cyl('metal', 0.5, 0.5, 0.4, Fk.x(0, 1.4), ty + 1.2, Fk.z(0, 1.4), [0.22, 0.2, 0.17], { rx: Math.PI / 2, ry: Fk.ry, seg: 12 });   // the dome, now sideways
  // underframe + bogies flung nearby
  B.box('metal', 11, 0.3, 2.6, Fk.x(0, -1.5), ty + 1.2, Fk.z(0, -1.5), [0.18, 0.16, 0.14], { ry: Fk.ry, rz: 0.06, rx: Math.PI / 2 - 0.3 });
  for (const u of [-3.6, 3.6]) { for (const w of [-0.9, 0.9]) { B.cyl('metal', 0.45, 0.45, 0.14, Fk.x(u + w, -2.5), ty + 1.0, Fk.z(u + w, -2.5), [0.25, 0.22, 0.2], { rx: Math.PI / 2 + 0.2, ry: Fk.ry, seg: 12 }); } }
  const bog = frame(Fk.x(-7, 3), Fk.z(-7, 3), Fk.ry + 1.2);
  B.box('metal', 2.6, 0.4, 2.4, bog.cx, world.getHeight(bog.cx, bog.cz) + 0.3, bog.cz, [0.2, 0.18, 0.16], { ry: bog.ry, rx: 0.15 });
  for (const s of [-1, 1]) for (const w of [-0.9, 0.9]) B.cyl('metal', 0.45, 0.45, 0.14, bog.x(w, s * 1.05), world.getHeight(bog.cx, bog.cz) + 0.45, bog.z(w, s * 1.05), [0.25, 0.22, 0.2], { rz: Math.PI / 2, ry: bog.ry, seg: 12 });
  objCollider(world, tx, ty + 1.2, tz, 10.8, 2.6, 3.2, Fk.ry, { tag, surface: 'metal' });
  objCollider(world, bog.cx, world.getHeight(bog.cx, bog.cz) + 0.4, bog.cz, 2.6, 0.9, 2.4, bog.ry, { tag, surface: 'metal' });
  // ladder rungs along the tank, a spilled dark stain
  for (let i = 0; i < 6; i++) B.box('metal', 0.03, 0.03, 0.5, Fk.x(-2 + i * 0.4, 1.3), ty + 2.3, Fk.z(-2 + i * 0.4, 1.3), [0.3, 0.27, 0.23], { ry: Fk.ry, noShadow: true });
  scorch(B, Fk.x(3, 2.5), ty, Fk.z(3, 2.5), 7);
  for (const s of [-1, 1]) { addCover(world, Fk.x(0, s * 2.6), Fk.z(0, s * 2.6)); addCover(world, Fk.x(s * 6.5, 0), Fk.z(s * 6.5, 0)); }
  addHide(world, tag, Fk.x(-2, -2.4), Fk.z(-2, -2.4)); addHide(world, tag, bog.x(0, 1.8), bog.z(0, 1.8));
  addSpawn(world, tag, 'hidden', Fk.x(4, -3), Fk.z(4, -3)); addSpawn(world, tag, 'exterior', tx - 14, tz + 8); addSpawn(world, tag, 'exterior', tx + 16, tz - 4);
  addLoot(world, tag, 'crate', Fk.x(-6, -1), Fk.z(-6, -1)); addLoot(world, tag, 'floor', Fk.x(6, 2.5), Fk.z(6, 2.5));
  B.box('plank', 0.8, 0.5, 0.6, Fk.x(-6, -1), world.getHeight(Fk.x(-6, -1), Fk.z(-6, -1)) + 0.25, Fk.z(-6, -1), [0.36, 0.38, 0.26], { ry: Fk.ry + 0.5, jitter: 0.06 });
  // level crossings where roads cross the rail: timber decking, a cross sign, a broken barrier arm
  const crossings = [];
  for (const road of ROADS) for (let i = 0; i < road.pts.length - 1; i++) for (let j = 0; j < pts.length - 1; j++) { const p = segmentHit(road.pts[i], road.pts[i + 1], pts[j], pts[j + 1]); if (p) crossings.push(p); }
  for (const c of crossings) {
    const y = world.getHeight(c.x, c.z); const yawL = Math.atan2(c.ldx, c.ldz) + Math.PI / 2, yawR = Math.atan2(c.rdx, c.rdz) + Math.PI / 2;
    for (const v of [-1.15, 0, 1.15]) B.box('plank', 6.5, 0.14, 0.7, c.x - c.ldz * v, y + 0.2, c.z + c.ldx * v, [0.30, 0.27, 0.21], { ry: yawL, jitter: 0.06, noShadow: true });
    slabCollider(world, c.x, c.z, 6.5, 2.6, yawL, y + 0.28, 0.5, { tag, surface: 'wood' });
    for (const s of [-1, 1]) {
      const px = c.x + c.rdx * s * 6.5 - c.rdz * s * 3.2, pz = c.z + c.rdz * s * 6.5 + c.rdx * s * 3.2; const py = world.getHeight(px, pz);
      B.box('metal', 0.1, 3.2, 0.1, px, py + 1.6, pz, [0.5, 0.5, 0.48], { ground: py });
      B.box('paint', 1.1, 0.16, 0.04, px, py + 2.9, pz, [0.85, 0.85, 0.8], { ry: yawR + Math.PI / 2, rz: 0.75 }); B.box('paint', 1.1, 0.16, 0.04, px, py + 2.9, pz, [0.85, 0.85, 0.8], { ry: yawR + Math.PI / 2, rz: -0.75 });
      world.addBox(px, py + 1.6, pz, 0.3, 3.2, 0.3, { tag });
      if (s === 1) {
        const arm = new THREE.BoxGeometry(5.0, 0.1, 0.08); arm.translate(2.4, 0, 0);
        colorize(arm, [1, 1, 1], { jitter: 0, fn: (ax) => (Math.floor((ax + 0.2) / 0.5) % 2 === 0 ? [0.72, 0.12, 0.10] : [0.82, 0.8, 0.74]) });
        B.geo('paint', arm, placeMatrix(px, py + 1.0, pz, 0, yawR + Math.PI, -0.9), null, { jitter: 0 });
      }
    }
    addCover(world, c.x + c.rdx * 5 + c.ldx * 3, c.z + c.rdz * 5 + c.ldz * 3);
  }
  // signal box near the church-road crossing: brick, big windows, a lever frame inside, a stove
  const cr = crossings.find((c) => c.x > 0) || crossings[0];
  if (cr) {
    const sx = cr.x + cr.ldx * 9 - cr.ldz * 5.5, sz = cr.z + cr.ldz * 9 + cr.ldx * 5.5;
    const F = frame(sx, sz, Math.atan2(cr.ldx, cr.ldz) + Math.PI / 2 - Math.PI / 2 * 0 + 0.0);
    const Fw = frame(sx, sz, -Math.atan2(cr.ldz, cr.ldx));
    const fp = footprint(world, sx, sz, 5, 5, Fw.ry); const y = fp.max + 0.2;
    B.box('concrete', 4.6, y - fp.min + 0.7, 4.0, sx, (y + fp.min - 0.7) / 2, sz, CONC, { ry: Fw.ry, jitter: 0.03 });
    slabCollider(world, sx, sz, 4.6, 4.0, Fw.ry, y, 1.2, { tag, surface: 'concrete' });
    B.box('plank', 4.2, 0.08, 3.6, sx, y - 0.04, sz, [0.34, 0.29, 0.21], { ry: Fw.ry, jitter: 0.04 });
    const bw = [0.95, 0.95, 0.95];
    const Fwe = frame(sx, sz, Fw.ry + Math.PI / 2);
    wall(B, world, Fw, 'brick', bw, -2.2, 2.2, -1.9, y, y + 3.0, 0.25, [{ u0: -1.6, u1: 1.6, y0: y + 1.0, y1: y + 2.3 }], { tag, ground: y, seed: 41 });   // toward the line
    wall(B, world, Fw, 'brick', bw, -2.2, 2.2, 1.9, y, y + 3.0, 0.25, [{ u0: -0.7, u1: 0.7, y0: y, y1: y + 2.2 }], { tag, ground: y, seed: 42 });
    wall(B, world, Fwe, 'brick', bw, -1.9, 1.9, 2.2, y, y + 3.0, 0.25, [{ u0: -0.6, u1: 0.6, y0: y + 1.0, y1: y + 2.3 }], { tag, ground: y, seed: 43 });
    wall(B, world, Fwe, 'brick', bw, -1.9, 1.9, -2.2, y, y + 3.0, 0.25, [], { tag, ground: y, seed: 44 });
    windowDress(B, Fw, -1.6, 1.6, -1.9, y + 1.0, y + 2.3, 0.25, rnd, { frame: [0.75, 0.72, 0.62], broken: 0.5 });
    windowDress(B, Fwe, -0.6, 0.6, 2.2, y + 1.0, y + 2.3, 0.25, rnd, { frame: [0.75, 0.72, 0.62] });
    steps(B, world, Fw.x(0, 1.9 + 0.15), Fw.z(0, 1.9 + 0.15), Math.sin(Fw.ry), Math.cos(Fw.ry), y, 1.6, tag, 'concrete');
    for (const side of [-1, 1]) roofPanel(B, 'corrugated', [0.42, 0.40, 0.36], Fw, 0, 0, y + 3.0 + 1.1, 2.4, 5.0, 0.45, side, 0.1, { seed: 45 + side });
    for (const s of [-1, 1]) gableEnd(B, 'brick', bw, Fw, s * 2.2, 0, y + 2.98, 1.9, 1.0, 0.25);
    objCollider(world, sx, y + 3.4, sz, 4.6, 0.9, 2.0, Fw.ry, { tag, surface: 'metal', noAvoid: true });
    B.box('brick', 0.5, 1.2, 0.5, Fw.x(1.5, 0.6), y + 3.8, Fw.z(1.5, 0.6), bw, { ry: Fw.ry });
    // lever frame + stove + a shelf
    for (let i = 0; i < 5; i++) { B.box('metal', 0.08, 1.2, 0.08, Fw.x(-1.0 + i * 0.5, -1.2), y + 0.75, Fw.z(-1.0 + i * 0.5, -1.2), [0.35, 0.36, 0.34], { ry: Fw.ry, rx: -0.3 + (i % 2) * 0.5 }); }
    B.box('metal', 2.6, 0.3, 0.4, Fw.x(0, -1.2), y + 0.15, Fw.z(0, -1.2), [0.3, 0.3, 0.28], { ry: Fw.ry });
    objCollider(world, Fw.x(0, -1.2), y + 0.4, Fw.z(0, -1.2), 2.6, 0.8, 0.5, Fw.ry, { tag, surface: 'metal' });
    B.cyl('metal', 0.25, 0.25, 0.9, Fw.x(1.6, 1.2), y + 0.45, Fw.z(1.6, 1.2), [0.2, 0.2, 0.19], { seg: 10 }); B.cyl('metal', 0.05, 0.05, 2.2, Fw.x(1.6, 1.2), y + 2.0, Fw.z(1.6, 1.2), [0.2, 0.2, 0.19], { seg: 6 });
    world.addCylinder(Fw.x(1.6, 1.2), Fw.z(1.6, 1.2), 0.28, y, y + 0.9, { tag, surface: 'metal' });
    B.box('plank', 0.25, 0.04, 1.2, Fw.x(-1.9, 0.6), y + 1.3, Fw.z(-1.9, 0.6), [0.42, 0.37, 0.27], { ry: Fw.ry });
    addLoot(world, tag, 'shelf', Fw.x(-1.6, 0.6), Fw.z(-1.6, 0.6), y + 1.3);
    addSpawn(world, tag, 'interior', sx, sz, y); addCover(world, Fw.x(2.9, 0), Fw.z(2.9, 0)); addCover(world, Fw.x(-2.9, 0), Fw.z(-2.9, 0));
  }
  // spots along the cutting
  for (let i = 0; i < 6; i++) { const t = 0.2 + i * 0.1; const p = pointOnPolyline(pts, t); addSpawn(world, tag, 'exterior', p.x - p.dz * 7, p.z + p.dx * 7); if (i % 2) addHide(world, tag, p.x + p.dz * 6, p.z - p.dx * 6); }
  B.finish();
}

// ---------------------------------------------------------------------------------------------
// Marsh: a rotten boat at the reed edge, duckboards toward the vents. Forest: the hunter's hut.
// ---------------------------------------------------------------------------------------------
export function buildMarsh(ctx, world, rnd) {
  const B = createBuilder(ctx, 'marsh'); B._world = world; const tag = 'marsh';
  // boat at the west edge
  const bx = -117, bz = 141; const by = Math.max(world.getHeight(bx, bz), WATER_LEVEL) - 0.15;
  const shape = new THREE.Shape(); shape.moveTo(-2.2, 0); shape.quadraticCurveTo(-1.6, 0.75, 0.2, 0.7); shape.quadraticCurveTo(1.8, 0.62, 2.4, 0); shape.quadraticCurveTo(1.8, -0.62, 0.2, -0.7); shape.quadraticCurveTo(-1.6, -0.75, -2.2, 0);
  const hole = new THREE.Path(); hole.moveTo(-1.9, 0); hole.quadraticCurveTo(-1.4, 0.55, 0.2, 0.5); hole.quadraticCurveTo(1.6, 0.45, 2.0, 0); hole.quadraticCurveTo(1.6, -0.45, 0.2, -0.5); hole.quadraticCurveTo(-1.4, -0.55, -1.9, 0);
  shape.holes.push(hole);
  const hullG = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false }); hullG.rotateX(Math.PI / 2);
  B.geo('plank', hullG, placeMatrix(bx, by + 0.55, bz, 0.12, 0.7, -0.2), [0.34, 0.30, 0.22], { jitter: 0.05 });
  const bottom = new THREE.ShapeGeometry(shape); bottom.rotateX(Math.PI / 2); B.geo('plank', bottom, placeMatrix(bx, by + 0.02, bz, 0.12, 0.7, -0.2), [0.30, 0.26, 0.20], { jitter: 0.05 });
  const Fb = frame(bx, bz, 0.7);
  for (const u of [-0.9, 0.7]) B.box('plank', 0.25, 0.04, 1.2, Fb.x(u, 0), by + 0.42, Fb.z(u, 0), [0.36, 0.32, 0.24], { ry: 0.7, rz: 0.12 });
  objCollider(world, bx, by + 0.3, bz, 4.6, 0.6, 1.6, 0.7, { tag, surface: 'wood' });
  addHide(world, tag, Fb.x(0, 1.6), Fb.z(0, 1.6)); addCover(world, Fb.x(-3, 0), Fb.z(-3, 0)); addLoot(world, tag, 'floor', Fb.x(0.2, 0), Fb.z(0.2, 0), by + 0.1);
  // duckboards from the south-west shore toward the vents
  const path = [[-96, 196], [-88, 188], [-84, 180], [-86, 173]];
  for (let s = 0; s < path.length - 1; s++) {
    const [ax, az] = path[s], [bx2, bz2] = path[s + 1]; const L = Math.hypot(bx2 - ax, bz2 - az); const yaw = Math.atan2(bx2 - ax, bz2 - az) + Math.PI / 2;
    const dx = (bx2 - ax) / L, dz = (bz2 - az) / L; const n = Math.floor(L / 0.32);
    const yA = Math.max(world.getHeight(ax, az) + 0.12, WATER_LEVEL + 0.22), yB = Math.max(world.getHeight(bx2, bz2) + 0.12, WATER_LEVEL + 0.22);
    for (let i = 0; i < n; i++) { if (rnd() < 0.07) continue; const t = (i + 0.5) / n; const x = ax + dx * t * L, z = az + dz * t * L; const y = yA + (yB - yA) * t; B.box('plank', 0.26, 0.05, 1.1, x, y + (rnd() - 0.5) * 0.02, z, [0.36, 0.33, 0.26], { ry: yaw, rz: (rnd() - 0.5) * 0.08, jitter: 0.12, noShadow: true }); }
    for (const side of [-0.45, 0.45]) B.box('plank', L, 0.08, 0.08, (ax + bx2) / 2 - dz * side, (yA + yB) / 2 - 0.06, (az + bz2) / 2 + dx * side, [0.32, 0.29, 0.22], { ry: yaw, rz: Math.atan2(yB - yA, L), jitter: 0.05, noShadow: true });
    for (let i = 0; i <= Math.floor(L / 2.5); i++) { const t = i / Math.floor(L / 2.5); const x = ax + dx * t * L, z = az + dz * t * L; const g = world.getHeight(x, z); for (const side of [-0.45, 0.45]) B.cyl('log', 0.05, 0.06, yA + (yB - yA) * t - g + 0.3, x - dz * side, (yA + (yB - yA) * t + g) / 2 - 0.15, z + dx * side, [0.30, 0.26, 0.2], { seg: 6, noShadow: true }); }
    slabCollider(world, (ax + bx2) / 2, (az + bz2) / 2, L, 1.1, yaw, (yA + yB) / 2, 0.3, { tag, surface: 'wood' });
  }
  addSpawn(world, tag, 'hidden', -90, 184); addHide(world, tag, -82, 176);
  B.finish();
}
export function buildHut(ctx, world, rnd) {
  const B = createBuilder(ctx, 'forest'); B._world = world; const tag = 'forest';
  const hx = -215, hz = -90; const F = frame(hx, hz, 0.55);
  const W = 4.4, D = 3.6, t = 0.24;
  const fp = footprint(world, hx, hz, W + 1, D + 1, F.ry); const y = fp.max + 0.22;
  const dark = [0.34, 0.28, 0.20];
  B.box('stone', W + 0.2, y - 0.1 - (fp.min - 0.6), D + 0.2, hx, (y - 0.1 + fp.min - 0.6) / 2, hz, [0.40, 0.39, 0.36], { ry: F.ry, jitter: 0.08 });
  B.box('plank', W - 0.1, 0.1, D - 0.1, hx, y - 0.05, hz, [0.32, 0.28, 0.21], { ry: F.ry, jitter: 0.04 });
  slabCollider(world, hx, hz, W + 0.2, D + 0.2, F.ry, y, 1.0, { tag, surface: 'wood' });
  const Fe = frame(hx, hz, F.ry + Math.PI / 2);
  wall(B, world, F, 'log', dark, -W / 2, W / 2, -D / 2, y, y + 2.3, t, [{ u0: -0.65, u1: 0.65, y0: y, y1: y + 2.1 }], { tag, ground: y, seed: 51 });
  wall(B, world, F, 'log', dark, -W / 2, W / 2, D / 2, y, y + 2.3, t, [{ u0: 0.4, u1: 1.2, y0: y + 1.0, y1: y + 1.7 }], { tag, ground: y, seed: 52 });
  wall(B, world, Fe, 'log', dark, -D / 2, D / 2, W / 2, y, y + 2.3, t, [], { tag, ground: y, seed: 53 });
  wall(B, world, Fe, 'log', dark, -D / 2, D / 2, -W / 2, y, y + 2.3, t, [], { tag, ground: y, seed: 54 });
  windowDress(B, F, 0.4, 1.2, D / 2, y + 1.0, y + 1.7, t, rnd, { frame: [0.5, 0.48, 0.4], broken: 0.3 });
  steps(B, world, F.x(0, -D / 2 - 0.1), F.z(0, -D / 2 - 0.1), -Math.sin(F.ry), -Math.cos(F.ry), y, 1.5, tag, 'plank');
  const pitch = 0.6, half = D / 2 + 0.4, ridgeY = y + 2.3 + Math.tan(pitch) * half;
  for (const side of [-1, 1]) roofPanel(B, 'plank', PLANK_GREY, F, 0, 0, ridgeY, half, W + 0.9, pitch, side, 0.12, { seed: 55 + side, warp: 1 });
  for (const s of [-1, 1]) gableEnd(B, 'plank', PLANK, F, s * (W / 2 - 0.02), 0, y + 2.28, D / 2 + 0.02, Math.tan(pitch) * half - 0.1, 0.16);
  objCollider(world, hx, ridgeY - 0.6, hz, W, 1.0, D * 0.5, F.ry, { tag, surface: 'wood', noAvoid: true });
  B.cyl('metal', 0.09, 0.09, 1.4, F.x(1.2, 0.8), ridgeY + 0.3, F.z(1.2, 0.8), [0.2, 0.18, 0.16], { seg: 8 });
  // stove, bunk, shelf, antlers, a stump and a woodpile outside
  B.box('metal', 0.5, 0.7, 0.5, F.x(1.2, 0.8), y + 0.35, F.z(1.2, 0.8), [0.16, 0.16, 0.15], { ry: F.ry }); B.cyl('metal', 0.06, 0.06, 1.5, F.x(1.2, 0.8), y + 1.45, F.z(1.2, 0.8), [0.2, 0.18, 0.16], { seg: 6 });
  objCollider(world, F.x(1.2, 0.8), y + 0.4, F.z(1.2, 0.8), 0.6, 0.8, 0.6, F.ry, { tag, surface: 'metal' });
  B.box('plank', 1.9, 0.08, 0.8, F.x(-1.1, 1.3), y + 0.45, F.z(-1.1, 1.3), [0.38, 0.33, 0.24], { ry: F.ry, jitter: 0.05 }); B.box('canvas', 1.8, 0.14, 0.75, F.x(-1.1, 1.3), y + 0.56, F.z(-1.1, 1.3), [0.35, 0.33, 0.26], { ry: F.ry, jitter: 0.05 });
  objCollider(world, F.x(-1.1, 1.3), y + 0.3, F.z(-1.1, 1.3), 1.9, 0.6, 0.8, F.ry, { tag, surface: 'wood' });
  for (let i = 0; i < 2; i++) B.box('plank', 0.25, 0.04, 1.4, F.x(-W / 2 + 0.15, -0.6), y + 1.2 + i * 0.4, F.z(-W / 2 + 0.15, -0.6), [0.4, 0.35, 0.25], { ry: F.ry });
  for (const [a, b] of [[-0.25, 0.1], [0.25, 0.1]]) B.cyl('plank', 0.02, 0.03, 0.5, F.x(1.6 + a, -D / 2 + 0.2), y + 1.9, F.z(1.6 + a, -D / 2 + 0.2), [0.7, 0.66, 0.55], { rz: a * 2.2, rx: 0.5, seg: 5 });
  addLoot(world, tag, 'shelf', F.x(-W / 2 + 0.5, -0.6), F.z(-W / 2 + 0.5, -0.6), y + 1.2); addLoot(world, tag, 'floor', F.x(0.8, -0.8), F.z(0.8, -0.8), y);
  addSpawn(world, tag, 'interior', hx, hz, y);
  const stx = F.x(3.6, -1.0), stz = F.z(3.6, -1.0), sty = world.getHeight(stx, stz);
  B.cyl('log', 0.28, 0.32, 0.6, stx, sty + 0.3, stz, [0.4, 0.34, 0.24], { seg: 10 }); world.addCylinder(stx, stz, 0.32, sty, sty + 0.6, { tag, surface: 'wood' });
  B.box('metal', 0.18, 0.05, 0.1, stx, sty + 0.63, stz, [0.3, 0.3, 0.28], { ry: 0.4 }); B.cyl('plank', 0.02, 0.025, 0.7, stx + 0.3, sty + 0.85, stz + 0.1, [0.42, 0.36, 0.26], { rz: 1.1, seg: 5 });
  for (let i = 0; i < 14; i++) { const r = Math.floor(i / 5); const px = F.x(W / 2 + 0.6, -1.0 + (i % 5) * 0.3 - r * 0.15), pz = F.z(W / 2 + 0.6, -1.0 + (i % 5) * 0.3 - r * 0.15); B.cyl('log', 0.11, 0.12, 0.9, px, world.getHeight(px, pz) + 0.11 + r * 0.2, pz, [0.42, 0.34, 0.24], { rz: Math.PI / 2, ry: F.ry + Math.PI / 2 + (rnd() - 0.5) * 0.1, seg: 7 }); }
  objCollider(world, F.x(W / 2 + 0.6, -0.4), y + 0.3, F.z(W / 2 + 0.6, -0.4), 1.0, 0.7, 1.8, F.ry, { tag, surface: 'wood' });
  addCover(world, F.x(W / 2 + 1.6, -0.4), F.z(W / 2 + 1.6, -0.4)); addCover(world, F.x(-W / 2 - 1.0, D / 2 + 0.6), F.z(-W / 2 - 1.0, D / 2 + 0.6));
  addHide(world, tag, F.x(-W / 2 - 1.2, -D / 2 - 1.0), F.z(-W / 2 - 1.2, -D / 2 - 1.0));
  for (let i = 0; i < 4; i++) addSpawn(world, tag, 'exterior', hx + (rnd() - 0.5) * 40, hz + (rnd() - 0.5) * 40);
  B.finish();
}

// ---------------------------------------------------------------------------------------------
export function createStructures(ctx) {
  const world = ctx.world;
  const rnd = ctx.rng.fork(1201);
  const anim = { poles: [], bell: null, barrier: null };
  const sandbags = { mats: [], tints: [] };
  const pickets = { mats: [], tints: [] };
  const cp = buildCheckpoint(ctx, world, rnd, sandbags);
  anim.barrier = cp;
  buildConvoy(ctx, world, rnd);
  const houses = buildZarya(ctx, world, rnd, pickets);
  buildObject12(ctx, world, rnd);
  const ch = buildChurch(ctx, world, rnd); anim.bell = ch.bell;
  buildRail(ctx, world, rnd);
  buildMarsh(ctx, world, rnd);
  buildHut(ctx, world, rnd);
  instanced(ctx, 'sandbag', sandbagGeometry(), sandbags.mats, sandbags.tints, { name: 'sandbags' });
  const picketG = new THREE.BoxGeometry(0.08, 0.9, 0.03); picketG.translate(0, 0.0, 0); colorize(picketG, [0.40, 0.36, 0.27], { jitter: 0, ground: -0.45, dampH: 0.5 });
  instanced(ctx, 'plank', picketG, pickets.mats, pickets.tints, { name: 'pickets', noShadow: true });
  return {
    doors: houses.map((h) => h.door),   // { x, z, inside: {x, z} } per intact izba (tests, missions)
    update(dt, t) {
      timeUniform.value = t;
      windUniform.value = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1.3);
      if (anim.bell) { anim.bell.rotation.z = Math.sin(t * 0.9) * 0.05 * (0.6 + 0.4 * Math.sin(t * 0.13)); anim.bell.rotation.x = Math.sin(t * 0.7 + 1) * 0.02; }
      if (anim.barrier) anim.barrier.pole.rotation.z = 0.35 + Math.sin(t * 0.6) * 0.012 + Math.sin(t * 2.9) * 0.004;
    },
    reset() {},
  };
}
