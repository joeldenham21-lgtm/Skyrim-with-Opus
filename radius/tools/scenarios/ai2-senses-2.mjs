// senses.js — fairness, decay, the torch, bodies, and what it costs.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-senses-2.mjs --out .smoke/ai2-senses-2
//
// 6. FAIRNESS       unseen and unheard for 600 steps: nothing is filed, and the guess never lands on you
// 7. DECAY          a firm contact goes stale at spreadRate m/s — and a squad that has read you keeps it tight
// 8. THE TORCH      at night the beam is both your eyes and a beacon, and swinging it across a face is contact
// 9. BODIES         a dead mate is evidence with a 9 m error, filed once, and it reaches the Director
// 10. COST          rays, ticks and microseconds at 1, 3, 7 and 12 mimics
// 11. THE SEAM      what the source is allowed to touch (a grep gate over the module itself)
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot } from './ai2-senses-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fails = 0;
const ok = (name, cond, detail) => { if (!cond) { fails++; console.log('FAIL    ', name, detail === undefined ? '' : JSON.stringify(detail)); } else console.log('pass    ', name, detail === undefined ? '' : JSON.stringify(detail)); };

export default async function (page, api) {
  await boot(page, api);

  const site = await api.run(`(() => {
    const r = window.__radius, ctx = r.ctx, S = window.__S;
    r.god(true); r.setTime(12);
    for (const id of ['field_a', 'marsh', 'field_b', 'north', 'checkpoint']) {
      const P = ctx.world.poi(id); if (!P) continue;
      for (let k = 0; k < 6; k++) {
        const x = P.x + (k % 3 - 1) * P.r * 0.35, z = P.z + (Math.floor(k / 3) - 0.5) * P.r * 0.35;
        if (ctx.world.isWater(x, z)) continue;
        S.player({ x, z, crouch: false, move: true, noise: 0, torch: false });
        const b = S.openBearing([8, 25, 60]);
        if (b != null) return { poi: id, x: +x.toFixed(1), z: +z.toFixed(1), bearing: +b.toFixed(3) };
      }
    }
    return null;
  })()`);
  console.log('site     ', JSON.stringify(site));
  if (!site) { console.log('FAIL      no open line found'); return; }

  // ---- 6. fairness --------------------------------------------------------------------------------
  const fair = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, B = ${site.bearing};
    S.clear();
    window.__radius.setTime(12);
    S.player({ x: ${site.x}, z: ${site.z}, crouch: true, move: false, sprint: false, noise: 0, torch: false });
    const list = [];
    for (let i = 0; i < 4; i++) { const m = S.mimic(${site.x} + 40, ${site.z} + 40, { seed: 0.11 + i * 0.19 }); m.skill.p = 1; list.push(m); }
    // four elite mimics, all facing away, at 60 m, with a silent crouching player
    for (const m of list) S.place(m, B + (list.indexOf(m) - 1.5) * 0.25, 60, 178);
    let minErr = Infinity, beliefs = 0, awareMax = 0, monotone = true;
    const prev = list.map(() => 0);
    const trace = [];
    for (let i = 0; i < 600; i++) {
      ctx.frame++; ctx.elapsed += 0.05; ctx.state.data.hour = 12;
      for (let k = 0; k < list.length; k++) {
        const m = list[k];
        S.step(m, 0.05);
        beliefs += 0;
        if (m.beliefR + 1e-6 < prev[k]) monotone = false;
        prev[k] = m.beliefR;
        awareMax = Math.max(awareMax, m.aware);
        minErr = Math.min(minErr, S.beliefErr(m));
      }
      if (i % 150 === 0) trace.push({ t: +(i * 0.05).toFixed(1), r: +list[0].beliefR.toFixed(2), err: +Math.min(999, S.beliefErr(list[0])).toFixed(1) });
    }
    return { calls: list.reduce((a, m) => a + m.__beliefs, 0), minErr: +Math.min(9999, minErr).toFixed(1), awareMax: +awareMax.toFixed(3), monotone, trace };
  })()`);
  console.log('\n6. FAIRNESS  (4 elite mimics at 60 m facing away; player crouched, still, silent, 30 s)');
  console.log('   believe() calls', fair.calls, ' nearest guess to the truth', fair.minErr, 'm  peak awareness', fair.awareMax);
  ok('nothing was filed at all', fair.calls === 0, fair.calls);
  ok('the guess never lands on you', fair.minErr > 3, fair.minErr);
  ok('nobody woke up', fair.awareMax < 0.4, fair.awareMax);
  ok('the belief radius never shrinks', fair.monotone, fair.monotone);

  // ---- 7. decay -----------------------------------------------------------------------------------
  const decay = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, SS = window.__senses, B = ${site.bearing};
    const run = (readC) => {
      S.clear();
      S.player({ x: ${site.x}, z: ${site.z}, crouch: false, move: true, noise: 0, torch: false });
      const m = S.mimic(${site.x} + 40, ${site.z} + 40, { seed: 0.4 });
      m.skill.p = 1;
      if (readC != null) m.squad = { mind: { read: { peek: { c: readC }, hold: { c: readC } } } };
      S.place(m, B, 25, 0);                       // a clean sighting first
      S.look(m);
      const sawAt = ctx.elapsed, r0 = m.beliefR;
      S.place(m, B, 25, 178);                     // and now it is looking the other way
      const trace = [];
      for (let i = 0; i < 400; i++) {
        ctx.frame++; ctx.elapsed += 0.05; ctx.state.data.hour = 12;
        S.step(m, 0.05);
        if (i % 100 === 99) trace.push({ t: +((i + 1) * 0.05).toFixed(1), r: +m.beliefR.toFixed(2) });
      }
      return { read: readC == null ? 'none' : readC, conf: +SS.readConfidence(m).toFixed(2), rate: +SS.spreadRate(m).toFixed(3), r0, trace, end: +m.beliefR.toFixed(2) };
    };
    return { cold: run(null), warm: run(1.0), half: run(0.5) };
  })()`);
  console.log('\n7. DECAY  (a sighting, then nobody has a line: how fast the guess widens)');
  for (const k of ['cold', 'half', 'warm']) {
    const d = decay[k];
    console.log(`   read ${String(d.read).padEnd(4)} conf ${d.conf}  spread ${d.rate} m/s   r after 5/10/15/20 s: ${d.trace.map((t) => t.r).join(' ')}`);
  }
  ok('a sighting is radius 0', decay.cold.r0 === 0, decay.cold.r0);
  ok('no read widens at 1.15 m/s', Math.abs(decay.cold.rate - 1.15) < 0.01, decay.cold.rate);
  ok('a full read holds it at 0.45', Math.abs(decay.warm.rate - 0.45) < 0.01, decay.warm.rate);
  ok('and the picture stays tighter', decay.warm.end < decay.cold.end * 0.55, { warm: decay.warm.end, cold: decay.cold.end });

  // ---- 8. the torch -------------------------------------------------------------------------------
  const torch = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, SS = window.__senses, B = ${site.bearing};
    S.clear();
    const m = S.mimic(${site.x} + 40, ${site.z} + 40, { seed: 0.4 });
    m.skill.p = 0.5;
    const at = (hour, torchOn, lookAtIt, d) => {
      ctx.state.data.hour = hour;
      S.player({ x: ${site.x}, z: ${site.z}, crouch: false, move: true, noise: 0, torch: torchOn });
      S.place(m, B, d, 0);
      // the player's yaw: yaw 0 faces -z, so face along the bearing (or 180 off it)
      const ang = Math.atan2(-Math.cos(B), -Math.sin(B));
      window.__radius.setLook(lookAtIt ? ang : ang + Math.PI, -0.02);
      ctx.player.update(0);
      SS.playerModel(ctx).t = -1e9;
      m.lastVisT = -1e9; m.beliefR = 0; m.litT = -1e9;
      const s = S.look(m);
      return { hour, torch: torchOn, beam: lookAtIt, d, night: +ctx.time.night.toFixed(2), maxD: +s.maxD.toFixed(0), vis: +s.vis.toFixed(3), lit: +s.lit.toFixed(3), conceal: +SS.playerModel(ctx).conceal.toFixed(2) };
    };
    return [at(12, false, false, 60), at(1, false, false, 60), at(1, true, true, 60), at(1, true, false, 60), at(1, false, true, 18), at(1, true, true, 18)];
  })()`);
  console.log('\n8. THE TORCH  (what the world reaches to, and what the beam gives away)');
  for (const t of torch) console.log(`   ${String(t.hour).padStart(2)}:00 night ${t.night}  torch ${t.torch ? 'on ' : 'off'}  beam ${t.beam ? 'on you' : 'away  '}  d ${String(t.d).padStart(2)} m  maxD ${String(t.maxD).padStart(3)} m  conceal ${t.conceal}  vis ${t.vis.toFixed(3)}  beamBonus ${t.lit.toFixed(2)}`);
  ok('night shrinks the world to 22 m', torch[1].maxD === 22 && torch[1].vis === 0, { maxD: torch[1].maxD, vis: torch[1].vis });
  ok('a torch reaches 60 m again', torch[2].maxD >= 70 && torch[2].vis > 0, { maxD: torch[2].maxD, vis: torch[2].vis });
  ok('the beam on a face is a contact', torch[2].lit > 0 && torch[2].vis > torch[3].vis, { on: torch[2].vis, away: torch[3].vis });
  ok('a torch strips your concealment', torch[5].conceal < torch[4].conceal, { torch: torch[5].conceal, dark: torch[4].conceal });

  // ---- 9. bodies ----------------------------------------------------------------------------------
  const bodies = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, SS = window.__senses, B = ${site.bearing};
    S.clear();
    window.__radius.setTime(12);
    S.player({ x: ${site.x}, z: ${site.z}, crouch: false, move: false, noise: 0, torch: false });
    const bx = ${site.x} + Math.cos(B) * 30, bz = ${site.z} + Math.sin(B) * 30;
    const victim = S.mimic(bx, bz);
    const m0 = ctx.director.memoryAt(bx, bz);
    victim.kill({});                                     // -> enemyKilled -> senses.noteBody
    const seek = (skill) => {
      const m = S.mimic(bx + 4, bz + 2, { seed: 0.77 });
      m.skill.p = 1; m.skill.noteBody = skill;
      m.aware = 0; m.beliefR = 0; m.lastSeenT = -1e9; m.lastVisT = -1e9; m.__beliefs = 0;
      m.sense.bodyT = 0;
      let found = 0;
      for (let i = 0; i < 120; i++) { ctx.frame++; ctx.elapsed += 0.05; if (SS.corpseCheck(m)) found++; }
      return { skill, found, beliefs: m.__beliefs, r: +m.beliefR.toFixed(1), aware: +m.aware.toFixed(2), errFromBody: +Math.hypot(m.lastSeenPlayer.x - bx, m.lastSeenPlayer.z - bz).toFixed(1) };
    };
    const elite = seek(0.9), recruit = seek(0.1);
    return { elite, recruit, memBefore: +m0.toFixed(3), memAfter: +ctx.director.memoryAt(bx, bz).toFixed(3) };
  })()`);
  console.log('\n9. BODIES  (a dead mate 4.5 m away, 120 checks)');
  console.log(`   noteBody 0.90  registered ${bodies.elite.found} time(s)  beliefR ${bodies.elite.r} m  guess ${bodies.elite.errFromBody} m from the body  aware ${bodies.elite.aware}`);
  console.log(`   noteBody 0.10  registered ${bodies.recruit.found} time(s)`);
  console.log(`   director blood memory at that cell ${bodies.memBefore} -> ${bodies.memAfter}`);
  ok('a body is filed exactly once', bodies.elite.found === 1, bodies.elite.found);
  ok('it is a 9 m guess, not a contact', bodies.elite.r >= 8.9 && bodies.elite.r <= 9.1, bodies.elite.r);
  ok('a recruit does not register it', bodies.recruit.found === 0, bodies.recruit.found);
  ok('the Director learns the place', bodies.memAfter > bodies.memBefore, { before: bodies.memBefore, after: bodies.memAfter });

  // ---- 10. cost -----------------------------------------------------------------------------------
  const cost = await api.run(`(() => {
    const ctx = window.__radius.ctx, S = window.__S, SS = window.__senses, B = ${site.bearing};
    const run = (n) => {
      S.clear();
      window.__radius.setTime(12);
      S.player({ x: ${site.x}, z: ${site.z}, crouch: false, move: true, noise: 0.7, torch: false });
      const list = [];
      for (let i = 0; i < n; i++) {
        const m = S.mimic(${site.x} + 40, ${site.z} + 40, { seed: 0.05 + i * 0.07 });
        m.skill.p = 1; m.engaged = true; m.aware = 1;
        S.place(m, B + (i - n / 2) * 0.16, 26 + (i % 3) * 4, 0);
        list.push(m);
      }
      const c0 = Object.assign({}, SS.stats());
      const t0 = performance.now();
      const FR = 400;
      for (let i = 0; i < FR; i++) {
        ctx.frame++; ctx.elapsed += 0.05; ctx.state.data.hour = 12;
        for (const m of list) S.step(m, 0.05);
      }
      const ms = performance.now() - t0;
      const c1 = SS.stats();
      return { n, frames: FR, raysPerFrame: +((c1.rays - c0.rays) / FR).toFixed(2), budgetedPerFrame: +((c1.budgeted - c0.budgeted) / FR).toFixed(3), fullPerFrame: +((c1.full - c0.full) / FR).toFixed(2),
        floraQPerFrame: +((c1.floraQ - c0.floraQ) / FR).toFixed(3), refreshPerFrame: +((c1.playerRefresh - c0.playerRefresh) / FR).toFixed(3),
        usPerFrame: +(ms * 1000 / FR).toFixed(1), usPerMimicTick: +(ms * 1000 / Math.max(1, c1.full - c0.full)).toFixed(1) };
    };
    return [run(1), run(3), run(7), run(12)];
  })()`);
  console.log('\n10. COST  (20 Hz, every mimic engaged and looking at the player, 400 frames)');
  for (const c of cost) console.log(`   ${String(c.n).padStart(2)} mimics   ${String(c.raysPerFrame).padStart(5)} own rays/frame   ${String(c.budgetedPerFrame).padStart(5)} from the shared pool   ${String(c.fullPerFrame).padStart(5)} sense ticks/frame   ${String(c.floraQPerFrame).padStart(5)} flora queries/frame   ${String(c.usPerFrame).padStart(6)} us/frame   ${c.usPerMimicTick} us/tick`);
  const big = cost[cost.length - 1];
  ok('own rays match the old 1-2 per perception tick', big.raysPerFrame <= big.fullPerFrame * 2 + 0.01, { rays: big.raysPerFrame, ticks: big.fullPerFrame });
  ok('takes nothing from the tactical pool while fighting', big.budgetedPerFrame <= 0.05, big.budgetedPerFrame);
  ok('the player model is shared, not per mimic', big.refreshPerFrame <= 0.35, big.refreshPerFrame);
  ok('flora is queried at most ~7 Hz whatever the count', big.floraQPerFrame <= 0.35, big.floraQPerFrame);
  ok('under 120 us/frame at 12 mimics', big.usPerFrame < 120, big.usPerFrame);

  // ---- 11. the seam -------------------------------------------------------------------------------
  const src = readFileSync(resolve(root, 'src/enemies/senses.js'), 'utf8');
  const reads = [...src.matchAll(/(?:ctx\.player|P\.player|\bp)\.([A-Za-z_]+)/g)].map((m) => m[1]);
  const banned = ['hp', 'stamina', 'velocity', 'inventory', 'yaw', 'pitch', 'rig', 'head', 'bleeding', 'speed', 'blown', 'load'];
  const hits = banned.filter((b) => new RegExp(`(?:ctx\\.)?player\\.${b}\\b`).test(src));
  const camera = /ctx\.camera/.test(src);
  console.log('\n11. THE SEAM');
  console.log('   player fields read:', [...new Set(reads)].sort().join(', '));
  ok('reads no player state it must not', hits.length === 0 && !camera, { banned: hits, camera });
  ok('one import from enemies/: none', !/from '\.\/(mimic|squad|command|director|population|common|loadout)\.js'/.test(src), {});
  // every `new THREE.x` must be either a module-scope scratch vector or a one-time lazy field init
  const allocLines = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /new THREE\./.test(l));
  const bad = allocLines.filter(([, l]) => !/^const _[a-z0-9]+ = new THREE/.test(l.trim()) && !/lastSeenPlayer = new THREE/.test(l));
  console.log('   THREE allocations:', allocLines.map(([i, l]) => i + ': ' + l.trim().slice(0, 62)).join(' | '));
  ok('no allocation outside module scratch', bad.length === 0, bad.map(([i]) => i));

  console.log('\ncounters', JSON.stringify(await api.run('window.__senses.stats()')));
  console.log(fails ? `\n${fails} ASSERTION(S) FAILED` : '\nall assertions passed');
}
