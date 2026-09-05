// Fragment review: close look at noon and at night with the torch, draw-call cost of the glass, then the
// attraction / contact / shock / pop behaviour stepped through enemies.update() without rendering.
const SPAWN = `(() => { const r = window.__radius; const p = r.ctx.player; p.update(0); const f = p.forward;
  window.__f = [0, 1, 2].map((i) => { const e = r.spawn('fragment', p.position.x + f.x * (5.5 + i * 0.6) + (i - 1) * 1.5 * f.z, p.position.z + f.z * (5.5 + i * 0.6) - (i - 1) * 1.5 * f.x); e.losT = 1e9; e.los = false; e.position.y = p.position.y + 1.45 + (i - 1) * 0.25; e.home.set(e.position.x, r.ctx.world.getHeight(e.position.x, e.position.z), e.position.z); e.ax = 0.05; e.az = 0.05; e.orbitT = 0; e.p1 = 0; e.p2 = 0; e.p3 = -Math.PI / 2; return e; }); })()`;
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.02); r.setTime(12); r.god(); })()`);
  await api.frames(2);
  const c0 = await api.run(`window.__radius.stats().calls`);
  await api.run(SPAWN);
  await api.frames(5);
  await api.screenshot('fragment-noon-close');
  const c1 = await api.run(`window.__radius.stats().calls`);
  console.log('calls without/with fragments', c0, c1);
  // one at arm's length: the glass itself
  await api.run(`(() => { const r = window.__radius; const p = r.ctx.player; const e = window.__f[1]; e.position.set(p.position.x + p.forward.x * 1.7, p.eye.y - 0.12, p.position.z + p.forward.z * 1.7); e.home.set(e.position.x, r.ctx.world.getHeight(e.position.x, e.position.z), e.position.z); e.orbitT = 0; e.p3 = 0.28; })()`);
  await api.frames(3);
  await api.screenshot('fragment-noon-2m');
  // night with the torch
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(5);
  await api.screenshot('fragment-night-torch');
  // behaviour: one fragment is let loose from 14 m; god off; step the sim
  const beh = await api.run(`(() => { const r = window.__radius, ctx = r.ctx; r.god(false); const p = ctx.player; p.update(0); const f = p.forward;
    ctx.enemies.removeAll();
    const e = r.spawn('fragment', p.position.x + f.x * 14, p.position.z + f.z * 14);
    const rates = []; let chimeSeen = false;
    const log = []; let shockPeak = 0, approachAt = -1;
    for (let i = 0; i < 600 && e.alive; i++) {
      ctx.enemies.update(1 / 30); ctx.post.update?.(1 / 30);
      if (e.chime && !chimeSeen) { chimeSeen = true; const os = e.chime.set.bind(e.chime); e.chime.set = (k, v) => { if (k === 'rate') rates.push(+v.toFixed(2)); os(k, v); }; }
      shockPeak = Math.max(shockPeak, ctx.post.st?.shock || 0);
      if (e.state === 'attracted' && approachAt < 0) approachAt = i;
      if (i % 60 === 0) log.push({ i, state: e.state, d: +e.distanceToPlayer().toFixed(1), v: +e.vel.length().toFixed(1), period: +e.period.toFixed(2) });
    }
    return { log, alive: e.alive, exploded: e.exploded, hp: ctx.state.data.hp, shockPeak: +shockPeak.toFixed(2), approachAt, chime: chimeSeen, rateMin: rates.length ? Math.min(...rates) : null, rateMax: rates.length ? Math.max(...rates) : null, director: ctx.director.state, audioReady: ctx.audio.ready };
  })()`);
  console.log('behaviour', JSON.stringify(beh));
  // pop: a fresh one 3 m ahead at noon, shot
  await api.run(`(() => { const r = window.__radius; r.god(); r.setTime(12); r.ctx.state.data.flashlight.on = false; r.ctx.enemies.removeAll(); })()`);
  await api.run(SPAWN);
  await api.run(`(() => { const e = window.__f[1]; e.damage(10, { kind: 'bullet', point: e.position.clone() }); })()`);
  await api.frames(2);
  await api.screenshot('fragment-pop');
  await api.frames(4);
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { enemies: s.enemies, alive: r.ctx.enemies.count('fragment'), calls: s.calls, missing: s.missingSounds, error: s.error }; })()`);
  console.log('final', JSON.stringify(fin));
}
