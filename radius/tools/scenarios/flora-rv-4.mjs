// Flora review pass 4: is the dark cap on a near birch trunk shadow or albedo? Same view, tree shadows on/off,
// with pixel samples. node tools/smoke.mjs --out .smoke/flora-rv-4 --scenario tools/scenarios/flora-rv-4.mjs --w 640 --h 360
import { writeFileSync } from 'node:fs';
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start()');
  await api.frames(3);
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 300000 }); };
  const shot = async (name) => { const p = `${api.outDir}/${name}.png`; const buf = await page.screenshot({ path: p, timeout: 180000 }); console.log('screenshot', p); return buf; };
  const crop = async (buf, x, y, w, h, name) => {
    const r = await page.evaluate(async ([src, x, y, w, h]) => {
      const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + src; });
      const cv = document.createElement('canvas'); cv.width = w * 3; cv.height = h * 3; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(im, x, y, w, h, 0, 0, w * 3, h * 3);
      const full = document.createElement('canvas'); full.width = im.width; full.height = im.height; const fg = full.getContext('2d'); fg.drawImage(im, 0, 0);
      const px = (sx, sy) => Array.from(fg.getImageData(sx, sy, 1, 1).data).slice(0, 3);
      return { url: cv.toDataURL('image/png'), samples: { cap: px(x + 100, y + 30), mid: px(x + 100, y + 100), low: px(x + 100, y + 170) } };
    }, [buf.toString('base64'), x, y, w, h]);
    writeFileSync(`${api.outDir}/${name}.png`, Buffer.from(r.url.split(',')[1], 'base64')); console.log('crop', name, JSON.stringify(r.samples));
  };
  await api.run('(() => { const r = window.__radius; r.ctx.state.data.settings.grain = 0; r.teleport(-200, -60); r.setLook(Math.PI / 2, -0.03); r.setTime(12); })()');
  await frames(5); const a = await shot('00-shadows-on'); await crop(a, 430, 40, 200, 200, '00z-bark-shadows-on');
  await api.run('window.__radius.ctx.flora.trees.castShadow = false');
  await frames(3); const b = await shot('01-shadows-off'); await crop(b, 430, 40, 200, 200, '01z-bark-shadows-off');
  await api.run('window.__radius.ctx.flora.trees.castShadow = true');
}
