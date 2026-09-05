// Review pass 2: the seeker's searchlight (cone render, seeker_spot when the beam finds you, MG), its death,
// then the mimic skip while unobserved.
import { boot, frames, spawnRel, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await api.run(`(() => { const ctx = window.__radius.ctx; window.__snd = {}; const op = ctx.audio.play; ctx.audio.play = (n, o) => { window.__snd[n] = (window.__snd[n] || 0) + 1; return op(n, o); }; })()`);
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(22.5); })()`);
  await api.run(`window.__s = ${spawnRel('seeker', 22, 0, '{ yaw: 0 }')}; window.__s.yaw = window.__radius.ctx.player.yaw + Math.PI + 0.9;`);
  const step = (n) => api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); ctx.post.update(0.05, ctx.elapsed); } const s = window.__s; return { aware: +s.aware.toFixed(2), state: s.state, inBeam: s.inBeam, hp: ctx.player.hp, light: +s.light.intensity.toFixed(1), lightVisible: s.light.visible, d: +s.distanceToPlayer().toFixed(1), director: ctx.director.state, snd: window.__snd }; })()`);
  await frames(api, 2);
  await shot(api, 'seeker-night-22m');
  console.log('sweep-2s', JSON.stringify(await step(40)));
  await frames(api, 2);
  await shot(api, 'seeker-night-sweep');
  console.log('later-8s', JSON.stringify(await step(160)));
  await frames(api, 2);
  await shot(api, 'seeker-night-found');
  await api.run(`(() => { const r = window.__radius; r.setTime(12); const s = window.__s, p = r.ctx.player; s.position.set(p.position.x + p.forward.x * 7 + 0.8, 0, p.position.z + p.forward.z * 7); s.followGround(0); s.staggerT = 99; r.setLook(0.2, 0.25); })()`);
  await frames(api, 2);
  await shot(api, 'seeker-day-close');
  await api.run(`(() => { window.__s.damage(5000, { kind: 'blast' }); })()`);
  console.log('collapse', JSON.stringify(await step(14)));
  await frames(api, 2);
  await shot(api, 'seeker-collapse');
  console.log('dissolve', JSON.stringify(await step(40)));
  await frames(api, 2);
  await shot(api, 'seeker-dissolve');
  console.log('after', JSON.stringify(await api.run(`(() => { const r = window.__radius; return { enemies: r.ctx.enemies.list.length, calls: r.stats().calls, missing: [...r.ctx.audio.missing] }; })()`)));
  // ---- skip: a mimic 40 m behind, investigating, while we look away ----
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.0, 0); r.setTime(12); window.__snd = {};
    const m = window.__m = ${spawnRel('mimic', -40)}; const p = r.ctx.player; m.aware = 0.6; m.lastSeenPlayer = p.position.clone(); m.lastSeenT = r.ctx.elapsed; })()`);
  for (let i = 0; i < 24; i++) {
    const s = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, m = window.__m; for (let k = 0; k < 20; k++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); }
      return { t: ${i + 1}, d: +m.distanceToPlayer().toFixed(1), state: m.state, aware: +m.aware.toFixed(2), skips: window.__snd.mimic_skip || 0, obs: m.observedByPlayer(), unobs: +m.unobservedT.toFixed(1) }; })()`);
    console.log('skip', JSON.stringify(s));
    if (s.skips >= 2 || s.d < 10) break;
  }
  await fireCheck(api);
}
export async function fireCheck(api) {
  // a mimic 15 m ahead in the open at noon, from a fresh watch-first spawn: time to contact, hits, whiz, tracers
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(12); r.ctx.state.data.hp = 100; r.ctx.state.data.bleeding = false; window.__snd = {}; window.__tracers = 0; const ot = r.ctx.vfx.tracer; r.ctx.vfx.tracer = (a, b, w) => { window.__tracers++; return ot(a, b, w); }; })()`);
  await api.run(`window.__m = ${spawnRel('mimic', 15)}`);
  for (let i = 0; i < 8; i++) {
    const s = await api.run(`(() => { const ctx = window.__radius.ctx, m = window.__m; for (let k = 0; k < 20; k++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); }
      return { t: ${i + 1}, aware: +m.aware.toFixed(2), st: m.state, hp: +ctx.player.hp.toFixed(0), d: +m.distanceToPlayer().toFixed(1), shots: window.__snd.mimic_shot || 0, hits: window.__snd.hurt_bullet || 0, whiz: window.__snd.bullet_whiz || 0, tracers: window.__tracers, director: ctx.director.state }; })()`);
    console.log('fire', JSON.stringify(s));
  }
}
