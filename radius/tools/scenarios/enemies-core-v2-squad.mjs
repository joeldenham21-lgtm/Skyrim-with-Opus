// A three-mimic squad 30 m ahead at Zarya, behind cover: roles (a base of fire holding and firing while a flanker
// moves out of view), reload windows, a grenade when the player holds still, a helmet ring on an armoured head,
// the loot pile call on death.
import { boot, frames, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  // hooks: count shots, record sounds and pile calls, stub the loot pile if the loot agent has not landed
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx; r.teleport(-118, 92); r.setLook(0.35, -0.02); r.setTime(12); ctx.player.update(0);
    window.__shots = 0; const mf = ctx.vfx.muzzleFlash; ctx.vfx.muzzleFlash = (p, d) => { window.__shots++; return mf(p, d); };
    window.__sounds = []; const pl = ctx.audio.play.bind(ctx.audio); ctx.audio.play = (n, o) => { if (/reload|helmet|armor|grenade|bolt|shell|mimic_spot|mimic_radio|mimic_skip/.test(n)) window.__sounds.push([+ctx.elapsed.toFixed(1), n]); return pl(n, o); };
    window.__piles = []; if (!ctx.loot.spawnPile) { window.__pileStub = true; ctx.loot.spawnPile = (pos, entries) => { window.__piles.push(entries.map((e) => e.kind + ':' + e.id + (e.count > 1 ? 'x' + e.count : ''))); }; } else { const sp = ctx.loot.spawnPile.bind(ctx.loot); ctx.loot.spawnPile = (pos, entries) => { window.__piles.push(entries.map((e) => e.kind + ':' + e.id)); return sp(pos, entries); }; }
    window.__thrown = 0; const tg = ctx.squads.throwGrenade.bind(ctx.squads); ctx.squads.throwGrenade = (m, f, t, id) => { window.__thrown++; return tg(m, f, t, id); };
  })()`);
  // three mimics at cover points 24-36 m ahead, within 40 deg of the look direction, out of the player's frustum edge
  const placed = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; const f = p.forward; const out = [];
    const cps = ctx.world.coverPoints.filter((c) => { const dx = c.x - p.position.x, dz = c.z - p.position.z; const d = Math.hypot(dx, dz); if (d < 22 || d > 38) return false; const cos = (dx * f.x + dz * f.z) / d; return cos > 0.7; });
    cps.sort((a, b) => a.distanceTo(p.position) - b.distanceTo(p.position));
    const list = [];
    for (const c of cps) { if (list.length >= 3) break; if (list.some((e) => e.position.distanceTo(c) < 4)) continue; const e = r.spawn('mimic', c.x, c.z, { poi: 'zarya', tide: 2, yaw: Math.atan2(-(p.position.x - c.x), -(p.position.z - c.z)) }); e.root.traverse((o) => { o.userData.__enemy = true; }); list.push(e); out.push({ cls: e.cls, w: e.weapon.id, rounds: e.roundsLeft(), mags: e.loadout.mags.length, vest: e.loadout.vest?.id || null, helmet: e.loadout.helmet?.id || null, gren: e.grenades, light: e.hasLight, d: +e.distanceToPlayer().toFixed(1), cover: cps.length }); }
    while (list.length < 3) { const d = 28 + list.length * 3, s = (list.length - 1) * 5; const x = p.position.x + f.x * d + f.z * s, z = p.position.z + f.z * d - f.x * s; const e = r.spawn('mimic', x, z, { poi: 'zarya', tide: 2 }); e.root.traverse((o) => { o.userData.__enemy = true; }); list.push(e); out.push({ cls: e.cls, w: e.weapon.id, fallback: true }); }
    window.__sq = ctx.squads.form(list, ctx.world.poi('zarya')); window.__list = list;
    for (const e of list) e.grenades = Math.max(e.grenades, 1);
    return out; })()`);
  console.log('squad', JSON.stringify(placed));
  await frames(api, 2);
  await shot(api, 'squad-start');
  const step = (n, dt = 0.1) => api.run(`(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += ${dt}; ctx.enemies.update(${dt}); ctx.population.update(${dt}); ctx.director.update(${dt}); ctx.player.update(${dt}); ctx.vfx.update(${dt}, ctx.elapsed); }
    const p = ctx.player, s = window.__sq; const f = p.forward;
    return { t: +ctx.elapsed.toFixed(1), squad: s.state, shots: window.__shots, hp: +p.hp.toFixed(0), thrown: window.__thrown, dir: ctx.director.state, members: window.__list.map((m) => { const dx = m.position.x - p.position.x, dz = m.position.z - p.position.z; const d = Math.hypot(dx, dz); const ang = Math.round(Math.atan2(dx * f.z - dz * f.x, dx * f.x + dz * f.z) * 180 / Math.PI); return { cls: m.cls, st: m.state, role: m.orders ? m.orders.role : '-', aw: +m.aware.toFixed(2), d: +d.toFixed(1), ang, obs: m.observedByPlayer(45), rounds: m.roundsLeft(), tgt: m.orders && m.orders.hasTarget, fire: m.orders && m.orders.fire, alive: m.alive, hp: Math.round(m.hp) }; }) }; })()`);
  // let them notice: the player fires a shot to draw them (director notify) and stands still
  await api.run(`(() => { const ctx = window.__radius.ctx; ctx.director.notify('shot', { pos: ctx.player.position.clone() }); })()`);
  for (let i = 0; i < 8; i++) { const s = await step(50); console.log('sim', JSON.stringify(s)); if (i === 2) await shot(api, 'squad-engaged'); }
  await frames(api, 2);
  await shot(api, 'squad-40s');
  console.log('sounds', JSON.stringify((await api.run('window.__sounds')).slice(0, 60)));
  // reload window: force an empty magazine on the base and watch for the 2.4 s of no shots between magout and magin
  const rl = await api.run(`(() => { const ctx = window.__radius.ctx; const m = window.__list.find((e) => e.alive && e.orders && e.orders.role === 'base') || window.__list.find((e) => e.alive); if (!m) return null; if (m.weapon.mag) m.weapon.mag.rounds = 1; else m.weapon.tube.length = 1; m.weapon.chamber = m.ammoId; m.cooldown = 0; m.aware = 1; m.engaged = true; m.lastVisT = ctx.elapsed; if (m.state !== 'engage') m.setState('engage'); window.__sounds.length = 0; const s0 = window.__shots; const log = [];
    for (let i = 0; i < 80; i++) { ctx.elapsed += 0.1; ctx.enemies.update(0.1); ctx.population.update(0.1); ctx.player.update(0.1); if (i % 5 === 0) log.push([+ctx.elapsed.toFixed(1), m.state, window.__shots - s0, m.roundsLeft()]); }
    return { cls: m.cls, w: m.weapon.id, log, sounds: window.__sounds.filter((s) => /reload|bolt|shell|break/.test(s[1])), mags: m.loadout.mags.map((x) => x.rounds), dry: m.dry }; })()`);
  console.log('reload', JSON.stringify(rl));
  // helmet ring: an elite (always helmeted) shot in the head with a pistol round
  const ring = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; const f = p.forward; let e = null; for (let i = 0; i < 6; i++) { e = r.spawn('mimic', p.position.x + f.x * 12, p.position.z + f.z * 12, { cls: 'elite', tide: 3 }); if (e.loadout.helmet) break; e.removeMe = true; ctx.enemies.removeDead(); }
    e.root.traverse((o) => { o.userData.__enemy = true; }); window.__sounds.length = 0; const hp0 = e.hp; const dur0 = e.loadout.helmet.durability;
    const pt = new ctx.THREE.Vector3(e.position.x, e.position.y + e.height * 0.93, e.position.z); const dir = pt.clone().sub(p.eye).normalize(); pt.addScaledVector(dir, -e.radius);
    const res = []; for (let i = 0; i < 3; i++) { e.damage(22 * 1.8, { kind: 'bullet', point: pt.clone(), dir, headshot: true, ammo: '9x18_fmj', source: 'player' }); res.push(+(hp0 - e.hp).toFixed(1)); }
    const torso = new ctx.THREE.Vector3(e.position.x, e.position.y + e.height * 0.7, e.position.z).addScaledVector(dir, -e.radius); e.damage(85, { kind: 'bullet', point: torso, dir, ammo: '754_ap', source: 'player' });
    window.__helm = e; return { helmet: e.loadout.helmet.id, vest: e.loadout.vest?.id, hpLost: res, afterAP: +(hp0 - e.hp).toFixed(1), helmDur: [dur0, e.loadout.helmet.durability], vestDur: e.loadout.vest ? e.loadout.vest.durability : null, sounds: window.__sounds.map((s) => s[1]) }; })()`);
  console.log('helmet', JSON.stringify(ring));
  await frames(api, 2);
  await shot(api, 'elite-close');
  // death -> pile
  const pile = await api.run(`(() => { const ctx = window.__radius.ctx; const e = window.__helm; e.damage(5000, { kind: 'blast' }); for (let i = 0; i < 24; i++) { ctx.elapsed += 0.1; ctx.enemies.update(0.1); ctx.vfx.update(0.1, ctx.elapsed); } return { piles: window.__piles, stub: !!window.__pileStub, drops: e.drops ? e.drops.length : 0 }; })()`);
  console.log('pile', JSON.stringify(pile));
  console.log('grenades', JSON.stringify(await api.run('({ thrown: window.__thrown, inFlight: window.__radius.ctx.squads.grenades.length, hold: +(window.__radius.ctx.squads.list[0] ? window.__radius.ctx.squads.list[0].mind.picture.stillT : 0).toFixed(1) })')));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
