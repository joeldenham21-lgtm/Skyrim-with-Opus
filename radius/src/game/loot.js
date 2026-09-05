// Loot: containers (ammo tin, medical bag, footlocker) and loose items placed at world.lootSpots.
// Everything is procedural: merged low-poly parts with baked vertex-colour grime, one mesh per body and
// one per lid so the lid can swing. Re-rolls on the Tide; opened containers are remembered in the save.
// Also exports the small mesh kit (paint / merge / led) that missions.js uses for its objects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash3, mulberry32 } from '../core/rng.js';
import { ITEMS, AMMO, WEAPON_DEFS, makeWeapon } from '../player/inventory.js';
import { clamp, easeOutCubic } from '../core/math.js';

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

function ammoTinGeo() {
  const olive = [0.30, 0.34, 0.24], steel = [0.32, 0.33, 0.33], stencil = [0.62, 0.60, 0.50];
  const body = merge([
    paint(box(0.30, 0.15, 0.17), olive, { rust: 0.28, seed: 1 }),
    place(paint(box(0.03, 0.045, 0.012), steel, { seed: 2 }), 0, 0.02, 0.09),                  // front latch
    place(paint(box(0.16, 0.04, 0.004), stencil, { jitter: 0.12, grime: 0.6, seed: 3 }), 0.03, 0.01, 0.087), // stencil strip
    place(paint(box(0.302, 0.012, 0.172), steel, { seed: 4 }), 0, -0.07, 0),                   // rolled base seam
  ]);
  body.translate(0, 0.075, 0);
  // lid: hinged along the back edge (z = -0.085). Geometry is authored with the hinge at the origin.
  const lid = merge([
    place(paint(box(0.31, 0.028, 0.18), olive, { rust: 0.22, seed: 5 }), 0, 0.014, 0.09),
    place(paint(cyl(0.006, 0.006, 0.12, 6), steel, { seed: 6 }), 0, 0.04, 0.09, [0, 0, Math.PI / 2]),        // wire handle bar
    place(paint(cyl(0.006, 0.006, 0.02, 6), steel, { seed: 6 }), -0.06, 0.03, 0.09),
    place(paint(cyl(0.006, 0.006, 0.02, 6), steel, { seed: 6 }), 0.06, 0.03, 0.09),
    place(paint(cyl(0.008, 0.008, 0.30, 6), steel, { seed: 7 }), 0, 0, 0, [0, 0, Math.PI / 2]),             // hinge rod
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, 0.15, -0.085], open: -2.1, cast: false, cull: 110 };
}
function medBagGeo() {
  const tan = [0.56, 0.48, 0.34], leather = [0.30, 0.22, 0.15], brass = [0.55, 0.45, 0.25];
  const body = merge([
    paint(puffBox(0.34, 0.20, 0.22, 0.016), tan, { jitter: 0.06, grime: 0.5, bottom: 0.45, seed: 11, scale: 30 }),
    place(paint(box(0.03, 0.20, 0.006), leather, { seed: 12 }), -0.09, 0, 0.114),            // front straps
    place(paint(box(0.03, 0.20, 0.006), leather, { seed: 12 }), 0.09, 0, 0.114),
    place(paint(box(0.34, 0.03, 0.006), leather, { seed: 13 }), 0, -0.07, 0.114),            // lower band
    place(paint(new THREE.TorusGeometry(0.11, 0.007, 5, 12, Math.PI), leather, { seed: 14 }), 0.19, -0.09, 0.02, [Math.PI / 2, 0, 0]), // shoulder strap on the ground
  ]);
  body.translate(0, 0.10, 0);
  const lid = merge([
    place(paint(puffBox(0.35, 0.03, 0.15, 0.008), tan, { jitter: 0.06, grime: 0.45, seed: 15, scale: 30 }), 0, 0.012, 0.075),
    place(paint(box(0.024, 0.014, 0.02), brass, { seed: 16 }), -0.09, 0.02, 0.135),          // buckles
    place(paint(box(0.024, 0.014, 0.02), brass, { seed: 16 }), 0.09, 0.02, 0.135),
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, 0.205, -0.10], open: -1.7, cast: true, cull: 110 };
}
function footlockerGeo() {
  const green = [0.24, 0.29, 0.22], steel = [0.30, 0.31, 0.31], stencil = [0.58, 0.57, 0.48];
  const parts = [paint(box(0.82, 0.36, 0.44), green, { rust: 0.3, seed: 21, scale: 24 })];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(place(paint(box(0.06, 0.37, 0.06), steel, { seed: 22 }), sx * 0.39, 0, sz * 0.20));  // corner caps
  for (const sx of [-1, 1]) {
    parts.push(place(paint(cyl(0.01, 0.01, 0.14, 6), steel, { seed: 23 }), sx * 0.425, 0.04, 0, [Math.PI / 2, 0, 0]));    // side handles
    parts.push(place(paint(box(0.02, 0.03, 0.02), steel, { seed: 23 }), sx * 0.415, 0.04, -0.07));
    parts.push(place(paint(box(0.02, 0.03, 0.02), steel, { seed: 23 }), sx * 0.415, 0.04, 0.07));
  }
  parts.push(place(paint(box(0.22, 0.07, 0.004), stencil, { jitter: 0.14, grime: 0.65, seed: 24 }), -0.12, 0.02, 0.222));
  const body = merge(parts); body.translate(0, 0.18, 0);
  const lid = merge([
    place(paint(box(0.84, 0.06, 0.46), green, { rust: 0.25, seed: 25, scale: 24 }), 0, 0.03, 0.23),
    place(paint(box(0.86, 0.015, 0.48), steel, { seed: 26 }), 0, 0.0, 0.23),                  // rim
    place(paint(box(0.05, 0.05, 0.02), steel, { seed: 27 }), 0, 0.02, 0.465),                 // hasp
    place(paint(cyl(0.009, 0.009, 0.7, 6), steel, { seed: 28 }), 0, 0, 0, [0, 0, Math.PI / 2]), // hinge rod
  ]);
  return { body: shared(body), lid: shared(lid), hinge: [0, 0.36, -0.22], open: -1.9, cast: true, cull: 150 };
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
function geoFor(kind) {
  if (!GEO[kind]) GEO[kind] = { ammoTin: ammoTinGeo, medBag: medBagGeo, footlocker: footlockerGeo, bandage: bandageGeo, battery: batteryGeo, probe: probeGeo, ammoBox: ammoBoxGeo }[kind]();
  return GEO[kind];
}

// ---------------------------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------------------------
const CONTAINERS = {
  ammoTin: { name: 'AMMO TIN' },
  medBag: { name: 'MEDICAL BAG' },
  footlocker: { name: 'FOOTLOCKER' },
};
const LOOSE = {
  bandage: { item: 'bandage', n: 1, prompt: 'PICK UP · BANDAGE', sound: 'pickup_item' },
  battery: { item: 'battery', n: 1, prompt: 'PICK UP · BATTERY CELL', sound: 'pickup_item' },
  probe: { item: 'probe', n: 1, prompt: 'PICK UP · PROBE', sound: 'pickup_item' },
  ammoBox: { ammo: '9x18', n: 8, prompt: 'PICK UP · 9×18 MM ×8', sound: 'pickup_ammo' },
};
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function createLoot(ctx) {
  const { THREE: T, scene } = ctx;
  const objects = [];        // { root, lid, geo, mats[], unregister, kind, cull, x, z, opening }
  const opening = [];        // containers mid-animation
  let retryFrames = 0, usedFallback = false, cullT = 0;
  const _p = new THREE.Vector3();

  const openedKey = (x, z) => `${ctx.state.data.tideLevel}:${Math.round(x)}:${Math.round(z)}`;
  const openedList = () => { const f = ctx.state.data.flags; if (!Array.isArray(f.lootOpened)) f.lootOpened = []; return f.lootOpened; };

  // ---- rolls ----
  function rollContents(kind, rnd) {
    const out = [];   // { ammo?, item?, weapon?, n }
    const inv = ctx.inventory;
    if (kind === 'ammoTin') {
      const owned = [...new Set(inv.weapons.map((w) => WEAPON_DEFS[w.id]?.ammo).filter(Boolean))];
      const cal = owned.length ? rnd.pick(owned) : '9x18';
      out.push({ ammo: cal, n: rnd.int(8, 24) });
      if (rnd.chance(0.2)) { const others = Object.keys(AMMO).filter((c) => c !== cal); out.push({ ammo: rnd.pick(others), n: rnd.int(6, 16) }); }
    } else if (kind === 'medBag') {
      out.push({ item: 'bandage', n: rnd.int(1, 2) });
      if (rnd.chance(0.3)) out.push({ item: 'medkit', n: 1 });
      if (rnd.chance(0.2)) out.push({ item: 'stim', n: 1 });
    } else {
      out.push({ item: 'probe', n: rnd.int(2, 4) });
      out.push({ item: 'battery', n: 1 });
      if (rnd.chance(0.15)) out.push({ item: 'cleankit', n: 1 });
      if (rnd.chance(0.08)) { const pool = ctx.state.data.securityLevel >= 2 ? ['pm', 'toz', 'akm'] : ['pm', 'toz']; out.push({ weapon: rnd.pick(pool), n: 1 }); }
    }
    return out;
  }
  function grant(contents, rnd) {
    const parts = [];
    for (const c of contents) {
      if (c.ammo) { ctx.inventory.addAmmo(c.ammo, c.n); parts.push(`${AMMO[c.ammo].name} ×${c.n}`); }
      else if (c.item) { ctx.inventory.add(c.item, c.n); parts.push(`${lower(ITEMS[c.item].name)} ×${c.n}`); }
      else if (c.weapon) {
        const w = makeWeapon(c.weapon);
        w.dirt = 0.25 + rnd() * 0.45;                              // found in the zone: fouled, half loaded
        for (let i = 0; i < w.mags.length; i++) w.mags[i] = rnd.int(0, w.mags[i]);
        ctx.inventory.addWeapon(w); ctx.weapons.onInventoryChanged?.();
        parts.push(WEAPON_DEFS[c.weapon].full);
      }
    }
    return parts;
  }

  // ---- placement ----
  function makeContainer(kind, spot, rnd) {
    const g = geoFor(kind);
    const mat = bodyMaterial(); mat.color.setHSL(0.09 + rnd() * 0.05, 0.08, 0.9 + (rnd() - 0.5) * 0.14);   // per-instance tint around white; vertex colours carry the detail
    const root = new T.Group();
    const body = new T.Mesh(g.body, mat); body.castShadow = g.cast; body.receiveShadow = true;
    const hinge = new T.Group(); hinge.position.set(g.hinge[0], g.hinge[1], g.hinge[2]);
    const lid = new T.Mesh(g.lid, mat); lid.castShadow = g.cast; hinge.add(lid);
    root.add(body, hinge);
    root.position.copy(spot.position);
    root.rotation.set((rnd() - 0.5) * 0.05, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.05);
    scene.add(root);
    const o = { root, lid: hinge, openAngle: g.open, mats: [mat], kind, cull: g.cull, x: root.position.x, z: root.position.z, t: -1, unregister: null };
    const seed = (Math.round(spot.position.x * 7) * 131 + Math.round(spot.position.z * 7) * 17 + ctx.state.data.tideLevel * 977) >>> 0;
    const prompt = `OPEN · ${CONTAINERS[kind].name}`;
    const poi = ctx.world.poi(spot.poi);
    const code = CONTAINERS[kind].name + (poi ? ' · ' + poi.name.toUpperCase() : ' · FIELD');
    _p.copy(root.position); _p.y += 0.25;
    o.unregister = ctx.interact.register({
      position: _p.clone(), radius: 2.4, prompt,
      onInteract() {
        o.unregister?.(); o.unregister = null;
        o.t = 0; opening.push(o);
        ctx.audio.play('container_open', { pos: root.position, gain: 0.7, variant: kind });
        const rr = mulberry32(seed);
        const parts = grant(rollContents(kind, rr), rr);
        ctx.hud.notify(`Recovered: ${parts.join(', ')}.`, { code, ms: 4800 });
        const list = openedList(); list.push(openedKey(o.x, o.z)); if (list.length > 400) list.splice(0, list.length - 400);
      },
    });
    objects.push(o);
    return o;
  }
  function makeLoose(kind, spot, rnd) {
    const g = geoFor(kind);
    const mat = bodyMaterial({ roughness: kind === 'probe' || kind === 'battery' ? 0.55 : 0.9, metalness: kind === 'probe' ? 0.5 : 0.1 });
    mat.color.setHSL(0.1, 0.05, 0.92 + (rnd() - 0.5) * 0.1);
    const mesh = new T.Mesh(g, mat); mesh.receiveShadow = true;
    mesh.position.copy(spot.position); mesh.rotation.y = rnd() * Math.PI * 2;
    scene.add(mesh);
    const def = LOOSE[kind];
    const o = { root: mesh, lid: null, mats: [mat], kind, cull: 70, x: mesh.position.x, z: mesh.position.z, t: -1, unregister: null };
    _p.copy(mesh.position); _p.y += 0.12;
    o.unregister = ctx.interact.register({
      position: _p.clone(), radius: 2.2, prompt: def.prompt,
      onInteract() {
        if (def.ammo) { ctx.inventory.addAmmo(def.ammo, def.n); ctx.hud.notify(`Recovered: ${AMMO[def.ammo].name} ×${def.n}.`, { code: 'FIELD PICKUP', ms: 2600, sound: false }); }
        else { ctx.inventory.add(def.item, def.n); ctx.hud.notify(`Recovered: ${lower(ITEMS[def.item].name)} ×${def.n}.`, { code: 'FIELD PICKUP', ms: 2600, sound: false }); }
        ctx.audio.play(def.sound, { gain: 0.6 });
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
  // container / loose weights by the POI the spot belongs to
  function pickKind(spot, rnd) {
    const poi = ctx.world.poi(spot.poi);
    const pk = poi ? poi.kind : 'field';
    const military = pk === 'checkpoint' || pk === 'convoy' || pk === 'industrial' || pk === 'rail';
    const civil = pk === 'village' || pk === 'church' || pk === 'marsh';
    const containerP = spot.kind === 'crate' ? 0.85 : spot.kind === 'shelf' ? 0.4 : 0.45;
    if (rnd() < containerP) {
      // a footlocker is floor furniture: never on a shelf
      const w = { ammoTin: military ? 3 : 1.2, medBag: civil ? 2.6 : 1.1, footlocker: spot.kind === 'shelf' ? 0 : spot.kind === 'crate' ? 1.6 : military ? 0.9 : 0.35 };
      return weighted(w, rnd);
    }
    const w = { bandage: civil ? 2.2 : 1.2, battery: 1.0, probe: pk === 'anomaly' || pk === 'forest' ? 2.4 : 1.0, ammoBox: military ? 2.0 : 0.7 };
    return weighted(w, rnd);
  }
  function weighted(w, rnd) {
    let sum = 0; for (const k in w) sum += w[k];
    let r = rnd() * sum; for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return Object.keys(w)[0];
  }

  const api = {
    get objects() { return objects; },
    populate() {
      api.reset();
      const d = ctx.state.data;
      const rnd = ctx.rng.fork(9001 + d.tideLevel * 131 + d.stats.tides * 7);
      let spots = ctx.world.lootSpots;
      usedFallback = spots.length === 0;
      if (usedFallback) { spots = fallbackSpots(rnd); retryFrames = 4; }
      const opened = new Set(openedList());
      const order = spots.map((s, i) => ({ s, k: rnd() })).sort((a, b) => a.k - b.k);
      const take = Math.min(160, Math.round(order.length * 0.7));
      let made = 0;
      for (let i = 0; i < order.length && made < take; i++) {
        const spot = order[i].s;
        if (!spot?.position) continue;
        if (opened.has(openedKey(spot.position.x, spot.position.z))) { made++; continue; }
        const kind = pickKind(spot, rnd);
        if (CONTAINERS[kind]) makeContainer(kind, spot, rnd); else makeLoose(kind, spot, rnd);
        made++;
      }
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
        o.lid.rotation.x = o.openAngle * k;
        if (o.t >= 0.3) opening.splice(i, 1);
      }
      // distance culling: far containers are not drawn
      cullT -= dt;
      if (cullT <= 0) {
        cullT = 0.4;
        const p = ctx.player.position;
        for (const o of objects) { const dx = o.x - p.x, dz = o.z - p.z; o.root.visible = dx * dx + dz * dz < o.cull * o.cull; }
      }
    },
  };
  ctx.events.on('gameStart', () => { const f = ctx.state.data.flags; if (!Array.isArray(f.lootOpened)) f.lootOpened = []; api.populate(); });
  ctx.events.on('tide', () => { ctx.state.data.flags.lootOpened = []; api.populate(); });
  return api;
}
