// Static colliders (boxes, cylinders) with a spatial hash; capsule resolution; ray queries.
// Boxes are axis-aligned in world space: { kind:'box', min:{x,y,z}, max:{x,y,z}, surface, tag, walkable }
// Rotated walls should be built from several small AABBs or approximated. Cylinders: { kind:'cyl', x, z, r, y0, y1 }.
import * as THREE from 'three';

const CELL = 16;
export function createCollision(terrain) {
  const grid = new Map();
  const all = [];
  const key = (i, j) => i * 100000 + j;
  const cellsOf = (c, fn) => {
    const x0 = c.kind === 'box' ? c.min.x : c.x - c.r, x1 = c.kind === 'box' ? c.max.x : c.x + c.r;
    const z0 = c.kind === 'box' ? c.min.z : c.z - c.r, z1 = c.kind === 'box' ? c.max.z : c.z + c.r;
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) fn(key(i, j));
  };
  const tmpN = new THREE.Vector3(), tmpD = new THREE.Vector3();
  const api = {
    all,
    add(c) {
      c.id = all.length; all.push(c);
      if (c.kind === 'box') { c.min = { x: Math.min(c.min.x, c.max.x), y: Math.min(c.min.y, c.max.y), z: Math.min(c.min.z, c.max.z) }; c.max = { x: Math.max(c.min.x, c.max.x), y: Math.max(c.min.y, c.max.y), z: Math.max(c.min.z, c.max.z) }; }
      cellsOf(c, (k) => { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); });
      return c;
    },
    // convenience: axis-aligned box from center + size
    addBox(cx, cy, cz, sx, sy, sz, extra = {}) {
      return api.add(Object.assign({ kind: 'box', min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 }, max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 }, surface: 'concrete' }, extra));
    },
    addCylinder(x, z, r, y0, y1, extra = {}) { return api.add(Object.assign({ kind: 'cyl', x, z, r, y0, y1, surface: 'wood' }, extra)); },
    remove(c) { c.dead = true; },
    clearTag(tag) { for (const c of all) if (c.tag === tag) c.dead = true; },
    query(x, z, r, fn) {
      const seen = new Set();
      for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const list = grid.get(key(i, j)); if (!list) continue;
        for (const c of list) { if (c.dead || seen.has(c)) continue; seen.add(c); if (fn(c) === false) return; }
      }
    },
    // Is a point inside any solid box? (used to reject spawns / probe landing)
    pointInSolid(x, y, z) {
      let hit = false;
      api.query(x, z, 0.1, (c) => { if (c.kind === 'box' && !c.passable && x >= c.min.x && x <= c.max.x && y >= c.min.y && y <= c.max.y && z >= c.min.z && z <= c.max.z) { hit = true; return false; } if (c.kind === 'cyl' && Math.hypot(x - c.x, z - c.z) < c.r && y >= c.y0 && y <= c.y1) { hit = true; return false; } });
      return hit;
    },
    // Ground height at (x,z) considering terrain and box tops the point could stand on (from fromY downward, with step allowance)
    groundHeight(x, z, fromY, step = 0.55) {
      let g = terrain.getHeight(x, z);
      let surface = null;
      api.query(x, z, 0.05, (c) => {
        if (c.kind !== 'box' || c.passable) return;
        if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) {
          const top = c.max.y;
          if (top > g && top <= fromY + step) { g = top; surface = c.surface || 'concrete'; }
        }
      });
      return { y: g, surface };
    },
    // Resolve a capsule (feet at pos, radius r, height h) against colliders. Mutates pos (x,z only). Returns true if any contact.
    resolveCapsule(pos, r, h, step = 0.55) {
      let contact = false;
      for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        api.query(pos.x, pos.z, r + 0.5, (c) => {
          if (c.passable) return;
          if (c.kind === 'box') {
            // vertical overlap? allow stepping onto low tops
            if (pos.y + h <= c.min.y || pos.y + step >= c.max.y) return;
            const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x)), cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
            let dx = pos.x - cx, dz = pos.z - cz;
            let d2 = dx * dx + dz * dz;
            if (d2 >= r * r) return;
            if (d2 < 1e-8) {
              // inside: push out along the nearest face
              const px = Math.min(pos.x - c.min.x, c.max.x - pos.x), pz = Math.min(pos.z - c.min.z, c.max.z - pos.z);
              if (px < pz) pos.x += (pos.x - c.min.x < c.max.x - pos.x ? -1 : 1) * (px + r); else pos.z += (pos.z - c.min.z < c.max.z - pos.z ? -1 : 1) * (pz + r);
            } else { const d = Math.sqrt(d2); const push = r - d; pos.x += dx / d * push; pos.z += dz / d * push; }
            contact = moved = true;
          } else {
            if (pos.y + h <= c.y0 || pos.y >= c.y1) return;
            const dx = pos.x - c.x, dz = pos.z - c.z; const d = Math.hypot(dx, dz); const rr = r + c.r;
            if (d >= rr) return;
            if (d < 1e-5) { pos.x += rr; } else { pos.x += dx / d * (rr - d); pos.z += dz / d * (rr - d); }
            contact = moved = true;
          }
        });
        if (!moved) break;
      }
      return contact;
    },
    // Ray vs colliders + terrain. Returns { distance, point, normal, surface, collider } or null.
    raycast(origin, dir, maxDist, opts = {}) {
      let best = null;
      const tT = terrain.raycast(origin, dir, maxDist, tmpN);
      if (tT >= 0) { best = { distance: tT, point: tmpN.clone(), normal: terrain.getNormal(tmpN.x, tmpN.z, new THREE.Vector3()), surface: terrain.getSurface(tmpN.x, tmpN.z), collider: null }; maxDist = tT; }
      // walk the grid cells along the ray (2D DDA over XZ)
      const seen = new Set();
      const steps = Math.ceil(maxDist / (CELL * 0.5)) + 1;
      for (let s = 0; s <= steps; s++) {
        const t = Math.min(maxDist, s * CELL * 0.5);
        const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
        const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!list) continue;
        for (const c of list) {
          // blocksBullets, when set, decides on its own: a chain-link fence or a picket rail is solid to walk into
          // and open to shoot through, while a catwalk deck is passable to walk through and solid to shoot at.
          // Unset, a collider stops bullets exactly when it stops feet.
          const stops = c.blocksBullets != null ? c.blocksBullets : !c.passable;
          if (c.dead || seen.has(c) || (opts.ignorePassable !== false && !stops)) continue; seen.add(c);
          let hitT = -1; let nx = 0, ny = 0, nz = 0;
          if (c.kind === 'box') {
            let tmin = 0, tmax = maxDist, axis = -1, sgn = 0;
            const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z], mn = [c.min.x, c.min.y, c.min.z], mx = [c.max.x, c.max.y, c.max.z];
            let ok = true;
            for (let a = 0; a < 3; a++) {
              if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) { ok = false; break; } continue; }
              let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a]; let sg = -1;
              if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sg = 1; }
              if (t1 > tmin) { tmin = t1; axis = a; sgn = sg; }
              if (t2 < tmax) tmax = t2;
              if (tmin > tmax) { ok = false; break; }
            }
            if (ok && tmin > 0.001 && tmin < maxDist) { hitT = tmin; if (axis === 0) nx = sgn; else if (axis === 1) ny = sgn; else nz = sgn; if (axis < 0) ny = 1; }
          } else {
            // infinite cylinder then clamp y
            const ox = origin.x - c.x, oz = origin.z - c.z;
            const a = dir.x * dir.x + dir.z * dir.z; if (a < 1e-9) continue;
            const b = 2 * (ox * dir.x + oz * dir.z), cc = ox * ox + oz * oz - c.r * c.r;
            const disc = b * b - 4 * a * cc; if (disc < 0) continue;
            const tq = (-b - Math.sqrt(disc)) / (2 * a);
            if (tq > 0.001 && tq < maxDist) { const y = origin.y + dir.y * tq; if (y >= c.y0 && y <= c.y1) { hitT = tq; nx = (origin.x + dir.x * tq - c.x) / c.r; nz = (origin.z + dir.z * tq - c.z) / c.r; } }
          }
          if (hitT >= 0 && (!best || hitT < best.distance)) {
            best = { distance: hitT, point: new THREE.Vector3(origin.x + dir.x * hitT, origin.y + dir.y * hitT, origin.z + dir.z * hitT), normal: new THREE.Vector3(nx, ny, nz), surface: c.surface || 'concrete', collider: c };
            maxDist = hitT;
          }
        }
      }
      return best;
    },
    // line of sight between two points (true if nothing solid in between)
    lineOfSight(a, b) {
      const d = tmpD.subVectors(b, a); const len = d.length(); if (len < 1e-3) return true; d.divideScalar(len);
      const hit = api.raycast(a, d, len - 0.05);
      return !hit;
    },
  };
  return api;
}
