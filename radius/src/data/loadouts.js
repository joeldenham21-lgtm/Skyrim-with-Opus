// Enemy classes. Population picks a class by POI and tide level; mimics carry these and DROP them.
// weapon: [ids]; ammo: preferred ammo id per caliber (or default); attachments: chance-weighted; armor/helmet: optional; accuracy: cone multiplier (lower is better); hp.
export const MIMIC_CLASSES = {
  recruit: { name: 'Mimic', hp: 80, accuracy: 1.25, weapons: ['pm', 'tt', 'sks', 'toz', 'obrez', 'kedr', 'ppsh'], mags: 2, armor: [null, null, 'vest_paca'], helmet: [null, null, null, 'helm_ssh68'], grenades: 0, drops: ['bandage', 'cigarettes', 'bread', 'probe'] },
  regular: { name: 'Mimic', hp: 90, accuracy: 1.0, weapons: ['akm', 'akms', 'ak74m', 'aks74u', 'mp153', 'saiga', 'sks', 'bizon'], mags: 3, armor: ['vest_6b2', 'vest_paca', 'vest_kirasa', null], helmet: ['helm_ssh68', null, 'helm_6b7'], grenades: 0.25, attachments: { opt_kobra: 0.2, muz_dtk1: 0.15 }, drops: ['bandage', 'medkit', 'tushonka', 'battery', 'cleankit'] },
  veteran: { name: 'Mimic', hp: 100, accuracy: 0.8, weapons: ['ak74m', 'ak105', 'vityaz', 'mp5', 'saiga', 'svd', 'rpk74'], mags: 4, armor: ['vest_6b23_1', 'vest_6b23_2', 'vest_zhuk'], helmet: ['helm_6b47', 'helm_kiver', 'helm_6b7'], grenades: 0.5, attachments: { opt_kobra: 0.4, opt_pso1: 0.2, muz_pbs4: 0.2, rail_akhg: 0.4, grip_rk1: 0.3, light_klesch: 0.5 }, drops: ['medkit', 'hemostat', 'morphine', 'repairkit', 'energy'] },
  elite:   { name: 'Mimic', hp: 110, accuracy: 0.65, weapons: ['ak12', 'm4', 'hk416', 'scar', 'val', 'vss', 'sr3m', 'sv98'], mags: 5, armor: ['vest_iotv', 'vest_6b43', 'vest_fort'], helmet: ['helm_altyn', 'helm_zsh', 'helm_ach'], grenades: 0.7, attachments: { opt_t1: 0.4, opt_eotech: 0.3, opt_acog: 0.2, muz_ar_sup: 0.4, grip_afg: 0.4, light_tlr1: 0.6, laser_perst: 0.4 }, drops: ['medkit_ai2', 'adrenaline', 'armorkit', 'gr_f1', 'part_barrel'] },
  sniper:  { name: 'Mimic marksman', hp: 90, accuracy: 0.5, weapons: ['mosin', 'svd', 'sv98', 'vss'], mags: 3, armor: ['vest_6b2', 'vest_kirasa'], helmet: [null, 'helm_6b7'], grenades: 0, attachments: { opt_pso1: 0.9, opt_pu: 0.9, opt_mark4: 0.5 }, drops: ['754_ap', 'morphine', 'binoculars'], role: 'sniper' },
  gunner:  { name: 'Mimic gunner', hp: 120, accuracy: 1.1, weapons: ['rpk74', 'pkm'], mags: 2, armor: ['vest_6b23_2', 'vest_zhuk'], helmet: ['helm_6b47', 'helm_ssh68'], grenades: 0.2, attachments: {}, drops: ['medkit', 'armorkit'], role: 'gunner' },
  shotgunner: { name: 'Mimic', hp: 100, accuracy: 1.0, weapons: ['saiga', 'mp153', 'rem870'], mags: 3, armor: ['vest_6b23_1', 'vest_kirasa'], helmet: ['helm_kiver', 'helm_ssh68'], grenades: 0.3, attachments: { light_klesch: 0.5 }, drops: ['12_slug', 'bandage', 'hemostat'], role: 'breacher' },
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
export const SEEKER = { hp: 700, cls: 6, weapons: ['pkm'], drops: ['mag_pkm100', 'part_barrel', 'armorkit', 'art_crown'] };
