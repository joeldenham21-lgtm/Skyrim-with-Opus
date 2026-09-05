// Vegetation of the Pechorsk zone. Dead birches and pines, fallen logs, stumps and bare bushes live in ONE
// BatchedMesh (one draw call, per-instance culling, distance LOD, shadows). Grass is a streamed window of
// wind-swept tufts around the camera; reeds stand along the water line in a few frustum-culled chunks.
// Trunk colliders, cover points and hiding spots are registered with the world. Everything is seeded from
// ctx.rng.fork so the zone is the same for a given seed.
import * as THREE from 'three';
import { mulberry32, fbm2, hash2 } from '../core/rng.js';
import { clamp01, smoothstep, lerp, TAU } from '../core/math.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';

const UP = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const C = (hex) => new THREE.Color(hex);                       // sRGB hex -> linear working colour
const mixC = (a, b, t, out) => out.copy(a).lerp(b, t);
const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
const tmpC = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Shared wind state. One uniform drives grass, reeds, twigs; debris.js reads .dir/.strength.
// ---------------------------------------------------------------------------------------------
const wind = {
  dir: new THREE.Vector3(0.6, 0, 0.8).normalize(),   // blows from the north-west toward the south-east
  strength: 0.6,
  uniform: { value: new THREE.Vector4(0.6, 0.8, 0.6, 0) },   // (dir.x, dir.z, strength, time)
};
function updateWind(t, storm) {
  const ang = 0.64 + 0.2 * Math.sin(t * 0.011) + 0.07 * Math.sin(t * 0.047 + 2.0);    // slowly veering
  wind.dir.set(Math.sin(ang), 0, Math.cos(ang));
  let g = 0.5 + 0.22 * Math.sin(t * 0.37) + 0.14 * Math.sin(t * 1.21 + 1.3) + 0.09 * Math.sin(t * 2.9 + 0.4) + 0.05 * Math.sin(t * 5.3);
  g = clamp01(g + storm * 0.4);
  wind.strength = g;
  wind.uniform.value.set(wind.dir.x, wind.dir.z, g, t);
}

// Software GL (SwiftShader, llvmpipe) is vertex-bound: thin the vegetation so the game stays playable there.
function isSoftwareGL(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software/i.test(s);
  } catch (e) { return false; }
}

// ---------------------------------------------------------------------------------------------
// Geometry builder: raw arrays with position / normal / colour / aTree (flex, radius, bark).
// ---------------------------------------------------------------------------------------------
class Builder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.ext = []; this.idx = []; this.n = 0; }
  vertex(x, y, z, nx, ny, nz, c, flex = 0, r = 0, bark = 0) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(c.r, c.g, c.b); this.ext.push(flex, r, bark);
    return this.n++;
  }
  face(a, b, c) { this.idx.push(a, b, c); }
  // Tapered tube along a path of {x,y,z,r} points. fn(t, i) -> { c: Color, flex, bark }. Frames are parallel-transported.
  tube(path, segs, fn) {
    const n = path.length, base = this.n;
    const tangent = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = path[i], a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      tangent.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      if (i === 0) n1.crossVectors(tangent, Math.abs(tangent.y) < 0.9 ? UP : XAXIS).normalize();
      else { n1.addScaledVector(tangent, -n1.dot(tangent)); if (n1.lengthSq() < 1e-6) n1.crossVectors(tangent, XAXIS); n1.normalize(); }
      n2.crossVectors(tangent, n1).normalize();
      const info = fn(i / (n - 1), i);
      for (let s = 0; s < segs; s++) {
        const ang = (s / segs) * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const rx = n1.x * ca + n2.x * sa, ry = n1.y * ca + n2.y * sa, rz = n1.z * ca + n2.z * sa;
        this.vertex(p.x + rx * p.r, p.y + ry * p.r, p.z + rz * p.r, rx, ry, rz, info.c, info.flex, p.r, info.bark);
      }
    }
    // winding: make the first quad's face normal agree with the radial normal, then use that order throughout
    let flip = false;
    {
      const a = base, b = base + 1, c = base + segs;
      const P = this.pos, N = this.nrm;
      const e1 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const e2 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
      const fx = e1[1] * e2[2] - e1[2] * e2[1], fy = e1[2] * e2[0] - e1[0] * e2[2], fz = e1[0] * e2[1] - e1[1] * e2[0];
      flip = fx * N[a * 3] + fy * N[a * 3 + 1] + fz * N[a * 3 + 2] < 0;
    }
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < segs; s++) {
      const a = base + i * segs + s, b = base + i * segs + (s + 1) % segs, c = a + segs, d = b + segs;
      if (flip) { this.face(a, b, c); this.face(b, d, c); } else { this.face(a, c, b); this.face(b, c, d); }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.ext, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Grow a bent path from start along dir. curl bends it up (+) or down (-) over its length; wobble adds kinks.
function grow(rnd, start, dir, len, n, r0, opts = {}) {
  const pts = [];
  const d = dir.clone().normalize(), p = start.clone();
  const curl = opts.curl ?? 0, wobble = opts.wobble ?? 0.2, taper = opts.taper ?? 0.8, rMin = opts.rMin ?? 0.006;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: p.x, y: p.y, z: p.z, r: r0 * Math.pow(1 - t, taper) + rMin });
    if (i === n) break;
    d.y += curl / n;
    d.x += (rnd() - 0.5) * wobble; d.z += (rnd() - 0.5) * wobble; d.y += (rnd() - 0.5) * wobble * 0.5;
    d.normalize();
    p.addScaledVector(d, len / n);
  }
  return pts;
}
// point and tangent at param t of a path
function along(path, t, outP, outT) {
  const f = t * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)), u = f - i;
  const a = path[i], b = path[i + 1];
  outP.set(lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u));
  outT.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  return lerp(a.r, b.r, u);
}
// a direction rotated away from `axis` by `angle` around a random perpendicular
function splay(rnd, axis, angle, out) {
  const perp = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(axis);
  if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
  perp.normalize();
  return out.copy(axis).multiplyScalar(Math.cos(angle)).addScaledVector(perp, Math.sin(angle)).normalize();
}
// every other point of a path (ends kept) for the low detail level
function subsample(path) {
  if (path.length <= 3) return path;
  const out = [];
  for (let i = 0; i < path.length; i += 2) out.push(path[i]);
  if (out[out.length - 1] !== path[path.length - 1]) out.push(path[path.length - 1]);
  return out;
}

// A tree description is a list of tubes { path, segs, level, fn } plus extra faces; it is emitted at two
// detail levels so far trees cost a fraction of near ones while keeping the same trunk and limbs.
function emit(desc, lod) {
  const B = new Builder();
  for (const t of desc.tubes) {
    if (lod === 'low' && t.level > 2) continue;
    if (lod === 'low') B.tube(subsample(t.path), Math.max(3, t.segs - 2), t.fn);
    else B.tube(t.path, t.segs, t.fn);
  }
  if (desc.extra) desc.extra(B);
  return B.build();
}

// ---------------------------------------------------------------------------------------------
// Tree variants
// ---------------------------------------------------------------------------------------------
const PAL = {
  birch: C(0xc9c6bd), birchGrey: C(0x9d9a92), birchBase: C(0x2b2724), birchPeel: C(0x8a7466),
  birchBranch: C(0x8f8a80), birchTwig: C(0x3a332e), birchTwigTip: C(0x4d443c),
  pineA: C(0x4a3e35), pineB: C(0x6a635a), pineLimb: C(0x3d342c), pineTwig: C(0x2f2924),
  woodOld: C(0x6f665a), woodRot: C(0x3a2f27), woodCut: C(0x9c8c72),
  bushA: C(0x3b332c), bushB: C(0x5a5047),
};
// colour functions are built once per tube and capture their own Color, so emit() can run twice
const shade = (fnOf) => { const c = new THREE.Color(); return (t, i) => fnOf(t, i, c); };

function birchVariant(rnd) {
  const tubes = [];
  const H = rnd.range(6.5, 10), R0 = rnd.range(0.17, 0.27);
  const leanA = rnd() * TAU, lean = rnd.range(0.02, 0.1), bendPhase = rnd() * TAU, bendAmp = rnd.range(0.08, 0.3);
  const rings = 9, trunk = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1), y = t * H;
    const s = Math.sin(t * Math.PI * 1.3 + bendPhase) * bendAmp * t;
    trunk.push({ x: Math.cos(leanA) * (lean * y * y / H + s), y, z: Math.sin(leanA) * (lean * y * y / H + s * 0.6), r: R0 * Math.pow(1 - t, 0.72) + 0.02 });
  }
  const greyBand = Array.from({ length: rings }, () => rnd() < 0.3 ? rnd.range(0.3, 0.75) : 0);
  tubes.push({ path: trunk, segs: 7, level: 0, fn: shade((t, i, c) => {
    mixC(PAL.birch, PAL.birchGrey, greyBand[Math.min(rings - 1, Math.round(t * (rings - 1)))], c);
    // soot-dark base, then bright bark; near the top the bark thins to a branch grey
    c.lerp(PAL.birchBase, 1 - smoothstep(0.02, 0.16, t)).lerp(PAL.birchBranch, smoothstep(0.75, 1, t) * 0.6);
    return { c, flex: t * t * 0.12, bark: 1 };
  }) });
  const P = new THREE.Vector3(), T = new THREE.Vector3(), dir = new THREE.Vector3();
  // a broken snag low on the trunk
  if (rnd() < 0.6) {
    const r = along(trunk, rnd.range(0.2, 0.45), P, T);
    splay(rnd, UP, rnd.range(1.1, 1.5), dir);
    tubes.push({ path: grow(rnd, P, dir, rnd.range(0.25, 0.6), 2, r * 0.45, { curl: 0.2, wobble: 0.1, rMin: 0.015 }), segs: 4, level: 1, fn: shade((t, i, c) => ({ c: mixC(PAL.birchGrey, PAL.woodRot, t, c), flex: 0.1, bark: 0.4 })) });
  }
  const nL1 = rnd.int(3, 5);
  for (let k = 0; k < nL1; k++) {
    const at = rnd.range(0.42, 0.9);
    const r = along(trunk, at, P, T);
    const az = rnd() * TAU, elev = rnd.range(0.55, 1.15);
    dir.set(Math.cos(az) * Math.sin(elev), Math.cos(elev), Math.sin(az) * Math.sin(elev));
    const len = H * rnd.range(0.16, 0.3) * (1.15 - at * 0.5);
    const l1 = grow(rnd, P, dir, len, 4, r * 0.55, { curl: rnd.range(0.3, 0.9), wobble: 0.3, rMin: 0.012 });
    tubes.push({ path: l1, segs: 5, level: 1, fn: shade((t, i, c) => ({ c: mixC(PAL.birch, PAL.birchBranch, smoothstep(0, 0.7, t), c), flex: 0.15 + 0.35 * t, bark: 1 - t * 0.6 })) });
    const nL2 = rnd.int(1, 3);
    for (let j = 0; j < nL2; j++) {
      const r2 = along(l1, rnd.range(0.3, 0.9), P, T);
      splay(rnd, T, rnd.range(0.5, 1.0), dir); dir.y += 0.25; dir.normalize();
      const l2 = grow(rnd, P, dir, len * rnd.range(0.35, 0.6), 3, r2 * 0.6, { curl: rnd.range(0.2, 0.7), wobble: 0.35, rMin: 0.009 });
      tubes.push({ path: l2, segs: 4, level: j === 0 ? 2 : 3, fn: shade((t, i, c) => ({ c: mixC(PAL.birchBranch, PAL.birchTwig, t, c), flex: 0.45 + 0.35 * t, bark: 0.3 * (1 - t) })) });
      const nL3 = rnd.int(1, 2);
      for (let m = 0; m < nL3; m++) {
        const r3 = along(l2, rnd.range(0.35, 0.95), P, T);
        splay(rnd, T, rnd.range(0.5, 1.1), dir); dir.y += 0.2; dir.normalize();
        tubes.push({ path: grow(rnd, P, dir, len * rnd.range(0.18, 0.35), 2, Math.max(0.012, r3 * 0.6), { curl: rnd.range(0.1, 0.5), wobble: 0.5, rMin: 0.006 }), segs: 3, level: 3, fn: shade((t, i, c) => ({ c: mixC(PAL.birchTwig, PAL.birchTwigTip, t, c), flex: 0.8 + 0.2 * t, bark: 0 })) });
      }
    }
    if (rnd() < 0.7) {
      const r2 = along(l1, rnd.range(0.5, 0.95), P, T);
      splay(rnd, T, rnd.range(0.6, 1.2), dir); dir.y += 0.3; dir.normalize();
      tubes.push({ path: grow(rnd, P, dir, len * rnd.range(0.2, 0.4), 2, Math.max(0.012, r2 * 0.5), { curl: 0.3, wobble: 0.5, rMin: 0.006 }), segs: 3, level: 3, fn: shade((t, i, c) => ({ c: mixC(PAL.birchTwig, PAL.birchTwigTip, t, c), flex: 0.8 + 0.2 * t, bark: 0 })) });
    }
  }
  // crown twigs at the very top
  const top = trunk[rings - 1];
  for (let k = 0; k < rnd.int(2, 3); k++) {
    dir.set(rnd() - 0.5, rnd.range(0.6, 1.2), rnd() - 0.5).normalize();
    tubes.push({ path: grow(rnd, new THREE.Vector3(top.x, top.y - 0.1, top.z), dir, rnd.range(0.8, 1.6), 2, 0.02, { curl: 0.3, wobble: 0.5 }), segs: 3, level: k === 0 ? 2 : 3, fn: shade((t, i, c) => ({ c: mixC(PAL.birchTwig, PAL.birchTwigTip, t, c), flex: 0.9 + 0.1 * t, bark: 0 })) });
  }
  return { tubes, h: H, r: R0, kind: 'birch' };
}

function pineVariant(rnd) {
  const tubes = [];
  const snapped = rnd() < 0.3;
  const H = snapped ? rnd.range(6, 9) : rnd.range(8.5, 14), R0 = rnd.range(0.22, 0.34);
  const leanA = rnd() * TAU, lean = rnd.range(0.0, 0.05);
  const rings = 8, trunk = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1), y = t * H;
    const jag = snapped && i === rings - 1 ? 0.35 : 0;
    trunk.push({ x: Math.cos(leanA) * lean * y * y / H, y: y + (rnd() - 0.5) * jag, z: Math.sin(leanA) * lean * y * y / H, r: R0 * Math.pow(1 - t * (snapped ? 0.55 : 0.92), 0.6) + 0.015 });
  }
  const bark = mixC(PAL.pineA, PAL.pineB, rnd(), new THREE.Color());
  const bare = Array.from({ length: rings }, () => rnd() < 0.4 ? rnd.range(0.3, 0.8) : 0);   // patches where bark has fallen off
  tubes.push({ path: trunk, segs: 7, level: 0, fn: shade((t, i, c) => {
    mixC(bark, PAL.pineB, bare[Math.min(rings - 1, Math.round(t * (rings - 1)))], c);
    c.lerp(PAL.birchBase, 1 - smoothstep(0.0, 0.1, t));
    return { c, flex: t * t * 0.06, bark: 0.5 };
  }) });
  const P = new THREE.Vector3(), T = new THREE.Vector3(), dir = new THREE.Vector3();
  const nLimbs = snapped ? rnd.int(3, 5) : rnd.int(5, 8);
  for (let k = 0; k < nLimbs; k++) {
    const at = rnd.range(snapped ? 0.35 : 0.5, 0.96);
    const r = along(trunk, at, P, T);
    const az = rnd() * TAU, elev = rnd.range(1.25, 1.65);          // nearly horizontal, then drooping
    dir.set(Math.cos(az) * Math.sin(elev), Math.cos(elev), Math.sin(az) * Math.sin(elev));
    const len = H * rnd.range(0.1, 0.2) * (1.3 - at * 0.6);
    const limb = grow(rnd, P, dir, len, 4, Math.max(0.03, r * 0.5), { curl: -rnd.range(0.4, 1.1), wobble: 0.2, rMin: 0.01 });
    tubes.push({ path: limb, segs: 5, level: 1, fn: shade((t, i, c) => ({ c: mixC(bark, PAL.pineLimb, t, c), flex: 0.2 + 0.4 * t, bark: 0.5 - t * 0.4 })) });
    const nT = rnd.int(1, 3);
    for (let j = 0; j < nT; j++) {
      const r2 = along(limb, rnd.range(0.3, 0.95), P, T);
      splay(rnd, T, rnd.range(0.6, 1.2), dir); dir.y -= 0.35; dir.normalize();
      tubes.push({ path: grow(rnd, P, dir, len * rnd.range(0.25, 0.5), 2, Math.max(0.012, r2 * 0.5), { curl: -0.4, wobble: 0.4, rMin: 0.006 }), segs: 3, level: j === 0 ? 2 : 3, fn: shade((t, i, c) => ({ c: mixC(PAL.pineLimb, PAL.pineTwig, t, c), flex: 0.7 + 0.3 * t, bark: 0 })) });
    }
  }
  if (!snapped) {
    const top = trunk[rings - 1];
    dir.set(rnd() - 0.5, 1.5, rnd() - 0.5).normalize();
    tubes.push({ path: grow(rnd, new THREE.Vector3(top.x, top.y - 0.05, top.z), dir, rnd.range(0.6, 1.2), 2, 0.018, { curl: 0.2, wobble: 0.4 }), segs: 3, level: 2, fn: shade((t, i, c) => ({ c: mixC(PAL.pineLimb, PAL.pineTwig, t, c), flex: 0.9, bark: 0 })) });
  }
  return { tubes, h: H, r: R0, kind: 'pine' };
}

function logVariant(rnd) {
  const tubes = [];
  const L = rnd.range(3.5, 7), R0 = rnd.range(0.22, 0.38), birch = rnd() < 0.55;
  const sag = rnd.range(-0.12, 0.12);
  const path = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    path.push({ x: (t - 0.5) * L, y: Math.sin(t * Math.PI) * sag + (rnd() - 0.5) * 0.03, z: Math.sin(t * 5 + 1) * 0.05, r: R0 * (1 - t * 0.35) * (i === 0 || i === n ? 0.92 : 1) });
  }
  const side = birch ? PAL.birch : mixC(PAL.woodOld, PAL.pineB, rnd(), new THREE.Color());
  tubes.push({ path, segs: 7, level: 0, fn: shade((t, i, c) => {
    const end = smoothstep(0.08, 0.0, t) + smoothstep(0.92, 1.0, t);   // rotten dark ends
    return { c: mixC(side, PAL.woodRot, end * 0.8, c), flex: 0, bark: birch ? 1 : 0.5 };
  }) });
  const P = new THREE.Vector3(), T = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let k = 0; k < rnd.int(1, 3); k++) {
    const r = along(path, rnd.range(0.15, 0.85), P, T);
    dir.set(0, rnd.range(0.4, 1), 0).addScaledVector(new THREE.Vector3(0, 0, rnd() < 0.5 ? 1 : -1), rnd.range(0.3, 1)).normalize();
    tubes.push({ path: grow(rnd, P, dir, rnd.range(0.3, 0.9), 2, r * 0.35, { curl: 0.1, wobble: 0.2, rMin: 0.015 }), segs: 4, level: 1, fn: shade((t, i, c) => ({ c: mixC(side, PAL.woodRot, t, c), flex: 0.05, bark: 0.3 })) });
  }
  return { tubes, h: R0, r: R0, len: L, kind: 'log' };
}

function stumpVariant(rnd) {
  const H = rnd.range(0.35, 1.1), R0 = rnd.range(0.2, 0.36), birch = rnd() < 0.5;
  const path = [
    { x: 0, y: -0.15, z: 0, r: R0 * 1.45 },
    { x: 0, y: 0.12, z: 0, r: R0 * 1.12 },
    { x: 0, y: H * 0.6, z: 0, r: R0 },
    { x: 0, y: H, z: 0, r: R0 * 0.97 },
  ];
  const side = birch ? PAL.birch : mixC(PAL.pineA, PAL.pineB, rnd(), new THREE.Color());
  const tubes = [{ path, segs: 8, level: 0, fn: shade((t, i, c) => ({ c: mixC(side, PAL.birchBase, 1 - smoothstep(0.05, 0.4, t), c), flex: 0, bark: birch ? 1 : 0.5 })) }];
  // jagged, splintered top: a ring of spikes around a pale cut core
  const spikes = 8, hs = Array.from({ length: spikes }, () => rnd.range(-0.05, 0.3)), rot = Array.from({ length: spikes }, () => rnd() * 0.6);
  const extra = (B) => {
    const centre = B.vertex(0, H - 0.05, 0, 0, 1, 0, PAL.woodCut, 0, R0, 0.2);
    const base = B.n;
    for (let s = 0; s < spikes; s++) {
      const ang = (s / spikes) * TAU, rr = R0 * 0.97;
      B.vertex(Math.cos(ang) * rr, H + hs[s], Math.sin(ang) * rr, 0, 1, 0, mixC(PAL.woodCut, PAL.woodRot, rot[s], tmpC), 0, R0, 0.2);
    }
    for (let s = 0; s < spikes; s++) B.face(centre, base + (s + 1) % spikes, base + s);
  };
  return { tubes, extra, h: H, r: R0, kind: 'stump' };
}

function bushVariant(rnd) {
  const tubes = [];
  const n = rnd.int(14, 20), size = rnd.range(0.9, 1.6);
  const tone = mixC(PAL.bushA, PAL.bushB, rnd(), new THREE.Color());
  const P = new THREE.Vector3(), T = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const az = rnd() * TAU, elev = rnd.range(0.25, 1.05);
    dir.set(Math.cos(az) * Math.sin(elev), Math.cos(elev), Math.sin(az) * Math.sin(elev));
    const start = new THREE.Vector3(Math.cos(az) * 0.12 * rnd(), -0.05, Math.sin(az) * 0.12 * rnd());
    const twig = grow(rnd, start, dir, size * rnd.range(0.55, 1), 3, 0.022, { curl: rnd.range(0.2, 0.8), wobble: 0.45, rMin: 0.005 });
    tubes.push({ path: twig, segs: 3, level: k < 9 ? 1 : 3, fn: shade((t, i, c) => ({ c: mixC(tone, PAL.bushB, t * 0.5, c), flex: 0.35 + 0.65 * t, bark: 0 })) });
    if (rnd() < 0.45) {
      const r2 = along(twig, rnd.range(0.4, 0.8), P, T);
      splay(rnd, T, rnd.range(0.5, 1.0), dir);
      tubes.push({ path: grow(rnd, P, dir, size * rnd.range(0.25, 0.45), 2, Math.max(0.008, r2 * 0.6), { curl: 0.4, wobble: 0.5, rMin: 0.004 }), segs: 3, level: 3, fn: shade((t, i, c) => ({ c: mixC(tone, PAL.bushB, 0.4 + t * 0.4, c), flex: 0.75 + 0.25 * t, bark: 0 })) });
    }
  }
  return { tubes, h: size, r: size * 0.7, kind: 'bush' };
}

// ---------------------------------------------------------------------------------------------
// Tree material: vertex colours + bark detail noise, wind creak, distance silhouette floor for twigs.
// ---------------------------------------------------------------------------------------------
function treeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.uniforms.uWind = wind.uniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aTree; uniform vec4 uWind;
        varying vec3 vLocal; varying vec3 vTree; varying vec3 vInst;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position; vTree = aTree;
        #ifdef USE_BATCHING
          mat4 bmat = modelMatrix * batchingMatrix;
        #else
          mat4 bmat = modelMatrix;
        #endif
        vec3 wpos = (bmat * vec4(position, 1.0)).xyz;
        vInst = bmat[3].xyz;
        // wind: twigs flex, trunks barely creak. Gusts roll across the map as bands.
        float ph = vInst.x * 0.13 + vInst.z * 0.11;
        float band = 0.5 + 0.5 * sin(uWind.w * 0.5 + (vInst.x * uWind.x + vInst.z * uWind.y) * 0.04);
        float g = uWind.z * (0.4 + 0.6 * band);
        float sw = aTree.x * aTree.x * (0.03 + 0.16 * g);
        float wave = sin(uWind.w * 1.3 + ph) * 0.6 + sin(uWind.w * 2.9 + ph * 1.7 + vLocal.y * 0.4) * 0.3 + 0.45;
        vec3 disp = vec3(uWind.x, 0.0, uWind.y) * wave * sw + vec3(0.0, -0.35, 0.0) * sw * (0.5 + 0.5 * sin(uWind.w * 2.1 + ph * 2.3));
        transformed += transpose(mat3(bmat)) * disp;
        // silhouette floor: thin limbs keep a minimum thickness with distance so trees stay legible in the fog
        float dcam = length(wpos - cameraPosition);
        float want = dcam * 0.0011;
        transformed += objectNormal * max(0.0, want - aTree.y) * 0.9;`)
      .replace('#include <fog_vertex>', `
        #ifdef USE_FOG
          vFogWorldPos = (bmat * vec4(transformed, 1.0)).xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_NOISE}
        varying vec3 vLocal; varying vec3 vTree; varying vec3 vInst;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 alb = diffuseColor.rgb;
          float seed = hash21(vInst.xz);
          float birch = smoothstep(0.7, 0.95, vTree.z);
          float pine = smoothstep(0.3, 0.5, vTree.z) * (1.0 - birch);
          float twig = 1.0 - smoothstep(0.05, 0.3, vTree.z);
          vec3 q = vLocal + vec3(seed * 7.0, seed * 3.0, 0.0);
          // fine detail fades with distance so it never aliases into speckle
          float detail = 1.0 - smoothstep(18.0, 60.0, length(vInst - cameraPosition));
          // birch: black lenticel dashes (short, horizontal), peeling curls of pinkish under-bark, grey weather stains
          float lent = smoothstep(0.66, 0.72, vnoise3(vec3(q.x * 2.4, q.y * 7.5, q.z * 2.4)));
          float lent2 = smoothstep(0.7, 0.78, vnoise3(vec3(q.x * 3.5, q.y * 16.0 + 3.0, q.z * 3.5))) * detail;
          float peel = smoothstep(0.55, 0.72, fbm3d(vec3(q.x * 6.0, q.y * 1.4, q.z * 6.0)));
          float stain = smoothstep(0.45, 0.8, fbm3d(vec3(q.x * 1.5, q.y * 0.35, q.z * 1.5)));
          alb = mix(alb, alb * vec3(0.72, 0.7, 0.68), stain * 0.6 * birch);
          alb = mix(alb, vec3(0.30, 0.24, 0.20), peel * 0.5 * birch);
          alb = mix(alb, vec3(0.035, 0.03, 0.028), max(lent * (0.6 + 0.4 * detail), lent2 * 0.6) * 0.92 * birch);
          // pine: deep vertical fissures, grey where the bark has dropped
          float fiss = smoothstep(0.38, 0.62, vnoise3(vec3(q.x * 16.0, q.y * 1.4, q.z * 16.0)));
          alb *= mix(1.0, 0.5 + 0.7 * fiss, pine * (0.4 + 0.6 * detail));
          // all wood: soft grain and grey-green lichen on the weather side
          float grain = vnoise3(vec3(q.x * 10.0, q.y * 3.0, q.z * 10.0));
          alb *= 1.0 - 0.12 * detail + 0.12 * grain * detail;
          float lichen = smoothstep(0.66, 0.82, vnoise3(vLocal * vec3(9.0, 2.5, 9.0) + seed)) * (1.0 - twig);
          alb = mix(alb, vec3(0.20, 0.24, 0.13), lichen * 0.35);
          // dampness creeping up from the ground
          float damp = 1.0 - smoothstep(0.0, 1.4, vLocal.y);
          alb *= 1.0 - damp * 0.35 * (1.0 - twig);
          diffuseColor.rgb = alb;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.9, 0.97, smoothstep(0.7, 0.95, vTree.z));`);
  };
  mat.customProgramCacheKey = () => 'radius-tree';
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Grass / reed geometry and material. Instances are (x,y,z,scale) + (yaw, hueJitter, kind, phase).
// ---------------------------------------------------------------------------------------------
const GRASS_BASE = C(0x3e3b22), GRASS_TIP = C(0x6b6a3f), GRASS_STRAW = C(0x8f8858);
const REED_BASE = C(0x343a1f), REED_TIP = C(0x8a8452), REED_HEAD = C(0x2a1b10), REED_LEAF = C(0x5c5d33);

function blade(B, az, lean, h, w, curve, cBase, cTip, cEnd, sway = 1) {
  const ox = Math.cos(az), oz = Math.sin(az);          // outward direction
  const sx = -oz, sz = ox;                              // side
  const nx = ox * 0.55, ny = 0.8, nz = oz * 0.55;
  const bx = ox * 0.03, bz = oz * 0.03;
  const idx = [];
  const steps = [0, 0.5, 1];
  for (let k = 0; k < steps.length; k++) {
    const t = steps[k];
    const out = h * Math.sin(lean * t) * (t + curve * t * t), up = h * t * Math.cos(lean * t * 0.9);
    const ww = w * (1 - t * 0.85);
    mixC(cBase, cTip, smoothstep(0, 0.8, t), tmpC);
    if (t > 0.9) tmpC.lerp(cEnd, 0.5);
    const px = bx + ox * out, pz = bz + oz * out;
    if (t === 1) idx.push(B.vertex(px, up, pz, nx, ny, nz, tmpC, sway * t, 0, 0));
    else {
      idx.push(B.vertex(px - sx * ww, up, pz - sz * ww, nx - sx * 0.25, ny, nz - sz * 0.25, tmpC, sway * t, 0, 0));
      idx.push(B.vertex(px + sx * ww, up, pz + sz * ww, nx + sx * 0.25, ny, nz + sz * 0.25, tmpC, sway * t, 0, 0));
    }
  }
  const [L0, R0, L1, R1, TIP] = idx;
  B.face(L0, R0, L1); B.face(R0, R1, L1); B.face(L1, R1, TIP);
}
function tuftGeometry(rnd) {
  const B = new Builder();
  for (let b = 0; b < 3; b++) {
    const az = b * (TAU / 3) + rnd.range(-0.4, 0.4);
    blade(B, az, rnd.range(0.35, 0.7), rnd.range(0.8, 1.05), rnd.range(0.05, 0.075), rnd.range(0.2, 0.6), GRASS_BASE, GRASS_TIP, GRASS_STRAW);
  }
  return B.build();
}
function reedGeometry(rnd) {
  const B = new Builder();
  // two stems, one carrying a cattail head, and two broad leaves
  for (let s = 0; s < 2; s++) {
    const az = s * Math.PI + rnd.range(-0.6, 0.6), lean = rnd.range(0.04, 0.14), h = rnd.range(0.85, 1.0);
    blade(B, az, lean, h, 0.018, 0.1, REED_BASE, REED_TIP, REED_TIP, 0.9);
    if (s === 0) {
      const t = 0.86, out = h * Math.sin(lean * t) * (t + 0.1 * t * t), up = h * t * Math.cos(lean * t * 0.9);
      const cx = Math.cos(az) * (0.03 + out), cz = Math.sin(az) * (0.03 + out);
      const len = rnd.range(0.12, 0.18), rr = rnd.range(0.022, 0.03);
      const path = [];
      for (let i = 0; i <= 2; i++) { const u = i / 2; path.push({ x: cx, y: up + u * len, z: cz, r: rr * Math.sin(0.25 + u * 2.6) + 0.004 }); }
      B.tube(path, 4, (u) => ({ c: mixC(REED_HEAD, REED_LEAF, u * 0.15, tmpC), flex: 0.85, bark: 0 }));
    }
  }
  for (let l = 0; l < 2; l++) blade(B, rnd() * TAU, rnd.range(0.3, 0.55), rnd.range(0.55, 0.8), 0.035, 0.5, REED_BASE, REED_LEAF, REED_TIP);
  return B.build();
}

function plantMaterial(cullNear, cullFar) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.uniforms.uWind = wind.uniform;
    shader.uniforms.uCull = { value: new THREE.Vector2(cullNear, cullFar) };
    mat.userData.uCull = shader.uniforms.uCull;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aInst; attribute vec4 aInst2; attribute vec3 aTree;
        uniform vec4 uWind; uniform vec2 uCull;
        varying float vJit; varying float vKind;
        float pc, ps;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        pc = cos(aInst2.x); ps = sin(aInst2.x);
        objectNormal = vec3(pc * objectNormal.x + ps * objectNormal.z, objectNormal.y, -ps * objectNormal.x + pc * objectNormal.z);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 base = aInst.xyz;
          vec3 p = position * aInst.w;
          p = vec3(pc * p.x + ps * p.z, p.y, -ps * p.x + pc * p.z);
          float dcam = distance(base, cameraPosition);
          float keep = (1.0 - smoothstep(uCull.x, uCull.y, dcam)) * step(0.001, aInst.w);
          p *= keep;
          // wind: sway grows with blade height; gust bands roll downwind; each tuft has its own phase
          float h = aTree.x;
          float ph = base.x * 0.35 + base.z * 0.27 + aInst2.w * 6.2832;
          float band = 0.5 + 0.5 * sin(uWind.w * 0.55 - (base.x * uWind.x + base.z * uWind.y) * 0.06);
          float band2 = 0.5 + 0.5 * sin(uWind.w * 1.7 - (base.x * uWind.x + base.z * uWind.y) * 0.21 + 1.3);
          float g = uWind.z * (0.35 + 0.65 * band) * (0.6 + 0.4 * band2);
          float wave = sin(uWind.w * 2.1 + ph) * 0.45 + sin(uWind.w * 4.3 + ph * 1.9) * 0.2 + 0.5;
          float sw = h * h * aInst.w * (0.04 + 0.26 * g) * wave;
          p.xz += vec2(uWind.x, uWind.y) * sw;
          p.y -= sw * sw * 0.8;
          transformed = base + p;
          vJit = aInst2.y; vKind = aInst2.z;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vJit; varying float vKind;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 alb = diffuseColor.rgb;
          // per-tuft hue: toward pale straw or toward cold olive
          alb *= mix(vec3(0.78, 0.86, 0.82), vec3(1.2, 1.08, 0.86), vJit);
          // tufts on mud are browner and darker; reeds keep their own palette
          float mud = step(0.5, vKind) * (1.0 - step(1.5, vKind));
          alb = mix(alb, alb * vec3(0.8, 0.68, 0.55), mud);
          diffuseColor.rgb = alb;
        }`);
  };
  mat.customProgramCacheKey = () => 'radius-plant';
  return mat;
}

function instancedPlants(geo, count, material, dynamic) {
  const ig = new THREE.InstancedBufferGeometry();
  ig.setIndex(geo.index);
  for (const k in geo.attributes) ig.setAttribute(k, geo.attributes[k]);
  ig.instanceCount = count;
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const inst2 = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  if (dynamic) { inst.setUsage(THREE.DynamicDrawUsage); inst2.setUsage(THREE.DynamicDrawUsage); }
  ig.setAttribute('aInst', inst); ig.setAttribute('aInst2', inst2);
  ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mesh = new THREE.Mesh(ig, material);
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
  return { mesh, inst, inst2 };
}

// ---------------------------------------------------------------------------------------------
export function createFlora(ctx) {
  const { scene, world } = ctx;
  const M = world.map;
  const HALF = M.HALF, WATER = M.WATER_LEVEL;
  const rng = ctx.rng.fork(1187);
  const counts = { birch: 0, pine: 0, log: 0, stump: 0, bush: 0, grass: 0, reed: 0, colliders: 0, cover: 0, hiding: 0 };

  // ---- performance tier ----
  const software = isSoftwareGL(ctx.renderer);
  const quality = ctx.quality || 'high';
  const tier = software ? 'software' : quality;
  let density = tier === 'software' ? 0.3 : tier === 'low' ? 0.5 : tier === 'medium' ? 0.75 : 1.0;
  const GR = tier === 'software' ? 8 : tier === 'low' ? 9 : 12;           // grass window radius in cells
  let lodDist = tier === 'software' ? 26 : tier === 'low' ? 40 : tier === 'medium' ? 55 : 70;

  // ---- placement helpers ----
  const roads = M.ROADS.map((r) => r.pts);
  const roadDist = (x, z) => { let d = Infinity; for (const p of roads) { const dd = M.distToPolyline(x, z, p).d; if (dd < d) d = dd; } return d; };
  const railDist = (x, z) => M.distToPolyline(x, z, M.RAIL.pts).d;
  const cores = ['zarya', 'object12', 'checkpoint', 'vanno'].map((id) => M.poi(id));
  const church = M.poi('church'), forest = M.poi('forest');
  const bv = world.baseVolume;
  const nrm = new THREE.Vector3();
  // true where nothing should be planted
  function blocked(x, z, margin = 5) {
    if (Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) return true;
    if (roadDist(x, z) < margin) return true;
    if (railDist(x, z) < margin + 1.5) return true;
    for (const p of cores) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.55) return true;
    if (x > bv.min.x - 10 && x < bv.max.x + 10 && z > bv.min.z - 12 && z < bv.max.z + 8) return true;
    return false;
  }
  const standMask = (x, z) => smoothstep(0.02, 0.42, fbm2(x * 0.012 + 5.3, z * 0.012 + 3.1, 3));
  const forestNorm = (x, z) => Math.hypot(x - forest.x, z - forest.z) / forest.r;

  // ---- geometry variants at two detail levels ----
  const variants = [];
  const vr = rng.fork(3);
  for (let i = 0; i < 6; i++) variants.push(birchVariant(vr));
  for (let i = 0; i < 3; i++) variants.push(pineVariant(vr));
  for (let i = 0; i < 2; i++) variants.push(logVariant(vr));
  for (let i = 0; i < 2; i++) variants.push(stumpVariant(vr));
  for (let i = 0; i < 2; i++) variants.push(bushVariant(vr));
  for (const v of variants) { v.hi = emit(v, 'high'); v.lo = (v.kind === 'log' || v.kind === 'stump') ? v.hi : emit(v, 'low'); }
  const byKind = (k) => variants.map((v, i) => (v.kind === k ? i : -1)).filter((i) => i >= 0);
  const BIRCH = byKind('birch'), PINE = byKind('pine'), LOG = byKind('log'), STUMP = byKind('stump'), BUSH = byKind('bush');

  // ---- the batched mesh ----
  const MAX_INST = 3800;
  let vCount = 0, iCount = 0;
  for (const v of variants) { vCount += v.hi.attributes.position.count + (v.lo === v.hi ? 0 : v.lo.attributes.position.count); iCount += v.hi.index.count + (v.lo === v.hi ? 0 : v.lo.index.count); }
  const trees = new THREE.BatchedMesh(MAX_INST, vCount + 16, iCount + 48, treeMaterial());
  trees.name = 'flora-trees';
  trees.sortObjects = false; trees.perObjectFrustumCulled = true;
  trees.castShadow = true; trees.receiveShadow = true;
  for (const v of variants) { v.hiId = trees.addGeometry(v.hi); v.loId = v.lo === v.hi ? v.hiId : trees.addGeometry(v.lo); }
  scene.add(trees);

  const placed = [];   // { id, x, y, z, kind, r, h, vi, lo } for colliders, cover, LOD
  const tint = new THREE.Color();
  function place(vi, x, z, yaw, sx, sy, sink = 0.15, pitch = 0) {
    if (trees.instanceCount >= MAX_INST) return null;
    const v = variants[vi];
    const y = world.getHeight(x, z) - sink;
    v3.set(x, y, z);
    if (pitch !== 0) q4.setFromEuler(new THREE.Euler(0, yaw, pitch, 'YXZ')); else q4.setFromAxisAngle(UP, yaw);
    s3.set(sx, sy, sx);
    m4.compose(v3, q4, s3);
    const id = trees.addInstance(v.hiId);
    trees.setMatrixAt(id, m4);
    const j = rng();
    tint.setRGB(0.9 + j * 0.18, 0.9 + j * 0.16, 0.9 + j * 0.14);
    trees.setColorAt(id, tint);
    const rec = { id, x, y, z, kind: v.kind, r: v.r * sx, h: v.h * sy, vi, yaw, lo: false };
    placed.push(rec);
    counts[v.kind]++;
    return rec;
  }
  function trunkCollider(rec) {
    world.addCylinder(rec.x, rec.z, Math.max(0.16, rec.r), rec.y - 1, rec.y + rec.h * 0.85, { tag: 'flora', surface: 'wood' });
    counts.colliders++;
  }

  // ---- birches: dense in the dead forest, loose stands elsewhere ----
  {
    const r = rng.fork(11);
    const jitter = (s) => (r() - 0.5) * s * 0.95;
    const R = forest.r * 1.35;
    for (let x = forest.x - R; x < forest.x + R; x += 4) for (let z = forest.z - R; z < forest.z + R; z += 4) {
      const px = x + jitter(4), pz = z + jitter(4);
      const dn = Math.hypot(px - forest.x, pz - forest.z) / forest.r;
      const clearing = smoothstep(-0.5, -0.15, fbm2(px * 0.03 + 1.7, pz * 0.03, 3));
      const p = (1 - smoothstep(0.8, 1.35, dn)) * (0.35 + 0.65 * clearing);
      if (r() > p || blocked(px, pz, 4)) continue;
      const h = world.getHeight(px, pz);
      if (h < WATER - 0.35) continue;
      world.getNormal(px, pz, nrm); if (nrm.y < 0.72) continue;
      if (world.pointInSolid(px, h + 1, pz)) continue;
      const s = r.range(0.8, 1.2);
      const rec = place(r.pick(BIRCH), px, pz, r() * TAU, s, s * r.range(0.9, 1.15));
      if (rec) trunkCollider(rec);
    }
    for (let x = -HALF; x < HALF; x += 9) for (let z = -HALF; z < HALF; z += 9) {
      const px = x + jitter(9), pz = z + jitter(9);
      if (forestNorm(px, pz) < 1.35) continue;
      let p = standMask(px, pz) * 0.55;
      const dc = Math.hypot(px - church.x, pz - church.z);
      if (dc < church.r * 0.4) continue; else if (dc < church.r) p *= 0.3;
      if (r() > p || blocked(px, pz)) continue;
      const h = world.getHeight(px, pz);
      if (h < WATER - 0.35) continue;
      const surf = world.getSurface(px, pz);
      if (surf === 'rock' && r() < 0.7) continue;
      world.getNormal(px, pz, nrm); if (nrm.y < 0.72) continue;
      if (world.pointInSolid(px, h + 1, pz)) continue;
      const s = r.range(0.78, 1.25);
      const rec = place(r.pick(BIRCH), px, pz, r() * TAU, s, s * r.range(0.9, 1.15));
      if (rec) trunkCollider(rec);
    }
  }
  // ---- pines: north and west, on the ridges ----
  {
    const r = rng.fork(12);
    for (let x = -HALF; x < HALF; x += 11) for (let z = -HALF; z < HALF; z += 11) {
      const px = x + (r() - 0.5) * 10, pz = z + (r() - 0.5) * 10;
      const north = clamp01(-pz / HALF * 1.3 + 0.1), west = clamp01(-px / HALF * 1.1 - 0.1);
      let p = (0.5 * north + 0.35 * west) * (0.4 + 0.6 * smoothstep(-0.1, 0.35, fbm2(px * 0.016 + 9.1, pz * 0.016 + 4.4, 3)));
      if (forestNorm(px, pz) < 1.0) p *= 0.25;
      if (r() > p || blocked(px, pz)) continue;
      const h = world.getHeight(px, pz);
      if (h < WATER + 0.2) continue;
      world.getNormal(px, pz, nrm); if (nrm.y < 0.68) continue;
      if (world.pointInSolid(px, h + 1, pz)) continue;
      const s = r.range(0.8, 1.2);
      const rec = place(r.pick(PINE), px, pz, r() * TAU, s, s * r.range(0.85, 1.15), 0.2);
      if (rec) trunkCollider(rec);
    }
  }
  // ---- fallen logs and stumps, near the standing dead ----
  {
    const r = rng.fork(13);
    const standing = placed.filter((p) => p.kind === 'birch' || p.kind === 'pine');
    let tries = 0;
    while (counts.log < 120 && tries++ < 1200 && standing.length) {
      const t = r.pick(standing);
      const a = r() * TAU, d = r.range(1.8, 4.5);
      const px = t.x + Math.cos(a) * d, pz = t.z + Math.sin(a) * d;
      if (blocked(px, pz, 3.5)) continue;
      const vi = r.pick(LOG), v = variants[vi], yaw = r() * TAU;
      const hx = Math.cos(yaw) * v.len * 0.45, hz = -Math.sin(yaw) * v.len * 0.45;
      const y0 = world.getHeight(px - hx, pz - hz), y1 = world.getHeight(px + hx, pz + hz);
      if (Math.min(y0, y1) < WATER - 0.1 || Math.abs(y1 - y0) > 1.6) continue;
      if (world.pointInSolid(px, (y0 + y1) / 2 + 0.5, pz)) continue;
      const s = r.range(0.85, 1.15);
      // axis rests a third of a radius below the ground line between the two ends
      const sink = world.getHeight(px, pz) - (y0 + y1) / 2 - v.r * s * 0.65;
      const rec = place(vi, px, pz, yaw, s, s, sink, Math.atan2(y1 - y0, v.len * 0.9));
      if (rec && r() < 0.5) { world.hidingSpots.push({ position: new THREE.Vector3(px + Math.sin(yaw) * 0.9, rec.y, pz + Math.cos(yaw) * 0.9), poi: world.nearestPoi(px, pz).poi?.id }); counts.hiding++; }
    }
    tries = 0;
    while (counts.stump < 120 && tries++ < 1500 && standing.length) {
      // half by the standing trees, half at the village edge where the kolkhoz cut its firewood
      const nearVillage = r() < 0.4;
      let px, pz;
      if (nearVillage) { const z = M.poi('zarya'); const a = r() * TAU, d = z.r * r.range(0.62, 1.05); px = z.x + Math.cos(a) * d; pz = z.z + Math.sin(a) * d; }
      else { const t = r.pick(standing); const a = r() * TAU, d = r.range(2.5, 9); px = t.x + Math.cos(a) * d; pz = t.z + Math.sin(a) * d; }
      if (blocked(px, pz, 3)) continue;
      const h = world.getHeight(px, pz);
      if (h < WATER) continue;
      world.getNormal(px, pz, nrm); if (nrm.y < 0.75) continue;
      if (world.pointInSolid(px, h + 0.5, pz)) continue;
      const s = r.range(0.8, 1.2);
      const rec = place(r.pick(STUMP), px, pz, r() * TAU, s, s, 0.02);
      if (rec && rec.h > 0.5) { world.addCylinder(px, pz, rec.r * 1.1, rec.y - 0.5, rec.y + rec.h, { tag: 'flora', surface: 'wood' }); counts.colliders++; }
    }
  }
  // ---- bushes: village and checkpoint edges (hiding cover), then open ground ----
  {
    const r = rng.fork(14);
    const edgeOf = (id, n, lo, hi) => {
      const p = M.poi(id);
      let tries = 0, made = 0;
      while (made < n && tries++ < n * 8) {
        const a = r() * TAU, d = p.r * r.range(lo, hi);
        const px = p.x + Math.cos(a) * d, pz = p.z + Math.sin(a) * d;
        if (blocked(px, pz, 3)) continue;
        const h = world.getHeight(px, pz);
        if (h < WATER - 0.1) continue;
        if (world.pointInSolid(px, h + 0.5, pz)) continue;
        const rec = place(r.pick(BUSH), px, pz, r() * TAU, r.range(0.8, 1.3), r.range(0.8, 1.2), 0.02);
        if (!rec) break;
        made++;
        world.hidingSpots.push({ position: new THREE.Vector3(px, rec.y, pz), poi: id }); counts.hiding++;
      }
    };
    edgeOf('zarya', 110, 0.6, 1.08);
    edgeOf('checkpoint', 24, 0.7, 1.3);
    edgeOf('convoy', 30, 0.6, 1.2);
    edgeOf('object12', 40, 0.62, 1.1);
    edgeOf('church', 20, 0.45, 1.0);
    for (let x = -HALF; x < HALF; x += 20) for (let z = -HALF; z < HALF; z += 20) {
      const px = x + (r() - 0.5) * 19, pz = z + (r() - 0.5) * 19;
      const p = 0.55 * (0.5 + 0.5 * (1 - standMask(px, pz)));
      if (r() > p || blocked(px, pz, 3)) continue;
      const h = world.getHeight(px, pz);
      if (h < WATER - 0.1) continue;
      if (world.pointInSolid(px, h + 0.5, pz)) continue;
      place(r.pick(BUSH), px, pz, r() * TAU, r.range(0.7, 1.3), r.range(0.8, 1.2), 0.02);
    }
  }
  // ---- cover points: thick trunks near the inhabited places ----
  {
    const r = rng.fork(15);
    const pois = M.POIS.filter((p) => p.kind !== 'forest' && p.kind !== 'base');
    for (const rec of placed) {
      if (counts.cover >= 320) break;
      if ((rec.kind !== 'birch' && rec.kind !== 'pine') || rec.r < 0.22) continue;
      let near = false;
      for (const p of pois) if (Math.hypot(rec.x - p.x, rec.z - p.z) < p.r + 40) { near = true; break; }
      if (!near || r() < 0.4) continue;
      const a = r() * TAU;
      world.coverPoints.push(new THREE.Vector3(rec.x + Math.cos(a) * 0.9, rec.y, rec.z + Math.sin(a) * 0.9));
      counts.cover++;
    }
  }
  trees.computeBoundingSphere();

  // distance LOD: swap far trees to their light geometry (with hysteresis), a few hundred checks per pass
  function updateLod(force) {
    const eye = ctx.player ? ctx.player.eye : ctx.camera.position;
    const far2 = (lodDist + 6) * (lodDist + 6), near2 = (lodDist - 6) * (lodDist - 6);
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i], v = variants[p.vi];
      if (v.loId === v.hiId) continue;
      const dx = p.x - eye.x, dz = p.z - eye.z, d2 = dx * dx + dz * dz;
      if (force || (!p.lo && d2 > far2) || (p.lo && d2 < near2)) {
        const lo = force ? d2 > far2 : !p.lo;
        if (lo !== p.lo || force) { p.lo = lo; trees.setGeometryIdAt(p.id, lo ? v.loId : v.hiId); }
      }
    }
  }

  // ---- grass: a streamed window around the camera, generated per cell and cached ----
  const GC = 8, GK = 40, GMAX = 25 * 25 * GK;
  const grass = instancedPlants(tuftGeometry(rng.fork(21)), GMAX, plantMaterial(GC * GR * 0.58, GC * GR * 0.92), true);
  grass.mesh.name = 'flora-grass';
  scene.add(grass.mesh);
  const cellCache = new Map();
  let gcx = 1e9, gcz = 1e9;
  const seedBase = (ctx.state.data.seed | 0) ^ 0x5f3759df;
  const gi = grass.inst.array, gi2 = grass.inst2.array;
  function genCell(ci, cj) {
    const r = mulberry32((seedBase + Math.floor(hash2(ci, cj) * 2147483647)) >>> 0);
    const inForest = forestNorm(ci * GC + 4, cj * GC + 4) < 1.05;
    const out = [];
    for (let k = 0; k < GK; k++) {
      const x = ci * GC + r() * GC, z = cj * GC + r() * GC;
      const yaw = r() * TAU, jit = r(), phase = r(), roll = r();
      if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) continue;
      const y = world.getHeight(x, z);
      const surf = y < WATER ? 'water' : world.getSurface(x, z);
      let p = surf === 'grass' ? 0.92 : surf === 'mud' ? 0.42 : surf === 'rock' ? 0.14 : 0;
      if (inForest) p *= 0.45;
      if (y < WATER + 0.15) p *= 0.5;
      if (roll > p * density) continue;
      if (world.pointInSolid(x, y + 0.25, z)) continue;
      const scale = (0.32 + 0.4 * ((jit * 7919) % 1)) * (surf === 'grass' ? 1 : 0.8);
      out.push(x, y - 0.02, z, scale, yaw, jit, surf === 'mud' ? 1 : 0, phase);
    }
    return new Float32Array(out);
  }
  function updateGrass(force) {
    const cam = ctx.player ? ctx.player.eye : ctx.camera.position;   // camera is parented to the rig; eye is world space
    const ci = Math.floor(cam.x / GC), cj = Math.floor(cam.z / GC);
    if (!force && ci === gcx && cj === gcz) return;
    gcx = ci; gcz = cj;
    if (force) cellCache.clear();
    if (cellCache.size > 2600) cellCache.clear();
    let n = 0;
    for (let i = ci - GR; i <= ci + GR; i++) for (let j = cj - GR; j <= cj + GR; j++) {
      const key = (i + 4096) * 8192 + (j + 4096);
      let arr = cellCache.get(key);
      if (!arr) { arr = genCell(i, j); cellCache.set(key, arr); }
      // far cells keep every 2nd / 4th tuft, scaled up, so the vertex load stays flat
      const dc = Math.hypot((i + 0.5) * GC - cam.x, (j + 0.5) * GC - cam.z);
      const stride = dc < 40 ? 1 : dc < 68 ? 2 : 4, boost = stride === 1 ? 1 : stride === 2 ? 1.22 : 1.45;
      for (let k = 0; k < arr.length && n < GMAX; k += 8 * stride) {
        const s = n * 4;
        gi[s] = arr[k]; gi[s + 1] = arr[k + 1]; gi[s + 2] = arr[k + 2]; gi[s + 3] = arr[k + 3] * boost;
        gi2[s] = arr[k + 4]; gi2[s + 1] = arr[k + 5]; gi2[s + 2] = arr[k + 6]; gi2[s + 3] = arr[k + 7];
        n++;
      }
    }
    grass.mesh.geometry.instanceCount = n;
    grass.inst.clearUpdateRanges(); grass.inst2.clearUpdateRanges();
    if (n > 0) { grass.inst.addUpdateRange(0, n * 4); grass.inst2.addUpdateRange(0, n * 4); }
    grass.inst.needsUpdate = true; grass.inst2.needsUpdate = true;
    counts.grass = n;
  }

  // ---- reeds along the water line: static, in a few frustum-culled chunks ----
  const reedMat = plantMaterial(115, 165);
  const reedGeo = reedGeometry(rng.fork(22));
  const reedMeshes = [];
  {
    const r = rng.fork(23);
    const marsh = M.poi('marsh');
    const target = Math.round(3400 * Math.max(0.5, density));
    const chunks = [[], [], [], [], []];   // marsh quadrants + elsewhere
    let n = 0, tries = 0;
    while (n < target && tries++ < target * 40) {
      let x, z;
      if (r() < 0.9) { const a = r() * TAU, d = Math.sqrt(r()) * marsh.r * 1.25; x = marsh.x + Math.cos(a) * d; z = marsh.z + Math.sin(a) * d; }
      else { x = r.range(-HALF + 6, HALF - 6); z = r.range(-HALF + 6, HALF - 6); }
      const y = world.getHeight(x, z);
      const dw = y - WATER;
      if (dw < -0.55 || dw > 0.5) continue;
      const p = dw < 0 ? 1 - smoothstep(0.1, 0.55, -dw) : 1 - smoothstep(0.15, 0.5, dw);
      if (r() > p * (0.55 + 0.45 * smoothstep(-0.2, 0.3, fbm2(x * 0.05 + 3, z * 0.05, 2)))) continue;
      if (blocked(x, z, 3)) continue;
      const inMarsh = Math.hypot(x - marsh.x, z - marsh.z) < marsh.r * 1.3;
      const ch = inMarsh ? (x < marsh.x ? 0 : 1) + (z < marsh.z ? 0 : 2) : 4;
      chunks[ch].push(x, Math.max(y, WATER - 0.35) - 0.05, z, r.range(1.1, 2.0), r() * TAU, r(), 2, r());
      n++;
    }
    for (const list of chunks) {
      const cnt = list.length / 8;
      if (cnt === 0) continue;
      const rm = instancedPlants(reedGeo, cnt, reedMat, false);
      const cx = new THREE.Vector3();
      for (let k = 0; k < cnt; k++) {
        rm.inst.array.set(list.slice(k * 8, k * 8 + 4), k * 4);
        rm.inst2.array.set(list.slice(k * 8 + 4, k * 8 + 8), k * 4);
        cx.x += list[k * 8]; cx.y += list[k * 8 + 1]; cx.z += list[k * 8 + 2];
      }
      cx.divideScalar(cnt);
      let rad = 0;
      for (let k = 0; k < cnt; k++) rad = Math.max(rad, Math.hypot(list[k * 8] - cx.x, list[k * 8 + 2] - cx.z));
      rm.mesh.geometry.boundingSphere = new THREE.Sphere(cx, rad + 4);
      rm.mesh.frustumCulled = true;
      rm.mesh.name = 'flora-reeds';
      scene.add(rm.mesh);
      reedMeshes.push(rm.mesh);
    }
    counts.reed = n;
  }

  updateWind(0, 0);
  updateGrass(true);
  updateLod(true);
  ctx.events.on('tide', () => updateGrass(true));
  ctx.events.on('gameStart', () => { updateGrass(true); updateLod(true); });

  return {
    wind, counts, trees, variants, tier,
    grass: grass.mesh, reeds: reedMeshes,
    get density() { return density; },
    get lodDist() { return lodDist; },
    // for settings and review shots: grass density 0..1.5 (rebuilds the window), tree detail distance in metres
    setDensity(d) { density = Math.max(0, Math.min(1.5, d)); updateGrass(true); },
    setLod(d) { lodDist = Math.max(10, d); updateLod(true); },
    update(dt, t) {
      updateWind(t, ctx.lighting ? ctx.lighting.storm : 0);
      updateGrass(false);
      if (ctx.frame % 18 === 0) updateLod(false);
    },
  };
}
