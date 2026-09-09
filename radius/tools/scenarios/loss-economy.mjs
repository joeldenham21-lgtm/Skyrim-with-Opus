// The curves, with no rendering involved: the reissue ladder, the reissue bill against the money the
// zone actually pays, the decay of a body across Tides, and the fracture.
// Everything here is driven straight through the systems in a page context, so it costs a second.
export default async function (page, api) {
  // Never api.start(): it waits on six rendered frames, and SwiftShader on a loaded box is well under
  // one frame a second. Nothing in this test needs a pixel — the whole loss economy is numbers.
  await api.run(`window.__radius.ctx.debug.noEnemies = true; window.__radius.start();`);

  const ladder = await api.run(`(() => {
    const ctx = window.__radius.ctx, inv = ctx.inventory;
    // never cache state.data: game.start(false) replaces the object, which is exactly what respawn does
    const D = () => ctx.state.data;
    ctx.game.respawn = function () { ctx.damage.respawn(); ctx.time.sleepToMorning(); ctx.state.save(); ctx.events.emit('respawn'); ctx.game.start(false); };
    const rows = [];
    D().money = 600; D().flags.deathStreak = 0;
    const saveWorks = ctx.state.hasSave ? !!ctx.state.hasSave() : null;
    for (let i = 0; i < 6; i++) {
      const before = D(), m0 = before.money;
      ctx.player.teleport(-130, 60 + i);
      ctx.player.die({ kind: 'bullet' });
      ctx.game.respawn();
      const d = D(), w = inv.weapons[0];
      rows.push({
        death: i + 1, streak: d.flags.deathStreak, reloaded: d !== before, moneyBefore: m0, moneyAfter: d.money, billed: m0 - d.money,
        rounds: (w.mag ? w.mag.rounds : 0) + (w.chamber ? 1 : 0) + (inv.items['9x18_fmj'] || 0),
        cond: w.parts.barrel, dirt: +w.dirt.toFixed(2), bandage: inv.items.bandage || 0, probe: inv.items.probe || 0,
        torch: Math.round(d.flashlight.battery), caches: (d.caches || []).length,
        bodyEntries: (d.caches || []).map((c) => c.entries.length),
      });
    }
    rows.saveWorks = saveWorks;
    return { saveWorks, rows };
  })()`);
  console.log('LADDER saveWorks=' + ladder.saveWorks);
  for (const r of ladder.rows) console.log('  ' + JSON.stringify(r));

  const reset = await api.run(`(() => {
    const ctx = window.__radius.ctx, d = ctx.state.data, inv = ctx.inventory;
    ctx.events.emit('sleep');                       // a night at Vanno forgives the ladder
    const streak = ctx.state.data.flags.deathStreak;
    ctx.state.data.money = 900;
    ctx.player.teleport(-100, 40);
    ctx.player.die({ kind: 'bullet' });
    ctx.game.respawn();
    const w = inv.weapons[0];
    return { streakAfterSleep: streak, billed: 900 - ctx.state.data.money, cond: w.parts.barrel, rounds: (w.mag ? w.mag.rounds : 0) + 1 + (inv.items['9x18_fmj'] || 0) };
  })()`);
  console.log('SLEEP RESETS ' + JSON.stringify(reset));

  const decay = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const d = ctx.state.data;
    d.caches = [];
    ctx.player.teleport(-160, 20);
    ctx.inventory.add('762_fmj', 90); ctx.inventory.add('bandage', 6); window.__radius.giveWeapon('akm');
    ctx.player.die({ kind: 'bullet' });
    const snap = () => { const c = (d.caches || [])[0]; return c ? { tides: c.tides | 0, degraded: !!c.degraded, entries: c.entries.length, rounds: (c.entries.find((e) => e.id === '762_fmj') || {}).count || 0, bandage: (c.entries.find((e) => e.id === 'bandage') || {}).count || 0 } : null; };
    const out = { atDeath: snap() };
    ctx.events.emit('tide', d.tideLevel);
    out.afterTide1 = snap();
    ctx.events.emit('tide', d.tideLevel);
    out.afterTide2 = snap();
    return out;
  })()`);
  console.log('DECAY ' + JSON.stringify(decay, null, 1));

  const leg = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const base = ctx.damage.speedMul, baseStam = ctx.damage.staminaRegenMul;
    ctx.damage.breakLeg();
    const hurtSpeed = ctx.damage.speedMul, hurtStam = ctx.damage.staminaRegenMul;
    const walk = 3.6 * hurtSpeed, sprint = 6.2 * hurtSpeed;
    const survived = ctx.state.data.fracture;
    ctx.player.die({ kind: 'bullet' }); ctx.game.respawn();
    const pastDeath = ctx.state.data.fracture;
    ctx.inventory.add('splint', 1);
    ctx.damage.use('splint');
    return { base, hurtSpeed, hurtStam, walk: +walk.toFixed(2), sprint: +sprint.toFixed(2), survived, pastDeath, afterSplint: ctx.state.data.fracture };
  })()`);
  console.log('FRACTURE ' + JSON.stringify(leg));

  // what a death is actually worth, against what a contract pays
  const worth = await api.run(`(() => {
    const ctx = window.__radius.ctx, inv = ctx.inventory;
    const D = (id) => { try { return ctx.__def ? ctx.__def(id) : null; } catch { return null; } };
    return { money: ctx.state.data.money, weight: +inv.weight().toFixed(2), capacity: inv.capacity() };
  })()`);
  console.log('STATE ' + JSON.stringify(worth));
}
