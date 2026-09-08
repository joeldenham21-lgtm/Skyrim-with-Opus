// Do enemies actually drop what they carried? This path has never been executed: mimic.js has always
// called ctx.loot.spawnPile(), which did not exist until now, so every corpse dropped nothing.
//   node tools/smoke.mjs --scenario tools/scenarios/drops.mjs --out .smoke/drops
export default async function (page, api) {
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  await api.start();
  await api.frames(3);

  // NB: piles live in loot.js's private `objects` array as type 'pile'; there is no loot.piles.
  // markers() is the only public enumeration, and reports piles by their markerKind.
  console.log('LOOT_API', JSON.stringify(await R(`
    return { spawnPile: typeof c.loot.spawnPile, dropItem: typeof c.loot.dropItem,
             markers: typeof c.loot.markers, pilesNow: c.loot.markers().filter(m => m.kind !== 'container').length };`)));

  // put a mimic in front of the player, in the open, and see what it is carrying
  await R(`r.teleport(0, 250); r.setTime(11); c.player.setLook(Math.PI, 0);`);
  await api.frames(2);
  const spawned = await R(`
    const e = r.spawn('mimic', 0, 256);
    if (!e) return { spawned: false };
    const w = e.weapon || e.gun || (e.loadout && e.loadout.weapon);
    return { spawned: true, type: e.type, hp: e.hp, cls: e.cls || e.className || (e.loadout && e.loadout.cls),
             carriedWeapon: w && (w.id || w), armour: (e.loadout && (e.loadout.armor || e.loadout.armour)) || null,
             keys: Object.keys(e).slice(0, 40).join(',') };`);
  console.log('SPAWNED', JSON.stringify(spawned));
  await api.frames(3);

  // kill it outright and let the death animation run
  const before = await R(`return { piles: c.loot.markers().filter(m => m.kind !== 'container').length, alive: c.enemies.list.filter(e => e.alive).length };`);
  await R(`const e = c.enemies.list.find(x => x.alive && x.type === 'mimic'); if (e) e.damage(9999, { kind: 'bullet', source: 'player' });`);
  await api.frames(10);
  await api.wait(2500);
  await api.frames(10);
  const after = await R(`
    const piles = c.loot.markers().filter(m => m.kind !== 'container');
    const p = piles[piles.length - 1];
    return { pilesBefore: ${before.piles}, pilesAfter: piles.length,
             alive: c.enemies.list.filter(e => e.alive).length,
             newest: p || null };`);
  console.log('AFTER_KILL', JSON.stringify(after, null, 1));

  // walk onto the body and check it offers an interaction
  if (after.newest) {
    await R(`const p = c.loot.markers().filter(m => m.kind !== 'container').pop();
      if (p) r.teleport(p.x, p.z + 1.1);`);
    await api.frames(4);
    console.log('PROMPT_ON_BODY', JSON.stringify(await R(`
      return { interactTarget: !!(c.interact && c.interact.current),
               prompt: c.hud.elements.prompt.textContent.trim().slice(0, 80) };`)));
    await api.screenshot('body');
  }
  console.log('ERRORS', JSON.stringify(await R(`return [...(c._errors || [])];`)));
}
