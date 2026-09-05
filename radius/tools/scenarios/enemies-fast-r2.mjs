// Slider review: hidden and standing looks at noon and at night with the torch; the charge gate (watched vs
// not), the lunge damage, the retreat out of view; death. AI stepped through enemies.update() without rendering.
const place = (dist, state) => `(() => { const r = window.__radius, s = window.__s; const p = r.ctx.player; p.update(0); s.position.set(p.position.x + p.forward.x * ${dist}, 0, p.position.z + p.forward.z * ${dist}); s.followGround(0); s.yaw = p.yaw + Math.PI; s.setState('${state}'); s.target = null; s.waitT = 30; s.lostT = 0; })()`;
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, -0.3); r.setTime(12); r.god();
    const p = r.ctx.player; p.update(0); window.__s = r.spawn('slider', p.position.x + p.forward.x * 7, p.position.z + p.forward.z * 7, { yaw: p.yaw + Math.PI, wanderer: true }); })()`);
  await api.frames(5);
  await api.screenshot('slider-hidden-noon-7m');
  await api.run(place(4.5, 'circle'));
  await api.run(`window.__radius.setLook(0.2, -0.15)`);
  await api.frames(6);
  await api.screenshot('slider-up-noon');
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(5);
  await api.screenshot('slider-night-torch');
  // behaviour: 12 m ahead, hidden, watched: must stay hidden. then look away: charge, lunge, retreat.
  const beh = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, s = window.__s; r.setTime(12); ctx.state.data.flashlight.on = false; r.god(false);
    const p = ctx.player; r.setLook(0.2, -0.05); p.update(0);
    s.position.set(p.position.x + p.forward.x * 12, 0, p.position.z + p.forward.z * 12); s.followGround(0); s.setState('hidden'); s.aware = 0; s.engaged = false; s.rise = 0;
    const step = (n) => { for (let i = 0; i < n; i++) ctx.enemies.update(1 / 30); };
    step(90);
    const watched = { state: s.state, observed: s.observedByPlayer(40), d: +s.distanceToPlayer().toFixed(1) };
    // look away
    r.setLook(0.2 + Math.PI, -0.05); p.update(0); ctx.camera.updateMatrixWorld(true);
    const hp0 = ctx.state.data.hp; let chargeAt = -1, lungeAt = -1, hitAt = -1, retreatAt = -1, maxSpeed = 0; const trace = [];
    for (let i = 0; i < 900; i++) {
      ctx.enemies.update(1 / 30);
      maxSpeed = Math.max(maxSpeed, s.moveSpeed);
      if (s.state === 'charge' && chargeAt < 0) chargeAt = i;
      if (s.state === 'lunge' && lungeAt < 0) lungeAt = i;
      if (ctx.state.data.hp < hp0 && hitAt < 0) hitAt = i;
      if (s.state === 'retreat' && retreatAt < 0) retreatAt = i;
      if (i % 90 === 0) trace.push({ i, st: s.state, d: +s.distanceToPlayer().toFixed(1), sp: +s.moveSpeed.toFixed(1) });
      if (s.state === 'circle' && s.stateT > 0.5) { trace.push({ i, st: s.state, d: +s.distanceToPlayer().toFixed(1) }); break; }
    }
    const after = { state: s.state, d: +s.distanceToPlayer().toFixed(1), seenNow: s.observedByPlayer(60), hp: ctx.state.data.hp, bleeding: !!ctx.state.data.bleeding, director: ctx.director.state, maxSpeed: +maxSpeed.toFixed(1) };
    // circle: turn to face it; from > 15 m it should come to ~13 m, then stalk while watched, charge when not
    s.waitT = 0.1; let approachD = null, stalkT = 0, chargeWhileWatched = false;
    const ang = Math.atan2(-(s.position.x - p.position.x), -(s.position.z - p.position.z)); r.setLook(ang, -0.05); p.update(0); ctx.camera.updateMatrixWorld(true);
    for (let i = 0; i < 600; i++) { ctx.enemies.update(1 / 30); if (s.state === 'circle' && s.target && s.distanceToPlayer() <= 15.5) { stalkT += 1 / 30; approachD = +s.distanceToPlayer().toFixed(1); } if (s.state === 'charge') { chargeWhileWatched = s.observedByPlayer(40); break; } }
    return { watched, chargeAt, lungeAt, hitAt, retreatAt, trace, after, circle: { state: s.state, approachD, stalkT: +stalkT.toFixed(1), chargeWhileWatched, d: +s.distanceToPlayer().toFixed(1) } };
  })()`);
  console.log('behaviour', JSON.stringify(beh));
  // death, up close at noon
  await api.run(`(() => { window.__radius.god(); })()`);
  await api.run(place(4, 'charge'));
  await api.run(`window.__radius.setLook(0.2, -0.2)`);
  await api.run(`(() => { window.__s.damage(200, { kind: 'bullet' }); })()`);
  await api.frames(3);
  await api.screenshot('slider-death-crumple');
  await api.frames(6);
  await api.screenshot('slider-death-dissolve');
  await api.frames(6);
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { enemies: s.enemies, calls: s.calls, missing: s.missingSounds, error: s.error }; })()`);
  console.log('final', JSON.stringify(fin));
}
