// THE FOUR BEHAVIOURS THE PLAYER ASKED FOR, one at a time, with numbers.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-integrate-behaviour.mjs --out .smoke/ai2-behaviour
//
//   1. THE TREE.  "I can hide behind a tree and it confuses them." One mimic, one trunk on the sightline.
//                 At angle 0.95 it must walk the arc and get its line back; at 0.05 it must NOT. Both halves.
//   2. THE BODY.  Vaults, clambers, dives, takedowns and sprints, counted over a long elite contact, and the
//                 same contact at day one where none of them exist.
//   3. THE HIDER. A mimic that has gone to ground makes ZERO audio calls, and never learns where you are.
//   4. THE WORDS. What a sixty-second contact actually sounds like, word by word, and how many transmissions.
import { boot, HOOKS, SETUP, STEP } from './ai2-integrate-lib.mjs';

// ---------------------------------------------------------------------------------------------------
// 1a. THE TRUNK — the traversal half. A mimic is sent to a point twelve metres away with a tree dead on the
// line. common.js's avoidance pushes it back down its own approach vector, the push weakens as the
// look-ahead retreats, and it comes forward again — for ever, at full speed, so the old stall test (which
// asks whether the body is MOVING) never fires. routeTick asks whether the distance to the goal is falling.
// ---------------------------------------------------------------------------------------------------
const TRUNK = `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player, TH = ctx.THREE;
  r.teleport(-118, 92); r.setLook(0.35, -0.02); r.setTime(12); ctx.player.update(0);
  for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; } ctx.enemies.removeDead(); ctx.squads.reset();
  ctx.world.clearTag('ai2tree');
  const f = p.forward;
  const out = [];
  for (const route of [true, false]) {
    ctx.world.clearTag('ai2tree');
    const sx = p.position.x + f.z * (route ? 30 : -30), sz = p.position.z - f.x * (route ? 30 : -30);
    const gx = sx + f.x * 12, gz = sz + f.z * 12;
    const tx = sx + f.x * 6, tz = sz + f.z * 6;
    const ty = ctx.world.getHeight(tx, tz);
    ctx.world.addCylinder(tx, tz, 0.28, ty - 0.2, ty + 5, { tag: 'ai2tree', surface: 'wood' });
    const e = r.spawn('mimic', sx, sz, { poi: 'zarya', cls: 'regular' });
    if (!e) { out.push({ err: 'spawn' }); continue; }
    e.aware = 0; e.engaged = false; e.setState('patrol');
    if (!route) { const b = e.body; b.replanCool = 1e9; b.progT = -1e9; }   // the control: no route solver
    const goal = new TH.Vector3(gx, ctx.world.getHeight(gx, gz), gz);
    let best = 1e9, arrived = -1;
    for (let i = 0; i < 500; i++) {
      ctx.elapsed += 0.05; ctx.frame++;
      e.setTarget(goal); e.state = 'patrol'; e.stateT = 0;
      ctx.enemies.update(0.05);
      if (!route) { const b = e.body; b.replanCool = 1e9; b.progT = -1e9; }
      const d = Math.hypot(e.position.x - gx, e.position.z - gz);
      if (d < best) best = d;
      if (d < 1.2 && arrived < 0) { arrived = +(i * 0.05).toFixed(2); break; }
    }
    e.alive = false; e.removeMe = true; ctx.enemies.removeDead();
    out.push({ routeSolver: route, arrivedAt: arrived, closest: +best.toFixed(1) });
  }
  ctx.world.clearTag('ai2tree');
  return out;
})()`;

// ---------------------------------------------------------------------------------------------------
// 1b. THE THING YOU ARE BEHIND — the command half. A six-metre wall two and a half metres in front of the
// Explorer. Walking straight at it does not restore the line; the only answer is to walk the arc round an
// end, which from fifteen metres is about fifty degrees of bearing. ANGLE is that answer, and it needs
// leader.skill.angle >= 0.35 to exist at all — so the same geometry must produce two different outcomes.
// ---------------------------------------------------------------------------------------------------
const WALL = (tide, sec, cls) => `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player, TH = ctx.THREE;
  ctx.state.data.tideLevel = ${tide}; ctx.state.data.securityLevel = ${sec};
  r.teleport(-118, 92); r.setLook(0.35, -0.02); r.setTime(12); ctx.player.update(0);
  for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; } ctx.enemies.removeDead(); ctx.squads.reset();
  for (let i = 0; i < 70; i++) ctx.squads.update(0.05);
  ctx.world.clearTag('ai2tree');
  const f = p.forward;
  const D = 16;
  const mx = p.position.x + f.x * D, mz = p.position.z + f.z * D;
  const wx = p.position.x + f.x * 2.5, wz = p.position.z + f.z * 2.5;
  const wy = ctx.world.getHeight(wx, wz);
  // six metres of wall across the line, three metres tall, built from three boxes so it survives the
  // world-axis-aligned collider contract whichever way the Explorer happens to be pointing
  for (let k = -1; k <= 1; k++) {
    const cx = wx + f.z * k * 2.0, cz = wz - f.x * k * 2.0;
    ctx.world.addBox(cx, wy + 1.5, cz, 2.1, 3.0, 2.1, { tag: 'ai2tree', surface: 'concrete' });
  }
  const e = r.spawn('mimic', mx, mz, { poi: 'zarya', cls: '${cls}', yaw: Math.atan2(-(p.position.x - mx), -(p.position.z - mz)) });
  if (!e) return { err: 'no spawn' };
  const sq = ctx.squads.form([e], ctx.world.poi('zarya'));
  window.__list = [e]; window.__sq = sq;
  // a real sighting first: he steps out from behind the end of the wall for three seconds
  // he steps out IN FRONT of the wall — the way a man actually breaks cover — so the last sighting is on
  // the line the wall is on, which is what makes the wall the thing he went behind rather than a coincidence
  const sx = p.position.x, sz = p.position.z;
  p.position.x += f.x * 4.6; p.position.z += f.z * 4.6;
  for (let i = 0; i < 90; i++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); }
  const saw = ctx.elapsed - e.lastVisT < 1;
  // ...and steps back behind it
  p.position.x = sx; p.position.z = sz;
  let lostAt = -1;
  for (let i = 0; i < 120; i++) {
    ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
    if (ctx.elapsed - e.lastVisT > 1.2) { lostAt = +(i * 0.05).toFixed(2); break; }
  }
  const a0 = Math.atan2(e.position.z - p.position.z, e.position.x - p.position.x);
  const d0 = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
  let maxTurn = 0, turnAtRange = 0, lineBack = -1, lineRange = -1, closest = 999, plays = {}, angleTicks = 0;
  let radMin = 1e9, radMax = 0;
  for (let i = 0; i < 500; i++) {
    ctx.elapsed += 0.05; ctx.frame++;
    ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
    if (!e.alive) break;
    const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
    if (d < closest) closest = d;
    const a = Math.atan2(e.position.z - p.position.z, e.position.x - p.position.x);
    let turn = Math.abs(a - a0); if (turn > Math.PI) turn = Math.PI * 2 - turn;
    turn *= 180 / Math.PI;
    if (turn > maxTurn) maxTurn = turn;
    if (d > 8 && turn > turnAtRange) turnAtRange = turn;
    const id = sq.mind && sq.mind.play ? sq.mind.play.id : 'none';
    plays[id] = (plays[id] || 0) + 1;
    if (id === 'ANGLE') { angleTicks++; if (d < radMin) radMin = d; if (d > radMax) radMax = d; }
    if (lineBack < 0 && ctx.elapsed - e.lastVisT < 0.2) { lineBack = +(i * 0.05).toFixed(2); lineRange = +d.toFixed(1); }
  }
  ctx.world.clearTag('ai2tree');
  return { cls: '${cls}', angleSkill: +e.skill.angle.toFixed(2), saw, lostAt, d0: +d0.toFixed(1),
    turn: Math.round(maxTurn), turnAtRange: Math.round(turnAtRange), lineBack, lineRange,
    closest: +closest.toFixed(1), angleTicks, plays,
    occ: sq.mind && sq.mind.picture.occluder ? sq.mind.picture.occKind : null };
})()`;

// ---------------------------------------------------------------------------------------------------
// 2. THE BODY — what the movement layer actually does over a long contact
// ---------------------------------------------------------------------------------------------------
const BODY = (n) => `(() => {
  const ctx = window.__radius.ctx, p = ctx.player;
  const verbs = { vault: 0, clamber: 0, drop: 0, dive: 0, melee: 0 };
  let sprintFrames = 0, frames = 0, routes0 = 0, mantles = 0;
  const trav = ctx.enemies.ai.traversal;
  const s0 = trav.stats();
  const was = new Map();
  let fireT = 1.2, train = 0;
  for (let i = 0; i < ${n}; i++) {
    ctx.elapsed += 0.05; ctx.frame++;
    fireT -= 0.05;
    if (fireT <= 0) {
      ctx.director.notify('shot', { pos: p.position.clone(), noise: 1 });
      // real rounds, down the barrel: ballistics calls e.suppress() for anything within 3.5 m of the flight
      // path, which is the dive trigger. Aimed deliberately wide so nobody actually dies during the count.
      const tgt = window.__list.find((m) => m.alive);
      if (tgt && ctx.ballistics && !ctx.ballistics.isStub) {
        const dx = tgt.position.x - p.eye.x, dy = (tgt.position.y + 1.0) - p.eye.y, dz = tgt.position.z - p.eye.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        const ox = -dz / l * 0.045, oz = dx / l * 0.045;
        ctx.ballistics.shoot(p.eye, new ctx.THREE.Vector3(dx / l + ox, dy / l + 0.02, dz / l + oz).normalize(),
          { source: 'player', damage: 1, spreadDeg: 0.2, range: 120, kind: 'bullet', tracer: false });
      }
      if (++train >= 4) { train = 0; fireT = 1.6 + Math.random() * 0.8; } else fireT = 0.11; }
    ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); ctx.player.update(0.05);
    frames++;
    for (const m of window.__list) {
      if (!m.alive || !m.body) continue;
      const v = m.body.verb;
      if (v && was.get(m) !== v) verbs[v] = (verbs[v] || 0) + 1;
      was.set(m, v);
      if (m.body.airborne) verbs.drop++;
      if (m.body.sprinting) sprintFrames++;
    }
  }
  const s1 = trav.stats();
  return { verbs, sprintFrac: +(sprintFrames / Math.max(1, frames * window.__list.length)).toFixed(3),
    probes: s1.probes - s0.probes, routes: s1.routes - s0.routes, orbits: s1.orbits - s0.orbits,
    alloc: s1.alloc, losPeak: s1.losPeak };
})()`;

// ---------------------------------------------------------------------------------------------------
// 3. THE HIDER
// ---------------------------------------------------------------------------------------------------
const HIDER = `(() => {
  const r = window.__radius, ctx = r.ctx, p = ctx.player;
  const amb = ctx.enemies.ai.ambush;
  for (const e of ctx.enemies.list) { e.alive = false; e.removeMe = true; } ctx.enemies.removeDead(); ctx.squads.reset();
  ctx.state.data.tideLevel = 3; ctx.state.data.securityLevel = 5;
  const f = p.forward;
  const hx = p.position.x + f.x * 11, hz = p.position.z + f.z * 11;
  const e = r.spawn('mimic', hx, hz, { poi: 'zarya', cls: 'elite' });
  const ctrl = r.spawn('mimic', p.position.x - f.x * 11, p.position.z - f.z * 11, { poi: 'zarya', cls: 'elite' });
  if (!e) return { err: 'no spawn' };
  // he is told to guard the ground the player is standing on
  amb.beginHide(e, ctx, p.position.x, p.position.z);
  // every sound either of them makes, counted by owner
  const calls = { hider: [], control: [] };
  const play0 = ctx.audio.play.bind(ctx.audio), loop0 = ctx.audio.loop.bind(ctx.audio);
  const own = (o) => { if (!o || !o.pos) return null;
    if (Math.hypot(o.pos.x - e.position.x, o.pos.z - e.position.z) < 1.5) return 'hider';
    if (ctrl && Math.hypot(o.pos.x - ctrl.position.x, o.pos.z - ctrl.position.z) < 1.5) return 'control';
    return null; };
  ctx.audio.play = (n, o) => { const w = own(o); if (w) calls[w].push(n); return play0(n, o); };
  ctx.audio.loop = (n, o) => { const w = own(o); if (w) calls[w].push('LOOP:' + n); return loop0(n, o); };
  // settle him first (walking to a hiding place is NOT silent, and should not be)
  for (let i = 0; i < 1400; i++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); if (amb.isHidden(e)) break; }
  const settled = amb.describe(e);
  calls.hider.length = 0; calls.control.length = 0;
  // ...and now sixty seconds of a stationary player with his back turned, ten metres away
  let nearest = 1e9, aware = 0, pulses = 0, wasPulse = 0;
  for (let i = 0; i < 1200; i++) {
    ctx.elapsed += 0.05; ctx.frame++;
    ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
    if (!amb.isHidden(e)) break;
    if (e.lastSeenPlayer) nearest = Math.min(nearest, Math.hypot(e.lastSeenPlayer.x - p.position.x, e.lastSeenPlayer.z - p.position.z));
    aware = Math.max(aware, e.aware);
    const pv = amb.visualFor(e, {}).pulse;
    if (pv > 0.5 && wasPulse <= 0.5) pulses++;
    wasPulse = pv;
  }
  ctx.audio.play = play0; ctx.audio.loop = loop0;
  return { settled, hiderSounds: calls.hider.length, hiderNames: [...new Set(calls.hider)],
    controlSounds: calls.control.length, controlNames: [...new Set(calls.control)],
    nearestBelief: nearest > 1e8 ? -1 : +nearest.toFixed(1), aware: +aware.toFixed(2), pulses,
    stillHidden: amb.isHidden(e) };
})()`;

export default async function (page, api) {
  await boot(api);
  await api.run(HOOKS);

  console.log('\n==== 1a. THE TRUNK (traversal) ====');
  console.log('  ', JSON.stringify(await api.run(TRUNK)));
  console.log('\n==== 1b. THE THING YOU ARE BEHIND (command / ANGLE) ====');
  for (const [label, tide, sec, cls] of [['late    T3/C5 elite  ', 3, 5, 'elite'], ['day-one T1/C1 recruit', 1, 1, 'recruit']]) {
    console.log('  ' + label, JSON.stringify(await api.run(WALL(tide, sec, cls))));
  }

  console.log('\n==== 2. THE BODY ====');
  for (const t of [
    { name: 'day-one T1/C1', poi: 'zarya', x: -118, z: 92, look: 0.35, d: 26, n: 5, tide: 1, sec: 1, cls: 'recruit', seed: 31 },
    { name: 'late    T3/C5', poi: 'zarya', x: -118, z: 92, look: 0.35, d: 26, n: 5, tide: 3, sec: 5, cls: 'elite', seed: 31 },
  ]) {
    await api.run(SETUP(t));
    let acc = null;
    for (let k = 0; k < 3; k++) {
      const r = await api.run(BODY(400));
      if (!acc) acc = r;
      else { for (const v in r.verbs) acc.verbs[v] += r.verbs[v]; acc.probes += r.probes; acc.routes += r.routes; acc.orbits += r.orbits; acc.sprintFrac = +((acc.sprintFrac + r.sprintFrac) / 2).toFixed(3); }
    }
    console.log('  ' + t.name, JSON.stringify(acc));
  }

  console.log('\n==== 2b. THE DIVE AND THE TAKEDOWN (driven directly) ====');
  for (const t of [
    { name: 'day-one T1/C1', tide: 1, sec: 1, cls: 'recruit' },
    { name: 'late    T3/C5', tide: 3, sec: 5, cls: 'elite' },
  ]) {
    await api.run(SETUP({ poi: 'zarya', x: -118, z: 92, look: 0.35, d: 20, n: 2, tide: t.tide, sec: t.sec, cls: t.cls, seed: 88 }));
    console.log('  ' + t.name, JSON.stringify(await api.run(`(() => {
      const ctx = window.__radius.ctx, p = ctx.player, m = window.__list[0], trav = ctx.enemies.ai.traversal;
      const step = (n) => { for (let i = 0; i < n; i++) { ctx.elapsed += 0.05; ctx.frame++; ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05); } };
      step(40);
      // twenty rounds cracked past, four seconds apart: how many put him on the deck, and for how long
      let dives = 0, noFire = 0;
      for (let k = 0; k < 20; k++) {
        const before = !!m.body.verb;
        m.suppress(0.6, null);
        if (!before && m.body.verb === 'dive') { dives++;
          let n = 0; while ((m.body.verb === 'dive' || m.body.recover > 0) && n < 60) { step(1); n++; }
          noFire = Math.max(noFire, +(n * 0.05).toFixed(2)); }
        step(80);
      }
      // and the takedown: dry, nothing to throw, and the Explorer standing in front of him
      const k2 = window.__list[1] || m;
      k2.loadout.mags.length = 0; if (k2.weapon.mag) k2.weapon.mag.rounds = 0; k2.weapon.chamber = null;
      k2.grenades = 0; k2.dry = true;
      k2.position.set(p.position.x + 1.9, p.position.y, p.position.z + 0.4);
      k2.believe(p.position, 0, ctx.elapsed, 1); k2.lastVisT = ctx.elapsed; k2.aware = 1; k2.engaged = true; k2.setState('engage');
      let melee = 0, windup = -1, hurt = 0;
      const dmg0 = window.__H.dmg;
      for (let i = 0; i < 120; i++) {
        ctx.elapsed += 0.05; ctx.frame++;
        k2.believe(p.position, 0, ctx.elapsed, 1); k2.lastVisT = ctx.elapsed;
        ctx.enemies.update(0.05); ctx.squads.update(0.05); ctx.director.update(0.05);
        if (k2.body.verb === 'melee') { melee = 1; if (windup < 0) windup = +(i * 0.05).toFixed(2); }
      }
      hurt = Math.round(window.__H.dmg - dmg0);
      return { dodge: +m.skill.dodge.toFixed(2), dives, longestNoFire: noFire,
        melee: +k2.skill.melee.toFixed(2), tookASwing: melee, swingAt: windup, damageDone: hurt };
    })()`)));
  }

  console.log('\n==== 3. THE HIDER ====');
  console.log('  ', JSON.stringify(await api.run(HIDER)));

  console.log('\n==== 4. THE WORDS ====');
  await api.run(SETUP({ poi: 'zarya', x: -118, z: 92, look: 0.35, d: 32, n: 5, tide: 3, sec: 5, cls: null, seed: 5150 }));
  await api.run(`(() => { const H = window.__H; H.radio.length = 0; H.words = {}; return 'ok'; })()`);
  for (let k = 0; k < 3; k++) await api.run(STEP(400));
  console.log('  ', JSON.stringify(await api.run(`(() => { const H = window.__H;
    const seq = H.radio.slice(0, 40).join(' ');
    return { transmissions: H.radio.length, perMinute: +(H.radio.length / 1).toFixed(1), words: H.words, first40: seq };
  })()`)));
}
