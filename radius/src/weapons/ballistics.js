// Every round in RADIUS is a real projectile, not a ray. shoot() launches one pooled bullet per pellet with the
// ammunition's muzzle velocity, elevated by the weapon's zero, and update() integrates it under gravity and
// quadratic drag in short segments, raycasting each segment against entities and the world. That gives travel
// time (a target at 200 m is hit a quarter of a second after the trigger breaks, so a runner has to be led),
// drop below the line of sight past the zero range, and velocity that decays with distance — which is also the
// damage falloff and the penetration budget, so a spent round both hurts less and stops in thinner cover.
//
// What a bullet meets is resolved as material, not as a wall: each surface has a hardness and a plausible real
// thickness (a "metal" collider box is a sheet, not a solid billet), the round spends concrete-equivalent
// penetration on the way through and comes out the far side slower, and grazing hits on hard faces ricochet and
// keep flying. Bodies are the same model: a round through an arm carries on, a pistol round into a chest does not.
// Near misses on the player crack past, shake the picture and disturb the aim (api.suppression, read by weapons
// and hands); impacts near the player throw debris and jolt the camera.
import * as THREE from 'three';
import { clamp, clamp01, DEG, TAU, lerp } from '../core/math.js';
import { AMMO, ZONE_MULT, zoneFromHit } from '../data/index.js';

const _d = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _n = new THREE.Vector3(), _far = new THREE.Vector3(), _from = new THREE.Vector3(), _pt = new THREE.Vector3();
const _seg = new THREE.Vector3(), _tmp = new THREE.Vector3(), _nrm = new THREE.Vector3(), _ref = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _rq = new THREE.Quaternion(), _sc = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _col = new THREE.Color(), _roll = new THREE.Quaternion();

// impact sound family by world surface; vfx family likewise (vfx.impact knows metal/concrete/wood/grass/water/ash/glass)
const SOUND_OF = { grass: 'dirt', mud: 'dirt', dirt: 'dirt', road: 'concrete', rock: 'concrete', concrete: 'concrete', metal: 'metal', wood: 'wood', water: 'water', glass: 'glass', ash: 'ash', flesh: 'ash' };
const VFX_OF = { road: 'concrete', rock: 'concrete', dirt: 'mud' };
const HARD = new Set(['metal', 'concrete', 'rock', 'road', 'glass']);
const DECAL_TINT = { concrete: [1, 1, 1], road: [0.9, 0.9, 0.92], rock: [0.95, 0.93, 0.9], metal: [0.55, 0.55, 0.6], wood: [0.6, 0.42, 0.28], glass: [0.8, 0.9, 1] };
const RANGE_BY_CLS = { pistol: 50, smg: 80, rifle: 200, shotgun: 25, sniper: 400, mg: 300 };
// where the sights are set to cross the bore line, in metres, by weapon class
const ZERO_BY_CLS = { pistol: 25, smg: 40, shotgun: 20, rifle: 100, mg: 120, sniper: 200 };
const DECALS = 128;

const GRAV = 9.81;
const MAX_PROJ = 96;          // pooled bullets in flight
const SEG = 16;               // metres of flight per raycast segment (drop inside one is under 3 mm at rifle speed)
const SPENT = 55;             // m/s below which a round is done doing damage
const SYNC = 0.03;            // seconds of flight resolved inside shoot(), so close shots land on the same frame
const SUPPRESS_R = 3.4;       // how close an enemy round has to pass to rattle the player

// Retardation per metre for the exponential velocity model v(x) = v0 e^(-k x). Fitted so 5.45 keeps ~690 m/s at
// 300 m, 9x18 ~280 at 100 m, and 00 buck ~340 at 25 m — the shapes that decide how far each weapon is worth using.
const DRAG_CAL = {
  '9x18': 1.35e-3, '9x19': 1.25e-3, '7.62x25': 1.05e-3, '.45': 1.55e-3,
  '5.45x39': 7.5e-4, '7.62x39': 8.5e-4, '5.56x45': 7.0e-4,
  '9x39': 1.30e-3, '7.62x54': 6.0e-4, '12ga': 4.5e-3,
};
const DRAG_KIND = { buck: 1.5, flechette: 0.45, slug: 0.75, hp: 1.12, ap: 0.92, sub: 1.15, tracer: 1.05, fmj: 1 };

// Materials, in concrete-equivalent terms. `hard` is how many metres of concrete one metre of this costs;
// `maxT` is the thickest real slab the tag can plausibly be, because colliders are chunky boxes — a shipping
// container's wall is a 0.05 m collider and 1.5 mm of steel, and a round has to behave like it met the steel.
// `ric` is the base chance of a ricochet at a fully grazing angle.
const MAT = {
  concrete: { hard: 1.00, maxT: 0.90, ric: 0.55 },
  road:     { hard: 0.85, maxT: 0.60, ric: 0.55 },
  rock:     { hard: 1.30, maxT: 1.20, ric: 0.60 },
  metal:    { hard: 3.20, maxT: 0.014, ric: 0.70 },
  wood:     { hard: 0.30, maxT: 0.30, ric: 0.12 },
  glass:    { hard: 0.05, maxT: 0.02, ric: 0.02 },
  dirt:     { hard: 0.45, maxT: 0.50, ric: 0.10 },
  mud:      { hard: 0.40, maxT: 0.50, ric: 0.06 },
  grass:    { hard: 0.45, maxT: 0.50, ric: 0.10 },
  ash:      { hard: 0.25, maxT: 0.40, ric: 0.05 },
  water:    { hard: 0.85, maxT: 1.50, ric: 0.75 },
};
const MAT_DEFAULT = MAT.concrete;
// metres of tissue a round has to cross by where it landed; an arm is not a chest
const FLESH_T = { head: 0.18, torso: 0.32, stomach: 0.30, arms: 0.12, legs: 0.16 };
const FLESH_HARD = 0.09;
const BLOODLESS = new Set(['fragment', 'phantom']);

// how much concrete-equivalent a round can spend, from its penetration class and how much speed it has left
const budgetOf = (pen, vr) => Math.max(0, pen) * 0.019 * Math.pow(clamp01(vr), 1.5);
// damage keeps most of its value while the round is fast and falls with the square of velocity
const energyMult = (vr) => clamp(0.30 + 0.70 * vr * vr, 0.28, 1.0);
// elevation the sights need for the round to come back to the line of sight at range R
function zeroAngle(v0, k, R) {
  if (!(R > 0) || !(v0 > 0)) return 0;
  const t = (Math.exp(k * R) - 1) / (k * v0);
  return Math.min(0.02, 0.5 * GRAV * t * t / R);
}

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
// far side of the same capsule, so an over-penetrating round can be put down outside it
function capsuleExit(origin, dir, feet, r, h) {
  const ox = origin.x - feet.x, oz = origin.z - feet.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let t = 0;
  if (a > 1e-9) {
    const b = 2 * (ox * dir.x + oz * dir.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) t = (-b + Math.sqrt(disc)) / (2 * a);
  }
  if (Math.abs(dir.y) > 1e-9) {
    const cap = dir.y > 0 ? feet.y + h : feet.y;
    const tt = (cap - origin.y) / dir.y;
    if (tt > 0 && tt < t) t = tt;
  }
  return Math.max(0.02, Math.min(t, r * 4 + h));
}
// how far from the capsule's axis the ray passes, 0 centre .. 1 edge
function lateralOf(origin, dir, centre, r) {
  const ox = origin.x - centre.x, oz = origin.z - centre.z, h = Math.hypot(dir.x, dir.z) || 1e-6;
  return clamp01(Math.abs(ox * dir.z - oz * dir.x) / h / (r || 0.4));
}
// distance from `from` along `dir` to where the round leaves this collider; Infinity for terrain
function exitDistance(c, from, dir) {
  if (!c) return Infinity;
  if (c.kind === 'box') {
    let tmax = Infinity;
    const o = [from.x, from.y, from.z], d = [dir.x, dir.y, dir.z];
    const mn = [c.min.x, c.min.y, c.min.z], mx = [c.max.x, c.max.y, c.max.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) continue;
      const t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a];
      const hi = Math.max(t1, t2);
      if (hi < tmax) tmax = hi;
    }
    return tmax === Infinity ? 0.05 : Math.max(0.01, tmax);
  }
  const ox = from.x - c.x, oz = from.z - c.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let t = 2 * c.r;
  if (a > 1e-9) {
    const b = 2 * (ox * dir.x + oz * dir.z), cc = ox * ox + oz * oz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) t = (-b + Math.sqrt(disc)) / (2 * a);
  }
  if (Math.abs(dir.y) > 1e-9) {
    const cap = dir.y > 0 ? c.y1 : c.y0;
    const tt = (cap - from.y) / dir.y;
    if (tt > 0 && tt < t) t = tt;
  }
  return Math.max(0.01, t);
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
  function placeDecal(point, normal, surface, scale = 1) {
    const pool = decalPool(), i = decalHead; decalHead = (decalHead + 1) % DECALS;
    _rq.setFromUnitVectors(_z, _nrm.copy(normal).normalize());
    _roll.setFromAxisAngle(_z, Math.random() * TAU); _rq.multiply(_roll);
    const s = (surface === 'glass' ? 0.11 : 0.05 + Math.random() * 0.03) * scale;
    _sc.set(s, s, 1);
    _p.copy(point).addScaledVector(_nrm, 0.004);
    _m4.compose(_p, _rq, _sc); pool.setMatrixAt(i, _m4);
    const tint = DECAL_TINT[surface] || DECAL_TINT.concrete;
    pool.setColorAt(i, _col.setRGB(tint[0], tint[1], tint[2]));
    pool.instanceMatrix.needsUpdate = true; pool.instanceColor.needsUpdate = true;
  }

  // ---- suppression: how badly the player is being shot at right now ----
  let supp = 0, lastFlinch = -1;
  function suppress(k) {
    supp = Math.min(1.6, supp + k);
    const s = clamp01(k);
    // a flinch, not a nudge: the head ducks and the muzzle wanders. Rate-limited, or a belt-fed gun
    // firing at you stacks a dozen jolts a second and the picture turns to soup.
    if (ctx.elapsed - lastFlinch > 0.07) {
      lastFlinch = ctx.elapsed;
      ctx.post.shake(0.10 + 0.42 * s);
      ctx.player.kick(-0.004 * s * (0.4 + Math.random()), (Math.random() - 0.5) * 0.006 * s);
    }
  }

  // ---- projectile pool ----
  const pool = [];
  for (let i = 0; i < MAX_PROJ; i++) {
    pool.push({
      live: false, done: true, hits: [], id: i,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3(), draw: new THREE.Vector3(),
      v0: 340, speed: 340, drag: 1e-3, pen: 2, damage: 10, ammo: null, kind: 'bullet',
      source: 'player', shooter: null, what: null, pellet: false, cls: null,
      dist: 0, tof: 0, maxDist: 300, tracer: false, ric: 0, pierced: 0, whiz: 0, hitPlayer: false, born: 0,
    });
  }
  let poolHead = 0;
  const live = [];
  function take() {
    for (let i = 0; i < MAX_PROJ; i++) { const p = pool[(poolHead + i) % MAX_PROJ]; if (!p.live) { poolHead = (poolHead + i + 1) % MAX_PROJ; return p; } }
    // everything is in the air: recycle whatever has flown furthest, it is the least interesting
    let worst = pool[0];
    for (const p of pool) if (p.dist > worst.dist) worst = p;
    retire(worst);
    return worst;
  }
  function retire(p) {
    if (!p.live) return;
    p.live = false; p.done = true;
    const i = live.indexOf(p); if (i >= 0) live.splice(i, 1);
  }

  // ---- impacts ----
  function worldImpact(p, point, normal, surface, collider, stopped) {
    const surf = surface || 'concrete';
    const hard = HARD.has(surf);
    const vr = p ? clamp01(p.speed / p.v0) : 1;
    if (surf === 'water' && ctx.vfx.splash) ctx.vfx.splash(point, normal, 0.6 + vr);
    else ctx.vfx.impact(point, normal, VFX_OF[surf] || surf);
    ctx.audio.play('impact_' + (SOUND_OF[surf] || 'dirt'), { pos: point, hrtf: true, gain: 0.6 + 0.25 * vr, rate: 0.9 + Math.random() * 0.2 });
    if ((hard || surf === 'wood') && collider) placeDecal(point, normal, surf, 0.7 + 0.5 * vr);
    // a round landing near the player is felt, not just heard: grit off the wall and a jolt in the picture
    if (p && p.source === 'enemy') {
      const d = point.distanceTo(ctx.player.eye);
      if (d < 5 && !ctx.player.dead) {
        const near = 1 - d / 5;
        suppress(near * 0.5);
        if (ctx.vfx.debris) ctx.vfx.debris(point, normal, Math.round(4 + 8 * near), hard ? [0.55, 0.53, 0.5] : [0.4, 0.34, 0.26], 6, 0.045, 0.9, 14, 0.7);
      }
    }
    return { kind: 'world', point: point.clone(), normal: normal.clone(), surface: surf, distance: p ? p.dist : 0, damage: 0, stopped: !!stopped };
  }
  function ricochetSound(point, normal, vr) {
    if (ctx.audio.has('ricochet')) ctx.audio.play('ricochet', { pos: point, hrtf: true, gain: 0.55 + 0.35 * vr, rate: 0.85 + Math.random() * 0.4 });
    else ctx.audio.play('impact_metal', { pos: point, hrtf: true, gain: 0.4, rate: 1.6 + Math.random() * 0.4 });
    ctx.vfx.spark(point, normal, 8, [1.0, 0.8, 0.45]);
  }

  // ---- one segment of flight: walk the barriers it meets ----
  const _hp = new THREE.Vector3(), _hn = new THREE.Vector3();
  function segment(p, dir, len) {
    let travelled = 0, guard = 0;
    while (travelled < len - 1e-4 && p.live && guard++ < 5) {
      const remain = len - travelled;
      // nearest of: the thing the round is shooting at, and the world
      let bestT = -1, bestKind = null, bestEnemy = null;
      if (p.source === 'enemy') {
        const pl = ctx.player;
        if (!pl.dead && !p.hitPlayer) {
          const hh = pl.crouched ? 1.3 : 1.8;
          const t = capsuleHit(p.pos, dir, pl.position, 0.35, hh, remain);
          if (t >= 0) { bestT = t; bestKind = 'player'; }
        }
      } else if (ctx.enemies && ctx.enemies.raycast) {
        const eh = ctx.enemies.raycast(p.pos, dir, remain);
        if (eh) { bestT = eh.distance; bestKind = 'enemy'; bestEnemy = eh.enemy; _hp.copy(eh.point); }
      }
      const wh = ctx.world.raycast(p.pos, dir, bestT >= 0 ? Math.min(remain, bestT) : remain);
      if (wh && (bestT < 0 || wh.distance <= bestT)) { bestT = wh.distance; bestKind = 'world'; bestEnemy = null; }
      if (bestT < 0) { p.pos.addScaledVector(dir, remain); p.dist += remain; return true; }
      p.pos.addScaledVector(dir, bestT); p.dist += bestT; travelled += bestT;
      const dAtHit = p.dist;                       // whatever the barrier costs also counts against this step
      if (bestKind === 'enemy') { const on = hitEnemy(p, bestEnemy, _hp, dir); travelled += p.dist - dAtHit; if (!on) return false; continue; }
      if (bestKind === 'player') { hitPlayerAt(p, dir); return false; }
      const carry = hitWorld(p, wh, dir);
      travelled += p.dist - dAtHit;
      if (carry === 'stop') return false;
      if (carry === 'ricochet') return true;      // direction changed: finish the step, carry on next one
    }
    return true;
  }

  function hitEnemy(p, e, point, dir) {
    const h01 = clamp01((point.y - e.position.y) / (e.height || 1.8));
    const lateral01 = lateralOf(p.pos, dir, e.position, e.radius);
    const zone = zoneFromHit(h01, lateral01);
    const vr = clamp01(p.speed / p.v0);
    const k = energyMult(vr);
    const base = p.damage * k;
    const dmg = e.armorPieces ? base : base * (ZONE_MULT[zone] || 1);
    _n.copy(dir).negate();
    e.damage(dmg, {
      kind: p.kind, ammo: p.ammo, h01, lateral01, zone, point: point.clone(), dir: dir.clone(),
      headshot: zone === 'head', source: p.shooter || 'player', distance: p.dist, pellet: p.pellet,
      speed: p.speed, energy: vr * vr, what: p.what,
    });
    if (BLOODLESS.has(e.type)) ctx.vfx.impact(point, _n, 'ash');
    else if (ctx.vfx.blood) ctx.vfx.blood(point, _n, 0.6 + 1.2 * k * (zone === 'head' ? 1.6 : 1));
    else ctx.vfx.impact(point, _n, 'ash');
    p.hits.push({ kind: 'enemy', enemy: e, point: point.clone(), distance: p.dist, damage: dmg, headshot: zone === 'head', zone, speed: p.speed });
    // over-penetration: how much tissue is in the way, and is there anything left after it
    const cost = FLESH_HARD * (FLESH_T[zone] || 0.3) + (e.armorPieces && (zone === 'torso' || zone === 'head') ? 0.018 : 0);
    const budget = budgetOf(p.pen, vr);
    if (cost >= budget || p.pierced >= 3) { retire(p); return false; }   // the round stays in him
    const exitT = capsuleExit(p.pos, dir, e.position, e.radius, e.height || 1.8);
    p.pos.addScaledVector(dir, exitT + 0.04); p.dist += exitT + 0.04;
    p.pierced++;
    const f = Math.max(0.25, Math.sqrt(1 - cost / budget));
    p.vel.multiplyScalar(f); p.speed *= f;
    if (p.speed < SPENT) { retire(p); return false; }
    // exit spray on the far side
    if (!BLOODLESS.has(e.type) && ctx.vfx.blood) ctx.vfx.blood(p.pos, dir, 0.5 + 0.8 * f);
    return true;
  }

  function hitPlayerAt(p, dir) {
    const pl = ctx.player;
    const hh = pl.crouched ? 1.3 : 1.8;
    const h01 = clamp01((p.pos.y - pl.position.y) / hh), lateral01 = lateralOf(p.pos, dir, pl.position, 0.35);
    const vr = clamp01(p.speed / p.v0), k = energyMult(vr);
    let dealt;
    if (ctx.damage && ctx.damage.bullet) {
      const ammoDef = p.ammo || { id: 'round', cal: '?', name: 'round', kind: 'fmj', damage: p.damage, pen: p.pen, pellets: 1, noise: 1, speed: p.v0 };
      const mult = k * (p.ammo ? p.damage / (p.ammo.damage || p.damage) : 1);
      const r = ctx.damage.bullet(ammoDef, h01, lateral01, { source: p.shooter, mult, what: p.what });
      dealt = r ? r.damage : p.damage * k;
    } else { pl.damage(p.damage * k, { kind: 'bullet', source: p.shooter }); dealt = p.damage * k; }
    p.hitPlayer = true;
    p.hits.push({ kind: 'player', point: p.pos.clone(), distance: p.dist, damage: dealt, h01, lateral01 });
    ctx.post.shake(0.3 + 0.3 * k);
    retire(p);
  }

  // returns 'stop' | 'through' | 'ricochet'
  function hitWorld(p, wh, dir) {
    const surf = wh.surface || 'concrete';
    const mat = MAT[surf] || MAT_DEFAULT;
    const vr = clamp01(p.speed / p.v0);
    _hn.copy(wh.normal);
    const cosI = Math.abs(dir.dot(_hn));
    // a grazing hit on something hard sings off and keeps flying
    if (p.ric < 2 && cosI < 0.45 && vr > 0.35) {
      const graze = clamp01(1 - cosI / 0.45);
      if (Math.random() < mat.ric * graze * graze) {
        worldImpact(p, wh.point, _hn, surf, wh.collider, false);
        ricochetSound(wh.point, _hn, vr);
        _ref.copy(dir).addScaledVector(_hn, -2 * dir.dot(_hn));
        _ref.x += (Math.random() - 0.5) * 0.22; _ref.y += (Math.random() - 0.5) * 0.22; _ref.z += (Math.random() - 0.5) * 0.22;
        _ref.normalize();
        const f = 0.35 + Math.random() * 0.3;
        p.vel.copy(_ref).multiplyScalar(p.speed * f); p.speed *= f;
        p.damage *= 0.65; p.pen *= 0.5; p.ric++; p.whiz = 0;   // it can scream past the player on the way out
        p.pos.addScaledVector(_hn, 0.03);
        p.hits.push({ kind: 'ricochet', point: wh.point.clone(), normal: _hn.clone(), surface: surf, distance: p.dist, damage: 0 });
        if (p.speed < SPENT) { retire(p); return 'stop'; }
        return 'ricochet';
      }
    }
    const geomT = exitDistance(wh.collider, wh.point, dir);
    const obliq = clamp(1 / Math.max(0.28, cosI), 1, 3);
    const effT = Math.min(geomT, mat.maxT) * obliq;
    const cost = mat.hard * effT;
    const budget = budgetOf(p.pen, vr);
    if (cost >= budget || p.pierced >= 3 || !wh.collider) {
      const rec = worldImpact(p, wh.point, _hn, surf, wh.collider, true);
      p.hits.push(rec);
      retire(p);
      return 'stop';
    }
    // through: entry crater on this side, exit spall on the other, and a slower round out the back
    const rec = worldImpact(p, wh.point, _hn, surf, wh.collider, false);
    rec.penetrated = true;
    p.hits.push(rec);
    p.pierced++;
    const f = Math.max(0.25, Math.sqrt(1 - cost / budget));
    const step = Math.min(geomT, mat.maxT * 3) + 0.02;
    p.pos.addScaledVector(dir, step); p.dist += step;
    p.vel.multiplyScalar(f); p.speed *= f;
    _tmp.copy(dir).negate();
    if (HARD.has(surf) || surf === 'wood') {
      ctx.vfx.impact(p.pos, dir, VFX_OF[surf] || surf);
      if (wh.collider) placeDecal(p.pos, _tmp, surf, 0.9);
    }
    // a round that has been through something is never quite straight again
    const yaw = (Math.random() - 0.5) * 0.035 * (1 - f);
    const pit = (Math.random() - 0.5) * 0.035 * (1 - f);
    p.vel.x += p.speed * yaw; p.vel.y += p.speed * pit;
    p.speed = p.vel.length();
    if (p.speed < SPENT) { retire(p); return 'stop'; }
    return 'through';
  }

  // ---- integration ----
  function advance(p, dt) {
    let left = dt, guard = 0;
    while (left > 1e-5 && p.live && guard++ < 10) {
      const sp = p.speed;
      if (sp < SPENT) { retire(p); return; }
      const h = Math.min(left, SEG / sp);
      left -= h;
      p.prev.copy(p.pos);
      _seg.copy(p.pos).addScaledVector(p.vel, h); _seg.y -= 0.5 * GRAV * h * h;
      // velocity at the end of the step: gravity then quadratic drag (exact for dv/dt = -k v^2)
      p.vel.y -= GRAV * h;
      const s2 = p.vel.length();
      const s3 = s2 / (1 + p.drag * s2 * h);
      if (s2 > 1e-6) p.vel.multiplyScalar(s3 / s2);
      p.speed = s3;
      _d.copy(_seg).sub(p.pos);
      const len = _d.length();
      if (len < 1e-6) continue;
      _d.divideScalar(len);
      // near miss on the player: the closest the segment comes to the eye
      if (p.source === 'enemy' && !p.whiz && !ctx.player.dead) {
        _q.copy(ctx.player.eye).sub(p.pos);
        const tc = clamp(_q.dot(_d), 0, len);
        _tmp.copy(p.pos).addScaledVector(_d, tc);
        const m = _tmp.distanceTo(ctx.player.eye);
        if (m < SUPPRESS_R && p.dist + tc > 1.5) {
          p.whiz = 1;
          const near = 1 - m / SUPPRESS_R;
          const crack = p.speed > 345;
          const name = crack && ctx.audio.has('bullet_crack') ? 'bullet_crack' : 'bullet_whiz';
          ctx.audio.play(name, { pos: _tmp, hrtf: true, gain: (crack ? 0.85 : 0.5) + 0.4 * near, rate: (crack ? 1.25 : 0.85) + Math.random() * 0.2 });
          suppress(near * (crack ? 0.55 : 0.3));
        }
      }
      // a round cracking past an entity rattles it too, if its class knows how to be rattled
      if (p.source === 'player' && p.dist > 6 && ctx.enemies && ctx.enemies.list.length && ctx.enemies.nearest) {
        const e = ctx.enemies.nearest(_seg, 3.5, null);
        if (e && e.alive && e.suppress) e.suppress(0.5, p.shooter);
      }
      const before = p.dist;
      const flying = segment(p, _d, len);
      // time of flight counts the part of the step actually flown, not the whole step: a round that
      // stops 1 m into a 9 m segment took an eighth of the segment's time, and the number is read back.
      p.tof += h * clamp01((p.dist - before) / len);
      // tracer: draw only the part actually flown this step
      if (p.tracer && p.dist > before + 0.05) {
        _from.copy(p.draw.lengthSq() > 0 ? p.draw : p.prev);
        ctx.vfx.tracer(_from, p.pos, p.pellet ? 0.012 : p.source === 'enemy' ? 0.03 : 0.02);
        p.draw.set(0, 0, 0);
      }
      if (!flying) return;
      if (p.dist >= p.maxDist) { retire(p); return; }
    }
  }

  const api = {
    isStub: false,
    get decals() { return decals; },
    get suppression() { return clamp01(supp); },
    get inFlight() { return live.length; },
    projectiles: live,
    MAT,
    // shoot(origin, dir, { ammo (def|id), damage, range, cls, spreadDeg, pellets, tracer, source:'player'|'enemy',
    //   kind:'bullet', shooter, tracerFrom, pen, what, zeroRange, muzzleVelocity, aimBias:[yaw,pitch] })
    //   -> array of shot records, one per pellet: { hits[], tof, dist, speed, done, ... }
    shoot(origin, dir, opts = {}) {
      const a = typeof opts.ammo === 'string' ? AMMO[opts.ammo] || null : opts.ammo || null;
      const damage = opts.damage ?? a?.damage ?? 10;
      const range = opts.range ?? (opts.cls && RANGE_BY_CLS[opts.cls]) ?? 60;
      const spreadDeg = opts.spreadDeg ?? 0, pellets = Math.max(1, (opts.pellets ?? a?.pellets ?? 1) | 0);
      const source = opts.source || 'player', kind = opts.kind || 'bullet', shooter = opts.shooter || null;
      const v0 = Math.max(60, opts.muzzleVelocity ?? a?.speed ?? 340);
      const drag = (DRAG_CAL[a?.cal] ?? 1.1e-3) * (DRAG_KIND[a?.kind] ?? 1) * (opts.drag ?? 1);
      const pen = opts.pen ?? a?.pen ?? 2;
      const isMg = opts.cls === 'mg' || !!opts.mg;
      // tracers: tracer rounds always, every fifth MG round; entities that name no ammunition get the MG rule
      const tracerMode = opts.tracer === false ? 'none' : a?.tracer ? 'all' : (isMg || !a) && opts.tracer !== false ? 'fifth' : 'none';
      const maxDist = clamp(range * 1.8, 120, 420);   // past this the fog has swallowed it anyway
      const zeroR = opts.zeroRange ?? ZERO_BY_CLS[opts.cls] ?? 60;
      const out = [];
      _d.copy(dir); if (_d.lengthSq() < 1e-9) _d.set(0, 0, -1); _d.normalize();
      _u.set(0, 1, 0); if (Math.abs(_d.y) > 0.99) _u.set(1, 0, 0);
      _r.crossVectors(_d, _u).normalize(); _u.crossVectors(_r, _d).normalize();
      // sights: elevate the bore so the round crosses the line of sight at the zero range
      const th = zeroAngle(v0, drag, zeroR);
      if (th > 0) _d.addScaledVector(_u, Math.tan(th)).normalize();
      // a canted weapon, wear, a shifted zero: a fixed bias in the shooter's own frame
      if (opts.aimBias) { _d.addScaledVector(_r, opts.aimBias[0]).addScaledVector(_u, opts.aimBias[1]).normalize(); }
      const half = Math.tan(spreadDeg * 0.5 * DEG);
      for (let i = 0; i < pellets; i++) {
        // uniform disc for pellet patterns; bullets cluster toward the centre
        const ang = Math.random() * TAU;
        const rr = (pellets > 1 ? Math.sqrt(Math.random()) : (Math.random() + Math.random()) * 0.5) * half;
        _p.copy(_d).addScaledVector(_r, Math.cos(ang) * rr).addScaledVector(_u, Math.sin(ang) * rr).normalize();
        mgCount++;
        const p = take();
        p.live = true; p.done = false; p.hits.length = 0;
        p.pos.copy(origin); p.prev.copy(origin);
        p.vel.copy(_p).multiplyScalar(v0);
        p.v0 = v0; p.speed = v0; p.drag = drag; p.pen = pen; p.damage = damage;
        p.ammo = a; p.kind = kind; p.source = source; p.shooter = shooter; p.what = opts.what || null;
        p.pellet = pellets > 1; p.cls = opts.cls || null;
        p.dist = 0; p.tof = 0; p.maxDist = maxDist; p.ric = 0; p.pierced = 0; p.whiz = 0; p.hitPlayer = false;
        p.born = ctx.elapsed;
        p.tracer = tracerMode === 'all' || (tracerMode === 'fifth' && mgCount % 5 === 0);
        p.draw.copy(opts.tracerFrom || origin);
        live.push(p);
        out.push(p);
        // resolve the first few metres now, so a shot inside a room lands on the frame it was fired
        advance(p, SYNC);
      }
      return out;
    },
    // straight test without damage (lasers, aim assists): { distance, point, enemy? } or null
    probe(origin, dir, maxDist = 60) {
      const eh = ctx.enemies.raycast(origin, dir, maxDist);
      const wh = ctx.world.raycast(origin, dir, eh ? eh.distance : maxDist);
      if (eh && (!wh || eh.distance < wh.distance)) return eh;
      return wh;
    },
    // where a round of this ammunition would be, relative to the sight line, at this range (metres, + = high)
    holdover(ammo, range, cls) {
      const a = typeof ammo === 'string' ? AMMO[ammo] : ammo;
      const v0 = Math.max(60, a?.speed ?? 340);
      const k = (DRAG_CAL[a?.cal] ?? 1.1e-3) * (DRAG_KIND[a?.kind] ?? 1);
      const t = (Math.exp(k * range) - 1) / (k * v0);
      const zero = ZERO_BY_CLS[cls] ?? 60;
      return Math.tan(zeroAngle(v0, k, zero)) * range - 0.5 * GRAV * t * t;
    },
    clear() { for (let i = live.length - 1; i >= 0; i--) retire(live[i]); },
    update(dt) {
      if (dt > 0) {
        supp = Math.max(0, supp - dt * 0.85);
        for (let i = live.length - 1; i >= 0; i--) {
          const p = live[i];
          if (!p || !p.live) continue;
          advance(p, dt);
          // nothing lives forever: a round that has been in the air for four seconds is gone
          if (p.live && ctx.elapsed - p.born > 4) retire(p);
        }
      }
    },
  };
  ctx.events.on('gameStart', () => { api.clear(); supp = 0; });
  ctx.events.on('respawn', () => { api.clear(); supp = 0; });
  return api;
}
