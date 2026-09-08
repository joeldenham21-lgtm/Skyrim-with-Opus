// Vanno bunker interior: screenshots from inside plus a geometry report, to chase mesh problems.
//   node tools/smoke.mjs --scenario tools/scenarios/bunker.mjs --out .smoke/bunker
//
// base_scene.js: FY 7.3 floor, CEIL 10.5, ROOM x -4.5..4.5, z 298.6..304.6, HALL z 296.4..298.6.
const ROOM = { x0: -4.5, x1: 4.5, y0: 7.3, y1: 10.5, z0: 298.6, z1: 304.6 };

export default async function (page, api) {
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  await api.start();
  await api.frames(3);

  // stand in the middle of the room, lights on, and look at each wall in turn
  await R(`r.teleport(0, 301.6, 7.3); r.setTime(12);`);
  await api.frames(4);

  const views = [
    ['north-door', 0, 0], ['east', -Math.PI / 2, 0], ['south', Math.PI, 0], ['west', Math.PI / 2, 0],
    ['ceiling', 0, 0.9], ['floor', 0, -0.9],
  ];
  for (const [name, yaw, pitch] of views) {
    await R(`c.player.setLook(${yaw}, ${pitch});`);
    await api.frames(3);
    await api.screenshot(`bunker-${name}`);
  }

  // from the hall, looking in — the view you get walking through the door
  await R(`r.teleport(0, 297.4, 7.3); c.player.setLook(${Math.PI}, 0);`);
  await api.frames(3);
  await api.screenshot('bunker-from-hall');

  // ---- geometry report: anything suspect that overlaps or surrounds the room ----
  const report = await R(`
    const THREE = window.__radius.ctx.THREE;
    const room = ${JSON.stringify(ROOM)};
    const box = new THREE.Box3(), size = new THREE.Vector3(), centre = new THREE.Vector3();
    const bad = { degenerate: [], nan: [], enormous: [], throughFloor: [], throughCeiling: [], outsideButOverlapping: [] };
    let meshes = 0, inRoom = 0;
    c.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      meshes++;
      let b;
      try { b = box.setFromObject(o); } catch { return; }
      if (b.isEmpty()) return;
      b.getSize(size); b.getCenter(centre);
      const name = o.name || o.geometry?.type || 'unnamed';
      const overlaps = b.max.x > room.x0 && b.min.x < room.x1 && b.max.z > room.z0 && b.min.z < room.z1
        && b.max.y > room.y0 - 1 && b.min.y < room.y1 + 1;
      if (!overlaps) return;
      inRoom++;
      const d = { name, size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)], centre: [+centre.x.toFixed(2), +centre.y.toFixed(2), +centre.z.toFixed(2)], count: o.count ?? 1 };
      if ([size.x, size.y, size.z, centre.x, centre.y, centre.z].some((v) => !Number.isFinite(v))) bad.nan.push(d);
      else if (size.x < 1e-4 && size.y < 1e-4 && size.z < 1e-4) bad.degenerate.push(d);
      else if (Math.max(size.x, size.y, size.z) > 60) bad.enormous.push(d);
      else {
        // a prop that pokes through the floor slab or the ceiling reads as a mesh error from inside
        if (b.min.y < room.y0 - 0.35 && b.max.y > room.y0 + 0.1) bad.throughFloor.push(d);
        if (b.max.y > room.y1 + 0.35 && b.min.y < room.y1 - 0.1) bad.throughCeiling.push(d);
      }
    });
    const trim = (a) => a.slice(0, 12);
    return { meshes, inRoom, nan: bad.nan, degenerate: trim(bad.degenerate), enormous: trim(bad.enormous),
             throughFloor: trim(bad.throughFloor), throughCeiling: trim(bad.throughCeiling),
             counts: { nan: bad.nan.length, degenerate: bad.degenerate.length, enormous: bad.enormous.length, throughFloor: bad.throughFloor.length, throughCeiling: bad.throughCeiling.length } };`);
  console.log('GEOMETRY', JSON.stringify(report, null, 1));

  // is the room actually sealed? cast rays at the walls from the middle and report what they hit
  const walls = await R(`
    const dirs = { north: [0,0,-1], south: [0,0,1], east: [1,0,0], west: [-1,0,0], up: [0,1,0], down: [0,-1,0] };
    const o = new (window.__radius.ctx.THREE.Vector3)(0, 8.9, 301.6);
    const out = {};
    for (const [k, d] of Object.entries(dirs)) {
      const v = new (window.__radius.ctx.THREE.Vector3)(d[0], d[1], d[2]);
      const hit = c.world.raycast(o, v, 40);
      out[k] = hit ? { d: +hit.distance.toFixed(2), surface: hit.surface } : null;
    }
    return out;`);
  console.log('WALLS', JSON.stringify(walls));
  console.log('ERRORS', JSON.stringify(await R(`return [...(c._errors || [])];`)));
}
