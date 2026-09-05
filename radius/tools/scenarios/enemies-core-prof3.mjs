export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true; window.__radius.start();`);
  await api.wait(500);
  const r = await api.run(`(() => { const ctx = window.__radius.ctx; const rows = []; ctx.scene.traverse((o) => { if (!o.geometry) return; const idx = o.geometry.index; const tri = (idx ? idx.count : o.geometry.attributes.position.count) / 3; const n = o.isInstancedMesh ? o.count : 1; rows.push([o.type, o.name || o.parent?.name || '', Math.round(tri), n, Math.round(tri * n)]); }); rows.sort((a, b) => b[4] - a[4]); return rows.slice(0, 18); })()`);
  console.log(JSON.stringify(r));
}
