// Vanno: a UNPSC forward outpost, not a room. A concrete warehouse dug into the southern plateau with earth
// bermed up its flanks, one steel door in the north face, and nine spaces behind it: an airlock, the main hall
// with the terminal and the supply counter, an armoury lined with real shelves and racks, a workshop, a
// generator room, a spine corridor, a bunk room, a med corner and an indoor range. Storage is furniture you
// walk to and open, never one magic box. The Tide siren is loudest here; the generator never stops.
//
// Everything structural (walls, floors, ceilings, roof deck, berm) is built from one table so the collider is
// derived from the same numbers as the geometry — the mound bug (mud reaching 2.5 m inside the room) came from
// a blocker written by hand next to geometry written by hand. Nothing below is written twice.
import * as THREE from 'three';
import { createBuilder, material, colorize, placeMatrix, normalizeGeo, instanced, sandbagGeometry, sandbagWall, createWires, timeUniform, V3 } from '../world/structures.js';
import { START } from '../world/map.js';

// ---------------------------------------------------------------------------------------------- layout
// The Vanno plateau is not flat: the ground climbs from 5.8 at the road to 8.15 under the back of the
// outpost. The floor has to clear that everywhere or the hillside grows through it, so it sits at 8.9 —
// 0.75 m above the highest ground the shell covers — and the approach climbs a flight of steps to reach it.
const FY = 8.9;                     // interior floor top (ctx.base.floorY; main.js spawns the load save on it)
const DOOR_Z = 296.2;               // the steel door plane (unchanged: the fade transition anchor)
const T = 0.30;                     // wall thickness (perimeter and partitions alike)
const WY0 = 4.0;                    // walls start below grade so the plinth closes to the ground
const DECK0 = FY + 3.60, DECK1 = FY + 4.00;   // roof deck slab over the low rooms
const LOW_TOP = DECK1;              // low-room wall top
const HALL_CY = FY + 4.50;          // the hall ceiling
const HALL_TOP = HALL_CY + 0.40;    // the hall roof: a raised clerestory box standing above the deck
const GRADE = 6.4;                  // nominal ground at the gate; real heights are sampled per point

const CONC = [0.44, 0.43, 0.41], CONC_IN = [0.53, 0.52, 0.49], DECKC = [0.40, 0.39, 0.37];
const STEEL = [0.34, 0.36, 0.34], DARK = [0.26, 0.27, 0.26], WOOD = [0.42, 0.37, 0.27];
const OLIVE = [0.34, 0.40, 0.26], DADO = [0.30, 0.40, 0.36];

// clear interior extents of every room; cy = ceiling underside
const RM = {
  entry:    { x0: -2.35, x1: 2.35,  z0: 296.35, z1: 299.85, cy: FY + 2.50 },
  hall:     { x0: -7.20, x1: 7.20,  z0: 300.15, z1: 308.40, cy: HALL_CY },
  armoury:  { x0: -13.90, x1: -7.50, z0: 300.15, z1: 308.40, cy: FY + 2.95 },
  workshop: { x0: 7.50, x1: 13.90,  z0: 300.15, z1: 304.90, cy: FY + 3.10 },
  genset:   { x0: 7.50, x1: 13.90,  z0: 305.20, z1: 310.50, cy: FY + 2.70 },
  corridor: { x0: -13.90, x1: 7.20, z0: 308.70, z1: 310.50, cy: FY + 2.35 },
  // the back of the outpost is one shallow row, because the hillside behind it climbs fast
  range:    { x0: -13.90, x1: -4.20, z0: 310.80, z1: 314.40, cy: FY + 2.90 },
  bunk:     { x0: -3.90, x1: 1.50,  z0: 310.80, z1: 314.40, cy: FY + 2.60 },
  med:      { x0: 1.80,  x1: 5.40,  z0: 310.80, z1: 314.40, cy: FY + 2.55 },
};
const DH = FY + 2.30;               // door head height
const dr = (a, b) => [a, b, FY, DH];         // a doorway opening
const cl = (a, b) => [a, b, DECK1 + 0.02, HALL_CY - 0.05];   // a clerestory opening (hall walls only)

// axis: 'x' = the wall runs along x at z = c;  'z' = runs along z at x = c.
// [axis, c, a0, a1, y0, y1, openings]
const WALLS = [
  // entry throat: the door face and its two cheeks
  ['x', DOOR_Z, -2.65, 2.65, WY0, FY + 2.90, [dr(-0.85, 0.85)]],
  ['z', -2.50, 296.05, 300.15, WY0, FY + 2.90, []],
  ['z', 2.50, 296.05, 300.15, WY0, FY + 2.90, []],
  // north façade: low either side, the hall's clerestory box in the middle
  ['x', 300.00, -14.20, -7.35, WY0, LOW_TOP, []],
  ['x', 300.00, -7.35, 7.35, WY0, HALL_TOP, [cl(-6.60, -4.80), cl(-3.60, -1.80), dr(-0.85, 0.85), cl(1.80, 3.60), cl(4.80, 6.60)]],
  ['x', 300.00, 7.35, 14.20, WY0, LOW_TOP, []],
  // perimeter
  ['z', -14.05, 299.85, 314.70, WY0, LOW_TOP, []],
  ['z', 14.05, 299.85, 310.80, WY0, LOW_TOP, []],
  // hall flanks (clerestory above the deck on both sides)
  ['z', -7.35, 300.00, 308.55, WY0, HALL_TOP, [dr(302.10, 303.90), cl(304.60, 306.20), cl(306.70, 308.20)]],
  ['z', 7.35, 300.00, 308.55, WY0, HALL_TOP, [dr(301.70, 303.30), cl(303.90, 305.40), cl(305.90, 307.40)]],
  ['z', 7.35, 308.55, 310.80, WY0, LOW_TOP, [dr(308.95, 310.35)]],
  // hall / armoury south wall against the spine corridor
  ['x', 308.55, -14.20, -7.35, WY0, LOW_TOP, [dr(-11.90, -10.40)]],
  ['x', 308.55, -7.35, 7.35, WY0, HALL_TOP, [cl(-6.40, -4.90), cl(-4.30, -2.80), dr(-0.80, 0.80), cl(2.80, 4.30), cl(4.90, 6.40)]],
  // workshop / generator divider
  ['x', 305.05, 7.35, 14.20, WY0, LOW_TOP, [dr(9.30, 10.80)]],
  // corridor south wall: three doorways into the range, the bunks and the med corner
  ['x', 310.65, -14.20, 14.20, WY0, LOW_TOP, [dr(-10.00, -8.50), dr(-2.40, -0.90), dr(3.00, 4.50)]],
  // south block partitions
  ['z', -4.05, 310.50, 314.70, WY0, LOW_TOP, []],
  ['z', 1.65, 310.50, 314.70, WY0, LOW_TOP, []],
  ['z', 5.55, 310.50, 314.70, WY0, LOW_TOP, []],
  ['x', 314.55, -14.20, 5.70, WY0, LOW_TOP, []],
];

// berms: [x0, x1, z0, z1, innerTop, side] — side says which edge is the tall one ('w','e','s')
// Each is drawn as a wedge and blocked by ONE box with exactly the same footprint; every one of them starts
// on the outer face of a wall, so no earth is ever solid inside a room.
const BERMS = [
  [-19.0, -14.20, 295.0, 316.0, DECK1 - 0.2, 'e'],
  [14.20, 19.0, 295.0, 313.0, DECK1 - 0.2, 'w'],
  [5.70, 19.0, 310.80, 317.0, DECK1 - 0.7, 'n'],
  [-14.20, 5.70, 314.70, 319.0, DECK1 - 0.9, 'n'],
];

export function createBase(ctx) {
  const { world, scene } = ctx;
  const rnd = ctx.rng.fork(1401);
  const tag = 'vanno';
  const B = createBuilder(ctx, 'vanno'); B._world = world;               // shell: casts shadows
  const Bin = createBuilder(ctx, 'vanno-fit', { noShadow: true }); Bin._world = world;   // fittings
  const anim = {};
  const stations = {};
  const gy = (x, z) => world.getHeight(x, z);

  // ------------------------------------------------------------------ shell helpers
  // One wall entry -> solid pieces; each piece is drawn AND collided from the same four numbers.
  function buildWall(axis, c, a0, a1, y0, y1, openings) {
    const pieces = [];
    const ops = openings.slice().sort((p, q) => p[0] - q[0]);
    let cur = a0;
    for (const [o0, o1, oy0, oy1] of ops) {
      if (o0 > cur) pieces.push([cur, o0, y0, y1]);
      if (oy0 > y0) pieces.push([o0, o1, y0, oy0]);
      if (oy1 < y1) pieces.push([o0, o1, oy1, y1]);
      cur = Math.max(cur, o1);
    }
    if (cur < a1) pieces.push([cur, a1, y0, y1]);
    for (const [p0, p1, py0, py1] of pieces) {
      const w = p1 - p0, h = py1 - py0;
      if (w <= 0.02 || h <= 0.02) continue;
      const m = (p0 + p1) / 2, ym = (py0 + py1) / 2;
      if (axis === 'x') {
        B.box('concrete', w, h, T, m, ym, c, CONC, { ground: FY, dampH: 1.4, damp: 0.22, jitter: 0.045 });
        world.addBox(m, ym, c, w, h, T, { tag, surface: 'concrete' });
      } else {
        B.box('concrete', T, h, w, c, ym, m, CONC, { ground: FY, dampH: 1.4, damp: 0.22, jitter: 0.045 });
        world.addBox(c, ym, m, T, h, w, { tag, surface: 'concrete' });
      }
    }
    // a lintel band and jambs around every doorway so the openings read as framed, not cut
    for (const [o0, o1, oy0, oy1] of ops) {
      if (oy1 - oy0 > 1.6) continue;   // clerestory: glazed below instead
      const m = (o0 + o1) / 2, w = o1 - o0;
      if (axis === 'x') {
        Bin.box('paint', w + 0.28, 0.14, T + 0.06, m, oy1 + 0.07, c, DARK, { jitter: 0.04 });
        for (const s of [-1, 1]) Bin.box('paint', 0.14, oy1 - oy0, T + 0.06, m + s * (w / 2 + 0.07), (oy0 + oy1) / 2, c, DARK, { jitter: 0.04 });
      } else {
        Bin.box('paint', T + 0.06, 0.14, w + 0.28, c, oy1 + 0.07, m, DARK, { jitter: 0.04 });
        for (const s of [-1, 1]) Bin.box('paint', T + 0.06, oy1 - oy0, 0.14, c, (oy0 + oy1) / 2, m + s * (w / 2 + 0.07), DARK, { jitter: 0.04 });
      }
    }
  }
  for (const w of WALLS) buildWall(...w);

  // clerestory glazing: dirty panes that carry the daylight into the hall (emissive, driven by the hour)
  const paneMat = new THREE.MeshStandardMaterial({ color: 0x2a2f30, emissive: 0xb9c6cc, emissiveIntensity: 0.4, roughness: 0.45, vertexColors: true });
  const paneGeos = [];
  const pane = (axis, c, a0, a1) => {
    const g = new THREE.BoxGeometry(axis === 'x' ? a1 - a0 : 0.06, HALL_CY - DECK1 - 0.07, axis === 'x' ? 0.06 : a1 - a0);
    g.applyMatrix4(placeMatrix(axis === 'x' ? (a0 + a1) / 2 : c, (DECK1 + 0.02 + HALL_CY - 0.05) / 2, axis === 'x' ? c : (a0 + a1) / 2));
    colorize(g, [1, 1, 1], { jitter: 0.05 }); normalizeGeo(g); paneGeos.push(g);
  };
  for (const [axis, c, , , , , ops] of WALLS) for (const o of ops) if (o[3] - o[2] < 1.6 && o[2] > DECK1) pane(axis, c, o[0], o[1]);
  if (paneGeos.length) {
    const panes = new THREE.Mesh(mergeAll(paneGeos), paneMat); panes.name = 'vanno-clerestory'; scene.add(panes); anim.panes = paneMat;
  }

  // floors, ceilings, roof deck
  const floorSlab = (x0, x1, z0, z1) => {
    B.box('concrete', x1 - x0, 0.12, z1 - z0, (x0 + x1) / 2, FY - 0.06, (z0 + z1) / 2, [0.37, 0.37, 0.36], { jitter: 0.035, segs: 2 });
    world.addBox((x0 + x1) / 2, FY - 0.85, (z0 + z1) / 2, x1 - x0, 1.7, z1 - z0, { tag, surface: 'concrete' });
  };
  floorSlab(-14.20, 14.20, 299.85, 314.70);
  floorSlab(-2.65, 2.65, 296.05, 299.90);
  world.addBox(0, FY - 0.5, 296.0, 2.7, 1.0, 0.8, { tag, surface: 'concrete' });   // the sill under the door
  for (const k in RM) {
    const r = RM[k];
    B.box('concrete', r.x1 - r.x0 + T, 0.30, r.z1 - r.z0 + T, (r.x0 + r.x1) / 2, r.cy + 0.15, (r.z0 + r.z1) / 2, CONC_IN, { jitter: 0.04 });
  }
  const deck = (x0, x1, z0, z1) => {
    B.box('concrete', x1 - x0, DECK1 - DECK0, z1 - z0, (x0 + x1) / 2, (DECK0 + DECK1) / 2, (z0 + z1) / 2, DECKC, { jitter: 0.04 });
    world.addBox((x0 + x1) / 2, (DECK0 + DECK1) / 2, (z0 + z1) / 2, x1 - x0, DECK1 - DECK0, z1 - z0, { tag, surface: 'concrete', passable: true, blocksBullets: true });
  };
  deck(-14.20, -7.35, 299.85, 308.55); deck(7.35, 14.20, 299.85, 308.55); deck(-14.20, 14.20, 308.55, 314.70);
  B.box('concrete', 15.1, 0.40, 9.0, 0, HALL_CY + 0.20, 304.27, DECKC, { jitter: 0.04 });   // hall roof
  world.addBox(0, HALL_CY + 0.20, 304.27, 15.1, 0.40, 9.0, { tag, surface: 'concrete', passable: true, blocksBullets: true });
  for (const [x, z, w, d] of [[0, 299.6, 15.1, 0.34], [0, 308.95, 15.1, 0.34], [-7.75, 304.27, 0.34, 9.0], [7.75, 304.27, 0.34, 9.0]])
    B.box('concrete', w, 0.34, d, x, HALL_CY + 0.55, z, [0.42, 0.41, 0.39], { jitter: 0.05 });   // clerestory parapet
  for (const [x, z, w, d] of [[-14.35, 307.3, 0.5, 15.6], [14.35, 305.3, 0.5, 11.6], [0, 314.85, 28.9, 0.5]])
    B.box('concrete', w, 0.36, d, x, DECK1 + 0.18, z, [0.42, 0.41, 0.39], { jitter: 0.05 });     // deck parapet

  // ------------------------------------------------------------------ berms
  for (const [x0, x1, z0, z1, top, side] of BERMS) {
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, 1, d, Math.max(2, Math.round(w / 2)), 1, Math.max(2, Math.round(d / 2)));
    const p = g.attributes.position;
    const base = 3.0;
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), lz = p.getZ(i);
      if (p.getY(i) < 0) { p.setY(i, base); continue; }
      // 0 at the tall (inner) edge, 1 at the outer edge
      let t = side === 'e' ? (x1 - (lx + (x0 + x1) / 2)) / w : side === 'w' ? ((lx + (x0 + x1) / 2) - x0) / w : ((lz + (z0 + z1) / 2) - z0) / d;
      t = Math.max(0, Math.min(1, t));
      const s = 1 - t * t * (3 - 2 * t);
      const lump = 0.35 * Math.sin(lx * 0.7 + lz * 0.41) + 0.22 * Math.sin(lz * 1.1 - lx * 0.3);
      p.setY(i, GRADE + 1.2 + (top - GRADE - 1.2) * s + lump * (0.35 + 0.65 * s));
    }
    g.computeVertexNormals();
    B.geo('earth', g, placeMatrix((x0 + x1) / 2, 0, (z0 + z1) / 2), [0.42, 0.40, 0.31], { jitter: 0.07, ground: GRADE, dampH: 3.0, damp: 0.3 });
    world.addBox((x0 + x1) / 2, (3.0 + DECK1 + 1.6) / 2, (z0 + z1) / 2, w, DECK1 + 1.6 - 3.0, d, { tag, surface: 'mud', noAvoid: true });
  }

  // ------------------------------------------------------------------ north façade dressing
  // plinth, pilasters, a string course, a bricked-up loading dock, louvres, floodlight brackets
  B.box('concrete', 28.9, 2.4, 0.9, 0, 6.2, 299.5, CONC, { ground: 5.0, jitter: 0.05 });
  world.addBox(0, 6.2, 299.5, 28.9, 2.4, 0.9, { tag, surface: 'concrete' });
  for (let i = 0; i < 9; i++) {
    const x = -12.6 + i * 3.15;
    if (Math.abs(x) < 3.2 || (x > 8.2 && x < 12.7)) continue;   // clear of the throat and the dock shutter
    B.box('concrete', 0.55, 7.2, 0.26, x, 9.3, 299.72, [0.47, 0.46, 0.44], { ground: 6.4, dampH: 2.5, damp: 0.3, jitter: 0.05 });
  }
  B.box('concrete', 28.9, 0.24, 0.18, 0, FY + 3.3, 299.76, [0.47, 0.46, 0.44], { jitter: 0.05 });
  // loading dock: a recessed corrugated shutter, welded shut, with a concrete lip
  B.box('corrugated', 3.8, 3.0, 0.14, 10.4, FY + 1.5, 299.78, [0.40, 0.42, 0.40], { jitter: 0.05 });
  B.box('metal', 4.1, 0.22, 0.3, 10.4, FY + 3.12, 299.72, DARK, { jitter: 0.04 });
  B.box('concrete', 4.4, 2.4, 1.5, 10.4, 6.2, 298.9, CONC, { ground: 5.0, jitter: 0.05 });     // lip: top 7.4, far below the floor, so it is never a way in
  world.addBox(10.4, 6.2, 298.9, 4.4, 2.4, 1.5, { tag, surface: 'concrete' });
  B.box('concrete', 4.0, 1.5, 0.4, 10.4, FY - 0.75, 299.65, [0.46, 0.45, 0.43], { jitter: 0.06 });   // the opening bricked up under the shutter
  for (const s of [-1, 1]) B.box('metal', 0.5, 0.05, 1.4, 10.4 + s * 1.6, 7.42, 298.9, DARK, { jitter: 0.04 });
  // louvre banks
  for (const lx of [-11.4, -5.6, 5.6]) {
    B.box('metal', 1.5, 1.1, 0.12, lx, FY + 2.6, 299.79, DARK, { jitter: 0.04 });
    for (let i = 0; i < 6; i++) B.box('metal', 1.42, 0.06, 0.1, lx, FY + 2.14 + i * 0.17, 299.70, [0.30, 0.31, 0.29], { rx: 0.35 });
  }
  // the painted plate beside the door, a stencil block on the façade
  B.box('paint', 0.62, 0.44, 0.03, -2.95, FY + 1.85, 299.83, [0.62, 0.58, 0.45], { jitter: 0.03 });
  B.box('paint', 1.9, 0.9, 0.03, -8.4, FY + 2.5, 299.83, [0.66, 0.62, 0.5], { jitter: 0.05 });

  // ------------------------------------------------------------------ the throat, steps and the steel door
  B.box('concrete', 5.6, 0.5, 4.2, 0, FY + 3.05, 297.9, DECKC, { jitter: 0.04 });                 // throat roof
  world.addBox(0, FY + 3.05, 297.9, 5.6, 0.5, 4.2, { tag, surface: 'concrete', passable: true, blocksBullets: true });
  // the flight up to the door: the floor is 2.4 m above the road, so the approach is a real stair with
  // cheek walls and a rail. Each tread is drawn and collided from the same rectangle; the rise is 0.29,
  // inside the player's 0.55 step allowance, so it can be walked up and down without jumping.
  const APRON_Z0 = 290.8, APRON_Z1 = 291.9, STAIR_Z0 = APRON_Z1, STAIR_Z1 = 296.05;
  const apronY = gy(0, APRON_Z0) + 0.28;
  B.box('concrete', 4.4, 1.1, APRON_Z1 - APRON_Z0, 0, apronY - 0.55, (APRON_Z0 + APRON_Z1) / 2, CONC, { ground: apronY - 1.1, jitter: 0.05 });
  world.addBox(0, apronY - 0.55, (APRON_Z0 + APRON_Z1) / 2, 4.4, 1.1, APRON_Z1 - APRON_Z0, { tag, surface: 'concrete' });
  // rise stays under half the 0.55 step allowance, so a tread two ahead never stops the walk up;
  // every tread is the full width of the flight, so nothing can be walked off the side of it.
  const STEPS = Math.max(4, Math.ceil((FY - apronY) / 0.26));
  const going = (STAIR_Z1 - STAIR_Z0) / STEPS, rise = (FY - apronY) / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const top = apronY + rise * (i + 1), z0 = STAIR_Z0 + going * i;
    B.box('concrete', 3.4, 0.9, going + 0.06, 0, top - 0.45, z0 + going / 2, CONC, { ground: top - 0.9, jitter: 0.05, seed: i });
    world.addBox(0, top - 0.45, z0 + going / 2, 3.4, 0.9, going, { tag, surface: 'concrete' });
  }
  for (const s2 of [-1, 1]) {   // cheek walls that rake with the flight, and a pipe handrail
    for (let i = 0; i < STEPS; i++) {
      const top = apronY + rise * (i + 1);
      B.box('concrete', 0.3, 1.2, going + 0.04, s2 * 1.85, top - 0.35, STAIR_Z0 + going * (i + 0.5), [0.46, 0.45, 0.43], { ground: top - 1.2, jitter: 0.05, seed: i + 9 });
      world.addBox(s2 * 1.85, top - 0.35, STAIR_Z0 + going * (i + 0.5), 0.3, 1.2, going, { tag, surface: 'concrete' });
    }
    const a = V3(s2 * 1.85, apronY + 0.95, STAIR_Z0), b = V3(s2 * 1.85, FY + 0.95, STAIR_Z1);
    const len = Math.hypot(b.y - a.y, b.z - a.z);
    B.cyl('metal', 0.035, 0.035, len, s2 * 1.85, (a.y + b.y) / 2, (a.z + b.z) / 2, [0.45, 0.45, 0.42], { rx: Math.atan2(b.z - a.z, b.y - a.y), seg: 7 });
    for (let i = 0; i <= STEPS; i += 2) B.cyl('metal', 0.03, 0.03, 0.95, s2 * 1.85, apronY + rise * i + 0.48, STAIR_Z0 + going * i, [0.45, 0.45, 0.42], { seg: 6 });
  }
  // the top tread already lands on FY, so the threshold is only a steel plate: a raised sill box here
  // would stand 0.01 m too proud for the 0.55 step allowance and wall the door off from the flight.
  B.box('metal', 1.9, 0.03, 0.5, 0, FY + 0.015, 296.0, [0.32, 0.33, 0.31], { jitter: 0.04 });
  const doorC = [0.30, 0.33, 0.31];
  B.box('metal', 1.55, 2.35, 0.1, 0, FY + 1.17, DOOR_Z, doorC, { jitter: 0.02 });
  B.box('metal', 1.85, 2.65, 0.08, 0, FY + 1.32, DOOR_Z - 0.07, DARK, { jitter: 0.02 });
  for (const y of [FY + 0.4, FY + 1.95]) B.box('metal', 1.3, 0.1, 0.06, 0, y, DOOR_Z - 0.1, doorC);
  B.geo('metal', new THREE.TorusGeometry(0.23, 0.03, 6, 16), placeMatrix(-0.25, FY + 1.2, DOOR_Z - 0.13), [0.35, 0.36, 0.34], { jitter: 0 });
  for (const a of [0, 1.05, 2.1]) B.box('metal', 0.04, 0.42, 0.04, -0.25, FY + 1.2, DOOR_Z - 0.13, [0.35, 0.36, 0.34], { rz: a });
  for (const y of [FY + 0.5, FY + 1.95]) B.cyl('metal', 0.05, 0.05, 0.22, 0.82, y, DOOR_Z - 0.06, DARK, { seg: 8 });
  world.addBox(0, FY + 1.2, DOOR_Z, 1.9, 2.4, 0.4, { tag, surface: 'metal' });   // closed leaf: the transition is a fade
  // hooded lamp over the door
  B.box('metal', 0.4, 0.1, 0.32, 0, FY + 2.78, DOOR_Z - 0.6, DARK);
  B.cyl('metal', 0.15, 0.05, 0.2, 0, FY + 2.64, DOOR_Z - 0.6, DARK, { seg: 10, open: true });
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1612, emissive: 0xffb070, emissiveIntensity: 0, roughness: 0.4 }));
  lampBulb.position.set(0, FY + 2.56, DOOR_Z - 0.6); scene.add(lampBulb); anim.lampBulb = lampBulb;
  const doorLight = new THREE.PointLight(0xffb070, 0, 26, 1.8); doorLight.position.set(0, FY + 2.45, DOOR_Z - 1.3); scene.add(doorLight); anim.doorLight = doorLight;

  // ------------------------------------------------------------------ roof deck furniture
  for (const [x, z, h] of [[-10.2, 303.4, 1.7], [-9.4, 312.6, 1.3], [11.0, 302.4, 1.6], [12.45, 307.8, 2.4], [3.4, 313.2, 1.4]]) {
    B.cyl('metal', 0.2, 0.2, h, x, DECK1 + h / 2, z, [0.28, 0.28, 0.26], { seg: 10 });
    B.cyl('metal', 0.31, 0.31, 0.16, x, DECK1 + h + 0.06, z, [0.28, 0.28, 0.26], { seg: 10 });
  }
  B.cyl('metal', 1.05, 1.05, 1.9, -12.0, DECK1 + 1.35, 313.2, [0.36, 0.34, 0.30], { seg: 14 });   // water tank
  for (const s of [-1, 1]) B.box('metal', 0.1, 1.0, 0.1, -12.0 + s * 0.9, DECK1 + 0.4, 313.2, DARK);
  B.cyl('metal', 0.06, 0.09, 7.4, 12.6, DECK1 + 3.7, 308.6, [0.5, 0.5, 0.48], { seg: 8 });        // mast
  for (let i = 0; i < 4; i++) B.box('metal', 1.5, 0.03, 0.03, 12.6, DECK1 + 4.6 + i * 0.55, 308.6, [0.5, 0.5, 0.48]);
  const wires = createWires(ctx);
  wires.span(V3(12.6, DECK1 + 7.2, 308.6), V3(12.6, DECK1 + 0.2, 310.6), 0.4, 8);
  wires.span(V3(-12.0, DECK1 + 2.4, 313.2), V3(-13.9, DECK1 + 0.3, 310.6), 0.35, 6);

  // ------------------------------------------------------------------ the compound: gate, fence, sandbags
  const sandbags = { mats: [], tints: [] };
  const addBags = (pts, rows) => { const w = sandbagWall(world, pts, rows, rnd, { tag }); sandbags.mats.push(...w.mats); sandbags.tints.push(...w.tints); };
  for (const s of [-1, 1]) addBags([[s * 2.6, 292.6], [s * 3.9, 295.0], [s * 5.4, 296.3]], 3);
  addBags([[-8.4, 289.7], [-6.2, 289.1], [-5.4, 291.0]], 4);
  addBags([[6.4, 290.7], [8.2, 289.9], [9.4, 291.3]], 4);
  // chainlink line with a vehicle gate on the road; it stops short of the barrel dump to the east
  const FZ = 288.6, FG = gy(0, FZ);
  const postAt = (x) => { const y = gy(x, FZ); B.cyl('metal', 0.06, 0.07, 2.5, x, y + 1.25, FZ, [0.36, 0.36, 0.34], { seg: 7 }); world.addCylinder(x, FZ, 0.09, y, y + 2.4, { tag, surface: 'metal' }); };
  const meshPanel = (w, x, y, z, ry) => {
    const g = new THREE.PlaneGeometry(w, 2.1, Math.max(2, Math.round(w)), 3);
    colorize(g, [0.52, 0.53, 0.50], { jitter: 0.05 }); normalizeGeo(g);
    const m = new THREE.Mesh(g, material('chainlink'));
    m.position.set(x, y, z); m.rotation.y = ry || 0; scene.add(m);
    const rg = new THREE.BoxGeometry(w, 0.06, 0.06);
    colorize(rg, [0.36, 0.36, 0.34], { jitter: 0.05 }); normalizeGeo(rg);
    for (const yy of [1.02, -1.02]) { const bar = new THREE.Mesh(rg.clone(), material('metal')); bar.position.y = yy; m.add(bar); }
    rg.dispose();
    return m;
  };
  for (let x = -13; x <= 9.0; x += 2.4) { if (x > -3.9 && x < 3.9) continue; postAt(x); }
  postAt(-3.4); postAt(3.4);
  for (const [a, b] of [[-13, -3.4], [3.4, 9.0]]) { meshPanel(b - a, (a + b) / 2, gy((a + b) / 2, FZ) + 1.02, FZ, 0); world.addBox((a + b) / 2, FG + 1.2, FZ, b - a, 2.4, 0.16, { tag, surface: 'metal' }); }
  // two leaves: one swung back flat against the fence, one standing half across the road
  meshPanel(3.0, -3.4 + 0.2, FG + 1.02, FZ + 1.48, -1.44);
  world.addBox(-3.2, FG + 1.2, FZ + 1.48, 0.5, 2.4, 3.0, { tag, surface: 'metal' });
  meshPanel(3.0, 3.4 - 1.42, FG + 1.02, FZ + 0.34, 0.24);
  world.addBox(1.98, FG + 1.2, FZ + 0.34, 2.95, 2.4, 0.8, { tag, surface: 'metal' });
  // striped barrier over the road, raised
  const bpx = -4.4, bpz = 289.8, bpy = gy(bpx, bpz);
  B.box('concrete', 0.9, 0.3, 0.9, bpx, bpy + 0.15, bpz, CONC, { jitter: 0.05 });
  B.box('metal', 0.32, 1.25, 0.32, bpx, bpy + 0.75, bpz, STEEL, { ground: bpy, jitter: 0.04 });
  world.addBox(bpx, bpy + 0.75, bpz, 0.6, 1.5, 0.6, { tag, surface: 'metal' });
  const poleG = new THREE.CylinderGeometry(0.05, 0.06, 6.2, 8); poleG.rotateZ(Math.PI / 2); poleG.translate(2.9, 0, 0);
  colorize(poleG, [1, 1, 1], { jitter: 0, fn: (px) => (Math.floor((px + 0.3) / 0.6) % 2 === 0 ? [0.72, 0.12, 0.10] : [0.80, 0.78, 0.72]) });
  normalizeGeo(poleG);
  const barrier = new THREE.Mesh(poleG, material('paint')); barrier.castShadow = true;
  barrier.position.set(bpx, bpy + 1.35, bpz); barrier.rotation.set(0, 0, 1.16); scene.add(barrier); anim.barrier = barrier;
  // floodlight mast at the gate
  const fmx = 5.2, fmz = 290.6, fmy = gy(fmx, fmz);
  B.cyl('concrete', 0.4, 0.5, 0.5, fmx, fmy + 0.2, fmz, CONC, { seg: 10 });
  B.cyl('metal', 0.07, 0.09, 6.2, fmx, fmy + 3.3, fmz, [0.5, 0.5, 0.48], { seg: 8 });
  world.addCylinder(fmx, fmz, 0.16, fmy, fmy + 6.2, { tag, surface: 'metal' });
  for (const s of [-0.35, 0.35]) {
    B.box('metal', 0.34, 0.3, 0.22, fmx + s, fmy + 6.3, fmz - 0.18, DARK, { ry: -s * 0.9 });
  }
  const floodLight = new THREE.PointLight(0xffd9a8, 0, 30, 1.6); floodLight.position.set(fmx, fmy + 6.1, fmz - 0.6); scene.add(floodLight); anim.floodLight = floodLight;
  const floodBulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1612, emissive: 0xffd9a8, emissiveIntensity: 0, roughness: 0.4 }));
  floodBulb.position.set(fmx, fmy + 6.28, fmz - 0.32); scene.add(floodBulb); anim.floodBulb = floodBulb;
  // flag pole, west of the approach
  const fpx = -9.5, fpz = 294.6, fpy = gy(fpx, fpz);
  B.cyl('concrete', 0.45, 0.55, 0.5, fpx, fpy + 0.2, fpz, CONC, { seg: 10 });
  B.cyl('metal', 0.035, 0.05, 7.0, fpx, fpy + 3.9, fpz, [0.55, 0.56, 0.55], { seg: 8 });
  B.geo('metal', new THREE.SphereGeometry(0.07, 8, 6), placeMatrix(fpx, fpy + 7.45, fpz), [0.55, 0.56, 0.55], { jitter: 0 });
  world.addCylinder(fpx, fpz, 0.12, fpy, fpy + 7.4, { tag, surface: 'metal' });
  const flagG = new THREE.PlaneGeometry(1.6, 1.0, 24, 12); flagG.translate(0.8, 0, 0);
  colorize(flagG, [0.36, 0.46, 0.60], { jitter: 0 }); normalizeGeo(flagG);
  const flag = new THREE.Mesh(flagG, material('flag')); flag.position.set(fpx + 0.04, fpy + 6.8, fpz); flag.castShadow = true; scene.add(flag); anim.flag = flag;
  // fuel bowser and drums feeding the generator room, a cable duct into the east wall
  const fx = 16.4, fz = 302.6, fy = gy(fx, fz);
  B.box('metal', 1.0, 0.9, 2.6, fx, fy + 1.35, fz, [0.34, 0.36, 0.32], { ground: fy, jitter: 0.05 });
  B.cyl('metal', 0.75, 0.75, 2.4, fx, fy + 1.5, fz, [0.42, 0.40, 0.34], { rz: Math.PI / 2, seg: 14, jitter: 0.05 });
  for (const s of [-1, 1]) B.box('metal', 0.9, 0.85, 0.16, fx, fy + 0.45, fz + s * 1.0, DARK, { jitter: 0.04 });
  world.addBox(fx, fy + 1.4, fz, 1.7, 2.6, 2.7, { tag, surface: 'metal' });
  for (let i = 0; i < 4; i++) { const dx = fx - 1.6 - (i % 2) * 0.7, dz = fz + 2.0 + Math.floor(i / 2) * 0.72; B.cyl('metal', 0.3, 0.3, 0.9, dx, gy(dx, dz) + 0.45, dz, [0.32, 0.36, 0.30], { seg: 12, jitter: 0.07 }); world.addCylinder(dx, dz, 0.32, gy(dx, dz), gy(dx, dz) + 0.9, { tag, surface: 'metal' }); }
  B.cyl('metal', 0.09, 0.09, 2.2, 15.2, fy + 1.9, fz, [0.3, 0.3, 0.28], { rz: Math.PI / 2, seg: 8 });
  wires.span(V3(fx, fy + 2.9, fz - 1.0), V3(14.3, DECK1 - 0.6, 301.4), 0.3, 6);
  wires.span(V3(fmx, fmy + 5.9, fmz), V3(2.9, FY + 2.9, 299.7), 0.7, 10);
  wires.finish('vanno-wires');
  instanced(ctx, 'sandbag', sandbagGeometry(), sandbags.mats, sandbags.tints, { name: 'vanno-sandbags' });
  world.coverPoints.push(V3(-6.6, gy(-6.6, 292.2), 292.2), V3(7.0, gy(7.0, 292.6), 292.6), V3(-3.8, gy(-3.8, 295.0), 295.0), V3(4.4, gy(4.4, 295.2), 295.2));

  // ================================================================== interior fittings
  const dado = (axis, c, a0, a1, face) => {
    const y = FY + 0.55;   // `c` is the room's clear face, so the panel only steps off by half its own thickness
    if (axis === 'x') Bin.box('paint', a1 - a0, 1.1, 0.03, (a0 + a1) / 2, y, c + face * 0.016, DADO, { jitter: 0.05, noShadow: true });
    else Bin.box('paint', 0.03, 1.1, a1 - a0, c + face * 0.016, y, (a0 + a1) / 2, DADO, { jitter: 0.05, noShadow: true });
  };
  const poster = (x, y, z, ry, w, h, rgb) => {
    const g = new THREE.PlaneGeometry(w, h); colorize(g, rgb, { jitter: 0 }); normalizeGeo(g);
    const m = new THREE.Mesh(g, material('poster')); m.position.set(x, y, z); m.rotation.set(0, ry, (rnd() - 0.5) * 0.06); scene.add(m);
  };
  // strip light: merged into one 'tube' mesh, so every steady fixture in the outpost is a single draw call
  const tubeGeos = [];
  const tubeGeo = (len, x, y, z, ry) => {
    const g = new THREE.CylinderGeometry(0.022, 0.022, len, 8); g.rotateZ(Math.PI / 2);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (p.getX(i) + len / 2) / len);
    g.applyMatrix4(placeMatrix(x, y, z, 0, ry || 0, 0));
    colorize(g, [1, 1, 1], { jitter: 0 }); normalizeGeo(g); return g;
  };
  const fixture = (x, z, y, len = 1.3, ry = 0, into = tubeGeos) => {
    Bin.box('metal', ry ? 0.3 : len + 0.15, 0.07, ry ? len + 0.15 : 0.3, x, y + 0.08, z, [0.68, 0.68, 0.66], { jitter: 0.04 });
    into.push(tubeGeo(len, x, y, z, ry));
  };
  const cage = (x, y, z, ry) => {
    Bin.cyl('metal', 0.13, 0.16, 0.16, x, y, z, DARK, { seg: 8, open: true, ry });
    for (let i = 0; i < 4; i++) Bin.box('metal', 0.02, 0.02, 0.3, x, y - 0.02, z, [0.3, 0.3, 0.28], { ry: i * 0.78 });
  };

  // ---- ENTRY: airlock. Low, red, a duckboard over the mud tray, coats and boots, a decon head.
  {
    const r = RM.entry;
    Bin.box('metal', 1.5, 2.3, 0.06, 0, FY + 1.15, DOOR_Z + 0.2, doorC, { jitter: 0.02 });
    Bin.geo('metal', new THREE.TorusGeometry(0.23, 0.03, 6, 16), placeMatrix(0.25, FY + 1.2, DOOR_Z + 0.26), [0.35, 0.36, 0.34], { jitter: 0 });
    for (const a of [0, 1.05, 2.1]) Bin.box('metal', 0.04, 0.42, 0.04, 0.25, FY + 1.2, DOOR_Z + 0.26, [0.35, 0.36, 0.34], { rz: a });
    // inner door, hinged on the west jamb and standing open into the airlock (hinge -0.85, 299.85)
    Bin.box('metal', 1.55, 2.25, 0.05, -0.85 + 0.775 * Math.cos(1.25), FY + 1.15, 299.85 - 0.775 * Math.sin(1.25), [0.33, 0.38, 0.34], { ry: 1.25, jitter: 0.03 });
    Bin.box('plank', 1.9, 0.06, 2.2, 0, FY + 0.06, 297.9, [0.38, 0.33, 0.24], { jitter: 0.06 });
    for (let i = 0; i < 9; i++) Bin.box('plank', 1.85, 0.035, 0.13, 0, FY + 0.11, 297.0 + i * 0.24, [0.40, 0.35, 0.25], { jitter: 0.08 });
    Bin.box('metal', 1.1, 0.1, 0.6, 1.5, FY + 0.05, 298.9, [0.28, 0.29, 0.27], { jitter: 0.04 });   // boot tray
    for (let i = 0; i < 4; i++) Bin.box('metal', 0.11, 0.24, 0.3, 1.15 + (i % 2) * 0.22, FY + 0.14, 298.7 + Math.floor(i / 2) * 0.4, [0.12, 0.11, 0.10], { ry: (rnd() - 0.5) * 0.6, jitter: 0.05 });
    Bin.box('plank', 0.08, 0.06, 2.0, -2.28, FY + 1.8, 298.4, [0.4, 0.35, 0.26]);
    for (let i = 0; i < 5; i++) Bin.box('metal', 0.1, 0.06, 0.05, -2.24, FY + 1.76, 297.6 + i * 0.4, [0.5, 0.5, 0.48]);
    for (const [z, c] of [[297.7, [0.30, 0.34, 0.27]], [298.5, [0.26, 0.28, 0.30]], [299.2, [0.34, 0.30, 0.24]]])
      Bin.box('canvas', 0.24, 0.95, 0.5, -2.12, FY + 1.24, z, c, { ry: 0.08, jitter: 0.07 });
    Bin.cyl('metal', 0.03, 0.03, 0.9, 2.2, r.cy - 0.45, 297.2, [0.4, 0.4, 0.38], { seg: 6 });      // decon shower
    Bin.cyl('metal', 0.11, 0.06, 0.07, 2.2, r.cy - 0.92, 297.2, [0.4, 0.4, 0.38], { seg: 10 });
    Bin.box('paint', 0.34, 0.44, 0.05, 2.32, FY + 1.5, 298.2, [0.55, 0.52, 0.42], { ry: -Math.PI / 2, jitter: 0.04 });
    cage(0, r.cy - 0.16, 298.0, 0);
    const redBulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a0a06, emissive: 0xff6a44, emissiveIntensity: 2.6, roughness: 0.4 }));
    redBulb.position.set(0, r.cy - 0.22, 298.0); scene.add(redBulb);
    dado('z', -2.35, 296.5, 299.8, 1); dado('z', 2.35, 296.5, 299.8, -1);
  }

  // ---- MAIN HALL: terminal, supply counter, lay-out table, stove, clock, klaxon, columns.
  const HALL = RM.hall;
  {
    dado('x', HALL.z0, -7.0, -1.0, 1); dado('x', HALL.z0, 1.0, 7.0, 1);
    dado('x', HALL.z1, -7.0, -0.95, -1); dado('x', HALL.z1, 0.95, 7.0, -1);
    dado('z', HALL.x0, 300.4, 301.95, 1); dado('z', HALL.x0, 304.05, 308.2, 1);
    dado('z', HALL.x1, 300.4, 301.55, -1); dado('z', HALL.x1, 303.45, 308.2, -1);
    // two concrete columns with brackets and a gantry beam
    for (const cx of [-4.6, 4.6]) {
      Bin.box('concrete', 0.5, 4.5, 0.5, cx, FY + 2.25, 306.6, [0.50, 0.49, 0.46], { ground: FY, dampH: 1.2, damp: 0.28, jitter: 0.04 });
      Bin.box('concrete', 0.78, 0.22, 0.78, cx, FY + 4.4, 306.6, [0.46, 0.45, 0.43], { jitter: 0.04 });
      world.addBox(cx, FY + 2.25, 306.6, 0.56, 4.5, 0.56, { tag, surface: 'concrete' });
    }
    Bin.box('metal', 9.6, 0.28, 0.16, 0, HALL.cy - 0.45, 306.6, [0.34, 0.33, 0.30], { jitter: 0.05 });
    // pipe run and conduit under the ceiling
    Bin.cyl('metal', 0.08, 0.08, 14.2, 0, HALL.cy - 0.3, 300.9, [0.36, 0.34, 0.30], { rz: Math.PI / 2, seg: 8 });
    Bin.cyl('metal', 0.05, 0.05, 14.2, 0, HALL.cy - 0.42, 301.2, [0.30, 0.28, 0.25], { rz: Math.PI / 2, seg: 6 });
    Bin.cyl('metal', 0.03, 0.03, 8.2, -6.85, HALL.cy - 0.18, 304.3, [0.25, 0.25, 0.24], { rx: Math.PI / 2, seg: 6 });
    // light: two banks, the east one failing
    for (const z of [302.2, 306.4]) fixture(-3.6, z, HALL.cy - 0.12, 1.5);
    fixture(3.6, 302.2, HALL.cy - 0.12, 1.5);
    const tubeMatB = material('tube', { key: 'B' }); tubeMatB.emissiveIntensity = 1.6;
    Bin.box('metal', 1.65, 0.07, 0.3, 3.6, HALL.cy - 0.04, 306.4, [0.68, 0.68, 0.66], { jitter: 0.04 });
    const failing = new THREE.Mesh(tubeGeo(1.5, 3.6, HALL.cy - 0.12, 306.4, 0), tubeMatB); scene.add(failing);
    anim.tubeB = tubeMatB;

    // ---- terminal desk, west end, facing into the hall
    const dx = -6.55, dz = 305.9;
    Bin.box('metal', 1.0, 0.06, 1.9, dx, FY + 0.78, dz, STEEL, { jitter: 0.03 });
    for (const s of [-1, 1]) Bin.box('metal', 0.9, 0.74, 0.55, dx, FY + 0.38, dz + s * 0.66, STEEL, { jitter: 0.03 });
    world.addBox(dx, FY + 0.42, dz, 1.05, 0.9, 1.95, { tag, surface: 'metal' });
    Bin.box('paint', 0.46, 0.42, 0.48, dx + 0.04, FY + 1.02, dz + 0.12, [0.72, 0.70, 0.62], { ry: -0.22, jitter: 0.03 });
    const crtG = new THREE.PlaneGeometry(0.34, 0.28); colorize(crtG, [1, 1, 1], { jitter: 0 }); normalizeGeo(crtG);
    const crt = new THREE.Mesh(crtG, material('crt')); crt.material.emissiveIntensity = 1.4;
    crt.position.set(dx + 0.26, FY + 1.03, dz + 0.08); crt.rotation.y = Math.PI / 2 - 0.22; scene.add(crt); anim.crt = crt;
    Bin.box('paint', 0.38, 0.03, 0.15, dx + 0.18, FY + 0.82, dz - 0.52, [0.66, 0.64, 0.56], { ry: 0.1, jitter: 0.03 });
    Bin.box('paint', 0.3, 0.006, 0.22, dx + 0.12, FY + 0.81, dz + 0.62, [0.85, 0.83, 0.75], { ry: 0.3, noShadow: true });
    Bin.box('metal', 0.5, 0.05, 0.5, dx + 0.95, FY + 0.48, dz - 0.15, [0.25, 0.27, 0.26], { ry: 0.5 });
    Bin.box('metal', 0.46, 0.55, 0.05, dx + 1.16, FY + 0.76, dz - 0.17, [0.25, 0.27, 0.26], { ry: 0.5 });
    for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) Bin.cyl('metal', 0.016, 0.016, 0.48, dx + 0.95 + a, FY + 0.24, dz - 0.15 + b, [0.25, 0.27, 0.26], { seg: 5 });
    world.addBox(dx + 1.0, FY + 0.42, dz - 0.15, 0.55, 0.9, 0.55, { tag, surface: 'metal' });
    // mission board above the desk: cork, pinned sheets, a hanging map
    Bin.box('plank', 0.05, 1.15, 2.3, HALL.x0 + 0.03, FY + 2.05, dz, [0.44, 0.38, 0.28], { jitter: 0.06 });
    for (let i = 0; i < 9; i++) {
      const zz = dz - 0.95 + (i % 5) * 0.45, yy = FY + 1.65 + Math.floor(i / 5) * 0.62;
      Bin.box('paint', 0.006, 0.3, 0.22, HALL.x0 + 0.07, yy, zz, [0.86, 0.83, 0.74], { rx: (rnd() - 0.5) * 0.25, noShadow: true });
    }
    poster(HALL.x0 + 0.08, FY + 2.4, 301.1, Math.PI / 2, 1.0, 1.3, [0.72, 0.70, 0.60]);   // north of the armoury doorway
    // filing cabinet and a stack of binders
    Bin.box('paint', 0.62, 1.35, 0.72, HALL.x0 + 0.36, FY + 0.68, 307.8, [0.40, 0.46, 0.42], { jitter: 0.03 });
    for (let i = 0; i < 3; i++) Bin.box('metal', 0.02, 0.03, 0.24, HALL.x0 + 0.68, FY + 0.35 + i * 0.42, 307.8, [0.6, 0.6, 0.58]);
    world.addBox(HALL.x0 + 0.36, FY + 0.68, 307.8, 0.66, 1.35, 0.76, { tag, surface: 'metal' });

    // ---- supply counter (the shop), east side: a hatch, a scale, stores behind a grille
    const sx = 6.35, sz = 305.4;
    Bin.box('plank', 0.75, 0.1, 3.0, sx, FY + 1.02, sz, [0.44, 0.38, 0.27], { jitter: 0.04 });
    Bin.box('plank', 0.62, 0.96, 3.0, sx + 0.04, FY + 0.48, sz, [0.38, 0.33, 0.24], { jitter: 0.04 });
    world.addBox(sx, FY + 0.55, sz, 0.85, 1.1, 3.0, { tag, surface: 'wood' });
    for (let i = 0; i < 7; i++) Bin.box('metal', 0.03, 1.1, 0.03, sx - 0.28, FY + 1.62, sz - 1.4 + i * 0.47, [0.3, 0.3, 0.28]);
    Bin.box('metal', 0.06, 0.06, 3.0, sx - 0.28, FY + 2.17, sz, [0.3, 0.3, 0.28]);
    Bin.box('metal', 0.34, 0.1, 0.3, sx - 0.08, FY + 1.12, sz - 0.5, [0.5, 0.5, 0.48], { jitter: 0.03 });   // scale pan
    Bin.cyl('metal', 0.02, 0.02, 0.3, sx - 0.08, FY + 1.28, sz - 0.5, [0.5, 0.5, 0.48], { seg: 6 });
    Bin.cyl('paint', 0.09, 0.09, 0.03, sx - 0.08, FY + 1.45, sz - 0.5, [0.85, 0.83, 0.74], { rx: Math.PI / 2, seg: 14 });
    Bin.box('paint', 0.3, 0.02, 0.4, sx - 0.1, FY + 1.08, sz + 0.6, [0.84, 0.82, 0.72], { ry: 0.2, noShadow: true });
    for (let i = 0; i < 5; i++) { const bz = sz - 1.2 + i * 0.62, by = FY + 0.24 + (i % 2) * 0.5; Bin.box('paint', 0.42, 0.2, 0.26, HALL.x1 - 0.35, by, bz, OLIVE, { ry: (rnd() - 0.5) * 0.2, jitter: 0.07, seed: i }); }
    Bin.box('plank', 0.5, 0.05, 3.2, HALL.x1 - 0.28, FY + 1.5, sz, WOOD, { jitter: 0.05 });
    for (let i = 0; i < 6; i++) Bin.box('paint', 0.3, 0.32, 0.14, HALL.x1 - 0.3, FY + 1.68, sz - 1.3 + i * 0.5, [[0.35, 0.28, 0.22], [0.30, 0.36, 0.32], [0.55, 0.50, 0.40]][i % 3], { jitter: 0.05, seed: i });

    // ---- the lay-out table: where the gear goes down before a run (a container in its own right)
    const tx = -3.0, tz = 304.4;
    Bin.box('metal', 3.2, 0.08, 1.25, tx, FY + 0.84, tz, [0.38, 0.40, 0.38], { jitter: 0.03 });
    Bin.box('plank', 3.1, 0.04, 1.15, tx, FY + 0.9, tz, [0.44, 0.38, 0.28], { jitter: 0.05 });
    for (const [a, b] of [[-1.45, -0.5], [1.45, -0.5], [-1.45, 0.5], [1.45, 0.5]]) Bin.box('metal', 0.07, 0.8, 0.07, tx + a, FY + 0.44, tz + b, [0.3, 0.32, 0.30]);
    Bin.box('metal', 2.9, 0.04, 0.5, tx, FY + 0.3, tz, [0.3, 0.32, 0.30], { jitter: 0.04 });
    world.addBox(tx, FY + 0.46, tz, 3.3, 0.95, 1.35, { tag, surface: 'metal' });
    Bin.box('canvas', 0.9, 0.03, 0.7, tx - 0.9, FY + 0.93, tz - 0.05, [0.36, 0.36, 0.28], { ry: 0.12, jitter: 0.05 });
    Bin.box('paint', 0.34, 0.16, 0.2, tx + 0.7, FY + 1.0, tz + 0.15, OLIVE, { ry: 0.3, jitter: 0.06 });
    Bin.cyl('metal', 0.06, 0.06, 0.16, tx + 1.15, FY + 0.98, tz - 0.3, [0.5, 0.48, 0.42], { seg: 10 });
    Bin.box('metal', 0.26, 0.05, 0.18, tx - 0.2, FY + 0.93, tz + 0.35, [0.42, 0.42, 0.40], { ry: -0.4, jitter: 0.05 });
    // a bench and two crates to sit on
    Bin.box('plank', 2.4, 0.08, 0.4, tx, FY + 0.46, tz + 1.35, WOOD, { jitter: 0.06 });
    for (const s of [-1, 1]) Bin.box('plank', 0.09, 0.44, 0.34, tx + s * 1.0, FY + 0.22, tz + 1.35, [0.36, 0.31, 0.22]);
    world.addBox(tx, FY + 0.25, tz + 1.35, 2.4, 0.55, 0.44, { tag, surface: 'wood' });

    // ---- the stove: the warm heart of the room
    const vx = -2.6, vz = 307.6;
    Bin.cyl('metal', 0.42, 0.46, 1.05, vx, FY + 0.55, vz, [0.20, 0.19, 0.18], { seg: 14, jitter: 0.05 });
    Bin.cyl('metal', 0.48, 0.48, 0.06, vx, FY + 1.1, vz, [0.24, 0.23, 0.21], { seg: 14 });
    Bin.cyl('metal', 0.09, 0.09, 3.3, vx, FY + 2.75, vz, [0.24, 0.22, 0.2], { seg: 8 });
    Bin.cyl('metal', 0.09, 0.09, 1.2, vx + 0.6, FY + 4.36, vz, [0.24, 0.22, 0.2], { rz: Math.PI / 2, seg: 8 });
    Bin.cyl('metal', 0.16, 0.16, 0.16, vx, FY + 0.55, vz - 0.44, [0.14, 0.13, 0.12], { rx: Math.PI / 2, seg: 10 });
    world.addCylinder(vx, vz, 0.5, FY, FY + 1.15, { tag, surface: 'metal' });
    const emberMat = new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: 0xff6a1e, emissiveIntensity: 2.4, roughness: 0.7 });
    const ember = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), emberMat);
    ember.position.set(vx, FY + 0.55, vz - 0.53); ember.rotation.y = Math.PI; scene.add(ember); anim.ember = emberMat;
    Bin.cyl('metal', 0.11, 0.09, 0.16, vx + 0.16, FY + 1.2, vz, [0.44, 0.42, 0.36], { seg: 10 });    // kettle
    Bin.geo('metal', new THREE.TorusGeometry(0.09, 0.008, 4, 10, Math.PI), placeMatrix(vx + 0.16, FY + 1.3, vz, 0, 0, 0), [0.44, 0.42, 0.36], { jitter: 0 });
    for (let i = 0; i < 5; i++) Bin.cyl('plank', 0.045, 0.05, 0.42, vx + 0.75 + (i % 3) * 0.1, FY + 0.06 + Math.floor(i / 3) * 0.1, vz + 0.5 + (i % 2) * 0.12, [0.34, 0.28, 0.2], { rz: 1.5, ry: rnd(), seg: 6 });

    // ---- radio set on a shelf against the north wall (the chatter comes from here)
    const rx = 3.4, rz = HALL.z0 + 0.42;
    Bin.box('plank', 1.3, 0.06, 0.55, rx, FY + 0.92, rz, WOOD, { jitter: 0.05 });
    for (const s of [-1, 1]) Bin.box('metal', 0.05, 0.9, 0.05, rx + s * 0.55, FY + 0.46, rz + 0.1, [0.3, 0.3, 0.28]);
    Bin.box('metal', 0.55, 0.3, 0.36, rx, FY + 1.1, rz, [0.36, 0.30, 0.20], { jitter: 0.04 });
    Bin.cyl('metal', 0.012, 0.012, 0.9, rx - 0.24, FY + 1.65, rz + 0.05, [0.6, 0.6, 0.58], { rz: 0.22, seg: 4 });
    for (let i = 0; i < 3; i++) Bin.cyl('metal', 0.035, 0.035, 0.03, rx + 0.1 + i * 0.12, FY + 1.16, rz - 0.19, [0.5, 0.5, 0.48], { rx: Math.PI / 2, seg: 8 });
    const dialMat = new THREE.MeshStandardMaterial({ color: 0x1a1a16, emissive: 0x8fdc7a, emissiveIntensity: 1.6, roughness: 0.5 });
    const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.07), dialMat); dial.position.set(rx - 0.1, FY + 1.16, rz - 0.185); scene.add(dial); anim.dial = dialMat;

    // ---- the clock and the Tide dial on the north wall, and the klaxon
    const kx = -1.6, kz = HALL.z0 + 0.04;
    Bin.cyl('paint', 0.21, 0.21, 0.05, kx, FY + 2.55, kz, [0.88, 0.87, 0.82], { rx: Math.PI / 2, seg: 20 });
    Bin.cyl('metal', 0.23, 0.23, 0.07, kx, FY + 2.55, kz - 0.008, [0.2, 0.2, 0.19], { rx: Math.PI / 2, seg: 20, open: true });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; Bin.box('metal', 0.02, i % 3 === 0 ? 0.045 : 0.022, 0.005, kx + Math.sin(a) * 0.165, FY + 2.55 + Math.cos(a) * 0.165, kz + 0.03, [0.12, 0.12, 0.12], { rz: -a }); }
    const hands = new THREE.Group(); hands.position.set(kx, FY + 2.55, kz + 0.04); scene.add(hands);
    const handMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });
    const hourH = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.11, 0.004).translate(0, 0.045, 0), handMat);
    const minH = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.16, 0.004).translate(0, 0.065, 0), handMat);
    const secH = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.17, 0.003).translate(0, 0.055, 0), new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.6 }));
    secH.position.z = 0.006; hands.add(hourH, minH, secH);
    // the Tide dial: one red hand crossing a painted arc, and a lamp that wakes under the hour
    const tx2 = -0.55;
    Bin.cyl('paint', 0.15, 0.15, 0.04, tx2, FY + 2.55, kz, [0.80, 0.78, 0.70], { rx: Math.PI / 2, seg: 18 });
    Bin.cyl('metal', 0.17, 0.17, 0.06, tx2, FY + 2.55, kz - 0.008, [0.2, 0.2, 0.19], { rx: Math.PI / 2, seg: 18, open: true });
    for (let i = 0; i < 8; i++) { const a = Math.PI * 0.25 + (i / 8) * Math.PI * 1.5; Bin.box('paint', 0.014, 0.03, 0.005, tx2 + Math.sin(a) * 0.115, FY + 2.55 + Math.cos(a) * 0.115, kz + 0.025, i > 5 ? [0.62, 0.14, 0.10] : [0.15, 0.15, 0.14], { rz: -a }); }
    const tideHand = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.12, 0.004).translate(0, 0.048, 0), new THREE.MeshStandardMaterial({ color: 0x9a2018, roughness: 0.6 }));
    tideHand.position.set(tx2, FY + 2.55, kz + 0.035); scene.add(tideHand);
    anim.clock = { hourH, minH, secH, tideHand };
    // klaxon and its rotating beacon, high on the north wall
    const klx = 1.9, kly = FY + 3.3;
    Bin.cyl('metal', 0.2, 0.14, 0.3, klx, kly, HALL.z0 + 0.2, [0.30, 0.30, 0.28], { rx: Math.PI / 2, seg: 12, open: true });
    Bin.box('metal', 0.16, 0.16, 0.12, klx, kly, HALL.z0 + 0.06, DARK);
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0x2a0806, emissive: 0xff2a12, emissiveIntensity: 0, roughness: 0.4 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), beaconMat);
    beacon.position.set(klx + 0.55, kly, HALL.z0 + 0.16); scene.add(beacon);
    anim.beacon = beacon; anim.beaconMat = beaconMat;
    const sirenLight = new THREE.PointLight(0xff3018, 0, 16, 1.8); sirenLight.position.set(klx + 0.55, kly - 0.15, HALL.z0 + 0.6); scene.add(sirenLight); anim.sirenLight = sirenLight;
    stations.klaxon = V3(klx + 0.55, kly, HALL.z0 + 0.2);
    stations.radio = V3(rx, FY + 1.1, rz);
    stations.terminal = V3(dx, FY, dz);
    stations.supply = V3(sx, FY, sz);
    stations.table = V3(tx, FY, tz);
    // painted floor hatching by the doorways
    for (const [hx, hz, w, d] of [[0, 300.9, 2.2, 0.9], [0, 307.7, 2.2, 0.9]])
      for (let i = 0; i < 6; i++) Bin.box('paint', 0.1, 0.004, d, hx - w / 2 + i * (w / 5), FY + 0.015, hz, [0.62, 0.55, 0.24], { ry: 0.5, jitter: 0.1, noShadow: true });
    poster(-3.4, FY + 2.2, HALL.z1 - 0.03, Math.PI, 1.0, 0.7, [0.78, 0.72, 0.62]);
    poster(2.6, FY + 2.35, HALL.z0 + 0.03, 0, 0.7, 0.95, [0.80, 0.74, 0.60]);
  }

  // ---- ARMOURY: the storage room. Shelving, racks, crates, lockers, a sealed cage.
  const ARM = RM.armoury;
  const openables = [];
  {
    dado('x', ARM.z0, -13.7, -7.7, 1);
    dado('x', ARM.z1, -13.7, -12.05, -1); dado('x', ARM.z1, -10.25, -7.7, -1);
    fixture(-10.7, 302.2, ARM.cy - 0.12, 1.4); fixture(-10.7, 306.4, ARM.cy - 0.12, 1.4);
    Bin.cyl('metal', 0.06, 0.06, 6.3, -10.7, ARM.cy - 0.28, 304.4, [0.34, 0.32, 0.28], { rz: Math.PI / 2, seg: 8 });
    // steel shelving down the west wall: three bays, four decks each, loaded with tins, crates and cans
    for (let bay = 0; bay < 3; bay++) {
      const bz = 301.8 + bay * 2.1;
      for (let d = 0; d < 4; d++) Bin.box('metal', 0.72, 0.05, 2.05, ARM.x0 + 0.4, FY + 0.35 + d * 0.62, bz, [0.40, 0.42, 0.40], { jitter: 0.04, seed: bay * 4 + d });
      for (const s2 of [-1, 1]) for (const t2 of [-1, 1]) Bin.box('metal', 0.06, 2.2, 0.06, ARM.x0 + 0.4 + t2 * 0.33, FY + 1.1, bz + s2 * 1.0, [0.36, 0.38, 0.36]);
      world.addBox(ARM.x0 + 0.42, FY + 1.1, bz, 0.78, 2.2, 2.1, { tag, surface: 'metal' });
      for (let d = 0; d < 4; d++) for (let i = 0; i < 3; i++) {
        if (rnd() < 0.18) continue;
        const px = ARM.x0 + 0.3 + (i % 2) * 0.2, pz = bz - 0.7 + i * 0.7 + (rnd() - 0.5) * 0.12, py = FY + 0.38 + d * 0.62;
        const kind = (bay + d + i) % 3;
        if (kind === 0) Bin.box('paint', 0.36, 0.18, 0.22, px, py + 0.09, pz, OLIVE, { ry: (rnd() - 0.5) * 0.3, jitter: 0.08, seed: bay * 20 + d * 4 + i });
        else if (kind === 1) Bin.box('plank', 0.34, 0.2, 0.3, px, py + 0.1, pz, [0.44, 0.38, 0.28], { ry: (rnd() - 0.5) * 0.3, jitter: 0.08, seed: bay * 20 + d * 4 + i });
        else Bin.cyl('metal', 0.09, 0.09, 0.26, px, py + 0.13, pz, [0.40, 0.42, 0.36], { seg: 10, jitter: 0.08, seed: bay * 20 + d * 4 + i });
      }
      stations['shelf' + bay] = V3(ARM.x0 + 0.4, FY, bz);
    }
    // weapon racks: one each side of the room, uprights and pegs with long arms standing in them
    const rack = (rx, rz, face) => {
      Bin.box('metal', 2.2, 0.09, 0.36, rx, FY + 1.45, rz, [0.38, 0.40, 0.38], { jitter: 0.04 });
      Bin.box('metal', 2.2, 0.09, 0.36, rx, FY + 0.32, rz, [0.38, 0.40, 0.38], { jitter: 0.04 });
      for (const s2 of [-1, 1]) Bin.box('metal', 0.07, 1.6, 0.34, rx + s2 * 1.05, FY + 0.85, rz, [0.34, 0.36, 0.34]);
      for (let i = 0; i < 5; i++) {
        const px = rx - 0.84 + i * 0.42;
        Bin.box('metal', 0.04, 0.14, 0.3, px, FY + 1.55, rz, [0.3, 0.32, 0.30]);
        if (rnd() < 0.65) {
          Bin.box('metal', 0.06, 1.02, 0.07, px, FY + 0.9, rz + face * 0.06, [0.18, 0.18, 0.17], { rz: (rnd() - 0.5) * 0.05, jitter: 0.1, seed: rx + i });
          Bin.box('plank', 0.08, 0.34, 0.09, px, FY + 0.5, rz + face * 0.06, [0.30, 0.22, 0.14], { jitter: 0.12, seed: rx + i });
        }
      }
      world.addBox(rx, FY + 0.85, rz, 2.3, 1.75, 0.45, { tag, surface: 'metal' });
    };
    rack(-9.9, ARM.z0 + 0.24, 1); stations.rack0 = V3(-9.9, FY, ARM.z0 + 0.24);
    rack(-12.75, ARM.z1 - 0.24, -1); stations.rack1 = V3(-12.75, FY, ARM.z1 - 0.24);
    // crate stack in the middle of the floor
    const ccx = -10.6, ccz = 303.6;
    for (const [ox, oz, oy, sc] of [[0, -0.5, 0, 1], [0.1, 0.5, 0, 1], [0.05, -0.1, 0.72, 0.86]]) {
      Bin.box('plank', 1.15 * sc, 0.7, 0.85 * sc, ccx + ox, FY + 0.35 + oy, ccz + oz, [0.42, 0.38, 0.27], { ry: 0.1 + oz * 0.1, jitter: 0.05, seed: oy + oz });
      Bin.box('plank', 1.16 * sc, 0.05, 0.86 * sc, ccx + ox, FY + 0.71 + oy, ccz + oz, [0.34, 0.30, 0.22], { ry: 0.1 + oz * 0.1, jitter: 0.05, seed: oy + oz + 1 });
      for (const t2 of [-1, 1]) Bin.box('plank', 0.05, 0.72, 0.86 * sc, ccx + ox + t2 * 0.56 * sc, FY + 0.35 + oy, ccz + oz, [0.34, 0.30, 0.22], { ry: 0.1 + oz * 0.1, jitter: 0.05 });
    }
    world.addBox(ccx + 0.05, FY + 0.5, ccz, 1.35, 1.1, 2.0, { tag, surface: 'wood' });
    stations.crates = V3(ccx, FY, ccz);
    // three steel lockers on the north wall; the middle one is 61. Each door swings.
    for (let i = 0; i < 3; i++) {
      const lx = -13.4 + i * 0.62;
      Bin.box('paint', 0.58, 1.92, 0.52, lx, FY + 0.96, ARM.z0 + 0.32, [0.40, 0.46, 0.42], { jitter: 0.03, seed: i });
      for (let v = 0; v < 4; v++) Bin.box('metal', 0.26, 0.016, 0.02, lx, FY + 1.62 - v * 0.045, ARM.z0 + 0.06, [0.2, 0.22, 0.2]);
      world.addBox(lx, FY + 0.96, ARM.z0 + 0.32, 0.62, 1.92, 0.56, { tag, surface: 'metal' });
      const pivot = new THREE.Group(); pivot.position.set(lx - 0.28, FY + 0.96, ARM.z0 + 0.06);
      const leafG = new THREE.BoxGeometry(0.55, 1.86, 0.035); leafG.translate(0.275, 0, -0.02);
      colorize(leafG, [0.42, 0.48, 0.44], { jitter: 0.04 }); normalizeGeo(leafG);
      pivot.add(new THREE.Mesh(leafG, material('paint')));
      const hg = new THREE.BoxGeometry(0.03, 0.1, 0.05); hg.translate(0.52, 0, -0.05);
      colorize(hg, [0.6, 0.6, 0.58], { jitter: 0 }); normalizeGeo(hg);
      pivot.add(new THREE.Mesh(hg, material('metal')));
      scene.add(pivot); openables.push({ pivot, open: 0, t: 0, dir: -1.5 });
      stations['locker' + i] = V3(lx, FY, ARM.z0 + 0.32);
    }
    // ammunition drawer cabinet against the east wall, north of the doorway
    const acx = ARM.x1 - 0.35, acz = 301.0;
    Bin.box('paint', 0.62, 1.25, 0.75, acx, FY + 0.63, acz, [0.36, 0.40, 0.36], { jitter: 0.03 });
    for (let i = 0; i < 4; i++) {
      Bin.box('paint', 0.04, 0.24, 0.68, acx - 0.32, FY + 0.24 + i * 0.29, acz, [0.42, 0.46, 0.42], { jitter: 0.04 });
      Bin.box('metal', 0.03, 0.03, 0.14, acx - 0.35, FY + 0.24 + i * 0.29, acz, [0.6, 0.6, 0.58]);
    }
    Bin.box('plank', 0.66, 0.05, 0.8, acx, FY + 1.28, acz, WOOD, { jitter: 0.05 });
    world.addBox(acx, FY + 0.65, acz, 0.68, 1.3, 0.8, { tag, surface: 'metal' });
    stations.ammocab = V3(acx, FY, acz);
    // the sealed cage in the south-east corner: mesh on the two open sides, restricted stores behind it
    const gx0 = -10.2, gx1 = ARM.x1, gz0 = 306.2, gz1 = ARM.z1;
    for (let i = 0; i <= 5; i++) Bin.box('metal', 0.05, 2.4, 0.05, gx0 + 0.1 + i * 0.5, FY + 1.2, gz0, [0.34, 0.36, 0.34]);
    for (const y of [FY + 0.1, FY + 1.2, FY + 2.3]) Bin.box('metal', gx1 - gx0, 0.05, 0.05, (gx0 + gx1) / 2, y, gz0, [0.34, 0.36, 0.34]);
    for (let i = 0; i <= 4; i++) Bin.box('metal', 0.05, 2.4, 0.05, gx0, FY + 1.2, gz0 + 0.15 + i * 0.5, [0.34, 0.36, 0.34]);
    for (const y of [FY + 0.1, FY + 1.2, FY + 2.3]) Bin.box('metal', 0.05, 0.05, gz1 - gz0, gx0, y, (gz0 + gz1) / 2, [0.34, 0.36, 0.34]);
    world.addBox((gx0 + gx1) / 2, FY + 1.2, gz0, gx1 - gx0, 2.4, 0.12, { tag, surface: 'metal' });
    world.addBox(gx0, FY + 1.2, (gz0 + gz1) / 2, 0.12, 2.4, gz1 - gz0, { tag, surface: 'metal' });
    Bin.box('metal', 0.1, 0.16, 0.08, gx0 + 0.03, FY + 1.15, gz0 + 0.5, [0.6, 0.6, 0.55]);   // padlock hasp
    for (let i = 0; i < 4; i++) Bin.box('plank', 0.62, 0.45, 0.5, gx0 + 0.7 + (i % 2) * 0.75, FY + 0.24 + Math.floor(i / 2) * 0.5, gz0 + 1.3, [0.40, 0.36, 0.26], { ry: (rnd() - 0.5) * 0.3, jitter: 0.07, seed: i });
    stations.cage = V3(gx0 - 0.75, FY, gz0 + 1.0);
  }

  // ---- WORKSHOP: the bench, the pegboard, parts bins, solvent.
  const WKS = RM.workshop;
  {
    dado('x', WKS.z0, 7.7, 13.7, 1);
    const wx = WKS.x1 - 0.55, wz = 302.5;
    Bin.box('plank', 1.0, 0.11, 3.4, wx, FY + 0.9, wz, [0.40, 0.34, 0.24], { jitter: 0.04 });
    for (const [a, b] of [[-0.42, -1.55], [0.42, -1.55], [-0.42, 1.55], [0.42, 1.55]]) Bin.box('plank', 0.11, 0.85, 0.11, wx + a, FY + 0.42, wz + b, [0.36, 0.30, 0.22], { jitter: 0.04 });
    Bin.box('plank', 0.9, 0.05, 3.2, wx, FY + 0.26, wz, [0.36, 0.30, 0.22], { jitter: 0.04 });
    world.addBox(wx, FY + 0.47, wz, 1.05, 0.98, 3.4, { tag, surface: 'wood' });
    Bin.box('metal', 0.24, 0.18, 0.36, wx - 0.24, FY + 1.05, wz - 1.1, [0.22, 0.23, 0.22], { jitter: 0.03 });
    Bin.box('metal', 0.11, 0.22, 0.32, wx - 0.24, FY + 1.16, wz - 1.1, [0.22, 0.23, 0.22]);
    Bin.cyl('metal', 0.016, 0.016, 0.38, wx - 0.24, FY + 1.2, wz - 1.26, [0.5, 0.5, 0.48], { rx: Math.PI / 2, seg: 5 });
    Bin.box('plank', 0.05, 1.35, 3.2, WKS.x1 - 0.04, FY + 1.85, wz, [0.55, 0.50, 0.38], { jitter: 0.04 });
    for (let i = 0; i < 12; i++) {
      const zz = wz - 1.4 + i * 0.26, len = 0.16 + (i % 3) * 0.09;
      Bin.box('metal', 0.025, len, 0.055, WKS.x1 - 0.09, FY + 1.95 - (i % 2) * 0.3, zz, [0.28, 0.28, 0.27], { rx: (i % 2) * 0.3 });
      if (i % 2) Bin.cyl('metal', 0.035, 0.035, 0.025, WKS.x1 - 0.09, FY + 1.95 - 0.3 - len / 2, zz, [0.28, 0.28, 0.27], { rz: Math.PI / 2, seg: 8 });
    }
    // cleaning kit laid out: rods, brushes, oil, rags
    for (let i = 0; i < 3; i++) Bin.cyl('metal', 0.008, 0.008, 0.75, wx + 0.12, FY + 0.97 + i * 0.02, wz + 0.5 + i * 0.08, [0.6, 0.6, 0.55], { rz: Math.PI / 2, seg: 4, ry: 0.1 * i });
    Bin.cyl('metal', 0.07, 0.06, 0.22, wx - 0.05, FY + 1.06, wz + 1.1, [0.55, 0.30, 0.16], { seg: 8 });
    Bin.cyl('metal', 0.05, 0.05, 0.1, wx + 0.25, FY + 1.0, wz + 1.2, [0.40, 0.40, 0.36], { seg: 10 });
    Bin.box('canvas', 0.32, 0.05, 0.24, wx + 0.16, FY + 0.99, wz + 1.45, [0.45, 0.40, 0.30], { ry: 0.6, jitter: 0.06 });
    Bin.box('paint', 0.42, 0.15, 0.28, wx - 0.14, FY + 1.03, wz - 0.2, OLIVE, { ry: -0.15, jitter: 0.04 });
    // parts bins on the north wall
    const px = 9.4;
    Bin.box('metal', 1.9, 1.5, 0.34, px, FY + 1.15, WKS.z0 + 0.22, [0.36, 0.38, 0.36], { jitter: 0.03 });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++)
      Bin.box('paint', 0.32, 0.24, 0.26, px - 0.76 + c * 0.38, FY + 0.55 + r * 0.36, WKS.z0 + 0.1, [[0.55, 0.42, 0.20], [0.30, 0.38, 0.34], [0.48, 0.30, 0.22]][(r + c) % 3], { jitter: 0.07, seed: r * 5 + c });
    world.addBox(px, FY + 1.15, WKS.z0 + 0.22, 1.95, 1.6, 0.42, { tag, surface: 'metal' });
    stations.parts = V3(px, FY, WKS.z0 + 0.22);
    // solvent bath and a rag drum
    Bin.box('metal', 0.75, 0.55, 0.5, 8.2, FY + 0.28, 304.3, [0.34, 0.36, 0.34], { jitter: 0.04 });
    Bin.cyl('glass', 0.3, 0.3, 0.05, 8.2, FY + 0.5, 304.3, [0.30, 0.34, 0.26], { seg: 12, noShadow: true });
    world.addBox(8.2, FY + 0.28, 304.3, 0.8, 0.6, 0.55, { tag, surface: 'metal' });
    Bin.cyl('metal', 0.3, 0.3, 0.85, WKS.x0 + 0.5, FY + 0.42, 304.3, [0.30, 0.34, 0.30], { seg: 12, jitter: 0.06 });
    world.addCylinder(WKS.x0 + 0.5, 304.3, 0.32, FY, FY + 0.85, { tag, surface: 'metal' });
    for (let i = 0; i < 3; i++) Bin.box('canvas', 0.24, 0.1, 0.2, WKS.x0 + 0.5 + (rnd() - 0.5) * 0.2, FY + 0.9 + i * 0.06, 304.3 + (rnd() - 0.5) * 0.2, [0.44, 0.40, 0.32], { ry: rnd() * 3, jitter: 0.08 });
    // a stool
    Bin.cyl('plank', 0.17, 0.15, 0.05, wx - 0.95, FY + 0.52, wz + 0.6, [0.4, 0.34, 0.24], { seg: 10 });
    for (let i = 0; i < 3; i++) { const a = i * 2.1; Bin.cyl('plank', 0.02, 0.026, 0.52, wx - 0.95 + Math.cos(a) * 0.12, FY + 0.26, wz + 0.6 + Math.sin(a) * 0.12, [0.36, 0.30, 0.22], { seg: 5 }); }
    world.addCylinder(wx - 0.95, wz + 0.6, 0.19, FY, FY + 0.52, { tag, surface: 'wood' });
    // hanging bench lamp
    const lamp = new THREE.Group(); lamp.position.set(wx - 0.5, WKS.cy, wz);
    const cordG = new THREE.CylinderGeometry(0.008, 0.008, 1.0, 5); cordG.translate(0, -0.5, 0); colorize(cordG, [0.1, 0.1, 0.1], { jitter: 0 }); normalizeGeo(cordG);
    lamp.add(new THREE.Mesh(cordG, material('metal')));
    const shadeG = new THREE.ConeGeometry(0.24, 0.17, 12, 1, true); shadeG.translate(0, -1.08, 0); colorize(shadeG, [0.30, 0.34, 0.30], { jitter: 0 }); normalizeGeo(shadeG);
    lamp.add(new THREE.Mesh(shadeG, material('metal', { key: 'ds', params: { side: THREE.DoubleSide } })));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffc890, emissiveIntensity: 2.4, roughness: 0.4 }));
    bulb.position.y = -1.1; lamp.add(bulb);
    scene.add(lamp); anim.lamp = lamp;
    stations.workbench = V3(wx, FY, wz);
  }

  // ---- GENERATOR ROOM: the sound of the place being alive.
  const GEN = RM.genset;
  {
    const gx = 11.4, gz = 308.0;
    Bin.box('concrete', 3.0, 0.24, 1.9, gx, FY + 0.12, gz, [0.42, 0.42, 0.40], { jitter: 0.04 });
    Bin.box('metal', 2.5, 1.0, 1.15, gx, FY + 0.75, gz, [0.32, 0.36, 0.30], { jitter: 0.04 });
    Bin.box('metal', 1.0, 0.75, 1.0, gx - 1.3, FY + 0.85, gz, [0.30, 0.32, 0.28], { jitter: 0.04 });   // radiator
    for (let i = 0; i < 8; i++) Bin.box('metal', 0.03, 0.62, 0.86, gx - 1.79, FY + 0.85, gz - 0.36 + i * 0.1, [0.24, 0.26, 0.24], { jitter: 0.05, seed: i });
    Bin.cyl('metal', 0.34, 0.34, 1.05, gx + 0.5, FY + 1.6, gz - 0.2, [0.34, 0.36, 0.32], { rz: Math.PI / 2, seg: 12 });   // silencer
    Bin.cyl('metal', 0.11, 0.11, 3.0, gx + 1.05, FY + 2.4, gz - 0.2, [0.28, 0.26, 0.22], { seg: 10 });
    Bin.box('metal', 0.7, 0.5, 0.6, gx + 0.9, FY + 0.9, gz + 0.5, [0.28, 0.30, 0.26], { jitter: 0.04 });
    world.addBox(gx, FY + 0.8, gz, 3.4, 1.7, 1.5, { tag, surface: 'metal' });
    const genFly = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 14), material('metal'));
    genFly.geometry.rotateZ(Math.PI / 2); colorize(genFly.geometry, [0.3, 0.32, 0.30], { jitter: 0.05 }); normalizeGeo(genFly.geometry);
    genFly.position.set(gx - 1.9, FY + 0.85, gz); scene.add(genFly); anim.genFly = genFly;
    // breaker panel with switches and a run of conduit
    Bin.box('paint', 0.12, 1.1, 1.5, GEN.x1 - 0.1, FY + 1.55, 306.4, [0.36, 0.40, 0.36], { jitter: 0.03 });
    for (let i = 0; i < 6; i++) Bin.box('paint', 0.06, 0.14, 0.09, GEN.x1 - 0.2, FY + 1.2 + i * 0.16, 306.0 + (i % 2) * 0.5, [0.7, 0.66, 0.5], { rz: 0.2 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x120e08, emissive: 0x66ff88, emissiveIntensity: 1.8, roughness: 0.5 });
    const pilot = new THREE.Mesh(new THREE.CircleGeometry(0.03, 8), panelMat); pilot.position.set(GEN.x1 - 0.17, FY + 2.0, 306.4); pilot.rotation.y = -Math.PI / 2; scene.add(pilot); anim.pilot = panelMat;
    for (const [z0, z1] of [[305.4, 310.3]]) Bin.cyl('metal', 0.05, 0.05, z1 - z0, GEN.x1 - 0.22, GEN.cy - 0.2, (z0 + z1) / 2, [0.30, 0.30, 0.28], { rx: Math.PI / 2, seg: 6 });
    // drums, a sand bucket and an extinguisher
    for (let i = 0; i < 3; i++) { const dx = GEN.x0 + 0.55, dz = 306.2 + i * 0.72; Bin.cyl('metal', 0.29, 0.29, 0.88, dx, FY + 0.44, dz, [0.32, 0.36, 0.30], { seg: 12, jitter: 0.07, seed: i }); world.addCylinder(dx, dz, 0.31, FY, FY + 0.88, { tag, surface: 'metal' }); }
    Bin.cyl('metal', 0.15, 0.12, 0.3, GEN.x0 + 0.5, FY + 0.15, 309.4, [0.5, 0.16, 0.12], { seg: 10 });
    Bin.cyl('paint', 0.09, 0.09, 0.5, GEN.x0 + 1.2, FY + 0.25, 309.6, [0.62, 0.14, 0.10], { seg: 10 });
    fixture(gx - 0.6, 306.6, GEN.cy - 0.12, 1.2);
    stations.generator = V3(gx, FY + 0.8, gz);
  }

  // ---- SPINE CORRIDOR: pipes, a fire point, a phone, painted arrows, half the tubes dead.
  const COR = RM.corridor;
  {
    for (const [a, b] of [[-13.7, -12.05], [-10.25, -0.95], [0.95, 7.0]]) dado('x', COR.z0, a, b, 1);
    for (const [a, b] of [[-13.7, -10.15], [-8.35, -2.55], [-0.75, 2.85], [4.65, 7.0]]) dado('x', COR.z1, a, b, -1);
    for (const [z, r] of [[COR.z0 + 0.36, 0.075], [COR.z0 + 0.62, 0.05], [COR.z0 + 0.86, 0.035]])
      Bin.cyl('metal', r, r, 20.9, -3.4, COR.cy - 0.18, z, [0.36, 0.34, 0.30], { rz: Math.PI / 2, seg: 7 });
    for (let i = 0; i < 8; i++) Bin.box('metal', 0.1, 0.06, 0.7, -13.2 + i * 2.7, COR.cy - 0.06, COR.z0 + 0.6, DARK);
    for (const x of [-11.6, -6.4, -1.2, 4.0]) fixture(x, 309.6, COR.cy - 0.1, 1.15);
    // fire point
    Bin.box('paint', 0.7, 0.9, 0.1, 1.4, FY + 1.35, COR.z0 + 0.1, [0.62, 0.14, 0.10], { jitter: 0.04 });
    Bin.cyl('paint', 0.1, 0.1, 0.55, 1.2, FY + 1.2, COR.z0 + 0.22, [0.70, 0.16, 0.12], { seg: 10 });
    Bin.cyl('metal', 0.17, 0.14, 0.3, 1.75, FY + 1.35, COR.z0 + 0.24, [0.6, 0.14, 0.1], { rx: Math.PI / 2, seg: 12, open: true });
    // wall telephone
    Bin.box('paint', 0.2, 0.3, 0.14, -4.6, FY + 1.45, COR.z0 + 0.12, [0.20, 0.20, 0.18], { jitter: 0.03 });
    Bin.box('paint', 0.08, 0.24, 0.09, -4.6, FY + 1.62, COR.z0 + 0.2, [0.16, 0.16, 0.15]);
    // painted direction bands
    for (const [x, w, c] of [[-11.6, 1.5, [0.62, 0.55, 0.24]], [-4.6, 1.5, [0.30, 0.42, 0.56]], [6.0, 1.5, [0.66, 0.62, 0.56]]])
      Bin.box('paint', w, 0.16, 0.03, x, FY + 1.95, COR.z1 - 0.02, c, { jitter: 0.06, noShadow: true });
    Bin.box('metal', 1.1, 0.05, 0.5, 5.6, FY + 1.7, COR.z0 + 0.28, STEEL, { jitter: 0.05 });
    for (let i = 0; i < 4; i++) Bin.box('paint', 0.22, 0.24, 0.16, 5.25 + i * 0.24, FY + 1.85, COR.z0 + 0.28, OLIVE, { jitter: 0.07, seed: i });
  }

  // ---- BUNK ROOM: two steel bunks, the Explorer's cot, footlockers, a warm bulb.
  const BNK = RM.bunk;
  {
    dado('x', BNK.z1, -3.6, 1.2, -1); dado('z', BNK.x0, 311.1, 314.1, 1);
    // two berths against the south wall
    for (let b = 0; b < 2; b++) {
      const bx = BNK.x0 + 1.35 + b * 2.15, bz = BNK.z1 - 0.52;
      for (const [y, i] of [[FY + 0.5, 0], [FY + 1.42, 1]]) {
        Bin.box('metal', 1.9, 0.05, 0.85, bx, y, bz, [0.30, 0.32, 0.30], { ry: Math.PI / 2, jitter: 0.03, seed: b * 2 + i });
        Bin.box('canvas', 1.84, 0.13, 0.8, bx, y + 0.09, bz, [0.45, 0.42, 0.34], { ry: Math.PI / 2, jitter: 0.04, seed: b * 2 + i });
        Bin.box('canvas', 1.5, 0.07, 0.84, bx, y + 0.18, bz + 0.12, [0.30, 0.34, 0.28], { ry: Math.PI / 2, jitter: 0.05, seed: b * 2 + i + 7 });
        Bin.box('canvas', 0.52, 0.11, 0.38, bx, y + 0.19, bz + 0.68, [0.62, 0.60, 0.54], { ry: 0.1, jitter: 0.04 });
      }
      for (const [a, c] of [[-0.4, -0.92], [0.4, -0.92], [-0.4, 0.92], [0.4, 0.92]]) Bin.box('metal', 0.05, 1.9, 0.05, bx + a, FY + 0.95, bz + c, [0.30, 0.32, 0.30]);
      world.addBox(bx, FY + 0.4, bz, 0.9, 0.85, 1.95, { tag, surface: 'metal' });
      // footlocker at the foot of each berth, with a lid that lifts
      const fx2 = bx, fz2 = bz - 1.28;
      Bin.box('plank', 0.95, 0.42, 0.55, fx2, FY + 0.21, fz2, [0.40, 0.35, 0.25], { jitter: 0.05, seed: b });
      for (const t of [-1, 1]) Bin.box('metal', 0.05, 0.05, 0.58, fx2 + t * 0.42, FY + 0.21, fz2, [0.34, 0.34, 0.32]);
      world.addBox(fx2, FY + 0.21, fz2, 1.0, 0.44, 0.6, { tag, surface: 'wood' });
      const lidPivot = new THREE.Group(); lidPivot.position.set(fx2, FY + 0.43, fz2 - 0.27);
      const lidG = new THREE.BoxGeometry(0.96, 0.05, 0.57); lidG.translate(0, 0, 0.285);
      colorize(lidG, [0.42, 0.37, 0.27], { jitter: 0.05 }); normalizeGeo(lidG);
      lidPivot.add(new THREE.Mesh(lidG, material('plank')));
      scene.add(lidPivot); openables.push({ pivot: lidPivot, open: 0, t: 0, dir: -1.25, axis: 'x' });
      stations['footlocker' + b] = V3(fx2, FY, fz2);
    }
    // the Explorer's cot along the east wall
    const cx = BNK.x1 - 0.55, cz = 312.6;
    Bin.box('metal', 0.85, 0.05, 2.0, cx, FY + 0.44, cz, [0.30, 0.32, 0.30], { jitter: 0.03 });
    for (const [a, b] of [[-0.38, -0.95], [0.38, -0.95], [-0.38, 0.95], [0.38, 0.95]]) Bin.cyl('metal', 0.022, 0.022, 0.44, cx + a, FY + 0.22, cz + b, [0.30, 0.32, 0.30], { seg: 5 });
    Bin.box('canvas', 0.8, 0.15, 1.94, cx, FY + 0.54, cz, [0.45, 0.42, 0.34], { jitter: 0.03 });
    const blanket = new THREE.BoxGeometry(0.84, 0.08, 1.6, 6, 1, 12);
    { const p = blanket.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (y > 0) p.setY(i, y + 0.03 * Math.sin(z * 6 + 1) * Math.cos(x * 8) + 0.02 * Math.sin(z * 13)); } blanket.computeVertexNormals(); }
    Bin.geo('canvas', blanket, placeMatrix(cx, FY + 0.66, cz + 0.16, 0, 0.02, 0), [0.30, 0.34, 0.28], { jitter: 0.03 });
    Bin.box('canvas', 0.54, 0.11, 0.38, cx, FY + 0.67, cz - 0.76, [0.62, 0.60, 0.54], { ry: 0.1, jitter: 0.03 });
    world.addBox(cx, FY + 0.32, cz, 0.88, 0.74, 2.0, { tag, surface: 'metal' });
    for (const s of [0, 0.17]) Bin.box('metal', 0.3, 0.22, 0.12, cx - 0.66, FY + 0.11, cz - 0.35 + s, [0.12, 0.11, 0.10], { ry: s * 2, jitter: 0.04 });
    // a shelf of personal effects and a bulb over the cot
    Bin.box('plank', 0.24, 0.04, 1.5, BNK.x1 - 0.14, FY + 1.5, cz, [0.42, 0.37, 0.27], { jitter: 0.06 });
    for (let i = 0; i < 5; i++) Bin.box('paint', 0.13, 0.2, 0.14, BNK.x1 - 0.16, FY + 1.62, cz - 0.55 + i * 0.28, [[0.35, 0.28, 0.22], [0.30, 0.36, 0.32], [0.55, 0.50, 0.40]][i % 3], { ry: (rnd() - 0.5) * 0.4, jitter: 0.07, seed: i });
    Bin.box('paint', 0.005, 0.2, 0.16, BNK.x1 - 0.03, FY + 1.85, cz + 0.75, [0.80, 0.76, 0.66], { rx: 0.05, noShadow: true });
    const cordG2 = new THREE.CylinderGeometry(0.006, 0.006, 0.5, 5); cordG2.translate(0, -0.25, 0); colorize(cordG2, [0.1, 0.1, 0.1], { jitter: 0 }); normalizeGeo(cordG2);
    Bin.geo('metal', cordG2, placeMatrix(cx - 0.2, BNK.cy, cz - 0.2), [0.12, 0.12, 0.12], { jitter: 0 });
    const bunkBulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffbe86, emissiveIntensity: 2.2, roughness: 0.4 }));
    bunkBulb.position.set(cx - 0.2, BNK.cy - 0.52, cz - 0.2); scene.add(bunkBulb);
    // a curtain across the doorway bay and a bucket under the drip
    Bin.box('canvas', 1.4, 1.9, 0.03, -1.65, FY + 1.1, BNK.z0 + 0.05, [0.34, 0.34, 0.28], { ry: 0.06, jitter: 0.07 });
    const bkx = BNK.x0 + 0.45, bkz = 311.3;
    Bin.cyl('metal', 0.15, 0.13, 0.3, bkx, FY + 0.15, bkz, [0.42, 0.42, 0.40], { seg: 12, open: true });
    Bin.cyl('metal', 0.13, 0.13, 0.01, bkx, FY + 0.005, bkz, [0.42, 0.42, 0.40], { seg: 12 });
    Bin.cyl('glass', 0.11, 0.11, 0.01, bkx, FY + 0.22, bkz, [0.2, 0.22, 0.2], { seg: 12, noShadow: true });
    Bin.cyl('scorch', 0.5, 0.5, 0.005, bkx, FY + 0.01, bkz, [1, 1, 1], { seg: 16, noShadow: true });
    world.addCylinder(bkx, bkz, 0.17, FY, FY + 0.3, { tag, surface: 'metal' });
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), new THREE.MeshStandardMaterial({ color: 0xbfd0d8, roughness: 0.1, metalness: 0.3 }));
    drop.position.set(bkx, BNK.cy, bkz); drop.visible = false; scene.add(drop); anim.drop = drop;
    anim.dripAt = V3(bkx, FY + 0.3, bkz); anim.dripTop = BNK.cy;
    poster(-2.6, FY + 1.9, BNK.z1 - 0.03, Math.PI, 0.55, 0.8, [0.78, 0.72, 0.62]);
    stations.bed = V3(cx, FY, cz);
  }

  // ---- MED CORNER: a gurney, a cabinet, a sink, cold light.
  const MED = RM.med;
  {
    dado('z', MED.x0, 311.1, 314.1, 1);
    Bin.box('paint', 3.4, 1.35, 0.03, 3.6, FY + 0.7, MED.z1 - 0.02, [0.74, 0.75, 0.72], { jitter: 0.03, noShadow: true });   // tiled wall
    const gx2 = 3.6, gz2 = 313.4;
    Bin.box('metal', 1.9, 0.07, 0.72, gx2, FY + 0.72, gz2, [0.42, 0.44, 0.42], { jitter: 0.03 });
    Bin.box('canvas', 1.84, 0.09, 0.68, gx2, FY + 0.8, gz2, [0.58, 0.57, 0.52], { jitter: 0.03 });
    for (const [a, b] of [[-0.8, -0.28], [0.8, -0.28], [-0.8, 0.28], [0.8, 0.28]]) Bin.cyl('metal', 0.022, 0.022, 0.7, gx2 + a, FY + 0.36, gz2 + b, [0.42, 0.44, 0.42], { seg: 5 });
    for (const a of [-0.82, 0.82]) Bin.geo('metal', new THREE.TorusGeometry(0.03, 0.008, 4, 8), placeMatrix(gx2 + a, FY + 0.08, gz2 + 0.28, Math.PI / 2, 0, 0), [0.2, 0.2, 0.2], { jitter: 0 });
    world.addBox(gx2, FY + 0.4, gz2, 1.95, 0.85, 0.78, { tag, surface: 'metal' });
    Bin.cyl('metal', 0.015, 0.015, 1.7, gx2 - 1.15, FY + 0.85, gz2 - 0.4, [0.6, 0.6, 0.58], { seg: 6 });   // drip stand
    Bin.cyl('metal', 0.16, 0.16, 0.02, gx2 - 1.15, FY + 0.02, gz2 - 0.4, [0.5, 0.5, 0.48], { seg: 10 });
    Bin.box('glass', 0.1, 0.2, 0.08, gx2 - 1.15, FY + 1.6, gz2 - 0.4, [0.6, 0.62, 0.58], { noShadow: true });
    // cabinet with a glass door (a container)
    const mcx = MED.x1 - 0.32, mcz = 312.4;
    Bin.box('paint', 0.5, 1.75, 1.35, mcx, FY + 0.88, mcz, [0.74, 0.75, 0.72], { jitter: 0.03 });
    for (let i = 0; i < 3; i++) Bin.box('paint', 0.44, 0.04, 1.25, mcx, FY + 0.45 + i * 0.45, mcz, [0.66, 0.67, 0.64], { jitter: 0.04 });
    for (let i = 0; i < 9; i++) Bin.cyl('glass', 0.045, 0.045, 0.14, mcx - 0.1, FY + 0.55 + (i % 3) * 0.45, mcz - 0.45 + Math.floor(i / 3) * 0.42, [0.7, 0.72, 0.66], { seg: 8, jitter: 0.1, seed: i });
    world.addBox(mcx, FY + 0.88, mcz, 0.55, 1.78, 1.4, { tag, surface: 'metal' });
    const mcPivot = new THREE.Group(); mcPivot.position.set(mcx - 0.24, FY + 0.88, mcz - 0.66);
    const mcG = new THREE.BoxGeometry(0.03, 1.7, 1.3); mcG.translate(0, 0, 0.65);
    colorize(mcG, [0.62, 0.66, 0.62], { jitter: 0.03 }); normalizeGeo(mcG);
    mcPivot.add(new THREE.Mesh(mcG, material('glass')));
    scene.add(mcPivot); openables.push({ pivot: mcPivot, open: 0, t: 0, dir: 1.4, axis: 'y' });
    stations.medcab = V3(mcx, FY, mcz);
    // sink and mirror on the west wall
    const skx = MED.x0 + 0.42;
    Bin.box('paint', 0.5, 0.28, 0.6, skx, FY + 0.78, 311.5, [0.78, 0.79, 0.76], { jitter: 0.03 });
    Bin.cyl('paint', 0.18, 0.15, 0.1, skx, FY + 0.9, 311.5, [0.7, 0.71, 0.68], { seg: 12, open: true });
    Bin.cyl('metal', 0.018, 0.018, 0.22, skx - 0.16, FY + 1.02, 311.5, [0.55, 0.55, 0.52], { seg: 6 });
    Bin.cyl('metal', 0.018, 0.018, 0.16, skx - 0.09, FY + 1.12, 311.5, [0.55, 0.55, 0.52], { rz: Math.PI / 2, seg: 6 });
    Bin.box('glass', 0.02, 0.5, 0.4, MED.x0 + 0.03, FY + 1.55, 311.5, [0.3, 0.34, 0.34], { noShadow: true });
    world.addBox(skx, FY + 0.5, 311.5, 0.55, 1.0, 0.65, { tag, surface: 'metal' });
    Bin.box('paint', 0.03, 0.5, 0.4, MED.x0 + 0.05, FY + 1.55, 313.6, [0.82, 0.80, 0.72], { noShadow: true });
    fixture(3.6, 312.3, MED.cy - 0.1, 1.3);
  }

  // ---- RANGE: a lane running the width of the outpost, targets on a carriage, an earth backstop.
  //      The firing point is at the east end by the door; the shot goes west into banked earth.
  const RNG = RM.range;
  {
    dado('x', RNG.z0, -13.6, -4.5, 1); dado('x', RNG.z1, -13.6, -4.5, -1);
    for (const x of [-11.6, -6.8]) fixture(x, 312.6, RNG.cy - 0.12, 1.4);
    // firing point: a plank rest on trestles, set across the lane at the east end
    const flx = -5.5;
    Bin.box('plank', 0.55, 0.1, 2.0, flx, FY + 1.1, 312.0, [0.42, 0.36, 0.26], { jitter: 0.05 });
    for (const s of [-0.8, 0, 0.8]) Bin.box('plank', 0.5, 1.05, 0.1, flx, FY + 0.55, 312.0 + s, [0.36, 0.30, 0.22]);
    world.addBox(flx, FY + 0.58, 312.0, 0.6, 1.15, 2.1, { tag, surface: 'wood' });   // 1.4 m of walking room south of it, so the target line stays reachable
    Bin.box('canvas', 0.5, 0.06, 1.0, flx, FY + 1.18, 311.4, [0.36, 0.36, 0.28], { jitter: 0.06 });
    Bin.box('paint', 0.2, 0.16, 0.34, flx, FY + 1.23, 312.8, OLIVE, { ry: 0.2, jitter: 0.06 });
    for (const x2 of [flx - 0.9, flx + 0.5]) Bin.box('metal', 0.12, 0.12, 0.04, x2, FY + 1.75, RNG.z0 + 0.09, [0.3, 0.3, 0.28]);
    Bin.box('paint', 0.1, 0.18, 0.16, -4.9, FY + 1.6, RNG.z0 + 0.16, [0.20, 0.24, 0.22], { jitter: 0.05 });   // ear defenders on a hook
    // lane markings and spent brass
    for (let i = 0; i < 3; i++) Bin.box('paint', 6.4, 0.004, 0.06, -9.6, FY + 0.012, 311.6 + i * 1.2, [0.62, 0.55, 0.24], { jitter: 0.1, noShadow: true });
    for (let i = 0; i < 26; i++) Bin.cyl('metal', 0.006, 0.006, 0.025, flx - 0.6 - rnd() * 1.3, FY + 0.01, 312.6 + (rnd() - 0.5) * 2.4, [0.52, 0.42, 0.18], { rz: Math.PI / 2, ry: rnd() * 3, seg: 5, jitter: 0.2, seed: i });
    // backstop: banked earth and a steel plate against the west wall
    Bin.box('earth', 1.5, 1.5, 3.4, RNG.x0 + 0.75, FY + 0.65, 312.6, [0.40, 0.36, 0.28], { rz: 0.35, ground: FY, dampH: 1.0, damp: 0.3, jitter: 0.08 });
    Bin.box('metal', 0.1, 1.4, 3.4, RNG.x0 + 1.5, FY + 0.9, 312.6, [0.28, 0.28, 0.26], { rz: 0.3, jitter: 0.05 });
    world.addBox(RNG.x0 + 1.0, FY + 0.75, 312.6, 2.0, 1.6, 3.5, { tag, surface: 'metal' });
    // the target carriage on a rail, run out to the far end or drawn back for a paste-up
    Bin.cyl('metal', 0.03, 0.03, 7.4, -9.6, RNG.cy - 0.35, 312.6, [0.45, 0.45, 0.42], { rz: Math.PI / 2, seg: 6 });
    const carriage = new THREE.Group(); carriage.position.set(-12.2, 0, 312.6); scene.add(carriage);
    const frameG = [];
    for (const s of [-1.1, 0, 1.1]) {
      for (const t of [-0.42, 0.42]) { const g1 = new THREE.BoxGeometry(0.05, 1.5, 0.05); g1.translate(0, FY + 0.75, s + t); frameG.push(g1); }
      const g3 = new THREE.BoxGeometry(0.05, 0.05, 0.92); g3.translate(0, FY + 1.48, s); frameG.push(g3);
    }
    const fm = new THREE.Mesh(mergeAll(frameG.map((g) => { colorize(g, [0.35, 0.36, 0.34], { jitter: 0.05 }); return normalizeGeo(g); })), material('metal'));
    carriage.add(fm);
    for (const s of [-1.1, 0, 1.1]) {
      // the faces look back down the lane at the firing point, so they are turned to +x
      const pg = new THREE.PlaneGeometry(0.72, 0.98); colorize(pg, [0.86, 0.84, 0.78], { jitter: 0.03 }); normalizeGeo(pg);
      const pm = new THREE.Mesh(pg, material('poster')); pm.position.set(0.04, FY + 0.95, s); pm.rotation.y = Math.PI / 2; carriage.add(pm);
      const rg = new THREE.CircleGeometry(0.17, 16); colorize(rg, [0.24, 0.22, 0.20], { jitter: 0 }); normalizeGeo(rg);
      const rm = new THREE.Mesh(rg, material('poster')); rm.position.set(0.05, FY + 1.0, s); rm.rotation.y = Math.PI / 2; carriage.add(rm);
    }
    anim.carriage = carriage; anim.carriageOut = true;
    stations.range = V3(flx, FY, 312.6);
  }

  // ------------------------------------------------------------------ lights
  // Interior lamps live in one group; it is only added to the scene while the player is inside, so the
  // outdoor pass never pays for them. The count is trimmed on the low quality tiers.
  const lightGroup = new THREE.Group(); lightGroup.name = 'vanno-lights';
  // priority order: what a phone keeps first. A dropped lamp still has its emissive fixture, so the
  // room reads as lit-but-dim rather than black, and the failing tube keeps flickering either way.
  const LAMPS = [
    [0, 0xdfe8d6, 6.2, 17, -3.6, HALL.cy - 0.4, 303.4, 'hall'],
    [1, 0xffbe86, 3.4, 10, -2.6, FY + 1.2, 307.6, 'stove'],
    [2, 0xd8e0d0, 4.6, 12, -10.7, ARM.cy - 0.4, 304.4, 'armoury'],
    [3, 0xffc98a, 5.0, 10, WKS.x1 - 1.05, WKS.cy - 1.15, 302.5, 'bench'],
    [4, 0xffb070, 3.6, 10, 11.0, GEN.cy - 0.4, 307.4, 'genset'],
    [5, 0xff9a70, 2.6, 8, 0, RM.entry.cy - 0.3, 298.0, 'entry'],
    [6, 0xffbe86, 3.0, 9, -1.4, BNK.cy - 0.5, 312.8, 'bunk'],
    [7, 0xeaf0ea, 3.4, 9, 3.6, MED.cy - 0.3, 312.3, 'med'],
    [8, 0xdfe8d6, 3.0, 12, 3.6, HALL.cy - 0.4, 306.4, 'hallB'],
    [9, 0xd8e0d0, 3.2, 13, -9.2, RNG.cy - 0.3, 312.6, 'range'],
    [10, 0xcfd8cc, 2.0, 11, -6.4, COR.cy - 0.25, 309.6, 'corridor'],
  ];
  const budget = ctx.quality === 'low' ? 5 : ctx.quality === 'medium' ? 8 : 11;
  const lamp = {};
  for (const [pri, col, inten, dist, lx, ly, lz, name] of LAMPS) {
    if (pri >= budget) continue;
    const L = new THREE.PointLight(col, inten, dist, 1.7); L.position.set(lx, ly, lz);
    lightGroup.add(L); lamp[name] = { light: L, base: inten };
  }
  const tubeMatA = material('tube'); tubeMatA.emissiveIntensity = 1.6;
  if (tubeGeos.length) { const m = new THREE.Mesh(mergeAll(tubeGeos), tubeMatA); m.name = 'vanno-tubes'; scene.add(m); }
  Bin.finish(); B.finish();

  // ------------------------------------------------------------------ base volume, door, stations, containers
  world.baseVolume.min.set(-14.4, FY - 0.5, 296.3);   // above the dock lip and the stair: only the bunker floor is inside
  world.baseVolume.max.set(14.4, FY + 5.4, 314.8);
  const player = ctx.player;
  const insideDoor = () => player.position.z > DOOR_Z;
  let transition = null;
  const doorPos = V3(0, FY + 1.1, DOOR_Z);
  ctx.interact.register({
    position: doorPos, radius: 2.6,
    prompt: () => (insideDoor() ? '[E] AIRLOCK DOOR · THE RADIUS' : '[E] ENTER VANNO'),
    onInteract() {
      if (transition) return;
      transition = { t: 0, toInside: !insideDoor(), done: false };
      ctx.hud.fadeOut(); ctx.audio.play('door_open', { pos: doorPos, gain: 0.9 });
    },
  });
  const station = (pos, prompt, panel, radius = 2.0, data) => ctx.interact.register({
    position: pos, radius, prompt,
    onInteract() { ctx.panels.open(panel, data || {}); },
  });
  station(V3(stations.terminal.x + 0.7, FY + 1.05, stations.terminal.z), '[E] TERMINAL 3 · CONTRACTS', 'terminal', 2.1);
  station(V3(stations.workbench.x - 0.75, FY + 1.05, stations.workbench.z), '[E] WORKBENCH · CLEAN AND LOAD', 'workbench', 2.2);
  station(V3(stations.supply.x - 0.7, FY + 1.15, stations.supply.z), '[E] SUPPLY COUNTER · BUY AND SELL', 'supply', 2.2);
  station(V3(stations.bed.x, FY + 0.9, stations.bed.z - 0.6), '[E] COT · SLEEP UNTIL MORNING', 'bed', 2.2);

  // ---- physical storage. Each of these is a piece of furniture standing in a room; you walk to it and open
  // it. They all route to the storage form, passing which container was opened (see the note in the report:
  // panel_storage.js must read data.container and key state.data.storage.by[container] to make them separate).
  const CONTAINERS = [
    { id: 'locker61', name: 'Locker 61', prompt: '[E] LOCKER 61 · PERSONAL STOWAGE', at: stations.locker1, off: [0.5, 1.0, 0.35], open: 1 },
    { id: 'locker60', name: 'Locker 60', prompt: '[E] LOCKER 60 · STOWAGE', at: stations.locker0, off: [0.42, 1.0, 0.35], open: 0 },
    { id: 'locker62', name: 'Locker 62', prompt: '[E] LOCKER 62 · STOWAGE', at: stations.locker2, off: [0.42, 1.0, 0.35], open: 2 },
    { id: 'shelf_a', name: 'Shelf 3-A', prompt: '[E] SHELF 3-A · GENERAL STORES', at: stations.shelf0, off: [1.0, 1.1, 0] },
    { id: 'shelf_b', name: 'Shelf 3-B', prompt: '[E] SHELF 3-B · GENERAL STORES', at: stations.shelf1, off: [1.0, 1.1, 0] },
    { id: 'shelf_c', name: 'Shelf 3-C', prompt: '[E] SHELF 3-C · GENERAL STORES', at: stations.shelf2, off: [1.0, 1.1, 0] },
    { id: 'rack_a', name: 'Weapon rack A', prompt: '[E] WEAPON RACK · SECTION A', at: stations.rack0, off: [0, 1.1, -0.85] },
    { id: 'rack_b', name: 'Weapon rack B', prompt: '[E] WEAPON RACK · SECTION B', at: stations.rack1, off: [0, 1.1, -0.85] },
    { id: 'ammo_cabinet', name: 'Ammunition cabinet', prompt: '[E] AMMUNITION CABINET · DRAWERS', at: stations.ammocab, off: [-0.95, 0.9, 0] },
    { id: 'crates', name: 'Crate stack', prompt: '[E] CRATE STACK · MUNITIONS', at: stations.crates, off: [0.9, 0.9, 0] },
    { id: 'parts_bin', name: 'Parts bins', prompt: '[E] PARTS BINS · COMPONENTS', at: stations.parts, off: [0, 1.15, -0.8] },
    { id: 'layout_table', name: 'Lay-out table', prompt: '[E] LAY-OUT TABLE · SET OUT KIT', at: stations.table, off: [0, 0.95, -1.0], radius: 2.4 },
    { id: 'footlocker_a', name: 'Footlocker · berth 1', prompt: '[E] FOOTLOCKER · BERTH 1', at: stations.footlocker0, off: [0.7, 0.6, 0], open: 3 },
    { id: 'footlocker_b', name: 'Footlocker · berth 2', prompt: '[E] FOOTLOCKER · BERTH 2', at: stations.footlocker1, off: [0.7, 0.6, 0], open: 4 },
    { id: 'med_cabinet', name: 'Medical cabinet', prompt: '[E] MEDICAL CABINET · DRESSINGS', at: stations.medcab, off: [-0.8, 1.0, 0], open: 5 },
  ];
  for (const c of CONTAINERS) {
    if (!c.at) continue;
    const p = V3(c.at.x + c.off[0], FY + c.off[1], c.at.z + c.off[2]);
    stations['container_' + c.id] = p;
    ctx.interact.register({
      position: p, radius: c.radius || 1.9, prompt: c.prompt,
      onInteract() {
        const o = openables[c.open];
        if (o) { o.t = 5.0; }
        ctx.audio.play('container_open', { pos: p, gain: 0.7 });
        ctx.panels.open('storage', { container: c.id, name: c.name });
      },
    });
  }
  // the sealed cage: clearance 2 or it stays shut
  ctx.interact.register({
    position: V3(stations.cage.x, FY + 1.2, stations.cage.z), radius: 1.9,
    prompt: () => (ctx.state.data.securityLevel >= 2 ? '[E] CAGE · RESTRICTED STORES' : '[E] CAGE · SEALED · CLEARANCE 2'),
    onInteract() {
      if (ctx.state.data.securityLevel >= 2) { ctx.audio.play('container_open', { pos: stations.cage, gain: 0.7 }); ctx.panels.open('storage', { container: 'cage', name: 'Restricted stores' }); }
      else { ctx.audio.play('ui_deny', { gain: 0.6 }); ctx.hud.notify('Cage sealed. Security level 2 required.', { code: 'UNPSC · VANNO STORES' }); }
    },
  });
  // the range target line
  ctx.interact.register({
    position: V3(-4.9, FY + 1.2, 312.6), radius: 2.2,
    prompt: () => (anim.carriageOut ? '[E] TARGET LINE · RUN BACK' : '[E] TARGET LINE · RUN OUT'),
    onInteract() { anim.carriageOut = !anim.carriageOut; ctx.audio.play('ui_slip', { pos: V3(-10.0, FY + 1.2, 312.6), gain: 0.6 }); },
  });

  // ------------------------------------------------------------------ update
  let dripT = 3 + rnd() * 4, dropT = -1, flickA = 1, genFlick = 1;
  let radioT = 12 + rnd() * 20, sirenT = 0, lightsOn = null, retryT = 0;
  let genLoop = null;
  const tmpV = new THREE.Vector3();
  const inside = () => {
    const p = player.position;
    return p.z > DOOR_Z + 0.05 && p.z < 315.2 && p.x > -14.6 && p.x < 14.6 && p.y > FY - 1.0 && p.y < FY + 6;
  };
  const setLights = (on) => {
    if (lightsOn === on) return;
    lightsOn = on;
    if (on) scene.add(lightGroup); else scene.remove(lightGroup);
    if (!on && genLoop) { genLoop.stop(1.2); genLoop = null; }
  };
  setLights(false);

  // back-compatible aliases for the two station names the single-room Vanno exposed
  stations.storage = stations.locker1 || stations.crates;
  stations.door = doorPos;

  return {
    stations, floorY: FY, rooms: RM, containers: CONTAINERS.map((c) => c.id),
    update(dt) {
      const t = ctx.elapsed; timeUniform.value = t;
      const here = inside();
      setLights(here);
      // ---- door transition
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
      // ---- exterior lamps: on from dusk to dawn, sagging as the generator loads
      const night = ctx.time.night;
      const lampOn = night > 0.08 || ctx.time.hour < 7.2;
      const sag = 0.85 + 0.15 * Math.sin(t * 1.7) * Math.sin(t * 0.37);
      anim.doorLight.intensity += ((lampOn ? 14 : 1.2) * sag - anim.doorLight.intensity) * Math.min(1, dt * 3);
      anim.lampBulb.material.emissiveIntensity = (lampOn ? 6 : 0.4) * sag;
      anim.floodLight.intensity += ((lampOn ? 16 : 0) * sag - anim.floodLight.intensity) * Math.min(1, dt * 3);
      anim.floodBulb.material.emissiveIntensity = (lampOn ? 7 : 0) * sag;
      anim.flag.rotation.y = -0.4 + 0.5 * Math.sin(t * 0.11) + 0.08 * Math.sin(t * 0.9);
      anim.barrier.rotation.z = 1.16 + Math.sin(t * 0.5) * 0.012;
      // ---- daylight through the clerestory
      const day = 1 - Math.min(1, night * 1.25);
      if (anim.panes) anim.panes.emissiveIntensity = 0.12 + 1.5 * day;
      // ---- the failing tube over the east half of the hall
      const h = Math.abs(Math.sin(Math.floor(t * 21) * 12.9898) * 43758.5453) % 1;
      const bad = Math.sin(t * 0.21) > 0.55;
      flickA += ((bad ? (h < 0.55 ? 0.1 : 1) : (h < 0.06 ? 0.35 : 1)) - flickA) * Math.min(1, dt * 40);
      anim.tubeB.emissiveIntensity = 0.15 + 1.5 * flickA;
      if (lamp.hallB) lamp.hallB.light.intensity = lamp.hallB.base * flickA;
      tubeMatA.emissiveIntensity = 1.6 + 0.05 * Math.sin(t * 120);
      // ---- the generator: a flywheel, a pilot lamp, warm light that breathes
      genFlick = 0.86 + 0.14 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 31.0);
      anim.genFly.rotation.x = (t * 18) % (Math.PI * 2);
      anim.genFly.position.y = FY + 0.85 + Math.sin(t * 34) * 0.002;
      anim.pilot.emissiveIntensity = 1.4 + 0.5 * Math.sin(t * 3.1);
      if (lamp.genset) lamp.genset.light.intensity = lamp.genset.base * genFlick;
      if (lamp.hall) lamp.hall.light.intensity = lamp.hall.base * (0.94 + 0.06 * Math.sin(t * 1.9));
      anim.ember.emissiveIntensity = 2.0 + 0.9 * Math.sin(t * 1.7) + 0.4 * Math.sin(t * 5.3);
      if (lamp.stove) lamp.stove.light.intensity = lamp.stove.base * (0.85 + 0.15 * Math.sin(t * 1.7 + 0.6));
      anim.dial.emissiveIntensity = 1.2 + 0.5 * Math.abs(Math.sin(t * 0.9));
      anim.lamp.rotation.z = Math.sin(t * 1.3) * 0.03 + Math.sin(t * 2.9) * 0.008;
      anim.lamp.rotation.x = Math.sin(t * 1.1 + 1) * 0.022;
      anim.crt.material.emissiveIntensity = 1.3 + 0.12 * Math.sin(t * 9.0);
      // ---- clocks: the wall clock on game hours, the Tide dial on the countdown
      const hr = ctx.time.hour;
      anim.clock.hourH.rotation.z = -(hr / 12) * Math.PI * 2;
      anim.clock.minH.rotation.z = -(hr % 1) * Math.PI * 2;
      anim.clock.secH.rotation.z = -(Math.floor(t) % 60) * (Math.PI * 2 / 60);
      const tideS = ctx.time.tideIn ? ctx.time.tideIn() : Infinity;
      const cycle = 3 * 24 * 60;
      const frac = Number.isFinite(tideS) ? Math.max(0, Math.min(1, 1 - tideS / cycle)) : 0;
      anim.clock.tideHand.rotation.z = -(Math.PI * 0.25 + frac * Math.PI * 1.5);
      // ---- containers that swing open and shut themselves again
      for (const o of openables) {
        if (o.t > 0) o.t -= dt;
        o.open += ((o.t > 0 ? 1 : 0) - o.open) * Math.min(1, dt * (o.t > 0 ? 7 : 3));
        const a = o.open * o.dir;
        if (o.axis === 'x') o.pivot.rotation.x = a; else o.pivot.rotation.y = a;
      }
      // ---- target carriage
      if (anim.carriage) {
        const target = anim.carriageOut ? -12.2 : -7.6;
        anim.carriage.position.x += (target - anim.carriage.position.x) * Math.min(1, dt * 2.2);
      }
      if (!here) { if (anim.sirenLight) anim.sirenLight.intensity = 0; return; }

      // ================= inside only =================
      // the generator's own voice, positional, close and constant
      retryT -= dt;
      if (!genLoop && retryT <= 0) {
        retryT = 1.5;
        try { genLoop = ctx.audio.loop('base_hum', { pos: stations.generator, gain: 0.0, ref: 3.5, max: 46, rolloff: 1.1, bus: 'amb' }); } catch { genLoop = null; }
      }
      if (genLoop) {
        const d = Math.hypot(player.position.x - stations.generator.x, player.position.z - stations.generator.z);
        genLoop.setGain(0.28 + 0.34 * Math.max(0, 1 - d / 14), 0.5);
        genLoop.set?.('intensity', genFlick);
      }
      // radio chatter from the set in the hall: rare, quiet, never on top of itself
      radioT -= dt;
      if (radioT <= 0) {
        radioT = 22 + rnd() * 46;
        ctx.audio.play('mimic_radio', { pos: stations.radio, gain: 0.2 + rnd() * 0.12, rate: 0.86 + rnd() * 0.12, ref: 2.5, max: 26, reverb: 0.8 });
      }
      // the Tide siren is loudest here: the klaxon on the hall wall, with its beacon
      const warn = tideS < 3600;
      if (warn) {
        sirenT -= dt;
        if (sirenT <= 0) { sirenT = tideS < 600 ? 5.5 : 16; ctx.audio.play('siren', { pos: stations.klaxon, gain: 1.0, ref: 6, max: 70, reverb: 1.2 }); }
        const pulse = 0.5 + 0.5 * Math.sin(t * (tideS < 600 ? 5.0 : 2.2));
        anim.beacon.rotation.y = (t * 6) % (Math.PI * 2);
        anim.beaconMat.emissiveIntensity = 1.0 + 5.0 * pulse;
        if (anim.sirenLight) anim.sirenLight.intensity = 6 * pulse * (tideS < 600 ? 1.6 : 1);
      } else {
        sirenT = 0;
        anim.beaconMat.emissiveIntensity += (0 - anim.beaconMat.emissiveIntensity) * Math.min(1, dt * 3);
        if (anim.sirenLight) anim.sirenLight.intensity += (0 - anim.sirenLight.intensity) * Math.min(1, dt * 3);
      }
      // the drip in the bunk room
      dripT -= dt;
      if (dripT <= 0 && dropT < 0) { dropT = 0; dripT = 4 + rnd() * 7; anim.drop.visible = true; }
      if (dropT >= 0) {
        dropT += dt;
        const y = anim.dripTop - 0.5 * 9.8 * dropT * dropT;
        if (y <= FY + 0.28) { dropT = -1; anim.drop.visible = false; ctx.audio.play('drip', { pos: tmpV.copy(anim.dripAt), gain: 0.45, rate: 0.9 + rnd() * 0.25 }); }
        else anim.drop.position.y = y;
      }
    },
  };
}

// merge a list of BufferGeometries without pulling in the three addon at every call site
function mergeAll(list) {
  const merged = new THREE.BufferGeometry();
  let vTotal = 0, iTotal = 0;
  for (const g of list) { normalizeGeo(g); vTotal += g.attributes.position.count; iTotal += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vTotal * 3), nor = new Float32Array(vTotal * 3), uv = new Float32Array(vTotal * 2), col = new Float32Array(vTotal * 3);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      nor[(vo + i) * 3] = n.getX(i); nor[(vo + i) * 3 + 1] = n.getY(i); nor[(vo + i) * 3 + 2] = n.getZ(i);
      uv[(vo + i) * 2] = u ? u.getX(i) : 0; uv[(vo + i) * 2 + 1] = u ? u.getY(i) : 0;
      col[(vo + i) * 3] = c ? c.getX(i) : 1; col[(vo + i) * 3 + 1] = c ? c.getY(i) : 1; col[(vo + i) * 3 + 2] = c ? c.getZ(i) : 1;
    }
    const gi = g.index;
    for (let i = 0; i < (gi ? gi.count : p.count); i++) idx[io + i] = (gi ? gi.getX(i) : i) + vo;
    io += gi ? gi.count : p.count; vo += p.count;
    g.dispose();
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  merged.computeBoundingSphere();
  return merged;
}
