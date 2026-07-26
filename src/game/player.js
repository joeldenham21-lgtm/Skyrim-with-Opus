/**
 * WYRMHOLD — player controller and camera.
 *
 * Capsule-vs-heightfield movement with slope limits, swimming, sprinting,
 * sneaking and jumping, plus a spring-arm third-person camera that ducks under
 * terrain and props, and a first-person mode with weapon-aware head bob.
 */

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { clamp, saturate, lerp, damp, dampAngle, mod, TAU, PI } from '../core/math.js';
import { buildHumanoid, Animator } from './rig.js';

const UP = new THREE.Vector3(0, 1, 0);

export const STANCE = { NORMAL: 0, SNEAK: 1, SWIM: 2 };

export class Player {
  constructor(world, input, mats) {
    this.world = world;
    this.hf = world.hf;
    this.input = input;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.moveYaw = 0;              // facing, lags the camera
    this.radius = 0.34;
    this.height = 1.82;
    this.eyeHeight = 1.66;

    this.grounded = true;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.crouching = false;
    this.sprinting = false;
    this.swimming = false;
    this.submerged = 0;
    this.speed01 = 0;
    this.turnRate = 0;
    this.lastYaw = 0;
    this.fallTime = 0;
    this.fallStart = 0;
    this.blocking = false;
    this.aiming = false;
    this.casting = false;
    /** When inside a cell the heightfield is meaningless; this is the floor. */
    this.floorY = null;

    // --- character -------------------------------------------------------
    this.rig = buildHumanoid(mats, {
      preset: 'player', seed: 7,
      cloak: true, hood: true,
      torsoMat: mats.clothGreen || mats.cloth,
      legMat: mats.leatherDark || mats.leather,
      armMat: mats.clothDark || mats.cloth,
      hoodMat: mats.clothDark || mats.cloth,
      cloakMat: mats.clothBlue || mats.cloth,
      bootMat: mats.leatherDark || mats.leather,
    });
    this.anim = new Animator(this.rig);
    this.model = this.rig.root;
    this.model.name = 'player';
    world.scene.add(this.model);

    // Right hand attachment point for weapons.
    this.handR = this.rig.joints.handR;
    this.handL = this.rig.joints.handL;

    // --- camera ----------------------------------------------------------
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.12, 6000);
    this.camPivot = new THREE.Vector3();
    this.camDist = 3.4;
    this.camDistTarget = 3.4;
    this.thirdPerson = settings.get('thirdPerson');
    this.camShake = 0;
    this.camShakeDecay = 3.2;
    this._bob = 0;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._shoulder = 0.55;
    this.fovBoost = 0;

    // --- callbacks / events ------------------------------------------------
    this.onFootstep = null;
    this.onLand = null;
    this.onSplash = null;
    this.controlEnabled = true;
  }

  spawn(x, z) {
    const y = this.hf.heightAt(x, z);
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.model.position.copy(this.pos);
  }

  get eyePos() { return this._eye || (this._eye = new THREE.Vector3()); }

  // -------------------------------------------------------------------------
  update(dt, stats, colliders) {
    const inp = this.input;
    const s = settings;

    // ---- look ------------------------------------------------------------
    if (this.controlEnabled) {
      const sens = this.aiming ? s.get('sensitivityAds') : 1;
      this.yaw -= inp.lookDelta.x * sens;
      this.pitch -= inp.lookDelta.y * sens;
    }
    this.yaw = mod(this.yaw, TAU);
    this.pitch = clamp(this.pitch, -1.35, 1.30);
    this.turnRate = damp(this.turnRate, ((this.yaw - this.lastYaw + PI * 3) % TAU - PI) / Math.max(dt, 1e-3), 8, dt);
    this.lastYaw = this.yaw;

    // ---- water -------------------------------------------------------------
    const indoors = this.floorY !== null;
    const waterY = indoors ? null : this.hf.waterAt(this.pos.x, this.pos.z);
    const inWater = waterY !== null && this.pos.y < waterY - 0.05;
    const depth = inWater ? waterY - this.pos.y : 0;
    const wasSwimming = this.swimming;
    this.swimming = inWater && depth > 1.25;
    this.submerged = saturate(depth / 1.9);
    if (this.swimming && !wasSwimming) this.onSplash?.(1);

    // ---- intent ------------------------------------------------------------
    const move = inp.move;
    const wantsMove = Math.hypot(move.x, move.y) > 0.02 && this.controlEnabled;
    const wantWalk = inp.wantsWalk();
    this.sprinting = this.controlEnabled && !this.crouching && !this.swimming &&
      inp.isDown('sprint') && wantsMove && stats.stamina > 1 && move.y > 0.15;

    if (this.controlEnabled && inp.wasPressed('crouch') && !this.swimming) {
      this.crouching = s.get('toggleCrouch') ? !this.crouching : true;
    }
    if (!s.get('toggleCrouch') && !inp.isDown('crouch')) this.crouching = false;
    if (this.swimming) this.crouching = false;

    // ---- speed --------------------------------------------------------------
    let target = 0;
    const walkSpeed = 2.1, runSpeed = 4.4, sprintSpeed = 7.2, sneakSpeed = 1.5, swimSpeed = 2.6;
    if (wantsMove) {
      target = this.swimming ? swimSpeed
        : this.crouching ? sneakSpeed
          : this.sprinting ? sprintSpeed
            : wantWalk ? walkSpeed : runSpeed;
      target *= stats.speedMultiplier ?? 1;
      if (stats.overEncumbered) target *= 0.55;
    }

    // Movement is relative to where the camera is looking.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let dirX = 0, dirZ = 0;
    if (wantsMove) {
      const fwdX = -sy, fwdZ = -cy;
      const rightX = cy, rightZ = -sy;
      dirX = fwdX * move.y + rightX * move.x;
      dirZ = fwdZ * move.y + rightZ * move.x;
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l; dirZ /= l;
    }

    const mag = Math.min(1, Math.hypot(move.x, move.y));
    const desiredX = dirX * target * mag;
    const desiredZ = dirZ * target * mag;

    const accel = this.grounded ? (this.swimming ? 6 : 22) : 4.5;
    this.vel.x = damp(this.vel.x, desiredX, accel, dt);
    this.vel.z = damp(this.vel.z, desiredZ, accel, dt);

    // ---- vertical ------------------------------------------------------------
    if (this.swimming) {
      let vy = 0;
      if (inp.isDown('jump')) vy = 2.2;
      else if (inp.isDown('crouch')) vy = -2.2;
      else vy = (waterY - 0.9 - this.pos.y) * 2.2;   // bob at the surface
      this.vel.y = damp(this.vel.y, clamp(vy, -3, 3), 6, dt);
      this.grounded = false;
      this.coyote = 0;
    } else {
      this.vel.y -= 22 * dt;
      if (this.vel.y < -60) this.vel.y = -60;
      if (this.controlEnabled && inp.wasPressed('jump')) this.jumpBuffer = 0.16;
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && stats.stamina > 8) {
        this.vel.y = 7.2;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        stats.useStamina(11);
        this.anim.play('jump', 0.3);
      }
    }

    // ---- integrate + collide ---------------------------------------------------
    const step = Math.min(dt, 0.05);
    this._move(step, colliders);

    // ---- ground ------------------------------------------------------------------
    const gh = indoors ? this.floorY : this.hf.heightAt(this.pos.x, this.pos.z);
    const wasGrounded = this.grounded;
    if (!this.swimming) {
      if (this.pos.y <= gh + 0.02) {
        if (!wasGrounded) {
          const fall = Math.max(0, this.fallStart - this.pos.y);
          this.onLand?.(fall, Math.abs(this.vel.y));
          if (fall > 5.5) {
            const dmg = (fall - 5.5) * (fall - 5.5) * 1.5;
            stats.damage(dmg, 'fall');
            this.anim.play('stagger', 0.5);
          }
        }
        this.pos.y = gh;
        if (this.vel.y < 0) this.vel.y = 0;
        this.grounded = true;
        this.coyote = 0.12;
        this.fallTime = 0;
      } else {
        this.grounded = false;
        this.coyote = Math.max(0, this.coyote - dt);
        if (wasGrounded) this.fallStart = this.pos.y;
        this.fallTime += dt;
      }
      if (indoors) this.groundNormal.set(0, 1, 0);
      else this.hf.normalAt(this.pos.x, this.pos.z, 1.0, this.groundNormal);
      // Steep ground pushes you back down.
      const slope = 1 - this.groundNormal.y;
      if (this.grounded && slope > 0.55) {
        this.vel.x += this.groundNormal.x * 16 * dt;
        this.vel.z += this.groundNormal.z * 16 * dt;
      }
    } else {
      if (this.pos.y < gh) this.pos.y = gh;
    }

    // ---- stamina ---------------------------------------------------------------
    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (this.sprinting && planar > 0.6) stats.useStamina(18 * dt);
    else if (this.swimming && planar > 0.4) stats.useStamina(4 * dt);
    this.speed01 = saturate(planar / sprintSpeed);

    // ---- facing ------------------------------------------------------------------
    const strafeLock = this.aiming || this.blocking || this.thirdPerson === false;
    if (strafeLock) {
      this.moveYaw = dampAngle(this.moveYaw, this.yaw, 18, dt);
    } else if (planar > 0.25) {
      const target = Math.atan2(this.vel.x, this.vel.z);
      this.moveYaw = dampAngle(this.moveYaw, target, 12, dt);
    }

    // ---- model + animation --------------------------------------------------------
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.moveYaw;
    const env = this.world.env;
    this.anim.update(dt, {
      speed01: this.speed01,
      grounded: this.grounded,
      crouch: this.crouching,
      swimming: this.swimming,
      blocking: this.blocking,
      aiming: this.aiming,
      casting: this.casting,
      dead: stats.health <= 0,
      pitch: -this.pitch,
      headYaw: strafeLock ? 0 : ((this.yaw - this.moveYaw + PI * 3) % TAU - PI) * 0.5,
      vy: this.vel.y,
      turnRate: this.turnRate,
      windX: env.windX, windZ: env.windZ, windStrength: env.windStrength,
    });
    if (this.anim.stepEvent) {
      this.onFootstep?.(this.anim.stepEvent.strength, this._surface());
      this.anim.stepEvent = null;
    }

    // ---- camera ---------------------------------------------------------------------
    this._updateCamera(dt, colliders);
  }

  _surface() {
    const b = this.hf.sampleBiome(this.pos.x, this.pos.z);
    const env = this.world.env;
    if (this.submerged > 0.15) return 'water';
    if (env.snowCover > 0.4 || this.pos.y > env.snowLine) return 'snow';
    if (b.road > 0.3) return 'gravel';
    const slope = this.hf.slopeAt(this.pos.x, this.pos.z);
    if (slope > 0.4) return 'stone';
    if (b.forest > 0.35) return 'forest';
    return 'grass';
  }

  /** Horizontal capsule sweep with terrain slope limit and prop collision. */
  _move(dt, colliders) {
    const maxSlopeRise = 0.62;          // metres of rise allowed per metre moved
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;

    if (this.floorY === null && !this.swimming && this.grounded) {
      const h0 = this.hf.heightAt(this.pos.x, this.pos.z);
      const h1 = this.hf.heightAt(nx, nz);
      const dist = Math.hypot(nx - this.pos.x, nz - this.pos.z);
      if (dist > 1e-4 && (h1 - h0) / dist > maxSlopeRise) {
        // Slide along the contour instead of climbing a cliff.
        const n = this.hf.normalAt(this.pos.x, this.pos.z, 1.0, this._tmpN || (this._tmpN = new THREE.Vector3()));
        const tx = -n.z, tz = n.x;
        const d = (nx - this.pos.x) * tx + (nz - this.pos.z) * tz;
        nx = this.pos.x + tx * d * 0.85;
        nz = this.pos.z + tz * d * 0.85;
        const h2 = this.hf.heightAt(nx, nz);
        if ((h2 - h0) / Math.max(dist, 1e-4) > maxSlopeRise) { nx = this.pos.x; nz = this.pos.z; }
      }
    }

    // Props: push out of vertical cylinders.
    if (colliders && colliders.length) {
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (this.pos.y + this.height < c.y || this.pos.y > c.y + c.h) continue;
        const dx = nx - c.x, dz = nz - c.z;
        const d = Math.hypot(dx, dz);
        const rr = c.r + this.radius;
        if (d < rr && d > 1e-5) {
          const push = (rr - d);
          nx += dx / d * push;
          nz += dz / d * push;
        } else if (d <= 1e-5) {
          nx += rr; // degenerate: nudge out
        }
      }
    }

    // World bounds.
    const B = 2000;
    nx = clamp(nx, -B, B);
    nz = clamp(nz, -B, B);

    this.pos.x = nx;
    this.pos.z = nz;
    this.pos.y += this.vel.y * dt;
  }

  // -------------------------------------------------------------------------
  toggleView() {
    this.thirdPerson = !this.thirdPerson;
    settings.set('thirdPerson', this.thirdPerson);
  }

  addShake(amount, decay = 3.2) {
    this.camShake = Math.min(1.6, this.camShake + amount * settings.get('cameraShake'));
    this.camShakeDecay = decay;
  }

  _updateCamera(dt, colliders) {
    const cam = this.camera;
    const fovBase = settings.get('fov');
    const sprintFov = this.sprinting ? 6 : 0;
    const aimFov = this.aiming ? -12 : 0;
    this.fovBoost = damp(this.fovBoost, sprintFov + aimFov, 6, dt);
    const wantFov = fovBase + this.fovBoost;
    if (Math.abs(cam.fov - wantFov) > 0.01) { cam.fov = wantFov; cam.updateProjectionMatrix(); }

    const crouchDrop = this.crouching ? 0.42 : 0;
    const swimDrop = this.swimming ? 0.75 : 0;
    const eyeY = this.pos.y + this.eyeHeight - crouchDrop - swimDrop;

    // head bob
    const bobAmt = settings.get('headBob');
    this._bob += dt * lerp(5.5, 13.5, this.speed01) * this.speed01;
    const bobY = Math.sin(this._bob * 2) * 0.028 * this.speed01 * bobAmt;
    const bobX = Math.sin(this._bob) * 0.030 * this.speed01 * bobAmt;
    const bobR = Math.sin(this._bob) * 0.012 * this.speed01 * bobAmt;

    // shake
    this.camShake = Math.max(0, this.camShake - dt * this.camShakeDecay);
    const sh = this.camShake * this.camShake;
    const t = performance.now() * 0.001;
    const shX = (Math.sin(t * 47.3) + Math.sin(t * 31.7)) * 0.5 * sh * 0.10;
    const shY = (Math.sin(t * 53.1) + Math.sin(t * 27.3)) * 0.5 * sh * 0.10;

    this.camPivot.set(this.pos.x, eyeY, this.pos.z);

    if (this.thirdPerson) {
      this.camDistTarget = this.aiming ? 1.9 : (this.crouching ? 2.9 : 3.6);
      this.camDist = damp(this.camDist, this.camDistTarget, 8, dt);

      const cp = Math.cos(this.pitch), spp = Math.sin(this.pitch);
      const dirX = Math.sin(this.yaw) * cp;
      const dirY = spp;
      const dirZ = Math.cos(this.yaw) * cp;

      const shoulder = this.aiming ? 0.72 : this._shoulder;
      const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
      const px = this.camPivot.x + rightX * shoulder;
      const pz = this.camPivot.z + rightZ * shoulder;
      const py = this.camPivot.y + 0.18;

      // Spring arm: shorten until it clears the terrain and any props.
      let dist = this.camDist;
      if (this.floorY === null) {
        const hit = this.hf.raycast(px, py, pz, dirX, dirY, dirZ, dist + 0.45, 0.28);
        if (hit.hit) dist = Math.max(0.55, hit.dist - 0.45);
      }
      if (colliders) {
        for (const c of colliders) {
          if (!c.blocksCamera) continue;
          const dx = c.x - px, dz = c.z - pz;
          const along = dx * dirX + dz * dirZ;
          if (along < 0 || along > dist) continue;
          const perp = Math.hypot(dx - dirX * along, dz - dirZ * along);
          if (perp < c.r + 0.2) dist = Math.min(dist, Math.max(0.55, along - 0.3));
        }
      }
      // Never let the camera clip below the ground.
      let cx = px + dirX * dist, cy = py + dirY * dist, cz = pz + dirZ * dist;
      const groundY = (this.floorY !== null ? this.floorY : this.hf.heightAt(cx, cz)) + 0.42;
      if (cy < groundY) cy = groundY;

      this._camPos.set(cx + shX, cy + shY, cz);
      this._camLook.set(this.camPivot.x, this.camPivot.y + 0.22, this.camPivot.z);
      cam.position.copy(this._camPos);
      cam.lookAt(this._camLook);
      cam.rotateZ(bobR * 0.4);
      this.model.visible = true;
    } else {
      const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
      cam.position.set(
        this.camPivot.x + bobX * rightX + shX,
        eyeY + bobY + shY,
        this.camPivot.z + bobX * rightZ);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(this.yaw);
      cam.rotateX(this.pitch);
      cam.rotateZ(bobR);
      // Hide our own head, keep the body for shadows.
      this.model.visible = true;
      this.rig.joints.head.scale.setScalar(0.001);
    }
    if (this.thirdPerson) this.rig.joints.head.scale.setScalar(1);

    this.eyePos.set(this.camPivot.x, eyeY, this.camPivot.z);
    cam.updateMatrixWorld(true);
  }

  /** Forward vector of the camera, for aiming. */
  aimDir(out = new THREE.Vector3()) {
    out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return out;
  }
}
