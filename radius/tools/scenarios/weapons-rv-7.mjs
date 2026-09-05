// Weapons review pass 7: the PM at night under the torch (viewmodel fill), then the same at day for comparison.
// node tools/smoke.mjs --out .smoke/weapons-rv-7 --scenario tools/scenarios/weapons-rv-7.mjs --w 640 --h 360
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius, c = r.ctx; r.god(); r.teleport(30, 130); r.setLook(0.2, -0.12); r.setTime(22.5); c.state.data.flashlight.on = true; for (let k = 0; k < 20; k++) { c.hands.update(0.05); c.weapons.update(0.05); c.lighting.update(0.05); } })()`);
  await api.frames(5);
  await api.screenshot('pm-night-torch');
  await api.run(`(() => { const r = window.__radius, c = r.ctx; r.setTime(11); c.state.data.flashlight.on = false; for (let k = 0; k < 20; k++) c.lighting.update(0.05); })()`);
  await api.frames(4);
  await api.screenshot('pm-day');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
