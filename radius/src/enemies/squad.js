// Squads. A mimic alone is a sentry; a squad is a plan. createSquads(ctx) is built lazily by population.js and
// exposed as ctx.squads.
//
// What a squad is, in one paragraph. It has a leader (the best class in it) whose death disorganises the rest
// for a while and costs morale. It has jobs — point, support, flanker, overwatch — reassigned on a clock that
// ticks faster the deeper the zone has gone. It moves by bounds: one element walks while the other holds cover
// and fires, alternating, so a squad crossing open ground never all moves at once. It does not know where you
// are: a man who sees you *calls it in*, the call takes a radio press and travels member by member with a
// delay, and the squad manoeuvres against the position it was given — not against you. It converges on a
// called position by sectors, so four men sweep four patches rather than queueing at one point. Losing half
// of itself makes it fall back and set an ambush; losing its nerve makes it break contact and leave.
//
// Everything expensive (cover scoring, frustum tests, line of sight) runs here, once per squad per role tick,
// never per member per frame; cover points are bucketed into a coarse grid so a query touches a neighbourhood
// instead of the whole zone. Squads also own the grenade projectiles, so a thrown grenade outlives the thrower.
import * as THREE from 'three';
import { clamp, clamp01, lerp, angleDelta, DEG } from '../core/math.js';
import { classRank } from './loadout.js';
import { def } from '../data/index.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _eye = new THREE.Vector3(), _n = new THREE.Vector3(), _cam = new THREE.Vector3(0, 0, -1);
const REINFORCE_AFTER = 30, REINFORCE_R = 160, GRENADE_CD = 40, CONVERGE_R = 120;
const AMBUSH_MAX = 110, BREAK_MORALE = 0.3, SPRING_R = 18, CELL = 20;
// the mimic only understands these order roles; `job` below is the squad's own vocabulary
const JOB_ROLE = { point: 'base', support: 'base', flanker: 'flank', overwatch: 'watch', bound: 'flank', shaken: 'flank', ambush: 'ambush', regroup: 'regroup', breakoff: 'regroup', idle: 'idle' };
const cand = [], candS = [];   // scratch: top-N cover candidates, reused

// play the first registered name from a list (v2 sounds land in parallel; older names stay as fallbacks)
export function playAny(ctx, names, opts) {
  const a = ctx.audio; if (!a) return null;
  for (const n of names) { if (!a.has || a.has(n)) return a.play(n, opts); }
  return null;
}

export function createSquads(ctx) {
  const list = [], grenades = [], sightings = [];
  const rng = ctx.rng.fork(59);
  let nextId = 1;
  const hold = { anchor: new THREE.Vector3(), t: 0, init: false };
  let grenadeGeo = null, grenadeMat = null;
  let zoneSk = 0, zoneSkT = 0, jobBudget = 0;

  // ---- how good the zone's soldiers are right now: Tide level, clearance, and how many Tides have passed ----
  function zoneSkill() {
    const d = ctx.state.data || {};
    const tide = clamp((d.tideLevel | 0) || 1, 1, 3);
    const sec = clamp((d.securityLevel | 0) || 1, 1, 5);
    const tides = (d.stats && d.stats.tides) | 0;
    return clamp01(((tide - 1) / 2) * 0.45 + ((sec - 1) / 4) * 0.4 + Math.min(1, tides / 10) * 0.15);
  }

  // ---- view tests (player camera frustum + line of sight), shared by every consumer ----
  // getWorldDirection walks and updates the camera's whole parent chain, so it is read once a frame and
  // every frustum test in every squad reads the cached vector.
  function refreshCam() { ctx.camera.getWorldDirection(_cam); }
  function inFrustum(x, y, z, halfAngleDeg = 55) {
    _v.set(x, y, z).sub(ctx.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    return _cam.dot(_v) >= Math.cos(halfAngleDeg * DEG);
  }
  function visibleFromPlayer(x, y, z, halfAngleDeg = 55) {
    if (!inFrustum(x, y + 0.9, z, halfAngleDeg)) return false;
    return ctx.world.lineOfSight(ctx.player.eye, _v2.set(x, y + 0.9, z)) || ctx.world.lineOfSight(ctx.player.eye, _v2.set(x, y + 1.6, z));
  }
  function walkable(x, z, out) {
    const w = ctx.world;
    if (Math.abs(x) > w.half - 6 || Math.abs(z) > w.half - 6) return null;
    if (w.isWater(x, z)) return null;
    const y = w.groundHeight(x, z, w.getHeight(x, z) + 2).y;
    if (w.pointInSolid(x, y + 0.6, z)) return null;
    if (w.isInBase(_v3.set(x, y, z))) return null;
    return out.set(x, y, z);
  }

  // ---- cover points, bucketed ----
  // The zone holds thousands of cover points; a squad asks for the good ones within 25 m several times a
  // tick. A 20 m grid turns that from a full sweep into a handful of cells, which is the difference between
  // a squad costing nothing and a squad costing a frame on a phone.
  let grid = null, gridLen = -1, gridW = 0, gridO = 0;
  function buildGrid() {
    const cps = ctx.world.coverPoints, half = ctx.world.half;
    gridO = -half; gridW = Math.ceil((half * 2) / CELL) + 1;
    grid = new Array(gridW * gridW).fill(null);
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      const gx = Math.floor((c.x - gridO) / CELL), gz = Math.floor((c.z - gridO) / CELL);
      if (gx < 0 || gz < 0 || gx >= gridW || gz >= gridW) continue;
      const k = gz * gridW + gx;
      (grid[k] || (grid[k] = [])).push(c);
    }
    gridLen = cps.length;
  }
  // Score cover near `from`, keep the best six without sorting the field, then test line of sight on those.
  // `losTo` is what the cover has to see (or hide from) — the squad passes the position it *believes* you are
  // at, so a squad that has lost you takes up firing positions on an empty doorway. Defaults to your eyes.
  function bestCover(from, maxD, score, needLos, losFrom = 1.5, losTo = null) {
    const cps = ctx.world.coverPoints;
    if (!cps.length) return null;
    if (!grid || gridLen !== cps.length) buildGrid();
    cand.length = 0; candS.length = 0;
    const x0 = Math.max(0, Math.floor((from.x - maxD - gridO) / CELL)), x1 = Math.min(gridW - 1, Math.floor((from.x + maxD - gridO) / CELL));
    const z0 = Math.max(0, Math.floor((from.z - maxD - gridO) / CELL)), z1 = Math.min(gridW - 1, Math.floor((from.z + maxD - gridO) / CELL));
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = grid[gz * gridW + gx]; if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const c = cell[i];
          const dm = Math.hypot(c.x - from.x, c.z - from.z); if (dm > maxD) continue;
          const s = score(c, dm); if (s === null || s === -Infinity) continue;
          if (cand.length < 4) { let j = cand.length; cand.push(c); candS.push(s); while (j > 0 && candS[j - 1] < s) { cand[j] = cand[j - 1]; candS[j] = candS[j - 1]; cand[j - 1] = c; candS[j - 1] = s; j--; } }
          else if (s > candS[3]) { let j = 3; cand[3] = c; candS[3] = s; while (j > 0 && candS[j - 1] < s) { const tc = cand[j - 1], ts = candS[j - 1]; cand[j - 1] = c; candS[j - 1] = s; cand[j] = tc; candS[j] = ts; j--; } }
        }
      }
    }
    const eye = losTo || _eye.copy(ctx.player.eye);
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      if (needLos === null) return c;
      if (ctx.world.lineOfSight(_v.set(c.x, c.y + losFrom, c.z), eye) === needLos) return c;
    }
    return null;
  }

  class Squad {
    constructor(members, poi) {
      this.id = nextId++; this.poi = poi || null; this.members = [];
      this.state = 'idle';            // idle | alert | combat | regroup | ambush | breakoff
      this.lastKnown = new THREE.Vector3(); this.lastKnownT = -1e9; this.hasKnown = false;
      this.aim = new THREE.Vector3(); this.aimEye = new THREE.Vector3(); this.eyesOn = false; this.faceA = 0;
      this.combatT = 0; this.roleT = rng.range(0, 1.5); this.grenadeT = 0; this.radioT = rng.range(6, 14); this.reinforceCalled = false;
      this.retreat = new THREE.Vector3(); this.ambushT = 0; this.centroid = new THREE.Vector3();
      this.initial = 0; this.moving = 0; this.regrouped = false;
      // leadership and nerve
      this.leaderRef = null; this.shaken = 0; this.morale = 1; this.skill = zoneSk;
      // contact reports in flight
      this.pending = []; this.callT = -1e9; this.knowT = 0; this.shotT = 0;
      // bounding
      this.bounding = false; this.boundT = 0; this.movingElement = 0; this.groups = 2;
      // patrol route (population.js hands one over)
      this.route = null; this.routeI = 0; this.routeDir = 1; this.routeHold = 0; this.legT = 0; this.patrolT = rng.range(0, 0.6); this.file = [];
      this.breakT = 0; this.coolT = 0; this.sightT = 0; this.posCursor = 0;
      for (const m of members) this.add(m);
      this.initial = this.members.length;
      this.electLeader();
    }
    add(m) {
      if (!m || this.members.includes(m)) return;
      if (m.squad && m.squad !== this) m.squad.remove(m);
      m.squad = this; this.members.push(m); this.initial = Math.max(this.initial, this.members.length);
      if (!m.orders) m.orders = { role: 'idle', job: 'idle', target: new THREE.Vector3(), hasTarget: false, fire: false, hold: false, at: false, side: 0, element: 0, mv: 0, arrivedT: 0, flankAng: 0 };
      this.file.length = 0;
      if (!this.leaderRef) this.electLeader();
    }
    remove(m) { const i = this.members.indexOf(m); if (i >= 0) this.members.splice(i, 1); if (m.squad === this) m.squad = null; if (this.leaderRef === m) this.leaderRef = null; this.file.length = 0; }
    get alive() { let n = 0; for (const m of this.members) if (m.alive) n++; return n; }
    // the leader is elected once and kept; `leader` is null while the squad has none (it has just lost one)
    get leader() { const l = this.leaderRef; return l && l.alive && this.members.includes(l) ? l : null; }
    get inCombat() { return this.state === 'combat' || this.state === 'regroup' || this.state === 'ambush' || this.state === 'breakoff'; }
    electLeader() {
      let best = null, bs = -1;
      for (const m of this.members) { if (!m.alive) continue; const s = classRank(m.cls) * 10 + (m.maxHp || 0) * 0.05; if (s > bs) { bs = s; best = m; } }
      this.leaderRef = best;
      // a squad is only as sharp as the man running it
      this.skill = clamp01(zoneSk * 0.78 + (best ? classRank(best.cls) / 4 : 0.25) * 0.22);
      return best;
    }
    // walking order: the recruit takes point, the best man walks last
    fileOrder() {
      if (this.file.length && this.file.every((m) => m.alive && this.members.includes(m))) return this.file;
      this.file = this.members.filter((m) => m.alive).sort((a, b) => classRank(a.cls) - classRank(b.cls));
      return this.file;
    }

    // ---- shared knowledge ----
    know(pos, t) { if (t <= this.lastKnownT) return; this.lastKnown.copy(pos); this.lastKnownT = t; this.hasKnown = true; }
    // A sighting is called in, not broadcast. The caller keys the radio (a delay), the squad's shared picture
    // updates, and each other man hears it after a delay of his own — farther away is later, and at low
    // standing some of them miss the first call entirely and get it on the repeat.
    report(pos, kind, from) {
      const t = ctx.elapsed, sk = this.skill;
      const gate = kind === 'contact' ? 1.2 : kind === 'update' ? 2.6 : 2.0;
      if (t < this.callT + gate) return false;
      this.callT = t;
      const base = (kind === 'contact' ? 0.7 : 0.45) * lerp(1.4, 0.55, sk);
      const shared = new THREE.Vector3(pos.x, pos.y, pos.z);
      this.pending.push({ m: null, pos: shared, at: t + base, level: 1, slot: 0 });
      let i = 1;
      for (const m of this.members) {
        if (!m.alive || m === from) continue;
        const d = from ? m.position.distanceTo(from.position) : 25;
        let delay = base + 0.3 + d * lerp(0.022, 0.008, sk) + rng.range(0, 0.5);
        if (rng() > lerp(0.7, 0.97, sk)) delay += rng.range(1.5, 3.5);   // missed the first call
        this.pending.push({ m, pos: shared, at: t + delay, level: kind === 'contact' ? 0.65 : 0.5, slot: i++ });
      }
      if (from && !from.stalker) from.sound('mimic_radio', { gain: 0.8, max: 90, rate: kind === 'contact' ? 1.12 : 0.98 });
      this.radioT = Math.max(this.radioT, 1.6);
      return true;
    }
    // a delivered call puts a man onto a *sector* of the called position, not onto the position itself
    deliver(t) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const r = this.pending[i];
        if (r.at > t) continue;
        this.pending.splice(i, 1);
        if (!r.m) { this.know(r.pos, t); if (this.state === 'idle') this.enterAlert(); continue; }
        const m = r.m; if (!m.alive || m.stunned > 0) continue;
        if (m.aware < r.level) m.aware = r.level;
        if (!m.lastSeenPlayer) m.lastSeenPlayer = new THREE.Vector3();
        const a = r.slot * 2.3999632 + this.id * 0.7, rad = 3.5 + (r.slot % 3) * 3.5;
        if (!walkable(r.pos.x + Math.cos(a) * rad, r.pos.z + Math.sin(a) * rad, _v)) _v.copy(r.pos);
        m.lastSeenPlayer.copy(_v); m.lastSeenT = t;   // >= lastKnownT, so his own sector wins over the squad's point
      }
    }
    // kept for seeker.js and anything else that wants the squad pointed at a place
    converge() { if (this.hasKnown) this.report(this.lastKnown, 'call', null); }
    notify(kind, m) {
      const t = ctx.elapsed;
      if (kind === 'spotted') { this.report(ctx.player.position, 'contact', m); if (!this.inCombat) this.enterCombat(); }
      else if (kind === 'hit') {
        // shot at from somewhere he was not looking: he calls in a direction, not a grid reference
        if (m && m.aware < 0.6) { const j = 6 + rng() * 6; _v.set(ctx.player.position.x + rng.range(-j, j), ctx.player.position.y, ctx.player.position.z + rng.range(-j, j)); this.report(_v, 'contact', m); }
        else this.report(ctx.player.position, 'contact', m);
        if (!this.inCombat) this.enterCombat();
        this.morale = Math.max(0, this.morale - 0.03);
      } else if (kind === 'killed') this.onKilled(m, t);
    }
    onKilled(m, t) {
      if (!this.inCombat) { this.report(m.position, 'call', null); this.enterAlert(); }   // they know where he fell
      this.morale = Math.max(0, this.morale - 0.2);
      if (m === this.leaderRef) {
        // the man giving the orders is gone: nobody flanks, nobody bounds, everyone gets behind something
        this.leaderRef = null;
        this.shaken = lerp(9, 3.5, this.skill);
        this.morale = Math.max(0, this.morale - 0.2);
        this.bounding = false;
        for (const x of this.members) if (x.alive && x !== m) { x.cooldown = Math.max(x.cooldown || 0, rng.range(0.4, 1.1)); }   // a beat of hesitation
        const c = this.members.find((x) => x.alive && x !== m);
        if (c) c.sound('mimic_radio', { gain: 0.95, max: 110, rate: 1.28 });
      }
      this.roleT = 0; this.file.length = 0;
    }

    enterAlert() { if (this.inCombat) return; this.state = 'alert'; this.combatT = 0; this.roleT = 0.4; this.knowT = lerp(1.6, 0.6, this.skill); this.radioT = Math.min(this.radioT, 1.2); }
    enterCombat() { this.state = 'combat'; this.combatT = 0; this.roleT = 0.15; this.knowT = lerp(1.6, 0.6, this.skill); this.radioT = 0.3; this.boundT = 0; }
    // Every exit from a fight goes through here. Orders that outlive their state are what pins a mimic in
    // 'engage' forever, so the roster is always cleared, and `hard` also lets the men forget you.
    standDown(hard = false) {
      this.state = 'idle'; this.combatT = 0; this.reinforceCalled = false; this.regrouped = false;
      this.bounding = false; this.shaken = 0; this.pending.length = 0;
      for (const m of this.members) {
        const o = m.orders;
        if (o) { o.role = 'idle'; o.job = 'idle'; o.hasTarget = false; o.fire = false; o.hold = false; o.at = false; o.side = 0; o.element = 0; o.mv = 0; }
        if (!m.alive) continue;
        if (hard) { m.aware = Math.min(m.aware, 0.22); m.engaged = false; m.target = null; if (m.state === 'engage' || m.state === 'search') m.setState('patrol'); }
      }
      this.morale = Math.max(this.morale, 0.55);
      if (hard) this.coolT = 70;
    }

    update(dt) {
      const t = ctx.elapsed, p = ctx.player;
      // roster, centroid, and the standing-orders watchdog in one pass
      let alive = 0, awareMax = 0, stale = false, minD = Infinity;
      this.centroid.set(0, 0, 0); this.moving = 0; this.eyesOn = false;
      let seer = null;
      for (const m of this.members) {
        if (!m.alive) continue;
        alive++; this.centroid.add(m.position); if (m.moveSpeed > 0.5) this.moving++;
        if (m.aware > awareMax) awareMax = m.aware;
        if (m.orders && m.orders.role !== 'idle') stale = true;
        const d = m.position.distanceTo(p.position); if (d < minD) minD = d;
        if (!seer && m.aware >= 0.9 && t - (m.lastVisT ?? -1e9) < 1.2 && m.lastSeenPlayer) { this.eyesOn = true; seer = m; }
      }
      if (alive === 0) { if (this.pending.length) this.pending.length = 0; return; }
      this.centroid.divideScalar(alive);
      this.shaken = Math.max(0, this.shaken - dt);
      this.coolT = Math.max(0, this.coolT - dt);
      this.grenadeT = Math.max(0, this.grenadeT - dt);
      if (!this.leader && alive > 0) this.electLeader();
      this.deliver(t);
      if (this.state === 'idle' && stale) this.standDown();   // orders never outlive the fight

      // eyes on: the shared picture is refreshed on a radio rhythm, so it always trails the truth a little
      if (this.eyesOn) {
        this.knowT -= dt;
        if (this.knowT <= 0) { this.knowT = lerp(1.5, 0.5, this.skill); this.know(seer.lastSeenPlayer, t); }
        if (!this.inCombat) this.enterCombat();
      }
      // a man who has a fresh sighting and has not called it in yet calls it in
      if (this.inCombat || this.state === 'alert') {
        for (const m of this.members) {
          if (!m.alive || m.aware < 0.8 || !m.lastSeenPlayer) continue;
          if (m.lastSeenT > this.lastKnownT + 2.5) { if (this.report(m.lastSeenPlayer, 'update', m)) break; }
        }
      }
      // gunfire near the squad: heard, placed roughly, called in
      this.shotT -= dt;
      if (this.shotT <= 0 && ctx.director && !p.inBase && this.coolT <= 0) {
        this.shotT = 1.1;
        const s = ctx.director.recentShotAt(this.centroid, CONVERGE_R);
        if (s > 0.05) {
          const d = this.centroid.distanceTo(p.position), j = d * lerp(0.1, 0.03, this.skill);
          _v.set(p.position.x + rng.range(-j, j), p.position.y, p.position.z + rng.range(-j, j));
          this.report(_v, 'call', null);
          if (this.state === 'idle') this.enterAlert();
        }
      }

      // where the squad thinks you are, and which way it thinks you are facing
      if (this.eyesOn) { this.aim.copy(p.position); this.faceA = Math.atan2(p.forward.z, p.forward.x); }
      else if (this.hasKnown) { this.aim.copy(this.lastKnown); this.faceA = Math.atan2(this.centroid.z - this.aim.z, this.centroid.x - this.aim.x); }
      else { this.aim.copy(this.centroid); this.faceA = 0; }
      this.aimEye.set(this.aim.x, this.aim.y + 1.55, this.aim.z);

      // combat clock, morale recovery, end of contact
      if (this.inCombat) {
        this.combatT += dt;
        if (awareMax < 0.15 && t - this.lastKnownT > lerp(28, 50, this.skill) && this.state !== 'ambush' && this.state !== 'breakoff') this.standDown();
      } else this.morale = Math.min(1, this.morale + dt * 0.02);

      // nerve: a squad cut in half falls back and sets an ambush; a squad that has lost its nerve leaves
      if (this.state === 'combat' && this.combatT > 5) {
        if (this.morale <= BREAK_MORALE && this.initial >= 2) this.beginBreakoff();
        else if (!this.regrouped && this.initial >= 3 && alive * 2 <= this.initial) this.beginRegroup();
      }
      // the ambush springs as one when you walk into it, not man by man
      if (this.state === 'ambush') {
        if (minD < SPRING_R && !p.dead && !p.inBase) {
          this.state = 'combat'; this.roleT = 0; this.radioT = 0.15; this.know(p.position, t);
          for (const m of this.members) if (m.alive && m.orders) { m.orders.role = 'base'; m.orders.job = 'point'; m.orders.fire = true; }
        } else if (t - this.lastKnownT > AMBUSH_MAX) this.standDown(true);   // an ambush that nobody walks into ends
      }
      if (this.state === 'breakoff') this.breakoffTick(dt, alive);

      // bounding clock: the elements swap while the squad is closing
      if (this.bounding) {
        this.boundT -= dt;
        if (this.boundT <= 0) { this.boundT = lerp(6.5, 3.5, this.skill); this.movingElement = (this.movingElement + 1) % (this.groups || 2); this.roleT = 0; this.radioT = Math.min(this.radioT, 0.6); }
        // a man who has reached his cover is down and firing again; he does not wait for the next order
        for (const m of this.members) {
          const o = m.orders; if (!o || !m.alive) continue;
          if (!o.hasTarget && o.element === this.movingElement && (o.job === 'point' || o.job === 'support')) { o.role = 'base'; o.fire = true; o.hold = true; }
        }
      }

      // A man walking a flank or crossing on a bound has nothing in sight, and on his own he would give up
      // after six seconds and wander off to the last place he saw you. He is not on his own: while anyone in
      // the squad is in contact, the radio keeps him in the fight. His sighting is never made fresher than
      // three seconds, so he still cannot shoot at something he cannot see.
      if ((this.state === 'combat' || this.state === 'regroup') && (this.eyesOn || t - this.lastKnownT < 8)) {
        for (const m of this.members) {
          const o = m.orders;
          if (!m.alive || !o || (o.job !== 'flanker' && o.mv !== 1)) continue;
          m.engaged = true;
          if (m.aware < 0.85) m.aware = 0.85;
          if (t - m.lastVisT > 3) m.lastVisT = t - 3;
        }
      }

      // jobs
      this.roleT -= dt;
      if (this.roleT <= 0) {
        // two squads re-plan per frame at most; the rest wait a tenth of a second. Six groups all deciding
        // on the same frame is the only way this file can cost a frame, and this is what stops it.
        if (jobBudget <= 0) this.roleT = 0.08 + rng() * 0.12;
        else {
          jobBudget--;
          this.roleT = lerp(3.2, 1.6, this.skill) * rng.range(0.85, 1.15);
          if (this.inCombat && this.centroid.distanceTo(p.position) < 220) this.assignJobs(alive);
        }
      }
      // patrol: only when nothing is happening, and cheaply
      if (this.state === 'idle' && this.route) { this.patrolT -= dt; if (this.patrolT <= 0) { this.patrolT = 0.6; if (this.centroid.distanceTo(p.position) < 230) this.drivePatrol(); } }
      // alert with nothing to show for it goes quiet again
      if (this.state === 'alert' && awareMax < 0.25 && t - this.lastKnownT > 30) this.standDown();

      // reinforcements: after 30 s of contact the nearest other squad within 160 m is called over
      if (this.inCombat && this.combatT > REINFORCE_AFTER * lerp(1.2, 0.7, this.skill) && !this.reinforceCalled) {
        this.reinforceCalled = true;
        const other = api.nearest(this.centroid, REINFORCE_R, (s) => s !== this && !s.inCombat && s.alive > 0 && s.coolT <= 0);
        if (other && this.hasKnown) { other.report(this.lastKnown, 'call', null); other.enterAlert(); other.radioT = 0.2; }
      }
      // radio: bursts, more when moving; silent in ambush
      this.radioT -= dt;
      if (this.radioT <= 0) {
        this.radioT = this.state === 'ambush' ? 1e9 : this.inCombat ? (this.moving > 0 ? rng.range(2.5, 5) : rng.range(5, 9)) : (this.moving > 0 ? rng.range(7, 14) : rng.range(14, 26));
        let talker = null, n = 0;
        for (const m of this.members) { if (!m.alive || m.stalker || m.position.distanceTo(p.position) > 95) continue; if (rng() < 1 / ++n) talker = m; }
        if (talker) talker.sound('mimic_radio', { gain: this.inCombat ? 0.7 : 0.45, max: 85, rate: 0.92 + rng() * 0.16 });
      }
      // the Explorer's own sheet: a chevron where a group was seen
      this.sightT -= dt;
      if (this.sightT <= 0) { this.sightT = 2; if (minD < 140) { for (const m of this.members) { if (m.alive && m.observed) { markSighting(this.centroid, alive, t); break; } } } }
    }

    // ---- falling back ----
    beginRegroup() {
      this.state = 'regroup'; this.regrouped = true; this.ambushT = 0; this.radioT = 0.2; this.bounding = false;
      // the farthest cover out of the player's view; at a higher standing they pick it on your likely path in
      const A = this.aim, sk = this.skill;
      const c = bestCover(this.centroid, 75, (c, dm) => {
        const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 22) return null;
        if (inFrustum(c.x, c.y + 0.9, c.z, 60)) return null;
        let s = dp * 0.5 - dm * 0.15;
        if (this.poi) s += (1 - clamp01(Math.hypot(c.x - this.poi.x, c.z - this.poi.z) / (this.poi.r + 30))) * 30 * sk;
        return s;
      }, false, 1.2, this.aimEye);
      if (c) this.retreat.copy(c);
      else {
        _dir.set(this.centroid.x - A.x, 0, this.centroid.z - A.z);
        if (_dir.lengthSq() < 0.1) _dir.set(1, 0, 0); _dir.normalize();
        if (!walkable(A.x + _dir.x * 45, A.z + _dir.z * 45, this.retreat)) this.retreat.copy(this.centroid);
      }
      this.spreadOnto(this.retreat, 'regroup', 3.5);
      this.roleT = 2.0;
    }
    // Break contact: no more fire unless cornered, everyone away from the called position, and once they are
    // clear they forget you for a while rather than trickling back one at a time.
    beginBreakoff() {
      if (this.state === 'breakoff') return;
      this.state = 'breakoff'; this.breakT = 0; this.radioT = 0.1; this.bounding = false; this.regrouped = true;
      const A = this.aim;
      _dir.set(this.centroid.x - A.x, 0, this.centroid.z - A.z);
      if (_dir.lengthSq() < 0.1) _dir.set(rng.range(-1, 1), 0, rng.range(-1, 1));
      _dir.normalize();
      let got = false;
      for (const r of [80, 62, 45, 30]) {
        const a = Math.atan2(_dir.z, _dir.x) + rng.range(-0.5, 0.5);
        if (walkable(this.centroid.x + Math.cos(a) * r, this.centroid.z + Math.sin(a) * r, this.retreat)) { got = true; break; }
      }
      if (!got) this.retreat.copy(this.centroid).addScaledVector(_dir, 25);
      this.spreadOnto(this.retreat, 'breakoff', 4);
      const m = this.members.find((x) => x.alive);
      if (m) m.sound('mimic_radio', { gain: 0.95, max: 120, rate: 1.3 });
    }
    breakoffTick(dt, alive) {
      this.breakT += dt;
      const clear = this.centroid.distanceTo(this.aim) > 55 || this.centroid.distanceTo(this.retreat) < 8;
      if ((clear && ctx.elapsed - this.lastKnownT > 8) || this.breakT > 45) this.standDown(true);
    }
    // put the squad onto one point without stacking it: each man gets his own slot around it
    spreadOnto(point, job, rad) {
      const role = JOB_ROLE[job] || 'regroup';
      let i = 0;
      for (const m of this.members) {
        if (!m.alive) continue;
        const o = m.orders; if (!o) { i++; continue; }
        const a = i * 2.3999632 + this.id, r = rad + (i % 3) * 2;
        if (!walkable(point.x + Math.cos(a) * r, point.z + Math.sin(a) * r, o.target)) o.target.copy(point);
        o.job = job; o.role = role; o.hasTarget = true; o.fire = false; o.hold = false; o.at = false;
        i++;
      }
    }

    // ---- jobs ----
    assignJobs(alive) {
      const p = ctx.player, A = this.aim, sk = this.skill;
      if (this.state === 'breakoff') { this.spreadOnto(this.retreat, 'breakoff', 4); return; }
      if (this.state === 'regroup') {
        let arrived = 0;
        for (const m of this.members) if (m.alive && m.position.distanceTo(this.retreat) < 5) arrived++;
        if (arrived >= alive || this.ambushT > 25) {
          this.state = 'ambush';
          for (const m of this.members) if (m.alive && m.orders) { const o = m.orders; o.job = 'ambush'; o.role = 'ambush'; o.hold = true; o.fire = false; o.hasTarget = false; }
        }
        this.ambushT += this.roleT;
        return;
      }
      if (this.state === 'ambush') {
        for (const m of this.members) if (m.alive && m.orders) { m.orders.job = 'ambush'; m.orders.role = 'ambush'; m.orders.hold = true; }
        return;
      }
      // No picture, no plan. In the second between the first man seeing you and his call landing, the squad
      // has nothing to manoeuvre against and does not pretend otherwise — he fights, the rest wait for it.
      if (!this.hasKnown && !this.eyesOn) return;
      const members = [];
      for (const m of this.members) if (m.alive && m.stunned <= 0) members.push(m);
      if (!members.length) return;
      for (const m of members) m._dA = Math.hypot(m.position.x - A.x, m.position.z - A.z);
      members.sort((a, b) => a._dA - b._dA);

      // leaderless and rattled: no plan, everyone behind the nearest thing, fire only if pressed
      if (this.shaken > 0) {
        for (const m of members) if (m.orders) this.orderShaken(m, m.orders);
        return;
      }

      // jobs by class first: the marksman and the gunner are the base of fire, the breacher goes forward
      const n = members.length, jobs = new Map();
      for (const m of members) {
        if (m.role === 'sniper' || m.role === 'gunner') jobs.set(m, 'support');
        else if (m.role === 'breacher') jobs.set(m, 'point');
      }
      const free = members.filter((x) => !jobs.has(x));
      let hasPoint = false; for (const j of jobs.values()) if (j === 'point') hasPoint = true;
      if (!hasPoint && free.length) { jobs.set(free.shift(), 'point'); hasPoint = true; }   // nearest man takes point
      if (n >= 4 && free.length) jobs.set(free.pop(), 'overwatch');              // farthest hangs back and watches
      // flankers: a squad that can spare men sends them round, and sends more as the zone gets deeper
      const wantFlank = n <= 2 ? 0 : Math.min(free.length - 1, sk > 0.55 ? 2 : sk > 0.15 ? 1 : 0);
      for (let i = 0; i < wantFlank; i++) jobs.set(free.pop(), 'flanker');
      for (const m of free) jobs.set(m, 'support');
      if (n === 1) jobs.set(members[0], 'point');

      // bounding: with two or more men holding or pushing and ground to cross, one element moves while the
      // other watches. Below tide/clearance it is a straight advance instead.
      const movers = [];
      for (const [m, j] of jobs) if (j === 'point' || j === 'support') movers.push(m);
      const gap = this.centroid.distanceTo(A);
      const wantBound = movers.length >= 2 && sk >= 0.18 && gap > 20 && this.morale > 0.45;
      this.groups = movers.length >= 3 ? 3 : 2;
      if (wantBound && !this.bounding) { this.bounding = true; this.boundT = lerp(6.5, 3.5, sk); this.movingElement = 0; }
      else if (!wantBound) this.bounding = false;
      if (this.bounding) { this.movingElement %= this.groups; for (let i = 0; i < movers.length; i++) movers[i].orders.element = i % this.groups; }

      let flankSide = rng() < 0.5 ? 1 : -1;
      // Picking a firing position is a handful of line-of-sight rays; doing it for five men at once is a
      // visible hitch on a handset. Two men are repositioned a tick, round robin — plus anyone whose job
      // has just changed and anyone whose turn it is to move. The rest keep the orders they have, which is
      // what a real squad does anyway. A man whose bound has just ended goes firm on the cover he was
      // walking to and opens fire; that costs nothing at all.
      let budget = 2, seat = 0;
      const cursor = this.posCursor | 0;
      for (const [m, job] of jobs) {
        const o = m.orders; if (!o) continue;
        const prev = o.job; o.job = job;
        const line = job === 'point' || job === 'support';
        const mv = this.bounding && line ? (o.element === this.movingElement ? 1 : 2) : 0;
        const was = o.mv | 0; o.mv = mv;
        if (mv === 2 && was === 1) { o.role = 'base'; o.fire = true; o.hold = true; continue; }
        const changed = prev !== job || (mv === 1 && was !== 1);
        const turn = seat++ === cursor % members.length;
        if (!changed && !turn && o.hasTarget) continue;
        if (!changed && budget-- <= 0) continue;
        if (job === 'flanker') {
          if (prev !== 'flanker' || o.side === 0) { o.side = flankSide; flankSide = -flankSide; o.arrivedT = 0; }
          this.orderFlank(m, o);
        } else if (job === 'overwatch') this.orderOverwatch(m, o);
        else if (mv === 1) this.orderAdvance(m, o);
        else this.orderHold(m, o, job === 'point');
      }
      this.posCursor = (cursor + 1) % Math.max(1, members.length);
    }

    // base of fire: cover with a line of sight onto the called position, at the band this man's gun likes
    orderHold(m, o, forward) {
      const A = this.aim, hold = m.profile ? m.profile.hold : [8, 30];
      o.role = 'base'; o.fire = true; o.hold = true;
      if (m.role === 'sniper') { o.hasTarget = false; return; }   // the marksman keeps his own range
      const near = forward ? Math.max(7, hold[0] * 0.7) : Math.max(10, hold[0]);
      const far = forward ? Math.min(40, Math.max(20, hold[1] * 0.8)) : Math.max(24, Math.min(60, hold[1]));
      const want = (near + far) * 0.5;
      const dA = m._dA;
      if (m.cover && m.position.distanceTo(m.cover) < 1.6 && dA > near - 2 && dA < far + 6 && m.losT >= 0 && ctx.elapsed - m.losT < 2.5) { o.target.copy(m.cover); o.hasTarget = true; o.at = true; return; }
      const c = bestCover(m.position, 26, (c, dm) => {
        const dp = Math.hypot(c.x - A.x, c.z - A.z);
        if (dp < near || dp > far || dm < 1.0) return null;
        return -Math.abs(dp - want) * 0.12 - dm * 0.06;
      }, true, 1.5, this.aimEye);
      if (c) { o.target.copy(c); o.hasTarget = true; o.at = false; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); }
      else o.hasTarget = false;
    }
    // the bound: cover that is meaningfully closer than where he stands, crossed at a run and without firing
    orderAdvance(m, o) {
      const A = this.aim, dA = m._dA;
      const want = clamp(dA - lerp(11, 18, this.skill), 8, 70);
      o.role = 'flank'; o.fire = false; o.hold = false; o.at = false;   // 'flank' is the mimic's move-and-hold-fire order
      const c = bestCover(m.position, 26, (c, dm) => {
        if (dm < 2) return null;
        const dp = Math.hypot(c.x - A.x, c.z - A.z);
        if (dp > dA - 4 || dp < 7) return null;
        return -Math.abs(dp - want) * 0.14 - dm * 0.05;
      }, null);
      if (c) { o.target.copy(c); o.hasTarget = true; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); return; }
      _dir.set(A.x - m.position.x, 0, A.z - m.position.z);
      const l = Math.hypot(_dir.x, _dir.z) || 1;
      const step = clamp(dA - want, 4, 16);
      if (walkable(m.position.x + (_dir.x / l) * step, m.position.z + (_dir.z / l) * step, o.target)) o.hasTarget = true;
      else o.hasTarget = false;
    }
    // overwatch: 28-52 m back with a view of the ground, silent unless it is coming for him
    orderOverwatch(m, o) {
      const A = this.aim;
      o.role = 'watch'; o.fire = false; o.hold = true;
      if (m._dA > 26 && m._dA < 54 && m.cover && m.position.distanceTo(m.cover) < 2) { o.target.copy(m.cover); o.hasTarget = true; o.at = true; return; }
      const c = bestCover(m.position, 40, (c, dm) => { const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 28 || dp > 52) return null; return -dm * 0.1 - Math.abs(dp - 40) * 0.05; }, true, 1.6, this.aimEye)
        || bestCover(m.position, 40, (c, dm) => { const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 28 || dp > 52) return null; return -dm * 0.1; }, null);
      if (c) { o.target.copy(c); o.hasTarget = true; o.at = false; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); return; }
      _dir.set(m.position.x - A.x, 0, m.position.z - A.z); if (_dir.lengthSq() < 0.5) _dir.set(1, 0, 0); _dir.normalize();
      if (walkable(A.x + _dir.x * 40, A.z + _dir.z * 40, o.target)) { o.hasTarget = true; o.at = false; } else o.hasTarget = false;
    }
    // leaderless: get behind the nearest thing, away from the fire, and stop shooting for a moment
    orderShaken(m, o) {
      const A = this.aim;
      o.job = 'shaken'; o.role = 'flank'; o.fire = false; o.hold = false; o.at = false;
      if (m.cover && m.position.distanceTo(m.cover) < 2) { o.target.copy(m.cover); o.hasTarget = true; return; }
      const c = bestCover(m.position, 18, (c, dm) => {
        const dp = Math.hypot(c.x - A.x, c.z - A.z);
        if (dp < m._dA - 2) return null;                 // away from it, not toward it
        return -dm * 0.2 + dp * 0.02;
      }, false, 1.2, this.aimEye) || bestCover(m.position, 18, (c, dm) => -dm, null);
      if (c) { o.target.copy(c); o.hasTarget = true; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); }
      else o.hasTarget = false;
    }
    // flanker: a chain of cover out of the player's view, walking around to the side. The angle it works for
    // opens up as the zone gets deeper: a green squad takes the shoulder, a good one goes behind you.
    orderFlank(m, o) {
      const A = this.aim, sk = this.skill;
      const wide = lerp(62, 118, sk) * DEG;
      const ta = this.faceA + o.side * wide;
      const ma = Math.atan2(m.position.z - A.z, m.position.x - A.x);
      const dA = angleDelta(ma, ta);
      o.flankAng = ta;
      const there = Math.abs(dA) < 24 * DEG && m._dA < 28 && m._dA > 5;
      if (there) {
        o.role = 'flank'; o.fire = true; o.hold = true; o.at = true;
        if (m.cover && m.position.distanceTo(m.cover) < 2) { o.target.copy(m.cover); o.hasTarget = true; return; }
        const c = bestCover(m.position, 13, (c, dm) => {
          const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 5 || dp > 28) return null;
          const ca = Math.atan2(c.z - A.z, c.x - A.x);
          return -Math.abs(angleDelta(ca, ta)) * 4 - dm * 0.1;
        }, true, 1.5, this.aimEye);
        if (c) { o.target.copy(c); o.hasTarget = true; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); o.at = false; }
        else o.hasTarget = false;
        return;
      }
      o.role = 'flank'; o.fire = false; o.hold = false; o.at = false;
      const ringD = clamp(m._dA, 10, 24);
      const c = bestCover(m.position, 22, (c, dm) => {
        if (dm < 2.5) return null;
        const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 6 || dp > 48) return null;
        const ca = Math.atan2(c.z - A.z, c.x - A.x);
        const gain = Math.abs(dA) - Math.abs(angleDelta(ca, ta));
        if (gain < 6 * DEG && Math.abs(dp - ringD) >= Math.abs(m._dA - ringD) - 1) return null;
        if (inFrustum(c.x, c.y + 0.9, c.z, 50)) return null;    // the whole chain stays out of the player's view
        return gain * 5 - Math.abs(dp - ringD) * 0.1 - dm * 0.05;
      }, null);
      if (c) { o.target.copy(c); o.hasTarget = true; return; }
      const step = Math.sign(dA || 1) * Math.min(35 * DEG, Math.abs(dA));
      const na = ma + step, r = clamp(m._dA, 12, 22);
      if (walkable(A.x + Math.cos(na) * r, A.z + Math.sin(na) * r, o.target) && !inFrustum(o.target.x, o.target.y + 0.9, o.target.z, 50)) { o.hasTarget = true; return; }
      o.hasTarget = false; o.hold = true;   // in view everywhere: wait; a skip will carry him when you look away
    }

    // ---- patrol ----
    // population.js hands over a route; the squad walks it in file, the recruit at the front, stopping to
    // look at each place. Nothing here touches a mimic that has anything better to do.
    setRoute(points, opts = {}) {
      if (!points || points.length < 2) { this.route = null; return; }
      this.route = points; this.routeI = opts.startAt != null ? opts.startAt % points.length : Math.floor(rng() * points.length);
      this.routeDir = 1; this.routeLoop = opts.loop !== false; this.routeHold = rng.range(1, 4); this.legT = 0;
    }
    drivePatrol() {
      const route = this.route; if (!route || route.length < 2) return;
      const wp = route[this.routeI];
      const prev = route[(this.routeI - this.routeDir + route.length) % route.length];
      let dx = wp.x - prev.x, dz = wp.z - prev.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const hold = this.routeHold > 0;
      const file = this.fileOrder();
      let near = 0, walking = 0;
      for (let i = 0; i < file.length; i++) {
        const m = file[i];
        if (!m.alive) continue;
        if (m.aware > 0.35 || (m.state !== 'patrol' && m.state !== 'watch' && m.state !== 'idle')) continue;
        walking++;
        let hx, hz;
        if (hold) { const a = i * 2.3999632 + this.id, r = 3.5 + (i % 3) * 2.5; hx = wp.x + Math.cos(a) * r; hz = wp.z + Math.sin(a) * r; }
        else { const back = i * 4.5, side = (i % 2) ? 1.7 : -1.7; hx = wp.x - dx * back - dz * side; hz = wp.z - dz * back + dx * side; }
        if (walkable(hx, hz, _v)) m.home.copy(_v); else m.home.copy(wp);
        m.poiR = hold ? 6 : 4.5;
        if (m.state === 'patrol') { if (m.setTarget) m.setTarget(m.home); else { if (!m.target) m.target = new THREE.Vector3(); m.target.copy(m.home); } }
        else if (m.state === 'watch' && !hold) m.waitT = Math.min(m.waitT, 0.4);
        // arrival is measured against his own slot, not the waypoint: the tail of a file is fifteen metres
        // back by design, and counting it against the waypoint would mean the squad never moved on
        if (Math.hypot(m.position.x - m.home.x, m.position.z - m.home.z) < 6) near++;
      }
      if (!walking) return;
      if (hold) { this.routeHold -= 0.6; return; }
      // A procedural waypoint can turn out to be somewhere nobody can actually walk to — behind a fence, on
      // the wrong side of a wall. Forty seconds on one leg and the patrol moves on regardless, so a route is
      // never a squad standing forever against a hedge.
      this.legT += 0.6;
      if (near >= Math.max(1, Math.ceil(walking * 0.6)) || this.legT > 40) {
        this.legT = 0;
        this.routeHold = rng.range(4, 11);
        if (this.routeLoop) this.routeI = (this.routeI + 1) % route.length;
        else {
          this.routeI += this.routeDir;
          if (this.routeI >= route.length) { this.routeI = route.length - 2; this.routeDir = -1; }
          else if (this.routeI < 0) { this.routeI = 1; this.routeDir = 1; }
        }
      }
    }
  }

  // ---- sightings for the Explorer's sheet (ctx.squads.sightings, read by ui/panel_map.js) ----
  function markSighting(pos, count, t) {
    for (const s of sightings) {
      if (Math.hypot(s.x - pos.x, s.z - pos.z) < 30) { s.x = pos.x; s.z = pos.z; s.t = t; s.count = Math.max(s.count, count); return; }
    }
    sightings.push({ x: pos.x, z: pos.z, t, count });
    if (sightings.length > 16) sightings.shift();
  }

  // ---- grenades: an arc with bounces, a fuse, a blast that hurts everyone ----
  function grenadeMesh() {
    if (!grenadeGeo) { grenadeGeo = new THREE.SphereGeometry(0.045, 8, 6); grenadeGeo.userData.shared = true; grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2a2f24, roughness: 0.85, metalness: 0.15 }); grenadeMat.userData.shared = true; }
    const m = new THREE.Mesh(grenadeGeo, grenadeMat); m.castShadow = false; return m;
  }
  function throwGrenade(thrower, from, target, gdef) {
    const d = Math.hypot(target.x - from.x, target.z - from.z);
    const dy = target.y - from.y;
    const g = 9.8, ang = 42 * DEG;
    // v from the range equation on flat ground, nudged for height difference; capped at a human throw
    let v = Math.sqrt(Math.max(1, (g * d * d) / (2 * Math.cos(ang) * Math.cos(ang) * Math.max(0.5, d * Math.tan(ang) - dy))));
    v = clamp(v * (0.96 + rng() * 0.08), 4, 19);
    _dir.set(target.x - from.x, 0, target.z - from.z).normalize();
    const gr = { pos: from.clone(), vel: new THREE.Vector3(_dir.x * v * Math.cos(ang), v * Math.sin(ang), _dir.z * v * Math.cos(ang)), fuse: gdef.fuse || 3.5, radius: gdef.radius || 7, damage: gdef.damage || 100, source: thrower, mesh: grenadeMesh(), rest: 0, hiss: null };
    gr.mesh.position.copy(gr.pos); ctx.scene.add(gr.mesh);
    gr.hiss = playAny(ctx, ['grenade_hiss', 'gas_hiss'], { pos: gr.pos, hrtf: true, gain: 0.35, max: 30 });
    grenades.push(gr);
    return gr;
  }
  function stepGrenade(gr, dt) {
    gr.fuse -= dt;
    if (gr.rest < 1) {
      gr.vel.y -= 9.8 * dt;
      _v.copy(gr.vel).multiplyScalar(dt);
      const len = _v.length();
      if (len > 1e-4) {
        _dir.copy(_v).divideScalar(len);
        const hit = ctx.world.raycast(gr.pos, _dir, len + 0.06);
        if (hit) {
          // bounce off the surface, losing most of the energy
          _n.copy(hit.normal);
          gr.pos.copy(hit.point).addScaledVector(_n, 0.05);
          const vn = gr.vel.dot(_n);
          gr.vel.addScaledVector(_n, -vn * 1.35).multiplyScalar(0.55);
          if (gr.vel.length() < 0.8) gr.rest = 1;
          playAny(ctx, ['grenade_bounce', 'impact_metal'], { pos: gr.pos, hrtf: true, gain: 0.5, rate: 1.3 });
        } else gr.pos.add(_v);
      }
      const gy = ctx.world.groundHeight(gr.pos.x, gr.pos.z, gr.pos.y + 0.5).y;
      if (gr.pos.y < gy + 0.04) { gr.pos.y = gy + 0.04; if (gr.vel.y < -1.2) { gr.vel.y = -gr.vel.y * 0.35; gr.vel.x *= 0.6; gr.vel.z *= 0.6; playAny(ctx, ['grenade_bounce', 'impact_dirt'], { pos: gr.pos, hrtf: true, gain: 0.5 }); } else { gr.vel.set(gr.vel.x * 0.85, 0, gr.vel.z * 0.85); if (gr.vel.length() < 0.3) gr.rest = 1; } }
      gr.mesh.position.copy(gr.pos); gr.mesh.rotation.x += dt * 9; gr.mesh.rotation.z += dt * 5;
      if (gr.hiss) gr.hiss.setPos(gr.pos);
    }
    if (gr.fuse <= 0) { explode(gr); return true; }
    return false;
  }
  function explode(gr) {
    const p = ctx.player;
    ctx.vfx.explosion?.(gr.pos, gr.radius * 0.45, 0xffa050);
    ctx.vfx.light?.(gr.pos, 0xffb070, 30, 0.14, 30);
    ctx.vfx.dustPuff?.(gr.pos, _n.set(0, 1, 0), 40, [0.35, 0.3, 0.25], 1.6);
    playAny(ctx, ['grenade_explode', 'fragment_explode'], { pos: gr.pos, hrtf: true, gain: 1.0, max: 320, ref: 8 });
    if (gr.hiss) { gr.hiss.stop(0.05); gr.hiss = null; }
    // entities: full radial damage (mimics soften their own grenades in their damage override)
    ctx.enemies.blast(gr.pos, gr.radius, gr.damage, { hurtPlayer: false, source: gr.source, grenade: true });
    // the player: falloff, halved through a wall, softened by the helmet in damage.other
    if (!p.dead) {
      const d = gr.pos.distanceTo(p.position);
      if (d < gr.radius) {
        let dmg = gr.damage * (1 - d / gr.radius);
        _v.set(gr.pos.x, gr.pos.y + 0.3, gr.pos.z);
        if (!ctx.world.lineOfSight(_v, p.eye) && !ctx.world.lineOfSight(_v, _v2.set(p.position.x, p.position.y + 0.5, p.position.z))) dmg *= 0.35;
        if (ctx.damage?.other) ctx.damage.other(dmg, { kind: 'blast', source: gr.source, bleed: false }); else p.damage(dmg, { kind: 'blast', source: gr.source, bleed: false });
        ctx.post.shake?.(clamp01(1.2 - d / gr.radius) * 0.9);
      } else if (d < gr.radius * 3) ctx.post.shake?.(0.25 * (1 - d / (gr.radius * 3)));
    }
    ctx.scene.remove(gr.mesh);
  }

  const api = {
    list, grenades, visibleFromPlayer, inFrustum, walkable, bestCover, playAny: (names, opts) => playAny(ctx, names, opts),
    get skill() { return zoneSk; },
    // a squad that has watched you sit still for six seconds decides you are worth a grenade; a good one
    // makes that decision sooner (the mimic reads this against a fixed six)
    get playerHoldT() { return hold.t * lerp(1, 1.8, zoneSk); },
    // the Explorer's map annotations: where groups were seen, newest last
    sightings() { return sightings; },
    form(members, poi) {
      const ms = (members || []).filter((m) => m && m.type === 'mimic');
      const s = new Squad(ms, poi);
      list.push(s);
      return s;
    },
    squadOf(m) { return m.squad || null; },
    nearest(pos, maxD = Infinity, filter = null) { let best = null, bd = maxD; for (const s of list) { if (s.alive === 0 || (filter && !filter(s))) continue; const d = s.centroid.distanceTo(pos); if (d < bd) { bd = d; best = s; } } return best; },
    // a member wants to throw: squad cooldown (one per squad, sooner the deeper the zone has gone)
    canThrow(m) {
      const s = m.squad;
      if (!s) return (m.grenadeCool || 0) <= 0;
      if (s.state === 'ambush' || s.state === 'breakoff' || s.shaken > 0) return false;
      return s.grenadeT <= 0;
    },
    throwGrenade(m, from, target, grenadeId) {
      const gdef = def(grenadeId) || { fuse: 3.5, radius: 7, damage: 110 };
      const cd = GRENADE_CD * lerp(1.1, 0.55, zoneSk);
      if (m.squad) m.squad.grenadeT = cd; else m.grenadeCool = cd;
      return throwGrenade(m, from, target, gdef);
    },
    reset() {
      for (const s of list) for (const m of s.members) m.squad = null;
      list.length = 0;
      for (const g of grenades) { ctx.scene.remove(g.mesh); if (g.hiss) g.hiss.stop(0.05); }
      grenades.length = 0; sightings.length = 0; hold.init = false; hold.t = 0; grid = null; gridLen = -1;
    },
    update(dt) {
      if (dt <= 0) return;
      refreshCam();
      jobBudget = 2;
      zoneSkT -= dt; if (zoneSkT <= 0) { zoneSkT = 3; zoneSk = zoneSkill(); }
      // how long has the player held one spot? (grenade trigger)
      const p = ctx.player.position;
      if (!hold.init || hold.anchor.distanceTo(p) > 2.5) { hold.anchor.copy(p); hold.t = 0; hold.init = true; } else hold.t += dt;
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s.alive === 0 && s.members.every((m) => !m.alive)) { for (const m of s.members) m.squad = null; list.splice(i, 1); continue; }
        s.update(dt);
      }
      for (let i = grenades.length - 1; i >= 0; i--) { if (stepGrenade(grenades[i], Math.min(dt, 0.05))) grenades.splice(i, 1); }
    },
  };
  ctx.events.on('gameStart', () => api.reset());
  ctx.events.on('tide', () => api.reset());
  return api;
}
