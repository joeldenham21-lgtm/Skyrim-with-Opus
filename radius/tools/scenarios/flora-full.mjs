// World-fullness review: open ground, the places that read empty.
// node tools/smoke.mjs --out .smoke/flora-full --scenario tools/scenarios/flora-full.mjs --w 800 --h 450
// FLORA_DENSITY / FLORA_LOD override the software tier's thinning; FLORA_SHOTS picks a subset.
export default async function (page, api) {
  const dens = process.env.FLORA_DENSITY || '0.6', lod = process.env.FLORA_LOD || '42';
  await api.run(`(() => { const ctx = window.__radius.ctx; ctx.debug.noEnemies = true; window.__radius.start(); ctx.flora.setDensity(${dens}); ctx.flora.setLod(${lod}); })()`);
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 480000 }); };
  await frames(2);
  console.log('flora', await api.run(`JSON.stringify({ counts: window.__radius.ctx.flora.counts, tier: window.__radius.ctx.flora.tier })`));
  const shots = [
    ['open-field-east', 92, 44, -1.1, -0.02, 10],
    ['road-edge', 26, 132, 2.6, -0.03, 10],
    ['marsh-edge', -44, 108, 2.9, -0.05, 11],
    ['village-approach', -96, 66, -1.5, -0.02, 10],
    ['ridge-north', -6, -252, 0.35, -0.02, 12],
    ['hollow-south', 120, 120, 1.2, -0.04, 10],
  ];
  let shot = 0;
  const only = process.env.FLORA_SHOTS ? process.env.FLORA_SHOTS.split(',') : null;
  for (const [name, x, z, yaw, pitch, hour] of shots) {
    if (only && !only.includes(name)) { shot++; continue; }
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); })()`);
    await frames(3);
    const p = `${api.outDir}/${String(shot++).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: p, timeout: 240000 });
    console.log('screenshot', p);
    console.log(name, await api.run(`JSON.stringify(window.__radius.stats())`));
  }
}
