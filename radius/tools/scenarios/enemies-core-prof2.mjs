export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true; window.__radius.start();`);
  const t0 = Date.now();
  let f0 = 0;
  for (let i = 0; i < 6; i++) { await api.wait(15000); const f = await api.run(`window.__radius.ctx.frame`); console.log('t', ((Date.now() - t0) / 1000).toFixed(0), 'frame', f, 'fps', ((f - f0) / 15).toFixed(2)); f0 = f; }
}
