// Ballistics bench: fires N rounds at witness walls at several ranges and reports group size,
// drop below the line of sight, time of flight and penetration outcomes.
// node tools/smoke.mjs --scenario tools/scenarios/ballistics-measure.mjs --out .smoke/ballistics-measure
export default async function (page, api) {
  // Rendered frames cost ~1 s each under SwiftShader (much more on a loaded box), and nothing here
  // needs one: the bench drives ballistics.update() itself.
  await api.run('window.__radius.start()');
  await api.wait(1500);
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setTime(11); r.ctx.debug.noEnemies = true; r.ctx.enemies.removeAll(); })()`);

  const out = await api.run(`(() => {
  const r = window.__radius, c = r.ctx, T = c.THREE;
  const B = c.ballistics;
  const log = { api: {}, ranges: [], pen: [] };
  log.api.returns = 'unknown';

  // --- witness plane helper -------------------------------------------------
  // A tall wall perpendicular to +x at distance R from the muzzle. Every round that reaches it
  // is recorded where it crossed; the mean y tells us drop, the scatter tells us the group.
  const ORIGIN = new T.Vector3(0, 400, 0);   // high above the terrain, nothing else in the way
  function wall(R, tag) {
    return c.world.addBox(ORIGIN.x + R, ORIGIN.y, ORIGIN.z, 0.4, 40, 40, { surface: 'concrete', tag });
  }
  function clearTag(tag) { c.world.clearTag ? c.world.clearTag(tag) : null; }

  function pump(shots) {
    // deferred projectiles: run the integrator until everything has landed
    if (!B.update) return;
    for (let i = 0; i < 400; i++) {
      if (shots.every((s) => s.done !== false)) break;
      B.update(0.02);
    }
  }
  function fireGroup(ammoId, R, n, spreadDeg, cls) {
    const tag = 'balli' + R;
    const w = wall(R, tag);
    const dir = new T.Vector3(1, 0, 0);
    const shots = [];
    for (let i = 0; i < n; i++) {
      const res = B.shoot(ORIGIN, dir, { ammo: ammoId, spreadDeg, cls, source: 'player', kind: 'bullet', tracer: false, zeroRange: 100 });
      if (Array.isArray(res)) for (const h of res) shots.push(h);
    }
    pump(shots);
    const pts = [];
    for (const s of shots) {
      const hs = s.hits || (s.point ? [s] : []);
      for (const h of hs) if (h.point && Math.abs(h.point.x - (ORIGIN.x + R)) < 1.5) pts.push(h);
    }
    if (!pts.length) { c.world.removeCollider ? c.world.removeCollider(w) : (w.dead = true); return null; }
    let sy = 0, sz = 0;
    for (const h of pts) { sy += h.point.y - ORIGIN.y; sz += h.point.z - ORIGIN.z; }
    const my = sy / pts.length, mz = sz / pts.length;
    let rad = 0, ext = 0;
    for (const h of pts) { const dy = h.point.y - ORIGIN.y - my, dz = h.point.z - ORIGIN.z - mz; const d = Math.hypot(dy, dz); rad += d; ext = Math.max(ext, d); }
    const tof = shots.map((s) => s.tof || 0).filter((x) => x > 0);
    const vend = shots.map((s) => s.speed || 0).filter((x) => x > 0);
    w.dead = true;
    return {
      ammo: ammoId, range: R, n: pts.length,
      dropCm: +(my * 100).toFixed(1), lateralCm: +(mz * 100).toFixed(1),
      groupMeanCm: +(rad / pts.length * 100).toFixed(1), groupExtremeCm: +(ext * 100).toFixed(1),
      tofMs: tof.length ? +(tof.reduce((a, b) => a + b, 0) / tof.length * 1000).toFixed(1) : 0,
      impactSpeed: vend.length ? +(vend.reduce((a, b) => a + b, 0) / vend.length).toFixed(0) : 0,
    };
  }
  const probe = B.shoot(ORIGIN, new T.Vector3(1, 0, 0), { ammo: '762_fmj', source: 'player', tracer: false });
  log.api.returns = Array.isArray(probe) ? (probe[0] && probe[0].hits !== undefined ? 'projectiles' : 'hits') : typeof probe;
  pump(probe);

  for (const [ammo, cls, spread] of [['762_fmj', 'rifle', 0], ['545_fmj', 'rifle', 0], ['9x18_fmj', 'pistol', 0], ['754_snb', 'sniper', 0]]) {
    for (const R of [10, 25, 50, 100, 200, 300]) {
      const g = fireGroup(ammo, R, 12, spread, cls);
      if (g) log.ranges.push(g);
    }
  }
  // dispersion at the AKM's own hip spread, 25 m
  const g = fireGroup('762_fmj', 25, 24, 2.4, 'rifle'); if (g) { g.note = 'hip spread 2.4 deg'; log.ranges.push(g); }
  return log;
})()`);
  console.log('api.shoot returns:', out.api.returns);
  console.log('ammo        range   n    drop     group(mean/ext)   tof      impact v');
  for (const r of out.ranges) {
    console.log(`  ${r.ammo.padEnd(10)} ${String(r.range).padStart(4)}m ${String(r.n).padStart(3)}  ${String(r.dropCm).padStart(7)}cm  ${String(r.groupMeanCm).padStart(6)}/${String(r.groupExtremeCm).padEnd(6)}cm ${String(r.tofMs).padStart(7)}ms ${String(r.impactSpeed).padStart(5)}m/s ${r.note || ''}`);
  }

  // --- penetration bench ----------------------------------------------------
  const pen = await api.run(`(() => {
  const r = window.__radius, c = r.ctx, T = c.THREE, B = c.ballistics;
  const ORIGIN = new T.Vector3(0, 500, 0);
  const rows = [];
  const CASES = [
    ['wood plank 0.08 m', 'wood', 0.08], ['wood beam 0.30 m', 'wood', 0.30],
    ['sheet steel box 0.05 m', 'metal', 0.05], ['concrete 0.20 m', 'concrete', 0.20],
    ['concrete 0.06 m', 'concrete', 0.06], ['glass 0.02 m', 'glass', 0.02],
  ];
  for (const [name, surface, th] of CASES) {
    for (const ammo of ['9x18_fmj', '762_fmj', '762_ap', '545_fmj', '12_buck']) {
      const slab = c.world.addBox(ORIGIN.x + 10, ORIGIN.y, ORIGIN.z, th, 20, 20, { surface, tag: 'penslab' });
      const witness = c.world.addBox(ORIGIN.x + 20, ORIGIN.y, ORIGIN.z, 0.4, 20, 20, { surface: 'concrete', tag: 'penwit' });
      const shots = [];
      for (let i = 0; i < 6; i++) { const res = B.shoot(ORIGIN, new T.Vector3(1, 0, 0), { ammo, source: 'player', tracer: false, spreadDeg: 0 }); if (Array.isArray(res)) shots.push(...res); }
      if (B.update) for (let i = 0; i < 200; i++) { if (shots.every((s) => s.done !== false)) break; B.update(0.02); }
      let through = 0, total = 0;
      for (const s of shots) {
        const hs = s.hits || (s.point ? [s] : []);
        total++;
        if (hs.some((h) => h.point && h.point.x > ORIGIN.x + 15)) through++;
      }
      slab.dead = true; witness.dead = true;
      rows.push({ barrier: name, ammo, through, total });
    }
  }
  return rows;
})()`);
  console.log('PENETRATION');
  for (const p of pen) console.log(`  ${p.barrier.padEnd(24)} ${p.ammo.padEnd(10)} ${p.through}/${p.total} through`);
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
