// Weapon upgrade parts: the bench catalogue. Attachments (attachments.js) hang off rails; these are the parts of the
// gun itself — the barrel in the trunnion, the carrier in the receiver, the fire control, the furniture. One part per
// slot per weapon; fitting one replaces whatever was there and the factory part goes back on the armourer's shelf.
//
// Everything here is data. To add a part, add a line to UPGRADES: nothing outside this file names an upgrade id.
//   slot     which UPGRADE_SLOTS entry it goes in
//   tier     0 surplus (at or below factory) · 1 serviceable · 2 select · 3 hand-fitted. Shown to the player.
//   rank     security clearance needed to have it fitted (and to buy it from the crate)
//   price    what the crate charges; the bench's fitting fee is a fraction of it (FIT.labour)
//   weight   carried weight in the pack.  dw: what fitting it does to the weapon's weight, against the factory part
//   fits     which weapons will take it (see matches(): cls/notCls/family/cal/action/notAction/auto/id/notId/mount)
//   gives    mount standards the part adds, exactly like a rail attachment (a threaded barrel earns a muzzle mount)
//   effects  multipliers merged by inventory.weaponEffects():
//              moa (dispersion) · recoil · adsSpeed · ergo (added, not multiplied) · noise · flash
//              wear (condition lost per shot) · rpm (cycle speed) · jam (stoppage chance) · damage
//            Every one of them is under 1 for better and over 1 for worse, except ergo/adsSpeed/rpm/damage.
// The parts register themselves into ITEMS as kind 'part', so they turn up in toolboxes and tool chests in the zone
// and on the supply crate's parts shelf at their clearance, with no id lists anywhere else.
import { ITEMS } from './items.js';

// ---------------------------------------------------------------------------------------------------------------
// slots
// ---------------------------------------------------------------------------------------------------------------
// restores: the condition part (w.parts) that a fresh part of this kind brings back to 100 %. A trigger group and a
// set of furniture do not carry the weapon's wear, so they restore nothing.
export const UPGRADE_SLOTS = [
  { id: 'barrel', name: 'Barrel', restores: 'barrel', applies: null,
    note: 'Bore, crown and gas port. Sets what the weapon can hold at distance and how fast it shoots itself out.' },
  { id: 'bolt', name: 'Bolt group', restores: 'bolt', applies: { notAction: ['break'] },
    note: 'Carrier, bolt and springs. Sets how fast the action runs and how often it stops.' },
  { id: 'trigger', name: 'Trigger group', restores: null, applies: null,
    note: 'Sear, disconnector, hammer springs. A clean break is worth more than a better sight.' },
  { id: 'furniture', name: 'Furniture', alt: { pistol: 'Grips' }, restores: null, applies: null,
    note: 'Stock, handguard, grip. What the weapon does to your shoulder and how fast it comes up.' },
];
export const SLOT_BY_ID = Object.fromEntries(UPGRADE_SLOTS.map((s) => [s.id, s]));
export const TIER_NAME = ['surplus', 'serviceable', 'select', 'hand-fitted'];

// ---------------------------------------------------------------------------------------------------------------
// the catalogue
// ---------------------------------------------------------------------------------------------------------------
const U = (id, o) => [id, Object.assign({ id, kind: 'part', upgrade: true, tier: 1, rank: 1, rarity: 'common', weight: 0.4, dw: 0, stack: 3, price: 500, effects: {}, fits: null }, o)];
export const UPGRADES = Object.fromEntries([
  // ---- barrels ----------------------------------------------------------------------------------------------
  U('up_barrel_surplus', { name: 'Surplus barrel', slot: 'barrel', tier: 0, rank: 1, rarity: 'common', price: 320, weight: 0.85, dw: 0,
    effects: { moa: 1.06, damage: 0.99 }, desc: 'Pulled off a receiver nobody is going to miss. The bore is honest enough.' }),
  U('up_barrel_relined', { name: 'Relined barrel', slot: 'barrel', tier: 1, rank: 2, rarity: 'common', price: 950, weight: 0.9, dw: 0.02,
    effects: { moa: 0.95, wear: 0.9 }, desc: 'A sleeve pressed into a tired tube and re-crowned. Cheap, and it shoots.' }),
  U('up_barrel_chrome', { name: 'Chrome-lined barrel', slot: 'barrel', tier: 1, rank: 2, rarity: 'uncommon', price: 1500, weight: 0.95, dw: 0.03,
    effects: { moa: 0.92, wear: 0.78, damage: 1.02 }, desc: 'Hard chrome over the lands. Fouls slower and lasts twice as long.' }),
  U('up_barrel_chf', { name: 'Cold hammer-forged barrel', slot: 'barrel', tier: 2, rank: 3, rarity: 'uncommon', price: 3200, weight: 1.05, dw: 0.1,
    effects: { moa: 0.85, wear: 0.68, damage: 1.04 }, desc: 'Forged around a mandrel. Even rifling, even wear, and it will outlive the receiver.' }),
  U('up_barrel_match', { name: 'Match-grade barrel', slot: 'barrel', tier: 3, rank: 4, rarity: 'rare', price: 6800, weight: 1.25, dw: 0.25,
    fits: { notCls: ['shotgun'] }, effects: { moa: 0.74, wear: 0.8, damage: 1.06, ergo: -0.03 },
    desc: 'Cut rifling, air-gauged, lapped by hand. Heavy at the muzzle and worth every gram of it.' }),
  U('up_barrel_short', { name: 'Shortened barrel', slot: 'barrel', tier: 1, rank: 2, rarity: 'common', price: 700, weight: 0.55, dw: -0.25,
    fits: { cls: ['rifle', 'smg', 'shotgun', 'sniper'] }, effects: { moa: 1.16, adsSpeed: 1.12, ergo: 0.09, noise: 1.12, damage: 0.96 },
    desc: 'Hacked back and re-crowned on the bench. Louder, wilder, and it clears a doorway.' }),
  U('up_barrel_heavy', { name: 'Heavy-profile barrel', slot: 'barrel', tier: 2, rank: 3, rarity: 'uncommon', price: 2600, weight: 1.6, dw: 0.55,
    fits: { cls: ['rifle', 'sniper', 'mg'] }, effects: { moa: 0.9, recoil: 0.85, ergo: -0.09, adsSpeed: 0.94 },
    desc: 'A bull profile. It hangs on the front hand and it does not move when the round goes.' }),
  U('up_barrel_thread_p', { name: 'Threaded pistol barrel', slot: 'barrel', tier: 1, rank: 2, rarity: 'uncommon', price: 1200, weight: 0.35, dw: 0.06,
    fits: { cls: ['pistol'], mount: { muzzle: 'none' } }, gives: { muzzle: 'm13' }, effects: { moa: 0.97 },
    desc: 'Machined longer and cut 1/2×28 at the muzzle. Now something can go on the end of it.' }),
  U('up_barrel_thread_r', { name: 'Threaded barrel', slot: 'barrel', tier: 1, rank: 3, rarity: 'uncommon', price: 1500, weight: 0.9, dw: 0.05,
    fits: { notCls: ['pistol'], mount: { muzzle: 'none' } }, gives: { muzzle: 'm24' }, effects: { moa: 0.97 },
    desc: 'The muzzle turned down and cut 24×1.5. A can, a brake, whatever you carry.' }),

  // ---- bolt groups ------------------------------------------------------------------------------------------
  U('up_bolt_surplus', { name: 'Surplus bolt group', slot: 'bolt', tier: 0, rank: 1, rarity: 'common', price: 260, weight: 0.5, dw: 0,
    effects: { jam: 1.12, rpm: 0.98 }, desc: 'Someone else’s carrier, someone else’s wear pattern. It runs.' }),
  U('up_bolt_polished', { name: 'Polished carrier', slot: 'bolt', tier: 1, rank: 2, rarity: 'common', price: 1100, weight: 0.5, dw: -0.01,
    effects: { jam: 0.76, rpm: 1.03, wear: 0.92 }, desc: 'Rails stoned smooth and the whole group deburred. Half an hour with a stone, twice the reliability.' }),
  U('up_bolt_chrome', { name: 'Chromed carrier and piston', slot: 'bolt', tier: 2, rank: 3, rarity: 'uncommon', price: 2700, weight: 0.52, dw: 0.01,
    effects: { jam: 0.55, rpm: 1.06, recoil: 0.96, wear: 0.76 }, desc: 'Hard-chromed bearing surfaces. Carbon does not stick and neither does anything else.' }),
  U('up_bolt_tuned', { name: 'Hand-fitted carrier', slot: 'bolt', tier: 3, rank: 4, rarity: 'rare', price: 6200, weight: 0.55, dw: 0.02,
    effects: { jam: 0.36, rpm: 1.12, recoil: 0.9, wear: 0.72 }, desc: 'Headspaced, lapped and timed to this receiver and no other. It will not stop.' }),
  U('up_bolt_heavy', { name: 'Heavy carrier', slot: 'bolt', tier: 2, rank: 3, rarity: 'uncommon', price: 2200, weight: 0.75, dw: 0.18,
    fits: { auto: true }, effects: { recoil: 0.82, rpm: 0.9, jam: 0.7, wear: 0.9 },
    desc: 'Mass added at the rear. The gun cycles slower and stops trying to climb.' }),
  U('up_bolt_light', { name: 'Lightened carrier', slot: 'bolt', tier: 2, rank: 3, rarity: 'uncommon', price: 2400, weight: 0.38, dw: -0.12,
    fits: { auto: true }, effects: { rpm: 1.2, recoil: 1.08, jam: 1.06 },
    desc: 'Milled out to nothing. It runs hot and fast and it is fussier about dirt.' }),
  U('up_bolt_lapped', { name: 'Lapped bolt and lugs', slot: 'bolt', tier: 2, rank: 3, rarity: 'uncommon', price: 1800, weight: 0.45, dw: 0,
    fits: { action: ['bolt', 'pump'] }, effects: { jam: 0.5, rpm: 1.15, moa: 0.94 },
    desc: 'Lugs lapped to full contact and the raceway polished. The handle falls open on its own.' }),

  // ---- trigger groups ---------------------------------------------------------------------------------------
  U('up_trig_surplus', { name: 'Surplus fire control', slot: 'trigger', tier: 0, rank: 1, rarity: 'common', price: 180, weight: 0.2, dw: 0,
    effects: { moa: 1.04 }, desc: 'Gritty, heavy, and it goes bang. Two of the three matter.' }),
  U('up_trig_polish', { name: 'Stoned sear and disconnector', slot: 'trigger', tier: 1, rank: 1, rarity: 'common', price: 650, weight: 0.2, dw: 0,
    effects: { moa: 0.95, ergo: 0.04 }, desc: 'The engagement surfaces taken down with a stone. The creep is gone.' }),
  U('up_trig_two', { name: 'Two-stage trigger group', slot: 'trigger', tier: 2, rank: 3, rarity: 'uncommon', price: 2000, weight: 0.24, dw: 0.01,
    effects: { moa: 0.88, ergo: 0.08, adsSpeed: 1.03 }, desc: 'Take-up, then a wall, then the shot. You stop pulling the muzzle off.' }),
  U('up_trig_match', { name: 'Match trigger, 1.2 kg break', slot: 'trigger', tier: 3, rank: 4, rarity: 'rare', price: 4500, weight: 0.24, dw: 0.01,
    effects: { moa: 0.8, ergo: 0.12, adsSpeed: 1.05 }, desc: 'Glass. It surprises you every time, which is the point.' }),
  U('up_trig_fast', { name: 'Lightened hammer and springs', slot: 'trigger', tier: 2, rank: 3, rarity: 'uncommon', price: 1800, weight: 0.18, dw: -0.02,
    fits: { auto: true }, effects: { rpm: 1.1, moa: 1.05, jam: 1.08 },
    desc: 'Less hammer, lighter springs, a faster cycle. Light primer strikes are the price.' }),
  U('up_trig_set', { name: 'Set trigger', slot: 'trigger', tier: 3, rank: 4, rarity: 'rare', price: 3800, weight: 0.22, dw: 0.01,
    fits: { action: ['bolt'] }, effects: { moa: 0.78, ergo: 0.06 },
    desc: 'Push it forward and the second stage weighs nothing. For a shot you have time to take.' }),

  // ---- furniture --------------------------------------------------------------------------------------------
  U('up_furn_surplus', { name: 'Split wood furniture', slot: 'furniture', tier: 0, rank: 1, rarity: 'common', price: 120, weight: 0.6, dw: 0.05,
    fits: { notCls: ['pistol'] }, effects: { ergo: -0.05, recoil: 1.05 }, desc: 'Laminate with a crack down the handguard, wired at both ends.' }),
  U('up_furn_polymer', { name: 'Polymer furniture set', slot: 'furniture', tier: 1, rank: 2, rarity: 'common', price: 800, weight: 0.5, dw: -0.2,
    fits: { notCls: ['pistol'] }, effects: { ergo: 0.06, recoil: 0.96 }, desc: 'Plum polymer, factory issue. Lighter than the wood and it does not swell in the marsh.' }),
  U('up_furn_folding', { name: 'Folding stock', slot: 'furniture', tier: 1, rank: 2, rarity: 'common', price: 900, weight: 0.55, dw: -0.15,
    fits: { notCls: ['pistol', 'sniper'] }, effects: { ergo: 0.1, recoil: 1.06, adsSpeed: 1.04 },
    desc: 'A side-folder with some play in the hinge. Quick to bring up, less to lean on.' }),
  U('up_furn_zenit', { name: 'Zenit furniture set', slot: 'furniture', tier: 2, rank: 3, rarity: 'uncommon', price: 2400, weight: 0.7, dw: 0.15,
    fits: { family: ['ak762', 'ak545'] }, effects: { ergo: 0.12, recoil: 0.9, adsSpeed: 1.06 },
    desc: 'Aluminium handguard, PT-1 tube, a grip your hand agrees with. The AK stops fighting you.' }),
  U('up_furn_mlok', { name: 'M-LOK handguard and adjustable stock', slot: 'furniture', tier: 3, rank: 4, rarity: 'rare', price: 4800, weight: 0.6, dw: -0.1,
    fits: { family: ['ar', 'vityaz'] }, effects: { ergo: 0.16, recoil: 0.86, adsSpeed: 1.1, moa: 0.95 },
    desc: 'Free-float tube and a stock set to your length of pull. Nothing touches the barrel any more.' }),
  U('up_furn_bedded', { name: 'Bedded stock', slot: 'furniture', tier: 2, rank: 3, rarity: 'uncommon', price: 1900, weight: 0.9, dw: 0.1,
    fits: { cls: ['sniper'] }, effects: { moa: 0.9, recoil: 0.94, ergo: 0.03 },
    desc: 'The action glassed into the wood at the recoil lug. It shoots to the same place twice.' }),
  U('up_furn_chassis', { name: 'Precision chassis', slot: 'furniture', tier: 3, rank: 5, rarity: 'rare', price: 5600, weight: 1.8, dw: 0.9,
    fits: { cls: ['sniper'] }, effects: { moa: 0.86, recoil: 0.86, ergo: -0.04, adsSpeed: 0.95 },
    desc: 'Milled aluminium, adjustable comb, a rail underneath. Heavy, rigid, and it does not care about the weather.' }),
  U('up_furn_shotpad', { name: 'Recoil-absorbing stock', slot: 'furniture', tier: 2, rank: 2, rarity: 'common', price: 1100, weight: 0.7, dw: 0.15,
    fits: { cls: ['shotgun'] }, effects: { recoil: 0.78, ergo: 0.04 },
    desc: 'A hydraulic tube and an inch of gel. You can shoot a box of slugs and still lift your arm.' }),
  U('up_grip_rubber', { name: 'Rubber grip panels', slot: 'furniture', tier: 1, rank: 1, rarity: 'common', price: 300, weight: 0.1, dw: 0.02,
    fits: { cls: ['pistol'] }, effects: { recoil: 0.92, ergo: 0.05 }, desc: 'Pachmayr-pattern rubber over the frame. It stays where you put it in the wet.' }),
  U('up_grip_match', { name: 'Target grips', slot: 'furniture', tier: 2, rank: 3, rarity: 'uncommon', price: 1200, weight: 0.16, dw: 0.06,
    fits: { cls: ['pistol'] }, effects: { recoil: 0.88, ergo: 0.1, moa: 0.92, adsSpeed: 0.96 },
    desc: 'Stippled walnut with a shelf under the thumb. The pistol points itself and comes out of the holster badly.' }),
]);

// ---------------------------------------------------------------------------------------------------------------
// compatibility
// ---------------------------------------------------------------------------------------------------------------
// One match spec, used for both `fits` on a part and `applies` on a slot. All keys are ANDed; a missing key passes.
export function matches(spec, d) {
  if (!spec || !d) return true;
  if (spec.cls && !spec.cls.includes(d.cls)) return false;
  if (spec.notCls && spec.notCls.includes(d.cls)) return false;
  if (spec.family && !spec.family.includes(d.family)) return false;
  if (spec.cal && !spec.cal.includes(d.cal)) return false;
  if (spec.action && !spec.action.includes(d.modes[0])) return false;
  if (spec.notAction && spec.notAction.includes(d.modes[0])) return false;
  if (spec.auto && !d.modes.includes('auto')) return false;
  if (spec.id && !spec.id.includes(d.id)) return false;
  if (spec.notId && spec.notId.includes(d.id)) return false;
  if (spec.mount) for (const [k, v] of Object.entries(spec.mount)) if ((d.mounts?.[k] || 'none') !== v) return false;
  return true;
}
export const slotApplies = (slot, weaponDef) => !!weaponDef && matches(slot.applies, weaponDef);
export const slotsFor = (weaponDef) => UPGRADE_SLOTS.filter((s) => slotApplies(s, weaponDef));
export const slotName = (slot, weaponDef) => (slot.alt && weaponDef && slot.alt[weaponDef.cls]) || slot.name;
export function upgradeFits(u, weaponDef) {
  if (!u || !weaponDef) return false;
  const slot = SLOT_BY_ID[u.slot];
  if (!slot || !slotApplies(slot, weaponDef)) return false;
  return matches(u.fits, weaponDef);
}
export const upgradesFor = (weaponDef, slotId = null) => Object.values(UPGRADES).filter((u) => (!slotId || u.slot === slotId) && upgradeFits(u, weaponDef));

// ---------------------------------------------------------------------------------------------------------------
// what the bench charges
// ---------------------------------------------------------------------------------------------------------------
// A weapon's worth is spread across its parts: bringing a barrel from 40 % back to new costs 0.6 of the barrel's
// share of the weapon's price, times the armourer's multiple. An AKM barrel at 40 % is 277 ₽; an HK416's is 1 140 ₽.
export const PART_SHARE = { barrel: 0.35, bolt: 0.28, frame: 0.16 };
export const LABOUR = 1.5;            // the armourer's multiple over the value of the metal
export const FEE_FLOOR = 40;
export const FIT = { labour: 0.22, remove: 0.12, removeFloor: 50, seconds: 8, perTier: 3 };

export function repairFee(weaponDef, part, from, to = 100) {
  const missing = Math.max(0, Math.min(100, to) - Math.max(0, from));
  if (missing <= 0) return 0;
  return Math.max(FEE_FLOOR, Math.ceil((missing / 100) * (weaponDef?.price || 500) * (PART_SHARE[part] || 0.2) * LABOUR));
}
export const repairSeconds = (from, to = 100) => Math.round((6 + 14 * Math.max(0, (Math.min(100, to) - Math.max(0, from))) / 100) * 10) / 10;
// Fitting a part is two jobs on one docket: the part's own fitting labour, and bringing the weapon back to the
// condition a new part implies. That second half is priced exactly like a repair, so swapping parts is never a
// cheaper way to buy condition than repairing is.
export function fitFee(weaponDef, u, curCondition = 100) {
  const slot = SLOT_BY_ID[u.slot];
  const labour = Math.max(FEE_FLOOR, Math.ceil((u.price || 0) * FIT.labour));
  const cond = slot && slot.restores ? repairFee(weaponDef, slot.restores, curCondition, 100) : 0;
  return { labour, cond, total: labour + cond };
}
export const fitSeconds = (u, curCondition = 100) => {
  const slot = SLOT_BY_ID[u.slot];
  const base = FIT.seconds + FIT.perTier * (u.tier || 0);
  return Math.round((base + (slot && slot.restores ? repairSeconds(curCondition) - 6 : 0)) * 10) / 10;
};
export const removeFee = (u) => Math.max(FIT.removeFloor, Math.ceil((u.price || 0) * FIT.remove));

// ---------------------------------------------------------------------------------------------------------------
// bench jobs: cleaning, repair, armour. `base` means the job needs Vanno; `rank` is the clearance it is issued at.
// dirt is the multiplier fouling is left at; part is the condition added to every part.
// ---------------------------------------------------------------------------------------------------------------
export const CLEAN_JOBS = [
  { id: 'field', name: 'Field strip', short: 'Strip', seconds: 7, fee: 0, kit: 'cleankit', rank: 1, base: false, dirt: 0.25, part: 0,
    note: 'A rag, a rod and the oil in the kit. It takes most of it out and costs a kit use.' },
  { id: 'bench', name: 'Bench strip and clean', short: 'Clean', seconds: 12, fee: 90, kit: null, rank: 1, base: true, dirt: 0, part: 2,
    note: 'Solvent tank, brass brushes, fresh oil. Everything the rag missed, for the price of the solvent.' },
  { id: 'deep', name: 'Ultrasonic deep clean', short: 'Deep', seconds: 20, fee: 320, kit: null, rank: 3, base: true, dirt: 0, part: 8,
    note: 'The whole group in the tank for half an hour. Carbon comes out of the wear surfaces and the parts gauge better after.' },
];
export const REPAIR_JOBS = [
  { id: 'kit', name: 'Repair kit', short: 'Kit +35', seconds: 10, kit: 'repairkit', rank: 1, base: false, amount: 35, fee: 0,
    note: 'Springs, pins and a file out of the kit. Thirty-five points to one part, anywhere.' },
  { id: 'bench', name: 'Bench overhaul', short: 'Overhaul', kit: null, rank: 2, base: true, amount: 100, fee: null,
    note: 'The armourer takes the part back to gauge. Priced on what is missing and on what the weapon is worth.' },
];
export const ARMOUR_JOBS = [
  { id: 'kit', name: 'Armour repair kit', short: 'Kit +40', seconds: 12, kit: 'armorkit', rank: 1, base: false, amount: 40, fee: 0 },
  { id: 'bench', name: 'Bench re-plate', short: 'Re-plate', kit: null, rank: 2, base: true, amount: 999, fee: null },
];
export const ARMOUR_LABOUR = 0.32;     // fee per durability point, as a fraction of price/durability
export function armourFee(armorDef, from) {
  const missing = Math.max(0, (armorDef?.durability || 0) - Math.max(0, from));
  if (missing <= 0) return 0;
  return Math.max(FEE_FLOOR, Math.ceil(missing * ((armorDef.price || 400) / (armorDef.durability || 40)) * ARMOUR_LABOUR));
}
export const armourSeconds = (armorDef, from) => Math.round((8 + 14 * Math.max(0, ((armorDef?.durability || 1) - from) / (armorDef?.durability || 1))) * 10) / 10;

// ---------------------------------------------------------------------------------------------------------------
// the readout. Every number the bench shows the player comes from this table — nothing is computed for display
// that the weapon does not actually use. `key` is the field on inventory.weaponHandling(w), `better` says which
// direction is an improvement, and `fx` names the weaponEffects key the line leans on, so the sheet can mark
// anything weapons.js does not read yet.
// ---------------------------------------------------------------------------------------------------------------
export const HANDLING_STATS = [
  { key: 'moa', label: 'Dispersion', unit: '°', digits: 2, better: 'down', fx: 'moa' },
  { key: 'moaAds', label: 'Dispersion, aimed', unit: '°', digits: 2, better: 'down', fx: 'moa' },
  { key: 'recoil', label: 'Recoil, vertical', unit: '', digits: 2, better: 'down', fx: 'recoil' },
  { key: 'ads', label: 'Time to aim', unit: ' s', digits: 2, better: 'down', fx: 'adsSpeed' },
  { key: 'ergo', label: 'Ergonomics', unit: '', digits: 0, better: 'up', scale: 100, fx: 'ergo' },
  { key: 'rpm', label: 'Rate of fire', unit: ' rpm', digits: 0, better: 'up', fx: 'rpm' },
  { key: 'jam', label: 'Stoppage per shot', unit: ' %', digits: 2, better: 'down', scale: 100, fx: 'jam' },
  { key: 'damage', label: 'Damage', unit: ' %', digits: 0, better: 'up', scale: 100, fx: 'damage' },
  { key: 'noise', label: 'Report', unit: ' %', digits: 0, better: 'down', scale: 100, fx: 'noise' },
  { key: 'wear', label: 'Wear per shot', unit: ' %', digits: 3, better: 'down', fx: 'wear' },
  { key: 'weight', label: 'Weight', unit: ' kg', digits: 2, better: 'down', fx: null },
];
// Effects keys the weapon state machine does not read yet. The bench daggers any number that leans on one of them
// and prints the reason under the table, so nothing on the sheet is a promise the game does not keep. weapons.js
// needs three lines to clear this list (see WORKBENCH notes at the head of ui/panels.js); empty the set when it has
// them and the daggers go away on their own.
export const PENDING_FX = new Set(['rpm', 'jam', 'damage']);
export const isPending = (fxKey, e) => !!fxKey && PENDING_FX.has(fxKey) && !!e && e[fxKey] !== 1;
// the handful shown on a candidate row, in order of what a player actually decides on
export const COMPARE_KEYS = ['moa', 'recoil', 'ads', 'rpm', 'jam', 'damage', 'noise', 'ergo', 'weight'];

// ---------------------------------------------------------------------------------------------------------------
// register the parts into the item catalogue so they are found, carried, priced and sold like anything else
// ---------------------------------------------------------------------------------------------------------------
export function registerUpgrades(table = ITEMS) {
  for (const u of Object.values(UPGRADES)) {
    // `part` is what the rest of the catalogue already understands about a part item: which piece of the weapon it
    // is. attachmesh.js builds a dropped part's world mesh off it, and the supply crate names it in its one line.
    if (!u.part) u.part = (SLOT_BY_ID[u.slot] && SLOT_BY_ID[u.slot].restores) || u.slot;
    if (!table[u.id]) table[u.id] = u;
  }
  return table;
}
registerUpgrades();
