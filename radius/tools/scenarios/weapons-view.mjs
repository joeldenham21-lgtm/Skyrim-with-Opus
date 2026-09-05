// Viewmodel pass: hip and ADS for each gun, day and night, plus a reload frame. node tools/smoke.mjs --scenario tools/scenarios/weapons-view.mjs
export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(11); })()`);
  await api.frames(12);
  await api.screenshot('pm-hip');
  const info = await api.run(`(() => { const c = window.__radius.ctx; const h = c.hands; return { weapon: h.weapon && h.weapon.name, parts: Object.keys(h.parts), cur: c.weapons.current && { id: c.weapons.current.id, chamber: c.weapons.current.chamber, mags: c.weapons.current.mags }, calls: c.renderer.info.render.calls, tris: c.renderer.info.render.triangles }; })()`);
  console.log('hands', JSON.stringify(info));
  // ADS
  await page.mouse.move(480, 270);
  await page.mouse.down({ button: 'right' });
  await api.frames(14);
  await api.screenshot('pm-ads');
  await page.mouse.up({ button: 'right' });
  await api.frames(6);
  for (const id of ['akm', 'toz', 'mosin']) {
    await api.run(`window.__radius.giveWeapon('${id}')`);
  }
  const slots = ['slot2', 'slot3', 'slot4'];
  for (let i = 0; i < 3; i++) {
    await api.run(`window.__radius.press('${slots[i]}')`);
    await api.frames(24);
    await api.screenshot(['akm', 'toz', 'mosin'][i] + '-hip');
    await page.mouse.down({ button: 'right' });
    await api.frames(14);
    await api.screenshot(['akm', 'toz', 'mosin'][i] + '-ads');
    await page.mouse.up({ button: 'right' });
    await api.frames(6);
  }
  // night with torch, mosin in hand
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(10);
  await api.screenshot('mosin-night-torch');
  const st = await api.run(`window.__radius.stats()`);
  console.log('stats', JSON.stringify(st));
}
