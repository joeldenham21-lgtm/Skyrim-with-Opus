// Procedural material library (GEAR.md §9). Every surface in the zone comes from here:
//   ctx.materials.get(kind, params)  -> MeshStandardMaterial with generated albedo (AO baked), normal and
//                                       roughness/metalness maps, cached by kind+params.
//   ctx.materials.texture(kind, p)   -> { map, normalMap, roughnessMap } for custom shaders.
//   ctx.materials.terrainDetail()    -> { normalMap, roughnessMap } 2 m ground detail.
//   ctx.materials.card(kind)         -> { map (alpha), normalMap } for grass/reed/leaf/twig/cattail cards.
//   ctx.materials.decal(kind)        -> RGBA texture: bullet_concrete bullet_metal bullet_wood scorch ash.
// UV convention: mesh UVs are in METRES; a material repeats every `scale` metres (params.scale or the kind
// default). params.repeat = [u, v] overrides. params.wear is quantised to quarter steps and params.seed to
// integers so variants stay a small set; the texture budget (96 MB) halves resolution when exceeded.
import * as THREE from 'three';
import { fbm, worley, warp, blur, crevice, normalRGBA, downsample, transpose, drawLayer, packRGBA, dataTexture, canvasTexture, field, hex, mix, smooth, clamp01, ihash, seeded } from './textures.js';

const BUDGET = 96 * 1024 * 1024;
const RES = { high: { big: 1024, std: 512, small: 256 }, medium: { big: 512, std: 512, small: 256 }, low: { big: 512, std: 256, small: 128 } };
const DS = THREE.DoubleSide;

// ---------------------------------------------------------------------------------------------
// Small shared generators
// ---------------------------------------------------------------------------------------------
// 1-D periodic smooth noise over the tile width (for board edges, drips, sag).
function noise1(n, L, seed, amp = 1) {
  const out = new Float32Array(n), lat = new Float32Array(L);
  for (let i = 0; i < L; i++) lat[i] = (ihash(i, 17, seed) - 0.5) * 2;
  for (let x = 0; x < n; x++) { const t = (x * L) / n, i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); out[x] = (lat[i % L] + (lat[(i + 1) % L] - lat[i % L]) * u) * amp; }
  return out;
}
// Streaks running down (-v) from random sources: rust from rebar, rain drips, grime under nails.
function streaks(n, rnd, count, o = {}) {
  const out = field(n); if (count <= 0) return out;
  const [l0, l1] = o.len || [0.15, 0.5], [w0, w1] = o.width || [0.006, 0.016];
  const wob = noise1(n, 12, o.seed ?? 5);
  for (let k = 0; k < count; k++) {
    const x0 = o.at ? o.at[k][0] : rnd() * n, y0 = o.at ? o.at[k][1] : rnd() * n;
    const len = n * rnd.range(l0, l1), w = n * rnd.range(w0, w1), amp = rnd.range(0.55, 1);
    const ph = rnd() * n;
    for (let d = 0; d < len; d++) {
      const y = ((Math.round(y0 - d) % n) + n) % n, t = d / len;
      const fall = (1 - t) * (1 - t) * (0.55 + 0.45 * (1 - t));
      const ww = w * (1 + t * 1.3), cx = x0 + wob[(y + ph | 0) % n] * w * 1.5;
      for (let x = Math.floor(cx - ww * 2.5); x <= cx + ww * 2.5; x++) {
        const xx = ((x % n) + n) % n, dd = (x - cx) / ww;
        out[y * n + xx] += amp * fall * Math.exp(-dd * dd);
      }
    }
    if (o.source !== false) { // the source: a small dark blob (rebar end, nail)
      const R = w * 1.6;
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const d = Math.sqrt(x * x + y * y) / R; if (d < 1) { const i = ((((y0 + y) | 0) % n + n) % n) * n + ((((x0 + x) | 0) % n + n) % n); out[i] = Math.max(out[i], 1.4 * (1 - d * d)); } }
    }
  }
  return out;
}
// Boards running along u, stacked along v (count per tile). Per texel: board index, local v (0..1 between
// the board's edges), gap mask (1 inside the gap), distance to the nearest edge (texels).
function boards(n, count, seed, o = {}) {
  const bh = n / count, gapPx = (o.gap ?? 0) * bh, sag = (o.sag ?? 0) * bh, wobA = (o.wobble ?? 0.02) * bh;
  const edge = []; const gapW = [];
  for (let k = 0; k < count; k++) {
    const ph = ihash(k, 31, seed) * 6.2831853, a = sag * (0.3 + 0.7 * ihash(k, 32, seed)), w = noise1(n, 10, seed + k * 7, wobA);
    const e = new Float32Array(n); for (let x = 0; x < n; x++) e[x] = a * Math.sin((x / n) * 6.2831853 + ph) + w[x];
    edge.push(e); gapW.push(gapPx * (0.35 + 0.65 * ihash(k, 33, seed)));
  }
  const idx = new Int32Array(n * n), lv = new Float32Array(n * n), gap = new Float32Array(n * n), ed = new Float32Array(n * n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      let k = Math.floor(y / bh);
      let yl = k * bh + edge[k][x], yu = (k + 1) * bh + edge[(k + 1) % count][x];
      if (y < yl) { k = (k - 1 + count) % count; yu = yl; yl = k * bh + edge[k][x] - (k === count - 1 ? n : 0); }
      else if (y >= yu) { yl = yu; k = (k + 1) % count; yu = (k + 1) * bh + edge[(k + 1) % count][x] + (k === 0 ? n : 0); }
      const i = y * n + x, g = gapW[k];
      const dl = y - yl, du = yu - y;
      idx[i] = k; lv[i] = clamp01((dl - g) / Math.max(1, yu - yl - g)); ed[i] = Math.min(dl - g, du);
      gap[i] = g > 0 ? smooth(g, g * 0.5, dl) : 0;
    }
  }
  return { idx, lv, gap, ed, count };
}
// Wood grain: rings along u for a board field. Returns latewood 0..1.
function grainRings(n, seed, bd, o = {}) {
  const G = fbm(n, { f: 3, oct: 4, seed: seed + 3, ax: 0.35, ay: 5, gain: 0.55 });
  const C = fbm(n, { f: 1, oct: 2, seed: seed + 4, ax: 1, ay: 0.5 });
  const out = new Float32Array(n * n), knots = o.knots || [];
  const freq = o.freq ?? 16, sharp = o.sharp ?? 0.55;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, k = bd.idx[i], hk = ihash(k, 41, seed);
    let ph = G[i] * 5.5 + C[i] * 3 + bd.lv[i] * freq * (0.6 + hk) + hk * 40 + (x / n) * 4 * (ihash(k, 42, seed) - 0.5);
    for (let q = 0; q < knots.length; q++) {
      const kn = knots[q]; let dx = x - kn.x, dy = y - kn.y; if (dx > n / 2) dx -= n; if (dx < -n / 2) dx += n; if (dy > n / 2) dy -= n; if (dy < -n / 2) dy += n;
      if (kn.board !== k) continue;
      const d = Math.sqrt((dx * dx) / (kn.rx * kn.rx) + (dy * dy) / (kn.ry * kn.ry));
      ph += 3.2 / (d + 0.35);
    }
    const s = Math.sin(ph) * 0.5 + 0.5;
    out[i] = smooth(sharp, 0.95, s);
  }
  return out;
}
function knotList(n, bd, seed, count) {
  const rnd = seeded(seed + 99), out = [];
  for (let q = 0; q < count; q++) { const x = rnd() * n, y = rnd() * n, i = (y | 0) * n + (x | 0); const rx = n * rnd.range(0.012, 0.03); out.push({ x, y, rx, ry: rx * rnd.range(0.5, 0.75), board: bd.idx[i] }); }
  return out;
}
function knotMask(n, knots) { // 1 inside the knot, ring value, distance
  const m = new Float32Array(n * n), ring = new Float32Array(n * n);
  for (const kn of knots) {
    const R = Math.ceil(kn.rx * 1.6);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const d = Math.sqrt((x * x) / (kn.rx * kn.rx) + (y * y) / (kn.ry * kn.ry)); if (d > 1.5) continue;
      const i = ((((kn.y + y) | 0) % n + n) % n) * n + ((((kn.x + x) | 0) % n + n) % n);
      m[i] = Math.max(m[i], smooth(1.05, 0.9, d)); ring[i] = Math.max(ring[i], (Math.sin(d * 14) * 0.5 + 0.5) * smooth(1.05, 0.95, d) + smooth(0.9, 1.0, d) * smooth(1.15, 1.02, d));
    }
  }
  return { m, ring };
}
// Running-bond brick layout. rows × cols per tile. Returns mask (1 brick, 0 mortar), brick id, local uv.
function brickLayout(n, rows, cols, seed, o = {}) {
  const rh = n / rows, cw = n / cols, mx = o.mortarX ?? 0.045, my = o.mortarY ?? 0.13;
  const chip = fbm(n, { f: 40, oct: 2, seed: seed + 5 });
  const mask = new Float32Array(n * n), id = new Int32Array(n * n), fu = new Float32Array(n * n), fv = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const row = Math.floor(y / rh), off = (row & 1) ? cw * 0.5 : 0, ly = (y - row * rh) / rh;
    for (let x = 0; x < n; x++) {
      const xx = (x + off) % n, col = Math.floor(xx / cw), lx = (xx - col * cw) / cw, i = y * n + x;
      const c = chip[i] * 0.03;
      const m = smooth(mx * 0.5 + c, mx * 1.3 + c, lx) * smooth(1 - mx * 0.5 - c, 1 - mx * 1.3 - c, lx) * smooth(my * 0.5 + c, my * 1.3 + c, ly) * smooth(1 - my * 0.5 - c, 1 - my * 1.3 - c, ly);
      mask[i] = m; id[i] = row * 977 + col; fu[i] = lx; fv[i] = ly;
    }
  }
  return { mask, id, fu, fv };
}
// plain-weave canvas height, T threads per tile
function weave(n, T, seed, fibre = 0.25) {
  const out = new Float32Array(n * n), fz = fbm(n, { f: 64, oct: 2, seed });
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = Math.sin((x / n) * T * 6.2831853), b = Math.sin((y / n) * T * 6.2831853);
    const cx = Math.floor((x / n) * T * 2), cy = Math.floor((y / n) * T * 2), over = (cx + cy) & 1;
    const h = over ? Math.abs(a) * (0.7 + 0.3 * Math.abs(b)) : Math.abs(b) * (0.7 + 0.3 * Math.abs(a));
    out[y * n + x] = h + fz[y * n + x] * fibre;
  }
  return out;
}
const rgbFields = (n) => [field(n), field(n), field(n)];
const P = (h) => hex(h);

// ---------------------------------------------------------------------------------------------
// Kind generators: (n, p) → { r, g, b, h, rough, metal?, alpha?, aoR?, aoK? }   (fields of n×n)
// ---------------------------------------------------------------------------------------------
function genConcrete(n, p) {
  const s = p.seed * 7919 + 1, rnd = seeded(s);
  const big = fbm(n, { f: 2, oct: 3, seed: s + 1 }), mid = fbm(n, { f: 9, oct: 3, seed: s + 2 });
  const grain = fbm(n, { f: 80, oct: 2, seed: s + 3, gain: 0.7 }), spk = fbm(n, { f: 150, oct: 1, seed: s + 4 });
  const W = worley(n, 30, 30, s + 5);
  const crk = fbm(n, { f: 5, oct: 5, seed: s + 6, mode: 1, gain: 0.55 }), crkSel = fbm(n, { f: 2, oct: 2, seed: s + 7 });
  const dampN = fbm(n, { f: 3, oct: 3, seed: s + 8 }), fw = fbm(n, { f: 6, oct: 3, seed: s + 9, ax: 0.3, ay: 5 });
  const st = streaks(n, rnd, 2 + Math.round(p.wear * 5), { seed: s + 10 }), stN = fbm(n, { f: 16, oct: 2, seed: s + 11 });
  const boardsN = 8, bh = n / boardsN, bOff = []; for (let k = 0; k < boardsN; k++) bOff.push((ihash(k, 3, s) - 0.5) * 0.12);
  const base = P(0x6e6b66), light = P(0x8e8a82), dark = P(0x46443f), wet = P(0x3f4144), rust = P(0x7a4a2a), rustD = P(0x4a2a16), lime = P(0xa8a49a);
  const pitR = new Float32Array(W.cells); for (let k = 0; k < W.cells; k++) { const q = ihash(k, 9, s); pitR[k] = q > 0.74 ? 0.1 + (q - 0.74) * 1.2 : 0; }
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let y = 0; y < n; y++) {
    const bi = Math.floor(y / bh), inB = (y - bi * bh) / bh, v = y / n, groove = smooth(0.035, 0, inB) + smooth(0.965, 1, inB);
    for (let x = 0; x < n; x++) {
      const i = y * n + x, u = x / n;
      const seam = smooth(0.005, 0, Math.abs(u - 0.5)) + smooth(0.005, 0, Math.min(u, 1 - u));
      const pr = pitR[W.id[i]], pit = pr > 0 ? smooth(pr, pr * 0.2, W.f1[i]) : 0;
      const crack = smooth(0.9, 0.985, crk[i]) * smooth(0.1, 0.5, crkSel[i] * 0.5 + 0.5);
      const dm = clamp01(smooth(0.35, 0.8, dampN[i] * 0.5 + 0.5) * 0.65 + p.damp * smooth(0.55, 0.05, v + dampN[i] * 0.12));
      const sk = smooth(0.4, 0.75, spk[i]) * 0.55, sv = clamp01(st[i] * (0.7 + 0.3 * stN[i]));
      const tone = 1 + big[i] * 0.14 + mid[i] * 0.06 + grain[i] * 0.12 + (ihash(bi, 5, s) - 0.5) * 0.08;
      let cr = base[0] * tone, cg = base[1] * tone, cb = base[2] * tone;
      cr = mix(cr, light[0], sk); cg = mix(cg, light[1], sk); cb = mix(cb, light[2], sk);
      const limeT = smooth(0.15, 0.4, sv) * smooth(0.9, 0.5, sv) * 0.35;   // pale lime leaching beside the rust run
      cr = mix(cr, lime[0], limeT); cg = mix(cg, lime[1], limeT); cb = mix(cb, lime[2], limeT);
      const dk = clamp01(pit * 0.8 + crack * 0.7 + groove * 0.35 + seam * 0.5);
      cr = mix(cr, dark[0], dk); cg = mix(cg, dark[1], dk); cb = mix(cb, dark[2], dk);
      cr = mix(cr, wet[0], dm * 0.6); cg = mix(cg, wet[1], dm * 0.6); cb = mix(cb, wet[2], dm * 0.6);
      const rc = sv > 0.6 ? rustD : rust, rt = smooth(0.05, 0.7, sv) * 0.85;
      cr = mix(cr, rc[0], rt); cg = mix(cg, rc[1], rt); cb = mix(cb, rc[2], rt);
      r[i] = cr; g[i] = cg; b[i] = cb;
      h[i] = bOff[bi] + big[i] * 0.12 + mid[i] * 0.06 + grain[i] * 0.05 + fw[i] * 0.03 - groove * 0.22 - seam * 0.3 - pit * 0.45 - crack * 0.5;
      ro[i] = clamp01(0.88 + grain[i] * 0.06 + pit * 0.05 - dm * 0.42 + sv * 0.05);
    }
  }
  return { r, g, b, h, rough: ro, aoK: 3 };
}

function genPlaster(n, p) {
  const s = p.seed * 7919 + 11, rnd = seeded(s), wear = p.wear;
  const paint = p.color || P(0x8fa08a), plaster = P(0xc4b9a6), plasterD = P(0x8f8472), mortar = P(0x8c8478), grime = P(0x3e3b36), chalk = P(0xd8d6cc);
  const peel = fbm(n, { f: 3, oct: 5, seed: s + 1, gain: 0.55 }), peel2 = fbm(n, { f: 9, oct: 3, seed: s + 2 });
  const plas = fbm(n, { f: 2.5, oct: 4, seed: s + 3 }), grain = fbm(n, { f: 70, oct: 2, seed: s + 4 });
  const bl = fbm(n, { f: 22, oct: 3, seed: s + 5 }), fadeN = fbm(n, { f: 2, oct: 3, seed: s + 6 });
  const st = streaks(n, rnd, 2 + Math.round(wear * 4), { seed: s + 7, len: [0.2, 0.7], source: false });
  const crk = fbm(n, { f: 6, oct: 4, seed: s + 8, mode: 1 });
  const bk = brickLayout(n, 20, 6, s + 9), bcol = [P(0x8a4a34), P(0x7a4030), P(0x9a5a3e), P(0x6a3a2c), P(0x5c3028)];
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const pn = peel[i] * 0.7 + peel2[i] * 0.3;
    const paintLoss = smooth(0.1 - wear * 0.55, 0.32 - wear * 0.55, pn);
    const edge = smooth(0.0, 0.1, paintLoss) * smooth(0.35, 0.12, paintLoss);   // lifted rim of the paint
    const plasterLoss = smooth(0.35 - wear * 0.4, 0.55 - wear * 0.4, plas[i]) * smooth(0.6, 0.95, paintLoss);
    const blister = smooth(0.5, 0.75, bl[i]) * (1 - paintLoss);
    const crack = smooth(0.9, 0.98, crk[i]) * (1 - plasterLoss) * 0.8;
    const sv = clamp01(st[i]) * 0.5, fade = fadeN[i] * 0.5 + 0.5;
    const bm = bk.mask[i], bc = bcol[Math.floor(ihash(bk.id[i], 1, s) * bcol.length)], bt = 0.85 + ihash(bk.id[i], 2, s) * 0.3;
    // brick layer colour
    let br = mix(mortar[0], bc[0] * bt, bm), bg = mix(mortar[1], bc[1] * bt, bm), bb = mix(mortar[2], bc[2] * bt, bm);
    // plaster colour: sand grain, staining toward the peel edge
    const stain = smooth(0.6, 0.95, paintLoss) * 0.35 + grain[i] * 0.06;
    let pr = mix(plaster[0], plasterD[0], stain), pg = mix(plaster[1], plasterD[1], stain), pb = mix(plaster[2], plasterD[2], stain);
    // paint: uneven fade, chalking, blister shading
    const pt = 1 + (fade - 0.5) * 0.2 + grain[i] * 0.03 - blister * 0.12;
    let cr = paint[0] * pt, cg = paint[1] * pt, cb = paint[2] * pt;
    const ch = smooth(0.6, 0.9, fade) * 0.25; cr = mix(cr, chalk[0], ch); cg = mix(cg, chalk[1], ch); cb = mix(cb, chalk[2], ch);
    // composite
    let R = mix(cr, pr, paintLoss), G = mix(cg, pg, paintLoss), B = mix(cb, pb, paintLoss);
    R = mix(R, br, plasterLoss); G = mix(G, bg, plasterLoss); B = mix(B, bb, plasterLoss);
    const dk = clamp01(crack * 0.7 + sv + (1 - bm) * plasterLoss * 0.3);
    R = mix(R, grime[0], dk); G = mix(G, grime[1], dk); B = mix(B, grime[2], dk);
    R = mix(R, chalk[0], edge * 0.3); G = mix(G, chalk[1], edge * 0.3); B = mix(B, chalk[2], edge * 0.3);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = (1 - plasterLoss) * 0.5 + (1 - paintLoss) * 0.07 + edge * 0.05 + blister * 0.08 + grain[i] * 0.03 * (1 - plasterLoss) + bm * 0.16 * plasterLoss - crack * 0.25;
    ro[i] = clamp01(mix(mix(0.62 + fade * 0.15, 0.92, paintLoss), 0.9, plasterLoss) + crack * 0.05 + sv * 0.1);
  }
  return { r, g, b, h, rough: ro, aoK: 3.5 };
}

function genBrick(n, p) {
  const s = p.seed * 7919 + 23, wear = p.wear;
  const bk = brickLayout(n, 14, 4, s, { mortarX: 0.04, mortarY: 0.14 });
  const grain = fbm(n, { f: 60, oct: 2, seed: s + 1 }), drag = fbm(n, { f: 6, oct: 3, seed: s + 2, ax: 0.2, ay: 6 });
  const eff = fbm(n, { f: 2, oct: 3, seed: s + 3 }), soot = fbm(n, { f: 3, oct: 3, seed: s + 4 });
  const mcr = fbm(n, { f: 8, oct: 4, seed: s + 5, mode: 1 }), W = worley(n, 40, 40, s + 6);
  const pal = [P(0x8a4a34), P(0x7c4231), P(0x9a5a3e), P(0x704034), P(0x5a3028), P(0x8e5640), P(0xa4705a)];
  const mortar = P(0x8c8578), mortarD = P(0x5c5850), white = P(0xd9d4c6), inner = P(0x9a5a48), dark = P(0x2e2420);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const id = bk.id[i], q = ihash(id, 1, s), bm = bk.mask[i];
    const c = pal[Math.floor(ihash(id, 2, s) * pal.length)], t = 0.82 + ihash(id, 3, s) * 0.36;
    const spall = ihash(id, 4, s) < wear * 0.22 ? smooth(0.3, 0.6, fbm1(bk.fu[i], bk.fv[i], id)) : 0;
    const pit = W.f1[i] < 0.22 && ihash(W.id[i], 7, s) > 0.8 ? smooth(0.22, 0.08, W.f1[i]) : 0;
    const chipC = cornerChip(bk.fu[i], bk.fv[i], id, s, wear);
    const mcrack = smooth(0.92, 0.985, mcr[i]) * (1 - bm);
    const mloss = smooth(0.6, 0.85, soot[i]) * (1 - bm) * wear;
    let R = c[0] * t, G = c[1] * t, B = c[2] * t;
    const tone = 1 + grain[i] * 0.1 + drag[i] * 0.06; R *= tone; G *= tone; B *= tone;
    R = mix(R, inner[0], spall * 0.7); G = mix(G, inner[1], spall * 0.7); B = mix(B, inner[2], spall * 0.7);
    const so = smooth(0.35, 0.8, soot[i]) * 0.35 * q; R = mix(R, dark[0], so); G = mix(G, dark[1], so); B = mix(B, dark[2], so);
    const ef = smooth(0.45, 0.8, eff[i]) * 0.5; R = mix(R, white[0], ef); G = mix(G, white[1], ef); B = mix(B, white[2], ef);
    let mr = mortar[0] * (1 + grain[i] * 0.12), mg = mortar[1] * (1 + grain[i] * 0.12), mb = mortar[2] * (1 + grain[i] * 0.12);
    mr = mix(mr, mortarD[0], mloss + mcrack); mg = mix(mg, mortarD[1], mloss + mcrack); mb = mix(mb, mortarD[2], mloss + mcrack);
    const dk = clamp01(pit * 0.6 + chipC * 0.45);
    R = mix(R, dark[0], dk); G = mix(G, dark[1], dk); B = mix(B, dark[2], dk);
    r[i] = mix(mr, R, bm); g[i] = mix(mg, G, bm); b[i] = mix(mb, B, bm);
    h[i] = bm * (0.28 + ihash(id, 5, s) * 0.06) + grain[i] * 0.025 + drag[i] * 0.02 - pit * 0.2 * bm - chipC * 0.25 - spall * 0.2 - mloss * 0.25 - mcrack * 0.15;
    ro[i] = clamp01(mix(0.95, 0.86 + grain[i] * 0.06 + ef * 0.08, bm) + spall * 0.06);
  }
  return { r, g, b, h, rough: ro, aoK: 3 };
}
// helpers for brick faces: cheap per-brick noise + corner chips
function fbm1(u, v, id) { const a = Math.sin(u * 9.1 + id * 0.7) * Math.cos(v * 7.3 + id * 1.3); return a * 0.5 + 0.5; }
function cornerChip(u, v, id, s, wear) {
  let c = 0;
  for (let k = 0; k < 4; k++) {
    if (ihash(id, 20 + k, s) > 0.12 + wear * 0.35) continue;
    const cu = (k & 1) ? 1 : 0, cv = (k & 2) ? 1 : 0, rad = 0.08 + ihash(id, 30 + k, s) * 0.18;
    const d = Math.sqrt((u - cu) * (u - cu) * 0.25 + (v - cv) * (v - cv));
    c = Math.max(c, smooth(rad, rad * 0.6, d));
  }
  return c;
}

function genRust(n, p) {
  const s = p.seed * 7919 + 37, wear = p.wear;
  const rN = fbm(n, { f: 4, oct: 5, seed: s + 1 }), rN2 = fbm(n, { f: 14, oct: 3, seed: s + 2 });
  const pits = worley(n, 44, 44, s + 3), flakes = worley(n, 12, 12, s + 4, 0.9);
  const paintN = fbm(n, { f: 3, oct: 4, seed: s + 5 }), paintN2 = fbm(n, { f: 15, oct: 2, seed: s + 6 });
  const grain = fbm(n, { f: 90, oct: 2, seed: s + 7 }), scr = fbm(n, { f: 10, oct: 3, seed: s + 8, mode: 1, ax: 0.2, ay: 3 });
  const dark = P(0x3e1e12), mid = P(0x8a4a22), lightR = P(0xb56f38), orange = P(0xc98a44), paint = p.color || P(0x585b40), paintF = P(0x7c7e62), primer = P(0x6e3626), bare = P(0x8c8e8a);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n), me = field(n);
  for (let i = 0; i < n * n; i++) {
    const pn = paintN[i] * 0.75 + paintN2[i] * 0.25;
    const paintLeft = smooth(0.05 + wear * 0.55, 0.22 + wear * 0.55, pn);         // 1 where paint survives
    const rim = smooth(0.0, 0.25, paintLeft) * smooth(0.6, 0.3, paintLeft);
    const t = clamp01(rN[i] * 0.5 + 0.5 + rN2[i] * 0.25);
    const pitId = pits.id[i], pit = ihash(pitId, 1, s) > 0.45 ? smooth(0.32, 0.08, pits.f1[i]) : 0;
    const fl = flakes.f2[i] - flakes.f1[i], flakeCrack = smooth(0.09, 0.02, fl), flakeH = ihash(flakes.id[i], 2, s);
    const lifted = smooth(0.5, 0.95, flakeH) * smooth(0.25, 0.12, fl);
    const scratch = smooth(0.93, 0.99, scr[i]) * paintLeft;
    // rust gradient dark → mid → light → orange (flake tops brighter)
    let R, G, B;
    if (t < 0.4) { const k = t / 0.4; R = mix(dark[0], mid[0], k); G = mix(dark[1], mid[1], k); B = mix(dark[2], mid[2], k); }
    else if (t < 0.75) { const k = (t - 0.4) / 0.35; R = mix(mid[0], lightR[0], k); G = mix(mid[1], lightR[1], k); B = mix(mid[2], lightR[2], k); }
    else { const k = (t - 0.75) / 0.25; R = mix(lightR[0], orange[0], k); G = mix(lightR[1], orange[1], k); B = mix(lightR[2], orange[2], k); }
    const tone = 1 + grain[i] * 0.15 - pit * 0.4 - flakeCrack * 0.5 + lifted * 0.15; R *= tone; G *= tone; B *= tone;
    // paint island: faded olive with the primer showing at the rim, bare scratches
    const pf = smooth(0.3, 0.8, paintN2[i] * 0.5 + 0.5) * 0.5;
    let pr = mix(paint[0], paintF[0], pf), pg = mix(paint[1], paintF[1], pf), pb = mix(paint[2], paintF[2], pf);
    pr = mix(pr, primer[0], rim * 0.7); pg = mix(pg, primer[1], rim * 0.7); pb = mix(pb, primer[2], rim * 0.7);
    pr = mix(pr, bare[0], scratch); pg = mix(pg, bare[1], scratch); pb = mix(pb, bare[2], scratch);
    r[i] = mix(R, pr, paintLeft); g[i] = mix(G, pg, paintLeft); b[i] = mix(B, pb, paintLeft);
    h[i] = paintLeft * 0.22 + rim * 0.08 + flakeH * 0.12 * (1 - paintLeft) + lifted * 0.1 + grain[i] * 0.05 - pit * 0.3 - flakeCrack * 0.35 - scratch * 0.05;
    ro[i] = clamp01(mix(0.9 + grain[i] * 0.05 + pit * 0.05, 0.55 + pf * 0.2, paintLeft) - scratch * 0.2);
    me[i] = scratch * 0.7 + (1 - paintLeft) * 0.05;
  }
  return { r, g, b, h, rough: ro, metal: me, aoK: 3 };
}

function genPaintedMetal(n, p) {
  const s = p.seed * 7919 + 41, wear = p.wear, rnd = seeded(s);
  const paint = p.color || P(0x4f5540), paintF = P(0x6d735c), primer = P(0x7a3b2a), bare = P(0x8e918c), dirt = P(0x2c2b26), rust = P(0x7a4a2a);
  const peel = fbm(n, { f: 60, oct: 2, seed: s + 1 }), fade = fbm(n, { f: 2, oct: 3, seed: s + 2 });
  const scr1 = fbm(n, { f: 8, oct: 3, seed: s + 3, mode: 1, ax: 0.12, ay: 4 }), scr2 = fbm(n, { f: 8, oct: 3, seed: s + 4, mode: 1, ax: 3, ay: 0.15 });
  const chips = worley(n, 18, 18, s + 5), chipN = fbm(n, { f: 30, oct: 2, seed: s + 6 });
  const rivets = 16, rv = n / rivets, inset = 0.03 * n, R = n * 0.011;
  const rivetAt = []; for (let k = 0; k < rivets; k++) { rivetAt.push([k * rv + rv * 0.5, n * 0.5 - inset]); rivetAt.push([k * rv + rv * 0.5, n - inset]); rivetAt.push([n * 0.5 - inset, k * rv + rv * 0.5]); rivetAt.push([n - inset, k * rv + rv * 0.5]); }
  const rivetF = field(n), rivetWear = field(n);
  for (const [cx, cy] of rivetAt) { const w = rnd(); for (let y = -R * 2; y <= R * 2; y++) for (let x = -R * 2; x <= R * 2; x++) { const d = Math.sqrt(x * x + y * y) / R; const i = ((((cy + y) | 0) % n + n) % n) * n + ((((cx + x) | 0) % n + n) % n); if (d < 1) rivetF[i] = Math.max(rivetF[i], Math.sqrt(1 - d * d)); rivetWear[i] = Math.max(rivetWear[i], smooth(1.9, 0.9, d) * w); } }
  const st = streaks(n, rnd, Math.round(wear * 6), { seed: s + 8, len: [0.05, 0.2], width: [0.004, 0.008], source: false });
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n), me = field(n);
  for (let y = 0; y < n; y++) {
    const v = y / n, seamV = smooth(0.004, 0, Math.abs(v - 0.5)) + smooth(0.004, 0, Math.min(v, 1 - v));
    for (let x = 0; x < n; x++) {
      const i = y * n + x, u = x / n, seam = clamp01(seamV + smooth(0.004, 0, Math.abs(u - 0.5)) + smooth(0.004, 0, Math.min(u, 1 - u)));
      const seamDirt = clamp01(smooth(0.02, 0, Math.abs(v - 0.5)) + smooth(0.02, 0, Math.min(v, 1 - v)) + smooth(0.02, 0, Math.abs(u - 0.5)) + smooth(0.02, 0, Math.min(u, 1 - u))) * 0.5;
      const scratch = Math.max(smooth(0.93, 0.99, scr1[i]), smooth(0.95, 0.995, scr2[i]) * 0.8) * (0.4 + wear);
      const cid = chips.id[i], chipSel = ihash(cid, 1, s) < 0.08 + wear * 0.3 ? 0.15 + ihash(cid, 2, s) * 0.25 : 0;
      const cd = chips.f1[i] + chipN[i] * 0.08;
      const chip = chipSel ? smooth(chipSel, chipSel * 0.8, cd) : 0, chipRim = chipSel ? smooth(chipSel * 1.3, chipSel * 1.0, cd) * (1 - chip) : 0;
      const rw = rivetWear[i] * (0.3 + wear * 0.7);
      const fd = smooth(0.3, 0.8, fade[i] * 0.5 + 0.5) * 0.45;
      let R = mix(paint[0], paintF[0], fd), G = mix(paint[1], paintF[1], fd), B = mix(paint[2], paintF[2], fd);
      const tone = 1 + peel[i] * 0.05; R *= tone; G *= tone; B *= tone;
      R = mix(R, primer[0], chipRim * 0.8 + rw * 0.3); G = mix(G, primer[1], chipRim * 0.8 + rw * 0.3); B = mix(B, primer[2], chipRim * 0.8 + rw * 0.3);
      const bareT = clamp01(chip + scratch + rw * 0.6);
      R = mix(R, bare[0], bareT); G = mix(G, bare[1], bareT); B = mix(B, bare[2], bareT);
      const rs = clamp01(st[i]) * 0.7; R = mix(R, rust[0], rs); G = mix(G, rust[1], rs); B = mix(B, rust[2], rs);
      const dk = clamp01(seamDirt + seam * 0.6); R = mix(R, dirt[0], dk); G = mix(G, dirt[1], dk); B = mix(B, dirt[2], dk);
      r[i] = R; g[i] = G; b[i] = B;
      h[i] = 0.3 + peel[i] * 0.02 + rivetF[i] * 0.35 - seam * 0.25 - chip * 0.05 - scratch * 0.03;
      ro[i] = clamp01(0.58 + fd * 0.25 + peel[i] * 0.04 - bareT * 0.2 + rs * 0.3 + dk * 0.2);
      me[i] = bareT * 0.85;
    }
  }
  return { r, g, b, h, rough: ro, metal: me, aoK: 2.5 };
}

function genSteel(n, p) {
  const s = p.seed * 7919 + 53;
  const brush = fbm(n, { f: 4, oct: 4, seed: s + 1, ax: 0.05, ay: 8, gain: 0.6 }), oil = fbm(n, { f: 2, oct: 3, seed: s + 2 });
  const scr = fbm(n, { f: 6, oct: 3, seed: s + 3, mode: 1, ax: 2, ay: 0.3 }), spots = fbm(n, { f: 12, oct: 2, seed: s + 4 });
  const base = P(0x6a6d70), darkO = P(0x3c3f42), rustS = P(0x6a4a34);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n), me = field(n);
  for (let i = 0; i < n * n; i++) {
    const ol = smooth(0.2, 0.7, oil[i] * 0.5 + 0.5), sc = smooth(0.95, 0.995, scr[i]), sp = smooth(0.62, 0.8, spots[i]) * 0.5;
    const tone = 1 + brush[i] * 0.16 + sc * 0.3;
    let R = base[0] * tone, G = base[1] * tone, B = base[2] * tone;
    R = mix(R, darkO[0], ol * 0.5); G = mix(G, darkO[1], ol * 0.5); B = mix(B, darkO[2], ol * 0.5);
    R = mix(R, rustS[0], sp); G = mix(G, rustS[1], sp); B = mix(B, rustS[2], sp);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = brush[i] * 0.05 - sc * 0.04;
    ro[i] = clamp01(0.42 + brush[i] * 0.08 - ol * 0.22 + sp * 0.4 + sc * 0.1);
    me[i] = 0.85 - sp * 0.6;
  }
  return { r, g, b, h, rough: ro, metal: me, ao: false };
}

function genGunmetal(n, p) {
  const s = p.seed * 7919 + 61, wear = p.wear;
  const wearN = fbm(n, { f: 4, oct: 5, seed: s + 1, gain: 0.55 }), scr = fbm(n, { f: 12, oct: 3, seed: s + 2, mode: 1, ax: 0.15, ay: 3 });
  const oil = fbm(n, { f: 3, oct: 3, seed: s + 3 }), grain = fbm(n, { f: 120, oct: 1, seed: s + 4 });
  const blue = P(0x1f2328), blueL = P(0x343a41), silver = P(0x9a9c99), silverD = P(0x6f7270);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n), me = field(n);
  for (let y = 0; y < n; y++) {
    const mach = Math.sin((y / n) * 6.2831853 * 90) * 0.5 + 0.5;   // lathe / mill marks along u
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const w = smooth(0.62 - wear * 0.6, 0.85 - wear * 0.6, wearN[i] * 0.5 + 0.5 + grain[i] * 0.05);
      const sc = smooth(0.94, 0.99, scr[i]) * (0.3 + wear * 0.7), ol = smooth(0.3, 0.8, oil[i] * 0.5 + 0.5);
      let R = mix(blue[0], blueL[0], mach * 0.35 + grain[i] * 0.2), G = mix(blue[1], blueL[1], mach * 0.35 + grain[i] * 0.2), B = mix(blue[2], blueL[2], mach * 0.35 + grain[i] * 0.2);
      const sv = clamp01(w + sc), sCol = w > 0.6 ? silver : silverD;
      R = mix(R, sCol[0], sv); G = mix(G, sCol[1], sv); B = mix(B, sCol[2], sv);
      r[i] = R; g[i] = G; b[i] = B;
      h[i] = mach * 0.012 + grain[i] * 0.01 - sc * 0.03 - w * 0.02;
      ro[i] = clamp01(0.4 + mach * 0.04 - sv * 0.14 - ol * 0.15 + grain[i] * 0.03);
      me[i] = 0.9;
    }
  }
  return { r, g, b, h, rough: ro, metal: me, ao: false };
}

function genBakelite(n, p) {
  const s = p.seed * 7919 + 71;
  const base = fbm(n, { f: 3, oct: 4, seed: s + 1 }), wx = fbm(n, { f: 2, oct: 3, seed: s + 2 }), wy = fbm(n, { f: 2, oct: 3, seed: s + 3 });
  const sw = warp(base, n, wx, wy, n * 0.12), scr = fbm(n, { f: 8, oct: 3, seed: s + 4, mode: 1, ax: 2, ay: 0.4 }), grain = fbm(n, { f: 100, oct: 1, seed: s + 5 });
  const dark = P(0x351710), midC = P(0x5c2a1a), light = P(0x8a4428);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const t = Math.sin(sw[i] * 9 + base[i] * 2) * 0.5 + 0.5, sc = smooth(0.95, 0.995, scr[i]) * 0.5;
    let R, G, B;
    if (t < 0.5) { const k = t * 2; R = mix(dark[0], midC[0], k); G = mix(dark[1], midC[1], k); B = mix(dark[2], midC[2], k); }
    else { const k = (t - 0.5) * 2; R = mix(midC[0], light[0], k); G = mix(midC[1], light[1], k); B = mix(midC[2], light[2], k); }
    r[i] = R + sc * 0.25; g[i] = G + sc * 0.2; b[i] = B + sc * 0.18;
    h[i] = grain[i] * 0.006 - sc * 0.03 + t * 0.004;
    ro[i] = clamp01(0.34 + sc * 0.3 + grain[i] * 0.03 + t * 0.05);
  }
  return { r, g, b, h, rough: ro, ao: false };
}

function genWood(n, p) {
  const s = p.seed * 7919 + 83, wear = p.wear;
  const bd = boards(n, 12, s, { gap: 0.02, sag: 0, wobble: 0.012 }), knots = knotList(n, bd, s, 3 + Math.round(wear * 2));
  const rings = grainRings(n, s, bd, { knots, freq: 18 }), km = knotMask(n, knots);
  const fibre = fbm(n, { f: 40, oct: 3, seed: s + 5, ax: 0.15, ay: 4 }), weath = fbm(n, { f: 2, oct: 3, seed: s + 6 });
  const checks = fbm(n, { f: 6, oct: 4, seed: s + 7, mode: 1, ax: 0.06, ay: 3 }), dirt = fbm(n, { f: 3, oct: 3, seed: s + 8 });
  const early = P(0x9a6a3c), late = P(0x5a3a22), grey = P(0x8c8478), greyD = P(0x5e5a52), knotC = P(0x35200f), soil = P(0x3a2e22);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const k = bd.idx[i], bt = 0.85 + ihash(k, 51, s) * 0.3, bw = ihash(k, 52, s);
    const ring = rings[i], fb = fibre[i] * 0.5 + 0.5;
    const w = clamp01(smooth(0.2, 0.7, weath[i] * 0.5 + 0.5) * (0.3 + wear * 0.9) * (0.5 + bw) + smooth(3, 0, bd.ed[i]) * 0.5 * wear);
    const chk = smooth(0.94, 0.99, checks[i]) * smooth(0.2, 0.6, weath[i] * 0.5 + 0.5) * (0.3 + wear);
    const dk = smooth(0.4, 0.85, dirt[i] * 0.5 + 0.5) * 0.35 * (0.4 + wear) + bd.gap[i] * 0.9;
    let R = mix(early[0], late[0], ring) * bt, G = mix(early[1], late[1], ring) * bt, B = mix(early[2], late[2], ring) * bt;
    const tone = 1 + (fb - 0.5) * 0.25; R *= tone; G *= tone; B *= tone;
    const gc = ring > 0.5 ? greyD : grey; R = mix(R, gc[0], w * 0.8); G = mix(G, gc[1], w * 0.8); B = mix(B, gc[2], w * 0.8);
    R = mix(R, knotC[0], km.m[i] * (0.5 + km.ring[i] * 0.5)); G = mix(G, knotC[1], km.m[i] * (0.5 + km.ring[i] * 0.5)); B = mix(B, knotC[2], km.m[i] * (0.5 + km.ring[i] * 0.5));
    const dd = clamp01(dk + chk * 0.8); R = mix(R, soil[0], dd); G = mix(G, soil[1], dd); B = mix(B, soil[2], dd);
    r[i] = R; g[i] = G; b[i] = B;
    const cup = -(bd.lv[i] - 0.5) * (bd.lv[i] - 0.5) * 0.16 * (0.5 + bw);
    h[i] = (ihash(k, 53, s) - 0.5) * 0.06 + cup + ring * 0.03 * (1 + w * 2) + (fb - 0.5) * 0.02 - bd.gap[i] * 0.5 - chk * 0.2 - km.m[i] * 0.08 - smooth(0.9, 1.05, km.ring[i]) * 0.05 - smooth(2.5, 0, bd.ed[i]) * 0.06;
    ro[i] = clamp01(0.72 + ring * 0.08 + w * 0.2 + dd * 0.1 - km.m[i] * 0.05);
  }
  return { r, g, b, h, rough: ro, aoK: 3 };
}

function genPlanks(n, p) {
  const s = p.seed * 7919 + 97, wear = p.wear, rnd = seeded(s);
  const bd = boards(n, 9, s, { gap: 0.09, sag: 0.05, wobble: 0.03 }), knots = knotList(n, bd, s, 2 + Math.round(wear * 2));
  const rings = grainRings(n, s, bd, { knots, freq: 22, sharp: 0.45 }), km = knotMask(n, knots);
  const fibre = fbm(n, { f: 36, oct: 3, seed: s + 5, ax: 0.12, ay: 4 }), weath = fbm(n, { f: 2, oct: 3, seed: s + 6 }), alg = fbm(n, { f: 4, oct: 3, seed: s + 7 });
  const checks = fbm(n, { f: 5, oct: 4, seed: s + 8, mode: 1, ax: 0.05, ay: 3 });
  // nails: two per board on studs every third of the tile
  const nails = [], studs = 3; for (let k = 0; k < bd.count; k++) for (let q = 0; q < studs; q++) { const x = (q + 0.5) * (n / studs) + rnd.range(-6, 6) * (n / 512); const bhh = n / bd.count; nails.push([x, k * bhh + bhh * 0.28 + rnd.range(-3, 3)]); nails.push([x, k * bhh + bhh * 0.72 + rnd.range(-3, 3)]); }
  const nailF = field(n), R0 = n * 0.006;
  for (const [cx, cy] of nails) for (let y = -R0 * 1.5; y <= R0 * 1.5; y++) for (let x = -R0 * 1.5; x <= R0 * 1.5; x++) { const d = Math.sqrt(x * x + y * y) / R0; if (d < 1.4) { const i = ((((cy + y) | 0) % n + n) % n) * n + ((((cx + x) | 0) % n + n) % n); nailF[i] = Math.max(nailF[i], smooth(1.1, 0.8, d)); } }
  const st = streaks(n, rnd, nails.length, { seed: s + 9, at: nails, len: [0.03, 0.12], width: [0.003, 0.006], source: false });
  const brown = P(0x6b4d33), grey = P(0x8a857b), silver = P(0xa39e93), greyD = P(0x55524b), green = P(0x5a6a42), soil = P(0x2a241e), nailC = P(0x2e2a26), rust = P(0x6e4426);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const k = bd.idx[i], bt = 0.85 + ihash(k, 51, s) * 0.3, ring = rings[i], fb = fibre[i] * 0.5 + 0.5;
    const w = clamp01(smooth(0.1, 0.6, weath[i] * 0.5 + 0.5) * (0.45 + wear * 0.6) * (0.6 + ihash(k, 52, s) * 0.6));
    const chk = smooth(0.93, 0.99, checks[i]) * (0.4 + wear * 0.6), gap = bd.gap[i];
    const al = smooth(0.55, 0.85, alg[i] * 0.5 + 0.5) * 0.45 * wear, nl = nailF[i], rs = clamp01(st[i]) * 0.6;
    let R = brown[0] * bt, G = brown[1] * bt, B = brown[2] * bt;
    const tone = 1 + (fb - 0.5) * 0.3 - ring * 0.25; R *= tone; G *= tone; B *= tone;
    const gc = ring > 0.5 ? greyD : (fb > 0.6 ? silver : grey); R = mix(R, gc[0], w * 0.9); G = mix(G, gc[1], w * 0.9); B = mix(B, gc[2], w * 0.9);
    R = mix(R, green[0], al); G = mix(G, green[1], al); B = mix(B, green[2], al);
    R = mix(R, rust[0], rs); G = mix(G, rust[1], rs); B = mix(B, rust[2], rs);
    const kk = km.m[i] * 0.8; R = mix(R, soil[0], kk); G = mix(G, soil[1], kk); B = mix(B, soil[2], kk);
    const dd = clamp01(gap + chk * 0.8 + smooth(4, 0, bd.ed[i]) * 0.4); R = mix(R, soil[0], dd); G = mix(G, soil[1], dd); B = mix(B, soil[2], dd);
    R = mix(R, nailC[0], nl); G = mix(G, nailC[1], nl); B = mix(B, nailC[2], nl);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = (ihash(k, 53, s) - 0.5) * 0.1 + ring * 0.05 * (1 + w * 2) + (fb - 0.5) * 0.02 - gap * 0.9 - chk * 0.25 - km.m[i] * 0.06 - smooth(3, 0, bd.ed[i]) * 0.12 - nl * 0.04;
    ro[i] = clamp01(0.8 + w * 0.15 + ring * 0.05 + al * 0.1 - nl * 0.3 + rs * 0.1);
  }
  return { r, g, b, h, rough: ro, aoK: 3.5 };
}

function genLog(n, p) {
  const s = p.seed * 7919 + 101, wear = p.wear;
  const logs = 2, lh = n / logs;
  const plates = worley(n, 10, 4, s + 1, 0.9), fis = fbm(n, { f: 8, oct: 3, seed: s + 2, ax: 0.3, ay: 2 });
  const weath = fbm(n, { f: 2, oct: 3, seed: s + 3 }), grain = fbm(n, { f: 50, oct: 2, seed: s + 4, ax: 0.2, ay: 3 });
  const moss = fbm(n, { f: 5, oct: 3, seed: s + 5 }), tow = fbm(n, { f: 30, oct: 2, seed: s + 6, ax: 0.1, ay: 3 });
  const bark = P(0x5c4030), barkD = P(0x3a2818), barkL = P(0x7a5a40), grey = P(0x8b867c), mossC = P(0x4b5540), towC = P(0x7a7250), crackC = P(0x1e1610);
  const chkV = []; for (let k = 0; k < logs; k++) chkV.push(0.3 + ihash(k, 61, s) * 0.4);
  const chkN = noise1(n, 8, s + 7, 0.02);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let y = 0; y < n; y++) {
    const k = Math.floor(y / lh), lv = (y - k * lh) / lh, prof = 2 * lv - 1;
    const round = Math.sqrt(Math.max(0, 1 - prof * prof));             // cylinder profile
    const joint = smooth(0.12, 0.0, lv) + smooth(0.88, 1, lv);          // between logs
    for (let x = 0; x < n; x++) {
      const i = y * n + x, u = x / n;
      const fl = plates.f2[i] - plates.f1[i], fissure = smooth(0.14, 0.03, fl + fis[i] * 0.08), pid = plates.id[i];
      const pt = ihash(pid, 1, s), w = clamp01(smooth(0.2, 0.7, weath[i] * 0.5 + 0.5) * (0.3 + wear * 0.8));
      const chk = smooth(0.012, 0.004, Math.abs(lv - chkV[k] - chkN[x])) * (0.5 + wear * 0.5);
      const ms = smooth(0.45, 0.8, moss[i] * 0.5 + 0.5) * joint * 0.9 + smooth(0.6, 0.85, moss[i] * 0.5 + 0.5) * smooth(0.35, 0.05, lv) * (k === 0 ? 0.6 : 0.25);
      const towT = joint * smooth(0.3, 0.8, tow[i] * 0.5 + 0.5);
      let R = mix(barkD[0], barkL[0], pt), G = mix(barkD[1], barkL[1], pt), B = mix(barkD[2], barkL[2], pt);
      const tone = 1 + grain[i] * 0.15 - fissure * 0.55; R *= tone; G *= tone; B *= tone;
      R = mix(R, grey[0], w * 0.75 * (1 - fissure)); G = mix(G, grey[1], w * 0.75 * (1 - fissure)); B = mix(B, grey[2], w * 0.75 * (1 - fissure));
      R = mix(R, towC[0], towT); G = mix(G, towC[1], towT); B = mix(B, towC[2], towT);
      R = mix(R, mossC[0], ms); G = mix(G, mossC[1], ms); B = mix(B, mossC[2], ms);
      R = mix(R, crackC[0], chk + joint * 0.5 * (1 - towT)); G = mix(G, crackC[1], chk + joint * 0.5 * (1 - towT)); B = mix(B, crackC[2], chk + joint * 0.5 * (1 - towT));
      r[i] = R; g[i] = G; b[i] = B;
      h[i] = round * 1.6 + pt * 0.08 + grain[i] * 0.03 - fissure * 0.18 - chk * 0.25 + towT * 0.05 + ms * 0.03;
      ro[i] = clamp01(0.86 + fissure * 0.08 + w * 0.06 + ms * 0.1 - pt * 0.05);
    }
  }
  return { r, g, b, h, rough: ro, aoR: n >> 6, aoK: 1.2 };
}

function genBirch(n, p) {
  const s = p.seed * 7919 + 113, wear = p.wear, rnd = seeded(s);
  const tone = fbm(n, { f: 2, oct: 3, seed: s + 1 }), stria = fbm(n, { f: 30, oct: 2, seed: s + 2, ax: 0.15, ay: 4 });
  const lich = fbm(n, { f: 6, oct: 3, seed: s + 3 }), fine = fbm(n, { f: 120, oct: 1, seed: s + 4 });
  const lent = drawLayer(n, (g) => { // lenticels: short horizontal dashes
    g.fillStyle = '#fff'; const cnt = 70 + Math.round(wear * 30);
    for (let k = 0; k < cnt; k++) { const x = rnd() * n, y = rnd() * n, w = n * rnd.range(0.015, 0.07), hh = Math.max(1.5, n * rnd.range(0.003, 0.006)); for (const ox of [-n, 0, n]) { g.beginPath(); g.roundRect(x + ox - w / 2, y - hh / 2, w, hh, hh / 2); g.fill(); } }
  });
  const peelL = drawLayer(n, (g) => { // peel strips: thin horizontal bands of lifted paper
    g.fillStyle = '#fff'; const cnt = 5 + Math.round(wear * 8);
    for (let k = 0; k < cnt; k++) { const x = rnd() * n, y = rnd() * n, w = n * rnd.range(0.12, 0.45), hh = n * rnd.range(0.006, 0.02); for (const ox of [-n, 0, n]) g.fillRect(x + ox - w / 2, y, w, hh); }
  });
  const scarL = drawLayer(n, (g) => { // dark chevron scars at old branch stubs
    g.fillStyle = '#fff'; const cnt = 1 + Math.round(wear * 3);
    for (let k = 0; k < cnt; k++) { const x = rnd() * n, y = rnd() * n, w = n * rnd.range(0.08, 0.2), hh = n * rnd.range(0.06, 0.16); for (const ox of [-n, 0, n]) { g.beginPath(); g.moveTo(x + ox - w / 2, y + hh * 0.3); g.quadraticCurveTo(x + ox, y - hh * 0.7, x + ox + w / 2, y + hh * 0.3); g.quadraticCurveTo(x + ox, y + hh * 0.1, x + ox - w / 2, y + hh * 0.3); g.fill(); } }
  });
  const scarE = blur(scarL, n, Math.max(1, n >> 7));
  const white = P(0xe8e4dc), cream = P(0xd6ccbc), pink = P(0xcaa88e), dark = P(0x221d1a), lichen = P(0x8a9078), greyB = P(0x9b968c);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const t = tone[i] * 0.5 + 0.5, le = smooth(0.3, 0.7, lent[i]), pe = smooth(0.3, 0.7, peelL[i]), sc = smooth(0.2, 0.6, scarE[i]) + smooth(0.5, 0.9, scarL[i]);
    const li = smooth(0.62, 0.85, lich[i] * 0.5 + 0.5) * 0.6, gr = smooth(0.7, 0.95, lich[i] * -0.5 + 0.5) * 0.5 * wear;
    let R = mix(white[0], cream[0], t), G = mix(white[1], cream[1], t), B = mix(white[2], cream[2], t);
    const tn = 1 + stria[i] * 0.05 + fine[i] * 0.03; R *= tn; G *= tn; B *= tn;
    R = mix(R, pink[0], pe); G = mix(G, pink[1], pe); B = mix(B, pink[2], pe);
    R = mix(R, greyB[0], gr); G = mix(G, greyB[1], gr); B = mix(B, greyB[2], gr);
    R = mix(R, lichen[0], li); G = mix(G, lichen[1], li); B = mix(B, lichen[2], li);
    const dk = clamp01(le + sc); R = mix(R, dark[0], dk); G = mix(G, dark[1], dk); B = mix(B, dark[2], dk);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = stria[i] * 0.03 + fine[i] * 0.01 + le * 0.05 + pe * 0.08 - smooth(0.5, 0.9, scarL[i]) * 0.1 + smooth(0.5, 0.9, scarL[i]) * fine[i] * 0.1;
    ro[i] = clamp01(0.6 + t * 0.1 + le * 0.25 + sc * 0.3 + pe * 0.1 + li * 0.2);
  }
  return { r, g, b, h, rough: ro, aoK: 2 };
}

function genPine(n, p) {
  const s = p.seed * 7919 + 127, wear = p.wear;
  const plates = worley(n, 7, 14, s + 1, 0.95), sub = worley(n, 18, 30, s + 2, 0.9);
  const fl = fbm(n, { f: 30, oct: 2, seed: s + 3, ax: 0.3, ay: 2 }), lich = fbm(n, { f: 4, oct: 3, seed: s + 4 }), warpN = fbm(n, { f: 6, oct: 2, seed: s + 5 });
  const top = P(0x6a4a34), topL = P(0x8a6446), inner = P(0xa0603a), deep = P(0x241812), lichen = P(0x7c8a6a), grey = P(0x6f6a60);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const d = plates.f2[i] - plates.f1[i] + warpN[i] * 0.1, fissure = smooth(0.2, 0.04, d), pid = plates.id[i], pt = ihash(pid, 1, s);
    const sd = sub.f2[i] - sub.f1[i], flake = smooth(0.12, 0.03, sd) * (1 - fissure), sh = ihash(sub.id[i], 2, s);
    const li = smooth(0.55, 0.85, lich[i] * 0.5 + 0.5) * (1 - fissure) * 0.7, exposed = smooth(0.85, 0.97, sh) * (1 - fissure) * (0.4 + wear * 0.6);
    let R = mix(top[0], topL[0], pt), G = mix(top[1], topL[1], pt), B = mix(top[2], topL[2], pt);
    const tone = 1 + fl[i] * 0.15 + sh * 0.12 - flake * 0.4; R *= tone; G *= tone; B *= tone;
    R = mix(R, inner[0], exposed); G = mix(G, inner[1], exposed); B = mix(B, inner[2], exposed);
    R = mix(R, grey[0], smooth(0.2, 0.6, lich[i] * -0.5 + 0.5) * 0.3 * wear); G = mix(G, grey[1], smooth(0.2, 0.6, lich[i] * -0.5 + 0.5) * 0.3 * wear); B = mix(B, grey[2], smooth(0.2, 0.6, lich[i] * -0.5 + 0.5) * 0.3 * wear);
    R = mix(R, lichen[0], li); G = mix(G, lichen[1], li); B = mix(B, lichen[2], li);
    R = mix(R, deep[0], fissure); G = mix(G, deep[1], fissure); B = mix(B, deep[2], fissure);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = 0.4 + pt * 0.25 + sh * 0.08 + fl[i] * 0.03 - fissure * 0.7 - flake * 0.12 - exposed * 0.08;
    ro[i] = clamp01(0.88 + fissure * 0.08 + li * 0.06 - exposed * 0.1);
  }
  return { r, g, b, h, rough: ro, aoK: 2.5, aoR: n >> 6 };
}

function genFabric(n, p) {
  const s = p.seed * 7919 + 131, wear = p.wear;
  const w = weave(n, Math.round(n / 5), s + 1), wr = fbm(n, { f: 2, oct: 3, seed: s + 2 }), stain = fbm(n, { f: 4, oct: 3, seed: s + 3 }), fadeN = fbm(n, { f: 1.5, oct: 2, seed: s + 4 });
  const col = p.color || P(0x5a5c3e), faded = [mix(col[0], 0.7, 0.35), mix(col[1], 0.68, 0.35), mix(col[2], 0.55, 0.35)], dirt = P(0x2e2a22);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const t = w[i], fd = smooth(0.2, 0.8, fadeN[i] * 0.5 + 0.5) * (0.3 + wear * 0.6), st = smooth(0.55, 0.85, stain[i] * 0.5 + 0.5) * 0.5 * wear;
    let R = mix(col[0], faded[0], fd), G = mix(col[1], faded[1], fd), B = mix(col[2], faded[2], fd);
    const tone = 0.8 + t * 0.35; R *= tone; G *= tone; B *= tone;
    R = mix(R, dirt[0], st); G = mix(G, dirt[1], st); B = mix(B, dirt[2], st);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = t * 0.08 + wr[i] * 0.15;
    ro[i] = clamp01(0.9 + t * 0.05 + st * 0.05);
  }
  return { r, g, b, h, rough: ro, ao: false };
}

function genLeather(n, p) {
  const s = p.seed * 7919 + 139, wear = p.wear;
  const peb = worley(n, 48, 48, s + 1), cre = fbm(n, { f: 3, oct: 4, seed: s + 2, mode: 1 }), cre2 = fbm(n, { f: 7, oct: 3, seed: s + 3, mode: 1, ax: 2, ay: 0.5 });
  const shade = fbm(n, { f: 2, oct: 3, seed: s + 4 }), fine = fbm(n, { f: 100, oct: 1, seed: s + 5 });
  const col = p.color || P(0x4a3020), light = P(0x7c5a3a), dark = P(0x24160e);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const dome = smooth(0.7, 0.2, peb.f1[i]) * (0.6 + ihash(peb.id[i], 1, s) * 0.4);
    const crease = Math.max(smooth(0.86, 0.97, cre[i]), smooth(0.9, 0.98, cre2[i]) * 0.7);
    const wornT = crease * (0.3 + wear * 0.7) + smooth(0.3, 0.8, shade[i] * 0.5 + 0.5) * 0.25 * wear;
    let R = col[0], G = col[1], B = col[2];
    const tone = 1 + (dome - 0.5) * 0.18 + fine[i] * 0.06 + shade[i] * 0.1; R *= tone; G *= tone; B *= tone;
    R = mix(R, light[0], wornT); G = mix(G, light[1], wornT); B = mix(B, light[2], wornT);
    R = mix(R, dark[0], smooth(0.2, 0.0, dome) * 0.2); G = mix(G, dark[1], smooth(0.2, 0.0, dome) * 0.2); B = mix(B, dark[2], smooth(0.2, 0.0, dome) * 0.2);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = dome * 0.12 + fine[i] * 0.01 - crease * 0.15;
    ro[i] = clamp01(0.58 + (1 - dome) * 0.12 - wornT * 0.25 + crease * 0.1);
  }
  return { r, g, b, h, rough: ro, ao: false };
}

function genRubber(n, p) {
  const s = p.seed * 7919 + 149, wear = p.wear;
  const grain = fbm(n, { f: 70, oct: 2, seed: s + 1 }), scuff = fbm(n, { f: 3, oct: 3, seed: s + 2 }), scr = fbm(n, { f: 9, oct: 3, seed: s + 3, mode: 1, ax: 1.5, ay: 0.4 }), sheen = fbm(n, { f: 2, oct: 2, seed: s + 4 });
  const col = p.color || P(0x1b1b1b), scuffC = P(0x3d3c39), dust = P(0x4a4740);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const sc = smooth(0.55, 0.9, scuff[i] * 0.5 + 0.5) * (0.3 + wear * 0.6), s2 = smooth(0.94, 0.99, scr[i]) * 0.6 * wear;
    let R = col[0] * (1 + grain[i] * 0.3), G = col[1] * (1 + grain[i] * 0.3), B = col[2] * (1 + grain[i] * 0.3);
    R = mix(R, scuffC[0], sc); G = mix(G, scuffC[1], sc); B = mix(B, scuffC[2], sc);
    R = mix(R, dust[0], s2); G = mix(G, dust[1], s2); B = mix(B, dust[2], s2);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = grain[i] * 0.03 - s2 * 0.02;
    ro[i] = clamp01(0.82 + grain[i] * 0.06 + sc * 0.1 - smooth(0.5, 0.9, sheen[i] * 0.5 + 0.5) * 0.3);
  }
  return { r, g, b, h, rough: ro, ao: false };
}

function genGravel(n, p) {
  const s = p.seed * 7919 + 151;
  const st = worley(n, 22, 22, s + 1), st2 = worley(n, 60, 60, s + 2), sand = fbm(n, { f: 60, oct: 2, seed: s + 3 }), damp = fbm(n, { f: 2, oct: 3, seed: s + 4 });
  const pal = [P(0x7a7873), P(0x6d5c4a), P(0x6a6a55), P(0x4e4c48), P(0x9a958c), P(0x8a7a6a), P(0x5f6166)];
  const sandC = P(0x5a5046), wet = P(0x2f2a24);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const id = st.id[i], sz = 0.35 + ihash(id, 1, s) * 0.3, d = st.f1[i] / sz, stone = smooth(1.0, 0.75, d), dome = stone * Math.sqrt(Math.max(0, 1 - d * d * 0.8));
    const id2 = st2.id[i], sz2 = 0.3 + ihash(id2, 1, s) * 0.3, d2 = st2.f1[i] / sz2, small = smooth(1.0, 0.7, d2) * (1 - stone) * (ihash(id2, 2, s) > 0.35 ? 1 : 0), dome2 = small * Math.sqrt(Math.max(0, 1 - d2 * d2 * 0.8));
    const c = pal[Math.floor(ihash(id, 2, s) * pal.length)], c2 = pal[Math.floor(ihash(id2, 3, s) * pal.length)];
    const t = 0.8 + ihash(id, 3, s) * 0.4, dm = smooth(0.4, 0.8, damp[i] * 0.5 + 0.5) * 0.5;
    let R = sandC[0] * (1 + sand[i] * 0.2), G = sandC[1] * (1 + sand[i] * 0.2), B = sandC[2] * (1 + sand[i] * 0.2);
    R = mix(R, c2[0], small * 0.9); G = mix(G, c2[1], small * 0.9); B = mix(B, c2[2], small * 0.9);
    R = mix(R, c[0] * t, stone); G = mix(G, c[1] * t, stone); B = mix(B, c[2] * t, stone);
    const shade = 1 + (dome - 0.5) * 0.25 * stone + (dome2 - 0.5) * 0.2 * small + sand[i] * 0.05; R *= shade; G *= shade; B *= shade;
    R = mix(R, wet[0], dm); G = mix(G, wet[1], dm); B = mix(B, wet[2], dm);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = dome * 0.45 + dome2 * 0.18 + sand[i] * 0.03;
    ro[i] = clamp01(0.95 - stone * 0.25 - small * 0.15 - dm * 0.25 + sand[i] * 0.03);
  }
  return { r, g, b, h, rough: ro, aoK: 2.2, aoR: n >> 6 };
}

function genMud(n, p) {
  const s = p.seed * 7919 + 157, wear = p.wear;
  const pl = worley(n, 7, 7, s + 1, 0.9), wn = fbm(n, { f: 8, oct: 3, seed: s + 2 }), pud = fbm(n, { f: 2, oct: 3, seed: s + 3 }), fine = fbm(n, { f: 50, oct: 2, seed: s + 4 }), sub = fbm(n, { f: 20, oct: 3, seed: s + 5, mode: 1 });
  const dry = P(0x5a4a38), dryL = P(0x74624c), crackC = P(0x211a12), wetC = P(0x2a2118), pudC = P(0x1f1a16);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let i = 0; i < n * n; i++) {
    const d = pl.f2[i] - pl.f1[i] + wn[i] * 0.08, crack = smooth(0.1, 0.02, d), curl = smooth(0.7, 0.12, d), pid = pl.id[i], pt = ihash(pid, 1, s);
    const water = smooth(0.42, 0.55, pud[i] * 0.5 + 0.5 + p.damp * 0.3), rim = smooth(0.32, 0.42, pud[i] * 0.5 + 0.5 + p.damp * 0.3) * (1 - water);
    const sc = smooth(0.9, 0.98, sub[i]) * 0.4 * (1 - water);
    let R = mix(dry[0], dryL[0], pt * 0.6 + curl * 0.3), G = mix(dry[1], dryL[1], pt * 0.6 + curl * 0.3), B = mix(dry[2], dryL[2], pt * 0.6 + curl * 0.3);
    const tone = 1 + fine[i] * 0.12; R *= tone; G *= tone; B *= tone;
    R = mix(R, crackC[0], (crack + sc) * (1 - water)); G = mix(G, crackC[1], (crack + sc) * (1 - water)); B = mix(B, crackC[2], (crack + sc) * (1 - water));
    R = mix(R, wetC[0], rim * 0.8); G = mix(G, wetC[1], rim * 0.8); B = mix(B, wetC[2], rim * 0.8);
    R = mix(R, pudC[0], water); G = mix(G, pudC[1], water); B = mix(B, pudC[2], water);
    r[i] = R; g[i] = G; b[i] = B;
    h[i] = mix(curl * 0.3 + pt * 0.05 + fine[i] * 0.03 - crack * 0.5 - sc * 0.08, -0.15 + fine[i] * 0.004, water);
    ro[i] = clamp01(mix(0.93 - curl * 0.05, 0.12, water) - rim * 0.45);
  }
  return { r, g, b, h, rough: ro, aoK: 2.5 };
}

function genRoad(n, p) {
  const s = p.seed * 7919 + 163;
  const base = fbm(n, { f: 3, oct: 4, seed: s + 1 }), fine = fbm(n, { f: 60, oct: 2, seed: s + 2 }), st = worley(n, 70, 70, s + 3), wob = noise1(n, 6, s + 4, 0.03), pud = fbm(n, { f: 3, oct: 3, seed: s + 5, ax: 0.5, ay: 2 });
  const stub = fbm(n, { f: 90, oct: 1, seed: s + 6, ax: 0.5, ay: 2 }), tread = fbm(n, { f: 40, oct: 2, seed: s + 7, ax: 2, ay: 0.3 });
  const dirt = P(0x5e5245), dirtL = P(0x7a6c5a), rutC = P(0x3d3429), grass = P(0x6a6a3a), stone = P(0x8a857a), pudC = P(0x221d18), wet = P(0x332b22);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let y = 0; y < n; y++) {
    const w = wob[y];
    for (let x = 0; x < n; x++) {
      const i = y * n + x, u = x / n;
      const d1 = (u - 0.27 - w) / 0.06, d2 = (u - 0.73 + w) / 0.06, rut = Math.max(Math.exp(-d1 * d1), Math.exp(-d2 * d2));
      const crown = smooth(0.15, 0.0, Math.abs(u - 0.5)) * 0.6, edge = smooth(0.12, 0.0, Math.min(u, 1 - u));
      const st1 = st.f1[i] < 0.3 && ihash(st.id[i], 1, s) > 0.65 ? smooth(0.3, 0.12, st.f1[i]) : 0;
      const water = smooth(0.35, 0.5, pud[i] * 0.5 + 0.5 + p.damp * 0.3) * smooth(0.4, 0.8, rut), rim = smooth(0.25, 0.35, pud[i] * 0.5 + 0.5 + p.damp * 0.3) * smooth(0.3, 0.7, rut) * (1 - water);
      const gr = smooth(0.55, 0.8, stub[i]) * (crown + edge * 0.6) * 0.8, tr = smooth(0.3, 0.7, tread[i]) * rut * 0.5;
      let R = mix(dirt[0], dirtL[0], base[i] * 0.5 + 0.5), G = mix(dirt[1], dirtL[1], base[i] * 0.5 + 0.5), B = mix(dirt[2], dirtL[2], base[i] * 0.5 + 0.5);
      const tone = 1 + fine[i] * 0.12; R *= tone; G *= tone; B *= tone;
      R = mix(R, rutC[0], rut * 0.55); G = mix(G, rutC[1], rut * 0.55); B = mix(B, rutC[2], rut * 0.55);
      R = mix(R, stone[0], st1 * (1 - rut)); G = mix(G, stone[1], st1 * (1 - rut)); B = mix(B, stone[2], st1 * (1 - rut));
      R = mix(R, grass[0], gr); G = mix(G, grass[1], gr); B = mix(B, grass[2], gr);
      R = mix(R, wet[0], rim); G = mix(G, wet[1], rim); B = mix(B, wet[2], rim);
      R = mix(R, pudC[0], water); G = mix(G, pudC[1], water); B = mix(B, pudC[2], water);
      r[i] = R; g[i] = G; b[i] = B;
      h[i] = mix(base[i] * 0.1 + fine[i] * 0.04 + crown * 0.1 - rut * 0.4 + tr * 0.06 + st1 * 0.12 * (1 - rut) + gr * 0.05, -0.4, water);
      ro[i] = clamp01(mix(0.92 - st1 * 0.2 + gr * 0.05, 0.12, water) - rim * 0.4);
    }
  }
  return { r, g, b, h, rough: ro, aoK: 2 };
}

function genTile(n, p) {
  const s = p.seed * 7919 + 167, wear = p.wear, rnd = seeded(s);
  const waves = 5, grime = fbm(n, { f: 4, oct: 3, seed: s + 1, ax: 3, ay: 0.4 }), moss = fbm(n, { f: 5, oct: 3, seed: s + 2 }), lich = fbm(n, { f: 40, oct: 2, seed: s + 3 }), fine = fbm(n, { f: 70, oct: 2, seed: s + 4 }), chipN = noise1(n, 14, s + 5, 0.02);
  const nailAt = []; for (let k = 0; k < waves; k += 2) nailAt.push([(k + 0.5) * (n / waves), n * 0.88]);
  const st = streaks(n, rnd, nailAt.length, { seed: s + 6, at: nailAt, len: [0.15, 0.4], width: [0.006, 0.01] });
  const grey = P(0x8c8984), crest = P(0xa19e98), trough = P(0x5d615a), mossC = P(0x56683a), lichC = P(0xb09a50), rust = P(0x7a4a2a), dark = P(0x2a2a28);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let y = 0; y < n; y++) {
    const v = y / n, lap = smooth(0.05, 0.0, v), lapShadow = smooth(0.1, 0.05, v) * 0.5;
    for (let x = 0; x < n; x++) {
      const i = y * n + x, u = x / n, ph = Math.sin(u * waves * 6.2831853), wv = ph * 0.5 + 0.5;
      const chip = smooth(0.03 + chipN[x], 0.0, v) * (ihash(Math.floor(u * 40), 3, s) > 0.55 ? 1 : 0) * wear;
      const gr = smooth(0.3, 0.8, grime[i] * 0.5 + 0.5) * (1 - wv) * 0.6, ms = smooth(0.5, 0.85, moss[i] * 0.5 + 0.5) * (1 - wv * 0.7) * (0.3 + wear * 0.7);
      const li = smooth(0.7, 0.9, lich[i]) * 0.5, rs = clamp01(st[i]) * 0.8;
      let R = mix(trough[0], crest[0], wv), G = mix(trough[1], crest[1], wv), B = mix(trough[2], crest[2], wv);
      R = mix(R, grey[0], 0.5); G = mix(G, grey[1], 0.5); B = mix(B, grey[2], 0.5);
      const tone = 1 + fine[i] * 0.1 - lapShadow * 0.4; R *= tone; G *= tone; B *= tone;
      R = mix(R, dark[0], gr); G = mix(G, dark[1], gr); B = mix(B, dark[2], gr);
      R = mix(R, mossC[0], ms); G = mix(G, mossC[1], ms); B = mix(B, mossC[2], ms);
      R = mix(R, lichC[0], li); G = mix(G, lichC[1], li); B = mix(B, lichC[2], li);
      R = mix(R, rust[0], rs); G = mix(G, rust[1], rs); B = mix(B, rust[2], rs);
      R = mix(R, dark[0], chip); G = mix(G, dark[1], chip); B = mix(B, dark[2], chip);
      r[i] = R; g[i] = G; b[i] = B;
      h[i] = ph * 0.45 + lap * 0.25 + fine[i] * 0.02 + ms * 0.04 - chip * 0.5;
      ro[i] = clamp01(0.82 + gr * 0.1 + ms * 0.15 + fine[i] * 0.04 - wv * 0.05);
    }
  }
  return { r, g, b, h, rough: ro, aoK: 1.5, aoR: n >> 6 };
}

function genGlass(n, p) {
  const s = p.seed * 7919 + 173, wear = p.wear, rnd = seeded(s);
  const film = fbm(n, { f: 2, oct: 4, seed: s + 1 }), wave = fbm(n, { f: 2, oct: 2, seed: s + 2 }), dust = fbm(n, { f: 40, oct: 2, seed: s + 3 });
  const drips = streaks(n, rnd, 6 + Math.round(wear * 10), { seed: s + 4, len: [0.2, 0.9], width: [0.002, 0.005], source: false });
  const smear = fbm(n, { f: 3, oct: 3, seed: s + 5, ax: 2, ay: 0.5 });
  const tint = P(0x9aa094), grimeC = P(0x6b6a5c);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n), a = field(n);
  for (let i = 0; i < n * n; i++) {
    const f = smooth(0.2, 0.9, film[i] * 0.5 + 0.5) * (0.4 + wear * 0.6), dr = clamp01(drips[i]) * 0.6, sm = smooth(0.4, 0.8, smear[i] * 0.5 + 0.5) * 0.3;
    const grime = clamp01(f + sm - dr + dust[i] * 0.08);
    r[i] = mix(tint[0], grimeC[0], grime); g[i] = mix(tint[1], grimeC[1], grime); b[i] = mix(tint[2], grimeC[2], grime);
    a[i] = clamp01(0.3 + grime * 0.5);
    h[i] = wave[i] * 0.04 + dr * 0.01 + dust[i] * 0.003;
    ro[i] = clamp01(0.06 + grime * 0.6);
  }
  return { r, g, b, h, rough: ro, alpha: a, ao: false };
}

function genTarp(n, p) {
  const s = p.seed * 7919 + 179, wear = p.wear;
  const w = weave(n, Math.round(n / 7), s + 1, 0.2), fold = fbm(n, { f: 2, oct: 3, seed: s + 2 }), fadeN = fbm(n, { f: 1.5, oct: 3, seed: s + 3, ax: 0.5, ay: 2 });
  const mild = worley(n, 30, 30, s + 4), holes = worley(n, 5, 5, s + 5), holeN = fbm(n, { f: 18, oct: 3, seed: s + 6 }), slash = fbm(n, { f: 3, oct: 3, seed: s + 7, mode: 1, ax: 0.3, ay: 1.5 }), fray = fbm(n, { f: 80, oct: 1, seed: s + 8 });
  const col = p.color || P(0x6a6444), faded = P(0x8f8a70), mildC = P(0x2e2d26), dirt = P(0x3e3a2c);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n), a = field(n);
  for (let i = 0; i < n * n; i++) {
    const t = w[i], fd = smooth(0.2, 0.8, fadeN[i] * 0.5 + 0.5) * (0.4 + wear * 0.5), mi = mild.f1[i] < 0.25 && ihash(mild.id[i], 1, s) > 0.6 ? smooth(0.25, 0.1, mild.f1[i]) * 0.7 : 0;
    const hid = holes.id[i], hr = ihash(hid, 2, s) < 0.12 + wear * 0.3 ? 0.12 + ihash(hid, 3, s) * 0.25 : 0;
    const hd = holes.f1[i] + holeN[i] * 0.12, hole = hr ? smooth(hr, hr * 0.85, hd) : 0, rim = hr ? smooth(hr * 1.25, hr, hd) * (1 - hole) : 0;
    const sl = smooth(0.965, 0.995, slash[i]) * wear;
    const alpha = clamp01(1 - hole - sl - rim * smooth(0.3, 0.7, fray[i] * 0.5 + 0.5));
    let R = mix(col[0], faded[0], fd), G = mix(col[1], faded[1], fd), B = mix(col[2], faded[2], fd);
    const tone = 0.82 + t * 0.3; R *= tone; G *= tone; B *= tone;
    R = mix(R, mildC[0], mi); G = mix(G, mildC[1], mi); B = mix(B, mildC[2], mi);
    R = mix(R, dirt[0], rim * 0.6 + smooth(0.6, 0.9, fold[i] * 0.5 + 0.5) * 0.3); G = mix(G, dirt[1], rim * 0.6 + smooth(0.6, 0.9, fold[i] * 0.5 + 0.5) * 0.3); B = mix(B, dirt[2], rim * 0.6 + smooth(0.6, 0.9, fold[i] * 0.5 + 0.5) * 0.3);
    r[i] = R; g[i] = G; b[i] = B; a[i] = alpha;
    h[i] = t * 0.06 + fold[i] * 0.3 + rim * 0.05;
    ro[i] = clamp01(0.9 + t * 0.05 + mi * 0.05);
  }
  return { r, g, b, h, rough: ro, alpha: a, ao: false };
}

function genCardboard(n, p) {
  const s = p.seed * 7919 + 181, wear = p.wear;
  const fibre = fbm(n, { f: 30, oct: 3, seed: s + 1, ax: 0.4, ay: 2.5 }), stain = worley(n, 3, 3, s + 2, 1), stainN = fbm(n, { f: 12, oct: 2, seed: s + 3 }), scuff = fbm(n, { f: 4, oct: 3, seed: s + 4 });
  const col = p.color || P(0xa4835a), colD = P(0x7a5a38), tide = P(0x6a4a2c), fuzz = P(0xc0a480);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let y = 0; y < n; y++) {
    const v = y / n, flute = Math.sin(v * 6.2831853 * 60) * 0.5 + 0.5, crease = smooth(0.012, 0.0, Math.abs(v - 0.5));
    for (let x = 0; x < n; x++) {
      const i = y * n + x, sid = stain.id[i], sr = ihash(sid, 1, s) > 0.4 ? 0.3 + ihash(sid, 2, s) * 0.35 : 0, sd = stain.f1[i] + stainN[i] * 0.06;
      const ring = sr ? smooth(sr - 0.05, sr - 0.01, sd) * smooth(sr + 0.02, sr, sd) : 0, inside = sr ? smooth(sr, sr * 0.7, sd) * 0.35 : 0;
      const sc = smooth(0.55, 0.9, scuff[i] * 0.5 + 0.5) * 0.35 * wear;
      let R = col[0], G = col[1], B = col[2];
      const tone = 1 + fibre[i] * 0.1 + (flute - 0.5) * 0.05; R *= tone; G *= tone; B *= tone;
      R = mix(R, colD[0], inside * wear + ring * 0.3); G = mix(G, colD[1], inside * wear + ring * 0.3); B = mix(B, colD[2], inside * wear + ring * 0.3);
      R = mix(R, tide[0], ring * 0.7 * wear); G = mix(G, tide[1], ring * 0.7 * wear); B = mix(B, tide[2], ring * 0.7 * wear);
      R = mix(R, fuzz[0], sc + crease * 0.4); G = mix(G, fuzz[1], sc + crease * 0.4); B = mix(B, fuzz[2], sc + crease * 0.4);
      r[i] = R; g[i] = G; b[i] = B;
      h[i] = flute * 0.03 + fibre[i] * 0.02 - crease * 0.08 + ring * 0.01;
      ro[i] = clamp01(0.94 + fibre[i] * 0.03 + sc * 0.03);
    }
  }
  return { r, g, b, h, rough: ro, ao: false };
}

function genPaper(n, p) {
  const s = p.seed * 7919 + 191, wear = p.wear;
  const fibre = fbm(n, { f: 50, oct: 2, seed: s + 1 }), yel = fbm(n, { f: 1.5, oct: 3, seed: s + 2 }), fox = worley(n, 14, 14, s + 3), foxN = fbm(n, { f: 30, oct: 2, seed: s + 4 });
  const col = p.color || P(0xd9d3c4), yellow = P(0xc4b48c), foxC = P(0x9a7a4c), foxD = P(0x6e5030);
  const [r, g, b] = rgbFields(n), h = field(n), ro = field(n);
  for (let y = 0; y < n; y++) {
    const v = y / n, cv = smooth(0.008, 0.0, Math.abs(v - 0.5));
    for (let x = 0; x < n; x++) {
      const i = y * n + x, u = x / n, cu = smooth(0.008, 0.0, Math.abs(u - 0.5)), crease = Math.max(cu, cv);
      const fid = fox.id[i], fr = ihash(fid, 1, s) < 0.18 + wear * 0.35 ? 0.1 + ihash(fid, 2, s) * 0.3 : 0, fd = fox.f1[i] + foxN[i] * 0.08;
      const spot = fr ? smooth(fr, fr * 0.5, fd) : 0, spotRim = fr ? smooth(fr * 1.1, fr * 0.9, fd) * (1 - spot) : 0;
      const ye = smooth(0.2, 0.8, yel[i] * 0.5 + 0.5) * (0.2 + wear * 0.5);
      let R = mix(col[0], yellow[0], ye), G = mix(col[1], yellow[1], ye), B = mix(col[2], yellow[2], ye);
      const tone = 1 + fibre[i] * 0.04 - crease * 0.08; R *= tone; G *= tone; B *= tone;
      R = mix(R, foxC[0], spot * 0.55); G = mix(G, foxC[1], spot * 0.55); B = mix(B, foxC[2], spot * 0.55);
      R = mix(R, foxD[0], spotRim * 0.5); G = mix(G, foxD[1], spotRim * 0.5); B = mix(B, foxD[2], spotRim * 0.5);
      r[i] = R; g[i] = G; b[i] = B;
      h[i] = fibre[i] * 0.01 + crease * 0.06 * ((u + v) > 1 ? 1 : -1) + spot * 0.005;
      ro[i] = clamp01(0.85 + fibre[i] * 0.03 + spot * 0.08 + ye * 0.03);
    }
  }
  return { r, g, b, h, rough: ro, ao: false };
}

// terrain detail: pebbles, cracks, dead-grass stubble (normal + roughness only)
function genTerrainDetail(n, p) {
  const s = 977;
  const peb = worley(n, 36, 36, s + 1), crk = fbm(n, { f: 5, oct: 4, seed: s + 2, mode: 1 }), stub = fbm(n, { f: 90, oct: 2, seed: s + 3, ax: 0.35, ay: 3 }), soil = fbm(n, { f: 20, oct: 3, seed: s + 4 });
  const h = field(n), ro = field(n), one = field(n, 0.5);
  for (let i = 0; i < n * n; i++) {
    const id = peb.id[i], sz = ihash(id, 1, s) > 0.6 ? 0.2 + ihash(id, 2, s) * 0.25 : 0, d = sz ? peb.f1[i] / sz : 9, stone = sz ? smooth(1, 0.8, d) * Math.sqrt(Math.max(0, 1 - d * d)) : 0;
    const crack = smooth(0.93, 0.985, crk[i]) * 0.5, st = smooth(0.5, 0.9, stub[i]);
    h[i] = stone * 0.5 + soil[i] * 0.08 + st * 0.06 - crack * 0.3;
    ro[i] = clamp01(0.95 - stone * 0.3 + st * 0.05 + crack * 0.03);
  }
  return { r: one, g: one, b: one, h, rough: ro, ao: false };
}

const KINDS = {
  concrete: { res: 'big', scale: 2, bump: 14, gen: genConcrete },
  plaster: { res: 'std', scale: 1.5, bump: 10, bakes: true, gen: genPlaster },
  brick: { res: 'std', scale: 1, bump: 12, gen: genBrick },
  rust: { res: 'std', scale: 1, bump: 10, gen: genRust, env: 0.55 },
  paintedmetal: { res: 'std', scale: 1, bump: 8, bakes: true, gen: genPaintedMetal, env: 0.6 },
  steel: { res: 'small', scale: 0.5, bump: 4, gen: genSteel, env: 0.8 },
  gunmetal: { res: 'std', scale: 0.25, bump: 5, gen: genGunmetal, env: 0.8 },
  bakelite: { res: 'small', scale: 0.25, bump: 3, gen: genBakelite, env: 0.5 },
  wood: { res: 'big', scale: 2, bump: 10, gen: genWood },
  planks: { res: 'std', scale: 1.5, bump: 12, gen: genPlanks },
  log: { res: 'std', scale: 0.5, bump: 8, gen: genLog },
  birchbark: { res: 'std', scale: 0.5, bump: 6, gen: genBirch },
  pinebark: { res: 'std', scale: 0.5, bump: 12, gen: genPine },
  fabric: { res: 'small', scale: 0.25, bump: 5, bakes: true, gen: genFabric, side: DS },
  leather: { res: 'small', scale: 0.25, bump: 5, bakes: true, gen: genLeather, env: 0.4 },
  rubber: { res: 'small', scale: 0.25, bump: 4, bakes: true, gen: genRubber, env: 0.3 },
  gravel: { res: 'std', scale: 1, bump: 14, gen: genGravel },
  mud: { res: 'std', scale: 1.5, bump: 12, gen: genMud, env: 0.5 },
  road: { res: 'std', scale: 3, bump: 10, gen: genRoad, env: 0.4 },
  tile: { res: 'std', scale: 1, bump: 12, gen: genTile },
  glass: { res: 'small', scale: 1, bump: 2, gen: genGlass, env: 0.9, transparent: true, side: DS, depthWrite: false },
  tarp: { res: 'std', scale: 1, bump: 5, bakes: true, gen: genTarp, alphaTest: 0.5, side: DS },
  cardboard: { res: 'small', scale: 0.5, bump: 4, bakes: true, gen: genCardboard },
  paper: { res: 'small', scale: 0.5, bump: 2, bakes: true, gen: genPaper },
};
const ALIAS = { canvas: 'fabric', metal: 'paintedmetal', asbestos: 'tile', slate: 'tile', roof: 'tile', dirt: 'road', bark: 'pinebark', birch: 'birchbark', stone: 'concrete', iron: 'rust', poster: 'paper' };
const CARD_KINDS = ['grass', 'reed', 'leaf', 'twig', 'cattail'];

// ---------------------------------------------------------------------------------------------
// Cards (alpha-tested billboards) and decals: drawn on canvases, CanvasTexture (flipY: tip at v = 1)
// ---------------------------------------------------------------------------------------------
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function css(c, m = 1) { return `rgb(${Math.round(clamp01(c[0] * m) * 255)},${Math.round(clamp01(c[1] * m) * 255)},${Math.round(clamp01(c[2] * m) * 255)})`; }
// tangent-space normal for a card from its alpha silhouette (rounded across the width) + drawn relief
function cardNormal(c, g, curl = 0.7) {
  const w = c.width, h = c.height, src = g.getImageData(0, 0, w, h).data;
  const [nc, ng] = makeCanvas(w, h), img = ng.createImageData(w, h), d = img.data;
  // per row: find the silhouette span and tilt the normal toward the edges (a blade is a shallow trough)
  for (let y = 0; y < h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (src[(y * w + x) * 4 + 3] > 40) { if (x0 < 0) x0 = x; x1 = x; }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; let nx = 0, ny = 0;
      if (x0 >= 0 && x1 > x0) { const t = ((x - x0) / (x1 - x0)) * 2 - 1; nx = -t * curl; }
      const lum = (p) => (p >= 0 && p < src.length ? (src[p] + src[p + 1] + src[p + 2]) / 765 : 0);
      const gx = lum(((y * w + Math.min(w - 1, x + 1)) * 4)) - lum(((y * w + Math.max(0, x - 1)) * 4)), gy = lum(((Math.min(h - 1, y + 1) * w + x) * 4)) - lum(((Math.max(0, y - 1) * w + x) * 4));
      nx -= gx * 1.5; ny += gy * 1.5;   // canvas y is down; +green = up
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      d[o] = (nx * il * 0.5 + 0.5) * 255; d[o + 1] = (ny * il * 0.5 + 0.5) * 255; d[o + 2] = (il * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  ng.putImageData(img, 0, 0); return nc;
}
function drawGrass(g, w, h, rnd) {
  const base = P(0x4e4f2a), mid = P(0x8c8a44), tip = P(0xb3a865), vein = P(0x6a6a33);
  const cx = w / 2, bend = (rnd() - 0.5) * w * 0.9, hw = w * 0.16;
  const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, css(base)); gr.addColorStop(0.55, css(mid)); gr.addColorStop(1, css(tip));
  g.fillStyle = gr; g.beginPath(); g.moveTo(cx - hw, h); g.quadraticCurveTo(cx - hw * 0.5 + bend * 0.3, h * 0.45, cx + bend, 0); g.quadraticCurveTo(cx + hw * 0.5 + bend * 0.3, h * 0.45, cx + hw, h); g.closePath(); g.fill();
  g.strokeStyle = css(vein); g.lineWidth = Math.max(1, w * 0.03); g.beginPath(); g.moveTo(cx, h); g.quadraticCurveTo(cx + bend * 0.3, h * 0.45, cx + bend, h * 0.05); g.stroke();
  g.fillStyle = 'rgba(60,50,20,0.35)'; for (let k = 0; k < 14; k++) { const y = h * (0.2 + rnd() * 0.8), x = cx + bend * (1 - y / h) + (rnd() - 0.5) * hw * 1.6; g.fillRect(x, y, 1.5, 3 + rnd() * 5); }
}
function drawReed(g, w, h, rnd, cattail) {
  const stem = P(0x8e8452), stemD = P(0x5c5430), head = P(0x3d2a1a), plume = P(0x9c8c62), plumeD = P(0x6e6242);
  const cx = w / 2, sw = Math.max(2, w * 0.06);
  g.strokeStyle = css(stem); g.lineWidth = sw; g.beginPath(); g.moveTo(cx, h); g.quadraticCurveTo(cx + (rnd() - 0.5) * w * 0.4, h * 0.5, cx + (rnd() - 0.5) * w * 0.3, h * 0.12); g.stroke();
  g.strokeStyle = css(stemD); g.lineWidth = sw * 0.4; g.beginPath(); g.moveTo(cx - sw * 0.3, h); g.lineTo(cx - sw * 0.3, h * 0.3); g.stroke();
  // a couple of long leaves
  g.strokeStyle = css(stemD); g.lineWidth = sw * 0.8; for (let k = 0; k < 2; k++) { const y0 = h * (0.55 + rnd() * 0.3), dir = k ? 1 : -1; g.beginPath(); g.moveTo(cx, y0); g.quadraticCurveTo(cx + dir * w * 0.25, y0 - h * 0.15, cx + dir * w * 0.42, y0 - h * 0.35); g.stroke(); }
  if (cattail) { g.fillStyle = css(head); g.beginPath(); g.roundRect(cx - w * 0.11, h * 0.1, w * 0.22, h * 0.24, w * 0.1); g.fill(); g.strokeStyle = css(stem); g.lineWidth = sw * 0.5; g.beginPath(); g.moveTo(cx, h * 0.1); g.lineTo(cx, 0.02 * h); g.stroke(); g.fillStyle = 'rgba(20,12,6,0.35)'; g.fillRect(cx - w * 0.11, h * 0.2, w * 0.05, h * 0.14); }
  else { g.lineWidth = 1; for (let k = 0; k < 42; k++) { const t = rnd(), y = h * (0.02 + t * 0.2), x = cx + (rnd() - 0.5) * w * 0.05; g.strokeStyle = css(rnd() > 0.5 ? plume : plumeD); g.beginPath(); g.moveTo(x, h * 0.2); g.quadraticCurveTo(x + (rnd() - 0.5) * w * 0.5, y + h * 0.05, x + (rnd() - 0.5) * w * 0.8, y); g.stroke(); } }
}
function drawLeaf(g, w, h, rnd) {
  const c1 = P(0x7a5a30), c2 = P(0x5c3e1e), vein = P(0x46301a), spot = P(0x3a2612);
  const cx = w / 2, top = h * 0.04, bot = h * 0.96;
  g.fillStyle = css(c1); g.beginPath(); g.moveTo(cx, top);
  const pts = 9; for (let k = 1; k <= pts; k++) { const t = k / (pts + 1), y = top + (bot - top) * t, r = Math.sin(t * Math.PI) ** 0.8 * w * 0.42; g.lineTo(cx + r * (1 - (k & 1) * 0.12), y); }
  g.lineTo(cx, bot); for (let k = pts; k >= 1; k--) { const t = k / (pts + 1), y = top + (bot - top) * t, r = Math.sin(t * Math.PI) ** 0.8 * w * 0.42; g.lineTo(cx - r * (1 - (k & 1) * 0.12), y); }
  g.closePath(); g.fill();
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, css(c2)); g.globalAlpha = 0.5; g.fillStyle = gr; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = css(vein); g.lineWidth = Math.max(1, w * 0.02); g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, bot); g.stroke();
  g.lineWidth = Math.max(0.8, w * 0.012); for (let k = 1; k < 7; k++) { const y = top + (bot - top) * (k / 7.5); g.beginPath(); g.moveTo(cx, y); g.lineTo(cx + w * 0.34, y - h * 0.09); g.moveTo(cx, y); g.lineTo(cx - w * 0.34, y - h * 0.09); g.stroke(); }
  g.fillStyle = css(spot); for (let k = 0; k < 6; k++) { g.globalAlpha = 0.35; g.beginPath(); g.arc(cx + (rnd() - 0.5) * w * 0.5, top + rnd() * (bot - top), 2 + rnd() * 5, 0, 6.3); g.fill(); } g.globalAlpha = 1;
}
function drawTwig(g, w, h, rnd) {
  const bark = P(0x2c2622), barkL = P(0x4a3e34), leaf = P(0xb09a50), leafD = P(0x8a7038), catkin = P(0x6a5636);
  const branch = (x, y, ang, len, wd, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.strokeStyle = css(depth > 1 ? bark : barkL); g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + (rnd() - 0.5) * len * 0.3, (y + y2) / 2 + (rnd() - 0.5) * len * 0.3, x2, y2); g.stroke();
    if (depth < 4) { const nb = 2 + (rnd() > 0.5 ? 1 : 0); for (let k = 0; k < nb; k++) branch(x2, y2, ang + (rnd() - 0.5) * 1.4, len * (0.5 + rnd() * 0.3), wd * 0.6, depth + 1); }
    else { // dead leaves and catkins at the tips
      if (rnd() > 0.35) { g.fillStyle = css(rnd() > 0.5 ? leaf : leafD); g.beginPath(); g.ellipse(x2, y2, w * 0.03, w * 0.02, ang, 0, 6.3); g.fill(); }
      else { g.strokeStyle = css(catkin); g.lineWidth = wd * 1.4; g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 + (rnd() - 0.5) * w * 0.02, y2 + h * 0.07); g.stroke(); }
    }
  };
  branch(w / 2, h, -Math.PI / 2 + (rnd() - 0.5) * 0.3, h * 0.32, Math.max(2, w * 0.02), 0);
}
function makeCard(kind, variant) {
  const rnd = seeded(kind.length * 31 + variant * 7 + 5);
  const tall = kind !== 'leaf' && kind !== 'twig';
  const w = tall ? 64 : (kind === 'leaf' ? 128 : 256), h = tall ? 256 : (kind === 'leaf' ? 128 : 256);
  const [c, g] = makeCanvas(w, h);
  if (kind === 'grass') drawGrass(g, w, h, rnd); else if (kind === 'reed') drawReed(g, w, h, rnd, false); else if (kind === 'cattail') drawReed(g, w, h, rnd, true); else if (kind === 'leaf') drawLeaf(g, w, h, rnd); else drawTwig(g, w, h, rnd);
  const map = canvasTexture(c, { srgb: true, wrap: false }); map.premultiplyAlpha = false;
  const normalMap = canvasTexture(cardNormal(c, g, kind === 'grass' ? 0.8 : 0.4), { wrap: false });
  return { map, normalMap };
}
function makeDecal(kind) {
  const rnd = seeded(kind.length * 17 + 3), big = kind === 'scorch' || kind === 'ash', n = big ? 256 : 128;
  const [c, g] = makeCanvas(n, n), cx = n / 2, cy = n / 2;
  if (kind === 'scorch' || kind === 'ash') {
    const soot = kind === 'scorch';
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, n * 0.5);
    if (soot) { rg.addColorStop(0, 'rgba(12,10,9,0.95)'); rg.addColorStop(0.35, 'rgba(18,15,13,0.85)'); rg.addColorStop(0.7, 'rgba(25,22,20,0.4)'); rg.addColorStop(1, 'rgba(30,28,26,0)'); }
    else { rg.addColorStop(0, 'rgba(158,152,146,0.95)'); rg.addColorStop(0.4, 'rgba(140,134,128,0.8)'); rg.addColorStop(0.8, 'rgba(120,115,110,0.25)'); rg.addColorStop(1, 'rgba(110,105,100,0)'); }
    g.fillStyle = rg; g.beginPath();
    for (let k = 0; k <= 64; k++) { const a = (k / 64) * 6.2831853, rr = n * 0.48 * (0.75 + 0.25 * Math.sin(a * 3 + rnd() * 6) * Math.cos(a * 5 + 1)); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fill();
    for (let k = 0; k < 220; k++) { const a = rnd() * 6.2831853, d = Math.sqrt(rnd()) * n * 0.42; g.fillStyle = soot ? `rgba(${40 + rnd() * 40 | 0},${34 + rnd() * 30 | 0},${28 + rnd() * 20 | 0},${0.25 + rnd() * 0.35})` : `rgba(${20 + rnd() * 40 | 0},${18 + rnd() * 30 | 0},${16 + rnd() * 20 | 0},${0.3 + rnd() * 0.5})`; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * 2.5, 1 + rnd() * 2.5); }
  } else {
    const wood = kind === 'bullet_wood', metal = kind === 'bullet_metal';
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, n * 0.5);
    rg.addColorStop(0, 'rgba(8,7,6,1)'); rg.addColorStop(metal ? 0.16 : 0.22, wood ? 'rgba(30,20,12,0.95)' : 'rgba(20,19,18,0.95)'); rg.addColorStop(0.45, wood ? 'rgba(70,50,30,0.5)' : metal ? 'rgba(40,40,40,0.35)' : 'rgba(70,68,64,0.55)'); rg.addColorStop(1, 'rgba(60,58,55,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, n * 0.5, 0, 6.3); g.fill();
    if (wood) { g.lineCap = 'round'; for (let k = 0; k < 26; k++) { const a = (rnd() - 0.5) * 1.1 + (rnd() > 0.5 ? 0 : Math.PI), len = n * (0.15 + rnd() * 0.3), wd = 1 + rnd() * 3; g.strokeStyle = rnd() > 0.4 ? `rgba(${150 + rnd() * 40 | 0},${110 + rnd() * 30 | 0},${60 + rnd() * 20 | 0},${0.6 + rnd() * 0.4})` : 'rgba(35,24,14,0.9)'; g.lineWidth = wd; g.beginPath(); g.moveTo(cx + Math.cos(a) * n * 0.06, cy + Math.sin(a) * n * 0.06); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke(); } }
    else if (metal) { for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.2831853 + rnd() * 0.5; g.fillStyle = `rgba(${150 + rnd() * 60 | 0},${150 + rnd() * 60 | 0},${150 + rnd() * 50 | 0},0.9)`; g.beginPath(); g.moveTo(cx + Math.cos(a) * n * 0.1, cy + Math.sin(a) * n * 0.1); g.lineTo(cx + Math.cos(a + 0.5) * n * (0.16 + rnd() * 0.08), cy + Math.sin(a + 0.5) * n * (0.16 + rnd() * 0.08)); g.lineTo(cx + Math.cos(a + 0.9) * n * 0.11, cy + Math.sin(a + 0.9) * n * 0.11); g.closePath(); g.fill(); } g.fillStyle = 'rgba(5,5,5,1)'; g.beginPath(); g.arc(cx, cy, n * 0.09, 0, 6.3); g.fill(); }
    else { g.lineCap = 'round'; for (let k = 0; k < 5; k++) { const a = rnd() * 6.2831853, len = n * (0.2 + rnd() * 0.28); g.strokeStyle = 'rgba(25,24,22,0.85)'; g.lineWidth = 1 + rnd() * 1.5; g.beginPath(); g.moveTo(cx, cy); let x = cx, y = cy; for (let q = 0; q < 5; q++) { x += Math.cos(a + (rnd() - 0.5) * 0.8) * len / 5; y += Math.sin(a + (rnd() - 0.5) * 0.8) * len / 5; g.lineTo(x, y); } g.stroke(); } for (let k = 0; k < 40; k++) { const a = rnd() * 6.2831853, d = n * (0.12 + rnd() * 0.2); g.fillStyle = `rgba(${130 + rnd() * 40 | 0},${126 + rnd() * 36 | 0},${118 + rnd() * 30 | 0},${0.5 + rnd() * 0.5})`; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + rnd() * 3, 1 + rnd() * 3); } }
  }
  const tex = canvasTexture(c, { srgb: true, wrap: false }); return tex;
}

// ---------------------------------------------------------------------------------------------
// Environment map for reflections (metals, glass, wet ground): a small overcast equirect through PMREM.
// Intensity follows the day cycle in update().
// ---------------------------------------------------------------------------------------------
function makeEnvMap(ctx) {
  try {
    const [c, g] = makeCanvas(256, 128);
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#6f7880'); gr.addColorStop(0.42, '#a9aeb0'); gr.addColorStop(0.5, '#b5b6b0'); gr.addColorStop(0.53, '#4a4d44'); gr.addColorStop(1, '#2a2c26');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    const sun = g.createRadialGradient(64, 40, 0, 64, 40, 40); sun.addColorStop(0, 'rgba(235,228,215,0.55)'); sun.addColorStop(1, 'rgba(235,228,215,0)'); g.fillStyle = sun; g.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(ctx.renderer); const rt = pm.fromEquirectangular(tex); pm.dispose(); tex.dispose();
    rt.texture.userData.bytes = 1.5 * 1024 * 1024;
    return rt.texture;
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------------------------
export function createMaterials(ctx) {
  const texCache = new Map(), matCache = new Map(), repeatCache = new Map(), cardCache = new Map(), decalCache = new Map();
  const genLog = {}; let bytes = 0, genMs = 0, warned = false, envMap = undefined, detail = null;
  const metalMats = [], envMats = [];
  const quality = () => ctx.renderApi?.quality || ctx.quality || 'high';
  const aniso = () => Math.min(4, ctx.renderer?.capabilities?.getMaxAnisotropy?.() || 4);
  const track = (tex) => { if (tex && tex.userData.bytes) bytes += tex.userData.bytes; return tex; };
  const resolveKind = (k) => (KINDS[k] ? k : ALIAS[k] && KINDS[ALIAS[k]] ? ALIAS[k] : null);
  const toHex = (c) => (c == null ? null : c.isColor ? c.getHex() : typeof c === 'string' ? new THREE.Color(c).getHex() : c | 0);

  function texParams(kind, params) {
    const spec = KINDS[kind];
    return { seed: (params.seed | 0), wear: Math.round(clamp01(params.wear ?? 0.5) * 4) / 4, damp: Math.round(clamp01(params.damp ?? 0) * 4) / 4, color: spec.bakes ? toHex(params.color) : null, rotate: params.rotate ? 1 : 0 };
  }
  // Generate the texture set for a kind (albedo with AO baked, normal, roughness+metalness).
  function textures(kind, tp) {
    const spec = KINDS[kind];
    const key = kind + '|' + tp.seed + '|' + tp.wear + '|' + tp.damp + '|' + tp.color + '|' + tp.rotate + '|' + quality();
    if (texCache.has(key)) return texCache.get(key);
    const t0 = performance.now();
    let n = RES[quality()]?.[spec.res] ?? 512;
    const est = n * n * 4 * 1.334 * (spec.res === 'big' ? 2.25 : 3);
    if (bytes + est > BUDGET) { n >>= 1; if (!warned) { warned = true; console.warn('[materials] texture budget reached; generating further textures at half resolution'); } }
    const p = { seed: tp.seed, wear: tp.wear, damp: tp.damp, color: tp.color != null ? hex(tp.color) : null };
    const out = spec.gen(n, p);
    let { r, g, b, h, rough, metal, alpha } = out;
    if (tp.rotate) { r = transpose(r, n); g = transpose(g, n); b = transpose(b, n); h = transpose(h, n); rough = transpose(rough, n); if (metal) metal = transpose(metal, n); if (alpha) alpha = transpose(alpha, n); }
    if (out.ao !== false) {
      const ao = crevice(h, n, out.aoR ?? Math.max(1, n >> 7), out.aoK ?? 3);
      for (let i = 0; i < ao.length; i++) { const m = 0.3 + 0.7 * ao[i]; r[i] *= m; g[i] *= m; b[i] *= m; }
    }
    const an = aniso();
    const map = track(dataTexture(packRGBA(n, r, g, b, alpha), n, n, { srgb: true, aniso: an }));
    const normalMap = track(dataTexture(normalRGBA(h, n, (out.bump ?? spec.bump) * (n / 512)), n, n, { aniso: an }));
    let on = n, ro = rough, me = metal;
    if (n > 512) { on = n >> 1; ro = downsample(rough, n); me = metal ? downsample(metal, n) : null; }
    const one = field(on, 1);
    const ormMap = track(dataTexture(packRGBA(on, one, ro, me || field(on, 0)), on, on, { aniso: an }));
    const set = { map, normalMap, roughnessMap: ormMap, metalnessMap: ormMap, size: n };
    texCache.set(key, set);
    const ms = performance.now() - t0; genMs += ms; genLog[key] = +ms.toFixed(1);
    return set;
  }
  // Same textures with a given repeat (clones share the GPU upload).
  function withRepeat(set, key, ru, rv) {
    const k = key + '|' + ru + ',' + rv;
    if (repeatCache.has(k)) return repeatCache.get(k);
    const clone = (t) => { const c = t.clone(); c.repeat.set(ru, rv); c.needsUpdate = true; return c; };
    const map = clone(set.map), normalMap = clone(set.normalMap), orm = clone(set.roughnessMap);
    const r = { map, normalMap, roughnessMap: orm, metalnessMap: orm };
    repeatCache.set(k, r); return r;
  }
  function getEnv() { if (envMap === undefined) envMap = ctx.renderer ? makeEnvMap(ctx) : null; if (envMap) track(envMap); return envMap; }

  const api = {
    kinds: Object.keys(KINDS), cardKinds: CARD_KINDS,
    get(kindIn, params = {}) {
      const kind = resolveKind(kindIn);
      if (!kind) {
        if (CARD_KINDS.includes(kindIn)) return api.cardMaterial(kindIn, params);
        console.warn('[materials] unknown kind', kindIn); return api.get('concrete', params);
      }
      const spec = KINDS[kind], tp = texParams(kind, params);
      const scale = params.scale ?? spec.scale, rep = params.repeat || [1 / scale, 1 / scale];
      const mkey = kind + JSON.stringify(tp) + '|' + rep[0] + ',' + rep[1] + '|' + JSON.stringify({ c: spec.bakes ? null : toHex(params.color), r: params.roughness, m: params.metalness, e: toHex(params.emissive), ei: params.emissiveIntensity, s: params.side, t: params.transparent, a: params.alphaTest, o: params.opacity, b: params.bump, dw: params.depthWrite, env: params.envMapIntensity, po: params.polygonOffset });
      if (matCache.has(mkey)) return matCache.get(mkey);
      const set = textures(kind, tp);
      const maps = withRepeat(set, kind + JSON.stringify(tp), rep[0], rep[1]);
      const ns = (params.bump ?? 1);
      const mat = new THREE.MeshStandardMaterial({
        color: spec.bakes ? 0xffffff : (toHex(params.color) ?? 0xffffff),
        map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(ns, ns),
        roughnessMap: maps.roughnessMap, metalnessMap: maps.metalnessMap,
        roughness: params.roughness ?? 1, metalness: params.metalness ?? 1,
        emissive: toHex(params.emissive) ?? 0x000000, emissiveIntensity: params.emissiveIntensity ?? 1,
        side: params.side ?? spec.side ?? THREE.FrontSide,
        transparent: params.transparent ?? spec.transparent ?? false, opacity: params.opacity ?? 1,
        alphaTest: params.alphaTest ?? spec.alphaTest ?? 0, depthWrite: params.depthWrite ?? spec.depthWrite ?? true,
      });
      if (params.polygonOffset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1; }
      const envI = params.envMapIntensity ?? spec.env ?? (quality() === 'low' ? 0 : 0.3);
      if (envI > 0 && (quality() !== 'low' || spec.env >= 0.5)) { const env = getEnv(); if (env) { mat.envMap = env; mat.envMapIntensity = envI; mat.userData.envBase = envI; envMats.push(mat); } }
      mat.userData.kind = kind; mat.userData.materialsKey = mkey;
      matCache.set(mkey, mat);
      return mat;
    },
    texture(kindIn, params = {}) {
      const kind = resolveKind(kindIn); if (!kind) return null;
      const spec = KINDS[kind], tp = texParams(kind, params), set = textures(kind, tp);
      const scale = params.scale ?? spec.scale, rep = params.repeat || [1 / scale, 1 / scale];
      const maps = withRepeat(set, kind + JSON.stringify(tp), rep[0], rep[1]);
      return { map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap, metalnessMap: maps.metalnessMap, size: set.size };
    },
    terrainDetail() {
      if (detail) return detail;
      const t0 = performance.now(), n = quality() === 'low' ? 256 : 512, out = genTerrainDetail(n, {}), an = aniso();
      const normalMap = track(dataTexture(normalRGBA(out.h, n, 10 * (n / 512)), n, n, { aniso: an }));
      const one = field(n, 1), roughnessMap = track(dataTexture(packRGBA(n, one, out.rough, field(n, 0)), n, n, { aniso: an }));
      normalMap.repeat.set(0.5, 0.5); roughnessMap.repeat.set(0.5, 0.5);
      detail = { normalMap, roughnessMap, metres: 2 }; genLog.terrainDetail = +(performance.now() - t0).toFixed(1);
      return detail;
    },
    card(kind, variant = 0) {
      if (!CARD_KINDS.includes(kind)) kind = 'grass';
      const k = kind + '|' + (variant | 0);
      if (!cardCache.has(k)) { const c = makeCard(kind, variant | 0); track(c.map); track(c.normalMap); cardCache.set(k, c); }
      return cardCache.get(k);
    },
    cardMaterial(kind, params = {}) {
      const k = 'card|' + kind + '|' + (params.variant | 0) + '|' + JSON.stringify({ c: toHex(params.color), s: params.side });
      if (matCache.has(k)) return matCache.get(k);
      const c = api.card(kind, params.variant | 0);
      const mat = new THREE.MeshStandardMaterial({ map: c.map, normalMap: c.normalMap, color: toHex(params.color) ?? 0xffffff, alphaTest: params.alphaTest ?? 0.5, side: params.side ?? DS, roughness: 0.9, metalness: 0 });
      mat.userData.kind = 'card:' + kind; matCache.set(k, mat); return mat;
    },
    decal(kind) {
      const k = { bullethole_concrete: 'bullet_concrete', bullethole_metal: 'bullet_metal', bullethole_wood: 'bullet_wood', bullet: 'bullet_concrete', hole: 'bullet_concrete', soot: 'scorch', burn: 'scorch' }[kind] || kind;
      const kk = ['bullet_concrete', 'bullet_metal', 'bullet_wood', 'scorch', 'ash'].includes(k) ? k : 'bullet_concrete';
      if (!decalCache.has(kk)) decalCache.set(kk, track(makeDecal(kk)));
      return decalCache.get(kk);
    },
    get envMap() { return getEnv(); },
    stats() { return { textures: texCache.size, materials: matCache.size, cards: cardCache.size, decals: decalCache.size, bytes, mb: +(bytes / 1048576).toFixed(1), genMs: +genMs.toFixed(0), gen: genLog }; },
    // Reflection intensity follows daylight so metals don't glow at night. Cheap: a few scalar writes.
    update(dt, t) {
      if (!envMats.length) return;
      const night = ctx.time?.night ?? 0, storm = ctx.lighting?.storm ?? 0;
      const k = (1 - night * 0.93) * (1 - storm * 0.5);
      if (Math.abs(k - api._envK) < 0.004) return; api._envK = k;
      for (let i = 0; i < envMats.length; i++) envMats[i].envMapIntensity = envMats[i].userData.envBase * k;
    },
    _envK: -1,
    dispose() { for (const s of texCache.values()) { s.map.dispose(); s.normalMap.dispose(); s.roughnessMap.dispose(); } texCache.clear(); matCache.clear(); repeatCache.clear(); bytes = 0; },
  };
  return api;
}
