// Vanno: a UNPSC bunker half-buried in the rising southern edge. Exterior blockhouse face with a steel door and
// a lamp that is the way home at night; inside, a 9 x 6 m concrete room with the five stations, two fluorescent
// tubes (one failing), a drip, a cot, posters, a wall clock. The door is a fade-and-teleport.
import * as THREE from 'three';
import { createBuilder, material, colorize, placeMatrix, normalizeGeo, instanced, sandbagGeometry, sandbagWall, createWires, timeUniform, V3 } from '../world/structures.js';
import { BASE, START } from '../world/map.js';

const FY = 7.3;                    // interior floor top
const CEIL = FY + 3.2;
const ROOM = { x0: -4.5, x1: 4.5, z0: 298.6, z1: 304.6 };
const HALL = { x0: -0.9, x1: 0.9, z0: 296.4, z1: 298.6 };   // entrance corridor; the door is its north end
const DOOR_Z = 296.2;
const CONC = [0.44, 0.43, 0.41], CONC_IN = [0.52, 0.51, 0.48];

export function createBase(ctx) {
  const { world, scene } = ctx;
  const rnd = ctx.rng.fork(1401);
  const tag = 'vanno';
  const B = createBuilder(ctx, 'vanno'); B._world = world;
  const Bin = createBuilder(ctx, 'vanno-interior', { noShadow: true }); Bin._world = world;
  const anim = {};

  // ---------------------------------------------------------------- exterior
  const g0 = world.getHeight(0, 296);
  // blockhouse mass: front face, side walls buried into the mound, flat roof slab with a lip
  B.box('concrete', 10.4, 5.2, 0.5, 0, 8.4, 298.45, CONC, { ground: g0, jitter: 0.03 });   // north face (with the portal cut visually by the portal block in front)
  B.box('concrete', 10.4, 5.0, 7.0, 0, 8.5, 301.6, CONC, { ground: g0 + 0.3, jitter: 0.03 });   // the mass (sides show where the mound falls away)
  B.box('concrete', 10.8, 0.5, 7.6, 0, 11.0, 301.6, [0.40, 0.39, 0.37], { jitter: 0.03 });   // roof slab
  B.box('concrete', 10.8, 0.35, 0.4, 0, 11.35, 297.9, [0.40, 0.39, 0.37], { jitter: 0.03 });   // parapet lip over the face
  // portal: a squat concrete throat around the door, steps, apron
  B.box('concrete', 3.0, 4.3, 2.4, 0, 8.15, 297.2, CONC, { ground: g0, jitter: 0.03 });
  B.box('concrete', 3.4, 0.4, 2.8, 0, 10.5, 297.2, [0.40, 0.39, 0.37], { jitter: 0.03 });
  B.box('concrete', 3.2, 0.5, 1.4, 0, 6.25, 294.3, CONC, { ground: 5.9, jitter: 0.04 });      // apron top 6.5
  B.box('concrete', 2.8, 0.6, 0.8, 0, 6.6, 295.35, CONC, { ground: 6.0, jitter: 0.04 });      // step top 6.9
  B.box('concrete', 2.4, 0.5, 0.6, 0, 7.05, 296.0, CONC, { jitter: 0.04 });                   // sill 7.3
  // the steel door (closed): a heavy leaf with a wheel and hinges, recessed 0.2 into the throat
  const doorC = [0.30, 0.33, 0.31];
  B.box('metal', 1.3, 2.3, 0.1, 0, FY + 1.15, DOOR_Z, doorC, { jitter: 0.02 });
  B.box('metal', 1.6, 2.6, 0.08, 0, FY + 1.3, DOOR_Z - 0.06, [0.26, 0.27, 0.26], { jitter: 0.02 });   // frame flange
  B.box('metal', 1.1, 0.1, 0.06, 0, FY + 2.1, DOOR_Z - 0.09, doorC); B.box('metal', 1.1, 0.1, 0.06, 0, FY + 0.35, DOOR_Z - 0.09, doorC);
  B.geo('metal', new THREE.TorusGeometry(0.22, 0.03, 6, 16), placeMatrix(-0.2, FY + 1.2, DOOR_Z - 0.12, 0, 0, 0), [0.35, 0.36, 0.34], { jitter: 0 });
  for (const a of [0, 1.05, 2.1]) B.box('metal', 0.04, 0.4, 0.04, -0.2, FY + 1.2, DOOR_Z - 0.12, [0.35, 0.36, 0.34], { rz: a });
  for (const y of [FY + 0.5, FY + 1.9]) B.cyl('metal', 0.05, 0.05, 0.22, 0.72, y, DOOR_Z - 0.06, [0.28, 0.28, 0.27], { seg: 8 });
  // door lamp: a hooded fixture over the throat
  B.box('metal', 0.36, 0.1, 0.3, 0, FY + 2.75, DOOR_Z - 0.55, [0.25, 0.25, 0.24]);
  B.cyl('metal', 0.14, 0.05, 0.18, 0, FY + 2.62, DOOR_Z - 0.55, [0.25, 0.25, 0.24], { seg: 10, open: true });
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1612, emissive: 0xffb070, emissiveIntensity: 0, roughness: 0.4 }));
  lampBulb.position.set(0, FY + 2.55, DOOR_Z - 0.55); scene.add(lampBulb); anim.lampBulb = lampBulb;
  const doorLight = new THREE.PointLight(0xffb070, 0, 26, 1.8); doorLight.position.set(0, FY + 2.45, DOOR_Z - 1.25); scene.add(doorLight); anim.doorLight = doorLight;   // ahead of the hood so the leaf and the wheel catch it
  // the earth mound over the blockhouse: a lumpy ellipsoid, front cut back so the face stays clear
  const mound = new THREE.SphereGeometry(1, 28, 18);
  { const p = mound.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + 0.08 * Math.sin(x * 7.1 + z * 3.3) * Math.cos(y * 5.7 + x * 2.2) + 0.05 * Math.sin(z * 11.0 + y * 4.0); p.setXYZ(i, x * 9.8 * n, y * 4.6 * n, z * 7.6 * n); } mound.computeVertexNormals(); }
  B.geo('earth', mound, placeMatrix(0, 6.1, 306.4, 0, 0.1, 0), [1, 1, 1], { jitter: 0.05 });
  // vent stack and a rusted cable conduit on the roof, a stencil-free sign frame by the door
  B.cyl('metal', 0.18, 0.18, 1.6, 3.2, 11.9, 302.5, [0.28, 0.28, 0.26], { seg: 10 }); B.cyl('metal', 0.28, 0.28, 0.16, 3.2, 12.75, 302.5, [0.28, 0.28, 0.26], { seg: 10 });
  B.box('metal', 0.5, 0.36, 0.03, -2.2, FY + 1.9, 297.85, [0.62, 0.58, 0.45], { jitter: 0.03 });   // a small painted plate
  // sandbag walls flanking the approach
  const sandbags = { mats: [], tints: [] };
  for (const s of [-1, 1]) { const w = sandbagWall(world, [[s * 2.4, 292.6], [s * 3.4, 295.2], [s * 5.0, 296.4]], 3, rnd, { tag }); sandbags.mats.push(...w.mats); sandbags.tints.push(...w.tints); }
  instanced(ctx, 'sandbag', sandbagGeometry(), sandbags.mats, sandbags.tints, { name: 'vanno-sandbags' });
  // flag pole with a plain cloth (UNPSC blue-grey field, a pale disc), waving in the shader
  const fpx = 6.8, fpz = 293.2, fpy = world.getHeight(fpx, fpz);
  B.cyl('concrete', 0.45, 0.55, 0.5, fpx, fpy + 0.2, fpz, CONC, { seg: 10 });
  B.cyl('metal', 0.035, 0.05, 7.0, fpx, fpy + 3.9, fpz, [0.55, 0.56, 0.55], { seg: 8 });
  B.geo('metal', new THREE.SphereGeometry(0.07, 8, 6), placeMatrix(fpx, fpy + 7.45, fpz), [0.55, 0.56, 0.55], { jitter: 0 });
  world.addCylinder(fpx, fpz, 0.12, fpy, fpy + 7.4, { tag, surface: 'metal' });
  const flagG = new THREE.PlaneGeometry(1.6, 1.0, 24, 12); flagG.translate(0.8, 0, 0);
  colorize(flagG, [0.36, 0.46, 0.60], { jitter: 0 }); normalizeGeo(flagG);
  const flag = new THREE.Mesh(flagG, material('flag')); flag.position.set(fpx + 0.04, fpy + 6.8, fpz); flag.castShadow = true; scene.add(flag); anim.flag = flag;
  // generator hut east of the blockhouse: corrugated shed, exhaust, a drum, a cable to the bunker
  const hx = 7.6, hz = 300.4, hy = world.getHeight(hx, hz);
  B.box('concrete', 2.8, 0.3, 2.6, hx, hy + 0.05, hz, CONC, { jitter: 0.04 });
  for (const [w, d, ox, oz, ry] of [[2.4, 0.06, 0, -1.1, 0], [2.4, 0.06, 0, 1.1, 0], [0.06, 2.2, -1.2, 0, 0], [0.06, 2.2, 1.2, 0, 0]]) B.box('corrugated', w, 2.0, d, hx + ox, hy + 1.2, hz + oz, [0.40, 0.42, 0.40], { ry, ground: hy + 0.2, jitter: 0.04 });
  B.box('corrugated', 2.8, 0.06, 2.7, hx, hy + 2.3, hz, [0.40, 0.42, 0.40], { rz: -0.12, jitter: 0.04 });
  B.box('metal', 0.8, 1.4, 0.05, hx - 1.22, hy + 0.9, hz - 0.3, [0.32, 0.34, 0.32], { ry: 0.9, jitter: 0.03 });   // door ajar
  B.cyl('metal', 0.06, 0.06, 1.6, hx + 0.8, hy + 2.6, hz + 0.8, [0.2, 0.2, 0.19], { seg: 7 });
  B.cyl('metal', 0.29, 0.29, 0.88, hx - 0.4, hy + 0.44, hz + 1.9, [0.30, 0.34, 0.30], { seg: 12 });
  world.addBox(hx, hy + 1.2, hz, 2.8, 2.4, 2.6, { tag, surface: 'metal' }); world.addCylinder(hx - 0.4, hz + 1.9, 0.3, hy, hy + 0.9, { tag, surface: 'metal' });
  const wires = createWires(ctx); wires.span(V3(hx - 0.6, hy + 2.5, hz - 0.8), V3(4.9, 10.6, 300.2), 0.5, 8); wires.finish('vanno-wires');
  world.coverPoints.push(V3(hx + 2.0, hy, hz + 0.5), V3(-3.6, world.getHeight(-3.6, 294.6), 294.6), V3(3.9, world.getHeight(3.9, 294.8), 294.8));
  B.finish();

  // ---------------------------------------------------------------- exterior colliders
  const wallBox = (x0, x1, z0, z1, y0 = 6.0, y1 = 11.0) => world.addBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, { tag, surface: 'concrete' });
  wallBox(-5.2, -1.5, 297.9, 298.6); wallBox(1.5, 5.2, 297.9, 298.6);          // north face either side of the throat
  wallBox(-1.5, -0.9, 296.0, 298.6); wallBox(0.9, 1.5, 296.0, 298.6);          // throat walls
  wallBox(-0.9, 0.9, 295.95, DOOR_Z + 0.1, 6.0, 10.5);                          // the door itself (closed)
  wallBox(-5.2, -4.5, 298.2, 305.2); wallBox(4.5, 5.2, 298.2, 305.2);          // west / east
  wallBox(-5.2, 5.2, 304.6, 305.2);                                             // south
  world.addBox(0, 10.75, 301.6, 10.8, 0.5, 7.6, { tag, surface: 'concrete', passable: true, blocksBullets: true });  // roof: stops bullets and sight, never a floor (the load spawn probes from above)
  world.addBox(0, FY + 3.4, 297.5, 3.0, 0.4, 2.4, { tag, surface: 'concrete' });   // throat ceiling
  world.addBox(0, FY - 0.75, (ROOM.z0 + ROOM.z1) / 2, 9.0, 1.5, 6.0, { tag, surface: 'concrete' });   // floor
  world.addBox(0, FY - 0.75, (295.7 + HALL.z1) / 2, 1.8, 1.5, HALL.z1 - 295.7, { tag, surface: 'concrete' });   // corridor floor + sill
  world.addBox(0, 6.25, 294.3, 3.2, 0.5, 1.4, { tag, surface: 'concrete' }); world.addBox(0, 6.6, 295.35, 2.8, 0.6, 0.8, { tag, surface: 'concrete' });   // apron, step
  // The mound blocker keeps walkers off the hump outside. It used to span z 302.1..311.1, which
  // reached 2.5 m INSIDE the room (z 298.6..304.6) as solid mud from floor to ceiling: the south
  // third of the bunker was unreachable, shots and sight lines stopped half a metre from the
  // middle of the floor, and the mound's earth read through the south wall. Start it at the south
  // wall's outer face (305.2) instead, which keeps the hump covered and leaves the interior clear.
  world.addBox(0, 8.6, 308.15, 18, 4.0, 5.9, { tag, surface: 'mud', noAvoid: true });

  // ---------------------------------------------------------------- interior
  // floor, walls, ceiling (interior faces only; exterior mass is separate)
  Bin.box('concrete', 9.0, 0.1, 6.0, 0, FY - 0.05, (ROOM.z0 + ROOM.z1) / 2, [0.36, 0.36, 0.35], { jitter: 0.03 });
  Bin.box('concrete', 1.8, 0.1, HALL.z1 - HALL.z0, 0, FY - 0.05, (HALL.z0 + HALL.z1) / 2, [0.36, 0.36, 0.35], { jitter: 0.03 });
  const ivy = (x, y, z, w, h, d, o = {}) => Bin.box('concrete', w, h, d, x, y, z, CONC_IN, Object.assign({ ground: FY, dampH: 0.8, damp: 0.25, jitter: 0.03 }, o));
  ivy(-2.7, FY + 1.6, ROOM.z0 - 0.02, 3.6, 3.2, 0.04); ivy(2.7, FY + 1.6, ROOM.z0 - 0.02, 3.6, 3.2, 0.04);   // north wall either side of the corridor
  ivy(-4.52, FY + 1.6, 301.6, 0.04, 3.2, 6.0); ivy(4.52, FY + 1.6, 301.6, 0.04, 3.2, 6.0);                    // west / east
  ivy(0, FY + 1.6, ROOM.z1 + 0.02, 9.0, 3.2, 0.04);                                                            // south
  ivy(-0.92, FY + 1.3, 297.5, 0.04, 2.6, 2.2); ivy(0.92, FY + 1.3, 297.5, 0.04, 2.6, 2.2);                    // corridor sides
  ivy(0, FY + 2.9, 298.6, 1.8, 0.6, 0.04);                                                                     // lintel over the corridor mouth
  Bin.box('concrete', 9.0, 0.06, 6.0, 0, CEIL + 0.03, 301.6, [0.50, 0.50, 0.48], { jitter: 0.03 });
  Bin.box('concrete', 1.8, 0.06, 2.2, 0, FY + 2.6 + 0.03, 297.5, [0.50, 0.50, 0.48], { jitter: 0.03 });
  // inside of the door
  Bin.box('metal', 1.3, 2.3, 0.06, 0, FY + 1.15, DOOR_Z + 0.22, doorC, { jitter: 0.02 });
  Bin.geo('metal', new THREE.TorusGeometry(0.22, 0.03, 6, 16), placeMatrix(0.2, FY + 1.2, DOOR_Z + 0.28, 0, 0, 0), [0.35, 0.36, 0.34], { jitter: 0 });
  for (const a of [0, 1.05, 2.1]) Bin.box('metal', 0.04, 0.4, 0.04, 0.2, FY + 1.2, DOOR_Z + 0.28, [0.35, 0.36, 0.34], { rz: a });
  // ceiling pipes and conduit, a vent grille
  Bin.cyl('metal', 0.07, 0.07, 8.8, 0, CEIL - 0.25, 304.2, [0.36, 0.34, 0.30], { rz: Math.PI / 2, seg: 8 });
  Bin.cyl('metal', 0.07, 0.07, 3.0, 4.2, CEIL - 1.5, 304.2, [0.36, 0.34, 0.30], { seg: 8 });
  Bin.cyl('metal', 0.03, 0.03, 8.8, 0, CEIL - 0.12, 299.0, [0.25, 0.25, 0.24], { rz: Math.PI / 2, seg: 6 });
  Bin.box('metal', 0.6, 0.4, 0.04, -3.0, CEIL - 0.35, ROOM.z1 - 0.02, [0.28, 0.28, 0.27]);
  for (let i = 0; i < 6; i++) Bin.box('metal', 0.56, 0.03, 0.02, -3.0, CEIL - 0.52 + i * 0.065, ROOM.z1 - 0.05, [0.22, 0.22, 0.21]);
  // fluorescent fixtures: two, the east one failing
  const tubeMatA = material('tube', { key: 'A' }), tubeMatB = material('tube', { key: 'B' });
  tubeMatA.emissiveIntensity = 1.6; tubeMatB.emissiveIntensity = 1.6;
  const fixture = (x, z, mat) => {
    Bin.box('metal', 1.4, 0.06, 0.28, x, CEIL - 0.03, z, [0.72, 0.72, 0.70]);
    const g = new THREE.CylinderGeometry(0.02, 0.02, 1.25, 8); g.rotateZ(Math.PI / 2);
    // uv.x along the tube for the end darkening
    const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setX(i, (p.getX(i) + 0.625) / 1.25);
    colorize(g, [1, 1, 1], { jitter: 0 }); normalizeGeo(g);
    const m = new THREE.Mesh(g, mat); m.position.set(x, CEIL - 0.1, z); scene.add(m); return m;
  };
  fixture(-2.0, 301.4, tubeMatA); anim.tubeB = fixture(2.0, 301.4, tubeMatB);
  const tubeLight = new THREE.PointLight(0xdfe8d6, 5, 13, 1.7); tubeLight.position.set(-0.6, CEIL - 0.35, 301.5); scene.add(tubeLight); anim.tubeLight = tubeLight;
  const tubeLightB = new THREE.PointLight(0xdfe8d6, 2.4, 8, 1.7); tubeLightB.position.set(2.2, CEIL - 0.35, 301.4); scene.add(tubeLightB); anim.tubeLightB = tubeLightB;

  // ---- terminal desk (west wall): steel desk, CRT, keyboard, radio, chair, a shelf of binders above
  const dx = -3.7, dz = 300.6;
  Bin.box('metal', 0.9, 0.05, 1.7, dx, FY + 0.76, dz, [0.34, 0.36, 0.34], { jitter: 0.02 });
  for (const s of [-1, 1]) Bin.box('metal', 0.85, 0.72, 0.5, dx, FY + 0.37, dz + s * 0.6, [0.34, 0.36, 0.34], { jitter: 0.02 });
  world.addBox(dx, FY + 0.4, dz, 0.95, 0.8, 1.75, { tag, surface: 'metal' });
  Bin.box('paint', 0.42, 0.38, 0.44, dx + 0.02, FY + 0.98, dz + 0.1, [0.72, 0.70, 0.62], { ry: -0.2, jitter: 0.02 });   // CRT casing
  const crtG = new THREE.PlaneGeometry(0.32, 0.26); colorize(crtG, [1, 1, 1], { jitter: 0 }); normalizeGeo(crtG);
  const crt = new THREE.Mesh(crtG, material('crt')); crt.material.emissiveIntensity = 1.3; crt.position.set(dx + 0.24, FY + 0.99, dz + 0.06); crt.rotation.y = Math.PI / 2 - 0.2; scene.add(crt); anim.crt = crt;
  const crtLight = new THREE.PointLight(0x70ff90, 0.9, 2.6, 2.0); crtLight.position.set(dx + 0.5, FY + 1.05, dz + 0.06); scene.add(crtLight); anim.crtLight = crtLight;
  Bin.box('paint', 0.36, 0.03, 0.14, dx + 0.15, FY + 0.8, dz - 0.5, [0.66, 0.64, 0.56], { ry: 0.1, jitter: 0.02 });   // keyboard
  Bin.box('metal', 0.3, 0.16, 0.12, dx - 0.15, FY + 0.87, dz + 0.65, [0.36, 0.30, 0.20], { jitter: 0.03 }); Bin.cyl('metal', 0.01, 0.01, 0.5, dx - 0.2, FY + 1.2, dz + 0.7, [0.6, 0.6, 0.58], { rz: 0.3, seg: 4 });   // radio + aerial
  Bin.box('paint', 0.28, 0.005, 0.2, dx + 0.1, FY + 0.79, dz + 0.55, [0.85, 0.83, 0.75], { ry: 0.3, noShadow: true });   // a form
  Bin.box('metal', 0.45, 0.04, 0.45, dx + 0.85, FY + 0.46, dz - 0.1, [0.25, 0.27, 0.26], { ry: 0.5 }); Bin.box('metal', 0.42, 0.5, 0.04, dx + 1.05, FY + 0.72, dz - 0.12, [0.25, 0.27, 0.26], { ry: 0.5 });   // chair
  for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) Bin.cyl('metal', 0.015, 0.015, 0.45, dx + 0.85 + a, FY + 0.22, dz - 0.1 + b, [0.25, 0.27, 0.26], { seg: 5 });
  world.addBox(dx + 0.9, FY + 0.4, dz - 0.1, 0.5, 0.9, 0.5, { tag, surface: 'metal' });
  Bin.box('plank', 0.26, 0.03, 1.6, -4.34, FY + 1.75, dz, [0.42, 0.37, 0.27], { jitter: 0.05 });
  for (let i = 0; i < 7; i++) Bin.box('paint', 0.22, 0.3, 0.06, -4.34, FY + 1.92, dz - 0.7 + i * 0.16, [[0.35, 0.28, 0.22], [0.30, 0.36, 0.32], [0.55, 0.50, 0.40]][i % 3], { rz: i === 6 ? 0.25 : 0, jitter: 0.04 });
  // ---- steel locker (west wall, north of the desk)
  const lx = -4.2, lz = 299.3;
  Bin.box('paint', 0.55, 1.9, 0.5, lx, FY + 0.95, lz, [0.40, 0.46, 0.42], { jitter: 0.02 });
  for (let i = 0; i < 4; i++) Bin.box('metal', 0.25, 0.015, 0.02, lx + 0.28, FY + 1.6 - i * 0.04, lz, [0.2, 0.22, 0.2]);
  Bin.box('metal', 0.02, 0.12, 0.03, lx + 0.28, FY + 1.0, lz + 0.2, [0.6, 0.6, 0.58]);
  world.addBox(lx, FY + 0.95, lz, 0.6, 1.9, 0.55, { tag, surface: 'metal' });
  // ---- cot (south-west): steel frame, mattress, wool blanket with a rumple, pillow, boots
  const cx = -3.4, cz = 304.0;
  Bin.box('metal', 1.9, 0.05, 0.8, cx, FY + 0.42, cz, [0.30, 0.32, 0.30], { jitter: 0.03 });
  for (const [a, b] of [[-0.9, -0.35], [0.9, -0.35], [-0.9, 0.35], [0.9, 0.35]]) Bin.cyl('metal', 0.02, 0.02, 0.42, cx + a, FY + 0.21, cz + b, [0.30, 0.32, 0.30], { seg: 5 });
  Bin.box('canvas', 1.85, 0.14, 0.76, cx, FY + 0.51, cz, [0.45, 0.42, 0.34], { jitter: 0.03 });
  const blanket = new THREE.BoxGeometry(1.5, 0.08, 0.8, 12, 1, 6);
  { const p = blanket.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (y > 0) p.setY(i, y + 0.03 * Math.sin(x * 6 + 1) * Math.cos(z * 8) + 0.02 * Math.sin(x * 13)); } blanket.computeVertexNormals(); }
  Bin.geo('canvas', blanket, placeMatrix(cx + 0.15, FY + 0.62, cz, 0, 0.02, 0), [0.30, 0.34, 0.28], { jitter: 0.03 });
  Bin.box('canvas', 0.36, 0.1, 0.5, cx - 0.72, FY + 0.63, cz, [0.62, 0.60, 0.54], { ry: 0.1, jitter: 0.03 });
  world.addBox(cx, FY + 0.3, cz, 1.9, 0.7, 0.8, { tag, surface: 'metal' });
  for (const s of [0, 0.16]) Bin.box('metal', 0.12, 0.22, 0.3, cx - 0.3 + s, FY + 0.11, cz - 0.62, [0.12, 0.11, 0.10], { ry: s * 2, jitter: 0.03 });
  // ---- workbench (east wall): heavy bench, vice, pegboard with tools, hanging lamp, stool, oil can, rags
  const wx = 4.0, wz = 300.9;
  Bin.box('plank', 0.9, 0.1, 2.2, wx, FY + 0.88, wz, [0.40, 0.34, 0.24], { jitter: 0.03 });
  for (const [a, b] of [[-0.38, -1.0], [0.38, -1.0], [-0.38, 1.0], [0.38, 1.0]]) Bin.box('plank', 0.1, 0.83, 0.1, wx + a, FY + 0.42, wz + b, [0.36, 0.30, 0.22], { jitter: 0.03 });
  Bin.box('plank', 0.8, 0.04, 2.0, wx, FY + 0.25, wz, [0.36, 0.30, 0.22], { jitter: 0.03 });
  world.addBox(wx, FY + 0.45, wz, 0.95, 0.95, 2.2, { tag, surface: 'wood' });
  Bin.box('metal', 0.22, 0.16, 0.34, wx - 0.2, FY + 1.02, wz - 0.6, [0.22, 0.23, 0.22], { jitter: 0.02 }); Bin.box('metal', 0.1, 0.2, 0.3, wx - 0.2, FY + 1.12, wz - 0.6, [0.22, 0.23, 0.22]); Bin.cyl('metal', 0.015, 0.015, 0.36, wx - 0.2, FY + 1.16, wz - 0.75, [0.5, 0.5, 0.48], { rx: Math.PI / 2, seg: 5 });   // vice
  Bin.box('plank', 0.04, 1.2, 2.0, 4.46, FY + 1.75, wz, [0.55, 0.50, 0.38], { jitter: 0.03 });   // pegboard
  for (let i = 0; i < 8; i++) { const zz = wz - 0.85 + i * 0.24; const len = 0.18 + (i % 3) * 0.08; Bin.box('metal', 0.02, len, 0.05, 4.42, FY + 1.8 - (i % 2) * 0.25, zz, [0.28, 0.28, 0.27], { rx: (i % 2) * 0.3 }); if (i % 2) Bin.cyl('metal', 0.03, 0.03, 0.02, 4.42, FY + 1.8 - 0.25 - len / 2, zz, [0.28, 0.28, 0.27], { rz: Math.PI / 2, seg: 8 }); }
  Bin.cyl('metal', 0.07, 0.06, 0.2, wx + 0.1, FY + 1.03, wz + 0.6, [0.55, 0.30, 0.16], { seg: 8 }); Bin.box('canvas', 0.3, 0.05, 0.22, wx + 0.05, FY + 0.96, wz + 0.95, [0.45, 0.40, 0.30], { ry: 0.6, jitter: 0.05 });
  Bin.box('paint', 0.4, 0.14, 0.26, wx - 0.1, FY + 1.0, wz + 0.15, [0.36, 0.40, 0.26], { ry: -0.15, jitter: 0.03 });   // an ammo tin on the bench
  Bin.cyl('plank', 0.16, 0.14, 0.04, wx - 0.85, FY + 0.5, wz + 0.5, [0.4, 0.34, 0.24], { seg: 10 }); for (let i = 0; i < 3; i++) { const a = i * 2.1; Bin.cyl('plank', 0.02, 0.025, 0.5, wx - 0.85 + Math.cos(a) * 0.12, FY + 0.25, wz + 0.5 + Math.sin(a) * 0.12, [0.36, 0.30, 0.22], { seg: 5 }); }
  world.addCylinder(wx - 0.85, wz + 0.5, 0.18, FY, FY + 0.5, { tag, surface: 'wood' });
  const lamp = new THREE.Group(); lamp.position.set(wx - 0.15, CEIL, wz);
  const cordG = new THREE.CylinderGeometry(0.008, 0.008, 0.9, 5); cordG.translate(0, -0.45, 0); colorize(cordG, [0.1, 0.1, 0.1], { jitter: 0 }); normalizeGeo(cordG);
  lamp.add(new THREE.Mesh(cordG, material('metal')));
  const shadeG = new THREE.ConeGeometry(0.22, 0.16, 12, 1, true); shadeG.translate(0, -0.98, 0); colorize(shadeG, [0.30, 0.34, 0.30], { jitter: 0 }); normalizeGeo(shadeG);
  const shade = new THREE.Mesh(shadeG, material('metal', { key: 'ds', params: { side: THREE.DoubleSide } })); shade.castShadow = true; lamp.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffc890, emissiveIntensity: 2.2, roughness: 0.4 })); bulb.position.y = -1.0; lamp.add(bulb);
  const benchLight = new THREE.PointLight(0xffc98a, 5.5, 8.5, 1.8); benchLight.position.y = -1.04; lamp.add(benchLight);
  scene.add(lamp); anim.lamp = lamp;
  // ---- supply crate stack (south-east): a big wooden crate, olive ammo tins piled, a tarp
  const sx = 3.5, sz = 303.7;
  Bin.box('plank', 1.2, 0.8, 0.9, sx, FY + 0.4, sz, [0.42, 0.38, 0.27], { ry: 0.12, jitter: 0.04 });
  for (const s of [-0.5, 0.5]) Bin.box('plank', 0.04, 0.8, 0.9, sx + s, FY + 0.4, sz, [0.34, 0.30, 0.22], { ry: 0.12, jitter: 0.04 });
  Bin.box('plank', 1.2, 0.04, 0.9, sx, FY + 0.82, sz, [0.34, 0.30, 0.22], { ry: 0.12, jitter: 0.04 });
  let tinI = 0;
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) { const tx = sx - 0.45 + i * 0.36 + r * 0.16 + (rnd() - 0.5) * 0.03, tz = sz - 0.9 + (rnd() - 0.5) * 0.06; Bin.box('paint', 0.34, 0.16, 0.2, tx, FY + 0.08 + r * 0.17, tz, [0.34, 0.40, 0.26], { ry: (rnd() - 0.5) * 0.25, jitter: 0.06, seed: tinI++ }); Bin.box('metal', 0.14, 0.02, 0.03, tx, FY + 0.17 + r * 0.17, tz, [0.5, 0.5, 0.48], { ry: 0 }); }
  Bin.box('paint', 0.34, 0.16, 0.2, sx + 0.7, FY + 0.92, sz, [0.34, 0.40, 0.26], { ry: 0.4, jitter: 0.06 });
  Bin.box('canvas', 0.8, 0.04, 0.6, sx + 0.35, FY + 0.86, sz + 0.2, [0.36, 0.36, 0.28], { ry: 0.3, rx: 0.06, jitter: 0.04 });
  world.addBox(sx, FY + 0.4, sz, 1.4, 0.9, 1.0, { tag, surface: 'wood' }); world.addBox(sx - 0.1, FY + 0.25, sz - 0.9, 1.5, 0.5, 0.3, { tag, surface: 'metal' });
  // ---- wall clock, posters, a coat hook with a jacket, a bucket under the drip
  const kx = 2.3, kz = ROOM.z0 + 0.06;
  Bin.cyl('paint', 0.19, 0.19, 0.05, kx, FY + 2.45, kz, [0.88, 0.87, 0.82], { rx: Math.PI / 2, seg: 20 });
  Bin.cyl('metal', 0.2, 0.2, 0.06, kx, FY + 2.45, kz - 0.005, [0.2, 0.2, 0.19], { rx: Math.PI / 2, seg: 20, open: true });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; Bin.box('metal', 0.02, i % 3 === 0 ? 0.04 : 0.02, 0.005, kx + Math.sin(a) * 0.15, FY + 2.45 + Math.cos(a) * 0.15, kz + 0.03, [0.12, 0.12, 0.12], { rz: -a }); }
  const hands = new THREE.Group(); hands.position.set(kx, FY + 2.45, kz + 0.04); scene.add(hands);
  const handMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });
  const hourH = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.1, 0.004).translate(0, 0.04, 0), handMat); const minH = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.004).translate(0, 0.06, 0), handMat); const secH = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.16, 0.003).translate(0, 0.05, 0), new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.6 }));
  secH.position.z = 0.006; hands.add(hourH, minH, secH); anim.clock = { hourH, minH, secH };
  const poster = (x, y, z, ry, w, h, rgb) => { const g = new THREE.PlaneGeometry(w, h); colorize(g, rgb, { jitter: 0 }); normalizeGeo(g); const m = new THREE.Mesh(g, material('poster')); m.position.set(x, y, z); m.rotation.set(0, ry, (rnd() - 0.5) * 0.06); scene.add(m); };
  poster(-2.4, FY + 1.95, ROOM.z0 + 0.03, 0, 0.6, 0.85, [0.80, 0.74, 0.60]);
  poster(4.46, FY + 1.7, 299.4, -Math.PI / 2, 0.5, 0.7, [0.62, 0.66, 0.70]);
  poster(0.8, FY + 2.05, ROOM.z1 - 0.03, Math.PI, 0.9, 0.6, [0.78, 0.72, 0.62]);
  Bin.box('metal', 0.04, 0.04, 0.12, 1.4, FY + 1.75, ROOM.z0 + 0.06, [0.3, 0.3, 0.28]);
  Bin.box('canvas', 0.5, 0.9, 0.22, 1.4, FY + 1.3, ROOM.z0 + 0.2, [0.32, 0.34, 0.28], { ry: 0.1, jitter: 0.05 });   // a jacket on the hook
  const bx = 1.4, bz = 302.5;
  Bin.cyl('metal', 0.15, 0.13, 0.3, bx, FY + 0.15, bz, [0.42, 0.42, 0.40], { seg: 12, open: true }); Bin.cyl('metal', 0.13, 0.13, 0.01, bx, FY + 0.005, bz, [0.42, 0.42, 0.40], { seg: 12 });
  Bin.cyl('glass', 0.11, 0.11, 0.01, bx, FY + 0.22, bz, [0.2, 0.22, 0.2], { seg: 12, noShadow: true });
  Bin.cyl('scorch', 0.5, 0.5, 0.005, bx, FY + 0.01, bz, [1, 1, 1], { seg: 16, noShadow: true });   // the damp ring
  world.addCylinder(bx, bz, 0.17, FY, FY + 0.3, { tag, surface: 'metal' });
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), new THREE.MeshStandardMaterial({ color: 0xbfd0d8, roughness: 0.1, metalness: 0.3 })); drop.position.set(bx, CEIL, bz); drop.visible = false; scene.add(drop); anim.drop = drop;
  Bin.finish();

  // ---------------------------------------------------------------- base volume, interactables
  world.baseVolume.min.set(-4.6, FY - 1.5, 295.6); world.baseVolume.max.set(4.6, FY + 3.5, 304.7);
  const player = ctx.player;
  const insideDoor = () => player.position.z > DOOR_Z;
  let transition = null;
  const doorPos = V3(0, FY + 1.1, DOOR_Z);
  ctx.interact.register({
    position: doorPos, radius: 2.6,
    prompt: () => (insideDoor() ? '[E] OPEN DOOR · THE RADIUS' : '[E] ENTER VANNO'),
    onInteract() {
      if (transition) return;
      transition = { t: 0, toInside: !insideDoor(), done: false };
      ctx.hud.fadeOut(); ctx.audio.play('door_open', { pos: doorPos, gain: 0.9 });
    },
  });
  const station = (x, z, y, prompt, panel, radius = 2.0) => ctx.interact.register({ position: V3(x, y, z), radius, prompt, onInteract() { ctx.panels.open(panel); } });
  station(dx + 0.55, dz, FY + 1.0, '[E] TERMINAL · MISSIONS', 'terminal');
  station(wx - 0.55, wz, FY + 1.0, '[E] WORKBENCH · CLEAN AND LOAD', 'workbench');
  station(sx - 0.4, sz - 0.4, FY + 0.95, '[E] SUPPLY CRATE · BUY AND SELL', 'supply');
  station(lx + 0.4, lz, FY + 1.0, '[E] LOCKER · STORAGE', 'storage', 1.8);
  station(cx, cz - 0.5, FY + 0.9, '[E] COT · SLEEP UNTIL MORNING', 'bed', 2.2);

  // ---------------------------------------------------------------- update
  let dripT = 3 + rnd() * 4, dropT = -1, flickerSeed = 0, flickA = 1;
  const tmpV = new THREE.Vector3();
  return {
    stations: { terminal: V3(dx, FY, dz), workbench: V3(wx, FY, wz), supply: V3(sx, FY, sz), storage: V3(lx, FY, lz), bed: V3(cx, FY, cz), door: doorPos },
    floorY: FY,
    update(dt) {
      const t = ctx.elapsed; timeUniform.value = t;
      // door transition
      if (transition) {
        transition.t += dt;
        if (transition.t >= 0.8 && !transition.done) {
          transition.done = true;
          if (transition.toInside) { player.teleport(0, 297.6, FY); player.setLook(Math.PI, 0); ctx.events.emit('enterBase'); }
          else { player.teleport(START.x, START.z); player.setLook(START.yaw, 0); ctx.events.emit('exitBase'); }
          ctx.hud.fadeIn(); ctx.audio.play('door_close', { pos: doorPos, gain: 0.9 });
        }
        if (transition.t > 1.6) transition = null;
      }
      // door lamp: on from dusk to dawn, a slow breathing sag as the generator loads
      const night = ctx.time.night;
      const lampOn = night > 0.08 || ctx.time.hour < 7.2;
      const sag = 0.85 + 0.15 * Math.sin(t * 1.7) * Math.sin(t * 0.37);
      const lampI = (lampOn ? 14 : 1.2) * sag;
      anim.doorLight.intensity += (lampI - anim.doorLight.intensity) * Math.min(1, dt * 3);
      anim.lampBulb.material.emissiveIntensity = (lampOn ? 6 : 0.4) * sag;
      // the failing tube: bursts of dropout keyed to a hash of time
      flickerSeed = Math.floor(t * 21);
      const h = Math.abs(Math.sin(flickerSeed * 12.9898) * 43758.5453) % 1;
      const phase = Math.sin(t * 0.21) > 0.55;   // a bad spell every so often
      const target = phase ? (h < 0.55 ? 0.1 : 1) : (h < 0.06 ? 0.35 : 1);
      flickA += (target - flickA) * Math.min(1, dt * 40);
      tubeMatB.emissiveIntensity = 0.15 + 1.5 * flickA; anim.tubeLightB.intensity = 2.4 * flickA;
      tubeMatA.emissiveIntensity = 1.6 + 0.05 * Math.sin(t * 120);
      // bench lamp sways a little, the CRT pulses
      anim.lamp.rotation.z = Math.sin(t * 1.3) * 0.035 + Math.sin(t * 2.9) * 0.01; anim.lamp.rotation.x = Math.sin(t * 1.1 + 1) * 0.025;
      anim.crtLight.intensity = 0.8 + 0.15 * Math.sin(t * 9.0) + (Math.abs(Math.sin(t * 0.7)) > 0.97 ? 0.5 : 0);
      // clock: game hours; a second hand on real seconds
      const hr = ctx.time.hour;
      anim.clock.hourH.rotation.z = -(hr / 12) * Math.PI * 2; anim.clock.minH.rotation.z = -((hr % 1)) * Math.PI * 2; anim.clock.secH.rotation.z = -Math.floor(t) * (Math.PI * 2 / 60);
      // flag turns with a slow wind direction
      anim.flag.rotation.y = -0.4 + 0.5 * Math.sin(t * 0.11) + 0.08 * Math.sin(t * 0.9);
      // the drip: a drop falls from the ceiling into the bucket every few seconds while inside
      if (player.inBase) {
        dripT -= dt;
        if (dripT <= 0 && dropT < 0) { dropT = 0; dripT = 3 + rnd() * 6; anim.drop.visible = true; }
        if (dropT >= 0) {
          dropT += dt; const y = CEIL - 0.5 * 9.8 * dropT * dropT;
          if (y <= FY + 0.28) { dropT = -1; anim.drop.visible = false; ctx.audio.play('drip', { pos: tmpV.set(bx, FY + 0.3, bz), gain: 0.45, rate: 0.9 + rnd() * 0.25 }); }
          else anim.drop.position.y = y;
        }
      }
    },
  };
}
