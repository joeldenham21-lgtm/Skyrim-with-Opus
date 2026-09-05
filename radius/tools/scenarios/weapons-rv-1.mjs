// Weapons review pass 1: PM in hand at day, one shot at a mimic 10 m ahead (tracer, flash, damage, sound), ADS, night torch.
// node tools/smoke.mjs --out .smoke/weapons-rv-1 --scenario tools/scenarios/weapons-rv-1.mjs --w 640 --h 360
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const a = window.__radius.ctx.audio; const rec = window.__sfxrec = {}; const p = a.play.bind(a); a.play = (n, o) => { rec[n] = (rec[n] || 0) + 1; return p(n, o); }; })()`);
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(11); })()`);
  await api.frames(8);
  await api.screenshot('pm-hip-day');
  const eq = await api.run(`(() => { const c = window.__radius.ctx, w = c.weapons.current; return { id: w && w.id, state: w && w.state, chamber: w && w.chamber, mags: w && w.mags.slice(), fov: c.camera.fov, spread: +c.weapons.spreadDeg.toFixed(2), calls: c.renderer.info.render.calls, tris: c.renderer.info.render.triangles }; })()`);
  console.log('equipped', JSON.stringify(eq));
  const target = await api.run(`(() => { const r = window.__radius, c = r.ctx, p = c.player; const yaw = p.yaw; const e = r.spawn('mimic', p.position.x - Math.sin(yaw) * 10, p.position.z - Math.cos(yaw) * 10); const dx = e.position.x - p.eye.x, dz = e.position.z - p.eye.z, dy = (e.position.y + e.height * 0.55) - p.eye.y; r.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); return { hp: e.hp, y: +e.position.y.toFixed(2) }; })()`);
  console.log('mimic', JSON.stringify(target));
  await api.frames(2);
  await page.mouse.move(320, 180);
  await page.mouse.down();
  await api.frames(1);
  await api.screenshot('pm-shot');
  await page.mouse.up();
  await api.frames(2);
  const after = await api.run(`(() => { const c = window.__radius.ctx; const e = c.enemies.list.find((x) => x.type === 'mimic'); const w = c.weapons.current; return { hp: e && +e.hp.toFixed(1), shots: c.state.data.stats.shots, mag: w.mags[w.magIndex], chamber: w.chamber, dirt: +w.dirt.toFixed(3), director: c.director.state, ammo: document.getElementById('ammo').innerHTML, sfx: window.__sfxrec }; })()`);
  console.log('after shot', JSON.stringify(after));
  await page.mouse.down({ button: 'right' });
  await api.frames(6);
  const ads = await api.run(`(() => { const c = window.__radius.ctx; return { fov: +c.camera.fov.toFixed(1), ads: +c.weapons.adsBlend.toFixed(2), spread: +c.weapons.spreadDeg.toFixed(2), cross: document.getElementById('crosshair').className, sfx: window.__sfxrec }; })()`);
  console.log('ads', JSON.stringify(ads));
  await api.screenshot('pm-ads');
  await page.mouse.up({ button: 'right' });
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(6);
  await api.screenshot('pm-night-torch');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
