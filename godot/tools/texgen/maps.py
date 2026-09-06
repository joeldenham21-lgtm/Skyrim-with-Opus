"""PBR map derivation and file output: height -> normal (Sobel, OpenGL Y+), multi-scale ambient occlusion,
colour helpers, WebP writers. All inputs are periodic float32 arrays in [0,1] unless noted.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from . import noise as N

F32 = np.float32


def normal_from_height(h, strength):
    """OpenGL (Y+) tangent-space normal from a periodic height field.

    strength = height range in pixels per unit of h (i.e. how tall a 0..1 step is, in texels).
    Uses a Sobel kernel with wrap. Returns (n,n,3) in [0,1].
    """
    h = h.astype(F32)
    sx = ndimage.sobel(h, axis=1, mode="wrap") / F32(8.0)   # dh/dx per texel
    sy = ndimage.sobel(h, axis=0, mode="wrap") / F32(8.0)   # dh/drow (row grows downwards)
    nx = -sx * F32(strength)
    ny = sy * F32(strength)                                  # up = -row, so n.y = -dh/dup = +dh/drow
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx * inv, ny * inv, nz * inv], axis=-1)
    return (out * 0.5 + 0.5).astype(F32)


def ao_from_height(h, scales=(3, 10, 32, 96), weights=(0.35, 0.3, 0.25, 0.1), strength=1.0, depth_px=None):
    """Ambient occlusion from multi-scale height differences (concavity darkens). Returns (n,n) in [0,1]."""
    h = h.astype(F32)
    occ = np.zeros_like(h)
    for s, w in zip(scales, weights):
        b = N.blur_fft(h, s) if s >= 24 else N.blur(h, s)
        occ += np.clip(b - h, 0.0, 1.0) * F32(w)
    ao = 1.0 - np.clip(occ * F32(strength) * 4.0, 0.0, 0.85)
    return ao.astype(F32)


def cavity(h, sigma=1.5):
    """Small-scale concavity in [0,1] (1 = deep cavity) for dirt accumulation."""
    b = N.blur(h, sigma)
    return np.clip((b - h) * 8.0, 0.0, 1.0).astype(F32)


def edges(h, sigma=1.5):
    """Small-scale convexity in [0,1] (1 = sharp edge) for wear/highlights."""
    b = N.blur(h, sigma)
    return np.clip((h - b) * 8.0, 0.0, 1.0).astype(F32)


def slope(h, strength=1.0):
    dx, dy = N.grad(h)
    return np.clip(np.sqrt(dx * dx + dy * dy) * strength, 0.0, 1.0).astype(F32)


# ---------------------------------------------------------------- colour helpers

def hexc(s):
    s = s.lstrip("#")
    return np.array([int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=F32)


def srgb_to_lin(c):
    c = np.asarray(c, dtype=F32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F32)


def lin_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=F32), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055).astype(F32)


def solid(n, c):
    return np.broadcast_to(np.asarray(c, dtype=F32)[None, None, :], (n, n, 3)).copy()


def mix(a, b, t):
    """Blend colour arrays a,b (n,n,3) by scalar field t (n,n) or float."""
    if np.ndim(t) == 2:
        t = t[..., None]
    return (a + (b - a) * t).astype(F32)


def mul(a, f):
    if np.ndim(f) == 2:
        f = f[..., None]
    return (a * f).astype(F32)


def hsv_shift(rgb, dh=0.0, ds=0.0, dv=0.0):
    """Shift hue (turns), saturation and value of an (n,n,3) array by per-pixel or scalar amounts."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / np.where(m, d, 1), 0)
    gc = np.where(m, (mx - g) / np.where(m, d, 1), 0)
    bc = np.where(m, (mx - b) / np.where(m, d, 1), 0)
    h = np.where(r == mx, bc - gc, np.where(g == mx, 2.0 + rc - bc, 4.0 + gc - rc))
    h = (h / 6.0) % 1.0
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    v = mx
    h = (h + dh) % 1.0
    s = np.clip(s + ds, 0, 1)
    v = np.clip(v + dv, 0, 1)
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    i = i.astype(np.int32) % 6
    out = np.stack([
        np.choose(i, [v, q, p, p, t, v]),
        np.choose(i, [t, v, v, q, p, p]),
        np.choose(i, [p, p, t, v, v, q])], axis=-1)
    return out.astype(F32)


def saturate(rgb, k):
    """k < 1 desaturates towards luminance."""
    lum = (rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114)[..., None]
    return (lum + (rgb - lum) * k).astype(F32)


def grade(rgb, lift=0.0, gamma=1.0, gain=1.0):
    c = np.clip(rgb, 0, 1)
    c = np.power(c, 1.0 / gamma) * gain + lift
    return np.clip(c, 0, 1).astype(F32)


# ---------------------------------------------------------------- writers

def to_u8(a):
    return (np.clip(a, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def save_webp(path, arr, quality=90, lossless=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    u8 = to_u8(arr)
    if u8.ndim == 2:
        im = Image.fromarray(u8, "L")
    elif u8.shape[2] == 3:
        im = Image.fromarray(u8, "RGB")
    else:
        im = Image.fromarray(u8, "RGBA")
    if lossless:
        im.save(path, "WEBP", lossless=True, quality=100, method=6)
    else:
        im.save(path, "WEBP", quality=int(quality), method=6)


def save_set(root, kind, albedo, height, rough, metal, ao=None, normal_strength=None, height_scale_m=0.02, tile_m=2.0,
             ao_strength=1.0, extra_ao=None, meta=None):
    """Write the four maps for a material. height in [0,1]; normal strength derived from physical scale
    unless normal_strength is given (texels of height per unit h)."""
    n = height.shape[0]
    if normal_strength is None:
        normal_strength = height_scale_m / (tile_m / n)
    nrm = normal_from_height(height, normal_strength)
    if ao is None:
        ao = ao_from_height(height, strength=ao_strength)
    if extra_ao is not None:
        ao = np.clip(ao * extra_ao, 0.0, 1.0)
    orm = np.stack([ao, np.clip(rough, 0, 1), np.clip(metal, 0, 1)], axis=-1)
    d = os.path.join(root, kind)
    save_webp(os.path.join(d, f"{kind}_albedo.webp"), albedo, quality=90)
    save_webp(os.path.join(d, f"{kind}_normal.webp"), nrm, quality=95)
    save_webp(os.path.join(d, f"{kind}_orm.webp"), orm, quality=88)
    save_webp(os.path.join(d, f"{kind}_height.webp"), height, quality=85)
    info = {"kind": kind, "tile_m": tile_m, "height_m": height_scale_m, "size": n}
    if meta:
        info.update(meta)
    with open(os.path.join(d, f"{kind}.json"), "w") as f:
        json.dump(info, f, indent=1)
    return nrm, ao


def preview(path, albedo, nrm, orm, height, size=1024):
    """Side-by-side preview PNG (albedo | normal | orm | height) for quick inspection."""
    ims = []
    for a in (albedo, nrm, orm, height):
        u8 = to_u8(a)
        im = Image.fromarray(u8, "L" if u8.ndim == 2 else "RGB").convert("RGB").resize((size, size), Image.LANCZOS)
        ims.append(im)
    w = Image.new("RGB", (size * 2, size * 2))
    for i, im in enumerate(ims):
        w.paste(im, ((i % 2) * size, (i // 2) * size))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    w.save(path)
