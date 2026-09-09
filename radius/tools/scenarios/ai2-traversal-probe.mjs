// traversal.js — geometry, reachability parity, the route round a tree, and what it all costs.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-traversal-probe.mjs --out .smoke/ai2-trav-probe
//
// Everything here runs against the real world: real terrain heights, the real collider grid, the real
// spatial hash. Test geometry is added with world.addBox/addCylinder under a tag and cleared afterwards.
import { inject, boot, RAYCOUNT, ZERO_RC, STUB, pass } from './ai2-traversal-lib.mjs';

let bad = 0;

export default async function (page, api) {
  await boot(api);
  await inject(api);
  await api.run(RAYCOUNT);
  await api.run(STUB);

  // ---- a flat, empty patch of the zone to build on -------------------------------------------------
  const site = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world;
    let best = null, bs = 1e9;
    for (let x = -260; x <= 260; x += 20) for (let z = -260; z <= 260; z += 20) {
      if (w.isWater(x, z)) continue;
      let n = 0; w.query(x, z, 9, (c) => { if (!c.dead && !c.passable) n++; });
      if (n) continue;
      const h = w.getHeight(x, z);
      let v = 0; for (const [dx, dz] of [[3,0],[-3,0],[0,3],[0,-3],[6,0],[0,6]]) v += Math.abs(w.getHeight(x+dx, z+dz) - h);
      if (v < bs) { bs = v; best = { x, z, y: h, v: +v.toFixed(2) }; }
    }
    return best; })()`);
  console.log('site', JSON.stringify(site));

  // =================================================================================================
  // 1. THE PARITY TABLE. Eight ledges. The set the probe accepts must be exactly the set the Explorer's
  //    mantle accepts, because it is the same function with the same maxUp.
  // =================================================================================================
  const table = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    const S = ${JSON.stringify(site)};
    const hs = [0.4, 0.7, 1.0, 1.3, 1.6, 1.9, 2.1, 2.6];
    const out = [];
    window.__rc.ray = 0; window.__rc.los = 0; window.__rc.solid = 0; window.__rc.ground = 0;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      const cz = S.z + i * 12;                       // one lane per ledge, well clear of each other
      // the ledge top is exactly h above the FEET, not above the ground under the box: a metre of terrain
      // slope between the two would otherwise decide the classification instead of the ledge doing it
      const base = w.getHeight(S.x, cz);
      w.addBox(S.x + 2.4, base + h - (h + 2) / 2, cz, 3.0, h + 2.0, 6.0, { tag: 'ai2test', surface: 'concrete' });
      const from = { x: S.x, y: base, z: cz };
      const mimic = T.mantleProbe(w, from, 1, 0, 0.32, 1.85, T.MANTLE_HIGH, {});
      const player = T.mantleProbe(w, from, 1, 0, 0.35, 1.85, 2.15, {});   // controller.js's own numbers
      out.push({ h, mimic: mimic ? mimic.kind : null, height: mimic ? +mimic.height.toFixed(2) : 0,
                 top: mimic ? +mimic.topY.toFixed(2) : 0, player: player ? player.kind : null });
    }
    return { rows: out, rc: Object.assign({}, window.__rc) }; })()`);
  console.log('probe table:');
  for (const r of table.rows) console.log(`   ledge ${r.h.toFixed(1)} m -> ${String(r.mimic)}  (measured ${r.height}, top y ${r.top})  player: ${String(r.player)}`);
  console.log('   world calls during the whole table:', JSON.stringify(table.rc));

  const want = { 0.4: null, 0.7: 'vault', 1.0: 'vault', 1.3: 'vault', 1.6: 'clamber', 1.9: 'clamber', 2.1: 'clamber', 2.6: null };
  bad += pass('probe classification', table.rows.every((r) => r.mimic === want[r.h]),
    table.rows.map((r) => `${r.h}:${r.mimic}`).join(' '));
  bad += pass('mimic/player reachability identical', table.rows.every((r) => r.mimic === r.player));
  bad += pass('probe fires zero rays', table.rc.ray === 0 && table.rc.los === 0,
    `ray ${table.rc.ray} los ${table.rc.los} pointInSolid ${table.rc.solid} groundHeight ${table.rc.ground}`);

  // =================================================================================================
  // 2. THE SKILL GATE. Same eight ledges, three bodies: a recruit, a vaulter, a climber.
  // =================================================================================================
  const gate = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    const S = ${JSON.stringify(site)};
    const hs = [0.4, 0.7, 1.0, 1.3, 1.6, 1.9, 2.1, 2.6];
    const res = {};
    for (const [name, climb] of [['recruit', 0.0], ['regular', 0.40], ['elite', 1.0]]) {
      const got = [];
      for (let i = 0; i < hs.length; i++) {
        const cz = S.z + i * 12;
        const m = window.__stub(S.x, cz, { climb });
        m.yaw = Math.atan2(-1, 0);
        const ok = T.tryMantle(m, S.x + 6, cz);
        got.push(ok ? m.body.verb : null);
      }
      res[name] = got;
    }
    return res; })()`);
  console.log('   recruit :', JSON.stringify(gate.recruit));
  console.log('   regular :', JSON.stringify(gate.regular));
  console.log('   elite   :', JSON.stringify(gate.elite));
  bad += pass('recruit (climb 0) climbs nothing', gate.recruit.every((v) => v === null));
  bad += pass('regular (climb 0.40) vaults but does not clamber',
    gate.regular.filter((v) => v === 'vault').length === 3 && gate.regular.every((v) => v !== 'clamber'));
  bad += pass('elite (climb 1.0) does both',
    gate.elite.filter((v) => v === 'vault').length === 3 && gate.elite.filter((v) => v === 'clamber').length === 3);

  // =================================================================================================
  // 3. THE THIN WALL. A 0.25 m fence is not a ledge to stand on, it is a thing to get over, and the
  //    probe has to land the body on the far side rather than balancing it on the capping rail.
  // =================================================================================================
  const fence = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    const S = ${JSON.stringify(site)}; const cz = S.z - 30;
    const base = w.getHeight(S.x, cz);
    // a 0.25 m thick rail, with the body resolved hard against it exactly as resolveCapsule leaves it
    const fx = S.x + 0.32 + 0.125;
    w.addBox(fx, base + 0.5, cz, 0.25, 1.0, 8.0, { tag: 'ai2test', surface: 'metal' });
    const from = { x: S.x, y: base, z: cz };
    const L = T.mantleProbe(w, from, 1, 0, 0.32, 1.85, T.MANTLE_HIGH, {});
    return L ? { kind: L.kind, h: +L.height.toFixed(2), dx: +(L.topX - from.x).toFixed(2), farSide: L.topX > fx + 0.125 } : null; })()`);
  console.log('   fence:', JSON.stringify(fence));
  bad += pass('a 1.0 m fence is a vault that lands beyond it', !!fence && fence.kind === 'vault' && fence.farSide,
    fence ? `landing ${fence.dx} m ahead` : 'no ledge found');

  // =================================================================================================
  // 4. reach() — a seat above a body it cannot climb to is Infinity, and a hill is not a wall.
  // =================================================================================================
  const rch = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    const S = ${JSON.stringify(site)}; const cz = S.z - 45;
    const g = w.getHeight(S.x + 5, cz);
    w.addBox(S.x + 5, g + 1.0, cz, 4, 2.0, 4, { tag: 'ai2test' });      // a 2.0 m dock: clamber only
    const out = {};
    for (const [name, climb] of [['recruit', 0], ['regular', 0.4], ['elite', 1]]) {
      const m = window.__stub(S.x, cz, { climb });
      out[name] = { dock: T.reach(m, S.x + 5, cz), flat: +T.reach(m, S.x + 12, cz).toFixed(1) };
    }
    // a natural slope somewhere on the map: never Infinity, whatever the body can climb
    let slope = null;
    for (let x = -250; x <= 250 && !slope; x += 17) for (let z = -250; z <= 250; z += 17) {
      if (w.isWater(x, z)) continue; let n = 0; w.query(x, z, 8, (c) => { if (!c.dead && !c.passable) n++; }); if (n) continue;
      const a = w.getHeight(x, z), b = w.getHeight(x + 8, z);
      if (b - a > 1.6) { const m = window.__stub(x, z, { climb: 0 }); slope = { rise: +(b - a).toFixed(2), reach: +T.reach(m, x + 8, z).toFixed(1) }; break; }
    }
    return { out, slope }; })()`);
  console.log('   reach:', JSON.stringify(rch));
  bad += pass('a 2 m dock is out of a recruit\'s world', rch.out.recruit.dock === null || rch.out.recruit.dock === 'Infinity' || !isFinite(rch.out.recruit.dock));
  bad += pass('a 2 m dock is out of a vaulter\'s world', !isFinite(rch.out.regular.dock));
  bad += pass('a 2 m dock costs a climber a link', isFinite(rch.out.elite.dock) && rch.out.elite.dock > 5);
  bad += pass('a hillside is never Infinity for anybody', !!rch.slope && isFinite(rch.slope.reach), JSON.stringify(rch.slope));

  // =================================================================================================
  // 5. THE TREE. A trunk between a body and where it wants to be. This is the locomotion half of the
  //    reported bug: today moveToward pushes into the trunk, slides off its own avoidance vector,
  //    re-points at the target and pushes in again. planRoute gives it a memory of the obstruction.
  // =================================================================================================
  const tree = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    const S = ${JSON.stringify(site)}; const cz = S.z - 60;
    const tx = S.x + 12, tz = cz;                                   // the target, 12 m away
    const trx = S.x + 6, trz = cz;                                  // a 0.45 m trunk exactly halfway
    w.addCylinder(trx, trz, 0.45, w.getHeight(trx, trz), w.getHeight(trx, trz) + 7, { tag: 'ai2test', surface: 'wood' });
    const m = window.__stub(S.x, cz, {});
    window.__rc.solid = 0; window.__rc.ground = 0; window.__rc.ray = 0; window.__rc.los = 0;
    const blk = T.blockerOnLine(ctx, m.position.x, m.position.y, m.position.z, tx, tz, 16, {});
    const t0 = performance.now();
    const ok = T.planRoute(m, tx, tz);
    const planMs = performance.now() - t0;
    const rc = Object.assign({}, window.__rc);
    const laid = m.body.routeN, R0 = laid ? Math.hypot(m.body.route[0] - trx, m.body.route[2] - trz) : 0;
    // walk it: the committed arc, then the target. Measure how close the path ever came to the trunk.
    const pt = { x: 0, y: 0, z: 0 };
    let minTrunk = 99, steps = 0, arrived = 0;
    for (let i = 0; i < 400; i++) {
      steps++;
      const wp = T.routeTarget(m, pt);
      const gx = wp ? wp.x : tx, gz = wp ? wp.z : tz;
      const dx = gx - m.position.x, dz = gz - m.position.z, d = Math.hypot(dx, dz) || 1;
      m.faceToward(gx, gz, 0.05, 8);
      const sp = T.moveSpeedFor(m, 3.4, gx, gz, true);
      const st = Math.min(sp * 0.05, d);
      m.position.x += dx / d * st; m.position.z += dz / d * st;
      T.bodyTick(m, 0.05);
      const td = Math.hypot(m.position.x - trx, m.position.z - trz);
      if (td < minTrunk) minTrunk = td;
      if (Math.hypot(m.position.x - tx, m.position.z - tz) < 1.2) { arrived = 1; break; }
    }
    return { blocker: blk ? { r: +blk.r.toFixed(2), t: +blk.t.toFixed(1) } : null, planned: ok,
      waypoints: laid, orbitR: +R0.toFixed(2), planMs: +planMs.toFixed(3), rc,
      minTrunk: +minTrunk.toFixed(2), steps, arrived, side: m.body.routeSide }; })()`);
  console.log('   tree:', JSON.stringify(tree));
  bad += pass('the trunk is found on the line', !!tree.blocker);
  bad += pass('a route round it is committed', tree.planned && tree.waypoints >= 1, `${tree.waypoints} waypoints, side ${tree.side}`);
  bad += pass('planRoute spends no rays', tree.rc.ray === 0 && tree.rc.los === 0, JSON.stringify(tree.rc));
  bad += pass('the walk clears the trunk and arrives', tree.arrived === 1 && tree.minTrunk > 0.77,
    `closest approach ${tree.minTrunk} m, ${(tree.steps * 0.05).toFixed(1)} s`);

  // The control: the same walk with no route at all, which is what the mimic does today.
  const naive = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    const S = ${JSON.stringify(site)}; const cz = S.z - 60, tx = S.x + 12, tz = cz, trx = S.x + 6, trz = cz;
    const m = window.__stub(S.x, cz, {});
    let arrived = 0, steps = 0;
    for (let i = 0; i < 400; i++) {
      steps++;
      const dx = tx - m.position.x, dz = tz - m.position.z, d = Math.hypot(dx, dz) || 1;
      let vx = dx / d, vz = dz / d, px = 0, pz = 0;
      const ax = m.position.x + vx * Math.min(d, 2.5), az = m.position.z + vz * Math.min(d, 2.5);
      // common.js moveToward's avoidance, verbatim, including its degenerate-case perpendicular kick
      w.query(ax, az, 1.8, (c) => {
        if (c.dead || c.passable || c.noAvoid) return;
        let cx, cz, r;
        if (c.kind === 'box') { cx = Math.max(c.min.x, Math.min(ax, c.max.x)); cz = Math.max(c.min.z, Math.min(az, c.max.z)); r = 0.9;
          if (c.max.y < m.position.y + 0.5 || c.min.y > m.position.y + 1.85) return; }
        else { cx = c.x; cz = c.z; r = c.r + 0.7; if (c.y1 < m.position.y + 0.3) return; }
        const ox = ax - cx, oz = az - cz, od = Math.hypot(ox, oz);
        if (od < r) { const s = (r - od) / r; if (od < 1e-4) { px += -vz * s; pz += vx * s; } else { px += ox / od * s; pz += oz / od * s; } } });
      vx += px * 1.6; vz += pz * 1.6; const l = Math.hypot(vx, vz) || 1;
      m.position.x += vx / l * Math.min(3.4 * 0.05, d); m.position.z += vz / l * Math.min(3.4 * 0.05, d);
      w.resolveCapsule(m.position, 0.32, 1.85, 0.6);
      if (Math.hypot(m.position.x - tx, m.position.z - tz) < 1.2) { arrived = 1; break; }
    }
    return { arrived, steps }; })()`);
  console.log(`   control (today's pure steering, same trunk): arrived ${naive.arrived}, ${(naive.steps * 0.05).toFixed(1)} s`);

  // =================================================================================================
  // 6. COST. What a probe and a route actually take, measured, on the real collider grid.
  // =================================================================================================
  const cost = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    const S = ${JSON.stringify(site)};
    const from = { x: S.x, y: w.getHeight(S.x, S.z + 24), z: S.z + 24 };   // lane 2: a 1.0 m ledge
    const out = {};
    for (const [name, f] of [['probe-hit', () => T.mantleProbe(w, from, 1, 0, 0.32, 1.85, 2.15, {})],
                             ['probe-miss', () => T.mantleProbe(w, from, -1, 0, 0.32, 1.85, 2.15, {})]]) {
      for (let i = 0; i < 2000; i++) f();
      const t0 = performance.now(); const N = 20000;
      for (let i = 0; i < N; i++) f();
      out[name] = +((performance.now() - t0) * 1000 / N).toFixed(2);
    }
    // twelve bodies, six hundred steps of bodyTick + moveSpeedFor: the real per-frame cost
    const bodies = []; for (let i = 0; i < 12; i++) bodies.push(window.__stub(S.x + i * 2, S.z - 90, {}));
    for (const m of bodies) T.wantSprint(m, 30, 1);
    const t1 = performance.now();
    for (let s = 0; s < 600; s++) for (const m of bodies) { T.moveSpeedFor(m, 3.4, m.position.x + 5, m.position.z, true); T.bodyTick(m, 0.05); T.reflexTick(m, 0.05); }
    out.frameUs = +((performance.now() - t1) * 1000 / 600).toFixed(2);
    out.stats = T.stats();
    return out; })()`);
  console.log('   cost (microseconds):', JSON.stringify(cost));
  bad += pass('a full plan-tick body pass for 12 mimics is under 120 us', cost.frameUs < 120, `${cost.frameUs} us/frame`);

  // =================================================================================================
  // 7. THE BUDGET. TACTICAL_PER_FRAME is now 10 and it is one pool.
  // =================================================================================================
  const budget = await api.run(`(() => { const T = window.__TRAV, ctx = window.__radius.ctx;
    T.resetBudget(); const fake = { frame: 1 };
    let got = 0; for (let i = 0; i < 20; i++) if (T.losBudget(fake, 1)) got++;
    fake.frame = 2; let big = T.losBudget(fake, 11), fits = T.losBudget(fake, 10);
    return { perFrame: T.TACTICAL_PER_FRAME, got, big, fits }; })()`);
  bad += pass('the shared pool is exactly TACTICAL_PER_FRAME a frame',
    budget.got === 10 && budget.big === false && budget.fits === true, JSON.stringify(budget));

  await api.run(`window.__radius.ctx.world.clearTag('ai2test')`);
  console.log(bad ? `FAILURES: ${bad}` : 'all green');
}
