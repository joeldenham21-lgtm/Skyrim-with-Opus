// Shared rig for the ambush tests.
//
// src/enemies/ambush.js is not reachable from the bundle until the integrator wires it into mimic.js, so
// these scenarios bundle it on their own with esbuild and inject it into the live page as `window.__ambush`,
// with `three` aliased to the game's own THREE. The module then runs against the REAL world — terrain,
// colliders, structures, flora, the Director — and drives real Mimic instances through its exported API.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-ambush-1.mjs --out .smoke/ai2-ambush-1
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-ambush-2.mjs --out .smoke/ai2-ambush-2
//
// Nothing here waits on a rendered frame: post.render is stubbed and the simulation is stepped by hand.
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const threeGlobal = {
  name: 'three-from-page',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'tg' }));
    b.onLoad({ filter: /.*/, namespace: 'tg' }, () => ({
      contents: `const T = window.__radius.ctx.THREE;
        export default T;
        export const Vector2 = T.Vector2, Vector3 = T.Vector3, Vector4 = T.Vector4, Quaternion = T.Quaternion,
          Matrix3 = T.Matrix3, Matrix4 = T.Matrix4, Euler = T.Euler, Color = T.Color, Box3 = T.Box3,
          Sphere = T.Sphere, Ray = T.Ray, Group = T.Group, Object3D = T.Object3D, MathUtils = T.MathUtils;`,
      loader: 'js',
    }));
  },
};

export async function inject(page, file = 'src/enemies/ambush.js', globalName = '__ambush') {
  const out = await esbuild.build({
    entryPoints: [resolve(root, file)],
    bundle: true, write: false, format: 'iife', globalName,
    target: ['es2022'], logLevel: 'silent', legalComments: 'none', plugins: [threeGlobal],
  });
  await page.addScriptTag({ content: out.outputFiles[0].text });
}

export async function boot(page, api) {
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx;
    ctx.debug.noEnemies = true;
    if (!ctx.post.__stub) { ctx.post.__stub = true; ctx.post.render = () => {}; }
    r.start(); })()`);
  await api.wait(1400);
  await inject(page);
  await api.run(RIG);
}

// ---- page-side helpers -------------------------------------------------------------------------------
export const RIG = `(() => {
  const r = window.__radius, ctx = r.ctx, TH = ctx.THREE, A = window.__ambush;
  const P = ctx.player;

  // AUDIT: every call into the audio engine is counted, tagged with the entity nearest to it, so
  // "zero sound while hidden" is measured rather than asserted.
  if (!ctx.audio.__audited) {
    ctx.audio.__audited = true;
    ctx.audio.__log = [];
    const play = ctx.audio.play.bind(ctx.audio), loop = ctx.audio.loop.bind(ctx.audio);
    ctx.audio.play = (name, o = {}) => { ctx.audio.__log.push({ k: 'play', name, gain: o.gain, pos: o.pos ? { x: o.pos.x, z: o.pos.z } : null, t: ctx.elapsed }); return play(name, o); };
    ctx.audio.loop = (name, o = {}) => { ctx.audio.__log.push({ k: 'loop', name, gain: o.gain, pos: o.pos ? { x: o.pos.x, z: o.pos.z } : null, t: ctx.elapsed }); return loop(name, o); };
  }
  // and every ray, so the cost claims are measured too
  if (!ctx.world.__counted) {
    ctx.world.__counted = true;
    ctx.world.__rays = 0; ctx.world.__solid = 0;
    const rc = ctx.world.raycast, los = ctx.world.lineOfSight, pis = ctx.world.pointInSolid;
    ctx.world.raycast = (...a) => { ctx.world.__rays++; return rc(...a); };
    ctx.world.lineOfSight = (...a) => { return los(...a); };   // los goes through raycast; do not double count
    ctx.world.pointInSolid = (...a) => { ctx.world.__solid++; return pis(...a); };
  }

  const yawTo = (from, x, z) => Math.atan2(-(x - from.x), -(z - from.z));

  const H = {
    A,
    audio() { return ctx.audio.__log; },
    clearAudio() { ctx.audio.__log.length = 0; },
    // audio calls whose position is within r of (x,z) — i.e. attributable to a thing standing there
    audioNear(x, z, r = 4, since = -1e9) {
      return ctx.audio.__log.filter((e) => e.t >= since && e.pos && Math.hypot(e.pos.x - x, e.pos.z - z) < r);
    },
    rays() { return ctx.world.__rays; },
    solids() { return ctx.world.__solid; },

    // Nothing renders in these runs, so the camera's world matrix is never refreshed by three. Anything
    // that asks "is the player looking at me" reads camera.matrixWorld, so we refresh it by hand.
    sync() { P.update(0.016); P.rig.updateMatrixWorld(true); ctx.camera.updateMatrixWorld(true); },
    player(o = {}) {
      if (o.x != null) { r.teleport(o.x, o.z, o.y == null ? null : o.y); }
      if (o.look != null) r.setLook(o.look, o.pitch == null ? -0.02 : o.pitch);
      if (o.torch !== undefined) ctx.state.data.flashlight.on = !!o.torch;
      H.sync();
      return P.position;
    },
    lookAt(x, z) { r.setLook(yawTo(P.position, x, z), -0.02); H.sync(); },
    lookAway(x, z) { r.setLook(yawTo(P.position, x, z) + Math.PI, -0.02); H.sync(); },
    // what the mimic's own eyes say about being looked at, measured not assumed
    seenBy(m, deg = 60) { return m.observedByPlayer(deg); },

    // A mimic that this module drives and nothing else does. enemies.update is never called, so every
    // observed behaviour below belongs to ambush.js.
    mimic(x, z, opts = {}) {
      const m = r.spawn('mimic', x, z, Object.assign({ cls: 'regular' }, opts));
      if (!m) return null;
      m.aware = 0; m.engaged = false; m.beliefR = 0; m.lastVisT = -1e9; m.lastSeenT = -1e9;
      m.lastSeenPlayer = new TH.Vector3(1e5, 0, 1e5);
      if (opts.seed != null) m.beliefSeed = opts.seed;
      if (opts.skill) for (const k of Object.keys(opts.skill)) m.skill[k] = opts.skill[k];
      A.createHide(m, opts.hideOpts || {});
      m.__fires = 0;
      return m;
    },
    // set the three ambush rows plus anything else, after the mimic exists
    skill(m, rows) { for (const k of Object.keys(rows)) m.skill[k] = rows[k]; return m; },
    // freeze the curve: mimic.js re-mixes every 2 s, but we never call mimic.tick, so nothing re-mixes.
    // (kept explicit so a future integrator reading this knows why the rows stay put)
    place(m, x, z) {
      const y = ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2.2).y;
      m.position.set(x, y, z); m.root.position.copy(m.position);
      return m;
    },
    step(m, dt = 0.05, n = 1) {
      let owned = 0;
      for (let i = 0; i < n; i++) { ctx.elapsed += dt; if (A.hideTick(m, dt)) owned++; }
      return owned;
    },
    // step several at once, advancing the clock ONCE per iteration
    stepAll(list, dt = 0.05, n = 1) {
      for (let i = 0; i < n; i++) { ctx.elapsed += dt; ctx.frame++; for (const m of list) A.hideTick(m, dt); }
    },
    hide(m) { return A.describe(m); },
    state(m) { return m.hide ? m.hide.state : 'none'; },
    beliefErr(m) { return m.lastSeenPlayer ? Math.hypot(m.lastSeenPlayer.x - P.position.x, m.lastSeenPlayer.z - P.position.z) : Infinity; },
    dist(m) { return Math.hypot(m.position.x - P.position.x, m.position.z - P.position.z); },
    clear() { for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; e.squad = null; e.orders = null; } ctx.enemies.removeDead(); A.resetAmbush(); },
    poi(id) { const p = ctx.world.poi(id); return p ? { id: p.id, x: p.x, z: p.z, r: p.r, kind: p.kind } : null; },
    counts() {
      const w = ctx.world;
      return { hiding: w.hidingSpots.length, cover: w.coverPoints.length, spawn: w.spawnSpots.length,
        hidden: w.spawnSpots.filter((s) => s.kind === 'hidden').length };
    },
    yawTo,
  };
  window.__H = H;
  return true;
})()`;

export const R2 = (v) => (v == null ? null : +v.toFixed(2));
export const R3 = (v) => (v == null ? null : +v.toFixed(3));
