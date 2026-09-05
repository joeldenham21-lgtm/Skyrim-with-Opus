// Viewmodel rig parented to the camera. Owns the gloved hands and the weapon child, and animates them
// procedurally: mouse-lag sway, walk bob (figure eight), low-stamina breathing, ADS transition, recoil spring,
// sprint lowering, draw/holster, and the staged reload/cycle animations that weapons.js drives by name.
// Other modules may parent their own held items under hands.root; setWeaponMesh only touches the weapon child.
import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, easeInOut, easeOutCubic, easeInCubic, TAU } from '../core/math.js';
import { buildHands, HAND_GRIP, viewFill } from '../weapons/gunmesh.js';

const _v = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const SPRING_K = 420, SPRING_AMP = Math.sqrt(SPRING_K);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const seg = (t, a, b) => clamp01((t - a) / (b - a));

// Animation library. Each fn(t, o, u, s) writes offsets into o (see makeOffsets) for t in 0..1; the last frame is
// held until the next animation starts, so a mag stays out between magOut and magIn. u = weapon userData,
// s = { lock } rig state.
const ANIMS = {
  draw(t, o) { const k = 1 - easeOutCubic(t); o.gunPos.set(0.02 * k, -0.32 * k, 0.06 * k); o.gunRot.set(-0.75 * k, 0.25 * k, 0.2 * k); },
  holster(t, o) { const k = easeInCubic(t); o.gunPos.set(0.02 * k, -0.32 * k, 0.06 * k); o.gunRot.set(-0.75 * k, 0.25 * k, 0.2 * k); },
  magOut(t, o, u) {
    const tilt = smooth(t * 2.5), drop = easeInCubic(seg(t, 0.25, 1));
    o.gunRot.set(-0.05 * tilt, 0.08 * tilt, 0.16 * tilt); o.gunPos.set(0, -0.015 * tilt, 0.01 * tilt);
    o.magPos.set(u.magTravel[0] * drop, u.magTravel[1] * drop, u.magTravel[2] * drop); o.magRot.set(-0.3 * drop, 0, 0.15 * drop);
  },
  magIn(t, o, u) {
    const rise = 1 - easeOutCubic(seg(t, 0, 0.72)), seat = Math.sin(Math.PI * seg(t, 0.72, 0.9)), settle = 1 - smooth(seg(t, 0.75, 1));
    o.gunRot.set(-0.05 * settle, 0.08 * settle, 0.16 * settle); o.gunPos.set(0, -0.015 * settle - 0.012 * seat, 0.01 * settle + 0.006 * seat);
    o.magPos.set(u.magTravel[0] * rise, u.magTravel[1] * rise + 0.004 * seat, u.magTravel[2] * rise); o.magRot.set(-0.3 * rise, 0, 0.15 * rise);
  },
  chamber(t, o, u, s) {
    const back = s.lock ? (t < 0.3 ? 1 : 1 - easeOutCubic(seg(t, 0.3, 0.75))) : (t < 0.4 ? easeOutCubic(t / 0.4) : 1 - easeInCubic(seg(t, 0.4, 0.8)));
    const tilt = Math.sin(Math.PI * clamp01(t));
    o.cycle = back; o.gunRot.set(0.02 * tilt, 0.06 * tilt, 0.12 * tilt); o.gunPos.set(0, -0.008 * tilt, 0.012 * back);
    o.hammer = back;
  },
  cycle(t, o) { const back = Math.sin(Math.PI * clamp01(t)); o.cycle = back; o.hammer = back; o.trigger = 1 - t; },
  dry(t, o) { o.trigger = 1 - t; o.gunRot.set(0.012 * Math.sin(Math.PI * t), 0, 0); },
  bolt(t, o, u) {
    // lift, pull, push, drop
    const lift = smooth(seg(t, 0, 0.18)) - smooth(seg(t, 0.8, 1));
    const pull = smooth(seg(t, 0.2, 0.42)) - smooth(seg(t, 0.55, 0.78));
    o.boltRot.set(0, 0, 1.45 * lift); o.boltPos.set(0, 0, (u.boltTravel || 0.07) * pull);
    const tilt = Math.sin(Math.PI * clamp01(t));
    o.gunRot.set(0.03 * tilt, 0.1 * tilt, -0.16 * tilt); o.gunPos.set(-0.01 * tilt, -0.006 * tilt, 0.02 * tilt);
  },
  breakOpen(t, o, u) {
    const k = easeOutCubic(seg(t, 0.15, 0.7)), tilt = smooth(seg(t, 0, 0.5));
    o.cycleRot.set((u.breakAngle || -0.55) * k, 0, 0);
    o.gunRot.set(-0.32 * tilt, 0.12 * tilt, 0.22 * tilt); o.gunPos.set(-0.02 * tilt, 0.01 * tilt, 0.02 * tilt);
  },
  shellIn(t, o, u) {
    const bump = Math.sin(Math.PI * seg(t, 0.55, 0.8));
    o.cycleRot.set((u.breakAngle || -0.55), 0, 0);
    o.gunRot.set(-0.32 - 0.03 * bump, 0.12, 0.22); o.gunPos.set(-0.02, 0.01 - 0.006 * bump, 0.02 + 0.008 * bump);
  },
  breakClose(t, o, u) {
    const k = 1 - easeInCubic(seg(t, 0, 0.55)), tilt = 1 - smooth(seg(t, 0.35, 1)), snap = Math.sin(Math.PI * seg(t, 0.55, 0.7));
    o.cycleRot.set((u.breakAngle || -0.55) * k, 0, 0);
    o.gunRot.set(-0.32 * tilt + 0.03 * snap, 0.12 * tilt, 0.22 * tilt); o.gunPos.set(-0.02 * tilt, 0.01 * tilt - 0.008 * snap, 0.02 * tilt);
  },
  jam(t, o) {
    const rattle = Math.sin(t * 60) * (1 - t) * 0.25;
    o.cycle = 0.42 + rattle * 0.3; o.gunRot.set(0.02 * rattle, 0.04 * rattle, 0.06 * rattle); o.gunPos.set(0, 0, 0.01 * (1 - t));
  },
  unjam(t, o) {
    const tilt = smooth(seg(t, 0, 0.25)) - smooth(seg(t, 0.82, 1));
    const tug = seg(t, 0.3, 0.7);
    const back = 0.42 + 0.58 * (Math.abs(Math.sin(tug * Math.PI * 2)) * (tug > 0 && tug < 1 ? 1 : 0));
    const release = smooth(seg(t, 0.72, 0.84));
    o.cycle = t < 0.72 ? back : 0.42 * (1 - release);
    o.gunRot.set(-0.18 * tilt, 0.14 * tilt, 0.38 * tilt); o.gunPos.set(-0.02 * tilt, -0.02 * tilt, 0.03 * tilt);
  },
  loadStart(t, o) { const k = smooth(t); o.gunRot.set(-0.28 * k, 0.2 * k, 0.32 * k); o.gunPos.set(-0.03 * k, -0.05 * k, 0.03 * k); },
  loadRound(t, o) { const bump = Math.sin(Math.PI * seg(t, 0.35, 0.65)); o.gunRot.set(-0.28 - 0.03 * bump, 0.2, 0.32 + 0.02 * bump); o.gunPos.set(-0.03, -0.05 - 0.006 * bump, 0.03); },
  loadEnd(t, o) { const k = 1 - smooth(t); o.gunRot.set(-0.28 * k, 0.2 * k, 0.32 * k); o.gunPos.set(-0.03 * k, -0.05 * k, 0.03 * k); },
  // Mosin clip: bolt already open; the gun tilts toward the shooter and the clip is pressed in with a jolt
  clipIn(t, o, u) {
    const tilt = smooth(seg(t, 0, 0.3)) - smooth(seg(t, 0.8, 1)), press = Math.sin(Math.PI * seg(t, 0.45, 0.7));
    o.boltRot.set(0, 0, 1.45); o.boltPos.set(0, 0, (u.boltTravel || 0.07));
    o.gunRot.set(0.04 * tilt - 0.02 * press, 0.12 * tilt, -0.2 * tilt); o.gunPos.set(-0.012 * tilt, -0.008 * tilt - 0.008 * press, 0.02 * tilt);
    o.magPos.set(0, 0.002 * press, 0);
  },
  boltOpen(t, o, u) {
    const lift = smooth(seg(t, 0, 0.45)), pull = smooth(seg(t, 0.5, 1));
    o.boltRot.set(0, 0, 1.45 * lift); o.boltPos.set(0, 0, (u.boltTravel || 0.07) * pull);
    o.gunRot.set(0.03 * lift, 0.1 * lift, -0.16 * lift); o.gunPos.set(-0.01 * lift, -0.006 * lift, 0.02 * lift);
  },
  boltClose(t, o, u) {
    const push = 1 - smooth(seg(t, 0, 0.5)), drop = 1 - smooth(seg(t, 0.55, 1));
    o.boltRot.set(0, 0, 1.45 * drop); o.boltPos.set(0, 0, (u.boltTravel || 0.07) * push);
    o.gunRot.set(0.03 * drop, 0.1 * drop, -0.16 * drop); o.gunPos.set(-0.01 * drop, -0.006 * drop, 0.02 * drop);
  },
};

function makeOffsets() { return { gunPos: new THREE.Vector3(), gunRot: new THREE.Vector3(), magPos: new THREE.Vector3(), magRot: new THREE.Vector3(), boltPos: new THREE.Vector3(), boltRot: new THREE.Vector3(), cycleRot: new THREE.Vector3(), cycle: 0, hammer: 0, trigger: 0 }; }
function resetOffsets(o) { o.gunPos.set(0, 0, 0); o.gunRot.set(0, 0, 0); o.magPos.set(0, 0, 0); o.magRot.set(0, 0, 0); o.boltPos.set(0, 0, 0); o.boltRot.set(0, 0, 0); o.cycleRot.set(0, 0, 0); o.cycle = 0; o.hammer = 0; o.trigger = 0; }

export function createHands(ctx) {
  const root = new THREE.Group(); root.name = 'hands'; ctx.camera.add(root);
  const pivot = new THREE.Group(); pivot.name = 'weaponPivot'; root.add(pivot);      // sway, bob, kick
  const holder = new THREE.Group(); holder.name = 'weaponHolder'; pivot.add(holder); // pose + anim offsets
  const gloves = buildHands(); holder.add(gloves.right); holder.add(gloves.left);
  gloves.right.visible = gloves.left.visible = false;

  let weapon = null, parts = {}, ud = null;
  const off = makeOffsets();
  let anim = null, animT = 0, animDur = 1, animFn = null;
  let bobT = 0, bobAmt = 0, lower = 0, breathe = 0, swayX = 0, swayY = 0, swayRX = 0, swayRY = 0, adsEase = 0, crouchK = 0;
  // recoil spring (position back + rotation up), critically damped
  const kx = new THREE.Vector3(), kv = new THREE.Vector3(), kr = new THREE.Vector3(), krv = new THREE.Vector3();
  const state = { lock: false };

  function placeHand(hand, spec, mirror) {
    if (!spec) { hand.visible = false; return; }
    hand.visible = true;
    _e.set(spec.r[0], spec.r[1], spec.r[2]);
    hand.rotation.copy(_e);
    _v.copy(HAND_GRIP); if (mirror) _v.x = -_v.x; _v.applyEuler(_e);
    hand.position.set(spec.p[0], spec.p[1], spec.p[2]).sub(_v);
  }

  const api = {
    root, pivot, holder, adsBlend: 0, gloves,
    get weapon() { return weapon; }, get parts() { return parts; },
    get animName() { return anim; }, get animT() { return animDur > 0 ? animT / animDur : 1; }, get animDone() { return !anim || animT >= animDur; },
    setWeaponMesh(group) {
      if (weapon) { weapon.remove(gloves.right); weapon.remove(gloves.left); holder.remove(weapon); }
      holder.add(gloves.right); holder.add(gloves.left);
      weapon = group || null; parts = {}; ud = null;
      if (weapon) {
        holder.add(weapon);
        // the gloves ride inside the weapon group so they follow hip/ADS poses and every animation offset
        weapon.add(gloves.right); weapon.add(gloves.left);
        ud = weapon.userData;
        for (const n of ['mag', 'slide', 'bolt', 'barrels', 'trigger', 'hammer', 'muzzle', 'eject']) { const o = weapon.getObjectByName(n); if (o) parts[n] = o; }
        parts.cycle = parts.slide || parts.bolt || parts.barrels || null;
        placeHand(gloves.right, ud.grips?.right, false);
        placeHand(gloves.left, ud.grips?.left, true);
      } else { gloves.right.visible = gloves.left.visible = false; }
      anim = null; animFn = null; state.lock = false; resetOffsets(off);
      api.applyParts();
    },
    // named animation, duration in seconds; the last frame is held until the next call
    playAnim(name, duration = 0.5) { animFn = ANIMS[name] || null; anim = animFn ? name : null; animT = 0; animDur = Math.max(0.01, duration); },
    stopAnim() { anim = null; animFn = null; resetOffsets(off); },
    setSlideLock(v) { state.lock = !!v; },
    // impulse into the spring; sqrt(K) turns a velocity impulse into roughly that peak displacement
    kick(pitch = 0, yaw = 0) {
      const s = (ctx.state.data.settings.motion ?? 1) * SPRING_AMP;
      kv.z += (0.04 + pitch * 1.6) * s; kv.y += 0.008 * s; kv.x += yaw * 0.6 * s;
      krv.x += (0.08 + pitch * 3.2) * s; krv.z += (Math.random() - 0.5) * 0.12 * s; krv.y += yaw * 2.4 * s;
    },
    muzzleWorld(out) { if (parts.muzzle) return parts.muzzle.getWorldPosition(out); return ctx.camera.getWorldPosition(out); },
    ejectWorld(out) { if (parts.eject) return parts.eject.getWorldPosition(out); return api.muzzleWorld(out); },
    applyParts() {
      if (!weapon) return;
      const o = off;
      holder.position.copy(o.gunPos); holder.rotation.set(o.gunRot.x, o.gunRot.y, o.gunRot.z);
      const setBase = (p) => { if (!p || !p.userData.base) return; p.position.copy(p.userData.base.p); p.rotation.copy(p.userData.base.r); };
      setBase(parts.mag); setBase(parts.slide); setBase(parts.bolt); setBase(parts.barrels); setBase(parts.trigger); setBase(parts.hammer);
      if (parts.mag) { parts.mag.position.add(o.magPos); parts.mag.rotation.x += o.magRot.x; parts.mag.rotation.y += o.magRot.y; parts.mag.rotation.z += o.magRot.z; }
      const travel = ud.slideTravel || 0.03;
      let back = o.cycle; if (state.lock && anim !== 'chamber' && anim !== 'cycle' && anim !== 'jam' && anim !== 'unjam') back = Math.max(back, 0.85);
      if (ud.cycle === 'slide' && parts.slide) parts.slide.position.z += travel * back;
      else if (ud.cycle === 'bolt' && parts.bolt) parts.bolt.position.z += travel * back;
      else if (ud.cycle === 'mosin' && parts.bolt) { parts.bolt.position.add(o.boltPos); parts.bolt.rotation.z += o.boltRot.z; }
      else if (parts.barrels) { parts.barrels.rotation.x += o.cycleRot.x; }
      if (parts.trigger) parts.trigger.rotation.x -= 0.4 * o.trigger;
      if (parts.hammer) parts.hammer.rotation.x += 0.5 * o.hammer;
    },
    update(dt) {
      const p = ctx.player, input = ctx.input, s = ctx.state.data.settings, motion = s.motion ?? 1;
      const t = ctx.elapsed;
      // ---- animation ----
      if (animFn && animT < animDur) { animT = Math.min(animDur, animT + dt); }
      if (animFn) { resetOffsets(off); animFn(clamp01(animT / animDur), off, ud || {}, state); }
      // ---- pose: hip <-> ads <-> lowered ----
      const ads = easeInOut(clamp01(api.adsBlend));
      adsEase = damp(adsEase, ads, 40, dt);
      const wantLower = (p.sprinting || p.dead) && !(anim && animT < animDur && (anim === 'draw'));
      lower = damp(lower, wantLower ? 1 : 0, 7, dt);
      crouchK = damp(crouchK, p.crouched ? 1 : 0, 8, dt);
      if (weapon && ud) {
        const hip = ud.hip, adsP = ud.ads;
        _v.set(lerp(hip.p[0], adsP.p[0], adsEase), lerp(hip.p[1], adsP.p[1], adsEase), lerp(hip.p[2], adsP.p[2], adsEase));
        _e.set(lerp(hip.r[0], adsP.r[0], adsEase), lerp(hip.r[1], adsP.r[1], adsEase), lerp(hip.r[2], adsP.r[2], adsEase));
        const lr = ud.lowerRot || [0.4, 0.3, 0.2];
        _v.y -= lower * 0.12 + crouchK * 0.01; _v.x += lower * 0.05; _v.z += lower * 0.06;
        _e.x -= lr[0] * lower; _e.y += lr[1] * lower; _e.z += lr[2] * lower;
        weapon.position.copy(_v); weapon.rotation.copy(_e);
      }
      // ---- sway from mouse with lag ----
      const dx = input.enabled ? input.dx : 0, dy = input.enabled ? input.dy : 0;
      const swayK = lerp(1, 0.22, adsEase) * motion;
      swayX = damp(swayX, clamp(-dx * 0.00045, -0.025, 0.025) * swayK, 9, dt);
      swayY = damp(swayY, clamp(dy * 0.00035, -0.02, 0.02) * swayK, 9, dt);
      swayRY = damp(swayRY, clamp(-dx * 0.0011, -0.06, 0.06) * swayK, 8, dt);
      swayRX = damp(swayRX, clamp(-dy * 0.0009, -0.05, 0.05) * swayK, 8, dt);
      // ---- bob: figure eight from speed ----
      const speed = p.speed || 0;
      const target = p.grounded === false ? 0 : clamp01(speed / 3.6);
      bobAmt = damp(bobAmt, target, 6, dt);
      bobT += dt * (p.sprinting ? 12.5 : p.crouched ? 6.5 : 9.0) * clamp01(speed / 1.5);
      const bobK = (0.5 + 0.5 * clamp01(speed / 3.6)) * lerp(1, 0.25, adsEase) * motion * (p.sprinting ? 1.7 : 1);
      const bobX = Math.sin(bobT * 0.5) * 0.011 * bobAmt * bobK;
      const bobY = (Math.sin(bobT) * 0.007 - 0.003) * bobAmt * bobK;
      const bobRZ = Math.sin(bobT * 0.5) * 0.012 * bobAmt * bobK;
      // ---- breathing: always a little, much more when winded ----
      breathe = damp(breathe, ctx.state.data.stamina < 25 ? 1 : 0, 1.5, dt);
      const brY = Math.sin(t * TAU / 3.8) * 0.0018 * motion + Math.sin(t * TAU / 1.9) * 0.0065 * breathe * motion;
      const brRX = Math.sin(t * TAU / 3.8 + 0.6) * 0.003 * motion + Math.sin(t * TAU / 1.9 + 0.4) * 0.012 * breathe * motion;
      const brRZ = Math.sin(t * TAU / 5.1) * 0.002 * motion + Math.sin(t * TAU / 1.9 + 1.7) * 0.01 * breathe * motion;
      // ---- recoil spring ----
      const K = SPRING_K, C = 30, n = Math.min(8, Math.ceil(dt * 120)), h = n > 0 ? dt / n : 0;
      for (let i = 0; i < n; i++) {
        kv.addScaledVector(kx, -K * h).addScaledVector(kv, -C * h); kx.addScaledVector(kv, h);
        krv.addScaledVector(kr, -K * h).addScaledVector(krv, -C * h); kr.addScaledVector(krv, h);
      }
      const kick = lerp(1, 0.55, adsEase) * motion;
      pivot.position.set(swayX + bobX + kx.x * kick, swayY + bobY + brY + kx.y * kick, kx.z * kick);
      pivot.rotation.set(swayRX + brRX + kr.x * kick, swayRY + kr.y * kick, bobRZ + brRZ + kr.z * kick);
      api.applyParts();
      // ---- viewmodel fill: torch bounce off the ground ahead, a little sky by day ----
      const L = ctx.lighting;
      if (L) {
        const torch = L.flashlight && L.flashlight.visible ? clamp01(L.flashlight.intensity / 42) : 0;
        // irradiance units (three's Lambert divides by pi): the beam on the ground ahead measures ~4-6, so the bounce on
        // the hands sits at about two thirds of that; by day the sky adds a little so the gun never goes to silhouette
        viewFill.value.copy(L.hemi.color).multiplyScalar(L.hemi.intensity * 1.6);
        if (L.ambient) viewFill.value.addScalar(L.ambient.intensity * 0.4);
        if (torch > 0) viewFill.value.add(_c.copy(L.flashlight.color).multiplyScalar(torch * 6.0));
      }
    },
  };
  return api;
}
