// Shared rig for the kit scenarios.
//
// src/enemies/kit.js is not reachable from the game bundle yet — the integrator has not wired it into
// mimic.js — so these tests bundle it (with the real enemies/loadout.js beside it) and inject it into the
// running page as window.__KIT. That gives the module the REAL world: real terrain, real colliders, real
// ctx.loot piles, real Mimic instances with real rolled loadouts.
//
// Nothing here waits on a rendered frame. SwiftShader draws well under one frame a second with the zone
// loaded; every number these scenarios print comes from driving the simulation by hand inside api.run().
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function inject(api) {
  const out = await esbuild.build({
    entryPoints: [resolve(root, 'tools/scenarios/ai2-kit-bundle.mjs')],
    bundle: true, format: 'iife', globalName: '__KIT', target: ['es2022'],
    external: ['three'], write: false, logLevel: 'silent',
  });
  const js = out.outputFiles[0].text;
  await api.page.addScriptTag({ content: js });
  const n = await api.run('Object.keys(window.__KIT).length');
  console.log(`injected kit.js + loadout.js (${(js.length / 1024).toFixed(1)} KB, ${n} exports)`);
  return n;
}

// Start the game and thin the scene so the page is not fighting the software renderer while we step the sim.
export async function boot(api, { noEnemies = true } = {}) {
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx;
    ctx.debug.noEnemies = ${noEnemies};
    if (!ctx.post.__stub) { ctx.post.__stub = true; ctx.post.render = () => {}; }
    r.start(); })()`);
  await api.wait(1800);
  await api.run(`(() => { const ctx = window.__radius.ctx; ctx.player.teleport(0, 300); window.__radius.god(); return 1; })()`);
}

// Count every world ray anybody fires, so "this module spends almost none" is a measurement, not a claim.
export const RAYCOUNT = `(() => { const ctx = window.__radius.ctx, w = ctx.world;
  if (window.__rc) return 'already';
  window.__rc = { ray: 0, los: 0, solid: 0, ground: 0 };
  const rc = w.raycast.bind(w), ls = w.lineOfSight.bind(w), pis = w.pointInSolid.bind(w), gh = w.groundHeight.bind(w);
  w.raycast = (...a) => { window.__rc.ray++; return rc(...a); };
  w.lineOfSight = (...a) => { window.__rc.los++; return ls(...a); };
  w.pointInSolid = (...a) => { window.__rc.solid++; return pis(...a); };
  w.groundHeight = (...a) => { window.__rc.ground++; return gh(...a); };
  return 'hooked'; })()`;

export const ZERO_RC = `(() => { const r = window.__rc; r.ray = 0; r.los = 0; r.solid = 0; r.ground = 0; return 1; })()`;

// Every audio call, by name and by who made it. The kit is supposed to be audible; the tests check it is.
export const AUDIOHOOK = `(() => { const ctx = window.__radius.ctx, a = ctx.audio;
  if (window.__au) return 'already';
  window.__au = { plays: [], loops: [] };
  const pl = a.play.bind(a), lp = a.loop.bind(a);
  a.play = (n, o) => { window.__au.plays.push(n); return pl(n, o); };
  a.loop = (n, o) => { window.__au.loops.push(n); return lp(n, o); };
  return 'hooked'; })()`;

// The plan tick a squad would run, plus the per-frame clock, driven by hand. This is the shape the integrator
// will wire: kitTick owns the frame while a use is committed, scavengeTick is offered a slot when it is not.
export const DRIVER = `(() => { window.__drive = (steps, dt, opts) => {
  const ctx = window.__radius.ctx, K = window.__KIT;
  opts = opts || {};
  const seen = [];
  for (let i = 0; i < steps; i++) {
    ctx.elapsed += dt;
    try { ctx.frame++; } catch (e) {}
    if (!opts.noEnemies) ctx.enemies.update(dt);
    for (const m of ctx.enemies.list) {
      if (m.type !== 'mimic' || !m.alive || !m.kit) continue;
      if (K.kitTick(m, dt)) continue;                 // the kit owns the frame: no rifle, no orders
      if (!opts.noScav) K.scavengeTick(m, dt);
      if (!opts.noPlan && (i % 6) === 0) { const w = K.wantItem(m); if (w) { seen.push(w.act + ':' + w.why); K.useWanted(m, w); } }
    }
    K.updateKit(ctx, dt);
    ctx.world.update(dt, ctx.elapsed);
  }
  return seen; }; return 1; })()`;

export function pass(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  return ok ? 0 : 1;
}
export function section(t) { console.log(`\n---- ${t} ${'-'.repeat(Math.max(0, 86 - t.length))}`); }
