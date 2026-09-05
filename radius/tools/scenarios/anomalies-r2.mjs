// Review pass 2: artifacts up close, probe throw/reveal, detector, populate/tide reset, draw calls.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const X = 30, Z = 130;
  const at = async (x, z, yaw = 0, pitch = -0.32, hour = 12, torch = false) => {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.state.data.hp = 100; })()`);
  };
  const spawnArt = async (type, x, z) => api.run(`(() => { const r = window.__radius; r.ctx.artifacts.reset(); const a = r.ctx.artifacts.spawn('${type}', new r.ctx.THREE.Vector3(${x}, 0, ${z})); return { type: a.type, y: +a.position.y.toFixed(2) }; })()`);
  const stats = async () => api.run(`(() => { const r = window.__radius, s = r.stats(); return { calls: s.calls, tris: s.triangles, err: s.error, an: s.anomalies, arts: r.ctx.artifacts.list.length, missing: s.missingSounds }; })()`);
  await api.run('window.__radius.ctx.anomalies.reset()');
  for (const type of ['pearl', 'ember', 'tear', 'crown']) {
    await at(X, Z);
    console.log(type, await spawnArt(type, X, Z - 1.6));
    await api.frames(3); await api.screenshot(type + '-day'); console.log(await stats());
  }
  await at(X, Z, 0, -0.32, 22.5, true);
  console.log('night', await spawnArt('tear', X, Z - 1.6));
  await api.frames(3); await api.screenshot('tear-night');
  console.log('night', await spawnArt('crown', X, Z - 1.6));
  await api.frames(3); await api.screenshot('crown-night');
  // pick up
  await at(X, Z);
  console.log('pick', await spawnArt('pearl', X, Z - 1.6));
  await api.frames(2);
  await page.keyboard.down('KeyE');
  await api.frames(8); await api.screenshot('pick-hold');
  await api.frames(8);
  await page.keyboard.up('KeyE');
  console.log('after pick', await api.run(`(() => { const r = window.__radius; return { arts: r.ctx.artifacts.list.length, inv: r.ctx.inventory.count('art_pearl'), stat: r.ctx.state.data.stats.artifacts, interact: !!r.ctx.interact.current }; })()`));
  // probe
  await at(X, Z, 0, -0.05);
  await api.run(`(() => { const r = window.__radius; r.ctx.anomalies.reset(); r.spawnAnomaly('electric', ${X}, ${Z - 9}); r.give('probe', 2); r.press('probe'); })()`);
  await api.frames(2); await api.screenshot('probe-hand');
  await api.frames(10); await api.screenshot('probe-revealed');
  console.log('after probe', await api.run(`(() => { const r = window.__radius; return { probes: r.ctx.probes.list.map((p) => [p.state, p.pos.toArray().map((v) => +v.toFixed(1))]), an: r.ctx.anomalies.list.map((a) => a.type + (a.revealed ? '*' : '')), left: r.ctx.inventory.count('probe') }; })()`));
  // detector: equip, look at it, then draw a weapon
  await at(X, Z, 0, -0.1);
  await api.run(`(() => { const r = window.__radius; r.ctx.anomalies.reset(); r.ctx.artifacts.reset(); r.ctx.artifacts.spawn('ember', new r.ctx.THREE.Vector3(${X}, 0, ${Z - 5})); r.give('detector', 1); r.press('slot5'); })()`);
  await api.frames(8); await api.screenshot('detector');
  console.log('detector', await api.run(`(() => { const r = window.__radius; return { eq: r.ctx.detector.equipped, weapon: !!r.ctx.weapons.current, d: +r.ctx.artifacts.nearestDistance(r.ctx.player.position).toFixed(1), calls: r.stats().calls }; })()`));
  await at(X, Z, 0, -0.1, 22.5, true);
  await api.frames(3); await api.screenshot('detector-night');
  await api.run(`window.__radius.press('slot1')`);
  await api.frames(5);
  console.log('after slot1', await api.run(`(() => { const r = window.__radius; return { eq: r.ctx.detector.equipped, weapon: !!r.ctx.weapons.current }; })()`));
  // populate + tide reset
  console.log('populated', await api.run(`(() => { const r = window.__radius; r.ctx.anomalies.populate(); r.ctx.artifacts.populate(); return { an: r.ctx.anomalies.list.map((a) => a.type[0] + Math.round(a.position.x) + ',' + Math.round(a.position.z)), arts: r.ctx.artifacts.list.map((a) => a.type[0] + Math.round(a.position.x) + ',' + Math.round(a.position.z)) }; })()`));
  await at(-80, -60, 2.2, -0.05);
  await api.frames(3); await api.screenshot('field_a-shore');
  console.log('near field_a', await stats());
  await api.run(`window.__radius.ctx.events.emit('tide', 1)`);
  await api.frames(3);
  console.log('after tide', await api.run(`(() => { const r = window.__radius; return { an: r.ctx.anomalies.list.length, arts: r.ctx.artifacts.list.length, sceneAnomalies: r.ctx.scene.children.filter((c) => /^anomaly_|^artifact_/.test(c.name)).length, err: r.stats().error }; })()`));
}
