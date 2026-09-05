// Fragment: three in a cluster 10 m ahead at noon and at night; attraction, contact explosion, and a pop.
export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.debug.noEnemies = true; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.05); r.setTime(12); r.god();
    const p = r.ctx.player; p.update(0); const f = p.forward;
    window.__f = [0, 1, 2].map((i) => r.spawn('fragment', p.position.x + f.x * 10 + (i - 1) * 2.2 * f.z, p.position.z + f.z * 10 - (i - 1) * 2.2 * f.x));
    for (const e of window.__f) e.state = 'orbit';
  })()`);
  await api.frames(6);
  await api.screenshot('fragments-noon-10m');
  const s0 = await api.run(`(() => { const r = window.__radius; return window.__f.map((e) => ({ state: e.state, d: +e.distanceToPlayer().toFixed(1), y: +e.position.y.toFixed(2), period: +e.period.toFixed(2) })).concat([{ calls: r.stats().calls }]); })()`);
  console.log('t0', JSON.stringify(s0));
  await api.frames(40);
  const s1 = await api.run(`(() => { const r = window.__radius; return { frags: window.__f.map((e) => ({ state: e.state, alive: e.alive, d: +e.distanceToPlayer().toFixed(1), speed: +e.vel.length().toFixed(1), period: +e.period.toFixed(2) })), hp: r.ctx.player.hp, director: r.ctx.director.state }; })()`);
  console.log('t2', JSON.stringify(s1));
  await api.screenshot('fragments-approaching');
  // let them reach the player with god off
  await api.run(`(() => { window.__radius.god(false); })()`);
  let shock = 0, hp = 100, done = false;
  for (let i = 0; i < 14 && !done; i++) {
    await api.frames(10);
    const s = await api.run(`(() => { const r = window.__radius; return { shock: +r.ctx.post.st.shock.toFixed(2), hp: r.ctx.player.hp, alive: window.__f.filter((e) => e.alive).length, d: window.__f.map((e) => +e.distanceToPlayer().toFixed(1)), states: window.__f.map((e) => e.state) }; })()`);
    shock = Math.max(shock, s.shock); hp = s.hp;
    console.log('contact-wait', JSON.stringify(s));
    if (s.alive < 3) { done = true; await api.screenshot('fragment-exploded'); }
  }
  console.log('contact result', JSON.stringify({ shockPeak: shock, hp }));
  // night: a fresh cluster 8 m ahead, orbiting only (no LOS trick: just park them far in state orbit)
  await api.run(`(() => { const r = window.__radius; r.god(); r.setTime(22.5); r.ctx.enemies.removeAll(); const p = r.ctx.player; p.update(0); const f = p.forward;
    window.__f = [0, 1, 2].map((i) => r.spawn('fragment', p.position.x + f.x * 9 + (i - 1) * 1.8 * f.z, p.position.z + f.z * 9 - (i - 1) * 1.8 * f.x));
  })()`);
  await api.frames(8);
  await api.screenshot('fragments-night');
  await api.run(`(() => { const r = window.__radius; const p = r.ctx.player; const e = window.__f[1]; e.position.set(p.position.x + p.forward.x * 2.2, p.position.y + 1.6, p.position.z + p.forward.z * 2.2); e.state = 'orbit'; e.vel.set(0,0,0); e.home.set(e.position.x, r.ctx.world.getHeight(e.position.x, e.position.z), e.position.z); e.orbitT = 0; e.p1 = 0; e.p2 = 0; e.p3 = -Math.PI / 2; e.ax = 0.1; e.az = 0.1; })()`);
  await api.frames(4);
  await api.screenshot('fragment-night-close');
  // pop one with a shot
  await api.run(`(() => { const r = window.__radius; const e = window.__f[1]; e.damage(10, { kind: 'bullet', point: e.position.clone() }); })()`);
  await api.frames(2);
  await api.screenshot('fragment-pop');
  await api.frames(10);
  const s2 = await api.run(`(() => { const r = window.__radius; return { enemies: r.ctx.enemies.list.length, alive: r.ctx.enemies.count('fragment'), calls: r.stats().calls, missing: r.stats().missingSounds }; })()`);
  console.log('after pop', JSON.stringify(s2));
}
