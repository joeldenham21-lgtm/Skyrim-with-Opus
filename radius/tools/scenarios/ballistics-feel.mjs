// The feel bench: over-penetration through bodies, the lead a moving target needs, the recoil pattern and how
// much of it comes back, sight sway with and without a held breath, suppression from incoming fire, stoppage
// kinds, barrel heat, and the cost of having a lot of rounds in the air.
// node tools/smoke.mjs --scenario tools/scenarios/ballistics-feel.mjs --out .smoke/ballistics-feel
export default async function (page, api) {
  await api.run('window.__radius.start()');
  await api.wait(1500);
  await api.run(`(() => { const r = window.__radius; r.god(); r.teleport(30, 130); r.setTime(11); r.ctx.debug.noEnemies = true; r.ctx.enemies.removeAll(); })()`);

  const out = await api.run(`(() => {
  const r = window.__radius, c = r.ctx, T = c.THREE, B = c.ballistics;
  const L = {};
  const pump = (shots, n = 400) => { for (let i = 0; i < n; i++) { if (shots.every((s) => s.done !== false)) break; B.update(0.02); } };

  // ---- over-penetration through bodies: two men in a line ----
  L.overpen = [];
  for (const ammo of ['9x18_fmj', '762_fmj', '762_ap', '754_ap', '12_buck']) {
    c.enemies.removeAll();
    const p = c.player;
    const a = c.enemies.spawn('mimic', new T.Vector3(p.position.x + 6, p.position.y, p.position.z), {});
    const b = c.enemies.spawn('mimic', new T.Vector3(p.position.x + 7.2, p.position.y, p.position.z), {});
    if (!a || !b) { L.overpen.push({ ammo, error: 'spawn failed' }); continue; }
    a.hp = a.maxHp = 100000; b.hp = b.maxHp = 100000;
    // strip the rolled loadout: this bench measures the round, not whatever vest the mimic drew
    for (const e of [a, b]) { e.armorPieces = null; e.vest = null; e.helmet = null; e.armor = null; }
    const o = new T.Vector3(p.position.x, a.position.y + 1.25, p.position.z);
    const shots = [];
    for (let i = 0; i < 8; i++) shots.push(...B.shoot(o, new T.Vector3(1, 0, 0), { ammo, source: 'player', spreadDeg: 0, tracer: false }));
    pump(shots);
    L.overpen.push({ ammo, front: +(100000 - a.hp).toFixed(0), behind: +(100000 - b.hp).toFixed(0), shots: 8 });
  }
  c.enemies.removeAll();

  // ---- lead: how far in front of a walking man you have to shoot ----
  L.lead = [];
  for (const [ammo, cls] of [['9x18_fmj', 'pistol'], ['762_fmj', 'rifle'], ['545_fmj', 'rifle'], ['754_snb', 'sniper']]) {
    const row = { ammo };
    for (const R of [25, 50, 100, 200]) {
      const o = new T.Vector3(0, 600, 0);
      const w = c.world.addBox(R, 600, 0, 0.4, 30, 30, { surface: 'concrete', tag: 'leadwit' });
      const s = B.shoot(o, new T.Vector3(1, 0, 0), { ammo, cls, source: 'player', spreadDeg: 0, tracer: false });
      pump(s);
      w.dead = true;
      const tof = s[0].tof;
      row['R' + R] = { tofMs: +(tof * 1000).toFixed(0), leadCm: +(tof * 3.0 * 100).toFixed(0), holdoverCm: +(B.holdover(ammo, R, cls) * 100).toFixed(1) };
    }
    L.lead.push(row);
  }

  // ---- recoil: fire a string and watch the muzzle climb, then let it settle ----
  function recoilTrace(id, shots) {
    const inv = c.inventory;
    r.giveWeapon(id);
    const w = inv.weapons[inv.weapons.length - 1];
    inv.equipment.primary = w.uid;                       // straight into the hands, no holster dance
    inv.fillMags && inv.fillMags(w);
    c.weapons.onInventoryChanged();
    c.weapons.equipSlot('primary');
    for (let i = 0; i < 60; i++) { c.weapons.update(0.05); c.player.update(0.05); }
    const cur = c.weapons.current;
    if (!cur || cur.id !== id) return { id, error: 'not equipped: ' + (cur && cur.id) };
    // top it up so the string never runs dry mid-measurement
    if (cur.mag) { cur.mag.rounds = 60; cur.mag.ammo = cur.mag.ammo || null; }
    if (!cur.chamber && cur.mag && cur.mag.ammo) cur.chamber = cur.mag.ammo;
    for (let i = 0; i < 10; i++) { c.weapons.update(0.05); c.player.update(0.05); }
    c.player.setLook(0, 0);
    const trace = [], yawTrace = [];
    let fired = 0;
    for (let i = 0; i < shots; i++) {
      const before = c.state.data.stats.shots;
      c.weapons.fire();
      if (c.state.data.stats.shots > before) fired++;
      for (let k = 0; k < 3; k++) { c.weapons.update(0.033); c.player.update(0.033); }
      trace.push(+(c.player.pitch * 180 / Math.PI).toFixed(2));
      yawTrace.push(+(c.player.yaw * 180 / Math.PI).toFixed(2));
    }
    const peak = c.player.pitch * 180 / Math.PI, peakYaw = c.player.yaw * 180 / Math.PI;
    for (let i = 0; i < 40; i++) { c.weapons.update(0.033); c.player.update(0.033); }
    const settled = c.player.pitch * 180 / Math.PI, settledYaw = c.player.yaw * 180 / Math.PI;
    return { id, fired, climbDeg: +peak.toFixed(2), afterRecoveryDeg: +settled.toFixed(2), recoveredPct: +(100 * (1 - settled / (peak || 1))).toFixed(0),
      yawDeg: +peakYaw.toFixed(2), yawAfter: +settledYaw.toFixed(2), trace, yawTrace, heat: +c.weapons.heat.toFixed(2) };
  }
  L.recoil = [];
  for (const id of ['akm', 'ak74m', 'pm']) { try { L.recoil.push(recoilTrace(id, 10)); } catch (e) { L.recoil.push({ id, error: String(e) }); } }

  // ---- the same pattern twice: does the weapon walk the same way? ----
  try {
    const a = recoilTrace('akm', 8), b = recoilTrace('akm', 8);
    L.patternRepeat = { yawA: a.yawTrace, yawB: b.yawTrace };
  } catch (e) { L.patternRepeat = { error: String(e) }; }

  return L;
})()`);
  console.log('OVER-PENETRATION (8 rounds into a man, second man 1.2 m behind; damage taken)');
  for (const o of out.overpen) console.log(`  ${String(o.ammo).padEnd(10)} front ${String(o.front).padStart(7)}  behind ${String(o.behind).padStart(7)}`);
  console.log('LEAD AND HOLDOVER (lead for a target crossing at 3 m/s)');
  for (const r of out.lead) {
    const cells = [25, 50, 100, 200].map((R) => { const c = r['R' + R]; return `${R}m ${String(c.tofMs).padStart(4)}ms lead ${String(c.leadCm).padStart(4)}cm hold ${String(c.holdoverCm).padStart(7)}cm`; });
    console.log(`  ${r.ammo.padEnd(10)} ${cells.join(' | ')}`);
  }
  console.log('RECOIL');
  for (const r of out.recoil) console.log('  ' + JSON.stringify(r));
  console.log('PATTERN REPEAT', JSON.stringify(out.patternRepeat));

  // ---- sway, breath, suppression, stoppages, heat, cost ----
  const feel = await api.run(`(() => {
  const r = window.__radius, c = r.ctx, T = c.THREE, B = c.ballistics;
  const L = {};
  const hands = c.hands, sd = c.state.data;
  // Same 3 s window for every case, the first second thrown away so the blend has settled, and RMS
  // rather than peak-to-peak so the slow drift term does not decide the answer by phase alone.
  function swayOver(ads, stamina, hold) {
    sd.stamina = stamina;
    hands.adsBlend = ads;
    const od = c.input.down, oe = c.input.enabled;
    c.input.enabled = true;
    c.input.down = (a) => (a === 'sprint' ? !!hold : false);
    for (let i = 0; i < 30; i++) hands.update(1 / 60);
    let sx = 0, sy = 0, n = 0, peak = 0;
    for (let i = 0; i < 120; i++) {
      hands.update(1 / 60);
      const rx = c.camera.rotation.x, ry = c.camera.rotation.y;
      sx += rx * rx; sy += ry * ry; n++;
      peak = Math.max(peak, Math.hypot(rx, ry));
    }
    const holding = hands.holdingBreath;
    c.input.down = od; c.input.enabled = oe;
    const D = 180 / Math.PI;
    const rms = Math.sqrt((sx + sy) / n);
    return { pitchRmsDeg: +(Math.sqrt(sx / n) * D).toFixed(3), yawRmsDeg: +(Math.sqrt(sy / n) * D).toFixed(3),
      cmAt100m: +(rms * 100 * 100).toFixed(1), peakCmAt100m: +(peak * 100 * 100).toFixed(1), holding, stamina: +sd.stamina.toFixed(0) };
  }
  L.sway = {
    hip_rested: swayOver(0, 100, false),
    ads_rested: swayOver(1, 100, false),
    ads_winded: swayOver(1, 12, false),
    ads_held: swayOver(1, 100, true),
    ads_held_winded: swayOver(1, 60, true),
  };
  sd.stamina = 100; hands.adsBlend = 0;

  // ---- suppression: rounds cracking past the player's head ----
  const p = c.player;
  // 25 m out, level with the eye, aimed to pass 0.7 m to one side: a miss the Explorer can hear.
  // Pick a bearing with nothing in the way first, or the ground takes the round before it gets here.
  let o = null, dir = null;
  for (let i = 0; i < 24 && !o; i++) {
    const ang = (i / 24) * Math.PI * 2;
    const oo = new T.Vector3(p.eye.x + Math.cos(ang) * 25, p.eye.y, p.eye.z + Math.sin(ang) * 25);
    const dd = new T.Vector3(p.eye.x, p.eye.y, p.eye.z).sub(oo).normalize();
    if (!c.world.raycast(oo, dd, 24)) {
      o = oo;
      const aim = new T.Vector3(p.eye.x - Math.sin(ang) * 0.7, p.eye.y, p.eye.z + Math.cos(ang) * 0.7);
      dir = aim.sub(oo).normalize();
    }
  }
  if (!o) { o = new T.Vector3(p.eye.x + 25, p.eye.y, p.eye.z); dir = new T.Vector3(-1, 0, 0.028).normalize(); }
  const before = B.suppression;
  const s = B.shoot(o, dir, { ammo: '762_fmj', cls: 'rifle', source: 'enemy', spreadDeg: 0, tracer: false, shooter: null });
  for (let i = 0; i < 60; i++) { if (s.every((x) => x.done !== false)) break; B.update(0.02); }
  L.suppression = { before: +before.toFixed(3), after: +B.suppression.toFixed(3), whiz: !!s[0].whiz,
    hitPlayer: s[0].hits.some((h) => h.kind === 'player'), ended: s[0].hits.map((h) => h.kind + '@' + h.distance.toFixed(1)).join(','), hp: +sd.hp.toFixed(0) };
  for (let i = 0; i < 60; i++) B.update(0.05);
  L.suppression.decayedAfter3s = +B.suppression.toFixed(3);

  // ---- stoppages: what a filthy, worn weapon actually does ----
  const w = c.weapons.current;
  const kinds = {};
  if (w) {
    for (let trial = 0; trial < 120; trial++) {
      w.record.dirt = 1; w.record.parts.bolt = 15; w.record.jammed = false; w.record.jamKind = null;
      c.weapons.refresh();
      if (w.record.mag) { w.record.mag.rounds = 20; w.record.mag.ammo = w.record.mag.ammo || '7.62x39'; }
      w.record.chamber = w.record.chamber || (w.record.mag && w.record.mag.ammo) || null;
      for (let i = 0; i < 12 && !w.record.jammed; i++) { if (w.record.mag) { w.record.mag.rounds = 20; } w.record.chamber = w.record.chamber || (w.record.mag && w.record.mag.ammo); c.weapons.fire(); c.weapons.update(0.3); c.player.update(0.3); }
      if (w.record.jammed) kinds[w.record.jamKind || '?'] = (kinds[w.record.jamKind || '?'] || 0) + 1;
    }
    w.record.dirt = 0; w.record.parts.bolt = 100; w.record.jammed = false; w.record.jamKind = null;
    c.weapons.refresh();
  }
  L.stoppages = kinds;

  // ---- heat from a magazine dumped in one string ----
  if (w) {
    if (w.record.mag) { w.record.mag.rounds = 60; }
    w.record.chamber = w.record.chamber || (w.record.mag && w.record.mag.ammo);
    const h0 = c.weapons.heat;
    let heatShots = 0; for (let i = 0; i < 30; i++) { if (w.record.mag) w.record.mag.rounds = 60; w.record.chamber = w.record.chamber || (w.record.mag && w.record.mag.ammo); const b = c.state.data.stats.shots; c.weapons.fire(); if (c.state.data.stats.shots > b) heatShots++; c.weapons.update(0.3); c.player.update(0.3); }
    const h1 = c.weapons.heat;
    for (let i = 0; i < 200; i++) c.weapons.update(0.05);
    L.heat = { start: +h0.toFixed(2), shots: heatShots, afterString: +h1.toFixed(2), after10s: +c.weapons.heat.toFixed(2) };
  }

  // ---- cost: a burst in the air ----
  const t0 = performance.now();
  const shots = [];
  for (let i = 0; i < 30; i++) shots.push(...B.shoot(new T.Vector3(0, 300, 0), new T.Vector3(1, 0.05, 0.02).normalize(), { ammo: '545_fmj', cls: 'rifle', source: 'player', spreadDeg: 1, tracer: false }));
  let steps = 0;
  while (!shots.every((x) => x.done !== false) && steps < 200) { B.update(1 / 60); steps++; }
  const t1 = performance.now();
  L.cost = { rounds: shots.length, steps, totalMs: +(t1 - t0).toFixed(2), msPerStep: +((t1 - t0) / Math.max(1, steps)).toFixed(3) };
  L.inFlight = B.inFlight;
  return L;
})()`);
  console.log('SWAY (sight picture over a 2 s window, half a second of settle discarded)');
  for (const [k, v] of Object.entries(feel.sway)) console.log(`  ${k.padEnd(16)} pitch ${String(v.pitchRmsDeg).padStart(6)} deg  yaw ${String(v.yawRmsDeg).padStart(6)} deg  = ${String(v.cmAt100m).padStart(6)} cm rms / ${String(v.peakCmAt100m).padStart(6)} cm peak at 100 m   holding=${v.holding} stamina=${v.stamina}`);
  console.log('SUPPRESSION', JSON.stringify(feel.suppression));
  console.log('STOPPAGE KINDS', JSON.stringify(feel.stoppages));
  console.log('HEAT', JSON.stringify(feel.heat));
  console.log('COST', JSON.stringify(feel.cost), 'inFlight', feel.inFlight);
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
