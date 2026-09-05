// sfx review: renders every canonical sound in isolation through an OfflineAudioContext (the engine is pointed at it
// before ensure()), measures peak / rms / length per sound, checks every source has a scheduled stop, that loops tear
// down every node, and that opts.rate shortens/lengthens the schedule. Nothing depends on the software renderer.
// node tools/smoke.mjs --out .smoke/sfx-review --scenario tools/scenarios/sfx-review.mjs --w 320 --h 180
import { ONE_SHOTS, LOOPS } from './sfx-all.mjs';

const LONG = { death: 3.6, tide_chord: 6.6, sleep: 2.6, seeker_death: 3.2, mimic_death: 1.8, distant_shot: 3.0, door_open: 1.8, door_close: 1.8,
  fragment_approach: 2.0, gravity_crush: 2.0, seeker_spot: 1.8, siren: 2.4, tide_warn: 2.0, crow: 1.8, artifact_pickup: 1.8, mimic_radio: 1.6,
  spawn_skitter: 1.4, spawn_death: 1.2, slider_death: 1.4, slider_screech: 1.2, shot_mosin: 1.6, shot_toz: 1.4, shot_akm: 1.3, seeker_shot: 1.4,
  fragment_explode: 1.6, bandage_use: 1.4, medkit_use: 1.0, seeker_step: 1.0, mimic_spot: 1.2, arc_zap: 0.9, impact_glass: 0.6 };

export default async function (page, api) {
  const res = await api.run(`(async () => {
    const ONE = ${JSON.stringify(ONE_SHOTS)}, LOOPS = ${JSON.stringify([...LOOPS, 'heartbeat', 'breath'])}, LONG = ${JSON.stringify(LONG)};
    const r = window.__radius, a = r.ctx.audio;
    const SR = 48000; let total = 0.5; for (const n of ONE) total += (LONG[n] || 1.0) + 0.1; total += LOOPS.length * 1.3 + 1;
    let fakeNow = 0; const created = []; let ac = null;
    window.AudioContext = function () {
      const c = new OfflineAudioContext(1, Math.ceil(SR * total), SR);
      Object.defineProperty(c, 'currentTime', { get: () => fakeNow });
      Object.defineProperty(c, 'state', { get: () => 'running' });
      for (const m of ['createOscillator', 'createBufferSource', 'createGain', 'createBiquadFilter', 'createWaveShaper', 'createDelay', 'createPanner']) {
        const orig = c[m].bind(c);
        c[m] = (...args) => { const n = orig(...args); n.__kind = m; n.__stop = null; n.__disc = false; n.__at = fakeNow;
          if (n.stop) { const st = n.stop.bind(n); n.stop = (w) => { n.__stop = (w == null ? fakeNow : w); return st(w); }; }
          const dc = n.disconnect.bind(n); n.disconnect = (...x) => { n.__disc = true; return dc(...x); };
          created.push(n); return n; };
      }
      return c;
    };
    a.ensure(); ac = a.ctx;
    a.master.disconnect(); a.master.connect(ac.destination); a.master.gain.value = 1;   // raw layer sum, no compressor
    const plays = [], errs = [];
    const origErr = console.error; console.error = (...x) => { errs.push(x.map(String).join(' ')); origErr(...x); };
    const origWarn = console.warn; console.warn = (...x) => { errs.push('W ' + x.map(String).join(' ')); origWarn(...x); };
    const isSrc = (n) => n.__kind === 'createOscillator' || n.__kind === 'createBufferSource';
    // ---- one-shots, isolated in time
    fakeNow = 0.2;
    for (const n of ONE) {
      const slot = (LONG[n] || 1.0) + 0.1, i0 = created.length;
      const h = a.play(n, { gain: 1 });
      const mine = created.slice(i0);
      const srcs = mine.filter(isSrc);
      const sched = srcs.length ? Math.max(...srcs.map((s) => s.__stop == null ? Infinity : s.__stop)) - fakeNow : 0;
      plays.push({ name: n, t0: fakeNow, slot, nodes: mine.length, srcs: srcs.length, noStop: srcs.filter((s) => s.__stop == null).length, sched, null: !h });
      fakeNow += slot;
    }
    // ---- loops: 1.0 s each, then muted through the engine handle; torn down after rendering
    const loopInfo = [], loopHandles = [];
    for (const n of LOOPS) {
      const i0 = created.length, t0 = fakeNow;
      const h = a.loop(n, { gain: 1 });
      if (!h) { loopInfo.push({ name: n, null: true }); fakeNow += 1.3; continue; }
      const mine = created.slice(i0);            // the loop's own graph; nodes made later by tick() are one-shots with scheduled stops
      for (const k of ['level', 'rate', 'gust', 'intensity', 'near', 'pulse']) h.set(k, 0.7);
      h.set('rate', 1.6);
      for (let i = 0; i < 8; i++) { fakeNow += 0.125; a.update(0.125); }
      h.setGain(0, 0.01); h.update = () => {};   // stop ticking so later windows are not attributed its crackles
      fakeNow += 0.3;
      loopInfo.push({ name: n, t0, mine, nodes: mine.length });
      loopHandles.push(h);
    }
    // ---- rate scaling: scheduled length only (beyond the render window, never rendered)
    const rateInfo = {};
    fakeNow = total + 50;
    for (const n of ['step_mud', 'shot_akm', 'mimic_radio', 'slider_screech', 'door_open', 'spawn_skitter', 'crow']) {
      const out = {};
      for (const rate of [0.6, 1, 1.8]) { const i0 = created.length; a.play(n, { gain: 1, rate }); const s = created.slice(i0).filter(isSrc); out[rate] = +(Math.max(...s.map((x) => x.__stop)) - fakeNow).toFixed(3); fakeNow += 20; }
      rateInfo[n] = out;
    }
    // undefined / odd opts must not throw
    const odd = [];
    // (opts === null throws inside engine.play itself: the opts = {} default does not cover null, so it is not in this list)
    for (const o of [undefined, {}, { rate: 0 }, { rate: NaN }, { rate: 'x' }, { rate: 99 }, { gain: 0 }, { variant: 'crate' }, { variant: 7 }, { variant: 'mud' }, { variant: 'metal' }, { variant: 'wood' }]) { try { a.play('container_open', o); a.play('step_grass', o); a.play('probe_land', o); } catch (e) { odd.push(String(e)); } }
    fakeNow += 20;
    const nOneShotSrcs = created.filter(isSrc).length;
    // ---- render
    const buf = await ac.startRendering();
    const d = buf.getChannelData(0), TH = 0.003;
    const table = [];
    for (const p of plays) {
      const s0 = Math.floor(p.t0 * SR), s1 = Math.min(d.length, Math.floor((p.t0 + p.slot) * SR));
      let peak = 0, sum = 0, first = -1, last = -1, tailPeak = 0;
      for (let i = s0; i < s1; i++) { const x = Math.abs(d[i]); if (x > peak) peak = x; sum += x * x; if (x > TH) { if (first < 0) first = i; last = i; } if (i > s1 - SR * 0.08 && x > tailPeak) tailPeak = x; }
      const n = Math.max(1, last - first);
      let sum2 = 0; for (let i = Math.max(s0, first); i <= last; i++) sum2 += d[i] * d[i];
      table.push({ name: p.name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum2 / n).toFixed(3), on: first < 0 ? null : +((first - s0) / SR).toFixed(3), len: last < 0 ? 0 : +((last - s0) / SR).toFixed(2), sched: +p.sched.toFixed(2), slot: p.slot, bleed: +tailPeak.toFixed(3), nodes: p.nodes, srcs: p.srcs, noStop: p.noStop, nul: p.null });
    }
    const loops = [];
    for (const L of loopInfo) {
      if (L.null) { loops.push(L); continue; }
      const s0 = Math.floor((L.t0 + 0.3) * SR), s1 = Math.floor((L.t0 + 1.0) * SR);
      let peak = 0, sum = 0; for (let i = s0; i < s1; i++) { const x = Math.abs(d[i]); if (x > peak) peak = x; sum += x * x; }
      loops.push({ name: L.name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / (s1 - s0)).toFixed(3), nodes: L.nodes });
    }
    // ---- loop teardown: stop every handle, then check every node created for it was stopped/disconnected
    for (const h of loopHandles) h.stop(0);
    await new Promise((res) => setTimeout(res, 400));
    for (let i = 0; i < loopInfo.length; i++) {
      const L = loopInfo[i]; if (L.null) continue;
      const left = L.mine.filter((n) => !n.__disc);
      loops[i].notDisconnected = left.map((n) => n.__kind);
      loops[i].srcNotStopped = L.mine.filter((n) => isSrc(n) && n.__stop == null).length;
    }
    return { table, loops, rateInfo, odd, errs, missing: [...a.missing], nodesTotal: created.length, srcTotal: nOneShotSrcs, seconds: +total.toFixed(1) };
  })()`);
  const t = res.table;
  const fmt = (x) => x.name.padEnd(18) + ' peak ' + String(x.peak).padEnd(6) + ' rms ' + String(x.rms).padEnd(6) + ' len ' + String(x.len).padEnd(5) + ' sched ' + String(x.sched).padEnd(5) + ' slot ' + String(x.slot).padEnd(4) + ' bleed ' + String(x.bleed).padEnd(6) + ' nodes ' + String(x.nodes).padEnd(4) + ' srcs ' + x.srcs + (x.noStop ? ' NOSTOP ' + x.noStop : '') + (x.nul ? ' NULL' : '');
  console.log('ONE-SHOTS by peak:\n' + [...t].sort((p, q) => q.peak - p.peak).map(fmt).join('\n'));
  console.log('LOOPS:\n' + res.loops.map((l) => JSON.stringify(l)).join('\n'));
  console.log('RATE sched lengths:', JSON.stringify(res.rateInfo));
  console.log('odd opts errors:', JSON.stringify(res.odd), 'console errs/warns:', JSON.stringify(res.errs), 'missing:', JSON.stringify(res.missing), 'nodes', res.nodesTotal, 'srcs', res.srcTotal, 'rendered s', res.seconds);
  const silent = t.filter((x) => x.peak < 0.02).map((x) => x.name);
  const noStop = t.filter((x) => x.noStop).map((x) => x.name);
  const bleed = t.filter((x) => x.bleed > 0.01).map((x) => x.name + ':' + x.bleed);
  const hot = t.filter((x) => x.peak > 1.6).map((x) => x.name + ':' + x.peak);
  const leaks = res.loops.filter((l) => (l.notDisconnected && l.notDisconnected.length) || l.srcNotStopped).map((l) => l.name);
  console.log('SILENT', JSON.stringify(silent), 'NOSTOP', JSON.stringify(noStop), 'BLEED', JSON.stringify(bleed), 'HOT', JSON.stringify(hot), 'LOOP LEAKS', JSON.stringify(leaks));
  if (silent.length || noStop.length || leaks.length || res.odd.length || res.missing.length) throw new Error('sfx review failed: silent=' + silent + ' noStop=' + noStop + ' leaks=' + leaks + ' odd=' + res.odd + ' missing=' + res.missing);
}
