// Kill a mimic, walk up to what it leaves, and check the whole chain: a pile is spawned, the interact
// prompt appears when you are actually facing it, pressing use opens the loot panel, and the panel is
// holding the gear the enemy was carrying. The earlier drops test teleported next to the body without
// turning to face it, so interact.update rejected it on the facing test and the prompt was never seen.
export default async function (page, api) {
  await api.start();
  await api.run(`window.__radius.god(true); window.__radius.teleport(30, 170);`);
  await api.frames(2);

  const spawned = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const e = window.__radius.spawn('mimic', 34, 170);
    return e ? { type: e.type, cls: e.cls, weapon: e.weapon, armour: e.armour || null, hp: e.hp } : null;
  })()`);
  console.log('SPAWNED ' + JSON.stringify(spawned));

  // Kill it, then advance the simulation directly. deathDuration is 2.2 s and main.js clamps dt to
  // 0.05, so the pile needs ~45 ticks — waiting on 45 *rendered* frames instead makes the test hostage
  // to software-rendering throughput, which is under half a frame a second on a loaded box.
  const killed = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    let n = 0;
    for (const e of ctx.enemies.list) if (e.alive) { e.damage(9999, { kind: 'bullet' }); n++; }
    for (let i = 0; i < 80; i++) { ctx.elapsed += 0.05; ctx.enemies.update(0.05); }
    return n;
  })()`);
  console.log('KILLED ' + killed);

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
  await api.frames(3);   // interact.update reads the camera, so this needs real frames — but only a few

  const prompt = await api.run(`(() => {
    const ctx = window.__radius.ctx, c = ctx.interact.current;
    return { hasTarget: !!c, prompt: c ? (typeof c.prompt === 'function' ? c.prompt() : c.prompt) : '' };
  })()`);
  console.log('PROMPT ' + JSON.stringify(prompt));

  // press use and see what the panel is holding
  await api.run(`window.__radius.press('interact');`);
  await api.frames(4);
  const panel = await api.run(`(() => {
    const ctx = window.__radius.ctx;
    const open = ctx.panels.isOpen, id = ctx.panels.current, data = ctx.panels.data;
    const entries = (data && data.pile && data.pile.entries) || [];
    return { open, id, name: data && data.pile ? data.pile.name : null,
             entries: entries.map((e) => ({ kind: e.kind, id: e.id, count: e.count || 1 })) };
  })()`);
  console.log('PANEL ' + JSON.stringify(panel, null, 1));
  console.log(`SUMMARY pile=${!!pile} prompt=${prompt.hasTarget} panel=${panel.open} items=${panel.entries.length}`);
}
