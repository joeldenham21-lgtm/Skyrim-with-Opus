// Slider v2, stepped: a pair (one shows itself in front, the other comes from behind), the aimed-at break,
// a roof drop from a test box, a flashbang stun and smoke breaking a charge.
import { boot, frames, shot } from './enemies-core-lib.mjs';
const STEP = `(n) => { const ctx = window.__radius.ctx; for (let k = 0; k < n; k++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); } }`;
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(12); r.god(); window.__step = ${STEP}; })()`);
  // ---- the pair: two hidden sliders 26 m ahead, six metres either side of the view axis ----
  const t0 = await api.run(`(() => { const r = window.__radius, p = r.ctx.player; p.update(0); const f = p.forward;
    const mk = (side) => { const x = p.position.x + f.x * 26 + f.z * side, z = p.position.z + f.z * 26 - f.x * side; const e = r.spawn('slider', x, z, { pairId: 'T', wanderer: true, yaw: p.yaw + Math.PI }); e.root.traverse((o) => { o.userData.__enemy = true; }); return e; };
    window.__a = mk(6); window.__b = mk(-6); window.__clicks = 0;
    for (const e of [window.__a, window.__b]) { const os = e.sound.bind(e); e.sound = (n, o) => { if (n === 'slider_click') window.__clicks++; return os(n, o); }; }
    return { paired: window.__a.partner === window.__b && window.__b.partner === window.__a, pairId: window.__a.pairId }; })()`);
  console.log('pair', JSON.stringify(t0));
  const off = (e) => `(() => { const p = window.__radius.ctx.player; const b = Math.atan2(${e}.position.z - p.position.z, ${e}.position.x - p.position.x), v = Math.atan2(p.forward.z, p.forward.x); let d = b - v; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return +(d * 180 / Math.PI).toFixed(0); })()`;
  let seenDecoy = false, seenBehind = false, hpDrop = false;
  for (let i = 0; i < 24; i++) {
    const s = await api.run(`(() => { window.__step(20); const r = window.__radius, a = window.__a, b = window.__b; if (r.ctx.elapsed > 0 && a.state !== 'hidden') r.god(false);
      return { t: +r.ctx.elapsed.toFixed(1), a: { st: a.state, role: a.role, d: +a.distanceToPlayer().toFixed(1), off: ${off('window.__a')} }, b: { st: b.state, role: b.role, d: +b.distanceToPlayer().toFixed(1), off: ${off('window.__b')} }, hp: r.ctx.player.hp, clicks: window.__clicks, dir: r.ctx.director.state }; })()`);
    console.log(JSON.stringify(s));
    for (const e of [s.a, s.b]) { if (e.role === 'decoy' && e.st === 'decoy' && Math.abs(e.off) < 45 && e.d < 24) seenDecoy = true; if (e.role === 'striker' && Math.abs(e.off) > 90 && e.d < 16) seenBehind = true; }
    if (s.hp < 100) { hpDrop = true; break; }
  }
  console.log('pair result', JSON.stringify({ seenDecoy, seenBehind, hpDrop }));
  await api.run(`(() => { const r = window.__radius; r.setLook(0.2, -0.05); })()`);
  await frames(api, 2);
  await shot(api, 'slider-pair');
  // ---- the aimed-at break: a decoy 16 m ahead, sights on it for a second ----
  const aim = await api.run(`(() => { const r = window.__radius, p = r.ctx.player; r.god(); r.ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const e = window.__c = r.spawn('slider', p.position.x + f.x * 16, p.position.z + f.z * 16, { wanderer: true, yaw: p.yaw + Math.PI }); e.startDecoy(); e.target = null; e.role = 'decoy'; e.partner = { alive: true, struck: false, state: 'circle', removeMe: false, partner: e };
    window.__mock = 0; const os = e.sound.bind(e); e.sound = (n, o) => { if (n === 'slider_click' && o && o.rate > 1.4) window.__mock++; return os(n, o); };
    // look exactly at it
    const yaw = Math.atan2(-(e.position.x - p.position.x), -(e.position.z - p.position.z)); r.setLook(yaw, -0.02); p.update(0);
    window.__step(10);
    const s0 = { st: e.state, aimedT: +e.aimedT.toFixed(2), observed: e.observed };
    window.__step(16);
    return { s0, s1: { st: e.state, aimedT: +e.aimedT.toFixed(2), mock: window.__mock } }; })()`);
  console.log('aimed', JSON.stringify(aim));
  // ---- the roof: a 3 m box with a roof hiding spot; the slider settles on it, the player walks under ----
  const roof = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, w = ctx.world, T = ctx.THREE; ctx.enemies.removeAll(); r.god(false);
    r.teleport(60, 130); r.setLook(Math.PI, 0); p.update(0);
    const bx = 60, bz = 100; const gy = w.getHeight(bx, bz); const top = gy + 3.0;
    w.addBox(bx, gy + 1.5, bz, 4, 3.0, 4, { tag: 'test-roof', walkable: true });
    w.hidingSpots.push({ position: new T.Vector3(bx, top, bz), poi: null, kind: 'roof' });
    const e = window.__d = r.spawn('slider', bx + 1, bz + 1, { yaw: 0 });
    const s0 = { st: e.state, onRoof: e.onRoof, kind: e.hideKind, y: +e.position.y.toFixed(2), top: +top.toFixed(2), d: +e.distanceToPlayer().toFixed(1) };
    // stand at the wall, back to it
    r.teleport(bx, bz + 3.6); r.setLook(Math.PI, 0); p.update(0);
    window.__grab = 0;
    const seq = [];
    for (let i = 0; i < 40; i++) { window.__step(2); seq.push(e.state[0] + (e.flying ? '^' : '')); if (e.state === 'retreat' || e.state === 'charge') break; }
    return { s0, seq: seq.join(''), st: e.state, hp: ctx.player.hp, y: +e.position.y.toFixed(2), d: +e.distanceToPlayer().toFixed(1), struck: e.struck }; })()`);
  console.log('roof', JSON.stringify(roof));
  // ---- stun and smoke ----
  const stun = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, w = ctx.world, T = ctx.THREE; ctx.enemies.removeAll(); r.god(); w.clearTag('test-roof');
    r.teleport(30, 130); r.setLook(0.2, 0); p.update(0); const f = p.forward;
    const e = r.spawn('slider', p.position.x + f.x * 14, p.position.z + f.z * 14, { wanderer: true, yaw: p.yaw + Math.PI }); e.startCharge(); e.rise = 1;
    window.__step(4); const s0 = e.state; e.stunned = 1.5; window.__step(4); const s1 = e.state; window.__step(34); const s2 = e.state;
    // smoke: a fresh charge, a cloud between
    const g = r.spawn('slider', p.position.x + f.x * 14, p.position.z + f.z * 14, { wanderer: true, yaw: p.yaw + Math.PI }); g.startCharge(); g.rise = 1;
    window.__step(4); const s3 = g.state; w.smoke.push({ position: new T.Vector3(p.position.x + f.x * 6, p.position.y + 1, p.position.z + f.z * 6), radius: 4, t: 20 });
    window.__step(8); const s4 = g.state; w.smoke.length = 0;
    return { stun: [s0, s1, s2], smoke: [s3, s4] }; })()`);
  console.log('stun/smoke', JSON.stringify(stun));
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { calls: s.calls, missing: s.missingSounds, error: s.error, errors: s.errors }; })()`);
  console.log('final', JSON.stringify(fin));
}
