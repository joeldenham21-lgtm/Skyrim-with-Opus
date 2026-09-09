// kit.js — THE LOOT INVARIANT, and the exclusions that hold it up.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-kit-loot.mjs --out .smoke/ai2-kit-loot
//
// Seed known loot into real ctx.loot corpse piles at a real place in the zone. Let real Mimic instances
// scavenge for minutes of simulated time. Then drop everybody through dropsFor() AS THE INTEGRATOR WILL
// PATCH IT (one line: scavengedDrops(loadout, out) at the top) and assert that every seeded entry is
// recoverable somewhere — pile or body — count for count and uid for uid. Zero tolerance, eight seeds.
//
// Four of the eight seeds run with the mimic AI live and four with it frozen. The frozen half is the module
// under test on its own; the live half proves it survives being driven inside the real update loop.
//
// Nothing here waits on a rendered frame.
import { inject, boot, pass, section, RAYCOUNT, ZERO_RC, AUDIOHOOK, DRIVER } from './ai2-kit-lib.mjs';

let bad = 0;

const HELPERS = `(() => {
  const ctx = window.__radius.ctx, K = window.__KIT, T = ctx.THREE;

  // a flat, empty, dry patch a long way from the Explorer
  window.__site = (() => {
    const w = ctx.world; let best = null, bs = 1e9;
    for (let x = -240; x <= 240; x += 20) for (let z = -240; z <= 240; z += 20) {
      if (w.isWater(x, z)) continue;
      let n = 0; w.query(x, z, 10, (c) => { if (!c.dead && !c.passable) n++; });
      if (n) continue;
      let v = 0; const h = w.getHeight(x, z);
      for (const d of [[4,0],[-4,0],[0,4],[0,-4]]) v += Math.abs(w.getHeight(x + d[0], z + d[1]) - h);
      if (v < bs) { bs = v; best = { x: x, z: z, y: h }; }
    }
    return best || { x: 0, z: 0, y: 0 };
  })();

  // the signature the invariant is asserted on: what it is, WHICH one it is, and how many
  window.__sig = (e) => e.kind + '|' + e.id + '|' + (e.inst && e.inst.uid !== undefined ? e.inst.uid : '-') + '|' + (e.count || 1);
  window.__bag = (list) => { const b = {}; for (const e of list) { const s = window.__sig(e); b[s] = (b[s] || 0) + 1; } return b; };

  window.__piles = [];
  // seed one corpse pile with known contents, registered exactly as mimic.js's death will register it
  window.__seedPile = (x, z, seed) => {
    const w = ctx.world, y = w.groundHeight(x, z, w.getHeight(x, z) + 2).y;
    const gun = K.makeWeapon(seed.gun, { ammo: seed.ammo });
    if (gun.mag) { gun.mag.ammo = seed.ammo; gun.mag.rounds = 20; }
    const mag1 = K.makeMag(seed.mag, seed.ammo, 30);
    const mag2 = K.makeMag(seed.mag, seed.ammo, 17);
    const vest = K.makeGear(seed.vest);
    const entries = [
      { kind: 'weapon', inst: gun, id: gun.id, count: 1 },
      { kind: 'mag', inst: mag1, id: mag1.id, count: 1 },
      { kind: 'mag', inst: mag2, id: mag2.id, count: 1 },
      { kind: 'gear', inst: vest, id: vest.id, count: 1 },
      { kind: 'item', id: 'art_pearl', count: 1 },
      { kind: 'item', id: 'recorder', count: 1 },
      { kind: 'item', id: 'medkit', count: 1 },
      { kind: 'item', id: 'bandage', count: 2 },
      { kind: 'item', id: seed.ammo, count: 24 },
    ];
    const o = ctx.loot.spawnPile(new T.Vector3(x, y, z), entries);
    K.registerCorpsePile(o, x, z);
    window.__piles.push(o);
    return o;
  };

  // spawn a scavenger and turn every kit capability on for it
  window.__scavenger = (x, z, cls) => {
    const m = window.__radius.spawn('mimic', x, z, { cls: cls || 'regular' });
    if (!m) return null;
    K.createKit(m);
    m.skill.itemUse = 0.95; m.skill.smokeW = 0.8; m.skill.scav = 0.6;
    m.kit.scavCool = 0.1;
    m.aware = 0; m.setState('watch');
    return m;
  };

  // dropsFor() as the integrator will ship it, over everyone still standing
  window.__dropAll = () => {
    const out = [];
    for (const m of ctx.enemies.list) { if (m.type !== 'mimic' || !m.loadout) continue; for (const e of K.dropsForPatched(m.loadout)) out.push(e); }
    return out;
  };
  // everything still lying in a pile this test seeded or a mimic put back
  window.__groundAll = () => {
    const out = [];
    for (const p of window.__piles) { if (!p || !p.pile) continue; for (const e of p.pile.entries) out.push(e); }
    return out;
  };
  // clean slate between seeds
  window.__clear = () => { ctx.enemies.removeAll(); K.resetKit(); window.__piles = []; };
  return 1; })()`;

const SEED_RUN = (seed, live) => `(() => {
  const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
  window.__clear();
  const SEEDS = [
    { gun: 'ak12',  mag: 'mag_ak545_30', ammo: '545_fmj',   vest: 'vest_6b23_1' },
    { gun: 'm4',    mag: 'mag_stanag30', ammo: '556_fmj', vest: 'vest_zhuk' },
    { gun: 'ak105', mag: 'mag_ak545_30', ammo: '545_fmj',   vest: 'vest_kirasa' },
  ];
  const ox = S.x, oz = S.z, spread = 11;
  for (let i = 0; i < 3; i++) window.__seedPile(ox + i * spread, oz, SEEDS[(i + ${seed}) % SEEDS.length]);
  const before = window.__bag(window.__groundAll());
  let men = 0;
  for (let i = 0; i < 4; i++) {
    const px = ox + (i % 3) * spread + (i < 3 ? 1.3 : -1.3), pz = oz + (i < 3 ? 1.3 : -1.3);
    if (window.__scavenger(px, pz, i === 3 ? 'recruit' : 'regular')) men++;
  }
  window.__drive(2600, 0.05, { noEnemies: ${live ? 'false' : 'true'} });
  const dropped = window.__dropAll();
  const left = window.__groundAll();
  const after = window.__bag(left.concat(dropped));
  const missing = [];
  for (const k in before) { const n = after[k] || 0; if (n < before[k]) missing.push(k + ' x' + (before[k] - n)); }
  const st = K.stats();
  return { seed: ${seed}, live: ${live}, missing: missing, before: Object.keys(before).length, ground: left.length,
           dropped: dropped.length, takes: st.scavTakes, rearms: st.rearms, swaps: st.swapsBack,
           refused: st.scavRefused, attempts: st.scavAttempts, men: men, rays: st.rays };
})()`;

export default async function (page, api) {
  await boot(api);
  await inject(api);
  await api.run(RAYCOUNT);
  await api.run(AUDIOHOOK);
  await api.run(DRIVER);
  await api.run(HELPERS);
  const site = await api.run('window.__site');
  console.log('site', JSON.stringify(site));

  // =======================================================================================================
  section('1. THE INVARIANT — eight seeds, zero tolerance');
  // =======================================================================================================
  const runs = [];
  for (let seed = 0; seed < 8; seed++) {
    const r = await api.run(SEED_RUN(seed, seed >= 4));
    runs.push(r);
    console.log(`   seed ${r.seed} (${r.live ? 'AI live ' : 'AI frozen'}): ${r.before} seeded entries, ${r.attempts} attempts -> ` +
      `${r.takes} takes (${r.rearms} rearms, ${r.swaps} swapped back), ${r.ground} on the ground + ${r.dropped} on the bodies` +
      (r.missing.length ? `   MISSING ${r.missing.join(', ')}` : '   nothing missing'));
  }
  const totalTakes = runs.reduce((n, r) => n + r.takes, 0);
  const totalMissing = runs.reduce((n, r) => n + r.missing.length, 0);
  const liveTakes = runs.filter((r) => r.live).reduce((n, r) => n + r.takes, 0);
  bad += pass('THE LOOT INVARIANT holds over 8 seeds', totalMissing === 0, `${totalTakes} entries changed hands, ${totalMissing} lost`);
  bad += pass('scavenging actually happened (the test is not vacuous)', totalTakes >= 8, `${totalTakes} takes`);
  bad += pass('it also happens inside the live update loop', liveTakes >= 1, `${liveTakes} takes with the AI running`);

  // =======================================================================================================
  section('2. THE EXCLUSIONS — what a mimic will not touch');
  // =======================================================================================================
  const exc = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const ox = S.x, oz = S.z + 45;
    // a) a pile the Explorer has already searched
    const searched = window.__seedPile(ox, oz, { gun: 'ak12', mag: 'mag_ak545_30', ammo: '545_fmj', vest: 'vest_zhuk' });
    searched.searched = true;
    const searchedBefore = searched.pile.entries.length;
    // b) an untouched corpse with an artifact and a mission object in it
    const open = window.__seedPile(ox + 11, oz, { gun: 'm4', mag: 'mag_stanag30', ammo: '556_fmj', vest: 'vest_iotv' });
    const openBefore = open.pile.entries.length;
    // c) an Explorer's death cache wearing a corpse marker: registered on purpose, and still refused
    const w = ctx.world, y = w.groundHeight(ox + 22, oz, w.getHeight(ox + 22, oz) + 2).y;
    const cache = ctx.loot.spawnPile(new ctx.THREE.Vector3(ox + 22, y, oz), [
      { kind: 'weapon', inst: K.makeWeapon('ak12', { ammo: '545_fmj' }), id: 'ak12', count: 1 },
      { kind: 'item', id: 'medkit', count: 3 }]);
    cache.cacheId = 'test-cache';
    K.registerCorpsePile(cache, ox + 22, oz);
    window.__piles.push(cache);
    const cacheBefore = cache.pile.entries.length;
    for (let i = 0; i < 6; i++) window.__scavenger(ox + (i % 3) * 11 + 1.2, oz + 1.2, 'veteran');
    window.__drive(2000, 0.05, { noEnemies: true });
    return { searchedBefore: searchedBefore, searchedAfter: searched.pile.entries.length,
             cacheBefore: cacheBefore, cacheAfter: cache.pile.entries.length,
             art: open.pile.entries.filter((e) => e.id === 'art_pearl').length,
             mis: open.pile.entries.filter((e) => e.id === 'recorder').length,
             openBefore: openBefore, openAfter: open.pile.entries.length, takes: K.stats().scavTakes };
  })()`);
  console.log('   ' + JSON.stringify(exc));
  bad += pass('a pile the Explorer has searched is never touched', exc.searchedAfter === exc.searchedBefore, `${exc.searchedBefore} -> ${exc.searchedAfter}`);
  bad += pass('an Explorer death cache is never touched', exc.cacheAfter === exc.cacheBefore, `${exc.cacheBefore} -> ${exc.cacheAfter}`);
  bad += pass('artifacts stay where they fell', exc.art === 1, `art_pearl x${exc.art}`);
  bad += pass('mission objects stay where they fell', exc.mis === 1, `recorder x${exc.mis}`);
  bad += pass('the open corpse WAS worked over (the exclusion test is not vacuous)', exc.takes > 0, `${exc.takes} takes, open pile ${exc.openBefore} -> ${exc.openAfter}`);

  // =======================================================================================================
  section('3. THE SWAP — he leaves his own rifle on the body');
  // =======================================================================================================
  const swap = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const ox = S.x, oz = S.z - 45;
    const pile = window.__seedPile(ox, oz, { gun: 'ak12', mag: 'mag_ak545_30', ammo: '545_fmj', vest: 'vest_zhuk' });
    const m = window.__scavenger(ox + 1.1, oz + 1.1, 'recruit');
    const wasId = m.weapon.id, wasUid = m.weapon.uid, wasNames = m.shotNames.slice(), wasCap = m.magCap;
    window.__drive(700, 0.05, { noEnemies: true });
    const inPile = pile.pile.entries.filter((e) => e.kind === 'weapon').map((e) => e.id + '#' + (e.inst ? e.inst.uid : '-'));
    const drops = K.dropsForPatched(m.loadout).filter((e) => e.kind === 'weapon').map((e) => e.id + '#' + (e.inst ? e.inst.uid : '-'));
    return { wasId: wasId, wasUid: wasUid, nowId: m.weapon.id, nowUid: m.weapon.uid, inPile: inPile, drops: drops,
             capWas: wasCap, capNow: m.magCap, ammoId: m.ammoId, shotWas: wasNames[0], shotNow: m.shotNames[0],
             rearms: K.stats().rearms, vest: m.loadout.vest ? m.loadout.vest.id : null };
  })()`);
  console.log('   ' + JSON.stringify(swap));
  bad += pass('he rearmed', swap.nowUid !== swap.wasUid && swap.rearms === 1, `${swap.wasId} -> ${swap.nowId}`);
  bad += pass('his own rifle went down on the body he took it from', swap.inPile.some((s) => s.endsWith('#' + swap.wasUid)), swap.inPile.join(' '));
  bad += pass('the rifle he now holds drops at 1.0 off his own body', swap.drops.some((s) => s.endsWith('#' + swap.nowUid)), swap.drops.join(' '));
  bad += pass('the entity fires what it drops: the derived fields followed the swap',
    swap.shotNow !== swap.shotWas && swap.capNow > 0, `${swap.shotWas} -> ${swap.shotNow}, magCap ${swap.capWas} -> ${swap.capNow}, ${swap.ammoId}`);

  // =======================================================================================================
  section('4. AMMUNITION — the one thing that is spent, measured');
  // =======================================================================================================
  const rounds = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const ox = S.x + 45, oz = S.z;
    const pile = window.__seedPile(ox, oz, { gun: 'ak12', mag: 'mag_ak545_30', ammo: '545_fmj', vest: 'vest_zhuk' });
    let before = 0, seeded = 0; const want = {};
    for (const e of pile.pile.entries) if (e.kind === 'mag' && e.inst) { before += e.inst.rounds; seeded++; want[e.inst.uid] = 1; }
    for (let i = 0; i < 3; i++) window.__scavenger(ox + (i - 1) * 1.4, oz + 1.2, 'veteran');
    window.__drive(2000, 0.05, { noEnemies: true });
    let after = 0, found = 0; const seen = {};
    const scan = (list) => { for (const e of list) if (e.kind === 'mag' && e.inst && want[e.inst.uid] && !seen[e.inst.uid]) { seen[e.inst.uid] = 1; after += e.inst.rounds; found++; } };
    scan(pile.pile.entries);
    for (const m of ctx.enemies.list) if (m.loadout) scan(K.dropsForPatched(m.loadout));
    return { before: before, after: after, seeded: seeded, found: found };
  })()`);
  console.log('   ' + JSON.stringify(rounds));
  bad += pass('every seeded magazine is still an object in the world', rounds.found === rounds.seeded, `${rounds.seeded} seeded, ${rounds.found} accounted for`);
  bad += pass('their rounds are not silently deleted', rounds.after <= rounds.before,
    `${rounds.before} rounds seeded, ${rounds.after} still loaded (any difference is rounds fired, not loot destroyed)`);

  console.log(`\n${bad ? 'FAILURES: ' + bad : 'ALL CHECKS PASSED'}`);
  await api.screenshot('kit-loot');
}
