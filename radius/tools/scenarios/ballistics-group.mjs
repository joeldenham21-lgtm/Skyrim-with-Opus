// Practical accuracy end to end: a real weapon, real sway, real recoil, real projectiles, into a witness
// wall at 50 and 100 m. Reports the group with the aim reset between shots (dispersion + sway) and the
// group when the string is fired without touching the mouse (dispersion + sway + the recoil pattern).
// node tools/smoke.mjs --scenario tools/scenarios/ballistics-group.mjs --out .smoke/ballistics-group
export default async function (page, api) {
  await api.run('window.__radius.start()');
  await api.wait(1500);
  const out = await api.run(`(() => {
  const r = window.__radius, c = r.ctx, T = c.THREE, B = c.ballistics;
  r.god(); r.teleport(30, 130); r.setTime(11); c.debug.noEnemies = true; c.enemies.removeAll();
  const p = c.player, inv = c.inventory;
  const rows = [];
  const stubAim = (on) => { const od = c.input.down; c.input.down = (a) => (a === 'aim' ? on : false); return () => { c.input.down = od; }; };

  function equip(id, ammoId, reuse) {
    if (reuse && c.weapons.current && c.weapons.current.id === id) return c.weapons.current.record;
    r.giveWeapon(id);
    const w = inv.weapons[inv.weapons.length - 1];
    inv.equipment.primary = w.uid;
    if (w.mag) { w.mag.rounds = 60; w.mag.ammo = ammoId; }
    w.chamber = ammoId; w.dirt = 0; w.parts.barrel = 100; w.parts.bolt = 100; w.parts.frame = 100;
    c.weapons.onInventoryChanged(); c.weapons.equipSlot('primary');
    for (let i = 0; i < 60; i++) { c.weapons.update(0.05); c.hands.update(0.05); c.player.update(0.05); }
    return w;
  }
  function group(id, ammoId, R, ads, resetAim, shots, cond, reuse) {
    const w = equip(id, ammoId, reuse);
    if (reuse && w.mag) { w.mag.rounds = 60; w.mag.ammo = ammoId; w.chamber = w.chamber || ammoId; }
    if (cond) { w.parts.barrel = cond.barrel; w.dirt = cond.dirt; c.weapons.refresh(); }
    if (!c.weapons.current || c.weapons.current.id !== id) return { id, error: 'not equipped' };
    c.state.data.stamina = 100;
    // Find a bearing with nothing in the way out to R, or the ground eats half the string and the
    // surviving rounds are the high ones — which reads as a group twice its real size, printed high.
    for (let i = 0; i < 8; i++) { c.weapons.update(0.05); c.hands.update(0.05); c.player.update(0.05); }
    let yaw = null;
    for (let i = 0; i < 48 && yaw === null; i++) {
      const y = (i / 48) * Math.PI * 2;
      const d = new T.Vector3(-Math.sin(y), 0, -Math.cos(y));
      const h = c.world.raycast(p.eye, d, R - 1);
      if (!h) yaw = y;
    }
    if (yaw === null) return { id, ammo: ammoId, R, ads, resetAim, error: 'no clear lane at ' + R + ' m' };
    p.setLook(yaw, 0);
    for (let i = 0; i < 8; i++) { c.weapons.update(0.05); c.hands.update(0.05); c.player.update(0.05); }
    const eye = p.eye.clone();
    const fwd = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new T.Vector3(-fwd.z, 0, fwd.x);
    const wc = eye.clone().addScaledVector(fwd, R);
    const wall = c.world.addBox(wc.x, eye.y, wc.z, Math.abs(side.x) > 0.7 ? 0.5 : 60, 40, Math.abs(side.x) > 0.7 ? 60 : 0.5, { surface: 'concrete', tag: 'groupwit' });
    const un = stubAim(ads);
    for (let i = 0; i < (ads ? 40 : 8); i++) { c.weapons.update(0.05); c.hands.update(0.05); c.player.update(0.05); B.update(0.05); }
    const adsBlend = c.weapons.adsBlend, spread = c.weapons.spreadDeg;
    const caught = [];
    const real = B.shoot.bind(B);
    B.shoot = (o, d, opts) => { const res = real(o, d, opts); if (opts && opts.source === 'player') caught.push(...res); return res; };
    let fired = 0;
    for (let i = 0; i < shots; i++) {
      if (resetAim) p.setLook(yaw, 0);
      if (w.mag) w.mag.rounds = 60;
      w.chamber = w.chamber || ammoId;
      if (w.jammed) { w.jammed = false; w.jamKind = null; c.weapons.refresh(); }
      const before = c.state.data.stats.shots;
      c.weapons.fire();
      if (c.state.data.stats.shots > before) fired++;
      // wait out the whole cycle, or a bolt gun contributes two rounds to a twelve-round group
      for (let k = 0; k < 60; k++) {
        c.weapons.update(0.04); c.hands.update(0.04); c.player.update(0.04); B.update(0.04);
        if (k >= 4 && c.weapons.state === 'idle' && !c.weapons.stage) break;
      }
      // a rifle this filthy stops about one pull in ten; clear it so the group is still twelve rounds
      if (w.jammed) { w.jammed = false; w.jamKind = null; c.weapons.refresh(); }
      if (cond) { w.parts.barrel = cond.barrel; w.dirt = cond.dirt; c.weapons.refresh(); }
    }
    for (let i = 0; i < 120; i++) { if (caught.every((s) => s.done !== false)) break; B.update(0.02); }
    B.shoot = real;
    const pts = [];
    for (const s of caught) for (const h of (s.hits || [])) {
      if (!h.point) continue;
      const rel = h.point.clone().sub(eye);
      if (Math.abs(rel.dot(fwd) - R) < 1.5) pts.push(h.point);
    }
    wall.dead = true; un();
    if (!pts.length) return { id, ammo: ammoId, R, ads, resetAim, fired, error: 'no impacts', spreadDeg: +spread.toFixed(3), adsBlend: +adsBlend.toFixed(2) };
    let mx = 0, my = 0;
    const rels = pts.map((q) => { const r0 = q.clone().sub(eye); return [r0.dot(side), r0.y]; });
    for (const [a, b] of rels) { mx += a; my += b; }
    mx /= rels.length; my /= rels.length;
    let sum = 0, ext = 0;
    for (const [a, b] of rels) { const d = Math.hypot(a - mx, b - my); sum += d; ext = Math.max(ext, d); }
    return { id, ammo: ammoId, R, ads, resetAim, fired, n: pts.length,
      spreadDeg: +spread.toFixed(3), adsBlend: +adsBlend.toFixed(2),
      meanRadiusCm: +(sum / pts.length * 100).toFixed(1), extremeCm: +(ext * 100).toFixed(1),
      centreOffsetCm: [+(mx * 100).toFixed(1), +(my * 100).toFixed(1)] };
  }
  rows.push(group('akm', '762_fmj', 50, true, true, 14));
  rows.push(group('akm', '762_fmj', 100, true, true, 14));
  rows.push(group('akm', '762_fmj', 50, false, true, 14));
  rows.push(group('akm', '762_fmj', 50, true, false, 10));
  rows.push(group('mosin', '754_snb', 100, true, true, 12));
  rows.push(group('pm', '9x18_fmj', 25, true, true, 12));
  // the same rifle, shot out and filthy: the zero walks and it walks the same way every time
  const worn = group('akm', '762_fmj', 100, true, true, 12, { barrel: 25, dirt: 0.8 });
  worn.id = 'akm (barrel 25%, filthy)';
  worn.bias = c.weapons.aimBias.map((x) => +(x * 1000).toFixed(3));
  rows.push(worn);
  const worn2 = group('akm', '762_fmj', 100, true, true, 12, { barrel: 25, dirt: 0.8 }, true);
  worn2.id = 'akm (the same rifle again)';
  worn2.bias = c.weapons.aimBias.map((x) => +(x * 1000).toFixed(3));
  rows.push(worn2);
  return rows;
})()`);
  console.log('PRACTICAL GROUPS (mean radius / extreme, from the point of aim)');
  for (const g of out) {
    if (g.error) { console.log(`  ${g.id} ${g.R}m ads=${g.ads} ERROR ${g.error} fired=${g.fired} spread=${g.spreadDeg} adsBlend=${g.adsBlend}`); continue; }
    console.log(`  ${String(g.id).padEnd(26)} ${String(g.R).padStart(3)}m ads=${g.ads ? 'Y' : 'n'} recoilFree=${g.resetAim ? 'Y' : 'n'} n=${String(g.n).padStart(3)}  spread=${String(g.spreadDeg).padStart(6)}deg  group ${String(g.meanRadiusCm).padStart(6)}/${String(g.extremeCm).padStart(6)} cm  centre ${JSON.stringify(g.centreOffsetCm)}${g.bias ? ' bias(mrad) ' + JSON.stringify(g.bias) : ''}`);
  }
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
