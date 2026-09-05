// Review pass at production size: title, terminal, map, supply, finished death report.
// node tools/smoke.mjs --out .smoke/ui-rv-4 --scenario tools/scenarios/ui-rv-4.mjs --w 1280 --h 720
export default async function (page, api) {
  const R = 'window.__radius';
  await api.run(`${R}.ctx.debug.noEnemies = true`);
  await api.frames(2);
  await api.screenshot('title');
  await api.start();
  await api.run(`(() => { const r = ${R}; r.give('art_pearl'); r.give('medkit'); r.ctx.state.data.money = 5000; r.ctx.missions.accept(r.ctx.missions.available()[0].id); })()`);
  await api.run(`${R}.ctx.panels.open('terminal')`); await api.frames(2);
  await api.screenshot('terminal');
  await api.key('Escape'); await api.frames(1);
  await api.run(`${R}.ctx.panels.open('map')`); await api.frames(2);
  await api.screenshot('map');
  await api.key('Escape'); await api.frames(1);
  await api.run(`${R}.ctx.panels.open('supply')`); await api.frames(2);
  await api.screenshot('supply');
  await api.key('Escape'); await api.frames(1);
  await api.run(`${R}.ctx.player.die({ kind: 'slash' })`);
  await api.wait(3600); await api.frames(1);
  await api.key('Enter'); await api.frames(1);
  await api.screenshot('death-final');
  console.log('death:', await api.run(`JSON.stringify({ menu: ${R}.ctx.menus.current, mode: ${R}.ctx.mode, focused: document.activeElement && document.activeElement.dataset.a })`));
}
