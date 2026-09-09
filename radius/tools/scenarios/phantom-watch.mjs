// The phantom's new behaviour: sometimes it just stands at distance and watches, and is gone the moment you
// look straight at it. Drive it directly for a long simulated stretch and count what it actually does — the
// failure modes are a state that never fires and one that never leaves.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  // One evaluate per trial, not one for all of them. Eight trials of 1200 ticks in a single call blocked the
  // page for hours once the AI grew heavier — the harness now abandons a scenario at 600 s, and this is the
  // shape that trips it. 500 ticks is 25 simulated seconds, plenty to see the state machine cycle.
  const totals = { states: {}, watchEntries: 0, quietLeaves: 0, screams: 0, grabs: 0, watchDists: [], errors: [] };
  await api.run(`(() => { const r = window.__radius; r.god(true); r.teleport(60, 210); r.setLook(0, 0); })()`);
  for (let trial = 0; trial < 6; trial++) {
    const t = await api.run(`(() => {
      const ctx = window.__radius.ctx, r = window.__radius, p = ctx.player;
      for (const e of ctx.enemies.list) e.removeMe = true;
      ctx.enemies.update(0.05);
      const ph = r.spawn('phantom', p.position.x + 24, p.position.z - 18);
      if (!ph) return { error: 'spawn failed' };
      ph.aware = 1; ph.setEngaged && ph.setEngaged(true);
      const seen = {}, watchDists = [];
      let watchEntries = 0, quietLeaves = 0, screams = 0, grabs = 0, last = null, error = null;
      for (let i = 0; i < 500; i++) {
        ctx.elapsed += 0.05;
        try { ctx.enemies.update(0.05); } catch (err) { error = String(err && err.message); break; }
        if (!ph.alive) break;
        const st = ph.state;
        seen[st] = (seen[st] || 0) + 1;
        if (st !== last) {
          if (st === 'watch') { watchEntries++; watchDists.push(+Math.hypot(ph.position.x - p.position.x, ph.position.z - p.position.z).toFixed(1)); }
          if (st === 'scream') screams++;
          if (st === 'grab') grabs++;
          if (last === 'watch' && st === 'idle') quietLeaves++;
          last = st;
        }
      }
      return { seen, watchEntries, quietLeaves, screams, grabs, watchDists, error };
    })()`);
    if (t.error) { totals.errors.push(t.error); continue; }
    for (const k in t.seen) totals.states[k] = (totals.states[k] || 0) + t.seen[k];
    totals.watchEntries += t.watchEntries; totals.quietLeaves += t.quietLeaves;
    totals.screams += t.screams; totals.grabs += t.grabs;
    totals.watchDists.push(...t.watchDists);
  }
  const out = {
    states: totals.states, watchEntries: totals.watchEntries, quietLeaves: totals.quietLeaves,
    screams: totals.screams, grabs: totals.grabs,
    watchDistance: totals.watchDists.length
      ? { min: Math.min(...totals.watchDists), max: Math.max(...totals.watchDists), n: totals.watchDists.length }
      : null,
    errors: totals.errors.slice(0, 5),
  };
  console.log('PHANTOM ' + JSON.stringify(out, null, 1));
  const st = out.states || {};
  console.log(`SUMMARY watchEntries=${out.watchEntries} quietLeaves=${out.quietLeaves} screams=${out.screams} grabs=${out.grabs} states=${Object.keys(st).join(',')} errors=${out.errors.length}`);
}
