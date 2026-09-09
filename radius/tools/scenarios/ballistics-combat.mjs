// Integration: real mimics shooting at a real player for half a minute of simulated time, driven directly.
// Checks that the projectile path survives contact with the AI, that incoming fire still lands, that near
// misses register, and what it all costs per frame.
// node tools/smoke.mjs --scenario tools/scenarios/ballistics-combat.mjs --out .smoke/ballistics-combat
export default async function (page, api) {
  await api.run('window.__radius.start()');
  await api.wait(1500);
  const runs = [];
  for (let pass = 0; pass < 3; pass++) runs.push(await api.run(`(() => {
  const r = window.__radius, c = r.ctx, T = c.THREE;
  r.teleport(30, 130); r.setTime(11);
  c.debug.noEnemies = true; c.enemies.removeAll();
  c.state.data.hp = 100; c.state.data.stamina = 100; c.state.data.bleeding = false; if (c.player.dead) c.player.revive && c.player.revive(); c.player.revive && c.player.revive();
  const p = c.player;
  const B = c.ballistics;
  let enemyShots = 0, playerHits = 0, whizzes = 0, worldHits = 0, maxSupp = 0, errors = [];
  const realShoot = B.shoot.bind(B);
  B.shoot = (o, d, opts) => { if (opts && opts.source === 'enemy') enemyShots++; return realShoot(o, d, opts); };
  const spawned = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const e = c.enemies.spawn('mimic', new T.Vector3(p.position.x + Math.cos(a) * 22, p.position.y, p.position.z + Math.sin(a) * 22), {});
    if (e) { e.aware = 1; e.engaged = true; e.lastSeenPlayer = p.position.clone(); spawned.push(e); }
  }
  const t0 = performance.now();
  let frames = 0;
  for (let i = 0; i < 700; i++) {
    try {
      c.elapsed += 0.05; c.frame++;
      c.player.update(0.05);
      c.hands.update(0.05);
      c.weapons.update(0.05);
      c.enemies.update(0.05);
      c.director.update(0.05);
      B.update(0.05);
      frames++;
      maxSupp = Math.max(maxSupp, B.suppression);
    } catch (e) { errors.push(String(e && e.stack || e)); if (errors.length > 3) break; }
    if (c.player.dead) break;
  }
  const t1 = performance.now();
  B.shoot = realShoot;
  return {
    frames, simSeconds: +(frames * 0.05).toFixed(1), enemyShots,
    hp: +c.state.data.hp.toFixed(1), dead: c.player.dead, maxSuppression: +maxSupp.toFixed(2),
    inFlight: B.inFlight, enemiesAlive: c.enemies.list.filter((e) => e.alive).length,
    msPerFrame: +((t1 - t0) / Math.max(1, frames)).toFixed(3), errors: errors.slice(0, 3),
  };
})()`));
  for (const out of runs) console.log('COMBAT', JSON.stringify(out));
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
