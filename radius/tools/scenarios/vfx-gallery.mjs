// Every impact family, a muzzle flash, a blood hit, a water splash and an explosion, fired in front of the
// camera on a grid so they can be looked at. The particle pools are ring buffers of 3000, so this also shows
// whether one effect starves the others.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.god(true); r.setTime(11); r.teleport(60, 210); r.setLook(0, -0.12); })()`);
  await api.frames(6);

  const FAMILIES = ['metal', 'concrete', 'brick', 'stone', 'wood', 'grass', 'foliage', 'mud', 'sand', 'snow', 'cloth', 'rubber', 'glass', 'ash', 'flesh'];
  const shot = async (name, js) => {
    await api.run(js);
    await api.frames(3);
    await api.screenshot(name);
  };

  // a row of impacts across the view, all at once, so they can be compared side by side
  await shot('impacts', `(() => {
    const c = window.__radius.ctx, T = c.THREE, p = c.player.eye;
    const fams = ${JSON.stringify(FAMILIES)};
    const n = new T.Vector3(0, 0, 1);
    fams.forEach((f, i) => {
      const x = p.x + (i - (fams.length - 1) / 2) * 1.15;
      const pos = new T.Vector3(x, p.y - 0.35, p.z - 6);
      c.vfx.impact(pos, n, f);
    });
    return fams.length;
  })()`);

  await shot('muzzle-and-blood', `(() => {
    const c = window.__radius.ctx, T = c.THREE, p = c.player.eye;
    const d = new T.Vector3(0, 0, -1);
    c.vfx.muzzleFlash(new T.Vector3(p.x - 1.6, p.y - 0.3, p.z - 2.2), d, 1.0);      // bare muzzle
    c.vfx.muzzleFlash(new T.Vector3(p.x, p.y - 0.3, p.z - 2.2), d, 2.2);            // ported brake
    c.vfx.muzzleFlash(new T.Vector3(p.x + 1.6, p.y - 0.3, p.z - 2.2), d, 0.3);      // suppressed
    c.vfx.blood(new T.Vector3(p.x + 3.2, p.y - 0.3, p.z - 3.5), new T.Vector3(0, 0, 1), 1.6);
    return 1;
  })()`);

  await shot('splash-and-boom', `(() => {
    const c = window.__radius.ctx, T = c.THREE, p = c.player.eye;
    c.vfx.splash(new T.Vector3(p.x - 2.5, p.y - 1.4, p.z - 7), new T.Vector3(0, 1, 0), 1.6);
    c.vfx.explosion(new T.Vector3(p.x + 3, p.y - 1.2, p.z - 9), 3);
    return 1;
  })()`);

  const s = await api.run(`window.__radius.stats()`);
  console.log('STATS ' + JSON.stringify(s));
  console.log('SUMMARY families=' + FAMILIES.length + ' errors=' + JSON.stringify(s.errors) + ' boot=' + JSON.stringify(s.bootErrors));
}
