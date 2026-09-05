// Review pass 8: every izba doorway walkable (capsule march), plus izba interior, checkpoint booth and rail tank car.
export default async function (page, api) {
  await page.evaluate(() => { window.__radius.ctx.debug.noEnemies = true; });
  await api.start();
  const doors = await api.run(`(() => {
    const ctx = window.__radius.ctx, w = ctx.world, T = ctx.THREE; const res = [];
    for (const d of ctx.structures.doors) {
      const p = new T.Vector3(d.x, w.getHeight(d.x, d.z), d.z); const dx = d.inside.x - d.x, dz = d.inside.z - d.z; const L = Math.hypot(dx, dz); const n = Math.ceil(L / 0.1);
      for (let i = 0; i < n; i++) { p.x += dx / L * 0.1; p.z += dz / L * 0.1; w.resolveCapsule(p, 0.35, 1.85); p.y = w.groundHeight(p.x, p.z, p.y + 0.3).y; }
      // and back out again
      let q = p.clone(); for (let i = 0; i < n + 5; i++) { q.x -= dx / L * 0.1; q.z -= dz / L * 0.1; w.resolveCapsule(q, 0.35, 1.85); q.y = w.groundHeight(q.x, q.z, q.y + 0.3).y; }
      res.push({ in: +Math.hypot(p.x - d.inside.x, p.z - d.inside.z).toFixed(2), out: +Math.hypot(q.x - d.x, q.z - d.z).toFixed(2) });
    }
    return res; })()`);
  console.log('DOORS', JSON.stringify(doors));
  const d = await api.run(`(() => { const d = window.__radius.ctx.structures.doors[2]; return [d.x, d.z, d.inside.x, d.inside.z]; })()`);
  const yaw = Math.atan2(-(d[2] - d[0]), -(d[3] - d[1]));
  const shots = [];
  for (const [name, x, z, yw, hour] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yw}, 0.02); r.setTime(${hour}); })()`);
    await api.frames(6); await api.screenshot(name);
    console.log('CALLS', name, JSON.stringify(await api.run(`(() => { const s = window.__radius.stats(); return [s.calls, s.triangles, s.error]; })()`)));
  }
}
