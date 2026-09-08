// Loot tables. A container rolls `rolls` times against its category weights; each roll then picks an item out of
// the catalogue by rarity and rank against the location's tier. Nothing here names an item id: categories are
// resolved through data/index.js categoryOf(), so a weapon or a medicine added to data/ turns up in the zone on
// its own. game/loot.js builds the pools and does the picking.
//
// THE ONE DIAL: tier. tier = LOOT_TIER[poi kind] + Tide + clearance (see TIER). A checkpoint at the gate on the
// first Tide is tier 0 and hands out bandages and pistol rounds; the northern ridge four Tides in is tier 5 and
// has rifles, plates and artifacts in it. Everything else in this file reads off that number.

// How far into the Radius a POI kind sits. 'field' is the roadside and open ground between them.
export const LOOT_TIER = { base: 0, checkpoint: 0, field: 0, marsh: 0, village: 1, convoy: 1, forest: 1, church: 2, rail: 2, industrial: 2, anomaly: 3, ridge: 3 };
export const TIER = { tide: 0.5, security: 0.25, max: 5 };
export function lootTier(poiKind, tide = 1, security = 1) {
  const base = LOOT_TIER[poiKind] ?? 1;
  const t = base + Math.max(0, (tide | 0) - 1) * TIER.tide + Math.max(0, (security | 0) - 1) * TIER.security;
  return Math.max(0, Math.min(TIER.max, t));
}

// ---- what a tier is worth ----
export const RARITY_BASE = { common: 60, uncommon: 25, rare: 10, epic: 2 };
export function rarityWeight(rarity, tier) {
  const t = Math.max(0, Math.min(TIER.max, tier));
  switch (rarity) {
    case 'common': return Math.max(8, 60 - 8 * t);
    case 'uncommon': return 25 + 4 * t;
    case 'rare': return 6 + 5 * t;
    case 'epic': return 0.5 + 2.2 * t;
    default: return 1;
  }
}
// Clearance-grade kit is scarce where the Committee has not been. An item's rank above the tier is squared away.
export function rankWeight(rank, tier) {
  const over = (rank || 1) - 1 - Math.max(0, tier);
  return over <= 0 ? 1 : 1 / (1 + over * over * 3);
}
// the weight of one catalogue entry in a roll at this tier
export function pickWeight(d, tier) { return d ? rarityWeight(d.rarity || 'common', tier) * rankWeight(d.rank || 1, tier) : 0; }

// ---- containers ----
// mesh: which body game/loot.js builds. rolls: [min,max] draws. categories: weights, keys resolved through
// CATEGORY_SOURCES. empty: chance the container was cleaned out before you got to it. tierMin: does not appear
// below that tier. locked: chance of a lock (lockpicks or the right key open it). scale: mesh scale override.
export const CONTAINERS = {
  ammo_tin:     { name: 'Ammo tin',         mesh: 'ammoTin',    rolls: [1, 3], categories: { ammo: 8, mag: 2 }, empty: 0.15 },
  ammo_crate:   { name: 'Ammunition crate', mesh: 'crate',      rolls: [2, 5], categories: { ammo: 8, mag: 3, grenade: 1.5 }, empty: 0.1, tierMin: 1 },
  med_bag:      { name: 'Medical bag',      mesh: 'medBag',     rolls: [1, 3], categories: { med: 8, food: 2 }, empty: 0.15 },
  med_cabinet:  { name: 'Medical cabinet',  mesh: 'cabinet',    rolls: [2, 4], categories: { med: 9, filter: 1.5, food: 1 }, empty: 0.2, tierMin: 1 },
  footlocker:   { name: 'Footlocker',       mesh: 'footlocker', rolls: [2, 4], categories: { tool: 4, food: 2, battery: 2, mag: 1.5, attachment: 1.5, armor: 0.8, weapon: 0.8 }, empty: 0.15 },
  weapon_crate: { name: 'Weapon crate',     mesh: 'crate',      rolls: [1, 2], categories: { weapon: 5, attachment: 3, mag: 3 }, empty: 0.25, tierMin: 1, scale: [1.35, 0.8, 0.85] },
  weapon_rack:  { name: 'Weapon rack',      mesh: 'rack',       rolls: [1, 3], categories: { weapon: 7, mag: 3, attachment: 1 }, empty: 0.35, tierMin: 1 },
  gun_case:     { name: 'Weapon case',      mesh: 'toolbox',    rolls: [1, 2], categories: { weapon: 4, attachment: 5, mag: 2 }, empty: 0.2, tierMin: 2, locked: 0.3, scale: [1.9, 0.65, 1.15] },
  armor_locker: { name: 'Armour locker',    mesh: 'cabinet',    rolls: [1, 2], categories: { armor: 6, helmet: 3, kit: 2.5 }, empty: 0.3, tierMin: 1, locked: 0.35 },
  toolbox:      { name: 'Toolbox',          mesh: 'toolbox',    rolls: [1, 3], categories: { tool: 5, part: 3, battery: 2 }, empty: 0.15 },
  tool_chest:   { name: 'Tool chest',       mesh: 'toolbox',    rolls: [2, 4], categories: { tool: 5, part: 4, battery: 2, attachment: 1 }, empty: 0.15, tierMin: 1, scale: [1.55, 1.4, 1.4] },
  ration_box:   { name: 'Ration box',       mesh: 'carton',     rolls: [1, 3], categories: { food: 9, med: 1 }, empty: 0.1 },
  explorer_pack:{ name: 'Explorer’s pack',  mesh: 'pack',       rolls: [3, 6], categories: { ammo: 3, med: 3, food: 2, tool: 2, mag: 2, artifact: 0.8, attachment: 1, mission: 0.5 }, empty: 0 },
  field_cache:  { name: 'Field cache',      mesh: 'pack',       rolls: [3, 5], categories: { ammo: 3, med: 2, weapon: 2, attachment: 2, artifact: 1.5, grenade: 1, kit: 1 }, empty: 0, tierMin: 2, scale: [0.9, 0.9, 0.9] },
  safe:         { name: 'Safe',             mesh: 'safe',       rolls: [2, 4], categories: { artifact: 3, attachment: 3, weapon: 2, armor: 1, grenade: 1, key: 0.5 }, empty: 0.1, locked: 0.9, tierMin: 2 },
  desk:         { name: 'Desk',             mesh: 'desk',       rolls: [0, 2], categories: { food: 3, battery: 2, tool: 2, mission: 0.5, key: 0.6 }, empty: 0.3 },
  shelf:        { name: 'Shelf',            mesh: 'carton',     rolls: [0, 2], categories: { food: 4, tool: 3, ammo: 2, battery: 2 }, empty: 0.3, scale: [0.85, 0.85, 0.85] },
};
// which container kinds appear at which POI kinds (weights). 'field' is roadside and open ground.
export const CONTAINERS_BY_POI = {
  checkpoint: { ammo_tin: 4, footlocker: 3, med_bag: 2, desk: 2, weapon_crate: 1, weapon_rack: 1, armor_locker: 0.8 },
  convoy:     { ammo_crate: 4, ammo_tin: 3, footlocker: 2, weapon_crate: 2, toolbox: 2, ration_box: 2, tool_chest: 1, gun_case: 0.6 },
  village:    { shelf: 5, ration_box: 3, med_bag: 2, footlocker: 2, toolbox: 2, desk: 1, ammo_tin: 1, gun_case: 0.4 },
  industrial: { toolbox: 4, ammo_tin: 3, desk: 3, med_cabinet: 2, armor_locker: 2, tool_chest: 2, safe: 1, weapon_crate: 1, weapon_rack: 0.8 },
  church:     { shelf: 3, med_bag: 2, explorer_pack: 2, safe: 1, ammo_tin: 1, field_cache: 1 },
  rail:       { ammo_crate: 3, toolbox: 3, footlocker: 2, weapon_crate: 1.5, weapon_rack: 1, explorer_pack: 1, tool_chest: 1 },
  forest:     { explorer_pack: 3, ration_box: 2, ammo_tin: 1, field_cache: 1 },
  marsh:      { explorer_pack: 2, ammo_tin: 1, med_bag: 1, ration_box: 1 },
  anomaly:    { explorer_pack: 3, field_cache: 1.5 },
  ridge:      { explorer_pack: 2, safe: 1, weapon_crate: 1, field_cache: 1.5, armor_locker: 1, weapon_rack: 1 },
  field:      { ammo_tin: 2, ration_box: 2, med_bag: 1.5, explorer_pack: 1, footlocker: 0.8 },
};

// ---- categories -> the catalogue ----
// Keys are what CONTAINERS.categories uses; values are categoryOf() names from data/index.js. Nothing is listed
// by id, so a new vest or a new grenade is in the tables the moment it exists.
export const CATEGORY_SOURCES = {
  ammo: ['ammo'], mag: ['mag'], weapon: ['weapon'], attachment: ['attachment'],
  armor: ['armor'], helmet: ['helmet'], kit: ['rig', 'pack', 'headgear', 'mask'],
  med: ['med'], food: ['food'], tool: ['tool', 'melee'], part: ['part'], battery: ['battery'], filter: ['filter'],
  grenade: ['grenade'], artifact: ['artifact'], key: ['key'], mission: ['mission'],
};
// rounds per ammunition roll, by the rarity of the round
export const AMMO_ROLL = { common: [12, 40], uncommon: [8, 24], rare: [5, 15], epic: [3, 8] };
// how many of a stackable roll into one slot; cheap things (CHEAP ₽ or less) come by the handful
export const COUNT_ROLL = { med: [1, 2], food: [1, 2], tool: [1, 2], part: [1, 1], battery: [1, 2], filter: [1, 2], grenade: [1, 2], artifact: [1, 1], key: [1, 1], mission: [1, 1] };
export const CHEAP = 45, CHEAP_MULT = 3;

// ---- the state gear is in when the zone hands it over ----
// Ranges are [at tier 0, at tier 5]. A weapon out of a crate is fouled, worn and part loaded; it is a find, not
// an issue. loose: the weapon may have no magazine in it at all.
export const FOUND = {
  weapon: { parts: [[18, 55], [45, 92]], dirt: [[0.30, 0.75], [0.12, 0.45]], loaded: [[0, 0.55], [0.2, 1]], noMag: [0.34, 0.12], attachment: [0.06, 0.5], attachments: [1, 2] },
  gear: { durability: [[0.28, 0.7], [0.5, 1]] },
  mag: { rounds: [[0, 0.65], [0.15, 1]], empty: [0.4, 0.15] },
};
// a locked container: how long the lock holds, and how many lockpick uses it eats
export const LOCK = { hold: 2.6, picks: 1 };
