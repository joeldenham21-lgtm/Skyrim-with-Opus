// Review pass 1: the soak findings at 07:00 — convoy blackness, the white patch at Object 12, calls at gate/Zarya/O12.
export default async function (page, api) {
  await page.evaluate(() => { window.__radius.ctx.debug.noEnemies = true; });
  await api.start();
  const shots = [
    ['gate', 0, 284, 0, 7],
    ['convoy', 40, 182, 0.35, 7],
    ['convoy-close', 52, 168, 0.9, 7],
    ['o12-nw', 150, -60, -2.2, 7],
    ['o12-gate', 118, -30, -1.05, 7],
    ['zarya', -130, 60, 0.8, 7],
  ];
  for (const [name, x, z, yaw, hour] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.05); r.setTime(${hour}); })()`);
    await api.frames(6);
    await api.screenshot(name);
    const s = await api.run(`(() => { const s = window.__radius.stats(); return { calls: s.calls, tris: s.triangles, pos: s.pos }; })()`);
    console.log('stats', name, JSON.stringify(s));
  }
}
