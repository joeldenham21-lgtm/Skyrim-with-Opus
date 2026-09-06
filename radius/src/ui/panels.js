// The desk. A router for the Committee forms plus the three forms that handle the kit itself: the kit manifest
// (inventory), the workbench and the search of a pile (loot). Supply, terminal, storage, map and bed are modules of
// their own (panel_*.js) with the same shape: { id, title, keys?, render(ctx, api, data) -> HTMLElement, onKey?(e), onClose?() }.
// Every form is one sheet of stock: a header line (form · explorer · funds · load · time), a scrolling body, a
// notice line and a key legend. The world freezes while a sheet is on the desk (main passes dt 0); panels.update
// receives real time so timed jobs (a clean at the bench) still run.
import { def, categoryOf, WEAPONS, AMMO, MAGAZINES, ATTACHMENTS, ITEMS, CALIBERS, ammoOf, weightOf, priceOf } from '../data/index.js';
import { makeWeapon, makeMag, makeGear, attach, detach, weaponEffects, weaponWeight, magWeight, effMounts, SLOTS } from '../player/inventory.js';
import supplyPanel from './panel_supply.js';
import terminalPanel from './panel_terminal.js';
import storagePanel from './panel_storage.js';
import mapPanel from './panel_map.js';
import bedPanel from './panel_bed.js';

// ---------------------------------------------------------------------------------------------------------------
// shared helpers (menus.js and the panel modules import these)
// ---------------------------------------------------------------------------------------------------------------
const THIN = ' ';
export const money = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN) + ' ₽';
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clockOf = (hour) => { const h = Math.floor(hour), m = Math.floor((hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
export function spanText(seconds) {
  const s = Math.max(0, seconds); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
export const kg = (n, digits = 1) => `${(+n || 0).toFixed(digits)} kg`;
export const pct = (v) => `${Math.round(v)} %`;
export const visible = (e) => e.offsetParent !== null || e === document.activeElement;
export function focusables(root) { return [...root.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]')].filter(visible); }
// Arrow keys and Tab walk the focusables; ←→ on a tab switch tabs; digits pick the nth tab (or the nth action when
// the sheet has no tabs, as the title and pause forms expect); Enter activates a focused row.
export function navigate(e, root, actionSel = 'button.btn:not([disabled]), button.act:not([disabled])') {
  const code = e.code, cur = document.activeElement;
  if (/^Digit[1-9]$/.test(code)) {
    const group = root.querySelector('.tabs.keyed') || root.querySelector('.tabs');
    if (group) { const tabs = [...group.querySelectorAll('.tab')].filter(visible); const b = tabs[+code[5] - 1]; if (b) { if (!b.classList.contains('on')) b.click(); return true; } return false; }
    const btns = [...root.querySelectorAll(actionSel)].filter(visible); const b = btns[+code[5] - 1]; if (b) { b.focus(); b.click(); return true; }
    return false;
  }
  const list = focusables(root); if (!list.length) return false;
  const i = list.indexOf(cur);
  if ((code === 'ArrowLeft' || code === 'ArrowRight') && cur && cur.classList.contains('tab')) {
    const tabs = [...cur.parentElement.querySelectorAll('.tab')].filter(visible); const k = tabs.indexOf(cur);
    const nx = tabs[(k + (code === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; if (nx && nx !== cur) { nx.focus(); nx.click(); } return true;
  }
  if (code === 'ArrowDown' || code === 'ArrowRight' || (code === 'Tab' && !e.shiftKey)) { list[(i + 1) % list.length].focus(); return true; }
  if (code === 'ArrowUp' || code === 'ArrowLeft' || (code === 'Tab' && e.shiftKey)) { list[(i - 1 + list.length) % list.length].focus(); return true; }
  if ((code === 'Enter' || code === 'NumpadEnter' || code === 'Space') && cur && root.contains(cur) && cur.tagName !== 'BUTTON') { cur.click(); return true; }
  return false;
}
// [data-a="name:arg"] buttons -> handlers[name](arg, button). Return: false = deny sound, a string = that sound, null = silent.
export function bindActions(root, handlers, snd = () => {}) {
  for (const b of root.querySelectorAll('[data-a]')) {
    b.onclick = (ev) => {
      ev?.stopPropagation?.();
      if (b.disabled) return;
      const [name, ...rest] = b.dataset.a.split(':');
      const fn = handlers[name]; if (!fn) return;
      const r = fn(rest.join(':'), b);
      if (r === false) snd('ui_deny', 0.5); else if (r !== null && r !== undefined) snd(typeof r === 'string' ? r : 'ui_click', 0.45);
    };
  }
}
// remember which focusable had focus so a rebuild after a click lands in the same place
export function keepFocus(root, rebuild) {
  const list = focusables(root), i = list.indexOf(document.activeElement);
  rebuild();
  const after = focusables(root); if (!after.length) return;
  (after[Math.min(i < 0 ? 0 : i, after.length - 1)]).focus({ preventScroll: true });
}
export function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.childElementCount === 1 ? t.content.firstElementChild : (() => { const d = document.createElement('div'); d.append(t.content); return d; })(); }
// small html pieces used by every form
export const sec = (t, n, inner, cls = '') => `<div class="sec ${cls}"><div class="sec-t">${t}${n != null && n !== '' ? `<span class="n">${n}</span>` : ''}</div>${inner}</div>`;
export const row = (k, num, cls = '') => `<div class="row ${cls}"><div class="k">${k}</div><div class="num">${num}</div></div>`;
export const row3 = (k, num, acts, cls = '') => `<div class="row three ${cls}"><div class="k">${k}</div><div class="num">${num}</div><div class="acts">${acts}</div></div>`;
export const act = (a, label, opts = {}) => `<button class="act ${opts.deny ? 'deny' : ''} ${opts.on ? 'on' : ''}" data-a="${a}" ${opts.disabled ? 'disabled' : ''} ${opts.title ? `title="${esc(opts.title)}"` : ''}>${label}</button>`;
export const tabsHtml = (list, cur, prefix = 'tab', opts = {}) => `<div class="tabs ${opts.keyed === false ? '' : 'keyed'} ${opts.cls || ''}">${list.map((t) => { const [id, label, n] = Array.isArray(t) ? t : [t, t, null]; return `<button class="tab ${id === cur ? 'on' : ''}" data-a="${prefix}:${id}">${label}${n ? `<span class="n">${n}</span>` : ''}</button>`; }).join('')}</div>`;
export const mini = (v01, cls = '') => `<span class="mini ${cls}"><i style="width:${(Math.max(0, Math.min(1, v01)) * 100).toFixed(0)}%"></i></span>`;
export const condClass = (p) => (p < 30 ? 'red' : p < 60 ? 'amb' : '');
export const calShort = (cal) => CALIBERS[cal]?.short || cal;
const KIND_SHORT = { fmj: 'FMJ', hp: 'HP', ap: 'AP', sub: 'SUB', tracer: 'TR', buck: 'BUCK', slug: 'SLUG', flechette: 'FLECH' };
export const ammoTag = (id) => { const a = AMMO[id]; return a ? (a.blunt ? 'RUBBER' : KIND_SHORT[a.kind] || a.kind.toUpperCase()) : ''; };
export const ammoLabel = (id) => { const a = AMMO[id]; return a ? `${calShort(a.cal)} ${ammoTag(id)}` : id; };
// probability a round of penetration class `pen` defeats armour class `cls` at durability fraction dur (data/index.js)
export function penChance(pen, cls, dur = 1) { const eff = cls * (0.55 + 0.45 * dur); const x = (pen - eff + 1) / 2; return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
export const condOf = (w) => { const p = w.parts || {}; return Math.min(p.barrel ?? 100, p.bolt ?? 100, p.frame ?? 100); };
export function magText(w) {
  const d = WEAPONS[w.id]; if (!d) return '';
  let s;
  if (d.internal) { const n = w.tube?.length || 0; s = `${n} / ${d.internal}${n ? ' ' + ammoTag(w.tube[n - 1]) : ''}`; }
  else if (w.mag) s = `${w.mag.rounds} / ${MAGAZINES[w.mag.id]?.cap ?? '?'}${w.mag.ammo ? ' ' + ammoTag(w.mag.ammo) : ''}`;
  else s = 'no magazine';
  return s + (w.chamber ? ' +1' : '');
}
export function effectsText(e) {
  if (!e) return '';
  const out = [];
  if (e.zoom && e.zoom !== 1) out.push(`${e.zoomLow ? `${e.zoomLow}–` : ''}${e.zoom}× zoom`);
  else if (e.reticle) out.push(`${e.reticle} sight`);
  const pc = (k, label) => { if (e[k] != null && e[k] !== 1) out.push(`${label} ${e[k] > 1 ? '+' : '−'}${Math.round(Math.abs(e[k] - 1) * 100)} %`); };
  pc('recoil', 'recoil'); pc('moa', 'dispersion'); pc('noise', 'noise'); pc('flash', 'flash'); pc('adsSpeed', 'ADS'); pc('wear', 'wear');
  if (e.ergo) out.push(`ergonomics ${e.ergo > 0 ? '+' : '−'}${Math.round(Math.abs(e.ergo) * 100)}`);
  if (e.light) out.push('weapon light'); if (e.laser) out.push('laser'); if (e.nvOptic) out.push('night optic'); if (e.prone) out.push('rest when crouched');
  return out.join(' · ');
}
const GEAR_SLOT = { vest: 'vest', helmet: 'helmet', backpack: 'backpack', rig: 'rig', headgear: 'headgear', mask: 'mask', melee: 'melee' };
const PART_ITEM = { barrel: 'part_barrel', bolt: 'part_bolt', frame: 'part_spring' };
const USE_SOUND = { bandage: 'bandage_use', hemostat: 'bandage_use', medkit: 'medkit_use', medkit_ai2: 'medkit_use', stim: 'stim_use', adrenaline: 'stim_use', morphine: 'stim_use', energy: 'stim_use' };
const KEYS = 'Esc close · Tab ↑↓ move · Enter select · ←→ 1–9 tabs';
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------------------------------------------
export function createPanels(ctx) {
  const ui = document.getElementById('ui');
  const root = document.createElement('div'); root.id = 'panels'; ui.appendChild(root);
  const scrim = document.createElement('div'); scrim.className = 'scrim'; root.appendChild(scrim);
  const sheet = document.createElement('div'); sheet.className = 'sheet center pnl'; root.appendChild(sheet);
  const hd = document.createElement('div'); hd.className = 'hd'; sheet.appendChild(hd);
  const body = document.createElement('div'); body.className = 'body'; sheet.appendChild(body);
  const noticeEl = document.createElement('div'); noticeEl.className = 'notice'; sheet.appendChild(noticeEl);
  const ft = document.createElement('div'); ft.className = 'ft'; sheet.appendChild(ft);
  const PANELS = {};
  let current = null, isOpen = false, data = null, notice = '', noticeRed = false, locked = false, job = null;
  const snd = (n, g = 0.5) => { try { ctx.audio.play(n, { gain: g }); } catch {} };
  const D = () => ctx.state.data;
  const weaponsChanged = () => { try { ctx.weapons?.refresh?.(); ctx.weapons?.rebuild?.(); ctx.weapons?.onInventoryChanged?.(); } catch (e) { console.warn('[panels] weapons hook', e); } };

  root.addEventListener('mousedown', () => ctx.audio.resume());
  window.addEventListener('keydown', (e) => {
    if (!isOpen || locked) return;
    if (e.code === 'Escape') return;   // main closes the sheet
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const P = PANELS[current];
    if (P?.onKey && P.onKey(e) === true) return;
    navigate(e, sheet);
  });

  function chrome(P) {
    const d = D(), inv = ctx.inventory;
    const w = inv.weight ? inv.weight() : 0, c = inv.capacity ? inv.capacity() : 0;
    const title = typeof P.title === 'function' ? P.title(ctx, api, data) : (P.title || P.id);
    hd.innerHTML = `<span class="t">${esc(title)}</span><span>Explorer ${d.explorer}</span><span>${money(d.money)}</span><span class="${w > c ? 'red' : ''}">Load ${kg(w)} / ${c} kg</span><span class="r">Day ${d.day} · ${ctx.time.clockText()} · Tide in ${ctx.time.tideInText()}</span>`;
    noticeEl.className = `notice ${noticeRed ? 'red' : ''}`; noticeEl.textContent = notice;
    ft.innerHTML = `<span>${esc(P.keys || KEYS)}</span><span class="r">Clearance ${d.securityLevel} · Form ${esc(P.form || P.id)}</span>`;
  }
  function render() {
    const P = PANELS[current]; if (!P) return;
    const st = body.scrollTop;
    let node;
    try { node = P.render(ctx, api, data); } catch (e) { console.warn(`[panels] ${current} failed to render`, e); node = el(`<div class="empty">Form ${esc(current)} unavailable. Reference the duty officer.</div>`); }
    body.replaceChildren(node instanceof Node ? node : el(String(node)));
    body.scrollTop = st;
    chrome(P);
  }

  const api = {
    get isOpen() { return isOpen; }, get current() { return current; }, get data() { return data; },
    root, sheet, body,
    register(mod) { if (mod && mod.id) PANELS[mod.id] = mod; },
    open(name, d = {}) {
      const P = PANELS[name]; if (!P) { console.warn('[panels] no such form', name); return; }
      if (locked) return;
      if (isOpen && current && current !== name) PANELS[current]?.onClose?.();
      if (!isOpen) { ctx.input.enabled = false; ctx.input.releaseAll?.(); ctx.input.unlock(); ctx.hud.setGameVisible(false); ctx.audio.resume(); snd('ui_open', 0.5); }
      isOpen = true; current = name; data = d || {}; notice = ''; noticeRed = false; job = null;
      root.classList.add('on'); sheet.style.display = ''; sheet.className = `sheet center pnl ${name}-card`;
      render();
      const first = focusables(sheet).find((e) => !e.classList.contains('tab')) || focusables(sheet)[0]; first?.focus({ preventScroll: true });
    },
    close() {
      if (!isOpen || locked) return;
      PANELS[current]?.onClose?.();
      isOpen = false; current = null; data = null; job = null;
      root.classList.remove('on'); sheet.style.display = 'none'; body.replaceChildren();
      snd('ui_close', 0.45);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (ctx.mode === 'playing') { ctx.input.enabled = true; ctx.input.lock(); ctx.hud.setGameVisible(true); }
    },
    refresh() { if (isOpen) keepFocus(sheet, render); },
    notice(text, red = false) { notice = text || ''; noticeRed = !!red; noticeEl.className = `notice ${noticeRed ? 'red' : ''}`; noticeEl.textContent = notice; },
    sound(name, gain = 0.5) { snd(name, gain); },
    lock(v) { locked = !!v; },
    // a timed job with a bar (the bench clean): label, seconds, done(). One at a time.
    job(label, seconds, done) { if (job) return false; job = { label, t: 0, dur: seconds, done }; api.refresh(); return true; },
    get jobState() { return job ? { label: job.label, t: job.t, dur: job.dur, k: Math.min(1, job.t / job.dur) } : null; },
    update(dt) {
      if (!isOpen || !job) return;
      job.t += dt;
      const bar = body.querySelector('.bar.job i'); if (bar) bar.style.width = `${(Math.min(1, job.t / job.dur) * 100).toFixed(1)}%`;
      if (job.t >= job.dur) { const j = job; job = null; try { j.done(); } catch (e) { console.warn('[panels] job', e); } api.refresh(); }
    },
    weaponsChanged,
    // test hook: a rich kit built through the inventory helpers (see tools/scenarios/ui-a-*.mjs)
    testKit() {
      const inv = ctx.inventory;
      const akm = makeWeapon('akm', { ammo: '762_fmj', condition: 72 }); akm.parts.bolt = 46; akm.dirt = 0.38; if (akm.mag) akm.mag.rounds = 17;
      inv.addWeapon(akm);
      const mosin = makeWeapon('mosin', { ammo: '754_fmj' }); mosin.parts.barrel = 55; inv.addWeapon(mosin);
      inv.addMag(makeMag('mag_ak762_30', '762_fmj', 30)); inv.addMag(makeMag('mag_ak762_30', '762_ap', 12)); inv.addMag(makeMag('mag_ak762_30')); inv.addMag(makeMag('mag_ak762_40', '762_fmj', 40)); inv.addMag(makeMag('mag_mosin5', '754_fmj', 5));
      const rig = inv.addGear(makeGear('rig_6sh112')), pack = inv.addGear(makeGear('pack_pilgrim'));
      inv.addGear(makeGear('vest_6b2', { durability: 48 })); inv.addGear(makeGear('helm_ssh68', { durability: 30 })); inv.addGear(makeGear('vest_kirasa', { durability: 70 }));
      inv.addGear(makeGear('head_lamp', { charge: 64 })); inv.addGear(makeGear('mask_resp', { charge: 80 }));
      inv.equipGear(rig.uid, 'rig'); inv.equipGear(pack.uid, 'backpack');
      const items = { '762_fmj': 60, '762_ap': 30, '762_hp': 10, '754_fmj': 15, '9x18_ap': 8, bandage: 3, medkit: 1, morphine: 1, water: 1, tushonka: 1, cigarettes: 2, probe: 6, battery: 3, filter: 2, cleankit: 1, repairkit: 1, armorkit: 1, part_bolt: 1, part_barrel: 1, gr_rgd5: 2, gr_smoke: 1, art_pearl: 2, art_tear: 1, recorder: 1, rail_akcover: 1, rail_akhg: 1, opt_kobra: 1, opt_eotech: 1, muz_pbs1: 1, grip_rk1: 1, light_klesch: 1, lockpick: 1, binoculars: 1 };
      for (const [id, n] of Object.entries(items)) inv.add(id, n);
      D().money = 4120; D().earned = 6800; D().hp = 71;
      weaponsChanged();
      return akm;
    },
  };
  sheet.style.display = 'none';
  api.register(inventoryPanel(ctx, api));
  api.register(workbenchPanel(ctx, api));
  api.register(lootPanel(ctx, api));
  for (const m of [supplyPanel, terminalPanel, storagePanel, mapPanel, bedPanel]) if (m && m.id && !PANELS[m.id]) api.register(m);
  ctx.events.on('gameStart', () => { if (isOpen && !locked) api.close(); });
  ctx.events.on('playerDied', () => { if (isOpen && !locked) api.close(); });
  return api;
}

// ---------------------------------------------------------------------------------------------------------------
// kit helpers shared by the three forms
// ---------------------------------------------------------------------------------------------------------------
function catOf(e) {
  if (e.kind === 'weapon' || e.kind === 'mag') return e.kind;
  const c = categoryOf(e.id);
  if (c === 'armor' || c === 'helmet' || c === 'pack' || c === 'rig' || c === 'headgear' || c === 'mask') return 'kit';
  if (c === 'med' || c === 'food') return 'med';
  if (c === 'grenade' || c === 'tool' || c === 'melee' || c === 'key') return 'tools';
  if (c === 'part' || c === 'battery' || c === 'filter') return 'parts';
  return c;
}
const isGearEntry = (e) => e.uid != null && e.kind !== 'weapon' && e.kind !== 'mag';
const GEAR_KINDS = new Set(['vest', 'helmet', 'backpack', 'rig', 'headgear', 'mask', 'melee']);
// inventory.list() with ammunition stacks reported as kind 'ammo' (the catalogue's kind on a round is its bullet type)
const kitList = (inv) => inv.list().map((e) => (AMMO[e.id] && e.uid == null ? Object.assign({}, e, { kind: 'ammo' }) : e));
function entryWeight(e) {
  if (e.kind === 'weapon') return e.inst ? weaponWeight(e.inst) : weightOf(e.id);
  if (e.kind === 'mag') return e.inst ? magWeight(e.inst) : weightOf(e.id);
  return weightOf(e.id, e.count || 1);
}
function slotOfUid(inv, uid) { const e = inv.equipment; for (const s of Object.keys(e)) if (e[s] === uid) return s; return null; }
// kits with several uses: the open kit's remaining uses live in flags.kitUses so a save keeps them
function kitUsesLeft(ctx, id) { const d = def(id); return ctx.state.data.flags.kitUses?.[id] ?? d?.uses ?? 1; }
function useKit(ctx, id) {
  const inv = ctx.inventory; if (!inv.has(id)) return false;
  const f = ctx.state.data.flags; f.kitUses = f.kitUses || {};
  let left = (f.kitUses[id] ?? def(id)?.uses ?? 1) - 1;
  if (left <= 0) { inv.remove(id, 1); delete f.kitUses[id]; } else f.kitUses[id] = left;
  return true;
}
function attFitsWeapon(a, w) {
  const d = WEAPONS[w.id]; if (!a || !d) return false;
  if (a.slot === 'rail') return a.fits.some((f) => Object.values(d.mounts).includes(f));
  const std = effMounts(d, w.rails)[a.slot]; return !!std && a.fits.includes(std);
}
function weaponSub(w) {
  const d = WEAPONS[w.id]; const atts = [...(w.rails || []), ...Object.values(w.attachments || {})].map((id) => def(id)?.name).filter(Boolean);
  return `${calShort(d.cal)} · ${magText(w)} · ${Math.round(condOf(w))} %${w.jammed ? ' · stoppage' : ''}${atts.length ? ' · ' + atts.join(', ') : ''}`;
}
const magSub = (m) => `${calShort(m.cal)} · ${m.rounds} / ${MAGAZINES[m.id]?.cap ?? '?'}${m.ammo ? ' ' + ammoTag(m.ammo) : ''}`;
function gearSub(g) {
  const d = def(g.id); if (!d) return '';
  const p = [];
  if (d.cls) p.push(`class ${d.cls}`);
  if (d.durability) p.push(`${Math.round(g.durability ?? d.durability)} / ${d.durability}`);
  if (d.capacity != null) p.push(`+${d.capacity} kg`);
  if (d.readyMags) p.push(`${d.readyMags} pouches`);
  if (g.charge != null) p.push(`${d.filter ? 'filter' : 'cell'} ${Math.round(g.charge)} %`);
  if (d.nvg) p.push(`gen ${d.nvg}`);
  if (d.gas) p.push(`gas ${Math.round(d.gas * 100)} %`);
  if (d.damage) p.push(`damage ${d.damage}`);
  return p.join(' · ');
}
function dropEntry(ctx, api, e) {
  const inv = ctx.inventory;
  if (!ctx.loot?.dropItem) { api.notice('Nothing to set it down on here.', true); return false; }
  const d = def(e.id); const name = d?.name || e.id;
  let out;
  if (e.kind === 'weapon') { const w = inv.removeWeapon(e.uid); if (!w) return false; out = { kind: 'weapon', inst: w, id: w.id, count: 1 }; }
  else if (e.kind === 'mag') { const m = inv.removeMag(e.uid); if (!m) return false; out = { kind: 'mag', inst: m, id: m.id, count: 1 }; }
  else if (isGearEntry(e)) { const g = inv.removeGear(e.uid); if (!g) return false; out = { kind: 'gear', inst: g, id: g.id, count: 1 }; }
  else { const n = AMMO[e.id] ? inv.count(e.id) : 1; if (!inv.remove(e.id, n)) return false; out = { kind: 'item', id: e.id, count: n }; }
  try { ctx.loot.dropItem(out, ctx.player.position); } catch (err) { console.warn('[panels] dropItem', err); }
  if (e.kind === 'weapon' || isGearEntry(e)) api.weaponsChanged();
  api.notice(`${name}${out.count > 1 ? ` ×${out.count}` : ''} set down.`);
  return 'pickup_item';
}

// ---------------------------------------------------------------------------------------------------------------
// kit manifest (inventory, I)
// ---------------------------------------------------------------------------------------------------------------
const DOLL = [['helmet', 'Helmet'], ['headgear', 'Headgear'], ['mask', 'Mask'], ['vest', 'Vest'], ['rig', 'Rig'], ['backpack', 'Pack'], ['primary', 'Primary'], ['secondary', 'Secondary'], ['sidearm', 'Sidearm'], ['melee', 'Melee']];
const DOLL_LABEL = Object.fromEntries(DOLL);
function inventoryPanel(ctx, api) {
  let sel = null, slotSel = null;
  const inv = () => ctx.inventory;
  const isSel = (e) => sel && sel.kind === e.kind && sel.id === e.id && (sel.uid || null) === (e.uid || null);
  const selKey = (e) => `${e.kind}:${e.id}:${e.uid || ''}`;

  function slotItems(s) {
    const i = inv();
    if (s === 'primary' || s === 'secondary' || s === 'sidearm') return i.weapons.filter((w) => (s === 'sidearm' ? WEAPONS[w.id].cls === 'pistol' : true)).map((w) => ({ kind: 'weapon', inst: w }));
    return i.gear.filter((g) => def(g.id)?.kind === s).map((g) => ({ kind: 'gear', inst: g }));
  }
  function slotHtml(s, label) {
    const i = inv(); const uid = i.equipment[s]; const inst = uid ? (i.weaponByUid(uid) || i.gearByUid(uid)) : null; const d = inst && def(inst.id);
    let bars = '', sub = '';
    if (inst && d) {
      if (d.kind === 'weapon') { const c = condOf(inst); bars = mini(c / 100, condClass(c)); sub = magText(inst); }
      else if (d.durability) { const p = ((inst.durability ?? d.durability) / d.durability) * 100; bars = mini(p / 100, condClass(p)); sub = `class ${d.cls} · ${Math.round(inst.durability ?? d.durability)} / ${d.durability}`; }
      else if (inst.charge != null) { bars = mini(inst.charge / 100, condClass(inst.charge)); sub = `${d.filter ? 'filter' : 'cell'} ${Math.round(inst.charge)} %`; }
      else sub = gearSub(inst);
    }
    const w = inst ? (d?.kind === 'weapon' ? weaponWeight(inst) : weightOf(inst.id)) : 0;
    return `<button class="slot ${inst ? '' : 'empty'} ${slotSel === s ? 'sel' : ''}" data-a="slot:${s}"><span class="sl">${label}</span><span class="sn">${inst ? esc(d?.name || inst.id) : 'empty'}</span>${sub ? `<span class="ss">${esc(sub)}</span>` : ''}${bars}${inst ? `<span class="sw">${kg(w)}</span>` : ''}</button>`;
  }
  const li = (e, name, sub, num, acts) => `<div class="li ${isSel(e) ? 'sel' : ''}" data-sel="${selKey(e)}" tabindex="0"><div class="n">${name}${sub ? `<span class="sub">${sub}</span>` : ''}</div><div class="num">${num}</div><div class="acts">${acts}</div></div>`;
  const dropBtn = (e) => (catOf(e) === 'mission' ? '' : act(`drop:${selKey(e)}`, AMMO[e.id] ? 'Drop all' : 'Drop'));

  function lists() {
    const i = inv(), list = kitList(i);
    const by = {}; for (const e of list) (by[catOf(e)] = by[catOf(e)] || []).push(e);
    let html = '';
    // weapons
    const ws = by.weapon || [];
    html += sec('Weapons', ws.length, ws.length ? ws.map((e) => {
      const w = e.inst, wd = WEAPONS[w.id], s = slotOfUid(i, w.uid);
      return li(e, `${esc(wd.full)}${s ? `<span class="tag">${DOLL_LABEL[s] || s}</span>` : '<span class="tag dim">in pack</span>'}`, esc(weaponSub(w)), kg(weaponWeight(w)), (s ? act(`unequip:${s}`, 'Unequip') : act(`equipw:${w.uid}`, 'Equip')) + dropBtn(e));
    }).join('') : '<div class="empty">No weapons carried.</div>');
    // magazines
    const ms = by.mag || []; const rigDef = i.equippedDef('rig'); const pouches = rigDef?.readyMags || 0; const ready = i.data.readyMags.length;
    html += sec('Magazines', ms.length ? `${ms.length} · ready ${ready} / ${pouches}` : 0, ms.length ? ms.map((e) => {
      const m = e.inst, r = i.isReady(m.uid);
      return li(e, `${esc(MAGAZINES[m.id]?.name || m.id)}${r ? '<span class="tag">ready</span>' : ''}`, esc(magSub(m)), kg(magWeight(m), 2), act(`ready:${m.uid}`, r ? 'Ready' : 'Stow', { on: r }) + dropBtn(e));
    }).join('') : '<div class="empty">No magazines carried.</div>');
    // ammunition by calibre
    const ammo = by.ammo || [];
    const cals = [...new Set([...ammo.map((e) => AMMO[e.id].cal), ...(by.weapon || []).map((e) => WEAPONS[e.id].cal)])];
    html += sec('Ammunition', cals.length ? `${ammo.reduce((s, e) => s + e.count, 0)} rounds` : 0, cals.length ? cals.map((cal) => {
      const types = ammo.filter((e) => AMMO[e.id].cal === cal); const pref = i.preferredAmmo(cal);
      return `<div class="calh">${esc(CALIBERS[cal]?.name || cal)}</div>` + (types.length ? types.map((e) => { const a = AMMO[e.id]; const on = pref === e.id;
        return li(e, `${esc(a.name)}${on ? '<span class="tag">preferred</span>' : ''}`, `damage ${a.damage}${a.pellets > 1 ? ` ×${a.pellets}` : ''} · pen ${a.pen}${a.noise !== 1 ? ` · noise ${Math.round(a.noise * 100)} %` : ''}`, `${e.count}<span class="u">rounds</span>`, act(`pref:${cal}:${e.id}`, 'Prefer', { on }) + dropBtn(e)); }).join('') : '<div class="empty">None carried.</div>');
    }).join('') : '<div class="empty">No ammunition carried.</div>');
    // medical and rations
    const med = by.med || [];
    html += sec('Medical and rations', med.length, med.length ? med.map((e) => { const it = ITEMS[e.id]; const q = i.quick.indexOf(e.id);
      return li(e, `${esc(it.name)}${q >= 0 ? `<span class="tag">key ${q + 6}</span>` : ''}`, esc(it.desc || ''), `${e.count}<span class="u">×</span>`, act(`use:${e.id}`, 'Use') + dropBtn(e)); }).join('') : '<div class="empty">No medical stores.</div>');
    // grenades and tools
    const tools = by.tools || [];
    html += sec('Grenades and tools', tools.length, tools.length ? tools.map((e) => { const it = def(e.id); const q = i.quick.indexOf(e.id); const s = e.uid ? slotOfUid(i, e.uid) : null;
      let sub = it.desc || '';
      if (it.uses && !e.uid) sub = `${sub} ${kitUsesLeft(ctx, e.id)} of ${it.uses} uses on the open kit.`;
      if (e.id === 'torch') sub = `Battery ${Math.round(ctx.state.data.flashlight.battery)} %.`;
      if (it.kind === 'grenade') sub = `${it.desc || ''} Fuse ${it.fuse} s · radius ${it.radius} m${it.damage ? ` · ${it.damage} damage` : ''}`.trim();
      let acts = '';
      if (it.kind === 'melee' && e.uid) acts = s ? act('unequip:melee', 'Unequip') : act(`equipg:${e.uid}`, 'Equip');
      return li(e, `${esc(it.name)}${q >= 0 ? `<span class="tag">key ${q + 6}</span>` : ''}${s ? `<span class="tag">${DOLL_LABEL[s]}</span>` : ''}`, esc(sub), e.uid ? kg(weightOf(e.id)) : `${e.count}<span class="u">×</span>`, acts + dropBtn(e)); }).join('') : '<div class="empty">None.</div>');
    // armour and kit
    const kit = by.kit || [];
    html += sec('Armour and kit', kit.length, kit.length ? kit.map((e) => { const g = e.inst, gd = def(g.id); const s = slotOfUid(i, g.uid);
      return li(e, `${esc(gd.name)}${s ? `<span class="tag">worn</span>` : ''}`, esc(gearSub(g)), kg(weightOf(g.id)), (s ? act(`unequip:${s}`, 'Unequip') : act(`equipg:${g.uid}`, 'Equip')) + dropBtn(e)); }).join('') : '<div class="empty">None carried.</div>');
    // attachments
    const atts = by.attachment || [];
    html += sec('Attachments', atts.length, atts.length ? atts.map((e) => { const a = ATTACHMENTS[e.id]; const fits = i.weapons.filter((w) => attFitsWeapon(a, w)).map((w) => WEAPONS[w.id].name);
      return li(e, esc(a.name), `${a.slot === 'rail' ? 'rail' : a.slot} · ${fits.length ? `fits ${fits.join(', ')}` : 'fits nothing carried'}${a.effects && Object.keys(a.effects).length ? ' · ' + effectsText(a.effects) : ''}`, `${e.count}<span class="u">×</span>`, dropBtn(e)); }).join('') : '<div class="empty">None. Fitted at the workbench.</div>');
    // parts, cells and filters
    const parts = by.parts || [];
    html += sec('Parts, cells and filters', parts.length, parts.length ? parts.map((e) => { const it = ITEMS[e.id]; let acts = '';
      if (it.kind === 'battery') acts = act(`install:${e.id}`, 'Install');
      if (it.kind === 'filter') acts = act(`install:${e.id}`, 'Fit', { disabled: !i.equipped('mask') });
      return li(e, esc(it.name), esc(it.desc || (it.part ? `Replaces the ${it.part} at the workbench.` : '')), `${e.count}<span class="u">×</span>`, acts + dropBtn(e)); }).join('') : '<div class="empty">None.</div>');
    // artifacts
    const arts = by.artifact || [];
    html += sec('Artifacts', arts.length, arts.length ? arts.map((e) => { const it = ITEMS[e.id]; return li(e, esc(it.name), esc(it.desc || ''), `${e.count > 1 ? `${e.count} × ` : ''}${money(it.price)}`, dropBtn(e)); }).join('') : '<div class="empty">None recovered.</div>');
    // committee property
    const mis = by.mission || [];
    if (mis.length) html += sec('Committee property', mis.length, mis.map((e) => { const it = ITEMS[e.id]; return li(e, esc(it.name), esc(it.desc || ''), `${e.count}<span class="u">×</span>`, ''); }).join(''));
    return html;
  }

  function findSel() {
    if (!sel) return null; const i = inv();
    if (sel.kind === 'weapon') { const w = i.weaponByUid(sel.uid); return w ? { kind: 'weapon', id: w.id, uid: w.uid, inst: w, count: 1 } : null; }
    if (sel.kind === 'mag') { const m = i.magByUid(sel.uid); return m ? { kind: 'mag', id: m.id, uid: m.uid, inst: m, count: 1 } : null; }
    if (sel.uid) { const g = i.gearByUid(sel.uid); return g ? { kind: def(g.id)?.kind || 'gear', id: g.id, uid: g.uid, inst: g, count: 1 } : null; }
    const n = i.count(sel.id); return n > 0 ? { kind: sel.kind, id: sel.id, count: n } : null;
  }
  const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const delta = (v, better = 'up', digits = 0, unit = '') => { if (!v) return ''; const good = better === 'up' ? v > 0 : v < 0; return `<span class="d ${good ? 'up' : 'down'}">${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${unit}</span>`; };
  function quickHtml(id = null) {
    const q = inv().quick;
    return `<div class="ch">Quick keys</div><div class="quick">${[0, 1, 2, 3].map((k) => { const it = q[k] && def(q[k]); const n = q[k] ? inv().count(q[k]) : 0;
      return id ? act(`quick:${k}:${id}`, `${k + 6}${q[k] === id ? ' ●' : ''}`, { on: q[k] === id }) : `<div class="q ${it ? '' : 'empty'}"><span class="k">${k + 6}</span><span class="n">${it ? esc(it.name) : 'free'}</span>${it ? `<span class="c">${n} ×</span>` : ''}</div>`; }).join('')}</div>`;
  }
  function card() {
    const i = inv(), d = ctx.state.data;
    if (slotSel) {
      const label = DOLL_LABEL[slotSel]; const uid = i.equipment[slotSel]; const cur = uid ? (i.weaponByUid(uid) || i.gearByUid(uid)) : null;
      const items = slotItems(slotSel).filter((x) => x.inst.uid !== uid);
      return `<div class="card"><div class="ct">${label}<small>equipment slot</small></div>` +
        `<div class="ch">Worn</div>` + (cur ? `<div class="cand"><span>${esc(def(cur.id)?.name || cur.id)}<span class="sub">${esc(cur.parts ? weaponSub(cur) : gearSub(cur))}</span></span>${act(`unequip:${slotSel}`, 'Unequip')}</div>` : '<div class="empty">Nothing worn.</div>') +
        `<div class="ch">Carried and compatible</div>` + (items.length ? items.map((x) => `<div class="cand"><span>${esc(def(x.inst.id)?.name || x.inst.id)}<span class="sub">${esc(x.kind === 'weapon' ? weaponSub(x.inst) : gearSub(x.inst))}</span></span>${act(`equip:${slotSel}:${x.inst.uid}`, 'Equip')}</div>`).join('') : '<div class="empty">Nothing carried fits this slot.</div>') + '</div>';
    }
    const e = findSel();
    if (!e) {
      const buffs = []; const dm = ctx.damage;
      if (dm?.painkiller) buffs.push('morphine'); if (dm?.steadyMul && dm.steadyMul < 1) buffs.push('steady hands'); if (dm?.speedMul && dm.speedMul > 1) buffs.push('adrenaline'); if (dm?.staminaRegenMul && dm.staminaRegenMul > 1) buffs.push('fed');
      return `<div class="card"><div class="ct">Explorer ${d.explorer}<small>condition</small></div>` +
        kv('Condition', `${Math.round(d.hp)} / 100`, d.hp < 30 ? 'red' : '') + kv('Stamina', `${Math.round(d.stamina)} / 100`) + kv('Bleeding', d.bleeding ? 'yes' : 'no', d.bleeding ? 'red' : '') +
        kv('Torch battery', pct(d.flashlight.battery)) + (buffs.length ? kv('In effect', buffs.join(', ')) : '') + kv('Funds', money(d.money)) +
        quickHtml() + `<div class="desc">Select an item for its particulars. Select a slot to change what is worn.</div></div>`;
    }
    const dd = def(e.id); const c = catOf(e);
    let h = `<div class="card"><div class="ct">${esc(dd?.full || dd?.name || e.id)}<small>${esc(c === 'weapon' ? `${WEAPONS[e.id].cls} · ${CALIBERS[WEAPONS[e.id].cal]?.name || ''}` : c === 'mag' ? 'magazine' : c === 'ammo' ? 'ammunition' : dd?.kind || c)}</small></div>`;
    if (dd?.desc) h += `<div class="desc">${esc(dd.desc)}</div>`;
    if (c === 'weapon') {
      const w = e.inst, wd = WEAPONS[w.id], ef = weaponEffects(w);
      h += kv('Rate', `${wd.rpm} rpm`) + kv('Modes', wd.modes.join(' / ')) + kv('Dispersion', `${(wd.moa * ef.moa).toFixed(2)}°${ef.moa !== 1 ? ` <span class="dimink">(${wd.moa}°)</span>` : ''}`) + kv('Recoil', `${(wd.recoil[0] * ef.recoil).toFixed(2)} / ${(wd.recoil[1] * ef.recoil).toFixed(2)}`) + kv('Ergonomics', `${Math.round((wd.ergo + ef.ergo) * 100)}`) + kv('Noise', pct(ef.noise * 100)) + kv('Weight', kg(weaponWeight(w), 2)) + kv('Value', money(wd.price));
      h += `<div class="ch">Condition</div>` + ['barrel', 'bolt', 'frame'].map((p) => { const v = w.parts?.[p] ?? 100; return `<div class="kv"><span>${p}</span><b class="${condClass(v)}">${Math.round(v)} %</b></div>${mini(v / 100, condClass(v))}`; }).join('') + `<div class="kv"><span>fouling</span><b class="${w.dirt > 0.5 ? 'red' : w.dirt > 0.25 ? 'amb' : ''}">${pct(w.dirt * 100)}</b></div>${mini(w.dirt, w.dirt > 0.5 ? 'red' : 'amb')}` + (w.jammed ? kv('Action', 'stoppage', 'red') : '');
      h += `<div class="ch">Loaded</div>` + kv('Magazine', w.mag ? `${esc(MAGAZINES[w.mag.id]?.name || w.mag.id)}` : wd.internal ? 'internal' : 'none') + kv('Rounds', magText(w)) + kv('Chamber', w.chamber ? ammoLabel(w.chamber) : 'empty') + kv('Fire mode', w.fireMode || wd.modes[0]);
      const atts = [...(w.rails || []).map((id) => ['rail', id]), ...Object.entries(w.attachments || {})];
      h += `<div class="ch">Attachments</div>` + (atts.length ? atts.map(([s, id]) => kv(s, esc(def(id)?.name || id))).join('') : '<div class="empty">None fitted.</div>');
      const m = effMounts(wd, w.rails); h += `<div class="ch">Mounts</div>` + Object.entries(m).map(([s, std]) => kv(s, std === 'none' ? '—' : std)).join('');
    } else if (c === 'mag') {
      const m = e.inst, md = MAGAZINES[m.id]; const fits = i.weapons.filter((w) => md.fits.includes(WEAPONS[w.id].family)).map((w) => WEAPONS[w.id].name);
      h += kv('Capacity', `${md.cap}`) + kv('Loaded', `${m.rounds}${m.ammo ? ' · ' + esc(AMMO[m.ammo].name) : ''}`) + kv('Fits', fits.length ? fits.join(', ') : md.fits.join(', ')) + kv('Ready', i.isReady(m.uid) ? 'in the rig' : 'in the pack · slow reload') + kv('Weight', kg(magWeight(m), 2)) + kv('Value', money(md.price));
    } else if (c === 'ammo') {
      const a = AMMO[e.id]; const vest = i.equipped('vest'), vd = vest && def(vest.id);
      h += kv('Damage', `${a.damage}${a.pellets > 1 ? ` × ${a.pellets}` : ''}`) + kv('Penetration class', `${a.pen}`) + kv('Velocity', `${a.speed} m/s`) + kv('Noise', pct(a.noise * 100)) + kv('Weight', `${(a.weight * 1000).toFixed(0)} g / round`) + kv('Value', `${money(a.price)} / round`) + kv('Carried', `${e.count}`);
      h += `<div class="ch">Against armour</div>` + [2, 3, 4, 5, 6].map((cls) => kv(`class ${cls}`, pct(penChance(a.pen, cls) * 100))).join('');
      if (vd) { const dur = (vest.durability ?? vd.durability) / vd.durability; h += kv(`your vest · ${esc(vd.name)}`, pct(penChance(a.pen, vd.cls, dur) * 100)); }
    } else if (c === 'kit') {
      const g = e.inst, gd = def(g.id); const slot = GEAR_SLOT[gd.kind]; const worn = slot && i.equipped(slot); const wd = worn && worn.uid !== g.uid ? def(worn.id) : null;
      if (gd.cls) { const dur = (g.durability ?? gd.durability) / gd.durability; h += kv('Armour class', `${gd.cls}${wd?.cls ? delta(gd.cls - wd.cls, 'up') : ''}`) + kv('Covers', gd.zones.join(', ')) + kv('Durability', `${Math.round(g.durability ?? gd.durability)} / ${gd.durability}${wd?.durability ? delta(gd.durability - wd.durability, 'up') : ''}`) + mini(dur, condClass(dur * 100)) + kv('Effective class', (gd.cls * (0.55 + 0.45 * dur)).toFixed(1)); }
      if (gd.capacity != null) h += kv('Carry', `+${gd.capacity} kg${wd?.capacity != null ? delta(gd.capacity - wd.capacity, 'up') : ''}`);
      if (gd.readyMags) h += kv('Pouches', `${gd.readyMags}${wd?.readyMags ? delta(gd.readyMags - wd.readyMags, 'up') : ''}`) + kv('Quick slots', `${gd.quick}`) + (gd.armor ? kv('Soft insert', `class ${gd.armor}`) : '');
      if (gd.light) h += kv('Lamp', `${gd.light}`); if (gd.nvg) h += kv('Night vision', `generation ${gd.nvg}`); if (g.charge != null) h += kv(gd.filter ? 'Filter' : 'Cell', pct(g.charge)) + mini(g.charge / 100, condClass(g.charge));
      if (gd.gas) h += kv('Gas protection', pct(gd.gas * 100)); if (gd.fov) h += kv('Field of view', pct(gd.fov * 100));
      h += kv('Weight', `${kg(gd.weight)}${wd ? delta(gd.weight - wd.weight, 'down', 1) : ''}`) + (gd.speed !== 1 ? kv('Movement', pct(gd.speed * 100)) : '') + (gd.stamina !== 1 ? kv('Stamina drain', pct(gd.stamina * 100)) : '') + kv('Value', money(gd.price));
      if (wd) h += `<div class="desc">Compared with the ${esc(wd.name)} worn.</div>`;
    } else if (c === 'attachment') {
      const a = ATTACHMENTS[e.id]; const fits = i.weapons.filter((w) => attFitsWeapon(a, w)).map((w) => WEAPONS[w.id].name);
      h += kv('Slot', a.slot === 'rail' ? 'rail conversion' : a.slot) + kv('Mount', a.fits.join(', ')) + (a.gives ? kv('Adds', Object.entries(a.gives).map(([s, v]) => `${s} ${v}`).join(', ')) : '') + kv('Effect', effectsText(a.effects) || '—') + kv('Fits carried', fits.length ? fits.join(', ') : 'nothing') + kv('Weight', kg(a.weight, 2)) + kv('Value', money(a.price));
    } else if (c === 'med' || dd?.kind === 'grenade') {
      const it = dd; const ef = it.effect || {}; const lines = [];
      if (ef.heal) lines.push(`+${ef.heal}`); if (ef.healOver) lines.push(`+${ef.healOver[0]} over ${ef.healOver[1]} s`); if (ef.stopBleed) lines.push('stops bleeding'); if (ef.stamina) lines.push(`stamina +${ef.stamina}`); if (ef.painkiller) lines.push(`${ef.painkiller} s painkiller`); if (ef.steady) lines.push(`${ef.steady} s steady`); if (ef.speedFor) lines.push(`${ef.speedFor[0]} s faster`); if (ef.staminaRegen) lines.push(`${ef.staminaRegen[0]} s better wind`);
      if (it.kind === 'grenade') h += kv('Fuse', `${it.fuse} s`) + kv('Radius', `${it.radius} m`) + kv('Damage', `${it.damage || '—'}`) + (it.flash ? kv('Effect', 'blinds') : it.smoke ? kv('Effect', `${it.smoke} s smoke`) : '');
      else h += kv('Effect', lines.join(', ') || '—') + kv('Use time', `${it.use} s`);
      h += kv('Weight', kg(it.weight, 2)) + kv('Carried', `${e.count}`) + kv('Value', money(it.price)) + quickHtml(e.id);
    } else {
      if (dd?.uses && !e.uid) h += kv('Uses', `${kitUsesLeft(ctx, e.id)} of ${dd.uses}`);
      if (dd?.damage) h += kv('Damage', `${dd.damage}`); if (dd?.part) h += kv('Replaces', dd.part); if (dd?.detect) h += kv('Range', `${dd.detect.range} m`) + kv('Direction', dd.detect.dir ? 'yes' : 'no'); if (dd?.zoom) h += kv('Magnification', `${dd.zoom}×`); if (dd?.charge) h += kv('Charge', pct(dd.charge));
      h += kv('Weight', kg(weightOf(e.id), 2)) + kv('Carried', `${e.count}`) + (dd?.price ? kv('Value', c === 'artifact' ? money(dd.price) : `${money(dd.price)} · ${money(dd.price * 0.4)} back`) : kv('Value', 'Committee property'));
    }
    if (e.kind === 'weapon' || e.kind === 'mag' || isGearEntry(e)) h += `<div class="ch">Reference</div>${kv('Serial', `${String(e.uid).padStart(4, '0')}`)}`;
    return h + '</div>';
  }
  function loadHtml() {
    const i = inv(); const w = i.weight(), c = i.capacity(); const over = w > c, hard = w > c * 1.5;
    return `<div class="load"><div class="kv"><span>Load</span><b class="${over ? 'red' : ''}">${kg(w)} / ${c} kg</b></div><div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, (w / Math.max(1, c)) * 100).toFixed(1)}%"></i></div>${hard ? '<div class="warn">Over the limit · cannot sprint</div>' : over ? '<div class="warn amb">Overweight · walking slowed</div>' : `<div class="dimink">${kg(c - w)} to spare</div>`}</div>`;
  }

  const H = {
    slot(s) { slotSel = slotSel === s ? null : s; sel = null; api.refresh(); return 'ui_click'; },
    equip(arg) {
      const [slot, uid] = arg.split(':'); const i = inv(); const u = +uid;
      if (SLOTS.includes(slot) && slot !== 'melee') { const w = i.weaponByUid(u); if (!w) return false; if (slot === 'sidearm' && WEAPONS[w.id].cls !== 'pistol') { api.notice('Sidearm slot: pistols only.', true); return false; } i.equipWeapon(u, slot); api.weaponsChanged(); api.notice(`${WEAPONS[w.id].name} carried as ${DOLL_LABEL[slot].toLowerCase()}.`); }
      else { const g = i.gearByUid(u); if (!g) return false; const gd = def(g.id); if (GEAR_SLOT[gd.kind] !== slot) return false; i.equipGear(u, slot); if (slot === 'rig') { const r = i.data.readyMags; if (r.length > (gd.readyMags || 0)) r.length = gd.readyMags || 0; } api.weaponsChanged(); api.notice(`${gd.name} worn.`); }
      api.refresh(); return 'pickup_item';
    },
    equipw(uid) { const i = inv(); const w = i.weaponByUid(+uid); if (!w) return false; const e = i.equipment; const slot = WEAPONS[w.id].cls === 'pistol' ? 'sidearm' : !e.primary ? 'primary' : !e.secondary ? 'secondary' : 'primary'; return H.equip(`${slot}:${uid}`); },
    equipg(uid) { const i = inv(); const g = i.gearByUid(+uid); if (!g) return false; const slot = GEAR_SLOT[def(g.id)?.kind]; if (!slot) return false; return H.equip(`${slot}:${uid}`); },
    unequip(slot) { const i = inv(); if (!i.equipment[slot]) return false; const inst = i.equipped(slot); i.unequip(slot); if (slot === 'rig') i.data.readyMags.length = 0; api.weaponsChanged(); api.notice(`${def(inst?.id)?.name || 'Item'} stowed in the pack.`); api.refresh(); return 'ui_click'; },
    ready(uid) {
      const i = inv(); const m = i.magByUid(+uid); if (!m) return false;
      if (i.isReady(m.uid)) { i.setReady(m.uid, false); api.notice(`${MAGAZINES[m.id].name}: moved to the pack.`); }
      else { const cap = i.equippedDef('rig')?.readyMags || 0; if (i.data.readyMags.length >= cap) { api.notice(cap ? `Rig pouches full (${cap}). Stow one first.` : 'No rig worn. Nothing holds a ready magazine.', true); return false; } i.setReady(m.uid, true); api.notice(`${MAGAZINES[m.id].name}: in the rig.`); }
      api.weaponsChanged(); api.refresh(); return 'ui_click';
    },
    pref(arg) { const [cal, id] = arg.split(':'); if (!AMMO[id]) return false; inv().setPreferredAmmo(cal, id); api.weaponsChanged(); api.notice(`${AMMO[id].name} preferred for ${calShort(cal)}.`); api.refresh(); return 'ui_click'; },
    use(id) {
      const i = inv(); const it = ITEMS[id]; if (!it || !i.has(id)) return false;
      if (!ctx.damage?.use || ctx.damage.use(id) === false) { api.notice(`${it.name}: no use here.`, true); return false; }
      i.remove(id, 1); if (it.use) ctx.player.lockMovement?.(it.use);
      api.notice(`${it.name} used. ${it.desc || ''}`.trim()); api.refresh();
      return USE_SOUND[id] || 'pickup_item';
    },
    quick(arg) { const [k, id] = arg.split(':'); const i = inv(); const n = +k; if (i.quick[n] === id) { i.setQuick(n, null); api.notice(`Key ${n + 6} cleared.`); } else { for (let j = 0; j < 4; j++) if (i.quick[j] === id) i.setQuick(j, null); i.setQuick(n, id); api.notice(`${def(id)?.name} on key ${n + 6}.`); } api.refresh(); return 'ui_click'; },
    install(id) {
      const i = inv(), d = ctx.state.data; if (!i.has(id)) return false;
      if (id === 'battery') {
        if (ctx.gear?.installBattery) { const r = ctx.gear.installBattery(id); if (r === false) { api.notice('Nothing needs a cell.', true); return false; } }
        else { if (d.flashlight.battery >= 99.5) { api.notice('Torch already at charge.', true); return false; } i.remove(id, 1); d.flashlight.battery = 100; }
        api.notice('Cell installed.'); api.refresh(); return 'ui_click';
      }
      if (id === 'filter') {
        const mask = i.equipped('mask'); if (!mask) { api.notice('No mask worn.', true); return false; }
        if (ctx.gear?.installFilter) { const r = ctx.gear.installFilter(id); if (r === false) return false; }
        else { if ((mask.charge ?? 0) >= 99.5) { api.notice('Filter still fresh.', true); return false; } i.remove(id, 1); mask.charge = 100; }
        api.notice('Filter fitted.'); api.refresh(); return 'ui_click';
      }
      return false;
    },
    drop(arg) { const [kind, id, uid] = arg.split(':'); const e = { kind, id, uid: uid ? +uid : null }; const r = dropEntry(ctx, api, e); if (r) { if (isSel(e)) sel = null; api.refresh(); } return r; },
  };
  function render() {
    const node = el(`<div class="inv"><div class="doll"><div class="sec-t">Worn</div><div class="slots">${DOLL.map(([s, l]) => slotHtml(s, l)).join('')}</div>${loadHtml()}</div><div class="lists">${lists()}</div><div class="side">${card()}</div></div>`);
    bindActions(node, H, api.sound);
    for (const r of node.querySelectorAll('[data-sel]')) r.addEventListener('click', (ev) => { if (ev.target.closest('button')) return; const [kind, id, uid] = r.dataset.sel.split(':'); sel = { kind, id, uid: uid ? +uid : null }; slotSel = null; api.sound('ui_click', 0.3); api.refresh(); });
    return node;
  }
  return { id: 'inventory', title: 'Kit manifest', form: '61-K', keys: `${KEYS} · I close`, render, onClose() { slotSel = null; } };
}

// ---------------------------------------------------------------------------------------------------------------
// workbench
// ---------------------------------------------------------------------------------------------------------------
const BENCH_TABS = [['attachments', 'Attachments'], ['maintenance', 'Maintenance'], ['magazines', 'Magazines'], ['armour', 'Armour']];
function workbenchPanel(ctx, api) {
  let wuid = null, tab = 'attachments'; const picks = {};   // cal -> ammo id chosen for loading
  const inv = () => ctx.inventory;
  const weaponsSorted = () => { const i = inv(); const rank = (w) => { const s = slotOfUid(i, w.uid); return s ? SLOTS.indexOf(s) : 9; }; return [...i.weapons].sort((a, b) => rank(a) - rank(b)); };
  const curWeapon = () => { const list = weaponsSorted(); let w = wuid ? inv().weaponByUid(wuid) : null; if (!w) { w = list[0] || null; wuid = w ? w.uid : null; } return w; };
  const magByUid = (uid) => { const i = inv(); return i.magByUid(uid) || i.weapons.map((w) => w.mag).find((m) => m && m.uid === uid) || null; };
  const pickFor = (cal) => { const i = inv(); const p = picks[cal]; if (p && i.count(p) > 0) return p; return i.preferredAmmo(cal); };
  const kitLine = () => { const i = inv(); const k = (id) => { const n = i.count(id); return `${ITEMS[id].name} ×${n}${n ? ` (${kitUsesLeft(ctx, id)} use${kitUsesLeft(ctx, id) === 1 ? '' : 's'})` : ''}`; }; return `${k('cleankit')} · ${k('repairkit')} · ${k('armorkit')} · barrel ×${i.count('part_barrel')} · bolt ×${i.count('part_bolt')} · springs ×${i.count('part_spring')}`; };

  function attachmentsHtml(w) {
    const i = inv(), d = WEAPONS[w.id], m = effMounts(d, w.rails);
    const carried = Object.keys(i.items).filter((id) => ATTACHMENTS[id] && i.count(id) > 0).map((id) => ATTACHMENTS[id]);
    let h = '';
    // rails
    const railsIn = (w.rails || []).map((id) => ATTACHMENTS[id]).filter(Boolean);
    const railsFit = carried.filter((a) => a.slot === 'rail' && !w.rails.includes(a.id) && attFitsWeapon(a, w));
    h += `<div class="mount"><div class="mk">Rails<small>${railsIn.length ? railsIn.map((r) => Object.entries(r.gives).map(([s, v]) => `${s} → ${v}`).join(', ')).join(' · ') : 'factory mounts'}</small></div><div>` +
      railsIn.map((r) => { const would = Object.entries(w.attachments).filter(([s, id]) => { const rails = w.rails.filter((x) => x !== r.id); const std = effMounts(d, rails)[s]; return !(std && ATTACHMENTS[id].fits.includes(std)); }).map(([, id]) => ATTACHMENTS[id].name); return `<div class="cand"><span>${esc(r.name)}<span class="sub">fitted${would.length ? ` · removing drops ${would.join(', ')}` : ''}</span></span>${act(`unfit:${w.uid}:${r.id}`, 'Remove')}</div>`; }).join('') +
      railsFit.map((a) => `<div class="cand"><span>${esc(a.name)}<span class="sub">${Object.entries(a.gives).map(([s, v]) => `${s} → ${v}`).join(', ')} · ${i.count(a.id)} carried</span></span>${act(`fit:${w.uid}:${a.id}`, 'Fit')}</div>`).join('') +
      (!railsIn.length && !railsFit.length ? '<div class="empty">No rail carried that fits.</div>' : '') + '</div></div>';
    for (const slot of ['top', 'muzzle', 'under', 'side', 'stock']) {
      if (!(slot in m) && !(slot in d.mounts)) continue;
      const std = m[slot]; const cur = w.attachments[slot]; const fits = carried.filter((a) => a.slot === slot && attFitsWeapon(a, w));
      h += `<div class="mount"><div class="mk">${slot}<small>${std && std !== 'none' ? `mount · ${std}` : 'no mount'}${std === 'integral' ? ' · integral suppressor' : ''}</small></div><div>`;
      if (cur) { const a = ATTACHMENTS[cur]; h += `<div class="cand"><span>${esc(a.name)}<span class="sub">fitted · ${effectsText(a.effects) || 'no change'}</span></span>${act(`unfit:${w.uid}:${cur}`, 'Detach')}</div>`; }
      else if (std && std !== 'none' && std !== 'integral') h += fits.length ? fits.map((a) => `<div class="cand"><span>${esc(a.name)}<span class="sub">${effectsText(a.effects) || 'no change'} · ${kg(a.weight, 2)} · ${i.count(a.id)} carried</span></span>${act(`fit:${w.uid}:${a.id}`, 'Fit')}</div>`).join('') : `<div class="empty">Nothing carried fits ${std}.</div>`;
      else h += `<div class="empty">${std === 'integral' ? 'Nothing fits over it.' : 'No mount here. A rail may add one.'}</div>`;
      h += '</div></div>';
    }
    const ef = weaponEffects(w);
    h += `<div class="note">In effect: ${effectsText(ef) || 'factory'} · weight ${kg(weaponWeight(w), 2)}.</div>`;
    return h;
  }
  function maintenanceHtml(w) {
    const i = inv(), d = WEAPONS[w.id], inBase = !!ctx.player.inBase, job = api.jobState;
    const prow = (p) => { const v = w.parts?.[p] ?? 100; const item = PART_ITEM[p];
      return `<div class="prow"><span class="k">${p}</span><span class="v ${condClass(v)}">${Math.round(v)} %</span>${mini(v / 100, condClass(v))}<span class="acts">${act(`repair:${w.uid}:${p}`, 'Repair +35', { disabled: !!job || v >= 100 || !i.has('repairkit'), title: 'Weapon repair kit' })}${act(`replace:${w.uid}:${p}`, 'Replace', { disabled: !!job || v >= 100 || !i.has(item), title: ITEMS[item].name })}</span></div>`; };
    const dirt = w.dirt || 0;
    let h = `<div class="parts">${['barrel', 'bolt', 'frame'].map(prow).join('')}` +
      `<div class="prow"><span class="k">fouling</span><span class="v ${dirt > 0.5 ? 'red' : dirt > 0.25 ? 'amb' : ''}">${pct(dirt * 100)}</span>${mini(dirt, dirt > 0.5 ? 'red' : 'amb')}<span class="acts">${act(`clean:${w.uid}`, inBase ? 'Clean · 4 s' : 'Clean · kit use', { disabled: !!job || dirt < 0.005 || (!inBase && !i.has('cleankit')) })}</span></div>` +
      (w.jammed ? `<div class="prow"><span class="k">action</span><span class="v red">stoppage</span><span></span><span class="acts">${act(`unjam:${w.uid}`, 'Clear', { disabled: !!job })}</span></div>` : '') + '</div>';
    if (job) h += `<div class="jobline"><span>${esc(job.label)}</span><span>${job.t.toFixed(1)} / ${job.dur} s</span></div><div class="bar job"><i style="width:${(job.k * 100).toFixed(1)}%"></i></div>`;
    const ef = weaponEffects(w); const bolt = w.parts?.bolt ?? 100, barrel = w.parts?.barrel ?? 100, frame = w.parts?.frame ?? 100;
    const jam = 0.18 * dirt * dirt * dirt + 0.12 * (1 - bolt / 100) * (1 - bolt / 100);
    h += sec('Effect of wear', null, row('Dispersion', `${(d.moa * ef.moa).toFixed(2)}°<span class="u">of ${d.moa}°</span>`) + row('Damage', `${pct((1 - 0.15 * (1 - barrel / 100)) * 100)}`) + row('Stoppage per shot', `${(jam * 100).toFixed(1)} %`, jam > 0.05 ? 'red' : '') + row('Misfire', frame < 30 ? '<span class="red">possible · frame worn</span>' : 'none'));
    h += `<div class="note">${inBase ? 'At Vanno the bench is stocked: cleaning is free.' : 'In the field a clean spends a cleaning kit use.'} A repair kit adds 35 % to one part; a replacement part restores it. Carried: ${kitLine()}.</div>`;
    return h;
  }
  function magazinesHtml(w) {
    const i = inv(), d = WEAPONS[w.id], cal = d.cal;
    const types = ammoOf(cal).filter((a) => i.count(a.id) > 0); const pick = pickFor(cal);
    let h = `<div class="picks"><span class="lab">Load with</span>${types.length ? types.map((a) => act(`pick:${cal}:${a.id}`, `${esc(a.name)} · ${i.count(a.id)}`, { on: a.id === pick })).join('') : `<span class="dimink">no loose ${esc(calShort(cal))} carried</span>`}</div>`;
    const mags = [...(w.mag ? [w.mag] : []), ...i.magsForWeapon(w)];
    const mrow = (m, inGun) => { const md = MAGAZINES[m.id]; const full = m.rounds >= md.cap; const other = m.rounds > 0 && m.ammo !== pick; const have = pick ? i.count(pick) : 0;
      return row3(`${esc(md.name)}${inGun ? '<span class="tag">in weapon</span>' : i.isReady(m.uid) ? '<span class="tag">ready</span>' : ''}<span class="sub">${esc(magSub(m))}${other ? ` · holds ${ammoTag(m.ammo)}: unload before loading ${ammoTag(pick)}` : ''}</span>`, `${m.rounds}<span class="u">/ ${md.cap}</span>`,
        act(`load:${m.uid}`, 'Load', { disabled: full || other || !pick || have <= 0, deny: !full && !other && have <= 0 }) + act(`unload:${m.uid}`, 'Unload', { disabled: m.rounds <= 0 })); };
    if (d.internal) { const n = w.tube?.length || 0; const last = n ? w.tube[n - 1] : null; const other = n > 0 && last !== pick;
      h += sec(d.clip ? 'Internal magazine' : 'Tube', null, row3(`${esc(d.full)}<span class="sub">${n ? `${ammoTag(last)}` : 'empty'}${w.chamber ? ' · one chambered' : ''}${other ? ` · holds ${ammoTag(last)}: unload first` : ''}</span>`, `${n}<span class="u">/ ${d.internal}</span>`, act(`tubeload:${w.uid}`, 'Load', { disabled: n >= d.internal || other || !pick || i.count(pick) <= 0 }) + act(`tubeunload:${w.uid}`, 'Unload', { disabled: n <= 0 }))); }
    const spare = mags.filter((m) => m !== w.mag);
    h += sec(d.clip ? 'Clips' : 'Magazines', mags.length, mags.length ? mags.map((m) => mrow(m, m === w.mag)).join('') : `<div class="empty">No magazine carried for the ${esc(d.name)}.</div>`);
    const need = mags.reduce((s, m) => s + (MAGAZINES[m.id].cap - m.rounds), 0);
    h += `<div class="btns"><span class="acts" style="text-align:left">${act(`fill:${w.uid}`, 'Fill all magazines', { disabled: need <= 0 || !types.length })}</span><span class="dimink" style="margin-left:12px">${need} rounds to fill · ${spare.length} spare</span></div>`;
    h += `<div class="note">Loose rounds: ${types.length ? types.map((a) => `${esc(a.name)} ×${i.count(a.id)}`).join(' · ') : 'none for this calibre'}. One type per magazine.</div>`;
    return h;
  }
  function armourHtml() {
    const i = inv(); const pieces = i.gear.filter((g) => { const d = def(g.id); return d && (d.kind === 'vest' || d.kind === 'helmet') && d.durability; });
    let h = pieces.length ? pieces.map((g) => { const d = def(g.id); const v = g.durability ?? d.durability; const p = (v / d.durability) * 100; const s = slotOfUid(i, g.uid);
      return `<div class="prow"><span class="k">${esc(d.name)}${s ? '<span class="tag">worn</span>' : ''}</span><span class="v ${condClass(p)}">${Math.round(v)} / ${d.durability}</span>${mini(p / 100, condClass(p))}<span class="acts">${act(`arepair:${g.uid}`, 'Repair +40', { disabled: !!api.jobState || v >= d.durability || !i.has('armorkit'), title: 'Armour repair kit' })}</span></div>`; }).join('') : '<div class="empty">No armour carried.</div>';
    h = `<div class="parts">${h}</div><div class="note">An armour repair kit restores 40 durability to one piece per use. Effective class falls with damage: a vest at half durability stops as class ${(3 * (0.55 + 0.45 * 0.5)).toFixed(1)} instead of 3. Carried: ${esc(ITEMS.armorkit.name)} ×${i.count('armorkit')}${i.count('armorkit') ? ` (${kitUsesLeft(ctx, 'armorkit')} uses)` : ''}.</div>`;
    return h;
  }
  const H = {
    weapon(uid) { wuid = +uid; api.refresh(); return 'ui_click'; },
    tab(t) { tab = t; api.refresh(); return 'ui_click'; },
    pick(arg) { const [cal, id] = arg.split(':'); picks[cal] = id; api.refresh(); return 'ui_click'; },
    fit(arg) {
      const [uid, id] = arg.split(':'); const i = inv(); const w = i.weaponByUid(+uid); const a = ATTACHMENTS[id]; if (!w || !a || !i.has(id)) return false;
      if (!attach(w, id)) { api.notice(`${a.name} does not fit the ${WEAPONS[w.id].name}${a.slot !== 'rail' && w.attachments[a.slot] ? ': slot occupied' : ''}.`, true); return false; }
      i.remove(id, 1); api.weaponsChanged(); api.notice(`${a.name} fitted to the ${WEAPONS[w.id].name}.`); api.refresh(); return 'ui_click';
    },
    unfit(arg) {
      const [uid, id] = arg.split(':'); const i = inv(); const w = i.weaponByUid(+uid); const a = ATTACHMENTS[id]; if (!w || !a) return false;
      const r = detach(w, id); if (!r) return false;
      i.add(id, 1); const dropped = (r && r.dropped) || []; for (const x of dropped) i.add(x, 1);
      api.weaponsChanged(); api.notice(`${a.name} removed.${dropped.length ? ` Came off with it: ${dropped.map((x) => ATTACHMENTS[x].name).join(', ')}.` : ''}`); api.refresh(); return 'ui_click';
    },
    clean(uid) {
      const i = inv(); const w = i.weaponByUid(+uid); if (!w || api.jobState) return false;
      const inBase = !!ctx.player.inBase;
      if (!inBase && !useKit(ctx, 'cleankit')) { api.notice('No cleaning kit carried.', true); return false; }
      const name = WEAPONS[w.id].name;
      api.job(`Stripping the ${name}`, 4, () => { w.dirt = 0; w.jammed = false; api.weaponsChanged(); api.notice(`${name} stripped, cleaned and oiled.${inBase ? '' : ' Kit use spent.'}`); });
      api.notice(`${name} on the bench.`); return 'reload_magout';
    },
    unjam(uid) { const w = inv().weaponByUid(+uid); if (!w || !w.jammed) return false; w.jammed = false; api.weaponsChanged(); api.notice(`${WEAPONS[w.id].name}: stoppage cleared.`); api.refresh(); return 'unjam'; },
    repair(arg) {
      const [uid, p] = arg.split(':'); const w = inv().weaponByUid(+uid); if (!w || !w.parts || !(p in w.parts)) return false;
      if (w.parts[p] >= 100) { api.notice(`${p}: nothing to repair.`, true); return false; }
      if (!useKit(ctx, 'repairkit')) { api.notice('No repair kit carried.', true); return false; }
      w.parts[p] = Math.min(100, w.parts[p] + (ITEMS.repairkit.repair || 35)); api.weaponsChanged(); api.notice(`${WEAPONS[w.id].name} ${p}: ${Math.round(w.parts[p])} %. Kit use spent.`); api.refresh(); return 'ui_click';
    },
    replace(arg) {
      const [uid, p] = arg.split(':'); const i = inv(); const w = i.weaponByUid(+uid); const item = PART_ITEM[p]; if (!w || !item) return false;
      if (!i.has(item)) { api.notice(`No ${lower(ITEMS[item].name)} carried.`, true); return false; }
      i.remove(item, 1); w.parts[p] = 100; api.weaponsChanged(); api.notice(`${WEAPONS[w.id].name}: ${p} replaced.`); api.refresh(); return 'reload_magin';
    },
    load(uid) {
      const i = inv(); const m = magByUid(+uid); if (!m) return false; const ammo = pickFor(m.cal); if (!ammo) return false;
      if (m.rounds > 0 && m.ammo !== ammo) { api.notice(`Holds ${AMMO[m.ammo].name}. Unload first.`, true); return false; }
      const n = i.loadMag(m, ammo, 999); if (n <= 0) { api.notice(`No loose ${AMMO[ammo].name}.`, true); return false; }
      api.weaponsChanged(); api.notice(`${n} round${n === 1 ? '' : 's'} of ${AMMO[ammo].name} loaded.`); api.refresh(); return 'mag_load_round';
    },
    unload(uid) { const i = inv(); const m = magByUid(+uid); if (!m || m.rounds <= 0) return false; const n = m.rounds, a = m.ammo; i.unloadMag(m); api.weaponsChanged(); api.notice(`${n} round${n === 1 ? '' : 's'} of ${a ? AMMO[a].name : 'ammunition'} returned to the pack.`); api.refresh(); return 'reload_magout'; },
    fill(uid) { const i = inv(); const w = i.weaponByUid(+uid); if (!w) return false; const n = i.fillMags(w); if (n <= 0) { api.notice('Nothing to load.', true); return false; } api.weaponsChanged(); api.notice(`${n} round${n === 1 ? '' : 's'} loaded across the magazines.`); api.refresh(); return 'mag_load_round'; },
    tubeload(uid) {
      const i = inv(); const w = i.weaponByUid(+uid); const d = w && WEAPONS[w.id]; if (!w || !d?.internal) return false; const ammo = pickFor(d.cal); if (!ammo) return false;
      w.tube = w.tube || []; if (w.tube.length && w.tube[w.tube.length - 1] !== ammo) { api.notice(`Holds ${AMMO[w.tube[0]].name}. Unload first.`, true); return false; }
      let n = 0; while (w.tube.length < d.internal && i.count(ammo) > 0) { i.remove(ammo, 1); w.tube.push(ammo); n++; }
      if (!n) return false; api.weaponsChanged(); api.notice(`${n} round${n === 1 ? '' : 's'} of ${AMMO[ammo].name} loaded.`); api.refresh(); return 'shell_insert';
    },
    tubeunload(uid) { const i = inv(); const w = i.weaponByUid(+uid); if (!w || !w.tube?.length) return false; let n = 0; while (w.tube.length) { i.add(w.tube.pop(), 1); n++; } api.weaponsChanged(); api.notice(`${n} round${n === 1 ? '' : 's'} returned to the pack.`); api.refresh(); return 'reload_magout'; },
    arepair(uid) {
      const i = inv(); const g = i.gearByUid(+uid); const d = g && def(g.id); if (!g || !d?.durability) return false;
      if ((g.durability ?? d.durability) >= d.durability) { api.notice('Nothing to repair.', true); return false; }
      if (!useKit(ctx, 'armorkit')) { api.notice('No armour repair kit carried.', true); return false; }
      g.durability = Math.min(d.durability, (g.durability ?? d.durability) + (ITEMS.armorkit.repair || 40)); api.notice(`${d.name}: ${Math.round(g.durability)} / ${d.durability}. Kit use spent.`); api.refresh(); return 'ui_click';
    },
  };
  function render() {
    const i = inv(); const list = weaponsSorted(); const w = curWeapon();
    let h = `<div class="bench">`;
    if (tab !== 'armour') h += `<div class="tabs wtabs">${list.length ? list.map((x) => { const s = slotOfUid(i, x.uid); return `<button class="tab ${x.uid === wuid ? 'on' : ''}" data-a="weapon:${x.uid}">${esc(WEAPONS[x.id].name)}${s ? `<span class="n">${DOLL_LABEL[s].toLowerCase()}</span>` : ''}</button>`; }).join('') : '<span class="empty">Nothing on the bench.</span>'}</div>`;
    h += tabsHtml(BENCH_TABS, tab);
    if (tab === 'armour') h += armourHtml();
    else if (!w) h += '<div class="empty">No weapon carried. The bench is bare.</div>';
    else if (tab === 'attachments') h += attachmentsHtml(w);
    else if (tab === 'maintenance') h += maintenanceHtml(w);
    else h += magazinesHtml(w);
    h += '</div>';
    const node = el(h); bindActions(node, H, api.sound); return node;
  }
  return { id: 'workbench', title: 'Vanno · Workbench', form: '61-W', render };
}

// ---------------------------------------------------------------------------------------------------------------
// loot: searching a pile, a container, a corpse
// ---------------------------------------------------------------------------------------------------------------
function lootPanel(ctx, api) {
  const inv = () => ctx.inventory;
  const pileOf = () => { const p = api.data?.pile; if (!p) return { name: 'CACHE', entries: [] }; p.entries = p.entries || []; return p; };
  const canCarry = (add) => { const i = inv(); return i.weight() + add <= i.capacity() * 1.5 + 1e-6; };
  function entryLabel(e) {
    const d = def(e.id); const name = d?.full || d?.name || e.id;
    let sub = '';
    if (e.kind === 'weapon' && e.inst) sub = weaponSub(e.inst);
    else if (e.kind === 'mag' && e.inst) sub = magSub(e.inst);
    else if (e.inst && e.kind !== 'weapon' && e.kind !== 'mag') sub = gearSub(e.inst);
    else if (AMMO[e.id]) sub = `${calShort(AMMO[e.id].cal)} · damage ${AMMO[e.id].damage} · pen ${AMMO[e.id].pen}`;
    else sub = d?.desc || '';
    return [name, sub];
  }
  function take(pile, e, quiet = false) {
    const i = inv(); const w = entryWeight(e);
    if (!canCarry(w)) { if (!quiet) api.notice(`Load limit. ${def(e.id)?.name || e.id} weighs ${kg(w)}; ${kg(Math.max(0, i.capacity() * 1.5 - i.weight()))} left.`, true); return false; }
    const gearLike = e.kind === 'gear' || (e.inst && e.kind !== 'weapon' && e.kind !== 'mag') || (e.kind === 'item' && GEAR_KINDS.has(def(e.id)?.kind));
    if (e.kind === 'weapon') i.addWeapon(e.inst || makeWeapon(e.id));
    else if (e.kind === 'mag') i.addMag(e.inst || makeMag(e.id));
    else if (gearLike) { if (e.inst) i.addGear(e.inst); else for (let k = 0; k < (e.count || 1); k++) i.addGear(makeGear(e.id)); }
    else i.add(e.id, e.count || 1);
    const k = pile.entries.indexOf(e); if (k >= 0) pile.entries.splice(k, 1);
    return true;
  }
  const H = {
    take(idx) {
      const pile = pileOf(); const e = pile.entries[+idx]; if (!e) return false;
      if (!take(pile, e)) return false;
      const d = def(e.id); api.notice(`Taken: ${d?.name || e.id}${(e.count || 1) > 1 ? ` ×${e.count}` : ''}.`);
      if (e.kind !== 'item' && !AMMO[e.id]) api.weaponsChanged(); pile.onChange?.(); api.refresh();
      return AMMO[e.id] ? 'pickup_ammo' : 'pickup_item';
    },
    takeall() {
      const pile = pileOf(); if (!pile.entries.length) return false;
      const names = []; let stuck = null;
      for (const e of [...pile.entries]) { if (take(pile, e, true)) names.push(`${def(e.id)?.name || e.id}${(e.count || 1) > 1 ? ` ×${e.count}` : ''}`); else stuck = e; }
      if (!names.length) { api.notice('Load limit. Nothing more can be carried.', true); return false; }
      api.notice(`Taken: ${names.join(', ')}.${stuck ? ` Left behind: over the load limit.` : ''}`, !!stuck);
      api.weaponsChanged(); pile.onChange?.(); api.refresh(); return 'pickup_item';
    },
    put(arg) {
      const [kind, id, uid] = arg.split(':'); const pile = pileOf(); const i = inv(); const u = uid ? +uid : null; let out;
      if (kind === 'weapon') { const w = i.removeWeapon(u); if (!w) return false; out = { kind: 'weapon', inst: w, id: w.id, count: 1 }; }
      else if (kind === 'mag') { const m = i.removeMag(u); if (!m) return false; out = { kind: 'mag', inst: m, id: m.id, count: 1 }; }
      else if (u != null) { const g = i.removeGear(u); if (!g) return false; out = { kind: 'gear', inst: g, id: g.id, count: 1 }; }
      else { if (!i.remove(id, 1)) return false; const ex = pile.entries.find((x) => x.kind === 'item' && x.id === id); if (ex) { ex.count = (ex.count || 1) + 1; out = null; } else out = { kind: 'item', id, count: 1 }; }
      if (out) pile.entries.push(out);
      if (kind === 'weapon' || u != null) api.weaponsChanged();
      api.notice(`${def(id)?.name || id} left in the ${lower(String(pile.name || 'pile').split('·')[0].trim())}.`); pile.onChange?.(); api.refresh(); return 'pickup_item';
    },
  };
  function render() {
    const pile = pileOf(), i = inv(); const total = pile.entries.reduce((s, e) => s + entryWeight(e), 0);
    const left = pile.entries.length ? pile.entries.map((e, k) => { const [n, s] = entryLabel(e); const w = entryWeight(e); return `<div class="li" tabindex="0"><div class="n">${esc(n)}${(e.count || 1) > 1 ? `<span class="tag">×${e.count}</span>` : ''}<span class="sub">${esc(s)}</span></div><div class="num">${kg(w, w < 1 ? 2 : 1)}</div><div class="acts">${act(`take:${k}`, 'Take', { deny: !canCarry(w) })}</div></div>`; }).join('') : '<div class="empty">Nothing left.</div>';
    const carried = kitList(i).filter((e) => catOf(e) !== 'mission');
    const right = carried.length ? carried.map((e) => { const d = def(e.id); const n = d?.full || d?.name || e.id; const s = e.kind === 'weapon' ? weaponSub(e.inst) : e.kind === 'mag' ? magSub(e.inst) : isGearEntry(e) ? gearSub(e.inst) : (d?.desc || ''); const worn = e.uid ? slotOfUid(i, e.uid) : null;
      return `<div class="li" tabindex="0"><div class="n">${esc(n)}${e.count > 1 ? `<span class="tag">×${e.count}</span>` : ''}${worn ? `<span class="tag">${DOLL_LABEL[worn] || worn}</span>` : ''}<span class="sub">${esc(s)}</span></div><div class="num">${kg(entryWeight(e), 2)}</div><div class="acts">${act(`put:${e.kind}:${e.id}:${e.uid || ''}`, 'Put')}</div></div>`; }).join('') : '<div class="empty">Nothing carried.</div>';
    const w = i.weight(), c = i.capacity();
    const node = el(`<div class="loot"><div><div class="colh"><span>${esc(pile.name || 'Cache')}</span><span>${pile.entries.length} · ${kg(total)}</span></div><div class="acts" style="text-align:left;margin:4px 0 6px">${act('takeall', 'Take all', { disabled: !pile.entries.length })}</div>${left}</div>` +
      `<div><div class="colh"><span>Carried</span><span class="${w > c ? 'red' : ''}">${kg(w)} / ${c} kg</span></div><div class="note" style="margin:4px 0 6px">Limit ${kg(c * 1.5, 0)}. Over ${c} kg walking slows; over the limit nothing more is taken.</div>${right}</div></div>`);
    bindActions(node, H, api.sound); return node;
  }
  return { id: 'loot', title: (ctx, api) => `Search · ${api.data?.pile?.name || 'cache'}`, form: '61-S', render };
}
