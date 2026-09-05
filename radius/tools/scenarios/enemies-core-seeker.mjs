// Seeker at 25 m, night: the searchlight sweeping, then finding the player; the lens; the collapse.
import { boot, frames, spawnRel, fpsProbe, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(22.5); window.__shots = 0; const mf = r.ctx.vfx.muzzleFlash; r.ctx.vfx.muzzleFlash = (a, b) => { window.__shots++; return mf(a, b); }; })()`);
  await api.run(`window.__s = ${spawnRel('seeker', 25, 0, '{ yaw: 0 }')}; window.__s.yaw = window.__radius.ctx.player.yaw + Math.PI + 0.9;`);
  console.log('render ms', await api.run(fpsProbe));
  await frames(api, 3);
  await shot(api, 'seeker-night-25m');
  const step = (n) => api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); ctx.post.update(0.05, ctx.elapsed); } const s = window.__s; return { aware: +s.aware.toFixed(2), state: s.state, inBeam: s.inBeam, hp: ctx.player.hp, shots: window.__shots, light: +s.light.intensity.toFixed(1), d: +s.distanceToPlayer().toFixed(1), director: ctx.director.state }; })()`);
  console.log('sweep 2s', JSON.stringify(await step(40)));
  await frames(api, 2);
  await shot(api, 'seeker-night-sweep');
  console.log('later 8s', JSON.stringify(await step(160)));
  await frames(api, 2);
  await shot(api, 'seeker-night-engaged');
  await api.run(`(() => { const r = window.__radius; r.setTime(12); const s = window.__s; const p = r.ctx.player; s.position.set(p.position.x + p.forward.x * 7 + 0.8, 0, p.position.z + p.forward.z * 7); s.followGround(0); })()`);
  await frames(api, 3);
  await shot(api, 'seeker-day-close');
  await api.run(`(() => { const s = window.__s; s.damage(5000, { kind: 'blast' }); })()`);
  await step(14);
  await frames(api, 2);
  await shot(api, 'seeker-collapse');
  await step(36);
  await frames(api, 2);
  await shot(api, 'seeker-dissolve');
  await fireDiag(api);
}
// firing-rhythm diagnostics for the mimic: 12 s in the open at 15 m, sampled every second
export async function fireDiag(api) {
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(12); window.__shots = 0; })()`);
  await api.run(`window.__m = ${spawnRel('mimic', 15)}`);
  for (let i = 0; i < 12; i++) {
    const s = await api.run(`(() => { const ctx = window.__radius.ctx, m = window.__m; let los = 0, losFail = 0; const orig = ctx.world.lineOfSight; ctx.world.lineOfSight = (a, b) => { const v = orig(a, b); if (a.y > m.position.y + 1.2 && a.y < m.position.y + 1.8) { los++; if (!v) losFail++; } return v; };
      for (let k = 0; k < 20; k++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); }
      ctx.world.lineOfSight = orig; const v = new ctx.THREE.Vector3(); m.syncRoot(); m.rig.muzzleWorld(v); v.sub(m.position);
      return { t: ${i}, aware: +m.aware.toFixed(2), st: m.state, burst: m.burstLeft, cd: +m.cooldown.toFixed(2), shots: window.__shots, hp: ctx.player.hp, d: +m.distanceToPlayer().toFixed(1), mv: +m.moveSpeed.toFixed(1), muzzle: v.toArray().map((x) => +x.toFixed(2)), los, losFail, tgt: !!m.target }; })()`.replace('${i}', String(i)));
    console.log('fire', JSON.stringify(s));
  }
}
