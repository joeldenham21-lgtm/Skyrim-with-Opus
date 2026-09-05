// Dump colliders around izba door 1 and the terrain there (no rendering).
export default async function (page, api) {
  await page.evaluate(() => { window.__radius.ctx.debug.noEnemies = true; });
  await api.start();
  const out = await api.run(`(() => {
    const ctx = window.__radius.ctx, w = ctx.world; const d = ctx.structures.doors[1];
    const dx = d.inside.x - d.x, dz = d.inside.z - d.z, L = Math.hypot(dx, dz); const ux = dx / L, uz = dz / L;
    const along = (c) => +(((c.min.x + c.max.x) / 2 - d.x) * ux + ((c.min.z + c.max.z) / 2 - d.z) * uz).toFixed(2);
    const cols = [];
    w.query(d.x + ux * 1.5, d.z + uz * 1.5, 3.2, (c) => { if (c.kind !== 'box') { cols.push(['cyl', c.tag, +c.x.toFixed(2), +c.z.toFixed(2), c.r, +c.y0.toFixed(2), +c.y1.toFixed(2)]); return; }
      const cx = Math.max(c.min.x, Math.min(d.x + ux * 1.5, c.max.x)), cz = Math.max(c.min.z, Math.min(d.z + uz * 1.5, c.max.z)); if (Math.hypot(d.x + ux * 1.5 - cx, d.z + uz * 1.5 - cz) > 2.2) return;
      cols.push([c.tag, c.surface, 'along', along(c), 'y', +c.min.y.toFixed(2), +c.max.y.toFixed(2), 'sz', +(c.max.x - c.min.x).toFixed(2), +(c.max.z - c.min.z).toFixed(2)]); });
    cols.sort((a, b) => (a[3] || 0) - (b[3] || 0));
    const terr = []; for (let s = -0.5; s <= 4; s += 0.5) terr.push([s, +w.getHeight(d.x + ux * s, d.z + uz * s).toFixed(2)]);
    return { door: [d.x, d.z], inside: [d.inside.x, d.inside.z], dir: [+ux.toFixed(2), +uz.toFixed(2)], terr, cols }; })()`);
  console.log('DOOR1', JSON.stringify(out));
}
