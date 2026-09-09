// The two questions, and nothing else: at two metres does the seeker read as a menacing doll or a toy,
// and at forty metres in fog can it be told from the other creatures by value and hue alone.
// Sibling spawns are guarded — a creature broken by someone else's in-flight edit must not take the
// line-up down with it.
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
  await api.frames(6);

  const info = await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const ex = p.x, ez = p.z - 9;
    const e = r.spawn('seeker', ex, ez, {});
    if (!e) return { ok: false };
    e.aware = 0;
    for (let i = 0; i < 40; i++) { c.elapsed += 0.05; try { e.update(0.05); } catch (err) {} e.position.set(ex, e.position.y, ez); }
    e.position.set(ex, e.position.y, ez); e.update = () => {};
    window.__subject = { x: ex, z: ez, h: e.height || 3.0 };
    window.__seeker = e;
    const tri = (o) => (o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3);
    return { ok: true, lods: e.lod ? e.lod.levels.map((l) => ({ d: l.distance, tris: Math.round(tri(l.object)) })) : null };
  })()`);
  console.log('SEEKER ' + JSON.stringify(info));

  const look = async (face, dist, hFrac) => {
    await api.run(`(() => {
      const c = window.__radius.ctx, r = window.__radius, S = window.__subject, e = window.__seeker;
      const rad = 18 * Math.PI / 180;
      const cx = S.x + Math.sin(rad) * ${dist}, cz = S.z + Math.cos(rad) * ${dist};
      r.teleport(cx, cz);
      e.yaw = Math.atan2(-(cx - S.x), -(cz - S.z)) + ${face} * Math.PI / 180;
      e.root.position.set(S.x, e.position.y, S.z); e.root.rotation.y = e.yaw;
      const aimY = c.world.getHeight(S.x, S.z) + S.h * ${hFrac};
      r.setLook(Math.atan2(-(S.x - cx), -(S.z - cz)), Math.atan2(aimY - c.player.eye.y, ${dist}));
      if (c.hands && c.hands.root) c.hands.root.visible = false;
    })()`);
    await api.frames(4);
    await api.run(`(() => { const c = window.__radius.ctx; if (c.hands && c.hands.root) c.hands.root.visible = false; })()`);
    await api.frames(2);
  };

  await look(10, 2.4, 0.70);
  await api.screenshot('seeker-2m');

  await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, S = window.__subject;
    const mk = (t, dx) => {
      let e = null;
      try { e = r.spawn(t, S.x + dx, S.z, {}); } catch (err) { console.warn('lineup: ' + t + ' failed to spawn'); }
      if (!e) return;
      e.aware = 0;
      for (let i = 0; i < 30; i++) { c.elapsed += 0.05; try { e.update(0.05); } catch (err) {} e.position.set(S.x + dx, e.position.y, S.z); }
      e.position.set(S.x + dx, e.position.y, S.z); e.update = () => {};
    };
    mk('mimic', 4.5); mk('slider', 8.5); mk('spawn', 11.5); mk('phantom', 14.5);
    const s = window.__seeker; s.yaw = Math.PI; s.root.rotation.y = Math.PI;
  })()`);
  await api.frames(3);
  await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, S = window.__subject;
    r.teleport(S.x + 6.5, S.z + 40);
    r.setLook(0, Math.atan2(c.world.getHeight(S.x, S.z) + 1.4 - c.player.eye.y, 40));
    c.camera.fov = 30; c.camera.updateProjectionMatrix();
    if (c.hands && c.hands.root) c.hands.root.visible = false;
  })()`);
  await api.frames(5);
  await api.screenshot('lineup-40m');
  await api.run(`(() => { const c = window.__radius.ctx; c.camera.fov = c.state.data.settings.fov || 75; c.camera.updateProjectionMatrix(); })()`);
  console.log('SEEKER2-DONE');
}
