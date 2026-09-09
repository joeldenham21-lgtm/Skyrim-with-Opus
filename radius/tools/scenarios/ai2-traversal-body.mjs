// traversal.js — the committed verbs, the wind, and the locomotion model, driven against REAL Mimic
// instances in the real zone. The integrator has not wired the module into mimic.js yet, so every call here
// is made by hand: that is the point, and it is what "a clean exported API that takes entity-like objects"
// has to survive.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-traversal-body.mjs --out .smoke/ai2-trav-body
import { inject, boot, RAYCOUNT, pass } from './ai2-traversal-lib.mjs';

let bad = 0;

// Spawn a real mimic at (x, z) and give it the traversal rows the integrator's SKILL merge will provide.
const MIMIC = `(x, z, rows) => { const r = window.__radius, ctx = r.ctx, T = window.__TRAV;
  const e = r.spawn('mimic', x, z, { cls: 'regular' });
  e.aware = 0; e.engaged = false; e.state = 'patrol'; e.target = null;
  Object.assign(e.skill, rows || {});
  T.createBody(e);
  e.__rows = rows || {};
  // the mimic re-mixes its skill every 2 s off SKILL_KEYS, which do not include the traversal rows, so a
  // re-mix leaves them alone — but re-apply on every step in the tests so nothing can quietly drift
  return e; }`;

export default async function (page, api) {
  await boot(api, { noEnemies: true });
  await inject(api);
  await api.run(RAYCOUNT);
  await api.run(`window.__mk = ${MIMIC}`);
  // a flat empty site, and a player who cannot be killed by anything we do to him
  // A clear patch with a long straight corridor out of it: the chase needs sixty metres of ground that is
  // not water, not a wall and not a gravity well, or it measures the scenery instead of the legs.
  await api.run(`(() => { const ctx = window.__radius.ctx; ctx.debug.god = true;
    window.__site = (() => { const w = ctx.world;
      const clear = (x, z, r) => { if (w.isWater(x, z)) return false; let n = 0;
        w.query(x, z, r, (c) => { if (!c.dead && !c.passable) n++; }); if (n) return false;
        for (const a of ctx.anomalies.list) if (Math.hypot(a.position.x - x, a.position.z - z) < (a.radius || 6) + r) return false;
        return true; };
      let best = null, bs = -1;
      for (let x = -240; x <= 240; x += 12) for (let z = -240; z <= 240; z += 12) {
        if (!clear(x, z, 22)) continue;
        const h = w.getHeight(x, z); let v = 0;
        for (const [dx, dz] of [[6,0],[-6,0],[0,6],[0,-6],[14,0],[0,14]]) v += Math.abs(w.getHeight(x+dx, z+dz) - h);
        if (v > 5) continue;
        // longest clear straight run out of here, in eight directions
        let bestRun = 0, bestA = 0;
        for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; let run = 0;
          for (let d = 4; d <= 72; d += 4) { if (!clear(x + Math.cos(a) * d, z + Math.sin(a) * d, 3.5)) break; run = d; }
          if (run > bestRun) { bestRun = run; bestA = a; } }
        const score = bestRun - v * 2;
        if (score > bs) { bs = score; best = { x, z, run: bestRun, ax: +Math.cos(bestA).toFixed(3), az: +Math.sin(bestA).toFixed(3) }; } }
      return best; })();
    window.__pdmg = 0; const dm = ctx.player.damage.bind(ctx.player);
    ctx.player.damage = (a, i) => { window.__pdmg += a; return 0; };
    return window.__site; })()`);
  const site = await api.run('window.__site');
  console.log('site', JSON.stringify(site));

  // =================================================================================================
  // 1. A COMMITTED BODY CANNOT FIRE. The whole fairness case for giving them these verbs at all.
  // =================================================================================================
  const commit = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV, S = window.__site;
    w.clearTag('ai2b');
    const base = w.getHeight(S.x, S.z);
    w.addBox(S.x + 2.4, base + 1.8 - (1.8 + 2) / 2, S.z, 3, 3.8, 6, { tag: 'ai2b', surface: 'concrete' });   // a 1.8 m ledge
    const m = window.__mk(S.x, S.z, { climb: 1, dodge: 0.85, melee: 0.9, sprintW: 0.95 });
    m.position.set(S.x, base, S.z); m.yaw = Math.atan2(-1, 0);
    let fired = 0, flashes = 0, frames = 0, maxK = 0, verb = null, y0 = m.position.y;
    const mf = ctx.vfx.muzzleFlash; ctx.vfx.muzzleFlash = (...a) => { flashes++; return mf(...a); };
    const started = T.tryMantle(m, S.x + 6, S.z);
    verb = m.body.verb;
    for (let i = 0; i < 200; i++) {
      m.burstLeft = 5; m.aiming = true;                    // the AI trying to shoot, every single frame
      const owned = T.bodyTick(m, 0.05);
      if (!owned) break;
      frames++;
      if (m.burstLeft !== 0 || m.aiming) fired++;
      if (T.mayFire(m)) fired++;
      maxK = Math.max(maxK, m.body.verbK);
    }
    ctx.vfx.muzzleFlash = mf;
    const rise = m.position.y - y0;
    m.alive = false; m.removeMe = true; ctx.enemies.removeDead();
    return { started, verb, frames, fired, flashes, rise: +rise.toFixed(2), dur: +(frames * 0.05).toFixed(2) }; })()`);
  console.log('   clamber:', JSON.stringify(commit));
  bad += pass('a 1.8 m ledge is a clamber', commit.started && commit.verb === 'clamber');
  bad += pass('it cannot fire for the whole commitment', commit.fired === 0 && commit.flashes === 0,
    `${commit.dur} s of free target, ${commit.frames} frames`);
  bad += pass('it ends up on the ledge', commit.rise > 1.5, `rose ${commit.rise} m`);

  // =================================================================================================
  // 2. THE FALL. followGround damps y at lambda 30, so a mimic that walked off a roof used to FLOAT
  //    down and land unhurt. A roof is now exactly as dangerous to them as it is to the Explorer.
  // =================================================================================================
  const fall = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV, S = window.__site;
    w.clearTag('ai2b');
    const base = w.getHeight(S.x, S.z - 16);
    w.addBox(S.x, base + 2.6, S.z - 16, 8, 5.2, 8, { tag: 'ai2b', surface: 'concrete' });   // a 5.2 m block, top at base+5.2
    const out = {};
    for (const mode of ['float', 'fall']) {
      const m = window.__mk(S.x, S.z - 16, { climb: 1 });
      m.position.set(S.x + 3.2, base + 5.2, S.z - 16); m.hp = 90; window.__pdmg = 0;
      m.lastSeenPlayer = null; m.aware = 0;
      ctx.player.position.set(S.x + 40, base, S.z - 16);        // somewhere it has never seen him
      let minVy = 0, landed = -1, hp0 = m.hp;
      for (let i = 0; i < 200; i++) {
        m.position.x += 3.0 * 0.05;                        // walk straight off the edge
        if (mode === 'fall') { T.fallTick(m, 0.05); T.bodyTick(m, 0.05); minVy = Math.min(minVy, m.body.vy); }
        else m.followGround(0.05);
        const g = w.groundHeight(m.position.x, m.position.z, m.position.y + 0.5).y;
        if (landed < 0 && m.position.y - g < 0.02 && i > 5) landed = i * 0.05;
      }
      out[mode] = { vy: +minVy.toFixed(1), landed: +landed.toFixed(2), dmg: hp0 - m.hp, y: +m.position.y.toFixed(2),
        learned: !!m.lastSeenPlayer, aware: +m.aware.toFixed(2) };
      m.alive = false; m.removeMe = true;
    }
    ctx.enemies.removeDead();
    return out; })()`);
  console.log('   drop off a 5.2 m block:', JSON.stringify(fall));
  bad += pass('it accelerates instead of floating', fall.fall.vy < -6, `peak vy ${fall.fall.vy} m/s (followGround: ${fall.float.vy})`);
  bad += pass('and a 5 m drop hurts', fall.fall.dmg > 0, `${fall.fall.dmg} HP`);
  bad += pass('a fall teaches it NOTHING about where you are', !fall.fall.learned && fall.fall.aware === 0,
    'Enemy.damage() would have written the player\'s exact feet into lastSeenPlayer');

  // =================================================================================================
  // 3. THE DIVE. Stimulus only, cooldown enforced, and it costs a real window off the trigger.
  // =================================================================================================
  const dive = await api.run(`(() => { const ctx = window.__radius.ctx, T = window.__TRAV, S = window.__site;
    ctx.world.clearTag('ai2b');
    const out = {};
    for (const [name, dodge] of [['elite', 0.85], ['recruit', 0.0], ['regular', 0.45]]) {
      const m = window.__mk(S.x + 14, S.z + 14, { dodge });
      m.lastSeenPlayer = new ctx.THREE.Vector3(S.x + 14, m.position.y, S.z + 30);
      let dives = 0, noFire = 0, longest = 0, run = 0, sends = 0;
      for (let i = 0; i < 1600; i++) {
        if (i % 80 === 0) { sends++; if (T.nearMiss(m, 0.6)) dives++; }
        T.bodyTick(m, 0.05);
        if (!T.mayFire(m)) { run += 0.05; noFire += 0.05; } else { longest = Math.max(longest, run); run = 0; }
      }
      out[name] = { sends, dives, noFire: +noFire.toFixed(2), window: +longest.toFixed(2) };
      m.alive = false; m.removeMe = true;
    }
    ctx.enemies.removeDead();
    return out; })()`);
  console.log('   dives (20 rounds cracked past, 4 s apart):', JSON.stringify(dive));
  bad += pass('an elite goes to ground on incoming fire', dive.elite.dives >= 12, `${dive.elite.dives}/${dive.elite.sends}`);
  bad += pass('a recruit never does', dive.recruit.dives === 0);
  bad += pass('each dive costs at least 0.65 s off the trigger', dive.elite.window >= 0.65, `longest window ${dive.elite.window} s`);

  // =================================================================================================
  // 4. THE TAKEDOWN. It is a decision, not a hitscan: backing away beats it.
  // =================================================================================================
  const mel = await api.run(`(() => { const ctx = window.__radius.ctx, T = window.__TRAV, S = window.__site, p = ctx.player;
    ctx.world.clearTag('ai2b');
    const out = {};
    for (const mode of ['stand', 'back', 'norank']) {
      const m = window.__mk(S.x - 14, S.z + 14, { melee: mode === 'norank' ? 0.2 : 0.9 });
      const g = ctx.world.groundHeight(S.x - 14, S.z + 16, 20).y;
      p.position.set(S.x - 14, g, S.z + 16.0);
      m.yaw = Math.atan2(-(p.position.x - m.position.x), -(p.position.z - m.position.z));
      window.__pdmg = 0;
      const began = T.tryMelee(m, p.position.x, p.position.z);
      let firedDuring = 0, windup = 0;
      for (let i = 0; i < 60; i++) {
        if (mode === 'back') p.position.z += 3.6 * 0.05;   // the Explorer walks backwards off the swing
        m.burstLeft = 4;
        const owned = T.bodyTick(m, 0.05);
        if (owned) { windup += 0.05; if (m.burstLeft) firedDuring++; }
        else if (i > 2) break;
      }
      out[mode] = { began, windup: +windup.toFixed(2), dmg: window.__pdmg, firedDuring };
      m.alive = false; m.removeMe = true;
    }
    ctx.enemies.removeDead();
    return out; })()`);
  console.log('   takedown:', JSON.stringify(mel));
  bad += pass('a standing target is taken down', mel.stand.began && mel.stand.dmg === 30, `${mel.stand.windup} s of windup`);
  bad += pass('backing away defeats it', mel.back.began && mel.back.dmg === 0);
  bad += pass('it never fires mid-swing', mel.stand.firedDuring === 0 && mel.back.firedDuring === 0);
  bad += pass('melee 0.20 has no takedown at all', mel.norank.began === false);

  // =================================================================================================
  // 5. THE CHASE. Two Explorers: one scripted at a flat 6.2 m/s forever (no such person exists), and one
  //    paying controller.js's real wind bill. The mimic's own wind model is the Explorer's, verbatim.
  // =================================================================================================
  const chase = await api.run(`(() => { const ctx = window.__radius.ctx, T = window.__TRAV, S = window.__site;
    ctx.world.clearTag('ai2b');
    const out = {};
    for (const player of ['flat', 'winded']) for (const [name, sprintW] of [['elite', 0.95], ['regular', 0.5], ['recruit', 0.10]]) {
      const m = window.__mk(S.x - S.ax * 12, S.z - S.az * 12, { climb: 1, sprintW });
      const px = { x: m.position.x + S.ax * 6, z: m.position.z + S.az * 6 };
      let sta = 100, hold = 0, blown = false, sprintT = 0;
      const d0 = 6;
      for (let i = 0; i < 240; i++) {                       // 12 s
        // the Explorer
        let sp = 3.6;
        if (player === 'flat') sp = 6.2;
        else {
          const want = !blown && sta > 5;
          if (want) { sp = 6.2; sta = Math.max(0, sta - 17 * 0.05); hold = 1.9; if (sta <= 0.5) blown = true; }
          else { hold = Math.max(0, hold - 0.05); if (hold <= 0) sta = Math.min(100, sta + 13 * 0.05); if (blown && sta >= 35) blown = false; }
        }
        px.x += S.ax * sp * 0.05; px.z += S.az * sp * 0.05;
        // the mimic, driven purely through this module + common.js steering
        const d = Math.hypot(px.x - m.position.x, px.z - m.position.z);
        if (T.wantSprint(m, d, 1)) sprintT += 0.05;
        const mv = T.moveSpeedFor(m, 3.4, px.x, px.z, true);
        m.moveToward({ x: px.x, y: m.position.y, z: px.z }, mv, 0.05, { stop: 0.5, face: false });
        T.faceStep(m, px.x, px.z, 0.05);
        T.fallTick(m, 0.05); T.bodyTick(m, 0.05);
      }
      const d1 = Math.hypot(px.x - m.position.x, px.z - m.position.z);
      out[player + '/' + name] = { gap: +(d1 - d0).toFixed(1), sprint: +sprintT.toFixed(1), wind: Math.round(m.body.wind), blown: m.body.blown };
      m.alive = false; m.removeMe = true;
    }
    ctx.enemies.removeDead();
    return out; })()`);
  console.log('   12 s chase, metres of ground LOST by the mimic:');
  for (const k of Object.keys(chase)) console.log(`      ${k.padEnd(16)} ${String(chase[k].gap).padStart(6)} m   (sprinted ${chase[k].sprint} s, wind left ${chase[k].wind}${chase[k].blown ? ', blown' : ''})`);
  // SPEED_SPRINT is 6.0 and the Explorer's is 6.2, on purpose, and the mimic pays the Explorer's wind bill:
  // a mimic can therefore NEVER out-run a player who never tires, and the flat column says so out loud. What
  // the curve has to buy is that an elite hangs on to somebody running a real stamina bar while a recruit is
  // left behind inside a couple of seconds.
  bad += pass('an elite hangs on to an Explorer who pays for his sprint', chase['winded/elite'].gap < 14, `${chase['winded/elite'].gap} m in 12 s`);
  bad += pass('a recruit is left standing', chase['winded/recruit'].gap > chase['winded/elite'].gap + 8,
    `recruit ${chase['winded/recruit'].gap} m vs elite ${chase['winded/elite'].gap} m`);
  bad += pass('a recruit never spends wind at all', chase['winded/recruit'].sprint === 0);
  bad += pass('nobody out-runs a player who never tires', chase['flat/elite'].gap > 12, `${chase['flat/elite'].gap} m`);

  // =================================================================================================
  // 6. THE LOCOMOTION MODEL. This is the answer to "not scary robots strafing left and right".
  // =================================================================================================
  const loco = await api.run(`(() => { const ctx = window.__radius.ctx, T = window.__TRAV, S = window.__site;
    ctx.world.clearTag('ai2b');
    const out = { gates: {}, runs: {} };
    for (const deg of [0, 45, 90, 135, 180]) out.gates[deg] = { turn: +T.turnGate(deg * Math.PI / 180).toFixed(2), strafe: +T.strafeGate(deg * Math.PI / 180).toFixed(2) };
    // a body told to go somewhere behind it: how long before it has covered 4 m, gated and ungated?
    for (const [name, gated] of [['gated', 1], ['today', 0]]) {
      for (const [dir, deg] of [['ahead', 0], ['behind', 180], ['side', 90]]) {
        const m = window.__mk(S.x - S.ax * 8, S.z - S.az * 8, { climb: 1 });
        const a = deg * Math.PI / 180;
        m.yaw = Math.atan2(-S.ax, -S.az);                      // facing along the clear corridor
        const tx = m.position.x + (Math.cos(a) * S.ax - Math.sin(a) * S.az) * 20;
        const tz = m.position.z + (Math.cos(a) * S.az + Math.sin(a) * S.ax) * 20;
        const p0x = m.position.x, p0z = m.position.z;
        let t = 0;
        for (let i = 0; i < 200; i++) {
          if (gated) {
            const sp = T.moveSpeedFor(m, 3.4, tx, tz, true);
            m.moveToward({ x: tx, y: m.position.y, z: tz }, sp, 0.05, { face: false });
            T.faceStep(m, tx, tz, 0.05);                       // the rate-limited turn
          } else m.moveToward({ x: tx, y: m.position.y, z: tz }, 3.4, 0.05, {});   // today, verbatim
          T.fallTick(m, 0.05); T.bodyTick(m, 0.05);
          t += 0.05;
          if (Math.hypot(m.position.x - p0x, m.position.z - p0z) >= 4) break;
        }
        // and the sustained pace once it is up to speed, which must not have changed at all
        let far = 0; const fx = m.position.x, fz = m.position.z;
        for (let i = 0; i < 40; i++) {
          const sp = gated ? T.moveSpeedFor(m, 3.4, tx, tz, true) : 3.4;
          m.moveToward({ x: tx, y: m.position.y, z: tz }, sp, 0.05, { face: gated ? false : undefined });
          if (gated) T.faceStep(m, tx, tz, 0.05);
          T.fallTick(m, 0.05); T.bodyTick(m, 0.05);
        }
        far = Math.hypot(m.position.x - fx, m.position.z - fz) / 2;
        out.runs[name + '/' + dir] = +t.toFixed(2);
        out.runs[name + '/' + dir + '/top'] = +far.toFixed(2);
        out.runs[name + '/' + dir + '/load'] = +m.body.load.toFixed(3);
        m.alive = false; m.removeMe = true;
      }
    }
    // and a body holding its aim while it shuffles: the strafe, which is the thing that looked robotic
    const m = window.__mk(S.x - S.ax * 6, S.z - S.az * 6, { climb: 1 });
    m.yaw = Math.atan2(-S.ax, -S.az);                          // facing up the corridor
    let lat = 0;
    for (let i = 0; i < 60; i++) {
      const tx = m.position.x - S.az * 12, tz = m.position.z + S.ax * 12;   // straight across its own facing
      const sp = T.moveSpeedFor(m, 3.4, tx, tz, false);
      const bx = m.position.x, bz = m.position.z;
      m.moveToward({ x: tx, y: m.position.y, z: tz }, sp, 0.05, { face: false });
      lat += Math.hypot(m.position.x - bx, m.position.z - bz);
      T.bodyTick(m, 0.05);
    }
    out.strafeSpeed = +(lat / 3).toFixed(2);
    m.alive = false; m.removeMe = true; ctx.enemies.removeDead();
    return out; })()`);
  console.log('   gates:', JSON.stringify(loco.gates));
  console.log('   4 m from a standing start (s):', JSON.stringify(loco.runs));
  console.log('   sustained lateral speed while holding aim:', loco.strafeSpeed, 'm/s (engage speed is 3.4)');
  // the gated body carries its own load factor (what it is holding and wearing), so the fair comparison is
  // against 3.4 x that factor, not against a flat 3.4
  const wantTop = 3.4 * loco.runs['gated/ahead/load'];
  bad += pass('top speed is untouched once the load factor is accounted for',
    Math.abs(loco.runs['gated/ahead/top'] - wantTop) < 0.08,
    `${loco.runs['gated/ahead/top']} m/s vs ${wantTop.toFixed(2)} expected (load ${loco.runs['gated/ahead/load']}), today ${loco.runs['today/ahead/top']}`);
  bad += pass('a standing start costs a fraction of a second, not more',
    loco.runs['gated/ahead'] - loco.runs['today/ahead'] > 0.02 && loco.runs['gated/ahead'] - loco.runs['today/ahead'] < 0.4,
    `${loco.runs['gated/ahead']} s vs ${loco.runs['today/ahead']} s today`);
  bad += pass('turning round costs real time', loco.runs['gated/behind'] > loco.runs['today/behind'] + 0.4,
    `${loco.runs['gated/behind']} s vs ${loco.runs['today/behind']} s today`);
  bad += pass('a held-aim sidestep is a shuffle, not a run', loco.strafeSpeed < 2.2 && loco.strafeSpeed > 1.2);

  // =================================================================================================
  // 7. THE TREE, with a real Mimic and its real moveToward (detours, anomaly kick-out and all).
  // =================================================================================================
  const tree = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV, S = window.__site;
    w.clearTag('ai2b');
    const ox = S.x - S.ax * 4, oz = S.z - S.az * 4;
    const trx = ox + S.ax * 7, trz = oz + S.az * 7;             // the trunk, dead on the line
    const tx = ox + S.ax * 14, tz = oz + S.az * 14;             // where it wants to be
    w.addCylinder(trx, trz, 0.5, w.getHeight(trx, trz), w.getHeight(trx, trz) + 8, { tag: 'ai2b', surface: 'wood' });
    const out = {};
    for (const mode of ['today', 'routed']) {
      const m = window.__mk(ox, oz, { climb: 1 });
      m.position.set(ox, w.getHeight(ox, oz), oz);
      m.yaw = Math.atan2(-S.ax, -S.az);
      let arrived = -1, minT = 99, wp = { x: 0, y: 0, z: 0 }, planned = 0, stuckHits = 0, near = 0;
      for (let i = 0; i < 400; i++) {
        const bx = m.position.x, bz = m.position.z;
        let gx = tx, gz = tz;
        if (mode === 'routed') { const r = T.routeTick(m, tx, tz, 0.05); if (r) { gx = r.x; gz = r.z; planned = m.body.routeN ? Math.max(planned, 1) : planned; } }
        const sp = mode === 'routed' ? T.moveSpeedFor(m, 3.4, gx, gz, true) : 3.4;
        m.moveToward({ x: gx, y: m.position.y, z: gz }, sp, 0.05, { stop: 0.4, face: mode === 'routed' ? false : undefined });
        if (mode === 'routed') T.faceStep(m, gx, gz, 0.05);
        T.fallTick(m, 0.05);
        const moved = Math.hypot(m.position.x - bx, m.position.z - bz);
        m._mvWanted = true; m._mvTarget.set(gx, m.position.y, gz);
        m.stuckTick(0.05, moved);                                 // mimic.js's own detour logic, untouched
        T.bodyTick(m, 0.05);
        if (moved < 0.55 * 0.05) near++;                          // frames mimic.js's stuckTick would call stuck
        if (T.hasRoute(m)) stuckHits = Math.max(stuckHits, 1);
        minT = Math.min(minT, Math.hypot(m.position.x - trx, m.position.z - trz));
        if (arrived < 0 && Math.hypot(m.position.x - tx, m.position.z - tz) < 1.3) { arrived = i * 0.05; break; }
      }
      out[mode] = { arrived: +arrived.toFixed(2), minTrunk: +minT.toFixed(2), routed: planned,
        stuckTickWouldFire: near, left: +Math.hypot(m.position.x - tx, m.position.z - tz).toFixed(1) };
      m.alive = false; m.removeMe = true;
    }
    ctx.enemies.removeDead();
    return out; })()`);
  console.log('   real mimic, 14 m walk with a 0.5 m trunk dead on the line:', JSON.stringify(tree));
  bad += pass('today it never gets past the trunk', tree.today.arrived < 0, `${tree.today.left} m still to go after 20 s`);
  bad += pass('and mimic.js\'s own stall test never even fires', tree.today.stuckTickWouldFire === 0,
    'it is moving the whole time; it is oscillating');
  bad += pass('routed, it gets there', tree.routed.arrived >= 0, `${tree.routed.arrived} s, closest approach ${tree.routed.minTrunk} m`);

  // =================================================================================================
  // 7b. THE SAME TEST ON A REAL TREE. flora.js registers every trunk as a cylinder collider tagged
  //     'flora', so this is literally the thing the player said confuses them, in the forest, unmodified.
  // =================================================================================================
  const real = await api.run(`(() => { const ctx = window.__radius.ctx, w = ctx.world, T = window.__TRAV;
    // a trunk with a bit of room round it, so the measurement is about that trunk and not the thicket
    let tree = null, best = -1, trunks = 0, axis = 0;
    for (const c of w.collision.all) {
      if (c.dead || c.kind !== 'cyl' || c.tag !== 'flora' || c.r < 0.2 || c.r > 0.9) continue;
      trunks++;
      if (w.isWater(c.x, c.z)) continue;
      // clearance: the nearest other solid, and a straight 7 m run out of both ends of one axis
      let near = 99; w.query(c.x, c.z, 6, (o) => { if (!o.dead && !o.passable && o !== c) near = Math.min(near, Math.hypot(o.x != null ? o.x - c.x : (o.min.x + o.max.x) / 2 - c.x, o.z != null ? o.z - c.z : (o.min.z + o.max.z) / 2 - c.z)); });
      if (near < 2.4) continue;
      for (const a of [0, 1]) {
        let ok = true;
        for (const sgn of [-1, 1]) for (const d of [4, 7]) {
          const x = c.x + (a ? 0 : sgn * d), z = c.z + (a ? sgn * d : 0);
          if (w.isWater(x, z)) { ok = false; break; }
          let k = 0; w.query(x, z, 1.1, (o) => { if (!o.dead && !o.passable && o !== c) k++; }); if (k) { ok = false; break; }
        }
        if (ok && near > best) { best = near; tree = c; axis = a; }
      }
    }
    if (!tree) return { trunks, none: 1 };
    const out = { trunks, at: [Math.round(tree.x), Math.round(tree.z)], r: +tree.r.toFixed(2), clear: +best.toFixed(1), poi: w.nearestPoi(tree.x, tree.z).poi.id };
    for (const mode of ['today', 'routed']) {
      const ox = tree.x - (axis ? 0 : 7), oz = tree.z - (axis ? 7 : 0);
      const tx = tree.x + (axis ? 0 : 7), tz = tree.z + (axis ? 7 : 0);
      const m = window.__mk(ox, oz, { climb: 1 });
      m.position.set(ox, w.getHeight(ox, oz), oz);
      m.yaw = Math.atan2(-(tx - ox), -(tz - oz));
      let arrived = -1, minT = 99;
      for (let i = 0; i < 400; i++) {
        let gx = tx, gz = tz;
        if (mode === 'routed') { const r = T.routeTick(m, tx, tz, 0.05); if (r) { gx = r.x; gz = r.z; } }
        const sp = mode === 'routed' ? T.moveSpeedFor(m, 3.4, gx, gz, true) : 3.4;
        m.moveToward({ x: gx, y: m.position.y, z: gz }, sp, 0.05, { stop: 0.4, face: mode === 'routed' ? false : undefined });
        if (mode === 'routed') T.faceStep(m, gx, gz, 0.05);
        T.fallTick(m, 0.05); T.bodyTick(m, 0.05);
        minT = Math.min(minT, Math.hypot(m.position.x - tree.x, m.position.z - tree.z));
        if (Math.hypot(m.position.x - tx, m.position.z - tz) < 1.3) { arrived = i * 0.05; break; }
      }
      out[mode] = { arrived: +arrived.toFixed(2), minTrunk: +minT.toFixed(2), left: +Math.hypot(m.position.x - tx, m.position.z - tz).toFixed(1) };
      m.alive = false; m.removeMe = true;
    }
    ctx.enemies.removeDead();
    return out; })()`);
  console.log('   a real flora trunk:', JSON.stringify(real));
  if (real && real.routed) bad += pass('routed, it gets round a real tree', real.routed.arrived >= 0,
    `${real.routed.arrived} s (today: ${real.today.arrived >= 0 ? real.today.arrived + ' s' : 'never, ' + real.today.left + ' m short'})`);
  else console.log('   (no isolated flora trunk found in this seed)');

  // =================================================================================================
  // 8. THE BILL. Twelve real mimics, six hundred steps of the whole body pass. Zero rays.
  // =================================================================================================
  const bill = await api.run(`(() => { const ctx = window.__radius.ctx, T = window.__TRAV, S = window.__site;
    ctx.world.clearTag('ai2b');
    const list = [];
    for (let i = 0; i < 12; i++) list.push(window.__mk(S.x - 10 + (i % 4) * 3, S.z - 8 + Math.floor(i / 4) * 3, { climb: 1, dodge: 0.85, melee: 0.9, sprintW: 0.95 }));
    window.__rc.ray = 0; window.__rc.los = 0; window.__rc.solid = 0; window.__rc.ground = 0;
    T.resetStats();
    const t0 = performance.now();
    for (let s = 0; s < 600; s++) {
      for (const m of list) {
        T.wantSprint(m, 30, 0.6);
        const sp = T.moveSpeedFor(m, 3.4, m.position.x + Math.sin(s * 0.03) * 9, m.position.z + 9, true);
        T.bodyTick(m, 0.05);
        if (!T.fallTick(m, 0.05)) m.followGround(0.05);
        T.reflexTick(m, 0.05);
        if (s % 40 === 0) T.tryMantle(m, m.position.x + 4, m.position.z);
        if (s % 60 === 0) T.reach(m, m.position.x + 12, m.position.z + 4);
      }
    }
    const ms = performance.now() - t0;
    const rc = Object.assign({}, window.__rc);
    for (const m of list) { m.alive = false; m.removeMe = true; }
    ctx.enemies.removeDead();
    return { usPerFrame: +(ms * 1000 / 600).toFixed(1), rc, stats: T.stats() }; })()`);
  console.log('   12 mimics x 600 steps:', JSON.stringify(bill));
  bad += pass('the entire traversal layer spends ZERO rays', bill.rc.ray === 0 && bill.rc.los === 0,
    `pointInSolid ${bill.rc.solid}, groundHeight ${bill.rc.ground}, ${bill.usPerFrame} us/frame for 12`);
  bad += pass('and allocates nothing after createBody', bill.stats.alloc === 0);

  await api.run(`window.__radius.ctx.world.clearTag('ai2b')`);
  console.log(bad ? `FAILURES: ${bad}` : 'all green');
}
