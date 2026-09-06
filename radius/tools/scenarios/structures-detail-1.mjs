// Structures detail review: approach shots at Zarya (road, inside an izba), Object 12 (yard, control room),
// the church nave, the checkpoint booth, the convoy, the base at each station; noon and 22:30 with the torch.
// Prints registry counts and stats().calls / triangles at each shot.
//   node tools/smoke.mjs --out .smoke/sdetail-1 --scenario tools/scenarios/structures-detail-1.mjs --w 640 --h 360
//   SD_SHOTS=zarya-road,izba-inside  limits the shots; SD_NIGHT=1 renders every shot at 22:30 with the torch.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.run('window.__radius.start()');
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 400000 }); };
  await frames(3);
  const P = await api.run(`(() => { const s = window.__radius.ctx.structures; return JSON.stringify(s.views || {}); })()`);
  const views = JSON.parse(P);
  const shots = [
    ['zarya-road', views.zaryaRoad || { x: -95, z: 70, yaw: 1.3, pitch: -0.04 }],
    ['izba-inside', views.izbaInside || { x: -120, z: 48, yaw: 0.6, pitch: -0.05 }],
    ['o12-yard', views.o12Yard || { x: 128, z: -34, yaw: -0.9, pitch: -0.02 }],
    ['o12-control', views.o12Control || { x: 160, z: -50, yaw: 2.4, pitch: -0.1 }],
    ['church-nave', views.churchNave || { x: 52, z: -232, yaw: -1.4, pitch: 0.02 }],
    ['checkpoint-booth', views.checkpointBooth || { x: 20, z: 218, yaw: 0.5, pitch: -0.08 }],
    ['convoy', views.convoy || { x: 42, z: 180, yaw: 0.3, pitch: -0.04 }],
    ['base-terminal', views.baseTerminal || { x: -1.5, z: 300.6, yaw: Math.PI / 2, pitch: -0.15 }],
    ['base-bench', views.baseBench || { x: 2.0, z: 300.9, yaw: -Math.PI / 2, pitch: -0.15 }],
    ['base-crate', views.baseCrate || { x: 1.0, z: 301.5, yaw: -2.4, pitch: -0.2 }],
    ['base-door', views.baseDoor || { x: 0, z: 300.5, yaw: 0, pitch: -0.05 }],
    ['base-outside', views.baseOutside || { x: 0, z: 288, yaw: Math.PI, pitch: 0.05 }],
  ];
  const only = process.env.SD_SHOTS ? process.env.SD_SHOTS.split(',') : null;
  const nightAll = !!process.env.SD_NIGHT;
  let shot = 0;
  const counts = await api.run(`(() => { const w = window.__radius.ctx.world; const k = (a, f) => a.reduce((m, s) => { const kk = f(s) || 'none'; m[kk] = (m[kk] || 0) + 1; return m; }, {}); return JSON.stringify({ cover: w.coverPoints.length, spawn: w.spawnSpots.length, loot: w.lootSpots.length, lootKinds: k(w.lootSpots, (s) => s.kind), hide: w.hidingSpots.length, hideKinds: k(w.hidingSpots, (s) => s.kind), colliders: w.collision.all.length }); })()`);
  console.log('registries', counts);
  for (const [name, v] of shots) {
    if (only && !only.includes(name)) { shot++; continue; }
    const passes = nightAll ? [['night', 22.5, true]] : (name.startsWith('base') ? [['', 12, false]] : [['', 12, false], ['night', 22.5, true]]);
    for (const [suffix, hour, torch] of passes) {
      await api.run(`(() => { const r = window.__radius; r.teleport(${v.x}, ${v.z}${v.y !== undefined ? ', ' + v.y : ''}); r.setLook(${v.yaw}, ${v.pitch || 0}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.lighting.setFlashlight(${torch}); })()`);
      await frames(4);
      const p = `${api.outDir}/${String(shot++).padStart(2, '0')}-${name}${suffix ? '-' + suffix : ''}.png`;
      await page.screenshot({ path: p, timeout: 240000 });
      const st = await api.run(`(() => { const s = window.__radius.stats(); return JSON.stringify({ calls: s.calls, triangles: s.triangles, pos: s.pos, errors: s.errors }); })()`);
      console.log('screenshot', p, st);
    }
  }
}
