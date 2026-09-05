// Compact music + ambience check (few frames, for loaded machines): states, tide window, base, one stop/start.
export default async function (page, api) {
  await api.run(`(() => { const AC = window.AudioContext || window.webkitAudioContext; window.__src = { made: 0, live: 0 };
    for (const k of ['createOscillator', 'createBufferSource']) { const orig = AC.prototype[k]; AC.prototype[k] = function () { const o = orig.call(this); window.__src.made++; window.__src.live++; o.addEventListener('ended', () => window.__src.live--); return o; }; } })()`);
  await api.start();
  await api.run(`(async () => { const a = __radius.ctx.audio; a.ensure(); await a.ctx.resume(); })()`);
  const snap = async (label) => { const r = await api.run(`(() => { const c = __radius.ctx; return { label: ${JSON.stringify(label)}, built: c.music.built, state: c.director.state, night: +c.time.night.toFixed(2), tideIn: Math.round(c.time.tideIn()), inBase: c.player.inBase, levels: c.music.levels(), amb: c.ambience.debug(), src: { ...window.__src }, missing: [...c.audio.missing] }; })()`); console.log(JSON.stringify(r)); return r; };
  await api.frames(3); await snap('calm');
  await api.run(`__radius.ctx.director.setState('UNEASE')`); await api.frames(2);
  await api.run(`__radius.ctx.director.setState('HUNT')`); await api.frames(2);
  await api.run(`__radius.ctx.director.setState('COMBAT'); __radius.ctx.director.notify('shot', { pos: __radius.ctx.player.position })`); await api.frames(2); await snap('combat');
  await api.run(`__radius.ctx.director.setState('AFTERMATH'); __radius.setTime(4.5); __radius.ctx.state.data.tideDay = __radius.ctx.state.data.day; __radius.ctx.events.emit('tideRising')`); await api.frames(3); await snap('aftermath-night-tide');
  await api.run(`__radius.ctx.events.emit('tide', 1); __radius.ctx.state.data.tideDay += 3; __radius.setTime(12); __radius.teleport(0, 302); __radius.ctx.ambience.force('drip')`); await api.frames(4); await snap('base');
  await api.run(`__radius.ctx.music.stop(); __radius.ctx.ambience.stop()`); await api.wait(2000); await api.frames(2); await snap('stopped');
  await api.run(`__radius.ctx.music.start(); __radius.ctx.ambience.start()`); await api.frames(3); await snap('restarted');
}
