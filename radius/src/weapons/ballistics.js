// Hitscan shared by player weapons and entities. shoot(origin, dir, opts) casts one ray per pellet inside a spread
// cone, tests entities (player source) or the player capsule (enemy source) against the world, and hands the hit to
// the target's own damage model: entities get the ammunition definition plus where on the capsule the round landed
// (h01 height fraction, lateral01 offset) so they can resolve their vests and helmets; the player goes through
// ctx.damage.bullet. Distance falloff by weapon class (subsonic rounds fall off sooner), impact vfx + sounds by
// surface, pooled bullet-hole decals on hard surfaces, ricochets at grazing angles, near-miss whizzes, and tracers
// only for tracer ammunition and every fifth machine-gun round.
import * as THREE from 'three';
import { clamp, clamp01, DEG, TAU } from '../core/math.js';
import { AMMO, ZONE_MULT, zoneFromHit } from '../data/index.js';

const _d = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _n = new THREE.Vector3(), _far = new THREE.Vector3(), _from = new THREE.Vector3(), _pt = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _rq = new THREE.Quaternion(), _sc = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _col = new THREE.Color(), _roll = new THREE.Quaternion();

// impact sound family by world surface; vfx family likewise (vfx.impact knows metal/concrete/wood/grass/water/ash/glass)
const SOUND_OF = { grass: 'dirt', mud: 'dirt', dirt: 'dirt', road: 'concrete', rock: 'concrete', concrete: 'concrete', metal: 'metal', wood: 'wood', water: 'water', glass: 'glass', ash: 'ash', flesh: 'ash' };
const VFX_OF = { road: 'concrete', rock: 'concrete', dirt: 'mud' };
const HARD = new Set(['metal', 'concrete', 'rock', 'road', 'glass']);
const DECAL_TINT = { concrete: [1, 1, 1], road: [0.9, 0.9, 0.92], rock: [0.95, 0.93, 0.9], metal: [0.55, 0.55, 0.6], wood: [0.6, 0.42, 0.28], glass: [0.8, 0.9, 1] };
const RANGE_BY_CLS = { pistol: 50, smg: 80, rifle: 200, shotgun: 25, sniper: 400, mg: 300 };
const DECALS = 64;

// range in metres before the round loses energy: full to `range`, half at twice that; subsonic rounds sooner
const falloff = (dist, range, sub) => { const r = sub ? range * 0.7 : range; return dist <= r ? 1 : Math.max(0.5, 1 - 0.5 * (dist - r) / r); };

// ray vs vertical capsule (cylinder with flat caps) standing on feet; returns distance or -1
function capsuleHit(origin, dir, feet, r, h, maxDist) {
  const ox = origin.x - feet.x, oz = origin.z - feet.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let t;
  if (a < 1e-9) { if (ox * ox + oz * oz > r * r) return -1; t = 0; }
  else {
    const b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c; if (disc < 0) return -1;
    // see enemies/common.js: only clamp a negative root when the origin is inside the cylinder,
    // or a target behind the shooter reports a hit at distance 0.
    t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) { if (c > 0) return -1; t = 0; }
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
// how far from the capsule's axis the ray passes, 0 centre .. 1 edge
function lateralOf(origin, dir, centre, r) {
  const ox = origin.x - centre.x, oz = origin.z - centre.z, h = Math.hypot(dir.x, dir.z) || 1e-6;
  return clamp01(Math.abs(ox * dir.z - oz * dir.x) / h / (r || 0.4));
}
// bullet hole: a scorched centre, a chipped rim and a few short cracks; tinted per surface by instance colour
function holeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  const rim = g.createRadialGradient(32, 32, 6, 32, 32, 22); rim.addColorStop(0, 'rgba(120,114,106,0)'); rim.addColorStop(0.45, 'rgba(150,144,136,0.55)'); rim.addColorStop(1, 'rgba(120,114,106,0)');
  g.fillStyle = rim; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(30,27,24,0.7)'; g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + Math.sin(i * 3.7) * 0.5, l = 12 + (i % 3) * 5; g.beginPath(); g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); g.lineTo(32 + Math.cos(a + 0.15) * l, 32 + Math.sin(a + 0.15) * l); g.stroke(); }
  const core = g.createRadialGradient(32, 32, 0, 32, 32, 9); core.addColorStop(0, 'rgba(8,7,6,1)'); core.addColorStop(0.6, 'rgba(14,12,10,0.95)'); core.addColorStop(1, 'rgba(20,18,16,0)');
  g.fillStyle = core; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

let mgCount = 0;

export function createBallistics(ctx) {
  // ---- bullet-hole decals: one instanced quad pool, oldest overwritten ----
  let decals = null, decalHead = 0;
  function decalPool() {
    if (decals) return decals;
    let mat = null;
    try { mat = ctx.materials?.decal?.('bullet') || null; } catch (e) { mat = null; }
    if (!mat) mat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, DECALS);
    decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DECALS * 3).fill(1), 3);
    decals.frustumCulled = false; decals.castShadow = false; decals.receiveShadow = false; decals.renderOrder = 2; decals.name = 'bulletHoles';
    _m4.makeScale(0, 0, 0); for (let i = 0; i < DECALS; i++) decals.setMatrixAt(i, _m4);
    ctx.scene.add(decals);
    return decals;
  }
  function placeDecal(point, normal, surface) {
    const pool = decalPool(), i = decalHead; decalHead = (decalHead + 1) % DECALS;
    _rq.setFromUnitVectors(_z, _n.copy(normal).normalize());
    _roll.setFromAxisAngle(_z, Math.random() * TAU); _rq.multiply(_roll);
    const s = surface === 'glass' ? 0.11 : 0.05 + Math.random() * 0.03;
    _sc.set(s, s, 1);
    _p.copy(point).addScaledVector(_n, 0.004);
    _m4.compose(_p, _rq, _sc); pool.setMatrixAt(i, _m4);
    const tint = DECAL_TINT[surface] || DECAL_TINT.concrete;
    pool.setColorAt(i, _col.setRGB(tint[0], tint[1], tint[2]));
    pool.instanceMatrix.needsUpdate = true; pool.instanceColor.needsUpdate = true;
  }

  function worldImpact(wh, d) {
    const surf = wh.surface || 'concrete';
    const hard = HARD.has(surf);
    ctx.vfx.impact(wh.point, wh.normal, VFX_OF[surf] || surf);
    ctx.audio.play('impact_' + (SOUND_OF[surf] || 'dirt'), { pos: wh.point, hrtf: true, gain: 0.75, rate: 0.9 + Math.random() * 0.2 });
    // grazing hits on hard surfaces sing off
    if (hard && wh.normal && Math.abs(d.dot(wh.normal)) < 0.35 && Math.random() < 0.55) {
      if (ctx.audio.has('ricochet')) ctx.audio.play('ricochet', { pos: wh.point, hrtf: true, gain: 0.7, rate: 0.9 + Math.random() * 0.3 });
      else ctx.audio.play('impact_metal', { pos: wh.point, hrtf: true, gain: 0.45, rate: 1.7 + Math.random() * 0.3 });
      ctx.vfx.spark(wh.point, wh.normal, 8, [1.0, 0.8, 0.45]);
    }
    if ((hard || surf === 'wood') && wh.collider) placeDecal(wh.point, wh.normal, surf);
    return { kind: 'world', point: wh.point, normal: wh.normal, surface: surf, distance: wh.distance, damage: 0 };
  }
  function playerShot(origin, d, maxDist, damage, range, sub, a, kind, shooter, pellets) {
    const eh = ctx.enemies.raycast(origin, d, maxDist);
    const wh = ctx.world.raycast(origin, d, eh ? eh.distance : maxDist);
    if (eh && (!wh || eh.distance < wh.distance)) {
      const e = eh.enemy, dist = eh.distance;
      const h01 = clamp01((eh.point.y - e.position.y) / (e.height || 1.8));
      const lateral01 = lateralOf(origin, d, e.position, e.radius);
      const zone = zoneFromHit(h01, lateral01);
      const base = damage * falloff(dist, range, sub);
      // an armoured entity resolves the zone and its vest itself; otherwise the zone multiplier applies here
      const dmg = e.armorPieces ? base : base * (ZONE_MULT[zone] || 1);
      _n.copy(d).negate();
      e.damage(dmg, { kind, ammo: a, h01, lateral01, zone, point: eh.point, dir: d.clone(), headshot: zone === 'head', source: shooter || 'player', distance: dist, pellet: pellets > 1 });
      ctx.vfx.impact(eh.point, _n, 'ash');
      return { kind: 'enemy', enemy: e, point: eh.point, distance: dist, damage: dmg, headshot: zone === 'head', zone };
    }
    if (wh) return worldImpact(wh, d);
    return { kind: 'none', point: _far.copy(origin).addScaledVector(d, maxDist).clone(), distance: maxDist, damage: 0 };
  }
  function enemyShot(origin, d, maxDist, damage, range, sub, a, shooter, opts) {
    const pl = ctx.player;
    const wh = ctx.world.raycast(origin, d, maxDist);
    const h = pl.crouched ? 1.3 : 1.8;
    const tP = pl.dead ? -1 : capsuleHit(origin, d, pl.position, 0.35, h, maxDist);
    if (tP >= 0 && (!wh || tP < wh.distance)) {
      _pt.copy(origin).addScaledVector(d, tP);
      const h01 = clamp01((_pt.y - pl.position.y) / h), lateral01 = lateralOf(origin, d, pl.position, 0.35);
      const k = falloff(tP, range, sub);
      let dealt;
      if (ctx.damage && ctx.damage.bullet) {
        const ammoDef = a || { id: 'round', cal: opts.cal || '?', name: 'round', kind: 'fmj', damage, pen: opts.pen ?? 2, pellets: 1, noise: 1, speed: 340 };
        const r = ctx.damage.bullet(ammoDef, h01, lateral01, { source: shooter, mult: k * (a ? damage / (a.damage || damage) : 1), what: opts.what });
        dealt = r ? r.damage : damage * k;
      } else { pl.damage(damage * k, { kind: 'bullet', source: shooter }); dealt = damage * k; }
      return { kind: 'player', point: _pt.clone(), distance: tP, damage: dealt, h01, lateral01 };
    }
    // near miss: closest approach of the segment to the eye
    const segLen = wh ? wh.distance : maxDist;
    _q.copy(pl.eye).sub(origin);
    const tc = clamp(_q.dot(d), 0, segLen);
    _q.copy(origin).addScaledVector(d, tc);
    if (!pl.dead && tc > 0.5 && _q.distanceTo(pl.eye) < 1.5) ctx.audio.play('bullet_whiz', { pos: _q, hrtf: true, gain: 0.9, rate: 0.9 + Math.random() * 0.25 });
    if (wh) return worldImpact(wh, d);
    return { kind: 'none', point: _far.copy(origin).addScaledVector(d, maxDist).clone(), distance: maxDist, damage: 0 };
  }

  const api = {
    isStub: false,
    get decals() { return decals; },
    // shoot(origin, dir, { ammo (def|id), damage, range, cls, spreadDeg, pellets, tracer, source:'player'|'enemy', kind:'bullet', shooter, tracerFrom, pen, what }) -> hits[]
    shoot(origin, dir, opts = {}) {
      const a = typeof opts.ammo === 'string' ? AMMO[opts.ammo] || null : opts.ammo || null;
      const damage = opts.damage ?? a?.damage ?? 10;
      const range = opts.range ?? (opts.cls && RANGE_BY_CLS[opts.cls]) ?? 60;
      const spreadDeg = opts.spreadDeg ?? 0, pellets = Math.max(1, (opts.pellets ?? a?.pellets ?? 1) | 0);
      const source = opts.source || 'player', kind = opts.kind || 'bullet', shooter = opts.shooter || null;
      const sub = !!a && (a.kind === 'sub' || (a.speed || 340) < 340);
      const isMg = opts.cls === 'mg' || !!opts.mg;
      // tracers: tracer rounds always, every fifth MG round; entities that name no ammunition get the MG rule
      const tracerMode = opts.tracer === false ? 'none' : a?.tracer ? 'all' : (isMg || !a) && opts.tracer !== false ? 'fifth' : 'none';
      const maxDist = Math.min(600, Math.max(range * 2.5, 120));
      const hits = [];
      _d.copy(dir).normalize();
      _u.set(0, 1, 0); if (Math.abs(_d.y) > 0.99) _u.set(1, 0, 0);
      _r.crossVectors(_d, _u).normalize(); _u.crossVectors(_r, _d).normalize();
      const half = Math.tan(spreadDeg * 0.5 * DEG);
      for (let i = 0; i < pellets; i++) {
        // uniform disc for pellet patterns; bullets cluster toward the centre
        const ang = Math.random() * TAU;
        const rr = (pellets > 1 ? Math.sqrt(Math.random()) : (Math.random() + Math.random()) * 0.5) * half;
        _p.copy(_d).addScaledVector(_r, Math.cos(ang) * rr).addScaledVector(_u, Math.sin(ang) * rr).normalize();
        const hit = source === 'enemy' ? enemyShot(origin, _p, maxDist, damage, range, sub, a, shooter, opts) : playerShot(origin, _p, maxDist, damage, range, sub, a, kind, shooter, pellets);
        mgCount++;
        if (tracerMode === 'all' || (tracerMode === 'fifth' && mgCount % 5 === 0)) {
          _from.copy(opts.tracerFrom || origin);
          if (hit.distance > 1.2) ctx.vfx.tracer(_from, hit.point, pellets > 1 ? 0.012 : source === 'enemy' ? 0.03 : 0.02);
        }
        hits.push(hit);
      }
      return hits;
    },
    // straight test without damage (lasers, aim assists): { distance, point, enemy? } or null
    probe(origin, dir, maxDist = 60) {
      const eh = ctx.enemies.raycast(origin, dir, maxDist);
      const wh = ctx.world.raycast(origin, dir, eh ? eh.distance : maxDist);
      if (eh && (!wh || eh.distance < wh.distance)) return eh;
      return wh;
    },
    update(dt) {},
  };
  return api;
}
