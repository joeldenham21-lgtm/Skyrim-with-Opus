// Shared rig for the ai2-integrate-* scenarios. Everything here works against BOTH the pre-integration build
// and the post-integration one (every reach into a squad mind is optional-chained), so the same numbers can be
// taken before and after and put side by side.
//
// Nothing waits on a rendered frame: post.render is stubbed and the simulation is driven by hand.

export async function boot(api) {
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx;
    ctx.debug.noEnemies = true;
    if (!ctx.post.__stub) { ctx.post.__stub = true; ctx.post.render = () => {}; }
    r.start(); })()`);
  await api.wait(1500);
}

// ---- instrumentation that survives a game restart ----
export const HOOKS = `(() => {
  const r = window.__radius, ctx = r.ctx;
  if (window.__H) return 'already';
  const H = window.__H = { shots: 0, dmg: 0, hits: 0, thrown: 0, radio: [], words: {}, first: -1, t0: 0,
    believes: 0, kills: 0, rays: 0, los: 0, solid: 0, ground: 0, playerDead: -1, hp: 100 };
  const mf = ctx.vfx.muzzleFlash; ctx.vfx.muzzleFlash = (p, d) => { H.shots++; if (H.first < 0) H.first = +(ctx.elapsed - H.t0).toFixed(2); return mf(p, d); };
  // the player is invulnerable but every point that would have landed is counted, and the moment the running
  // total crosses his hit points is recorded: that is "how long he survives" without ending the simulation
  ctx.player.damage = (a, i) => { H.dmg += a; H.hits++; H.hp -= a; if (H.hp <= 0 && H.playerDead < 0) H.playerDead = +(ctx.elapsed - H.t0).toFixed(2); return 0; };
  const pl = ctx.audio.play.bind(ctx.audio);
  ctx.audio.play = (n, o) => { if (n === 'mimic_radio') { H.radio.push(o && o.word ? o.word : (o && o.rate ? '~' + o.rate.toFixed(2) : '~')); if (o && o.word) H.words[o.word] = (H.words[o.word] || 0) + 1; } return pl(n, o); };
  const rc = ctx.world.raycast.bind(ctx.world); ctx.world.raycast = (o, d, m) => { H.rays++; return rc(o, d, m); };
  const ls = ctx.world.lineOfSight.bind(ctx.world); ctx.world.lineOfSight = (a, b) => { H.los++; return ls(a, b); };
  const pis = ctx.world.pointInSolid.bind(ctx.world); ctx.world.pointInSolid = (x, y, z) => { H.solid++; return pis(x, y, z); };
  const gh = ctx.world.groundHeight.bind(ctx.world); ctx.world.groundHeight = (x, z, y, u) => { H.ground++; return gh(x, z, y, u); };
  ctx.events.on('enemyKilled', () => { H.kills++; });
  return 'ok';
})()`;

export const RESET_H = `(() => { const H = window.__H, ctx = window.__radius.ctx;
  H.shots = 0; H.dmg = 0; H.hits = 0; H.thrown = 0; H.radio.length = 0; H.words = {}; H.first = -1;
  H.t0 = ctx.elapsed; H.believes = 0; H.kills = 0; H.rays = 0; H.los = 0; H.solid = 0; H.ground = 0;
  H.playerDead = -1; H.hp = 100; return 'ok'; })()`;

// ---- stage a fight -------------------------------------------------------------------------------------
// t = { poi, x, z, look, d, n, tide, sec, cls, seed }
export const SETUP = (t) => `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player;
  ctx.state.data.tideLevel = ${t.tide}; ctx.state.data.securityLevel = ${t.sec};
  r.teleport(${t.x}, ${t.z}); r.setLook(${t.look}, -0.02); r.setTime(${t.hour ?? 12}); ctx.player.update(0);
  for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; } ctx.enemies.removeDead(); ctx.squads.reset();
  for (let i = 0; i < 70; i++) ctx.squads.update(0.05);
  const R0 = Math.random; let sd = ${t.seed || 12345} | 0;
  Math.random = () => { sd = sd + 0x6D2B79F5 | 0; let x = Math.imul(sd ^ sd >>> 15, 1 | sd); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  const f = p.forward, list = [];
  for (let i = 0; i < ${t.n}; i++) {
    const side = (i - (${t.n} - 1) / 2) * 5.5, d = ${t.d} + (i % 2) * 3;
    const x = p.position.x + f.x * d + f.z * side, z = p.position.z + f.z * d - f.x * side;
    const e = r.spawn('mimic', x, z, { poi: '${t.poi}', cls: ${JSON.stringify(t.cls || null)} || (i === 0 ? 'veteran' : 'regular'),
      yaw: Math.atan2(-(p.position.x - x), -(p.position.z - z)) });
    if (e) { e.root.traverse((o) => { o.userData.__enemy = true; }); e.grenades = Math.max(e.grenades, 1); list.push(e); }
  }
  Math.random = R0;
  window.__sq = ctx.squads.form(list, ctx.world.poi('${t.poi}')); window.__list = list;
  window.__sq.enterCombat();
  const H = window.__H; H.shots = 0; H.dmg = 0; H.hits = 0; H.thrown = 0; H.radio.length = 0; H.words = {};
  H.first = -1; H.t0 = ctx.elapsed; H.hp = 100; H.playerDead = -1;
  ctx.director.notify('shot', { pos: p.position.clone(), noise: 1 });
  return { n: list.length, skill: +window.__sq.skill.toFixed(2), prog: +(list[0].skill.p || 0).toFixed(2),
    w: list.map((e) => e.weapon.id), cls: list.map((e) => e.cls),
    caps: capString(list[0]) };
  function capString(m) {
    const s = m.skill; const on = [];
    for (const k of ['climb','dodge','melee','sprintW','angle','read','cut','feint','itemUse','smokeW','scav','focus','periph','flash','noteBody','patience','menuN','commitT','abortChk'])
      if (s[k] != null) on.push(k + '=' + (+s[k]).toFixed(2));
    return on.join(' ');
  }
})()`;

// advance the simulation n steps, exactly as main.js orders it (enemies, then population->squads, then director)
export const STEP = (n, dt = 0.05) => `(() => {
  const ctx = window.__radius.ctx;
  for (let i = 0; i < ${n}; i++) { ctx.elapsed += ${dt}; ctx.frame++; ctx.enemies.update(${dt}); ctx.squads.update(${dt}); ctx.director.update(${dt}); ctx.player.update(${dt}); }
  return +ctx.elapsed.toFixed(1);
})()`;
