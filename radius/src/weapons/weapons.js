// STUB — owned by the weapons agent. See ARCHITECTURE.md §Weapons for the full contract.
import { WEAPON_DEFS } from '../player/inventory.js';
export function createWeapons(ctx) {
  let current = null;
  const api = {
    get current() { return current; },   // { def, id, uid, chamber, mags, magIndex, dirt, jammed, state }
    adsBlend: 0, spreadDeg: 2, state: 'idle',
    equipSlot(i) { const w = ctx.inventory.weaponInSlot(i); current = w ? Object.assign({ def: WEAPON_DEFS[w.id] }, w) : null; },
    holster() { current = null; },
    fire() {}, reload() {},
    onInventoryChanged() { api.equipSlot(0); },
    update(dt) {},
  };
  api.equipSlot(0);
  return api;
}
