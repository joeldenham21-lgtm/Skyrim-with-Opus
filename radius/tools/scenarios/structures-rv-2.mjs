// Review pass 2: reproduce the white patch at Object 12 (WNW at 07:00) and identify it by raycast; JS-only checks
// for road blockers and izba doorway walk-through (no rendering needed).
export default async function (page, api) {
  await page.evaluate(() => { window.__radius.ctx.debug.noEnemies = true; });
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.teleport(150, -60); r.setLook(1.18, -0.05); r.setTime(7); })()`);
  await api.frames(6);
  await api.screenshot('o12-wnw');
  const hits = await api.run(`(() => {
    const ctx = window.__radius.ctx, T = ctx.THREE; const rc = new T.Raycaster(); const out = {};
    for (let i = -0.9; i <= 0.9; i += 0.15) for (let j = -0.6; j <= 0.2; j += 0.1) {
      rc.setFromCamera(new T.Vector2(i, j), ctx.camera);
      const h = rc.intersectObjects(ctx.scene.children, true)[0]; if (!h) continue;
      const o = h.object, m = Array.isArray(o.material) ? o.material[0] : o.material;
      const k = (o.name || '?') + '|' + (o.parent && o.parent.name || '') + '|' + m.type;
      if (!out[k]) out[k] = { n: 0, col: m.color && m.color.getHexString(), em: m.emissive && m.emissive.getHexString(), emI: m.emissiveIntensity, vc: !!m.vertexColors, hasCol: !!o.geometry.attributes.color, fog: m.fog, d: +h.distance.toFixed(1), p: h.point.toArray().map((v) => +v.toFixed(1)) };
      out[k].n++;
    }
    return out; })()`);
  console.log('raycast', JSON.stringify(hits, null, 0));
  // road blockers: sample the main road centreline every 2 m at knee height
  const road = await api.run(`(() => {
    const w = window.__radius.ctx.world; const M = w.map; const bad = [];
    for (const r of M.ROADS) for (let t = 0; t <= 1; t += 0.004) { const p = M.pointOnPolyline(r.pts, t); const y = w.getHeight(p.x, p.z);
      for (const s of [-1.2, 0, 1.2]) { const x = p.x - p.dz * s, z = p.z + p.dx * s; if (w.pointInSolid(x, y + 0.7, z)) { let tag = null; w.query(x, z, 0.1, (c) => { if (c.kind === 'box' && !c.passable && x >= c.min.x && x <= c.max.x && y + 0.7 >= c.min.y && y + 0.7 <= c.max.y && z >= c.min.z && z <= c.max.z) { tag = c.tag + ':' + c.surface; return false; } }); bad.push([r.id, +x.toFixed(1), +z.toFixed(1), tag]); } } }
    return bad; })()`);
  console.log('road blockers', JSON.stringify(road));
  // izba doorways: march a capsule from the outside door point to the inside point
  const doors = await api.run(`(() => {
    const ctx = window.__radius.ctx, w = ctx.world, T = ctx.THREE; const res = [];
    for (const d of ctx.structures.doors) {
      const p = new T.Vector3(d.x, w.getHeight(d.x, d.z), d.z); const dx = d.inside.x - d.x, dz = d.inside.z - d.z; const L = Math.hypot(dx, dz); const n = Math.ceil(L / 0.1);
      let blocked = false;
      for (let i = 0; i < n; i++) { const tx = p.x + dx / L * 0.1, tz = p.z + dz / L * 0.1; p.x = tx; p.z = tz; w.resolveCapsule(p, 0.35, 1.85); const g = w.groundHeight(p.x, p.z, p.y + 0.3); if (g.y > p.y) p.y = g.y; else p.y = g.y; }
      const dist = Math.hypot(p.x - d.inside.x, p.z - d.inside.z);
      res.push({ door: [+d.x.toFixed(1), +d.z.toFixed(1)], end: [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)], dist: +dist.toFixed(2), ok: dist < 0.6 });
    }
    return res; })()`);
  console.log('doors', JSON.stringify(doors));
}
