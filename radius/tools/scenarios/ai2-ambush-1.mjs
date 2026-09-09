// ambush.js — silence, patience, and the spring. Measured against the real world.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-ambush-1.mjs --out .smoke/ai2-ambush-1
//
// 1. ZERO SOUND          1200 steps of a hidden mimic 10 m from a stationary player: audio calls must be 0
// 2. IT DOES NOT CHEAT   2000 steps with the player out of range and inaudible: belief must stay wrong
// 3. IT SPRINGS          walk past at 9 m with the back turned; first round inside react*ambushAim + rise
// 4. THE CALL IS LAST    say('contact') must land AFTER the first round, never before
// 5. PATIENCE            gives up at patience 0, still down at 600 s at patience 1, never when planted
import { boot, R2 } from './ai2-ambush-lib.mjs';

const say = (k, v) => console.log(k.padEnd(10), JSON.stringify(v));
let fails = 0;
const ok = (name, cond, detail) => { if (!cond) { fails++; console.log('FAIL     ', name, detail === undefined ? '' : JSON.stringify(detail)); } else console.log('pass     ', name, detail === undefined ? '' : JSON.stringify(detail)); };

export default async function (page, api) {
  await boot(page, api);

  const world = await api.run(`(() => { const H = window.__H; window.__radius.god(true); window.__radius.setTime(12); return H.counts(); })()`);
  say('world', world);

  // ---- a piece of open ground with room to work -----------------------------------------------------
  const site = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H;
    for (const id of ['field_a', 'marsh', 'checkpoint', 'north', 'field_b', 'rail']) {
      const P = ctx.world.poi(id); if (!P) continue;
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2, x = P.x + Math.cos(a) * P.r * 0.4, z = P.z + Math.sin(a) * P.r * 0.4;
        if (ctx.world.isWater(x, z)) continue;
        const g = ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 2.2);
        if (ctx.world.pointInSolid(x, g.y + 1.5, z)) continue;
        return { poi: id, x: +x.toFixed(1), z: +z.toFixed(1), y: +g.y.toFixed(2) };
      }
    }
    return null;
  })()`);
  say('site', site);
  if (!site) { console.log('FAIL      no open ground'); return; }

  // ---- 1. ZERO SOUND ---------------------------------------------------------------------------------
  // A hidden mimic 10 m away, the player stationary and facing the other way, for a full minute of sim.
  const silent = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    H.clear();
    H.player({ x: ${site.x}, z: ${site.z} });
    const m = H.mimic(${site.x} + 10, ${site.z}, { seed: 0.4 });
    H.skill(m, { patience: 1, springR: 8, ambushAim: 0.15, react: 0.2 });
    // it is TOLD to hide right where it stands, so no walking phase muddies the audio count
    A.beginHide(m, ctx, ${site.x}, ${site.z}, { planted: true });
    m.hide.state = 'seek'; m.hide.hasSpot = true;
    m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
    m.hide.laneX = -1; m.hide.laneZ = 0; m.hide.aimX = m.position.x - 6; m.hide.aimZ = m.position.z;
    H.lookAway(m.position.x, m.position.z);            // his back is turned, but he is 10 m out (> springR/2)
    H.step(m, 0.05, 40);                                // settle
    const settled = H.state(m);
    // the static bed a normal mimic would be running, for comparison
    const other = H.mimic(${site.x} - 10, ${site.z}, { seed: 0.7 });
    other.loopSound('mimic_static', { gain: 0.3, max: 60, ref: 3 });
    H.clearAudio();
    const t0 = ctx.elapsed;
    H.step(m, 0.05, 1200);
    const log = H.audio();
    const mine = H.audioNear(m.position.x, m.position.z, 5, t0);
    return { settled, state: H.state(m), held: +m.hide.held.toFixed(1), muted: m.hide.muted,
      total: log.length, mine: mine.length, names: [...new Set(mine.map((e) => e.name))],
      staticLoop: !!m.staticLoop, radioT: m.radioT, hide: H.hide(m) };
  })()`);
  console.log('\n1. ZERO SOUND');
  say('result', silent);
  ok('goes down', silent.state === 'hold' && silent.muted, { settled: silent.settled, state: silent.state });
  ok('ZERO audio calls in 60 s', silent.mine === 0, { calls: silent.mine, names: silent.names });
  ok('static loop stopped', silent.staticLoop === false);
  ok('handset dead', silent.radioT >= 1e8, { radioT: silent.radioT });
  ok('still down after 60 s', silent.held > 55);

  // ---- 2. IT DOES NOT CHEAT --------------------------------------------------------------------------
  // (a) unseen and inaudible at 130 m — beyond the 80 m daylight reach. Its belief must stay wrong.
  // (b) SEEN, clearly, at 40 m with his back turned. Its belief is now right — that is fair, it has eyes —
  //     and it STILL does not spring, because the whole value of the position is the range. Information is
  //     not what makes it dangerous; position is.
  const fair = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    const run = (dist, steps) => {
      H.clear();
      H.player({ x: ${site.x}, z: ${site.z} });
      const m = H.mimic(${site.x} + dist, ${site.z}, { seed: 0.22 });
      H.skill(m, { patience: 1, springR: 18, ambushAim: 0.15 });
      A.beginHide(m, ctx, ${site.x}, ${site.z}, { planted: true });
      m.hide.state = 'set'; m.hide.hasSpot = true; m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
      m.hide.laneX = -1; m.hide.laneZ = 0; m.hide.aimX = m.position.x - 6; m.hide.aimZ = m.position.z;
      H.lookAway(m.position.x, m.position.z);
      let best = Infinity, maxAware = 0, sprang = false, sightings = 0;
      for (let i = 0; i < steps; i++) {
        ctx.elapsed += 0.05; ctx.frame++;
        A.hideTick(m, 0.05);
        if (H.state(m) !== 'hold' && H.state(m) !== 'set') { sprang = true; break; }
        const e = H.beliefErr(m); if (e < best) best = e;
        if (ctx.elapsed - m.lastVisT < 0.1) sightings++;
        if (m.aware > maxAware) maxAware = m.aware;
      }
      return { dist, sprang, state: H.state(m), closest: +best.toFixed(1), sightings,
        maxAware: +maxAware.toFixed(2), seenBy: H.seenBy(m, 60) };
    };
    return { far: run(130, 2000), seen: run(40, 600) };
  })()`);
  console.log('\n2. IT DOES NOT CHEAT');
  say('unseen', fair.far); say('seen', fair.seen);
  ok('unseen: never sprang', !fair.far.sprang);
  ok('unseen: belief never within 3 m', fair.far.closest > 3, { closest: fair.far.closest });
  ok('unseen: no sightings at all', fair.far.sightings === 0, { n: fair.far.sightings });
  ok('unseen: awareness stays low', fair.far.maxAware < 0.4, { max: fair.far.maxAware });
  ok('seen at 40 m: it really can see him', fair.seen.sightings > 0 && fair.seen.closest < 1.5, { closest: fair.seen.closest });
  ok('seen at 40 m: STILL does not spring', !fair.seen.sprang, { state: fair.seen.state });

  // ---- 3 & 4. IT SPRINGS, AND THE CALL COMES LAST ----------------------------------------------------
  // It settles while the player is 25 m away and looking straight at it: outside springR, nothing may fire,
  // so the settle is clean and measurable. Then he walks into the killing angle with his back turned and
  // the clock starts on that frame.
  const sprung = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    const out = [];
    for (const cfg of [{ n: 'elite', react: 0.18, aim: 0.15, pat: 1, d: 9 },
                       { n: 'recruit', react: 1.05, aim: 0.55, pat: 0, d: 9 },
                       { n: 'elite-close', react: 0.18, aim: 0.15, pat: 1, d: 4.5 }]) {
      H.clear();
      const hx = ${site.x} + 25, hz = ${site.z};
      H.player({ x: ${site.x}, z: ${site.z} });
      const m = H.mimic(hx, hz, { seed: 0.5 });
      H.skill(m, { patience: cfg.pat, springR: 12, ambushAim: cfg.aim, react: cfg.react, settle: 0.4 });
      A.beginHide(m, ctx, ${site.x}, ${site.z}, { planted: true });
      m.hide.state = 'seek'; m.hide.hasSpot = true;
      m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
      m.hide.laneX = -1; m.hide.laneZ = 0; m.hide.aimX = m.position.x - 6; m.hide.aimZ = m.position.z;
      H.lookAt(hx, hz);
      H.clearAudio();
      H.step(m, 0.05, 80);                              // 4 s: settle, at 25 m, watched
      const settled = H.state(m), settleAudio = H.audio().length;
      // he walks in and turns away
      H.player({ x: hx - cfg.d, z: hz });
      H.lookAway(hx, hz);
      const watchedSeen = false, awaySeen = H.seenBy(m, 60);
      H.clearAudio();
      const t0 = ctx.elapsed;
      let tellT = -1, riseT = -1, outT = -1;
      for (let i = 0; i < 200 && outT < 0; i++) {
        ctx.elapsed += 0.05; ctx.frame++;
        A.hideTick(m, 0.05);
        const s = H.state(m);
        if (s === 'tell' && tellT < 0) tellT = ctx.elapsed - t0;
        if (s === 'rise' && riseT < 0) riseT = ctx.elapsed - t0;
        if (s === 'out') outT = ctx.elapsed - t0;
      }
      const tellSound = H.audio().slice();
      const cool = m.cooldown;
      let callAt = -1, firedAt = -1;
      const t1 = ctx.elapsed;
      for (let i = 0; i < 200; i++) {
        ctx.elapsed += 0.05; ctx.frame++;
        if (firedAt < 0 && ctx.elapsed - t1 >= cool) { m.lastFireT = ctx.elapsed; firedAt = ctx.elapsed - t1; }
        const before = H.audio().length;
        A.hideTick(m, 0.05);
        if (callAt < 0 && H.audio().length > before) callAt = ctx.elapsed - t1;
      }
      out.push({ cfg: cfg.n, d: cfg.d, settled, settleAudio, awaySeen, reason: m.hide.reason,
        tellT: +tellT.toFixed(2), tellSound: tellSound.length, tellName: tellSound[0] ? tellSound[0].name : null,
        tellGain: tellSound[0] ? tellSound[0].gain : null,
        riseT: +riseT.toFixed(2), outT: +outT.toFixed(2), reactT: +m.reactT.toFixed(3),
        firedAt: +firedAt.toFixed(2), callAt: +callAt.toFixed(2), state: m.state,
        firstRound: +(outT + cool).toFixed(2) });
    }
    return out;
  })()`);
  console.log('\n3. IT SPRINGS  (seconds from the moment he stepped into the angle)');
  for (const r of sprung) console.log('   ' + JSON.stringify(r));
  const el = sprung[0], rc = sprung[1], cl = sprung[2];
  ok('settles at 25 m in total silence', sprung.every((r) => r.settled === 'hold' && r.settleAudio === 0), sprung.map((r) => [r.settled, r.settleAudio]));
  ok('its own eyes say the back is turned', sprung.every((r) => r.awaySeen === false));
  ok('springs, on a sensory trigger', sprung.every((r) => r.outT > 0 && (r.reason === 'blind' || r.reason === 'near' || r.reason === 'close')), sprung.map((r) => r.reason));
  ok('no scrape at 9 m', el.tellSound === 0 && rc.tellSound === 0, { elite: el.tellSound, recruit: rc.tellSound });
  ok('ONE scrape at 4.5 m, quiet', cl.tellSound === 1 && cl.tellGain <= 0.30, { n: cl.tellSound, name: cl.tellName, gain: cl.tellGain });
  ok('the scrape comes BEFORE the rise', cl.tellT >= 0 && cl.tellT < cl.riseT, { tell: cl.tellT, rise: cl.riseT });
  ok('the rise takes a real 0.35 s', sprung.every((r) => r.outT - r.riseT >= 0.30), sprung.map((r) => +(r.outT - r.riseT).toFixed(2)));
  ok('elite first round inside 0.75 s', el.firstRound <= 0.75, { t: el.firstRound });
  ok('recruit prepared shot 3x slower', rc.reactT > el.reactT * 3, { elite: el.reactT, recruit: rc.reactT });
  ok('and half a second later on the trigger', rc.firstRound - el.firstRound > 0.35, { elite: el.firstRound, recruit: rc.firstRound });
  ok('react floor honoured', el.reactT >= 0.119, { react: el.reactT });
  console.log('\n4. THE CALL COMES AFTER THE SHOT');
  ok('elite call after the round', el.callAt > el.firedAt, { fired: el.firedAt, call: el.callAt });
  ok('recruit call after the round', rc.callAt > rc.firedAt, { fired: rc.firedAt, call: rc.callAt });
  ok('close-range call after the round too', cl.callAt > cl.firedAt, { fired: cl.firedAt, call: cl.callAt });

  // ---- 5. PATIENCE -----------------------------------------------------------------------------------
  const patience = await api.run(`(() => {
    const ctx = window.__radius.ctx, H = window.__H, A = window.__ambush;
    const rows = [];
    for (const cfg of [{ n: 'recruit', p: 0, planted: false, secs: 90 },
                       { n: 'elite', p: 1, planted: false, secs: 620 },
                       { n: 'planted-recruit', p: 0, planted: true, secs: 200 }]) {
      H.clear();
      H.player({ x: ${site.x} + 300, z: ${site.z} + 300 });       // far away: nothing ever triggers
      const m = H.mimic(${site.x}, ${site.z}, { seed: 0.6 });
      H.skill(m, { patience: cfg.p, springR: 8 });
      A.beginHide(m, ctx, ${site.x} - 20, ${site.z}, { planted: cfg.planted });
      m.hide.state = 'set'; m.hide.hasSpot = true; m.hide.x = m.position.x; m.hide.y = m.position.y; m.hide.z = m.position.z;
      let gaveUp = -1;
      const steps = Math.round(cfg.secs / 0.05);
      for (let i = 0; i < steps; i++) {
        ctx.elapsed += 0.05; ctx.frame++;
        A.hideTick(m, 0.05);
        if (H.state(m) === 'off') { gaveUp = i * 0.05; break; }
      }
      rows.push({ cfg: cfg.n, holdFor: m.hide.holdFor === Infinity ? 'inf' : +m.hide.holdFor.toFixed(0),
        gaveUp: gaveUp < 0 ? null : +gaveUp.toFixed(0), state: H.state(m), held: +m.hide.held.toFixed(0) });
    }
    return rows;
  })()`);
  console.log('\n5. PATIENCE');
  for (const r of patience) console.log('   ' + JSON.stringify(r));
  const pr = patience[0], pe = patience[1], pp = patience[2];
  ok('recruit gives up under 60 s', pr.gaveUp != null && pr.gaveUp <= 60, { at: pr.gaveUp });
  ok('elite still down at 600 s', pe.gaveUp == null && pe.held >= 600, { held: pe.held });
  ok('a planted man never gets bored', pp.gaveUp == null && pp.holdFor === 'inf', { holdFor: pp.holdFor });

  const s = await api.run(`window.__ambush.stats()`);
  console.log('\nMODULE COUNTERS'); say('stats', s);
  ok('zero allocation in the hot paths', s.alloc === 0, { alloc: s.alloc });

  console.log(fails ? `\n${fails} FAILURES` : '\nall assertions passed');
}
