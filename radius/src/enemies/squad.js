// Squads. A mimic alone is a sentry; a squad is a plan. createSquads(ctx) is built lazily by population.js and
// exposed as ctx.squads. Each squad keeps shared knowledge (last known player position from any member's eyes or
// from shots heard), reassigns roles every 3 s (base of fire, flankers along cover chains outside the player's
// view, a watcher that holds back and reports), regroups into an ambush when it loses half, calls the nearest
// other squad after 30 s of combat, talks over the radio more when it moves, and owns the grenade projectiles so
// a thrown grenade outlives the thrower. All expensive queries (cover scoring, frustum tests) run here, once per
// squad per tick, never per member per frame.
import * as THREE from 'three';
import { clamp, clamp01, angleDelta, damp, DEG, TAU } from '../core/math.js';
import { classRank } from './loadout.js';
import { def } from '../data/index.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _eye = new THREE.Vector3(), _n = new THREE.Vector3();
const ROLE_T = 3.0, REINFORCE_AFTER = 30, REINFORCE_R = 150, GRENADE_CD = 40, CONVERGE_R = 120, FLANK_ANGLE = 70 * DEG;
const ROLE_PRIORITY = { sniper: 'base', gunner: 'base', breacher: 'flank' };
const cand = [];   // scratch list for cover scoring: [{ c, score }] reused

// play the first registered name from a list (v2 sounds land in parallel; older names stay as fallbacks)
export function playAny(ctx, names, opts) {
  const a = ctx.audio; if (!a) return null;
  for (const n of names) { if (!a.has || a.has(n)) return a.play(n, opts); }
  return null;
}

export function createSquads(ctx) {
  const list = [], grenades = [];
  const rng = ctx.rng.fork(59);
  let nextId = 1;
  const hold = { anchor: new THREE.Vector3(), t: 0, init: false };
  let grenadeGeo = null, grenadeMat = null;

  // ---- view tests (player camera frustum + line of sight), shared by every consumer ----
  function inFrustum(x, y, z, halfAngleDeg = 55) {
    ctx.camera.getWorldDirection(_dir);
    _v.set(x, y, z).sub(ctx.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    return _dir.dot(_v) >= Math.cos(halfAngleDeg * DEG);
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
  const playerEye = () => _eye.copy(ctx.player.eye);
  // score cover points near `from`, then test line of sight on the best few only
  function bestCover(from, maxD, score, needLos, losFrom = 1.5) {
    cand.length = 0;
    const cps = ctx.world.coverPoints;
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      const dm = Math.hypot(c.x - from.x, c.z - from.z); if (dm > maxD) continue;
      const s = score(c, dm); if (s === null || s === -Infinity) continue;
      cand.push({ c, s });
    }
    cand.sort((a, b) => b.s - a.s);
    const eye = playerEye();
    const n = Math.min(cand.length, 6);
    for (let i = 0; i < n; i++) {
      const c = cand[i].c;
      if (needLos === null) return c;
      const los = ctx.world.lineOfSight(_v.set(c.x, c.y + losFrom, c.z), eye);
      if (los === needLos) return c;
    }
    return null;
  }

  class Squad {
    constructor(members, poi) {
      this.id = nextId++; this.poi = poi || null; this.members = [];
      this.state = 'idle';            // idle | combat | regroup | ambush
      this.lastKnown = new THREE.Vector3(); this.lastKnownT = -1e9; this.hasKnown = false;
      this.combatT = 0; this.roleT = 0; this.grenadeT = 0; this.radioT = rng.range(6, 14); this.reinforceCalled = false;
      this.retreat = new THREE.Vector3(); this.ambushT = 0; this.centroid = new THREE.Vector3();
      this.initial = 0; this.moving = 0; this.baseCount = 0; this.regrouped = false;
      for (const m of members) this.add(m);
      this.initial = this.members.length;
    }
    add(m) {
      if (!m || this.members.includes(m)) return;
      if (m.squad && m.squad !== this) m.squad.remove(m);
      m.squad = this; this.members.push(m); this.initial = Math.max(this.initial, this.members.length);
      if (!m.orders) m.orders = { role: 'idle', target: new THREE.Vector3(), hasTarget: false, fire: false, hold: false, at: false, side: 0, arrivedT: 0, flankAng: 0 };
    }
    remove(m) { const i = this.members.indexOf(m); if (i >= 0) this.members.splice(i, 1); if (m.squad === this) m.squad = null; }
    get alive() { let n = 0; for (const m of this.members) if (m.alive) n++; return n; }
    get leader() { let best = null; for (const m of this.members) if (m.alive && (!best || classRank(m.cls) > classRank(best.cls))) best = m; return best; }
    get inCombat() { return this.state === 'combat' || this.state === 'regroup' || this.state === 'ambush'; }
    // shared knowledge: anyone's sighting, anyone's hit, shots heard
    know(pos, t) { if (t <= this.lastKnownT) return; this.lastKnown.copy(pos); this.lastKnownT = t; this.hasKnown = true; }
    notify(kind, m) {
      const t = ctx.elapsed;
      if (kind === 'spotted' || kind === 'hit') { this.know(ctx.player.position, t); if (this.state === 'idle') this.enterCombat(); }
      if (kind === 'killed') { if (this.state === 'idle') { this.know(ctx.player.position, t); this.enterCombat(); } this.roleT = 0; }
    }
    enterCombat() { this.state = 'combat'; this.combatT = 0; this.roleT = 0; this.radioT = 0.3; }
    // members converge on the last known position within 120 m: they become suspicious of it
    converge() {
      for (const m of this.members) {
        if (!m.alive || m.aware >= 0.6 || m.stunned > 0) continue;
        if (m.position.distanceTo(this.lastKnown) > CONVERGE_R) continue;
        m.aware = Math.max(m.aware, 0.6);
        if (!m.lastSeenPlayer) m.lastSeenPlayer = new THREE.Vector3();
        m.lastSeenPlayer.copy(this.lastKnown); m.lastSeenT = this.lastKnownT;
      }
    }
    update(dt) {
      const t = ctx.elapsed, p = ctx.player;
      // prune the dead from the roster (they keep their orders object for the death tick, nothing else)
      let alive = 0; this.centroid.set(0, 0, 0); this.moving = 0;
      for (const m of this.members) { if (!m.alive) continue; alive++; this.centroid.add(m.position); if (m.moveSpeed > 0.5) this.moving++; }
      if (alive === 0) return;
      this.centroid.divideScalar(alive);
      // knowledge from members' own eyes and from gunfire
      let awareMax = 0;
      for (const m of this.members) {
        if (!m.alive) continue;
        awareMax = Math.max(awareMax, m.aware);
        if (m.lastSeenPlayer && m.lastSeenT > this.lastKnownT && m.aware > 0.5) this.know(m.lastSeenPlayer, m.lastSeenT);
      }
      if (ctx.director && this.roleT < 0.2) { const s = ctx.director.recentShotAt(this.centroid, CONVERGE_R); if (s > 0.05 && !p.inBase) { this.know(p.position, t); if (this.state === 'idle') this.enterCombat(); } }
      if (this.state !== 'idle') this.converge();
      // combat clock and end of contact
      if (this.inCombat) {
        this.combatT += dt;
        if (awareMax < 0.15 && t - this.lastKnownT > 40 && this.state !== 'ambush') { this.state = 'idle'; this.combatT = 0; this.reinforceCalled = false; this.regrouped = false; for (const m of this.members) if (m.orders) { m.orders.role = 'idle'; m.orders.hasTarget = false; m.orders.fire = false; } }
      }
      this.grenadeT = Math.max(0, this.grenadeT - dt);
      // regroup when the squad has lost half of what it started with (and there are still two to regroup)
      if (this.state === 'combat' && !this.regrouped && this.initial >= 3 && alive * 2 <= this.initial && alive >= 1) this.beginRegroup();
      // roles every 3 s
      this.roleT -= dt;
      if (this.roleT <= 0) { this.roleT = ROLE_T; if (this.inCombat) this.assignRoles(alive); }
      // reinforcements: after 30 s of combat the nearest other squad within 150 m comes
      if (this.inCombat && this.combatT > REINFORCE_AFTER && !this.reinforceCalled) {
        this.reinforceCalled = true;
        const other = api.nearest(this.centroid, REINFORCE_R, (s) => s !== this && !s.inCombat && s.alive > 0);
        if (other) { other.know(this.lastKnown, t); other.enterCombat(); other.converge(); other.radioT = 0.2; }
      }
      // radio: bursts, more when moving; silent in ambush
      this.radioT -= dt;
      if (this.radioT <= 0) {
        this.radioT = this.state === 'ambush' ? 1e9 : this.inCombat ? (this.moving > 0 ? rng.range(2.5, 5) : rng.range(5, 9)) : (this.moving > 0 ? rng.range(6, 12) : rng.range(12, 24));
        const talkers = []; for (const m of this.members) if (m.alive && m.position.distanceTo(p.position) < 90 && !m.stalker) talkers.push(m);
        if (talkers.length) { const m = talkers[Math.floor(rng() * talkers.length)]; m.sound('mimic_radio', { gain: this.inCombat ? 0.7 : 0.45, max: 85, rate: 0.92 + rng() * 0.16 }); }
      }
    }
    beginRegroup() {
      this.state = 'regroup'; this.regrouped = true; this.ambushT = 0; this.radioT = 0.2;
      // the farthest cover out of the player's view within reach of the squad
      const p = ctx.player.position;
      const c = bestCover(this.centroid, 70, (c, dm) => { const dp = Math.hypot(c.x - p.x, c.z - p.z); if (dp < 22) return null; if (inFrustum(c.x, c.y + 0.9, c.z, 60)) return null; return dp * 0.5 - dm * 0.15; }, false, 1.2);
      if (c) this.retreat.copy(c);
      else { _dir.set(this.centroid.x - p.x, 0, this.centroid.z - p.z).normalize(); if (_dir.lengthSq() < 0.1) _dir.set(1, 0, 0); if (!walkable(p.x + _dir.x * 45, p.z + _dir.z * 45, this.retreat)) this.retreat.copy(this.centroid); }
      for (const m of this.members) if (m.alive && m.orders) { m.orders.role = 'regroup'; m.orders.target.copy(this.retreat); m.orders.hasTarget = true; m.orders.fire = false; m.orders.hold = false; m.orders.at = false; }
      this.roleT = ROLE_T;
    }
    assignRoles(alive) {
      const p = ctx.player, P = p.position;
      if (this.state === 'regroup') {
        // arrived: settle into the ambush
        let arrived = 0; for (const m of this.members) if (m.alive && m.position.distanceTo(this.retreat) < 4) arrived++;
        if (arrived >= alive || this.ambushT > 25) { this.state = 'ambush'; for (const m of this.members) if (m.alive && m.orders) { m.orders.role = 'ambush'; m.orders.hold = true; m.orders.fire = false; } }
        this.ambushT += ROLE_T;
        return;
      }
      if (this.state === 'ambush') {
        // wait silent; spring when the player comes within 15 m of anyone (the mimic itself opens fire on that test)
        for (const m of this.members) if (m.alive && m.orders) { m.orders.role = 'ambush'; m.orders.hold = true; }
        if (ctx.elapsed - this.lastKnownT > 120) this.state = 'idle';
        return;
      }
      // ---- combat: base of fire, flankers, watcher ----
      const members = []; for (const m of this.members) if (m.alive && m.stunned <= 0) members.push(m);
      if (!members.length) return;
      for (const m of members) m._dP = Math.hypot(m.position.x - P.x, m.position.z - P.z);
      members.sort((a, b) => a._dP - b._dP);
      // fixed preferences first: snipers and gunners are always base, breachers always flank
      const roles = new Map();
      for (const m of members) { const pref = ROLE_PRIORITY[m.role]; if (pref) roles.set(m, pref); }
      const free = members.filter((m) => !roles.has(m));
      const n = members.length;
      const wantWatch = n >= 3 && ![...roles.values()].includes('watch');
      let haveBase = [...roles.values()].includes('base');
      // nearest free member with a line of sight becomes the base; the farthest the watcher; the rest flank
      if (!haveBase && free.length) { let b = free.find((m) => m.aware >= 0.9) || free[0]; roles.set(b, 'base'); haveBase = true; }
      if (wantWatch) { const w = [...free].reverse().find((m) => !roles.has(m)); if (w) roles.set(w, 'watch'); }
      for (const m of free) if (!roles.has(m)) roles.set(m, n === 1 ? 'base' : 'flank');
      // hand out orders
      let flankSide = rng() < 0.5 ? 1 : -1;
      for (const [m, role] of roles) {
        const o = m.orders; if (!o) continue;
        const prev = o.role; o.role = role;
        if (role === 'base') this.orderBase(m, o);
        else if (role === 'flank') { if (prev !== 'flank' || o.side === 0) { o.side = flankSide; flankSide = -flankSide; o.arrivedT = 0; } this.orderFlank(m, o); }
        else if (role === 'watch') this.orderWatch(m, o);
      }
    }
    // base of fire: nearest cover with a line of sight to the player, 8-35 m out; hold and fire
    orderBase(m, o) {
      const P = ctx.player.position;
      o.fire = true; o.hold = true;
      // a sniper holds range; the mimic's own hold-range logic moves it, the squad only clears the target
      if (m.role === 'sniper') { o.hasTarget = false; return; }
      const dP = m._dP;
      // already at a good spot with a line of sight: stay
      if (m.cover && m.position.distanceTo(m.cover) < 1.5 && dP > 7 && dP < 40 && m.losT >= 0 && ctx.elapsed - m.losT < 2) { o.target.copy(m.cover); o.hasTarget = true; o.at = true; return; }
      const c = bestCover(m.position, 24, (c, dm) => { const dp = Math.hypot(c.x - P.x, c.z - P.z); if (dp < 7 || dp > 38 || dm < 1.0) return null; return -Math.abs(dp - 16) * 0.12 - dm * 0.06; }, true);
      if (c) { o.target.copy(c); o.hasTarget = true; o.at = false; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); }
      else o.hasTarget = false;
    }
    // watcher: 30-50 m back from the player, ideally where it can see; reports (radio) and becomes base when needed
    orderWatch(m, o) {
      const P = ctx.player.position;
      o.fire = false; o.hold = true;
      if (m._dP > 28 && m._dP < 52 && m.cover && m.position.distanceTo(m.cover) < 2) { o.target.copy(m.cover); o.hasTarget = true; o.at = true; return; }
      const c = bestCover(m.position, 40, (c, dm) => { const dp = Math.hypot(c.x - P.x, c.z - P.z); if (dp < 30 || dp > 50) return null; return -dm * 0.1 - Math.abs(dp - 40) * 0.05; }, true, 1.6)
        || bestCover(m.position, 40, (c, dm) => { const dp = Math.hypot(c.x - P.x, c.z - P.z); if (dp < 30 || dp > 50) return null; return -dm * 0.1; }, null);
      if (c) { o.target.copy(c); o.hasTarget = true; o.at = false; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); return; }
      _dir.set(m.position.x - P.x, 0, m.position.z - P.z); if (_dir.lengthSq() < 0.5) _dir.set(1, 0, 0); _dir.normalize();
      if (walkable(P.x + _dir.x * 40, P.z + _dir.z * 40, o.target)) { o.hasTarget = true; o.at = false; } else o.hasTarget = false;
    }
    // flanker: chain of cover points that are not in the player's view, walking around to the player's flank
    // (+-70 deg off their facing on this flanker's side); fires once it is there or if it is engaged on the way
    orderFlank(m, o) {
      const p = ctx.player, P = p.position;
      const fa = Math.atan2(p.forward.z, p.forward.x);
      const ta = fa + o.side * FLANK_ANGLE;              // world angle (around the player) of the flank position
      const ma = Math.atan2(m.position.z - P.z, m.position.x - P.x);
      const dA = angleDelta(ma, ta);
      o.flankAng = ta;
      const there = Math.abs(dA) < 22 * DEG && m._dP < 26 && m._dP > 5;
      if (there) {
        // at the flank: take cover with a line of sight and open up
        o.fire = true; o.hold = true; o.at = true;
        if (m.cover && m.position.distanceTo(m.cover) < 2) { o.target.copy(m.cover); o.hasTarget = true; return; }
        const c = bestCover(m.position, 12, (c, dm) => { const dp = Math.hypot(c.x - P.x, c.z - P.z); if (dp < 5 || dp > 26) return null; const ca = Math.atan2(c.z - P.z, c.x - P.x); return -Math.abs(angleDelta(ca, ta)) * 4 - dm * 0.1; }, true);
        if (c) { o.target.copy(c); o.hasTarget = true; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); o.at = false; }
        else o.hasTarget = false;
        return;
      }
      o.fire = false; o.hold = false; o.at = false;
      // next waypoint: a cover point out of the player's view that brings the angle closer to the flank and the
      // range toward 10-22 m, within 20 m of here
      const ringD = clamp(m._dP, 10, 22);
      const c = bestCover(m.position, 20, (c, dm) => {
        if (dm < 2.5) return null;
        const dp = Math.hypot(c.x - P.x, c.z - P.z); if (dp < 6 || dp > 45) return null;
        const ca = Math.atan2(c.z - P.z, c.x - P.x);
        const gain = Math.abs(dA) - Math.abs(angleDelta(ca, ta));   // radians of progress toward the flank
        if (gain < 6 * DEG && Math.abs(dp - ringD) >= Math.abs(m._dP - ringD) - 1) return null;
        if (inFrustum(c.x, c.y + 0.9, c.z, 50)) return null;         // the whole chain stays out of the player's view
        return gain * 5 - Math.abs(dp - ringD) * 0.1 - dm * 0.05;
      }, null);
      if (c) { o.target.copy(c); o.hasTarget = true; return; }
      // no cover: step around the ring out of view, 30 deg at a time
      const step = Math.sign(dA || 1) * Math.min(35 * DEG, Math.abs(dA));
      const na = ma + step, r = clamp(m._dP, 12, 20);
      if (walkable(P.x + Math.cos(na) * r, P.z + Math.sin(na) * r, o.target) && !inFrustum(o.target.x, o.target.y + 0.9, o.target.z, 50)) { o.hasTarget = true; return; }
      // in view everywhere: wait where it is (a skip will carry it once the player looks away)
      o.hasTarget = false; o.hold = true;
    }
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
    get playerHoldT() { return hold.t; },
    form(members, poi) {
      const ms = (members || []).filter((m) => m && m.type === 'mimic');
      const s = new Squad(ms, poi);
      list.push(s);
      return s;
    },
    squadOf(m) { return m.squad || null; },
    nearest(pos, maxD = Infinity, filter = null) { let best = null, bd = maxD; for (const s of list) { if (s.alive === 0 || (filter && !filter(s))) continue; const d = s.centroid.distanceTo(pos); if (d < bd) { bd = d; best = s; } } return best; },
    // a member wants to throw: squad cooldown (one per squad per 40 s; solo mimics use their own)
    canThrow(m) { const s = m.squad; if (s) return s.grenadeT <= 0; return (m.grenadeCool || 0) <= 0; },
    throwGrenade(m, from, target, grenadeId) {
      const gdef = def(grenadeId) || { fuse: 3.5, radius: 7, damage: 110 };
      if (m.squad) m.squad.grenadeT = GRENADE_CD; else m.grenadeCool = GRENADE_CD;
      return throwGrenade(m, from, target, gdef);
    },
    reset() { for (const s of list) for (const m of s.members) m.squad = null; list.length = 0; for (const g of grenades) { ctx.scene.remove(g.mesh); if (g.hiss) g.hiss.stop(0.05); } grenades.length = 0; hold.init = false; hold.t = 0; },
    update(dt) {
      if (dt <= 0) return;
      // how long has the player held one spot? (grenade trigger)
      const p = ctx.player.position;
      if (!hold.init || hold.anchor.distanceTo(p) > 2.5) { hold.anchor.copy(p); hold.t = 0; hold.init = true; } else hold.t += dt;
      for (let i = list.length - 1; i >= 0; i--) { const s = list[i]; if (s.alive === 0 && s.members.every((m) => !m.alive)) { for (const m of s.members) m.squad = null; list.splice(i, 1); continue; } s.update(dt); }
      for (let i = grenades.length - 1; i >= 0; i--) { if (stepGrenade(grenades[i], Math.min(dt, 0.05))) grenades.splice(i, 1); }
    },
  };
  ctx.events.on('gameStart', () => api.reset());
  ctx.events.on('tide', () => api.reset());
  return api;
}
