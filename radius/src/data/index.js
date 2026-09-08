// One door into the catalogue: lookups, compatibility, weight, and the hit/armour resolution used by both sides.
import { CALIBERS, AMMO, ammoOf, defaultAmmo } from './calibers.js';
import { MAGAZINES } from './magazines.js';
import { WEAPONS } from './weapons.js';
import { ATTACHMENTS, attachmentFits, effectiveMounts } from './attachments.js';
import { ARMOR } from './armor.js';
import { ITEMS } from './items.js';
import { MIMIC_CLASSES, CLASS_MIX, POI_TIER, SEEKER } from './loadouts.js';
import { CONTAINERS, CONTAINERS_BY_POI, AMMO_ROLL, rarityWeight } from './loot.js';
export { CALIBERS, AMMO, ammoOf, defaultAmmo, MAGAZINES, WEAPONS, ATTACHMENTS, attachmentFits, effectiveMounts, ARMOR, ITEMS, MIMIC_CLASSES, CLASS_MIX, POI_TIER, SEEKER, CONTAINERS, CONTAINERS_BY_POI, AMMO_ROLL, rarityWeight };

// def(id) -> the definition from whichever table holds it, with .kind filled in ('weapon'|'ammo'|'mag'|'attachment'|'vest'|'helmet'|'backpack'|'rig'|'headgear'|'mask'|items' kind)
export function def(id) {
  if (!id) return null;
  if (WEAPONS[id]) return WEAPONS[id].kind ? WEAPONS[id] : (WEAPONS[id].kind = 'weapon', WEAPONS[id]);
  if (AMMO[id]) return AMMO[id].kind0 ? AMMO[id] : (AMMO[id].kind0 = AMMO[id].kind, AMMO[id].kindOf = 'ammo', AMMO[id]);
  return MAGAZINES[id] || ATTACHMENTS[id] || ARMOR[id] || ITEMS[id] || null;
}
export const isWeapon = (id) => !!WEAPONS[id];
export const isAmmo = (id) => !!AMMO[id];
export const isMag = (id) => !!MAGAZINES[id];
export const isAttachment = (id) => !!ATTACHMENTS[id];
export const isArmor = (id) => !!ARMOR[id];
export const nameOf = (id) => (def(id) || {}).name || id;
export const weightOf = (id, n = 1) => ((def(id) || {}).weight || 0) * n;
export const priceOf = (id) => (def(id) || {}).price || 0;
export const rankOf = (id) => (def(id) || {}).rank || 1;
// category of an id for loot/shop grouping
export function categoryOf(id) {
  if (WEAPONS[id]) return 'weapon';
  if (AMMO[id]) return 'ammo';
  if (MAGAZINES[id]) return 'mag';
  if (ATTACHMENTS[id]) return 'attachment';
  const a = ARMOR[id]; if (a) return a.kind === 'vest' ? 'armor' : a.kind === 'helmet' ? 'helmet' : a.kind === 'backpack' ? 'pack' : a.kind;
  const it = ITEMS[id]; if (it) return it.kind;
  return 'unknown';
}
export const magsFor = (weaponId) => { const w = WEAPONS[weaponId]; return w ? Object.values(MAGAZINES).filter((m) => m.fits.includes(w.family)) : []; };
export const attachmentsFor = (weaponId, rails = []) => { const w = WEAPONS[weaponId]; return w ? Object.values(ATTACHMENTS).filter((a) => attachmentFits(a, w, rails)) : []; };
// every priced definition in the catalogue, in table order
const catalogue = () => [...Object.values(WEAPONS), ...Object.values(AMMO), ...Object.values(MAGAZINES), ...Object.values(ATTACHMENTS), ...Object.values(ARMOR), ...Object.values(ITEMS)];
export function shopItems(rank) {
  return catalogue().filter((d) => !d.hidden && (d.rank || 1) <= rank && (d.price || 0) > 0 && d.kind !== 'mission' && d.kind !== 'key' && d.kind !== 'artifact');
}
// What is stocked follows what is issued. A rifle on the clearance 1 shelf with its rounds behind clearance 2
// is not a choice: the obrez and the Mosin both took 7.62×54R, and the PPSh outranked its own magazine. Pull
// each calibre's plain load, and every weapon's issue magazine, down to the clearance of the earliest weapon
// that takes it. Nothing is ever pushed up, and the specialist loads (AP, sniper, subsonic) keep their grade.
(function stockFollowsIssue() {
  const first = {};
  for (const w of Object.values(WEAPONS)) {
    const r = w.rank || 1;
    if (!(w.cal in first) || r < first[w.cal]) first[w.cal] = r;
    const m = MAGAZINES[w.defaultMag];
    if (m && (m.rank || 1) > r) m.rank = r;
  }
  for (const cal in first) { const plain = AMMO[defaultAmmo(cal)]; if (plain && (plain.rank || 1) > first[cal]) plain.rank = first[cal]; }
})();
// Security clearance thresholds by money earned (rank 1..5) and the missions completed needed. A contract at
// clearance 1 pays 1,200 to 2,000 ₽, so grade 2 is two contracts' work; the ladder stretches from there.
export const RANKS = [
  { rank: 1, earned: 0, missions: 0, title: 'Explorer, provisional' },
  { rank: 2, earned: 3500, missions: 2, title: 'Explorer' },
  { rank: 3, earned: 12000, missions: 5, title: 'Explorer, second class' },
  { rank: 4, earned: 28000, missions: 10, title: 'Explorer, first class' },
  { rank: 5, earned: 60000, missions: 16, title: 'Senior explorer' },
];
// grades are granted in order: the first threshold the explorer has not met stops the climb
export function rankFor(earned, missions) { let r = 1; for (const k of RANKS) { if (earned < k.earned || missions < k.missions) break; r = k.rank; } return r; }
// ---- what is found rather than bought ----
// A container or a body rolls a category and then a definition inside it: rarity sets the odds (rarityWeight)
// and rank sets the ceiling, so a ridge crate can turn up a VSS and a village shelf cannot. tier is the
// location tier on the same 0..4 scale rarityWeight uses (POI_TIER plus the tide level). `noLoot` on a
// definition keeps requisition-only kit out of the zone.
export const lootRankCap = (tier) => Math.max(1, Math.min(5, 1 + Math.round(tier || 0)));
export function lootPool(cat, tier = 0, maxRank = lootRankCap(tier)) {
  return catalogue().filter((d) => !d.hidden && !d.noLoot && (d.rank || 1) <= maxRank && d.kind !== 'mission' && d.kind !== 'key' && categoryOf(d.id) === cat);
}
export function pickByRarity(list, tier = 0, rnd = Math.random) {
  let sum = 0; for (const d of list) sum += rarityWeight(d.rarity || 'common', tier);
  if (!(sum > 0)) return null;
  let r = rnd() * sum;
  for (const d of list) { r -= rarityWeight(d.rarity || 'common', tier); if (r <= 0) return d; }
  return list[list.length - 1] || null;
}
// one definition of a category, weighted for the location: rollLoot('weapon', tier, rnd) -> a weapon def or null
export const rollLoot = (cat, tier = 0, rnd = Math.random) => pickByRarity(lootPool(cat, tier), tier, rnd);

// ---- hit resolution ----
// zone: 'head' | 'torso' | 'stomach' | 'arms' | 'legs'. armorPieces: [{ def, inst }] covering zones (vest, helmet, rig).
// Returns { damage, penetrated, armorHit (piece), armorDamage, blunt }.
export const ZONE_MULT = { head: 1.9, torso: 1.0, stomach: 0.9, arms: 0.55, legs: 0.6 };
export function resolveHit(ammoDef, zone, armorPieces, opts = {}) {
  let dmg = (ammoDef.damage || 10) * (ZONE_MULT[zone] || 1) * (opts.mult || 1);
  const pen = ammoDef.pen || 1;
  const piece = armorPieces.find((p) => p.def && p.def.zones && p.def.zones.includes(zone));
  if (!piece) return { damage: dmg, penetrated: true, armorHit: null, armorDamage: 0, blunt: false };
  const dur = Math.max(0, Math.min(1, (piece.inst?.durability ?? piece.def.durability) / piece.def.durability));
  const effClass = piece.def.cls * (0.55 + 0.45 * dur);
  // penetration probability: pen == class -> ~70 %, one class under -> ~15 %, one over -> ~97 %
  const x = (pen - effClass + 1.0) / 2.0;
  const p = x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const roll = opts.roll ?? Math.random();
  if (roll < p) { return { damage: dmg * 0.85, penetrated: true, armorHit: piece, armorDamage: Math.max(1, dmg * 0.25), blunt: false }; }
  const blunt = ammoDef.blunt ? dmg * 0.35 : dmg * (0.12 + 0.08 * Math.max(0, pen - effClass + 1));
  return { damage: blunt, penetrated: false, armorHit: piece, armorDamage: Math.max(2, dmg * 0.7), blunt: true };
}
// pick a hit zone from where a ray hit a capsule (0 = feet, 1 = head) and lateral offset (0 centre .. 1 edge)
export function zoneFromHit(h01, lateral01) {
  if (h01 > 0.86) return 'head';
  if (h01 > 0.62) return lateral01 > 0.72 ? 'arms' : 'torso';
  if (h01 > 0.48) return lateral01 > 0.75 ? 'arms' : 'stomach';
  return 'legs';
}
