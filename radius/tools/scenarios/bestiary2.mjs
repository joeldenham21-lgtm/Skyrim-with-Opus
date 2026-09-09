// Close portraits of every creature, two angles each. Fixes what made the first pass useless: the camera now
// stands a couple of metres away and aims at the creature's centre of mass rather than the horizon, the
// viewmodel and HUD are hidden, and each creature is allowed to settle into a real pose before being frozen
// (freezing it straight from spawn left it in the bind pose with its arms out).
const CAST = [
  { type: 'mimic',    d: 2.4, note: 'human enemy, regular' },
  { type: 'mimic',    d: 2.4, note: 'human enemy, elite', opts: { cls: 'elite' }, tag: 'elite' },
  { type: 'phantom',  d: 2.6, note: 'heat-shimmer humanoid, reveal forced' },
  { type: 'slider',   d: 2.2, note: '' },
  { type: 'spawn',    d: 1.5, note: '' },
  { type: 'fragment', d: 2.2, note: '' },
  { type: 'seeker',   d: 5.0, note: 'the big one' },
];
const ANGLES = [{ a: 0, name: 'front' }, { a: 90, name: 'side' }];

export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx;
    r.god(true); r.setTime(11); r.teleport(60, 210);
    c.state.data.settings.dynamicResolution = false; c.state.data.settings.resolutionScale = 1;
    c.perf.scale = 1; c.perf.applyScale && c.perf.applyScale();
    c.hud.setGameVisible(false);                 // no ammo counter over the subject
    if (c.hands && c.hands.root) c.hands.root.visible = false;   // and no pistol in the way
  })()`);
  await api.frames(6);

  const report = [];
  for (const m of CAST) {
    const spawned = await api.run(`(() => {
      const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
      for (const e of c.enemies.list) e.removeMe = true;
      c.enemies.update(0.05);
      const ex = p.x, ez = p.z - 8;
      const e = r.spawn(${JSON.stringify(m.type)}, ex, ez, ${JSON.stringify(m.opts || {})});
      if (!e) return { ok: false };
      // let it settle into a real stance, pinned so it cannot wander, THEN freeze
      e.aware = 0;
      for (let i = 0; i < 30; i++) {
        c.elapsed += 0.05;
        try { e.update(0.05); } catch {}
        e.position.set(ex, e.position.y, ez);
      }
      e.update = () => {};
      if (e.show) e.show(999);
      if ('reveal' in e) e.reveal = 999;
      window.__subject = { x: ex, z: ez, h: e.height || 1.8 };
      let tris = 0;
      if (e.root) e.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; tris += g * (o.isInstancedMesh ? o.count : 1); } });
      return { ok: true, type: e.type, cls: e.cls || null, hp: e.maxHp || e.hp,
               height: +(e.height || 0).toFixed(2), weapon: e.weapon || null, triangles: Math.round(tris) };
    })()`);
    if (!spawned.ok) { report.push({ type: m.type, spawned: false }); continue; }

    for (const ang of ANGLES) {
      await api.run(`(() => {
        const c = window.__radius.ctx, r = window.__radius, S = window.__subject;
        const rad = ${ang.a} * Math.PI / 180;
        // stand off at d on a circle round the subject, and look at its middle
        const cx = S.x + Math.sin(rad) * ${m.d}, cz = S.z + Math.cos(rad) * ${m.d};
        r.teleport(cx, cz);
        const eye = c.player.eye.y;
        const aimY = c.world.getHeight(S.x, S.z) + S.h * 0.55;
        const yaw = Math.atan2(-(S.x - cx), -(S.z - cz));
        const pitch = Math.atan2(aimY - eye, ${m.d});
        r.setLook(yaw, pitch);
      })()`);
      await api.frames(5);
      await api.screenshot(`${m.type}${m.tag ? '-' + m.tag : ''}-${ang.name}`);
    }
    report.push(Object.assign({ note: m.note }, spawned));
  }
  console.log('BESTIARY ' + JSON.stringify(report, null, 1));
  console.log('SUMMARY ' + report.map((r) => `${r.type}${r.cls ? '/' + r.cls : ''}=${r.spawned === false ? 'FAILED' : r.triangles + 'tris/' + r.height + 'm'}`).join('  '));
}
