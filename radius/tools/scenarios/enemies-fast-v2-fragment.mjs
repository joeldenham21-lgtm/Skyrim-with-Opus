// Fragments v2: a ring of four forming 30 m out (screenshot), the three-side split once the player is inside
// 25 m (stepped), the low approach, and a chain pop.
import { boot, frames, shot } from './enemies-core-lib.mjs';
const STEP = `(n) => { const ctx = window.__radius.ctx; for (let k = 0; k < n; k++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); } }`;
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  const t0 = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, 0.02); r.setTime(12); r.god(); window.__step = ${STEP};
    p.update(0); const f = p.forward; const cx = p.position.x + f.x * 32, cz = p.position.z + f.z * 32;
    window.__f = [0, 1, 2, 3].map((i) => { const a = i * 1.57; const e = r.spawn('fragment', cx + Math.cos(a) * 3, cz + Math.sin(a) * 3, { poi: 'test' }); e.root.traverse((o) => { o.userData.__enemy = true; }); return e; });
    for (const e of window.__f) { e.losT = 1e9; e.los = false; }   // hold the formation for the look
    window.__step(60);
    const r0 = window.__f[0].ring;
    return { ring: r0 ? r0.id : null, same: window.__f.every((e) => e.ring === r0), alive: r0 && r0.alive, slots: window.__f.map((e) => e.slot), states: window.__f.map((e) => e.state), d: window.__f.map((e) => +e.distanceToPlayer().toFixed(1)), ys: window.__f.map((e) => +(e.position.y - ctx.world.getHeight(e.position.x, e.position.z)).toFixed(2)), chime: window.__f.map((e) => e.chimeState) }; })()`);
  console.log('ring', JSON.stringify(t0));
  await frames(api, 2);
  await shot(api, 'fragment-ring-32m');
  // ---- inside 25 m: release the look; the ring should split three ways and come in low ----
  let split = false, low = false, sides = new Set();
  for (let i = 0; i < 16; i++) {
    const s = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; if (${i} === 0) { p.update(0); const f = p.forward; r.teleport(p.position.x + f.x * 12, p.position.z + f.z * 12); for (const e of window.__f) { e.losT = 0; } }
      window.__step(10);
      return { t: +ctx.elapsed.toFixed(1), ring: window.__f[0].ring && window.__f[0].ring.state, st: window.__f.map((e) => e.state), side: window.__f.map((e) => +(e.side * 180 / Math.PI).toFixed(0)), d: window.__f.map((e) => +e.distanceToPlayer().toFixed(1)), h: window.__f.map((e) => +(e.position.y - ctx.world.getHeight(e.position.x, e.position.z)).toFixed(2)), alive: window.__f.filter((e) => e.alive).length, hp: ctx.player.hp }; })()`);
    console.log(JSON.stringify(s));
    if (s.ring === 'split') split = true;
    s.st.forEach((st, k) => { if (st === 'flank') { sides.add(s.side[k]); if (s.h[k] < 1.0) low = true; } });
    if (s.st.every((st) => st === 'attracted') || s.alive < 4) break;
  }
  console.log('split result', JSON.stringify({ split, low, sides: [...sides] }));
  await frames(api, 2);
  await shot(api, 'fragment-split-approach');
  // ---- chain: bunch three within a metre, pop one ----
  const chain = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const c = [0, 1, 2].map((i) => { const e = r.spawn('fragment', p.position.x + f.x * 8 + (i - 1) * 1.2 * f.z, p.position.z + f.z * 8 - (i - 1) * 1.2 * f.x); e.losT = 1e9; e.los = false; return e; });
    for (const e of c) { e.position.y = p.eye.y; }
    c[0].damage(5, { kind: 'bullet', point: c[0].position.clone() });
    const a0 = c.filter((e) => e.alive).length; const ch = c.map((e) => +e.chainT.toFixed(2));
    window.__step(12);
    return { aliveAfterShot: a0, chainT: ch, aliveAfterChain: c.filter((e) => e.alive).length, enemies: ctx.enemies.list.length }; })()`);
  console.log('chain', JSON.stringify(chain));
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { calls: s.calls, missing: s.missingSounds, error: s.error, errors: s.errors }; })()`);
  console.log('final', JSON.stringify(fin));
}
