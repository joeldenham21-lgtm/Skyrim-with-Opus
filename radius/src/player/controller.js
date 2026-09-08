// First-person body: movement, camera, stamina, crouch, head bob, footsteps, damage, bleeding, flashlight.
import * as THREE from 'three';
import { clamp, clamp01, damp, lerp, smoothstep, DEG } from '../core/math.js';

const WALK = 3.6, SPRINT = 6.2, CROUCH = 1.8, EYE = 1.7, EYE_CROUCH = 1.05, RADIUS = 0.35, GRAVITY = 22;

export function createPlayer(ctx) {
  const { camera, input, state, events } = ctx;
  // NOTE: never cache state.data — game.start() replaces it. Always read through state.data.
  const position = new THREE.Vector3(0, 0, 0);     // feet
  const velocity = new THREE.Vector3();
  const rig = new THREE.Object3D();                 // yaw
  const head = new THREE.Object3D();                // pitch + bob
  rig.add(head); head.add(camera);
  ctx.scene.add(rig);
  camera.rotation.set(0, 0, 0);

  let yaw = Math.PI, pitch = 0;
  let crouched = false, sprinting = false, grounded = true, eyeH = EYE, bobT = 0, bobAmt = 0, stepAcc = 0, speedNow = 0;
  let lean = 0, rollKick = 0, kickPitch = 0, kickYaw = 0, recoilPitch = 0, recoilYaw = 0;
  let landDip = 0, landVel = 0, strafeRoll = 0;   // camera feel: a dip on landing, a lean into strafes
  let bleedT = 0, bleedTick = 0, hurtT = 0, breathe = 0, moveLock = 0, dead = false, lastSurface = 'grass', wading = 0;
  let noiseLevel = 0;         // how loud the player is right now (0..1), read by enemies
  let heartLoop = null, breathLoop = null;   // body sounds: heartbeat under 30 HP, breath under 20 stamina
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), shake = new THREE.Vector3();

  const api = {
    position, velocity, rig, head, radius: RADIUS,
    get hp() { return state.data.hp; }, set hp(v) { state.data.hp = v; },
    get stamina() { return state.data.stamina; },
    get yaw() { return yaw; }, get pitch() { return pitch; },
    get crouched() { return crouched; }, get sprinting() { return sprinting; }, get grounded() { return grounded; },
    get moving() { return speedNow > 0.3; }, get speed() { return speedNow; },
    get noise() { return noiseLevel; }, get dead() { return dead; }, get eyeHeight() { return eyeH; },
    get bleeding() { return state.data.bleeding; },
    inBase: false, inWater: false, moveLock: 0, loadFactor: 1,
    eye: new THREE.Vector3(),
    forward: fwd,
    setLook(y, p) { yaw = y; pitch = p; },
    teleport(x, z, y = null) { position.set(x, y ?? ctx.world.getHeight(x, z), z); velocity.set(0, 0, 0); },
    // --- damage / heal ---
    damage(amount, info = {}) {
      if (dead || amount <= 0) return;
      if (ctx.debug?.god) return;
      state.data.hp = Math.max(0, state.data.hp - amount);
      hurtT = 1;
      ctx.post.damageFlash(clamp01(0.35 + amount / 40));
      ctx.post.shake(clamp01(amount / 30));
      if (info.bleed !== false && amount >= 8 && (info.kind === 'bullet' || info.kind === 'slash')) state.data.bleeding = true;
      ctx.audio.play(info.kind === 'bullet' ? 'hurt_bullet' : 'hurt', { gain: 0.8 });
      ctx.director?.notify('damaged', { amount, source: info.source });
      events.emit('playerDamaged', amount, info);
      if (state.data.hp <= 0) api.die(info);
    },
    heal(amount) { state.data.hp = Math.min(100, state.data.hp + amount); },
    stopBleeding() { state.data.bleeding = false; },
    addStamina(v) { state.data.stamina = clamp(state.data.stamina + v, 0, 100); },
    die(info = {}) {
      if (dead) return; dead = true; state.data.stats.deaths++;
      velocity.set(0, 0, 0);
      events.emit('playerDied', info);
    },
    revive() { dead = false; state.data.hp = Math.max(state.data.hp, 60); state.data.bleeding = false; state.data.stamina = 100; hurtT = 0; },
    // recoil from weapons: pitch up (radians), yaw random
    kick(p, y) { kickPitch += p; kickYaw += y; },
    // lock movement for a time (reload stages, using meds)
    lockMovement(s) { moveLock = Math.max(moveLock, s); },

    update(dt) {
      const world = ctx.world;
      // ---- look ----
      if (!dead) {
        const sens = 0.0021 * (state.data.settings.sensitivity || 1) * (ctx.weapons?.adsBlend ? lerp(1, 0.6, ctx.weapons.adsBlend) : 1);
        yaw -= input.dx * sens; pitch -= input.dy * sens;
      }
      // recoil: kick then spring back
      recoilPitch = damp(recoilPitch, 0, 14, dt); recoilYaw = damp(recoilYaw, 0, 14, dt);
      if (kickPitch !== 0 || kickYaw !== 0) { pitch += kickPitch * 0.55; yaw += kickYaw * 0.55; recoilPitch += kickPitch * 0.45; recoilYaw += kickYaw * 0.45; kickPitch = 0; kickYaw = 0; }
      pitch = clamp(pitch, -85 * DEG, 85 * DEG);
      rig.rotation.y = yaw;

      // ---- movement intent ----
      const wantSprint = input.down('sprint') && state.data.stamina > 5 && !crouched;
      if (input.pressed('crouch')) crouched = !crouched;
      moveLock = Math.max(0, moveLock - dt);
      let mx = 0, mz = 0;
      if (!dead && moveLock <= 0) {
        if (input.hasAxis) { mx = input.axisX; mz = input.axisZ; }        // thumbstick: partial deflection is partial speed
        else { mx = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0); mz = (input.down('back') ? 1 : 0) - (input.down('forward') ? 1 : 0); }
      }
      const hasInput = mx !== 0 || mz !== 0;
      sprinting = wantSprint && hasInput && mz < 0;
      const ads = ctx.weapons?.adsBlend || 0;
      let target = crouched ? CROUCH : sprinting ? SPRINT : WALK;
      target *= lerp(1, 0.7, ads);
      if (state.data.hp < 25) target *= 0.85;
      if (api.inWater) target *= 0.65;
      // load: armour and pack slow you; overweight slows more and forbids sprinting past 1.5x capacity
      const inv = ctx.inventory;
      let gearSpeed = 1, gearStamina = 1;
      for (const slot of ['vest', 'helmet', 'backpack', 'rig']) { const gd = inv.equippedDef?.(slot); if (gd) { gearSpeed *= gd.speed || 1; gearStamina *= gd.stamina || 1; } }
      const over = inv.overweight ? inv.overweight() : 0, cap = inv.capacity ? inv.capacity() : 30;
      const overK = clamp01(over / Math.max(1, cap * 0.5));
      target *= gearSpeed * lerp(1, 0.6, overK) * (ctx.damage ? ctx.damage.speedMul : 1);
      api.loadFactor = gearStamina * (1 + overK * 0.8);
      if (over > cap * 0.5) sprinting = false;
      // right = forward x up. (fwd.z, 0, -fwd.x) is up x forward — the exact negation — so strafe
      // ran backwards at every yaw: D moved you left. strafeRoll below reads the same vector to
      // build `lateral`, so its dot product is unchanged by this and must keep its leading minus.
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); right.set(-fwd.z, 0, fwd.x);
      // Clamp to unit length rather than normalising to it: a diagonal on the keys is still capped at
      // full speed, but a half-deflected stick stays half speed instead of being snapped to a run.
      const len = Math.max(1, Math.hypot(mx, mz));
      tmp.set(0, 0, 0).addScaledVector(fwd, -mz / len).addScaledVector(right, mx / len);
      // acceleration with different rates for ground/air
      const accel = grounded ? 22 : 4;
      velocity.x = damp(velocity.x, tmp.x * target, accel, dt);
      velocity.z = damp(velocity.z, tmp.z * target, accel, dt);
      // stamina
      if (sprinting) state.data.stamina = Math.max(0, state.data.stamina - 16 * dt * (api.loadFactor || 1)); else state.data.stamina = Math.min(100, state.data.stamina + (crouched ? 8 : 11) * dt * (ctx.damage ? ctx.damage.staminaRegenMul : 1) / Math.sqrt(api.loadFactor || 1));
      breathe = damp(breathe, state.data.stamina < 25 ? 1 : 0, 1.5, dt);
      // gravity + ground
      velocity.y -= GRAVITY * dt;
      position.x += velocity.x * dt; position.z += velocity.z * dt; position.y += velocity.y * dt;
      // world bounds: the ridge pushes you back
      const lim = world.half - 4;
      position.x = clamp(position.x, -lim, lim); position.z = clamp(position.z, -lim, lim);
      // collide with static geometry
      world.resolveCapsule(position, RADIUS, crouched ? 1.3 : 1.85);
      const g = world.groundHeight(position.x, position.z, position.y + 0.3);
      if (position.y <= g.y + 0.001) {
        if (!grounded) { const fall = -velocity.y; landVel = Math.min(1.2, Math.max(0.15, fall * 0.12)); if (fall > 9) { api.damage(Math.floor((fall - 9) * 4), { kind: 'fall', bleed: false }); ctx.audio.play('land', { gain: 0.8 }); } else if (fall > 2.5) ctx.audio.play('land', { gain: 0.35 }); }
        position.y = g.y; velocity.y = Math.max(0, velocity.y); grounded = true;
      } else grounded = position.y - g.y < 0.05;
      const surface = g.surface || world.getSurface(position.x, position.z);
      api.inWater = world.isWater(position.x, position.z) && !g.surface;
      wading = damp(wading, api.inWater ? 1 : 0, 6, dt);
      api.inBase = world.isInBase(position);
      speedNow = Math.hypot(velocity.x, velocity.z);
      state.data.stats.distance += speedNow * dt;

      // ---- eye height, bob, lean ----
      const targetEye = crouched ? EYE_CROUCH : EYE;
      eyeH = damp(eyeH, targetEye, 10, dt);
      const bobSpeed = clamp01(speedNow / SPRINT);
      bobAmt = damp(bobAmt, grounded ? bobSpeed : 0, 8, dt);
      bobT += dt * (sprinting ? 12.5 : crouched ? 6.5 : 9.0) * clamp01(speedNow / 1.5);
      const motion = state.data.settings.motion ?? 1;
      const bobY = Math.sin(bobT * 2) * 0.028 * bobAmt * motion + Math.sin(bobT * 0.9) * breathe * 0.012 * motion;
      const bobX = Math.sin(bobT) * 0.02 * bobAmt * motion;
      const targetLean = 0;
      lean = damp(lean, targetLean, 8, dt);
      // landing: a spring dip that recovers; strafing: a small roll into the movement
      landDip += (landVel * 0.09 - landDip) * Math.min(1, dt * 18); landVel = damp(landVel, 0, 9, dt);
      const lateral = velocity.x * right.x + velocity.z * right.z;
      strafeRoll = damp(strafeRoll, -lateral / SPRINT * 0.022 * motion, 8, dt);
      ctx.post.shakeOffset(shake);
      head.position.set(bobX + shake.x, eyeH + bobY + shake.y - wading * 0.35 - landDip * motion, 0);
      head.rotation.set(pitch + recoilPitch + landDip * 0.35 * motion, recoilYaw, Math.sin(bobT) * 0.004 * bobAmt * motion + lean * 0.2 + shake.x * 0.5 + strafeRoll);
      rig.position.copy(position);
      camera.getWorldPosition(api.eye);

      // ---- footsteps + noise ----
      stepAcc += speedNow * dt;
      const stride = crouched ? 0.75 : sprinting ? 1.55 : 1.15;
      if (grounded && stepAcc > stride && speedNow > 0.4) {
        stepAcc = 0;
        const surf = api.inWater ? 'water' : surface;
        lastSurface = surf;
        const gain = crouched ? 0.35 : sprinting ? 0.9 : 0.6;
        ctx.audio.play('step_' + surf, { gain, rate: 0.95 + Math.random() * 0.1 });
        events.emit('footstep', { surface: surf, sprint: sprinting, crouch: crouched });
      }
      noiseLevel = damp(noiseLevel, crouched ? 0.15 * bobSpeed : sprinting ? 1 : 0.45 * bobSpeed, 4, dt);

      // ---- bleeding / regen / hurt ----
      if (state.data.bleeding && !dead) {
        bleedT += dt;
        if (bleedT > 3) {
          bleedT = 0;
          // A bleed tick used to write hp straight into state, so ninety-nine points of damage
          // arrived with no flash, no sound and no event: you were shot once, walked away, and
          // fell over five minutes later of "exsanguination" having seen nothing at all. Each tick
          // now reports itself the way any other wound does — quieter, and heavier as you empty.
          if (state.data.hp <= 1) { if (!api.inBase) api.damage(1, { kind: 'bleed', bleed: false }); }
          else {
            state.data.hp = Math.max(1, state.data.hp - 1);
            const severity = 1 - clamp01(state.data.hp / 100);
            ctx.post.damageFlash(0.12 + 0.22 * severity);
            bleedTick++;
            if (bleedTick % 3 === 0 || state.data.hp < 25) ctx.audio.play('hurt', { gain: 0.18 + 0.22 * severity });
            events.emit('playerDamaged', 1, { kind: 'bleed', bleed: false });
          }
        }
      }
      hurtT = damp(hurtT, 0, 2, dt);

      // ---- body sounds ----
      {
        const hp = state.data.hp, lowHp = hp < 30 && !dead && !api.inBase;
        if (lowHp && !heartLoop) heartLoop = ctx.audio.loop('heartbeat', { gain: 0.0 });
        if (heartLoop) {
          const k = clamp01((30 - hp) / 30);
          heartLoop.set('rate', 70 + 60 * k); heartLoop.setGain(lowHp ? 0.25 + 0.45 * k : 0, 0.5);
          if (!lowHp) { heartLoop.stop(1.5); heartLoop = null; }
        }
        const lowSta = breathe > 0.3 && !dead;
        if (lowSta && !breathLoop) breathLoop = ctx.audio.loop('breath', { gain: 0.0 });
        if (breathLoop) {
          breathLoop.set('rate', 0.35 + 0.25 * breathe); breathLoop.setGain(lowSta ? 0.18 * breathe : 0, 0.6);
          if (!lowSta) { breathLoop.stop(1.2); breathLoop = null; }
        }
      }
      // ---- flashlight ----
      if (input.pressed('flashlight') && !dead) {
        if (state.data.flashlight.battery <= 0 && !state.data.flashlight.on) ctx.audio.play('click', { gain: 0.5 });
        else { state.data.flashlight.on = !state.data.flashlight.on; ctx.audio.play('flashlight', { gain: 0.6 }); }
      }
      if (state.data.flashlight.on) { state.data.flashlight.battery = Math.max(0, state.data.flashlight.battery - dt * (100 / (7 * 60))); if (state.data.flashlight.battery <= 0) { state.data.flashlight.on = false; ctx.audio.play('flashlight', { gain: 0.4, rate: 0.7 }); } }
      ctx.lighting.setFlashlight(state.data.flashlight.on && !dead);
      if (input.pressed('jump') && grounded && !dead && !crouched && moveLock <= 0 && state.data.stamina > 10) { velocity.y = 6.2; state.data.stamina -= 6; grounded = false; ctx.audio.play('jump', { gain: 0.5 }); }
    },
  };
  return api;
}
