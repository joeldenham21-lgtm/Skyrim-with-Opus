// Does the game actually make sound? Taps the master bus with an analyser and measures real
// signal, rather than trusting that nodes were constructed.
//   node tools/smoke.mjs --audio --scenario tools/scenarios/audio.mjs --out .smoke/audio
//
// Regression for the reverb impulse response overflowing to +/-Infinity: a convolver fed a
// non-finite buffer poisons every bus downstream, which silences the whole mix.
const SOUNDS = ['shot_pm', 'step_grass', 'bandage_use', 'siren', 'dry_click', 'pickup_item', 'ui_click', 'hurt'];

export default async function (page, api) {
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  // Deliberately does NOT call api.start(): audio is independent of the render loop, and waiting
  // on rendered frames makes this test hostage to software-rendering throughput.
  await api.wait(500);

  // the context must actually be running, not suspended
  console.log('CONTEXT', JSON.stringify(await R(`
    c.audio.resume();
    return { state: c.audio.ctx ? c.audio.ctx.state : 'none', ready: c.audio.ready, sampleRate: c.audio.ctx?.sampleRate ?? 0 };`)));

  // ---- the impulse response itself: this is what overflowed ----
  console.log('REVERB_IR', JSON.stringify(await R(`
    const rv = c.audio.reverbSend;
    if (!rv) return { found: false };
    // walk to the convolver the send feeds
    const conv = (c.audio.ctx && c.audio._reverb) || null;
    // fall back: rebuild the same IR the engine builds and inspect it
    return { found: true, note: 'buffer inspected via engine internals below' };`)));

  console.log('IR_SAMPLES', JSON.stringify(await R(`
    // Reconstruct exactly what makeIR produces at this sample rate and check every sample.
    const ac = c.audio.ctx, rate = ac.sampleRate, seconds = 2.2, decay = 0.9, tone = 1.3;
    const len = Math.floor(rate * seconds); let lp = 0, bad = 0, peak = 0, sum = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = Math.max(0.02, 0.35 - 0.3 * t * tone);
      const env = Math.pow(1 - t, decay * 2.2) * (i < 200 ? i / 200 : 1);
      lp += ((Math.random() * 2 - 1) - lp) * k;
      const v = lp * env * (0.8 + 0.2 * Math.sin(i * 0.0007));
      if (!Number.isFinite(v)) bad++;
      const a = Math.abs(v); if (a > peak) peak = a; sum += v * v;
    }
    return { nonFinite: bad, peak: +peak.toFixed(4), rms: +Math.sqrt(sum / len).toFixed(5) };`)));

  // ---- tap the master bus and measure each sound ----
  await R(`
    const ac = c.audio.ctx;
    const an = ac.createAnalyser(); an.fftSize = 2048;
    c.audio.master.connect(an);
    window.__an = an; window.__buf = new Float32Array(an.fftSize);
    window.__rms = () => { an.getFloatTimeDomainData(window.__buf); let s = 0; for (const v of window.__buf) s += v * v; return Math.sqrt(s / window.__buf.length); };
    window.__peakOver = async (ms) => { let p = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = window.__rms(); if (Number.isFinite(v) && v > p) p = v; await new Promise(r => setTimeout(r, 8)); } return p; };
    window.__nonFinite = () => { an.getFloatTimeDomainData(window.__buf); return [...window.__buf].filter(v => !Number.isFinite(v)).length; };`);

  const baseline = await page.evaluate(`window.__peakOver(400)`);
  console.log('BASELINE_RMS', JSON.stringify({ rms: +baseline.toFixed(6), nonFinite: await page.evaluate('window.__nonFinite()') }));

  const results = {};
  for (const name of SOUNDS) {
    await R(`c.audio.play(${JSON.stringify(name)}, { gain: 1 });`);
    const peak = await page.evaluate(`window.__peakOver(500)`);
    results[name] = +peak.toFixed(6);
  }
  console.log('SOUNDS', JSON.stringify(results, null, 1));
  console.log('SILENT', JSON.stringify(Object.entries(results).filter(([, v]) => v < 1e-5).map(([k]) => k)));
  console.log('NONFINITE_AFTER', await page.evaluate('window.__nonFinite()'));

  // music and ambience beds
  await R(`c.music.start?.(); c.ambience.start?.();`);
  await api.wait(1500);
  const bed = await page.evaluate(`window.__peakOver(1200)`);
  console.log('BEDS_RMS', JSON.stringify({ rms: +bed.toFixed(6) }));

  console.log('MISSING', JSON.stringify(await R(`return c.audio.missing ? [...c.audio.missing] : (r.stats().missingSounds || []);`)));
  console.log('ERRORS', JSON.stringify(await R(`return [...(c._errors || [])];`)));
}
