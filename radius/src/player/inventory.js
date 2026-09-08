// Inventory v2. Plain data in state.data.inventory so it saves. Everything speaks catalogue ids from src/data.
//   weapons: [WeaponInst]   WeaponInst = { uid, id, parts:{barrel,bolt,frame} 0..100, dirt 0..1, jammed, chamber: ammoId|null,
//                            mag: MagInst|null (inserted), tube: [ammoId] (internal magazines/tubes/clips), fireMode, attachments:{slot:id}, rails:[id] }
//   mags: [MagInst]         MagInst = { uid, id (magazine def), cal, ammo: ammoId|null, rounds }
//   gear: [GearInst]        GearInst = { uid, id, durability?, charge? }   (armour, helmets, packs, rigs, headgear, masks, tools with charge)
//   items: { id: count }    stackables (ammo by ammo id, meds, food, grenades, parts, artifacts, mission objects)
//   equipment: { primary, secondary, sidearm, melee, vest, helmet, backpack, rig, headgear, mask } -> uid|null
//   quick: [itemId|null x4] hotkeys 6..9; readyMags: uids of magazines in the rig pouches
// Weapon instances also carry the bench's work: `upgrades: {slot:upgradeId}` are the parts fitted in place of the
// factory ones (data/upgrades.js) and `factory: {slot:condition}` remembers what the part they displaced was worth,
// so pulling an upgrade back off does not launder condition. Both are optional: an old save without them still runs.
import { def, WEAPONS, MAGAZINES, ARMOR, ITEMS, AMMO, magsFor, weightOf, defaultAmmo } from '../data/index.js';
import { UPGRADES, SLOT_BY_ID, upgradeFits, slotsFor, slotApplies } from '../data/upgrades.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

let uid = 1;
const nextUid = () => uid++;
export const SLOTS = ['primary', 'secondary', 'sidearm', 'melee'];
export const BASE_CAPACITY = 10;   // kg carried without a backpack

export function makeWeapon(id, opts = {}) {
  const d = WEAPONS[id]; if (!d) throw new Error('unknown weapon ' + id);
  const w = { uid: nextUid(), id, parts: { barrel: 100, bolt: 100, frame: 100 }, dirt: 0, jammed: false, chamber: null, mag: null, tube: [], fireMode: d.modes[0], attachments: {}, rails: [], upgrades: {}, factory: {} };
  const ammo = opts.ammo || defaultAmmo(d.cal);
  if (opts.condition != null) { const c = opts.condition; w.parts = { barrel: c, bolt: c, frame: c }; }
  if (d.internal) { const n = opts.loaded === false ? 0 : d.internal - (d.modes[0] === 'break' ? 0 : 1); for (let i = 0; i < n; i++) w.tube.push(ammo); if (d.modes[0] !== 'break' && opts.loaded !== false) w.chamber = ammo; }
  else if (d.defaultMag && opts.loaded !== false) { w.mag = makeMag(d.defaultMag, ammo, MAGAZINES[d.defaultMag].cap); w.chamber = ammo; }
  for (const u of opts.upgrades || []) fitUpgrade(w, u);
  for (const a of opts.attachments || []) attach(w, a);
  return w;
}
export function makeMag(magId, ammo = null, rounds = 0) { const m = MAGAZINES[magId]; return { uid: nextUid(), id: magId, cal: m.cal, ammo: rounds > 0 ? ammo : null, rounds: Math.min(rounds, m.cap) }; }
export function makeGear(id, opts = {}) { const d = def(id); const g = { uid: nextUid(), id }; if (d.durability) g.durability = opts.durability ?? d.durability; if (d.battery || d.charge || d.filter) g.charge = opts.charge ?? 100; if (d.uses) g.uses = opts.uses ?? d.uses; return g; }
// attach: returns false if it does not fit. Rails go into w.rails; others into w.attachments[slot].
export function attach(w, attId) {
  const a = def(attId); const d = WEAPONS[w.id]; if (!a || !d || a.kind !== 'attachment') return false;
  const { attachmentFits } = attachmentFitsLazy();
  if (!attachmentFits(a, d, w.rails)) return false;
  if (a.slot === 'rail') { if (w.rails.includes(attId)) return false; w.rails.push(attId); return true; }
  if (w.attachments[a.slot]) return false;
  w.attachments[a.slot] = attId; return true;
}
export function detach(w, attId) {
  const a = def(attId); if (!a) return false;
  if (a.slot === 'rail') { const i = w.rails.indexOf(attId); if (i < 0) return false; // removing a rail drops what sat on it
    w.rails.splice(i, 1); const dropped = []; for (const [slot, id] of Object.entries(w.attachments)) { const att = def(id); const { attachmentFits } = attachmentFitsLazy(); if (!attachmentFits(att, WEAPONS[w.id], w.rails)) { dropped.push(id); delete w.attachments[slot]; } } return { dropped }; }
  for (const [slot, id] of Object.entries(w.attachments)) if (id === attId) { delete w.attachments[slot]; return true; }
  return false;
}
let _fits = null;
function attachmentFitsLazy() { if (!_fits) { _fits = { attachmentFits: (a, d, rails) => { const std = a.slot === 'rail' ? null : effMounts(d, rails)[a.slot]; if (a.slot === 'rail') return a.fits.some((f) => Object.values(d.mounts).includes(f)); return !!std && a.fits.includes(std); } }; } return _fits; }
export function effMounts(d, rails) { const m = Object.assign({}, d.mounts); for (const rid of rails || []) { const r = def(rid); if (r && r.gives) Object.assign(m, r.gives); } return m; }
// live effects of a weapon's attachments, multiplied together
export function weaponEffects(w) {
  const e = { zoom: 1, reticle: null, adsSpeed: 1, recoil: 1, moa: 1, noise: 1, flash: 1, light: 0, laser: false, ergo: 0, wear: 1, nvOptic: false, prone: false, zoomLow: null };
  const d = WEAPONS[w.id];
  if (d.suppressed) { e.noise *= d.suppressed; e.flash *= 0.1; }
  for (const id of [...Object.values(w.attachments || {}), ...(w.rails || [])]) {
    const a = def(id); if (!a || !a.effects) continue;
    for (const [k, v] of Object.entries(a.effects)) {
      if (k === 'zoom' || k === 'adsSpeed' || k === 'recoil' || k === 'moa' || k === 'noise' || k === 'flash' || k === 'wear') e[k] *= v;
      else if (k === 'ergo') e.ergo += v;
      else if (k === 'light') e.light = Math.max(e.light, v);
      else e[k] = v;
    }
  }
  // worn barrel spreads, worn bolt jams (handled by weapons), fouling adds a little of both
  e.moa *= 1 + (1 - (w.parts?.barrel ?? 100) / 100) * 0.9 + (w.dirt || 0) * 0.15;
  return e;
}
export function weaponWeight(w) { let kg = weightOf(w.id); for (const id of [...Object.values(w.attachments || {}), ...(w.rails || [])]) kg += weightOf(id); if (w.mag) kg += magWeight(w.mag); kg += (w.tube?.length || 0) * 0.02; return kg; }
export const magWeight = (m) => weightOf(m.id) + (m.rounds || 0) * (m.ammo ? weightOf(m.ammo) : 0.012);

export function defaultInventory() {
  const pm = makeWeapon('pm');
  const inv = { weapons: [pm], mags: [makeMag('mag_pm8', '9x18_fmj', 8), makeMag('mag_pm8', '9x18_fmj', 8)], gear: [], items: { bandage: 2, probe: 6, battery: 1, '9x18_fmj': 16, cigarettes: 1 }, equipment: { primary: null, secondary: null, sidearm: pm.uid, melee: null, vest: null, helmet: null, backpack: null, rig: null, headgear: null, mask: null }, quick: ['bandage', null, null, null], readyMags: [] };
  const rig = makeGear('rig_belt'), pack = makeGear('pack_tortilla'), knife = makeGear('knife'), torch = makeGear('torch');
  inv.gear.push(rig, pack, knife, torch); inv.equipment.rig = rig.uid; inv.equipment.backpack = pack.uid; inv.equipment.melee = knife.uid;
  inv.readyMags = inv.mags.map((m) => m.uid);
  return inv;
}

export function createInventory(ctx) {
  const inv = () => { const d = ctx.state.data; if (!d.inventory || !d.inventory.equipment) d.inventory = defaultInventory(); if (!d.storage) d.storage = { weapons: [], mags: [], gear: [], items: {} }; return d.inventory; };
  const emit = (id, delta) => ctx.events.emit('inventoryChanged', { id, delta });
  const api = {
    get data() { return inv(); },
    get weapons() { return inv().weapons; }, get mags() { return inv().mags; }, get gear() { return inv().gear; }, get items() { return inv().items; },
    get equipment() { return inv().equipment; }, get quick() { return inv().quick; },
    // ---- stackables ----
    count(id) { return inv().items[id] || 0; },
    has(id, n = 1) { return (inv().items[id] || 0) >= n; },
    add(id, n = 1) { const it = inv().items; it[id] = (it[id] || 0) + n; emit(id, n); return it[id]; },
    remove(id, n = 1) { const it = inv().items; if ((it[id] || 0) < n) return false; it[id] -= n; if (it[id] <= 0) delete it[id]; emit(id, -n); return true; },
    // ammo by ammo id (loose rounds); ammoCount by ammo id or by calibre ('9x18' sums all types)
    addAmmo(ammoId, n) { if (!AMMO[ammoId]) ammoId = defaultAmmo(ammoId) || ammoId; return api.add(ammoId, n); },
    ammoCount(idOrCal) { if (AMMO[idOrCal]) return api.count(idOrCal); let n = 0; for (const [id, c] of Object.entries(inv().items)) if (AMMO[id] && AMMO[id].cal === idOrCal) n += c; return n; },
    takeAmmo(ammoId, n) { const k = Math.min(api.count(ammoId), n); if (k > 0) api.remove(ammoId, k); return k; },
    ammoTypesOf(cal) { return Object.keys(inv().items).filter((id) => AMMO[id] && AMMO[id].cal === cal && inv().items[id] > 0); },
    preferredAmmo(cal) { const p = ctx.state.data.flags.ammoPref?.[cal]; if (p && api.count(p) > 0) return p; const t = api.ammoTypesOf(cal); return t[0] || defaultAmmo(cal); },
    setPreferredAmmo(cal, ammoId) { const f = ctx.state.data.flags; f.ammoPref = f.ammoPref || {}; f.ammoPref[cal] = ammoId; },
    // ---- weapons ----
    addWeapon(w) { inv().weapons.push(w); const d = WEAPONS[w.id]; const e = inv().equipment; const slot = d.cls === 'pistol' ? 'sidearm' : null; if (slot && !e[slot]) e[slot] = w.uid; else if (!e.primary) e.primary = w.uid; else if (!e.secondary) e.secondary = w.uid; emit(w.id, 1); return w; },
    removeWeapon(u) { const list = inv().weapons; const i = list.findIndex((w) => w.uid === u); if (i < 0) return null; const [w] = list.splice(i, 1); const e = inv().equipment; for (const s of SLOTS) if (e[s] === u) e[s] = null; emit(w.id, -1); return w; },
    weaponByUid(u) { return inv().weapons.find((w) => w.uid === u) || null; },
    weaponInSlot(i) { const e = inv().equipment; const u = typeof i === 'number' ? e[SLOTS[i]] : e[i]; return u ? api.weaponByUid(u) : null; },
    equipWeapon(u, slot) { const e = inv().equipment; if (!SLOTS.includes(slot)) return false; for (const s of SLOTS) if (e[s] === u) e[s] = null; e[slot] = u; emit('equip', 0); return true; },
    // ---- magazines ----
    addMag(m) { inv().mags.push(m); const rig = api.equippedDef('rig'); if (inv().readyMags.length < (rig?.readyMags || 0)) inv().readyMags.push(m.uid); emit(m.id, 1); return m; },
    removeMag(u) { const list = inv().mags; const i = list.findIndex((m) => m.uid === u); if (i < 0) return null; const [m] = list.splice(i, 1); inv().readyMags = inv().readyMags.filter((x) => x !== u); emit(m.id, -1); return m; },
    magByUid(u) { return inv().mags.find((m) => m.uid === u) || null; },
    magsForWeapon(w) { const fam = WEAPONS[w.id].family; return inv().mags.filter((m) => MAGAZINES[m.id].fits.includes(fam)); },
    isReady(magUid) { return inv().readyMags.includes(magUid); },
    setReady(magUid, ready) { const r = inv().readyMags; const rig = api.equippedDef('rig'); if (ready) { if (!r.includes(magUid) && r.length < (rig?.readyMags || 0)) r.push(magUid); } else { const i = r.indexOf(magUid); if (i >= 0) r.splice(i, 1); } },
    // best magazine to reload with: ready first, most rounds, preferred ammo
    bestMag(w, exclude = null) { const cal = WEAPONS[w.id].cal; const pref = api.preferredAmmo(cal); let best = null, bs = -1; for (const m of api.magsForWeapon(w)) { if (m === exclude || m.rounds <= 0) continue; const s = m.rounds + (api.isReady(m.uid) ? 1000 : 0) + (m.ammo === pref ? 50 : 0); if (s > bs) { bs = s; best = m; } } return best; },
    // load n loose rounds of ammoId into a magazine (single ammo type per magazine)
    loadMag(m, ammoId, n = 1) { const cap = MAGAZINES[m.id].cap; if (m.rounds > 0 && m.ammo !== ammoId) return 0; const k = Math.min(n, cap - m.rounds, api.count(ammoId)); if (k <= 0) return 0; api.remove(ammoId, k); m.ammo = ammoId; m.rounds += k; return k; },
    unloadMag(m) { if (m.rounds > 0 && m.ammo) api.add(m.ammo, m.rounds); m.rounds = 0; m.ammo = null; },
    fillMags(w) { let loaded = 0; const cal = WEAPONS[w.id].cal; for (const m of [...api.magsForWeapon(w), ...(w.mag ? [w.mag] : [])]) { const a = m.ammo || api.preferredAmmo(cal); loaded += api.loadMag(m, a, 999); } return loaded; },
    // ---- gear (armour, packs, rigs, headgear, masks, tools with instances) ----
    addGear(g) { inv().gear.push(g); const d = def(g.id); const e = inv().equipment; const slot = d.kind === 'vest' ? 'vest' : d.kind === 'helmet' ? 'helmet' : d.kind === 'backpack' ? 'backpack' : d.kind === 'rig' ? 'rig' : d.kind === 'headgear' ? 'headgear' : d.kind === 'mask' ? 'mask' : d.kind === 'melee' ? 'melee' : null; if (slot && !e[slot]) e[slot] = g.uid; emit(g.id, 1); return g; },
    removeGear(u) { const list = inv().gear; const i = list.findIndex((g) => g.uid === u); if (i < 0) return null; const [g] = list.splice(i, 1); const e = inv().equipment; for (const k of Object.keys(e)) if (e[k] === u) e[k] = null; emit(g.id, -1); return g; },
    gearByUid(u) { return inv().gear.find((g) => g.uid === u) || null; },
    equipGear(u, slot) { const e = inv().equipment; e[slot] = u; emit('equip', 0); },
    unequip(slot) { inv().equipment[slot] = null; emit('equip', 0); },
    equipped(slot) { const u = inv().equipment[slot]; return u ? (api.gearByUid(u) || api.weaponByUid(u)) : null; },
    equippedDef(slot) { const g = api.equipped(slot); return g ? def(g.id) : null; },
    // armour pieces covering the player, for resolveHit
    armorPieces() { const out = []; for (const s of ['helmet', 'vest', 'rig']) { const g = api.equipped(s); if (!g) continue; const d = def(g.id); if (d && (d.cls || d.armor)) out.push({ def: d.cls ? d : { cls: d.armor, zones: ['torso'], durability: 40 }, inst: g, slot: s }); } return out; },
    // ---- weight ----
    weight() { const d = inv(); let kg = 0; for (const w of d.weapons) kg += weaponWeight(w); for (const m of d.mags) kg += magWeight(m); for (const g of d.gear) kg += weightOf(g.id); for (const [id, n] of Object.entries(d.items)) kg += weightOf(id, n); return kg; },
    capacity() { const p = api.equippedDef('backpack'); return BASE_CAPACITY + (p?.capacity || 0); },
    overweight() { return Math.max(0, api.weight() - api.capacity()); },
    // ---- money ----
    money() { return ctx.state.data.money; },
    spend(n) { if (ctx.state.data.money < n) return false; ctx.state.data.money -= n; return true; },
    earn(n) { ctx.state.data.money += n; ctx.state.data.earned += n; ctx.events.emit('earned', n); },
    artifacts() { return Object.entries(inv().items).filter(([id]) => ITEMS[id]?.kind === 'artifact'); },
    // ---- quick slots (keys 6-9) ----
    setQuick(i, id) { inv().quick[i] = id; emit('quick', 0); },
    // ---- lifecycle ----
    dropAll() { const d = inv(); const keep = defaultInventory(); Object.assign(d, keep); emit('*', 0); },
    giveStarterKit() { Object.assign(inv(), defaultInventory()); emit('*', 0); },
    // everything as a flat list for panels: [{ kind, id, uid?, count, inst }]
    list() { const d = inv(); const out = []; for (const w of d.weapons) out.push({ kind: 'weapon', id: w.id, uid: w.uid, count: 1, inst: w }); for (const m of d.mags) out.push({ kind: 'mag', id: m.id, uid: m.uid, count: 1, inst: m }); for (const g of d.gear) out.push({ kind: def(g.id)?.kind || 'gear', id: g.id, uid: g.uid, count: 1, inst: g }); for (const [id, n] of Object.entries(d.items)) out.push({ kind: def(id)?.kind || 'item', id, count: n }); return out; },
  };
  // keep uid above saved ids
  const bump = (list) => { for (const x of list || []) uid = Math.max(uid, (x.uid || 0) + 1); };
  const d0 = inv(); bump(d0.weapons); bump(d0.mags); bump(d0.gear); for (const w of d0.weapons) if (w.mag) uid = Math.max(uid, w.mag.uid + 1);
  const st = ctx.state.data.storage; bump(st.weapons); bump(st.mags); bump(st.gear);
  return api;
}
// compat: old modules imported these names
export { WEAPONS as WEAPON_DEFS, AMMO, ITEMS };
