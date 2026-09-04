// Seeded RNG + CPU noise. Deterministic so the zone is the same every run for a given seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.range = (lo, hi) => lo + (hi - lo) * rnd();
  rnd.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rnd());
  rnd.pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  rnd.chance = (p) => rnd() < p;
  rnd.gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  rnd.fork = (salt) => mulberry32((seed * 1103515245 + salt * 12345 + 7) >>> 0);
  return rnd;
}

export function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function hash3(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Value noise, 2D, output in [-1, 1]. Smooth (quintic) so it works for heightfields.
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const r = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  return r * 2 - 1;
}
export function fbm2(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f);
    norm += amp;
    amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}
// Ridged multifractal, [0,1]
export function ridged2(x, y, octaves = 4) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f));
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2.1;
  }
  return sum / norm;
}
// Poisson-ish jittered scatter inside a rectangle. fn(x, z, rnd) may return false to reject.
export function scatter(rnd, x0, z0, x1, z1, spacing, fn) {
  const jitter = spacing * 0.9;
  for (let x = x0; x < x1; x += spacing) {
    for (let z = z0; z < z1; z += spacing) {
      const px = x + (rnd() - 0.5) * jitter, pz = z + (rnd() - 0.5) * jitter;
      fn(px, pz, rnd);
    }
  }
}
