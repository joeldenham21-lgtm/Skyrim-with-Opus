// Review pass 4: the searchlight up close (is the SpotLight lighting anything, is the lens visible), then the
// tuned fire rates of both shooters at 15 m.
import { boot, frames, spawnRel, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await api.run(`(() => { const ctx = window.__radius.ctx; window.__snd = {}; const op = ctx.audio.play; ctx.audio.play = (n, o) => { window.__snd[n] = (window.__snd[n] || 0) + 1; return op(n, o); }; window.__tracers = 0; const ot = ctx.vfx.tracer; ctx.vfx.tracer = (a, b, w) => { window.__tracers++; return ot(a, b, w); }; })()`);
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, 0.12); r.setTime(22.5); })()`);
  await api.run(`window.__s = ${spawnRel('seeker', 7, 0)}; (() => { const s = window.__s; s.sweep = () => 0; s.staggerT = 99; s.setState('watch'); s.waitT = 99; })()`);
  await api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < 6; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); } ctx.scene.updateMatrixWorld(true); })()`);
  console.log('light', JSON.stringify(await api.run(`(() => { const ctx = window.__radius.ctx, s = window.__s, T = ctx.THREE; const lp = new T.Vector3().setFromMatrixPosition(s.light.matrixWorld), tp = new T.Vector3().setFromMatrixPosition(s.light.target.matrixWorld); const dir = tp.clone().sub(lp).normalize(); let spots = 0, vis = 0; ctx.scene.traverse((o) => { if (o.isSpotLight) { spots++; if (o.visible && o.intensity > 0) vis++; } });
    const toP = ctx.player.eye.clone().sub(lp).normalize(); return { intensity: +s.light.intensity.toFixed(1), visible: s.light.visible, pos: lp.toArray().map((v) => +v.toFixed(2)), dir: dir.toArray().map((v) => +v.toFixed(2)), toPlayerDot: +dir.dot(toP).toFixed(2), inBeam: s.inBeam, spotsInScene: spots, litSpots: vis, coneVisible: s.cone.visible, coneI: +s.cone.material.uniforms.uIntensity.value.toFixed(2), lensColor: s.lensMat.color.toArray().map((v) => +v.toFixed(1)) }; })()`)));
  await frames(api, 2);
  await shot(api, 'seeker-7m-night-lamp');
  await api.run(`(() => { window.__radius.setTime(12); })()`);
  await frames(api, 2);
  await shot(api, 'seeker-7m-day-lens');
  // ---- fire rates at 15 m, standing target, 8 s each ----
  const fire = (who) => api.run(`(() => { const ctx = window.__radius.ctx, e = window.__e; for (let k = 0; k < 20; k++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); ctx.vfx.update(0.05, ctx.elapsed); }
    return { aware: +e.aware.toFixed(2), st: e.state, hp: +ctx.player.hp.toFixed(0), d: +e.distanceToPlayer().toFixed(1), shots: window.__snd['${who}_shot'] || 0, hits: window.__snd.hurt_bullet || 0, whiz: window.__snd.bullet_whiz || 0, tracers: window.__tracers }; })()`);
  for (const who of ['mimic', 'seeker']) {
    await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(12); r.ctx.state.data.hp = 100; r.ctx.state.data.bleeding = false; window.__snd = {}; window.__tracers = 0; })()`);
    await api.run(`window.__e = ${spawnRel(who, 15)}`);
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(await fire(who));
    console.log(who, JSON.stringify(rows.map((r) => [r.st, r.hp, r.shots, r.hits, r.whiz])));
  }
  console.log('after', JSON.stringify(await api.run(`(() => { const r = window.__radius; return { calls: r.stats().calls, missing: [...r.ctx.audio.missing] }; })()`)));
}
