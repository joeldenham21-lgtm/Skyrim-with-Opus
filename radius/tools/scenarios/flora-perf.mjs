// Perf: real frame throughput (from ctx.frame, not the dt-clamped fps counter) with and without flora/debris,
// at the gate and inside the dead forest. node tools/smoke.mjs --out .smoke/flora-perf --scenario tools/scenarios/flora-perf.mjs --w 960 --h 540
export default async function (page, api) {
  // how long did the page take to boot, and how much of the flora is there?
  const boot = await api.run(`JSON.stringify({ bootMs: Math.round(performance.now()), counts: window.__radius.ctx.flora.counts, tier: window.__radius.ctx.flora.tier, chunks: window.__radius.ctx.debris.chunks.count })`);
  console.log('boot', boot);
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start()');
  await api.frames(3);
  const measure = async (label) => {
    const f0 = await api.run('window.__radius.ctx.frame'); const t0 = Date.now();
    await api.wait(6000);
    const f1 = await api.run('window.__radius.ctx.frame');
    const st = await api.run('JSON.stringify(window.__radius.stats())');
    console.log(`${label}: ${((f1 - f0) / ((Date.now() - t0) / 1000)).toFixed(1)} fps ${st}`);
  };
  const vis = (on) => api.run(`(() => { const c = window.__radius.ctx; const f = c.flora, d = c.debris; f.trees.visible = ${on}; f.grass.visible = ${on}; for (const r of f.reeds) r.visible = ${on}; d.chunks.visible = ${on}; d.column.visible = ${on}; d.air.visible = ${on}; })()`);
  await api.frames(3);
  await measure('gate with flora+debris');
  await vis(false); await api.frames(3);
  await measure('gate without');
  await vis(true);
  await api.run('window.__radius.teleport(-215, -65); window.__radius.setLook(1.9, -0.05);');
  await api.frames(3);
  await measure('forest with flora+debris');
  await vis(false); await api.frames(3);
  await measure('forest without');
  await vis(true);
  await api.run('window.__radius.teleport(-40, 120); window.__radius.setLook(0, -0.05);');
  await api.frames(3);
  await measure('marsh with flora+debris');
}
