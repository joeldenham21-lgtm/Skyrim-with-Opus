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
    update(dt, t) { terrain.update(dt, t); },
  };
  return world;
}
