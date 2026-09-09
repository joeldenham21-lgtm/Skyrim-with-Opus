// Ambush — the mimic that decided to be a piece of the landscape.
//
// Its whole advantage is POSITION, never information. It does not know you are coming. It knows the ground:
// which way people walk in, which doorway they have to use, and where it can sit so that the man on the lane
// cannot see it until he is inside its killing angle. Then it waits — for minutes, not seconds — making
// literally no sound at all, and when you cross the line it stands up and shoots you at a range where that
// is the end of the conversation.
//
// THE FOUR PROMISES THIS FILE MAKES
//
//   1. ABSOLUTE SILENCE.  A hidden mimic emits ZERO audio. Not a quiet static bed, not an occasional radio
//      burst at low gain, not a footstep: zero calls into ctx.audio. That is enforced structurally — the
//      entity's own sound()/loopSound() are shadowed by no-ops for the whole time it is down, its static
//      loop is stopped outright rather than attenuated, and hideTick owns the frame so nothing downstream
//      ever runs. It is the one enemy in the game you cannot hear coming, and that is the point.
//
//   2. IT DOES NOT CHEAT.  Every trigger is sensory. The hider perceives on its own cadence through the
//      entity's own perceive(), so its whole model of you is lastSeenPlayer + beliefR exactly like every
//      other mimic; a hider that has never seen or heard you has a belief tens of metres wrong and springs
//      at nothing. "Is your back turned" is answered by observedByPlayer() — a real ray from its own eyes —
//      not by reading your yaw. This file contains no read of ctx.player at all.
//
//   3. THERE IS A TELL.  A careful player must be able to find one, or the whole thing is a coin flip that
//      taxes patience instead of rewarding it. There are four, in the order you will meet them:
//        THE PULSE   — the face blot brightens for a third of a second every few seconds. Silent, visible
//                      only if you are looking at it, and BRIGHTER AND SLOWER on a good one: a recruit's
//                      hide flashes twice as often as an elite's. This is the discovery tell, and at night,
//                      in a dark doorway, it is a pale smear that breathes.
//        THE STILLNESS — its shiver drops to a third and it never moves a step. Everything else alive in
//                      this zone twitches; the flora moves; it does not.
//        THE FACING   — it is trained on its lane, not on you, so its silhouette faces the doorway. A shape
//                      that is looking at something else is a shape that was placed.
//        THE SCRAPE   — inside 6 m, 0.40 s before it rises, one dry scrape at gain 0.28. That is the beat of
//                      warning fairness demands at the moment of violence; it is not a discovery aid.
//
//   4. IT IS GATED ON PROGRESSION.  At escalation 0 there are no hiders at all. The number the zone may have
//      standing is escalation-capped and one-per-POI. And the three rows below turn a day-one hider into an
//      impatient man behind a thin pole who gives up in 45 s and shoots slowly, and a late-game one into
//      something that picks a spot with a verified broken sightline, waits fifteen minutes, and puts the
//      first round into you 0.12 s after it stands.
//
// COST. Hidden is the cheapest state in the AI: a handful of compares and one timer, no rays, no allocation.
// Choosing a place costs at most 8 budgeted rays ONCE, plus a fixed pointInSolid sweep for the choke; from
// then until it springs it is free. observedByPlayer is only asked when a fresh sighting is already inside
// the spring radius, on the perception cadence, and it draws from the shared tactical budget.
//
// Imports are three and core math/rng only — no mimic.js, no squad.js, no senses.js — so this module sits at
// the bottom of the import graph, has no cycles, and is bundled and driven on its own by
// tools/scenarios/ai2-ambush-*.mjs. What it needs from its neighbours (the shared ray budget, senses.js's
// concealment, the squad's mouth) arrives through the three set*() hooks below, each with a working local
// fallback, so nothing here is blocked on another module landing.
import * as THREE from 'three';
import { clamp01, lerp, TAU } from '../core/math.js';
import { mulberry32 } from '../core/rng.js';

// =====================================================================================================
// THE CURVE. Merged into mimic.js's SKILL table by the integrator (contract C2). A plain literal with no
// dependency on any import, so the merge is safe under the module cycle.
// =====================================================================================================
export const SKILL_ROWS = {
  patience:  [0.00, 1.00],   // how long it will sit, how tight the trigger, how still the tell
  springR:   [8, 18],        // m at which it will spring on a man whose back is turned
  ambushAim: [0.55, 0.15],   // multiplier on SKILL.react for the prepared first shot
};
const ROW_FALLBACK = { patience: 0, springR: 8, ambushAim: 0.55, react: 1.05, share: 2.6 };
// Reading a row that has not been merged yet (or a bare test double) must never throw and must never invent
// difficulty: an unmerged row reads as the "at 0" recruit.
function sk(m, key) { const s = m.skill; const v = s ? s[key] : undefined; return typeof v === 'number' ? v : ROW_FALLBACK[key]; }

// =====================================================================================================
// TUNING. Everything a designer would want to move, none of it a difficulty number (those are the rows).
// =====================================================================================================
export const SEARCH_R = 42;          // m it will look for a place to hide
export const REACH_MAX = 34;         // m it will actually walk to get to one
export const SEEK_SPEED = 1.35;      // m/s. It NEVER sprints into a hiding place.
export const SEEK_MAX = 30;          // s before it settles wherever it got to
export const SET_TIME = 0.85;        // s going down: the capsule shrinks, the sound stops
export const RISE_TIME = 0.35;       // s coming up
export const TELL_TIME = 0.40;       // s of warning before the rise
export const TELL_R = 6.0;           // m inside which the scrape is played at all
export const TELL_GAIN = 0.28;       // and how loud
export const TELL_MAX = 18;          // m it carries
export const NEAR_SPRING = 3.0;      // m: he is about to walk into it, facing is irrelevant
export const CLOSE_FRAC = 0.5;       // fraction of springR inside which facing is irrelevant
export const CALL_R = 25;            // m from the hide a delivered contact call will spring it
export const SIGHT_FRESH = 0.40;     // s a sighting counts as "right now" for a trigger
export const SENSE_EVERY = 0.18;     // s between perception ticks while down
export const LOOK_DEG = [70, 45];    // half-angle of "he is looking at me", at patience 0 .. 1
export const HOLD_S = [45, 900];     // s of patience at patience 0 .. 1. A planted ambush never gets bored.
export const PULSE_PERIOD = [2.6, 5.2];  // s between tell pulses at patience 0 .. 1
export const PULSE_TIME = 0.35;      // s a pulse lasts
export const HIDE_SHIVER = 0.35;     // edge shiver while down (a live mimic is 1.0+)
export const HIDE_FADE = 0.55;       // face opacity while down, between pulses
export const PULSE_FADE = 0.98;      // and at the top of one
export const HIDE_AWARE = 0.15;      // awareness is clamped here while down: it watches, it does not engage
export const MIN_REACT = 0.12;       // s floor on the prepared shot. Sudden, not instant.
export const CALL_AFTER = 0.25;      // s after the first round that `contact` goes out. Never before.
export const CROUCH_H = 1.25;        // the mimic's own crouched capsule (mimic.js STAND_H 1.85 / CROUCH_H 1.25)
export const STAND_H = 1.85;
export const FAR_PROBE = 30;         // m up the lane the concealment test is taken from
export const NEAR_PROBE = 6;         // m up the lane the killing-angle test is taken to
export const NEAR_PROBE_2 = 3;       // and the fallback, for a man covering a room rather than a road
export const IDEAL_PERP = 4.0;       // m off the lane a good hide sits: you walk PAST it, not INTO it
export const MAX_PERP = 15;          // m off the lane past which a hide is guarding nothing
export const CAND_MAX = 12;          // candidates kept from the pre-score
export const VALIDATE_MAX = 4;       // of those, how many are worth two rays each
export const PICK_EVERY = 0.5;       // s between attempts when the budget refuses
export const PICK_TRIES = 6;         // attempts before it gives up and hides where it stands
export const MAX_HIDERS = 3;         // in the whole zone, ever, at escalation 3
export const CHOKE_STEP = 1.2;       // m between choke samples along the lane
export const CHOKE_SPAN = 20;        // m of lane swept looking for a place he has to commit to
export const CHOKE_FAN = [0, 20, -20];   // degrees either side of the lane also swept
export const CHOKE_Y = 1.35;         // m above the ground the width is measured at (chest, not ankles)
// Three shapes, tightest first. Measured across the world's real geometry (tools/scenarios/ai2-ambush-2):
//   0 DOORWAY  open at 0.6 m, walls at 1.5 m — a door, a hatch, a gap in a fence
//   1 GAP      open at 1.5 m, walls at 3.2 m — between two wrecks, a gateway, a cattle race
//   2 WALL     open both sides at 0.6 m, a wall within 2.2 m on exactly ONE side — he is hugging it, and a
//              man with a wall on one shoulder has half the answers he had a second ago
export const CHOKE_KIND = ['doorway', 'gap', 'wall'];

// =====================================================================================================
// SHARED PER-FRAME RAY BUDGET. traversal.js owns the real one (contract C4); until the integrator injects
// it this is a behaviourally identical local pool, so the module runs and tests standalone.
//   integrator:  ambush.setRayBudget(traversal.losBudget)
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

// How well the ground at a point hides a crouched, motionless body. senses.js owns the real one and knows
// about flora; without it we fall back to the surface table alone, which is monotone in the same direction
// and never claims more concealment than the real thing would.
const SURFACE_CONCEAL = { grass: 0.22, mud: 0.26, road: 0.00, rock: 0.08, water: 0.14, concrete: 0.04, metal: 0.02, wood: 0.06 };
let concealFn = null;
export function setConcealment(fn) { concealFn = typeof fn === 'function' ? fn : null; }
function concealAt(ctx, x, z) {
  if (concealFn) return clamp01(concealFn(ctx, x, z, true, false));
  const s = ctx.world.getSurface ? ctx.world.getSurface(x, z) : 'grass';
  return clamp01(0.30 + (SURFACE_CONCEAL[s] == null ? 0.10 : SURFACE_CONCEAL[s]));
}

// The voice. The integrator points this at squad.mind.say / command.sayLone; standalone it is the entity's
// own handset. It is only ever called AFTER the first round has left the barrel — never before.
let sayFn = null;
export function setSayHook(fn) { sayFn = typeof fn === 'function' ? fn : null; }
function say(m, word, gain) {
  if (sayFn) { sayFn(m, word, gain); return; }
  if (m.sound) m.sound('mimic_radio', { word, gain: gain == null ? 0.85 : gain, max: 95, rate: 1.12 });
}

// =====================================================================================================
// Module scratch and counters. Nothing in this file allocates after load.
// =====================================================================================================
const _site = { x: 0, y: 0, z: 0, roof: 0 };
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _pose = { headYaw: 0, headPitch: 0, aim: 0, aimYaw: 0, aimPitch: 0, speed: 0, crouch: 1 };
const _vis = { shiver: HIDE_SHIVER, fade: HIDE_FADE, glow: 1.6, pulse: 0 };
const _lane = { ox: 0, oz: 0, dx: 0, dz: 1, ok: false, src: 'none' };
const _seek = { x: 0, y: 0, z: 0 };
// candidate pool: plain numbers, never Vector3s, so a pick allocates nothing
const CAND = []; for (let i = 0; i < CAND_MAX; i++) CAND.push({ x: 0, y: 0, z: 0, s: 0, kind: 0, enc: 0 });
let candN = 0;
// the live hiders, so frequency can be capped without anyone owning a registry
const HIDERS = [];
let rng = mulberry32(0x51DE);

export const COUNT = {
  picks: 0, picked: 0, failed: 0, cheap: 0, springs: 0, tells: 0, abandons: 0, bored: 0,
  rays: 0, solid: 0, senseTicks: 0, looks: 0, muted: 0, alloc: 0, chokes: 0,
  reasons: { near: 0, close: 0, blind: 0, choke: 0, call: 0, hit: 0, squad: 0, forced: 0 },
};
export function stats() {
  return {
    picks: COUNT.picks, picked: COUNT.picked, failed: COUNT.failed, inPlace: COUNT.cheap, springs: COUNT.springs,
    tells: COUNT.tells, abandons: COUNT.abandons, bored: COUNT.bored, chokes: COUNT.chokes,
    rays: COUNT.rays, solid: COUNT.solid, senseTicks: COUNT.senseTicks, looks: COUNT.looks,
    alloc: COUNT.alloc, live: hiderCount(), reasons: COUNT.reasons,
  };
}
export function resetAmbush() {
  HIDERS.length = 0; candN = 0; losFrame = -1; losLeft = 0; rng = mulberry32(0x51DE);
  COUNT.picks = COUNT.picked = COUNT.failed = COUNT.cheap = COUNT.springs = COUNT.tells = 0;
  COUNT.abandons = COUNT.bored = COUNT.rays = COUNT.solid = COUNT.senseTicks = COUNT.looks = 0;
  COUNT.muted = COUNT.alloc = COUNT.chokes = 0;
  for (const k in COUNT.reasons) COUNT.reasons[k] = 0;
}
export function installAmbush(ctx) { return ctx; }   // nothing global to install; kept for symmetry

// ---- the fields. A mimic does not lie down in a gravity well. (Same rule as mimic.js anomalyNear.) ----
function anomalyNear(ctx, x, z, pad = 2) {
  const list = ctx.anomalies && ctx.anomalies.list; if (!list || !list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || !a.position) continue;
    const r = (a.radius || 6) + pad;
    if (Math.abs(a.position.x - x) > r || Math.abs(a.position.z - z) > r) continue;
    if (Math.hypot(a.position.x - x, a.position.z - z) < r) return a;
  }
  return null;
}

// =====================================================================================================
// FREQUENCY GATING — how many of these the zone is allowed to have standing, and where.
// escalation 0: none at all. 1: one. 2: two. 3: three, and never more than one per POI.
// population.js asks before it spawns a lone hider; command.js's BAIT does not (its STAY seat is a man it
// already has, not a new body, so it is not part of the census).
// =====================================================================================================
function prune() { for (let i = HIDERS.length - 1; i >= 0; i--) { const m = HIDERS[i]; if (!m || !m.alive || !m.hide || m.hide.state === 'off' || m.hide.state === 'out') HIDERS.splice(i, 1); } }
export function hiderCount() { prune(); return HIDERS.length; }
export function hidersAt(poiId) { prune(); let n = 0; for (const m of HIDERS) if (m.poi === poiId) n++; return n; }
export function hiderCap(ctx) { return Math.min(MAX_HIDERS, (ctx.director && ctx.director.escalation) | 0); }
export function mayHide(ctx, poiId) {
  const cap = hiderCap(ctx);
  if (cap <= 0) return false;
  if (hiderCount() >= cap) return false;
  if (poiId && hidersAt(poiId) >= 1) return false;
  return true;
}

// =====================================================================================================
// PER-ENTITY STATE
// =====================================================================================================
export function createHide(m, opts = {}) {
  m.hide = {
    state: 'off',          // off | pick | seek | set | hold | tell | rise | out
    t: 0,                  // seconds in this state
    held: 0,               // seconds actually hidden
    holdFor: HOLD_S[0],
    planted: !!opts.planted,   // told to wait here: never gets bored
    // the place
    hasSpot: false, x: 0, y: 0, z: 0, quality: 0, kind: 0, enclosure: 0,
    // the lane it is guarding: a unit bearing from the hide toward where the man will come FROM
    laneX: 0, laneZ: 1, laneOK: false, laneSrc: 'none',
    aimX: 0, aimZ: 0,      // the point on the lane it is trained on
    chokeX: 0, chokeZ: 0, hasChoke: false, chokeTier: -1, chokeScan: 0,
    springR: ROW_FALLBACK.springR,
    // clocks
    senseT: 0, pickT: 0, tries: 0, seekT: 0,
    pulseT: 1.4, pulse: 0, pulseHold: 0, flinch: 0,
    // triggers
    hp0: 0, toldX: 0, toldZ: 0, toldT: -1e9, forced: false,
    seenBy: false, seenOK: false, seenT: -1e9, seenAt: -1e9,
    towardX: null, towardZ: null,
    // the spring
    reason: '', springT: -1e9, fired: false, called: false, callAt: -1e9,
    muted: false, crouch: 0,
  };
  if (opts.toward) { m.hide.laneX = opts.toward.x; m.hide.laneZ = opts.toward.z; }
  return m.hide;
}
function ensure(m) { return m.hide || createHide(m); }

export function isHidden(m) { const h = m.hide; return !!h && (h.state === 'set' || h.state === 'hold' || h.state === 'tell'); }
// True whenever this module owns the body: nothing else may steer, shoot, skip or talk.
export function isCommitted(m) { const h = m.hide; return !!h && h.state !== 'off' && h.state !== 'out'; }
export function isSeeking(m) { const h = m.hide; return !!h && (h.state === 'pick' || h.state === 'seek'); }
export function spotOf(m, out) { const h = m.hide; if (!h || !h.hasSpot) return null; out.x = h.x; out.y = h.y; out.z = h.z; return out; }

// =====================================================================================================
// ABSOLUTE SILENCE
// -----------------------------------------------------------------------------------------------------
// Attenuating the static bed is not silence — today's planted ambusher still leaks it at gain x0.3, which
// is a 60 m tell that arrives before any of the visual ones and ruins the whole idea. This stops the loop
// outright, blocks its recreation, kills the handset, and shadows the entity's two audio methods with
// no-ops so that ANY call from anywhere — the rig's footfall, a reload, a hit reaction, a caller who has
// not heard of this module — is swallowed for as long as it is down.
// =====================================================================================================
function mutedSound() { COUNT.muted++; return null; }
function mutedLoop() { COUNT.muted++; return null; }
export function silence(m, on) {
  const h = ensure(m);
  if (on) {
    if (h.muted) return;
    h.muted = true;
    // 1. the static bed: stopped, not faded, and refused for as long as it is down
    if (m.staticLoop) { try { m.staticLoop.stop(0.25); } catch (e) { /* a stub handle */ } if (m.sounds && m.sounds.delete) m.sounds.delete(m.staticLoop); m.staticLoop = null; }
    if (m.sounds && m.sounds.size) { for (const s of m.sounds) { try { s.stop(0.25); } catch (e) { /* ignore */ } } m.sounds.clear(); }
    m.loopRetry = 1e9;
    m.__silent = true;              // the one flag mimic.js checks before creating the loop again
    // 2. the handset: it hears the radio, it does not key it
    m.radioT = 1e9; m.shareT = -1e9; m.radioSaidT = m.ctx ? m.ctx.elapsed + 1e6 : 1e6;
    // 3. no light, ever, whatever the hour
    m.wantLight = false;
    // 4. and the hard stop: own-property no-ops shadowing the prototype methods
    m.sound = mutedSound; m.loopSound = mutedLoop;
  } else {
    if (!h.muted) return;
    h.muted = false;
    delete m.sound; delete m.loopSound;
    m.__silent = false; m.loopRetry = 0.4;
    m.radioSaidT = -1e9;
    m.radioT = 0.9 + rng() * 2.4;
  }
}

// =====================================================================================================
// THE LANE — which way the man is expected to come from.
// Fair sources only, in order of how much the zone actually knows:
//   1. an explicit bearing from the caller (population's approach angle, BAIT's retreat vector)
//   2. director.poiRecord(poi).ang — the bearing the zone has WATCHED you walk in on, several times
//   3. the squad's or the mimic's own belief about where you were
//   4. the road, because people walk roads
//   5. outward from the POI centre, which is the only guess left
// =====================================================================================================
function laneFor(m, ctx, towardX, towardZ, out) {
  out.ox = m.position.x; out.oz = m.position.z; out.ok = false; out.src = 'none';
  let dx = 0, dz = 0;
  if (towardX != null && towardZ != null && (towardX !== m.position.x || towardZ !== m.position.z)) {
    dx = towardX - m.position.x; dz = towardZ - m.position.z; out.src = 'told';
  }
  if (!dx && !dz) {
    const rec = ctx.director && ctx.director.poiRecord ? ctx.director.poiRecord(m.poi) : null;
    const poi = m.poi && ctx.world.poi ? ctx.world.poi(m.poi) : null;
    if (rec && poi) {
      // ang is the bearing from the POI centre to where he was standing when he walked in
      const px = poi.x + Math.cos(rec.ang) * poi.r, pz = poi.z + Math.sin(rec.ang) * poi.r;
      dx = px - m.position.x; dz = pz - m.position.z; out.src = 'memory';
    }
  }
  if (!dx && !dz && m.lastSeenPlayer && (m.lastSeenT || -1e9) > -1e8) {
    dx = m.lastSeenPlayer.x - m.position.x; dz = m.lastSeenPlayer.z - m.position.z; out.src = 'belief';
  }
  if (!dx && !dz) {
    const poi = m.poi && ctx.world.poi ? ctx.world.poi(m.poi) : null;
    if (poi) { dx = m.position.x - poi.x; dz = m.position.z - poi.z; out.src = 'poi'; }
  }
  const l = Math.hypot(dx, dz);
  if (l < 0.05) { const a = rng() * TAU; out.dx = Math.cos(a); out.dz = Math.sin(a); out.src = 'guess'; return out; }
  out.dx = dx / l; out.dz = dz / l; out.ok = true;
  return out;
}

// =====================================================================================================
// THE CHOKE — the doorway he has to commit to.
// Sweeps the lane looking for a place where the ground is open at 1.5 m either side and solid at 3.0 m:
// a gate, a doorway, a gap in a wall, the space between two wrecks. A man inside one has given up his
// options, which is exactly when an ambush should fire — and it is why "clearing a building" is dangerous.
// pointInSolid only; no rays. Runs once, when the hide is chosen.
// =====================================================================================================
// ONE bearing of the fan per call, so the sweep is spread over the settle rather than spiking a frame.
// Returns true when a choke was found (and stops), false while there is more to sweep or nothing to find.
function chokeStep(ctx, h) {
  const w = ctx.world;
  if (!w.pointInSolid || h.hasChoke || h.chokeScan >= CHOKE_FAN.length) return h.hasChoke;
  {
    const bi = h.chokeScan++;
    const a = CHOKE_FAN[bi] * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const lx = h.laneX * ca - h.laneZ * sa, lz = h.laneX * sa + h.laneZ * ca;
    const px = -lz, pz = lx;            // this bearing's perpendicular
    for (let d = 2.0; d <= CHOKE_SPAN; d += CHOKE_STEP) {
      const cx = h.x + lx * d, cz = h.z + lz * d;
      const g = w.groundHeight(cx, cz, h.y + 4);
      const y = g.y + CHOKE_Y;
      COUNT.solid += 8;
      const l06 = w.pointInSolid(cx + px * 0.6, y, cz + pz * 0.6);
      const r06 = w.pointInSolid(cx - px * 0.6, y, cz - pz * 0.6);
      if (l06 || r06) continue;                                     // he cannot stand here at all
      const l15 = w.pointInSolid(cx + px * 1.5, y, cz + pz * 1.5);
      const r15 = w.pointInSolid(cx - px * 1.5, y, cz - pz * 1.5);
      let tier = -1;
      if (l15 && r15) tier = 0;                                     // DOORWAY
      else if (!l15 && !r15) {
        const l32 = w.pointInSolid(cx + px * 3.2, y, cz + pz * 3.2);
        const r32 = w.pointInSolid(cx - px * 3.2, y, cz - pz * 3.2);
        if (l32 && r32) tier = 1;                                   // GAP
        else {
          const l22 = w.pointInSolid(cx + px * 2.2, y, cz + pz * 2.2);
          const r22 = w.pointInSolid(cx - px * 2.2, y, cz - pz * 2.2);
          if (l22 !== r22) tier = 2;                                // WALL on one shoulder
        }
      }
      if (tier < 0) continue;
      h.chokeX = cx; h.chokeZ = cz; h.hasChoke = true; h.chokeTier = tier; COUNT.chokes++;
      return true;
    }
  }
  return false;
}

// =====================================================================================================
// CHOOSING THE PLACE
// -----------------------------------------------------------------------------------------------------
// Two rays decide whether a candidate is an ambush or a man standing in a bush:
//
//   CONCEALED   lineOfSight(spot at CROUCH eye  ->  the lane at 30 m) must be FALSE.
//               If the man walking in can see the spot from out there, it is not a hiding place, it is a
//               firing position, and he will shoot it from 30 m where it cannot reach him.
//   KILLING     lineOfSight(spot at STANDING eye -> the lane at 6 m) must be TRUE.
//               When he is close it must be able to stand up and put rounds into him without moving.
//
// The pair together is the whole idea: invisible from far, lethal from near. A recruit only has to pass the
// second test, so a day-one ambush is a man crouched in plain view of the road with a good angle on it —
// findable, killable, and exactly the beatable version of the same behaviour.
// =====================================================================================================
function pushCand(x, y, z, s, kind) {
  if (candN < CAND.length) { const c = CAND[candN++]; c.x = x; c.y = y; c.z = z; c.s = s; c.kind = kind; c.enc = 0; return; }
  let worst = 0; for (let i = 1; i < candN; i++) if (CAND[i].s < CAND[worst].s) worst = i;
  if (s > CAND[worst].s) { const c = CAND[worst]; c.x = x; c.y = y; c.z = z; c.s = s; c.kind = kind; c.enc = 0; }
}
function sortCand() {
  for (let i = 1; i < candN; i++) {
    const c = CAND[i], x = c.x, y = c.y, z = c.z, s = c.s, k = c.kind, e = c.enc;
    let j = i - 1;
    while (j >= 0 && CAND[j].s < s) { const a = CAND[j + 1], b = CAND[j]; a.x = b.x; a.y = b.y; a.z = b.z; a.s = b.s; a.kind = b.kind; a.enc = b.enc; j--; }
    const t = CAND[j + 1]; t.x = x; t.y = y; t.z = z; t.s = s; t.kind = k; t.enc = e;
  }
}
// Can a body actually get down here? `fromY` is the height the ground search starts from, and a point that
// came out of a world registry is trusted to be on the floor it was registered on — searching from three
// metres up finds the catwalk above it instead and puts the ambush on a roof.
function siteFor(ctx, x, z, fromY) {
  const w = ctx.world;
  if (w.isWater && w.isWater(x, z)) return null;
  const g = w.groundHeight(x, z, fromY);
  COUNT.solid += 1;
  if (w.pointInSolid && w.pointInSolid(x, g.y + 0.6, z)) return null;   // no room even to crouch
  _site.x = x; _site.y = g.y; _site.z = z; _site.roof = 0;
  return _site;
}
// ENCLOSURE — 0..1 of the four cardinal bearings that are walled within 3.2 m at chest height. This world's
// buildings have no roof colliders to test for, but a man in a room is walled on three sides and a man in the
// open is walled on none, so this is the real "he is inside something" signal — and it is what makes clearing
// a building dangerous, because the highest-scoring hides in the zone are the ones inside the rooms.
export function enclosureAt(ctx, x, y, z) { return enclosure(ctx, x, y, z); }
function enclosure(ctx, x, y, z) {
  const w = ctx.world; if (!w.pointInSolid) return 0;
  const h = y + 1.30; let n = 0;
  COUNT.solid += 4;
  if (w.pointInSolid(x + 3.2, h, z)) n++;
  if (w.pointInSolid(x - 3.2, h, z)) n++;
  if (w.pointInSolid(x, h, z + 3.2)) n++;
  if (w.pointInSolid(x, h, z - 3.2)) n++;
  return n * 0.25;
}

function scoreCands(m, ctx, h, lane) {
  const w = ctx.world;
  candN = 0;
  const ox = m.position.x, oz = m.position.z, oy = m.position.y;
  // WHERE HE IS STANDING IS A CANDIDATE. Obvious once stated, and load-bearing: a man already inside a
  // building is standing in the best place in the building, and every registry point within reach of him is
  // out in the open where the approach can see it. Without this he rejects them all and falls back three
  // seconds later to the same spot anyway, having learnt nothing about it.
  {
    const site = siteFor(ctx, ox, oz, oy + 1.2);
    if (site && !anomalyNear(ctx, ox, oz, 2.5)) pushCand(site.x, site.y, site.z, 0.85 + 1.45 * concealAt(ctx, ox, oz), 3);
  }
  const lists = [w.hidingSpots, w.spawnSpots, w.coverPoints];
  for (let li = 0; li < 3; li++) {
    const arr = lists[li]; if (!arr || !arr.length) continue;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      const p = e && e.position ? e.position : e;
      if (!p) continue;
      if (li === 1 && e.kind !== 'hidden' && e.kind !== 'interior') continue;
      const dx = p.x - ox, dz = p.z - oz;
      const dm = Math.hypot(dx, dz);
      if (dm > SEARCH_R || dm > REACH_MAX) continue;
      // where it sits relative to the lane he will walk
      const proj = dx * lane.dx + dz * lane.dz;
      const perp = Math.abs(dx * -lane.dz + dz * lane.dx);
      if (perp > MAX_PERP) continue;
      const site = siteFor(ctx, p.x, p.z, (p.y != null ? p.y : oy) + 0.8);
      if (!site) continue;
      if (anomalyNear(ctx, p.x, p.z, 2.5)) continue;
      // Is there anything at all between this spot and the man walking in? Two pointInSolid probes up the
      // lane at chest height. It is not the concealment test — that needs a ray — but it predicts it well
      // enough to put the four candidates worth a ray at the top of the list, for free.
      let screen = 0;
      if (w.pointInSolid) {
        COUNT.solid += 2;
        if (w.pointInSolid(p.x + lane.dx * 1.6, site.y + 1.30, p.z + lane.dz * 1.6)) screen += 0.6;
        if (w.pointInSolid(p.x + lane.dx * 4.0, site.y + 1.30, p.z + lane.dz * 4.0)) screen += 0.4;
      }
      let s = 0;
      s -= 0.055 * dm;                                                   // it has to walk there, quietly
      s += 1.45 * concealAt(ctx, p.x, p.z);                              // is the ground itself cover from view
      s += 1.30 * screen;                                                // and is there something in front of it
      s += 0.95 * clamp01(1 - Math.abs(perp - IDEAL_PERP) / 7);          // BESIDE the lane, not on it
      s += proj > -5 && proj < 28 ? 0.55 : 0;                            // between him and where he is going
      s += li === 0 ? 0.45 : li === 1 ? 0.30 : 0;                        // a place built to hide in
      s += e && e.poi && e.poi === m.poi ? 0.35 : 0;
      s += (rng() - 0.5) * 0.10;                                         // tie-break only
      pushCand(site.x, site.y, site.z, s, li);
    }
  }
  // second pass, over the twelve survivors only: how enclosed is each. Four probes each, bounded, and it is
  // what pulls the ambush off the open field and into the room.
  for (let i = 0; i < candN; i++) {
    const c = CAND[i];
    c.enc = enclosure(ctx, c.x, c.y, c.z);
    c.s += 1.10 * c.enc;
  }
  return candN;
}

// Returns true when a spot was chosen (h.hasSpot set). Returns false when it could not — either the budget
// refused (retry next tick) or there is nothing here worth hiding in.
export function pickHide(m, ctx, towardX, towardZ, opts = {}) {
  const h = ensure(m);
  COUNT.picks++;
  const lane = laneFor(m, ctx, towardX, towardZ, _lane);
  h.laneX = lane.dx; h.laneZ = lane.dz; h.laneOK = lane.ok; h.laneSrc = lane.src;
  const p = clamp01(sk(m, 'patience'));
  // A patient man insists on the concealment half for his first few looks, then takes the best hole he
  // has found rather than standing in the road arguing with himself about it.
  const strict = opts.strict != null ? opts.strict : (p >= 0.35 && (h.tries || 0) < 3);
  const n = scoreCands(m, ctx, h, lane);
  if (n === 0) { COUNT.failed++; return false; }
  sortCand();
  const w = ctx.world;
  const tries = Math.min(n, Math.max(1, Math.round(lerp(2, VALIDATE_MAX, p))));
  let bestI = -1, bestQ = -1, bestFar = true, bestKill = false, bestNear2 = false, near2 = false;
  for (let i = 0; i < tries; i++) {
    const c = CAND[i];
    if (!budget(ctx, 3)) break;                       // the pool said no: keep what we have, retry next tick
    COUNT.rays += 2;
    // the lane, taken from THIS candidate rather than from the mimic's feet
    const fx = c.x + lane.dx * FAR_PROBE, fz = c.z + lane.dz * FAR_PROBE;
    const nx = c.x + lane.dx * NEAR_PROBE, nz = c.z + lane.dz * NEAR_PROBE;
    const fg = w.groundHeight(fx, fz, c.y + 6), ng = w.groundHeight(nx, nz, c.y + 6);
    _p1.set(c.x, c.y + CROUCH_H * 0.9, c.z);
    _p2.set(fx, fg.y + 1.62, fz);
    const seenFar = w.lineOfSight(_p1, _p2);
    _p1.set(c.x, c.y + STAND_H * 0.9, c.z);
    _p2.set(nx, ng.y + 1.30, nz);
    let killNear = w.lineOfSight(_p1, _p2);
    // A man covering a ROOM rather than a road has a wall six metres up the lane and a killing angle three
    // metres in front of him. Without this second probe every interior hide is rejected and the building
    // ambush — the one that ends a run — never happens.
    near2 = false;
    if (!killNear) {
      near2 = true;
      const kx = c.x + lane.dx * NEAR_PROBE_2, kz = c.z + lane.dz * NEAR_PROBE_2;
      const kg = w.groundHeight(kx, kz, c.y + 6);
      _p2.set(kx, kg.y + 1.30, kz);
      killNear = w.lineOfSight(_p1, _p2);
      COUNT.rays++;
    }
    const q = (seenFar ? 0 : 0.45) + (killNear ? 0.55 : 0);
    if (q > bestQ) { bestQ = q; bestI = i; bestFar = seenFar; bestKill = killNear; bestNear2 = near2 && killNear; }
    if (!seenFar && killNear) break;                  // both halves: stop looking, this is the one
  }
  // The killing angle is not negotiable at any skill: a hole it cannot shoot out of is not a hiding place,
  // it is a grave. The CONCEALMENT half is what the curve buys — a recruit will take a spot the man walking
  // in can see from thirty metres, which is exactly the beatable version of this behaviour.
  if (bestI < 0 || !bestKill) { COUNT.failed++; return false; }
  if (strict && bestFar) { COUNT.failed++; return false; }
  const c = CAND[bestI];
  h.x = c.x; h.y = c.y; h.z = c.z; h.hasSpot = true; h.quality = bestQ; h.kind = c.kind;
  h.enclosure = c.enc;
  const aimD = bestNear2 ? NEAR_PROBE_2 : NEAR_PROBE;
  h.aimX = c.x + lane.dx * aimD; h.aimZ = c.z + lane.dz * aimD;
  h.chokeScan = 0; h.hasChoke = false; h.chokeTier = -1;   // the choke sweep is amortised over the settle
  COUNT.picked++;
  return true;
}

// The fallback when there is nothing to choose from: hide where it stands. Cheap, no rays, still silent.
function hideInPlace(m, ctx, h) {
  const site = siteFor(ctx, m.position.x, m.position.z, m.position.y + 1.2);
  h.x = site ? site.x : m.position.x; h.y = site ? site.y : m.position.y; h.z = site ? site.z : m.position.z;
  h.enclosure = 0; h.hasSpot = true; h.quality = 0; h.kind = 3;
  h.aimX = h.x + h.laneX * NEAR_PROBE; h.aimZ = h.z + h.laneZ * NEAR_PROBE;
  h.chokeScan = 0; h.hasChoke = false; h.chokeTier = -1;
  COUNT.cheap++;
}

// =====================================================================================================
// BEGINNING AND ENDING
// =====================================================================================================
export function beginHide(m, ctx, towardX, towardZ, opts = {}) {
  const h = ensure(m);
  if (h.state !== 'off' && h.state !== 'out') return true;
  h.planted = opts.planted != null ? !!opts.planted : h.planted;
  h.state = 'pick'; h.t = 0; h.held = 0; h.tries = 0; h.pickT = 0; h.seekT = 0;
  h.hasSpot = false; h.forced = false; h.fired = false; h.called = false; h.reason = '';
  h.hp0 = m.hp;
  h.springR = sk(m, 'springR');
  const p = clamp01(sk(m, 'patience'));
  h.holdFor = h.planted ? Infinity : lerp(HOLD_S[0], HOLD_S[1], Math.pow(p, 0.6));
  h.pulseT = rng.range(0.4, 1.6);
  if (towardX != null) { h.toldX = towardX; h.toldZ = towardZ; }
  h.towardX = towardX == null ? null : towardX; h.towardZ = towardZ == null ? null : towardZ;
  if (HIDERS.indexOf(m) < 0) HIDERS.push(m);
  return true;
}

// Give it up and hand the body back. Never mid-spring.
export function abandon(m, reason = 'bored') {
  const h = m.hide; if (!h || h.state === 'off') return false;
  silence(m, false);
  h.state = 'off'; h.t = 0; h.hasSpot = false; h.forced = false;
  m.height = STAND_H; h.crouch = 0;
  const i = HIDERS.indexOf(m); if (i >= 0) HIDERS.splice(i, 1);
  COUNT.abandons++; if (reason === 'bored') COUNT.bored++;
  if (m.orders) { m.orders.hold = false; if (m.orders.role === 'ambush') m.orders.role = 'base'; }
  if (m.setState) m.setState(reason === 'bored' ? 'patrol' : 'watch');
  return true;
}

// =====================================================================================================
// THE SPRING
// -----------------------------------------------------------------------------------------------------
// The payoff of having waited, and it is a POSITION advantage rather than an accuracy cheat: the numbers are
// exactly the ones a man who has been holding his sights on a doorway for five minutes would have. It comes
// UP first (0.35 s of standing, in the open, unable to fire) and the CALL comes after the shot, never before.
// =====================================================================================================
export function spring(m, reason = 'forced') {
  const h = ensure(m);
  if (h.state === 'rise' || h.state === 'out' || h.state === 'off') return false;
  const ctx = m.ctx, t = ctx.elapsed;
  h.reason = reason; COUNT.springs++;
  if (COUNT.reasons[reason] != null) COUNT.reasons[reason]++;
  // the tell: only inside 6 m, and only if there is somebody that close to hear it
  const bd = beliefDist(m, h);
  if (h.state !== 'tell' && bd <= TELL_R && h.muted) {
    h.state = 'tell'; h.t = 0;
    return true;
  }
  beginRise(m, h, t);
  return true;
}

function beginRise(m, h, t) {
  h.state = 'rise'; h.t = 0; h.springT = t;
  silence(m, false);
  // the prepared shot. react x ambushAim, floored, and the aim bias halved and already settled: it has been
  // holding this sight picture, so it does not have to walk its rounds onto you.
  const react = Math.max(MIN_REACT, sk(m, 'react') * sk(m, 'ambushAim'));
  m.reactT = react; m.cooldown = react;
  m.aimBiasY = (m.aimBiasY || 0) * 0.5; m.aimBiasP = (m.aimBiasP || 0) * 0.5;
  m.biasAge = (m.skill && m.skill.settle ? m.skill.settle : 1) * 1.5;
  m.aware = 1; m.engaged = true; m.spotted = true; m.hitsSince = 0;
  m.shareT = -1e9;                          // the call is ours, and it goes out AFTER the shot
  m.posture = 'open'; m.exposed = 1;
  if (m.orders) { m.orders.hold = false; m.orders.fire = true; if (m.orders.role === 'ambush') m.orders.role = 'base'; }
  if (m.squad && m.squad.enterCombat && m.squad.state === 'ambush') m.squad.enterCombat();
  if (m.setState) m.setState('engage');
}

// what the mimic currently believes the distance from its hide to the man is. Belief only: with no sighting
// this is tens of metres wrong, which is exactly why an unfed hider never springs.
function beliefDist(m, h) {
  const b = m.lastSeenPlayer; if (!b) return Infinity;
  return Math.hypot(b.x - h.x, b.z - h.z);
}
function fresh(m) {
  const ctx = m.ctx;
  return (ctx.elapsed - (m.lastVisT || -1e9)) < SIGHT_FRESH && (m.beliefR || 0) < 0.5;
}
function inChoke(m, h) {
  if (!h.hasChoke) return false;
  const b = m.lastSeenPlayer; if (!b) return false;
  return Math.hypot(b.x - h.chokeX, b.z - h.chokeZ) < 2.6;
}

// A delivered contact call. squad.js / command.js hand the picture over; it is the only information this
// module accepts from outside, and it traces back to a teammate's eyes.
export function onCall(m, x, z) {
  const h = m.hide; if (!h) return false;
  h.toldX = x; h.toldZ = z; h.toldT = m.ctx.elapsed;
  return true;
}
// A probe bouncing off the wall beside it, a round cracking past: it flinches, visibly, and does not move.
export function disturb(m, x, z, level = 1) {
  const h = m.hide; if (!h || !isHidden(m)) return false;
  const d = Math.hypot(x - h.x, z - h.z);
  if (d > 8) return false;
  h.flinch = Math.min(1, h.flinch + level * (1 - d / 8));
  return true;
}
// The squad came out of the ambush together: this man comes out with them.
export function forceSpring(m, reason = 'squad') { const h = m.hide; if (!h || h.state === 'off') return false; h.forced = true; h.reason = reason; return true; }

// =====================================================================================================
// THE TRIGGERS. All sensory, all ray-free except the one that asks "is he looking at me", which is a real
// ray from its own eyes on the perception cadence and comes out of the shared budget.
// =====================================================================================================
function lookDeg(m) { return lerp(LOOK_DEG[0], LOOK_DEG[1], clamp01(sk(m, 'patience'))); }
function checkTriggers(m, h) {
  const ctx = m.ctx, t = ctx.elapsed;
  // 1. a round in the vest. Nothing else needs to be true.
  if (m.hp < h.hp0) { h.hp0 = m.hp; return 'hit'; }
  // 2. the squad sprang, or somebody told this man to
  if (h.forced) return h.reason === 'squad' ? 'squad' : 'forced';
  if (m.squad && m.orders && m.orders.role !== 'ambush' && m.squad.state === 'combat') return 'squad';
  // 3. a delivered call, close to the ground it is guarding
  if (t - h.toldT < 2.0 && Math.hypot(h.toldX - h.x, h.toldZ - h.z) < CALL_R) return 'call';
  // 4. everything else needs a SIGHTING. A guess never springs an ambush: the whole value of the position
  //    is that it fires at a range where it cannot miss, and it cannot know that range from a noise.
  if (!fresh(m)) return null;
  const d = beliefDist(m, h);
  if (d > h.springR) return null;
  if (d <= NEAR_SPRING) return 'near';                       // he is walking into it
  if (inChoke(m, h)) return 'choke';                         // he has committed to the doorway
  if (d <= h.springR * CLOSE_FRAC) return 'close';           // close enough that facing does not matter
  // his back turned — asked from its own eyes, at most once per perception tick. If the pool refuses the
  // ray we do NOT spring: a hider that cannot check whether it has been seen keeps waiting, which is the
  // conservative failure and the one the player would want.
  if (t - h.seenT > SENSE_EVERY) {
    h.seenT = t;
    if (m.observedByPlayer && budget(ctx, 1)) { COUNT.rays++; COUNT.looks++; h.seenBy = m.observedByPlayer(lookDeg(m)); h.seenOK = true; h.seenAt = t; }
  }
  if (h.seenOK && t - (h.seenAt || -1e9) < SENSE_EVERY * 4 && !h.seenBy) return 'blind';
  return null;
}

// =====================================================================================================
// THE TICK. Returns true when this module OWNS the frame — the caller must not steer, fire, talk or skip,
// and should go straight to its animation with poseFor().
// =====================================================================================================
export function hideTick(m, dt) {
  const h = m.hide;
  if (!h || h.state === 'off') return false;
  const ctx = m.ctx, t = ctx.elapsed;
  h.t += dt;
  h.flinch = Math.max(0, h.flinch - dt * 3.2);

  // a stun (a flashbang through the doorway) freezes it where it is: the hide survives, the body does not act
  if (m.stunned > 0 && h.state !== 'rise' && h.state !== 'out') return false;

  switch (h.state) {
    // ---------------------------------------------------------------------------------------------
    case 'pick': {
      h.pickT -= dt;
      if (h.pickT > 0) { holdStill(m, h, dt); return true; }
      h.pickT = PICK_EVERY; h.tries++;
      if (pickHide(m, ctx, h.towardX, h.towardZ)) { h.state = 'seek'; h.t = 0; h.seekT = 0; }
      else if (h.tries >= PICK_TRIES) { hideInPlace(m, ctx, h); h.state = 'seek'; h.t = 0; h.seekT = 0; }
      holdStill(m, h, dt);
      return true;
    }
    // ---------------------------------------------------------------------------------------------
    // Walking there. It is NOT silent yet — a body crossing ground makes noise and pretending otherwise
    // would be the cheat. It walks, at patrol pace, and it is an ordinary target while it does.
    case 'seek': {
      h.seekT += dt;
      _seek.x = h.x; _seek.y = h.y; _seek.z = h.z;
      const rem = m.moveToward ? m.moveToward(_seek, SEEK_SPEED, dt, { stop: 0.35, face: true, turnRate: 5 }) : 0;
      if (m.followGround) m.followGround(dt);
      if (rem <= 0.5 || h.seekT > SEEK_MAX) { h.state = 'set'; h.t = 0; h.pulseT = rng.range(0.5, 1.8); }
      return true;
    }
    // ---------------------------------------------------------------------------------------------
    // Going down. The capsule shrinks with the pose, so cover in front of it really does stop rounds, and
    // the sound stops as it settles rather than snapping off.
    case 'set': {
      const k = clamp01(h.t / SET_TIME);
      h.crouch = k; m.crouch = k; m.height = lerp(STAND_H, CROUCH_H, k);
      chokeStep(ctx, h);                    // one bearing of the choke fan per frame while it goes down
      faceLane(m, h, dt, 4.5);
      if (k > 0.35 && !h.muted) silence(m, true);
      if (h.t >= SET_TIME) {
        h.state = 'hold'; h.t = 0; h.held = 0; h.hp0 = m.hp;
        m.position.y = ctx.world.groundHeight(m.position.x, m.position.z, m.position.y + 1).y;
      }
      return true;
    }
    // ---------------------------------------------------------------------------------------------
    // DOWN. This is the cheapest state in the AI and the most frightening one in the game.
    case 'hold': {
      h.held += dt;
      h.crouch = 1; m.crouch = 1; m.height = CROUCH_H;
      if (!h.muted) silence(m, true);
      m.wantLight = false;
      // perception, on its own cadence, through the entity's own senses. Awareness is pinned low before and
      // after so nothing promotes it into the ordinary engage loop behind our back.
      h.senseT += dt;
      if (h.senseT >= SENSE_EVERY) {
        const step = Math.min(h.senseT, 0.25); h.senseT = 0; COUNT.senseTicks++;
        if (m.aware > HIDE_AWARE) m.aware = HIDE_AWARE;
        if (m.perceive) m.perceive(step, { fov: 150, maxDay: 80, visGain: 1.5, hearGain: 1.2, decay: 0 });
        if (m.aware > HIDE_AWARE) m.aware = HIDE_AWARE;
        m.engaged = false;
        h.springR = sk(m, 'springR');   // the curve moves during a contact; so does the trigger distance
      }
      pulseTick(m, h, dt);
      faceLane(m, h, dt, 1.1);
      const why = checkTriggers(m, h);
      if (why) { spring(m, why); return true; }
      // patience. A planted ambush was told to wait here, so it waits here.
      if (h.held > h.holdFor) { abandon(m, 'bored'); return false; }
      return true;
    }
    // ---------------------------------------------------------------------------------------------
    // The scrape. One sound, quiet, close, and then it is coming up.
    case 'tell': {
      if (h.t <= dt * 1.001) {
        COUNT.tells++;
        const a = ctx.audio;
        const name = a && a.has && !a.has('mimic_hide') ? (a.has('mimic_step') ? 'mimic_step' : null) : 'mimic_hide';
        if (name && a && a.play) a.play(name, { pos: m.position, hrtf: true, gain: TELL_GAIN, max: TELL_MAX, rate: 0.72, ref: 2 });
      }
      pulseTick(m, h, dt);
      if (h.t >= TELL_TIME) beginRise(m, h, t);
      return true;
    }
    // ---------------------------------------------------------------------------------------------
    // Standing up: in the open, hands busy, unable to fire. The price of the position.
    case 'rise': {
      const k = clamp01(h.t / RISE_TIME);
      h.crouch = 1 - k; m.crouch = 1 - k; m.height = lerp(CROUCH_H, STAND_H, k);
      faceLane(m, h, dt, 7);
      if (h.t >= RISE_TIME) { h.state = 'out'; h.t = 0; m.crouch = 0; m.height = STAND_H; const i = HIDERS.indexOf(m); if (i >= 0) HIDERS.splice(i, 1); }
      return true;
    }
    // ---------------------------------------------------------------------------------------------
    // Out. The body belongs to the ordinary engage loop again; all this still owns is the call, which goes
    // out a quarter of a second after the FIRST ROUND and not one moment before it.
    case 'out': {
      if (!h.called) {
        if (!h.fired && (m.lastFireT || -1e9) > h.springT) { h.fired = true; h.callAt = t + CALL_AFTER; }
        if (h.fired && t >= h.callAt) { h.called = true; say(m, 'contact', 1.05); }
        else if (t - h.springT > 4.5) { h.called = true; say(m, 'contact', 1.0); }   // it never got a shot off
      }
      if (t - h.springT > 6) h.state = 'off';
      return false;
    }
  }
  return false;
}

// It does not move a muscle while it is thinking about where to go, either.
function holdStill(m, h, dt) { if (m.followGround) m.followGround(dt); }

// The body is trained on the lane, not on you. This is tell #3: a silhouette that is looking at the doorway.
function faceLane(m, h, dt, rate) {
  const tx = h.hasSpot ? h.aimX : m.position.x + h.laneX * NEAR_PROBE;
  const tz = h.hasSpot ? h.aimZ : m.position.z + h.laneZ * NEAR_PROBE;
  if (m.faceToward) m.faceToward(tx, tz, dt, rate);
}

// THE PULSE. Tell #1, and the only one designed to be found rather than suffered. Silent by construction:
// it is a uniform, not a sound. Slower on a better hider, so the discovery difficulty rides the same curve
// as everything else — a recruit's hide blinks at you twice as often as an elite's.
function pulseTick(m, h, dt) {
  if (h.pulseHold > 0) { h.pulseHold -= dt; h.pulse = Math.sin(clamp01(1 - h.pulseHold / PULSE_TIME) * Math.PI); if (h.pulseHold <= 0) h.pulse = 0; return; }
  h.pulse = 0;
  h.pulseT -= dt;
  if (h.pulseT <= 0) {
    const per = lerp(PULSE_PERIOD[0], PULSE_PERIOD[1], clamp01(sk(m, 'patience')));
    h.pulseT = per * (0.85 + rng() * 0.30);
    h.pulseHold = PULSE_TIME;
  }
}

// =====================================================================================================
// WHAT THE RENDERER AND THE ANIMATOR NEED
// =====================================================================================================
// The pose to hand mimic.js's animate(). Stillness is the point: speed 0, no head tracking, no aim pose
// (a rifle that swings onto the player through a wall is not an ambush, it is a turret with a story).
export function poseFor(m, out) {
  const o = out || _pose;
  const h = m.hide;
  o.headYaw = 0; o.headPitch = 0; o.aim = 0; o.aimYaw = 0; o.aimPitch = 0; o.speed = 0; o.crouch = 1;
  if (!h) return o;
  o.crouch = h.state === 'seek' || h.state === 'pick' ? 0 : h.crouch;
  o.speed = h.state === 'seek' ? SEEK_SPEED : 0;
  // a whisper of drift so it is not a frozen statue, far under anything that reads as motion at 20 m
  if (h.state === 'hold') o.headYaw = Math.sin(m.ctx.elapsed * 0.11 + (m.beliefSeed || 0) * 6.283) * 0.05;
  return o;
}
// The visual half of the silence, applied AFTER animate() has written its own values. A no-op for anything
// that is not currently down, which is 99% of the mimics in the world.
export function visualFor(m, out) {
  const o = out || _vis;
  const h = m.hide;
  o.pulse = 0; o.shiver = 1; o.fade = 1; o.glow = 2.4;
  if (!h || !isHidden(m)) return o;
  const p = h.pulse;
  o.pulse = p;
  o.shiver = HIDE_SHIVER + h.flinch * 2.4;
  o.fade = lerp(HIDE_FADE, PULSE_FADE, p);
  const night = m.ctx.time ? m.ctx.time.night : 0;
  o.glow = lerp(1.35, 3.4, p) + night * 0.55;
  return o;
}
export function applyVisual(m) {
  const h = m.hide;
  if (!h || !isHidden(m)) return false;
  const v = visualFor(m, _vis);
  if (m.faceU) { if (m.faceU.uFade) m.faceU.uFade.value = v.fade; if (m.faceU.uGlow) m.faceU.uGlow.value = v.glow; }
  if (m.matU && m.matU.uShiver) m.matU.uShiver.value = v.shiver;
  return true;
}
// Where its weapon is pointing, for anything that wants to draw or test it.
export function aimPoint(m, out) { const h = m.hide; if (!h || !h.hasSpot) return null; out.x = h.aimX; out.y = h.y + 1.2; out.z = h.aimZ; return out; }
// A one-line summary for scenarios and the population census.
export function describe(m) {
  const h = m.hide; if (!h) return null;
  return {
    state: h.state, held: +h.held.toFixed(1), holdFor: h.holdFor === Infinity ? 'inf' : +h.holdFor.toFixed(0),
    quality: +h.quality.toFixed(2), kind: h.kind, roofed: h.roofed, choke: h.hasChoke,
    lane: h.laneSrc, springR: +h.springR.toFixed(1), muted: h.muted, reason: h.reason,
    x: +h.x.toFixed(1), z: +h.z.toFixed(1),
  };
}
