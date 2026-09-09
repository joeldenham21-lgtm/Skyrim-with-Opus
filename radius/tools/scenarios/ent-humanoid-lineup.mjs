// A parade of mimic bodies, built straight from charmesh with no loadout picker in the way, so the six builds
// and six head coverings can be judged side by side. Answers the two questions that matter: at two metres does
// it read as a menacing doll or as a toy, and at forty metres can you tell it apart from the rest of the
// bestiary by colour and value alone.
const ROW = [
  ['lean', 'ushankaUp', 'jacket', 0.0],
  ['reg', 'ssh60', 'jacket', 0.35],
  ['broad', 'hood', 'coat', 0.0],
  ['heavy', 'ushankaDown', 'jacket', 0.9],
  ['wiry', 'cap', 'jacket', 0.0],
  ['stocky', 'bare', 'coat', 0.0],
];

export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx;
    r.god(true); r.setTime(11); r.teleport(60, 210);
    c.state.data.settings.dynamicResolution = false; c.state.data.settings.resolutionScale = 1;
    c.perf.scale = 1; c.perf.applyScale && c.perf.applyScale();
    c.hud.setGameVisible(false);
    c.weapons && c.weapons.holster && c.weapons.holster();
  })()`);
  await api.frames(4);

  const info = await api.run(`(() => {
    const r = window.__radius, c = r.ctx, T = window.THREE || c.THREE;
    const CM = window.__charmesh;
    if (!CM) return { ok: false, why: 'no __charmesh hook' };
    CM.refresh(c.elapsed);
    const p = c.player.position;
    const z0 = p.z - 6;
    window.__row = [];
    const row = ${JSON.stringify(ROW)};
    const out = [];
    for (let i = 0; i < row.length; i++) {
      const [b, h, coat, aim] = row[i];
      const m = CM.make(b, h, coat, 0);
      if (!m) { out.push({ b, h, coat, tris: 0 }); continue; }
      const x = p.x + (i - (row.length - 1) / 2) * 1.15;
      m.root.position.set(x, c.world.getHeight(x, z0), z0);
      m.root.rotation.y = Math.PI + (i - 2.5) * 0.06;
      c.scene.add(m.root);
      for (let k = 0; k < 12; k++) m.rig.pose({ dt: 0.05, speed: 0, aim, aimPitch: 0.02, headYaw: (i - 2.5) * 0.10, headPitch: 0.04, crouch: 0 });
      m.root.updateMatrixWorld(true);
      window.__row.push(m);
      out.push({ b, h, coat, tris: m.tris });
    }
    window.__rowZ = z0; window.__rowX = p.x;
    return { ok: true, out };
  })()`);
  console.log('LINEUP ' + JSON.stringify(info));

  const look = async (dx, dz, aimX, aimY, aimZ) => {
    await api.run(`(() => {
      const c = window.__radius.ctx, r = window.__radius;
      const dx = ${dx}, dz = ${dz}, ax = ${aimX}, ay = ${aimY}, az = ${aimZ};
      r.teleport(ax + dx, az + dz);
      const eye = c.player.eye.y;
      r.setLook(Math.atan2(dx, dz), Math.atan2(ay - eye, Math.hypot(dx, dz)));
    })()`);
    await api.frames(5);
  };
  const RX = await api.run('window.__rowX'), RZ = await api.run('window.__rowZ');
  const gy = await api.run(`window.__radius.ctx.world.getHeight(window.__rowX, window.__rowZ)`);

  await look(0, 6.4, RX, gy + 1.05, RZ);
  await api.screenshot('row-front');
  await look(0.2, -6.0, RX, gy + 1.05, RZ);
  await api.screenshot('row-back');

  // close portraits: the second man (helmet, aiming) and the fourth (ushanka down, greatcoat neighbour)
  for (const [i, name] of [[1, 'ssh60'], [2, 'greatcoat']]) {
    const x = RX + (i - 2.5) * 1.15;
    await look(0.0, 2.1, x, gy + 1.00, RZ); await api.screenshot(`${name}-front`);
    await look(1.55, 0.75, x, gy + 1.00, RZ); await api.screenshot(`${name}-3q`);
    await look(0.0, 0.85, x, gy + 1.62, RZ); await api.screenshot(`${name}-head`);
  }
  // the ushanka head, and the hands and elbow at arm's length
  await look(0.0, 0.85, RX + (3 - 2.5) * 1.15, gy + 1.62, RZ); await api.screenshot('ushanka-head');
  await look(0.85, 0.55, RX + (1 - 2.5) * 1.15, gy + 1.10, RZ); await api.screenshot('hands');
  // the whole row from forty metres, which is where value and hue have to do all the work
  await look(0, 40, RX, gy + 1.0, RZ); await api.screenshot('row-40m');
}
