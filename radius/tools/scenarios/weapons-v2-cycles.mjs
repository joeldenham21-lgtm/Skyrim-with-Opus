// TOZ break-open, Remington pump + tube loading, Mosin clip, PKM belt; then a mimic: shoot it (armour path) and stab it.
// node tools/smoke.mjs --scenario tools/scenarios/weapons-v2-cycles.mjs --out .smoke/weapons-v2-cycles --w 640 --h 360
const cur = `(() => { const c = window.__radius.ctx, w = c.weapons; const x = w.current; return { id: x && x.id, state: w.state, stage: w.stage, chamber: x && x.chamber, tube: x && x.tube && x.tube.slice(), mag: x && x.mag && x.mag.rounds, anim: c.hands.animName }; })()`;
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(13); })()`);
  await api.frames(8);
  await page.mouse.move(320, 180);
  // ---- TOZ-34: two shells, fire both, dry, break open and reload ----
  await api.run(`(() => { const r = window.__radius, c = r.ctx; const w = r.giveWeapon('toz'); c.inventory.equipWeapon(w.uid, 'primary'); c.inventory.add('12_buck', 6); c.weapons.onInventoryChanged(); })()`);
  await api.run(`window.__radius.press('slot1')`); await api.frames(22);
  console.log('toz', JSON.stringify(await api.run(cur)));
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(8);
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(8);
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(3);   // dry
  console.log('toz fired', JSON.stringify(await api.run(cur)));
  await api.key('KeyR', 60); await api.frames(8);
  await api.screenshot('toz-break-open');
  await api.frames(10);
  await api.screenshot('toz-shell');
  await api.frames(36);
  console.log('toz reloaded', JSON.stringify(await api.run(cur)));
  // ---- Remington 870: fire, pump, load shells one by one ----
  await api.run(`(() => { const r = window.__radius, c = r.ctx; const w = r.giveWeapon('rem870'); c.inventory.equipWeapon(w.uid, 'secondary'); c.weapons.onInventoryChanged(); })()`);
  await api.run(`window.__radius.press('slot2')`); await api.frames(22);
  console.log('870', JSON.stringify(await api.run(cur)));
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(5);
  await api.screenshot('870-pump');
  await api.frames(12);
  console.log('870 pumped', JSON.stringify(await api.run(cur)));
  await api.run(`(() => { const x = window.__radius.ctx.weapons.current; x.tube.length = 2; })()`);
  await api.key('KeyR', 60); await api.frames(12);
  await api.screenshot('870-tube-load');
  await api.frames(60);
  console.log('870 loaded', JSON.stringify(await api.run(cur)));
  // ---- Mosin: fire, bolt, then a clip on an empty magazine ----
  await api.run(`(() => { const r = window.__radius, c = r.ctx; const w = r.giveWeapon('mosin'); c.inventory.equipWeapon(w.uid, 'primary'); c.inventory.addMag({ uid: 90001, id: 'mag_mosin5', cal: '7.62x54', ammo: '754_fmj', rounds: 5 }); c.inventory.add('754_fmj', 4); c.weapons.onInventoryChanged(); })()`);
  await api.run(`window.__radius.press('slot1')`); await api.frames(22);
  console.log('mosin', JSON.stringify(await api.run(cur)));
  await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(5);
  await api.screenshot('mosin-bolt');
  await api.frames(24);
  console.log('mosin cycled', JSON.stringify(await api.run(cur)));
  await api.run(`(() => { const x = window.__radius.ctx.weapons.current; x.tube.length = 0; x.chamber = null; })()`);
  await api.key('KeyR', 60); await api.frames(14);
  await api.screenshot('mosin-clip');
  await api.frames(30);
  const mo = await api.run(cur);
  console.log('mosin clipped', JSON.stringify(mo), 'clips', JSON.stringify(await api.run(`window.__radius.ctx.inventory.mags.filter((m) => m.id === 'mag_mosin5').map((m) => m.rounds)`)));
  // ---- PKM: belt box swap ----
  await api.run(`(() => { const r = window.__radius, c = r.ctx; const w = r.giveWeapon('pkm'); c.inventory.equipWeapon(w.uid, 'secondary'); c.inventory.addMag({ uid: 90002, id: 'mag_pkm100', cal: '7.62x54', ammo: '754_fmj', rounds: 100 }); c.weapons.onInventoryChanged(); })()`);
  await api.run(`window.__radius.press('slot2')`); await api.frames(22);
  console.log('pkm', JSON.stringify(await api.run(cur)));
  await page.mouse.down(); await api.frames(6); await page.mouse.up(); await api.frames(3);
  await api.screenshot('pkm-fire');
  await api.run(`(() => { const x = window.__radius.ctx.weapons.current; x.mag.rounds = 3; })()`);
  await api.key('KeyR', 60); await api.frames(14);
  await api.screenshot('pkm-cover-open');
  await api.frames(30);
  await api.screenshot('pkm-box-in');
  await api.frames(50);
  console.log('pkm reloaded', JSON.stringify(await api.run(cur)));
  // ---- mimic: shoot it (armour path or ZONE_MULT), then the knife ----
  await api.run(`(() => { const r = window.__radius, c = r.ctx; const w = r.giveWeapon('akm'); c.inventory.equipWeapon(w.uid, 'primary'); c.weapons.onInventoryChanged(); })()`);
  await api.run(`window.__radius.press('slot1')`); await api.frames(22);
  const target = await api.run(`(() => {
    const r = window.__radius, c = r.ctx, p = c.player;
    const yaw = p.yaw; const x = p.position.x - Math.sin(yaw) * 6, z = p.position.z - Math.cos(yaw) * 6;
    const e = r.spawn('mimic', x, z);
    if (!e) return null;
    const dx = e.position.x - p.eye.x, dz = e.position.z - p.eye.z, dy = (e.position.y + e.height * 0.7) - p.eye.y;
    r.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    return { hp: e.hp, armor: !!e.armorPieces, height: e.height };
  })()`);
  console.log('mimic', JSON.stringify(target));
  await api.frames(3);
  for (let i = 0; i < 4; i++) { await page.mouse.down(); await api.frames(2); await page.mouse.up(); await api.frames(2); }
  const hit = await api.run(`(() => { const c = window.__radius.ctx; const e = c.enemies.list.find((x) => x.type === 'mimic'); return { hp: e && +e.hp.toFixed(1), alive: e && e.alive, shots: c.state.data.stats.shots }; })()`);
  console.log('mimic shot', JSON.stringify(hit));
  await api.screenshot('mimic-shot');
  // walk up and stab
  await api.run(`(() => { const r = window.__radius, c = r.ctx, p = c.player; const e = c.enemies.list.find((x) => x.type === 'mimic'); if (!e) return; const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z, d = Math.hypot(dx, dz); r.teleport(e.position.x - dx / d * 1.1, e.position.z - dz / d * 1.1); const ny = Math.atan2(-dx, -dz); r.setLook(ny, -0.05); })()`);
  await api.frames(3);
  await api.run(`window.__radius.press('melee')`);
  await api.frames(12);
  await api.screenshot('mimic-stab');
  await api.frames(14);
  const st = await api.run(`(() => { const c = window.__radius.ctx; const e = c.enemies.list.find((x) => x.type === 'mimic'); return { hp: e && +e.hp.toFixed(1), alive: e && e.alive, melee: c.state.data.stats.melee, current: c.weapons.current && c.weapons.current.id }; })()`);
  console.log('mimic stabbed', JSON.stringify(st));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
