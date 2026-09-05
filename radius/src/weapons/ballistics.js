// Hitscan shared by player weapons and entities. shoot(origin, dir, opts) casts one ray per pellet inside a
// spread cone, tests entities (player source) or the player capsule (enemy source) against the world, applies
// damage with distance falloff and headshots, spawns impact vfx + sounds, tracers, and near-miss whizzes.
import * as THREE from 'three';
import { clamp, DEG, TAU } from '../core/math.js';

const _d = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _n = new THREE.Vector3(), _far = new THREE.Vector3(), _from = new THREE.Vector3(), _pt = new THREE.Vector3();

// impact sound family by world surface; vfx family likewise (vfx.impact knows metal/concrete/wood/grass/water/ash/glass)
const SOUND_OF = { grass: 'dirt', mud: 'dirt', dirt: 'dirt', road: 'concrete', rock: 'concrete', concrete: 'concrete', metal: 'metal', wood: 'wood', water: 'water', glass: 'glass', ash: 'ash', flesh: 'ash' };
const VFX_OF = { road: 'concrete', rock: 'concrete', dirt: 'mud' };

const falloff = (dist, range) => (dist <= range ? 1 : Math.max(0.5, 1 - 0.5 * (dist - range) / range));

// ray vs vertical capsule (cylinder with flat caps) standing on feet; returns distance or -1
function capsuleHit(origin, dir, feet, r, h, maxDist) {
  const ox = origin.x - feet.x, oz = origin.z - feet.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let t;
  if (a < 1e-9) { if (ox * ox + oz * oz > r * r) return -1; t = 0; }
  else {
    const b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c; if (disc < 0) return -1;
    t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) t = 0;
  }
  if (t > maxDist) return -1;
  const y = origin.y + dir.y * t;
  if (y >= feet.y && y <= feet.y + h) return t;
  if (Math.abs(dir.y) < 1e-9) return -1;
  for (const cy of [feet.y, feet.y + h]) {
    const tt = (cy - origin.y) / dir.y; if (tt < 0 || tt > maxDist) continue;
    const x = origin.x + dir.x * tt - feet.x, z = origin.z + dir.z * tt - feet.z;
    if (x * x + z * z <= r * r) return tt;
  }
  return -1;
}

export function createBallistics(ctx) {
  function worldImpact(wh) {
    const surf = wh.surface || 'concrete';
    ctx.vfx.impact(wh.point, wh.normal, VFX_OF[surf] || surf);
    ctx.audio.play('impact_' + (SOUND_OF[surf] || 'dirt'), { pos: wh.point, hrtf: true, gain: 0.75, rate: 0.9 + Math.random() * 0.2 });
    return { kind: 'world', point: wh.point, normal: wh.normal, surface: surf, distance: wh.distance, damage: 0 };
  }
  function playerShot(origin, d, maxDist, damage, range, kind, shooter, pellets) {
    const eh = ctx.enemies.raycast(origin, d, maxDist);
    const wh = ctx.world.raycast(origin, d, eh ? eh.distance : maxDist);
    if (eh && (!wh || eh.distance < wh.distance)) {
      const e = eh.enemy, dist = eh.distance;
      const headshot = eh.point.y > e.position.y + e.height * 0.82;
      const dmg = damage * falloff(dist, range) * (headshot ? 1.8 : 1);
      _n.copy(d).negate();
      e.damage(dmg, { kind, point: eh.point, dir: d.clone(), headshot, source: shooter || 'player', distance: dist });
      ctx.vfx.impact(eh.point, _n, 'ash');
      return { kind: 'enemy', enemy: e, point: eh.point, distance: dist, damage: dmg, headshot };
    }
    if (wh) return worldImpact(wh);
    return { kind: 'none', point: _far.copy(origin).addScaledVector(d, maxDist).clone(), distance: maxDist, damage: 0 };
  }
  function enemyShot(origin, d, maxDist, damage, range, kind, shooter) {
    const pl = ctx.player;
    const wh = ctx.world.raycast(origin, d, maxDist);
    const tP = pl.dead ? -1 : capsuleHit(origin, d, pl.position, 0.35, pl.crouched ? 1.3 : 1.8, maxDist);
    if (tP >= 0 && (!wh || tP < wh.distance)) {
      const dmg = damage * falloff(tP, range);
      pl.damage(dmg, { kind: 'bullet', source: shooter });
      return { kind: 'player', point: _pt.copy(origin).addScaledVector(d, tP).clone(), distance: tP, damage: dmg };
    }
    // near miss: closest approach of the segment to the eye
    const segLen = wh ? wh.distance : maxDist;
    _q.copy(pl.eye).sub(origin);
    const tc = clamp(_q.dot(d), 0, segLen);
    _q.copy(origin).addScaledVector(d, tc);
    if (!pl.dead && tc > 0.5 && _q.distanceTo(pl.eye) < 1.5) ctx.audio.play('bullet_whiz', { pos: _q, hrtf: true, gain: 0.9, rate: 0.9 + Math.random() * 0.25 });
    if (wh) return worldImpact(wh);
    return { kind: 'none', point: _far.copy(origin).addScaledVector(d, maxDist).clone(), distance: maxDist, damage: 0 };
  }

  const api = {
    isStub: false,
    // shoot(origin, dir, { damage, range, spreadDeg, pellets=1, tracer=true, source:'player'|'enemy', kind:'bullet', shooter, tracerFrom }) -> hits[]
    shoot(origin, dir, opts = {}) {
      const damage = opts.damage ?? 10, range = opts.range ?? 60, spreadDeg = opts.spreadDeg ?? 0, pellets = Math.max(1, opts.pellets | 0 || 1);
      const tracer = opts.tracer !== false, source = opts.source || 'player', kind = opts.kind || 'bullet', shooter = opts.shooter || null;
      const maxDist = Math.min(600, Math.max(range * 2.5, 120));
      const hits = [];
      _d.copy(dir).normalize();
      _u.set(0, 1, 0); if (Math.abs(_d.y) > 0.99) _u.set(1, 0, 0);
      _r.crossVectors(_d, _u).normalize(); _u.crossVectors(_r, _d).normalize();
      const half = Math.tan(spreadDeg * 0.5 * DEG);
      for (let i = 0; i < pellets; i++) {
        // uniform disc for pellet patterns; bullets cluster toward the centre
        const a = Math.random() * TAU;
        const rr = (pellets > 1 ? Math.sqrt(Math.random()) : (Math.random() + Math.random()) * 0.5) * half;
        _p.copy(_d).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
        const hit = source === 'enemy' ? enemyShot(origin, _p, maxDist, damage, range, kind, shooter) : playerShot(origin, _p, maxDist, damage, range, kind, shooter, pellets);
        if (tracer) {
          _from.copy(opts.tracerFrom || origin);
          if (hit.distance > 1.2) ctx.vfx.tracer(_from, hit.point, pellets > 1 ? 0.012 : source === 'enemy' ? 0.03 : 0.02);
        }
        hits.push(hit);
      }
      return hits;
    },
    update(dt) {},
  };
  return api;
}
