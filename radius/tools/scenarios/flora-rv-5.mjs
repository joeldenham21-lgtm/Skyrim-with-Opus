// Flora review pass 5 (final): the soak's exact 07:00 gate case at default density, forest edge at noon,
// night torch in the forest, then a tide reset and a second game.start() (state.data replaced) with no errors.
// node tools/smoke.mjs --out .smoke/flora-rv-5 --scenario tools/scenarios/flora-rv-5.mjs --w 640 --h 360
import { writeFileSync } from 'node:fs';
export default async function (page, api) {
  const crop = async (buf, x, y, w, h, name) => {
    const url = await page.evaluate(async ([src, x, y, w, h]) => {
      const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + src; });
      const cv = document.createElement('canvas'); cv.width = w * 3; cv.height = h * 3; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(im, x, y, w, h, 0, 0, w * 3, h * 3); return cv.toDataURL('image/png');
    }, [buf.toString('base64'), x, y, w, h]);
    writeFileSync(`${api.outDir}/${name}.png`, Buffer.from(url.split(',')[1], 'base64')); console.log('crop', name);
  };
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start()');
  await api.frames(3);
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 300000 }); };
  const go = async (x, z, yaw, pitch, hour, torch = false) => api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, ${pitch}); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; r.ctx.lighting.setFlashlight(${torch}); })()`);
  const shot = async (name) => { const p = `${api.outDir}/${name}.png`; const buf = await page.screenshot({ path: p, timeout: 180000 }); console.log('screenshot', p, await api.run('JSON.stringify(window.__radius.stats())')); return buf; };
  await go(0, 284, 0, 0.0, 7);
  await frames(6); await shot('00-gate-north-0700');
  await go(-200, -60, Math.PI / 2, -0.03, 12);
  await frames(5); const fe = await shot('01-forest-edge-1200'); await crop(fe, 430, 40, 200, 200, '01z-bark');
  await go(-215, -60, 1.9, -0.1, 22.5, true);
  await frames(5); await shot('02-night-torch-forest');
  // content reset paths: tide re-roll, then a fresh game (state.data is a new object)
  await api.run(`(() => { const c = window.__radius.ctx; c.state.data.tideLevel = 1; c.events.emit('tide', 1); })()`);
  await frames(2);
  console.log('after tide', await api.run(`JSON.stringify({ grass: window.__radius.ctx.flora.counts.grass, chunks: window.__radius.ctx.debris.chunks.count, err: window.__radius.ctx._errorLogged || false })`));
  await api.run('window.__radius.ctx.game.start(true)');
  await frames(3);
  console.log('after restart', await api.run(`JSON.stringify({ mode: window.__radius.ctx.mode, grass: window.__radius.ctx.flora.counts.grass, err: window.__radius.ctx._errorLogged || false })`));
}
