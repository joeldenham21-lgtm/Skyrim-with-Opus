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
//
// ---------------------------------------------------------------------------------------------------------
// v4 — the squad as a unit rather than four men standing near each other.
//
//   THE RADIO WORDS (CALLS, below). Every transfer of knowledge between two mimics, and every decision the
//   player deserves a beat of warning about, goes through say(): a handset keyed at a rate you learn to read.
//   Contact, he-has-moved, I-am-crossing, I-am-set, going-round, frag-out, man-down, falling-back. A call
//   reaches only the men inside RADIO_R; past that a man is on his own. Nothing here moves information
//   silently, which is the fairness rule stated as code.
//
//   BOUNDING OVERWATCH THAT IS ACTUALLY COVERED. A man does not step off until coverBound() has found a
//   stationary man with a line onto the middle of the ground he is about to cross — and that man is handed
//   the lane as a SECTOR, which he faces and (mimic.js wantCover) puts rounds into while his mate runs. A
//   bound nobody can cover is refused: below a green squad's standing they cross anyway and die doing it.
//
//   A FLANKING ELEMENT, NOT TWO LONE FLANKERS. One side for the whole element, chosen once and kept, and
//   nobody walks until the base is actually fixing you (`fixing` counts men of the base with a live line).
//
//   ORGANISATION. `org` is what a leader is worth: it drops to a fifth when he is killed and comes back over
//   fifteen seconds as somebody else takes the picture up. No leader means no bounds, no flank, no grenade
//   order — killing the man giving orders visibly costs them a manoeuvre.
//
//   THE PICTURE HAS A WIDTH. know() carries a radius, spread() grows it with age, and the sectors men are put
//   on are as wide as the picture is vague. A squad that watched you go covers a little ground well; a squad
//   that only heard a shot covers a lot of ground badly.
//
//   THE SWEEP. Losing you turns the squad into a line abreast walking the ground, one lane each, silent.
//
//   THE WORLD. Anomalies are fences: nothing plans a bound, a flank, a firing position or a line of retreat
//   through one, and a squad falling back prefers a route with a field between it and you. Overwatch prefers
//   height. A squad cut in half falls back INTO a building when the POI has one.
//
//   THE GRENADE IS THE SQUAD'S DECISION. When you are in a hole they cannot shoot into, the leader picks the
//   man best placed and posts one in — after the call, not before it.
import * as THREE from 'three';
import { clamp, clamp01, lerp, angleDelta, DEG } from '../core/math.js';
import { classRank } from './loadout.js';
import { def } from '../data/index.js';
import { createCommand, CALLS as WORD_CALLS } from './command.js';
import { losBudget, reach } from './traversal.js';
import * as kit from './kit.js';
import * as ambush from './ambush.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _eye = new THREE.Vector3(), _n = new THREE.Vector3(), _cam = new THREE.Vector3(0, 0, -1);
const _lane = new THREE.Vector3(), _from = new THREE.Vector3();
const REINFORCE_AFTER = 30, REINFORCE_R = 160, GRENADE_CD = 40, CONVERGE_R = 120;
const AMBUSH_MAX = 110, BREAK_MORALE = 0.3, SPRING_R = 18, CELL = 20;
const RADIO_R = 170;          // m a handset reaches; past it a man is on his own until somebody walks to him
// the mimic only understands these order roles; `job` below is the squad's own vocabulary
const JOB_ROLE = { point: 'base', support: 'base', flanker: 'flank', overwatch: 'watch', bound: 'flank', shaken: 'flank', ambush: 'ambush', regroup: 'regroup', breakoff: 'regroup', sweep: 'base', idle: 'idle' };
const cand = [], candS = [];   // scratch: top-N cover candidates, reused

// =====================================================================================================
// THE RADIO WORDS.
// A squad's information moves through exactly one channel, and the channel makes a noise. Every call below
// is a handset keyed at its own rate: the player hears a different chirp before a bound, before a flank and
// before a grenade, and after two contacts he knows which one he is hearing. Nothing in this file moves
// knowledge between two mimics without one of these playing first — that is the fairness rule, stated as code.
// =====================================================================================================
// `gap` is the shortest time between two of the same word: a squad chatters, it does not stammer.
// The table itself moved to command.js, which owns the whole vocabulary (nineteen words, each with a fixed
// syllable count, duration envelope, pitch contour and squelch, so they are learnable) — this is the same
// object shape under the old name so nothing that imported CALLS from here breaks.
export const CALLS = WORD_CALLS;

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
  // THE MIND (command.js). One picture, one read of how the Explorer fights, one named play at a time held
  // under a commitment window, one set of seats and ONE MOUTH. It is handed the shared ray pool (so its
  // occluder solve competes with everything else for the same ten a frame), traversal.reach (so a roof seat
  // is simply never offered to a man who cannot clamber) and ambush.pickHide (so BAIT's man really goes to
  // ground). Every solver below is kept verbatim and handed to it as a facade.
  const cmd = createCommand(ctx, { losBudget, reach, pickHide: ambush.pickHide });
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
  // ---- the ground they refuse ----
  // They live here. An electric field or a gravity well is not a hazard they walk into and learn about: it is
  // a fence, and one they will happily put between themselves and you. Nothing they plan — a bound, a flank,
  // a firing position, a line of retreat — is ever allowed to cross one.
  function anomalyAt(x, z, pad = 2.0) {
    const list = ctx.anomalies && ctx.anomalies.list; if (!list || !list.length) return null;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (!a || !a.position) continue;
      const r = (a.radius || 6) + pad;
      if (Math.abs(a.position.x - x) > r || Math.abs(a.position.z - z) > r) continue;
      if (Math.hypot(a.position.x - x, a.position.z - z) < r) return a;
    }
    return null;
  }
  // does the straight line a->b pass through one? (closest approach of a segment to a circle centre)
  function anomalyOnLine(ax, az, bx, bz, pad = 1.6) {
    const list = ctx.anomalies && ctx.anomalies.list; if (!list || !list.length) return null;
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]; if (!a || !a.position) continue;
      const r = (a.radius || 6) + pad;
      let t = l2 > 1e-6 ? ((a.position.x - ax) * dx + (a.position.z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(ax + dx * t - a.position.x, az + dz * t - a.position.z) < r) return a;
    }
    return null;
  }
  function walkable(x, z, out) {
    const w = ctx.world;
    if (Math.abs(x) > w.half - 6 || Math.abs(z) > w.half - 6) return null;
    if (w.isWater(x, z)) return null;
    const y = w.groundHeight(x, z, w.getHeight(x, z) + 2).y;
    if (w.pointInSolid(x, y + 0.6, z)) return null;
    if (w.isInBase(_v3.set(x, y, z))) return null;
    if (anomalyAt(x, z)) return null;
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
      if (anomalyAt(c.x, c.z)) continue;       // a firing position inside a field is not a firing position
      if (needLos === null) return c;
      // contract C4: this used to test line of sight outside the budget entirely, which is how a squad of six
      // could spend thirty rays in a frame that the rest of the AI had already been refused. When the pool is
      // dry it takes the best-scored candidate WITHOUT checking the line, which is what a man who has not
      // looked properly does, rather than standing still because the frame ran out of arithmetic.
      if (!losBudget(ctx, 1)) return cand[0] || c;
      if (ctx.world.lineOfSight(_v.set(c.x, c.y + losFrom, c.z), eye) === needLos) return c;
    }
    return null;
  }

  class Squad {
    constructor(members, poi) {
      this.id = nextId++; this.poi = poi || null; this.members = [];
      this.state = 'idle';            // idle | alert | combat | regroup | ambush | breakoff
      // ---- the head ----
      // Every solver in this file is kept exactly as it was and handed over as a facade; the Mind decides
      // WHICH of them runs, on WHOM, and WHEN, and says so on the radio first. lastKnown / lastKnownT /
      // knownR / contactKind / hasKnown / spread() are now thin proxies onto its picture (see below), so
      // everything in mimic.js that reads them keeps working and there is exactly one belief in the squad.
      this.mind = cmd.makeMind(this, {
        bestCover, walkable, anomalyAt, anomalyOnLine,
        highGround: (m, o) => this.highGround(m, o),
        orderHold: (m, o, fwd) => this.orderHold(m, o, fwd),
        orderAdvance: (m, o) => this.orderAdvance(m, o),
        orderFlank: (m, o) => this.orderFlank(m, o),
        orderOverwatch: (m, o) => this.orderOverwatch(m, o),
        orderShaken: (m, o) => this.orderShaken(m, o),
        orderSweep: (n) => this.orderSweep(n),
        spreadOnto: (pt, job, rad) => this.spreadOnto(pt, job, rad),
        coverBound: (m, o) => this.coverBound(m, o),
        beginRegroup: () => this.beginRegroup(),
        beginBreakoff: () => this.beginBreakoff(),
        plant: () => this.plant(),
        members: () => this.members,
        leader: () => this.leader,
      });
      this.shotCursor = -1;           // the Director's shot ring, so read.mag counts each round exactly once
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
      // ---- v4: the squad as a unit ----
      this.org = 1;                    // organisation: 1 with a leader giving orders, a quarter of that without
      this.fixing = 0;                 // men of the base element with a live line onto the called position
      this.fixT = -1e9;                // when the base last actually put rounds down
      this.flankSide = 1; this.flankT = -1e9; this.flankSet = false; this.flankers = 0;
      this.bounds = 0; this.boundsRefused = 0; this.fragOrders = 0;   // read by tools/scenarios/ai-*.mjs
      this.lastSay = null; this.saidT = -1e9;
      this.sectorT = 0; this.planted = false; this.saidAt = {}; this.assaultT = -1e9; this.assault = false;
      for (const m of members) this.add(m);
      this.initial = this.members.length;
      this.electLeader();
    }
    add(m) {
      if (!m || this.members.includes(m)) return;
      if (m.squad && m.squad !== this) m.squad.remove(m);
      m.squad = this; this.members.push(m); this.initial = Math.max(this.initial, this.members.length);
      if (!m.orders) m.orders = { role: 'idle', job: 'idle', target: new THREE.Vector3(), hasTarget: false, fire: false, hold: false, at: false, side: 0, element: 0, mv: 0, arrivedT: 0, flankAng: 0,
        sector: new THREE.Vector3(), hasSector: false, sectorAt: -1e9, covering: null, frag: 0, saidMove: 0 };
      else if (!m.orders.sector) { m.orders.sector = new THREE.Vector3(); m.orders.hasSector = false; m.orders.sectorAt = -1e9; m.orders.covering = null; m.orders.frag = 0; m.orders.saidMove = 0; }
      this.file.length = 0;
      if (!this.leaderRef) this.electLeader();
    }
    remove(m) { const i = this.members.indexOf(m); if (i >= 0) this.members.splice(i, 1); if (m.squad === this) m.squad = null; if (this.leaderRef === m) this.leaderRef = null; this.file.length = 0; }
    get alive() { let n = 0; for (const m of this.members) if (m.alive) n++; return n; }
    // the leader is elected once and kept; `leader` is null while the squad has none (it has just lost one)
    get leader() { const l = this.leaderRef; return l && l.alive && this.members.includes(l) ? l : null; }
    get inCombat() { return this.state === 'combat' || this.state === 'regroup' || this.state === 'ambush' || this.state === 'breakoff' || this.state === 'sweep'; }
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

    // ---- the radio ----
    // One place where a squad makes a noise on purpose. Everything the squad decides that the player could
    // reasonably be given a chance to react to goes through here FIRST, a beat before it happens.
    say(kind, from, mult = 1) {
      const said = this.mind.say(kind, from, mult);
      if (said) { this.saidAt[kind] = ctx.elapsed; this.lastSay = kind; this.saidT = ctx.elapsed; this.radioT = Math.max(this.radioT, 1.4); }
      return said;
    }

    // ---- shared knowledge: one belief, owned by the mind ----
    // `r` is how wide the guess is. A sighting is 0; a call relayed across the squad widens as it travels and
    // keeps widening as it ages — and the RATE it widens at is what a read of the player buys: 1.15 m/s for a
    // squad that has learned nothing about you (deliberately worse than the old flat 0.8), 0.45 for one that
    // has. That single scalar is the difference between "confused by a tree" and "waiting on the far side".
    know(pos, t, r = 0) { return this.mind.know(pos, t, r); }
    get lastKnown() { return this.mind.picture.pos; }
    get lastKnownT() { return this.mind.picture.t; }
    get hasKnown() { return this.mind.picture.has; }
    get knownR() { return this.mind.picture.r; }
    set knownR(v) { this.mind.picture.r = v; }
    get contactKind() { return this.mind.picture.kind; }
    set contactKind(v) { this.mind.picture.kind = v; }
    spread() { return this.mind.spread(); }
    // A sighting is called in, not broadcast. The caller keys the radio (a delay), the squad's shared picture
    // updates, and each other man hears it after a delay of his own — farther away is later, and at low
    // standing some of them miss the first call entirely and get it on the repeat.
    report(pos, kind, from, radius = 0) {
      const t = ctx.elapsed, sk = this.skill;
      const gate = kind === 'contact' ? 1.2 : kind === 'update' ? 2.6 : 2.0;
      if (t < this.callT + gate) return false;
      this.callT = t;
      const base = (kind === 'contact' ? 0.7 : 0.45) * lerp(1.4, 0.55, sk);
      const shared = new THREE.Vector3(pos.x, pos.y, pos.z);
      this.pending.push({ m: null, pos: shared, at: t + base, level: 1, slot: 0, r: radius });
      let i = 1, heard = 0;
      for (const m of this.members) {
        if (!m.alive || m === from) continue;
        const d = from ? m.position.distanceTo(from.position) : 25;
        // a handset is not telepathy: past its reach a man simply does not get the call, and the squad
        // manoeuvres without him until somebody walks close enough to tell him.
        if (d > RADIO_R) continue;
        let delay = base + 0.3 + d * lerp(0.022, 0.008, sk) + rng.range(0, 0.5);
        if (rng() > lerp(0.7, 0.97, sk)) delay += rng.range(1.5, 3.5);   // missed the first call
        // a grid reference read off a map over a radio is worth less than what the caller saw
        const rr = radius + (kind === 'contact' ? 1.5 : 3) + d * 0.02;
        this.pending.push({ m, pos: shared, at: t + delay, level: kind === 'contact' ? 0.65 : 0.5, slot: i++, r: rr });
        heard++;
      }
      // the call itself: the noise the player can hear, made before anything happens because of it
      this.say(kind === 'contact' ? 'contact' : kind === 'update' ? 'update' : 'heard', from || null);
      this.contactKind = kind === 'contact' ? (from ? 'seen' : 'told') : kind === 'update' ? 'told' : 'heard';
      this.heardBy = heard;
      return true;
    }
    // A delivered call puts a man onto a SECTOR of the called position, not onto the position itself, and the
    // sector is as wide as the call was vague: a squad told "somewhere by the barn" fans out across the barn.
    deliver(t) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const r = this.pending[i];
        if (r.at > t) continue;
        this.pending.splice(i, 1);
        if (!r.m) { this.know(r.pos, t, r.r || 0); if (this.state === 'idle') this.enterAlert(); continue; }
        const m = r.m; if (!m.alive || m.stunned > 0) continue;
        if (m.aware < r.level) m.aware = r.level;
        if (!m.lastSeenPlayer) m.lastSeenPlayer = new THREE.Vector3();
        const a = r.slot * 2.3999632 + this.id * 0.7, rad = 3.5 + (r.slot % 3) * 3.5 + (r.r || 0) * 0.8;
        if (!walkable(r.pos.x + Math.cos(a) * rad, r.pos.z + Math.sin(a) * rad, _v)) _v.copy(r.pos);
        m.lastSeenPlayer.copy(_v); m.lastSeenT = t;   // >= lastKnownT, so his own sector wins over the squad's point
        if (m.beliefR != null) m.beliefR = Math.max(m.beliefR, rad * 0.5);
      }
    }
    // kept for seeker.js and anything else that wants the squad pointed at a place
    converge() { if (this.hasKnown) this.report(this.lastKnown, 'call', null); }
    notify(kind, m) {
      const t = ctx.elapsed;
      // A man calls in what HE has: his own belief and how wrong it may be, never the player's true position.
      // He can reach aware 1 on sound alone, and a squad manoeuvring on a noise is the whole point of the
      // difference between a squad that has seen you and one that has only been told about you.
      if (kind === 'spotted') { this.report(m && m.lastSeenPlayer ? m.lastSeenPlayer : ctx.player.position, 'contact', m, (m && m.beliefR) || 0); if (!this.inCombat) this.enterCombat(); }
      else if (kind === 'hit') {
        // shot at from somewhere he was not looking: he calls in a direction, not a grid reference
        if (m && m.aware < 0.6) { const j = 6 + rng() * 6; _v.set(ctx.player.position.x + rng.range(-j, j), ctx.player.position.y, ctx.player.position.z + rng.range(-j, j)); this.report(_v, 'contact', m, j); }
        else this.report(m && m.lastSeenPlayer ? m.lastSeenPlayer : ctx.player.position, 'contact', m, (m && m.beliefR) || 0);
        if (!this.inCombat) this.enterCombat();
        this.morale = Math.max(0, this.morale - 0.03);
      } else if (kind === 'killed') this.onKilled(m, t);
    }
    onKilled(m, t) {
      if (!this.inCombat) { this.report(m.position, 'call', null, 8); this.enterAlert(); }   // they know where he fell
      this.morale = Math.max(0, this.morale - 0.2);
      // a man goes down and somebody says so — you hear it, and you hear what it costs them
      this.say('down', this.members.find((x) => x.alive && x !== m) || null);
      if (m !== this.leaderRef) this.mind.interrupt('manDown', m.position.x, m.position.z, m);
      if (m === this.leaderRef) {
        // The man giving the orders is gone. Nobody flanks, nobody bounds, everyone gets behind something,
        // and the squad stays disorganised until somebody else has the picture: `org` is what the rest of
        // this file multiplies its plans by, so killing the leader visibly costs them a manoeuvre.
        this.leaderRef = null;
        this.shaken = lerp(9, 3.5, this.skill);
        this.org = 0.2;
        this.morale = Math.max(0, this.morale - 0.2);
        this.bounding = false; this.flankSet = false; this.flankT = -1e9;
        for (const x of this.members) if (x.alive && x !== m) { x.cooldown = Math.max(x.cooldown || 0, rng.range(0.4, 1.1)); }   // a beat of hesitation
        // The active play is aborted MID-EXECUTION: the man who was walking round stops and goes to ground,
        // visibly, within a frame. The mind drops to C0 — no plays at all — until `shaken` runs out, and then
        // after two to four seconds of silence the next-ranked man keys the handset with the COMMAND carrier
        // for the first time and says `hold`. The commanding voice comes from a different place in the world,
        // which is the most legible possible statement of what killing him bought.
        this.mind.onLeaderDown(m);
      }
      this.roleT = 0; this.file.length = 0;
    }

    // A squad put here on purpose, by population.js, on the ground the zone has watched you walk. It sits
    // silent — no radio, no patrol — until you come inside SPRING_R, and unlike an improvised ambush it does
    // not get bored: it was told to wait here, so it waits here.
    plant() {
      this.planted = true; this.state = 'ambush'; this.route = null; this.radioT = 1e9;
      this.mind.standDown(false); this.morale = 1;
      // Where the man is expected to come FROM. The zone files the bearing you walked in on last time
      // (director.poiRecord), and ambush.js builds the whole lane, the two validation rays and the choke
      // sweep off it. Failing that, the centre of the POI.
      const rec = this.poi && ctx.director && ctx.director.poiRecord ? ctx.director.poiRecord(this.poi.id) : null;
      let ax = this.poi ? this.poi.x : this.centroid.x, az = this.poi ? this.poi.z : this.centroid.z;
      if (rec && rec.ang != null && this.poi) { ax = this.poi.x + Math.cos(rec.ang) * (this.poi.r + 20); az = this.poi.z + Math.sin(rec.ang) * (this.poi.r + 20); }
      for (const m of this.members) {
        if (!m.alive) continue;
        const o = m.orders; if (!o) continue;
        o.job = 'ambush'; o.role = 'ambush'; o.hold = true; o.fire = false; o.hasTarget = false; o.hasSector = false;
        m.aware = Math.min(m.aware, 0.15); m.engaged = false;
        // A PLANTED ambush never gets bored: it was told to wait here, so it waits here. It makes literally
        // no sound while it does — the static bed is stopped outright, not attenuated, and the handset is dead.
        if (!ambush.isCommitted(m)) ambush.beginHide(m, ctx, ax, az, { planted: true });
        if (m.setState && m.state !== 'engage') m.setState('engage');
      }
    }
    enterAlert() { if (this.inCombat) return; this.state = 'alert'; this.combatT = 0; this.roleT = 0.4; this.knowT = lerp(1.6, 0.6, this.skill); this.radioT = Math.min(this.radioT, 1.2); }
    enterCombat() { this.planted = false; this.state = 'combat'; this.combatT = 0; this.roleT = 0.15; this.knowT = lerp(1.6, 0.6, this.skill); this.radioT = 0.3; this.boundT = 0; }
    // Every exit from a fight goes through here. Orders that outlive their state are what pins a mimic in
    // 'engage' forever, so the roster is always cleared, and `hard` also lets the men forget you.
    standDown(hard = false) {
      this.state = 'idle'; this.combatT = 0; this.reinforceCalled = false; this.regrouped = false;
      this.bounding = false; this.shaken = 0; this.pending.length = 0;
      this.flankSet = false; this.flankT = -1e9; this.fixing = 0;
      // the mind drops its play; a HARD stand-down also files what this contact taught the zone about you and
      // wipes the squad's own read, so the next contact starts from what the ZONE knows and nothing more
      this.mind.standDown(hard);
      for (const m of this.members) if (m.alive) ambush.abandon(m, 'standDown');
      for (const m of this.members) {
        const o = m.orders;
        if (o) { o.role = 'idle'; o.job = 'idle'; o.hasTarget = false; o.fire = false; o.hold = false; o.at = false; o.side = 0; o.element = 0; o.mv = 0; o.hasSector = false; o.covering = null; o.frag = 0; o.saidMove = 0; }
        if (!m.alive) continue;
        if (hard) { m.aware = Math.min(m.aware, 0.22); m.engaged = false; m.target = null; if (m.state === 'engage' || m.state === 'search') m.setState('patrol'); }
      }
      this.morale = Math.max(this.morale, 0.55);
      if (hard) this.coolT = 70;
    }

    update(dt) {
      const t = ctx.elapsed, p = ctx.player;
      // The mind's cheap half: order delivery, the commitment clock, the still-clock, and the same-frame
      // promotion cascade when a seat's man dies. No rays, no allocation, no search.
      this.mind.update(dt);
      this.hearShots(t);
      // roster, centroid, and the standing-orders watchdog in one pass
      let alive = 0, awareMax = 0, stale = false, minD = Infinity;
      this.centroid.set(0, 0, 0); this.moving = 0; this.eyesOn = false;
      let seer = null, seers = 0;
      for (const m of this.members) {
        if (!m.alive) continue;
        alive++; this.centroid.add(m.position); if (m.moveSpeed > 0.5) this.moving++;
        if (m.aware > awareMax) awareMax = m.aware;
        if (m.orders && m.orders.role !== 'idle') stale = true;
        const d = m.position.distanceTo(p.position); if (d < minD) minD = d;
        if (m.aware >= 0.85 && t - (m.lastVisT ?? -1e9) < 1.2) seers++;
        if (!seer && m.aware >= 0.9 && t - (m.lastVisT ?? -1e9) < 1.2 && m.lastSeenPlayer) { this.eyesOn = true; seer = m; }
      }
      // HOW MANY MEN CURRENTLY HAVE EYES ON IT. The mind counts this in its ledger, but the ledger is only
      // rebuilt on a plan tick — and a squad far from the player, or one that has run out of plan budget,
      // stops planning. A frozen seer count freezes the still-clock ON, and the still-clock is the grenade
      // trigger. It is a per-frame fact and the roster pass above already has it, so it is written here.
      this.mind.picture.seers = seers;
      if (alive === 0) { if (this.pending.length) this.pending.length = 0; return; }
      this.centroid.divideScalar(alive);
      this.shaken = Math.max(0, this.shaken - dt);
      this.coolT = Math.max(0, this.coolT - dt);
      this.grenadeT = Math.max(0, this.grenadeT - dt);
      // organisation: with somebody running it a squad manoeuvres, without one it hugs cover. It comes back
      // over ten to twenty seconds as the next man takes the picture up — never instantly.
      if (!this.leader && alive > 0) this.electLeader();
      // ~13 s from a dead leader back to a squad that manoeuvres: long enough that killing him buys you the
      // ground, short enough that they do not stand in the open forever.
      this.org = clamp01(this.org + dt * (this.leader ? 0.06 : -0.4));
      this.deliver(t);
      if (this.state === 'idle' && stale) this.standDown();   // orders never outlive the fight

      // eyes on: the shared picture is refreshed on a radio rhythm, so it always trails the truth a little
      if (this.eyesOn) {
        this.knowT -= dt;
        if (this.knowT <= 0) { this.knowT = lerp(1.5, 0.5, this.skill); this.know(seer.lastSeenPlayer, t, 0); this.contactKind = 'seen'; }
        if (!this.inCombat) this.enterCombat();
      } else if (this.contactKind === 'seen' && t - this.lastKnownT > 2.5) this.contactKind = 'told';
      // Who is fixing him. A flank only means anything if the base is shooting: this counts the men of the
      // base element who actually have a line onto the called position right now, and when it hits zero the
      // flanking element stops walking and gets down, because nothing is holding the player's head down.
      this.sectorT -= dt;
      if (this.sectorT <= 0) {
        this.sectorT = 0.5;
        let fix = 0;
        for (const m of this.members) {
          if (!m.alive || !m.orders) continue;
          if (m.orders.job !== 'point' && m.orders.job !== 'support') continue;
          if (!m.orders.fire) continue;
          // fixing means ROUNDS, not a line of sight from behind a rock: a man who has not fired in three
          // seconds is not holding anybody's head down, and the flank does not step off on his account.
          if (t - (m.lastFireT ?? -1e9) < 3 || (t - (m.lastVisT ?? -1e9) < 2 && m.burstLeft > 0)) fix++;
        }
        this.fixing = fix;
        if (fix > 0) this.fixT = t;
      }
      // a man who has a fresh sighting and has not called it in yet calls it in
      if (this.inCombat || this.state === 'alert') {
        for (const m of this.members) {
          if (!m.alive || m.aware < 0.8 || !m.lastSeenPlayer) continue;
          // ...and only from a man who has actually LAID EYES on something in the last two seconds. deliver()
          // stamps every man's lastSeenT when a call lands on him, so relaying on lastSeenT alone was a closed
          // loop: the call refreshed the belief, the fresh belief triggered the next call, and the squad's
          // picture stayed permanently "current" off no observation at all. That is what kept the still-clock
          // running — and therefore the grenade trigger armed — against a player nobody had seen for a minute.
          if (t - (m.lastVisT ?? -1e9) > 2) continue;
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
          this.report(_v, 'call', null, j);
          this.contactKind = 'heard';
          if (this.state === 'idle') this.enterAlert();
        }
      }

      // where the squad thinks you are, and which way it thinks you are facing
      // Even with eyes on, the squad manoeuvres against what the man watching you reports, not against your
      // transform. It is a metre or two of difference and it is the difference between a plan and a cheat.
      if (this.eyesOn) { this.aim.copy(seer && seer.lastSeenPlayer ? seer.lastSeenPlayer : p.position); this.faceA = Math.atan2(p.forward.z, p.forward.x); }
      else if (this.hasKnown) { this.aim.copy(this.lastKnown); this.faceA = Math.atan2(this.centroid.z - this.aim.z, this.centroid.x - this.aim.x); }
      else { this.aim.copy(this.centroid); this.faceA = 0; }
      this.aimEye.set(this.aim.x, this.aim.y + 1.55, this.aim.z);

      // combat clock, morale recovery, end of contact
      if (this.inCombat) {
        this.combatT += dt;
        if (awareMax < 0.15 && t - this.lastKnownT > lerp(28, 50, this.skill) && this.state !== 'ambush' && this.state !== 'breakoff') this.standDown();
      } else this.morale = Math.min(1, this.morale + dt * 0.02);

      // ---- the sweep ----
      // They have lost you and they have not given up. Rather than four men each hunting their own idea of
      // where you went, the squad puts them on line, one lane each, and walks the ground. The lanes are as
      // wide as the picture is vague (spread()), which is why a squad that only ever HEARD you covers a lot
      // of ground badly and a squad that watched you go covers a little ground well.
      // ...but not while the mind has a man walking round the thing the Explorer is standing behind. ANGLE is
      // the answer to exactly this situation, it is allowed up to twelve seconds to finish, and turning the
      // squad into a search line halfway through is how the tree wins.
      const angling = !!(this.mind.play && this.mind.play.id === 'ANGLE');
      if (this.state === 'combat' && !this.eyesOn && !angling && t - this.lastKnownT > 9 && this.hasKnown && this.org > 0.4 && this.morale > 0.5) {
        this.state = 'sweep'; this.roleT = 0; this.bounding = false; this.radioT = Math.max(this.radioT, 6);
      } else if (this.state === 'sweep' && (this.eyesOn || t - this.lastKnownT < 3)) this.enterCombat();
      // nerve: a squad cut in half falls back and sets an ambush; a squad that has lost its nerve leaves
      if ((this.state === 'combat' || this.state === 'sweep') && this.combatT > 5) {
        if (this.morale <= BREAK_MORALE && this.initial >= 2) this.beginBreakoff();
        else if (!this.regrouped && this.initial >= 3 && alive * 2 <= this.initial) this.beginRegroup();
      }
      // THE THIRD FAIRNESS LEAK, CLOSED.
      // This used to spring the whole squad on the player's TRUE distance — `minD < SPRING_R` — whether or not
      // a single one of them could see him, hear him or had been told about him. Now each man's own hide
      // decides (ambush.js: range AND exposure AND his back turned, or three metres, or a round in the vest,
      // or a call from a mate that traces back to somebody's eyes), and when the FIRST of them springs the
      // rest come out with him. They still come out together; they come out on one man's eyes.
      {
        let sprung = null, stillDown = 0;
        for (const m of this.members) {
          if (!m.alive || !m.hide || m.hide.state === 'off') continue;
          const st = m.hide.state;
          if (st === 'tell' || st === 'rise' || st === 'out') { if (!sprung) sprung = m; }
          else if (st === 'set' || st === 'hold') stillDown++;
        }
        if (sprung) {
          this.planted = false;
          if (sprung.lastSeenPlayer) this.know(sprung.lastSeenPlayer, t, sprung.beliefR || 0);
          if (stillDown) for (const m of this.members) {
            if (!m.alive || m === sprung || !ambush.isHidden(m)) continue;
            ambush.forceSpring(m, 'squad');
            // and what the sprung man has goes over the net as a call, with his own error still on it
            if (sprung.lastSeenPlayer) ambush.onCall(m, sprung.lastSeenPlayer.x, sprung.lastSeenPlayer.z);
            if (m.orders) { m.orders.role = 'base'; m.orders.job = 'point'; m.orders.fire = true; m.orders.hold = true; }
          }
          if (this.state === 'ambush') this.enterCombat();
        } else if (this.state === 'ambush' && !this.planted && t - this.lastKnownT > AMBUSH_MAX) this.standDown(true);
      }
      if (this.state === 'breakoff') this.breakoffTick(dt, alive);

      // bounding clock: the elements swap while the squad is closing
      if (this.bounding) {
        this.boundT -= dt;
        if (this.boundT <= 0) { this.boundT = lerp(6.5, 3.5, this.skill); this.movingElement = (this.movingElement + 1) % (this.groups || 2); this.roleT = 0; this.radioT = Math.min(this.radioT, 0.6); }
        // a man who has reached his cover is down and firing again; he does not wait for the next order
        for (const m of this.members) {
          const o = m.orders; if (!o || !m.alive) continue;
          if (!o.hasTarget && o.element === this.movingElement && (o.job === 'point' || o.job === 'support')) {
            o.role = 'base'; o.fire = true; o.hold = true;
            if (o.saidMove === 1) { o.saidMove = 0; this.say('set', m, 0.8); }
          }
        }
      }
      // ---- the grenade the squad decides on, not the man ----
      // You are in a hole they cannot shoot into. Walking in after you is how they lose two men, so they do
      // the other thing: the leader picks whoever is best placed and posts one in. The order is a call on the
      // radio and the throw is a second behind it, so the frag is always something you were told about first.
      if (this.state === 'combat' && this.grenadeT <= 0 && this.org > 0.5 && this.leader && this.shaken <= 0 && !p.dead && !p.inBase) {
        const held = this.mind.picture.stillT * lerp(1, 1.8, zoneSk);
        const stuck = this.fixing === 0 && t - this.lastKnownT < 9 && this.hasKnown;
        if (held > lerp(9, 4, this.skill) && (stuck || (this.combatT > 12 && this.morale < 0.8))) {
          let best = null, bs = -1;
          for (const m of this.members) {
            if (!m.alive || m.grenades <= 0 || m.stalker || m.stunned > 0 || !m.orders) continue;
            if (m.orders.frag > t) { best = null; break; }
            if (m.orders.mv === 1) continue;                 // he is crossing; his hands are full
            const dd = m.position.distanceTo(this.aim);
            if (dd < 7 || dd > 28) continue;
            const s = 30 - Math.abs(dd - 16) - (m.orders.job === 'flanker' ? 12 : 0) + (m.orders.fire ? 6 : 0);
            if (s > bs) { bs = s; best = m; }
          }
          if (best) {
            best.orders.frag = t + 1.05;               // the mimic reads this and pulls the pin when it passes
            this.grenadeT = GRENADE_CD * lerp(1.1, 0.55, this.skill);
            this.fragOrders++;
            this.say('grenade', best);
          }
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
        for (const m of this.members) { if (!m.alive || m.stalker || ambush.isHidden(m) || m.position.distanceTo(p.position) > 95) continue; if (rng() < 1 / ++n) talker = m; }
        // the last un-worded transmission in the project. A rate is not a word: voices.js re-randomises the
        // syllable count and the pitch on every play, so an ad-hoc `rate:` is noise that drowns out the
        // nineteen words the player is supposed to be learning. Squad chatter is a status word or nothing.
        if (talker) this.say(this.inCombat ? 'update' : 'heard', talker, this.inCombat ? 0.7 : 0.55);
      }
      // the Explorer's own sheet: a chevron where a group was seen
      this.sightT -= dt;
      if (this.sightT <= 0) { this.sightT = 2; if (minD < 140) { for (const m of this.members) { if (m.alive && m.observed) { markSighting(this.centroid, alive, t); break; } } } }
    }

    // Each round the Explorer fires, counted EXACTLY ONCE per squad and only when it was actually audible from
    // where the squad is standing. This is what feeds read.mag — how many rounds he lets go at a time — and
    // the gate is at consumption, so a suppressed weapon still teaches them nothing at all.
    hearShots(t) {
      const dir = ctx.director; if (!dir || !dir.shotCount) return;
      const n = dir.shotCount();
      if (this.shotCursor < 0) { this.shotCursor = n; return; }
      if (n === this.shotCursor) return;
      const first = Math.max(this.shotCursor, n - 24);
      for (let i = first; i < n; i++) {
        const sh = dir.shotAt(i); if (!sh) continue;
        this.mind.observe('shot', { x: sh.x, z: sh.z, noise: sh.noise });
      }
      this.shotCursor = n;
    }

    // ---- falling back ----
    beginRegroup() {
      this.state = 'regroup'; this.regrouped = true; this.ambushT = 0; this.radioT = 0.2; this.bounding = false;
      // the farthest cover out of the player's view; at a higher standing they pick it on your likely path in
      const A = this.aim, sk = this.skill;
      const c = bestCover(this.centroid, 75, (c, dm) => {
        const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 22) return null;
        if (this.mind.frustum(c.x, c.z, 60)) return null;    // the BELIEF cone, not the camera
        let s = dp * 0.5 - dm * 0.15;
        if (this.poi) s += (1 - clamp01(Math.hypot(c.x - this.poi.x, c.z - this.poi.z) / (this.poi.r + 30))) * 30 * sk;
        // A field between them and you is a wall you have to walk round and they do not. They know where the
        // fields are; whether you do is your problem.
        if (anomalyOnLine(A.x, A.z, c.x, c.z, 3)) s += 45 * sk;
        return s;
      }, false, 1.2, this.aimEye);
      // A doorway is better than a hedge: if the structures agent has put an interior standing place inside
      // this POI, and it is away from you, the squad falls back into the building rather than into open ground.
      let inside = null;
      if (this.poi && sk > 0.3) {
        const spots = ctx.world.spawnSpots;
        let bd = -1;
        for (let i = 0; i < spots.length; i++) {
          const sp = spots[i]; if (sp.poi !== this.poi.id || sp.kind !== 'interior') continue;
          const q = sp.position;
          const dp = Math.hypot(q.x - A.x, q.z - A.z), dm = Math.hypot(q.x - this.centroid.x, q.z - this.centroid.z);
          if (dp < 25 || dm > 70) continue;
          const sc = dp * 0.4 - dm * 0.2;
          if (sc > bd) { bd = sc; inside = q; }
        }
      }
      if (inside) this.retreat.copy(inside);
      else if (c) this.retreat.copy(c);
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
      // a line of retreat with a field across it is worth two more men: try those first
      let got = false;
      for (let pass = 0; pass < 2 && !got; pass++) {
        for (const r of [80, 62, 45, 30]) {
          const a = Math.atan2(_dir.z, _dir.x) + rng.range(-0.6, 0.6);
          const rx = this.centroid.x + Math.cos(a) * r, rz = this.centroid.z + Math.sin(a) * r;
          if (pass === 0 && !anomalyOnLine(A.x, A.z, rx, rz, 3)) continue;
          if (walkable(rx, rz, this.retreat)) { got = true; break; }
        }
      }
      if (!got) this.retreat.copy(this.centroid).addScaledVector(_dir, 25);
      this.spreadOnto(this.retreat, 'breakoff', 4);
      this.say('falling', this.members.find((x) => x.alive) || null);
    }
    breakoffTick(dt, alive) {
      this.breakT += dt;
      const clear = this.centroid.distanceTo(this.aim) > 55 || this.centroid.distanceTo(this.retreat) < 8;
      if ((clear && ctx.elapsed - this.lastKnownT > 8) || this.breakT > 45) this.standDown(true);
    }
    // Line abreast onto the last known position: each man takes one lane, the lanes as wide as the picture is
    // vague, the whole line walking in from the side the squad is already on. Nobody says anything.
    orderSweep(alive) {
      const A = this.aim, w = Math.max(7, Math.min(18, 7 + this.spread() * 0.7));
      const base = Math.atan2(A.z - this.centroid.z, A.x - this.centroid.x);
      const px = -Math.sin(base), pz = Math.cos(base);
      const men = this.members.filter((m) => m.alive && m.orders);
      const n = Math.max(1, men.length);
      for (let i = 0; i < men.length; i++) {
        const m = men[i], o = m.orders;
        const off = (i - (n - 1) / 2) * w;
        const reach = clamp(Math.hypot(A.x - m.position.x, A.z - m.position.z) - 4, 3, 45);
        o.job = 'sweep'; o.role = 'base'; o.fire = true; o.hold = false; o.at = false; o.mv = 0; o.hasSector = false;
        const tx = A.x + px * off, tz = A.z + pz * off;
        if (walkable(tx, tz, o.target)) o.hasTarget = true;
        else if (walkable(m.position.x + Math.cos(base) * Math.min(reach, 12) + px * off * 0.4, m.position.z + Math.sin(base) * Math.min(reach, 12) + pz * off * 0.4, o.target)) o.hasTarget = true;
        else o.hasTarget = false;
      }
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
          for (const m of this.members) if (m.alive && m.orders) {
            const o = m.orders; o.job = 'ambush'; o.role = 'ambush'; o.hold = true; o.fire = false; o.hasTarget = false;
            // they go silent for real: the static bed stops, the handset goes dead, nobody moves again
            ambush.beginHide(m, ctx, A.x, A.z);
          }
        }
        this.ambushT += this.roleT;
        return;
      }
      if (this.state === 'ambush') {
        for (const m of this.members) if (m.alive && m.orders) { m.orders.job = 'ambush'; m.orders.role = 'ambush'; m.orders.hold = true; }
        return;
      }
      if (this.state === 'sweep') { this.orderSweep(alive); return; }
      // No picture, no plan. In the second between the first man seeing you and his call landing, the squad
      // has nothing to manoeuvre against and does not pretend otherwise — he fights, the rest wait for it.
      if (!this.hasKnown && !this.eyesOn) return;
      const members = [];
      for (const m of this.members) if (m.alive && m.stunned <= 0) members.push(m);
      if (!members.length) return;
      for (const m of members) m._dA = Math.hypot(m.position.x - A.x, m.position.z - A.z);
      members.sort((a, b) => a._dA - b._dA);

      // The three seconds after their own grenade goes off. They do not stand and watch the smoke: the base
      // element comes forward at half its usual range while you are still deaf, which is what makes the call
      // before the throw worth listening for. orderHold reads this.
      const t = ctx.elapsed;
      this.assault = t > this.assaultT && t < this.assaultT + 4.5 && this.org > 0.5;
      // A man holds his arc for as long as the bound he is covering lasts, not until the next re-plan.
      for (const m of members) if (m.orders && t - (m.orders.sectorAt || -1e9) > 6) { m.orders.hasSector = false; m.orders.covering = null; }

      // ---- THE MIND CHOOSES ----
      // One named play — HOLD, ANGLE, HUNT, PROBE, FLANK, PIN, PUSH, CUT, BAIT, WITHDRAW — scored once on
      // eight arithmetic terms and then HELD for its commitment window. Availability is hard-gated by the
      // command tier (a squad with no leader gets single-seat plays only; the ten seconds after you kill him
      // it gets none at all) and by director.escalation, which decides what the ZONE is willing to do; the
      // preference between the available ones is soft-gated by the leader's own skill, so a day-one squad has
      // three ideas and picks the dull one and an elite squad lets geometry decide. It lays the seats, fills
      // them by fitness — with a churn penalty that is what stops the shuffling — announces a manoeuvre
      // 0.6 s before its man steps off, and re-solves at most two positions a tick through this same round
      // robin. Every solver it calls is one of the fifteen below, unchanged.
      const play = this.mind.tick(this.roleT, members);
      this.flankers = this.mind.moverSeats();
      this.bounding = false;
      if (!play) return;

      // ---- and a bound nobody can cover is still refused ----
      // The mind hands a man somewhere to be. This is the check that says whether the ground between here and
      // there is watched by somebody standing still with a line onto it — and hands THAT man the lane as a
      // SECTOR, which he faces and puts rounds into while his mate runs (mimic.js wantCover). Below a green
      // squad's standing they cross anyway and die doing it, which is why a good squad advances in rushes and
      // a bad one dies in the open.
      // Anything over ten metres in contact is a bound whatever the seat is called: a man walking that far in
      // the open needs somebody's rounds on the ground ahead of him. Under six metres is a shuffle between
      // rocks and does not.
      for (const m of members) {
        const o = m.orders; if (!o || !o.hasTarget) continue;
        const cross = Math.hypot(o.target.x - m.position.x, o.target.z - m.position.z);
        if (cross < (o.hold ? 10 : 6)) { if (o.mv === 1) o.mv = 0; continue; }
        o.mv = 1;
        if (this.coverBound(m, o)) {
          if (o.saidMove !== 1) { o.saidMove = 1; this.say('moving', m, 0.85); }
        } else if (sk >= 0.25 && members.length >= 2) {
          // Nobody can watch that ground. He does not cross it: he stays where he is and keeps shooting, and
          // the squad re-solves him next tick. That is why a good squad advances in rushes and a bad one dies
          // in the open — below a green squad's standing (sk < 0.25) he goes anyway.
          this.boundsRefused++;
          o.mv = 2; o.saidMove = 0; o.hasTarget = false;
        }
      }
    }

    // Is the ground this man is about to cross covered by somebody? Finds a stationary member with a line onto
    // the middle of the lane, hands HIM that arc as a sector (so he faces it, and puts rounds down it when he
    // cannot see the player), and returns whether the bound may go ahead. Three rays at most.
    coverBound(mover, o) {
      if (!o.hasTarget) return false;
      const w = ctx.world;
      _lane.set((mover.position.x + o.target.x) * 0.5, 0, (mover.position.z + o.target.z) * 0.5);
      _lane.y = w.groundHeight(_lane.x, _lane.z, mover.position.y + 3).y;   // ground: consumers add their own height
      let tried = 0;
      for (const c of this.members) {
        if (!c.alive || c === mover || !c.orders) continue;
        const j = c.orders.job;
        if (j !== 'point' && j !== 'support' && j !== 'overwatch') continue;
        if (c.orders.mv === 1) continue;                      // he is crossing too; he covers nobody
        if (c.position.distanceTo(_lane) > 80) continue;
        if (tried++ >= 3) break;
        _v3.set(_lane.x, _lane.y + 1.1, _lane.z);
        if (!w.lineOfSight(_from.set(c.position.x, c.position.y + 1.5, c.position.z), _v3)) continue;
        o.covering = c;
        c.orders.sector.copy(_lane); c.orders.hasSector = true; c.orders.sectorAt = ctx.elapsed;
        this.bounds++;
        return true;
      }
      return false;
    }

    // base of fire: cover with a line of sight onto the called position, at the band this man's gun likes
    orderHold(m, o, forward) {
      const A = this.aim, hold = m.profile ? m.profile.hold : [8, 30];
      o.role = 'base'; o.fire = true; o.hold = true;
      if (m.role === 'sniper') { o.hasTarget = false; return; }   // the marksman keeps his own range
      const k = this.assault ? 0.55 : 1;   // straight after their own grenade they fight from half the range
      const near = (forward ? Math.max(7, hold[0] * 0.7) : Math.max(10, hold[0])) * k;
      const far = (forward ? Math.min(40, Math.max(20, hold[1] * 0.8)) : Math.max(24, Math.min(60, hold[1]))) * k;
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
        if (anomalyOnLine(m.position.x, m.position.z, c.x, c.z)) return null;   // not through the field
        return -Math.abs(dp - want) * 0.14 - dm * 0.05;
      }, null);
      if (c) { o.target.copy(c); o.hasTarget = true; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); return; }
      _dir.set(A.x - m.position.x, 0, A.z - m.position.z);
      const l = Math.hypot(_dir.x, _dir.z) || 1;
      const step = clamp(dA - want, 4, 16);
      if (walkable(m.position.x + (_dir.x / l) * step, m.position.z + (_dir.z / l) * step, o.target)) o.hasTarget = true;
      else o.hasTarget = false;
    }
    // The zone's cover registry has almost no height in it — three elevated cover points in the whole map —
    // so the high ground has to come from the terrain itself. Sample the ring at overwatch range and take the
    // bank, spoil heap or ridge that actually looks down on the called position. Nine height lookups and one
    // ray, once per role tick, for one man.
    highGround(m, o) {
      const A = this.aim, w = ctx.world;
      if (!this._hg) this._hg = new THREE.Vector3();
      const ma = Math.atan2(m.position.z - A.z, m.position.x - A.x);
      let bs = 2.0, got = false;
      for (let i = 0; i < 9; i++) {
        const a = ma + (i - 4) * 17 * DEG, r = 30 + (i % 3) * 9;
        const x = A.x + Math.cos(a) * r, z = A.z + Math.sin(a) * r;
        if (w.getHeight(x, z) - A.y < bs) continue;
        if (!walkable(x, z, _v2)) continue;
        bs = _v2.y - A.y; this._hg.copy(_v2); got = true;
      }
      if (!got) return false;
      if (!ctx.world.lineOfSight(_v.set(this._hg.x, this._hg.y + 1.6, this._hg.z), this.aimEye)) return false;
      o.target.copy(this._hg); o.hasTarget = true; o.at = false;
      if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(this._hg);
      return true;
    }
    // overwatch: 28-52 m back with a view of the ground, silent unless it is coming for him
    orderOverwatch(m, o) {
      const A = this.aim;
      // the marksman held back is held back to shoot: everyone else on overwatch stays quiet until pressed
      o.role = 'watch'; o.fire = m.role === 'sniper' || (m.profile && m.profile.kind === 'sniper'); o.hold = true;
      if (m._dA > 26 && m._dA < 54 && m.cover && m.position.distanceTo(m.cover) < 2) { o.target.copy(m.cover); o.hasTarget = true; o.at = true; return; }
      if (this.skill > 0.25 && this.highGround(m, o)) return;   // a bank above you beats a rock beside you
      // height first: a man on a roof or a bank sees over what you are hiding behind, and shooting back up at
      // him costs you the cover you are using. Two metres up is worth ten metres of range.
      const c = bestCover(m.position, 40, (c, dm) => { const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 28 || dp > 52) return null; return -dm * 0.1 - Math.abs(dp - 40) * 0.05 + clamp(c.y - A.y, 0, 6) * 2.2; }, true, 1.6, this.aimEye)
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
      const there = Math.abs(dA) < 26 * DEG && m._dA < 30 && m._dA > 5;
      if (there) {
        // On the arc. He is a flanker in position from this moment, whether or not he shuffles a few metres
        // onto a better rock — `at` is what the squad counts, and what says the manoeuvre worked.
        o.role = 'flank'; o.fire = true; o.hold = true;
        if (!o.at) { o.at = true; o.arrivedT = ctx.elapsed; this.flankSet = true; this.say('set', m, 0.9); }
        if (m.cover && m.position.distanceTo(m.cover) < 2) { o.target.copy(m.cover); o.hasTarget = true; return; }
        const c = bestCover(m.position, 13, (c, dm) => {
          const dp = Math.hypot(c.x - A.x, c.z - A.z); if (dp < 5 || dp > 28) return null;
          const ca = Math.atan2(c.z - A.z, c.x - A.x);
          return -Math.abs(angleDelta(ca, ta)) * 4 - dm * 0.1;
        }, true, 1.5, this.aimEye);
        if (c) { o.target.copy(c); o.hasTarget = true; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); }
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
        if (this.mind.frustum(c.x, c.z, 50)) return null;    // the whole chain stays out of where they BELIEVE he can see
        if (anomalyOnLine(m.position.x, m.position.z, c.x, c.z)) return null;
        return gain * 5 - Math.abs(dp - ringD) * 0.1 - dm * 0.05;
      }, null);
      if (c) { o.target.copy(c); o.hasTarget = true; return; }
      const step = Math.sign(dA || 1) * Math.min(35 * DEG, Math.abs(dA));
      const na = ma + step, r = clamp(m._dA, 12, 22);
      if (walkable(A.x + Math.cos(na) * r, A.z + Math.sin(na) * r, o.target) && !this.mind.frustum(o.target.x, o.target.z, 50)) { o.hasTarget = true; return; }
      // In view everywhere — open ground, and you are looking straight down it. Rather than stand still for
      // the rest of the fight he takes the LONG way: the same bearing at a range where being seen costs him
      // very little, and closes back in once he is round the side. It is slow, and you can hear him go.
      const sgn = Math.sign(dA || 1);
      for (let k = 0; k < 6; k++) {
        const far = clamp(m._dA + 20 - (k % 3) * 9, 26, 68);
        const swing = ma + sgn * (46 - (k >> 1) * 13) * DEG;
        if (!walkable(A.x + Math.cos(swing) * far, A.z + Math.sin(swing) * far, o.target)) continue;
        if (anomalyOnLine(m.position.x, m.position.z, o.target.x, o.target.z)) continue;
        o.hasTarget = true; o.hold = false; return;
      }
      o.hasTarget = false; o.hold = true;   // nowhere at all: wait; a skip will carry him when you look away
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
      // an order from the squad outranks the cooldown it just set for itself
      if (m.orders && m.orders.frag > 0 && ctx.elapsed >= m.orders.frag && ctx.elapsed < m.orders.frag + 8) return true;
      return s.grenadeT <= 0;
    },
    throwGrenade(m, from, target, grenadeId) {
      const gdef = def(grenadeId) || { fuse: 3.5, radius: 7, damage: 110 };
      const cd = GRENADE_CD * lerp(1.1, 0.55, zoneSk);
      // the frag is not the end of the exchange, it is the start of the assault: they come in behind it
      if (m.squad) { m.squad.grenadeT = cd; m.squad.assaultT = ctx.elapsed + (gdef.fuse || 3.5) + 0.4; } else m.grenadeCool = cd;
      return throwGrenade(m, from, target, gdef);
    },
    reset() {
      for (const s of list) for (const m of s.members) m.squad = null;
      list.length = 0;
      for (const g of grenades) { ctx.scene.remove(g.mesh); if (g.hiss) g.hiss.stop(0.05); }
      grenades.length = 0; sightings.length = 0; grid = null; gridLen = -1;
    },
    update(dt) {
      if (dt <= 0) return;
      refreshCam();
      jobBudget = 2;
      zoneSkT -= dt; if (zoneSkT <= 0) { zoneSkT = 3; zoneSk = zoneSkill(); }
      // smoke clouds, flares, thrown projectiles and the flash the Explorer is still blinking through
      kit.kitFrame(ctx, dt);
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
