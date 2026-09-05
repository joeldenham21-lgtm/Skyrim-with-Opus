// Spawn review: pack looks at noon and at night with the torch; swarm and bites; a pack behind a wall must not
// be dragged through it; death curl and ash. AI stepped through enemies.update() without rendering.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.teleport(30, 130); r.setLook(0.2, -0.32); r.setTime(12); r.god();
    const p = r.ctx.player; p.update(0); const f = p.forward; const T = r.ctx.THREE; const c = new T.Vector3(p.position.x + f.x * 3.2, 0, p.position.z + f.z * 3.2);
    window.__sp = [];
    for (let i = 0; i < 5; i++) { const a = i * 1.3, rr = 0.6 + (i % 3) * 0.55; const e = r.spawn('spawn', c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, { pack: c, yaw: p.yaw + Math.PI + (i - 2) * 0.5 }); e.aware = 0; e.playerVisibility = () => 0; window.__sp.push(e); }
  })()`);
  await api.frames(5);
  await api.screenshot('spawn-pack-noon');
  await api.run(`(() => { const r = window.__radius; r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(5);
  await api.screenshot('spawn-night-torch');
  // behaviour: release perception; the pack should swarm and bite
  const beh = await api.run(`(() => { const r = window.__radius, ctx = r.ctx; r.setTime(12); ctx.state.data.flashlight.on = false; r.god(false); r.setLook(0.2, -0.1);
    const p = ctx.player; p.update(0);
    for (let i = 0; i < window.__sp.length; i++) { const e = window.__sp[i]; delete e.playerVisibility; e.position.set(p.position.x + p.forward.x * (8 + i * 0.7) + (i - 2) * 1.1 * p.forward.z, 0, p.position.z + p.forward.z * (8 + i * 0.7) - (i - 2) * 1.1 * p.forward.x); e.followGround(0); }
    const hp0 = ctx.state.data.hp; let bites = 0, lastHp = hp0, firstSwarm = -1, firstBite = -1; const trace = [];
    for (let i = 0; i < 600; i++) {
      ctx.enemies.update(1 / 30);
      const hp = ctx.state.data.hp; if (hp < lastHp) { bites++; if (firstBite < 0) firstBite = i; } lastHp = hp;
      if (firstSwarm < 0 && window.__sp.some((e) => e.state === 'swarm')) firstSwarm = i;
      if (i % 120 === 0) trace.push({ i, st: window.__sp.map((e) => e.state[0]).join(''), d: window.__sp.map((e) => +e.distanceToPlayer().toFixed(1)) });
      if (bites >= 4) break;
    }
    // hit one: it should retreat then come back
    window.__sp[1].damage(5, { kind: 'bullet' }); const afterHit = window.__sp[1].state;
    for (let i = 0; i < 60; i++) ctx.enemies.update(1 / 30); const afterHit2 = window.__sp[1].state;
    return { firstSwarm, firstBite, bites, hp: ctx.state.data.hp, trace, afterHit, afterHit2, director: ctx.director.state };
  })()`);
  console.log('behaviour', JSON.stringify(beh));
  // walls: a pack at an interior spawn spot of Zarya with the player outside the building; none may end in a solid
  const walls = await api.run(`(() => { const r = window.__radius, ctx = r.ctx, w = ctx.world; r.god();
    const spots = w.spawnSpots.filter((s) => s.kind === 'interior' && s.poi === 'zarya'); if (!spots.length) return { noSpots: true };
    const sp = spots[0].position; const c = sp.clone();
    // player 9 m from the spot, on the far side of the nearest wall: try bearings until the point is outside any solid and has no LOS
    let placed = null;
    for (let k = 0; k < 24 && !placed; k++) { const a = k * (Math.PI / 12); const x = sp.x + Math.cos(a) * 9, z = sp.z + Math.sin(a) * 9; const y = w.groundHeight(x, z, w.getHeight(x, z) + 2).y; if (w.pointInSolid(x, y + 0.9, z)) continue; const T = ctx.THREE; if (w.lineOfSight(new T.Vector3(x, y + 1.6, z), new T.Vector3(sp.x, sp.y + 0.5, sp.z))) continue; placed = [x, z]; }
    if (!placed) return { noWall: true, spot: sp.toArray().map((v) => +v.toFixed(1)) };
    r.teleport(placed[0], placed[1]); ctx.player.update(0);
    ctx.enemies.removeAll(); const pack = [];
    for (let i = 0; i < 5; i++) { const a = i * 1.3, rr = 0.5 + (i % 3) * 0.4; const e = r.spawn('spawn', c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, { pack: c }); e.aware = 1; e.engaged = true; e.setState('swarm'); if (!e.lastSeenPlayer) e.lastSeenPlayer = ctx.player.position.clone(); pack.push(e); }
    let inSolid = 0, samples = 0;
    for (let i = 0; i < 450; i++) { ctx.enemies.update(1 / 30); if (i % 15 === 0) for (const e of pack) { samples++; if (w.pointInSolid(e.position.x, e.position.y + 0.2, e.position.z)) inSolid++; } }
    return { spot: sp.toArray().map((v) => +v.toFixed(1)), player: placed.map((v) => +v.toFixed(1)), inSolid, samples, states: pack.map((e) => e.state), d: pack.map((e) => +e.distanceToPlayer().toFixed(1)), bites: 100 - ctx.state.data.hp };
  })()`);
  console.log('walls', JSON.stringify(walls));
  // death curl, up close at noon
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, -0.4); r.ctx.enemies.removeAll(); const p = r.ctx.player; p.update(0);
    window.__d = r.spawn('spawn', p.position.x + p.forward.x * 2.2, p.position.z + p.forward.z * 2.2, { yaw: p.yaw + 2.2 }); window.__d.playerVisibility = () => 0; })()`);
  await api.frames(2);
  await api.run(`window.__d.damage(100, { kind: 'bullet' })`);
  await api.frames(3);
  await api.screenshot('spawn-death-curl');
  await api.frames(5);
  await api.screenshot('spawn-death-ash');
  await api.frames(5);
  const fin = await api.run(`(() => { const r = window.__radius; const s = r.stats(); return { enemies: s.enemies, calls: s.calls, missing: s.missingSounds, error: s.error }; })()`);
  console.log('final', JSON.stringify(fin));
}
