// ambush.js — choosing the place, the tell, the triggers, the gating and the cost.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-ambush-2.mjs --out .smoke/ai2-ambush-2
//
// 6.  THE SPOT        invisible from 30 m up the lane, lethal at 6 m — re-measured with independent rays
// 7.  THE CHOKE       the doorway it waits on, and whether it is really a doorway
// 8.  THE TELL        the pulse: rate, depth, and how it scales with the curve
// 9.  THE TRIGGERS    every spring condition, positive and negative
// 10. GATING          how many the zone is allowed, by escalation and by POI
// 11. COST            rays for a pick, and per-frame cost of a dozen hidden men
// 12. END TO END      a real hider at a real building, and a player who walks into it
import { boot } from './ai2-ambush-lib.mjs';

const say = (k, v) => console.log(k.padEnd(10), JSON.stringify(v));
let fails = 0;
const ok = (name, cond, detail) => { if (!cond) { fails++; console.log('FAIL     ', name, detail === undefined ? '' : JSON.stringify(detail)); } else console.log('pass     ', name, detail === undefined ? '' : JSON.stringify(detail)); };

export default async function (page, api) {
  await boot(page, api);
  await api.run(`(() => { window.__radius.god(true); window.__radius.setTime(12); })()`);

  // ---- 6. THE SPOT ------------------------------------------------------------------------------------
  // Real POIs with real buildings. For each, put a mimic at the centre, tell it the player walks in from
  // the POI's recorded bearing, and let it choose. Then re-measure the two claims with our own rays.
  const spots = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush, TH = ctx.THREE;
    const rows = [];
    const p1 = new TH.Vector3(), p2 = new TH.Vector3();
    for (const id of ['zarya', 'object12', 'church', 'checkpoint', 'convoy', 'rail']) {
      const P = ctx.world.poi(id); if (!P) continue;
      for (const pat of [1, 0]) {
        H.clear();
        // the man walks in from +x
        const fromX = P.x + 40, fromZ = P.z;
        H.player({ x: fromX, z: fromZ });
        const m = H.mimic(P.x, P.z, { poi: id, seed: 0.3 });
        if (!m) continue;
        H.skill(m, { patience: pat, springR: pat ? 18 : 8 });
        A.createHide(m, {});
        H.frame();
        const r0 = H.rays(), s0 = H.solids();
        const got = A.pickHide(m, ctx, fromX, fromZ);
        const rays = H.rays() - r0, solids = H.solids() - s0;
        if (!got) { rows.push({ poi: id, pat, got: false, rays, solids }); continue; }
        const h = m.hide;
        // independent re-measure of the two claims the module made
        const fx = h.x + h.laneX * 30, fz = h.z + h.laneZ * 30;
        const nx = h.x + h.laneX * 6, nz = h.z + h.laneZ * 6;
        const fg = ctx.world.groundHeight(fx, fz, h.y + 6), ng = ctx.world.groundHeight(nx, nz, h.y + 6);
        p1.set(h.x, h.y + 1.12, h.z); p2.set(fx, fg.y + 1.62, fz);
        const seenFar = ctx.world.lineOfSight(p1, p2);
        p1.set(h.x, h.y + 1.66, h.z); p2.set(nx, ng.y + 1.30, nz);
        const killNear = ctx.world.lineOfSight(p1, p2);
        rows.push({ poi: id, pat, got: true, rays, solids,
          walk: +Math.hypot(h.x - m.position.x, h.z - m.position.z).toFixed(1),
          quality: +h.quality.toFixed(2), kind: h.kind, enc: +h.enclosure.toFixed(2),
          lane: h.laneSrc, seenFar, killNear });
      }
    }
    return rows;
  })()`);
  console.log('\n6. THE SPOT   (seenFar must be false = concealed from the approach; killNear must be true)');
  for (const r of spots) console.log('   ' + JSON.stringify(r));
  const elite = spots.filter((r) => r.pat === 1), recruit = spots.filter((r) => r.pat === 0);
  const eGot = elite.filter((r) => r.got), rGot = recruit.filter((r) => r.got);
  say('summary', {
    elitePicked: `${eGot.length}/${elite.length}`, recruitPicked: `${rGot.length}/${recruit.length}`,
    eliteConcealed: eGot.filter((r) => !r.seenFar).length, eliteLethal: eGot.filter((r) => r.killNear).length,
    recruitConcealed: rGot.filter((r) => !r.seenFar).length, recruitLethal: rGot.filter((r) => r.killNear).length,
    eliteEnclosed: eGot.filter((r) => r.enc >= 0.5).length, meanEnc: +(eGot.reduce((a, r) => a + r.enc, 0) / Math.max(1, eGot.length)).toFixed(2), meanRays: +(spots.reduce((a, r) => a + r.rays, 0) / spots.length).toFixed(1),
  });
  ok('an elite finds a place at the built-up POIs', eGot.length >= 4, { got: eGot.length, of: elite.length });
  ok('and REFUSES a bad hole rather than taking one', eGot.length < rGot.length, { elite: eGot.length, recruit: rGot.length });
  ok('EVERY elite spot is concealed from 30 m', eGot.length > 0 && eGot.every((r) => !r.seenFar), eGot.map((r) => [r.poi, r.seenFar]));
  ok('EVERY elite spot is lethal at 6 m', eGot.every((r) => r.killNear), eGot.map((r) => [r.poi, r.killNear]));
  ok('a recruit accepts a worse hole', rGot.some((r) => r.seenFar) || rGot.length < eGot.length,
    { recruitExposed: rGot.filter((r) => r.seenFar).length, recruitPicked: rGot.length });
  ok('a pick costs at most 8 rays', spots.every((r) => r.rays <= 8), spots.map((r) => r.rays));

  // ---- 6b. THE BUILDING ------------------------------------------------------------------------------
  // The user's case: a mimic inside a structure, and an Explorer clearing it. Put the man on an INTERIOR
  // spawn spot with the approach coming from outside and run the REAL loop — choose, walk, settle — so the
  // retry-and-degrade path is exercised rather than a single pick.
  const building = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush, w = ctx.world;
    const rows = [], seen = new Set();
    for (const sp of w.spawnSpots) {
      if (sp.kind !== 'interior' || seen.has(sp.poi)) continue;
      const P = w.poi(sp.poi); if (!P) continue;
      seen.add(sp.poi);
      H.clear();
      const dx = sp.position.x - P.x, dz = sp.position.z - P.z, l = Math.hypot(dx, dz) || 1;
      const fromX = sp.position.x + dx / l * 35, fromZ = sp.position.z + dz / l * 35;
      H.player({ x: fromX, z: fromZ });
      const m = H.mimic(sp.position.x, sp.position.z, { poi: sp.poi, seed: 0.37 });
      if (!m) continue;
      H.skill(m, { patience: 1, springR: 14 });
      const x0 = m.position.x, z0 = m.position.z;
      const here = A.enclosureAt(ctx, x0, m.position.y, z0);
      A.beginHide(m, ctx, fromX, fromZ);
      let steps = 0;
      while (H.state(m) !== 'hold' && steps < 1400) { ctx.elapsed += 0.05; ctx.frame++; A.hideTick(m, 0.05); steps++; }
      const h = m.hide;
      rows.push({ poi: sp.poi, here: +here.toFixed(2), settled: H.state(m) === 'hold',
        t: +(steps * 0.05).toFixed(1), walk: +Math.hypot(h.x - x0, h.z - z0).toFixed(1),
        enc: +A.enclosureAt(ctx, h.x, h.y, h.z).toFixed(2), quality: +h.quality.toFixed(2),
        kind: h.kind, choke: h.hasChoke, muted: h.muted });
      if (rows.length >= 6) break;
    }
    return rows;
  })()`);
  console.log('\n6b. THE BUILDING  (a man already inside a structure; here = enclosure where he started)');
  for (const r of building) console.log('   ' + JSON.stringify(r));
  const inside = building.filter((r) => r.here >= 0.25);
  say('building', { n: building.length, insideStarts: inside.length,
    allSettled: building.every((r) => r.settled), meanWalk: +(building.reduce((a, r) => a + r.walk, 0) / building.length).toFixed(1) });
  ok('every one of them ends up hidden and silent', building.every((r) => r.settled && r.muted), building.map((r) => [r.poi, r.settled, r.muted]));
  ok('nobody walks far to hide', building.every((r) => r.walk < 10), building.map((r) => [r.poi, r.walk]));
  ok('and nothing chosen is a hole it cannot shoot out of',
    building.every((r) => r.quality >= 0.55 || r.kind === 3), building.map((r) => [r.poi, r.quality, r.kind]));

  // ---- 7. THE CHOKE ----------------------------------------------------------------------------------
  const chokes = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    const rows = [];
    for (const id of ['zarya', 'object12', 'church', 'checkpoint']) {
      const P = ctx.world.poi(id); if (!P) continue;
      let found = 0, tested = 0, verified = 0, pickSolid = 0, setSolid = 0; const tiers = [], kinds = [];
      for (let k = 0; k < 8; k++) {
        H.clear();
        const a = k / 8 * Math.PI * 2;
        const cx = P.x + Math.cos(a) * P.r * 0.35, cz = P.z + Math.sin(a) * P.r * 0.35;
        if (ctx.world.isWater(cx, cz)) continue;
        H.player({ x: P.x + Math.cos(a) * 45, z: P.z + Math.sin(a) * 45 });
        const m = H.mimic(cx, cz, { poi: id, seed: 0.15 + k * 0.1 });
        if (!m) continue;
        H.skill(m, { patience: 1 });
        A.createHide(m, {});
        tested++;
        H.frame();
        const s0 = H.solids();
        if (!A.pickHide(m, ctx, ctx.player.position.x, ctx.player.position.z)) continue;
        pickSolid += H.solids() - s0;
        // the choke sweep is amortised over the settle: one bearing of the fan a frame
        const s1 = H.solids();
        m.hide.state = 'set';
        H.step(m, 0.05, 24);
        setSolid += H.solids() - s1;
        if (!m.hide.hasChoke) continue;
        found++;
        // re-measure: open at 1.5 m either side, solid at 3.0 m either side
        // re-measure, against the tier the module says it matched. The perpendicular is recovered from the
        // choke point rather than trusted: it must be somewhere on the fan the module swept.
        const h = m.hide;
        const bx = h.chokeX - h.x, bz = h.chokeZ - h.z, bl = Math.hypot(bx, bz) || 1;
        const px = -bz / bl, pz = bx / bl;
        const g = ctx.world.groundHeight(h.chokeX, h.chokeZ, h.y + 4), y = g.y + A.CHOKE_Y;
        const S = (r) => ctx.world.pointInSolid(h.chokeX + px * r, y, h.chokeZ + pz * r);
        const T = (r) => ctx.world.pointInSolid(h.chokeX - px * r, y, h.chokeZ - pz * r);
        const stand = !S(0.6) && !T(0.6);
        let real = false;
        if (h.chokeTier === 0) real = stand && S(1.5) && T(1.5);
        else if (h.chokeTier === 1) real = stand && !S(1.5) && !T(1.5) && S(3.2) && T(3.2);
        else if (h.chokeTier === 2) real = stand && !S(1.5) && !T(1.5) && (S(2.2) !== T(2.2));
        kinds.push(A.CHOKE_KIND[h.chokeTier]);
        if (real) verified++; else tiers.push([id, h.chokeTier, +h.chokeX.toFixed(1), +h.chokeZ.toFixed(1)]);
      }
      rows.push({ poi: id, tested, found, verified, kinds, solidPerPick: Math.round(pickSolid / Math.max(1, tested)), solidPerSettle: Math.round(setSolid / Math.max(1, tested)), bad: tiers.length ? tiers : undefined });
    }
    return rows;
  })()`);
  console.log('\n7. THE CHOKE  (the ground he has to commit to: a doorway, a gap, or a wall on one shoulder)');
  for (const r of chokes) console.log('   ' + JSON.stringify(r));
  const totFound = chokes.reduce((a, r) => a + r.found, 0), totVer = chokes.reduce((a, r) => a + r.verified, 0);
  ok('chokes are found at built-up POIs', totFound > 0, { found: totFound });
  ok('and every one of them is really a choke', totFound > 0 && totVer === totFound, { found: totFound, verified: totVer });

  // ---- 8. THE TELL -----------------------------------------------------------------------------------
  const tell = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    const rows = [];
    for (const pat of [0, 0.5, 1]) {
      H.clear();
      H.player({ x: 0, z: 0 });
      const m = H.mimic(300, 300, { seed: 0.8 });
      H.skill(m, { patience: pat, springR: 8 });
      A.beginHide(m, ctx, 260, 300, { planted: true });
      m.hide.state = 'set'; m.hide.hasSpot = true; m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
      let pulses = 0, up = false, peakFade = 0, peakGlow = 0, minFade = 9, minShiver = 9, maxShiver = 0;
      const secs = 120;
      for (let i = 0; i < secs / 0.05; i++) {
        ctx.elapsed += 0.05; ctx.frame++;
        A.hideTick(m, 0.05);
        const v = A.visualFor(m);
        if (v.pulse > 0.5 && !up) { up = true; pulses++; }
        if (v.pulse < 0.1) up = false;
        if (v.fade > peakFade) peakFade = v.fade;
        if (v.glow > peakGlow) peakGlow = v.glow;
        if (v.fade < minFade) minFade = v.fade;
        if (v.shiver < minShiver) minShiver = v.shiver;
        if (v.shiver > maxShiver) maxShiver = v.shiver;
      }
      rows.push({ patience: pat, pulses, perMin: +(pulses / (secs / 60)).toFixed(1),
        meanPeriod: +(secs / Math.max(1, pulses)).toFixed(2),
        fade: [+minFade.toFixed(2), +peakFade.toFixed(2)], glow: +peakGlow.toFixed(2),
        shiver: [+minShiver.toFixed(2), +maxShiver.toFixed(2)] });
    }
    // and the flinch: a probe bouncing off the wall beside it
    H.clear();
    H.player({ x: 0, z: 0 });
    const m = H.mimic(300, 300, { seed: 0.8 });
    H.skill(m, { patience: 1 });
    A.beginHide(m, ctx, 260, 300, { planted: true });
    m.hide.state = 'set'; m.hide.hasSpot = true; m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
    H.step(m, 0.05, 40);
    const before = A.visualFor(m).shiver;
    A.disturb(m, m.position.x + 1.5, m.position.z, 1);
    const after = A.visualFor(m).shiver;
    H.step(m, 0.05, 20);
    const settled = A.visualFor(m).shiver;
    const moved = Math.hypot(m.position.x - m.hide.x, m.position.z - m.hide.z);
    return { rows, flinch: { before: +before.toFixed(2), after: +after.toFixed(2), settled: +settled.toFixed(2), moved: +moved.toFixed(3) } };
  })()`);
  console.log('\n8. THE TELL  (the pulse a careful player is meant to find)');
  for (const r of tell.rows) console.log('   ' + JSON.stringify(r));
  say('flinch', tell.flinch);
  const t0 = tell.rows[0], t1 = tell.rows[2];
  ok('it pulses', t0.pulses > 0 && t1.pulses > 0, { recruit: t0.pulses, elite: t1.pulses });
  ok('a recruit pulses about twice as often', t0.perMin > t1.perMin * 1.6, { recruit: t0.perMin, elite: t1.perMin });
  ok('the pulse is a real change in the face', t1.fade[1] - t1.fade[0] > 0.35, { fade: t1.fade });
  ok('it is stiller than a live mimic', t1.shiver[0] <= 0.36, { shiver: t1.shiver });
  ok('a disturbance makes it flinch, not move', tell.flinch.after > tell.flinch.before && tell.flinch.moved < 0.05, tell.flinch);
  ok('and the flinch decays', tell.flinch.settled < tell.flinch.after, tell.flinch);

  // ---- 9. THE TRIGGERS -------------------------------------------------------------------------------
  const trig = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    const site = { x: -44, z: -40 };
    const make = (d, opts = {}) => {
      H.clear();
      H.player({ x: site.x + 30, z: site.z });
      const m = H.mimic(site.x, site.z, { seed: 0.5 });
      H.skill(m, Object.assign({ patience: 1, springR: 12, ambushAim: 0.15, react: 0.2 }, opts.skill || {}));
      A.beginHide(m, ctx, site.x + 30, site.z, { planted: true });
      m.hide.state = 'seek'; m.hide.hasSpot = true;
      m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
      m.hide.laneX = 1; m.hide.laneZ = 0; m.hide.aimX = m.position.x + 6; m.hide.aimZ = m.position.z;
      H.lookAt(m.position.x, m.position.z);
      H.step(m, 0.05, 80);
      if (d != null) H.player({ x: site.x + d, z: site.z });
      return m;
    };
    const run = (m, steps = 120) => {
      for (let i = 0; i < steps; i++) {
        ctx.elapsed += 0.05; ctx.frame++;
        A.hideTick(m, 0.05);
        if (H.state(m) !== 'hold' && H.state(m) !== 'tell') return { sprang: true, why: m.hide.reason, at: +(i * 0.05).toFixed(2) };
      }
      return { sprang: false, why: '', at: -1 };
    };
    const out = {};
    // A. inside springR, WATCHED: must not spring
    { const m = make(9); H.lookAt(m.position.x, m.position.z); out.watched = run(m); }
    // B. inside springR, back turned: springs
    { const m = make(9); H.lookAway(m.position.x, m.position.z); out.blind = run(m); }
    // C. very close, watched: springs anyway — he is walking into it
    { const m = make(2.5); H.lookAt(m.position.x, m.position.z); out.near = run(m); }
    // D. beyond springR, back turned: does not spring
    { const m = make(20); H.lookAway(m.position.x, m.position.z); out.far = run(m); }
    // E. shot at while down: springs whatever else is true
    { const m = make(40); H.lookAt(m.position.x, m.position.z); m.hp -= 12; out.hit = run(m, 10); }
    // F. a delivered call about ground near the hide: springs
    { const m = make(40); A.onCall(m, m.position.x + 6, m.position.z); out.call = run(m, 10); }
    // G. a delivered call about ground 60 m away: does NOT spring
    { const m = make(40); A.onCall(m, m.position.x + 60, m.position.z); out.farCall = run(m, 40); }
    // H. the squad came out: it comes out with them
    { const m = make(40); A.forceSpring(m, 'squad'); out.squad = run(m, 10); }
    return out;
  })()`);
  console.log('\n9. THE TRIGGERS');
  for (const k of Object.keys(trig)) console.log('   ' + k.padEnd(9) + JSON.stringify(trig[k]));
  ok('watched at 9 m: holds', !trig.watched.sprang);
  ok('back turned at 9 m: springs', trig.blind.sprang && trig.blind.why === 'blind', trig.blind);
  ok('2.5 m, watched: springs anyway', trig.near.sprang && (trig.near.why === 'near' || trig.near.why === 'close'), trig.near);
  ok('20 m, back turned: holds', !trig.far.sprang, trig.far);
  ok('shot at: springs', trig.hit.sprang && trig.hit.why === 'hit', trig.hit);
  ok('a call about nearby ground: springs', trig.call.sprang && trig.call.why === 'call', trig.call);
  ok('a call about ground 60 m away: holds', !trig.farCall.sprang, trig.farCall);
  ok('the squad springing takes it with them', trig.squad.sprang && trig.squad.why === 'squad', trig.squad);

  // ---- 10. GATING ------------------------------------------------------------------------------------
  const gate = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    const rows = [];
    const d = ctx.director;
    const orig = Object.getOwnPropertyDescriptor(d, 'escalation');
    for (const esc of [0, 1, 2, 3]) {
      H.clear();
      Object.defineProperty(d, 'escalation', { configurable: true, get: () => esc });
      let n = 0;
      const made = [];
      for (let i = 0; i < 6; i++) {
        const poi = ['zarya', 'marsh', 'church', 'rail', 'convoy', 'north'][i];
        if (!A.mayHide(ctx, poi)) continue;
        const m = H.mimic(300 + i * 3, 300, { poi, seed: 0.1 * i });
        A.beginHide(m, ctx, 260, 300, { planted: true });
        m.hide.state = 'hold'; m.hide.hasSpot = true;
        made.push(m); n++;
      }
      rows.push({ esc, cap: A.hiderCap(ctx), allowed: n, live: A.hiderCount(),
        perPoi: ['zarya', 'marsh', 'church', 'rail', 'convoy', 'north'].map((q) => A.hidersAt(q)) });
    }
    if (orig) Object.defineProperty(d, 'escalation', orig); else delete d.escalation;
    H.clear();
    return rows;
  })()`);
  console.log('\n10. GATING  (escalation decides how many hiders the zone may have standing)');
  for (const r of gate) console.log('   ' + JSON.stringify(r));
  ok('escalation 0: no hiders at all', gate[0].allowed === 0, gate[0]);
  ok('escalation caps the count', gate[1].allowed === 1 && gate[2].allowed === 2 && gate[3].allowed === 3,
    gate.map((r) => r.allowed));
  ok('never two at one POI', gate.every((r) => r.perPoi.every((n) => n <= 1)), gate.map((r) => r.perPoi));

  // ---- 11. COST --------------------------------------------------------------------------------------
  const cost = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    H.clear();
    H.player({ x: -44, z: -40 });
    const list = [];
    for (let i = 0; i < 12; i++) {
      const m = H.mimic(-44 + 30 + (i % 4) * 4, -40 + Math.floor(i / 4) * 4, { seed: 0.05 * i });
      H.skill(m, { patience: 1, springR: 8 });
      A.beginHide(m, ctx, -44, -40, { planted: true });
      m.hide.state = 'set'; m.hide.hasSpot = true; m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
      list.push(m);
    }
    H.stepAll(list, 0.05, 40);          // settle
    const r0 = H.rays(), s0 = H.solids();
    const t0 = performance.now();
    const N = 600;
    H.stepAll(list, 0.05, N);
    const ms = performance.now() - t0;
    return { men: list.length, frames: N, rays: H.rays() - r0, solid: H.solids() - s0,
      raysPerFrame: +((H.rays() - r0) / N).toFixed(3), usPerFrame: +(ms * 1000 / N).toFixed(1),
      usPerManPerFrame: +(ms * 1000 / N / list.length).toFixed(2),
      allStillDown: list.every((m) => A.isHidden(m)) };
  })()`);
  console.log('\n11. COST  (12 hidden men, 600 frames, nobody near them)');
  say('cost', cost);
  ok('a dozen hiders cost no rays at all', cost.raysPerFrame < 0.05, { perFrame: cost.raysPerFrame });
  ok('and under 120 us of CPU a frame', cost.usPerFrame < 120, { us: cost.usPerFrame });
  ok('all twelve are still down', cost.allStillDown);

  // ---- 12. END TO END --------------------------------------------------------------------------------
  // A real hider at a real building: it chooses, walks there quietly, settles, and the player walks the
  // lane into it. We record what the PLAYER could have seen at every step of that walk.
  const e2e = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush, TH = ctx.THREE;
    const out = [];
    const eye = new TH.Vector3(), tgt = new TH.Vector3();
    for (const id of ['zarya', 'object12', 'church']) {
      const P = ctx.world.poi(id); if (!P) continue;
      H.clear();
      const fromX = P.x + 45, fromZ = P.z;
      H.player({ x: fromX, z: fromZ });
      const m = H.mimic(P.x, P.z, { poi: id, seed: 0.44 });
      if (!m) continue;
      H.skill(m, { patience: 1, springR: 14, ambushAim: 0.15, react: 0.2 });
      A.beginHide(m, ctx, fromX, fromZ);
      // let it choose and walk there
      let steps = 0;
      while (H.state(m) !== 'hold' && steps < 1400) { ctx.elapsed += 0.05; ctx.frame++; A.hideTick(m, 0.05); steps++; }
      if (H.state(m) !== 'hold') { out.push({ poi: id, settled: false, steps }); continue; }
      const h = m.hide;
      const walked = +(steps * 0.05).toFixed(1);
      // the approach: the player walks the lane from 45 m in, 1 m a step, LOOKING STRAIGHT AT THE HIDE
      let firstVisible = -1, sprangAt = -1;
      for (let d = 45; d > 1; d -= 1) {
        const x = h.x + h.laneX * d, z = h.z + h.laneZ * d;
        H.player({ x, z });
        H.lookAt(h.x, h.z);
        eye.copy(ctx.player.eye); tgt.set(h.x, h.y + 0.9, h.z);
        const canSee = ctx.world.lineOfSight(eye, tgt);
        if (canSee && firstVisible < 0) firstVisible = d;
        for (let i = 0; i < 12 && sprangAt < 0; i++) {
          ctx.elapsed += 0.05; ctx.frame++;
          A.hideTick(m, 0.05);
          if (H.state(m) === 'rise' || H.state(m) === 'out') sprangAt = d;
        }
        if (sprangAt >= 0) break;
      }
      out.push({ poi: id, settled: true, walked, quality: +h.quality.toFixed(2), enc: +h.enclosure.toFixed(2),
        choke: h.hasChoke, lane: h.laneSrc, firstVisible, sprangAt, reason: h.reason,
        springR: +h.springR.toFixed(0) });
    }
    return out;
  })()`);
  console.log('\n12. END TO END  (firstVisible = m at which the approaching player could first see it)');
  for (const r of e2e) console.log('   ' + JSON.stringify(r));
  const done = e2e.filter((r) => r.settled);
  ok('it chooses, walks and settles on its own', done.length === e2e.length, { settled: done.length, of: e2e.length });
  ok('it is not visible from the far approach', done.every((r) => r.firstVisible < 0 || r.firstVisible <= 22),
    done.map((r) => [r.poi, r.firstVisible]));
  ok('and it springs on the man who walked in', done.every((r) => r.sprangAt > 0), done.map((r) => [r.poi, r.sprangAt]));

  const s = await api.run(`window.__ambush.stats()`);
  console.log('\nMODULE COUNTERS'); say('stats', s);
  ok('zero allocation in the hot paths', s.alloc === 0, { alloc: s.alloc });

  console.log(fails ? `\n${fails} FAILURES` : '\nall assertions passed');
}
