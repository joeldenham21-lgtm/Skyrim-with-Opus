// Walk-through: stand at an izba doorway, walk in; the capsule must not be blocked by the doorway or the porch steps.
export default async function (page, api) {
  const frames = async (n) => { const f0 = await page.evaluate(() => window.__radius.ctx.frame); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 400000 }); };
  api.frames = frames;
  let shot = 0; api.screenshot = async (name) => { const p = `${api.outDir}/${String(shot++).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p, timeout: 240000 }); console.log("screenshot", p); return p; };
  await page.evaluate(() => window.__radius.start());
  await frames(4);
  const doors = await api.run(`window.__radius.ctx.structures.doors.map((d) => ({ x: d.x, z: d.z, ix: d.inside.x, iz: d.inside.z }))`);
  console.log('doors', doors.length);
  let ok = 0;
  for (let i = 0; i < Math.min(3, doors.length); i++) {
    const d = doors[i];
    const yaw = Math.atan2(-(d.ix - d.x), -(d.iz - d.z));
    await api.run(`(() => { const r = window.__radius; r.teleport(${d.x}, ${d.z}); r.setLook(${yaw}, -0.1); r.setTime(12); })()`);
    await api.frames(4);
    await api.screenshot(`door-${i}-outside`);
    await page.keyboard.down('KeyW');
    await api.frames(45);
    await page.keyboard.up('KeyW');
    await api.frames(3);
    const p = await api.run(`(() => { const p = window.__radius.ctx.player.position; return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), g: +window.__radius.ctx.world.getHeight(p.x, p.z).toFixed(2) }; })()`);
    const dist = Math.hypot(p.x - d.ix, p.z - d.iz);
    const inside = dist < 2.2 && p.y > p.g + 0.05;
    console.log(`door ${i}: walked to`, JSON.stringify(p), 'dist to inside point', dist.toFixed(2), inside ? 'INSIDE' : 'BLOCKED');
    if (inside) ok++;
    await api.screenshot(`door-${i}-inside`);
  }
  console.log('walk-through ok', ok, '/', Math.min(3, doors.length));
  // interior look
  const d = doors[0];
  await api.run(`(() => { const r = window.__radius; r.teleport(${d.ix}, ${d.iz}); r.setLook(${Math.atan2(-(d.ix - d.x), -(d.iz - d.z)) + Math.PI}, 0.05); })()`);
  await api.frames(5);
  await api.screenshot('izba-interior');
}
