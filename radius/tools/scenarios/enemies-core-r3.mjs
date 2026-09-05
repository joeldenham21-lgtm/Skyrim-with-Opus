// Review pass 3: the seeker's beam, fairly staged. Side view of the cone volume at night, then the sweep crossing
// the player: inBeam, seeker_spot, the glare, the MG.
import { boot, frames, spawnRel, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await api.run(`(() => { const ctx = window.__radius.ctx; window.__snd = {}; const op = ctx.audio.play; ctx.audio.play = (n, o) => { window.__snd[n] = (window.__snd[n] || 0) + 1; return op(n, o); }; window.__flash = 0; const of = ctx.post.flash; ctx.post.flash = (v) => { window.__flash = Math.max(window.__flash, v); return of(v); }; })()`);
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(22.5); })()`);
  // side view: beam pointing across the view, seeker frozen in place
  await api.run(`window.__s = ${spawnRel('seeker', 16, 0)}; (() => { const s = window.__s; s.yaw += Math.PI / 2; s.staggerT = 99; s.setState('watch'); s.waitT = 99; s.sweepT = 0; })()`);
  await api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < 4; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); } })()`);
  await frames(api, 2);
  await shot(api, 'seeker-beam-side');
  // now facing us, 20 deg off, head sweeping: the beam must cross us within a few seconds
  await api.run(`(() => { const s = window.__s; s.yaw -= Math.PI / 2 + 0.35; s.sweepT = 0; s.staggerT = 0; s.waitT = 99; })()`);
  const step = (n) => api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); ctx.post.update(0.05, ctx.elapsed); } const s = window.__s; return { aware: +s.aware.toFixed(2), state: s.state, inBeam: s.inBeam, hold: +s.beamHold.toFixed(2), flash: +window.__flash.toFixed(2), hp: ctx.player.hp, d: +s.distanceToPlayer().toFixed(1), director: ctx.director.state, snd: window.__snd }; })()`);
  let found = false;
  for (let i = 0; i < 16; i++) {
    const s = await step(10);
    console.log('beam', i, JSON.stringify(s));
    if (s.inBeam && !found) { found = true; await frames(api, 2); await shot(api, 'seeker-beam-on-us'); }
    if (s.aware >= 1) break;
  }
  console.log('engaged-4s', JSON.stringify(await step(80)));
  await frames(api, 2);
  await shot(api, 'seeker-engaged');
  console.log('after', JSON.stringify(await api.run(`(() => { const r = window.__radius; return { calls: r.stats().calls, missing: [...r.ctx.audio.missing] }; })()`)));
}
