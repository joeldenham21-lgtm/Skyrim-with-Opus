/**
 * WYRMHOLD — buildings, camps, ruins and the interior of the barrow.
 *
 * Everything here is assembled from primitives and the shared material
 * palette. Each builder returns a group plus the colliders and interactables
 * the game layer needs, so placing a village is one call.
 */

import * as THREE from 'three';
import { Rand, TAU, clamp, lerp, saturate } from '../core/math.js';

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export class Builder {
  constructor(palette) {
    this.P = palette;
    this.group = new THREE.Group();
    this.colliders = [];
    this.interactables = [];
    this.lights = [];
    this.spawns = [];
  }

  mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = null) {
    if (mat && mat.__tiled) { geo = scaledUvGeometry(geo, mat.repeat); mat = mat.__tiled; }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || this.group).add(m);
    return m;
  }

  box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = null) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz, parent);
  }
  cyl(rt, rb, h, seg, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = null) {
    return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, ry, rz, parent);
  }
  collider(x, y, z, r, h, blocksCamera = true) {
    this.colliders.push({ x, y, z, r, h, blocksCamera });
  }
  interact(type, x, y, z, data = {}) {
    const it = { type, x, y, z, radius: data.radius ?? 1.9, ...data };
    this.interactables.push(it);
    return it;
  }
  light(x, y, z, color, intensity, distance, opts = {}) {
    this.lights.push({ x, y, z, color, intensity, distance, ...opts });
  }
}

/**
 * Requests that a mesh repeat its material N times across its UVs.
 *
 * The obvious implementation — clone the material and clone its textures with
 * `repeat` set — silently breaks here: every texture in the palette is a render
 * target, and `Texture.clone()` produces a texture whose GPU resource was never
 * created, so three tries to upload it from a null source and the surface
 * renders pure black. Instead this returns a marker that `Builder.mesh` unwraps,
 * baking the repeat into a cached copy of the *geometry's* UVs. That keeps one
 * material per surface type, which also means the static batcher can merge them.
 */
const tiledCache = new Map();
function tile(mat, repeat) {
  const key = mat.uuid + '|' + repeat;
  let t = tiledCache.get(key);
  if (!t) { t = { __tiled: mat, repeat }; tiledCache.set(key, t); }
  return t;
}
export function clearTileCache() { tiledCache.clear(); uvCache.clear(); }

const uvCache = new Map();
function scaledUvGeometry(geo, scale) {
  if (scale === 1 || !geo.attributes.uv) return geo;
  const key = geo.uuid + '|' + scale;
  let g = uvCache.get(key);
  if (g) return g;
  g = geo.clone();
  const uv = g.attributes.uv;
  const arr = uv.array;
  for (let i = 0; i < arr.length; i++) arr[i] *= scale;
  uv.needsUpdate = true;
  uvCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------
// Individual props
// ---------------------------------------------------------------------------

export function makeBarrel(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.y = rot;
  B.group.add(g);
  const body = new THREE.CylinderGeometry(0.34, 0.30, 0.86, 12);
  B.mesh(body, tile(P.plank, 2), 0, 0.43, 0, 0, 0, 0, g);
  for (const yy of [0.14, 0.72]) {
    B.mesh(new THREE.TorusGeometry(0.345, 0.022, 5, 14), P.iron, 0, yy, 0, Math.PI / 2, 0, 0, g);
  }
  B.collider(x, y, z, 0.38, 0.9, false);
  return g;
}

export function makeCrate(B, x, y, z, rot = 0, s = 1) {
  const P = B.P;
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.y = rot;
  B.group.add(g);
  B.mesh(new THREE.BoxGeometry(0.7 * s, 0.62 * s, 0.7 * s), tile(P.plank, 1.5), 0, 0.31 * s, 0, 0, 0, 0, g);
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    B.mesh(new THREE.BoxGeometry(ax ? 0.74 * s : 0.05, 0.05, az ? 0.74 * s : 0.05),
      P.iron, 0, 0.31 * s, 0, 0, 0, 0, g);
  }
  B.collider(x, y, z, 0.42 * s, 0.65 * s, false);
  return g;
}

export function makeChest(B, x, y, z, rot = 0, loot = 'chest', locked = 0) {
  const P = B.P;
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.y = rot;
  B.group.add(g);
  B.mesh(new THREE.BoxGeometry(0.92, 0.48, 0.56), tile(P.plank, 1.2), 0, 0.24, 0, 0, 0, 0, g);
  const lid = new THREE.Group();
  lid.userData.dynamic = true;
  lid.position.set(0, 0.48, -0.28);
  g.add(lid);
  const half = new THREE.CylinderGeometry(0.28, 0.28, 0.92, 10, 1, false, 0, Math.PI);
  half.rotateZ(Math.PI / 2);
  B.mesh(half, tile(P.plank, 1.2), 0, 0, 0.28, 0, 0, 0, lid);
  B.mesh(new THREE.BoxGeometry(0.1, 0.14, 0.06), P.iron, 0, 0.06, 0.30, 0, 0, 0, g);
  for (const bx of [-0.32, 0.32]) B.mesh(new THREE.BoxGeometry(0.06, 0.5, 0.58), P.iron, bx, 0.24, 0, 0, 0, 0, g);
  B.collider(x, y, z, 0.5, 0.55, false);
  B.interact('container', x, y + 0.5, z, { loot, locked, label: locked ? 'Locked Chest' : 'Chest', lid, opened: false });
  return g;
}

export function makeCampfire(B, x, y, z, lit = true) {
  const P = B.P;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  B.group.add(g);
  const rnd = new Rand((x * 31 + z * 17) | 0);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU;
    B.mesh(new THREE.SphereGeometry(rnd.float(0.10, 0.17), 6, 5), P.rock,
      Math.cos(a) * 0.62, 0.05, Math.sin(a) * 0.62, 0, 0, 0, g);
  }
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU + 0.3;
    B.mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.62, 6), P.plank,
      Math.cos(a) * 0.13, 0.24, Math.sin(a) * 0.13, 0.42, -a, 0, g);
  }
  if (lit) {
    B.light(x, y + 0.75, z, 0xff8a33, 5.0, 16, { flicker: 1, kind: 'fire' });
    B.interact('fire', x, y + 0.4, z, { label: 'Campfire', radius: 2.4, fire: true });
  }
  B.collider(x, y, z, 0.55, 0.4, false);
  g.userData.fire = lit;
  g.userData.firePos = new THREE.Vector3(x, y + 0.35, z);
  return g;
}

export function makeTent(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.y = rot;
  B.group.add(g);
  const cloth = P.clothDark;
  const geo = new THREE.CylinderGeometry(0.02, 1.45, 2.1, 4, 1, true);
  const m = B.mesh(geo, cloth, 0, 1.05, 0, 0, Math.PI / 4, 0, g);
  m.material = cloth.clone();
  m.material.side = THREE.DoubleSide;
  for (const sx of [-1, 1]) {
    B.mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), P.plank, sx * 0.95, 1.1, 0, 0, 0, sx * 0.35, g);
  }
  B.mesh(new THREE.BoxGeometry(1.6, 0.06, 1.6), P.fur, 0, 0.03, 0, 0, 0, 0, g);
  B.collider(x, y, z, 1.2, 2.0);
  B.interact('bed', x, y + 0.2, z, { label: 'Bedroll', radius: 2.0 });
  return g;
}

export function makeTorch(B, x, y, z, height = 2.1) {
  const P = B.P;
  B.mesh(new THREE.CylinderGeometry(0.045, 0.06, height, 6), P.plank, x, y + height / 2, z);
  B.mesh(new THREE.SphereGeometry(0.1, 8, 6), P.emFire, x, y + height, z);
  B.light(x, y + height + 0.1, z, 0xff9a44, 3.2, 12, { flicker: 1, kind: 'fire' });
  return { x, y: y + height, z };
}

export function makeCart(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group();
  g.position.set(x, y, z); g.rotation.y = rot;
  B.group.add(g);
  B.mesh(new THREE.BoxGeometry(1.5, 0.12, 2.6), tile(P.plank, 2), 0, 0.72, 0, 0, 0, 0, g);
  for (const sx of [-0.78, 0.78]) B.mesh(new THREE.BoxGeometry(0.08, 0.42, 2.6), tile(P.plank, 2), sx, 0.94, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(1.5, 0.42, 0.08), tile(P.plank, 1), 0, 0.94, -1.28, 0, 0, 0, g);
  for (const sx of [-0.82, 0.82]) {
    const w = new THREE.Group();
    w.position.set(sx, 0.55, 0.5);
    g.add(w);
    B.mesh(new THREE.TorusGeometry(0.52, 0.07, 6, 16), P.plank, 0, 0, 0, 0, Math.PI / 2, 0, w);
    for (let i = 0; i < 6; i++) {
      B.mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 5), P.plank, 0, 0, 0, 0, 0, i / 6 * Math.PI, w);
    }
  }
  for (const sx of [-0.6, 0.6]) B.mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6), P.plank, sx, 0.8, 2.0, Math.PI / 2 - 0.12, 0, 0, g);
  B.collider(x, y, z, 1.1, 1.4);
  return g;
}

export function makeFencePost(B, x, y, z) {
  const P = B.P;
  B.mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.25, 6), P.plank, x, y + 0.62, z);
  B.collider(x, y, z, 0.14, 1.3, false);
}

export function makeFenceRun(B, ax, ay, az, bx, by, bz, hf) {
  const P = B.P;
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / 2.1));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = ax + dx * t, pz = az + dz * t;
    const py = hf ? hf.heightAt(px, pz) : ay;
    makeFencePost(B, px, py, pz);
    if (i < n) {
      const t2 = (i + 1) / n;
      const qx = ax + dx * t2, qz = az + dz * t2;
      const qy = hf ? hf.heightAt(qx, qz) : by;
      for (const h of [0.5, 0.95]) {
        const mx = (px + qx) / 2, mz = (pz + qz) / 2, my = (py + qy) / 2 + h;
        const seg = Math.hypot(qx - px, qz - pz);
        const rail = B.mesh(new THREE.BoxGeometry(0.06, 0.09, seg), P.plank, mx, my, mz);
        rail.rotation.y = Math.atan2(qx - px, qz - pz);
      }
    }
  }
}

export function makeWell(B, x, y, z) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); B.group.add(g);
  B.mesh(new THREE.CylinderGeometry(1.05, 1.1, 0.9, 14), tile(P.stone, 2), 0, 0.45, 0, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.12, 14), P.stone, 0, 0.95, 0, 0, 0, 0, g);
  for (const sx of [-0.9, 0.9]) B.mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.0, 6), P.plank, sx, 1.9, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(2.3, 0.1, 1.3), tile(P.shingle, 1), 0, 2.95, 0, 0, 0, 0.3, g);
  B.mesh(new THREE.BoxGeometry(2.3, 0.1, 1.3), tile(P.shingle, 1), 0, 2.95, 0, 0, 0, -0.3, g);
  B.mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.7, 8), P.plank, 0, 2.6, 0, 0, 0, Math.PI / 2, g);
  B.collider(x, y, z, 1.15, 1.1);
  B.interact('water', x, y + 1.0, z, { label: 'Well', radius: 2.2 });
  return g;
}

export function makeForge(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.BoxGeometry(2.0, 1.1, 1.5), tile(P.stone, 2), 0, 0.55, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(1.4, 0.25, 1.0), P.emFire, 0, 1.16, 0, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 8), tile(P.stone, 1), 0.7, 2.3, 0, 0, 0, 0, g);
  B.light(x, y + 1.3, z, 0xff6a1a, 6.0, 14, { flicker: 1, kind: 'fire' });
  B.collider(x, y, z, 1.3, 1.3);
  B.interact('forge', x, y + 1.2, z, { label: 'Forge', radius: 2.6 });
  return g;
}

export function makeAnvil(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.55, 8), P.plank, 0, 0.28, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(0.85, 0.20, 0.30), P.iron, 0, 0.66, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(0.45, 0.16, 0.26), P.iron, 0, 0.50, 0, 0, 0, 0, g);
  B.mesh(new THREE.ConeGeometry(0.13, 0.42, 8), P.iron, 0.58, 0.66, 0, 0, 0, -Math.PI / 2, g);
  B.collider(x, y, z, 0.45, 0.8, false);
  B.interact('smith', x, y + 0.7, z, { label: 'Anvil', radius: 2.2 });
  return g;
}

export function makeTable(B, x, y, z, rot = 0, w = 1.6, d = 0.9) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.BoxGeometry(w, 0.09, d), tile(P.plank, 1.5), 0, 0.86, 0, 0, 0, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.mesh(new THREE.BoxGeometry(0.10, 0.86, 0.10), P.plank, sx * (w / 2 - 0.12), 0.43, sz * (d / 2 - 0.12), 0, 0, 0, g);
  }
  B.collider(x, y, z, Math.max(w, d) * 0.5, 0.95, false);
  return g;
}

export function makeChair(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.BoxGeometry(0.46, 0.07, 0.46), P.plank, 0, 0.48, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(0.46, 0.62, 0.07), P.plank, 0, 0.78, -0.20, 0, 0, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.mesh(new THREE.BoxGeometry(0.06, 0.48, 0.06), P.plank, sx * 0.18, 0.24, sz * 0.18, 0, 0, 0, g);
  }
  B.collider(x, y, z, 0.3, 0.6, false);
  return g;
}

export function makeBed(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.BoxGeometry(1.1, 0.32, 2.1), tile(P.plank, 1.5), 0, 0.30, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(1.05, 0.18, 2.0), P.clothCream, 0, 0.53, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(1.05, 0.10, 1.2), P.fur, 0, 0.64, 0.35, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(0.7, 0.14, 0.34), P.clothCream, 0, 0.66, -0.78, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(1.15, 0.72, 0.1), P.plank, 0, 0.5, -1.06, 0, 0, 0, g);
  B.collider(x, y, z, 0.9, 0.7, false);
  B.interact('bed', x, y + 0.7, z, { label: 'Bed', radius: 2.0 });
  return g;
}

export function makeShelf(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  for (const yy of [0.5, 1.05, 1.6]) B.mesh(new THREE.BoxGeometry(1.4, 0.06, 0.35), tile(P.plank, 1), 0, yy, 0, 0, 0, 0, g);
  for (const sx of [-0.68, 0.68]) B.mesh(new THREE.BoxGeometry(0.07, 1.85, 0.35), P.plank, sx, 0.92, 0, 0, 0, 0, g);
  const rnd = new Rand((x * 71 + z * 13) | 0);
  for (let i = 0; i < 7; i++) {
    const yy = [0.62, 1.17, 1.72][i % 3];
    B.mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 7), P.glass, rnd.float(-0.55, 0.55), yy, rnd.float(-0.08, 0.08), 0, 0, 0, g);
  }
  B.collider(x, y, z, 0.75, 1.9);
  return g;
}

export function makeBanner(B, x, y, z, rot = 0, mat = null) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  const m = B.mesh(new THREE.PlaneGeometry(0.9, 2.0, 3, 6), mat || P.clothRed, 0, -1.0, 0, 0, 0, 0, g);
  m.material = (mat || P.clothRed).clone();
  m.material.side = THREE.DoubleSide;
  B.mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), P.plank, 0, 0.0, 0, 0, 0, Math.PI / 2, g);
  return g;
}

export function makeSignpost(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), P.plank, 0, 1.2, 0, 0, 0, 0, g);
  for (let i = 0; i < 2; i++) {
    B.mesh(new THREE.BoxGeometry(0.9, 0.22, 0.05), tile(P.plank, 1), 0.45, 1.9 - i * 0.34, 0, 0, i * 1.9, 0, g);
  }
  B.collider(x, y, z, 0.2, 2.4, false);
  return g;
}

export function makeGravestone(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(0.06, rot, 0.04); B.group.add(g);
  B.mesh(new THREE.BoxGeometry(0.55, 0.9, 0.14), tile(P.rune, 1), 0, 0.45, 0, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 10, 1, false, 0, Math.PI), P.rune, 0, 0.9, 0, Math.PI / 2, 0, 0, g);
  B.collider(x, y, z, 0.3, 1.0, false);
  return g;
}

export function makeBrazier(B, x, y, z, lit = true) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); B.group.add(g);
  B.mesh(new THREE.CylinderGeometry(0.34, 0.10, 0.30, 10), P.iron, 0, 1.05, 0, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.95, 6), P.iron, 0, 0.5, 0, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10), P.iron, 0, 0.03, 0, 0, 0, 0, g);
  if (lit) {
    B.mesh(new THREE.SphereGeometry(0.2, 8, 6), P.emFire, 0, 1.2, 0, 0, 0, 0, g);
    B.light(x, y + 1.35, z, 0xff8a2a, 4.5, 15, { flicker: 1, kind: 'fire' });
  }
  B.collider(x, y, z, 0.35, 1.2, false);
  g.userData.firePos = new THREE.Vector3(x, y + 1.2, z);
  g.userData.fire = lit;
  return g;
}

export function makeSarcophagus(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.BoxGeometry(1.1, 1.4, 2.4), tile(P.rune, 1.2), 0, 0.7, 0, 0, 0, 0, g);
  const lid = B.mesh(new THREE.BoxGeometry(1.2, 0.2, 2.5), tile(P.rune, 1.2), 0, 1.5, 0, 0, 0, 0, g);
  B.collider(x, y, z, 1.0, 1.6);
  g.userData.lid = lid;
  return g;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * A Nord longhouse: stone footing, timber walls, steep shingled roof, and a
 * real interior you can walk into.
 */
export function makeHouse(B, x, y, z, rot, opts = {}) {
  const P = B.P;
  const w = opts.width ?? 6.5, d = opts.depth ?? 9.0, wallH = opts.height ?? 3.2;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot;
  B.group.add(g);
  const wallMat = tile(P.plank, 3);
  const stoneMat = tile(P.stone, 3);
  const roofMat = tile(opts.thatch ? P.thatch : P.shingle, 3);
  const T = 0.22;

  // footing
  B.mesh(new THREE.BoxGeometry(w + 0.5, 0.6, d + 0.5), stoneMat, 0, 0.3, 0, 0, 0, 0, g);
  // floor
  B.mesh(new THREE.BoxGeometry(w, 0.1, d), tile(P.plank, 4), 0, 0.62, 0, 0, 0, 0, g);

  // walls with a door gap on the +Z face
  const doorW = 1.5;
  const seg = (w - doorW) / 2;
  B.mesh(new THREE.BoxGeometry(seg, wallH, T), wallMat, -(doorW / 2 + seg / 2), 0.6 + wallH / 2, d / 2, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(seg, wallH, T), wallMat, (doorW / 2 + seg / 2), 0.6 + wallH / 2, d / 2, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(doorW, wallH - 2.2, T), wallMat, 0, 0.6 + 2.2 + (wallH - 2.2) / 2, d / 2, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(w, wallH, T), wallMat, 0, 0.6 + wallH / 2, -d / 2, 0, 0, 0, g);
  for (const sx of [-1, 1]) {
    B.mesh(new THREE.BoxGeometry(T, wallH, d), wallMat, sx * w / 2, 0.6 + wallH / 2, 0, 0, 0, 0, g);
  }
  // corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.mesh(new THREE.BoxGeometry(0.26, wallH + 0.2, 0.26), P.plank, sx * w / 2, 0.6 + wallH / 2, sz * d / 2, 0, 0, 0, g);
  }
  // windows (frames + glowing panes at night handled by the light list)
  for (const sz of [-2.2, 1.6]) for (const sx of [-1, 1]) {
    B.mesh(new THREE.BoxGeometry(0.06, 0.85, 0.95), P.glass, sx * (w / 2 + 0.01), 2.2, sz, 0, 0, 0, g);
    B.mesh(new THREE.BoxGeometry(0.09, 0.95, 0.08), P.plank, sx * (w / 2 + 0.02), 2.2, sz, 0, 0, 0, g);
  }

  // roof: two slabs meeting at a ridge
  const rise = opts.roofRise ?? 2.6;
  const slope = Math.atan2(rise, w / 2);
  const slabLen = Math.hypot(rise, w / 2) + 0.35;
  for (const sx of [-1, 1]) {
    B.mesh(new THREE.BoxGeometry(slabLen, 0.16, d + 1.0), roofMat,
      sx * (w / 4 + 0.1), 0.6 + wallH + rise / 2, 0, 0, 0, sx * slope, g);
  }
  // gable ends
  for (const sz of [-1, 1]) {
    const tri = new THREE.BufferGeometry();
    const hw = w / 2;
    tri.setAttribute('position', new THREE.Float32BufferAttribute([
      -hw, 0, 0, hw, 0, 0, 0, rise, 0,
    ], 3));
    tri.setIndex([0, 1, 2]);
    tri.computeVertexNormals();
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    B.mesh(tri, wallMat, 0, 0.6 + wallH, sz * d / 2, 0, sz > 0 ? 0 : Math.PI, 0, g);
  }
  // ridge beam
  B.mesh(new THREE.BoxGeometry(0.2, 0.2, d + 1.1), P.plank, 0, 0.6 + wallH + rise, 0, 0, 0, 0, g);

  // chimney
  if (opts.chimney !== false) {
    B.mesh(new THREE.BoxGeometry(0.9, wallH + rise + 0.8, 0.9), stoneMat, w / 2 - 1.0, 0.6 + (wallH + rise + 0.8) / 2, -d / 2 + 1.4, 0, 0, 0, g);
  }

  // door
  const doorPivot = new THREE.Group();
  doorPivot.userData.dynamic = true;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  doorPivot.position.set(-doorW / 2, 0.6, d / 2);
  g.add(doorPivot);
  const door = B.mesh(new THREE.BoxGeometry(doorW, 2.2, 0.10), tile(P.plank, 1.2), doorW / 2, 1.1, 0, 0, 0, 0, doorPivot);
  B.mesh(new THREE.BoxGeometry(0.12, 0.12, 0.14), P.iron, doorW - 0.25, 1.1, 0.08, 0, 0, 0, doorPivot);

  // world-space door position
  const dwx = x + (0 * cs + (d / 2 + 0.4) * sn);
  const dwz = z + (0 * -sn + (d / 2 + 0.4) * cs);
  B.interact('door', dwx, y + 1.2, dwz, {
    label: opts.name ? `${opts.name}` : 'Door', radius: 2.4, pivot: doorPivot, open: false,
    interior: opts.interior !== false,
  });

  // walls as colliders (four slabs)
  const push = (lx, lz, r, h) => {
    B.collider(x + lx * cs + lz * sn, y, z + -lx * sn + lz * cs, r, h);
  };
  push(0, -d / 2, w / 2 + 0.2, wallH + 0.6);
  push(-w / 2, 0, 0.3, wallH + 0.6);
  push(w / 2, 0, 0.3, wallH + 0.6);
  // front wall in two pieces so the doorway stays open
  push(-(doorW / 2 + seg / 2), d / 2, seg / 2 + 0.1, wallH + 0.6);
  push((doorW / 2 + seg / 2), d / 2, seg / 2 + 0.1, wallH + 0.6);

  // interior dressing
  if (opts.interior !== false) {
    const inv = (lx, lz) => [x + lx * cs + lz * sn, z + -lx * sn + lz * cs];
    const [tx, tz] = inv(0, -1.2);
    makeTable(B, tx, y + 0.65, tz, rot);
    const [cx1, cz1] = inv(-1.1, -1.2); makeChair(B, cx1, y + 0.65, cz1, rot + Math.PI / 2);
    const [cx2, cz2] = inv(1.1, -1.2); makeChair(B, cx2, y + 0.65, cz2, rot - Math.PI / 2);
    const [bx, bz] = inv(-w / 2 + 1.0, 2.6); makeBed(B, bx, y + 0.65, bz, rot + Math.PI / 2);
    const [sx2, sz2] = inv(w / 2 - 0.6, 2.2); makeShelf(B, sx2, y + 0.65, sz2, rot - Math.PI / 2);
    const [fx, fz] = inv(w / 2 - 1.0, -d / 2 + 1.4);
    B.light(fx, y + 1.6, fz, 0xffa54a, 3.0, 9, { flicker: 0.6, kind: 'fire', interior: true });
    makeBrazier(B, fx, y + 0.65, fz, true);
    const [chx, chz] = inv(-w / 2 + 1.2, -d / 2 + 1.2);
    makeChest(B, chx, y + 0.65, chz, rot, 'chest', 0);
  }

  g.userData.doorPivot = doorPivot;
  return g;
}

export function makeWatchtower(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  const stoneMat = tile(P.stone, 4);
  const R = 3.2;
  // broken cylindrical tower
  const wall = new THREE.CylinderGeometry(R, R + 0.5, 9.5, 16, 1, true);
  const m = B.mesh(wall, stoneMat, 0, 4.75, 0, 0, 0, 0, g);
  m.material = m.material.clone();     // material clones share textures, which is safe
  m.material.side = THREE.DoubleSide;
  // collapsed upper lip
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU;
    const h = 0.4 + Math.abs(Math.sin(i * 1.7)) * 1.5;
    B.mesh(new THREE.BoxGeometry(1.2, h, 0.6), stoneMat, Math.cos(a) * R, 9.5 + h / 2, Math.sin(a) * R, 0, -a, 0, g);
  }
  B.mesh(new THREE.CylinderGeometry(R - 0.3, R - 0.3, 0.3, 16), tile(P.plank, 3), 0, 5.4, 0, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.6, 0.8, 16), stoneMat, 0, 0.4, 0, 0, 0, 0, g);
  // rubble
  const rnd = new Rand((x * 3 + z * 7) | 0);
  for (let i = 0; i < 14; i++) {
    const a = rnd.float(0, TAU), rr = rnd.float(R + 0.5, R + 5);
    B.mesh(new THREE.BoxGeometry(rnd.float(0.4, 1.1), rnd.float(0.3, 0.7), rnd.float(0.4, 1.0)), stoneMat,
      Math.cos(a) * rr, rnd.float(-0.1, 0.3), Math.sin(a) * rr, rnd.float(0, 0.4), rnd.float(0, TAU), rnd.float(0, 0.4), g);
  }
  B.collider(x, y, z, R + 0.3, 10);
  makeBrazier(B, x + 1.4, y, z + 1.4, true);
  return g;
}

export function makeStandingStones(B, x, y, z, hf) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(0, 0, 0); B.group.add(g);
  const R = 11;
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU;
    const px = x + Math.cos(a) * R, pz = z + Math.sin(a) * R;
    const py = hf ? hf.heightAt(px, pz) : y;
    const h = 3.4 + Math.sin(i * 2.3) * 1.1;
    const stone = B.mesh(new THREE.BoxGeometry(1.3, h, 0.75), tile(P.rune, 1.4),
      px, py + h / 2 - 0.3, pz, (Math.sin(i * 5) * 0.06), -a, (Math.cos(i * 3) * 0.06), g);
    B.collider(px, py, pz, 0.8, h);
  }
  const cy = hf ? hf.heightAt(x, z) : y;
  B.mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.4, 20), tile(P.stone, 3), x, cy + 0.2, z, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.0, 12), tile(P.rune, 1), x, cy + 0.9, z, 0, 0, 0, g);
  B.interact('wardstone', x, cy + 1.6, z, { label: 'The Wardstone', radius: 3.0 });
  B.light(x, cy + 1.8, z, 0x63e0ff, 2.2, 14, { flicker: 0.25, kind: 'magic' });
  return g;
}

export function makeShrine(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  B.mesh(new THREE.BoxGeometry(2.6, 0.4, 2.6), tile(P.stone, 2), 0, 0.2, 0, 0, 0, 0, g);
  for (const sx of [-1, 1]) B.mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.0, 8), tile(P.stone, 2), sx * 1.0, 1.9, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(2.8, 0.3, 1.0), tile(P.stone, 2), 0, 3.5, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(0.9, 1.5, 0.4), tile(P.rune, 1), 0, 1.2, -0.5, 0, 0, 0, g);
  B.mesh(new THREE.SphereGeometry(0.22, 12, 8), P.emRune, 0, 2.1, -0.3, 0, 0, 0, g);
  B.light(x, y + 2.1, z, 0x63e0ff, 2.6, 12, { flicker: 0.2, kind: 'magic' });
  B.collider(x, y, z, 1.4, 3.6);
  B.interact('shrine', x, y + 1.4, z, { label: 'Shrine of the Wanderer', radius: 2.6 });
  return g;
}

export function makeShipwreck(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(0.18, rot, 0.42); B.group.add(g);
  const hull = tile(P.plank, 4);
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const a = -0.9 + t * 1.8;
    B.mesh(new THREE.BoxGeometry(0.3, 3.6 - Math.abs(a) * 1.2, 12 - Math.abs(a) * 3), hull,
      Math.sin(a) * 2.6, 1.6 + Math.cos(a) * 0.5, 0, 0, 0, -a * 0.8, g);
  }
  B.mesh(new THREE.CylinderGeometry(0.22, 0.28, 9, 8), P.plank, 0, 4.5, -1.0, 0.25, 0, 0.15, g);
  const sail = B.mesh(new THREE.PlaneGeometry(4.5, 5.0, 4, 5), P.clothCream, 0.2, 5.0, -1.0, 0, 0.2, 0.1, g);
  sail.material = P.clothCream.clone(); sail.material.side = THREE.DoubleSide;
  B.collider(x, y, z, 3.5, 4);
  makeChest(B, x + 3.0, y, z + 1.5, rot, 'chest', 0);
  makeBarrel(B, x - 2.5, y, z + 2.5, 0.4);
  makeBarrel(B, x - 3.4, y, z + 1.4, 1.1);
  return g;
}

export function makeMineEntrance(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  for (const sx of [-1.4, 1.4]) B.mesh(new THREE.BoxGeometry(0.4, 3.0, 0.4), tile(P.plank, 2), sx, 1.5, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(3.6, 0.45, 0.5), tile(P.plank, 2), 0, 3.1, 0, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(3.0, 3.0, 0.4), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 1 }), 0, 1.5, -0.5, 0, 0, 0, g);
  makeTorch(B, x - 2.0, y, z + 0.4, 2.0);
  B.collider(x - 1.7, y, z, 0.4, 3);
  B.collider(x + 1.7, y, z, 0.4, 3);
  B.interact('dungeon', x, y + 1.2, z, { label: 'Ashenvein Mine', radius: 2.6, dungeon: 'mine' });
  return g;
}

export function makeBarrowEntrance(B, x, y, z, rot = 0) {
  const P = B.P;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; B.group.add(g);
  const stone = tile(P.rune, 2);
  // stepped mound with a carved arch
  B.mesh(new THREE.CylinderGeometry(6.5, 8.0, 1.4, 12), tile(P.stone, 4), 0, 0.7, 0, 0, 0, 0, g);
  B.mesh(new THREE.CylinderGeometry(4.6, 5.6, 1.3, 12), tile(P.stone, 4), 0, 1.9, 0, 0, 0, 0, g);
  for (const sx of [-1.6, 1.6]) B.mesh(new THREE.BoxGeometry(0.9, 4.0, 0.9), stone, sx, 2.0, 4.4, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(4.6, 0.9, 1.2), stone, 0, 4.2, 4.4, 0, 0, 0, g);
  B.mesh(new THREE.BoxGeometry(2.4, 3.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x04060a, roughness: 1 }), 0, 1.7, 4.0, 0, 0, 0, g);
  for (let i = 0; i < 5; i++) {
    B.mesh(new THREE.BoxGeometry(3.2, 0.2, 0.6), tile(P.stone, 2), 0, 0.2 + i * 0.22, 5.2 + i * 0.55, 0, 0, 0, g);
  }
  makeBrazier(B, x - 2.6, y, z + 4.4, true);
  makeBrazier(B, x + 2.6, y, z + 4.4, true);
  B.collider(x, y, z, 5.0, 3.2);
  B.interact('dungeon', x, y + 1.6, z + 4.0, { label: 'Hollowmere Barrow', radius: 3.0, dungeon: 'barrow' });
  return g;
}

// ---------------------------------------------------------------------------
// Settlement assembly
// ---------------------------------------------------------------------------

export function buildHearthwatch(B, hf, loc) {
  const P = B.P;
  const rnd = new Rand(3141);
  const cx = loc.x, cz = loc.z;
  const baseY = hf.heightAt(cx, cz);

  const houses = [
    { r: 26, a: 0.3, name: 'Hearthwatch Longhouse', w: 8, d: 12, owner: 'jarl' },
    { r: 30, a: 1.5, name: 'Sigrid\'s House', w: 6.5, d: 9 },
    { r: 32, a: 2.6, name: 'Bjorn\'s House', w: 6, d: 8.5 },
    { r: 28, a: 3.7, name: 'The Cracked Tankard', w: 7.5, d: 10, tavern: true },
    { r: 34, a: 4.8, name: 'Astrid\'s House', w: 6, d: 8 },
    { r: 30, a: 5.7, name: 'Smithy', w: 6, d: 7.5, smith: true },
  ];
  const buildings = [];
  for (const h of houses) {
    const px = cx + Math.cos(h.a) * h.r;
    const pz = cz + Math.sin(h.a) * h.r;
    const py = hf.heightAt(px, pz);
    const rot = Math.atan2(cx - px, cz - pz);
    const g = makeHouse(B, px, py, pz, rot, {
      name: h.name, width: h.w, depth: h.d, thatch: rnd.bool(0.4),
    });
    buildings.push({ ...h, x: px, y: py, z: pz, rot, group: g });
  }

  // central well and market
  makeWell(B, cx, baseY, cz);
  makeCart(B, cx + 6, hf.heightAt(cx + 6, cz - 3), cz - 3, 1.1);
  for (let i = 0; i < 6; i++) {
    const a = rnd.float(0, TAU), r = rnd.float(6, 16);
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
    if (rnd.bool(0.5)) makeBarrel(B, px, hf.heightAt(px, pz), pz, rnd.float(0, TAU));
    else makeCrate(B, px, hf.heightAt(px, pz), pz, rnd.float(0, TAU), rnd.float(0.8, 1.2));
  }

  // smithy yard
  const smith = buildings.find(b => b.smith);
  if (smith) {
    const ox = smith.x + Math.cos(smith.a) * -6, oz = smith.z + Math.sin(smith.a) * -6;
    makeForge(B, ox, hf.heightAt(ox, oz), oz, smith.rot);
    makeAnvil(B, ox + 2.2, hf.heightAt(ox + 2.2, oz + 1), oz + 1, smith.rot + 0.6);
    B.spawns.push({ kind: 'npc', id: 'bjorn', x: ox + 1.4, z: oz + 1.6 });
  }

  // torches along the paths
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + 0.2;
    const px = cx + Math.cos(a) * 18, pz = cz + Math.sin(a) * 18;
    makeTorch(B, px, hf.heightAt(px, pz), pz, 2.4);
  }

  // fences around a paddock
  const fx = cx - 30, fz = cz + 18;
  makeFenceRun(B, fx, 0, fz, fx + 16, 0, fz, hf);
  makeFenceRun(B, fx + 16, 0, fz, fx + 16, 0, fz + 12, hf);
  makeFenceRun(B, fx + 16, 0, fz + 12, fx, 0, fz + 12, hf);
  makeFenceRun(B, fx, 0, fz + 12, fx, 0, fz, hf);

  makeSignpost(B, cx + 2, baseY, cz + 20, 0.5);

  // NPC spawns
  B.spawns.push({ kind: 'npc', id: 'sigrid', x: cx - 4, z: cz + 5 });
  B.spawns.push({ kind: 'npc', id: 'astrid', x: cx + 5, z: cz + 7 });
  B.spawns.push({ kind: 'npc', id: 'jarl', x: cx + 1, z: cz - 8 });
  B.spawns.push({ kind: 'npc', id: 'guard1', x: cx + 12, z: cz + 12 });
  B.spawns.push({ kind: 'npc', id: 'guard2', x: cx - 12, z: cz - 10 });
  B.spawns.push({ kind: 'npc', id: 'torvald', x: cx - 2, z: cz + 12 });

  return buildings;
}

export function buildBanditCamp(B, hf, loc) {
  const P = B.P;
  const rnd = new Rand(555);
  const cx = loc.x, cz = loc.z;
  makeCampfire(B, cx, hf.heightAt(cx, cz), cz, true);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + 0.4;
    const px = cx + Math.cos(a) * 5.5, pz = cz + Math.sin(a) * 5.5;
    makeTent(B, px, hf.heightAt(px, pz), pz, -a + Math.PI);
  }
  makeChest(B, cx + 7, hf.heightAt(cx + 7, cz + 2), cz + 2, 0.7, 'chest', 1);
  for (let i = 0; i < 5; i++) {
    const a = rnd.float(0, TAU), r = rnd.float(3, 9);
    const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
    if (rnd.bool(0.6)) makeBarrel(B, px, hf.heightAt(px, pz), pz, rnd.float(0, TAU));
    else makeCrate(B, px, hf.heightAt(px, pz), pz, rnd.float(0, TAU));
  }
  // palisade
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * TAU;
    if (Math.abs(a - 0.9) < 0.35) continue;         // gate
    const px = cx + Math.cos(a) * 12, pz = cz + Math.sin(a) * 12;
    const py = hf.heightAt(px, pz);
    B.mesh(new THREE.CylinderGeometry(0.16, 0.20, 2.8, 6), P.plank, px, py + 1.3, pz, rnd.float(-0.05, 0.05), 0, rnd.float(-0.05, 0.05));
    B.collider(px, py, pz, 0.25, 2.8, false);
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd.float(0, TAU), r = rnd.float(2.5, 8);
    B.spawns.push({ kind: 'enemy', id: 'bandit', x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  return null;
}

export function buildLodge(B, hf, loc) {
  const cx = loc.x, cz = loc.z;
  const py = hf.heightAt(cx, cz);
  makeHouse(B, cx, py, cz, 0.7, { name: 'Elk Hollow Lodge', width: 6, depth: 8, thatch: true });
  makeCampfire(B, cx + 5, hf.heightAt(cx + 5, cz + 4), cz + 4, true);
  makeCart(B, cx - 6, hf.heightAt(cx - 6, cz + 2), cz + 2, 2.1);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    const px = cx + Math.cos(a) * 8, pz = cz + Math.sin(a) * 8;
    B.mesh(new THREE.BoxGeometry(1.2, 1.4, 0.3), B.P.plank, px, hf.heightAt(px, pz) + 0.7, pz, 0, a, 0);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dungeon interior
// ---------------------------------------------------------------------------

/**
 * Generates a barrow interior: a chain of chambers joined by corridors, lit by
 * braziers, populated with urns, sarcophagi and the restless dead.
 */
export function buildDungeon(palette, seed = 1, kind = 'barrow') {
  const B = new Builder(palette);
  const P = palette;
  const rnd = new Rand(seed);
  const wall = tile(kind === 'mine' ? P.rock : P.rune, 3);
  const floorMat = tile(kind === 'mine' ? P.dirtStone || P.stone : P.stone, 4);
  const H = 4.4;

  const rooms = [];
  let cx = 0, cz = 0, dir = 0;
  const roomCount = kind === 'mine' ? 5 : 7;
  for (let i = 0; i < roomCount; i++) {
    const w = rnd.float(9, 16), d = rnd.float(9, 16);
    rooms.push({ x: cx, z: cz, w, d, index: i });
    const step = Math.max(w, d) * 0.5 + rnd.float(10, 16);
    dir += rnd.float(-0.9, 0.9);
    cx += Math.sin(dir) * step;
    cz += Math.cos(dir) * step;
  }

  const addRoom = (r) => {
    // floor + ceiling
    B.mesh(new THREE.BoxGeometry(r.w, 0.4, r.d), floorMat, r.x, -0.2, r.z);
    B.mesh(new THREE.BoxGeometry(r.w, 0.4, r.d), wall, r.x, H + 0.2, r.z);
    // walls with gaps for the corridors handled by simply overlapping corridors
    B.mesh(new THREE.BoxGeometry(r.w, H, 0.5), wall, r.x, H / 2, r.z - r.d / 2);
    B.mesh(new THREE.BoxGeometry(r.w, H, 0.5), wall, r.x, H / 2, r.z + r.d / 2);
    B.mesh(new THREE.BoxGeometry(0.5, H, r.d), wall, r.x - r.w / 2, H / 2, r.z);
    B.mesh(new THREE.BoxGeometry(0.5, H, r.d), wall, r.x + r.w / 2, H / 2, r.z);
    B.collider(r.x, 0, r.z - r.d / 2, r.w / 2, H);
    B.collider(r.x, 0, r.z + r.d / 2, r.w / 2, H);
    B.collider(r.x - r.w / 2, 0, r.z, 0.4, H);
    B.collider(r.x + r.w / 2, 0, r.z, 0.4, H);
    // pillars
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = r.x + sx * r.w * 0.28, pz = r.z + sz * r.d * 0.28;
      B.mesh(new THREE.CylinderGeometry(0.42, 0.5, H, 8), wall, px, H / 2, pz);
      B.collider(px, 0, pz, 0.5, H, false);
    }
    // braziers
    const bpos = [[-r.w * 0.34, -r.d * 0.34], [r.w * 0.34, r.d * 0.34]];
    for (const [ox, oz] of bpos) makeBrazier(B, r.x + ox, 0, r.z + oz, true);
  };

  const addCorridor = (a, b) => {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) + 2;
    const rot = Math.atan2(dx, dz);
    const w = 3.4;
    const g = new THREE.Group();
    g.position.set(mx, 0, mz); g.rotation.y = rot; B.group.add(g);
    B.mesh(new THREE.BoxGeometry(w, 0.4, len), floorMat, 0, -0.2, 0, 0, 0, 0, g);
    B.mesh(new THREE.BoxGeometry(w, 0.4, len), wall, 0, H + 0.2, 0, 0, 0, 0, g);
    for (const sx of [-1, 1]) {
      B.mesh(new THREE.BoxGeometry(0.4, H, len), wall, sx * w / 2, H / 2, 0, 0, 0, 0, g);
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const n = Math.max(2, Math.round(len / 6));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n;
        B.collider(mx + (sx * w / 2) * cs + t * sn, 0, mz + (-sx * w / 2) * sn + t * cs, 0.45, H);
      }
    }
    // a torch halfway along
    const cs = Math.cos(rot), sn = Math.sin(rot);
    B.light(mx, 2.6, mz, 0xff9a44, 2.2, 10, { flicker: 1, kind: 'fire', interior: true });
    B.mesh(new THREE.SphereGeometry(0.09, 6, 5), P.emFire, mx, 2.6, mz);
  };

  rooms.forEach(addRoom);
  for (let i = 0; i < rooms.length - 1; i++) addCorridor(rooms[i], rooms[i + 1]);

  // dressing + population
  rooms.forEach((r, i) => {
    const last = i === rooms.length - 1;
    if (i === 0) {
      B.interact('exit', r.x, 1.2, r.z - r.d / 2 + 1.4, { label: 'Exit', radius: 2.6 });
      B.mesh(new THREE.BoxGeometry(2.4, 3.2, 0.3), P.plank, r.x, 1.6, r.z - r.d / 2 + 0.3);
    }
    for (let k = 0; k < rnd.int(2, 5); k++) {
      const px = r.x + rnd.float(-r.w * 0.35, r.w * 0.35);
      const pz = r.z + rnd.float(-r.d * 0.35, r.d * 0.35);
      const roll = rnd.next();
      if (roll < 0.35) {
        const urn = new THREE.Group();
        urn.position.set(px, 0, pz); B.group.add(urn);
        B.mesh(new THREE.CylinderGeometry(0.22, 0.30, 0.6, 10), P.rune, 0, 0.3, 0, 0, 0, 0, urn);
        B.mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.12, 10), P.rune, 0, 0.65, 0, 0, 0, 0, urn);
        B.interact('container', px, 0.6, pz, { loot: 'urn', label: 'Burial Urn', radius: 1.7 });
        B.collider(px, 0, pz, 0.3, 0.7, false);
      } else if (roll < 0.6) makeBarrel(B, px, 0, pz, rnd.float(0, TAU));
      else if (roll < 0.75) makeCrate(B, px, 0, pz, rnd.float(0, TAU));
      else {
        // bones
        for (let n = 0; n < 4; n++) {
          B.mesh(new THREE.CylinderGeometry(0.035, 0.045, rnd.float(0.2, 0.5), 5), P.bone,
            px + rnd.float(-0.5, 0.5), 0.05, pz + rnd.float(-0.5, 0.5), Math.PI / 2, rnd.float(0, TAU), 0);
        }
      }
    }
    if (i > 0) {
      const n = last ? 3 : rnd.int(1, 3);
      for (let k = 0; k < n; k++) {
        B.spawns.push({
          kind: 'enemy', id: last && k === 0 ? 'draugrLord' : 'draugr',
          x: r.x + rnd.float(-r.w * 0.3, r.w * 0.3), z: r.z + rnd.float(-r.d * 0.3, r.d * 0.3),
        });
      }
      if (rnd.bool(0.45)) {
        const sx = r.x + rnd.float(-r.w * 0.3, r.w * 0.3), sz = r.z + rnd.float(-r.d * 0.3, r.d * 0.3);
        makeSarcophagus(B, sx, 0, sz, rnd.float(0, TAU));
      }
    }
    if (last) {
      makeChest(B, r.x, 0, r.z + r.d * 0.3, Math.PI, 'chest', 0);
      B.interact('questItem', r.x, 1.1, r.z - r.d * 0.28, {
        label: 'Wardstone Shard', radius: 2.2, item: 'wardstoneShard',
      });
      B.mesh(new THREE.BoxGeometry(1.0, 1.6, 1.0), tile(P.rune, 1), r.x, 0.8, r.z - r.d * 0.28);
      B.mesh(new THREE.IcosahedronGeometry(0.26, 1), P.emRune, r.x, 1.85, r.z - r.d * 0.28);
      B.light(r.x, 1.9, r.z - r.d * 0.28, 0x63e0ff, 3.0, 12, { kind: 'magic', interior: true });
    }
  });

  return { builder: B, rooms, entry: { x: rooms[0].x, y: 0, z: rooms[0].z + 1 } };
}


// ---------------------------------------------------------------------------
// Static batching
// ---------------------------------------------------------------------------

/**
 * Bakes every static mesh in a group into one merged mesh per material.
 * A village is ~600 primitives; unmerged that is 600 draw calls before a single
 * tree is drawn. Anything that has to move (doors, chest lids) is marked
 * `userData.dynamic` and left alone.
 */
export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const keep = [];
  const dynamicParents = new Set();

  // Anything under an animated pivot must stay where it is.
  group.traverse(o => {
    if (o.userData && o.userData.dynamic) dynamicParents.add(o);
  });
  const isDynamic = (o) => {
    let p = o;
    while (p && p !== group) { if (dynamicParents.has(p)) return true; p = p.parent; }
    return false;
  };

  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });

  for (const m of meshes) {
    if (isDynamic(m) || !m.geometry || !m.geometry.attributes.position) { keep.push(m); continue; }
    const g = m.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    let arr = buckets.get(m.material);
    if (!arr) { arr = []; buckets.set(m.material, arr); }
    arr.push(m);
  }

  const merged = [];
  for (const [mat, list] of buckets) {
    let vCount = 0, iCount = 0;
    for (const m of list) {
      const g = m.geometry;
      vCount += g.attributes.position.count;
      iCount += g.index ? g.index.count : g.attributes.position.count;
    }
    if (vCount === 0) continue;
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    let vo = 0, io = 0;
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const m of list) {
      const g = m.geometry;
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const t = g.attributes.uv;
      nm.getNormalMatrix(m.matrixWorld);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        if (n) { v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); }
        else v.set(0, 1, 0);
        nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
        if (t) { uv[(vo + i) * 2] = t.getX(i); uv[(vo + i) * 2 + 1] = t.getY(i); }
      }
      if (g.index) {
        for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
        io += g.index.count;
      } else {
        for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
        io += p.count;
      }
      vo += p.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    merged.push(mesh);
  }

  // Rebuild the group: merged batches, plus the handful of animated subtrees
  // re-parented under a holder that carries their old world transform. Moving
  // the *ancestor* instead would drag every already-merged sibling along with
  // it and draw the whole village twice.
  const out = new THREE.Group();
  out.name = group.name + ':merged';
  for (const m of merged) out.add(m);

  const topDynamic = [];
  for (const d of dynamicParents) {
    let anc = d.parent, nested = false;
    while (anc && anc !== group) { if (dynamicParents.has(anc)) { nested = true; break; } anc = anc.parent; }
    if (!nested) topDynamic.push(d);
  }
  for (const d of topDynamic) {
    const parentWorld = d.parent ? d.parent.matrixWorld.clone() : new THREE.Matrix4();
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(parentWorld);
    out.add(holder);
    holder.add(d);           // d keeps its own local transform, so animating it still works
    holder.updateMatrixWorld(true);
  }
  // Anything left out of both (e.g. Lines) keeps its world transform verbatim.
  for (const m of keep) {
    if (isDynamic(m)) continue;
    const world = m.matrixWorld.clone();
    out.add(m);
    world.decompose(m.position, m.quaternion, m.scale);
  }

  return { group: out, batches: merged.length, source: meshes.length };
}
