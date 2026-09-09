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
  'shot_tt', 'shot_glock', 'shot_aps', 'shot_kedr', 'shot_mp5', 'shot_ppsh',
  'shot_ak74m', 'shot_aks74u', 'shot_m4', 'shot_sks', 'shot_vss', 'shot_pb', 'shot_val',
  'shot_svd', 'shot_sv98', 'shot_obrez', 'shot_pkm', 'shot_rpk74', 'shot_saiga', 'shot_rem870',
  'shot_akm_sup', 'shot_ak74m_sup', 'shot_suppressed',
  'mimic_shot', 'seeker_shot', 'distant_shot', 'bullet_whiz', 'bullet_crack', 'impact_metal', 'impact_concrete',
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
  const bells = res.out.filter((m) => !m.silent && /^(shot_|mimic_shot|seeker_shot)/.test(m.name) && (m.tonal.ms > 60 || m.ac > 0.45))
    .map((m) => m.name + ':' + m.tonal.ms + 'ms@' + m.tonal.hz + 'Hz ac' + m.ac);
  console.log('BELLS ' + JSON.stringify(bells));
}
