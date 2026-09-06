// STUB — owned by the graphics-materials agent. Procedural texture library and tuned materials:
//   ctx.materials.get(kind, params) -> MeshStandardMaterial with generated albedo/normal/roughness maps, cached.
//   kinds: concrete plaster brick rust paintedmetal steel gunmetal wood planks log birchbark pinebark fabric canvas leather rubber
//          grass leaf gravel mud road tile glass; params: { color, scale, wear, seed, roughness, metalness, emissive }.
import * as THREE from 'three';
export function createMaterials(ctx) {
  const cache = new Map();
  return {
    get(kind, params = {}) {
      const key = kind + JSON.stringify(params);
      if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color: params.color ?? 0x777777, roughness: params.roughness ?? 0.85, metalness: params.metalness ?? 0.0 }));
      return cache.get(key);
    },
    texture(kind, params = {}) { return null; },
    update(dt, t) {},
  };
}
