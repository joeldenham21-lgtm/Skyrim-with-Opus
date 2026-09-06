// Sheet 61, Vanno sector: the hand-drawn map on Committee stock. Stipple, hatched rail, dashed roads, POI glyphs,
// plus the field annotations: discovered containers and corpses (ctx.loot.markers), squad sightings
// (ctx.squads.sightings), contract objectives, and the Explorer. Both feeds are optional and read defensively.
// Panel module for ui/panels.js: { id, title, render(ctx, api, data) -> HTMLElement, onKey(e), onClose() }.
import { esc, ensureStyle } from './menus.js';

const CSS = `
#panels .sheet.pnl.map-card { width: auto; height: auto; max-height: 92vh; }
#panels .p-map canvas { display: block; }
#panels .p-map .legend { display: flex; flex-wrap: wrap; gap: 2px 16px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-dim); margin-top: 8px; }
#panels .p-map .legend span { white-space: nowrap; }
#panels .p-map .legend .amb { color: var(--amber-ink); }
#panels .p-map .legend .red { color: var(--red-ink); }
#panels .p-map .lines { margin-top: 4px; font-size: 11px; color: var(--ink-dim); line-height: 1.5; }
#panels .p-map .lines .amb { color: var(--amber-ink); letter-spacing: 0.1em; text-transform: uppercase; font-size: 10px; margin-right: 6px; }
#panels .p-map .lines .dim { color: var(--ink-faint); }
`;
const INK = 'rgba(26,25,23,';
const AMBER = '#a8672a', RED = '#8b2d20';
// tolerant readers for the optional feeds
const px = (o) => (o && (o.position || o.pos)) || o || {};
const xz = (o) => { const p = px(o); return typeof p.x === 'number' ? { x: p.x, z: typeof p.z === 'number' ? p.z : (p.y ?? 0) } : null; };
const distText = (d) => d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;

function missionTargets(ctx, m) {
  if (!m) return [];
  const out = [];
  const M = ctx.world.map;
  if (Array.isArray(m.points)) for (const p of m.points) if (!p.done) out.push({ x: p.x, z: p.z });
  if (m.relay && !m.planted) out.push({ x: m.relay.x, z: m.relay.z });
  if (ctx.missions?.deliverable?.(m)) return [{ x: M.BASE.x, z: M.BASE.z, base: true }];
  if (m.spot && typeof m.spot.x === 'number' && !m.recovered) out.push({ x: m.spot.x, z: m.spot.z });
  const t = m.target || m.position || m.pos || m.at;
  if (t && typeof t.x === 'number') out.push({ x: t.x, z: t.z ?? t.y });
  if (!out.length) { const id = m.poi || m.poiId || m.location; const p = id && M.poi(typeof id === 'string' ? id : id.id); if (p) out.push({ x: p.x, z: p.z, area: p.r }); }
  return out;
}

function drawMap(ctx, cv, feeds) {
  const M = ctx.world.map, dpr = Math.min(2, window.devicePixelRatio || 1);
  const S = cv.clientWidth || +cv.style.width.replace('px', '') || 480; cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const margin = 38, scale = (S - margin * 2) / M.SIZE, fs = Math.max(7.5, Math.min(11, S / 64));   // label size follows the sheet
  const label = (text, x, y, align = 'left') => {
    const w = g.measureText(text).width;
    let lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    if (align === 'left' && lx + w > S - margin - 2) lx = x - 18 - w;   // flip to the other side of the symbol
    lx = Math.max(margin + 2, Math.min(S - margin - 2 - w, lx));
    g.textAlign = 'left'; g.fillText(text, lx, y);
  };
  const X = (x) => margin + (x + M.HALF) * scale, Y = (z) => margin + (z + M.HALF) * scale;
  let seed = 1987; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  g.fillStyle = '#d6d0c0'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { g.fillStyle = INK + (0.03 + rnd() * 0.06) + ')'; g.fillRect(rnd() * S, rnd() * S, 1, 1); }
  // grid every 100 m with coordinates
  g.strokeStyle = INK + '0.14)'; g.lineWidth = 1; g.font = '9px "IBM Plex Mono", monospace'; g.fillStyle = INK + '0.5)';
  for (let v = -300; v <= 300; v += 100) {
    const gx = Math.round(X(v)) + 0.5, gy = Math.round(Y(v)) + 0.5;
    g.beginPath(); g.moveTo(gx, margin); g.lineTo(gx, S - margin); g.moveTo(margin, gy); g.lineTo(S - margin, gy); g.stroke();
    g.textAlign = 'center'; g.fillText(String(v).replace('-', '−'), gx, margin - 8);
    g.textAlign = 'right'; g.fillText(String(v).replace('-', '−'), margin - 6, gy + 3);
  }
  g.strokeStyle = INK + '0.55)'; g.strokeRect(margin + 0.5, margin + 0.5, S - margin * 2, S - margin * 2);
  const wob = (v) => v + (rnd() - 0.5) * 1.6;
  const poly = (pts, dash, width, alpha) => {
    g.setLineDash(dash); g.lineWidth = width; g.strokeStyle = INK + alpha + ')'; g.beginPath();
    pts.forEach(([x, z], i) => { const ax = wob(X(x)), ay = wob(Y(z)); i ? g.lineTo(ax, ay) : g.moveTo(ax, ay); });
    g.stroke(); g.setLineDash([]);
  };
  // marsh: stippled blob, denser toward the centre; vents drawn as short wavers
  const marsh = M.poi('marsh'), vents = M.poi('vents');
  if (marsh) for (let i = 0; i < 900; i++) { const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * marsh.r * scale * (0.85 + 0.3 * Math.sin(a * 3 + 1)); g.fillStyle = INK + (0.22 + rnd() * 0.2) + ')'; g.fillRect(X(marsh.x) + Math.cos(a) * r, Y(marsh.z) + Math.sin(a) * r * 0.8, 1.2, 1.2); }
  g.strokeStyle = INK + '0.5)'; g.lineWidth = 0.8;
  if (vents) for (let i = 0; i < 14; i++) { const cx = X(vents.x) + (rnd() - 0.5) * vents.r * scale * 1.4, cy = Y(vents.z) + (rnd() - 0.5) * vents.r * scale * 1.4; g.beginPath(); for (let k = 0; k <= 6; k++) g.lineTo(cx + k * 1.6, cy + Math.sin(k * 1.9) * 1.4); g.stroke(); }
  // dead forest: sparse bare marks
  const forest = M.poi('forest');
  if (forest) for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * forest.r * scale; const cx = X(forest.x) + Math.cos(a) * r, cy = Y(forest.z) + Math.sin(a) * r; g.beginPath(); g.moveTo(cx, cy + 3); g.lineTo(cx, cy - 2); g.moveTo(cx, cy); g.lineTo(cx - 2, cy - 3); g.moveTo(cx, cy - 1); g.lineTo(cx + 2, cy - 4); g.stroke(); }
  // ridge: three hatched contour arcs along the north edge
  const ridge = M.poi('north'); g.strokeStyle = INK + '0.45)';
  if (ridge) for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = -ridge.r * 1.6; x <= ridge.r * 1.6; x += 6) { const ax = X(ridge.x + x), ay = Y(ridge.z + 8 + k * 9 + Math.sin(x * 0.07 + k) * 4 + Math.abs(x) * 0.12); x === -ridge.r * 1.6 ? g.moveTo(ax, ay) : g.lineTo(ax, ay); } g.stroke(); }
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
    const ax = X(p.x), ay = Y(p.z); g.strokeStyle = INK + '0.85)'; g.fillStyle = INK + '0.85)'; g.lineWidth = 1.1; g.setLineDash([]);
    let lx = ax + 9, ly = ay + 4, al = 'left';
    switch (p.kind) {
      case 'base': g.strokeRect(ax - 5, ay - 5, 10, 10); g.fillRect(ax - 1.5, ay - 1.5, 3, 3); break;
      case 'checkpoint': g.beginPath(); g.moveTo(ax - 6, ay); g.lineTo(ax + 6, ay); g.moveTo(ax - 6, ay - 3); g.lineTo(ax - 6, ay + 3); g.moveTo(ax + 6, ay - 3); g.lineTo(ax + 6, ay + 3); g.stroke(); break;
      case 'convoy': for (let k = -1; k <= 1; k++) g.strokeRect(ax - 3 + k * 5, ay - 2 + k * 3, 5, 3); break;
      case 'village': for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.4, r = 4 + (k % 3) * 4; g.strokeRect(ax + Math.cos(a) * r - 2, ay + Math.sin(a) * r * 0.7 - 2, 4, 4); } al = 'center'; lx = ax; ly = ay - 12; break;
      case 'industrial': g.beginPath(); g.moveTo(ax - 6, ay + 5); g.lineTo(ax - 6, ay - 3); g.lineTo(ax - 2, ay - 6); g.lineTo(ax + 2, ay - 3); g.lineTo(ax + 6, ay - 6); g.lineTo(ax + 6, ay + 5); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(ax - 8, ay - 8); g.lineTo(ax + 8, ay - 8); g.stroke(); break;
      case 'church': g.beginPath(); g.moveTo(ax, ay - 9); g.lineTo(ax, ay + 6); g.moveTo(ax - 4, ay - 5); g.lineTo(ax + 4, ay - 5); g.stroke(); g.strokeRect(ax - 4, ay + 1, 8, 5); break;
      case 'rail': lx = ax + 9; ly = ay - 8; break;
      case 'anomaly': g.setLineDash([2, 3]); g.beginPath(); g.arc(ax, ay, p.r * scale * 0.55, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.beginPath(); g.arc(ax, ay, 1.6, 0, Math.PI * 2); g.fill();
        al = 'center'; lx = ax; ly = p.id === 'vents' ? ay + p.r * scale * 0.55 + fs + 2 : ay - p.r * scale * 0.55 - 4; break;   // the vents sit under the marsh label, so theirs hangs below
      case 'marsh': al = 'center'; lx = ax; ly = ay + p.r * scale * 0.8 + fs + 3; break;   // under the stipple, clear of the ink
      case 'forest': al = 'center'; lx = ax; ly = ay - p.r * scale - 4; break;
      case 'ridge': al = 'center'; lx = ax; ly = ay + 26; break;
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

  // ---- field annotations ----
  // discovered containers and corpses: pencil marks; an emptied container is a filled square, a corpse a small cross with a bar
  g.lineWidth = 1;
  for (const mk of feeds.markers) {
    const p = xz(mk); if (!p) continue; const ax = X(p.x), ay = Y(p.z);
    const kind = String(mk.kind || mk.type || 'container'); const done = !!(mk.opened || mk.looted || mk.empty || mk.searched);
    g.strokeStyle = INK + (done ? '0.5)' : '0.85)'); g.fillStyle = INK + (done ? '0.35)' : '0.85)');
    if (/corpse|body|explorer/.test(kind)) { g.beginPath(); g.moveTo(ax - 3.5, ay); g.lineTo(ax + 3.5, ay); g.moveTo(ax, ay - 3.5); g.lineTo(ax, ay + 2.5); g.moveTo(ax - 2, ay - 2); g.lineTo(ax + 2, ay - 2); g.stroke(); }
    else if (/pile|mimic|drop/.test(kind)) { g.beginPath(); g.moveTo(ax, ay - 3.5); g.lineTo(ax + 3.5, ay + 2.5); g.lineTo(ax - 3.5, ay + 2.5); g.closePath(); done ? g.fill() : g.stroke(); }
    else { done ? g.fillRect(ax - 2.5, ay - 2.5, 5, 5) : g.strokeRect(ax - 2.5, ay - 2.5, 5, 5); }
  }
  // squad sightings: a chevron per report, fading with age; a count when the report carries one
  for (const s of feeds.sightings) {
    const p = xz(s); if (!p) continue; const ax = X(p.x), ay = Y(p.z);
    const age = typeof s.age === 'number' ? s.age : typeof s.t === 'number' ? Math.max(0, ctx.elapsed - s.t) : 0;
    const a = age > 600 ? 0.3 : age > 180 ? 0.55 : 0.9;
    g.strokeStyle = `rgba(139,45,32,${a})`; g.fillStyle = `rgba(139,45,32,${a})`; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(ax - 5, ay + 3); g.lineTo(ax, ay - 4); g.lineTo(ax + 5, ay + 3); g.stroke();
    const n = s.count ?? s.n ?? s.size; if (n > 1) { g.font = '8px "IBM Plex Mono", monospace'; g.textAlign = 'left'; g.fillText(String(n), ax + 6, ay + 3); }
    g.lineWidth = 1;
  }
  // contract objectives: amber crosses, the primary ringed; a whole-POI objective gets a dashed area
  feeds.targets.forEach((t, i) => {
    const tx = X(t.x), ty = Y(t.z); g.strokeStyle = AMBER; g.lineWidth = i === 0 ? 1.6 : 1.2;
    g.beginPath(); g.moveTo(tx - 6, ty - 6); g.lineTo(tx + 6, ty + 6); g.moveTo(tx + 6, ty - 6); g.lineTo(tx - 6, ty + 6); g.stroke();
    if (i === 0) { g.beginPath(); g.arc(tx, ty, 10, 0, Math.PI * 2); g.stroke(); }
    if (t.area) { g.setLineDash([3, 4]); g.beginPath(); g.arc(tx, ty, t.area * scale * 0.7, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
  });
  // the Explorer: a pencil circle with a heading tick
  const p = ctx.player.position, ex = X(p.x), ey = Y(p.z), yaw = ctx.player.yaw;
  g.strokeStyle = INK + '0.95)'; g.lineWidth = 1.4; g.beginPath(); g.arc(ex, ey, 4, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(ex - Math.sin(yaw) * 4, ey - Math.cos(yaw) * 4); g.lineTo(ex - Math.sin(yaw) * 11, ey - Math.cos(yaw) * 11); g.stroke();
  g.font = '9px "IBM Plex Mono", monospace'; g.fillStyle = INK + '0.9)'; label('E61', ex + 7, ey + 10);
}

export default {
  id: 'map', title: 'Pechorsk Restricted Zone · Sheet 61 · Vanno sector', form: '61-M', keys: 'Esc close · M close',
  render(ctx) {
    ensureStyle('ui-b-map', CSS);
    const root = document.createElement('div'); root.className = 'p-map';
    const d = ctx.state.data;
    const size = Math.round(Math.max(220, Math.min(window.innerHeight * 0.92 - 150, window.innerWidth * 0.62, 760)));   // 176: chrome, legend, contract lines
    const a = ctx.missions?.active; const active = Array.isArray(a) ? a : a ? [a] : [];
    const targets = active.flatMap((m) => missionTargets(ctx, m));
    let markers = [], sightings = [];
    try { markers = ctx.loot?.markers?.() || []; } catch { markers = []; }
    try { sightings = ctx.squads?.sightings?.() || []; } catch { sightings = []; }
    const p = ctx.player.position;
    const nContainers = markers.filter((m) => !/corpse|body|explorer|pile|mimic|drop/.test(String(m.kind || m.type || ''))).length, nCorpses = markers.length - nContainers;
    const legend = `<div class="legend"><span>— — road</span><span>┼┼ rail</span><span>· · · marsh</span><span>◌ anomaly field</span><span>□ container${nContainers ? ` · ${nContainers}` : ''}</span><span>■ emptied</span><span>┼ corpse${nCorpses ? ` · ${nCorpses}` : ''}</span><span class="red">Λ entities sighted${sightings.length ? ` · ${sightings.length}` : ''}</span><span>○ Explorer 61</span><span class="amb">× contract objective</span></div>`;
    const lines = active.length ? active.map((m) => { const t = missionTargets(ctx, m)[0]; const dist = t ? Math.hypot(t.x - p.x, t.z - p.z) : 0; return `<div><span class="amb">${esc(m.code || m.id)}</span>${esc(m.title || '')}${t ? ` · ${t.base ? 'deliver at Vanno' : 'objective'} ${distText(dist)} from position` : ''}</div>`; }).join('') : '<div class="dim">No contract active. Sheet annotations are the Explorer\'s own.</div>';
    root.innerHTML = `<canvas style="width:${size}px;height:${size}px"></canvas>${legend}<div class="lines">${lines}<div class="dim">Grid 100 m · north up · Day ${d.day} · ${ctx.time.clockText()} · Tide in ${ctx.time.tideInText()}</div></div>`;
    const cv = root.querySelector('canvas');
    const draw = () => drawMap(ctx, cv, { markers, sightings, targets });
    draw();
    requestAnimationFrame(() => { if (cv.isConnected && cv.clientWidth && Math.abs(cv.clientWidth - size) > 2) draw(); });   // the sheet may lay out narrower than asked
    return root;
  },
  onKey() { return false; },
  onClose() {},
};
