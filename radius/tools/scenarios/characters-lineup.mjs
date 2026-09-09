// Characters: how the mimics read. A lineup of every class at 7 m, a close-up at 3 m, and the same actor at
// 10 / 30 / 60 m to judge whether the silhouette still says "armed man" at range.
import { boot, frames, shot, fpsProbe } from './enemies-core-lib.mjs';

const CLASSES = ['recruit', 'regular', 'veteran', 'elite', 'gunner'];

export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 2 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.0, -0.02); r.setTime(12); r.ctx.player.update(0); })()`);

  // ---- lineup: six classes shoulder to shoulder at 7 m, standing idle, facing the player
  const info = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; p.update(0); const f = p.forward;
    ctx.enemies.removeAll();
    const out = []; const cls = ${JSON.stringify(CLASSES)};
    for (let i = 0; i < cls.length; i++) {
      const side = (i - (cls.length - 1) / 2) * 1.30;
      const x = p.position.x + f.x * 6.2 + f.z * side, z = p.position.z + f.z * 6.2 - f.x * side;
      const e = r.spawn('mimic', x, z, { cls: cls[i], tide: 3, idle: true, yaw: p.yaw + Math.PI });
      if (!e) continue;
      e.root.traverse((o) => { o.userData.__enemy = true; });
      e.aware = 0; e.setState('idle');
      out.push({ cls: cls[i], h: +e.height.toFixed(2), vest: e.loadout.vest && e.loadout.vest.id, helmet: e.loadout.helmet && e.loadout.helmet.id, kit: (e.loadout.kit || []).map((k) => k.id), w: e.weapon.id, stub: !!e.rig.stub, legacy: !!e.rig.legacy });
    }
    for (let i = 0; i < 20; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); }
    return out; })()`);
  console.log('lineup', JSON.stringify(info, null, 0));
  console.log('render ms', await api.run(fpsProbe));
  await frames(api, 2);
  await shot(api, 'lineup-7m-noon');

  // ---- close-up: one veteran at 3 m, three quarter view
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const e = r.spawn('mimic', p.position.x + f.x * 2.9 + f.z * 0.25, p.position.z + f.z * 2.9 - f.x * 0.25, { cls: 'veteran', tide: 3, idle: true, yaw: p.yaw + Math.PI + 0.7 });
    e.root.traverse((o) => { o.userData.__enemy = true; }); window.__m = e; e.aware = 0.2;
    for (let i = 0; i < 20; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); } })()`);
  await api.run(`window.__radius.setLook(0.0, -0.10)`);
  await frames(api, 2);
  await shot(api, 'closeup-3m');

  // ---- aiming pose at 6 m
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, m = window.__m; m.position.set(p.position.x + p.forward.x * 5.2, m.position.y, p.position.z + p.forward.z * 5.2); m.aware = 1; m.engaged = true; m.setState('engage'); m.lastVisT = ctx.elapsed; m.lastSeenPlayer = p.position.clone();
    for (let i = 0; i < 24; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); } })()`);
  await api.run(`window.__radius.setLook(0.0, -0.04)`);
  await frames(api, 2);
  await shot(api, 'aiming-6m');

  // ---- distance: 10 / 30 / 60 m, one frame, laterally spread so all three are in shot
  const dinfo = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const ds = [10, 30, 60], sides = [-2.2, 0.6, 3.0], out = [];
    for (let i = 0; i < 3; i++) { const d = ds[i], s = sides[i] * (d / 10) * 0.55;
      const e = r.spawn('mimic', p.position.x + f.x * d + f.z * s, p.position.z + f.z * d - f.x * s, { cls: i === 2 ? 'regular' : 'veteran', tide: 3, idle: true, yaw: p.yaw + Math.PI + 0.4 });
      if (!e) continue; e.root.traverse((o) => { o.userData.__enemy = true; }); e.aware = 0.3;
      out.push({ d, x: +e.position.x.toFixed(1), z: +e.position.z.toFixed(1) }); }
    for (let i = 0; i < 20; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); }
    return out; })()`);
  console.log('distance', JSON.stringify(dinfo));
  await api.run(`window.__radius.setLook(0.0, -0.015)`);
  await frames(api, 2);
  await shot(api, 'range-10-30-60');

  // ---- overcast dusk at 30 m, the real lighting
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx; r.setTime(18.5); for (let i = 0; i < 6; i++) { ctx.elapsed += 0.05; ctx.lighting.update && ctx.lighting.update(0.05, ctx.elapsed); ctx.enemies.update(0.05); } })()`);
  await frames(api, 2);
  await shot(api, 'range-dusk');

  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
