// Review pass for the game subsystem: missions (offer/accept/objective/pickup/deliver, survey, relay sequence),
// loot (populate, open, medical bag geometry), scares (ridge figure and the rest), tide disposal, save/load.
import { fr as mk, face, prompt, interact, start } from './game-lib.mjs';
const J = (x) => JSON.stringify(x);
export default async function (page, api) {
  const fr = mk(page, api);
  await start(page, api);
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  console.log('AVAILABLE', J(await R(`return c.missions.available().map(m => [m.id, m.title, m.payment]);`)));
  console.log('COPY', await R(`return c.missions.available().map(m => m.heading + ' | ' + m.body).join('\\n');`));
  // ---- retrieval: deliverable must be false before the pickup even if a recorder is carried (chain issue)
  const acc = await R(`const ms = c.missions.available(); const m = ms.find(m => m.code === 'PSC-0417') || ms.find(m => m.type === 'RETRIEVAL'); c.inventory.add('recorder', 1); const ok = c.missions.accept(m.id); const a = c.missions.active[0]; const d0 = c.missions.deliverable(a); c.inventory.remove('recorder', 1); return { ok, id: a.id, deliverableWithIssuedUnit: d0, spot: a.spot, objective: c.hud.elements.objective.textContent, objs: c.missions.objects.get(a.id).length };`);
  console.log('ACCEPT', J(acc));
  await R(`r.teleport(${acc.spot.x + 1.2}, ${acc.spot.z + 1.0}); r.setTime(11);`);
  await fr(1);
  await api.run(face(acc.spot.x, acc.spot.y + 0.08, acc.spot.z));
  await fr(2);
  await api.screenshot('recorder');
  console.log('PROMPT', await api.run(prompt));
  await api.run(interact);
  await fr(1);
  console.log('PICKUP', J(await R(`const m = c.missions.active[0]; return { has: c.inventory.count(m.item), deliverable: c.missions.deliverable(m), objective: c.hud.elements.objective.textContent, objs: (c.missions.objects.get(m.id) || []).length };`)));
  console.log('COMPLETE', J(await R(`const m = c.missions.active[0]; const r0 = c.missions.complete(m.id); return { r0, money: c.state.data.money, earned: c.state.data.earned, level: c.state.data.securityLevel, active: c.missions.active.length, completed: c.missions.completed, recorderLeft: c.inventory.count('recorder'), objectiveHidden: c.hud.elements.objective.classList.contains('hidden'), slips: [...c.hud.elements.notify.children].map(s => s.textContent) };`)));
  // ---- survey: plant one beacon
  const sv = await R(`const ms = c.missions.available(); const m = ms.find(m => m.type === 'SURVEY'); c.missions.accept(m.id); const a = c.missions.active.find(x => x.type === 'SURVEY'); const p = a.points[0]; return { id: a.id, x: p.x, z: p.z, y: c.world.getHeight(p.x, p.z), beacons: c.inventory.count('beacon'), objective: c.hud.elements.objective.textContent };`);
  console.log('SURVEY', J(sv));
  await R(`r.teleport(${sv.x + 1.6}, ${sv.z + 1.4});`);
  await fr(1);
  await api.run(face(sv.x, sv.y + 0.5, sv.z));
  await fr(1);
  console.log('STAKE PROMPT', await api.run(prompt));
  await api.run(interact);
  await fr(2);
  await api.screenshot('beacon');
  console.log('PLANTED', J(await R(`const m = c.missions.active.find(x => x.type === 'SURVEY'); return { done: m.points.map(p => p.done), beacons: c.inventory.count('beacon'), objective: c.hud.elements.objective.textContent, deliverable: c.missions.deliverable(m) };`)));
  // ---- save / load round trip with the survey active: objects rebuilt from the save
  console.log('SAVELOAD', J(await R(`c.state.save(); const before = c.missions.active.map(x => x.id); c.missions.reset(); r.start(false); const a = c.missions.active; return { before, after: a.map(x => x.id), done: a[0] && a[0].points && a[0].points.map(p => p.done), objs: a[0] ? (c.missions.objects.get(a[0].id) || []).length : 0, beacons: c.inventory.count('beacon'), objective: c.hud.elements.objective.textContent, pos: c.player.position.toArray().map(v => +v.toFixed(0)) };`)));
  await fr(1);
  // ---- relay: chain step 3 forced
  const relay = await R(`const md = c.state.data.missions; md.active.length = 0; c.missions.reset(); md.chainStep = 2; c.state.data.securityLevel = 3; md.chainOffer = null; const ch = c.missions.available().find(m => m.chain === 2); c.missions.accept(ch.id); const m = c.missions.active[0]; return { id: m.id, body: m.body, relay: m.relay, beacon: c.inventory.count('beacon'), y: c.world.getHeight(m.relay.x, m.relay.z), objective: c.hud.elements.objective.textContent };`);
  console.log('RELAY', J(relay));
  await R(`r.teleport(${relay.relay.x + 2.0}, ${relay.relay.z + 2.5}); r.setTime(18.5);`);
  await fr(1);
  await api.run(face(relay.relay.x, relay.y + 0.6, relay.relay.z));
  await fr(1);
  console.log('RELAY PROMPT', await api.run(prompt));
  await api.run(interact);
  await R(`for (let i = 0; i < 50; i++) c.missions.update(0.05);`);   // 2.5 s into the sequence
  await R(`r.setLook(0.35, 0.12);`);
  await fr(2);
  await api.screenshot('relay');
  console.log('SEQ', J(await R(`return { seq: !!c.missions.sequence, t: c.missions.sequence && +c.missions.sequence.t.toFixed(2), uTide: +c.sky.uniforms.uTide.value.toFixed(3) };`)));
  await R(`for (let i = 0; i < 90; i++) c.missions.update(0.05);`);
  await fr(1);
  console.log('CONCLUDED', J(await R(`return { seq: !!c.missions.sequence, uTide: c.sky.uniforms.uTide.value, concluded: c.state.data.flags.concluded, money: c.state.data.money, chainStep: c.state.data.missions.chainStep, active: c.missions.active.length, slips: [...c.hud.elements.notify.children].map(s => s.textContent) };`)));
  // ---- loot
  console.log('LOOT', J(await R(`const o = c.loot.objects; const kinds = {}; for (const x of o) kinds[x.kind] = (kinds[x.kind] || 0) + 1; let nan = 0; for (const x of o) x.root.traverse(m => { if (m.geometry && m.geometry.boundingSphere && !isFinite(m.geometry.boundingSphere.radius)) nan++; }); return { total: o.length, kinds, spots: c.world.lootSpots.length, nanGeometries: nan };`)));
  const near = (kind) => R(`const o = c.loot.objects.find(x => x.kind === '${kind}'); return o ? { x: o.root.position.x, y: o.root.position.y, z: o.root.position.z } : null;`);
  const fl = await near('footlocker');
  if (fl) {
    await R(`r.teleport(${fl.x + 1.5}, ${fl.z + 1.2}); r.setTime(11);`);
    await fr(1); await api.run(face(fl.x, fl.y + 0.2, fl.z)); await fr(1);
    console.log('FOOTLOCKER PROMPT', await api.run(prompt));
    await api.run(interact);
    await R(`for (let i = 0; i < 8; i++) c.loot.update(0.05);`);
    await fr(2);
    await api.screenshot('footlocker-open');
    console.log('FOOTLOCKER', J(await R(`return { items: c.inventory.items, weapons: c.inventory.weapons.map(w => w.id), slips: [...c.hud.elements.notify.children].map(s => s.textContent), opened: c.state.data.flags.lootOpened, promptAfter: ${prompt} };`)));
  }
  const bag = await near('medBag');
  if (bag) { await R(`r.teleport(${bag.x + 1.0}, ${bag.z + 0.9});`); await fr(1); await api.run(face(bag.x, bag.y + 0.1, bag.z)); await fr(1); console.log('BAG PROMPT', await api.run(prompt)); await api.run(interact); await R(`for (let i = 0; i < 8; i++) c.loot.update(0.05);`); await fr(2); await api.screenshot('medbag-open'); }
  const tin = await near('ammoTin');
  if (tin) { await R(`r.teleport(${tin.x + 0.9}, ${tin.z + 0.8});`); await fr(1); await api.run(face(tin.x, tin.y + 0.06, tin.z)); await fr(1); console.log('TIN PROMPT', await api.run(prompt)); await api.run(interact); await R(`for (let i = 0; i < 8; i++) c.loot.update(0.05);`); await fr(2); await api.screenshot('ammotin-open'); console.log('TIN', J(await R(`return { ammo: c.inventory.ammo, slips: [...c.hud.elements.notify.children].map(s => s.textContent).slice(-1) };`))); }
  for (const k of ['bandage', 'battery', 'probe', 'ammoBox']) { const it = await near(k); console.log('LOOSE', k, it ? J(await R(`r.teleport(${it.x + 0.7}, ${it.z + 0.6}); c.player.update(0); ${face(it.x, it.y + 0.02, it.z)}; c.player.update(0); const p = ${prompt}; const n = c.loot.objects.length; ${interact}; return { prompt: p, removed: n - c.loot.objects.length };`)) : 'none'); }
  // ---- scares: the figure on the ridge
  await R(`c.enemies.removeAll(); c.debug.noEnemies = false; r.teleport(0, 250); r.setLook(0, 0.02); r.setTime(10);`);
  await fr(1);
  const ridge = await R(`const ok = c.scares.trigger('ridge'); const e = c.enemies.list[c.enemies.list.length - 1]; return { ok, enemies: c.enemies.list.length, state: e && e.state, pos: e ? e.position.toArray().map(v => +v.toFixed(1)) : null, player: c.player.position.toArray().map(v => +v.toFixed(1)), pending: c.scares.pending };`);
  console.log('RIDGE', J(ridge));
  if (ridge.pos) { await R(`const p = c.player; const dx = ${ridge.pos[0]} - p.eye.x, dz = ${ridge.pos[2]} - p.eye.z, dy = ${ridge.pos[1]} + 1.0 - p.eye.y; p.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)) * 0.6);`); }
  await fr(2);
  await api.screenshot('ridge');
  console.log('RIDGE HELD', J(await R(`const e = c.enemies.list[0]; return { enemies: c.enemies.list.length, state: e && e.state, speed: e && +e.moveSpeed.toFixed(3), pos: e && e.position.toArray().map(v => +v.toFixed(2)), observed: e && e.observedByPlayer(34), pending: c.scares.pending };`)));
  await R(`r.setLook(Math.PI, 0); for (let i = 0; i < 30; i++) c.scares.update(0.05); c.enemies.update(0.05);`);
  console.log('RIDGE GONE', J(await R(`return { enemies: c.enemies.list.length, pending: c.scares.pending, director: c.director.state };`)));
  for (const n of ['gunfire', 'clicks', 'radio', 'footsteps', 'torch', 'fragments']) {
    console.log('SCARE', n, J(await R(`c.state.data.flashlight.on = true; if ('${n}' === 'torch') c.state.data.hour = 23; c.director.rest(); const ok = c.scares.trigger('${n}'); for (let i = 0; i < 12; i++) c.scares.update(0.1); return { ok, pending: c.scares.pending, flashTarget: c.lighting.flashTarget, enemies: c.enemies.list.map(e => e.type) };`)));
  }
  console.log('AUTO', J(await R(`c.director.rest(); c.state.data.hour = 12; c.player.inBase = false; let fired = 0; const off = c.events.on('directorNotify', (k) => { if (k === 'unease') fired++; }); for (let i = 0; i < 9000; i++) c.scares.update(0.05); off(); return { fired, pending: c.scares.pending, director: c.director.state };`)));
  // ---- tide: content disposed and re-rolled
  console.log('TIDE', J(await R(`const ms = c.missions.available(); c.missions.accept(ms.find(x => x.type === 'SURVEY' || x.type === 'RETRIEVAL').id); const sb = c.scene.children.length, lb = c.loot.objects.length; const objsBefore = [...c.missions.objects.values()].reduce((n, l) => n + l.length, 0); c.events.emit('tide', 2); c.enemies.update(0.05); const objsAfter = [...c.missions.objects.values()].reduce((n, l) => n + l.length, 0); return { sceneBefore: sb, sceneAfter: c.scene.children.length, lootBefore: lb, lootAfter: c.loot.objects.length, missionObjs: [objsBefore, objsAfter], active: c.missions.active.map(x => x.id), pending: c.scares.pending, enemies: c.enemies.list.length, opened: c.state.data.flags.lootOpened.length };`)));
  await fr(1);
  console.log('STATS', J(await api.run('window.__radius.stats()')));
}
