// Loot tables. A container rolls `rolls` times from its category weights; each category picks an item by rarity
// weight scaled by the location tier and tide level. Rarity weights by tier: see rarityWeight().
export const RARITY_BASE = { common: 60, uncommon: 25, rare: 10, epic: 2 };
export function rarityWeight(rarity, tier) {
  const t = Math.max(0, Math.min(4, tier));
  switch (rarity) {
    case 'common': return 60 - 8 * t;
    case 'uncommon': return 25 + 4 * t;
    case 'rare': return 6 + 5 * t;
    case 'epic': return 0.5 + 2.2 * t;
    default: return 1;
  }
}
// container kinds -> { rolls: [min,max], categories: { cat: weight } , empty: chance of being already looted }
export const CONTAINERS = {
  ammo_tin:     { name: 'Ammo tin',        rolls: [1, 3], categories: { ammo: 8, mag: 2 }, empty: 0.15 },
  ammo_crate:   { name: 'Ammunition crate', rolls: [2, 5], categories: { ammo: 8, mag: 3, grenade: 1 }, empty: 0.1, tierMin: 1 },
  med_bag:      { name: 'Medical bag',     rolls: [1, 3], categories: { med: 8, food: 2 }, empty: 0.15 },
  med_cabinet:  { name: 'Medical cabinet', rolls: [2, 4], categories: { med: 9, filter: 1 }, empty: 0.2 },
  footlocker:   { name: 'Footlocker',      rolls: [2, 4], categories: { tool: 4, food: 2, battery: 2, attachment: 1.5, armor: 0.6, weapon: 0.5 }, empty: 0.15 },
  weapon_crate: { name: 'Weapon crate',    rolls: [1, 2], categories: { weapon: 5, attachment: 3, mag: 3 }, empty: 0.25, tierMin: 1 },
  armor_locker: { name: 'Armour locker',   rolls: [1, 2], categories: { armor: 6, helmet: 3, rig: 2, pack: 1 }, empty: 0.3, tierMin: 1, locked: 0.35 },
  toolbox:      { name: 'Toolbox',         rolls: [1, 3], categories: { tool: 5, part: 3, battery: 2 }, empty: 0.15 },
  ration_box:   { name: 'Ration box',      rolls: [1, 3], categories: { food: 9, med: 1 }, empty: 0.1 },
  explorer_pack:{ name: 'Explorer’s pack', rolls: [3, 6], categories: { ammo: 3, med: 3, food: 2, tool: 2, mag: 2, artifact: 0.8, attachment: 1, mission: 0.5 }, empty: 0 },
  safe:         { name: 'Safe',            rolls: [2, 4], categories: { artifact: 3, attachment: 3, weapon: 2, armor: 1, grenade: 1 }, empty: 0.1, locked: 0.9, tierMin: 2 },
  desk:         { name: 'Desk',            rolls: [0, 2], categories: { food: 3, battery: 2, tool: 2, mission: 0.5, key: 0.6 }, empty: 0.3 },
  shelf:        { name: 'Shelf',           rolls: [0, 2], categories: { food: 4, tool: 3, ammo: 2, battery: 2 }, empty: 0.3 },
};
// which container kinds appear at which POI kinds (weights)
export const CONTAINERS_BY_POI = {
  checkpoint: { ammo_tin: 4, footlocker: 3, med_bag: 2, desk: 2, weapon_crate: 1 },
  convoy:     { ammo_crate: 4, ammo_tin: 3, footlocker: 2, weapon_crate: 2, toolbox: 2, ration_box: 2 },
  village:    { shelf: 5, ration_box: 3, med_bag: 2, footlocker: 2, toolbox: 2, desk: 1, ammo_tin: 1 },
  industrial: { toolbox: 4, ammo_tin: 3, desk: 3, med_cabinet: 2, armor_locker: 2, safe: 1, weapon_crate: 1 },
  church:     { shelf: 3, med_bag: 2, explorer_pack: 2, safe: 1, ammo_tin: 1 },
  rail:       { ammo_crate: 3, toolbox: 3, footlocker: 2, weapon_crate: 1, explorer_pack: 1 },
  forest:     { explorer_pack: 3, ration_box: 2, ammo_tin: 1 },
  marsh:      { explorer_pack: 2, ammo_tin: 1, med_bag: 1 },
  anomaly:    { explorer_pack: 3 },
  ridge:      { explorer_pack: 2, safe: 1, weapon_crate: 1 },
};
// ammo quantity per roll by rarity of the round
export const AMMO_ROLL = { common: [12, 40], uncommon: [8, 24], rare: [5, 15], epic: [3, 8] };
