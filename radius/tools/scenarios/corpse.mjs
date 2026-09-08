// Kill a mimic, walk up to what it leaves, and check the whole chain: a pile is spawned, the interact
// prompt appears when you are actually facing it, pressing use opens the loot panel, and the panel is
// holding the gear the enemy was carrying. The earlier drops test teleported next to the body without
// turning to face it, so interact.update rejected it on the facing test and the prompt was never seen.
export default async function (page, api) {
  await api.start();
  await api.run(`window.__radius.god(true); window.__radius.teleport(30, 170);`);
  await api.frames(4);

  const spawned = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const e = window.__radius.spawn('mimic', 34, 170);
    return e ? { type: e.type, cls: e.cls, weapon: e.weapon, armour: e.armour || null, hp: e.hp } : null;
  })()`);
  console.log('SPAWNED ' + JSON.stringify(spawned));

  // kill it, then let real frames run: deathDuration is 2.2 s and dt is clamped to 0.05, so the pile
  // only appears after ~45 frames of simulation, not after one big step.
  await api.run(`(() => { const ctx = window.__radius.ctx; for (const e of ctx.enemies.list) if (e.alive) e.damage(9999, { kind: 'bullet' }); })()`);
  await api.frames(90);

  const pile = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const m = ctx.loot.markers().filter((k) => k.kind === 'corpse');
    if (!m.length) return null;
    const p = m[m.length - 1];
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), kind: p.kind };
  })()`);
  console.log('PILE ' + JSON.stringify(pile));
  if (!pile) { console.log('SUMMARY no-corpse'); return; }

  // stand 1.3 m away and look straight at it
  const facing = await api.run(`(() => {
    const ctx = window.__radius.ctx, P = ${JSON.stringify(pile)};
    const px = ctx.player.position.x, pz = ctx.player.position.z;
    let dx = P.x - px, dz = P.z - pz; const d = Math.hypot(dx, dz) || 1;
    const sx = P.x - dx / d * 1.3, sz = P.z - dz / d * 1.3;
    ctx.player.teleport(sx, sz);
    window.__radius.setLook(Math.atan2(-(P.x - sx), -(P.z - sz)), -0.35);
    return { standAt: [+sx.toFixed(2), +sz.toFixed(2)] };
  })()`);
  console.log('FACING ' + JSON.stringify(facing));
  await api.frames(6);

  const prompt = await api.run(`(() => {
    const ctx = window.__radius.ctx, c = ctx.interact.current;
    return { hasTarget: !!c, prompt: c ? (typeof c.prompt === 'function' ? c.prompt() : c.prompt) : '' };
  })()`);
  console.log('PROMPT ' + JSON.stringify(prompt));
  await api.screenshot('facing-corpse');

  // press use and see what the panel is holding
  await api.run(`window.__radius.press('interact');`);
  await api.frames(8);
  const panel = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const open = ctx.panels.isOpen, id = ctx.panels.current, data = ctx.panels.data;
    const entries = (data && data.pile && data.pile.entries) || [];
    return { open, id, name: data && data.pile ? data.pile.name : null,
             entries: entries.map((e) => ({ kind: e.kind, id: e.id, count: e.count || 1 })) };
  })()`);
  console.log('PANEL ' + JSON.stringify(panel, null, 1));
  await api.screenshot('loot-panel');
  console.log(`SUMMARY pile=${!!pile} prompt=${prompt.hasTarget} panel=${panel.open} items=${panel.entries.length}`);
}
