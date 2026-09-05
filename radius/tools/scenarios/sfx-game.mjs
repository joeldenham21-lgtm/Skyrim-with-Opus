// sfx in the real game: start, fire/reload, damage, panels, spawn every entity and anomaly type, cycle the Director
// states (music transitions), then report audio.missing, null plays and console errors. Few frames: software renderer.
// node tools/smoke.mjs --out .smoke/sfx-game --scenario tools/scenarios/sfx-game.mjs --w 640 --h 360
export default async function (page, api) {
  await api.run(`(async () => { const a = window.__radius.ctx.audio; a.ensure(); await a.ctx.resume(); return a.ctx.state; })()`);
  await api.start();
  await api.run(`(() => {
    const a = window.__radius.ctx.audio; const rec = window.__sfxrec = { played: {}, nulls: {}, loops: {} };
    const p = a.play.bind(a), l = a.loop.bind(a);
    a.play = (n, o) => { rec.played[n] = (rec.played[n] || 0) + 1; const h = p(n, o); if (!h) rec.nulls[n] = (rec.nulls[n] || 0) + 1; return h; };
    a.loop = (n, o) => { rec.loops[n] = (rec.loops[n] || 0) + 1; return l(n, o); };
  })()`);
  await api.frames(2);
  await api.run(`(() => { const r = window.__radius, c = r.ctx; r.god(); c.weapons.equipSlot?.(0); c.weapons.fire(); })()`);
  await api.frames(3);
  await api.run(`(() => { const c = window.__radius.ctx; c.weapons.reload(); c.player.damage(6, { kind: 'bullet', bleed: true }); c.panels.open('inventory'); })()`);
  await api.frames(2);
  await api.run(`(() => { const r = window.__radius, c = r.ctx; c.panels.close(); const p = c.player.position;
    r.spawn('mimic', p.x + 9, p.z - 4); r.spawn('slider', p.x - 8, p.z + 3); r.spawn('fragment', p.x + 3, p.z - 9); r.spawn('spawn', p.x - 5, p.z - 7); r.spawn('seeker', p.x + 14, p.z + 6);
    r.spawnAnomaly('electric', p.x + 6, p.z + 6); r.spawnAnomaly('reflector', p.x - 7, p.z - 3); r.spawnAnomaly('gravity', p.x + 2, p.z + 11); r.spawnAnomaly('gas', p.x - 10, p.z + 8);
    c.director.setState('UNEASE'); })()`);
  await api.frames(4);
  await api.run(`(() => { const c = window.__radius.ctx; c.director.setState('HUNT'); c.weapons.fire(); })()`);
  await api.frames(3);
  await api.run(`(() => { const c = window.__radius.ctx; c.director.setState('COMBAT'); for (const e of c.enemies.list) if (e.alive && e.type !== 'seeker') e.damage(500, { kind: 'bullet' }); })()`);
  await api.frames(4);
  await api.run(`(() => { const c = window.__radius.ctx; c.director.setState('AFTERMATH'); c.audio.play('tide_warn'); c.events.emit('tideWarning', 'hour'); })()`);
  await api.frames(3);
  await api.run(`(() => { const c = window.__radius.ctx; c.director.setState('CALM'); c.player.damage(1000, { kind: 'bullet' }); })()`);
  await api.frames(3);
  const out = await api.run(`(() => { const r = window.__radius, a = r.ctx.audio; return { rec: window.__sfxrec, missing: [...a.missing], state: a.ctx.state, stats: r.stats(), director: r.ctx.director.state, music: r.ctx.music && r.ctx.music.state }; })()`);
  console.log('GAME sfx:', JSON.stringify(out));
  if (out.missing.length) throw new Error('missing sounds: ' + out.missing.join(' '));
  const nulls = Object.keys(out.rec.nulls);
  console.log('null plays (possibly distance-culled):', JSON.stringify(out.rec.nulls));
}
