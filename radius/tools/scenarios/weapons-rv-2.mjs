// Weapons review pass 2: the state machine driven synchronously (hands/weapons.update stepped by hand) so the
// software renderer does not gate it: staged PM reload with sounds, empty reload, T loading, fouling -> stoppage ->
// clear, TOZ break-open cycle, Mosin bolt and clip, idempotent equipSlot, holster survives a pickup.
// node tools/smoke.mjs --out .smoke/weapons-rv-2 --scenario tools/scenarios/weapons-rv-2.mjs --w 320 --h 180
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  const out = await api.run(`(() => {
    const r = window.__radius, c = r.ctx, W = c.weapons, inv = c.inventory;
    r.god(); r.teleport(30, 130); r.setLook(0.2, 0); r.setTime(11);
    const rec = {}; const p = c.audio.play.bind(c.audio); c.audio.play = (n, o) => { rec[n] = (rec[n] || 0) + 1; return p(n, o); };
    const step = (s) => { const n = Math.ceil(s / 0.05); for (let i = 0; i < n; i++) { c.hands.update(0.05); W.update(0.05); } };
    const stages = (s) => { const seen = []; const n = Math.ceil(s / 0.05); for (let i = 0; i < n; i++) { c.hands.update(0.05); W.update(0.05); const k = W.state + ':' + W.stage; if (seen[seen.length - 1] !== k) seen.push(k); } return seen; };
    const html = () => document.getElementById('ammo').innerHTML;
    const log = {};
    step(0.5);
    const w = W.current; log.start = { id: w.id, chamber: w.chamber, mags: w.mags.slice(), state: W.state, html: html() };
    for (let i = 0; i < 3; i++) { W.fire(); step(0.2); }
    log.fired = { shots: c.state.data.stats.shots, chamber: w.chamber, mags: w.mags.slice(), dirt: +w.dirt.toFixed(3), shot: rec.shot_pm };
    W.reload(); log.reload = stages(1.5); log.afterReload = { chamber: w.chamber, mags: w.mags.slice(), magIndex: w.magIndex, html: html() };
    w.chamber = 0; w.mags[w.magIndex] = 0; W.onInventoryChanged(); W.fire(); step(0.3);
    log.dry = { clicks: rec.dry_click || 0, html: html() };
    W.reload(); log.reloadEmpty = stages(2.0); log.afterReloadEmpty = { chamber: w.chamber, mags: w.mags.slice(), magIndex: w.magIndex };
    inv.addAmmo('9x18', 3); const before = inv.ammoCount('9x18'); W.loadMag(); log.load = stages(2.6); log.afterLoad = { mags: w.mags.slice(), loose: inv.ammoCount('9x18'), loaded: before - inv.ammoCount('9x18'), rounds: rec.mag_load_round || 0 };
    w.dirt = 1; let tries = 0; while (!w.jammed && tries < 200) { W.fire(); step(0.2); tries++; if (w.chamber === 0) w.chamber = 1; }
    log.jam = { jammed: w.jammed, tries, state: W.state, html: html(), sound: rec.jam || 0 };
    W.fire(); step(0.3); W.reload(); log.unjam = stages(1.4); log.afterUnjam = { jammed: w.jammed, state: W.state, dirt: +w.dirt.toFixed(2), sound: rec.unjam || 0 };
    r.giveWeapon('toz'); inv.addAmmo('12ga', 4); W.equipSlot(1); step(0.8);
    const t = W.current; t.mags[0] = 0; W.onInventoryChanged(); log.toz = { id: t.id, mags: t.mags.slice(), html: html() };
    W.reload(); log.tozLoad = stages(2.4); log.tozLoaded = { mags: t.mags.slice(), loose: inv.ammoCount('12ga') };
    W.fire(); step(0.4); W.fire(); step(0.4); W.fire(); step(0.3);
    log.tozFired = { mags: t.mags.slice(), shots: c.state.data.stats.shots, dry: rec.dry_click, shot: rec.shot_toz };
    W.reload(); log.tozReload2 = stages(2.4); log.tozAfter = { mags: t.mags.slice(), loose: inv.ammoCount('12ga') };
    r.giveWeapon('mosin'); inv.addAmmo('7.62x54', 5); W.equipSlot(2); step(0.8);
    const m = W.current; log.mosin = { id: m.id, chamber: m.chamber, mags: m.mags.slice(), html: html() };
    W.fire(); log.bolt = stages(1.3); log.afterBolt = { chamber: m.chamber, mags: m.mags.slice(), state: W.state, shot: rec.shot_mosin };
    m.mags[0] = 1; m.chamber = 0; W.reload(); log.clip = stages(2.0); log.afterClip = { chamber: m.chamber, mags: m.mags.slice(), magIndex: m.magIndex };
    W.equipSlot(2); step(0.4); log.idem = { cur: W.current && W.current.id };
    W.holster(); step(0.5); inv.add('bandage', 1); step(0.3); log.holstered = { cur: W.current && W.current.id, weaponMesh: !!c.hands.weapon };
    W.equipSlot(0); step(0.6); log.redraw = { cur: W.current && W.current.id, state: W.state };
    log.sfx = rec; log.missing = [...c.audio.missing]; log.fov = c.camera.fov;
    return log;
  })()`);
  console.log('MECH', JSON.stringify(out, null, 1));
  await api.frames(2);
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
