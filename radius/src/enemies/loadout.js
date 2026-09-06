// Mimic loadouts. A mimic is what it carries: the class table in data/loadouts.js is rolled into real inventory
// instances (a worn weapon with a part-spent magazine, spare magazines, a vest, a helmet, grenades, a drop) so the
// entity fires exactly what it drops. Nothing here is hard-coded outside the catalogue.
//   pickClass(poiKind, tide)      -> class name from CLASS_MIX[min(4, tide + POI_TIER[poiKind])]
//   rollLoadout(className, tide)  -> { cls, def, weapon, mags, vest, helmet, grenades, grenadeId, items, loose, ammoId }
//   dropsFor(loadout)             -> loot pile entries [{ kind:'weapon'|'mag'|'gear'|'item', inst?, id, count }]
import { MIMIC_CLASSES, CLASS_MIX, POI_TIER, WEAPONS, MAGAZINES, AMMO, ITEMS, def, defaultAmmo, ammoOf } from '../data/index.js';
import { makeWeapon, makeMag, makeGear, attach } from '../player/inventory.js';

const rnd = () => Math.random();
const range = (a, b) => a + rnd() * (b - a);
const int = (a, b) => Math.floor(range(a, b + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const CLASS_RANK = { recruit: 0, regular: 1, shotgunner: 2, gunner: 2, veteran: 3, sniper: 3, elite: 4 };
export const classRank = (cls) => CLASS_RANK[cls] ?? 1;

// ---- ammunition preference by class: the better the mimic, the better the rounds ----
function preferredAmmo(className, cal) {
  const base = defaultAmmo(cal);
  const types = ammoOf(cal);
  const byKind = (k) => types.find((a) => a.kind === k)?.id;
  const ap = byKind('ap'), hp = byKind('hp');
  switch (className) {
    case 'sniper': return cal === '7.62x54' ? (rnd() < 0.6 ? '754_snb' : rnd() < 0.5 ? '754_ap' : base) : (ap && rnd() < 0.5 ? ap : base);
    case 'elite': return ap && rnd() < 0.5 ? ap : base;
    case 'veteran': return ap && rnd() < 0.3 ? ap : base;
    case 'gunner': return cal === '5.45x39' && rnd() < 0.35 ? '545_tr' : base;
    case 'shotgunner': return rnd() < 0.3 ? '12_slug' : '12_buck';
    case 'regular': return hp && rnd() < 0.15 ? hp : base;
    default: return base;
  }
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
function rollAttachments(weapon, table) {
  if (!table) return;
  const entries = Object.entries(table).sort((a, b) => ((def(a[0])?.slot === 'rail') ? -1 : 0) - ((def(b[0])?.slot === 'rail') ? -1 : 0));
  for (const [id, chance] of entries) {
    if (rnd() >= chance) continue;
    const a = def(id); if (!a || a.kind !== 'attachment') continue;
    // a light or grip on an AK needs the handguard rail: pull it in when the roll wants the accessory
    if (a.slot === 'under' && !attach(weapon, id)) { if (WEAPONS[weapon.id].mounts.under === 'akhg' && attach(weapon, 'rail_akhg')) attach(weapon, id); continue; }
    attach(weapon, id);
  }
}

export function rollLoadout(className = 'regular', tide = 1) {
  const c = MIMIC_CLASSES[className] || MIMIC_CLASSES.regular;
  className = MIMIC_CLASSES[className] ? className : 'regular';
  const weaponId = pick(c.weapons.filter((id) => WEAPONS[id])) || 'akm';
  const wdef = WEAPONS[weaponId];
  const ammoId = preferredAmmo(className, wdef.cal) || defaultAmmo(wdef.cal);
  const weapon = makeWeapon(weaponId, { condition: Math.round(range(30, 85)), ammo: ammoId });
  weapon.dirt = range(0.1, 0.6);
  rollAttachments(weapon, c.attachments);
  // the magazine in the gun is part spent: it has been used
  if (weapon.mag) { const cap = MAGAZINES[weapon.mag.id].cap; weapon.mag.rounds = Math.max(1, Math.round(cap * range(0.35, 1))); weapon.mag.ammo = ammoId; }
  else if (weapon.tube.length) { const keep = Math.max(1, Math.round(weapon.tube.length * range(0.5, 1))); weapon.tube.length = keep; }
  // spare magazines: 1-4, some part empty; tube and clip guns carry loose rounds instead
  const mags = [];
  let loose = 0;
  const spare = Math.max(1, Math.min(4, int(1, c.mags)));
  if (wdef.defaultMag && !wdef.clip) {
    const cap = MAGAZINES[wdef.defaultMag].cap;
    for (let i = 0; i < spare; i++) mags.push(makeMag(wdef.defaultMag, ammoId, rnd() < 0.3 ? Math.max(1, Math.round(cap * range(0.2, 0.8))) : cap));
  } else if (wdef.defaultMag && wdef.clip) {
    const cap = MAGAZINES[wdef.defaultMag].cap;
    for (let i = 0; i < spare; i++) mags.push(makeMag(wdef.defaultMag, ammoId, cap));
    loose = int(0, 10);
  } else {
    loose = int(6, 8 + spare * 5);
  }
  // armour
  const vestId = c.armor ? pick(c.armor) : null, helmetId = c.helmet ? pick(c.helmet) : null;
  const vest = vestId && def(vestId) ? makeGear(vestId, { durability: Math.round(def(vestId).durability * range(0.45, 1)) }) : null;
  const helmet = helmetId && def(helmetId) ? makeGear(helmetId, { durability: Math.round(def(helmetId).durability * range(0.5, 1)) }) : null;
  // grenades: the class value is the chance of carrying; a lucky roll carries two
  const g = c.grenades || 0;
  const grenades = g > 0 && rnd() < g ? (rnd() < g * 0.5 ? 2 : 1) : 0;
  const grenadeId = className === 'elite' ? (rnd() < 0.5 ? 'gr_f1' : 'gr_rgn') : className === 'veteran' && rnd() < 0.4 ? 'gr_f1' : 'gr_rgd5';
  // one item from the class drop list, kept in the pockets
  const items = [];
  if (c.drops && c.drops.length) { const id = pick(c.drops); if (def(id)) items.push(id); }
  return { cls: className, def: c, weapon, mags, vest, helmet, grenades, grenadeId: ITEMS[grenadeId] ? grenadeId : 'gr_rgd5', items, loose, ammoId, tide };
}

// Loot pile entries from what is left when the mimic folds: the weapon with its current magazine, spare mags,
// its armour 40 % of the time, one class drop 50 % of the time, and the loose rounds it carried.
export function dropsFor(loadout) {
  const out = [];
  if (!loadout) return out;
  const w = loadout.weapon;
  if (w) out.push({ kind: 'weapon', inst: w, id: w.id, count: 1 });
  for (const m of loadout.mags || []) out.push({ kind: 'mag', inst: m, id: m.id, count: 1 });
  if (rnd() < 0.4) {
    if (loadout.vest) out.push({ kind: 'gear', inst: loadout.vest, id: loadout.vest.id, count: 1 });
    if (loadout.helmet) out.push({ kind: 'gear', inst: loadout.helmet, id: loadout.helmet.id, count: 1 });
  }
  if (loadout.items && loadout.items.length && rnd() < 0.5) out.push({ kind: 'item', id: loadout.items[0], count: 1 });
  if (loadout.grenades > 0) out.push({ kind: 'item', id: loadout.grenadeId, count: loadout.grenades });
  const loose = (loadout.loose | 0) + int(0, 6);
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
