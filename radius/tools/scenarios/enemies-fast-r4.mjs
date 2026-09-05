// Fragment close-up (the glass at 0.7 m, noon and night with the torch) and the pop-wash diagnostic: pop a
// fragment at 6 m with no time change and screenshot 1 and 6 frames later with the post state.
const ONE = (dist, dy) => `(() => { const r = window.__radius; const p = r.ctx.player; p.update(0); r.ctx.enemies.removeAll();
  const e = r.spawn('fragment', p.position.x + p.forward.x * ${dist}, p.position.z + p.forward.z * ${dist}); e.losT = 1e9; e.los = false;
  e.position.set(p.position.x + p.forward.x * ${dist}, p.eye.y + ${dy}, p.position.z + p.forward.z * ${dist}); e.home.set(e.position.x, r.ctx.world.getHeight(e.position.x, e.position.z), e.position.z);
  e.ax = 0.02; e.az = 0.02; e.orbitT = 0; e.p1 = 0; e.p2 = 0; e.p3 = 0.3; window.__e = e; })()`;
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(12); r.god(); })()`);
  await api.frames(3);
  await api.run(ONE(0.75, -0.05));
  await api.frames(4);
  await api.screenshot('fragment-glass-noon-close');
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(6);
  await api.screenshot('fragment-glass-night-torch');
  // pop wash diagnostic at noon, after the lighting has had frames to settle
  await api.run(`(() => { const r = window.__radius; r.setTime(12); r.ctx.state.data.flashlight.on = false; })()`);
  await api.frames(6);
  await api.run(ONE(6, -0.2));
  await api.frames(2);
  await api.run(`(() => { const e = window.__e; e.damage(10, { kind: 'bullet', point: e.position.clone() }); })()`);
  await api.frames(1);
  const st1 = await api.run(`(() => { const st = window.__radius.ctx.post.st; return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, +(+v).toFixed(2)])); })()`);
  console.log('post after pop +1', JSON.stringify(st1));
  await api.screenshot('fragment-pop-plus1');
  await api.frames(5);
  await api.screenshot('fragment-pop-plus6');
  await bites(page, api);
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { enemies: s.enemies, calls: s.calls, missing: s.missingSounds, error: s.error }; })()`);
  console.log('final', JSON.stringify(fin));
}
// appended: spawn bite cadence sim (no rendering) and a curl-and-crumble look
export async function bites(page, api) {
  const beh = await api.run(`(() => { const r = window.__radius, ctx = r.ctx; r.god(false); ctx.state.data.hp = 100; ctx.state.data.bleeding = false; r.setLook(0.2, -0.1); const p = ctx.player; p.update(0); ctx.enemies.removeAll();
    const T = ctx.THREE; const c = new T.Vector3(p.position.x + p.forward.x * 6, 0, p.position.z + p.forward.z * 6); const pack = [];
    for (let i = 0; i < 5; i++) { const e = r.spawn('spawn', c.x + (i - 2) * 0.8 * p.forward.z, c.z - (i - 2) * 0.8 * p.forward.x, { pack: c }); pack.push(e); }
    let last = 100; const hits = []; let rearSeen = 0;
    for (let i = 0; i < 360; i++) { ctx.enemies.update(1 / 30); for (const e of pack) if (e.biteWind > 0) rearSeen++; const hp = ctx.state.data.hp; if (hp < last) { hits.push([i, last - hp]); last = hp; } if (hits.length >= 8) break; }
    return { hits, hp: ctx.state.data.hp, rearSteps: rearSeen, states: pack.map((e) => e.state) };
  })()`);
  console.log('bites', JSON.stringify(beh));
  await api.run(`(() => { const r = window.__radius; r.god(); r.setLook(0.2, -0.4); r.ctx.enemies.removeAll(); const p = r.ctx.player; p.update(0);
    window.__d = r.spawn('spawn', p.position.x + p.forward.x * 2.2, p.position.z + p.forward.z * 2.2, { yaw: p.yaw + 2.2 }); window.__d.playerVisibility = () => 0; })()`);
  await api.frames(2);
  await api.run(`window.__d.damage(100, { kind: 'bullet' })`);
  await api.frames(6);
  await api.screenshot('spawn-crumble');
}
