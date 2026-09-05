// timing diagnostics: frame rate on the title, then after start with the game modules stubbed, then re-enabled
export default async function (page, api) {
  const rate = async (n, label) => { const t0 = Date.now(); const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 120000 }).catch(() => {}); const f1 = await api.run('window.__radius.ctx.frame'); console.log(label, 'frames', f1 - f0, 'in', Date.now() - t0, 'ms'); };
  await rate(5, 'title');
  await api.run(`(() => { const c = window.__radius.ctx; c.__lootPop = c.loot.populate; c.loot.populate = () => {}; c.__scaresUpd = c.scares.update; c.scares.update = () => {}; c.__misUpd = c.missions.update; c.missions.update = () => {}; })()`);
  await api.run('window.__radius.start()');
  await rate(3, 'started (game modules stubbed)');
  console.log(await api.run('JSON.stringify(window.__radius.stats())'));
  await api.run(`(() => { const c = window.__radius.ctx; c.debug.noEnemies = true; c.enemies.removeAll(); })()`);
  await rate(3, 'no enemies');
  await api.run(`(() => { const c = window.__radius.ctx; c.loot.populate = c.__lootPop; c.loot.populate(); })()`);
  await rate(3, 'with loot');
  await api.run(`(() => { const c = window.__radius.ctx; c.scares.update = c.__scaresUpd; c.missions.update = c.__misUpd; })()`);
  await rate(3, 'with scares+missions');
  console.log(await api.run('JSON.stringify(window.__radius.stats())'));
}
