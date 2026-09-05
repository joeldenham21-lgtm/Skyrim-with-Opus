// Inventory data model. Plain data in state.data.inventory so it saves. Item defs are here so every module
// speaks the same names. Weapons carry their own mags: { id, dirt, mags: [rounds...], chamber, jammed }.
export const AMMO = {
  '9x18': { name: '9×18 mm', price: 6, mag: 8 },
  '7.62x39': { name: '7.62×39 mm', price: 14, mag: 30 },
  '12ga': { name: '12 ga', price: 12, mag: 2 },
  '7.62x54': { name: '7.62×54R', price: 22, mag: 5 },
};
export const ITEMS = {
  bandage: { name: 'Bandage', kind: 'med', price: 60, use: 3.0, desc: 'Stops bleeding. +10.' },
  medkit: { name: 'Field medkit', kind: 'med', price: 320, use: 5.0, desc: '+45 over eight seconds.' },
  stim: { name: 'Stimulant', kind: 'med', price: 140, use: 1.2, desc: 'Stamina restored. +5.' },
  battery: { name: 'Battery cell', kind: 'tool', price: 45, desc: 'Torch battery.' },
  probe: { name: 'Probe', kind: 'tool', price: 12, desc: 'Throw ahead. Reveals anomalies.' },
  cleankit: { name: 'Cleaning kit', kind: 'tool', price: 180, desc: 'Field-strips one weapon.' },
  detector: { name: 'Detector "Veer"', kind: 'tool', price: 900, desc: 'Ticks near artifacts.' },
  // artifacts
  art_pearl: { name: 'Pearl', kind: 'artifact', price: 1400, desc: 'Cold. Hums when held.' },
  art_ember: { name: 'Ember', kind: 'artifact', price: 1900, desc: 'Warm to the touch. Never cools.' },
  art_tear: { name: 'Tear', kind: 'artifact', price: 2600, desc: 'A drop that will not fall.' },
  art_crown: { name: 'Crown', kind: 'artifact', price: 5200, desc: 'Committee priority. Do not open.' },
  // mission objects
  recorder: { name: 'Data recorder', kind: 'mission', price: 0, desc: 'UNPSC property.' },
  beacon: { name: 'Survey beacon', kind: 'mission', price: 0, desc: 'Plant at the listed coordinates.' },
  dogtag: { name: 'Explorer tag', kind: 'mission', price: 0, desc: 'Explorer 44.' },
  samples: { name: 'Soil samples', kind: 'mission', price: 0, desc: 'Sealed. Three vials.' },
  guardlog: { name: 'Guard log', kind: 'mission', price: 0, desc: 'Checkpoint 2. Last entry incomplete.' },
  manifest: { name: 'Convoy manifest', kind: 'mission', price: 0, desc: 'Sealed steel case. Committee property.' },
  relay: { name: 'Signal relay', kind: 'mission', price: 0, desc: 'Plant at the listed coordinates. Do not open.' },
};
export const WEAPON_DEFS = {
  pm:    { name: 'PM', full: 'Makarov PM', ammo: '9x18', magSize: 8, damage: 22, rpm: 420, auto: false, spread: 1.6, recoil: 0.9, price: 380, level: 1, mags: 3, range: 60 },
  akm:   { name: 'AKM', full: 'AKM', ammo: '7.62x39', magSize: 30, damage: 38, rpm: 600, auto: true, spread: 2.4, recoil: 1.6, price: 2400, level: 2, mags: 3, range: 140 },
  toz:   { name: 'TOZ-34', full: 'TOZ-34 shotgun', ammo: '12ga', magSize: 2, damage: 9, pellets: 8, rpm: 220, auto: false, spread: 7.0, recoil: 3.2, price: 1100, level: 1, mags: 1, range: 22, breakOpen: true },
  mosin: { name: 'Mosin', full: 'Mosin-Nagant M91/30', ammo: '7.62x54', magSize: 5, damage: 95, rpm: 55, auto: false, spread: 0.4, recoil: 3.8, price: 3600, level: 3, mags: 2, range: 300, bolt: true },
};

let uid = 1;
export function makeWeapon(id) {
  const def = WEAPON_DEFS[id];
  return { uid: uid++, id, dirt: 0, jammed: false, chamber: def.breakOpen ? 0 : 1, mags: Array.from({ length: def.mags }, () => def.magSize), magIndex: 0 };
}

export function createInventory(ctx) {
  const st = ctx.state;
  if (!st.data.inventory) st.data.inventory = defaultInventory();
  if (!st.data.storage) st.data.storage = { items: {}, weapons: [] };
  const inv = () => { const d = ctx.state.data; if (!d.inventory) d.inventory = defaultInventory(); if (!d.storage) d.storage = { items: {}, weapons: [] }; return d.inventory; };
  const api = {
    get data() { return inv(); },
    get weapons() { return inv().weapons; },
    get slots() { return inv().slots; },
    get items() { return inv().items; },
    get ammo() { return inv().ammo; },
    count(id) { return inv().items[id] || 0; },
    has(id, n = 1) { return (inv().items[id] || 0) >= n; },
    add(id, n = 1) { const it = inv().items; it[id] = (it[id] || 0) + n; ctx.events.emit('inventoryChanged', { id, delta: n }); return it[id]; },
    remove(id, n = 1) { const it = inv().items; if ((it[id] || 0) < n) return false; it[id] -= n; if (it[id] <= 0) delete it[id]; ctx.events.emit('inventoryChanged', { id, delta: -n }); return true; },
    addAmmo(cal, n) { const a = inv().ammo; a[cal] = (a[cal] || 0) + n; ctx.events.emit('inventoryChanged', { id: cal, delta: n }); },
    ammoCount(cal) { return inv().ammo[cal] || 0; },
    takeAmmo(cal, n) { const a = inv().ammo; const k = Math.min(a[cal] || 0, n); a[cal] = (a[cal] || 0) - k; return k; },
    addWeapon(w) { inv().weapons.push(w); for (let i = 0; i < 4; i++) if (inv().slots[i] == null) { inv().slots[i] = w.uid; break; } ctx.events.emit('inventoryChanged', { id: w.id, delta: 1 }); return w; },
    removeWeapon(uidV) { const i = inv().weapons.findIndex((w) => w.uid === uidV); if (i < 0) return null; const [w] = inv().weapons.splice(i, 1); inv().slots = inv().slots.map((s) => (s === uidV ? null : s)); ctx.events.emit('inventoryChanged', { id: w.id, delta: -1 }); return w; },
    weaponInSlot(i) { const u = inv().slots[i]; return inv().weapons.find((w) => w.uid === u) || null; },
    weaponByUid(u) { return inv().weapons.find((w) => w.uid === u) || null; },
    // artifacts carried
    artifacts() { return Object.entries(inv().items).filter(([id]) => ITEMS[id]?.kind === 'artifact'); },
    // total value of carried sellables
    money() { return ctx.state.data.money; },
    spend(n) { if (ctx.state.data.money < n) return false; ctx.state.data.money -= n; return true; },
    earn(n) { ctx.state.data.money += n; ctx.state.data.earned += n; ctx.events.emit('earned', n); },
    // fill all magazines of a weapon from loose ammo. returns rounds loaded
    fillMags(w) { const def = WEAPON_DEFS[w.id]; let loaded = 0; for (let i = 0; i < w.mags.length; i++) { const need = def.magSize - w.mags[i]; const got = api.takeAmmo(def.ammo, need); w.mags[i] += got; loaded += got; } return loaded; },
    // lose everything carried (death in the Radius)
    dropAll() { const d = inv(); d.items = {}; d.ammo = {}; d.weapons = []; d.slots = [null, null, null, null]; ctx.events.emit('inventoryChanged', { id: '*', delta: 0 }); },
    // reset to a fresh explorer kit
    giveStarterKit() { const d = inv(); Object.assign(d, defaultInventory()); ctx.events.emit('inventoryChanged', { id: '*', delta: 0 }); },
  };
  // keep uid counter above any saved uid
  for (const w of inv().weapons) uid = Math.max(uid, w.uid + 1);
  for (const w of ctx.state.data.storage.weapons) uid = Math.max(uid, w.uid + 1);
  return api;
}

export function defaultInventory() {
  const pm = makeWeapon('pm');
  return { weapons: [pm], slots: [pm.uid, null, null, null], items: { bandage: 2, probe: 6, battery: 1 }, ammo: { '9x18': 16 } };
}
