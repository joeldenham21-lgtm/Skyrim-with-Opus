// Is the music actually audible in a running game?
//   node tools/smoke.mjs --audio --scenario tools/scenarios/music-levels.mjs --out .smoke/music-levels
//
// Taps the MUSIC BUS and the MASTER BUS with ScriptProcessors (every sample, not polled analyser
// snapshots — a guitar pluck's attack is 3 ms and falls between analyser polls), pins the Director
// in each state for a real measuring window, and reports peak / RMS / crest for each.
// Reference: shot_pm peaks 0.66-0.73 on the master bus played alone.
const STATES = ['CALM', 'UNEASE', 'HUNT', 'COMBAT', 'AFTERMATH'];

export default async function (page, api) {
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  await api.start();
  await R(`c.audio.resume();`);
  await api.wait(400);

  // ---- taps ----
  await R(`
    const a = c.audio, ac = a.ctx;
    const sink = ac.createGain(); sink.gain.value = 0; sink.connect(ac.destination);
    const tap = (node, key) => {
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
    window.__taps = { music: tap(a.musicBus, 'music'), master: tap(a.master, 'master') };
    window.__resetTaps = () => { for (const k in window.__taps) { const t = window.__taps[k]; t.peak = 0; t.sumSq = 0; t.n = 0; t.nonFinite = 0; t.blocks = 0; } };
    window.__readTaps = () => { const o = {}; for (const k in window.__taps) { const t = window.__taps[k];
      o[k] = { peak: +t.peak.toFixed(4), rms: +(t.n ? Math.sqrt(t.sumSq / t.n) : 0).toFixed(5), db: +(20 * Math.log10(Math.max(1e-9, t.n ? Math.sqrt(t.sumSq / t.n) : 0))).toFixed(1), blocks: t.blocks, nonFinite: t.nonFinite }; } return o; };
    window.__pin = (s) => { if (window.__pinIv) clearInterval(window.__pinIv); window.__pinState = s; window.__pinIv = setInterval(() => { try { c.director.setState(s); } catch (e) {} }, 150); };
    window.__unpin = () => { if (window.__pinIv) clearInterval(window.__pinIv); window.__pinIv = null; };
  `);

  // reference: shot_pm alone
  await page.evaluate('window.__resetTaps()');
  await R(`c.audio.play('shot_pm', { gain: 1 });`);
  await api.wait(700);
  console.log('REF shot_pm ' + JSON.stringify(await page.evaluate('window.__readTaps()')));

  // silence everything but music: stop ambience so the music bus reading is unpolluted at master too
  await R(`c.ambience.stop && c.ambience.stop();`);
  await api.wait(600);

  const out = {};
  for (const s of STATES) {
    await R(`window.__pin(${JSON.stringify(s)});`);
    await api.wait(2500);                 // let the fades settle
    await page.evaluate('window.__resetTaps()');
    await api.wait(9000);                 // long window: the score is sparse on purpose
    const m = await page.evaluate('window.__readTaps()');
    const info = await R(`return { state: c.director.state, tension: +c.director.tension.toFixed(2), levels: c.music.levels ? c.music.levels() : null };`);
    out[s] = m;
    console.log('STATE ' + s + ' ' + JSON.stringify(m) + ' ' + JSON.stringify(info));
  }
  await R(`window.__unpin();`);

  // settings.music respected?
  await R(`c.state.data.settings.music = 0.2; c.audio.setMusicVolume(0.2); window.__pin('CALM');`);
  await api.wait(2000); await page.evaluate('window.__resetTaps()'); await api.wait(6000);
  console.log('MUSIC_VOL_0.2 ' + JSON.stringify(await page.evaluate('window.__readTaps()')));
  await R(`c.state.data.settings.music = 0; c.audio.setMusicVolume(0);`);
  await api.wait(1500); await page.evaluate('window.__resetTaps()'); await api.wait(4000);
  console.log('MUSIC_VOL_0 ' + JSON.stringify(await page.evaluate('window.__readTaps()')));
  await R(`c.state.data.settings.music = 0.8; c.audio.setMusicVolume(0.8); window.__unpin();`);

  console.log('SUMMARY ' + JSON.stringify(out));
  console.log('ERRORS ' + JSON.stringify(await R(`return [...(c.audio.missing || [])];`)));
}
