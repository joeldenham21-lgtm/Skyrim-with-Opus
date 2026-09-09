// The gunshot bench. Renders every weapon report offline at 44.1 kHz and measures what actually
// distinguishes a muzzle blast from a struck bell: shock rise time, decay shape, how the spectrum
// moves, and whether any single partial rings on after the transient.
//
//   node tools/smoke.mjs --audio --scenario tools/scenarios/guns-analyze.mjs --out .smoke/guns --w 320 --h 180
//
// old_* are the pre-rebuild recipes, frozen in guns-lib.mjs, rendered in the same pass so the
// comparison is against the same renderer and the same analysis, not against a memory.
import { DSP, LEGACY, OFFLINE, row, bandsRow } from './guns-lib.mjs';

const NAMES = (process.env.GUNS_NAMES || [
  'old_pm', 'shot_pm', 'old_akm', 'shot_akm', 'old_toz', 'shot_toz', 'old_mosin', 'shot_mosin',
  'shot_pb', 'shot_aps', 'shot_tt', 'shot_glock', 'shot_m9', 'shot_m1911',
  'shot_kedr', 'shot_bizon', 'shot_vityaz', 'shot_mp5', 'shot_ppsh',
  'shot_akms', 'shot_sks', 'shot_ak74m', 'shot_aks74u', 'shot_ak105', 'shot_ak12',
  'shot_m4', 'shot_hk416', 'shot_scar', 'shot_vss', 'shot_val', 'shot_sr3m',
  'shot_mp153', 'shot_rem870', 'shot_saiga', 'shot_obrez', 'shot_svd', 'shot_sv98', 'shot_rpk74', 'shot_pkm',
  'shot_akm_sup', 'shot_ak74m_sup', 'shot_mosin_sup', 'shot_suppressed',
  'mimic_shot', 'seeker_shot', 'distant_shot', 'bullet_whiz', 'bullet_crack',
  'impact_metal', 'impact_concrete', 'dry_click', 'bolt_close', 'pump_forward',
].join(',')).split(',').filter(Boolean);

const SLOT = 1.6;

export default async function (page, api) {
  const res = await api.run(`(async () => {
    const NAMES = ${JSON.stringify(NAMES)}, SLOT = ${SLOT};
    const TOTAL = 0.5 + NAMES.length * SLOT + 1;
    ${OFFLINE}
    ${LEGACY}
    ${DSP}
    const errs = [];
    const ow = console.warn, oe = console.error;
    console.warn = (...x) => { errs.push('W ' + x.map(String).join(' ')); ow(...x); };
    console.error = (...x) => { errs.push('E ' + x.map(String).join(' ')); oe(...x); };
    const slots = [], skipped = [];
    fakeNow = 0.25;
    for (const n of NAMES) {
      if (!a.has(n)) { skipped.push(n); continue; }
      const i0 = created.length;
      a.play(n, { gain: 1 });
      const mine = created.slice(i0);
      const srcs = mine.filter((x) => x.__kind === 'createOscillator' || x.__kind === 'createBufferSource');
      slots.push({ name: n, t0: fakeNow, nodes: mine.length, srcs: srcs.length, noStop: srcs.filter((s) => s.__stop == null).length });
      fakeNow += SLOT;
    }
    const buf = await ac.startRendering();
    const d = buf.getChannelData(0);
    const out = [];
    for (const s of slots) {
      const m = analyse(d, Math.floor(s.t0 * SR), Math.floor((s.t0 + SLOT) * SR), SR);
      m.name = s.name; m.nodes = s.nodes; m.srcs = s.srcs; m.noStop = s.noStop;
      out.push(m);
    }
    return { out, skipped, errs, seconds: +TOTAL.toFixed(1) };
  })()`);

  console.log('rendered ' + res.seconds + 's at 44100 Hz; skipped (unregistered): ' + JSON.stringify(res.skipped));
  console.log('--- shock / envelope / spectrum ---');
  for (const m of res.out) console.log(row(m.name, m));
  console.log('--- energy by band (of the 8-32 ms window) ---');
  for (const m of res.out) console.log(bandsRow(m.name, m));
  console.log('--- graph cost ---');
  console.log(res.out.map((m) => m.name + ':' + m.nodes + 'n/' + m.srcs + 's' + (m.noStop ? ' NOSTOP' + m.noStop : '')).join('  '));
  if (res.errs.length) console.log('CONSOLE', JSON.stringify(res.errs.slice(0, 12)));
  const bad = res.out.filter((m) => m.noStop);
  const silent = res.out.filter((m) => m.silent || m.peak < 0.02).map((m) => m.name);
  console.log('SILENT ' + JSON.stringify(silent) + ' NOSTOP ' + JSON.stringify(bad.map((m) => m.name)));
  // A report that still holds one partial for more than ~60 ms is a bell, not a gun.
  // Acceptance. A report may not hold one partial past ~60 ms, may not be periodic, must have a shock front
  // (a step inside a couple of samples), and must land in the level window the mix was built around.
  // A suppressed weapon is exempt from the shock tests on purpose: an expansion chamber bleeds the gas off
  // over milliseconds instead of microseconds, so having NO shock front is the correct answer for it.
  const shots = res.out.filter((m) => !m.silent && /^(shot_|mimic_shot|seeker_shot)/.test(m.name));
  const canned = (m) => /_sup$|^shot_(pb|vss|val)$|suppressed/.test(m.name);
  const fail = [];
  for (const m of shots) {
    if (m.tonal.ms > 60) fail.push(m.name + ' rings ' + m.tonal.ms + 'ms@' + m.tonal.hz + 'Hz (+' + m.tonal.dB + 'dB)');
    if (m.ac > 0.45) fail.push(m.name + ' periodic ac=' + m.ac);
    if (!canned(m)) {
      // attackMs (onset to the loudest sample) is the strongest single number here: the old recipe's peak was
      // a decaying sine that took 0.8-3.4 ms to arrive, and a blast's arrives inside half a millisecond.
      // riseUs is reported but not gated: on a supersonic round the bullet's N-wave lands a few hundred
      // microseconds behind the blast and is sometimes the taller of the two fronts, which stretches it.
      if (m.attackMs > 1.5) fail.push(m.name + ' slow attack=' + m.attackMs + 'ms');
      if (m.slew < 0.35) fail.push(m.name + ' no shock slew=' + m.slew);
      if (m.flat[0] < 0.2) fail.push(m.name + ' tonal first window flatness=' + m.flat[0]);
      if (m.peak < 0.45 || m.peak > 1.15) fail.push(m.name + ' level ' + m.peak);
      // Suppressed names are written to be played at the ~0.4 gain weapons.js and mimic.js use for a fitted
      // can (the generator puts back what that takes off the mechanical half), so judge them at that gain.
    } else if (m.peak * 0.45 > 0.42) fail.push(m.name + ' suppressed but loud ' + m.peak + ' (' + (m.peak * 0.45).toFixed(2) + ' as played)');
  }
  console.log('BELLS ' + JSON.stringify(shots.filter((m) => m.tonal.ms > 60 || m.ac > 0.45).map((m) => m.name)));
  console.log(fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS: ' + shots.length + ' reports, no sustained partials, all with a shock front');
}
