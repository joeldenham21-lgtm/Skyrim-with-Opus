// The economy on paper. No browser, no renderer: this imports the catalogue straight out of src/data and
// replays what game/loot.js, enemies/loadout.js, ui/panel_supply.js and game/missions.js do with those
// numbers, so a price change can be judged before it is played.
//
//   node tools/scenarios/scarcity-model.mjs                       # the live tables
//   node tools/scenarios/scarcity-model.mjs --tables <dir>        # another copy of src/data (the baseline)
//   node tools/scenarios/scarcity-model.mjs --compare <dir>       # both, side by side
//
// Everything the player does is a parameter at the top of RUN. The assumptions are deliberately identical
// between the two table sets, so the delta is the tables and nothing else.
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

// ---- the harness -------------------------------------------------------------------------------
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const money = (n) => (n < 0 ? '-' : '') + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

async function load(dir) {
  const url = (f) => pathToFileURL(resolve(ROOT, dir, f)).href + '?t=' + Date.now();
  const I = await import(url('index.js'));
  const L = await import(url('loot.js'));
  const O = await import(url('loadouts.js'));
  return { I, L, O, dir };
}

// ---- what the Committee pays for a returned thing ----------------------------------------------
// ui/panel_supply.js: BUYBACK 0.4 of the listed price, attachments and the magazine in the gun included,
// loose rounds returned ten at a time at 0.4 each. ui/panel_terminal.js takes artifacts at full price.
const BUYBACK = 0.4;

function makeTables(T) {
  const { I, L, O } = T;
  const { WEAPONS, AMMO, MAGAZINES, ATTACHMENTS, ARMOR, ITEMS, categoryOf, attachmentsFor, def } = I;
  const { CONTAINERS, CATEGORY_SOURCES, AMMO_ROLL, COUNT_ROLL, CHEAP, CHEAP_MULT, FOUND, pickWeight, lootTier, TIER } = L;

  // pools, exactly as game/loot.js builds them
  const ALL = {};
  for (const table of [WEAPONS, AMMO, MAGAZINES, ATTACHMENTS, ARMOR, ITEMS]) {
    for (const d of Object.values(table)) { if (!d || d.hidden) continue; const c = categoryOf(d.id); if (!c || c === 'unknown') continue; (ALL[c] = ALL[c] || []).push(d); }
  }
  const POOLS = {};
  const poolFor = (cat) => POOLS[cat] || (POOLS[cat] = (CATEGORY_SOURCES[cat] || [cat]).flatMap((s) => ALL[s] || []));
  function pickDef(list, tier, rnd, filter = null) {
    let sum = 0; const w = new Array(list.length);
    for (let i = 0; i < list.length; i++) { const d = list[i]; const s = (!filter || filter(d)) ? pickWeight(d, tier) : 0; w[i] = s; sum += s; }
    if (sum <= 0) return null;
    let r = rnd() * sum;
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }
  function weighted(w, rnd) { let sum = 0; for (const k in w) sum += w[k]; let r = rnd() * sum; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; }
  const band = (r, t, rnd) => { const lo = lerp(r[0][0], r[1][0], t), hi = lerp(r[0][1], r[1][1], t); return lo + (hi - lo) * rnd(); };

  // value of one rolled entry in roubles, as the Return tab would pay for it
  const sellAmmo = (id, n) => (AMMO[id]?.price || 0) * n * BUYBACK;
  function rollWeaponValue(d, tier01, rnd) {
    let v = d.price;
    let hasMag = !!d.defaultMag;
    if (hasMag && rnd() < lerp(FOUND.weapon.noMag[0], FOUND.weapon.noMag[1], tier01)) hasMag = false;
    if (hasMag) { const m = MAGAZINES[d.defaultMag]; v += m.price; const rounds = Math.round(m.cap * band(FOUND.weapon.loaded, tier01, rnd)); v += rounds * (AMMO[I.defaultAmmo(m.cal)]?.price || 0) / BUYBACK * BUYBACK; }
    if (rnd() < lerp(FOUND.weapon.attachment[0], FOUND.weapon.attachment[1], tier01)) {
      const n = 1 + (rnd() < 0.3 ? 1 : 0);
      const fits = attachmentsFor(d.id, []);
      for (let i = 0; i < n; i++) { const a = pickDef(fits, tier01 * TIER.max, rnd); if (a) v += a.price || 0; }
    }
    return v * BUYBACK;
  }
  function rollOne(cat, tier, rnd, owned) {
    const tier01 = clamp(tier / TIER.max, 0, 1);
    if (cat === 'ammo') {
      const bias = owned.cals.size > 0 && rnd() < 0.6;
      const a = pickDef(poolFor('ammo'), tier, rnd, bias ? (d) => owned.cals.has(d.cal) : null) || pickDef(poolFor('ammo'), tier, rnd);
      if (!a) return null;
      const r = AMMO_ROLL[a.rarity] || AMMO_ROLL.common;
      const n = Math.max(1, Math.round(r[0] + (r[1] - r[0]) * rnd()));
      return { cat, id: a.id, n, value: sellAmmo(a.id, n), kg: (a.weight || 0.012) * n, rounds: owned.cals.has(a.cal) ? n : 0 };
    }
    if (cat === 'mag') {
      const bias = owned.fams.size > 0 && rnd() < 0.5;
      const m = pickDef(poolFor('mag'), tier, rnd, bias ? (d) => d.fits.some((f) => owned.fams.has(f)) : null) || pickDef(poolFor('mag'), tier, rnd);
      if (!m) return null;
      const empty = rnd() < lerp(FOUND.mag.empty[0], FOUND.mag.empty[1], tier01);
      const rounds = empty ? 0 : Math.max(1, Math.round(m.cap * band(FOUND.mag.rounds, tier01, rnd)));
      return { cat, id: m.id, n: 1, value: m.price * BUYBACK + sellAmmo(I.defaultAmmo(m.cal), rounds), kg: (m.weight || 0.2) + rounds * (AMMO[I.defaultAmmo(m.cal)]?.weight || 0.012), rounds: owned.cals.has(m.cal) ? rounds : 0 };
    }
    if (cat === 'weapon') { const d = pickDef(poolFor('weapon'), tier, rnd); if (!d) return null; return { cat, id: d.id, n: 1, value: rollWeaponValue(d, tier01, rnd), kg: (d.weight || 3) + (d.defaultMag ? (MAGAZINES[d.defaultMag].weight || 0.2) : 0), rounds: 0 }; }
    if (cat === 'armor' || cat === 'helmet' || cat === 'kit') { const d = pickDef(poolFor(cat), tier, rnd); if (!d) return null; return { cat, id: d.id, n: 1, value: (d.price || 0) * BUYBACK, kg: d.weight || 3, rounds: 0 }; }
    const d = pickDef(poolFor(cat), tier, rnd);
    if (!d) return null;
    const r = COUNT_ROLL[cat] || [1, 1];
    let n = Math.round(r[0] + (r[1] - r[0]) * rnd());
    if ((d.price || 0) <= CHEAP) n *= CHEAP_MULT;
    n = clamp(n, 1, d.stack || 1);
    const value = d.kind === 'artifact' ? (d.price || 0) * n : (d.price || 0) * n * BUYBACK;   // artifacts go to the terminal at full price
    return { cat, id: d.id, n, value, kg: (d.weight || 0.2) * n, rounds: 0 };
  }
  function rollContents(kind, tier, rnd, owned, keptShut = false) {
    const c = CONTAINERS[kind];
    if (!c) return [];
    if (c.empty && !keptShut && rnd() < c.empty) return [];
    const n = Math.round(c.rolls[0] + (c.rolls[1] - c.rolls[0]) * rnd());
    const out = [];
    for (let i = 0; i < n; i++) { const e = rollOne(weighted(c.categories, rnd), tier, rnd, owned); if (e) out.push(e); }
    return out;
  }
  return { ...I, ...L, ...O, poolFor, pickDef, weighted, rollContents, rollOne, band, BUYBACK, lootTier };
}

// ---- the census: what the structures actually put on the ground ---------------------------------
// Measured with tools/scenarios/scarcity-census.mjs against the built game (see the report). Containers
// per POI after game/loot.js has drawn its 0.75 share of the registered spots.
const CENSUS = {
  checkpoint: 11, convoy: 12, village: 26, industrial: 24, church: 13, rail: 15, forest: 9, marsh: 7, anomaly: 6, ridge: 10, field: 14,
};
const LOOSE_SHARE = 0.32;   // loose bandages / batteries / probes / ammo boxes, not containers

// ---- the run -----------------------------------------------------------------------------------
// One sortie: walk to a POI, search most of what is in it, fight what the census put there, walk home.
const RUN = {
  sortiesPerDay: 2,
  searchFraction: 0.7,           // of the containers at the POI
  contactsPerSortie: [3, 5],     // entities that have to be shot, by tide level 1..3
  roundsPerContact: 11,          // rifle rounds actually fired per entity killed, misses included
  mimicShare: 0.55,              // of contacts; the rest drop nothing worth carrying (spawn, fragment, slider)
  bandagesPerSortie: 1.4,
  medkitsPerDay: 0.7,
  batteriesPerDay: 1.0,
  probesPerSortie: 2.0,
  cleanPerShots: 80,             // one cleaning-kit use per this many rounds fired
  contractsPerDay: 1,
  baseCapacity: 10,              // inventory.js: 10 kg plus the backpack
  ownKit: 9,                     // what the Explorer is already carrying: guns, mags, meds, probes, water
};
// where the Explorer goes, by day: the zone opens up as clearance and the Tide climb
const ROUTE = [
  ['checkpoint', 'field'], ['convoy', 'village'], ['village', 'field'], ['zarya', 'marsh'],
  ['industrial', 'convoy'], ['rail', 'village'], ['church', 'field'], ['industrial', 'rail'],
  ['church', 'ridge'], ['ridge', 'industrial'], ['ridge', 'church'], ['ridge', 'rail'], ['ridge', 'industrial'], ['ridge', 'church'],
];
const POI_KIND = { zarya: 'village' };
const kindOf = (k) => POI_KIND[k] || k;

// contract pay, as game/missions.js computes it: base × (1 + dist/400) × (1 + 0.2(tide-1)), rounded to 50
const CONTRACT_BASE = { 1: 900, 2: 1000, 3: 1100 };
const CONTRACT_DIST = { 1: 1.35, 2: 1.5, 3: 1.75 };

function simulate(T, opts = {}) {
  const rnd = mulberry32(opts.seed ?? 12345);
  const { WEAPONS, AMMO, ITEMS, MAGAZINES, RANKS, rankFor, CONTAINERS_BY_POI, CONTAINERS, rollContents, lootTier, weighted } = T;
  const days = opts.days || 14;
  let money = 600, earned = 0, missions = 0, rank = 1, tide = 1, packId = 'pack_tortilla';
  const arsenal = ['pm'];               // ids the Explorer keeps
  const owned = { cals: new Set(['9x18']), fams: new Set(['pm']) };
  let rounds = { '9x18': 32 };          // loose rounds by calibre
  const log = [];
  const wantRounds = () => 120;         // the Explorer tops up to this many rounds of the working calibre before a sortie

  for (let day = 1; day <= days; day++) {
    if (day > 1 && (day - 1) % 3 === 0) tide = Math.min(3, tide + 1);
    let income = 0, spend = 0, lootValue = 0, dropValue = 0, artValue = 0, fired = 0, found = 0;
    const route = ROUTE[Math.min(ROUTE.length - 1, day - 1)];
    const packCap = T.ARMOR[packId]?.capacity || 12;
    for (let s = 0; s < RUN.sortiesPerDay; s++) {
      const pk = kindOf(route[s % route.length]);
      const tier = lootTier(pk, tide, rank);
      const table = CONTAINERS_BY_POI[pk] || CONTAINERS_BY_POI.field;
      const nHere = CENSUS[pk] ?? 12;
      const nSearch = Math.round(nHere * RUN.searchFraction * (1 - LOOSE_SHARE));
      const entries = [];
      for (let i = 0; i < nSearch; i++) {
        let kind = weighted(Object.fromEntries(Object.entries(table).filter(([k]) => (CONTAINERS[k].tierMin || 0) <= tier)), rnd);
        for (const e of rollContents(kind, tier, rnd, owned)) entries.push(e);
      }
      // fights
      const contacts = Math.round(lerp(RUN.contactsPerSortie[0], RUN.contactsPerSortie[1], (tide - 1) / 2));
      const shots = Math.round(contacts * RUN.roundsPerContact);
      fired += shots;
      for (let i = 0; i < contacts * RUN.mimicShare; i++) for (const e of mimicDrop(T, rnd, tide, rank, pk, owned)) entries.push(e);
      // what comes home: the most valuable entries, capped by what an Explorer can carry
      // an Explorer walks home with what pays best per kilogram, and no more than the pack holds
      entries.sort((a, b) => (b.value / Math.max(0.02, b.kg || 0.2)) - (a.value / Math.max(0.02, a.kg || 0.2)));
      let free = RUN.baseCapacity + packCap - RUN.ownKit;
      const carried = [];
      for (const e of entries) { const k = e.kg || 0.2; if (k > free) continue; free -= k; carried.push(e); }
      for (const e of carried) {
        found++;
        if (ITEMS[e.id] && ITEMS[e.id].kind === 'artifact') artValue += e.value;
        else if (e.from === 'mimic') dropValue += e.value; else lootValue += e.value;
        if (e.rounds) rounds[AMMO[e.id]?.cal || MAGAZINES[e.id]?.cal] = (rounds[AMMO[e.id]?.cal || MAGAZINES[e.id]?.cal] || 0) + e.rounds;
      }
      // consumption paid for out of pocket (what was not found)
      spend += RUN.bandagesPerSortie * (ITEMS.bandage.price) * 0.5;
      spend += RUN.probesPerSortie * ITEMS.probe.price * 0.5;
    }
    // contracts
    const base = CONTRACT_BASE[Math.min(3, rank)] * CONTRACT_DIST[Math.min(3, rank)] * (1 + 0.2 * (tide - 1));
    const pay = Math.round(base / 50) * 50 * RUN.contractsPerDay;
    income += pay; missions += RUN.contractsPerDay;
    // selling what came home
    income += lootValue + dropValue + artValue;
    // running costs
    const cal = bestCal(T, arsenal);
    const ppr = AMMO[T.defaultAmmo(cal)]?.price || 5;
    const bought = Math.max(0, fired - (rounds[cal] || 0));
    rounds[cal] = Math.max(0, (rounds[cal] || 0) - fired);
    spend += bought * ppr;
    spend += ITEMS.medkit.price * RUN.medkitsPerDay * 0.6;
    spend += ITEMS.battery.price * RUN.batteriesPerDay;
    spend += (fired / RUN.cleanPerShots) * (ITEMS.cleankit.price / (ITEMS.cleankit.uses || 4));
    spend += (fired * 0.05 / 100) * (ITEMS.repairkit.price / (ITEMS.repairkit.uses || 2)) * 3;   // three parts, wear-driven
    money += income - spend;
    earned += income;
    rank = rankFor(earned, missions);
    // the arsenal: buy the best thing the clearance allows once there is comfortable money for it
    const packs = ['pack_tortilla', 'pack_pilgrim', 'pack_attack2', 'pack_6sh118'];
    const pi = packs.indexOf(packId);
    if (pi >= 0 && pi < packs.length - 1) { const nx = T.ARMOR[packs[pi + 1]]; if ((nx.rank || 1) <= rank && money > nx.price * 2.2) { money -= nx.price; packId = nx.id; } }
    const buy = shopUpgrade(T, arsenal, rank, money);
    if (buy) { money -= buy.price; arsenal.push(buy.id); owned.cals.add(buy.cal); owned.fams.add(buy.family); }
    log.push({ day, tide, rank, money, earned, income, spend, lootValue, dropValue, artValue, pay, fired, found, arsenal: [...arsenal], pack: packId, kit: kitValue(T, arsenal) });
  }
  return log;
}
function bestCal(T, arsenal) { let best = null, bp = -1; for (const id of arsenal) { const d = T.WEAPONS[id]; if (d && d.price > bp) { bp = d.price; best = d.cal; } } return best || '9x18'; }
function kitValue(T, arsenal) { let v = 0; for (const id of arsenal) v += T.WEAPONS[id]?.price || 0; return v; }
function shopUpgrade(T, arsenal, rank, money) {
  const have = new Set(arsenal);
  const cands = Object.values(T.WEAPONS).filter((w) => !have.has(w.id) && (w.rank || 1) <= rank && w.cls !== 'pistol');
  const best = kitValue(T, arsenal);
  let pick = null;
  for (const w of cands) if (w.price > best * 0.9 && w.price <= money * 0.45 && (!pick || w.price > pick.price)) pick = w;
  return pick;
}
function mimicDrop(T, rnd, tide, security, pk, owned) {
  const { MIMIC_CLASSES, CLASS_MIX, POI_TIER, WEAPONS, MAGAZINES, ARMOR, ITEMS, AMMO, DROPS, GEAR_CURVE, gearProgress, def } = T;
  const tier = clamp((tide | 0) + (POI_TIER[pk] ?? 1), 1, 4);
  const mix = CLASS_MIX[tier] || CLASS_MIX[1];
  let sum = 0; for (const k in mix) sum += mix[k];
  let r = rnd() * sum, cls = 'regular';
  for (const k in mix) { r -= mix[k]; if (r <= 0) { cls = k; break; } }
  const c = MIMIC_CLASSES[cls] || MIMIC_CLASSES.regular;
  const CLASS_RANK = { recruit: 0, regular: 1, shotgunner: 2, gunner: 2, veteran: 3, sniper: 3, elite: 4 };
  const p = gearProgress({ tide, security, classRank: CLASS_RANK[cls] ?? 1 });
  const RARITY_GRADE = { common: 1, uncommon: 1.35, rare: 1.8, epic: 2.3 };
  const gradeOf = (d) => ((d.rank || 1) * 0.55 + (RARITY_GRADE[d.rarity] || 1)) * 0.5;
  const gradedPick = (ids, table) => {
    const bias = lerp(GEAR_CURVE.grade[0], GEAR_CURVE.grade[1], p);
    let s = 0; const w = [], list = [];
    for (const id of ids || []) { const d = table ? table[id] : def(id); if (!d) continue; const v = Math.pow(Math.max(0.05, gradeOf(d)), bias); list.push(d); w.push(v); s += v; }
    if (!list.length) return null;
    let q = rnd() * s; for (let i = 0; i < list.length; i++) { q -= w[i]; if (q <= 0) return list[i]; }
    return list[list.length - 1];
  };
  const out = [];
  const wd = gradedPick(c.weapons, WEAPONS) || WEAPONS.akm;
  const rank01 = (CLASS_RANK[cls] ?? 1) / 4;
  const BUY = 0.4;
  const magDef = wd.defaultMag ? MAGAZINES[wd.defaultMag] : null;
  if (rnd() >= DROPS.lost && rnd() < DROPS.weapon) {
    let v = wd.price;
    const mult = lerp(GEAR_CURVE.attach[0], GEAR_CURVE.attach[1], p);
    for (const [id, ch] of Object.entries(c.attachments || {})) if (rnd() < ch * mult) v += def(id)?.price || 0;
    if (magDef) v += magDef.price;
    out.push({ from: 'mimic', cat: 'weapon', id: wd.id, n: 1, value: v * BUY, kg: (wd.weight || 3) + (magDef ? magDef.weight : 0), rounds: 0 });
  }
  const want = Math.max(0, (c.mags || 2) + Math.round(lerp(GEAR_CURVE.spares[0], GEAR_CURVE.spares[1], p)));
  const spare = Math.min(5, Math.max(magDef && !wd.clip ? 0 : 1, Math.floor(lerp(Math.max(0, want - 1), want, rnd()))));
  const ammoId = T.defaultAmmo(wd.cal);
  for (let i = 0; i < spare; i++) {
    if (rnd() >= DROPS.mag) continue;
    if (!magDef) continue;
    const fill = Math.round(magDef.cap * lerp(lerp(GEAR_CURVE.magFill[0][0], GEAR_CURVE.magFill[1][0], p), lerp(GEAR_CURVE.magFill[0][1], GEAR_CURVE.magFill[1][1], p), rnd()));
    out.push({ from: 'mimic', cat: 'mag', id: magDef.id, n: 1, value: magDef.price * BUY + fill * (AMMO[ammoId]?.price || 0) * BUY, kg: magDef.weight + fill * (AMMO[ammoId]?.weight || 0.012), rounds: owned.cals.has(wd.cal) ? fill : 0 });
  }
  const skipVest = rnd() < lerp(GEAR_CURVE.bare[0], GEAR_CURVE.bare[1], p) * (c.bare ?? 1);
  if (!skipVest) { const v = gradedPick(c.armor, ARMOR); if (v) { const left = lerp(lerp(GEAR_CURVE.durability[0][0], GEAR_CURVE.durability[1][0], p), lerp(GEAR_CURVE.durability[0][1], GEAR_CURVE.durability[1][1], p), rnd()); if (rnd() < lerp(DROPS.vest[0], DROPS.vest[1], left)) out.push({ from: 'mimic', cat: 'armor', id: v.id, n: 1, value: v.price * BUY, kg: v.weight || 5, rounds: 0 }); } }
  const skipHelm = rnd() < lerp(GEAR_CURVE.bareHelmet[0], GEAR_CURVE.bareHelmet[1], p) * (c.bare ?? 1);
  if (!skipHelm) { const h = gradedPick(c.helmet, ARMOR); if (h) { const left = 0.7; if (rnd() < lerp(DROPS.helmet[0], DROPS.helmet[1], left)) out.push({ from: 'mimic', cat: 'helmet', id: h.id, n: 1, value: h.price * BUY, kg: h.weight || 1.5, rounds: 0 }); } }
  if (c.kit && c.kit.length && rnd() < 0.25 + p * 0.55 && rnd() < 0.6) { const k = gradedPick(c.kit, ARMOR); if (k) out.push({ from: 'mimic', cat: 'kit', id: k.id, n: 1, value: (k.price || 0) * BUY, kg: k.weight || 1, rounds: 0 }); }
  for (const id of c.drops || []) { if (rnd() < 0.4 + p * 0.25 && rnd() < DROPS.item) { const d = def(id); if (d) out.push({ from: 'mimic', cat: 'item', id, n: 1, value: (d.price || 0) * BUY, kg: d.weight || 0.2, rounds: 0 }); } }
  const loose = Math.round(lerp(DROPS.loose[0], DROPS.loose[1], rnd()));
  if (loose > 0) out.push({ from: 'mimic', cat: 'ammo', id: ammoId, n: loose, value: (AMMO[ammoId]?.price || 0) * loose * BUY, kg: loose * (AMMO[ammoId]?.weight || 0.016), rounds: owned.cals.has(wd.cal) ? loose : 0 });
  return out;
}

// ---- container expected value, for the audit table ---------------------------------------------
function containerEV(T, kind, tier, samples = 4000) {
  const rnd = mulberry32(7 + tier * 31 + kind.length * 17);
  const owned = { cals: new Set(['7.62x39', '9x18']), fams: new Set(['ak762', 'pm']) };
  let v = 0, n = 0;
  for (let i = 0; i < samples; i++) { const es = T.rollContents(kind, tier, rnd, owned); for (const e of es) { v += e.value; n++; } }
  return { value: v / samples, entries: n / samples };
}

// ---- report ------------------------------------------------------------------------------------
function report(name, T, seeds = [12345, 999, 4242]) {
  const runs = seeds.map((s) => simulate(T, { seed: s }));
  const avg = (day, k) => runs.reduce((s, r) => s + r[day - 1][k], 0) / runs.length;
  const out = [];
  out.push(`\n===== ${name} =====`);
  out.push(pad('day', 5) + rpad('tide', 5) + rpad('rank', 6) + rpad('income', 10) + rpad('costs', 9) + rpad('balance', 10) + rpad('earned', 10) + rpad('kit ₽', 9) + '  arsenal');
  for (const day of [1, 2, 3, 5, 7, 10, 14]) {
    const r = runs[0][day - 1];
    out.push(pad(day, 5) + rpad(r.tide, 5) + rpad(Math.round(avg(day, 'rank') * 10) / 10, 6) + rpad(money(avg(day, 'income')), 10) + rpad(money(avg(day, 'spend')), 9)
      + rpad(money(avg(day, 'money')), 10) + rpad(money(avg(day, 'earned')), 10) + rpad(money(avg(day, 'kit')), 9) + '  ' + r.arsenal.join(' '));
  }
  const d1 = runs[0][0], d7 = runs[0][6];
  out.push(`  income split day 1: contract ${money(d1.pay)} · containers ${money(d1.lootValue)} · bodies ${money(d1.dropValue)} · artifacts ${money(d1.artValue)}`);
  out.push(`  income split day 7: contract ${money(d7.pay)} · containers ${money(d7.lootValue)} · bodies ${money(d7.dropValue)} · artifacts ${money(d7.artValue)}`);
  out.push(`  rounds fired day 7: ${d7.fired} · items carried home ${d7.found}`);
  return { text: out.join('\n'), runs };
}

const live = makeTables(await load(arg('--tables', 'src/data')));
console.log(report(arg('--name', 'LIVE ' + arg('--tables', 'src/data')), live).text);

if (has('--containers')) {
  console.log('\ncontainer expected value (₽ returned at the crate), by tier');
  console.log(pad('container', 16) + [0, 1, 2, 3, 4, 5].map((t) => rpad('t' + t, 9)).join(''));
  for (const k of Object.keys(live.CONTAINERS)) {
    console.log(pad(k, 16) + [0, 1, 2, 3, 4, 5].map((t) => rpad(money(containerEV(live, k, t).value), 9)).join(''));
  }
}
if (has('--compare')) {
  const other = makeTables(await load(arg('--compare')));
  console.log(report('BASELINE ' + arg('--compare'), other).text);
}
