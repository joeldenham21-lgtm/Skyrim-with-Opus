// Handler-level checks: clicks every panel action through the DOM and prints the resulting state. Few screenshots.
// node tools/smoke.mjs --out .smoke/ui-4 --scenario tools/scenarios/ui-4.mjs --w 960 --h 540
export default async function (page, api) {
  const R = 'window.__radius';
  const click = (a) => api.run(`(() => { try { const b = [...document.querySelectorAll('#panels [data-a], #menus [data-a]')].find((x) => x.dataset.a === '${a}'); if (!b) return 'no button ${a}'; b.click(); const n = document.querySelector('#panels .notice, #menus .notice'); return 'clicked ${a} -> ' + (n ? n.textContent : ''); } catch (e) { return 'THREW ' + (e.stack || e); } })()`);
  const state = (expr) => api.run(`(() => { try { return JSON.stringify(${expr}); } catch (e) { return 'THREW ' + e; } })()`);
  await api.run(`${R}.ctx.debug.noEnemies = true; ${R}.start()`); await api.frames(1);
  await api.run(`(() => { const r = ${R}; r.give('art_pearl', 2); r.give('medkit', 2); r.give('stim'); r.give('battery', 2); r.give('cleankit'); r.ctx.state.data.money = 3140; r.ctx.state.data.hp = 62; r.ctx.state.data.bleeding = true; r.ctx.state.data.flashlight.battery = 41; r.ctx.inventory.addAmmo('7.62x39', 37); const w = r.ctx.inventory.weapons[0]; w.dirt = 0.34; w.mags[2] = 5; w.jammed = true; })()`);

  await api.run(`${R}.ctx.panels.open('inventory')`);
  console.log(await click('use:medkit'));
  console.log('items:', await state(`${R}.ctx.inventory.items`), 'hp', await state(`${R}.ctx.state.data.hp`));
  console.log(await click('use:bandage'));
  console.log('bleeding:', await state(`${R}.ctx.state.data.bleeding`), 'hp', await state(`${R}.ctx.state.data.hp`));
  console.log(await click('install'));
  console.log('battery:', await state(`${R}.ctx.state.data.flashlight.battery`), 'cells', await state(`${R}.ctx.inventory.count('battery')`));
  const uid = await state(`${R}.ctx.inventory.weapons[0].uid`);
  console.log(await click(`kitclean:${uid}`));
  console.log('dirt:', await state(`${R}.ctx.inventory.weapons[0].dirt`), 'kit', await state(`${R}.ctx.inventory.count('cleankit')`));
  await api.screenshot('inventory-after');
  await api.key('Escape'); await api.frames(1);
  console.log('closed:', await state(`({open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled, lock: ${R}.ctx.player.moveLock})`));
  await api.wait(1500); await api.frames(2);
  console.log('hp after ticks:', await state(`${R}.ctx.state.data.hp`));

  await api.run(`(() => { const w = ${R}.ctx.inventory.weapons[0]; w.dirt = 0.5; w.jammed = true; w.mags[1] = 2; })()`);
  await api.run(`${R}.ctx.panels.open('workbench')`);
  console.log(await click(`unjam:${uid}`)); console.log(await click(`load:${uid}`)); console.log(await click(`clean:${uid}`));
  console.log('weapon:', await state(`${R}.ctx.inventory.weapons[0]`), 'ammo', await state(`${R}.ctx.inventory.ammo`));
  await api.screenshot('workbench-after');
  await api.key('Escape'); await api.frames(1);

  await api.run(`${R}.ctx.panels.open('supply')`);
  console.log(await click('buy:ammo:12ga')); console.log(await click('buy:item:bandage')); console.log(await click('buy:weapon:toz')); console.log(await click('buy:weapon:akm'));
  console.log('money:', await state(`${R}.ctx.state.data.money`), 'weapons', await state(`${R}.ctx.inventory.weapons.map((w) => w.id)`), 'slots', await state(`${R}.ctx.inventory.slots`));
  await api.run(`${R}.ctx.state.data.money = 5`);
  await api.run(`(() => { const b = [...document.querySelectorAll('#panels .tab')].find((x) => x.dataset.a === 'sell:x'); })()`);
  console.log(await click('tab:buy'));
  console.log('deny class present:', await state(`document.querySelectorAll('#panels .btn.deny').length`));
  console.log(await click('buy:item:bandage'));
  console.log(await click('tab:sell'));
  const tozUid = await state(`${R}.ctx.inventory.weapons.find((w) => w.id === 'toz').uid`);
  console.log(await click(`sell:weapon:${tozUid}`)); console.log(await click('sell:ammo:12ga'));
  console.log('money:', await state(`${R}.ctx.state.data.money`), 'weapons', await state(`${R}.ctx.inventory.weapons.map((w) => w.id)`), '12ga', await state(`${R}.ctx.inventory.ammoCount('12ga')`));
  await api.key('Escape'); await api.frames(1);

  await api.run(`${R}.ctx.panels.open('storage')`);
  console.log(await click(`in:weapon:${uid}`)); console.log(await click('in:ammo:7.62x39')); console.log(await click('in:item:art_pearl'));
  console.log('storage:', await state(`${R}.ctx.state.data.storage`), 'carried weapons', await state(`${R}.ctx.inventory.weapons.map((w) => w.id)`));
  console.log(await click(`out:weapon:${uid}`)); console.log(await click('out:ammo:7.62x39')); console.log(await click('out:item:art_pearl'));
  console.log('storage:', await state(`${R}.ctx.state.data.storage`), 'carried weapons', await state(`${R}.ctx.inventory.weapons.map((w) => w.id)`), 'slots', await state(`${R}.ctx.inventory.slots`));
  await api.screenshot('storage-after');
  await api.key('Escape'); await api.frames(1);

  await api.run(`${R}.ctx.panels.open('terminal')`);
  console.log(await click('tab:sell')); console.log(await click('sell:art_pearl'));
  console.log('money:', await state(`${R}.ctx.state.data.money`), 'earned', await state(`${R}.ctx.state.data.earned`), 'pearls', await state(`${R}.ctx.inventory.count('art_pearl')`));
  await api.key('Escape'); await api.frames(1);

  // keyboard navigation: open inventory, ArrowDown twice, check focus moved; digit picks the first action
  await api.run(`${R}.ctx.panels.open('inventory')`);
  await api.key('ArrowDown'); await api.key('ArrowDown');
  console.log('focused:', await state(`document.activeElement && (document.activeElement.dataset.a || document.activeElement.className)`));
  await api.key('KeyI'); await api.frames(1);
  console.log('after I:', await state(`({open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled})`));
}
