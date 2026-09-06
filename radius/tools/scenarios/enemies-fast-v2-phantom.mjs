// Phantom: the look at 10 m without and with night vision (screenshots), then a stepped hunt: circling out
// of the direct view, the scream at eight metres, the rush and the grab (hp drop, velocity impulse, drag,
// screen distortion), the vanish, and the death shatter.
import { boot, frames, shot } from './enemies-core-lib.mjs';
const STEP = `(n) => { const ctx = window.__radius.ctx; for (let k = 0; k < n; k++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); } }`;
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  const t0 = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.0); r.setTime(12); r.god(); window.__step = ${STEP};
    p.update(0); const f = p.forward; const e = window.__ph = r.spawn('phantom', p.position.x + f.x * 10, p.position.z + f.z * 10, { yaw: p.yaw + Math.PI }); e.root.traverse((o) => { o.userData.__enemy = true; });
    e.perceive = () => {};   // hold it still for the look
    return { st: e.state, hp: e.hp, mat: e.rig.mesh.material.type, transmission: e.rig.mesh.material.transmission, rim: e.rim.visible, d: +e.distanceToPlayer().toFixed(1) }; })()`);
  console.log('look', JSON.stringify(t0));
  await frames(api, 3);
  await shot(api, 'phantom-10m-noon');
  await api.run(`(() => { const r = window.__radius; r.ctx.debug.nvgOn = true; r.ctx.post.setNvg(1); })()`);
  await frames(api, 3);
  const nv = await api.run(`(() => { const e = window.__ph; return { mat: e.rig.mesh.material.type, rim: e.rim.visible, nvg: e.nvg }; })()`);
  console.log('nvg', JSON.stringify(nv));
  await shot(api, 'phantom-10m-nvg');
  await api.run(`(() => { const r = window.__radius; r.ctx.debug.nvgOn = false; r.ctx.post.setNvg(0); r.setTime(21.5); })()`);
  await frames(api, 3);
  await shot(api, 'phantom-10m-dusk');
  // ---- the hunt, stepped: 25 m out, engaged ----
  const h0 = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; r.setTime(12); ctx.enemies.removeAll(); r.setLook(0.2, 0); p.update(0); const f = p.forward;
    const e = window.__ph = r.spawn('phantom', p.position.x + f.x * 22 + f.z * 8, p.position.z + f.z * 22 - f.x * 8, { yaw: p.yaw + Math.PI }); e.root.traverse((o) => { o.userData.__enemy = true; });
    e.aware = 1; e.engaged = true; e.setState('circle'); e.circleT = 9; window.__snd = {}; const os = e.sound.bind(e); e.sound = (n, o) => { window.__snd[n] = (window.__snd[n] || 0) + 1; return os(n, o); };
    return { st: e.state, d: +e.distanceToPlayer().toFixed(1) }; })()`);
  console.log('hunt start', JSON.stringify(h0));
  const off = `(() => { const p = window.__radius.ctx.player, e = window.__ph; const b = Math.atan2(e.position.z - p.position.z, e.position.x - p.position.x), v = Math.atan2(p.forward.z, p.forward.x); let d = b - v; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return +(d * 180 / Math.PI).toFixed(0); })()`;
  let circleSamples = 0, inViewSamples = 0, minR = 1e9, maxR = 0, screamed = false, grabbed = false, impulse = 0, hpAfter = 100, vanished = false, distort = 0, dragged = 0;
  for (let i = 0; i < 60; i++) {
    const s = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, e = window.__ph; if (${i} === 12) r.god(false);
      const p0 = p.position.clone(); let vmax = 0, hpMin = 1e9, grabT = -1, dmax = 0;
      for (let k = 0; k < 10; k++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); const v = Math.hypot(p.velocity.x, p.velocity.z); if (v > vmax) vmax = v; if (e.state === 'grab') grabT = k; ctx.director.update(0.05); ctx.player.update(0.05); const u = ctx.post.uniforms.uDistort.value; if (u > dmax) dmax = u; }
      return { t: +ctx.elapsed.toFixed(1), st: e.state, d: +e.distanceToPlayer().toFixed(1), off: ${off}, hp: ctx.player.hp, vmax: +vmax.toFixed(1), moved: +p0.distanceTo(p.position).toFixed(2), snd: window.__snd, dmax: +dmax.toFixed(2), shown: e.rig.mesh.visible, reveal: +e.reveal.toFixed(2) }; })()`);
    console.log(JSON.stringify(s));
    if (s.st === 'circle') { circleSamples++; if (Math.abs(s.off) < 40) inViewSamples++; minR = Math.min(minR, s.d); maxR = Math.max(maxR, s.d); }
    if (s.st === 'scream') screamed = true;
    if (s.vmax > 3) impulse = Math.max(impulse, s.vmax);
    if (s.hp < 100) { grabbed = true; hpAfter = s.hp; dragged = Math.max(dragged, s.moved); }
    distort = Math.max(distort, s.dmax);
    if (grabbed && s.st === 'circle') { vanished = true; break; }
  }
  console.log('hunt result', JSON.stringify({ circleSamples, inViewSamples, minR: +minR.toFixed(1), maxR: +maxR.toFixed(1), screamed, grabbed, hpAfter, impulse, dragged, distort, vanished }));
  // ---- death: shatter and a scream ----
  const dead = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, e = window.__ph; r.god(); p.update(0); const f = p.forward; e.position.set(p.position.x + f.x * 6, 0, p.position.z + f.z * 6); e.followGround(0); e.setState('close'); e.damage(200, { kind: 'bullet' });
    return { alive: e.alive, snd: window.__snd }; })()`);
  console.log('death', JSON.stringify(dead));
  await frames(api, 2);
  await shot(api, 'phantom-death');
  const fin = await api.run(`(() => { window.__step(30); const r = window.__radius; const s = r.stats(); return { enemies: r.ctx.enemies.list.length, calls: s.calls, missing: s.missingSounds, error: s.error, errors: s.errors }; })()`);
  console.log('final', JSON.stringify(fin));
}
