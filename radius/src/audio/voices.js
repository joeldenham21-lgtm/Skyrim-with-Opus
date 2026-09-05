// RADIUS — the mimic's voice. Garbled radio chatter, the spotting tone, its rifle, its death, and the static
// bed it carries. Imported by sfx.js, which hands over its builder toolkit (H) so nothing is duplicated.
export function registerVoices(audio, H) {
  const { def, defLoop, burst, tone, fm, thump, rnd, irnd, clamp, gunshot, pulses, EPS } = H;

  // Garbled radio voice: 2-5 syllables of bandpassed noise through 2-3 moving formant peaks, mains-hum AM,
  // clipped, band-limited like a handset speaker, wrapped in static and closed with a squelch.
  def('mimic_radio', (v) => {
    const a = v.a, s = v.s, out = v.out;
    const src = a.noise('white'), ng = a.gain(0.5), pre = a.filter('highpass', 250, 0.7), sum = a.gain(1);
    src.connect(ng); ng.connect(pre);
    // a buzzing glottal saw under the breath noise: through the formant peaks it reads as a voice, not as shaped static
    const pf = rnd(95, 150) * v.rate, glot = a.osc('sawtooth', pf), gg = a.gain(0.55);
    glot.connect(gg); gg.connect(pre);
    const bands = [];
    const nb = irnd(2, 3);
    for (let i = 0; i < nb; i++) { const f = a.filter('bandpass', 600, rnd(7, 12)); const bg = a.gain(i === 0 ? 1 : 0.7); pre.connect(f); f.connect(bg); bg.connect(sum); bands.push(f); }
    const am = a.gain(0.55), hum = a.osc('sine', rnd(48, 55)), hg = a.gain(0.45);
    hum.connect(hg); hg.connect(am.gain); sum.connect(am);
    const clip = a.shaper(rnd(18, 40)); am.connect(clip);
    const spk = a.filter('bandpass', rnd(1100, 1500), 0.7); clip.connect(spk);
    const gate = a.gain(0); spk.connect(gate); gate.connect(out);
    const st = a.noise('white'), sf = a.filter('highpass', 3000, 0.5), sg = a.gain(0);
    st.connect(sf); sf.connect(sg); sg.connect(out);
    const T0 = v.t0 + 0.02 / s; let t = T0;
    const n = irnd(2, 5);
    gate.gain.setValueAtTime(EPS, v.t0);
    for (let i = 0; i < n; i++) {
      const dur = rnd(0.06, 0.15) / s;
      const target = [rnd(400, 900), rnd(1200, 2200), rnd(2300, 3200)].map((f) => f * v.rate);
      bands.forEach((b, k) => { b.frequency.setValueAtTime(target[k] * rnd(0.85, 1.15), t); b.frequency.exponentialRampToValueAtTime(target[k], t + dur); });
      const p = pf * rnd(0.85, 1.2);    // pitch contour per syllable: a little rise or fall, like a word
      glot.frequency.setValueAtTime(p, t); glot.frequency.exponentialRampToValueAtTime(p * rnd(0.82, 1.18), t + dur);
      const g = rnd(0.7, 1.0);
      gate.gain.setValueAtTime(EPS, t); gate.gain.linearRampToValueAtTime(g, t + 0.012); gate.gain.linearRampToValueAtTime(g * 0.6, t + dur * 0.7); gate.gain.exponentialRampToValueAtTime(EPS, t + dur);
      t += dur + rnd(0.03, 0.08) / s;
    }
    const tEnd = t;
    a.env(sg.gain, [[0, EPS], [0.02, 0.05, 'lin'], [tEnd - T0 + 0.02, 0.04, 'lin'], [tEnd - T0 + 0.1, EPS, 'exp']], T0);
    const atEnd = (tEnd - v.t0) * s;
    burst(v, { at: atEnd + 0.01, type: 'white', filt: 'bandpass', f0: 2500, q: 1, dur: 0.04, g: 0.45, atk: 0.001 });
    tone(v, { at: atEnd + 0.02, f0: 2400, f1: 600, dur: 0.08, g: 0.12, atk: 0.003 });
    const stopAt = tEnd + 0.2;
    hum.start(v.t0); hum.stop(stopAt); glot.start(v.t0); glot.stop(stopAt); src.stop(stopAt); st.stop(stopAt);
    v.src(hum, stopAt); v.src(glot, stopAt); v.src(src, stopAt); v.src(st, stopAt);
  });

  // It has seen you: a low tone drops, static swells around it.
  def('mimic_spot', (v) => {
    tone(v, { f0: 220, f1: 110, dur: 0.6, g: 0.5, atk: 0.02, hold: 0.15 });
    tone(v, { f0: 221.5, f1: 110.5, dur: 0.6, g: 0.25, atk: 0.02, hold: 0.15, lp: 600 });
    burst(v, { type: 'white', filt: 'highpass', f0: 2500, q: 0.5, dur: 0.7, g: 0.15, atk: 0.35 });
    burst(v, { at: 0.3, type: 'crackle', filt: 'lowpass', f0: 4000, q: 0.7, dur: 0.4, g: 0.2, atk: 0.1 });
  });

  // Its rifle: an AK-like crack with a thin ghost of static folded into the report.
  def('mimic_shot', (v) => {
    gunshot(v, { crackF0: 3700, crackF1: 380, crackDur: 0.078, thumpF0: 95, thumpF1: 30, thumpDur: 0.14, thumpG: 0.95, bodyG: 0.48, bodyLp: 720, tailDur: 0.65, tailG: 0.2, mech: [{ at: 0.068, f: 2250, g: 0.28 }, { at: 0.11, f: 1850, g: 0.18 }] });
    burst(v, { at: 0.01, type: 'white', filt: 'highpass', f0: 3000, q: 0.5, dur: 0.1, g: 0.08, atk: 0.002 });
  });

  // A round lands in it: dry, papery impact and a short spit of static.
  def('mimic_hit', (v) => {
    burst(v, { type: 'white', filt: 'bandpass', f0: 1200, f1: 500, q: 1, dur: 0.05, g: 0.6, atk: 0.001 });
    thump(v, { f0: 120, f1: 70, dur: 0.06, g: 0.5 });
    burst(v, { at: 0.01, type: 'white', filt: 'highpass', f0: 2500, q: 0.5, dur: 0.12, g: 0.2, atk: 0.003 });
    burst(v, { at: 0.02, type: 'crackle', filt: 'lowpass', f0: 5000, q: 0.7, dur: 0.1, g: 0.25, atk: 0.002 });
  });

  // It folds: a descending FM creak, static collapsing to nothing, a last soft settle of ash.
  def('mimic_death', (v) => {
    fm(v, { type: 'sine', f0: 600, f1: 90, ratio: 1.4, index: 3, index1: 0.8, dur: 1.2, g: 0.35, atk: 0.02, hold: 0.2, lp: 2000 });
    fm(v, { at: 0.08, type: 'triangle', f0: 420, f1: 70, ratio: 2.7, index: 2, index1: 0.5, dur: 1.0, g: 0.18, atk: 0.05, lp: 1500 });
    burst(v, { type: 'white', filt: 'bandpass', f0: 3000, f1: 300, q: 1, dur: 1.3, g: 0.25, atk: 0.05 });
    burst(v, { type: 'crackle', filt: 'lowpass', f0: 4000, q: 0.7, dur: 1.2, g: 0.4, atk: 0.01 });
    thump(v, { at: 1.1, f0: 70, f1: 40, dur: 0.2, g: 0.35 });
    burst(v, { at: 1.1, type: 'pink', filt: 'highpass', f0: 2500, q: 0.5, dur: 0.3, g: 0.06, atk: 0.04 });
  });

  // The skip: a whoosh with a fast flutter, gone before you place it.
  def('mimic_skip', (v) => {
    const tr = H.trem(v, { freq: rnd(18, 26), depth: 0.45, dur: 0.45 });
    burst(v, { type: 'pink', filt: 'bandpass', f0: 700, f1: 2200, q: 1, dur: 0.4, g: 0.5, atk: 0.12, to: tr });
    burst(v, { at: 0.05, type: 'white', filt: 'highpass', f0: 3000, q: 0.5, dur: 0.3, g: 0.08, atk: 0.1, to: tr });
  });

  // Heavier than a human step on grass and dirt.
  def('mimic_step', (v) => {
    burst(v, { type: 'pink', filt: 'highpass', f0: 600, q: 0.6, dur: 0.09, g: 0.5, atk: 0.012 });
    burst(v, { type: 'brown', filt: 'lowpass', f0: 350, q: 0.7, dur: 0.08, g: 0.6, atk: 0.004 });
    thump(v, { f0: 80, f1: 45, dur: 0.09, g: 0.6 });
    if (Math.random() < 0.4) pulses(v, { n: 2, at: 0.02, span: 0.05, type: 'white', f0: 1500, f1: 2500, q: 3, dur: 0.008, g: 0.1 });
  });

  // The static it carries: quiet radio hiss with slow crackle and the odd squelch-let. set('level', 0..1).
  defLoop('mimic_static', (L) => {
    const a = L.a, mix = L.keep(a.gain(0.5)); mix.connect(L.out);
    L.noise('white', 'highpass', 2800, 0.5, 0.12, mix);
    const cr = L.noise('crackle', 'lowpass', 3500, 0.7, 0.25, mix, 0.9); L.lfo(cr.g.gain, 0.25, 0.12);
    L.noise('brown', 'lowpass', 150, 0.7, 0.04, mix);
    const hum = L.osc('sine', rnd(48, 55), 0.02, mix);
    let timer = rnd(4, 12);
    L.tick = (dt) => { timer -= dt; if (timer > 0) return; timer = rnd(4, 12); const v = H.voice(a, mix, {}); burst(v, { type: 'white', filt: 'bandpass', f0: rnd(1500, 3000), q: 1.5, dur: rnd(0.02, 0.06), g: 0.3, atk: 0.002 }); tone(v, { at: 0.01, f0: 2000, f1: 700, dur: 0.05, g: 0.06, atk: 0.003 }); };
    L.setters.level = (val) => { const l = clamp(Number.isFinite(val) ? val : 0.5, 0, 1); L.target(mix.gain, 0.15 + 0.85 * l, 0.2); L.target(hum.g.gain, 0.01 + 0.04 * l, 0.2); };
  });
}
