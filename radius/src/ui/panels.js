// Base station panels + inventory + map. Every panel is a sheet of Committee stock: a header line, sections,
// right-aligned figures, actions as small bordered buttons. The world is frozen while a panel is open (main passes
// dt 0 to the world); panels.update still receives real dt and runs the medication queue once the sheet is closed.
import { AMMO, ITEMS, WEAPON_DEFS, makeWeapon } from '../player/inventory.js';

// ---- shared helpers (menus.js imports these) ----
const THIN = '\u2009';
export const money = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN) + ' ₽';
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clockOf = (hour) => { const h = Math.floor(hour), m = Math.floor((hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
export function spanText(seconds) {
  const s = Math.max(0, seconds); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
export const visible = (e) => e.offsetParent !== null || e === document.activeElement;
export function focusables(root) { return [...root.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]')].filter(visible); }
// Arrow keys walk the focusables, Tab/Shift+Tab too (input.js swallows the browser default), digits pick the nth action.
export function navigate(e, root, actionSel = 'button.btn:not([disabled]), button.act:not([disabled])') {
  const list = focusables(root); if (!list.length) return false;
  const cur = document.activeElement, i = list.indexOf(cur), code = e.code;
  if (code === 'ArrowDown' || (code === 'Tab' && !e.shiftKey)) { list[(i + 1) % list.length].focus(); return true; }
  if (code === 'ArrowUp' || (code === 'Tab' && e.shiftKey)) { list[(i - 1 + list.length) % list.length].focus(); return true; }
  if (/^Digit[1-9]$/.test(code)) { const btns = [...root.querySelectorAll(actionSel)].filter(visible); const b = btns[+code[5] - 1]; if (b) { b.focus(); b.click(); return true; } }
  if (code === 'Enter' && cur && root.contains(cur) && cur.tagName !== 'BUTTON') { cur.click(); return true; }
  return false;
}
export function bindActions(root, handlers, snd) {
  for (const b of root.querySelectorAll('[data-a]')) {
    b.onclick = () => {
      if (b.disabled) return;
      const [name, ...rest] = b.dataset.a.split(':');
      const fn = handlers[name]; if (!fn) return;
      const r = fn(rest.join(':'), b);
      if (r === false) snd('ui_deny', 0.5); else if (r !== null) snd(typeof r === 'string' ? r : 'ui_click', 0.45);   // null: the handler made its own sound
    };
  }
}
// remember which focusable had focus so a rebuild after a click lands in the same place
export function keepFocus(root, rebuild) {
  const list = focusables(root), i = list.indexOf(document.activeElement);
  rebuild();
  const after = focusables(root); if (!after.length) return;
  (after[Math.min(i < 0 ? 0 : i, after.length - 1)]).focus({ preventScroll: false });
}

const weaponName = (w) => WEAPON_DEFS[w.id]?.full || w.id;
const BUNDLE = { probe: 5 };   // supply-crate quantities for cheap consumables
const loadedText = (w) => `${w.chamber + (w.mags[w.magIndex] ?? 0)} · ${w.mags.join('/')}`;

export function createPanels(ctx) {
  const ui = document.getElementById('ui');
  const root = document.createElement('div'); root.id = 'panels'; ui.appendChild(root);
  const scrim = document.createElement('div'); scrim.className = 'scrim'; root.appendChild(scrim);
  const sheet = document.createElement('div'); sheet.className = 'sheet center'; root.appendChild(sheet);
  let current = null, isOpen = false, sleeping = false, tab = null, notice = '', noticeRed = false, mapCanvas = null;
  const meds = [];            // { hp, rate } heal-over-time entries, ticked in update once the sheet is closed
  let pendingLock = 0;        // movement lock applied on close (using meds takes time)
  const snd = (n, g = 0.5) => ctx.audio.play(n, { gain: g });
  const D = () => ctx.state.data;
  const say = (t, red = false) => { notice = t; noticeRed = red; };
  const storage = () => { const d = D(); if (!d.storage) d.storage = { items: {}, weapons: [] }; if (!d.storage.ammo) d.storage.ammo = {}; if (!d.storage.items) d.storage.items = {}; if (!d.storage.weapons) d.storage.weapons = []; return d.storage; };
  const activeMissions = () => { const a = ctx.missions?.active; return Array.isArray(a) ? a : a ? [a] : []; };
  const freeSlot = () => ctx.inventory.slots.some((s) => s == null);

  root.addEventListener('mousedown', () => ctx.audio.resume());
  window.addEventListener('keydown', (e) => {
    if (!isOpen || sleeping) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && PANELS[current]?.tabs) {
      const tabs = PANELS[current].tabs, i = tabs.indexOf(tab);
      tab = tabs[(i + (e.code === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; snd('ui_click', 0.35); render(); return;
    }
    navigate(e, sheet);
  });

  // ---------- rendering scaffold ----------
  function frame(cls, head, right, bodyHtml, footL, footR, title = '') {
    sheet.className = `sheet center ${cls}`;
    sheet.innerHTML = `<div class="hd"><span>${head}</span><span class="r">${right}</span></div>${title}<div class="body">${bodyHtml}</div>` +
      `<div class="ft"><span>${footL}</span><span>${footR}</span></div>`;
  }
  const noticeHtml = () => `<div class="notice ${noticeRed ? 'red' : ''}">${esc(notice)}</div>`;
  const sec = (t, n, inner) => `<div class="sec"><div class="sec-t">${t}${n != null ? `<span class="n">${n}</span>` : ''}</div>${inner}</div>`;
  const row = (k, num, cls = '') => `<div class="row ${cls}"><div class="k">${k}</div><div class="num">${num}</div></div>`;
  const row3 = (k, num, acts, cls = '') => `<div class="row three ${cls}"><div class="k">${k}</div><div class="num">${num}</div><div class="acts">${acts}</div></div>`;
  const act = (a, label, opts = {}) => `<button class="act ${opts.deny ? 'deny' : ''}" data-a="${a}" ${opts.disabled ? 'disabled' : ''}>${label}</button>`;
  const tabsHtml = (list, counts = {}) => `<div class="tabs">${list.map((t) => `<button class="tab ${t === tab ? 'on' : ''}" data-a="tab:${t}">${t}${counts[t] ? `<span class="n">${counts[t]}</span>` : ''}</button>`).join('')}</div>`;
  const dayLine = () => `Day ${D().day} · ${ctx.time.clockText()}`;
  const KEYS = 'Esc close · ↑↓ select · Enter confirm · 1–9 pick';

  // ---------- inventory (I) ----------
  function weaponBlock(w, actions) {
    const def = WEAPON_DEFS[w.id]; const slot = ctx.inventory.slots.indexOf(w.uid);
    const foul = Math.round(w.dirt * 100);
    return `<div class="wpn"><div class="name"><b>${esc(def.full)}</b><span>${slot >= 0 ? `slot ${slot + 1}` : 'unassigned'} · ${AMMO[def.ammo].name}</span></div>` +
      `<div class="facts"><span>loaded <b>${loadedText(w)}</b></span><span>fouling <b class="${foul > 50 ? 'red' : ''}">${foul} %</b></span>${w.jammed ? '<span class="jam">JAMMED</span>' : '<span>action <b>serviceable</b></span>'}</div>` +
      (actions ? `<div class="acts" style="text-align:left;margin-bottom:6px">${actions}</div>` : '') + `</div>`;
  }
  function renderInventory() {
    const d = D(), inv = ctx.inventory;
    const cond = row('Condition' + (d.bleeding ? '<span class="tag red">bleeding</span>' : ''), `<span class="${d.hp < 30 ? 'red' : ''}">${Math.round(d.hp)}</span><span class="u">/ 100</span>`) +
      row('Stamina', `${Math.round(d.stamina)}<span class="u">/ 100</span>`) +
      row('Torch battery', `${Math.round(d.flashlight.battery)}<span class="u">%</span>`) +
      row('Contract funds', money(d.money));
    const weapons = inv.weapons.length ? inv.weapons.map((w) => weaponBlock(w, inv.count('cleankit') > 0 && w.dirt > 0.02 ? act(`kitclean:${w.uid}`, 'Field-strip · cleaning kit') : '')).join('') : '<div class="empty">No weapons carried.</div>';
    const cals = Object.keys(AMMO).filter((c) => inv.ammoCount(c) > 0 || inv.weapons.some((w) => WEAPON_DEFS[w.id].ammo === c));
    const ammo = cals.length ? cals.map((c) => row(AMMO[c].name, `${inv.ammoCount(c)}<span class="u">rounds</span>`, inv.ammoCount(c) === 0 ? 'dim' : '')).join('') : '<div class="empty">No ammunition carried.</div>';
    const itemIds = Object.keys(inv.items).filter((id) => ITEMS[id] && ITEMS[id].kind !== 'artifact' && inv.count(id) > 0);
    const items = itemIds.length ? itemIds.map((id) => {
      const it = ITEMS[id], n = inv.count(id); let a = '';
      if (it.kind === 'med') a = act(`use:${id}`, 'Use');
      else if (id === 'battery') a = act('install', 'Install', { disabled: d.flashlight.battery >= 99.5 });
      return row3(`${esc(it.name)}<span class="sub">${esc(it.desc)}${id === 'probe' ? ' Throw with G.' : ''}</span>`, `${n}<span class="u">×</span>`, a);
    }).join('') : '<div class="empty">Kit bag empty.</div>';
    const arts = inv.artifacts();
    const artifacts = arts.length ? arts.map(([id, n]) => row(`${esc(ITEMS[id].name)}<span class="sub">${esc(ITEMS[id].desc)}</span>`, `${n > 1 ? `${n} × ` : ''}${money(ITEMS[id].price)}`)).join('') : '<div class="empty">None recovered.</div>';
    frame('inv-card', 'UNPSC · Kit manifest · Form 61-K', `Explorer ${d.explorer} · ${dayLine()}`,
      sec('Condition', null, cond) + sec('Weapons', inv.weapons.length, weapons) + sec('Ammunition', null, ammo) + sec('Items', itemIds.length, items) + sec('Artifacts', arts.length, artifacts) + noticeHtml(),
      KEYS, `Tide in <b>${ctx.time.tideInText()}</b> · Funds <b>${money(d.money)}</b>`, '<h1>Kit manifest<small>carried</small></h1>');
  }
  const invHandlers = {
    use(id) {
      const inv = ctx.inventory, p = ctx.player; if (!inv.has(id)) return false;
      if (id === 'bandage') { inv.remove(id); p.stopBleeding(); p.heal(10); pendingLock = Math.max(pendingLock, ITEMS.bandage.use); say('Bandage applied. Bleeding stopped.'); render(); return 'bandage_use'; }
      if (id === 'medkit') { inv.remove(id); meds.push({ hp: 45, rate: 45 / 8 }); pendingLock = Math.max(pendingLock, ITEMS.medkit.use); say('Field medkit applied. Effect over eight seconds.'); render(); return 'medkit_use'; }
      if (id === 'stim') { inv.remove(id); p.addStamina(100); p.heal(5); pendingLock = Math.max(pendingLock, ITEMS.stim.use); say('Stimulant administered.'); render(); return 'stim_use'; }
      return false;
    },
    install() { const d = D(); if (!ctx.inventory.has('battery')) return false; ctx.inventory.remove('battery'); d.flashlight.battery = 100; say('Battery cell installed. Torch at 100 %.'); render(); return 'ui_click'; },
    kitclean(uid) { const w = ctx.inventory.weaponByUid(+uid); if (!w || !ctx.inventory.has('cleankit')) return false; ctx.inventory.remove('cleankit'); w.dirt = 0; w.jammed = false; ctx.weapons.onInventoryChanged?.(); say(`${weaponName(w)} field-stripped and oiled. Kit expended.`); render(); return 'ui_click'; },
  };

  // ---------- terminal ----------
  function missionHtml(m, active) {
    const code = esc(m.code || m.id || 'PSC-0000'), title = esc(m.title || m.name || '');
    // the record's own closing sentence ("Payment 1,800 ₽ on delivery.") becomes the figure line so it is not printed twice
    let body = String(m.body || m.text || m.desc || ''); const pm = body.match(/\s*(Payment [^.]*\.)\s*$/);
    if (pm) body = body.slice(0, pm.index);
    const pay = m.payment ?? m.reward ?? 0; const status = m.status || (active ? 'in progress' : 'posted');
    const payLine = pm ? esc(pm[1]).replace(/(\d),(?=\d{3})/g, '$1' + THIN).replace(/(\S+ ₽)/, '<b>$1</b>') : `Payment <b>${money(pay)}</b> on delivery.`;
    const reqs = Array.isArray(m.requirements) && m.requirements.length ? `<div class="req">${m.requirements.map(esc).join(' · ')}</div>` : '';
    const canDeliver = active && (ctx.missions.deliverable?.(m) === true || m.status === 'complete' || m.status === 'ready');
    const action = active ? (canDeliver ? act(`deliver:${m.id}`, 'Deliver') : `<span class="dimink" style="font-size:10px;letter-spacing:.16em;text-transform:uppercase">${esc(status)}</span>`) : act(`accept:${m.id}`, 'Accept');
    return `<div class="mission"><div class="code">${code}${title ? ` / ${title}` : ''}${active ? `<span class="st">${canDeliver ? 'ready for delivery' : 'active'}</span>` : ''}</div><div class="text">${esc(body)}</div>${reqs}<div class="pay"><span>${payLine}</span>${action}</div></div>`;
  }
  function renderTerminal() {
    const d = D();
    const active = activeMissions(), avail = (ctx.missions?.available?.() || []).filter((m) => !active.some((a) => a.id === m.id));
    let body = '';
    if (tab === 'missions') {
      body = sec('Active contracts', active.length, active.length ? active.map((m) => missionHtml(m, true)).join('') : '<div class="empty">No contract active.</div>') +
        sec('Posted', avail.length, avail.length ? avail.map((m) => missionHtml(m, false)).join('') : '<div class="empty">No contracts posted. The board is updated after each Tide.</div>');
    } else if (tab === 'sell') {
      const inv = ctx.inventory, arts = inv.artifacts();
      const others = Object.keys(inv.items).filter((id) => ITEMS[id] && ITEMS[id].kind !== 'artifact' && ITEMS[id].kind !== 'mission' && ITEMS[id].price > 0 && inv.count(id) > 0);
      body = sec('Artifacts · Committee purchase', arts.length, arts.length ? arts.map(([id, n]) => row3(`${esc(ITEMS[id].name)}<span class="sub">${esc(ITEMS[id].desc)}</span>`, `${n}<span class="u">×</span> ${money(ITEMS[id].price)}`, act(`sell:${id}`, 'Sell one'))).join('') : '<div class="empty">Nothing to submit. Artifacts are located with the detector, near anomalies.</div>') +
        sec('Surplus · buy-back at 40 %', others.length, others.length ? others.map((id) => row3(esc(ITEMS[id].name), `${inv.count(id)}<span class="u">×</span> ${money(ITEMS[id].price * 0.4)}`, act(`sell:${id}`, 'Sell one'))).join('') : '<div class="empty">No surplus declared.</div>');
    } else {
      const lvl = d.securityLevel, next = lvl >= 3 ? null : lvl === 1 ? 5000 : 15000, prev = lvl === 1 ? 0 : lvl === 2 ? 5000 : 15000;
      const st = d.stats, done = d.missions?.completed?.length || 0;
      body = sec('Clearance', null, `<div class="level"><b>${lvl}</b><span>Security level ${lvl} of 3${next ? ` · level ${lvl + 1} at ${money(next)} earned` : ' · maximum clearance'}</span></div>` +
        (next ? `<div class="bar"><i style="width:${Math.min(100, ((d.earned - prev) / (next - prev)) * 100).toFixed(1)}%"></i></div>` : '') +
        row('Earned to date', money(d.earned)) + row('Contract funds', money(d.money)) + row('Contracts completed', done)) +
        sec('Field record', null, row('Entities neutralised', st.kills) + row('Artifacts recovered', st.artifacts) + row('Rounds expended', st.shots) + row('Distance walked', `${(st.distance / 1000).toFixed(1)}<span class="u">km</span>`) + row('Tides survived', st.tides) + row('Incidents on file', st.deaths)) +
        `<div class="note">Clearance governs requisition. Weapons above the Explorer's level are not issued regardless of funds.</div>`;
    }
    frame('term-card', 'Vanno Outpost · UNPSC Terminal 3', `Explorer ${d.explorer} · Security level ${d.securityLevel}`,
      tabsHtml(PANELS.terminal.tabs, { missions: avail.length + active.length || '' }) + body + noticeHtml(), KEYS + ' · ←→ tabs', `Funds <b>${money(d.money)}</b>`);
  }
  const termHandlers = {
    tab(t) { tab = t; render(); return 'ui_click'; },
    // missions.accept/complete play their own stamp and notify; the handlers only echo the outcome on the sheet
    accept(id) {
      const m = (ctx.missions.available?.() || []).find((x) => String(x.id) === id); if (!m) return false;
      if (ctx.missions.accept(m.id) === false) { say(`${m.code || m.id} not issued. Two contracts may be open at once; conclude one first.`, true); render(); return null; }
      say(`${m.code || m.id} accepted. Terms on file.`); render(); return null;
    },
    deliver(id) {
      const m = activeMissions().find((x) => String(x.id) === id); if (!m) return false;
      if (ctx.missions.complete(m.id) === false) { say(`${m.code || m.id}: conditions not met. See the terms.`, true); render(); return null; }
      say(`${m.code || m.id} closed. ${money(m.payment ?? 0)} credited.`); render(); return 'ui_stamp';
    },
    sell(id) {
      const it = ITEMS[id]; if (!it || !ctx.inventory.has(id)) return false;
      const price = Math.round(it.kind === 'artifact' ? it.price : it.price * 0.4);
      ctx.inventory.remove(id); ctx.inventory.earn(price); say(`${it.name} received. ${money(price)} credited.`); render(); return 'ui_buy';
    },
  };

  // ---------- workbench ----------
  function renderWorkbench() {
    const d = D(), inv = ctx.inventory;
    const weapons = inv.weapons.length ? inv.weapons.map((w) => {
      const def = WEAPON_DEFS[w.id]; const need = w.mags.reduce((s, m) => s + (def.magSize - m), 0), have = inv.ammoCount(def.ammo);
      return weaponBlock(w, act(`clean:${w.uid}`, 'Clean', { disabled: w.dirt < 0.005 }) + act(`load:${w.uid}`, 'Load magazines', { disabled: need === 0 || have === 0, deny: need > 0 && have === 0 }) + act(`unjam:${w.uid}`, 'Clear jam', { disabled: !w.jammed }));
    }).join('') : '<div class="empty">Nothing on the bench.</div>';
    const cals = Object.keys(AMMO).filter((c) => inv.ammoCount(c) > 0 || inv.weapons.some((w) => WEAPON_DEFS[w.id].ammo === c));
    const ammo = cals.length ? cals.map((c) => row(AMMO[c].name, `${inv.ammoCount(c)}<span class="u">loose</span>`, inv.ammoCount(c) === 0 ? 'dim' : '')).join('') : '<div class="empty">No loose ammunition.</div>';
    frame('bench-card', 'Vanno Outpost · Workbench', `Field maintenance · Explorer ${d.explorer}`,
      sec('Weapons', inv.weapons.length, weapons) + sec('Loose ammunition', null, ammo) + `<div class="note">Fouling raises the chance of a stoppage with every round. A stripped weapon starts clean.</div>` + noticeHtml(),
      KEYS, dayLine());
  }
  const benchHandlers = {
    clean(uid) { const w = ctx.inventory.weaponByUid(+uid); if (!w) return false; w.dirt = 0; ctx.weapons.onInventoryChanged?.(); say(`${weaponName(w)}: field-stripped and oiled.`); render(); return 'ui_click'; },
    load(uid) {
      const w = ctx.inventory.weaponByUid(+uid); if (!w) return false; const def = WEAPON_DEFS[w.id];
      const n = ctx.inventory.fillMags(w); ctx.weapons.onInventoryChanged?.();
      if (n === 0) { say(`${weaponName(w)}: nothing to load. No loose ${AMMO[def.ammo].name}.`, true); render(); return false; }
      say(`${weaponName(w)}: ${n} round${n === 1 ? '' : 's'} of ${AMMO[def.ammo].name} loaded into magazines.`); render(); return 'ui_click';
    },
    unjam(uid) { const w = ctx.inventory.weaponByUid(+uid); if (!w || !w.jammed) return false; w.jammed = false; ctx.weapons.onInventoryChanged?.(); say(`${weaponName(w)}: stoppage cleared.`); render(); return 'ui_click'; },
  };

  // ---------- supply crate ----------
  function renderSupply() {
    const d = D(), inv = ctx.inventory, funds = d.money;
    const line = (a, name, sub, price, ok) => `<button class="btn ${ok ? '' : 'deny'}" data-a="${a}">${esc(name)}${sub ? ` <span class="dimink" style="text-transform:none;letter-spacing:0">· ${esc(sub)}</span>` : ''}<span class="price">${money(price)}</span></button>`;
    let body = '';
    if (tab === 'buy') {
      const ammo = Object.entries(AMMO).map(([c, a]) => line(`buy:ammo:${c}`, `${a.name} · 10 rounds`, `carried ${inv.ammoCount(c)}`, a.price * 10, funds >= a.price * 10)).join('');
      const med = Object.entries(ITEMS).filter(([, it]) => it.kind === 'med').map(([id, it]) => line(`buy:item:${id}`, it.name, it.desc, it.price, funds >= it.price)).join('');
      const tools = Object.entries(ITEMS).filter(([, it]) => it.kind === 'tool').map(([id, it]) => { const q = BUNDLE[id] || 1; return line(`buy:item:${id}`, q > 1 ? `${it.name} · ${q}` : it.name, `${it.desc}${q > 1 ? ` carried ${inv.count(id)}` : ''}`, it.price * q, funds >= it.price * q); }).join('');
      const weapons = Object.entries(WEAPON_DEFS).map(([id, w]) => w.level <= d.securityLevel
        ? line(`buy:weapon:${id}`, w.full, `${AMMO[w.ammo].name} · ${w.mags} magazines, loaded`, w.price, funds >= w.price && freeSlot())
        : `<button class="btn" disabled>${esc(w.full)} <span class="dimink" style="text-transform:none;letter-spacing:0">· security level ${w.level} required</span><span class="price">${money(w.price)}</span></button>`).join('');
      body = sec('Ammunition', null, ammo) + sec('Medical', null, med) + sec('Tools', null, tools) + sec('Weapons', null, weapons) +
        `<div class="note">Requisitions are deducted from contract funds. Weapons occupy one of four carry slots; store one at the locker to make room.</div>`;
    } else {
      const wl = inv.weapons.map((w) => line(`sell:weapon:${w.uid}`, WEAPON_DEFS[w.id].full, `loaded ${loadedText(w)}`, WEAPON_DEFS[w.id].price * 0.4, true)).join('');
      const al = Object.keys(AMMO).filter((c) => inv.ammoCount(c) > 0).map((c) => { const n = Math.min(10, inv.ammoCount(c)); return line(`sell:ammo:${c}`, `${AMMO[c].name} · ${n} rounds`, `carried ${inv.ammoCount(c)}`, AMMO[c].price * n * 0.4, true); }).join('');
      const il = Object.keys(inv.items).filter((id) => ITEMS[id] && ITEMS[id].kind !== 'artifact' && ITEMS[id].kind !== 'mission' && ITEMS[id].price > 0 && inv.count(id) > 0).map((id) => line(`sell:item:${id}`, ITEMS[id].name, `carried ${inv.count(id)}`, ITEMS[id].price * 0.4, true)).join('');
      body = sec('Weapons', null, wl || '<div class="empty">No weapons carried.</div>') + sec('Ammunition', null, al || '<div class="empty">No ammunition carried.</div>') + sec('Items', null, il || '<div class="empty">Nothing to return.</div>') +
        `<div class="note">Buy-back at 40 % of list. Artifacts are submitted at the terminal, not here.</div>`;
    }
    frame('supply-card', 'Vanno Outpost · Supply crate', `Explorer ${d.explorer} · Security level ${d.securityLevel}`,
      tabsHtml(PANELS.supply.tabs) + body + noticeHtml(), KEYS + ' · ←→ tabs', `Funds <b>${money(d.money)}</b>`);
  }
  const supplyHandlers = {
    tab(t) { tab = t; render(); return 'ui_click'; },
    buy(arg) {
      const [kind, id] = arg.split(':'); const inv = ctx.inventory;
      if (kind === 'ammo') { const a = AMMO[id]; const p = a.price * 10; if (!inv.spend(p)) { say('Insufficient funds.', true); render(); return false; } inv.addAmmo(id, 10); say(`10 rounds of ${a.name} issued. ${money(p)} deducted.`); render(); return 'ui_buy'; }
      if (kind === 'item') { const it = ITEMS[id], q = BUNDLE[id] || 1, p = it.price * q; if (!inv.spend(p)) { say('Insufficient funds.', true); render(); return false; } inv.add(id, q); say(`${q > 1 ? `${q} × ` : ''}${it.name} issued. ${money(p)} deducted.`); render(); return 'ui_buy'; }
      if (kind === 'weapon') {
        const w = WEAPON_DEFS[id]; if (w.level > D().securityLevel) { say(`Security level ${w.level} required.`, true); render(); return false; }
        if (!freeSlot()) { say('All four carry slots occupied. Store a weapon at the locker first.', true); render(); return false; }
        if (!inv.spend(w.price)) { say('Insufficient funds.', true); render(); return false; }
        inv.addWeapon(makeWeapon(id)); ctx.weapons.onInventoryChanged?.(); say(`${w.full} issued with ${w.mags} loaded magazines. ${money(w.price)} deducted.`); render(); return 'ui_buy';
      }
      return false;
    },
    sell(arg) {
      const [kind, id] = arg.split(':'); const inv = ctx.inventory;
      if (kind === 'weapon') { const w = inv.removeWeapon(+id); if (!w) return false; const p = Math.round(WEAPON_DEFS[w.id].price * 0.4); inv.earn(p); ctx.weapons.onInventoryChanged?.(); say(`${WEAPON_DEFS[w.id].full} returned. ${money(p)} credited.`); render(); return 'ui_buy'; }
      if (kind === 'ammo') { const n = Math.min(10, inv.ammoCount(id)); if (n <= 0) return false; inv.takeAmmo(id, n); const p = Math.round(AMMO[id].price * n * 0.4); inv.earn(p); ctx.events.emit('inventoryChanged', { id, delta: -n }); say(`${n} rounds of ${AMMO[id].name} returned. ${money(p)} credited.`); render(); return 'ui_buy'; }
      if (kind === 'item') { if (!inv.has(id)) return false; inv.remove(id); const p = Math.round(ITEMS[id].price * 0.4); inv.earn(p); say(`${ITEMS[id].name} returned. ${money(p)} credited.`); render(); return 'ui_buy'; }
      return false;
    },
  };

  // ---------- storage locker ----------
  function renderStorage() {
    const d = D(), inv = ctx.inventory, st = storage();
    const col = (title, weapons, ammo, items, dir) => {
      const arrow = dir === 'in' ? 'Stow' : 'Take';
      const wl = weapons.length ? weapons.map((w) => row3(`${esc(WEAPON_DEFS[w.id].full)}<span class="sub">loaded ${loadedText(w)} · fouling ${Math.round(w.dirt * 100)} %${w.jammed ? ' · jammed' : ''}</span>`, '', act(`${dir}:weapon:${w.uid}`, arrow, { disabled: dir === 'out' && !freeSlot() }))).join('') : '<div class="empty">None.</div>';
      const cals = Object.keys(ammo).filter((c) => ammo[c] > 0);
      const al = cals.length ? cals.map((c) => row3(AMMO[c].name, `${ammo[c]}<span class="u">rounds</span>`, act(`${dir}:ammo:${c}`, `${arrow} ${Math.min(10, ammo[c])}`))).join('') : '<div class="empty">None.</div>';
      const ids = Object.keys(items).filter((id) => ITEMS[id] && items[id] > 0);
      const il = ids.length ? ids.map((id) => row3(esc(ITEMS[id].name), `${items[id]}<span class="u">×</span>`, act(`${dir}:item:${id}`, arrow))).join('') : '<div class="empty">None.</div>';
      return `<div><div class="sec-t" style="margin-top:4px">${title}</div>` + sec('Weapons', weapons.length, wl) + sec('Ammunition', null, al) + sec('Items', ids.length, il) + '</div>';
    };
    frame('store-card', 'Vanno Outpost · Locker 61', `Explorer ${d.explorer} · ${dayLine()}`,
      `<div class="cols">${col('Carried', inv.weapons, inv.ammo, inv.items, 'in')}${col('Locker', st.weapons, st.ammo, st.items, 'out')}</div>` +
      `<div class="note">Locker contents are not subject to the Tide and are not carried into the Radius. Everything on the Explorer's person is forfeit on incident.</div>` + noticeHtml(),
      KEYS, `Funds <b>${money(d.money)}</b>`);
  }
  function moveThing(dir, kind, id) {
    const inv = ctx.inventory, st = storage();
    if (kind === 'weapon') {
      if (dir === 'in') { const w = inv.removeWeapon(+id); if (!w) return false; st.weapons.push(w); ctx.weapons.onInventoryChanged?.(); say(`${WEAPON_DEFS[w.id].full} stowed.`); }
      else { const i = st.weapons.findIndex((w) => w.uid === +id); if (i < 0) return false; if (!freeSlot()) { say('All four carry slots occupied.', true); render(); return false; } const [w] = st.weapons.splice(i, 1); inv.addWeapon(w); ctx.weapons.onInventoryChanged?.(); say(`${WEAPON_DEFS[w.id].full} taken.`); }
    } else if (kind === 'ammo') {
      if (dir === 'in') { const n = Math.min(10, inv.ammoCount(id)); if (n <= 0) return false; inv.takeAmmo(id, n); st.ammo[id] = (st.ammo[id] || 0) + n; ctx.events.emit('inventoryChanged', { id, delta: -n }); say(`${n} rounds of ${AMMO[id].name} stowed.`); }
      else { const n = Math.min(10, st.ammo[id] || 0); if (n <= 0) return false; st.ammo[id] -= n; if (st.ammo[id] <= 0) delete st.ammo[id]; inv.addAmmo(id, n); say(`${n} rounds of ${AMMO[id].name} taken.`); }
    } else {
      if (dir === 'in') { if (!inv.remove(id, 1)) return false; st.items[id] = (st.items[id] || 0) + 1; say(`${ITEMS[id].name} stowed.`); }
      else { if (!(st.items[id] > 0)) return false; st.items[id] -= 1; if (st.items[id] <= 0) delete st.items[id]; inv.add(id, 1); say(`${ITEMS[id].name} taken.`); }
    }
    render(); return 'ui_click';
  }
  const storeHandlers = { in(a) { const [k, id] = a.split(':'); return moveThing('in', k, id); }, out(a) { const [k, id] = a.split(':'); return moveThing('out', k, id); } };

  // ---------- bed ----------
  function sleepMaths() {
    const d = D(); const h = d.hour; const adv = h < 6.5 ? 7 - h : 24 - h + 7;
    let day = d.day, hour = h + adv; while (hour >= 24) { hour -= 24; day += 1; }
    const now = (day - 1) * 86400 + hour * 3600, tide = (d.tideDay - 1) * 86400 + 5 * 3600;
    return { day, hour, tideAfter: tide - now };
  }
  function renderBed() {
    const d = D(), s = sleepMaths(), before = s.tideAfter <= 0;
    const body = row('Now', `Day ${d.day} · ${ctx.time.clockText()}`) + row('Wake', `Day ${s.day} · ${clockOf(s.hour)}`) +
      row('Tide after waking', before ? '<span class="red">arrives first</span>' : spanText(s.tideAfter)) +
      row('Condition on waking', `${Math.min(100, Math.round(d.hp) + 10)}<span class="u">/ 100</span>`) +
      (before ? `<div class="note red">The Tide arrives before morning. Vanno is sealed; you will be safe. The Radius outside will not be the same.</div>` : `<div class="note">Sleeping records the contract log. Anything left in the Radius stays there.</div>`) +
      `<div class="btns"><button class="btn primary" data-a="sleep">Confirm · sleep until 07:00</button><button class="btn" data-a="cancel">Stay up</button></div>` + noticeHtml();
    frame('bed-card', 'Vanno Outpost · Bunk', `Explorer ${d.explorer}`, body, KEYS, `Tide in <b>${ctx.time.tideInText()}</b>`, '<h1>Sleep until 07:00</h1>');
  }
  const bedHandlers = {
    cancel() { api.close(); return 'ui_close'; },
    sleep() {
      if (sleeping) return false;
      // the sheet sits above the HUD fade in the DOM, so it dims itself while the room goes dark
      sleeping = true; root.classList.add('sleeping'); ctx.hud.fadeOut(); snd('sleep', 0.8);
      const gen = D();
      setTimeout(() => {
        sleeping = false; root.classList.remove('sleeping');
        if (D() !== gen) return;   // a new game replaced the state mid-fade; abandon quietly
        ctx.time.sleepToMorning(); ctx.player.heal(10); ctx.director.rest(); ctx.state.save(); ctx.events.emit('sleep');
        api.close();
        setTimeout(() => { ctx.hud.fadeIn(); ctx.hud.notify(`Log recorded. Day ${D().day}, ${ctx.time.clockText()}. Tide in ${ctx.time.tideInText()}.`, { code: 'Vanno · Bunk' }); }, 500);
      }, 1400);
      return 'ui_click';
    },
  };

  // ---------- map (M) ----------
  function missionTarget(m) {
    if (!m) return null;
    const t = m.target || m.position || m.pos || m.at;
    if (t && typeof t.x === 'number') return { x: t.x, z: t.z ?? t.y };
    const poiId = m.poi || m.poiId || m.location; const p = poiId && ctx.world.map.poi(typeof poiId === 'string' ? poiId : poiId.id);
    return p ? { x: p.x, z: p.z } : null;
  }
  function drawMap(cv) {
    const M = ctx.world.map, dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = cv.clientWidth; cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const margin = 38, scale = (S - margin * 2) / M.SIZE, fs = Math.max(7.5, Math.min(11, S / 64));   // label size follows the sheet
    // a label that stays inside the frame: measured, flipped or clamped when it would run off the edge
    const label = (text, x, y, align = 'left') => {
      const w = g.measureText(text).width;
      let lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      if (align === 'left' && lx + w > S - margin - 2) lx = x - 18 - w;   // flip to the other side of the symbol
      lx = Math.max(margin + 2, Math.min(S - margin - 2 - w, lx));
      g.textAlign = 'left'; g.fillText(text, lx, y);
    };
    const X = (x) => margin + (x + M.HALF) * scale, Y = (z) => margin + (z + M.HALF) * scale;
    let seed = 1987; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const INK = 'rgba(26,25,23,';
    g.fillStyle = '#d6d0c0'; g.fillRect(0, 0, S, S);
    // stock speckle
    for (let i = 0; i < 2600; i++) { g.fillStyle = INK + (0.03 + rnd() * 0.06) + ')'; g.fillRect(rnd() * S, rnd() * S, 1, 1); }
    // grid every 100 m with coordinates
    g.strokeStyle = INK + '0.14)'; g.lineWidth = 1; g.font = '9px "IBM Plex Mono", monospace'; g.fillStyle = INK + '0.5)';
    for (let v = -300; v <= 300; v += 100) {
      const px = Math.round(X(v)) + 0.5, py = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(px, margin); g.lineTo(px, S - margin); g.moveTo(margin, py); g.lineTo(S - margin, py); g.stroke();
      g.textAlign = 'center'; g.fillText(String(v).replace('-', '−'), px, margin - 8);
      g.textAlign = 'right'; g.fillText(String(v).replace('-', '−'), margin - 6, py + 3);
    }
    g.strokeStyle = INK + '0.55)'; g.strokeRect(margin + 0.5, margin + 0.5, S - margin * 2, S - margin * 2);
    const wob = (v) => v + (rnd() - 0.5) * 1.6;
    const poly = (pts, dash, width, alpha) => {
      g.setLineDash(dash); g.lineWidth = width; g.strokeStyle = INK + alpha + ')'; g.beginPath();
      pts.forEach(([x, z], i) => { const px = wob(X(x)), py = wob(Y(z)); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke(); g.setLineDash([]);
    };
    // marsh: stippled blob, denser toward the centre; vents drawn as short wavers
    const marsh = M.poi('marsh'), vents = M.poi('vents');
    for (let i = 0; i < 900; i++) { const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * marsh.r * scale * (0.85 + 0.3 * Math.sin(a * 3 + 1)); g.fillStyle = INK + (0.22 + rnd() * 0.2) + ')'; g.fillRect(X(marsh.x) + Math.cos(a) * r, Y(marsh.z) + Math.sin(a) * r * 0.8, 1.2, 1.2); }
    g.strokeStyle = INK + '0.5)'; g.lineWidth = 0.8;
    for (let i = 0; i < 14; i++) { const cx = X(vents.x) + (rnd() - 0.5) * vents.r * scale * 1.4, cy = Y(vents.z) + (rnd() - 0.5) * vents.r * scale * 1.4; g.beginPath(); for (let k = 0; k <= 6; k++) g.lineTo(cx + k * 1.6, cy + Math.sin(k * 1.9) * 1.4); g.stroke(); }
    // dead forest: sparse bare marks
    const forest = M.poi('forest');
    for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * forest.r * scale; const cx = X(forest.x) + Math.cos(a) * r, cy = Y(forest.z) + Math.sin(a) * r; g.beginPath(); g.moveTo(cx, cy + 3); g.lineTo(cx, cy - 2); g.moveTo(cx, cy); g.lineTo(cx - 2, cy - 3); g.moveTo(cx, cy - 1); g.lineTo(cx + 2, cy - 4); g.stroke(); }
    // ridge: three hatched contour arcs along the north edge
    const ridge = M.poi('north'); g.strokeStyle = INK + '0.45)';
    for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = -ridge.r * 1.6; x <= ridge.r * 1.6; x += 6) { const px = X(ridge.x + x), py = Y(ridge.z + 8 + k * 9 + Math.sin(x * 0.07 + k) * 4 + Math.abs(x) * 0.12); x === -ridge.r * 1.6 ? g.moveTo(px, py) : g.lineTo(px, py); } g.stroke(); }
    // roads dashed, rail hatched
    for (const r of M.ROADS) poly(r.pts, [5, 3], r.width > 4.5 ? 1.6 : 1.1, 0.72);
    poly(M.RAIL.pts, [], 1.2, 0.75);
    g.strokeStyle = INK + '0.7)'; g.lineWidth = 1;
    for (let i = 0; i < M.RAIL.pts.length - 1; i++) {
      const [ax, az] = M.RAIL.pts[i], [bx, bz] = M.RAIL.pts[i + 1]; const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let t = 0; t < len; t += 9) { const x = ax + (bx - ax) * (t / len), z = az + (bz - az) * (t / len); g.beginPath(); g.moveTo(X(x + nx * 2.4), Y(z + nz * 2.4)); g.lineTo(X(x - nx * 2.4), Y(z - nz * 2.4)); g.stroke(); }
    }
    // points of interest
    g.font = `${fs}px "IBM Plex Mono", monospace`; g.textAlign = 'left';
    for (const p of M.POIS) {
      const px = X(p.x), py = Y(p.z); g.strokeStyle = INK + '0.85)'; g.fillStyle = INK + '0.85)'; g.lineWidth = 1.1; g.setLineDash([]);
      let lx = px + 9, ly = py + 4, al = 'left';
      switch (p.kind) {
        case 'base': g.strokeRect(px - 5, py - 5, 10, 10); g.fillRect(px - 1.5, py - 1.5, 3, 3); break;
        case 'checkpoint': g.beginPath(); g.moveTo(px - 6, py); g.lineTo(px + 6, py); g.moveTo(px - 6, py - 3); g.lineTo(px - 6, py + 3); g.moveTo(px + 6, py - 3); g.lineTo(px + 6, py + 3); g.stroke(); break;
        case 'convoy': for (let k = -1; k <= 1; k++) g.strokeRect(px - 3 + k * 5, py - 2 + k * 3, 5, 3); break;
        case 'village': for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.4, r = 4 + (k % 3) * 4; g.strokeRect(px + Math.cos(a) * r - 2, py + Math.sin(a) * r * 0.7 - 2, 4, 4); } al = 'center'; lx = px; ly = py - 12; break;
        case 'industrial': g.beginPath(); g.moveTo(px - 6, py + 5); g.lineTo(px - 6, py - 3); g.lineTo(px - 2, py - 6); g.lineTo(px + 2, py - 3); g.lineTo(px + 6, py - 6); g.lineTo(px + 6, py + 5); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(px - 8, py - 8); g.lineTo(px + 8, py - 8); g.stroke(); break;
        case 'church': g.beginPath(); g.moveTo(px, py - 9); g.lineTo(px, py + 6); g.moveTo(px - 4, py - 5); g.lineTo(px + 4, py - 5); g.stroke(); g.strokeRect(px - 4, py + 1, 8, 5); break;
        case 'rail': lx = px + 9; ly = py - 8; break;
        case 'anomaly': g.setLineDash([2, 3]); g.beginPath(); g.arc(px, py, p.r * scale * 0.55, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.beginPath(); g.arc(px, py, 1.6, 0, Math.PI * 2); g.fill();
          al = 'center'; lx = px; ly = p.id === 'vents' ? py + p.r * scale * 0.55 + fs + 2 : py - p.r * scale * 0.55 - 4; break;   // the vents sit under the marsh label, so theirs hangs below
        case 'marsh': al = 'center'; lx = px; ly = py + p.r * scale * 0.8 + fs + 3; break;   // under the stipple, clear of the ink
        case 'forest': al = 'center'; lx = px; ly = py - forest.r * scale - 4; break;
        case 'ridge': al = 'center'; lx = px; ly = py + 26; break;
      }
      g.fillStyle = INK + (p.kind === 'anomaly' || p.kind === 'marsh' ? '0.6)' : '0.88)');
      label(p.name, lx, ly, al);
    }
    // the Column: an arrow at the top edge toward its bearing
    const cx = X(M.COLUMN.x); g.strokeStyle = INK + '0.8)'; g.fillStyle = INK + '0.8)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx, margin - 14); g.lineTo(cx, margin - 32); g.moveTo(cx - 4, margin - 27); g.lineTo(cx, margin - 32); g.lineTo(cx + 4, margin - 27); g.stroke();
    g.font = '9px "IBM Plex Mono", monospace'; label(`THE COLUMN · ${((M.COLUMN.z - 0) / -1000).toFixed(1)} km`, cx + 8, margin - 20);
    // north mark and scale bar
    g.textAlign = 'center'; g.font = '11px "Oswald", "Arial Narrow", sans-serif'; g.fillText('N', S - margin + 16, margin + 12);
    g.beginPath(); g.moveTo(S - margin + 16, margin + 32); g.lineTo(S - margin + 16, margin + 16); g.moveTo(S - margin + 13, margin + 20); g.lineTo(S - margin + 16, margin + 16); g.lineTo(S - margin + 19, margin + 20); g.stroke();
    g.lineWidth = 1; g.beginPath(); g.moveTo(margin, S - margin + 14); g.lineTo(margin + 100 * scale, S - margin + 14); g.moveTo(margin, S - margin + 11); g.lineTo(margin, S - margin + 17); g.moveTo(margin + 100 * scale, S - margin + 11); g.lineTo(margin + 100 * scale, S - margin + 17); g.stroke();
    g.font = '9px "IBM Plex Mono", monospace'; g.textAlign = 'left'; g.fillText('100 m', margin + 100 * scale + 6, S - margin + 17);
    // active mission target: amber cross
    const target = missionTarget(activeMissions()[0]);
    if (target) { const tx = X(target.x), ty = Y(target.z); g.strokeStyle = '#a8672a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(tx - 6, ty - 6); g.lineTo(tx + 6, ty + 6); g.moveTo(tx + 6, ty - 6); g.lineTo(tx - 6, ty + 6); g.stroke(); g.beginPath(); g.arc(tx, ty, 10, 0, Math.PI * 2); g.stroke(); }
    // the Explorer: a pencil circle with a heading tick
    const p = ctx.player.position, px = X(p.x), py = Y(p.z), yaw = ctx.player.yaw;
    g.strokeStyle = INK + '0.95)'; g.lineWidth = 1.4; g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(px - Math.sin(yaw) * 4, py - Math.cos(yaw) * 4); g.lineTo(px - Math.sin(yaw) * 11, py - Math.cos(yaw) * 11); g.stroke();
    g.font = '9px "IBM Plex Mono", monospace'; g.fillStyle = INK + '0.9)'; label('E61', px + 7, py + 10);
  }
  function renderMap() {
    const d = D(); const size = Math.round(Math.max(220, Math.min(window.innerHeight * 0.88 - 150, window.innerWidth * 0.62, 760)));   // 150: header, legend, contract line, footer, padding
    const m = activeMissions()[0], t = missionTarget(m); const p = ctx.player.position;
    const dist = t ? Math.hypot(t.x - p.x, t.z - p.z) : 0;
    const legend = `<div class="legend"><span>— — road</span><span>┼┼ rail</span><span>· · · marsh</span><span>◌ anomaly field</span><span>○ Explorer 61</span><span class="amb">× contract objective</span></div>`;
    const missionLine = m ? `<div class="note" style="margin:6px 0 0"><span class="amb">${esc(m.code || m.id)}</span> ${esc(m.title || '')}${t ? ` · ${dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`} from position` : ''}</div>` : '';
    sheet.className = 'sheet center tilt map-card';
    sheet.innerHTML = `<div class="hd"><span>Pechorsk Restricted Zone · Sheet 61 · Vanno sector</span><span class="r">Grid 100 m · north up · ${dayLine()}</span></div><canvas style="width:${size}px;height:${size}px"></canvas>${legend}${missionLine}<div class="ft"><span>Esc close · M close</span><span>Explorer ${d.explorer} · Tide in <b>${ctx.time.tideInText()}</b></span></div>`;
    mapCanvas = sheet.querySelector('canvas');
    drawMap(mapCanvas);
  }

  const PANELS = {
    inventory: { render: renderInventory, handlers: invHandlers },
    terminal: { render: renderTerminal, handlers: termHandlers, tabs: ['missions', 'sell', 'status'] },
    workbench: { render: renderWorkbench, handlers: benchHandlers },
    supply: { render: renderSupply, handlers: supplyHandlers, tabs: ['buy', 'sell'] },
    storage: { render: renderStorage, handlers: storeHandlers },
    bed: { render: renderBed, handlers: bedHandlers },
    map: { render: renderMap, handlers: {} },
  };

  function render() {
    const P = PANELS[current]; if (!P) return;
    keepFocus(sheet, () => { P.render(); bindActions(sheet, P.handlers, snd); });
  }

  const api = {
    get isOpen() { return isOpen; }, get current() { return current; },
    open(name, data = {}) {
      const P = PANELS[name]; if (!P) return;
      if (!isOpen) { ctx.input.enabled = false; ctx.input.releaseAll?.(); ctx.input.unlock(); ctx.hud.setGameVisible(false); }
      ctx.audio.resume(); snd('ui_open', 0.5);
      isOpen = true; current = name; notice = ''; noticeRed = false; tab = P.tabs ? (P.tabs.includes(data.tab) ? data.tab : P.tabs[0]) : null;
      root.classList.add('on'); sheet.style.display = '';
      P.render(); bindActions(sheet, P.handlers, snd);
      const first = focusables(sheet).find((e) => !e.classList.contains('tab')) || focusables(sheet)[0]; first?.focus({ preventScroll: true });
    },
    close() {
      if (!isOpen || sleeping) return;
      isOpen = false; current = null; mapCanvas = null;
      root.classList.remove('on'); sheet.style.display = 'none'; sheet.innerHTML = '';
      snd('ui_close', 0.45);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (ctx.mode === 'playing') { ctx.input.enabled = true; ctx.input.lock(); ctx.hud.setGameVisible(true); }
      if (pendingLock > 0) { ctx.player.lockMovement(pendingLock); pendingLock = 0; }
    },
    update(dt) {
      if (isOpen || ctx.mode !== 'playing' || ctx.player.dead) return;
      for (let i = meds.length - 1; i >= 0; i--) {
        const m = meds[i]; const a = Math.min(m.hp, m.rate * dt); ctx.player.heal(a); m.hp -= a;
        if (m.hp <= 0.001) meds.splice(i, 1);
      }
    },
  };
  sheet.style.display = 'none';
  // a new contract, a respawn or a Tide voids anything queued
  const clearQueue = () => { meds.length = 0; pendingLock = 0; };
  ctx.events.on('gameStart', () => { if (isOpen && !sleeping) api.close(); clearQueue(); });
  ctx.events.on('respawn', clearQueue);
  ctx.events.on('tide', clearQueue);
  ctx.events.on('playerDied', () => { if (isOpen && !sleeping) api.close(); clearQueue(); });
  return api;
}
