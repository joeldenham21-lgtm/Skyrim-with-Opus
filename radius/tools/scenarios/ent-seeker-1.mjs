// Seeker portraits. The camera azimuth is fixed (so every shot gets the same light) and the CREATURE is
// turned, which is the only way to be sure "front" is the front — a settled seeker keeps whatever yaw it
// spawned with. Whole figure at four angles, a close head-and-shoulders, the legs, the lamp lit, and a
// 40 m fog line-up against the mimic, the slider and a spawn so value and hue can be judged side by side.
//
// Two fixes over bestiary2.mjs: the viewmodel is holstered (setting hands.root.visible = false does not
// stick — weapons.js turns it back on), and the framing aims at the creature rather than the horizon.
const STAND = 5.8;     // whole figure, 3 m tall
const CLOSE = 3.0;     // head and shoulders
const CAM_A = 18;      // camera azimuth, degrees; constant so the sun does not move between shots

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
    e.position.set(ex, e.position.y, ez);
    e.update = () => {};
    window.__subject = { x: ex, z: ez, h: e.height || 3.0 };
    window.__seeker = e;
    let tris = 0, meshes = 0;
    if (e.root) e.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; tris += g * (o.isInstancedMesh ? o.count : 1); meshes++; } });
    const tri = (o) => (o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3);
    const lods = e.lod ? e.lod.levels.map((l) => ({ d: l.distance, tris: Math.round(tri(l.object)) })) : null;
    return { ok: true, height: +(e.height || 0).toFixed(2), hp: e.maxHp, allGeometry: Math.round(tris), meshes, lods, drawnNear: lods ? lods[0].tris : null };
  })()`);
  console.log('SEEKER ' + JSON.stringify(info));
  if (!info.ok) { console.log('SEEKER SPAWN FAILED'); return; }

  // face: 0 turns the creature's front to the camera, 90 its right side, 180 its back
  const look = async (face, dist, hFrac) => {
    await api.run(`(() => {
      const c = window.__radius.ctx, r = window.__radius, S = window.__subject, e = window.__seeker;
      const rad = ${CAM_A} * Math.PI / 180;
      const cx = S.x + Math.sin(rad) * ${dist}, cz = S.z + Math.cos(rad) * ${dist};
      r.teleport(cx, cz);
      // yaw 0 faces -z; turn the creature so the requested face points at the camera
      e.yaw = Math.atan2(-(cx - S.x), -(cz - S.z)) + ${face} * Math.PI / 180;
      e.root.position.set(S.x, e.position.y, S.z); e.root.rotation.y = e.yaw;
      const eye = c.player.eye.y;
      const aimY = c.world.getHeight(S.x, S.z) + S.h * ${hFrac};
      r.setLook(Math.atan2(-(S.x - cx), -(S.z - cz)), Math.atan2(aimY - eye, ${dist}));
      if (c.hands && c.hands.root) c.hands.root.visible = false;
    })()`);
    await api.frames(4);
    await api.run(`(() => { const c = window.__radius.ctx; if (c.hands && c.hands.root) c.hands.root.visible = false; })()`);
    await api.frames(2);
  };

  for (const a of [{ f: 0, n: 'front' }, { f: 40, n: 'q34' }, { f: 90, n: 'side' }, { f: 180, n: 'back' }]) {
    await look(a.f, STAND, 0.54);
    await api.screenshot(`seeker-${a.n}`);
  }
  await look(20, CLOSE, 0.88);
  await api.screenshot('seeker-head');
  await look(15, CLOSE, 0.26);
  await api.screenshot('seeker-legs');

  // the lamp lit and swept across the frame. The head keeps whatever yaw it settled with, so aim it by hand
  // and stand outside the 26 m cone, or the camera sits inside the beam and sees nothing but a wash.
  await api.run(`(() => {
    const e = window.__seeker; if (!e) return;
    e.setLight && e.setLight(1); e.engaged = true; e.aware = 1;
    e.rig.B.neck.rotation.y = 0.22; e.rig.B.head.rotation.y = 0.46;
  })()`);
  await look(0, 14, 0.52);
  await api.screenshot('seeker-lamp');

  // 40 m in fog against the other dark creatures
  await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, S = window.__subject;
    const mk = (t, dx) => { let e = null; try { e = r.spawn(t, S.x + dx, S.z, {}); } catch (err) { console.warn('lineup: ' + t + ' failed to spawn'); } if (!e) return; e.aware = 0;
      for (let i = 0; i < 30; i++) { c.elapsed += 0.05; try { e.update(0.05); } catch (err) {} e.position.set(S.x + dx, e.position.y, S.z); }
      e.position.set(S.x + dx, e.position.y, S.z); e.update = () => {}; };
    mk('mimic', 4.5); mk('slider', 8.5); mk('spawn', 11.5);
    const s = window.__seeker; s.yaw = Math.PI; s.root.rotation.y = Math.PI;
  })()`);
  await api.frames(3);
  // through a 30-degree lens, so 40 m of fog can actually be judged in a 700 px frame
  await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, S = window.__subject;
    r.teleport(S.x + 5.5, S.z + 40);
    const eye = c.player.eye.y, aimY = c.world.getHeight(S.x, S.z) + 1.4;
    r.setLook(0, Math.atan2(aimY - eye, 40));
    c.camera.fov = 30; c.camera.updateProjectionMatrix();
    if (c.hands && c.hands.root) c.hands.root.visible = false;
  })()`);
  await api.frames(5);
  await api.screenshot('lineup-40m');
  await api.run(`(() => { const c = window.__radius.ctx; c.camera.fov = c.state.data.settings.fov || 75; c.camera.updateProjectionMatrix(); })()`);

  console.log('SEEKER-DONE ' + JSON.stringify(info));
}
