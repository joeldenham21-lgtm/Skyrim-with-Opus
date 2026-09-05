// Artifacts up close (day + night), pickup via hold-E, and the detector on slot 5.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const X = 30, Z = 130;
  const at = async (x, z, yaw = 0, pitch = -0.32, hour = 12, torch = false) => {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; })()`);
  };
  const spawnArt = async (type, x, z) => api.run(`(() => { const r = window.__radius; r.ctx.artifacts.reset(); const a = r.ctx.artifacts.spawn('${type}', new r.ctx.THREE.Vector3(${x}, 0, ${z})); return { type: a.type, y: +a.position.y.toFixed(2) }; })()`);
  for (const type of ['pearl', 'ember', 'tear', 'crown']) {
    await at(X, Z);
    console.log(type, await spawnArt(type, X, Z - 1.9));
    await api.frames(3); await api.screenshot(type + '-day');
    console.log('prompt', await api.run(`(() => { const r = window.__radius; const c = r.ctx.interact.current; return c ? (typeof c.prompt === 'function' ? c.prompt() : c.prompt) : null; })()`));
  }
  await at(X, Z, 0, -0.32, 22.5, true);
  console.log('night', await spawnArt('pearl', X, Z - 1.9));
  await api.frames(3); await api.screenshot('pearl-night');
  console.log('night', await spawnArt('ember', X, Z - 1.9));
  await api.frames(3); await api.screenshot('ember-night');
  // pick up: hold E for 0.6 s of game time (dt is capped at 0.05 per frame -> 14 frames)
  await at(X, Z);
  console.log('pick', await spawnArt('crown', X, Z - 1.9));
  await api.frames(2);
  await page.keyboard.down('KeyE');
  await api.frames(16);
  await page.keyboard.up('KeyE');
  await api.screenshot('picked');
  console.log('after pick', await api.run(`(() => { const r = window.__radius; return { arts: r.ctx.artifacts.list.length, inv: r.ctx.inventory.count('art_crown'), stat: r.ctx.state.data.stats.artifacts }; })()`));
  // detector
  await at(X, Z, 0, -0.1);
  console.log('det', await spawnArt('pearl', X, Z - 6));
  await api.run(`window.__radius.give('detector', 1); window.__radius.press('slot5')`);
  await api.frames(8); await api.screenshot('detector');
  console.log('detector', await api.run(`(() => { const r = window.__radius; return { eq: r.ctx.detector.equipped, weapon: !!r.ctx.weapons.current, d: +r.ctx.artifacts.nearestDistance(r.ctx.player.position).toFixed(1) }; })()`));
  await api.run(`window.__radius.press('slot1')`);
  await api.frames(4);
  console.log('after slot1', await api.run(`(() => { const r = window.__radius; return { eq: r.ctx.detector.equipped, weapon: !!r.ctx.weapons.current }; })()`));
  // world population sanity
  console.log('populated', await api.run(`(() => { const r = window.__radius; r.ctx.anomalies.populate(); r.ctx.artifacts.populate(); return { an: r.ctx.anomalies.list.map((a) => a.type[0] + Math.round(a.position.x) + ',' + Math.round(a.position.z)), arts: r.ctx.artifacts.list.map((a) => a.type[0] + Math.round(a.position.x) + ',' + Math.round(a.position.z)) }; })()`));
}
