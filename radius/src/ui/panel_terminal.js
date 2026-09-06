// UNPSC Terminal 3: contracts (posted / active), artifact submission at full price, and the Explorer's status.
// The terminal is where clearance is granted: when rankFor(earned, missions) exceeds state.data.securityLevel the
// promotion is stamped here, notified as a Committee notice, and the supply and contract tiers widen.
// Panel module for ui/panels.js: { id, title, render(ctx, api, data) -> HTMLElement, onKey(e), onClose() }.
import { ITEMS, RANKS, rankFor, def } from '../data/index.js';
import { THIN, money, esc, sec, row, row3, act, tabsHtml, panelKit, ensureStyle, rankTitle, rankOf } from './menus.js';

const CSS = `
#panels .p-term { min-width: 700px; max-width: 800px; position: relative; }
#panels .p-term .greet { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink); border-bottom: 1px solid var(--ink-hair); padding: 0 0 7px; margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 2px 12px; }
#panels .p-term .greet .rt { color: var(--ink-dim); letter-spacing: 0.14em; margin-left: auto; }
#panels .p-term .scroll { max-height: calc(88vh - 250px); min-height: 200px; overflow-y: auto; overflow-x: hidden; padding-right: 6px; scrollbar-width: thin; scrollbar-color: var(--ink-dot) transparent; }
#panels .p-term .scroll::-webkit-scrollbar { width: 5px; } #panels .p-term .scroll::-webkit-scrollbar-thumb { background: var(--ink-dot); }
#panels .p-term .mission { padding: 8px 2px 10px; border-bottom: 1px solid var(--ink-hair); }
#panels .p-term .mission .code { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink); font-weight: 500; }
#panels .p-term .mission .code .st { color: var(--amber-ink); margin-left: 10px; letter-spacing: 0.18em; font-size: 10px; }
#panels .p-term .mission .code .st.ready { color: var(--ink); background: var(--amber-wash); padding: 0 6px; box-shadow: inset 0 0 0 1px var(--amber-ink); }
#panels .p-term .mission .text { margin: 3px 0 6px; color: var(--ink-dim); font-size: 11px; line-height: 1.55; }
#panels .p-term .mission .req { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); margin: -2px 0 6px; }
#panels .p-term .mission .pay { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 11px; }
#panels .p-term .mission .pay b { font-variant-numeric: tabular-nums; }
#panels .p-term .mission .pay .acts { white-space: nowrap; }
#panels .p-term .mission .pen { font-size: 10px; color: var(--red-ink); letter-spacing: 0.06em; margin-top: 4px; }
#panels .p-term .level { display: flex; align-items: baseline; gap: 14px; margin: 4px 0; }
#panels .p-term .level b { font-family: var(--display); font-weight: 300; font-size: 40px; line-height: 1; letter-spacing: 0.08em; }
#panels .p-term .level span { color: var(--ink-dim); font-size: 11px; }
#panels .p-term .level span i { font-style: normal; color: var(--ink); }
#panels .p-term .stamp-corner { position: absolute; right: 8px; top: -6px; z-index: 3; pointer-events: none; }
#panels .p-term .keys { margin-top: 8px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-faint); }
#panels .p-term .row.art { grid-template-columns: minmax(0, 1fr) 90px auto; }
@media (max-width: 860px) { #panels .p-term { min-width: 0; } }
`;
const TABS = [['missions', 'Contracts'], ['artifacts', 'Artifacts'], ['status', 'Status']];
const ABANDON_RATE = 0.1;     // share of the contract value charged for abandonment
const S = { tab: 'missions', notice: '', red: false, stamp: 0, confirm: null, rerender: null };

export default {
  id: 'terminal', title: 'UNPSC Terminal 3',
  render(ctx, api, data = {}) {
    ensureStyle('ui-b-terminal', CSS);
    if (data.tab && TABS.some(([k]) => k === data.tab)) S.tab = data.tab;
    const root = document.createElement('div'); root.className = 'p-term';
    const D = () => ctx.state.data, inv = ctx.inventory;
    const missions = () => ctx.missions || {};
    const activeList = () => { const a = missions().active; return Array.isArray(a) ? a : a ? [a] : []; };
    const completedCount = () => { const c = missions().completed ?? D().missions?.completed; return Array.isArray(c) ? c.length : (typeof c === 'number' ? c : 0); };
    const penaltyOf = (m) => Math.round(((m.payment ?? m.reward ?? 0) * ABANDON_RATE) / 50) * 50;

    // ---- clearance: granted here, never lowered here ----
    function checkPromotion() {
      const d = D(); const want = rankFor(d.earned || 0, completedCount());
      if (want <= (d.securityLevel || 1)) return;
      d.securityLevel = want; S.stamp = want;
      const r = rankOf(want);
      ctx.hud.notify(`Clearance ${want} granted. Grade: ${r.title}. Requisition and contract tiers widened accordingly.`, { code: 'UNPSC · CLEARANCE', ms: 8000, sound: false });
      snd('ui_stamp'); missions().generate?.(); ctx.state.save?.();
    }

    // ---- contracts ----
    function missionHtml(m, active) {
      const code = esc(m.code || m.id || 'PSC-0000'), title = esc(m.title || m.name || '');
      // the record's own closing sentence ("Payment 1,800 ₽ on delivery.") becomes the figure line so it is not printed twice
      let body = String(m.body || m.text || m.desc || ''); const pm = body.match(/\s*(Payment [^.]*\.)\s*$/);
      if (pm) body = body.slice(0, pm.index);
      const pay = m.payment ?? m.reward ?? 0;
      const payLine = pm ? esc(pm[1]).replace(/(\d),(?=\d{3})/g, '$1' + THIN).replace(/(\S+ ₽)/, '<b>$1</b>') : `Payment <b>${money(pay)}</b> on delivery.`;
      const reqs = Array.isArray(m.requirements) && m.requirements.length ? `<div class="req">${m.requirements.map(esc).join(' · ')}</div>` : '';
      const ready = active && (missions().deliverable?.(m) === true || m.status === 'complete' || m.status === 'ready');
      const progress = active && !ready ? (m.type === 'CLEARANCE' && m.count ? `${m.kills || 0} / ${m.count} destroyed` : m.points ? `${m.points.filter((p) => p.done).length} / ${m.points.length} beacons` : m.type === 'RETRIEVAL' ? (m.recovered ? 'object in hand' : 'object outstanding') : m.type === 'ARTIFACT' ? (inv.has?.(m.artifact) ? 'artifact in hand' : 'artifact outstanding') : 'in progress') : '';
      const status = active ? `<span class="st ${ready ? 'ready' : ''}">${ready ? 'ready for delivery' : esc(progress || 'active')}</span>` : '';
      let acts;
      if (!active) acts = act(`accept:${m.id}`, 'Accept');
      else if (S.confirm === m.id) acts = act(`abandon:${m.id}`, `Confirm · charge ${money(penaltyOf(m))}`, { cls: 'deny' }) + act('keep', 'Keep');
      else acts = (ready ? act(`deliver:${m.id}`, 'Deliver') : '') + act(`abandon:${m.id}`, 'Abandon');
      const pen = active && S.confirm === m.id ? `<div class="pen">Abandonment is recorded against the Explorer. ${money(penaltyOf(m))} is charged to contract funds; issued items are withdrawn.</div>` : '';
      return `<div class="mission"><div class="code">${code}${title ? ` / ${title}` : ''}${status}</div><div class="text">${esc(body)}</div>${reqs}<div class="pay"><span>${payLine}</span><span class="acts">${acts}</span></div>${pen}</div>`;
    }
    function contractsHtml() {
      const active = activeList(), avail = (missions().available?.() || []).filter((m) => !active.some((a) => a.id === m.id));
      return sec('Active contracts', active.length, active.length ? active.map((m) => missionHtml(m, true)).join('') : '<div class="empty">No contract active.</div>') +
        sec('Posted', avail.length, avail.length ? avail.map((m) => missionHtml(m, false)).join('') : '<div class="empty">No contracts posted. The board is updated after each Tide.</div>') +
        '<div class="note">Two contracts may be open at once. Delivery is made here. Abandonment costs a tenth of the contract value.</div>';
    }
    // ---- artifacts ----
    function artifactsHtml() {
      const arts = inv.artifacts ? inv.artifacts() : [];
      const total = arts.reduce((s, [id, n]) => s + (ITEMS[id]?.price || 0) * n, 0);
      const rows = arts.map(([id, n]) => { const it = ITEMS[id]; return `<div class="row three art"><div class="k">${esc(it.name)}<span class="sub">${esc(it.desc || 'Committee note pending.')}</span></div><div class="num">${n > 1 ? `${n} × ` : ''}${money(it.price)}</div><div class="acts">${act(`sell:${id}`, 'Submit')}${n > 1 ? act(`sellall:${id}`, `All ${n}`) : ''}</div></div>`; }).join('');
      return sec('Artifacts · Committee purchase', arts.length, rows || '<div class="empty">Nothing to submit. Artifacts are located with the detector, near anomalies.</div>') +
        (arts.length ? row('Declared value', money(total)) : '') +
        '<div class="note">Purchased at full listed price. Submissions count toward clearance. The supply crate does not take artifacts.</div>';
    }
    // ---- status ----
    function statusHtml() {
      const d = D(), lvl = d.securityLevel, st = d.stats || {}, done = completedCount();
      const cur = rankOf(lvl), next = RANKS.find((r) => r.rank === lvl + 1) || null;
      const barE = next ? Math.min(100, ((d.earned - cur.earned) / Math.max(1, next.earned - cur.earned)) * 100) : 100;
      const barM = next ? Math.min(100, ((done - cur.missions) / Math.max(1, next.missions - cur.missions)) * 100) : 100;
      const clearance = `<div class="level"><b>${lvl}</b><span><i>${esc(cur.title)}</i> · clearance ${lvl} of ${RANKS.length}${next ? ` · next grade: ${esc(next.title)}` : ' · maximum clearance'}</span></div>` +
        (next ? row('Earned toward clearance ' + next.rank, `${money(d.earned)}<span class="u">/ ${money(next.earned)}</span>`) + `<div class="bar"><i style="width:${barE.toFixed(1)}%"></i></div>` +
          row('Contracts toward clearance ' + next.rank, `${done}<span class="u">/ ${next.missions}</span>`) + `<div class="bar"><i style="width:${barM.toFixed(1)}%"></i></div>` : '') +
        row('Earned to date', money(d.earned)) + row('Contract funds', money(d.money)) + row('Contracts completed', done);
      const ladder = RANKS.map((r) => row(`${r.rank} · ${esc(r.title)}`, `${money(r.earned)} <span class="u">· ${r.missions} contracts</span>`, r.rank <= lvl ? '' : 'dim')).join('');
      const field = row('Entities neutralised', st.kills || 0) + row('Artifacts recovered', st.artifacts || 0) + row('Rounds expended', st.shots || 0) + row('Distance walked', `${((st.distance || 0) / 1000).toFixed(1)}<span class="u">km</span>`) + row('Tides survived', st.tides || 0) + row('Incidents on file', st.deaths || 0);
      return sec('Clearance', null, clearance) + sec('Grades', null, ladder) + sec('Field record', null, field) +
        '<div class="note">Clearance governs requisition and contract tiers. Grades are conferred at this terminal on the strength of earnings and contracts concluded.</div>';
    }
    function fill() {
      checkPromotion();
      const d = D(), lvl = d.securityLevel, active = activeList(), avail = (missions().available?.() || []).length;
      const stamp = S.stamp ? `<div class="stamp-corner"><span class="rubber">Clearance ${S.stamp} granted</span></div>` : '';
      const body = S.tab === 'missions' ? contractsHtml() : S.tab === 'artifacts' ? artifactsHtml() : statusHtml();
      return stamp + `<div class="greet"><span>Vanno Outpost · UNPSC Terminal 3 · Explorer ${d.explorer} · Security level ${lvl}</span><span class="rt">${esc(rankTitle(lvl))}</span></div>` +
        tabsHtml(TABS, S.tab, { missions: active.length + avail || '', artifacts: (inv.artifacts ? inv.artifacts().length : 0) || '' }) +
        `<div class="scroll">${body}</div><div class="keys">←→ tabs · ↑↓ select · Enter confirm · 1–9 pick</div>`;
    }

    // abandon: the missions module's own method when it has one; otherwise the record is withdrawn here and the module told
    function abandonMission(m) {
      if (typeof missions().abandon === 'function') return missions().abandon(m.id) !== false;
      const md = D().missions; if (!md || !Array.isArray(md.active)) return false;
      const i = md.active.findIndex((x) => x.id === m.id); if (i < 0) return false;
      md.active.splice(i, 1); m.status = 'abandoned';
      if (m.points) { const n = Math.min(inv.count('beacon'), m.points.filter((p) => !p.done).length); if (n > 0) inv.remove('beacon', n); }
      if (m.chain === 1 && !m.installed && inv.has('recorder')) inv.remove('recorder', 1);
      if (m.relay && !m.planted && m.item && inv.has(m.item)) inv.remove(m.item, 1);
      ctx.events.emit('missionFailed', m);
      if (md.active.length === 0) missions().generate?.();
      return true;
    }
    const handlers = {
      tab(t) { S.tab = t; S.confirm = null; redo(); return 'ui_click'; },
      accept(id) {
        const m = (missions().available?.() || []).find((x) => String(x.id) === id); if (!m) return false;
        if (missions().accept?.(m.id) === false) { say(`${m.code || m.id} not issued. Two contracts may be open at once; conclude one first.`, true); redo(); return null; }
        say(`${m.code || m.id} accepted. Terms on file.`); redo(); return null;   // missions plays its own stamp
      },
      deliver(id) {
        const m = activeList().find((x) => String(x.id) === id); if (!m) return false;
        if (missions().complete?.(m.id) === false) { say(`${m.code || m.id}: conditions not met. See the terms.`, true); redo(); return null; }
        say(`${m.code || m.id} closed. ${money(m.payment ?? 0)} credited.`); redo(); return 'ui_stamp';
      },
      abandon(id) {
        const m = activeList().find((x) => String(x.id) === id); if (!m) return false;
        if (S.confirm !== m.id) { S.confirm = m.id; redo(); return 'ui_click'; }
        S.confirm = null;
        if (!abandonMission(m)) { say(`${m.code || m.id} cannot be withdrawn here.`, true); redo(); return false; }
        const pen = penaltyOf(m); const d = D(); d.money = Math.max(0, d.money - pen);
        ctx.hud.notify(`Contract ${m.code || m.id} abandoned. ${money(pen)} charged. Noted on file.`, { code: 'UNPSC · TERMINAL', ms: 6000, sound: false });
        say(`${m.code || m.id} withdrawn. ${money(pen)} charged.`, true); ctx.state.save?.(); redo(); return 'ui_stamp';
      },
      keep() { S.confirm = null; redo(); return 'ui_click'; },
      sell(id) { return sellArt(id, 1); },
      sellall(id) { return sellArt(id, inv.count(id)); },
    };
    function sellArt(id, n) {
      const it = ITEMS[id]; if (!it || it.kind !== 'artifact' || !inv.has(id, n) || n <= 0) return false;
      inv.remove(id, n); const price = it.price * n; inv.earn(price);
      say(`${n > 1 ? `${n} × ` : ''}${it.name} received. ${money(price)} credited.`); redo(); return 'ui_buy';
    }
    const { snd, say, redo, build } = panelKit(ctx, api, S, root, fill, handlers);
    build();
    return root;
  },
  onKey(e) {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return false;
    const i = TABS.findIndex(([k]) => k === S.tab); S.tab = TABS[(i + (e.code === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]; S.confirm = null;
    S.rerender?.(); return true;
  },
  onClose() { S.notice = ''; S.red = false; S.stamp = 0; S.confirm = null; },
};
