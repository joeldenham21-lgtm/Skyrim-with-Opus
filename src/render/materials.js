/**
 * WYRMHOLD — shared material palette.
 *
 * Wraps the baked texture sets into MeshStandardMaterials that props, buildings
 * and characters draw from, plus the handful of non-textured materials the game
 * needs (skin, emissive magic, glass, blood decals).
 */

import * as THREE from 'three';
import { settings } from '../core/settings.js';

function fromSet(bakery, name, extra = {}) {
  const s = bakery.get(name);
  if (!s) throw new Error('material set not baked: ' + name);
  const m = new THREE.MeshStandardMaterial({
    map: s.albedo,
    normalMap: s.normal,
    roughnessMap: s.orm,
    metalnessMap: s.orm,
    aoMap: s.orm,
    roughness: 1,
    metalness: 1,
    ...extra,
  });
  m.name = name;
  m.normalScale.set(extra.normalScale ?? 1, extra.normalScale ?? 1);
  return m;
}

/**
 * NOTE: there is deliberately no "tiled material" helper here. Every texture in
 * this palette is a render-target texture, and cloning one yields a texture
 * with no GPU resource behind it — the surface renders black. UV repetition is
 * baked into geometry instead (see `Builder.mesh` in world/props.js).
 */

export function buildPalette(bakery) {
  const P = {};

  P.cloth = fromSet(bakery, 'cloth');
  P.leather = fromSet(bakery, 'leather');
  P.iron = fromSet(bakery, 'iron');
  P.steel = fromSet(bakery, 'steel');
  P.gold = fromSet(bakery, 'gold');
  P.fur = fromSet(bakery, 'fur');
  P.bone = fromSet(bakery, 'bone');
  P.plank = fromSet(bakery, 'plank');
  P.stone = fromSet(bakery, 'stoneWall');
  P.thatch = fromSet(bakery, 'thatch');
  P.shingle = fromSet(bakery, 'shingle');
  P.ice = fromSet(bakery, 'ice', { roughness: 1, metalness: 0 });
  P.rock = fromSet(bakery, 'rock');
  P.rune = fromSet(bakery, 'runestone');
  P.bark = fromSet(bakery, 'bark');
  P.foliage = fromSet(bakery, 'foliage');

  // Colour variants share the same textures but tint through `color`.
  const tint = (base, hex, over = {}) => {
    const m = base.clone();
    m.color = new THREE.Color(hex);
    Object.assign(m, over);
    return m;
  };
  P.clothBlue = tint(P.cloth, 0x5d7ea8);
  P.clothRed = tint(P.cloth, 0x8d4038);
  P.clothGreen = tint(P.cloth, 0x546b40);
  P.clothDark = tint(P.cloth, 0x4a4741);
  P.clothCream = tint(P.cloth, 0xa89b7e);
  P.leatherDark = tint(P.leather, 0x6a5340);
  P.ironDark = tint(P.iron, 0x8c8c92);

  // Skin: no texture needed under a hood, but give it real subsurface warmth.
  P.skin = new THREE.MeshStandardMaterial({
    color: 0xb08a6d, roughness: 0.68, metalness: 0.0,
  });
  P.skinPale = new THREE.MeshStandardMaterial({ color: 0xc4a68c, roughness: 0.66 });
  P.skinDraugr = new THREE.MeshStandardMaterial({ color: 0x6d6a56, roughness: 0.9 });

  // Emissives for magic, fire and eyes.
  const emissive = (hex, intensity = 3) => new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(hex), emissiveIntensity: intensity,
    roughness: 1, metalness: 0, toneMapped: true,
  });
  P.emFire = emissive(0xff7a22, 5);
  P.emFrost = emissive(0x74c8ff, 4);
  P.emShock = emissive(0xc9a4ff, 6);
  P.emHeal = emissive(0x9dffb0, 4);
  P.emEye = emissive(0x66d8ff, 8);
  P.emCandle = emissive(0xffc069, 6);
  P.emRune = emissive(0x63e0ff, 3);

  P.glass = new THREE.MeshPhysicalMaterial({
    color: 0x8fb8c4, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35,
  });

  P.blood = new THREE.MeshStandardMaterial({
    color: 0x4a0d0a, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.92,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });

  P.all = () => Object.values(P).filter(v => v && v.isMaterial);
  return P;
}
