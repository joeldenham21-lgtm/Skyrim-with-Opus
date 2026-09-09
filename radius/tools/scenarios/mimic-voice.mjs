// "they dont say anything currently". The vocabulary exists and mimic.js calls it, so the question is whether
// it reaches the ears. Every enemy sound is positional, and until the panner fix a fresh PannerNode glided
// from the world origin — which at Vanno is 284 m away — gutting exactly the short bursts a voice is made of.
// Spawn a mimic near the player, trigger each line, and measure the master bus.
export default async function (page, api) {
  await api.run(`(async () => { const a = window.__radius.ctx.audio; a.ensure(); await a.ctx.resume(); })()`);
  await api.start();
  await api.run(`(() => {
    const a = window.__radius.ctx.audio, ac = a.ctx;
    const sp = ac.createScriptProcessor(2048, 2, 2), sink = ac.createGain();
    sink.gain.value = 0; a.master.connect(sp); sp.connect(sink); sink.connect(ac.destination);
    window.__acc = { peak: 0 };
    sp.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > window.__acc.peak) window.__acc.peak = v; } };
    window.__reset = () => { window.__acc = { peak: 0 }; };
  })()`);
  await api.frames(4);

  const LINES = ['mimic_radio', 'mimic_spot', 'mimic_shot', 'mimic_hit', 'mimic_death', 'mimic_skip', 'mimic_step'];
  const at = async (label, dist, name) => {
    await api.run(`window.__reset();`);
    await api.run(`(() => {
      const c = window.__radius.ctx, p = c.player.eye;
      const f = c.player.forward;
      c.audio.play(${JSON.stringify(name)}, { pos: { x: p.x + f.x * ${dist}, y: p.y, z: p.z + f.z * ${dist} }, gain: 1 });
    })()`);
    await api.wait(900);
    const r = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4) }))()`);
    return r.peak;
  };

  const near = {}, far = {};
  for (const n of LINES) near[n] = await at('near', 6, n);
  for (const n of LINES) far[n] = await at('far', 40, n);
  console.log('VOICE_NEAR_6M  ' + JSON.stringify(near));
  console.log('VOICE_FAR_40M  ' + JSON.stringify(far));

  // and a real mimic actually speaking of its own accord
  await api.run(`window.__reset();`);
  const spoke = await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player;
    const rec = []; const a = c.audio, orig = a.play.bind(a);
    a.play = (n, o) => { if (n.startsWith('mimic_')) rec.push(n); return orig(n, o); };
    const e = r.spawn('mimic', p.position.x + 9, p.position.z - 6);
    if (e) { e.aware = 1; e.setEngaged && e.setEngaged(true); }
    for (let i = 0; i < 900; i++) { c.elapsed += 0.05; try { c.enemies.update(0.05); } catch (err) { return { error: String(err && err.message) }; } }
    a.play = orig;
    const counts = {}; for (const n of rec) counts[n] = (counts[n] || 0) + 1;
    return { spoke: rec.length, counts };
  })()`);
  await api.wait(600);
  const livePeak = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4) }))()`);
  console.log('LIVE_MIMIC ' + JSON.stringify(spoke) + ' peak=' + livePeak.peak);
  const silent = LINES.filter((n) => near[n] < 0.01);
  console.log(`SUMMARY registered=${LINES.length} silentAt6m=${silent.length ? silent.join(',') : 'none'} linesSpokenIn45s=${spoke.spoke}`);
}
