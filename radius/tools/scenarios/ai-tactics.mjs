// The unit behaviours, one at a time, with numbers rather than adjectives:
//   1. bounding overwatch  — a bound is only allowed when a stationary man has a line onto the lane, and the
//                            man covering it is handed that arc as a sector.
//   2. covering fire       — a man holding a sector who cannot see the player puts rounds into the arc.
//   3. the flanking element— both flankers take the same side, and neither steps off until the base is firing.
//   4. the grenade order   — the radio call goes out before the pin comes out, not after.
//   5. the fields          — nothing paths into an anomaly, and a broken squad puts one between you and it.
//   6. the leader          — killing him costs the squad its manoeuvres for a while.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai-tactics.mjs --out .smoke/ai-tactics
import { boot, HOOKS, SETUP } from './ai-bench.mjs';

const T = { name: 'zarya', poi: 'zarya', x: -118, z: 92, look: 0.35, d: 42, n: 5, tide: 2, sec: 4 };

const STEP = (n, dt = 0.05) => `(() => {
  const ctx = window.__radius.ctx;
  for (let i = 0; i < ${n}; i++) { ctx.elapsed += ${dt}; ctx.enemies.update(${dt}); ctx.squads.update(${dt}); ctx.director.update(${dt}); ctx.player.update(${dt}); }
})()`;

// one sample of everything the squad is doing right now
const SNAP = `(() => {
  const ctx = window.__radius.ctx, s = window.__sq, p = ctx.player, f = p.forward;
  return { st: s.state, kind: s.contactKind, org: +s.org.toFixed(2), fixing: s.fixing, spread: +s.spread().toFixed(1),
    bounds: s.bounds, refused: s.boundsRefused, frags: s.fragOrders, flankers: s.flankers, side: s.flankSide, set: s.flankSet,
    men: window.__list.filter((m) => m.alive).map((m) => {
      const o = m.orders, dx = m.position.x - p.position.x, dz = m.position.z - p.position.z;
      return { job: o ? o.job : '-', mv: o ? o.mv : 0, sect: !!(o && o.hasSector), cover: !!(o && o.covering), fire: !!(o && o.fire),
        sup: m.suppressLeft, ang: Math.round(Math.atan2(dx * f.z - dz * f.x, dx * f.x + dz * f.z) * 180 / Math.PI),
        d: +Math.hypot(dx, dz).toFixed(1) };
    }) };
})()`;

export default async function (page, api) {
  await boot(api);
  await api.run(HOOKS);
  await api.run('window.__walk = 0');
  console.log('setup', JSON.stringify(await api.run(SETUP(T))));

  // ---- 1-3: let a contact run and watch the unit behaviours appear ----
  const tape = [];
  for (let k = 0; k < 10; k++) { await api.run(STEP(60)); tape.push(await api.run(SNAP)); }
  for (const s of tape) console.log('  ', JSON.stringify(s));

  // covering fire: a man with a sector, no sight of the player, shooting into the arc
  console.log('cover-fire', JSON.stringify(await api.run(`(() => {
    const ctx = window.__radius.ctx; let seen = 0, sectors = 0, blind = 0;
    for (let i = 0; i < 400; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05);
      for (const m of window.__list) { if (!m.alive || !m.orders || !m.orders.hasSector) continue; sectors++;
        if (ctx.elapsed - m.lastVisT > 0.7) { blind++; if (m.suppressLeft > 0) seen++; } } }
    return { sectorTicks: sectors, blindTicks: blind, coveringTicks: seen };
  })()`)));

  // ---- 4: the grenade order. The call must precede the throw. ----
  console.log('grenade', JSON.stringify(await api.run(`(() => {
    const ctx = window.__radius.ctx, s = window.__sq;
    const log = [];
    const say = s.say.bind(s); s.say = (k, m, g) => { log.push(['say:' + k, +ctx.elapsed.toFixed(2)]); return say(k, m, g); };
    const tg = ctx.squads.throwGrenade.bind(ctx.squads); ctx.squads.throwGrenade = (m, f, t, id) => { log.push(['throw', +ctx.elapsed.toFixed(2)]); return tg(m, f, t, id); };
    for (const m of window.__list) { m.grenades = 2; }
    s.grenadeT = 0; s.combatT = 30; s.morale = 0.7;
    for (let i = 0; i < 900; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); }
    const gi = log.findIndex((l) => l[0] === 'say:grenade'), ti = log.findIndex((l) => l[0] === 'throw');
    return { orders: s.fragOrders, calls: log.filter((l) => l[0] === 'say:grenade').length, throws: log.filter((l) => l[0] === 'throw').length,
      leadS: gi >= 0 && ti > gi ? +(log[ti][1] - log[gi][1]).toFixed(2) : null, first: log.slice(0, 12) };
  })()`)));

  // ---- 5: the fields ----
  console.log('anomalies', JSON.stringify(await api.run(`(() => {
    const r = window.__radius, ctx = r.ctx, p = ctx.player;
    // drop a field halfway between the player and the squad, then run and count anybody standing in one
    const c = window.__sq.centroid;
    const mx = (p.position.x + c.x) / 2, mz = (p.position.z + c.z) / 2;
    const a = ctx.anomalies.spawn('electric', new ctx.THREE.Vector3(mx, ctx.world.getHeight(mx, mz), mz));
    let inside = 0, ticks = 0, closest = 99;
    for (let i = 0; i < 500; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05);
      for (const m of window.__list) { if (!m.alive) continue; ticks++;
        const d = Math.hypot(m.position.x - a.position.x, m.position.z - a.position.z);
        if (d < closest) closest = d;
        if (d < a.radius) inside++; } }
    return { radius: +a.radius.toFixed(1), ticks, insideTicks: inside, closestApproach: +closest.toFixed(1) };
  })()`)));

  // ---- 6: the leader ----
  console.log('leader', JSON.stringify(await api.run(`(() => {
    const ctx = window.__radius.ctx, s = window.__sq;
    const before = { org: +s.org.toFixed(2), bounds: s.bounds, flankers: s.flankers, leader: s.leader ? s.leader.cls : null };
    const L = s.leader; if (L) L.damage(9999, { kind: 'bullet' });
    const after = [];
    for (let k = 0; k < 6; k++) { for (let i = 0; i < 60; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); }
      after.push({ t: +ctx.elapsed.toFixed(0), org: +s.org.toFixed(2), shaken: +s.shaken.toFixed(1), bounding: s.bounding, flankers: s.flankers, jobs: s.members.filter((m) => m.alive).map((m) => m.orders && m.orders.job).join(',') }); }
    return { before, after };
  })()`)));

  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
