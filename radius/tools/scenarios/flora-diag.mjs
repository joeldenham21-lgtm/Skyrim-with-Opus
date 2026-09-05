// Diagnostic: the same village-edge view with each flora mesh hidden in turn, to attribute what is on screen.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true; window.__radius.start()');
  const frames = async (n) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 300000 }); };
  const shoot = async (name) => { await frames(5); await page.screenshot({ path: `${api.outDir}/${name}.png`, timeout: 180000 }); console.log('screenshot', name); };
  await api.run('(() => { const r = window.__radius; r.teleport(-130, 135); r.setLook(0, -0.04); r.setTime(10); })()');
  await shoot('00-all');
  await api.run('window.__radius.ctx.flora.trees.visible = false');
  await shoot('01-no-trees');
  await api.run('for (const m of window.__radius.ctx.flora.reeds) m.visible = false; window.__radius.ctx.flora.grass.visible = false;');
  await shoot('02-no-plants');
  await api.run('window.__radius.ctx.debris.chunks.visible = false; window.__radius.ctx.debris.air.visible = false; window.__radius.ctx.debris.column.visible = false; window.__radius.ctx.debris.leaves.visible = false;');
  await shoot('03-nothing-of-mine');
  const near = await api.run(`(() => { const w = window.__radius.ctx.world; const p = window.__radius.ctx.player.position; const out = []; w.query(p.x, p.z, 25, (c) => { if (c.tag !== 'flora') out.push({ kind: c.kind, tag: c.tag, x: +(c.kind === 'cyl' ? c.x : (c.min.x + c.max.x) / 2).toFixed(1), z: +(c.kind === 'cyl' ? c.z : (c.min.z + c.max.z) / 2).toFixed(1), h: +(c.kind === 'cyl' ? c.y1 - c.y0 : c.max.y - c.min.y).toFixed(1) }); }); return JSON.stringify(out.slice(0, 20)); })()`);
  console.log('non-flora colliders within 25 m:', near);
}
