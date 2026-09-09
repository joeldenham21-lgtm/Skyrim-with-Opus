// The curves, with no rendering involved: the reissue ladder, the reissue bill against the money the
// zone actually pays, the decay of a body across Tides, and the fracture.
// Everything here is driven straight through the systems in a page context, so it costs a second.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();

  const ladder = await api.run(`(() => {
    const ctx = window.__radius.ctx, d = ctx.state.data, inv = ctx.inventory;
    ctx.game.respawn = function () { ctx.damage.respawn(); ctx.time.sleepToMorning(); ctx.state.save(); ctx.events.emit('respawn'); ctx.game.start(false); };
    const rows = [];
    d.money = 600; d.flags.deathStreak = 0;
    for (let i = 0; i < 6; i++) {
      const m0 = d.money;
      ctx.player.teleport(-130, 60 + i);
      ctx.player.die({ kind: 'bullet' });
      ctx.game.respawn();
      const w = inv.weapons[0];
      rows.push({
        death: i + 1, streak: d.flags.deathStreak, moneyBefore: m0, moneyAfter: d.money, billed: m0 - d.money,
        rounds: (w.mag ? w.mag.rounds : 0) + (w.chamber ? 1 : 0) + (inv.items['9x18_fmj'] || 0),
        cond: w.parts.barrel, dirt: +w.dirt.toFixed(2), bandage: inv.items.bandage || 0, probe: inv.items.probe || 0,
        torch: Math.round(d.flashlight.battery), caches: (d.caches || []).length,
      });
    }
    return rows;
  })()`);
  console.log('LADDER');
  for (const r of ladder) console.log('  ' + JSON.stringify(r));

  const reset = await api.run(`(() => {
    const ctx = window.__radius.ctx, d = ctx.state.data, inv = ctx.inventory;
    ctx.events.emit('sleep');                       // a night at Vanno forgives the ladder
    const streak = d.flags.deathStreak;
    d.money = 900;
    ctx.player.teleport(-100, 40);
    ctx.player.die({ kind: 'bullet' });
    ctx.game.respawn();
    const w = inv.weapons[0];
    return { streakAfterSleep: streak, billed: 900 - d.money, cond: w.parts.barrel, rounds: (w.mag ? w.mag.rounds : 0) + 1 + (inv.items['9x18_fmj'] || 0) };
  })()`);
  console.log('SLEEP RESETS ' + JSON.stringify(reset));

  const decay = await api.run(`(() => {
    const ctx = window.__radius.ctx, d = ctx.state.data;
    d.caches = [];
    ctx.player.teleport(-160, 20);
    ctx.inventory.add('7.62x39_ps', 90); ctx.inventory.add('bandage', 6); window.__radius.giveWeapon('akm');
    ctx.player.die({ kind: 'bullet' });
    const snap = () => { const c = (d.caches || [])[0]; return c ? { tides: c.tides | 0, degraded: !!c.degraded, entries: c.entries.length, rounds: (c.entries.find((e) => e.id === '7.62x39_ps') || {}).count || 0, bandage: (c.entries.find((e) => e.id === 'bandage') || {}).count || 0 } : null; };
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
