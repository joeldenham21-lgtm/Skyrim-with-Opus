// The Director: the zone's nervous system. It never spawns by itself (population.js does) but it decides the
// mood — CALM -> UNEASE -> HUNT -> COMBAT -> AFTERMATH -> CALM, with guaranteed rest — and, since v3, three
// things the entities read every second:
//
//   pressure  0..1  how hard the zone is pressing right now: Tide level, the Explorer's clearance, night, and
//                   how much noise you have been making lately. Mimics fold this into their skill curve, so a
//                   loud fight in a deep Tide makes the next contact sharper than the last.
//   alarm     0..1  short-run alertness. Rises on gunfire, sightings, kills and hits; bleeds off over ~45 s.
//                   Mimics share contacts faster and search longer while it is high.
//   contact         one zone-level "where they were" — a position, a time and a confidence that decays. It is
//                   deliberately fuzzy: anyone can report(), anyone can read it, nobody gets your exact feet.
//
// It also stops handing out omniscience: recentShotAt/nearestShot weight a shot by how loud it actually was
// (weapons.js passes `noise`; a suppressed round carries a third of the distance), and nearestShot returns the
// position of the shot rather than the position of the shooter, so an entity investigates the noise, not you.
import * as THREE from 'three';
import { clamp, clamp01, damp, lerp } from '../core/math.js';

export const STATES = ['CALM', 'UNEASE', 'HUNT', 'COMBAT', 'AFTERMATH'];

// ---- the zone's pressure dial (see enemies/mimic.js SKILL for what the entities do with it) ----
export const PRESSURE = {
  tide: 0.20,          // per Tide level above the first (1..3)
  security: 0.085,     // per clearance level above the first (1..5)
  night: 0.12,         // at full dark
  heat: 0.24,          // how much your recent noise counts
  state: { CALM: 0, UNEASE: 0.04, HUNT: 0.12, COMBAT: 0.18, AFTERMATH: 0.07 },
  heatShot: 0.045,     // heat added per gunshot heard (times its loudness)
  heatKill: 0.11,      // per entity you kill
  heatHurt: 0.05,      // per time you are hurt
  heatDecay: 0.013,    // per second (about 75 s to shed a full head of it)
  alarm: { shot: 0.20, spotted: 0.50, kill: 0.45, damaged: 0.32, unease: 0.10 },
  alarmDecay: 0.022,   // per second, doubled in CALM
  contactLife: [26, 70],   // s a zone-level contact is worth acting on, at pressure 0 .. 1
  huntFor: [14, 48],       // s HUNT persists with nobody engaged
  combatFor: [8, 20],      // s of quiet before COMBAT lets go
};
const SHOT_MEM = 6;        // s a gunshot stays in the zone's ear

// ---- what the zone remembers about you ----
// A coarse grid over the map, written ONLY by things the zone could actually have registered: a shot somebody
// heard, a body somebody will find, a sighting one of its own called in. Walk somewhere unseen and unheard and
// you leave nothing behind. population.js reads this when it re-plans after a Tide, which is why the second
// time you work a place it is not the same place: the patrol route runs through where you were last time, and
// there is a group sitting on the way you came in.
const MEM_CELL = 56;       // m; about a third of a POI
const MEM_MAX = 96;        // cells kept, oldest-coldest dropped
const MEM_DECAY = 1 / 900; // per second: a quarter of an hour of nothing and a place is cold again

export function createDirector(ctx) {
  const shots = [];     // { pos, t, noise } recent gunshots (for hearing)
  let state = 'CALM', stateT = 0, tension = 0, calmGuard = 0, lastCombat = -1e9, lastShot = -1e9, unease = 0, uneaseTimer = 120 + Math.random() * 120;
  let threatNear = 0, engaged = 0, heat = 0, alarm = 0, pressure = 0;
  // one fuzzy zone-level contact, shared by everything that can hear a radio
  const contact = { position: new THREE.Vector3(), t: -1e9, weight: 0, radius: 0, has: false };
  // ---- the zone's memory of you (see MEM_CELL above) ----
  const mem = new Map();          // key "gx,gz" -> { x, z, noise, blood, seen, t }
  const poiMem = new Map();       // poi id -> { contacts, ang (bearing you last came in on), t, evidence }
  let visit = null;               // the POI you are inside right now, and what it has on you so far
  let memT = 0, escalation = 0, escT = 0, totalNoise = 0, totalBlood = 0;
  const memKey = (x, z) => `${Math.floor(x / MEM_CELL)},${Math.floor(z / MEM_CELL)}`;
  function memCell(x, z) {
    const k = memKey(x, z);
    let c = mem.get(k);
    if (!c) {
      if (mem.size >= MEM_MAX) { let worst = null, ws = Infinity; for (const [kk, cc] of mem) { const s = cc.noise + cc.blood + cc.seen; if (s < ws) { ws = s; worst = kk; } } if (worst) mem.delete(worst); }
      c = { x: (Math.floor(x / MEM_CELL) + 0.5) * MEM_CELL, z: (Math.floor(z / MEM_CELL) + 0.5) * MEM_CELL, noise: 0, blood: 0, seen: 0, t: ctx.elapsed };
      mem.set(k, c);
    }
    return c;
  }
  const api = {
    get state() { return state; }, get stateT() { return stateT; }, get tension() { return tension; },
    get threatNear() { return threatNear; }, get engaged() { return engaged; }, get lastCombat() { return lastCombat; },
    // 0..1 difficulty pressure; entities scale their skill curve by it
    get pressure() { return pressure; },
    // 0..1 how alert the zone is right now
    get alarm() { return alarm; },
    // 0..1 how much noise the player has made in the last minute or so
    get heat() { return heat; },
    get contact() { return contact.has ? contact : null; },
    // 0..3: how far the zone has escalated its answer to you. 0 is a patrol; 3 is everything it has, and the
    // things that are not people. population.js reads it to decide what it is allowed to put on the board.
    get escalation() { return escalation; },
    // ---- memory ----
    // kind: 'noise' (a shot heard), 'blood' (one of theirs killed), 'seen' (one of theirs called you in).
    // Nothing else writes here: the zone learns only what it could actually have registered.
    noteActivity(pos, kind = 'noise', amount = 1) {
      if (!pos) return;
      const c = memCell(pos.x, pos.z);
      c[kind] = (c[kind] || 0) + amount; c.t = ctx.elapsed;
      if (kind === 'noise') totalNoise += amount; else if (kind === 'blood') totalBlood += amount;
      if (visit) visit.evidence += kind === 'blood' ? 3 : kind === 'seen' ? 2 : 1;
    },
    // 0..1 how well the zone knows this patch of ground
    memoryAt(x, z) { const c = mem.get(memKey(x, z)); return c ? clamp01((c.noise * 0.12 + c.seen * 0.3 + c.blood * 0.45)) : 0; },
    // the places it knows best, hottest first: [{ x, z, heat, noise, blood, seen }]
    hotspots(n = 6) {
      const out = [];
      for (const c of mem.values()) {
        const heat = clamp01(c.noise * 0.12 + c.seen * 0.3 + c.blood * 0.45);
        if (heat > 0.06) out.push({ x: c.x, z: c.z, heat, noise: c.noise, blood: c.blood, seen: c.seen, t: c.t });
      }
      out.sort((a, b) => b.heat - a.heat);
      return out.slice(0, n);
    },
    // what it has on a place: how many times you have been in contact there, and the bearing you walk in on
    poiRecord(id) { return poiMem.get(id) || null; },
    memory() { return { cells: mem.size, pois: [...poiMem.entries()].map(([k, v]) => ({ poi: k, contacts: v.contacts, ang: +v.ang.toFixed(2) })), noise: +totalNoise.toFixed(1), blood: totalBlood, escalation }; },
    forgetAll() { mem.clear(); poiMem.clear(); visit = null; totalNoise = 0; totalBlood = 0; escalation = 0; },
    // strength of recent gunfire heard at a position (0..1), decays over SHOT_MEM seconds.
    // A shot's reach is its `range` scaled by how loud the round was: suppressed fire barely travels.
    recentShotAt(pos, range = 120) {
      let s = 0; const t = ctx.elapsed;
      for (let i = 0; i < shots.length; i++) {
        const sh = shots[i]; const age = t - sh.t; if (age > SHOT_MEM) continue;
        const r = range * sh.noise; const d = sh.pos.distanceTo(pos); if (d > r) continue;
        s += (1 - d / r) * (1 - age / SHOT_MEM);
      }
      return clamp01(s);
    },
    // the loudest shot audible from `pos`: returns 0..1 and writes WHERE THE SHOT WAS into `out` (not where the
    // shooter is now). Entities investigate the noise; the error they add to it is their own business.
    nearestShot(pos, range = 120, out = null) {
      let best = 0, bi = -1; const t = ctx.elapsed;
      for (let i = 0; i < shots.length; i++) {
        const sh = shots[i]; const age = t - sh.t; if (age > SHOT_MEM) continue;
        const r = range * sh.noise; const d = sh.pos.distanceTo(pos); if (d > r) continue;
        const s = (1 - d / r) * (1 - age / SHOT_MEM);
        if (s > best) { best = s; bi = i; }
      }
      if (bi >= 0 && out) out.copy(shots[bi].pos);
      return best;
    },
    // ---- zone-level contact memory ----
    // weight 0..1 is how sure the reporter is; radius is how wide the guess is, in metres.
    report(pos, weight = 1, radius = 0) {
      const t = ctx.elapsed;
      if (!pos) return;
      if (weight >= api.contactConfidence() - 0.05 || t - contact.t > 4) {
        contact.position.copy(pos); contact.t = t; contact.weight = clamp01(weight); contact.radius = radius; contact.has = true;
      }
    },
    contactAge() { return contact.has ? ctx.elapsed - contact.t : Infinity; },
    contactConfidence() {
      if (!contact.has) return 0;
      const life = lerp(PRESSURE.contactLife[0], PRESSURE.contactLife[1], pressure);
      return clamp01(contact.weight * (1 - (ctx.elapsed - contact.t) / life));
    },
    forgetContact() { contact.has = false; contact.weight = 0; },
    // A visit is filed only if the zone had something on you while you were there. That is the whole fairness
    // rule for memory: it records contacts, not footprints.
    closeVisit() {
      if (visit && visit.evidence >= 2) {
        const r = poiMem.get(visit.poi) || { contacts: 0, ang: visit.ang, t: 0 };
        r.contacts++; r.ang = visit.ang; r.t = ctx.elapsed;
        poiMem.set(visit.poi, r);
      }
      visit = null;
    },
    setState(s) {
      if (s === state) return;
      const prev = state; state = s; stateT = 0;
      if (s === 'CALM') calmGuard = 90;
      ctx.events.emit('directorState', s, prev);
    },
    // kinds: 'shot' {pos, noise}, 'spotted' {enemy}, 'lost' {enemy}, 'kill' {enemy}, 'damaged' {amount},
    //        'contact' {pos, weight, radius} (an entity calling one in), 'unease', 'anomaly'
    notify(kind, data = {}) {
      const t = ctx.elapsed;
      switch (kind) {
        case 'shot': {
          const noise = clamp(data.noise == null ? 1 : data.noise, 0.25, 1.5);
          shots.push({ pos: data.pos.clone(), t, noise });
          if (shots.length > 32) shots.shift();
          lastShot = t; heat = clamp01(heat + PRESSURE.heatShot * noise); alarm = clamp01(alarm + PRESSURE.alarm.shot * noise);
          api.noteActivity(data.pos, 'noise', noise);
          if (state !== 'COMBAT' && engaged > 0) api.setState('COMBAT');
          break;
        }
        case 'spotted':
          alarm = clamp01(alarm + PRESSURE.alarm.spotted);
          if (data.enemy) { api.report(ctx.player.position, 1, 0); api.noteActivity(data.enemy.position, 'seen', 1); }
          if (state === 'CALM' || state === 'UNEASE' || state === 'AFTERMATH') api.setState('HUNT');
          break;
        case 'damaged':
          lastCombat = t; heat = clamp01(heat + PRESSURE.heatHurt); alarm = clamp01(alarm + PRESSURE.alarm.damaged);
          if (data.source && state !== 'COMBAT') api.setState('COMBAT');
          break;
        case 'kill':
          lastCombat = t; heat = clamp01(heat + PRESSURE.heatKill); alarm = clamp01(alarm + PRESSURE.alarm.kill);
          if (data.enemy) api.noteActivity(data.enemy.position, 'blood', 1);
          if (state !== 'COMBAT') api.setState('COMBAT');
          break;
        case 'contact':
          api.report(data.pos, data.weight ?? 0.7, data.radius ?? 0);
          alarm = clamp01(alarm + 0.12);
          if (state === 'CALM' || state === 'AFTERMATH') api.setState('UNEASE');
          break;
        case 'unease': unease = Math.max(unease, data.amount ?? 0.6); alarm = clamp01(alarm + PRESSURE.alarm.unease); if (state === 'CALM') api.setState('UNEASE'); break;
        case 'anomaly': unease = Math.max(unease, 0.3); if (state === 'CALM' && calmGuard <= 0) api.setState('UNEASE'); break;
        case 'lost': break;
      }
      ctx.events.emit('directorNotify', kind, data);
    },
    // Force a period of calm (after sleeping, entering base)
    rest() { api.setState('CALM'); tension = 0; unease = 0; calmGuard = 120; alarm = 0; heat *= 0.35; api.forgetContact(); },
    update(dt) {
      stateT += dt; calmGuard = Math.max(0, calmGuard - dt);
      const t = ctx.elapsed;
      const p = ctx.player.position;
      const d = ctx.state.data;
      // survey entities
      engaged = 0; let nearest = Infinity, awareSum = 0;
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        const dd = e.position.distanceTo(p);
        if (e.aware >= 1) engaged++;
        if (e.aware > 0.3 && dd < 70) awareSum += e.aware;
        if (dd < nearest) nearest = dd;
      }
      threatNear = clamp01((60 - nearest) / 60);
      unease = Math.max(0, unease - dt * 0.03);
      const night = ctx.time.night;
      // heat and alarm bleed off; the zone forgets faster when nothing is happening
      heat = Math.max(0, heat - dt * PRESSURE.heatDecay);
      alarm = Math.max(0, alarm - dt * PRESSURE.alarmDecay * (state === 'CALM' ? 2 : 1));
      if (engaged > 0) alarm = Math.max(alarm, 0.75);
      // the one difficulty dial the entities read
      pressure = clamp01(
        Math.max(0, ((d.tideLevel | 0) || 1) - 1) * PRESSURE.tide +
        Math.max(0, ((d.securityLevel | 0) || 1) - 1) * PRESSURE.security +
        night * PRESSURE.night + heat * PRESSURE.heat + (PRESSURE.state[state] || 0));
      // ---- memory bookkeeping, once a second ----
      memT -= dt;
      if (memT <= 0) {
        memT = 1;
        for (const c of mem.values()) { c.noise *= 1 - MEM_DECAY; c.seen *= 1 - MEM_DECAY; c.blood *= 1 - MEM_DECAY * 0.4; }
        // which place you are working, and whether it has anything on you. A visit nobody saw and nobody heard
        // teaches the zone nothing, which is what makes a quiet approach worth making.
        const near = ctx.world.nearestPoi ? ctx.world.nearestPoi(p.x, p.z) : null;
        const poi = near && near.poi && near.distance < near.poi.r + 25 ? near.poi : null;
        if (poi && (!visit || visit.poi !== poi.id)) {
          if (visit) api.closeVisit();
          visit = { poi: poi.id, ang: Math.atan2(p.z - poi.z, p.x - poi.x), evidence: 0, t };
        } else if (!poi && visit) api.closeVisit();
      }
      // escalation: what the zone is willing to put on the board. Tide sets the ceiling; your noise and the
      // bodies you leave decide how much of it you actually meet.
      escT -= dt;
      if (escT <= 0) {
        escT = 4;
        const tide = clamp((d.tideLevel | 0) || 1, 1, 3);
        const earned = clamp01(totalNoise / 26) * 1.2 + clamp01(totalBlood / 10) * 1.3 + heat * 0.8;
        escalation = Math.min(tide, Math.floor(earned));
      }
      // scheduled unease: the zone breathes even when nothing is there
      uneaseTimer -= dt;
      if (uneaseTimer <= 0 && state === 'CALM' && !ctx.player.inBase && calmGuard <= 0) { uneaseTimer = 150 + Math.random() * 200; unease = 0.5 + Math.random() * 0.3; api.setState('UNEASE'); ctx.events.emit('directorEvent', 'unease'); }
      // a live contact keeps the zone leaning forward
      const conf = api.contactConfidence();
      // transitions
      const huntFor = lerp(PRESSURE.huntFor[0], PRESSURE.huntFor[1], pressure);
      const combatFor = lerp(PRESSURE.combatFor[0], PRESSURE.combatFor[1], pressure);
      switch (state) {
        case 'CALM':
          if (engaged > 0) api.setState('HUNT');
          else if (calmGuard <= 0 && (awareSum > 0.4 || (threatNear > 0.55 && night > 0.5) || unease > 0.4)) api.setState('UNEASE');
          break;
        case 'UNEASE':
          if (engaged > 0) api.setState('HUNT');
          else if (awareSum < 0.1 && unease < 0.2 && threatNear < 0.4 && conf < 0.15 && stateT > 25) api.setState('CALM');
          break;
        case 'HUNT':
          if (t - lastShot < 4 || t - lastCombat < 4) api.setState('COMBAT');
          else if (engaged === 0 && stateT > huntFor && conf < 0.2) api.setState('AFTERMATH');
          break;
        case 'COMBAT':
          // losing sight of you is not the end of it: the zone drops into HUNT and keeps looking
          if (engaged === 0 && t - lastShot > combatFor && t - lastCombat > combatFor) api.setState(conf > 0.2 ? 'HUNT' : 'AFTERMATH');
          break;
        case 'AFTERMATH':
          if (engaged > 0) api.setState('HUNT');
          else if (stateT > 20) api.setState('CALM');
          break;
      }
      if (ctx.player.inBase && state !== 'CALM' && state !== 'AFTERMATH') api.setState('AFTERMATH');
      const target = { CALM: 0.05 + night * 0.12, UNEASE: 0.35 + unease * 0.2, HUNT: 0.62, COMBAT: 1.0, AFTERMATH: 0.3 }[state] + threatNear * 0.15;
      tension = damp(tension, clamp01(target), state === 'COMBAT' ? 4 : 0.6, dt);
    },
  };
  // A new game is a new zone: it has never heard of you. A Tide is not — that is the whole point of the memory.
  ctx.events.on('gameStart', () => api.forgetAll());
  return api;
}
