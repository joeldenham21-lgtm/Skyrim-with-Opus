// Flora review pass 1: baseline. 640x360, no entities.
// node tools/smoke.mjs --out .smoke/flora-rv-1 --scenario tools/scenarios/flora-rv-1.mjs --w 640 --h 360
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start()');
  await api.frames(3);
  const info = await api.run(`JSON.stringify({ counts: window.__radius.ctx.flora.counts, tier: window.__radius.ctx.flora.tier, lod: window.__radius.ctx.flora.lodDist, density: window.__radius.ctx.flora.density, chunks: window.__radius.ctx.debris.chunks.count })`);
  console.log('flora', info);
  // placement audit: trees on roads / rail / inside solids, and trunk colliders near a tree
  const audit = await api.run(`(() => {
    const c = window.__radius.ctx, w = c.world, M = w.map, f = c.flora;
    const placed = f.placed || [];
    let onRoad = 0, onRail = 0, inSolid = 0, trees = 0, noCol = 0; const bad = [];
    for (const p of placed) {
      if (p.kind !== 'birch' && p.kind !== 'pine') continue; trees++;
      let rd = 1e9; for (const r of M.ROADS) rd = Math.min(rd, M.distToPolyline(p.x, p.z, r.pts).d);
      const rl = M.distToPolyline(p.x, p.z, M.RAIL.pts).d;
      if (rd < 3.5) { onRoad++; if (bad.length < 5) bad.push([p.kind, +p.x.toFixed(0), +p.z.toFixed(0), 'road', +rd.toFixed(1)]); }
      if (rl < 4.5) { onRail++; }
      if (w.pointInSolid(p.x, p.y + 1.2, p.z)) { /* our own trunk collider is a solid; count only non-flora */
        let other = false; w.query(p.x, p.z, 0.5, (col) => { if (col.tag !== 'flora' && !col.passable) other = true; });
        if (other) { inSolid++; if (bad.length < 10) bad.push([p.kind, +p.x.toFixed(0), +p.z.toFixed(0), 'solid']); }
      }
      let has = false; w.query(p.x, p.z, 0.3, (col) => { if (col.tag === 'flora' && col.kind === 'cyl') has = true; });
      if (!has) noCol++;
    }
    return JSON.stringify({ trees, onRoad, onRail, inSolid, noCol, bad, placedExposed: !!f.placed });
  })()`);
  console.log('audit', audit);
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 300000 }); };
  const go = async (x, z, yaw, pitch, hour, torch = false) => api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.lighting.setFlashlight(${torch}); })()`);
  const shot = async (name) => { const p = `${api.outDir}/${name}.png`; await page.screenshot({ path: p, timeout: 180000 }); console.log('screenshot', p, await api.run('JSON.stringify(window.__radius.stats())')); };
  await go(0, 284, 0, 0.02, 7);
  await frames(6); await shot('00-gate-north-0700');
  await go(-130, 135, 0, -0.06, 12);
  await frames(6); await shot('01-village-edge-1200');
  await api.run('window.__radius.ctx.flora.trees.visible = false');
  await frames(3); await shot('02-village-edge-no-trees');
  await api.run('window.__radius.ctx.flora.trees.visible = true');
  await go(-200, -60, Math.PI / 2, -0.03, 12);
  await frames(6); await shot('03-forest-edge-1200-a');
  await frames(3); await shot('04-forest-edge-1200-b');
  await go(-215, -60, 1.9, -0.12, 22.5, true);
  await frames(6); await shot('05-night-torch-forest');
}
