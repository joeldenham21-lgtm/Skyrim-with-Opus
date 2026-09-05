// Spawn pack: five 10 m ahead at noon; idle look, swarm, bites; night look; death curl.
export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.debug.noEnemies = true; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, -0.2); r.setTime(12); r.god();
    const p = r.ctx.player; p.update(0); const f = p.forward;
    const T = r.ctx.THREE; const c = new T.Vector3(p.position.x + f.x * 10, 0, p.position.z + f.z * 10);
    window.__sp = [];
    for (let i = 0; i < 5; i++) { const a = i * 1.3, rr = 0.8 + (i % 3) * 0.6; const e = r.spawn('spawn', c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, { pack: c, yaw: p.yaw + Math.PI + (i - 2) * 0.4 }); e.aware = 0; window.__sp.push(e); }
    // freeze perception for the first look
    for (const e of window.__sp) e.playerVisibility = () => 0;
  })()`);
  await api.frames(6);
  await api.screenshot('spawn-pack-noon-10m');
  await api.run(`(() => { const r = window.__radius, p = r.ctx.player; const e = window.__sp[0]; e.position.set(p.position.x + p.forward.x * 2.5, 0, p.position.z + p.forward.z * 2.5); e.followGround(0); e.yaw = p.yaw + Math.PI + 0.6; r.setLook(0.2, -0.45); })()`);
  await api.frames(5);
  await api.screenshot('spawn-close');
  // release perception: the pack should swarm and bite
  await api.run(`(() => { const r = window.__radius; r.setLook(0.2, -0.2); r.god(false); for (const e of window.__sp) delete e.playerVisibility; })()`);
  let bites = 0;
  for (let i = 0; i < 12; i++) {
    await api.frames(10);
    const s = await api.run(`(() => { const r = window.__radius; return { hp: r.ctx.player.hp, states: window.__sp.map((e) => e.state), d: window.__sp.map((e) => +e.distanceToPlayer().toFixed(1)), aware: window.__sp.map((e) => +e.aware.toFixed(2)), director: r.ctx.director.state }; })()`);
    console.log('swarm', JSON.stringify(s));
    if (i === 3) await api.screenshot('spawn-swarming');
    if (s.hp < 100) { bites++; if (bites === 2) { await api.screenshot('spawn-biting'); break; } }
  }
  // hit one: it should retreat
  await api.run(`(() => { window.__radius.god(); const e = window.__sp[1]; e.damage(5, { kind: 'bullet' }); })()`);
  await api.frames(3);
  const s1 = await api.run(`(() => { return window.__sp.map((e) => e.state); })()`);
  console.log('after hit', JSON.stringify(s1));
  // night look
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); const p = r.ctx.player; p.update(0); for (let i = 0; i < window.__sp.length; i++) { const e = window.__sp[i]; e.setState('idle'); e.target = null; e.aware = 0; e.engaged = false; e.playerVisibility = () => 0; e.position.set(p.position.x + p.forward.x * (4 + i * 0.8) + (i - 2) * 0.9 * p.forward.z, 0, p.position.z + p.forward.z * (4 + i * 0.8) - (i - 2) * 0.9 * p.forward.x); e.followGround(0); e.yaw = p.yaw + Math.PI + (i - 2) * 0.5; } r.setLook(0.2, -0.25); })()`);
  await api.frames(8);
  await api.screenshot('spawn-night');
  await api.run(`(() => { window.__radius.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(6);
  await api.screenshot('spawn-night-torch');
  // death
  await api.run(`(() => { const r = window.__radius; r.setTime(12); r.ctx.state.data.flashlight.on = false; window.__sp[2].damage(100, { kind: 'bullet' }); })()`);
  await api.frames(4);
  await api.screenshot('spawn-death-curl');
  await api.frames(12);
  await api.screenshot('spawn-death-ash');
  const s2 = await api.run(`(() => { const r = window.__radius; return { enemies: r.ctx.enemies.list.length, alive: r.ctx.enemies.count('spawn'), calls: r.stats().calls, missing: r.stats().missingSounds }; })()`);
  console.log('after death', JSON.stringify(s2));
}
