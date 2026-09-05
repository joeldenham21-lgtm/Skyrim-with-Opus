// Small dressing across the zone: concrete slabs, pipes, tyres, barrels (some rusted through), the bus wreck
// in the ditch by the main road, wooden power poles with sagging wires along the main road. Placement is
// clustered and motivated (barrels behind sheds, tyres in the roadside ditch, slabs and pipes at the works).
import * as THREE from 'three';
import { createBuilder, instanced, colorize, placeMatrix, createWires, poleGeometry, poleLine, bus, frame, footprint, addCover, addHide, addSpawn, objCollider, material, timeUniform } from './structures.js';
import { ROADS, WATER_LEVEL, pointOnPolyline, distToPolyline } from './map.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RUST = [0.48, 0.29, 0.16];
function barrelGeometry(rustedThrough) {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 14, 1, rustedThrough, rustedThrough ? 0.9 : 0, rustedThrough ? Math.PI * 1.55 : Math.PI * 2);
  body.translate(0, 0.44, 0); parts.push(body);
  for (const y of [0.22, 0.66]) { const ring = new THREE.CylinderGeometry(0.31, 0.31, 0.05, 14, 1, true); ring.translate(0, y, 0); parts.push(ring); }
  if (!rustedThrough) { const lid = new THREE.CylinderGeometry(0.27, 0.29, 0.03, 14); lid.translate(0, 0.885, 0); parts.push(lid); }
  else { const bottom = new THREE.CylinderGeometry(0.29, 0.29, 0.02, 14); bottom.translate(0, 0.01, 0); parts.push(bottom); }
  for (const p of parts) { colorize(p, rustedThrough ? [0.36, 0.22, 0.13] : [0.30, 0.34, 0.30], { jitter: 0 }); }
  return mergeGeometries(parts, false);
}

export function createProps(ctx) {
  const world = ctx.world;
  const rnd = ctx.rng.fork(1301);
  const B = createBuilder(ctx, 'props'); B._world = world;
  const tag = 'props';
  const barrels = { mats: [], tints: [] }, rusted = { mats: [], tints: [] }, tyres = { mats: [], tints: [] }, slabs = { mats: [], tints: [] }, pipes = { mats: [], tints: [] };
  const dry = (x, z) => Math.abs(x) < 300 && Math.abs(z) < 300 && world.getHeight(x, z) > WATER_LEVEL + 0.2 && !world.pointInSolid(x, world.getHeight(x, z) + 0.5, z);
  const onRoad = (x, z) => ROADS.some((r) => distToPolyline(x, z, r.pts).d < r.width * 0.5 + 0.5);

  // ---- barrels: clusters behind buildings and at the works ----
  const barrelClusters = [
    [-118, 88, 4, 'zarya'], [-152, 30, 3, 'zarya'], [-98, 50, 3, 'zarya'], [145, -78, 6, 'object12'], [166, -48, 4, 'object12'], [131, -40, 3, 'object12'],
    [30, 205, 3, 'checkpoint'], [56, 168, 4, 'convoy'], [-40, -140, 3, 'rail'], [104, -170, 3, 'rail'], [-208, -84, 2, 'forest'], [12, 291, 3, 'vanno'], [44, -212, 2, 'church'],
  ];
  for (const [cx, cz, n, p] of barrelClusters) {
    let placed = 0;
    for (let i = 0; i < n * 3 && placed < n; i++) {
      const x = cx + (rnd() - 0.5) * 3.2, z = cz + (rnd() - 0.5) * 3.2;
      if (!dry(x, z) || onRoad(x, z)) continue;
      const y = world.getHeight(x, z); const fallen = rnd() < 0.22; const through = rnd() < 0.3;
      const m = fallen ? placeMatrix(x, y + 0.29, z, Math.PI / 2, rnd() * 6.28, 0) : placeMatrix(x, y - 0.03, z, (rnd() - 0.5) * 0.08, rnd() * 6.28, (rnd() - 0.5) * 0.08);
      const t = 0.7 + rnd() * 0.5; const hue = rnd();
      const tint = through ? [t, t * 0.95, t * 0.9] : hue < 0.4 ? [t * 0.9, t, t * 0.9] : hue < 0.7 ? [t, t * 0.95, t * 0.8] : [t * 0.8, t * 0.82, t];
      (through ? rusted : barrels).mats.push(m); (through ? rusted : barrels).tints.push(tint);
      if (fallen) objCollider(world, x, y + 0.3, z, 0.9, 0.6, 0.6, 0, { surface: 'metal', tag }); else world.addCylinder(x, z, 0.3, y, y + 0.88, { surface: 'metal', tag });
      placed++;
    }
    addCover(world, cx + 0.9, cz - 0.9);
    if (rnd() < 0.5) addHide(world, p, cx - 1.6, cz + 0.6);
  }
  // ---- tyres: roadside ditches, a heap by the convoy ----
  const tyreG = new THREE.TorusGeometry(0.42, 0.14, 7, 16); tyreG.rotateX(Math.PI / 2);
  colorize(tyreG, [0.10, 0.10, 0.095], { jitter: 0 });
  const road = ROADS[0];
  for (let i = 0; i < 26; i++) {
    const t = 0.05 + rnd() * 0.9; const p = pointOnPolyline(road.pts, t); const side = rnd() < 0.5 ? -1 : 1;
    const x = p.x - p.dz * side * (4 + rnd() * 3), z = p.z + p.dx * side * (4 + rnd() * 3);
    if (!dry(x, z)) continue;
    const y = world.getHeight(x, z); const stand = rnd() < 0.25;
    tyres.mats.push(stand ? placeMatrix(x, y + 0.42, z, Math.PI / 2, rnd() * 6, 0.1) : placeMatrix(x, y + 0.12, z, (rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3));
    const tn = 0.8 + rnd() * 0.4; tyres.tints.push([tn, tn, tn]);
  }
  for (let i = 0; i < 9; i++) { const x = 60 + (rnd() - 0.5) * 3, z = 150 + (rnd() - 0.5) * 3; if (!dry(x, z)) continue; const y = world.getHeight(x, z) + 0.14 + Math.floor(i / 4) * 0.28; tyres.mats.push(placeMatrix(x, y, z, (rnd() - 0.5) * 0.25, rnd() * 6, (rnd() - 0.5) * 0.25)); const tn = 0.8 + rnd() * 0.4; tyres.tints.push([tn, tn, tn]); }
  world.addBox(60, world.getHeight(60, 150) + 0.4, 150, 3, 0.8, 3, { surface: 'metal', tag }); addCover(world, 62.4, 150.5);
  // ---- concrete slabs: stacked at the works, dumped near the checkpoint and the village entrance ----
  const slabG = new THREE.BoxGeometry(3.0, 0.22, 1.2); colorize(slabG, [0.46, 0.45, 0.43], { jitter: 0, fn: (x) => [1 - 0.08 * Math.abs(Math.sin(x * 4)), 1, 1] });
  const slabPiles = [[128, -84, 5, 0.3], [172, -30, 4, -0.5], [6, 224, 3, 0.9], [-74, 76, 3, 1.4], [-36, -128, 2, 0.2], [14, 274, 3, 0.1], [95, -180, 2, 1.0]];
  for (const [cx, cz, n, ry] of slabPiles) {
    if (!dry(cx, cz)) continue;
    const y0 = world.getHeight(cx, cz);
    for (let i = 0; i < n; i++) { const off = (rnd() - 0.5) * 0.3; slabs.mats.push(placeMatrix(cx + off, y0 + 0.1 + i * 0.23, cz + (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.02, ry + (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.02)); const t = 0.85 + rnd() * 0.3; slabs.tints.push([t, t, t * 0.98]); }
    // one leaning against the pile
    slabs.mats.push(placeMatrix(cx + Math.cos(ry) * 0.0 - Math.sin(ry) * 1.3, y0 + 0.7, cz + Math.cos(ry) * 1.3, 1.15, ry, 0)); slabs.tints.push([0.9, 0.9, 0.88]);
    objCollider(world, cx, y0 + n * 0.12, cz, 3.0, n * 0.23 + 0.1, 1.2, ry, { surface: 'concrete', tag });
    objCollider(world, cx - Math.sin(ry) * 1.3, y0 + 0.6, cz + Math.cos(ry) * 1.3, 3.0, 1.3, 0.9, ry, { surface: 'concrete', tag });
    addCover(world, cx - Math.sin(ry) * 2.4, cz + Math.cos(ry) * 2.4); addCover(world, cx + Math.sin(ry) * 2.0, cz - Math.cos(ry) * 2.0);
    addHide(world, world.nearestPoi(cx, cz).poi.id, cx + Math.cos(ry) * 2.2, cz + Math.sin(ry) * 2.2);
  }
  // ---- pipes: big concrete pipes at the substation and the rail, steel pipes stacked by the checkpoint ----
  const pipeG = new THREE.CylinderGeometry(0.5, 0.5, 3.2, 14, 1, true); pipeG.rotateZ(Math.PI / 2); colorize(pipeG, [0.44, 0.43, 0.41], { jitter: 0 });
  const pipeSpots = [[160, -86, 3, 0.2], [-48, -136, 2, 1.2], [-96, 78, 2, 0.5], [118, -50, 2, -0.3]];
  for (const [cx, cz, n, ry] of pipeSpots) {
    if (!dry(cx, cz)) continue;
    const y0 = world.getHeight(cx, cz);
    for (let i = 0; i < n; i++) { const lateral = (i - (n - 1) / 2) * 1.05; const x = cx - Math.sin(ry) * lateral, z = cz + Math.cos(ry) * lateral; pipes.mats.push(placeMatrix(x, y0 + 0.5, z, 0, ry, (rnd() - 0.5) * 0.04)); const t = 0.85 + rnd() * 0.3; pipes.tints.push([t, t, t]); objCollider(world, x, y0 + 0.5, z, 3.2, 1.0, 1.0, ry, { surface: 'concrete', tag }); }
    if (n > 1) { pipes.mats.push(placeMatrix(cx, y0 + 1.36, cz, 0, ry, 0)); pipes.tints.push([0.9, 0.9, 0.9]); objCollider(world, cx, y0 + 1.36, cz, 3.2, 1.0, 1.0, ry, { surface: 'concrete', tag }); }
    addCover(world, cx + Math.sin(ry) * (n * 0.6 + 0.9), cz - Math.cos(ry) * (n * 0.6 + 0.9));
    addHide(world, world.nearestPoi(cx, cz).poi.id, cx, cz);   // inside a pipe
  }
  instanced(ctx, 'metal', barrelGeometry(false), barrels.mats, barrels.tints, { name: 'barrels' });
  instanced(ctx, 'metal', barrelGeometry(true), rusted.mats, rusted.tints, { name: 'barrels-rusted', matOpts: { key: 'ds', params: { side: THREE.DoubleSide } } });
  instanced(ctx, 'metal', tyreG, tyres.mats, tyres.tints, { name: 'tyres' });
  instanced(ctx, 'concrete', slabG, slabs.mats, slabs.tints, { name: 'slabs' });
  instanced(ctx, 'concrete', pipeG, pipes.mats, pipes.tints, { name: 'pipes' });

  // ---- bus wreck in the ditch beside the main road, south of the marsh road bend ----
  const bp = pointOnPolyline(road.pts, distToPolyline(28, 112, road.pts).t);
  const bo = { x: bp.x - bp.dz * 5.2, z: bp.z + bp.dx * 5.2 };
  const Fb = frame(bo.x, bo.z, Math.atan2(bp.dz, bp.dx) * -1 + 0.55);
  const by = footprint(world, bo.x, bo.z, 8, 3, Fb.ry).min - 0.35;
  bus(B, world, Fb, by, rnd, { tag, poi: 'marsh', paint: [0.62, 0.56, 0.36], roll: -0.16 });
  addSpawn(world, 'marsh', 'hidden', Fb.x(-5.5, 1), Fb.z(-5.5, 1));

  // ---- signposts and a road-km marker: a bent kilometre post, a concrete bollard row at the base road ----
  for (const t of [0.12, 0.31, 0.52, 0.74]) {
    const p = pointOnPolyline(road.pts, t); const x = p.x - p.dz * 4.2, z = p.z + p.dx * 4.2; if (!dry(x, z)) continue; const y = world.getHeight(x, z);
    B.box('concrete', 0.18, 0.7, 0.18, x, y + 0.3, z, [0.58, 0.57, 0.55], { rz: (rnd() - 0.5) * 0.2, jitter: 0.05, fn: (px, py) => (py > y + 0.45 ? [0.75, 0.15, 0.12] : [1, 1, 1]) });
  }
  // ---- wooden power poles along the main road with sagging wires ----
  const wires = createWires(ctx);
  const pm = poleLine(ctx, world, road.pts.slice(1), wires, { spacing: 30, side: 5.5, rnd, tag, cutChance: 0.12 });
  instanced(ctx, 'log', poleGeometry(true), pm, null, { name: 'road-poles' });
  wires.finish('road-wires');
  // ---- rubble and scrap: a few dark scrap heaps near the works (merged) ----
  for (const [cx, cz] of [[140, -84], [162, -40], [-68, -140], [-150, 32]]) {
    if (!dry(cx, cz)) continue;
    const y = world.getHeight(cx, cz);
    for (let i = 0; i < 7; i++) { const x = cx + (rnd() - 0.5) * 2.4, z = cz + (rnd() - 0.5) * 2.4; B.box('metal', 0.3 + rnd() * 0.9, 0.06 + rnd() * 0.15, 0.2 + rnd() * 0.6, x, y + 0.05 + rnd() * 0.25, z, [0.28, 0.2, 0.14], { rx: (rnd() - 0.5) * 0.6, ry: rnd() * 3, rz: (rnd() - 0.5) * 0.6, jitter: 0.15, noShadow: true }); }
    world.addBox(cx, y + 0.2, cz, 2.2, 0.4, 2.2, { surface: 'metal', tag, blocksBullets: false });
  }
  B.finish();
  return { update(dt, t) { timeUniform.value = t; }, reset() {} };
}
