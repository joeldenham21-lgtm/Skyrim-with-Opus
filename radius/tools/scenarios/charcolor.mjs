// The mimic body renders as a pure black cutout with a glowing white face, while the helmet beside it is
// correctly lit khaki. Its material is MeshStandardMaterial with white albedo and vertexColors:true, so all
// its colour comes from the geometry's colour attribute — and any vertex never written defaults to (0,0,0),
// which is exactly black. Read the attribute and find out.
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true;`);
  await api.start();
  const out = await api.run(`(() => {
    const c = window.__radius.ctx, r = window.__radius, p = c.player.position;
    const e = r.spawn('mimic', p.x, p.z - 6, { cls: 'elite' });
    if (!e || !e.root) return { error: 'no spawn' };
    const meshes = [];
    e.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry, col = g.attributes.color;
      const m = o.material;
      const rec = {
        name: o.name || '(unnamed)',
        material: m ? m.type : null,
        vertexColors: m ? !!m.vertexColors : null,
        albedo: m && m.color ? '#' + m.color.getHexString() : null,
        emissive: m && m.emissive ? '#' + m.emissive.getHexString() : null,
        verts: g.attributes.position ? g.attributes.position.count : 0,
        hasColorAttr: !!col,
      };
      if (col) {
        const a = col.array; let zero = 0, sum = 0, mx = 0, n = col.count;
        const hist = { black: 0, dark: 0, mid: 0, light: 0, white: 0 };
        for (let i = 0; i < n; i++) {
          const rr = a[i * 3], gg = a[i * 3 + 1], bb = a[i * 3 + 2];
          const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
          if (rr === 0 && gg === 0 && bb === 0) zero++;
          sum += lum; if (lum > mx) mx = lum;
          if (lum < 0.02) hist.black++; else if (lum < 0.15) hist.dark++;
          else if (lum < 0.5) hist.mid++; else if (lum < 0.9) hist.light++; else hist.white++;
        }
        rec.colorStats = { count: n, exactlyZero: zero, zeroPct: +(100 * zero / n).toFixed(1),
                           meanLum: +(sum / n).toFixed(4), maxLum: +mx.toFixed(3), hist };
      }
      meshes.push(rec);
    });
    return { type: e.type, cls: e.cls, meshes };
  })()`);
  console.log('CHARCOLOR ' + JSON.stringify(out, null, 1));
  const bad = (out.meshes || []).filter((m) => m.colorStats && m.colorStats.zeroPct > 20);
  console.log('SUMMARY meshes=' + (out.meshes || []).length + ' withMostlyBlackVertexColours=' + bad.length
    + (bad.length ? ' -> ' + bad.map((b) => `${b.name}:${b.colorStats.zeroPct}%zero meanLum=${b.colorStats.meanLum}`).join(', ') : ''));
}
