// Body armour, helmets, backpacks, rigs and headgear. Armour class follows GOST-style 2..6 (see data/index.js resolveHit).
// zones: which hit zones the piece covers. durability: hit points of the armour itself. speed: movement multiplier. stamina: drain multiplier.
const V = (id, o) => [id, Object.assign({ id, kind: 'vest', zones: ['torso'], rank: 1, rarity: 'common', speed: 1, stamina: 1, repairCost: 0 }, o)];
const H = (id, o) => [id, Object.assign({ id, kind: 'helmet', zones: ['head'], rank: 1, rarity: 'common', speed: 1, stamina: 1, visor: false }, o)];
const P = (id, o) => [id, Object.assign({ id, kind: 'backpack', rank: 1, rarity: 'common', speed: 1, stamina: 1 }, o)];
const R = (id, o) => [id, Object.assign({ id, kind: 'rig', rank: 1, rarity: 'common', speed: 1, stamina: 1, armor: 0 }, o)];
const G = (id, o) => [id, Object.assign({ id, kind: 'headgear', rank: 1, rarity: 'common', weight: 0.4 }, o)];
const K = (id, o) => [id, Object.assign({ id, kind: 'mask', rank: 1, rarity: 'common', weight: 0.5 }, o)];
export const ARMOR = Object.fromEntries([
  // ---- vests ----
  V('vest_paca',   { name: 'PACA soft armour', cls: 2, durability: 60,  weight: 3.0, price: 2600, desc: 'Kevlar. Stops pistol rounds, nothing else.' }),
  V('vest_6b2',    { name: '6B2 flak vest', cls: 2, durability: 80,  weight: 4.2, price: 3200, rarity: 'common', desc: 'Titanium plates in nylon. Afghanistan surplus.' }),
  V('vest_kirasa', { name: 'Kirasa-N', cls: 3, durability: 90,  weight: 5.0, price: 6200, rank: 2, rarity: 'uncommon', zones: ['torso', 'stomach'] }),
  V('vest_6b23_1', { name: '6B23-1', cls: 3, durability: 110, weight: 6.5, price: 9000, rank: 2, rarity: 'uncommon', zones: ['torso', 'stomach'], stamina: 1.05 }),
  V('vest_6b23_2', { name: '6B23-2', cls: 4, durability: 130, weight: 8.4, price: 10000, rank: 3, rarity: 'rare', zones: ['torso', 'stomach'], speed: 0.97, stamina: 1.1 }),
  V('vest_zhuk',   { name: 'Zhuk-3 plate carrier', cls: 4, durability: 120, weight: 7.0, price: 11000, rank: 3, rarity: 'rare', zones: ['torso'], speed: 0.98, stamina: 1.06, desc: 'Ceramic plates front and back. Sides are cloth.' }),
  V('vest_iotv',   { name: 'IOTV with ESAPI', cls: 5, durability: 150, weight: 10.5, price: 16000, rank: 4, rarity: 'rare', zones: ['torso', 'stomach'], speed: 0.95, stamina: 1.15 }),
  V('vest_6b43',   { name: '6B43', cls: 6, durability: 180, weight: 14.5, price: 24000, rank: 5, rarity: 'epic', zones: ['torso', 'stomach', 'arms'], speed: 0.9, stamina: 1.25, desc: 'Full coverage. You will hear yourself breathing.' }),
  V('vest_fort',   { name: 'FORT Defender-2', cls: 5, durability: 170, weight: 12.0, price: 19000, rank: 4, rarity: 'epic', zones: ['torso', 'stomach', 'arms'], speed: 0.93, stamina: 1.2 }),
  // ---- helmets ----
  H('helm_ssh68',  { name: 'SSh-68 steel helmet', cls: 2, durability: 50, weight: 1.5, price: 1100, desc: 'Steel. Rings when hit.' }),
  H('helm_6b7',    { name: '6B7-1M', cls: 3, durability: 65, weight: 1.3, price: 3600, rank: 2, rarity: 'uncommon' }),
  H('helm_6b47',   { name: '6B47 Ratnik', cls: 3, durability: 75, weight: 1.1, price: 6400, rank: 3, rarity: 'uncommon', desc: 'Aramid. Mounts for a headlamp.' }),
  H('helm_kiver',  { name: 'Kiver-M', cls: 3, durability: 80, weight: 1.9, price: 5200, rank: 2, rarity: 'uncommon', visor: false }),
  H('helm_zsh',    { name: 'ZSh-1-2M', cls: 4, durability: 110, weight: 3.4, price: 8500, rank: 4, rarity: 'rare', visor: true, desc: 'Visor down: the world through a scratch.' }),
  H('helm_altyn',  { name: 'Altyn', cls: 4, durability: 130, weight: 4.0, price: 13000, rank: 5, rarity: 'epic', visor: true, stamina: 1.05, desc: 'Titanium with a visor. Committee issue for the Column.' }),
  H('helm_ach',    { name: 'ACH', cls: 3, durability: 85, weight: 1.4, price: 7200, rank: 3, rarity: 'uncommon' }),
  // ---- backpacks: capacity is carry weight in kg, on top of the 10 kg the Explorer carries without one ----
// This is the real ceiling on what the Radius is worth: a rifle is 3.5 kg and a plate carrier is seven, so
// what comes home is a choice and not a sweep. A bigger pack is a pay rise, and it costs like one.
  P('pack_none',   { name: 'No backpack', capacity: 0, weight: 0, price: 0, hidden: true }),
  P('pack_tortilla', { name: 'Tortilla daypack', capacity: 8, weight: 0.6, price: 900, desc: '20 litres.' }),
  P('pack_pilgrim', { name: 'Pilgrim pack', capacity: 14, weight: 1.1, price: 3200, rank: 2, rarity: 'uncommon', desc: '30 litres.' }),
  P('pack_attack2', { name: 'Attack 2 pack', capacity: 20, weight: 1.6, price: 7600, rank: 3, rarity: 'uncommon', desc: '45 litres.' }),
  P('pack_6sh118', { name: '6Sh118 raid pack', capacity: 28, weight: 2.4, price: 9000, rank: 4, rarity: 'rare', speed: 0.98, desc: '60 litres. The frame creaks.' }),
  // ---- rigs: readyMags is how many magazines sit in pouches (fast reloads); the rest ride in the pack ----
  R('rig_belt',    { name: 'Belt pouches', readyMags: 2, quick: 2, weight: 0.4, price: 400 }),
  R('rig_6sh112',  { name: '6Sh112 rig', readyMags: 4, quick: 3, weight: 0.9, price: 2400, rank: 2, rarity: 'uncommon' }),
  R('rig_alpha',   { name: 'Alpha chest rig', readyMags: 6, quick: 4, weight: 1.1, price: 5200, rank: 3, rarity: 'uncommon' }),
  R('rig_tv110',   { name: 'TV-110 plate carrier rig', readyMags: 6, quick: 4, weight: 2.4, price: 7000, rank: 4, rarity: 'rare', armor: 1, desc: 'Pouches over a soft insert. Wears under a vest.' }),
  R('rig_smersh',  { name: 'SMERSH vest', readyMags: 8, quick: 4, weight: 1.6, price: 6000, rank: 3, rarity: 'rare' }),
  // ---- headgear (one slot): night vision or headlamp ----
  G('head_lamp',   { name: 'Headlamp', price: 900, light: 18, battery: true, desc: 'Hands free. Everything sees it.' }),
  G('head_pnv57',  { name: 'PNV-57E night vision', price: 11000, rank: 3, rarity: 'rare', weight: 0.9, nvg: 1, battery: true, desc: 'Gen 1 tubes. Grain and bloom. Phantoms show.' }),
  G('head_1pn138', { name: '1PN138 night vision', price: 20000, rank: 4, rarity: 'epic', weight: 0.7, nvg: 2, battery: true, desc: 'Gen 2+. Clean picture.' }),
  // ---- masks ----
  K('mask_resp',   { name: 'Respirator', price: 550, gas: 0.5, filter: 100, desc: 'Halves the burn. Muffles you.' }),
  K('mask_gp5',    { name: 'GP-5 gas mask', price: 1900, rank: 2, rarity: 'uncommon', gas: 1.0, filter: 100, fov: 0.85, desc: 'Full protection. Fogged lenses.' }),
  K('mask_gp7',    { name: 'GP-7', price: 4400, rank: 3, rarity: 'rare', gas: 1.0, filter: 160, fov: 0.92 }),
]);
