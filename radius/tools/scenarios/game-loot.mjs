import { fr as mk, face, prompt, interact, start } from './game-lib.mjs';
export default async function (page, api) {
  const fr = mk(page, api);
  await start(page, api);
  console.log('LOOT', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; const o = c.loot.objects; const kinds = {}; for (const x of o) kinds[x.kind] = (kinds[x.kind] || 0) + 1; return { total: o.length, kinds, spots: c.world.lootSpots.length }; })()`)));
  const near = (kind) => api.run(`(() => { const c = window.__radius.ctx; const o = c.loot.objects.find(x => x.kind === '${kind}'); return o ? { x: o.root.position.x, y: o.root.position.y, z: o.root.position.z } : null; })()`);
  const fl = await near('footlocker');
  if (fl) {
    await api.run(`window.__radius.teleport(${fl.x + 1.5}, ${fl.z + 1.2}); window.__radius.setTime(11);`);
    await fr(1); await api.run(face(fl.x, fl.y + 0.2, fl.z)); await fr(2);
    await api.screenshot('footlocker-closed');
    console.log('PROMPT', await api.run(prompt));
    await api.run(`${interact}`);
    await api.run(`(() => { const c = window.__radius.ctx; for (let i = 0; i < 8; i++) c.loot.update(0.05); })()`);
    await fr(2);
    await api.screenshot('footlocker-open');
    console.log('INVENTORY', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; return { items: c.inventory.items, ammo: c.inventory.ammo, weapons: c.inventory.weapons.map(w => w.id), slips: [...c.hud.elements.notify.children].map(s => s.textContent), opened: c.state.data.flags.lootOpened, prompt: ${prompt} }; })()`)));
  }
  const tin = await near('ammoTin');
  if (tin) { await api.run(`window.__radius.teleport(${tin.x + 0.9}, ${tin.z + 0.8})`); await fr(1); await api.run(face(tin.x, tin.y + 0.06, tin.z)); await fr(2); await api.screenshot('ammotin'); console.log('TIN PROMPT', await api.run(prompt)); await api.run(`${interact}; (() => { const c = window.__radius.ctx; for (let i = 0; i < 8; i++) c.loot.update(0.05); })()`); await fr(2); await api.screenshot('ammotin-open'); }
  const bag = await near('medBag');
  if (bag) { await api.run(`window.__radius.teleport(${bag.x + 1.0}, ${bag.z + 0.9})`); await fr(1); await api.run(face(bag.x, bag.y + 0.1, bag.z)); await fr(2); await api.screenshot('medbag'); console.log('BAG PROMPT', await api.run(prompt)); }
  for (const k of ['bandage', 'battery', 'probe', 'ammoBox']) {
    const it = await near(k); if (!it) { console.log('none', k); continue; }
    await api.run(`window.__radius.teleport(${it.x + 0.7}, ${it.z + 0.6})`); await fr(1); await api.run(face(it.x, it.y + 0.02, it.z)); await fr(2); await api.screenshot('loose-' + k);
    console.log('LOOSE', k, await api.run(prompt));
    if (k === 'probe') { await api.run(`${interact}`); console.log('PICKED', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; return { probes: c.inventory.count('probe'), objects: c.loot.objects.length }; })()`))); }
  }
  console.log('SLIPS', JSON.stringify(await api.run(`[...window.__radius.ctx.hud.elements.notify.children].map(s => s.textContent)`)));
  console.log('TIDE', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; const before = c.loot.objects.length; const sb = c.scene.children.length; c.events.emit('tide', 2); return { before, after: c.loot.objects.length, sceneBefore: sb, sceneAfter: c.scene.children.length, opened: c.state.data.flags.lootOpened }; })()`)));
}
