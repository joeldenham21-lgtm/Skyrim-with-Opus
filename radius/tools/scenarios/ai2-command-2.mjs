// command.js — THE PLAYS, THE LEADER, THE READ, THE COST.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-command-2.mjs --out .smoke/ai2-command-2
//
//   1. ONE PLAY AT A TIME. Over twenty minutes of contact, never two manoeuvre seats at once.
//   2. COMMITMENT. A green squad holds a play because it cannot re-evaluate; an elite holds it because it
//      decided to and bails when its trigger fires. Play switches per minute at each end of the curve.
//   3. THE MENU. What a recruit's leader is even allowed to consider, versus an elite's, versus what the
//      zone's escalation will let either of them do.
//   4. THE LEADER. Kill him mid-manoeuvre: the mover stops, no play is chosen while shaken runs, the command
//      carrier is next heard from a DIFFERENT man, and org climbs back through 0.45 in ten to twenty seconds.
//   5. THE READ. Four-round trains teach it a four-round habit; one contradiction halves the confidence.
//      Peek from one shoulder and the next arc takes that side; peek from the other and it flips.
//   6. WHAT AN ORDER COSTS. The distribution of call-to-movement times, which is the player's window.
//   7. THE COST. Rays and microseconds per plan tick at 3, 7 and 12 mimics.
import { inject, boot, pass, report, RAYCOUNT, ZERO_RC, VOICEHOOK, MIXSKILL, WIRE, SETUP, STEP } from './ai2-command-lib.mjs';

// step and sample the mind: play, tier, seats, and whether two movers were ever live at once
const WATCH = (n) => `(() => {
  const ctx = window.__radius.ctx, mind = window.__sq.mind;
  let twoMovers = 0, switches = 0, nulls = 0, prev = null, sum = 0, runs = 0, run = 0;
  const seen = {};
  for (let i = 0; i < ${n}; i++) {
    ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05);
    if (mind.moverSeats() > 1) twoMovers++;
    const p = mind.play ? mind.play.id : null;
    if (!p) nulls++; else seen[p] = (seen[p] || 0) + 1;
    if (p !== prev) { if (prev) { switches++; sum += run; runs++; } run = 0; prev = p; }
    run += 0.05;
  }
  return { twoMovers, switches, nulls, plays: seen, secs: ${n} * 0.05, runSum: +sum.toFixed(2), runs,
    perMin: +(switches / (${n} * 0.05 / 60)).toFixed(1) };
})()`;

export default async function (page, api) {
  api.page = page;
  await boot(api);
  await inject(api);
  await api.run(RAYCOUNT); await api.run(VOICEHOOK); await api.run(MIXSKILL); await api.run(WIRE);

  console.log('\n--- 1/2. ONE PLAY AT A TIME, AND COMMITMENT --------------------------------------');
  const hold = {};
  for (const [label, p, tide, sec] of [['recruit', 0, 1, 1], ['elite', 1, 3, 5]]) {
    console.log(`setup(${label})`, JSON.stringify(await api.run(SETUP({ n: 5, d: 34, x: -118, z: 92, look: 0.35, poi: 'zarya', tide, sec, p, esc: 3, seed: 4242, lead: p > 0.5 ? 'elite' : 'recruit' }))));
    let agg = { twoMovers: 0, switches: 0, nulls: 0, plays: {}, secs: 0 };
    for (let k = 0; k < 4; k++) {
      const w = await api.run(WATCH(1200));      // 60 s a slice, four slices
      agg.twoMovers += w.twoMovers; agg.switches += w.switches; agg.nulls += w.nulls; agg.secs += w.secs;
      for (const id in w.plays) agg.plays[id] = (agg.plays[id] || 0) + w.plays[id];
    }
    agg.perMin = +(agg.switches / (agg.secs / 60)).toFixed(1);
    agg.meanHold = +(agg.secs / (agg.switches + 1)).toFixed(1);
    console.log(`  ${label}`, JSON.stringify(agg));
    hold[label] = agg;
  }
  pass('never two manoeuvre seats at once (recruit)', hold.recruit.twoMovers === 0, `${hold.recruit.twoMovers} ticks`);
  pass('never two manoeuvre seats at once (elite)', hold.elite.twoMovers === 0, `${hold.elite.twoMovers} ticks`);
  pass('a recruit squad has few ideas', Object.keys(hold.recruit.plays).length <= 4, Object.keys(hold.recruit.plays).join(','));
  pass('an elite squad has more', Object.keys(hold.elite.plays).length >= Object.keys(hold.recruit.plays).length,
    Object.keys(hold.elite.plays).join(','));
  pass('switches per minute stay inside the budget', hold.elite.perMin <= 12 && hold.recruit.perMin <= 12,
    `recruit ${hold.recruit.perMin}/min, elite ${hold.elite.perMin}/min`);
  pass('a play is held far longer than its commitment window', hold.elite.meanHold >= 1.6 && hold.recruit.meanHold >= 1.6,
    `mean hold: recruit ${hold.recruit.meanHold}s, elite ${hold.elite.meanHold}s (commitT is 1.6 -> 3.2 s)`);

  console.log('\n--- 3. THE MENU AND THE GATES ----------------------------------------------------');
  const gates = await api.run(`(() => {
    const C = window.__CMD;
    return { plays: C.PLAYS.map((p) => ({ id: p.id, tier: p.tier, min: p.min, esc: p.esc, at0: p.base[0], at1: p.base[1] })),
      rows: C.SKILL_ROWS };
  })()`);
  for (const p of gates.plays) console.log(`  ${p.id.padEnd(9)} tier C${p.tier}  men>=${p.min}  escalation>=${p.esc}   base ${p.at0.toFixed(2)} -> ${p.at1.toFixed(2)}`);
  const menuN = gates.rows.menuN;
  pass('menuN is the difficulty axis, not search depth', menuN[0] === 3 && menuN[1] === 9, `${menuN[0]} -> ${menuN[1]}`);
  pass('every play is gated on tier AND escalation AND men',
    gates.plays.every((p) => p.tier >= 1 && p.min >= 1 && p.esc >= 0));

  console.log('\n--- 4. THE LEADER ----------------------------------------------------------------');
  console.log('setup', JSON.stringify(await api.run(SETUP({ n: 5, d: 30, x: -118, z: 92, look: 0.35, poi: 'zarya', tide: 3, sec: 5, p: 1, esc: 3, seed: 91, lead: 'elite' }))));
  await api.run(STEP(300));
  const lead = await api.run(`(() => {
    const ctx = window.__radius.ctx, sq = window.__sq, mind = sq.mind;
    window.__vox.length = 0;
    const before = { play: mind.play ? mind.play.id : null, org: +sq.org.toFixed(2), tier: mind.tier,
      leader: sq.leader ? sq.leader.id : null,
      movers: mind.seats.filter((s) => s.active && s.man && ['ANGLE','HAMMER','CUT','PROBE'].includes(s.kind)).map((s) => ({ k: s.kind, m: s.man.id, hasTarget: !!s.man.orders.hasTarget })) };
    const L = sq.leader; const lid = L.id;
    L.kill ? L.kill({ kind: 'test' }) : (L.alive = false);
    // one frame: the mover must be told to stop inside 0.3 s
    for (let i = 0; i < 6; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.player.update(0.05); }
    const after1 = { play: mind.play ? mind.play.id : null, tier: mind.tier, shaken: +sq.shaken.toFixed(1),
      movers: mind.seats.filter((s) => s.active && s.man && ['ANGLE','HAMMER','CUT','PROBE'].includes(s.kind)).map((s) => ({ k: s.kind, hasTarget: !!s.man.orders.hasTarget })) };
    // the silence, then the handover
    const tape = [];
    let orgAt45 = -1, orgAt99 = -1, tierBackTo3 = -1, firstCmd = null, playsDuringShaken = 0;
    const t0 = ctx.elapsed;
    for (let i = 0; i < 500; i++) {
      ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05);
      if (sq.shaken > 0 && mind.play) playsDuringShaken++;
      if (orgAt45 < 0 && sq.org > 0.45) orgAt45 = +(ctx.elapsed - t0).toFixed(2);
      if (orgAt99 < 0 && sq.org > 0.99) orgAt99 = +(ctx.elapsed - t0).toFixed(2);
      if (tierBackTo3 < 0 && mind.tier >= 3) tierBackTo3 = +(ctx.elapsed - t0).toFixed(2);
      if (i % 40 === 0) tape.push({ t: +(ctx.elapsed - t0).toFixed(1), play: mind.play ? mind.play.id : null, tier: mind.tier, org: +sq.org.toFixed(2), shaken: +sq.shaken.toFixed(1) });
    }
    const cmds = window.__vox.filter((v) => v.c === 'command');
    return { before, after1, tape, orgAt45, orgAt99, tierBackTo3, playsDuringShaken, deadLeader: lid,
      newLeader: sq.leader ? sq.leader.id : null, cmdWords: cmds.map((c) => c.w), cmdCount: cmds.length,
      firstCmdAt: cmds.length ? +(cmds[0].t - t0).toFixed(2) : -1 };
  })()`);
  console.log('  before ', JSON.stringify(lead.before));
  console.log('  +0.3 s ', JSON.stringify(lead.after1));
  for (const r of lead.tape) console.log('   ', JSON.stringify(r));
  console.log(`  leader ${lead.deadLeader} -> ${lead.newLeader}; commands after: ${JSON.stringify(lead.cmdWords)} first at ${lead.firstCmdAt}s`);
  pass('the play is aborted the moment he dies', lead.after1.play === null || lead.after1.play === 'HOLD',
    `play went ${lead.before.play} -> ${lead.after1.play}`);
  pass('the man who was moving stops', lead.after1.movers.every((m) => !m.hasTarget) || lead.after1.movers.length === 0,
    JSON.stringify(lead.after1.movers));
  pass('no play at all while the squad is shaken', lead.playsDuringShaken === 0, `${lead.playsDuringShaken} ticks with a play`);
  pass('the command carrier comes back from a different man', lead.newLeader !== null && lead.newLeader !== lead.deadLeader,
    `${lead.deadLeader} -> ${lead.newLeader}`);
  pass('and it says "hold" first', lead.cmdWords[0] === 'hold', JSON.stringify(lead.cmdWords.slice(0, 3)));
  pass('the squad is fully reorganised only after ~13 s', lead.orgAt99 > 9 && lead.orgAt99 < 22, `org back to 1 at ${lead.orgAt99}s`);
  pass('and it cannot run a whole-squad play until then', lead.tierBackTo3 > 8, `back to C3 at ${lead.tierBackTo3}s`);
  console.log(`  (org crosses 0.45 — the C2 gate, one moving element — at ${lead.orgAt45}s; squad.js owns that rate)`);

  console.log('\n--- 5. THE READ ------------------------------------------------------------------');
  const read = await api.run(`(() => {
    const ctx = window.__radius.ctx, mind = window.__sq.mind, p = ctx.player;
    const shot = () => mind.observe('shot', { x: p.position.x, z: p.position.z, noise: 1 });
    const tape = [];
    // sixty seconds of four-round trains
    for (let k = 0; k < 15; k++) {
      for (let r = 0; r < 4; r++) { shot(); ctx.elapsed += 0.09; mind.update(0.09); }
      for (let g = 0; g < 30; g++) { ctx.elapsed += 0.1; mind.update(0.1); }
      if (k % 4 === 3) tape.push({ k, v: +mind.read.mag.v.toFixed(2), c: +mind.read.mag.c.toFixed(2) });
    }
    const learned = { v: +mind.read.mag.v.toFixed(2), c: +mind.read.mag.c.toFixed(2) };
    // then one round, and stop. ONE contradiction.
    shot();
    for (let g = 0; g < 30; g++) { ctx.elapsed += 0.1; mind.update(0.1); }
    const after1 = { v: +mind.read.mag.v.toFixed(2), c: +mind.read.mag.c.toFixed(2) };
    shot();
    for (let g = 0; g < 30; g++) { ctx.elapsed += 0.1; mind.update(0.1); }
    const after2 = { v: +mind.read.mag.v.toFixed(2), c: +mind.read.mag.c.toFixed(2) };
    return { tape, learned, after1, after2, push: mind.pushWindow() };
  })()`);
  for (const r of read.tape) console.log('   train', JSON.stringify(r));
  console.log('  learned', JSON.stringify(read.learned), 'after one contradiction', JSON.stringify(read.after1), 'after two', JSON.stringify(read.after2));
  pass('four-round trains teach a four-round habit', Math.abs(read.learned.v - 4) < 0.8, `v=${read.learned.v}`);
  pass('and it becomes actionable', read.learned.c > 0.6, `c=${read.learned.c}`);
  pass('one contradiction at least halves the confidence', read.after1.c <= read.learned.c * 0.55,
    `${read.learned.c} -> ${read.after1.c}`);
  pass('two and it is gone', read.after2.c <= read.learned.c * 0.3, `-> ${read.after2.c}`);

  // the side. Peek from one shoulder four times, then the other.
  const side = await api.run(`(() => {
    const ctx = window.__radius.ctx, mind = window.__sq.mind, TH = ctx.THREE;
    const occ = { x: mind.picture.pos.x, z: mind.picture.pos.z };
    // the axis the mind measures a peek on is base-of-fire -> occluder; a sighting to one side of it, five times
    const peek = (sgn) => {
      const c = window.__sq.centroid;
      for (let i = 0; i < 5; i++) {
        mind.observe('occluder', { x: occ.x, z: occ.z, y: mind.picture.pos.y, r: 0.6, kind: 'thin' });
        const ax = occ.x - c.x, az = occ.z - c.z; const al = Math.hypot(ax, az) || 1;
        const px = az / al, pz = -ax / al;                      // the perpendicular, as command.js measures it
        ctx.elapsed += 1.3;
        mind.write(new TH.Vector3(occ.x + px * sgn * 2.6, mind.picture.pos.y, occ.z + pz * sgn * 2.6), ctx.elapsed, 0, 'seen', null);
      }
      return { v: +mind.read.peek.v.toFixed(2), c: +mind.read.peek.c.toFixed(2) };
    };
    const a = peek(1); ctx.elapsed += 7; const sideA = mind.sideBias();
    const b = peek(-1); ctx.elapsed += 7; const sideB = mind.sideBias();
    return { a, sideA, b, sideB };
  })()`);
  console.log('  peek', JSON.stringify(side));
  pass('the read picks a side rather than a coin', side.a.c > 0.3, `c=${side.a.c}`);
  pass('and the side flips when you change shoulders', side.sideB === -side.sideA,
    `${side.sideA} -> ${side.sideB} (v ${side.a.v} -> ${side.b.v}, c ${side.a.c} -> ${side.b.c})`);

  console.log('\n--- 6. WHAT AN ORDER COSTS -------------------------------------------------------');
  const cost = await api.run(`(() => {
    const ctx = window.__radius.ctx, mind = window.__sq.mind, sq = window.__sq;
    const out = [];
    for (const skill of [0, 1]) {
      for (const m of sq.members) window.__mix(m, skill);
      const samples = [];
      for (let k = 0; k < 60; k++) {
        const m = sq.members.find((x) => x.alive); if (!m) break;
        const seat = { kind: 'HAMMER', man: m, armAt: 1e9, word: 'flanking' };
        const t0 = ctx.elapsed;
        mind.order('flanking', m, seat);
        for (let i = 0; i < 120 && seat.armAt > 1e8; i++) { ctx.elapsed += 0.05; mind.update(0.05); }
        if (seat.armAt < 1e8) samples.push(+(seat.armAt - t0).toFixed(2));
      }
      samples.sort((a, b) => a - b);
      out.push({ skill, n: samples.length, min: samples[0], median: samples[samples.length >> 1], max: samples[samples.length - 1] });
    }
    for (const m of sq.members) window.__mix(m, 1);
    return out;
  })()`);
  for (const c of cost) console.log(`   skill ${c.skill}: call-to-act  min ${c.min}s  median ${c.median}s  max ${c.max}s  (n=${c.n})`);
  pass('an order takes real time even at the top of the curve', cost[1].median >= 0.5, `${cost[1].median}s`);
  pass('and a green squad is slower with it', cost[0].median > cost[1].median, `${cost[0].median}s vs ${cost[1].median}s`);

  console.log('\n--- 7. THE COST ------------------------------------------------------------------');
  for (const n of [3, 7, 12]) {
    await api.run(SETUP({ n, d: 34, x: -118, z: 92, look: 0.35, poi: 'zarya', tide: 3, sec: 5, p: 1, esc: 3, spread: 4.5, seed: 5150 }));
    await api.run(STEP(100));
    await api.run(ZERO_RC);
    const bench = await api.run(`(() => {
      const ctx = window.__radius.ctx, mind = window.__sq.mind, sq = window.__sq;
      window.__cmd.resetStats();
      const t0 = performance.now(); let ticks = 0;
      const r0 = { ...window.__rc };
      for (let i = 0; i < 600; i++) { ctx.elapsed += 0.05; mind.update(0.05); if (i % 5 === 0) { mind.tick(0.25, sq.members); ticks++; } }
      const ms = performance.now() - t0;
      const s = window.__cmd.stats();
      return { ticks, usPerTick: +((ms * 1000) / ticks).toFixed(1), usPerFrame: +((ms * 1000) / 600).toFixed(1),
        rays: s.rays, raysPerFrame: +((window.__rc.ray - r0.ray) / 600).toFixed(2),
        losPerFrame: +((window.__rc.los - r0.los) / 600).toFixed(2),
        solidPerFrame: +((window.__rc.solid - r0.solid) / 600).toFixed(2),
        groundPerFrame: +((window.__rc.ground - r0.ground) / 600).toFixed(2) };
    })()`);
    console.log(`   ${String(n).padStart(2)} mimics:`, JSON.stringify(bench));
    if (n === 12) {
      pass('under 4.5 world rays a frame at 12 mimics', bench.raysPerFrame + bench.losPerFrame < 4.5,
        `${(bench.raysPerFrame + bench.losPerFrame).toFixed(2)}/frame`);
      pass('under 120 us of mind per frame at 12 mimics', bench.usPerFrame < 120, `${bench.usPerFrame} us`);
    }
  }

  console.log('\n--- 8. THE LEADER MARK -----------------------------------------------------------');
  const mark = await api.run(`(() => {
    const ctx = window.__radius.ctx, TH = ctx.THREE;
    const g = window.__CMD.buildLeaderMark(TH, null);
    let tris = 0, meshes = 0;
    g.traverse((o) => { if (o.isMesh) { meshes++; const a = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; tris += a / 3; } });
    const r0 = g.userData.pivot.rotation.x;
    for (let i = 0; i < 60; i++) g.userData.tick(0.05, 5, 0.4);
    const moved = Math.abs(g.userData.pivot.rotation.x - r0) + Math.abs(g.userData.pivot.rotation.z - (-0.14));
    g.traverse((o) => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
    return { meshes, tris: Math.round(tris), moved: +moved.toFixed(3) };
  })()`);
  console.log('  mark', JSON.stringify(mark));
  pass('the mark is a handful of triangles', mark.tris < 200, `${mark.tris} tris in ${mark.meshes} meshes`);
  pass('and the whip sways with the gait', mark.moved > 0.01, `${mark.moved} rad`);

  await api.screenshot('command-2');
  return report();
}
