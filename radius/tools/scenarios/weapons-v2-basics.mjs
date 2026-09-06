// Fresh start with the PM (8+1, two ready mags, 16 loose): fire, staged reload, T-load, hip/ADS screenshots.
// node tools/smoke.mjs --scenario tools/scenarios/weapons-v2-basics.mjs --out .smoke/weapons-v2-basics --w 640 --h 360
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(11); })()`);
  await api.frames(12);
  const s0 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; return { id: w && w.id, slot: w && w.slot, chamber: w && w.chamber, mag: w && w.mag && w.mag.rounds, ready: c.inventory.readyMags ? c.inventory.readyMags.length : c.inventory.data.readyMags.length, mags: c.inventory.mags.map((m) => m.rounds), loose: c.inventory.count('9x18_fmj'), ammo: document.getElementById('ammo').innerText.replace(/\\s+/g, ' ') }; })()`);
  console.log('start', JSON.stringify(s0));
  await api.screenshot('pm-hip');
  await page.mouse.move(320, 180);
  // three shots
  for (let i = 0; i < 3; i++) { await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(3); }
  const s1 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; return { chamber: w.chamber, mag: w.mag.rounds, shots: c.state.data.stats.shots, dirt: +w.dirt.toFixed(3), barrel: +w.parts.barrel.toFixed(3), state: c.weapons.state }; })()`);
  console.log('after 3 shots', JSON.stringify(s1));
  // ADS
  await page.mouse.down({ button: 'right' }); await api.frames(10);
  await api.screenshot('pm-ads');
  const fov = await api.run(`(() => ({ fov: +window.__radius.ctx.camera.fov.toFixed(1), ads: +window.__radius.ctx.weapons.adsBlend.toFixed(2), spread: +window.__radius.ctx.weapons.spreadDeg.toFixed(2) }))()`);
  console.log('ads', JSON.stringify(fov));
  await page.mouse.up({ button: 'right' }); await api.frames(4);
  // empty the mag and hold open
  await api.run(`(() => { const w = window.__radius.ctx.weapons.current; w.mag.rounds = 0; w.mag.ammo = null; })()`);
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(3);
  const s2 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; return { chamber: w.chamber, mag: w.mag.rounds, ammo: document.getElementById('ammo').innerText.replace(/\\s+/g, ' ') }; })()`);
  console.log('empty', JSON.stringify(s2));
  await api.screenshot('pm-slidelock');
  // staged reload from a ready mag
  await api.key('KeyR', 60);
  await api.frames(6);
  const r1 = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { state: w.state, stage: w.stage, anim: window.__radius.ctx.hands.animName }; })()`);
  console.log('reload 1', JSON.stringify(r1));
  await api.screenshot('pm-magout');
  await api.frames(14);
  await api.screenshot('pm-magin');
  await api.frames(24);
  const r2 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons; const cur = w.current; return { state: w.state, stage: w.stage, chamber: cur.chamber, mag: cur.mag && cur.mag.rounds, invMags: c.inventory.mags.map((m) => [m.rounds, c.inventory.isReady(m.uid)]), ammo: document.getElementById('ammo').innerText.replace(/\\s+/g, ' ') }; })()`);
  console.log('reload done', JSON.stringify(r2));
  // T: loose rounds into the emptiest magazine
  await api.key('KeyT', 60);
  await api.frames(12);
  await api.screenshot('pm-load');
  const t1 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons; return { state: w.state, stage: w.stage, invMags: c.inventory.mags.map((m) => m.rounds), loose: c.inventory.count('9x18_fmj') }; })()`);
  console.log('loading', JSON.stringify(t1));
  await api.frames(120);
  const t2 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons; return { state: w.state, stage: w.stage, invMags: c.inventory.mags.map((m) => m.rounds), loose: c.inventory.count('9x18_fmj') }; })()`);
  console.log('loaded', JSON.stringify(t2));
  // melee slot: knife out, stab, back to the pistol
  await api.run(`window.__radius.press('slot4')`);
  await api.frames(20);
  const k1 = await api.run(`(() => { const w = window.__radius.ctx.weapons.current; return { id: w && w.id, melee: w && w.isMelee, anim: window.__radius.ctx.hands.animName }; })()`);
  console.log('knife', JSON.stringify(k1));
  await api.screenshot('knife');
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(6);
  await api.screenshot('knife-stab');
  await api.frames(10);
  await api.run(`window.__radius.press('slot3')`);
  await api.frames(20);
  const k2 = await api.run(`(() => { const w = window.__radius.ctx.weapons.current; return { id: w && w.id, melee: w && w.isMelee }; })()`);
  console.log('back to pm', JSON.stringify(k2));
  // quick stab with V while the pistol is out, then the pistol returns
  await api.run(`window.__radius.press('melee')`);
  await api.frames(8);
  await api.screenshot('quick-stab');
  await api.frames(30);
  const k3 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; return { id: w && w.id, melee: w && w.isMelee, state: c.weapons.state, stats: c.state.data.stats.melee }; })()`);
  console.log('after quick stab', JSON.stringify(k3));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
