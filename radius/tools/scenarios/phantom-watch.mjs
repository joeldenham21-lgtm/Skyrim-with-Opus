// The phantom's new behaviour: sometimes it just stands at distance and watches, and is gone the moment you
// look straight at it. Drive it directly for a long simulated stretch and count what it actually does — the
// failure modes are a state that never fires and one that never leaves.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  const out = await api.run(`(() => {
    const ctx = window.__radius.ctx, r = window.__radius;
    r.god(true); r.teleport(60, 210); r.setLook(0, 0);
    const seen = {}, dists = [], watchDists = [];
    let watchEntries = 0, quietLeaves = 0, grabs = 0, screams = 0, errors = [];
    const p = ctx.player;
    for (let trial = 0; trial < 8; trial++) {
      for (const e of ctx.enemies.list) e.removeMe = true;
      ctx.enemies.update(0.05);
      const ph = r.spawn('phantom', p.position.x + 24, p.position.z - 18);
      if (!ph) { errors.push('spawn failed'); break; }
      ph.aware = 1; ph.setEngaged && ph.setEngaged(true);
      let last = null;
      for (let i = 0; i < 1200; i++) {          // 60 simulated seconds per trial
        ctx.elapsed += 0.05;
        try { ctx.enemies.update(0.05); } catch (err) { errors.push(String(err && err.message)); break; }
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
        if (i % 40 === 0) dists.push(+Math.hypot(ph.position.x - p.position.x, ph.position.z - p.position.z).toFixed(1));
      }
    }
    return { states: seen, watchEntries, quietLeaves, screams, grabs,
             watchDistance: { min: Math.min(...watchDists), max: Math.max(...watchDists), n: watchDists.length },
             errors: errors.slice(0, 5) };
  })()`);
  console.log('PHANTOM ' + JSON.stringify(out, null, 1));
  const st = out.states || {};
  console.log(`SUMMARY watchEntries=${out.watchEntries} quietLeaves=${out.quietLeaves} screams=${out.screams} grabs=${out.grabs} states=${Object.keys(st).join(',')} errors=${out.errors.length}`);
}
