// Weapons review pass 3: hip poses for the AKM, TOZ and Mosin by day, AKM ADS, a Mosin bolt mid-cycle frame.
// Holster/draw are stepped synchronously so the software renderer only pays for the frames we look at.
// node tools/smoke.mjs --out .smoke/weapons-rv-3 --scenario tools/scenarios/weapons-rv-3.mjs --w 640 --h 360
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(13); for (const id of ['akm', 'toz', 'mosin']) r.giveWeapon(id); })()`);
  await page.mouse.move(320, 180);
  await api.frames(2);
  for (const [i, id] of [[1, 'akm'], [2, 'toz'], [3, 'mosin']]) {
    await api.run(`(() => { const c = window.__radius.ctx, W = c.weapons; W.equipSlot(${i}); for (let k = 0; k < 16; k++) { c.hands.update(0.05); W.update(0.05); } })()`);
    await api.frames(3);
    await api.screenshot(id + '-hip');
    if (id === 'akm') {
      await page.mouse.down({ button: 'right' });
      await api.frames(5);
      await api.screenshot('akm-ads');
      await page.mouse.up({ button: 'right' });
      await api.frames(2);
    }
  }
  await api.run(`(() => { const c = window.__radius.ctx, W = c.weapons; W.fire(); for (let k = 0; k < 6; k++) { c.hands.update(0.05); W.update(0.05); } })()`);
  await api.frames(1);
  await api.screenshot('mosin-bolt');
  // night with the torch: the fill must make the rifle and gloves read without a lamp on them
  await api.run(`(() => { const r = window.__radius, c = r.ctx; r.setTime(22.5); c.state.data.flashlight.on = true; r.setLook(0.2, -0.12); for (let k = 0; k < 20; k++) c.lighting.update(0.05); })()`);
  await api.frames(4);
  await api.screenshot('mosin-night-torch');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
