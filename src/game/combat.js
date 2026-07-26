/**
 * WYRMHOLD — combat, projectiles, magic and effects.
 *
 * Melee is swept-sphere against actor capsules with timing windows lifted from
 * the animation, so a swing connects when the blade is actually out. Archery
 * and spells are real projectiles with gravity and drag. Everything that hits
 * spawns particles from one pooled GPU system.
 */

import * as THREE from 'three';
import { ITEMS, SLOT } from './items.js';
import { clamp, saturate, lerp, TAU, PI, Rand } from '../core/math.js';
import { settings } from '../core/settings.js';

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

const PARTICLE_VERT = /* glsl */`
attribute vec3 aVel;
attribute vec4 aData;      // x: birth, y: life, z: size, w: drag
attribute vec4 aColor;
uniform float uTime;
uniform float uGravity;
uniform float uPixelScale;
varying vec4 vColor;
varying float vLife;
void main(){
  float age = uTime - aData.x;
  float t = age / max(aData.y, 1e-3);
  if (t < 0.0 || t > 1.0){
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // cull offscreen
    gl_PointSize = 0.0;
    vColor = vec4(0.0);
    vLife = 1.0;
    return;
  }
  // analytic integration of velocity with linear drag + gravity
  float d = aData.w;
  vec3 p = position;
  float k = (1.0 - exp(-d * age)) / max(d, 1e-4);
  p += aVel * k;
  p.y += 0.5 * uGravity * aData.z * age * age * -1.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float grow = mix(1.0, 2.4, t);
  gl_PointSize = max(1.0, aData.z * grow * uPixelScale / max(-mv.z, 0.1));
  vColor = aColor;
  vLife = t;
}
`;

const PARTICLE_FRAG = /* glsl */`
precision highp float;
varying vec4 vColor;
varying float vLife;
uniform float uSoft;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 1.6) * vColor.a;
  a *= (1.0 - vLife) * (1.0 - vLife * 0.35);
  vec3 c = vColor.rgb;
  gl_FragColor = vec4(c, a);
}
`;

class ParticleGroup {
  constructor(capacity, additive, gravityScale) {
    this.capacity = capacity;
    this.head = 0;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.data = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uTime: { value: 0 }, uGravity: { value: gravityScale }, uPixelScale: { value: 600 },
        uSoft: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  emit(x, y, z, vx, vy, vz, life, size, drag, r, g, b, a, time) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.data[i * 4] = time; this.data[i * 4 + 1] = life; this.data[i * 4 + 2] = size; this.data[i * 4 + 3] = drag;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aVel.needsUpdate = true;
    this.geo.attributes.aData.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.dirty = false;
  }
}

export class Particles {
  constructor(scene) {
    const budget = settings.get('particleQuality');
    this.additive = new ParticleGroup(Math.round(4000 * budget), true, 1);
    this.alpha = new ParticleGroup(Math.round(3000 * budget), false, 1);
    this.group = new THREE.Group();
    this.group.name = 'particles';
    this.group.add(this.additive.points, this.alpha.points);
    scene.add(this.group);
    this.time = 0;
    this.rand = new Rand(4711);
  }

  update(dt, camera, height) {
    this.time += dt;
    for (const g of [this.additive, this.alpha]) {
      g.mat.uniforms.uTime.value = this.time;
      g.mat.uniforms.uPixelScale.value = height * 0.9;
      g.flush();
    }
  }

  spark(x, y, z, count, colour = [1, 0.7, 0.3], spread = 3, life = 0.5, size = 0.06) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      this.additive.emit(x, y, z,
        r.gauss(0, spread), r.gauss(spread * 0.4, spread), r.gauss(0, spread),
        life * r.float(0.5, 1.3), size * r.float(0.6, 1.5), 3.5,
        colour[0], colour[1], colour[2], 1, this.time);
    }
  }
  blood(x, y, z, count = 14) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      this.alpha.emit(x, y, z,
        r.gauss(0, 2.4), r.gauss(1.6, 1.6), r.gauss(0, 2.4),
        r.float(0.5, 1.1), r.float(0.05, 0.13), 1.6,
        0.36, 0.045, 0.03, 0.95, this.time);
    }
  }
  smoke(x, y, z, count = 6, colour = [0.35, 0.34, 0.32], size = 0.6, life = 2.2) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      this.alpha.emit(x, y, z,
        r.gauss(0, 0.5), r.float(0.6, 1.6), r.gauss(0, 0.5),
        life * r.float(0.7, 1.4), size * r.float(0.7, 1.6), 0.7,
        colour[0], colour[1], colour[2], 0.42, this.time);
    }
  }
  fire(x, y, z, count = 4, scale = 1) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      const t = r.next();
      this.additive.emit(x + r.gauss(0, 0.12 * scale), y, z + r.gauss(0, 0.12 * scale),
        r.gauss(0, 0.35 * scale), r.float(1.0, 2.4) * scale, r.gauss(0, 0.35 * scale),
        r.float(0.35, 0.8), r.float(0.12, 0.3) * scale, 2.2,
        1.0, lerp(0.75, 0.25, t), lerp(0.3, 0.05, t), 0.85, this.time);
    }
  }
  magic(x, y, z, count, colour, spread = 1.2, life = 0.8, size = 0.13) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      this.additive.emit(x, y, z,
        r.gauss(0, spread), r.gauss(spread * 0.3, spread), r.gauss(0, spread),
        life * r.float(0.6, 1.4), size * r.float(0.6, 1.5), 2.4,
        colour[0], colour[1], colour[2], 0.95, this.time);
    }
  }
  dust(x, y, z, count = 8) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      this.alpha.emit(x, y, z, r.gauss(0, 1.1), r.float(0.2, 1.0), r.gauss(0, 1.1),
        r.float(0.7, 1.6), r.float(0.15, 0.42), 1.4, 0.42, 0.38, 0.32, 0.36, this.time);
    }
  }
  snowPuff(x, y, z, count = 10) {
    const r = this.rand;
    for (let i = 0; i < count; i++) {
      this.alpha.emit(x, y, z, r.gauss(0, 1.0), r.float(0.4, 1.4), r.gauss(0, 1.0),
        r.float(0.8, 1.8), r.float(0.12, 0.34), 1.2, 0.86, 0.9, 0.98, 0.6, this.time);
    }
  }
}

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

export const SPELLS = {
  firebolt: {
    name: 'Firebolt', school: 'destruction', element: 'fire', icon: '🔥',
    cost: 22, damage: 26, speed: 34, projectile: true, colour: [1.0, 0.45, 0.12],
    desc: 'A bolt of fire. Lingering burn.', dot: { power: 6, dur: 4 },
  },
  frostbite: {
    name: 'Frostbite', school: 'destruction', element: 'frost', icon: '❄️',
    cost: 18, damage: 14, range: 11, stream: true, colour: [0.45, 0.78, 1.0],
    desc: 'A freezing stream. Slows what it touches.', slow: { power: 0.45, dur: 3 },
  },
  sparks: {
    name: 'Sparks', school: 'destruction', element: 'shock', icon: '⚡',
    cost: 20, damage: 17, range: 14, stream: true, colour: [0.72, 0.6, 1.0],
    desc: 'Lightning that drinks magicka.',
  },
  healing: {
    name: 'Healing', school: 'restoration', element: 'heal', icon: '✨',
    cost: 26, heal: 42, self: true, colour: [0.55, 1.0, 0.62],
    desc: 'Mends your wounds while you concentrate.',
  },
  ward: {
    name: 'Lesser Ward', school: 'restoration', element: 'ward', icon: '🔰',
    cost: 12, ward: 0.55, sustain: true, colour: [0.6, 0.85, 1.0],
    desc: 'A shield of will against blade and spell.',
  },
  flames: {
    name: 'Flames', school: 'destruction', element: 'fire', icon: '🕯️',
    cost: 14, damage: 20, range: 9, stream: true, colour: [1.0, 0.55, 0.15],
    desc: 'A gout of flame. Cheap and close.', dot: { power: 5, dur: 3 },
  },
};

// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.projectiles = [];
    this.rand = new Rand(1234);
    this.particles = new Particles(this.world.scene);
    this.attackWindow = null;      // { start, end, t, damage, reach, arc, heavy, hits:Set }
    this.hitStop = 0;
    this._arrowGeo = null;
    this._pool = [];
    this.group = new THREE.Group();
    this.group.name = 'projectiles';
    this.world.scene.add(this.group);
  }

  // -------------------------------------------------------------------------
  // Player melee
  // -------------------------------------------------------------------------
  playerAttack(heavy = false) {
    const g = this.game, p = g.player, st = g.stats;
    if (p.anim.busy || g.dialogueOpen) return false;
    const wDef = g.inventory.equippedDef(SLOT.WEAPON);
    if (wDef && wDef.ranged) return this.startDraw();
    const cost = heavy ? 28 : 12;
    if (st.stamina < cost * 0.5) return false;
    st.useStamina(cost);

    const dur = heavy ? 0.95 : 0.62;
    p.anim.play(heavy ? 'power' : (this._alt = !this._alt) ? 'attack1' : 'attack2', dur);
    g.audio.play('swing', { heavy });

    const base = wDef ? wDef.damage : 7;
    const skill = st.skills.oneHanded;
    let dmg = base * (1 + skill * 0.011) * (heavy ? 1.85 : 1);
    if (st.hasPerk('bladesman')) dmg *= 1.2;
    if (heavy && st.hasPerk('savagery')) dmg *= 1.4;
    dmg *= st.diff.dmgDealt;

    this.attackWindow = {
      t: 0, start: heavy ? 0.42 : 0.26, end: heavy ? 0.68 : 0.46,
      damage: dmg, reach: (wDef?.reach ?? 1.5) + 0.55, arc: heavy ? 1.5 : 1.15,
      heavy, hits: new Set(), element: wDef?.enchant?.element, enchant: wDef?.enchant,
    };
    return true;
  }

  startDraw() {
    const g = this.game;
    if (g.drawing) return false;
    const wDef = g.inventory.equippedDef(SLOT.WEAPON);
    if (!wDef || !wDef.ranged) return false;
    if (!g.inventory.has('arrow') && !g.inventory.has('steelArrow')) {
      g.notify('No arrows', '', 'skill');
      return false;
    }
    g.drawing = true;
    g.drawTime = 0;
    g.audio.play('bowDraw');
    return true;
  }

  releaseDraw() {
    const g = this.game, p = g.player, st = g.stats;
    if (!g.drawing) return;
    g.drawing = false;
    const wDef = g.inventory.equippedDef(SLOT.WEAPON);
    if (!wDef) return;
    const charge = saturate(g.drawTime / (1.0 / (wDef.speed || 1)));
    if (charge < 0.18) return;

    const ammoId = g.inventory.has('steelArrow') ? 'steelArrow' : 'arrow';
    if (!g.inventory.has(ammoId)) return;
    g.inventory.remove(ammoId, 1);

    p.anim.play('shoot', 0.4);
    g.audio.play('bowRelease');
    const skill = st.skills.archery;
    let dmg = (wDef.damage + (ITEMS[ammoId].damage || 0)) * (0.35 + charge * 0.85) * (1 + skill * 0.012);
    if (st.hasPerk('deadeye')) dmg *= 1.3;
    dmg *= st.diff.dmgDealt;

    const dir = p.aimDir(_v1).clone();
    this._applyAimAssist(dir, p);
    const origin = p.camera.position.clone().addScaledVector(dir, 0.6);
    this.spawnProjectile({
      kind: 'arrow', origin, dir, speed: 46 + charge * 34, damage: dmg,
      gravity: 9.0, owner: 'player', skill: 'archery',
    });
    p.addShake(0.12);
  }

  _applyAimAssist(dir, p) {
    const amount = settings.get('aimAssist') * (settings.effectivePlatform === 'mobile' ? 1.4 : 1);
    if (amount <= 0.01) return;
    let best = null, bestDot = 0.955 - amount * 0.06;
    for (const a of this.game.allTargets()) {
      if (a.dead || !a.isHostileToPlayer) continue;
      _v2.set(a.pos.x, a.pos.y + a.height * 0.55, a.pos.z).sub(p.camera.position);
      const d = _v2.length();
      if (d > 70) continue;
      _v2.divideScalar(d);
      const dot = _v2.dot(dir);
      if (dot > bestDot) { bestDot = dot; best = _v2.clone(); }
    }
    if (best) dir.lerp(best, amount * 0.65).normalize();
  }

  // -------------------------------------------------------------------------
  // Spells
  // -------------------------------------------------------------------------
  castSpell(id, sustained = false) {
    const g = this.game, p = g.player, st = g.stats;
    const sp = SPELLS[id];
    if (!sp) return false;
    let cost = sp.cost * (st.hasPerk('novice') && sp.school === 'destruction' ? 0.8 : 1);
    if (sp.stream || sp.self || sp.sustain) cost *= 0.55;

    if (sp.stream || sp.self || sp.sustain) {
      if (!st.useMagicka(cost * (1 / 60) * 60 * g.dt)) return false;
    } else {
      if (!st.useMagicka(cost)) { g.notify('Not enough magicka', '', 'skill'); return false; }
    }

    const dir = p.aimDir(_v1).clone();
    const origin = p.camera.position.clone().addScaledVector(dir, 0.55);

    if (sp.self) {
      const amt = sp.heal * g.dt * 1.6 * (1 + st.skills.restoration * 0.012);
      st.heal(amt);
      this.particles.magic(p.pos.x, p.pos.y + 1.1, p.pos.z, 2, sp.colour, 0.6, 0.7, 0.1);
      st.gainSkill('restoration', 5 * g.dt);
      return true;
    }
    if (sp.sustain) {
      g.wardActive = sp.ward;
      this.particles.magic(origin.x, origin.y, origin.z, 1, sp.colour, 0.4, 0.4, 0.16);
      st.gainSkill('restoration', 2.5 * g.dt);
      return true;
    }
    if (sp.stream) {
      this._stream(sp, origin, dir);
      return true;
    }

    // projectile
    this._applyAimAssist(dir, p);
    p.anim.play('castfire', 0.5);
    g.audio.play('cast', { element: sp.element });
    this.spawnProjectile({
      kind: 'spell', spell: sp, origin, dir, speed: sp.speed, damage: sp.damage * (1 + st.skills.destruction * 0.013) * st.diff.dmgDealt,
      gravity: 0.6, owner: 'player', skill: 'destruction', colour: sp.colour,
    });
    return true;
  }

  _stream(sp, origin, dir) {
    const g = this.game, st = g.stats;
    const range = sp.range;
    this.particles.magic(
      origin.x + dir.x * 0.7, origin.y + dir.y * 0.7, origin.z + dir.z * 0.7,
      Math.round(6 * settings.get('particleQuality')), sp.colour, 1.0, 0.35, 0.16);
    for (let i = 1; i <= 5; i++) {
      const t = i / 5 * range;
      this.particles.magic(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t,
        2, sp.colour, 1.4, 0.3, 0.12);
    }
    if (!this._streamSfxT || g.time - this._streamSfxT > 0.35) {
      this._streamSfxT = g.time;
      g.audio.play('cast', { element: sp.element });
    }
    // damage in a cone
    for (const a of g.allTargets()) {
      if (a.dead) continue;
      _v2.set(a.pos.x - origin.x, a.pos.y + a.height * 0.5 - origin.y, a.pos.z - origin.z);
      const d = _v2.length();
      if (d > range) continue;
      _v2.divideScalar(d);
      if (_v2.dot(dir) < 0.86) continue;
      const dmg = sp.damage * g.dt * (1 + st.skills.destruction * 0.013) * st.diff.dmgDealt
        * (st.hasPerk('augFire') && sp.element === 'fire' ? 1.4 : 1);
      this.applyDamage(a, dmg, 'player', sp.element, false, true);
      if (sp.slow) a.effects.push({ type: 'slow', power: sp.slow.power * (st.hasPerk('augFrost') ? 1.6 : 1), dur: sp.slow.dur });
      if (sp.dot && this.rand.bool(g.dt * 2)) a.effects.push({ type: 'dot', power: sp.dot.power, dur: sp.dot.dur, element: sp.element });
      if (sp.element === 'shock') g.stats.magicka = Math.min(g.stats.maxMagicka, g.stats.magicka + dmg * 0.12);
      st.gainSkill('destruction', 6 * g.dt);
    }
  }

  // -------------------------------------------------------------------------
  // Projectiles
  // -------------------------------------------------------------------------
  spawnProjectile(opts) {
    const p = {
      kind: opts.kind, spell: opts.spell || null,
      pos: opts.origin.clone(), vel: opts.dir.clone().multiplyScalar(opts.speed),
      damage: opts.damage, gravity: opts.gravity, owner: opts.owner, life: 8,
      skill: opts.skill, colour: opts.colour || [1, 1, 1], trail: 0,
    };
    if (opts.kind === 'arrow') {
      if (!this._arrowGeo) {
        const g = new THREE.CylinderGeometry(0.008, 0.008, 0.75, 5);
        g.rotateX(Math.PI / 2);
        this._arrowGeo = g;
        this._fletchGeo = new THREE.BoxGeometry(0.001, 0.05, 0.12);
      }
      const m = new THREE.Mesh(this._arrowGeo, this.world.palette.iron);
      const f = new THREE.Mesh(this._fletchGeo, this.world.palette.clothCream);
      f.position.z = -0.3;
      m.add(f);
      m.castShadow = false;
      this.group.add(m);
      p.mesh = m;
    } else {
      const geo = new THREE.IcosahedronGeometry(0.16, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(p.colour[0], p.colour[1], p.colour[2]),
        transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      this.group.add(m);
      p.mesh = m;
      p.light = { color: p.colour, intensity: 3 };
    }
    this.projectiles.push(p);
    return p;
  }

  _updateProjectiles(dt) {
    const g = this.game, hf = this.world.hf;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      const prev = _v3.copy(p.pos);
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);

      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        if (p.kind === 'arrow') p.mesh.lookAt(p.pos.clone().add(p.vel));
        else {
          p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 8;
          this.particles.magic(p.pos.x, p.pos.y, p.pos.z, 1, p.colour, 0.5, 0.35, 0.12);
        }
      }

      let hit = null;
      // actors
      const targets = p.owner === 'player' ? g.allTargets() : [g.playerTarget];
      for (const a of targets) {
        if (!a || a.dead) continue;
        if (p.owner === 'player' && a.faction === 'player') continue;
        const cx = a.pos.x, cy = a.pos.y + a.height * 0.5, cz = a.pos.z;
        const r = (a.radius || 0.4) + 0.28;
        // segment vs sphere
        const dx = p.pos.x - prev.x, dy = p.pos.y - prev.y, dz = p.pos.z - prev.z;
        const fx = prev.x - cx, fy = prev.y - cy, fz = prev.z - cz;
        const aa = dx * dx + dy * dy + dz * dz;
        const bb = 2 * (fx * dx + fy * dy + fz * dz);
        const cc = fx * fx + fy * fy + fz * fz - r * r;
        const disc = bb * bb - 4 * aa * cc;
        if (disc >= 0 && aa > 1e-8) {
          const t = (-bb - Math.sqrt(disc)) / (2 * aa);
          if (t >= 0 && t <= 1) { hit = a; break; }
        }
      }

      // terrain / props
      if (!hit) {
        const gh = hf.heightAt(p.pos.x, p.pos.z);
        if (p.pos.y <= gh) hit = 'ground';
        else if (g.hitsProp(p.pos)) hit = 'prop';
      }

      if (hit || p.life <= 0) {
        if (hit && hit !== 'ground' && hit !== 'prop') {
          this._projectileHit(p, hit);
        } else if (hit) {
          if (p.spell) {
            this._spellBurst(p.pos, p.spell);
            g.audio.play('impactMagic', { element: p.spell.element });
          } else {
            this.particles.dust(p.pos.x, p.pos.y, p.pos.z, 4);
            g.audio.play('arrowHit');
          }
        }
        if (p.mesh) { this.group.remove(p.mesh); p.mesh.material.dispose?.(); }
        this.projectiles.splice(i, 1);
      }
    }
  }

  _projectileHit(p, target) {
    const g = this.game;
    if (p.owner === 'player') {
      let dmg = p.damage;
      const sneakMul = g.player.crouching && target.alertness < 0.6 ? (g.stats.hasPerk('backstab') ? 4 : 2.5) : 1;
      dmg *= sneakMul;
      this.applyDamage(target, dmg, 'player', p.spell ? p.spell.element : 'physical', sneakMul > 1);
      if (p.spell?.dot) target.effects.push({ type: 'dot', power: p.spell.dot.power, dur: p.spell.dot.dur, element: p.spell.element });
      if (p.skill) g.stats.gainSkill(p.skill, 14);
    } else {
      const dmg = g.applyPlayerDamage(p.damage, p.spell ? p.spell.element : 'physical', p);
    }
    if (p.spell) {
      this._spellBurst(p.pos, p.spell);
      g.audio.play('impactMagic', { element: p.spell.element });
    } else {
      this.particles.blood(p.pos.x, p.pos.y, p.pos.z, 10);
      g.audio.play('arrowHit');
    }
  }

  _spellBurst(pos, sp) {
    const n = Math.round(28 * settings.get('particleQuality'));
    this.particles.magic(pos.x, pos.y, pos.z, n, sp.colour, 4.5, 0.7, 0.2);
    if (sp.element === 'fire') {
      this.particles.fire(pos.x, pos.y, pos.z, Math.round(14 * settings.get('particleQuality')), 1.4);
      this.particles.smoke(pos.x, pos.y + 0.3, pos.z, 6, [0.22, 0.2, 0.19], 0.8, 2.4);
    }
  }

  // -------------------------------------------------------------------------
  // Enemy attacks
  // -------------------------------------------------------------------------
  enemyMelee(actor, delay, mult) {
    setTimeout(() => {
      if (actor.dead) return;
      const g = this.game, p = g.player;
      const d = Math.hypot(p.pos.x - actor.pos.x, p.pos.z - actor.pos.z);
      if (d > actor.def.reach * 1.35) return;
      // must still be facing us
      const toA = Math.atan2(p.pos.x - actor.pos.x, p.pos.z - actor.pos.z);
      if (Math.abs(((toA - actor.yaw + PI * 3) % TAU) - PI) > 1.1) return;
      g.audio.play('swing', { heavy: mult > 1.2 });
      g.applyPlayerDamage(actor.damage * mult, 'physical', actor);
    }, delay * 1000);
  }

  enemyShoot(actor, player) {
    const dir = _v1.set(
      player.pos.x - actor.pos.x,
      (player.pos.y + 1.2) - (actor.pos.y + 1.4),
      player.pos.z - actor.pos.z).normalize();
    // lead the shot slightly and scatter by skill
    dir.x += this.rand.gauss(0, 0.045);
    dir.y += this.rand.gauss(0.03, 0.03);
    dir.z += this.rand.gauss(0, 0.045);
    dir.normalize();
    this.spawnProjectile({
      kind: 'arrow', origin: new THREE.Vector3(actor.pos.x, actor.pos.y + 1.45, actor.pos.z),
      dir, speed: 40, damage: actor.damage, gravity: 9.0, owner: 'enemy',
    });
    this.game.audio.play('bowRelease');
  }

  dragonBreath(dragon, duration) {
    const g = this.game;
    const start = g.time;
    const tick = () => {
      if (dragon.dead || g.time - start > duration) return;
      const origin = dragon.mouthWorld(_v1).clone();
      const dir = new THREE.Vector3(
        g.player.pos.x - origin.x,
        (g.player.pos.y + 1.0) - origin.y,
        g.player.pos.z - origin.z).normalize();
      const n = Math.round(10 * settings.get('particleQuality'));
      for (let i = 0; i < n; i++) {
        const t = this.rand.float(0, 26);
        const spread = t * 0.09;
        this.particles.additive.emit(
          origin.x + dir.x * t + this.rand.gauss(0, spread),
          origin.y + dir.y * t + this.rand.gauss(0, spread),
          origin.z + dir.z * t + this.rand.gauss(0, spread),
          dir.x * 8 + this.rand.gauss(0, 3), dir.y * 8 + this.rand.gauss(1, 3), dir.z * 8 + this.rand.gauss(0, 3),
          this.rand.float(0.4, 0.9), this.rand.float(0.3, 0.8), 2.0,
          1.0, this.rand.float(0.35, 0.7), 0.12, 0.85, this.particles.time);
      }
      // damage anything in the cone
      const range = 30;
      const check = (target, isPlayer) => {
        const cx = isPlayer ? g.player.pos.x : target.pos.x;
        const cy = (isPlayer ? g.player.pos.y + 1.0 : target.pos.y + target.height * 0.5);
        const cz = isPlayer ? g.player.pos.z : target.pos.z;
        _v2.set(cx - origin.x, cy - origin.y, cz - origin.z);
        const d = _v2.length();
        if (d > range) return;
        _v2.divideScalar(d);
        if (_v2.dot(dir) < 0.90) return;
        if (isPlayer) g.applyPlayerDamage(52 * g.dt, 'fire', dragon);
        else this.applyDamage(target, 40 * g.dt, 'dragon', 'fire', false, true);
      };
      check(null, true);
      for (const a of g.actors) if (!a.dead && a.faction !== 'dragon') check(a, false);
      requestAnimationFrame(tick);
    };
    tick();
  }

  dragonBite(dragon) {
    const g = this.game;
    g.audio.play('hitFlesh');
    g.applyPlayerDamage(dragon.damage, 'physical', dragon);
    g.player.addShake(0.7);
  }

  // -------------------------------------------------------------------------
  applyDamage(target, amount, source, element = 'physical', crit = false, silent = false) {
    const g = this.game;
    const dealt = target.hurt(amount, g, source === 'player' ? g.player : source, element, silent);
    if (dealt <= 0) return 0;
    if (!silent) {
      const y = target.pos.y + target.height * 0.7;
      g.floatDamage(target.pos.x, y, target.pos.z, Math.round(dealt), crit ? 'crit' : element === 'physical' ? 'dmg' : 'magic');
      this.particles.blood(target.pos.x, y, target.pos.z, crit ? 22 : 12);
      g.audio.play('hitFlesh', { crit });
      this.hitStop = Math.max(this.hitStop, crit ? 0.09 : 0.05);
      g.player.addShake(crit ? 0.35 : 0.16);
    }
    return dealt;
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    this._updateProjectiles(dt);

    // melee sweep
    if (this.attackWindow) {
      const w = this.attackWindow;
      w.t += dt;
      if (w.t >= w.start && w.t <= w.end) {
        const p = g.player;
        const fx = Math.sin(p.moveYaw), fz = Math.cos(p.moveYaw);
        for (const a of g.allTargets()) {
          if (a.dead || w.hits.has(a)) continue;
          const dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > w.reach + (a.radius || 0.4)) continue;
          const dot = (dx / d) * fx + (dz / d) * fz;
          if (dot < Math.cos(w.arc)) continue;
          const dy = Math.abs((a.pos.y + a.height * 0.5) - (p.pos.y + 1.1));
          if (dy > a.height * 0.8 + 0.7) continue;
          w.hits.add(a);

          const sneak = p.crouching && a.alertness < 0.6;
          const mult = sneak ? (g.stats.hasPerk('backstab') ? 4 : 2.5) : 1;
          const dealt = this.applyDamage(a, w.damage * mult, 'player', w.element || 'physical', sneak || w.heavy);
          if (w.enchant) {
            if (w.enchant.element === 'frost') a.effects.push({ type: 'slow', power: 0.35, dur: 2.5 });
            this.particles.magic(a.pos.x, a.pos.y + a.height * 0.6, a.pos.z, 10,
              w.enchant.element === 'frost' ? [0.5, 0.8, 1] : [1, 0.5, 0.2], 2, 0.6, 0.12);
          }
          if (w.heavy && g.stats.hasPerk('savagery')) a.stagger(0.8);
          else if (w.heavy) a.stagger(0.45);
          if (a.dead && g.stats.hasPerk('blooddrinker')) g.stats.heal(15);
          g.stats.gainSkill('oneHanded', w.heavy ? 16 : 10);
          if (sneak) g.stats.gainSkill('sneak', 22);
        }
      }
      if (w.t > w.end + 0.35) this.attackWindow = null;
    }

    this.hitStop = Math.max(0, this.hitStop - dt);
    this.particles.update(dt, g.player.camera, g.engine.outH || 720);
  }
}
