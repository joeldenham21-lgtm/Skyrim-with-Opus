// Scripted director events: the zone noticing you when nothing is actually there. Fired every few minutes
// in CALM/UNEASE (never in the base) and on the Director's own 'unease' hook. Every scare is anticipation
// or misdirection, not volume: a figure on the ridge that is gone when you look again, gunfire somewhere
// else, clicks in the grass behind you, a radio voice with no source, a fragment cluster crossing the road,
// the torch failing, footsteps that stop when you stop.
import * as THREE from 'three';
import { clamp, DEG } from '../core/math.js';

const NAMES = ['ridge', 'gunfire', 'clicks', 'radio', 'fragments', 'torch', 'footsteps'];

export function createScares(ctx) {
  const rnd = ctx.rng.fork(777);
  const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3();
  let timer = 90 + rnd() * 90, lastScare = -1e9, lastName = '', hookDelay = -1;
  // running sequences
  let figure = null;            // { e, pos, t, seen }
  let fragments = null;         // { list, t, vx, vz }
  const sounds = [];            // queued positional one-shots { at, name, pos, opts }
  let torch = null;             // { t, next, val }
  let steps = null;             // { waiting, still, t, left, next, pos }
  let soundT = 0;

  const canScare = () => ctx.mode === 'playing' && !ctx.player.inBase && !ctx.player.dead && (ctx.director.state === 'CALM' || ctx.director.state === 'UNEASE');
  const enemiesOk = () => !ctx.debug.noEnemies;
  const unease = (amount = 0.6) => ctx.director.notify('unease', { amount });
  // rotate the player's XZ forward by an angle, write into out
  function heading(angle, out) { const f = ctx.player.forward, s = Math.sin(angle), c = Math.cos(angle); return out.set(f.x * c - f.z * s, 0, f.x * s + f.z * c); }
  function queue(delay, name, pos, opts) { sounds.push({ at: soundT + delay, name, pos: pos.clone(), opts }); }
  function groundY(x, z) { return ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 3).y; }

  // (a) the figure on the ridge: a mimic 60-90 m out in the view direction, standing on higher ground against
  // the sky with clear line of sight, perfectly still. Gone with a soft skip when you look away or after 8 s.
  function ridge() {
    if (!ctx.enemies.types.has('mimic') || !enemiesOk() || ctx.time.night > 0.75) return false;
    const eye = ctx.player.eye, half = ctx.world.half, py = ctx.player.position.y;
    let bx = 0, by = 0, bz = 0, bestScore = -Infinity;
    for (let i = 0; i < 36; i++) {
      const ang = (rnd() - 0.5) * 50 * DEG, d = 60 + rnd() * 30;
      heading(ang, _dir);
      const x = eye.x + _dir.x * d, z = eye.z + _dir.z * d;
      if (Math.abs(x) > half - 8 || Math.abs(z) > half - 8 || ctx.world.isWater(x, z)) continue;
      const y = groundY(x, z);
      if (y < py + 1.5) continue;                                                            // must stand above you
      const behind = Math.max(ctx.world.getHeight(x + _dir.x * 22, z + _dir.z * 22) - y, ctx.world.getHeight(x + _dir.x * 50, z + _dir.z * 50) - y - 2.5);
      if (behind > 1.0) continue;                                                             // against the sky, not a hillside
      if (ctx.world.pointInSolid(x, y + 0.9, z)) continue;
      _p.set(x, y + 1.25, z);
      if (!ctx.world.lineOfSight(eye, _p)) continue;
      const score = (y - py) - behind * 2 - Math.abs(ang) * 4;                                // highest, cleanest skyline, near the view axis
      if (score > bestScore) { bestScore = score; bx = x; by = y; bz = z; }
    }
    if (bestScore === -Infinity) return false;
    _q.set(bx, by, bz);
    // idle: the mimic's standing pose (no gait, no patrol target), facing you
    const e = ctx.enemies.spawn('mimic', _q, { scripted: true, scare: true, idle: true, yaw: Math.atan2(-(ctx.player.position.x - bx), -(ctx.player.position.z - bz)) });
    if (!e) return false;
    e.aware = 0; e.engaged = false;
    figure = { e, pos: _q.clone(), yaw: e.yaw, t: 0 };
    return true;
  }
  function updateFigure(dt) {
    const f = figure, e = f.e;
    f.t += dt;
    if (!e.alive || e.removeMe) { figure = null; return; }
    // a shot fired at it, or near it, and it is simply not there any more
    const disturbed = e.hp < e.maxHp || e.aware >= 0.4;
    // it does not move, does not notice you, does not fire
    e.position.copy(f.pos); e.yaw = f.yaw; e.aware = 0; e.engaged = false; e.lastSeenPlayer = null;
    const looking = e.observedByPlayer(34);
    if (disturbed || (f.t > 1.2 && !looking) || f.t > 8) {
      ctx.audio.play('mimic_skip', { pos: f.pos, gain: 0.45, hrtf: true, max: 160 });
      ctx.vfx.ash(_p.set(f.pos.x, f.pos.y + 0.6, f.pos.z), 10);       // the same ash a skipping mimic leaves
      e.removeMe = true;
      figure = null;
      unease(0.6);
    }
  }
  // (b) distant gunfire: a short exchange in the direction of a far POI
  function gunfire() {
    const p = ctx.player.position;
    const far = ctx.world.map.POIS.filter((q) => q.kind !== 'base' && Math.hypot(q.x - p.x, q.z - p.z) > 160);
    if (!far.length) return false;
    const poi = rnd.pick(far);
    _dir.set(poi.x - p.x, 0, poi.z - p.z).normalize();
    _p.set(p.x + _dir.x * 190, p.y + 4, p.z + _dir.z * 190);
    const n = 2 + rnd.int(0, 2); let t = 0;
    for (let i = 0; i < n; i++) { queue(t, 'distant_shot', _p, { gain: 0.55 + rnd() * 0.2, rate: 0.9 + rnd() * 0.2, max: 900, ref: 60, rolloff: 0.6, hrtf: true }); t += 0.18 + rnd() * 0.65; }
    if (rnd.chance(0.4)) { _q.set(p.x + _dir.x * 210 - _dir.z * 30, p.y + 4, p.z + _dir.z * 210 + _dir.x * 30); t += 0.9; for (let i = 0; i < 2; i++) { queue(t, 'distant_shot', _q, { gain: 0.45, rate: 0.8, max: 900, ref: 60, rolloff: 0.6, hrtf: true }); t += 0.3 + rnd() * 0.4; } }
    unease(0.5);
    return true;
  }
  // (c) clicks in the grass 8-12 m behind you; nothing is there
  function clicks() {
    heading(Math.PI + (rnd() - 0.5) * 1.2, _dir);
    const d = 8 + rnd() * 4, p = ctx.player.position;
    _p.set(p.x + _dir.x * d, 0, p.z + _dir.z * d); _p.y = groundY(_p.x, _p.z) + 0.3;
    const n = 2 + rnd.int(0, 1); let t = 0;
    for (let i = 0; i < n; i++) { queue(t, 'slider_click', _p, { gain: 0.5, rate: 0.95 + rnd() * 0.1, hrtf: true, ref: 3 }); t += 0.35 + rnd() * 0.35; }
    unease(0.6);
    return true;
  }
  // (d) a radio voice from behind cover, once
  function radio() {
    const eye = ctx.player.eye, p = ctx.player.position;
    let best = null;
    const cover = ctx.world.coverPoints;
    for (let i = 0; i < cover.length; i++) {
      const c = cover[i]; const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < 15 || d > 25) continue;
      _p.set(c.x, c.y + 1.2, c.z);
      if (ctx.world.lineOfSight(eye, _p)) continue;
      best = c; if (rnd() < 0.5) break;
    }
    if (best) _p.set(best.x, best.y + 1.2, best.z);
    else { heading(Math.PI + (rnd() - 0.5) * 1.6, _dir); const d = 15 + rnd() * 10; _p.set(p.x + _dir.x * d, 0, p.z + _dir.z * d); _p.y = groundY(_p.x, _p.z) + 1.2; }
    queue(0, 'mimic_radio', _p, { gain: 0.55, hrtf: true, ref: 4 });
    unease(0.65);
    return true;
  }
  // (e) a fragment cluster crossing ahead: three of them, 40 m out, drifting across the road. Real.
  function fragmentsScare() {
    if (!ctx.enemies.types.has('fragment') || !enemiesOk() || ctx.director.state !== 'CALM') return false;
    const eye = ctx.player.eye, p = ctx.player.position, f = ctx.player.forward;
    _right.set(f.z, 0, -f.x);
    const side = rnd() < 0.5 ? -1 : 1;
    // the cluster starts out of sight: behind something, or beyond the edge of a wide screen (half-angle > 58 deg)
    let cx = 0, cz = 0, found = false;
    for (const lat of [30, 36, 42, 52, 64]) {
      const x = p.x + f.x * 40 + _right.x * lat * side, z = p.z + f.z * 40 + _right.z * lat * side;
      if (Math.abs(x) > ctx.world.half - 8 || Math.abs(z) > ctx.world.half - 8) continue;
      const y = groundY(x, z);
      if (ctx.world.pointInSolid(x, y + 1.5, z)) continue;
      _p.set(x, y + 1.5, z);
      const offAxis = Math.atan2(lat, 40) > 58 * DEG;
      if (offAxis || !ctx.world.lineOfSight(eye, _p)) { cx = x; cz = z; found = true; break; }
    }
    if (!found) return false;
    const list = [];
    for (let i = 0; i < 3; i++) {
      _q.set(cx + (rnd() - 0.5) * 5, 0, cz + (rnd() - 0.5) * 5);
      const e = ctx.enemies.spawn('fragment', _q, { scripted: true, scare: true });
      if (e) list.push(e);
    }
    if (!list.length) return false;
    fragments = { list, t: 0, vx: -_right.x * side * 2.4, vz: -_right.z * side * 2.4 };
    unease(0.5);
    return true;
  }
  function updateFragments(dt) {
    const s = fragments; s.t += dt;
    for (const e of s.list) { if (!e.alive || e.aware >= 1) continue; e.position.x += s.vx * dt; e.position.z += s.vz * dt; }
    if (s.t > 14) fragments = null;
  }
  // (f) the torch stutters for two seconds at night
  function torchScare() {
    if (ctx.time.night < 0.6 || !ctx.state.data.flashlight.on) return false;
    torch = { t: 0, next: 0, val: 1 };
    unease(0.45);
    return true;
  }
  function updateTorch(dt) {
    const s = torch; s.t += dt; s.next -= dt;
    if (s.next <= 0) {
      const prev = s.val; s.val = 0.2 + rnd() * 0.8; s.next = 0.07 + rnd() * 0.08;
      if (prev > 0.6 && s.val < 0.4) ctx.audio.play('click', { gain: 0.12, rate: 1.4 });
    }
    if (ctx.state.data.flashlight.on) ctx.lighting.flashTarget = s.val;
    if (s.t >= 2) { torch = null; if (ctx.state.data.flashlight.on) ctx.lighting.flashTarget = 1; }
  }
  // (g) footsteps that are not yours: when you stop, two or three more steps behind you, then nothing
  function footsteps() {
    if (!ctx.player.moving) return false;
    steps = { waiting: true, still: 0, t: 0, left: 2 + rnd.int(0, 1), next: 0.35, pos: new THREE.Vector3(), dx: 0, dz: 0 };
    return true;
  }
  function updateSteps(dt) {
    const s = steps; s.t += dt;
    if (s.waiting) {
      if (s.t > 30) { steps = null; return; }
      if (ctx.player.moving) { s.still = 0; return; }
      s.still += dt; if (s.still < 0.5) return;
      s.waiting = false;
      heading(Math.PI + (rnd() - 0.5) * 0.7, _dir);
      const d = 4 + rnd() * 2, p = ctx.player.position;
      s.pos.set(p.x + _dir.x * d, 0, p.z + _dir.z * d); s.pos.y = groundY(s.pos.x, s.pos.z); s.dx = _dir.x; s.dz = _dir.z;
    }
    s.next -= dt;
    if (s.next <= 0) {
      s.next = 0.5;
      const surf = ctx.world.getSurface(s.pos.x, s.pos.z);
      ctx.audio.play('step_' + (surf === 'water' ? 'mud' : surf), { pos: s.pos, gain: 0.55, rate: 0.9 + rnd() * 0.1, hrtf: true, ref: 2 });
      s.pos.x -= s.dx * 0.6; s.pos.z -= s.dz * 0.6;                  // each step a little closer
      if (--s.left <= 0) { steps = null; unease(0.6); }
    }
  }

  const FIRE = { ridge, gunfire, clicks, radio, fragments: fragmentsScare, torch: torchScare, footsteps };
  function pick() {
    const night = ctx.time.night, torchOn = ctx.state.data.flashlight.on;
    const w = {
      ridge: night < 0.75 && ctx.enemies.types.has('mimic') && enemiesOk() && !figure ? 3 : 0,
      gunfire: 2, clicks: 2, radio: 2,
      fragments: ctx.enemies.types.has('fragment') && enemiesOk() && ctx.director.state === 'CALM' && !fragments ? 1.2 : 0,
      torch: night >= 0.6 && torchOn ? 2.5 : 0,
      footsteps: ctx.player.moving && !steps ? 1.5 : 0,
    };
    if (lastName && w[lastName]) w[lastName] *= 0.25;
    let sum = 0; for (const k in w) sum += w[k];
    let r = rnd() * sum;
    for (const k in w) { r -= w[k]; if (r <= 0 && w[k] > 0) return k; }
    return 'clicks';
  }
  function schedule() {
    const weight = (ctx.time.isNight ? 1.6 : 1) * Math.pow(1.2, ctx.state.data.tideLevel - 1);
    timer = (120 + rnd() * 240) / weight;
  }

  const api = {
    get pending() { return { figure: !!figure, fragments: !!fragments, torch: !!torch, steps: !!steps, sounds: sounds.length, timer }; },
    // fire a scare by name now (tests). Returns true if it started.
    trigger(name) {
      if (!name || name === 'any') name = pick();
      const fn = FIRE[name];
      if (!fn) return false;
      const ok = fn();
      if (ok) { lastScare = ctx.elapsed; lastName = name; }
      return ok;
    },
    update(dt) {
      soundT += dt;
      // queued positional one-shots
      for (let i = sounds.length - 1; i >= 0; i--) { const s = sounds[i]; if (soundT >= s.at) { ctx.audio.play(s.name, Object.assign({ pos: s.pos }, s.opts)); sounds.splice(i, 1); } }
      if (figure) updateFigure(dt);
      if (fragments) updateFragments(dt);
      if (torch) updateTorch(dt);
      if (steps) updateSteps(dt);
      if (dt <= 0) return;
      // the Director's own unease hook fires a scare a few seconds after the state flips
      if (hookDelay >= 0) { hookDelay -= dt; if (hookDelay < 0) { hookDelay = -1; if (canScare() && ctx.elapsed - lastScare > 40) api.trigger(pick()); } }
      timer -= dt;
      if (timer > 0) return;
      if (!canScare() || ctx.elapsed - lastScare < 45) { timer = 10 + rnd() * 15; return; }
      if (api.trigger(pick())) schedule(); else timer = 12 + rnd() * 20;
    },
  };
  function clear() {
    if (figure) { figure.e.removeMe = true; figure = null; }
    if (fragments) { for (const e of fragments.list) if (e.alive) e.removeMe = true; fragments = null; }
    torch = null; steps = null; sounds.length = 0; hookDelay = -1;
  }
  ctx.events.on('directorEvent', (name) => { if (name === 'unease' && canScare()) hookDelay = 2 + rnd() * 4; });
  ctx.events.on('gameStart', () => { clear(); lastScare = -1e9; lastName = ''; timer = 90 + rnd() * 120; });
  ctx.events.on('tide', clear);
  ctx.events.on('playerDied', clear);
  ctx.events.on('enterBase', () => { if (figure) { figure.e.removeMe = true; figure = null; } torch = null; steps = null; sounds.length = 0; });
  api.names = NAMES;
  return api;
}
