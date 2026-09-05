// Lighting check: the gate at 07:00 (game start), 12:00, 19:30 and 22:30 with the torch.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  for (const [name, h, torch] of [['gate-0700', 7.0, false], ['gate-1200', 12.0, false], ['gate-1930', 19.5, false], ['gate-2230', 22.5, true]]) {
    await api.run(`(() => { const r = window.__radius; r.teleport(0, 284); r.setLook(0, -0.05); r.setTime(${h}); r.ctx.state.data.flashlight.on = ${torch}; })()`);
    await api.frames(5);
    await api.screenshot(name);
  }
}
