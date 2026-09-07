#!/usr/bin/env python3
"""Generates assets/lut/pechorsk.png: a 32^3 colour-correction LUT laid out as a horizontal strip of 32 slices
(slice = blue, x = red, y = green), imported by Godot as a Texture3D (see pechorsk.png.import) and applied by
Environment.adjustment_color_correction after ACES tonemapping (display space).
The look: lifted blacks, cool shadows, warm highlights, slightly crushed and yellowed greens, a gentle S-curve and a
mild desaturation: the film grade of the Pechorsk zone. Deterministic; re-run with python3 assets/lut/gen_lut.py."""
import os
import numpy as np
from PIL import Image

N = 32
HERE = os.path.dirname(os.path.abspath(__file__))


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1); mn = np.min(rgb, axis=-1); d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-9
    rc = np.where(m, (mx - r) / np.maximum(d, 1e-9), 0); gc = np.where(m, (mx - g) / np.maximum(d, 1e-9), 0); bc = np.where(m, (mx - b) / np.maximum(d, 1e-9), 0)
    h = np.where(mx == r, bc - gc, np.where(mx == g, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(m, (h / 6.0) % 1.0, 0.0)
    s = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0.0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    i = np.floor(h * 6.0); f = h * 6.0 - i
    p = v * (1 - s); q = v * (1 - s * f); t = v * (1 - s * (1 - f))
    i = i.astype(int) % 6
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1)


def grade(srgb):
    lin = srgb_to_lin(srgb)
    lum = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    # cool shadows, warm highlights (in linear light)
    w = smoothstep(0.03, 0.55, lum)[..., None]
    tint = (1.0 - w) * np.array([0.90, 0.95, 1.07]) + w * np.array([1.05, 1.0, 0.94])
    lin = lin * tint
    # greens: pull the hue toward olive/yellow, take saturation out and a little value: dead vegetation, not lawn
    h, s, v = rgb_to_hsv(np.clip(lin, 0, 1))
    green = smoothstep(0.17, 0.26, h) * (1.0 - smoothstep(0.42, 0.52, h))
    h = (h - green * 0.035) % 1.0
    s = s * (1.0 - green * 0.28)
    v = v * (1.0 - green * 0.08)
    lin = hsv_to_rgb(h, s, v)
    # gentle S-curve for contrast, then lift the blacks (film base) and desaturate a touch
    lin = np.clip(lin, 0, 1)
    curve = lin * lin * (3.0 - 2.0 * lin)
    lin = lin * 0.72 + curve * 0.28
    lin = lin * 0.965 + 0.0045
    lum2 = (lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722)[..., None]
    lin = lum2 + (lin - lum2) * 0.90
    return lin_to_srgb(lin)


def main():
    idx = np.arange(N) / (N - 1.0)
    b, g, r = np.meshgrid(idx, idx, idx, indexing="ij")   # [slice(b), y(g), x(r)]
    rgb = np.stack([r, g, b], axis=-1)
    out = grade(rgb)
    strip = np.zeros((N, N * N, 3), dtype=np.float64)
    for k in range(N):
        strip[:, k * N:(k + 1) * N, :] = out[k]
    img = (np.clip(strip, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    Image.fromarray(img, "RGB").save(os.path.join(HERE, "pechorsk.png"))
    ident = np.zeros((N, N * N, 3), dtype=np.float64)
    for k in range(N):
        ident[:, k * N:(k + 1) * N, :] = rgb[k]
    Image.fromarray((np.clip(ident, 0, 1) * 255.0 + 0.5).astype(np.uint8), "RGB").save(os.path.join(HERE, "identity.png"))
    # a few probe values so the grade can be sanity-checked by eye in the terminal
    for name, c in [("black", (0, 0, 0)), ("grey18", (0.46, 0.46, 0.46)), ("white", (1, 1, 1)), ("grass", (0.35, 0.5, 0.2)), ("rust", (0.48, 0.29, 0.16)), ("sky", (0.55, 0.58, 0.62))]:
        v = grade(np.array([[c]], dtype=np.float64))[0, 0]
        print("%-7s %s -> %s" % (name, np.round(np.array(c), 3), np.round(v, 3)))


if __name__ == "__main__":
    main()
