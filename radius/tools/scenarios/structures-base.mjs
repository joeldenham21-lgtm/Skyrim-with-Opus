// Vanno bunker: outside approach (day and night), then inside looking at each station.
export default async function (page, api) {
  const frames = async (n) => { const f0 = await page.evaluate(() => window.__radius.ctx.frame); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 400000 }); };
  api.frames = frames;
  let shot = 0; api.screenshot = async (name) => { const p = `${api.outDir}/${String(shot++).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p, timeout: 240000 }); console.log("screenshot", p); return p; };
  await page.evaluate(() => window.__radius.start());
  await frames(4);
  const yawTo = (px, pz, tx, tz) => Math.atan2(-(tx - px), -(tz - pz));
  // approach from the road at dusk, torch off: the door lamp should read as the way home
  await api.run(`(() => { const r = window.__radius; r.teleport(0, 276); r.setLook(Math.PI, -0.02); r.setTime(12); })()`);
  await api.frames(6); await api.screenshot('base-approach-day');
  await api.run(`(() => { const r = window.__radius; r.teleport(2, 284); r.setLook(Math.PI + 0.1, 0.02); r.setTime(20.6); })()`);
  await api.frames(6); await api.screenshot('base-approach-dusk');
  await api.run(`(() => { const r = window.__radius; r.teleport(-9, 296); r.setLook(-Math.PI / 2 - 0.4, 0.05); r.setTime(12); })()`);
  await api.frames(6); await api.screenshot('base-side');
  // inside: the load position must be on the floor, not in a wall
  await api.run(`(() => { const r = window.__radius; r.teleport(0, 302, 7.3); r.setLook(0, 0); r.setTime(12); })()`);
  await api.frames(8);
  const pos = await api.run(`(() => { const p = window.__radius.ctx.player.position; return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), inBase: window.__radius.ctx.player.inBase }; })()`);
  console.log('inside position', JSON.stringify(pos));
  await api.screenshot('base-in-north-door');
  const looks = [
    ['terminal', -3.7, 300.6], ['workbench', 4.0, 300.9], ['supply', 3.5, 303.7], ['cot', -3.4, 304.0], ['locker', -4.2, 299.3], ['clock', 2.3, 298.6],
  ];
  for (const [name, tx, tz] of looks) {
    const yaw = yawTo(0, 302, tx, tz);
    await api.run(`(() => { const r = window.__radius; r.teleport(0, 302, 7.3); r.setLook(${yaw}, ${name === 'clock' ? 0.25 : -0.12}); })()`);
    await api.frames(5); await api.screenshot('base-' + name);
    const prompt = await api.run(`document.getElementById('prompt').textContent`);
    console.log('prompt near', name, JSON.stringify(prompt));
  }
  // walk to the terminal and check the prompt appears
  await api.run(`(() => { const r = window.__radius; r.teleport(-2.6, 300.6, 7.3); r.setLook(${yawTo(-2.6, 300.6, -3.7, 300.6)}, -0.15); })()`);
  await api.frames(5);
  console.log('terminal prompt', JSON.stringify(await api.run(`document.getElementById('prompt').textContent`)));
  // door from inside
  await api.run(`(() => { const r = window.__radius; r.teleport(0, 297.6, 7.3); r.setLook(0, 0); })()`);
  await api.frames(5); await api.screenshot('base-door-inside');
  console.log('door prompt inside', JSON.stringify(await api.run(`document.getElementById('prompt').textContent`)));
  // night inside with the failing tube
  await api.run(`(() => { const r = window.__radius; r.teleport(0.5, 303.5, 7.3); r.setLook(0.3, 0.15); r.setTime(23); })()`);
  await api.frames(6); await api.screenshot('base-night-tubes');
  const stats = await api.run(`window.__radius.stats()`);
  console.log('stats inside', JSON.stringify(stats));
}
