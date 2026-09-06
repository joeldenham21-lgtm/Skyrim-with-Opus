// ctx.world = terrain + collision + map data + shared registries (cover points, spawn spots, loot spots).
import * as THREE from 'three';
import { createTerrain } from './terrain.js';
import { createCollision } from './collision.js';
import * as MAP from './map.js';

export function createWorld(ctx) {
  const terrain = createTerrain(ctx);
  const collision = createCollision(terrain);
  const world = {
    map: MAP, pois: MAP.POIS, poi: MAP.poi, size: MAP.SIZE, half: MAP.HALF,
    terrain, collision,
    getHeight: terrain.getHeight, getNormal: terrain.getNormal, getSurface: terrain.getSurface, isWater: terrain.isWater,
    groundHeight: collision.groundHeight, resolveCapsule: collision.resolveCapsule, raycast: collision.raycast, lineOfSight: collision.lineOfSight,
    query: collision.query, pointInSolid: collision.pointInSolid,
    addBox: collision.addBox, addCylinder: collision.addCylinder, addCollider: collision.add, removeCollider: collision.remove, clearTag: collision.clearTag,
    // registries filled by structures/flora; consumed by AI, loot and missions
    coverPoints: [],      // Vector3 positions where a mimic can stand behind something
    spawnSpots: [],       // { position: Vector3, poi: id, kind: 'interior'|'exterior'|'hidden' }
    lootSpots: [],        // { position: Vector3, poi: id, kind: 'shelf'|'floor'|'crate' }
    hidingSpots: [],      // { position: Vector3, poi } for sliders
    // is the point inside the base bunker (safe from entities and the Tide)?
    baseVolume: { min: new THREE.Vector3(-8, -5, 292), max: new THREE.Vector3(8, 6, 314) },
    // smoke clouds (grenades): [{ position: Vector3, radius, t (seconds left) }]; entities test smokeBlocks(a, b) for vision
    smoke: [],
    smokeBlocks(a, b) {
      for (const s of world.smoke) {
        if (s.t <= 0) continue;
        // distance from the segment a-b to the cloud centre
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z; const l2 = abx * abx + aby * aby + abz * abz || 1e-6;
        let t = ((s.position.x - a.x) * abx + (s.position.y - a.y) * aby + (s.position.z - a.z) * abz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = a.x + abx * t - s.position.x, dy = a.y + aby * t - s.position.y, dz = a.z + abz * t - s.position.z;
        if (dx * dx + dy * dy + dz * dz < s.radius * s.radius) return true;
      }
      return false;
    },
    isInBase(p) { const b = world.baseVolume; return p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && p.y >= b.min.y && p.y <= b.max.y; },
    // nearest POI to a point
    nearestPoi(x, z, kinds = null) {
      let best = null, bd = Infinity;
      for (const p of MAP.POIS) { if (kinds && !kinds.includes(p.kind)) continue; const d = Math.hypot(p.x - x, p.z - z) - p.r; if (d < bd) { bd = d; best = p; } }
      return { poi: best, distance: bd };
    },
    // random walkable point in a radius (not water, not in solid)
    randomPoint(rnd, cx, cz, r, tries = 12) {
      for (let i = 0; i < tries; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (Math.abs(x) > MAP.HALF - 6 || Math.abs(z) > MAP.HALF - 6) continue;
        const y = terrain.getHeight(x, z);
        if (y < MAP.WATER_LEVEL + 0.1) continue;
        if (collision.pointInSolid(x, y + 0.5, z)) continue;
        return new THREE.Vector3(x, y, z);
      }
      return null;
    },
    update(dt, t) { terrain.update(dt, t); for (let i = world.smoke.length - 1; i >= 0; i--) { world.smoke[i].t -= dt; if (world.smoke[i].t <= 0) world.smoke.splice(i, 1); } },
  };
  return world;
}
