// Population — the census. Decides who lives where by POI kind and Tide level, keeps the crowd out of the
// player's sight and never within 35 m, caps what is alive, lets the dead stay dead until the Tide, and at
// night in UNEASE sends the odd wanderer up behind you.
//
// The census is a plan, not a spawn burst: every POI gets its full table as plan entries; an entry becomes an
// entity only while the player is within range of it (out of view, > 35 m), and a far, unaware entity is
// retired back into the plan so the alive count stays bounded and spawns always happen off-screen.
// Nothing here is saved; a load simply re-rolls the zone.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _dir = new THREE.Vector3();
const MIN_PLAYER_DIST = 35, MAX_ALIVE = 28, MAX_NEAR = 8, NEAR_R = 60, ACTIVATE_R = 170, RETIRE_R = 260;

// spawn tables by POI kind: fn(tide, poi, rng) -> [[type, count, spotKind, pack?], ...]
const TABLES = {
  checkpoint: (tide) => [['mimic', 2 + (tide >= 2 ? 1 : 0), 'exterior']],
  convoy: () => [['mimic', 1, 'exterior'], ['slider', 1, 'hidden']],
  village: () => [['mimic', 3, 'exterior'], ['slider', 2, 'hidden'], ['spawn', 4, 'interior', true]],
  industrial: (tide) => [['mimic', 3, 'exterior'], ['fragment', 3, 'field'], ...(tide >= 2 ? [['seeker', 1, 'exterior']] : [])],
  church: (tide) => [['mimic', 2, 'exterior'], ['slider', 2, 'hidden'], ...(tide >= 2 ? [['seeker', 1, 'exterior']] : [])],
  rail: () => [['spawn', 5, 'interior', true], ['slider', 2, 'hidden']],
  forest: () => [['slider', 3, 'hidden']],
  anomaly: (tide, poi, rng) => [['fragment', poi.anomaly === 'gas' ? 3 : rng.int(2, 4), 'field']],
  ridge: (tide) => (tide >= 3 ? [['mimic', 2, 'exterior']] : []),
};

export function createPopulation(ctx) {
  const rng = ctx.rng.fork(53);
  let plan = [], pending = false, seeded = false, wanderer = null, wanderT = 180 + Math.random() * 180, scanT = 0;

  const alive = () => { let n = 0; for (const e of ctx.enemies.list) if (e.alive) n++; return n; };
  const nearAlive = () => { let n = 0; const p = ctx.player.position; for (const e of ctx.enemies.list) if (e.alive && e.position.distanceTo(p) < NEAR_R) n++; return n; };
  const groundY = (x, z) => ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2.5).y;

  // would a thing standing here be inside the player's view? (same rule as Enemy.observedByPlayer, wider angle;
  // chest and head both have to be hidden, so a figure half behind a trunk does not pop in)
  function visibleFromPlayer(x, y, z, halfAngleDeg = 62) {
    const cam = ctx.camera; cam.getWorldDirection(_dir);
    _v.set(x, y + 0.9, z).sub(ctx.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    if (_dir.dot(_v) < Math.cos((halfAngleDeg * Math.PI) / 180)) return false;
    return ctx.world.lineOfSight(ctx.player.eye, _v2.set(x, y + 0.9, z)) || ctx.world.lineOfSight(ctx.player.eye, _v2.set(x, y + 1.7, z));
  }
  function standable(x, z) {
    const w = ctx.world;
    if (Math.abs(x) > w.half - 8 || Math.abs(z) > w.half - 8) return false;
    if (w.isWater(x, z)) return false;
    const y = groundY(x, z);
    if (w.pointInSolid(x, y + 0.6, z)) return false;
    if (w.isInBase(_v2.set(x, y, z))) return false;
    if (Math.hypot(x - w.map.BASE.x, z - w.map.BASE.z) < 40) return false;
    return true;
  }
  // can an entity appear here right now? far enough and out of view
  function clearToSpawn(x, z, minDist = MIN_PLAYER_DIST) {
    const p = ctx.player.position;
    if (Math.hypot(x - p.x, z - p.z) < minDist) return false;
    return !visibleFromPlayer(x, groundY(x, z), z);
  }
  // choose a standing place at a POI: registered spawn spots of the wanted kind first, then random points
  function findSpot(poi, kind, used, opts = {}) {
    const w = ctx.world;
    const spots = w.spawnSpots.filter((s) => s.poi === poi.id && (kind === 'field' || !kind || s.kind === kind) && !used.has(s));
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
    for (const s of spots) { const p = s.position; if (opts.near && Math.hypot(p.x - opts.near.x, p.z - opts.near.z) > (opts.nearR ?? 8)) continue; if (standable(p.x, p.z)) { used.add(s); return new THREE.Vector3(p.x, groundY(p.x, p.z), p.z); } }
    if (kind === 'interior' && spots.length) return null;   // interiors only where the structures agent put them
    const r = kind === 'field' ? poi.r * 0.75 : poi.r * 0.8;
    for (let i = 0; i < 16; i++) {
      const p = opts.near ? w.randomPoint(rng, opts.near.x, opts.near.z, opts.nearR ?? 8) : w.randomPoint(rng, poi.x, poi.z, r);
      if (!p) continue;
      if (Math.hypot(p.x - poi.x, p.z - poi.z) > poi.r) continue;
      if (standable(p.x, p.z)) return p;
    }
    return null;
  }
  function planPoi(poi) {
    const tide = ctx.state.data.tideLevel || 1;
    const table = TABLES[poi.kind]; if (!table) return;
    const used = new Set();
    for (const [type, count, kind, pack] of table(tide, poi, rng)) {
      if (pack) {
        // a pack shares one spot and spreads around it
        const center = findSpot(poi, kind, used); if (!center) continue;
        for (let i = 0; i < count; i++) {
          const a = rng() * Math.PI * 2, r = 0.8 + rng() * 2.2;
          const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
          const pos = standable(x, z) ? new THREE.Vector3(x, groundY(x, z), z) : center.clone();
          plan.push({ type, pos, poi, pack: center });
        }
        continue;
      }
      let anchor = null;
      for (let i = 0; i < count; i++) {
        // mimics patrol in pairs: the second stands near the first
        const pair = type === 'mimic' && anchor && i % 2 === 1;
        const pos = (pair && findSpot(poi, kind, used, { near: anchor, nearR: 9 })) || findSpot(poi, kind, used);
        if (!pos) continue;
        plan.push({ type, pos, poi });
        if (type === 'mimic') anchor = pos;
      }
    }
  }
  function spawnEntry(en) {
    const poi = en.poi;
    const yaw = poi ? Math.atan2(-(poi.x - en.pos.x), -(poi.z - en.pos.z)) + rng.range(-0.8, 0.8) : rng() * Math.PI * 2;
    const e = ctx.enemies.spawn(en.type, en.pos, Object.assign({ poi: poi?.id, yaw }, en.pack ? { pack: en.pack } : {}, en.extra || {}));
    if (e) e.census = en;
    return e;
  }
  // instantiate plan entries in range and out of view; retire far, unaware entities back into the plan
  function scan() {
    const p = ctx.player.position;
    let n = alive(), near = nearAlive();
    for (let i = plan.length - 1; i >= 0; i--) {
      const en = plan[i];
      if (!ctx.enemies.types.has(en.type)) continue;
      const d = Math.hypot(en.pos.x - p.x, en.pos.z - p.z);
      if (d > ACTIVATE_R || d < MIN_PLAYER_DIST) continue;
      if (n >= MAX_ALIVE) break;
      if (d < NEAR_R && near >= MAX_NEAR) continue;
      if (!clearToSpawn(en.pos.x, en.pos.z)) continue;
      const e = spawnEntry(en);
      if (!e) continue;
      plan.splice(i, 1); n++; if (d < NEAR_R) near++;
    }
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.removeMe || !e.census || e.aware > 0.3) continue;
      if (e.position.distanceTo(p) < RETIRE_R) continue;
      e.census.pos.copy(e.position); e.census.pos.y = groundY(e.position.x, e.position.z);
      plan.push(e.census); e.census = null; e.removeMe = true;   // the manager disposes it at the end of its update
    }
  }
  function spawnWanderer() {
    const p = ctx.player, w = ctx.world;
    const type = rng.chance(0.6) ? 'mimic' : 'slider';
    if (!ctx.enemies.types.has(type) || alive() >= MAX_ALIVE) return;
    for (let i = 0; i < 10; i++) {
      const dist = 45 + rng() * 25, side = (rng() - 0.5) * 30;
      const x = p.position.x - p.forward.x * dist + p.forward.z * side, z = p.position.z - p.forward.z * dist - p.forward.x * side;
      if (!standable(x, z) || !clearToSpawn(x, z, 40)) continue;
      const e = ctx.enemies.spawn(type, _v.set(x, groundY(x, z), z), { wanderer: true, yaw: p.yaw });
      if (e) { if (e.type === 'mimic') { e.aware = 0.5; e.lastSeenPlayer = p.position.clone(); e.lastSeenT = ctx.elapsed; } wanderer = e; }
      return;
    }
  }

  const api = {
    get count() { return alive(); },
    get planned() { return plan.length; },
    counts() { const c = {}; for (const e of ctx.enemies.list) if (e.alive) c[e.type] = (c[e.type] || 0) + 1; return c; },
    // the full census: alive entities plus planned ones, by POI and type
    census() { const c = {}; const add = (poi, type) => { const k = poi || 'wild'; c[k] = c[k] || {}; c[k][type] = (c[k][type] || 0) + 1; }; for (const e of ctx.enemies.list) if (e.alive) add(e.poi, e.type); for (const en of plan) add(en.poi?.id, en.type); return c; },
    reset() { ctx.enemies.removeAll(); plan = []; wanderer = null; pending = false; seeded = false; },
    populate() {
      pending = false; seeded = true; plan = [];
      if (ctx.debug.noEnemies) return 0;
      for (const poi of ctx.world.pois) planPoi(poi);
      scan();
      return plan.length + alive();
    },
    update(dt) {
      if (pending) { api.populate(); return; }
      if (!seeded || ctx.debug.noEnemies || ctx.mode !== 'playing') return;
      scanT -= dt; if (scanT <= 0) { scanT = 0.8; scan(); }
      if (wanderer && (!wanderer.alive || wanderer.removeMe)) wanderer = null;
      // wanderers: night, UNEASE, nobody else on your heels, every 3-6 min
      wanderT -= dt;
      if (wanderT <= 0) {
        wanderT = 180 + rng() * 180;
        if (!wanderer && ctx.time.isNight && ctx.director.state === 'UNEASE' && !ctx.player.inBase && !ctx.player.dead) spawnWanderer();
      }
    },
  };
  // the census is taken one frame after the reset so the player has been placed first
  ctx.events.on('gameStart', () => { api.reset(); pending = true; wanderT = 120 + rng() * 120; });
  ctx.events.on('tide', () => { api.reset(); pending = true; });
  return api;
}
