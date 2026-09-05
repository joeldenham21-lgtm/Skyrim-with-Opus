// Structures: screenshots at each POI from the road approach at noon, plus one at dusk with the torch.
export default async function (page, api) {
  // SwiftShader on a shared host can drop under 0.2 fps: wait for frames with a generous timeout
  const frames = async (n) => { const f0 = await page.evaluate(() => window.__radius.ctx.frame); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 400000 }); };
  api.frames = frames;
  let shot = 0; api.screenshot = async (name) => { const p = `${api.outDir}/${String(shot++).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p, timeout: 240000 }); console.log("screenshot", p); return p; };
  await page.evaluate(() => window.__radius.start());
  await frames(4);
  const shots = [
    ['checkpoint', 8, 236, 0.35, 12],
    ['convoy', 40, 182, 0.35, 12],
    ['zarya-east', -85, 68, 1.35, 12],
    ['zarya-west', -160, 44, -1.5, 12],
    ['object12', 118, -30, -1.05, 12],
    ['church', 60, -192, 0.15, 12],
    ['rail', -50, -134, 0.5, 12],
    ['marsh-boat', -105, 150, 1.6, 12],
    ['hut', -205, -100, 1.9, 12],
    ['zarya-night-torch', -100, 66, 1.35, 20.5],
  ];
  for (const [name, x, z, yaw, hour] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.06); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${name.includes('torch')}; })()`);
    await api.frames(6);
    await api.screenshot(name);
  }
  const counts = await api.run(`(() => { const w = window.__radius.ctx.world; return { cover: w.coverPoints.length, spawn: w.spawnSpots.length, loot: w.lootSpots.length, hide: w.hidingSpots.length, colliders: w.collision.all.length }; })()`);
  console.log('registries', JSON.stringify(counts));
}
