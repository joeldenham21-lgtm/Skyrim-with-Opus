"""Tile-periodic noise primitives for the RADIUS texture generator.

Everything here is exactly periodic on an n x n torus: gradient (Perlin) noise on a wrapping lattice,
fractal sums, Worley/cellular noise with wrapped neighbour cells, domain warping with wrapped sampling,
and periodic blurs. All functions are deterministic for a given seed. Arrays are float32, row-major,
index [y, x] with y growing downwards (image convention).
"""
import numpy as np
from scipy import ndimage

F32 = np.float32


def rng_for(seed):
    return np.random.default_rng(int(seed) & 0xFFFFFFFF)


def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def perlin(n, cells, seed, cells_y=None, offset=(0.0, 0.0)):
    """Periodic gradient noise, lattice of `cells` x `cells_y` gradients (integers), range about [-1, 1]."""
    cells = int(cells)
    cells_y = int(cells if cells_y is None else cells_y)
    r = rng_for(seed)
    ang = r.uniform(0.0, 2.0 * np.pi, size=(cells_y, cells)).astype(F32)
    gx = np.cos(ang)
    gy = np.sin(ang)
    if n % cells == 0 and n % cells_y == 0 and offset == (0.0, 0.0):
        return _perlin_blocks(n, cells, cells_y, gx, gy)
    x = (np.arange(n, dtype=F32) + F32(offset[0])) * F32(cells / n)
    y = (np.arange(n, dtype=F32) + F32(offset[1])) * F32(cells_y / n)
    xi = np.floor(x).astype(np.int32)
    yi = np.floor(y).astype(np.int32)
    xf = (x - xi).astype(F32)
    yf = (y - yi).astype(F32)
    xi %= cells
    yi %= cells_y
    xi1 = (xi + 1) % cells
    yi1 = (yi + 1) % cells_y
    u = _fade(xf)[None, :]
    v = _fade(yf)[:, None]
    xf = xf[None, :]
    yf = yf[:, None]
    g00x = gx[np.ix_(yi, xi)]
    g00y = gy[np.ix_(yi, xi)]
    g10x = gx[np.ix_(yi, xi1)]
    g10y = gy[np.ix_(yi, xi1)]
    g01x = gx[np.ix_(yi1, xi)]
    g01y = gy[np.ix_(yi1, xi)]
    g11x = gx[np.ix_(yi1, xi1)]
    g11y = gy[np.ix_(yi1, xi1)]
    n00 = g00x * xf + g00y * yf
    n10 = g10x * (xf - 1.0) + g10y * yf
    n01 = g01x * xf + g01y * (yf - 1.0)
    n11 = g11x * (xf - 1.0) + g11y * (yf - 1.0)
    nx0 = n00 + u * (n10 - n00)
    nx1 = n01 + u * (n11 - n01)
    out = nx0 + v * (nx1 - nx0)
    return (out * F32(1.5)).astype(F32)


def _perlin_blocks(n, cells, cells_y, gx, gy):
    """Fast path: pixels grouped per lattice cell, gradients broadcast over (cy, by, cx, bx) blocks."""
    bx = n // cells
    by = n // cells_y
    xf = ((np.arange(bx, dtype=F32) + F32(0.5)) / F32(bx)).reshape(1, 1, 1, bx)
    yf = ((np.arange(by, dtype=F32) + F32(0.5)) / F32(by)).reshape(1, by, 1, 1)
    u = _fade(xf)
    v = _fade(yf)
    g00x = gx.reshape(cells_y, 1, cells, 1)
    g00y = gy.reshape(cells_y, 1, cells, 1)
    gx1 = np.roll(gx, -1, axis=1)
    gy1 = np.roll(gy, -1, axis=1)
    g10x = gx1.reshape(cells_y, 1, cells, 1)
    g10y = gy1.reshape(cells_y, 1, cells, 1)
    gx2 = np.roll(gx, -1, axis=0)
    gy2 = np.roll(gy, -1, axis=0)
    g01x = gx2.reshape(cells_y, 1, cells, 1)
    g01y = gy2.reshape(cells_y, 1, cells, 1)
    gx3 = np.roll(gx1, -1, axis=0)
    gy3 = np.roll(gy1, -1, axis=0)
    g11x = gx3.reshape(cells_y, 1, cells, 1)
    g11y = gy3.reshape(cells_y, 1, cells, 1)
    n00 = g00x * xf + g00y * yf
    n10 = g10x * (xf - 1.0) + g10y * yf
    n01 = g01x * xf + g01y * (yf - 1.0)
    n11 = g11x * (xf - 1.0) + g11y * (yf - 1.0)
    nx0 = n00 + u * (n10 - n00)
    nx1 = n01 + u * (n11 - n01)
    out = nx0 + v * (nx1 - nx0)
    return (out.reshape(n, n) * F32(1.5)).astype(F32)


def value_noise(n, cells, seed, cells_y=None):
    """Periodic value noise (smooth random lattice), range [0, 1]."""
    cells = int(cells)
    cells_y = int(cells if cells_y is None else cells_y)
    r = rng_for(seed)
    lat = r.random((cells_y, cells), dtype=F32)
    x = np.arange(n, dtype=F32) * F32(cells / n)
    y = np.arange(n, dtype=F32) * F32(cells_y / n)
    xi = np.floor(x).astype(np.int32)
    yi = np.floor(y).astype(np.int32)
    u = _fade(x - xi)[None, :]
    v = _fade(y - yi)[:, None]
    xi %= cells
    yi %= cells_y
    xi1 = (xi + 1) % cells
    yi1 = (yi + 1) % cells_y
    a = lat[np.ix_(yi, xi)]
    b = lat[np.ix_(yi, xi1)]
    c = lat[np.ix_(yi1, xi)]
    d = lat[np.ix_(yi1, xi1)]
    return (a + u * (b - a) + v * ((c + u * (d - c)) - (a + u * (b - a)))).astype(F32)


def fbm(n, cells, octaves, seed, gain=0.5, lacunarity=2, ridged=False, billow=False, cells_y=None, min_res=None):
    """Fractal sum of periodic Perlin octaves, normalised to about [-1, 1] (or [0, 1] when ridged/billow).

    Low octaves are computed at reduced resolution and upsampled (they are smooth), which keeps 2048^2 cheap.
    """
    cells = int(cells)
    cells_y = int(cells if cells_y is None else cells_y)
    out = np.zeros((n, n), dtype=F32)
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        cx = cells * (lacunarity ** o)
        cy = cells_y * (lacunarity ** o)
        if cx > n // 2 or cy > n // 2:
            break
        res = n
        if min_res is not None:
            # lattice spacing >= 8 px at the reduced resolution is invisible after bilinear upsample
            res = int(min(n, max(min_res, int(max(cx, cy)) * 8)))
            res = max(64, res)
            while n % res:
                res *= 2
        layer = perlin(res, cx, seed + 977 * o, cells_y=cy)
        if ridged:
            layer = 1.0 - np.abs(layer)
            layer = layer * layer
        elif billow:
            layer = np.abs(layer)
        if res != n:
            layer = upsample(layer, n)
        out += layer * F32(amp)
        total += amp
        amp *= gain
    out /= F32(total)
    return out.astype(F32)


def upsample(a, n):
    """Periodic bilinear upsample of a square array to n x n."""
    m = a.shape[0]
    if m == n:
        return a
    f = m / n
    coords = (np.arange(n, dtype=F32) * F32(f))
    yy, xx = np.meshgrid(coords, coords, indexing="ij")
    return ndimage.map_coordinates(a, [yy, xx], order=1, mode="grid-wrap").astype(F32)


def worley(n, cells, seed, jitter=1.0, cells_y=None, aniso=1.0, metric="euclid", extra=False):
    """Periodic cellular noise. Returns (F1, F2, cell_id) with distances in cell units (nearest feature ~0..1).

    aniso > 1 stretches cells vertically (distance in y scaled down). With extra=True also returns the offset
    vectors (dx, dy) in cell units from the pixel to its nearest feature point (for stone shading).
    """
    cells = int(cells)
    cells_y = int(cells if cells_y is None else cells_y)
    r = rng_for(seed)
    px = (r.random((cells_y, cells), dtype=F32) - 0.5) * F32(jitter) + 0.5
    py = (r.random((cells_y, cells), dtype=F32) - 0.5) * F32(jitter) + 0.5
    x = np.arange(n, dtype=F32) * F32(cells / n)
    y = np.arange(n, dtype=F32) * F32(cells_y / n)
    xi = np.floor(x).astype(np.int32)
    yi = np.floor(y).astype(np.int32)
    xf = (x - xi)[None, :]
    yf = (y - yi)[:, None]
    f1 = np.full((n, n), 1e9, dtype=F32)
    f2 = np.full((n, n), 1e9, dtype=F32)
    cid = np.zeros((n, n), dtype=np.int32)
    bdx = np.zeros((n, n), dtype=F32)
    bdy = np.zeros((n, n), dtype=F32)
    for oy in (-1, 0, 1):
        cy = (yi + oy) % cells_y
        for ox in (-1, 0, 1):
            cx = (xi + ox) % cells
            fx = px[np.ix_(cy, cx)] + F32(ox)
            fy = py[np.ix_(cy, cx)] + F32(oy)
            dx = fx - xf
            dy = (fy - yf) / F32(aniso)
            if metric == "manhattan":
                d = np.abs(dx) + np.abs(dy)
            elif metric == "cheb":
                d = np.maximum(np.abs(dx), np.abs(dy))
            else:
                d = np.sqrt(dx * dx + dy * dy)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            f1 = np.where(closer, d, f1)
            ids = (cy[:, None] * cells + cx[None, :]).astype(np.int32)
            cid = np.where(closer, ids, cid)
            if extra:
                bdx = np.where(closer, dx, bdx)
                bdy = np.where(closer, dy, bdy)
    if extra:
        return f1, f2, cid, bdx, bdy
    return f1, f2, cid


def cell_random(cid, count, seed, k=1):
    """Per-cell random values in [0,1): lookup of `k` channels by cell id (deterministic)."""
    r = rng_for(seed)
    table = r.random((int(count), k), dtype=F32)
    v = table[cid % int(count)]
    return v[..., 0] if k == 1 else v


def warp(a, dx, dy, order=1):
    """Sample a periodic array at (x + dx, y + dy) (pixels), wrapping."""
    n = a.shape[0]
    yy, xx = np.mgrid[0:n, 0:n].astype(F32)
    return ndimage.map_coordinates(a, [yy + dy, xx + dx], order=order, mode="grid-wrap").astype(F32)


def sample(a, xs, ys, order=1):
    """Sample periodic array at float coords (pixels)."""
    return ndimage.map_coordinates(a, [ys, xs], order=order, mode="grid-wrap").astype(F32)


def blur(a, sigma):
    if sigma <= 0:
        return a.astype(F32)
    if a.ndim == 3:
        return ndimage.gaussian_filter(a, (sigma, sigma, 0), mode="wrap").astype(F32)
    return ndimage.gaussian_filter(a, sigma, mode="wrap", truncate=3.0).astype(F32)


def blur_fft(a, sigma):
    """Large-sigma periodic gaussian via FFT (cheap for sigma > ~40)."""
    n = a.shape[0]
    f = np.fft.rfftfreq(n)[None, :]
    g = np.fft.fftfreq(n)[:, None]
    k = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (f * f + g * g))
    return np.fft.irfft2(np.fft.rfft2(a.astype(np.float64)) * k, s=(n, n)).astype(F32)


def dilate(a, size):
    return ndimage.maximum_filter(a, size=int(size), mode="wrap").astype(F32)


def erode(a, size):
    return ndimage.minimum_filter(a, size=int(size), mode="wrap").astype(F32)


def grad(a, scale=1.0):
    """Central-difference gradient (d/dx, d/dy) of a periodic field, in value per pixel."""
    dx = (np.roll(a, -1, axis=1) - np.roll(a, 1, axis=1)) * F32(0.5 * scale)
    dy = (np.roll(a, -1, axis=0) - np.roll(a, 1, axis=0)) * F32(0.5 * scale)
    return dx, dy


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(F32)


def remap(x, a, b, c=0.0, d=1.0):
    return (c + (np.clip((x - a) / (b - a), 0.0, 1.0)) * (d - c)).astype(F32)


def norm01(a, lo=None, hi=None):
    lo = float(np.min(a)) if lo is None else lo
    hi = float(np.max(a)) if hi is None else hi
    if hi - lo < 1e-9:
        return np.zeros_like(a, dtype=F32)
    return ((a - lo) / (hi - lo)).astype(F32)


def lerp(a, b, t):
    return (a + (b - a) * t).astype(F32)


def coords(n):
    """Pixel coordinate grids (x, y) as float32 [0, n)."""
    y, x = np.mgrid[0:n, 0:n].astype(F32)
    return x, y


def uv(n):
    """Coordinate grids in tile units [0,1)."""
    y, x = np.mgrid[0:n, 0:n].astype(F32)
    return x / F32(n), y / F32(n)


def wrapped_delta(a, b, period=1.0):
    """Smallest signed difference a-b on a circle of given period."""
    d = (a - b + period * 0.5) % period - period * 0.5
    return d


def drips(source, decay=0.985, noise=None, strength=1.0, passes=2):
    """Water/rust streaks: sources run downwards with exponential decay; wraps vertically.

    source: (n,n) non-negative amounts. noise: optional (n,n) multiplier in [0,1] that thins streaks.
    Returns (n,n) streak intensity >= 0.
    """
    n = source.shape[0]
    out = np.zeros_like(source, dtype=F32)
    carry = np.zeros(n, dtype=F32)
    src = (source * F32(strength)).astype(F32)
    for _ in range(passes):
        for y in range(n):
            mult = F32(decay) if noise is None else (F32(decay) * (0.9 + 0.1 * noise[y])).astype(F32)
            carry = np.maximum(carry * mult, src[y])
            out[y] = carry
    return out


def streak_columns(n, count, seed, width=(2, 12), length=(0.1, 0.8), amp=(0.4, 1.0)):
    """Vertical streak mask (n,n) made of `count` soft columns with random start and length; periodic."""
    r = rng_for(seed)
    x, y = coords(n)
    out = np.zeros((n, n), dtype=F32)
    for i in range(count):
        cx = r.uniform(0, n)
        w = r.uniform(*width)
        y0 = r.uniform(0, n)
        ln = r.uniform(*length) * n
        a = r.uniform(*amp)
        dx = wrapped_delta(x, cx, n)
        dy = (y - y0) % n
        prof = np.exp(-(dx * dx) / (2 * w * w)) * (dy < ln) * (1.0 - dy / max(ln, 1.0))
        out += (prof * a).astype(F32)
    return np.clip(out, 0.0, 1.0)


def random_walk_lines(n, count, seed, steps=(80, 400), step_len=3.0, wander=0.35, branch_p=0.0, start_mask=None, bias=None):
    """Random-walk polylines on the torus (crack networks). Returns list of point arrays (float, wrapped later)."""
    r = rng_for(seed)
    lines = []
    todo = []
    for i in range(count):
        if start_mask is not None:
            ys, xs = np.nonzero(start_mask)
            if len(xs) == 0:
                break
            k = r.integers(len(xs))
            p = np.array([xs[k], ys[k]], dtype=np.float64)
        else:
            p = r.uniform(0, n, 2)
        todo.append((p, r.uniform(0, 2 * np.pi), int(r.integers(*steps)), 0))
    while todo:
        p, ang, nsteps, depth = todo.pop()
        pts = [p.copy()]
        for s in range(nsteps):
            ang += r.normal(0.0, wander)
            if bias is not None:
                ang += (bias - ang + np.pi) % (2 * np.pi) - np.pi if False else 0.0
            p = p + step_len * np.array([np.cos(ang), np.sin(ang)])
            pts.append(p.copy())
            if branch_p > 0 and depth < 3 and r.random() < branch_p:
                todo.append((p.copy(), ang + r.choice([-1, 1]) * r.uniform(0.5, 1.4), max(10, nsteps // 3), depth + 1))
        lines.append(np.array(pts))
    return lines
