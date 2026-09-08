// Procedural attachments, magazines and loose-item meshes, built from the same parts kit as gunmesh.js: side-profile
// extrusions with bevels for housings and brackets, lathes for tubes, cans and bells, milled Picatinny sections with
// real slots, knurled collars and turrets, merged per material with creased normals. Optics carry tinted glass and an
// emissive reticle so a sight reads as a sight; lights and lasers carry a lens that setLightOn() switches between a
// dead and a glowing shared material (two shared materials per emitter, so nothing is allocated per frame).
//
// MOUNT CONVENTION (read off the gunmesh.js markers; every attachment is authored in its anchor's frame, origin at the
// anchor, +y up, -z toward the muzzle, +x right):
//   mount_top      top face of a Picatinny rail, on the centreline   -> build upward
//   mount_dovetail outer face of the left AK/SVD side rail           -> build outward (-x) and bridge back over the bore (+x)
//   mount_pu       ring seat of a Mosin PU mount (this file makes it)-> build upward
//   mount_muzzle   bore axis at the barrel crown                     -> build forward (-z); userData.length moves the muzzle marker
//   mount_under    bottom rail face                                  -> build downward
//   mount_side     left rail face                                    -> build outward (-x)
//   mount_stock    receiver rear face                                -> build rearward (+z)
//   mount_pad      centre of the butt face (gun.padSpec gives v/w)   -> build rearward (+z)
// userData an attachment may set, all read by gunmesh.applyAttachments: anchor (override), replaces (hides the gun
// furniture with that userData.removable), length (muzzle devices), eye ([x,y,z] eye point in the anchor frame, which
// becomes the ADS pose), pad (anchor on mount_pad instead of mount_stock).
import * as THREE from 'three';
import { ATTACHMENTS, MAGAZINES, ITEMS, AMMO } from '../data/index.js';
import {
  matKit, Parts, side, rect, box, cylZ, cylY, cylX, sphere, ringX, ringY, ringZ, at, latheZ, railZ, knurlZ, hexZ,
  pin, screw, mesh, marker, hi, slantFront, bipodGeos, weathered,
} from './gunmesh.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// gunmesh's rect() is authored in u = -z ("toward the muzzle"). Attachments read better in gun space, so this is the
// same block given as a z range: zrect(zNear, zFar, ...) with zNear < zFar (i.e. front edge first).
const zrect = (z0, z1, v0, v1, w, bevel = 0.0015, ch = 0) => rect(-z1, -z0, v0, v1, w, bevel, ch);

// ---------------------------------------------------------------- emissive materials
let GLOW = null;
function glow() {
  if (GLOW) return GLOW;
  const m = (color, emissive, ei, rough = 0.25, metal = 0.1) => weathered({
    color, roughness: rough, metalness: metal, wear: [0.2, 0.25, 0.1, 0], bare: 0x9a9ea3, seed: 21.3, emissive, emissiveIntensity: ei,
  });
  GLOW = {
    lampOff: m(0x14161a, 0x000000, 0, 0.16, 0.25),
    lampOn: m(0x2a2721, 0xfff2d4, 2.8, 0.16, 0.0),
    laserOff: m(0x1a0b0c, 0x000000, 0, 0.30, 0.20),
    laserOn: m(0x220809, 0xff2a1e, 3.4, 0.30, 0.0),
    irOff: m(0x0d1016, 0x000000, 0, 0.30, 0.20),
    irOn: m(0x101822, 0x3048ff, 1.6, 0.30, 0.0),
    reticle: m(0x1c0503, 0xff3222, 1.9, 0.50, 0.0),
    amber: m(0x1d1305, 0xffa63c, 1.7, 0.50, 0.0),
    nv: m(0x0b1610, 0x3ad068, 1.5, 0.45, 0.0),
  };
  return GLOW;
}
// A collimator combiner is a coated window you shoot through, not a scope's dark objective: keep it mostly clear.
let COMBINER = null;
function combiner() {
  if (!COMBINER) {
    COMBINER = new THREE.MeshStandardMaterial({ color: 0x33454f, roughness: 0.08, metalness: 0.45, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    COMBINER.userData.shared = true;
  }
  return COMBINER;
}
// mark a mesh as a switchable emitter: kind 'light' | 'laser' | 'ir'
function emitter(m, kind, offMat, onMat) {
  m.userData.emitter = kind; m.userData.offMat = offMat; m.userData.onMat = onMat;
  return m;
}
function switchEmitters(root, on, kinds) {
  if (!root || !root.traverse) return;
  root.traverse((o) => {
    const k = o.userData && o.userData.emitter;
    if (!k || !o.isMesh || kinds.indexOf(k) < 0) return;
    o.material = on ? o.userData.onMat : o.userData.offMat;
  });
}
// Public: switch every lamp and laser emitter under a mesh, an attachment group or a whole weapon.
export function setLightOn(mesh, on) { switchEmitters(mesh, on, ['light', 'laser', 'ir']); }
function setLaserOn(m, on) { switchEmitters(m, on, ['laser', 'ir']); }

// Install the dispatchers weapons.js calls (weaponMesh.userData.setLightOn / setLaserOn) onto the gun's userData.
// gun.installed is a fresh array per applyAttachments() pass, so its identity is the generation stamp and a closure
// left over from a previous loadout does nothing.
function registerEmitters(gun, att) {
  if (!gun) return;
  // A standalone buildAttachment() has no ud.installed to stamp against, so an absent list means a fresh generation too.
  if (!gun._emitters || gun._emitGen !== gun.installed) { gun._emitGen = gun.installed; gun._emitters = []; }
  gun._emitters.push(att);
  const gen = gun.installed;
  gun.setLightOn = (on) => { if (gun._emitGen !== gen) return; for (const a of gun._emitters) setLightOn(a, on); };
  gun.setLaserOn = (on) => { if (gun._emitGen !== gen) return; for (const a of gun._emitters) setLaserOn(a, on); };
}

// ---------------------------------------------------------------- shared components
const K = (opts) => matKit({ world: !!opts.world, wear: opts.wear || 0 });

// Clamp straddling a Picatinny rail from above: body, two side jaws leaving the rail teeth visible, cross bolts.
function railClamp(P, M, len, zc = 0, w = 0.026, top = 0.010) {
  P.add(M.painted, at(zrect(-len / 2, len / 2, 0, top, w, 0.0012, 0.0022), 0, 0, zc));
  for (const sx of [-1, 1]) P.add(M.painted, at(zrect(-len / 2 + 0.002, len / 2 - 0.002, -0.0078, 0.0006, 0.0038, 0.001), sx * 0.0126, 0, zc));
  if (!hi()) return;
  for (const z of [zc - len / 2 + 0.009, zc + len / 2 - 0.009]) {
    P.add(M.steel, pin(0.014, -0.0036, z, 0.0016, 0.008));
    P.add(M.gunmetal, at(knurlZ(0.0056, 0.0034, 10), 0.0182, -0.0036, z, 0, Math.PI / 2));
  }
}
// The same, hanging under a rail (mount_under builds downward).
function railClampDown(P, M, len, w = 0.026, depth = 0.010) {
  P.add(M.painted, at(zrect(-len / 2, len / 2, -depth, 0, w, 0.0012, 0.0022), 0, 0, 0));
  for (const sx of [-1, 1]) P.add(M.painted, at(zrect(-len / 2 + 0.002, len / 2 - 0.002, -0.0006, 0.0078, 0.0038, 0.001), sx * 0.0126, 0, 0));
  if (!hi()) return;
  for (const z of [-len / 2 + 0.009, len / 2 - 0.009]) {
    P.add(M.steel, pin(0.014, 0.0036, z, 0.0016, 0.008));
    P.add(M.gunmetal, at(knurlZ(0.0056, 0.0034, 10), 0.0182, 0.0036, z, 0, Math.PI / 2));
  }
}
// A clamp on a left-side rail (mount_side builds toward -x): plate on the rail face, jaws above and below, thumb screws.
function railClampSide(P, M, len, h = 0.026, out = 0.010) {
  P.add(M.painted, at(zrect(-len / 2, len / 2, -h / 2, h / 2, out * 2, 0.0012, 0.002), -out, 0, 0));
  for (const sy of [-1, 1]) P.add(M.painted, at(zrect(-len / 2 + 0.002, len / 2 - 0.002, -0.0019, 0.0019, 0.0156, 0.001), 0.0068, sy * 0.0126, 0));
  if (!hi()) return;
  for (const z of [-len / 2 + 0.009, len / 2 - 0.009]) {
    P.add(M.steel, at(cylY(0.0016, 0.0016, 0.010, 6), -out, -0.016, z));
    P.add(M.gunmetal, at(knurlZ(0.0054, 0.0032, 10), -out, -0.020, z, Math.PI / 2));
  }
}
// Soviet side-rail bracket: base clamped on the dovetail, locking lever, riser and a saddle whose top is at saddleY,
// bridged across to the bore centreline at dx.
function sideBracket(P, M, dx, saddleY, len = 0.09) {
  const zb = len / 2;
  P.add(M.painted, at(zrect(-zb, zb, -0.011, 0.014, 0.014, 0.0012, 0.0025), -0.008, 0, 0));                 // base block over the rail
  P.add(M.painted, at(zrect(-zb + 0.004, zb - 0.004, -0.006, 0.010, 0.006, 0.001), 0.0015, 0, 0));           // tongue in the dovetail
  P.add(M.painted, at(zrect(-0.028, 0.028, 0.012, saddleY - 0.005, 0.011, 0.0012, 0.003), -0.006, 0, 0));    // riser plate
  P.add(M.painted, at(zrect(-0.030, 0.030, saddleY - 0.010, saddleY, Math.abs(dx) + 0.026, 0.0012, 0.002), dx / 2 - 0.004, 0, 0));  // bridge
  if (!hi()) return;
  P.add(M.gunmetal, at(box(0.008, 0.020, 0.030), -0.017, 0.002, zb - 0.014));                                // locking lever
  P.add(M.steel, pin(-0.014, 0.002, zb - 0.014, 0.0028, 0.012));
  P.addAll(M.gunmetal, screw(-0.0125, 0.006, -zb + 0.014, 0.003, 'x'));
  P.add(M.gunmetal, at(box(0.010, 0.012, 0.010), -0.016, -0.008, -zb + 0.022));                              // detent spring housing
}
// Split scope rings on a rail: pillar with rail jaws, ring band, ring cap and its screws.
function scopeRings(P, M, dx, axis, r, zs) {
  for (const z of zs) {
    P.add(M.painted, at(zrect(-0.011, 0.011, 0, axis - r + 0.003, 0.020, 0.0012, 0.002), dx, 0, z));
    for (const sx of [-1, 1]) P.add(M.painted, at(zrect(-0.010, 0.010, -0.0078, 0.0006, 0.0038, 0.001), dx + sx * 0.0126, 0, z));
    P.add(M.painted, at(ringZ(r + 0.0035, 0.0038, 0, Math.PI * 2, hi() ? 14 : 8, 4), dx, axis, z));
    P.add(M.painted, at(box(0.020, 0.006, 0.020), dx, axis + r + 0.004, z));
    if (hi()) { P.addAll(M.gunmetal, screw(dx + 0.007, axis + r + 0.0072, z, 0.0022, 'y')); P.addAll(M.gunmetal, screw(dx - 0.007, axis + r + 0.0072, z, 0.0022, 'y')); }
  }
}
// An adjustment turret. kind: small | drum | target | cap | pu. horiz = lying on its side (windage).
function turret(P, M, x, y, z, kind, horiz = false) {
  const R = kind === 'drum' ? 0.0115 : kind === 'target' ? 0.010 : kind === 'pu' ? 0.0105 : 0.0075;
  const H = kind === 'drum' ? 0.020 : kind === 'target' ? 0.024 : kind === 'pu' ? 0.016 : 0.010;
  const teeth = hi() ? 16 : 8;
  if (horiz) {
    P.add(M.gunmetal, at(cylX(R + 0.0035, R + 0.0035, 0.005, hi() ? 12 : 6), x + 0.0025, y, z));
    P.add(M.gunmetal, at(knurlZ(R, H, teeth), x + 0.005 + H / 2, y, z, 0, Math.PI / 2));
    if (hi()) P.add(M.bore, at(box(0.004, R * 2.1, 0.0016), x + 0.006 + H, y, z));
  } else {
    P.add(M.gunmetal, at(cylY(R + 0.0035, R + 0.0035, 0.005, hi() ? 12 : 6), x, y + 0.0025, z));
    P.add(M.gunmetal, at(knurlZ(R, H, teeth), x, y + 0.005 + H / 2, z, Math.PI / 2));
    if (hi()) { P.add(M.bore, at(box(0.0016, 0.004, R * 2.1), x, y + 0.006 + H, z)); P.add(M.bore, at(box(R * 2.1, 0.0022, 0.0016), x, y + 0.005 + H * 0.55, z)); }
  }
}
// Tinted glass disc facing down the tube; the opaque reticle sits behind it.
function glassDisc(g, M, r, x, y, z, mat) {
  const m = mesh([cylZ(r, r, 0.0012, hi() ? 20 : 10)], mat || M.glass, 'glass');
  m.position.set(x, y, z); m.renderOrder = 2;
  g.add(m);
  return m;
}
// Emissive reticle in the focal plane. kind: dot | holo | chevron | pso | pu | acog | mildot
function reticleMesh(kind, r, mat) {
  const t = clamp(r * 0.055, 0.0006, 0.0016), d = 0.0008, geos = [];
  const bar = (w, h, x, y, rz = 0) => at(box(w, h, d), x, y, 0, 0, 0, rz);
  if (kind === 'dot') geos.push(at(cylZ(t * 1.5, t * 1.5, d, 10), 0, 0, 0));
  else if (kind === 'holo') {
    geos.push(at(ringZ(r * 0.6, t * 0.75, 0, Math.PI * 2, hi() ? 22 : 12, 4), 0, 0, 0));
    geos.push(at(cylZ(t * 1.3, t * 1.3, d, 10), 0, 0, 0));
  } else if (kind === 'chevron' || kind === 'acog') {
    const L = r * 0.44;
    geos.push(bar(L, t, -L * 0.35, L * 0.3, -0.7), bar(L, t, L * 0.35, L * 0.3, 0.7));
    geos.push(bar(t, r * 0.5, 0, -r * 0.42));
    if (kind === 'acog') geos.push(bar(r * 0.5, t, -r * 0.62, -r * 0.12), bar(r * 0.5, t, r * 0.62, -r * 0.12));
  } else if (kind === 'pso') {
    const L = r * 0.36;
    geos.push(bar(L, t, -L * 0.35, L * 0.18, -0.75), bar(L, t, L * 0.35, L * 0.18, 0.75));
    geos.push(bar(r * 1.1, t, -r * 0.18, -r * 0.02));
    for (let i = 0; i < 3; i++) geos.push(bar(t, r * 0.14, -r * (0.30 + i * 0.22), -r * 0.10));
    for (let i = 0; i < 4; i++) geos.push(bar(t * 0.9, r * (0.10 + i * 0.05), r * (0.22 + i * 0.13), r * (0.22 + i * 0.05)));
  } else if (kind === 'pu') {
    geos.push(bar(t * 1.4, r * 0.6, 0, -r * 0.36));
    geos.push(bar(r * 0.55, t * 1.2, -r * 0.52, 0), bar(r * 0.55, t * 1.2, r * 0.52, 0));
  } else {
    geos.push(bar(r * 1.5, t, 0, 0), bar(t, r * 1.5, 0, 0));
    for (let i = 1; i <= 3; i++) for (const s of [-1, 1]) {
      geos.push(at(cylZ(t * 1.1, t * 1.1, d, 6), s * r * 0.22 * i, 0, 0));
      geos.push(at(cylZ(t * 1.1, t * 1.1, d, 6), 0, s * r * 0.22 * i, 0));
    }
  }
  const m = mesh(geos, mat, 'reticle');
  m.renderOrder = 1;
  return m;
}

// ---------------------------------------------------------------- optics
// body: tube | collimator | holo | acog | nspu. axis = optical axis above the anchor; relief = eye behind the eyepiece.
const OPTICS = {
  opt_okp7: { body: 'collimator', len: 0.088, r: 0.021, axis: 0.048, relief: 0.205, ret: 'dot' },
  opt_kobra: { body: 'collimator', len: 0.096, r: 0.026, axis: 0.058, relief: 0.205, ret: 'chevron', dial: true },
  opt_pka: { body: 'tube', len: 0.112, r: 0.0195, obj: 0, eye: 0.021, axis: 0.056, relief: 0.200, ret: 'dot', turret: 'small' },
  opt_1p78: { body: 'tube', len: 0.138, r: 0.0195, obj: 0.024, eye: 0.022, axis: 0.058, relief: 0.185, ret: 'chevron', turret: 'small', hood: 0.020 },
  opt_pso1: { body: 'tube', len: 0.190, r: 0.020, obj: 0.028, eye: 0.024, axis: 0.062, relief: 0.180, ret: 'pso', turret: 'drum', battery: true, hood: 0.030 },
  opt_1p29: { body: 'tube', len: 0.172, r: 0.0205, obj: 0.025, eye: 0.024, axis: 0.062, relief: 0.182, ret: 'chevron', turret: 'drum', hood: 0.025 },
  opt_pu: { body: 'tube', len: 0.169, r: 0.0135, obj: 0.0155, eye: 0.017, axis: 0.022, relief: 0.180, ret: 'pu', turret: 'pu', rings: true },
  opt_t1: { body: 'tube', len: 0.064, r: 0.0165, obj: 0, eye: 0.0165, axis: 0.034, relief: 0.205, ret: 'dot', turret: 'cap' },
  opt_eotech: { body: 'holo', len: 0.106, r: 0.026, axis: 0.037, relief: 0.205, ret: 'holo' },
  opt_valday: { body: 'holo', len: 0.098, r: 0.025, axis: 0.036, relief: 0.205, ret: 'holo' },
  opt_acog: { body: 'acog', len: 0.106, r: 0.019, obj: 0.0195, eye: 0.021, axis: 0.038, relief: 0.180, ret: 'acog' },
  opt_specter: { body: 'acog', len: 0.126, r: 0.021, obj: 0.022, eye: 0.023, axis: 0.041, relief: 0.182, ret: 'chevron', lever: true },
  opt_mark4: { body: 'tube', len: 0.252, r: 0.0195, obj: 0.031, eye: 0.023, axis: 0.046, relief: 0.185, ret: 'mildot', turret: 'target', rings: true },
  opt_nspu: { body: 'nspu', len: 0.212, r: 0.036, obj: 0.040, eye: 0.026, axis: 0.070, relief: 0.175, ret: 'chevron', nv: true },
};
// A dovetail anchor sits on the left rail face; this is how far in +x the bore centreline is, by weapon family.
const DOVETAIL_DX = { mosin: 0.016, mg: 0.0235, rifle: 0.0215, vss: 0.0205, svd: 0.0205, ak: 0.021, smg: 0.021 };
// A sensible optic for an id the table does not know: a red dot at or under 1.2x, otherwise a tube scope sized by zoom.
function opticSpec(id, def) {
  const s = OPTICS[id];
  if (s) return s;
  const z = (def.effects && def.effects.zoom) || 1;
  const ret = (def.effects && def.effects.reticle) || (z > 1.2 ? 'mildot' : 'dot');
  if (z <= 1.2) return { body: 'tube', len: 0.075, r: 0.018, obj: 0, eye: 0.018, axis: 0.036, relief: 0.205, ret, turret: 'cap' };
  const len = clamp(0.09 + z * 0.019, 0.11, 0.26);
  return { body: 'tube', len, r: 0.0195, obj: 0.020 + z * 0.0013, eye: 0.023, axis: 0.046, relief: 0.185, ret, turret: 'drum', hood: 0.020 };
}
function buildOptic(id, def, M, opts) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const s = opticSpec(id, def);
  const dove = def.fits.indexOf('dovetail') >= 0;
  const gun = opts.gun || {};
  const dx = dove ? (DOVETAIL_DX[gun.family] || 0.021) : 0;
  const axis = s.axis, r = s.r, half = s.len / 2;
  const zR = half, zF = -half;                                        // rear (toward the shooter) and front of the body
  const retMat = s.ret === 'acog' ? glow().amber : s.nv ? glow().nv : glow().reticle;

  if (s.body === 'tube') {
    const eyeR = s.eye || r, objR = s.obj || 0;
    // one lathe for the whole tube so the machined steps stay crisp: eyepiece bell, waist, turret saddle, objective bell
    const prof = [[eyeR, 0], [eyeR, 0.020], [r + 0.001, 0.026], [r, 0.030], [r, half - 0.012], [r + 0.0025, half - 0.008], [r + 0.0025, half + 0.010], [r, half + 0.014]];
    if (objR > r) prof.push([r, s.len - 0.052], [objR - 0.002, s.len - 0.044], [objR, s.len - 0.036], [objR, s.len - 0.004], [objR - 0.003, s.len]);
    else prof.push([r, s.len - 0.006], [r - 0.002, s.len]);
    P.add(M.anodised, at(latheZ(prof), dx, axis, zR));
    P.add(M.rubber, at(latheZ([[eyeR + 0.0025, -0.008], [eyeR + 0.004, -0.004], [eyeR + 0.004, 0.006], [eyeR + 0.0005, 0.010]]), dx, axis, zR + 0.008));
    if (hi() && s.len > 0.10) P.add(M.gunmetal, at(knurlZ(eyeR + 0.0015, 0.008, 14), dx, axis, zR - 0.016));   // dioptre ring
    if (s.hood) P.add(M.painted, at(latheZ([[objR || r, 0], [(objR || r) + 0.0018, 0.003], [(objR || r) + 0.0018, s.hood], [(objR || r) - 0.001, s.hood]]), dx, axis, zF + 0.002));
    if (s.turret) {
      P.add(M.anodised, at(cylX(r + 0.0015, r + 0.0015, 0.008, hi() ? 14 : 8), dx, axis, zR - 0.052));        // turret boss
      turret(P, M, dx, axis + r - 0.001, zR - 0.052, s.turret);
      turret(P, M, dx + r - 0.001, axis, zR - 0.052, s.turret === 'drum' ? 'small' : s.turret, true);
    }
    if (s.battery) {
      P.add(M.painted, at(zrect(-0.016, 0.016, -0.013, 0.013, 0.016, 0.001, 0.003), dx - r - 0.008, axis, zR - 0.048));
      if (hi()) P.add(M.gunmetal, at(knurlZ(0.008, 0.006, 12), dx - r - 0.017, axis, zR - 0.048, 0, Math.PI / 2));
    }
    if (s.rings) scopeRings(P, M, dx, axis, r, [zR - 0.040, zF + 0.052]);
    else if (dove) sideBracket(P, M, dx, axis - r + 0.004, 0.094);
    else {
      railClamp(P, M, 0.062);
      P.add(M.painted, at(zrect(-0.026, 0.026, 0.008, axis - r + 0.004, 0.024, 0.0012, 0.003), dx, 0, 0));
      for (const z of [-0.014, 0.020]) P.add(M.painted, at(ringZ(r + 0.004, 0.004, 0, Math.PI * 2, hi() ? 16 : 8, 5), dx, axis, z));
    }
    P.into(g, 'optic');
    glassDisc(g, M, (objR || r) - 0.002, dx, axis, zF + 0.003);
    glassDisc(g, M, eyeR - 0.002, dx, axis, zR - 0.004);
    const ret = reticleMesh(s.ret, (objR || r) * 0.75, retMat); ret.position.set(dx, axis, zF + 0.030); g.add(ret);
  } else if (s.body === 'collimator') {
    // OKP-7 / Kobra: an open box collimator - deck, hood roof and two side walls, so the window really is a window.
    const hw = s.r, y0 = axis - hw, y1 = axis + hw, wx = 0.0215;
    P.add(M.painted, at(zrect(zF, zR, y0, y0 + 0.010, 0.050, 0.0018, 0.003), dx, 0, 0));                        // electronics deck
    P.add(M.painted, at(zrect(zF, zR - 0.012, y1 - 0.007, y1, 0.050, 0.0018, 0.003), dx, 0, 0));                // hood roof
    for (const sx of [-1, 1]) P.add(M.painted, at(zrect(zF, zR, y0 + 0.007, y1, 0.007, 0.0015, 0.002), dx + sx * wx, 0, 0));
    P.add(M.painted, at(zrect(zR - 0.012, zR, y1 - 0.012, y1, 0.050, 0.0015, 0.002), dx, 0, 0));                // rear roof frame
    if (hi()) {
      if (s.dial) P.add(M.gunmetal, at(knurlZ(0.008, 0.007, 12), dx - wx - 0.010, axis + 0.006, zR - 0.026, 0, Math.PI / 2));
      P.add(M.gunmetal, at(cylX(0.010, 0.010, 0.010, 10), dx + wx + 0.008, axis - 0.006, zR - 0.026));          // battery cap
      for (let i = 0; i < 3; i++) P.add(M.painted, at(box(0.052, 0.0022, 0.003), dx, y1 - 0.001, zR - 0.026 - i * 0.013));
      turret(P, M, dx, y1 - 0.002, zF + 0.020, 'cap');
      P.add(M.bore, at(box(0.030, 0.0025, 0.004), dx, y0 + 0.010, zR - 0.014));
    }
    sideBracket(P, M, dx, y0 + 0.004, 0.086);
    P.into(g, 'optic');
    const gl = glassDisc(g, M, hw * 0.62, dx, axis, zF + 0.024, combiner()); gl.rotation.x = 0.22;
    const ret = reticleMesh(s.ret, hw * 0.52, retMat); ret.position.set(dx, axis, zF + 0.027); g.add(ret);
  } else if (s.body === 'holo') {
    // EOTech / Valday: hood walls around an open rectangular window, battery pod on the left, buttons behind it.
    const y0 = 0.010, yt = axis + 0.017, wx = 0.025;
    P.add(M.painted, at(zrect(zF, zR, y0, y0 + 0.009, 0.058, 0.0015, 0.002), 0, 0, 0));                        // chassis
    for (const sx of [-1, 1]) P.add(M.painted, at(zrect(zF + 0.002, zR - 0.004, y0 + 0.007, yt, 0.008, 0.0015, 0.002), sx * wx, 0, 0));
    P.add(M.painted, at(zrect(zF + 0.002, zR - 0.004, yt - 0.006, yt, 0.058, 0.0015, 0.002), 0, 0, 0));        // hood roof
    P.add(M.painted, at(zrect(zR - 0.022, zR + 0.002, yt - 0.010, yt + 0.005, 0.058, 0.0015, 0.003), 0, 0, 0)); // raised rear hood
    P.add(M.painted, at(zrect(zR - 0.042, zR + 0.002, y0 + 0.006, axis + 0.010, 0.016, 0.0018, 0.004), -0.033, 0, 0));   // battery pod, clear of the window
    if (hi()) {
      for (let i = 0; i < 2; i++) P.add(M.gunmetal, at(box(0.008, 0.008, 0.010), -0.030, axis - 0.008, zR - 0.050 + i * 0.014));
      P.add(M.gunmetal, at(knurlZ(0.007, 0.006, 10), -0.033, axis + 0.012, zR - 0.020, Math.PI / 2));
      P.add(M.bore, at(box(0.040, 0.0025, 0.004), 0, y0 + 0.0095, zF + 0.020));
      turret(P, M, 0.020, yt - 0.001, zR - 0.026, 'cap');
    }
    railClamp(P, M, 0.058);
    P.add(M.painted, at(zrect(-0.026, 0.026, 0.008, y0 + 0.002, 0.030, 0.001, 0.002), 0, 0, 0));
    P.into(g, 'optic');
    const wg = mesh([box(0.034, 0.026, 0.0012)], combiner(), 'glass'); wg.position.set(0, axis, zF + 0.024); wg.rotation.x = 0.12; wg.renderOrder = 2; g.add(wg);
    const ret = reticleMesh(s.ret, 0.013, retMat); ret.position.set(0, axis, zF + 0.027); g.add(ret);
  } else if (s.body === 'acog') {
    // Cast, tapered body on a squared base with a fibre-optic channel along the top.
    const eyeR = s.eye, objR = s.obj;
    P.add(M.anodised, at(latheZ([[eyeR, 0], [eyeR, 0.014], [eyeR - 0.004, 0.020], [r - 0.003, 0.030], [r - 0.004, s.len * 0.55], [r - 0.001, s.len * 0.72], [objR, s.len - 0.020], [objR, s.len - 0.003], [objR - 0.003, s.len]]), 0, axis, zR));
    P.add(M.anodised, at(zrect(-0.026, 0.030, 0.006, axis - 0.004, 0.030, 0.0015, 0.003), 0, 0, 0));           // base block
    P.add(M.rubber, at(latheZ([[eyeR + 0.003, -0.010], [eyeR + 0.005, -0.005], [eyeR + 0.005, 0.006], [eyeR + 0.001, 0.010]]), 0, axis, zR + 0.010));
    if (hi()) {
      P.add(M.orange, at(zrect(-0.030, 0.024, axis + r - 0.008, axis + r - 0.003, 0.006, 0.0008), 0, 0, 0));   // fibre optic
      turret(P, M, 0, axis + r - 0.006, zR - 0.030, 'cap');
      turret(P, M, r - 0.006, axis, zR - 0.030, 'cap', true);
      if (s.lever) { P.add(M.gunmetal, at(box(0.006, 0.030, 0.010), -r - 0.004, axis + 0.006, zR - 0.052)); P.add(M.steel, pin(-r, axis + 0.006, zR - 0.052, 0.003, 0.008)); }
    }
    railClamp(P, M, 0.056);
    P.into(g, 'optic');
    glassDisc(g, M, objR - 0.003, 0, axis, zF + 0.004);
    glassDisc(g, M, eyeR - 0.003, 0, axis, zR - 0.003);
    const ret = reticleMesh(s.ret, objR * 0.7, retMat); ret.position.set(0, axis, zF + 0.026); g.add(ret);
  } else {
    // NSPU: image intensifier. Fat body, big objective bell, rubber eyecup, battery box slung underneath.
    const eyeR = s.eye, objR = s.obj;
    P.add(M.painted, at(latheZ([[eyeR, 0], [eyeR, 0.016], [r - 0.006, 0.024], [r, 0.034], [r, s.len - 0.070], [objR, s.len - 0.056], [objR, s.len - 0.006], [objR - 0.004, s.len]]), dx, axis, zR));
    P.add(M.rubber, at(latheZ([[eyeR + 0.006, -0.024], [eyeR + 0.010, -0.016], [eyeR + 0.008, -0.002], [eyeR + 0.002, 0.008]]), dx, axis, zR + 0.024));
    P.add(M.painted, at(zrect(-0.050, 0.020, axis - r - 0.028, axis - r + 0.002, 0.040, 0.0018, 0.004), dx, 0, 0));   // battery box
    if (hi()) {
      P.add(M.gunmetal, at(knurlZ(0.009, 0.010, 12), dx - 0.020, axis - r - 0.014, zR - 0.040, 0, Math.PI / 2));
      P.add(M.gunmetal, at(box(0.010, 0.014, 0.012), dx + 0.020, axis + 0.004, zR - 0.030));
      for (let i = 0; i < 5; i++) P.add(M.painted, at(ringZ(objR + 0.0012, 0.0012, 0, Math.PI * 2, 14, 4), dx, axis, zF + 0.010 + i * 0.009));
    }
    sideBracket(P, M, dx, axis - r + 0.006, 0.100);
    P.into(g, 'optic');
    glassDisc(g, M, objR - 0.004, dx, axis, zF + 0.005);
    const scr = mesh([cylZ(eyeR - 0.003, eyeR - 0.003, 0.0012, hi() ? 18 : 10)], glow().nv, 'screen');
    scr.position.set(dx, axis, zR - 0.006); g.add(scr);
    const ret = reticleMesh(s.ret, eyeR * 0.7, retMat); ret.position.set(dx, axis, zR - 0.010); g.add(ret);
  }
  const eyeZ = zR + (s.body === 'tube' || s.body === 'acog' || s.body === 'nspu' ? 0.010 : 0) + s.relief;
  g.userData.eye = [dx, axis, eyeZ];
  g.add(marker('opticEye', dx, axis, eyeZ));
  return g;
}

// ---------------------------------------------------------------- muzzle devices
// kind: can (suppressor) | brake | comp | hider. Everything grows forward (-z) from the crown at z = 0.
const MUZZLES = {
  muz_pbs1: { kind: 'can', len: 0.200, r: 0.0235, collar: 0.026, ribs: 3 },
  muz_pbs4: { kind: 'can', len: 0.190, r: 0.0245, collar: 0.027, ribs: 2 },
  muz_rotor43: { kind: 'can', len: 0.172, r: 0.0215, collar: 0.024, step: true },
  muz_ar_sup: { kind: 'can', len: 0.178, r: 0.0195, collar: 0.023, flutes: 10 },
  muz_sv98_sup: { kind: 'can', len: 0.245, r: 0.0265, collar: 0.029, ribs: 4 },
  muz_dtk1: { kind: 'brake', len: 0.062, r: 0.0145, ports: 3 },
  muz_comp556: { kind: 'comp', len: 0.056, r: 0.0135, ports: 4 },
  muz_flash: { kind: 'hider', len: 0.052, r: 0.0125, prongs: 4 },
};
function buildMuzzle(id, def, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const quiet = def.effects && def.effects.noise != null && def.effects.noise < 0.8;
  const s = MUZZLES[id] || (quiet ? { kind: 'can', len: 0.18, r: 0.021, collar: 0.024, ribs: 2 } : { kind: 'brake', len: 0.06, r: 0.014, ports: 3 });
  const r = s.r, L = s.len, bore = clamp(r * 0.34, 0.0035, 0.007);
  if (s.kind === 'can') {
    const c = s.collar;
    P.add(M.steelDark, at(latheZ([[c - 0.004, 0], [c, 0.006], [c, 0.026], [r, 0.034], [r, L - 0.006], [r - 0.001, L + 0.002], [r - 0.004, L + 0.010], [r - 0.006, L + 0.012]]), 0, 0, 0.012));
    if (hi()) {
      P.add(M.gunmetal, at(knurlZ(c + 0.0015, 0.020, 22), 0, 0, 0.002));                                        // knurled mounting collar
      for (let i = 0; i < (s.ribs || 0); i++) P.add(M.gunmetal, at(ringZ(r + 0.0012, 0.0016, 0, Math.PI * 2, 16, 5), 0, 0, -0.050 - i * 0.038));
      if (s.flutes) for (let i = 0; i < s.flutes; i++) {
        const a = i / s.flutes * Math.PI * 2;
        P.add(M.bore, at(box(0.0038, 0.0024, L - 0.078), Math.cos(a) * r * 0.995, Math.sin(a) * r * 0.995, -(0.052 + (L - 0.078) / 2), 0, 0, a - Math.PI / 2));
      }
      if (s.step) {
        P.add(M.gunmetal, at(hexZ(r + 0.0018, 0.016), 0, 0, -L * 0.58));
        P.add(M.gunmetal, at(latheZ([[r, 0], [r + 0.002, 0.004], [r + 0.002, 0.014], [r, 0.018]]), 0, 0, -L + 0.034));
      }
      P.add(M.gunmetal, at(box(0.006, 0.006, 0.014), 0, r + 0.001, -0.030));                                    // gas-seal latch
    }
    P.add(M.bore, at(latheZ([[bore, 0], [bore, 0.016], [r - 0.007, 0.016]]), 0, 0, -L + 0.014));                 // the bore, seen down the front
  } else if (s.kind === 'brake') {
    // DTK-1: a chamber with ports cut through both sides, a slanted crown and a locking collar
    P.add(M.gunmetal, at(latheZ([[r - 0.003, 0], [r, 0.006], [r, L - 0.006], [r - 0.001, L], [r - 0.004, L + 0.004]]), 0, 0, 0.004));
    P.add(M.bore, at(cylZ(bore, bore, L, 10), 0, 0, -L / 2));
    for (let i = 0; i < (s.ports || 3); i++) {
      const z = -0.020 - i * 0.013;
      P.add(M.bore, at(box(r * 2.4, 0.0075, 0.0085), 0, 0.001, z));
      if (hi()) P.add(M.gunmetal, at(box(0.0028, r * 2, 0.0085), 0, 0, z));                                     // the divider left in the middle
    }
    if (hi()) { P.add(M.gunmetal, at(knurlZ(r + 0.0015, 0.008, 16), 0, 0, -0.004)); P.add(M.gunmetal, slantFront(at(cylZ(r, r, 0.010), 0, 0, -L + 0.003), -L + 0.001, 0.45)); }
  } else if (s.kind === 'comp') {
    P.add(M.steel, at(latheZ([[r - 0.002, 0], [r, 0.005], [r, L - 0.002], [r - 0.003, L + 0.004]]), 0, 0, 0.004));
    P.add(M.bore, at(cylZ(bore, bore, L, 10), 0, 0, -L / 2));
    for (let i = 0; i < (s.ports || 4); i++) {
      P.add(M.bore, at(box(0.006, r * 2.2, 0.005), 0, 0.002, -0.014 - i * 0.010));
      if (hi()) P.add(M.bore, at(box(r * 2.2, 0.005, 0.005), 0, 0.001, -0.014 - i * 0.010));
    }
    if (hi()) P.add(M.gunmetal, at(knurlZ(r + 0.001, 0.007, 14), 0, 0, -0.003));
  } else {
    // A2-style hider: a cone with prongs, slots cut top and sides, closed underneath
    P.add(M.gunmetal, at(latheZ([[r - 0.003, 0], [r - 0.001, 0.006], [r - 0.001, 0.014], [r, 0.018], [r, L + 0.001], [r - 0.004, L + 0.003]]), 0, 0, 0.003));
    P.add(M.bore, at(cylZ(bore * 1.3, bore * 1.3, L, 10), 0, 0, -L / 2));
    const n = s.prongs || 4;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i - (n - 1) / 2) * (Math.PI * 0.42);
      P.add(M.bore, at(box(0.0035, 0.010, L * 0.62), Math.cos(a) * r, Math.sin(a) * r, -L * 0.66, 0, 0, a - Math.PI / 2));
    }
    if (hi()) P.add(M.gunmetal, at(knurlZ(r + 0.001, 0.006, 12), 0, 0, -0.002));
  }
  P.into(g, 'muzzledev');
  g.userData.length = L;
  return g;
}

// ---------------------------------------------------------------- underbarrel grips and the bipod
function buildGrip(id, def, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  if (id === 'grip_afg') {
    // AFG: a low ramp with a thumb shelf, dropping toward the muzzle
    railClampDown(P, M, 0.070, 0.030, 0.008);
    P.add(M.polymerGrip, side([[0.052, -0.010], [0.050, -0.020], ['q', 0.040, -0.030, 0.018, -0.033], [-0.030, -0.033], ['q', -0.044, -0.032, -0.044, -0.022], [-0.042, -0.008]], 0.036, 0.0028));
    if (hi()) {
      for (let i = 0; i < 5; i++) P.add(M.polymerGrip, at(box(0.037, 0.0032, 0.004), 0, -0.030, -0.030 + i * 0.016));
      P.add(M.polymerGrip, at(zrect(-0.010, 0.036, -0.024, -0.012, 0.042, 0.0015, 0.002), 0, 0, 0));            // thumb shelf
    }
  } else if (id === 'grip_vert') {
    // straight vertical grip: a ribbed column with a screw-off base cap
    railClampDown(P, M, 0.044, 0.028, 0.008);
    P.add(M.polymerGrip, at(latheZ([[0.0165, 0], [0.0175, 0.006], [0.0155, 0.040], [0.0158, 0.070], [0.0175, 0.082], [0.0175, 0.090], [0.014, 0.094]], hi() ? 14 : 8), 0, -0.008, 0, -Math.PI / 2));
    if (hi()) {
      for (let i = 0; i < 6; i++) P.add(M.polymerGrip, at(ringY(0.0168, 0.0016, 12, 4), 0, -0.026 - i * 0.010, 0));
      P.add(M.gunmetal, at(knurlZ(0.0142, 0.006, 14), 0, -0.100, 0, Math.PI / 2));                              // battery cap
    }
  } else if (id === 'bipod') {
    // Harris pattern: hinge block on the rail, legs folded along the barrel, plus a deployed pose
    const H = new Parts();
    H.add(M.painted, at(zrect(-0.020, 0.020, -0.020, 0.000, 0.030, 0.0015, 0.003), 0, 0, 0));
    if (hi()) { H.add(M.steel, pin(0, -0.014, 0, 0.0035, 0.036)); H.add(M.gunmetal, at(knurlZ(0.007, 0.008, 12), 0, -0.014, 0.018)); }
    railClampDown(H, M, 0.052, 0.028, 0.008);
    H.into(g, 'bipod');
    const folded = new THREE.Group(); folded.name = 'bipodFolded';
    bipodGeos(M, 0, -0.016, { legLen: 0.185, spread: 0.017, folded: true }).into(folded, 'bipod');
    const open = new THREE.Group(); open.name = 'bipodOpen'; open.visible = false;
    bipodGeos(M, 0, -0.016, { legLen: 0.185, spread: 0.017, folded: false }).into(open, 'bipod');
    g.add(folded); g.add(open);
    g.userData.setDeployed = (on) => { folded.visible = !on; open.visible = !!on; };
    return g;
  } else {
    // RK-1 pattern: a squat grip raked forward, flared at the toe, finger swells on the front
    railClampDown(P, M, 0.048, 0.028, 0.008);
    P.add(M.polymerGrip, side([[0.030, -0.008], [0.034, -0.024], ['q', 0.036, -0.048, 0.024, -0.058], [-0.008, -0.062], ['q', -0.022, -0.060, -0.024, -0.046], [-0.026, -0.008]], 0.034, 0.0028));
    P.add(M.polymerGrip, side([[0.030, -0.056], [0.030, -0.066], [-0.020, -0.068], [-0.020, -0.056]], 0.040, 0.002));
    if (hi()) {
      for (let i = 0; i < 3; i++) P.add(M.polymerGrip, at(cylX(0.0042, 0.0042, 0.030, 8), 0, -0.024 - i * 0.013, -0.024 - i * 0.002));
      P.addAll(M.gunmetal, screw(0, -0.066, 0.004, 0.003, 'y'));
    }
  }
  P.into(g, 'grip');
  return g;
}

// ---------------------------------------------------------------- lights and lasers
// A torch body: bezel, tube, reflector cone and a switchable lens, all at (0, yc) pointing forward.
function torchBody(P, M, xc, yc, R, len) {
  P.add(M.painted, at(latheZ([[R - 0.003, 0], [R, 0.008], [R, len - 0.010], [R - 0.002, len - 0.004], [R - 0.008, len]]), xc, yc, len / 2));
  P.add(M.painted, at(latheZ([[R, 0], [R + 0.0035, 0.006], [R + 0.0035, 0.016], [R + 0.001, 0.020]]), xc, yc, -len / 2 + 0.020));   // bezel
  if (hi()) {
    P.add(M.gunmetal, at(knurlZ(R + 0.0012, 0.012, 14), xc, yc, len / 2 - 0.008));
    P.add(M.rubber, at(cylZ(0.007, 0.007, 0.005, 10), xc, yc, len / 2 + 0.002));                                                     // tail switch
    for (let i = 0; i < 2; i++) P.add(M.painted, at(ringZ(R + 0.0008, 0.001, 0, Math.PI * 2, 12, 3), xc, yc, len / 2 - 0.030 - i * 0.012));
  }
  P.add(M.steelDark, at(latheZ([[R - 0.003, 0], [R - 0.003, 0.010], [0.004, 0.012]]), xc, yc, -len / 2 + 0.014));                    // reflector
  return [xc, yc, -len / 2 + 0.002];
}
function buildLight(id, def, M, opts) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const G = glow();
  const laser = !!(def.effects && def.effects.laser);
  const lightPower = (def.effects && def.effects.light) || 0;
  if (def.slot === 'side' && laser) {
    // Perst / DBAL: a box on the side rail with an aperture stack at the front and a rotary selector behind
    const big = lightPower > 0;
    const w = big ? 0.044 : 0.036, h = big ? 0.036 : 0.032, L = big ? 0.078 : 0.084;
    railClampSide(P, M, 0.046, 0.024, 0.008);
    const bx = -0.008 - w / 2;
    P.add(M.painted, at(zrect(-L / 2, L / 2, -h / 2, h / 2, w, 0.0018, 0.004), bx, 0, 0));
    P.add(M.painted, at(zrect(L / 2 - 0.010, L / 2, -h / 2 + 0.004, h / 2 - 0.004, w + 0.004, 0.0015, 0.003), bx, 0, 0));
    if (hi()) {
      P.add(M.gunmetal, at(knurlZ(0.010, 0.008, 14), bx + w * 0.22, 0.004, L / 2 + 0.004));                    // mode selector
      P.add(M.gunmetal, at(box(0.010, 0.010, 0.006), bx - w * 0.22, -0.006, L / 2 + 0.003));                   // remote socket
      for (let i = 0; i < 3; i++) P.add(M.painted, at(box(w + 0.001, 0.0025, 0.004), bx, h / 2 - 0.004 - i * 0.008, 0));
      P.addAll(M.gunmetal, screw(bx, -h / 2 + 0.004, -L / 2 + 0.004, 0.0025, 'z'));
    }
    P.add(M.bore, at(cylZ(0.0072, 0.0072, 0.006, 10), bx + w * 0.20, h * 0.10, -L / 2 + 0.004));
    P.add(M.bore, at(cylZ(0.0072, 0.0072, 0.006, 10), bx - w * 0.20, h * 0.10, -L / 2 + 0.004));
    if (big) P.add(M.bore, at(cylZ(0.0095, 0.0095, 0.006, 10), bx, -h * 0.22, -L / 2 + 0.004));
    P.into(g, 'laserbox');
    const lm = emitter(mesh([cylZ(0.0058, 0.0058, 0.0016, 10)], G.laserOff, 'lens'), 'laser', G.laserOff, G.laserOn);
    lm.position.set(bx + w * 0.20, h * 0.10, -L / 2 + 0.0012); g.add(lm);
    const im = emitter(mesh([cylZ(0.0058, 0.0058, 0.0016, 10)], G.irOff, 'lens'), 'ir', G.irOff, G.irOn);
    im.position.set(bx - w * 0.20, h * 0.10, -L / 2 + 0.0012); g.add(im);
    if (big) {
      const wl = emitter(mesh([cylZ(0.0082, 0.0082, 0.0016, 10)], G.lampOff, 'lens'), 'light', G.lampOff, G.lampOn);
      wl.position.set(bx, -h * 0.22, -L / 2 + 0.0012); g.add(wl);
    }
    registerEmitters(opts.gun, g);
    return g;
  }
  let lp;
  if (def.slot === 'side') {
    // Zenit 2U: a torch in a ring mount offset off the left rail
    railClampSide(P, M, 0.040, 0.024, 0.008);
    const R = 0.0165, bx = -0.012 - R;
    P.add(M.painted, at(zrect(-0.012, 0.012, -0.012, 0.012, 0.016, 0.0012, 0.002), -0.010, 0, 0));              // stand-off arm
    P.add(M.painted, at(ringZ(R + 0.004, 0.004, 0, Math.PI * 2, hi() ? 14 : 8, 4), bx, 0, -0.014));
    lp = torchBody(P, M, bx, 0, R, 0.076);
    P.into(g, 'lightbody');
    const lens = emitter(mesh([cylZ(R - 0.004, R - 0.004, 0.0018, hi() ? 16 : 10)], G.lampOff, 'lens'), 'light', G.lampOff, G.lampOn);
    lens.position.set(lp[0], lp[1], lp[2]); g.add(lens);
    registerEmitters(opts.gun, g);
    return g;
  }
  if (id === 'light_tlr1') {
    // TLR-1: a boxy body clamped under the dust cover, round head, paddle switches either side
    railClampDown(P, M, 0.034, 0.028, 0.006);
    const yc = -0.026;
    P.add(M.anodised, side([[0.030, yc + 0.014], [0.030, yc - 0.014], ['q', 0.024, yc - 0.019, 0.012, yc - 0.019], [-0.028, yc - 0.017], [-0.030, yc + 0.014]], 0.030, 0.002));
    P.add(M.anodised, at(latheZ([[0.0135, 0], [0.017, 0.006], [0.017, 0.020], [0.0145, 0.024]], hi() ? 14 : 8), 0, yc, -0.030));
    P.add(M.anodised, at(zrect(-0.026, 0.014, yc + 0.010, -0.004, 0.026, 0.0012, 0.002), 0, 0, 0));
    if (hi()) {
      for (const sx of [-1, 1]) P.add(M.polymerGrip, at(box(0.004, 0.014, 0.014), sx * 0.016, yc - 0.004, 0.032));
      P.add(M.gunmetal, at(box(0.020, 0.006, 0.008), 0, yc - 0.018, 0.010));
      P.add(M.gunmetal, at(ringZ(0.0172, 0.0012, 0, Math.PI * 2, 14, 4), 0, yc, -0.044));
    }
    P.add(M.steelDark, at(latheZ([[0.0135, 0], [0.0135, 0.009], [0.0035, 0.011]], hi() ? 14 : 8), 0, yc, -0.042));
    lp = [0, yc, -0.0452];
  } else {
    // Klesch-2P: a torch in an offset ring clamp under the handguard, tape switch trailing back
    railClampDown(P, M, 0.040, 0.026, 0.007);
    P.add(M.painted, at(zrect(-0.012, 0.012, -0.024, -0.008, 0.030, 0.0012, 0.002), 0, 0, 0));
    lp = torchBody(P, M, 0, -0.032, 0.0165, 0.080);
    if (hi()) P.add(M.rubber, at(box(0.010, 0.008, 0.024), 0.014, -0.028, 0.030));
  }
  P.into(g, 'lightbody');
  const kind = lightPower > 0 ? 'light' : 'laser';                                                              // an underbarrel laser gets the same body with a red emitter
  const off = kind === 'light' ? G.lampOff : G.laserOff, on = kind === 'light' ? G.lampOn : G.laserOn;
  const lens = emitter(mesh([cylZ(0.0126, 0.0126, 0.0018, hi() ? 16 : 10)], off, 'lens'), kind, off, on);
  lens.position.set(lp[0], lp[1], lp[2]); g.add(lens);
  registerEmitters(opts.gun, g);
  return g;
}

// ---------------------------------------------------------------- stocks, pads and risers
function buildStock(id, def, M, opts) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const gun = opts.gun || {};
  const spec = gun.padSpec || { v: [-0.05, 0.05], w: 0.042 };
  const v0 = spec.v[0], v1 = spec.v[1], w = spec.w, mid = (v0 + v1) / 2;
  if (/riser|cheek/.test(id)) {
    // a foam cheek riser strapped over the comb: anchored on the butt face and running forward along the top
    const y = v1 - mid;
    P.add(M.polymer, at(zrect(-0.118, -0.012, y - 0.004, y + 0.016, w * 0.86, 0.0025, 0.005), 0, 0, 0));
    if (hi()) {
      for (const z of [-0.030, -0.100]) P.add(M.canvasDark, at(zrect(z - 0.007, z + 0.007, y - 0.030, y + 0.018, w * 0.92, 0.0015, 0.002), 0, 0, 0));   // webbing straps
      P.add(M.gunmetal, at(box(0.010, 0.008, 0.006), w * 0.42, y - 0.020, -0.030));
      for (let i = 0; i < 4; i++) P.add(M.polymer, at(box(w * 0.87, 0.003, 0.004), 0, y + 0.0155, -0.028 - i * 0.024));
    }
    P.into(g, 'riser');
    g.userData.pad = true;
    return g;
  }
  if (/pad/.test(id)) {
    // a rubber recoil pad bolted over whatever butt the gun already has, sized from the gun's own pad spec
    P.add(M.rubber, side([[-0.001, v0 + 0.004 - mid], [-0.024, v0 - mid], [-0.026, v0 + 0.010 - mid], [-0.026, v1 - 0.010 - mid], [-0.024, v1 - mid], [-0.001, v1 - 0.004 - mid]], w, 0.0025));
    if (hi()) {
      for (let i = 0; i < 5; i++) P.add(M.rubber, at(box(w + 0.001, 0.004, 0.004), 0, v0 - mid + 0.010 + i * (v1 - v0 - 0.020) / 4, 0.025));
      P.addAll(M.gunmetal, screw(0, v1 - mid - 0.014, 0.002, 0.003, 'z'));
      P.addAll(M.gunmetal, screw(0, v0 - mid + 0.014, 0.002, 0.003, 'z'));
    }
    P.into(g, 'pad');
    g.userData.pad = true;
    return g;
  }
  if (def.fits && def.fits.indexOf('ar') >= 0 && def.fits.indexOf('ak') < 0) {
    // Magpul CTR: an angular polymer shell on the buffer tube, comb, sling loop, rubber butt pad
    P.add(M.polymer, side([[-0.030, 0.014], [-0.070, 0.014], [-0.078, 0.010], [-0.230, 0.006], [-0.245, -0.002], [-0.245, -0.048], [-0.232, -0.056], [-0.150, -0.040], [-0.070, -0.014], [-0.030, -0.006]], 0.040, 0.0028));
    P.add(M.polymer, at(zrect(0.060, 0.240, 0.012, 0.030, 0.044, 0.002, 0.004), 0, 0, 0));                       // comb over the tube
    P.add(M.polymer, at(latheZ([[0.020, 0], [0.022, 0.006], [0.022, 0.026], [0.019, 0.032]], hi() ? 12 : 8), 0, 0.006, 0.058));   // front collar on the buffer tube
    if (hi()) {
      P.add(M.polymer, at(box(0.006, 0.020, 0.026), 0.020, -0.020, 0.070));
      P.add(M.bore, at(box(0.008, 0.014, 0.020), 0.020, -0.020, 0.070));                                         // sling slot
      P.add(M.polymer, at(box(0.042, 0.008, 0.016), 0, -0.006, 0.036));                                          // release lever
    }
    P.add(M.rubber, side([[-0.245, -0.050], [-0.262, -0.046], [-0.262, 0.026], [-0.245, 0.030]], 0.042, 0.0025));
    if (hi()) for (let i = 0; i < 4; i++) P.add(M.rubber, at(box(0.043, 0.004, 0.004), 0, -0.036 + i * 0.020, 0.262));
    P.into(g, 'stockbody');
    g.userData.replaces = 'stock';
    return g;
  }
  // Zenit PT-1: a folding telescopic stock. Hinge, a square arm with notches, a skeleton butt, cheek rest, rubber pad.
  P.add(M.painted, at(zrect(-0.006, 0.020, -0.024, 0.026, 0.034, 0.0018, 0.004), 0, 0, 0));
  if (hi()) { P.add(M.steel, pin(-0.016, 0.000, 0.010, 0.004, 0.010)); P.add(M.gunmetal, at(box(0.008, 0.016, 0.014), -0.019, 0.006, 0.026)); }
  P.add(M.painted, at(zrect(0.018, 0.180, -0.006, 0.020, 0.026, 0.0015, 0.003), 0, 0, 0));                       // main arm
  if (hi()) for (let i = 0; i < 6; i++) P.add(M.bore, at(box(0.0272, 0.005, 0.005), 0, 0.014, 0.060 + i * 0.020));
  P.add(M.painted, at(zrect(0.170, 0.255, -0.010, 0.024, 0.030, 0.0018, 0.003), 0, 0, 0));                       // slider carriage
  P.add(M.polymer, side([[-0.180, 0.020], [-0.262, 0.024], [-0.268, 0.018], [-0.268, -0.038], [-0.258, -0.046], [-0.198, -0.030], [-0.178, -0.008]], 0.032, 0.0028));
  P.add(M.polymer, at(zrect(0.190, 0.262, 0.022, 0.040, 0.028, 0.002, 0.004), 0, 0, 0));                         // cheek piece
  if (hi()) {
    P.add(M.bore, at(box(0.033, 0.026, 0.030), 0, -0.010, 0.222));                                                // the cut-out in the butt frame
    P.add(M.gunmetal, at(box(0.006, 0.018, 0.020), 0.016, 0.004, 0.190));
    P.add(M.gunmetal, at(ringX(0.006, 0.0013, 0, Math.PI * 2, 12, 4), 0.019, 0.004, 0.190));                      // sling loop
    P.add(M.gunmetal, at(knurlZ(0.007, 0.008, 12), 0.016, 0.026, 0.176, 0, Math.PI / 2));
  }
  P.add(M.rubber, side([[-0.268, -0.040], [-0.286, -0.034], [-0.286, 0.030], [-0.268, 0.036]], 0.034, 0.0025));
  if (hi()) for (let i = 0; i < 4; i++) P.add(M.rubber, at(box(0.035, 0.004, 0.004), 0, -0.024 + i * 0.018, 0.286));
  P.into(g, 'stockbody');
  g.userData.replaces = 'stock';
  return g;
}

// ---------------------------------------------------------------- rails and mounts
function buildRail(id, def, M, opts) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const gun = opts.gun || {};
  const dx = DOVETAIL_DX[gun.family] || 0.021;
  if (id === 'rail_akhg' || (def.fits && def.fits.indexOf('akhg') >= 0)) {
    // Zenit-style handguard: an alloy tube around the barrel with rails at 12/3/6/9 and vented flats between them.
    // Anchored on mount_stock (every AK build has one) and placed from the gun's own left-hand grip point.
    const zc = (gun.grips && gun.grips.left && gun.grips.left.p) ? gun.grips.left.p[2] : -0.42;
    const L = Math.abs(zc) < 0.40 ? 0.135 : 0.200;
    const yb = 0.030;                                                                                   // bore axis in the mount_stock frame (gun y 0.05)
    P.add(M.painted, at(latheZ([[0.0245, 0], [0.0245, L]], hi() ? 12 : 8), 0, yb, zc + L / 2));
    P.add(M.painted, at(zrect(zc + L / 2 - 0.014, zc + L / 2, yb - 0.028, yb + 0.028, 0.054, 0.0018, 0.004), 0, 0, 0));   // rear ferrule onto the trunnion
    P.add(M.painted, at(ringZ(0.0235, 0.0022, 0, Math.PI * 2, hi() ? 14 : 8, 4), 0, yb, zc - L / 2 + 0.003));            // front cap ring
    P.add(M.painted, at(railZ(L - 0.020, 0.0085), 0, yb + 0.0245, zc));
    P.add(M.painted, at(railZ(L - 0.030, 0.0085), 0, yb - 0.0245, zc, Math.PI));
    for (const sx of [-1, 1]) P.add(M.painted, at(railZ(L - 0.040, 0.0075), sx * 0.0245, yb, zc, 0, 0, sx * -Math.PI / 2));
    if (hi()) {
      for (let i = 0; i < 6; i++) for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
        P.add(M.bore, at(box(0.0075, 0.004, 0.012), Math.cos(a) * 0.024, yb + Math.sin(a) * 0.024, zc + L / 2 - 0.024 - i * 0.024, 0, 0, a - Math.PI / 2));
      }
      P.addAll(M.gunmetal, screw(0.020, yb - 0.014, zc + L / 2 - 0.007, 0.003, 'x'));
    }
    P.into(g, 'railhg');
    g.add(marker('mount_under', 0, yb - 0.0245 - 0.0085, zc));
    g.add(marker('mount_side', -0.0245 - 0.0075, yb, zc));
    g.userData.anchor = 'mount_stock';
    g.userData.replaces = 'handguard';
    return g;
  }
  if (id === 'rail_mosin' || (def.fits && def.fits.indexOf('mosin') >= 0)) {
    // Bent bracket over the receiver: a base plate on the left, an arch across the top, a PU ring seat on the bore line.
    P.add(M.gunmetal, at(zrect(-0.050, 0.050, -0.014, 0.016, 0.010, 0.0015, 0.003), -0.005, 0, 0));
    P.add(M.gunmetal, at(zrect(-0.046, 0.046, 0.014, 0.020, dx + 0.020, 0.0015, 0.002), dx / 2, 0, 0));    // the arch over the receiver
    P.add(M.gunmetal, at(zrect(-0.026, 0.026, 0.018, 0.026, 0.026, 0.0015, 0.003), dx, 0, 0));             // ring seat pad
    if (hi()) {
      P.addAll(M.gunmetal, screw(-0.010, -0.006, 0.036, 0.0032, 'x'));
      P.addAll(M.gunmetal, screw(-0.010, -0.006, -0.036, 0.0032, 'x'));
      P.add(M.gunmetal, at(box(0.010, 0.016, 0.014), -0.012, 0.004, 0.040));                               // rear lug
    }
    P.into(g, 'railmount');
    g.add(marker('mount_pu', dx, 0.026, 0.006));
    return g;
  }
  if (id === 'rail_akcover' || (def.gives && def.gives.top === 'picatinny' && def.weight > 0.2)) {
    // Railed dust cover: a hinged steel cover with a full-length Picatinny, clamped off the side rail.
    // In gun space the AK cover runs z -0.02 .. -0.262; the dovetail anchor sits at z -0.1.
    P.add(M.painted, at(zrect(-0.162, 0.080, 0.013, 0.032, 0.030, 0.0018, 0.003), dx, 0, 0));
    for (const sx of [-1, 1]) P.add(M.painted, at(zrect(-0.160, 0.078, 0.000, 0.030, 0.004, 0.0012, 0.002), dx + sx * 0.016, 0, 0));
    P.add(M.painted, at(railZ(0.215, 0.0085), dx, 0.032, -0.046));
    P.add(M.painted, at(zrect(0.058, 0.074, 0.000, 0.016, 0.026, 0.0015, 0.003), dx, 0, 0));                // rear locking block
    P.add(M.gunmetal, at(cylX(0.005, 0.005, 0.032, hi() ? 10 : 6), dx, 0.024, -0.158));                     // front hinge pin
    if (hi()) {
      P.addAll(M.gunmetal, screw(dx, 0.008, -0.064, 0.003, 'z'));
      P.add(M.gunmetal, at(box(0.014, 0.008, 0.008), dx, 0.006, 0.064));
      P.add(M.painted, at(zrect(0.042, 0.058, 0.032, 0.042, 0.022, 0.0012, 0.002), dx, 0, 0));              // folded back-up sight base
      P.add(M.bore, at(cylZ(0.0022, 0.0022, 0.004, 8), dx, 0.040, 0.050));
    }
    P.add(M.painted, at(zrect(-0.045, 0.045, -0.012, 0.014, 0.014, 0.0012, 0.002), -0.007, 0, 0));          // clamp foot on the dovetail
    P.into(g, 'railcover');
    g.add(marker('mount_top', dx, 0.0405, -0.046));
    g.userData.replaces = 'cover';
    return g;
  }
  // rail_dovpic and any other adapter: a compact side mount carrying a short Picatinny over the bore
  sideBracket(P, M, dx, 0.046, 0.086);
  P.add(M.painted, at(railZ(0.086, 0.0085), dx, 0.046, 0));
  if (hi()) { P.addAll(M.gunmetal, screw(dx - 0.012, 0.040, -0.030, 0.003, 'y')); P.addAll(M.gunmetal, screw(dx - 0.012, 0.040, 0.030, 0.003, 'y')); }
  P.into(g, 'railmount');
  g.add(marker('mount_top', dx, 0.0545, 0));
  return g;
}

// ---------------------------------------------------------------- buildAttachment
export function buildAttachment(id, opts = {}) {
  const def = ATTACHMENTS[id];
  if (!def) { const g = new THREE.Group(); g.name = id; return g; }
  const M = K(opts);
  const light = !!(def.effects && (def.effects.light || def.effects.laser));
  if (def.slot === 'top') return buildOptic(id, def, M, opts);
  if (def.slot === 'muzzle') return buildMuzzle(id, def, M);
  if (def.slot === 'under') return light ? buildLight(id, def, M, opts) : buildGrip(id, def, M);
  if (def.slot === 'side') return buildLight(id, def, M, opts);
  if (def.slot === 'stock') return buildStock(id, def, M, opts);
  if (def.slot === 'rail') return buildRail(id, def, M, opts);
  const g = new THREE.Group(); g.name = id;
  const P = new Parts(); railClamp(P, M, 0.050); P.into(g, 'mount');
  return g;
}

// ---------------------------------------------------------------- magazines
// One family table; length, curve, floor plate and the visible top round come from cap and calibre.
const MAG_FAM = {
  pm: { w: 0.021, z: 0.028, mat: 'steelDark', pitch: 0.0068, base: 0.040, curve: 0.000, pistol: true },
  aps: { w: 0.023, z: 0.030, mat: 'steelDark', pitch: 0.0042, base: 0.030, curve: 0.004, pistol: true },
  tt: { w: 0.021, z: 0.036, mat: 'steelDark', pitch: 0.0072, base: 0.038, curve: 0.000, pistol: true },
  glock: { w: 0.025, z: 0.032, mat: 'polymer', pitch: 0.0042, base: 0.030, curve: 0.000, pistol: true },
  m9: { w: 0.024, z: 0.032, mat: 'steelDark', pitch: 0.0044, base: 0.030, curve: 0.000, pistol: true },
  m1911: { w: 0.022, z: 0.034, mat: 'steelDark', pitch: 0.0074, base: 0.036, curve: 0.000, pistol: true },
  kedr: { w: 0.024, z: 0.030, mat: 'steelDark', pitch: 0.0046, base: 0.026, curve: 0.012 },
  mp5: { w: 0.025, z: 0.033, mat: 'steelDark', pitch: 0.0048, base: 0.026, curve: 0.040 },
  vityaz: { w: 0.027, z: 0.033, mat: 'polymer', pitch: 0.0047, base: 0.026, curve: 0.024 },
  ppsh: { w: 0.027, z: 0.038, mat: 'steelDark', pitch: 0.0046, base: 0.024, curve: 0.014, drumAt: 50 },
  ak545: { w: 0.026, z: 0.056, mat: 'plum', pitch: 0.0044, base: 0.014, curve: 0.030 },
  ak762: { w: 0.028, z: 0.058, mat: 'bakelitePlain', pitch: 0.0046, base: 0.014, curve: 0.044, drumAt: 60 },
  sks: { w: 0.026, z: 0.058, mat: 'gunmetal', pitch: 0.0050, base: 0.018, curve: 0.020 },
  ar: { w: 0.026, z: 0.056, mat: 'polymer', pitch: 0.0053, base: 0.016, curve: 0.020, drumAt: 50 },
  vss: { w: 0.028, z: 0.056, mat: 'polymer', pitch: 0.0062, base: 0.020, curve: 0.032 },
  svd: { w: 0.026, z: 0.062, mat: 'steelDark', pitch: 0.0080, base: 0.026, curve: 0.026 },
  sv98: { w: 0.024, z: 0.076, mat: 'steelDark', pitch: 0.0070, base: 0.024, curve: 0.014 },
  saiga: { w: 0.034, z: 0.072, mat: 'polymer', pitch: 0.0110, base: 0.022, curve: 0.030, drumAt: 16 },
  bizon: { helical: true },
  pkm: { beltbox: true },
  mosin: { clip: true },
};
const CAL_D = { '9x18': 0.0100, '9x19': 0.0100, '7.62x25': 0.0100, '.45': 0.0122, '5.45x39': 0.0100, '7.62x39': 0.0114, '5.56x45': 0.0096, '9x39': 0.0126, '7.62x54': 0.0126, '12ga': 0.0206 };
const MAG_FALLBACK = { w: 0.026, z: 0.052, mat: 'steelDark', pitch: 0.0055, base: 0.024, curve: 0.020 };

function buildBoxMag(id, def, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const fam = MAG_FAM[def.fits[0]] || MAG_FALLBACK;
  const mat = M[fam.mat] || M.steelDark;
  const zd = fam.z, w = fam.w;
  const h = clamp((fam.base || 0.020) + def.cap * (fam.pitch || 0.0050), 0.048, fam.pistol ? 0.175 : 0.28);
  const curve = (fam.curve || 0) * clamp(h / 0.16, 0.4, 1.4);
  // The body hangs from the feed lips at y = 0 and rakes toward the muzzle as it drops. u is forward, so the curve is +u.
  const f0 = zd * 0.46, r0 = -zd * 0.54, f1 = f0 + curve, r1 = r0 + curve * 0.94;
  P.add(mat, side([
    [f0, 0], [f0, -0.008],
    ['q', f0 + curve * 0.40, -h * 0.52, f1, -h + 0.010],
    [f1 - 0.002, -h + 0.002], [r1 + 0.003, -h],
    ['q', r0 + curve * 0.40, -h * 0.52, r0, -0.008], [r0, 0],
  ], w, 0.0022, hi() ? 10 : 5));
  P.add(M.steelDark, at(zrect(-f0, -r0, -0.014, 0.001, w + 0.0022, 0.0012, 0.002), 0, 0, 0));                  // feed lips
  P.add(M.bore, at(box(w - 0.008, 0.008, zd * 0.62), 0, -0.004, -zd * 0.14));
  if (hi()) {
    const d = CAL_D[def.cal] || 0.011;
    P.add(M.brass, at(cylZ(d * 0.48, d * 0.44, zd * 0.66, 10), 0, -0.006, -zd * 0.12));                        // the top round showing at the lips
    P.add(M.copper, at(latheZ([[d * 0.44, 0], [d * 0.30, 0.008], [d * 0.10, 0.013]], 10), 0, -0.006, -zd * 0.45));
    const ribs = clamp(Math.round(h / 0.030), 2, 6);
    for (let i = 0; i < ribs; i++) {
      const t = (i + 0.7) / (ribs + 0.4);
      P.add(mat, at(box(w + 0.0015, 0.0035, zd * 0.86), 0, -h * t, -curve * t * t));
    }
    P.add(M.gunmetal, at(box(0.008, 0.010, 0.010), 0, -0.012, -r0 - 0.006));                                   // the catch lug at the back
  }
  P.add(M.steelDark, at(zrect(-f1 - 0.002, -r1 + 0.002, -h - 0.008, -h + 0.002, w + 0.003, 0.0015, 0.002), 0, 0, 0));
  if (hi()) P.add(M.gunmetal, at(box(0.010, 0.005, 0.008), 0, -h - 0.004, -r1 - 0.012));
  P.into(g, 'magbody');
  g.userData.height = h + 0.010;
  return g;
}
function buildDrumMag(id, def, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const fam = MAG_FAM[def.fits[0]] || MAG_FALLBACK;
  const mat = M[fam.mat] || M.steelDark;
  const R = clamp(0.040 + def.cap * 0.00055, 0.055, 0.092), th = fam.z * 1.15, neck = 0.034;
  P.add(mat, at(zrect(-fam.z * 0.45, fam.z * 0.50, -neck, 0.001, fam.w, 0.002, 0.003), 0, 0, 0));
  P.add(M.steelDark, at(zrect(-fam.z * 0.46, fam.z * 0.54, -0.014, 0.001, fam.w + 0.002, 0.0012, 0.002), 0, 0, 0));
  const cy = -neck - R * 0.82, cz = -fam.z * 0.05;
  P.add(mat, at(cylX(R, R, th, hi() ? 22 : 10), 0, cy, cz));
  P.add(mat, at(cylX(R * 0.35, R * 0.35, th + 0.008, hi() ? 12 : 8), 0, cy, cz));                              // hub boss
  if (hi()) {
    for (const sx of [-1, 1]) {
      P.add(M.gunmetal, at(cylX(R * 0.12, R * 0.12, 0.006, 10), sx * (th / 2 + 0.002), cy, cz));                // winding key
      P.add(M.gunmetal, at(box(0.004, R * 0.34, 0.006), sx * (th / 2 + 0.005), cy, cz));
      for (let i = 0; i < 6; i++) P.add(M.gunmetal, at(box(0.0025, R * 1.5, 0.004), sx * (th / 2 + 0.0008), cy, cz, 0, 0, i * Math.PI / 6));
    }
    P.add(M.gunmetal, at(ringX(R - 0.004, 0.0022, 0, Math.PI * 2, 20, 4), 0, cy, cz));
    P.add(M.brass, at(cylZ(0.005, 0.0046, fam.z * 0.66, 10), 0, -0.006, -fam.z * 0.10));
  }
  P.into(g, 'magbody');
  g.userData.height = neck + R * 1.82 + 0.006;
  return g;
}
function buildHelicalMag(id, def, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const R = 0.0235, L = 0.30, yc = -0.012;
  P.add(M.polymer, at(latheZ([[0.012, 0], [R - 0.002, 0.010], [R, 0.020], [R, L - 0.024], [R - 0.003, L - 0.010], [0.014, L]], hi() ? 14 : 8), 0, yc, 0.280));
  P.add(M.steelDark, at(zrect(0.246, 0.288, -0.002 - yc, 0.014 - yc, 0.030, 0.0015, 0.002), 0, yc, 0));        // the feed tower into the receiver
  if (hi()) {
    for (let i = 0; i < 14; i++) {                                                                              // the helix showing through the shell
      const a = i * 0.9;
      P.add(M.gunmetal, at(box(0.006, 0.0035, 0.018), Math.cos(a) * R * 0.99, yc + Math.sin(a) * R * 0.99, 0.256 - i * 0.019, 0, 0, a));
    }
    P.add(M.gunmetal, at(knurlZ(0.012, 0.010, 14), 0, yc, -0.016));                                             // winding cap at the front
    P.add(M.gunmetal, at(box(0.012, 0.008, 0.012), 0, yc + R - 0.002, 0.252));
  }
  P.into(g, 'magbody');
  g.userData.height = R * 2 + 0.008;
  return g;
}
function buildBeltBox(id, def, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const w = 0.060, h = 0.100, zd = 0.086;
  P.add(M.olive, at(zrect(-zd / 2, zd / 2, -h, 0.002, w, 0.002, 0.006), 0, 0, 0));
  P.add(M.olive, at(zrect(-zd / 2 - 0.003, zd / 2 + 0.003, -h - 0.006, -h + 0.004, w + 0.006, 0.002, 0.003), 0, 0, 0));
  if (hi()) {
    for (let i = 0; i < 3; i++) P.add(M.olive, at(box(w + 0.002, 0.005, 0.005), 0, -0.020 - i * 0.026, 0));
    P.add(M.gunmetal, at(box(0.022, 0.010, 0.008), 0, 0.004, -zd / 2 + 0.008));                                 // lid catch
    P.add(M.canvasDark, at(box(0.010, 0.024, 0.004), w / 2 + 0.001, -0.030, 0));                                // carry strap
  }
  for (let i = 0; i < (hi() ? 5 : 2); i++) {                                                                    // the belt leaving the box
    P.add(M.gunmetal, at(box(0.010, 0.012, 0.006), 0, 0.006, -zd / 2 + 0.004 - i * 0.013));
    P.add(M.brass, at(cylZ(0.0062, 0.0056, 0.056, 8), 0, 0.006, -zd / 2 - 0.006 - i * 0.013));
  }
  P.into(g, 'magbody');
  g.userData.height = h + 0.012;
  return g;
}
function buildClip(id, def, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const d = CAL_D[def.cal] || 0.012, n = clamp(def.cap, 3, 10), zd = def.cal === '7.62x54' ? 0.077 : 0.056;
  const w = d * n * 0.98;
  P.add(M.steel, at(zrect(-zd * 0.16, zd * 0.16, -0.004, 0.010, w, 0.0008, 0.001), 0, 0, 0));                   // the stripper strip
  if (hi()) P.add(M.steel, at(zrect(-zd * 0.14, zd * 0.14, 0.009, 0.012, w + 0.002, 0.0006), 0, 0, 0));
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * d;
    P.add(M.brass, at(cylZ(d * 0.48, d * 0.44, zd * 0.62, 8), x, 0.014, -zd * 0.06));
    P.add(M.copper, at(latheZ([[d * 0.44, 0], [d * 0.30, 0.008], [d * 0.09, 0.015]], 8), x, 0.014, -zd * 0.37));
  }
  P.into(g, 'clip');
  g.userData.height = 0.012;
  return g;
}
export function buildMag(id, opts = {}) {
  const def = MAGAZINES[id];
  if (!def) { const g = new THREE.Group(); g.name = id; return g; }
  const M = K(opts);
  const fam = MAG_FAM[def.fits[0]] || MAG_FALLBACK;
  if (def.clip || fam.clip) return buildClip(id, def, M);
  if (fam.helical) return buildHelicalMag(id, def, M);
  if (fam.beltbox) return buildBeltBox(id, def, M);
  if (fam.drumAt && def.cap >= fam.drumAt) return buildDrumMag(id, def, M);
  return buildBoxMag(id, def, M);
}

// ---------------------------------------------------------------- loose items
// World meshes for anything dropped, looted or sitting on a shelf. Origin at the base, +y up, resting on the ground.
const ART_TINT = {
  art_pearl: [0xd8e6f0, 0x6fa8d8], art_ember: [0x3a1608, 0xff7a28], art_tear: [0xbfe0f0, 0x7fe8ff],
  art_lens: [0xc8ccd0, 0x9fd0e8], art_bracelet: [0x584c40, 0xc09050], art_spine: [0xcfc3a5, 0xd8b070],
  art_thorn: [0x2a1a18, 0xff4a6a], art_knot: [0x6a5a48, 0xd8a060], art_egg: [0xd8cbb0, 0xff8a3c],
  art_crown: [0xb0a488, 0xffd070], art_heart: [0x5a1a20, 0xff3050], art_snow: [0xdfe8f0, 0x9fe0ff],
};
// Artifact materials depend only on the tint, and weathered() marks them shared, so one pair per artifact type is
// enough: building a dozen pickups no longer means a dozen shader-compiling MeshStandardMaterials.
const ART_MATS = new Map();
function artMats(id) {
  let m = ART_MATS.get(id);
  if (!m) {
    const tint = ART_TINT[id] || [0xcfc3a5, 0xff6fa8];
    m = {
      tint,
      shell: weathered({ color: tint[0], roughness: 0.35, metalness: 0.1, wear: [0.5, 0.4, 0.2, 0], bare: 0xffffff, seed: 22.7 }),
      inner: weathered({ color: 0x101014, roughness: 0.4, metalness: 0, wear: [0, 0, 0, 0], bare: 0x222222, seed: 22.9, emissive: tint[1], emissiveIntensity: 1.8 }),
    };
    ART_MATS.set(id, m);
  }
  return m;
}
function artifactMesh(id) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const { tint, shell, inner } = artMats(id);
  let coreY = 0.030;
  if (id === 'art_spine' || id === 'art_knot') {
    for (let i = 0; i < 6; i++) { const s = 1 - i * 0.09; P.add(shell, at(sphere(0.017 * s, hi() ? 12 : 6), Math.sin(i * 1.6) * 0.006, 0.018 + i * 0.020, Math.cos(i * 1.9) * 0.006)); }
    P.add(shell, at(cylY(0.006, 0.004, 0.120, 8), 0, 0.060, 0));
    coreY = 0.055;
  } else if (id === 'art_thorn' || id === 'art_crown') {
    P.add(shell, at(sphere(0.028, hi() ? 14 : 7), 0, 0.030, 0));
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; P.add(shell, at(cylY(0.005, 0.0008, 0.042, 6), Math.cos(a) * 0.018, 0.052, Math.sin(a) * 0.018, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)); }
  } else if (id === 'art_lens' || id === 'art_snow') {
    P.add(shell, at(cylY(0.038, 0.038, 0.012, hi() ? 18 : 8), 0, 0.008, 0));
    P.add(shell, at(ringY(0.036, 0.005, hi() ? 20 : 10, 5), 0, 0.010, 0));
    coreY = 0.010;
  } else {
    P.add(shell, at(sphere(0.030, hi() ? 14 : 8), 0, 0.030, 0));
    if (hi()) for (let i = 0; i < 3; i++) P.add(shell, at(ringY(0.026 - i * 0.004, 0.0022, 12, 3), 0, 0.016 + i * 0.012, 0));
  }
  P.into(g, 'artifact');
  const cm = mesh([sphere(0.014, hi() ? 12 : 6)], inner, 'core'); cm.position.set(0, coreY, 0); g.add(cm);
  return g;
}
function ammoBoxMesh(id, M) {
  const g = new THREE.Group(); g.name = id;
  const a = AMMO[id];
  const P = new Parts();
  const big = a && (a.cal === '7.62x54' || a.cal === '12ga');
  const w = big ? 0.086 : 0.070, h = big ? 0.046 : 0.038, d = big ? 0.056 : 0.046;
  P.add(M.cardboard, at(zrect(-d / 2, d / 2, 0, h, w, 0.0018, 0.004), 0, 0, 0));
  if (hi()) {
    P.add(M.cardboard, at(zrect(-d / 2 - 0.001, d / 2 + 0.001, h - 0.010, h + 0.001, w + 0.002, 0.0015, 0.003), 0, 0, 0));
    P.add(M.paper, at(zrect(-d / 2 + 0.006, d / 2 - 0.006, h * 0.25, h * 0.72, w + 0.0008, 0.0008), 0, 0, 0));    // label
    P.add(M.bore, at(box(w * 0.60, 0.0035, 0.0012), 0, h * 0.58, -d / 2 - 0.0006));
    P.add(M.bore, at(box(w * 0.35, 0.0025, 0.0012), 0, h * 0.44, -d / 2 - 0.0006));
    const dia = CAL_D[a ? a.cal : '7.62x39'] || 0.011;
    for (let i = 0; i < 4; i++) P.add(M.brass, at(cylY(dia * 0.48, dia * 0.44, 0.014, 8), -w * 0.30 + i * dia * 1.1, h + 0.006, 0));
  }
  P.into(g, 'ammobox');
  return g;
}
const ROLLS = ['bandage', 'hemostat', 'tourniquet'];
const SHOTS = ['morphine', 'stim', 'adrenaline'];
const PILLS = ['painkillers', 'antirad'];
const STICKS = ['gr_flash', 'gr_smoke', 'gr_thermite', 'gr_flare'];
function itemByKind(id, it, M) {
  const g = new THREE.Group(); g.name = id;
  const P = new Parts();
  const kind = it.kind;
  if (kind === 'med') {
    if (ROLLS.indexOf(id) >= 0) {
      P.add(M.paper, at(cylX(0.024, 0.024, 0.046, hi() ? 14 : 8), 0, 0.024, 0));                                 // rolled gauze
      if (hi()) { P.add(M.paper, at(ringX(0.020, 0.004, 0, Math.PI * 2, 14, 4), 0, 0.024, 0)); P.add(M.redPlastic, at(box(0.047, 0.010, 0.003), 0, 0.038, 0)); }
    } else if (SHOTS.indexOf(id) >= 0) {
      P.add(M.whitePlastic, at(cylX(0.008, 0.008, 0.068, hi() ? 12 : 6), 0, 0.009, 0));                          // auto-injector
      P.add(M.gunmetal, at(cylX(0.005, 0.005, 0.020, 8), 0.042, 0.009, 0));
      if (hi()) { P.add(M.orange, at(cylX(0.0086, 0.0086, 0.012, 10), -0.026, 0.009, 0)); P.add(M.redPlastic, at(box(0.010, 0.004, 0.014), 0.006, 0.017, 0)); }
    } else if (PILLS.indexOf(id) >= 0) {
      P.add(M.whitePlastic, at(latheZ([[0.016, 0], [0.017, 0.004], [0.017, 0.048], [0.011, 0.054], [0.011, 0.062]], hi() ? 12 : 6), 0, 0, 0, -Math.PI / 2));
      if (hi()) { P.add(M.redPlastic, at(cylY(0.0118, 0.0118, 0.010, 10), 0, 0.062, 0)); P.add(M.paper, at(cylY(0.0175, 0.0175, 0.030, 12), 0, 0.026, 0)); }
    } else if (id === 'splint') {
      for (let i = 0; i < 3; i++) P.add(M.tin, at(zrect(-0.090, 0.090, 0.001 + i * 0.004, 0.004 + i * 0.004, 0.038 - i * 0.004, 0.0008), 0, 0, 0));
      if (hi()) for (const z of [-0.050, 0.050]) P.add(M.canvasDark, at(zrect(z - 0.008, z + 0.008, 0, 0.014, 0.042, 0.0012), 0, 0, 0));
    } else {
      const orange = id === 'medkit_ai2';
      const mat = orange ? M.orange : id === 'medpouch' ? M.canvas : M.canvasDark;
      const h = it.weight > 0.9 ? 0.070 : 0.055;
      P.add(mat, at(zrect(-0.036, 0.036, 0, h, 0.100, 0.0025, 0.006), 0, 0, 0));
      if (hi()) {
        P.add(mat, at(zrect(-0.037, 0.037, h - 0.007, h + 0.001, 0.102, 0.002, 0.004), 0, 0, 0));                 // lid
        P.add(M.gunmetal, at(box(0.016, 0.008, 0.006), 0, h - 0.009, -0.037));                                    // catch
        P.add(M.redPlastic, at(box(0.026, 0.008, 0.0015), 0, h * 0.55, -0.0365));
        P.add(M.redPlastic, at(box(0.008, 0.026, 0.0015), 0, h * 0.55, -0.0365));                                 // the cross
        P.add(M.canvasDark, at(box(0.030, 0.006, 0.010), 0, h + 0.005, 0));                                       // handle
      }
    }
  } else if (kind === 'food') {
    if (id === 'water') {
      P.add(M.tin, at(latheZ([[0.030, 0], [0.032, 0.008], [0.032, 0.112], [0.024, 0.122], [0.012, 0.126]], hi() ? 16 : 8), 0, 0, 0, -Math.PI / 2));
      if (hi()) { P.add(M.canvasDark, at(cylY(0.033, 0.033, 0.040, 14), 0, 0.050, 0)); P.add(M.polymer, at(cylY(0.013, 0.013, 0.010, 10), 0, 0.130, 0)); }
    } else if (id === 'bread') {
      P.add(M.cardboard, side([[0.060, 0.0], [0.060, 0.040], ['q', 0.030, 0.062, -0.010, 0.058], [-0.060, 0.046], [-0.060, 0.0]], 0.070, 0.004, hi() ? 8 : 4));
      if (hi()) for (let i = 0; i < 3; i++) P.add(M.cardboard, at(box(0.072, 0.004, 0.006), 0, 0.052 - i * 0.004, -0.020 + i * 0.020));
    } else if (id === 'cigarettes') {
      P.add(M.paper, at(zrect(-0.011, 0.011, 0, 0.086, 0.056, 0.0015, 0.002), 0, 0, 0));
      if (hi()) { P.add(M.redPlastic, at(box(0.057, 0.020, 0.0012), 0, 0.056, -0.0112)); P.add(M.tin, at(box(0.050, 0.006, 0.004), 0, 0.084, 0)); }
    } else {
      const R = id === 'energy' ? 0.026 : 0.036, H = id === 'energy' ? 0.130 : 0.052;
      P.add(M.tin, at(latheZ([[R - 0.003, 0], [R, 0.004], [R, H - 0.004], [R - 0.003, H]], hi() ? 16 : 8), 0, 0, 0, -Math.PI / 2));
      if (hi()) {
        P.add(M.tin, at(ringY(R - 0.002, 0.0022, 16, 4), 0, H - 0.001, 0));
        P.add(M.tin, at(ringY(R - 0.002, 0.0022, 16, 4), 0, 0.002, 0));
        P.add(M.paper, at(cylY(R + 0.0006, R + 0.0006, H * 0.60, 16), 0, H * 0.45, 0));                            // wrapper band
        if (id !== 'energy') P.add(M.tin, at(ringY(R * 0.4, 0.0016, 12, 4), 0, H + 0.001, 0));                     // ring pull
      }
    }
  } else if (kind === 'grenade') {
    if (id === 'gr_molotov') {
      P.add(M.glass, at(latheZ([[0.034, 0], [0.036, 0.008], [0.036, 0.110], [0.020, 0.140], [0.014, 0.150], [0.014, 0.172]], hi() ? 16 : 8), 0, 0, 0, -Math.PI / 2));
      if (hi()) { P.add(M.canvas, at(cylY(0.010, 0.007, 0.048, 8), 0, 0.188, 0, 0.25)); P.add(M.paper, at(cylY(0.0365, 0.0365, 0.044, 14), 0, 0.052, 0)); }
    } else if (STICKS.indexOf(id) >= 0) {
      const body = id === 'gr_smoke' ? M.olive : id === 'gr_flare' ? M.redPlastic : M.painted;
      P.add(body, at(latheZ([[0.024, 0], [0.026, 0.006], [0.026, 0.096], [0.023, 0.104]], hi() ? 14 : 8), 0, 0, 0, -Math.PI / 2));
      if (hi()) {
        P.add(M.gunmetal, at(cylY(0.010, 0.010, 0.018, 10), 0, 0.104, 0));
        P.add(M.steel, at(ringY(0.010, 0.0016, 10, 4), 0, 0.118, 0));
        for (let i = 0; i < 3; i++) P.add(M.paper, at(ringY(0.0265, 0.0022, 14, 4), 0, 0.026 + i * 0.026, 0));
      }
    } else {
      const f1 = id === 'gr_f1', R = f1 ? 0.028 : 0.026;
      P.add(f1 ? M.olive : M.greyPaint, at(sphere(R, hi() ? 16 : 8), 0, R + 0.006, 0));
      if (f1 && hi()) {
        for (let i = 0; i < 3; i++) P.add(M.olive, at(ringY(R * 0.99, 0.0022, 12, 3), 0, R + 0.006 - R * 0.5 + i * R * 0.5, 0));
        for (let j = 0; j < 6; j++) P.add(M.olive, at(box(0.0022, R * 1.9, 0.0022), Math.cos(j / 6 * 6.283) * R * 0.99, R + 0.006, Math.sin(j / 6 * 6.283) * R * 0.99));
      }
      P.add(M.gunmetal, at(cylY(0.011, 0.011, 0.016, hi() ? 12 : 6), 0, R * 2 + 0.014, 0));                        // fuse body
      if (hi()) { P.add(M.gunmetal, at(box(0.010, 0.036, 0.005), 0.011, R * 2 + 0.008, 0)); P.add(M.steel, at(ringY(0.009, 0.0014, 10, 4), -0.012, R * 2 + 0.018, 0)); }
    }
  } else if (kind === 'melee') {
    const L = id === 'machete' ? 0.34 : id === 'bayonet' ? 0.20 : 0.15;
    P.add(M.steel, at(zrect(-L, 0.020, 0.006, 0.010, id === 'machete' ? 0.044 : 0.026, 0.0012, 0.002), 0, 0, 0));
    if (hi()) { P.add(M.bore, at(box(0.002, 0.0026, L * 0.9), 0, 0.008, -L * 0.55)); P.add(M.gunmetal, at(box(0.030, 0.008, 0.008), 0, 0.008, 0.008)); }
    P.add(id === 'machete' ? M.polymerGrip : M.bakelite, at(zrect(0.010, 0.110, 0.002, 0.016, 0.024, 0.002, 0.004), 0, 0, 0));
    if (hi()) for (let i = 0; i < 3; i++) P.add(M.bakelite, at(ringZ(0.009, 0.0018, 0, Math.PI * 2, 10, 4), 0, 0.009, 0.030 + i * 0.024));
  } else if (kind === 'part') {
    if (it.part === 'barrel') {
      P.add(M.gunmetal, at(latheZ([[0.010, 0], [0.013, 0.020], [0.0105, 0.030], [0.0095, 0.300], [0.0085, 0.320]], hi() ? 14 : 8), 0, 0.013, 0.160));
      if (hi()) P.add(M.bore, at(cylZ(0.0038, 0.0038, 0.006, 8), 0, 0.013, -0.158));
    } else if (it.part === 'bolt') {
      P.add(M.bolt, at(latheZ([[0.014, 0], [0.016, 0.008], [0.016, 0.090], [0.012, 0.100]], hi() ? 14 : 8), 0, 0.016, 0.050));
      if (hi()) { P.add(M.bolt, at(box(0.026, 0.014, 0.016), 0.020, 0.020, 0)); P.add(M.gunmetal, at(cylX(0.006, 0.006, 0.030, 8), 0.048, 0.020, 0)); }
    } else {
      for (let i = 0; i < (hi() ? 14 : 6); i++) P.add(M.steel, at(ringZ(0.014, 0.0018, 0, Math.PI * 2, 12, 4), 0, 0.015, -0.052 + i * 0.008));
    }
  } else if (kind === 'battery' || kind === 'filter') {
    if (kind === 'battery') {
      P.add(M.tin, at(latheZ([[0.014, 0], [0.014, 0.048], [0.010, 0.050]], hi() ? 12 : 6), 0, 0, 0, -Math.PI / 2));
      if (hi()) { P.add(M.gunmetal, at(cylY(0.005, 0.005, 0.004, 8), 0, 0.051, 0)); P.add(M.paper, at(cylY(0.0143, 0.0143, 0.030, 12), 0, 0.024, 0)); }
    } else {
      P.add(M.olive, at(latheZ([[0.036, 0], [0.038, 0.006], [0.038, 0.058], [0.030, 0.066], [0.018, 0.070]], hi() ? 16 : 8), 0, 0, 0, -Math.PI / 2));
      if (hi()) { P.add(M.gunmetal, at(cylY(0.019, 0.019, 0.012, 12), 0, 0.070, 0)); for (let i = 0; i < 3; i++) P.add(M.olive, at(ringY(0.0385, 0.0022, 16, 4), 0, 0.014 + i * 0.018, 0)); }
    }
  } else if (kind === 'tool') {
    if (id === 'probe') {
      P.add(M.steel, at(cylY(0.006, 0.005, 0.090, hi() ? 10 : 6), 0, 0.045, 0));
      if (hi()) { P.add(M.gunmetal, at(hexZ(0.009, 0.008), 0, 0.086, 0, Math.PI / 2)); P.add(M.canvas, at(box(0.018, 0.030, 0.004), 0.008, 0.020, 0, 0, 0, 0.3)); }
    } else if (id.indexOf('detector') === 0) {
      P.add(M.painted, at(zrect(-0.032, 0.032, 0, 0.100, 0.070, 0.002, 0.005), 0, 0, 0));
      if (hi()) {
        P.add(M.bore, at(zrect(-0.020, 0.020, 0.050, 0.086, 0.056, 0.0012), 0, 0, -0.0325));
        P.add(M.gunmetal, at(cylY(0.005, 0.004, 0.130, 8), 0.026, 0.100, 0));                                      // antenna
        for (let i = 0; i < 3; i++) P.add(M.gunmetal, at(cylZ(0.005, 0.005, 0.004, 8), -0.018 + i * 0.018, 0.022, -0.0335));
        P.add(M.canvasDark, at(box(0.014, 0.006, 0.036), 0.036, 0.060, 0));
      }
      const scr = mesh([box(0.036, 0.030, 0.0012)], glow().nv, 'screen'); scr.position.set(0, 0.068, -0.033); g.add(scr);
    } else if (id === 'binoculars') {
      for (const sx of [-1, 1]) {
        P.add(M.painted, at(latheZ([[0.024, 0], [0.024, 0.030], [0.020, 0.038], [0.020, 0.084], [0.018, 0.090]], hi() ? 14 : 8), sx * 0.024, 0, 0, -Math.PI / 2));
        if (hi()) P.add(M.rubber, at(cylY(0.020, 0.017, 0.010, 12), sx * 0.024, 0.093, 0));
      }
      P.add(M.painted, at(box(0.030, 0.016, 0.020), 0, 0.050, 0));
      if (hi()) P.add(M.gunmetal, at(cylY(0.008, 0.008, 0.030, 10), 0, 0.062, 0));
    } else if (id === 'torch') {
      P.add(M.painted, at(latheZ([[0.020, 0], [0.022, 0.006], [0.018, 0.020], [0.018, 0.120], [0.021, 0.128]], hi() ? 14 : 8), 0, 0.022, 0.064));
      const lens = emitter(mesh([cylZ(0.017, 0.017, 0.0016, 12)], glow().lampOff, 'lens'), 'light', glow().lampOff, glow().lampOn);
      lens.position.set(0, 0.022, -0.063); g.add(lens);
    } else if (id === 'lockpick') {
      for (let i = 0; i < 4; i++) P.add(M.steel, at(zrect(-0.062, 0.004, 0.001, 0.003, 0.004, 0.0005), 0, 0, -0.009 + i * 0.006));
      P.add(M.leather, at(zrect(-0.022, 0.010, 0, 0.006, 0.036, 0.0012), 0, 0, 0));
    } else {
      // cleaning and repair kits: a canvas roll with a steel latch, or a flat tin case
      const tin = id === 'repairkit' || id === 'armorkit';
      const h = tin ? 0.034 : 0.052;
      P.add(tin ? M.tin : M.canvas, at(zrect(-0.042, 0.042, 0, h, tin ? 0.110 : 0.072, 0.002, 0.005), 0, 0, 0));
      if (hi()) {
        if (tin) { P.add(M.gunmetal, at(box(0.020, 0.008, 0.006), 0, h - 0.006, -0.043)); P.add(M.tin, at(zrect(-0.043, 0.043, h - 0.006, h + 0.002, 0.112, 0.002, 0.003), 0, 0, 0)); }
        else { for (let i = 0; i < 2; i++) P.add(M.canvasDark, at(box(0.074, 0.006, 0.010), 0, 0.014 + i * 0.024, 0)); P.add(M.gunmetal, at(box(0.010, 0.008, 0.006), 0, 0.038, -0.042)); }
      }
    }
  } else if (kind === 'key') {
    P.add(M.steel, at(cylZ(0.004, 0.004, 0.044, hi() ? 10 : 6), 0, 0.004, 0));
    P.add(M.steel, at(ringY(0.010, 0.0018, 12, 4), 0, 0.002, 0.030));
    if (hi()) { P.add(M.steel, at(box(0.014, 0.008, 0.003), 0.005, 0.007, -0.018)); P.add(M.brass, at(box(0.004, 0.006, 0.008), 0.005, 0.010, -0.008)); }
  } else {
    // mission objects, documents and anything else: a sealed steel case with a stencilled panel
    const tall = it.weight > 1.0;
    const h = tall ? 0.120 : 0.040, w = tall ? 0.090 : 0.130, d = tall ? 0.050 : 0.070;
    P.add(M.greyPaint, at(zrect(-d / 2, d / 2, 0, h, w, 0.0022, 0.006), 0, 0, 0));
    if (hi()) {
      P.add(M.greyPaint, at(zrect(-d / 2 - 0.001, d / 2 + 0.001, h - 0.010, h + 0.001, w + 0.002, 0.002, 0.004), 0, 0, 0));
      for (const sx of [-1, 1]) P.add(M.gunmetal, at(box(0.018, 0.010, 0.007), sx * w * 0.28, h - 0.012, -d / 2 - 0.001));
      P.add(M.paper, at(zrect(-0.026, 0.026, h * 0.20, h * 0.72, w + 0.001, 0.0008), 0, 0, 0));
      P.add(M.bore, at(box(0.040, 0.004, 0.0012), 0, h * 0.58, -d / 2 - 0.0016));
      P.add(M.canvasDark, at(box(0.026, 0.008, 0.012), 0, h + 0.005, 0));
    }
  }
  P.into(g, 'item');
  return g;
}
export function buildItemMesh(id, opts = {}) {
  if (ATTACHMENTS[id]) return buildAttachment(id, opts);
  if (MAGAZINES[id]) {
    // magazines are authored hanging from the feed lips: stand one on its floor plate for the world
    const holder = new THREE.Group(); holder.name = id;
    const m = buildMag(id, opts);
    m.position.y = m.userData.height || 0.16;
    holder.add(m);
    return holder;
  }
  const M = K(opts);
  if (AMMO[id]) return ammoBoxMesh(id, M);
  const it = ITEMS[id];
  if (!it) { const g = new THREE.Group(); g.name = id; return g; }
  if (it.kind === 'artifact') return artifactMesh(id);
  return itemByKind(id, it, M);
}
