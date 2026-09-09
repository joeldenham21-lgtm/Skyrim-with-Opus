// A studio for the mimic bodies. The full zone renders at well under a frame a second under SwiftShader on a
// contended machine, so this strips the scene to a flat backdrop, a cheap ground and the actors: what it costs
// is a frame or two per shot instead of half a minute. Use it to judge form, proportion and pose; use
// characters-lineup.mjs when the question is how they read against the real world.
import { thin, frames } from './enemies-core-lib.mjs';

let shotN = 0;
async function shot(api, name) {
  const p = `${api.outDir}/${String(shotN++).padStart(2, '0')}-${name}.png`;
  await api.page.screenshot({ path: p, timeout: 600000 });
  console.log('screenshot', p);
  return p;
}
const step = (n = 20, dt = 0.05) => `(() => { const ctx = window.__radius.ctx; for (let i = 0; i < ${n}; i++) { ctx.elapsed += ${dt}; ctx.enemies.update(${dt}); } })()`;

// flat sky, cheap terrain, no bloom or AO, tiny shadow map
const STUDIO = `(() => {
  const ctx = window.__radius.ctx, THREE = ctx.THREE;
  const sky = ctx.sky && ctx.sky.dome; if (sky) sky.visible = false;
  if (ctx.sky) { if (ctx.sky.anomaly) ctx.sky.anomaly.visible = false; if (ctx.sky.column) ctx.sky.column.visible = false; }
  ctx.scene.background = new THREE.Color(0x9aa2a8);
  if (ctx.scene.fog) ctx.scene.fog.density = 0.0006;
  const t = ctx.scene.getObjectByName('terrain');
  if (t && !t.userData.__studio) { t.userData.__studio = true; t.material = new THREE.MeshStandardMaterial({ color: 0x6d6f5e, roughness: 1 }); }
  const sun = ctx.lighting.sun;
  if (sun && sun.shadow) { if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(1024, 1024); }
  for (const q of (ctx.post.composer ? ctx.post.composer.passes : [])) { const n = q.constructor.name; if (/Bloom|SAO|SSAO|GTAO|Rays/.test(n)) q.enabled = false; }
  return ctx.post.composer ? ctx.post.composer.passes.map((q) => q.constructor.name + (q.enabled ? '' : '(off)')) : [];
})()`;

const spawnRow = (specs, dist, spacing, opts = '{}') => `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player; p.update(0); const f = p.forward;
  ctx.enemies.removeAll();
  const specs = ${JSON.stringify(specs)}, out = [];
  for (let i = 0; i < specs.length; i++) {
    const side = (i - (specs.length - 1) / 2) * ${spacing};
    const e = r.spawn('mimic', p.position.x + f.x * ${dist} + f.z * side, p.position.z + f.z * ${dist} - f.x * side,
      Object.assign({ cls: specs[i], tide: 3, idle: true, yaw: p.yaw + Math.PI }, ${opts}));
    if (!e) continue;
    e.root.traverse((o) => { o.userData.__enemy = true; });
    e.aware = 0; e.setState('idle');
    const g = e.rig;
    out.push({ cls: specs[i], build: g.build && g.build.id, head: g.headKind, coat: g.coat, worn: g.worn ? g.worn.length : 0, vest: e.loadout.vest && e.loadout.vest.id, helmet: e.loadout.helmet && e.loadout.helmet.id, w: e.weapon.id });
  }
  window.__row = ctx.enemies.list.slice();
  return out; })()`;

export default async function (page, api) {
  // Deliberately not enemies-core-lib's boot(): it renders two full-fat frames before anything is thinned, and
  // under SwiftShader on a loaded machine those two frames are minutes.
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start();');
  await api.wait(400);
  await thin(api, 2);
  console.log('passes', JSON.stringify(await api.run(STUDIO)));
  await api.run(`(() => { const ctx = window.__radius.ctx; if (ctx.perf && ctx.perf.setScale) ctx.perf.setScale(0.5); ctx.state.data.settings.dynamicResolution = false; })()`);
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.0, -0.02); r.setTime(12); r.ctx.player.update(0); })()`);

  // ---- five bodies, five loadouts, at 5 m
  console.log('row', JSON.stringify(await api.run(spawnRow(['recruit', 'regular', 'veteran', 'elite', 'gunner'], 5.4, 1.15))));
  await api.run(step(20));
  await frames(api, 2, 600000);
  await shot(api, 'row-5m');

  // ---- one man, close, three-quarter
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const e = r.spawn('mimic', p.position.x + f.x * 2.6 + f.z * 0.2, p.position.z + f.z * 2.6 - f.x * 0.2, { cls: 'veteran', tide: 3, idle: true, yaw: p.yaw + Math.PI + 0.8 });
    e.root.traverse((o) => { o.userData.__enemy = true; }); window.__m = e; e.aware = 0.2; })()`);
  await api.run(step(20));
  await api.run(`window.__radius.setLook(0.0, -0.12)`);
  await frames(api, 2, 600000);
  await shot(api, 'closeup-2m6');

  // ---- shouldered
  await api.run(`(() => { const ctx = window.__radius.ctx, p = ctx.player, m = window.__m;
    m.aware = 1; m.engaged = true; m.setState('engage'); m.lastVisT = ctx.elapsed; m.lastSeenPlayer = p.position.clone(); })()`);
  await api.run(step(30));
  await frames(api, 2, 600000);
  await shot(api, 'aiming-2m6');

  // ---- walking, mid-stride, side on
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx, p = ctx.player; ctx.enemies.removeAll(); p.update(0); const f = p.forward;
    const e = r.spawn('mimic', p.position.x + f.x * 4.6 + f.z * 0.6, p.position.z + f.z * 4.6 - f.x * 0.6, { cls: 'regular', tide: 3, idle: true, yaw: p.yaw + Math.PI * 0.5 });
    e.root.traverse((o) => { o.userData.__enemy = true; }); window.__w = e;
    for (let i = 0; i < 26; i++) { ctx.elapsed += 0.05; e.animate(0.05, 5, { speed: 2.4, headYaw: 0.5, aim: 0 }); }
    const q = r.spawn('mimic', p.position.x + f.x * 4.6 - f.z * 1.9, p.position.z + f.z * 4.6 + f.x * 1.9, { cls: 'veteran', tide: 3, idle: true, yaw: p.yaw + Math.PI * 0.5 });
    q.root.traverse((o) => { o.userData.__enemy = true; });
    for (let i = 0; i < 26; i++) { q.animate(0.05, 5, { speed: 0, crouch: 1, aim: 1, aimPitch: 0.02, headYaw: 0.2 }); } })()`);
  await api.run(`window.__radius.setLook(0.0, -0.06)`);
  await frames(api, 2, 600000);
  await shot(api, 'walk-and-crouch');

  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
