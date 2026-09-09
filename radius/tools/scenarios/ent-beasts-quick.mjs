// The four frames that actually decide the two questions this pass has to answer: at two metres does the
// slider read as a menacing doll or as a toy, and at forty metres in fog can you tell the beasts apart by
// colour and value alone. Four shots instead of eleven, for when the machine is busy.
const HIDE = `(() => { const c = window.__radius.ctx;
  c.hud.setGameVisible(false);
  try { c.weapons.holster(); } catch {}
  if (c.hands && c.hands.root) c.hands.root.visible = false;
})()`;

export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.run(`window.__radius.start()`);
  for (let i = 0; i < 6; i++) await api.frames(1);
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx;
    r.god(true); r.setTime(11); r.teleport(60, 210);
    c.state.data.settings.dynamicResolution = false; c.state.data.settings.resolutionScale = 1;
    c.perf.scale = 1; c.perf.applyScale && c.perf.applyScale();
  })()`);
  await api.run(HIDE);
  await api.frames(4);

  const look = (d, bias, ang) => `(() => {
    const c = window.__radius.ctx, r = window.__radius, S = window.__subject;
    const rad = ${ang} * Math.PI / 180;
    const cx = S.x + Math.sin(rad) * ${d}, cz = S.z + Math.cos(rad) * ${d};
    r.teleport(cx, cz);
    const aimY = c.world.getHeight(S.x, S.z) + S.h * 0.55;
    r.setLook(Math.atan2(-(S.x - cx), -(S.z - cz)), Math.atan2(aimY - c.player.eye.y, ${d}) + ${bias});
  })()`;
  const shot = async (name, d, bias, ang) => {
    await api.run(look(d, bias, ang)); await api.run(HIDE); await api.frames(4); await api.screenshot(name);
  };

  const out = [];
  // the slider, up on all fours
  out.push(await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const ex = p.x, ez = p.z - 8;
    const e = r.spawn('slider', ex, ez, { wanderer: true });
    if (!e) return { ok: false };
    e.aware = 1; e.setState('circle'); e.rise = 1; e.riseTarget = 1; e.moveSpeed = 3;
    for (let i = 0; i < 40; i++) { c.elapsed += 0.05; try { e.update(0.05); } catch (err) { return { ok: false, err: String(err) }; }
      e.position.set(ex, e.position.y, ez); e.rise = 1; e.riseTarget = 1; e.moveSpeed = 3; }
    e.update = () => {};
    window.__subject = { x: ex, z: ez, h: e.height || 1 };
    let tris = 0; e.root.traverse((o) => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return { ok: true, what: 'slider', triangles: Math.round(tris), rig: e.rig ? 'charmesh' : 'own' };
  })()`));
  await shot('slider-side', 2.8, 0, 90);
  await shot('slider-3q', 3.0, 0, 40);

  // a pack of five spawn, from above
  out.push(await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const ex = p.x, ez = p.z - 8;
    const put = [[0,0],[0.85,0.5],[-0.8,0.65],[0.3,-0.95],[-0.95,-0.55]], made = [];
    for (const [dx, dz] of put) { const e = r.spawn('spawn', ex + dx, ez + dz, { wanderer: true }); if (e) { e.aware = 0; made.push(e); } }
    for (let i = 0; i < 30; i++) { c.elapsed += 0.05; for (let k = 0; k < made.length; k++) { try { made[k].update(0.05); } catch {} made[k].position.set(ex + put[k][0], made[k].position.y, ez + put[k][1]); } }
    for (const e of made) e.update = () => {};
    window.__subject = { x: ex, z: ez, h: 0.4 };
    let tris = 0; if (made[0]) made[0].root.traverse((o) => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return { ok: made.length > 0, what: 'spawn pack', n: made.length, triangles: Math.round(tris) };
  })()`));
  await shot('spawn-pack-above', 1.9, -0.5, 55);

  // the forty-metre line-up: mimic, slider, three spawn
  out.push(await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const ex = p.x, ez = p.z - 40;
    const cast = [['mimic', -4.5], ['slider', 0], ['spawn', 3.4], ['spawn', 4.4], ['spawn', 3.9]], made = [];
    for (const [t, dx] of cast) { const e = r.spawn(t, ex + dx, ez, { wanderer: true }); if (e) { e.aware = 0; made.push([e, ex + dx, ez]); } }
    for (const [e] of made) if (e.type === 'slider') { e.setState('circle'); e.rise = 1; e.riseTarget = 1; }
    for (let i = 0; i < 30; i++) { c.elapsed += 0.05; for (const [e, x, z] of made) { try { e.update(0.05); } catch {} e.position.set(x, e.position.y, z); if (e.type === 'slider') { e.rise = 1; e.riseTarget = 1; } } }
    for (const [e] of made) e.update = () => {};
    window.__subject = { x: ex, z: ez, h: 1.8 };
    return { ok: made.length, what: 'lineup', n: made.length };
  })()`));
  await shot('lineup-40m', 40, 0.02, 0);

  console.log('BEASTS ' + JSON.stringify(out));
}
