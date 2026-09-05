// A mimic 40 m behind the player, investigating a noise: it should skip closer while unobserved.
import { boot, frames, spawnRel, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.0, 0); r.setTime(12); })()`);
  await api.run(`(() => { const r = window.__radius; const m = window.__m = ${spawnRel('mimic', -40)}; window.__skips = 0;
    const os = m.sound.bind(m); m.sound = (n, o) => { if (n === 'mimic_skip') window.__skips++; return os(n, o); };
    const p = r.ctx.player; m.aware = 0.6; m.lastSeenPlayer = p.position.clone(); m.lastSeenT = r.ctx.elapsed; window.__d0 = m.distanceToPlayer(); })()`);
  // simulate 30 s in 0.05 s steps, sampling every second
  for (let i = 0; i < 30; i++) {
    const s = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, m = window.__m; for (let k = 0; k < 20; k++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); }
      return { t: +ctx.elapsed.toFixed(1), d: +m.distanceToPlayer().toFixed(1), state: m.state, aware: +m.aware.toFixed(2), skips: window.__skips, obs: m.observedByPlayer(), unobs: +m.unobservedT.toFixed(1) }; })()`);
    console.log(JSON.stringify(s));
    if (s.skips >= 2 || s.d < 10) break;
  }
  await api.run(`(() => { window.__radius.setLook(Math.PI, 0); })()`);
  await frames(api, 3);
  await shot(api, 'skip-turned-around');
}
