// Offline gunshot analysis: the instrument. Everything here is a STRING of page-side JS, injected into
// tools/smoke.mjs scenarios so several guns-*.mjs runs share one implementation.
//
// Why offline: under SwiftShader the audio thread starves and a live ScriptProcessor tap drops whole
// buffers, so a 200 us transient can read as silence. An OfflineAudioContext renders the exact sample
// stream the engine would produce, far faster than real time, and does not care that the GPU is busy.
//
// What it measures, and why each number tells a gunshot from a cowbell:
//   riseUs      microseconds from 10 % to 90 % of peak. A muzzle blast shock is tens of microseconds;
//               an oscillator through an 'attack' ramp cannot go below the ramp.
//   dec20/40/60 ms from the peak down to -20/-40/-60 dB (last block above the threshold). Shape, not just length.
//   cent[]      spectral centroid in five windows after onset (0-8, 8-32, 32-96, 96-300, 300-900 ms).
//               A real report starts bright (broadband shock) and gets dark fast (the tail is the room).
//   flat[]      spectral flatness (geometric/arithmetic mean of the power spectrum) in the same windows.
//               Noise ~0.2-0.6. A sine ~0.001. This is the single clearest cowbell detector.
//   tonal       the longest run of consecutive STFT frames holding ONE spectral peak at a stable frequency
//               with a high peak-to-median ratio: {ms, hz, dB, bwHz}. A struck bell rings for 100-400 ms
//               at one frequency with 25-35 dB of peak prominence and a bandwidth under ~30 Hz.
//               A gunshot has no such run at all.
//   ac          max normalised autocorrelation over lags 50 Hz-2 kHz in the 25-125 ms window: periodicity.
//               Pitched -> 0.5-0.95. Broadband blast/tail -> under ~0.25.
//   bands[]     fraction of energy in 20-150 / 150-400 / 400-1200 / 1200-3500 / 3500-9000 / 9000+ Hz.

export const DSP = `
  const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + half] * cr - im[i + k + half] * ci;
          const bi = re[i + k + half] * ci + im[i + k + half] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + half] = ar - br; im[i + k + half] = ai - bi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }
  // magnitude spectrum of d[start..start+len) zero-padded to a power of two, Hann windowed
  function mag(d, start, len, N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < len; i++) {
      const x = d[start + i] || 0;
      re[i] = x * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, len - 1)));
    }
    fft(re, im);
    const H = N >> 1, m = new Float64Array(H);
    for (let k = 0; k < H; k++) m[k] = Math.hypot(re[k], im[k]);
    return m;
  }
  // Centroid over 40 Hz-16 kHz; flatness over 100 Hz-8 kHz with every bin floored 80 dB under the
  // frame's own peak, so an empty top octave cannot drag the geometric mean to zero and make
  // everything look tonal.
  function centroidFlat(m, SR, N) {
    const df = SR / N, k0 = Math.max(1, Math.round(40 / df)), k1 = Math.min(m.length - 1, Math.round(16000 / df));
    let sw = 0, s = 0;
    for (let k = k0; k <= k1; k++) { sw += k * df * m[k]; s += m[k]; }
    const j0 = Math.max(1, Math.round(100 / df)), j1 = Math.min(m.length - 1, Math.round(8000 / df));
    let mx = 0; for (let k = j0; k <= j1; k++) if (m[k] > mx) mx = m[k];
    const floor = (mx * 1e-4) * (mx * 1e-4) + 1e-30;
    let lg = 0, ar = 0, n = 0;
    for (let k = j0; k <= j1; k++) { const p = Math.max(floor, m[k] * m[k]); lg += Math.log(p); ar += p; n++; }
    return { cent: s > 1e-12 ? sw / s : 0, flat: n ? Math.exp(lg / n) / (ar / n) : 0 };
  }
  function bandFractions(m, SR, N) {
    const edges = [20, 150, 400, 1200, 3500, 9000, 1e9], out = new Array(6).fill(0), df = SR / N;
    let tot = 0;
    for (let k = 1; k < m.length; k++) {
      const f = k * df, p = m[k] * m[k]; tot += p;
      for (let b = 0; b < 6; b++) if (f >= edges[b] && f < edges[b + 1]) { out[b] += p; break; }
    }
    return out.map((x) => tot > 0 ? +(x / tot).toFixed(3) : 0);
  }
  // longest run of frames holding one stable, prominent spectral peak = a ringing partial.
  // Frames quieter than -54 dB below the sound's own peak are skipped: in digital silence the
  // lowest bin always "wins" by 70 dB over a median of zero, which made every sound look like a bell.
  function sustainedPartial(d, i0, i1, SR, peak) {
    const N = 2048, hop = 512, df = SR / N, gate = peak * 0.002;
    let best = { ms: 0, hz: 0, dB: 0, bwHz: 0 }, run = 0, runHz = 0, runDb = 0, runBw = 0, prevHz = 0;
    for (let s = i0; s + N < i1; s += hop) {
      let rms = 0; for (let i = 0; i < N; i++) rms += d[s + i] * d[s + i];
      rms = Math.sqrt(rms / N);
      if (rms < gate) { run = 0; prevHz = 0; continue; }
      const m = mag(d, s, N, N);
      const k0 = Math.max(2, Math.round(80 / df)), k1 = Math.min(m.length - 2, Math.round(12000 / df));
      let kp = k0, mx = 0;
      for (let k = k0; k <= k1; k++) if (m[k] > mx) { mx = m[k]; kp = k; }
      if (mx < 1e-9) { run = 0; prevHz = 0; continue; }
      const srt = []; for (let k = k0; k <= k1; k++) srt.push(m[k]);
      srt.sort((a, b) => a - b);
      const med = srt[srt.length >> 1] + 1e-20;
      const dB = 20 * Math.log10(mx / med);
      // parabolic interpolation for the true peak frequency
      const a0 = m[kp - 1], b0 = m[kp], c0 = m[kp + 1];
      const delta = (a0 - c0) !== 0 ? 0.5 * (a0 - c0) / (a0 - 2 * b0 + c0 || 1e-9) : 0;
      const hz = (kp + Math.max(-1, Math.min(1, delta))) * df;
      // -3 dB bandwidth of that peak
      let lo = kp, hi = kp; const half = mx * 0.7071;
      while (lo > k0 && m[lo] > half) lo--;
      while (hi < k1 && m[hi] > half) hi++;
      const bw = (hi - lo) * df;
      const stable = prevHz > 0 && Math.abs(hz - prevHz) < prevHz * 0.04;
      if (dB > 15 && bw < 400 && (stable || run === 0)) {
        run++; runHz = (runHz * (run - 1) + hz) / run; runDb = (runDb * (run - 1) + dB) / run; runBw = (runBw * (run - 1) + bw) / run;
        const ms = run * hop / SR * 1000;
        if (ms > best.ms) best = { ms: +ms.toFixed(1), hz: Math.round(runHz), dB: +runDb.toFixed(1), bwHz: Math.round(runBw) };
      } else { run = 0; runHz = 0; runDb = 0; runBw = 0; }
      prevHz = hz;
    }
    return best;
  }
  // Periodicity the way a pitch detector means it: walk out past the autocorrelation main lobe
  // (the first dip below 0.2) and take the largest peak after it. Without that step any lowpassed
  // noise scores ~0.9, because at a 0.5 ms lag a 300 Hz-limited signal has barely changed.
  function periodicity(d, i0, i1) {
    const n = Math.min(i1 - i0, 4410);
    if (n < 900) return 0;
    let e = 0; for (let i = 0; i < n; i++) e += d[i0 + i] * d[i0 + i];
    if (e < 1e-12) return 0;
    const maxLag = Math.min(882, n - 200);
    const r = new Float64Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
      let s = 0, e2 = 0;
      for (let i = 0; i + lag < n; i++) { s += d[i0 + i] * d[i0 + i + lag]; e2 += d[i0 + i + lag] * d[i0 + i + lag]; }
      r[lag] = s / Math.sqrt(e * e2 + 1e-20);
    }
    let start = 1;
    while (start < maxLag && r[start] > 0.2) start++;
    let best = 0;
    for (let lag = start; lag <= maxLag; lag++) if (r[lag] > best) best = r[lag];
    return +Math.max(0, best).toFixed(3);
  }
  // The whole measurement for one rendered slot.
  function analyse(d, s0, s1, SR) {
    let peak = 0, ip = s0;
    for (let i = s0; i < s1; i++) { const x = Math.abs(d[i]); if (x > peak) { peak = x; ip = i; } }
    if (peak < 1e-5) return { peak: 0, silent: true };
    const th = 0.02 * peak;
    let onset = ip; while (onset > s0 && Math.abs(d[onset]) > th) onset--;
    let i10 = onset, i90 = ip;
    for (let i = onset; i <= ip; i++) if (Math.abs(d[i]) >= 0.1 * peak) { i10 = i; break; }
    for (let i = i10; i <= ip; i++) if (Math.abs(d[i]) >= 0.9 * peak) { i90 = i; break; }
    // 0.5 ms max-envelope for decay times
    const bs = Math.max(1, Math.round(SR * 0.0005)), nb = Math.floor((s1 - ip) / bs);
    const env = new Float64Array(nb);
    for (let b = 0; b < nb; b++) { let m = 0; for (let i = ip + b * bs; i < ip + (b + 1) * bs; i++) { const x = Math.abs(d[i]); if (x > m) m = x; } env[b] = m; }
    const lastAbove = (frac) => { let last = 0; for (let b = 0; b < nb; b++) if (env[b] >= frac * peak) last = b; return last * bs / SR * 1000; };
    let sum = 0, nAll = 0;
    for (let i = onset; i < s1; i++) { sum += d[i] * d[i]; nAll++; }
    const wins = [[0, 0.008], [0.008, 0.032], [0.032, 0.096], [0.096, 0.3], [0.3, 0.9]];
    const cent = [], flat = [];
    let bands = [0, 0, 0, 0, 0, 0];
    for (let w = 0; w < wins.length; w++) {
      const a0 = onset + Math.round(wins[w][0] * SR), a1 = Math.min(s1, onset + Math.round(wins[w][1] * SR));
      const len = a1 - a0;
      if (len < 32) { cent.push(0); flat.push(0); continue; }
      const N = Math.min(8192, nextPow2(len));
      const m = mag(d, a0, Math.min(len, N), N);
      const cf = centroidFlat(m, SR, N);
      cent.push(Math.round(cf.cent)); flat.push(+cf.flat.toFixed(4));
      if (w === 1) bands = bandFractions(m, SR, N);
    }
    const tonal = sustainedPartial(d, onset + Math.round(0.02 * SR), s1, SR, peak);
    const ac = periodicity(d, onset + Math.round(0.025 * SR), onset + Math.round(0.125 * SR));
    // Shock steepness: the largest one-sample step in the first 5 ms, as a fraction of the peak.
    // A true blast front moves most of its amplitude inside one sample (22 us at 44.1 kHz) and
    // scores near 1; anything built by ramping a gain over milliseconds cannot exceed a few percent.
    let slew = 0;
    for (let i = Math.max(onset, s0 + 1); i < Math.min(s1, onset + Math.round(0.005 * SR)); i++) {
      const dd = Math.abs(d[i] - d[i - 1]); if (dd > slew) slew = dd;
    }
    let bleed = 0;
    for (let i = s1 - Math.round(0.06 * SR); i < s1; i++) { const x = Math.abs(d[i]); if (x > bleed) bleed = x; }
    return {
      peak: +peak.toFixed(3), rms: +Math.sqrt(sum / Math.max(1, nAll)).toFixed(4),
      onsetMs: +((onset - s0) / SR * 1000).toFixed(2),
      attackMs: +((ip - onset) / SR * 1000).toFixed(3),
      riseUs: Math.round((i90 - i10) / SR * 1e6),
      slew: +(slew / peak).toFixed(3), bleed: +bleed.toFixed(4),
      dec20: +lastAbove(0.1).toFixed(1), dec40: +lastAbove(0.01).toFixed(1), dec60: +lastAbove(0.001).toFixed(1),
      cent, flat, bands, tonal, ac,
    };
  }
`;

// The pre-rebuild gunshot recipe, frozen, so every run compares new against old under one renderer.
// This is a verbatim copy of the helpers sfx.js had before the rebuild: a pitched sawtooth body with
// decaying metal partials laid over it, which is how you synthesise an agogo bell.
export const LEGACY = `
  (function registerLegacy(a) {
    const EPS = 1e-4;
    const rnd = (x, y) => x + Math.random() * (y - x);
    const jit = (v, p) => v * (1 + (Math.random() * 2 - 1) * (p == null ? 0.08 : p));
    const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
    function voice(A, out, opts) {
      const o = opts && typeof opts === 'object' ? opts : {};
      const r = +o.rate, rate = clamp(Number.isFinite(r) && r > 0 ? r : 1, 0.25, 4);
      const v = { a: A, out, o, rate, s: Math.sqrt(rate), t0: A.now + 0.006, srcs: [], end: 0 };
      v.src = (n, tEnd) => { v.srcs.push(n); if (tEnd > v.end) v.end = tEnd; };
      return v;
    }
    function fx(v, head, c) {
      const A = v.a;
      if (c.shape) { const w = A.shaper(c.shape); head.connect(w); head = w; }
      if (c.hp) { const f = A.filter('highpass', c.hp * v.rate, c.hq == null ? 0.7 : c.hq); head.connect(f); head = f; }
      if (c.lp) { const f = A.filter('lowpass', c.lp * v.rate, c.lq == null ? 0.7 : c.lq); head.connect(f); head = f; }
      if (c.bp) { const f = A.filter('bandpass', c.bp * v.rate, c.bq == null ? 1 : c.bq); head.connect(f); head = f; }
      return head;
    }
    function ampEnv(v, param, t, dur, g, c) {
      const atk = Math.min(dur * 0.9, (c.atk == null ? 0.003 : c.atk) / v.s);
      const pts = [[0, EPS], [atk, g, 'lin']];
      if (c.hold) pts.push([Math.min(dur * 0.95, atk + c.hold / v.s), g * 0.9, 'lin']);
      pts.push([dur, EPS, c.curve || 'exp']);
      v.a.env(param, pts, t);
    }
    function burst(v, c) {
      c = c || {};
      const A = v.a, s = v.s, t = v.t0 + (c.at || 0) / s;
      const dur = Math.max(0.003, jit(c.dur == null ? 0.1 : c.dur, c.djit == null ? 0.1 : c.djit) / s);
      const f0 = jit((c.f0 == null ? 1000 : c.f0) * v.rate, c.fjit == null ? 0.07 : c.fjit);
      const f1 = c.f1 == null ? f0 : jit(c.f1 * v.rate, c.fjit == null ? 0.07 : c.fjit);
      const g = Math.max(EPS, jit(c.g == null ? 0.5 : c.g, c.gjit == null ? 0.12 : c.gjit));
      const n = A.noise(c.type || 'white', c.pr == null ? 1 : c.pr);
      if (c.pr1 != null) A.env(n.playbackRate, [[0, c.pr == null ? 1 : c.pr], [dur, c.pr1, 'exp']], t);
      const f = A.filter(c.filt || 'bandpass', f0, c.q == null ? 1 : c.q);
      if (f1 !== f0) A.env(f.frequency, [[0, f0], [dur * (c.sweep == null ? 1 : c.sweep), f1, 'exp']], t);
      n.connect(f);
      const head = fx(v, f, c), gn = A.gain(0);
      ampEnv(v, gn.gain, t, dur, g, c);
      head.connect(gn); gn.connect(c.to || v.out);
      const tEnd = t + dur + 0.03; n.stop(tEnd); v.src(n, tEnd);
      return gn;
    }
    function tone(v, c) {
      c = c || {};
      const A = v.a, s = v.s, t = v.t0 + (c.at || 0) / s;
      const dur = Math.max(0.005, jit(c.dur == null ? 0.2 : c.dur, c.djit == null ? 0.08 : c.djit) / s);
      const f0 = jit((c.f0 == null ? 220 : c.f0) * v.rate, c.fjit == null ? 0.03 : c.fjit);
      const f1 = c.f1 == null ? f0 : jit(c.f1 * v.rate, c.fjit == null ? 0.03 : c.fjit);
      const g = Math.max(EPS, jit(c.g == null ? 0.4 : c.g, c.gjit == null ? 0.1 : c.gjit));
      const o = A.osc(c.type || 'sine', f0, c.detune || 0);
      if (f1 !== f0) A.env(o.frequency, [[0, f0], [dur * (c.sweep == null ? 1 : c.sweep), f1, c.fcurve || 'exp']], t);
      const head = fx(v, o, c), gn = A.gain(0);
      ampEnv(v, gn.gain, t, dur, g, c);
      head.connect(gn); gn.connect(c.to || v.out);
      const tEnd = t + dur + 0.03; o.start(t); o.stop(tEnd); v.src(o, tEnd);
      return gn;
    }
    function ring(v, c) {
      c = c || {};
      const freqs = c.freqs || [800, 1300], fall = c.fall == null ? 0.75 : c.fall;
      freqs.forEach((f, i) => tone(v, { at: (c.at || 0) + rnd(0, c.spread == null ? 0.004 : c.spread), type: c.type || 'sine', f0: f, dur: (c.decay == null ? 0.2 : c.decay) * (1 - i * 0.08), g: (c.g == null ? 0.2 : c.g) * Math.pow(fall, i), atk: 0.0015, fjit: 0.015, djit: 0.25, to: c.to, lp: c.lp, shape: c.shape }));
    }
    function click(v, c) {
      c = c || {};
      burst(v, { at: c.at || 0, type: 'white', filt: 'bandpass', f0: c.f == null ? 3000 : c.f, q: c.q == null ? 1.5 : c.q, dur: c.dur == null ? 0.004 : c.dur, g: c.g == null ? 0.5 : c.g, atk: 0.0005, to: c.to });
    }
    function thump(v, c) {
      c = c || {};
      return tone(v, { at: c.at || 0, type: 'sine', f0: c.f0 == null ? 90 : c.f0, f1: c.f1 == null ? 30 : c.f1, dur: c.dur == null ? 0.12 : c.dur, g: c.g == null ? 0.8 : c.g, atk: c.atk == null ? 0.002 : c.atk, to: c.to });
    }
    function tail(v, c) {
      c = c || {};
      return burst(v, { at: c.at == null ? 0.01 : c.at, type: c.type || 'pink', filt: 'lowpass', f0: c.f0 == null ? 2500 : c.f0, f1: c.f1 == null ? 300 : c.f1, q: 0.5, dur: c.dur == null ? 0.5 : c.dur, g: c.g == null ? 0.15 : c.g, atk: c.atk == null ? 0.015 : c.atk, to: c.to });
    }
    function clack(v, c) {
      c = c || {};
      const f = c.f == null ? 2200 : c.f;
      burst(v, { at: c.at || 0, type: 'white', filt: 'bandpass', f0: f, q: c.q == null ? 2 : c.q, dur: c.dur == null ? 0.015 : c.dur, g: c.g == null ? 0.5 : c.g, atk: 0.0008, to: c.to });
      ring(v, { at: c.at || 0, freqs: [f * 0.62, f * 1.07, f * 1.9], decay: c.decay == null ? 0.06 : c.decay, g: (c.g == null ? 0.5 : c.g) * (c.ringMul == null ? 0.22 : c.ringMul), to: c.to });
    }
    function gunshotOld(v, p) {
      p = p || {};
      click(v, { g: p.clickG == null ? 0.8 : p.clickG, f: 3500, dur: 0.003 });
      burst(v, { type: 'white', filt: 'bandpass', f0: p.crackF0 == null ? 4000 : p.crackF0, f1: p.crackF1 == null ? 400 : p.crackF1, q: p.crackQ == null ? 0.7 : p.crackQ, dur: p.crackDur == null ? 0.07 : p.crackDur, g: p.crackG == null ? 1 : p.crackG, atk: 0.001 });
      thump(v, { f0: p.thumpF0 == null ? 90 : p.thumpF0, f1: p.thumpF1 == null ? 30 : p.thumpF1, dur: p.thumpDur == null ? 0.12 : p.thumpDur, g: p.thumpG == null ? 0.9 : p.thumpG });
      tone(v, { type: 'sawtooth', f0: p.bodyF0 == null ? 140 : p.bodyF0, f1: p.bodyF1 == null ? 60 : p.bodyF1, dur: p.bodyDur == null ? 0.05 : p.bodyDur, g: p.bodyG == null ? 0.4 : p.bodyG, lp: p.bodyLp == null ? 900 : p.bodyLp, shape: p.bodyShape == null ? 8 : p.bodyShape, atk: 0.001 });
      if (p.boomG) burst(v, { type: 'brown', filt: 'lowpass', f0: p.boomF == null ? 400 : p.boomF, f1: (p.boomF == null ? 400 : p.boomF) * 0.4, q: 0.7, dur: p.boomDur == null ? 0.2 : p.boomDur, g: p.boomG, atk: 0.002 });
      tail(v, { dur: p.tailDur == null ? 0.5 : p.tailDur, g: p.tailG == null ? 0.18 : p.tailG, f0: p.tailF0 == null ? 2500 : p.tailF0, f1: p.tailF1 == null ? 300 : p.tailF1 });
      if (p.echo) burst(v, { at: p.echo.at == null ? 0.12 : p.echo.at, type: 'pink', filt: 'lowpass', f0: 1200, f1: 200, q: 0.5, dur: p.echo.dur == null ? 0.6 : p.echo.dur, g: p.echo.g == null ? 0.12 : p.echo.g, atk: 0.02 });
      (p.mech || []).forEach((m) => clack(v, { at: m.at, f: m.f == null ? 2400 : m.f, g: m.g == null ? 0.3 : m.g, dur: 0.012, decay: 0.05 }));
    }
    const OLD = {
      old_pm: [1, { crackF0: 4500, crackDur: 0.055, thumpF0: 85, thumpDur: 0.09, thumpG: 0.6, bodyG: 0.25, bodyLp: 1100, tailDur: 0.4, tailG: 0.12, mech: [{ at: 0.06, f: 2600, g: 0.22 }] }],
      old_akm: [0.85, { crackF0: 3800, crackDur: 0.08, thumpF0: 100, thumpF1: 28, thumpDur: 0.14, thumpG: 1.0, bodyG: 0.5, bodyLp: 700, tailDur: 0.7, tailG: 0.22, mech: [{ at: 0.07, f: 2300, g: 0.3 }, { at: 0.115, f: 1900, g: 0.2 }] }],
      old_toz: [0.8, { crackF0: 3000, crackF1: 250, crackDur: 0.09, crackG: 0.9, thumpF0: 70, thumpF1: 25, thumpDur: 0.2, thumpG: 1.2, bodyF0: 90, bodyF1: 40, bodyDur: 0.12, bodyG: 0.6, bodyLp: 500, boomG: 0.7, boomF: 420, boomDur: 0.2, tailDur: 0.75, tailG: 0.25, tailF0: 1500 }],
      old_mosin: [0.72, { clickG: 1, crackF0: 5000, crackF1: 350, crackDur: 0.09, crackG: 1.2, crackQ: 0.6, thumpF0: 95, thumpF1: 28, thumpDur: 0.16, thumpG: 1.0, bodyG: 0.5, bodyLp: 800, tailDur: 0.9, tailG: 0.3, tailF0: 3000, tailF1: 250, echo: { at: 0.12, dur: 0.7, g: 0.12 } }],
    };
    Object.keys(OLD).forEach((name) => {
      const lv = OLD[name][0], p = OLD[name][1];
      a.register(name, (A, out, opts) => {
        let dst = out;
        if (lv !== 1) { const g = A.gain(lv); g.connect(out); dst = g; }
        const v = voice(A, dst, opts);
        gunshotOld(v, p);
        return { stop() { v.srcs.forEach((s) => { try { s.stop(); } catch (e) {} }); } };
      });
    });
  })(a);
`;

// Boilerplate: point the engine at an OfflineAudioContext, bypass the compressor, render, hand back
// the raw channel data to the caller's analysis. `total` seconds, 44100 Hz.
export const OFFLINE = `
  const SR = 44100;
  let fakeNow = 0;
  const created = [];
  window.AudioContext = function () {
    const c = new OfflineAudioContext(1, Math.ceil(SR * TOTAL), SR);
    Object.defineProperty(c, 'currentTime', { get: () => fakeNow });
    Object.defineProperty(c, 'state', { get: () => 'running' });
    for (const m of ['createOscillator', 'createBufferSource', 'createGain', 'createBiquadFilter', 'createWaveShaper', 'createDelay', 'createPanner', 'createConvolver']) {
      const orig = c[m].bind(c);
      c[m] = (...args) => {
        const n = orig(...args); n.__kind = m; n.__stop = null;
        if (n.stop) { const st = n.stop.bind(n); n.stop = (w) => { n.__stop = (w == null ? fakeNow : w); return st(w); }; }
        created.push(n); return n;
      };
    }
    return c;
  };
  const a = window.__radius.ctx.audio;
  a.ensure();
  const ac = a.ctx;
  a.master.disconnect(); a.master.connect(ac.destination); a.master.gain.value = 1;
`;

// Node-side pretty printer shared by the guns-* scenarios.
export function row(name, m) {
  if (!m || m.silent) return name.padEnd(16) + ' SILENT';
  const f = (x, n = 3) => String(x).padEnd(n);
  return name.padEnd(16)
    + ' pk ' + f(m.peak, 6) + ' rms ' + f(m.rms, 7)
    + ' slew ' + f(m.slew, 6)
    + ' rise ' + f(m.riseUs + 'us', 8)
    + ' atk ' + f(m.attackMs + 'ms', 9)
    + ' dec20/40/60 ' + f(m.dec20, 6) + f(m.dec40, 6) + f(m.dec60, 7)
    + ' cent ' + f(m.cent.join('/'), 30)
    + ' flat ' + f(m.flat.join('/'), 34)
    + ' tonal ' + f(m.tonal.ms + 'ms@' + m.tonal.hz + 'Hz/' + m.tonal.dB + 'dB/bw' + m.tonal.bwHz, 30)
    + ' ac ' + m.ac;
}
export function bandsRow(name, m) {
  if (!m || m.silent) return name.padEnd(16) + ' SILENT';
  return name.padEnd(16) + ' bands(20-150/150-400/400-1.2k/1.2-3.5k/3.5-9k/9k+) ' + m.bands.join(' ');
}
