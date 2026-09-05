// Fragment — a glass sphere the size of a head with a slow pink-white pulse inside. It drifts a lazy figure
// near the anomaly fields and, when it sees you, comes to touch you: faster and faster, the pulse and the chime
// quickening, until it goes off against your chest. One round pops it. The most beautiful thing in the zone.
//
// Build: a refractive MeshPhysicalMaterial shell (transmission, one shared material), an emissive HDR core with
// a slow internal swirl (bloom catches it), a fog-attenuated additive glow quad turned to the camera, and a
// pink PointLight that breathes with the pulse and pools on the ground under it.
import * as THREE from 'three';
import { Enemy } from './common.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { glowTexture } from '../render/textures.js';
import { clamp, clamp01, damp, lerp, TAU } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3();
const PINK = new THREE.Color(0xff6fa8), WHITE = new THREE.Color(0xfff4f8);
const R_HIT = 0.3, R_SHELL = 0.135, R_CORE = 0.058;

// ---- shared geometry / shell material ----
let shellGeo = null, coreGeo = null, glowGeo = null, shellMat = null;
function shared() {
  if (shellGeo) return;
  shellGeo = new THREE.SphereGeometry(R_SHELL, 30, 22); shellGeo.userData.shared = true;
  coreGeo = new THREE.SphereGeometry(R_CORE, 20, 14); coreGeo.userData.shared = true;
  glowGeo = new THREE.PlaneGeometry(1, 1); glowGeo.userData.shared = true;
  shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xf6f1f5, roughness: 0.05, metalness: 0, transmission: 0.9, thickness: 0.3, ior: 1.5,
    iridescence: 0.28, iridescenceIOR: 1.25, iridescenceThicknessRange: [140, 460],
    specularIntensity: 1.0, specularColor: 0xffffff, attenuationColor: 0xffd6e6, attenuationDistance: 0.6,
  });
  shellMat.userData.shared = true;
}

// ---- core: HDR pink-white with a slow swirl inside, brightest at the centre of the disc ----
const CORE_VERT = /* glsl */`
  varying vec3 vN, vObj, vV;
  #include <fog_pars_vertex>
  void main(){
    vObj = position; vN = normalize(normalMatrix * normal);
    vec3 transformed = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
    #include <fog_vertex>
  }`;
const CORE_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime, uPulse, uIntensity, uSeed; uniform vec3 uColorA, uColorB;
  varying vec3 vN, vObj, vV;
  #include <fog_pars_fragment>
  void main(){
    vec3 n = normalize(vN), v = normalize(vV);
    float facing = max(dot(n, v), 0.0);
    float centre = pow(facing, 1.7);
    float swirl = fbm3d(vObj * 19.0 + vec3(uSeed, uTime * 0.33, -uTime * 0.21));
    float veins = smoothstep(0.34, 0.74, swirl);
    vec3 col = mix(uColorA, uColorB, clamp(uPulse * 0.75 + veins * 0.3, 0.0, 1.0));
    float br = uIntensity * (0.5 + 0.5 * centre) * (0.78 + 0.5 * veins);
    gl_FragColor = vec4(col * br, 1.0);
    #include <fog_fragment>
  }`;
// ---- glow quad: additive, radial from the shared glow texture, attenuated by the same fog as everything else ----
const GLOW_VERT = /* glsl */`
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main(){ vUv = uv; vec3 transformed = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
    #include <fog_vertex>
  }`;
const GLOW_FRAG = /* glsl */`
  uniform sampler2D uMap; uniform float uAlpha; uniform vec3 uColor; varying vec2 vUv;
  #include <fog_pars_fragment>
  void main(){
    float a = texture2D(uMap, vUv).a;
    float f = 1.0 - clamp(radiusFog(vec3(1.0)).g - radiusFog(vec3(0.0)).g, 0.0, 1.0);
    gl_FragColor = vec4(uColor * a * a * uAlpha * (1.0 - f), 1.0);
  }`;
function fogged(u) { return Object.assign(u, fogUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog)); }

let rng = null;
class Fragment extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'fragment', position, Object.assign({ hp: 1 }, opts));
    shared();
    this.flying = true; this.radius = R_HIT; this.height = R_HIT * 2; this.speed = 1;
    this.home.copy(this.position);                       // ground point of the orbit
    this.position.y += rng.range(1.3, 2.4);
    this.groundY = this.home.y;
    // ---- visuals ----
    this.shell = new THREE.Mesh(shellGeo, shellMat); this.shell.castShadow = false; this.shell.renderOrder = 2;
    this.coreMat = new THREE.ShaderMaterial({ uniforms: fogged({ uTime: { value: 0 }, uPulse: { value: 0 }, uIntensity: { value: 2 }, uSeed: { value: rng.range(0, 40) }, uColorA: { value: PINK.clone() }, uColorB: { value: WHITE.clone() } }), vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, fog: true });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.glowMat = new THREE.ShaderMaterial({ uniforms: fogged({ uMap: { value: glowTexture() }, uAlpha: { value: 0.5 }, uColor: { value: PINK.clone() } }), vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.glow = new THREE.Mesh(glowGeo, this.glowMat); this.glow.renderOrder = 6; this.glow.frustumCulled = false;
    this.light = new THREE.PointLight(0xff8ac8, 3, 7, 2); this.light.castShadow = false;
    this.root.add(this.shell, this.core, this.glow, this.light);
    // ---- motion ----
    this.orbitT = rng.range(0, 100);
    this.ax = rng.range(3, 6); this.az = rng.range(3, 6); this.orbitSpeed = rng.range(0.6, 1.2);
    this.wx = (this.orbitSpeed / this.ax) * rng.range(0.85, 1.15); this.wz = (this.orbitSpeed / this.az) * rng.range(0.85, 1.15); this.wy = rng.range(0.14, 0.3);
    this.p1 = rng.range(0, TAU); this.p2 = rng.range(0, TAU); this.p3 = rng.range(0, TAU);
    this.vel = new THREE.Vector3(); this.spin = rng.range(0.25, 0.5) * (rng.chance(0.5) ? 1 : -1);
    this.pulsePhase = rng.range(0, 1); this.period = 1.8; this.pulse = 0;
    this.losT = 0; this.los = false; this.lostT = 0; this.chime = null; this.loopRetry = 0; this.approached = false;
    this.deathDuration = 0.45; this.exploded = false;
    this.tilt = rng.range(0, TAU);
    this.setState('orbit');
    this.syncVisuals(0, this.distanceToPlayer());
  }
  // ray vs sphere
  hitTest(origin, dir, maxDist) {
    _v.subVectors(this.position, origin);
    const tc = _v.dot(dir);
    const d2 = _v.lengthSq() - tc * tc;
    if (d2 > R_HIT * R_HIT) return -1;
    const th = Math.sqrt(R_HIT * R_HIT - d2);
    let t = tc - th;
    if (t < 0) { if (tc + th < 0) return -1; t = 0; }
    return t <= maxDist ? t : -1;
  }
  setEngaged(v) {
    if (v && !this.engaged) { this.engaged = true; this.aware = 1; this.ctx.director?.notify('spotted', { enemy: this }); }
    else if (!v && this.engaged) { this.engaged = false; this.ctx.director?.notify('lost', { enemy: this }); }
  }
  playerVisible() {
    const p = this.player; if (p.dead || p.inBase) return false;
    _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.7, p.position.z);
    return this.ctx.world.lineOfSight(this.position, _v2) || this.ctx.world.lineOfSight(this.position, p.eye);
  }
  explode() {
    if (this.exploded || !this.alive) return;
    this.exploded = true;
    const ctx = this.ctx;
    ctx.vfx.explosion(this.position, 3, 0xff8ac8);
    ctx.post.shock(1);
    this.sound('fragment_explode', { gain: 1.0, max: 120, ref: 4 });
    this.hurtPlayer(40, 'shock');
    this.kill({ kind: 'shock', self: true });
  }
  onDeath(info) {
    this.shell.visible = this.core.visible = this.glow.visible = false;
    this.lightPeak = this.light.intensity;
    if (info?.self) { this.light.intensity = 40; this.lightPeak = 40; return; }
    // shot: cold glass and a pink flash
    this.ctx.vfx.shatter(this.position, [1.0, 0.72, 0.9]);
    this.ctx.vfx.light(this.position, 0xff9ad0, 18, 0.3, 9);
    this.sound('fragment_pop', { gain: 0.9, max: 90, ref: 3 });
    this.setEngaged(false);
  }
  deathTick(dt) { const k = 1 - this.deathT / this.deathDuration; this.light.intensity = (this.lightPeak || 4) * k * k; }
  onDispose() { this.coreMat.dispose(); this.glowMat.dispose(); }

  tick(dt) {
    const ctx = this.ctx, p = this.player, w = ctx.world, t = this.time;
    const d = this.distanceToPlayer();
    // line of sight, throttled
    this.losT -= dt; if (this.losT <= 0) { this.losT = 0.15; this.los = d < 25 && this.playerVisible(); }
    switch (this.state) {
      case 'orbit': {
        this.orbitT += dt;
        const ox = this.home.x + this.ax * Math.sin(this.wx * this.orbitT + this.p1), oz = this.home.z + this.az * Math.sin(this.wz * this.orbitT + this.p2);
        const oy = w.getHeight(ox, oz) + lerp(1.2, 2.6, 0.5 + 0.5 * Math.sin(this.wy * this.orbitT + this.p3));
        if (!w.pointInSolid(ox, oy, oz)) { this.position.x = damp(this.position.x, ox, 1.6, dt); this.position.y = damp(this.position.y, oy, 1.6, dt); this.position.z = damp(this.position.z, oz, 1.6, dt); }
        else this.orbitT += dt * 3;
        this.vel.multiplyScalar(Math.exp(-dt * 2));
        this.period = damp(this.period, 1.8, 2, dt);
        this.aware = damp(this.aware, d < 30 ? 0.35 : 0, 0.7, dt);
        if (this.los) { this.setState('attracted'); this.setEngaged(true); this.lostT = 0; if (!this.approached) { this.approached = true; this.sound('fragment_approach', { gain: 0.9, max: 60, ref: 3 }); } }
        break;
      }
      case 'attracted': {
        // accelerate toward the chest; homing damps the sideways drift
        _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.72, p.position.z);
        _dir.subVectors(_v3, this.position); const dist = _dir.length() || 1; _dir.divideScalar(dist);
        if (this.los) {
          this.lostT = 0;
          this.vel.addScaledVector(_dir, 1.6 * dt);
          const along = this.vel.dot(_dir);
          _v.copy(this.vel).addScaledVector(_dir, -along);          // lateral part
          this.vel.addScaledVector(_v, -clamp01(dt * 1.2));
        } else { this.lostT += dt; this.vel.multiplyScalar(Math.exp(-dt * 1.1)); }
        const sp = this.vel.length(); if (sp > 6) this.vel.multiplyScalar(6 / sp);
        _v.copy(this.position).addScaledVector(this.vel, dt);
        const gy = w.getHeight(_v.x, _v.z) + 0.5;
        if (_v.y < gy) { _v.y = gy; this.vel.y = Math.max(0, this.vel.y); }
        if (!w.pointInSolid(_v.x, _v.y, _v.z)) this.position.copy(_v);
        else { this.vel.multiplyScalar(0.2); this.position.y += 0.6 * dt; }
        // the pulse quickens: 1.8 s at 25 m to 0.25 s at 1 m
        this.period = damp(this.period, lerp(0.25, 1.8, clamp01((dist - 1) / 24)), 6, dt);
        if (!this.approached) { this.approached = true; this.sound('fragment_approach', { gain: 0.9, max: 60, ref: 3 }); }
        // contact
        if (!p.dead && !p.inBase && (this.position.distanceTo(p.eye) < 0.75 || this.position.distanceTo(_v3) < 0.75)) { this.explode(); return; }
        if (this.lostT > 3 || d > 40 || p.dead) { this.setState('orbit'); this.setEngaged(false); this.aware = 0.3; this.home.set(this.position.x, w.getHeight(this.position.x, this.position.z), this.position.z); this.orbitT = 0; this.p1 = 0; this.p2 = 0; this.p3 = -Math.PI / 2; this.approached = false; }
        break;
      }
    }
    this.groundY = w.getHeight(this.position.x, this.position.z);
    this.yaw += this.spin * dt;
    this.pulsePhase += dt / Math.max(0.05, this.period);
    this.syncVisuals(dt, d);
  }
  syncVisuals(dt, d) {
    const t = this.time;
    const raw = 0.5 + 0.5 * Math.sin(this.pulsePhase * TAU);
    const pulse = this.pulse = Math.pow(raw, 2.4);
    const near = clamp01(1 - (this.period - 0.25) / 1.55);
    // core: 1.5..4.5 emissive intensity (bloom threshold is high), pinker when slow, whiter when it beats fast
    const cu = this.coreMat.uniforms;
    cu.uTime.value = t; cu.uPulse.value = pulse * (0.6 + 0.4 * near); cu.uIntensity.value = 1.5 + 3.0 * pulse;
    // glow quad: faces the camera, breathes with the pulse
    const gs = 0.55 + 0.75 * pulse + near * 0.25;
    this.glow.scale.set(gs, gs, 1);
    this.glow.lookAt(this.ctx.player.eye);
    this.glowMat.uniforms.uAlpha.value = 0.28 + 0.55 * pulse;
    this.glowMat.uniforms.uColor.value.copy(PINK).lerp(WHITE, pulse * 0.5);
    // light: 2..5, pink, only paid for when you are near enough to see it
    this.light.intensity = 2 + 3 * pulse;
    this.light.visible = d < 45;
    this.light.color.copy(PINK).lerp(WHITE, pulse * 0.35);
    // the shell rolls slowly, and the core wobbles inside it
    this.tilt += dt * 0.3;
    this.shell.rotation.set(Math.sin(this.tilt) * 0.4, this.tilt * 0.5, Math.cos(this.tilt * 0.7) * 0.3);
    this.core.position.set(Math.sin(t * 1.3 + this.p1) * 0.02, Math.sin(t * 0.9 + this.p2) * 0.02, Math.cos(t * 1.1 + this.p3) * 0.02);
    const cs = 0.92 + 0.14 * pulse; this.core.scale.setScalar(cs);
    // the chime follows the pulse
    if (!this.chime) { this.loopRetry -= dt; if (this.loopRetry <= 0) { this.loopRetry = 1; if (this.ctx.audio.ready) this.chime = this.loopSound('fragment_chime', { gain: 0.35, max: 70, ref: 3 }); } }
    if (this.chime) { this.chime.set('rate', 1 / Math.max(0.05, this.period)); this.chime.set('pulse', pulse); this.chime.set('near', near); this.chime.setGain(this.state === 'attracted' ? 0.9 : 0.4, 0.3); }
  }
}

export function registerFragment(ctx) {
  rng = ctx.rng.fork(43);
  // refraction reads a half-resolution copy of the opaque scene: cheaper, and the glass is small
  if ('transmissionResolutionScale' in ctx.renderer) ctx.renderer.transmissionResolutionScale = 0.5;
  ctx.enemies.registerType('fragment', Fragment);
}
