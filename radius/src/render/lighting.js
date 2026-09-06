// Sun with cascaded shadow maps (the moon takes the cascades over at night), hemisphere fill, the carried lights
// (torch, headlamp, weapon light) with their volumetric beam cones, the storm state, and the fog/sky colour
// schedule for the day cycle.
//
// Cascades are wired GLOBALLY through the shader chunks rather than per material: every lit material in the zone
// belongs to another module and most of them already own an onBeforeCompile, so CSM.setupMaterial() cannot be used.
// The cascade splits are constants per quality tier, so they are baked into `lights_pars_begin` as GLSL constants
// and the cascade loop lives in `lights_fragment_begin`. A tier change alters the number of directional lights,
// which makes three recompile every lit program with the freshly baked chunk.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { CSMShader } from 'three/addons/csm/CSMShader.js';
import { CSMFrustum } from 'three/addons/csm/CSMFrustum.js';
import { fogUniforms } from './fog.js';
import { GLSL_NOISE } from './glsl.js';
import { clamp01, lerp, smoothstep } from '../core/math.js';

// ---- shader chunks (module scope: weapons/gunmesh.js captures lights_fragment_begin when it is imported) ----
const LIGHTS_PARS_ORIGINAL = THREE.ShaderChunk.lights_pars_begin;
const LIGHTS_BEGIN_CSM = CSMShader.lights_fragment_begin
  .replace('float linearDepth = (vViewPosition.z) / (shadowFar - cameraNear);', 'float linearDepth = vViewPosition.z * csmInvDepthRange;')
  .replace(/CSM_cascades\[/g, 'csmCascades[');
const CSM_OK = LIGHTS_BEGIN_CSM.indexOf('csmInvDepthRange') >= 0;
if (CSM_OK) THREE.ShaderChunk.lights_fragment_begin = LIGHTS_BEGIN_CSM;
else console.warn('[lighting] CSM chunk did not match this three version; cascades disabled');
// breaks: cumulative cascade ends as fractions of the shadow range (null restores the plain single-light chunk)
function installCascadeConstants(breaks, depthRange) {
  if (!breaks || !CSM_OK) { THREE.ShaderChunk.lights_pars_begin = LIGHTS_PARS_ORIGINAL; return; }
  const n = breaks.length;
  const arr = breaks.map((b, i) => `vec2(${(i ? breaks[i - 1] : 0).toFixed(6)}, ${b.toFixed(6)})`).join(', ');
  THREE.ShaderChunk.lights_pars_begin = `#define USE_CSM 1\n#define CSM_CASCADES ${n}\n#define CSM_FADE\nconst vec2 csmCascades[${n}] = vec2[${n}](${arr});\nconst float csmInvDepthRange = ${(1 / depthRange).toFixed(8)};\n` + LIGHTS_PARS_ORIGINAL;
}

// CSM without its material hooks (chunks are installed above) and with an allocation-free update.
const _lightOri = new THREE.Matrix4(), _lightOriInv = new THREE.Matrix4(), _camToLight = new THREE.Matrix4(), _bbox = new THREE.Box3(), _center = new THREE.Vector3(), _zero = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _lightSpaceFrustum = new CSMFrustum({ webGL: true });
class RadiusCSM extends CSM {
  injectInclude() {}
  setupMaterial() {}
  update() {
    const camera = this.camera, frustums = this.frustums;
    _lightOri.lookAt(_zero, this.lightDirection, _up);
    _lightOriInv.copy(_lightOri).invert();
    for (let i = 0; i < frustums.length; i++) {
      const light = this.lights[i], shadowCam = light.shadow.camera;
      const texelW = (shadowCam.right - shadowCam.left) / this.shadowMapSize, texelH = (shadowCam.top - shadowCam.bottom) / this.shadowMapSize;
      _camToLight.multiplyMatrices(_lightOriInv, camera.matrixWorld);
      frustums[i].toSpace(_camToLight, _lightSpaceFrustum);
      const nv = _lightSpaceFrustum.vertices.near, fv = _lightSpaceFrustum.vertices.far;
      _bbox.makeEmpty();
      for (let j = 0; j < 4; j++) { _bbox.expandByPoint(nv[j]); _bbox.expandByPoint(fv[j]); }
      _bbox.getCenter(_center);
      _center.z = _bbox.max.z + this.lightMargin;
      _center.x = Math.floor(_center.x / texelW) * texelW;     // texel snapping: shadows do not swim when the camera moves
      _center.y = Math.floor(_center.y / texelH) * texelH;
      _center.applyMatrix4(_lightOri);
      light.position.copy(_center);
      light.target.position.copy(_center).add(this.lightDirection);
    }
  }
}

const C = (r, g, b) => new THREE.Color(r, g, b);
// keyframes by hour: [hour, horizon, zenith, sun, fogDensity, sunIntensity, hemiSky, hemiGround, ambient]
const KEYS = [
  [0,    C(0.040, 0.045, 0.062), C(0.010, 0.012, 0.018), C(0.5, 0.6, 0.8),    0.0038, 0.0,  C(0.05, 0.06, 0.09), C(0.02, 0.02, 0.02), 0.07],
  [4.5,  C(0.045, 0.05, 0.068),  C(0.012, 0.014, 0.02),  C(0.5, 0.6, 0.8),    0.0040, 0.0,  C(0.05, 0.06, 0.09), C(0.02, 0.02, 0.02), 0.07],
  [6.0,  C(0.42, 0.34, 0.30),    C(0.17, 0.19, 0.24),    C(1.0, 0.66, 0.42),  0.0034, 0.7,  C(0.42, 0.40, 0.43), C(0.15, 0.14, 0.11), 0.30],
  [8.0,  C(0.56, 0.58, 0.60),    C(0.27, 0.31, 0.37),    C(1.0, 0.9, 0.78),   0.0027, 1.1,  C(0.60, 0.62, 0.65), C(0.24, 0.23, 0.19), 0.38],
  [12.0, C(0.60, 0.62, 0.64),    C(0.30, 0.34, 0.40),    C(1.0, 0.96, 0.9),   0.0024, 1.2,  C(0.64, 0.66, 0.69), C(0.26, 0.25, 0.20), 0.40],
  [16.0, C(0.55, 0.55, 0.56),    C(0.28, 0.31, 0.36),    C(1.0, 0.9, 0.78),   0.0027, 1.0,  C(0.58, 0.60, 0.63), C(0.23, 0.22, 0.18), 0.36],
  [19.0, C(0.48, 0.31, 0.22),    C(0.16, 0.15, 0.20),    C(1.0, 0.55, 0.28),  0.0033, 0.45, C(0.32, 0.25, 0.25), C(0.13, 0.10, 0.07), 0.20],
  [20.5, C(0.08, 0.07, 0.09),    C(0.022, 0.023, 0.032), C(0.7, 0.5, 0.5),    0.0038, 0.0,  C(0.07, 0.07, 0.10), C(0.03, 0.03, 0.03), 0.09],
  [24,   C(0.040, 0.045, 0.062), C(0.010, 0.012, 0.018), C(0.5, 0.6, 0.8),    0.0038, 0.0,  C(0.05, 0.06, 0.09), C(0.02, 0.02, 0.02), 0.07],
];
const STORM_HORIZON = C(0.30, 0.31, 0.33), STORM_ZENITH = C(0.14, 0.15, 0.17);
const MOON_COLOR = C(0.55, 0.62, 0.80);

// shadow tiers: cascades follow the camera; 'low' keeps the single 140 m box around the player
const SHADOW_TIERS = {
  low:    { cascades: 0, maxFar: 140, mapSize: 2048 },
  medium: { cascades: 2, maxFar: 130, mapSize: 1536, splits: [0.22, 1.0] },
  high:   { cascades: 3, maxFar: 180, mapSize: 2048, splits: [0.10, 0.30, 1.0] },
};

// ---- volumetric beam cones: rendered by post.js after the scene, ray-marched against the scene depth ----
const BEAM_VERT = /* glsl */`varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FRAG = /* glsl */`
  ${GLSL_NOISE}
  #include <packing>
  uniform sampler2D uDepth; uniform vec2 uRes; uniform float uNear, uFar, uTime, uIntensity, uTanAngle, uPenumbra, uLength, uSeed, uNoise;
  uniform mat4 uInvModel; uniform vec3 uColor;
  varying vec3 vWorld;
  void main(){
    vec3 ro = cameraPosition;
    vec3 rel = vWorld - ro;
    float exitDist = length(rel);
    vec3 rd = rel / max(exitDist, 1e-4);
    // the scene surface along this ray clips the march (depth of the frame being composited)
    vec2 suv = gl_FragCoord.xy / uRes;
    float vz = perspectiveDepthToViewZ(texture2D(uDepth, suv).x, uNear, uFar);
    float rdz = (viewMatrix * vec4(rd, 0.0)).z;
    float sceneDist = vz / min(rdz, -1e-4);
    float S = min(exitDist, sceneDist);
    if (S <= 0.02) discard;
    float dither = hash21(gl_FragCoord.xy + fract(uTime * 7.31) * 311.0);
    float sum = 0.0;
    // samples packed toward the lamp, where the beam is dense (s = S u^2, ds = 2 S u du)
    for (int i = 0; i < BEAM_STEPS; i++) {
      float u = (float(i) + dither) / float(BEAM_STEPS);
      float s = S * u * u;
      vec3 wp = ro + rd * s;
      vec3 p = (uInvModel * vec4(wp, 1.0)).xyz;      // cone space: apex at the origin, axis -z
      float dz = -p.z;
      if (dz <= 0.0) continue;
      float r = length(p.xy) / (dz * uTanAngle);
      float edge = 1.0 - smoothstep(1.0 - uPenumbra, 1.0, r);
      float fall = 1.0 / (1.0 + 0.05 * dz * dz) * (1.0 - smoothstep(uLength * 0.6, uLength, dz));
      // scattering medium: drifting dust and drizzle, anchored to the world so it does not ride with the lamp
      float n = 1.0 - uNoise + uNoise * 2.0 * vnoise3(wp * vec3(1.9, 1.3, 1.9) + vec3(uSeed, -uTime * 0.45, uTime * 0.17));
      float nearFade = smoothstep(0.08, 0.9, s);
      sum += edge * fall * n * nearFade * (2.0 * u / float(BEAM_STEPS)) * S;
    }
    sum = min(sum, 6.0);
    gl_FragColor = vec4(uColor * (uIntensity * sum), 1.0);
  }`;

export function createLighting(ctx) {
  const { scene } = ctx;
  const moon = new THREE.DirectionalLight(0x8090c0, 0.0);
  scene.add(moon); scene.add(moon.target);
  const hemi = new THREE.HemisphereLight(0x8899aa, 0x333328, 1.0);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambient);
  scene.fog = new THREE.FogExp2(0x8a9098, 0.0034);

  // flashlight: parented to the camera, slightly offset like a hand-held torch
  const flashlight = new THREE.SpotLight(0xffe2b8, 0, 60, 0.46, 0.7, 1.4);
  // the lamp head sits ahead of the hands so the viewmodel is behind the cone and never blows out
  flashlight.position.set(0.28, -0.22, -0.8);
  flashlight.target.position.set(0.05, -0.08, -7);
  flashlight.castShadow = false;
  ctx.camera.add(flashlight); ctx.camera.add(flashlight.target);
  // headlamp: wider, weaker, mounted at the brow; weapon light: parented to the hands root, positioned by weapons at the muzzle
  const headlamp = new THREE.SpotLight(0xfff0d0, 0, 40, 0.62, 0.8, 1.5);
  headlamp.position.set(0, 0.12, -0.05); headlamp.target.position.set(0, 0.0, -6);
  ctx.camera.add(headlamp); ctx.camera.add(headlamp.target);
  const weaponLight = new THREE.SpotLight(0xf4f0ff, 0, 55, 0.36, 0.6, 1.5);
  weaponLight.position.set(0, 0, 0); weaponLight.target.position.set(0, 0, -8);
  ctx.camera.add(weaponLight); ctx.camera.add(weaponLight.target);   // main.js re-parents it under hands.root once the rig exists

  // ---- sun shadows: cascades (medium/high) or the single box (low), rebuilt when the quality tier changes ----
  let csm = null, boxSun = null, sunLights = [], shadowTier = null, lastFov = 0, lastAspect = 0;
  function currentTier() { const q = ctx.renderApi ? ctx.renderApi.quality : ctx.quality; return SHADOW_TIERS[q] ? q : 'high'; }
  function buildShadows(q) {
    if (csm) { csm.remove(); for (const l of csm.lights) l.shadow.dispose(); csm = null; }
    if (boxSun) { scene.remove(boxSun); scene.remove(boxSun.target); boxSun.shadow.dispose(); boxSun = null; }
    const T = SHADOW_TIERS[q];
    const mapSize = window.__radiusFast ? 1024 : T.mapSize;
    const cam = ctx.camera;
    if (T.cascades > 0 && CSM_OK) {
      csm = new RadiusCSM({
        camera: cam, parent: scene, cascades: T.cascades, maxFar: T.maxFar, mode: 'custom',
        customSplitsCallback: (n, near, far, target) => { target.length = 0; for (const s of T.splits) target.push(s); },
        shadowMapSize: mapSize, lightDirection: new THREE.Vector3(0.001, -1, 0.001).normalize(), lightIntensity: 1, lightNear: 1, lightFar: 520, lightMargin: 160,
      });
      csm.fade = true; csm.updateFrustums();
      // bias per cascade from its texel size: enough to keep the terrain clean at grazing sun, little enough that a birch trunk stays rooted
      const diagK = 2 * Math.tan((cam.fov * Math.PI / 180) * 0.5) * Math.sqrt(1 + cam.aspect * cam.aspect);
      csm.lights.forEach((l, i) => {
        const far = T.maxFar * T.splits[i];
        const texel = diagK * far / mapSize;
        l.shadow.normalBias = Math.max(0.03, texel * 1.5);
        l.shadow.bias = -Math.max(0.00003, 0.5 * texel / 519);
        l.shadow.radius = 2;
        l.name = 'sun-cascade-' + i;
      });
      installCascadeConstants(csm.breaks, Math.min(cam.far, T.maxFar) - cam.near);
      sunLights = csm.lights;
    } else {
      boxSun = new THREE.DirectionalLight(0xffffff, 1.0);
      boxSun.castShadow = true;
      boxSun.shadow.mapSize.set(mapSize, mapSize);
      boxSun.shadow.camera.near = 1; boxSun.shadow.camera.far = 220;
      boxSun.shadow.camera.left = -70; boxSun.shadow.camera.right = 70; boxSun.shadow.camera.top = 70; boxSun.shadow.camera.bottom = -70;
      boxSun.shadow.bias = -0.0006; boxSun.shadow.normalBias = 0.6; boxSun.shadow.radius = 3;
      boxSun.name = 'sun';
      scene.add(boxSun); scene.add(boxSun.target);
      installCascadeConstants(null);
      sunLights = [boxSun];
    }
    lastFov = cam.fov; lastAspect = cam.aspect;
    shadowTier = q;
    api.sun = sunLights[0];
    api.cascades = csm ? T.cascades : 0;
  }

  // ---- beam cones ----
  const beamScene = new THREE.Scene();
  const beamUniformsShared = { uDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 }, uFar: { value: 2600 }, uTime: { value: 0 } };
  const beams = [];
  function makeBeam(light, length, seed) {
    const r = Math.tan(light.angle) * length;
    const geo = new THREE.CylinderGeometry(0.012, r, length, 28, 4, false);
    geo.rotateX(-Math.PI / 2);        // +y (narrow top) -> -z
    geo.translate(0, 0, -length / 2);  // apex at the origin
    const mat = new THREE.ShaderMaterial({
      defines: { BEAM_STEPS: 8 },
      uniforms: Object.assign({ uIntensity: { value: 0 }, uTanAngle: { value: Math.tan(light.angle) }, uPenumbra: { value: light.penumbra }, uLength: { value: length }, uSeed: { value: seed }, uNoise: { value: 0.45 }, uInvModel: { value: new THREE.Matrix4() }, uColor: { value: new THREE.Color() } }, beamUniformsShared),
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false; mesh.frustumCulled = true; mesh.visible = false;
    beamScene.add(mesh);
    const b = { light, mesh, mat, length, level: 0, intensity: 0 };
    beams.push(b);
    return b;
  }
  const beamTorch = makeBeam(flashlight, 30, 3.1), beamHead = makeBeam(headlamp, 22, 7.7), beamWeapon = makeBeam(weaponLight, 30, 11.3);
  const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _dir = new THREE.Vector3(), _orient = new THREE.Matrix4(), _fwd = new THREE.Vector3(0, 0, -1);

  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(0, 1, 0);
  const api = {
    sun: null, moon, hemi, ambient, flashlight, headlamp, weaponLight, sunDir, moonDir, headlampTarget: 0, headlampLevel: 0, weaponLightTarget: 0, weaponLightLevel: 0, weaponLightIntensity: 30,
    horizon: new THREE.Color(), zenith: new THREE.Color(), sunColor: new THREE.Color(),
    flashOn: false, flashTarget: 0, flashLevel: 0, storm: 0,
    lightning: 0,          // written by sky.js during a strike
    sunIntensity: 0,       // current sun strength (0 at night)
    fogDensity: 0.0034,    // base distance fog density this frame (before the storm term)
    moonLit: false,        // true when the shadow cascades are following the moon
    cascades: 0,
    beams, beamScene,
    get csm() { return csm; },
    update(dt) {
      // quality tier (may change from the settings menu at any time)
      const q = currentTier();
      if (q !== shadowTier) buildShadows(q);
      const cam = ctx.camera;
      if (csm && (cam.fov !== lastFov || cam.aspect !== lastAspect)) { csm.updateFrustums(); lastFov = cam.fov; lastAspect = cam.aspect; }

      const h = ctx.time.hour;
      let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
      const a = KEYS[i], b = KEYS[i + 1];
      const t = smoothstep(a[0], b[0], h);
      const storm = clamp01(api.storm);
      api.horizon.copy(a[1]).lerp(b[1], t);
      api.zenith.copy(a[2]).lerp(b[2], t);
      api.sunColor.copy(a[3]).lerp(b[3], t);
      const density = lerp(a[4], b[4], t);
      let sunI = lerp(a[5], b[5], t);
      hemi.color.copy(a[6]).lerp(b[6], t); hemi.groundColor.copy(a[7]).lerp(b[7], t);
      ambient.intensity = lerp(a[8], b[8], t);
      // weather: a storm flattens the light, greys the sky and pulls the fog in
      if (storm > 0.001) {
        const day = clamp01(sunI / 0.6);
        api.horizon.lerp(STORM_HORIZON, storm * 0.55 * day); api.zenith.lerp(STORM_ZENITH, storm * 0.55 * day);
        sunI *= 1 - storm * 0.55;
        hemi.intensity = 1 - storm * 0.25;
      } else hemi.intensity = 1;
      // lightning (sky.js drives it): the whole zone blinks blue-white for a frame or two
      const bolt = clamp01(api.lightning || 0);
      if (bolt > 0.001) { hemi.intensity += bolt * 2.2; ambient.intensity += bolt * 0.45; }
      api.sunIntensity = sunI; api.fogDensity = density;

      const ang = ctx.time.sunAngle();
      sunDir.set(Math.cos(ang), Math.sin(ang) * 0.72 + 0.04, -0.42).normalize();
      const night = ctx.time.night;
      moonDir.set(-sunDir.x * 0.6, 0.55, 0.5).normalize();
      // the cascades follow the sun by day and the moon by night, so shadows never go to waste
      const useMoon = sunI <= 0.02;
      const dir = useMoon ? moonDir : sunDir;
      const inten = useMoon ? night * 0.34 : sunI * 1.15;
      const col = useMoon ? MOON_COLOR : api.sunColor;
      api.moonLit = useMoon;
      const p = ctx.player ? ctx.player.position : cam.position;
      if (csm) {
        cam.updateWorldMatrix(true, false);
        csm.lightDirection.copy(dir).negate();
        csm.update();
      } else {
        boxSun.position.copy(p).addScaledVector(dir, 120);
        boxSun.target.position.copy(p);
      }
      for (let k = 0; k < sunLights.length; k++) { sunLights[k].color.copy(col); sunLights[k].intensity = inten; sunLights[k].visible = true; }
      // moon: opposite-ish, dim, blue; only a plain fill while the cascades are still on the sun (dusk overlap)
      moon.position.copy(p).addScaledVector(moonDir, 100); moon.target.position.copy(p);
      moon.intensity = useMoon ? 0 : night * 0.32;
      moon.visible = true;   // stays in the light list; toggling visibility would recompile every material

      scene.fog.color.copy(api.horizon);
      scene.fog.density = density * (1 + storm * 0.6);
      fogUniforms.uFogSun.value.copy(sunI > 0.02 ? sunDir : moonDir);
      fogUniforms.uFogSunColor.value.copy(api.sunColor).multiplyScalar(sunI * 0.9 + night * 0.08);
      fogUniforms.uFogZenith.value.copy(api.zenith);
      // ground fog thicker at night, at dawn and under rain
      fogUniforms.uFogHeight.value.set(0.07, -3.0, 1.2 + night * 1.6 + (1 - Math.abs(h - 6) / 2 > 0 ? (1 - Math.abs(h - 6) / 2) * 1.4 : 0) + storm * 0.8, 0);

      const sky = ctx.sky;
      if (sky) {
        sky.uniforms.uSunDir.value.copy(sunDir);
        sky.uniforms.uMoonDir.value.copy(moonDir);
        sky.uniforms.uNight.value = night;
        sky.uniforms.uHorizon.value.copy(api.horizon);
        sky.uniforms.uZenith.value.copy(api.zenith);
        sky.uniforms.uSunColor.value.copy(api.sunColor);
        if (sky.uniforms.uStorm) sky.uniforms.uStorm.value = storm;
        if (sky.uniforms.uSunI) sky.uniforms.uSunI.value = sunI;
      }
      // flashlight with a little warm-up and battery sag
      api.flashLevel += (api.flashTarget - api.flashLevel) * Math.min(1, dt * 14);
      const bat = ctx.state.data.flashlight.battery / 100;
      flashlight.intensity = api.flashLevel * 42 * (0.55 + 0.45 * clamp01(bat * 3));
      flashlight.visible = true;   // stays in the light list; toggling visibility would recompile every material
      api.headlampLevel += (api.headlampTarget - api.headlampLevel) * Math.min(1, dt * 12);
      headlamp.intensity = api.headlampLevel * (api.headlampIntensity || 18); headlamp.visible = true;
      api.weaponLightLevel += (api.weaponLightTarget - api.weaponLightLevel) * Math.min(1, dt * 16);
      weaponLight.intensity = api.weaponLightLevel * (api.weaponLightIntensity || 30); weaponLight.visible = true;

      // beam cones: what the eye sees of the carried lights in the air itself
      const medium = 0.35 + 0.65 * night;
      const scatter = (1 + storm * 2.2 + Math.max(0, density / 0.0027 - 1) * 0.8) * medium;
      beamTorch.level = api.flashLevel * (0.55 + 0.45 * clamp01(bat * 3));
      beamHead.level = api.headlampLevel * ((api.headlampIntensity || 18) / 18) * 0.7;
      beamWeapon.level = api.weaponLightLevel * ((api.weaponLightIntensity || 30) / 30);
      for (const bm of beams) { bm.intensity = bm.level * 0.014 * scatter; bm.mesh.visible = bm.intensity > 0.0004; bm.mat.uniforms.uNoise.value = 0.35 + 0.3 * storm; }
    },
    // Called by post.js once the frame's depth is known. Draws the visible cones additively into the bound target.
    renderBeams(renderer, camera, depthTexture, width, height, steps = 8) {
      let any = false;
      for (const bm of beams) if (bm.mesh.visible) any = true;
      if (!any || !depthTexture) return false;
      beamUniformsShared.uDepth.value = depthTexture;
      beamUniformsShared.uRes.value.set(width, height);
      beamUniformsShared.uNear.value = camera.near; beamUniformsShared.uFar.value = camera.far;
      beamUniformsShared.uTime.value = ctx.elapsed;
      for (const bm of beams) {
        if (!bm.mesh.visible) continue;
        const L = bm.light;
        // the light's own frame has no rotation; aim the cone at the target in the light's parent space
        _dir.copy(L.target.position).sub(L.position);
        if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, -1);
        _qi.copy(L.quaternion).invert(); _dir.applyQuaternion(_qi).normalize();
        _q.setFromUnitVectors(_fwd, _dir);
        _orient.makeRotationFromQuaternion(_q);
        bm.mesh.matrix.copy(L.matrixWorld).multiply(_orient);
        bm.mesh.matrixWorld.copy(bm.mesh.matrix);
        bm.mat.uniforms.uInvModel.value.copy(bm.mesh.matrix).invert();
        bm.mat.uniforms.uIntensity.value = bm.intensity;
        bm.mat.uniforms.uColor.value.copy(L.color);
        bm.mat.uniforms.uTanAngle.value = Math.tan(L.angle); bm.mat.uniforms.uPenumbra.value = Math.max(0.05, L.penumbra);
        if (bm.mat.defines.BEAM_STEPS !== steps) { bm.mat.defines.BEAM_STEPS = steps; bm.mat.needsUpdate = true; }
      }
      renderer.render(beamScene, camera);
      return true;
    },
    setFlashlight(on) { api.flashOn = on; api.flashTarget = on ? 1 : 0; },
    setHeadlamp(on, intensity = 18) { api.headlampTarget = on ? 1 : 0; api.headlampIntensity = intensity; },
    setWeaponLight(on, intensity = 30) { api.weaponLightTarget = on ? 1 : 0; api.weaponLightIntensity = intensity; },
    // any light the player carries is on: entities use this for visibility
    get anyLightOn() { return api.flashTarget > 0 || api.headlampTarget > 0 || api.weaponLightTarget > 0; },
  };
  buildShadows(currentTier());
  return api;
}
