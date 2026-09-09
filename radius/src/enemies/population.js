// Population — the census. Decides who lives where by POI kind, Tide level and clearance, keeps the crowd out
// of the player's sight while it appears, caps what is alive, lets the dead stay dead until the Tide, and at
// night in UNEASE sends the odd wanderer up behind you.
//
// The census is a plan, not a spawn burst: every POI gets its full table as plan entries; an entry becomes an
// entity only while the player is within range of it and the ground it stands on cannot be seen, and a far,
// unaware entity is retired back into the plan so the alive count stays bounded and spawns always happen
// off-screen. Squads are formed as their members appear and keep their identity — and their patrol route —
// across retire and return.
//
// v4 — the zone remembers. director.js keeps a coarse grid of what it has actually registered about you (a
// shot heard, a body found, a sighting called in) and a per-POI record of how many contacts it has filed there
// and the bearing you walked in on. This file reads both when it re-plans after a Tide:
//   * a place with contacts filed against it gets a bigger garrison and patrols for certain;
//   * its patrol ring is rotated so the route runs through the ground you were last seen or heard on;
//   * from the second contact a group is PLANTED — silent, in cover, no radio — on the bearing you came in on;
//   * things that are not people are bedded down on the opposite side, so breaking contact and running is not
//     automatically a safe direction.
// And while a fight is running, `director.escalation` (0..3) decides what the zone is willing to send after
// you: two more men, or one of the things that are not men, arriving behind you and out of sight.
//
// Two things scale with the game: how many there are, and how good they are. `threat` folds the Tide level,
// the Explorer's clearance and the number of Tides survived into 0..1; `depth` is how far a place is from
// Vanno. Both add squads, add men to a squad, and push the class roll a tier up, so the checkpoint on day one
// is two recruits with Makarovs and the northern ridge at Tide 3 is three squads of veterans who patrol it.
// Nothing here is saved; a load simply re-rolls the zone.
import * as THREE from 'three';
import { createSquads } from './squad.js';
import * as ambush from './ambush.js';
import { pickClass } from './loadout.js';
import { POI_TIER } from '../data/index.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const MIN_HIDDEN = 30, MIN_OPEN = 55, ACTIVATE_R = 175, RETIRE_R = 260;
const AMBUSH_R = 250, AMBUSH_RETIRE = 330;   // a planted ambush is set up long before you get there, and kept
const SCAN_SPAWNS = 3, SCAN_TESTS = 14;   // per scan, so a walk into a village costs the same as standing still

// Spawn tables by POI kind. t = Tide level, T = threat 0..1. `patrol` is the chance a squad here walks a route
// rather than standing its post; `others` are [type, count, spotKind, pack?].
const TABLES = {
  checkpoint: (t, poi, rng, T) => ({ squads: [1, 2, t >= 2 ? 4 : 3], patrol: 0.55, others: [] }),
  convoy: (t, poi, rng, T) => ({ squads: [1, 2, 2 + (t >= 3 ? 1 : 0)], patrol: 0.5, others: [['slider', 1, 'hidden']] }),
  village: (t, poi, rng, T) => ({ squads: [t >= 2 ? 2 : 1, 2, 4], patrol: 0.7, others: [['slider', 2, 'hidden'], ['spawn', 3 + (t >= 2 ? 1 : 0), 'interior', true]] }),
  industrial: (t, poi, rng, T) => ({ squads: [t >= 3 ? 2 : 1, 3, 4], patrol: 0.6, others: [['fragment', 3, 'field'], ...(t >= 2 ? [['seeker', 1, 'exterior']] : [])] }),
  church: (t, poi, rng, T) => ({ squads: [1, 2, t >= 2 ? 4 : 3], patrol: 0.45, others: [['slider', 2, 'hidden'], ...(t >= 2 ? [['seeker', 1, 'exterior'], ['phantom', t >= 3 ? 2 : 1, 'exterior']] : [])] }),
  rail: (t, poi, rng, T) => ({ squads: t >= 2 || T > 0.35 ? [1, 2, 3] : [0, 0, 0], patrol: 0.8, others: [['spawn', 4 + (t >= 2 ? 1 : 0), 'interior', true], ['slider', 2, 'hidden']] }),
  forest: (t, poi, rng, T) => ({ squads: T > 0.5 ? [1, 2, 3] : [0, 0, 0], patrol: 0.9, others: [['slider', 3, 'hidden'], ...(t >= 2 ? [['phantom', t >= 3 ? 2 : 1, 'hidden']] : [])] }),
  anomaly: (t, poi, rng, T) => ({ squads: [0, 0, 0], patrol: 0, others: [['fragment', poi.anomaly === 'gas' ? 3 : rng.int(2, 4), 'field']] }),
  ridge: (t, poi, rng, T) => ({ squads: t >= 2 || T > 0.3 ? [1, 2, 4] : [0, 0, 0], patrol: 0.5, others: t >= 2 ? [['phantom', t >= 3 ? 2 : 1, 'exterior']] : [] }),
  marsh: (t, poi, rng, T) => ({ squads: t >= 3 || T > 0.6 ? [1, 2, 2] : [0, 0, 0], patrol: 0.85, others: [] }),
};

export function createPopulation(ctx) {
  const rng = ctx.rng.fork(53);
  let plan = [], pending = false, seeded = false, wanderer = null, wanderT = 180 + Math.random() * 180, scanT = 0, cursor = 0;
  let stalker = null, stalkerDay = -1, stalkerT = 0, nextSquadId = 1, patrols = 0, ambushes = 0;
  let reactT = 30, reactions = 0, mixT = 2, drawn = 0;
  const squadRefs = new Map();    // squadId -> squad (alive entity group)
  const squadPlans = new Map();   // squadId -> { poi, route, loop, startAt } (survives retire/return)
  if (!ctx.squads) ctx.squads = createSquads(ctx);

  const alive = () => { let n = 0; for (const e of ctx.enemies.list) if (e.alive) n++; return n; };
  const nearAlive = () => { let n = 0; const p = ctx.player.position; for (const e of ctx.enemies.list) if (e.alive && e.position.distanceTo(p) < 60) n++; return n; };
  const groundY = (x, z) => ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2.5).y;

  // ---- the zone's standing ----
  // Tide level, clearance and how many Tides have been survived, folded into one 0..1 dial. Everything that
  // should get worse as the game goes on reads this.
  function threat() {
    const d = ctx.state.data || {};
    const tide = Math.min(3, Math.max(1, (d.tideLevel | 0) || 1));
    const sec = Math.min(5, Math.max(1, (d.securityLevel | 0) || 1));
    const tides = (d.stats && d.stats.tides) | 0;
    const v = ((tide - 1) / 2) * 0.45 + ((sec - 1) / 4) * 0.4 + Math.min(1, tides / 10) * 0.15;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  // how far into the zone a place is, 0 at the gate and 1 at the far edge, with the POI's own danger tier in it
  function depth(poi) {
    const B = ctx.world.map.BASE;
    const d = Math.hypot(poi.x - B.x, poi.z - B.z) / 560;
    const tier = (POI_TIER[poi.kind] ?? 1) / 4;
    return Math.min(1, d * 0.65 + tier * 0.5);
  }
  const capAlive = () => 26 + Math.round(threat() * 10);
  const capNear = () => 8 + Math.round(threat() * 4);   // what is on screen at once, and so what the frame costs

  // would a thing standing here be inside the player's view? (chest and head both have to be hidden, so a figure
  // half behind a trunk does not pop in)
  function visibleFromPlayer(x, y, z, halfAngleDeg = 62) {
    const cam = ctx.camera; cam.getWorldDirection(_v3);
    _v.set(x, y + 0.9, z).sub(ctx.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    if (_v3.dot(_v) < Math.cos((halfAngleDeg * Math.PI) / 180)) return false;
    return ctx.world.lineOfSight(ctx.player.eye, _v2.set(x, y + 0.9, z)) || ctx.world.lineOfSight(ctx.player.eye, _v2.set(x, y + 1.7, z));
  }
  function inCone(x, y, z, halfAngleDeg) {
    ctx.camera.getWorldDirection(_v3);
    _v.set(x, y + 0.9, z).sub(ctx.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    return _v3.dot(_v) >= Math.cos((halfAngleDeg * Math.PI) / 180);
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
  // Nothing arrives where you could watch it arrive. A spot behind something needs 30 m; a spot with a clean
  // line to your eyes needs 55 m *and* has to sit well outside the cone you are looking down — and it must
  // still be hidden from a stride and a half ahead, so walking past a wall never uncovers a fresh mimic.
  function clearToSpawn(x, z, minDist = MIN_HIDDEN) {
    const p = ctx.player, P = p.position;
    const d = Math.hypot(x - P.x, z - P.z);
    if (d < minDist) return false;
    const y = groundY(x, z);
    const seen = ctx.world.lineOfSight(p.eye, _v2.set(x, y + 0.9, z)) || ctx.world.lineOfSight(p.eye, _v2.set(x, y + 1.7, z));
    if (!seen) return true;
    if (d < Math.max(minDist, MIN_OPEN)) return false;
    if (inCone(x, y, z, 78)) return false;
    _v3.set(P.x + p.velocity.x * 1.2, p.eye.y, P.z + p.velocity.z * 1.2);
    if (d < MIN_OPEN * 1.4 && ctx.world.lineOfSight(_v3, _v2.set(x, y + 1.2, z))) return false;
    return true;
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

  // ---- patrol routes ----
  // A route is a handful of standing places; squad.js walks its men between them in file, stopping to look.
  // Inside a POI it is a ring around the place; on a road it is a stretch walked up and back, which is what
  // makes the zone feel like somewhere people go rather than somewhere people stand.
  function poiRoute(poi, n) {
    // The structures agent's exterior spawn spots are places somebody can actually stand, so a route built
    // out of them is a route that can be walked; the ring around the middle is the fallback.
    //
    // Where the ring STARTS is not random once the zone has something on you: a place it has heard shooting at
    // pulls the route round so the patrol walks past it. That is the whole of "they patrol where you operate" —
    // no tracking, no scent, just a route drawn through the cells that have contacts filed against them.
    const spots = ctx.world.spawnSpots.filter((s) => s.poi === poi.id && s.kind === 'exterior');
    const pts = [];
    let a0 = rng() * Math.PI * 2;
    const hot = ctx.director && ctx.director.hotspots ? ctx.director.hotspots(6) : [];
    let bh = 0;
    for (const h of hot) {
      const d = Math.hypot(h.x - poi.x, h.z - poi.z);
      if (d > poi.r * 1.6 || d < 4 || h.heat < bh) continue;
      bh = h.heat; a0 = Math.atan2(h.z - poi.z, h.x - poi.x);
    }
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.35, 0.35);
      const cx = poi.x + Math.cos(a) * poi.r * 0.65, cz = poi.z + Math.sin(a) * poi.r * 0.65;
      let got = null, bd = poi.r * 0.55;
      for (const sp of spots) {
        const q = sp.position, d = Math.hypot(q.x - cx, q.z - cz);
        if (d > bd || pts.some((e) => Math.hypot(e.x - q.x, e.z - q.z) < 12)) continue;
        if (!standable(q.x, q.z)) continue;
        bd = d; got = q;
      }
      if (got) { pts.push(new THREE.Vector3(got.x, groundY(got.x, got.z), got.z)); continue; }
      for (let k = 0; k < 4; k++) {
        const r = poi.r * (0.8 - k * 0.15) * rng.range(0.55, 1);
        const x = poi.x + Math.cos(a) * r, z = poi.z + Math.sin(a) * r;
        if (standable(x, z)) { pts.push(new THREE.Vector3(x, groundY(x, z), z)); break; }
      }
    }
    return pts.length >= 3 ? { route: pts, loop: true } : null;
  }
  function roadRoute() {
    const M = ctx.world.map, roads = M.ROADS;
    if (!roads || !roads.length || !M.pointOnPolyline) return null;
    const road = roads[Math.floor(rng() * roads.length)];
    let total = 0;
    for (let i = 0; i < road.pts.length - 1; i++) total += Math.hypot(road.pts[i + 1][0] - road.pts[i][0], road.pts[i + 1][1] - road.pts[i][1]);
    if (total < 120) return null;
    const span = Math.min(0.6, Math.max(0.2, 240 / total));
    const t0 = rng.range(0, 1 - span);
    const n = 4 + rng.int(0, 2);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const q = M.pointOnPolyline(road.pts, t0 + (span * i) / (n - 1));
      const off = rng.range(-4, 4);
      const x = q.x - q.dz * off, z = q.z + q.dx * off;
      if (standable(x, z)) pts.push(new THREE.Vector3(x, groundY(x, z), z));
      else if (standable(q.x, q.z)) pts.push(new THREE.Vector3(q.x, groundY(q.x, q.z), q.z));
    }
    return pts.length >= 3 ? { route: pts, loop: false } : null;
  }

  // ---- planning ----
  function rollClass(poi, tide, T, lead) {
    const bump = (lead ? 1 : 0) + (rng.chance(T * 0.5) ? 1 : 0);
    return pickClass(poi.kind, tide + bump);
  }
  // one squad: its men, its class mix, and where it stands or walks
  function planSquad(poi, tide, T, size, used, route, opts = {}) {
    const squadId = nextSquadId++;
    const anchor0 = opts.at || (route ? route.route[route.startAt | 0] : null);
    let anchor = null, placed = 0;
    for (let i = 0; i < size; i++) {
      let pos = null;
      if (anchor0) {
        for (let k = 0; k < 6 && !pos; k++) {
          const a = rng() * Math.PI * 2, r = 2 + rng() * 7;
          const x = anchor0.x + Math.cos(a) * r, z = anchor0.z + Math.sin(a) * r;
          if (standable(x, z)) pos = new THREE.Vector3(x, groundY(x, z), z);
        }
      }
      if (!pos) pos = (anchor && findSpot(poi, 'exterior', used, { near: anchor, nearR: 10 })) || findSpot(poi, 'exterior', used);
      if (!pos) continue;
      if (!anchor) anchor = pos;
      // an ambush that never gets instantiated because the census filled up with garrison is not an ambush:
      // `pri` puts these entries at the front of the queue in scan()
      plan.push({ type: 'mimic', pos, poi, squadId, pri: opts.ambush ? 1 : 0, extra: { cls: (opts.classes && opts.classes[i]) || rollClass(poi, tide, T, i === 0) } });
      placed++;
    }
    if (!placed) { nextSquadId--; return null; }
    squadPlans.set(squadId, route ? { poi, route: route.route, loop: route.loop, startAt: route.startAt | 0, ambush: !!opts.ambush } : { poi, route: null, ambush: !!opts.ambush });
    if (route) patrols++;
    return squadId;
  }
  function planPoi(poi) {
    const tide = ctx.state.data.tideLevel || 1;
    const table = TABLES[poi.kind]; if (!table) return;
    const used = new Set();
    const T = threat(), D = depth(poi);
    const spec = table(tide, poi, rng, T);
    const { squads, others } = spec;
    // more of them deeper in and later on; a big place can hold three groups, a small one two
    let nSquads = squads[0];
    if (nSquads > 0) {
      const extra = T * 0.9 + D * 0.8;
      nSquads += Math.floor(extra) + (rng.chance(extra % 1) ? 1 : 0);
      nSquads = Math.min(nSquads, poi.r >= 55 ? 3 : 2);
    }
    // ---- what the zone has on this place ----
    // Contacts filed here (somebody saw or heard you inside the POI on an earlier visit) buy the garrison one
    // more man per squad, a certainty of patrols, and — from the second contact — a group planted silent on the
    // bearing you walked in on last time. Come the same way twice and you walk into it.
    const rec = ctx.director && ctx.director.poiRecord ? ctx.director.poiRecord(poi.id) : null;
    const known = rec ? Math.min(3, rec.contacts) : 0;
    const bump = Math.round(T * 1.6 + D * 0.7) + (known >= 1 ? 1 : 0);
    const patrolP = known >= 1 ? Math.max(spec.patrol ?? 0, 0.85) : (spec.patrol ?? 0);
    for (let s = 0; s < nSquads; s++) {
      const size = Math.min(5, rng.int(squads[1], Math.min(5, squads[2] + bump)));
      // the first group at a place holds it; anything beyond the first walks, so a place with two groups
      // always has one of them moving and never reads as a row of statues
      let route = null;
      if (patrolP > 0 && (s > 0 || rng.chance(patrolP * (0.55 + T * 0.5)))) {
        const r = poiRoute(poi, 3 + rng.int(0, 2));
        if (r) route = { route: r.route, loop: r.loop, startAt: rng.int(0, r.route.length - 1) };
      }
      planSquad(poi, tide, T, size, used, route);
    }
    // the ambush on your approach: quiet, in cover, on the bearing the zone last watched you arrive on
    if (known >= 2 && nSquads > 0) {
      const a = rec.ang + rng.range(-0.35, 0.35);
      const r = poi.r * rng.range(0.85, 1.1);
      let at = null;
      for (let k = 0; k < 10 && !at; k++) {
        const aa = a + rng.range(-0.5, 0.5), rr = r * rng.range(0.85, 1.15);
        const x = poi.x + Math.cos(aa) * rr, z = poi.z + Math.sin(aa) * rr;
        if (standable(x, z)) at = new THREE.Vector3(x, groundY(x, z), z);
      }
      if (at) {
        const size = 2 + (known >= 3 || T > 0.5 ? 1 : 0);
        // one of them is there to watch the ground, not to trade rounds
        const classes = known >= 3 ? ['sniper'] : null;
        if (planSquad(poi, tide, T, size, used, null, { at, ambush: true, classes })) ambushes++;
      }
    }
    // ---- ONE HIDER ----
    // Not a squad and not an ambush: one man who has decided to be a piece of the landscape. He walks to a
    // place that is verified invisible from thirty metres up the lane you come in on and verified lethal at
    // six, gets down, stops making any sound at all — the static bed is stopped outright, the handset is dead
    // — and waits. Whether he is allowed at all is director.escalation's decision (none at 0, one per POI
    // ever, three in the whole zone at 3); it is checked again at spawn time, because escalation moves.
    if (known >= 1 && nSquads > 0) {
      const a = (rec ? rec.ang : rng() * Math.PI * 2) + rng.range(-0.6, 0.6);
      for (let k = 0; k < 8; k++) {
        const aa = a + rng.range(-0.7, 0.7), rr = poi.r * rng.range(0.35, 0.9);
        const x = poi.x + Math.cos(aa) * rr, z = poi.z + Math.sin(aa) * rr;
        if (!standable(x, z)) continue;
        plan.push({ type: 'mimic', pos: new THREE.Vector3(x, groundY(x, z), z), poi, pri: 1,
          extra: { cls: rollClass(poi, tide, T, known >= 2), hider: true, toward: { x: poi.x + Math.cos(rec ? rec.ang : aa) * (poi.r + 25), z: poi.z + Math.sin(rec ? rec.ang : aa) * (poi.r + 25) } } });
        break;
      }
    }
    // ---- the other side of the place ----
    // Things that are not people, bedded down where you would go if you broke contact and ran: away from the
    // approach the zone knows you use. Losing a firefight should not be a safe direction.
    if (known >= 1 && nSquads > 0 && ctx.enemies.types.has('slider')) {
      const away = (rec ? rec.ang : rng() * Math.PI * 2) + Math.PI;
      for (let i = 0; i < (known >= 2 ? 2 : 1); i++) {
        const aa = away + rng.range(-0.7, 0.7), rr = poi.r * rng.range(0.8, 1.15);
        const x = poi.x + Math.cos(aa) * rr, z = poi.z + Math.sin(aa) * rr;
        if (!standable(x, z)) continue;
        plan.push({ type: 'slider', pos: new THREE.Vector3(x, groundY(x, z), z), poi });
      }
    }
    for (const [type, count, kind, pack] of others) {
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
      for (let i = 0; i < count; i++) {
        const pos = findSpot(poi, kind, used) || (kind === 'hidden' ? findSpot(poi, 'exterior', used) : null);
        if (!pos) continue;
        plan.push({ type, pos, poi });
      }
    }
  }
  // roving patrols: groups that belong to the roads rather than to a place. They are what makes the walk
  // between two POIs dangerous, and there are more of them the further the game has gone.
  function planRoads() {
    const tide = ctx.state.data.tideLevel || 1, T = threat();
    let n = Math.round(T * 2.4) + (tide >= 2 ? 1 : 0);
    if (n <= 0) return;
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const r = roadRoute(); if (!r) continue;
      const mid = r.route[r.route.length >> 1];
      const near = ctx.world.nearestPoi(mid.x, mid.z);   // returns { poi, distance }
      const poi = (near && near.poi) || ctx.world.pois[1] || ctx.world.pois[0];
      const size = Math.min(4, 2 + (rng.chance(T) ? 1 : 0));
      planSquad(poi, tide, T, size, used, { route: r.route, loop: r.loop, startAt: rng.int(0, r.route.length - 1) });
    }
  }

  function spawnEntry(en) {
    const poi = en.poi;
    const yaw = poi ? Math.atan2(-(poi.x - en.pos.x), -(poi.z - en.pos.z)) + rng.range(-0.8, 0.8) : rng() * Math.PI * 2;
    const e = ctx.enemies.spawn(en.type, en.pos, Object.assign({ poi: poi?.id, yaw }, en.pack ? { pack: en.pack } : {}, en.extra || {}));
    if (!e) return null;
    e.census = en;
    if (en.squadId != null && e.type === 'mimic') {
      let s = squadRefs.get(en.squadId);
      if (!s || (s.alive === 0 && !ctx.squads.list.includes(s))) {
        s = ctx.squads.form([e], poi);
        squadRefs.set(en.squadId, s);
        const sp = squadPlans.get(en.squadId);
        if (sp && sp.route) s.setRoute(sp.route, { loop: sp.loop, startAt: sp.startAt });
        if (sp && sp.ambush) s.plant();
      } else { s.add(e); if (s.planted) s.plant(); }
    }
    // the lone hider: allowed only at escalation >= 1, one per POI, three in the zone
    if (en.extra && en.extra.hider && e.type === 'mimic') {
      if (ambush.mayHide(ctx, poi ? poi.id : null)) {
        const to = en.extra.toward;
        ambush.beginHide(e, ctx, to ? to.x : (poi ? poi.x : e.position.x), to ? to.z : (poi ? poi.z : e.position.z));
      }
    }
    return e;
  }
  // instantiate plan entries in range and out of view; retire far, unaware entities back into the plan
  function scan() {
    const p = ctx.player.position;
    let n = alive(), near = nearAlive();
    const maxAlive = capAlive(), maxNear = capNear();
    let spawned = 0, tests = 0, any = false;
    const L = plan.length;
    // Priority pass: planted ambushes first, whatever the cursor is doing, and from much further out. An
    // ambush is placed exactly where the player is going to walk, so if it waits for the normal 175 m it can
    // never appear: by the time the entry is eligible he is already inside MIN_HIDDEN of it.
    for (let k = 0; k < L && spawned < 2 && n < maxAlive; k++) {
      const en = plan[k];
      if (!en.pri || en.spawned || !ctx.enemies.types.has(en.type)) continue;
      const d = Math.hypot(en.pos.x - p.x, en.pos.z - p.z);
      if (d > AMBUSH_R || d < MIN_HIDDEN || en.blockT > ctx.elapsed) continue;
      if (!clearToSpawn(en.pos.x, en.pos.z)) { en.blockT = ctx.elapsed + 2; continue; }
      const e = spawnEntry(en);
      if (!e) continue;
      en.spawned = true; any = true; spawned++; n++; if (d < 60) near++;
    }
    for (let k = 0; k < L && spawned < SCAN_SPAWNS && tests < SCAN_TESTS && n < maxAlive; k++) {
      const en = plan[(cursor + k) % L];
      if (en.spawned || !ctx.enemies.types.has(en.type)) continue;
      const d = Math.hypot(en.pos.x - p.x, en.pos.z - p.z);
      if (d > ACTIVATE_R || d < MIN_HIDDEN) continue;
      if (d < 60 && near >= maxNear) continue;
      if (en.blockT > ctx.elapsed) continue;   // a spot the player is staring at does not get re-tested every scan
      tests++;
      if (!clearToSpawn(en.pos.x, en.pos.z)) { en.blockT = ctx.elapsed + 2; continue; }
      const e = spawnEntry(en);
      if (!e) continue;
      en.spawned = true; any = true; spawned++; n++; if (d < 60) near++;
    }
    cursor = L ? (cursor + Math.max(1, Math.min(L, SCAN_TESTS))) % L : 0;
    if (any) plan = plan.filter((en) => !en.spawned);
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.removeMe || !e.census || e.aware > 0.3) continue;
      // a squad planted on your approach is "in combat" for the whole time it is waiting; it still has to be
      // allowed back into the plan when you are 260 m away, or the census fills up with men sitting in bushes
      if (e.squad && (e.squad.inCombat || e.squad.state === 'alert') && !e.squad.planted) continue;
      if (e.position.distanceTo(p) < (e.squad && e.squad.planted ? AMBUSH_RETIRE : RETIRE_R)) continue;
      retire(e);
    }
  }
  function retire(e) {
    e.census.pos.copy(e.position); e.census.pos.y = groundY(e.position.x, e.position.z);
    e.census.spawned = false; e.census.blockT = 0;   // it is a plan entry again, and must be eligible to return
    plan.push(e.census); e.census = null; if (e.squad) e.squad.remove(e); e.removeMe = true;   // the manager disposes it at the end of its update
  }
  // a figure behind you: 45-70 m back, out of view
  function spawnBehind(type, opts, minD = 45, maxD = 70) {
    const p = ctx.player;
    if (!ctx.enemies.types.has(type) || alive() >= capAlive()) return null;
    for (let i = 0; i < 12; i++) {
      const dist = minD + rng() * (maxD - minD), side = (rng() - 0.5) * 30;
      const x = p.position.x - p.forward.x * dist + p.forward.z * side, z = p.position.z - p.forward.z * dist - p.forward.x * side;
      if (!standable(x, z) || !clearToSpawn(x, z, 40)) continue;
      return ctx.enemies.spawn(type, _v.set(x, groundY(x, z), z), Object.assign({ yaw: p.yaw }, opts));
    }
    return null;
  }
  function spawnWanderer() {
    const type = rng.chance(0.6) ? 'mimic' : 'slider';
    const tide = ctx.state.data.tideLevel || 1, T = threat();
    const e = spawnBehind(type, type === 'mimic' ? { wanderer: true, cls: pickClass('marsh', tide + (rng.chance(T) ? 1 : 0)) } : { wanderer: true });
    if (e) { if (e.type === 'mimic') { e.aware = 0.5; e.lastSeenPlayer = ctx.player.position.clone(); e.lastSeenT = ctx.elapsed; } wanderer = e; }
  }
  // the day's stalker: one veteran (regular before tide 2) that shadows the player; only one alive at a time
  function assignStalker() {
    const day = ctx.state.data.day || 1;
    if (stalkerDay === day || (stalker && stalker.alive)) return;
    const tide = ctx.state.data.tideLevel || 1, T = threat();
    const cls = T > 0.65 ? 'elite' : tide >= 2 || T > 0.3 ? 'veteran' : 'regular';
    const e = spawnBehind('mimic', { stalker: true, cls }, 70, 95);
    if (e) { stalker = e; stalkerDay = day; }
  }

  const api = {
    get count() { return alive(); },
    get planned() { return plan.length; },
    get threat() { return threat(); },
    get patrols() { return patrols; },
    get stalker() { return stalker && stalker.alive ? stalker : null; },
    counts() { const c = {}; for (const e of ctx.enemies.list) if (e.alive) c[e.type] = (c[e.type] || 0) + 1; return c; },
    // the full census: alive entities plus planned ones, by POI and type
    census() { const c = {}; const add = (poi, type) => { const k = poi || 'wild'; c[k] = c[k] || {}; c[k][type] = (c[k][type] || 0) + 1; }; for (const e of ctx.enemies.list) if (e.alive) add(e.poi, e.type); for (const en of plan) add(en.poi?.id, en.type); return c; },
    squads() {
      return ctx.squads.list.map((s) => ({
        id: s.id, poi: s.poi?.id, state: s.state, alive: s.alive, of: s.initial,
        leader: s.leader ? s.leader.cls : null, morale: Math.round(s.morale * 100) / 100, skill: Math.round(s.skill * 100) / 100,
        bounding: s.bounding, route: s.route ? s.route.length : 0, calls: s.pending.length,
        org: Math.round((s.org ?? 1) * 100) / 100, kind: s.contactKind, planted: !!s.planted,
        bounds: s.bounds | 0, refused: s.boundsRefused | 0, frags: s.fragOrders | 0, fixing: s.fixing | 0,
        spread: Math.round(s.spread ? s.spread() : 0),
        jobs: s.members.filter((m) => m.alive).map((m) => (m.orders ? m.orders.job : 'idle')),
        classes: s.members.map((m) => m.cls),
      }));
    },
    get ambushes() { return ambushes; },
    get ambushPlanned() { let n = 0; for (const e of plan) if (e.pri && !e.spawned) n++; return n; },
    get reactions() { return reactions; },
    get drawn() { return drawn; },
    reset() { ctx.enemies.removeAll(); ctx.squads.reset(); squadRefs.clear(); squadPlans.clear(); plan = []; cursor = 0; patrols = 0; ambushes = 0; wanderer = null; stalker = null; pending = false; seeded = false; },
    // after a debug teleport: census entities that are now in the player's lap or in view go back into the plan
    // and return the normal way, out of sight, once the player has moved off
    settle() {
      const p = ctx.player.position; let n = 0;
      for (const e of ctx.enemies.list) {
        if (!e.alive || e.removeMe || !e.census) continue;
        if (e.position.distanceTo(p) >= MIN_HIDDEN && !visibleFromPlayer(e.position.x, e.position.y, e.position.z)) continue;
        retire(e); n++;
      }
      ctx.enemies.removeDead();
      return n;
    },
    populate() {
      pending = false; seeded = true; plan = []; squadRefs.clear(); squadPlans.clear(); nextSquadId = 1; cursor = 0; patrols = 0; ambushes = 0;
      if (ctx.debug.noEnemies) return 0;
      for (const poi of ctx.world.pois) planPoi(poi);
      planRoads();
      scan();
      return plan.length + alive();
    },
    update(dt) {
      ctx.squads.update(dt);
      if (pending) { api.populate(); return; }
      if (!seeded || ctx.debug.noEnemies || ctx.mode !== 'playing') return;
      scanT -= dt; if (scanT <= 0) { scanT = 0.8; scan(); }
      if (wanderer && (!wanderer.alive || wanderer.removeMe)) wanderer = null;
      if (stalker && (!stalker.alive || stalker.removeMe)) stalker = null;
      // wanderers: night, UNEASE, nobody else on your heels; sooner as the zone gets worse
      wanderT -= dt;
      if (wanderT <= 0) {
        const T = threat();
        wanderT = (180 + rng() * 180) * (1 - T * 0.45);
        if (!wanderer && (ctx.time.isNight || T > 0.6) && ctx.director.state === 'UNEASE' && !ctx.player.inBase && !ctx.player.dead) spawnWanderer();
      }
      // ---- a firefight is a dinner bell ----
      // Spawns and seekers already listen for gunfire on their own (they ask director.recentShotAt). Sliders
      // and phantoms do not, and they are the two that make a firefight somewhere you cannot stay. This walks
      // them toward the NOISE — the position of the shot, jittered, never the player's feet — and only when
      // the shot was actually loud enough to reach them. Shooting draws the grass as well as the men in it.
      mixT -= dt;
      if (mixT <= 0) {
        mixT = 1.5;
        const D = ctx.director.state;
        if ((D === 'COMBAT' || D === 'HUNT') && !ctx.player.inBase && !ctx.player.dead) {
          for (const e of ctx.enemies.list) {
            if (!e.alive || e.aware > 0.55) continue;
            if (e.type !== 'slider' && e.type !== 'phantom') continue;
            const s = ctx.director.nearestShot(e.position, 95, _v3);
            if (s < 0.08) continue;
            const j = 5 + (1 - s) * 12;
            if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3();
            e.lastSeenPlayer.set(_v3.x + rng.range(-j, j), _v3.y, _v3.z + rng.range(-j, j));
            e.lastSeenT = ctx.elapsed;
            e.aware = Math.min(0.55, e.aware + 0.18 + s * 0.3);
            drawn++;
          }
        }
      }
      // ---- the zone's answer ----
      // Escalation is what the Director says it is willing to spend on you (director.js: Tide sets the ceiling,
      // your noise and the bodies you leave decide how much of it you actually meet). A fight that has been
      // running long enough gets a reaction: two more men at 2, and at 3 one of the things that are not men.
      // They arrive behind you and out of sight, like everything else here.
      reactT -= dt;
      if (reactT <= 0) {
        reactT = 20;
        const esc = ctx.director.escalation | 0;
        const D = ctx.director.state;
        if (esc >= 2 && (D === 'COMBAT' || D === 'HUNT') && !ctx.player.inBase && !ctx.player.dead && alive() < capAlive() - 2) {
          reactT = 150 - esc * 25;
          const tide = ctx.state.data.tideLevel || 1, T = threat();
          const night = ctx.time.isNight;
          let sent = null;
          if (esc >= 3 && tide >= 2 && ctx.enemies.types.has('seeker') && rng.chance(0.5)) sent = spawnBehind('seeker', {}, 80, 110);
          else if (esc >= 3 && night && ctx.enemies.types.has('phantom')) sent = spawnBehind('phantom', {}, 55, 85);
          else {
            for (let i = 0; i < 2; i++) {
              const e = spawnBehind('mimic', { cls: pickClass('checkpoint', tide + (rng.chance(T) ? 1 : 0)) }, 75, 105);
              if (e) { e.aware = 0.4; sent = e; }
            }
          }
          if (sent) reactions++;
        }
      }
      // the stalker: assigned once per day, a few minutes after you are out in the zone
      stalkerT -= dt;
      if (stalkerT <= 0) { stalkerT = 20 + rng() * 20; if (!ctx.player.inBase && !ctx.player.dead && ctx.director.state !== 'COMBAT' && ctx.player.position.distanceTo(_v2.set(ctx.world.map.BASE.x, ctx.player.position.y, ctx.world.map.BASE.z)) > 80) assignStalker(); }
    },
  };
  // the census is taken one frame after the reset so the player has been placed first
  ctx.events.on('gameStart', () => { api.reset(); pending = true; wanderT = 120 + rng() * 120; stalkerDay = -1; stalkerT = 90 + rng() * 60; });
  ctx.events.on('tide', () => { api.reset(); pending = true; });
  ctx.events.on('newday', () => { stalkerT = 120 + rng() * 120; });
  return api;
}
