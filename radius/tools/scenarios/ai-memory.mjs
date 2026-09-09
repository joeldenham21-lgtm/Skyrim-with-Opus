// The zone's memory, end to end: contacts filed against a place, an approach bearing learned from them, a
// heavier garrison and a planted ambush on the next census, and the ambush springing when the player walks in
// the way he walked in last time. Also checks the fairness rule — a visit nobody saw and nobody heard teaches
// the zone nothing.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai-memory.mjs --out .smoke/ai-memory
import { boot } from './ai-bench.mjs';

// walk the player in from a bearing, making the given amount of noise, then walk him back out
const VISIT = (poi, ang, shots) => `(() => {
  const r = window.__radius, ctx = r.ctx;
  const P = ctx.world.poi('${poi}');
  const x = P.x + Math.cos(${ang}) * P.r * 0.5, z = P.z + Math.sin(${ang}) * P.r * 0.5;
  r.teleport(x, z); ctx.player.update(0);
  for (let i = 0; i < 40; i++) {
    ctx.elapsed += 0.25;
    if (${shots} && i % 6 === 0 && i < ${shots} * 6) ctx.director.notify('shot', { pos: ctx.player.position.clone(), noise: 1 });
    ctx.director.update(0.25);
  }
  // leave: far enough that the visit closes
  r.teleport(P.x + 320 > ctx.world.half ? P.x - 320 : P.x + 320, P.z); ctx.player.update(0);
  for (let i = 0; i < 12; i++) { ctx.elapsed += 0.25; ctx.director.update(0.25); }
  return ctx.director.memory();
})()`;

export default async function (page, api) {
  await boot(api);
  await api.run(`(() => { const ctx = window.__radius.ctx; ctx.director.forgetAll(); ctx.debug.noEnemies = true; window.__radius.god(true); })()`);

  // 1. a quiet visit teaches it nothing
  console.log('quiet   ', JSON.stringify(await api.run(VISIT('zarya', 0.6, 0))));
  // 2. two loud visits from the same bearing
  console.log('loud 1  ', JSON.stringify(await api.run(VISIT('zarya', 0.6, 5))));
  console.log('loud 2  ', JSON.stringify(await api.run(VISIT('zarya', 0.6, 5))));
  console.log('hotspots', JSON.stringify(await api.run('window.__radius.ctx.director.hotspots(4).map((h) => ({ x: Math.round(h.x), z: Math.round(h.z), heat: +h.heat.toFixed(2) }))')));

  // 3. the next census: a heavier garrison and a group planted on the bearing it watched us come in on
  const plan = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    ctx.debug.noEnemies = false; ctx.state.data.tideLevel = 2;
    const n = ctx.population.populate();
    const rec = ctx.director.poiRecord('zarya');
    return { planned: n, ambushes: ctx.population.ambushes, ambushPlanned: ctx.population.ambushPlanned, patrols: ctx.population.patrols, contacts: rec ? rec.contacts : 0, ang: rec ? +rec.ang.toFixed(2) : null };
  })()`);
  console.log('census  ', JSON.stringify(plan));

  // 4. walk in on that bearing and see whether anything is sitting on it
  const spring = await api.run(`(() => {
    const r = window.__radius, ctx = r.ctx;
    const P = ctx.world.poi('zarya'), rec = ctx.director.poiRecord('zarya');
    const a = rec ? rec.ang : 0.6;
    const log = [];
    let sprung = 0, planted = 0, contacted = 0;
    // start well outside the place: a census taken with the player standing on top of the ambush can never
    // instantiate it out of sight, and in the real game the census is taken at a Tide with you back at Vanno
    for (let step = 0; step < 34; step++) {
      const rr = P.r * 3.4 - step * (P.r * 3.2 / 34);
      r.teleport(P.x + Math.cos(a) * rr, P.z + Math.sin(a) * rr); ctx.player.update(0);
      for (let i = 0; i < 20; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.population.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05); }
      const sq = ctx.population.squads();
      planted = Math.max(planted, sq.filter((s) => s.planted).length);
      for (const s of sq) if (s.state === 'combat' || s.state === 'alert') contacted++;
      if (step % 6 === 0) log.push({ r: Math.round(rr), enemies: ctx.enemies.list.filter((e) => e.alive).length, planted: sq.filter((s) => s.planted).length, waiting: ctx.population.ambushPlanned, states: sq.map((s) => s.state).join(',') });
    }
    const sq = ctx.population.squads();
    return { log, planted, sprung: sq.filter((s) => s.state === 'combat').length, dir: ctx.director.state, squads: sq.length, esc: ctx.director.escalation };
  })()`);
  console.log('approach', JSON.stringify(spring));
  console.log('stats   ', JSON.stringify(await api.run('window.__radius.stats()')));
}
