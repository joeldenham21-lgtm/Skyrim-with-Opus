// senses.js — the only place an entity learns anything about the Explorer.
//
// THE FAIRNESS SEAM. Everything else in enemies/ reads `m.lastSeenPlayer`, `m.beliefR`, `m.lastVisT`, the
// squad picture and the Director. THIS file reads `ctx.player`, and it is the only one that is allowed to.
// Nothing here decides anything: it converts photons, footfalls, muzzle flash and a body on the ground into
// calls to `m.believe(pos, radius, t, weight)` — a place, and how wrong it might be — and hands back an
// awareness gain. If a mimic knows where you are, a sense in this file put it there, with an error attached.
//
// What it models, in the order it matters:
//
//   SIGHT — three cones, one dot product. A 22-degree FOCUS cone is a SIGHTING (radius 0, lastVisT set); the
//   22..78-degree PERIPHERAL cone at half range is NOT — it files a 3.5 m guess and a flicker of alarm,
//   "something moved over there", which is the thing that makes a mimic feel like it has eyes rather than a
//   trigger. Inside 6 m the NEAR cone sees you regardless of facing. All three share the same two LOS rays,
//   so the whole split costs nothing.
//
//   LIGHT — night shortens the world to 22 m. A torch or a weapon light lengthens it by 50 m, brightens you
//   by 0.8, strips 0.35 of your concealment and, swung across a mimic's face, IS a contact. Rain greys it.
//
//   CONCEALMENT — the camouflage half of the same equation, and the player controls every term of it:
//   crouched, still, in the grass, in the flora, torch off. Symmetric, so it is learnable: the same four
//   things that make you hard to see are the four things you can choose.
//
//   HEARING — surface-weighted. Metal deck is 1.35, grass is 0.55, and sprinting is 1.55 while crouching is
//   0.45, so the same walk is heard at 22 m or at 6 m depending entirely on how you took it. Gunfire comes
//   through the Director's ring already scaled by how loud the round was — a suppressor really is a third of
//   the problem. Hearing NEVER hands over the player's position: it hands over where the NOISE was, with an
//   error that shrinks along the skill curve.
//
//   MUZZLE FLASH — a genuinely separate channel. At night, with a line, a shot is SEEN whether or not it was
//   heard. That is the trade the suppressor buys you: quiet and visible, or loud and dark, but not both.
//
//   BODIES — a mimic that walks up on a dead mate files evidence with the Director and a nine-metre guess.
//   It does not know where you are. It knows where it happened.
//
//   DECAY — and then the whole thing goes stale. `spreadRate` is the metres per second the belief radius
//   widens once nobody can see you, and it is the difference between "confused by a tree" and "waiting on
//   the far side": a squad that has read your habits keeps the picture tight through an occlusion, a squad
//   that has not is worse than today. Firm contact -> stale belief -> a search over widening ground.
//
// COST. The whole player half of the model (surface, concealment, flora, light, noise) is identical for every
// mimic alive, so it is computed ONCE per ~0.15 s into a module-level record and read by everybody. Per mimic
// per perception tick: about thirty compares and the same two rays the base class already fired. Corpse
// checks and the flash's fallback ray are the only new rays and they come out of the shared tactical budget.
//
// This module imports nothing from enemies/. It takes entity-like objects (anything with position, yaw,
// height, skill, believe(), aware, lastVisT) and a ctx, so it can be unit-tested on its own against the real
// terrain and colliders — see tools/scenarios/ai2-senses-*.mjs.
import * as THREE from 'three';
import { clamp01, lerp } from '../core/math.js';

// =====================================================================================================
// THE CURVE. Merged into mimic.js's SKILL table by the integrator (see ARCHITECTURE of this work, C2).
// A plain literal with no dependency on any import, so the merge is safe under the module cycle.
// =====================================================================================================
export const SKILL_ROWS = {
  focus:    [0.85, 1.30],   // gain inside the 22-degree focus cone: how good its scan actually is
  periph:   [0.20, 0.80],   // gain in the peripheral cone: whether movement at the edge registers at all
  flash:    [0.10, 0.90],   // muzzle-flash detection at night (range and probability both lerp on this)
  noteBody: [0.00, 0.90],   // will register a dead mate as evidence and file it (>= 0.30)
};

// =====================================================================================================
// Tuning. Everything a designer would want to move, in one place, none of it a difficulty number.
// =====================================================================================================
export const CONE = { focus: 22, periph: 78, nearR: 6, periphRange: 0.5 };
export const NIGHT_RANGE = 22;        // m the world shrinks to at full dark
export const TORCH_RANGE = 50;        // m a lit torch adds back at full dark
export const STILL_VIS = 0.62;        // a stationary silhouette against dead birches
export const VIS_GAIN = 1.6;          // the base class's final clamp01(vis * 1.6)
export const STEP_R = 14;             // m footsteps carry
export const STEP_R_SPRINT = 18;      // m a sprint on a hard surface carries
export const SHOT_R = 55;             // m handed to director.nearestShot (it scales by the round's loudness)
export const FLASH_R = [70, 200];     // m a muzzle flash registers at, at skill.flash 0 .. 1
export const FLASH_NIGHT = 0.35;      // night level below which there is no flash to see
export const FLASH_NEAR = 24;         // m inside which a flash is registered whatever the entity was facing
export const BODY_R = 8;              // m a corpse is recognised at
export const BODY_EVERY = 1.5;        // s between corpse checks
export const BELIEF_MAX = 40;         // m the belief radius is allowed to widen to before it is meaningless
export const SPREAD = [1.15, 0.45];   // m/s the belief widens: no read of you .. a squad that has read you
export const PLAYER_HZ = 0.15;        // s between refreshes of the shared player-side model
export const FLORA_R = 2.2;           // m radius the flora query covers
export const FLORA_MAX = 6;           // colliders tested before we stop counting
export const FLORA_FULL = 3;          // stems within FLORA_R that count as full flora concealment

// How loud a footfall is by what it lands on. The player hears the same table through sfx.js's step_* names,
// which is what makes it learnable: the road sounds like the road, and the road is where they hear you.
export const SURFACE_NOISE = { grass: 0.55, mud: 0.70, road: 1.00, rock: 0.85, water: 1.15, concrete: 1.00, metal: 1.35, wood: 1.10 };
// And how much it hides you. Marsh and grass break a silhouette; a road does not.
export const SURFACE_CONCEAL = { grass: 0.22, mud: 0.26, road: 0.00, rock: 0.08, water: 0.14, concrete: 0.04, metal: 0.02, wood: 0.06 };

// perception cadence, by how interested the entity is (mimic.js already uses exactly these numbers)
const EVERY_ENGAGED = 0.12, EVERY_ALERT = 0.2, EVERY_IDLE = 0.35;

// =====================================================================================================
// Shared per-frame ray budget. traversal.js owns the real one (contract C4); until the integrator injects
// it this is a behaviourally identical local pool, so the module runs and tests standalone.
//   integrator:  senses.setRayBudget(traversal.losBudget)
// =====================================================================================================
export const TACTICAL_PER_FRAME = 10;
let losFrame = -1, losLeft = 0;
function localBudget(ctx, want) {
  if (ctx.frame !== losFrame) { losFrame = ctx.frame; losLeft = TACTICAL_PER_FRAME; }
  if (losLeft < want) return false;
  losLeft -= want; return true;
}
let budget = localBudget;
export function setRayBudget(fn) { budget = typeof fn === 'function' ? fn : localBudget; }

// =====================================================================================================
// Module scratch. Nothing in this file allocates after load.
// =====================================================================================================
const _eye = new THREE.Vector3(), _chest = new THREE.Vector3(), _bel = new THREE.Vector3(), _shot = new THREE.Vector3();
const EMPTY_SKILL = {};

// counters, for scenarios and the bench
// `rays` are the entity's OWN perception rays — the same one or two the base class already fired, on the
// same cadence, so this module is ray-neutral against today for sight. `budgeted` are the new ones, and
// they are the only ones that come out of the shared tactical pool.
export const COUNT = { ticks: 0, full: 0, rays: 0, budgeted: 0, sightings: 0, periph: 0, near: 0, steps: 0, shots: 0, flashes: 0, bodies: 0, floraQ: 0, playerRefresh: 0 };

// The last shot the PLAYER fired. Written from the Director's own notification, which weapons.js raises; a
// mimic's own fire never comes through this channel. One record, no allocation, read by everybody.
const SHOT = { x: 0, y: 0, z: 0, t: -1e9, noise: 1, seq: 0 };
// Bodies on the ground: a ring of eight, written when one of theirs folds, read by whoever walks up on it.
const BODIES = []; for (let i = 0; i < 8; i++) BODIES.push({ x: 0, y: 0, z: 0, t: -1e9, seq: -1, live: false });
let bodySeq = 0, bodyHead = 0;
// The player half of the model. Identical for every entity, so it is computed once and shared.
const PLAYER = {
  t: -1e9, x: 0, y: 0, z: 0, ex: 0, ey: 0, ez: 0,
  dead: true, inBase: false, moving: false, crouched: false, sprinting: false,
  noise: 0, surf: 'grass', surfNoise: 0.55, conceal: 0, flora: 0,
  night: 0, torch: 0, gunLight: 0, light: 0, rain: 0, maxAdd: 0, lightVis: 1,
  fwdX: 0, fwdZ: -1,
};
let installedFor = null;

// =====================================================================================================
// Install. Idempotent; createSenses() calls it, so the integrator does not have to remember to.
// =====================================================================================================
export function installSenses(ctx) {
  if (!ctx || installedFor === ctx) return;
  installedFor = ctx;
  resetSenses();
  ctx.events.on('directorNotify', (kind, data) => {
    // weapons.js is the only caller of director.notify('shot'), so this channel is the Explorer's fire and
    // nobody else's. It is a fact about the world (a shot happened, there, then, that loud) — every entity
    // then decides on its own whether it heard it or saw it.
    if (kind !== 'shot' || !data || !data.pos) return;
    SHOT.x = data.pos.x; SHOT.y = data.pos.y; SHOT.z = data.pos.z;
    SHOT.t = ctx.elapsed; SHOT.noise = data.noise == null ? 1 : data.noise; SHOT.seq++;
  });
  ctx.events.on('enemyKilled', (e) => { if (e && e.position) noteBody(e.position.x, e.position.y, e.position.z, ctx.elapsed); });
  ctx.events.on('gameStart', resetSenses);
  ctx.events.on('tide', resetSenses);
}

// A body somebody will find. Public so kit.js / population.js can file one that senses did not witness.
export function noteBody(x, y, z, t) {
  const b = BODIES[bodyHead]; bodyHead = (bodyHead + 1) % BODIES.length;
  b.x = x; b.y = y; b.z = z; b.t = t; b.seq = bodySeq++; b.live = true;
}

export function resetSenses() {
  SHOT.t = -1e9; SHOT.seq = 0; PLAYER.t = -1e9;
  for (const b of BODIES) { b.live = false; b.seq = -1; b.t = -1e9; }
  bodySeq = 0; bodyHead = 0; losFrame = -1;
  for (const k in COUNT) COUNT[k] = 0;
}

export function stats() {
  return {
    ticks: COUNT.ticks, full: COUNT.full, rays: COUNT.rays, sightings: COUNT.sightings, periph: COUNT.periph,
    budgeted: COUNT.budgeted, near: COUNT.near, steps: COUNT.steps, shots: COUNT.shots, flashes: COUNT.flashes,
    bodies: COUNT.bodies, floraQ: COUNT.floraQ, playerRefresh: COUNT.playerRefresh,
  };
}

// =====================================================================================================
// Skill access. Reads the merged row off the entity when the integrator has merged SKILL_ROWS into
// mimic.js's SKILL table, and falls back to interpolating a row at the entity's progress when it has not —
// so the module is correct both before and after wiring, and a Seeker or a Slider with no rows at all still
// senses sanely. `earErr` belongs to mimic.js's table, not ours; we consume it, so it has a fallback here.
// =====================================================================================================
const ROW_FALLBACK = { focus: SKILL_ROWS.focus, periph: SKILL_ROWS.periph, flash: SKILL_ROWS.flash, noteBody: SKILL_ROWS.noteBody, earErr: [10, 1.6] };
function row(m, key) {
  const s = m.skill || EMPTY_SKILL;
  const v = s[key];
  if (v != null) return v;
  const r = ROW_FALLBACK[key];
  return r[0] + (r[1] - r[0]) * clamp01(s.p == null ? 0 : s.p);
}

// deterministic 0..1 from a mimic's own wobble seed and an event id: the same mimic misses the same flashes
// every run, which is what makes any of this testable.
function hash01(a, b) {
  let h = (Math.imul((a * 8191) | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// =====================================================================================================
// The player half of the model, refreshed at PLAYER_HZ and shared by every entity alive.
// =====================================================================================================
export function playerSurface(ctx, x, z, y) {
  const w = ctx.world;
  // the collider top you are standing on decides first (a catwalk is metal, the mud under it is not)
  const g = w.groundHeight(x, z, (y == null ? w.getHeight(x, z) : y) + 0.35);
  return g.surface || w.getSurface(x, z);
}

// Stems within FLORA_R. flora.js tags its trunk and bush colliders 'flora'; if a build registers none the
// term is simply inert. Never called more than once per PLAYER_HZ, whatever the entity count.
export function floraNear(ctx, x, z) {
  const w = ctx.world;
  if (!w.query) return 0;
  let n = 0, tested = 0;
  COUNT.floraQ++;
  w.query(x, z, FLORA_R, (c) => {
    if (tested++ > FLORA_MAX) return false;
    if (!c.tag || c.tag.charCodeAt(0) !== 102 /* f */ || c.tag.indexOf('flora') !== 0) return;
    const dx = (c.kind === 'cyl' ? c.x : (c.min.x + c.max.x) * 0.5) - x;
    const dz = (c.kind === 'cyl' ? c.z : (c.min.z + c.max.z) * 0.5) - z;
    if (dx * dx + dz * dz < FLORA_R * FLORA_R) n++;
  });
  return clamp01(n / FLORA_FULL);
}

// 0..1 of the player's cover FROM VIEW. Every term is something the player chose, which is what makes the
// stealth half of this game legible: crouch, stop, get off the road, get in the flora, put the torch out.
export function concealment(ctx, x, z, crouched, moving, opts = {}) {
  let c = 0;
  if (crouched) c += 0.30;
  if (!moving) c += 0.18;
  const surf = opts.surface || playerSurface(ctx, x, z, opts.y);
  c += SURFACE_CONCEAL[surf] == null ? 0.10 : SURFACE_CONCEAL[surf];
  c += (opts.flora == null ? floraNear(ctx, x, z) : opts.flora) * 0.20;
  // A light is anti-camouflage, and at night it dominates everything else on this list. In daylight it is
  // only a bright point on a man who was already lit, so the penalty rides the night curve with a floor.
  const night = opts.night == null ? (ctx.time ? ctx.time.night : 1) : opts.night;
  const pen = 0.25 + 0.75 * night;
  if (opts.torch) c -= 0.35 * pen;
  if (opts.gunLight) c -= 0.30 * pen;
  return clamp01(c);
}

function refreshPlayer(ctx) {
  const t = ctx.elapsed;
  if (t - PLAYER.t < PLAYER_HZ && t >= PLAYER.t) return PLAYER;
  PLAYER.t = t; COUNT.playerRefresh++;
  const p = ctx.player;
  PLAYER.dead = !!p.dead; PLAYER.inBase = !!p.inBase;
  PLAYER.x = p.position.x; PLAYER.y = p.position.y; PLAYER.z = p.position.z;
  PLAYER.ex = p.eye.x; PLAYER.ey = p.eye.y; PLAYER.ez = p.eye.z;
  PLAYER.fwdX = p.forward.x; PLAYER.fwdZ = p.forward.z;
  PLAYER.moving = !!p.moving; PLAYER.crouched = !!p.crouched; PLAYER.sprinting = !!p.sprinting;
  PLAYER.noise = p.noise || 0;
  PLAYER.night = ctx.time ? ctx.time.night : 0;
  const fl = ctx.state && ctx.state.data ? ctx.state.data.flashlight : null;
  PLAYER.torch = fl && fl.on && (fl.battery == null || fl.battery > 0) ? 1 : 0;
  const li = ctx.lighting;
  PLAYER.gunLight = li && ((li.weaponLightTarget || 0) > 0.5 || (li.headlampTarget || 0) > 0.5) ? 1 : 0;
  PLAYER.light = Math.max(PLAYER.torch, PLAYER.gunLight);
  PLAYER.rain = li ? clamp01((li.storm || 0) * 4) : 0;
  PLAYER.surf = playerSurface(ctx, PLAYER.x, PLAYER.z, PLAYER.y);
  PLAYER.surfNoise = SURFACE_NOISE[PLAYER.surf] == null ? 0.9 : SURFACE_NOISE[PLAYER.surf];
  PLAYER.flora = floraNear(ctx, PLAYER.x, PLAYER.z);
  PLAYER.conceal = concealment(ctx, PLAYER.x, PLAYER.z, PLAYER.crouched, PLAYER.moving,
    { surface: PLAYER.surf, flora: PLAYER.flora, torch: PLAYER.torch, gunLight: PLAYER.gunLight, y: PLAYER.y, night: PLAYER.night });
  // how far the world reaches, and how bright you are in it
  PLAYER.maxAdd = PLAYER.torch * PLAYER.night * TORCH_RANGE;
  PLAYER.lightVis = lerp(1, 0.45 + PLAYER.light * 0.8, PLAYER.night) * (1 - PLAYER.rain * 0.18);
  return PLAYER;
}

// exposed so scenarios (and the bench) can read the shared player model without recomputing it
export function playerModel(ctx) { return refreshPlayer(ctx); }

// =====================================================================================================
// Per-entity state
// =====================================================================================================
export function createSenses(m) {
  installSenses(m.ctx);
  m.sense = {
    acc: 0, lastT: -1e9, step: 0,
    vis: 0, mode: 0,                // 0 nothing | 1 focus | 2 peripheral | 3 near
    lit: 0, hear: 0, gain: 0,
    hearKind: 0,                    // 0 none | 1 step | 2 shot
    hx: 0, hz: 0, hr: 0,            // where the noise was, and how wrong that is
    conceal: 0, dist: 0, cos: 1, maxD: 80,
    maxDay: 80, periphDeg: CONE.periph,   // set by the caller through senseTick's opts (fov / maxDay)
    los: false, losT: -1e9,         // was a line held on the last full tick, and when
    flashSeq: -1, flashT: -1e9,
    bodyT: 0, bodySeen: 0,          // per-mimic bitmask over the BODIES ring
    lastBody: null,
    spread: SPREAD[0],
    rays: 0,
  };
  if (m.beliefSeed == null) m.beliefSeed = Math.random();
  // Mimics bring their own believe() and it is the authoritative one — this is only so the module can be
  // driven against a bare entity (a Seeker, a Spawn, a test stub) that has no belief model of its own.
  if (typeof m.believe !== 'function') { m.__senseBelief = true; m.believe = defaultBelieve; }
  return m.sense;
}

// The same contract as mimic.js believe(): a sighting (radius 0) outranks any guess for 1.2 s, and a guess
// is displaced around the true point by a wobble that is stable per entity and per second, so two entities
// guess two different wrong places and neither walks onto your feet.
function defaultBelieve(pos, radius, t, weight = 0.5, force = false) {
  if (!pos) return;
  if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3();
  if (!force && radius > 0.05 && t - (this.lastVisT || -1e9) < 1.2) return;
  if (!force && radius > 0.05 && radius > (this.beliefR || 0) + 3 && t - (this.lastSeenT || -1e9) < 2.5) return;
  if (radius > 0.05) {
    const a = (this.beliefSeed + Math.floor(t * 0.7) * 0.317) * Math.PI * 2;
    const rr = radius * (0.3 + 0.7 * Math.abs(Math.sin(this.beliefSeed * 37.1 + Math.floor(t * 0.7))));
    this.lastSeenPlayer.set(pos.x + Math.cos(a) * rr, pos.y, pos.z + Math.sin(a) * rr);
  } else this.lastSeenPlayer.copy(pos);
  this.lastSeenT = t; this.beliefR = radius > 0 ? radius : 0;
}

function ensure(m) { return m.sense || createSenses(m); }

// =====================================================================================================
// SIGHT. Three cones off one dot product, two rays shared between them.
// =====================================================================================================
export function sight(m, out) {
  const s = out || ensure(m);
  const ctx = m.ctx, P = refreshPlayer(ctx);
  s.vis = 0; s.mode = 0; s.lit = 0; s.los = false;
  if (P.dead || P.inBase) return s;
  const dx = P.x - m.position.x, dz = P.z - m.position.z;
  const d = Math.hypot(dx, dz) || 1e-4;
  s.dist = d;
  const maxD = lerp(s.maxDay == null ? 80 : s.maxDay, NIGHT_RANGE, P.night) + P.maxAdd;
  s.maxD = maxD;
  if (d > maxD) return s;
  // ONE dot product decides which of the three cones you are in. yaw 0 faces -z.
  const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
  const c = (fx * dx + fz * dz) / d;
  s.cos = c;
  const periphDeg = s.periphDeg == null ? CONE.periph : s.periphDeg;
  let mode = 0, gain = 0;
  if (d <= CONE.nearR) { mode = 3; gain = 1; }
  else if (c >= Math.cos(CONE.focus * Math.PI / 180)) { mode = 1; gain = row(m, 'focus'); }
  else if (c >= Math.cos(periphDeg * Math.PI / 180) && d <= maxD * CONE.periphRange) { mode = 2; gain = row(m, 'periph'); }
  if (!mode) return s;
  // smoke is opaque and free to test
  const w = ctx.world;
  _eye.set(m.position.x, m.position.y + (m.height || 1.8) * 0.9, m.position.z);
  _chest.set(P.ex, P.ey, P.ez);
  if (w.smokeBlocks && w.smoke && w.smoke.length && w.smokeBlocks(_eye, _chest)) return s;
  // the line: head first, chest second. Exactly the two rays the base class already fired.
  COUNT.rays++; s.rays++;
  let los = w.lineOfSight(_eye, _chest);
  if (!los) { _chest.set(P.x, P.y + (ctx.player.eyeHeight || 1.7) * 0.65, P.z); COUNT.rays++; s.rays++; los = w.lineOfSight(_eye, _chest); }
  if (!los) return s;
  s.los = true; s.losT = ctx.elapsed;
  s.conceal = P.conceal;
  let vis = (1 - d / maxD) * gain * (1 - P.conceal) * (P.moving ? 1 : STILL_VIS) * P.lightVis;
  vis = clamp01(vis * VIS_GAIN);
  // A beam swung across a mimic's face is a contact, and it knows it has been lit. This is the one place a
  // light makes you MORE visible than distance and cone would allow, and it is the point of the torch.
  if (vis > 0 && P.night > 0.3 && P.light) {
    const bx = m.position.x - P.ex, bz = m.position.z - P.ez;
    const bl = Math.hypot(bx, bz) || 1;
    const facing = (bx / bl) * P.fwdX + (bz / bl) * P.fwdZ;
    if (facing > 0.80 && bl < 75) { s.lit = (facing - 0.80) * 3.4 * P.night; vis = clamp01(vis + s.lit); m.litT = ctx.elapsed; }
  }
  s.vis = vis; s.mode = mode;
  return s;
}

// =====================================================================================================
// HEARING. What made it, what it was made on, how it was made, and how far it carried.
// Never returns a player position: it returns where the NOISE was.
// =====================================================================================================
export function hearing(m, out) {
  const s = out || ensure(m);
  const ctx = m.ctx, P = refreshPlayer(ctx);
  s.hear = 0; s.hearKind = 0; s.hr = 0;
  const dir = ctx.director;
  // gunfire first: it outranks footsteps, and the Director already scaled its reach by the round's loudness
  let shots = 0;
  if (dir && dir.nearestShot) shots = dir.nearestShot(m.position, SHOT_R, _shot);
  if (shots > 0.05) {
    s.hearKind = 2; s.hx = _shot.x; s.hz = _shot.z;
    s.hr = row(m, 'earErr') * (1.15 - shots * 0.55);
    s.hear = clamp01(shots * 1.6);
    return s;
  }
  if (P.dead || P.inBase) return s;
  const dx = P.x - m.position.x, dz = P.z - m.position.z;
  const d = Math.hypot(dx, dz);
  const hard = P.surfNoise >= 1.0;
  const reach = P.sprinting && hard ? STEP_R_SPRINT : STEP_R;
  if (d >= reach) return s;
  const stance = P.crouched ? 0.45 : P.sprinting ? 1.55 : 1.0;
  const level = P.noise * P.surfNoise * stance * (1 - d / reach) * (1 - P.rain * 0.25);
  if (level <= 0.12) return s;
  s.hearKind = 1; s.hx = P.x; s.hz = P.z;
  s.hr = row(m, 'earErr') * 0.5 * (1.1 - clamp01(level) * 0.6);
  s.hear = clamp01(level * 1.2);
  return s;
}

// =====================================================================================================
// MUZZLE FLASH. Independent of whether the round was audible — which is exactly what stops a suppressor
// being a magic cloak at night, and gives the player a real choice instead of a dominant one.
// =====================================================================================================
export function muzzleFlash(m) {
  const s = ensure(m), ctx = m.ctx, P = refreshPlayer(ctx), t = ctx.elapsed;
  if (P.night <= FLASH_NIGHT) return 0;
  if (SHOT.seq === s.flashSeq || SHOT.t < 0) return 0;
  const age = t - SHOT.t;
  if (age > Math.max(0.4, s.step + 0.05)) { s.flashSeq = SHOT.seq; return 0; }
  const fs = row(m, 'flash');
  const dx = SHOT.x - m.position.x, dz = SHOT.z - m.position.z;
  const d = Math.hypot(dx, dz);
  const fr = lerp(FLASH_R[0], FLASH_R[1], fs);
  if (d > fr) { s.flashSeq = SHOT.seq; return 0; }
  // A flash behind a man's head is not seen. Inside FLASH_NEAR it does not have to be: at that range the
  // flash lights the ground he is standing on, and he is looking at the light before he knows why.
  if (d > FLASH_NEAR) {
    const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
    if ((fx * dx + fz * dz) / d < Math.cos((s.periphDeg == null ? CONE.periph : s.periphDeg) * Math.PI / 180)) { s.flashSeq = SHOT.seq; return 0; }
  }
  // The roll is a pure function of this mimic's wobble and the shot's id, so it is stable across retries:
  // a mimic that loses the ray budget this frame gets the SAME answer next tick, not a second lottery.
  const chance = fs * (0.45 + 0.55 * (1 - d / fr)) * clamp01((P.night - FLASH_NIGHT) / 0.45);
  if (hash01(m.beliefSeed, SHOT.seq) > chance) { s.flashSeq = SHOT.seq; return 0; }
  // the line. Free if this tick's sight() already held one; otherwise one budgeted ray. If the pool is
  // spent, leave the shot unconsumed and try again on the next tick inside the window.
  let los = s.los && t - s.losT < 0.4;
  if (!los) {
    if (!budget(ctx, 1)) return 0;
    COUNT.budgeted++; s.rays++;
    _eye.set(m.position.x, m.position.y + (m.height || 1.8) * 0.9, m.position.z);
    _chest.set(SHOT.x, SHOT.y + 0.2, SHOT.z);
    los = ctx.world.lineOfSight(_eye, _chest);
  }
  s.flashSeq = SHOT.seq;
  if (!los) return 0;
  s.flashT = t; COUNT.flashes++;
  _bel.set(SHOT.x, SHOT.y, SHOT.z);
  m.believe(_bel, 2.0, t, 0.85 * fs);
  if (m.aware < 0.70) m.aware = 0.70;
  return clamp01(chance);
}

// =====================================================================================================
// BODIES. Evidence, not a contact: it knows where it happened, not where you went.
// =====================================================================================================
export function corpseCheck(m) {
  const s = ensure(m), ctx = m.ctx, t = ctx.elapsed;
  s.lastBody = null;
  if (row(m, 'noteBody') < 0.30) return null;
  for (let i = 0; i < BODIES.length; i++) {
    const b = BODIES[i];
    if (!b.live || b.seq < 0) continue;
    const bit = 1 << i;
    if (s.bodySeen & bit) continue;
    const dx = b.x - m.position.x, dz = b.z - m.position.z;
    if (Math.abs(dx) > BODY_R || Math.abs(dz) > BODY_R) continue;
    if (dx * dx + dz * dz > BODY_R * BODY_R) continue;
    if (!budget(ctx, 1)) return null;
    COUNT.budgeted++; s.rays++;
    _eye.set(m.position.x, m.position.y + (m.height || 1.8) * 0.9, m.position.z);
    _chest.set(b.x, b.y + 0.4, b.z);
    // one budgeted ray per call, whatever the outcome: it looked at the nearest thing it had not looked at
    // yet, and if the line was blocked it will try the next one in BODY_EVERY seconds.
    if (!ctx.world.lineOfSight(_eye, _chest)) return null;
    s.bodySeen |= bit;
    s.lastBody = b;
    COUNT.bodies++;
    _bel.set(b.x, b.y, b.z);
    ctx.director && ctx.director.noteActivity && ctx.director.noteActivity(_bel, 'blood', 1);
    m.believe(_bel, 9, t, 0.5);
    if (m.aware < 0.5) m.aware = 0.5;
    return b;
  }
  return null;
}

// =====================================================================================================
// DECAY. How a firm contact becomes a stale belief becomes a search.
// =====================================================================================================
// 0..1 — how well this entity's squad has read the player's habits. command.js owns the read; until it is
// wired this is 0, and a belief that nobody has a read on widens FASTER than today's flat rate. That is the
// intended direction: being outmanoeuvred should be earned, and a green squad should lose you behind a tree.
export function readConfidence(m) {
  const mind = m.squad && m.squad.mind;
  if (!mind) return 0;
  if (typeof mind.readConfidence === 'function') { const v = mind.readConfidence(); return v > 0 ? clamp01(v) : 0; }
  const r = mind.read;
  if (!r) return 0;
  let sum = 0, n = 0;
  for (const k in r) { const h = r[k]; if (h && typeof h.c === 'number') { sum += h.c; n++; } }
  return n ? clamp01(sum / n) : 0;
}

// metres per second the belief radius widens once nobody has a line. THE scalar that separates "confused by
// a tree" from "waiting on the far side".
export function spreadRate(m) {
  return lerp(SPREAD[0], SPREAD[1], readConfidence(m));
}

// Widen the guess. Called from senseTick; exported so a search state can age its own picture between ticks.
export function beliefDecay(m, dt) {
  const s = ensure(m), t = m.ctx.elapsed;
  // nothing to be wrong about: an entity that has never had a contact has no belief to widen
  if ((m.lastSeenT == null ? -1e9 : m.lastSeenT) < -1e8) return m.beliefR || 0;
  const age = t - (m.lastVisT == null ? -1e9 : m.lastVisT);
  if (age <= 1.2) return m.beliefR || 0;
  const rate = spreadRate(m); s.spread = rate;
  const r = Math.max(m.beliefR || 0, 2.5) + rate * dt;
  m.beliefR = r > BELIEF_MAX ? BELIEF_MAX : r;
  return m.beliefR;
}

// How often this entity is worth sensing for: 0.12 s in a fight, 0.2 s alert, 0.35 s idle — the numbers
// mimic.js already uses. senseTick enforces it internally, so a caller may drive it every frame instead.
export function senseCadence(m) { return m.engaged ? EVERY_ENGAGED : (m.aware > 0.35 ? EVERY_ALERT : EVERY_IDLE); }

// =====================================================================================================
// THE ENTRY POINT. One call per entity per tick; the caller may run it every frame or on its own cadence.
// Returns the entity's pooled sense record: { vis, hear, mode, lit, conceal, ... }.
// =====================================================================================================
export function senseTick(m, dt, opts) {
  const s = ensure(m), ctx = m.ctx, t = ctx.elapsed;
  COUNT.ticks++;
  s.acc += dt;
  const every = senseCadence(m);
  if (s.acc < every * 0.98) {
    // cheap path: no rays, no player refresh, just the guess going stale
    beliefDecay(m, dt);
    return s;
  }
  const step = s.acc; s.acc = 0; s.step = step; s.lastT = t; s.rays = 0;
  COUNT.full++;
  refreshPlayer(ctx);
  s.maxDay = opts && opts.maxDay != null ? opts.maxDay : 80;
  s.periphDeg = opts && opts.fov != null ? Math.min(CONE.periph, opts.fov * 0.5) : CONE.periph;

  sight(m, s);
  hearing(m, s);

  // ---- file what it learned. This is the ONLY place beliefs are born. ----
  if (s.mode === 1 || s.mode === 3) {
    // a sighting: radius 0, and the clock that everything else in mimic.js hangs off
    _bel.set(PLAYER.x, PLAYER.y, PLAYER.z);
    m.believe(_bel, 0, t, 1);
    m.lastVisT = t;
    if (s.mode === 1) COUNT.sightings++; else COUNT.near++;
  } else if (s.mode === 2 && s.vis > 0.02) {
    // NOT a sighting. Something moved over there, and it is worth turning round for.
    COUNT.periph++;
    _bel.set(PLAYER.x, PLAYER.y, PLAYER.z);
    m.believe(_bel, 3.5, t, 0.45);
    if (m.aware < 0.55) m.aware = 0.55;
  }
  if (s.hearKind === 2) {
    COUNT.shots++;
    _bel.set(s.hx, PLAYER.y, s.hz);
    m.believe(_bel, s.hr, t, 0.55);
    if (m.aware < 0.45) m.aware = 0.45;
  } else if (s.hearKind === 1) {
    COUNT.steps++;
    _bel.set(s.hx, PLAYER.y, s.hz);
    m.believe(_bel, s.hr, t, 0.35);
  }

  // muzzle flash is its own channel and runs whether or not anything else registered
  muzzleFlash(m);

  // corpses, on their own slow clock
  s.bodyT -= step;
  if (s.bodyT <= 0) { s.bodyT = BODY_EVERY; corpseCheck(m); }

  // ---- awareness, exactly the base class's integrator so nothing downstream changes shape ----
  const visGain = opts && opts.visGain != null ? opts.visGain : 1.4;
  const hearGain = opts && opts.hearGain != null ? opts.hearGain : 1.0;
  const decay = opts && opts.decay != null ? opts.decay : 0.08;
  const gain = Math.max(s.vis * visGain, s.hear * hearGain);
  s.gain = gain;
  if (gain > 0.02) m.aware = clamp01(m.aware + gain * step);
  else m.aware = Math.max(0, m.aware - step * decay);
  // the same two threshold crossings the base class's perceive() owns, so replacing it is a one-liner.
  // Pass { engage: false } to keep them and drive the transitions yourself.
  if (!opts || opts.engage !== false) {
    if (m.aware >= 1 && !m.engaged) { m.engaged = true; ctx.director && ctx.director.notify('spotted', { enemy: m }); m.onSpotted && m.onSpotted(); }
    else if (m.aware <= 0.05 && m.engaged) { m.engaged = false; ctx.director && ctx.director.notify('lost', { enemy: m }); }
  }

  // decay is continuous, so it is charged per FRAME, never per tick: the cheap path above charged every
  // frame we skipped, and this charges the one we did not.
  beliefDecay(m, dt);
  return s;
}

// The brief's signature: perceive(entity, ctx, dt) -> belief updates. Same work, explicit ctx, so the module
// can be driven against a bare entity-like object in a test with no Mimic anywhere in sight.
export function perceive(m, ctx, dt, opts) {
  if (ctx && !m.ctx) m.ctx = ctx;
  return senseTick(m, dt, opts);
}
