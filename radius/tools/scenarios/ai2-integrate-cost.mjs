// WHAT IT COSTS. Rays and microseconds per frame at 3, 7 and 12 active mimics, in a live firefight.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-integrate-cost.mjs --out .smoke/ai2-cost
//
// The ceiling from the specification: <= 4.5 tactical rays/frame at 12 mimics, and the AI must not cost more
// than ~120 us of a frame. World queries are counted by wrapping world.raycast / lineOfSight / pointInSolid /
// groundHeight, so "rays" here is every line test any part of the AI made, not an estimate.
import { boot, HOOKS, SETUP } from './ai2-integrate-lib.mjs';

const BENCH = (n) => `(() => {
  const ctx = window.__radius.ctx, H = window.__H;
  H.rays = 0; H.los = 0; H.solid = 0; H.ground = 0;
  const t0 = performance.now();
  for (let i = 0; i < ${n}; i++) {
    ctx.elapsed += 0.05; ctx.frame++;
    ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
  }
  const ms = performance.now() - t0;
  const live = window.__list.filter((m) => m.alive).length;
  return { n: ${n}, live, us: +(ms * 1000 / ${n}).toFixed(1),
    rayF: +((H.rays + H.los) / ${n}).toFixed(2), raycast: +(H.rays / ${n}).toFixed(2), los: +(H.los / ${n}).toFixed(2),
    solid: +(H.solid / ${n}).toFixed(2), ground: +(H.ground / ${n}).toFixed(2) };
})()`;

export default async function (page, api) {
  await boot(api);
  await api.run(HOOKS);
  for (const n of [3, 7, 12]) {
    const t = { poi: 'zarya', x: -118, z: 92, look: 0.35, d: 34, n, tide: 3, sec: 5, cls: null, seed: 77 };
    console.log(`\n--- ${n} mimics ---`);
    console.log('setup', JSON.stringify(await api.run(SETUP(t))));
    await api.run(BENCH(120));                       // warm the caches and let the fight start
    for (let k = 0; k < 3; k++) console.log('  ', JSON.stringify(await api.run(BENCH(400))));
  }
}
