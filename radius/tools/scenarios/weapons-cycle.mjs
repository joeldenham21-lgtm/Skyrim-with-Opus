// Break-open shotgun and bolt-action cycle pass, plus the empty-gun click and sprint lowering.
// node tools/smoke.mjs --scenario tools/scenarios/weapons-cycle.mjs --out .smoke/weapons-cycle
export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setLook(0.2, -0.1); r.setTime(15); r.ctx.debug.noEnemies = true; })()`);
  await api.frames(4);
  await api.run(`window.__radius.giveWeapon('toz'); window.__radius.giveWeapon('mosin'); window.__radius.ctx.inventory.addAmmo('12ga', 6); window.__radius.ctx.inventory.addAmmo('7.62x54', 10);`);
  await api.frames(2);
  // TOZ: load it, fire both barrels, break open, insert shells, close
  await api.run(`window.__radius.press('slot2')`);
  await api.frames(22);
  await page.mouse.move(480, 270);
  const t0 = await api.run(`(() => { const w = window.__radius.ctx.weapons.current; return { id: w.id, mags: w.mags.slice(), chamber: w.chamber }; })()`);
  console.log('toz start', JSON.stringify(t0));
  await api.key('KeyR', 60);          // starts empty: break open + insert 2 shells
  await api.frames(8);
  await api.screenshot('toz-break-open');
  await api.frames(10);
  await api.screenshot('toz-shell');
  await api.frames(30);
  const t1 = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { mags: w.current.mags.slice(), state: w.state, loose: window.__radius.ctx.inventory.ammoCount('12ga') }; })()`);
  console.log('toz loaded', JSON.stringify(t1));
  await page.mouse.down(); await api.frames(2); await page.mouse.up();
  await api.screenshot('toz-shot');
  await api.frames(8);
  await page.mouse.down(); await api.frames(2); await page.mouse.up();
  await api.frames(6);
  await page.mouse.down(); await api.frames(2); await page.mouse.up();   // dry click
  const t2 = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { mags: w.current.mags.slice(), state: w.state, shots: window.__radius.ctx.state.data.stats.shots }; })()`);
  console.log('toz fired', JSON.stringify(t2));
  // Mosin: fire, bolt cycle, screenshot mid-cycle; then reload with a clip
  await api.run(`window.__radius.press('slot3')`);
  await api.frames(22);
  await page.mouse.down(); await api.frames(2); await page.mouse.up();
  await api.frames(4);
  await api.screenshot('mosin-bolt-lift');
  await api.frames(5);
  await api.screenshot('mosin-bolt-back');
  await api.frames(16);
  const m1 = await api.run(`(() => { const w = window.__radius.ctx.weapons; const c = w.current; return { state: w.state, chamber: c.chamber, mags: c.mags.slice() }; })()`);
  console.log('mosin cycled', JSON.stringify(m1));
  await api.run(`(() => { const c = window.__radius.ctx.weapons.current; c.mags[0] = 1; c.chamber = 0; })()`);
  await api.key('KeyR', 60);
  await api.frames(10);
  await api.screenshot('mosin-clip');
  await api.frames(30);
  const m2 = await api.run(`(() => { const w = window.__radius.ctx.weapons; const c = w.current; return { state: w.state, chamber: c.chamber, magIndex: c.magIndex, mags: c.mags.slice() }; })()`);
  console.log('mosin reloaded', JSON.stringify(m2));
  // sprint lowers the gun
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  await api.frames(14);
  await api.screenshot('mosin-sprint');
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  await api.frames(4);
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
