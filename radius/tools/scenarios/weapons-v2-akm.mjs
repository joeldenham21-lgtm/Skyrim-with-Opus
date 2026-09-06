// AKM with a railed handguard, RK-1 grip, Kobra and PBS-1: rebuild, hip and ADS (reticle overlay), light at night,
// fire mode cycle, auto fire; then the SVD with a PSO-1 (scope vignette, 4x fov) and the jam path (dirt 1, bolt 20).
// node tools/smoke.mjs --scenario tools/scenarios/weapons-v2-akm.mjs --out .smoke/weapons-v2-akm --w 640 --h 360
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(11); })()`);
  await api.frames(8);
  const a0 = await api.run(`(() => {
    const r = window.__radius, c = r.ctx; const w = r.giveWeapon('akm');
    const res = ['rail_akhg', 'grip_rk1', 'opt_kobra', 'muz_pbs1'].map((id) => [id, c.inventory.attach(w, id)]);
    c.weapons.rebuild();
    return { uid: w.uid, attached: res, rails: w.rails, attachments: w.attachments, slot: c.inventory.equipment.primary === w.uid ? 'primary' : '?' };
  })()`);
  console.log('akm', JSON.stringify(a0));
  await api.run(`window.__radius.press('slot1')`);
  await api.frames(22);
  const a1 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; const e = c.weapons.effects; return { id: w && w.id, slot: w && w.slot, fireMode: w && w.fireMode, fx: e && { zoom: e.zoom, reticle: e.reticle, noise: +e.noise.toFixed(2), flash: e.flash, recoil: +e.recoil.toFixed(2), moa: +e.moa.toFixed(2), light: e.light }, ammo: document.getElementById('ammo').innerText.replace(/\\s+/g, ' ') }; })()`);
  console.log('akm equipped', JSON.stringify(a1));
  await api.screenshot('akm-hip');
  await page.mouse.move(320, 180);
  await page.mouse.down({ button: 'right' }); await api.frames(12);
  const a2 = await api.run(`(() => { const c = window.__radius.ctx; return { fov: +c.camera.fov.toFixed(1), scope: !document.getElementById('scope').classList.contains('hidden'), crosshairHidden: document.getElementById('crosshair').classList.contains('hidden') }; })()`);
  console.log('akm ads', JSON.stringify(a2));
  await api.screenshot('akm-ads-kobra');
  await page.mouse.up({ button: 'right' }); await api.frames(4);
  // fire mode: semi -> auto, then a burst
  await api.key('KeyB', 60); await api.frames(3);
  const m1 = await api.run(`(() => ({ mode: window.__radius.ctx.weapons.current.fireMode }))()`);
  console.log('mode', JSON.stringify(m1));
  await page.mouse.down(); await api.frames(3);
  await api.screenshot('akm-auto');
  await api.frames(8); await page.mouse.up(); await api.frames(3);
  const a3 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; return { shots: c.state.data.stats.shots, mag: w.mag.rounds, chamber: w.chamber, dirt: +w.dirt.toFixed(3), bolt: +w.parts.bolt.toFixed(3) }; })()`);
  console.log('after auto', JSON.stringify(a3));
  // no light mounted on this build: L should refuse politely; mount one and try again at 22:30
  await api.key('KeyL', 60); await api.frames(3);
  const l0 = await api.run(`(() => ({ light: window.__radius.ctx.weapons.current.lightOn, hint: document.getElementById('hint').textContent }))()`);
  console.log('light without mount', JSON.stringify(l0));
  await api.run(`(() => { const c = window.__radius.ctx, w = c.inventory.weaponByUid(${a0.uid}); c.inventory.detach(w, 'grip_rk1'); const ok = c.inventory.attach(w, 'light_klesch'); c.weapons.rebuild(); window.__radius.setTime(22.5); return ok; })()`);
  await api.frames(4);
  await api.key('KeyL', 60); await api.frames(8);
  const l1 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; const wl = c.lighting.weaponLight; return { light: w.lightOn, intensity: +wl.intensity.toFixed(1), pos: wl.position.toArray().map((v) => +v.toFixed(2)), status: document.getElementById('statusx').innerText }; })()`);
  console.log('light on', JSON.stringify(l1));
  await api.screenshot('akm-light-2230');
  await api.key('KeyL', 60); await api.frames(4);
  // SVD + PSO-1: scope vignette and 4x
  await api.run(`window.__radius.setTime(11)`);
  await api.run(`(() => { const r = window.__radius, c = r.ctx; const w = r.giveWeapon('svd'); const ok = c.inventory.attach(w, 'opt_pso1'); c.inventory.equipWeapon(w.uid, 'secondary'); c.weapons.onInventoryChanged(); return ok; })()`);
  await api.frames(3);
  await api.run(`window.__radius.press('slot2')`);
  await api.frames(22);
  const s0 = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; return { id: w && w.id, slot: w && w.slot, mag: w.mag && w.mag.rounds, chamber: w.chamber }; })()`);
  console.log('svd', JSON.stringify(s0));
  await api.screenshot('svd-hip');
  await page.mouse.down({ button: 'right' }); await api.frames(14);
  const s1 = await api.run(`(() => { const c = window.__radius.ctx; return { fov: +c.camera.fov.toFixed(1), scope: c.post.uniforms.uScope.value, zoom: c.weapons.zoom, lookScale: +c.weapons.lookScale.toFixed(2) }; })()`);
  console.log('svd ads', JSON.stringify(s1));
  await api.screenshot('svd-ads-pso1');
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(4);
  await api.screenshot('svd-shot');
  await page.mouse.up({ button: 'right' }); await api.frames(6);
  // jam: dirt 1 and a worn bolt -> ~0.28 per trigger pull
  await api.run(`(() => { const w = window.__radius.ctx.weapons.current; w.dirt = 1; w.parts.bolt = 20; })()`);
  let jammed = false;
  for (let i = 0; i < 30 && !jammed; i++) { await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(2); jammed = await api.run(`window.__radius.ctx.weapons.current.jammed`); }
  const j1 = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { jammed: w.current.jammed, state: w.state, ammo: document.getElementById('ammo').innerText.replace(/\\s+/g, ' ') }; })()`);
  console.log('jam', JSON.stringify(j1));
  await api.screenshot('svd-jammed');
  await api.key('KeyR', 60); await api.frames(8);
  await api.screenshot('svd-unjam');
  await api.frames(26);
  const j2 = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { jammed: w.current.jammed, state: w.state, stage: w.stage }; })()`);
  console.log('cleared', JSON.stringify(j2));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
