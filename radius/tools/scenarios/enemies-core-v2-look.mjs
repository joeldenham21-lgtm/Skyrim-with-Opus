// Looks: an armoured mimic (vest + helmet) at noon, 9 m; a mimic with a weapon light at 22:30, searching; the
// marksman's glint; the seeker's suit and reload.
import { boot, frames, shot, fpsProbe } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, -0.04); r.setTime(12); r.ctx.player.update(0); })()`);
  const info = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, f = p.forward; let e = null;
    for (let i = 0; i < 8; i++) { e = r.spawn('mimic', p.position.x + f.x * 9 + f.z * 0.5, p.position.z + f.z * 9 - f.x * 0.5, { cls: 'elite', tide: 3, idle: true, yaw: p.yaw + Math.PI + 0.35 }); if (e.loadout.vest && e.loadout.helmet && e.hasLight) break; e.removeMe = true; ctx.enemies.removeDead(); }
    e.root.traverse((o) => { o.userData.__enemy = true; }); window.__m = e;
    return { cls: e.cls, w: e.weapon.id, att: e.weapon.attachments, rails: e.weapon.rails, vest: e.loadout.vest?.id, helmet: e.loadout.helmet?.id, light: e.hasLight, laser: e.fx.laser, rigStub: !!e.rig.stub, legacy: !!e.rig.legacy, gun: !!e.gun, gear: !!e.rig.gear }; })()`);
  console.log('mimic', JSON.stringify(info));
  console.log('render ms', await api.run(fpsProbe));
  await frames(api, 3);
  await shot(api, 'armoured-noon-9m');
  // night, searching with the weapon light on, the beam across the player
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, m = window.__m; r.setTime(22.5); m.aware = 0.9; m.lastSeenPlayer = ctx.player.position.clone(); m.lastSeenT = ctx.elapsed; m.setState('search'); m.target = null;
    for (let i = 0; i < 12; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.population.update(0.05); ctx.lighting.update?.(0.05, ctx.elapsed); } })()`);
  const lit = await api.run(`(() => { const m = window.__m; return { want: m.wantLight, entry: !!m.lightEntry, intensity: m.lightEntry ? +m.lightEntry.light.intensity.toFixed(1) : 0, state: m.state }; })()`);
  console.log('light', JSON.stringify(lit));
  await frames(api, 3);
  await shot(api, 'weaponlight-2230');
  // the beam at the player: face it from 10 m
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, m = window.__m; m.aware = 1; m.engaged = true; m.setState('engage'); m.lastVisT = ctx.elapsed; for (let i = 0; i < 10; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.population.update(0.05); } })()`);
  await frames(api, 2);
  await shot(api, 'weaponlight-engaged');
  // marksman at 70 m, daylight: the glint during the aim
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx; r.setTime(12); ctx.enemies.removeAll(); const p = ctx.player, f = p.forward; const e = r.spawn('mimic', p.position.x + f.x * 70, p.position.z + f.z * 70, { cls: 'sniper', tide: 3, yaw: p.yaw + Math.PI }); e.root.traverse((o) => { o.userData.__enemy = true; }); window.__s = e; e.aware = 1; e.engaged = true; e.setState('engage'); e.lastVisT = ctx.elapsed; e.cooldown = 0; window.__shots = 0; const mf = ctx.vfx.muzzleFlash; ctx.vfx.muzzleFlash = (a, b) => { window.__shots++; return mf(a, b); };
    for (let i = 0; i < 16; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.population.update(0.05); ctx.player.update(0.05); } })()`);
  const sn = await api.run(`(() => { const e = window.__s; return { w: e.weapon.id, aiming: e.aiming, aimT: +e.aimT.toFixed(2), glint: e.glint ? e.glint.visible : null, shots: window.__shots, d: +e.distanceToPlayer().toFixed(0), st: e.state, spread: +e.spreadDeg(true).toFixed(2) }; })()`);
  console.log('sniper', JSON.stringify(sn));
  await frames(api, 2);
  await shot(api, 'sniper-glint-70m');
  const sn2 = await api.run(`(() => { const ctx = window.__radius.ctx, e = window.__s; const log = []; for (let i = 0; i < 100; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.population.update(0.05); ctx.player.update(0.05); if (i % 10 === 0) log.push([+ctx.elapsed.toFixed(1), e.aiming, window.__shots, e.roundsLeft(), e.cycleT > 0]); } return log; })()`);
  console.log('sniper 5s', JSON.stringify(sn2));
  // seeker: suit resolution and the belt
  const sk = await api.run(`(() => { const r = window.__radius, ctx = r.ctx; ctx.enemies.removeAll(); const p = ctx.player, f = p.forward; const s = r.spawn('seeker', p.position.x + f.x * 20, p.position.z + f.z * 20, { yaw: p.yaw + Math.PI }); s.root.traverse((o) => { o.userData.__enemy = true; }); window.__k = s;
    const hp0 = s.hp; const dir = new ctx.THREE.Vector3(s.position.x - p.eye.x, s.position.y + 1.5 - p.eye.y, s.position.z - p.eye.z).normalize(); const torso = new ctx.THREE.Vector3(s.position.x, s.position.y + 1.6, s.position.z).addScaledVector(dir, -s.radius);
    s.damage(40, { kind: 'bullet', point: torso.clone(), dir, ammo: '762_fmj', source: 'player' }); const a = hp0 - s.hp; s.damage(74, { kind: 'bullet', point: torso.clone(), dir, ammo: '754_ap', source: 'player' }); const b = hp0 - s.hp - a;
    const lens = new ctx.THREE.Vector3(s.position.x, s.position.y + s.height * 0.92, s.position.z).addScaledVector(dir, -s.radius); s.damage(40, { kind: 'bullet', point: lens, dir, ammo: '762_fmj', source: 'player' }); const c = hp0 - s.hp - a - b;
    return { hp: hp0, fmjTorso: +a.toFixed(1), apTorso: +b.toFixed(1), fmjLens: +c.toFixed(1), suit: s.loadout.suit.durability, rounds: s.weapon.mag.rounds, boxes: s.loadout.boxes.length, shotNames: s.shotNames }; })()`);
  console.log('seeker', JSON.stringify(sk));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
