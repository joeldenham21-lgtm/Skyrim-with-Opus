// In-game HUD (DOM). Menus and base panels live in ui/menus.js and ui/panels.js.
import { clamp01, damp, lerp } from '../core/math.js';

const CARDS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];

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

  let spread = 4, ammoT = 0, hintT = 0, objectiveTarget = null, objectiveText = '', gameVisible = true;
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
    setGameVisible(v) { gameVisible = v; for (const e of [crosshair, compass, status, objective]) e.classList.toggle('hidden', !v); if (!v) { prompt.classList.add('hidden'); watch.classList.add('hidden'); ammo.classList.add('hidden'); } },
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
    elements: { crosshair, prompt, notify, objective, compass, ammo, watch, status, hint, fade, dmgdir },
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
        mark.style.display = ''; mark.style.left = `${(bearing * PX).toFixed(1)}px`;
        // also copies for wrap
        const dist = Math.hypot(dx, dz);
        const dd = objective.querySelector('.dist'); if (dd) dd.textContent = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
      }
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
          ${w ? `<div class="row"><span class="k">${w.def.name}</span><span>${w.chamber + (w.mags[w.magIndex] ?? 0)} · ${w.mags.map((m) => m).join('/')}</span></div>` : ''}
          ${d.bleeding ? '<div class="bleed">Bleeding — bandage</div>' : ''}`;
      } else {
        const parts = [];
        if (d.bleeding) parts.push('<span class="bleed">bleeding</span>');
        if (d.hp < 30) parts.push('<span class="lowhp">critical</span>');
        if (d.flashlight.on) parts.push(`<span class="torch">torch ${Math.round(d.flashlight.battery)}</span>`);
        if (ctx.time.tideIn() < 3600) parts.push('<span class="bleed">tide</span>');
        const html = parts.join('<br>'); if (status.innerHTML !== html) status.innerHTML = html;
      }
      if (hintT > 0) { hintT -= dt; if (hintT <= 0) hint.classList.add('hidden'); }
      if (dmgT > 0) { dmgT -= dt; dmgArc.style.opacity = Math.min(1, dmgT / 0.5).toFixed(2); dmgArc.style.transform = `rotate(${(dmgAngle * 180 / Math.PI).toFixed(1)}deg)`; } else if (dmgArc.style.opacity !== '0') dmgArc.style.opacity = '0';
    },
  };
  return api;
}
