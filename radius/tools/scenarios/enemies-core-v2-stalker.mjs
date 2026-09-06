// The stalker: spawned 80 m behind, it stays behind the player over 60 s of simulated walking, never fires first,
// closes in at night; it engages when shot.
import { boot, frames, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx; r.teleport(-40, 150); r.setLook(0.0, 0.0); r.setTime(12); ctx.player.update(0);
    window.__shots = 0; const mf = ctx.vfx.muzzleFlash; ctx.vfx.muzzleFlash = (p, d) => { window.__shots++; return mf(p, d); };
    const p = ctx.player, f = p.forward; const e = r.spawn('mimic', p.position.x - f.x * 80, p.position.z - f.z * 80, { stalker: true, cls: 'veteran' }); e.root.traverse((o) => { o.userData.__enemy = true; }); window.__st = e; })()`);
  // walk forward: hold W through the sim
  const step = (n, dt = 0.1) => api.run(`(() => { const ctx = window.__radius.ctx; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); ctx.input.locked = true; ctx.input.softLook = true;
    for (let i = 0; i < ${n}; i++) { ctx.elapsed += ${dt}; ctx.player.update(${dt}); ctx.enemies.update(${dt}); ctx.population.update(${dt}); ctx.director.update(${dt}); ctx.vfx.update(${dt}, ctx.elapsed); }
    const p = ctx.player, e = window.__st, f = p.forward; const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z; const d = Math.hypot(dx, dz); const behind = (dx * f.x + dz * f.z) / d;
    return { t: +ctx.elapsed.toFixed(1), st: e.state, d: +d.toFixed(1), behindCos: +behind.toFixed(2), obs: e.observedByPlayer(45), aware: +e.aware.toFixed(2), shots: window.__shots, hp: +p.hp.toFixed(0), ppos: p.position.toArray().map((v) => +v.toFixed(0)), dir: ctx.director.state, alive: e.alive }; })()`);
  for (let i = 0; i < 6; i++) console.log('day', JSON.stringify(await step(100)));
  // turn around: it should be standing there, then gone when looked at again
  await api.run(`(() => { const r = window.__radius; window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); r.setLook(Math.PI, 0); })()`);
  await frames(api, 2);
  await shot(api, 'stalker-turned');
  console.log('turned', JSON.stringify(await step(30)));
  await api.run(`window.__radius.setLook(0, 0)`);
  // night: it closes to 25 m, and only engages after 20 s at that range
  await api.run(`window.__radius.setTime(23)`);
  for (let i = 0; i < 5; i++) console.log('night', JSON.stringify(await step(100)));
  // shot at: it engages
  await api.run(`(() => { const e = window.__st; e.damage(10, { kind: 'bullet', source: 'player' }); })()`);
  console.log('provoked', JSON.stringify(await step(60)));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
