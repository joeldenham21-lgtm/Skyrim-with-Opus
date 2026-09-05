// Frame-time diagnosis: how fast does the loop run on the title screen vs after start, and which subsystems cost what.
export default async function (page, api) {
  const f0 = await api.run('window.__radius.ctx.frame');
  await api.wait(8000);
  const f1 = await api.run('window.__radius.ctx.frame');
  console.log('title frames in 8 s:', f1 - f0);
  await api.run('window.__radius.start()');
  await api.wait(500);
  const f2 = await api.run('window.__radius.ctx.frame');
  await api.wait(15000);
  const f3 = await api.run('window.__radius.ctx.frame');
  console.log('playing frames in 15 s:', f3 - f2, 'error', await api.run('window.__radius.ctx._errorLogged'));
  const prof = await api.run(`(() => {
    const c = window.__radius.ctx; const out = {};
    const time = (k, fn) => { const t = performance.now(); try { fn(); } catch (e) { out[k + '_err'] = String(e); } out[k] = +(performance.now() - t).toFixed(1); };
    time('player', () => c.player.update(0.016));
    time('hands', () => c.hands.update(0.016));
    time('weapons', () => c.weapons.update(0.016));
    time('enemies', () => c.enemies.update(0.016));
    time('population', () => c.population.update(0.016));
    time('flora', () => c.flora.update(0.016, c.elapsed));
    time('structures', () => c.structures.update(0.016, c.elapsed));
    time('props', () => c.props.update(0.016, c.elapsed));
    time('debris', () => c.debris.update(0.016, c.elapsed));
    time('loot', () => c.loot.update(0.016));
    time('missions', () => c.missions.update(0.016));
    time('scares', () => c.scares.update(0.016));
    time('anomalies', () => c.anomalies.update(0.016));
    time('hud', () => c.hud.update(0.016));
    time('render', () => c.post.render());
    time('render2', () => c.post.render());
    out.calls = c.renderer.info.render.calls; out.tris = c.renderer.info.render.triangles;
    return out;
  })()`);
  console.log('profile ms', JSON.stringify(prof));
}
