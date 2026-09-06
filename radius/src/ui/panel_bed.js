// The bunk: sleep until 07:00 and record the log. Before confirming, the Tide note and a CHECK KIT summary:
// rounds per calibre (loose, in magazines, in weapons), medical, batteries and the torch, so the next expedition is
// packed while the Explorer is still at the bench and not at the gate.
// Panel module for ui/panels.js: { id, title, render(ctx, api, data) -> HTMLElement, onKey(e), onClose() }.
import { CALIBERS, AMMO, WEAPONS, MAGAZINES, ITEMS, def } from '../data/index.js';
import { esc, clockOf, spanText, sec, row, panelKit, ensureStyle } from './menus.js';

const CSS = `
#panels .p-bed { width: 500px; max-width: 100%; }
#panels .p-bed h1 { font-family: var(--display); font-weight: 300; font-size: 26px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink); margin: 0 0 8px; line-height: 1.05; }
#panels .p-bed .scroll { max-height: calc(88vh - 250px); overflow-y: auto; overflow-x: hidden; padding-right: 6px; scrollbar-width: thin; scrollbar-color: var(--ink-dot) transparent; }
#panels .p-bed .scroll::-webkit-scrollbar { width: 5px; } #panels .p-bed .scroll::-webkit-scrollbar-thumb { background: var(--ink-dot); }
#panels .p-bed .row .num .u { margin-left: 4px; }
#panels .p-bed .row.dim .k { color: var(--ink-faint); }
#panels .p-bed .btns { margin-top: 10px; }
#panels .p-bed .keys { margin-top: 8px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-faint); }
`;
const S = { notice: '', red: false, sleeping: false, rerender: null };

export default {
  id: 'bed', title: 'Bunk',
  render(ctx, api) {
    ensureStyle('ui-b-bed', CSS);
    const root = document.createElement('div'); root.className = 'p-bed';
    const D = () => ctx.state.data, inv = ctx.inventory;
    function sleepMaths() {
      const d = D(); const h = d.hour; const adv = h < 6.5 ? 7 - h : 24 - h + 7;
      let day = d.day, hour = h + adv; while (hour >= 24) { hour -= 24; day += 1; }
      const now = (day - 1) * 86400 + hour * 3600, tide = (d.tideDay - 1) * 86400 + 5 * 3600;
      return { day, hour, tideAfter: tide - now };
    }
    // CHECK KIT: what the Explorer wakes up with
    function kitHtml() {
      const cals = {};
      const bump = (cal, k, n) => { if (!cal || !n) return; (cals[cal] ||= { loose: 0, mags: 0, guns: 0 })[k] += n; };
      for (const [id, n] of Object.entries(inv.items)) if (AMMO[id]) bump(AMMO[id].cal, 'loose', n);
      for (const m of inv.mags) bump(m.cal || MAGAZINES[m.id]?.cal, 'mags', m.rounds || 0);
      const used = new Set();
      for (const w of inv.weapons) { const d = WEAPONS[w.id]; if (!d) continue; used.add(d.cal); bump(d.cal, 'guns', (w.chamber ? 1 : 0) + (w.mag ? w.mag.rounds : 0) + (w.tube?.length || 0)); }
      const calRows = Object.keys(CALIBERS).filter((c) => cals[c] || used.has(c)).map((c) => {
        const k = cals[c] || { loose: 0, mags: 0, guns: 0 }, total = k.loose + k.mags + k.guns;
        const parts = [k.loose ? `${k.loose} loose` : '', k.mags ? `${k.mags} in magazines` : '', k.guns ? `${k.guns} in weapons` : ''].filter(Boolean).join(' · ');
        return row(`${esc(CALIBERS[c].name)}<span class="sub">${parts || 'none carried'}${used.has(c) ? '' : ' · no weapon for it'}</span>`, `${total}<span class="u">rounds</span>`, total === 0 ? 'dim' : '');
      }).join('');
      const meds = Object.entries(inv.items).filter(([id, n]) => ITEMS[id]?.kind === 'med' && n > 0).map(([id, n]) => row(esc(ITEMS[id].name), `${n}<span class="u">×</span>`)).join('');
      const d = D();
      const cells = inv.count('battery'), torch = Math.round(d.flashlight?.battery ?? 0);
      const powered = inv.gear.filter((g) => g.charge != null).map((g) => ({ name: def(g.id)?.name || g.id, charge: Math.round(g.charge) }));
      const power = row('Battery cells', `${cells}<span class="u">×</span>`, cells === 0 ? 'dim' : '') + row('Torch', `${torch}<span class="u">%</span>`, torch < 20 ? 'red' : '') +
        powered.map((g) => row(esc(g.name), `${g.charge}<span class="u">%</span>`, g.charge < 20 ? 'red' : '')).join('');
      const other = [['probe', 'Probes'], ['filter', 'Mask filters'], ['cleankit', 'Cleaning kits']].filter(([id]) => inv.count(id) > 0).map(([id, n]) => row(n, `${inv.count(id)}<span class="u">×</span>`)).join('');
      return sec('Check kit · ammunition', null, calRows || '<div class="empty">No ammunition and no weapon to put it in.</div>') +
        sec('Check kit · medical', null, meds || '<div class="empty red">No medical items carried. Bleeding does not stop on its own.</div>') +
        sec('Check kit · power', null, power) + (other ? sec('Check kit · other', null, other) : '');
    }
    function fill() {
      const d = D(), s = sleepMaths(), before = s.tideAfter <= 0, soon = !before && s.tideAfter < 86400;
      const head = row('Now', `Day ${d.day} · ${ctx.time.clockText()}`) + row('Wake', `Day ${s.day} · ${clockOf(s.hour)}`) +
        row('Tide after waking', before ? '<span class="red">arrives first</span>' : `<span class="${soon ? 'red' : ''}">${spanText(s.tideAfter)}</span>`) +
        row('Condition on waking', `${Math.min(100, Math.round(d.hp) + 10)}<span class="u">/ 100</span>${d.bleeding ? ' <span class="red">· still bleeding</span>' : ''}`);
      const tide = before
        ? '<div class="note red">The Tide arrives before morning. Vanno is sealed; the Explorer will be safe. The Radius outside will not be the same: anomalies relocate, entities return, containers refill.</div>'
        : soon ? `<div class="note"><span class="red">Tide within a day of waking.</span> Plan a short expedition and watch the clock. At Tide − 60 min the siren sounds from the base.</div>`
        : '<div class="note">Sleeping records the contract log. Anything left in the Radius stays there. The Tide is expected at 05:00 on day ' + d.tideDay + '.</div>';
      return `<h1>Sleep until 07:00</h1>` + head + tide + `<div class="scroll">${kitHtml()}</div>` +
        `<div class="btns"><button class="btn primary" data-x="sleep" ${S.sleeping ? 'disabled' : ''}>Confirm · sleep until 07:00</button><button class="btn" data-x="cancel" ${S.sleeping ? 'disabled' : ''}>Stay up</button></div>` +
        '<div class="keys">↑↓ select · Enter confirm · Esc stay up</div>';
    }
    const handlers = {
      cancel() { if (S.sleeping) return false; api.close?.(); return 'ui_close'; },
      sleep() {
        if (S.sleeping) return false;
        // the sheet dims itself while the room goes dark, then the clock jumps, the log is written and the sheet is put away
        S.sleeping = true;
        const panels = document.getElementById('panels'); panels?.classList.add('sleeping');
        ctx.hud.fadeOut(); snd('sleep', 0.8);
        const gen = D();
        setTimeout(() => {
          S.sleeping = false; panels?.classList.remove('sleeping');
          if (D() !== gen) return;   // a new game replaced the state mid-fade; abandon quietly
          ctx.time.sleepToMorning(); ctx.player.heal(10); ctx.director?.rest?.(); ctx.state.save(); ctx.events.emit('sleep');
          api.close?.();
          setTimeout(() => { ctx.hud.fadeIn(); ctx.hud.notify(`Log recorded. Day ${D().day}, ${ctx.time.clockText()}. Tide in ${ctx.time.tideInText()}.`, { code: 'Vanno · Bunk' }); }, 500);
        }, 1400);
        redo(); return 'ui_click';
      },
    };
    const { snd, redo, build } = panelKit(ctx, api, S, root, fill, handlers);
    build();
    return root;
  },
  // while the room goes dark nothing on the sheet responds
  onKey() { return S.sleeping; },
  onClose() { S.notice = ''; S.red = false; },
};
