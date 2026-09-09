// Traversal — what a mimic's BODY can do, and what it costs.
//
// Everything in this file is a committed physical act that takes time and cannot be taken back: a vault, a
// clamber onto a ledge, a drop off a roof, a dive into cover, a takedown, a sprint that spends wind. It knows
// nothing about tactics, squads, belief or the player's whereabouts. It answers exactly two questions:
//
//     "can this body get there, and what does it cost"      (mantleProbe / reach / planRoute)
//     "what is the body doing right now, and may it shoot"  (bodyTick / fallTick / moveSpeedFor)
//
// THE RULE THAT MAKES ALL OF IT FAIR: a committed body cannot fire. A mimic on a wall is a free target for
// 0.40–0.95 s, a mimic mid-dive for 0.45 s and getting up for another 0.55–0.90 s, a mimic winding up a
// takedown for over a second. That is the price of the capability and it must never be softened. Every verb
// here is a window the player can shoot into, and every verb announces itself with a sound before it lands.
//
// THE SECOND RULE — WEIGHT. Today's mimic slides: enemies/common.js moveToward writes position.x/z straight
// out of a steering vector at whatever speed it was handed, so a mimic asked to go left goes left instantly,
// at full pace, still facing you. That reads as a robot strafing, which is exactly what the player reported.
// The fix is not an animation, it is the speed:
//   * a body that wants to go somewhere it is not facing must TURN FIRST — moveSpeedFor gates speed by the
//     heading error, so a 90-degree change of mind costs a quarter-second pivot before the legs get going;
//   * a body holding its aim on something else SIDESTEPS at 55% and BACKPEDALS at 42%, never at a run;
//   * gait ramps (damped), so nothing starts or stops in one frame;
//   * and there is NO LATERAL VERB IN THIS MODULE AT ALL. The dive is a commitment away from a stimulus with
//     a real recovery, not a firing-position micro-adjust. A mimic cannot juke.
// The by-products — heading error, turn rate, lean, gait, wind — are all left on m.body for the animator.
//
// THE THIRD RULE — REACHABILITY PARITY. mantleProbe is the single source of truth for "is that climbable",
// and the intent is that player/controller.js calls the SAME function with the same numbers. Then "they can
// go most everywhere I can go" is not a promise, it is one function with two callers.
//
// FAIRNESS: this file contains no decision that reads the player. The one place it touches the player at all
// is marked PHYSICS below: a takedown that has already been committed to has to know whether it connected,
// exactly as ballistics.shoot does for a bullet. Every decision reads the body, the world, or m.skill.
//
// Imports are deliberately limited to core math and core rng — no three, no mimic.js, no squad.js — so this
// module sits at the bottom of the import graph, has no cycles, and can be bundled and unit-tested on its own.
import { clamp, clamp01, damp, lerp, smoothstep, angleDelta, TAU, DEG } from '../core/math.js';
import { mulberry32 } from '../core/rng.js';

// ---- the one difficulty curve: these rows are merged into mimic.js SKILL by the integrator ----
// At progress 0 a recruit has climb 0, dodge 0, melee 0, sprintW 0.10: he cannot climb, never dives, never
// knifes, and burns his wind twice as fast as the Explorer so he cannot afford a chase. That is today's mimic,
// unchanged, and it is the requirement. Everything below is bought with Tide, clearance, rank and pressure.
export const SKILL_ROWS = {
  climb:   [0.00, 1.00],   // 0 = no links at all; >=0.25 vault; >=0.60 clamber. Drops are not a skill.
  sprintW: [0.10, 0.95],   // willingness to spend wind: the drain multiplier is (2 - sprintW)
  dodge:   [0.00, 0.85],   // dive to cover on a stimulus; also shortens the recovery
  melee:   [0.00, 0.90],   // takedown commit; also shortens the windup
};
const ROW_FALLBACK = { climb: 0, sprintW: 0.10, dodge: 0, melee: 0 };
// A module read of a skill row that survives a mimic whose SKILL table has not been merged yet (or a bare
// test double). Never throws, never invents difficulty: an unmerged row reads as the "at 0" recruit.
function sk(m, key) { const s = m.skill; const v = s ? s[key] : undefined; return typeof v === 'number' ? v : ROW_FALLBACK[key]; }

// =====================================================================================================
// THE SHARED RAY BUDGET
// -----------------------------------------------------------------------------------------------------
// Moved here from mimic.js so that everything spatial in the AI — cover scoring, posture, overwatch, the
// squad's bestCover, the occluder solve — draws from ONE pool per frame. It lives in this module because
// traversal.js is the only file every other AI module already imports, and it has no cycles.
// Nothing in THIS file spends a ray: mantleProbe, planRoute, reach and every reflex are pointInSolid and
// arithmetic only. The budget is here to be shared, not to be used.
// =====================================================================================================
export const TACTICAL_PER_FRAME = 10;
let losFrame = -1, losLeft = 0, losSpent = 0, losPeak = 0;
export function losBudget(ctx, want) {
  if (ctx.frame !== losFrame) { losFrame = ctx.frame; if (losSpent > losPeak) losPeak = losSpent; losSpent = 0; losLeft = TACTICAL_PER_FRAME; }
  if (losLeft < want) return false;
  losLeft -= want; losSpent += want; return true;
}
export function resetBudget() { losFrame = -1; losLeft = 0; losSpent = 0; losPeak = 0; rng = mulberry32(9137); }

// =====================================================================================================
// CONSTANTS
// =====================================================================================================
// Deliberately under the Explorer's 6.2. A mimic in the open closes on a walking player and loses ground on a
// sprinting one; what it has instead is that it does not have to stop to look behind it, and that it can call.
export const SPEED_SPRINT = 6.0;
export const GRAVITY = 22;                              // the player's exact figure (controller.js)
export const MANTLE_MIN = 0.55, MANTLE_LOW = 1.35, MANTLE_HIGH = 2.15;
// Wind: the player's numbers, verbatim, out of controller.js. An elite mimic is as fit as the Explorer and no
// fitter; a recruit is half as fit. Nothing here gives a mimic more than a person has.
const WIND_DRAIN = 17, WIND_REGEN = 13, WIND_HOLD = 1.9, WIND_CLEAR = 35;
const FALL_START = 0.60;        // below this, common.js followGround's damp is right and cheaper
const FALL_HURT = 9;            // the player's threshold: floor((fall - 9) * 4) HP
const PROBE_COOL = 0.5;         // one mantleProbe per mimic per half second, maximum
const DIVE_COOL = 3.5;
const MELEE_COOL = 2.4;
const MELEE_RANGE = 2.6, MELEE_CONE = Math.cos(35 * DEG), MELEE_DAMAGE = 30;
const PROBE_OFF = [0.08, 0.30, 0.62, 0.95];   // how far ahead of the capsule surface mantleProbe looks
const ORBIT_STEP = 55 * DEG;    // how far round an obstruction one committed leg goes
const ROUTE_MAX = 4;            // waypoints in a committed route
// Acceleration, in m/s^2, for a man carrying a rifle, a vest and four magazines. It is what makes a standing
// start cost something: from rest, a walk is up to pace in a third of a second and a sprint in two thirds.
// Expressed as an acceleration and not as a multiplier ON PURPOSE — a 1.5 m shuffle between a hunker and a
// peek is at its (low) pace almost instantly, so the peek cycle is untouched, while a man breaking cover to
// run twenty metres has to get going first.
const ACCEL = 9.0;
const WAYPOINT_R = 0.8;         // how close counts as having reached one

// duration / wind / noise / sound for every committed verb, in one table so the tests can read it
export const VERB = {
  vault:   { time: 0.40, wind: 9,  noise: 0.55, sound: 'mimic_vault',    alt: 'mimic_step', cost: 2.5 },
  clamber: { time: 0.95, wind: 20, noise: 0.80, sound: 'mimic_clamber',  alt: 'mimic_step', cost: 6.0 },
  drop:    { time: 0.00, wind: 0,  noise: 0.40, sound: 'mimic_land',     alt: 'land',       cost: 1.0 },
  dive:    { time: 0.45, wind: 12, noise: 0.45, sound: 'mimic_dive',     alt: 'mimic_step', cost: 0.0 },
  melee:   { time: 1.10, wind: 15, noise: 1.00, sound: 'mimic_takedown', alt: 'mimic_hit',  cost: 0.0 },
};

// ---- module scratch. Nothing in a per-frame or per-tick path allocates; __alloc proves it. ----
let rng = mulberry32(9137);
let __alloc = 0, __probes = 0, __solid = 0, __routes = 0, __orbits = 0;
const _p = { x: 0, y: 0, z: 0 };
const _p2 = { x: 0, y: 0, z: 0 };
const _blk = { x: 0, z: 0, r: 0, thin: 0, t: 0, c: null };
const _ledge = { kind: 'vault', height: 0, topX: 0, topY: 0, topZ: 0, cost: 0, time: 0 };

export function stats() { return { probes: __probes, solid: __solid, routes: __routes, orbits: __orbits, alloc: __alloc, losPeak, losSpent }; }
export function resetStats() { __probes = 0; __solid = 0; __routes = 0; __orbits = 0; __alloc = 0; losPeak = 0; }

// =====================================================================================================
// mantleProbe — is there a ledge in front of this body, and where does it end up?
// -----------------------------------------------------------------------------------------------------
// NO RAYCASTS. pointInSolid and groundHeight only, both of which are a spatial-hash cell lookup and a
// handful of AABB compares. A failed probe (the common case, and the only one that runs often) costs one to
// three pointInSolid calls; a successful one costs about eight. Rate-limited by body.linkCool to one per
// mimic per half second, so twelve mimics cost about a microsecond a frame between them.
//
// The contract with the player: this is the SAME function player/controller.js calls, so the set of ledges an
// Explorer can get onto and the set a mimic can get onto are identical by construction rather than by
// promise. Anything that changes here changes for both.
//
// Writes into `out` and returns it, or null. `out` belongs to the caller so nothing is allocated.
// =====================================================================================================
export function mantleProbe(world, from, dirX, dirZ, radius, height, maxUp, out) {
  __probes++;
  const o = out || _ledge;
  const dl = Math.hypot(dirX, dirZ); if (dl < 1e-4) return null;
  const ux = dirX / dl, uz = dirZ / dl;
  const kneeY = from.y + 0.30;

  // 1. IS SOMETHING IN THE WAY? Four forward samples, the first of them only 8 cm past where the capsule
  //    can physically be. A body resolved hard against a 0.25 m fence has that fence entirely between its
  //    own surface and any sample further out than a third of a metre: probe once and a fence reads as open
  //    ground, which is how you get a mimic standing at a rail for the rest of its life.
  let fx = 0, fz = 0, found = false;
  for (let i = 0; i < 4; i++) {
    const off = radius + PROBE_OFF[i];
    fx = from.x + ux * off; fz = from.z + uz * off;
    __solid++;
    if (world.pointInSolid(fx, kneeY, fz)) { found = true; break; }
  }
  if (!found) return null;                        // nothing to get over. Steering handles open ground.

  // 2. HOW HIGH IS ITS TOP? groundHeight walks box tops, so this is the standable surface of the obstruction.
  const g = world.groundHeight(fx, fz, from.y + maxUp + 0.35, maxUp + 0.35);
  const h = g.y - from.y;
  if (h < MANTLE_MIN) return null;                // a kerb. The step allowance in resolveCapsule owns this.
  if (h > maxUp) return null;                     // a wall. Walls are walls; that is what makes cover work.

  // 3. HEADROOM. Something over the ledge (a beam, a floor above) means there is no getting up onto it.
  __solid++;
  if (world.pointInSolid(fx, g.y + 0.95, fz)) return null;

  // 4. SOMEWHERE TO PUT THE FEET. Walk forward from the obstruction until there is a body-sized hole at the
  //    ledge height. This is what lets the same probe answer "up onto the roof" and "over the fence": on a
  //    roof the first sample is already clear; over a fence the first clear sample is the far side, and the
  //    body finishes standing in the air above it and falls the last metre, which is what a vault looks like.
  let lx = 0, lz = 0, ok = false;
  for (let i = 0; i < 3; i++) {
    const step = 0.55 + i * 0.42;
    lx = fx + ux * step; lz = fz + uz * step;
    __solid += 2;
    if (world.pointInSolid(lx, g.y + 0.40, lz)) continue;      // still inside the obstruction, or a step up
    if (world.pointInSolid(lx, g.y + 1.30, lz)) continue;      // no room for a chest up there
    ok = true; break;
  }
  if (!ok) return null;
  if (world.isWater && world.isWater(lx, lz)) return null;     // it does not climb into the marsh

  const kind = h <= MANTLE_LOW ? 'vault' : 'clamber';
  const v = VERB[kind];
  o.kind = kind; o.height = h;
  o.topX = lx; o.topY = g.y; o.topZ = lz;
  o.cost = v.cost; o.time = v.time;
  return o;
}

// The highest ledge this body is ALLOWED to take. Capability, not physique: a recruit does not decline to
// clamber, clambering does not exist for him, and reach() and the seat solver see the world he actually lives
// in. This is the whole of the traversal difficulty curve.
export function maxUpFor(m) {
  const c = sk(m, 'climb');
  return c >= 0.60 ? MANTLE_HIGH : c >= 0.25 ? MANTLE_LOW : 0;
}

// =====================================================================================================
// THE BODY
// =====================================================================================================
export function createBody(m) {
  if (m.body) return m.body;
  const b = {
    // --- committed verb ---
    verb: null, t: 0, dur: 0, verbK: 0, strike: 0, struck: false,
    fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0, high: false,
    // --- wind, exactly the Explorer's model ---
    wind: 100, windHold: 0, blown: false, sprinting: false, sprintHold: 0,
    // --- flight ---
    airborne: false, vy: 0, fell: 0,
    // --- cooldowns ---
    linkCool: 0, diveCool: 0, meleeCool: 0, recover: 0,
    // --- locomotion state, all of it readable by an animator ---
    gait: 1, gate: 1, cmd: 0, dt: 0.05, head: 0, turn: 0, lean: 0, speed: 0, load: 1, crouchWant: 0,
    lastX: m.position.x, lastZ: m.position.z, lastYaw: m.yaw,
    // --- committed route around an obstruction (x,y,z triples, pooled) ---
    route: new Float32Array(ROUTE_MAX * 3), routeN: 0, routeI: 0, routeT: 0, routeSide: 1,
    progD: 1e9, progT: 0, progX: 1e9, progZ: 1e9, replanCool: 0,
    // --- orders from other modules ---
    quiet: false,
    breath: null,
  };
  b.load = loadOf(m);
  m.body = b;
  return b;
}

// What it is carrying, as a speed and wind multiplier. Cheap, computed once, refreshed by setLoad when
// kit.js swaps a weapon. A machine gunner in a plate carrier is not a scout, and it should be visible in
// how fast he gets across a gap.
function loadOf(m) {
  const L = m.loadout; if (!L) return 1;
  let f = 1;
  const w = m.wdef || (L.weapon && L.weapon.def);
  const cls = w && w.cls;
  if (cls === 'mg' || cls === 'sniper') f *= 0.94;
  else if (cls === 'pistol' || cls === 'smg') f *= 1.03;
  if (L.vest) f *= 0.97;
  if (L.helmet) f *= 0.99;
  const mags = L.mags ? L.mags.length : 0;
  f *= 1 - Math.min(0.05, mags * 0.008);
  return clamp(f, 0.85, 1.05);
}
export function setLoad(m) { if (m.body) m.body.load = loadOf(m); return m.body ? m.body.load : 1; }
export function setQuiet(m, on) { if (m.body) m.body.quiet = !!on; }
export function isCommitted(m) { return !!(m.body && m.body.verb); }
export function mayFire(m) { const b = m.body; return !b || (!b.verb && !b.airborne && b.recover <= 0); }

// ---- sound, with a fallback so a build where the sfx agent has not landed the new names is still audible ----
function snd(m, name, alt, opts) {
  const a = m.ctx && m.ctx.audio; if (!a) return null;
  let n = name;
  if (a.has && !a.has(name) && alt && a.has(alt)) n = alt;
  return m.sound ? m.sound(n, opts) : a.play(n, opts);
}

// =====================================================================================================
// bodyTick — the clock on every committed act. Returns TRUE when the body owns this frame, in which case the
// caller must not steer, aim or fire: the man is on a wall, on the floor, or swinging.
// =====================================================================================================
export function bodyTick(m, dt) {
  const b = m.body; if (!b) return false;
  if (dt > 0) {
    // measured speed and turn rate, for the gait ramp and for the animator
    b.dt = dt;
    const mv = Math.hypot(m.position.x - b.lastX, m.position.z - b.lastZ) / dt;
    b.lastX = m.position.x; b.lastZ = m.position.z;
    b.speed = damp(b.speed, mv, 9, dt);
    // the commanded pace is reconciled with what the body ACTUALLY managed, so a man who has been walking
    // into a wall for a second does not then leave it at a sprint the moment the wall stops being there
    if (b.cmd > mv + 2.0) b.cmd = mv + 2.0;
    const dy = angleDelta(b.lastYaw, m.yaw) / dt; b.lastYaw = m.yaw;
    b.turn = damp(b.turn, dy, 10, dt);
    // lean into the turn: a running man banks, a walking one barely does
    b.lean = damp(b.lean, clamp(-b.turn * clamp01(b.speed / 4) * 0.16, -1, 1), 6, dt);
    windTick(m, b, dt);
    b.linkCool = Math.max(0, b.linkCool - dt);
    b.diveCool = Math.max(0, b.diveCool - dt);
    b.meleeCool = Math.max(0, b.meleeCool - dt);
    b.recover = Math.max(0, b.recover - dt);
    b.sprintHold = Math.max(0, b.sprintHold - dt);
    b.replanCool = Math.max(0, b.replanCool - dt);
    if (b.routeT > 0) b.routeT -= dt;
  }
  if (!b.verb) { b.verbK = 0; b.crouchWant = damp(b.crouchWant, b.recover > 0.25 ? 0.85 : 0, 6, dt); return false; }

  b.t += dt;
  const k = b.dur > 0 ? clamp01(b.t / b.dur) : 1;
  b.verbK = k;
  // A COMMITTED BODY CANNOT FIRE. Enforced here, every frame, not at the call sites.
  m.burstLeft = 0; m.aiming = false;
  if (m.suppressLeft) m.suppressLeft = 0;

  if (b.verb === 'vault' || b.verb === 'clamber') {
    // on rails: the ledge is the ground until the pull is finished, exactly as the Explorer's mantle
    const e = smoothstep(0, 1, k);
    m.position.x = lerp(b.fromX, b.toX, e);
    m.position.z = lerp(b.fromZ, b.toZ, e);
    m.position.y = lerp(b.fromY, b.toY, b.high ? smoothstep(0, 0.7, k) : e);
    b.crouchWant = b.high ? 0.75 : 0.45;
    if (k >= 1) {
      m.position.x = b.toX; m.position.y = b.toY; m.position.z = b.toZ;
      b.airborne = true; b.vy = 0;              // step off the far side; fallTick brings it down
      b.recover = 0.10;
      endVerb(m, b);
    }
  } else if (b.verb === 'dive') {
    const e = 1 - (1 - k) * (1 - k) * (1 - k);   // out-cubic: fast off the mark, dead stop on the deck
    m.position.x = lerp(b.fromX, b.toX, e);
    m.position.z = lerp(b.fromZ, b.toZ, e);
    if (m.ctx && m.ctx.world) m.position.y = m.ctx.world.groundHeight(m.position.x, m.position.z, m.position.y + 0.5).y;
    b.crouchWant = 1;
    if (k >= 1) endVerb(m, b);
  } else if (b.verb === 'melee') {
    // the windup is a walk-in: he closes the last stride with the weapon down, which is the tell
    const closing = b.t < b.strike;
    if (closing) {
      const gx = b.toX - m.position.x, gz = b.toZ - m.position.z, gd = Math.hypot(gx, gz);
      if (gd > 1.4) { const s = Math.min(2.6 * dt, gd - 1.2); m.position.x += (gx / gd) * s; m.position.z += (gz / gd) * s; }
      if (m.faceToward) m.faceToward(b.toX, b.toZ, dt, 9);
      b.crouchWant = 0;
    } else if (!b.struck) {
      b.struck = true;
      strike(m, b);
    }
    if (k >= 1) endVerb(m, b);
  }
  return true;
}

function endVerb(m, b) {
  b.verb = null; b.t = 0; b.dur = 0; b.verbK = 0; b.struck = false;
}
// A stun, a hit that staggers, a death: the commitment is broken and the body is dumped where it stands.
export function abortVerb(m) {
  const b = m.body; if (!b || !b.verb) return false;
  if (b.verb === 'vault' || b.verb === 'clamber') {
    // do not leave it inside the wall it was halfway over: past the halfway point it falls forward onto the
    // ledge, before it it drops back to where it stepped off. Either way it ends up somewhere it can stand.
    const fwd = b.verbK > 0.55;
    m.position.x = fwd ? b.toX : b.fromX; m.position.y = fwd ? b.toY : b.fromY; m.position.z = fwd ? b.toZ : b.fromZ;
    if (fwd) { b.airborne = true; b.vy = 0; }
  }
  endVerb(m, b); b.recover = 0.25;
  return true;
}

function windTick(m, b, dt) {
  if (b.sprinting) {
    // (2 - sprintW): a recruit burns wind at twice the Explorer's rate and cannot commit to a chase; an
    // elite burns it at exactly the Explorer's rate and can. Nobody gets a bigger tank than the player.
    b.wind = Math.max(0, b.wind - WIND_DRAIN * (2 - sk(m, 'sprintW')) * dt * b.load);
    b.windHold = WIND_HOLD;
    if (b.wind <= 0.5 && !b.blown) { b.blown = true; b.sprinting = false; b.sprintHold = 0; }
  } else {
    b.windHold = Math.max(0, b.windHold - dt);
    if (b.windHold <= 0) b.wind = Math.min(100, b.wind + WIND_REGEN * dt / Math.sqrt(b.load));
  }
  if (b.blown && b.wind >= WIND_CLEAR) b.blown = false;
  // the breath: what a chase sounds like from the other side of a hedge
  if (m.ctx && m.ctx.audio && m.loopSound) {
    const want = (b.sprinting ? 1 : 0) * 0.7 + (b.blown ? 0.6 : 0) + clamp01((60 - b.wind) / 60) * 0.4;
    if (want > 0.25 && !b.breath && !b.quiet && m.alive) {
      const a = m.ctx.audio;
      const nm = (a.has && !a.has('mimic_breath') && a.has('breath')) ? 'breath' : 'mimic_breath';
      b.breath = m.loopSound(nm, { gain: 0, ref: 4, max: 22 });
    }
    if (b.breath) {
      b.breath.set && b.breath.set('rate', 0.4 + 0.5 * clamp01(want));
      b.breath.setGain(b.quiet ? 0 : 0.22 * clamp01(want), 0.4);
      if (want < 0.12 || b.quiet) { b.breath.stop(1.0); if (m.sounds) m.sounds.delete(b.breath); b.breath = null; }
    }
  }
}

// =====================================================================================================
// fallTick — gravity. Replaces common.js followGround's damp whenever there is real air under the feet.
// -----------------------------------------------------------------------------------------------------
// followGround damps y toward the ground at lambda 30, so a mimic that walked off a 3 m roof FLOATED down at
// a decreasing rate and landed unharmed. Now a roof is exactly as dangerous to a mimic as it is to the
// Explorer, off the Explorer's own curve, which is what makes dropping off one a decision rather than a
// shortcut. Below 0.60 m the old damp is correct and cheaper, so it is left alone.
// It owns the WHOLE vertical, including the grounded case, so that it costs exactly one groundHeight call a
// frame — the same one followGround was already paying for — rather than adding a second. Always returns
// true for a body with feet, so `if (!fallTick(this, dt)) this.followGround(dt);` runs the old path only for
// a flying entity or one this module has never been attached to.
// =====================================================================================================
export function fallTick(m, dt, lambda = 30) {
  const b = m.body; if (!b || m.flying) return false;
  const w = m.ctx.world;
  const g = w.groundHeight(m.position.x, m.position.z, m.position.y + 0.5);
  m.groundY = g.y;
  const gap = m.position.y - g.y;
  if (!b.airborne) {
    // on the deck: the existing damp is right, cheap, and forgiving of a metre of kerb
    if (gap <= FALL_START) { m.position.y = dt ? damp(m.position.y, g.y, lambda, dt) : g.y; return true; }
    b.airborne = true; if (b.vy > 0) b.vy = 0;
  }
  b.vy -= GRAVITY * dt;
  m.position.y += b.vy * dt;
  if (m.velocity) m.velocity.y = b.vy;
  if (m.position.y <= g.y) {
    const fall = -b.vy;
    m.position.y = g.y; b.airborne = false; b.vy = 0; b.fell = fall;
    if (m.velocity) m.velocity.y = 0;
    land(m, b, fall);
  }
  return true;
}

function land(m, b, fall) {
  const hard = fall > 6;
  snd(m, 'mimic_land', 'land', { gain: hard ? 0.75 : 0.35, max: hard ? 55 : 30, rate: 0.9 + rng() * 0.2 });
  b.recover = hard ? 0.35 : 0.12;
  m.stuckT = 0;
  if (fall <= FALL_HURT) return;
  // The Explorer's exact curve: a four-storey drop kills a mimic as dead as it kills you.
  //
  // NOT through m.damage(). enemies/common.js damage() writes the player's exact position into
  // lastSeenPlayer for every entity type, and mimic.js onHit only walks that back when it is handed a
  // round's direction — a hit with no direction falls through to believe(player.position), which is the
  // truth. That is right for a bullet and it is clairvoyance for a kerb: a mimic that steps off a loading
  // dock in the dark would learn exactly where you were standing. A fall is not a contact, so it takes the
  // hit points and nothing else: no belief, no morale, no stagger, no call.
  const dmg = Math.floor((fall - FALL_HURT) * 4);
  m.hp -= dmg;
  if (m.rig && m.rig.rig) m.rig.rig.flinch = Math.max(m.rig.rig.flinch || 0, 0.7);
  if (m.hp <= 0 && m.alive && m.kill) m.kill({ kind: 'fall' });
}

// =====================================================================================================
// tryMantle — the only way a mimic ever climbs anything.
// -----------------------------------------------------------------------------------------------------
// It never mantles for fun: this is called when steering has failed (stuck against something) or when a seat
// it has been given is above its feet. A recruit (climb < 0.25) has no links at all and simply stays where
// the ground is flat, which is the day-one guarantee.
// =====================================================================================================
export function tryMantle(m, tx, tz) {
  const b = m.body; if (!b || b.verb || b.airborne || b.linkCool > 0) return false;
  const cap = maxUpFor(m); if (cap <= 0) return false;
  const w = m.ctx.world;
  b.linkCool = PROBE_COOL;
  let dx = tx - m.position.x, dz = tz - m.position.z;
  const d = Math.hypot(dx, dz); if (d < 0.4) return false;
  dx /= d; dz /= d;
  const L = mantleProbe(w, m.position, dx, dz, m.radius || 0.35, m.height || 1.85, cap, _ledge);
  if (!L) return false;
  if (L.kind === 'clamber' && sk(m, 'climb') < 0.60) return false;
  // it does not climb into a field, and it does not climb into open water
  if (anomalyAt(m.ctx, L.topX, L.topZ, 2.0)) return false;
  return beginMantle(m, L);
}

// Given a probe result, commit. Split out so command.js / a seat solver can climb toward a solved position
// without re-probing, and so the tests can drive a known ledge.
export function beginMantle(m, L) {
  const b = m.body; if (!b || b.verb) return false;
  const v = VERB[L.kind];
  b.verb = L.kind; b.t = 0;
  // quality is bought with climb: a poor climber is slow over the same wall, which is a longer free shot
  const q = clamp01((sk(m, 'climb') - 0.25) / 0.75);
  b.dur = v.time * lerp(1.35, 1.0, q);
  b.high = L.kind === 'clamber';
  b.fromX = m.position.x; b.fromY = m.position.y; b.fromZ = m.position.z;
  b.toX = L.topX; b.toY = L.topY; b.toZ = L.topZ;
  b.wind = Math.max(0, b.wind - v.wind); b.windHold = WIND_HOLD;
  b.crouchWant = 0.5;
  m.burstLeft = 0; m.aiming = false;
  if (m.faceToward) m.faceToward(L.topX, L.topZ, 0.2, 20);
  snd(m, v.sound, v.alt, { gain: 0.55, max: 42, rate: 0.95 + rng() * 0.12 });
  clearRoute(m);
  return true;
}

// =====================================================================================================
// tryDive — the reflex. Ray-free, arithmetic only, allowed to run every frame.
// -----------------------------------------------------------------------------------------------------
// This is a COMMITMENT AWAY FROM A STIMULUS, never a firing-position adjustment. It goes sideways-and-back
// from the threat, it ends prone, it costs a real recovery in which the man cannot shoot, and it has a
// 3.5 s cooldown. There is no other lateral verb in this module, which is the structural reason a mimic
// cannot strafe: to move sideways it must either walk (slowly, per the strafe gate) or throw itself down.
// =====================================================================================================
export function tryDive(m, threatX, threatZ) {
  const b = m.body;
  if (!b || b.verb || b.airborne || b.diveCool > 0 || m.stunned > 0) return false;
  const dodge = sk(m, 'dodge'); if (dodge < 0.30) return false;
  let ax = m.position.x - threatX, az = m.position.z - threatZ;
  const ad = Math.hypot(ax, az) || 1; ax /= ad; az /= ad;
  const dist = 3.2;
  // two candidates: hard left and hard right of the threat bearing, each with a third of a step backwards
  let best = -1, bx = 0, bz = 0, by = m.position.y;
  for (let s = -1; s <= 1; s += 2) {
    const px = -az * s * 0.94 + ax * 0.34, pz = ax * s * 0.94 + az * 0.34;
    const pl = Math.hypot(px, pz) || 1;
    const x = m.position.x + (px / pl) * dist, z = m.position.z + (pz / pl) * dist;
    if (!standable(m.ctx, x, z, m.position.y, _p)) continue;
    // prefer the side its own cover is on, else the side further from the threat
    let score = Math.hypot(x - threatX, z - threatZ);
    if (m.cover) score += 14 - Math.min(14, Math.hypot(x - m.cover.x, z - m.cover.z)) * 1.2;
    score += rng() * 0.4;
    if (score > best) { best = score; bx = x; bz = z; by = _p.y; }
  }
  if (best < 0) return false;
  b.verb = 'dive'; b.t = 0; b.dur = VERB.dive.time;
  b.fromX = m.position.x; b.fromY = m.position.y; b.fromZ = m.position.z;
  b.toX = bx; b.toY = by; b.toZ = bz;
  b.diveCool = DIVE_COOL;
  b.wind = Math.max(0, b.wind - VERB.dive.wind); b.windHold = WIND_HOLD;
  // getting back up is the price. A good diver is on his feet in half the time a poor one is.
  b.recover = VERB.dive.time + lerp(0.90, 0.55, clamp01((dodge - 0.30) / 0.55));
  b.crouchWant = 1;
  m.burstLeft = 0; m.aiming = false;
  clearRoute(m);
  snd(m, VERB.dive.sound, VERB.dive.alt, { gain: 0.6, max: 38, rate: 1.0 + rng() * 0.1 });
  return true;
}

// A round cracked past. Wire this to mimic.js as `suppress(level, shooter)` — enemies/ballistics.js ALREADY
// calls e.suppress(0.5, shooter) for any live entity within 3.5 m of a player round's flight path, and until
// now nothing implemented it. That is the dive trigger, for free, with no change to ballistics.
// The direction it dives away from is its OWN belief about where the shot came from, never the truth.
export function nearMiss(m, level = 0.5, shooter = null) {
  const b = m.body; if (!b || level < 0.25) return false;
  const bel = m.lastSeenPlayer;
  const tx = bel ? bel.x : m.position.x - Math.sin(m.yaw) * 6;
  const tz = bel ? bel.z : m.position.z - Math.cos(m.yaw) * 6;
  return tryDive(m, tx, tz);
}

// =====================================================================================================
// reflexTick — per frame, ray-free. The only things allowed to interrupt a mimic between plan ticks.
// =====================================================================================================
export function reflexTick(m, dt) {
  const b = m.body; if (!b || b.verb || m.stunned > 0 || !m.alive) return false;
  if (sk(m, 'dodge') < 0.30 || b.diveCool > 0) return false;
  const sq = m.ctx.squads, list = sq && sq.grenades;
  if (list && list.length) {
    for (let i = 0; i < list.length; i++) {
      const gr = list[i]; if (!gr || !gr.pos) continue;
      if (gr.fuse > 2.6) continue;                       // it has not started cooking where he can see it
      const r = (gr.radius || 7) * 0.55 + 2;
      const dx = gr.pos.x - m.position.x, dz = gr.pos.z - m.position.z;
      if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
      if (dx * dx + dz * dz > r * r) continue;
      if (tryDive(m, gr.pos.x, gr.pos.z)) return true;
    }
  }
  return false;
}

// =====================================================================================================
// tryMelee — the takedown. The thing that gets you when you go dry.
// -----------------------------------------------------------------------------------------------------
// Over a second of windup during which he cannot shoot and is walking at you with the weapon down, then a
// strike that only lands if you are still inside 2.6 m in a 70-degree cone. BACKING AWAY DEFEATS IT — that is
// what makes it a decision instead of a hitscan, and it is why mimic.js's minStand backpedal stays exactly as
// it is. The sound is deliberately NOT on the handset: no bandpass, no squelch. It is the one noise a mimic
// makes with its own throat, and it means one of them has decided to close.
// =====================================================================================================
export function tryMelee(m, atX, atZ) {
  const b = m.body;
  if (!b || b.verb || b.airborne || b.meleeCool > 0 || b.recover > 0 || m.stunned > 0) return false;
  const skl = sk(m, 'melee'); if (skl < 0.40) return false;
  const d = Math.hypot(atX - m.position.x, atZ - m.position.z);
  if (d > MELEE_RANGE + 0.6) return false;
  b.verb = 'melee'; b.t = 0;
  b.strike = lerp(1.35, 1.10, clamp01((skl - 0.40) / 0.50));
  b.dur = b.strike + 0.25;
  b.struck = false;
  b.fromX = m.position.x; b.fromY = m.position.y; b.fromZ = m.position.z;
  b.toX = atX; b.toY = m.position.y; b.toZ = atZ;
  b.meleeCool = MELEE_COOL;
  b.wind = Math.max(0, b.wind - VERB.melee.wind); b.windHold = WIND_HOLD;
  m.burstLeft = 0; m.aiming = false;
  clearRoute(m);
  snd(m, VERB.melee.sound, VERB.melee.alt, { gain: 0.9, max: 45, rate: 0.92 + rng() * 0.1 });
  return true;
}

// PHYSICS — the one place this module touches the player, and the only one. A swing that has already been
// committed to has to know whether it connected, exactly as ballistics.shoot does for a bullet. No decision
// anywhere in this file reads it; by the time this runs the commitment is over a second old and cannot be
// recalled. An integrator may override it by defining m.meleeHitTest() on the entity.
function strike(m, b) {
  let hit;
  if (m.meleeHitTest) hit = m.meleeHitTest(MELEE_RANGE, MELEE_CONE);
  else {
    const p = m.player;
    if (!p || p.dead) return;
    const d = m.distanceToPlayer ? m.distanceToPlayer() : 99;
    if (d > MELEE_RANGE) hit = false;
    else {
      const dx = p.position.x - m.position.x, dz = p.position.z - m.position.z;
      const dl = Math.hypot(dx, dz) || 1;
      const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
      hit = (dx / dl) * fx + (dz / dl) * fz >= MELEE_CONE;
    }
  }
  if (!hit) return;
  if (m.hurtPlayer) m.hurtPlayer(MELEE_DAMAGE, 'melee');
  const p = m.player;
  if (p && p.lockMovement) p.lockMovement(0.35);
}

// =====================================================================================================
// SPRINT, GAIT AND THE TURN GATE — the locomotion model
// =====================================================================================================
// Is a sprint worth the wind right now? `urgency` 0..1 lets a caller say "this one matters" (a cut, a bound
// across open ground, a break-contact) so the same man will spend his last wind on the thing that saves him
// and not on walking to a patrol node.
export function wantSprint(m, dist, urgency = 0) {
  const b = m.body; if (!b) return false;
  if (b.blown || b.verb || b.airborne || b.quiet || b.recover > 0) return false;
  if (m.stunned > 0) return false;
  const willing = sk(m, 'sprintW');
  if (willing * (b.wind / 100) < 0.25) return false;    // he has the legs but not the will, or the will but not the legs
  const floor = urgency > 0.5 ? 5 : urgency > 0 ? 9 : 14;
  if (dist < floor) return false;
  b.sprintHold = 0.30;                                   // latched, so call order between modules does not matter
  return true;
}
export function stopSprint(m) { const b = m.body; if (b) { b.sprintHold = 0; b.sprinting = false; } }

// The speed a body may actually make toward (tx, tz) this frame, given what it is carrying, what it has left,
// what it is doing, and — the part that kills the strafing — which way it is pointed.
//
//   facing !== false : it will turn to face where it is going. Speed is gated by the heading error, so a
//                      change of mind costs a pivot before the legs get anywhere. TURN, THEN MOVE.
//   facing === false : it is holding its aim on something else (the engage arm does this). It sidesteps at
//                      55% and backpedals at 42%, so shuffling laterally in front of you is now slow,
//                      committed and legible instead of a free reposition at a run.
export function moveSpeedFor(m, base, tx, tz, facing) {
  const b = m.body; if (!b) return base;
  const sprint = b.sprintHold > 0 && !b.blown && !b.verb && !b.airborne && b.recover <= 0;
  b.sprinting = sprint;
  let sp = sprint ? Math.max(base, SPEED_SPRINT) : base;
  sp *= b.load;
  if (b.recover > 0) sp *= 0.45;          // getting up off the deck
  if (b.airborne) sp *= 0.55;             // no traction in the air
  if (b.blown) sp *= 0.82;                // spent: it walks it back, like you do
  let gate = 1;
  if (tx !== undefined && tz !== undefined) {
    const bearing = Math.atan2(-(tx - m.position.x), -(tz - m.position.z));
    const err = Math.abs(angleDelta(m.yaw, bearing));
    b.head = err;
    gate = facing === false ? strafeGate(err) : turnGate(err);
  }
  b.gate = gate;
  // Braking is instant and accelerating is not. A change of mind sheds pace in the frame it happens (you
  // cannot carry a run through a ninety-degree turn), and getting back up to speed afterwards is limited by
  // what legs do. Those two lines are the whole of "a body has mass".
  const want = sp * gate;
  const out = Math.min(want, b.cmd + ACCEL * b.dt);
  b.cmd = out;
  b.gait = sp > 0.01 ? clamp01(out / sp) : 0;
  return out;
}
// 1 inside 20 degrees, then falls away hard: a 90-degree change of direction runs at a quarter speed until
// the body has come round, and a full reversal is a pivot on the spot.
export function turnGate(err) {
  const a = Math.abs(err);
  if (a <= 20 * DEG) return 1;
  const k = clamp01(1 - (a - 20 * DEG) / (110 * DEG));
  return 0.15 + 0.85 * k * k;
}
// A person does not sidestep as fast as they run, and does not backpedal as fast as they sidestep.
export function strafeGate(err) {
  const c = Math.cos(err);
  return c > 0 ? lerp(0.55, 1.0, c) : lerp(0.55, 0.42, -c);
}
// The turn rate to hand common.js moveToward, for call sites that keep using it. A standing body pivots; a
// running body cannot turn on a sixpence.
export function turnRateFor(m, base = 7) {
  const b = m.body; if (!b) return base;
  return base * lerp(1.5, 0.5, clamp01(b.speed / 4.5));
}
// ...but dampAngle, which is what faceToward uses, has NO RATE LIMIT: it moves a fixed FRACTION of the
// remaining error every frame, so a 180-degree error is half gone in one frame however the lambda is tuned.
// That is the actual mechanism behind "not scary robots": they do not turn, they are simply already facing
// the other way. faceStep is a hard cap in radians per second — a standing man swings about 205 deg/s with a
// rifle up and a running one about 110 — and it is the reason the speed gate above has anything to gate.
// Call it INSTEAD of moveToward's own facing: moveToward(..., { face: false }) then faceStep(...).
export const TURN_STAND = 3.6, TURN_RUN = 1.9;
export function faceStep(m, tx, tz, dt, scale = 1) {
  const b = m.body;
  const want = Math.atan2(-(tx - m.position.x), -(tz - m.position.z));
  const err = angleDelta(m.yaw, want);
  const cap = lerp(TURN_STAND, TURN_RUN, clamp01((b ? b.speed : 0) / 4.5)) * scale * dt;
  const step = err > cap ? cap : err < -cap ? -cap : err;
  m.yaw += step;
  if (b) b.head = Math.abs(err - step);
  return Math.abs(err);
}
// What the animator wants: everything about the body's motion in one read.
export function motionOf(m) { return m.body; }
// Footsteps: sprinting is loud, a quiet order is silent, and a hidden mimic never plays one at all.
export function stepGain(m, base = 0.35) { const b = m.body; if (!b) return base; if (b.quiet) return 0; return base + (b.sprinting ? 0.25 : 0) + clamp01(b.speed / 6) * 0.2; }
export function stepRate(m) { const b = m.body; return b && b.sprinting ? 1.25 : 1.0; }

// =====================================================================================================
// reach — how far, in effective metres, a position is for THIS body. Infinity means it cannot get there.
// -----------------------------------------------------------------------------------------------------
// One groundHeight call, no rays. Used by the seat solver: a roof seat is simply not offered to a man who
// cannot clamber, rather than being offered and then failed at, which is what a mimic milling about at the
// foot of a wall looks like.
// A slope is not a ledge: groundHeight reports a surface name for a box top and null for terrain, so a hill
// costs nothing and a loading dock costs a link.
// =====================================================================================================
export function reach(m, x, z) {
  const d = Math.hypot(x - m.position.x, z - m.position.z);
  const w = m.ctx.world;
  const cap = maxUpFor(m);
  const g = w.groundHeight(x, z, m.position.y + Math.max(cap, 0.55) + 0.5, Math.max(cap, 0.55) + 0.5);
  const dy = g.y - m.position.y;
  if (dy <= MANTLE_MIN) return d + (dy < -4 ? 4 : 0);      // level, a step, or a drop. A drop is nearly free.
  if (!g.surface) return d + Math.min(6, dy * 0.5);        // terrain: a climb up a bank, walkable, just slower
  if (dy > cap) return Infinity;                           // a wall this body has no verb for
  return d + (dy <= MANTLE_LOW ? VERB.vault.cost : VERB.clamber.cost);
}

// =====================================================================================================
// ROUTE — getting round the thing in the way, including the tree
// -----------------------------------------------------------------------------------------------------
// The reported failure is precise: "I can hide behind a tree and it confuses them." Two things cause it.
// The first is tactical (which side to come round, and when) and belongs to command.js. The second is pure
// locomotion and belongs here: common.js moveToward is a steering vector, so a mimic pointed at a target
// with a trunk in the way pushes into the trunk, slides round its own avoidance vector, re-points at the
// target, and pushes in again. It oscillates at the obstruction because it has no memory of it.
//
// planRoute gives it a memory: find the collider actually straddling the line, decide a side once, and COMMIT
// to two or three waypoints at constant radius around it. The mimic then walks an arc — visibly, on a
// deliberate path — instead of scrubbing back and forth. Constant radius matters: it is what stops the arc
// from collapsing back onto the trunk halfway round, and it is what makes the movement read as intent.
//
// Ray-free (pointInSolid and groundHeight only) and only ever run on a stall or an order, never per frame.
// =====================================================================================================

// The nearest non-passable collider whose footprint straddles a->b, at body height. Writes into `out`.
export function blockerOnLine(ctx, ax, ay, az, bx, bz, upto, out) {
  const w = ctx.world;
  const o = out || _blk;
  let dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz); if (L < 0.3) return null;
  const ux = dx / L, uz = dz / L;
  const span = Math.min(L, upto);
  const mx = ax + ux * span * 0.5, mz = az + uz * span * 0.5;
  const lo = ay + 0.55, hi = ay + 1.7;
  let bestT = 1e9, best = null;
  w.query(mx, mz, span * 0.5 + 3.0, (c) => {
    if (c.dead || c.passable || c.noAvoid) return;
    let cx, cz, rr, thin;
    if (c.kind === 'box') {
      if (c.max.y < lo || c.min.y > hi) return;              // steppable, or high enough to walk under
      cx = (c.min.x + c.max.x) * 0.5; cz = (c.min.z + c.max.z) * 0.5;
      const hx = (c.max.x - c.min.x) * 0.5, hz = (c.max.z - c.min.z) * 0.5;
      rr = Math.hypot(hx, hz); thin = Math.min(hx, hz);
    } else {
      if (c.y1 < lo || c.y0 > hi) return;
      cx = c.x; cz = c.z; rr = c.r; thin = c.r;
    }
    const t = (cx - ax) * ux + (cz - az) * uz;
    if (t < -rr || t > span) return;
    const px = ax + ux * t, pz = az + uz * t;
    if (Math.hypot(cx - px, cz - pz) > rr + 0.5) return;     // the line misses it
    if (t < bestT) { bestT = t; best = c; o.x = cx; o.z = cz; o.r = rr; o.thin = thin; o.t = t; o.c = c; }
  });
  return best ? o : null;
}

// Is (x, z) somewhere this body could stand? Ray-free. Writes the ground height into out.y.
export function standable(ctx, x, z, fromY, out) {
  const w = ctx.world;
  const half = w.half || 320;
  if (Math.abs(x) > half - 5 || Math.abs(z) > half - 5) return false;
  const g = w.groundHeight(x, z, fromY + 1.3, 1.3);
  if (g.y > fromY + 1.5 || g.y < fromY - 4.0) return false;   // out of reach up, or off a cliff down
  __solid += 2;
  if (w.pointInSolid(x, g.y + 0.6, z)) return false;
  if (w.pointInSolid(x, g.y + 1.45, z)) return false;
  if (w.isWater && w.isWater(x, z)) return false;
  if (anomalyAt(ctx, x, z, 2.0)) return false;
  if (out) { out.x = x; out.y = g.y; out.z = z; }
  return true;
}

// The fields. A local copy rather than an import from mimic.js, which would be a cycle. Reads the world,
// never the player.
export function anomalyAt(ctx, x, z, pad = 2) {
  const list = ctx.anomalies && ctx.anomalies.list; if (!list || !list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || !a.position) continue;
    const r = (a.radius || 6) + pad;
    if (Math.abs(a.position.x - x) > r || Math.abs(a.position.z - z) > r) continue;
    if (Math.hypot(a.position.x - x, a.position.z - z) < r) return a;
  }
  return null;
}

// Lay a committed arc around (cx, cz) at CONSTANT radius, from where the body is now, sweeping `sweep`
// radians on `side`. Returns the number of waypoints laid, 0 if neither side works.
//
// The radius is the caller's, verbatim (floored at 1.2 m so nobody orbits inside their own capsule), because
// the two callers want opposite things from the same primitive: planRoute below is getting PAST something
// and hugs it at footprint + body + a margin, while command.js's ANGLE is walking round a trunk it is
// trying to see past and must hold its current standoff — collapse that inward and the mover walks into the
// muzzle of the thing it was working around. Constant radius is the whole point either way: it is what stops
// the arc falling back onto the obstruction halfway round, and it is what makes the movement read as intent
// rather than as an avoidance vector being resolved over and over.
export function planOrbit(m, cx, cz, radius, side, sweep) {
  const b = m.body; if (!b) return 0;
  __orbits++;
  const R = Math.max(radius, 1.2);
  const a0 = Math.atan2(m.position.z - cz, m.position.x - cx);
  const d0 = Math.hypot(m.position.x - cx, m.position.z - cz);
  // The FIRST leg is the tangent, not the arc. A body six metres off that walks straight at a waypoint
  // fifty-five degrees round a small circle cuts the corner and scrapes the very thing it is going round;
  // aiming at the tangent point instead means the approach never comes inside R. Straight in, then round.
  const lead = d0 > R + 0.2 ? Math.acos(clamp(R / d0, 0, 1)) : 0;
  const total = Math.max(Math.min(sweep, Math.PI * 1.25), lead);
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = attempt === 0 ? side : -side;
    let n = 0;
    for (let i = 0; i < ROUTE_MAX; i++) {
      const a = Math.min(lead + i * ORBIT_STEP, total);
      const ang = a0 + s * a;
      const x = cx + Math.cos(ang) * R, z = cz + Math.sin(ang) * R;
      if (!standable(m.ctx, x, z, m.position.y, _p)) break;
      b.route[n * 3] = _p.x; b.route[n * 3 + 1] = _p.y; b.route[n * 3 + 2] = _p.z; n++;
      if (a >= total - 1e-3) break;
    }
    if (n > 0) {
      b.routeN = n; b.routeI = 0; b.routeT = 2.4 + n * 1.8; b.routeSide = s;
      __routes++;
      return n;
    }
  }
  b.routeN = 0;
  return 0;
}

// Find whatever is in the way of (tx, tz) and commit to going round it. `side` 0 = pick the short way.
export function planRoute(m, tx, tz, side = 0) {
  const b = m.body; if (!b) return false;
  const blk = blockerOnLine(m.ctx, m.position.x, m.position.y, m.position.z, tx, tz, 16, _blk);
  if (!blk) return false;
  const a0 = Math.atan2(m.position.z - blk.z, m.position.x - blk.x);
  const a1 = Math.atan2(tz - blk.z, tx - blk.x);
  const d = angleDelta(a0, a1);
  const s = side || (d >= 0 ? 1 : -1);
  // going the short way is |d|; going the wrong way round is the rest of the circle
  const full = (s === (d >= 0 ? 1 : -1)) ? Math.abs(d) : TAU - Math.abs(d);
  // clear the footprint by the body plus a margin
  const R = blk.r + (m.radius || 0.35) + 0.6;
  // and leave on the tangent too: hold the arc all the way round to the target's own bearing and the last
  // leg cuts back across the obstruction, which is how a clean-looking plan still ends in a shoulder on a
  // tree trunk. The arc stops where the straight run to the target stops touching the circle.
  const dT = Math.hypot(tx - blk.x, tz - blk.z);
  const exit = dT > R + 0.2 ? Math.acos(clamp(R / dT, 0, 1)) : 0;
  return planOrbit(m, blk.x, blk.z, R, s, Math.max(0, full - exit)) > 0;
}

// The waypoint the body should be walking to, or null when the route is done or has timed out. Advances
// itself. Writes into `out` (a plain {x,y,z} the caller owns) and returns it.
export function routeTarget(m, out) {
  const b = m.body; if (!b || b.routeN <= 0) return null;
  if (b.routeT <= 0) { b.routeN = 0; return null; }
  while (b.routeI < b.routeN) {
    const i = b.routeI * 3;
    const x = b.route[i], y = b.route[i + 1], z = b.route[i + 2];
    if (Math.hypot(x - m.position.x, z - m.position.z) < WAYPOINT_R) { b.routeI++; continue; }
    if (out) { out.x = x; out.y = y; out.z = z; return out; }
    _p2.x = x; _p2.y = y; _p2.z = z; return _p2;
  }
  b.routeN = 0;
  return null;
}
export function hasRoute(m) { return !!(m.body && m.body.routeN > 0 && m.body.routeT > 0); }

// =====================================================================================================
// routeTick — the one call a movement site needs. Returns the waypoint to walk to instead of the target,
// or null when the direct line is fine.
//
//   const goal = traversal.routeTick(m, tx, tz, dt) || target;
//
// It also owns the STALL TEST, and that test is not "am I moving". mimic.js's stuckTick asks whether the
// body covered less than 0.4 m/s, and a mimic wedged on a tree trunk fails that test completely: common.js's
// avoidance pushes it straight back down its own approach vector, it retreats at a full walk, the push
// weakens because the look-ahead has moved away, it comes forward again, and it does that forever at
// 3.4 m/s. It is moving the whole time. It is never getting anywhere. That oscillation is what the player
// is describing when they say a tree confuses them, and the only thing that detects it is asking whether
// the DISTANCE TO THE GOAL is falling — which is what this does.
// =====================================================================================================
const STALL_T = 1.0;            // s of no progress before the obstruction is treated as real
export function routeTick(m, tx, tz, dt) {
  const b = m.body; if (!b) return null;
  if (b.verb) return null;
  const wp = routeTarget(m, _p2);
  if (wp) return wp;
  // the goal moved somewhere else: this is a new problem, not the same one
  if (Math.abs(tx - b.progX) > 4 || Math.abs(tz - b.progZ) > 4) { b.progX = tx; b.progZ = tz; b.progD = 1e9; b.progT = 0; }
  const d = Math.hypot(tx - m.position.x, tz - m.position.z);
  if (d < b.progD - 0.02) { b.progD = d; b.progT = 0; return null; }
  b.progT += dt;
  if (b.progT < STALL_T || d < 2.5 || b.replanCool > 0) return null;
  b.progT = 0; b.progD = d; b.replanCool = 1.5;
  // Alternate sides on a re-plan. If the left way round did not work, the right way round is the only other
  // answer, and trying the same one again is what an animal does.
  b.routeSide = -b.routeSide;
  if (!planRoute(m, tx, tz, b.routeSide)) return null;
  return routeTarget(m, _p2);
}
export function clearRoute(m) { if (m.body) { m.body.routeN = 0; m.body.routeI = 0; m.body.routeT = 0; } }

// =====================================================================================================
// THE ANIMATOR CONTRACT — everything on m.body that a rig can be driven from
// -----------------------------------------------------------------------------------------------------
// charmesh.js setState() currently gets { speed, aiming, crouch, glitch, headYaw, ... } and nothing about
// intent, which is the other half of why the movement reads as a machine: the pose has no idea the body is
// braking, banking, spent, committed or in the air. All of this is already computed here for free.
//
//   body.speed      m/s, damped                stride length and cadence
//   body.gait       0..1 of the commanded pace  0 while braking into a turn, 1 at pace: the accel/brake pose
//   body.gate       0..1 raw heading gate       <1 means "not pointed where I am going": the turn-in-place
//   body.head       rad of heading error        which way to twist the shoulders
//   body.turn       rad/s, signed, damped       how hard it is turning
//   body.lean       -1..1                       bank into the turn; feed straight into a root roll
//   body.wind       0..100, body.blown          chest heave, weapon droop, the walk home
//   body.sprinting  bool                        gun down, arms driving, longer stride
//   body.airborne / body.vy                     the fall pose, and how far into it
//   body.verb / body.verbK  committed act, 0..1 progress   vault / clamber / dive / melee poses
//   body.crouchWant 0..1                        drives m.crouch, and therefore the capsule height
//   body.recover    s                           getting back up off the deck: no weapon up yet
//
// A rig that reads gait, lean, verb and wind is a rig that shows the difference between a man crossing a
// road and a man who has just been shot at, without a single new animation clip being authored.
//
// =====================================================================================================
// WHAT THIS COSTS
// -----------------------------------------------------------------------------------------------------
//   mantleProbe    1-3 pointInSolid on a miss, ~8 on a hit, plus 1-2 groundHeight. No rays. Capped at one
//                  per mimic per 0.5 s by body.linkCool: 12 mimics = 24 probes/s = ~1.2/frame at 20 Hz.
//   planRoute      1 collider query + up to 8 standable() (2 pointInSolid + 1 groundHeight each). No rays.
//                  Only on a stall or an explicit order; never per frame.
//   reach          1 groundHeight. No rays.
//   bodyTick       arithmetic and two damps. No queries at all.
//   fallTick       1 groundHeight, which followGround was already paying for.
//   reflexTick     4 float compares per live grenade, and there are almost never any.
//   rays           ZERO, from this entire module. It owns the budget for everybody else; it spends none.
//   allocation     zero after createBody, which allocates one object and one Float32Array per mimic, once.
//
// Measured, headless, on the real zone (tools/scenarios/ai2-traversal-*.mjs):
//   mantleProbe    1.6 us on a hit, 0.7 us on a miss, over 20,000 calls each
//   planRoute      0.4 ms for the query and up to eight standable() probes, once per stall
//   whole layer    42-57 us/frame for TWELVE mimics running bodyTick + fallTick + reflexTick + moveSpeedFor
//                  + a mantle probe every 2 s each, over 600 steps. Zero rays and zero line-of-sight calls.
// =====================================================================================================
