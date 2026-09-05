// Flora review pass 3: bush rework, twig-free shadow pass (trunk speckle), flora+debris draw-call share.
// node tools/smoke.mjs --out .smoke/flora-rv-3 --scenario tools/scenarios/flora-rv-3.mjs --w 640 --h 360
import { writeFileSync } from 'node:fs';
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start()');
  await api.frames(3);
  console.log('flora', await api.run(`JSON.stringify({ counts: window.__radius.ctx.flora.counts, tier: window.__radius.ctx.flora.tier })`));
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 300000 }); };
  const go = async (x, z, yaw, pitch, hour) => api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); })()`);
  const shot = async (name) => { const p = `${api.outDir}/${name}.png`; const buf = await page.screenshot({ path: p, timeout: 180000 }); console.log('screenshot', p, await api.run('JSON.stringify(window.__radius.stats())')); return buf; };
  const crop = async (buf, x, y, w, h, name) => {
    const url = await page.evaluate(async ([src, x, y, w, h]) => {
      const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + src; });
      const cv = document.createElement('canvas'); cv.width = w * 3; cv.height = h * 3; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(im, x, y, w, h, 0, 0, w * 3, h * 3); return cv.toDataURL('image/png');
    }, [buf.toString('base64'), x, y, w, h]);
    writeFileSync(`${api.outDir}/${name}.png`, Buffer.from(url.split(',')[1], 'base64')); console.log('crop', name);
  };
  await api.run('window.__radius.ctx.state.data.settings.grain = 0');
  const near = await api.run(`(() => { const f = window.__radius.ctx.flora; let b = null, bd = 1e9; for (const p of f.placed) { if (p.kind !== 'bush') continue; const d = Math.hypot(p.x + 130, p.z - 135); if (d < bd) { bd = d; b = p; } } return JSON.stringify([b.x, b.z]); })()`);
  const bush = JSON.parse(near);
  await go(bush[0], bush[1] + 4.5, 0, -0.18, 12);
  await frames(5); await shot('00-bush-1200');
  await go(-200, -60, Math.PI / 2, -0.03, 12);
  await frames(5); const a = await shot('01-forest-edge-1200');
  await crop(a, 430, 40, 200, 200, '01z-bark');
  await crop(a, 40, 160, 220, 120, '01z-far-trunks');
  // draw-call share: everything of ours hidden vs shown, same view
  const vis = (on) => api.run(`(() => { const c = window.__radius.ctx; const f = c.flora, d = c.debris; f.trees.visible = ${on}; f.grass.visible = ${on}; for (const r of f.reeds) r.visible = ${on}; d.chunks.visible = ${on}; d.column.visible = ${on}; d.air.visible = ${on}; d.leaves.visible = ${on} && d.leaves.visible; })()`);
  const st = async () => api.run('(() => { const s = window.__radius.stats(); return JSON.stringify({ calls: s.calls, tris: s.triangles }); })()');
  await frames(2); console.log('forest with flora+debris', await st());
  await vis(false); await frames(2); console.log('forest without', await st());
  await vis(true);
  await go(-40, 120, 0, -0.06, 12);
  await frames(4); await shot('02-marsh-reeds-1200');
  console.log('marsh with', await st());
  await vis(false); await frames(2); console.log('marsh without', await st());
  await vis(true);
}
