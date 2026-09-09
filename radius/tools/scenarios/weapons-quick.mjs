// Cheapest possible model gallery: no api.start(), no api.frames() — each screenshot forces the one paint it needs.
// Under a loaded SwiftShader box a rendered frame costs tens of seconds, so waiting on six of them per run is the
// difference between a two-minute pass and a timeout. GUNS=akm,toz node tools/smoke.mjs --scenario ... --w 512 --h 288
const IDS = (process.env.GUNS || 'akm,toz,mosin').split(',');
export default async function (page, api) {
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx, T = c.THREE;
    c.debug.noEnemies = true; r.start(); r.god(); r.teleport(30, 130); r.setLook(0.6, 0.34); r.setTime(12);
    c.hands.root.visible = false;
    const studio = new T.Group(); studio.name = 'studio'; c.camera.add(studio);
    window.__studio = { show(id) {
      for (const ch of [...studio.children]) { studio.remove(ch); ch.traverse((o) => o.geometry && o.geometry.dispose()); }
      const g = window.__gunmesh.buildGun(id), pivot = new T.Group(); pivot.add(g); g.rotation.set(0, Math.PI / 2, 0);
      pivot.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(pivot), ctr = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
      g.position.sub(ctr);
      pivot.position.set(0, 0, -Math.max(0.28, Math.max(size.x / 2.0, size.y / 1.1) * 1.45));
      studio.add(pivot);
      return { id, len: +size.x.toFixed(3) };
    } };
  })()`);
  for (const id of IDS) {
    console.log('show', JSON.stringify(await api.run(`window.__studio.show(${JSON.stringify(id)})`)));
    await api.screenshot(id);
  }
  console.log('stats', JSON.stringify(await api.run(`window.__radius.stats()`)));
}
