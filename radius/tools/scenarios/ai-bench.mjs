// AI bench. Drives squads against a stationary (invulnerable, but damage-counted) player and reports numbers
// that can be compared build to build: time to the first round, rounds fired, damage that would have landed,
// how far round the squad actually gets, how often a bound is covered, how far the shared belief sits from the
// truth once the player is out of sight, and which radio calls went out.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai-bench.mjs --out .smoke/ai-bench
//   node tools/smoke.mjs --html <other build> --scenario tools/scenarios/ai-bench.mjs --out .smoke/ai-base
//
// It never waits on a rendered frame: post.render is stubbed in the page (test-only) so the loop costs nothing
// and the simulation is advanced by hand. On a loaded box SwiftShader draws under one frame a second, and a
// render-bound test measures the box rather than the AI.
export async function boot(api) {
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx;
    ctx.debug.noEnemies = true;
    if (!ctx.post.__stub) { ctx.post.__stub = true; ctx.post.render = () => {}; }
    r.start(); })()`);
  await api.wait(1500);
}

// open = the player standing in the open; cover = the player behind the nearest thing that breaks the line
const TRIALS = [
  { name: 'zarya-t1', poi: 'zarya', x: -118, z: 92, look: 0.35, d: 34, n: 4, tide: 1, sec: 1, hide: 0 },
  { name: 'zarya-t3', poi: 'zarya', x: -118, z: 92, look: 0.35, d: 34, n: 4, tide: 3, sec: 5, hide: 0 },
  { name: 'chkpt-t2', poi: 'checkpoint', x: 0, z: 0, look: 0, d: 40, n: 4, tide: 2, sec: 3, hide: 0 },
  { name: 'zarya-walk', poi: 'zarya', x: -118, z: 92, look: 0.35, d: 40, n: 4, tide: 2, sec: 3, walk: 1 },
];

export const HOOKS = `(() => {
  const r = window.__radius, ctx = r.ctx;
  if (window.__aiHooked) return; window.__aiHooked = true;
  window.__M = { shots: 0, dmg: 0, hits: 0, thrown: 0, radio: [], firstShot: -1, t0: 0 };
  const mf = ctx.vfx.muzzleFlash; ctx.vfx.muzzleFlash = (p, d) => { window.__M.shots++; if (window.__M.firstShot < 0) window.__M.firstShot = +(ctx.elapsed - window.__M.t0).toFixed(2); return mf(p, d); };
  ctx.player.damage = (a, i) => { window.__M.dmg += a; window.__M.hits++; return 0; };
  const pl = ctx.audio.play.bind(ctx.audio); ctx.audio.play = (n, o) => { if (n === 'mimic_radio') window.__M.radio.push(o && o.rate ? +o.rate.toFixed(2) : 1); return pl(n, o); };
  if (ctx.squads) { const tg = ctx.squads.throwGrenade.bind(ctx.squads); ctx.squads.throwGrenade = (m, f, t, id) => { window.__M.thrown++; return tg(m, f, t, id); }; }
})()`;

export const SETUP = (t) => `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player, TH = ctx.THREE;
  ctx.state.data.tideLevel = ${t.tide}; ctx.state.data.securityLevel = ${t.sec};
  r.teleport(${t.x}, ${t.z}); r.setLook(${t.look}, -0.02); r.setTime(12); ctx.player.update(0);
  for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; } ctx.enemies.removeDead(); ctx.squads.reset();
  // the squad's own skill dial is sampled every 3 s from state.data; let it catch up before anybody is formed
  for (let i = 0; i < 70; i++) ctx.squads.update(0.05);
  // Loadouts roll on Math.random, so two builds would otherwise be compared with different guns. Seed it for
  // the length of the spawn and put it back afterwards: same squad, same weapons, every run.
  const R0 = Math.random; let sd = ${t.seed || 12345} | 0;
  Math.random = () => { sd = sd + 0x6D2B79F5 | 0; let x = Math.imul(sd ^ sd >>> 15, 1 | sd); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  const f = p.forward, list = [];
  for (let i = 0; i < ${t.n}; i++) {
    const side = (i - (${t.n} - 1) / 2) * 5.5, d = ${t.d} + (i % 2) * 3;
    const x = p.position.x + f.x * d + f.z * side, z = p.position.z + f.z * d - f.x * side;
    const e = r.spawn('mimic', x, z, { poi: '${t.poi}', cls: i === 0 ? 'veteran' : 'regular', yaw: Math.atan2(-(p.position.x - x), -(p.position.z - z)) });
    if (e) { e.root.traverse((o) => { o.userData.__enemy = true; }); e.grenades = Math.max(e.grenades, 1); list.push(e); }
  }
  Math.random = R0;
  window.__sq = ctx.squads.form(list, ctx.world.poi('${t.poi}')); window.__list = list;
  const M = window.__M; M.shots = 0; M.dmg = 0; M.hits = 0; M.thrown = 0; M.radio.length = 0; M.firstShot = -1; M.t0 = ctx.elapsed;
  ctx.director.notify('shot', { pos: p.position.clone(), noise: 1 });
  return { n: list.length, skill: +window.__sq.skill.toFixed(2), w: list.map((e) => e.weapon.id) };
})()`;


export const RUN = (n, dt = 0.05) => `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, s = window.__sq, M = window.__M, TH = ctx.THREE;
  const eye = new TH.Vector3();
  let bel = 0, belN = 0, losT = 0, samples = 0, maxAng = 0, behind = 0, minD = 999, sectors = 0, covering = 0;
  let prevEl = -1, swaps = 0;
  for (let i = 0; i < ${n}; i++) {
    ctx.elapsed += ${dt};
    // a player who walks: the shared picture has to keep up with him, and bel says how far behind it is
    if (window.__walk) {
      const a = ctx.elapsed * 0.28;
      p.position.x += Math.cos(a) * 2.6 * ${dt}; p.position.z += Math.sin(a) * 2.6 * ${dt};
      const g = ctx.world.groundHeight(p.position.x, p.position.z, p.position.y + 1.5); p.position.y = g.y;
      ctx.world.resolveCapsule(p.position, 0.35, 1.8);
      p.noise = 0.35;
    }
    ctx.enemies.update(${dt}); ctx.squads.update(${dt}); ctx.director.update(${dt}); ctx.player.update(${dt});
    if (i % 4) continue;
    samples++;
    const f = p.forward;
    if (s.hasKnown) { bel += Math.hypot(s.lastKnown.x - p.position.x, s.lastKnown.z - p.position.z); belN++; }
    if (s.bounding && s.movingElement !== prevEl) { swaps++; prevEl = s.movingElement; }
    let anyLos = 0, ang = 0, anyBehind = 0;
    for (const m of window.__list) {
      if (!m.alive) continue;
      const dx = m.position.x - p.position.x, dz = m.position.z - p.position.z, d = Math.hypot(dx, dz);
      if (d < minD) minD = d;
      const a = Math.abs(Math.atan2(dx * f.z - dz * f.x, dx * f.x + dz * f.z)) * 180 / Math.PI;
      if (a > ang) ang = a;
      if (a > 75) anyBehind = 1;
      if (ctx.world.lineOfSight(m.eyePos(eye), p.eye)) anyLos = 1;
      if (m.orders && m.orders.hasSector) sectors++;
      if (m.orders && m.orders.covering) covering++;
    }
    if (ang > maxAng) maxAng = ang;
    behind += anyBehind; losT += anyLos;
  }
  const kinds = {};
  for (const r of M.radio) { const k = r.toFixed(1); kinds[k] = (kinds[k] || 0) + 1; }
  return { t: +ctx.elapsed.toFixed(1), st: s.state, alive: s.alive, shots: M.shots, dmg: +M.dmg.toFixed(0), thrown: M.thrown,
    first: M.firstShot, morale: +s.morale.toFixed(2), org: +(s.org != null ? s.org : 1).toFixed(2),
    bel: belN ? +(bel / belN).toFixed(1) : -1, maxAng: Math.round(maxAng), behindFrac: +(behind / Math.max(1, samples)).toFixed(2),
    minD: +minD.toFixed(1), losFrac: +(losT / Math.max(1, samples)).toFixed(2),
    swaps, bounds: s.bounds | 0, refused: s.boundsRefused | 0, frags: s.fragOrders | 0, fixing: s.fixing | 0,
    states: window.__list.filter((m) => m.alive).map((m) => m.state).join(','),
    sect: sectors, cov: covering, kind: s.contactKind || '-', radio: M.radio.length, calls: kinds,
    dir: ctx.director.state, pr: +ctx.director.pressure.toFixed(2) };
})()`;

export default async function (page, api) {
  await boot(api);
  await api.run(HOOKS);
  for (const t of TRIALS) {
    await api.run(`window.__walk = ${t.walk ? 1 : 0}`);
    const info = await api.run(SETUP(t));
    console.log('TRIAL', t.name, JSON.stringify(info));
    for (let k = 0; k < 4; k++) console.log('  ', JSON.stringify(await api.run(RUN(150))));
  }
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
