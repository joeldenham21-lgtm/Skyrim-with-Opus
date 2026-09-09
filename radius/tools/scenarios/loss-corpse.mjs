// The corpse run, end to end. Load an Explorer up with real kit and a stash at Vanno, kill them a long
// way out, then check that (a) nothing carried was deleted, (b) all of it is lying at the exact spot of
// death as a searchable body with a corpse mark on the sheet, (c) the stash at Vanno is untouched,
// (d) the reissue is a poor Makarov and a bill, and (e) walking back to the body returns the kit.
//
// respawn() is monkeypatched here to the exact shape of the main.js diff in the report, so this test runs
// the code path the orchestrator is being asked to wire, not a private helper.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();

  const before = await api.run(`(() => {
    const ctx = window.__radius.ctx, inv = ctx.inventory;
    ctx.game.respawn = function () {                       // <-- the proposed main.js respawn(), verbatim
      ctx.damage.respawn();
      ctx.time.sleepToMorning();
      ctx.state.save();
      ctx.events.emit('respawn');
      ctx.game.start(false);
    };
    // a mid-game loadout: rifle, spare glass, meds, an artifact, and money in the pocket
    window.__radius.giveWeapon('akm');
    inv.add('7.62x39_ps', 120); inv.add('medkit', 2); inv.add('art_pearl', 1); inv.add('probe', 8);
    inv.addMag(ctx.inventory.mags.length ? inv.mags[0] : null) , 0;
    ctx.state.data.money = 2600;
    // something safe at Vanno
    const st = ctx.state.data.storage = ctx.state.data.storage || { by: {} };
    st.by = st.by || {}; st.by.shelf_a = { weapons: [], mags: [], gear: [], items: { medkit: 3, '9x18_fmj': 90 } };
    ctx.player.teleport(-130, 60);
    return {
      money: ctx.state.data.money,
      weapons: inv.weapons.map((w) => w.id), mags: inv.mags.length,
      items: Object.fromEntries(Object.entries(inv.items).map(([k, v]) => [k, v])),
      weight: +inv.weight().toFixed(2), storage: st.by.shelf_a.items,
    };
  })()`);
  console.log('BEFORE ' + JSON.stringify(before));

  const died = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const p = { x: ctx.player.position.x, z: ctx.player.position.z };
    ctx.player.die({ kind: 'bullet' });
    const caches = ctx.state.data.caches || [];
    const marks = ctx.loot.markers().filter((m) => m.kind === 'corpse');
    const loss = ctx.damage.lossReport();
    return {
      at: [+p.x.toFixed(1), +p.z.toFixed(1)],
      caches: caches.length,
      cacheAt: caches[0] ? [+caches[0].x.toFixed(1), +caches[0].z.toFixed(1)] : null,
      entries: caches[0] ? caches[0].entries.length : 0,
      hasAkm: !!(caches[0] && caches[0].entries.some((e) => e.id === 'akm')),
      hasArtifact: !!(caches[0] && caches[0].entries.some((e) => e.id === 'art_pearl')),
      rounds: caches[0] ? (caches[0].entries.find((e) => e.id === '7.62x39_ps') || {}).count : 0,
      corpseMarks: marks.length,
      loss,
    };
  })()`);
  console.log('DIED ' + JSON.stringify(died, null, 1));

  const after = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    ctx.game.respawn();
    const inv = ctx.inventory, d = ctx.state.data;
    const w = inv.weapons[0];
    return {
      money: d.money, hp: d.hp, torch: Math.round(d.flashlight.battery),
      weapons: inv.weapons.map((x) => x.id),
      pmCondition: w ? w.parts : null, pmDirt: w ? +w.dirt.toFixed(2) : null,
      inGun: w && w.mag ? w.mag.rounds + (w.chamber ? 1 : 0) : 0,
      spareMags: inv.mags.map((m) => m.rounds),
      items: inv.items,
      weight: +inv.weight().toFixed(2), capacity: inv.capacity(),
      storage: (d.storage.by || {}).shelf_a,
      caches: (d.caches || []).length,
      corpseMarks: ctx.loot.markers().filter((m) => m.kind === 'corpse').length,
    };
  })()`);
  console.log('AFTER ' + JSON.stringify(after, null, 1));

  // walk back and take it all through the loot panel the player actually uses
  const recovered = await api.run(`(() => {
    const ctx = window.__radius.ctx, c = (ctx.state.data.caches || [])[0];
    if (!c) return { error: 'no cache' };
    ctx.player.teleport(c.x + 1.2, c.z);
    const o = ctx.loot.objects.find((x) => x.cacheId === c.id);
    if (!o) return { error: 'no pile object' };
    ctx.panels.open('loot', { pile: o.pile });
    const root = document.querySelector('#panels');
    const btn = root && [...root.querySelectorAll('button')].find((b) => (b.dataset.a || '') === 'takeall');
    if (btn) btn.click();
    const inv = ctx.inventory;
    const out = {
      clicked: !!btn,
      weapons: inv.weapons.map((x) => x.id),
      rounds762: inv.count('7.62x39_ps'), artifact: inv.count('art_pearl'),
      leftInPile: o.pile.entries.length,
      cachesLeft: (ctx.state.data.caches || []).length,
      weight: +inv.weight().toFixed(2), capacity: inv.capacity(),
    };
    ctx.panels.close();
    return out;
  })()`);
  console.log('RECOVERED ' + JSON.stringify(recovered, null, 1));
  console.log('SUMMARY ' + JSON.stringify({
    bodyLeft: died.caches === 1 && died.hasAkm && died.hasArtifact,
    onSpot: died.cacheAt && Math.abs(died.cacheAt[0] - died.at[0]) < 0.5,
    stashSafe: JSON.stringify(after.storage && after.storage.items) === JSON.stringify(before.storage),
    reissuePoor: after.weapons.length === 1 && after.weapons[0] === 'pm',
    billed: before.money - after.money,
    survivedRespawn: after.caches === 1 && after.corpseMarks === 1,
    recovered: recovered.weapons && recovered.weapons.includes('akm'),
  }));
}
