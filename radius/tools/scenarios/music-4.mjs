// Minimal base + stop/start leak check (2 frames per step, for heavily loaded machines).
export default async function (page, api) {
  await api.run(`(() => { const AC = window.AudioContext || window.webkitAudioContext; window.__src = { made: 0, live: 0 };
    for (const k of ['createOscillator', 'createBufferSource']) { const orig = AC.prototype[k]; AC.prototype[k] = function () { const o = orig.call(this); window.__src.made++; window.__src.live++; o.addEventListener('ended', () => window.__src.live--); return o; }; } })()`);
  await api.start();
  await api.run(`(async () => { const a = __radius.ctx.audio; a.ensure(); await a.ctx.resume(); })()`);
  const snap = async (label) => { const r = await api.run(`(() => { const c = __radius.ctx; return { label: ${JSON.stringify(label)}, built: c.music.built, state: c.director.state, inBase: c.player.inBase, levels: c.music.levels(), loops: c.ambience.debug().loops, src: { ...window.__src }, missing: [...c.audio.missing] }; })()`); console.log(JSON.stringify(r)); return r; };
  await api.run(`__radius.teleport(0, 302); __radius.ctx.ambience.force('drip')`); await api.frames(2); await snap('base');
  await api.run(`__radius.ctx.music.stop(); __radius.ctx.ambience.stop()`); await api.wait(2000); await api.frames(1); await snap('stopped');
  await api.run(`__radius.ctx.music.start(); __radius.ctx.ambience.start()`); await api.frames(2); await snap('restarted');
}
