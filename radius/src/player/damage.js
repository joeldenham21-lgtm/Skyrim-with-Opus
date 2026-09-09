// Shared damage application for the player, and the ledger of what a death costs.
//
// Two jobs live here. The first is the old one: resolve a hit against armour, apply bleed and shock,
// run the consumables. The second is the whole point of dying — `respawn()` is called by main.js when
// the Explorer signs the incident report, and it decides what the Committee reissues, what it charges,
// what the Explorer wakes up carrying and what is still lying in the mud where they fell.
//
// The rule, taken from the game this is modelled on: loss is a debt with an address. Nothing carried is
// deleted. It is snapshotted into a cache (ctx.loot.dropCache) at the exact spot of death, it shows on
// the map sheet as a corpse mark, and it stays there through the night and through one Tide. What is at
// Vanno is untouched. What is reissued is a worse Makarov than the one you started with, and it is billed.
//
// applyBullet(ammoDef, hitInfo) -> resolves zone + armour, damages armour durability, applies bleed/shock, returns the result.
import { resolveHit, zoneFromHit, def } from '../data/index.js';
import { makeWeapon, makeMag, makeGear } from './inventory.js';
import { clamp01 } from '../core/math.js';

const QUICK_SOUND = { bandage: 'bandage_use', hemostat: 'bandage_use', medkit: 'medkit_use', medkit_ai2: 'medkit_use', stim: 'stim_use', adrenaline: 'stim_use', morphine: 'stim_use', energy: 'stim_use' , tourniquet: 'bandage_use', splint: 'bandage_use', medpouch: 'medkit_use', medkit_surg: 'medkit_use', painkillers: 'stim_use', antirad: 'stim_use'};

// ---- the walk home ------------------------------------------------------------------------------
// A broken leg is the cheapest way to make getting back a part of the game. It is not lethal on its own;
// it makes every metre cost, and it is cured by a 90 rouble splint, which is the decision.
const FRACTURE_SPEED = 0.6;         // 3.6 -> 2.16 walking, and a sprint is barely a walk
const FRACTURE_STAMINA = 0.7;

// ---- the reissue --------------------------------------------------------------------------------
// A ladder, not a cliff. Step 0 is the first death since the Explorer last slept at Vanno; the rungs
// only bite if they keep dying without getting home, and any night in the bunk puts them back on step 0.
// Compare with the starter kit (inventory.defaultInventory): PM, three full magazines, sixteen loose
// rounds, two bandages, six probes, a battery. Step 0 is that with half the rounds, half the probes and
// no spare cell; step 3 is twelve rounds and a fouled pistol.
const REISSUE = [
  { cond: 62, dirt: 0.34, mag: 8, loose: 16, bandage: 2, probe: 3, torch: 45, fee: 300 },
  { cond: 55, dirt: 0.42, mag: 7, loose: 12, bandage: 2, probe: 2, torch: 35, fee: 450 },
  { cond: 47, dirt: 0.50, mag: 6, loose: 8,  bandage: 1, probe: 2, torch: 25, fee: 600 },
  { cond: 40, dirt: 0.58, mag: 6, loose: 6,  bandage: 1, probe: 1, torch: 20, fee: 750 },
];
// The Committee will bill an Explorer into arrears, but only so far: past this the reissue is written off.
// One good contract clears the deepest hole, so the next trip is always worth making.
const DEBT_FLOOR = -1200;

const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function bearingText(dx, dz) {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return CARD[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
const distText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

export function createDamage(ctx) {
  const st = { painkiller: 0, steady: 0, speedT: 0, speedMul: 1, staminaRegenT: 0, staminaRegenMul: 1, healQueue: [] };
  const rnd = ctx.rng.fork(6110);
  let lastLoss = null;          // the report the death card and the HUD read back
  let limpFoot = 0, respawnT = 0;

  const D = () => ctx.state.data;
  const flags = () => { const d = D(); if (!d.flags || typeof d.flags !== 'object') d.flags = {}; return d.flags; };
  const fractured = () => !!D().fracture;
  const setFractured = (v) => { D().fracture = !!v; };

  // ---- what the Explorer is carrying, as pile entries --------------------------------------------
  // Everything: the guns with their wear and their loaded magazine, the spare magazines with the rounds
  // still in them, the vest off the Explorer's chest, the loose rounds, the meds, the artifacts. The one
  // exception is contract material — missions.js re-lists a suspended contract and re-places its object,
  // so leaving a copy on the body would print a second one.
  function snapshotCarried() {
    const inv = ctx.inventory, out = [];
    let value = 0, best = null, bestPrice = -1;
    const price = (id, n = 1) => (def(id)?.price || 0) * n;
    for (const w of inv.weapons || []) {
      out.push({ kind: 'weapon', id: w.id, inst: w, count: 1 });
      const p = price(w.id); value += p;
      if (p > bestPrice) { bestPrice = p; best = w; }
    }
    for (const m of inv.mags || []) { out.push({ kind: 'mag', id: m.id, inst: m, count: 1 }); value += price(m.id) + (m.rounds || 0) * price(m.ammo || ''); }
    for (const g of inv.gear || []) { const d = def(g.id); if (d?.hidden && d.kind === 'tool') continue; out.push({ kind: 'gear', id: g.id, inst: g, count: 1 }); value += price(g.id); }
    for (const [id, n] of Object.entries(inv.items || {})) {
      const d = def(id); if (!d || n <= 0) continue;
      if (d.kind === 'mission') continue;
      out.push({ kind: 'item', id, count: n }); value += price(id, n);
    }
    out.forEach((e, i) => { e.slot = i; });
    return { entries: out, value: Math.round(value), best, count: out.length };
  }

  // ---- the incident ------------------------------------------------------------------------------
  // Recorded the moment the Explorer goes down, not on respawn: main.js reloads the save between the two,
  // and by then the inventory in memory is the one that came off the disk.
  function onDied(info = {}) {
    let snap = null;
    try { snap = snapshotCarried(); } catch (e) { console.warn('[damage] snapshot', e); }
    const p = ctx.player.position;
    const M = ctx.world.map;
    const poi = (() => { try { return ctx.world.nearestPoi(p.x, p.z)?.poi || null; } catch { return null; } })();
    const dx = p.x - M.BASE.x, dz = p.z - M.BASE.z;
    let rec = null;
    if (snap && snap.entries.length && ctx.loot?.dropCache) {
      try { rec = ctx.loot.dropCache(snap.entries, { x: p.x, y: p.y, z: p.z }, { kind: 'explorer', name: 'EXPLORER 61' }); }
      catch (e) { console.warn('[damage] dropCache', e); }
    }
    lastLoss = {
      x: p.x, z: p.z, day: D().day, hour: D().hour,
      value: snap ? snap.value : 0, count: snap ? snap.count : 0,
      best: snap && snap.best ? (def(snap.best.id)?.full || def(snap.best.id)?.name || snap.best.id) : null,
      bestCondition: snap && snap.best ? Math.round(((snap.best.parts?.barrel ?? 100) + (snap.best.parts?.bolt ?? 100) + (snap.best.parts?.frame ?? 100)) / 3) : null,
      poi: poi ? poi.name : null,
      home: Math.hypot(dx, dz), bearing: bearingText(dx, dz),
      cacheId: rec ? rec.id : null, kind: info.kind || null,
    };
    flags().deathStreak = ((flags().deathStreak | 0) + 1);
    // a leg that went out from under you does not mend because you woke up somewhere else
    if (info.kind === 'fall' || info.kind === 'blast') { if (rnd.chance(0.6)) setFractured(true); }
  }

  // ---- the reissue -------------------------------------------------------------------------------
  function reissueInventory(step) {
    const S = REISSUE[Math.min(step, REISSUE.length - 1)];
    const pm = makeWeapon('pm', { loaded: false, condition: S.cond });
    pm.dirt = S.dirt;
    pm.parts.bolt = Math.max(20, S.cond - 8);
    pm.mag = makeMag('mag_pm8', '9x18_fmj', S.mag);
    pm.chamber = S.mag > 0 ? '9x18_fmj' : null;
    const spare = makeMag('mag_pm8', null, 0);                  // empty: the rounds are loose, and T is slow
    const rig = makeGear('rig_belt'), pack = makeGear('pack_tortilla'), knife = makeGear('knife'), torch = makeGear('torch');
    const items = { bandage: S.bandage, probe: S.probe, '9x18_fmj': S.loose };
    return {
      inv: {
        weapons: [pm], mags: [spare], gear: [rig, pack, knife, torch], items,
        equipment: { primary: null, secondary: null, sidearm: pm.uid, melee: knife.uid, vest: null, helmet: null, backpack: pack.uid, rig: rig.uid, headgear: null, mask: null },
        quick: ['bandage', null, null, null], readyMags: [spare.uid],
      },
      fee: S.fee, torch: S.torch,
    };
  }

  /**
   * The death penalty, entire. main.js respawn() calls this and nothing else: it must leave state.data
   * in the shape the save wants, because main saves immediately afterwards and then reloads from that save.
   *
   * What is kept: base storage, the money ledger (which may now be negative), the missions board, the
   * statistics, and the fracture. What is gone from the person: everything — and it is not deleted, it is
   * lying at lastLoss.x/z under a corpse mark on the sheet.
   */
  function respawn() {
    const d = D();
    const step = Math.max(0, (flags().deathStreak | 0) - 1);
    const { inv, fee, torch } = reissueInventory(step);
    // The body is recorded by onDied, which runs the instant the Explorer goes down — before main.js
    // saves and reloads. Whatever happened, the kit comes off the person here: a respawn must never be
    // able to launder a loadout back into the bunker.
    d.inventory = inv;
    d.hp = 60; d.stamina = 100; d.bleeding = false;
    st.healQueue.length = 0; st.painkiller = 0; st.steady = 0; st.speedT = 0; st.staminaRegenT = 0;
    d.flashlight = { on: false, battery: Math.min(d.flashlight?.battery ?? 100, torch) };
    const charged = Math.max(0, Math.min(fee, d.money - DEBT_FLOOR));
    d.money -= charged;
    const arrears = d.money < 0;
    ctx.events.emit('inventoryChanged', { id: '*', delta: 0 });
    respawnT = 1.2;
    lastLoss = lastLoss ? Object.assign(lastLoss, { fee: charged, waived: fee - charged, arrears, step }) : null;
    return lastLoss;
  }

  // the lines the death card and the respawn slip are written from; menus.js may read this if it wants them
  function lossReport() {
    if (!lastLoss) return null;
    const L = lastLoss;
    const where = L.poi ? `${distText(L.home)} ${L.bearing} of Vanno, grid ${L.poi}` : `${distText(L.home)} ${L.bearing} of Vanno`;
    return {
      where, value: L.value, count: L.count, fee: L.fee || 0, arrears: !!L.arrears,
      x: L.x, z: L.z, distance: L.home, bearing: L.bearing, poi: L.poi, day: L.day,
      lines: [
        `Kit last logged ${where}. Recovery at the Explorer's own risk.`,
        L.best ? `${L.best}${L.bestCondition != null ? `, condition ${L.bestCondition} %` : ''}. Not recovered.` : null,
        L.count ? `${L.count} line items, assessed ${L.value.toLocaleString('ru-RU')} ₽. Not recovered.` : null,
      ].filter(Boolean),
    };
  }

  const api = {
    st,
    // hit from a bullet: h01 = height fraction along the capsule, lateral01 = lateral offset fraction, ammo = ammo def or id
    bullet(ammo, h01 = 0.6, lateral01 = 0.3, info = {}) {
      const a = typeof ammo === 'string' ? def(ammo) : ammo;
      if (!a) return null;
      const zone = zoneFromHit(h01, lateral01);
      const pieces = ctx.inventory.armorPieces();
      const r = resolveHit(a, zone, pieces, { mult: info.mult || 1 });
      if (r.armorHit && r.armorHit.inst) {
        r.armorHit.inst.durability = Math.max(0, (r.armorHit.inst.durability ?? r.armorHit.def.durability) - r.armorDamage);
        ctx.audio.play(r.penetrated ? 'armor_pen' : (zone === 'head' ? 'helmet_ring' : 'armor_hit'), { gain: 0.8 });
        if (!r.penetrated) ctx.post.shake(0.25);
      }
      const dmg = r.damage * (st.painkiller > 0 ? 0.9 : 1);
      ctx.player.damage(dmg, { kind: 'bullet', source: info.source, bleed: r.penetrated && zone !== 'head' ? undefined : false, zone, penetrated: r.penetrated, what: info.what });
      // a round through the leg is how the walk home starts
      if (r.penetrated && zone === 'legs' && dmg >= 16 && !fractured() && rnd.chance(ctx.player.hp < 45 ? 0.5 : 0.3)) api.breakLeg();
      ctx.events.emit('playerHit', { zone, penetrated: r.penetrated, damage: dmg, armor: r.armorHit?.def.id || null });
      return Object.assign(r, { zone });
    },
    // melee/slash/blast/shock: vests soften slashes on the torso a little
    other(amount, info = {}) {
      let dmg = amount;
      if (info.kind === 'slash' || info.kind === 'melee') { const v = ctx.inventory.equippedDef('vest'); if (v) { dmg *= 1 - Math.min(0.35, v.cls * 0.06); const g = ctx.inventory.equipped('vest'); if (g) g.durability = Math.max(0, g.durability - amount * 0.2); } }
      if (info.kind === 'blast') { const h = ctx.inventory.equippedDef('helmet'); if (h) dmg *= 0.9; }
      ctx.player.damage(dmg * (st.painkiller > 0 ? 0.9 : 1), info);
      if (!fractured() && ctx.player.hp > 0) {
        if (info.kind === 'blast' && dmg >= 28 && rnd.chance(0.35)) api.breakLeg();
        else if (info.kind === 'fall' && dmg >= 14 && rnd.chance(0.7)) api.breakLeg();
      }
    },
    // ---- injuries ----------------------------------------------------------------------------------
    get fracture() { return fractured(); },
    breakLeg() {
      if (fractured()) return false;
      setFractured(true);
      ctx.audio?.play?.('hurt', { gain: 0.9, rate: 0.72 });
      ctx.post?.shake?.(0.5);
      ctx.hud?.notify?.('Left leg will not take weight. Splint it or walk it.', { code: 'FIELD INJURY', ms: 6000 });
      ctx.events.emit('playerInjury', 'fracture');
      return true;
    },
    healLeg() {
      if (!fractured()) return false;
      setFractured(false);
      ctx.hud?.notify?.('Leg splinted. It will hold as far as the gate.', { code: 'FIELD INJURY', ms: 4200, sound: false });
      return true;
    },
    // consumables
    use(itemId) {
      const d = def(itemId); if (!d || !d.effect) return false;
      const e = d.effect;
      if (e.stopBleed) ctx.player.stopBleeding();
      if (e.heal) ctx.player.heal(e.heal);
      if (e.healOver) st.healQueue.push({ total: e.healOver[0], left: e.healOver[0], dur: e.healOver[1] });
      if (e.stamina) ctx.player.addStamina(e.stamina);
      if (e.painkiller) st.painkiller = Math.max(st.painkiller, e.painkiller);
      if (e.steady) st.steady = Math.max(st.steady, e.steady);
      if (e.speedFor) { st.speedT = e.speedFor[0]; st.speedMul = e.speedFor[1]; }
      if (e.staminaRegen) { st.staminaRegenT = e.staminaRegen[0]; st.staminaRegenMul = e.staminaRegen[1]; }
      if (e.cure) ctx.player.stopBleeding();
      if (e.fracture) api.healLeg();          // splint, surgical kit: the one cure, and it is ninety roubles
      ctx.events.emit('itemUsed', itemId);
      return true;
    },
    /**
     * Use whatever sits in quick slot n (keys 6..9). The inventory panel has always let you bind an
     * item here and tells you "on key 6", and the HUD has always had a bar to draw them in — but
     * nothing ever read the keys or filled the bar, so the binding did nothing. A new explorer
     * starts with a bandage on key 6, which is the difference between noticing you are bleeding and
     * dying of it five minutes later.
     */
    quickUse(n) {
      const inv = ctx.inventory;
      const id = inv.quick?.[n];
      if (!id) return false;
      const d = def(id);
      if (!d) return false;
      if (!inv.has(id, 1)) { ctx.hud?.notify?.(`No ${d.name.toLowerCase()} left.`, { ms: 2200 }); return false; }
      if (api.use(id) === false) return false;
      inv.remove(id, 1);
      if (d.use) ctx.player.lockMovement?.(d.use);
      ctx.audio?.play?.(QUICK_SOUND[id] || 'pickup_item', { gain: 0.7 });
      ctx.hud?.notify?.(`${d.name} used.`, { ms: 2200 });
      return true;
    },
    // ---- the death ledger --------------------------------------------------------------------------
    respawn, lossReport,
    get lastLoss() { return lastLoss; },
    reissueFee(step = Math.max(0, (flags().deathStreak | 0))) { return REISSUE[Math.min(step, REISSUE.length - 1)].fee; },
    get speedMul() { return (st.speedT > 0 ? st.speedMul : 1) * (fractured() ? FRACTURE_SPEED : 1); },
    get staminaRegenMul() { return (st.staminaRegenT > 0 ? st.staminaRegenMul : 1) * (fractured() ? FRACTURE_STAMINA : 1); },
    get steadyMul() { return st.steady > 0 ? 0.6 : 1; },      // spread/sway multiplier
    get painkiller() { return st.painkiller > 0; },
    update(dt) {
      // quick slots 6..9
      if (ctx.mode === 'playing' && !ctx.panels?.isOpen) {
        for (let n = 0; n < 4; n++) if (ctx.input.pressed('quick' + (n + 1))) { api.quickUse(n); break; }
      }
      const q = ctx.inventory.quick;
      if (q) ctx.hud?.setQuick?.(q.map((id) => { const d = id && def(id); return d ? { id, name: d.name, count: ctx.inventory.count(id) } : null; }));
      st.painkiller = Math.max(0, st.painkiller - dt); st.steady = Math.max(0, st.steady - dt); st.speedT = Math.max(0, st.speedT - dt); st.staminaRegenT = Math.max(0, st.staminaRegenT - dt);
      for (let i = st.healQueue.length - 1; i >= 0; i--) { const h = st.healQueue[i]; const step = Math.min(h.left, (h.total / h.dur) * dt); if (step > 0) ctx.player.heal(step); h.left -= step; if (h.left <= 0.001) st.healQueue.splice(i, 1); }
      if (respawnT > 0 && (respawnT -= dt) <= 0) postRespawnSlip();
    },
  };

  // the dragged foot: one extra scuff behind every second step, quieter and lower than the step itself
  ctx.events.on('footstep', (f) => {
    if (!fractured() || ctx.player.dead) return;
    if ((limpFoot ^= 1)) return;
    const s = 'step_' + (f?.surface || 'grass');
    setTimeout(() => { try { ctx.audio.play(s, { gain: 0.3, rate: 0.72 }); } catch {} }, 150);
  });
  ctx.events.on('playerDied', onDied);
  // a night in the bunk clears the ladder: the reissue is only punitive while the Explorer keeps dying out there
  ctx.events.on('sleep', () => { flags().deathStreak = 0; });

  // the slip that names the address, posted a beat after the fade-in rather than under it
  function postRespawnSlip() {
    const r = lossReport();
    if (!r) return;
    const bill = lastLoss.fee ? `Reissue billed ${lastLoss.fee.toLocaleString('ru-RU')} ₽${lastLoss.arrears ? ', account in arrears' : ''}.` : 'Reissue written off against arrears.';
    ctx.hud?.notify?.(`${r.lines[0]} ${bill}`, { code: 'UNPSC · INCIDENT 61-' + String(D().stats.deaths).padStart(3, '0'), ms: 11000 });
    if (fractured()) ctx.hud?.notify?.('Medical: fracture not set. A splint is 90 ₽ at the crate.', { code: 'VANNO · MEDICAL', ms: 8000, sound: false });
  }

  return api;
}
