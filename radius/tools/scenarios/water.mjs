// Marsh water check: shore at noon, across the marsh at dusk, night with the torch, drizzle.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const shots = [['shore-1200', -40, 55, 3.0, 12.0, false, 0], ['across-1730', 30, 130, 2.2, 17.5, false, 0], ['dusk-1930', -20, 60, 3.1, 19.5, false, 0], ['night-torch', -35, 58, 3.0, 22.5, true, 0], ['storm-1400', -40, 55, 3.0, 14.0, false, 0.5]];
  for (const [name, x, z, yaw, h, torch, storm] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.12); r.setTime(${h}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.lighting.storm = ${storm}; })()`);
    await api.frames(5);
    await api.screenshot(name);
  }
}
