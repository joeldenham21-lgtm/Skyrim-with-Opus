// Loot tables. A container rolls `rolls` times against its category weights; each roll then picks an item out of
// the catalogue by rarity and rank against the location's tier. Nothing here names an item id: categories are
// resolved through data/index.js categoryOf(), so a weapon or a medicine added to data/ turns up in the zone on
// its own. game/loot.js builds the pools and does the picking.
//
// THE ONE DIAL: tier. tier = LOOT_TIER[poi kind] + Tide + clearance (see TIER). A checkpoint at the gate on the
// first Tide is tier 0 and hands out bandages and pistol rounds; the northern ridge four Tides in is tier 5 and
// has rifles, plates and artifacts in it. Everything else in this file reads off that number.
//
// THE SECOND DIAL, and the one that decides whether kit is precious: `empty` and `rolls`. The Radius has been
// worked over for two years by people who did not come back. Most furniture in it is furniture. A container
// that always pays turns the zone into a shop with a longer walk, and then nothing you carry is worth carrying.
// The rule here is that roughly two containers in five are worth the time it took to open them, and that what
// they hold is ammunition, bandages and batteries — the things that keep you in the field — far more often
// than it is a rifle. Rifles are for bodies and for the crate.

// How far into the Radius a POI kind sits. 'field' is the roadside and open ground between them.
export const LOOT_TIER = { base: 0, checkpoint: 0, field: 0, marsh: 0, village: 1, convoy: 1, forest: 1, church: 2, rail: 2, industrial: 2, anomaly: 2, ridge: 3 };
export const TIER = { tide: 0.4, security: 0.2, max: 5 };
export function lootTier(poiKind, tide = 1, security = 1) {
  const base = LOOT_TIER[poiKind] ?? 1;
  const t = base + Math.max(0, (tide | 0) - 1) * TIER.tide + Math.max(0, (security | 0) - 1) * TIER.security;
  return Math.max(0, Math.min(TIER.max, t));
}

// ---- what a tier is worth ----
// Depth moves the odds; it does not open the armoury. Even on the ridge four Tides in, three finds in four are
// ordinary and one in thirty is something the Committee would not sell you.
export const RARITY_BASE = { common: 62, uncommon: 22, rare: 3, epic: 0.15 };
export function rarityWeight(rarity, tier) {
  const t = Math.max(0, Math.min(TIER.max, tier));
  switch (rarity) {
    case 'common': return Math.max(10, 62 - 7 * t);
    case 'uncommon': return 22 + 2.5 * t;
    case 'rare': return 3 + 2.2 * t;
    case 'epic': return 0.15 + 0.55 * t;
    default: return 1;
  }
}
// Clearance-grade kit is scarce where the Committee has not been. An item's rank above the tier is squared away.
export function rankWeight(rank, tier) {
  const over = (rank || 1) - 1 - Math.max(0, tier);
  return over <= 0 ? 1 : 1 / (1 + over * over * 6);
}
// the weight of one catalogue entry in a roll at this tier
export function pickWeight(d, tier) { return d ? rarityWeight(d.rarity || 'common', tier) * rankWeight(d.rank || 1, tier) : 0; }

// ---- containers ----
// mesh: which body game/loot.js builds. rolls: [min,max] draws. categories: weights, keys resolved through
// CATEGORY_SOURCES. empty: chance the container was cleaned out before you got to it. tierMin: does not appear
// below that tier. locked: chance of a lock (lockpicks or the right key open it). scale: mesh scale override.
export const CONTAINERS = {
  ammo_tin:     { name: 'Ammo tin',         mesh: 'ammoTin',    rolls: [1, 2], categories: { ammo: 9, mag: 1.5 }, empty: 0.42 },
  ammo_crate:   { name: 'Ammunition crate', mesh: 'crate',      rolls: [1, 3], categories: { ammo: 9, mag: 2.5, grenade: 0.8 }, empty: 0.30, tierMin: 1 },
  med_bag:      { name: 'Medical bag',      mesh: 'medBag',     rolls: [1, 2], categories: { med: 8, food: 2 }, empty: 0.40 },
  med_cabinet:  { name: 'Medical cabinet',  mesh: 'cabinet',    rolls: [1, 3], categories: { med: 9, filter: 1.5, food: 1 }, empty: 0.45, tierMin: 1 },
  footlocker:   { name: 'Footlocker',       mesh: 'footlocker', rolls: [1, 3], categories: { tool: 4, food: 3, battery: 2, mag: 1.5, attachment: 1, armor: 0.35, weapon: 0.3 }, empty: 0.45 },
  weapon_crate: { name: 'Weapon crate',     mesh: 'crate',      rolls: [1, 2], categories: { weapon: 3, attachment: 3, mag: 4, ammo: 3 }, empty: 0.55, tierMin: 1, scale: [1.35, 0.8, 0.85] },
  weapon_rack:  { name: 'Weapon rack',      mesh: 'rack',       rolls: [1, 2], categories: { weapon: 4, mag: 4, attachment: 1.5, ammo: 2 }, empty: 0.62, tierMin: 2 },
  gun_case:     { name: 'Weapon case',      mesh: 'toolbox',    rolls: [1, 2], categories: { weapon: 2, attachment: 6, mag: 2 }, empty: 0.40, tierMin: 3, locked: 0.4, scale: [1.9, 0.65, 1.15] },
  armor_locker: { name: 'Armour locker',    mesh: 'cabinet',    rolls: [1, 2], categories: { armor: 3, helmet: 2.5, kit: 4 }, empty: 0.50, tierMin: 2, locked: 0.4 },
  toolbox:      { name: 'Toolbox',          mesh: 'toolbox',    rolls: [1, 2], categories: { tool: 5, part: 3, battery: 2 }, empty: 0.40 },
  tool_chest:   { name: 'Tool chest',       mesh: 'toolbox',    rolls: [1, 3], categories: { tool: 5, part: 4, battery: 2, attachment: 1 }, empty: 0.38, tierMin: 1, scale: [1.55, 1.4, 1.4] },
  ration_box:   { name: 'Ration box',       mesh: 'carton',     rolls: [1, 2], categories: { food: 9, med: 1 }, empty: 0.30 },
  // a body is not furniture: an Explorer who did not come back is still carrying what they went in with
  explorer_pack:{ name: 'Explorer’s pack',  mesh: 'pack',       rolls: [2, 4], categories: { ammo: 3, med: 3, food: 2, tool: 2, mag: 2, attachment: 1, artifact: 0.2, mission: 0.3 }, empty: 0.10 },
  field_cache:  { name: 'Field cache',      mesh: 'pack',       rolls: [2, 4], categories: { ammo: 3, med: 2, weapon: 1, attachment: 2, grenade: 1, kit: 1, artifact: 0.3 }, empty: 0.08, tierMin: 2, scale: [0.9, 0.9, 0.9] },
  safe:         { name: 'Safe',             mesh: 'safe',       rolls: [1, 3], categories: { attachment: 4, weapon: 1.2, artifact: 0.5, armor: 0.8, grenade: 1.2, key: 0.8 }, empty: 0.15, locked: 0.9, tierMin: 2 },
  desk:         { name: 'Desk',             mesh: 'desk',       rolls: [0, 1], categories: { food: 3, battery: 2, tool: 2, key: 0.6, med: 1 }, empty: 0.55 },
  shelf:        { name: 'Shelf',            mesh: 'carton',     rolls: [0, 1], categories: { food: 4, tool: 3, ammo: 2, battery: 2 }, empty: 0.55, scale: [0.85, 0.85, 0.85] },
};
// which container kinds appear at which POI kinds (weights). 'field' is roadside and open ground.
// The gate is picked clean of anything worth carrying: the racks and the lockers are deeper in, and that is
// the whole reason to walk further than the checkpoint.
export const CONTAINERS_BY_POI = {
  checkpoint: { ammo_tin: 4, footlocker: 3, med_bag: 2, desk: 2.5, weapon_crate: 0.5, weapon_rack: 0.4, armor_locker: 0.4 },
  convoy:     { ammo_crate: 4, ammo_tin: 3, footlocker: 2, weapon_crate: 0.8, toolbox: 2.5, ration_box: 2, tool_chest: 1, gun_case: 0.35 },
  village:    { shelf: 5, ration_box: 3, med_bag: 2, footlocker: 2, toolbox: 2, desk: 1.5, ammo_tin: 1, gun_case: 0.2 },
  industrial: { toolbox: 4, ammo_tin: 3, desk: 3, med_cabinet: 2, armor_locker: 1.4, tool_chest: 2, safe: 0.7, weapon_crate: 0.6, weapon_rack: 0.5 },
  church:     { shelf: 3, med_bag: 2, ration_box: 2, explorer_pack: 1, safe: 0.7, ammo_tin: 1, field_cache: 0.8 },
  rail:       { ammo_crate: 3, toolbox: 3, footlocker: 2, weapon_crate: 0.7, weapon_rack: 0.5, explorer_pack: 1, tool_chest: 1 },
  forest:     { ration_box: 3, ammo_tin: 2, med_bag: 1.5, explorer_pack: 1.2, toolbox: 1, field_cache: 0.7, footlocker: 0.5 },
  marsh:      { ammo_tin: 2, ration_box: 2, med_bag: 1.5, explorer_pack: 1.2, footlocker: 0.6 },
  anomaly:    { explorer_pack: 2, ammo_tin: 1.5, med_bag: 1.2, field_cache: 1, ration_box: 1 },
  ridge:      { explorer_pack: 1.5, ammo_crate: 1.5, safe: 1, weapon_crate: 1, field_cache: 1, armor_locker: 1, weapon_rack: 1, med_cabinet: 0.8 },
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
// Rounds per ammunition roll, by the rarity of the round. A tin holds part of a box, not a box: the Explorer
// who left it here had already been shooting. Two of these is a magazine, not a firefight.
export const AMMO_ROLL = { common: [7, 20], uncommon: [5, 14], rare: [3, 9], epic: [2, 5] };
// how many of a stackable roll into one slot; cheap things (CHEAP ₽ or less) come by the handful
export const COUNT_ROLL = { med: [1, 2], food: [1, 2], tool: [1, 1], part: [1, 1], battery: [1, 2], filter: [1, 1], grenade: [1, 1], artifact: [1, 1], key: [1, 1], mission: [1, 1] };
export const CHEAP = 40, CHEAP_MULT = 3;

// ---- the state gear is in when the zone hands it over ----
// Ranges are [at tier 0, at tier 5]. A weapon out of a crate is fouled, worn and part loaded; it is a find, not
// an issue. loose: the weapon may have no magazine in it at all. These numbers are the difference between
// "I found a rifle" and "I found something I can carry to the workbench and make into a rifle" — the second is
// the one worth the walk, because it costs solvent, a repair kit and a decision about what to leave behind.
export const FOUND = {
  weapon: { parts: [[10, 42], [32, 78]], dirt: [[0.45, 0.90], [0.25, 0.60]], loaded: [[0, 0.35], [0.1, 0.8]], noMag: [0.55, 0.25], attachment: [0.04, 0.35], attachments: [1, 2] },
  gear: { durability: [[0.15, 0.50], [0.35, 0.80]] },
  mag: { rounds: [[0, 0.40], [0.1, 0.75]], empty: [0.55, 0.28] },
};
// a locked container: how long the lock holds, and how many lockpick uses it eats
export const LOCK = { hold: 2.6, picks: 1 };
