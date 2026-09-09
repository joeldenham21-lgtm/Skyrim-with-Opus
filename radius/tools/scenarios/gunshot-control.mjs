// Control for the gunshot measurement. In-game shots read far quieter than the same sound played from the
// console, and the peaks climb through the test in step with how much rendering surrounds each one. Under
// SwiftShader the audio thread starves (Chromium logs "SyncReader::Read timed out, audio glitch count"), so a
// ScriptProcessor tap drops buffers exactly when the renderer is busiest. Play the SAME sound under both
// conditions — quiet, and while forcing frames — and see whether the level is a property of the sound or of
// the load. If both collapse, the earlier in-game figures were my instrument, not the game.
export default async function (page, api) {
  await api.run(`(async () => { const a = window.__radius.ctx.audio; a.ensure(); await a.ctx.resume(); })()`);
  await api.start();
  await api.run(`(() => {
    const a = window.__radius.ctx.audio, ac = a.ctx;
    const sp = ac.createScriptProcessor(2048, 2, 2), sink = ac.createGain();
    sink.gain.value = 0; a.master.connect(sp); sp.connect(sink); sink.connect(ac.destination);
    window.__acc = { peak: 0, n: 0, blocks: 0 };
    sp.onaudioprocess = (e) => { const A = window.__acc; A.blocks++; const d = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > A.peak) A.peak = v; A.n++; } };
    window.__reset = () => { window.__acc = { peak: 0, n: 0, blocks: 0 }; };
  })()`);
  await api.frames(4);

  const quiet = async (label, js) => {
    await api.run(`window.__reset();`);
    await api.run(js);
    await api.wait(900);
    const r = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4), blocks: window.__acc.blocks }))()`);
    console.log(label + ' ' + JSON.stringify(r));
    return r;
  };
  const loaded = async (label, js) => {
    await api.run(`window.__reset();`);
    await api.run(js);
    await api.frames(4);              // ~4 s of software rendering, hammering the CPU
    await api.wait(200);
    const r = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4), blocks: window.__acc.blocks }))()`);
    console.log(label + ' ' + JSON.stringify(r));
    return r;
  };

  const PLAY_RAW = `window.__radius.ctx.audio.play('shot_pm', { gain: 1 });`;
  const PLAY_POS = `(() => { const c = window.__radius.ctx, p = c.player.eye; c.audio.play('shot_pm', { pos: { x: p.x, y: p.y, z: p.z }, gain: 1 }); })()`;
  const FIRE = `(() => { const c = window.__radius.ctx; c.weapons.equipSlot?.(0); c.weapons.fire(); })()`;

  const a = await quiet('RAW_QUIET     ', PLAY_RAW);
  const b = await loaded('RAW_UNDER_LOAD', PLAY_RAW);
  const c = await quiet('POS_QUIET     ', PLAY_POS);
  const d = await loaded('POS_UNDER_LOAD', PLAY_POS);
  const e = await quiet('FIRE_QUIET    ', FIRE);
  const f = await loaded('FIRE_UNDER_LOAD', FIRE);

  const drop = (q, l) => (q.peak > 1e-4 ? +(l.peak / q.peak).toFixed(2) : null);
  console.log(`SUMMARY raw ${a.peak}->${b.peak} (x${drop(a, b)})  pos ${c.peak}->${d.peak} (x${drop(c, d)})  fire ${e.peak}->${f.peak} (x${drop(e, f)})`);
  console.log('VERDICT ' + (drop(a, b) !== null && drop(a, b) < 0.5
    ? 'load alone collapses the measured peak — the in-game figures were the instrument'
    : 'load does not explain it — firing really is quieter'));
}
