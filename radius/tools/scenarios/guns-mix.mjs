// Level calibration through the REAL output chain. The engine's master bus runs into a lowpass and a
// DynamicsCompressor (threshold -14 dB, ratio 4, attack 4 ms) before the destination, and a gunshot is exactly
// the kind of signal that lives or dies in a compressor's attack window — so measuring the raw layer sum, as
// tools/scenarios/sfx-review.mjs does, does not tell you how loud the shot actually is.
//
// This renders each sound offline through master (at the shipped 0.8 volume) -> lowpass -> compressor, i.e. the
// samples that would leave the sound card, and reports peak and a 300 ms loudness (mean square). Reference
// sounds from other domains are rendered in the same pass so the balance is visible rather than assumed.
//
//   node tools/smoke.mjs --audio --scenario tools/scenarios/guns-mix.mjs --out .smoke/guns-mix --w 320 --h 180
import { OFFLINE } from './guns-lib.mjs';

const GUNS = ['shot_pm', 'shot_pb', 'shot_tt', 'shot_glock', 'shot_m1911', 'shot_aps',
  'shot_kedr', 'shot_bizon', 'shot_vityaz', 'shot_mp5', 'shot_ppsh',
  'shot_akm', 'shot_akms', 'shot_sks', 'shot_ak74m', 'shot_aks74u', 'shot_ak105', 'shot_ak12',
  'shot_m4', 'shot_hk416', 'shot_scar', 'shot_vss', 'shot_val', 'shot_sr3m',
  'shot_toz', 'shot_mp153', 'shot_rem870', 'shot_saiga',
  'shot_mosin', 'shot_obrez', 'shot_svd', 'shot_sv98', 'shot_rpk74', 'shot_pkm',
  'mimic_shot', 'seeker_shot', 'distant_shot', 'bullet_whiz'];
// what a suppressed weapon really sounds like: weapons.js plays it at gain 0.45, rate 0.88
const SUPPRESSED = ['shot_akm', 'shot_ak74m', 'shot_vss', 'shot_pb', 'shot_m4'];
const REF = ['step_grass', 'step_concrete', 'hurt', 'impact_metal', 'impact_dirt', 'reload_magin', 'bolt_open',
  'dry_click', 'ui_click', 'mimic_radio', 'arc_zap', 'fragment_explode', 'crow', 'detector_tick'];

export default async function (page, api) {
  const res = await api.run(`(async () => {
    const GUNS = ${JSON.stringify(GUNS)}, SUP = ${JSON.stringify(SUPPRESSED)}, REF = ${JSON.stringify(REF)};
    const SLOT = 1.5, jobs = [];
    for (const n of GUNS) jobs.push({ name: n, opts: { gain: 1 } });
    for (const n of SUP) jobs.push({ name: n + ' [can]', play: n, opts: { gain: 0.45, rate: 0.88 } });
    for (const n of REF) jobs.push({ name: n, opts: { gain: 1 }, ref: true });
    const TOTAL = 0.5 + jobs.length * SLOT + 1;
    ${OFFLINE}
    // undo the bypass OFFLINE installs: this scenario wants the shipped chain, at the shipped volume
    a.master.disconnect();
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.3;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    a.master.gain.value = 0.8;
    a.master.connect(lp); lp.connect(comp); comp.connect(ac.destination);
    fakeNow = 0.25;
    for (const j of jobs) { j.t0 = fakeNow; a.play(j.play || j.name, j.opts); fakeNow += SLOT; }
    const buf = await ac.startRendering();
    const d = buf.getChannelData(0);
    for (const j of jobs) {
      const s0 = Math.floor(j.t0 * SR), s1 = Math.floor((j.t0 + SLOT) * SR);
      let pk = 0, ip = s0;
      for (let i = s0; i < s1; i++) { const x = Math.abs(d[i]); if (x > pk) { pk = x; ip = i; } }
      let e = 0, n = 0;
      for (let i = s0; i < Math.min(s1, s0 + Math.round(0.3 * SR)); i++) { e += d[i] * d[i]; n++; }
      j.peak = +pk.toFixed(3);
      j.loud = +(10 * Math.log10(e / Math.max(1, n) + 1e-12)).toFixed(1);
      delete j.opts; delete j.t0;
    }
    return { jobs, seconds: +TOTAL.toFixed(1) };
  })()`);
  const w = (s, n) => String(s).padEnd(n);
  const line = (j) => w(j.name, 20) + ' peak ' + w(j.peak, 7) + ' loudness(300ms) ' + w(j.loud + ' dB', 9) + (j.ref ? '   [reference]' : '');
  console.log('through master(0.8) -> lowpass -> compressor, ' + res.seconds + 's rendered');
  console.log(res.jobs.filter((j) => !j.ref).map(line).join('\n'));
  console.log('--- other domains, same chain ---');
  console.log(res.jobs.filter((j) => j.ref).map(line).join('\n'));
  const guns = res.jobs.filter((j) => !j.ref && !/can|distant|whiz/.test(j.name));
  const pk = guns.map((j) => j.peak);
  console.log('gun peaks: min ' + Math.min(...pk) + '  max ' + Math.max(...pk)
    + '  spread ' + (20 * Math.log10(Math.max(...pk) / Math.min(...pk))).toFixed(1) + ' dB');
  const clip = res.jobs.filter((j) => j.peak > 0.99).map((j) => j.name);
  if (clip.length) console.log('CLIPPING ' + JSON.stringify(clip));
}
