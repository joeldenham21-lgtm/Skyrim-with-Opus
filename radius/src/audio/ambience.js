// Ambience: wind, the Radius hum, weather, crows and birds (CALM daytime only: their silence is the cue),
// distant gunfire between things that are not us, and the base interior bed.
// Everything is played by canonical name from the sfx registry; a name that is not registered yet is
// skipped and retried later, never assumed. Only handles this module created are stopped on stop().
import * as THREE from 'three';
import { clamp01, damp, remap } from '../core/math.js';
import { POIS } from '../world/map.js';

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const tmp = new THREE.Vector3();

export function createAmbience(ctx) {
  const audio = ctx.audio;
  let running = false;
  const loops = { wind: null, radius_hum: null, base_hum: null, drizzle: null };
  let retryT = 0, ctlT = 0, duck = 0;
  // wind
  const gustPh = [rnd(0, 100), rnd(0, 100), rnd(0, 100)];
  let gust = 0, windLevel = 0, humLevel = 0, humI = 0;
  // weather
  let rain = 0, rainActive = false, rainT = 0, rainCool = 0, hourKey = null, stormWritten = false;
  // crows / birds
  let crowT = rnd(25, 60), birdT = rnd(15, 40), calmT = 0;
  // distant gunfire
  let shotT = rnd(180, 360), gt = 0;   // gt: this module's gameplay clock (stops with the world, unlike ctx.elapsed)
  const queue = [];                 // { t: gt deadline, fn }
  // base
  let dripT = rnd(6, 14), wasInBase = false;
  let lastVolley = null;

  const acquire = (name, opts) => (audio.has(name) ? audio.loop(name, opts) : null);
  function playAt(name, x, y, z, opts) {
    if (!audio.has(name)) return null;
    tmp.set(x, y, z);
    return audio.play(name, { pos: tmp, bus: 'amb', hrtf: true, ...opts });
  }
  // a one-shot somewhere around the player, dmin..dmax metres away, a little above the ground
  function playAround(name, dmin, dmax, yOff, opts) {
    const p = ctx.player.position, a = rnd(0, Math.PI * 2), d = rnd(dmin, dmax);
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    return playAt(name, x, ctx.world.getHeight(x, z) + yOff, z, opts);
  }

  // 1-3 shots from a far point of interest, 150-300 m out, spaced like someone else's firefight
  function scheduleVolley() {
    const p = ctx.player.position;
    const far = POIS.filter((q) => q.kind !== 'base' && Math.hypot(q.x - p.x, q.z - p.z) > 120);
    const poi = far.length ? far[Math.floor(rnd(0, far.length))] : POIS[Math.floor(rnd(1, POIS.length))];
    let dx = poi.x - p.x, dz = poi.z - p.z; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const d = rnd(150, 300), x = p.x + dx * d, z = p.z + dz * d, y = ctx.world.getHeight(x, z) + 1.5;
    const n = 1 + Math.floor(rnd(0, 3)); let at = gt + rnd(0.1, 0.4);
    const rate = rnd(0.88, 1.06);
    lastVolley = { x: +x.toFixed(1), z: +z.toFixed(1), n, poi: poi.id };
    for (let i = 0; i < n; i++) {
      queue.push({ t: at, fn: () => playAt('distant_shot', x, y, z, { gain: rnd(0.55, 0.95), rate: rate * rnd(0.97, 1.03), ref: 90, max: 900, rolloff: 0.8, variant: i }) });
      at += rnd(0.3, 0.7);
    }
  }

  function dripAt() {
    const b = ctx.world.baseVolume;
    const x = rnd(b.min.x + 1, b.max.x - 1), z = rnd(b.min.z + 1, b.max.z - 1);
    playAt('drip', x, ctx.player.position.y + rnd(-0.3, 0.4), z, { gain: rnd(0.35, 0.7), rate: rnd(0.85, 1.2), ref: 1.5, max: 40, reverb: 1.4 });
  }

  function update(dt) {
    if (!running || !audio.ready) return;
    const mode = ctx.mode;
    const live = (mode === 'playing' || mode === 'dead') && !ctx.panels?.isOpen;
    const gdt = live ? dt : 0;
    gt += gdt;
    duck = damp(duck, mode === 'title' ? 0 : 1, 1.5, dt);
    const p = ctx.player.position, inBase = !!ctx.player.inBase;
    const state = ctx.director.state, tension = ctx.director.tension, night = ctx.time.night;
    const t = ctx.elapsed;

    // loops we always want (retry quietly while the sfx registry is still filling in)
    retryT -= dt;
    if (inBase !== wasInBase) { wasInBase = inBase; if (inBase) retryT = 0; }
    if (retryT <= 0) {
      retryT = 1;
      if (!loops.wind) loops.wind = acquire('wind', { bus: 'amb', gain: 0 });
      if (!loops.radius_hum) loops.radius_hum = acquire('radius_hum', { bus: 'amb', gain: 0 });
      if (inBase && !loops.base_hum) loops.base_hum = acquire('base_hum', { bus: 'amb', gain: 0 });
      if (rainActive && !loops.drizzle) loops.drizzle = acquire('drizzle', { bus: 'amb', gain: 0 });
    }

    // wind: gusts from layered slow sines at incommensurate rates, plus tension, weather and altitude
    const gRaw = clamp01(0.5 + 0.5 * (0.5 * Math.sin(t * 0.071 + gustPh[0]) + 0.3 * Math.sin(t * 0.023 + gustPh[1]) + 0.2 * Math.sin(t * 0.137 + gustPh[2])));
    gust = damp(gust, Math.pow(gRaw, 1.6), 0.8, dt);
    const hill = clamp01((p.y - 3) / 22);
    const weather = clamp01(rain * 0.6 + (ctx.lighting.storm || 0) * 0.8);
    // (the wind generator shapes its own gusts from set('gust'); the out gain carries the slower context)
    let wind = Math.min(1, 0.45 + gust * 0.25 + tension * 0.12 + hill * 0.18 + weather * 0.15);
    if (inBase) wind *= 0.1;
    windLevel = damp(windLevel, wind * duck, 1.5, dt);

    // the Radius hum: swells near anomalies (12 m -> 1, 60 m -> 0) over a floor that grows toward the north
    const nd = ctx.anomalies.nearestDistance ? ctx.anomalies.nearestDistance(p) : Infinity;
    const near = Number.isFinite(nd) ? clamp01((60 - nd) / 48) : 0;
    const northFloor = remap(p.z, 300, -300, 0.05, 0.35);
    humI = clamp01(northFloor + (1 - northFloor) * Math.pow(near, 1.5));
    humLevel = damp(humLevel, (0.5 + 0.4 * humI) * (inBase ? 0.25 : 1) * duck, 1.2, dt);   // the generator swells with set('intensity')

    // weather: once per in-game hour, a 20 % chance of a 3-8 real-minute drizzle
    const d = ctx.state.data;
    const hk = Math.floor(d.day * 24 + d.hour);
    if (hk !== hourKey) {
      const first = hourKey === null; hourKey = hk;
      if (!first && live && !rainActive && rainCool <= 0 && !inBase && Math.random() < 0.2) { rainActive = true; rainT = rnd(180, 480); retryT = 0; }
    }
    if (rainActive) { rainT -= gdt; if (rainT <= 0) { rainActive = false; rainCool = 120; } }
    rainCool = Math.max(0, rainCool - gdt);
    rain = damp(rain, rainActive ? 1 : 0, rainActive ? 0.25 : 0.2, dt);
    const tideIdle = !ctx.tide || ctx.tide.phase === 'idle';
    const myStorm = rain * 0.25;
    if (tideIdle) {
      if (myStorm > 0.001) { ctx.lighting.storm = myStorm; stormWritten = true; }
      else if (stormWritten) { ctx.lighting.storm = 0; stormWritten = false; }
    }

    // apply loop levels at ~10 Hz (setTargetAtTime does the smoothing; no need to spam automation events)
    ctlT += dt;
    if (ctlT >= 0.1) {
      ctlT = 0;
      if (loops.wind) { loops.wind.setGain(windLevel, 0.4); loops.wind.set('gust', gust); }
      if (loops.radius_hum) { loops.radius_hum.setGain(humLevel, 0.35); loops.radius_hum.set('intensity', humI); }
      if (loops.drizzle) {
        loops.drizzle.setGain(rain * 0.6 * (inBase ? 0.2 : 1) * duck, 0.5); loops.drizzle.set('intensity', rain);
        if (!rainActive && rain < 0.01) { loops.drizzle.stop(2); loops.drizzle = null; }
      }
      if (loops.base_hum) loops.base_hum.setGain(0.5 * duck, 0.6);
    }

    // base interior: hum while inside, drips every 6-14 s; outside the hum fades away
    if (inBase) {
      dripT -= gdt;
      if (dripT <= 0) { dripT = rnd(6, 14); dripAt(); }
    } else if (loops.base_hum) { loops.base_hum.stop(1.5); loops.base_hum = null; }

    // crows and birds: only CALM daytime, outside. Anything worse and they go quiet.
    const calmDay = live && state === 'CALM' && night < 0.35 && !inBase;
    if (calmDay) {
      calmT += gdt;
      if (calmT > 8) {                 // a short hush after the zone settles before the first call
        crowT -= gdt; birdT -= gdt;
        if (crowT <= 0) { crowT = rnd(25, 60); playAround('crow', 20, 60, rnd(4, 12), { gain: rnd(0.45, 0.8), rate: rnd(0.92, 1.08), ref: 8, max: 300, rolloff: 1 }); }
        if (birdT <= 0) { birdT = rnd(15, 40); playAround('bird', 20, 60, rnd(3, 10), { gain: rnd(0.35, 0.7), rate: rnd(0.9, 1.12), ref: 8, max: 300, rolloff: 1 }); }
      }
    } else if (calmT > 0) { calmT = 0; crowT = rnd(25, 60); birdT = rnd(15, 40); }

    // distant gunfire: CALM / UNEASE only, every 3-6 minutes, from a far POI direction
    if (live && (state === 'CALM' || state === 'UNEASE') && !inBase) {
      shotT -= gdt;
      if (shotT <= 0) { shotT = rnd(180, 360); scheduleVolley(); }
    }
    if (live && queue.length) {
      for (let i = queue.length - 1; i >= 0; i--) { if (queue[i].t <= gt) { const q = queue[i]; queue.splice(i, 1); q.fn(); } }
    }
  }

  function stop() {
    running = false;
    for (const k of Object.keys(loops)) { if (loops[k]) { loops[k].stop(1); loops[k] = null; } }
    queue.length = 0;
    if (stormWritten && (!ctx.tide || ctx.tide.phase === 'idle')) ctx.lighting.storm = 0;
    stormWritten = false; rain = 0; rainActive = false; rainCool = 0; hourKey = null;
    windLevel = 0; humLevel = 0; calmT = 0;
  }

  return {
    // main calls start() on every game start (new game, load, respawn) without a stop() in between: a fresh
    // morning does not inherit the previous session's drizzle (the loop, if any, fades out through the normal path)
    start() { running = true; retryT = 0; hourKey = null; rainActive = false; rainCool = 0; queue.length = 0; },
    stop, update,
    // debug
    debug() { return { wind: +windLevel.toFixed(3), gust: +gust.toFixed(3), hum: +humLevel.toFixed(3), rain: +rain.toFixed(3), rainActive, loops: Object.keys(loops).filter((k) => loops[k]), queued: queue.length, lastVolley, crowT: +crowT.toFixed(1), birdT: +birdT.toFixed(1), shotT: +shotT.toFixed(1) }; },
    // debug: force an event now ('rain' with a duration in seconds, 'volley', 'crow', 'bird', 'drip')
    force(kind, v = 60) {
      if (kind === 'rain') { rainActive = true; rainT = v; retryT = 0; }
      else if (kind === 'volley') scheduleVolley();
      else if (kind === 'crow') { calmT = 9; crowT = 0; }
      else if (kind === 'bird') { calmT = 9; birdT = 0; }
      else if (kind === 'drip') dripT = 0;
    },
  };
}
