// ui-b: locker (every kind both ways, quantities), bunk (check-kit summary, sleep, save), map (markers, sightings,
// objective), pause and death forms (rank, armour, killing round), and a save/load round trip.
// node tools/smoke.mjs --out .smoke/ui-b-3 --scenario tools/scenarios/ui-b-3.mjs --w 960 --h 540
import { R, J, click, text, count, setup, open, close } from './ui-b-lib.mjs';
export default async function (page, api) {
  await setup(page, api, `${R}.giveWeapon('akm'); ${R}.give('battery', 5); ${R}.give('545_fmj', 40); ${R}.give('medkit', 2); ${R}.give('art_pearl', 1);`);
  // a vest with wear, an attachment on the AKM
  await api.run(`(() => { const c = ${R}.ctx; const inv = c.inventory; const akm = inv.weapons.find((w) => w.id === 'akm'); akm.attachments.muzzle = 'muz_pbs1'; akm.parts.barrel = 62; const v = { uid: 9001, id: 'vest_6b23_1', durability: 70 }; inv.addGear(v); })()`);
  await api.frames(1);
  // ---- locker ----
  await open(api, 'storage');
  console.log('storage open:', await J(api, `({ strip: document.querySelector('#panels .p-storage .strip').textContent.replace(/\\s+/g, ' '), carriedRows: document.querySelectorAll('#panels .p-storage .cols > div:first-child .row').length })`));
  await api.screenshot('storage');
  const ids = JSON.parse(await J(api, `(() => { const inv = ${R}.ctx.inventory; return { pm: inv.weapons.find((w) => w.id === 'pm').uid, akm: inv.weapons.find((w) => w.id === 'akm').uid, mag: inv.mags[0].uid, vest: inv.gear.find((g) => g.id === 'vest_6b23_1').uid, rig: inv.gear.find((g) => g.id === 'rig_belt').uid }; })()`));
  for (const x of [`in:w:${ids.akm}`, `in:m:${ids.mag}`, `in:g:${ids.vest}`, `in:g:${ids.rig}`, 'in:i:battery:5', 'in:i:545_fmj:10', 'in:i:medkit:1']) { console.log(await click(api, x)); await api.frames(1); }
  console.log('stowed:', await J(api, `(() => { const c = ${R}.ctx; const st = c.state.data.storage, inv = c.inventory; return { locker: { w: st.weapons.map((w) => w.id + '+' + Object.values(w.attachments).join(',')), m: st.mags.length, g: st.gear.map((g) => g.id), i: st.items }, carried: { w: inv.weapons.map((w) => w.id), m: inv.mags.length, g: inv.gear.map((g) => g.id), battery: inv.count('battery'), n545: inv.count('545_fmj'), medkit: inv.count('medkit') }, eq: inv.equipment, ready: inv.data.readyMags }; })()`));
  await api.screenshot('storage-stowed');
  for (const x of [`out:w:${ids.akm}`, `out:g:${ids.vest}`, 'out:i:545_fmj:10']) { console.log(await click(api, x)); await api.frames(1); }
  console.log('taken back:', await J(api, `(() => { const c = ${R}.ctx; const st = c.state.data.storage, inv = c.inventory; return { locker: { w: st.weapons.length, g: st.gear.map((g) => g.id), i: st.items }, carried: { w: inv.weapons.map((w) => w.id), g: inv.gear.map((g) => g.id), n545: inv.count('545_fmj') }, vestSlot: inv.equipment.vest, primary: inv.equipment.primary }; })()`));
  await close(api);
  // ---- bunk ----
  await open(api, 'bed');
  console.log('bed:', await J(api, `({ rows: [...document.querySelectorAll('#panels .p-bed .row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 12), note: (document.querySelector('#panels .p-bed .note') || {}).textContent })`));
  await api.screenshot('bed');
  const day0 = await api.run(`${R}.ctx.state.data.day`);
  console.log(await click(api, 'sleep')); await api.frames(1);
  await api.screenshot('bed-sleeping');
  await api.wait(2600); await api.frames(2);
  console.log('after sleep:', await J(api, `({ day: ${R}.ctx.state.data.day, day0: ${day0}, hour: +${R}.ctx.state.data.hour.toFixed(2), open: ${R}.ctx.panels.isOpen, saved: !!localStorage.getItem('radius.save.v1'), enabled: ${R}.ctx.input.enabled, slips: [...${R}.ctx.hud.elements.notify.children].map((s) => s.textContent).slice(-1) })`));
  // ---- map with feeds (stubbed when the loot / squad agents have not landed theirs) ----
  await api.run(`(() => { const c = ${R}.ctx; if (!c.loot.markers) c.loot.markers = () => [{ x: 22, z: 212, kind: 'container', opened: false }, { x: 30, z: 205, kind: 'container', opened: true }, { x: 60, z: -240, kind: 'corpse' }, { x: -120, z: 60, kind: 'pile' }]; c.squads = c.squads || {}; if (!c.squads.sightings) c.squads.sightings = () => [{ x: -130, z: 70, t: c.elapsed - 30, count: 3 }, { x: 150, z: -60, t: c.elapsed - 700, count: 2 }]; const ms = c.missions.available(); c.missions.accept(ms[0].id); })()`);
  await api.frames(1);
  await open(api, 'map');
  console.log('map:', await J(api, `({ canvas: !!document.querySelector('#panels .p-map canvas'), size: (document.querySelector('#panels .p-map canvas') || {}).clientWidth, legend: (document.querySelector('#panels .p-map .legend') || {}).textContent.replace(/\\s+/g, ' '), lines: (document.querySelector('#panels .p-map .lines') || {}).textContent.replace(/\\s+/g, ' ') })`));
  await api.screenshot('map');
  await close(api);
  // ---- pause form ----
  await api.run(`${R}.ctx.game.pause()`); await api.frames(1);
  console.log('pause:', await J(api, `[...document.querySelectorAll('#menus .kv')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`));
  await api.screenshot('pause');
  await api.run(`${R}.ctx.game.resume()`); await api.frames(1);
  // ---- save / load round trip ----
  await api.run(`${R}.ctx.state.save()`);
  const snap = await J(api, `(() => { const c = ${R}.ctx; return { w: c.inventory.weapons.map((w) => w.id), st: c.state.data.storage.weapons.length + '/' + Object.keys(c.state.data.storage.items).length, money: c.state.data.money, lvl: c.state.data.securityLevel }; })()`);
  await api.run(`${R}.start(false)`); await api.frames(2);
  const after = await J(api, `(() => { const c = ${R}.ctx; return { w: c.inventory.weapons.map((w) => w.id), st: c.state.data.storage.weapons.length + '/' + Object.keys(c.state.data.storage.items).length, money: c.state.data.money, lvl: c.state.data.securityLevel }; })()`);
  console.log('save/load:', snap, '->', after, snap === after ? 'MATCH' : 'MISMATCH');
  // ---- death report with the killing round ----
  await api.run(`${R}.ctx.player.die({ kind: 'bullet', ammo: '762_fmj', zone: 'torso', penetrated: true })`);
  await api.wait(3600); await api.frames(1);
  await api.key('Enter'); await api.frames(1);
  console.log('death:', await J(api, `[...document.querySelectorAll('#menus .ln')].map((e) => e.textContent).filter(Boolean)`));
  await api.screenshot('death');
}
