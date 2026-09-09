// In-game HUD (DOM). Menus and base panels live in ui/menus.js and ui/panels.js.
//
// The rule this file is written to: fear is information, and clutter is the opposite of fear. Nothing is
// drawn that is true all the time. The bottom-left block is a list of things that are currently wrong —
// empty when nothing is, which is most of the time — and everything else waits behind Tab. What was added
// for the loss economy is one line: where the kit is. It is the only line that persists across a whole
// trip, because it is the only thing the Explorer is supposed to be thinking about on the way out.
import { clamp01, damp, lerp } from '../core/math.js';

const CARDS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
const CARD16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const bearing16 = (dx, dz) => CARD16[Math.round((((Math.atan2(dx, -dz) * 180) / Math.PI % 360) + 360) % 360 / 22.5) % 16];
const metres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 5) * 5} m`);
// signed angle from a to b in degrees, wrapped to (-180, 180] — so a mark 5 degrees east of north sits
// five degrees to the right of centre instead of 355 degrees off the end of the strip
const wrapDeg = (v) => { let x = (v + 180) % 360; if (x < 0) x += 360; return x - 180; };

// The HUD's own sheet. style.css is core and shared; these three rules belong to the loss readout and
// are injected rather than fought over.
const HUD_CSS = `
#status .hpline { display: block; width: 74px; height: 2px; background: rgba(217,211,196,0.18); margin: 3px 0 4px; }
#status .hpline i { display: block; height: 100%; background: var(--red); }
#status .kit { color: var(--amber-dim); }
#compass .cache { position: absolute; top: 2px; transform: translateX(-50%); width: 7px; height: 7px; opacity: 0.72; }
#compass .cache::before, #compass .cache::after { content: ''; position: absolute; background: var(--amber-dim); }
#compass .cache::before { left: 3px; top: 0; width: 1px; height: 7px; }
#compass .cache::after { left: 1px; top: 2px; width: 5px; height: 1px; }
#watch .arrears { color: var(--red); }
`;

export function createHud(ctx) {
  const ui = document.getElementById('ui');
  const el = (id, cls = 'hud', html = '') => { const d = document.createElement('div'); d.id = id; d.className = cls; d.innerHTML = html; ui.appendChild(d); return d; };
  const crosshair = el('crosshair', 'hud', '<div class="dot"></div><div class="h t"></div><div class="h b"></div><div class="h l"></div><div class="h r"></div>');
  const prompt = el('prompt', 'hud hidden');
  const notify = el('notify');
  const objective = el('objective', 'hud hidden');
  const compass = el('compass', 'hud', '<div class="strip"></div><div class="center"></div>');
  const ammo = el('ammo', 'hud hidden');
  const watch = el('watch', 'hud hidden');
  const status = el('status');
  const hint = el('hint', 'hud hidden');
  const fade = el('fade', 'hud');
  const scope = el('scope', 'hud hidden', '<canvas width="512" height="512"></canvas>');
  const quick = el('quick', 'hud');
  const extra = el('statusx', 'hud');
  const scopeCanvas = scope.querySelector('canvas');
  const dmgdir = el('dmgdir', 'hud', '<div class="arc"></div>');
  const dmgArc = dmgdir.querySelector('.arc');
  let dmgT = 0, dmgAngle = 0;
  const strip = compass.querySelector('.strip');
  // compass strip: 3 copies for wrap
  let stripHtml = '';
  const PX = 2.2; // px per degree
  for (let rep = -1; rep <= 1; rep++) for (const [name, deg] of CARDS) { const x = (deg + rep * 360) * PX; stripHtml += `<div class="card ${name === 'N' ? 'n' : ''}" style="left:${x}px">${name}</div>`; }
  for (let d = -360; d <= 720; d += 15) stripHtml += `<div class="tick" style="left:${d * PX}px"></div>`;
  strip.innerHTML = stripHtml;
  const mark = document.createElement('div'); mark.className = 'mark'; mark.style.display = 'none'; strip.appendChild(mark);
  // the kit mark: a pencil cross on the compass at the bearing of what the Explorer left behind
  const cacheMark = document.createElement('div'); cacheMark.className = 'cache'; cacheMark.style.display = 'none'; strip.appendChild(cacheMark);
  if (!document.getElementById('hud-loss-css')) { const st = document.createElement('style'); st.id = 'hud-loss-css'; st.textContent = HUD_CSS; document.head.appendChild(st); }

  let spread = 4, ammoT = 0, hintT = 0, objectiveTarget = null, objectiveText = '', gameVisible = true;
  // the walk-home readout is a whole-inventory walk and a distance query; it does not need a frame
  let slowT = 0, kitD = 0, kitB = '', kitHas = false, kitX = 0, kitZ = 0, rounds = -1, reserve = 0;
  function sampleSlow() {
    const inv = ctx.inventory;
    kitHas = false;
    try {
      const n = ctx.loot?.nearestCache?.(ctx.player.position);
      if (n && n.cache) { kitHas = true; kitD = n.distance; kitX = n.cache.x; kitZ = n.cache.z; kitB = bearing16(n.cache.x - ctx.player.position.x, n.cache.z - ctx.player.position.z); }
    } catch { kitHas = false; }
    rounds = -1; reserve = 0;
    try {
      const w = ctx.weapons?.current;
      if (w && w.def) {
        rounds = (w.chamber ? 1 : 0) + (w.mag ? w.mag.rounds : (w.tube ? w.tube.length : 0));
        for (const m of inv.magsForWeapon ? inv.magsForWeapon(w) : []) reserve += m.rounds || 0;
        reserve += inv.ammoCount ? inv.ammoCount(w.def.cal) : 0;
      }
    } catch { rounds = -1; }
  }

  ctx.events.on('playerDamaged', (amount, info) => { if (info && info.source) api.damageFrom(info.source); });
  const api = {
    // ---- prompt ----
    prompt(text, holdProgress = 0) {
      if (!text) { prompt.classList.add('hidden'); return; }
      prompt.classList.remove('hidden');
      const key = text.startsWith('[') ? text.slice(1, text.indexOf(']')) : 'E';
      const body = text.startsWith('[') ? text.slice(text.indexOf(']') + 1).trim() : text;
      const need = `<span class="key">${key}</span><span class="caps">${body}</span>` + (holdProgress > 0 || text.includes('·hold') ? `<span class="ring"><i style="width:${(clamp01(holdProgress) * 100).toFixed(0)}%"></i></span>` : '');
      if (prompt.innerHTML !== need) prompt.innerHTML = need;
    },
    // ---- notifications (paper slips) ----
    notify(text, opts = {}) {
      const slip = document.createElement('div'); slip.className = 'slip';
      slip.innerHTML = (opts.code ? `<span class="code">${opts.code}</span>` : '') + text;
      notify.appendChild(slip);
      while (notify.children.length > 4) notify.removeChild(notify.firstChild);
      setTimeout(() => { slip.classList.add('out'); setTimeout(() => slip.remove(), 650); }, opts.ms ?? 5500);
      if (opts.sound !== false) ctx.audio.play('ui_slip', { gain: 0.35 });
    },
    // ---- objective ----
    setObjective(code, text, target = null) {
      objectiveText = text; objectiveTarget = target;
      if (!text) { objective.classList.add('hidden'); mark.style.display = 'none'; return; }
      objective.classList.remove('hidden');
      objective.innerHTML = `<span class="code">${code}</span>${text}<div class="dist"></div>`;
    },
    // ---- ammo ----
    showAmmo() { ammoT = 2.2; },
    setAmmo(html) { if (ammo.innerHTML !== html) ammo.innerHTML = html; },
    // ---- hint ----
    hint(text, ms = 5000) { hint.textContent = text; hint.classList.remove('hidden'); hintT = ms / 1000; },
    // ---- crosshair ----
    setSpread(px, ads) { spread = px; crosshair.classList.toggle('ads', !!ads); },
    // ---- fade ----
    fadeOut(white = false) { fade.classList.toggle('white', white); fade.classList.remove('clear'); },
    fadeIn() { fade.classList.add('clear'); },
    setGameVisible(v) { gameVisible = v; for (const e of [crosshair, compass, status, objective, quick, extra]) e.classList.toggle('hidden', !v); if (!v) { prompt.classList.add('hidden'); watch.classList.add('hidden'); ammo.classList.add('hidden'); scope.classList.add('hidden'); } },
    // brief arc toward where damage came from (source: Vector3 | { position }) — fades over ~1.2 s
    damageFrom(source) {
      const pos = source && (source.position || source);
      if (!pos || pos.x === undefined) return;
      const p = ctx.player;
      const dx = pos.x - p.position.x, dz = pos.z - p.position.z;
      const bearing = Math.atan2(dx, -dz);            // world bearing, 0 = north
      dmgAngle = bearing + p.yaw;                       // relative to view (yaw rotates the view left)
      dmgT = 1.2;
    },
    // scope reticle overlay: def = { zoom, reticle: 'dot'|'holo'|'pso'|'pu'|'acog'|'chevron'|'mildot' } or null
    setScope(def) {
      if (!def) { scope.classList.add('hidden'); crosshair.classList.remove('hidden'); ctx.post.setScope(0); return; }
      scope.classList.remove('hidden'); crosshair.classList.add('hidden');
      const magnified = (def.zoom || 1) > 1.5;
      ctx.post.setScope(magnified ? 1 : 0);
      const g = scopeCanvas.getContext('2d'); const S = 512, c = S / 2; g.clearRect(0, 0, S, S);
      g.strokeStyle = 'rgba(20,18,16,0.9)'; g.fillStyle = 'rgba(20,18,16,0.9)'; g.lineWidth = 2;
      const r = def.reticle || 'dot';
      if (r === 'dot' || r === 'holo') { g.fillStyle = 'rgba(255,70,50,0.95)'; g.beginPath(); g.arc(c, c, r === 'dot' ? 3 : 2, 0, 6.283); g.fill(); if (r === 'holo') { g.strokeStyle = 'rgba(255,70,50,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, 34, 0, 6.283); g.stroke(); } }
      else if (r === 'pso' || r === 'chevron' || r === 'acog') { g.beginPath(); g.moveTo(c, c - 14); g.lineTo(c - 12, c + 6); g.lineTo(c + 12, c + 6); g.closePath(); g.stroke(); for (let i = 1; i <= 4; i++) { g.beginPath(); g.moveTo(c - 6, c + 6 + i * 22); g.lineTo(c + 6, c + 6 + i * 22); g.stroke(); } g.beginPath(); g.moveTo(c - 120, c); g.lineTo(c - 26, c); g.moveTo(c + 26, c); g.lineTo(c + 120, c); g.stroke(); if (r === 'pso') { g.beginPath(); g.moveTo(c - 110, c + 110); for (let i = 0; i <= 10; i++) g.lineTo(c - 110 + i * 22, c + 110 - Math.sqrt(i) * 30); g.stroke(); } if (r === 'acog') { g.fillStyle = 'rgba(255,60,40,0.9)'; g.beginPath(); g.moveTo(c, c - 14); g.lineTo(c - 12, c + 6); g.lineTo(c + 12, c + 6); g.closePath(); g.fill(); } }
      else if (r === 'pu') { g.lineWidth = 3; g.beginPath(); g.moveTo(c, c + 6); g.lineTo(c, c + 200); g.moveTo(c - 200, c); g.lineTo(c - 12, c); g.moveTo(c + 12, c); g.lineTo(c + 200, c); g.stroke(); g.beginPath(); g.moveTo(c, c + 6); g.lineTo(c - 5, c + 24); g.lineTo(c + 5, c + 24); g.closePath(); g.fill(); }
      else if (r === 'mildot') { g.lineWidth = 1.5; g.beginPath(); g.moveTo(c - 220, c); g.lineTo(c + 220, c); g.moveTo(c, c - 220); g.lineTo(c, c + 220); g.stroke(); for (let i = -4; i <= 4; i++) { if (!i) continue; g.beginPath(); g.arc(c + i * 40, c, 2.5, 0, 6.283); g.fill(); g.beginPath(); g.arc(c, c + i * 40, 2.5, 0, 6.283); g.fill(); } }
    },
    // quick slots 6-9: [{ id, name, count } | null x4]
    setQuick(slots) { const html = slots.map((q, i) => `<div class="qs ${q ? '' : 'empty'}"><span class="k">${i + 6}</span>${q ? `<span class="n">${q.name}</span><span class="c">${q.count}</span>` : ''}</div>`).join(''); if (quick.innerHTML !== html) quick.innerHTML = html; },
    setStatusExtra(html) { if (extra.innerHTML !== html) extra.innerHTML = html; },
    elements: { crosshair, prompt, notify, objective, compass, ammo, watch, status, hint, fade, dmgdir, scope, quick, extra },
    update(dt) {
      if (!gameVisible) return;
      const d = ctx.state.data, p = ctx.player;
      // crosshair spread
      crosshair.style.setProperty('--s', `${spread.toFixed(1)}px`);
      // compass: yaw -> heading (0 = north = -z)
      const heading = ((-p.yaw * 180) / Math.PI + 360 * 4) % 360;
      strip.style.transform = `translateX(${(160 - heading * PX).toFixed(1)}px)`;
      if (objectiveTarget) {
        const dx = objectiveTarget.x - p.position.x, dz = objectiveTarget.z - p.position.z;
        const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
        // Place the mark relative to the heading, not absolutely on the strip: the strip only carries one
        // copy of the mark, so a target 5 degrees east of north while facing 355 used to be written 790 px
        // along and slid off the mask entirely. Landing it at heading + wrapped offset keeps it on screen
        // at every yaw, which is the whole job of a compass mark.
        mark.style.display = ''; mark.style.left = `${((heading + wrapDeg(bearing - heading)) * PX).toFixed(1)}px`;
        const dist = Math.hypot(dx, dz);
        const dd = objective.querySelector('.dist'); if (dd) dd.textContent = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
      }
      // the kit: a pencil cross at the bearing of the body, for as long as the body is out there
      if (kitHas) {
        const b = ((Math.atan2(kitX - p.position.x, -(kitZ - p.position.z)) * 180) / Math.PI + 360) % 360;
        cacheMark.style.display = ''; cacheMark.style.left = `${((heading + wrapDeg(b - heading)) * PX).toFixed(1)}px`;
      } else if (cacheMark.style.display !== 'none') cacheMark.style.display = 'none';
      if ((slowT -= dt) <= 0) { slowT = 0.35; sampleSlow(); }
      // ammo readout timing
      ammoT -= dt; ammo.classList.toggle('hidden', ammoT <= 0);
      // watch (hold Tab)
      const showWatch = ctx.input.down('watch');
      watch.classList.toggle('hidden', !showWatch); status.classList.toggle('hidden', showWatch);
      if (showWatch) {
        const tideS = ctx.time.tideIn();
        const w = ctx.weapons?.current;
        watch.innerHTML = `
          <div class="row"><span class="k">Explorer ${d.explorer}</span><span class="k">Day ${d.day} · ${ctx.time.clockText()}</span></div>
          <div class="row" style="margin-top:6px"><span class="k">Tide</span></div>
          <div class="tide ${tideS < 3600 ? 'soon' : ''}">${tideS <= 0 ? 'NOW' : ctx.time.tideInText()}</div>
          <div class="row" style="margin-top:8px"><span class="k">Condition</span><span>${Math.round(d.hp)}</span></div>
          <div class="bar hp ${d.hp < 30 ? 'low' : ''}"><i style="width:${d.hp}%"></i></div>
          <div class="row"><span class="k">Stamina</span></div><div class="bar"><i style="width:${d.stamina}%"></i></div>
          <div class="row"><span class="k">Torch</span><span>${Math.round(d.flashlight.battery)}%</span></div>
          <div class="row"><span class="k">Funds</span><span>${d.money.toLocaleString('ru-RU')} ₽</span></div>
          ${w ? `<div class="row"><span class="k">${w.def.name}</span><span>${(w.chamber ? 1 : 0) + (w.mag ? w.mag.rounds : (w.tube ? w.tube.length : 0))} · ${w.fireMode || ''}</span></div>` : ''}
          <div class="row"><span class="k">Load</span><span>${ctx.inventory.weight ? ctx.inventory.weight().toFixed(1) : '0'} / ${ctx.inventory.capacity ? ctx.inventory.capacity() : 0} kg</span></div>
          ${(() => { const v = ctx.inventory.equipped?.('vest'), h = ctx.inventory.equipped?.('helmet'); const dv = v && ctx.inventory.equippedDef('vest'), dh = h && ctx.inventory.equippedDef('helmet'); return (dv ? `<div class="row"><span class="k">${dv.name}</span><span>${Math.round(v.durability)} / ${dv.durability}</span></div>` : '') + (dh ? `<div class="row"><span class="k">${dh.name}</span><span>${Math.round(h.durability)} / ${dh.durability}</span></div>` : ''); })()}
          <div class="row"><span class="k">Vanno</span><span>${metres(Math.hypot(p.position.x - ctx.world.map.BASE.x, p.position.z - ctx.world.map.BASE.z))}</span></div>
          ${kitHas ? `<div class="row"><span class="k">Kit in the field</span><span>${metres(kitD)} ${kitB}</span></div>` : ''}
          ${d.money < 0 ? '<div class="arrears">Account in arrears — the crate is closed</div>' : ''}
          ${ctx.damage?.fracture ? '<div class="bleed">Fracture — splint</div>' : ''}
          ${d.bleeding ? '<div class="bleed">Bleeding — bandage</div>' : ''}`;
      } else {
        // Only what is currently wrong, in the order it will kill you. Six lines is the ceiling; in a
        // healthy hour outside the base this block is one line or none, which is what makes the moment
        // it fills up mean something.
        const parts = [];
        const tideS = ctx.time.tideIn();
        if (tideS < 3600) {
          parts.push(`<span class="${tideS < 600 ? 'bleed' : 'torch'}">tide ${ctx.time.tideInText()}</span>`);
          parts.push(`<span class="dim">vanno ${metres(Math.hypot(p.position.x - ctx.world.map.BASE.x, p.position.z - ctx.world.map.BASE.z))}</span>`);
        }
        if (d.bleeding) parts.push('<span class="bleed">bleeding</span>');
        if (ctx.damage?.fracture) parts.push('<span class="bleed">leg · splint</span>');
        if (d.hp < 55) parts.push(`<span class="${d.hp < 30 ? 'lowhp' : ''}">${d.hp < 16 ? 'failing' : d.hp < 30 ? 'critical' : 'hurt'}</span><span class="hpline"><i style="width:${Math.max(0, Math.round(d.hp))}%"></i></span>`);
        if (rounds >= 0 && rounds + reserve <= 8) parts.push(`<span class="${rounds + reserve <= 3 ? 'bleed' : 'lowhp'}">${rounds + reserve === 0 ? 'no rounds' : `${rounds + reserve} rounds`}</span>`);
        if (d.flashlight.on) parts.push(`<span class="${d.flashlight.battery < 20 ? 'bleed' : 'torch'}">torch ${Math.round(d.flashlight.battery)}</span>`);
        if (kitHas) parts.push(`<span class="kit">kit ${metres(kitD)} ${kitB}</span>`);
        const html = parts.slice(0, 6).join('<br>'); if (status.innerHTML !== html) status.innerHTML = html;
      }
      if (hintT > 0) { hintT -= dt; if (hintT <= 0) hint.classList.add('hidden'); }
      if (dmgT > 0) { dmgT -= dt; dmgArc.style.opacity = Math.min(1, dmgT / 0.5).toFixed(2); dmgArc.style.transform = `rotate(${(dmgAngle * 180 / Math.PI).toFixed(1)}deg)`; } else if (dmgArc.style.opacity !== '0') dmgArc.style.opacity = '0';
    },
  };
  return api;
}
