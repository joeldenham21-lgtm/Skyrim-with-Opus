// Model gallery: builds each gun in isolation, centred in front of the camera against flat sky, side-on.
// GUNS=akm,pm node tools/smoke.mjs --out .smoke/ws --scenario tools/scenarios/weapons-studio.mjs --w 1280 --h 720
const IDS = (process.env.GUNS || 'akm,ak74m,mosin,sks,toz,mp153,bizon,sv98,pkm,pm').split(',');
const DIST = +(process.env.DIST || 0);
const VIEW = process.env.VIEW || 'side';   // side | three | front | top
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => {
    const r = window.__radius, c = r.ctx, T = c.THREE;
    r.god(); r.teleport(30, 130); r.setLook(0.6, ${VIEW === 'top' ? 0.9 : 0.34}); r.setTime(12);
    c.hands.root.visible = false;
    const studio = new T.Group(); studio.name = 'studio'; c.camera.add(studio);
    window.__studio = {
      show(id, dist, view) {
        for (const ch of [...studio.children]) { studio.remove(ch); ch.traverse((o) => o.geometry && o.geometry.dispose()); }
        const g = window.__gunmesh.buildGun(id);
        const pivot = new T.Group(); pivot.add(g);
        if (view === 'three') { g.rotation.set(0.0, Math.PI * 0.62, 0); }
        else if (view === 'front') { g.rotation.set(0, Math.PI, 0); }
        else if (view === 'top') { g.rotation.set(-Math.PI / 2, 0, Math.PI / 2); }
        else g.rotation.set(0, Math.PI / 2, 0);
        pivot.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(pivot); const ctr = box.getCenter(new T.Vector3()); const size = box.getSize(new T.Vector3());
        g.position.sub(ctr);
        const d = dist || Math.max(0.28, Math.max(size.x / 2.0, size.y / 1.1) * 1.45);
        pivot.position.set(0, 0, -d);
        studio.add(pivot);
        let tris = 0, meshes = 0;
        g.traverse((o) => { if (o.isMesh) { meshes++; const ix = o.geometry.index; tris += (ix ? ix.count : o.geometry.attributes.position.count) / 3; } });
        return { id, tris, meshes, len: +size.x.toFixed(3), h: +size.y.toFixed(3), d: +d.toFixed(2) };
      } };
  })()`);
  const rows = [];
  for (const id of IDS) {
    rows.push(await api.run(`window.__studio.show(${JSON.stringify(id)}, ${DIST}, ${JSON.stringify(VIEW)})`));
    await api.frames(2);
    await api.screenshot(id);
  }
  console.log('MODELS ' + JSON.stringify(rows));
}
