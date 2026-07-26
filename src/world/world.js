/**
 * WYRMHOLD — world state and scene assembly.
 *
 * Owns the clock, the weather simulation, the sun/moon rig and the cascaded
 * shadows, and exposes a single `env` object that every other system reads:
 * the sky shader, the terrain splat, the post-processing fog, the wind on the
 * grass and the mood of the music all come from here.
 */

import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { settings } from '../core/settings.js';
import { Heightfield, WORLD_SIZE, WORLD_HALF, SEA_LEVEL } from './heightfield.js';
import { Terrain } from './terrain.js';
import { WaterSystem } from './water.js';
import { ScatterSystem, GrassField, windUniforms } from './scatter.js';
import { clamp, saturate, lerp, damp, mod, TAU, Rand, Noise, clockString } from '../core/math.js';

export const LAYER_DEFAULT = 0;
export const LAYER_WATER = 1;

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export const WEATHER = {
  clear: { label: 'Clear', cloudCover: 0.16, cloudDensity: 0.7, rain: 0, snow: 0, fog: 0.16, wind: 0.22, turbidity: 0.28, weight: 3 },
  fair: { label: 'Fair', cloudCover: 0.42, cloudDensity: 0.95, rain: 0, snow: 0, fog: 0.24, wind: 0.35, turbidity: 0.36, weight: 4 },
  overcast: { label: 'Overcast', cloudCover: 0.80, cloudDensity: 1.25, rain: 0, snow: 0, fog: 0.42, wind: 0.45, turbidity: 0.50, weight: 3 },
  mist: { label: 'Mist', cloudCover: 0.55, cloudDensity: 0.9, rain: 0, snow: 0, fog: 0.92, wind: 0.12, turbidity: 0.62, weight: 1.4 },
  rain: { label: 'Rain', cloudCover: 0.92, cloudDensity: 1.45, rain: 0.85, snow: 0, fog: 0.55, wind: 0.62, turbidity: 0.58, weight: 2 },
  storm: { label: 'Thunderstorm', cloudCover: 0.98, cloudDensity: 1.75, rain: 1.0, snow: 0, fog: 0.62, wind: 0.95, turbidity: 0.68, weight: 0.8 },
  snow: { label: 'Snowfall', cloudCover: 0.88, cloudDensity: 1.3, rain: 0, snow: 0.8, fog: 0.5, wind: 0.4, turbidity: 0.52, weight: 2 },
  blizzard: { label: 'Blizzard', cloudCover: 1.0, cloudDensity: 1.7, rain: 0, snow: 1.0, fog: 0.85, wind: 1.0, turbidity: 0.62, weight: 0.7 },
};

const WEATHER_KEYS = Object.keys(WEATHER);

// ---------------------------------------------------------------------------

export class World {
  constructor(renderer, bakery, opts = {}) {
    this.renderer = renderer;
    this.bakery = bakery;
    this.seed = opts.seed ?? 20260726;

    this.scene = new THREE.Scene();
    this.scene.name = 'world';

    this.hf = new Heightfield(this.seed);
    this.noise = new Noise(this.seed + 909);
    this.rand = new Rand(this.seed + 77);

    // --- baked world data -------------------------------------------------
    const ht = this.hf.buildHeightTexture(1024);
    this.heightTexture = new THREE.DataTexture(ht.data, ht.size, ht.size, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTexture.minFilter = this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.needsUpdate = true;

    this.biomeTexture = new THREE.DataTexture(this.hf.biomeData, this.hf.biomeRes, this.hf.biomeRes, THREE.RGBAFormat);
    this.biomeTexture.minFilter = this.biomeTexture.magFilter = THREE.LinearFilter;
    this.biomeTexture.wrapS = this.biomeTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.biomeTexture.needsUpdate = true;

    // --- systems ----------------------------------------------------------
    this.terrain = new Terrain(this.hf, bakery, this.biomeTexture);
    this.scene.add(this.terrain.group);

    this.water = new WaterSystem(this.hf, this.heightTexture);
    this.water.group.traverse(o => o.layers.set(LAYER_WATER));
    this.scene.add(this.water.group);

    this.scatter = new ScatterSystem(this.hf, bakery);
    this.scene.add(this.scatter.group);

    this.grass = new GrassField(this.hf, this.scatter);
    this.scene.add(this.grass.group);

    this.props = new THREE.Group();
    this.props.name = 'props';
    this.scene.add(this.props);

    this.fx = new THREE.Group();
    this.fx.name = 'fx';
    this.scene.add(this.fx);

    // --- environment state -------------------------------------------------
    this.env = {
      // clock
      day: 1,
      hour: 7.4,
      timeSec: 0,
      // celestial
      sunDir: new THREE.Vector3(0.4, 0.6, 0.3).normalize(),
      sunDirView: new THREE.Vector3(0, 1, 0),
      moonDir: new THREE.Vector3(-0.4, 0.5, -0.3).normalize(),
      moon2Dir: new THREE.Vector3(0.5, 0.4, -0.7).normalize(),
      moonPhase: 0.32, moon2Phase: 0.71,
      sunIntensity: 22, stars: 1, aurora: 0,
      sunColor: new THREE.Color(1, 1, 1),
      sunIrradiance: 1,
      ambientColor: new THREE.Color(0.2, 0.25, 0.35),
      // weather
      weather: 'fair', nextWeather: 'fair', weatherBlend: 1, weatherTimer: 120,
      cloudCover: 0.42, cloudDensity: 0.95, cloudHeight: 2100,
      rain: 0, snow: 0, fogAmount: 0.24, turbidity: 0.36,
      windStrength: 0.35, windX: 1, windZ: 0.35, windAngle: 0.32,
      wetness: 0, snowCover: 0, snowLine: 235,
      lightning: 0,
      // derived / post
      fogColor: new THREE.Color(0.55, 0.62, 0.72),
      fogSunColor: new THREE.Color(1, 0.86, 0.66),
      fogDensity: 0.010, fogHeight: -10, fogFalloff: 0.010, fogMax: 0.94,
      godrayStrength: 0.55, bloomThreshold: 1.05, exposureKey: 0.19,
      underwater: 0, hurt: 0,
      dofStrength: 0, dofFocus: 14, dofRange: 42,
      interior: false,
    };

    this._setupLights();
    this._weatherRand = new Rand(this.seed + 4242);
  }

  // -------------------------------------------------------------------------
  _setupLights() {
    this.ambient = new THREE.HemisphereLight(0x9dbbe0, 0x3b3227, 1.0);
    this.scene.add(this.ambient);

    // A second, very soft fill from the opposite side stops shadowed faces
    // from going completely flat.
    this.fill = new THREE.DirectionalLight(0x8ba7c8, 0.15);
    this.fill.castShadow = false;
    this.scene.add(this.fill);

    this.csm = null;
    this.csmMaterials = new Set();
  }

  /** (Re)builds the cascaded shadow map rig for the current settings. */
  setupShadows(camera) {
    const q = settings.get('shadows');
    if (this.csm) { this.csm.remove?.(); this.csm.dispose?.(); this.csm = null; }
    this._csmPatched = new Set();

    if (q === 'off') {
      this.renderer.shadowMap.enabled = false;
      this.sun = this.sun || new THREE.DirectionalLight(0xffffff, 3);
      if (!this.sun.parent) this.scene.add(this.sun);
      this.sun.castShadow = false;
      return;
    }
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = settings.get('softShadows') ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

    const cascades = { low: 2, medium: 3, high: 3, ultra: 4 }[q] ?? 3;
    const mapSize = { low: 512, medium: 1024, high: 2048, ultra: 2048 }[q] ?? 1024;
    if (this.sun && this.sun.parent) { this.scene.remove(this.sun); this.sun = null; }

    this.csm = new CSM({
      maxFar: settings.get('shadowDistance'),
      cascades,
      mode: 'practical',
      parent: this.scene,
      shadowMapSize: mapSize,
      lightDirection: new THREE.Vector3(-this.env.sunDir.x, -this.env.sunDir.y, -this.env.sunDir.z).normalize(),
      camera,
      lightIntensity: 1.0,
      lightMargin: 260,
      shadowBias: -0.00018,
    });
    this.csm.fade = true;
    for (const m of this._shadowMaterials()) this.enableCSM(m);
  }

  _shadowMaterials() {
    const list = [this.terrain.material, this.scatter.barkMat, this.scatter.needleMat,
    this.scatter.leafMat, this.scatter.rockMat, this.scatter.grassMat, this.scatter.fernMat];
    for (const m of this.water.materials) list.push(m);
    for (const m of this.extraMaterials || []) list.push(m);
    return list.filter(Boolean);
  }

  /**
   * CSM overwrites `onBeforeCompile`, and so do our terrain/water/wind patches.
   * Chain them so a material can be both.
   */
  enableCSM(material) {
    if (!this.csm || !material || this._csmPatched.has(material)) return;
    this._csmPatched.add(material);
    const mine = material.onBeforeCompile;
    this.csm.setupMaterial(material);
    const csmHook = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      csmHook.call(this, shader, renderer);
      if (mine) mine.call(this, shader, renderer);
    };
    const prevKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : material.uuid) + '|csm' + this.csm.cascades;
  }

  /** Registers a material created after world construction (props, actors). */
  registerMaterial(m) {
    (this.extraMaterials ||= []).push(m);
    this.enableCSM(m);
  }

  // -------------------------------------------------------------------------
  setTime(hour, day = this.env.day) {
    this.env.hour = mod(hour, 24);
    this.env.day = day;
    this._updateCelestial();
  }

  _updateCelestial() {
    const e = this.env;
    const ang = ((e.hour - 6) / 24) * TAU;
    e.sunDir.set(Math.cos(ang), Math.sin(ang), 0.32).normalize();

    // Masser: slow and large. Secunda: quicker, offset.
    const mAng = ((e.hour - 6) / 24) * TAU + Math.PI + e.day * 0.21;
    e.moonDir.set(Math.cos(mAng) * 0.92, Math.sin(mAng), -0.36).normalize();
    const m2Ang = ((e.hour - 6) / 24) * TAU + Math.PI * 0.72 + e.day * 0.47;
    e.moon2Dir.set(Math.cos(m2Ang) * 0.8, Math.sin(m2Ang) * 0.95, 0.48).normalize();
    e.moonPhase = mod(e.day * 0.031, 1);
    e.moon2Phase = mod(e.day * 0.078 + 0.4, 1);

    e.sunIntensity = 22;
    e.stars = saturate((-e.sunDir.y + 0.02) / 0.16);
    // Aurora only on clear, cold, deep nights.
    const cold = saturate(1 - e.cloudCover * 1.3);
    e.aurora = e.stars * cold * saturate(Math.sin(e.day * 0.9) * 0.5 + 0.5) * 0.85;
  }

  // -------------------------------------------------------------------------
  _pickWeather() {
    const cur = WEATHER[this.env.weather];
    const opts = [];
    for (const k of WEATHER_KEYS) {
      const w = WEATHER[k];
      let weight = w.weight;
      // Weather tends to drift rather than jump: favour similar cloud cover.
      weight *= 1 / (1 + Math.abs(w.cloudCover - cur.cloudCover) * 2.2);
      if (k === this.env.weather) weight *= 0.35;
      // Snow instead of rain in the cold months.
      const wintry = saturate((Math.sin(this.env.day * 0.05) + 0.4));
      if (k === 'snow' || k === 'blizzard') weight *= 0.25 + wintry * 2.4;
      if (k === 'rain' || k === 'storm') weight *= 1.8 - wintry * 1.4;
      opts.push({ k, weight });
    }
    return this._weatherRand.weighted(opts).k;
  }

  forceWeather(key, instant = false) {
    if (!WEATHER[key]) return;
    this.env.nextWeather = key;
    this.env.weatherBlend = instant ? 1 : 0;
    if (instant) this.env.weather = key;
    this.env.weatherTimer = 200 + this._weatherRand.float(0, 260);
  }

  _updateWeather(dt) {
    const e = this.env;
    e.weatherTimer -= dt;
    if (e.weatherTimer <= 0 && e.weatherBlend >= 1) {
      e.weather = e.nextWeather;
      e.nextWeather = this._pickWeather();
      e.weatherBlend = 0;
      e.weatherTimer = 180 + this._weatherRand.float(0, 300);
    }
    if (e.weatherBlend < 1) {
      e.weatherBlend = Math.min(1, e.weatherBlend + dt / 26);
      if (e.weatherBlend >= 1) e.weather = e.nextWeather;
    }

    const a = WEATHER[e.weather], b = WEATHER[e.nextWeather];
    const t = e.weatherBlend;
    e.cloudCover = lerp(a.cloudCover, b.cloudCover, t);
    e.cloudDensity = lerp(a.cloudDensity, b.cloudDensity, t);
    e.rain = lerp(a.rain, b.rain, t);
    e.snow = lerp(a.snow, b.snow, t);
    e.fogAmount = lerp(a.fog, b.fog, t);
    e.turbidity = lerp(a.turbidity, b.turbidity, t);
    const windTarget = lerp(a.wind, b.wind, t);
    e.windStrength = damp(e.windStrength, windTarget, 0.5, dt);

    // Wind slowly veers.
    e.windAngle += (this.noise.noise2(e.timeSec * 0.008, 3.1)) * dt * 0.22;
    e.windX = Math.cos(e.windAngle);
    e.windZ = Math.sin(e.windAngle);

    // Ground state responds much more slowly than the sky.
    e.wetness = damp(e.wetness, saturate(e.rain * 1.1), e.rain > 0.05 ? 0.35 : 0.055, dt);
    const snowTarget = saturate(e.snow * 1.2);
    e.snowCover = damp(e.snowCover, snowTarget, e.snow > 0.05 ? 0.06 : 0.02, dt);
    e.snowLine = 250 - e.snowCover * 60;

    // Lightning.
    if (e.weather === 'storm' || e.nextWeather === 'storm') {
      e.lightning = Math.max(0, e.lightning - dt * 4.5);
      if (e.lightning <= 0 && this._weatherRand.next() < dt * 0.09) {
        e.lightning = 1;
        this.onLightning?.();
      }
    } else e.lightning = Math.max(0, e.lightning - dt * 4);
  }

  // -------------------------------------------------------------------------
  _updateLighting(camera) {
    const e = this.env;
    const sky = this.sky;
    if (sky) {
      e.sunColor.copy(sky.sunColor);
      e.sunIrradiance = sky.sunIrradiance;
      e.ambientColor.copy(sky.ambientColor);
      e.fogColor.copy(sky.fogColor);
    }

    const dayF = saturate((e.sunDir.y + 0.10) / 0.28);
    const night = 1 - dayF;

    // Directional light: the sun by day, the larger moon by night.
    const useMoon = e.sunDir.y < -0.06 && e.moonDir.y > 0.02;
    const dir = useMoon ? e.moonDir : e.sunDir;
    const lightColor = useMoon ? new THREE.Color(0.52, 0.62, 0.92) : e.sunColor;
    const cloudDim = 1 - e.cloudCover * 0.60 - e.rain * 0.18;
    let intensity = useMoon
      ? 0.28 * saturate(e.moonDir.y * 2.2) * Math.max(0.25, cloudDim) * (0.4 + 0.6 * Math.sin(e.moonPhase * Math.PI))
      : 4.2 * saturate((e.sunDir.y + 0.06) / 0.30) * Math.max(0.14, cloudDim);
    if (e.lightning > 0.01) intensity += e.lightning * e.lightning * 9;

    if (this.csm) {
      this.csm.lightDirection.set(-dir.x, -dir.y, -dir.z).normalize();
      for (const l of this.csm.lights) {
        l.intensity = intensity / this.csm.lights.length * this.csm.lights.length;
        l.color.copy(lightColor);
        if (e.lightning > 0.01) l.color.lerp(new THREE.Color(0.85, 0.9, 1.0), e.lightning);
      }
      const maxFar = clamp(settings.get('shadowDistance'), 40, 600);
      if (Math.abs(this.csm.maxFar - maxFar) > 1) { this.csm.maxFar = maxFar; this.csm.updateFrustums(); }
      this.csm.update();
    } else if (this.sun) {
      this.sun.position.copy(camera.position).addScaledVector(dir, 120);
      this.sun.target.position.copy(camera.position);
      this.sun.target.updateMatrixWorld();
      this.sun.intensity = intensity;
      this.sun.color.copy(lightColor);
    }

    // Ambient / hemisphere.
    const amb = e.ambientColor;
    this.ambient.color.setRGB(amb.r, amb.g, amb.b).multiplyScalar(1.35);
    this.ambient.groundColor.setRGB(
      0.055 + amb.r * 0.22 + e.snowCover * 0.30,
      0.048 + amb.g * 0.22 + e.snowCover * 0.32,
      0.040 + amb.b * 0.20 + e.snowCover * 0.36);
    // The PMREM environment map already lights everything with the live sky, so
    // the hemisphere light is a fill on top of that, not a second sky.
    this.ambient.intensity = (lerp(1.5, 0.55, e.cloudCover * 0.4) * (0.40 + dayF * 0.95) + night * 0.14) * 0.55;
    if (e.lightning > 0.01) this.ambient.intensity += e.lightning * 1.6;

    this.fill.position.copy(camera.position).add(new THREE.Vector3(-dir.x, 0.45, -dir.z).multiplyScalar(60));
    this.fill.target.position.copy(camera.position);
    this.fill.target.updateMatrixWorld();
    this.fill.intensity = 0.10 + dayF * 0.20;
    this.fill.color.setRGB(0.55 + e.snowCover * 0.2, 0.66, 0.92);

    // --- fog ---------------------------------------------------------------
    // Densities are per-metre: at 0.0009 a hillside 400 m out is ~30% hazed
    // while anything inside 50 m stays clean. Anything much heavier turns the
    // whole frame into milk, which is exactly what we do NOT want.
    const heavy = saturate(e.fogAmount * 0.85 + e.rain * 0.35 + e.snow * 0.4);
    e.fogDensity = lerp(0.00028, 0.0055, heavy) * (e.interior ? 0.35 : 1);
    e.fogHeight = lerp(-30, 90, saturate(e.fogAmount * 0.7));
    e.fogFalloff = lerp(0.026, 0.0075, heavy);
    e.fogMax = lerp(0.62, 0.95, heavy);
    // The sun-facing fog tint has to live at the same absolute brightness as
    // the ambient fog, otherwise every hill you look at near the sun becomes a
    // flat salmon cut-out several times brighter than the lit ground.
    const fogLevel = Math.max(e.fogColor.r, e.fogColor.g, e.fogColor.b);
    e.fogSunColor.copy(e.sunColor).lerp(new THREE.Color(1.0, 0.80, 0.55), 0.55)
      .multiplyScalar(Math.max(fogLevel, 1e-4) * 2.0);
    e.godrayStrength = (0.10 + dayF * 0.30) * (0.35 + e.fogAmount * 1.1) * (1 - e.cloudCover * 0.35);
    e.bloomThreshold = lerp(0.75, 1.25, dayF);
    // Auto-exposure target. 0.30 maps the average of the frame well above middle
    // grey, which is why sunlit ground was reading as pale khaki instead of
    // green: everything was simply printed too bright.
    e.exposureKey = lerp(0.13, 0.19, dayF);

    // Sun direction in view space, for the foliage translucency term.
    e.sunDirView.copy(dir).transformDirection(camera.matrixWorldInverse);
  }

  // -------------------------------------------------------------------------
  update(dt, camera, frame) {
    const e = this.env;
    const dayMinutes = settings.get('timeScale');
    e.hour = mod(e.hour + (dt / 60) * (24 / dayMinutes), 24);
    if (e.hour < this._lastHour) e.day++;
    this._lastHour = e.hour;
    e.timeSec += dt;

    this._updateCelestial();
    this._updateWeather(dt);
    this._updateLighting(camera);

    this.terrain.update(camera, dt, frame);
    this.terrain.setEnv(e);
    this.scatter.update(camera.position, e, this._loading ? 24 : 3, frame);
    this.grass.update(camera.position, frame, this._loading ? 32 : 3);
    this.water.update(e, camera.position);

    // Underwater check for the post stack.
    const wl = this.hf.waterAt(camera.position.x, camera.position.z);
    e.underwater = (wl !== null && camera.position.y < wl - 0.12)
      ? saturate((wl - camera.position.y) * 1.4) : 0;

    e.clock = clockString(e.hour);
  }

  /** Warms up the streaming systems before the first frame is shown. */
  preload(camera, onProgress) {
    this._loading = true;
    this.terrain.buildAllPending(camera, 0, 3000);
    onProgress?.(0.5);
    for (let i = 0; i < 40; i++) if (!this.scatter.warmCells(camera.position, 12)) break;
    this.scatter.rebuild(camera.position);
    for (let i = 0; i < 90; i++) if (!this.grass.warmTiles(camera.position, 12)) break;
    this.grass.rebuild(camera.position);
    onProgress?.(1);
    this._loading = false;
  }

  /** Name of the nearest known place, for the HUD. */
  locationName(x, z) {
    let best = null, bestD = Infinity;
    for (const L of this.hf.locations) {
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < L.radius * 1.5 && d < bestD) { bestD = d; best = L; }
    }
    if (best) return best.name;
    if (z > 1200) return 'The Shivering Coast';
    if (z < -900) return 'The Skarnvald Range';
    if (this.hf.heightAt(x, z) > 300) return 'The High Fells';
    if (this.hf.sampleBiome(x, z).forest > 0.4) return 'Elk Hollow Wood';
    return 'The Wilds of Wyrmhold';
  }

  dispose() {
    this.terrain.dispose();
    this.water.dispose();
    this.scatter.dispose();
    this.grass.dispose();
    this.heightTexture.dispose();
    this.biomeTexture.dispose();
    this.csm?.dispose?.();
  }
}
