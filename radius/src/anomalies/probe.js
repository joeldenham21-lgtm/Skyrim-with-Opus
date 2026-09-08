// Probes: G throws a small steel probe (consumes one). Ballistic arc stepped with world.raycast, lands with a
// bounce and rests 60 s. Passing within anomaly.radius + 1 reveals the anomaly (once per anomaly per probe);
// a gravity sink captures the probe, which spirals in and pops. A short hand-throw motion rides under hands.root.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { fogUniforms } from '../render/fog.js';
import { buildHands, HAND_GRIP } from '../weapons/gunmesh.js';
import { clamp01, lerp, easeOutCubic, easeInCubic, TAU } from '../core/math.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const GRAV = 9.8, LIFE = 60, MAX_PROBES = 12;
// the throw: the left fist comes up beside the head with the probe cocked, flicks forward, releases, drops away
const THROW_T = 0.5, RELEASE_T = 0.11;
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

// dull metal with grime blotches, scuffs and per-fragment roughness variation (shared by the detector)
export function grimeMaterial(color, roughness = 0.5, metalness = 0.8, seed = 0, extra = {}) {
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness }, extra));
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.uniforms.uGrimeSeed = { value: seed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vGPos; uniform float uGrimeSeed;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { vec3 gp = vGPos * 70.0 + uGrimeSeed; float g1 = vnoise3(gp * 0.6), g2 = vnoise3(gp * 3.0);
          roughnessFactor = clamp(roughnessFactor + (g1 - 0.5) * 0.35 + (g2 - 0.5) * 0.15, 0.15, 1.0); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 gp = vGPos * 70.0 + uGrimeSeed; float grime = smoothstep(0.5, 0.85, vnoise3(gp * 0.4) * 0.7 + vnoise3(gp * 5.0) * 0.3);
          float scuff = smoothstep(0.93, 0.97, vnoise(vec2(vGPos.y * 300.0 + uGrimeSeed, vGPos.x * 40.0 + vGPos.z * 55.0)));
          diffuseColor.rgb *= 1.0 - grime * 0.4; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.63, 0.64), scuff * 0.5); }`);
  };
  return m;
}

let probeGeo = null, probeMat = null;
function probeGeometry() {
  if (probeGeo) return probeGeo;
  const parts = [];
  const body = new THREE.CylinderGeometry(0.013, 0.017, 0.15, 10); parts.push(body);
  const tip = new THREE.ConeGeometry(0.0135, 0.05, 10); tip.translate(0, 0.1, 0); parts.push(tip);
  const collar = new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10); collar.translate(0, -0.028, 0); parts.push(collar);
  const ring = new THREE.TorusGeometry(0.018, 0.003, 6, 12).rotateX(Math.PI / 2); ring.translate(0, 0.02, 0); parts.push(ring);
  for (let i = 0; i < 3; i++) { const fin = new THREE.BoxGeometry(0.0025, 0.05, 0.028); fin.translate(0, -0.062, 0.026); fin.rotateY((i / 3) * TAU); parts.push(fin); }
  probeGeo = mergeGeometries(parts, false); for (const p of parts) p.dispose();
  probeGeo.userData.shared = true;
  return probeGeo;
}
function probeMaterial() { if (!probeMat) { probeMat = grimeMaterial(0x63676b, 0.48, 0.85, 4.2); probeMat.userData.shared = true; } return probeMat; }

export function createProbes(ctx) {
  const probes = [];
  let hand = null, handT = 0, pendingThrow = 0;

  function spawnProbe() {
    const pl = ctx.player;
    ctx.camera.getWorldDirection(_d);
    _r.crossVectors(_d, UP).normalize();
    const mesh = new THREE.Mesh(probeGeometry(), probeMaterial());
    mesh.castShadow = true; mesh.frustumCulled = true;
    const p = { mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), state: 'fly', t: 0, restT: 0, settle: 0, revealed: new Set(), spiral: null, bounces: 0 };
    // -0.14: the throw is a left-hand flick (buildThrowHand, and the anim runs x from -0.21 to -0.14),
    // so a +right offset launched the probe from the opposite side of the screen to the hand throwing it
    p.pos.copy(pl.eye).addScaledVector(_d, 0.4).addScaledVector(_r, -0.14).addScaledVector(UP, -0.06);
    p.vel.copy(_d).multiplyScalar(12).addScaledVector(UP, 3).addScaledVector(pl.velocity, 0.8);
    p.rot.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
    p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    mesh.position.copy(p.pos); mesh.rotation.copy(p.rot);
    ctx.scene.add(mesh);
    probes.push(p);
    if (probes.length > MAX_PROBES) remove(probes[0]);
    return p;
  }
  function remove(p) {
    const i = probes.indexOf(p); if (i >= 0) probes.splice(i, 1);
    if (p.mesh) { ctx.scene.remove(p.mesh); p.mesh = null; }
  }
  // left glove closed on a probe: the fist's grip point (mirrored HAND_GRIP) sits at the group origin, the probe along it
  function buildThrowHand() {
    const g = new THREE.Group(); g.name = 'probeHand';
    const glove = buildHands().left; glove.position.copy(HAND_GRIP); glove.position.x = -glove.position.x; glove.position.negate(); g.add(glove);
    const probe = new THREE.Mesh(probeGeometry(), probeMaterial()); probe.name = 'probe'; probe.frustumCulled = false; probe.position.y = 0.03; g.add(probe);
    g.userData.probe = probe;
    return g;
  }
  function beginThrow() {
    if (!ctx.inventory.remove('probe', 1)) return false;
    ctx.audio.play('probe_throw', { gain: 0.7, rate: 0.95 + Math.random() * 0.1 });
    if (!hand) hand = buildThrowHand();
    hand.userData.probe.visible = true; hand.visible = true;
    ctx.hands.pivot.add(hand);
    handT = THROW_T; pendingThrow = RELEASE_T;
    if (ctx.state.data.flags && !ctx.state.data.flags.probeHint) { ctx.state.data.flags.probeHint = true; ctx.hud.hint?.('Committee advisory: probes reveal anomalies. Throw before you walk.', 5000); }
    return true;
  }
  function pop(p) {
    const v = ctx.vfx;
    v.dustPuff(p.pos, UP, 18, [0.3, 0.29, 0.26], 0.5);
    v.spark(p.pos, UP, 8, [0.8, 0.85, 0.9]);
    ctx.audio.play('probe_trigger', { pos: p.pos, hrtf: true, gain: 0.9, rate: 0.7 });
    remove(p);
  }
  function checkAnomalies(p) {
    for (const a of ctx.anomalies.list) {
      if (p.revealed.has(a)) continue;
      const dx = a.position.x - p.pos.x, dz = a.position.z - p.pos.z, dy = p.pos.y - a.position.y;
      if (dy < -2 || dy > 6) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > a.radius + 1) continue;
      p.revealed.add(a);
      a.reveal(p.pos);
      ctx.audio.play('probe_trigger', { pos: p.pos, hrtf: true, gain: 0.8 });
      if (a.type === 'gravity' && p.state !== 'spiral') {
        p.state = 'spiral';
        p.spiral = { c: a.position, r0: Math.max(d, 0.8), a0: Math.atan2(-dz, -dx), h0: dy, dur: 1.7, t: 0 };
      }
    }
  }
  function step(p, dt) {
    const w = ctx.world;
    if (p.state === 'fly') {
      p.vel.y -= GRAV * dt;
      const len = p.vel.length() * dt; if (len < 1e-5) return;
      _d.copy(p.vel).normalize();
      const hit = w.raycast(p.pos, _d, len + 0.03);
      if (hit) {
        _n.copy(hit.normal);
        const speed = p.vel.length();
        if (_n.y > 0.55 && (speed < 3.2 || p.bounces >= 2)) {
          // rest: lie on the surface with the tip pointing along the last travel direction
          p.state = 'rest'; p.settle = 0.22;
          p.pos.copy(hit.point).addScaledVector(_n, 0.018);
          // 'YXZ': in the default XYZ order the yaw is applied before the X rotation that lays the probe
          // down, so it spun the still-upright cylinder about its own axis and did nothing — every probe
          // in the zone came to rest pointing along world +Z. Yaw has to be the outermost rotation.
          p.rot.set(Math.PI / 2 + (Math.random() - 0.5) * 0.3, Math.atan2(_d.x, _d.z), (Math.random() - 0.5) * 0.4, 'YXZ');
          p.vel.set(0, 0, 0);
          ctx.audio.play('probe_land', { pos: p.pos, hrtf: true, gain: 0.8, variant: hit.surface });
          if (hit.surface === 'water') { ctx.vfx.impact(hit.point, _n, 'water'); ctx.audio.play('impact_water', { pos: p.pos, hrtf: true, gain: 0.5 }); remove(p); return; }
          ctx.vfx.dustPuff(hit.point, _n, 4, hit.surface === 'concrete' || hit.surface === 'road' ? [0.45, 0.44, 0.42] : [0.36, 0.34, 0.26], 0.3);
        } else {
          p.bounces++;
          p.pos.copy(hit.point).addScaledVector(_n, 0.03);
          const vn = p.vel.dot(_n);
          p.vel.addScaledVector(_n, -1.8 * vn).multiplyScalar(0.38);
          p.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 18);
          ctx.audio.play('probe_land', { pos: p.pos, hrtf: true, gain: 0.5, rate: 1.2, variant: hit.surface });
          if (hit.surface === 'metal') ctx.vfx.spark(hit.point, _n, 3, [1.0, 0.8, 0.5]);
        }
      } else p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      if (p.pos.y < w.map.WATER_LEVEL - 0.2 || Math.abs(p.pos.x) > w.half || Math.abs(p.pos.z) > w.half) { remove(p); return; }
      checkAnomalies(p);
    } else if (p.state === 'rest') {
      p.restT += dt;
      if (p.settle > 0) { p.settle -= dt; p.mesh.position.y = p.pos.y + Math.abs(Math.sin(p.settle * 28)) * p.settle * 0.12; }
      if (p.restT > LIFE - 2) { p.pos.y -= dt * 0.03; }
      if (p.restT >= LIFE) { remove(p); return; }
      if (p.restT < 1) checkAnomalies(p);
    } else if (p.state === 'spiral') {
      const s = p.spiral; s.t += dt;
      const u = clamp01(s.t / s.dur);
      const r = s.r0 * Math.pow(1 - u, 1.3), ang = s.a0 + u * u * 16 + u * 5;
      const h = lerp(s.h0, 1.5, u) + Math.sin(u * 22) * 0.05 * (1 - u);
      p.pos.set(s.c.x + Math.cos(ang) * r, s.c.y + h, s.c.z + Math.sin(ang) * r);
      p.rot.x += 18 * dt; p.rot.z += 11 * dt;
      if (u >= 1) { pop(p); return; }
    }
    p.mesh.position.copy(p.pos); p.mesh.rotation.copy(p.rot);
    if (p.state === 'rest' && p.settle > 0) p.mesh.position.y = p.pos.y + Math.abs(Math.sin(p.settle * 28)) * p.settle * 0.12;
  }

  const api = {
    get list() { return probes; },
    throwProbe() { return beginThrow(); },
    update(dt) {
      const live = ctx.mode === 'playing' && !ctx.panels.isOpen && !ctx.player.dead;
      if (live && ctx.input.pressed('probe') && handT <= 0) {
        if (!beginThrow()) { ctx.audio.play('click', { gain: 0.45 }); ctx.hud.hint?.('Probe count: 0. Resupply at Vanno.', 2500); }
      }
      // hand motion: the left fist is cocked beside the head, flicks forward, opens at the release, then drops out of frame
      if (handT > 0) {
        handT -= dt;
        const el = THROW_T - handT;
        const flick = easeOutCubic(clamp01(el / RELEASE_T));
        const drop = easeInCubic(clamp01((el - RELEASE_T) / (THROW_T - RELEASE_T)));
        const raise = smooth(clamp01(el / 0.06));      // the first frames bring the hand up from below the frame
        hand.position.set(lerp(-0.21, -0.14, flick) - drop * 0.1, lerp(-0.16, 0.0, raise) + lerp(0.0, -0.07, flick) - drop * 0.34, lerp(-0.2, -0.4, flick) + drop * 0.06);
        hand.rotation.set(lerp(1.05, -0.5, flick) - drop * 0.6, lerp(-0.3, -0.12, flick), lerp(0.3, 0.05, flick));
        if (handT <= 0 && hand.parent) hand.parent.remove(hand);
      }
      if (pendingThrow > 0) { pendingThrow -= dt; if (pendingThrow <= 0) { spawnProbe(); if (hand) hand.userData.probe.visible = false; } }
      if (dt <= 0) return;
      for (let i = probes.length - 1; i >= 0; i--) { const p = probes[i]; if (p.mesh) step(p, dt); }
    },
    reset() { for (const p of [...probes]) remove(p); },
  };
  ctx.events.on('gameStart', () => { api.reset(); if (hand && hand.parent) hand.parent.remove(hand); handT = 0; pendingThrow = 0; });
  ctx.events.on('tide', () => api.reset());
  return api;
}
