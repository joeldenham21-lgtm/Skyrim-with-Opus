// Enemy classes. Population picks a class by POI and tide level; mimics carry these and DROP them.
// A class is a POOL, not a fixed kit. What a mimic actually walks out of the treeline with is that pool put
// through GEAR_CURVE below — the ONE place enemy gear difficulty is tuned. Progress runs 0..1 off the Tide
// level, the Explorer's clearance and the class's own rank: at 0 a recruit has a beaten Makarov, an empty
// spare and no vest; at 1 an elite has a suppressed modern rifle, an optic, class 5 plates and two grenades.
// enemies/loadout.js reads this; nothing else needs to know the shape.

// ---- the one dial ----
// Ranges written [at progress 0, at progress 1]; enemies/loadout.js interpolates.
export const GEAR_CURVE = {
  tide: 0.30,          // progress added per Tide level above the first
  security: 0.18,      // per clearance level above the first (the zone answers the Committee's paperwork)
  classRank: 0.10,     // an elite starts further along the curve than a recruit (rank 0..4)
  max: 1.0,
  grade: [-2.2, 3.2],  // exponent on an item's grade: negative picks the beaten end of a class pool, positive the good end
  bare: [0.85, 0.05],       // chance of no vest at all, times the class's own `bare`
  bareHelmet: [0.95, 0.12],
  spares: [-1, 2],          // added to the class `mags` count
  grenade: [0.3, 1.6],      // multiplier on the class grenade chance
  attach: [0.3, 1.5],       // multiplier on every attachment chance
  optic: 0.62,              // above this progress a class that owns optics is certain to have one fitted
  ammo: [0.0, 0.7],         // chance of reaching for the better round
  condition: [[25, 55], [55, 96]],      // weapon condition band, percent
  dirt: [[0.25, 0.7], [0.05, 0.35]],
  durability: [[0.35, 0.75], [0.6, 1.0]],   // fraction of an armour piece's durability left
  magFill: [[0.3, 0.9], [0.6, 1.0]],        // fraction of a spare magazine that is loaded
};
export function gearProgress({ tide = 1, security = 1, classRank = 0 } = {}) {
  const p = Math.max(0, (tide | 0) - 1) * GEAR_CURVE.tide + Math.max(0, (security | 0) - 1) * GEAR_CURVE.security + Math.max(0, classRank) * GEAR_CURVE.classRank;
  return Math.max(0, Math.min(GEAR_CURVE.max, p));
}

// ---- what is left when one folds ----
// The ash takes some of it. A weapon is usually on the ground; sometimes it is bent scrap worth stripping.
// Armour survives by the state it is in: a plate carrier that stopped six rounds is not worth carrying out.
export const DROPS = {
  weapon: 0.9,              // the weapon is recoverable at all
  ruined: [0.34, 0.08],     // of those, this many are wrecked (low condition, fouled, jammed) — by class rank 0..4
  lost: 0.06,               // and this many go into the ash with the body
  mag: 0.85,                // each spare magazine
  vest: [0.25, 0.85],       // by durability left, none -> full
  helmet: [0.2, 0.8],
  item: 0.5,                // each entry on the class drop list
  grenade: 0.75,
  loose: [0, 6],            // extra loose rounds in the pockets
};

// weapons/armor/helmet/kit are pools; the curve picks inside them. bare: how likely this class is to go without.
// mags: spare magazines before the curve. grenades: chance of carrying any. attachments: chance per fitting.
// drops: pocket litter, each rolled separately. accuracy: cone multiplier (lower is better).
export const MIMIC_CLASSES = {
  recruit: {
    name: 'Mimic', hp: 80, accuracy: 1.25, bare: 1.4, mags: 2, grenades: 0.05,
    weapons: ['pm', 'tt', 'toz', 'obrez', 'sks', 'mosin', 'ppsh', 'kedr', 'akm'],
    armor: ['vest_paca', 'vest_6b2'], helmet: ['helm_ssh68'], kit: ['rig_belt', 'pack_tortilla'],
    attachments: { light_klesch: 0.08 },
    drops: ['bandage', 'cigarettes', 'bread', 'probe', 'water'],
  },
  regular: {
    name: 'Mimic', hp: 90, accuracy: 1.0, bare: 0.8, mags: 3, grenades: 0.25,
    weapons: ['akm', 'akms', 'sks', 'aks74u', 'ak74m', 'mp153', 'saiga', 'bizon', 'vityaz', 'ak105'],
    armor: ['vest_paca', 'vest_6b2', 'vest_kirasa', 'vest_6b23_1'], helmet: ['helm_ssh68', 'helm_6b7', 'helm_kiver'],
    kit: ['rig_belt', 'rig_6sh112', 'pack_tortilla', 'mask_resp'],
    attachments: { opt_kobra: 0.2, opt_pka: 0.15, muz_dtk1: 0.15, rail_akcover: 0.1, light_klesch: 0.15 },
    drops: ['bandage', 'medkit', 'tushonka', 'battery', 'cleankit', 'part_spring'],
  },
  veteran: {
    name: 'Mimic', hp: 100, accuracy: 0.8, bare: 0.35, mags: 4, grenades: 0.5,
    weapons: ['ak74m', 'ak105', 'akms', 'vityaz', 'mp5', 'saiga', 'svd', 'rpk74', 'vss', 'ak12'],
    armor: ['vest_kirasa', 'vest_6b23_1', 'vest_6b23_2', 'vest_zhuk'], helmet: ['helm_6b7', 'helm_6b47', 'helm_kiver', 'helm_ach'],
    kit: ['rig_6sh112', 'rig_alpha', 'pack_pilgrim', 'mask_gp5', 'head_lamp'],
    attachments: { opt_kobra: 0.35, opt_1p78: 0.2, opt_pso1: 0.2, opt_1p29: 0.15, muz_pbs1: 0.2, muz_dtk1: 0.2, rail_akhg: 0.4, rail_akcover: 0.25, grip_rk1: 0.3, light_klesch: 0.45, laser_perst: 0.15 },
    drops: ['medkit', 'hemostat', 'morphine', 'repairkit', 'energy', 'part_bolt', 'filter'],
  },
  elite: {
    name: 'Mimic', hp: 110, accuracy: 0.65, bare: 0.15, mags: 5, grenades: 0.7,
    weapons: ['ak12', 'ak105', 'm4', 'hk416', 'scar', 'val', 'vss', 'sr3m', 'sv98'],
    armor: ['vest_zhuk', 'vest_iotv', 'vest_fort', 'vest_6b43'], helmet: ['helm_6b47', 'helm_ach', 'helm_zsh', 'helm_altyn'],
    kit: ['rig_alpha', 'rig_smersh', 'rig_tv110', 'pack_attack2', 'pack_6sh118', 'head_pnv57', 'mask_gp7'],
    attachments: { opt_t1: 0.4, opt_eotech: 0.3, opt_acog: 0.2, opt_specter: 0.15, muz_ar_sup: 0.4, muz_rotor43: 0.25, muz_comp556: 0.2, grip_afg: 0.4, grip_vert: 0.2, light_tlr1: 0.5, laser_dbal: 0.3, laser_perst: 0.25, stock_ctr: 0.3 },
    drops: ['medkit_ai2', 'adrenaline', 'armorkit', 'part_barrel', 'lockpick', 'energy'],
  },
  sniper: {
    name: 'Mimic marksman', hp: 90, accuracy: 0.5, bare: 0.7, mags: 3, grenades: 0.05, role: 'sniper',
    weapons: ['mosin', 'sks', 'svd', 'vss', 'sv98'],
    armor: ['vest_paca', 'vest_6b2', 'vest_kirasa'], helmet: ['helm_ssh68', 'helm_6b7'], kit: ['rig_belt', 'rig_6sh112', 'head_lamp'],
    attachments: { opt_pu: 0.6, opt_pso1: 0.6, rail_mosin: 0.6, opt_mark4: 0.3, opt_nspu: 0.15, muz_sv98_sup: 0.15, bipod: 0.25 },
    drops: ['morphine', 'binoculars', 'cigarettes', 'cleankit'],
  },
  gunner: {
    name: 'Mimic gunner', hp: 120, accuracy: 1.1, bare: 0.3, mags: 2, grenades: 0.15, role: 'gunner',
    weapons: ['rpk74', 'pkm'],
    armor: ['vest_6b23_1', 'vest_6b23_2', 'vest_zhuk', 'vest_iotv'], helmet: ['helm_ssh68', 'helm_6b47', 'helm_zsh'],
    kit: ['rig_6sh112', 'rig_smersh', 'pack_pilgrim'],
    attachments: { bipod: 0.5, opt_kobra: 0.15, light_klesch: 0.2 },
    drops: ['medkit', 'armorkit', 'tushonka', 'part_barrel'],
  },
  shotgunner: {
    name: 'Mimic', hp: 100, accuracy: 1.0, bare: 0.5, mags: 3, grenades: 0.3, role: 'breacher',
    weapons: ['toz', 'mp153', 'rem870', 'saiga'],
    armor: ['vest_paca', 'vest_kirasa', 'vest_6b23_1', 'vest_zhuk'], helmet: ['helm_ssh68', 'helm_kiver', 'helm_6b47'],
    kit: ['rig_belt', 'rig_6sh112', 'pack_tortilla'],
    attachments: { light_klesch: 0.4, light_tlr1: 0.2, grip_vert: 0.2 },
    drops: ['12_slug', 'bandage', 'hemostat', 'battery'],
  },
};
// class mix per tide level: weights
export const CLASS_MIX = {
  1: { recruit: 0.55, regular: 0.35, veteran: 0.06, shotgunner: 0.04 },
  2: { recruit: 0.25, regular: 0.4, veteran: 0.2, shotgunner: 0.07, sniper: 0.05, gunner: 0.03 },
  3: { recruit: 0.1, regular: 0.3, veteran: 0.3, elite: 0.12, shotgunner: 0.08, sniper: 0.06, gunner: 0.04 },
  4: { regular: 0.2, veteran: 0.35, elite: 0.25, shotgunner: 0.08, sniper: 0.07, gunner: 0.05 },
};
// POI danger tier (1..4) adds to the tide level for class selection
export const POI_TIER = { checkpoint: 1, convoy: 1, village: 1, marsh: 0, rail: 2, industrial: 2, church: 2, forest: 1, anomaly: 1, ridge: 3, base: 0 };
export const SEEKER = { hp: 700, cls: 6, weapons: ['pkm'], drops: ['mag_pkm100', 'part_barrel', 'armorkit', 'medkit_ai2', 'art_crown'] };
