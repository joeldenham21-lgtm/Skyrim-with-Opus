// Review pass 5: JS layout checks (roads, doorways, base spawn, registries), station prompts with visibility, two shots.
export default async function (page, api) {
  await page.evaluate(() => { window.__radius.ctx.debug.noEnemies = true; });
  await api.start();
  const checks = await api.run(`(() => {
    const ctx = window.__radius.ctx, w = ctx.world, M = w.map, T = ctx.THREE; const bad = [];
    for (const r of M.ROADS) for (let t = 0; t <= 1; t += 0.004) { const p = M.pointOnPolyline(r.pts, t); const y = w.getHeight(p.x, p.z);
      for (const s of [-1.2, 0, 1.2]) { const x = p.x - p.dz * s, z = p.z + p.dx * s; if (w.pointInSolid(x, y + 0.7, z)) { let tag = null; w.query(x, z, 0.1, (c) => { if (c.kind === 'box' && !c.passable && x >= c.min.x && x <= c.max.x && y + 0.7 >= c.min.y && y + 0.7 <= c.max.y && z >= c.min.z && z <= c.max.z) { tag = c.tag + ':' + c.surface; return false; } }); bad.push([r.id, +x.toFixed(1), +z.toFixed(1), tag]); } } }
    const doors = [];
    for (const d of ctx.structures.doors) {
      const p = new T.Vector3(d.x, w.getHeight(d.x, d.z), d.z); const dx = d.inside.x - d.x, dz = d.inside.z - d.z; const L = Math.hypot(dx, dz); const n = Math.ceil(L / 0.1);
      for (let i = 0; i < n; i++) { p.x += dx / L * 0.1; p.z += dz / L * 0.1; w.resolveCapsule(p, 0.35, 1.85); p.y = w.groundHeight(p.x, p.z, p.y + 0.3).y; }
      doors.push([+d.x.toFixed(1), +d.z.toFixed(1), +Math.hypot(p.x - d.inside.x, p.z - d.inside.z).toFixed(2)]);
    }
    const gh = w.groundHeight(M.BASE.x, M.BASE.z, 60);
    const reg = { cover: w.coverPoints.length, spawn: w.spawnSpots.length, loot: w.lootSpots.length, hide: w.hidingSpots.length, colliders: w.collision ? w.collision.all.length : null };
    return { blockers: bad.filter((b) => !(b[0] === 'main' && b[2] > 290)), doors, baseGround: gh, reg }; })()`);
  console.log('CHECKS', JSON.stringify(checks));
  const yawTo = (px, pz, tx, tz) => Math.atan2(-(tx - px), -(tz - pz));
  const prompt = `(() => { const e = document.getElementById('prompt'); return e.classList.contains('hidden') ? null : e.textContent; })()`;
  const stations = [['terminal', -2.6, 300.6, -3.7, 300.6, -0.15], ['workbench', 3.0, 300.9, 4.0, 300.9, -0.15], ['supply', 2.4, 302.8, 3.5, 303.7, -0.3], ['locker', -3.2, 299.3, -4.2, 299.3, -0.05], ['cot', -2.4, 303.2, -3.4, 304.0, -0.35]];
  for (const [name, px, pz, tx, tz, pitch] of stations) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${px}, ${pz}, 7.3); r.setLook(${yawTo(px, pz, tx, tz)}, ${pitch}); r.setTime(12); })()`);
    await api.frames(3);
    console.log('PROMPT', name, JSON.stringify(await api.run(prompt)));
  }
  await api.run(`(() => { const r = window.__radius; r.teleport(48, 160); r.setLook(0.9, -0.06); r.setTime(7); })()`);
  await api.frames(6); await api.screenshot('convoy-0700');
  await api.run(`(() => { const r = window.__radius; r.teleport(139, -44); r.setLook(-0.6, -0.04); r.setTime(7); })()`);
  await api.frames(6); await api.screenshot('o12-inside-gate');
  console.log('CALLS', JSON.stringify(await api.run(`(() => { const s = window.__radius.stats(); return [s.calls, s.triangles]; })()`)));
  await api.run(`(() => { const r = window.__radius; r.teleport(0, 288); r.setLook(Math.PI, 0.0); r.setTime(21); })()`);
  await api.frames(6); await api.screenshot('base-approach-night');
}
