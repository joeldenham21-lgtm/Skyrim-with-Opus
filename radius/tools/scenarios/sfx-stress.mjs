// sfx stress: hammers each sound name in isolation (game not started, so only sfx generators are live) and counts
// WebAudio warnings per name. node tools/smoke.mjs --out .smoke/sfx-stress --scenario tools/scenarios/sfx-stress.mjs --w 320 --h 180
import { ONE_SHOTS, LOOPS } from './sfx-all.mjs';

export default async function (page, api) {
  const counts = {}; let current = 'none';
  page.on('console', (m) => { if (m.type() === 'warning' && /Audio|Biquad|filter/i.test(m.text())) counts[current] = (counts[current] || 0) + 1; });
  await api.run(`(async () => { const a = window.__radius.ctx.audio; a.ensure(); await a.ctx.resume(); return a.ctx.state; })()`);
  for (const n of ONE_SHOTS) {
    current = n;
    await api.run(`(() => { const a = window.__radius.ctx.audio; for (let i = 0; i < 30; i++) a.play(${JSON.stringify(n)}, { gain: 0.3, rate: 0.6 + Math.random() }); })()`);
    await api.wait(450);
  }
  for (const n of LOOPS) {
    current = 'loop:' + n;
    await api.run(`(async () => { const a = window.__radius.ctx.audio; const hs = []; for (let i = 0; i < 4; i++) { const h = a.loop(${JSON.stringify(n)}, { gain: 0.3, rate: 0.6 + Math.random() }); for (const k of ['level','rate','gust','intensity','near','pulse']) h.set(k, Math.random() * 3); hs.push(h); } for (let i = 0; i < 20; i++) { a.update(0.3); await new Promise((r) => setTimeout(r, 20)); } for (const h of hs) h.stop(0.1); })()`);
    await api.wait(300);
  }
  await api.wait(800);
  console.log('WARNING COUNTS: ' + JSON.stringify(counts));
}
