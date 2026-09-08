// Is a man at 30 m invisible because there are too few pixels, or because he is the same colour as what
// is behind him? Pin the render scale, put an armed mimic at 30 m, project him to screen space, and
// measure the actual pixels: his silhouette against the background immediately beside him.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  await api.run(`(() => {
    const ctx = window.__radius.ctx, s = ctx.state.data.settings;
    s.dynamicResolution = false; s.resolutionScale = 1; s.targetFps = 60;
    ctx.perf.scale = 1; ctx.perf.applyScale?.();
    window.__radius.god(true); window.__radius.setTime(11); window.__radius.teleport(60, 210);
  })()`);
  await api.frames(8);

  const shot = async (metres, label) => {
    await api.run(`(() => {
      const ctx = window.__radius.ctx, r = window.__radius;
      const p = ctx.player.position;
      for (const e of ctx.enemies.list) if (e.alive) e.removeMe = true;
      const e = r.spawn('mimic', p.x, p.z - ${metres}, { cls: 'regular' });
      if (e) {
        e.aware = true;
        // Freeze him. He is a live AI: between projecting his chest to screen space and the screenshot
        // landing he walks a metre or more, which at twenty metres is twenty pixels — enough for the
        // sample to land on the ground beside him and read as no contrast at all.
        e.update = () => {};
        e.speed = 0;
      }
      r.setLook(0, 0);
    })()`);
    await api.frames(25);
    // Where is he on screen? The WebGL canvas reads back black (no preserveDrawingBuffer), so the
    // pixels have to come from a real screenshot, decoded back into a 2D canvas in the page.
    const at = await api.run(`(() => {
      const ctx = window.__radius.ctx, THREE = ctx.THREE;
      const e = ctx.enemies.list.find((x) => x.alive); if (!e) return null;
      const cvs = ctx.renderer.domElement, W = cvs.clientWidth, H = cvs.clientHeight;
      const proj = (y) => { const v = new THREE.Vector3(e.position.x, e.position.y + y, e.position.z).project(ctx.camera); return { x: Math.round((v.x * 0.5 + 0.5) * W), y: Math.round((-v.y * 0.5 + 0.5) * H) }; };
      const feet = proj(0.05), head = proj(1.75), chest = proj(1.1);
      return { W, H, feet, head, chest, heightPx: Math.abs(feet.y - head.y) };
    })()`);
    if (!at) { console.log(label + ' {"found":false}'); return { found: false }; }
    const png = (await page.screenshot({ timeout: 180000 })).toString('base64');
    const m = await page.evaluate(async ([b64, at]) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const sx = img.width / at.W, sy = img.height / at.H;
      const lum = (x, y) => { const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data; return (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) / 255; };
      const box = (cx, cy, r) => { let s = 0, n = 0; for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) { if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue; s += lum(x, y); n++; } return n ? s / n : null; };
      const px = at.heightPx * sy;
      const cx = at.chest.x * sx, cy = at.chest.y * sy;
      const rad = Math.max(1, Math.round(px * 0.10));
      const off = Math.max(8, px * 0.6);
      const on = box(cx, cy, rad);
      const bg = (box(cx - off, cy, rad) + box(cx + off, cy, rad)) / 2;
      return { heightPx: at.heightPx, onTarget: +on.toFixed(4), background: +bg.toFixed(4),
               weber: bg > 1e-3 ? +(Math.abs(on - bg) / bg).toFixed(3) : null, shot: [img.width, img.height] };
    }, [png, at]);
    m.found = true; m.metres = metres;
    console.log(label + ' ' + JSON.stringify(m));
    return m;
  };

  const far = await shot(30, 'AT_30M');
  const mid = await shot(20, 'AT_20M');
  const near = await shot(10, 'AT_10M');
  const chain = await api.run(`(() => { const ctx = window.__radius.ctx; return { renderScale: ctx.perf.scale, drawing: ctx.renderer.getDrawingBufferSize(new ctx.THREE.Vector2()).toArray(), fog: ctx.scene.fog ? ctx.scene.fog.density : null }; })()`);
  console.log('CHAIN ' + JSON.stringify(chain));
  console.log(`SUMMARY 30m=${far.heightPx}px weber=${far.weber}  20m=${mid.heightPx}px weber=${mid.weber}  10m=${near.heightPx}px weber=${near.weber}`);
}
