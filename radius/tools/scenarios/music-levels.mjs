// Is the music actually audible in a running game?
//   node tools/smoke.mjs --audio --scenario tools/scenarios/music-levels.mjs --out .smoke/music-levels
//
// Taps the MUSIC BUS and the MASTER BUS with ScriptProcessors — every sample, not polled analyser
// snapshots, because a guitar pluck's transient is 3-17 ms and falls between polls — pins the
// Director in each state for a long measuring window (the score is sparse on purpose, so a short
// window can catch a rest and read as silence) and reports peak / RMS / crest.
//
// Reference: shot_pm peaks 0.66-0.73 on the master bus played on its own, and this scenario measures
// that first so every other number is relative to something real.
//
// Under SwiftShader with a loaded machine the render loop can stall for minutes at a time. The music
// engine schedules on the audio clock and only needs update() to refill its horizon, so if the loop
// is not advancing this scenario drives ctx.music.update() from a timer instead and says so. That is
// still the real engine, the real graph and the real Director; only the caller changes.
const STATES = ['CALM', 'UNEASE', 'HUNT', 'COMBAT', 'AFTERMATH'];

export default async function (page, api) {
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  await api.run(`window.__radius.start()`);
  await R(`c.audio.resume();`);
  await api.wait(1200);

  // is the render loop alive?
  const f0 = await api.run(`window.__radius.ctx.frame`);
  await api.wait(2500);
  const f1 = await api.run(`window.__radius.ctx.frame`);
  const loopAlive = f1 - f0 >= 2;
  console.log('LOOP frames in 2.5 s: ' + (f1 - f0) + (loopAlive ? ' (render loop drives music)' : ' (STALLED: driving ctx.music.update from a timer)'));
  if (!loopAlive) {
    // The Director's tension is damped inside director.update, so it must be driven too or every
    // state reads with tension 0 and the weight curves never leave their floor.
    await api.run(`(() => { const c = window.__radius.ctx; let last = performance.now();
      window.__drive = setInterval(() => { const n = performance.now(); const dt = Math.min(0.25, (n - last) / 1000); last = n;
        try { c.elapsed += dt; c.director.update(dt); } catch (e) { window.__driveErr = 'dir: ' + String(e && e.message || e); }
        try { c.music.update(dt); } catch (e) { window.__driveErr = 'music: ' + String(e && e.stack || e); } }, 40); })()`);
  }

  await R(`
    const a = c.audio, ac = a.ctx;
    const sink = ac.createGain(); sink.gain.value = 0; sink.connect(ac.destination);
    const tap = (node) => {
      const sp = ac.createScriptProcessor(1024, 2, 2);
      node.connect(sp); sp.connect(sink);
      const acc = { peak: 0, sumSq: 0, n: 0, nonFinite: 0, blocks: 0 };
      sp.onaudioprocess = (e) => {
        acc.blocks++;
        for (let ch = 0; ch < e.inputBuffer.numberOfChannels; ch++) {
          const d = e.inputBuffer.getChannelData(ch);
          for (let i = 0; i < d.length; i++) { const v = d[i];
            if (!Number.isFinite(v)) { acc.nonFinite++; continue; }
            const m = v < 0 ? -v : v; if (m > acc.peak) acc.peak = m; acc.sumSq += v * v; acc.n++; }
        }
      };
      return acc;
    };
    window.__taps = { music: tap(a.musicBus), master: tap(a.master) };
    window.__resetTaps = () => { for (const k in window.__taps) { const t = window.__taps[k]; t.peak = 0; t.sumSq = 0; t.n = 0; t.nonFinite = 0; t.blocks = 0; } };
    window.__readTaps = () => { const o = {}; for (const k in window.__taps) { const t = window.__taps[k];
      const rms = t.n ? Math.sqrt(t.sumSq / t.n) : 0;
      o[k] = { peak: +t.peak.toFixed(4), rms: +rms.toFixed(5), rmsDb: +(20 * Math.log10(Math.max(1e-9, rms))).toFixed(1),
               crestDb: +(20 * Math.log10(t.peak / Math.max(1e-9, rms))).toFixed(1), blocks: t.blocks, nonFinite: t.nonFinite }; } return o; };
    window.__pin = (s) => { if (window.__pinIv) clearInterval(window.__pinIv); window.__pinIv = setInterval(() => { try { c.director.setState(s); } catch (e) {} }, 150); };
    window.__unpin = () => { if (window.__pinIv) clearInterval(window.__pinIv); window.__pinIv = null; };
  `);

  // Eight shots, not one: a 2 ms transient can land in a ScriptProcessor block the starved audio
  // thread drops, and a single sample of bad luck reads as a 10 dB quieter gun.
  await R(`window.__burst = async (name, n, gap) => { window.__resetTaps();
    for (let i = 0; i < n; i++) { c.audio.play(name, { gain: 1 }); await new Promise((r) => setTimeout(r, gap)); }
    await new Promise((r) => setTimeout(r, 500)); return window.__readTaps().master; };`);
  for (const n of ['shot_pm', 'shot_akm']) console.log('REF ' + n.padEnd(11) + JSON.stringify(await page.evaluate(`window.__burst(${JSON.stringify(n)}, 8, 420)`)));

  // what the music has to be heard over
  await R(`c.music.stop();`); await api.wait(2000);
  await page.evaluate('window.__resetTaps()'); await api.wait(10000);
  console.log('REF ambience   ' + JSON.stringify((await page.evaluate('window.__readTaps()')).master));
  await R(`c.music.start();`); await api.wait(2000);

  // ambience off so the master reading is the music alone
  await R(`c.ambience.stop && c.ambience.stop(); c.audio.stopAll && c.audio.stopAll(0.3);`);
  await api.wait(1000);
  await page.evaluate('window.__resetTaps()');
  await api.wait(3000);
  console.log('SILENCE        ' + JSON.stringify(await page.evaluate('window.__readTaps()')));

  const out = {};
  for (const s of STATES) {
    await R(`window.__pin(${JSON.stringify(s)});`);
    await api.wait(3500);
    await page.evaluate('window.__resetTaps()');
    await api.wait(18000);            // long enough to contain a whole guitar phrase and a rest
    const m = await page.evaluate('window.__readTaps()');
    const info = await R(`return { state: c.director.state, tension: +c.director.tension.toFixed(2), levels: c.music.levels ? c.music.levels() : null };`);
    out[s] = m.master;
    console.log('STATE ' + s.padEnd(10) + ' music=' + JSON.stringify(m.music) + '\n                 master=' + JSON.stringify(m.master) + '\n                 ' + JSON.stringify(info));
  }
  await R(`window.__unpin();`);

  // the volume control
  for (const v of [0.2, 0]) {
    await R(`c.state.data.settings.music = ${v}; c.audio.setMusicVolume(${v}); window.__pin('CALM');`);
    await api.wait(3000); await page.evaluate('window.__resetTaps()'); await api.wait(12000);
    console.log('settings.music=' + v + '  master=' + JSON.stringify((await page.evaluate('window.__readTaps()')).master));
  }
  await R(`c.state.data.settings.music = 0.8; c.audio.setMusicVolume(0.8); window.__unpin();`);

  // stop / start cycle: no leaks, no stuck sources, no errors
  const before = await R(`return c.music.levels();`);
  await R(`c.music.stop();`);
  await api.wait(2500); await page.evaluate('window.__resetTaps()'); await api.wait(3000);
  console.log('STOPPED        ' + JSON.stringify((await page.evaluate('window.__readTaps()')).master) + ' built=' + await R(`return c.music.built;`));
  await R(`c.music.start();`);
  await api.wait(4000);
  await page.evaluate('window.__resetTaps()'); await api.wait(10000);
  console.log('RESTARTED      ' + JSON.stringify((await page.evaluate('window.__readTaps()')).master) + ' ' + JSON.stringify(await R(`return c.music.levels();`)));
  console.log('LEVELS_BEFORE  ' + JSON.stringify(before));
  // the transition itself: how fast the section arrives, and whether the comedown is a comedown
  await R(`window.__pin('CALM');`); await api.wait(6000);
  await R(`window.__unpin(); c.director.setState('COMBAT'); window.__pin('COMBAT');`);
  for (const ms of [400, 900, 1500, 3000]) {
    await page.evaluate('window.__resetTaps()'); await api.wait(ms);
    console.log('  +' + ms + 'ms after COMBAT  ' + JSON.stringify((await page.evaluate('window.__readTaps()')).master));
  }
  await R(`window.__unpin(); c.director.setState('AFTERMATH'); window.__pin('AFTERMATH');`);
  for (const ms of [1500, 3000, 6000]) {
    await page.evaluate('window.__resetTaps()'); await api.wait(ms);
    console.log('  +' + ms + 'ms after AFTERMATH ' + JSON.stringify((await page.evaluate('window.__readTaps()')).master) + ' ' + JSON.stringify(await R(`return c.music.levels();`)));
  }
  await R(`window.__unpin();`);
  console.log('DRIVE_ERR      ' + JSON.stringify(await page.evaluate('window.__driveErr || null')));
  console.log('SUMMARY        ' + JSON.stringify(out));
}
