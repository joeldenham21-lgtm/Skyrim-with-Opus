/**
 * WYRMHOLD — core math, deterministic RNG and noise.
 * Pure JS, no dependencies, so the same code can drive terrain, scatter and AI.
 */

export const PI = Math.PI, TAU = Math.PI * 2, DEG = Math.PI / 180, RAD = 180 / Math.PI;

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const saturate = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a || 1e-9);
export const remap = (v, a, b, c, d) => c + (d - c) * saturate((v - a) / (b - a || 1e-9));
export const smoothstep = (e0, e1, x) => { const t = saturate((x - e0) / (e1 - e0 || 1e-9)); return t * t * (3 - 2 * t); };
export const smootherstep = (e0, e1, x) => { const t = saturate((x - e0) / (e1 - e0 || 1e-9)); return t * t * t * (t * (t * 6 - 15) + 10); };
export const step = (e, x) => x < e ? 0 : 1;
export const sign = v => v < 0 ? -1 : v > 0 ? 1 : 0;
export const fract = v => v - Math.floor(v);
export const mod = (a, n) => ((a % n) + n) % n;

/** Frame-rate independent exponential smoothing. `lambda` ~ 1..30 (higher = snappier). */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
/** Same but for angles, taking the shortest path. */
export const dampAngle = (a, b, lambda, dt) => a + shortAngle(a, b) * (1 - Math.exp(-lambda * dt));
export const shortAngle = (a, b) => { let d = mod(b - a + PI, TAU) - PI; return d; };
export const lerpAngle = (a, b, t) => a + shortAngle(a, b) * t;

export const approach = (a, b, maxDelta) => { const d = b - a; return Math.abs(d) <= maxDelta ? b : a + sign(d) * maxDelta; };

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/** Fast, high-quality 32-bit PRNG. Returns a function producing [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless integer hash → [0,1). Great for "what should be at tile (x,y)?" */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function hash3(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Small helper wrapping a seeded stream with convenience methods. */
export class Rand {
  constructor(seed = 1337) { this.seed = seed >>> 0; this.next = mulberry32(this.seed); }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  bool(p = 0.5) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  gauss(mean = 0, sd = 1) {
    // Box–Muller; cached second sample.
    if (this._g !== undefined) { const g = this._g; this._g = undefined; return mean + g * sd; }
    const u = Math.max(1e-7, this.next()), v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this._g = r * Math.sin(TAU * v);
    return mean + r * Math.cos(TAU * v) * sd;
  }
  onDisk(radius = 1) {
    const a = this.next() * TAU, r = radius * Math.sqrt(this.next());
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  weighted(items, weightOf = it => it.weight ?? 1) {
    let total = 0; for (const it of items) total += weightOf(it);
    let r = this.next() * total;
    for (const it of items) { r -= weightOf(it); if (r <= 0) return it; }
    return items[items.length - 1];
  }
}

// ---------------------------------------------------------------------------
// Simplex noise (Gustavson/Perlin), seedable
// ---------------------------------------------------------------------------

const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
]);

export class Noise {
  constructor(seed = 0) {
    const rnd = mulberry32(seed ^ 0xA53F19);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.permMod12[i] = this.perm[i] % 12; }
    this.seed = seed;
  }

  /** 2D simplex, range roughly [-1,1]. */
  noise2(xin, yin) {
    const F2 = 0.3660254037844386, G2 = 0.21132486540518713;
    const perm = this.perm, permMod12 = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { const gi0 = permMod12[ii + perm[jj]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[gi0] * x0 + GRAD3[gi0 + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[gi1] * x1 + GRAD3[gi1 + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[gi2] * x2 + GRAD3[gi2 + 1] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  /** 3D simplex, range roughly [-1,1]. */
  noise3(xin, yin, zin) {
    const F3 = 1 / 3, G3 = 1 / 6;
    const perm = this.perm, permMod12 = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) { const g = permMod12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) { const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) { const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) { const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }

  /** Standard fractal brownian motion. */
  fbm2(x, y, octaves = 5, lac = 2.0, gain = 0.5) {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += a * this.noise2(x * f, y * f);
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm;
  }

  fbm3(x, y, z, octaves = 4, lac = 2.0, gain = 0.5) {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += a * this.noise3(x * f, y * f, z * f);
      norm += a; a *= gain; f *= lac;
    }
    return sum / norm;
  }

  /** Ridged multifractal — sharp mountain crests. Returns [0,1]. */
  ridged2(x, y, octaves = 6, lac = 2.0, gain = 0.5) {
    let a = 1, f = 1, sum = 0, norm = 0, prev = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise2(x * f, y * f));
      n *= n;
      n *= prev;           // feedback sharpens crests and flattens valleys
      prev = n;
      sum += a * n; norm += a;
      a *= gain; f *= lac;
    }
    return sum / norm;
  }

  /**
   * Erosion-flavoured fbm: octave amplitude is damped where the accumulated
   * slope is high, which carves smooth valleys and leaves ridges crisp.
   * (Analytic-derivative trick popularised by Inigo Quilez.)
   */
  erodedFbm2(x, y, octaves = 8, lac = 2.0, gain = 0.5, warp = 1.0) {
    let a = 1, f = 1, sum = 0, norm = 0, dx = 0, dy = 0;
    const e = 0.0009;
    for (let i = 0; i < octaves; i++) {
      const nx = x * f, ny = y * f;
      const n = this.noise2(nx, ny);
      // cheap finite-difference derivative at this octave
      const gx = (this.noise2(nx + e, ny) - n) / e * f;
      const gy = (this.noise2(nx, ny + e) - n) / e * f;
      dx += gx; dy += gy;
      sum += a * n / (1 + warp * (dx * dx + dy * dy));
      norm += a;
      a *= gain; f *= lac;
    }
    return sum / norm;
  }

  /** Cellular / Worley F1 distance, returns [0,1]. */
  worley2(x, y, seed = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    let best = 8;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const px = i + hash2(xi + i, yi + j, this.seed + seed);
        const py = j + hash2(xi + i, yi + j, this.seed + seed + 7919);
        const dx = px - fx, dy = py - fy;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
    return Math.min(1, Math.sqrt(best));
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export const dist2 = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const distSq2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
export const dist3 = (ax, ay, az, bx, by, bz) => Math.hypot(bx - ax, by - ay, bz - az);

/** Signed distance from point to segment in 2D. */
export function distToSegment2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = saturate(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1e-9));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Closest point parameter on a segment (0..1). */
export function segParam(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  return saturate(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1e-9));
}

/** Catmull-Rom through 4 scalars. */
export const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/** Poisson-ish blue-noise points inside a rect using dart throwing on a grid. */
export function poissonPoints(w, h, minDist, rand, maxTries = 24) {
  const cell = minDist / Math.SQRT2;
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const add = (x, y) => {
    const gi = Math.floor(x / cell), gj = Math.floor(y / cell);
    grid[gj * gw + gi] = pts.length;
    pts.push([x, y]); active.push(pts.length - 1);
  };
  add(rand() * w, rand() * h);
  const ok = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const gi = Math.floor(x / cell), gj = Math.floor(y / cell);
    for (let j = Math.max(0, gj - 2); j <= Math.min(gh - 1, gj + 2); j++)
      for (let i = Math.max(0, gi - 2); i <= Math.min(gw - 1, gi + 2); i++) {
        const idx = grid[j * gw + i];
        if (idx >= 0 && distSq2(x, y, pts[idx][0], pts[idx][1]) < minDist * minDist) return false;
      }
    return true;
  };
  while (active.length) {
    const ai = Math.floor(rand() * active.length);
    const [px, py] = pts[active[ai]];
    let placed = false;
    for (let t = 0; t < maxTries; t++) {
      const a = rand() * TAU, r = minDist * (1 + rand());
      const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
      if (ok(x, y)) { add(x, y); placed = true; break; }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

/** Format a number of seconds of in-game time as a 24h clock string. */
export function clockString(hours) {
  const h = Math.floor(mod(hours, 24));
  const m = Math.floor(mod(hours, 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Float16 encoding (for filterable data textures such as the world heightmap)
// ---------------------------------------------------------------------------

const _f32 = new Float32Array(1);
const _i32 = new Int32Array(_f32.buffer);

/** IEEE754 binary32 -> binary16 bit pattern. */
export function floatToHalf(v) {
  _f32[0] = v;
  const x = _i32[0];
  const sign = (x >> 16) & 0x8000;
  let exp = (x >> 23) & 0xff;
  let man = x & 0x7fffff;
  if (exp === 255) return sign | 0x7c00 | (man ? 0x200 : 0);      // inf / nan
  exp = exp - 127 + 15;
  if (exp >= 31) return sign | 0x7c00;                             // overflow -> inf
  if (exp <= 0) {
    if (exp < -10) return sign;                                    // underflow -> 0
    man = (man | 0x800000) >> (1 - exp);
    return sign | (man >> 13);
  }
  return sign | (exp << 10) | (man >> 13);
}
