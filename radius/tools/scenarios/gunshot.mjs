// "weapons make no gunshot sounds currently" — measure it. Start a real game, equip, fire through the
// same input path the player uses, and read the master bus. Also wrap audio.play to record every name
// asked for and every one that came back null, so a culled or unregistered shot is distinguishable
// from one that played and was inaudible.
export default async function (page, api) {
  await api.run(`(async () => { const a = window.__radius.ctx.audio; a.ensure(); await a.ctx.resume(); return a.ctx.state; })()`);
  await api.start();
  await api.run(`(() => {
    const c = window.__radius.ctx, a = c.audio;
    const rec = window.__rec = { played: [], nulls: [] };
    const p = a.play.bind(a);
    a.play = (n, o) => {
      const h = p(n, o);
      const L = c.audio.listenerPos;
      rec.played.push({ n, pos: o && o.pos ? [+o.pos.x.toFixed(1), +o.pos.y.toFixed(1), +o.pos.z.toFixed(1)] : null,
                        listener: [+L.x.toFixed(1), +L.y.toFixed(1), +L.z.toFixed(1)],
                        dist: o && o.pos ? +Math.hypot(o.pos.x - L.x, o.pos.y - L.y, o.pos.z - L.z).toFixed(2) : null,
                        gain: o ? o.gain : null });
      if (!h) rec.nulls.push(n);
      return h;
    };
    // tap the master bus: a ScriptProcessor sees every sample, an AnalyserNode poll does not
    const ac = a.ctx, sp = ac.createScriptProcessor(2048, 2, 2), sink = ac.createGain();
    sink.gain.value = 0; a.master.connect(sp); sp.connect(sink); sink.connect(ac.destination);
    window.__acc = { peak: 0, n: 0 };
    sp.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > window.__acc.peak) window.__acc.peak = v; window.__acc.n++; } };
    window.__reset = () => { window.__acc = { peak: 0, n: 0 }; };
  })()`);
  await api.frames(4);

  const before = await api.run(`(() => {
    const c = window.__radius.ctx, w = c.weapons;
    return { mode: c.mode, current: w.current ? w.current.id : null, audioState: c.audio.ctx.state,
             listener: c.audio.listenerPos.toArray().map((v) => +v.toFixed(1)),
             player: c.player.position.toArray().map((v) => +v.toFixed(1)) };
  })()`);
  console.log('BEFORE ' + JSON.stringify(before));

  // fire the way the player does: press the bound key through the input layer
  await api.run(`window.__reset(); window.__rec.played.length = 0; window.__rec.nulls.length = 0;`);
  await api.run(`(() => { const c = window.__radius.ctx; c.weapons.equipSlot?.(0); })()`);
  await api.frames(6);
  await page.mouse.down();
  await api.frames(4);
  await page.mouse.up();
  await api.frames(6);
  await api.wait(700);
  const viaMouse = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4), played: window.__rec.played.slice(), nulls: window.__rec.nulls.slice() }))()`);
  console.log('FIRE_VIA_MOUSE ' + JSON.stringify(viaMouse));

  // and directly, to separate "the input never reached tryFire" from "tryFire made no sound"
  await api.run(`window.__reset(); window.__rec.played.length = 0; window.__rec.nulls.length = 0;`);
  await api.run(`(() => { const c = window.__radius.ctx; c.weapons.fire(); })()`);
  await api.frames(6);
  await api.wait(700);
  const direct = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4), played: window.__rec.played.slice(), nulls: window.__rec.nulls.slice() }))()`);
  console.log('FIRE_DIRECT ' + JSON.stringify(direct));

  // the raw generator, with no positional path at all — is the recipe itself alive?
  await api.run(`window.__reset();`);
  await api.run(`(() => { window.__radius.ctx.audio.play('shot_pm', { gain: 1 }); })()`);
  await api.wait(700);
  const raw = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4) }))()`);
  console.log('RAW_SHOT_PM ' + JSON.stringify(raw));

  // and positionally at the muzzle, which is how weapons.js plays it
  await api.run(`window.__reset();`);
  await api.run(`(() => { const c = window.__radius.ctx; const p = c.player.eye; c.audio.play('shot_pm', { pos: { x: p.x, y: p.y, z: p.z }, gain: 1 }); })()`);
  await api.wait(700);
  const positional = await api.run(`(() => ({ peak: +window.__acc.peak.toFixed(4) }))()`);
  console.log('POSITIONAL_AT_EYE ' + JSON.stringify(positional));

  const state = await api.run(`(() => {
    const c = window.__radius.ctx, w = c.weapons, rec = w.current;
    return { current: rec ? rec.id : null, chamber: rec ? rec.chamber : null, mag: rec && rec.mag ? rec.mag.rounds : null,
             missing: [...c.audio.missing], errors: c._errors ? [...c._errors.keys()] : [] };
  })()`);
  console.log('STATE ' + JSON.stringify(state));
  console.log(`SUMMARY mouse=${viaMouse.peak} direct=${direct.peak} raw=${raw.peak} positional=${positional.peak}`);
}
