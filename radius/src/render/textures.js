// Small procedural textures shared by several modules (sprites, glows) + the typed-array texture pipeline
// used by render/materials.js: tileable gradient/worley noise on N×N float fields, domain warp, wrapped
// blur, Sobel normal maps, crevice AO, canvas-drawn shape layers and DataTexture packing.
// Everything here is seeded and periodic: fields wrap at the tile edge so nothing seams when repeated.
import * as THREE from 'three';
const cache = new Map();
// radial gradient: stops = [[t, 'rgba(...)'], ...]
export function radialTexture(key, stops, size = 128) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.userData.shared = true;
  cache.set(key, tex); return tex;
}
export const glowTexture = () => radialTexture('glow', [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.45)'], [0.7, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']]);
export const softDotTexture = () => radialTexture('softdot', [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64);

// ---------------------------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------------------------
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function ihash(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// tiny seeded rng for generator-side decisions (positions of knots, streak sources ...)
export function seeded(seed) {
  let a = (seed * 2654435761 + 1) >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
  return r;
}

// ---------------------------------------------------------------------------------------------
// Fields: Float32Array(n*n), row y ↔ v = y/n (v = 0 is the bottom of the tile), column x ↔ u.
// ---------------------------------------------------------------------------------------------
export const field = (n, v = 0) => { const a = new Float32Array(n * n); if (v) a.fill(v); return a; };

// Periodic gradient (Perlin) noise on an fx × fy lattice, added to `out` × amp.
// mode 0: signed ≈[-1,1]; 1: ridged 1-|v| in [0,1]; 2: billow |v|.
export function gradNoise(out, n, fx, fy, amp, seed, mode = 0) {
  fx = Math.max(1, fx | 0); fy = Math.max(1, fy | 0);
  const gx = new Float32Array(fx * fy), gy = new Float32Array(fx * fy);
  for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) { const a = ihash(i, j, seed) * 6.2831853; gx[j * fx + i] = Math.cos(a); gy[j * fx + i] = Math.sin(a); }
  const xi0 = new Int32Array(n), xi1 = new Int32Array(n), xf = new Float32Array(n), xu = new Float32Array(n);
  for (let x = 0; x < n; x++) { const t = (x * fx) / n; const i = Math.floor(t); xi0[x] = i % fx; xi1[x] = (i + 1) % fx; xf[x] = t - i; xu[x] = fade(t - i); }
  const yi0 = new Int32Array(n), yi1 = new Int32Array(n), yf = new Float32Array(n), yu = new Float32Array(n);
  for (let y = 0; y < n; y++) { const t = (y * fy) / n; const j = Math.floor(t); yi0[y] = j % fy; yi1[y] = (j + 1) % fy; yf[y] = t - j; yu[y] = fade(t - j); }
  for (let y = 0; y < n; y++) {
    const j0 = yi0[y] * fx, j1 = yi1[y] * fx, v = yu[y], fv = yf[y], fv1 = fv - 1, row = y * n;
    for (let x = 0; x < n; x++) {
      const i0 = xi0[x], i1 = xi1[x], u = xu[x], fu = xf[x], fu1 = fu - 1;
      const d00 = gx[j0 + i0] * fu + gy[j0 + i0] * fv;
      const d10 = gx[j0 + i1] * fu1 + gy[j0 + i1] * fv;
      const d01 = gx[j1 + i0] * fu + gy[j1 + i0] * fv1;
      const d11 = gx[j1 + i1] * fu1 + gy[j1 + i1] * fv1;
      let val = ((d00 + (d10 - d00) * u) * (1 - v) + (d01 + (d11 - d01) * u) * v) * 1.5;
      if (mode === 1) val = 1 - Math.abs(val); else if (mode === 2) val = Math.abs(val);
      out[row + x] += val * amp;
    }
  }
  return out;
}

// Fractal sum of gradNoise. ax/ay stretch the lattice (ax < 1: features long along u).
// Octaves finer than one lattice cell per 2 texels are skipped (they'd be aliasing, not detail).
export function fbm(n, o = {}) {
  const { f = 4, oct = 6, gain = 0.5, lac = 2, amp = 1, seed = 1, mode = 0, ax = 1, ay = 1 } = o;
  const out = new Float32Array(n * n);
  let a = amp, fx = f * ax, fy = f * ay, norm = 0;
  for (let k = 0; k < oct; k++) {
    const lx = Math.max(1, Math.round(fx)), ly = Math.max(1, Math.round(fy));
    if (lx > n / 2 && ly > n / 2) break;
    gradNoise(out, n, Math.min(lx, n / 2), Math.min(ly, n / 2), a, seed + k * 131, mode); norm += a; a *= gain; fx *= lac; fy *= lac;
  }
  if (norm > 0 && norm !== 1) { const inv = 1 / norm; for (let i = 0; i < out.length; i++) out[i] *= inv; }
  return out;
}

// Periodic worley (cellular) noise. Returns F1, F2 (distance in cell units, 0..~1.4) and the cell id.
export function worley(n, fx, fy, seed, jitter = 1) {
  fx = Math.max(1, fx | 0); fy = Math.max(1, fy | 0);
  const px = new Float32Array(fx * fy), py = new Float32Array(fx * fy);
  for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) { px[j * fx + i] = 0.5 + (ihash(i, j, seed) - 0.5) * jitter; py[j * fx + i] = 0.5 + (ihash(i, j, seed + 77) - 0.5) * jitter; }
  const f1 = new Float32Array(n * n), f2 = new Float32Array(n * n), id = new Int32Array(n * n);
  for (let y = 0; y < n; y++) {
    const cy = (y * fy) / n, j = Math.floor(cy), row = y * n;
    for (let x = 0; x < n; x++) {
      const cx = (x * fx) / n, i = Math.floor(cx);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = (j + dj + fy) % fy, cyy = j + dj;
        for (let di = -1; di <= 1; di++) {
          const ii = (i + di + fx) % fx, k = jj * fx + ii;
          const ox = cx - (i + di + px[k]), oy = cy - (cyy + py[k]);
          const d = ox * ox + oy * oy;
          if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
        }
      }
      f1[row + x] = Math.sqrt(d1); f2[row + x] = Math.sqrt(d2); id[row + x] = best;
    }
  }
  return { f1, f2, id, cells: fx * fy };
}

// Bilinear wrapped sample of a field at fractional texel coordinates.
export function sample(src, n, sx, sy) {
  sx -= Math.floor(sx / n) * n; sy -= Math.floor(sy / n) * n;
  const x0 = sx | 0, y0 = sy | 0, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n, u = sx - x0, v = sy - y0;
  const a = src[y0 * n + x0], b = src[y0 * n + x1], c = src[y1 * n + x0], d = src[y1 * n + x1];
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
// Domain warp: out(x,y) = src(x + wx*amt, y + wy*amt).
export function warp(src, n, wx, wy, amt, amtY = amt) {
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x; out[i] = sample(src, n, x + wx[i] * amt, y + wy[i] * amtY); }
  return out;
}
// Wrapped separable box blur of radius r (texels).
export function blur(src, n, r) {
  r = Math.max(1, r | 0);
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n), inv = 1 / (2 * r + 1);
  for (let y = 0; y < n; y++) {
    const row = y * n; let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + ((k + n) % n)];
    for (let x = 0; x < n; x++) { tmp[row + x] = s * inv; s += src[row + ((x + r + 1) % n)] - src[row + ((x - r + n) % n)]; }
  }
  for (let x = 0; x < n; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[((k + n) % n) * n + x];
    for (let y = 0; y < n; y++) { out[y * n + x] = s * inv; s += tmp[((y + r + 1) % n) * n + x] - tmp[((y - r + n) % n) * n + x]; }
  }
  return out;
}
// Crevice occlusion from a height field: 1 in the open, darker where the local mean is above the surface.
export function crevice(h, n, r, k) {
  const b = blur(h, n, r), out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) { const d = b[i] - h[i]; out[i] = d > 0 ? clamp01(1 - k * d) : 1; }
  return out;
}
// Sobel normal map (OpenGL convention: +green = +v) as RGBA bytes.
export function normalRGBA(h, n, strength) {
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n, yc = y * n, yp = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const xm = (x - 1 + n) % n, xp = (x + 1) % n;
      const dx = (h[ym + xp] + 2 * h[yc + xp] + h[yp + xp]) - (h[ym + xm] + 2 * h[yc + xm] + h[yp + xm]);
      const dy = (h[yp + xm] + 2 * h[yp + x] + h[yp + xp]) - (h[ym + xm] + 2 * h[ym + x] + h[ym + xp]);
      let nx = -dx * strength, ny = -dy * strength;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= il; ny *= il;
      const o = (yc + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (il * 0.5 + 0.5) * 255; out[o + 3] = 255;
    }
  }
  return out;
}
// Box-downsample a field by 2.
export function downsample(src, n) {
  const m = n >> 1, out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) { const i = (2 * y) * n + 2 * x; out[y * m + x] = (src[i] + src[i + 1] + src[i + n] + src[i + n + 1]) * 0.25; }
  return out;
}
export function transpose(src, n) { const out = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x * n + y] = src[y * n + x]; return out; }

// Canvas-drawn shape layer → field (red channel 0..1). fn(g, n) draws in canvas space; the read-back is
// flipped so canvas "up" is +v (world up on walls). Draw shapes three times (±n) if they must wrap.
export function drawLayer(n, fn, w = n) {
  const c = document.createElement('canvas'); c.width = w; c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, w, n);
  fn(g, n, w);
  const px = g.getImageData(0, 0, w, n).data, out = new Float32Array(w * n);
  for (let y = 0; y < n; y++) { const src = (n - 1 - y) * w, dst = y * w; for (let x = 0; x < w; x++) out[dst + x] = px[(src + x) * 4] / 255; }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Packing and GPU textures
// ---------------------------------------------------------------------------------------------
export function packRGBA(n, r, g, b, a = null, w = n) {
  const out = new Uint8Array(w * n * 4);
  for (let i = 0, o = 0; i < w * n; i++, o += 4) {
    out[o] = clamp01(r[i]) * 255; out[o + 1] = clamp01(g[i]) * 255; out[o + 2] = clamp01(b[i]) * 255; out[o + 3] = a ? clamp01(a[i]) * 255 : 255;
  }
  return out;
}
export function dataTexture(data, w, h, o = {}) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = o.wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.generateMipmaps = o.mip !== false;
  tex.minFilter = o.mip !== false ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = o.aniso ?? 4;
  tex.needsUpdate = true;
  tex.userData.bytes = w * h * 4 * (o.mip !== false ? 1.334 : 1);
  return tex;
}
export function canvasTexture(canvas, o = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = o.wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.anisotropy = o.aniso ?? 4;
  tex.userData.bytes = canvas.width * canvas.height * 4 * 1.334;
  return tex;
}
