// Portrait of every creature in the zone, one per shot, frozen so it cannot walk out of frame while the
// software renderer catches up. Daylight, open ground, camera at a fixed stand-off per type since a seeker is
// several times the size of a spawn. The phantom is a transmission shell and is nearly invisible by design,
// so it gets a second shot with reveal forced on.
const TYPES = [
  { type: 'mimic',    dist: 5.0, note: 'human enemy, regular class' },
  { type: 'mimic',    dist: 5.0, note: 'human enemy, elite class', opts: { cls: 'elite' } },
  { type: 'phantom',  dist: 5.5, note: 'heat-shimmer humanoid' },
  { type: 'slider',   dist: 5.0, note: '' },
  { type: 'spawn',    dist: 3.5, note: '' },
  { type: 'fragment', dist: 5.0, note: '' },
  { type: 'seeker',   dist: 9.0, note: 'the big one' },
];

export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx;
    r.god(true); r.setTime(11);
    r.teleport(60, 210);
    c.state.data.settings.dynamicResolution = false; c.state.data.settings.resolutionScale = 1;
    c.perf.scale = 1; c.perf.applyScale && c.perf.applyScale();
  })()`);
  await api.frames(8);

  const report = [];
  for (const t of TYPES) {
    const info = await api.run(`(() => {
      const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
      for (const e of c.enemies.list) e.removeMe = true;
      c.enemies.update(0.05);
      const ex = p.x, ez = p.z - ${t.dist};
      const e = r.spawn(${JSON.stringify(t.type)}, ex, ez, ${JSON.stringify(t.opts || {})});
      if (!e) return { ok: false };
      // hold it still and facing us: a live one walks out of shot while the renderer grinds
      e.update = () => {};
      e.yaw = Math.atan2(p.x - ex, p.z - ez);
      if (e.root) e.root.rotation.y = e.yaw;
      if (e.show) e.show(99);                       // phantom: force the reveal
      if ('reveal' in e) e.reveal = 99;
      r.setLook(Math.atan2(-(ex - p.x), -(ez - p.z)), -0.05);
      let tris = 0;
      if (e.root) e.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; tris += g * (o.isInstancedMesh ? o.count : 1); } });
      return { ok: true, type: e.type, cls: e.cls || null, hp: e.maxHp || e.hp,
               height: +(e.height || 0).toFixed(2), radius: +(e.radius || 0).toFixed(2),
               weapon: e.weapon || null, armour: e.armour || null, triangles: Math.round(tris) };
    })()`);
    if (!info.ok) { report.push({ type: t.type, spawned: false }); continue; }
    await api.frames(10);
    await api.screenshot(`${t.type}${t.opts ? '-' + Object.values(t.opts)[0] : ''}`);
    report.push(Object.assign({ note: t.note }, info));
  }
  console.log('BESTIARY ' + JSON.stringify(report, null, 1));
  console.log('SUMMARY ' + report.map((r) => `${r.type}${r.cls ? '/' + r.cls : ''}=${r.spawned === false ? 'FAILED' : r.triangles + 'tris'}`).join(' '));
}
