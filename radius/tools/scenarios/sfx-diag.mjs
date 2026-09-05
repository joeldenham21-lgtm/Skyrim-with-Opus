// sfx diagnostic: plays each canonical sound in isolation and attributes WebAudio warnings to the sound that caused them.
// node tools/smoke.mjs --out .smoke/sfx-diag --scenario tools/scenarios/sfx-diag.mjs --w 320 --h 180
import { ONE_SHOTS, LOOPS } from './sfx-all.mjs';

export default async function (page, api) {
  const warnings = []; let current = 'none';
  page.on('console', (m) => { if (m.type() === 'warning' && /Audio|Biquad|filter/i.test(m.text())) warnings.push(current + ' :: ' + m.text()); });
  await api.run('window.__radius.start()');
  await api.run(`(async () => { const a = window.__radius.ctx.audio; a.ensure(); await a.ctx.resume(); return a.ctx.state; })()`);
  for (const rate of [1, 0.6, 1.6]) for (const n of ONE_SHOTS) {
    current = n + '@' + rate;
    await api.run(`(() => { const a = window.__radius.ctx.audio; for (let i = 0; i < 3; i++) a.play(${JSON.stringify(n)}, { gain: 0.5, rate: ${rate} }); })()`);
    await api.wait(140);
  }
  for (const n of LOOPS) {
    current = 'loop:' + n;
    await api.run(`(async () => { const a = window.__radius.ctx.audio; const h = a.loop(${JSON.stringify(n)}, { gain: 0.5 }); for (const k of ['level','rate','gust','intensity','near','pulse']) h.set(k, 0.8); for (let i = 0; i < 12; i++) { a.update(0.4); await new Promise((r) => setTimeout(r, 25)); } h.stop(0.1); })()`);
    await api.wait(200);
  }
  await api.wait(800);
  console.log('AUDIO WARNINGS (' + warnings.length + '):\n' + warnings.join('\n'));
}
