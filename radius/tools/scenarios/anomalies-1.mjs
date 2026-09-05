// Anomalies: spawn each type 8 m ahead, day + night, discharge test, gravity distortion, probe reveal.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const at = async (x, z, yaw = 0, pitch = -0.08, hour = 12, torch = false) => {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.state.data.hp = 100; })()`);
  };
  const spawn = async (type, x, z, reveal = false) => api.run(`(() => { const r = window.__radius; r.ctx.anomalies.reset(); const a = r.spawnAnomaly('${type}', ${x}, ${z}); ${reveal ? 'a.reveal();' : ''} return { radius: a.radius, y: +a.position.y.toFixed(2) }; })()`);
  const info = async () => api.run(`(() => { const r = window.__radius, s = r.stats(); const u = r.ctx.post.uniforms; return { hp: s.hp, calls: s.calls, err: s.error, distort: +u.uDistort.value.toFixed(3), ab: +u.uAberration.value.toFixed(3), blur: +u.uBlur.value.toFixed(3), pos: s.pos, an: r.ctx.anomalies.list.map((a) => a.type + (a.revealed ? '*' : '')) }; })()`);
  const X = 30, Z = 130;

  await at(X, Z);
  console.log('electric', await spawn('electric', X, Z - 8, true));
  await api.frames(3); await api.screenshot('electric-day'); console.log(await info());
  // walk into it: discharge
  await api.run(`window.__radius.teleport(${X}, ${Z - 5})`);
  await api.frames(3); await api.screenshot('electric-zap'); console.log('after zap', await info());

  await at(X, Z);
  console.log('reflector', await spawn('reflector', X, Z - 8));
  await api.frames(3); await api.screenshot('reflector-day'); console.log(await info());
  await api.run(`window.__radius.ctx.anomalies.list[0].reveal()`);
  await api.frames(2); await api.screenshot('reflector-revealed');
  await api.run(`window.__radius.teleport(${X}, ${Z - 4})`);
  await api.frames(10); await api.screenshot('reflector-whip'); console.log('after whip', await info());

  await at(X, Z);
  console.log('gravity', await spawn('gravity', X, Z - 8));
  await api.frames(4); await api.screenshot('gravity-day'); console.log(await info());
  await api.run(`window.__radius.teleport(${X}, ${Z - 3.5})`);
  await api.frames(4); await api.screenshot('gravity-near'); console.log('near gravity', await info());

  await at(X, Z);
  console.log('gas', await spawn('gas', X, Z - 8));
  await api.frames(5); await api.screenshot('gas-day'); console.log(await info());
  await at(X, Z, 0, -0.08, 22.5, true);
  await api.frames(3); await api.screenshot('gas-night'); console.log(await info());
  await api.run(`window.__radius.teleport(${X}, ${Z - 7})`);
  await api.frames(4); await api.screenshot('gas-inside'); console.log('inside gas', await info());

  // night looks for electric + reflector with the torch
  await at(X, Z, 0, -0.08, 22.5, true);
  console.log('electric night', await spawn('electric', X, Z - 8, true));
  await api.frames(3); await api.screenshot('electric-night');
  console.log('reflector night', await spawn('reflector', X, Z - 8));
  await api.frames(3); await api.screenshot('reflector-night');

  // probe reveal: unrevealed electric, throw G
  await at(X, Z, 0, -0.05, 12);
  console.log('probe target', await spawn('electric', X, Z - 9));
  await api.run(`window.__radius.give('probe', 3); window.__radius.press('probe')`);
  await api.frames(2); await api.screenshot('probe-hand');
  await api.frames(10); await api.screenshot('probe-revealed');
  console.log('after probe', await api.run(`(() => { const r = window.__radius; return { probes: r.ctx.probes.list.map((p) => [p.state, p.pos.toArray().map((v) => +v.toFixed(1))]), an: r.ctx.anomalies.list.map((a) => a.type + (a.revealed ? '*' : '')), left: r.ctx.inventory.count('probe') }; })()`));
  // gravity capture: probe spirals in
  console.log('gravity probe', await spawn('gravity', X, Z - 9));
  await api.run(`window.__radius.press('probe')`);
  await api.frames(9); await api.screenshot('probe-gravity');
  console.log('gravity probe', await api.run(`(() => { const r = window.__radius; return { probes: r.ctx.probes.list.map((p) => [p.state, p.pos.toArray().map((v) => +v.toFixed(1))]), an: r.ctx.anomalies.list.map((a) => a.type + (a.revealed ? '*' : '')) }; })()`));
}
