// Loot: what the zone leaves lying about. Containers (tins, crates, cabinets, racks, safes, packs) and loose
// items at world.lootSpots, plus the piles that entities leave where they fold and the caches the Explorer sets
// down. Everything is procedural: merged low-poly parts with baked vertex-colour grime, one mesh per body and
// one per lid so the lid can swing.
//
// What is in a container comes from data/loot.js: the location's tier (POI depth + Tide + clearance) picks
// categories, and the categories are resolved against the catalogue by `kind` and `rarity` — no id lists here,
// so anything added to data/ turns up in the zone by itself. A weapon out of the ground arrives fouled, worn
// and part loaded; it is a find, not an issue.
//
// Contract (ARCHITECTURE.md): ctx.loot.spawnPile(position, entries[, opts]), ctx.loot.dropItem(entry, position),
// ctx.loot.markers(), ctx.loot.objects, populate(), reset(), update(dt). Entries are
// [{ kind:'weapon'|'mag'|'gear'|'item', inst?, id, count }] — the same shape the UI's loot panel transfers.
// Also exports the small mesh kit (paint / place / merge / bodyMaterial / ledMaterial) that missions.js uses.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash3, mulberry32 } from '../core/rng.js';
import { def, categoryOf, WEAPONS, AMMO, MAGAZINES, ATTACHMENTS, ARMOR, ITEMS, attachmentsFor, defaultAmmo } from '../data/index.js';
import { CONTAINERS, CONTAINERS_BY_POI, CATEGORY_SOURCES, AMMO_ROLL, COUNT_ROLL, CHEAP, CHEAP_MULT, FOUND, LOCK, TIER, lootTier, pickWeight } from '../data/loot.js';
import { setProgression } from '../enemies/loadout.js';
import { makeWeapon, makeMag, makeGear, attach } from '../player/inventory.js';
import { clamp, lerp, easeOutCubic } from '../core/math.js';

// ---------------------------------------------------------------------------------------------
// mesh kit
// ---------------------------------------------------------------------------------------------
const _c = new THREE.Color();
const RUST = [0.46, 0.27, 0.15];

// Bake a vertex colour attribute: base tint with hashed jitter, dark grime patches, a soot gradient at the
// bottom and rust creeping in from the edges. seed separates parts so patches never line up.
export function paint(geo, base, opts = {}) {
  const jitter = opts.jitter ?? 0.07, grime = opts.grime ?? 0.35, rust = opts.rust ?? 0, bottom = opts.bottom ?? 0.25, seed = (opts.seed ?? 0) * 101;
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  geo.computeBoundingBox();
  const bb = geo.boundingBox, h = Math.max(1e-3, bb.max.y - bb.min.y);
  const scale = opts.scale ?? 40;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const q = hash3(Math.floor(x * scale) + seed, Math.floor(y * scale), Math.floor(z * scale) + seed);
    const p = hash3(Math.floor(x * scale * 0.35) + 7 + seed, Math.floor(y * scale * 0.35) + 3, Math.floor(z * scale * 0.35));
    let k = 1 + (q - 0.5) * jitter * 2;
    k *= 1 - grime * Math.max(0, p - 0.55) * 2.2;
    k *= 1 - bottom * (1 - clamp((y - bb.min.y) / h, 0, 1)) * 0.6;
    let r = base[0] * k, g = base[1] * k, b = base[2] * k;
    if (rust > 0) { const rw = Math.max(0, hash3(Math.floor(x * 18) + 5 + seed, Math.floor(y * 18), Math.floor(z * 18) + 9) - (1 - rust)) / rust; r += (RUST[0] - r) * rw * 0.85; g += (RUST[1] - g) * rw * 0.85; b += (RUST[2] - b) * rw * 0.85; }
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
// position / rotate / scale a part in place. r = [x,y,z] euler in radians
export function place(geo, x = 0, y = 0, z = 0, r = null, s = null) {
  if (s) geo.scale(s[0] ?? s, s[1] ?? s, s[2] ?? s);
  if (r) { if (r[0]) geo.rotateX(r[0]); if (r[1]) geo.rotateY(r[1]); if (r[2]) geo.rotateZ(r[2]); }
  geo.translate(x, y, z);
  return geo;
}
// merge painted parts into one geometry (all parts must be painted first)
export function merge(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}
// soft-bodied box: face centres pushed outward (a canvas bag, a stuffed sack)
export function puffBox(w, h, d, bulge = 0.015) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const p = g.attributes.position, hw = w / 2, hh = h / 2, hd = d / 2;
  // positions are float32, the half-extents are not: clamp the normalised offsets or an edge vertex lands a
  // hair outside [0,1] and pow(negative, 1.5) poisons the whole geometry with NaN
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.min(1, Math.abs(x) / hw), ny = Math.min(1, Math.abs(y) / hh), nz = Math.min(1, Math.abs(z) / hd);
    if (nx >= ny && nx >= nz) { const o = Math.max(ny, nz); p.setX(i, x + Math.sign(x) * bulge * Math.pow(1 - o, 1.5)); }
    else if (ny >= nz) { const o = Math.max(nx, nz); p.setY(i, y + Math.sign(y) * bulge * Math.pow(1 - o, 1.5)); }
    else { const o = Math.max(nx, ny); p.setZ(i, z + Math.sign(z) * bulge * Math.pow(1 - o, 1.5)); }
  }
  g.computeVertexNormals();
  return g;
}
export const bodyMaterial = (opts = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.86, metalness: 0.12 }, opts));
export const ledMaterial = (color, intensity = 2.6) => new THREE.MeshStandardMaterial({ color: 0x14100e, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.0 });

// ---------------------------------------------------------------------------------------------
// container and item geometry (shared, built lazily once)
// ---------------------------------------------------------------------------------------------
const GEO = {};
const shared = (g) => { g.userData.shared = true; return g; };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);
const OLIVE = [0.30, 0.34, 0.24], STEEL = [0.32, 0.33, 0.33], DARK = [0.24, 0.25, 0.26], STENCIL = [0.62, 0.60, 0.50];
const WOOD = [0.44, 0.34, 0.21], TAN = [0.56, 0.48, 0.34], LEATHER = [0.30, 0.22, 0.15], CARD = [0.50, 0.41, 0.29];
const GUNMETAL = [0.19, 0.20, 0.21], ASH = [0.15, 0.15, 0.16], BRASS = [0.55, 0.45, 0.25];

function ammoTinGeo() {
  const body = merge([
    paint(box(0.30, 0.15, 0.17), OLIVE, { rust: 0.28, seed: 1 }),
    place(paint(box(0.03, 0.045, 0.012), STEEL, { seed: 2 }), 0, 0.02, 0.09),                  // front latch
    place(paint(box(0.16, 0.04, 0.004), STENCIL, { jitter: 0.12, grime: 0.6, seed: 3 }), 0.03, 0.01, 0.087), // stencil strip
    place(paint(box(0.302, 0.012, 0.172), STEEL, { seed: 4 }), 0, -0.07, 0),                   // rolled base seam
  ]);
  body.translate(0, 0.075, 0);
  // lid: hinged along the back edge (z = -0.085). Geometry is authored with the hinge at the origin.
  const lid = merge([
    place(paint(box(0.31, 0.028, 0.18), OLIVE, { rust: 0.22, seed: 5 }), 0, 0.014, 0.09),
    place(paint(cyl(0.006, 0.006, 0.12, 6), STEEL, { seed: 6 }), 0, 0.04, 0.09, [0, 0, Math.PI / 2]),        // wire handle bar
    place(paint(cyl(0.006, 0.006, 0.02, 6), STEEL, { seed: 6 }), -0.06, 0.03, 0.09),
    place(paint(cyl(0.006, 0.006, 0.02, 6), STEEL, { seed: 6 }), 0.06, 0.03, 0.09),
    place(paint(cyl(0.008, 0.008, 0.30, 6), STEEL, { seed: 7 }), 0, 0, 0, [0, 0, Math.PI / 2]),             // hinge rod
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, 0.15, -0.085], open: -2.1, cast: false, cull: 110 };
}
function medBagGeo() {
  const body = merge([
    paint(puffBox(0.34, 0.20, 0.22, 0.016), TAN, { jitter: 0.06, grime: 0.5, bottom: 0.45, seed: 11, scale: 30 }),
    place(paint(box(0.03, 0.20, 0.006), LEATHER, { seed: 12 }), -0.09, 0, 0.114),            // front straps
    place(paint(box(0.03, 0.20, 0.006), LEATHER, { seed: 12 }), 0.09, 0, 0.114),
    place(paint(box(0.34, 0.03, 0.006), LEATHER, { seed: 13 }), 0, -0.07, 0.114),            // lower band
    place(paint(new THREE.TorusGeometry(0.11, 0.007, 5, 12, Math.PI), LEATHER, { seed: 14 }), 0.19, -0.09, 0.02, [Math.PI / 2, 0, 0]), // shoulder strap on the ground
  ]);
  body.translate(0, 0.10, 0);
  const lid = merge([
    place(paint(puffBox(0.35, 0.03, 0.15, 0.008), TAN, { jitter: 0.06, grime: 0.45, seed: 15, scale: 30 }), 0, 0.012, 0.075),
    place(paint(box(0.024, 0.014, 0.02), BRASS, { seed: 16 }), -0.09, 0.02, 0.135),          // buckles
    place(paint(box(0.024, 0.014, 0.02), BRASS, { seed: 16 }), 0.09, 0.02, 0.135),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, 0.205, -0.10], open: -1.7, cast: true, cull: 110 };
}
function footlockerGeo() {
  const green = [0.24, 0.29, 0.22];
  const parts = [paint(box(0.82, 0.36, 0.44), green, { rust: 0.3, seed: 21, scale: 24 })];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(place(paint(box(0.06, 0.37, 0.06), STEEL, { seed: 22 }), sx * 0.39, 0, sz * 0.20));  // corner caps
  for (const sx of [-1, 1]) {
    parts.push(place(paint(cyl(0.01, 0.01, 0.14, 6), STEEL, { seed: 23 }), sx * 0.425, 0.04, 0, [Math.PI / 2, 0, 0]));    // side handles
    parts.push(place(paint(box(0.02, 0.03, 0.02), STEEL, { seed: 23 }), sx * 0.415, 0.04, -0.07));
    parts.push(place(paint(box(0.02, 0.03, 0.02), STEEL, { seed: 23 }), sx * 0.415, 0.04, 0.07));
  }
  parts.push(place(paint(box(0.22, 0.07, 0.004), STENCIL, { jitter: 0.14, grime: 0.65, seed: 24 }), -0.12, 0.02, 0.222));
  const body = merge(parts); body.translate(0, 0.18, 0);
  const lid = merge([
    place(paint(box(0.84, 0.06, 0.46), green, { rust: 0.25, seed: 25, scale: 24 }), 0, 0.03, 0.23),
    place(paint(box(0.86, 0.015, 0.48), STEEL, { seed: 26 }), 0, 0.0, 0.23),                  // rim
    place(paint(box(0.05, 0.05, 0.02), STEEL, { seed: 27 }), 0, 0.02, 0.465),                 // hasp
    place(paint(cyl(0.009, 0.009, 0.7, 6), STEEL, { seed: 28 }), 0, 0, 0, [0, 0, Math.PI / 2]), // hinge rod
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, 0.36, -0.22], open: -1.9, cast: true, cull: 150 };
}
// pine crate: slat sides, rope beckets on the ends, a stencilled lot number
function crateGeo() {
  const W = 0.72, H = 0.34, D = 0.40;
  const parts = [paint(box(W, H, D), WOOD, { jitter: 0.10, grime: 0.45, rust: 0.06, seed: 61, scale: 22 })];
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) parts.push(place(paint(box(W + 0.01, 0.035, 0.012), WOOD, { jitter: 0.14, grime: 0.55, seed: 62, scale: 30 }), 0, sy * 0.11, sz * (D / 2 + 0.004)));  // battens
  for (const sx of [-1, 1]) {
    parts.push(place(paint(box(0.012, H, D * 0.9), WOOD, { jitter: 0.12, seed: 63, scale: 26 }), sx * (W / 2 + 0.004), 0, 0));                       // end boards
    parts.push(place(paint(new THREE.TorusGeometry(0.045, 0.008, 5, 10, Math.PI), LEATHER, { seed: 64 }), sx * (W / 2 + 0.012), 0.02, 0, [0, Math.PI / 2, Math.PI / 2]));  // rope becket
  }
  parts.push(place(paint(box(0.26, 0.06, 0.004), STENCIL, { jitter: 0.16, grime: 0.7, seed: 65 }), -0.1, 0.02, D / 2 + 0.008));
  const body = merge(parts); body.translate(0, H / 2, 0);
  const lid = merge([
    place(paint(box(W + 0.02, 0.045, D + 0.02), WOOD, { jitter: 0.10, grime: 0.4, seed: 66, scale: 22 }), 0, 0.022, D / 2 + 0.01),
    place(paint(box(0.05, 0.05, D + 0.02), WOOD, { jitter: 0.12, seed: 67, scale: 26 }), -W * 0.32, 0.05, D / 2 + 0.01),   // cleats
    place(paint(box(0.05, 0.05, D + 0.02), WOOD, { jitter: 0.12, seed: 67, scale: 26 }), W * 0.32, 0.05, D / 2 + 0.01),
    place(paint(cyl(0.008, 0.008, W * 0.9, 6), STEEL, { seed: 68 }), 0, 0, 0, [0, 0, Math.PI / 2]),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, H, -D / 2 - 0.01], open: -1.95, cast: true, cull: 150 };
}
// steel wall cabinet: a door on the left, hinged about Y
function cabinetGeo() {
  const W = 0.56, H = 1.10, D = 0.30, grey = [0.36, 0.38, 0.36];
  const parts = [paint(box(W, H, D), grey, { rust: 0.34, grime: 0.45, seed: 71, scale: 20 })];
  for (const y of [-0.28, 0.06, 0.36]) parts.push(place(paint(box(W - 0.03, 0.012, D - 0.03), DARK, { seed: 72 }), 0, y, 0.005));   // shelves seen through the gap
  parts.push(place(paint(box(0.10, 0.05, 0.004), STENCIL, { jitter: 0.15, grime: 0.7, seed: 73 }), 0, H / 2 - 0.10, -D / 2 - 0.003));
  parts.push(place(paint(box(W + 0.02, 0.02, D + 0.02), DARK, { seed: 74 }), 0, -H / 2 + 0.01, 0));                                  // plinth
  const body = merge(parts); body.translate(0, H / 2, 0);
  // door authored from the hinge at the origin, extending +x
  const lid = merge([
    place(paint(box(W, H - 0.03, 0.018), grey, { rust: 0.3, grime: 0.4, seed: 75, scale: 20 }), W / 2, 0, 0),
    place(paint(box(W - 0.10, 0.006, 0.004), DARK, { seed: 76 }), W / 2, 0.22, 0.011),                        // pressed rib
    place(paint(cyl(0.008, 0.008, 0.09, 6), STEEL, { seed: 77 }), W - 0.06, -0.02, 0.02, [Math.PI / 2, 0, 0]), // handle
    place(paint(box(0.02, 0.05, 0.014), STEEL, { seed: 78 }), W - 0.05, -0.06, 0.012),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [-W / 2, H / 2, D / 2 + 0.01], open: -2.0, axis: 'y', cast: true, cull: 150 };
}
// document safe: thick door on the right, a dial and a spoked handle
function safeGeo() {
  const S = 0.46, D = 0.40;
  const parts = [paint(box(S, S, D), DARK, { rust: 0.2, grime: 0.5, seed: 81, scale: 22 })];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(place(paint(box(0.03, 0.03, D), [0.30, 0.31, 0.31], { seed: 82 }), sx * (S / 2 - 0.02), sy * (S / 2 - 0.02), 0));
  parts.push(place(paint(box(S - 0.06, S - 0.06, 0.02), [0.17, 0.17, 0.18], { seed: 83 }), 0, 0, D / 2 - 0.01));   // recessed frame
  const body = merge(parts); body.translate(0, S / 2, 0);
  const lid = merge([
    place(paint(box(S - 0.08, S - 0.08, 0.05), [0.26, 0.27, 0.27], { rust: 0.18, seed: 84, scale: 22 }), -(S - 0.08) / 2, 0, 0),
    place(paint(cyl(0.05, 0.05, 0.03, 12), [0.34, 0.33, 0.30], { seed: 85 }), -(S - 0.08) / 2 - 0.04, 0.05, 0.03, [Math.PI / 2, 0, 0]),   // dial
    place(paint(cyl(0.012, 0.012, 0.10, 6), STEEL, { seed: 86 }), -(S - 0.08) / 2 - 0.04, -0.07, 0.035, [0, 0, Math.PI / 2]),             // handle bar
    place(paint(cyl(0.012, 0.012, 0.10, 6), STEEL, { seed: 86 }), -(S - 0.08) / 2 - 0.04, -0.07, 0.035, [Math.PI / 2, 0, 0]),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [S / 2 - 0.04, S / 2, D / 2], open: 2.1, axis: 'y', cast: true, cull: 120 };
}
// steel toolbox with a carrying handle. gun_case and tool_chest are this body at another scale
function toolboxGeo() {
  const W = 0.44, H = 0.20, D = 0.22, red = [0.38, 0.26, 0.20];
  const parts = [paint(box(W, H, D), red, { rust: 0.35, grime: 0.5, seed: 91, scale: 26 })];
  parts.push(place(paint(box(W + 0.01, 0.015, D + 0.01), DARK, { seed: 92 }), 0, -H / 2 + 0.01, 0));
  parts.push(place(paint(box(0.05, 0.04, 0.012), STEEL, { seed: 93 }), 0, 0.04, D / 2 + 0.004));            // catch
  const body = merge(parts); body.translate(0, H / 2, 0);
  const lid = merge([
    place(paint(box(W + 0.01, 0.035, D + 0.01), red, { rust: 0.3, seed: 94, scale: 26 }), 0, 0.017, D / 2 + 0.005),
    place(paint(cyl(0.007, 0.007, 0.16, 6), STEEL, { seed: 95 }), 0, 0.075, D / 2 + 0.005, [0, 0, Math.PI / 2]),   // handle
    place(paint(box(0.014, 0.05, 0.014), STEEL, { seed: 95 }), -0.08, 0.05, D / 2 + 0.005),
    place(paint(box(0.014, 0.05, 0.014), STEEL, { seed: 95 }), 0.08, 0.05, D / 2 + 0.005),
    place(paint(cyl(0.007, 0.007, W, 6), STEEL, { seed: 96 }), 0, 0, 0, [0, 0, Math.PI / 2]),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, H, -D / 2 - 0.005], open: -1.65, cast: true, cull: 120 };
}
// weapon rack: uprights, two cross bars, empty pegs. Nothing swings.
function rackGeo() {
  const W = 1.10, H = 1.20;
  const parts = [];
  for (const sx of [-1, 1]) parts.push(place(paint(box(0.06, H, 0.06), OLIVE, { rust: 0.4, grime: 0.5, seed: 101, scale: 22 }), sx * (W / 2), H / 2, 0));
  for (const y of [0.34, 0.94]) parts.push(place(paint(box(W + 0.06, 0.05, 0.05), OLIVE, { rust: 0.36, seed: 102, scale: 24 }), 0, y, 0));
  for (let i = -2; i <= 2; i++) {
    parts.push(place(paint(cyl(0.012, 0.012, 0.13, 6), STEEL, { seed: 103 }), i * 0.2, 0.94, 0.07, [Math.PI / 2, 0, 0]));
    parts.push(place(paint(box(0.10, 0.03, 0.10), OLIVE, { rust: 0.3, seed: 104, scale: 26 }), i * 0.2, 0.36, 0.05));
  }
  parts.push(place(paint(box(W + 0.10, 0.04, 0.34), OLIVE, { rust: 0.45, bottom: 0.5, seed: 105, scale: 20 }), 0, 0.02, 0.06));   // base tray
  const body = merge(parts);
  return { body: shared(body), lid: null, hinge: [0, 0, 0], open: 0, cast: true, cull: 150 };
}
// office desk with one drawer that drops open
function deskGeo() {
  const W = 0.94, H = 0.74, D = 0.58, top = [0.40, 0.31, 0.20];
  const parts = [place(paint(box(W, 0.04, D), top, { jitter: 0.10, grime: 0.5, seed: 111, scale: 24 }), 0, H - 0.02, 0)];
  parts.push(place(paint(box(0.30, H - 0.08, D - 0.06), [0.34, 0.27, 0.18], { jitter: 0.09, grime: 0.55, seed: 112, scale: 22 }), W / 2 - 0.17, (H - 0.08) / 2, 0));  // pedestal
  for (const sx of [-1, 1]) parts.push(place(paint(box(0.05, H - 0.06, 0.05), DARK, { rust: 0.3, seed: 113 }), sx * (W / 2 - 0.04), (H - 0.06) / 2, -D / 2 + 0.06));
  parts.push(place(paint(box(W - 0.36, 0.03, D - 0.16), [0.30, 0.24, 0.16], { seed: 114 }), -0.16, 0.16, 0));   // modesty shelf
  parts.push(place(paint(box(0.24, 0.16, 0.02), [0.20, 0.17, 0.13], { seed: 115 }), W / 2 - 0.17, H - 0.20, D / 2 - 0.03));   // drawer recess
  const body = merge(parts);
  const lid = merge([
    place(paint(box(0.26, 0.15, 0.02), top, { jitter: 0.08, seed: 116, scale: 26 }), 0, 0.075, 0),
    place(paint(cyl(0.008, 0.008, 0.10, 6), BRASS, { seed: 117 }), 0, 0.075, 0.02, [0, 0, Math.PI / 2]),
    place(paint(box(0.24, 0.12, 0.24), [0.22, 0.19, 0.14], { grime: 0.6, seed: 118 }), 0, 0.07, -0.13),   // the drawer box itself
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [W / 2 - 0.17, H - 0.28, D / 2 - 0.02], open: 1.35, cast: true, cull: 150 };
}
// cardboard carton, one flap
function cartonGeo() {
  const W = 0.38, H = 0.26, D = 0.30;
  const body = merge([
    paint(box(W, H, D), CARD, { jitter: 0.09, grime: 0.55, bottom: 0.5, seed: 121, scale: 30 }),
    place(paint(box(0.16, 0.05, 0.003), [0.34, 0.29, 0.22], { jitter: 0.2, grime: 0.7, seed: 122 }), -0.03, 0.03, D / 2 + 0.002),
    place(paint(box(W + 0.005, 0.02, 0.004), [0.42, 0.35, 0.26], { seed: 123 }), 0, -H / 2 + 0.02, D / 2 + 0.002),
  ]);
  body.translate(0, H / 2, 0);
  const lid = merge([
    place(paint(box(W, 0.008, D * 0.55), CARD, { jitter: 0.1, grime: 0.5, seed: 124, scale: 30 }), 0, 0.004, D * 0.275),
    place(paint(box(W, 0.008, D * 0.5), [0.46, 0.38, 0.27], { jitter: 0.1, seed: 125, scale: 30 }), 0, 0.004, D * 0.75),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, H, -D / 2], open: -2.3, cast: false, cull: 100 };
}
// an explorer's rucksack, set down and never picked up again
function packGeo() {
  const body = merge([
    paint(puffBox(0.38, 0.44, 0.26, 0.02), [0.31, 0.33, 0.26], { jitter: 0.07, grime: 0.55, bottom: 0.5, seed: 131, scale: 26 }),
    place(paint(puffBox(0.22, 0.16, 0.10, 0.01), [0.29, 0.31, 0.24], { grime: 0.6, seed: 132, scale: 30 }), 0, -0.08, 0.16),   // front pocket
    place(paint(box(0.035, 0.40, 0.008), LEATHER, { seed: 133 }), -0.12, 0.02, 0.135),
    place(paint(box(0.035, 0.40, 0.008), LEATHER, { seed: 133 }), 0.12, 0.02, 0.135),
    place(paint(cyl(0.012, 0.012, 0.36, 6), [0.26, 0.24, 0.20], { seed: 134 }), 0, -0.20, -0.15, [0, 0, Math.PI / 2]),          // bedroll under the flap
    place(paint(box(0.02, 0.03, 0.02), BRASS, { seed: 135 }), -0.12, -0.14, 0.145),
    place(paint(box(0.02, 0.03, 0.02), BRASS, { seed: 135 }), 0.12, -0.14, 0.145),
  ]);
  body.translate(0, 0.22, 0);
  const lid = merge([
    place(paint(puffBox(0.40, 0.03, 0.22, 0.012), [0.33, 0.35, 0.27], { jitter: 0.07, grime: 0.5, seed: 136, scale: 26 }), 0, 0.014, 0.10),
    place(paint(box(0.03, 0.03, 0.14), LEATHER, { seed: 137 }), -0.12, 0.02, 0.18),
    place(paint(box(0.03, 0.03, 0.14), LEATHER, { seed: 137 }), 0.12, 0.02, 0.18),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, 0.44, -0.12], open: -1.8, cast: true, cull: 120 };
}
// what an entity leaves: webbing and magazines in a smear of ash. `arms` adds the weapon it was carrying.
function pileGeo(arms) {
  const parts = [
    place(paint(cyl(0.46, 0.52, 0.012, 14), ASH, { jitter: 0.16, grime: 0.7, seed: 141, scale: 18 }), 0, 0.006, 0),       // ash smear
    place(paint(puffBox(0.34, 0.13, 0.24, 0.012), [0.29, 0.30, 0.24], { grime: 0.6, bottom: 0.4, seed: 142, scale: 26 }), 0.02, 0.07, 0.03),  // webbing bundle
    place(paint(box(0.09, 0.03, 0.15), DARK, { seed: 143 }), -0.20, 0.02, -0.06, [0, 0.4, 0]),                            // spilled magazine
    place(paint(box(0.09, 0.03, 0.15), DARK, { seed: 144 }), -0.14, 0.02, 0.12, [0, -0.9, 0]),
    place(paint(box(0.05, 0.04, 0.05), TAN, { grime: 0.5, seed: 145 }), 0.20, 0.03, -0.10),                               // a field dressing, unused
  ];
  if (arms) {
    parts.push(place(paint(box(0.54, 0.045, 0.055), GUNMETAL, { rust: 0.12, seed: 146, scale: 40 }), 0.06, 0.045, -0.16, [0, 0.25, 0]));   // receiver and barrel
    parts.push(place(paint(cyl(0.011, 0.011, 0.30, 6), GUNMETAL, { seed: 147 }), 0.36, 0.05, -0.24, [0, 0, Math.PI / 2], null));
    parts.push(place(paint(box(0.20, 0.05, 0.05), [0.32, 0.24, 0.15], { jitter: 0.1, seed: 148, scale: 34 }), -0.26, 0.045, -0.09, [0, 0.25, 0]));  // stock
    parts.push(place(paint(box(0.10, 0.09, 0.03), DARK, { seed: 149 }), 0.02, 0.02, -0.12, [0.5, 0.25, 0]));                                       // magazine, still in it
  }
  return { body: shared(merge(parts)), lid: null, hinge: [0, 0, 0], open: 0, cast: false, cull: 90 };
}
function bandageGeo() {
  const g = merge([
    place(paint(cyl(0.035, 0.035, 0.09, 10), [0.78, 0.75, 0.68], { jitter: 0.04, grime: 0.3, seed: 31, scale: 60 }), 0, 0.035, 0, [0, 0, Math.PI / 2]),
    place(paint(cyl(0.037, 0.037, 0.03, 10), [0.60, 0.50, 0.36], { seed: 32, scale: 60 }), 0.005, 0.035, 0, [0, 0, Math.PI / 2]),
  ]);
  return shared(g);
}
function batteryGeo() {
  const g = merge([
    place(paint(cyl(0.017, 0.017, 0.062, 10), [0.24, 0.25, 0.27], { jitter: 0.05, seed: 41, scale: 60 }), 0, 0.017, 0, [0, 0, Math.PI / 2]),
    place(paint(cyl(0.006, 0.006, 0.006, 8), [0.62, 0.42, 0.22], { seed: 42 }), 0.034, 0.017, 0, [0, 0, Math.PI / 2]),
    place(paint(cyl(0.0175, 0.0175, 0.014, 10), [0.55, 0.20, 0.14], { seed: 43, scale: 60 }), 0.016, 0.017, 0, [0, 0, Math.PI / 2]),
  ]);
  return shared(g);
}
function probeGeo() {
  const steel = [0.44, 0.45, 0.47];
  const g = merge([
    place(paint(cyl(0.008, 0.008, 0.22, 8), steel, { jitter: 0.06, rust: 0.15, seed: 51, scale: 60 }), 0, 0.012, 0, [0, 0, Math.PI / 2]),
    place(paint(new THREE.ConeGeometry(0.008, 0.04, 8), steel, { seed: 52 }), 0.13, 0.012, 0, [0, 0, -Math.PI / 2]),
    place(paint(new THREE.TorusGeometry(0.02, 0.004, 5, 10), steel, { seed: 53 }), -0.125, 0.02, 0, [0, Math.PI / 2, 0]),
  ]);
  return shared(g);
}
function ammoBoxGeo() {
  const g = merge([
    paint(box(0.09, 0.045, 0.06), [0.50, 0.42, 0.30], { jitter: 0.06, grime: 0.4, seed: 61, scale: 60 }),
    place(paint(box(0.05, 0.02, 0.002), [0.72, 0.70, 0.62], { seed: 62, scale: 60 }), 0.01, 0.005, 0.031),
  ]);
  g.translate(0, 0.0225, 0);
  return shared(g);
}
const GEO_BUILDERS = {
  ammoTin: ammoTinGeo, medBag: medBagGeo, footlocker: footlockerGeo, crate: crateGeo, cabinet: cabinetGeo,
  safe: safeGeo, toolbox: toolboxGeo, rack: rackGeo, desk: deskGeo, carton: cartonGeo, pack: packGeo,
  pileKit: () => pileGeo(false), pileArms: () => pileGeo(true),
  bandage: bandageGeo, battery: batteryGeo, probe: probeGeo, ammoBox: ammoBoxGeo,
};
function geoFor(kind) {
  if (!GEO[kind]) GEO[kind] = (GEO_BUILDERS[kind] || GEO_BUILDERS.ammoTin)();
  return GEO[kind];
}
// a container body that will not stand on a shelf
const SHELF_OK = new Set(['ammoTin', 'medBag', 'toolbox', 'carton', 'pack']);

// ---------------------------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------------------------
const LOOSE = {
  bandage: { item: 'bandage', n: 1, prompt: 'PICK UP · BANDAGE', sound: 'pickup_item' },
  battery: { item: 'battery', n: 1, prompt: 'PICK UP · BATTERY CELL', sound: 'pickup_item' },
  probe: { item: 'probe', n: 1, prompt: 'PICK UP · PROBE', sound: 'pickup_item' },
  ammoBox: { ammo: '9x18_fmj', n: 8, prompt: 'PICK UP · 9×18 MM ×8', sound: 'pickup_ammo' },
};
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const nameOf = (id) => def(id)?.name || id;

// ---- catalogue pools, derived from `kind` once and cached: no id lists anywhere in the loot tables ----
let POOLS = null;
const POOL_CACHE = new Map();
function pools() {
  if (POOLS) return POOLS;
  POOLS = {};
  for (const table of [WEAPONS, AMMO, MAGAZINES, ATTACHMENTS, ARMOR, ITEMS]) {
    for (const d of Object.values(table)) {
      if (!d || d.hidden) continue;
      const cat = categoryOf(d.id);
      if (!cat || cat === 'unknown') continue;
      (POOLS[cat] = POOLS[cat] || []).push(d);
    }
  }
  return POOLS;
}
function poolFor(category) {
  let p = POOL_CACHE.get(category);
  if (p) return p;
  const src = CATEGORY_SOURCES[category] || [category];
  const all = pools();
  p = [];
  for (const s of src) for (const d of all[s] || []) p.push(d);
  POOL_CACHE.set(category, p);
  return p;
}
// weighted pick out of a pool by rarity and clearance rank against the tier
function pickDef(list, tier, rnd, filter = null) {
  let sum = 0;
  const w = new Array(list.length);
  for (let i = 0; i < list.length; i++) { const d = list[i]; const s = (!filter || filter(d)) ? pickWeight(d, tier) : 0; w[i] = s; sum += s; }
  if (sum <= 0) return null;
  let r = rnd() * sum;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}
function weighted(w, rnd) {
  let sum = 0; for (const k in w) sum += w[k];
  let r = rnd() * sum; for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return Object.keys(w)[0];
}
const band = (r, t, rnd) => { const lo = lerp(r[0][0], r[1][0], t), hi = lerp(r[0][1], r[1][1], t); return lo + (hi - lo) * rnd(); };

export function createLoot(ctx) {
  const { THREE: T, scene } = ctx;
  const objects = [];        // containers, loose items and piles
  const opening = [];        // lids mid-animation
  let retryFrames = 0, usedFallback = false, cullT = 0, pileSeq = 0;
  const _p = new THREE.Vector3();

  const D = () => ctx.state.data;
  const openedKey = (x, z) => `${D().tideLevel}:${Math.round(x)}:${Math.round(z)}`;
  const openedList = () => { const f = D().flags; if (!Array.isArray(f.lootOpened)) f.lootOpened = []; return f.lootOpened; };
  const leftMap = () => { const f = D().flags; if (!f.lootLeft || typeof f.lootLeft !== 'object') f.lootLeft = {}; return f.lootLeft; };
  const tierOf = (poiKind) => lootTier(poiKind, D().tideLevel, D().securityLevel);

  // ---- rolls ------------------------------------------------------------------------------------
  // A weapon out of the zone: worn, fouled, part loaded, sometimes with the magazine gone and sometimes
  // with glass already on it. tier01 is the location's depth normalised 0..1.
  function rollWeapon(d, tier01, rnd) {
    const w = makeWeapon(d.id, { condition: Math.round(band(FOUND.weapon.parts, tier01, rnd)) });
    w.dirt = band(FOUND.weapon.dirt, tier01, rnd);
    w.parts.bolt = clamp(Math.round(w.parts.bolt + (rnd() - 0.5) * 22), 3, 100);
    w.parts.frame = clamp(Math.round(w.parts.frame + (rnd() - 0.5) * 16), 5, 100);
    if (w.mag) {
      if (rnd() < lerp(FOUND.weapon.noMag[0], FOUND.weapon.noMag[1], tier01)) { w.mag = null; w.chamber = null; }
      else {
        w.mag.rounds = Math.round(MAGAZINES[w.mag.id].cap * band(FOUND.weapon.loaded, tier01, rnd));
        if (w.mag.rounds <= 0) { w.mag.rounds = 0; w.mag.ammo = null; w.chamber = null; }
      }
    } else if (w.tube.length) {
      w.tube.length = Math.round(w.tube.length * band(FOUND.weapon.loaded, tier01, rnd));
      if (!w.tube.length) w.chamber = null;
    }
    if (rnd() < lerp(FOUND.weapon.attachment[0], FOUND.weapon.attachment[1], tier01)) {
      const n = 1 + (rnd() < 0.3 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const fits = attachmentsFor(w.id, w.rails).filter((a) => a.slot === 'rail' ? !w.rails.includes(a.id) : !w.attachments[a.slot]);
        const a = pickDef(fits, tier01 * TIER.max, rnd);
        if (!a || !attach(w, a.id)) break;
      }
    }
    return w;
  }
  // one draw from one category -> a pile entry, or null
  function rollOne(cat, tier, rnd) {
    const tier01 = clamp(tier / TIER.max, 0, 1);
    const inv = ctx.inventory;
    if (cat === 'ammo') {
      // the zone is not generous, but it is not spiteful either: mostly rounds something you carry can fire
      const owned = new Set(inv.weapons.map((w) => WEAPONS[w.id]?.cal).filter(Boolean));
      const bias = owned.size > 0 && rnd() < 0.6;
      const a = pickDef(poolFor('ammo'), tier, rnd, bias ? (d) => owned.has(d.cal) : null) || pickDef(poolFor('ammo'), tier, rnd);
      if (!a) return null;
      const r = AMMO_ROLL[a.rarity] || AMMO_ROLL.common;
      return { kind: 'item', id: a.id, count: Math.max(1, Math.round(r[0] + (r[1] - r[0]) * rnd())) };
    }
    if (cat === 'mag') {
      const fams = new Set(inv.weapons.map((w) => WEAPONS[w.id]?.family).filter(Boolean));
      const bias = fams.size > 0 && rnd() < 0.5;
      const m = pickDef(poolFor('mag'), tier, rnd, bias ? (d) => d.fits.some((f) => fams.has(f)) : null) || pickDef(poolFor('mag'), tier, rnd);
      if (!m) return null;
      const empty = rnd() < lerp(FOUND.mag.empty[0], FOUND.mag.empty[1], tier01);
      const rounds = empty ? 0 : Math.max(1, Math.round(m.cap * band(FOUND.mag.rounds, tier01, rnd)));
      const inst = makeMag(m.id, defaultAmmo(m.cal), rounds);
      return { kind: 'mag', id: m.id, inst, count: 1 };
    }
    if (cat === 'weapon') {
      const d = pickDef(poolFor('weapon'), tier, rnd);
      if (!d) return null;
      return { kind: 'weapon', id: d.id, inst: rollWeapon(d, tier01, rnd), count: 1 };
    }
    if (cat === 'armor' || cat === 'helmet' || cat === 'kit') {
      const d = pickDef(poolFor(cat), tier, rnd);
      if (!d) return null;
      const opts = {};
      if (d.durability) opts.durability = Math.max(1, Math.round(d.durability * band(FOUND.gear.durability, tier01, rnd)));
      if (d.battery || d.filter || d.charge) opts.charge = Math.round(25 + rnd() * 75);
      return { kind: 'gear', id: d.id, inst: makeGear(d.id, opts), count: 1 };
    }
    const d = pickDef(poolFor(cat), tier, rnd);
    if (!d) return null;
    const r = COUNT_ROLL[cat] || [1, 1];
    let n = Math.round(r[0] + (r[1] - r[0]) * rnd());
    if ((d.price || 0) <= CHEAP) n *= CHEAP_MULT;
    return { kind: 'item', id: d.id, count: clamp(n, 1, d.stack || 1) };
  }
  // the whole contents of one container, rolled from its seed so it is the same every time it is looked at
  function rollContents(kind, tier, rnd, keptShut = false) {
    const c = CONTAINERS[kind];
    if (!c) return [];
    if (c.empty && !keptShut && rnd() < c.empty) return [];   // a lock means somebody thought it was worth locking
    const n = Math.round(c.rolls[0] + (c.rolls[1] - c.rolls[0]) * rnd());
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = rollOne(weighted(c.categories, rnd), tier, rnd);
      if (!e) continue;
      if (e.kind === 'item') { const same = out.find((x) => x.kind === 'item' && x.id === e.id); if (same) { same.count += e.count; continue; } }
      out.push(e);
    }
    out.forEach((e, i) => { e.slot = i; });
    return out;
  }

  // ---- the search panel -------------------------------------------------------------------------
  function openPile(o) {
    const pile = o.pile;
    if (!ctx.panels?.open) {   // no desk (a headless scenario): take it all where it stands
      const names = [];
      for (const e of [...pile.entries]) {
        if (e.kind === 'weapon') ctx.inventory.addWeapon(e.inst); else if (e.kind === 'mag') ctx.inventory.addMag(e.inst);
        else if (e.kind === 'gear') ctx.inventory.addGear(e.inst); else ctx.inventory.add(e.id, e.count || 1);
        names.push(`${nameOf(e.id)}${(e.count || 1) > 1 ? ` ×${e.count}` : ''}`);
      }
      pile.entries.length = 0;
      ctx.weapons?.onInventoryChanged?.();
      if (names.length) ctx.hud.notify(`Recovered: ${names.join(', ')}.`, { code: pile.name, ms: 4800 });
      pile.onChange?.();
      return;
    }
    ctx.panels.open('loot', { pile });
  }
  // remember what is left of a container so the Tide, not the save, is what clears it
  function persist(o) {
    if (o.type !== 'container') return;
    const key = openedKey(o.x, o.z);
    const slots = o.pile.entries.map((e) => e.slot).filter((s) => typeof s === 'number');
    o.emptied = o.pile.entries.length === 0;
    const left = leftMap();
    left[key] = slots;
    const keys = Object.keys(left);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete left[k];
    if (o.emptied) { const list = openedList(); if (!list.includes(key)) list.push(key); if (list.length > 400) list.splice(0, list.length - 400); }
  }

  // ---- locks ------------------------------------------------------------------------------------
  const hasPick = () => ctx.inventory.has('lockpick') || ctx.inventory.has('key_locker');
  function usePick() {
    const inv = ctx.inventory;
    if (inv.has('key_locker')) { inv.remove('key_locker', 1); return 'key'; }
    if (!inv.has('lockpick')) return null;
    const f = D().flags; f.kitUses = f.kitUses || {};
    const left = (f.kitUses.lockpick ?? def('lockpick')?.uses ?? 3) - LOCK.picks;
    if (left <= 0) { inv.remove('lockpick', 1); delete f.kitUses.lockpick; } else f.kitUses.lockpick = left;
    return 'pick';
  }

  // ---- placement --------------------------------------------------------------------------------
  function makeContainer(kind, spot, rnd) {
    const c = CONTAINERS[kind];
    const g = geoFor(c.mesh);
    const mat = bodyMaterial(); mat.color.setHSL(0.09 + rnd() * 0.05, 0.08, 0.9 + (rnd() - 0.5) * 0.14);   // per-instance tint around white; vertex colours carry the detail
    const root = new T.Group();
    const body = new T.Mesh(g.body, mat); body.castShadow = g.cast; body.receiveShadow = true;
    root.add(body);
    let hinge = null;
    if (g.lid) {
      hinge = new T.Group(); hinge.position.set(g.hinge[0], g.hinge[1], g.hinge[2]);
      const lid = new T.Mesh(g.lid, mat); lid.castShadow = g.cast; hinge.add(lid);
      root.add(hinge);
    }
    if (c.scale) root.scale.set(c.scale[0], c.scale[1], c.scale[2]);
    root.position.copy(spot.position);
    root.rotation.set((rnd() - 0.5) * 0.05, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.05);
    scene.add(root);
    const poi = ctx.world.poi(spot.poi);
    const o = {
      type: 'container', root, lid: hinge, openAngle: g.open, axis: g.axis || 'x', mats: [mat], kind, cont: kind, cull: g.cull,
      x: root.position.x, z: root.position.z, t: -1, unregister: null, pile: null, seen: false, emptied: false, opened: false,
      locked: false, wasLocked: false, pickable: null,
      tier: tierOf(poi ? poi.kind : 'field'),
      name: c.name.toUpperCase() + (poi ? ' · ' + poi.name.toUpperCase() : ' · FIELD'),
      seed: (Math.round(spot.position.x * 7) * 131 + Math.round(spot.position.z * 7) * 17 + D().tideLevel * 977) >>> 0,
      keep: null,
    };
    o.wasLocked = o.locked = !!(c.locked && rnd() < c.locked);
    registerContainer(o);
    objects.push(o);
    return o;
  }
  function ensureContents(o) {
    if (o.pile) return o.pile;
    const rr = mulberry32(o.seed);
    let entries = rollContents(o.cont, o.tier, rr, o.wasLocked);
    if (Array.isArray(o.keep)) { const keep = new Set(o.keep); entries = entries.filter((e) => keep.has(e.slot)); }
    o.pile = { name: o.name, entries, onChange: () => persist(o) };
    return o.pile;
  }
  function openContainer(o) {
    if (o.locked) {
      const used = usePick();
      if (!used) { ctx.hud.notify('Locked. It wants picks, or the key.', { code: o.name, ms: 3200 }); ctx.audio.play('ui_deny', { gain: 0.5 }); return; }
      o.locked = false;
      ctx.audio.play('unjam', { pos: o.root.position, gain: 0.7 });
      ctx.hud.notify(used === 'key' ? 'The key turns.' : 'The lock gives.', { code: o.name, ms: 2600, sound: false });
      registerContainer(o);
    }
    if (!o.opened) {
      o.opened = true;
      if (o.lid) { o.t = 0; if (!opening.includes(o)) opening.push(o); }
      ctx.audio.play('container_open', { pos: o.root.position, gain: 0.7, variant: o.cont });
      registerContainer(o);
    }
    const pile = ensureContents(o);
    if (!pile.entries.length) { ctx.hud.notify('Cleaned out before you got here.', { code: o.name, ms: 3000, sound: false }); persist(o); return; }
    openPile(o);
  }
  // registration is redone when the lock state or the pick in the pocket changes: the hold only exists when
  // there is something to work the lock with
  function registerContainer(o) {
    o.unregister?.(); o.unregister = null;
    const pick = o.locked ? hasPick() : false;
    o.pickable = pick;
    _p.copy(o.root.position); _p.y += 0.25;
    const short = o.name.split(' · ')[0];
    o.unregister = ctx.interact.register({
      position: _p.clone(), radius: 2.4, hold: o.locked && pick ? LOCK.hold : 0,
      prompt: () => (o.locked ? (o.pickable ? `FORCE · ${short}` : `LOCKED · ${short}`) : `${o.opened ? 'SEARCH' : 'OPEN'} · ${short}`),
      onInteract() { openContainer(o); },
    });
  }
  function makeLoose(kind, spot, rnd) {
    const g = geoFor(kind);
    const mat = bodyMaterial({ roughness: kind === 'probe' || kind === 'battery' ? 0.55 : 0.9, metalness: kind === 'probe' ? 0.5 : 0.1 });
    mat.color.setHSL(0.1, 0.05, 0.92 + (rnd() - 0.5) * 0.1);
    const mesh = new T.Mesh(g, mat); mesh.receiveShadow = true;
    mesh.position.copy(spot.position); mesh.rotation.y = rnd() * Math.PI * 2;
    scene.add(mesh);
    const d = LOOSE[kind];
    const o = { type: 'loose', root: mesh, lid: null, mats: [mat], kind, cull: 70, x: mesh.position.x, z: mesh.position.z, t: -1, unregister: null };
    _p.copy(mesh.position); _p.y += 0.12;
    o.unregister = ctx.interact.register({
      position: _p.clone(), radius: 2.2, prompt: d.prompt,
      onInteract() {
        if (d.ammo) { ctx.inventory.addAmmo(d.ammo, d.n); ctx.hud.notify(`Recovered: ${nameOf(d.ammo)} ×${d.n}.`, { code: 'FIELD PICKUP', ms: 2600, sound: false }); }
        else { ctx.inventory.add(d.item, d.n); ctx.hud.notify(`Recovered: ${lower(nameOf(d.item))} ×${d.n}.`, { code: 'FIELD PICKUP', ms: 2600, sound: false }); }
        ctx.audio.play(d.sound, { gain: 0.6 });
        const list = openedList(); list.push(openedKey(o.x, o.z));
        disposeObject(o); const i = objects.indexOf(o); if (i >= 0) objects.splice(i, 1);
      },
    });
    objects.push(o);
    return o;
  }
  function disposeObject(o) {
    o.unregister?.(); o.unregister = null;
    scene.remove(o.root);
    o.root.traverse((m) => { if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose(); });
    for (const m of o.mats) m.dispose();
    const k = opening.indexOf(o); if (k >= 0) opening.splice(k, 1);
  }

  // ---- piles: what an entity leaves, and what the Explorer sets down ------------------------------
  const MAX_PILES = 44;
  // A cache is a pile the save remembers. A mimic's remains are litter and go with the next Tide; what
  // came off the Explorer is a debt with an address, and it has to still be there tomorrow morning or the
  // walk back is not a decision. Lives in state.data.caches, restored after every populate().
  const CACHE_TIDES = 2;      // survives the Tide that follows the death; the one after that takes it
  const CACHE_HOURS = 96;     // and never longer than four days, whatever the Tide is doing
  const MAX_CACHES = 3;
  const cacheList = () => { const d = D(); if (!Array.isArray(d.caches)) d.caches = []; return d.caches; };
  const nowHours = () => (D().day - 1) * 24 + D().hour;
  function groundAt(x, z) {
    const w = ctx.world;
    try { return w.groundHeight(x, z, w.getHeight(x, z) + 2).y; } catch { return w.getHeight(x, z); }
  }
  function spawnPile(position, entries, opts = {}) {
    const list = (entries || []).filter((e) => e && e.id);
    const arms = list.some((e) => e.kind === 'weapon');
    const g = geoFor(arms ? 'pileArms' : 'pileKit');
    const mat = bodyMaterial({ roughness: 0.92 });
    mat.color.setHSL(0.08, 0.05, 0.86 + Math.random() * 0.1);
    const mesh = new T.Mesh(g.body, mat); mesh.receiveShadow = true;
    const x = position?.x ?? ctx.player.position.x, z = position?.z ?? ctx.player.position.z;
    const y = (position && typeof position.y === 'number' ? position.y : groundAt(x, z)) + 0.012;
    mesh.position.set(x, y, z); mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);
    const kind = opts.kind || 'corpse';
    const name = (opts.name || (kind === 'cache' ? 'CACHE' : 'REMAINS')).toUpperCase();
    const o = {
      type: 'pile', root: mesh, lid: null, mats: [mat], kind: 'pile', markerKind: kind, cull: g.cull,
      x, z, t: -1, unregister: null, seen: true, searched: false, emptied: !list.length, age: 0, seq: pileSeq++, emptyT: 0,
      pile: { name, entries: list, onChange: () => { o.emptied = !o.pile.entries.length; o.searched = true; } },
    };
    _p.set(x, y + 0.2, z);
    o.unregister = ctx.interact.register({
      position: _p.clone(), radius: 2.2,
      prompt: () => `SEARCH · ${name}`,
      onInteract() { o.searched = true; openPile(o); },
    });
    objects.push(o);
    // the zone does not keep every body: past the cap the oldest emptied pile goes first
    let piles = objects.filter((p) => p.type === 'pile' && p !== o && !p.cacheId);
    while (piles.length >= MAX_PILES) {
      piles.sort((a, b) => (a.emptied === b.emptied ? a.seq - b.seq : a.emptied ? -1 : 1));
      const old = piles.shift();
      disposeObject(old); const i = objects.indexOf(old); if (i >= 0) objects.splice(i, 1);
    }
    return o;
  }
  // one entry set down by the Explorer: merged into a cache at their feet, or a new one
  function dropItem(entry, position) {
    if (!entry || !entry.id) return null;
    const p = position || ctx.player.position;
    const yaw = ctx.player.yaw || 0;
    let x = p.x - Math.sin(yaw) * 0.9, z = p.z - Math.cos(yaw) * 0.9;
    if (ctx.world.isWater?.(x, z) || ctx.world.pointInSolid?.(x, groundAt(x, z) + 0.3, z)) { x = p.x; z = p.z; }
    for (const o of objects) {
      if (o.type !== 'pile' || o.markerKind !== 'cache') continue;
      if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) > 2.25) continue;
      if (entry.kind === 'item') { const same = o.pile.entries.find((e) => e.kind === 'item' && e.id === entry.id); if (same) { same.count = (same.count || 1) + (entry.count || 1); o.emptied = false; return o; } }
      o.pile.entries.push(entry); o.emptied = false; return o;
    }
    return spawnPile({ x, z, y: groundAt(x, z) }, [entry], { kind: 'cache', name: 'CACHE' });
  }

  // ---- caches: the debt with an address ----------------------------------------------------------
  // dropCache() is what player/damage.js calls the moment the Explorer goes down. It writes the record
  // into the save so it survives sleeping, reloading and one Tide, and spawns the searchable pile now.
  let cacheSeq = 0;
  function spawnCache(rec) {
    const y = typeof rec.y === 'number' ? rec.y : groundAt(rec.x, rec.z);
    const o = spawnPile({ x: rec.x, y, z: rec.z }, rec.entries, { kind: rec.kind || 'corpse', name: rec.name || 'EXPLORER 61' });
    if (!o) return null;
    o.cacheId = rec.id;
    // share the array, so every Take in the loot panel lands directly in the saved record
    o.pile.entries = rec.entries;
    o.emptied = !rec.entries.length;
    o.pile.onChange = () => {
      o.emptied = !rec.entries.length;
      o.searched = true;
      if (!rec.entries.length) dropCacheRecord(rec.id);
    };
    return o;
  }
  function dropCacheRecord(id) {
    const cl = cacheList();
    const i = cl.findIndex((c) => c.id === id);
    if (i >= 0) cl.splice(i, 1);
  }
  function dropCache(entries, position, opts = {}) {
    const list = (entries || []).filter((e) => e && e.id);
    if (!list.length) return null;
    const d = D();
    const x = position?.x ?? ctx.player.position.x, z = position?.z ?? ctx.player.position.z;
    const poi = (() => { try { return ctx.world.nearestPoi(x, z)?.poi || null; } catch { return null; } })();
    const rec = {
      id: 'k' + (++cacheSeq) + '-' + Math.round(nowHours() * 60),
      x, z, y: typeof position?.y === 'number' ? position.y : groundAt(x, z),
      t0: nowHours(), tides: 0, degraded: false,
      kind: opts.kind || 'corpse', name: (opts.name || 'EXPLORER 61').toUpperCase(),
      poi: poi ? poi.id : null, poiName: poi ? poi.name : null,
      entries: JSON.parse(JSON.stringify(list)),
    };
    const cl = cacheList();
    cl.push(rec);
    while (cl.length > MAX_CACHES) cl.shift();
    try { spawnCache(rec); } catch (e) { console.warn('[loot] cache', e); }
    ctx.events.emit('cacheDropped', rec);
    return rec;
  }
  // The Tide takes what was loose and left it lying: rounds scatter, meds spoil, the hardware stays.
  // The second Tide takes the lot.
  function ageCaches() {
    const cl = cacheList();
    for (let i = cl.length - 1; i >= 0; i--) {
      const c = cl[i];
      c.tides = (c.tides | 0) + 1;
      if (c.tides >= CACHE_TIDES || nowHours() - (c.t0 || 0) > CACHE_HOURS) { cl.splice(i, 1); continue; }
      c.degraded = true;
      for (let k = c.entries.length - 1; k >= 0; k--) {
        const e = c.entries[k];
        if (e.kind !== 'item' || (e.count || 1) <= 1) continue;
        e.count = Math.max(1, Math.floor(e.count * 0.6));
      }
    }
  }
  function expireCaches() {
    const cl = cacheList();
    for (let i = cl.length - 1; i >= 0; i--) {
      const c = cl[i];
      if (!c || !Array.isArray(c.entries) || !c.entries.length) { cl.splice(i, 1); continue; }
      if (nowHours() - (c.t0 || 0) > CACHE_HOURS) cl.splice(i, 1);
    }
  }
  // Something takes an interest in a body. One mimic, placed once when the zone is rebuilt around a cache
  // the Explorer is nowhere near — recovering your own rifle should mean going through whatever took it,
  // with worse than it took. If population.js grows its own hook, this stands down.
  function guardCache(rec) {
    if (!api.cacheGuards || ctx.debug?.noEnemies) return null;
    if (typeof ctx.population?.guardCache === 'function') { try { return ctx.population.guardCache(rec); } catch { return null; } }
    if (!ctx.enemies?.spawn || ctx.enemies.list.length > 28) return null;
    const B = ctx.world.map.BASE;
    if (Math.hypot(rec.x - B.x, rec.z - B.z) < 70) return null;
    const p = ctx.player.position;
    if (Math.hypot(rec.x - p.x, rec.z - p.z) < 120) return null;
    const rr = mulberry32((Math.round(rec.x * 13) ^ Math.round(rec.z * 7) ^ (D().tideLevel * 8191)) >>> 0);
    for (let i = 0; i < 10; i++) {
      const a = rr() * Math.PI * 2, d = 13 + rr() * 14;
      const x = rec.x + Math.cos(a) * d, z = rec.z + Math.sin(a) * d;
      if (ctx.world.isWater(x, z)) continue;
      const y = groundAt(x, z);
      if (ctx.world.pointInSolid?.(x, y + 0.7, z)) continue;
      try { return ctx.enemies.spawn('mimic', new THREE.Vector3(x, y, z), { poi: rec.poi }); } catch { return null; }
    }
    return null;
  }
  // called after every populate(): the zone is rebuilt, the bodies go back on it
  function restoreCaches() {
    expireCaches();
    for (const c of cacheList()) {
      try { spawnCache(c); guardCache(c); } catch (e) { console.warn('[loot] restore cache', e); }
    }
  }

  // when structures have not registered anything yet: a few motivated points near each POI and along the roads
  function fallbackSpots(rnd) {
    const world = ctx.world, M = world.map, out = [];
    for (const poi of M.POIS) {
      if (poi.kind === 'base') continue;
      const n = clamp(Math.round(poi.r / 11), 3, 7);
      for (let i = 0; i < n; i++) { const p = world.randomPoint(rnd, poi.x, poi.z, poi.r * 0.55); if (p) out.push({ position: p, poi: poi.id, kind: 'floor' }); }
    }
    for (const road of M.ROADS) for (let i = 0; i < 3; i++) {
      const q = M.pointOnPolyline(road.pts, 0.1 + rnd() * 0.8);
      const side = rnd() < 0.5 ? -1 : 1, off = road.width * 0.5 + 0.8 + rnd() * 2.2;
      const x = q.x - q.dz * side * off, z = q.z + q.dx * side * off;
      if (world.isWater(x, z)) continue;
      const nearest = world.nearestPoi(x, z);
      out.push({ position: new THREE.Vector3(x, world.getHeight(x, z), z), poi: nearest.poi?.id || null, kind: 'floor' });
    }
    return out;
  }
  // container / loose weights by the POI the spot belongs to, gated by the location's tier
  function pickKind(spot, rnd) {
    const poi = ctx.world.poi(spot.poi);
    const pk = poi ? poi.kind : 'field';
    const tier = tierOf(pk);
    const military = pk === 'checkpoint' || pk === 'convoy' || pk === 'industrial' || pk === 'rail';
    const civil = pk === 'village' || pk === 'church' || pk === 'marsh';
    const containerP = spot.kind === 'crate' ? 0.85 : spot.kind === 'shelf' ? 0.4 : 0.55;
    if (rnd() < containerP) {
      const table = CONTAINERS_BY_POI[pk] || CONTAINERS_BY_POI.field;
      const w = {};
      for (const [k, weight] of Object.entries(table)) {
        const c = CONTAINERS[k]; if (!c) continue;
        if ((c.tierMin || 0) > tier) continue;                                   // the good furniture is deeper in
        if (spot.kind === 'shelf' && !SHELF_OK.has(c.mesh)) continue;            // floor furniture is not on a shelf
        if (spot.kind === 'crate' && (c.mesh === 'crate' || c.mesh === 'ammoTin' || c.mesh === 'toolbox')) { w[k] = weight * 2; continue; }
        w[k] = weight;
      }
      if (Object.keys(w).length) return weighted(w, rnd);
    }
    const w = { bandage: civil ? 2.2 : 1.2, battery: 1.0, probe: pk === 'anomaly' || pk === 'forest' ? 2.4 : 1.0, ammoBox: military ? 2.0 : 0.7 };
    return weighted(w, rnd);
  }

  const api = {
    get objects() { return objects; },
    populate() {
      api.reset();
      const d = D();
      const rnd = ctx.rng.fork(9001 + d.tideLevel * 131 + d.stats.tides * 7);
      let spots = ctx.world.lootSpots;
      usedFallback = spots.length === 0;
      if (usedFallback) { spots = fallbackSpots(rnd); retryFrames = 4; }
      const opened = new Set(openedList());
      const left = leftMap();
      const order = spots.map((s, i) => ({ s, k: rnd() })).sort((a, b) => a.k - b.k);
      const take = Math.min(170, Math.round(order.length * 0.75));
      let made = 0;
      for (let i = 0; i < order.length && made < take; i++) {
        const spot = order[i].s;
        if (!spot?.position) continue;
        const key = openedKey(spot.position.x, spot.position.z);
        const kind = pickKind(spot, rnd);
        if (LOOSE[kind]) { if (!opened.has(key)) makeLoose(kind, spot, rnd); made++; continue; }
        const remains = left[key];
        if (opened.has(key) && !(Array.isArray(remains) && remains.length)) { made++; continue; }   // emptied and left behind
        const o = makeContainer(kind, spot, rnd);
        if (Array.isArray(remains)) { o.keep = remains; o.opened = true; if (o.lid) o.lid.rotation[o.axis] = o.openAngle; o.locked = false; registerContainer(o); }
        made++;
      }
      setProgression({ tide: d.tideLevel, security: d.securityLevel });
      cullT = 0;
    },
    reset() {
      for (const o of objects) disposeObject(o);
      objects.length = 0; opening.length = 0;
    },
    update(dt) {
      if (retryFrames > 0 && --retryFrames === 0 && usedFallback && ctx.world.lootSpots.length > 0) { api.populate(); return; }
      // lids
      for (let i = opening.length - 1; i >= 0; i--) {
        const o = opening[i]; o.t += dt;
        const k = easeOutCubic(clamp(o.t / 0.3, 0, 1));
        if (o.lid) o.lid.rotation[o.axis] = o.openAngle * k;
        if (o.t >= 0.3) opening.splice(i, 1);
      }
      cullT -= dt;
      if (cullT > 0) return;
      cullT = 0.4;
      const d = D();
      // the zone's standing: what the Tide and the Committee's paperwork are currently worth to a mimic's kit
      setProgression({ tide: d.tideLevel, security: d.securityLevel });
      const p = ctx.player.position;
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        const dx = o.x - p.x, dz = o.z - p.z, d2 = dx * dx + dz * dz;
        o.root.visible = d2 < o.cull * o.cull;
        if (o.type === 'container') {
          if (!o.seen && d2 < 26 * 26) o.seen = true;
          if (o.locked && o.pickable !== hasPick()) registerContainer(o);   // picks in the pocket change the prompt
        } else if (o.type === 'pile' && o.emptied) {
          // an emptied pile is litter: it goes once the Explorer has walked away from it
          o.emptyT += 0.4;
          if (o.emptyT > 20 && d2 > 25) { disposeObject(o); objects.splice(i, 1); }
        }
      }
    },
    // the sheet's field annotations: containers the Explorer has walked past, and every pile
    markers() {
      const out = [];
      for (const o of objects) {
        if (o.type === 'loose') continue;
        if (o.type === 'container' && !o.seen) continue;
        out.push({ x: o.x, z: o.z, kind: o.type === 'pile' ? o.markerKind : 'container', opened: !!o.emptied, searched: !!o.emptied });
      }
      return out;
    },
    spawnPile,
    dropItem,
    // the death ledger's half of the contract: damage.js records, loot.js keeps and decays
    cacheGuards: true,
    dropCache,
    caches() { return cacheList(); },
    nearestCache(pos = ctx.player.position) {
      let best = null, bd = Infinity;
      for (const c of cacheList()) { const d = Math.hypot(c.x - pos.x, c.z - pos.z); if (d < bd) { bd = d; best = c; } }
      return best ? { cache: best, distance: bd } : null;
    },
    restoreCaches,
    tierAt(poiKind) { return tierOf(poiKind); },
  };
  ctx.events.on('gameStart', () => { const f = D().flags; if (!Array.isArray(f.lootOpened)) f.lootOpened = []; if (!f.lootLeft || typeof f.lootLeft !== 'object') f.lootLeft = {}; api.populate(); restoreCaches(); });
  // the Tide rearranges the zone: opened containers, half-searched crates and every body on the ground go with it
  ctx.events.on('tide', () => { const f = D().flags; f.lootOpened = []; f.lootLeft = {}; ageCaches(); api.populate(); restoreCaches(); });
  return api;
}
