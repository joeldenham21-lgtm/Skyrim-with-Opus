// Flora review: forest edge, village edge, marsh reeds, night torch in the forest, the Column from the gate.
// node tools/smoke.mjs --out .smoke/flora-1 --scenario tools/scenarios/flora-1.mjs --w 960 --h 540
// FLORA_FULL=1 forces real-GPU density and detail distance (slow under SwiftShader, but shows the intended look).
export default async function (page, api) {
  const full = !!process.env.FLORA_FULL;
  await api.run(`(() => { const ctx = window.__radius.ctx; ctx.debug.noEnemies = true; ${full ? 'ctx.flora.setDensity(1); ctx.flora.setLod(70);' : ''} window.__radius.start(); })()`);
  await api.frames(4);
  const info = await api.run(`JSON.stringify({ counts: window.__radius.ctx.flora.counts, tier: window.__radius.ctx.flora.tier, lod: window.__radius.ctx.flora.lodDist, density: window.__radius.ctx.flora.density, chunks: window.__radius.ctx.debris.chunks.count })`);
  console.log('flora', info);
  const shots = [
    ['gate-north', 0, 284, 0, 0.02, 9],
    ['forest-edge-west', -200, -60, Math.PI / 2, -0.03, 11],
    ['forest-inside', -235, -75, 2.2, 0.02, 11],
    ['village-edge', -130, 135, 0, -0.04, 10],
    ['marsh-reeds', -40, 120, 0, -0.08, 12],
    ['field-a-debris', -60, 10, 0, 0.25, 14],
    ['night-torch-forest', -215, -60, 1.9, -0.12, 22.5],
  ];
  // like api.frames, but patient: software GL under a loaded box can need minutes for a few frames
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 300000 }); };
  let shot = 0;
  const only = process.env.FLORA_SHOTS ? process.env.FLORA_SHOTS.split(',') : null;
  for (const [name, x, z, yaw, pitch, hour] of shots) {
    if (only && !only.includes(name)) { shot++; continue; }
    const torch = name.includes('torch');
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.lighting.setFlashlight(${torch}); })()`);
    await frames(6);
    // software GL under load can take a while to produce a frame; do not let the harness's 30 s cap abort the review
    const p = `${api.outDir}/${String(shot++).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: p, timeout: 180000 });
    console.log('screenshot', p);
    const st = await api.run(`JSON.stringify(window.__radius.stats())`);
    console.log(name, st);
  }
}
