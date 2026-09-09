// Scarcity census: measures the world's loot surface without rendering a frame.
// Reports how many loot spots the structures registered, by POI kind and spot kind, and what
// game/loot.js actually built out of them. The arithmetic that turns this into money lives in
// tools/scenarios/scarcity-curve.mjs, which is plain node and needs no browser.
export default async (page, api) => {
  await api.start();
  const out = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const spots = {}, kinds = {};
    for (const s of ctx.world.lootSpots) {
      const poi = ctx.world.poi(s.poi); const pk = poi ? poi.kind : 'field';
      spots[pk] = spots[pk] || { total: 0, shelf: 0, floor: 0, crate: 0 };
      spots[pk].total++; spots[pk][s.kind] = (spots[pk][s.kind] || 0) + 1;
      kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    }
    const built = {}, byPoi = {};
    for (const o of ctx.loot.objects) {
      built[o.kind] = (built[o.kind] || 0) + 1;
      if (o.type === 'container') { const k = (o.name.split(' · ')[1] || 'FIELD'); byPoi[k] = (byPoi[k] || 0) + 1; }
    }
    const tiers = {};
    for (const k of ['checkpoint','convoy','village','industrial','church','rail','forest','marsh','anomaly','ridge','field']) tiers[k] = ctx.loot.tierAt(k);
    const spawn = {};
    for (const s of ctx.world.spawnSpots) { const poi = ctx.world.poi(s.poi); const pk = poi ? poi.kind : 'field'; spawn[pk] = spawn[pk] || {}; spawn[pk][s.kind] = (spawn[pk][s.kind]||0)+1; }
    return { lootSpots: ctx.world.lootSpots.length, spots, kinds, objects: ctx.loot.objects.length, built, byPoi, tiers, spawnSpots: ctx.world.spawnSpots.length, spawn,
             money: ctx.state.data.money, day: ctx.state.data.day, tide: ctx.state.data.tideLevel, sec: ctx.state.data.securityLevel };
  })()`);
  console.log('CENSUS ' + JSON.stringify(out, null, 1));
};
