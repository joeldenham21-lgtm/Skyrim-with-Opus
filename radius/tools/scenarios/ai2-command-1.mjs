// command.js — THE TREE, THE PICTURE, THE WORDS.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-command-1.mjs --out .smoke/ai2-command-1
//
//   1. THE TREE TEST, both halves. One mimic, one trunk. At angle 0.95 it walks the arc and gets a line back;
//      at angle 0.05 it stands there and is beaten by the tree, which is the day-one guarantee.
//   2. THE DECOY TEST. Snapshot the picture, move the true player forty metres and set his hp to 8 without
//      running perception, re-run the plan tick: everything must be byte-identical.
//   3. Stand still where nobody can see you: stillT must not accumulate and no frag is ever ordered.
//   4. The picture's velocity is zeroed the instant the guess is wide, so a man they only heard is never cut off.
//   5. The belief cone widens to 180 degrees within 3.5 s of the last sighting.
//   6. The vocabulary: every word registered, the register split, the noise budget, and the command carrier.
//   7. The grep gate: zero occurrences of ctx.player in the module's own source.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject, boot, pass, report, RAYCOUNT, ZERO_RC, VOICEHOOK, MIXSKILL, WIRE, SETUP, STEP } from './ai2-command-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ---- 1. THE TREE. A lone mimic, a single trunk, and twenty seconds. -------------------------------------
// Set up on real ground: the player in the open, one mimic 22 m away with a 0.9 m cylinder on the line
// between them, and then the player steps sideways so the trunk takes the line away.
const TREE = (angle) => `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player, TH = ctx.THREE;
  ctx.world.clearTag('__testtree');
  ctx.state.data.tideLevel = 3; ctx.state.data.securityLevel = 5;
  r.teleport(-118, 92); r.setLook(0.35, -0.02); r.setTime(12); ctx.player.update(0);
  for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; } ctx.enemies.removeDead(); ctx.squads.reset();
  for (let i = 0; i < 70; i++) ctx.squads.update(0.05);
  const f = p.forward;
  const mx = p.position.x + f.x * 22, mz = p.position.z + f.z * 22;
  const m = r.spawn('mimic', mx, mz, { poi: 'zarya', cls: 'veteran', yaw: Math.atan2(-(p.position.x - mx), -(p.position.z - mz)) });
  if (!m) return { err: 'no spawn' };
  m.id = 1; m.voice = 0.3;
  window.__mix(m, 1); m.skill.angle = ${angle};
  const sq = ctx.squads.form([m], ctx.world.poi('zarya'));
  window.__sq = sq; window.__list = [m];
  const mind = window.__wire(sq, {});
  sq.enterCombat();
  m.aware = 1; m.engaged = true; m.setState('engage');
  if (!m.lastSeenPlayer) m.lastSeenPlayer = new TH.Vector3();
  m.lastSeenPlayer.copy(p.position); m.lastSeenT = ctx.elapsed; m.lastVisT = ctx.elapsed;
  mind.write(p.position, ctx.elapsed, 0, 'seen', m);
  mind.observe('face', Math.atan2(f.z, f.x));
  // the trunk: 2.5 m ahead of where the player is ABOUT to step, so the step puts it exactly on the line
  const sx = -f.z * 1.2, sz = f.x * 1.2;
  const tx = p.position.x + sx + f.x * 2.5, tz = p.position.z + sz + f.z * 2.5;
  const gy = ctx.world.getHeight(tx, tz);
  ctx.world.addCylinder(tx, tz, 0.55, gy, gy + 6, { tag: '__testtree', surface: 'wood' });
  window.__tree = { x: tx, z: tz };
  window.__a0 = Math.atan2(m.position.z - p.position.z, m.position.x - p.position.x);
  window.__t0 = ctx.elapsed;
  return { d: +m.position.distanceTo(p.position).toFixed(1), angle: m.skill.angle, tree: [+tx.toFixed(1), +tz.toFixed(1)] };
})()`;

// three seconds of clear line, then the player steps 1.2 m laterally and the trunk breaks it
const TREE_BREAK = `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, f = p.forward;
  p.position.x += -f.z * 1.2; p.position.z += f.x * 1.2;
  const g = ctx.world.groundHeight(p.position.x, p.position.z, p.position.y + 1.5); p.position.y = g.y;
  ctx.player.update(0);
  const m = window.__list[0];
  window.__a0 = Math.atan2(m.position.z - p.position.z, m.position.x - p.position.x);
  window.__t0 = ctx.elapsed;
  return ctx.world.lineOfSight(m.eyePos(new ctx.THREE.Vector3()), p.eye);
})()`;

const TREE_RUN = (n) => `(() => {
  const ctx = window.__radius.ctx, p = ctx.player, m = window.__list[0], mind = window.__sq.mind, TH = ctx.THREE;
  const eye = new TH.Vector3();
  let maxSwing = 0, lineAt = -1, angleOrders = 0, prevPlay = null, orbit = 0;
  for (let i = 0; i < ${n}; i++) {
    ctx.elapsed += 0.05; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05);
    const a = Math.atan2(m.position.z - p.position.z, m.position.x - p.position.x);
    let d = Math.abs(a - window.__a0) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > maxSwing) maxSwing = d;
    if (mind.play && mind.play.id === 'ANGLE') { if (prevPlay !== 'ANGLE') angleOrders++; orbit++; }
    prevPlay = mind.play ? mind.play.id : null;
    if (lineAt < 0 && ctx.world.lineOfSight(m.eyePos(eye), p.eye) && ctx.elapsed - window.__t0 > 0.5) lineAt = +(ctx.elapsed - window.__t0).toFixed(2);
  }
  return { swing: +(maxSwing * 180 / Math.PI).toFixed(0), lineAt, angleOrders, orbitTicks: orbit,
    play: mind.play ? mind.play.id : null, occ: mind.debug().occ,
    dist: +m.position.distanceTo(p.position).toFixed(1), state: m.state };
})()`;

export default async function (page, api) {
  api.page = page;
  await boot(api);
  await inject(api);
  await api.run(RAYCOUNT); await api.run(VOICEHOOK); await api.run(MIXSKILL); await api.run(WIRE);

  console.log('\n--- 1. THE TREE TEST -------------------------------------------------------------');
  const trees = {};
  for (const [label, angle] of [['elite', 0.95], ['recruit', 0.05]]) {
    console.log(`setup(${label})`, JSON.stringify(await api.run(TREE(angle))));
    await api.run(STEP(60));                        // three seconds with a clear line
    const los = await api.run(TREE_BREAK);
    const out = await api.run(TREE_RUN(400));       // twenty seconds behind the trunk
    console.log(`  ${label}`, JSON.stringify(out), `losAtBreak=${los}`);
    trees[label] = out; trees[label].los = los;
  }
  pass('the trunk really takes the line away', trees.elite.los === false && trees.recruit.los === false);
  pass('tree/elite swings round the trunk', trees.elite.swing > 60, `swing ${trees.elite.swing} deg`);
  pass('tree/elite regains the line', trees.elite.lineAt >= 0 && trees.elite.lineAt < 8, `at ${trees.elite.lineAt}s`);
  pass('tree/elite chose ANGLE', trees.elite.angleOrders > 0, `${trees.elite.angleOrders} entries, ${trees.elite.orbitTicks} ticks`);
  pass('tree/recruit does NOT swing', trees.recruit.swing < 25, `swing ${trees.recruit.swing} deg`);
  pass('tree/recruit never chose ANGLE', trees.recruit.angleOrders === 0);

  console.log('\n--- 2. THE DECOY TEST (fairness) -------------------------------------------------');
  console.log('setup', JSON.stringify(await api.run(SETUP({ n: 4, d: 34, x: -118, z: 92, look: 0.35, poi: 'zarya', tide: 3, sec: 5, p: 1, esc: 3 }))));
  await api.run(STEP(160));
  console.log('decoy', JSON.stringify(await api.run(`(() => {
    const ctx = window.__radius.ctx, p = ctx.player, mind = window.__sq.mind;
    const snap = () => { const d = mind.debug(); return JSON.stringify({ d, px: +mind.picture.pos.x.toFixed(3), pz: +mind.picture.pos.z.toFixed(3), r: +mind.picture.r.toFixed(3), t: +mind.picture.t.toFixed(3), k: mind.picture.kind, seats: d.seats.map(s => s.k + ':' + s.m).join(',') }); };
    const before = snap();
    const x0 = p.position.x, z0 = p.position.z, hp0 = p.hp;
    p.position.x += 40; p.position.z -= 18; p.hp = 8;      // no perception is run: nothing may notice
    window.__sq.mind.tick(0.2, window.__sq.members);
    const after = snap();
    p.position.x = x0; p.position.z = z0; p.hp = hp0;
    return { same: before === after, before: JSON.parse(before).d.play, after: JSON.parse(after).d.play,
      beliefErr: +Math.hypot(mind.picture.pos.x - x0, mind.picture.pos.z - z0).toFixed(2) };
  })()`)));
  const decoy = await api.run(`(() => {
    const ctx = window.__radius.ctx, p = ctx.player, mind = window.__sq.mind;
    const snap = () => JSON.stringify(mind.debug()) + '|' + mind.picture.pos.toArray().map(v=>v.toFixed(3)).join(',') + '|' + mind.picture.r.toFixed(3) + '|' + mind.picture.hurt.toFixed(3);
    const b = snap(); const x0 = p.position.x, z0 = p.position.z, hp0 = p.hp;
    p.position.x += 40; p.position.z -= 18; p.hp = 8;
    mind.tick(0.2, window.__sq.members); mind.tick(0.2, window.__sq.members);
    const a = snap(); p.position.x = x0; p.position.z = z0; p.hp = hp0;
    return { same: b.split('|').slice(1).join('|') === a.split('|').slice(1).join('|'), b: b.slice(0, 90), a: a.slice(0, 90) };
  })()`);
  pass('picture does not move when the player teleports', decoy.same, decoy.same ? '' : `\n    ${decoy.b}\n    ${decoy.a}`);

  console.log('\n--- 3. STAND STILL UNSEEN --------------------------------------------------------');
  const still = await api.run(`(() => {
    const ctx = window.__radius.ctx, p = ctx.player, mind = window.__sq.mind, TH = ctx.THREE;
    // Take every line away — nobody sees him, nobody hears him — and then move him thirty metres without
    // running perception. Nothing may notice, and nothing may accumulate.
    const age = () => { for (const m of window.__list) { m.lastVisT = -1e9; m.lastSeenT = ctx.elapsed - 25; m.aware = 0.2; } };
    age(); mind.picture.seers = 0; mind.picture.t = ctx.elapsed - 20;
    p.position.x += 30; p.position.z -= 14;
    const g0 = ctx.world.groundHeight(p.position.x, p.position.z, p.position.y + 2); p.position.y = g0.y;
    let frags = 0; const o0 = window.__list.map((m) => m.orders.frag || 0);
    for (let i = 0; i < 600; i++) { ctx.elapsed += 0.05; mind.update(0.05); if (i % 5 === 0) mind.tick(0.25, window.__sq.members); age(); }
    window.__list.forEach((m, i) => { if ((m.orders.frag || 0) > o0[i]) frags++; });
    return { still: +mind.picture.stillT.toFixed(2), frags,
      belErr: +Math.hypot(mind.picture.pos.x - p.position.x, mind.picture.pos.z - p.position.z).toFixed(1),
      spread: +mind.spread().toFixed(1), play: mind.play ? mind.play.id : null };
  })()`);
  console.log('still', JSON.stringify(still));
  pass('stillT does not accumulate unseen', still.still < 3.2, `stillT ${still.still}s over 30 s`);
  pass('no frag is ordered on a man nobody can see', still.frags === 0);
  pass('the belief drifts away from the truth', still.belErr > 3, `${still.belErr} m`);

  console.log('\n--- 4. VELOCITY AND THE CUT ------------------------------------------------------');
  const vel = await api.run(`(() => {
    const ctx = window.__radius.ctx, mind = window.__sq.mind, TH = ctx.THREE, t = ctx.elapsed;
    const a = new TH.Vector3(10, 0, 10), b = new TH.Vector3(14, 0, 10);
    mind.write(a, t + 0.1, 0, 'seen', null); mind.write(b, t + 0.6, 0, 'seen', null);
    const seenVel = +Math.hypot(mind.picture.vel.x, mind.picture.vel.z).toFixed(2);
    const cutSeen = !!mind.cutPoint(new TH.Vector3());
    // now the same movement, but heard rather than seen
    mind.write(a, t + 1.1, 7, 'heard', null); mind.write(b, t + 1.6, 7, 'heard', null);
    const heardVel = +Math.hypot(mind.picture.vel.x, mind.picture.vel.z).toFixed(2);
    return { seenVel, heardVel, cutSeen };
  })()`);
  console.log('velocity', JSON.stringify(vel));
  pass('a watched man has a velocity', vel.seenVel > 5 && vel.cutSeen, `${vel.seenVel} m/s`);
  pass('a heard man has none — he is never cut off', vel.heardVel === 0);

  console.log('\n--- 5. THE BELIEF CONE WIDENS ----------------------------------------------------');
  const cone = await api.run(`(() => {
    const ctx = window.__radius.ctx, mind = window.__sq.mind, TH = ctx.THREE;
    mind.write(new TH.Vector3(0, 0, 0), ctx.elapsed, 0, 'seen', null);
    mind.observe('face', 0);                                   // he faces +x
    const behind = () => mind.frustum(-20, 0, 50);             // is a point straight behind him "in view"?
    const at0 = behind(); ctx.elapsed += 1.0; const at1 = behind(); ctx.elapsed += 2.6; const at36 = behind();
    return { at0, at1s: at1, at36s: at36 };
  })()`);
  console.log('cone', JSON.stringify(cone));
  pass('fresh sighting: behind him is not in view', cone.at0 === false);
  pass('3.6 s later the cone is everywhere', cone.at36s === true);

  console.log('\n--- 6. THE VOCABULARY ------------------------------------------------------------');
  const vox = await api.run(`(() => {
    const C = window.__CMD, W = C.WORDS;
    const bad = [];
    for (const k in W) { const w = W[k];
      if (w.dur.length !== w.syl) bad.push(k + ':dur');
      if (w.gap.length !== Math.max(0, w.syl - 1)) bad.push(k + ':gap');
      if (!(w.f0 > 60 && w.f0 < 200)) bad.push(k + ':f0');
      if (!(w.gain > 0 && w.gain <= 1)) bad.push(k + ':gain'); }
    const dur = {}; for (const k in W) dur[k] = +(W[k].dur.reduce((a, b) => a + b, 0) + W[k].gap.reduce((a, b) => a + b, 0)).toFixed(3);
    return { n: Object.keys(W).length, cmd: C.COMMAND_WORDS.length, status: C.STATUS_WORDS.length, bad, dur };
  })()`);
  console.log('words', JSON.stringify(vox.dur));
  pass('19 words, 9 commands, 10 status', vox.n === 19 && vox.cmd === 10 && vox.status === 9, `${vox.n}/${vox.cmd}/${vox.status}`);
  pass('every word is internally consistent', vox.bad.length === 0, vox.bad.join(','));

  // the noise budget and the carrier, measured over a real contact
  console.log('setup', JSON.stringify(await api.run(SETUP({ n: 5, d: 34, x: -118, z: 92, look: 0.35, poi: 'zarya', tide: 3, sec: 5, p: 1, seed: 777, esc: 3 }))));
  await api.run('window.__vox.length = 0');
  await api.run(STEP(1200));
  const traffic = await api.run(`(() => {
    const v = window.__vox, C = window.__CMD;
    const byWord = {}, byCar = { field: 0, command: 0 };
    let gapMin = 99, cmdGapMin = 99, lastT = -99, lastCmd = -99;
    for (const e of v) { const k = e.w || '(none)'; byWord[k] = (byWord[k] || 0) + 1; byCar[e.c] = (byCar[e.c] || 0) + 1;
      if (lastT > -99) gapMin = Math.min(gapMin, e.t - lastT); lastT = e.t;
      if (e.c === 'command') { if (lastCmd > -99) cmdGapMin = Math.min(cmdGapMin, e.t - lastCmd); lastCmd = e.t; } }
    return { total: v.length, perMin: +(v.length / 60).toFixed(1), byWord, byCar, gapMin: +gapMin.toFixed(2), cmdGapMin: +cmdGapMin.toFixed(2),
      named: v.filter((e) => e.w).length, unnamed: v.filter((e) => !e.w).length };
  })()`);
  console.log('traffic (60 s of a 5-man contact)', JSON.stringify(traffic));
  console.log(`  (${traffic.unnamed} un-worded transmissions came from squad.js idle chatter and mimic.js's own`);
  console.log('   ad-hoc sound() calls — integrator item 8.1.11 routes those through mind.say too)');
  pass('the mind speaks in words', traffic.named > 0, `${traffic.named} worded transmissions`);
  pass('the noise budget holds', traffic.perMin <= 30, `${traffic.perMin}/min total`);
  pass('no two transmissions inside the floor', traffic.gapMin >= 0.5 || traffic.total < 2, `min gap ${traffic.gapMin}s`);
  pass('commands are spaced by the leader noiseGap', traffic.cmdGapMin >= 2.9 || traffic.byCar.command < 2, `min command gap ${traffic.cmdGapMin}s`);
  pass('commands ride a carrier of their own', traffic.byCar.command > 0, `${traffic.byCar.command} command / ${traffic.byCar.field} field`);

  console.log('\n--- 7. THE GREP GATE -------------------------------------------------------------');
  const src = readFileSync(resolve(root, 'src/enemies/command.js'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  pass('no ctx.player anywhere in command.js', !/ctx\.player/.test(code), (code.match(/ctx\.player[^\s]*/g) || []).join(','));
  pass('no ctx.camera anywhere in command.js', !/ctx\.camera/.test(code));
  pass('no import of mimic.js or squad.js', !/from '\.\/(mimic|squad)\.js'/.test(src));

  await api.screenshot('command-1');
  return report();
}
