// "I can't see the enemies shooting me that are 100ft away. It looks like 240p."
// Put an armed mimic at 30 m (about 100 ft) on open ground in clear daylight, face it, and take the
// shot the player would be looking at. Also reports what the render chain is actually doing —
// device ratio, the cap the quality tier applies, the governor's current render scale, and the
// resulting backbuffer — because a soft image is either too few pixels or too little contrast, and
// the numbers say which.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  await api.run(`window.__radius.god(true); window.__radius.setTime(11); window.__radius.teleport(60, 210);`);
  await api.frames(10);

  const placed = await api.run(`(() => {
    const ctx = window.__radius.ctx, r = window.__radius;
    const p = ctx.player.position;
    // due north of the player, on whatever ground is there
    const ex = p.x, ez = p.z - 30;
    const e = r.spawn('mimic', ex, ez, { cls: 'regular' });
    if (e) { e.aware = true; e.setEngaged?.(true); }
    r.setLook(Math.atan2(-(ex - p.x), -(ez - p.z)), 0);
    const d = e ? Math.hypot(e.position.x - p.x, e.position.z - p.z) : -1;
    return { spawned: !!e, weapon: e?.weapon || null, cls: e?.cls || null, metres: +d.toFixed(1), feet: +(d * 3.281).toFixed(0) };
  })()`);
  console.log('TARGET ' + JSON.stringify(placed));
  await api.frames(40);

  const chain = await api.run(`(() => {
    const ctx = window.__radius.ctx, s = ctx.state.data.settings;
    const sz = ctx.renderer.getSize(new ctx.THREE.Vector2());
    const dr = ctx.renderer.getDrawingBufferSize ? ctx.renderer.getDrawingBufferSize(new ctx.THREE.Vector2()) : null;
    return {
      quality: s.quality, resolutionScale: s.resolutionScale, dynamicResolution: s.dynamicResolution,
      devicePixelRatio: window.devicePixelRatio, rendererPixelRatio: ctx.renderer.getPixelRatio(),
      cssSize: [sz.x, sz.y], drawingBuffer: dr ? [dr.x, dr.y] : null,
      renderScale: ctx.perf?.scale ?? null, targetFps: s.targetFps ?? null,
      fog: ctx.scene.fog ? { near: ctx.scene.fog.near, far: ctx.scene.fog.far, density: ctx.scene.fog.density } : null,
    };
  })()`);
  console.log('RENDER_CHAIN ' + JSON.stringify(chain, null, 1));
  await api.screenshot('enemy-at-30m');

  // and the same enemy at 10 m, as a reference for how much is lost over the extra 20
  await api.run(`(() => {
    const ctx = window.__radius.ctx, r = window.__radius;
    for (const e of ctx.enemies.list) if (e.alive) { const p = ctx.player.position; e.position.set(p.x, e.position.y, p.z - 10); }
  })()`);
  await api.frames(20);
  await api.screenshot('enemy-at-10m');
  console.log('SUMMARY ' + JSON.stringify(await api.run(`window.__radius.stats()`)));
}
