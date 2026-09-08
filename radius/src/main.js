// RADIUS — bootstrap and game loop. Wires every subsystem into ctx and owns the mode state machine.
import * as THREE from 'three';
import { createEvents } from './core/events.js';
import { createInput } from './core/input.js';
import { createState } from './core/state.js';
import { createTime } from './core/time.js';
import { createInteract } from './core/interact.js';
import { mulberry32 } from './core/rng.js';
import { createRenderer } from './render/renderer.js';
import { installFog } from './render/fog.js';
import { createSky } from './render/sky.js';
import { createLighting } from './render/lighting.js';
import { createPost } from './render/post.js';
import { createVfx } from './render/vfx.js';
import { createPerf } from './render/perf.js';
import { createWorld } from './world/world.js';
import { createStructures } from './world/structures.js';
import { createProps } from './world/props.js';
import { createFlora } from './world/flora.js';
import { createDebris } from './world/debris.js';
import { createPlayer } from './player/controller.js';
import { createInventory, makeWeapon } from './player/inventory.js';
import { createDamage } from './player/damage.js';
import { createGear } from './player/gear.js';
import { registerPhantom } from './enemies/phantom.js';
import { createMaterials } from './render/materials.js';
import { createHands } from './player/hands.js';
import { createWeapons } from './weapons/weapons.js';
import { createBallistics } from './weapons/ballistics.js';
import { createEnemies } from './enemies/common.js';
import { createDirector } from './enemies/director.js';
import { createPopulation } from './enemies/population.js';
import { registerMimic } from './enemies/mimic.js';
import { registerSeeker } from './enemies/seeker.js';
import { registerSlider } from './enemies/slider.js';
import { registerFragment } from './enemies/fragment.js';
import { registerSpawn } from './enemies/spawn.js';
import { createAnomalies } from './anomalies/anomalies.js';
import { createArtifacts } from './anomalies/artifacts.js';
import { createProbes } from './anomalies/probe.js';
import { createDetector } from './anomalies/detector.js';
import { createAudio } from './audio/engine.js';
import { registerSfx } from './audio/sfx.js';
import { createMusic } from './audio/music.js';
import { createAmbience } from './audio/ambience.js';
import { createHud } from './ui/hud.js';
import { createMenus } from './ui/menus.js';
import { createPanels } from './ui/panels.js';
import { createTouch, detectTouch, installMobileChrome } from './ui/touch.js';
import { createMissions } from './game/missions.js';
import { createLoot } from './game/loot.js';
import { createBase } from './game/base_scene.js';
import { createScares } from './game/scares.js';
import { createTide } from './game/tide.js';

const canvas = document.getElementById('gl');
const ctx = { THREE, canvas, mode: 'boot', elapsed: 0, frame: 0, debug: { god: false, noEnemies: false }, _tmpDir: new THREE.Vector3() };
window.__radius = { ctx, ready: false };

// A subsystem that throws while being created gets a stub so the rest of the game still boots (modules are rewritten in parallel).
const STUB = {
  weapons: () => ({ current: null, adsBlend: 0, spreadDeg: 2, equipSlot() {}, holster() {}, fire() {}, reload() {}, onInventoryChanged() {}, update() {} }),
  hands: () => { const root = new THREE.Group(); ctx.camera.add(root); return { root, adsBlend: 0, setWeaponMesh() {}, kick() {}, playAnim() {}, update() {} }; },
  panels: () => ({ isOpen: false, current: null, open() {}, close() {}, update() {} }),
  menus: () => ({ current: null, show() {}, hide() {}, update() {} }),
  generic: () => ({ update() {}, populate() {}, reset() {}, start() {}, stop() {}, list: [], active: [], available() { return []; } }),
};
function safe(name, fn) {
  try { return fn(); } catch (e) { console.error(`[boot:${name}]`, e); ctx._bootErrors = (ctx._bootErrors || []).concat(name + ': ' + (e && e.message)); return (STUB[name] || STUB.generic)(); }
}

/**
 * Should the on-screen controls drive this session?
 * settings.touchControls: 'auto' (default — on for a touch device) | 'on' | 'off'.
 */
function wantsTouch() {
  if (window.__radiusForceTouch !== undefined) return !!window.__radiusForceTouch;   // harness override
  const mode = ctx.state.data.settings.touchControls;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return detectTouch();
}

/**
 * Phone defaults, applied once and then never again so they can be overridden and stay overridden.
 * A handset fills a tenth of the pixels a desktop GPU does, so start it somewhere it can actually
 * hold a frame rate and let the player raise it. Must run BEFORE createRenderer, which reads
 * settings.quality when it builds the context.
 */
function applyMobileDefaults() {
  const s = ctx.state.data.settings;
  if (!wantsTouch() || s.mobileTuned) return;
  s.mobileTuned = true;
  s.quality = 'low';
  s.targetFps = 60;
  s.resolutionScale = Math.min(s.resolutionScale ?? 1, 0.75);
  s.dynamicResolution = true;
  s.touchScale = s.touchScale ?? 1;
  s.touchLook = s.touchLook ?? 1;
  try { ctx.state.saveSettings(); } catch {}
}

/** Switch the control layer on or off and tell the HUD to move out from under the thumbs. */
function applyTouchMode() {
  const on = wantsTouch();
  ctx.touch.setEnabled(on);
  document.getElementById('ui')?.classList.toggle('touch', on);
}

function boot() {
  installFog();
  ctx.events = createEvents();
  ctx.state = createState(); ctx.state.loadSettingsOnly();
  applyMobileDefaults();
  ctx.quality = ctx.state.data.settings.quality;
  const r = createRenderer(canvas, ctx.state.data.settings); ctx.renderer = r.renderer; ctx.renderApi = r;
  ctx.scene = new THREE.Scene();
  ctx.camera = new THREE.PerspectiveCamera(ctx.state.data.settings.fov || 75, window.innerWidth / window.innerHeight, 0.05, 2600);
  ctx.input = createInput(canvas, ctx.events);
  ctx.time = createTime(ctx.state, ctx.events);
  ctx.rng = mulberry32(ctx.state.data.seed);
  ctx.audio = createAudio(ctx); registerSfx(ctx.audio);
  ctx.hud = createHud(ctx);
  ctx.sky = createSky(ctx);
  ctx.lighting = createLighting(ctx);
  ctx.post = createPost(ctx);
  ctx.perf = createPerf(ctx);
  ctx.vfx = createVfx(ctx);
  ctx.materials = safe('materials', () => createMaterials(ctx));
  ctx.world = createWorld(ctx);
  ctx.inventory = createInventory(ctx);
  ctx.player = createPlayer(ctx);
  ctx.damage = createDamage(ctx);
  ctx.interact = createInteract(ctx);
  ctx.hands = safe('hands', () => createHands(ctx));
  ctx.hands.root.add(ctx.lighting.weaponLight); ctx.hands.root.add(ctx.lighting.weaponLight.target);
  ctx.ballistics = safe('ballistics', () => createBallistics(ctx));
  ctx.weapons = safe('weapons', () => createWeapons(ctx));
  ctx.enemies = createEnemies(ctx);
  ctx.director = createDirector(ctx);
  for (const [n, f] of [['mimic', registerMimic], ['seeker', registerSeeker], ['slider', registerSlider], ['fragment', registerFragment], ['spawn', registerSpawn], ['phantom', registerPhantom]]) safe(n, () => f(ctx));
  ctx.population = safe('population', () => createPopulation(ctx));
  ctx.anomalies = safe('anomalies', () => createAnomalies(ctx));
  ctx.artifacts = safe('artifacts', () => createArtifacts(ctx));
  ctx.probes = safe('probes', () => createProbes(ctx));
  ctx.detector = safe('detector', () => createDetector(ctx));
  ctx.gear = safe('gear', () => createGear(ctx));
  ctx.structures = safe('structures', () => createStructures(ctx));
  ctx.props = safe('props', () => createProps(ctx));
  ctx.base = safe('base', () => createBase(ctx));
  ctx.flora = safe('flora', () => createFlora(ctx));
  ctx.debris = safe('debris', () => createDebris(ctx));
  ctx.loot = safe('loot', () => createLoot(ctx));
  ctx.missions = safe('missions', () => createMissions(ctx));
  ctx.scares = safe('scares', () => createScares(ctx));
  ctx.tide = createTide(ctx);
  ctx.music = safe('music', () => createMusic(ctx));
  ctx.ambience = safe('ambience', () => createAmbience(ctx));
  ctx.panels = safe('panels', () => createPanels(ctx));
  ctx.menus = safe('menus', () => createMenus(ctx));
  ctx.touch = safe('touch', () => createTouch(ctx));
  applyTouchMode();
  safe('mobile', () => installMobileChrome(ctx));

  window.addEventListener('resize', () => { r.resize(); ctx.camera.aspect = window.innerWidth / window.innerHeight; ctx.camera.updateProjectionMatrix(); ctx.post.resize(); ctx.perf.applyScale(); });
  ctx.events.on('canvasClick', () => { ctx.audio.resume(); if (ctx.mode === 'playing') ctx.input.lock(); });
  ctx.events.on('keydown', () => ctx.audio.resume());
  addEventListener('pointerdown', () => ctx.audio.resume(), { passive: true });
  let wasLocked = false;
  ctx.events.on('pointerlock', (locked) => { if (!locked && wasLocked && ctx.mode === 'playing' && !ctx.panels.isOpen) game.pause(); wasLocked = locked; });
  ctx.events.on('playerDied', (info) => game.onDeath(info));
  ctx.events.on('tide', () => { /* modules re-roll themselves */ });

  const player = ctx.player;
  player.setLook(ctx.world.map.START.yaw, 0);
  player.teleport(ctx.world.map.START.x, ctx.world.map.START.z);
  ctx.mode = 'title';
  ctx.menus.show('title');
  ctx.hud.setGameVisible(false);
  ctx.hud.fadeIn();
  window.__radius.ready = true;
}

const game = {
  start(newGame = true) {
    if (newGame) { ctx.state.reset(); ctx.inventory.giveStarterKit(); }
    else { ctx.state.load(); }
    ctx.events.emit('gameStart', newGame);
    const M = ctx.world.map;
    ctx.player.revive();
    if (newGame) { ctx.player.setLook(M.START.yaw, 0); ctx.player.teleport(M.START.x, M.START.z); }
    else { ctx.player.setLook(0, 0); ctx.player.teleport(M.BASE.x, M.BASE.z, ctx.base.floorY ?? ctx.world.groundHeight(M.BASE.x, M.BASE.z, 60).y); }   // the bunker floor is a box above the terrain
    ctx.weapons.onInventoryChanged?.();
    ctx.director.rest();
    ctx.post.setDeath(0);
    ctx.audio.resume(); ctx.audio.setMuffle(1);
    ctx.music.start?.(); ctx.ambience.start?.();
    ctx.menus.hide(); ctx.hud.setGameVisible(true); ctx.hud.fadeIn();
    ctx.mode = 'playing'; ctx.input.enabled = true; ctx.input.lock();
    if (newGame) setTimeout(() => ctx.hud.notify('Contract active. Explorer 61 cleared for entry. Security level 1.', { code: 'UNPSC · VANNO OUTPOST', ms: 7000 }), 1200);
  },
  pause() {
    if (ctx.mode !== 'playing') return;
    ctx.mode = 'paused'; ctx.input.enabled = false; ctx.input.releaseAll(); ctx.input.unlock();
    ctx.audio.setMuffle(0.25);
    ctx.menus.show('pause');
  },
  resume() {
    if (ctx.mode !== 'paused') return;
    ctx.menus.hide(); ctx.mode = 'playing'; ctx.input.enabled = true; ctx.input.lock();
    ctx.audio.setMuffle(1);
  },
  onDeath(info) {
    if (ctx.mode === 'dead') return;
    ctx.mode = 'dead'; ctx.input.enabled = false; ctx.input.releaseAll();
    ctx.post.setDeath(1); ctx.audio.setMuffle(0.15); ctx.audio.play('death', { gain: 1 });
    ctx.events.emit('deathScreen', info);
    setTimeout(() => { ctx.input.unlock(); ctx.menus.show('death', info); }, 3200);
  },
  // Committee reissues a kit; everything carried is gone; next morning at base.
  respawn() {
    ctx.inventory.dropAll(); ctx.inventory.giveStarterKit();
    ctx.state.data.hp = 100; ctx.state.data.stamina = 100; ctx.state.data.bleeding = false;
    ctx.time.sleepToMorning();
    ctx.state.save();
    ctx.events.emit('respawn');
    game.start(false);
    ctx.hud.notify('Explorer 61 recovered at the perimeter. Kit reissued at cost. Contract reinstated.', { code: 'UNPSC · INCIDENT 61-' + ctx.state.data.stats.deaths, ms: 8000 });
  },
  toTitle() {
    ctx.mode = 'title'; ctx.input.enabled = false; ctx.input.unlock(); ctx.hud.setGameVisible(false);
    // Leaving a run had no audio teardown: every entity and ambience loop kept playing under the
    // title, and the master lowpass stayed wherever the last mode left it — 0.25 from pause, 0.15
    // from death — so the whole game sounded muffled until the page was reloaded.
    ctx.audio.setMuffle(1); ctx.audio.stopAll(0.4);
    ctx.music.stop?.(); ctx.ambience.stop?.();
    ctx.menus.show('title');
  },
};
ctx.game = game;

let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, lastReal = performance.now();
const errs = new Map();
function step(name, fn) {
  try { fn(); } catch (e) {
    const key = name + ':' + String(e && e.message);
    const n = (errs.get(key) || 0) + 1; errs.set(key, n);
    if (n === 1) console.error(`[${name}]`, e);
    ctx._errorLogged = true; ctx._errors = errs;
  }
}
function loop(now) {
  requestAnimationFrame(loop);
  const rawMs = now - last;
  let dt = Math.min(0.05, rawMs / 1000); last = now;
  if (dt <= 0) dt = 0.0001;
  ctx.frame++; ctx.elapsed += dt;
  fpsAcc += (now - lastReal) / 1000; lastReal = now; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const t = ctx.elapsed;
  try {
    if (ctx.mode === 'playing' && ctx.input.rawPressed('pause')) { if (ctx.panels.isOpen) ctx.panels.close(); else game.pause(); }
    else if (ctx.mode === 'playing' && !ctx.panels.isOpen && ctx.input.pressed('inventory')) ctx.panels.open('inventory');
    else if (ctx.mode === 'playing' && !ctx.panels.isOpen && ctx.input.pressed('map')) ctx.panels.open('map');
    else if (ctx.mode === 'playing' && ctx.panels.isOpen && (ctx.input.rawPressed('inventory') || ctx.input.rawPressed('map'))) ctx.panels.close();
    else if (ctx.mode === 'paused' && ctx.input.rawPressed('pause')) { if (ctx.menus.current === 'settings') ctx.menus.show('pause'); else game.resume(); }
    const playing = ctx.mode === 'playing' || ctx.mode === 'dead';
    // every subsystem steps in its own try/catch so one broken module cannot freeze the others
    if (playing) {
      const gdt = ctx.panels.isOpen ? 0 : dt;      // world freezes while a base panel is open
      if (!ctx.panels.isOpen) step('time', () => ctx.time.update(dt));
      step('player', () => ctx.player.update(gdt));
      step('damage', () => ctx.damage.update(gdt));
      step('hands', () => ctx.hands.update(gdt)); step('weapons', () => ctx.weapons.update(gdt)); step('gear', () => ctx.gear.update(gdt));
      if (ctx.mode === 'playing' && !ctx.panels.isOpen) step('interact', () => ctx.interact.update(dt));
      step('probes', () => ctx.probes.update(gdt)); step('detector', () => ctx.detector.update(gdt));
      step('enemies', () => ctx.enemies.update(gdt)); step('population', () => ctx.population.update(gdt));
      step('anomalies', () => ctx.anomalies.update(gdt)); step('artifacts', () => ctx.artifacts.update(gdt));
      step('director', () => ctx.director.update(gdt)); step('scares', () => ctx.scares.update(gdt));
      step('missions', () => ctx.missions.update(gdt)); step('loot', () => ctx.loot.update(gdt)); step('base', () => ctx.base.update(gdt)); step('tide', () => ctx.tide.update(gdt));
      step('structures', () => ctx.structures.update(gdt, t)); step('props', () => ctx.props.update(gdt, t)); step('flora', () => ctx.flora.update(gdt, t)); step('debris', () => ctx.debris.update(gdt, t));
      step('ballistics', () => ctx.ballistics.update?.(gdt));
    } else {
      step('player', () => ctx.player.update(0));
    }
    ctx.hands.root.visible = ctx.mode !== 'title';
    step('lighting', () => ctx.lighting.update(dt)); step('sky', () => ctx.sky.update(dt, t)); step('world', () => ctx.world.update(dt, t));
    step('vfx', () => ctx.vfx.update(dt, t)); step('post', () => ctx.post.update(dt, t)); step('audio', () => ctx.audio.update(dt));
    step('hud', () => ctx.hud.update(dt)); step('music', () => ctx.music.update(dt)); step('ambience', () => ctx.ambience.update(dt)); step('menus', () => ctx.menus.update(dt)); step('panels', () => ctx.panels.update(dt)); step('touch', () => ctx.touch.update(dt));
    step('materials', () => ctx.materials.update?.(dt, t));
    step('perf', () => ctx.perf.update(dt, rawMs));
    ctx.renderer.info.reset();
    ctx.post.render();
  } catch (e) {
    // log each distinct error once so a broken module is visible in smoke tests without flooding the console
    ctx._errors = ctx._errors || new Set();
    const key = String(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e);
    if (!ctx._errors.has(key) && ctx._errors.size < 8) { ctx._errors.add(key); console.error('[loop]', e); }
    ctx._errorLogged = true;
  }
  ctx.input.endFrame();
}

// ---- debug / test API ----
Object.assign(window.__radius, {
  start(newGame = true) { game.start(newGame); },
  teleport(x, z, y = null) { ctx.player.teleport(x, z, y); },
  look(dx, dy) { ctx.input.injectLook(dx, dy); },
  setLook(yaw, pitch) { ctx.player.setLook(yaw, pitch); },
  setTime(h) { ctx.state.data.hour = h; },
  spawn(type, x, z, opts = {}) { return ctx.enemies.spawn(type, new THREE.Vector3(x, 0, z), opts); },
  spawnAnomaly(type, x, z) { return ctx.anomalies.spawn(type, new THREE.Vector3(x, ctx.world.getHeight(x, z), z)); },
  god(v = true) { ctx.debug.god = v; },
  give(id, n = 1) { ctx.inventory.add(id, n); },
  giveWeapon(id) { const w = ctx.inventory.addWeapon(makeWeapon(id)); ctx.weapons.onInventoryChanged?.(); return w; },
  press(action) { const code = ctx.input.bindings[action][0]; window.dispatchEvent(new KeyboardEvent('keydown', { code })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 60); },
  stats() {
    const info = ctx.renderer.info;
    return { fps: Math.round(fps), mode: ctx.mode, calls: info.render.calls, triangles: info.render.triangles, enemies: ctx.enemies.list.length, anomalies: ctx.anomalies.list?.length, missingSounds: [...ctx.audio.missing], hp: ctx.state.data.hp, pos: ctx.player.position.toArray().map((v) => +v.toFixed(1)), director: ctx.director.state, tension: +ctx.director.tension.toFixed(2), hour: +ctx.state.data.hour.toFixed(2), bootErrors: ctx._bootErrors || [], error: ctx._errorLogged || false, errors: ctx._errors ? [...ctx._errors.entries()].map(([k, n]) => `${k} x${n}`).slice(0, 8) : [] };
  },
});

boot();
requestAnimationFrame(loop);
