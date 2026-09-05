// Music + ambience smoke: resume WebAudio, count oscillator/buffer sources, drive the Director through
// every state, night, the Tide window and the base interior; start/stop twice to check for leaks.
export default async function (page, api) {
  // wrap source constructors before anything builds so we can count what stays alive
  await api.run(`(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    window.__src = { made: 0, live: 0 };
    for (const k of ['createOscillator', 'createBufferSource']) {
      const orig = AC.prototype[k];
      AC.prototype[k] = function () { const o = orig.call(this); window.__src.made++; window.__src.live++; o.addEventListener('ended', () => window.__src.live--); return o; };
    }
  })()`);
  await api.start();
  await api.run(`(async () => { const a = __radius.ctx.audio; a.ensure(); await a.ctx.resume(); })()`);
  await api.frames(4);
  const snap = async (label) => {
    const r = await api.run(`(() => { const c = __radius.ctx; return { label: ${JSON.stringify(label)}, ready: c.audio.ready, built: c.music.built, state: c.director.state, tension: +c.director.tension.toFixed(2), night: +c.time.night.toFixed(2), tideIn: Math.round(c.time.tideIn()), inBase: c.player.inBase, levels: c.music.levels(), amb: c.ambience.debug(), src: { ...window.__src }, storm: +(c.lighting.storm).toFixed(3) }; })()`);
    console.log(JSON.stringify(r));
    return r;
  };
  await snap('calm-day');
  await api.run(`__radius.ctx.director.setState('UNEASE')`); await api.frames(4); await snap('unease');
  await api.run(`__radius.ctx.director.setState('HUNT')`); await api.frames(4); await snap('hunt');
  // COMBAT falls back to AFTERMATH within a frame unless shots keep landing: feed the director recent shots
  await api.run(`__radius.ctx.director.setState('COMBAT'); __radius.ctx.director.notify('shot', { pos: __radius.ctx.player.position })`); await api.frames(3);
  await api.run(`__radius.ctx.director.notify('shot', { pos: __radius.ctx.player.position })`); await api.frames(3); await snap('combat');
  await api.run(`__radius.ctx.director.setState('AFTERMATH')`); await api.frames(4); await snap('aftermath');
  await api.run(`__radius.ctx.director.setState('CALM'); __radius.setTime(22.5)`); await api.frames(4); await snap('night');
  // tide window: 04:30 on the tide day -> 30 in-game minutes left
  await api.run(`__radius.setTime(4.5); __radius.ctx.state.data.tideDay = __radius.ctx.state.data.day`); await api.frames(4); await snap('tide-window');
  await api.run(`__radius.ctx.events.emit('tideRising')`); await api.frames(3); await snap('tide-rising');
  await api.run(`__radius.ctx.events.emit('tide', 1); __radius.ctx.state.data.tideDay += 3; __radius.setTime(12)`); await api.frames(3);
  // weather + ambience one-shots
  await api.run(`__radius.ctx.ambience.force('rain', 30); __radius.ctx.ambience.force('volley')`); await api.frames(6); await snap('rain-volley');
  // base interior
  await api.run(`__radius.teleport(0, 302)`); await api.frames(6); await snap('base');
  await api.run(`__radius.teleport(0, 270)`); await api.frames(4); await snap('outside-again');
  // start/stop twice: sources must all end (stop() fades 1.2 s then stops every source)
  for (let i = 0; i < 2; i++) {
    await api.run(`__radius.ctx.music.stop(); __radius.ctx.ambience.stop()`);
    await api.wait(2200); await api.frames(2); await snap(`stopped-${i}`);
    await api.run(`__radius.ctx.music.start(); __radius.ctx.ambience.start()`);
    await api.frames(4); await snap(`restarted-${i}`);
  }
  await api.screenshot('music-final');
}
