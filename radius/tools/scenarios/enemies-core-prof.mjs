export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true; window.__radius.start();`);
  await api.wait(500);
  const r = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, T = ctx.THREE; const out = {}; const time = (k, fn) => { const t0 = performance.now(); fn(); out[k] = +(performance.now() - t0).toFixed(1); };
    for (const k of ['player','hands','weapons','probes','detector','enemies','population','anomalies','artifacts','director','scares','missions','loot','base','tide','structures','props','flora','debris','lighting','sky','world','vfx','post','audio','hud','music','ambience']) { try { time(k, () => ctx[k].update(0.02, ctx.elapsed)); } catch (e) { out[k] = 'ERR ' + e.message; } }
    time('render1', () => ctx.post.render()); time('render2', () => ctx.post.render()); time('render3', () => ctx.post.render());
    out.calls = ctx.renderer.info.render.calls; out.tris = ctx.renderer.info.render.triangles; out.programs = ctx.renderer.info.programs.length; out.frame = ctx.frame;
    const a = new T.Vector3(0, 7, 284), b = new T.Vector3(150, 8, -60);
    time('los300x10', () => { for (let i = 0; i < 10; i++) ctx.world.lineOfSight(a, b); });
    time('getHeightx100', () => { for (let i = 0; i < 100; i++) ctx.world.getHeight(i * 3, 100); });
    return out; })()`);
  console.log('prof', JSON.stringify(r));
}
