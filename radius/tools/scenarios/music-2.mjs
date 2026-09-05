// Ambience path coverage: if the sfx registry does not yet provide the ambience names, register minimal
// in-page stand-ins so loops/one-shots are actually acquired, positioned, faded and released.
export default async function (page, api) {
  await api.start();
  await api.run(`(async () => { const a = __radius.ctx.audio; a.ensure(); await a.ctx.resume(); })()`);
  await api.run(`(() => {
    const a = __radius.ctx.audio;
    window.__played = [];
    const origPlay = a.play; a.play = (name, opts) => { window.__played.push(name + '@' + (opts && opts.pos ? opts.pos.toArray().map((v) => v.toFixed(0)).join(',') : '2d')); return origPlay(name, opts); };
    window.__loopsMade = [];
    for (const n of ['wind', 'radius_hum', 'base_hum', 'drizzle']) {
      if (a.has(n)) continue;
      a.registerLoop(n, (audio, out) => { window.__loopsMade.push(n); const s = audio.noise('pink'); const f = audio.filter('lowpass', 300, 0.5); s.connect(f); f.connect(out); return { stop() { s.stop(); }, set() {}, update() {} }; });
    }
    for (const n of ['crow', 'bird', 'distant_shot', 'drip']) {
      if (a.has(n)) continue;
      a.register(n, (audio, out) => { const o = audio.osc('sine', 700); const g = audio.gain(0); o.connect(g); g.connect(out); const t = audio.now; audio.env(g.gain, [[0.01, 0.4], [0.3, 0.0001, 'exp']], t); o.start(t); o.stop(t + 0.35); });
    }
  })()`);
  const snap = async (label) => {
    const r = await api.run(`(() => { const c = __radius.ctx; return { label: ${JSON.stringify(label)}, state: c.director.state, inBase: c.player.inBase, amb: c.ambience.debug(), played: window.__played.splice(0), loopsMade: window.__loopsMade.splice(0), storm: +(c.lighting.storm).toFixed(3), live: [...(c.audio.missing)] }; })()`);
    console.log(JSON.stringify(r));
    return r;
  };
  await api.frames(3); await api.run(`__radius.ctx.director.setState('CALM')`);
  await api.frames(8); await snap('loops-acquired');
  await api.run(`__radius.ctx.ambience.force('crow'); __radius.ctx.ambience.force('bird'); __radius.ctx.ambience.force('volley')`);
  await api.frames(3); await snap('calm-calls');
  await api.frames(10); await snap('volley-drained');
  // UNEASE: birds must stay silent even when their timers are due
  await api.run(`__radius.ctx.director.setState('UNEASE'); __radius.ctx.ambience.force('crow'); __radius.ctx.ambience.force('bird')`);
  await api.frames(4); await snap('unease-silent');
  await api.run(`__radius.ctx.director.setState('CALM'); __radius.ctx.ambience.force('rain', 4)`);
  await api.frames(8); await snap('rain-on');
  // base: base_hum acquired, drips, wind ducked; leaving releases base_hum
  await api.run(`__radius.teleport(0, 302)`); await api.frames(8); await api.run(`__radius.ctx.ambience.force('drip')`); await api.frames(3); await snap('base');
  await api.run(`__radius.teleport(0, 270)`); await api.frames(8); await snap('outside');
  await api.run(`__radius.ctx.ambience.stop()`); await api.wait(1500); await api.frames(2); await snap('stopped');
}
