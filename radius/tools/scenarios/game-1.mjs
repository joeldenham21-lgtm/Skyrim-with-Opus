// Game agent playtest: missions (list/accept/objective/pickup/deliver), loot (populate/open), scares (ridge), tide disposal.
const face = (x, y, z) => `(() => { const c = window.__radius.ctx; const p = c.player; const dx = ${x} - p.eye.x, dz = ${z} - p.eye.z, dy = ${y} - p.eye.y; const yaw = Math.atan2(-dx, -dz); const pitch = Math.atan2(dy, Math.hypot(dx, dz)); p.setLook(yaw, pitch); })()`;
export default async function (page, api) {
  await api.start();
  await api.frames(6);
  const list = await api.run(`window.__radius.ctx.missions.available().map(m => [m.id, m.title, m.payment, m.requirements.join('; ')])`);
  console.log('AVAILABLE', JSON.stringify(list));
  const body = await api.run(`window.__radius.ctx.missions.available().map(m => m.heading + ' — ' + m.body).join('\\n')`);
  console.log(body);
  // accept the Object 12 retrieval (or the first retrieval offered)
  const id = await api.run(`(() => { const ms = window.__radius.ctx.missions.available(); const m = ms.find(m => m.code === 'PSC-0417') || ms.find(m => m.type === 'RETRIEVAL'); return m.id; })()`);
  const ok = await api.run(`window.__radius.ctx.missions.accept('${id}')`);
  await api.frames(3);
  const obj = await api.run(`(() => { const c = window.__radius.ctx; const o = c.hud.elements.objective; return { accepted: ${ok}, hidden: o.classList.contains('hidden'), text: o.textContent, active: c.missions.active.map(m => [m.id, m.status]) }; })()`);
  console.log('OBJECTIVE', JSON.stringify(obj));
  const spot = await api.run(`(() => { const m = window.__radius.ctx.missions.active[0]; return m.spot; })()`);
  console.log('SPOT', JSON.stringify(spot));
  // walk up to it and look at it
  await api.run(`window.__radius.teleport(${spot.x + 1.3}, ${spot.z + 1.1})`);
  await api.frames(2);
  await api.run(face(spot.x, spot.y + 0.1, spot.z));
  await api.frames(6);
  await api.screenshot('mission-recorder');
  const cur = await api.run(`(() => { const c = window.__radius.ctx; const it = c.interact.current; return { prompt: it ? (typeof it.prompt === 'function' ? it.prompt() : it.prompt) : null, dist: it ? c.player.eye.distanceTo(typeof it.position === 'function' ? it.position() : it.position).toFixed(2) : null, promptEl: c.hud.elements.prompt.textContent }; })()`);
  console.log('INTERACT', JSON.stringify(cur));
  await api.run(`window.__radius.ctx.interact.current && window.__radius.ctx.interact.current.onInteract()`);
  await api.frames(3);
  const after = await api.run(`(() => { const c = window.__radius.ctx; const m = c.missions.active[0]; return { has: c.inventory.count(m.item), deliverable: c.missions.deliverable(m), objective: c.hud.elements.objective.textContent, moneyBefore: c.state.data.money }; })()`);
  console.log('AFTER PICKUP', JSON.stringify(after));
  const done = await api.run(`(() => { const c = window.__radius.ctx; const m = c.missions.active[0]; const r = c.missions.complete(m.id); return { r, money: c.state.data.money, earned: c.state.data.earned, level: c.state.data.securityLevel, active: c.missions.active.length, completed: c.missions.completed, availableNow: c.missions.available().map(m => m.id) }; })()`);
  console.log('COMPLETE', JSON.stringify(done));
  // survey: accept, plant one beacon
  const sid = await api.run(`(() => { const ms = window.__radius.ctx.missions.available(); const m = ms.find(m => m.type === 'SURVEY'); return m ? m.id : null; })()`);
  if (sid) {
    await api.run(`window.__radius.ctx.missions.accept('${sid}')`);
    await api.frames(2);
    const pt = await api.run(`(() => { const c = window.__radius.ctx; const m = c.missions.active.find(m => m.type === 'SURVEY'); const p = m.points[0]; return { x: p.x, z: p.z, y: c.world.getHeight(p.x, p.z), beacons: c.inventory.count('beacon'), objective: c.hud.elements.objective.textContent }; })()`);
    console.log('SURVEY', JSON.stringify(pt));
    await api.run(`window.__radius.teleport(${pt.x + 1.6}, ${pt.z + 1.4})`);
    await api.frames(2);
    await api.run(face(pt.x, pt.y + 0.5, pt.z));
    await api.frames(6);
    await api.screenshot('survey-stake');
    const sp = await api.run(`(() => { const c = window.__radius.ctx; const it = c.interact.current; return it ? (typeof it.prompt === 'function' ? it.prompt() : it.prompt) : null; })()`);
    console.log('STAKE PROMPT', sp);
    await api.run(`window.__radius.ctx.interact.current && window.__radius.ctx.interact.current.onInteract()`);
    await api.frames(8);
    await api.screenshot('survey-beacon');
    const st = await api.run(`(() => { const c = window.__radius.ctx; const m = c.missions.active.find(m => m.type === 'SURVEY'); return { done: m.points.map(p => p.done), beacons: c.inventory.count('beacon'), objective: c.hud.elements.objective.textContent }; })()`);
    console.log('PLANTED', JSON.stringify(st));
  }
  // loot
  const loot = await api.run(`(() => { const c = window.__radius.ctx; c.loot.populate(); const o = c.loot.objects; const kinds = {}; for (const x of o) kinds[x.kind] = (kinds[x.kind] || 0) + 1; return { total: o.length, kinds, spots: c.world.lootSpots.length }; })()`);
  console.log('LOOT', JSON.stringify(loot));
  const tin = await api.run(`(() => { const c = window.__radius.ctx; const o = c.loot.objects.find(x => x.kind === 'footlocker') || c.loot.objects.find(x => x.kind === 'ammoTin'); return o ? { kind: o.kind, x: o.root.position.x, y: o.root.position.y, z: o.root.position.z } : null; })()`);
  console.log('CONTAINER', JSON.stringify(tin));
  if (tin) {
    await api.run(`window.__radius.teleport(${tin.x + 1.5}, ${tin.z + 1.2})`);
    await api.frames(2);
    await api.run(face(tin.x, tin.y + 0.2, tin.z));
    await api.frames(6);
    await api.screenshot('loot-closed');
    const lp = await api.run(`(() => { const c = window.__radius.ctx; const it = c.interact.current; return it ? (typeof it.prompt === 'function' ? it.prompt() : it.prompt) : null; })()`);
    console.log('LOOT PROMPT', lp);
    await api.run(`window.__radius.ctx.interact.current && window.__radius.ctx.interact.current.onInteract()`);
    await api.frames(10);
    await api.screenshot('loot-open');
    const inv = await api.run(`(() => { const c = window.__radius.ctx; return { items: c.inventory.items, ammo: c.inventory.ammo, slips: [...c.hud.elements.notify.children].map(s => s.textContent) }; })()`);
    console.log('INVENTORY', JSON.stringify(inv));
  }
  // a medical bag and loose items up close
  const bag = await api.run(`(() => { const c = window.__radius.ctx; const o = c.loot.objects.find(x => x.kind === 'medBag'); return o ? { x: o.root.position.x, y: o.root.position.y, z: o.root.position.z } : null; })()`);
  if (bag) { await api.run(`window.__radius.teleport(${bag.x + 1.1}, ${bag.z + 0.9})`); await api.frames(2); await api.run(face(bag.x, bag.y + 0.1, bag.z)); await api.frames(6); await api.screenshot('loot-medbag'); }
  const tinB = await api.run(`(() => { const c = window.__radius.ctx; const o = c.loot.objects.find(x => x.kind === 'ammoTin'); return o ? { x: o.root.position.x, y: o.root.position.y, z: o.root.position.z } : null; })()`);
  if (tinB) { await api.run(`window.__radius.teleport(${tinB.x + 1.0}, ${tinB.z + 0.8})`); await api.frames(2); await api.run(face(tinB.x, tinB.y + 0.05, tinB.z)); await api.frames(6); await api.screenshot('loot-ammotin'); }
  // scares: figure on the ridge, facing north on open ground south of the checkpoint
  await api.run(`(() => { const r = window.__radius; r.teleport(0, 250); r.setLook(0, 0.02); r.setTime(10); })()`);
  await api.frames(4);
  const ridge = await api.run(`(() => { const c = window.__radius.ctx; const ok = c.scares.trigger('ridge'); const e = c.enemies.list[c.enemies.list.length - 1]; return { ok, enemies: c.enemies.list.length, pos: e ? e.position.toArray().map(v => +v.toFixed(1)) : null, player: c.player.position.toArray().map(v => +v.toFixed(1)), pending: c.scares.pending, director: c.director.state }; })()`);
  console.log('RIDGE', JSON.stringify(ridge));
  await api.frames(4);
  await api.screenshot('scare-ridge');
  // look away: the figure should be gone
  await api.run(`window.__radius.setLook(Math.PI, 0)`);
  await api.frames(8);
  const gone = await api.run(`(() => { const c = window.__radius.ctx; return { enemies: c.enemies.list.length, pending: c.scares.pending, director: c.director.state }; })()`);
  console.log('RIDGE GONE', JSON.stringify(gone));
  for (const n of ['gunfire', 'clicks', 'radio', 'footsteps', 'torch', 'fragments']) {
    const r = await api.run(`(() => { const c = window.__radius.ctx; c.state.data.flashlight.on = true; if ('${n}' === 'torch') c.state.data.hour = 23; return { ok: c.scares.trigger('${n}'), pending: c.scares.pending }; })()`);
    console.log('SCARE', n, JSON.stringify(r));
    await api.frames(3);
  }
  // tide: everything content-like must be disposed / re-rolled
  const before = await api.run(`(() => { const c = window.__radius.ctx; return { scene: c.scene.children.length, loot: c.loot.objects.length, enemies: c.enemies.list.length }; })()`);
  await api.run(`window.__radius.ctx.events.emit('tide', 2)`);
  await api.frames(4);
  const afterTide = await api.run(`(() => { const c = window.__radius.ctx; return { scene: c.scene.children.length, loot: c.loot.objects.length, enemies: c.enemies.list.length, missionsActive: c.missions.active.map(m => m.id), available: c.missions.available().map(m => m.id), pending: c.scares.pending }; })()`);
  console.log('TIDE', JSON.stringify(before), '->', JSON.stringify(afterTide));
  await api.screenshot('after-tide');
}
