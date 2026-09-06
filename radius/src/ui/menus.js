// Title / pause / settings / death screens. Committee forms laid over the live view: paper, ink, one stamp.
// Also the paper helpers the base panel modules (ui/panel_*.js) share: money, escaping, focus walking, action wiring,
// and the small panel kit (notice / refresh / sound with graceful fallbacks when the router lacks a method).
import { RANKS, def } from '../data/index.js';

// ---- shared helpers ----
export const THIN = ' ';
export const money = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN) + ' ₽';
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clockOf = (hour) => { const h = Math.floor(hour), m = Math.floor((hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
export const kg = (n, digits = 1) => `${(+n || 0).toFixed(digits)}<span class="u">kg</span>`;
export function spanText(seconds) {
  const s = Math.max(0, seconds); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
export const rankOf = (level) => RANKS.find((r) => r.rank === level) || RANKS[RANKS.length - 1];
export const rankTitle = (level) => rankOf(level).title;
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
// [data-a="name:arg"] buttons -> handlers[name](arg, button). Return: sound name | true (click) | false (deny) | null (own sound).
export function bindActions(root, handlers, snd, attr = 'a') {
  for (const b of root.querySelectorAll(`[data-${attr}]`)) {
    b.onclick = () => {
      if (b.disabled) return;
      const [name, ...rest] = b.dataset[attr].split(':');
      const fn = handlers[name]; if (!fn) return;
      const r = fn(rest.join(':'), b);
      if (r === false) snd('ui_deny', 0.5); else if (r !== null) snd(typeof r === 'string' ? r : 'ui_click', 0.45);
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
export function ensureStyle(id, css) { if (document.getElementById(id)) return; const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s); }
// paper fragments shared by the panels
export const sec = (t, n, inner) => `<div class="sec"><div class="sec-t">${t}${n != null && n !== '' ? `<span class="n">${n}</span>` : ''}</div>${inner}</div>`;
export const row = (k, num, cls = '') => `<div class="row ${cls}"><div class="k">${k}</div><div class="num">${num}</div></div>`;
export const row3 = (k, num, acts, cls = '') => `<div class="row three ${cls}"><div class="k">${k}</div><div class="num">${num}</div><div class="acts">${acts}</div></div>`;
export const act = (a, label, opts = {}) => `<button class="act ${opts.deny ? 'deny' : ''} ${opts.cls || ''}" data-x="${a}" ${opts.disabled ? 'disabled' : ''}>${label}</button>`;
export const tabsHtml = (list, on, counts = {}) => `<div class="tabs">${list.map(([id, label]) => `<button class="tab ${id === on ? 'on' : ''}" data-x="tab:${id}">${label}${counts[id] ? `<span class="n">${counts[id]}</span>` : ''}</button>`).join('')}</div>`;
// Panel kit: the router (ui/panels.js) passes api = { close, refresh, notice, open, sound }; every method is optional here.
// S is the module's state bag ({ notice, red, rerender }). fill(root) rebuilds the element in place when refresh is absent.
export function panelKit(ctx, api, S, root, fill, handlers) {
  const snd = (n, g = 0.5) => { if (api?.sound) api.sound(n); else ctx.audio.play(n, { gain: g }); };
  const say = (t, red = false) => { S.notice = t; S.red = red; if (api?.notice) api.notice(t, red); };
  const local = () => api?.notice ? '' : `<div class="notice ${S.red ? 'red' : ''}">${esc(S.notice || '')}</div>`;
  const redo = () => { if (api?.refresh) api.refresh(); else keepFocus(root, () => build()); };
  const build = () => { root.innerHTML = fill(); root.insertAdjacentHTML('beforeend', local()); bindActions(root, handlers, snd, 'x'); };
  S.rerender = redo;
  return { snd, say, redo, build };
}

const ADVISORIES = [
  'Probes reveal anomalies. Throw before you walk.',
  'Entities are heard before they are seen. Stand still and listen.',
  'The Tide does not wait. Watch the clock, not the horizon.',
  'A fouled weapon stops. Strip it at the bench before it matters.',
  'Bleeding does not stop on its own. Carry bandages.',
  'Nothing carried into the Radius is insured. Use the locker.',
  'Armour is class-rated. A vest that stops a pistol will not stop a rifle.',
  'Magazines in the rig reload fast. Magazines in the pack do not.',
];
const CONTROLS = [
  ['WASD', 'move'], ['Shift', 'sprint'], ['C', 'crouch'], ['Mouse', 'look'],
  ['LMB', 'fire'], ['RMB', 'aim'], ['R', 'reload · clear jam'], ['T', 'load magazine'], ['B', 'fire mode'],
  ['F', 'torch'], ['L', 'weapon light'], ['G', 'throw probe'], ['X', 'grenade'], ['V', 'melee'], ['E', 'interact · hold'], ['1–4', 'weapons'],
  ['5', 'detector'], ['6–9', 'quick slots'], ['N', 'binoculars'], ['Tab', 'watch · hold'], ['I', 'kit manifest'], ['M', 'map'], ['Esc', 'suspend'],
];
const CAUSE = {
  bullet: 'Cause: gunshot wounds, multiple.', slash: 'Cause: lacerations consistent with class Slider.', shock: 'Cause: contact with class Fragment.',
  blast: 'Cause: blast trauma.', melee: 'Cause: bite trauma, class Spawn.', anomaly: 'Cause: anomalous exposure.', burn: 'Cause: anomalous exposure.',
  fall: 'Cause: fall. Terrain.', tide: 'Cause: Tide exposure. No remains.', bleed: 'Cause: exsanguination.', grab: 'Cause: contact with class Phantom.',
};
const CAUSE_WHAT = { electric: 'Cause: anomalous discharge.', crush: 'Cause: anomalous compression.', reflector: 'Cause: lacerations, anomalous.', gas: 'Cause: anomalous exposure, respiratory.', fragment: 'Cause: contact with class Fragment.', grenade: 'Cause: fragmentation, grenade.', phantom: 'Cause: contact with class Phantom.', seeker: 'Cause: gunshot wounds, heavy calibre. Class Seeker.' };
const ZONE = { head: 'head', torso: 'torso', stomach: 'abdomen', arms: 'arm', legs: 'leg' };
const QUALITY_TIERS = {
  low: 'resolution 1×, no shadows, no ambient occlusion, no light shafts',
  medium: 'resolution 1.25×, sun shadows, no ambient occlusion, no light shafts',
  high: 'resolution 1.5×, soft shadows, ambient occlusion, volumetric light shafts',
};
const SETTINGS = [
  { key: 'sensitivity', label: 'Look sensitivity', min: 0.3, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) },
  { key: 'fov', label: 'Field of view', sub: 'degrees, hip', min: 60, max: 100, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
  { key: 'music', label: 'Music', sub: 'drone engine', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
  { key: 'grain', label: 'Film grain', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
  { key: 'motion', label: 'Head motion', sub: 'bob and breathing', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %` },
  { key: 'quality', label: 'Render quality', tiers: QUALITY_TIERS, options: ['low', 'medium', 'high'] },
];

export function createMenus(ctx) {
  const ui = document.getElementById('ui');
  const root = document.createElement('div'); root.id = 'menus'; ui.appendChild(root);
  const wash = document.createElement('div'); wash.className = 'wash'; root.appendChild(wash);
  const card = document.createElement('div'); card.className = 'sheet'; root.appendChild(card);
  const advisory = document.createElement('div'); advisory.className = 'advisory'; root.appendChild(advisory);
  let current = null, prev = null, adv = Math.floor(Math.random() * ADVISORIES.length), confirming = false, advT = 0, advSwap = 0;
  const setAdvisory = () => { advisory.innerHTML = `<span class="code">Committee advisory</span>${esc(ADVISORIES[adv])}`; };
  // death typewriter state
  const tw = { lines: [], li: 0, ci: 0, acc: 0, done: false, els: [], btn: null, tick: 0, readyAt: 0 };
  const snd = (n, g = 0.5) => ctx.audio.play(n, { gain: g });
  const S = () => ctx.state.data.settings;

  root.addEventListener('mousedown', () => ctx.audio.resume());
  window.addEventListener('keydown', (e) => {
    if (!current) return;
    ctx.audio.resume();
    if (current === 'death') {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (!tw.done) finishTypewriter(); else if (performance.now() >= tw.readyAt && document.activeElement !== tw.btn) tw.btn?.click(); }
      return;
    }
    if (e.code === 'Escape') {
      // main resumes the game on Esc while paused; here we only need to unwind screens that main does not know about
      if (current === 'settings' && prev === 'title') { api.show('title'); return; }
      if (current === 'pause' && confirming) { confirming = false; renderPause(); return; }
      return;
    }
    if (current === 'settings' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const rowEl = document.activeElement?.closest?.('.stp'); if (rowEl) { stepSetting(rowEl.dataset.key, e.code === 'ArrowRight' ? 1 : -1); return; }
    }
    navigate(e, card);
  });

  // ---------- title ----------
  function renderTitle() {
    const hasSave = ctx.state.hasSave();
    card.className = 'sheet title-card';
    card.innerHTML = `
      <div class="form"><span>UN Pechorsk Special Committee</span><span>Form 61-A</span></div>
      <h1 class="big">Radius</h1>
      <div class="sub">Pechorsk Restricted Zone · UNPSC Contract 61</div>
      <div class="stamp-line"><span class="rubber">Cleared for entry</span></div>
      <div class="btns">
        <button class="btn primary" data-a="begin">Begin contract</button>
        <button class="btn" data-a="continue" ${hasSave ? '' : 'disabled'}>Continue${hasSave ? '' : ' <span class="price">no log on file</span>'}</button>
        <button class="btn" data-a="settings">Settings</button>
      </div>
      <div class="ctl-list">${CONTROLS.map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('')}</div>
      <div class="ft"><span>Explorer 61 · Vanno Outpost</span><span>Rev. 4 · 1987</span></div>`;
    wash.className = 'wash';
    setAdvisory(); advisory.style.display = ''; advisory.classList.remove('swap'); advT = 0;
    bindActions(card, {
      begin() { ctx.game.start(true); return 'ui_stamp'; },
      continue() { if (!ctx.state.hasSave()) return false; ctx.game.start(false); return 'ui_stamp'; },
      settings() { api.show('settings'); return 'ui_open'; },
    }, snd);
  }

  // ---------- pause ----------
  function loadText() {
    const inv = ctx.inventory; if (!inv?.weight) return '';
    const w = inv.weight(), c = inv.capacity ? inv.capacity() : 0;
    return `${w.toFixed(1)} / ${c} kg${w > c ? ' · over capacity' : ''}`;
  }
  function renderPause() {
    const d = ctx.state.data; const a = ctx.missions?.active; const m = Array.isArray(a) ? a[0] : a;
    const over = ctx.inventory?.overweight ? ctx.inventory.overweight() > 0 : false;
    card.className = 'sheet center pause-card';
    const summary = `<div class="sum">
      <div class="kv"><span>Day · time</span><b>Day ${d.day} · ${ctx.time.clockText()}</b></div>
      <div class="kv"><span>Tide</span><b class="${ctx.time.tideIn() < 3600 ? 'red' : ''}">${ctx.time.tideIn() <= 0 ? 'now' : `in ${ctx.time.tideInText()}`}</b></div>
      <div class="kv"><span>Clearance</span><b>${d.securityLevel} · ${esc(rankTitle(d.securityLevel))}</b></div>
      <div class="kv"><span>Contract funds</span><b>${money(d.money)}</b></div>
      <div class="kv"><span>Condition</span><b class="${d.hp < 30 ? 'red' : ''}">${Math.round(d.hp)} / 100${d.bleeding ? ' · bleeding' : ''}</b></div>
      <div class="kv"><span>Load</span><b class="${over ? 'red' : ''}">${esc(loadText())}</b></div>
      <div class="kv"><span>Contract</span><b>${m ? esc((m.code || m.id) + (m.title ? ' / ' + m.title : '')) : 'none active'}</b></div>
    </div>`;
    const body = confirming
      ? `<div class="confirm"><p>Abandon current expedition? Progress since the last sleep is lost.</p><div class="btns"><button class="btn" data-a="abandon">Abandon · return to title</button><button class="btn" data-a="cancel">Cancel</button></div></div>`
      : `<div class="btns"><button class="btn primary" data-a="resume">Resume</button><button class="btn" data-a="settings">Settings</button><button class="btn" data-a="title">Return to title</button></div>`;
    card.innerHTML = `<div class="hd"><span>UNPSC · Explorer ${d.explorer}</span><span class="r">Security level ${d.securityLevel}</span></div><h1>Contract suspended</h1><div class="body">${summary}</div>${body}<div class="ft"><span>Esc resume · arrows select · Enter confirm</span><span>Vanno Outpost</span></div>`;
    wash.className = 'wash full'; advisory.style.display = 'none';
    bindActions(card, {
      resume() { ctx.game.resume(); return 'ui_close'; },
      settings() { api.show('settings'); return 'ui_open'; },
      title() { confirming = true; keepFocus(card, renderPause); return 'ui_click'; },
      cancel() { confirming = false; keepFocus(card, renderPause); return 'ui_click'; },
      abandon() { confirming = false; ctx.game.toTitle(); return 'ui_stamp'; },
    }, snd);
  }

  // ---------- settings ----------
  function applySetting(key, v) {
    const s = S(); s[key] = v;
    if (key === 'sensitivity') ctx.input.sensitivity = v;
    else if (key === 'fov') { ctx.camera.fov = v; ctx.camera.updateProjectionMatrix(); }
    else if (key === 'volume') ctx.audio.setVolume(v);
    else if (key === 'music') ctx.audio.setMusicVolume(v);
    else if (key === 'quality') { ctx.quality = v; ctx.renderApi.quality = v; ctx.renderApi.resize(); ctx.post.resize(); ctx.lighting.setQuality?.(v); ctx.post.setQuality?.(v); }
    ctx.state.saveSettings();
  }
  function stepSetting(key, dir) {
    const def = SETTINGS.find((x) => x.key === key); if (!def) return;
    const s = S();
    if (def.options) { const i = def.options.indexOf(s[key]); applySetting(key, def.options[Math.max(0, Math.min(def.options.length - 1, (i < 0 ? 2 : i) + dir))]); }
    else { const v = Math.max(def.min, Math.min(def.max, Math.round((s[key] + dir * def.step) / def.step) * def.step)); if (v === s[key]) { snd('ui_deny', 0.3); return; } applySetting(key, +v.toFixed(3)); }
    snd('ui_click', 0.3); refreshSetting(key);
  }
  const subOf = (def, v) => def.tiers ? (def.tiers[v] || '') : def.sub || '';
  function settingRow(def) {
    const v = S()[def.key];
    const ctl = def.options
      ? `<div class="seg">${def.options.map((o) => `<button class="${o === v ? 'on' : ''}" data-a="set:${def.key}:${o}" tabindex="-1">${o}</button>`).join('')}</div>`
      : `<div class="ctl"><button class="pm" data-a="step:${def.key}:-1" tabindex="-1">−</button><div class="trk" data-key="${def.key}"><i style="width:${(((v - def.min) / (def.max - def.min)) * 100).toFixed(1)}%"></i><b style="left:${(((v - def.min) / (def.max - def.min)) * 100).toFixed(1)}%"></b></div><button class="pm" data-a="step:${def.key}:1" tabindex="-1">+</button></div>`;
    const sub = subOf(def, v);
    return `<div class="stp" tabindex="0" data-key="${def.key}"><div class="lab">${def.label}${sub ? `<small>${esc(sub)}</small>` : ''}</div>${ctl}<div class="val">${def.options ? '' : def.fmt(v)}</div></div>`;
  }
  function refreshSetting(key) {
    const rowEl = card.querySelector(`.stp[data-key="${key}"]`); if (!rowEl) return;
    const def = SETTINGS.find((x) => x.key === key), v = S()[key];
    if (def.options) { for (const b of rowEl.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.a.endsWith(':' + v)); const sm = rowEl.querySelector('.lab small'); if (sm) sm.textContent = subOf(def, v); }
    else { const p = (((v - def.min) / (def.max - def.min)) * 100).toFixed(1) + '%'; rowEl.querySelector('.trk i').style.width = p; rowEl.querySelector('.trk b').style.left = p; rowEl.querySelector('.val').textContent = def.fmt(v); }
  }
  function renderSettings() {
    card.className = 'sheet center settings-card';
    card.innerHTML = `<div class="hd"><span>UNPSC · Explorer preferences</span><span class="r">Form 61-S</span></div><h1>Settings</h1>
      <div class="body">${SETTINGS.map(settingRow).join('')}
      <div class="note">Render quality tiers — <b>low</b>: ${QUALITY_TIERS.low}. <b>medium</b>: ${QUALITY_TIERS.medium}. <b>high</b>: ${QUALITY_TIERS.high}.</div>
      <div class="note">Applied at once and kept on file. Invert Y is not offered.</div></div>
      <div class="btns"><button class="btn" data-a="back">Back</button></div>
      <div class="ft"><span>arrows select · ←→ adjust · click the track to set</span><span>Vanno Outpost</span></div>`;
    wash.className = 'wash full'; advisory.style.display = 'none';
    bindActions(card, {
      back() { api.show(prev === 'pause' ? 'pause' : 'title'); return 'ui_close'; },
      step(a) { const [key, dir] = a.split(':'); stepSetting(key, +dir); return null; },
      set(a) { const [key, val] = a.split(':'); applySetting(key, val); refreshSetting(key); return 'ui_click'; },
    }, snd);
    for (const trk of card.querySelectorAll('.trk')) {
      trk.addEventListener('mousedown', (e) => {
        const def = SETTINGS.find((x) => x.key === trk.dataset.key); const r = trk.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const v = Math.round((def.min + t * (def.max - def.min)) / def.step) * def.step;
        applySetting(def.key, +v.toFixed(3)); refreshSetting(def.key); snd('ui_click', 0.3); trk.closest('.stp').focus();
      });
    }
  }

  // ---------- death: the incident report, typed ----------
  function armourLine() {
    const inv = ctx.inventory; if (!inv?.equipped) return 'Armour worn: none.';
    const parts = [];
    for (const slot of ['helmet', 'vest', 'rig']) {
      const g = inv.equipped(slot); if (!g) continue; const d = def(g.id); if (!d || (!d.cls && !d.armor)) continue;
      const max = d.durability || 40, cur = g.durability ?? max;
      parts.push(`${d.name} (${Math.round((cur / max) * 100)} %)`);
    }
    return parts.length ? `Armour worn: ${parts.join(', ')}.` : 'Armour worn: none.';
  }
  function roundLine(info) {
    const a = info?.ammo; if (!a) return null;
    const name = typeof a === 'string' ? (def(a)?.name || a) : a.name || null;
    if (!name) return null;
    const zone = info.zone && ZONE[info.zone] ? `, ${ZONE[info.zone]}` : '';
    const pen = info.penetrated === false ? ', stopped by armour' : info.penetrated === true && info.zone && ctx.inventory?.equipped?.(info.zone === 'head' ? 'helmet' : 'vest') ? ', armour defeated' : '';
    return `Round recovered: ${name}${zone}${pen}.`;
  }
  function deathLines(info) {
    const d = ctx.state.data, st = d.stats;
    const dots = (k, v) => { const s = String(v); return `${k} ${'.'.repeat(Math.max(2, 40 - k.length - s.length))} ${s}`; };
    const rl = roundLine(info);
    return [
      ['h', `UNPSC · Incident report 61-${String(st.deaths || 1).padStart(3, '0')}`],
      ['s', 'Explorer 61 — status: missing'],
      ['', `Clearance ${d.securityLevel} · ${rankTitle(d.securityLevel)}.`],
      ['', (info?.what && CAUSE_WHAT[info.what]) || CAUSE[info?.kind] || 'Cause: undetermined.'],
      ...(rl ? [['', rl]] : []),
      ['', armourLine()],
      ['', `Last entry: day ${d.day}, ${ctx.time.clockText()}. Tide level ${d.tideLevel}.`],
      ['gap', ''],
      ['', dots('Entities neutralised', st.kills)],
      ['', dots('Artifacts recovered', st.artifacts)],
      ['', dots('Distance walked', `${(st.distance / 1000).toFixed(1)} km`)],
      ['', dots('Rounds expended', st.shots)],
      ['', dots('Earned to date', money(d.earned))],
      ['gap', ''],
      ['v', 'Body not recovered. Contract void.'],
    ];
  }
  function renderDeath(info) {
    card.className = 'sheet center death-card';
    tw.lines = deathLines(info); tw.li = 0; tw.ci = 0; tw.acc = 0; tw.done = false; tw.tick = 0;
    card.innerHTML = `<div class="hd"><span>UN Pechorsk Special Committee</span><span class="r">Form 61-I</span></div><div class="body"><div class="report"></div></div><div class="btns"><button class="btn primary" data-a="respawn">Return to Vanno</button></div><div class="ft"><span class="skip">Enter · continue</span><span>Section 61 · Vanno Outpost</span></div>`;
    const rep = card.querySelector('.report');
    tw.els = tw.lines.map(([cls]) => { const el = document.createElement('div'); el.className = `ln ${cls}`; rep.appendChild(el); return el; });
    tw.btn = card.querySelector('[data-a]'); tw.btn.tabIndex = -1;
    const caret = document.createElement('span'); caret.className = 'caret'; tw.els[0].appendChild(caret); tw.caret = caret;
    wash.className = 'wash full'; advisory.style.display = 'none';
    bindActions(card, { respawn() { if (!tw.done) { finishTypewriter(); return null; } ctx.game.respawn(); return 'ui_stamp'; } }, snd);
  }
  function setLineText(i, text) { const el = tw.els[i]; el.textContent = text; if (i === tw.li && !tw.done) el.appendChild(tw.caret); }
  function finishTypewriter() {
    for (let i = 0; i < tw.lines.length; i++) tw.els[i].textContent = tw.lines[i][1];
    tw.done = true; tw.caret.remove(); tw.readyAt = performance.now() + 400;
    card.querySelector('.btns').classList.add('on');
    const btn = tw.btn; setTimeout(() => { if (current === 'death' && tw.btn === btn) { btn.tabIndex = 0; btn.focus({ preventScroll: true }); } }, 400);
    const skip = card.querySelector('.ft .skip'); if (skip) skip.textContent = 'Enter · return to Vanno';
  }
  const TYPE_S = 0.024;   // seconds per character; the whole report lands in roughly ten seconds, Enter skips
  function typeStep(dt) {
    if (tw.done) return;
    tw.acc += dt;
    while (tw.acc >= TYPE_S && !tw.done) {
      tw.acc -= TYPE_S;
      const [cls, text] = tw.lines[tw.li];
      if (tw.ci < text.length) {
        tw.ci++; setLineText(tw.li, text.slice(0, tw.ci));
        if (text[tw.ci - 1] !== ' ' && ++tw.tick % 6 === 0) snd('ui_click', 0.16);
      } else {
        tw.li++; tw.ci = 0; tw.acc -= cls === 'gap' ? 0.08 : 0.24;   // a beat between lines
        if (tw.li >= tw.lines.length) { finishTypewriter(); break; }
        setLineText(tw.li, '');
      }
    }
  }

  const api = {
    get current() { return current; },
    show(name, data) {
      if (name === 'settings') prev = current === 'settings' ? prev : current;
      if (name === 'title') { confirming = false; if (current !== 'settings') adv = (adv + 1) % ADVISORIES.length; }
      if (name === 'pause') confirming = false;
      current = name;
      root.classList.add('on'); card.style.display = ''; wash.style.display = '';
      if (name === 'title') renderTitle();
      else if (name === 'pause') renderPause();
      else if (name === 'settings') renderSettings();
      else if (name === 'death') renderDeath(data);
      else { current = null; return; }
      if (name !== 'death' && name !== 'title') snd('ui_open', 0.4);
      const f = focusables(card)[0]; if (f && name !== 'death') f.focus({ preventScroll: true });
    },
    hide() {
      if (!current) return;
      current = null; prev = null; confirming = false;
      root.classList.remove('on'); card.style.display = 'none'; wash.style.display = 'none'; card.innerHTML = ''; advisory.style.display = 'none';
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },
    update(dt) {
      if (current === 'death') typeStep(dt);
      else if (current === 'title') {
        // the advisory line rotates while the form waits: fade out, swap the text, fade back in
        advT += dt;
        if (advSwap > 0) { advSwap -= dt; if (advSwap <= 0) { adv = (adv + 1) % ADVISORIES.length; setAdvisory(); advisory.classList.remove('swap'); } }
        else if (advT > 9) { advT = 0; advSwap = 0.5; advisory.classList.add('swap'); }
      }
    },
  };
  card.style.display = 'none'; wash.style.display = 'none'; advisory.style.display = 'none';
  return api;
}
