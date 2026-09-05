// Review pass 1: the census at the gate and at the convoy (spawn distance / visibility / instant engagement),
// then a mimic in the open: firing, whiz, tracers, look at noon and at night with the torch, death.
import { boot, frames, spawnRel, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  // instrument spawns and sounds before the census is taken
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx; window.__spawns = []; window.__snd = {};
    const os = ctx.enemies.spawn; ctx.enemies.spawn = (type, pos, opts) => { const e = os(type, pos, opts); if (e) { const d = e.distanceToPlayer(); window.__spawns.push({ type, d: +d.toFixed(1), vis: e.observedByPlayer(60), poi: e.poi, t: +ctx.elapsed.toFixed(1) }); } return e; };
    const op = ctx.audio.play; ctx.audio.play = (n, o) => { window.__snd[n] = (window.__snd[n] || 0) + 1; return op(n, o); };
    window.__tracers = 0; const ot = ctx.vfx.tracer; ctx.vfx.tracer = (a, b, w) => { window.__tracers++; return ot(a, b, w); }; })()`);
  await boot(api, { noEnemies: false, lighten: 1 });
  const census = `(() => { const r = window.__radius, ctx = r.ctx; const p = ctx.player.position; let minD = 1e9, vis = 0, eng = 0; const list = [];
    for (const e of ctx.enemies.list) { if (!e.alive) continue; const d = e.position.distanceTo(p); if (d < minD) minD = d; if (e.observedByPlayer(60)) vis++; if (e.aware >= 1) eng++; list.push([e.type, e.poi, +d.toFixed(0), +e.aware.toFixed(2), e.state]); }
    return { total: ctx.population.count, planned: ctx.population.planned, minD: +minD.toFixed(1), visible: vis, engaged: eng, director: ctx.director.state, hp: ctx.player.hp, list, spawns: window.__spawns, badSpawns: window.__spawns.filter((s) => s.d < 35 || s.vis) }; })()`;
  const sim = (n) => api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += 0.05; ctx.player.update(0.05); ctx.enemies.update(0.05); ctx.population.update(0.05); ctx.director.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); } })()`);
  console.log('gate-t0', JSON.stringify(await api.run(census)));
  await sim(100);
  console.log('gate-t5', JSON.stringify(await api.run(census)));
  await shot(api, 'gate-start');
  // the soak case: teleport next to the convoy right after start
  await api.run(`(() => { const r = window.__radius; r.teleport(48, 160); r.setLook(0.4, -0.02); window.__spawns.length = 0; })()`);
  await sim(20);
  console.log('convoy-t1', JSON.stringify(await api.run(census)));
  await sim(100);
  console.log('convoy-t6', JSON.stringify(await api.run(census)));
  await shot(api, 'convoy');
  // ---- a single mimic in the open ----
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx; ctx.enemies.removeAll(); ctx.debug.noEnemies = true; ctx.director.rest(); r.teleport(30, 130); r.setLook(0.2, -0.02); r.setTime(12); window.__snd = {}; window.__tracers = 0; })()`);
  await api.run(`window.__m = ${spawnRel('mimic', 15)}`);
  const mstat = `(() => { const r = window.__radius, m = window.__m, ctx = r.ctx; return { aware: +m.aware.toFixed(2), state: m.state, engaged: m.engaged, hp: ctx.player.hp, d: +m.distanceToPlayer().toFixed(1), director: ctx.director.state, snd: window.__snd, tracers: window.__tracers, calls: r.stats().calls }; })()`;
  await sim(120);
  console.log('mimic-6s', JSON.stringify(await api.run(mstat)));
  await frames(api, 2);
  await shot(api, 'mimic-noon-engaged');
  // close look, noon: freeze it 3.5 m away facing us
  await api.run(`(() => { const r = window.__radius, m = window.__m, p = r.ctx.player; m.position.set(p.position.x + p.forward.x * 3.5 + 0.4, 0, p.position.z + p.forward.z * 3.5); m.followGround(0); m.yaw = Math.atan2(-(p.position.x - m.position.x), -(p.position.z - m.position.z)); m.staggerT = 99; m.burstLeft = 0; m.cooldown = 99; r.setLook(0.2, 0.08); })()`);
  await frames(api, 2);
  await shot(api, 'mimic-noon-close');
  await api.run(`(() => { const r = window.__radius, m = window.__m, p = r.ctx.player; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; m.position.set(p.position.x + p.forward.x * 6 + 0.5, 0, p.position.z + p.forward.z * 6); m.followGround(0); r.setLook(0.2, 0.02); })()`);
  await frames(api, 3);
  await shot(api, 'mimic-night-torch');
  // death: fold, ash, dissolve, removal
  await api.run(`(() => { window.__m.damage(200, { kind: 'bullet' }); })()`);
  await sim(8);
  await frames(api, 2);
  await shot(api, 'mimic-death-fold');
  await sim(16);
  await frames(api, 2);
  await shot(api, 'mimic-death-dissolve');
  await sim(30);
  console.log('after-death', JSON.stringify(await api.run(`(() => { const r = window.__radius; return { enemies: r.ctx.enemies.list.length, calls: r.stats().calls, snd: window.__snd, missing: [...r.ctx.audio.missing] }; })()`)));
}
