// Pin down what intrudes into the Vanno bunker room: terrain height and surface across the floor
// plan, and whether a southward ray hits a collider or the terrain heightfield.
//   node tools/smoke.mjs --scenario tools/scenarios/bunker-probe.mjs --out .smoke/probe
// Deliberately minimal — no screenshots, few frames — so it runs fast under software rendering.
//
// base_scene.js: FY 7.3 floor, CEIL 10.5, ROOM x -4.5..4.5, z 298.6..304.6, HALL z 296.4..298.6.
export default async function (page, api) {
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  await api.start();
  await api.frames(2);

  console.log('REFERENCE floor 7.3  ceiling 10.5  room z 298.6..304.6  x -4.5..4.5');

  console.log('TERRAIN_HEIGHT', JSON.stringify(await R(`
    const out = {};
    for (let z = 296; z <= 308; z++) out['z' + z] = +c.world.getHeight(0, z).toFixed(2);
    return out;`)));

  console.log('TERRAIN_SURFACE', JSON.stringify(await R(`
    const out = {};
    for (let z = 298; z <= 306; z += 2) out['z' + z] = c.world.getSurface(0, z);
    return out;`)));

  console.log('SOUTH_RAY', JSON.stringify(await R(`
    const T = c.THREE;
    const hit = c.world.raycast(new T.Vector3(0, 8.9, 301.6), new T.Vector3(0, 0, 1), 40);
    if (!hit) return null;
    const col = hit.collider;
    return {
      distance: +hit.distance.toFixed(2),
      point: hit.point.toArray().map((v) => +v.toFixed(2)),
      surface: hit.surface,
      hitCollider: !!col,
      tag: col ? (col.tag ?? '(untagged)') : '(terrain heightfield)',
      colliderKeys: col ? Object.keys(col).join(',') : null,
      collider: col ? JSON.parse(JSON.stringify(col, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))) : null,
    };`)));

  console.log('POINT_IN_SOLID_AT_HEAD_HEIGHT', JSON.stringify(await R(`
    const out = {};
    for (const z of [299, 300, 301.6, 303, 304]) out['z' + z] = c.world.pointInSolid(0, 8.9, z);
    return out;`)));

  // every collider whose box overlaps the room volume, so a stray one cannot hide
  console.log('COLLIDERS_IN_ROOM', JSON.stringify(await R(`
    const found = [];
    c.world.query(0, 301.6, 12, (col) => {
      const cy = col.cy ?? 0, sy = col.sy ?? 0;
      if (cy - sy / 2 > 10.5 || cy + sy / 2 < 7.3) return;
      const cz = col.cz ?? 0, sz = col.sz ?? 0, cx = col.cx ?? 0, sx = col.sx ?? 0;
      if (cz - sz / 2 > 304.6 || cz + sz / 2 < 298.6) return;
      if (cx - sx / 2 > 4.5 || cx + sx / 2 < -4.5) return;
      found.push({ tag: col.tag ?? '(untagged)', surface: col.surface, passable: !!col.passable,
                   c: [+cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2)], s: [+sx.toFixed(2), +sy.toFixed(2), +sz.toFixed(2)] });
    });
    return found.slice(0, 25);`)));

  console.log('ERRORS', JSON.stringify(await R(`return [...(c._errors || [])];`)));
}
