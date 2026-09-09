// Portraits of the two beasts this pass owns: the slider (quadruped) and the spawn (crawler).
//
// What this adds over tools/scenarios/bestiary2.mjs:
//   - the viewmodel really goes away (bestiary2 sets hands.root.visible = false, which the weapons module
//     writes back over on its next update, so a PM is in all fourteen of its frames). weapons.holster() plus a
//     re-hide after every settle keeps it gone.
//   - the slider is shot in BOTH of its poses: flat in the grass (what an ambusher looks like when you walk
//     past it) and up on all fours (what it looks like when it comes).
//   - the spawn gets a from-above frame, because it is 0.40 m tall and that is the angle a player mostly sees.
//   - a pack of five spawn together, because the pack read is the design's own unit.
//   - one flat 40 m line-up of slider, spawn and mimic in fog: the value/hue separation test.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HIDE = `(() => { const c = window.__radius.ctx;
  c.hud.setGameVisible(false);
  try { c.weapons.holster(); } catch {}
  if (c.hands && c.hands.root) c.hands.root.visible = false;
})()`;

export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  // Not api.start(): its frames(6) has a single 240 s deadline, and building the world under SwiftShader can
  // take longer than that on a loaded machine. Six frames(1) calls get 240 s each instead of 240 s between them.
  await api.run(`window.__radius.start()`);
  for (let i = 0; i < 6; i++) await api.frames(1);
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx;
    r.god(true); r.setTime(11); r.teleport(60, 210);
    c.state.data.settings.dynamicResolution = false; c.state.data.settings.resolutionScale = 1;
    c.perf.scale = 1; c.perf.applyScale && c.perf.applyScale();
  })()`);
  await api.run(HIDE);
  await api.frames(6);

  const report = [];
  // ---- one subject, settled, pinned, frozen ----
  const settle = (type, opts = {}, poke = '') => `(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const ex = p.x, ez = p.z - 8;
    const e = r.spawn(${JSON.stringify(type)}, ex, ez, ${JSON.stringify(opts)});
    if (!e) return { ok: false };
    e.aware = 0;
    ${poke}
    for (let i = 0; i < 40; i++) {
      c.elapsed += 0.05;
      ${poke}
      try { e.update(0.05); } catch (err) { return { ok: false, err: String(err) }; }
      e.position.set(ex, e.position.y, ez);
      ${poke}
    }
    e.update = () => {};
    window.__subject = { x: ex, z: ez, h: e.height || 1.0, y: e.position.y };
    let tris = 0, draws = 0;
    if (e.root) e.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; tris += g * (o.isInstancedMesh ? o.count : 1); draws++; } });
    return { ok: true, type: e.type, hp: e.maxHp || e.hp, height: +(e.height || 0).toFixed(2), rig: e.rig ? 'charmesh' : 'own', triangles: Math.round(tris), meshes: draws };
  })()`;

  const look = (d, pitchBias = 0, ang = 0) => `(() => {
    const c = window.__radius.ctx, r = window.__radius, S = window.__subject;
    const rad = ${ang} * Math.PI / 180;
    const cx = S.x + Math.sin(rad) * ${d}, cz = S.z + Math.cos(rad) * ${d};
    r.teleport(cx, cz);
    const eye = c.player.eye.y;
    const aimY = c.world.getHeight(S.x, S.z) + S.h * 0.55;
    const yaw = Math.atan2(-(S.x - cx), -(S.z - cz));
    const pitch = Math.atan2(aimY - eye, ${d}) + ${pitchBias};
    r.setLook(yaw, pitch);
  })()`;

  const shot = async (name, d, bias, ang) => {
    await api.run(look(d, bias, ang));
    await api.run(HIDE);
    await api.frames(5);
    await api.screenshot(name);
  };

  // ---------------------------------------------------------------- slider, flat (ambush)
  let r1 = await api.run(settle('slider', { wanderer: true }));
  report.push(Object.assign({ shot: 'slider-flat' }, r1));
  if (r1.ok) { await shot('slider-flat-front', 2.6, 0, 0); await shot('slider-flat-side', 2.6, 0, 90); }

  // ---------------------------------------------------------------- slider, up on all fours
  const UP = `e.setEngaged && e.setEngaged(true); e.setState('circle'); e.rise = 1; e.riseTarget = 1; e.moveSpeed = 3.0; e.aware = 1;`;
  let r2 = await api.run(settle('slider', { wanderer: true }, UP));
  report.push(Object.assign({ shot: 'slider-up' }, r2));
  if (r2.ok) {
    await shot('slider-up-front', 2.8, 0, 0);
    await shot('slider-up-side', 2.8, 0, 90);
    await shot('slider-up-3q', 3.0, 0, 40);
  }

  // ---------------------------------------------------------------- spawn: side, front, from above
  let r3 = await api.run(settle('spawn', { wanderer: true }));
  report.push(Object.assign({ shot: 'spawn' }, r3));
  if (r3.ok) {
    await shot('spawn-side', 1.4, 0, 90);
    await shot('spawn-front', 1.4, 0, 0);
    await shot('spawn-above', 1.0, -0.55, 35);
  }

  // ---------------------------------------------------------------- a pack of five
  const packed = await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const ex = p.x, ez = p.z - 8;
    const put = [[0,0],[0.9,0.5],[-0.8,0.7],[0.35,-1.0],[-1.0,-0.6]];
    const made = [];
    for (const [dx, dz] of put) {
      const e = r.spawn('spawn', ex + dx, ez + dz, { wanderer: true });
      if (!e) continue;
      e.aware = 0; made.push(e);
    }
    for (let i = 0; i < 30; i++) { c.elapsed += 0.05; for (let k = 0; k < made.length; k++) { try { made[k].update(0.05); } catch {} made[k].position.set(ex + put[k][0], made[k].position.y, ez + put[k][1]); } }
    for (const e of made) e.update = () => {};
    window.__subject = { x: ex, z: ez, h: 0.4 };
    return { ok: made.length > 0, n: made.length };
  })()`);
  report.push(Object.assign({ shot: 'spawn-pack' }, packed));
  if (packed.ok) { await shot('spawn-pack', 2.6, -0.12, 20); await shot('spawn-pack-above', 1.8, -0.5, 60); }

  // ---------------------------------------------------------------- the 40 m fog line-up
  const line = await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    for (const e of c.enemies.list) e.removeMe = true;
    c.enemies.update(0.05);
    const ex = p.x, ez = p.z - 40;
    const cast = [['mimic', -4.5], ['slider', 0], ['spawn', 3.6], ['spawn', 4.6], ['spawn', 4.1]];
    const made = [];
    for (const [t, dx] of cast) { const e = r.spawn(t, ex + dx, ez, { wanderer: true }); if (e) { e.aware = 0; made.push([e, ex + dx, ez]); } }
    for (const [e] of made) { if (e.type === 'slider') { e.setState('circle'); e.rise = 1; e.riseTarget = 1; } }
    for (let i = 0; i < 30; i++) { c.elapsed += 0.05; for (const [e, x, z] of made) { try { e.update(0.05); } catch {} e.position.set(x, e.position.y, z); if (e.type === 'slider') e.rise = 1; } }
    for (const [e] of made) e.update = () => {};
    window.__subject = { x: ex, z: ez, h: 1.8 };
    return { ok: made.length, n: made.length };
  })()`);
  report.push(Object.assign({ shot: 'lineup-40m' }, line));
  if (line.ok) await shot('lineup-40m', 40, 0.02, 0);

  console.log('BEASTS ' + JSON.stringify(report, null, 1));
  try { writeFileSync(resolve(api.outDir, 'beasts.json'), JSON.stringify(report, null, 1)); } catch {}
}
