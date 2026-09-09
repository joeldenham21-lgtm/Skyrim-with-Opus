// Characters: how the mimics read. A lineup of five classes at 6 m, a close-up at 3 m, the aiming pose, and the
// same actor at 10 / 30 / 60 m to judge whether the silhouette still says "armed man" at range.
import { boot, frames } from './enemies-core-lib.mjs';

const CLASSES = ['recruit', 'regular', 'veteran', 'elite', 'gunner'];
let shotN = 0;
async function shot(api, name) {
  const p = `${api.outDir}/${String(shotN++).padStart(2, '0')}-${name}.png`;
  await api.page.screenshot({ path: p, timeout: 600000 });
  console.log('screenshot', p);
  return p;
}
const step = (n = 20) => `(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); } })()`;

export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 2 });
  // The harness shares this machine with other agents' runs, so a frame can cost half a minute. Cut the shadow
  // map right down and turn off the ambient-occlusion pass; neither changes how the model reads.
  await api.run(`(() => { const ctx = window.__radius.ctx; const sun = ctx.lighting.sun;
    if (sun && sun.shadow) { if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(512, 512); }
    for (const q of (ctx.post.composer ? ctx.post.composer.passes : [])) { const n = q.constructor.name; if (/SAO|SSAO|GTAO|Bokeh/.test(n)) q.enabled = false; } })()`);
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.0, -0.02); r.setTime(12); r.ctx.player.update(0); })()`);

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
      const rg = e.rig;
      out.push({ cls: cls[i], build: rg.build && rg.build.id, head: rg.headKind, coat: rg.coat, worn: rg.worn ? rg.worn.length : 0,
        vest: e.loadout.vest && e.loadout.vest.id, helmet: e.loadout.helmet && e.loadout.helmet.id, kit: (e.loadout.kit || []).map((k) => k.id), w: e.weapon.id, legacy: !!rg.legacy });
    }
    return out; })()`);
  console.log('lineup', JSON.stringify(info));
  await api.run(step(20));
  await frames(api, 2, 600000);
  await shot(api, 'lineup-6m-noon');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));

  // ---- close-up, three-quarter view
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const e = r.spawn('mimic', p.position.x + f.x * 2.9 + f.z * 0.25, p.position.z + f.z * 2.9 - f.x * 0.25, { cls: 'veteran', tide: 3, idle: true, yaw: p.yaw + Math.PI + 0.7 });
    e.root.traverse((o) => { o.userData.__enemy = true; }); window.__m = e; e.aware = 0.2; })()`);
  await api.run(step(20));
  await api.run(`window.__radius.setLook(0.0, -0.10)`);
  await frames(api, 2, 600000);
  await shot(api, 'closeup-3m');

  // ---- shouldered and firing at 5 m
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player, m = window.__m;
    m.position.set(p.position.x + p.forward.x * 5.2, m.position.y, p.position.z + p.forward.z * 5.2);
    m.aware = 1; m.engaged = true; m.setState('engage'); m.lastVisT = ctx.elapsed; m.lastSeenPlayer = p.position.clone(); })()`);
  await api.run(step(30));
  await api.run(`window.__radius.setLook(0.0, -0.05)`);
  await frames(api, 2, 600000);
  await shot(api, 'aiming-5m');

  // ---- distance: 10 / 30 / 60 m in one frame
  const dinfo = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const ds = [10, 30, 60], sides = [-1.3, 0.4, 1.9], out = [];
    for (let i = 0; i < 3; i++) { const d = ds[i], s = sides[i] * (d / 10);
      const e = r.spawn('mimic', p.position.x + f.x * d + f.z * s, p.position.z + f.z * d - f.x * s, { cls: i === 2 ? 'regular' : 'veteran', tide: 3, idle: true, yaw: p.yaw + Math.PI + 0.4 });
      if (!e) continue; e.root.traverse((o) => { o.userData.__enemy = true; }); e.aware = 0.3;
      out.push({ d, vest: e.loadout.vest && e.loadout.vest.id }); }
    return out; })()`);
  console.log('distance', JSON.stringify(dinfo));
  await api.run(step(20));
  await api.run(`window.__radius.setLook(0.0, -0.02)`);
  await frames(api, 2, 600000);
  await shot(api, 'range-10-30-60');

  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
