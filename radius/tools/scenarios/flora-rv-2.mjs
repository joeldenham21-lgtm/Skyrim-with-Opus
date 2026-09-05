// Flora review pass 2: gate at 07:00 with fuller grass, bush and stump close-ups, birch bark close-up,
// wind sway (two frames diffed in-page, grain off), placement audit by collider tag.
// node tools/smoke.mjs --out .smoke/flora-rv-2 --scenario tools/scenarios/flora-rv-2.mjs --w 640 --h 360
import { writeFileSync } from 'node:fs';
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start()');
  await api.frames(3);
  console.log('flora', await api.run(`JSON.stringify({ counts: window.__radius.ctx.flora.counts, tier: window.__radius.ctx.flora.tier })`));
  console.log('audit', await api.run(`(() => {
    const c = window.__radius.ctx, w = c.world, f = c.flora;
    const byTag = {}; let n = 0; const ex = [];
    for (const p of f.placed) {
      if (p.kind !== 'birch' && p.kind !== 'pine' && p.kind !== 'stump') continue;
      const y = p.y + 1.0;
      w.query(p.x, p.z, 0.4, (col) => {
        if (col.tag === 'flora' || col.passable) return;
        const inside = col.kind === 'box' ? (p.x >= col.min.x && p.x <= col.max.x && y >= col.min.y && y <= col.max.y && p.z >= col.min.z && p.z <= col.max.z)
          : (Math.hypot(p.x - col.x, p.z - col.z) < col.r && y >= col.y0 && y <= col.y1);
        if (!inside) return;
        n++; const t = col.tag || '(untagged)'; byTag[t] = (byTag[t] || 0) + 1;
        if (ex.length < 6) ex.push([p.kind, +p.x.toFixed(0), +p.z.toFixed(0), t, col.kind, col.walkable ? 'walkable' : '']);
      });
    }
    return JSON.stringify({ treesInsideOtherColliders: n, byTag, ex });
  })()`));
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 300000 }); };
  const go = async (x, z, yaw, pitch, hour) => api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); })()`);
  const shot = async (name) => { const p = `${api.outDir}/${name}.png`; const buf = await page.screenshot({ path: p, timeout: 180000 }); console.log('screenshot', p, await api.run('JSON.stringify(window.__radius.stats())')); return buf; };
  // in-page pixel diff of two screenshots (SwiftShader box has no image tools)
  const diff = (a, b) => page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height; const g = cv.getContext('2d');
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, cv.width, cv.height).data;
    g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, changed = 0, rows = new Array(8).fill(0);
    for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) { const i = (y * cv.width + x) * 4; n++; const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]); if (d > 36) { changed++; rows[Math.floor(y / cv.height * 8)]++; } }
    return { sampled: n, changed, byRowBand: rows };
  }, [a.toString('base64'), b.toString('base64')]);
  const crop = async (buf, x, y, w, h, name) => {
    const url = await page.evaluate(async ([src, x, y, w, h]) => {
      const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + src; });
      const cv = document.createElement('canvas'); cv.width = w * 3; cv.height = h * 3; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(im, x, y, w, h, 0, 0, w * 3, h * 3); return cv.toDataURL('image/png');
    }, [buf.toString('base64'), x, y, w, h]);
    writeFileSync(`${api.outDir}/${name}.png`, Buffer.from(url.split(',')[1], 'base64')); console.log('crop', name);
  };
  // 1) the gate at 07:00 with grass closer to real-GPU density: does the ground read lighter through the tufts?
  await api.run('window.__radius.ctx.flora.setDensity(0.8)');
  await go(0, 284, 0.15, -0.12, 7);
  await frames(6); const gate = await shot('00-gate-0700-grass');
  await crop(gate, 200, 220, 240, 120, '00z-gate-grass');
  await api.run('window.__radius.ctx.flora.setDensity(0.3)');
  // 2) a bush and a stump at the village edge, from 4 m
  const near = await api.run(`(() => { const f = window.__radius.ctx.flora; const pick = (k, cx, cz) => { let b = null, bd = 1e9; for (const p of f.placed) { if (p.kind !== k) continue; const d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; b = p; } } return [b.x, b.z]; }; return JSON.stringify({ bush: pick('bush', -130, 135), stump: pick('stump', -130, 135) }); })()`);
  const { bush, stump } = JSON.parse(near); console.log('near', near);
  await go(bush[0], bush[1] + 4.5, 0, -0.18, 12);
  await frames(5); await shot('01-bush-1200');
  await go(stump[0], stump[1] + 3.5, 0, -0.3, 12);
  await frames(5); await shot('02-stump-1200');
  // 3) forest edge at noon: bark close-up and the sway diff (grain off so only motion differs)
  await api.run('window.__radius.ctx.state.data.settings.grain = 0');
  await go(-200, -60, Math.PI / 2, -0.03, 12);
  await frames(5); const a = await shot('03-forest-edge-a');
  await frames(3); const b = await shot('04-forest-edge-b');
  console.log('sway diff', JSON.stringify(await diff(a, b)));
  await crop(a, 430, 40, 200, 200, '03z-bark');
  await crop(a, 40, 160, 220, 120, '03z-far-trunks');
}
