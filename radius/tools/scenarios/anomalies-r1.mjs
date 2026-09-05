// Review pass 1: each anomaly type at 8 m and up close, day and night, plus mechanics numbers.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const at = async (x, z, yaw = 0, pitch = -0.08, hour = 12, torch = false) => {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.state.data.hp = 100; r.ctx.state.data.bleeding = false; })()`);
  };
  const spawn = async (type, x, z, reveal = false) => api.run(`(() => { const r = window.__radius; r.ctx.anomalies.reset(); const a = r.spawnAnomaly('${type}', ${x}, ${z}); ${reveal ? 'a.reveal();' : ''} return { radius: +a.radius.toFixed(1), y: +a.position.y.toFixed(2) }; })()`);
  const info = async () => api.run(`(() => { const r = window.__radius, s = r.stats(); const u = r.ctx.post.uniforms; const L = r.ctx.lighting; return { hp: s.hp, calls: s.calls, tris: s.triangles, err: s.error, distort: +u.uDistort.value.toFixed(3), ab: +u.uAberration.value.toFixed(3), blur: +u.uBlur.value.toFixed(3), pos: s.pos, an: r.ctx.anomalies.list.map((a) => a.type + (a.revealed ? '*' : '')), horizon: L.horizon.toArray().map((v) => +v.toFixed(2)), missing: s.missingSounds }; })()`);
  const X = 30, Z = 130;

  await at(X, Z);
  await api.frames(2); console.log('baseline', await info());
  console.log('reflector', await spawn('reflector', X, Z - 8));
  await api.frames(3); await api.screenshot('reflector-8m-unrevealed'); console.log(await info());
  await api.run(`window.__radius.teleport(${X}, ${Z - 4.5}); window.__radius.setLook(0, 0.12)`);
  await api.frames(3); await api.screenshot('reflector-close'); console.log('close', await info());
  await api.run(`window.__radius.ctx.anomalies.list[0].reveal()`);
  await api.frames(2); await api.screenshot('reflector-revealed');
  await api.frames(8); console.log('after whip', await info());

  await at(X, Z);
  console.log('electric', await spawn('electric', X, Z - 8, true));
  await api.frames(3); await api.screenshot('electric-8m-revealed'); console.log(await info());
  await api.run(`window.__radius.teleport(${X}, ${Z - 5.5}); window.__radius.setLook(0, 0.05)`);
  await api.frames(3); await api.screenshot('electric-zap'); console.log('after zap', await info());

  await at(X, Z);
  console.log('gravity', await spawn('gravity', X, Z - 8));
  await api.frames(4); await api.screenshot('gravity-8m'); console.log(await info());
  await api.run(`window.__radius.teleport(${X}, ${Z - 4})`);
  await api.frames(4); await api.screenshot('gravity-near'); console.log('near gravity', await info());

  await at(X, Z - 12);
  console.log('gas', await spawn('gas', X, Z - 32));
  await api.frames(4); await api.screenshot('gas-20m'); console.log(await info());
  await api.run(`window.__radius.teleport(${X}, ${Z - 22})`);
  await api.frames(3); await api.screenshot('gas-10m'); console.log(await info());
  await api.run(`window.__radius.teleport(${X}, ${Z - 30})`);
  await api.frames(4); await api.screenshot('gas-inside'); console.log('inside gas', await info());

  // night with the torch
  await at(X, Z, 0, -0.08, 22.5, true);
  console.log('electric night', await spawn('electric', X, Z - 8, true));
  await api.frames(3); await api.screenshot('electric-night');
  console.log('reflector night', await spawn('reflector', X, Z - 8, true));
  await api.frames(3); await api.screenshot('reflector-night');
  console.log('gravity night', await spawn('gravity', X, Z - 8));
  await api.frames(3); await api.screenshot('gravity-night');
  await at(X, Z - 12, 0, -0.08, 22.5, true);
  console.log('gas night', await spawn('gas', X, Z - 26));
  await api.frames(3); await api.screenshot('gas-night-14m'); console.log(await info());
}
