// Anomalies: electric (charged nodes + arcs), reflector (mirrored shards that whip), gravity (an unseen sink with
// orbiting debris), gas (scorched vents + a noise-shaded fog volume). Each anomaly is a class instance with
// { type, position, radius, revealed, reveal(), update(dt), affectPlayer(dt), dispose() }. Placement happens on
// gameStart/tide (populate); everything is disposed on reset(). Post distortion is driven from fieldAt() each frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { glowTexture } from '../render/textures.js';
import { clamp, clamp01, damp, lerp, TAU } from '../core/math.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const FIELD = { gravity: 1.0, electric: 0.5, reflector: 0.3, gas: 0.2 };
const ACTIVE_D = 120, SOUND_D = 60, FIELD_D = 12;
// the controller damps horizontal velocity toward the input target at 22/s, so a raw k*dt impulse would be eaten
// within a few frames; this gain makes the equilibrium pull ~k/6 m/s (1 m/s at the edge, 3 m/s near the core)
const PULL_GAIN = 3.6;

// ---------- shared geometry (built once, never disposed) ----------
let shared = null;
function sharedGeo() {
  if (shared) return shared;
  const node = new THREE.SphereGeometry(0.11, 14, 10);
  const octa = new THREE.OctahedronGeometry(1, 0), icosa = new THREE.IcosahedronGeometry(1, 0);
  // debris chunk: a dodecahedron with jittered vertices so no two faces are regular
  const rock = new THREE.DodecahedronGeometry(1, 0);
  const rp = rock.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const h = Math.sin(x * 7.1 + y * 3.3) * 0.5 + Math.cos(z * 5.7 - x * 2.1) * 0.5;
    const k = 1 + h * 0.22;
    rp.setXYZ(i, x * k * 1.25, y * k * 0.8, z * k);
  }
  rock.computeVertexNormals();
  const blob = new THREE.IcosahedronGeometry(1, 3);
  for (const g of [node, octa, icosa, rock, blob]) g.userData.shared = true;
  shared = { node, octa, icosa, rock, blob };
  return shared;
}

// ---------- materials ----------
function nodeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.35, metalness: 0.7, emissive: 0x7fe8ff, emissiveIntensity: 2 });
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.2); totalEmissiveRadiance *= 0.05 + 1.6 * rim; }`);
  };
  return m;
}

const SHARD_VERT = /* glsl */`
  #include <fog_pars_vertex>
  varying vec3 vN; varying vec3 vW; varying float vFlash;
  void main(){
    vec3 transformed = position;
    mat4 im = mat4(1.0);
    #ifdef USE_INSTANCING
      im = instanceMatrix;
    #endif
    vFlash = 0.0;
    #ifdef USE_INSTANCING_COLOR
      vFlash = instanceColor.r;
    #endif
    vec4 w = modelMatrix * im * vec4(transformed, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix * im) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <fog_vertex>
  }`;
const SHARD_FRAG = /* glsl */`
  ${GLSL_NOISE}
  #include <fog_pars_fragment>
  uniform vec3 uHorizon, uZenith, uSunDir, uSunColor; uniform float uTime, uFlash, uNight;
  varying vec3 vN; varying vec3 vW; varying float vFlash;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float ndv = max(dot(N, V), 0.0);
    vec3 R = reflect(-V, N);
    float up = clamp(R.y, -1.0, 1.0);
    // only distinctly upward reflections show the bright lid; near-horizontal ones show the dim marsh and fog line,
    // so from eye level the shards sit as dull glassy shapes a shade off the ground behind them
    vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.7, up)) * 0.85;
    vec3 ground = mix(vec3(0.16, 0.18, 0.12), uHorizon * 0.42, 0.5) * (0.3 + 0.7 * (1.0 - uNight));
    vec3 refl = mix(ground, sky, smoothstep(0.02, 0.4, up));
    float smudge = fbm3(vW.xz * 2.3 + vW.y * 1.7 + uTime * 0.02);
    refl *= 0.8 + 0.28 * smudge;
    float glint = pow(max(dot(R, uSunDir), 0.0), 160.0);
    refl += uSunColor * glint * 0.9;
    float fres = pow(1.0 - ndv, 3.0);
    vec3 edge = mix(uHorizon, vec3(0.85, 0.95, 1.0), 0.5) * fres * 0.3;
    float flash = max(uFlash, vFlash);
    vec3 col = refl + edge + vec3(0.7, 0.95, 1.2) * flash * (0.4 + 0.6 * fres);
    // glass: the world shows through the faces; only the rim, the glint and a flash give the shard away
    float a = 0.16 + 0.6 * fres + glint * 0.5 + flash * 0.7;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <fog_fragment>
  }`;
function shardMaterial() {
  const uniforms = Object.assign({
    uHorizon: { value: new THREE.Color(0.5, 0.55, 0.6) }, uZenith: { value: new THREE.Color(0.4, 0.45, 0.5) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
    uTime: { value: 0 }, uFlash: { value: 0 }, uNight: { value: 0 },
  }, fogUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
  return new THREE.ShaderMaterial({ uniforms, vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, fog: true, transparent: true, depthWrite: false });
}

const GAS_VERT = /* glsl */`
  ${GLSL_NOISE}
  #include <fog_pars_vertex>
  uniform float uTime, uSeed;
  varying vec3 vVN; varying vec3 vVV; varying vec3 vW;
  void main(){
    // breathe the silhouette: slow low-frequency swell so the blob never reads as a sphere
    float n = fbm3d(position * 1.6 + vec3(uSeed) + vec3(uTime * 0.05, -uTime * 0.03, uTime * 0.04));
    vec3 transformed = position * (0.8 + 0.5 * n);
    vec4 w = modelMatrix * vec4(transformed, 1.0); vW = w.xyz;
    vec4 mv = viewMatrix * w; vVV = -mv.xyz; vVN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
    #include <fog_vertex>
  }`;
const GAS_FRAG = /* glsl */`
  ${GLSL_NOISE}
  #include <fog_pars_fragment>
  uniform float uTime, uSeed, uNight, uBase, uHeight, uTorch; uniform vec3 uHorizon, uCamFwd;
  varying vec3 vVN; varying vec3 vVV; varying vec3 vW;
  void main(){
    float sdv = dot(normalize(vVN), normalize(vVV));
    float ndv = abs(sdv);
    // chord through a sphere grows toward the centre: the heart is dense, the limb thin
    float body = 0.2 + 0.8 * pow(smoothstep(0.0, 0.9, ndv), 1.4);
    vec3 p = vW * 0.32 + vec3(uSeed);
    float n = fbm3d(p + vec3(uTime * 0.05, uTime * 0.09, -uTime * 0.04));
    float n2 = vnoise3(p * 3.1 - vec3(uTime * 0.1, uTime * 0.26, 0.0));
    float nn = n + 0.25 * n2;
    float dens = smoothstep(0.3, 0.72, nn);
    float h = clamp((vW.y - uBase) / max(uHeight, 0.1), 0.0, 1.5);
    float hf = 1.0 - smoothstep(0.35, 1.05, h);
    float a = body * (0.25 + 0.75 * dens) * hf * 0.78;
    // seen from inside (back faces) the shell is a moving, holed curtain; fragments right at the lens fade
    vec3 relc = vW - cameraPosition; float dc = length(relc);
    if (sdv < 0.0) a = (0.12 + 0.5 * dens) * hf * 0.55;
    a *= smoothstep(0.3, 1.8, dc);
    float lum = dot(uHorizon, vec3(0.33, 0.4, 0.27));
    // sulphur: a khaki-yellow that keeps some of the sky's cast, darker and browner in the dense pockets
    vec3 base = mix(uHorizon, vec3(0.88, 0.8, 0.44), 0.7);
    vec3 col = base * (0.1 + 1.25 * lum);
    col = mix(col, col * vec3(0.72, 0.62, 0.42), dens * 0.55);
    // hand torch: a soft cone from the camera lights the vapour from inside the beam
    float cone = smoothstep(0.86, 0.96, dot(relc / max(dc, 0.01), uCamFwd));
    col += vec3(0.95, 0.85, 0.55) * cone * uTorch * 0.75 / (1.0 + dc * dc * 0.012);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <fog_fragment>
  }`;
function gasMaterial(seed) {
  const uniforms = Object.assign({
    uTime: { value: 0 }, uSeed: { value: seed }, uNight: { value: 0 }, uBase: { value: 0 }, uHeight: { value: 3 }, uTorch: { value: 0 },
    uHorizon: { value: new THREE.Color(0.5, 0.55, 0.6) }, uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
  }, fogUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
  return new THREE.ShaderMaterial({ uniforms, vertexShader: GAS_VERT, fragmentShader: GAS_FRAG, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

// arcs: camera-facing ribbons (a hot filament with a soft halo across the width); additive so they bloom
const ARC_VERT = /* glsl */`
  attribute float aSide; attribute float aGlow;
  varying float vSide; varying float vGlow;
  void main(){ vSide = aSide; vGlow = aGlow; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ARC_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vSide; varying float vGlow;
  void main(){
    float x = abs(vSide);
    float core = pow(max(1.0 - x * 1.7, 0.0), 2.0);
    float halo = pow(1.0 - x, 2.5) * 0.3;
    gl_FragColor = vec4(uColor * (core * 2.4 + halo) * vGlow * uOpacity, 1.0);
  }`;
function arcMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.5, 0.91, 1.0) }, uOpacity: { value: 1 } },
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
}

let rockMat = null;
function rockMaterial() {
  if (rockMat) return rockMat;
  rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.05 });
  rockMat.userData.shared = true;
  rockMat.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vRockW;`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n{ float g = vnoise(vRockW.xz * 9.0 + vRockW.y * 7.0); diffuseColor.rgb *= 0.78 + 0.44 * g; }`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRockW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  };
  return rockMat;
}
let ventMat = null;
function ventMaterial() {
  if (ventMat) return ventMat;
  ventMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.98, metalness: 0.0 });
  ventMat.userData.shared = true;
  return ventMat;
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material && !o.material.userData.shared) { if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); }
  });
}

// ---------- base ----------
class Anomaly {
  constructor(ctx, type, position, rng) {
    this.ctx = ctx; this.type = type; this.rng = rng;
    this.position = position.clone();
    this.radius = 6; this.revealed = false; this.revealT = 0;
    this.root = new THREE.Group(); this.root.name = 'anomaly_' + type; this.root.position.copy(this.position);
    this.loop = null; this.dist = Infinity; this.notified = false; this.t = rng() * 100;
    this.blurWant = 0; this.fieldMul = 1;
    this.soundPos = this.position.clone(); this.soundPos.y += 1.2;
    ctx.scene.add(this.root);
  }
  // world-space player distance (XZ) cached by the manager each frame
  reveal(at) {
    const first = !this.revealed;
    this.revealed = true; this.revealT = 20;
    this.onReveal(at, first);
    this.ctx.events.emit('anomalyRevealed', this);
  }
  onReveal() {}
  tickReveal(dt) { if (this.revealT > 0) { this.revealT -= dt; if (this.revealT <= 0) { this.revealT = 0; this.revealed = false; } } }
  // positional loop: alive only while wanted and within SOUND_D
  sound(name, gain, want = true) {
    const a = this.ctx.audio;
    if (!want || this.dist > SOUND_D) { if (this.loop) { this.loop.stop(0.6); this.loop = null; } return; }
    if (this.loop && this.loop.alive && this.loop.name === name) { this.loop.setGain(gain, 0.2); return; }
    if (this.loop) { this.loop.stop(0.4); this.loop = null; }
    this.loop = a.loop(name, { pos: this.soundPos, hrtf: true, gain, ref: 3.5, max: 80, rolloff: 1.3 });
  }
  play(name, opts = {}) { return this.ctx.audio.play(name, Object.assign({ pos: this.soundPos, hrtf: true }, opts)); }
  update(dt) {}
  affectPlayer(dt) {}
  dispose() {
    if (this.loop) { this.loop.stop(0.3); this.loop = null; }
    this.ctx.scene.remove(this.root); disposeTree(this.root);
  }
}

// ---------- ELECTRIC ----------
const ARC_PTS = 11, ARC_SEG = ARC_PTS - 1, ARC_VERTS = ARC_SEG * 6;
const arcPts = new Float32Array(ARC_PTS * 3);   // scratch: the jittered points of one arc
class Electric extends Anomaly {
  constructor(ctx, position, rng) {
    super(ctx, 'electric', position, rng);
    const g = sharedGeo();
    this.radius = rng.range(5, 7);
    const n = rng.int(3, 6);
    this.nodes = [];
    for (let i = 0; i < n; i++) {
      this.nodes.push({ a: (i / n) * TAU + rng.range(-0.4, 0.4), r: rng.range(this.radius * 0.35, this.radius * 0.82), h: rng.range(0.5, 3), ph: rng() * TAU, sp: rng.range(0.06, 0.16) * (rng.chance(0.5) ? 1 : -1), pos: new THREE.Vector3() });
    }
    this.nodeMat = nodeMaterial();
    this.nodeMesh = new THREE.InstancedMesh(g.node, this.nodeMat, n);
    this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodeMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.8, 0), this.radius + 2);
    this.root.add(this.nodeMesh);
    // soft additive halo per node
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.glowMat = new THREE.PointsMaterial({ map: glowTexture(), color: new THREE.Color(0.5, 0.9, 1.0), size: 0.9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.glow = new THREE.Points(gg, this.glowMat); this.glow.frustumCulled = false; this.root.add(this.glow);
    // arcs: a ring through the nodes plus one cross arc, plus transient arcs to probes / the player
    this.pairs = [];
    for (let i = 0; i < n; i++) this.pairs.push([i, (i + 1) % n]);
    if (n >= 4) this.pairs.push([0, Math.floor(n / 2)]);
    this.extra = [];
    this.maxArcs = this.pairs.length + 4;
    const ag = new THREE.BufferGeometry();
    this.arcPos = new Float32Array(this.maxArcs * ARC_VERTS * 3);
    this.arcSide = new Float32Array(this.maxArcs * ARC_VERTS);
    this.arcGlow = new Float32Array(this.maxArcs * ARC_VERTS);
    for (let i = 0; i < this.maxArcs * ARC_SEG; i++) { const o = i * 6; this.arcSide[o] = -1; this.arcSide[o + 1] = 1; this.arcSide[o + 2] = 1; this.arcSide[o + 3] = -1; this.arcSide[o + 4] = 1; this.arcSide[o + 5] = -1; }
    ag.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute('aSide', new THREE.BufferAttribute(this.arcSide, 1));
    ag.setAttribute('aGlow', new THREE.BufferAttribute(this.arcGlow, 1).setUsage(THREE.DynamicDrawUsage));
    this.arcMat = arcMaterial();
    this.arcs = new THREE.Mesh(ag, this.arcMat); this.arcs.frustumCulled = false; this.root.add(this.arcs);
    this.tellT = rng.range(2, 6); this.flick = 0; this.cool = 0; this.regen = 0; this.shown = false; this.arcK = 0; this.strikeT = rng.range(0.5, 1.5);
    this.setShown(false);
  }
  setShown(v) { this.shown = v; this.nodeMesh.visible = v; this.glow.visible = v; this.arcs.visible = v; }
  onReveal(at, first) {
    if (at) { this.extra.push({ pos: _v.copy(at).sub(this.position).clone(), t: 0.5, glow: 1.2 }); if (first) this.play('arc_zap', { gain: 0.5, rate: 1.2 }); }
    this.regen = 0;
  }
  // one ribbon a -> b: ARC_PTS jittered points, each segment a camera-facing quad. Dead arcs collapse to a point.
  writeArc(a, b, alive, glow) {
    if (this.arcK >= this.maxArcs) return;
    const pos = this.arcPos, gl = this.arcGlow, base = this.arcK * ARC_VERTS; this.arcK++;
    if (!alive) { for (let i = 0; i < ARC_VERTS; i++) { pos[(base + i) * 3] = a.x; pos[(base + i) * 3 + 1] = a.y; pos[(base + i) * 3 + 2] = a.z; gl[base + i] = 0; } return; }
    _u.subVectors(b, a); const len = _u.length() || 0.01; _u.divideScalar(len);
    _w.set(-_u.z, 0, _u.x); if (_w.lengthSq() < 1e-4) _w.set(1, 0, 0); _w.normalize();
    _s.crossVectors(_u, _w);
    // jitter grows toward the middle; a second, finer wobble keeps the ribbon from reading as a smooth curve
    for (let i = 0; i < ARC_PTS; i++) {
      const t = i / ARC_SEG, env = Math.sin(t * Math.PI) * (0.08 + len * 0.055);
      const j1 = (Math.random() - 0.5) * 2 * env + (Math.random() - 0.5) * 0.03, j2 = (Math.random() - 0.5) * 2 * env + (Math.random() - 0.5) * 0.03;
      const e = (i === 0 || i === ARC_SEG) ? 0 : 1;
      arcPts[i * 3] = a.x + _u.x * len * t + (_w.x * j1 + _s.x * j2) * e;
      arcPts[i * 3 + 1] = a.y + _u.y * len * t + (_w.y * j1 + _s.y * j2) * e;
      arcPts[i * 3 + 2] = a.z + _u.z * len * t + (_w.z * j1 + _s.z * j2) * e;
    }
    const hw = 0.02 + len * 0.005;
    for (let i = 0; i < ARC_SEG; i++) {
      const o = i * 3, x0 = arcPts[o], y0 = arcPts[o + 1], z0 = arcPts[o + 2], x1 = arcPts[o + 3], y1 = arcPts[o + 4], z1 = arcPts[o + 5];
      // ribbon side = segment x (eye - midpoint); _p holds the eye in anomaly-local space
      _u.set(x1 - x0, y1 - y0, z1 - z0);
      _w.set(_p.x - (x0 + x1) * 0.5, _p.y - (y0 + y1) * 0.5, _p.z - (z0 + z1) * 0.5);
      _s.crossVectors(_u, _w); const sl = _s.length(); if (sl > 1e-6) _s.multiplyScalar(hw / sl); else _s.set(hw, 0, 0);
      const g0 = glow * (0.55 + 0.45 * Math.sin((i / ARC_SEG) * Math.PI)) * (0.7 + Math.random() * 0.5), g1 = glow * (0.55 + 0.45 * Math.sin(((i + 1) / ARC_SEG) * Math.PI)) * (0.7 + Math.random() * 0.5);
      let v = (base + i * 6) * 3, gi = base + i * 6;
      pos[v++] = x0 - _s.x; pos[v++] = y0 - _s.y; pos[v++] = z0 - _s.z; gl[gi++] = g0;
      pos[v++] = x0 + _s.x; pos[v++] = y0 + _s.y; pos[v++] = z0 + _s.z; gl[gi++] = g0;
      pos[v++] = x1 + _s.x; pos[v++] = y1 + _s.y; pos[v++] = z1 + _s.z; gl[gi++] = g1;
      pos[v++] = x0 - _s.x; pos[v++] = y0 - _s.y; pos[v++] = z0 - _s.z; gl[gi++] = g0;
      pos[v++] = x1 + _s.x; pos[v++] = y1 + _s.y; pos[v++] = z1 + _s.z; gl[gi++] = g1;
      pos[v++] = x1 - _s.x; pos[v++] = y1 - _s.y; pos[v++] = z1 - _s.z; gl[gi++] = g1;
    }
  }
  rebuildArcs() {
    this.arcK = 0;
    _p.copy(this.ctx.player.eye).sub(this.position);
    const strong = this.revealed;
    for (const [i, j] of this.pairs) this.writeArc(this.nodes[i].pos, this.nodes[j].pos, Math.random() < (strong ? 0.72 : 0.5), 1);
    for (const e of this.extra) { let bi = 0, bd = Infinity; for (let i = 0; i < this.nodes.length; i++) { const d = this.nodes[i].pos.distanceToSquared(e.pos); if (d < bd) { bd = d; bi = i; } } this.writeArc(this.nodes[bi].pos, e.pos, true, e.glow || 1); }
    while (this.arcK < this.maxArcs) this.writeArc(this.nodes[0].pos, this.nodes[0].pos, false, 0);
    const at = this.arcs.geometry.attributes; at.position.needsUpdate = true; at.aGlow.needsUpdate = true;
  }
  update(dt) {
    this.t += dt; this.cool -= dt; this.tickReveal(dt);
    const t = this.t;
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i];
      const a = nd.a + t * nd.sp, r = nd.r + Math.sin(t * 0.37 + nd.ph) * 0.35;
      nd.pos.set(Math.cos(a) * r, nd.h + Math.sin(t * 0.7 + nd.ph) * 0.22 + Math.sin(t * 2.3 + nd.ph * 2) * 0.03, Math.sin(a) * r);
    }
    for (let i = this.extra.length - 1; i >= 0; i--) { this.extra[i].t -= dt; if (this.extra[i].t <= 0) this.extra.splice(i, 1); }
    // the tell: unrevealed, a 0.1 s flicker every 5-10 s
    if (!this.revealed) { this.tellT -= dt; if (this.tellT <= 0) { this.tellT = this.rng.range(5, 10); this.flick = 0.1; if (this.dist < 45) this.play('arc_zap', { gain: 0.1, rate: 1.7 }); } }
    this.flick = Math.max(0, this.flick - dt);
    const show = this.revealed || this.flick > 0;
    if (show !== this.shown) this.setShown(show);
    if (!show) { this.sound('arc_hum', 0, false); return; }
    const gp = this.glow.geometry.attributes.position;
    for (let i = 0; i < this.nodes.length; i++) {
      const p = this.nodes[i].pos;
      _s.setScalar(0.9 + Math.random() * 0.25); _q.identity();
      _m.compose(p, _q, _s); this.nodeMesh.setMatrixAt(i, _m);
      gp.setXYZ(i, p.x, p.y, p.z);
    }
    this.nodeMesh.instanceMatrix.needsUpdate = true; gp.needsUpdate = true;
    const fade = this.revealed ? clamp01(this.revealT / 2.5) : 1;
    this.nodeMat.emissiveIntensity = (1.6 + Math.random() * 1.2) * fade;
    this.glowMat.opacity = (0.35 + Math.random() * 0.3) * fade;
    this.arcMat.uniforms.uOpacity.value = (0.7 + Math.random() * 0.3) * fade;
    // ground strikes: a node earths itself into the grass now and then; sparks and a hard little light
    if (this.revealed && fade > 0.5) {
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strikeT = 0.6 + Math.random() * 1.6;
        const nd = this.nodes[Math.floor(Math.random() * this.nodes.length)];
        const gx = nd.pos.x + (Math.random() - 0.5) * 1.6, gz = nd.pos.z + (Math.random() - 0.5) * 1.6;
        const gy = this.ctx.world.groundHeight(this.position.x + gx, this.position.z + gz, this.position.y + 3).y - this.position.y;
        this.extra.push({ pos: new THREE.Vector3(gx, gy + 0.02, gz), t: 0.09 + Math.random() * 0.06, glow: 1.3 });
        this.regen = 0;
        if (this.dist < 50) {
          _v.set(this.position.x + gx, this.position.y + gy + 0.02, this.position.z + gz);
          this.ctx.vfx.spark(_v, UP, 5, [0.6, 0.92, 1.0]);
          this.ctx.vfx.light(_v, 0x9ff0ff, 9, 0.09, 8);
          this.play('arc_zap', { gain: 0.22, rate: 1.35 + Math.random() * 0.3 });
        }
      }
    }
    if (--this.regen <= 0) { this.regen = 2 + Math.floor(Math.random() * 3); this.rebuildArcs(); }
    this.sound('arc_hum', 0.55 * fade, this.revealed);
    if (this.revealed && this.dist < 40 && Math.random() < 0.06) this.ctx.vfx.light(_v.copy(this.nodes[Math.floor(Math.random() * this.nodes.length)].pos).add(this.position), 0x7fe8ff, 6, 0.08, 9);
  }
  affectPlayer(dt) {
    if (this.cool > 0 || this.dist > this.radius) return;
    const ctx = this.ctx, pl = ctx.player;
    if (Math.abs(pl.position.y - this.position.y) > 4) return;
    this.cool = 3;
    this.reveal();
    this.extra.push({ pos: _v.copy(pl.eye).sub(this.position).clone(), t: 0.35, glow: 1.6 });
    this.extra.push({ pos: _v.copy(pl.position).sub(this.position).setY(0.9).clone(), t: 0.25, glow: 1.4 });
    this.regen = 0;
    this.play('arc_zap', { gain: 1.0 });
    _w.copy(pl.eye).addScaledVector(pl.forward, 0.6);
    ctx.vfx.light(_w, 0x9ff0ff, 60, 0.3, 20);
    _u.copy(pl.position); _u.y += 1.0;
    ctx.vfx.spark(_u, UP, 36, [0.55, 0.92, 1.0]);
    // kind 'anomaly' so the Committee's card reads anomalous exposure (the 'shock' line is written for Fragments)
    pl.damage(60, { kind: 'anomaly', what: 'electric', shock: true, bleed: false, anomaly: this });
    ctx.post.shock(0.8); ctx.post.shake(0.7);
    pl.lockMovement(0.6);
  }
}

// ---------- REFLECTOR ----------
class Reflector extends Anomaly {
  constructor(ctx, position, rng) {
    super(ctx, 'reflector', position, rng);
    const g = sharedGeo();
    this.radius = 6;
    const n = rng.int(3, 5);
    this.shards = [];
    let nO = 0, nI = 0;
    for (let i = 0; i < n; i++) {
      const kind = rng.chance(0.55) ? 0 : 1; if (kind === 0) nO++; else nI++;
      const s = {
        kind, idx: 0, size: rng.range(0.4, 0.9) * 0.5, orbitR: rng.range(1.2, 3.4), a: rng() * TAU, sp: rng.range(0.12, 0.4) * (rng.chance(0.5) ? 1 : -1),
        h: rng.range(1, 2.5), hph: rng() * TAU, axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(), rate: rng.range(0.15, 0.6),
        rot: new THREE.Quaternion(), pos: new THREE.Vector3(), home: new THREE.Vector3(), vel: new THREE.Vector3(),
        state: 'orbit', cool: rng.range(0, 1), windT: 0, flash: 0, travel: 0,
      };
      this.shards.push(s);
    }
    this.mat = shardMaterial();
    this.meshO = nO ? new THREE.InstancedMesh(g.octa, this.mat, nO) : null;
    this.meshI = nI ? new THREE.InstancedMesh(g.icosa, this.mat, nI) : null;
    let io = 0, ii = 0;
    for (const s of this.shards) s.idx = s.kind === 0 ? io++ : ii++;
    this.meshes = [this.meshO, this.meshI].filter(Boolean);
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.count * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.8, 0), 18);
      m.castShadow = true;
      this.root.add(m);
    }
    this.whipCool = 0; this.flashAll = 0;
  }
  onReveal() { this.flashAll = 3; this.play('reflector_whip', { gain: 0.35, rate: 0.7 }); }
  update(dt) {
    this.t += dt; this.tickReveal(dt); this.whipCool -= dt;
    this.flashAll = Math.max(0, this.flashAll - dt);
    const ctx = this.ctx, pl = ctx.player, t = this.t;
    const u = this.mat.uniforms;
    u.uHorizon.value.copy(ctx.lighting.horizon); u.uZenith.value.copy(ctx.lighting.zenith);
    u.uSunDir.value.copy(ctx.lighting.sunDir); u.uSunColor.value.copy(ctx.lighting.sunColor);
    u.uTime.value = t; u.uNight.value = ctx.time.night; u.uFlash.value = Math.pow(clamp01(this.flashAll / 3), 1.5) * (0.6 + 0.4 * Math.sin(t * 18));
    const near = this.dist < this.radius && Math.abs(pl.position.y - this.position.y) < 5;
    // launch one shard at a time
    if (near && this.whipCool <= 0) {
      let pick = null;
      for (const s of this.shards) if (s.state === 'orbit' && s.cool <= 0 && (!pick || s.cool < pick.cool)) pick = s;
      if (pick) { pick.state = 'wind'; pick.windT = 0.28; this.whipCool = 1.3; }
    }
    for (const s of this.shards) {
      s.cool -= dt;
      s.a += s.sp * dt;
      s.home.set(Math.cos(s.a) * s.orbitR, s.h + Math.sin(t * 0.6 + s.hph) * 0.25, Math.sin(s.a) * s.orbitR);
      _q.setFromAxisAngle(s.axis, s.rate * dt * (s.state === 'whip' ? 8 : 1)); s.rot.premultiply(_q);
      if (s.state === 'orbit') { s.pos.lerp(s.home, 1 - Math.exp(-4 * dt)); s.flash = Math.max(0, s.flash - dt * 2); }
      else if (s.state === 'wind') {
        s.windT -= dt; s.flash = Math.min(1, s.flash + dt * 5);
        s.pos.copy(s.home).addScaledVector(_v.copy(pl.eye).sub(this.position).sub(s.home).normalize(), -0.5 * (0.28 - s.windT) / 0.28);
        if (s.windT <= 0) {
          s.state = 'whip'; s.travel = 0;
          _v.copy(pl.eye).sub(this.position); _v.y -= 0.35;
          s.vel.subVectors(_v, s.pos).normalize().multiplyScalar(20);
          _w.copy(s.pos).add(this.position); ctx.audio.play('reflector_whip', { pos: _w, hrtf: true, gain: 0.9 });
        }
      } else if (s.state === 'whip') {
        s.pos.addScaledVector(s.vel, dt); s.travel += 20 * dt; s.flash = Math.max(0.35, s.flash - dt);
        // distance from the shard to the player capsule axis (feet -> feet + 1.7)
        _w.copy(s.pos).add(this.position);
        _u.copy(pl.position); const ay = clamp(_w.y - _u.y, 0, 1.7); _u.y += ay;
        const d = _w.distanceTo(_u);
        _v.copy(_u).sub(_w);
        if (d < 0.6 + pl.radius) {
          pl.damage(45, { kind: 'slash', anomaly: this, what: 'reflector' });
          ctx.post.shake(0.7); ctx.vfx.spark(_u, UP, 14, [0.8, 0.9, 1.0]);
          ctx.audio.play('impact_glass', { pos: _w, hrtf: true, gain: 0.7 });
          s.state = 'return'; s.cool = 2.5;
        } else if (s.travel > 14 || (_v.dot(s.vel) < 0 && d > 1.2)) { s.state = 'return'; s.cool = 2.5; }
      } else if (s.state === 'return') {
        _v.subVectors(s.home, s.pos); const d = _v.length();
        if (d < 0.2) { s.state = 'orbit'; } else s.pos.addScaledVector(_v.divideScalar(d), Math.min(d, 8 * dt));
        s.flash = Math.max(0, s.flash - dt * 1.5);
      }
      const m = s.kind === 0 ? this.meshO : this.meshI;
      _s.setScalar(s.size); _m.compose(s.pos, s.rot, _s); m.setMatrixAt(s.idx, _m);
      _c.setRGB(s.flash, 0, 0); m.setColorAt(s.idx, _c);
    }
    for (const m of this.meshes) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    this.sound('reflector_hum', 0.3 + 0.2 * clamp01(this.flashAll));
  }
}

// ---------- GRAVITY ----------
class Gravity extends Anomaly {
  constructor(ctx, position, rng) {
    super(ctx, 'gravity', position, rng);
    const g = sharedGeo();
    this.radius = rng.range(6, 8);
    const n = rng.int(12, 20);
    this.chunks = [];
    for (let i = 0; i < n; i++) {
      this.chunks.push({
        r: rng.range(1, 4), a: rng() * TAU, h: rng.range(0.3, 2.6), hph: rng() * TAU, scale: rng.range(0.055, 0.2),
        rot: new THREE.Euler(rng() * TAU, rng() * TAU, rng() * TAU), spin: new THREE.Vector3(rng.range(-2, 2), rng.range(-2, 2), rng.range(-2, 2)),
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), state: 'orbit', dir: rng.chance(0.8) ? 1 : -1,
      });
    }
    this.mesh = new THREE.InstancedMesh(g.rock, rockMaterial(), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (let i = 0; i < n; i++) {
      const k = rng();
      if (k < 0.4) _c.setRGB(0.36, 0.34, 0.31); else if (k < 0.7) _c.setRGB(0.42, 0.26, 0.15); else if (k < 0.85) _c.setRGB(0.3, 0.32, 0.26); else _c.setRGB(0.5, 0.48, 0.44);
      _c.multiplyScalar(rng.range(0.75, 1.15)); this.mesh.setColorAt(i, _c);
    }
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), this.radius + 3);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.crushT = 0; this.crushSoundT = 0; this.dustBoost = 0;
    this.fieldMul = 1;
  }
  onReveal(at) {
    this.dustBoost = 20;
    const v = this.ctx.vfx; _v.copy(this.position); _v.y += 1.0;
    v.dustPuff(_v, UP, 30, [0.3, 0.29, 0.26], 0.9);
    v.light(_v, 0x8a9098, 4, 0.4, 12);
  }
  update(dt) {
    this.t += dt; this.tickReveal(dt);
    this.dustBoost = Math.max(0, this.dustBoost - dt);
    const t = this.t, R = this.radius;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c.state === 'orbit') {
        c.r -= dt * (0.12 + 0.5 * clamp01(1 - c.r / 4));
        const w = (0.5 + 2.6 / Math.max(c.r, 0.3)) * c.dir;
        c.a += w * dt;
        const hh = c.h * clamp01(c.r / 3) + 0.25 + Math.sin(t * 0.9 + c.hph) * 0.15;
        c.pos.set(Math.cos(c.a) * c.r, hh, Math.sin(c.a) * c.r);
        if (c.r < 0.5) {
          c.state = 'spit';
          const ang = c.a + Math.PI * 0.5 * c.dir + (Math.random() - 0.5) * 0.8;
          c.vel.set(Math.cos(ang) * (4 + Math.random() * 4), 3.5 + Math.random() * 3.5, Math.sin(ang) * (4 + Math.random() * 4));
          c.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
        }
      } else {
        c.vel.y -= 9.8 * dt; c.vel.multiplyScalar(1 - dt * 0.6);
        c.pos.addScaledVector(c.vel, dt);
        const rr = Math.hypot(c.pos.x, c.pos.z);
        if (c.pos.y < 0.25 || rr > R * 0.62) {
          c.state = 'orbit'; c.r = clamp(rr, 2.6, 4); c.a = Math.atan2(c.pos.z, c.pos.x); c.h = 0.3 + Math.random() * 2.2;
          c.spin.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
        }
      }
      c.rot.x += c.spin.x * dt; c.rot.y += c.spin.y * dt; c.rot.z += c.spin.z * dt;
      _q.setFromEuler(c.rot); _s.setScalar(c.scale); _m.compose(c.pos, _q, _s); this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    // dust streaming inward
    if (this.dist < 60) {
      const v = this.ctx.vfx, now = this.ctx.elapsed;
      const n = (this.dist < 30 ? 3 : 1) + (this.dustBoost > 0 ? 4 : 0);
      for (let k = 0; k < n; k++) {
        const ang = Math.random() * TAU, d = R * (0.55 + Math.random() * 0.55), y = 0.1 + Math.random() * 2.2;
        const x = this.position.x + Math.cos(ang) * d, z = this.position.z + Math.sin(ang) * d;
        const sh = 0.28 + Math.random() * 0.14;
        // kind-1 particles travel vel/2 in total (drag in the shader): aim past the centre so they reach it
        v.dust.emit(x, this.position.y + y, z, -Math.cos(ang) * d * 1.9, (0.8 - y) * 0.9, -Math.sin(ang) * d * 1.9, sh, sh * 0.97, sh * 0.9, 1.3 + Math.random() * 0.7, 0.18 + Math.random() * 0.2, -0.05, 1, now);
      }
    }
    this.fieldMul = 1 + (this.dustBoost > 0 ? 0.35 : 0);
    this.sound('gravity_drone', 0.6 + 0.3 * clamp01(this.dustBoost));
  }
  affectPlayer(dt) {
    const ctx = this.ctx, pl = ctx.player;
    this.blurWant = 0;
    if (this.dist > 8 || Math.abs(pl.position.y - this.position.y) > 4) { this.crushT = 0; return; }
    const d = this.dist;
    _v.set(this.position.x - pl.position.x, 0, this.position.z - pl.position.z);
    if (d > 0.05) _v.divideScalar(d);
    const k = lerp(18, 6, clamp01((d - 1.5) / 6.5));
    pl.velocity.addScaledVector(_v, k * PULL_GAIN * dt);
    ctx.post.shake(0.04 + 0.12 * (1 - d / 8));
    if (d < 1.5) {
      this.blurWant = 0.8;
      this.crushT += dt; this.crushSoundT -= dt;
      if (this.crushSoundT <= 0) { this.crushSoundT = 0.9; this.play('gravity_crush', { gain: 0.9 }); }
      if (this.crushT >= 0.5) { this.crushT -= 0.5; pl.damage(15, { kind: 'anomaly', what: 'crush', bleed: false, anomaly: this }); }
    } else { this.crushT = 0; this.crushSoundT = 0; }
  }
}

// ---------- GAS ----------
class Gas extends Anomaly {
  constructor(ctx, position, rng) {
    super(ctx, 'gas', position, rng);
    const g = sharedGeo();
    this.radius = rng.range(5, 8);
    const n = rng.int(2, 4);
    this.vents = [];
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.range(-0.6, 0.6), d = i === 0 ? rng.range(0, 1.2) : rng.range(1.5, this.radius * 0.55);
      const x = this.position.x + Math.cos(a) * d, z = this.position.z + Math.sin(a) * d;
      const y = ctx.world.groundHeight(x, z, this.position.y + 2).y;
      const r = rng.range(0.3, 0.55);
      this.vents.push({ x, y, z, r, ph: rng() * TAU, rate: rng.range(0.6, 1.1) });
      parts.push(this.ventGeometry(x - this.position.x, y - this.position.y + 0.02, z - this.position.z, r, rng));
    }
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    this.ventMesh = new THREE.Mesh(merged, ventMaterial()); this.ventMesh.receiveShadow = true;
    this.root.add(this.ventMesh);
    // fog volume: the visual core is radius / 1.3; the burn reaches out to the full radius, past what you can see
    this.gasMat = gasMaterial(rng() * 100);
    this.blob = new THREE.Mesh(g.blob, this.gasMat);
    const core = this.radius / 1.3, ys = 0.5;
    this.blob.scale.set(core, core * ys, core);
    this.blob.position.y = core * ys * 0.35;
    this.blob.renderOrder = 2;
    this.gasMat.uniforms.uBase.value = this.position.y; this.gasMat.uniforms.uHeight.value = core * ys * 1.45;
    this.root.add(this.blob);
    this.burnT = 0; this.coughT = 0; this.inside = false;
  }
  // a scorched rim (ring, sunk toward the hole) + the hole (dark disc), vertex-coloured
  ventGeometry(x, y, z, r, rng) {
    const seg = 22, rings = 4;
    const outer = r * 2.6;
    const pos = [], col = [], idx = [];
    const push = (px, py, pz, c) => { pos.push(px, py, pz); col.push(c[0], c[1], c[2]); };
    // centre (hole)
    push(x, y - r * 0.6, z, [0.02, 0.02, 0.022]);
    for (let j = 0; j < rings; j++) {
      const f = j / (rings - 1);
      const rr = lerp(r * 0.55, outer, f * f);
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TAU, wob = 1 + (rng() - 0.5) * 0.18 * f;
        const px = x + Math.cos(a) * rr * wob, pz = z + Math.sin(a) * rr * wob;
        const py = y + (j === 0 ? -r * 0.35 : j === 1 ? 0.06 * r : 0.02 - f * 0.02) + (rng() - 0.5) * 0.02;
        const crust = rng();
        let c;
        if (j === 0) c = [0.05, 0.045, 0.04];
        else if (j === 1) c = crust < 0.45 ? [0.5, 0.44, 0.16] : [0.13, 0.11, 0.08];
        else if (j === 2) c = crust < 0.3 ? [0.32, 0.3, 0.13] : [0.16, 0.14, 0.11];
        else c = [0.2, 0.2, 0.15];
        push(px, py, pz, c);
      }
    }
    for (let i = 0; i < seg; i++) { idx.push(0, 1 + ((i + 1) % seg), 1 + i); }
    for (let j = 0; j < rings - 1; j++) for (let i = 0; i < seg; i++) {
      const a = 1 + j * seg + i, b = 1 + j * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  onReveal() { /* always visible: a reveal only thickens the hiss for a while */ }
  update(dt) {
    this.t += dt; this.tickReveal(dt);
    const ctx = this.ctx, t = this.t, u = this.gasMat.uniforms;
    u.uTime.value = t; u.uNight.value = ctx.time.night; u.uHorizon.value.copy(ctx.lighting.horizon);
    u.uTorch.value = ctx.state.data.flashlight.on ? 1 : 0; ctx.camera.getWorldDirection(u.uCamFwd.value);
    // steam: a shared pool feeds every puff in the zone, so the rate steps down with distance
    const every = this.dist < 30 ? 1 : this.dist < 55 ? 2 : 4;
    if (this.dist < 80 && (ctx.frame % every) === 0) {
      const v = ctx.vfx, now = ctx.elapsed;
      const wx = Math.sin(t * 0.13) * 0.35 + 0.22, wz = Math.cos(t * 0.09) * 0.3;
      for (const vt of this.vents) {
        if (Math.random() > 0.5 * vt.rate) continue;
        const a = Math.random() * TAU, rr = Math.random() * vt.r * 0.6;
        const sh = 0.8 + Math.random() * 0.15;
        v.dust.emit(vt.x + Math.cos(a) * rr, vt.y + 0.05, vt.z + Math.sin(a) * rr, (Math.random() - 0.5) * 0.5 + wx * 2, 1.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5 + wz * 2, 0.85 * sh, 0.82 * sh, 0.6 * sh, 2.2 + Math.random() * 1.6, 0.45 + Math.random() * 0.45, -0.06, 1, now);
      }
    }
    this.sound('gas_hiss', 0.5 + 0.25 * clamp01(this.revealT));
  }
  affectPlayer(dt) {
    const ctx = this.ctx, pl = ctx.player;
    this.blurWant = 0;
    const inside = this.dist < this.radius && pl.position.y > this.position.y - 2 && pl.position.y < this.position.y + this.radius * 0.6;
    if (!inside) { this.inside = false; this.burnT = 0; this.coughT = 0.4; return; }
    if (!this.inside) { this.inside = true; this.coughT = 0.6; this.reveal(); }
    this.blurWant = 0.6;
    this.burnT += dt; this.coughT -= dt;
    if (this.coughT <= 0) { this.coughT = 3; ctx.audio.play('gas_cough', { gain: 0.8 }); }
    if (this.burnT >= 1) { this.burnT -= 1; pl.damage(8, { kind: 'burn', bleed: false, anomaly: this, what: 'gas' }); }
  }
}

const CLASSES = { electric: Electric, reflector: Reflector, gravity: Gravity, gas: Gas };
const TYPES = ['electric', 'reflector', 'gravity', 'gas'];

export function createAnomalies(ctx) {
  const list = [];
  const field = { strength: 0, sx: 0.5, sy: 0.5, aberration: 0 };
  let spawnSalt = 0, populated = false;

  function groundPos(x, z) {
    const y = ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 3).y;
    return new THREE.Vector3(x, y, z);
  }
  function farFromOthers(x, z, r) {
    for (const a of list) { const d = Math.hypot(a.position.x - x, a.position.z - z); if (d < Math.max(12, a.radius + r + 2)) return false; }
    return true;
  }
  function placeable(x, z) {
    const w = ctx.world, M = w.map;
    if (Math.abs(x) > M.HALF - 10 || Math.abs(z) > M.HALF - 10) return false;
    if (w.isWater(x, z)) return false;
    const y = w.getHeight(x, z);
    if (y < M.WATER_LEVEL + 0.3) return false;
    if (w.pointInSolid(x, y + 0.6, z) || w.pointInSolid(x, y + 1.6, z)) return false;
    if (Math.hypot(x - M.BASE.x, z - M.BASE.z) < 70) return false;
    if (Math.hypot(x - M.START.x, z - M.START.z) < 50) return false;
    return true;
  }

  const api = {
    list,
    spawn(type, position) {
      const C = CLASSES[type]; if (!C) return null;
      const rng = ctx.rng.fork(0x9a00 + (spawnSalt++) * 7 + (ctx.state.data.tideLevel | 0) * 101);
      const pos = groundPos(position.x, position.z);
      const a = new C(ctx, pos, rng);
      a.dist = Math.hypot(pos.x - ctx.player.position.x, pos.z - ctx.player.position.z);
      list.push(a);
      return a;
    },
    populate() {
      api.reset();
      const d = ctx.state.data, M = ctx.world.map;
      const rng = ctx.rng.fork(0x2a7 + (d.tideLevel | 0) * 17 + ((d.stats && d.stats.tides) | 0) * 3);
      spawnSalt = (d.tideLevel | 0) * 50;
      for (const poi of M.POIS) {
        if (poi.kind !== 'anomaly') continue;
        const n = rng.int(3, 5);
        let placed = 0;
        // inside the field first; if the field is flooded (the terrain drowns some of them) walk outward ring by ring
        // so the anomalies gather on the nearest shore instead of vanishing
        for (let ring = 0; ring < 4 && placed < n; ring++) {
          const r0 = ring === 0 ? 0 : poi.r * (0.85 + 0.45 * (ring - 1)), r1 = poi.r * (0.85 + 0.45 * ring);
          for (let tries = 0; tries < 60 && placed < n; tries++) {
            const ang = rng() * TAU, dd = ring === 0 ? Math.sqrt(rng()) * r1 : lerp(r0, r1, rng());
            const x = poi.x + Math.cos(ang) * dd, z = poi.z + Math.sin(ang) * dd;
            if (!placeable(x, z) || !farFromOthers(x, z, 7)) continue;
            api.spawn(poi.anomaly, _v.set(x, 0, z)); placed++;
          }
        }
      }
      // strays: two of random type near roads, well away from the base
      let strays = 0;
      for (let tries = 0; tries < 80 && strays < 2; tries++) {
        const road = rng.pick(M.ROADS);
        const p = M.pointOnPolyline(road.pts, rng());
        const side = rng.chance(0.5) ? 1 : -1, off = rng.range(4, 12);
        const x = p.x - p.dz * off * side, z = p.z + p.dx * off * side;
        if (Math.hypot(x - M.BASE.x, z - M.BASE.z) < 120) continue;
        if (!placeable(x, z) || !farFromOthers(x, z, 7)) continue;
        api.spawn(rng.pick(TYPES), _v.set(x, 0, z)); strays++;
      }
      populated = true;
    },
    reset() {
      for (const a of list) a.dispose();
      list.length = 0;
      ctx.post.setAnomaly(0, 0.5, 0.5, 0); ctx.post.setBlur(0);
    },
    // strongest anomaly within FIELD_D of pos, projected to screen uv. Returns a reused object.
    fieldAt(pos) {
      let best = null, bs = 0;
      for (const a of list) {
        const dx = a.position.x - pos.x, dz = a.position.z - pos.z, dy = a.position.y + 1 - pos.y;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= FIELD_D) continue;
        const s = Math.pow(1 - d / FIELD_D, 1.5) * (FIELD[a.type] || 0.3) * a.fieldMul;
        if (s > bs) { bs = s; best = a; }
      }
      if (!best) { field.strength = 0; field.sx = 0.5; field.sy = 0.5; field.aberration = 0; return field; }
      _v.copy(best.position); _v.y += 1.2;
      _w.copy(_v).applyMatrix4(ctx.camera.matrixWorldInverse);
      if (_w.z > -0.1) { field.strength = bs * 0.3; field.sx = 0.5; field.sy = 0.5; }
      else { _v.project(ctx.camera); field.strength = bs; field.sx = clamp((_v.x + 1) * 0.5, 0, 1); field.sy = clamp((_v.y + 1) * 0.5, 0, 1); }
      field.aberration = field.strength * 0.5;
      return field;
    },
    nearestDistance(pos) {
      let bd = Infinity;
      for (const a of list) { const d = Math.hypot(a.position.x - pos.x, a.position.z - pos.z); if (d < bd) bd = d; }
      return bd;
    },
    update(dt) {
      const p = ctx.player.position;
      let blur = 0;
      for (const a of list) {
        const d = Math.hypot(a.position.x - p.x, a.position.z - p.z);
        a.dist = d;
        if (d > ACTIVE_D) { if (a.loop) { a.loop.stop(0.8); a.loop = null; } a.root.visible = a.type === 'gas'; a.notified = false; continue; }
        a.root.visible = true;
        a.update(dt);
        if (!ctx.player.dead && dt > 0) a.affectPlayer(dt); else a.blurWant = 0;
        if (a.blurWant > blur) blur = a.blurWant;
        if (d < FIELD_D && !a.notified) { a.notified = true; ctx.director.notify('anomaly', { distance: d, type: a.type, anomaly: a }); }
        else if (d > 20) a.notified = false;
      }
      ctx.post.setBlur(ctx.player.dead ? 0 : blur);
      const f = api.fieldAt(ctx.player.eye);
      ctx.post.setAnomaly(f.strength, f.sx, f.sy, f.aberration);
    },
  };
  ctx.events.on('gameStart', () => api.populate());
  ctx.events.on('tide', () => api.populate());
  return api;
}
