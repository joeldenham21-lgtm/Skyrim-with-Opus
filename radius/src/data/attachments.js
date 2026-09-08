// Attachments. slot: top | muzzle | under | side | stock | rail (a rail converts a mount standard: e.g. AK dust cover adds picatinny top).
// fits: mount standard(s) the attachment needs on the weapon slot. effects: multipliers/additions applied by weapons.js.
//   zoom (ADS magnification), reticle ('dot'|'holo'|'pso'|'pu'|'acog'|'mildot'|'chevron'), adsSpeed (mult), recoil (mult), moa (mult), noise (mult),
//   flash (0..1 muzzle flash visibility), light (spot intensity), laser (bool: hip accuracy mult 0.7), ergo (add), weight (kg), nvOptic (bool)
const T = (id, o) => [id, Object.assign({ id, kind: 'attachment', rank: 1, rarity: 'common', weight: 0.2, effects: {} }, o)];
export const ATTACHMENTS = Object.fromEntries([
  // rails and mounts
  T('rail_akcover',  { name: 'Railed dust cover (AK)', slot: 'rail', fits: ['dovetail'], gives: { top: 'picatinny' }, price: 600, rank: 2, rarity: 'uncommon', weight: 0.3, desc: 'Replaces the AK dust cover with a Picatinny top rail.' }),
  T('rail_akhg',     { name: 'Railed handguard (AK)', slot: 'rail', fits: ['akhg'], gives: { under: 'picatinny', side: 'picatinny' }, price: 800, rank: 2, rarity: 'uncommon', weight: 0.35, desc: 'Zenit-style handguard: rails under and on the side.' }),
  T('rail_dovpic',   { name: 'Dovetail to Picatinny adapter', slot: 'rail', fits: ['dovetail'], gives: { top: 'picatinny' }, price: 350, rank: 2, rarity: 'common', weight: 0.15 }),
  T('rail_mosin',    { name: 'Mosin scope mount', slot: 'rail', fits: ['mosin'], gives: { top: 'pu' }, price: 300, rank: 1, rarity: 'common', weight: 0.2 }),
  // optics: dovetail
  T('opt_okp7',      { name: 'OKP-7 collimator', slot: 'top', fits: ['dovetail'], price: 800, rank: 1, rarity: 'common', weight: 0.28, effects: { zoom: 1.0, reticle: 'dot', adsSpeed: 1.06, moa: 0.92 }, desc: 'Open collimator, scratched glass. Sits low on the side rail.' }),
  T('opt_kobra',     { name: 'Kobra EKP-8-02', slot: 'top', fits: ['dovetail'], price: 1400, rank: 2, rarity: 'uncommon', weight: 0.35, effects: { zoom: 1.0, reticle: 'dot', adsSpeed: 1.05, moa: 0.9 }, desc: 'Collimator sight on the AK side rail.' }),
  T('opt_pka',       { name: 'PK-A', slot: 'top', fits: ['dovetail'], price: 1200, rank: 2, rarity: 'uncommon', weight: 0.3, effects: { zoom: 1.0, reticle: 'dot', moa: 0.9 } }),
  T('opt_1p78',      { name: '1P78 Kashtan', slot: 'top', fits: ['dovetail'], price: 2600, rank: 3, rarity: 'rare', weight: 0.5, effects: { zoom: 2.8, reticle: 'chevron', adsSpeed: 0.9, moa: 0.8 } }),
  T('opt_pso1',      { name: 'PSO-1', slot: 'top', fits: ['dovetail'], price: 2200, rank: 3, rarity: 'uncommon', weight: 0.6, effects: { zoom: 4.0, reticle: 'pso', adsSpeed: 0.8, moa: 0.7 }, desc: 'Four power. The Dragunov sight.' }),
  T('opt_1p29',      { name: '1P29', slot: 'top', fits: ['dovetail'], price: 2400, rank: 3, rarity: 'rare', weight: 0.55, effects: { zoom: 4.0, reticle: 'chevron', adsSpeed: 0.82, moa: 0.72 } }),
  T('opt_pu',        { name: 'PU 3.5×', slot: 'top', fits: ['pu'], price: 900, rank: 1, rarity: 'uncommon', weight: 0.3, effects: { zoom: 3.5, reticle: 'pu', adsSpeed: 0.85, moa: 0.75 } }),
  // optics: picatinny
  T('opt_t1',        { name: 'Aimpoint T-1', slot: 'top', fits: ['picatinny', 'pistol'], price: 2200, rank: 3, rarity: 'uncommon', weight: 0.12, effects: { zoom: 1.0, reticle: 'dot', adsSpeed: 1.08, moa: 0.9 } }),
  T('opt_eotech',    { name: 'EOTech 553', slot: 'top', fits: ['picatinny'], price: 2800, rank: 3, rarity: 'rare', weight: 0.33, effects: { zoom: 1.0, reticle: 'holo', adsSpeed: 1.05, moa: 0.88 } }),
  T('opt_valday',    { name: 'Valday PSU-1', slot: 'top', fits: ['picatinny'], price: 3000, rank: 3, rarity: 'rare', weight: 0.3, effects: { zoom: 1.0, reticle: 'holo', adsSpeed: 1.06, moa: 0.88 }, desc: 'Holographic. Draws on the battery and shows a ring you can shoot through.' }),
  T('opt_acog',      { name: 'ACOG 4×', slot: 'top', fits: ['picatinny'], price: 4200, rank: 4, rarity: 'rare', weight: 0.42, effects: { zoom: 4.0, reticle: 'acog', adsSpeed: 0.85, moa: 0.7 } }),
  T('opt_specter',   { name: 'Elcan Specter 1-4×', slot: 'top', fits: ['picatinny'], price: 5200, rank: 4, rarity: 'epic', weight: 0.68, effects: { zoom: 4.0, zoomLow: 1.0, reticle: 'chevron', adsSpeed: 0.9, moa: 0.75 }, desc: 'Flip between 1× and 4×.' }),
  T('opt_mark4',     { name: 'Leupold Mark 4 8×', slot: 'top', fits: ['picatinny'], price: 6400, rank: 5, rarity: 'epic', weight: 0.7, effects: { zoom: 8.0, reticle: 'mildot', adsSpeed: 0.7, moa: 0.6 } }),
  T('opt_nspu',      { name: 'NSPU night sight', slot: 'top', fits: ['dovetail'], price: 5800, rank: 4, rarity: 'rare', weight: 1.4, effects: { zoom: 3.5, reticle: 'chevron', adsSpeed: 0.7, moa: 0.75, nvOptic: true }, desc: 'Image intensifier. Sees in the dark, hates the torch.' }),
  // muzzle devices
  T('muz_pbs1',      { name: 'PBS-1 suppressor', slot: 'muzzle', fits: ['m14'], price: 1800, rank: 2, rarity: 'uncommon', weight: 0.45, effects: { noise: 0.35, flash: 0.1, recoil: 0.92, moa: 0.95, wear: 1.3 } }),
  T('muz_pbs4',      { name: 'PBS-4 suppressor', slot: 'muzzle', fits: ['m24'], price: 2000, rank: 3, rarity: 'uncommon', weight: 0.5, effects: { noise: 0.35, flash: 0.1, recoil: 0.92, wear: 1.3 } }),
  T('muz_rotor43',   { name: 'Rotor 43 suppressor', slot: 'muzzle', fits: ['m13', 'trilug'], price: 1600, rank: 3, rarity: 'uncommon', weight: 0.4, effects: { noise: 0.3, flash: 0.1, recoil: 0.9 } }),
  T('muz_ar_sup',    { name: 'Surefire suppressor', slot: 'muzzle', fits: ['half28'], price: 2600, rank: 4, rarity: 'rare', weight: 0.5, effects: { noise: 0.35, flash: 0.1, recoil: 0.9, wear: 1.2 } }),
  T('muz_sv98_sup',  { name: 'SV-98 suppressor', slot: 'muzzle', fits: ['m18'], price: 3200, rank: 5, rarity: 'rare', weight: 0.9, effects: { noise: 0.4, flash: 0.1, recoil: 0.85 } }),
  T('muz_dtk1',      { name: 'DTK-1 muzzle brake', slot: 'muzzle', fits: ['m14', 'm24'], price: 700, rank: 1, rarity: 'common', weight: 0.15, effects: { recoil: 0.8, noise: 1.15, flash: 1.2 } }),
  T('muz_comp556',   { name: 'JP compensator', slot: 'muzzle', fits: ['half28'], price: 900, rank: 3, rarity: 'uncommon', weight: 0.1, effects: { recoil: 0.8, noise: 1.1 } }),
  T('muz_flash',     { name: 'Flash hider', slot: 'muzzle', fits: ['half28', 'm24', 'm14'], price: 350, rank: 2, rarity: 'common', weight: 0.08, effects: { flash: 0.35 } }),
  // underbarrel
  T('grip_rk1',      { name: 'RK-1 foregrip', slot: 'under', fits: ['picatinny'], price: 600, rank: 2, rarity: 'common', weight: 0.14, effects: { recoil: 0.88, ergo: 0.05 } }),
  T('grip_afg',      { name: 'AFG angled grip', slot: 'under', fits: ['picatinny'], price: 550, rank: 2, rarity: 'common', weight: 0.08, effects: { recoil: 0.9, adsSpeed: 1.05 } }),
  T('grip_vert',     { name: 'Vertical grip', slot: 'under', fits: ['picatinny'], price: 400, rank: 2, rarity: 'common', weight: 0.12, effects: { recoil: 0.85 } }),
  T('bipod',         { name: 'Harris bipod', slot: 'under', fits: ['picatinny'], price: 1200, rank: 3, rarity: 'uncommon', weight: 0.4, effects: { recoil: 0.6, moa: 0.8, ergo: -0.1, prone: true }, desc: 'Steadies the rifle when crouched and still.' }),
  T('light_klesch',  { name: 'Klesch-2P weapon light', slot: 'under', fits: ['picatinny', 'pistol'], price: 900, rank: 2, rarity: 'uncommon', weight: 0.13, effects: { light: 30 } }),
  T('light_tlr1',    { name: 'TLR-1 weapon light', slot: 'under', fits: ['pistol', 'picatinny'], price: 1100, rank: 3, rarity: 'uncommon', weight: 0.12, effects: { light: 34 } }),
  T('light_zenit2u', { name: 'Zenit 2U side light', slot: 'side', fits: ['picatinny'], price: 850, rank: 2, rarity: 'uncommon', weight: 0.16, effects: { light: 28 } }),
  T('laser_perst',   { name: 'Perst-3 laser', slot: 'side', fits: ['picatinny'], price: 1600, rank: 3, rarity: 'rare', weight: 0.12, effects: { laser: true } }),
  T('laser_dbal',    { name: 'DBAL laser/light', slot: 'side', fits: ['picatinny'], price: 2400, rank: 4, rarity: 'rare', weight: 0.2, effects: { laser: true, light: 22 } }),
  // stocks
  T('stock_pt1',     { name: 'Zenit PT-1 stock', slot: 'stock', fits: ['ak'], price: 1400, rank: 3, rarity: 'uncommon', weight: 0.45, effects: { recoil: 0.9, ergo: 0.08 } }),
  T('stock_ctr',     { name: 'Magpul CTR stock', slot: 'stock', fits: ['ar'], price: 900, rank: 3, rarity: 'uncommon', weight: 0.25, effects: { recoil: 0.92, adsSpeed: 1.05 } }),
  T('stock_riser',   { name: 'Cheek riser', slot: 'stock', fits: ['ak', 'ar', 'fixed'], price: 300, rank: 1, rarity: 'common', weight: 0.12, effects: { adsSpeed: 1.06, moa: 0.94 }, desc: 'Foam and webbing. Your eye lands where the sight already is.' }),
  T('stock_akpad',   { name: 'Recoil pad', slot: 'stock', fits: ['ak', 'ar', 'fixed'], price: 250, rank: 1, rarity: 'common', weight: 0.1, effects: { recoil: 0.94 } }),
]);
// does an attachment fit a weapon (given rails already installed)?
export function attachmentFits(att, weaponDef, installedRails = []) {
  const mounts = effectiveMounts(weaponDef, installedRails);
  if (att.slot === 'rail') return att.fits.some((f) => Object.values(weaponDef.mounts).includes(f));
  const std = mounts[att.slot];
  return !!std && att.fits.includes(std);
}
export function effectiveMounts(weaponDef, installedRails = []) {
  const m = Object.assign({}, weaponDef.mounts);
  for (const rid of installedRails) { const r = ATTACHMENTS[rid]; if (r && r.gives) Object.assign(m, r.gives); }
  return m;
}
