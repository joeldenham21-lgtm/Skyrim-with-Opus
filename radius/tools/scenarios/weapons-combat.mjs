// Combat pass: AKM burst at a spawned mimic, staged reload, T loading, forced jam and clear.
// node tools/smoke.mjs --scenario tools/scenarios/weapons-combat.mjs --out .smoke/weapons-combat
export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setLook(0.2, 0); r.setTime(11); r.ctx.debug.noEnemies = true; })()`);
  await api.frames(4);
  // a mimic 10 m ahead along the look direction, then aim at its chest
  const target = await api.run(`(() => {
    const r = window.__radius, c = r.ctx, p = c.player;
    const yaw = p.yaw; const x = p.position.x - Math.sin(yaw) * 10, z = p.position.z - Math.cos(yaw) * 10;
    const e = r.spawn('mimic', x, z);
    const dx = e.position.x - p.eye.x, dz = e.position.z - p.eye.z, dy = (e.position.y + e.height * 0.55) - p.eye.y;
    const ny = Math.atan2(-dx, -dz), np = Math.atan2(dy, Math.hypot(dx, dz));
    r.setLook(ny, np);
    return { hp: e.hp, pos: [e.position.x, e.position.y, e.position.z], yaw: ny, pitch: np };
  })()`);
  console.log('mimic', JSON.stringify(target));
  await api.run(`window.__radius.giveWeapon('akm')`);
  await api.frames(2);
  await api.run(`window.__radius.press('slot2')`);
  await api.frames(24);
  const eq = await api.run(`(() => { const w = window.__radius.ctx.weapons.current; return { id: w && w.id, state: w && w.state, chamber: w && w.chamber, mags: w && w.mags.slice() }; })()`);
  console.log('equipped', JSON.stringify(eq));
  await page.mouse.move(480, 270);
  await page.mouse.down();
  await api.frames(3);
  await api.screenshot('akm-burst');
  await api.frames(9);
  await page.mouse.up();
  await api.frames(3);
  const after = await api.run(`(() => { const c = window.__radius.ctx; const e = c.enemies.list.find((x) => x.type === 'mimic'); const w = c.weapons.current; return { hp: e && e.hp, alive: e && e.alive, shots: c.state.data.stats.shots, mag: w.mags[w.magIndex], chamber: w.chamber, dirt: +w.dirt.toFixed(3), director: c.director.state }; })()`);
  console.log('after burst', JSON.stringify(after));
  await api.screenshot('akm-after');
  // staged reload
  await api.key('KeyR', 60);
  await api.frames(5);
  await api.screenshot('reload-magout');
  const st1 = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { state: w.state, stage: w.stage, anim: window.__radius.ctx.hands.animName }; })()`);
  console.log('reload 1', JSON.stringify(st1));
  await api.frames(12);
  await api.screenshot('reload-magin');
  await api.frames(20);
  const st2 = await api.run(`(() => { const w = window.__radius.ctx.weapons; const c = w.current; return { state: w.state, stage: w.stage, magIndex: c.magIndex, mags: c.mags.slice(), chamber: c.chamber, ammoHtml: document.getElementById('ammo').innerHTML }; })()`);
  console.log('reload done', JSON.stringify(st2));
  // T loading: empty a magazine, add loose rounds, load while standing still
  await api.run(`(() => { const c = window.__radius.ctx; const w = c.weapons.current; w.mags[0] = 3; c.inventory.addAmmo('7.62x39', 12); })()`);
  await api.key('KeyT', 60);
  await api.frames(14);
  await api.screenshot('load-rounds');
  const st3 = await api.run(`(() => { const w = window.__radius.ctx.weapons; const c = w.current; return { state: w.state, stage: w.stage, mags: c.mags.slice(), loose: window.__radius.ctx.inventory.ammoCount('7.62x39') }; })()`);
  console.log('loading', JSON.stringify(st3));
  await api.frames(60);
  const st4 = await api.run(`(() => { const w = window.__radius.ctx.weapons; const c = w.current; return { state: w.state, stage: w.stage, mags: c.mags.slice(), loose: window.__radius.ctx.inventory.ammoCount('7.62x39') }; })()`);
  console.log('loaded', JSON.stringify(st4));
  // jam: fouled to 1.0 -> 18 % per trigger pull
  await api.run(`(() => { const c = window.__radius.ctx; const w = c.weapons.current; w.dirt = 1; })()`);
  let jammed = false;
  for (let i = 0; i < 40 && !jammed; i++) {
    await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(1);
    jammed = await api.run(`window.__radius.ctx.weapons.current.jammed`);
  }
  const jm = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { jammed: w.current.jammed, state: w.state, html: document.getElementById('ammo').innerHTML }; })()`);
  console.log('jam', JSON.stringify(jm));
  await api.screenshot('jammed');
  await api.key('KeyR', 60);
  await api.frames(8);
  await api.screenshot('unjam');
  await api.frames(24);
  const cl = await api.run(`(() => { const w = window.__radius.ctx.weapons; return { jammed: w.current.jammed, state: w.state, stage: w.stage }; })()`);
  console.log('cleared', JSON.stringify(cl));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
