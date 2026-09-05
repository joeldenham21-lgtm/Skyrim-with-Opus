// Review pass 4: relaid Object 12 / church / convoy at 07:00, JS layout checks, then the base: stations, door both ways.
export default async function (page, api) {
  await page.evaluate(() => { window.__radius.ctx.debug.noEnemies = true; });
  await api.start();
  const checks = await api.run(`(() => {
    const ctx = window.__radius.ctx, w = ctx.world, M = w.map, T = ctx.THREE; const bad = [];
    for (const r of M.ROADS) for (let t = 0; t <= 1; t += 0.004) { const p = M.pointOnPolyline(r.pts, t); const y = w.getHeight(p.x, p.z);
      for (const s of [-1.2, 0, 1.2]) { const x = p.x - p.dz * s, z = p.z + p.dx * s; if (w.pointInSolid(x, y + 0.7, z)) { let tag = null; w.query(x, z, 0.1, (c) => { if (c.kind === 'box' && !c.passable && x >= c.min.x && x <= c.max.x && y + 0.7 >= c.min.y && y + 0.7 <= c.max.y && z >= c.min.z && z <= c.max.z) { tag = c.tag + ':' + c.surface; return false; } }); bad.push([r.id, +x.toFixed(1), +z.toFixed(1), tag]); } } }
    const doors = [];
    for (const d of ctx.structures.doors) {
      const p = new T.Vector3(d.x, w.getHeight(d.x, d.z), d.z); const dx = d.inside.x - d.x, dz = d.inside.z - d.z; const L = Math.hypot(dx, dz); const n = Math.ceil(L / 0.1);
      for (let i = 0; i < n; i++) { p.x += dx / L * 0.1; p.z += dz / L * 0.1; w.resolveCapsule(p, 0.35, 1.85); p.y = w.groundHeight(p.x, p.z, p.y + 0.3).y; }
      doors.push([+d.x.toFixed(1), +d.z.toFixed(1), +Math.hypot(p.x - d.inside.x, p.z - d.inside.z).toFixed(2)]);
    }
    const gh = w.groundHeight(M.BASE.x, M.BASE.z, 60);
    const reg = { cover: w.coverPoints.length, spawn: w.spawnSpots.length, loot: w.lootSpots.length, hide: w.hidingSpots.length };
    return { blockers: bad.filter((b) => !(b[0] === 'main' && b[2] > 290)), doors, baseGround: gh, reg, baseVol: [w.baseVolume.min.toArray(), w.baseVolume.max.toArray()] }; })()`);
  console.log('checks', JSON.stringify(checks));
  const shots = [
    ['o12-gate-road', 132, -30, -0.55, 7],
    ['o12-junction', 150, -60, 2.5, 7],
    ['church-road', 62, -214, 0.68, 7],
    ['convoy-soak-view', 48, 160, 0.9, 7],
  ];
  for (const [name, x, z, yaw, hour] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.06); r.setTime(${hour}); })()`);
    await api.frames(6);
    await api.screenshot(name);
    console.log('calls', name, JSON.stringify(await api.run(`(() => { const s = window.__radius.stats(); return [s.calls, s.triangles]; })()`)));
  }
  // base: spawn as a saved game does (groundHeight from above), look at the stations, then the door both ways
  const yawTo = (px, pz, tx, tz) => Math.atan2(-(tx - px), -(tz - pz));
  await api.run(`(() => { const r = window.__radius; const w = r.ctx.world; r.teleport(0, 302, w.groundHeight(0, 302, 60).y); r.setLook(${yawTo(0, 302, -3.7, 300.6)}, -0.1); r.setTime(12); })()`);
  await api.frames(6);
  console.log('base pos', JSON.stringify(await api.run(`(() => { const p = window.__radius.ctx.player; return { pos: p.position.toArray().map((v) => +v.toFixed(2)), inBase: p.inBase, prompt: document.getElementById('prompt').textContent }; })()`)));
  await api.screenshot('base-terminal-side');
  await api.run(`(() => { const r = window.__radius; r.setLook(${yawTo(0, 302, 4.0, 302.5)}, -0.1); })()`);
  await api.frames(5); await api.screenshot('base-bench-side');
  await api.run(`(() => { const r = window.__radius; r.teleport(-2.6, 300.6, 7.3); r.setLook(${yawTo(-2.6, 300.6, -3.7, 300.6)}, -0.15); })()`);
  await api.frames(4);
  console.log('terminal prompt', JSON.stringify(await api.run(`document.getElementById('prompt').textContent`)));
  await api.run(`(() => { const r = window.__radius; r.teleport(-3.0, 304.0, 7.3); r.setLook(${yawTo(-3.0, 304.0, -3.4, 304.0)}, -0.3); })()`);
  await api.frames(4);
  console.log('cot prompt', JSON.stringify(await api.run(`document.getElementById('prompt').textContent`)));
  // door from inside at night (tubes, the failing one), then use it
  await api.run(`(() => { const r = window.__radius; r.teleport(0, 298.2, 7.3); r.setLook(0, 0.05); r.setTime(23); })()`);
  await api.frames(6); await api.screenshot('base-door-inside-night');
  const lights = await api.run(`(() => { const ctx = window.__radius.ctx; const L = []; ctx.scene.traverse((o) => { if (o.isPointLight && o.position.z > 290) L.push([o.color.getHexString(), +o.intensity.toFixed(2), +o.position.y.toFixed(1), +o.position.z.toFixed(1)]); }); return { prompt: document.getElementById('prompt').textContent, inBase: ctx.player.inBase, lights: L }; })()`);
  console.log('door-in', JSON.stringify(lights));
  await api.run(`(() => { const c = window.__radius.ctx.interact.current; if (c) c.onInteract(); })()`);
  await api.frames(22);
  console.log('after exit', JSON.stringify(await api.run(`(() => { const p = window.__radius.ctx.player; return { pos: p.position.toArray().map((v) => +v.toFixed(2)), inBase: p.inBase }; })()`)));
  await api.frames(14);
  await api.run(`(() => { const r = window.__radius; r.teleport(0, 294.4); r.setLook(Math.PI, 0.05); })()`);
  await api.frames(6); await api.screenshot('base-door-outside-night');
  console.log('door-out', JSON.stringify(await api.run(`(() => { const ctx = window.__radius.ctx; return { prompt: document.getElementById('prompt').textContent, inBase: ctx.player.inBase }; })()`)));
  await api.run(`(() => { const c = window.__radius.ctx.interact.current; if (c) c.onInteract(); })()`);
  await api.frames(22);
  console.log('after enter', JSON.stringify(await api.run(`(() => { const p = window.__radius.ctx.player; return { pos: p.position.toArray().map((v) => +v.toFixed(2)), inBase: p.inBase }; })()`)));
  // flicker sample: read the failing tube's emissive over a few frames
  const fl = []; for (let i = 0; i < 6; i++) { await api.frames(2); fl.push(await api.run(`(() => { let v = null; window.__radius.ctx.scene.traverse((o) => { if (o.isPointLight && o.position.x > 2 && o.position.z > 300 && o.position.z < 302) v = +o.intensity.toFixed(2); }); return v; })()`)); }
  console.log('tubeB light samples', JSON.stringify(fl));
}
