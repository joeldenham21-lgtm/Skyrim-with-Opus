// What a mimic does with what it carries, and what it does with what it finds.
//
// Two systems live here and they are deliberately in the same file because they share one rule:
//
//   1. ITEM USE. A mimic is what it carries (enemies/loadout.js), and until now it carried a bandage it would
//      never open and a mask it would never fit. Every line of src/data/items.js that a human enemy plausibly
//      has in his pouches now has a condition, a gate on the difficulty curve, a commitment window in which he
//      CANNOT SHOOT, a sound, and an honest cost: what he uses comes out of the loadout, so a mimic that
//      bandaged himself drops no bandage. That last clause is the whole reason item use reads as real rather
//      than magical, and it is one line in applyEffect().
//
//   2. SCAVENGING, under a hard invariant. A mimic may take a rifle, a magazine or a plate off a body it walks
//      past. Nothing may be destroyed or made unrecoverable by that. The Explorer may have to kill a different
//      man to get it back — which is the interesting part — but it must still be there.
//
// THE LOOT INVARIANT, stated as code
// ---------------------------------
// data/loadouts.js DROPS destroys 22-65 % of most categories by design: that tax is what keeps the Committee's
// shop relevant. It is correct for gear a mimic was ISSUED and catastrophic for gear it PICKED UP, because a
// picked-up item has already been through the table once — it is a materialised entry lying on the ground —
// and running it a second time is a silent, permanent loss of the Explorer's loot that would be nearly
// impossible to notice in play.
//
// So scavenged goods never enter the ordinary loadout arrays where dropsFor() would roll them:
//
//   * every entry taken out of a pile is registered in `loadout.scavenged`, which drops at probability 1.0;
//   * scavengedDrops(loadout, out) — ONE line at the top of dropsFor() — emits them and CLAIMS the instances
//     out of loadout.weapon / .vest / .helmet / .mags / .kit so the ordinary tables cannot roll them a second
//     time, and cannot roll them away;
//   * a swap gives back what it takes: a mimic who takes the AKM off a body leaves his Makarov on the same
//     body, so the entry count in the world is conserved exactly rather than merely preserved;
//   * a scavenged CONSUMABLE is carried, never consumed. He will not eat your medkit. Only the rounds inside a
//     scavenged magazine are spendable, and the magazine itself always comes back.
//
// tools/scenarios/ai2-kit-loot.mjs proves it: seed known loot, let a squad scavenge for ten minutes of
// simulated time, kill everyone, and assert every original entry is recoverable somewhere, uid for uid.
//
// SCOPE. This module never decides where anyone stands, never reads the Explorer for a decision (the one
// place it touches him at all is playerAt(), a detonation applying physics), never allocates in a tick path,
// and never imports another enemy module — it takes entity-like objects and a ctx, so it is testable on its
// own against the real world.
import { clamp, clamp01, lerp } from '../core/math.js';
import { mulberry32 } from '../core/rng.js';
import { def, WEAPONS, MAGAZINES, ARMOR, AMMO, defaultAmmo } from '../data/index.js';

// =====================================================================================================
// THE CURVE. Merged into mimic.js SKILL by the integrator (see the module header of mimic.js). A recruit at
// the checkpoint reaches 0.05 itemUse and 0 scav: he fights with what is in his hands, bleeds without opening
// the bandage in his own pouch, and walks past a rifle on the ground. An elite deep in the Tide opens the
// AI-2, fits the mask before the gas reaches him, smokes a lane he has been refused twice, and comes up
// holding his dead mate's AKM.
// =====================================================================================================
export const SKILL_ROWS = {
  itemUse: [0.05, 0.95],
  smokeW: [0.00, 0.80],
  scav: [0.00, 0.60],
};

// The gate on each capability, on whichever row owns it. These are thresholds, not probabilities: below the
// number the action does not exist for that mimic, so the difficulty curve is something you can print.
export const GATES = {
  food: 0.15,           // itemUse
  mask: 0.20,
  filter: 0.20,
  light: 0.25,
  battery: 0.25,
  heal: 0.30,
  probe: 0.35,
  clean: 0.40,
  repair: 0.40,
  stim: 0.45,
  armorkit: 0.50,
  binos: 0.55,
  pain: 0.60,
  pick: 0.65,
  smoke: 0.35,          // smokeW
  flare: 0.45,
  fire: 0.55,
  flash: 0.60,
  scavLoose: 0.25,      // scav
  scavArmor: 0.35,
  rearm: 0.45,
};

export const ITEM_GAP = 8.0;        // s between item actions, per mimic. One thing at a time, visibly.
export const SCAV_EVERY = 20.0;     // s between scavenge attempts, per mimic
export const SCAV_R = 7.0;          // m he will divert for a body
export const SCAV_REACH = 2.4;      // m at which he can actually reach into the pile
export const SCAV_TIME = 1.7;       // s crouched over it, not shooting
export const PILE_MAX = 24;         // corpse piles remembered

export const SMOKE = { radius: 8, life: 25, rise: 1.2 };
export const FLASH = { radius: 12, stun: [1.6, 3.2] };
export const FLARE = { life: 70, radius: 26 };
export const THROW_WINDUP = 0.85;   // s from the call to the release
export const TELEGRAPH = 1.0;       // s before the release that the word goes out

const GRAV = 9.8;
const UP = { x: 0, y: 1, z: 0 };
const rng = mulberry32(0x1c1701);

// =====================================================================================================
// The shared per-frame ray budget lives in traversal.js (it sits at the bottom of the import graph). This
// module refuses to import a sibling that four other agents are writing at the same time, so the integrator
// injects it: kit.setRayBudget(losBudget). Until then a local pool of the same shape keeps the tests honest.
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

// The integrator hands this over so a rearm can rebuild what only mimic.js knows how to build: weaponEffects,
// fireProfile, the held mesh. Without it kit.js still does everything it can from the catalogue alone.
let rearmHook = null;
export function setRearmHook(fn) { rearmHook = typeof fn === 'function' ? fn : null; }

export const COUNT = {
  uses: 0, heals: 0, stims: 0, masks: 0, probes: 0, binos: 0, repairs: 0, foods: 0,
  smokes: 0, flashes: 0, flares: 0, throws: 0,
  scavAttempts: 0, scavTakes: 0, scavRefused: 0, rearms: 0, swapsBack: 0, picks: 0,
  rays: 0, piles: 0,
};
export function stats() {
  return Object.assign({}, COUNT, {
    piles: PILES.length, thrown: THROWN.reduce((n, t) => n + (t.live ? 1 : 0), 0),
    clouds: CLOUDS.length, fires: FIRES.length,
  });
}

// =====================================================================================================
// READING THE CURVE. Rows are merged into mimic.js SKILL by the integrator; until that lands (and in a
// standalone test) fall back to interpolating our own row at the mimic's own progress. Nothing in this file
// hard-codes a difficulty number outside SKILL_ROWS and GATES.
// =====================================================================================================
function row(m, key) {
  const s = m && m.skill;
  if (s && typeof s[key] === 'number') return s[key];
  const r = SKILL_ROWS[key]; if (!r) return 0;
  const p = clamp01((s && typeof s.p === 'number') ? s.p : 0);
  return r[0] + (r[1] - r[0]) * p;
}

// =====================================================================================================
// THE CATALOGUE VIEW. What can a human enemy actually DO with a line of src/data/items.js? One pure function,
// so adding an item to a class pool in data/loadouts.js gives it behaviour with no code change here.
// =====================================================================================================
export function actFor(id) {
  const d = def(id); if (!d) return null;
  const k = d.kind;
  if (k === 'med') {
    const e = d.effect || {};
    if (e.stamina) return 'stim';                                   // stim, adrenaline, energy-like
    if (e.painkiller && !e.healOver && (e.heal || 0) <= 8) return 'pain';   // painkillers, morphine
    return 'heal';                                                  // bandage .. surgical kit, antirad
  }
  if (k === 'food') return 'food';
  if (k === 'grenade') return d.smoke ? 'smoke' : d.flash ? 'flash' : d.light ? 'flare' : d.fire ? 'fire' : 'frag';
  if (k === 'battery') return 'battery';
  if (k === 'filter') return 'filter';
  if (k === 'mask') return 'mask';
  if (k === 'headgear') return 'light';
  if (k === 'melee') return 'melee';
  if (k === 'tool') {
    if (id === 'binoculars') return 'binos';
    if (id === 'probe') return 'probe';
    if (id === 'cleankit') return 'clean';
    if (id === 'repairkit') return 'repair';
    if (id === 'armorkit') return 'armorkit';
    if (id === 'lockpick') return 'pick';
    if (d.light) return 'light';
    if (d.detect) return 'detect';
    return null;
  }
  return null;                                       // artifact, mission, key, part: never used, never taken
}
const GATE_OF = { heal: 'heal', pain: 'pain', stim: 'stim', food: 'food', mask: 'mask', filter: 'filter', battery: 'battery', light: 'light', clean: 'clean', repair: 'repair', armorkit: 'armorkit', binos: 'binos', probe: 'probe', pick: 'pick' };
const THROWN_ACTS = { smoke: 1, flash: 1, flare: 1, fire: 1 };
function gateFor(m, act) {
  if (THROWN_ACTS[act]) return row(m, 'smokeW') >= (GATES[act] ?? 1);
  const g = GATE_OF[act]; if (!g) return false;
  return row(m, 'itemUse') >= (GATES[g] ?? 1);
}
export function useTime(id, act) {
  const d = def(id);
  if (d && d.use) return d.use;
  if (act === 'battery' || act === 'filter') return 1.6;
  if (act === 'clean') return 4.0;
  if (act === 'repair') return 3.2;
  if (act === 'armorkit') return 3.6;
  if (act === 'binos') return 2.5;
  if (act === 'pick') return 5.0;
  if (act === 'probe') return 0.9;
  return 1.4;
}
// Every new name has a fallback chain of names the sfx agent has already registered, so the module is audible
// today and better the day the real generators land. audio.play returns null for a name nobody registered.
const KIT_SND = ['mimic_kit', 'stim_use', 'reload_magout'];
const SOUND_OF = {
  heal: ['mimic_heal', 'bandage_use', 'medkit_use'],
  pain: KIT_SND, stim: KIT_SND, food: KIT_SND, mask: KIT_SND, filter: KIT_SND, battery: KIT_SND,
  clean: KIT_SND, repair: KIT_SND, armorkit: KIT_SND, binos: KIT_SND, throw: KIT_SND,
  pick: ['mimic_pick', 'container_open', 'door_open'],
  probe: ['probe_throw'], scav: ['mimic_scav', 'pickup_item', 'container_open'],
};
const PIN_SND = ['grenade_pin', 'click'];
const POP_SND = ['smoke_pop', 'fragment_pop', 'impact_metal'];
const HISS_SND = ['smoke_hiss', 'gas_hiss'];
const BANG_SND = ['flash_bang', 'grenade_explode', 'fragment_explode'];
// play the first name that exists; opts is shared, so this allocates nothing
function playAny(ctx, names, opts) {
  if (!ctx.audio) return null;
  for (let i = 0; i < names.length; i++) { const h = ctx.audio.play(names[i], opts); if (h) return h; }
  return null;
}
function loopAny(ctx, names, opts) {
  if (!ctx.audio || !ctx.audio.loop) return null;
  for (let i = 0; i < names.length; i++) { const h = ctx.audio.loop(names[i], opts); if (h) return h; }
  return null;
}
const _sopts = { pos: null, hrtf: true, gain: 1, max: 60, ref: 4, rate: 1 };
function soundAny(m, names, gain, max, rate) {
  _sopts.pos = m.position; _sopts.hrtf = true; _sopts.gain = gain; _sopts.max = max; _sopts.ref = 4; _sopts.rate = rate || 1;
  return playAny(m.ctx, names, _sopts);
}

// =====================================================================================================
// PER-MIMIC STATE. Allocated once, in the constructor.
// =====================================================================================================
export function createKit(m) {
  const k = m.kit = {
    verb: null, id: null, idx: -1, t: 0, dur: 0,  // the commitment
    cool: 0,                                      // s until the next item action
    scavCool: rng() * SCAV_EVERY,                 // stagger the first attempt across a squad
    pile: null, pileX: 0, pileZ: 0, pileI: -1,    // the body he is walking to
    diverted: false,
    healLeft: 0, healRate: 0, healed: 0,          // heal over time
    painT: 0, steadyT: 0, speedT: 0, speedMul: 1, windMul: 1, windT: 0,
    maskFit: 0,                                   // 0..1 gas protection currently worn
    gasT: 0,                                      // s spent in a field without one (for the tell)
    binoT: 0,
    uses: 0, scavs: 0, rearms: 0, throws: 0,
    said: '', saidT: -1e9,
    throwAct: null, throwId: null, throwIdx: -1, throwCounted: false, throwX: 0, throwZ: 0,
  };
  // a mask already on the webbing is already fitted: he did not put it on because of you
  const worn = m.loadout && m.loadout.kit;
  if (worn) for (let i = 0; i < worn.length; i++) { const d = def(worn[i].id); if (d && d.kind === 'mask') k.maskFit = Math.max(k.maskFit, d.gas || 0.5); }
  return k;
}

export function busy(m) { const k = m.kit; return !!(k && k.verb); }
export function mayFire(m) { const k = m.kit; return !k || !k.verb; }
// Buffs the integrator reads at the call sites it owns. All decay in kitTick; all are honest about their source.
export function aimMul(m) { const k = m.kit; return k && k.steadyT > 0 ? 0.72 : 1; }
export function speedMul(m) { const k = m.kit; return k && k.speedT > 0 ? k.speedMul : 1; }
export function staggerMul(m) { const k = m.kit; return k && k.painT > 0 ? 0.35 : 1; }
export function windRegenMul(m) { const k = m.kit; return k && k.windT > 0 ? k.windMul : 1; }
export function gasProtection(m) { const k = m.kit; return k ? k.maskFit : 0; }
// The gate on the light mimic.js already knows how to switch on: a recruit does not think to use it, and a
// torch coming on in a treeline is one of the loudest things the Explorer can be shown.
export function mayLight(m) { return gateFor(m, 'light'); }
// The glass a marksman is currently behind, for the glint mimic.js already draws.
export function glassing(m) { const k = m.kit; return !!(k && k.binoT > 0); }

// =====================================================================================================
// THE VOICE. command.js owns the vocabulary; kit.js only needs the words that telegraph an item action, and
// it must degrade to something audible when no squad exists. Every item action a player can be hurt by is
// announced BEFORE it happens — that is the fairness clause, and it is what makes smoke read as a decision.
// =====================================================================================================
function say(m, word, gain = 0.8) {
  const k = m.kit; if (k) { k.said = word; k.saidT = m.time; }
  const sq = m.squad;
  try {
    if (sq && sq.mind && typeof sq.mind.say === 'function') { sq.mind.say(word, m); return; }
    if (sq && typeof sq.say === 'function') { sq.say(word, m); return; }
  } catch (e) { /* a squad mid-rebuild is not a reason to go silent */ }
  if (typeof m.sound === 'function') m.sound('mimic_radio', { word, gain, max: 95 });
}

// =====================================================================================================
// THE SCORER. Called ONCE per squad plan tick per man — never per frame. Reads the mimic's own body, its own
// pouches, its orders and the world under its feet. Nothing here reads the Explorer.
//
// It is a priority cascade rather than a weighted sum on purpose: the player has to be able to reconstruct
// why a man dropped out of the fight, and "he was on thirty per cent and nobody had a line on him" is a
// reconstruction. A softmax over eight terms is not.
// =====================================================================================================
const WANT = { id: null, act: null, idx: -1, why: '', tx: 0, tz: 0 };
function want(m, id, act, idx, why, tx, tz) {
  WANT.id = id; WANT.act = act; WANT.idx = idx; WANT.why = why;
  WANT.tx = tx === undefined ? m.position.x : tx; WANT.tz = tz === undefined ? m.position.z : tz;
  return WANT;
}

// index of the first carried item with this act, or -1. `items` is a plain id array on the loadout.
function findAct(m, act) {
  const items = m.loadout && m.loadout.items; if (!items) return -1;
  for (let i = 0; i < items.length; i++) if (actFor(items[i]) === act) return i;
  return -1;
}
// the best healing item he has: the one that restores the most, so he does not open the surgical kit for a graze
function findHeal(m, need) {
  const items = m.loadout && m.loadout.items; if (!items) return -1;
  let best = -1, bs = -1;
  for (let i = 0; i < items.length; i++) {
    const d = def(items[i]); if (!d || actFor(items[i]) !== 'heal') continue;
    const e = d.effect || {};
    const amount = (e.heal || 0) + (e.healOver ? e.healOver[0] : 0);
    // prefer the smallest thing that covers the wound; fall back to the largest he has
    const s = amount >= need ? 1000 - amount : amount;
    if (s > bs) { bs = s; best = i; }
  }
  return best;
}
// the best mask in his pouch that beats what he is already wearing, or -1
function findMaskBetter(m, have) {
  const items = m.loadout && m.loadout.items; if (!items) return -1;
  let best = -1, bg = have;
  for (let i = 0; i < items.length; i++) { const d = def(items[i]); if (!d || d.kind !== 'mask') continue; if ((d.gas || 0.5) > bg) { bg = d.gas || 0.5; best = i; } }
  return best;
}
function hasWorn(m, kind) {
  const worn = m.loadout && m.loadout.kit; if (!worn) return null;
  for (let i = 0; i < worn.length; i++) { const d = def(worn[i].id); if (d && d.kind === kind) return worn[i]; }
  return null;
}
// The gas pads are the one anomaly a man can answer with a piece of kit. Everything else he walks around.
function gasAt(ctx, x, z) {
  const list = ctx.anomalies && ctx.anomalies.list; if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || a.type !== 'gas' || !a.position) continue;
    const r = (a.radius || 6) + 1.5;
    if (Math.abs(a.position.x - x) > r || Math.abs(a.position.z - z) > r) continue;
    if (Math.hypot(a.position.x - x, a.position.z - z) < r) return a;
  }
  return null;
}
// An unrevealed field close enough to the way he is going to be worth a probe. He has walked past these all
// his life; throwing one is not caution, it is habit, and the Explorer gets to watch a field light up.
function fieldAhead(m, ctx, r) {
  const list = ctx.anomalies && ctx.anomalies.list; if (!list || !list.length) return null;
  const t = m.target; if (!t) return null;
  const px = m.position.x, pz = m.position.z;
  let dx = t.x - px, dz = t.z - pz; const d = Math.hypot(dx, dz);
  if (d < 3) return null;
  dx /= d; dz /= d;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || !a.position || a.revealed) continue;
    const ax = a.position.x - px, az = a.position.z - pz;
    const along = ax * dx + az * dz;
    if (along < 2 || along > Math.min(d, r)) continue;
    const off = Math.abs(ax * dz - az * dx);
    if (off < (a.radius || 6) + 2) return a;
  }
  return null;
}
const CALM_STATES = { patrol: 1, watch: 1, idle: 1, suspicious: 1, search: 1 };

export function wantItem(m) {
  const k = m.kit; if (!k || k.verb || k.cool > 0) return null;
  const ctx = m.ctx;
  const lo = m.loadout; if (!lo) return null;
  const hpF = m.maxHp > 0 ? m.hp / m.maxHp : 1;
  const calm = !!CALM_STATES[m.state];
  const noLine = m.time - (m.lastVisT ?? -1e9);       // his own eyes, not the Explorer's position
  const body = m.body;                                 // traversal.js, if it is wired
  const wind = body && typeof body.wind === 'number' ? body.wind : 100;

  // 1. GAS. The one thing that is killing him right now and that a pouch answers. He fits whatever protects
  //    him more than what is already on his face, so a man in a respirator still reaches for the GP-5.
  if (gateFor(m, 'mask') && k.maskFit < 0.99 && gasAt(ctx, m.position.x, m.position.z)) {
    const mask = hasWorn(m, 'mask');
    if (mask && (def(mask.id).gas || 0.5) > k.maskFit) return want(m, mask.id, 'mask', -1, 'gas');
    const i = findMaskBetter(m, k.maskFit); if (i >= 0) return want(m, lo.items[i], 'mask', i, 'gas');
  }
  // a fitted mask with a dead filter is a face full of nothing
  if (gateFor(m, 'filter') && k.maskFit >= 0.5) {
    const mask = hasWorn(m, 'mask');
    if (mask && (mask.charge ?? 100) <= 0) { const i = findAct(m, 'filter'); if (i >= 0) return want(m, lo.items[i], 'filter', i, 'filter'); }
  }
  // 2. WOUNDS. Only behind something, and only when nobody has had a line on him for two seconds. This is a
  //    real window in the fight and it is announced, because a man who drops out has to be exploitable.
  if (gateFor(m, 'heal') && hpF < 0.45 && (calm || noLine > 2.0)) {
    const i = findHeal(m, (1 - hpF) * m.maxHp);
    if (i >= 0) return want(m, lo.items[i], 'heal', i, 'hurt');
  }
  // 3. PAIN. Nothing left to close the hole with: take the edge off and keep shooting.
  if (gateFor(m, 'pain') && hpF < 0.32 && k.painT <= 0) {
    const i = findAct(m, 'pain'); if (i >= 0) return want(m, lo.items[i], 'pain', i, 'pain');
  }
  // 4. WIND. About to cross open ground with nothing left in the legs.
  if (gateFor(m, 'stim') && wind < 22 && (calm || (m.orders && m.orders.mv === 1) || m.state === 'fallback')) {
    const i = findAct(m, 'stim'); if (i >= 0) return want(m, lo.items[i], 'stim', i, 'blown');
  }
  // 5. SMOKE, on his own account. command.js orders it properly; a loner who is losing and has one asks for it
  //    himself, which is the difference between breaking contact and dying in a hole.
  if (gateFor(m, 'smoke') && (m.state === 'fallback' || (m.morale ?? 1) < 0.4) && noLine < 6) {
    const g = findThrowable(m, 'smoke');
    if (g) {
      // between him and the last place he had you, not on top of you: smoke is a wall, not a weapon
      const b = m.lastSeenPlayer;
      const bx = b ? b.x : m.position.x, bz = b ? b.z : m.position.z;
      const dx = bx - m.position.x, dz = bz - m.position.z, dd = Math.max(0.001, Math.hypot(dx, dz));
      const s2 = Math.min(dd * 0.6, 12);
      return want(m, g.id, 'smoke', g.idx, 'break', m.position.x + (dx / dd) * s2, m.position.z + (dz / dd) * s2);
    }
  }
  // ---- out of contact only, in rough order of how much it matters ----
  if (!calm) return null;
  // 6. FIELD MAINTENANCE. A scavenged rifle is often a jammed, fouled one; the kit in his own pouch fixes it.
  if (gateFor(m, 'repair') && m.weapon && (m.weapon.jammed || minPart(m.weapon) < 45)) {
    const i = findAct(m, 'repair'); if (i >= 0) return want(m, lo.items[i], 'repair', i, 'broken');
  }
  if (gateFor(m, 'clean') && m.weapon && (m.weapon.dirt || 0) > 0.55) {
    const i = findAct(m, 'clean'); if (i >= 0) return want(m, lo.items[i], 'clean', i, 'fouled');
  }
  if (gateFor(m, 'armorkit') && armorWorn(m) > 0 && armorLeft(m) < 0.5) {
    const i = findAct(m, 'armorkit'); if (i >= 0) return want(m, lo.items[i], 'armorkit', i, 'plates');
  }
  // 7. BATTERIES. A torch, a lamp or a set of tubes with nothing in them, and a night to get through.
  if (gateFor(m, 'battery')) {
    const g = deadLight(m);
    if (g && (ctx.time?.night ?? 0) > 0.35) { const i = findAct(m, 'battery'); if (i >= 0) return want(m, lo.items[i], 'battery', i, 'dark'); }
  }
  // 8. FOOD AND WATER. Not a mechanic the Explorer fights, but it is what a man on a twelve-hour picket does,
  //    and it is another second he is not holding the rifle when you come over the rise.
  if (gateFor(m, 'food') && (hpF < 0.82 || wind < 62) && k.uses < 6) {
    const i = findAct(m, 'food'); if (i >= 0) return want(m, lo.items[i], 'food', i, 'rations');
  }
  // 9. GLASS. A marksman on a long seat with nothing to shoot at glasses the ground — and the glint is a tell
  //    the Explorer already knows how to read.
  if (gateFor(m, 'binos') && (m.role === 'sniper' || (m.orders && m.orders.role === 'overwatch'))
      && (m.moveSpeed ?? 0) < 0.2 && noLine > 8) {
    const i = findAct(m, 'binos'); if (i >= 0) return want(m, lo.items[i], 'binos', i, 'glassing');
  }
  // 10. LOCKS. Somebody got here first, and it was not the Explorer. He takes nothing; he just opens it.
  if (gateFor(m, 'pick')) {
    const c = nearestLocked(m.position.x, m.position.z, SCAV_REACH);
    if (c) { const i = findAct(m, 'pick'); if (i >= 0) return want(m, lo.items[i], 'pick', i, 'locked', c.x, c.z); }
  }
  // 11. PROBES. He knows this ground. He still throws one before he walks into it.
  if (gateFor(m, 'probe')) {
    const a = fieldAhead(m, ctx, 26);
    if (a) { const i = findAct(m, 'probe'); if (i >= 0) return want(m, lo.items[i], 'probe', i, 'field', a.position.x, a.position.z); }
  }
  return null;
}
function minPart(w) { const p = w && w.parts; if (!p) return 100; return Math.min(p.barrel ?? 100, p.bolt ?? 100, p.frame ?? 100); }
function armorWorn(m) { const lo = m.loadout; return (lo.vest ? 1 : 0) + (lo.helmet ? 1 : 0); }
function armorLeft(m) {
  const lo = m.loadout; let sum = 0, n = 0;
  for (const g of [lo.vest, lo.helmet]) { if (!g) continue; const d = ARMOR[g.id]; if (!d) continue; sum += clamp01((g.durability ?? d.durability) / (d.durability || 1)); n++; }
  return n ? sum / n : 1;
}
function deadLight(m) {
  const worn = m.loadout && m.loadout.kit; if (!worn) return null;
  for (let i = 0; i < worn.length; i++) { const d = def(worn[i].id); if (d && (d.light || d.nvg) && (worn[i].charge ?? 100) <= 0) return worn[i]; }
  return null;
}
// A throwable of this kind that he actually has. Grenades live in two places: the loadout's counted grenade,
// and anything on the pocket-litter list. Scavenged ones are deliberately NOT here — see the header.
const THROWABLE = { id: null, idx: -1, counted: false };
export function findThrowable(m, act) {
  const lo = m.loadout; if (!lo) return null;
  if ((lo.grenades | 0) > 0 && actFor(lo.grenadeId) === act) { THROWABLE.id = lo.grenadeId; THROWABLE.idx = -1; THROWABLE.counted = true; return THROWABLE; }
  const items = lo.items; if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    if (actFor(items[i]) !== act) continue;
    THROWABLE.id = items[i]; THROWABLE.idx = i; THROWABLE.counted = false; return THROWABLE;
  }
  return null;
}
export function hasThrowable(m, act) { return !!findThrowable(m, act); }

// =====================================================================================================
// THE COMMITMENT. Beginning a use costs the man his rifle for the duration: kitTick returns true and the
// integrator's tick() must not fire, aim or reload through it. A mimic with his hands in a pouch is a free
// target, and that price is exactly what makes the capability fair.
// =====================================================================================================
export function beginUse(m, id, act, idx = -1, tx, tz) {
  const k = m.kit; if (!k || k.verb) return false;
  if (!act) act = actFor(id); if (!act) return false;
  if (!gateFor(m, act)) return false;
  // a thrown act is not a pouch action: it has a windup, a word and an arc, and throwKit owns all three
  if (THROWN_ACTS[act]) return throwKit(m, act, tx === undefined ? m.position.x : tx, tz === undefined ? m.position.z : tz);
  k.verb = act; k.id = id; k.t = 0; k.dur = useTime(id, act); k.idx = idx;
  k.throwX = tx === undefined ? m.position.x : tx; k.throwZ = tz === undefined ? m.position.z : tz;
  k.burstSaved = m.burstLeft || 0;
  m.burstLeft = 0; m.aiming = false;
  const snd = SOUND_OF[act];
  if (snd) soundAny(m, snd, act === 'heal' ? 0.62 : 0.5, act === 'heal' ? 30 : 24);
  // a man dropping out of the fight tells the others, because they have to cover the hole he leaves
  if (act === 'heal' || act === 'pain') say(m, 'hold', 0.55);
  COUNT.uses++; k.uses++;
  return true;
}

// Act on whatever wantItem() just returned, in one call. This is the shape the plan tick wants.
export function useWanted(m, w) { return w ? beginUse(m, w.id, w.act, w.idx, w.tx, w.tz) : false; }

// The clock. Returns true while the kit owns the frame.
export function kitTick(m, dt) {
  const k = m.kit; if (!k) return false;
  if (k.cool > 0) k.cool -= dt;
  if (k.painT > 0) k.painT -= dt;
  if (k.steadyT > 0) k.steadyT -= dt;
  if (k.speedT > 0) k.speedT -= dt;
  if (k.windT > 0) k.windT -= dt;
  if (k.binoT > 0) k.binoT -= dt;
  if (k.healLeft > 0) {
    const h = Math.min(k.healLeft, k.healRate * dt);
    k.healLeft -= h; k.healed += h;
    m.hp = Math.min(m.maxHp, m.hp + h);
  }
  // gas burn, and the mask that answers it
  const gas = gasAt(m.ctx, m.position.x, m.position.z);
  // a respirator halves the burn; a GP-5 stops it. The pad is a wall to them as well as to the Explorer,
  // and a mimic who fitted his mask can hold a piece of ground the Explorer cannot.
  if (gas) { k.gasT += dt; if (k.gasT > 1.2) { k.gasT = 0; const d2 = 2 * (1 - clamp01(k.maskFit)); if (d2 > 0.01 && typeof m.damage === 'function') m.damage(d2, { kind: 'burn' }); } }
  else k.gasT = 0;
  if (!k.verb) return false;
  k.t += dt;
  if (k.t < k.dur) return true;
  const id = k.id, act = k.verb, idx = k.idx;
  k.verb = null; k.id = null; k.t = 0; k.idx = -1;
  k.cool = ITEM_GAP;
  finishUse(m, id, act, idx);
  return true;                                   // the frame he stands up is still his, not the rifle's
}

// Consume and apply. THE HONESTY RULE lives here: what he used comes out of the loadout, so the drop is
// smaller and every item use is visible in the pile afterwards.
function finishUse(m, id, act, idx) {
  const k = m.kit, lo = m.loadout, ctx = m.ctx;
  if (act === 'throw') { releaseThrow(m); return; }
  if (act === 'scav') { finishScavenge(m); return; }
  const d = def(id) || {};
  const e = d.effect || {};
  // ---- consume ----
  if (idx >= 0 && lo.items && lo.items[idx] === id) lo.items.splice(idx, 1);
  else if (idx >= 0 && lo.items) { const i = lo.items.indexOf(id); if (i >= 0) lo.items.splice(i, 1); }
  // ---- apply ----
  switch (act) {
    case 'heal': {
      if (e.heal) { m.hp = Math.min(m.maxHp, m.hp + e.heal); k.healed += e.heal; }
      if (e.healOver) { k.healLeft += e.healOver[0]; k.healRate = e.healOver[0] / Math.max(0.5, e.healOver[1]); }
      if (e.painkiller) k.painT = Math.max(k.painT, e.painkiller);
      m.hurtT = -1e9;                       // he has dealt with it; the wound stops driving his morale
      if (typeof m.morale === 'number') m.morale = Math.min(1, m.morale + 0.15);
      COUNT.heals++;
      break;
    }
    case 'pain': { k.painT = Math.max(k.painT, e.painkiller || 60); if (e.heal) m.hp = Math.min(m.maxHp, m.hp + e.heal); break; }
    case 'stim': {
      if (m.body) m.body.wind = 100, m.body.blown = false;
      if (e.heal) m.hp = Math.min(m.maxHp, m.hp + e.heal);
      if (e.speedFor) { k.speedT = e.speedFor[0]; k.speedMul = e.speedFor[1]; }
      COUNT.stims++;
      break;
    }
    case 'food': {
      if (e.stamina && m.body) m.body.wind = Math.min(100, (m.body.wind || 0) + e.stamina);
      if (e.staminaRegen) { k.windT = e.staminaRegen[0]; k.windMul = e.staminaRegen[1]; }
      if (e.healOver) { k.healLeft += e.healOver[0]; k.healRate = e.healOver[0] / Math.max(0.5, e.healOver[1]); }
      if (e.steady) k.steadyT = e.steady;
      COUNT.foods++;
      break;
    }
    case 'mask': {
      // a mask already on the webbing is fitted, not spent; one out of the pouch was consumed above
      const md = def(id) || {};
      k.maskFit = Math.max(k.maskFit, md.gas || 0.5);
      COUNT.masks++;
      break;
    }
    case 'filter': { const worn = hasWorn(m, 'mask'); if (worn) worn.charge = (def(id) || {}).charge || 100; break; }
    case 'battery': { const g = deadLight(m); if (g) g.charge = 100; break; }
    case 'clean': { if (m.weapon) { m.weapon.dirt = 0; m.weapon.jammed = false; } spendUses(lo, id, idx); COUNT.repairs++; break; }
    case 'repair': {
      const w = m.weapon;
      if (w && w.parts) { const amt = d.repair || 35; w.parts.barrel = Math.min(100, w.parts.barrel + amt); w.parts.bolt = Math.min(100, w.parts.bolt + amt); w.parts.frame = Math.min(100, w.parts.frame + amt); w.jammed = false; }
      spendUses(lo, id, idx); COUNT.repairs++;
      break;
    }
    case 'armorkit': {
      const amt = d.repair || 40;
      for (const g of [lo.vest, lo.helmet]) { if (!g) continue; const ad = ARMOR[g.id]; if (!ad) continue; g.durability = Math.min(ad.durability, (g.durability ?? 0) + amt); }
      spendUses(lo, id, idx); COUNT.repairs++;
      break;
    }
    case 'binos': { k.binoT = 6; COUNT.binos++; if (m.glint) m.glint.visible = true; break; }
    case 'pick': {
      const c = nearestLocked(k.throwX, k.throwZ, 3.0);
      if (c && c.o) { c.o.locked = false; c.o.forced = true; COUNT.picks++; }
      spendUses(lo, id, idx);
      break;
    }
    case 'probe': {
      // the probe is thrown, not swallowed: it flies, it lands, and what it lands in lights up
      throwThing(m, 'probe', id, k.throwX, k.throwZ);
      COUNT.probes++;
      break;
    }
    default: break;
  }
}
// tools with `uses` are spent a use at a time; only the last use takes the item out of the pouch
function spendUses(lo, id, idx) {
  const d = def(id); if (!d || !d.uses) return;
  if (!lo.__uses) lo.__uses = {};
  const left = (lo.__uses[id] ?? d.uses) - 1;
  lo.__uses[id] = left;
  if (left > 0 && lo.items && lo.items.indexOf(id) < 0) lo.items.push(id);      // put it back: it is not finished
}

// =====================================================================================================
// THROWN KIT. Smoke, flash, flare, incendiary and the probe, on one arc. Frags stay where they are — squad.js
// decides those and mimic.js throws them, and two grenade systems arguing over one cooldown is how a squad
// ends up putting three in the same hole.
//
// Everything here is announced a full second before the arm comes back. `flush` is a word the Explorer can
// learn in two contacts, and once he has learned it the smoke is a decision he gets to answer.
// =====================================================================================================
export function throwKit(m, act, tx, tz) {
  const k = m.kit; if (!k || k.verb) return false;
  if (!gateFor(m, act)) return false;
  const g = findThrowable(m, act); if (!g) return false;
  if ((m.stunned || 0) > 0 || !m.alive) return false;
  k.verb = 'throw'; k.t = 0; k.dur = THROW_WINDUP;
  k.throwAct = act; k.throwId = g.id; k.throwIdx = g.idx; k.throwCounted = g.counted;
  k.throwX = tx; k.throwZ = tz;
  m.burstLeft = 0; m.aiming = false;
  say(m, act === 'flash' || act === 'smoke' ? 'flush' : 'moving', 0.9);
  soundAny(m, PIN_SND, 0.7, 40, 0.85);
  COUNT.throws++; k.throws++;
  return true;
}
function releaseThrow(m) {
  const k = m.kit, lo = m.loadout;
  const act = k.throwAct, id = k.throwId;
  k.throwAct = null; k.throwId = null;
  if (k.throwCounted) { lo.grenades = Math.max(0, (lo.grenades | 0) - 1); }
  else if (k.throwIdx >= 0 && lo.items) { const i = lo.items.indexOf(id); if (i >= 0) lo.items.splice(i, 1); }
  throwThing(m, act, id, k.throwX, k.throwZ);
  k.cool = ITEM_GAP;
  if (act === 'smoke') COUNT.smokes++; else if (act === 'flash') COUNT.flashes++; else if (act === 'flare') COUNT.flares++;
}

// pooled projectiles: a dozen is far more than a firefight ever needs
const THROWN = [];
for (let i = 0; i < 12; i++) THROWN.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, act: '', id: '', src: null, ctx: null, rest: 0, hiss: null });
function throwThing(m, act, id, tx, tz) {
  const ctx = m.ctx;
  let t = null;
  for (let i = 0; i < THROWN.length; i++) if (!THROWN[i].live) { t = THROWN[i]; break; }
  if (!t) return null;
  const d = def(id) || {};
  const fromX = m.position.x - Math.sin(m.yaw) * 0.4, fromZ = m.position.z - Math.cos(m.yaw) * 0.4;
  const fromY = m.position.y + (m.height || 1.85) * 0.78;
  const ty = ctx.world.getHeight(tx, tz);
  const dx = tx - fromX, dz = tz - fromZ, dist = Math.max(0.5, Math.hypot(dx, dz));
  const dy = ty - fromY;
  const ang = 42 * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  let v = Math.sqrt(Math.max(1, (GRAV * dist * dist) / (2 * ca * ca * Math.max(0.5, dist * Math.tan(ang) - dy))));
  v = clamp(v * (0.97 + rng() * 0.06), 4, 20);
  t.live = true; t.act = act; t.id = id; t.src = m; t.ctx = ctx; t.rest = 0;
  t.x = fromX; t.y = fromY; t.z = fromZ;
  t.vx = (dx / dist) * v * ca; t.vy = v * sa; t.vz = (dz / dist) * v * ca;
  t.fuse = act === 'probe' ? 1e9 : (d.fuse || 2.0);
  if (act === 'probe') soundAny(m, SOUND_OF.probe, 0.5, 30);
  return t;
}
function stepThrown(t, dt) {
  const w = t.ctx.world;
  if (t.rest <= 0) {
    t.vy -= GRAV * dt;
    t.x += t.vx * dt; t.y += t.vy * dt; t.z += t.vz * dt;
    const gy = w.getHeight(t.x, t.z);
    if (t.y <= gy + 0.05) {
      t.y = gy + 0.05;
      if (t.vy < -1.4) { t.vy = -t.vy * 0.32; t.vx *= 0.55; t.vz *= 0.55; }
      else { t.vx *= 0.8; t.vz *= 0.8; t.vy = 0; if (Math.hypot(t.vx, t.vz) < 0.35) { t.rest = 1; t.vx = t.vz = 0; if (t.act === 'probe') { landProbe(t); return true; } } }
    }
  }
  t.fuse -= dt;
  if (t.fuse <= 0) { detonate(t); return true; }
  return false;
}
function landProbe(t) {
  const ctx = t.ctx;
  playAny(ctx, ['probe_land', 'impact_metal'], { pos: { x: t.x, y: t.y, z: t.z }, hrtf: true, gain: 0.5, max: 40 });
  const list = ctx.anomalies && ctx.anomalies.list;
  if (list) for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (!a || !a.position) continue;
    if (Math.hypot(a.position.x - t.x, a.position.z - t.z) < (a.radius || 6) && typeof a.reveal === 'function') a.reveal();
  }
}

// ---- clouds and fires the world has to live with, including the men who threw them ----
const CLOUDS = [];      // { rec (the entry in world.smoke), hiss, ctx }
const FIRES = [];       // { x, z, r, dps, t, ctx }
let flashBlur = 0, flashCtx = null;

function detonate(t) {
  const ctx = t.ctx, d = def(t.id) || {};
  const pos = { x: t.x, y: t.y + 0.1, z: t.z };
  if (t.act === 'smoke') {
    const rec = { position: { x: pos.x, y: pos.y + SMOKE.rise, z: pos.z }, radius: d.radius || SMOKE.radius, t: d.smoke || SMOKE.life };
    ctx.world.smoke.push(rec);
    const hiss = loopAny(ctx, HISS_SND, { pos: rec.position, hrtf: true, gain: 0.5, max: 60 });
    CLOUDS.push({ rec, hiss, ctx });
    playAny(ctx, POP_SND, { pos, hrtf: true, gain: 0.8, max: 120 });
    if (ctx.vfx) ctx.vfx.smoke(pos, UP, 18, [0.62, 0.61, 0.58], 1.6, 4.0, 0.6);
    ctx.director?.noteActivity?.(pos, 'noise', 0.4);
  } else if (t.act === 'flash') {
    flashBang(ctx, pos, d.radius || FLASH.radius, t.src);
  } else if (t.act === 'flare') {
    FIRES.push({ x: pos.x, z: pos.z, r: 0, dps: 0, t: (d.light ? d.light[0] : FLARE.life), ctx, light: true, blink: 0 });
    playAny(ctx, ['probe_trigger', 'arc_zap'], { pos, hrtf: true, gain: 0.5, max: 90, rate: 0.7 });
  } else if (t.act === 'fire') {
    const f = d.fire || [20, 14];
    FIRES.push({ x: pos.x, z: pos.z, r: d.radius || 4, dps: f[0], t: f[1], ctx, light: false, blink: 0 });
    playAny(ctx, ['grenade_explode', 'fragment_explode'], { pos, hrtf: true, gain: 0.7, max: 180, rate: 0.75 });
    if (ctx.vfx) ctx.vfx.explosion(pos, d.radius || 4, 0xff8a3c);
  }
}

// The one place in this file that touches the Explorer. It is physics — the same licence mimic.js's hitTest
// and damage() hold — and never a decision: nothing it reads reaches a belief, an order or a score.
function playerAt(ctx) { return ctx.player; }

function flashBang(ctx, pos, radius, src) {
  playAny(ctx, BANG_SND, { pos, hrtf: true, gain: 1.0, max: 260, ref: 8 });
  if (ctx.vfx) { ctx.vfx.light(pos, 0xffffff, 260, 0.16, radius * 7); ctx.vfx.spark(pos, UP, 14, [1, 1, 1]); }
  const list = ctx.enemies && ctx.enemies.list;
  if (list) for (let i = 0; i < list.length; i++) {
    const e = list[i]; if (!e || !e.alive) continue;
    const d = Math.hypot(e.position.x - pos.x, e.position.z - pos.z);
    if (d > radius) continue;
    if (typeof e.eyePos === 'function') { e.eyePos(_eye); if (!ctx.world.lineOfSight(_eye, pos)) continue; }
    e.stunned = Math.max(e.stunned || 0, lerp(FLASH.stun[0], FLASH.stun[1], 1 - d / radius));
  }
  const p = playerAt(ctx);
  if (p && !p.dead) {
    const d = Math.hypot(p.position.x - pos.x, p.position.z - pos.z);
    if (d < radius && ctx.world.lineOfSight(p.eye, pos)) {
      const k = 1 - d / radius;
      ctx.post?.flash?.(clamp01(0.55 + k * 0.6));
      flashBlur = Math.max(flashBlur, lerp(FLASH.stun[0], FLASH.stun[1], k));
      flashCtx = ctx;
    }
  }
}
const _eye = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } };

// =====================================================================================================
// SCAVENGING
// =====================================================================================================
// The registry. game/loot.js exposes no public list of piles and is outside this partition, so kit.js keeps
// its own and it is fed from exactly one place: mimic.js's own death, handing over the pile it just spawned.
// That is the whole safe set — mimic corpses, nothing else — and it needs no change to game/loot.js at all.
const PILES = [];
export function registerCorpsePile(o, x, z) {
  if (!o || !o.pile) return null;
  const rec = { o, x, z, t: 0, taken: 0 };
  PILES.push(rec);
  while (PILES.length > PILE_MAX) PILES.shift();
  COUNT.piles++;
  return rec;
}
export function pileCount() { return PILES.length; }
export function nearestPile(x, z, r = SCAV_R) {
  let best = null, bd = r;
  for (let i = 0; i < PILES.length; i++) {
    const p = PILES[i]; if (!usable(p)) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
// The hard exclusions. Every one of these is a way the Explorer could lose something that was theirs.
function usable(p) {
  const o = p && p.o; if (!o || !o.pile) return false;
  if (o.markerKind !== 'corpse') return false;         // containers, caches, dropped kit: never
  if (o.cacheId) return false;                          // an Explorer's death cache is not salvage
  if (o.searched || o.opened || o.emptied) return false; // the Explorer has already been here
  if (o.dead || !o.pile.entries || !o.pile.entries.length) return false;
  return true;
}

// Is this entry safe to take, and is it worth taking? Returns a score, or -1 for "leave it".
// Artifacts and mission objects are refused unconditionally: they are the Explorer's contract, not salvage.
function scoreEntry(m, e, sc) {
  if (!e || !e.id) return -1;
  const d = def(e.id); if (!d) return -1;
  const kind = d.kind;
  if (kind === 'artifact' || kind === 'mission' || kind === 'key') return -1;
  if (e.kind === 'weapon') {
    if (sc < GATES.rearm) return -1;
    if (m.kit.rearms > 0) return -1;                        // one rearm a life. He is not running a shop.
    const nw = WEAPONS[e.id], cw = WEAPONS[m.weapon ? m.weapon.id : ''];
    if (!nw || !cw) return -1;
    if (e.inst && (e.inst.jammed || minPart(e.inst) < 30)) return -1;   // he can see it is scrap
    const gain = (nw.rank || 1) - (cw.rank || 1) + (nw.price - cw.price) / 6000;
    return gain > 0.35 ? 60 + gain * 8 : -1;
  }
  if (e.kind === 'mag') {
    if (sc < GATES.scavLoose) return -1;
    const md = MAGAZINES[e.id]; if (!md) return -1;
    const wd = m.weapon ? WEAPONS[m.weapon.id] : null; if (!wd) return -1;
    if (!md.fits || md.fits.indexOf(wd.family) < 0) return -1;          // it does not fit his rifle
    if (md.clip) return -1;                                             // stripper clips: not worth the fumble
    const rounds = e.inst ? (e.inst.rounds | 0) : 0;
    if (rounds <= 0) return -1;
    return 40 + Math.min(20, rounds * 0.5);
  }
  if (e.kind === 'gear') {
    const ad = ARMOR[e.id];
    if (ad && (ad.kind === 'vest' || ad.kind === 'helmet')) {
      if (sc < GATES.scavArmor) return -1;
      const slot = ad.kind;
      if (m.loadout[slot]) return -1;                                   // only if he is bare there
      const left = e.inst ? clamp01((e.inst.durability ?? ad.durability) / (ad.durability || 1)) : 1;
      if (left < 0.35) return -1;                                       // a carrier that stopped a magazine
      return 30 + (ad.cls || 2) * 3;
    }
    if (sc < GATES.scavLoose) return -1;
    return 8;                                                            // rigs, packs, masks, tubes: worth a grab
  }
  if (e.kind === 'item') {
    if (sc < GATES.scavLoose) return -1;
    const act = actFor(e.id);
    if (act === 'heal' && findAct(m, 'heal') < 0) return 20;
    if (act === 'melee' && !bestMelee(m)) return 14;
    if (AMMO[e.id]) {
      const wd = m.weapon ? WEAPONS[m.weapon.id] : null;
      return wd && AMMO[e.id].cal === wd.cal ? 18 : -1;
    }
    if (act === 'frag' || act === 'smoke' || act === 'flash') return 10;
    if (act) return 4;
    return -1;
  }
  return -1;
}

// Locked containers, for the one item in the catalogue that has nothing to do with a fight. The integrator
// feeds these from game/loot.js's registerContainer; until it does, the capability is inert rather than wrong.
// Forcing one TAKES NOTHING — it is texture, not theft: the Explorer walks up on a locker somebody else got
// to first, with everything still in it.
const LOCKED = [];
export function registerContainer(o, x, z) {
  if (!o || !o.pile) return null;
  const rec = { o, x, z };
  LOCKED.push(rec);
  while (LOCKED.length > PILE_MAX) LOCKED.shift();
  return rec;
}
export function nearestLocked(x, z, r) {
  let best = null, bd = r;
  for (let i = 0; i < LOCKED.length; i++) {
    const c = LOCKED[i]; if (!c.o || !c.o.locked) continue;
    const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; }
  }
  return best;
}
export function lockedCount() { let n = 0; for (const c of LOCKED) if (c.o && c.o.locked) n++; return n; }

// One attempt per mimic per SCAV_EVERY seconds, out of contact, within reach of a body he is already near.
// Returns true if the kit owns the frame (he is crouched over it).
export function scavengeTick(m, dt, opts) {
  const k = m.kit; if (!k || !m.alive) return false;
  if (k.verb) return false;
  if (k.scavCool > 0) { k.scavCool -= dt; return false; }
  const sc = row(m, 'scav');
  if (sc < GATES.scavLoose) { k.scavCool = SCAV_EVERY; return false; }
  const st = m.state;
  const ok = !!CALM_STATES[st] || st === 'fallback' || (m.orders && m.orders.job === 'breakoff');
  if (!ok || (m.stunned || 0) > 0) { k.scavCool = 3; return false; }
  COUNT.scavAttempts++;
  const p = nearestPile(m.position.x, m.position.z, SCAV_R);
  if (!p) { k.scavCool = SCAV_EVERY * 0.5; return false; }
  const d = Math.hypot(p.x - m.position.x, p.z - m.position.z);
  if (d > SCAV_REACH) {
    // walk over: only if he is not already going somewhere that matters, and only out of contact
    const move = !opts || opts.move !== false;
    if (move && !m.target && CALM_STATES[st] && typeof m.setTarget === 'function') {
      _pt.x = p.x; _pt.y = m.ctx.world.getHeight(p.x, p.z); _pt.z = p.z;
      m.setTarget(_pt); k.diverted = true;
    }
    k.scavCool = 1.2;
    return false;
  }
  // he is standing over it. Pick the best entry he can justify, with one budgeted look at the pile.
  const entries = p.o.pile.entries;
  let bi = -1, bs = 0;
  for (let i = 0; i < entries.length; i++) { const s = scoreEntry(m, entries[i], sc); if (s > bs) { bs = s; bi = i; } }
  if (bi < 0) { k.scavCool = SCAV_EVERY; COUNT.scavRefused++; return false; }
  if (!budget(m.ctx, 1)) { k.scavCool = 0.5; return false; }
  COUNT.rays++;
  k.pile = p; k.pileI = bi;
  k.verb = 'scav'; k.id = null; k.t = 0; k.dur = SCAV_TIME; k.idx = -1;
  m.burstLeft = 0; m.aiming = false;
  soundAny(m, SOUND_OF.scav, 0.5, 26);
  if (k.diverted) { k.diverted = false; if (typeof m.setTarget === 'function') m.setTarget(null); }
  return true;
}

function finishScavenge(m) {
  const k = m.kit;
  const p = k.pile, i = k.pileI;
  k.pile = null; k.pileI = -1;
  k.scavCool = SCAV_EVERY;
  if (!p || !usable(p)) return;
  const entries = p.o.pile.entries;
  if (i < 0 || i >= entries.length) return;
  const e = entries[i];
  if (scoreEntry(m, e, row(m, 'scav')) < 0) return;      // the world moved while he was reaching
  takeEntry(m, p, i);
}

// THE MOVE. Take one entry out of a pile and put it somewhere it is guaranteed to come back from.
// Every branch either registers the entry in loadout.scavenged (drops at 1.0) or puts an equivalent entry
// back into the same pile. Nothing leaves the world.
export function takeEntry(m, p, i) {
  const lo = m.loadout, k = m.kit;
  const entries = p.o.pile.entries;
  const e = entries[i];
  if (!e) return false;
  entries.splice(i, 1);
  p.taken++;
  // keep game/loot.js's own bookkeeping honest without lying to the Explorer's map: `emptied` is a fact,
  // `searched` is a claim about who has been here, and it was not the Explorer.
  p.o.emptied = !entries.length;
  const sc = scavenged(lo);
  if (e.kind === 'weapon' && e.inst) {
    const old = m.weapon;
    rearm(m, e.inst);
    sc.push(e);                                     // the new rifle drops at 1.0, because it is not his issue
    // the swap is a swap: his own gun goes down on the same body. Entry for entry, the world is unchanged,
    // and the Explorer walks up on a Makarov lying across a man who was carrying an AKM an hour ago.
    if (old && old !== e.inst) { entries.push({ kind: 'weapon', inst: old, id: old.id, count: 1 }); COUNT.swapsBack++; p.o.emptied = false; }
    COUNT.scavTakes++;
    return true;
  }
  if (e.kind === 'mag' && e.inst) {
    if (!lo.mags) lo.mags = [];
    lo.mags.push(e.inst);                           // usable: he will load it, which is the point of taking it
    sc.push(e);                                     // and it comes back, magazine for magazine
    COUNT.scavTakes++;
    return true;
  }
  if (e.kind === 'gear' && e.inst) {
    const ad = ARMOR[e.id];
    if (ad && (ad.kind === 'vest' || ad.kind === 'helmet')) {
      lo[ad.kind] = e.inst;
      if (m.pieces) m.pieces.push({ def: ad, inst: e.inst, slot: ad.kind });
    } else {
      if (!lo.kit) lo.kit = [];
      lo.kit.push(e.inst);
      const gd = def(e.id);
      if (gd && gd.kind === 'mask') k.maskFit = Math.max(k.maskFit, gd.gas || 0.5);
    }
    sc.push(e);
    COUNT.scavTakes++;
    return true;
  }
  // items: carried, never consumed. He is holding your medkit; you have to take it off him.
  sc.push(e);
  COUNT.scavTakes++;
  return true;
}
function scavenged(lo) { if (!lo.scavenged) lo.scavenged = []; return lo.scavenged; }
const _pt = { x: 0, y: 0, z: 0 };

// Swap the weapon he is firing. The entity fires exactly what it drops, so this has to move the instance into
// the loadout as well as the mimic, and then rebuild everything mimic.js derives from a weapon. Only mimic.js
// knows how to do that last part (weaponEffects, fireProfile, buildGun), so the integrator hands it over
// through setRearmHook; kit.js does everything the catalogue alone can do, so a rearm is never half-applied.
export function rearm(m, w) {
  if (!w || !WEAPONS[w.id]) return false;
  const lo = m.loadout;
  const wd = WEAPONS[w.id];
  lo.weapon = w;
  m.weapon = w;
  m.wdef = wd;
  m.magCap = w.mag ? (MAGAZINES[w.mag.id]?.cap || 30) : (wd.internal || 6);
  // whatever is actually in it, and failing that the plain load for the calibre. A mimic must never end up
  // holding a rifle and believing it is feeding the last gun's rounds into it.
  let ammoId = (w.mag && w.mag.ammo) || w.chamber || (w.tube && w.tube.length ? w.tube[w.tube.length - 1] : null);
  if (!ammoId || !AMMO[ammoId] || AMMO[ammoId].cal !== wd.cal) ammoId = defaultAmmo(wd.cal);
  if (ammoId && AMMO[ammoId]) { m.ammoId = ammoId; m.ammo = AMMO[ammoId]; lo.ammoId = ammoId; }
  m.shotNames = [`shot_${w.id}`, `shot_${wd.build || w.id}`, 'shot_akm'];
  // spare magazines that no longer fit anything are still carried (and still dropped); they are just dead weight
  m.kit.rearms++; COUNT.rearms++;
  if (rearmHook) { try { rearmHook(m, w); } catch (e) { console.warn('kit.rearm hook failed', e); } }
  say(m, 'set', 0.6);
  soundAny(m, ['weapon_draw'], 0.6, 30);
  return true;
}

// The best melee item he is carrying, for traversal.js's takedown to use a real number rather than a constant.
export function bestMelee(m) {
  const lo = m.loadout; if (!lo) return null;
  let best = null, bd = 0;
  const scan = (id) => { const d = def(id); if (!d || d.kind !== 'melee') return; if ((d.damage || 0) > bd) { bd = d.damage; best = d; } };
  if (lo.items) for (let i = 0; i < lo.items.length; i++) scan(lo.items[i]);
  if (lo.scavenged) for (let i = 0; i < lo.scavenged.length; i++) scan(lo.scavenged[i].id);
  return best;
}
export function meleeDamage(m, fallback = 30) { const d = bestMelee(m); return d ? d.damage : fallback; }

// =====================================================================================================
// THE ONE LINE. enemies/loadout.js dropsFor() calls this FIRST:
//
//     scavengedDrops(loadout, out);
//
// It emits every scavenged entry at probability 1.0 — no ruin roll, no `lost` roll — and claims the instances
// out of the ordinary loadout arrays so DROPS cannot roll them a second time and cannot roll them away.
// Idempotent: calling it twice produces the same pile.
// =====================================================================================================
export function scavengedDrops(loadout, out) {
  const sc = loadout && loadout.scavenged;
  if (!sc || !sc.length) return out;
  for (let i = 0; i < sc.length; i++) {
    const e = sc[i];
    if (e.inst) {
      if (loadout.weapon === e.inst) loadout.weapon = null;        // the mag inside it rides with it
      if (loadout.vest === e.inst) loadout.vest = null;
      if (loadout.helmet === e.inst) loadout.helmet = null;
      if (loadout.mags) { const j = loadout.mags.indexOf(e.inst); if (j >= 0) loadout.mags.splice(j, 1); }
      if (loadout.kit) { const j = loadout.kit.indexOf(e.inst); if (j >= 0) loadout.kit.splice(j, 1); }
    }
    out.push(e);
  }
  return out;
}
// The same statement as a predicate, for tests and for anyone auditing a pile.
export function isScavenged(loadout, inst) {
  const sc = loadout && loadout.scavenged; if (!sc) return false;
  for (let i = 0; i < sc.length; i++) if (sc[i].inst === inst) return true;
  return false;
}

// =====================================================================================================
// GLOBAL TICK. Projectiles, clouds, fires and the flash the Explorer is still blinking through. Driven either
// by the integrator once a frame or, failing that, by the first kitTick of the frame — so the module is never
// silently half-alive in a test.
// =====================================================================================================
let lastFrame = -1;
export function updateKit(ctx, dt) {
  if (dt <= 0) return;
  const d = Math.min(dt, 0.05);
  for (let i = 0; i < THROWN.length; i++) { const t = THROWN[i]; if (t.live && stepThrown(t, d)) t.live = false; }
  for (let i = CLOUDS.length - 1; i >= 0; i--) {
    const c = CLOUDS[i];
    if (c.rec.t <= 0) { if (c.hiss) c.hiss.stop(0.4); CLOUDS.splice(i, 1); continue; }
    if (c.hiss && c.hiss.set) c.hiss.set('intensity', clamp01(c.rec.t / 6));
  }
  for (let i = FIRES.length - 1; i >= 0; i--) {
    const f = FIRES[i];
    f.t -= d;
    if (f.t <= 0) { FIRES.splice(i, 1); continue; }
    f.blink -= d;
    if (f.blink <= 0) {
      f.blink = 0.35;
      const y = f.ctx.world.getHeight(f.x, f.z) + 0.3;
      if (f.ctx.vfx) {
        if (f.light) f.ctx.vfx.light({ x: f.x, y, z: f.z }, 0xff5a3c, 26, 0.4, FLARE.radius);
        else { f.ctx.vfx.light({ x: f.x, y, z: f.z }, 0xff8a3c, 40, 0.4, f.r * 6); f.ctx.vfx.smoke({ x: f.x, y, z: f.z }, UP, 4, [0.3, 0.28, 0.26], 1.1, 2.4, 0.7); }
      }
    }
    if (f.dps > 0) {
      const list = f.ctx.enemies && f.ctx.enemies.list;
      if (list) for (let j = 0; j < list.length; j++) { const e = list[j]; if (!e || !e.alive) continue; if (Math.hypot(e.position.x - f.x, e.position.z - f.z) < f.r) e.damage(f.dps * d, { kind: 'burn' }); }
      const p = playerAt(f.ctx);
      if (p && !p.dead && Math.hypot(p.position.x - f.x, p.position.z - f.z) < f.r) p.damage(f.dps * d, { kind: 'burn', bleed: false });
    }
  }
  if (flashBlur > 0 && flashCtx) {
    flashBlur -= d;
    flashCtx.post?.setBlur?.(clamp01(flashBlur * 0.55));
    if (flashBlur <= 0) { flashCtx.post?.setBlur?.(0); flashCtx = null; }
  }
  // drop dead piles out of the registry so it never grows and never holds a disposed object
  for (let i = PILES.length - 1; i >= 0; i--) { const o = PILES[i].o; if (!o || !o.pile || o.dead) PILES.splice(i, 1); }
}
// convenience: the first mimic to tick in a frame drives the global side of the module
export function kitFrame(ctx, dt) { if (ctx.frame === lastFrame) return; lastFrame = ctx.frame; updateKit(ctx, dt); }

export function resetKit() {
  for (let i = 0; i < THROWN.length; i++) THROWN[i].live = false;
  for (const c of CLOUDS) { if (c.hiss) c.hiss.stop(0.05); const w = c.ctx.world.smoke, j = w.indexOf(c.rec); if (j >= 0) w.splice(j, 1); }
  CLOUDS.length = 0; FIRES.length = 0; PILES.length = 0; LOCKED.length = 0;
  flashBlur = 0; flashCtx = null; lastFrame = -1; losFrame = -1;
  for (const key in COUNT) COUNT[key] = 0;
}

// Optional wiring, for anyone who would rather not hand-place the resets.
export function installKit(ctx) {
  ctx.events.on('gameStart', resetKit);
  ctx.events.on('tide', resetKit);
  return { updateKit: (dt) => updateKit(ctx, dt), stats, resetKit };
}
