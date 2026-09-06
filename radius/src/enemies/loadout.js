// STUB — owned by the enemies-core agent. rollLoadout(className, tideLevel) -> { cls, weapon (WeaponInst), mags, vest, helmet, grenades, items }
import { MIMIC_CLASSES } from '../data/index.js';
import { makeWeapon, makeMag, makeGear } from '../player/inventory.js';
export function rollLoadout(className = 'regular', tide = 1) {
  const c = MIMIC_CLASSES[className] || MIMIC_CLASSES.regular;
  const weaponId = c.weapons[Math.floor(Math.random() * c.weapons.length)];
  const weapon = makeWeapon(weaponId, { condition: 40 + Math.random() * 50 });
  return { cls: className, def: c, weapon, mags: [], vest: null, helmet: null, grenades: 0, items: [] };
}
