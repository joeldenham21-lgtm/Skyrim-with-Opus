// Materials gallery: every ctx.materials kind on 1.6 m cubes/spheres in rows by the gate, shot at 12:00
// and at 22:30 under the torch, plus the cards/decals and a 10 m tiling check for seams.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  const info = await api.run(`(() => {
    const r = window.__radius, ctx = r.ctx, T = ctx.THREE, M = ctx.materials;
    const kinds = M.kinds;
    const spheres = new Set(['steel', 'gunmetal', 'bakelite', 'rubber', 'leather', 'glass']);
    const t0 = performance.now();
    const group = new T.Group(); group.name = 'materials-gallery'; ctx.scene.add(group);
    const Z0 = 276, X0 = -6, step = 2.2, perRow = 6;
    const rows = [];
    kinds.forEach((kind, k) => {
      const row = Math.floor(k / perRow), col = k % perRow;
      const x = X0 + col * step, z = Z0 - row * 7;
      const size = 1.6;
      let geo;
      if (spheres.has(kind)) { geo = new T.SphereGeometry(size * 0.55, 40, 28); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * size * 1.1, uv.getY(i) * Math.PI * size * 0.55); }
      else { geo = new T.BoxGeometry(size, size, size); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size); }
      const mat = M.get(kind, kind === 'concrete' ? { damp: 0.6 } : {});
      const mesh = new T.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
      const y = ctx.world.getHeight(x, z) + size * 0.5 + 0.05;
      mesh.position.set(x, y, z); mesh.rotation.y = 0.35; group.add(mesh);
      if (!rows[row]) rows[row] = { z, cx: X0 + (perRow - 1) * step * 0.5, kinds: [] }; rows[row].kinds.push(kind);
    });
    // 10 m tiling check: one big concrete slab and a plank wall
    const slab = new T.Mesh(new T.BoxGeometry(10, 0.3, 4), M.get('concrete')); { const uv = slab.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 4); }
    slab.position.set(0, ctx.world.getHeight(0, 250) + 0.4, 250); slab.receiveShadow = true; group.add(slab);
    const wall = new T.Mesh(new T.BoxGeometry(10, 3, 0.2), M.get('planks')); { const uv = wall.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 3); }
    wall.position.set(0, ctx.world.getHeight(0, 246) + 1.6, 246); wall.castShadow = true; wall.receiveShadow = true; group.add(wall);
    const brick = new T.Mesh(new T.BoxGeometry(6, 3, 0.2), M.get('brick')); { const uv = brick.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 3); }
    brick.position.set(-9, ctx.world.getHeight(-9, 246) + 1.6, 246); brick.castShadow = true; brick.receiveShadow = true; group.add(brick);
    // cards and decals on quads
    const cardKinds = M.cardKinds;
    cardKinds.forEach((kind, k) => { const c = M.card(kind); const tall = c.map.image.height > c.map.image.width; const g = new T.PlaneGeometry(tall ? 0.5 : 1.2, tall ? 2 : 1.2); const m = new T.Mesh(g, M.get(kind)); const x = 8 + k * 1.4, z = 262; m.position.set(x, ctx.world.getHeight(x, z) + (tall ? 1.0 : 0.6), z); m.rotation.y = 0.2; group.add(m); });
    ['bullet_concrete', 'bullet_metal', 'bullet_wood', 'scorch', 'ash'].forEach((kind, k) => { const tex = M.decal(kind); const m = new T.Mesh(new T.PlaneGeometry(k > 2 ? 1.2 : 0.6, k > 2 ? 1.2 : 0.6), new T.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9 })); const x = 8 + k * 1.4, z = 260; m.position.set(x, ctx.world.getHeight(x, z) + 0.7, z); m.rotation.y = 0.2; group.add(m); });
    const backdrop = new T.Mesh(new T.BoxGeometry(8, 3, 0.2), M.get('concrete')); { const uv = backdrop.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 3); }
    backdrop.position.set(11, ctx.world.getHeight(11, 258) + 1.5, 258); backdrop.rotation.y = 0.2; group.add(backdrop);
    return { build: +(performance.now() - t0).toFixed(0), rows, stats: M.stats() };
  })()`);
  console.log('gallery', JSON.stringify(info));
  const shots = [['1200', 12.0, false], ['2230', 22.5, true]];
  for (const [tag, hour, torch] of shots) {
    for (let i = 0; i < info.rows.length; i++) {
      const row = info.rows[i];
      await api.run(`(() => { const r = window.__radius; r.teleport(${row.cx}, ${row.z + 6.5}); r.setLook(0, -0.22); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; })()`);
      await api.frames(4);
      await api.screenshot(`row${i}-${tag}-${row.kinds.join('_')}`);
    }
    // close-up: first row at 1 m
    await api.run(`(() => { const r = window.__radius; r.teleport(${info.rows[0].cx - 3.3}, ${info.rows[0].z + 2.4}); r.setLook(0.25, -0.2); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; })()`);
    await api.frames(4);
    await api.screenshot(`close-${tag}`);
    // tiling check + cards
    await api.run(`(() => { const r = window.__radius; r.teleport(0, 258); r.setLook(0, -0.28); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; })()`);
    await api.frames(4);
    await api.screenshot(`tiling-${tag}`);
    await api.run(`(() => { const r = window.__radius; r.teleport(11, 266); r.setLook(0, -0.12); r.setTime(${hour}); r.ctx.state.data.flashlight.on = ${torch}; })()`);
    await api.frames(4);
    await api.screenshot(`cards-${tag}`);
  }
  const st = await api.run('JSON.stringify(window.__radius.ctx.materials.stats())');
  console.log('materials.stats', st);
}
