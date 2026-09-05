// Populated fields: vents and field_b as the player would find them; tide re-roll; draw-call check.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const info = async () => api.run(`(() => { const r = window.__radius, s = r.stats(); return { calls: s.calls, tris: s.triangles, err: s.error, an: s.anomalies, arts: r.ctx.artifacts.list.length, near: +r.ctx.anomalies.nearestDistance(r.ctx.player.position).toFixed(1) }; })()`);
  await api.run(`(() => { const r = window.__radius; r.teleport(-90, 205); r.setLook(0, -0.05); r.setTime(12); })()`);
  await api.frames(4); await api.screenshot('vents'); console.log('vents', await info());
  await api.run(`(() => { const r = window.__radius; r.teleport(225, 115); r.setLook(0, -0.05); r.setTime(17.5); })()`);
  await api.frames(4); await api.screenshot('field_b'); console.log('field_b', await info());
  await api.run(`(() => { const r = window.__radius; r.teleport(-60, 5); r.setLook(0, -0.05); r.setTime(21.5); r.ctx.state.data.flashlight.on = true; for (const a of r.ctx.anomalies.list) a.reveal(); })()`);
  await api.frames(4); await api.screenshot('field_a-night'); console.log('field_a', await info());
  console.log('tide', await api.run(`(() => { const r = window.__radius; r.ctx.state.data.tideLevel = 1; r.ctx.events.emit('tide', 1); return { an: r.ctx.anomalies.list.length, arts: r.ctx.artifacts.list.length, probes: r.ctx.probes.list.length }; })()`));
  await api.frames(3); console.log('after tide', await info());
}
