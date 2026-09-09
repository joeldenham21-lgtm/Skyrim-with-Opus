// RADIUS — command.js. The squad as one mind.
//
// squad.js is the body: fifteen solvers that know how to pick cover, walk an arc, cross a lane, fall back into
// a building. This file is the head. It holds ONE picture of where the Explorer is, ONE opinion about how he
// fights, ONE named plan at a time, and ONE mouth. Everything the squad does that the player could react to
// leaves this file as a word on a handset first and as movement a beat later, and that beat is the window.
//
// ---------------------------------------------------------------------------------------------------------
// THE FIVE THINGS IN HERE
//
//   THE PICTURE (§picture). Not "where the player is" — where the squad BELIEVES he is, how wide that guess is,
//   how old it is, whether anybody currently has eyes on it, which way they last saw him pointing, whether they
//   have hurt him, and what he is standing behind. It is written by exactly one function, write(), and every
//   plan in this file reads that and nothing else. There is no line in this file that touches ctx.player or
//   ctx.camera; grep for it, the test does.
//
//   THE LEDGER AND THE TIER (§ledger). Men, guns, rounds, grenades, organisation, morale, radio net. Folded
//   into a command tier: C3 a squad that can do anything, C2 one moving element, C1 single-seat plays only,
//   C0 nothing at all — the ten seconds after you kill the man giving the orders.
//
//   THE PLAYS (§plays). Nine named plans, scored once every plan tick, and then HELD. Commitment is what buys
//   multi-second coherence: a squad that re-decides every frame reads as four men strafing, and a squad that
//   picks ANGLE and walks it for three seconds reads as a squad. A green leader commits because he cannot
//   re-evaluate; an elite commits because he decided to, and bails the instant his abort fires. Same code.
//
//   THE READ (§read). Five habits, learned inside one contact, from the player's own repeated behaviour: which
//   shoulder he peeks from, how many rounds he fires at a time, whether he camps or rotates, whether he walks
//   or sprints, and which way he leaves. Four consumption points, no more. A confirmation is worth a fifth of
//   the confidence; a contradiction HALVES it. That asymmetry is the counter-play: change what you do once and
//   they are wrong about you, twice and they have forgotten.
//
//   THE WORDS (§words). Nineteen of them, each with a fixed syllable count, fixed durations, a fixed pitch
//   contour and a fixed squelch, so they are learnable. Ten are status words anybody says. Nine are COMMANDS,
//   and only the leader says those, on a handset with a different carrier — a lower band, a 60 Hz mains hum,
//   two pre-key clicks. Two transmissions and you can pick him out of a treeline by ear. Kill him and the
//   command words stop; the status words do not, and their absence is the loudest thing in the fight.
//
// ---------------------------------------------------------------------------------------------------------
// WHAT AN ORDER COSTS. Nothing here is telepathy and nothing here is instant.
//   * the leader keys the handset and speaks:      KEY_TIME  0.85 s green -> 0.35 s elite
//   * the word reaches a man at 170 m or not at all, later the farther he is
//   * he decides to act on it at all:              SKILL.answer, 0.55 -> 0.98
//   * he acts:                                     ACT_DELAY 0.75 s -> 0.22 s
//   * a manoeuvre seat is CALLED before it MOVES:  LEAD 0.6 s
// Between `angle` and the man stepping off is roughly a second and a half at the low end. That is the player's
// window and it is the whole reason the words exist.
//
// IMPORTS. Only three, core/math and core/rng — this file must stay importable by squad.js without a cycle,
// and bundlable on its own for tools/scenarios/ai2-command-*.mjs. It never imports mimic.js or squad.js.
// The world, the ray budget and the squad's own solvers all arrive as arguments.
import * as THREE from 'three';
import { clamp, clamp01, lerp, angleDelta, DEG, TAU } from '../core/math.js';
import { mulberry32 } from '../core/rng.js';

// ---- module scratch. Nothing in this file allocates in a per-frame or per-tick path. ----
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3(), _hit = new THREE.Vector3();

// =====================================================================================================
// §skill — this module's rows of the one difficulty table. mimic.js merges them into SKILL before it derives
// SKILL_KEYS, so a mimic reads them off m.skill.<row> exactly like react or spread. No number in this file
// hard-codes a difficulty that is not in here.
// =====================================================================================================
export const SKILL_ROWS = {
  angle:    [0.05, 0.95],   // the occluder solve — the tree fix. The ANGLE play needs >= 0.35
  read:     [0.00, 0.90],   // uses the squad read at >= 0.25; the zone read at >= 0.60
  cut:      [0.00, 0.60],   // the CUT play needs >= 0.30
  feint:    [0.00, 0.70],   // PROBE needs >= 0.25; BAIT needs >= 0.45
  seatDisc: [0.20, 0.98],   // how faithfully a man holds the seat he was given
  answer:   [0.55, 0.98],   // chance he acts on a delivered call at all
  menuN:    [3, 9],         // how many plays the mind may consider          (read off the LEADER)
  commitT:  [1.6, 3.2],     // s a play is held unconditionally              (read off the LEADER)
  abortChk: [0.15, 1.00],   // chance it checks its own abort conditions     (read off the LEADER)
  noiseGap: [6.0, 3.0],     // s between two command words                   (read off the LEADER)
};

// ---- the cost of talking, and the reach of a handset ----
export const RADIO_R = 170;              // m a handset reaches. Past it a man is on his own.
export const KEY_TIME = [0.85, 0.35];    // s to key up and speak, at skill 0..1
export const ACT_DELAY = [0.75, 0.22];   // s between a call landing and the man doing anything about it
export const LEAD = 0.6;                 // s a manoeuvre seat is announced before its man steps off
export const MIN_GAP = 0.55;             // s between ANY two transmissions from one squad
export const ANGLE_STEP = 55 * DEG;      // the arc a man walks per waypoint around a thin occluder
export const OCC_LIFE = 6;               // s an occluder solve is cached
export const PLAN_HZ = [3, 5];           // plan ticks per second at skill 0..1 (squad.js owns the clock)

// =====================================================================================================
// §words — THE VOCABULARY.
//
// voices.js (another workflow) renders these. The contract is that audio.play('mimic_radio', { word, carrier,
// voice }) is DETERMINISTIC per word: fixed syllable count, fixed per-syllable durations, fixed gaps, fixed
// pitch contour, fixed squelch. Only the formant centres (+-5%), the glottal f0 (+-3%, keyed off `voice`) and
// the gain (+-5%) may move, so it is a different man saying the same word rather than a different word.
//
// Until that lands, `rate` below reproduces today's behaviour and the words are merely different-ish; the
// module does not care, and audio.play no-ops on a name it does not know.
//
//   register 'status'  — anybody says it. What the squad is doing to itself.
//   register 'command' — ONLY the leader says it, on the command carrier. What the squad is about to do to you.
// =====================================================================================================
export const WORDS = {
  // ---- status: anybody ----
  contact:  { reg: 'status', syl: 2, dur: [0.09, 0.07], gap: [0.045], pitch: 'rise',  f0: 128, squelch: 'hard-tail', gain: 0.95, max: 110, hold: 1.5, rate: 1.12 },
  update:   { reg: 'status', syl: 3, dur: [0.10, 0.10, 0.10], gap: [0.05, 0.05], pitch: 'flat', f0: 118, squelch: 'soft-tail', gain: 0.75, max: 95, hold: 2.5, rate: 0.98 },
  heard:    { reg: 'status', syl: 1, dur: [0.13], gap: [], pitch: 'fall', f0: 108, squelch: 'long-tail', gain: 0.62, max: 85, hold: 3.0, rate: 0.86 },
  moving:   { reg: 'status', syl: 2, dur: [0.08, 0.12], gap: [0.04], pitch: 'fall', f0: 124, squelch: 'double', gain: 0.85, max: 100, hold: 4.0, rate: 1.22 },
  set:      { reg: 'status', syl: 1, dur: [0.06], gap: [], pitch: 'flat', f0: 132, squelch: 'clip', gain: 0.70, max: 90, hold: 4.0, rate: 1.04 },
  covering: { reg: 'status', syl: 2, dur: [0.12, 0.12], gap: [0.06], pitch: 'flat', f0: 100, squelch: 'soft-tail', gain: 0.70, max: 90, hold: 5.0, rate: 0.90 },
  changing: { reg: 'status', syl: 2, dur: [0.07, 0.09], gap: [0.04], pitch: 'rise', f0: 126, squelch: 'clip', gain: 0.72, max: 85, hold: 3.0, rate: 1.18 },
  down:     { reg: 'status', syl: 3, dur: [0.11, 0.11, 0.16], gap: [0.05, 0.06], pitch: 'fall', f0: 96, squelch: 'soft-tail', gain: 1.00, max: 125, hold: 0, rate: 1.28 },
  body:     { reg: 'status', syl: 2, dur: [0.14, 0.16], gap: [0.09], pitch: 'fall', f0: 100, squelch: 'none', gain: 0.68, max: 90, hold: 8.0, rate: 0.82 },
  // ---- commands: the leader only, on the command carrier ----
  hold:     { reg: 'command', syl: 1, dur: [0.22], gap: [], pitch: 'flat', f0: 92, squelch: 'soft-tail', gain: 0.55, max: 80, hold: 4.0, rate: 0.94 },
  angle:    { reg: 'command', syl: 2, dur: [0.07, 0.07], gap: [0.035], pitch: 'rise', f0: 140, squelch: 'double', gain: 0.90, max: 105, hold: 5.0, rate: 1.30 },
  probe:    { reg: 'command', syl: 2, dur: [0.09, 0.13], gap: [0.05], pitch: 'rise', f0: 120, squelch: 'soft-tail', gain: 0.80, max: 95, hold: 8.0, rate: 1.06 },
  flanking: { reg: 'command', syl: 3, dur: [0.08, 0.08, 0.10], gap: [0.04, 0.04], pitch: 'rise2', f0: 130, squelch: 'soft-tail', gain: 0.92, max: 105, hold: 8.0, rate: 1.34 },
  pin:      { reg: 'command', syl: 1, dur: [0.08], gap: [], pitch: 'fall', f0: 112, squelch: 'clip', gain: 0.88, max: 100, hold: 7.0, rate: 1.16 },
  push:     { reg: 'command', syl: 2, dur: [0.06, 0.06], gap: [0.03], pitch: 'flat', f0: 145, squelch: 'clip', gain: 0.95, max: 110, hold: 6.0, rate: 1.42 },
  flush:    { reg: 'command', syl: 2, dur: [0.10, 0.08], gap: [0.04], pitch: 'fall', f0: 150, squelch: 'hard-tail', gain: 0.92, max: 110, hold: 6.0, rate: 1.44 },
  grenade:  { reg: 'command', syl: 1, dur: [0.16], gap: [], pitch: 'fall', f0: 155, squelch: 'none', distort: 2.2, gain: 1.00, max: 130, hold: 0, rate: 1.48 },
  falling:  { reg: 'command', syl: 4, dur: [0.06, 0.06, 0.06, 0.09], gap: [0.03, 0.03, 0.03], pitch: 'fall', f0: 136, squelch: 'clip', gain: 1.00, max: 125, hold: 0, rate: 1.38 },
  regroup:  { reg: 'command', syl: 3, dur: [0.10, 0.10, 0.12], gap: [0.05, 0.05], pitch: 'fall3', f0: 110, squelch: 'soft-tail', gain: 0.90, max: 105, hold: 6.0, rate: 1.24 },
};
// squad.js's old table, kept as the same object shape so nothing that imported CALLS breaks.
export const CALLS = {};
for (const k in WORDS) { const w = WORDS[k]; CALLS[k] = { rate: w.rate, gain: w.gain, max: w.max, gap: w.hold, reg: w.reg }; }
export const COMMAND_WORDS = Object.keys(WORDS).filter((k) => WORDS[k].reg === 'command');
export const STATUS_WORDS = Object.keys(WORDS).filter((k) => WORDS[k].reg === 'status');

// =====================================================================================================
// §plays — THE MENU. Nine plans plus the real withdrawal. One at a time, ever.
//
//   tier  the command tier this needs (C3 = 3 whole squad, C2 = 2 one moving element, C1 = 1 single seat)
//   min   men alive
//   esc   director.escalation gate — COMPOSITION. What the zone is willing to do at all.
//   base  [at skill 0, at skill 1] — PREFERENCE. At 0 a squad has three ideas and picks the dull one.
// =====================================================================================================
export const PLAYS = [
  { id: 'HOLD',     tier: 1, min: 1, esc: 0, word: 'hold',     base: [1.60, 0.55] },
  { id: 'ANGLE',    tier: 1, min: 1, esc: 0, word: 'angle',    base: [0.10, 1.10] },
  { id: 'HUNT',     tier: 1, min: 1, esc: 0, word: null,       base: [0.20, 0.70] },
  { id: 'WITHDRAW', tier: 1, min: 1, esc: 0, word: 'falling',  base: [0.30, 0.40] },
  { id: 'PROBE',    tier: 2, min: 2, esc: 1, word: 'probe',    base: [0.00, 0.70] },
  { id: 'FLANK',    tier: 2, min: 3, esc: 1, word: 'flanking', base: [0.15, 1.00] },
  { id: 'PIN',      tier: 2, min: 2, esc: 2, word: 'pin',      base: [0.00, 0.95] },
  { id: 'PUSH',     tier: 2, min: 2, esc: 2, word: 'push',     base: [0.00, 0.85] },
  { id: 'CUT',      tier: 2, min: 2, esc: 2, word: 'moving',   base: [0.00, 0.80] },
  { id: 'BAIT',     tier: 3, min: 3, esc: 3, word: 'falling',  base: [0.00, 0.75] },
];
const PLAY_BY_ID = {}; for (const p of PLAYS) PLAY_BY_ID[p.id] = p;
// which seats are a MANOEUVRE — at most one of these may be assigned at a time, across the whole squad
const MOVER = { ANGLE: 1, HAMMER: 1, CUT: 1, PROBE: 1 };

// =====================================================================================================
// §zoneRead — the one thing that survives a contact, and only two habits of it.
// "They arrive already holding a file on you." Decays 40% when you sleep, 25% on a Tide, cleared on a new game.
// The counter-play is diegetic: go home and sleep.
// =====================================================================================================
export const zoneRead = {
  peek: { v: 0, c: 0, n: 0 },
  mag: { v: 0, c: 0, n: 0 },
  merge(read, w) {
    for (const k of ['peek', 'mag']) {
      const a = this[k], b = read[k];
      if (a.c <= 0.02) continue;
      const wt = w * a.c;
      b.v = b.v * (1 - wt) + a.v * wt; b.c = Math.max(b.c, a.c * w);
    }
  },
  learn(read) {
    for (const k of ['peek', 'mag']) {
      const a = this[k], b = read[k];
      if (b.c <= 0.05) continue;
      const wt = 0.35 * b.c;
      a.v = a.v * (1 - wt) + b.v * wt; a.c = clamp01(a.c + (b.c - a.c) * 0.35); a.n++;
    }
  },
  decay(f) { this.peek.c *= 1 - f; this.mag.c *= 1 - f; },
  clear() { this.peek.v = 0; this.peek.c = 0; this.peek.n = 0; this.mag.v = 0; this.mag.c = 0; this.mag.n = 0; },
};
export function resetZoneRead() { zoneRead.clear(); }

// =====================================================================================================
// §mark — THE LEADER, VISIBLE.
// A 1.05 m tapered whip antenna off the back of the chest and a pair of rank bars on the shoulder. Primitives
// only, no assets. Worn when classRank >= 3 and escalation >= 1, so he is an occasional presence rather than a
// fixture; through the shiver material the whip reads at 60 m as a silhouette that is wrong for a man.
// The whip lags the body: userData.tick(dt, speed, turn) springs it, so he waves it about when he runs.
// =====================================================================================================
let _whipGeo = null, _tipGeo = null, _barGeo = null;
export function buildLeaderMark(T = THREE, material = null, metal = null) {
  if (!_whipGeo) {
    _whipGeo = new T.CylinderGeometry(0.004, 0.013, 1.05, 5, 1, true); _whipGeo.translate(0, 0.525, 0); _whipGeo.userData.shared = true;
    _tipGeo = new T.SphereGeometry(0.016, 5, 4); _tipGeo.userData.shared = true;
    _barGeo = new T.BoxGeometry(0.085, 0.012, 0.022); _barGeo.userData.shared = true;
  }
  const mat = metal || material || new T.MeshStandardMaterial({ color: 0x14150f, roughness: 0.55, metalness: 0.5 });
  const g = new T.Group();
  const pivot = new T.Group();
  pivot.position.set(-0.10, 0.18, -0.13);            // off the radio on his back, canted outboard
  pivot.rotation.set(-0.22, 0, -0.14);
  const whip = new T.Mesh(_whipGeo, mat); whip.castShadow = true; whip.frustumCulled = false;
  const tip = new T.Mesh(_tipGeo, mat); tip.position.y = 1.05; tip.castShadow = false;
  pivot.add(whip); pivot.add(tip); g.add(pivot);
  // two rank bars on the right shoulder — small, but they catch the rim light and they are not on anybody else
  for (let i = 0; i < 2; i++) {
    const b = new T.Mesh(_barGeo, material || mat);
    b.position.set(0.155, 0.20 - i * 0.022, -0.01); b.rotation.z = -0.18; b.castShadow = false;
    g.add(b);
  }
  g.userData.pivot = pivot;
  g.userData.sx = 0; g.userData.sz = 0; g.userData.vx = 0; g.userData.vz = 0;
  g.userData.rest = { x: -0.22, z: -0.14 };
  // a lag spring, driven by the integrator from the chest bone. Cheap: four floats, no allocation.
  g.userData.tick = (dt, speed = 0, turn = 0) => {
    const u = g.userData, k = 46, damp = 8.5;
    const drive = clamp(speed * 0.055 + Math.abs(turn) * 0.25, 0, 0.55);
    u.vx += (-u.sx * k - u.vx * damp) * dt + (Math.sin(u.t = (u.t || 0) + dt * (5 + speed)) * drive) * dt * 9;
    u.vz += (-u.sz * k - u.vz * damp) * dt + (turn * 0.9) * dt * 9;
    u.sx = clamp(u.sx + u.vx * dt, -0.5, 0.5); u.sz = clamp(u.sz + u.vz * dt, -0.5, 0.5);
    pivot.rotation.x = u.rest.x + u.sx; pivot.rotation.z = u.rest.z + u.sz;
  };
  return g;
}

// ---- small helpers ----
const CLASS_RANK = { recruit: 0, regular: 1, shotgunner: 2, gunner: 2, veteran: 3, sniper: 3, elite: 4 };
function rankOf(m) { return m && m.rank != null ? m.rank : (CLASS_RANK[m && m.cls] ?? 1); }
function skillOf(m, key, fallback) { const s = m && m.skill; const v = s ? s[key] : undefined; return v == null ? fallback : v; }
function alive(m) { return !!(m && m.alive); }
function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
// a body that is mid-vault, mid-dive or reloading cannot be given a job this instant
function committed(m) { return !!(m && ((m.body && (m.body.verb || m.body.airborne)) || m.state === 'reload' || m.stunned > 0)); }

// =====================================================================================================
// createCommand(ctx, deps)
//   deps.losBudget(ctx, want) -> bool     the shared per-frame ray pool. traversal.js owns it; the integrator
//                                         passes it in so this file need not import traversal.js. Without it a
//                                         private pool of the same size is used, which is correct but not shared.
//   deps.reach(m, x, z) -> metres|Infinity  traversal.reach, for seat fitness. Falls back to XZ distance.
//   deps.pickHide(m, ctx, x, z) -> bool     ambush.pickHide, for the BAIT play's STAY seat.
// =====================================================================================================
export function createCommand(ctx, deps = {}) {
  const rng = (ctx.rng && ctx.rng.fork) ? ctx.rng.fork(71) : (() => { const r = mulberry32(0x51ce); r.range = (a, b) => a + r() * (b - a); r.chance = (p) => r() < p; return r; })();
  const rnd = () => rng();
  const range = (a, b) => (rng.range ? rng.range(a, b) : a + rng() * (b - a));
  const chance = (p) => (rng.chance ? rng.chance(p) : rng() < p);

  // the ray pool. Shared with traversal.js when the integrator passes it; a private one of the same size if not.
  const PRIVATE = { frame: -1, left: 0, cap: 10 };
  const budget = deps.losBudget || ((c, want) => {
    if (c.frame !== PRIVATE.frame) { PRIVATE.frame = c.frame; PRIVATE.left = PRIVATE.cap; }
    if (PRIVATE.left < want) return false;
    PRIVATE.left -= want; return true;
  });
  const reachOf = deps.reach || ((m, x, z) => dist2d(m.position.x, m.position.z, x, z));
  const stats = { says: 0, commands: 0, orders: 0, delivered: 0, refused: 0, plays: {}, angleSolves: 0, angleFound: 0, rays: 0, seatChanges: 0, promotions: 0, aborts: 0 };
  for (const p of PLAYS) stats.plays[p.id] = 0;

  // ---------------------------------------------------------------------------------------------------
  // §picture — the mind's only sense organ.
  // ---------------------------------------------------------------------------------------------------
  function makePicture() {
    return {
      pos: new THREE.Vector3(), r: 0, t: -1e9, kind: 'none',
      prev: new THREE.Vector3(), prevT: -1e9, has: false,
      vel: new THREE.Vector3(), velT: -1e9,
      stillT: 0,
      facing: 0, facingT: -1e9,
      hurt: 0, hurtT: -1e9,
      occluder: null, occT: -1e9, occX: 0, occZ: 0, occY: 0, occR: 0, occKind: '',
      seers: 0, seerT: -1e9,
      exits: new Float32Array(8), exitN: 0, exitT: -1e9,
      lastSeenT: -1e9,
    };
  }

  // ---------------------------------------------------------------------------------------------------
  // §read — five habits. EWMA with an asymmetric confidence: four confirmations to become actionable,
  // one contradiction to halve it. That pair of constants is the counter-play.
  // ---------------------------------------------------------------------------------------------------
  const READ_TAU = 8, CONF_UP = 0.22, CONF_DOWN = 0.45, CONF_IDLE = 1 / 240;
  function makeRead() {
    return {
      peek: { v: 0, c: 0, n: 0 }, mag: { v: 0, c: 0, n: 0 }, hold: { v: 0, c: 0, n: 0 }, pace: { v: 0, c: 0, n: 0 },
      egress: new Float32Array(8), egressN: 0,
      trainN: 0, trainT: -1e9,
    };
  }
  // one observation of one habit. `tol` is what counts as agreeing with what we already thought.
  function feed(h, obs, dt, tol, conf = 1) {
    const a = (1 - Math.exp(-dt / READ_TAU)) * clamp01(conf);
    if (h.n > 0) {
      if (Math.abs(obs - h.v) <= tol) h.c = h.c + (1 - h.c) * CONF_UP * clamp01(conf);
      else h.c *= CONF_DOWN;
    }
    h.v = h.n === 0 ? obs : h.v + (obs - h.v) * Math.max(a, 0.18);
    h.n++;
    h.c = clamp01(h.c);
  }
  function idle(h, dt) { h.c = Math.max(0, h.c - dt * CONF_IDLE); }

  // ---------------------------------------------------------------------------------------------------
  // §seats — a fixed pool. A seat is a JOB plus the man in it plus the clock that says when he may act on it.
  // ---------------------------------------------------------------------------------------------------
  const SEAT_MAX = 8;
  function makeSeat() {
    return {
      kind: '', solver: '', word: null, want: 'any', critical: 0, active: false,
      man: null, sinceT: -1e9, armAt: 0, said: false, arc: 0, side: 1,
      x: 0, z: 0, has: false, wp: new Float32Array(9), wpN: 0, wpI: 0, note: '',
    };
  }

  // =================================================================================================
  // makeMind(squad, solvers)
  // `solvers` is squad.js's own facade — every one of these already exists there and is kept verbatim:
  //   bestCover walkable anomalyAt anomalyOnLine highGround orderHold orderAdvance orderFlank
  //   orderOverwatch orderShaken orderSweep spreadOnto coverBound beginRegroup beginBreakoff plant
  //   throwGrenade members centroid alive skill org leader
  // Anything missing simply degrades: the mind picks a play whose seats it can actually solve.
  // =================================================================================================
  function makeMind(squad, solvers = {}) {
    const picture = makePicture();
    const read = makeRead();
    const seats = []; for (let i = 0; i < SEAT_MAX; i++) seats.push(makeSeat());
    const pending = [];                 // orders in flight: { m, word, at, seat, level }
    const ledger = {
      n: 0, initial: 0, hurt: 0, rounds: 0, dry: 0, grenades: 0, smokes: 0,
      anvil: 0, close: 0, long: 0, org: 1, morale: 1, shaken: 0, net: 1, command: 1, seersNow: 0,
    };
    const said = {};                    // word -> t
    let lastSayT = -1e9, lastCmdT = -1e9, lastLineT = -1e9;
    let play = null, playT = 0, playSince = -1e9, playScore = 0, prevPlay = null;
    let seatN = 0, solveCursor = 0, lastTickT = -1e9, wantReplan = false;
    let handoverAt = -1e9, handoverDone = true, carrier = 'field';
    let sideCache = 0, sideT = -1e9;
    let mergedZone = false;
    let ledgerCX = 0, ledgerCZ = 0;      // the base of fire's centroid: the axis the peek habit is measured on
    const interrupt = { kind: '', x: 0, z: 0, from: null, t: -1e9, live: false };
    const MENU_P = new Array(PLAYS.length).fill(null), MENU_B = new Float64Array(PLAYS.length);

    const mind = {
      squad, picture, read, seats, ledger, stats,
      get play() { return play; },
      get playAge() { return ctx.elapsed - playSince; },
      get tier() { return ledger.command; },
      get wantsReplan() { return wantReplan; },
      get carrier() { return carrier; },
    };

    // -----------------------------------------------------------------------------------------------
    // §picture.write — THE ONLY WRITER. Everything the squad believes enters here and nowhere else.
    //   kind: 'seen' (a man has eyes on it) | 'told' (a call) | 'heard' (a noise) | 'inferred'
    // -----------------------------------------------------------------------------------------------
    function write(pos, t, r = 0, kind = 'told', from = null) {
      if (!pos) return false;
      if (t < picture.t - 0.001) return false;
      const seen = kind === 'seen';
      const moved = picture.has ? dist2d(pos.x, pos.z, picture.pos.x, picture.pos.z) : 0;

      // ---- velocity. ONLY from two sightings less than 1.2 s apart, and zeroed the instant the guess is wide.
      // A mimic may cut off a man it is watching run. It may never cut off a man it heard.
      if (seen && r <= 0.05 && picture.kind === 'seen' && picture.r <= 0.05 && t - picture.t < 1.2 && t - picture.t > 0.02) {
        const idt = t - picture.t;
        picture.vel.set((pos.x - picture.pos.x) / idt, 0, (pos.z - picture.pos.z) / idt);
        if (picture.vel.lengthSq() > 144) picture.vel.setLength(12);
        picture.velT = t;
        // ---- pace: does he walk or does he sprint? implied speed between two sightings
        const sp = Math.hypot(picture.vel.x, picture.vel.z);
        feed(read.pace, clamp01((sp - 2.6) / 3.4), idt, 0.28, 0.9);
      }
      if (r > 0.05) { picture.vel.set(0, 0, 0); picture.velT = -1e9; }

      // ---- hold: does he camp or does he rotate? net radial drift between consecutive writes
      if (picture.has && t - picture.t > 0.2 && t - picture.t < 6) {
        feed(read.hold, clamp01(1 - moved / 6), t - picture.t, 0.3, seen ? 0.9 : 0.4);
      }
      // ---- egress: the bearing he leaves on, binned into eight
      if (picture.has && moved > 3 && picture.seers === 0) {
        const a = Math.atan2(pos.z - picture.pos.z, pos.x - picture.pos.x);
        const bin = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
        read.egress[bin] += seen ? 1 : 0.4; read.egressN++;
      }
      // ---- peek: which side of the occluder axis his firing positions sit on
      if (seen && picture.occluder && t - picture.occT < OCC_LIFE) {
        const bx = picture.occX - pos.x, bz = picture.occZ - pos.z;
        const l = Math.hypot(bx, bz);
        if (l > 0.3 && l < 30) {
          // signed lateral offset of the sighting from the line base-of-fire -> occluder
          const cx = picture.occX - ledgerCX, cz = picture.occZ - ledgerCZ;
          const cl = Math.hypot(cx, cz) || 1;
          const s = ((pos.x - picture.occX) * (cz / cl) - (pos.z - picture.occZ) * (cx / cl));
          feed(read.peek, clamp(s / 3, -1, 1), 1.2, 0.55, 0.85);
        }
      }

      if (picture.has) { picture.prev.copy(picture.pos); picture.prevT = picture.t; }
      if (moved > 2.5 || !picture.has) picture.stillT = 0;
      picture.pos.copy(pos); picture.t = t; picture.r = Math.max(0, r); picture.kind = kind; picture.has = true;
      if (seen) picture.lastSeenT = t;
      if (moved > 4) { picture.occluder = null; picture.occT = -1e9; }
      return true;
    }

    // -----------------------------------------------------------------------------------------------
    // §picture.frustum — the belief cone. Not "is this in the player's view" (that would be a camera read):
    // "does the squad have any reason to think he can see this". A squad that watched you turn routes its
    // flank behind your back. A squad that only heard a shot assumes you can see everywhere, and takes the
    // long way or does not flank at all. It gets WORSE when it deserves to be. That is the point.
    // -----------------------------------------------------------------------------------------------
    function frustum(x, z, halfDeg = 50) {
      if (!picture.has) return true;                                     // no idea: assume he sees you
      const age = clamp01((ctx.elapsed - picture.facingT) / 3.5);
      const half = lerp(halfDeg, 180, age);
      if (half >= 179) return true;
      const dx = x - picture.pos.x, dz = z - picture.pos.z;
      const d = Math.hypot(dx, dz); if (d < 0.5) return true;
      const a = Math.atan2(dz, dx);
      return Math.abs(angleDelta(picture.facing, a)) <= half * DEG;
    }

    // -----------------------------------------------------------------------------------------------
    // §observe — everything the outside world hands the mind. All of it traces back to a sense.
    // -----------------------------------------------------------------------------------------------
    function observe(kind, data) {
      const t = ctx.elapsed;
      switch (kind) {
        case 'hit':        // one of ours put a round into him — provenance-perfect: they push a man THEY hit
          picture.hurt = clamp01(picture.hurt + (typeof data === 'number' ? data : (data && data.amount) || 0) * 0.012);
          picture.hurtT = t; break;
        case 'cry':        // they heard him take it
          picture.hurt = Math.max(picture.hurt, 0.5); picture.hurtT = t; break;
        case 'face':       // a man with a line can see which way he is pointing
          picture.facing = typeof data === 'number' ? data : (data && data.a) || 0; picture.facingT = t; break;
        case 'shot': {     // a round heard. Gated on audibility AT CONSUMPTION, so a suppressor teaches nothing.
          const d = data || {};
          const reach = 55 * clamp01(d.noise == null ? 1 : d.noise);
          if (dist2d(ledgerCX, ledgerCZ, d.x || 0, d.z || 0) > reach) return;
          if (t - read.trainT > 0.9 && read.trainN > 0) { feed(read.mag, read.trainN, 1.4, 1.1, 0.9); read.trainN = 0; }
          read.trainN++; read.trainT = t;
          break;
        }
        case 'body':       // a corpse found. The picture collapses toward where it happened, not toward him.
          if (data) write(_v.set(data.x, data.y || 0, data.z), t, 9, 'inferred', null);
          break;
        case 'occluder':   // senses/kit noticed what he went behind, without a ray of ours
          if (data) { picture.occX = data.x; picture.occZ = data.z; picture.occY = data.y || 0; picture.occR = data.r || 1; picture.occKind = data.kind || 'thin'; picture.occluder = data.collider || true; picture.occT = t; }
          break;
        default: break;
      }
    }

    // -----------------------------------------------------------------------------------------------
    // §say — THE MOUTH. One squad, one voice at a time.
    //   * a command word only ever leaves the leader's handset, and on a carrier of its own
    //   * per-word hold, a squad-wide floor between any two transmissions, and a leader's noiseGap between
    //     two COMMANDS — the noise budget is horror design, not decoration
    //   * the player hears it positionally from the speaker, which is how you learn where the leader is
    // -----------------------------------------------------------------------------------------------
    function speaker(word, from) {
      const w = WORDS[word];
      if (w && w.reg === 'command') {
        const l = solvers.leader ? solvers.leader() : squad.leader;
        return alive(l) && !l.stalker ? l : null;                 // no leader, no commands. That is the mechanic.
      }
      if (alive(from) && !from.stalker) return from;
      const ms = members();
      for (const m of ms) if (alive(m) && !m.stalker) return m;
      return null;
    }
    function say(word, from = null, mult = 1) {
      const w = WORDS[word]; if (!w) return false;
      const t = ctx.elapsed;
      if (w.hold && t - (said[word] || -1e9) < w.hold) return false;
      if (t - lastSayT < MIN_GAP) return false;
      const cmd = w.reg === 'command';
      if (cmd) {
        const l = solvers.leader ? solvers.leader() : squad.leader;
        const gap = skillOf(l, 'noiseGap', 5.0);
        if (t - lastCmdT < gap) return false;
      }
      const m = speaker(word, from);
      if (!m) return false;
      said[word] = t; lastSayT = t; if (cmd) { lastCmdT = t; stats.commands++; }
      stats.says++;
      mind.lastSay = word; mind.lastSayT = t; mind.lastSayBy = m;
      const car = cmd ? 'command' : 'field';
      carrier = car;
      m.sound('mimic_radio', {
        word, carrier: car, voice: m.voice != null ? m.voice : ((m.id || 0) % 97) / 97,
        gain: w.gain * mult, max: w.max, rate: w.rate * (0.98 + rnd() * 0.04),
      });
      if (squad) squad.radioT = Math.max(squad.radioT || 0, 1.4);
      return true;
    }
    // a mimic with nobody to talk to still keys the handset — it just has no command register to speak in
    function sayLone(m, word, mult = 1) {
      const w = WORDS[word]; if (!w || !alive(m)) return false;
      m.sound('mimic_radio', { word, carrier: 'field', voice: m.voice != null ? m.voice : 0.5, gain: w.gain * mult * 0.9, max: w.max, rate: w.rate });
      return true;
    }

    // -----------------------------------------------------------------------------------------------
    // §order — what an order COSTS.
    // The leader keys up (KEY_TIME), the word travels (distance, and not at all past RADIO_R), the man decides
    // whether to act on it at all (SKILL.answer) and then takes a moment to do it (ACT_DELAY). Until it lands
    // he keeps the seat he had — which is to say he stays down and keeps shooting. That gap is the window.
    // -----------------------------------------------------------------------------------------------
    function order(word, m, seat) {
      if (!alive(m)) return false;
      const t = ctx.elapsed, sk = squad.skill != null ? squad.skill : 0.5;
      const l = solvers.leader ? solvers.leader() : squad.leader;
      const key = lerp(KEY_TIME[0], KEY_TIME[1], sk);
      const from = alive(l) ? l : m;
      const d = dist2d(from.position.x, from.position.z, m.position.x, m.position.z);
      if (d > RADIO_R) { stats.refused++; return false; }          // out of reach of a handset: he never hears it
      let delay = key + d * lerp(0.022, 0.008, sk) + range(0, 0.35);
      if (!chance(skillOf(m, 'answer', 0.8))) delay += range(1.2, 2.8);   // he missed it, or he is not listening
      delay += lerp(ACT_DELAY[0], ACT_DELAY[1], sk);
      pending.push({ m, word, seat, at: t + delay });
      stats.orders++;
      return true;
    }
    function deliverOrders(t) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const r = pending[i];
        if (r.at > t) continue;
        pending.splice(i, 1);
        if (!alive(r.m)) continue;
        stats.delivered++;
        if (r.seat && r.seat.man === r.m) r.seat.armAt = Math.min(r.seat.armAt, t);
      }
    }

    // -----------------------------------------------------------------------------------------------
    // §ledger — one pass over the roster, folded into a command tier.
    // -----------------------------------------------------------------------------------------------
    function members() { return solvers.members ? solvers.members() : squad.members; }
    function buildLedger(t) {
      const ms = members();
      let n = 0, hurt = 0, rounds = 0, dry = 0, gren = 0, smoke = 0, anvil = 0, close = 0, long = 0, net = 0, seers = 0;
      let cx = 0, cz = 0, bx = 0, bz = 0, bn = 0;
      const l = solvers.leader ? solvers.leader() : squad.leader;
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i]; if (!alive(m)) continue;
        n++; cx += m.position.x; cz += m.position.z;
        hurt += 1 - clamp01((m.hp || 0) / (m.maxHp || 1));
        const r = m.roundsLeft ? m.roundsLeft() : 30; rounds += r; if (r <= 0) dry++;
        gren += m.grenades | 0;
        smoke += (m.loadout && m.loadout.smokes) | 0;
        const kind = m.profile ? m.profile.kind : 'burst';
        if (kind === 'sniper') long++; else if (kind === 'shotgun' || kind === 'semi') close++; else anvil++;
        if (alive(l) && dist2d(l.position.x, l.position.z, m.position.x, m.position.z) <= RADIO_R) net++;
        if (t - (m.lastVisT ?? -1e9) < 1.2 && (m.aware || 0) >= 0.85) seers++;
        const o = m.orders;
        if (o && (o.job === 'point' || o.job === 'support')) { bx += m.position.x; bz += m.position.z; bn++; }
      }
      ledger.n = n; ledger.initial = squad.initial || n; ledger.hurt = n ? hurt / n : 0;
      ledger.rounds = rounds; ledger.dry = dry; ledger.grenades = gren; ledger.smokes = smoke;
      ledger.anvil = anvil; ledger.close = close; ledger.long = long;
      ledger.org = squad.org != null ? squad.org : 1;
      ledger.morale = squad.morale != null ? squad.morale : 1;
      ledger.shaken = squad.shaken || 0;
      ledger.net = n ? net / n : 1;
      ledger.seersNow = seers;
      picture.seers = seers; if (seers > 0) picture.seerT = t;
      if (n) { ledgerCX = cx / n; ledgerCZ = cz / n; }
      if (bn) { ledgerCX = bx / bn; ledgerCZ = bz / bn; }
      // ---- the command tier ----
      const hasLeader = alive(l);
      let tier = 1;
      if (ledger.shaken > 0 || ledger.net < 0.4) tier = 0;
      else if (hasLeader && ledger.org > 0.75 && n >= 4 && ledger.net > 0.8) tier = 3;
      else if (hasLeader && ledger.org > 0.45 && n >= 2) tier = 2;
      else tier = 1;
      ledger.command = tier;
      return tier;
    }

    // -----------------------------------------------------------------------------------------------
    // §occluder — THE TREE. One ray, cached six seconds.
    // From the man with the freshest belief, straight at where the squad thinks he is. If something is in the
    // way, THAT is the thing he is hiding behind, and its size decides whether one man walks round it or the
    // squad solves a firing position on the far side of it.
    // -----------------------------------------------------------------------------------------------
    function findOccluder(t) {
      if (picture.occluder && t - picture.occT < OCC_LIFE) return true;
      if (!picture.has) return false;
      const ms = members();
      let best = null, bt = -1e9;
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i]; if (!alive(m) || m.stunned > 0) continue;
        const lt = Math.max(m.lastSeenT ?? -1e9, m.lastVisT ?? -1e9);
        if (lt > bt) { bt = lt; best = m; }
      }
      if (!best) return false;
      if (!budget(ctx, 1)) return false;
      stats.angleSolves++; stats.rays++;
      if (best.eyePos) best.eyePos(_eye); else _eye.set(best.position.x, best.position.y + 1.6, best.position.z);
      _v.set(picture.pos.x, picture.pos.y + 1.4, picture.pos.z);
      _dir.copy(_v).sub(_eye);
      const len = _dir.length(); if (len < 1.5) return false;
      _dir.divideScalar(len);
      const hit = ctx.world.raycast(_eye, _dir, len - 0.8);
      if (!hit || !hit.collider) { picture.occluder = null; picture.occT = t; return false; }
      const c = hit.collider;
      let r = 1;
      if (c.kind === 'cyl') r = c.r || 0.5;
      else if (c.min && c.max) r = Math.min(c.max.x - c.min.x, c.max.z - c.min.z) * 0.5;
      picture.occluder = c; picture.occT = t;
      picture.occX = hit.point.x; picture.occY = hit.point.y; picture.occZ = hit.point.z;
      picture.occR = r;
      picture.occKind = r < 1.2 ? 'thin' : r < 4 ? 'short' : 'long';
      stats.angleFound++;
      return true;
    }

    // -----------------------------------------------------------------------------------------------
    // §exits — the walkable bearings out of the picture. Refreshed at 0.5 Hz, no rays.
    // -----------------------------------------------------------------------------------------------
    function refreshExits(t) {
      if (t - picture.exitT < 2 || !picture.has || !solvers.walkable) return;
      picture.exitT = t;
      let n = 0;
      for (let i = 0; i < 8; i++) {
        const a = i * (TAU / 8);
        const ok = solvers.walkable(picture.pos.x + Math.cos(a) * 9, picture.pos.z + Math.sin(a) * 9, _v3) ? 1 : 0;
        picture.exits[i] = ok; n += ok;
      }
      picture.exitN = n;
    }

    // -----------------------------------------------------------------------------------------------
    // §read consumption — exactly four places. A fifth is a regression.
    //   1. which side           sideBias()   -> ANGLE and FLANK
    //   2. the grenade clock    holdTMul()   -> SKILL.holdT
    //   3. the cut bearing      cutPoint()   -> CUT
    //   4. the push window      pushWindow() -> when a shotgunner closes after your last counted round
    // -----------------------------------------------------------------------------------------------
    function readOn() {
      const l = solvers.leader ? solvers.leader() : squad.leader;
      return skillOf(l, 'read', 0) >= 0.25 ? 1 : 0;
    }
    function sideBias() {
      const t = ctx.elapsed;
      if (t - sideT < 6 && sideCache) return sideCache;
      sideT = t;
      const h = read.peek;
      if (readOn() && h.c > 0.35 && Math.abs(h.v) > 0.15) sideCache = h.v > 0 ? 1 : -1;
      else if (!sideCache) sideCache = rnd() < 0.5 ? 1 : -1;
      return sideCache;
    }
    function holdTMul() {
      if (!readOn()) return 1;
      const h = read.hold;
      return lerp(1.4, 0.55, clamp01(h.v * h.c));
    }
    function pushWindow() {
      if (!readOn() || read.mag.c < 0.4) return 0;
      return clamp(read.mag.v, 1, 30);
    }
    function readConfidence() {
      if (!readOn()) return 0;
      return clamp01((read.hold.c + read.pace.c + read.peek.c) / 3);
    }
    // the bearing the mind expects him to leave on — velocity if it is fresh, otherwise the strongest egress bin
    function cutPoint(out) {
      const t = ctx.elapsed;
      const sk = squad.skill != null ? squad.skill : 0.5;
      if (t - picture.velT < 1.5 && picture.vel.lengthSq() > 4) {
        const l = Math.hypot(picture.vel.x, picture.vel.z) || 1;
        const ahead = lerp(8, 20, sk);
        return out.set(picture.pos.x + (picture.vel.x / l) * ahead, picture.pos.y, picture.pos.z + (picture.vel.z / l) * ahead);
      }
      if (!readOn() || read.egressN < 3) return null;
      let bi = -1, bs = 0;
      for (let i = 0; i < 8; i++) if (read.egress[i] > bs) { bs = read.egress[i]; bi = i; }
      if (bi < 0 || bs < 2) return null;
      const a = bi * (TAU / 8);
      return out.set(picture.pos.x + Math.cos(a) * 14, picture.pos.y, picture.pos.z + Math.sin(a) * 14);
    }

    // -----------------------------------------------------------------------------------------------
    // §play selection. Availability is HARD-gated by tier, escalation and men. Preference is SOFT-gated by
    // skill. A day-one squad has three ideas and picks the dull one; an elite has nine and geometry decides.
    // -----------------------------------------------------------------------------------------------
    function playAvailable(p, tier, esc, n) {
      if (tier < p.tier) return false;
      if (n < p.min) return false;
      if (esc < p.esc) return false;
      const l = solvers.leader ? solvers.leader() : squad.leader;
      if (p.id === 'ANGLE' && skillOf(l, 'angle', 0.05) < 0.35) return false;
      if (p.id === 'CUT' && skillOf(l, 'cut', 0) < 0.30) return false;
      if (p.id === 'PROBE' && skillOf(l, 'feint', 0) < 0.25) return false;
      if (p.id === 'BAIT' && skillOf(l, 'feint', 0) < 0.45) return false;
      return true;
    }
    function pictureQ(t) {
      if (!picture.has) return 0;
      return clamp01(1 - picture.r / 18) * Math.exp(-(t - picture.t) / 6);
    }
    function geomFit(p, t) {
      switch (p.id) {
        case 'HOLD': return (squad.fixing || 0) > 0 ? 1 : 0.35;
        case 'ANGLE': return (picture.occluder && t - picture.occT < OCC_LIFE
          && dist2d(picture.occX, picture.occZ, picture.pos.x, picture.pos.z) < 15 && picture.seers === 0) ? 1 : 0;
        case 'FLANK': {
          if (picture.seers === 0 && t - picture.t > 6) return 0;
          const side = sideBias();
          const base = Math.atan2(ledgerCZ - picture.pos.z, ledgerCX - picture.pos.x);
          let ok = 0;
          for (let i = 0; i < 3; i++) {
            const a = base + side * (55 + i * 22) * DEG, r = 18;
            const x = picture.pos.x + Math.cos(a) * r, z = picture.pos.z + Math.sin(a) * r;
            if (frustum(x, z, 50)) continue;
            if (solvers.anomalyOnLine && solvers.anomalyOnLine(ledgerCX, ledgerCZ, x, z)) continue;
            if (solvers.walkable && !solvers.walkable(x, z, _v3)) continue;
            ok++;
          }
          return ok / 3;
        }
        case 'PIN': return (ledger.grenades > 0 || ledger.smokes > 0) && picture.stillT > 2 ? clamp01(picture.stillT / 6) : 0;
        case 'PUSH': { const at = squad.assaultT || -1e9; return (t < at && at - t < 3) || squad.assault ? 1 : 0; }
        case 'CUT': return (picture.vel.lengthSq() > 4 && t - picture.velT < 1.5) ? 1 : 0;
        case 'BAIT': {
          if (!solvers.anomalyOnLine) return 0.25;
          const bx = ledgerCX + (ledgerCX - picture.pos.x) * 0.8, bz = ledgerCZ + (ledgerCZ - picture.pos.z) * 0.8;
          return solvers.anomalyOnLine(picture.pos.x, picture.pos.z, bx, bz, 3) ? 1 : 0.2;
        }
        case 'PROBE': return ((picture.kind === 'heard' || picture.kind === 'told' || picture.kind === 'inferred') && picture.seers === 0) ? 1 : 0;
        case 'HUNT': return t - picture.t > 9 ? 1 : 0;
        case 'WITHDRAW': return ledger.morale < 0.45 || ledger.n * 2 <= ledger.initial ? 1 : 0.05;
        default: return 0.3;
      }
    }
    function resFit(p) {
      const n = ledger.n;
      switch (p.id) {
        case 'PIN': return clamp01((ledger.grenades + ledger.smokes) / 2) * 0.6 + clamp01(n / 3) * 0.4;
        case 'FLANK': return clamp01((n - 2) / 2);
        case 'PUSH': return clamp01(ledger.rounds / (n * 12)) * (ledger.dry ? 0.4 : 1);
        case 'BAIT': return clamp01((n - 2) / 2) * clamp01(ledger.morale);
        case 'HOLD': return clamp01(ledger.rounds / (n * 8));
        default: return 0.6;
      }
    }
    // how much of a moving seat's lane sits inside the belief cone. Three samples, no rays.
    function exposure(p) {
      if (p.id === 'HOLD' || p.id === 'HUNT') return 0;
      const side = sideBias();
      let seen = 0;
      for (let i = 0; i < 3; i++) {
        const a = Math.atan2(ledgerCZ - picture.pos.z, ledgerCX - picture.pos.x) + side * (30 + i * 30) * DEG;
        const r = lerp(10, 22, i / 2);
        if (frustum(picture.pos.x + Math.cos(a) * r, picture.pos.z + Math.sin(a) * r, 50)) seen++;
      }
      return seen / 3;
    }
    function momentum(t) {
      const frac = ledger.initial ? ledger.n / ledger.initial : 1;
      const dn = squad.deathsNear ? squad.deathsNear() : 0;
      return frac - 0.5 + picture.hurt * 0.6 - dn * 0.15;
    }
    function choosePlay(t, esc) {
      const l = solvers.leader ? solvers.leader() : squad.leader;
      const sk = squad.skill != null ? squad.skill : 0.5;
      const tier = ledger.command;
      if (tier === 0) return null;                                  // C0: no plays at all. Every limb on reflex.
      const menuN = Math.max(1, Math.round(skillOf(l, 'menuN', 3)));
      // the menu: the top `menuN` plays by base preference at this skill, of those actually available
      let considered = 0, best = null, bestS = -1e9;
      // sort the available plays by base preference, descending, into two pooled parallel arrays: the menu.
      // A recruit's leader looks at three of them and the dull one wins on base alone; an elite's looks at
      // nine and geometry decides. Insertion sort over at most ten entries, zero allocation.
      let on = 0;
      for (let i = 0; i < PLAYS.length; i++) {
        const p = PLAYS[i];
        if (!playAvailable(p, tier, esc, ledger.n)) continue;
        const b = lerp(p.base[0], p.base[1], sk);
        let j = on;
        while (j > 0 && MENU_B[j - 1] < b) { MENU_B[j] = MENU_B[j - 1]; MENU_P[j] = MENU_P[j - 1]; j--; }
        MENU_B[j] = b; MENU_P[j] = p;
        on++;
      }
      for (let i = 0; i < on && considered < menuN; i++) {
        const p = MENU_P[i], b = MENU_B[i];
        considered++;
        const s = b
          + 1.0 * pictureQ(t)
          + 1.2 * geomFit(p, t)
          + 0.8 * resFit(p)
          - 1.1 * exposure(p)
          + 0.7 * momentum(t)
          + 0.6 * (play && p.id === play.id ? 1 : 0)
          + (rnd() - 0.5) * 0.16;
        if (s > bestS) { bestS = s; best = p; }
      }
      playScore = bestS;
      return best;
    }

    // abort conditions, checked only with probability abortChk — a green squad cannot re-evaluate and looks
    // stupid; an elite bails the instant its trigger fires. Same code path, opposite feel.
    function shouldAbort(t) {
      if (!play) return false;
      switch (play.id) {
        case 'ANGLE': return picture.seers > 0 || t - picture.t > 12;
        case 'FLANK': return (squad.fixing || 0) === 0 && t - (squad.fixT ?? -1e9) > 3.5;
        case 'CUT': return t - picture.velT > 2.5;
        case 'PIN': return ledger.grenades <= 0 && ledger.smokes <= 0;
        case 'PUSH': return !(squad.assault || (squad.assaultT && t < squad.assaultT + 4.5));
        case 'PROBE': return picture.seers > 0;
        case 'BAIT': return ledger.n <= 1;
        case 'HUNT': return picture.seers > 0 || t - picture.t < 3;
        default: return false;
      }
    }

    // -----------------------------------------------------------------------------------------------
    // §layout — a play's seats. Criticality decides who is filled first, and therefore who a promotion
    // cascade steals from when a seat's man dies.
    // -----------------------------------------------------------------------------------------------
    function clearSeats() { for (let i = 0; i < SEAT_MAX; i++) { seats[i].active = false; seats[i].man = null; } seatN = 0; }
    function addSeat(kind, solver, want, critical, word) {
      if (seatN >= SEAT_MAX) return null;
      const s = seats[seatN++];
      s.kind = kind; s.solver = solver; s.want = want; s.critical = critical; s.word = word || null;
      s.active = true; s.man = null; s.said = false; s.armAt = 1e9; s.has = false; s.wpN = 0; s.wpI = 0; s.note = '';
      return s;
    }
    function layout(p, n) {
      clearSeats();
      switch (p.id) {
        case 'HOLD': for (let i = 0; i < n; i++) addSeat('ANVIL', 'orderHold', i === 0 ? 'close' : 'any', 10 - i); break;
        case 'ANGLE': {
          addSeat('ANGLE', 'angle', 'close', 12, 'angle');
          for (let i = 0; i < n - 1; i++) addSeat('ANVIL', 'orderHold', 'anvil', 9 - i);
          break;
        }
        case 'HUNT': {
          addSeat('SEARCH', 'search', 'any', 8);
          for (let i = 0; i < n - 1; i++) addSeat('EXIT', 'exit', 'any', 7 - i);
          break;
        }
        case 'PROBE': {
          addSeat('PROBE', 'probe', 'any', 6, 'probe');
          for (let i = 0; i < n - 1; i++) addSeat('EYES', 'orderOverwatch', 'long', 11 - i);
          break;
        }
        case 'FLANK': {
          addSeat('HAMMER', 'orderFlank', 'close', 12, 'flanking');
          addSeat('ANVIL', 'orderHold', 'anvil', 11);
          addSeat('ANVIL', 'orderHold', 'anvil', 10);
          if (n >= 4) addSeat('EYES', 'orderOverwatch', 'long', 6);
          for (let i = 4; i < n; i++) addSeat('RESERVE', 'reserve', 'any', 3);
          break;
        }
        case 'PIN': {
          addSeat('GRENADE', 'grenade', 'any', 12, 'grenade');
          addSeat('ANGLE', 'angle', 'close', 9, 'angle');
          for (let i = 0; i < n - 2; i++) addSeat('ANVIL', 'orderHold', 'anvil', 11 - i * 0.1);
          break;
        }
        case 'PUSH': for (let i = 0; i < n; i++) addSeat('ANVIL', 'push', i === 0 ? 'close' : 'any', 10 - i); break;
        case 'CUT': {
          addSeat('CUT', 'cut', 'close', 12, 'moving');
          for (let i = 0; i < n - 1; i++) addSeat('ANVIL', 'orderHold', 'anvil', 10 - i);
          break;
        }
        case 'BAIT': {
          addSeat('STAY', 'stay', 'close', 12);
          for (let i = 0; i < n - 1; i++) addSeat('BREAK', 'breakoff', 'any', 5 - i, i === 0 ? 'falling' : null);
          break;
        }
        case 'WITHDRAW': for (let i = 0; i < n; i++) addSeat('BREAK', 'breakoff', 'any', 6 - i, i === 0 ? 'falling' : null); break;
        default: for (let i = 0; i < n; i++) addSeat('ANVIL', 'orderHold', 'any', 5); break;
      }
      // never more than one manoeuvre seat, whatever the layout said
      let movers = 0;
      for (let i = 0; i < seatN; i++) { if (MOVER[seats[i].kind]) { if (++movers > 1) { seats[i].kind = 'ANVIL'; seats[i].solver = 'orderHold'; seats[i].word = null; } } }
    }

    // -----------------------------------------------------------------------------------------------
    // §fit — who takes which seat. Arithmetic only, no rays. `churn` is what stops the shuffling: a man who
    // changed seat two seconds ago is worth eight points less than a man who has been in his for five.
    // -----------------------------------------------------------------------------------------------
    const GUN = { anvil: { mg: 1, burst: 0.9, semi: 0.6, shotgun: 0.2, sniper: 0.3 },
      close: { shotgun: 1, semi: 0.85, burst: 0.7, mg: 0.4, sniper: 0.05 },
      long: { sniper: 1, mg: 0.7, burst: 0.5, semi: 0.35, shotgun: 0.05 },
      any: { mg: 0.6, burst: 0.6, semi: 0.6, shotgun: 0.6, sniper: 0.6 } };
    function fit(m, seat, t) {
      if (!alive(m)) return -1e9;
      const dA = m._dA != null ? m._dA : dist2d(m.position.x, m.position.z, picture.pos.x, picture.pos.z);
      let pos = 0;
      switch (seat.kind) {
        case 'ANVIL': { const hold = m.profile ? m.profile.hold : [10, 40]; const want = (hold[0] + hold[1]) * 0.5; pos = 1 - clamp01(Math.abs(dA - want) / 40); break; }
        case 'ANGLE': case 'HAMMER': case 'CUT': {
          const side = sideBias();
          const ma = Math.atan2(m.position.z - picture.pos.z, m.position.x - picture.pos.x);
          const ba = Math.atan2(ledgerCZ - picture.pos.z, ledgerCX - picture.pos.x);
          pos = clamp01(0.5 + side * angleDelta(ba, ma) / Math.PI) * (1 - clamp01(Math.abs(dA - 18) / 40));
          break;
        }
        case 'EYES': pos = clamp01((dA - 24) / 30); break;
        case 'PROBE': pos = (1 - clamp01(dA / 45)) * (1 - rankOf(m) / 5); break;   // the newest man walks the lane
        case 'GRENADE': pos = (m.grenades > 0 ? 1 : 0) * (1 - clamp01(Math.abs(dA - 16) / 16)); break;
        case 'MEND': pos = 1 - clamp01((m.hp || 0) / (m.maxHp || 1)); break;
        case 'STAY': pos = (1 - clamp01(dA / 40)) * (1 - rankOf(m) / 6); break;
        default: pos = 0.5; break;
      }
      const gk = m.profile ? m.profile.kind : 'burst';
      const gun = (GUN[seat.want] || GUN.any)[gk] ?? 0.5;
      let ready = 1;
      if (m.roundsLeft && m.roundsLeft() <= 0) ready -= 0.7;
      if (m.state === 'reload') ready -= 0.5;
      if (m.stunned > 0) ready -= 0.8;
      if (committed(m)) ready -= 0.6;
      if ((m.morale ?? 1) < 0.3) ready -= 0.4;
      const rr = reachOf(m, seat.x || picture.pos.x, seat.z || picture.pos.z);
      const reach = rr === Infinity ? -1e6 : 1 - clamp01(rr / 60);
      const churn = m._seatT != null ? clamp01(1 - (t - m._seatT) / 4) * 8 : 0;
      return 2.0 * pos + 1.5 * gun + 1.0 * clamp01(ready) + 0.8 * reach - 2.0 * churn + (rnd() - 0.5) * 0.1;
    }
    // greedy over seats in criticality order, one seat per man. O(seats x men), <= 36 comparisons.
    function fillSeats(t) {
      const ms = members();
      const pool = FILL_POOL; let pn = 0;
      for (let i = 0; i < ms.length && pn < pool.length; i++) { const m = ms[i]; if (alive(m) && m.stunned <= 0) pool[pn++] = m; }
      // criticality order without a sort allocation
      for (let i = 1; i < seatN; i++) { const s = seats[i]; let j = i - 1; while (j >= 0 && seats[j].critical < s.critical) { seats[j + 1] = seats[j]; j--; } seats[j + 1] = s; }
      for (let i = 0; i < seatN; i++) {
        const seat = seats[i]; if (!seat.active) continue;
        let best = null, bs = -1e8, bi = -1;
        for (let k = 0; k < pn; k++) {
          const m = pool[k]; if (!m) continue;
          const f = fit(m, seat, t);
          if (f > bs) { bs = f; best = m; bi = k; }
        }
        if (!best) { seat.man = null; continue; }
        pool[bi] = null;
        if (seat.man !== best) {
          const wasSeat = best._seat;
          seat.man = best; seat.sinceT = t; seat.said = false;
          best._seat = seat.kind; best._seatT = t;
          stats.seatChanges++;
          // a manoeuvre seat is CALLED, then ARMED. Until then he keeps his head down and keeps shooting.
          if (MOVER[seat.kind] || seat.kind === 'GRENADE') {
            seat.armAt = t + LEAD;
            if (seat.word && say(seat.word, alive(solvers.leader ? solvers.leader() : squad.leader) ? null : best)) seat.said = true;
            order(seat.word || seat.kind, best, seat);
          } else seat.armAt = t;
          if (wasSeat && wasSeat !== seat.kind && seat.kind === 'ANVIL') { /* pulled back into the base of fire */ }
        }
      }
    }
    const FILL_POOL = new Array(12).fill(null);

    // A seat's man died. Refill from the least-critical OCCUPIED seat, never from thin air; if nothing can be
    // spared the play degrades. The promoted man goes to ground on the spot and is solved next tick.
    function promote(t) {
      for (let i = 0; i < seatN; i++) {
        const s = seats[i];
        if (!s.active || alive(s.man)) continue;
        s.man = null;
        let donor = null, di = -1;
        for (let k = seatN - 1; k >= 0; k--) {
          const d = seats[k];
          if (d === s || !d.active || !alive(d.man)) continue;
          if (d.critical >= s.critical) continue;
          donor = d; di = k; break;
        }
        if (donor) {
          const m = donor.man;
          donor.man = null; s.man = m; s.sinceT = t; s.armAt = t + LEAD * 0.5; s.said = false;
          m._seat = s.kind; m._seatT = t;
          const o = m.orders; if (o) { o.hold = true; o.fire = true; }
          stats.promotions++;
          void di;
        } else if (MOVER[s.kind] || s.kind === 'GRENADE' || s.kind === 'STAY') {
          degrade(t);
          return;
        }
      }
    }
    function degrade(t) {
      const to = play && (play.id === 'BAIT') ? 'WITHDRAW' : 'HOLD';
      setPlay(PLAY_BY_ID[to], t, 'degrade');
    }

    // -----------------------------------------------------------------------------------------------
    // §solve — the seat's position. squad.js's own solvers do the expensive ones; the four new ones are here.
    // At most two seats are re-solved a tick (posCursor's round-robin), plus any seat whose man just changed.
    // -----------------------------------------------------------------------------------------------
    function applySeat(seat, t, forced) {
      const m = seat.man; if (!alive(m)) return;
      const o = m.orders; if (!o) return;
      // called but not armed: he is still in the base of fire. This is the window.
      if (t < seat.armAt) { o.role = 'base'; o.fire = true; o.hold = true; o.mv = 0; return; }
      // A man walking an arc has nothing in sight and on his own would decide the contact was over in six
      // seconds and wander off. He is not on his own. This does NOT make his belief fresher — lastSeenPlayer
      // is untouched, so he still cannot shoot at something he cannot see — it only stops him giving up.
      if (MOVER[seat.kind] && picture.has && t - picture.t < 12) {
        m.engaged = true;
        if ((m.aware || 0) < 0.85) m.aware = 0.85;
        if (t - (m.lastVisT ?? -1e9) > 3) m.lastVisT = t - 3;
      }
      const disc = skillOf(m, 'seatDisc', 0.6);
      if (!forced && !chance(clamp01(0.35 + disc * 0.65))) return;    // a green man does not hold the seat he was given
      o.job = seatJob(seat.kind);
      switch (seat.solver) {
        case 'orderHold': call('orderHold', m, o, seat.kind === 'ANVIL' && seat.critical >= 10); break;
        case 'orderFlank': o.side = sideBias(); call('orderFlank', m, o); break;
        case 'orderOverwatch': call('orderOverwatch', m, o); break;
        case 'push': o.role = 'base'; o.fire = true; o.hold = false; call('orderAdvance', m, o); break;
        case 'angle': solveAngle(m, o, seat, t); break;
        case 'cut': solveCut(m, o, seat, t); break;
        case 'probe': solveProbe(m, o, seat, t); break;
        case 'search': solveSearch(m, o, seat, t); break;
        case 'exit': solveExit(m, o, seat, t); break;
        case 'reserve': solveReserve(m, o, seat, t); break;
        case 'grenade': solveGrenade(m, o, seat, t); break;
        case 'stay': solveStay(m, o, seat, t); break;
        case 'breakoff': o.job = 'breakoff'; o.role = 'regroup'; o.fire = false; o.hold = false; break;
        default: call('orderHold', m, o, false); break;
      }
    }
    function seatJob(kind) {
      switch (kind) {
        case 'ANVIL': return 'support';
        case 'HAMMER': return 'flanker';
        case 'ANGLE': return 'flanker';
        case 'CUT': return 'flanker';
        case 'PROBE': return 'point';
        case 'EYES': return 'overwatch';
        case 'GRENADE': return 'support';
        case 'SEARCH': case 'EXIT': return 'sweep';
        case 'BREAK': return 'breakoff';
        case 'STAY': return 'ambush';
        case 'RESERVE': return 'support';
        default: return 'support';
      }
    }
    function call(name, m, o, arg) {
      const f = solvers[name];
      if (typeof f !== 'function') { o.role = 'base'; o.fire = true; o.hold = true; return false; }
      f(m, o, arg);
      return true;
    }

    // ---- ANGLE. THE TREE FIX. -----------------------------------------------------------------------
    // The base of fire retargets its suppression at the NEAR FACE of the thing you are behind, so you cannot
    // lean back out; ONE man — never two — walks the arc around it. Round a trunk that is a constant-radius
    // orbit validated with walkable() and no rays at all. Round a wall or a truck it is a firing position on
    // the far side, three rays at most. The word goes out 0.6 s before he steps off.
    function solveAngle(m, o, seat, t) {
      if (!findOccluder(t)) { call('orderHold', m, o, false); return; }
      // the base of fire puts rounds on the near face
      const bx = picture.occX - ledgerCX, bz = picture.occZ - ledgerCZ;
      const bl = Math.hypot(bx, bz) || 1;
      const nx = picture.occX - (bx / bl) * 0.6, nz = picture.occZ - (bz / bl) * 0.6;
      for (let i = 0; i < seatN; i++) {
        const s = seats[i]; if (s.kind !== 'ANVIL' || !alive(s.man) || !s.man.orders) continue;
        const so = s.man.orders;
        so.sector.set(nx, picture.occY, nz); so.hasSector = true; so.sectorAt = t; so.covering = null;
      }
      const side = sideBias();
      o.role = 'flank'; o.fire = false; o.hold = false; o.at = false; o.side = side;
      if (picture.occKind === 'thin') {
        // a trunk, a pole, a lamp post. Keep the radius CONSTANT and step 55 deg per waypoint on the side the
        // read says he comes out of. No rays: three walkable probes and he is walking.
        if (seat.wpN === 0 || seat.wpI >= seat.wpN) {
          const cx = picture.occX, cz = picture.occZ;
          const r = Math.max(4, dist2d(m.position.x, m.position.z, cx, cz));
          const a0 = Math.atan2(m.position.z - cz, m.position.x - cx);
          seat.wpN = 0;
          for (let k = 1; k <= 3; k++) {
            const a = a0 + side * ANGLE_STEP * k;
            const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
            if (solvers.walkable && !solvers.walkable(x, z, _v3)) continue;
            if (solvers.anomalyAt && solvers.anomalyAt(x, z)) continue;
            seat.wp[seat.wpN * 3] = x; seat.wp[seat.wpN * 3 + 1] = _v3.y || picture.pos.y; seat.wp[seat.wpN * 3 + 2] = z;
            seat.wpN++;
          }
          seat.wpI = 0;
          seat.note = 'orbit';
        }
        if (seat.wpN === 0) { call('orderHold', m, o, false); return; }
        const i3 = seat.wpI * 3;
        o.target.set(seat.wp[i3], seat.wp[i3 + 1], seat.wp[i3 + 2]); o.hasTarget = true;
        if (dist2d(m.position.x, m.position.z, o.target.x, o.target.z) < 2.0) seat.wpI++;
        return;
      }
      // a wall, a truck, a building: solve a firing position on the far side of it
      if (!solvers.bestCover) { call('orderHold', m, o, false); return; }
      if (!budget(ctx, 3)) return;
      stats.rays += 3;
      _v4.set(picture.pos.x, picture.pos.y + 1.55, picture.pos.z);
      const c = solvers.bestCover(m.position, 24, (cp, dm) => {
        const dp = dist2d(cp.x, cp.z, picture.pos.x, picture.pos.z);
        if (dp < 5 || dp > 34 || dm < 2) return null;
        // the far side of the occluder from the base of fire — a dot product, free
        const ox = cp.x - picture.occX, oz = cp.z - picture.occZ;
        const ol = Math.hypot(ox, oz) || 1;
        const far = -((ox / ol) * (bx / bl) + (oz / ol) * (bz / bl));
        if (far < 0.1) return null;
        // and not across the base's own lines of fire
        const cross = Math.abs(angleDelta(Math.atan2(cp.z - ledgerCZ, cp.x - ledgerCX), Math.atan2(picture.pos.z - ledgerCZ, picture.pos.x - ledgerCX)));
        return far * 26 + cross * 6 - dm * 0.25;
      }, true, 1.5, _v4);
      if (c) { o.target.copy(c); o.hasTarget = true; if (!m.cover) m.cover = new THREE.Vector3(); m.cover.copy(c); seat.note = 'far-side'; }
      else { seat.note = 'no-far-side'; call('orderHold', m, o, false); }
    }

    // ---- CUT. Solve a seat AHEAD of him, not onto him. Fair by construction: picture.vel is zeroed the
    // instant the guess is wide, so a man they only heard is never cut off.
    function solveCut(m, o, seat, t) {
      const p = cutPoint(_v);
      if (!p) { call('orderHold', m, o, false); return; }
      o.role = 'flank'; o.fire = false; o.hold = false; o.at = false;
      if (solvers.walkable && solvers.walkable(p.x, p.z, _v3)) { o.target.copy(_v3); o.hasTarget = true; seat.note = 'ahead'; }
      else { o.target.copy(p); o.hasTarget = true; seat.note = 'ahead-rough'; }
      seat.x = o.target.x; seat.z = o.target.z;
      void t;
    }

    // ---- PROBE. One man — the newest — walks a lane in the open on purpose, to make you shoot and show
    // yourself to the men who are watching for exactly that.
    function solveProbe(m, o, seat, t) {
      o.role = 'flank'; o.fire = false; o.hold = false; o.at = false;
      const dx = picture.pos.x - m.position.x, dz = picture.pos.z - m.position.z;
      const l = Math.hypot(dx, dz) || 1;
      const step = clamp(l * 0.55, 6, 22);
      const x = m.position.x + (dx / l) * step, z = m.position.z + (dz / l) * step;
      if (solvers.walkable && solvers.walkable(x, z, _v3)) { o.target.copy(_v3); o.hasTarget = true; }
      else { o.target.set(x, m.position.y, z); o.hasTarget = true; }
      seat.x = o.target.x; seat.z = o.target.z; seat.note = 'lane';
      void t;
    }

    // ---- HUNT. The picture is stale. One man walks the ground, the rest sit on the ways out of it. Nobody
    // says anything, which is the most frightening thing this file can do for free.
    function solveSearch(m, o, seat, t) {
      o.job = 'sweep'; o.role = 'base'; o.fire = true; o.hold = false; o.at = false; o.mv = 0;
      if (solvers.walkable && solvers.walkable(picture.pos.x, picture.pos.z, _v3)) { o.target.copy(_v3); o.hasTarget = true; }
      else { o.target.copy(picture.pos); o.hasTarget = true; }
      void seat; void t;
    }
    function solveExit(m, o, seat, t) {
      refreshExits(t);
      let idx = -1, tries = 0;
      const start = (seat.critical * 3) & 7;
      for (let i = 0; i < 8 && tries < 8; i++) { const k = (start + i) & 7; tries++; if (picture.exits[k] > 0 && !EXIT_TAKEN[k]) { idx = k; break; } }
      if (idx < 0) idx = start;
      EXIT_TAKEN[idx] = 1;
      const a = idx * (TAU / 8), r = 12;
      const x = picture.pos.x + Math.cos(a) * r, z = picture.pos.z + Math.sin(a) * r;
      o.job = 'sweep'; o.role = 'watch'; o.fire = false; o.hold = true; o.at = false;
      if (solvers.walkable && solvers.walkable(x, z, _v3)) { o.target.copy(_v3); o.hasTarget = true; }
      else o.hasTarget = false;
      o.sector.set(picture.pos.x, picture.pos.y, picture.pos.z); o.hasSector = true; o.sectorAt = t;
      seat.arc = a;
    }
    const EXIT_TAKEN = new Uint8Array(8);

    // ---- RESERVE. Not "do what everybody else is doing". Each reserve gets a DISTINCT arc and is told to
    // watch it. Players attribute far more intent to the man staring at the doorway they were about to use
    // than these four lines deserve, and that is fine.
    function solveReserve(m, o, seat, t) {
      let n = 0, k = 0;
      for (let i = 0; i < seatN; i++) if (seats[i].kind === 'RESERVE') { if (seats[i] === seat) k = n; n++; }
      const base = Math.atan2(picture.pos.z - m.position.z, picture.pos.x - m.position.x);
      const a = base + (k + 1) * (TAU / Math.max(2, n + 1));
      o.role = 'base'; o.fire = false; o.hold = true;
      o.sector.set(m.position.x + Math.cos(a) * 16, m.position.y, m.position.z + Math.sin(a) * 16);
      o.hasSector = true; o.sectorAt = t; o.hasTarget = false;
      seat.arc = a;
    }

    // ---- the frag. Ordered by the mind, thrown by mimic.js. The word goes out first; the throw is a second
    // behind it, so a grenade is always something you were told about.
    function solveGrenade(m, o, seat, t) {
      call('orderHold', m, o, false);
      if (!m.grenades || m.grenades <= 0) return;
      if (o.frag && t < o.frag + 8) return;
      if (t < seat.armAt) return;
      o.frag = t + 1.05;
      seat.note = 'frag';
    }

    // ---- BAIT's STAY seat. He does not move again. ambush.js owns him from here if it is wired.
    function solveStay(m, o, seat, t) {
      o.job = 'ambush'; o.role = 'ambush'; o.hold = true; o.fire = false; o.hasTarget = false;
      if (deps.pickHide && !seat.has) {
        const rx = ledgerCX + (ledgerCX - picture.pos.x), rz = ledgerCZ + (ledgerCZ - picture.pos.z);
        seat.has = !!deps.pickHide(m, ctx, rx, rz);
      }
      void t;
    }

    // -----------------------------------------------------------------------------------------------
    // §setPlay / abort
    // -----------------------------------------------------------------------------------------------
    function setPlay(p, t, why) {
      if (!p) { play = null; return; }
      if (play && play.id === p.id) return;
      prevPlay = play; play = p; playSince = t; playT = 0;
      stats.plays[p.id] = (stats.plays[p.id] || 0) + 1;
      layout(p, ledger.n);
      EXIT_TAKEN.fill(0);
      // the play's own word, said by the leader, once, before anything happens because of it
      if (p.word && p.id !== 'ANGLE' && p.id !== 'CUT' && p.id !== 'FLANK') say(p.word);
      // the real fall-backs actually route through squad.js's own machinery
      if (p.id === 'WITHDRAW' && solvers.beginBreakoff) solvers.beginBreakoff();
      if (p.id === 'BAIT' && solvers.beginBreakoff) solvers.beginBreakoff();
      mind.playWhy = why || '';
    }
    function abortPlay(reason) {
      if (!play) return;
      stats.aborts++;
      for (let i = 0; i < seatN; i++) {
        const s = seats[i];
        if (!s.active || !alive(s.man) || !s.man.orders) continue;
        if (!MOVER[s.kind]) continue;
        const o = s.man.orders;
        o.hasTarget = false; o.hold = true; o.fire = true; o.role = 'base'; o.at = false; o.mv = 0;
      }
      play = null; clearSeats();
      mind.abortReason = reason || '';
    }

    // -----------------------------------------------------------------------------------------------
    // §leader — killing him.
    // The active play is aborted MID-EXECUTION: the man who was walking round stops and goes to ground where
    // he is, visibly. No plays at all while `shaken` runs. Then, after two to four seconds of silence, the
    // next-ranked man keys the handset WITH THE COMMAND CARRIER for the first time and says `hold` — and the
    // commanding voice comes from a different place in the world. That is what killing him bought.
    // -----------------------------------------------------------------------------------------------
    function onLeaderDown(m) {
      const t = ctx.elapsed;
      abortPlay('leaderDown');
      pending.length = 0;
      handoverAt = t + range(2, 4); handoverDone = false;
      lastCmdT = t;                                   // the radio goes quiet for a beat
      carrier = 'field';
      void m;
    }
    function handover(t) {
      if (handoverDone || t < handoverAt) return;
      handoverDone = true;
      const l = solvers.leader ? solvers.leader() : squad.leader;
      if (!alive(l)) { handoverAt = t + 2; handoverDone = false; return; }
      lastCmdT = -1e9; said.hold = -1e9; lastSayT = -1e9;
      say('hold', l, 1.1);
      mind.handoverBy = l;
    }

    // -----------------------------------------------------------------------------------------------
    // §gather — the mind reads its own men. This is the only route from a sense into the picture that does
    // not come through squad.report(), and it is what makes the module testable on its own.
    // -----------------------------------------------------------------------------------------------
    function gather(t) {
      const ms = members();
      let bestSeen = null, bestSeenT = -1e9, bestTold = null, bestToldT = -1e9;
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i]; if (!alive(m) || !m.lastSeenPlayer) continue;
        const vt = m.lastVisT ?? -1e9, st = m.lastSeenT ?? -1e9;
        if (t - vt < 0.35 && st >= vt - 0.01) { if (st > bestSeenT) { bestSeenT = st; bestSeen = m; } }
        else if (st > bestToldT) { bestToldT = st; bestTold = m; }
      }
      if (bestSeen && bestSeenT > picture.t) write(bestSeen.lastSeenPlayer, bestSeenT, 0, 'seen', bestSeen);
      else if (bestTold && bestToldT > picture.t + 0.4) {
        const r = bestTold.beliefR != null ? bestTold.beliefR : 3;
        write(bestTold.lastSeenPlayer, bestToldT, r, r > 6 ? 'heard' : 'told', bestTold);
      }
    }

    // -----------------------------------------------------------------------------------------------
    // §update — per frame. Clocks, order delivery, seat arming, the interrupt slot. No rays, no allocation.
    // -----------------------------------------------------------------------------------------------
    function update(dt) {
      const t = ctx.elapsed;
      deliverOrders(t);
      handover(t);
      // stillT only accumulates while somebody can see it, or the picture is under three seconds old.
      // Stand still behind a wall nobody can see and no grenade is ever ordered — which is correct, and more
      // frightening, because the way to draw a frag becomes letting them SEE you stay put.
      if (picture.has && (picture.seers > 0 || t - picture.t < 3)) picture.stillT += dt;
      if (t - picture.velT > 2) picture.vel.set(0, 0, 0);
      picture.hurt = Math.max(0, picture.hurt - dt * 0.02);
      if (playT > 0) playT -= dt;
      idle(read.peek, dt); idle(read.mag, dt); idle(read.hold, dt); idle(read.pace, dt);
      if (read.trainN > 0 && t - read.trainT > 0.9) { feed(read.mag, read.trainN, 1.4, 1.1, 0.9); read.trainN = 0; }
      if (interrupt.live && t - interrupt.t > 1.5) interrupt.live = false;
      // a seat whose man has died is refilled the same frame, not at the next plan tick
      if (play) { for (let i = 0; i < seatN; i++) { if (seats[i].active && seats[i].man && !seats[i].man.alive) { promote(t); break; } } }
    }

    // -----------------------------------------------------------------------------------------------
    // §tick — the plan tick. squad.js calls this from assignJobs, two squads a frame at most.
    // -----------------------------------------------------------------------------------------------
    function tick(dt, membersArg) {
      const t = ctx.elapsed;
      const pdt = lastTickT < 0 ? 0.25 : clamp(t - lastTickT, 0.001, 1.0);
      lastTickT = t;
      void membersArg; void dt;
      const esc = (ctx.director && ctx.director.escalation) | 0;
      EXIT_TAKEN.fill(0);
      buildLedger(t);
      gather(t);
      refreshExits(t);
      // THE TREE. The occluder solve is ANGLE's precondition, so it runs BEFORE the play is scored: one ray
      // per squad per plan tick, cached six seconds, and only once they have actually lost the line.
      if (picture.seers > 0) lastLineT = t;
      else if (picture.has && t - picture.t < 9 && t - lastLineT > 1.2) findOccluder(t);
      if (!mergedZone && squad.inCombat) {
        mergedZone = true;
        const l = solvers.leader ? solvers.leader() : squad.leader;
        if (skillOf(l, 'read', 0) >= 0.60) zoneRead.merge(read, 0.6);
      }
      if (!picture.has) { play = null; wantReplan = false; return null; }

      // C0 — the ten seconds after you kill him. No plays at all; every limb on reflex.
      if (ledger.command === 0) {
        if (play) abortPlay('C0');
        if (solvers.orderShaken) { const ms = members(); for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (alive(m) && m.orders) solvers.orderShaken(m, m.orders); } }
        wantReplan = false;
        return null;
      }

      // commitment. A play is held commitT seconds unconditionally; after that it is re-scored with a
      // hysteresis bonus, and its own abort conditions are checked only with probability abortChk.
      const l = solvers.leader ? solvers.leader() : squad.leader;
      const commitT = skillOf(l, 'commitT', 2.0);
      const abortChk = skillOf(l, 'abortChk', 0.2);
      const held = t - playSince;
      let repick = !play || held >= commitT || wantReplan || interrupt.live;
      if (play && held >= commitT * 0.5 && chance(abortChk) && shouldAbort(t)) { abortPlay('trigger'); repick = true; }
      if (repick) {
        const p = choosePlay(t, esc);
        if (p) setPlay(p, t, wantReplan ? 'interrupt' : 'rescore');
        wantReplan = false; interrupt.live = false;
      }
      if (!play) return null;
      if (ledger.n !== seatCount()) layout(play, ledger.n);
      promote(t);
      fillSeats(t);

      // position solving: two seats a tick, round robin, plus anyone whose man just changed
      let solved = 0;
      for (let i = 0; i < seatN; i++) {
        const s = seats[i]; if (!s.active || !alive(s.man)) continue;
        const fresh = t - s.sinceT < 0.3;
        const turn = (i === solveCursor % Math.max(1, seatN));
        if (!fresh && !turn && solved >= 2) continue;
        applySeat(s, t, fresh);
        if (!fresh) solved++;
      }
      solveCursor = (solveCursor + 1) % Math.max(1, seatN);
      // the ANGLE mover says the word one beat before he steps off, and only then
      for (let i = 0; i < seatN; i++) {
        const s = seats[i];
        if (!s.active || s.said || !s.word || !MOVER[s.kind] || !alive(s.man)) continue;
        if (t >= s.armAt - LEAD) { if (say(s.word)) s.said = true; }
      }
      void pdt;
      return play;
    }
    function seatCount() { let n = 0; for (let i = 0; i < seatN; i++) if (seats[i].active) n++; return n; }

    // -----------------------------------------------------------------------------------------------
    // §public
    // -----------------------------------------------------------------------------------------------
    Object.assign(mind, {
      tick, update, write, observe, say, sayLone: (m, w, g) => sayLone(m, w, g), order,
      frustum, sideBias, holdTMul, pushWindow, readConfidence, cutPoint, abortPlay, onLeaderDown,
      spreadRate() { return lerp(1.15, 0.45, readConfidence()); },
      // squad.js proxies: know/lastKnown/knownR/contactKind used to live there; they live here now
      know(pos, t, r = 0) { return write(pos, t, r, r <= 0.05 ? 'seen' : r > 6 ? 'heard' : 'told'); },
      get lastKnown() { return picture.pos; },
      get lastKnownT() { return picture.t; },
      get knownR() { return picture.r; },
      get contactKind() { return picture.kind; },
      get hasKnown() { return picture.has; },
      spread() { return picture.seers > 0 ? 0 : Math.min(26, picture.r + Math.max(0, ctx.elapsed - picture.t) * mind.spreadRate()); },
      // the interrupt slot: a man down, a frag in, contact from behind. Re-plan within one frame, once per 1.5 s.
      interrupt(kind, x, z, from) {
        const t = ctx.elapsed;
        if (interrupt.live && t - interrupt.t < 1.5) return false;
        interrupt.kind = kind; interrupt.x = x; interrupt.z = z; interrupt.from = from; interrupt.t = t; interrupt.live = true;
        wantReplan = true;
        return true;
      },
      standDown(hard) {
        abortPlay('standDown');
        pending.length = 0;
        if (hard) {
          zoneRead.learn(read);                            // what this contact taught the zone
          picture.has = false; picture.kind = 'none'; picture.r = 0; picture.t = -1e9; picture.stillT = 0;
          picture.occluder = null; picture.hurt = 0; picture.vel.set(0, 0, 0);
          const fresh = makeRead();
          for (const k of ['peek', 'mag', 'hold', 'pace']) { read[k].v = fresh[k].v; read[k].c = fresh[k].c; read[k].n = 0; }
          read.egress.fill(0); read.egressN = 0; read.trainN = 0;
          mergedZone = false;
        }
      },
      // for the tests and for ai-tactics counters
      seatOf(m) { for (let i = 0; i < seatN; i++) if (seats[i].man === m) return seats[i]; return null; },
      activeSeats() { let n = 0; for (let i = 0; i < seatN; i++) if (seats[i].active && seats[i].man) n++; return n; },
      moverSeats() { let n = 0; for (let i = 0; i < seatN; i++) if (seats[i].active && seats[i].man && MOVER[seats[i].kind]) n++; return n; },
      debug() {
        return {
          play: play ? play.id : null, tier: ledger.command, age: +(ctx.elapsed - playSince).toFixed(2),
          seers: picture.seers, kind: picture.kind, r: +picture.r.toFixed(1), still: +picture.stillT.toFixed(1),
          hurt: +picture.hurt.toFixed(2), occ: picture.occluder ? picture.occKind : null,
          side: sideCache, read: { peek: +read.peek.v.toFixed(2), peekC: +read.peek.c.toFixed(2), mag: +read.mag.v.toFixed(2), magC: +read.mag.c.toFixed(2), hold: +read.hold.v.toFixed(2), pace: +read.pace.v.toFixed(2) },
          seats: seats.filter((s) => s.active).map((s) => ({ k: s.kind, m: s.man ? (s.man.id || 'm') : null, armed: ctx.elapsed >= s.armAt, note: s.note })),
        };
      },
    });
    return mind;
  }

  ctx.events?.on?.('gameStart', () => resetZoneRead());
  ctx.events?.on?.('tide', () => zoneRead.decay(0.25));
  ctx.events?.on?.('sleep', () => zoneRead.decay(0.40));

  return {
    CALLS, WORDS, PLAYS, SKILL_ROWS, RADIO_R,
    makeMind, zoneRead, resetZoneRead, buildLeaderMark,
    sayLone(m, word, mult = 1) {
      const w = WORDS[word]; if (!w || !m || !m.alive) return false;
      m.sound('mimic_radio', { word, carrier: 'field', voice: m.voice != null ? m.voice : 0.5, gain: w.gain * mult * 0.9, max: w.max, rate: w.rate });
      return true;
    },
    stats() { return stats; },
    resetStats() { stats.says = 0; stats.commands = 0; stats.orders = 0; stats.delivered = 0; stats.refused = 0; stats.angleSolves = 0; stats.angleFound = 0; stats.rays = 0; stats.seatChanges = 0; stats.promotions = 0; stats.aborts = 0; for (const k in stats.plays) stats.plays[k] = 0; },
  };
}
