// Shared rig for the traversal scenarios.
//
// src/enemies/traversal.js is not reachable from the game bundle yet — the integrator has not wired it into
// mimic.js — so these tests bundle it on its own with esbuild (it imports nothing but core/math and core/rng,
// so the bundle is a couple of KB and self-contained) and inject it into the running page as window.__TRAV.
// That gives the module the REAL world: real terrain, real colliders, real structures, real Mimic instances.
//
// Nothing here waits on a rendered frame. SwiftShader draws well under one frame a second with the zone
// loaded; every number below comes from driving the simulation by hand inside api.run().
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function inject(api) {
  const out = await esbuild.build({
    entryPoints: [resolve(root, 'src/enemies/traversal.js')],
    bundle: true, format: 'iife', globalName: '__TRAV', target: ['es2022'],
    write: false, logLevel: 'silent',
  });
  const js = out.outputFiles[0].text;
  await api.page.addScriptTag({ content: js });
  const n = await api.run('Object.keys(window.__TRAV).length');
  console.log(`injected traversal.js (${(js.length / 1024).toFixed(1)} KB, ${n} exports)`);
  return n;
}

// Start the game and thin the scene so the page is not fighting the software renderer while we step the sim.
export async function boot(api, { noEnemies = true } = {}) {
  await api.run(`(() => { const r = window.__radius, ctx = r.ctx;
    ctx.debug.noEnemies = ${noEnemies};
    if (!ctx.post.__stub) { ctx.post.__stub = true; ctx.post.render = () => {}; }
    r.start(); })()`);
  await api.wait(1500);
}

// Count every world ray anybody fires, so "this module spends no rays" is a measurement and not a claim.
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

// A fake body: the smallest thing traversal.js will accept. Used where a real Mimic would only add noise.
export const STUB = `(() => { window.__stub = (x, z, skill) => {
  const ctx = window.__radius.ctx, TH = ctx.THREE;
  const y = ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2).y;
  const m = {
    ctx, position: new TH.Vector3(x, y, z), yaw: 0, radius: 0.32, height: 1.85, alive: true, stunned: 0,
    hp: 90, maxHp: 90, groundY: y, burstLeft: 0, aiming: false, stuckT: 0, cover: null, lastSeenPlayer: null,
    skill: Object.assign({ climb: 1, sprintW: 0.95, dodge: 0.85, melee: 0.9 }, skill || {}),
    sounds: new Set(), hurt: 0, damaged: 0, meleeHits: 0,
    sound(n, o) { (this.snd || (this.snd = [])).push(n); return null; },
    loopSound() { return null; },
    damage(a) { this.damaged += a; this.hp -= a; return false; },
    hurtPlayer(a) { this.meleeHits++; },
    faceToward(tx, tz, dt, rate) { const t = Math.atan2(-(tx - this.position.x), -(tz - this.position.z));
      let d = (t - this.yaw) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-(rate || 8) * dt)); },
    distanceToPlayer() { return this.position.distanceTo(ctx.player.position); },
    get player() { return ctx.player; },
  };
  window.__TRAV.createBody(m);
  return m;
}; return 1; })()`;

export function pass(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  return ok ? 0 : 1;
}
