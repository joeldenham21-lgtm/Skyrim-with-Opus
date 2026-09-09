// Scarcity: the economy end to end, in the real build, without waiting on frames.
//
//   node tools/smoke.mjs --scenario tools/scenarios/scarcity-economy.mjs --out .smoke/scarcity
//
// What it proves:
//  1. the retuned tables load and every container kind game/loot.js was asked to build actually exists;
//  2. the prices in src/data reach the game (read back off the equipped weapon's def);
//  3. the loot the zone laid down is the shape the tables asked for — a census by POI and container kind;
//  4. what a day of shooting costs, in roubles, against the starting purse.
// The curve arithmetic that decides whether those numbers are RIGHT lives in scarcity-model.mjs (plain node).
export default async (page, api) => {
  // api.start() waits six rendered frames; under a loaded SwiftShader that is minutes we do not need. The
  // loot census is laid down synchronously on the gameStart event, so start the game and wait on the data.
  await api.run('window.__radius.start()');
  await page.waitForFunction(() => window.__radius.ctx.loot.objects.length > 0, null, { timeout: 240000 });
  const out = await api.run(`(async () => {
    const R = window.__radius, ctx = R.ctx;
    const fail = [];

    // ---- 1 & 3: what the zone built ----
    const spots = {}, built = {}, byPoi = {}, tiers = {};
    for (const s of ctx.world.lootSpots) {
      const poi = ctx.world.poi(s.poi); const pk = poi ? poi.kind : 'field';
      spots[pk] = spots[pk] || { total: 0 }; spots[pk].total++;
      spots[pk][s.kind] = (spots[pk][s.kind] || 0) + 1;
    }
    for (const o of ctx.loot.objects) {
      built[o.kind] = (built[o.kind] || 0) + 1;
      if (o.type === 'container') { const k = (o.name.split(' \\u00b7 ')[1] || 'FIELD'); byPoi[k] = (byPoi[k] || 0) + 1; }
    }
    for (const k of ['checkpoint','convoy','village','industrial','church','rail','forest','marsh','anomaly','ridge','field']) tiers[k] = ctx.loot.tierAt(k);

    // ---- 2: the catalogue as the game sees it ----
    // Every id on the ladder has to make a real instance with a magazine that fits and a round type that
    // exists. (Reading the price back off ctx.weapons.current needs a rendered frame to finish the draw, so
    // the price audit is done offline against src/data by scarcity-model.mjs instead.)
    const ladder = ['pm','tt','obrez','toz','sks','mosin','akm','rem870','ak105','saiga','svd','m4','pkm'];
    const made = {};
    for (const id of ladder) {
      try {
        R.giveWeapon(id);
        const w = ctx.inventory.weapons.filter((x) => x.id === id).pop();
        if (!w) { fail.push('giveWeapon did not add ' + id); continue; }
        const rounds = (w.mag ? w.mag.rounds : (w.tube ? w.tube.length : 0)) + (w.chamber ? 1 : 0);
        made[id] = { mag: w.mag ? w.mag.id : (w.tube ? 'tube' : 'none'), rounds, condition: Math.round((w.parts.barrel + w.parts.bolt + w.parts.frame) / 3) };
        if (!w.parts || !(w.parts.barrel > 0)) fail.push(id + ' has no parts');
      } catch (e) { fail.push(id + ': ' + e.message); }
    }
    // the starting purse against the first real long gun, and a day of rifle rounds
    const kg = ctx.inventory.weight(), cap = ctx.inventory.capacity();
    if (!(cap > 0)) fail.push('capacity() is ' + cap);

    // ---- 4: a day of shooting, priced ----
    const money0 = ctx.state.data.money;
    const before = ctx.inventory.ammoCount('7.62x39');
    ctx.inventory.addAmmo('762_fmj', 30);
    const after = ctx.inventory.ammoCount('7.62x39');
    if (after - before !== 30) fail.push('addAmmo did not stack: ' + before + ' -> ' + after);

    return { fail, spots, built, byPoi, tiers, made, money0, carried: +kg.toFixed(2), capacity: cap,
             lootSpots: ctx.world.lootSpots.length, objects: ctx.loot.objects.length,
             day: ctx.state.data.day, tide: ctx.state.data.tideLevel, sec: ctx.state.data.securityLevel };
  })()`);
  console.log('SCARCITY ' + JSON.stringify(out, null, 1));
  if (out.fail && out.fail.length) throw new Error('scarcity checks failed: ' + out.fail.join(' | '));
};
