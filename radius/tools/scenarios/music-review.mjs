// Hostile review of music.js + ambience.js: stack-attributed source counting (leaks per module), live peak/RMS
// per Director state measured with AnalyserNodes on the music/amb buses (and NaN detection at master), every
// canonical ambience name exercised (one-shots + loops with stop) inside try/catch, state/night/tide/base
// transitions, and two stop/start cycles. Few frames per step: the software renderer is slow.
export default async function (page, api) {
  await api.run(`(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const S = window.__src = { made: 0, live: 0, music: 0, musicLive: 0, amb: 0, ambLive: 0, unscheduled: 0 };
    const attr = (st) => /build(Floor|Unease|Hunt|Combat|Aftermath|Tide|Base)\\d*\\b/.test(st) ? 'music' : /\\b(acquire|playAt|playAround|dripAt)\\d*\\b/.test(st) ? 'amb' : 'other';
    for (const k of ['createOscillator', 'createBufferSource']) {
      const orig = AC.prototype[k];
      AC.prototype[k] = function () {
        const o = orig.call(this); const who = attr(new Error().stack || '');
        S.made++; S.live++; if (who === 'music') { S.music++; S.musicLive++; } else if (who === 'amb') { S.amb++; S.ambLive++; }
        o.__who = who; o.__stopAt = null;
        const os = o.stop; o.stop = function (t) { o.__stopAt = t ?? 'now'; return os.call(this, t); };
        o.addEventListener('ended', () => { S.live--; if (who === 'music') S.musicLive--; else if (who === 'amb') S.ambLive--; if (o.__stopAt === null) S.unscheduled++; });
        return o;
      };
    }
  })()`);
  await api.start();
  await api.run(`(async () => {
    const a = __radius.ctx.audio; a.ensure(); await a.ctx.resume();
    const mk = (node) => { const an = a.ctx.createAnalyser(); an.fftSize = 2048; node.connect(an); return an; };
    window.__an = { music: mk(a.musicBus), amb: mk(a.ambBus), master: mk(a.master) };
    window.__buf = new Float32Array(2048);
    window.__meas = (ms) => new Promise((res) => {
      const acc = {}; for (const k in window.__an) acc[k] = { peak: 0, rms: 0, n: 0, nan: 0 };
      const t0 = performance.now();
      const iv = setInterval(() => {
        for (const k in window.__an) {
          const an = window.__an[k], b = window.__buf; an.getFloatTimeDomainData(b);
          let p = 0, s = 0, nan = 0;
          for (let i = 0; i < b.length; i++) { const v = b[i]; if (!Number.isFinite(v)) { nan++; continue; } const av = Math.abs(v); if (av > p) p = av; s += v * v; }
          const o = acc[k]; if (p > o.peak) o.peak = p; o.rms += Math.sqrt(s / b.length); o.n++; o.nan += nan;
        }
        if (performance.now() - t0 >= ms) { clearInterval(iv); const out = {}; for (const k in acc) { const o = acc[k]; out[k] = { peak: +o.peak.toFixed(3), rms: +(o.rms / Math.max(1, o.n)).toFixed(4), nan: o.nan, n: o.n }; } res(out); }
      }, 40);
    });
    window.__played = [];
    const origPlay = a.play; a.play = (name, opts) => { window.__played.push(name + '@' + (opts && opts.pos ? [opts.pos.x, opts.pos.y, opts.pos.z].map((v) => (+v).toFixed(0)).join(',') : '2d')); return origPlay(name, opts); };
  })()`);
  const snap = async (label) => {
    const r = await api.run(`(() => { const c = __radius.ctx; return { label: ${JSON.stringify(label)}, mode: c.mode, ready: c.audio.ready, built: c.music.built, state: c.director.state, tension: +c.director.tension.toFixed(2), night: +c.time.night.toFixed(2), tideIn: Math.round(c.time.tideIn()), inBase: c.player.inBase, levels: c.music.levels(), amb: c.ambience.debug(), src: { ...window.__src }, played: window.__played.splice(0), storm: +(c.lighting.storm).toFixed(3), missing: [...c.audio.missing], err: c._errorLogged || false }; })()`);
    console.log(JSON.stringify(r));
    return r;
  };
  const meas = async (label, ms) => { const r = await api.run(`window.__meas(${ms})`); console.log('MEAS ' + label + ' ' + JSON.stringify(r)); return r; };

  await api.frames(2); await snap('calm');
  await meas('calm', 2500);
  // every canonical ambience name, one-shot (positional + 2D) and loop (set/setGain/update/stop), inside try/catch
  const ex = await api.run(`(() => {
    const a = __radius.ctx.audio, c = __radius.ctx; const out = { fails: [], missingBefore: [...a.missing] };
    const P = c.player.position.clone(); P.y += 1.6; P.x += 3;
    for (const n of ['crow', 'bird', 'distant_shot', 'drip']) {
      try { const h = a.play(n, { pos: P, gain: 0.5, rate: 1.05, hrtf: true, bus: 'amb' }); if (!h) out.fails.push(n + ':null'); const h2 = a.play(n, { gain: 0.3, rate: 0.9 }); if (!h2) out.fails.push(n + ':2d-null'); } catch (e) { out.fails.push(n + ':' + e.message); }
    }
    for (const n of ['wind', 'radius_hum', 'base_hum', 'drizzle']) {
      try { const h = a.loop(n, { bus: 'amb', gain: 0.2 }); if (!h) { out.fails.push(n + ':null'); continue; } h.set('intensity', 0.7); h.set('gust', 0.5); h.setGain(0.3, 0.1); h.update(0.016); h.stop(0.2); } catch (e) { out.fails.push(n + ':' + e.message); }
    }
    out.missingAfter = [...a.missing];
    out.has = ['wind', 'radius_hum', 'base_hum', 'drizzle', 'crow', 'bird', 'distant_shot', 'drip'].map((n) => n + '=' + a.has(n));
    return out;
  })()`);
  console.log('EXERCISE ' + JSON.stringify(ex));
  await api.run(`__radius.ctx.director.setState('UNEASE')`); await api.frames(2); await meas('unease', 3500);
  await api.run(`__radius.ctx.director.setState('HUNT')`); await api.frames(2); await meas('hunt', 3500);
  await api.run(`__radius.ctx.director.setState('COMBAT'); __radius.ctx.director.notify('shot', { pos: __radius.ctx.player.position })`); await api.frames(2);
  await api.run(`__radius.ctx.director.notify('shot', { pos: __radius.ctx.player.position })`); await api.frames(1); await meas('combat', 3500); await snap('combat');
  await api.run(`__radius.ctx.director.setState('AFTERMATH')`); await api.frames(2); await meas('aftermath', 4000); await snap('aftermath');
  await api.run(`__radius.ctx.director.setState('CALM'); __radius.setTime(22.5)`); await api.frames(2); await meas('night', 2500); await snap('night');
  // base interior first (tide.js plays its siren with a plain map record as pos and throws outside the base; not ours)
  await api.run(`__radius.teleport(0, 302); __radius.ctx.ambience.force('drip')`); await api.frames(2); await snap('base'); await meas('base', 2500);
  await api.run(`__radius.setTime(4.5); __radius.ctx.state.data.tideDay = __radius.ctx.state.data.day`); await api.frames(2); await meas('tide-window', 3000); await snap('tide-window');
  await api.run(`__radius.ctx.events.emit('tideRising')`); await api.frames(2); await meas('tide-rising', 3500); await snap('tide-rising');
  await api.run(`__radius.ctx.events.emit('tide', 1); __radius.ctx.state.data.tideDay += 3; __radius.setTime(12)`); await api.frames(2);
  await api.run(`__radius.teleport(0, 270)`); await api.frames(2); await snap('outside');
  await api.run(`__radius.ctx.ambience.force('rain', 20); __radius.ctx.ambience.force('volley'); __radius.ctx.ambience.force('crow'); __radius.ctx.ambience.force('bird')`); await api.frames(3); await snap('rain-volley-birds');
  await meas('rain', 2000);
  for (let i = 0; i < 2; i++) {
    await api.run(`__radius.ctx.music.stop(); __radius.ctx.ambience.stop()`);
    await api.wait(2600); await api.frames(1); await snap('stopped-' + i); await meas('stopped-' + i, 800);
    await api.run(`__radius.ctx.music.start(); __radius.ctx.ambience.start()`);
    await api.frames(3); await snap('restarted-' + i);
  }
  await meas('final', 1500);
}
