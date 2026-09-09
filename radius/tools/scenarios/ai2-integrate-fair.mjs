// FAIRNESS AND THE LOOT INVARIANT. The two things that must be true whatever else the AI does.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-integrate-fair.mjs --out .smoke/ai2-fair
//
//   1. THE GREP GATE. The four modules that make decisions never read the Explorer. (node-side, over the source)
//   2. THE DECOY TEST. Snapshot the squad's picture and every man's belief; move the true player 40 m and set
//      him to 8 hp WITHOUT running perception; re-run a plan tick. Anything that moves is reading ground truth.
//   3. THE HIDDEN PLAYER. 600 steps, unseen and inaudible: no belief may come within 3 m of the truth, no
//      grenade may be ordered, and the still-clock may not accumulate.
//   4. THE LOOT INVARIANT. Seed known entries into corpse piles, let the survivors scavenge, kill everyone,
//      and assert every entry is still somewhere in the world, uid for uid.
import { readFileSync } from 'node:fs';
import { boot, HOOKS, SETUP, STEP } from './ai2-integrate-lib.mjs';

const T = { poi: 'zarya', x: -118, z: 92, look: 0.35, d: 30, n: 4, tide: 3, sec: 5, cls: 'elite', seed: 909 };
// the loot trial uses badly-armed men standing among well-armed bodies, which is the case that actually
// exercises the scavenging paths: a better rifle, a magazine that fits, plates for a man with none.
const L = { poi: 'zarya', x: -118, z: 92, look: 0.35, d: 18, n: 4, tide: 3, sec: 5, cls: 'recruit', seed: 909 };

const DECOY = `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, sq = window.__sq;
  const mind = sq.mind || null;
  const rank = (v) => { const k = Object.keys(v).filter((x) => v[x] != null); k.sort((a, b) => v[b] - v[a]); return k.join('>'); };
  const snap = () => ({
    pic: mind ? [+mind.picture.pos.x.toFixed(4), +mind.picture.pos.z.toFixed(4), +mind.picture.r.toFixed(4),
      mind.picture.kind, +mind.picture.hurt.toFixed(4), +mind.picture.facing.toFixed(4)].join('|')
      : [sq.lastKnown.x.toFixed(4), sq.lastKnown.z.toFixed(4), sq.knownR.toFixed(4)].join('|'),
    play: mind && mind.play ? mind.play.id : null,
    ranking: mind && mind.scoreVector ? rank(mind.scoreVector()) : '',
    seats: mind && mind.debug ? mind.debug().seats.map((x) => x.k).join(',') : '',
    men: window.__list.filter((m) => m.alive).map((m) => (m.lastSeenPlayer
      ? m.lastSeenPlayer.x.toFixed(3) + ',' + m.lastSeenPlayer.z.toFixed(3) + ',' + (m.beliefR || 0).toFixed(3) : 'none')).join(' / '),
  });
  const before = snap();
  // the lie: the player is somewhere else entirely and nearly dead, and nothing was allowed to perceive it
  const x0 = p.position.x, z0 = p.position.z, hp0 = ctx.state.data.hp;
  p.position.x += 40; p.position.z -= 18; ctx.state.data.hp = 8;
  if (mind) mind.tick(0.25, window.__list); else sq.assignJobs(sq.alive);
  const after = snap();
  p.position.x = x0; p.position.z = z0; ctx.state.data.hp = hp0;
  const diff = [];
  for (const k in before) if (before[k] !== after[k]) diff.push(k);
  return { ok: diff.length === 0, diff, before: before.pic, after: after.pic, play: before.play };
})()`;

const HIDDEN = `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, sq = window.__sq;
  // put him 200 m away, silent, and let them look for him for thirty seconds
  const D0 = Object.getOwnPropertyDescriptor(p, 'noise');
  Object.defineProperty(p, 'noise', { get: () => 0, configurable: true });
  p.position.x += 200; p.position.z += 140;
  const g = ctx.world.groundHeight(p.position.x, p.position.z, p.position.y + 3); p.position.y = g.y;
  let nearest = 1e9, still = 0, frags = 0, believesNear = 0, awareMax = 0;
  const frag0 = sq.fragOrders | 0;
  for (let i = 0; i < 600; i++) {
    ctx.elapsed += 0.05; ctx.frame++;
    ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
    for (const m of window.__list) {
      if (!m.alive) continue;
      if (m.aware > awareMax) awareMax = m.aware;
      if (!m.lastSeenPlayer) continue;
      const d = Math.hypot(m.lastSeenPlayer.x - p.position.x, m.lastSeenPlayer.z - p.position.z);
      if (d < nearest) nearest = d;
      if (d < 3) believesNear++;
    }
    if (sq.mind) still = Math.max(still, sq.mind.picture.stillT);
  }
  frags = (sq.fragOrders | 0) - frag0;
  if (D0) Object.defineProperty(p, 'noise', D0);
  return { nearest: +nearest.toFixed(1), believesNear, frags, stillMax: +still.toFixed(2),
    stillEnd: sq.mind ? +sq.mind.picture.stillT.toFixed(2) : -1, seers: sq.mind ? sq.mind.picture.seers : -1,
    awareMax: +awareMax.toFixed(2) };
})()`;

// ---- the loot invariant -------------------------------------------------------------------------------
// Three donor mimics are killed on the spot so the world holds three REAL corpse piles with real rolled
// entries (this is exactly the set kit.js is allowed to touch). An artifact and a mission item are pushed
// into one of them. Four live mimics are then left among the bodies with nothing else to do. Afterwards
// everybody is killed and every entry seeded at the start must still exist somewhere, uid for uid.
const LOOT_SEED = `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, r = window.__radius;
  const donors = [];
  const live = window.__list.filter((m) => m.alive);
  for (let i = 0; i < 3; i++) {
    const host = live[i % live.length];
    const a = i * 2.1, x = host.position.x + Math.cos(a) * 2.0, z = host.position.z + Math.sin(a) * 2.0;
    const e = r.spawn('mimic', x, z, { poi: 'zarya', cls: 'elite' });
    if (e) { donors.push(e); e.kill({ kind: 'test' }); }
  }
  window.__donors = donors;
  return donors.length;
})()`;

const LOOT_SNAP = `(() => {
  const ctx = window.__radius.ctx, p = ctx.player;
  window.__sig = (e) => e.kind + ':' + (e.inst && e.inst.uid != null ? '#' + e.inst.uid : e.id + 'x' + (e.count || 1));
  const piles = [];
  for (const o of ctx.loot.objects) {
    if (o.type !== 'pile' || !o.pile) continue;
    if (Math.hypot(o.x - p.position.x, o.z - p.position.z) > 60) continue;
    piles.push(o);
  }
  // an artifact and a mission item go into the first pile: neither may ever be taken
  if (piles[0]) {
    piles[0].pile.entries.push({ kind: 'item', id: 'art_pearl', count: 1 });
    piles[0].pile.entries.push({ kind: 'item', id: 'recorder', count: 1 });
  }
  const seeded = [];
  for (const o of piles) for (const e of o.pile.entries) seeded.push(window.__sig(e));
  window.__seeded = seeded;
  window.__pile0 = piles[0] || null;
  window.__piles = piles;
  window.__loc = { x: p.position.x, z: p.position.z };
  return { piles: piles.length, entries: seeded.length, kinds: piles.map((o) => o.markerKind) };
})()`;

const LOOT_COUNT = `(() => {
  const ctx = window.__radius.ctx, sig = window.__sig, p = ctx.player;
  const found = [];
  const L = window.__loc;
  for (const o of ctx.loot.objects) {
    if (o.type !== 'pile' || !o.pile) continue;
    if (Math.hypot(o.x - L.x, o.z - L.z) > 90) continue;
    for (const e of o.pile.entries) found.push(sig(e));
  }
  const art = window.__pile0 ? window.__pile0.pile.entries.filter((e) => e.id === 'art_pearl' || e.id === 'recorder').length : -1;
  return { found, art, scav: window.__list.reduce((a, m) => a + ((m.loadout && m.loadout.scavenged) ? m.loadout.scavenged.length : 0), 0) };
})()`;

export default async function (page, api) {
  const bad = [];
  for (const f of ['command', 'kit', 'ambush', 'traversal']) {
    const src = readFileSync(new URL(`../../src/enemies/${f}.js`, import.meta.url), 'utf8');
    const hits = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /ctx\.player\./.test(l) && !/^\s*\/\//.test(l));
    console.log(`grep ${f}.js  ctx.player. -> ${hits.length}`);
    for (const [n, l] of hits) { bad.push(`${f}.js:${n}`); console.log('   ', n, l.trim().slice(0, 110)); }
  }
  console.log('GREP GATE', bad.length === 0 ? 'PASS (zero decision-side player reads)' : 'FAIL ' + bad.join(','));

  await boot(api);
  await api.run(HOOKS);
  console.log('setup', JSON.stringify(await api.run(SETUP(T))));
  await api.run(STEP(300));
  console.log('DECOY  ', JSON.stringify(await api.run(DECOY)));
  await api.run(STEP(120));
  console.log('DECOY2 ', JSON.stringify(await api.run(DECOY)));
  console.log('HIDDEN ', JSON.stringify(await api.run(HIDDEN)));

  // ---- the loot invariant, six seeds ----
  let worstLost = 0, totalScav = 0;
  for (let seed = 0; seed < 6; seed++) {
    await api.run(SETUP(Object.assign({}, L, { seed: 1000 + seed })));
    await api.run(LOOT_SEED);
    await api.run(STEP(60));                       // the bodies fold and their piles land
    const s0 = await api.run(LOOT_SNAP);
    const before = await api.run('window.__seeded');
    // the survivors are out of contact and standing among three bodies: exactly when scavenging is allowed
    // ...and the Explorer walks away. Scavenging only happens out of contact, and with him standing eighteen
    // metres away in daylight nobody is ever out of contact — they simply re-acquire him every tick.
    await api.run(`(() => { const ctx = window.__radius.ctx;
      ctx.player.position.x += 400; ctx.player.position.z += 260;
      ctx.player.position.y = ctx.world.groundHeight(ctx.player.position.x, ctx.player.position.z, 60).y;
      window.__sq.standDown(true);
      // and they stay where the bodies are: a patrol whose home is forty metres away walks off and never
      // comes back within reach of one. Their home is the body beside them.
      for (const m of window.__list) {
        m.aware = 0; m.engaged = false; m.target = null; if (m.setState) m.setState('patrol');
        let best = null, bd = 1e9;
        for (const o of ctx.loot.objects) { if (o.type !== 'pile' || !o.pile) continue;
          const d = Math.hypot(o.x - m.position.x, o.z - m.position.z); if (d < bd) { bd = d; best = o; } }
        if (best) { m.home.set(best.x, ctx.world.getHeight(best.x, best.z), best.z); m.poiR = 3; }
        // and they are stripped: no spares, no plates, a near-empty magazine. Now there is something on the
        // ground worth having, which is what puts the risky paths — the mag, the armour, the weapon swap —
        // under the invariant instead of leaving them untested.
        m.loadout.mags.length = 0;
        if (m.weapon.mag) m.weapon.mag.rounds = 1;
        m.loadout.vest = null; m.loadout.helmet = null; m.pieces.length = 0;
      }
      return 'ok'; })()`);
    for (let k = 0; k < 8; k++) await api.run(STEP(200));
    await api.run(`(() => { for (const m of window.__list) if (m.alive) m.kill({ kind: 'test' }); return 'ok'; })()`);
    for (let k = 0; k < 4; k++) await api.run(STEP(60));
    const r = await api.run(LOOT_COUNT);
    const ks = await api.run(`(() => { const s = window.__radius.ctx.enemies.ai.kit.stats(); return { att: s.scavAttempts, take: s.scavTakes, ref: s.scavRefused, rearm: s.rearms, back: s.swapsBack }; })()`);
    console.log('     kit', JSON.stringify(ks));
    const counts = {}; for (const s2 of r.found) counts[s2] = (counts[s2] || 0) + 1;
    const seen = {}, lost = [];
    for (const s2 of before) { seen[s2] = (seen[s2] || 0) + 1; if ((counts[s2] || 0) < seen[s2]) lost.push(s2); }
    totalScav += r.scav;
    console.log(`LOOT seed ${1000 + seed}: piles ${s0.piles} seeded ${before.length} found ${r.found.length} scavenged ${r.scav} artifacts-left ${r.art} LOST ${lost.length}`
      + (lost.length ? ' ' + JSON.stringify(lost.slice(0, 8)) : ''));
    worstLost = Math.max(worstLost, lost.length);
  }
  console.log('LOOT INVARIANT', worstLost === 0 ? `PASS (nothing destroyed across 6 seeds; ${totalScav} entries changed hands)` : 'FAIL ' + worstLost);
}
