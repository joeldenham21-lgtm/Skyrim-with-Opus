// Review pass, panels: inventory (medkit heal-over-time after close), terminal (accept, sell), workbench, supply (buy weapon ->
// weapons.onInventoryChanged), storage, map, bed (sleep advances the day and saves).
// node tools/smoke.mjs --out .smoke/ui-rv-2 --scenario tools/scenarios/ui-rv-2.mjs --w 640 --h 360
export default async function (page, api) {
  const R = 'window.__radius';
  const J = (expr) => api.run(`(() => { try { return JSON.stringify(${expr}); } catch (e) { return 'THREW ' + (e.stack || e); } })()`);
  const click = (a) => api.run(`(() => { const b = [...document.querySelectorAll('#panels [data-a]')].find((x) => x.dataset.a === '${a}'); if (!b) return 'no button ${a}'; b.click(); const n = document.querySelector('#panels .notice'); return 'clicked ${a} -> ' + (n ? n.textContent : ''); })()`);
  const open = async (name) => { await api.run(`${R}.ctx.panels.open('${name}')`); await api.frames(2); console.log(name, 'open:', await J(`({ open: ${R}.ctx.panels.isOpen, cur: ${R}.ctx.panels.current, enabled: ${R}.ctx.input.enabled, hudHidden: document.getElementById('crosshair').classList.contains('hidden') })`)); };
  const closeEsc = async (name) => { await api.key('Escape'); await api.frames(1); console.log(name, 'after Esc:', await J(`({ open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled, mode: ${R}.ctx.mode })`)); };
  await api.run(`${R}.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = ${R}; r.give('art_pearl'); r.give('medkit'); r.give('battery'); r.ctx.state.data.money = 5000; r.ctx.state.data.hp = 50; r.ctx.state.data.flashlight.battery = 30; r.ctx.inventory.addAmmo('12ga', 7); const w = r.ctx.inventory.weapons[0]; w.dirt = 0.41; w.mags[1] = 3; window.__oic = 0; const orig = r.ctx.weapons.onInventoryChanged.bind(r.ctx.weapons); r.ctx.weapons.onInventoryChanged = (...a) => { window.__oic++; return orig(...a); }; })()`);

  await open('inventory');
  await api.screenshot('inventory');
  console.log(await click('use:medkit'));
  console.log(await click('install'));
  console.log('after use:', await J(`({ medkits: ${R}.ctx.inventory.count('medkit'), battery: ${R}.ctx.state.data.flashlight.battery, hp: ${R}.ctx.state.data.hp })`));
  await closeEsc('inventory');
  await api.wait(1500); await api.frames(2);
  console.log('hp after heal ticks (expect > 50):', await J(`${R}.ctx.state.data.hp`));

  await open('terminal');
  await api.screenshot('terminal');
  const firstId = await J(`(${R}.ctx.missions.available()[0] || {}).id`);
  console.log(await click(`accept:${JSON.parse(firstId)}`));
  console.log('active:', await J(`${R}.ctx.missions.active.map((m) => m.code)`));
  await api.key('ArrowRight'); await api.frames(1);
  console.log(await click('sell:art_pearl'));
  console.log('money after sell (expect 6400):', await J(`({ money: ${R}.ctx.state.data.money, earned: ${R}.ctx.state.data.earned, pearls: ${R}.ctx.inventory.count('art_pearl') })`));
  await api.screenshot('terminal-sell');
  await closeEsc('terminal');

  await open('workbench');
  await api.screenshot('workbench');
  const uid = JSON.parse(await J(`${R}.ctx.inventory.weapons[0].uid`));
  console.log(await click(`load:${uid}`)); console.log(await click(`clean:${uid}`));
  console.log('weapon:', await J(`({ w: ${R}.ctx.inventory.weapons[0], oic: window.__oic })`));
  await closeEsc('workbench');

  await open('supply');
  await api.screenshot('supply');
  console.log(await click('buy:weapon:toz')); console.log(await click('buy:item:probe'));
  console.log('after buy:', await J(`({ money: ${R}.ctx.state.data.money, weapons: ${R}.ctx.inventory.weapons.map((w) => w.id), slots: ${R}.ctx.inventory.slots, probes: ${R}.ctx.inventory.count('probe'), oic: window.__oic, current: ${R}.ctx.weapons.current && ${R}.ctx.weapons.current.id })`));
  await closeEsc('supply');

  await open('storage');
  await api.screenshot('storage');
  console.log(await click('in:item:battery')); console.log(await click('in:ammo:12ga'));
  console.log('storage:', await J(`${R}.ctx.state.data.storage`));
  await closeEsc('storage');

  await open('map');
  await api.screenshot('map');
  await closeEsc('map');

  await open('bed');
  await api.screenshot('bed');
  const before = await J(`({ day: ${R}.ctx.state.data.day, hour: ${R}.ctx.state.data.hour })`);
  console.log(await click('sleep'));
  await api.wait(2600); await api.frames(2);
  console.log('sleep:', before, '->', await J(`({ day: ${R}.ctx.state.data.day, hour: ${R}.ctx.state.data.hour, open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled, saved: !!localStorage.getItem('radius.save.v1'), hp: ${R}.ctx.state.data.hp })`));
  await api.screenshot('after-sleep');
}
