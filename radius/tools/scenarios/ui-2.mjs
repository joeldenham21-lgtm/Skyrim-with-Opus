// Pause summary, map, storage, bed (with sleep); Esc contract. Single-frame waits so it runs on a loaded machine.
// node tools/smoke.mjs --out .smoke/ui-2 --scenario tools/scenarios/ui-2.mjs --w 960 --h 540
export default async function (page, api) {
  const R = 'window.__radius';
  await api.run(`${R}.ctx.debug.noEnemies = true; ${R}.start()`); await api.frames(1);
  await api.run(`(() => { const r = ${R}; r.give('art_pearl', 2); r.give('medkit'); r.give('battery', 2); r.ctx.state.data.money = 3140; r.ctx.state.data.hp = 62; r.ctx.state.data.bleeding = true; r.ctx.inventory.addAmmo('7.62x39', 37); r.setTime(19.7); r.teleport(-40, 120); r.setLook(0.7, 0); })()`);
  await api.frames(1);
  await api.run(`${R}.ctx.game.pause()`); await api.frames(1);
  await api.screenshot('pause');
  await api.run(`${R}.ctx.game.resume()`); await api.frames(1);

  await api.run(`${R}.ctx.panels.open('map')`); await api.frames(1);
  await api.screenshot('map');
  await api.key('Escape'); await api.frames(2);
  console.log('after map Esc:', await api.run(`JSON.stringify({ open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled })`));

  await api.run(`${R}.ctx.panels.open('storage')`); await api.frames(1);
  await api.run(`(() => { const b = [...document.querySelectorAll('#panels [data-a]')].find((x) => x.dataset.a === 'in:ammo:7.62x39'); b && b.click(); })()`);
  await api.wait(300); await api.screenshot('storage');
  console.log('storage ammo:', await api.run(`JSON.stringify(${R}.ctx.state.data.storage.ammo)`));
  await api.key('Escape'); await api.frames(1);

  await api.run(`${R}.ctx.panels.open('bed')`); await api.frames(1);
  await api.screenshot('bed');
  await api.run(`(() => { const r = ${R}; r.ctx.state.data.day = 3; r.setTime(21.2); r.ctx.panels.close(); r.ctx.panels.open('bed'); })()`); await api.wait(300);
  await api.screenshot('bed-tide-first');
  await api.run(`(() => { const r = ${R}; r.ctx.state.data.day = 1; r.setTime(21.2); r.ctx.panels.close(); r.ctx.panels.open('bed'); })()`); await api.wait(300);
  await api.run(`(() => { const b = [...document.querySelectorAll('#panels [data-a]')].find((x) => x.dataset.a === 'sleep'); b && b.click(); })()`);
  await api.wait(1700); await api.frames(1);
  console.log('after sleep:', await api.run(`JSON.stringify({ day: ${R}.ctx.state.data.day, hour: +${R}.ctx.state.data.hour.toFixed(2), open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled, hp: ${R}.ctx.state.data.hp, save: ${R}.ctx.state.hasSave() })`));
  await api.wait(1500); await api.frames(1);
  await api.screenshot('after-sleep');
}
