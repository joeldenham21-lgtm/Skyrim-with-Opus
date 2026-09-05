// Review pass 4 (after fixes): the gloved probe throw, the detector with its grip hand, the pick-up reach, the
// no-transmission tear and the nacre pearl, plus draw calls with a tear in view.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const X = 30, Z = 130;
  const at = async (x, z, yaw = 0, pitch = -0.32, hour = 12, torch = false) => {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.state.data.hp = 100; })()`);
  };
  const spawnArt = async (type, x, z) => api.run(`(() => { const r = window.__radius; r.ctx.artifacts.reset(); const a = r.ctx.artifacts.spawn('${type}', new r.ctx.THREE.Vector3(${x}, 0, ${z})); return { type: a.type, y: +a.position.y.toFixed(2) }; })()`);
  const stats = async () => api.run(`(() => { const r = window.__radius, s = r.stats(); return { calls: s.calls, tris: s.triangles, err: s.error, arts: r.ctx.artifacts.list.length, missing: s.missingSounds }; })()`);
  await api.run('window.__radius.ctx.anomalies.reset()');
  // probe: the cocked hand two frames in, then the release frame
  await at(X, Z, 0, -0.05);
  await api.run(`(() => { const r = window.__radius; r.spawnAnomaly('electric', ${X}, ${Z - 9}); r.give('probe', 2); r.press('probe'); })()`);
  await api.frames(1); await api.screenshot('probe-cocked');
  await api.frames(2); await api.screenshot('probe-release');
  await api.frames(9); await api.screenshot('probe-revealed');
  console.log('after probe', await api.run(`(() => { const r = window.__radius; return { probes: r.ctx.probes.list.map((p) => [p.state, p.pos.toArray().map((v) => +v.toFixed(1))]), an: r.ctx.anomalies.list.map((a) => a.type + (a.revealed ? '*' : '')), left: r.ctx.inventory.count('probe'), handParented: !!r.ctx.hands.pivot.getObjectByName('probeHand') }; })()`));
  // detector with the grip hand
  await at(X, Z, 0, -0.1);
  await api.run(`(() => { const r = window.__radius; r.ctx.anomalies.reset(); r.ctx.artifacts.spawn('ember', new r.ctx.THREE.Vector3(${X}, 0, ${Z - 5})); r.give('detector', 1); r.press('slot5'); })()`);
  await api.frames(8); await api.screenshot('detector');
  console.log('detector', await api.run(`(() => { const r = window.__radius; return { eq: r.ctx.detector.equipped, weapon: !!r.ctx.weapons.current, calls: r.stats().calls }; })()`));
  await api.run(`window.__radius.press('slot1')`);
  await api.frames(5);
  console.log('after slot1', await api.run(`(() => { const r = window.__radius; return { eq: r.ctx.detector.equipped, weapon: !!r.ctx.weapons.current, detectorInScene: !!r.ctx.hands.pivot.getObjectByName('detector') }; })()`));
  // reach during the hold
  await at(X, Z);
  console.log('pick', await spawnArt('crown', X, Z - 1.6));
  await api.frames(2);
  await page.keyboard.down('KeyE');
  await api.frames(6); await api.screenshot('reach-hold');
  console.log('reach', await api.run(`(() => { const r = window.__radius; return { prog: +r.ctx.interact.holdProgress.toFixed(2), reach: !!r.ctx.hands.pivot.getObjectByName('artifactReach') }; })()`));
  await api.frames(10);
  await page.keyboard.up('KeyE');
  await api.frames(3);
  console.log('after pick', await api.run(`(() => { const r = window.__radius; return { arts: r.ctx.artifacts.list.length, inv: r.ctx.inventory.count('art_crown'), stat: r.ctx.state.data.stats.artifacts, reach: !!r.ctx.hands.pivot.getObjectByName('artifactReach') }; })()`));
  // tear (no transmission pass) and pearl (nacre)
  await at(X, Z);
  console.log('tear', await spawnArt('tear', X, Z - 1.6));
  await api.frames(3); await api.screenshot('tear-day'); console.log(await stats());
  console.log('pearl', await spawnArt('pearl', X, Z - 1.6));
  await api.frames(3); await api.screenshot('pearl-day'); console.log(await stats());
  await at(X, Z, 0, -0.32, 22.5, true);
  await api.frames(3); await api.screenshot('pearl-night');
}
