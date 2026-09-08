// Mimic loadouts. A mimic is what it carries: the class POOL in data/loadouts.js is put through GEAR_CURVE and
// rolled into real inventory instances (a worn weapon with a part-spent magazine, spare magazines, a vest, a
// helmet, grenades, pocket litter) so the entity fires exactly what it drops. Nothing here is hard-coded
// outside the catalogue, and the whole difficulty curve lives in data/loadouts.js.
//   setProgression({ tide, security }) -> the zone's current standing; game/loot.js publishes it each second
//   pickClass(poiKind, tide)      -> class name from CLASS_MIX[min(4, tide + POI_TIER[poiKind])]
//   rollLoadout(className, tide, opts) -> { cls, def, progress, weapon, mags, vest, helmet, kit, grenades, grenadeId, items, loose, ammoId }
//   dropsFor(loadout)             -> loot pile entries [{ kind:'weapon'|'mag'|'gear'|'item', inst?, id, count }]
import { MIMIC_CLASSES, CLASS_MIX, POI_TIER, WEAPONS, MAGAZINES, ARMOR, AMMO, ITEMS, def, defaultAmmo, ammoOf } from '../data/index.js';
import { GEAR_CURVE as CURVE, DROPS as DROP_TABLE, gearProgress } from '../data/loadouts.js';   // the curve is not part of the catalogue door
import { makeWeapon, makeMag, makeGear, attach } from '../player/inventory.js';

const rnd = () => Math.random();
const range = (a, b) => a + rnd() * (b - a);
const int = (a, b) => Math.floor(range(a, b + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const band = (r, p) => range(lerp(r[0][0], r[1][0], p), lerp(r[0][1], r[1][1], p));   // [[lo,hi] at 0, [lo,hi] at 1]
const CLASS_RANK = { recruit: 0, regular: 1, shotgunner: 2, gunner: 2, veteran: 3, sniper: 3, elite: 4 };
export const classRank = (cls) => CLASS_RANK[cls] ?? 1;

// ---- the zone's current standing ----
// The Tide level and the Explorer's clearance decide how well equipped everything in the treeline is. Whoever
// owns ctx publishes it here (game/loot.js does, once a second); rollLoadout's own arguments override it.
const zone = { tide: 1, security: 1 };
export function setProgression(p = {}) { if (p.tide) zone.tide = p.tide | 0; if (p.security) zone.security = p.security | 0; }
export const progression = () => ({ tide: zone.tide, security: zone.security });

// ---- picking inside a class pool ----
// An entry's "grade" is its clearance rank and rarity together. The curve's exponent decides which end of the
// pool a mimic reaches for: negative early (the beaten Makarov), positive deep in (the suppressed rifle).
const RARITY_GRADE = { common: 1, uncommon: 1.35, rare: 1.8, epic: 2.3 };
const gradeOf = (d) => ((d.rank || 1) * 0.55 + (RARITY_GRADE[d.rarity] || 1)) * 0.5;
function gradedPick(ids, p, table = null) {
  const bias = lerp(CURVE.grade[0], CURVE.grade[1], p);
  const list = [], w = [];
  let sum = 0;
  for (const id of ids || []) {
    const d = table ? table[id] : def(id); if (!d) continue;
    const s = Math.pow(Math.max(0.05, gradeOf(d)), bias);
    list.push(id); w.push(s); sum += s;
  }
  if (!list.length) return null;
  let r = rnd() * sum;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

// ---- ammunition: the better the mimic and the later the Tide, the better the rounds ----
const CLASS_AMMO = { recruit: 0.3, regular: 0.7, shotgunner: 0.8, gunner: 0.9, veteran: 1.1, sniper: 1.3, elite: 1.4 };
function preferredAmmo(className, cal, p) {
  const base = defaultAmmo(cal);
  const types = ammoOf(cal);
  const byKind = (k) => types.find((a) => a.kind === k)?.id;
  const ap = byKind('ap'), hp = byKind('hp'), tracer = byKind('tracer');
  const reach = lerp(CURVE.ammo[0], CURVE.ammo[1], p) * (CLASS_AMMO[className] ?? 1);
  if (cal === '12ga') return rnd() < 0.3 + reach * 0.4 ? '12_slug' : '12_buck';
  if (cal === '7.62x54' && className === 'sniper' && rnd() < 0.4 + reach) return AMMO['754_snb'] ? '754_snb' : base;
  if (className === 'gunner' && tracer && rnd() < 0.35) return tracer;
  if (ap && rnd() < reach) return ap;
  if (hp && rnd() < 0.15) return hp;
  return base;
}

// class by POI kind and tide level. Weighted by CLASS_MIX; unknown POI kinds count as tier 1.
export function pickClass(poiKind, tide = 1) {
  const tier = Math.max(1, Math.min(4, (tide | 0) + (POI_TIER[poiKind] ?? 1)));
  const mix = CLASS_MIX[tier] || CLASS_MIX[1];
  let sum = 0; for (const k in mix) sum += mix[k];
  let r = rnd() * sum;
  for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
  return 'regular';
}

// Attachments roll in dependency order (rails first) so a light or grip that needs a rail can actually mount.
// Every chance is scaled by the curve; past GEAR_CURVE.optic a class that owns glass is certain to have some.
function rollAttachments(weapon, table, p) {
  if (!table) return;
  const mult = lerp(CURVE.attach[0], CURVE.attach[1], p);
  const entries = Object.entries(table).sort((a, b) => ((def(a[0])?.slot === 'rail') ? -1 : 0) - ((def(b[0])?.slot === 'rail') ? -1 : 0));
  const fitOne = (id) => {
    const a = def(id); if (!a || a.kind !== 'attachment') return false;
    // a light or grip on an AK needs the handguard rail: pull it in when the roll wants the accessory
    if (a.slot === 'under' && !attach(weapon, id)) { if (WEAPONS[weapon.id].mounts.under === 'akhg' && attach(weapon, 'rail_akhg')) return attach(weapon, id); return false; }
    return attach(weapon, id);
  };
  for (const [id, chance] of entries) { if (rnd() < chance * mult) fitOne(id); }
  const glass = Object.keys(table).filter((id) => def(id)?.slot === 'top');
  if (p >= CURVE.optic && !weapon.attachments.top && rnd() < Math.min(0.9, 0.3 + 0.16 * glass.length)) {
    for (let i = 0; i < 3 && !weapon.attachments.top && glass.length; i++) {
      const id = gradedPick(glass, p); if (!id) break;
      if (!fitOne(id)) { const k = glass.indexOf(id); if (k >= 0) glass.splice(k, 1); }
    }
  }
}

export function rollLoadout(className = 'regular', tide = zone.tide, opts = {}) {
  const c = MIMIC_CLASSES[className] || MIMIC_CLASSES.regular;
  className = MIMIC_CLASSES[className] ? className : 'regular';
  const security = opts.security ?? zone.security;
  const p = opts.progress ?? gearProgress({ tide, security, classRank: classRank(className) });
  // ---- the weapon ----
  const weaponId = gradedPick(c.weapons, p, WEAPONS) || 'akm';
  const wdef = WEAPONS[weaponId];
  const ammoId = preferredAmmo(className, wdef.cal, p) || defaultAmmo(wdef.cal);
  const weapon = makeWeapon(weaponId, { condition: Math.round(band(CURVE.condition, p)), ammo: ammoId });
  weapon.dirt = band(CURVE.dirt, p);
  rollAttachments(weapon, c.attachments, p);
  // the magazine in the gun is part spent: it has been used
  if (weapon.mag) { const cap = MAGAZINES[weapon.mag.id].cap; weapon.mag.rounds = Math.max(1, Math.round(cap * range(0.35, 1))); weapon.mag.ammo = ammoId; }
  else if (weapon.tube.length) { const keep = Math.max(1, Math.round(weapon.tube.length * range(0.5, 1))); weapon.tube.length = keep; }
  // ---- spare magazines: tube and clip guns carry loose rounds instead ----
  const mags = [];
  let loose = 0;
  const want = Math.max(0, (c.mags || 2) + Math.round(lerp(CURVE.spares[0], CURVE.spares[1], p)));
  const spare = Math.min(5, Math.max(wdef.defaultMag && !wdef.clip ? 0 : 1, int(Math.max(0, want - 1), want)));
  if (wdef.defaultMag && !wdef.clip) {
    const cap = MAGAZINES[wdef.defaultMag].cap;
    for (let i = 0; i < spare; i++) mags.push(makeMag(wdef.defaultMag, ammoId, Math.max(1, Math.round(cap * band(CURVE.magFill, p)))));
  } else if (wdef.defaultMag && wdef.clip) {
    const cap = MAGAZINES[wdef.defaultMag].cap;
    for (let i = 0; i < spare; i++) mags.push(makeMag(wdef.defaultMag, ammoId, cap));
    loose = int(0, 10);
  } else {
    loose = int(6, 8 + spare * 5);
  }
  // ---- armour: a recruit at the gate wears nothing; deeper in, plates ----
  const skipVest = rnd() < lerp(CURVE.bare[0], CURVE.bare[1], p) * (c.bare ?? 1);
  const skipHelmet = rnd() < lerp(CURVE.bareHelmet[0], CURVE.bareHelmet[1], p) * (c.bare ?? 1);
  const vestId = skipVest ? null : gradedPick(c.armor, p, ARMOR);
  const helmetId = skipHelmet ? null : gradedPick(c.helmet, p, ARMOR);
  const vestDef = vestId ? ARMOR[vestId] : null, helmetDef = helmetId ? ARMOR[helmetId] : null;
  const vest = vestDef ? makeGear(vestId, { durability: Math.max(1, Math.round(vestDef.durability * band(CURVE.durability, p))) }) : null;
  const helmet = helmetDef ? makeGear(helmetId, { durability: Math.max(1, Math.round(helmetDef.durability * band(CURVE.durability, p))) }) : null;
  // a rig, a pack, a mask: worn, and worth taking off the body
  const kit = [];
  if (c.kit && c.kit.length && rnd() < 0.25 + p * 0.55) { const id = gradedPick(c.kit, p, ARMOR); if (id && ARMOR[id]) kit.push(makeGear(id)); }
  // ---- grenades: the class value is the chance of carrying; deeper in, two ----
  const gChance = (c.grenades || 0) * lerp(CURVE.grenade[0], CURVE.grenade[1], p);
  const grenades = gChance > 0 && rnd() < gChance ? (rnd() < gChance * 0.5 ? 2 : 1) : 0;
  const grenadeId = className === 'elite' ? (rnd() < 0.5 ? 'gr_f1' : 'gr_rgn') : className === 'veteran' && rnd() < 0.4 ? 'gr_f1' : rnd() < 0.15 ? 'gr_smoke' : 'gr_rgd5';
  // ---- pocket litter: each entry on the class list rolls on its own ----
  const items = [];
  for (const id of c.drops || []) { if (def(id) && rnd() < 0.4 + p * 0.25) items.push(id); }
  if (!items.length && c.drops && c.drops.length) { const id = pick(c.drops); if (def(id)) items.push(id); }
  return { cls: className, def: c, progress: p, weapon, mags, vest, helmet, kit, grenades, grenadeId: ITEMS[grenadeId] ? grenadeId : 'gr_rgd5', items, loose, ammoId, tide, security };
}

// Loot pile entries from what is left when the mimic folds: the weapon it was firing with whatever is still in
// the magazine, its spare magazines, the armour it wore in the state the fight left it, its rig, its pockets and
// the loose rounds. The ash takes a share — see DROPS in data/loadouts.js.
export function dropsFor(loadout) {
  const out = [];
  if (!loadout) return out;
  const w = loadout.weapon;
  const rank = classRank(loadout.cls) / 4;
  if (w) {
    const ruinChance = lerp(DROP_TABLE.ruined[0], DROP_TABLE.ruined[1], rank);
    if (rnd() < DROP_TABLE.lost) {
      // gone into the ash with the body; the magazine that was in it is not
      if (w.mag) out.push({ kind: 'mag', inst: w.mag, id: w.mag.id, count: 1 });
    } else if (rnd() < DROP_TABLE.weapon) {
      if (rnd() < ruinChance) {   // bent, cracked, seized: a find for the workbench, not for today
        const c = int(4, 18); w.parts = { barrel: c, bolt: Math.max(1, c - int(0, 4)), frame: c }; w.dirt = Math.min(1, 0.75 + rnd() * 0.25); w.jammed = true;
      }
      out.push({ kind: 'weapon', inst: w, id: w.id, count: 1 });
    } else if (w.mag) out.push({ kind: 'mag', inst: w.mag, id: w.mag.id, count: 1 });
  }
  for (const m of loadout.mags || []) if (rnd() < DROP_TABLE.mag) out.push({ kind: 'mag', inst: m, id: m.id, count: 1 });
  // armour survives by what is left of it: a carrier that stopped a magazine is not worth the weight
  for (const [g, key] of [[loadout.vest, 'vest'], [loadout.helmet, 'helmet']]) {
    if (!g) continue;
    const d = def(g.id); if (!d) continue;
    const left = Math.max(0, Math.min(1, (g.durability ?? d.durability) / (d.durability || 1)));
    if (rnd() < lerp(DROP_TABLE[key][0], DROP_TABLE[key][1], left)) out.push({ kind: 'gear', inst: g, id: g.id, count: 1 });
  }
  for (const g of loadout.kit || []) if (rnd() < 0.6) out.push({ kind: 'gear', inst: g, id: g.id, count: 1 });
  for (const id of loadout.items || []) {
    if (rnd() >= DROP_TABLE.item) continue;
    const n = AMMO[id] ? int(4, 14) : 1;
    out.push({ kind: 'item', id, count: n });
  }
  if (loadout.grenades > 0 && rnd() < DROP_TABLE.grenade) out.push({ kind: 'item', id: loadout.grenadeId, count: loadout.grenades });
  const loose = (loadout.loose | 0) + int(DROP_TABLE.loose[0], DROP_TABLE.loose[1]);
  if (loose > 0 && loadout.ammoId && AMMO[loadout.ammoId]) out.push({ kind: 'item', id: loadout.ammoId, count: loose });
  return out;
}

// rounds currently in the gun (magazine or tube plus a chambered round)
export function roundsInGun(w) {
  if (!w) return 0;
  const inMag = w.mag ? w.mag.rounds : (w.tube ? w.tube.length : 0);
  return inMag + (w.chamber ? 1 : 0);
}
// take one round out of the gun; returns false when it was empty
export function consumeRound(w) {
  if (!w) return false;
  if (w.mag && w.mag.rounds > 0) { w.mag.rounds--; if (w.mag.rounds === 0) w.mag.ammo = w.mag.ammo; w.chamber = w.mag.rounds > 0 ? w.mag.ammo : null; return true; }
  if (w.tube && w.tube.length > 0) { w.tube.pop(); w.chamber = w.tube.length > 0 ? w.tube[w.tube.length - 1] : null; return true; }
  if (w.chamber) { w.chamber = null; return true; }
  return false;
}
// the spare magazine with the most rounds, or null
export function bestSpare(loadout) {
  let best = null;
  for (const m of loadout.mags || []) if (m.rounds > 0 && (!best || m.rounds > best.rounds)) best = m;
  return best;
}
