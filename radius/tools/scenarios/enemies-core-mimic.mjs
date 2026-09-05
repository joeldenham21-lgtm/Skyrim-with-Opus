// Mimic in the open, 14 m ahead, at noon and at night: awareness, firing, looks, skip-free death.
import { boot, frames, spawnRel, fpsProbe, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, -0.02); r.setTime(12); window.__shots = 0; const mf = r.ctx.vfx.muzzleFlash; r.ctx.vfx.muzzleFlash = (p, d) => { window.__shots++; return mf(p, d); }; })()`);
  await api.run(`window.__m = ${spawnRel('mimic', 14)}`);
  console.log('render ms', await api.run(fpsProbe));
  await frames(api, 3);
  await shot(api, 'mimic-noon-14m');
  const s0 = await api.run(`(() => { const r = window.__radius, m = window.__m; return { aware: +m.aware.toFixed(2), state: m.state, hp: r.ctx.player.hp, d: +m.distanceToPlayer().toFixed(1), frame: r.ctx.frame }; })()`);
  console.log('t0', JSON.stringify(s0));
  // ~6 s of simulated time: dt is capped at 0.05 per frame so drive it with explicit updates as well as real frames
  await api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < 120; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); } })()`);
  const s1 = await api.run(`(() => { const r = window.__radius, m = window.__m; return { aware: +m.aware.toFixed(2), state: m.state, engaged: m.engaged, hp: r.ctx.player.hp, shots: window.__shots, director: r.ctx.director.state, d: +m.distanceToPlayer().toFixed(1), pos: m.position.toArray().map((v) => +v.toFixed(1)) }; })()`);
  console.log('t6', JSON.stringify(s1));
  await frames(api, 2);
  await shot(api, 'mimic-noon-engaged');
  await api.run(`(() => { const r = window.__radius, m = window.__m; const p = r.ctx.player; m.position.set(p.position.x + p.forward.x * 4 + 0.6, 0, p.position.z + p.forward.z * 4); m.followGround(0); })()`);
  await frames(api, 3);
  await shot(api, 'mimic-noon-close');
  await api.run(`(() => { const r = window.__radius, m = window.__m; r.setTime(22.5); const p = r.ctx.player; m.position.set(p.position.x + p.forward.x * 14, 0, p.position.z + p.forward.z * 14); m.followGround(0); })()`);
  await frames(api, 4);
  await shot(api, 'mimic-night-14m');
  await api.run(`(() => { window.__radius.ctx.state.data.flashlight.on = true; })()`);
  await frames(api, 3);
  await shot(api, 'mimic-night-torch');
  await api.run(`(() => { const m = window.__m; m.damage(200, { kind: 'bullet' }); const ctx = window.__radius.ctx; for (let i = 0; i < 8; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); } })()`);
  await frames(api, 2);
  await shot(api, 'mimic-death-fold');
  await api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < 14; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); } })()`);
  await frames(api, 2);
  await shot(api, 'mimic-death-dissolve');
  await api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < 30; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); } })()`);
  const s2 = await api.run(`(() => { const r = window.__radius; return { enemies: r.ctx.enemies.list.length, calls: r.stats().calls }; })()`);
  console.log('after death', JSON.stringify(s2));
}
