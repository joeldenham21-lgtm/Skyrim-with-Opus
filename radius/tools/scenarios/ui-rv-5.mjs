// Review pass: the map sheet alone at production size.
export default async function (page, api) {
  const R = 'window.__radius';
  await api.run(`${R}.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = ${R}; r.ctx.missions.accept(r.ctx.missions.available()[1].id); r.ctx.panels.open('map'); })()`); await api.frames(2);
  await api.screenshot('map');
  await api.key('Escape'); await api.frames(1);
  console.log('closed:', await api.run(`JSON.stringify({ open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled })`));
}
