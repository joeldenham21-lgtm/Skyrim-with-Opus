// Slider: hidden 12 m ahead at noon, then look away and check that it rises and charges; night look; death.
export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.debug.noEnemies = true; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, -0.12); r.setTime(12); r.god();
    const p = r.ctx.player; p.update(0);
    const f = p.forward; window.__s = r.spawn('slider', p.position.x + f.x * 12, p.position.z + f.z * 12, { yaw: p.yaw + Math.PI, wanderer: true });
  })()`);
  await api.frames(6);
  await api.screenshot('slider-hidden-12m');
  const s0 = await api.run(`(() => { const s = window.__s; return { state: s.state, d: +s.distanceToPlayer().toFixed(1), h: s.height, rise: +s.rise.toFixed(2), observed: s.observedByPlayer(40) }; })()`);
  console.log('t0', JSON.stringify(s0));
  // close look at the hidden patch
  await api.run(`(() => { const r = window.__radius, s = window.__s; const p = r.ctx.player; s.position.set(p.position.x + p.forward.x * 4, 0, p.position.z + p.forward.z * 4); s.followGround(0); r.setLook(0.2, -0.35); })()`);
  await api.frames(6);
  await api.screenshot('slider-hidden-close');
  // put it back at 12 m, look away: it should rise and charge
  await api.run(`(() => { const r = window.__radius, s = window.__s; const p = r.ctx.player; r.setLook(0.2, -0.12); p.update(0); s.position.set(p.position.x + p.forward.x * 12, 0, p.position.z + p.forward.z * 12); s.followGround(0); r.setLook(0.2 + Math.PI, -0.1); })()`);
  await api.frames(8);
  const s1 = await api.run(`(() => { const s = window.__s; return { state: s.state, d: +s.distanceToPlayer().toFixed(1), rise: +s.rise.toFixed(2), h: s.height, aware: s.aware, engaged: s.engaged, director: window.__radius.ctx.director.state }; })()`);
  console.log('after look-away', JSON.stringify(s1));
  // turn back to watch it come
  await api.run(`(() => { window.__radius.setLook(0.2, -0.05); })()`);
  await api.frames(3);
  await api.screenshot('slider-charging');
  await api.frames(10);
  const s2 = await api.run(`(() => { const s = window.__s, r = window.__radius; return { state: s.state, d: +s.distanceToPlayer().toFixed(1), hp: r.ctx.player.hp, speed: +s.moveSpeed.toFixed(1), director: r.ctx.director.state, shake: +r.ctx.post.st.shake.toFixed(2) }; })()`);
  console.log('mid-charge', JSON.stringify(s2));
  await api.screenshot('slider-close-in');
  // let it lunge: god off so the damage shows
  await api.run(`(() => { window.__radius.god(false); })()`);
  await api.frames(30);
  const s3 = await api.run(`(() => { const s = window.__s, r = window.__radius; return { state: s.state, d: +s.distanceToPlayer().toFixed(1), hp: r.ctx.player.hp, bleeding: r.ctx.state.data.bleeding, director: r.ctx.director.state }; })()`);
  console.log('after lunge', JSON.stringify(s3));
  await api.screenshot('slider-after-lunge');
  await api.frames(60);
  const s4 = await api.run(`(() => { const s = window.__s, r = window.__radius; return { state: s.state, d: +s.distanceToPlayer().toFixed(1), hp: r.ctx.player.hp, seen: s.observedByPlayer(60), pos: s.position.toArray().map((v) => +v.toFixed(1)) }; })()`);
  console.log('retreat/circle', JSON.stringify(s4));
  // night, standing up 8 m away with the torch on
  await api.run(`(() => { const r = window.__radius, s = window.__s; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; r.god(); const p = r.ctx.player; s.position.set(p.position.x + p.forward.x * 8, 0, p.position.z + p.forward.z * 8); s.followGround(0); s.setState('circle'); s.target = null; s.waitT = 30; s.yaw = p.yaw + Math.PI; })()`);
  await api.frames(10);
  await api.screenshot('slider-night-torch');
  await api.run(`(() => { const r = window.__radius, s = window.__s; r.setTime(12); r.ctx.state.data.flashlight.on = false; const p = r.ctx.player; s.position.set(p.position.x + p.forward.x * 5, 0, p.position.z + p.forward.z * 5); s.followGround(0); s.setState('charge'); s.yaw = p.yaw + Math.PI; })()`);
  await api.frames(4);
  await api.screenshot('slider-noon-up-close');
  // death
  await api.run(`(() => { window.__s.damage(200, { kind: 'bullet' }); })()`);
  await api.frames(5);
  await api.screenshot('slider-death-crumple');
  await api.frames(14);
  await api.screenshot('slider-death-dissolve');
  const s5 = await api.run(`(() => { const r = window.__radius; return { enemies: r.ctx.enemies.list.length, calls: r.stats().calls, missing: r.stats().missingSounds }; })()`);
  console.log('after death', JSON.stringify(s5));
}
