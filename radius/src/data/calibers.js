// Calibres and ammunition. Damage is per bullet against bare flesh; pen is the armour class it defeats reliably
// (see data/index.js resolveHit). noise: hearing radius multiplier. speed: m/s (tracer/whiz timing). weight per round (kg).
export const CALIBERS = {
  '9x18':     { name: '9×18 mm Makarov',      short: '9×18',    weight: 0.010 },
  '9x19':     { name: '9×19 mm Parabellum',   short: '9×19',    weight: 0.012 },
  '7.62x25':  { name: '7.62×25 mm Tokarev',   short: '7.62×25', weight: 0.011 },
  '.45':      { name: '.45 ACP',              short: '.45',     weight: 0.021 },
  '5.45x39':  { name: '5.45×39 mm',           short: '5.45',    weight: 0.011 },
  '7.62x39':  { name: '7.62×39 mm',           short: '7.62×39', weight: 0.016 },
  '5.56x45':  { name: '5.56×45 mm NATO',      short: '5.56',    weight: 0.012 },
  '9x39':     { name: '9×39 mm',              short: '9×39',    weight: 0.023 },
  '7.62x54':  { name: '7.62×54R',             short: '7.62×54R',weight: 0.024 },
  '12ga':     { name: '12 gauge',             short: '12 ga',   weight: 0.040 },
};

// Ammunition types. id -> { cal, name, kind, damage, pen, pellets, noise, speed, price (per round), rank, rarity }
// kind: fmj | hp (expanding: more flesh damage, poor pen) | ap (armour piercing) | sub (subsonic: quiet, slower, less damage) | tracer | buck | slug | flechette
const A = (id, cal, name, kind, damage, pen, price, rank, rarity, extra = {}) => [id, Object.assign({ id, cal, name, kind, damage, pen, pellets: 1, noise: 1.0, speed: 340, price, rank, rarity, weight: CALIBERS[cal].weight }, extra)];
export const AMMO = Object.fromEntries([
  // 9x18
  A('9x18_fmj',  '9x18', '9×18 mm PM (FMJ)',           'fmj', 22, 1.4, 5,  1, 'common',   { speed: 315 }),
  A('9x18_hp',   '9x18', '9×18 mm PSO (expanding)',    'hp',  28, 0.8, 9,  1, 'common',   { speed: 300 }),
  A('9x18_ap',   '9x18', '9×18 mm PBM (AP)',           'ap',  18, 2.8, 17, 2, 'uncommon', { speed: 420 }),
  // 9x19
  A('9x19_fmj',  '9x19', '9×19 mm FMJ',                'fmj', 26, 1.8, 12,  2, 'uncommon',   { speed: 360 }),
  A('9x19_hp',   '9x19', '9×19 mm JHP',                'hp',  33, 1.0, 18, 2, 'uncommon', { speed: 350 }),
  A('9x19_ap',   '9x19', '9×19 mm 7N31 (AP)',          'ap',  21, 3.4, 34, 3, 'rare', { speed: 460 }),
  A('9x19_sub',  '9x19', '9×19 mm subsonic',           'sub', 24, 1.5, 22, 3, 'rare', { speed: 300, noise: 0.5 }),
  // 7.62x25
  A('762x25_fmj','7.62x25', '7.62×25 mm Tokarev (FMJ)','fmj', 28, 2.2, 7,  1, 'common',   { speed: 430 }),
  A('762x25_ap', '7.62x25', '7.62×25 mm P-41 (AP)',    'ap',  24, 3.2, 19, 2, 'rare',     { speed: 450 }),
  // .45
  A('45_fmj',    '.45', '.45 ACP FMJ',                 'fmj', 30, 1.5, 18,  2, 'rare', { speed: 260 }),
  A('45_hp',     '.45', '.45 ACP JHP',                 'hp',  38, 0.8, 27, 3, 'rare', { speed: 250 }),
  // 5.45x39
  A('545_fmj',   '5.45x39', '5.45×39 mm 7N6 (FMJ)',    'fmj', 34, 2.9, 17, 2, 'common',   { speed: 880 }),
  A('545_hp',    '5.45x39', '5.45×39 mm HP',           'hp',  42, 1.8, 24, 2, 'uncommon', { speed: 860 }),
  A('545_ap',    '5.45x39', '5.45×39 mm 7N22 (AP)',    'ap',  30, 4.4, 42, 3, 'rare', { speed: 890 }),
  A('545_tr',    '5.45x39', '5.45×39 mm 7T3 (tracer)', 'tracer', 32, 2.6, 19, 2, 'uncommon', { speed: 880, tracer: true }),
  // 7.62x39
  A('762_fmj',   '7.62x39', '7.62×39 mm 57-N-231 (FMJ)','fmj', 40, 3.4, 19, 1, 'common',  { speed: 715 }),
  A('762_hp',    '7.62x39', '7.62×39 mm HP',           'hp',  50, 2.0, 27, 2, 'uncommon', { speed: 700 }),
  A('762_ap',    '7.62x39', '7.62×39 mm BZ (AP)',      'ap',  36, 5.0, 46, 3, 'rare', { speed: 730 }),
  A('762_sub',   '7.62x39', '7.62×39 mm US (subsonic)','sub', 30, 2.2, 38, 3, 'rare',     { speed: 300, noise: 0.45 }),
  // 5.56x45
  A('556_fmj',   '5.56x45', '5.56×45 mm M855',         'fmj', 36, 3.0, 30, 3, 'uncommon', { speed: 900 }),
  A('556_hp',    '5.56x45', '5.56×45 mm HP',           'hp',  44, 1.8, 41, 3, 'rare', { speed: 880 }),
  A('556_ap',    '5.56x45', '5.56×45 mm M995 (AP)',    'ap',  31, 4.6, 66, 4, 'rare',     { speed: 910 }),
  // 9x39
  A('939_sp5',   '9x39', '9×39 mm SP-5',               'sub', 46, 2.6, 44, 3, 'rare', { speed: 290, noise: 0.4 }),
  A('939_sp6',   '9x39', '9×39 mm SP-6 (AP)',          'ap',  40, 5.2, 72, 4, 'rare',     { speed: 300, noise: 0.45 }),
  // 7.62x54R
  A('754_fmj',   '7.62x54', '7.62×54R LPS (FMJ)',      'fmj', 85, 5.0, 34, 2, 'uncommon', { speed: 830 }),
  A('754_ap',    '7.62x54', '7.62×54R 7N13 (AP)',      'ap',  74, 6.6, 66, 4, 'rare',     { speed: 840 }),
  A('754_snb',   '7.62x54', '7.62×54R 7N1 (sniper)',   'fmj', 92, 5.4, 55, 4, 'rare',     { speed: 830, accuracy: 0.7 }),
  // 12 gauge
  A('12_buck',   '12ga', '12 ga buckshot 00',          'buck', 9, 1.0, 16, 1, 'common',   { pellets: 8, speed: 400, spread: 7 }),
  A('12_slug',   '12ga', '12 ga slug',                 'slug', 80, 3.0, 34, 2, 'uncommon', { speed: 430 }),
  A('12_flech',  '12ga', '12 ga flechette',            'flechette', 7, 3.4, 58, 3, 'rare', { pellets: 10, speed: 500, spread: 5 }),
  A('12_rubber', '12ga', '12 ga rubber',               'buck', 4, 0.2, 8,  1, 'common',   { pellets: 1, speed: 280, blunt: true }),
]);
export const ammoOf = (cal) => Object.values(AMMO).filter((a) => a.cal === cal);
export const defaultAmmo = (cal) => ({ '9x18': '9x18_fmj', '9x19': '9x19_fmj', '7.62x25': '762x25_fmj', '.45': '45_fmj', '5.45x39': '545_fmj', '7.62x39': '762_fmj', '5.56x45': '556_fmj', '9x39': '939_sp5', '7.62x54': '754_fmj', '12ga': '12_buck' }[cal]);
