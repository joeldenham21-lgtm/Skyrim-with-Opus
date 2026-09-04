// Enemy base class + manager. Every entity type extends Enemy and registers with enemies.registerType.
// The base handles: ground following, awareness (see/hear the player), steering with obstacle avoidance,
// hit testing, damage/death bookkeeping, positional sound, and distance-based update throttling.
import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3();

export class Enemy {
  constructor(ctx, type, position, opts = {}) {
    this.ctx = ctx; this.type = type; this.opts = opts;
    this.position = position.clone();
    this.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    this.hp = opts.hp ?? 100; this.maxHp = this.hp;
    this.alive = true; this.dead = false; this.removeMe = false;
    this.aware = 0;            // 0..1: 0 idle, >0.4 suspicious, >=1 engaged
    this.state = 'idle';
    this.stateT = 0;
    this.radius = 0.4; this.height = 1.8;   // hit capsule
    this.speed = 2.0;
    this.poi = opts.poi || null;
    this.home = position.clone();
    this.lastSeenPlayer = null;   // Vector3 of last known player position
    this.lastSeenT = -1e9;
    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    this.ctx.scene.add(this.root);
    this.deathT = 0;
    this.sounds = new Set();   // loop handles to stop on dispose
    this.groundY = position.y;
    this.flying = false;
    this.throttle = 0;
  }
  get playerPos() { return this.ctx.player.position; }
  get player() { return this.ctx.player; }
  get time() { return this.ctx.elapsed; }
  distanceToPlayer() { return this.position.distanceTo(this.player.position); }
  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; this.onStateChange?.(s); } }

  // ---- perception ----
  // 0..1 visibility of the player from this entity's eyes, considering distance, light, crouch, facing and LOS.
  playerVisibility(fovDeg = 130, maxDay = 80) {
    const p = this.player; if (p.dead) return 0;
    const d = this.distanceToPlayer();
    const night = this.ctx.time.night;
    const torch = this.ctx.state.data.flashlight.on ? 1 : 0;
    let maxD = lerp(maxDay, 22, night) + torch * night * 50;
    if (p.inBase) return 0;
    if (d > maxD) return 0;
    const eye = this.eyePos(_v);
    _dir.set(p.position.x - this.position.x, 0, p.position.z - this.position.z).normalize();
    const facing = Math.cos(this.yaw) * -_dir.z + Math.sin(this.yaw) * -_dir.x;  // yaw=0 faces -z
    const cosHalf = Math.cos((fovDeg * 0.5 * Math.PI) / 180);
    if (facing < cosHalf && d > 2.5) return 0;
    // LOS to chest and head
    _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.65, p.position.z);
    _v3.set(p.eye.x, p.eye.y, p.eye.z);
    const los = this.ctx.world.lineOfSight(eye, _v3) || this.ctx.world.lineOfSight(eye, _v2);
    if (!los) return 0;
    let vis = 1 - d / maxD;
    vis *= p.crouched ? 0.55 : 1;
    vis *= p.moving ? 1 : 0.7;
    vis *= lerp(1, 0.45 + torch * 0.8, night);
    return clamp01(vis * 1.6);
  }
  // player noise reaching this entity, 0..1
  playerAudibility(range = 40) {
    const d = this.distanceToPlayer();
    const n = this.player.noise;
    const shots = this.ctx.director?.recentShotAt(this.position, 120) || 0;
    return clamp01(n * (1 - d / (range * 0.35)) + shots);
  }
  // awareness integrator: call each update
  perceive(dt, opts = {}) {
    const vis = this.playerVisibility(opts.fov, opts.maxDay);
    const hear = this.playerAudibility(opts.hearing);
    const gain = Math.max(vis * (opts.visGain ?? 1.4), hear * (opts.hearGain ?? 1.0));
    if (gain > 0.02) { this.aware = clamp01(this.aware + gain * dt); }
    else this.aware = Math.max(0, this.aware - dt * (opts.decay ?? 0.08));
    if (vis > 0.05 || hear > 0.5) { if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastSeenT = this.time; }
    if (this.aware >= 1 && !this.engaged) { this.engaged = true; this.ctx.director?.notify('spotted', { enemy: this }); this.onSpotted?.(); }
    if (this.aware <= 0.05 && this.engaged) { this.engaged = false; this.ctx.director?.notify('lost', { enemy: this }); }
    return { vis, hear };
  }
  eyePos(out) { return out.set(this.position.x, this.position.y + this.height * 0.9, this.position.z); }
  // is the player looking at this entity (within angle and LOS)? used by mimics to "skip" when unobserved
  observedByPlayer(halfAngleDeg = 32) {
    const cam = this.ctx.camera; cam.getWorldDirection(_dir);
    _v.set(this.position.x, this.position.y + this.height * 0.5, this.position.z).sub(this.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    if (_dir.dot(_v) < Math.cos((halfAngleDeg * Math.PI) / 180)) return false;
    return this.ctx.world.lineOfSight(this.player.eye, _v3.set(this.position.x, this.position.y + this.height * 0.5, this.position.z));
  }

  // ---- movement ----
  followGround(dt, lambda = 30) {
    const g = this.ctx.world.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
    this.groundY = g.y;
    if (this.flying) return;
    this.position.y = dt ? damp(this.position.y, g.y, lambda, dt) : g.y;
  }
  faceToward(x, z, dt, rate = 8) {
    const target = Math.atan2(-(x - this.position.x), -(z - this.position.z));
    this.yaw = dampAngle(this.yaw, target, rate, dt);
  }
  // steer toward a target on the XZ plane, avoiding colliders and water, at speed. returns distance remaining.
  moveToward(target, speed, dt, opts = {}) {
    const dx = target.x - this.position.x, dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < (opts.stop ?? 0.3)) return dist;
    let vx = dx / dist, vz = dz / dist;
    // obstacle avoidance: sample colliders ahead, push sideways
    const look = Math.min(dist, 2.5);
    const ax = this.position.x + vx * look, az = this.position.z + vz * look;
    let px = 0, pz = 0;
    this.ctx.world.query(ax, az, 1.8, (c) => {
      if (c.passable || c.noAvoid) return;
      let cx, cz, r;
      if (c.kind === 'box') { cx = clamp(ax, c.min.x, c.max.x); cz = clamp(az, c.min.z, c.max.z); r = 0.9; if (c.max.y < this.position.y + 0.5 || c.min.y > this.position.y + this.height) return; }
      else { cx = c.x; cz = c.z; r = c.r + 0.7; if (c.y1 < this.position.y + 0.3) return; }
      const ox = ax - cx, oz = az - cz; const od = Math.hypot(ox, oz);
      if (od < r) { const s = (r - od) / r; if (od < 1e-4) { px += -vz * s; pz += vx * s; } else { px += (ox / od) * s; pz += (oz / od) * s; } }
    });
    // avoid water
    if (!opts.allowWater && this.ctx.world.isWater(ax, az)) { px += -vz * 0.8; pz += vx * 0.8; }
    vx += px * 1.6; vz += pz * 1.6;
    const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
    const step = Math.min(speed * dt, dist);
    this.position.x += vx * step; this.position.z += vz * step;
    // hard resolve against colliders
    this.ctx.world.resolveCapsule(this.position, this.radius, this.height, 0.6);
    const lim = this.ctx.world.half - 3;
    this.position.x = clamp(this.position.x, -lim, lim); this.position.z = clamp(this.position.z, -lim, lim);
    if (opts.face !== false) this.faceToward(this.position.x + vx, this.position.z + vz, dt, opts.turnRate ?? 10);
    return dist - step;
  }

  // ---- combat ----
  // capsule hit test; returns distance along ray or -1
  hitTest(origin, dir, maxDist) {
    const r = this.radius, y0 = this.position.y, y1 = this.position.y + this.height;
    const ox = origin.x - this.position.x, oz = origin.z - this.position.z;
    const a = dir.x * dir.x + dir.z * dir.z;
    let t;
    if (a < 1e-9) { if (ox * ox + oz * oz > r * r) return -1; t = 0; }
    else {
      const b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * c; if (disc < 0) return -1;
      t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0) t = 0;
    }
    if (t > maxDist) return -1;
    // the cylinder hit at t; also check the y-range across the segment inside the cylinder
    const y = origin.y + dir.y * t;
    if (y >= y0 && y <= y1) return t;
    // ray may enter from top/bottom: test cap planes
    for (const cy of [y0, y1]) { if (Math.abs(dir.y) < 1e-9) continue; const tt = (cy - origin.y) / dir.y; if (tt < 0 || tt > maxDist) continue; const x = origin.x + dir.x * tt - this.position.x, z = origin.z + dir.z * tt - this.position.z; if (x * x + z * z <= r * r) return tt; }
    return -1;
  }
  // called by ballistics/explosions. info: { point, dir, kind:'bullet'|'blast'|'melee', headshot, source }
  damage(amount, info = {}) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.aware = 1; if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastSeenT = this.time;
    this.onHit?.(amount, info);
    this.ctx.events.emit('enemyHit', this, amount, info);
    if (this.hp <= 0) { this.kill(info); return true; }
    return false;
  }
  kill(info = {}) {
    if (!this.alive) return;
    this.alive = false; this.dead = true; this.deathT = 0;
    this.ctx.state.data.stats.kills++;
    for (const s of this.sounds) s.stop(0.4); this.sounds.clear();
    this.onDeath?.(info);
    this.ctx.events.emit('enemyKilled', this, info);
    this.ctx.director?.notify('kill', { enemy: this });
  }
  // deal damage to the player from this entity with a kind
  hurtPlayer(amount, kind = 'melee') { this.player.damage(amount, { kind, source: this }); }

  // ---- audio ----
  sound(name, opts = {}) { return this.ctx.audio.play(name, Object.assign({ pos: this.position, hrtf: true }, opts)); }
  loopSound(name, opts = {}) { const h = this.ctx.audio.loop(name, Object.assign({ pos: this.position, hrtf: true }, opts)); if (h) this.sounds.add(h); return h; }
  updateSoundPositions() { for (const s of this.sounds) s.setPos(this.position); }

  // ---- lifecycle ----
  // subclasses implement tick(dt). update() adds throttling and death handling.
  update(dt) {
    this.stateT += dt;
    if (this.dead) { this.deathT += dt; this.deathTick?.(dt); if (this.deathT > (this.deathDuration ?? 3)) this.removeMe = true; this.root.position.copy(this.position); return; }
    this.tick?.(dt);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    this.updateSoundPositions();
  }
  dispose() {
    for (const s of this.sounds) s.stop(0.2); this.sounds.clear();
    this.ctx.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.material && !o.material.userData?.shared) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
    this.onDispose?.();
  }
}

export function createEnemies(ctx) {
  const types = new Map();
  const list = [];
  const api = {
    list, types,
    registerType(type, Cls) { types.set(type, Cls); },
    spawn(type, position, opts = {}) {
      const Cls = types.get(type);
      if (!Cls) { console.warn('unknown enemy type', type); return null; }
      const pos = position.clone ? position.clone() : new THREE.Vector3(position.x, position.y ?? 0, position.z);
      if (!opts.keepY) pos.y = ctx.world.groundHeight(pos.x, pos.z, pos.y + 2).y;
      const e = new Cls(ctx, pos, opts);
      list.push(e);
      ctx.events.emit('enemySpawned', e);
      return e;
    },
    count(type = null, aliveOnly = true) { let n = 0; for (const e of list) if ((!type || e.type === type) && (!aliveOnly || e.alive)) n++; return n; },
    nearest(pos, maxD = Infinity, filter = null) { let best = null, bd = maxD; for (const e of list) { if (!e.alive || (filter && !filter(e))) continue; const d = e.position.distanceTo(pos); if (d < bd) { bd = d; best = e; } } return best; },
    // number of entities currently engaged with the player
    engagedCount() { let n = 0; for (const e of list) if (e.alive && e.aware >= 1) n++; return n; },
    // ray vs all alive entities. returns { enemy, distance, point } or null
    raycast(origin, dir, maxDist) {
      let best = null;
      for (const e of list) {
        if (!e.alive) continue;
        const t = e.hitTest(origin, dir, maxDist);
        if (t >= 0 && (!best || t < best.distance)) best = { enemy: e, distance: t, point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t) };
      }
      return best;
    },
    // radial damage (explosions)
    blast(center, radius, damage, info = {}) {
      for (const e of list) { if (!e.alive) continue; const d = e.position.distanceTo(center); if (d < radius) e.damage(damage * (1 - d / radius), Object.assign({ kind: 'blast', point: e.position.clone() }, info)); }
      const pd = ctx.player.position.distanceTo(center);
      if (pd < radius && info.hurtPlayer !== false) ctx.player.damage(damage * (1 - pd / radius) * 0.7, { kind: 'blast', bleed: false });
    },
    removeAll() { for (const e of list) e.dispose(); list.length = 0; },
    removeDead() { for (let i = list.length - 1; i >= 0; i--) if (list[i].removeMe) { list[i].dispose(); list.splice(i, 1); } },
    update(dt) {
      const pp = ctx.player.position;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        // throttle far, unaware entities
        const d = e.position.distanceTo(pp);
        if (e.alive && e.aware < 0.3 && d > 90) { e.throttle += dt; if (e.throttle < 0.25) continue; const step = e.throttle; e.throttle = 0; e.update(step); continue; }
        e.update(dt);
      }
      api.removeDead();
    },
  };
  return api;
}
