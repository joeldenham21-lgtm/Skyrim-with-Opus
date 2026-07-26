/**
 * WYRMHOLD — the land itself.
 *
 * One analytic height function drives everything: mesh generation, collision,
 * object scattering, water depth, the world map and AI pathing. Expensive
 * shaping (river carving, settlement flattening, roads) is baked once into a
 * coarse modifier field and sampled bilinearly, so `heightAt()` stays cheap
 * enough to call tens of thousands of times per chunk.
 */

import { Noise, clamp, saturate, smoothstep, lerp, distToSegment2, segParam, Rand, floatToHalf } from '../core/math.js';

export const WORLD_SIZE = 4096;        // metres, centred on the origin
export const WORLD_HALF = WORLD_SIZE / 2;
export const SEA_LEVEL = 0;
export const MAX_HEIGHT = 640;

const MOD_RES = 384;                   // modifier field resolution (~10.6 m/texel)
const BIOME_RES = 512;

/** Named places. `flatten` carves a building pad; `discovered` is runtime state. */
export const LOCATIONS = [
  { id: 'hearthwatch', name: 'Hearthwatch', kind: 'town', x: -140, z: 210, radius: 96, flatten: 0.94, icon: '🏘️',
    blurb: 'A timber village in the lee of the Sentinel ridge.' },
  { id: 'wardstone', name: 'The Wardstone Circle', kind: 'landmark', x: 520, z: -260, radius: 42, flatten: 0.85, icon: '🗿',
    blurb: 'Nine standing stones, older than any road.' },
  { id: 'barrow', name: 'Hollowmere Barrow', kind: 'dungeon', x: 880, z: 640, radius: 46, flatten: 0.8, icon: '⚱️',
    blurb: 'A Nord tomb sealed with iron and older promises.' },
  { id: 'watchtower', name: 'Greywind Watch', kind: 'ruin', x: -760, z: -540, radius: 34, flatten: 0.8, icon: '🗼',
    blurb: 'A broken tower that once watched the pass.' },
  { id: 'banditcamp', name: 'Crowfoot Camp', kind: 'camp', x: 330, z: 900, radius: 34, flatten: 0.75, icon: '⛺',
    blurb: 'Smoke, and men who do not want company.' },
  { id: 'lodge', name: 'Elk Hollow Lodge', kind: 'house', x: -880, z: 620, radius: 28, flatten: 0.85, icon: '🏚️',
    blurb: 'A hunter keeps the fire lit here.' },
  { id: 'shrine', name: 'Shrine of the Wanderer', kind: 'shrine', x: 60, z: -820, radius: 22, flatten: 0.8, icon: '⛩️',
    blurb: 'Travellers leave coins. Some leave more.' },
  { id: 'wreck', name: 'The Gale-Widow', kind: 'wreck', x: -420, z: 1560, radius: 40, flatten: 0.5, icon: '⛵',
    blurb: 'A merchantman broken on the shingle.' },
  { id: 'peak', name: 'Skarnvald Peak', kind: 'peak', x: 240, z: -1420, radius: 90, flatten: 0.0, icon: '🐉',
    blurb: 'The dragon\'s roost. Nothing nests there now but wind.' },
  { id: 'mine', name: 'Ashenvein Mine', kind: 'mine', x: -1180, z: -180, radius: 30, flatten: 0.8, icon: '⛏️',
    blurb: 'Iron ran out. Something else did not.' },
  { id: 'lake', name: 'Hollowmere', kind: 'water', x: 700, z: 300, radius: 150, flatten: 0, icon: '💧',
    blurb: 'Still water, and a drowned causeway.' },
];

/** The river, as a polyline from the northern glacier to the southern sea. */
const RIVER = [
  [180, -1240], [140, -1000], [40, -760], [-40, -520], [-90, -300],
  [-120, -60], [-150, 180], [-180, 420], [-230, 700], [-300, 1000],
  [-360, 1280], [-420, 1560], [-470, 1900],
];

/** Roads connecting the settlements. */
const ROADS = [
  ['hearthwatch', 'wardstone'],
  ['hearthwatch', 'lodge'],
  ['hearthwatch', 'wreck'],
  ['wardstone', 'barrow'],
  ['hearthwatch', 'watchtower'],
  ['hearthwatch', 'banditcamp'],
  ['watchtower', 'mine'],
  ['wardstone', 'shrine'],
];

export class Heightfield {
  constructor(seed = 20260726) {
    this.seed = seed;
    this.nBase = new Noise(seed);
    this.nRidge = new Noise(seed + 101);
    this.nWarp = new Noise(seed + 202);
    this.nDetail = new Noise(seed + 303);
    this.nBiome = new Noise(seed + 404);
    this.nMask = new Noise(seed + 505);

    this.locations = LOCATIONS.map(l => ({ ...l, discovered: false }));
    this.locById = new Map(this.locations.map(l => [l.id, l]));

    this._buildRoads();
    this._bakeModifiers();
    this._bakeBiome();
  }

  loc(id) { return this.locById.get(id); }

  _buildRoads() {
    this.roadSegs = [];
    for (const [a, b] of ROADS) {
      const A = this.locById.get(a), B = this.locById.get(b);
      if (!A || !B) continue;
      // Bend the road with a couple of control points so it never looks ruled.
      const rnd = new Rand((a.length * 977 + b.length * 131 + this.seed) | 0);
      const steps = 5;
      let px = A.x, pz = A.z;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const nx = lerp(A.x, B.x, t), nz = lerp(A.z, B.z, t);
        const perpX = -(B.z - A.z), perpZ = (B.x - A.x);
        const l = Math.hypot(perpX, perpZ) || 1;
        const bend = Math.sin(t * Math.PI) * rnd.float(-140, 140);
        const cx = nx + perpX / l * bend, cz = nz + perpZ / l * bend;
        this.roadSegs.push([px, pz, cx, cz]);
        px = cx; pz = cz;
      }
    }
  }

  // -------------------------------------------------------------------------
  /** Raw geological height before rivers, roads and settlements. */
  _baseHeight(x, z) {
    const wx = x + this.nWarp.fbm2(x * 0.00042, z * 0.00042, 3) * 320;
    const wz = z + this.nWarp.fbm2(x * 0.00042 + 40, z * 0.00042 + 40, 3) * 320;

    // Where mountains are allowed to grow at all.
    const north = smoothstep(700, -1100, z);                       // more relief northward
    let massif = this.nMask.fbm2(wx * 0.00038, wz * 0.00038, 4) * 0.5 + 0.5;
    massif = saturate((massif - 0.30) / 0.55);
    const mountainMask = saturate(massif * (0.30 + north * 0.95));

    const ridge = this.nRidge.ridged2(wx * 0.00052, wz * 0.00052, 6, 2.03, 0.52);
    const hills = this.nBase.erodedFbm2(wx * 0.00085, wz * 0.00085, 6, 2.0, 0.5, 3.0) * 0.5 + 0.5;
    const detail = this.nDetail.fbm2(x * 0.0075, z * 0.0075, 4) * 0.5 + 0.5;
    const micro = this.nDetail.fbm2(x * 0.045, z * 0.045, 2) * 0.5 + 0.5;

    let h = 6 + hills * 92 + Math.pow(ridge, 1.35) * mountainMask * 560;
    h += (detail - 0.5) * (7 + mountainMask * 26);
    h += (micro - 0.5) * 1.5;

    // Southern coastline: the land runs out into the sea.
    const coast = smoothstep(1150, 2050, z);
    h = lerp(h, -34, coast * coast);
    // Hard world edge — the map fades into deep water / impassable cliffs.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const rim = smoothstep(WORLD_HALF - 460, WORLD_HALF - 40, edge);
    h = lerp(h, z > 900 ? -60 : h + 220, rim * (z > 900 ? 1 : 0.55));

    return h;
  }

  // -------------------------------------------------------------------------
  _bakeModifiers() {
    const N = MOD_RES;
    this.modRes = N;
    this.modCarve = new Float32Array(N * N);      // additive (rivers, gullies)
    this.modFlatT = new Float32Array(N * N);      // flatten target height
    this.modFlatW = new Float32Array(N * N);      // flatten weight
    this.modRoad = new Float32Array(N * N);       // 0..1 road mask

    const step = WORLD_SIZE / (N - 1);

    // First pass: settlement pad heights need the *base* terrain average.
    for (const L of this.locations) {
      if (!L.flatten) { L.padHeight = this._baseHeight(L.x, L.z); continue; }
      let sum = 0, n = 0;
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        for (const rr of [0.35, 0.7]) {
          sum += this._baseHeight(L.x + Math.cos(ang) * L.radius * rr, L.z + Math.sin(ang) * L.radius * rr);
          n++;
        }
      }
      L.padHeight = sum / n;
    }

    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * step;
        const idx = j * N + i;

        // --- river valley ---------------------------------------------------
        let riverD = 1e9, riverT = 0;
        for (let k = 0; k < RIVER.length - 1; k++) {
          const [ax, az] = RIVER[k], [bx, bz] = RIVER[k + 1];
          if (Math.min(ax, bx) - 260 > x || Math.max(ax, bx) + 260 < x) continue;
          if (Math.min(az, bz) - 260 > z || Math.max(az, bz) + 260 < z) continue;
          const d = distToSegment2(x, z, ax, az, bx, bz);
          if (d < riverD) { riverD = d; riverT = (k + segParam(x, z, ax, az, bx, bz)) / (RIVER.length - 1); }
        }
        if (riverD < 240) {
          const wobble = this.nDetail.fbm2(x * 0.004, z * 0.004, 3) * 26;
          const d = riverD + wobble;
          const bank = 1 - smoothstep(14, 190, d);
          const bed = 1 - smoothstep(0, 20, d);
          this.modCarve[idx] -= bank * 26 + bed * 12;
          // riverbed drops toward the sea
          const target = lerp(120, -6, Math.pow(riverT, 0.85));
          const w = bank * 0.75;
          if (w > this.modFlatW[idx]) { this.modFlatW[idx] = w; this.modFlatT[idx] = target; }
        }

        // --- settlement pads -------------------------------------------------
        for (const L of this.locations) {
          if (!L.flatten) continue;
          const d = Math.hypot(x - L.x, z - L.z);
          if (d > L.radius * 2.2) continue;
          const w = (1 - smoothstep(L.radius * 0.55, L.radius * 2.0, d)) * L.flatten;
          if (w > this.modFlatW[idx]) { this.modFlatW[idx] = w; this.modFlatT[idx] = L.padHeight; }
        }

        // --- roads ------------------------------------------------------------
        let roadD = 1e9;
        for (const [ax, az, bx, bz] of this.roadSegs) {
          if (Math.min(ax, bx) - 40 > x || Math.max(ax, bx) + 40 < x) continue;
          if (Math.min(az, bz) - 40 > z || Math.max(az, bz) + 40 < z) continue;
          const d = distToSegment2(x, z, ax, az, bx, bz);
          if (d < roadD) roadD = d;
        }
        if (roadD < 34) {
          const wob = this.nDetail.fbm2(x * 0.01 + 9, z * 0.01 + 9, 2) * 5;
          this.modRoad[idx] = 1 - smoothstep(3.5, 9.0 + wob, roadD);
        }
      }
    }

    // The lake needs a genuine basin, not just a flat disc.
    const lake = this.locById.get('lake');
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * step;
        const d = Math.hypot(x - lake.x, z - lake.z);
        if (d > lake.radius * 1.9) continue;
        const idx = j * N + i;
        // Two separate curves: `w` decides how completely the basin replaces
        // the surrounding hills (it must be ~1 across the whole lake or the
        // bed stays above the water line), and `t` shapes the bowl itself.
        const w = 1 - smoothstep(lake.radius * 1.05, lake.radius * 1.7, d);
        const t = 1 - smoothstep(lake.radius * 0.20, lake.radius * 1.35, d);
        if (w > this.modFlatW[idx]) {
          this.modFlatW[idx] = Math.min(0.997, w);
          this.modFlatT[idx] = lerp(28, 1, t);   // surface sits at 22 m
        }
      }
    }
    this.lakeLevel = 22;
  }

  _sampleMod(arr, x, z) {
    const N = this.modRes;
    const fx = clamp((x + WORLD_HALF) / WORLD_SIZE, 0, 1) * (N - 1);
    const fz = clamp((z + WORLD_HALF) / WORLD_SIZE, 0, 1) * (N - 1);
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = Math.min(N - 1, i0 + 1), j1 = Math.min(N - 1, j0 + 1);
    const tx = fx - i0, tz = fz - j0;
    const a = arr[j0 * N + i0], b = arr[j0 * N + i1];
    const c = arr[j1 * N + i0], d = arr[j1 * N + i1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  // -------------------------------------------------------------------------
  /** Final terrain height at a world position. This is the ground truth. */
  heightAt(x, z) {
    let h = this._baseHeight(x, z);
    const w = this._sampleMod(this.modFlatW, x, z);
    if (w > 0.001) h = lerp(h, this._sampleMod(this.modFlatT, x, z), Math.min(1, w));
    h += this._sampleMod(this.modCarve, x, z);
    const road = this._sampleMod(this.modRoad, x, z);
    if (road > 0.01) {
      // Roads sit slightly proud and are locally smoothed.
      const s = (this.heightSmooth(x, z, 9) - h) * road * 0.8;
      h += s + road * 0.25;
    }
    return h;
  }

  /** Box-filtered height, for roads and for placing wide flat objects. */
  heightSmooth(x, z, r = 6) {
    let s = 0;
    s += this._baseHeight(x - r, z) + this._baseHeight(x + r, z);
    s += this._baseHeight(x, z - r) + this._baseHeight(x, z + r);
    s *= 0.25;
    const w = this._sampleMod(this.modFlatW, x, z);
    if (w > 0.001) s = lerp(s, this._sampleMod(this.modFlatT, x, z), Math.min(1, w));
    return s + this._sampleMod(this.modCarve, x, z);
  }

  /** Surface normal via central differences. */
  normalAt(x, z, eps = 1.0, out = { x: 0, y: 1, z: 0 }) {
    const hL = this.heightAt(x - eps, z), hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps), hU = this.heightAt(x, z + eps);
    let nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  slopeAt(x, z, eps = 1.5) {
    const n = this.normalAt(x, z, eps, this._tmpN || (this._tmpN = { x: 0, y: 1, z: 0 }));
    return 1 - n.y;
  }

  roadAt(x, z) { return this._sampleMod(this.modRoad, x, z); }

  /** Water surface height at a position, or null if there is no water here. */
  waterAt(x, z) {
    const lake = this.locById.get('lake');
    const dl = Math.hypot(x - lake.x, z - lake.z);
    if (dl < lake.radius * 1.7) return this.lakeLevel;
    if (z > 1180) return SEA_LEVEL;                 // the southern sea
    // river: follow the carved channel
    let best = 1e9, bt = 0;
    for (let k = 0; k < RIVER.length - 1; k++) {
      const [ax, az] = RIVER[k], [bx, bz] = RIVER[k + 1];
      const d = distToSegment2(x, z, ax, az, bx, bz);
      if (d < best) { best = d; bt = (k + segParam(x, z, ax, az, bx, bz)) / (RIVER.length - 1); }
    }
    if (best < 46) return lerp(120, -4, Math.pow(bt, 0.85)) + 1.2;
    return null;
  }

  /** True if the point is underwater (used for spawning and for swimming). */
  isWater(x, z, y = null) {
    const w = this.waterAt(x, z);
    if (w === null) return false;
    const g = y === null ? this.heightAt(x, z) : y;
    return g < w;
  }

  // -------------------------------------------------------------------------
  _bakeBiome() {
    const N = BIOME_RES;
    this.biomeRes = N;
    // R: moisture, G: rockiness, B: road, A: forest density
    this.biomeData = new Uint8Array(N * N * 4);
    const step = WORLD_SIZE / (N - 1);
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * step;
        const h = this.heightAt(x, z);
        const moisture = saturate(
          (this.nBiome.fbm2(x * 0.00075, z * 0.00075, 4) * 0.5 + 0.5) * 0.85 +
          smoothstep(400, 60, h) * 0.25 -
          smoothstep(180, 460, h) * 0.5
        );
        const rocky = saturate(this.nBiome.fbm2(x * 0.0016 + 70, z * 0.0016 + 70, 3) * 0.5 + 0.5);
        const road = this.roadAt(x, z);
        // Conifers like mid altitudes, moisture, and gentle ground.
        const alt = smoothstep(10, 70, h) * (1 - smoothstep(230, 380, h));
        const forest = saturate(
          alt * (0.35 + moisture * 1.0) *
          (this.nBiome.fbm2(x * 0.0011 + 300, z * 0.0011 + 300, 4) * 0.5 + 0.5) * 1.9 - 0.18
        );
        const o = (j * N + i) * 4;
        this.biomeData[o] = moisture * 255;
        this.biomeData[o + 1] = rocky * 255;
        this.biomeData[o + 2] = road * 255;
        this.biomeData[o + 3] = forest * 255;
      }
    }
  }

  sampleBiome(x, z) {
    const N = this.biomeRes;
    const fx = clamp((x + WORLD_HALF) / WORLD_SIZE, 0, 1) * (N - 1);
    const fz = clamp((z + WORLD_HALF) / WORLD_SIZE, 0, 1) * (N - 1);
    const i = Math.round(fx), j = Math.round(fz);
    const o = (j * N + i) * 4;
    return {
      moisture: this.biomeData[o] / 255,
      rocky: this.biomeData[o + 1] / 255,
      road: this.biomeData[o + 2] / 255,
      forest: this.biomeData[o + 3] / 255,
    };
  }

  /** Ray-march against the height field. Used by projectiles and the camera. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 200, step = 0.6) {
    let t = 0;
    let px = ox, py = oy, pz = oz;
    let prevAbove = py > this.heightAt(px, pz);
    while (t < maxDist) {
      const s = step * (1 + t * 0.02);
      t += s;
      px = ox + dx * t; py = oy + dy * t; pz = oz + dz * t;
      const h = this.heightAt(px, pz);
      const above = py > h;
      if (prevAbove && !above) {
        // binary refine
        let lo = t - s, hi = t;
        for (let i = 0; i < 8; i++) {
          const m = (lo + hi) * 0.5;
          const mh = this.heightAt(ox + dx * m, oz + dz * m);
          if (oy + dy * m > mh) lo = m; else hi = m;
        }
        return { hit: true, dist: hi, x: ox + dx * hi, y: oy + dy * hi, z: oz + dz * hi };
      }
      prevAbove = above;
    }
    return { hit: false, dist: maxDist };
  }

  /**
   * Bakes the whole map into a filterable half-float height texture.
   * The water shader reads it to get depth (shoreline foam, absorption) and
   * the world map renders from the same data, so they can never disagree.
   */
  buildHeightTexture(size = 1024) {
    const data = new Uint16Array(size * size);
    const raw = new Float32Array(size * size);
    const step = WORLD_SIZE / (size - 1);
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < size; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i < size; i++) {
        const h = this.heightAt(-WORLD_HALF + i * step, z);
        raw[j * size + i] = h;
        data[j * size + i] = floatToHalf(h);
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    this.heightTexData = raw;
    this.heightTexSize = size;
    this.minHeight = min;
    this.maxHeight = max;
    return { data, size, min, max, raw };
  }

  /** Bilinear read from the baked height texture (fast, slightly smoothed). */
  fastHeight(x, z) {
    const raw = this.heightTexData;
    if (!raw) return this.heightAt(x, z);
    const N = this.heightTexSize;
    const fx = clamp((x + WORLD_HALF) / WORLD_SIZE, 0, 1) * (N - 1);
    const fz = clamp((z + WORLD_HALF) / WORLD_SIZE, 0, 1) * (N - 1);
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = Math.min(N - 1, i0 + 1), j1 = Math.min(N - 1, j0 + 1);
    const tx = fx - i0, tz = fz - j0;
    return lerp(lerp(raw[j0 * N + i0], raw[j0 * N + i1], tx),
                lerp(raw[j1 * N + i0], raw[j1 * N + i1], tx), tz);
  }

  /** Slope from the baked map — ~50x cheaper than slopeAt, accurate to ~4 m. */
  fastSlope(x, z, eps = 4) {
    const hL = this.fastHeight(x - eps, z), hR = this.fastHeight(x + eps, z);
    const hD = this.fastHeight(x, z - eps), hU = this.fastHeight(x, z + eps);
    const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    return 1 - ny / (Math.hypot(nx, ny, nz) || 1);
  }

  /** Finds a walkable spawn point near a target, avoiding water and cliffs. */
  findFlat(x, z, radius = 40, maxSlope = 0.35, tries = 40, rand = Math.random) {
    for (let i = 0; i < tries; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.isWater(px, pz)) continue;
      if (this.slopeAt(px, pz) > maxSlope) continue;
      return { x: px, y: this.heightAt(px, pz), z: pz };
    }
    return { x, y: this.heightAt(x, z), z };
  }
}
