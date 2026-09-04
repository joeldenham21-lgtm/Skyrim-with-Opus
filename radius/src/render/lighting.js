// Sun, moon, hemisphere fill, flashlight, and the fog/sky colour schedule for the day cycle.
import * as THREE from 'three';
import { fogUniforms } from './fog.js';
import { clamp01, lerp, smoothstep, TAU } from '../core/math.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
// keyframes by hour: [hour, horizon, zenith, sun, fogDensity, sunIntensity, hemiSky, hemiGround, ambient]
const KEYS = [
  [0,    C(0.040, 0.045, 0.062), C(0.010, 0.012, 0.018), C(0.5, 0.6, 0.8),    0.0038, 0.0,  C(0.05, 0.06, 0.09), C(0.02, 0.02, 0.02), 0.07],
  [4.5,  C(0.045, 0.05, 0.068),  C(0.012, 0.014, 0.02),  C(0.5, 0.6, 0.8),    0.0040, 0.0,  C(0.05, 0.06, 0.09), C(0.02, 0.02, 0.02), 0.07],
  [6.0,  C(0.36, 0.29, 0.26),    C(0.14, 0.16, 0.21),    C(1.0, 0.62, 0.38),  0.0034, 0.5,  C(0.30, 0.28, 0.32), C(0.11, 0.10, 0.08), 0.22],
  [8.0,  C(0.54, 0.56, 0.58),    C(0.26, 0.30, 0.36),    C(1.0, 0.9, 0.78),   0.0027, 0.95, C(0.50, 0.53, 0.57), C(0.20, 0.20, 0.16), 0.30],
  [12.0, C(0.60, 0.62, 0.64),    C(0.30, 0.34, 0.40),    C(1.0, 0.96, 0.9),   0.0024, 1.15, C(0.56, 0.59, 0.62), C(0.23, 0.23, 0.18), 0.32],
  [16.0, C(0.55, 0.55, 0.56),    C(0.28, 0.31, 0.36),    C(1.0, 0.9, 0.78),   0.0027, 0.92, C(0.50, 0.52, 0.55), C(0.20, 0.19, 0.15), 0.29],
  [19.0, C(0.48, 0.31, 0.22),    C(0.16, 0.15, 0.20),    C(1.0, 0.55, 0.28),  0.0033, 0.45, C(0.32, 0.25, 0.25), C(0.13, 0.10, 0.07), 0.20],
  [20.5, C(0.08, 0.07, 0.09),    C(0.022, 0.023, 0.032), C(0.7, 0.5, 0.5),    0.0038, 0.0,  C(0.07, 0.07, 0.10), C(0.03, 0.03, 0.03), 0.09],
  [24,   C(0.040, 0.045, 0.062), C(0.010, 0.012, 0.018), C(0.5, 0.6, 0.8),    0.0038, 0.0,  C(0.05, 0.06, 0.09), C(0.02, 0.02, 0.02), 0.07],
];

export function createLighting(ctx) {
  const { scene } = ctx;
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target);
  const moon = new THREE.DirectionalLight(0x8090c0, 0.0);
  scene.add(moon); scene.add(moon.target);
  const hemi = new THREE.HemisphereLight(0x8899aa, 0x333328, 1.0);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambient);
  scene.fog = new THREE.FogExp2(0x8a9098, 0.0034);

  // flashlight: parented to the camera, slightly offset like a hand-held torch
  const flashlight = new THREE.SpotLight(0xffe2b8, 0, 60, 0.46, 0.7, 1.4);
  flashlight.position.set(0.22, -0.18, 0.1);
  flashlight.target.position.set(0.05, -0.05, -6);
  flashlight.castShadow = false;
  ctx.camera.add(flashlight); ctx.camera.add(flashlight.target);

  const sunDir = new THREE.Vector3(), tmp = new THREE.Vector3();
  const api = {
    sun, moon, hemi, ambient, flashlight, sunDir,
    horizon: new THREE.Color(), zenith: new THREE.Color(), sunColor: new THREE.Color(),
    flashOn: false, flashTarget: 0, flashLevel: 0, storm: 0,
    update(dt) {
      const h = ctx.time.hour;
      let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
      const a = KEYS[i], b = KEYS[i + 1];
      const t = smoothstep(a[0], b[0], h);
      api.horizon.copy(a[1]).lerp(b[1], t);
      api.zenith.copy(a[2]).lerp(b[2], t);
      api.sunColor.copy(a[3]).lerp(b[3], t);
      const density = lerp(a[4], b[4], t);
      const sunI = lerp(a[5], b[5], t);
      hemi.color.copy(a[6]).lerp(b[6], t); hemi.groundColor.copy(a[7]).lerp(b[7], t);
      ambient.intensity = lerp(a[8], b[8], t);

      const ang = ctx.time.sunAngle();
      sunDir.set(Math.cos(ang), Math.sin(ang) * 0.72 + 0.04, -0.42).normalize();
      const night = ctx.time.night;
      // sun light follows the player so the shadow box stays useful
      const p = ctx.player ? ctx.player.position : ctx.camera.position;
      sun.position.copy(p).addScaledVector(sunDir, 120);
      sun.target.position.copy(p);
      sun.color.copy(api.sunColor);
      sun.intensity = sunI * 1.15;
      sun.visible = sunI > 0.02;
      // moon: opposite-ish, dim, blue
      tmp.set(-sunDir.x * 0.6, 0.55, 0.5).normalize();
      moon.position.copy(p).addScaledVector(tmp, 100); moon.target.position.copy(p);
      moon.intensity = night * 0.32;
      moon.visible = night > 0.05;

      scene.fog.color.copy(api.horizon);
      scene.fog.density = density * (1 + api.storm * 0.6);
      fogUniforms.uFogSun.value.copy(sunI > 0.02 ? sunDir : tmp);
      fogUniforms.uFogSunColor.value.copy(api.sunColor).multiplyScalar(sunI * 0.9 + night * 0.08);
      fogUniforms.uFogZenith.value.copy(api.zenith);
      // ground fog thicker at night and dawn
      fogUniforms.uFogHeight.value.set(0.07, -3.0, 1.2 + night * 1.6 + (1 - Math.abs(h - 6) / 2 > 0 ? (1 - Math.abs(h - 6) / 2) * 1.4 : 0), 0);

      const sky = ctx.sky;
      if (sky) {
        sky.uniforms.uSunDir.value.copy(sunDir);
        sky.uniforms.uMoonDir.value.copy(tmp);
        sky.uniforms.uNight.value = night;
        sky.uniforms.uHorizon.value.copy(api.horizon);
        sky.uniforms.uZenith.value.copy(api.zenith);
        sky.uniforms.uSunColor.value.copy(api.sunColor);
      }
      // flashlight with a little warm-up and battery sag
      api.flashLevel += (api.flashTarget - api.flashLevel) * Math.min(1, dt * 14);
      const bat = ctx.state.data.flashlight.battery / 100;
      flashlight.intensity = api.flashLevel * 42 * (0.55 + 0.45 * clamp01(bat * 3));
      flashlight.visible = flashlight.intensity > 0.5;
    },
    setFlashlight(on) { api.flashOn = on; api.flashTarget = on ? 1 : 0; },
  };
  return api;
}
