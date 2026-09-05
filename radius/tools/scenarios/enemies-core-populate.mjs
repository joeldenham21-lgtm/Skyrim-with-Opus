// The census at the gate: counts per type and POI, distance and visibility constraints, the Tide re-roll.
import { boot, frames, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: false, lighten: 1 });
  const census = `(() => { const r = window.__radius, ctx = r.ctx; const p = ctx.player.position; let minD = 1e9, vis = 0; const perPoi = {};
    for (const e of ctx.enemies.list) { const d = e.position.distanceTo(p); if (d < minD) minD = d; if (e.observedByPlayer(60)) vis++; perPoi[e.poi] = perPoi[e.poi] || {}; perPoi[e.poi][e.type] = (perPoi[e.poi][e.type] || 0) + 1; }
    return { counts: ctx.population.counts(), total: ctx.population.count, planned: ctx.population.planned, minD: +minD.toFixed(1), visible: vis, perPoi, census: ctx.population.census(), tide: ctx.state.data.tideLevel, types: [...ctx.enemies.types.keys()] }; })()`;
  console.log('census', JSON.stringify(await api.run(census)));
  await api.run(`(() => { const ctx = window.__radius.ctx; ctx.state.data.tideLevel = 2; ctx.events.emit('tide', 2); })()`);
  await frames(api, 2);
  console.log('tide2', JSON.stringify(await api.run(census)));
  await api.run(`(() => { const r = window.__radius; r.teleport(150, -60); r.setLook(-2.2, -0.05); r.setTime(12); })()`);
  await frames(api, 3);
  // walk the scan a few times: entries near Object 12 should activate, the ones near the gate retire
  await api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < 60; i++) { ctx.elapsed += 0.05; ctx.player.update(0.05); ctx.enemies.update(0.05); ctx.population.update(0.05); } })()`);
  console.log('at-object12', JSON.stringify(await api.run(census)));
  await shot(api, 'object12-populated');
  console.log('calls', await api.run('window.__radius.stats().calls'));
}
