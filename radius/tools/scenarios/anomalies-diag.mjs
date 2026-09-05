// Diagnose anomaly placement per POI: why candidate points are rejected.
export default async function (page, api) {
  console.log(await api.run(`(() => {
    const r = window.__radius, w = r.ctx.world, M = w.map, out = {};
    for (const poi of M.POIS) {
      if (poi.kind !== 'anomaly') continue;
      const c = { water: 0, low: 0, solid: 0, ok: 0, hmin: 99, hmax: -99 };
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * poi.r * 0.85;
        const x = poi.x + Math.cos(a) * d, z = poi.z + Math.sin(a) * d;
        const y = w.getHeight(x, z); c.hmin = Math.min(c.hmin, y); c.hmax = Math.max(c.hmax, y);
        if (w.isWater(x, z)) { c.water++; continue; }
        if (y < M.WATER_LEVEL + 0.3) { c.low++; continue; }
        if (w.pointInSolid(x, y + 0.6, z) || w.pointInSolid(x, y + 1.6, z)) { c.solid++; continue; }
        c.ok++;
      }
      let cols = 0; w.query(poi.x, poi.z, poi.r, (cc) => { cols++; });
      c.colliders = cols;
      out[poi.id] = c;
    }
    return JSON.stringify(out);
  })()`));
}
