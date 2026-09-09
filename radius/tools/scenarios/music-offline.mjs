// Renders the score's voices through their real graphs in an OfflineAudioContext at 44.1 kHz and
// hands the samples back to node for analysis. Offline rendering runs far faster than real time and
// does not care that SwiftShader has eaten the machine, which is the only way to measure a 3 ms
// pluck transient on this harness.
//
//   node tools/smoke.mjs --audio --scenario tools/scenarios/music-offline.mjs --out .smoke/music-offline
//
// Writes <out>/*.wav (16-bit) so the renders can be inspected later, and prints per-render analysis:
// attack to peak, T60, decay slope, spectral centroid at 30 ms vs 1.2 s, tonal fraction, partial
// amplitudes and inharmonicity in cents.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyse, envelope, spectrum, centroid } from './music-analysis.mjs';

const wav = (data, sr) => {
  const n = data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  return buf;
};

export default async function (page, api) {
  // No api.start(): rendering is independent of the render loop, which under SwiftShader may be
  // taking tens of seconds a frame while other agents hammer the same four cores.
  await api.wait(600);

  // The renderer that runs inside the page: builds the requested rig into an OfflineAudioContext,
  // schedules a score, renders, and returns the mono mixdown as base64 int16.
  await api.run(`window.__render = async (spec) => {
    const T = window.__radius.ctx.music.__test;
    const sr = 44100, len = Math.ceil(sr * spec.seconds);
    const oc = new OfflineAudioContext(2, len, sr);
    const dest = oc.createGain(); dest.gain.value = 1; dest.connect(oc.destination);
    const t0 = 0.05;
    const info = {};
    if (spec.kind === 'pluck' || spec.kind === 'phrase' || spec.kind === 'mix') {
      const g = T.buildGuitar(oc, dest, { gain: spec.guitarGain ?? 1, verb: spec.verb ?? 0.30 });
      info.guitar = true;
      if (spec.kind === 'pluck') {
        g.pluck(t0, spec.string ?? 0, spec.midi ?? 38, spec.vel ?? 0.85, { noise: spec.noise ?? 1 });
      } else {
        // a real fingerpicked phrase: progression, pattern, alternating bass, rubato
        const prog = spec.prog || ['Dm', 'Dm', 'Bb', 'Bb', 'C', 'C', 'Dm', 'Dm'];
        const pat = spec.pat || [0, 4, 3, 5, 4, 3, null, 4];
        const bpm = spec.bpm ?? 56, beat = 60 / bpm, slot = beat / 2;
        let t = t0, notes = 0;
        for (let bar = 0; bar < (spec.bars ?? 4); bar++) {
          const v = T.voicing(prog[bar % prog.length]);
          for (let s = 0; s < 8; s++) {
            const p = pat[s];
            if (p !== null) {
              let n;
              if (p === -1) n = v[Math.min(1, v.length - 1)];
              else if (p === 0) n = v[0];
              else n = v[Math.min(v.length - 1, p - (6 - v.length))] || v[v.length - 1];
              const acc = s === 0 ? 1 : s === 4 ? 0.82 : 0.66;
              g.pluck(t, n.si, n.midi, acc * (spec.vel ?? 0.9));
              notes++;
            }
            if (s === 0 && bar > 0) g.squeak(t - 0.16, 0.5);
            t += slot;
          }
        }
        info.notes = notes;
      }
      info.renders = g.renders; info.cached = g.cached;
    }
    if (spec.kind === 'combat' || spec.kind === 'mix') {
      const c = T.buildCombat(oc, dest, { gain: spec.combatGain ?? 1 });
      c.start(0);
      if (spec.stinger) { c.attack(t0); c.lowHit(t0, 1.1); c.scrape(t0, 0.9); }
      else c.setIntensity(0, spec.intensity ?? 0.9, 0.05);
      const bpm = spec.cbpm ?? 138, step = 60 / bpm / 4;
      const ost = [1, 0, 0, 0.5, 0.8, 0, 0.45, 0, 1, 0, 0, 0.5, 0.75, 0.45, 0, 0.35];
      let t = t0 + (spec.stinger ? 0.28 : 0);
      for (let i = 0; t < spec.seconds - 0.4; i++) {
        if (i % 16 === 0 && i > 0) c.lowHit(t, 0.9);
        const v = ost[i % 16];
        if (v > 0) c.pizz(t, 38, v * 0.9);
        t += step;
      }
      if (spec.rattle) { c.rattle(t0 + 1.4, 0.8); c.scrape(t0 + 2.6, 0.7); }
      info.combat = true;
    }
    if (spec.kind === 'harmonic') {
      const g = T.buildGuitar(oc, dest, { gain: 1, verb: 0.3 });
      g.harmonic(t0, 4, 62, 2, 0.7);
    }
    if (spec.kind === 'squeak') { const g = T.buildGuitar(oc, dest, { gain: 1, verb: 0.3 }); g.squeak(t0, 1); }
    if (spec.kind === 'reverb') {
      const rv = T.buildReverb(oc, { rt: 2.7, damp: 2600, gain: 0.9 });
      rv.output.connect(dest);
      const s = oc.createBufferSource();
      const b = oc.createBuffer(1, 64, sr); const d = b.getChannelData(0); d[0] = 1;
      s.buffer = b; s.connect(rv.input); s.start(t0);
    }
    const rendered = await oc.startRendering();
    const L = rendered.getChannelData(0), R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
    const mono = new Float32Array(len);
    let peak = 0, sum = 0, nonFinite = 0;
    for (let i = 0; i < len; i++) {
      const v = (L[i] + R[i]) * 0.5;
      if (!Number.isFinite(v)) { nonFinite++; mono[i] = 0; continue; }
      mono[i] = v; const m = v < 0 ? -v : v; if (m > peak) peak = m; sum += v * v;
    }
    // int16 -> base64: a 6 s render is 264k floats, and JSON of that costs more than the render
    const i16 = new Int16Array(len);
    for (let i = 0; i < len; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767)));
    const bytes = new Uint8Array(i16.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return { b64: btoa(bin), sr, peak, rms: Math.sqrt(sum / len), nonFinite, info,
             stereoDiff: (() => { let d = 0; for (let i = 0; i < len; i += 7) d += Math.abs(L[i] - R[i]); return d / (len / 7); })() };
  };`);

  const runs = [
    { name: 'pluck-lowD-open', spec: { kind: 'pluck', seconds: 5.0, string: 0, midi: 38, vel: 0.9 }, f0: 73.42 },
    { name: 'pluck-A2', spec: { kind: 'pluck', seconds: 5.0, string: 1, midi: 45, vel: 0.9 }, f0: 110 },
    { name: 'pluck-D4', spec: { kind: 'pluck', seconds: 4.0, string: 4, midi: 62, vel: 0.9 }, f0: 293.66 },
    { name: 'pluck-soft-D4', spec: { kind: 'pluck', seconds: 4.0, string: 4, midi: 62, vel: 0.30 }, f0: 293.66 },
    { name: 'harmonic-D5', spec: { kind: 'harmonic', seconds: 4.0 }, f0: 587.33 },
    { name: 'squeak', spec: { kind: 'squeak', seconds: 1.2 }, f0: 0 },
    { name: 'reverb-ir', spec: { kind: 'reverb', seconds: 4.0 }, f0: 0 },
    { name: 'phrase-Dm', spec: { kind: 'phrase', seconds: 22, bars: 4, bpm: 56 }, f0: 0 },
    { name: 'phrase-thin', spec: { kind: 'phrase', seconds: 20, bars: 4, bpm: 50, pat: [0, null, null, null, null, null, 4, null], vel: 0.6 }, f0: 0 },
    { name: 'combat-bar', spec: { kind: 'combat', seconds: 8, intensity: 0.9, rattle: true }, f0: 0 },
    { name: 'combat-stinger', spec: { kind: 'combat', seconds: 8, stinger: true }, f0: 0 },
    { name: 'mix-guitar+combat', spec: { kind: 'mix', seconds: 10, bars: 2, guitarGain: 0.5, combatGain: 0.62, intensity: 0.8 }, f0: 0 },
  ];

  for (const r of runs) {
    const t0 = Date.now();
    const res = await page.evaluate((s) => window.__render(s), r.spec);
    const raw = Buffer.from(res.b64, 'base64');
    const i16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    const f = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32767;
    writeFileSync(resolve(api.outDir, r.name + '.wav'), wav(f, res.sr));
    const a = analyse(f, r.f0, res.sr, r.name);
    console.log('--- ' + r.name + '  (' + (Date.now() - t0) + ' ms, ' + r.spec.seconds + ' s)');
    console.log('    ' + JSON.stringify({
      peak: +res.peak.toFixed(4), rms: +res.rms.toFixed(5), nonFinite: res.nonFinite,
      stereoDiff: +res.stereoDiff.toFixed(4), info: res.info,
      attackMs: a.attackMs, fineAttackMs: a.fineAttackMs, t60: a.t60, dbps: a.decayDbPerSec,
      cen30: a.centroid30ms, cen1200: a.centroid1200ms, tonal: a.tonalFrac, beat: a.beatDepth,
    }));
    if (r.f0) { console.log('    partials dB: ' + a.partials.join(' ')); console.log('    inharm cents: ' + a.inharm.slice(0, 9).join(' ')); }
    console.log('    env: ' + a.env.join(' '));
    console.log('    centroid over time: ' + a.centroidTrack.join(' '));
  }
}
