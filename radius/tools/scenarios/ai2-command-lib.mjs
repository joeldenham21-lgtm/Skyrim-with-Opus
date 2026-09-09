// Shared rig for the command.js scenarios.
//
// src/enemies/command.js is not reachable from the game bundle yet — the integrator has not wired it into
// squad.js — so these tests bundle it on its own with esbuild (it imports nothing but three, core/math and
// core/rng) and inject it into the running page as window.__CMD. That gives the module the REAL world: real
// terrain, real colliders, real cover points, real Mimic instances, a real Squad to drive.
//
// Nothing here waits on a rendered frame. SwiftShader draws well under one frame a second with the zone
// loaded; every number in these scenarios comes from stepping the simulation by hand inside api.run().
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// three is already on the page as the game's own copy; hand the bundle that one rather than a second 600 KB
// of it, so the injected module shares the game's classes and instanceof still works.
const THREE_NAMES = ['Vector3', 'Vector2', 'Group', 'Mesh', 'Color', 'Quaternion', 'Euler', 'Matrix4',
  'CylinderGeometry', 'SphereGeometry', 'BoxGeometry', 'PlaneGeometry', 'MeshStandardMaterial'];
const threeShim = {
  name: 'three-shim',
  setup(build) {
    build.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'threeshim' }));
    build.onLoad({ filter: /.*/, namespace: 'threeshim' }, () => ({
      contents: `const T = window.__radius.ctx.THREE;\nexport default T;\n${THREE_NAMES.map((n) => `export const ${n} = T.${n};`).join('\n')}`,
      loader: 'js',
    }));
  },
};

export async function inject(api) {
  const out = await esbuild.build({
    entryPoints: [resolve(root, 'src/enemies/command.js')],
    bundle: true, format: 'iife', globalName: '__CMD', target: ['es2022'],
    plugins: [threeShim], write: false, logLevel: 'silent',
  });
  const js = out.outputFiles[0].text;
  await api.page.addScriptTag({ content: js });
  const n = await api.run('Object.keys(window.__CMD).length');
  console.log(`injected command.js (${(js.length / 1024).toFixed(1)} KB, ${n} exports)`);
  return n;
}

export async function boot(api) {
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx;
    ctx.debug.noEnemies = true;
    if (!ctx.post.__stub) { ctx.post.__stub = true; ctx.post.render = () => {}; }
    r.start(); })()`);
  await api.wait(1500);
}

// Count every world ray anybody fires, so "this module spends N rays" is a measurement and not a claim.
export const RAYCOUNT = `(() => { const ctx = window.__radius.ctx, w = ctx.world;
  if (window.__rc) return 'already';
  window.__rc = { ray: 0, los: 0, solid: 0, ground: 0 };
  const rc = w.raycast.bind(w), ls = w.lineOfSight.bind(w), pis = w.pointInSolid.bind(w), gh = w.groundHeight.bind(w);
  w.raycast = (...a) => { window.__rc.ray++; return rc(...a); };
  w.lineOfSight = (...a) => { window.__rc.los++; return ls(...a); };
  w.pointInSolid = (...a) => { window.__rc.solid++; return pis(...a); };
  w.groundHeight = (...a) => { window.__rc.ground++; return gh(...a); };
  return 'hooked'; })()`;
export const ZERO_RC = '(() => { const r = window.__rc; r.ray = 0; r.los = 0; r.solid = 0; r.ground = 0; return 1; })()';

// Every mimic_radio transmission, with the word and the carrier the module asked for.
export const VOICEHOOK = `(() => { const ctx = window.__radius.ctx;
  if (window.__vox) return 'already'; window.__vox = [];
  const pl = ctx.audio.play.bind(ctx.audio);
  ctx.audio.play = (n, o) => { if (n === 'mimic_radio') window.__vox.push({ w: (o && o.word) || null, c: (o && o.carrier) || 'field', g: o && o.gain, t: +ctx.elapsed.toFixed(2), by: null }); return pl(n, o); };
  return 'hooked'; })()`;

// The merge the integrator will do in mimic.js: this module's SKILL rows mixed into every mimic's skill object
// at progress p. Proving it here is proving §C2.
export const MIXSKILL = `(() => { window.__mix = (m, p) => {
  const R = window.__CMD.SKILL_ROWS;
  for (const k in R) m.skill[k] = R[k][0] + (R[k][1] - R[k][0]) * p;
  m.skill.p = p; return m.skill; }; return 1; })()`;

// Build the mind on a real Squad, handed the real solvers squad.js already owns, and stop squad.js's own
// assignJobs from fighting it. This IS the integration, minus the file edits.
export const WIRE = `(() => { window.__wire = (sq, opts) => {
  const ctx = window.__radius.ctx, S = ctx.squads;
  const cmd = window.__cmd || (window.__cmd = window.__CMD.createCommand(ctx, {}));
  const solvers = {
    bestCover: S.bestCover, walkable: S.walkable,
    anomalyAt: (x, z, pad) => { for (const a of ctx.anomalies.list) { if (!a || !a.position) continue; const r = (a.radius || 6) + (pad || 2); if (Math.hypot(a.position.x - x, a.position.z - z) < r) return a; } return null; },
    anomalyOnLine: (ax, az, bx, bz, pad) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      for (const a of ctx.anomalies.list) { if (!a || !a.position) continue; const r = (a.radius || 6) + (pad || 1.6);
        let t = l2 > 1e-6 ? ((a.position.x - ax) * dx + (a.position.z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(ax + dx * t - a.position.x, az + dz * t - a.position.z) < r) return a; } return null; },
    highGround: (m, o) => sq.highGround(m, o),
    orderHold: (m, o, f) => sq.orderHold(m, o, f),
    orderAdvance: (m, o) => sq.orderAdvance(m, o),
    orderFlank: (m, o) => sq.orderFlank(m, o),
    orderOverwatch: (m, o) => sq.orderOverwatch(m, o),
    orderShaken: (m, o) => sq.orderShaken(m, o),
    orderSweep: (n) => sq.orderSweep(n),
    spreadOnto: (p, j, r) => sq.spreadOnto(p, j, r),
    coverBound: (m, o) => sq.coverBound(m, o),
    beginRegroup: () => sq.beginRegroup(),
    beginBreakoff: () => sq.beginBreakoff(),
    plant: () => sq.plant(),
    members: () => sq.members,
    leader: () => sq.leader,
  };
  const mind = cmd.makeMind(sq, solvers);
  sq.mind = mind;
  // the integrator's seams, applied here as monkey patches so the test measures command.js and nothing else
  if (!(opts && opts.keepJobs)) sq.assignJobs = () => { mind.tick(0.2, sq.members); };
  const say = sq.say.bind(sq);
  sq.say = (k, from, mult) => mind.say(k, from, mult);
  const killed = sq.onKilled.bind(sq);
  sq.onKilled = (m, t) => { const wasLeader = (sq.leaderRef === m); const r = killed(m, t); if (wasLeader) mind.onLeaderDown(m); else mind.interrupt('manDown', m.position.x, m.position.z, m); return r; };
  const up = sq.update.bind(sq);
  sq.update = (dt) => {
    mind.update(dt);
    // senses.js's licensed job, standing in for it here: a man with a live line can see which way the Explorer
    // is pointing, and that is the ONLY route by which picture.facing is ever written. Without it the belief
    // cone is 180 degrees and the squad refuses to manoeuvre, which is correct and is why this must be wired.
    const p = ctx.player;
    for (const m of sq.members) {
      if (!m.alive || ctx.elapsed - (m.lastVisT ?? -1e9) > 0.4) continue;
      mind.observe('face', Math.atan2(p.forward.z, p.forward.x)); break;
    }
    return up(dt);
  };
  void say;
  return mind;
}; return 1; })()`;

// A contact set up on real ground: n mimics at d metres in front of the player, formed into one squad, wired.
export const SETUP = (t) => `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player;
  ctx.state.data.tideLevel = ${t.tide || 2}; ctx.state.data.securityLevel = ${t.sec || 3};
  r.teleport(${t.x}, ${t.z}); r.setLook(${t.look || 0}, -0.02); r.setTime(${t.hour || 12}); ctx.player.update(0);
  for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; } ctx.enemies.removeDead(); ctx.squads.reset();
  for (let i = 0; i < 70; i++) ctx.squads.update(0.05);
  const R0 = Math.random; let sd = ${t.seed || 12345} | 0;
  Math.random = () => { sd = sd + 0x6D2B79F5 | 0; let x = Math.imul(sd ^ sd >>> 15, 1 | sd); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  const f = p.forward, list = [];
  for (let i = 0; i < ${t.n}; i++) {
    const side = (i - (${t.n} - 1) / 2) * ${t.spread || 5.5}, d = ${t.d} + (i % 2) * 3;
    const x = p.position.x + f.x * d + f.z * side, z = p.position.z + f.z * d - f.x * side;
    const e = r.spawn('mimic', x, z, { poi: '${t.poi}', cls: i === 0 ? '${t.lead || 'veteran'}' : 'regular', yaw: Math.atan2(-(p.position.x - x), -(p.position.z - z)) });
    if (e) { e.grenades = Math.max(e.grenades, 1); e.voice = i / 8; e.id = i + 1; list.push(e); }
  }
  Math.random = R0;
  // the zone's escalation gates which plays exist at all (composition). Earn it the way the game does:
  // noise on the ground and bodies on it, then let the director's four-second clock fold it in.
  for (let i = 0; i < ${t.esc == null ? 0 : t.esc} * 14; i++) ctx.director.noteActivity(p.position, 'noise', 1);
  for (let i = 0; i < ${t.esc == null ? 0 : t.esc} * 4; i++) ctx.director.noteActivity(p.position, 'blood', 1);
  for (let i = 0; i < 120; i++) { ctx.elapsed += 0.05; ctx.director.update(0.05); }
  const sq = ctx.squads.form(list, ctx.world.poi('${t.poi}'));
  window.__sq = sq; window.__list = list;
  for (const m of list) window.__mix(m, ${t.p == null ? 1 : t.p});
  const mind = window.__wire(sq, ${JSON.stringify(t.opts || {})});
  sq.enterCombat();
  for (const m of list) { m.aware = 1; m.engaged = true; if (m.setState) m.setState('engage'); if (!m.lastSeenPlayer) m.lastSeenPlayer = new ctx.THREE.Vector3(); m.lastSeenPlayer.copy(p.position); m.lastSeenT = ctx.elapsed; m.lastVisT = ctx.elapsed; }
  mind.write(p.position, ctx.elapsed, 0, 'seen', list[0]);
  mind.observe('face', Math.atan2(p.forward.z, p.forward.x));
  return { n: list.length, skill: +sq.skill.toFixed(2), lead: sq.leader ? sq.leader.cls : null, tier: mind.tier, esc: ctx.director.escalation };
})()`;

export const STEP = (n, dt = 0.05) => `(() => {
  const ctx = window.__radius.ctx;
  for (let i = 0; i < ${n}; i++) { ctx.elapsed += ${dt}; ctx.enemies.update(${dt}); ctx.squads.update(${dt}); ctx.director.update(${dt}); ctx.player.update(${dt}); }
  return +ctx.elapsed.toFixed(2);
})()`;

let fails = 0;
export function pass(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  if (!ok) fails++;
  return ok;
}
export function report() { console.log(fails ? `\n${fails} FAILURES` : '\nall green'); return fails; }
