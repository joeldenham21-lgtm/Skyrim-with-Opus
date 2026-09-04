// Soak test: teleports along the roads, looks around, toggles systems, forces night, dies and respawns.
// Reports errors and per-stop stats. node tools/smoke.mjs --scenario tools/scenarios/soak.mjs --out .smoke/soak
export default async function (page, api) {
  await api.start();
  const stops = [[0, 284, 0], [14, 240, 0.2], [22, 212, -0.4], [48, 160, 0.9], [10, 96, 0.3], [-50, 72, 1.2], [-130, 60, 2.0], [-130, 60, -1.0], [70, 50, -0.7], [150, -60, 1.5], [150, -60, -2.5], [110, -150, 0.4], [50, -230, 2.9], [-60, -150, 1.0], [-230, -70, 0.2], [-40, 140, -2.3], [0, 302, 0]];
  const report = [];
  let i = 0;
  for (const [x, z, yaw] of stops) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.08); })()`);
    await api.frames(12);
    if (i % 3 === 0) await api.screenshot(`stop-${i}-${x}_${z}`);
    const s = await api.run('window.__radius.stats()');
    report.push({ stop: i, x, z, fps: s.fps, calls: s.calls, tris: s.triangles, enemies: s.enemies, err: s.error });
    i++;
  }
  // torch + night + a shot
  await api.run(`(() => { const r = window.__radius; r.teleport(48, 160); r.setLook(0.9, -0.1); r.setTime(22.4); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(10);
  await api.screenshot('night-convoy');
  await page.mouse.down(); await api.frames(3); await page.mouse.up();
  await api.frames(6);
  // death + respawn
  await api.run(`window.__radius.ctx.player.damage(500, { kind: 'bullet' })`);
  await api.frames(10);
  await api.wait(4000);
  await api.screenshot('death');
  await api.run(`window.__radius.ctx.game.respawn()`);
  await api.frames(10);
  await api.screenshot('respawn-base');
  console.log('SOAK', JSON.stringify(report));
}
