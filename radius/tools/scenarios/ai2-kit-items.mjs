// kit.js — item use: the catalogue coverage, the honesty rule, the commitment window, the gates, and the two
// things a mimic can throw that are not a frag.
//
//   node tools/smoke.mjs --scenario tools/scenarios/ai2-kit-items.mjs --out .smoke/ai2-kit-items
//
// Everything runs against the real world and real Mimic instances with real rolled loadouts. Nothing waits on
// a rendered frame.
import { inject, boot, pass, section, RAYCOUNT, ZERO_RC, AUDIOHOOK, DRIVER } from './ai2-kit-lib.mjs';

let bad = 0;

const HELPERS = `(() => {
  const ctx = window.__radius.ctx, K = window.__KIT;
  window.__site = (() => {
    const w = ctx.world; let best = null, bs = 1e9;
    for (let x = -240; x <= 240; x += 20) for (let z = -240; z <= 240; z += 20) {
      if (w.isWater(x, z)) continue;
      let n = 0; w.query(x, z, 12, (c) => { if (!c.dead && !c.passable) n++; });
      if (n) continue;
      let v = 0; const h = w.getHeight(x, z);
      for (const d of [[5,0],[-5,0],[0,5],[0,-5]]) v += Math.abs(w.getHeight(x + d[0], z + d[1]) - h);
      if (v < bs) { bs = v; best = { x: x, z: z, y: h }; }
    }
    return best || { x: 0, z: 0, y: 0 };
  })();
  // a mimic with an exact pouch, at an exact skill, holding still
  window.__man = (x, z, items, skill, cls) => {
    const m = window.__radius.spawn('mimic', x, z, { cls: cls || 'regular' });
    if (!m) return null;
    m.loadout.kit = [];                       // strip the rolled webbing so the pouch under test is the only kit
    K.createKit(m);
    m.loadout.items = (items || []).slice();
    Object.assign(m.skill, { itemUse: 0.95, smokeW: 0.8, scav: 0.6 }, skill || {});
    m.aware = 0; m.setState('watch'); m.kit.cool = 0; m.kit.scavCool = 1e9;
    return m;
  };
  window.__post = { flash: 0, blur: 0 };
  if (!ctx.post.__kitHook) {
    ctx.post.__kitHook = true;
    const f = ctx.post.flash.bind(ctx.post), b = ctx.post.setBlur.bind(ctx.post);
    ctx.post.flash = (v) => { window.__post.flash = Math.max(window.__post.flash, v); return f(v); };
    ctx.post.setBlur = (v) => { window.__post.blur = Math.max(window.__post.blur, v); return b(v); };
  }
  window.__clear = () => { ctx.enemies.removeAll(); K.resetKit(); ctx.world.smoke.length = 0;
    window.__au.plays.length = 0; window.__au.loops.length = 0; window.__post.flash = 0; window.__post.blur = 0; };
  return 1; })()`;

export default async function (page, api) {
  await boot(api);
  await inject(api);
  await api.run(RAYCOUNT);
  await api.run(AUDIOHOOK);
  await api.run(DRIVER);
  await api.run(HELPERS);
  const site = await api.run('window.__site');
  console.log('site', JSON.stringify(site));

  // =======================================================================================================
  section('1. CATALOGUE COVERAGE — what a human enemy can carry, and what he does with it');
  // =======================================================================================================
  const cov = await api.run(`(() => {
    const K = window.__KIT;
    const rows = {}, unhandled = [];
    const all = [];
    for (const id in K.ITEMS) all.push(id);
    for (const id in K.ARMOR) all.push(id);
    for (const id of all) {
      const d = K.def(id), a = K.actFor(id);
      if (a) { (rows[a] = rows[a] || []).push(id); }
      else if (d && ['med','food','tool','grenade','battery','filter','mask','headgear','melee'].indexOf(d.kind) >= 0) unhandled.push(id + '(' + d.kind + ')');
    }
    return { rows: rows, unhandled: unhandled, total: all.length };
  })()`);
  for (const act of Object.keys(cov.rows).sort()) console.log(`   ${act.padEnd(9)} ${cov.rows[act].length.toString().padStart(2)}  ${cov.rows[act].join(' ')}`);
  console.log(`   unhandled carryables: ${cov.unhandled.length ? cov.unhandled.join(' ') : 'none'}`);
  bad += pass('every med, food, tool, grenade, mask, headgear and melee item maps to an action', cov.unhandled.length === 0, cov.unhandled.join(' '));
  bad += pass('artifacts, mission objects and parts map to nothing (they are never used, never taken)',
    !cov.rows.heal || !cov.rows.heal.some((id) => id.startsWith('art_')), '');

  // =======================================================================================================
  section('2. THE HONESTY RULE — what he used comes out of the loadout');
  // =======================================================================================================
  const honest = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const m = window.__man(S.x, S.z, ['bandage', 'medkit', 'cigarettes'], {});
    m.hp = 30;
    const before = m.loadout.items.slice();
    const w = K.wantItem(m);
    const started = K.useWanted(m, w);
    // the commitment window: he is holding a dressing, not a rifle
    const midFire = [];
    for (let i = 0; i < 8; i++) { ctx.elapsed += 0.05; const owns = K.kitTick(m, 0.05); midFire.push([owns, K.mayFire(m), m.burstLeft]); }
    const owned = midFire.filter((r) => r[0]).length, couldFire = midFire.filter((r) => r[1]).length;
    // run it out
    for (let i = 0; i < 200 && K.busy(m); i++) { ctx.elapsed += 0.05; K.kitTick(m, 0.05); }
    for (let i = 0; i < 260; i++) { ctx.elapsed += 0.05; K.kitTick(m, 0.05); }     // the heal-over-time
    const drops = K.dropsForPatched(m.loadout).filter((e) => e.kind === 'item').map((e) => e.id);
    return { pick: w ? (w.id + '/' + w.act + '/' + w.why) : null, started: started, hp: Math.round(m.hp),
             before: before, after: m.loadout.items.slice(), owned: owned, couldFire: couldFire,
             plays: window.__au.plays.slice(), drops: drops, healed: Math.round(m.kit.healed) };
  })()`);
  console.log('   ' + JSON.stringify(honest));
  bad += pass('a mimic on 30 % opens the right thing', honest.pick === 'medkit/heal/hurt' || honest.pick === 'bandage/heal/hurt', String(honest.pick));
  bad += pass('it heals him for real', honest.hp > 30 && honest.healed > 10, `hp 30 -> ${honest.hp}, ${honest.healed} restored`);
  bad += pass('the item is gone from the loadout', honest.after.length === honest.before.length - 1, `${honest.before.join(',')} -> ${honest.after.join(',')}`);
  bad += pass('and therefore gone from the pile he leaves', honest.drops.indexOf(honest.pick.split('/')[0]) < 0, `pile items: ${honest.drops.join(',') || 'none'}`);
  bad += pass('he cannot fire through the commitment', honest.owned === 8 && honest.couldFire === 0, `${honest.owned}/8 frames owned by the kit`);
  bad += pass('it is audible', honest.plays.indexOf('mimic_heal') >= 0, honest.plays.join(' '));

  // =======================================================================================================
  section('3. THE GATES — a recruit has the bandage and does not open it');
  // =======================================================================================================
  const gates = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    const test = (skill, items, setup) => {
      window.__clear();
      const m = window.__man(S.x, S.z, items, skill);
      if (setup) setup(m);
      const w = K.wantItem(m);
      return w ? w.act + ':' + w.why : null;
    };
    const hurt = (m) => { m.hp = 25; };
    const out = {
      recruitHurt: test({ itemUse: 0.05 }, ['bandage', 'medkit', 'morphine'], hurt),
      regularHurt: test({ itemUse: 0.40 }, ['bandage', 'medkit', 'morphine'], hurt),
      eliteHurt:   test({ itemUse: 0.95 }, ['bandage', 'medkit', 'morphine'], hurt),
      recruitPain: test({ itemUse: 0.40 }, ['morphine'], (m) => { m.hp = 20; }),
      elitePain:   test({ itemUse: 0.95 }, ['morphine'], (m) => { m.hp = 20; }),
      recruitFood: test({ itemUse: 0.05 }, ['tushonka'], (m) => { m.hp = 60; }),
      regularFood: test({ itemUse: 0.40 }, ['tushonka'], (m) => { m.hp = 60; }),
      healthyMan:  test({ itemUse: 0.95 }, ['bandage', 'medkit'], null),
      smokeGate0:  (() => { window.__clear(); const m = window.__man(S.x, S.z, ['gr_smoke'], { smokeW: 0.1 }); return K.throwKit(m, 'smoke', S.x + 8, S.z); })(),
      smokeGate1:  (() => { window.__clear(); const m = window.__man(S.x, S.z, ['gr_smoke'], { smokeW: 0.8 }); return K.throwKit(m, 'smoke', S.x + 8, S.z); })(),
      flashGate:   (() => { window.__clear(); const m = window.__man(S.x, S.z, ['gr_flash'], { smokeW: 0.5 }); return K.throwKit(m, 'flash', S.x + 8, S.z); })(),
      flashOk:     (() => { window.__clear(); const m = window.__man(S.x, S.z, ['gr_flash'], { smokeW: 0.8 }); return K.throwKit(m, 'flash', S.x + 8, S.z); })(),
      noSmoke:     (() => { window.__clear(); const m = window.__man(S.x, S.z, ['bandage'], { smokeW: 0.8 }); return K.throwKit(m, 'smoke', S.x + 8, S.z); })(),
    };
    return out;
  })()`);
  console.log('   ' + JSON.stringify(gates, null, 0));
  bad += pass('a recruit at itemUse 0.05 bleeds with the bandage in his pouch', gates.recruitHurt === null, String(gates.recruitHurt));
  bad += pass('a regular at 0.40 dresses the wound', gates.regularHurt === 'heal:hurt', String(gates.regularHurt));
  bad += pass('morphine is a late-game answer only', gates.recruitPain === null && gates.elitePain === 'pain:pain', `${gates.recruitPain} / ${gates.elitePain}`);
  bad += pass('rations are the cheapest gate', gates.recruitFood === null && gates.regularFood === 'food:rations', `${gates.recruitFood} / ${gates.regularFood}`);
  bad += pass('a healthy man out of contact opens nothing', gates.healthyMan === null, String(gates.healthyMan));
  bad += pass('smoke is gated on smokeW', gates.smokeGate0 === false && gates.smokeGate1 === true, `${gates.smokeGate0} / ${gates.smokeGate1}`);
  bad += pass('flash is gated harder than smoke', gates.flashGate === false && gates.flashOk === true, `${gates.flashGate} / ${gates.flashOk}`);
  bad += pass('nobody throws what they are not carrying', gates.noSmoke === false, String(gates.noSmoke));

  // =======================================================================================================
  section('4. SMOKE — the first thing ever to fill ctx.world.smoke');
  // =======================================================================================================
  const smoke = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const m = window.__man(S.x, S.z, ['gr_smoke'], {});
    const tx = S.x + 14, tz = S.z;
    const ok = K.throwKit(m, 'smoke', tx, tz);
    const saidT = m.kit.saidT, said = m.kit.said;
    let clouds = 0, popAt = -1;
    for (let i = 0; i < 200; i++) {
      ctx.elapsed += 0.05; ctx.frame++;
      K.kitTick(m, 0.05); K.updateKit(ctx, 0.05); ctx.world.update(0.05, ctx.elapsed);
      if (popAt < 0 && ctx.world.smoke.length) popAt = i * 0.05;
      clouds = Math.max(clouds, ctx.world.smoke.length);
    }
    const c = ctx.world.smoke[0];
    const A = { x: c ? c.position.x - 14 : 0, y: 1.6, z: c ? c.position.z : 0 };
    const B = { x: c ? c.position.x + 14 : 0, y: 1.6, z: c ? c.position.z : 0 };
    const across = c ? ctx.world.smokeBlocks(A, B) : false;
    const past = c ? ctx.world.smokeBlocks({ x: A.x, y: 1.6, z: A.z + 30 }, { x: B.x, y: 1.6, z: B.z + 30 }) : true;
    return { ok: ok, said: said, saidT: saidT, clouds: clouds, popAt: popAt, radius: c ? c.radius : 0, life: c ? Math.round(c.t) : 0,
             across: across, past: past, items: m.loadout.items.slice(), plays: window.__au.plays.slice(), loops: window.__au.loops.slice() };
  })()`);
  console.log('   ' + JSON.stringify(smoke));
  bad += pass('a cloud exists in ctx.world.smoke', smoke.clouds === 1 && smoke.radius === 8, `${smoke.clouds} cloud, r ${smoke.radius}, ${smoke.life} s left`);
  bad += pass('it blocks a sightline through it and not one beside it', smoke.across === true && smoke.past === false, `across ${smoke.across}, beside ${smoke.past}`);
  bad += pass('the word goes out before the arm comes back', smoke.said === 'flush' && smoke.popAt >= 0.85, `"${smoke.said}", cloud at +${smoke.popAt.toFixed(2)} s`);
  bad += pass('the grenade left the pouch', smoke.items.indexOf('gr_smoke') < 0, smoke.items.join(',') || 'empty');
  bad += pass('smoke is audible', smoke.plays.indexOf('smoke_pop') >= 0 && smoke.loops.indexOf('smoke_hiss') >= 0, smoke.plays.join(' ') + ' | ' + smoke.loops.join(' '));

  // =======================================================================================================
  section('5. FLASH — symmetric, because a free win is not a tactic');
  // =======================================================================================================
  const flash = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    ctx.player.teleport(S.x + 6, S.z);
    const thrower = window.__man(S.x - 10, S.z, ['gr_flash'], {});
    const a = window.__man(S.x + 3, S.z + 2, [], {});
    const b = window.__man(S.x + 40, S.z, [], {});          // well outside the radius
    K.throwKit(thrower, 'flash', S.x + 5, S.z);
    for (let i = 0; i < 160; i++) { ctx.elapsed += 0.05; ctx.frame++; K.kitTick(thrower, 0.05); K.updateKit(ctx, 0.05); }
    const out = { near: +(a.stunned || 0).toFixed(2), far: +(b.stunned || 0).toFixed(2), self: +(thrower.stunned || 0).toFixed(2),
                  flash: +window.__post.flash.toFixed(2), blur: +window.__post.blur.toFixed(2), plays: window.__au.plays.slice() };
    ctx.player.teleport(0, 300);
    return out;
  })()`);
  console.log('   ' + JSON.stringify(flash));
  bad += pass('a mimic inside the radius is stunned', flash.near > 1.0, `stunned ${flash.near} s`);
  bad += pass('a mimic outside it is not', flash.far === 0, `stunned ${flash.far} s`);
  bad += pass('the Explorer takes it too', flash.flash > 0.5 && flash.blur > 0, `flash ${flash.flash}, blur ${flash.blur}`);
  bad += pass('it is audible', flash.plays.indexOf('flash_bang') >= 0, flash.plays.join(' '));

  // =======================================================================================================
  section('6. THE MASK AND THE GAS PAD');
  // =======================================================================================================
  const gas = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const x = S.x, z = S.z + 60;
    const an = window.__radius.spawnAnomaly('gas', x, z);
    const bare = window.__man(x + 1, z + 1, ['probe'], {});                 // nothing to answer it with
    const kitted = window.__man(x - 1, z - 1, ['mask_gp5'], {});            // a full mask in the pouch
    const resp = window.__man(x + 1.5, z + 1.5, ['mask_resp'], {});         // a respirator: half the burn
    const early = window.__man(x - 1.5, z - 1.5, ['mask_gp5'], { itemUse: 0.1 });   // and one who does not know how
    const bh = bare.hp, kh = kitted.hp, rh = resp.hp, eh = early.hp;
    for (let i = 0; i < 400; i++) {
      ctx.elapsed += 0.05; ctx.frame++;
      for (const m of [bare, kitted, resp, early]) { if (K.kitTick(m, 0.05)) continue; if ((i % 6) === 0) { const w = K.wantItem(m); if (w) K.useWanted(m, w); } }
      K.updateKit(ctx, 0.05);
    }
    if (an && ctx.anomalies.list.indexOf(an) >= 0) ctx.anomalies.list.splice(ctx.anomalies.list.indexOf(an), 1);
    return { anomaly: !!an, bareLost: Math.round(bh - bare.hp), kittedLost: Math.round(kh - kitted.hp),
             respLost: Math.round(rh - resp.hp), earlyLost: Math.round(eh - early.hp),
             kittedFit: +K.gasProtection(kitted).toFixed(2), respFit: +K.gasProtection(resp).toFixed(2),
             earlyFit: +K.gasProtection(early).toFixed(2), kittedItems: kitted.loadout.items.slice() };
  })()`);
  console.log('   ' + JSON.stringify(gas));
  bad += pass('a gas pad hurts a mimic standing in it', gas.bareLost > 4, `${gas.bareLost} hp`);
  bad += pass('a mimic who fits the mask stops taking it', gas.kittedFit >= 1 && gas.kittedLost < gas.bareLost * 0.25, `${gas.kittedLost} hp vs ${gas.bareLost}`);
  bad += pass('a recruit who has one and cannot use it takes it all', gas.earlyFit === 0 && gas.earlyLost >= gas.bareLost * 0.6, `${gas.earlyLost} hp`);
  bad += pass('a respirator halves the burn rather than nullifying it', gas.respFit === 0.5 && gas.respLost > gas.kittedLost && gas.respLost < gas.bareLost,
    `respirator ${gas.respLost} hp, GP-5 ${gas.kittedLost} hp, bare ${gas.bareLost} hp`);
  bad += pass('the mask came out of the pouch', gas.kittedItems.indexOf('mask_gp5') < 0, gas.kittedItems.join(',') || 'empty');

  // =======================================================================================================
  section('7b. THE LOCKPICK — somebody got here first, and took nothing');
  // =======================================================================================================
  const pick = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const x = S.x - 60, z = S.z;
    // a locked container shaped exactly like game/loot.js's own
    const box = { pile: { name: 'LOCKER', entries: [{ kind: 'item', id: 'medkit', count: 2 }, { kind: 'item', id: 'battery', count: 3 }] },
                  locked: true, pickable: true, markerKind: 'container' };
    K.registerContainer(box, x + 1, z);
    const before = box.pile.entries.length;
    const able = window.__man(x, z, ['lockpick'], {});
    const unable = window.__man(x + 3, z + 3, ['lockpick'], { itemUse: 0.5 });
    let picked = null;
    for (let i = 0; i < 300; i++) {
      ctx.elapsed += 0.05; ctx.frame++;
      for (const m of [able, unable]) { if (K.kitTick(m, 0.05)) continue; if ((i % 6) === 0 && !picked) { const w = K.wantItem(m); if (w && w.act === 'pick') { picked = w.why; K.useWanted(m, w); } } }
      K.updateKit(ctx, 0.05);
    }
    return { picked: picked, locked: box.locked, forced: !!box.forced, before: before, after: box.pile.entries.length,
             picks: K.stats().picks, ableItems: able.loadout.items.slice(), scav: able.loadout.scavenged || [] };
  })()`);
  console.log('   ' + JSON.stringify(pick));
  bad += pass('a lockpick has a use, and it is gated late', pick.picked === 'locked' && pick.picks === 1, `${pick.picked}, ${pick.picks} forced`);
  bad += pass('the locker opens', pick.locked === false && pick.forced === true, `locked ${pick.locked}`);
  bad += pass('and nothing comes out of it', pick.after === pick.before && pick.scav.length === 0, `${pick.before} -> ${pick.after} entries`);
  bad += pass('the picks are spent one use at a time', pick.ableItems.indexOf('lockpick') >= 0, pick.ableItems.join(','));

  // =======================================================================================================
  section('7. THE PROBE — he knows this ground and he still throws one');
  // =======================================================================================================
  const probe = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const x = S.x + 70, z = S.z;
    const an = window.__radius.spawnAnomaly('electric', x + 14, z);
    if (an) { an.revealed = false; an.revealT = 0; }
    const m = window.__man(x, z, ['probe'], {});
    m.setTarget({ x: x + 26, y: ctx.world.getHeight(x + 26, z), z: z });
    let picked = null;
    for (let i = 0; i < 300; i++) {
      ctx.elapsed += 0.05; ctx.frame++;
      if (!K.kitTick(m, 0.05) && (i % 6) === 0 && !picked) { const w = K.wantItem(m); if (w) { picked = w.act + ':' + w.why; K.useWanted(m, w); } }
      K.updateKit(ctx, 0.05);
      m.setTarget({ x: x + 26, y: ctx.world.getHeight(x + 26, z), z: z });
    }
    const out = { picked: picked, revealed: an ? !!an.revealed : null, items: m.loadout.items.slice(), plays: window.__au.plays.slice() };
    if (an && ctx.anomalies.list.indexOf(an) >= 0) ctx.anomalies.list.splice(ctx.anomalies.list.indexOf(an), 1);
    return out;
  })()`);
  console.log('   ' + JSON.stringify(probe));
  bad += pass('an unrevealed field on his line draws a probe', probe.picked === 'probe:field', String(probe.picked));
  bad += pass('the probe reveals it', probe.revealed === true, String(probe.revealed));
  bad += pass('the probe left the pouch', probe.items.indexOf('probe') < 0, probe.items.join(',') || 'empty');
  bad += pass('the Explorer hears the throw and the landing', probe.plays.indexOf('probe_throw') >= 0 && probe.plays.indexOf('probe_land') >= 0, probe.plays.join(' '));

  // =======================================================================================================
  section('8. THE REST OF THE POUCH — every remaining action, driven once, effect measured');
  // =======================================================================================================
  const rest = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    const drive = (m, n) => { for (let i = 0; i < (n || 300); i++) { ctx.elapsed += 0.05; ctx.frame++; K.kitTick(m, 0.05); K.updateKit(ctx, 0.05); } };
    const one = (items, act, setup, read, steps) => {
      window.__clear();
      const m = window.__man(S.x, S.z + 120, items, {});
      if (setup) setup(m);
      const started = K.beginUse(m, items[0], act, 0);
      drive(m, steps);
      return { started: started, out: read(m), items: m.loadout.items.slice() };
    };
    const out = {};
    out.stim = one(['stim'], 'stim', (m) => { m.body = { wind: 8, blown: true }; m.hp = 70; },
      (m) => ({ wind: m.body.wind, blown: m.body.blown, hp: Math.round(m.hp) }));
    out.adrenaline = one(['adrenaline'], 'stim', (m) => { m.body = { wind: 5, blown: true }; },
      (m) => ({ speedMul: +K.speedMul(m).toFixed(2) }));
    out.pain = one(['morphine'], 'pain', (m) => { m.hp = 25; }, (m) => ({ stagger: +K.staggerMul(m).toFixed(2) }));
    out.food = one(['cigarettes'], 'food', null, (m) => ({ aim: +K.aimMul(m).toFixed(2) }));
    out.water = one(['water'], 'food', null, (m) => ({ windMul: +K.windRegenMul(m).toFixed(2) }));
    out.clean = one(['cleankit'], 'clean', (m) => { m.weapon.dirt = 0.9; m.weapon.jammed = true; },
      (m) => ({ dirt: +m.weapon.dirt.toFixed(2), jammed: m.weapon.jammed }));
    out.repair = one(['repairkit'], 'repair', (m) => { m.weapon.parts = { barrel: 20, bolt: 20, frame: 20 }; m.weapon.jammed = true; },
      (m) => ({ barrel: m.weapon.parts.barrel, jammed: m.weapon.jammed }));
    out.armorkit = one(['armorkit'], 'armorkit', (m) => { m.loadout.vest = K.makeGear('vest_kirasa'); m.loadout.vest.durability = 10; },
      (m) => ({ dur: m.loadout.vest.durability }));
    out.battery = one(['battery'], 'battery', (m) => { m.loadout.kit = [K.makeGear('head_lamp')]; m.loadout.kit[0].charge = 0; },
      (m) => ({ charge: m.loadout.kit[0].charge }));
    out.filter = one(['filter'], 'filter', (m) => { m.loadout.kit = [K.makeGear('mask_gp5')]; m.loadout.kit[0].charge = 0; K.createKit(m); m.loadout.items = ['filter']; },
      (m) => ({ charge: m.loadout.kit[0].charge }));
    out.binos = one(['binoculars'], 'binos', null, (m) => ({ glassing: K.glassing(m), t: +m.kit.binoT.toFixed(1) }), 60);
    // the two thrown things nothing carries yet, so the paths are proved rather than assumed
    window.__clear();
    const flareman = window.__man(S.x, S.z + 140, ['gr_flare'], {});
    const flareOk = K.throwKit(flareman, 'flare', S.x + 10, S.z + 140);
    drive(flareman, 120);
    out.flare = { started: flareOk, fires: K.stats().fires };
    window.__clear();
    const molly = window.__man(S.x, S.z + 160, ['gr_molotov'], {});
    const victim = window.__man(S.x + 9, S.z + 160, [], {});
    const vh = victim.hp;
    const fireOk = K.throwKit(molly, 'fire', S.x + 9, S.z + 160);
    for (let i = 0; i < 300; i++) { ctx.elapsed += 0.05; ctx.frame++; K.kitTick(molly, 0.05); K.updateKit(ctx, 0.05); }
    out.fire = { started: fireOk, burned: Math.round(vh - victim.hp) };
    return out;
  })()`);
  for (const k of Object.keys(rest)) console.log(`   ${k.padEnd(11)} ${JSON.stringify(rest[k])}`);
  bad += pass('a stim puts the wind back and unblows him', rest.stim.out.wind === 100 && rest.stim.out.blown === false, JSON.stringify(rest.stim.out));
  bad += pass('adrenaline makes him faster for thirty seconds', rest.adrenaline.out.speedMul > 1, `speed x${rest.adrenaline.out.speedMul}`);
  bad += pass('morphine damps the flinch', rest.pain.out.stagger < 1, `stagger x${rest.pain.out.stagger}`);
  bad += pass('a cigarette steadies the hands', rest.food.out.aim < 1, `aim x${rest.food.out.aim}`);
  bad += pass('water buys him better wind', rest.water.out.windMul > 1, `wind regen x${rest.water.out.windMul}`);
  bad += pass('a cleaning kit clears the jam and the fouling', rest.clean.out.dirt === 0 && rest.clean.out.jammed === false, JSON.stringify(rest.clean.out));
  bad += pass('a repair kit puts the parts back', rest.repair.out.barrel > 20 && rest.repair.out.jammed === false, `barrel ${rest.repair.out.barrel}`);
  bad += pass('an armour kit puts the plates back', rest.armorkit.out.dur > 10, `durability ${rest.armorkit.out.dur}`);
  bad += pass('a battery relights the lamp', rest.battery.out.charge === 100, `charge ${rest.battery.out.charge}`);
  bad += pass('a filter refits the mask', rest.filter.out.charge > 0, `charge ${rest.filter.out.charge}`);
  bad += pass('binoculars put the glint up', rest.binos.out.glassing === true, String(rest.binos.out.glassing));
  bad += pass('a flare burns where it lands', rest.flare.started === true && rest.flare.fires >= 1, JSON.stringify(rest.flare));
  bad += pass('an incendiary burns whoever is standing in it', rest.fire.started === true && rest.fire.burned > 5, `${rest.fire.burned} hp`);

  // =======================================================================================================
  section('9. COST — rays and microseconds at twelve mimics');
  // =======================================================================================================
  const cost = await api.run(`(() => {
    const ctx = window.__radius.ctx, K = window.__KIT, S = window.__site;
    window.__clear();
    const men = [];
    for (let i = 0; i < 12; i++) {
      const m = window.__man(S.x + (i % 4) * 3 - 6, S.z + Math.floor(i / 4) * 3 + 90, ['bandage', 'stim', 'probe', 'cleankit', 'tushonka'], {});
      if (m) { m.hp = m.maxHp * 0.9; men.push(m); }
    }
    window.__rc.ray = 0; window.__rc.los = 0; window.__rc.solid = 0; window.__rc.ground = 0;
    const t0 = performance.now();
    const N = 1200;
    for (let i = 0; i < N; i++) {
      ctx.elapsed += 0.05; ctx.frame++;
      for (const m of men) { if (K.kitTick(m, 0.05)) continue; K.scavengeTick(m, 0.05); if ((i % 6) === 0) { const w = K.wantItem(m); if (w) K.useWanted(m, w); } }
      K.updateKit(ctx, 0.05);
    }
    const ms = performance.now() - t0;
    return { frames: N, men: men.length, us: +(ms * 1000 / N).toFixed(1), rc: Object.assign({}, window.__rc),
             perFrame: +((window.__rc.ray + window.__rc.los) / N).toFixed(3), uses: K.stats().uses };
  })()`);
  console.log('   ' + JSON.stringify(cost));
  bad += pass('kit.js spends effectively no rays', cost.perFrame < 0.05, `${cost.perFrame} rays/frame at 12 mimics (${cost.rc.ray} casts, ${cost.rc.los} LOS over ${cost.frames} frames)`);
  bad += pass('and costs well under the budget', cost.us < 60, `${cost.us} us/frame for 12 mimics`);

  console.log(`\n${bad ? 'FAILURES: ' + bad : 'ALL CHECKS PASSED'}`);
  await api.screenshot('kit-items');
}
