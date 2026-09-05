// Review pass 5: the brightened beam at night from the side and head-on at 14 m, and the mimic fold from the side.
import { boot, frames, spawnRel, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(22.5); })()`);
  await api.run(`window.__s = ${spawnRel('seeker', 14, 0)}; (() => { const s = window.__s; s.sweep = () => 0; s.staggerT = 99; s.setState('watch'); s.waitT = 99; s.yaw += Math.PI / 2; })()`);
  const sim = (n) => api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); } const s = window.__s; return { inBeam: s.inBeam, aware: +s.aware.toFixed(2), state: s.state }; })()`);
  console.log('side', JSON.stringify(await sim(4)));
  await frames(api, 2);
  await shot(api, 'beam-side-night');
  await api.run(`(() => { const s = window.__s; s.yaw -= Math.PI / 2; })()`);
  console.log('front', JSON.stringify(await sim(6)));
  await frames(api, 2);
  await shot(api, 'beam-on-us-night');
  // mimic fold seen from the side, by day
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.setTime(12); r.setLook(0.2, 0.05); })()`);
  await api.run(`window.__m = ${spawnRel('mimic', 4.5, 0.3, '{ idle: true }')}; (() => { const m = window.__m; m.yaw += Math.PI / 2; })()`);
  await api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < 4; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); } window.__m.damage(200, { kind: 'bullet' }); for (let i = 0; i < 9; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); } })()`);
  await frames(api, 2);
  await shot(api, 'mimic-fold-side');
  console.log('after', JSON.stringify(await api.run(`(() => { const r = window.__radius; return { calls: r.stats().calls, missing: [...r.ctx.audio.missing], enemies: r.ctx.enemies.list.length }; })()`)));
}
