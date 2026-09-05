// Fragment glass at arm's length (0.75 m) and at 2.5 m, noon and night with the torch: four shots.
const ONE = (dist, dy) => `(() => { const r = window.__radius; const p = r.ctx.player; p.update(0); r.ctx.enemies.removeAll();
  const e = r.spawn('fragment', p.position.x + p.forward.x * ${dist}, p.position.z + p.forward.z * ${dist}); e.losT = 1e9; e.los = false;
  e.position.set(p.position.x + p.forward.x * ${dist}, p.eye.y + ${dy}, p.position.z + p.forward.z * ${dist}); e.home.set(e.position.x, r.ctx.world.getHeight(e.position.x, e.position.z), e.position.z);
  e.ax = 0.02; e.az = 0.02; e.orbitT = 0; e.p1 = 0; e.p2 = 0; e.p3 = 0.3; e.pulsePhase = 0.15; window.__e = e; })()`;
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(12); r.god(); })()`);
  await api.frames(3);
  await api.run(ONE(0.75, -0.05));
  await api.frames(3);
  await api.screenshot('glass-noon-arm');
  await api.run(ONE(2.5, -0.1));
  await api.frames(3);
  await api.screenshot('glass-noon-2m');
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(6);
  await api.screenshot('glass-night-2m');
  await api.run(ONE(0.75, -0.05));
  await api.frames(3);
  await api.screenshot('glass-night-arm');
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { enemies: s.enemies, calls: s.calls, missing: s.missingSounds, error: s.error }; })()`);
  console.log('final', JSON.stringify(fin));
}
