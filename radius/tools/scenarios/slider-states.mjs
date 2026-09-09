// The slider judged fairly: in motion, in several states, not frozen in its ambush crouch. Its bind pose has
// the limbs hanging straight down and the IK folds them into the impossible arches at run time, and with
// aware=0 it lies flat in the grass on purpose — so a single frozen idle shot says nothing about the model.
const STATES = ['hidden', 'circle', 'charge', 'lunge'];

export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx;
    r.god(true); r.setTime(11); r.teleport(60, 210);
    c.state.data.settings.dynamicResolution = false; c.state.data.settings.resolutionScale = 1;
    c.perf.scale = 1; c.perf.applyScale && c.perf.applyScale();
    c.hud.setGameVisible(false);
    if (c.hands && c.hands.root) c.hands.root.visible = false;
  })()`);
  await api.frames(3);

  const info = await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const e = r.spawn('slider', p.x, p.z - 8);
    if (!e) return { ok: false };
    window.__s = e;
    let tris = 0, meshes = 0;
    if (e.root) e.root.traverse((o) => { if (o.isMesh && o.geometry) { meshes++; const g = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; tris += g; } });
    return { ok: true, triangles: Math.round(tris), meshes, height: +(e.height || 0).toFixed(2) };
  })()`);
  console.log('SLIDER ' + JSON.stringify(info));
  if (!info.ok) return;

  for (const st of STATES) {
    // drive it into the state and let the IK actually fold, pinning it so it stays in frame
    await api.run(`(() => {
      const c = window.__radius.ctx, r = window.__radius, e = window.__s, p = c.player.position;
      const ex = p.x, ez = p.z - 4.5;
      e.aware = ${JSON.stringify(st)} === 'hidden' ? 0 : 1;
      if (e.setState) e.setState(${JSON.stringify(st)}); else e.state = ${JSON.stringify(st)};
      for (let i = 0; i < 30; i++) {
        c.elapsed += 0.05;
        try { e.update(0.05); } catch {}
        e.position.set(ex, e.position.y, ez);
        if (e.state !== ${JSON.stringify(st)} && e.setState) e.setState(${JSON.stringify(st)});
      }
      e.yaw = Math.atan2(p.x - ex, p.z - ez);
      const eye = c.player.eye.y;
      const aimY = c.world.getHeight(ex, ez) + 0.5;
      r.setLook(Math.atan2(-(ex - p.x), -(ez - p.z)), Math.atan2(aimY - eye, 4.5));
      return e.state;
    })()`);
    await api.frames(3);
    await api.screenshot(`slider-${st}`);
    // and a side angle on the charge, where the impossible arches should read
    if (st === 'charge') {
      await api.run(`(() => {
        const c = window.__radius.ctx, r = window.__radius, e = window.__s;
        const cx = e.position.x + 4.5, cz = e.position.z;
        r.teleport(cx, cz);
        const eye = c.player.eye.y, aimY = c.world.getHeight(e.position.x, e.position.z) + 0.5;
        r.setLook(Math.atan2(-(e.position.x - cx), -(e.position.z - cz)), Math.atan2(aimY - eye, 4.5));
      })()`);
      await api.frames(3);
      await api.screenshot('slider-charge-side');
      await api.run(`(() => { const c = window.__radius.ctx, r = window.__radius, e = window.__s; r.teleport(e.position.x, e.position.z + 4.5); })()`);
    }
  }
  console.log('SUMMARY triangles=' + info.triangles + ' meshes=' + info.meshes + ' states=' + STATES.join(','));
}
