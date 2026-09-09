// Signal analysis for the music renders. Node-side, no browser: music-offline.mjs hands it the
// samples an OfflineAudioContext produced and this decides whether they are a guitar or a cowbell.
//
// What each number is for:
//   fineAttackMs   sample index of the absolute peak inside the first 60 ms. A pluck is < 5 ms; a
//                  bow is 200-500 ms; anything with a 30 ms attack is a mallet, not a string.
//   t60/decayDbPerSec  how the note dies. A real string decays roughly exponentially in dB.
//   centroid30ms vs centroid1200ms  a struck/plucked string loses its high partials first, so the
//                  centroid must FALL over the note. A centroid that stays put is a synth pad.
//   tonalFrac      fraction of spectral energy within +/-2 bins of the first 14 harmonics of f0.
//                  Near 1 = a pitched string; near 0 = noise.
//   inharm         cents each partial sits above k*f0 (parabolic peak interpolation: 5.4 Hz bins are
//                  60 cents at 150 Hz, so raw bin indices tell you nothing).
//   beatDepth      envelope modulation after detrending: the two polarisations of a real string beat
//                  gently (0.05-0.25). A deep, regular one is a tremolo, which is wrong.
//   sustainedPartial  the loudest partial still standing at the end relative to its start: catches a
//                  ringing pitch left behind by a filter that should have decayed.

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

export function spectrum(buf, start, N = 8192, sr = 44100) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (buf[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  fft(re, im);
  const half = N >> 1, mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]) / half;
  return { mag, binHz: sr / N };
}

export function centroid(mag, binHz, lo = 40, hi = 12000) {
  let num = 0, den = 0;
  for (let i = 1; i < mag.length; i++) { const f = i * binHz; if (f < lo) continue; if (f > hi) break; num += f * mag[i]; den += mag[i]; }
  return den > 0 ? num / den : 0;
}

// RMS envelope in 5 ms hops over a window of at least four periods of f0. A peak detector over a
// window shorter than one cycle reports the waveform, not the envelope: at 73 Hz a 5 ms window sees
// 37 % of a period and "beats" at a third of the fundamental. That artifact is not the string.
export function envelope(buf, sr = 44100, f0 = 200, hop = 0.005) {
  const h = Math.max(1, Math.floor(sr * hop));
  const win = Math.max(h, Math.ceil((sr / Math.max(20, f0)) * 4));
  const out = [];
  for (let i = 0; i + win <= buf.length; i += h) {
    let s = 0;
    for (let k = 0; k < win; k++) s += buf[i + k] * buf[i + k];
    out.push(Math.sqrt(s / win) * Math.SQRT2);
  }
  return out;
}

function partialsAt(buf, start, f0, sr, N = 8192, count = 14) {
  const s = spectrum(buf, start, N, sr);
  const parts = [];
  let ref = 0;
  for (let k = 1; k <= count; k++) {
    const target = f0 * k;
    if (target > sr * 0.45) break;
    const b0 = Math.max(1, Math.floor((target - Math.max(18, target * 0.03)) / s.binHz));
    const b1 = Math.ceil((target + Math.max(18, target * 0.03)) / s.binHz);
    let best = 0, bi = b0;
    for (let b = b0; b <= b1 && b < s.mag.length; b++) if (s.mag[b] > best) { best = s.mag[b]; bi = b; }
    const a1 = s.mag[bi - 1] || 1e-12, a2 = s.mag[bi] || 1e-12, a3 = s.mag[bi + 1] || 1e-12;
    const d = (0.5 * (a1 - a3)) / (a1 - 2 * a2 + a3 || 1e-12);
    const fEst = (bi + (Math.abs(d) < 1 ? d : 0)) * s.binHz;
    if (k === 1) ref = best;
    parts.push({ k, f: fEst, amp: best, db: +(20 * Math.log10(best / (ref || 1e-12))).toFixed(1), ratio: fEst / target });
  }
  return { parts, s };
}

export function analyse(buf, f0, sr = 44100, label = '') {
  const env = envelope(buf, sr, f0 || 200);
  let peak = 0, pi = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > peak) { peak = env[i]; pi = i; }
  // absolute-peak attack, sample resolution, over the first 600 ms
  let apk = 0, ai = 0;
  const lim = Math.min(buf.length, Math.floor(sr * 0.6));
  for (let i = 0; i < lim; i++) { const m = Math.abs(buf[i]); if (m > apk) { apk = m; ai = i; } }
  let onset = 0;
  for (let i = 0; i < lim; i++) if (Math.abs(buf[i]) > apk * 0.02) { onset = i; break; }

  const start = pi + 4;
  let t60 = null;
  for (let i = start; i < env.length; i++) if (env[i] <= peak * 0.001) { t60 = (i - pi) * 0.005; break; }
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = start; i < Math.min(env.length, start + 300); i++) {
    if (env[i] < peak * 1e-4) break;
    const x = i * 0.005, y = 20 * Math.log10(env[i] / peak);
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const slope = n > 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;

  const s1 = spectrum(buf, Math.floor(sr * 0.03), 8192, sr);
  const late = Math.max(0, Math.min(buf.length - 8192, Math.floor(sr * 1.2)));
  const s2 = spectrum(buf, late, 8192, sr);

  let parts = [], inharm = [], partDb = [], sustained = 0;
  if (f0) {
    const a = partialsAt(buf, Math.floor(sr * 0.03), f0, sr);
    parts = a.parts;
    partDb = parts.map((p) => p.db);
    inharm = parts.slice(1).map((p) => +(1200 * Math.log2(p.ratio)).toFixed(1));
    const b = partialsAt(buf, late, f0, sr);
    for (let i = 0; i < Math.min(parts.length, b.parts.length); i++) {
      const r = b.parts[i].amp / Math.max(1e-12, parts[i].amp);
      if (r > sustained) sustained = r;
    }
  }

  let tonal = 0, total = 0;
  for (let i = 1; i < s1.mag.length; i++) { const f = i * s1.binHz; if (f > 12000) break; total += s1.mag[i] * s1.mag[i]; }
  for (const p of parts) { const b = Math.round(p.f / s1.binHz); for (let d = -2; d <= 2; d++) { const bb = b + d; if (bb > 0 && bb < s1.mag.length) tonal += s1.mag[bb] * s1.mag[bb]; } }

  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);

  // spectral centroid every 100 ms for the first 2 s
  const track = [];
  for (let t = 0; t < 2.0; t += 0.1) {
    const st = Math.floor(sr * t);
    if (st + 4096 > buf.length) break;
    const sp = spectrum(buf, st, 4096, sr);
    track.push(Math.round(centroid(sp.mag, sp.binHz)));
  }

  const beatDepth = (() => {
    const a = Math.max(0, pi + 60), b2 = Math.min(env.length, pi + 300);
    if (b2 - a < 40) return 0;
    const seg = [];
    for (let i = a; i < b2; i++) seg.push(env[i]);
    const sm = seg.map((v, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 12); k < Math.min(seg.length, i + 13); k++) { s += seg[k]; c++; } return s / c; });
    let lo = Infinity, hi = 0;
    for (let i = 0; i < seg.length; i++) { const r = seg[i] / Math.max(1e-9, sm[i]); if (r < lo) lo = r; if (r > hi) hi = r; }
    return +(1 - lo / Math.max(1e-9, hi)).toFixed(3);
  })();

  return {
    label,
    peak: +peak.toFixed(4), absPeak: +apk.toFixed(4), rms: +rms.toFixed(5),
    crest: +(20 * Math.log10(apk / Math.max(1e-9, rms))).toFixed(1),
    attackMs: +(pi * 5).toFixed(1),
    fineAttackMs: +(((ai - onset) / sr) * 1000).toFixed(2),
    t60: t60 === null ? '>' + (buf.length / sr).toFixed(2) : +t60.toFixed(2),
    decayDbPerSec: +slope.toFixed(1),
    centroid30ms: Math.round(centroid(s1.mag, s1.binHz)),
    centroid1200ms: Math.round(centroid(s2.mag, s2.binHz)),
    tonalFrac: +(tonal / Math.max(1e-12, total)).toFixed(3),
    sustainedPartial: +sustained.toFixed(3),
    beatDepth,
    partials: partDb,
    inharm,
    centroidTrack: track,
    env: env.filter((_, i) => i % 20 === 0).slice(0, 30).map((v) => +(v / Math.max(1e-9, peak)).toFixed(3)),
  };
}
