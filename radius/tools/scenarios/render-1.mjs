// Render pipeline check: the gate at 12:00 (cascaded shadows, sun shafts), Zarya at 17:00, the forest at 22:30
// with the torch (beam cone), dusk drizzle (storm 0.4), night vision. Few frames per step: SwiftShader is slow.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const shots = [
    ['gate-1200', 0, 284, 0.0, 12.0, ''],
    ['zarya-1700', -130, 60, 0.8, 17.0, ''],
    ['forest-2230-torch', 30, 130, 0.2, 22.5, 'r.ctx.state.data.flashlight.on = true;'],
    ['dusk-drizzle', 30, 130, 0.2, 19.3, 'r.ctx.state.data.flashlight.on = false; r.ctx.lighting.storm = 0.4;'],
    ['nvg-2230', 30, 130, 0.2, 22.5, 'r.ctx.lighting.storm = 0; r.ctx.post.setNvg(1);'],
  ];
  for (const [name, x, z, yaw, hour, extra] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.05); r.setTime(${hour}); ${extra} })()`);
    await api.frames(4);
    await api.screenshot(name);
    const info = await api.run(`(() => { const c = window.__radius.ctx; return { cascades: c.lighting.cascades, sunI: +c.lighting.sunIntensity.toFixed(2), rays: c.post.rays.enabled, raysCol: c.post.uniforms.uRaysColor.value.toArray().map((v) => +v.toFixed(3)), beams: c.lighting.beams.map((b) => +b.intensity.toFixed(4)), ao: !!c.post.ao, tier: c.post.st.tier }; })()`);
    console.log(name, JSON.stringify(info));
  }
  await api.run('window.__radius.ctx.post.setNvg(0)');
}
