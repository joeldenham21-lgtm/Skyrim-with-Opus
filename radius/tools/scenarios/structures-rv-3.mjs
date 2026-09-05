// Review pass 3: the white patch with enemies enabled (as in the soak), yaw 1.5; dump lights and enemies near the view.
export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.teleport(150, -60); r.setLook(1.5, -0.08); r.setTime(7); })()`);
  await api.frames(12);
  await api.screenshot('o12-w-enemies');
  const info = await api.run(`(() => {
    const ctx = window.__radius.ctx, T = ctx.THREE; const rc = new T.Raycaster(); const out = {}; const lights = []; const ens = [];
    ctx.scene.traverse((o) => { if (o.isLight && o.intensity > 0.01 && !o.isHemisphereLight && !o.isAmbientLight && !o.isDirectionalLight) { const p = new T.Vector3(); o.getWorldPosition(p); if (p.distanceTo(ctx.player.position) < 80) lights.push({ type: o.type, name: o.name, i: +o.intensity.toFixed(2), d: o.distance, p: p.toArray().map((v) => +v.toFixed(1)), parent: o.parent && o.parent.name, vis: o.visible }); } });
    for (const e of ctx.enemies.list) if (e.position.distanceTo(ctx.player.position) < 80) ens.push({ t: e.type, p: e.position.toArray().map((v) => +v.toFixed(1)), st: e.state, alive: e.alive });
    for (let i = -0.9; i <= 0.9; i += 0.15) for (let j = -0.6; j <= 0.2; j += 0.1) {
      rc.setFromCamera(new T.Vector2(i, j), ctx.camera);
      const h = rc.intersectObjects(ctx.scene.children, true)[0]; if (!h) continue;
      const o = h.object, m = Array.isArray(o.material) ? o.material[0] : o.material;
      const k = (o.name || '?') + '|' + (o.parent && o.parent.name || '') + '|' + m.type;
      if (!out[k]) out[k] = { n: 0, col: m.color && m.color.getHexString(), em: m.emissive && m.emissive.getHexString(), vc: !!m.vertexColors, hasCol: !!o.geometry.attributes.color, fog: m.fog, d: +h.distance.toFixed(1), p: h.point.toArray().map((v) => +v.toFixed(1)) };
      out[k].n++;
    }
    return { hits: out, lights, ens, tide: ctx.state.data.tideLevel, flash: ctx.state.data.flashlight }; })()`);
  console.log('info', JSON.stringify(info));
}
