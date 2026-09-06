// Supply crate: Committee requisition ledger. Left index of categories, rows with name / one-line description /
// weight / price, BUY issues instances (weapons loaded, magazines empty, gear with full durability) or stacks
// (ammunition per 10 rounds). RETURN buys back at 40 % of list; artifacts are submitted at the terminal only.
// Panel module: { id, title, render(ctx, api, data) -> HTMLElement, onKey(e), onClose() } for ui/panels.js (the router).
import { WEAPONS, AMMO, MAGAZINES, ARMOR, CALIBERS, RANKS, def, categoryOf, shopItems, weightOf, priceOf } from '../data/index.js';
import { makeWeapon, makeMag, makeGear, weaponWeight, magWeight } from '../player/inventory.js';
import { money, esc, kg, act, tabsHtml, panelKit, ensureStyle, rankTitle } from './menus.js';

const CSS = `
#panels .p-supply { min-width: 720px; max-width: 860px; }
#panels .p-supply .strip { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 18px; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-dim); margin: -2px 0 6px; }
#panels .p-supply .strip b { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }
#panels .p-supply .strip b.red { color: var(--red-ink); }
#panels .p-supply .ledger { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 0 18px; }
#panels .p-supply .index { border-right: 1px solid var(--ink-hair); padding-right: 6px; }
#panels .p-supply .cat { display: flex; justify-content: space-between; width: 100%; background: transparent; border: 0; border-bottom: 1px dotted var(--ink-hair); color: var(--ink-dim); font-family: var(--mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; text-align: left; padding: 6px 4px; cursor: pointer; }
#panels .p-supply .cat:hover { color: var(--ink); background: var(--amber-wash); }
#panels .p-supply .cat.on { color: var(--ink); box-shadow: inset 2px 0 0 var(--amber-ink); background: var(--amber-wash); }
#panels .p-supply .cat.none { color: var(--ink-faint); }
#panels .p-supply .cat .n { color: var(--amber-ink); letter-spacing: 0; font-variant-numeric: tabular-nums; }
#panels .p-supply .cat.none .n { color: var(--ink-faint); }
#panels .p-supply .scroll { max-height: calc(88vh - 236px); min-height: 220px; overflow-y: auto; overflow-x: hidden; padding-right: 6px; scrollbar-width: thin; scrollbar-color: var(--ink-dot) transparent; }
#panels .p-supply .scroll::-webkit-scrollbar { width: 5px; } #panels .p-supply .scroll::-webkit-scrollbar-thumb { background: var(--ink-dot); }
#panels .p-supply .row.shop { grid-template-columns: minmax(0, 1fr) 60px 90px auto; }
#panels .p-supply .row.shop .k .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#panels .p-supply .row.shop .k .tag { margin-left: 8px; }
#panels .p-supply .row.shop .lock { font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-faint); white-space: nowrap; }
#panels .p-supply .row.dim .k .sub { color: var(--ink-faint); }
#panels .p-supply .cat-t { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--amber-ink); margin: 2px 0 4px; display: flex; gap: 10px; align-items: center; white-space: nowrap; }
#panels .p-supply .cat-t::after { content: ''; flex: 1; height: 1px; background: var(--ink-hair); }
#panels .p-supply .cat-t .n { color: var(--ink-dim); letter-spacing: 0.1em; }
#panels .p-supply .keys { margin-top: 8px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-faint); }
@media (max-width: 900px) { #panels .p-supply { min-width: 0; } #panels .p-supply .ledger { grid-template-columns: 1fr; } #panels .p-supply .index { border-right: 0; display: flex; flex-wrap: wrap; gap: 2px 4px; margin-bottom: 6px; } #panels .p-supply .cat { width: auto; } }
`;

const CATS = [
  ['weapons', 'Weapons'], ['ammo', 'Ammunition'], ['mags', 'Magazines'], ['attachments', 'Attachments'], ['armor', 'Armour'], ['helmets', 'Helmets'],
  ['packs', 'Packs and rigs'], ['head', 'Headgear and masks'], ['med', 'Medical'], ['food', 'Food'], ['tools', 'Tools'], ['grenades', 'Grenades'], ['parts', 'Parts'],
];
const CAT_OF = { weapon: 'weapons', ammo: 'ammo', mag: 'mags', attachment: 'attachments', armor: 'armor', helmet: 'helmets', pack: 'packs', rig: 'packs', headgear: 'head', mask: 'head', med: 'med', food: 'food', tool: 'tools', battery: 'tools', filter: 'tools', melee: 'tools', grenade: 'grenades', part: 'parts' };
const catKey = (id) => CAT_OF[categoryOf(id)] || null;
const catLabel = (key) => (CATS.find(([k]) => k === key) || [])[1] || key;
const BUYBACK = 0.4;
// gear that lives as an instance (durability / charge / uses) rather than a stack
const isInstance = (d) => !!ARMOR[d.id] || d.stack === 1;
const pct = (m) => { const v = Math.round((m - 1) * 100); return `${v > 0 ? '+' : '−'}${Math.abs(v)} %`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fitsNames = (m) => Object.values(WEAPONS).filter((w) => m.fits.includes(w.family)).map((w) => w.name).join(', ');
const modeText = (d) => d.modes.map((m) => ({ semi: 'semi', auto: 'auto', bolt: 'bolt', pump: 'pump', break: 'break-open' }[m] || m)).join(' / ');
const ammoKind = { fmj: 'ball', hp: 'expanding', ap: 'armour-piercing', sub: 'subsonic', tracer: 'tracer', buck: 'buckshot', slug: 'slug', flechette: 'flechette' };

// the one line under a name: the definition's own note, or the figures that matter for its kind
export function lineOf(d) {
  const c = categoryOf(d.id);
  const own = d.desc ? d.desc.replace(/\s+$/, '') : '';
  if (c === 'weapon') { const mag = d.defaultMag ? MAGAZINES[d.defaultMag]?.cap : d.internal; return `${CALIBERS[d.cal]?.short || d.cal} · ${modeText(d)} · ${d.rpm} rpm · ${mag} rounds${d.suppressed ? ' · integral suppressor' : ''}`; }
  if (c === 'ammo') { const k = d.blunt ? 'rubber' : ammoKind[d.kind] || d.kind; const dmg = d.pellets > 1 ? `${d.damage} × ${d.pellets}` : `${d.damage}`; return `${cap(k)} · damage ${dmg} · penetration class ${d.pen}${d.noise < 0.7 ? ' · quiet' : ''} · per 10 rounds`; }
  if (c === 'mag') return `${d.cap} rounds${d.clip ? ', clip' : ''} · fits ${fitsNames(d)}`;
  if (c === 'attachment') {
    if (own) return own;
    const e = d.effects || {}, p = [];
    if (d.gives) p.push('adds ' + Object.entries(d.gives).map(([s, v]) => `${v} ${s}`).join(', '));
    if (e.zoom && e.zoom !== 1) p.push(`${e.zoomLow ? `${e.zoomLow}–` : ''}${e.zoom}×`); else if (e.reticle) p.push(e.reticle === 'holo' ? 'holographic' : 'collimator');
    if (e.recoil) p.push(`recoil ${pct(e.recoil)}`); if (e.moa) p.push(`spread ${pct(e.moa)}`); if (e.noise) p.push(`noise ${pct(e.noise)}`); if (e.flash && e.flash < 1) p.push(`flash ${pct(e.flash)}`);
    if (e.adsSpeed) p.push(`aim ${pct(e.adsSpeed)}`); if (e.light) p.push('weapon light'); if (e.laser) p.push('laser'); if (e.nvOptic) p.push('night optic'); if (e.ergo) p.push(`handling ${e.ergo > 0 ? '+' : '−'}${Math.abs(Math.round(e.ergo * 100))} %`);
    return p.join(' · ') || `${cap(d.slot)} mount`;
  }
  if (c === 'armor' || c === 'helmet') return `Class ${d.cls} · covers ${d.zones.join(', ')} · ${d.durability} durability${own ? ' · ' + own : ''}`;
  if (c === 'pack') return `+${d.capacity} kg carried${own ? ' · ' + own : ''}`;
  if (c === 'rig') return `${d.readyMags} magazine pouches${d.armor ? ` · class ${d.armor} insert` : ''}${own ? ' · ' + own : ''}`;
  if (c === 'headgear') return own || (d.nvg ? `Night vision, generation ${d.nvg}` : 'Headlamp');
  if (c === 'mask') return own || 'Filters the gas.';
  if (c === 'melee') return `${own ? own + ' ' : ''}Damage ${d.damage}.`;
  if (c === 'grenade') return `${own ? own + ' ' : ''}${d.damage ? `Blast ${d.radius} m, ${d.damage}.` : `Radius ${d.radius} m.`} Fuse ${d.fuse} s.`;
  if (c === 'part') return `Restores the ${d.part} to 100 % at the workbench.`;
  if (c === 'filter') return `For the mask. ${d.charge} minutes of gas.`;
  if (c === 'tool' && d.zoom) return `${d.zoom}× magnification. Hold N.`;
  if (own) return own;
  const e = d.effect || {}, p = [];
  if (e.heal) p.push(`+${e.heal}`); if (e.healOver) p.push(`+${e.healOver[0]} over ${e.healOver[1]} s`); if (e.stamina) p.push(`stamina +${e.stamina}`);
  if (e.staminaRegen) p.push(`${Math.round(e.staminaRegen[0] / 60)} min of better wind`); if (e.stopBleed) p.push('stops bleeding');
  return p.length ? cap(p.join(', ')) + '.' : '';
}

const S = { mode: 'buy', cat: 'weapons', notice: '', red: false, rerender: null };

export default {
  id: 'supply', title: 'Supply crate',
  render(ctx, api, data = {}) {
    ensureStyle('ui-b-supply', CSS);
    if (data.tab === 'sell' || data.tab === 'buy') S.mode = data.tab;
    if (data.cat && CATS.some(([k]) => k === data.cat)) S.cat = data.cat;
    const root = document.createElement('div'); root.className = 'p-supply';
    const D = () => ctx.state.data, inv = ctx.inventory;

    // ---- catalogue by category (locked rows stay visible, greyed) ----
    function catalogue() {
      const lvl = D().securityLevel, by = {};
      for (const d of shopItems(RANKS[RANKS.length - 1].rank)) { const k = catKey(d.id); if (!k) continue; (by[k] ||= []).push(d); }
      for (const list of Object.values(by)) list.sort((a, b) => (a.rank || 1) - (b.rank || 1) || (a.price || 0) - (b.price || 0));
      return { by, lvl };
    }
    function shopRow(d, lvl) {
      const locked = (d.rank || 1) > lvl, c = categoryOf(d.id);
      const qty = c === 'ammo' ? 10 : 1, price = priceOf(d.id) * qty, w = weightOf(d.id, qty) + (c === 'weapon' && d.defaultMag ? weightOf(d.defaultMag) : 0);
      const carried = c === 'weapon' ? inv.weapons.filter((x) => x.id === d.id).length : c === 'mag' ? inv.mags.filter((x) => x.id === d.id).length : isInstance(d) ? inv.gear.filter((x) => x.id === d.id).length : inv.count(d.id);
      const name = esc(d.full || d.name);
      const tag = carried > 0 ? `<span class="tag">carried ${carried}</span>` : '';
      const afford = D().money >= price;
      const action = locked ? `<span class="lock">Clearance ${d.rank} required</span>` : act(`buy:${d.id}`, 'Buy', { deny: !afford });
      return `<div class="row shop ${locked ? 'dim' : ''}"><div class="k">${name}${tag}<span class="sub">${esc(lineOf(d))}</span></div><div class="num">${kg(w, w < 0.1 ? 2 : 1)}</div><div class="num">${money(price)}</div><div class="acts">${action}</div></div>`;
    }
    // ---- carried sellables ----
    function carried() {
      const by = {};
      const push = (k, e) => { if (k) (by[k] ||= []).push(e); };
      for (const w of inv.weapons) {
        const d = WEAPONS[w.id]; const atts = [...Object.values(w.attachments || {}), ...(w.rails || [])];
        const list = d.price + atts.reduce((s, id) => s + priceOf(id), 0) + (w.mag ? priceOf(w.mag.id) : 0);
        const loaded = (w.chamber ? 1 : 0) + (w.mag ? w.mag.rounds : 0) + (w.tube?.length || 0);
        const sub = [atts.length ? 'with ' + atts.map((id) => def(id)?.name || id).join(', ') : 'no attachments', w.mag ? `${MAGAZINES[w.mag.id]?.name || w.mag.id} inserted` : '', loaded ? `${loaded} rounds returned to kit` : ''].filter(Boolean).join(' · ');
        push('weapons', { key: `w:${w.uid}`, name: d.full || d.name, sub, w: weaponWeight(w), price: Math.round(list * BUYBACK) });
      }
      for (const m of inv.mags) { const d = MAGAZINES[m.id]; push('mags', { key: `m:${m.uid}`, name: d.name, sub: `${m.rounds} / ${d.cap}${m.ammo ? ' ' + (AMMO[m.ammo]?.name || m.ammo) : ''}${m.rounds ? ' · rounds returned to kit' : ''}${inv.isReady?.(m.uid) ? ' · in the rig' : ''}`, w: magWeight(m), price: Math.round(d.price * BUYBACK) }); }
      const eq = inv.equipment;
      for (const g of inv.gear) {
        const d = def(g.id); if (!d || !(d.price > 0)) continue;
        const worn = Object.values(eq).includes(g.uid);
        const cond = d.durability ? ` · ${Math.round(((g.durability ?? d.durability) / d.durability) * 100)} %` : g.charge != null ? ` · charge ${Math.round(g.charge)} %` : g.uses != null ? ` · ${g.uses} uses` : '';
        push(catKey(g.id), { key: `g:${g.uid}`, name: d.name, sub: `${worn ? 'worn' : 'in the pack'}${cond}`, w: weightOf(g.id), price: Math.round(d.price * BUYBACK) });
      }
      for (const [id, n] of Object.entries(inv.items)) {
        const d = def(id); if (!d || n <= 0 || !(d.price > 0) || d.kind === 'artifact' || d.kind === 'mission' || d.kind === 'key') continue;
        const c = categoryOf(id), q = c === 'ammo' ? Math.min(10, n) : 1;
        push(catKey(id), { key: `i:${id}`, name: d.name, sub: c === 'ammo' ? `${n} loose · ${q} per return` : `carried ${n}`, w: weightOf(id, q), price: Math.round(d.price * q * BUYBACK) });
      }
      return by;
    }
    const sellRow = (e) => `<div class="row shop"><div class="k">${esc(e.name)}<span class="sub">${esc(e.sub)}</span></div><div class="num">${kg(e.w, e.w < 0.1 ? 2 : 1)}</div><div class="num">${money(e.price)}</div><div class="acts">${act(`sell:${e.key}`, 'Return')}</div></div>`;

    function fill() {
      const d = D(), over = inv.overweight(), lvl = d.securityLevel;
      const buy = S.mode === 'buy';
      const { by } = buy ? catalogue() : { by: carried() };
      const cats = buy ? CATS : CATS.filter(([k]) => by[k]?.length);
      if (!cats.some(([k]) => k === S.cat)) S.cat = cats[0]?.[0] || S.cat;
      const index = cats.map(([k, label]) => { const n = by[k]?.length || 0; const unlocked = buy ? (by[k] || []).filter((x) => (x.rank || 1) <= lvl).length : n; return `<button class="cat ${k === S.cat ? 'on' : ''} ${n ? '' : 'none'}" data-x="cat:${k}" tabindex="-1">${label}<span class="n">${buy ? unlocked : n}${buy && n > unlocked ? `<span class="dimink"> / ${n}</span>` : ''}</span></button>`; }).join('');
      const list = by[S.cat] || [];
      const rows = buy ? list.map((x) => shopRow(x, lvl)).join('') : list.map(sellRow).join('');
      const empty = buy ? '<div class="empty">Nothing in this category is stocked.</div>' : cats.length ? '<div class="empty">Nothing to return in this category.</div>' : '<div class="empty">Nothing carried that the crate takes back. Artifacts are submitted at the terminal.</div>';
      const note = buy
        ? '<div class="note">Requisitions are deducted from contract funds. Weapons are issued loaded; magazines empty; ammunition in lots of ten. Greyed lines await clearance.</div>'
        : '<div class="note">Buy-back at 40 % of list. Weapons go with their attachments and inserted magazine; loaded rounds are returned to the kit first. Artifacts are submitted at the terminal, not here.</div>';
      return `<div class="strip"><span>Funds <b>${money(d.money)}</b></span><span>Load <b class="${over > 0 ? 'red' : ''}">${inv.weight().toFixed(1)} / ${inv.capacity()} kg</b>${over > 0 ? ` <b class="red">· over by ${over.toFixed(1)} kg</b>` : ''}</span><span>Clearance <b>${lvl}</b> · ${esc(rankTitle(lvl))}</span></div>` +
        tabsHtml([['buy', 'Requisition'], ['sell', 'Return']], S.mode) +
        `<div class="ledger"><div class="index">${index}</div><div class="main"><div class="cat-t">${esc(catLabel(S.cat))}<span class="n">${list.length}</span></div><div class="scroll">${rows || empty}</div></div></div>` +
        note + `<div class="keys">←→ category · ↑↓ select · Enter confirm · 1–9 pick</div>`;
    }

    const handlers = {
      tab(t) { S.mode = t; redo(); return 'ui_click'; },
      cat(k) { S.cat = k; redo(); return 'ui_click'; },
      buy(id) {
        const d = def(id); if (!d) return false;
        const lvl = D().securityLevel;
        if ((d.rank || 1) > lvl) { say(`Clearance ${d.rank} required. Current clearance ${lvl}.`, true); redo(); return false; }
        const c = categoryOf(id), qty = c === 'ammo' ? 10 : 1, price = priceOf(id) * qty;
        if (!inv.spend(price)) { say(`Insufficient funds. ${money(price)} required, ${money(D().money)} on hand.`, true); redo(); return false; }
        let what;
        if (c === 'weapon') { const w = makeWeapon(id); inv.addWeapon(w); const n = (w.chamber ? 1 : 0) + (w.mag ? w.mag.rounds : 0) + (w.tube?.length || 0); what = `${d.full || d.name} issued, ${n} rounds loaded.`; }
        else if (c === 'ammo') { inv.add(id, qty); what = `${qty} rounds of ${d.name} issued.`; }
        else if (c === 'mag') { inv.addMag(makeMag(id)); what = `${d.name} issued, empty.`; }
        else if (isInstance(d)) { inv.addGear(makeGear(id)); what = `${d.name} issued.`; }
        else { inv.add(id, 1); what = `${d.name} issued.`; }
        ctx.weapons?.onInventoryChanged?.();
        const over = inv.overweight();
        say(`${what} ${money(price)} deducted.${over > 0 ? ` Load exceeds capacity by ${over.toFixed(1)} kg.` : ''}`, over > 0);
        redo(); return 'ui_buy';
      },
      sell(key) {
        const [k, id] = key.split(':'); let name, price;
        if (k === 'w') {
          const w = inv.weaponByUid(+id); if (!w) return false;
          const d = WEAPONS[w.id]; const atts = [...Object.values(w.attachments || {}), ...(w.rails || [])];
          if (w.mag) inv.unloadMag(w.mag); if (w.chamber) { inv.add(w.chamber, 1); w.chamber = null; } if (w.tube?.length) { for (const a of w.tube) inv.add(a, 1); w.tube.length = 0; }
          price = Math.round((d.price + atts.reduce((s, a) => s + priceOf(a), 0) + (w.mag ? priceOf(w.mag.id) : 0)) * BUYBACK);
          inv.removeWeapon(w.uid); name = `${d.full || d.name}${atts.length ? ' with ' + atts.length + ' attachment' + (atts.length > 1 ? 's' : '') : ''}`;
        } else if (k === 'm') {
          const m = inv.magByUid(+id); if (!m) return false;
          inv.unloadMag(m); price = Math.round(MAGAZINES[m.id].price * BUYBACK); inv.removeMag(m.uid); name = MAGAZINES[m.id].name;
        } else if (k === 'g') {
          const g = inv.gearByUid(+id); if (!g) return false;
          const d = def(g.id); price = Math.round(d.price * BUYBACK); inv.removeGear(g.uid); name = d.name;
        } else {
          const d = def(id); const n = inv.count(id); if (!d || n <= 0) return false;
          const q = categoryOf(id) === 'ammo' ? Math.min(10, n) : 1; inv.remove(id, q); price = Math.round(d.price * q * BUYBACK); name = q > 1 ? `${q} rounds of ${d.name}` : d.name;
        }
        inv.earn(price); ctx.weapons?.onInventoryChanged?.();
        say(`${name} returned. ${money(price)} credited.`); redo(); return 'ui_buy';
      },
    };
    const { say, redo, build } = panelKit(ctx, api, S, root, fill, handlers);
    build();
    return root;
  },
  onKey(e) {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return false;
    const root = document.querySelector('#panels .p-supply'); if (!root) return false;
    const cats = [...root.querySelectorAll('.cat')].map((b) => b.dataset.x.slice(4)); if (!cats.length) return false;
    const i = cats.indexOf(S.cat); S.cat = cats[(i + (e.code === 'ArrowRight' ? 1 : cats.length - 1)) % cats.length];
    S.rerender?.(); return true;
  },
  onClose() { S.notice = ''; S.red = false; },
};
