// One shot: the fragment at arm's length at noon after the close-range intensity easing.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(12); r.god(); })()`);
  await api.frames(3);
  await api.run(`(() => { const r = window.__radius; const p = r.ctx.player; p.update(0);
    const e = r.spawn('fragment', p.position.x + p.forward.x * 0.75, p.position.z + p.forward.z * 0.75); e.losT = 1e9; e.los = false;
    e.position.set(p.position.x + p.forward.x * 0.75, p.eye.y - 0.05, p.position.z + p.forward.z * 0.75); e.home.set(e.position.x, r.ctx.world.getHeight(e.position.x, e.position.z), e.position.z);
    e.ax = 0.02; e.az = 0.02; e.orbitT = 0; e.p1 = 0; e.p2 = 0; e.p3 = 0.3; e.pulsePhase = 0.15; })()`);
  await api.frames(3);
  await api.screenshot('glass-noon-arm-eased');
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { calls: s.calls, missing: s.missingSounds, error: s.error }; })()`);
  console.log('final', JSON.stringify(fin));
}
