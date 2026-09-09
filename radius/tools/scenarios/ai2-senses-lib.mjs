// Shared rig for the senses tests.
//
// src/enemies/senses.js is not reachable from the bundle until the integrator wires it into mimic.js, so
// these scenarios bundle it on their own with esbuild and inject it into the live page as `window.__senses`,
// with `three` aliased to the game's own THREE. The module then runs against the REAL world — terrain,
// colliders, flora, the Director, the player — and drives real Mimic instances through its exported API.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-senses-1.mjs --out .smoke/ai2-senses-1
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-senses-2.mjs --out .smoke/ai2-senses-2
//
// Nothing here waits on a rendered frame: post.render is stubbed and the simulation is stepped by hand.
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// 'three' resolves to the game's live namespace, so injected code shares THREE with the page (one copy,
// one set of prototypes, no interop surprises when a Vector3 crosses the boundary).
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

export async function inject(page, file = 'src/enemies/senses.js', globalName = '__senses') {
  const out = await esbuild.build({
    entryPoints: [resolve(root, file)],
    bundle: true, write: false, format: 'iife', globalName,
    target: ['es2022'], logLevel: 'silent', legalComments: 'none', plugins: [threeGlobal],
  });
  await page.addScriptTag({ content: out.outputFiles[0].text });
}

// Boot the game with no population and the renderer stubbed, then inject the module and the page-side rig.
export async function boot(page, api) {
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx;
    ctx.debug.noEnemies = true;
    if (!ctx.post.__stub) { ctx.post.__stub = true; ctx.post.render = () => {}; }
    r.start(); })()`);
  await api.wait(1200);
  await inject(page);
  await api.run(RIG);
  await api.run(`window.__senses.installSenses(window.__radius.ctx)`);
}

// ---- page-side helpers -------------------------------------------------------------------------------
export const RIG = `(() => {
  const r = window.__radius, ctx = r.ctx, TH = ctx.THREE, S = window.__senses;
  const P = ctx.player;
  const over = { moving: null, crouched: null, sprinting: null, noise: null, dead: null };
  if (!window.__S) {
    for (const k of Object.keys(over)) {
      const d = Object.getOwnPropertyDescriptor(P, k);
      const get = d && d.get ? d.get.bind(P) : () => d ? d.value : undefined;
      Object.defineProperty(P, k, { configurable: true, enumerable: true, get() { return over[k] == null ? get() : over[k]; } });
    }
  }
  const yawTo = (from, x, z) => Math.atan2(-(x - from.x), -(z - from.z));
  const A = {
    over,
    // put the player somewhere and set the four things he controls
    player(o = {}) {
      if (o.x != null) { r.teleport(o.x, o.z, o.y == null ? null : o.y); P.update(0); }
      if (o.crouch !== undefined) over.crouched = o.crouch;
      if (o.move !== undefined) over.moving = o.move;
      if (o.sprint !== undefined) over.sprinting = o.sprint;
      if (o.noise !== undefined) over.noise = o.noise;
      if (o.torch !== undefined) ctx.state.data.flashlight.on = !!o.torch;
      if (o.look != null) r.setLook(o.look, -0.02);
      S.playerModel(ctx).t = -1e9;   // force the shared player model to refresh on the next sense
      return A;
    },
    surfaceAt(x, z) { const y = ctx.world.getHeight(x, z); return ctx.world.groundHeight(x, z, y + 2.2).surface || ctx.world.getSurface(x, z); },
    // Find a point of a given surface within rad of (cx,cz) that the player can actually STAND on: the
    // deck of a catwalk counts, the grass two metres under it does not, and the returned y is the one you
    // must teleport to for the sense model to see the same ground the search did.
    findSurface(kind, cx, cz, rad, step = 3) {
      for (let d = 4; d < rad; d += step) for (let a = 0; a < 24; a++) {
        const an = a / 24 * Math.PI * 2, x = cx + Math.cos(an) * d, z = cz + Math.sin(an) * d;
        if (ctx.world.isWater(x, z)) continue;
        const base = ctx.world.getHeight(x, z);
        for (const from of [base + 0.3, base + 2.4, base + 4.6, base + 7.0]) {
          const g = ctx.world.groundHeight(x, z, from);
          if (g.y > from + 0.05 || g.y < base - 0.05) continue;
          if ((g.surface || ctx.world.getSurface(x, z)) !== kind) continue;
          if (ctx.world.pointInSolid(x, g.y + 0.9, z)) continue;
          if (ctx.world.pointInSolid(x, g.y + 1.7, z)) continue;
          return { x, z, y: g.y };
        }
      }
      return null;
    },
    // a bearing from the player on which the line is clear at every distance in ds
    openBearing(ds) {
      const eye = P.eye;
      for (let a = 0; a < 48; a++) {
        const an = a / 48 * Math.PI * 2;
        let ok = true;
        for (const d of ds) {
          const x = P.position.x + Math.cos(an) * d, z = P.position.z + Math.sin(an) * d;
          if (ctx.world.isWater(x, z)) { ok = false; break; }
          const g = ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2.2);
          const e = new TH.Vector3(x, g.y + 1.66, z);
          if (!ctx.world.lineOfSight(e, eye)) { ok = false; break; }
        }
        if (ok) return an;
      }
      return null;
    },
    // spawn a mimic and hand it to senses. We never call enemies.update, so nothing but senses drives it.
    mimic(x, z, opts = {}) {
      const m = r.spawn('mimic', x, z, Object.assign({ cls: 'regular' }, opts));
      if (!m) return null;
      m.aware = 0; m.engaged = false; m.beliefR = 0; m.lastVisT = -1e9; m.lastSeenT = -1e9;
      m.lastSeenPlayer = new TH.Vector3(1e5, 0, 1e5);
      if (opts.seed != null) m.beliefSeed = opts.seed;
      S.createSenses(m);
      m.__beliefs = 0;
      const b = m.believe.bind(m);
      m.believe = (pos, radius, t, w, force) => { m.__beliefs++; m.__lastR = radius; return b(pos, radius, t, w, force); };
      return m;
    },
    // put a mimic at a bearing/distance from the player, facing him with an angular offset in degrees
    place(m, bearing, dist, offDeg = 0) {
      const x = P.position.x + Math.cos(bearing) * dist, z = P.position.z + Math.sin(bearing) * dist;
      m.position.set(x, ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2.2).y, z);
      m.yaw = yawTo(m.position, P.position.x, P.position.z) + offDeg * Math.PI / 180;
      m.root.position.copy(m.position); m.root.rotation.y = m.yaw;
      return m;
    },
    // one full sense tick (dt large enough to beat the cadence), from a clean slate
    look(m, dt = 0.4, opts) {
      m.sense.acc = 0; m.aware = 0;
      return S.senseTick(m, dt, opts || { fov: 156, maxDay: 80, visGain: 1.5, hearGain: 1.2, decay: 0.08 });
    },
    step(m, dt = 0.05, opts) { return S.senseTick(m, dt, opts || { fov: 156, maxDay: 80, visGain: 1.5, hearGain: 1.2, decay: 0.08 }); },
    clear() { for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; e.squad = null; e.orders = null; } ctx.enemies.removeDead(); },
    dist(m) { return Math.hypot(m.position.x - P.position.x, m.position.z - P.position.z); },
    beliefErr(m) { return m.lastSeenPlayer ? Math.hypot(m.lastSeenPlayer.x - P.position.x, m.lastSeenPlayer.z - P.position.z) : Infinity; },
    yawTo,
  };
  window.__S = A;
  return true;
})()`;

export const R2 = (v) => (v == null ? null : +v.toFixed(2));
export const R3 = (v) => (v == null ? null : +v.toFixed(3));
