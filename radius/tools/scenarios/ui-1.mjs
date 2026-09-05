// UI walkthrough: title, settings, pause, every base panel, Esc contract, death report.
// node tools/smoke.mjs --out .smoke/ui-1 --scenario tools/scenarios/ui-1.mjs --w 1280 --h 720
export default async function (page, api) {
  const R = 'window.__radius';
  await api.frames(8);
  await api.screenshot('title');
  await api.run(`${R}.ctx.menus.show('settings')`); await api.frames(3);
  await api.screenshot('settings');
  await api.key('ArrowDown'); await api.key('ArrowRight'); await api.key('ArrowRight'); await api.frames(2);
  const fov = await api.run(`${R}.ctx.state.data.settings.fov + '/' + ${R}.ctx.camera.fov`);
  console.log('fov after two steps:', fov);
  await api.key('Escape'); await api.frames(2);
  console.log('menu after Esc from settings:', await api.run(`${R}.ctx.menus.current`));

  await api.start();
  await api.run(`(() => { const r = ${R}; r.give('art_pearl', 2); r.give('art_ember'); r.give('medkit', 2); r.give('stim'); r.give('battery', 2); r.give('cleankit'); r.ctx.state.data.money = 3140; r.ctx.state.data.hp = 62; r.ctx.state.data.bleeding = true; r.ctx.state.data.flashlight.battery = 41; r.ctx.inventory.addAmmo('7.62x39', 37); const w = r.ctx.inventory.weapons[0]; w.dirt = 0.34; w.mags[2] = 5; r.ctx.state.data.stats.kills = 7; r.ctx.state.data.stats.shots = 213; r.ctx.state.data.stats.distance = 4180; })()`);
  await api.frames(3);
  await api.run(`${R}.ctx.game.pause()`); await api.frames(3);
  await api.screenshot('pause');
  await api.key('ArrowDown'); await api.key('ArrowDown'); await api.key('Enter'); await api.frames(2);
  await api.screenshot('pause-confirm');
  await api.run(`${R}.ctx.game.resume()`); await api.frames(3);

  for (const name of ['inventory', 'terminal', 'workbench', 'supply', 'storage', 'bed', 'map']) {
    await api.run(`${R}.ctx.panels.open('${name}')`); await api.frames(3);
    const st = await api.run(`JSON.stringify({ open: ${R}.ctx.panels.isOpen, cur: ${R}.ctx.panels.current, enabled: ${R}.ctx.input.enabled })`);
    console.log(name, 'open:', st);
    await api.screenshot(name);
    if (name === 'terminal') { await api.key('ArrowRight'); await api.frames(2); await api.screenshot('terminal-sell'); await api.key('ArrowRight'); await api.frames(2); await api.screenshot('terminal-status'); }
    if (name === 'supply') { await api.key('ArrowRight'); await api.frames(2); await api.screenshot('supply-sell'); }
    if (name === 'inventory') {
      await api.run(`(() => { const b = [...document.querySelectorAll('#panels [data-a]')].find((x) => x.dataset.a === 'use:medkit'); b && b.click(); })()`);
      await api.frames(2); await api.screenshot('inventory-after-medkit');
    }
    await api.key('Escape'); await api.frames(3);
    const after = await api.run(`JSON.stringify({ open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled, mode: ${R}.ctx.mode })`);
    console.log(name, 'after Esc:', after);
  }
  // the medkit queue should be ticking now that the sheet is closed
  await api.wait(2500);
  console.log('hp after medkit ticks:', await api.run(`${R}.ctx.state.data.hp`));

  await api.run(`${R}.ctx.player.die({ kind: 'bullet' })`);
  await api.wait(5200); await api.frames(2);
  await api.screenshot('death-typing');
  await api.wait(14000); await api.frames(2);
  await api.screenshot('death-final');
  console.log('death menu:', await api.run(`${R}.ctx.menus.current + ' / ' + ${R}.ctx.mode`));
}
