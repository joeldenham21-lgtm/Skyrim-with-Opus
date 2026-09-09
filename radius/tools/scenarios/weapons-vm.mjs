// Viewmodel pass: each gun in the player's hands at the hip and at ADS, as the game shows it.
// GUNS=akm,mosin node tools/smoke.mjs --out .smoke/vm --scenario tools/scenarios/weapons-vm.mjs --w 1280 --h 720
const IDS = (process.env.GUNS || 'akm,mosin,toz,pm').split(',');
const ADS = process.env.ADS !== '0';
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx;
    r.god(); r.teleport(30, 130); r.setLook(0.2, -0.02); r.setTime(${process.env.HOUR || 11});
    window.__step = (n) => { for (let i = 0; i < n; i++) { c.player.update(0.05); c.hands.update(0.05); c.weapons.update(0.05); c.lighting.update(0.05); c.input.endFrame(); } };
    window.__equip = (id) => { const w = r.giveWeapon(id); c.inventory.equipWeapon(w.uid, 'primary'); c.weapons.onInventoryChanged(); c.weapons.equipSlot('primary'); window.__step(30); const cur = c.weapons.current; return cur && cur.id; };
    window.__aim = (on) => { const code = c.input.bindings.aim[0]; window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code })); window.__step(${ADS ? 20 : 1}); return +c.weapons.adsBlend.toFixed(2); };
  })()`);
  for (const id of IDS) {
    console.log('equip', await api.run(`window.__equip(${JSON.stringify(id)})`));
    await api.frames(2);
    await api.screenshot(id + '-hip');
    if (ADS) {
      console.log('ads', await api.run(`window.__aim(true)`));
      await api.frames(2);
      await api.screenshot(id + '-ads');
      await api.run(`window.__aim(false)`);
    }
  }
  console.log('stats', JSON.stringify(await api.run(`window.__radius.stats()`)));
}
