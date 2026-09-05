// Review pass 6: layout checks + door-1 collider diagnosis + convoy / Object 12 / night approach shots.
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
      const dist = Math.hypot(p.x - d.inside.x, p.z - d.inside.z);
      const touching = [];
      if (dist > 0.6) w.query(p.x, p.z, 1.0, (c) => { if (c.kind === 'box') { const cx = Math.max(c.min.x, Math.min(p.x, c.max.x)), cz = Math.max(c.min.z, Math.min(p.z, c.max.z)); if (Math.hypot(p.x - cx, p.z - cz) < 0.4 && p.y + 1.85 > c.min.y && p.y + 0.55 < c.max.y) touching.push([c.tag, c.surface, [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z].map((v) => +v.toFixed(2))]); } else if (Math.hypot(p.x - c.x, p.z - c.z) < 0.4 + c.r && p.y < c.y1 && p.y + 1.85 > c.y0) touching.push([c.tag, 'cyl', c.x, c.z, c.r]); });
      doors.push({ door: [+d.x.toFixed(1), +d.z.toFixed(1)], end: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], g: +w.getHeight(p.x, p.z).toFixed(2), dist: +dist.toFixed(2), touching });
    }
    return { blockers: bad.filter((b) => !(b[0] === 'main' && b[2] > 290) && b[3] !== 'checkpoint:concrete' && b[3] !== 'convoy:metal'), doors: doors.filter((d) => d.dist > 0.6), baseGround: w.groundHeight(M.BASE.x, M.BASE.z, 60).y }; })()`);
  console.log('CHECKS', JSON.stringify(checks));
  const shots = [['convoy-0700', 48, 160, 0.9, 7], ['o12-inside-gate', 139, -44, -0.6, 7], ['base-approach-night', 0, 288, Math.PI, 21]];
  for (const [name, x, z, yaw, hour] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.02); r.setTime(${hour}); })()`);
    await api.frames(6); await api.screenshot(name);
    console.log('CALLS', name, JSON.stringify(await api.run(`(() => { const s = window.__radius.stats(); return [s.calls, s.triangles, s.error]; })()`)));
  }
}
