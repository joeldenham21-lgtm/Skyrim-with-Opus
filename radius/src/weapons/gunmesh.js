// Procedural weapon and hand meshes. buildGun(id) -> THREE.Group with named parts (mag, slide|bolt|barrels,
// trigger, hammer, muzzle, eject) and userData describing hip/ADS poses and hand grips. Everything is built from
// side-profile extrusions with bevels, lathes and cylinders, merged per material, with creased normals so edges
// read as machined rather than faceted. Materials carry procedural wear (edge lightening, grime, scratches, wood
// grain) in a single shared shader patch driven by uniforms, so all parts share one program.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- materials
const WEAR_FRAG = /* glsl */`
{
  vec3 op = vOPos * 55.0 + uSeed;
  float n1 = vnoise3(op * 0.9);
  float n2 = vnoise3(op * 4.1);
  float n3 = vnoise3(op * 13.0);
  // grime gathers in soft blotches
  float grime = smoothstep(0.45, 0.85, vnoise3(op * 0.35) * 0.75 + n3 * 0.25) * uWear.y;
  diffuseColor.rgb *= 1.0 - grime * 0.3;
  // edge wear: normal turn per metre of surface (resolution independent), high on bevels, rims and knurls
  float curv = length(fwidth(vNormal)) / max(length(fwidth(vOPos)), 1e-6);
  float edge = smoothstep(220.0, 700.0, curv) * smoothstep(0.3, 0.75, n2) * uWear.x;
  // long scratches along the bore axis
  float sc = smoothstep(0.935, 0.97, vnoise(vec2(vOPos.z * 70.0 + uSeed, vOPos.y * 260.0 + vOPos.x * 170.0)));
  sc *= smoothstep(0.45, 0.7, n2) * uWear.z;
  float bare = clamp(edge + sc * 0.8, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uBare, bare);
  // wood grain: fibres along the stock, wandering with low-frequency noise
  float fibre = 0.5 + 0.5 * sin(vOPos.y * 420.0 + vOPos.x * 300.0 + vOPos.z * 14.0 + fbm3(vOPos.zy * 30.0 + uSeed) * 12.0);
  float grain = smoothstep(0.3, 0.9, fibre) * uWear.w;
  diffuseColor.rgb *= 1.0 - grain * 0.26 - uWear.w * (n2 - 0.5) * 0.2;
  roughnessFactor = clamp(roughnessFactor + (n3 - 0.5) * 0.18 + grime * 0.2 - bare * 0.3, 0.06, 1.0);
}`;

// The viewmodel sits centimetres from the torch and the muzzle flash, where inverse-square lighting is hundreds of
// times the daylight level and burns it to white. Spot and point irradiance is capped per fragment (x: spot, y: point);
// the sun, moon and hemisphere are untouched so the gun still reads the time of day.
export const lightCap = { value: new THREE.Vector2(4.5, 7.0) };
// Bounce onto the viewmodel: the torch head rides ahead of the hands (render/lighting.js), so what lights them is the
// beam coming back off the ground, plus a little sky by day. A wrapped half-Lambert from below-ahead in view space,
// diffuse only, viewmodel materials only. hands.js drives the colour each frame from the scene lights.
export const viewFill = { value: new THREE.Color(0, 0, 0) };
const NO_FILL = { value: new THREE.Color(0, 0, 0) };
const FILL_DIR = { value: new THREE.Vector3(0.12, -0.72, -0.68).normalize() };
const FILL_FRAG = /* glsl */`
#include <lights_fragment_end>
reflectedLight.indirectDiffuse += uFill * (0.72 + 0.28 * dot(geometryNormal, uFillDir)) * BRDF_Lambert(material.diffuseColor);`;
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin
  .replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( uLightCap.y ) );')
  .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );', 'getSpotLightInfo( spotLight, geometryPosition, directLight ); directLight.color = min( directLight.color, vec3( uLightCap.x ) );');

export function weathered({ color, roughness, metalness = 0, wear = [0.6, 0.5, 0.3, 0], bare = 0x888888, seed = 0, side = THREE.DoubleSide, fill = true }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side });
  const uniforms = { uWear: { value: new THREE.Vector4(...wear) }, uBare: { value: new THREE.Color(bare) }, uSeed: { value: seed }, uLightCap: lightCap, uFill: fill ? viewFill : NO_FILL, uFillDir: FILL_DIR };
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vOPos; uniform vec4 uWear; uniform vec3 uBare; uniform float uSeed; uniform vec2 uLightCap; uniform vec3 uFill; uniform vec3 uFillDir;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${WEAR_FRAG}`)
      .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
      .replace('#include <lights_fragment_end>', FILL_FRAG);
  };
  m.customProgramCacheKey = () => 'radius-wear';
  m.userData.shared = true; m.userData.wear = uniforms;
  return m;
}

let MAT = null;
export function materials() {
  if (MAT) return MAT;
  MAT = {
    // no environment map in this renderer: high metalness has nothing to reflect and reads as black, so gunmetal
    // is a dark grey dielectric-leaning blend with bright worn edges rather than a mirror
    steel: weathered({ color: 0x585d63, roughness: 0.5, metalness: 0.35, wear: [0.9, 0.45, 0.7, 0], bare: 0xa8acb0, seed: 1.7 }),
    steelDark: weathered({ color: 0x45484d, roughness: 0.62, metalness: 0.3, wear: [0.75, 0.6, 0.45, 0], bare: 0x8e9297, seed: 4.2 }),
    bore: weathered({ color: 0x08090a, roughness: 0.9, metalness: 0.3, wear: [0, 0.2, 0, 0], bare: 0x111111, seed: 0.3 }),
    bakelite: weathered({ color: 0x7a4426, roughness: 0.42, metalness: 0.04, wear: [0.55, 0.45, 0.25, 0.35], bare: 0xb07046, seed: 9.1 }),
    wood: weathered({ color: 0x6a4424, roughness: 0.64, metalness: 0, wear: [0.55, 0.55, 0.15, 1.0], bare: 0x9c7449, seed: 2.9 }),
    woodDark: weathered({ color: 0x563618, roughness: 0.6, metalness: 0, wear: [0.5, 0.6, 0.1, 1.0], bare: 0x86633c, seed: 6.4 }),
    rubber: weathered({ color: 0x26251f, roughness: 0.92, metalness: 0, wear: [0.35, 0.4, 0, 0], bare: 0x44423e, seed: 3.3 }),
    brass: weathered({ color: 0xffffff, roughness: 0.34, metalness: 0.9, wear: [0.25, 0.3, 0.3, 0], bare: 0xe8d090, seed: 5.5, side: THREE.FrontSide, fill: false }),   // casings lie in the world, not in the hands
    glove: weathered({ color: 0x5c5f47, roughness: 0.95, metalness: 0, wear: [0.25, 0.55, 0, 0.55], bare: 0x767a5d, seed: 7.7 }),
    cuff: weathered({ color: 0x474a3d, roughness: 0.97, metalness: 0, wear: [0.15, 0.55, 0, 0.7], bare: 0x5c6050, seed: 8.8 }),
  };
  return MAT;
}

// ---------------------------------------------------------------- geometry helpers
// Side profile: points in (u, v) = (toward the muzzle, up). Extruded across x (the gun's width), centred.
function shapeFrom(pts) {
  const s = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) s.moveTo(p[0], p[1]);
    else if (p[0] === 'q') s.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  return s;
}
function side(pts, width, bevel = 0.0015, curveSegments = 8) {
  const shape = shapeFrom(pts);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0005, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments, steps: 1 });
  g.rotateY(Math.PI / 2);                       // (u, v, w) -> (w, v, -u)
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}
// rectangle (u0..u1, v0..v1) with optional chamfer on the profile corners
function rect(u0, u1, v0, v1, width, bevel = 0.0015, ch = 0) {
  if (ch <= 0) return side([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], width, bevel);
  return side([[u0 + ch, v0], [u1 - ch, v0], [u1, v0 + ch], [u1, v1 - ch], [u1 - ch, v1], [u0 + ch, v1], [u0, v1 - ch], [u0, v0 + ch]], width, bevel);
}
// U-shaped trigger guard hanging from vTop between u0 and u1, depth d, bar thickness t
function guardU(u0, u1, vTop, d, t, width) {
  const r = Math.min(d * 0.5, 0.012);
  return side([
    [u0, vTop], [u0, vTop - d + r], ['q', u0, vTop - d, u0 + r, vTop - d], [u1 - r, vTop - d], ['q', u1, vTop - d, u1, vTop - d + r], [u1, vTop],
    [u1 - t, vTop], [u1 - t, vTop - d + r], ['q', u1 - t, vTop - d + t, u1 - r, vTop - d + t], [u0 + r, vTop - d + t], ['q', u0 + t, vTop - d + t, u0 + t, vTop - d + r], [u0 + t, vTop],
  ], width, 0.0007, 6);
}
// cylinder along z: rear radius rb at +z end, front radius rf at -z end. Centred on origin, length len.
function cylZ(rb, rf, len, seg = 14, open = false) { const g = new THREE.CylinderGeometry(rf, rb, len, seg, 1, open); g.rotateX(-Math.PI / 2); return g; }
function cylY(rBottom, rTop, len, seg = 12) { return new THREE.CylinderGeometry(rTop, rBottom, len, seg, 1); }
function cylX(r0, r1, len, seg = 10) { const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1); g.rotateZ(-Math.PI / 2); return g; }
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function sphere(r, seg = 8) { return new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)); }
// ring in the ZY plane (axis along x): angle 0 = forward (-z), 90 = up. a0 = start angle, arc = sweep
function ringX(R, tube, a0 = 0, arc = Math.PI * 2, seg = 14, tubeSeg = 6) { const g = new THREE.TorusGeometry(R, tube, tubeSeg, seg, arc); g.rotateZ(a0); g.rotateY(Math.PI / 2); return g; }
// ring in the XY plane (axis along z): angle 0 = right (+x), 90 = up
function ringZ(R, tube, a0 = 0, arc = Math.PI * 2, seg = 14, tubeSeg = 6) { const g = new THREE.TorusGeometry(R, tube, tubeSeg, seg, arc); g.rotateZ(a0); return g; }
function at(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; }
// slant the -z end of a geometry: z += x * k for vertices at the front (muzzle brakes)
function slantFront(g, zFront, k) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { if (p.getZ(i) < zFront + 1e-4) p.setZ(i, p.getZ(i) + p.getX(i) * k); } g.computeVertexNormals(); return g; }

function finalize(geos) {
  const list = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; });
  const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
  merged.scale(10, 10, 10);                     // the crease hash works at 1 cm; scale so it resolves 1 mm
  const c = toCreasedNormals(merged, 50 * DEG);
  c.scale(0.1, 0.1, 0.1);
  c.computeBoundingSphere();
  return c;
}
function mesh(geos, mat, name) {
  const m = new THREE.Mesh(finalize(geos), mat);
  m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false; m.name = name || '';
  return m;
}
// a moving part. Geometries authored in gun space unless local=true; pivot p => mesh at p, geometry shifted by -p.
function part(name, geos, mat, p = [0, 0, 0], local = false) {
  if (!local) for (const g of geos) g.translate(-p[0], -p[1], -p[2]);
  const m = mesh(geos, mat, name);
  m.position.set(p[0], p[1], p[2]);
  m.userData.base = { p: m.position.clone(), r: new THREE.Euler() };
  return m;
}
// a part built with the same pivot as its parent moving part: geometry is already parent-local, so sit at the origin
function sub(m) { m.position.set(0, 0, 0); m.userData.base.p.set(0, 0, 0); return m; }
class Parts {
  constructor() { this.map = new Map(); }
  add(mat, g) { if (!this.map.has(mat)) this.map.set(mat, []); this.map.get(mat).push(g); return g; }
  into(group) { for (const [mat, geos] of this.map) group.add(mesh(geos, mat, 'body')); this.map.clear(); }
}
function marker(name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); return o; }
// Euler that maps local x/y axes to the given world axes (z = x cross y; y re-orthogonalised)
export function basisEuler(xa, ya) {
  const x = new THREE.Vector3(...xa).normalize(), y = new THREE.Vector3(...ya).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize(); y.crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const e = new THREE.Euler().setFromRotationMatrix(m);
  return [e.x, e.y, e.z];
}
// hand pose from the palm-normal axis (local x, re-orthogonalised) and the wrist/forearm direction (local +z)
export function handEuler(palmX, wristZ) {
  const z = new THREE.Vector3(...wristZ).normalize(), x = new THREE.Vector3(...palmX);
  x.addScaledVector(z, -x.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return [e.x, e.y, e.z];
}

// ---------------------------------------------------------------- PM (Makarov)
function buildPM(M) {
  const g = new THREE.Group(); g.name = 'pm';
  const P = new Parts();
  // frame + grip frame
  P.add(M.steel, side([[-0.006, -0.002], [0.122, -0.002], [0.122, -0.012], [0.078, -0.014], [0.048, -0.014], [0.036, -0.022], [0.012, -0.098], [-0.026, -0.104], ['q', -0.036, -0.06, -0.022, -0.02], [-0.012, -0.004]], 0.024, 0.0015));
  P.add(M.steel, rect(0.046, 0.122, -0.012, 0.0, 0.026, 0.001));                                  // dust cover under the slide
  P.add(M.steel, at(ringX(0.0165, 0.0021, Math.PI - 0.35, Math.PI + 0.7, 18, 6), 0, -0.017, -0.06));   // rounded trigger guard
  P.add(M.steel, at(box(0.003, 0.006, 0.012), -0.0145, 0.02, 0.0));                                // safety lever, left rear
  P.add(M.steel, at(box(0.0025, 0.005, 0.02), -0.0135, 0.004, -0.05));                             // slide stop
  P.add(M.steel, at(ringX(0.004, 0.001, 0, Math.PI * 2, 10, 5), 0, -0.108, 0.02));                  // lanyard loop
  P.add(M.steel, at(cylX(0.0065, 0.0065, 0.0014, 12), 0.0175, -0.056, 0.004));                     // grip medallions
  P.add(M.steel, at(cylX(0.0065, 0.0065, 0.0014, 12), -0.0175, -0.056, 0.004));
  P.add(M.bakelite, side([[0.033, -0.022], [0.010, -0.096], [-0.022, -0.1], ['q', -0.032, -0.06, -0.019, -0.022]], 0.034, 0.0022));   // wrap-around grip
  P.into(g);
  // slide (moving)
  const slideGeos = [
    side([[-0.004, 0.0], [0.126, 0.0], [0.130, 0.006], [0.130, 0.022], [0.124, 0.030], [0.0, 0.030], [-0.004, 0.024]], 0.026, 0.0018),
    rect(0.112, 0.118, 0.030, 0.0365, 0.003, 0.0005),                                             // front blade
    rect(0.004, 0.014, 0.030, 0.0355, 0.02, 0.0005),                                              // rear sight
    at(cylZ(0.0065, 0.0065, 0.012, 14), 0, 0.014, -0.128),                                        // barrel bushing
  ];
  for (let i = 0; i < 6; i++) slideGeos.push(at(box(0.0272, 0.018, 0.0012), 0, 0.014, -(0.012 + i * 0.0045)));   // rear serrations
  const slide = part('slide', slideGeos, M.steel, [0, 0, 0]);
  slide.add(part('port', [at(box(0.001, 0.011, 0.024), 0.0135, 0.02, -0.072)], M.bore));          // ejection port
  slide.add(part('bore', [at(cylZ(0.0045, 0.0045, 0.002, 12), 0, 0.014, -0.1345)], M.bore));
  g.add(slide);
  g.add(part('hammer', [side([[-0.002, -0.001], [-0.004, 0.012], [-0.018, 0.02], [-0.02, 0.016], [-0.01, 0.006], [-0.006, -0.001]], 0.008, 0.0008)], M.steel, [-0.003, 0, 0]));
  g.add(part('trigger', [side([[0.052, -0.019], [0.059, -0.019], ['q', 0.062, -0.03, 0.058, -0.04], [0.052, -0.038]], 0.006, 0.0008)], M.steel, [0.0, -0.019, -0.055]));
  // magazine: rides in the grip, tilted with it (authored around its own pivot)
  const mag = part('mag', [rect(-0.011, 0.011, -0.086, 0.0, 0.016, 0.0008), rect(-0.016, 0.016, -0.092, -0.086, 0.023, 0.0008)], M.steelDark, [0, -0.018, -0.018], true);
  mag.rotation.x = -18 * DEG; mag.userData.base.r.copy(mag.rotation);
  g.add(mag);
  g.add(marker('muzzle', 0, 0.014, -0.136));
  g.add(marker('eject', 0.016, 0.026, -0.072));
  g.userData = {
    id: 'pm', sightY: 0.036,
    hip: { p: [0.13, -0.14, -0.31], r: [0.0, -0.06, 0.02] },
    ads: { p: [0, -0.036, -0.30], r: [0, 0, 0] },
    grips: {
      right: { p: [0.0, -0.062, -0.002], r: handEuler([1, 0, 0], [0.15, -0.35, 0.92]) },
      left: { p: [-0.024, -0.08, -0.03], r: handEuler([0.8, 0.1, 0.55], [-0.45, -0.4, 0.8]) },
    },
    lowerRot: [0.35, 0.2, 0.15],
    magTravel: [0, -0.16, 0.02], cycle: 'slide', slideTravel: 0.03, ejectDir: [1, 0.6, 0.25],
  };
  return g;
}

// ---------------------------------------------------------------- AKM
function buildAKM(M) {
  const g = new THREE.Group(); g.name = 'akm';
  const P = new Parts();
  P.add(M.steelDark, side([[0.0, 0.0], [0.262, 0.0], [0.262, 0.046], [0.0, 0.046]], 0.034, 0.0015));                                        // stamped receiver
  P.add(M.steel, side([[0.02, 0.046], [0.262, 0.046], [0.262, 0.056], ['q', 0.262, 0.07, 0.246, 0.07], [0.036, 0.07], ['q', 0.02, 0.07, 0.02, 0.056]], 0.031, 0.0015));   // dust cover
  P.add(M.steel, rect(0.262, 0.31, 0.03, 0.074, 0.034, 0.0012, 0.003));                            // rear sight block
  P.add(M.steel, rect(0.27, 0.305, 0.074, 0.08, 0.012, 0.0006));                                   // tangent leaf
  P.add(M.steel, at(box(0.014, 0.004, 0.006), 0, 0.083, -0.302));                                  // leaf slider
  P.add(M.steel, at(cylZ(0.0095, 0.0085, 0.42, 14), 0, 0.05, -0.52));                              // barrel
  P.add(M.steel, at(cylZ(0.0068, 0.0068, 0.235, 12), 0, 0.074, -0.4175));                          // gas tube
  P.add(M.steel, rect(0.52, 0.55, 0.036, 0.086, 0.026, 0.001, 0.003));                              // gas block
  P.add(M.steel, rect(0.655, 0.685, 0.04, 0.064, 0.026, 0.001, 0.003));                             // front sight base
  P.add(M.steel, at(cylY(0.0015, 0.0015, 0.03, 6), 0, 0.078, -0.67));                              // sight post
  P.add(M.steel, at(ringZ(0.011, 0.0018, 0, Math.PI, 10, 5), 0, 0.079, -0.67));                      // sight hood
  P.add(M.steel, at(box(0.003, 0.024, 0.006), 0.011, 0.07, -0.67)); P.add(M.steel, at(box(0.003, 0.024, 0.006), -0.011, 0.07, -0.67));  // ears
  P.add(M.steel, at(cylZ(0.0025, 0.0025, 0.38, 6), 0, 0.037, -0.5));                              // cleaning rod
  P.add(M.steel, slantFront(at(cylZ(0.011, 0.011, 0.036, 12), 0, 0.05, -0.737), -0.755, 0.55));    // slant brake
  P.add(M.wood, side([[0.31, 0.024], [0.51, 0.024], ['q', 0.525, 0.024, 0.525, 0.04], [0.51, 0.046], [0.31, 0.046]], 0.044, 0.002));          // lower handguard
  P.add(M.wood, side([[0.325, 0.064], [0.515, 0.064], [0.515, 0.084], ['q', 0.515, 0.09, 0.505, 0.09], [0.33, 0.09], ['q', 0.325, 0.09, 0.325, 0.084]], 0.028, 0.0015)); // upper handguard
  P.add(M.wood, side([[0.0, 0.043], [-0.34, 0.03], ['q', -0.352, 0.028, -0.352, 0.016], [-0.352, -0.085], ['q', -0.35, -0.096, -0.34, -0.094], [-0.03, -0.008], [0.0, 0.0]], 0.042, 0.002));   // stock
  P.add(M.steel, rect(-0.356, -0.348, -0.096, 0.03, 0.045, 0.0008));                              // buttplate
  P.add(M.bakelite, side([[0.035, 0.0], [0.05, -0.004], [0.018, -0.095], ['q', 0.002, -0.1, -0.006, -0.09], [-0.02, -0.004], [0.0, 0.0]], 0.03, 0.0022));   // pistol grip
  P.add(M.steel, guardU(0.042, 0.128, -0.002, 0.03, 0.004, 0.012));                                // trigger guard
  P.add(M.steel, at(box(0.012, 0.012, 0.03), 0.0, -0.01, -0.135));                                 // mag catch housing
  P.add(M.steel, at(side([[0.03, 0.03], [0.11, 0.03], [0.112, 0.034], [0.03, 0.04]], 0.003, 0.0005), 0.018, 0, 0));   // selector lever (right)
  P.add(M.steel, at(box(0.006, 0.02, 0.006), 0.019, 0.032, -0.036));                               // selector pivot
  P.add(M.steel, at(ringX(0.005, 0.0012, 0, Math.PI * 2, 10, 5), -0.02, -0.02, 0.03));             // rear sling loop
  P.into(g);
  // magazine (curved bakelite banana)
  const mag = part('mag', [
    side([[0.116, 0.004], ['q', 0.112, -0.11, 0.166, -0.205], [0.235, -0.185], ['q', 0.196, -0.09, 0.19, 0.004]], 0.024, 0.0022, 12),
  ], M.bakelite, [0, 0, -0.15]);
  mag.add(sub(part('floor', [side([[0.16, -0.205], [0.235, -0.185], [0.236, -0.193], [0.16, -0.214]], 0.026, 0.0008)], M.steel, [0, 0, -0.15])));
  g.add(mag);
  // charging handle on the carrier, moves back on fire
  const bolt = part('bolt', [at(box(0.016, 0.012, 0.03), 0.021, 0.04, -0.11), at(box(0.022, 0.012, 0.012), 0.026, 0.04, -0.11)], M.steel, [0, 0, -0.11]);
  g.add(bolt);
  g.add(part('trigger', [side([[0.072, -0.006], [0.08, -0.006], ['q', 0.084, -0.02, 0.078, -0.027], [0.071, -0.024]], 0.006, 0.0008)], M.steel, [0, -0.006, -0.075]));
  g.add(marker('muzzle', 0, 0.05, -0.758));
  g.add(marker('eject', 0.02, 0.05, -0.1));
  g.userData = {
    id: 'akm', sightY: 0.088,
    hip: { p: [0.13, -0.15, -0.2], r: [0.03, -0.1, 0.03] },
    ads: { p: [0.0, -0.096, 0.08], r: [0.012, 0, 0] },
    grips: {
      right: { p: [0.0, -0.05, -0.016], r: handEuler([1, 0, 0], [0.2, -0.4, 0.9]) },
      left: { p: [0, 0.024, -0.42], r: handEuler([0.25, 1, 0.1], [-0.85, -0.45, 0.3]) },
    },
    lowerRot: [0.45, 0.35, 0.25],
    magTravel: [0, -0.2, -0.06], cycle: 'bolt', slideTravel: 0.11, ejectDir: [1, 0.5, 0.35],
  };
  return g;
}

// ---------------------------------------------------------------- TOZ-34 (over/under)
function buildTOZ(M) {
  const g = new THREE.Group(); g.name = 'toz';
  const P = new Parts();
  P.add(M.steel, side([[0.0, -0.022], [0.092, -0.022], [0.092, 0.036], ['q', 0.06, 0.04, 0.02, 0.036], [0.0, 0.034]], 0.042, 0.002));   // action body
  P.add(M.steel, rect(-0.03, 0.02, 0.034, 0.04, 0.008, 0.0006));                                    // top lever
  P.add(M.steel, at(box(0.02, 0.005, 0.014), 0, 0.037, 0.03));                                     // lever thumb piece
  P.add(M.steel, guardU(0.004, 0.1, -0.022, 0.034, 0.004, 0.012));                                 // trigger guard
  P.add(M.wood, side([[0.0, 0.03], [-0.36, 0.024], ['q', -0.372, 0.022, -0.372, 0.01], [-0.372, -0.092], ['q', -0.37, -0.104, -0.358, -0.102], [-0.16, -0.086], ['q', -0.08, -0.084, -0.056, -0.06], [-0.02, -0.03], [0.0, -0.022]], 0.046, 0.0025));   // stock
  P.add(M.rubber, rect(-0.384, -0.372, -0.104, 0.024, 0.048, 0.0015, 0.004));                       // buttpad
  P.add(M.steel, at(ringX(0.005, 0.0012, 0, Math.PI * 2, 10, 5), 0, -0.098, 0.28));                 // sling swivel
  P.into(g);
  // barrels group: pivots at the hinge in front of the action
  const H = [0, -0.012, -0.092];
  const barrels = part('barrels', [
    at(cylZ(0.0105, 0.0092, 0.71, 14), 0, 0.023, -0.092 - 0.355),           // upper barrel
    at(cylZ(0.0105, 0.0092, 0.71, 14), 0, 0.0, -0.092 - 0.355),             // lower barrel
    at(box(0.006, 0.024, 0.7), 0, 0.0115, -0.092 - 0.35),                   // side rib joining them
    at(box(0.008, 0.004, 0.66), 0, 0.034, -0.092 - 0.36),                   // ventilated top rib
    at(cylZ(0.016, 0.016, 0.04, 14), 0, 0.012, -0.112),                     // monobloc
    at(cylZ(0.0025, 0.0025, 0.004, 6), 0, 0.04, -0.795),                    // front bead
  ], M.steel, H);
  barrels.add(part('bores', [at(cylZ(0.0075, 0.0075, 0.002, 12), 0, 0.023, -0.802), at(cylZ(0.0075, 0.0075, 0.002, 12), 0, 0.0, -0.802)], M.bore, H));
  barrels.add(part('foreend', [side([[0.12, -0.036], [0.36, -0.03], ['q', 0.38, -0.028, 0.372, -0.012], [0.36, -0.008], [0.12, -0.01]], 0.04, 0.002)], M.wood, H));
  for (const c of barrels.children) sub(c);
  g.add(barrels);
  g.add(part('trigger', [side([[0.04, -0.026], [0.047, -0.026], ['q', 0.05, -0.036, 0.046, -0.044], [0.04, -0.042]], 0.005, 0.0008)], M.steel, [0, -0.026, -0.043]));
  g.add(part('trigger2', [side([[0.058, -0.026], [0.065, -0.026], ['q', 0.068, -0.036, 0.064, -0.044], [0.058, -0.042]], 0.005, 0.0008)], M.steel, [0, -0.026, -0.061]));
  g.add(marker('muzzle', 0, 0.012, -0.806));
  g.add(marker('eject', 0.0, 0.03, -0.1));
  g.userData = {
    id: 'toz', sightY: 0.038,
    hip: { p: [0.14, -0.16, -0.2], r: [0.03, -0.1, 0.04] },
    ads: { p: [0.0, -0.044, 0.06], r: [0.006, 0, 0] },
    grips: {
      right: { p: [0.0, -0.036, 0.05], r: handEuler([0.9, 0.3, -0.3], [0.1, 0.7, 0.7]) },
      left: { p: [0, -0.02, -0.33], r: handEuler([0.25, 1, 0.1], [-0.85, -0.45, 0.3]) },
    },
    lowerRot: [0.45, 0.35, 0.25],
    cycle: 'none', breakAngle: -0.55, ejectDir: [0.3, 1, 0.9],
  };
  return g;
}

// ---------------------------------------------------------------- Mosin-Nagant M91/30
function buildMosin(M) {
  const g = new THREE.Group(); g.name = 'mosin';
  const P = new Parts();
  P.add(M.woodDark, side([
    [-0.40, 0.046], ['q', -0.30, 0.052, -0.20, 0.044], ['q', -0.10, 0.036, -0.04, 0.02], [0.0, 0.014], [0.1, 0.012], [0.70, 0.018], ['q', 0.72, 0.018, 0.72, 0.006], [0.70, -0.006],
    [0.1, -0.02], [0.0, -0.024], ['q', -0.05, -0.03, -0.09, -0.052], ['q', -0.2, -0.078, -0.40, -0.094], ['q', -0.408, -0.094, -0.408, -0.08], [-0.408, 0.036],
  ], 0.042, 0.0025));                                                                              // full-length stock
  P.add(M.woodDark, side([[0.19, 0.03], [0.64, 0.03], ['q', 0.65, 0.03, 0.65, 0.04], ['q', 0.645, 0.05, 0.63, 0.05], [0.2, 0.05], ['q', 0.19, 0.05, 0.19, 0.04]], 0.036, 0.0018));   // handguard
  P.add(M.steel, at(cylZ(0.016, 0.014, 0.12, 14), 0, 0.03, -0.06));                                // receiver
  P.add(M.steel, at(cylZ(0.013, 0.0072, 0.7, 14), 0, 0.03, -0.47));                                // barrel
  P.add(M.steel, at(cylZ(0.0072, 0.0068, 0.03, 12), 0, 0.03, -0.827));                              // muzzle crown
  P.add(M.steel, rect(0.345, 0.36, -0.026, 0.056, 0.048, 0.001, 0.003));                            // rear band
  P.add(M.steel, rect(0.63, 0.645, -0.014, 0.054, 0.044, 0.001, 0.003));                            // front band
  P.add(M.steel, rect(0.16, 0.2, 0.038, 0.046, 0.024, 0.0008));                                     // rear sight base
  P.add(M.steel, rect(0.17, 0.2, 0.046, 0.056, 0.016, 0.0006));                                     // sight leaf (down)
  P.add(M.steel, at(cylY(0.0014, 0.0014, 0.02, 6), 0, 0.047, -0.83));                               // front post
  P.add(M.steel, at(ringZ(0.011, 0.0016, -0.15 * Math.PI, Math.PI * 1.3, 10, 5), 0, 0.045, -0.83)); // hood
  P.add(M.steel, at(box(0.03, 0.036, 0.09), 0, -0.03, -0.045));                                     // magazine housing
  P.add(M.steel, rect(-0.412, -0.404, -0.096, 0.048, 0.044, 0.0008));                                // buttplate
  P.add(M.steel, guardU(-0.048, 0.0, -0.022, 0.028, 0.0035, 0.012));                                 // trigger guard
  P.add(M.steel, at(ringX(0.005, 0.0012, 0, Math.PI * 2, 10, 5), 0, -0.1, 0.32));                     // sling escutcheon
  P.add(M.steel, at(box(0.012, 0.004, 0.02), -0.016, 0.036, 0.03));                                  // tang detail
  P.into(g);
  // bolt: body, straight handle with knob, cocking piece. pivot on the bore axis at the handle root
  const B = [0, 0.03, -0.03];
  const bolt = part('bolt', [
    at(cylZ(0.0085, 0.0085, 0.09, 12), 0, 0.03, -0.035),
    at(cylX(0.005, 0.0042, 0.034, 8), 0.024, 0.03, -0.03),
    at(sphere(0.0085, 10), 0.043, 0.03, -0.03),
    at(cylZ(0.0075, 0.007, 0.02, 10), 0, 0.03, 0.02),
    at(box(0.006, 0.018, 0.012), 0, 0.03, 0.01),
  ], M.steel, B);
  g.add(bolt);
  g.add(part('trigger', [side([[-0.02, -0.026], [-0.013, -0.026], ['q', -0.01, -0.036, -0.014, -0.043], [-0.02, -0.041]], 0.005, 0.0008)], M.steel, [0, -0.026, 0.017]));
  const mag = part('mag', [rect(0.005, 0.085, -0.052, -0.046, 0.026, 0.0008)], M.steel, [0, -0.048, -0.045]);   // floor plate
  g.add(mag);
  g.add(marker('muzzle', 0, 0.03, -0.845));
  g.add(marker('eject', 0.02, 0.045, -0.03));
  g.userData = {
    id: 'mosin', sightY: 0.056,
    hip: { p: [0.14, -0.16, -0.16], r: [0.03, -0.1, 0.04] },
    ads: { p: [0.0, -0.062, 0.1], r: [0.006, 0, 0] },
    grips: {
      right: { p: [0.0, -0.02, 0.07], r: handEuler([0.9, 0.3, -0.3], [0.1, 0.7, 0.7]) },
      left: { p: [0, 0.006, -0.36], r: handEuler([0.25, 1, 0.1], [-0.85, -0.45, 0.3]) },
    },
    lowerRot: [0.45, 0.35, 0.25],
    magTravel: [0, -0.02, 0], cycle: 'mosin', boltTravel: 0.075, ejectDir: [1, 0.7, 0.2],
  };
  return g;
}

const BUILDERS = { pm: buildPM, akm: buildAKM, toz: buildTOZ, mosin: buildMosin };
export function buildGun(id) {
  const M = materials();
  const build = BUILDERS[id] || buildPM;
  const g = build(M);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
  return g;
}

// ---------------------------------------------------------------- hands
// Right hand in its gripping frame: wrist at the origin, palm slab in the YZ plane facing -x, knuckles toward -z,
// fingers curling toward -x around a vertical bar. The left hand is the mirror (scale.x = -1).
export const HAND_GRIP = new THREE.Vector3(-0.031, 0, -0.092);   // local point that sits on the grip axis
function buildHand(M, mirror) {
  const g = new THREE.Group(); g.name = mirror ? 'handL' : 'handR';
  const P = new Parts();
  // palm: a rounded slab, wider at the knuckles, thicker at the heel
  P.add(M.glove, side([[0.0, -0.038], [0.082, -0.032], ['q', 0.09, -0.03, 0.09, -0.02], [0.09, 0.03], ['q', 0.09, 0.04, 0.08, 0.04], [0.0, 0.044], ['q', -0.012, 0.043, -0.012, 0.03], [-0.012, -0.03], ['q', -0.012, -0.038, 0.0, -0.038]], 0.026, 0.004));
  P.add(M.glove, at(cylY(0.011, 0.011, 0.078, 10), -0.004, 0, -0.088));      // knuckle ridge
  // fingers: three phalanges each, curling about y
  const rows = [[0.03, 1.0], [0.01, 1.08], [-0.01, 1.0], [-0.03, 0.82]];
  for (const [y, scale] of rows) {
    let x = -0.006, z = -0.088, r = 0.0085;
    const lens = [0.036 * scale, 0.028 * scale, 0.022 * scale];
    const angs = [58 * DEG, 128 * DEG, 186 * DEG];
    for (let i = 0; i < 3; i++) {
      const dx = -Math.sin(angs[i]) * lens[i], dz = -Math.cos(angs[i]) * lens[i];
      const seg = cylY(r, r * 0.9, lens[i], 8);
      seg.rotateX(Math.PI / 2);                       // +y -> +z
      seg.rotateY(Math.atan2(dx, dz));                 // +z -> segment direction
      seg.translate(x + dx / 2, y, z + dz / 2);
      P.add(M.glove, seg);
      P.add(M.glove, at(sphere(r * 1.02, 8), x + dx, y, z + dz));
      x += dx; z += dz; r *= 0.92;
    }
  }
  // thumb: from the index side near the wrist, over the top of the grip
  {
    let x = -0.006, y = 0.042, z = -0.03, r = 0.01;
    const dirs = [[-0.55, 0.15, -0.8], [-0.9, -0.1, -0.35]];
    const lens = [0.04, 0.03];
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Vector3(...dirs[i]).normalize();
      const seg = cylY(r, r * 0.9, lens[i], 8);
      seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
      seg.translate(x + d.x * lens[i] / 2, y + d.y * lens[i] / 2, z + d.z * lens[i] / 2);
      P.add(M.glove, seg);
      x += d.x * lens[i]; y += d.y * lens[i]; z += d.z * lens[i];
      P.add(M.glove, at(sphere(r * 0.98, 8), x, y, z));
      r *= 0.9;
    }
  }
  // wrist and jacket cuff
  P.add(M.glove, at(cylZ(0.024, 0.021, 0.04, 12), 0.0, 0.0, 0.016));
  P.add(M.cuff, at(cylZ(0.036, 0.03, 0.07, 12), 0.0, 0.004, 0.065));
  P.add(M.cuff, at(cylZ(0.037, 0.037, 0.008, 12), 0.0, 0.004, 0.036));   // cuff seam
  P.into(g);
  if (mirror) g.scale.x = -1;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
  return g;
}
export function buildHands() {
  const M = materials();
  return { right: buildHand(M, false), left: buildHand(M, true) };
}

// spent case: a rimmed cylinder of unit diameter and length along z, scaled per calibre by the caller
export function casingGeometry() {
  const g = mergeGeometries([cylZ(0.5, 0.42, 1.0, 8).toNonIndexed(), at(cylZ(0.56, 0.56, 0.08, 8).toNonIndexed(), 0, 0, 0.46)], false);
  g.deleteAttribute('uv');
  const c = toCreasedNormals(g, 50 * DEG); c.computeBoundingSphere();
  return c;
}
