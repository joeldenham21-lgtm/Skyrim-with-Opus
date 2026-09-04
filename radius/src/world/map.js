// The zone layout. All coordinates in metres, world space (x east, z south; north is -z). Size 640 x 640.
export const SIZE = 640;
export const HALF = SIZE / 2;
export const WATER_LEVEL = -0.6;

// Points of interest. r = radius. Structures, population, missions and loot all key off these.
export const POIS = [
  { id: 'vanno',     name: 'Vanno Outpost',        kind: 'base',       x: 0,    z: 300,  r: 34 },
  { id: 'checkpoint',name: 'Checkpoint 2',         kind: 'checkpoint', x: 22,   z: 212,  r: 22 },
  { id: 'convoy',    name: 'Convoy wreck',         kind: 'convoy',     x: 48,   z: 160,  r: 26 },
  { id: 'marsh',     name: 'Lower marsh',          kind: 'marsh',      x: -40,  z: 140,  r: 95 },
  { id: 'zarya',     name: 'Kolkhoz "Zarya"',      kind: 'village',    x: -130, z: 60,   r: 72 },
  { id: 'object12',  name: 'Object 12 substation', kind: 'industrial', x: 150,  z: -60,  r: 58 },
  { id: 'rail',      name: 'Rail cutting',         kind: 'rail',       x: -60,  z: -150, r: 60 },
  { id: 'church',    name: 'Church of St. Nikolai', kind: 'church',    x: 50,   z: -230, r: 42 },
  { id: 'forest',    name: 'Dead forest',          kind: 'forest',     x: -230, z: -70,  r: 85 },
  { id: 'field_a',   name: 'Anomaly field A',      kind: 'anomaly',    x: -60,  z: -40,  r: 40, anomaly: 'electric' },
  { id: 'field_b',   name: 'Anomaly field B',      kind: 'anomaly',    x: 225,  z: 70,   r: 45, anomaly: 'reflector' },
  { id: 'field_c',   name: 'Anomaly field C',      kind: 'anomaly',    x: -210, z: -210, r: 40, anomaly: 'gravity' },
  { id: 'vents',     name: 'Marsh vents',          kind: 'anomaly',    x: -90,  z: 170,  r: 35, anomaly: 'gas' },
  { id: 'north',     name: 'Northern ridge',       kind: 'ridge',      x: 0,    z: -300, r: 60 },
];
export const poi = (id) => POIS.find((p) => p.id === id);

// Roads: polylines of [x, z]. Width in metres. Terrain is flattened and surfaced along them.
export const ROADS = [
  { id: 'main', width: 5.5, pts: [[0, 318], [0, 282], [14, 240], [22, 212], [40, 176], [48, 160], [34, 120], [10, 96], [-50, 72], [-130, 60], [-180, 40]] },
  { id: 'east', width: 5.0, pts: [[10, 96], [70, 50], [120, -10], [150, -60], [165, -110]] },
  { id: 'church', width: 4.0, pts: [[150, -60], [110, -150], [70, -205], [50, -230]] },
  { id: 'forest', width: 3.5, pts: [[-130, 60], [-180, 0], [-230, -70], [-250, -150]] },
];
// Rail line: polyline; the terrain is cut/embanked to a constant grade around it.
export const RAIL = { width: 9, pts: [[-320, -120], [-200, -128], [-100, -138], [40, -155], [160, -168], [320, -178]] };

// Player start: just outside the base door, facing north.
export const START = { x: 0, z: 284, yaw: 0 };   // yaw 0 faces north (-z)
export const BASE = { x: 0, z: 302, yaw: 0 };   // bunker anchor (the door faces north toward the gate)
export const COLUMN = { x: 40, z: -1100 };

// distance from point to polyline; returns { d, t01 } t01 = normalized along-length param
export function distToPolyline(x, z, pts) {
  let best = Infinity, bt = 0, acc = 0, total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    const segLen = Math.sqrt(len2);
    if (d < best) { best = d; bt = (acc + t * segLen) / total; }
    acc += segLen;
  }
  return { d: best, t: bt };
}
export function pointOnPolyline(pts, t01) {
  let total = 0; const lens = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  let d = t01 * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) { const t = lens[i] > 0 ? Math.min(1, d / lens[i]) : 0; const a = pts[i], b = pts[i + 1]; return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / (lens[i] || 1), dz: (b[1] - a[1]) / (lens[i] || 1) }; }
    d -= lens[i];
  }
  return { x: pts[0][0], z: pts[0][1], dx: 1, dz: 0 };
}
