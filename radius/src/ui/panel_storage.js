// Locker 61: two columns, carried and stowed. Every kind moves: weapons (attachments and inserted magazine travel
// with them), magazines, gear instances, and stacks (a quantity is chosen for stacks above one). Instances are the
// save data: they are spliced between ctx.inventory and state.data.storage = { weapons, mags, gear, items }, never copied.
// Panel module for ui/panels.js: { id, title, render(ctx, api, data) -> HTMLElement, onKey(e), onClose() }.
import { WEAPONS, AMMO, MAGAZINES, def, categoryOf, weightOf, defaultAmmo } from '../data/index.js';
import { weaponWeight, magWeight } from '../player/inventory.js';
import { money, esc, kg, sec, act, panelKit, ensureStyle } from './menus.js';

const CSS = `
#panels .p-storage { min-width: 880px; max-width: 1000px; }
#panels .p-storage .strip { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 18px; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-dim); margin: -2px 0 8px; }
#panels .p-storage .strip b { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }
#panels .p-storage .strip b.red { color: var(--red-ink); }
#panels .p-storage .scroll { max-height: calc(88vh - 220px); min-height: 220px; overflow-y: auto; overflow-x: hidden; padding-right: 6px; scrollbar-width: thin; scrollbar-color: var(--ink-dot) transparent; }
#panels .p-storage .scroll::-webkit-scrollbar { width: 5px; } #panels .p-storage .scroll::-webkit-scrollbar-thumb { background: var(--ink-dot); }
#panels .p-storage .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; }
#panels .p-storage .cols > div + div { border-left: 1px solid var(--ink-hair); padding-left: 26px; }
#panels .p-storage .col-t { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink); border-bottom: 1px solid var(--ink); padding-bottom: 5px; margin-bottom: 2px; }
#panels .p-storage .col-t span { color: var(--ink-dim); font-variant-numeric: tabular-nums; letter-spacing: 0.08em; }
#panels .p-storage .row.st { grid-template-columns: minmax(0, 1fr) auto auto; }
#panels .p-storage .row.st .num { min-width: 52px; }
#panels .p-storage .row.st .k .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#panels .p-storage .row.st .acts .act { margin-left: 4px; padding: 3px 7px; }
#panels .p-storage .sec { margin: 10px 0 4px; }
#panels .p-storage .keys { margin-top: 8px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-faint); }
@media (max-width: 1000px) { #panels .p-storage { min-width: 0; } #panels .p-storage .cols { grid-template-columns: 1fr; } #panels .p-storage .cols > div + div { border-left: 0; padding-left: 0; border-top: 1px solid var(--ink-hair); margin-top: 10px; padding-top: 6px; } }
`;
const S = { notice: '', red: false, rerender: null };

export default {
  id: 'storage', title: 'Locker 61',
  render(ctx, api) {
    ensureStyle('ui-b-storage', CSS);
    const root = document.createElement('div'); root.className = 'p-storage';
    const D = () => ctx.state.data, inv = ctx.inventory;
    // the locker, with the old save shape folded in (v1 kept ammo by calibre)
    const locker = () => {
      const d = D(); if (!d.storage) d.storage = { weapons: [], mags: [], gear: [], items: {} };
      const st = d.storage; st.weapons ||= []; st.mags ||= []; st.gear ||= []; st.items ||= {};
      if (st.ammo) { for (const [cal, n] of Object.entries(st.ammo)) { const id = AMMO[cal] ? cal : defaultAmmo(cal); if (id && n > 0) st.items[id] = (st.items[id] || 0) + n; } delete st.ammo; }
      return st;
    };
    const lockerWeight = (st) => st.weapons.reduce((s, w) => s + (w.parts ? weaponWeight(w) : weightOf(w.id)), 0) + st.mags.reduce((s, m) => s + magWeight(m), 0) + st.gear.reduce((s, g) => s + weightOf(g.id), 0) + Object.entries(st.items).reduce((s, [id, n]) => s + weightOf(id, n), 0);
    const loadedText = (w) => { const n = (w.chamber ? 1 : 0) + (w.mag ? w.mag.rounds : 0) + (w.tube?.length || 0); const cap = w.mag ? MAGAZINES[w.mag.id]?.cap : WEAPONS[w.id]?.internal; return cap ? `${n} / ${cap}` : `${n}`; };
    const condText = (w) => { if (!w.parts) return ''; const c = Math.round(Math.min(w.parts.barrel, w.parts.bolt, w.parts.frame)); return `condition ${c} %${w.dirt > 0.3 ? ' · fouled' : ''}${w.jammed ? ' · jammed' : ''}`; };

    function weaponRow(w, dir) {
      const d = WEAPONS[w.id] || { full: w.id, name: w.id }; const atts = [...Object.values(w.attachments || {}), ...(w.rails || [])];
      const eq = dir === 'in' ? Object.entries(inv.equipment).find(([, u]) => u === w.uid)?.[0] : null;
      const sub = [`loaded ${loadedText(w)}`, condText(w), atts.length ? atts.map((id) => def(id)?.name || id).join(', ') : ''].filter(Boolean).join(' · ');
      return `<div class="row three st"><div class="k">${esc(d.full || d.name)}${eq ? `<span class="tag">${esc(eq)}</span>` : ''}<span class="sub">${esc(sub)}</span></div><div class="num">${kg(w.parts ? weaponWeight(w) : weightOf(w.id))}</div><div class="acts">${act(`${dir}:w:${w.uid}`, dir === 'in' ? 'Stow' : 'Take')}</div></div>`;
    }
    function magRow(m, dir) {
      const d = MAGAZINES[m.id] || { name: m.id, cap: 0 };
      const sub = `${m.rounds} / ${d.cap}${m.ammo && m.rounds ? ' ' + (AMMO[m.ammo]?.name || m.ammo) : ' empty'}${dir === 'in' && inv.isReady?.(m.uid) ? ' · in the rig' : ''}`;
      return `<div class="row three st"><div class="k">${esc(d.name)}<span class="sub">${esc(sub)}</span></div><div class="num">${kg(magWeight(m), 2)}</div><div class="acts">${act(`${dir}:m:${m.uid}`, dir === 'in' ? 'Stow' : 'Take')}</div></div>`;
    }
    function gearRow(g, dir) {
      const d = def(g.id) || { name: g.id };
      const eq = dir === 'in' ? Object.entries(inv.equipment).find(([, u]) => u === g.uid)?.[0] : null;
      const cond = d.durability ? `durability ${Math.round(g.durability ?? d.durability)} / ${d.durability}` : g.charge != null ? `charge ${Math.round(g.charge)} %` : g.uses != null ? `${g.uses} uses left` : (d.desc || '');
      return `<div class="row three st"><div class="k">${esc(d.name)}${eq ? `<span class="tag">${esc(eq)}</span>` : ''}<span class="sub">${esc(cond)}</span></div><div class="num">${kg(weightOf(g.id))}</div><div class="acts">${act(`${dir}:g:${g.uid}`, dir === 'in' ? 'Stow' : 'Take')}</div></div>`;
    }
    function stackRow(id, n, dir) {
      const d = def(id) || { name: id }; const c = categoryOf(id);
      const one = dir === 'in' ? 'Stow' : 'Take';
      const acts = n > 1
        ? act(`${dir}:i:${id}:1`, `${one} 1`) + (n > 10 ? act(`${dir}:i:${id}:10`, '10') : '') + act(`${dir}:i:${id}:${n}`, `all ${n}`)
        : act(`${dir}:i:${id}:1`, one);
      const sub = c === 'ammo' ? 'loose rounds' : d.desc || '';
      return `<div class="row three st"><div class="k">${esc(d.name)}<span class="sub">${esc(sub)}</span></div><div class="num">${n}<span class="u">×</span> ${kg(weightOf(id, n), weightOf(id, n) < 0.1 ? 2 : 1)}</div><div class="acts">${acts}</div></div>`;
    }
    const orderStacks = (items) => Object.entries(items).filter(([, n]) => n > 0).sort(([a], [b]) => { const ca = categoryOf(a), cb = categoryOf(b); return ca === cb ? (def(a)?.name || a).localeCompare(def(b)?.name || b) : (ca === 'ammo' ? -1 : cb === 'ammo' ? 1 : ca.localeCompare(cb)); });
    function column(title, right, src, dir) {
      const w = src.weapons.map((x) => weaponRow(x, dir)).join(''), m = src.mags.map((x) => magRow(x, dir)).join(''), g = src.gear.map((x) => gearRow(x, dir)).join('');
      const stacks = orderStacks(src.items); const i = stacks.map(([id, n]) => stackRow(id, n, dir)).join('');
      const none = '<div class="empty">None.</div>';
      return `<div><div class="col-t">${title}<span>${right}</span></div>` + sec('Weapons', src.weapons.length, w || none) + sec('Magazines', src.mags.length, m || none) + sec('Gear', src.gear.length, g || none) + sec('Items', stacks.length, i || none) + '</div>';
    }
    function fill() {
      const st = locker(), over = inv.overweight(), lw = lockerWeight(st);
      return `<div class="strip"><span>Carried <b class="${over > 0 ? 'red' : ''}">${inv.weight().toFixed(1)} / ${inv.capacity()} kg</b>${over > 0 ? ` <b class="red">· over by ${over.toFixed(1)} kg</b>` : ''}</span><span>Locker <b>${lw.toFixed(1)} kg</b> · no limit</span><span>Funds <b>${money(D().money)}</b></span></div>` +
        `<div class="scroll"><div class="cols">${column('Carried', `${inv.weight().toFixed(1)} kg`, inv.data, 'in')}${column('Locker', `${lw.toFixed(1)} kg`, st, 'out')}</div></div>` +
        '<div class="note">Locker contents are not subject to the Tide and are not carried into the Radius. Everything on the Explorer\'s person is forfeit on incident. Worn armour and rig magazines can be stowed; the slot empties.</div>' +
        '<div class="keys">↑↓ select · Enter confirm · 1–9 pick</div>';
    }
    // ---- moves: the instance itself changes lists ----
    function move(dir, kind, id, qty) {
      const st = locker();
      if (kind === 'w') {
        if (dir === 'in') { const w = inv.removeWeapon(+id); if (!w) return false; st.weapons.push(w); say(`${WEAPONS[w.id]?.full || w.id} stowed.`); }
        else { const i = st.weapons.findIndex((w) => w.uid === +id); if (i < 0) return false; const [w] = st.weapons.splice(i, 1); inv.addWeapon(w); say(`${WEAPONS[w.id]?.full || w.id} taken.`); }
        ctx.weapons?.onInventoryChanged?.();
      } else if (kind === 'm') {
        if (dir === 'in') { const m = inv.removeMag(+id); if (!m) return false; st.mags.push(m); say(`${MAGAZINES[m.id]?.name || m.id} stowed.`); }
        else { const i = st.mags.findIndex((m) => m.uid === +id); if (i < 0) return false; const [m] = st.mags.splice(i, 1); inv.addMag(m); say(`${MAGAZINES[m.id]?.name || m.id} taken.`); }
        ctx.weapons?.onInventoryChanged?.();
      } else if (kind === 'g') {
        if (dir === 'in') { const g = inv.removeGear(+id); if (!g) return false; st.gear.push(g); say(`${def(g.id)?.name || g.id} stowed.`); }
        else { const i = st.gear.findIndex((g) => g.uid === +id); if (i < 0) return false; const [g] = st.gear.splice(i, 1); inv.addGear(g); say(`${def(g.id)?.name || g.id} taken.`); }
        ctx.gear?.onInventoryChanged?.(); ctx.weapons?.onInventoryChanged?.();
      } else {
        const name = def(id)?.name || id;
        if (dir === 'in') { const n = Math.min(qty, inv.count(id)); if (n <= 0 || !inv.remove(id, n)) return false; st.items[id] = (st.items[id] || 0) + n; say(`${n > 1 ? n + ' × ' : ''}${name} stowed.`); }
        else { const n = Math.min(qty, st.items[id] || 0); if (n <= 0) return false; st.items[id] -= n; if (st.items[id] <= 0) delete st.items[id]; inv.add(id, n); say(`${n > 1 ? n + ' × ' : ''}${name} taken.`); }
        if (categoryOf(id) === 'ammo') ctx.weapons?.onInventoryChanged?.();
      }
      const over = inv.overweight(); if (dir === 'out' && over > 0) say(`${S.notice} Load exceeds capacity by ${over.toFixed(1)} kg.`, true);
      redo(); return 'ui_click';
    }
    const handlers = {
      in(a) { const [k, id, q] = a.split(':'); return move('in', k, id, +q || 1); },
      out(a) { const [k, id, q] = a.split(':'); return move('out', k, id, +q || 1); },
    };
    const { say, redo, build } = panelKit(ctx, api, S, root, fill, handlers);
    build();
    return root;
  },
  onKey() { return false; },
  onClose() { S.notice = ''; S.red = false; },
};
