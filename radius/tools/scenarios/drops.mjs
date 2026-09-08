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
  // The body takes deathDuration (2.2 s) to fold and only then leaves its pile. dt is clamped to
  // 0.05 per frame, so waiting on RENDERED frames under software rendering advances barely a second
  // of simulated time — the same trap the death-screen typewriter hid behind. Drive the simulation
  // directly instead: 120 steps of 0.05 is six seconds, with no rendering to wait for.
  await R(`const e = c.enemies.list.find(x => x.alive && x.type === 'mimic'); if (e) { window.__killed = e.cls || e.type; e.damage(9999, { kind: 'bullet', source: 'player' }); }`);
  await R(`for (let i = 0; i < 120; i++) { try { c.enemies.update(0.05); } catch (err) { window.__updErr = String(err.message); break; } }`);
  await api.frames(2);
  console.log('SIM', JSON.stringify(await R(`return { killed: window.__killed || null, updateError: window.__updErr || null };`)));
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
  // repeat over several kills: a single corpse tells you nothing when drops are probabilistic
  const many = await R(`
    let killed = 0;
    const before = c.loot.markers().filter(m => m.kind !== 'container').length;
    for (let k = 0; k < 6; k++) {
      const e = c.enemies.list.find(x => x.alive && x.type === 'mimic');
      if (!e) break;
      e.damage(9999, { kind: 'bullet', source: 'player' }); killed++;
      for (let i = 0; i < 80; i++) c.enemies.update(0.05);
    }
    const after = c.loot.markers().filter(m => m.kind !== 'container').length;
    return { killed, pilesBefore: before, pilesAfter: after, gained: after - before };`);
  console.log('MANY_KILLS', JSON.stringify(many));
  console.log('ERRORS', JSON.stringify(await R(`return [...(c._errors || [])];`)));
}
