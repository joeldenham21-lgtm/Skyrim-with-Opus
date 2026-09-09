// THE FIGHT. What a pack of mimics actually does to a player, in numbers, at three points on the one curve.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-integrate-fight.mjs --out .smoke/ai2-fight
//
// Measures, for each progression point:
//   * flank    — fraction of sampled ticks with a man past 75 deg of the player's forward
//   * fixflank — fraction with a man past 75 deg WHILE another inside 45 deg has fired in the last 3 s.
//                That pair is the difference between a flank and four men wandering.
//   * charge   — ticks with a man inside 8 m and nobody flanking (the thing we do not want)
//   * survival — seconds of incoming fire before 100 points would have landed, standing in the open,
//                and again for a player who moves and uses cover
//   * belief   — metres between each mimic's lastSeenPlayer and the truth, sampled as a contact goes cold
//   * plays    — which named plans the mind ran (post-integration only; empty before)
import { boot, HOOKS, SETUP, STEP } from './ai2-integrate-lib.mjs';

const POINTS = [
  { name: 'day-one   T1/C1 recruits', poi: 'checkpoint', x: 0, z: 0, look: 0, d: 30, n: 4, tide: 1, sec: 1, cls: 'recruit', seed: 4242 },
  { name: 'mid       T2/C3 regulars', poi: 'zarya', x: -118, z: 92, look: 0.35, d: 34, n: 4, tide: 2, sec: 3, cls: 'regular', seed: 4242 },
  { name: 'late      T3/C5 elites',   poi: 'zarya', x: -118, z: 92, look: 0.35, d: 34, n: 4, tide: 3, sec: 5, cls: 'elite',   seed: 4242 },
];

// one pass of contact with the player standing still in the open, sampling the geometry
const FIGHT = (n) => `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, TH = ctx.THREE, eye = new TH.Vector3();
  let s = 0, flank = 0, flank45 = 0, fix = 0, fixflank = 0, charge = 0, maxAng = 0, minD = 999;
  const plays = {}; let playTicks = 0, movers = 0, moverMax = 0;
  // The Explorer fires back. He has to: the zone's escalation — what it is WILLING to do, as opposed to how
  // well it does it — is bought with the noise and the blood you leave, and a player who never pulls the
  // trigger is a player nobody has any reason to flank. Four-round trains, which is also what read.mag learns.
  let fireT = 1.2, train = 0;
  for (let i = 0; i < ${n}; i++) {
    ctx.elapsed += 0.05; ctx.frame++;
    fireT -= 0.05;
    if (fireT <= 0) {
      ctx.director.notify('shot', { pos: p.position.clone(), noise: 1 });
      if (++train >= 4) { train = 0; fireT = 1.6 + Math.random() * 0.8; } else fireT = 0.11;
    }
    ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05);
    if (i % 4) continue;
    s++;
    const f = p.forward;
    let wide = 0, wide45 = 0, near = 0, firing = 0, close = 0;
    for (const m of window.__list) {
      if (!m.alive) continue;
      const dx = m.position.x - p.position.x, dz = m.position.z - p.position.z, d = Math.hypot(dx, dz);
      const a = Math.abs(Math.atan2(dx * f.z - dz * f.x, dx * f.x + dz * f.z)) * 180 / Math.PI;
      if (a > maxAng) maxAng = a;
      if (d < minD) minD = d;
      if (a > 75) wide++;
      if (a > 45) wide45++;
      if (a < 45) { near++; if (ctx.elapsed - (m.lastFireT ?? -1e9) < 3) firing++; }
      if (d < 8) close++;
    }
    if (wide) flank++;
    if (wide45) flank45++;
    if (firing) fix++;
    if (wide45 && firing) fixflank++;
    if (close && !wide) charge++;
    const mind = window.__sq.mind;
    if (mind) {
      playTicks++;
      const id = mind.play ? mind.play.id : 'none';
      plays[id] = (plays[id] || 0) + 1;
      const mv = mind.moverSeats ? mind.moverSeats() : 0;
      movers += mv; if (mv > moverMax) moverMax = mv;
    }
  }
  const H = window.__H;
  return { samples: s, flank: +(flank / Math.max(1, s)).toFixed(2), flank45: +(flank45 / Math.max(1, s)).toFixed(2), fixflank: +(fixflank / Math.max(1, s)).toFixed(2),
    fix: +(fix / Math.max(1, s)).toFixed(2), charge: +(charge / Math.max(1, s)).toFixed(2),
    maxAng: Math.round(maxAng), minD: +minD.toFixed(1),
    shots: H.shots, dmg: Math.round(H.dmg), firstShot: H.first, deadAt: H.playerDead,
    alive: window.__list.filter((m) => m.alive).length,
    plays, moverMax, radio: H.radio.length, words: H.words,
    esc: ctx.director.escalation, tier: window.__sq.mind ? window.__sq.mind.tier : -1,
    read: window.__sq.mind ? window.__sq.mind.debug().read : null };
})()`;

// the same fight against a player who moves and uses cover: he picks a cover point that breaks the line from
// the squad and goes to it, crouched, re-picking every four seconds, and keeps moving in between.
const COVER_FIGHT = (n) => `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, TH = ctx.THREE;
  const eye = new TH.Vector3(), c0 = new TH.Vector3();
  let goal = null, pick = 0;
  // the controller's stance is read-only; for the length of this measurement the player really is crouched,
  // really is moving and really is making a crouched man's noise, so concealment and hearing see the truth
  const D0 = {};
  for (const k of ['crouched', 'moving', 'noise']) D0[k] = Object.getOwnPropertyDescriptor(p, k);
  Object.defineProperty(p, 'crouched', { get: () => true, configurable: true });
  Object.defineProperty(p, 'moving', { get: () => true, configurable: true });
  Object.defineProperty(p, 'noise', { get: () => 0.25, configurable: true });
  for (let i = 0; i < ${n}; i++) {
    ctx.elapsed += 0.05; ctx.frame++;
    // ---- the player's own tactics: a cover point the squad cannot see into, crouched, and keep rotating ----
    pick -= 0.05;
    if (pick <= 0 || !goal) {
      pick = 6;
      const sq = window.__sq; sq.centroid.clone ? c0.copy(sq.centroid) : c0.set(0, 0, 0);
      c0.y += 1.6;
      let best = null, bs = -1e9;
      for (const c of ctx.world.coverPoints) {
        const dm = Math.hypot(c.x - p.position.x, c.z - p.position.z);
        if (dm > 22 || dm < 3) continue;
        const dp = Math.hypot(c.x - c0.x, c.z - c0.z);
        if (dp < 12) continue;
        const los = ctx.world.lineOfSight(eye.set(c.x, c.y + 1.05, c.z), c0);
        const s = (los ? -20 : 20) + dp * 0.1 - dm * 0.2;
        if (s > bs) { bs = s; best = c; }
      }
      goal = best;
    }
    if (goal) {
      const dx = goal.x - p.position.x, dz = goal.z - p.position.z, d = Math.hypot(dx, dz);
      // move to it, then STAY there until the next re-pick. A player who walks continuously across open
      // ground between cover points is not using cover, he is jogging past it.
      if (d > 0.6) { const st = Math.min(2.6 * 0.05, d); p.position.x += (dx / d) * st; p.position.z += (dz / d) * st; }
      const g = ctx.world.groundHeight(p.position.x, p.position.z, p.position.y + 1.5); p.position.y = g.y;
      ctx.world.resolveCapsule(p.position, 0.35, 1.3);
    }
    if ((i % 24) === 0) ctx.director.notify('shot', { pos: p.position.clone(), noise: 1 });
    ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
  }
  for (const k in D0) if (D0[k]) Object.defineProperty(p, k, D0[k]);
  const H = window.__H;
  return { shots: H.shots, dmg: Math.round(H.dmg), deadAt: H.playerDead, alive: window.__list.filter((m) => m.alive).length };
})()`;

// belief error as a contact goes cold: the player runs, they lose the line, and we watch the guess drift
const BELIEF = `(() => {
  const ctx = window.__radius.ctx, p = ctx.player;
  const out = [];
  const f = p.forward;
  // he breaks contact for real: away from the squad at a run, for 30 s, sampled every 2 s
  for (let k = 0; k < 15; k++) {
    for (let i = 0; i < 40; i++) {
      ctx.elapsed += 0.05; ctx.frame++;
      const c = window.__sq.centroid;
      let dx = p.position.x - c.x, dz = p.position.z - c.z; const l = Math.hypot(dx, dz) || 1;
      const st = 5.2 * 0.05;
      p.position.x += (dx / l) * st; p.position.z += (dz / l) * st;
      const g = ctx.world.groundHeight(p.position.x, p.position.z, p.position.y + 1.5); p.position.y = g.y;
      ctx.world.resolveCapsule(p.position, 0.35, 1.8);
      p.noise = 0.55;
      ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
    }
    let e = 0, en = 0, seen = 0;
    for (const m of window.__list) {
      if (!m.alive || !m.lastSeenPlayer) continue;
      e += Math.hypot(m.lastSeenPlayer.x - p.position.x, m.lastSeenPlayer.z - p.position.z); en++;
      if (ctx.elapsed - m.lastVisT < 0.5) seen++;
    }
    const sq = window.__sq;
    out.push({ t: (k + 1) * 2, err: en ? +(e / en).toFixed(1) : -1, seen,
      pr: +(sq.spread ? sq.spread() : 0).toFixed(1),
      pd: sq.hasKnown ? +Math.hypot(sq.lastKnown.x - p.position.x, sq.lastKnown.z - p.position.z).toFixed(1) : -1 });
  }
  return out;
})()`;

export default async function (page, api) {
  await boot(api);
  console.log('hooks', await api.run(HOOKS));
  for (const t of POINTS) {
    console.log('\n==== ' + t.name + ' ====');
    console.log('setup ', JSON.stringify(await api.run(SETUP(t))));
    // 60 s of contact, in chunks so no single evaluate runs too long
    let acc = null;
    for (let k = 0; k < 4; k++) {
      const r = await api.run(FIGHT(300));
      if (!acc) acc = r; else {
        for (const key of ['samples', 'shots']) acc[key] += r[key];
        acc.dmg = r.dmg; acc.alive = r.alive; acc.minD = Math.min(acc.minD, r.minD); acc.maxAng = Math.max(acc.maxAng, r.maxAng);
        for (const key of ['flank', 'flank45', 'fixflank', 'fix', 'charge']) acc[key] = +((acc[key] + r[key]) / 2).toFixed(2);
        acc.esc = r.esc; acc.tier = r.tier; acc.read = r.read;
        for (const key in r.plays) acc.plays[key] = (acc.plays[key] || 0) + r.plays[key];
        for (const key in r.words) acc.words[key] = (acc.words[key] || 0) + r.words[key];
        acc.moverMax = Math.max(acc.moverMax, r.moverMax); acc.radio = r.radio;
        if (acc.deadAt < 0) acc.deadAt = r.deadAt;
      }
      console.log('  fight', JSON.stringify(r));
    }
    console.log('  TOTAL ', JSON.stringify(acc));
    console.log('  belief', JSON.stringify(await api.run(BELIEF)));

    // the same fight, but the player moves and uses cover
    console.log('  cover-setup', JSON.stringify(await api.run(SETUP(t))));
    let cov = null;
    for (let k = 0; k < 4; k++) { cov = await api.run(COVER_FIGHT(300)); }
    console.log('  COVER ', JSON.stringify(cov));
  }
}
