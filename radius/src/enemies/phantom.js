// Phantom — a mimic you cannot see. A human shape made of the air behind it: a heat-shimmer silhouette that
// bends what is behind it and catches a thread of light along its edges, and nothing else. It keeps to the
// corner of your eye, fifteen to thirty metres out, never in front of you; when you turn, it is already going.
// It closes in silence, screams at eight metres (the one time you see it plainly), rushes, takes you by the
// chest and drags you two metres toward it, and is gone before you can bring the gun round. Night vision shows
// it as a bright figure. HP 70; it shatters like glass and screams once more when it dies.
//
// Body: the mimic's skinned humanoid rig (no rifle) in a transmission material (MeshPhysicalMaterial,
// transmission 1, roughness 0.15, thickness 0.6, ior 1.35, no colour) plus a second skinned mesh on the same
// skeleton: an additive fresnel rim with a slow shimmer band. In night vision both are swapped for a bright
// white-green solid. Hits and screams reveal it for half a second (the rim flares, the glass clouds).
import * as THREE from 'three';
import { Enemy } from './common.js';
import { Rig, BODY_PARTS } from './mimic.js';
import { fogUniforms } from '../render/fog.js';
import { clamp, clamp01, damp, dampAngle, angleDelta, lerp, TAU, DEG } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _cam = new THREE.Vector3(), _cand = new THREE.Vector3();
const PERIPHERY = 40 * DEG, REPOSITION = 58 * DEG;
const RIM_COLOR = new THREE.Color(0.62, 0.86, 1.0);

// ---- the rim: additive fresnel on the skinned body, fogged like everything else ----
const RIM_VERT = /* glsl */`
  #include <common>
  #include <skinning_pars_vertex>
  #include <fog_pars_vertex>
  uniform float uTime, uShimmer;
  varying vec3 vNw, vWp;
  void main(){
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    transformed += objectNormal * sin(uTime * 21.0 + position.y * 15.0 + position.x * 9.0) * 0.006 * uShimmer;
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vWp = wp.xyz; vNw = normalize(mat3(modelMatrix) * objectNormal);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <fog_vertex>
  }`;
const RIM_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uRim, uTime;
  varying vec3 vNw, vWp;
  #include <fog_pars_fragment>
  void main(){
    vec3 N = normalize(vNw);
    vec3 V = normalize(cameraPosition - vWp);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float f = pow(1.0 - ndv, 3.2);
    float band = 0.7 + 0.3 * sin(vWp.y * 11.0 - uTime * 5.0);
    vec3 col = uColor * f * uRim * band;
    // an additive layer dies into the fog rather than taking its colour
    float k = 1.0 - clamp(radiusFog(vec3(1.0)).g - radiusFog(vec3(0.0)).g, 0.0, 1.0);
    gl_FragColor = vec4(col * (1.0 - k), 1.0);
  }`;

let rng = null;
const SPEED = { circle: 4.2, close: 3.6, rush: 9.5 };

class Phantom extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'phantom', position, Object.assign({ hp: 70 }, opts));
    this.radius = 0.35; this.height = 1.8; this.speed = SPEED.circle;
    // ---- body ----
    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.15, transmission: 1, thickness: 0.6, ior: 1.35, side: THREE.FrontSide });
    this.nvgMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.12, 0.05), emissive: new THREE.Color(0.82, 1.0, 0.78), emissiveIntensity: 2.6, roughness: 1 });
    this.rig = new Rig({ material: this.glassMat, parts: BODY_PARTS });
    this.rig.mesh.castShadow = false;
    this.rimMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uColor: { value: RIM_COLOR.clone() }, uRim: { value: 0.35 }, uTime: { value: 0 }, uShimmer: { value: 1 } }, fogUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog)),
      vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    this.rim = this.rig.attach(this.rig.mesh.geometry, this.rimMat); this.rim.castShadow = false; this.rim.renderOrder = 4;
    this.root.add(this.rig.mesh, this.rim);
    // ---- state ----
    this.reveal = 0; this.nvg = false; this.visT = 0; this.shown = true;
    this.ringR = rng.range(17, 26); this.circleDir = rng.chance(0.5) ? 1 : -1; this.circleT = rng.range(7, 14); this.retargetT = 0;
    this.target = new THREE.Vector3(); this.hasTarget = false; this.freezeT = 0; this.lookedT = 0;
    this.dragLeft = 0; this.dragT = 0; this.distortT = 0; this.vanishT = 0; this.grabbed = false; this.lostT = 0; this.glitchLeft = 0;
    // no rifle: the hands hang at the hips, and go wide for the scream
    this.rig.gripR.set(0.30, -0.42, 0.22); this.rig.gripL.set(-0.34, -0.42, 0.22);
    this.deathDuration = 1.2; this.shattered = false;
    this.moveSpeed = 0;
    this.setState('idle');
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw;
    this.animate(0.016, this.distanceToPlayer());
  }
  nvgOn() { const d = this.ctx.debug, g = this.ctx.gear; return !!((d && d.nvgOn) || (g && g.nvgOn)); }
  setEngaged(v) {
    if (v && !this.engaged) { this.engaged = true; this.aware = 1; this.ctx.director?.notify('spotted', { enemy: this }); }
    else if (!v && this.engaged) { this.engaged = false; this.ctx.director?.notify('lost', { enemy: this }); }
  }
  // ---- helpers ----
  bearingFromPlayer() { const p = this.player.position; return Math.atan2(this.position.z - p.z, this.position.x - p.x); }
  viewBearing() { const f = this.player.forward; return Math.atan2(f.z, f.x); }
  // signed angle between the view axis and this body, on the ground plane
  offAxis() { return angleDelta(this.viewBearing(), this.bearingFromPlayer()); }
  walkable(x, z, out) {
    const w = this.ctx.world;
    if (Math.abs(x) > w.half - 6 || Math.abs(z) > w.half - 6) return null;
    if (w.isWater(x, z)) return null;
    const y = w.groundHeight(x, z, w.getHeight(x, z) + 2).y;
    if (w.pointInSolid(x, y + 0.9, z)) return null;
    if (w.isInBase(_v3.set(x, y, z))) return null;
    return out.set(x, y, z);
  }
  seenByPlayer(x, y, z, halfAngle = 62) {
    this.ctx.camera.getWorldDirection(_cam);
    _v.set(x, y + 0.9, z).sub(this.player.eye);
    const d = _v.length(); if (d < 0.01) return true; _v.divideScalar(d);
    if (_cam.dot(_v) < Math.cos(halfAngle * DEG)) return false;
    return this.ctx.world.lineOfSight(this.player.eye, _v2.set(x, y + 0.9, z));
  }
  // the ring point: the current side of the periphery, pushed out of the view cone
  ringPoint(out) {
    const p = this.player.position, vb = this.viewBearing();
    let off = this.offAxis();
    const side = off >= 0 ? 1 : -1;
    if (Math.abs(off) < PERIPHERY) off = side * REPOSITION;              // in view: back to the edge, same side
    else off += this.circleDir * (SPEED.circle * 0.25) / this.ringR;     // drifting round the ring
    if (Math.abs(off) > 150 * DEG) this.circleDir = -this.circleDir;     // not straight behind either: it wants your eye's corner
    const a = vb + off;
    return this.walkable(p.x + Math.cos(a) * this.ringR, p.z + Math.sin(a) * this.ringR, out);
  }
  // A place to stand still and BE SEEN: out in front, far enough that you cannot close on it, with a clear
  // line to you. The opposite of ringPoint, which hunts for the corner of your eye — this wants your eye
  // directly, because the fear is not being stalked, it is looking at a thing that should not be there.
  watchPoint(out) {
    const p = this.player.position, vb = this.viewBearing();
    let best = null, bs = -1e9;
    for (let i = 0; i < 14; i++) {
      const a = vb + rng.range(-34 * DEG, 34 * DEG);
      const r = rng.range(26, 46);
      const pt = this.walkable(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, _cand);
      if (!pt) continue;
      // it must be visible, or standing there achieves nothing
      let score = this.seenByPlayer(pt.x, pt.y, pt.z, 40) ? 6 : -6;
      score -= Math.abs(angleDelta(vb, a)) * 1.2;      // nearer the middle of the view is better
      score += (r - 26) * 0.04;                        // and further away is better: it must stay unreachable
      if (score > bs) { bs = score; best = out.copy(pt); }
    }
    return best;
  }
  show(seconds) { this.reveal = Math.max(this.reveal, seconds); }
  screenPos(out) {
    _v.set(this.position.x, this.position.y + 1.3, this.position.z).project(this.ctx.camera);
    out.set(clamp(_v.x * 0.5 + 0.5, 0, 1), clamp(_v.y * 0.5 + 0.5, 0, 1), _v.z);
    return out;
  }
  // Take up a standing position and hold it. No sound: the hiss is what it does when it is working you.
  beginWatch() {
    if (!this.watchPoint(_cand)) { this.setState('circle'); this.circleT = rng.range(6, 12); this.hasTarget = false; return; }
    this.position.copy(_cand); this.followGround(0);
    this.setState('watch');
    this.watchT = rng.range(7, 15);
    this.hasTarget = false; this.grabbed = false;
    this.show(0.35);          // just enough shimmer to be caught, not enough to be certain
  }
  // Leaving without the scream. vanish() announces itself; this does not, which is worse.
  vanishQuiet() {
    const p = this.player.position, vb = this.viewBearing();
    for (let i = 0; i < 10; i++) {
      const a = vb + Math.PI + rng.range(-1.4, 1.4);
      const pt = this.walkable(p.x + Math.cos(a) * rng.range(24, 40), p.z + Math.sin(a) * rng.range(24, 40), _cand);
      if (!pt || this.seenByPlayer(pt.x, pt.y, pt.z)) continue;
      this.position.copy(pt); this.followGround(0); break;
    }
    this.vanishT = 0.45; this.reveal = 0;
    this.setState('idle'); this.hasTarget = false;
  }
  // gone: twenty metres away, out of sight, and back on the ring
  vanish() {
    const p = this.player.position, vb = this.viewBearing();
    this.sound('phantom_hiss', { gain: 0.9, max: 50, ref: 3 });
    this.show(0.3); this.vanishT = 0.6;
    let best = null, bs = -1e9;
    for (let i = 0; i < 12; i++) {
      const a = vb + (i < 6 ? Math.PI + rng.range(-1.2, 1.2) : rng.range(-Math.PI, Math.PI));
      const pt = this.walkable(p.x + Math.cos(a) * 20, p.z + Math.sin(a) * 20, _cand);
      if (!pt) continue;
      let score = 0;
      if (!this.seenByPlayer(pt.x, pt.y, pt.z)) score += 4;
      score -= Math.abs(angleDelta(vb + Math.PI, a)) * 0.5;
      if (score > bs) { bs = score; best = true; this.target.copy(pt); }
    }
    if (best) { this.position.copy(this.target); this.followGround(0); }
    this.setState('circle'); this.circleT = rng.range(6, 12); this.ringR = rng.range(16, 26); this.hasTarget = false; this.grabbed = false;
  }
  // ---- reactions ----
  onHit(amount, info) {
    this.show(0.5);
    this.rig.flinch = 1; this.rig.startGlitch(1.2); this.glitchLeft = 0.1;
    this.sound('phantom_hiss', { gain: 0.7, max: 40, ref: 2, rate: rng.range(1.2, 1.5) });
    if (!this.alive) return;
    if (this.state === 'circle' || this.state === 'idle') { this.setEngaged(true); if (rng.chance(0.5)) this.vanish(); else { this.setState('close'); } }
    else if (this.state === 'close' && rng.chance(0.35)) this.vanish();
  }
  onDeath() {
    this.sound('phantom_scream', { gain: 1.0, max: 90, ref: 4, rate: 1.25 });
    this.show(1.5);
    this.setEngaged(false); this.flying = false;
  }
  deathTick(dt) {
    const t = this.deathT;
    this.rig.pose({ speed: 0, dt, aim: 0, headYaw: 0, headPitch: 0.4, crouch: clamp01(t * 2), lean: t * 0.6 });
    this.rimMat.uniforms.uTime.value = this.time; this.rimMat.uniforms.uRim.value = 2.5 * (1 - t / 0.5); this.rimMat.uniforms.uShimmer.value = 4;
    this.glassMat.roughness = 0.6;
    if (t >= 0.5 && !this.shattered) {
      this.shattered = true;
      _v.set(this.position.x, this.position.y + 1.2, this.position.z);
      this.ctx.vfx.shatter(_v, [0.8, 0.95, 1.0]);
      this.ctx.vfx.light(_v, 0xbfe8ff, 24, 0.3, 10);
      this.rig.mesh.visible = false; this.rim.visible = false;
    }
  }
  onDispose() { this.rig.dispose(); this.glassMat.dispose(); this.nvgMat.dispose(); this.rimMat.dispose(); this.rig.mesh.geometry.dispose(); }

  // ---- AI ----
  tick(dt) {
    const ctx = this.ctx, p = this.player, w = ctx.world, t = this.time;
    this.followGround(dt, 30);
    const d = this.distanceToPlayer();
    const prevX = this.position.x, prevZ = this.position.z;
    this.reveal = Math.max(0, this.reveal - dt);
    this.vanishT = Math.max(0, this.vanishT - dt);
    // the grab's after-effects run over the state machine
    if (this.dragLeft > 0 && dt > 0) {
      const step = Math.min(this.dragLeft, 2.0 * dt / 0.35);
      _dir.set(this.position.x - p.position.x, 0, this.position.z - p.position.z); const l = _dir.length(); if (l > 0.5) { _dir.divideScalar(l); p.position.addScaledVector(_dir, step); }
      this.dragLeft -= step;
    }
    if (this.distortT > 0) {
      this.distortT -= dt;
      const k = clamp01(this.distortT / 1.0);
      this.screenPos(_v2);
      ctx.post.setAnomaly(0.6 * k, _v2.x, _v2.y, 0.3 * k);
      // the anomaly field writes the same slot every frame after us; push the uniforms as well so the pull is seen
      const u = ctx.post.uniforms; if (u && u.uDistort) { u.uDistort.value = Math.max(u.uDistort.value, 0.6 * k); u.uAberration.value = Math.max(u.uAberration.value, 0.3 * k); }
    }
    let headYaw = 0, speed = 0, crouch = 0, lean = 0;
    const trackYaw = angleDelta(this.yaw, Math.atan2(-(p.position.x - this.position.x), -(p.position.z - this.position.z)));
    const off = Math.abs(this.offAxis());
    const looked = off < PERIPHERY && d < 60;
    this.lookedT = looked ? this.lookedT + dt : 0;

    switch (this.state) {
      case 'idle': {
        // still, shimmering, until you are close enough to be worked
        this.perceive(dt, { fov: 220, maxDay: 55, hearing: 40, visGain: 3, hearGain: 2, decay: 0.05 });
        headYaw = trackYaw * 0.6 + Math.sin(t * 0.7) * 0.2;
        if (this.engaged && !p.inBase && !p.dead) {
          // Not every encounter is an attack. An entity that always escalates is a mechanic you learn in an
          // hour and stop fearing; one that usually just watches and leaves makes the time it DOES come
          // unbearable, because you had no way to tell which this was.
          this.intent = rng.chance(0.45) ? 'watch' : 'stalk';
          this.watches = 0;
          if (this.intent === 'watch' || rng.chance(0.35)) this.beginWatch();
          else { this.setState('circle'); this.circleT = rng.range(7, 14); this.hasTarget = false; }
        }
        break;
      }
      case 'watch': {
        // It stands. That is the whole behaviour, and it is the most frightening thing it does.
        headYaw = trackYaw * 0.25;   // barely tracks: a thing looking at you does not need to turn its head
        speed = 0;
        this.faceToward(p.position.x, p.position.z, dt, 1.2);
        if (p.dead || p.inBase) { this.setEngaged(false); this.setState('idle'); break; }
        // Look straight at it and hold, and it is not there any more. Look away and back — same thing.
        if (looked && this.lookedT > rng.range(1.4, 2.6)) { this.vanishQuiet(); break; }
        if (!looked && this.stateT > 1.2 && rng.chance(dt * 0.6)) { this.vanishQuiet(); break; }
        if (d < 18) { this.setState('circle'); this.circleT = rng.range(5, 9); this.hasTarget = false; break; }
        if (this.stateT > this.watchT) {
          this.watches++;
          // a watcher moves and stands again, two or three times, and then it has gone
          if (this.intent === 'watch' && this.watches >= rng.int(2, 3)) { this.setEngaged(false); this.vanishQuiet(); this.setState('idle'); this.aware = 0.2; }
          else if (this.intent === 'stalk' && rng.chance(0.6)) { this.setState('circle'); this.circleT = rng.range(6, 12); this.hasTarget = false; }
          else this.beginWatch();
        }
        break;
      }
      case 'circle': {
        // the corner of your eye: a point on the ring at least forty degrees off your view axis
        headYaw = trackYaw;
        this.retargetT -= dt;
        if (this.retargetT <= 0 || !this.hasTarget) { this.retargetT = 0.25; if (this.ringPoint(_cand)) { this.target.copy(_cand); this.hasTarget = true; } }
        if (this.hasTarget) {
          const urgent = looked ? 1.35 : 1;
          const rem = this.moveToward(this.target, SPEED.circle * urgent, dt, { stop: 0.6, face: false, allowWater: false, turnRate: 12 });
          speed = rem > 0.6 ? SPEED.circle * urgent : 0;
        }
        this.faceToward(p.position.x, p.position.z, dt, 5);
        this.circleT -= dt;
        // it does not stay behind cover from you; the ring is its cover
        if (p.dead || p.inBase) { this.setEngaged(false); this.setState('idle'); this.aware = 0.3; break; }
        if (d > 60) { this.lostT = (this.lostT || 0) + dt; if (this.lostT > 10) { this.lostT = 0; this.vanish(); } } else this.lostT = 0;
        if (this.circleT <= 0 || d < 12) { this.setState('close'); this.freezeT = 0; }
        break;
      }
      case 'close': {
        // in, quietly, along your blind side; if you look straight at it while it is still far it stops dead
        headYaw = trackYaw;
        if (looked && d > 10 && this.lookedT < 1.5) { this.freezeT += dt; crouch = 0.15; }
        else {
          const sideOf = this.offAxis() >= 0 ? 1 : -1;
          const back = clamp01((d - 6) / 10);
          const a = this.viewBearing() + sideOf * lerp(20 * DEG, 110 * DEG, back);
          _v.set(p.position.x + Math.cos(a) * Math.max(1.5, d * 0.6), p.position.y, p.position.z + Math.sin(a) * Math.max(1.5, d * 0.6));
          this.moveToward(_v, SPEED.close, dt, { stop: 0.4, face: false, allowWater: true, turnRate: 10 });
          speed = SPEED.close;
        }
        this.faceToward(p.position.x, p.position.z, dt, 8);
        if (p.dead || p.inBase) { this.setEngaged(false); this.setState('idle'); break; }
        if (d <= 8) {
          this.setState('scream');
          this.sound('phantom_scream', { gain: 1.0, max: 80, ref: 4 });
          this.show(0.5); this.setEngaged(true);
          this.rig.startGlitch(1.5); this.glitchLeft = 0.12;
          ctx.director?.notify('spotted', { enemy: this });
        } else if (this.stateT > 25) this.vanish();
        break;
      }
      case 'scream': {
        // the tell: arms out, head back, the body plain for half a second
        headYaw = trackYaw; lean = -0.35; crouch = 0.1;
        this.faceToward(p.position.x, p.position.z, dt, 14);
        if (this.stateT > 0.55) { this.setState('rush'); this.grabbed = false; }
        break;
      }
      case 'rush': {
        headYaw = trackYaw; lean = 0.35;
        this.moveToward(p.position, SPEED.rush, dt, { stop: 0.9, face: false, allowWater: true, turnRate: 16 });
        this.faceToward(p.position.x, p.position.z, dt, 16);
        speed = SPEED.rush;
        if (d < 1.7 && !p.dead) { this.setState('grab'); }
        else if (this.stateT > 3 || p.dead || p.inBase) this.vanish();
        break;
      }
      case 'grab': {
        headYaw = trackYaw; lean = 0.5;
        this.faceToward(p.position.x, p.position.z, dt, 16);
        if (!this.grabbed) {
          this.grabbed = true;
          this.sound('phantom_grab', { gain: 1.0, max: 40, ref: 2 });
          if (ctx.damage && ctx.damage.other) ctx.damage.other(30, { kind: 'melee', source: this, bleed: false }); else this.hurtPlayer(30, 'melee');
          _dir.set(this.position.x - p.position.x, 0, this.position.z - p.position.z); const l = _dir.length() || 1; _dir.divideScalar(l);
          p.velocity.x += _dir.x * 7; p.velocity.z += _dir.z * 7;
          this.dragLeft = 2.0; this.distortT = 1.0;
          ctx.post.shake(1.0);
          this.show(0.5);
        }
        if (this.stateT > 0.45) this.vanish();
        break;
      }
    }
    if (this.state !== 'idle') this.setEngaged(true);
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.moveSpeed = damp(this.moveSpeed, dt > 0 ? mv / dt : 0, 10, dt);
    this.animate(dt, d, headYaw, crouch, lean);
  }
  // ---- animation and the look ----
  animate(dt, d, headYaw = 0, crouch = 0, lean = 0) {
    const rig = this.rig, t = this.time, ctx = this.ctx;
    if (this.glitchLeft > 0) { this.glitchLeft -= dt; if (this.glitchLeft <= 0) rig.glitchOn = false; }
    const pitch = Math.atan2(this.player.eye.y - (this.position.y + 1.6), Math.max(1, d));
    const wide = damp(this.wide || 0, this.state === 'scream' || this.state === 'grab' ? 1 : 0, 14, dt); this.wide = wide;
    rig.gripR.set(lerp(0.30, 0.62, wide), lerp(-0.42, 0.05, wide), lerp(0.22, -0.15, wide)); rig.gripL.set(lerp(-0.34, -0.66, wide), lerp(-0.42, 0.05, wide), lerp(0.22, -0.15, wide));
    rig.pose({ speed: this.moveSpeed, dt, aim: 0, headYaw, headPitch: this.state === 'scream' ? -0.5 : pitch, crouch, lean, stride: 1.2 });
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw;
    // material: night vision shows it solid; otherwise the glass, clouding when revealed
    const nvg = this.nvgOn();
    if (nvg !== this.nvg) { this.nvg = nvg; rig.mesh.material = nvg ? this.nvgMat : this.glassMat; }
    const rv = clamp01(this.reveal / 0.5);
    const scream = this.state === 'scream' ? 1 : 0;
    this.glassMat.roughness = lerp(0.15, 0.55, rv);
    const shade = lerp(1.0, 0.45, rv); this.glassMat.color.setScalar(shade);
    const u = this.rimMat.uniforms;
    u.uTime.value = t;
    u.uRim.value = 0.35 + rv * 1.8 + scream * 0.6 + ctx.time.night * 0.15;
    u.uShimmer.value = 1 + rv * 3 + (this.state === 'rush' ? 1.5 : 0);
    // the transmission pass is not free: only render the glass within forty-five metres; a vanish blinks it out.
    // The rim used to be switched on unconditionally before this test and only corrected on a change of `show`,
    // so a vanished or culled phantom lit its rim again every frame and neither the blink nor the cull held.
    const show = d < 45 && this.vanishT <= 0;
    if (show !== this.shown) { this.shown = show; rig.mesh.visible = show; }
    this.rim.visible = show && !nvg;
  }
}

export function registerPhantom(ctx) {
  rng = ctx.rng.fork(59);
  ctx.enemies.registerType('phantom', Phantom);
}
