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
import { createWorld } from './world/world.js';
import { createStructures } from './world/structures.js';
import { createProps } from './world/props.js';
import { createFlora } from './world/flora.js';
import { createDebris } from './world/debris.js';
import { createPlayer } from './player/controller.js';
import { createInventory, makeWeapon } from './player/inventory.js';
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
import { createMissions } from './game/missions.js';
import { createLoot } from './game/loot.js';
import { createBase } from './game/base_scene.js';
import { createScares } from './game/scares.js';
import { createTide } from './game/tide.js';

const canvas = document.getElementById('gl');
const ctx = { THREE, canvas, mode: 'boot', elapsed: 0, frame: 0, debug: { god: false, noEnemies: false }, _tmpDir: new THREE.Vector3() };
window.__radius = { ctx, ready: false };

function boot() {
  installFog();
  ctx.events = createEvents();
  ctx.state = createState(); ctx.state.loadSettingsOnly();
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
  ctx.vfx = createVfx(ctx);
  ctx.world = createWorld(ctx);
  ctx.inventory = createInventory(ctx);
  ctx.player = createPlayer(ctx);
  ctx.interact = createInteract(ctx);
  ctx.hands = createHands(ctx);
  ctx.ballistics = createBallistics(ctx);
  ctx.weapons = createWeapons(ctx);
  ctx.enemies = createEnemies(ctx);
  ctx.director = createDirector(ctx);
  registerMimic(ctx); registerSeeker(ctx); registerSlider(ctx); registerFragment(ctx); registerSpawn(ctx);
  ctx.population = createPopulation(ctx);
  ctx.anomalies = createAnomalies(ctx);
  ctx.artifacts = createArtifacts(ctx);
  ctx.probes = createProbes(ctx);
  ctx.detector = createDetector(ctx);
  ctx.structures = createStructures(ctx);
  ctx.props = createProps(ctx);
  ctx.base = createBase(ctx);
  ctx.flora = createFlora(ctx);
  ctx.debris = createDebris(ctx);
  ctx.loot = createLoot(ctx);
  ctx.missions = createMissions(ctx);
  ctx.scares = createScares(ctx);
  ctx.tide = createTide(ctx);
  ctx.music = createMusic(ctx);
  ctx.ambience = createAmbience(ctx);
  ctx.panels = createPanels(ctx);
  ctx.menus = createMenus(ctx);

  window.addEventListener('resize', () => { r.resize(); ctx.camera.aspect = window.innerWidth / window.innerHeight; ctx.camera.updateProjectionMatrix(); ctx.post.resize(); });
  ctx.events.on('canvasClick', () => { ctx.audio.resume(); if (ctx.mode === 'playing') ctx.input.lock(); });
  ctx.events.on('keydown', () => ctx.audio.resume());
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
  toTitle() { ctx.mode = 'title'; ctx.input.enabled = false; ctx.input.unlock(); ctx.hud.setGameVisible(false); ctx.menus.show('title'); },
};
ctx.game = game;

let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, lastReal = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
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
    if (playing) {
      const gdt = ctx.panels.isOpen ? 0 : dt;      // world freezes while a base panel is open
      if (!ctx.panels.isOpen) ctx.time.update(dt);
      ctx.player.update(gdt);
      ctx.hands.update(gdt); ctx.weapons.update(gdt);
      if (ctx.mode === 'playing' && !ctx.panels.isOpen) ctx.interact.update(dt);
      ctx.probes.update(gdt); ctx.detector.update(gdt);
      ctx.enemies.update(gdt); ctx.population.update(gdt);
      ctx.anomalies.update(gdt); ctx.artifacts.update(gdt);
      ctx.director.update(gdt); ctx.scares.update(gdt);
      ctx.missions.update(gdt); ctx.loot.update(gdt); ctx.base.update(gdt); ctx.tide.update(gdt);
      ctx.structures.update(gdt, t); ctx.props.update(gdt, t); ctx.flora.update(gdt, t); ctx.debris.update(gdt, t);
      ctx.ballistics.update?.(gdt);
    } else {
      ctx.player.update(0);
    }
    ctx.hands.root.visible = ctx.mode !== 'title';
    ctx.lighting.update(dt); ctx.sky.update(dt, t); ctx.world.update(dt, t);
    ctx.vfx.update(dt, t); ctx.post.update(dt, t); ctx.audio.update(dt);
    ctx.hud.update(dt); ctx.music.update(dt); ctx.ambience.update(dt); ctx.menus.update(dt); ctx.panels.update(dt);
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
    return { fps: Math.round(fps), mode: ctx.mode, calls: info.render.calls, triangles: info.render.triangles, enemies: ctx.enemies.list.length, anomalies: ctx.anomalies.list?.length, missingSounds: [...ctx.audio.missing], hp: ctx.state.data.hp, pos: ctx.player.position.toArray().map((v) => +v.toFixed(1)), director: ctx.director.state, tension: +ctx.director.tension.toFixed(2), hour: +ctx.state.data.hour.toFixed(2), error: ctx._errorLogged || false };
  },
});

boot();
requestAnimationFrame(loop);
