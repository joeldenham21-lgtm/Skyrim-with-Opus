/**
 * WYRMHOLD — actors: villagers, bandits, draugr, wildlife, a troll and a dragon.
 *
 * One state machine covers everything that walks: idle → wander/patrol → alert
 * → chase → attack → flee → dead, driven by a perception model that accounts
 * for distance, field of view, light level, whether you are sneaking, and how
 * much noise you just made. The dragon gets its own flight machine on top.
 */

import * as THREE from 'three';
import { buildHumanoid, buildQuadruped, Animator, QuadAnimator } from './rig.js';
import { buildItemMesh, ITEMS, rollLoot } from './items.js';
import { clamp, saturate, lerp, damp, dampAngle, mod, TAU, PI, Rand, shortAngle } from '../core/math.js';

export const FACTION = { PLAYER: 'player', TOWN: 'town', BANDIT: 'bandit', UNDEAD: 'undead', BEAST: 'beast', DRAGON: 'dragon' };

const HOSTILE = {
  [FACTION.TOWN]: new Set([FACTION.BANDIT, FACTION.UNDEAD, FACTION.DRAGON]),
  [FACTION.BANDIT]: new Set([FACTION.PLAYER, FACTION.TOWN, FACTION.UNDEAD]),
  [FACTION.UNDEAD]: new Set([FACTION.PLAYER, FACTION.TOWN, FACTION.BANDIT, FACTION.BEAST]),
  [FACTION.BEAST]: new Set([FACTION.PLAYER, FACTION.TOWN]),
  [FACTION.DRAGON]: new Set([FACTION.PLAYER, FACTION.TOWN, FACTION.BANDIT]),
  [FACTION.PLAYER]: new Set([FACTION.BANDIT, FACTION.UNDEAD, FACTION.BEAST, FACTION.DRAGON]),
};

// ---------------------------------------------------------------------------

export const ACTOR_DEFS = {
  villager: {
    name: 'Villager', faction: FACTION.TOWN, kind: 'humanoid', preset: 'villager',
    health: 60, damage: 5, speed: 1.5, runSpeed: 3.4, sight: 26, reach: 2.0,
    xp: 0, essential: true, wander: 14, loot: null, passive: true,
  },
  guard: {
    name: 'Hearthwatch Guard', faction: FACTION.TOWN, kind: 'humanoid', preset: 'guard',
    health: 160, damage: 18, speed: 1.7, runSpeed: 4.6, sight: 42, reach: 2.2,
    xp: 0, helmet: true, pauldrons: true, weapon: 'steelSword', shield: 'woodShield',
    essential: true, wander: 22, loot: null,
  },
  bandit: {
    name: 'Bandit', faction: FACTION.BANDIT, kind: 'humanoid', preset: 'bandit',
    health: 95, damage: 14, speed: 1.6, runSpeed: 5.0, sight: 38, reach: 2.1,
    xp: 32, weapon: 'ironSword', loot: 'bandit', wander: 10, aggressive: true,
  },
  banditArcher: {
    name: 'Bandit Archer', faction: FACTION.BANDIT, kind: 'humanoid', preset: 'bandit',
    health: 78, damage: 16, speed: 1.6, runSpeed: 5.0, sight: 48, reach: 34,
    xp: 36, weapon: 'huntingBow', ranged: true, loot: 'bandit', wander: 8, aggressive: true,
  },
  banditChief: {
    name: 'Bandit Chief', faction: FACTION.BANDIT, kind: 'humanoid', preset: 'bandit',
    health: 210, damage: 24, speed: 1.7, runSpeed: 5.2, sight: 44, reach: 2.3,
    xp: 110, weapon: 'steelMace', shield: 'steelShield', helmet: true, pauldrons: true,
    loot: 'bandit', wander: 8, aggressive: true, scale: 1.08,
  },
  draugr: {
    name: 'Draugr', faction: FACTION.UNDEAD, kind: 'humanoid', preset: 'draugr',
    health: 120, damage: 17, speed: 1.2, runSpeed: 3.8, sight: 30, reach: 2.1,
    xp: 48, weapon: 'ironAxe', loot: 'draugr', wander: 4, aggressive: true,
    undead: true, sleeps: true, eyes: true,
  },
  draugrLord: {
    name: 'Draugr Deathlord', faction: FACTION.UNDEAD, kind: 'humanoid', preset: 'draugr',
    health: 320, damage: 30, speed: 1.3, runSpeed: 4.4, sight: 36, reach: 2.4,
    xp: 220, weapon: 'ancientBlade', helmet: true, pauldrons: true, loot: 'draugr',
    wander: 3, aggressive: true, undead: true, sleeps: true, eyes: true, scale: 1.15,
  },
  troll: {
    name: 'Frost Troll', faction: FACTION.BEAST, kind: 'humanoid', preset: 'troll',
    health: 380, damage: 34, speed: 1.5, runSpeed: 5.4, sight: 40, reach: 3.0,
    xp: 260, loot: 'troll', wander: 20, aggressive: true, scale: 1.0, regen: 3,
  },
  wolf: {
    name: 'Wolf', faction: FACTION.BEAST, kind: 'quad', health: 55, damage: 11,
    speed: 2.2, runSpeed: 7.0, sight: 40, reach: 1.9, xp: 22, loot: 'wolf',
    wander: 30, aggressive: true, pack: true,
  },
  deer: {
    name: 'Deer', faction: FACTION.BEAST, kind: 'quad', health: 35, damage: 0,
    speed: 1.8, runSpeed: 8.5, sight: 46, reach: 1.5, xp: 8, loot: 'wolf',
    wander: 60, skittish: true, passive: true, antlers: true,
  },
};

// ---------------------------------------------------------------------------

let _uid = 1;

export class Actor {
  constructor(world, defId, opts = {}) {
    this.world = world;
    this.id = _uid++;
    this.defId = defId;
    this.def = ACTOR_DEFS[defId] || ACTOR_DEFS.villager;
    this.name = opts.name || this.def.name;
    this.faction = opts.faction || this.def.faction;
    this.rand = new Rand((this.id * 7919 + 13) | 0);

    const lvlScale = opts.levelScale ?? 1;
    this.maxHealth = this.def.health * lvlScale;
    this.health = this.maxHealth;
    this.damage = this.def.damage * lvlScale;
    this.level = Math.max(1, Math.round(lvlScale * 4));

    this.pos = new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0);
    this.vel = new THREE.Vector3();
    this.home = new THREE.Vector3(this.pos.x, 0, this.pos.z);
    this.yaw = this.rand.float(0, TAU);
    this.state = this.def.sleeps ? 'dormant' : 'idle';
    this.stateTime = 0;
    this.target = null;
    this.attackCd = 0;
    this.alertness = 0;
    this.dead = false;
    this.deadTime = 0;
    this.looted = false;
    this.hitFlash = 0;
    this.staggered = 0;
    this.blocking = false;
    this.speed01 = 0;
    this.interactable = !!opts.dialogue;
    this.dialogue = opts.dialogue || null;
    this.merchant = opts.merchant || null;
    this.essential = this.def.essential || opts.essential;
    this.questId = opts.questId || null;
    this.effects = [];
    this.wanderTarget = null;
    this.lastSeenPlayer = null;
    this.noticeTimer = 0;
    this.interior = opts.interior || false;

    this._build(opts);
  }

  _build(opts) {
    const P = this.world.palette;
    const scale = this.def.scale ?? 1;
    if (this.def.kind === 'quad') {
      this.rig = buildQuadruped({ fur: this.defId === 'deer' ? P.leatherDark : P.fur },
        { height: this.defId === 'deer' ? 1.05 : 0.78, length: this.defId === 'deer' ? 1.6 : 1.35, build: this.defId === 'deer' ? 0.8 : 1 });
      this.anim = new QuadAnimator(this.rig);
      if (this.def.antlers) {
        const h = this.rig.joints.head;
        for (const s of [1, -1]) {
          for (let i = 0; i < 3; i++) {
            const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.34, 5), P.bone);
            m.position.set(s * 0.07, 0.14 + i * 0.09, -0.02 - i * 0.05);
            m.rotation.set(-0.5 + i * 0.2, 0, s * (0.5 + i * 0.25));
            m.castShadow = true;
            h.add(m);
          }
        }
      }
      this.height = this.rig.height + 0.4;
      this.radius = 0.5;
    } else {
      const undead = this.def.undead;
      const mats = {
        cloth: undead ? P.clothDark : (opts.clothMat || P.cloth),
        leather: P.leather, iron: P.iron, fur: P.fur,
        skin: undead ? P.skinDraugr : (opts.skinMat || P.skin),
        bone: P.bone,
      };
      this.rig = buildHumanoid(mats, {
        preset: this.def.preset, seed: this.id,
        cloak: !!opts.cloak, hood: !this.def.helmet,
        helmet: this.def.helmet, pauldrons: this.def.pauldrons,
        torsoMat: opts.torsoMat || (undead ? P.leatherDark : mats.cloth),
        legMat: P.leather, armMat: opts.armMat || mats.cloth,
        hoodMat: opts.hoodMat || mats.cloth, cloakMat: opts.cloakMat || P.clothDark,
        height: (this.def.preset === 'troll' ? 2.65 : undefined),
      });
      this.anim = new Animator(this.rig);
      this.height = this.rig.height;
      this.radius = this.def.preset === 'troll' ? 0.75 : 0.36;

      if (this.def.eyes) {
        const eyeMat = P.emEye;
        for (const s of [1, -1]) {
          const e = new THREE.Mesh(new THREE.SphereGeometry(0.022 * this.rig.scale, 6, 5), eyeMat);
          e.position.set(s * 0.042 * this.rig.scale, 0.02 * this.rig.scale, 0.10 * this.rig.scale);
          this.rig.joints.head.add(e);
        }
      }
      if (this.def.weapon) this.equipWeapon(this.def.weapon);
      if (this.def.shield) this.equipShield(this.def.shield);
    }

    this.model = this.rig.root;
    this.model.scale.setScalar(scale);
    this.model.userData.actor = this;
    this.model.traverse(o => { if (o.isMesh) o.userData.actor = this; });
  }

  equipWeapon(id) {
    const def = ITEMS[id];
    if (!def) return;
    this.weaponDef = def;
    if (this.weaponMesh) this.weaponMesh.parent?.remove(this.weaponMesh);
    this.weaponMesh = buildItemMesh(def, this.world.palette);
    this.weaponMesh.position.set(0, -0.09, 0.02);
    this.weaponMesh.rotation.set(1.32, 0, 0);
    if (def.build === 'bow') this.weaponMesh.rotation.set(0, 0, Math.PI / 2);
    this.rig.joints.handR.add(this.weaponMesh);
  }
  equipShield(id) {
    const def = ITEMS[id];
    if (!def) return;
    this.shieldDef = def;
    this.shieldMesh = buildItemMesh(def, this.world.palette);
    this.shieldMesh.position.set(0.05, -0.14, 0.02);
    this.shieldMesh.rotation.set(1.4, 0, 0);
    this.rig.joints.handL.add(this.shieldMesh);
  }

  get isHostileToPlayer() {
    const set = HOSTILE[this.faction];
    return !!(set && set.has(FACTION.PLAYER)) && !this.dead;
  }
  hostileTo(faction) {
    const set = HOSTILE[this.faction];
    return !!(set && set.has(faction));
  }

  // -------------------------------------------------------------------------
  /** How visible the player is to this actor right now, 0..1. */
  perceive(player, game) {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const sight = this.def.sight;
    if (dist > sight * 1.4) return 0;

    let v = 1 - dist / (sight * 1.2);
    // field of view
    const toA = Math.atan2(dx, dz);
    const fov = Math.abs(shortAngle(this.yaw, toA));
    v *= fov < 1.1 ? 1 : fov < 2.0 ? 0.45 : 0.12;
    // stealth
    if (player.crouching) {
      const sneak = game.stats.skills.sneak;
      let mult = 0.42 - sneak * 0.0026;
      if (game.stats.hasPerk('shadow')) mult *= 0.7;
      v *= clamp(mult, 0.06, 0.6);
    }
    // light level and weather
    const env = this.world.env;
    const dayF = saturate((env.sunDir.y + 0.1) / 0.3);
    v *= lerp(0.45, 1.0, dayF) + game.lightExposure * 0.5;
    v *= lerp(1.0, 0.6, env.fogAmount * 0.6 + env.rain * 0.3);
    // noise: sprinting is loud
    if (player.sprinting) v *= 1.9;
    if (game.lastNoise > 0) v += game.lastNoise * 0.6;
    return saturate(v);
  }

  // -------------------------------------------------------------------------
  update(dt, game) {
    const hf = this.world.hf;
    const player = game.player;
    this.stateTime += dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    this.staggered = Math.max(0, this.staggered - dt);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.dur -= dt;
      if (e.type === 'dot') this.hurt(e.power * dt, game, null, e.element, true);
      if (e.dur <= 0) this.effects.splice(i, 1);
    }
    const slow = this.effects.find(e => e.type === 'slow');
    const speedMul = slow ? clamp(1 - slow.power, 0.3, 1) : 1;

    if (this.dead) {
      this.deadTime += dt;
      this._groundClamp();
      this.anim.update(dt, { dead: true, speed01: 0 });
      this.model.position.copy(this.pos);
      this.model.rotation.y = this.yaw;
      return;
    }

    if (this.def.regen) this.health = Math.min(this.maxHealth, this.health + this.def.regen * dt);

    // ---- perception -------------------------------------------------------
    const dxp = player.pos.x - this.pos.x, dzp = player.pos.z - this.pos.z;
    const distP = Math.hypot(dxp, dzp);
    if (!this.def.passive || this.def.skittish) {
      const p = this.perceive(player, game);
      const hostile = this.isHostileToPlayer || game.bounty > 0 && this.faction === FACTION.TOWN && game.wanted;
      if (hostile) {
        this.alertness = clamp(this.alertness + (p > 0.25 ? p * dt * 1.6 : -dt * 0.35), 0, 1.6);
        if (p > 0.15) this.lastSeenPlayer = { x: player.pos.x, z: player.pos.z, t: 0 };
      } else if (this.def.skittish && distP < 18) {
        this.alertness = clamp(this.alertness + dt * 0.9, 0, 1.6);
      }
    }
    if (this.lastSeenPlayer) this.lastSeenPlayer.t += dt;

    // ---- state machine ------------------------------------------------------
    let moveTarget = null;
    let run = false;

    switch (this.state) {
      case 'dormant':
        // draugr wait in the dark until you get close
        if (distP < 9 && this.alertness > 0.15) { this._wake(game); }
        break;

      case 'idle':
        if (this.stateTime > this.rand.float(2.5, 7)) this._setState('wander');
        if (this.alertness > 0.6) this._setState('alert');
        break;

      case 'wander': {
        if (!this.wanderTarget || this.stateTime > 12) {
          const a = this.rand.float(0, TAU), r = this.rand.float(3, this.def.wander);
          const tx = this.home.x + Math.cos(a) * r, tz = this.home.z + Math.sin(a) * r;
          if (!hf.isWater(tx, tz) && hf.fastSlope(tx, tz) < 0.45) this.wanderTarget = { x: tx, z: tz };
          this.stateTime = 0;
        }
        if (this.wanderTarget) {
          moveTarget = this.wanderTarget;
          if (Math.hypot(this.pos.x - moveTarget.x, this.pos.z - moveTarget.z) < 1.4) {
            this.wanderTarget = null; this._setState('idle');
          }
        } else this._setState('idle');
        if (this.alertness > 0.6) this._setState('alert');
        break;
      }

      case 'alert':
        moveTarget = this.lastSeenPlayer;
        run = false;
        if (this.alertness > 1.0) {
          if (this.def.skittish) this._setState('flee');
          else { this._setState('chase'); game.onCombatStart?.(this); this.shout(game); }
        } else if (this.alertness < 0.25) this._setState('idle');
        break;

      case 'chase': {
        moveTarget = { x: player.pos.x, z: player.pos.z };
        run = true;
        const reach = this.def.reach;
        if (distP < reach * 0.92) this._setState('attack');
        if (this.alertness <= 0.1 && distP > this.def.sight) this._setState('idle');
        if (this.health < this.maxHealth * 0.16 && !this.def.undead && this.rand.bool(0.4)) this._setState('flee');
        break;
      }

      case 'attack': {
        const reach = this.def.reach;
        this.faceTowards(player.pos.x, player.pos.z, dt, 8);
        if (distP > reach * 1.25) { this._setState('chase'); break; }
        if (this.def.ranged) {
          if (distP < 8) { moveTarget = { x: this.pos.x - dxp, z: this.pos.z - dzp }; run = true; }
          if (this.attackCd <= 0 && this.staggered <= 0) {
            this.attackCd = this.rand.float(1.8, 3.0);
            this.anim.play('shoot', 0.5);
            game.combat.enemyShoot(this, player);
          }
        } else if (this.attackCd <= 0 && this.staggered <= 0) {
          this.attackCd = this.rand.float(1.2, 2.2) / (this.def.aggressive ? 1.15 : 1);
          const heavy = this.rand.bool(0.22);
          this.anim.play(heavy ? 'power' : (this.rand.bool(0.5) ? 'attack1' : 'attack2'), heavy ? 0.95 : 0.65);
          game.combat.enemyMelee(this, heavy ? 0.55 : 0.34, heavy ? 1.7 : 1.0);
        }
        // circle-strafe a little so fights read as fights
        if (this.attackCd > 0.5 && !this.def.ranged) {
          const side = (this.id % 2 ? 1 : -1);
          moveTarget = {
            x: player.pos.x - dxp / Math.max(distP, 1e-3) * reach * 0.85 - dzp / Math.max(distP, 1e-3) * side * 1.2,
            z: player.pos.z - dzp / Math.max(distP, 1e-3) * reach * 0.85 + dxp / Math.max(distP, 1e-3) * side * 1.2,
          };
        }
        break;
      }

      case 'flee': {
        const away = { x: this.pos.x - dxp * 2, z: this.pos.z - dzp * 2 };
        moveTarget = away; run = true;
        if (distP > this.def.sight * 1.2 || this.stateTime > 12) { this.alertness = 0; this._setState('idle'); }
        break;
      }

      case 'talk':
        this.faceTowards(player.pos.x, player.pos.z, dt, 6);
        break;
    }

    // ---- movement -------------------------------------------------------------
    let desiredSpeed = 0;
    if (moveTarget && this.staggered <= 0) {
      const tx = moveTarget.x - this.pos.x, tz = moveTarget.z - this.pos.z;
      const d = Math.hypot(tx, tz);
      if (d > 0.4) {
        let dirX = tx / d, dirZ = tz / d;
        // steer away from cliffs and water
        const ahead = 2.2;
        const px = this.pos.x + dirX * ahead, pz = this.pos.z + dirZ * ahead;
        if (hf.isWater(px, pz) || hf.fastSlope(px, pz) > 0.55) {
          const s = (this.id % 2 ? 1 : -1);
          const nx = -dirZ * s, nz = dirX * s;
          dirX = (dirX + nx * 1.6); dirZ = (dirZ + nz * 1.6);
          const l = Math.hypot(dirX, dirZ) || 1; dirX /= l; dirZ /= l;
        }
        desiredSpeed = (run ? this.def.runSpeed : this.def.speed) * speedMul;
        this.vel.x = damp(this.vel.x, dirX * desiredSpeed, 8, dt);
        this.vel.z = damp(this.vel.z, dirZ * desiredSpeed, 8, dt);
        if (this.state !== 'attack') this.faceTowards(this.pos.x + this.vel.x, this.pos.z + this.vel.z, dt, 7);
      } else {
        this.vel.x = damp(this.vel.x, 0, 10, dt);
        this.vel.z = damp(this.vel.z, 0, 10, dt);
      }
    } else {
      this.vel.x = damp(this.vel.x, 0, 12, dt);
      this.vel.z = damp(this.vel.z, 0, 12, dt);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // separation so a pack doesn't stack into one body
    for (const other of game.actors) {
      if (other === this || other.dead) continue;
      const ox = other.pos.x - this.pos.x, oz = other.pos.z - this.pos.z;
      const od = Math.hypot(ox, oz);
      const minD = this.radius + other.radius + 0.15;
      if (od < minD && od > 1e-4) {
        const push = (minD - od) * 0.5;
        this.pos.x -= ox / od * push;
        this.pos.z -= oz / od * push;
      }
    }

    this._groundClamp();
    this.speed01 = saturate(Math.hypot(this.vel.x, this.vel.z) / this.def.runSpeed);

    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw;
    this.anim.update(dt, {
      speed01: this.speed01,
      grounded: true,
      dead: false,
      blocking: this.blocking,
      aiming: this.def.ranged && this.state === 'attack',
      pitch: 0,
      turnRate: 0,
      windX: this.world.env.windX, windZ: this.world.env.windZ,
      windStrength: this.world.env.windStrength,
    });
    if (this.anim.stepEvent) {
      this.anim.stepEvent = null;
      if (distP < 26) game.audio.footstep(this.defId === 'troll' ? 'stone' : 'grass', 0.5 * this.speed01);
    }
  }

  _groundClamp() {
    if (this.interior) { this.pos.y = this.interiorY ?? 0; return; }
    const hf = this.world.hf;
    const g = hf.heightAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, g, 22, 1 / 60);
    if (Math.abs(this.pos.y - g) > 2) this.pos.y = g;
  }

  faceTowards(x, z, dt, rate = 6) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want, rate, dt);
  }

  _setState(s) { this.state = s; this.stateTime = 0; }

  _wake(game) {
    this._setState('alert');
    this.alertness = 1.1;
    game.audio.play('growl');
    this.anim.play('roar', 1.0);
  }

  shout(game) {
    if (this.def.undead) game.audio.play('growl');
    else if (this.def.kind === 'quad') game.audio.play('growl');
    else game.audio.play('growl');
    game.subtitle(this.name, this.def.undead ? '…' : this.rand.pick([
      'You picked the wrong road!', 'Kill them!', 'Blood and coin!', 'You die here.',
    ]), 2.2);
  }

  // -------------------------------------------------------------------------
  hurt(amount, game, source, element = 'physical', silent = false) {
    if (this.dead) return 0;
    let dmg = amount;
    if (this.blocking && source === game.player) dmg *= 0.35;
    if (this.def.undead && element === 'fire') dmg *= 1.35;
    if (this.defId === 'troll' && element === 'fire') dmg *= 1.6;
    this.health -= dmg;
    this.hitFlash = 1;
    if (!silent) {
      this.anim.play('hit', 0.35);
      this.alertness = 1.4;
      this.lastSeenPlayer = { x: game.player.pos.x, z: game.player.pos.z, t: 0 };
      if (this.state === 'idle' || this.state === 'wander' || this.state === 'dormant' || this.state === 'alert') {
        this._setState(this.def.skittish ? 'flee' : 'chase');
      }
      // Bystanders join in.
      for (const a of game.actors) {
        if (a === this || a.dead) continue;
        if (a.faction !== this.faction) continue;
        if (Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) > 24) continue;
        a.alertness = Math.max(a.alertness, 1.05);
        if (a.state === 'idle' || a.state === 'wander' || a.state === 'dormant') a._setState('alert');
      }
    }
    if (this.health <= 0) this.die(game, source);
    return dmg;
  }

  stagger(t = 0.7) { this.staggered = Math.max(this.staggered, t); this.anim.play('stagger', t); }

  die(game, source) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.state = 'dead';
    this.vel.set(0, 0, 0);
    game.onActorDied?.(this, source);
    if (this.def.loot) {
      this.lootItems = rollLoot(this.def.loot, this.rand, 1);
      if (this.def.weapon && this.rand.bool(0.35)) this.lootItems.push({ id: this.def.weapon, qty: 1 });
    }
  }

  dispose() {
    this.model.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose?.(); });
  }
}

// ---------------------------------------------------------------------------
// The dragon
// ---------------------------------------------------------------------------

export class Dragon {
  constructor(world, opts = {}) {
    this.world = world;
    this.id = _uid++;
    this.name = 'Skarnvald, the Ash-Wing';
    this.faction = FACTION.DRAGON;
    this.def = { name: this.name, sight: 220, reach: 6.5, xp: 900, loot: null };
    this.maxHealth = opts.health ?? 1400;
    this.health = this.maxHealth;
    this.damage = 46;
    this.level = 20;
    this.rand = new Rand(9001);

    this.pos = new THREE.Vector3(opts.x ?? 240, 260, opts.z ?? -1420);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.state = 'roost';
    this.stateTime = 0;
    this.dead = false;
    this.deadTime = 0;
    this.grounded = false;
    this.breathTimer = 0;
    this.hitFlash = 0;
    this.alertness = 0;
    this.radius = 3.4;
    this.height = 4.0;
    this.looted = false;
    this.awakened = false;

    this._build();
  }

  _build() {
    const P = this.world.palette;
    const scaleMat = P.ironDark.clone();
    scaleMat.color = new THREE.Color(0x3a3630);
    scaleMat.roughness = 0.72;
    scaleMat.metalness = 0.12;
    const membrane = P.leatherDark.clone();
    membrane.color = new THREE.Color(0x4b3a30);
    membrane.side = THREE.DoubleSide;

    const root = new THREE.Group();
    this.root = root;
    const S = 1.0;

    const body = new THREE.Group();
    root.add(body);
    this.body = body;

    const mk = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m); return m;
    };

    // torso
    mk(new THREE.CapsuleGeometry(1.5 * S, 3.6 * S, 4, 12), scaleMat, 0, 0, 0, Math.PI / 2, 0, 0);
    mk(new THREE.CapsuleGeometry(1.15 * S, 1.6 * S, 4, 10), scaleMat, 0, 0.1, 2.6 * S, Math.PI / 2, 0, 0);

    // neck + head
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.5 * S, 3.4 * S);
    body.add(this.neck);
    for (let i = 0; i < 5; i++) {
      mk(new THREE.CapsuleGeometry((0.62 - i * 0.07) * S, 0.7 * S, 3, 8), scaleMat,
        0, i * 0.30 * S, i * 0.82 * S, Math.PI / 2 - 0.28, 0, 0, this.neck);
    }
    this.head = new THREE.Group();
    this.head.position.set(0, 1.5 * S, 4.2 * S);
    this.neck.add(this.head);
    mk(new THREE.CapsuleGeometry(0.52 * S, 1.15 * S, 4, 10), scaleMat, 0, 0, 0.4 * S, Math.PI / 2, 0, 0, this.head);
    mk(new THREE.BoxGeometry(0.62 * S, 0.34 * S, 1.3 * S), scaleMat, 0, -0.16 * S, 1.15 * S, 0, 0, 0, this.head);
    for (const s of [1, -1]) {
      mk(new THREE.ConeGeometry(0.16 * S, 1.3 * S, 6), P.bone, s * 0.34 * S, 0.36 * S, -0.28 * S, -0.7, 0, s * 0.5, this.head);
      const eye = mk(new THREE.SphereGeometry(0.11 * S, 8, 6), P.emFire, s * 0.34 * S, 0.16 * S, 0.62 * S, 0, 0, 0, this.head);
    }
    this.mouth = new THREE.Object3D();
    this.mouth.position.set(0, -0.1 * S, 1.9 * S);
    this.head.add(this.mouth);

    // wings
    this.wings = [];
    for (const s of [1, -1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 1.2 * S, 0.7 * S, 0.6 * S);
      body.add(shoulder);
      const arm = mk(new THREE.CapsuleGeometry(0.20 * S, 3.0 * S, 3, 7), scaleMat, s * 1.6 * S, 0, 0, 0, 0, s * Math.PI / 2, shoulder);
      const elbow = new THREE.Group();
      elbow.position.set(s * 3.2 * S, 0, 0);
      shoulder.add(elbow);
      mk(new THREE.CapsuleGeometry(0.15 * S, 2.6 * S, 3, 6), scaleMat, s * 1.4 * S, 0, 0, 0, 0, s * Math.PI / 2, elbow);
      // membrane fans
      for (let f = 0; f < 4; f++) {
        const len = (3.4 - f * 0.5) * S;
        const fing = mk(new THREE.CapsuleGeometry(0.075 * S, len, 3, 5), P.bone,
          s * (len / 2) * Math.cos(f * 0.42), 0, -len / 2 * Math.sin(f * 0.42) - 0.2 * S,
          0, 0, s * (Math.PI / 2 - f * 0.42), elbow);
      }
      const memb = new THREE.PlaneGeometry(6.2 * S, 4.6 * S, 4, 4);
      const mm = mk(memb, membrane, s * 3.0 * S, 0, -1.9 * S, Math.PI / 2, 0, 0, elbow);
      mm.material = membrane;
      this.wings.push({ shoulder, elbow, side: s, membrane: mm });
    }

    // legs
    this.legs = [];
    for (const s of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.95 * S, -0.7 * S, -1.1 * S);
      body.add(hip);
      mk(new THREE.CapsuleGeometry(0.34 * S, 1.3 * S, 3, 7), scaleMat, 0, -0.7 * S, 0, 0, 0, 0, hip);
      const knee = new THREE.Group();
      knee.position.set(0, -1.5 * S, 0);
      hip.add(knee);
      mk(new THREE.CapsuleGeometry(0.24 * S, 1.2 * S, 3, 6), scaleMat, 0, -0.6 * S, 0, 0, 0, 0, knee);
      mk(new THREE.BoxGeometry(0.6 * S, 0.22 * S, 0.95 * S), scaleMat, 0, -1.25 * S, 0.25 * S, 0, 0, 0, knee);
      this.legs.push({ hip, knee, side: s });
    }

    // tail
    this.tail = [];
    let parent = body;
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? -0.1 * S : 0, i === 0 ? -2.6 * S : -1.0 * S);
      parent.add(seg);
      mk(new THREE.CapsuleGeometry((0.85 - i * 0.09) * S, 0.9 * S, 3, 7), scaleMat, 0, 0, -0.45 * S, Math.PI / 2, 0, 0, seg);
      if (i > 4) mk(new THREE.ConeGeometry(0.16 * S, 0.5 * S, 5), P.bone, 0, 0.4 * S, -0.4 * S, -0.3, 0, 0, seg);
      this.tail.push(seg);
      parent = seg;
    }
    // dorsal spines
    for (let i = 0; i < 9; i++) {
      mk(new THREE.ConeGeometry(0.13 * S, 0.6 * S, 5), P.bone, 0, 1.35 * S, (i - 4) * 0.62 * S, 0, 0, 0);
    }

    root.userData.actor = this;
    root.traverse(o => { if (o.isMesh) o.userData.actor = this; });
    this.model = root;
    this.model.position.copy(this.pos);
  }

  get isHostileToPlayer() { return this.awakened && !this.dead; }

  awaken(game) {
    if (this.awakened) return;
    this.awakened = true;
    this.state = 'takeoff';
    this.stateTime = 0;
    game.audio.play('dragonRoar');
    game.notify('THE ASH-WING WAKES', 'Skarnvald takes the air.', 'quest');
    game.audio.setMood('combat', 1);
  }

  update(dt, game) {
    const player = game.player;
    this.stateTime += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const hf = this.world.hf;

    if (this.dead) {
      this.deadTime += dt;
      const g = hf.heightAt(this.pos.x, this.pos.z);
      this.pos.y = damp(this.pos.y, g + 1.2, 3, dt);
      this.pitch = damp(this.pitch, 0.2, 2, dt);
      this.roll = damp(this.roll, 0.9, 2, dt);
      this._applyTransform();
      this._poseWings(dt, 0, true);
      return;
    }

    const toP = new THREE.Vector3(player.pos.x - this.pos.x, player.pos.y - this.pos.y, player.pos.z - this.pos.z);
    const distP = toP.length();

    if (!this.awakened) {
      if (distP < 90) this.awaken(game);
      this._poseWings(dt, 0, true);
      this._applyTransform();
      return;
    }

    let targetPos = null;
    let speed = 0;
    let flap = 1;

    switch (this.state) {
      case 'takeoff':
        targetPos = new THREE.Vector3(this.pos.x, hf.heightAt(this.pos.x, this.pos.z) + 70, this.pos.z);
        speed = 16; flap = 1.6;
        if (this.stateTime > 3) this._set('circle');
        break;

      case 'circle': {
        const a = this.stateTime * 0.35;
        const R = 62;
        targetPos = new THREE.Vector3(
          player.pos.x + Math.cos(a) * R,
          hf.heightAt(player.pos.x, player.pos.z) + 48 + Math.sin(a * 1.7) * 8,
          player.pos.z + Math.sin(a) * R);
        speed = 24; flap = 1;
        this.breathTimer -= dt;
        if (this.stateTime > 6 && this.breathTimer <= 0) this._set('strafe');
        if (this.health < this.maxHealth * 0.35 && this.stateTime > 5) this._set('land');
        break;
      }

      case 'strafe': {
        const ahead = new THREE.Vector3(player.pos.x, hf.heightAt(player.pos.x, player.pos.z) + 22, player.pos.z);
        targetPos = ahead;
        speed = 34; flap = 0.35;
        if (distP < 60 && this.stateTime > 0.6 && !this._breathing) {
          this._breathing = true;
          game.audio.play('fireBreath');
          game.combat.dragonBreath(this, 2.0);
        }
        if (this.stateTime > 3.4) { this._breathing = false; this.breathTimer = 7; this._set('circle'); }
        break;
      }

      case 'land': {
        const spot = hf.findFlat(player.pos.x, player.pos.z, 28, 0.3, 24, () => this.rand.next());
        this._landSpot = this._landSpot || spot;
        targetPos = new THREE.Vector3(this._landSpot.x, this._landSpot.y + 2.4, this._landSpot.z);
        speed = 20; flap = 1.5;
        if (this.pos.distanceTo(targetPos) < 5) { this.grounded = true; this._set('ground'); game.player.addShake(0.9); }
        break;
      }

      case 'ground': {
        this.grounded = true;
        const g = hf.heightAt(this.pos.x, this.pos.z);
        this.pos.y = damp(this.pos.y, g + 2.3, 6, dt);
        const flat = Math.hypot(toP.x, toP.z);
        if (flat > 8) {
          const dir = new THREE.Vector3(toP.x, 0, toP.z).normalize();
          this.pos.x += dir.x * 5.5 * dt;
          this.pos.z += dir.z * 5.5 * dt;
        }
        this.yaw = dampAngle(this.yaw, Math.atan2(toP.x, toP.z), 3, dt);
        this.pitch = damp(this.pitch, 0, 3, dt);
        this.roll = damp(this.roll, 0, 3, dt);
        this.breathTimer -= dt;
        if (flat < 12 && this.breathTimer <= 0) {
          this.breathTimer = 4.5;
          game.audio.play('fireBreath');
          game.combat.dragonBreath(this, 1.6);
        }
        if (flat < 7 && this.stateTime > 1.5 && this.rand.bool(dt * 1.2)) {
          game.combat.dragonBite(this);
        }
        if (this.stateTime > 14 || this.health < this.maxHealth * 0.12) {
          this._landSpot = null; this.grounded = false; this._set('takeoff');
        }
        this._poseWings(dt, 0.15, false);
        this._applyTransform();
        return;
      }
    }

    if (targetPos) {
      const to = targetPos.clone().sub(this.pos);
      const d = to.length();
      if (d > 0.001) {
        to.normalize();
        this.vel.lerp(to.multiplyScalar(speed), 1 - Math.exp(-dt * 1.4));
      }
      this.pos.addScaledVector(this.vel, dt);
      const ground = hf.heightAt(this.pos.x, this.pos.z) + 12;
      if (this.pos.y < ground) this.pos.y = damp(this.pos.y, ground, 4, dt);
      const want = Math.atan2(this.vel.x, this.vel.z);
      this.yaw = dampAngle(this.yaw, want, 2.2, dt);
      const horiz = Math.hypot(this.vel.x, this.vel.z);
      this.pitch = damp(this.pitch, clamp(-Math.atan2(this.vel.y, Math.max(horiz, 0.1)), -0.7, 0.7), 2.5, dt);
      this.roll = damp(this.roll, clamp(shortAngle(this.yaw, want) * -2.4, -0.9, 0.9), 2.2, dt);
    }

    this._poseWings(dt, flap, false);
    this._applyTransform();

    if (distP < 140 && this.rand.bool(dt * 0.08)) game.audio.play('dragonRoar');
  }

  _set(s) { this.state = s; this.stateTime = 0; this._breathing = false; }

  _poseWings(dt, flapRate, folded) {
    this._flapT = (this._flapT ?? 0) + dt * (2.0 + flapRate * 2.4);
    const f = Math.sin(this._flapT);
    for (const w of this.wings) {
      if (folded) {
        w.shoulder.rotation.z = damp(w.shoulder.rotation.z, w.side * 1.15, 4, dt);
        w.shoulder.rotation.x = damp(w.shoulder.rotation.x, 0.4, 4, dt);
        w.elbow.rotation.z = damp(w.elbow.rotation.z, -w.side * 2.0, 4, dt);
      } else {
        w.shoulder.rotation.z = w.side * (f * 0.55 * flapRate + 0.06);
        w.shoulder.rotation.x = -f * 0.16 * flapRate;
        w.elbow.rotation.z = -w.side * (0.18 + f * 0.22 * flapRate);
      }
    }
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      seg.rotation.y = Math.sin(this._flapT * 0.6 - i * 0.4) * 0.10;
      seg.rotation.x = Math.sin(this._flapT * 0.45 - i * 0.3) * 0.07 + 0.03;
    }
    for (const l of this.legs) {
      const want = this.grounded ? 0.1 : 0.85;
      l.hip.rotation.x = damp(l.hip.rotation.x, want, 3, dt);
      l.knee.rotation.x = damp(l.knee.rotation.x, this.grounded ? -0.25 : -1.5, 3, dt);
    }
    this.neck.rotation.x = damp(this.neck.rotation.x, this.grounded ? -0.35 : -0.12, 3, dt);
  }

  _applyTransform() {
    this.model.position.copy(this.pos);
    this.model.rotation.set(0, 0, 0);
    this.model.rotateY(this.yaw);
    this.model.rotateX(this.pitch);
    this.model.rotateZ(this.roll);
  }

  /** World position of the mouth, for the fire breath origin. */
  mouthWorld(out = new THREE.Vector3()) {
    this.mouth.getWorldPosition(out);
    return out;
  }

  hurt(amount, game, source, element = 'physical') {
    if (this.dead) return 0;
    let dmg = amount;
    if (element === 'frost') dmg *= 1.25;
    if (element === 'fire') dmg *= 0.35;
    // Far harder to wound on the wing.
    if (!this.grounded) dmg *= 0.55;
    this.health -= dmg;
    this.hitFlash = 1;
    if (!this.awakened) this.awaken(game);
    if (this.health <= 0) this.die(game, source);
    return dmg;
  }

  die(game, source) {
    this.dead = true;
    this.health = 0;
    this.state = 'dead';
    game.audio.play('dragonRoar');
    game.onActorDied?.(this, source);
    this.lootItems = [{ id: 'dragonScale', qty: 3 }, { id: 'gold', qty: 400 }];
  }
}
