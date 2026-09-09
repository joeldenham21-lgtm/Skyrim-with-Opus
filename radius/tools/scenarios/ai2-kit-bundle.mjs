// esbuild entry for the kit scenarios. Not a scenario itself.
//
// It carries THREE things into the page as window.__KIT:
//   * src/enemies/kit.js               — the module under test
//   * src/enemies/loadout.js           — the REAL rollLoadout / dropsFor, so the loot invariant is proved
//                                        against the real DROPS table and not a mock of it
//   * src/player/inventory.js makers   — so a test can seed a pile with real instances that have real uids
//
// dropsForPatched() is the integrator's one-line change to dropsFor(), written out in full so the test is
// testing the change that will actually ship:
//
//     export function dropsFor(loadout) {
//       const out = [];
//       scavengedDrops(loadout, out);            // <-- THE line
//       ...everything else, unchanged...
//     }
export * from '../../src/enemies/kit.js';
export { rollLoadout, dropsFor, pickClass, classRank, roundsInGun, bestSpare } from '../../src/enemies/loadout.js';
export { makeWeapon, makeMag, makeGear } from '../../src/player/inventory.js';
export { def, WEAPONS, MAGAZINES, ARMOR, ITEMS, AMMO } from '../../src/data/index.js';
export { DROPS } from '../../src/data/loadouts.js';

import { scavengedDrops } from '../../src/enemies/kit.js';
import { dropsFor as realDropsFor } from '../../src/enemies/loadout.js';

// dropsFor() exactly as it will read after the integrator adds the one line at the top.
export function dropsForPatched(loadout) {
  const out = [];
  scavengedDrops(loadout, out);
  const rest = realDropsFor(loadout);
  for (let i = 0; i < rest.length; i++) out.push(rest[i]);
  return out;
}
