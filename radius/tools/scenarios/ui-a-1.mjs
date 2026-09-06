// ui-a: kit manifest, workbench and search forms on a rich kit. Screens plus handler-level checks.
// node tools/smoke.mjs --out .smoke/ui-a-1 --scenario tools/scenarios/ui-a-1.mjs --w 960 --h 540
export default async function (page, api) {
  const R = 'window.__radius';
  const J = (expr) => api.run(`(() => { try { return JSON.stringify(${expr}); } catch (e) { return 'THREW ' + (e.stack || e); } })()`);
  const click = (a) => api.run(`(() => { try { const b = [...document.querySelectorAll('#panels [data-a]')].find((x) => x.dataset.a === '${a}'); if (!b) return 'no button ${a}'; if (b.disabled) return 'disabled ${a}'; b.click(); const n = document.querySelector('#panels .notice'); return '${a} -> ' + (n ? n.textContent : ''); } catch (e) { return 'THREW ' + (e.stack || e); } })()`);
  const clickPrefix = (p) => api.run(`(() => { try { const b = [...document.querySelectorAll('#panels [data-a]')].find((x) => x.dataset.a.startsWith('${p}')); if (!b) return 'no button ${p}*'; b.click(); const n = document.querySelector('#panels .notice'); return b.dataset.a + ' -> ' + (n ? n.textContent : ''); } catch (e) { return 'THREW ' + (e.stack || e); } })()`);
  const selRow = (p) => api.run(`(() => { const r = [...document.querySelectorAll('#panels [data-sel]')].find((x) => x.dataset.sel.startsWith('${p}')); if (!r) return 'no row ${p}'; r.click(); return 'selected ' + r.dataset.sel; })()`);
  await api.run(`${R}.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`${R}.ctx.panels.testKit()`); await api.frames(2);
  const akm = await J(`${R}.ctx.inventory.weapons.find((w) => w.id === 'akm').uid`);
  console.log('akm uid', akm, 'weight/cap', await J(`[${R}.ctx.inventory.weight().toFixed(1), ${R}.ctx.inventory.capacity()]`));

  // ---- kit manifest ----
  await api.run(`${R}.ctx.panels.open('inventory')`); await api.frames(2);
  console.log('inventory open:', await J(`({ open: ${R}.ctx.panels.isOpen, cur: ${R}.ctx.panels.current, enabled: ${R}.ctx.input.enabled, focused: document.activeElement && (document.activeElement.dataset.a || document.activeElement.dataset.sel) })`));
  await api.screenshot('inventory');
  console.log(await selRow(`weapon:akm:${akm}`)); await api.frames(1);
  await api.screenshot('inventory-weapon-card');
  console.log(await click('slot:vest')); await api.frames(1);
  await api.screenshot('inventory-slot-vest');
  console.log(await clickPrefix('equip:vest:'));
  console.log('vest worn:', await J(`${R}.ctx.inventory.equippedDef('vest') && ${R}.ctx.inventory.equippedDef('vest').name`));
  console.log(await click('slot:helmet')); console.log(await clickPrefix('equip:helmet:'));
  console.log(await click('slot:headgear')); console.log(await clickPrefix('equip:headgear:'));
  // ammo card: preferred type, comparison against the vest
  console.log(await selRow('ammo:762_ap:')); await api.frames(1);
  await api.screenshot('inventory-ammo-card');
  console.log(await click('pref:7.62x39:762_ap'));
  console.log('preferred:', await J(`${R}.ctx.inventory.preferredAmmo('7.62x39')`));
  // ready magazines within the rig capacity (6Sh112: 4 pouches; the starter mags took 2 at creation)
  const magUids = await J(`${R}.ctx.inventory.mags.map((m) => [m.uid, m.id, m.rounds, ${R}.ctx.inventory.isReady(m.uid)])`);
  console.log('mags:', magUids);
  const emptyAk = await J(`${R}.ctx.inventory.mags.find((m) => m.id === 'mag_ak762_30' && m.rounds === 0).uid`);
  console.log(await click(`ready:${emptyAk}`));
  console.log('ready list:', await J(`${R}.ctx.inventory.data.readyMags`));
  // use a bandage, assign a grenade to key 7
  await api.run(`${R}.ctx.state.data.bleeding = true`);
  console.log(await click('use:bandage'));
  console.log('after bandage:', await J(`({ hp: ${R}.ctx.state.data.hp, bleeding: ${R}.ctx.state.data.bleeding, bandages: ${R}.ctx.inventory.count('bandage'), lock: ${R}.ctx.player.moveLock })`));
  console.log(await selRow('grenade:gr_rgd5:')); console.log(await click('quick:1:gr_rgd5'));
  console.log('quick:', await J(`${R}.ctx.inventory.quick`));
  console.log(await click('install:battery'));
  console.log('torch:', await J(`${R}.ctx.state.data.flashlight.battery`));
  console.log(await click('slot:mask')); console.log(await clickPrefix('equip:mask:')); console.log(await click('install:filter'));
  console.log('mask charge:', await J(`${R}.ctx.inventory.equipped('mask') && ${R}.ctx.inventory.equipped('mask').charge`));
  // keyboard: Tab moves focus, Enter on a row selects it
  await api.key('Tab'); await api.key('Tab'); await api.frames(1);
  console.log('focus after Tab Tab:', await J(`document.activeElement && (document.activeElement.dataset.a || document.activeElement.dataset.sel || document.activeElement.tagName)`));
  await api.screenshot('inventory-after');
  await api.key('Escape'); await api.frames(2);
  console.log('closed:', await J(`({ open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled, mode: ${R}.ctx.mode })`));

  // ---- workbench: attachments ----
  await api.run(`${R}.ctx.panels.open('workbench')`); await api.frames(2);
  await api.screenshot('bench-attachments');
  console.log(await click(`fit:${akm}:rail_akcover`));
  console.log(await click(`fit:${akm}:opt_eotech`));
  console.log(await click(`fit:${akm}:muz_pbs1`));
  console.log(await click(`fit:${akm}:rail_akhg`));
  console.log(await click(`fit:${akm}:grip_rk1`));
  console.log('akm fit:', await J(`(() => { const w = ${R}.ctx.inventory.weaponByUid(${akm}); return { rails: w.rails, att: w.attachments, left: ['rail_akcover', 'opt_eotech', 'muz_pbs1', 'rail_akhg', 'grip_rk1', 'opt_kobra'].map((id) => ${R}.ctx.inventory.count(id)) }; })()`));
  await api.frames(1); await api.screenshot('bench-attachments-fitted');
  console.log(await click(`unfit:${akm}:rail_akhg`));
  console.log('after rail removal:', await J(`(() => { const w = ${R}.ctx.inventory.weaponByUid(${akm}); return { rails: w.rails, att: w.attachments, grip: ${R}.ctx.inventory.count('grip_rk1'), rail: ${R}.ctx.inventory.count('rail_akhg') }; })()`));
  // ---- maintenance ----
  await api.key('Digit2'); await api.frames(1);
  console.log('tab via digit:', await J(`document.querySelector('#panels .tabs.keyed .tab.on') && document.querySelector('#panels .tabs.keyed .tab.on').textContent`));
  await api.screenshot('bench-maintenance');
  console.log(await click(`repair:${akm}:bolt`));
  console.log(await click(`replace:${akm}:barrel`));
  console.log('parts:', await J(`${R}.ctx.inventory.weaponByUid(${akm}).parts`), 'kits', await J(`[${R}.ctx.inventory.count('repairkit'), ${R}.ctx.state.data.flags.kitUses, ${R}.ctx.inventory.count('part_barrel')]`));
  console.log('inBase:', await J(`${R}.ctx.player.inBase`));
  console.log(await click(`clean:${akm}`));
  await api.frames(1); await api.screenshot('bench-cleaning');
  await api.wait(4600); await api.frames(2);
  console.log('after clean:', await J(`({ dirt: ${R}.ctx.inventory.weaponByUid(${akm}).dirt, cleankit: ${R}.ctx.inventory.count('cleankit'), uses: ${R}.ctx.state.data.flags.kitUses, job: ${R}.ctx.panels.jobState })`));
  // ---- magazines ----
  await api.key('Digit3'); await api.frames(1);
  await api.screenshot('bench-magazines');
  console.log(await click('pick:7.62x39:762_ap'));
  console.log(await click(`load:${emptyAk}`));
  console.log('mag loaded:', await J(`(() => { const m = ${R}.ctx.inventory.magByUid(${emptyAk}); return { rounds: m.rounds, ammo: m.ammo, apLeft: ${R}.ctx.inventory.count('762_ap') }; })()`));
  const fmjMag = await J(`${R}.ctx.inventory.mags.find((m) => m.id === 'mag_ak762_30' && m.ammo === '762_fmj').uid`);
  console.log(await click(`load:${fmjMag}`));   // holds FMJ, AP picked -> deny
  console.log(await click(`unload:${fmjMag}`));
  console.log(await click(`fill:${akm}`));
  console.log('after fill:', await J(`${R}.ctx.inventory.mags.filter((m) => m.cal === '7.62x39').map((m) => [m.id, m.rounds, m.ammo])`), 'loose', await J(`[${R}.ctx.inventory.count('762_fmj'), ${R}.ctx.inventory.count('762_ap'), ${R}.ctx.inventory.count('762_hp')]`));
  // mosin: internal magazine
  const mosin = await J(`${R}.ctx.inventory.weapons.find((w) => w.id === 'mosin').uid`);
  console.log(await click(`weapon:${mosin}`)); await api.frames(1);
  console.log(await click(`tubeunload:${mosin}`)); console.log(await click(`tubeload:${mosin}`));
  console.log('mosin tube:', await J(`${R}.ctx.inventory.weaponByUid(${mosin}).tube`));
  await api.screenshot('bench-magazines-mosin');
  // ---- armour ----
  await api.key('Digit4'); await api.frames(1);
  await api.screenshot('bench-armour');
  console.log(await clickPrefix('arepair:'));
  console.log('vest after repair:', await J(`${R}.ctx.inventory.gear.filter((g) => g.durability != null).map((g) => [g.id, g.durability])`));
  await api.key('Escape'); await api.frames(2);

  // ---- search a pile ----
  await api.run(`(() => { window.__pile = { name: 'MIMIC · REGULAR', entries: [], changes: 0, onChange() { this.changes++; } }; return 'ok'; })()`);
  // a pile of real instances: a clip and a spare vest moved out of the pack, loose rounds, a medkit and a bare weapon id
  await api.run(`(() => { const r = ${R}; const inv = r.ctx.inventory; const p = window.__pile;
    const clip = inv.mags.find((m) => m.id === 'mag_mosin5'); if (clip) { inv.removeMag(clip.uid); p.entries.push({ kind: 'mag', inst: clip, id: clip.id, count: 1 }); }
    const vest = inv.gear.find((g) => g.id === 'vest_kirasa'); if (vest) { inv.removeGear(vest.uid); p.entries.push({ kind: 'gear', inst: vest, id: vest.id, count: 1 }); }
    p.entries.push({ kind: 'item', id: '762_fmj', count: 23 }); p.entries.push({ kind: 'item', id: 'medkit', count: 1 }); p.entries.push({ kind: 'weapon', id: 'sks', count: 1 });
    return p.entries.length; })()`);
  await api.run(`${R}.ctx.panels.open('loot', { pile: window.__pile })`); await api.frames(2);
  await api.screenshot('loot');
  console.log(await click('take:0'));
  console.log('pile after take:', await J(`[window.__pile.entries.map((e) => e.kind + ':' + e.id), window.__pile.changes, ${R}.ctx.inventory.mags.length]`));
  console.log(await clickPrefix('put:med:'), '|', await clickPrefix('put:mag:'));
  console.log('pile after put:', await J(`[window.__pile.entries.map((e) => e.kind + ':' + e.id + ':' + e.count), window.__pile.changes]`));
  await api.screenshot('loot-after-put');
  console.log(await click('takeall'));
  console.log('pile after take all:', await J(`[window.__pile.entries.length, window.__pile.changes, ${R}.ctx.inventory.weapons.map((w) => w.id), ${R}.ctx.inventory.count('762_fmj')]`));
  await api.screenshot('loot-empty');
  await api.key('Escape'); await api.frames(2);

  // ---- save / load keeps everything ----
  const before = await J(`(() => { const inv = ${R}.ctx.inventory; const w = inv.weaponByUid(${akm}); return { rails: w.rails, att: w.attachments, parts: w.parts, dirt: w.dirt, mags: inv.mags.map((m) => [m.id, m.rounds, m.ammo]), ready: inv.data.readyMags, eq: inv.equipment, quick: inv.quick, pref: ${R}.ctx.state.data.flags.ammoPref, kits: ${R}.ctx.state.data.flags.kitUses, items: inv.items }; })()`);
  await api.run(`${R}.ctx.state.save(); ${R}.ctx.state.load()`); await api.frames(1);
  const after = await J(`(() => { const inv = ${R}.ctx.inventory; const w = inv.weaponByUid(${akm}); return { rails: w.rails, att: w.attachments, parts: w.parts, dirt: w.dirt, mags: inv.mags.map((m) => [m.id, m.rounds, m.ammo]), ready: inv.data.readyMags, eq: inv.equipment, quick: inv.quick, pref: ${R}.ctx.state.data.flags.ammoPref, kits: ${R}.ctx.state.data.flags.kitUses, items: inv.items }; })()`);
  console.log('save/load identical:', before === after, before === after ? '' : '\n' + before + '\n' + after);
  await api.run(`${R}.ctx.panels.open('inventory')`); await api.frames(2);
  await api.screenshot('inventory-after-load');
  await api.key('KeyI'); await api.frames(2);
  console.log('closed by I:', await J(`${R}.ctx.panels.isOpen`));
}
