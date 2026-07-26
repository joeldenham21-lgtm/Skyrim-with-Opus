/**
 * WYRMHOLD — entry point.
 *
 * Boots the renderer, bakes the material library, builds the world, and runs
 * the frame loop. Everything is streamed or generated: there is nothing to
 * download beyond the source itself.
 */

import * as THREE from 'three';
import { settings } from './core/settings.js';
import { Input } from './core/input.js';
import { TextureBakery } from './render/textures.js';
import { buildPalette } from './render/materials.js';
import { Sky } from './render/sky.js';
import { Pipeline } from './render/pipeline.js';
import { World, LAYER_WATER } from './world/world.js';
import { Player } from './game/player.js';
import { Game } from './game/game.js';
import { UI } from './ui/ui.js';
import { Audio } from './game/audio.js';
import { clamp, lerp, damp } from './core/math.js';

const boot = {
  el: document.getElementById('boot'),
  bar: document.getElementById('boot-bar'),
  status: document.getElementById('boot-status'),
  tip: document.getElementById('boot-tip'),
};

const TIPS = [
  'Power attacks break through a raised shield. Time them.',
  'Sneaking in the dark and out of the firelight is half the battle.',
  'Weather rolls in from the west. Watch the sky before you climb.',
  'A dragon on the wing is a poor thing to fight in the open.',
  'Cold iron for the restless dead; steel for the living.',
  'The Wardstones remember older names than yours.',
  'Every settlement you find is a place you can travel back to.',
  'Frost slows. Fire lingers. Shock drinks magicka.',
  'Falling hurts. The mountain does not care how brave you are.',
  'Rest at a fire to pass the night and mend your wounds.',
];

function setProgress(p, msg) {
  if (boot.bar) boot.bar.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
  if (msg && boot.status) boot.status.textContent = msg;
}
function nextTip() {
  if (boot.tip) boot.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------------------

class Engine {
  constructor() {
    this.canvas = document.getElementById('viewport');
    this.clock = new THREE.Clock();
    this.frame = 0;
    this.paused = false;
    this.fpsHistory = [];
    this.dynScale = 1;
    this.accum = 0;
    this.lastFrameTime = performance.now();
  }

  async boot() {
    nextTip();
    setProgress(0.02, 'Lighting the forge');

    // --- renderer --------------------------------------------------------
    const gl = this.canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser. Try a recent Chrome, Edge, Firefox or Safari.');

    settings.load();
    settings.autoDetect(gl);
    // Sandboxed/embedded pages can throw on any localStorage access, which
    // would kill the boot before a single frame is drawn.
    if (!settings.hasStoredSettings()) settings.applyPreset(settings.deviceTier);
    settings.resolvePlatform();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, context: gl, antialias: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;   // we tonemap in the final pass
    this.renderer.shadowMap.enabled = settings.get('shadows') !== 'off';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(1);                    // resolution is managed explicitly
    this.renderer.info.autoReset = false;

    // --- textures ---------------------------------------------------------
    const bakery = new TextureBakery(this.renderer);
    this.bakery = bakery;
    const names = TextureBakery.bakeOrder();
    const quality = settings.get('textureQuality');
    const aniso = settings.get('anisotropy');
    for (let i = 0; i < names.length; i++) {
      bakery.bake(names[i], quality, aniso);
      setProgress(0.03 + 0.34 * (i + 1) / names.length, `Weaving ${names[i]}`);
      if (i % 3 === 2) await nextFrame();
    }

    this.palette = buildPalette(bakery);
    setProgress(0.40, 'Raising the mountains');
    await nextFrame();

    // --- world -------------------------------------------------------------
    this.world = new World(this.renderer, bakery, { seed: 20260726 });
    this.world.palette = this.palette;
    setProgress(0.58, 'Seeding the forests');
    await nextFrame();

    this.sky = new Sky(this.renderer);
    this.world.sky = this.sky;
    this.sky.setQuality(settings.get('cloudQuality'));

    // --- player ------------------------------------------------------------
    this.input = new Input(this.canvas);
    this.player = new Player(this.world, this.input, this.palette);
    this.camera = this.player.camera;
    this.camera.layers.enableAll();

    this.world.setupShadows(this.camera);
    for (const m of this.palette.all()) this.world.registerMaterial(m);

    setProgress(0.66, 'Waking the world');
    await nextFrame();

    // --- gameplay ----------------------------------------------------------
    this.audio = new Audio();
    this.game = new Game(this);
    await this.game.build(p => setProgress(0.66 + p * 0.18, 'Peopling the north'));

    setProgress(0.86, 'Streaming the land');
    await nextFrame();
    this.player.spawn(-120, 300);
    this.camera.position.set(this.player.pos.x, this.player.pos.y + 6, this.player.pos.z + 6);
    this.camera.updateMatrixWorld(true);
    this.world.preload(this.camera, p => setProgress(0.86 + p * 0.08));
    await nextFrame();

    // --- rendering ---------------------------------------------------------
    this.pipeline = new Pipeline(this.renderer, this.world.scene, this.camera, this.sky);
    this.pipeline.applySettings();
    this.resize();

    this.ui = new UI(this);
    setProgress(0.98, 'Almost there');

    // Warm the shader cache so the first frames don't stutter.
    this.world.update(0.016, this.camera, 0);
    this.renderer.compile(this.world.scene, this.camera);
    this.sky.update(this.world.env, this.camera);
    this.sky.updateEnvironment(this.world.scene, true);
    await nextFrame();

    setProgress(1, 'Ready');
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 260));
    settings.subscribe((key) => this.onSettingChanged(key));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.setMuted(settings.get('muteUnfocused'));
      else this.audio.setMuted(false);
    });

    boot.el.classList.add('fade-out');
    setTimeout(() => boot.el.classList.add('hidden'), 700);

    this.ui.showMainMenu();
    this.loop();
  }

  // -------------------------------------------------------------------------
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let w = Math.floor(this.canvas.clientWidth * dpr);
    let h = Math.floor(this.canvas.clientHeight * dpr);
    if (w < 2 || h < 2) { w = Math.floor(innerWidth * dpr); h = Math.floor(innerHeight * dpr); }

    // Cap by the chosen output resolution.
    const maxPixels = settings.maxPixels();
    const pixels = w * h;
    if (Number.isFinite(maxPixels) && pixels > maxPixels) {
      const k = Math.sqrt(maxPixels / pixels);
      w = Math.max(2, Math.floor(w * k));
      h = Math.max(2, Math.floor(h * k));
    }

    this.outW = w; this.outH = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.renderer.setViewport(0, 0, w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const scale = clamp(settings.get('renderScale') * this.dynScale, 0.35, 2.0);
    this.pipeline?.setSize(w, h, scale);
    this.ui?.onResize?.();
    document.documentElement.style.setProperty('--ui-scale', String(settings.get('uiScale')));
  }

  onSettingChanged(key) {
    const s = settings;
    if (key === 'uiScale' || key === 'hudOpacity') {
      document.documentElement.style.setProperty('--ui-scale', String(s.get('uiScale')));
      document.documentElement.style.setProperty('--hud-opacity', String(s.get('hudOpacity')));
    }
    if (key === 'platform') { s.resolvePlatform(); this.ui?.onPlatformChanged?.(); }
    if (key === 'resolutionMode' || key === 'renderScale') this.resize();
    if (key === 'fov') { this.camera.fov = s.get('fov'); this.camera.updateProjectionMatrix(); }
    if (key === 'shadows' || key === 'shadowDistance' || key === 'softShadows') {
      this.world.setupShadows(this.camera);
      for (const m of this.palette.all()) this.world.enableCSM(m);
      this.game?.onMaterialsChanged?.();
    }
    if (key === 'cloudQuality') { this.sky.setQuality(s.get('cloudQuality')); this.pipeline?._resizeSkyTarget(); }
    if (key === 'grassDensity' || key === 'grassDistance') this.world.grass.markDirty();
    if (key === 'foliageDistance') this.world.scatter.markDirty();
    if (key === 'preset') { this.resize(); this.world.setupShadows(this.camera); for (const m of this.palette.all()) this.world.enableCSM(m); }
    this.pipeline?.applySettings();
    this.audio?.applySettings();
  }

  // -------------------------------------------------------------------------
  /** Nudges the render scale to hold the frame-rate target. */
  _dynamicResolution(dtMs) {
    if (!settings.get('dynamicResolution')) {
      if (this.dynScale !== 1) { this.dynScale = 1; this.resize(); }
      return;
    }
    const target = 1000 / settings.get('targetFps');
    this.fpsHistory.push(dtMs);
    if (this.fpsHistory.length > 24) this.fpsHistory.shift();
    if (this.fpsHistory.length < 24 || (this.frame & 15) !== 0) return;
    const sorted = [...this.fpsHistory].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    let next = this.dynScale;
    if (median > target * 1.14) next = this.dynScale - 0.05;
    else if (median < target * 0.86) next = this.dynScale + 0.03;
    next = clamp(next, 0.5, 1.0);
    if (Math.abs(next - this.dynScale) > 0.004) {
      this.dynScale = next;
      const scale = clamp(settings.get('renderScale') * this.dynScale, 0.35, 2.0);
      this.pipeline.setSize(this.outW, this.outH, scale);
    }
  }

  loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    let dtMs = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (settings.get('fpsCap')) {
      const target = 1000 / settings.get('targetFps');
      this.accum += dtMs;
      if (this.accum < target - 1.2) return;
      this.accum = 0;
    }

    const dt = Math.min(dtMs / 1000, 0.1);
    this.frame++;
    this.renderer.info.reset();

    this._dynamicResolution(dtMs);

    // ---- simulate ---------------------------------------------------------
    this.input.update(dt);
    const paused = this.ui.isPaused();
    this.input.uiCapture = this.ui.capturesInput();

    if (!paused) {
      this.game.update(dt);
      this.world.update(dt, this.camera, this.frame);
    } else {
      // Keep streaming and lighting alive behind menus so the world looks live.
      this.world.update(dt * 0.15, this.camera, this.frame);
    }
    this.audio.update(dt, this);
    this.ui.update(dt);

    // ---- render -----------------------------------------------------------
    this.camera.updateProjectionMatrix();
    this.pipeline.applyJitter(this.camera);
    this.camera.updateMatrixWorld(true);

    if ((this.frame & 7) === 0) this.sky.updateEnvironment(this.world.scene);

    const env = this.world.env;
    env.timeSec = this.world.env.timeSec;
    env.hurt = this.game.hurtFlash;
    env.dofStrength = this.ui.dofStrength();
    env.dofFocus = this.game.focusDistance;

    const renderer = this.renderer;
    const camera = this.camera;
    const scene = this.world.scene;

    this.pipeline.render(dt, env, {
      renderOpaque: (target) => {
        camera.layers.set(0);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      },
      renderWater: (target, opaqueTex) => {
        this.world.water.setOpaqueTexture(opaqueTex,
          this.pipeline._targets.opaque.width, this.pipeline._targets.opaque.height);
        camera.layers.set(LAYER_WATER);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        camera.layers.enableAll();
      },
    });

    this.input.endFrame();
  };
}

// ---------------------------------------------------------------------------

const engine = new Engine();
window.WYRMHOLD = engine;
engine.boot().catch(err => {
  console.error(err);
  const fatal = document.getElementById('fatal');
  document.getElementById('fatal-msg').textContent = err.message || String(err);
  document.getElementById('fatal-stack').textContent = err.stack || '';
  fatal.classList.remove('hidden');
  boot.el.classList.add('hidden');
});
