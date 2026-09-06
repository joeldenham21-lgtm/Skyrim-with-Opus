// Spawn v2: a nest (screenshot), emission after a shot within 20 m and after a kill, the cap of three,
// scattering out of the torch beam, and bites that stack into a bleed.
import { boot, frames, shot } from './enemies-core-lib.mjs';
const STEP = `(n) => { const ctx = window.__radius.ctx; for (let k = 0; k < n; k++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); } }`;
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  const t0 = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, T = ctx.THREE; ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, -0.25); r.setTime(12); r.god(); window.__step = ${STEP};
    p.update(0); const f = p.forward; const nest = window.__nest = new T.Vector3(p.position.x + f.x * 9, 0, p.position.z + f.z * 9);
    window.__sp = [0, 1, 2].map((i) => { const a = i * 2.1; const e = r.spawn('spawn', nest.x + Math.cos(a) * 1.6, nest.z + Math.sin(a) * 1.6, { pack: nest, nest, yaw: p.yaw + Math.PI + i }); e.playerVisibility = () => 0; e.playerAudibility = () => 0; e.root.traverse((o) => { o.userData.__enemy = true; }); return e; });
    return { nest: !!window.__sp[0].nest, mesh: !!(window.__sp[0].nest && window.__sp[0].nest.mesh), count: ctx.enemies.count('spawn') }; })()`);
  console.log('nest', JSON.stringify(t0));
  await frames(api, 2);
  await shot(api, 'spawn-nest-9m');
  // ---- a shot within 20 m: two more should come, out of view. Look away first so the hole is behind us. ----
  const em = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; r.setLook(0.2 + Math.PI, 0); p.update(0);
    const n0 = ctx.enemies.count('spawn');
    ctx.director.notify('shot', { pos: p.position.clone() }); ctx.events.emit('weaponFired', null);
    const n1 = ctx.enemies.count('spawn');
    window.__step(4);
    const n2 = ctx.enemies.count('spawn'); const nest = window.__sp[0].nest;
    const fresh = ctx.enemies.list.filter((e) => e.type === 'spawn' && !window.__sp.includes(e));
    return { n0, n1, n2, emitted: nest.emitted, freshStates: fresh.map((e) => e.state), freshSeen: fresh.map((e) => e.observedByPlayer(62)), freshD: fresh.map((e) => +e.distanceToPlayer().toFixed(1)) }; })()`);
  console.log('emission after shot', JSON.stringify(em));
  // ---- a kill after the cooldown: one more emission; then the cap ----
  const cap = await api.run(`(() => { const r = window.__radius, ctx = r.ctx; const nest = window.__sp[0].nest; window.__step(110);
    window.__sp[0].damage(100, { kind: 'bullet' }); window.__step(2); const e2 = nest.emitted; const c2 = ctx.enemies.count('spawn');
    window.__step(110); ctx.director.notify('shot', { pos: ctx.player.position.clone() }); ctx.events.emit('weaponFired', null); window.__step(2); const e3 = nest.emitted;
    window.__step(110); ctx.director.notify('shot', { pos: ctx.player.position.clone() }); ctx.events.emit('weaponFired', null); window.__step(2); const e4 = nest.emitted;
    return { afterKill: e2, count: c2, afterShot3: e3, afterShot4: e4, alive: ctx.enemies.count('spawn') }; })()`);
  console.log('cap', JSON.stringify(cap));
  // ---- the torch: swarm toward the player in the beam at night; they should scatter and come round the back ----
  const torch = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); r.setTime(22.5); ctx.state.data.flashlight.on = true; ctx.lighting.flashLevel = 1; r.setLook(0.2, 0); p.update(0); const f = p.forward;
    const s = [0, 1, 2].map((i) => { const e = r.spawn('spawn', p.position.x + f.x * 7 + (i - 1) * 0.8 * f.z, p.position.z + f.z * 7 - (i - 1) * 0.8 * f.x, { yaw: p.yaw + Math.PI }); e.aware = 1; e.setState('swarm'); return e; });
    let scatters = 0, bitesFront = 0, bitesBack = 0; const oldBite = s.map((e) => e.biteNow.bind(e));
    s.forEach((e, i) => { e.biteNow = () => { const hd = Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z) || 1; const facing = ((e.position.x - p.position.x) * p.forward.x + (e.position.z - p.position.z) * p.forward.z) / hd; if (facing >= 0.35) bitesFront++; else bitesBack++; oldBite[i](); }; });
    const seq = [];
    for (let i = 0; i < 60; i++) { window.__step(2); const st = s.map((e) => e.state[0]).join(''); if (st.includes('c')) scatters++; if (i % 6 === 0) seq.push(st + ':' + s.map((e) => +e.beam.toFixed(1)).join('/')); }
    return { seq, scatters, bitesFront, bitesBack, hp: ctx.player.hp }; })()`);
  console.log('torch', JSON.stringify(torch));
  // ---- bites stack: two bites within eight seconds open a bleed ----
  const bleed = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); r.setTime(12); ctx.state.data.flashlight.on = false; r.god(false); ctx.state.data.bleeding = false; ctx.state.data.hp = 100;
    p.update(0); const f = p.forward; const e = r.spawn('spawn', p.position.x - f.x * 0.9, p.position.z - f.z * 0.9, { yaw: p.yaw }); e.aware = 1; e.setState('swarm');
    e.biteNow(); const b1 = ctx.state.data.bleeding; e.biteNow(); const b2 = ctx.state.data.bleeding; r.god();
    return { b1, b2, hp: ctx.state.data.hp }; })()`);
  console.log('bleed', JSON.stringify(bleed));
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { calls: s.calls, missing: s.missingSounds, error: s.error, errors: s.errors }; })()`);
  console.log('final', JSON.stringify(fin));
}
