// senses.js — the detection model, measured against the real world.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-senses-1.mjs --out .smoke/ai2-senses-1
//
// 1. THE CONE TABLE      focus is a sighting, peripheral is a guess, near sees you regardless of facing
// 2. CONCEALMENT         crouch / still / grass / torch-off, in the ordering the player can learn
// 3. SURFACE HEARING     the same walk on grass, mud, road, rock, metal — and how long each takes to register
// 4. THE SUPPRESSOR      a quiet round does not reach; a loud one does
// 5. MUZZLE FLASH        at night, a suppressed shot is SEEN even though it was never heard
import { boot } from './ai2-senses-lib.mjs';

const say = (k, v) => console.log(k.padEnd(9), JSON.stringify(v));
let fails = 0;
const ok = (name, cond, detail) => { if (!cond) { fails++; console.log('FAIL    ', name, detail === undefined ? '' : JSON.stringify(detail)); } else console.log('pass    ', name, detail === undefined ? '' : JSON.stringify(detail)); };

export default async function (page, api) {
  await boot(page, api);

  // ---- an open place with a clear line at 4, 20 and 45 m -------------------------------------------
  const site = await api.run(`(() => {
    const r = window.__radius, ctx = r.ctx, S = window.__S;
    r.god(true); r.setTime(12);
    for (const id of ['field_a', 'marsh', 'field_b', 'north', 'checkpoint', 'rail']) {
      const P = ctx.world.poi(id); if (!P) continue;
      for (let k = 0; k < 6; k++) {
        const x = P.x + (k % 3 - 1) * P.r * 0.35, z = P.z + (Math.floor(k / 3) - 0.5) * P.r * 0.35;
        if (ctx.world.isWater(x, z)) continue;
        S.player({ x, z, crouch: false, move: true, noise: 0, torch: false });
        const b = S.openBearing([4, 20, 45]);
        if (b != null) return { poi: id, x: +x.toFixed(1), z: +z.toFixed(1), bearing: +b.toFixed(3), surface: S.surfaceAt(x, z) };
      }
    }
    return null;
  })()`);
  say('site', site);
  if (!site) { console.log('FAIL     no open line found in the world'); return; }

  // ---- 1. the cone table --------------------------------------------------------------------------
  const cones = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, B = ${site.bearing};
    S.clear();
    const m = S.mimic(${site.x} + 30, ${site.z} + 30, { seed: 0.31 });
    m.skill.p = 0.5;                       // mid curve; focus/periph rows come from senses.SKILL_ROWS
    const rows = [];
    for (const d of [4, 20, 45]) for (const off of [0, 15, 25, 40, 60, 75, 90, 175]) {
      S.place(m, B, d, off);
      m.lastVisT = -1e9; m.beliefR = 0; m.lastSeenT = -1e9; m.__beliefs = 0;
      const s = S.look(m);
      rows.push({ d, off, mode: s.mode, vis: +s.vis.toFixed(3), sighting: ctx.elapsed - m.lastVisT < 0.5, r: +m.beliefR.toFixed(1), los: s.los });
    }
    return { rows, rays: m.sense.rays };
  })()`);
  console.log('\n1. CONE TABLE  (mode 1 focus | 2 peripheral | 3 near | 0 nothing)');
  for (const r of cones.rows) console.log(`   d=${String(r.d).padStart(2)}m off=${String(r.off).padStart(3)}deg  mode ${r.mode}  vis ${r.vis.toFixed(3)}  sighting ${r.sighting ? 'Y' : '.'}  beliefR ${r.r}`);
  const focus = cones.rows.filter((r) => r.mode === 1), periph = cones.rows.filter((r) => r.mode === 2), near = cones.rows.filter((r) => r.mode === 3);
  ok('focus is a sighting', focus.length > 0 && focus.every((r) => r.sighting && r.r === 0), { n: focus.length });
  ok('peripheral is NOT', periph.length > 0 && periph.every((r) => !r.sighting && r.r >= 3), { n: periph.length, r: periph.map((p) => p.r) });
  ok('near sees any bearing', near.length === 8 && near.every((r) => r.sighting), { n: near.length });
  ok('peripheral is half range', cones.rows.filter((r) => r.d === 45 && r.off >= 40).every((r) => r.mode === 0), {});

  // ---- 2. concealment -----------------------------------------------------------------------------
  const conceal = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, SS = window.__senses, B = ${site.bearing};
    S.clear();
    const m = S.mimic(${site.x} + 30, ${site.z} + 30, { seed: 0.31 });
    m.skill.p = 0.5;
    const grass = S.findSurface('grass', ${site.x}, ${site.z}, 90) || { x: ${site.x}, z: ${site.z} };
    const road = S.findSurface('road', ${site.x}, ${site.z}, 240) || S.findSurface('rock', ${site.x}, ${site.z}, 160) || grass;
    const CFG = [
      { name: 'road+stand+move+torch', at: road, crouch: false, move: true, torch: true },
      { name: 'road+stand+move', at: road, crouch: false, move: true, torch: false },
      { name: 'grass+stand+move+torch', at: grass, crouch: false, move: true, torch: true },
      { name: 'grass+stand+move', at: grass, crouch: false, move: true, torch: false },
      { name: 'grass+stand+still', at: grass, crouch: false, move: false, torch: false },
      { name: 'grass+crouch+still', at: grass, crouch: true, move: false, torch: false },
    ];
    const out = [];
    for (const c of CFG) {
      S.player({ x: c.at.x, z: c.at.z, y: c.at.y, crouch: c.crouch, move: c.move, noise: 0, torch: c.torch });
      const P = SS.playerModel(ctx);
      const bb = S.openBearing([45]);
      S.place(m, bb == null ? B : bb, 45, 0);     // 45 m so the *1.6 clamp does not saturate the reading
      m.lastVisT = -1e9; m.beliefR = 0;
      const s = S.look(m);
      out.push({ name: c.name, surf: P.surf, flora: +P.flora.toFixed(2), conceal: +P.conceal.toFixed(3), vis: +s.vis.toFixed(3), los: s.los });
    }
    return { out, grass: { x: +grass.x.toFixed(0), z: +grass.z.toFixed(0) }, road: { x: +road.x.toFixed(0), z: +road.z.toFixed(0) } };
  })()`);
  console.log('\n2. CONCEALMENT  (same mimic, same 45 m, clear line in every case)');
  for (const c of conceal.out) console.log(`   ${c.name.padEnd(24)} surf ${String(c.surf).padEnd(8)} flora ${c.flora}  conceal ${c.conceal.toFixed(3)}  vis ${c.vis.toFixed(3)} ${c.los ? '' : ' (NO LINE)'}`);
  const V = Object.fromEntries(conceal.out.map((c) => [c.name, c.vis]));
  const worst = V['road+stand+move+torch'], best = V['grass+crouch+still'];
  ok('monotone ordering', V['road+stand+move+torch'] >= V['road+stand+move'] - 1e-6
    && V['road+stand+move'] >= V['grass+stand+move+torch'] && V['grass+stand+move+torch'] > V['grass+stand+move']
    && V['grass+stand+move'] > V['grass+stand+still'] && V['grass+stand+still'] > V['grass+crouch+still'], V);
  ok('crouch+still+grass >= 3.2x harder', best > 0 ? worst / best >= 3.2 : worst > 0, { ratio: best > 0 ? +(worst / best).toFixed(2) : 'inf' });

  // ---- 3. surface hearing -------------------------------------------------------------------------
  const hearRes = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, SS = window.__senses, B = ${site.bearing};
    S.clear();
    const m = S.mimic(${site.x} + 30, ${site.z} + 30, { seed: 0.31 });
    m.skill.p = 0.5;
    const kinds = ['grass', 'mud', 'road', 'rock', 'concrete', 'metal', 'wood'];
    const out = [];
    for (const k of kinds) {
      const at = S.findSurface(k, ${site.x}, ${site.z}, 300, 4) || (k === 'concrete' || k === 'metal' || k === 'wood' ? S.findSurface(k, ctx.world.poi('object12').x, ctx.world.poi('object12').z, 90, 3) : null);
      if (!at) { out.push({ surf: k, found: false }); continue; }
      S.player({ x: at.x, z: at.z, y: at.y, crouch: false, move: true, sprint: false, noise: 0.85, torch: false });
      S.place(m, B, 10, 175);           // facing away: hearing is the only channel
      m.aware = 0; m.beliefR = 0; m.lastVisT = -1e9; m.lastSeenT = -1e9; m.sense.acc = 0;
      const s0 = S.look(m);
      // how long before it turns round
      m.aware = 0; m.sense.acc = 0;
      let t = 0; for (let i = 0; i < 200 && m.aware < 0.4; i++) { ctx.frame++; ctx.elapsed += 0.05; t += 0.05; S.step(m, 0.05); }
      out.push({ surf: k, found: true, stood: SS.playerModel(ctx).surf, mult: SS.SURFACE_NOISE[k], hear: +s0.hear.toFixed(3), err: +s0.hr.toFixed(1), vis: +s0.vis.toFixed(3), detect: m.aware >= 0.4 ? +t.toFixed(2) : null });
    }
    return out;
  })()`);
  console.log('\n3. SURFACE HEARING  (a brisk walk, noise 0.85, at 10 m, mimic facing away)');
  for (const h of hearRes) console.log(h.found
    ? `   ${h.surf.padEnd(9)} x${h.mult}${h.stood === h.surf ? ' ' : ' (stood on ' + h.stood + ')'}  hear ${h.hear.toFixed(3)}  belief error ${h.err} m  ->  aware 0.4 after ${h.detect === null ? '>10' : h.detect} s`
    : `   ${h.surf.padEnd(9)} (no such ground found in this build)`);
  const byS = Object.fromEntries(hearRes.filter((h) => h.found && h.stood === h.surf).map((h) => [h.surf, h]));
  ok('sight contributed nothing', hearRes.filter((h) => h.found).every((h) => h.vis === 0), {});
  ok('every ground was really stood on', hearRes.filter((h) => h.found).every((h) => h.stood === h.surf), hearRes.filter((h) => h.found && h.stood !== h.surf).map((h) => [h.surf, h.stood]));
  if (byS.metal && byS.grass) ok('metal >= 2.2x grass', byS.metal.hear / byS.grass.hear >= 2.2, { ratio: +(byS.metal.hear / byS.grass.hear).toFixed(2) });
  else if (byS.road && byS.grass) ok('road > grass (no metal ground here)', byS.road.hear > byS.grass.hear, { road: byS.road.hear, grass: byS.grass.hear });
  const order = hearRes.filter((h) => h.found && h.stood === h.surf && h.detect !== null);
  ok('louder ground is heard sooner', order.every((h) => order.every((g) => h.mult <= g.mult || h.detect <= g.detect + 0.06)), order.map((h) => [h.surf, h.detect]));

  // ---- 4. the suppressor --------------------------------------------------------------------------
  const supp = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, B = ${site.bearing}, TH = ctx.THREE;
    S.clear();
    window.__radius.setTime(12);
    S.player({ x: ${site.x}, z: ${site.z}, crouch: false, move: false, noise: 0, torch: false });
    const m = S.mimic(${site.x} + 30, ${site.z} + 30, { seed: 0.31 });
    m.skill.p = 0.5;
    S.place(m, B, 40, 175);
    const phase = (noise) => {
      m.__beliefs = 0; m.aware = 0; m.beliefR = 0; m.lastVisT = -1e9; m.lastSeenT = -1e9; m.sense.acc = 0;
      let heard = 0, err = 0;
      for (let i = 0; i < 10; i++) {
        ctx.frame++; ctx.elapsed += 0.5;
        ctx.director.notify('shot', { pos: ctx.player.position.clone(), noise });
        const s = S.step(m, 0.5);
        if (s.hearKind === 2) { heard++; err = s.hr; }
      }
      return { noise, heard, beliefs: m.__beliefs, aware: +m.aware.toFixed(2), err: +err.toFixed(1), beliefErr: +S.beliefErr(m).toFixed(1) };
    };
    const loud = phase(1.0);
    for (let i = 0; i < 20; i++) { ctx.frame++; ctx.elapsed += 0.5; }   // let the ring forget
    const quiet = phase(0.33);
    return { loud, quiet, d: 40 };
  })()`);
  console.log('\n4. THE SUPPRESSOR  (10 shots at 40 m, mimic facing away)');
  console.log(`   noise 1.00  heard ${supp.loud.heard}/10  beliefs ${supp.loud.beliefs}  aware ${supp.loud.aware}  its error ${supp.loud.err} m, actually ${supp.loud.beliefErr} m off`);
  console.log(`   noise 0.33  heard ${supp.quiet.heard}/10  beliefs ${supp.quiet.beliefs}  aware ${supp.quiet.aware}`);
  ok('a loud round reaches 40 m', supp.loud.heard >= 8, supp.loud.heard);
  ok('a suppressed one does not', supp.quiet.heard === 0 && supp.quiet.beliefs === 0, supp.quiet);
  ok('and it never gets your feet', supp.loud.beliefErr > 1.0, supp.loud.beliefErr);

  // ---- 5. muzzle flash ----------------------------------------------------------------------------
  const flash = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, SS = window.__senses;
    S.clear();
    window.__radius.setTime(1);      // full dark
    S.player({ x: ${site.x}, z: ${site.z}, crouch: false, move: false, noise: 0, torch: false });
    const b = S.openBearing([40, 90]);
    if (b == null) return { skipped: 'no clear 90 m line at this site' };
    const run = (skill, d, shots = 20, off = 0) => {
      S.clear();
      const m = S.mimic(${site.x} + 30, ${site.z} + 30, { seed: 0.62 });
      m.skill.p = 1; m.skill.flash = skill;
      S.place(m, b, d, off);
      m.__beliefs = 0; m.aware = 0; m.beliefR = 0; m.lastVisT = -1e9; m.lastSeenT = -1e9;
      const f0 = SS.stats().flashes;
      let heard = 0;
      for (let i = 0; i < shots; i++) {
        ctx.state.data.hour = 1; ctx.frame++; ctx.elapsed += 0.5;
        ctx.director.notify('shot', { pos: ctx.player.position.clone(), noise: 0.33 });   // suppressed
        const s = S.step(m, 0.5);
        if (s.hearKind === 2) heard++;
      }
      return { skill, d, shots, seen: SS.stats().flashes - f0, heard, beliefs: m.__beliefs, aware: +m.aware.toFixed(2), err: m.__beliefs ? +S.beliefErr(m).toFixed(1) : null };
    };
    return { night: +ctx.time.night.toFixed(2), elite90: run(0.9, 90), recruit90: run(0.1, 90), elite40: run(0.9, 40), recruit40: run(0.1, 40), recruit15: run(0.1, 15, 60, 100), elite15: run(0.9, 15, 60, 100) };
  })()`);
  console.log('\n5. MUZZLE FLASH  (suppressed shots at night; the round itself carries only 18 m, so the 90 m and 40 m rows are silent)');
  if (flash.skipped) console.log('   skipped:', flash.skipped);
  else {
    for (const k of ['elite90', 'recruit90', 'elite40', 'recruit40', 'elite15', 'recruit15']) {
      const f = flash[k];
      console.log(`   flash ${f.skill.toFixed(2)} at ${String(f.d).padStart(2)} m   seen ${String(f.seen).padStart(2)}/${String(f.shots).padEnd(2)}   heard ${f.heard}/${f.shots}   beliefs ${f.beliefs}   aware ${f.aware}   belief ${f.err === null ? 'never filed' : f.err + ' m from truth'}`);
    }
    ok('nothing was audible', flash.elite90.heard === 0 && flash.recruit90.heard === 0, {});
    ok('an elite sees the flash at 90 m', flash.elite90.seen >= 6, flash.elite90.seen);
    ok('a recruit does not', flash.recruit90.seen === 0, flash.recruit90.seen);
    ok('an elite sees more at every range', flash.elite40.seen > flash.recruit40.seen && flash.elite15.seen > flash.recruit15.seen, { e40: flash.elite40.seen, r40: flash.recruit40.seen, e15: flash.elite15.seen, r15: flash.recruit15.seen });
    ok('a recruit catches some, close in', flash.recruit15.seen > 0, flash.recruit15.seen);
  }

  console.log('\ncounters', JSON.stringify(await api.run('window.__senses.stats()')));
  console.log(fails ? `\n${fails} ASSERTION(S) FAILED` : '\nall assertions passed');
}
