// Verification pass: populate counts per POI, gas from a distance, unrevealed reflector, detector pose.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const X = 30, Z = 130;
  const at = async (x, z, yaw = 0, pitch = -0.08, hour = 12, torch = false) => {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.state.data.hp = 100; })()`);
  };
  console.log('populated', await api.run(`(() => { const r = window.__radius, M = r.ctx.world.map; const by = {}; for (const a of r.ctx.anomalies.list) { const p = r.ctx.world.nearestPoi(a.position.x, a.position.z, ['anomaly']).poi; const k = p.id + ':' + a.type; by[k] = (by[k] || 0) + 1; } return { by, total: r.ctx.anomalies.list.length, arts: r.ctx.artifacts.list.length, artTypes: r.ctx.artifacts.list.map((a) => a.type[0]).join('') }; })()`));
  const spawn = async (type, x, z) => api.run(`(() => { const r = window.__radius; r.ctx.anomalies.reset(); const a = r.spawnAnomaly('${type}', ${x}, ${z}); return { radius: +a.radius.toFixed(1) }; })()`);
  await at(X, Z);
  console.log('gas', await spawn('gas', X, Z - 20));
  await api.frames(4); await api.screenshot('gas-20m');
  await api.run(`window.__radius.teleport(${X}, ${Z - 11})`);
  await api.frames(3); await api.screenshot('gas-9m');
  await at(X, Z, 0, -0.08, 22.5, true);
  await api.run(`window.__radius.teleport(${X}, ${Z - 8})`);
  await api.frames(3); await api.screenshot('gas-night-12m');
  await at(X, Z);
  console.log('reflector', await spawn('reflector', X, Z - 8));
  await api.frames(3); await api.screenshot('reflector-day');
  await at(X, Z, 0, -0.1);
  await api.run(`(() => { const r = window.__radius; r.ctx.anomalies.reset(); r.ctx.artifacts.reset(); r.ctx.artifacts.spawn('ember', new r.ctx.THREE.Vector3(${X}, 0, ${Z - 5})); r.give('detector', 1); r.press('slot5'); })()`);
  await api.frames(8); await api.screenshot('detector');
  console.log('detector', await api.run(`(() => { const r = window.__radius; return { eq: r.ctx.detector.equipped, weapon: !!r.ctx.weapons.current }; })()`));
}
