// Seeker — a mimic three metres tall in an armoured suit. Slow, heavy, sweeping a searchlight from the lens in
// its dome. The light finding you is the scare: the screen floods, the hum rises, then the MG. It cannot skip;
// it just keeps coming. Only after Tide level 2, only at Object 12 and the church.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Enemy } from './common.js';
import { GLSL_NOISE } from '../render/glsl.js';
import { Rig, makeBodyMaterial, buildParts, skinify, boneIndex, enemyShoot, BODY_PARTS, offsetParts, GUN_REST } from './mimic.js';
import { playAny } from './squad.js';
import { roundsInGun, consumeRound } from './loadout.js';
import { SEEKER, AMMO, WEAPONS, MAGAZINES, ITEMS, defaultAmmo, resolveHit, zoneFromHit } from '../data/index.js';
import { makeWeapon, makeMag, makeGear } from '../player/inventory.js';
import { clamp, clamp01, damp, angleDelta, lerp, TAU, DEG } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _axis = new THREE.Vector3();
const _m = new THREE.Matrix4();
const SCALE = 1.65;
// the suit: one class-6 piece over every zone, its own durability; the lens is the hole in it
const SUIT_DEF = { id: 'seeker_suit', name: 'Seeker suit', kind: 'vest', cls: SEEKER.cls || 6, zones: ['head', 'torso', 'stomach', 'arms', 'legs'], durability: 400 };
// the heavy gun and its belt: what it fires is what it drops
function seekerLoadout() {
  const weaponId = (SEEKER.weapons && SEEKER.weapons.find((id) => WEAPONS[id])) || 'pkm';
  const wdef = WEAPONS[weaponId];
  const ammoId = defaultAmmo(wdef.cal);
  const weapon = makeWeapon(weaponId, { condition: 55 + Math.random() * 30, ammo: ammoId });
  if (weapon.mag) weapon.mag.rounds = MAGAZINES[weapon.mag.id].cap;
  const boxes = [];
  if (wdef.defaultMag) for (let i = 0; i < 2; i++) boxes.push(makeMag(wdef.defaultMag, ammoId, MAGAZINES[wdef.defaultMag].cap));
  return { weapon, wdef, ammoId, ammo: AMMO[ammoId], boxes, suit: { durability: SUIT_DEF.durability } };
}

// ---- heavy MG silhouette (gun-local, muzzle -z) ----
const MG_PARTS = [
  [0.09, 0.12, 0.52, 0, 0, 0, 'gun', { jitter: 0.004 }],
  [0.05, 0.05, 0.55, 0, 0.02, -0.52, 'gun', { jitter: 0.003 }],             // barrel
  [0.075, 0.075, 0.30, 0, 0.02, -0.40, 'gun', { jitter: 0.004 }],           // shroud
  [0.03, 0.03, 0.45, 0, -0.04, -0.45, 'gun', { jitter: 0.002 }],            // gas tube
  [0.05, 0.09, 0.22, 0, -0.02, 0.36, 'gun', { rx: 0.1, jitter: 0.004 }],     // stock
  [0.17, 0.11, 0.09, -0.09, -0.06, -0.06, 'gun', { jitter: 0.004 }],        // side box magazine
  [0.04, 0.12, 0.05, 0, -0.10, 0.14, 'gun', { rx: -0.3, jitter: 0.003 }],   // grip
  [0.03, 0.06, 0.12, 0, 0.10, -0.05, 'gun', { jitter: 0.003 }],             // carry handle
];
const MG_GRIP_R = [0.0, -0.13, 0.14], MG_GRIP_L = [-0.02, -0.05, -0.18], MG_MUZZLE = [0, 0.02, -0.80];

// ---- armour plates over the black body (mesh space, unscaled) ----
const PLATE_PARTS = [
  [0.46, 0.34, 0.09, 0, 1.47, -0.135, 'chest', { top: 0.92, jitter: 0.008 }],
  [0.44, 0.42, 0.18, 0, 1.42, 0.17, 'chest', { jitter: 0.008 }],            // pack
  [0.16, 0.10, 0.12, -0.10, 1.66, 0.19, 'chest', { jitter: 0.006 }],         // pack valve block
  [0.34, 0.09, 0.07, 0, 1.28, -0.11, 'spine', { jitter: 0.006 }],
  [0.33, 0.08, 0.07, 0, 1.17, -0.105, 'spine', { jitter: 0.006 }],
  [0.22, 0.15, 0.24, -0.29, 1.58, 0, 'shL', { rz: 0.3, top: 0.8, jitter: 0.01 }],
  [0.22, 0.15, 0.24, 0.29, 1.58, 0, 'shR', { rz: -0.3, top: 0.8, jitter: 0.01 }],
  [0.15, 0.24, 0.15, -0.21, 1.40, 0, 'shL', { jitter: 0.008 }],
  [0.15, 0.24, 0.15, 0.21, 1.40, 0, 'shR', { jitter: 0.008 }],
  [0.13, 0.22, 0.13, -0.21, 1.11, 0, 'foL', { jitter: 0.008 }],
  [0.13, 0.22, 0.13, 0.21, 1.11, 0, 'foR', { jitter: 0.008 }],
  [0.36, 0.15, 0.09, 0, 0.90, -0.115, 'hips', { jitter: 0.008 }],
  [0.34, 0.14, 0.09, 0, 0.91, 0.11, 'hips', { jitter: 0.008 }],
  [0.20, 0.32, 0.10, -0.11, 0.72, -0.085, 'thL', { top: 1.05, jitter: 0.008 }],
  [0.20, 0.32, 0.10, 0.11, 0.72, -0.085, 'thR', { top: 1.05, jitter: 0.008 }],
  [0.16, 0.34, 0.08, -0.11, 0.29, -0.075, 'snL', { jitter: 0.008 }],
  [0.16, 0.34, 0.08, 0.11, 0.29, -0.075, 'snR', { jitter: 0.008 }],
  [0.16, 0.11, 0.32, -0.11, 0.06, -0.06, 'snL', { jitter: 0.008 }],
  [0.16, 0.11, 0.32, 0.11, 0.06, -0.06, 'snR', { jitter: 0.008 }],
  [0.14, 0.09, 0.14, 0, 1.63, 0, 'neck', { jitter: 0.006 }],                // collar ring
];
let plateGeo = null, bodyGeo = null;
function buildSeekerGeometry() {
  if (bodyGeo) return;
  // body: mimic body without the box head (the dome replaces it) + the MG
  const body = BODY_PARTS.filter((p) => p[6] !== 'head');
  bodyGeo = buildParts(body.concat(offsetParts(MG_PARTS, GUN_REST[0], GUN_REST[1], GUN_REST[2])), SCALE);
  bodyGeo.userData.shared = true;
  const plates = buildParts(PLATE_PARTS, SCALE);
  // dome head: a squashed sphere cap on a short drum, bound to the head bone
  const dome = new THREE.SphereGeometry(0.19 * SCALE, 14, 9, 0, TAU, 0, Math.PI * 0.58);
  dome.scale(1.0, 0.85, 1.05);
  _m.makeTranslation(0, 1.70 * SCALE, 0.01 * SCALE); dome.applyMatrix4(_m);
  const drum = new THREE.CylinderGeometry(0.175 * SCALE, 0.16 * SCALE, 0.12 * SCALE, 14, 1);
  _m.makeTranslation(0, 1.68 * SCALE, 0.01 * SCALE); drum.applyMatrix4(_m);
  const hood = new THREE.BoxGeometry(0.16 * SCALE, 0.05 * SCALE, 0.12 * SCALE);
  _m.makeTranslation(0, 1.80 * SCALE, -0.16 * SCALE); hood.applyMatrix4(_m);
  for (const g of [dome, drum, hood]) skinify(g, boneIndex('head'));
  plateGeo = mergeGeometries([plates, dome, drum, hood], false);
  plateGeo.userData.shared = true;
  plates.dispose(); dome.dispose(); drum.dispose(); hood.dispose();
}

// ---- visible searchlight cone: additive, brightest along the silhouette, dust drifting through it ----
const CONE_VERT = /* glsl */`
  varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  void main(){ vUv = uv; vT = 1.0 - uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const CONE_FRAG = /* glsl */`
  ${GLSL_NOISE}
  uniform float uTime, uIntensity; varying float vT; varying vec3 vN, vV; varying vec2 vUv;
  void main(){
    float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float fall = pow(1.0 - vT, 1.7) * smoothstep(0.0, 0.06, vT);
    float dust = 0.7 + 0.6 * vnoise(vec2(vUv.x * 9.0, vT * 22.0 - uTime * 0.7)) * vnoise(vec2(vUv.x * 23.0 + uTime * 0.2, vT * 60.0 - uTime * 1.5));
    float a = (0.12 + 0.6 * edge * edge) * fall * uIntensity * dust;
    gl_FragColor = vec4(vec3(1.0, 0.92, 0.74) * a, a);
  }`;
let coneGeo = null;
function makeCone(length, angle) {
  if (!coneGeo) {
    const r = Math.tan(angle) * length;
    coneGeo = new THREE.ConeGeometry(r, length, 28, 1, true);
    _m.makeTranslation(0, -length / 2, 0); coneGeo.applyMatrix4(_m);
    _m.makeRotationX(Math.PI / 2); coneGeo.applyMatrix4(_m);
    coneGeo.userData.shared = true;
  }
  const mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.8 } }, vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const m = new THREE.Mesh(coneGeo, mat); m.renderOrder = 4; m.frustumCulled = false;   // hangs off a bone; one call, never worth a mis-cull
  return m;
}

let rng = null;
class Seeker extends Enemy {
  constructor(ctx, position, opts = {}) {
    super(ctx, 'seeker', position, Object.assign({ hp: SEEKER.hp || 700 }, opts));
    this.radius = 0.55; this.height = 3.0; this.speed = 1.2;
    this.loadout = seekerLoadout();
    this.weapon = this.loadout.weapon; this.wdef = this.loadout.wdef; this.ammo = this.loadout.ammo; this.ammoId = this.loadout.ammoId;
    this.pieces = [{ def: SUIT_DEF, inst: this.loadout.suit, slot: 'vest' }];
    this.reloadT = 0; this.reloading = false; this.dry = false; this.calledSquad = false; this.piled = false; this.burstN = 0; this.stunned = 0;
    this.shotNames = [`shot_${this.weapon.id}`, 'seeker_shot', 'shot_akm'];
    buildSeekerGeometry();
    this.bodyMat = makeBodyMaterial({ albedo: 0.02, shiver: 1 });
    this.plateMat = makeBodyMaterial({ color: [0.075, 0.085, 0.062], roughness: 0.9, shiver: 0.22, grime: 1 });
    this.rig = new Rig({ scale: SCALE, material: this.bodyMat, geometry: bodyGeo, muzzle: MG_MUZZLE, gripR: MG_GRIP_R, gripL: MG_GRIP_L });
    this.root.add(this.rig.mesh);
    this.plates = this.rig.attach(plateGeo, this.plateMat);
    this.root.add(this.plates);
    // the lens: an emissive disc on the dome front; the searchlight and its cone hang from the head bone
    const head = this.rig.B.head;
    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.2), fog: false });
    // discs face +z by default; the lamp looks down the head's -z, so flip the geometry (not the object: beamTest
    // reads the lens object's -z axis)
    const lensGeo = new THREE.CircleGeometry(0.055 * SCALE, 18); lensGeo.rotateY(Math.PI);
    this.lens = new THREE.Mesh(lensGeo, this.lensMat);
    this.lens.position.set(0, 0.06 * SCALE, -0.21 * SCALE); head.add(this.lens);
    const ringGeo = new THREE.RingGeometry(0.055 * SCALE, 0.078 * SCALE, 18); ringGeo.rotateY(Math.PI);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x1a1b18, roughness: 0.55, metalness: 0.3 }));
    ring.position.copy(this.lens.position); ring.position.z += 0.002; head.add(ring);
    this.light = new THREE.SpotLight(0xffe4bb, 0, 60, 0.25, 0.4, 1.3);
    this.light.position.copy(this.lens.position); this.light.castShadow = false;
    this.light.target.position.set(0, 0.06 * SCALE, -12);
    head.add(this.light); head.add(this.light.target);
    this.cone = makeCone(26, 0.25); this.cone.position.copy(this.lens.position); head.add(this.cone);
    this.lightLevel = 1; this.flicker = 1;
    // AI
    this.target = null; this.waitT = rng.range(2, 5); this.sweepT = rng.range(0, 10); this.sweepDir = 1; this.lookYaw = 0;
    this.burstLeft = 0; this.shotT = 0; this.cooldown = 1.2; this.lastVisT = -1e9; this.lastAlertT = -1e9; this.hissT = rng.range(3, 8);
    this.humLoop = null; this.loopRetry = 0; this.flashed = false; this.inBeam = false; this.moveSpeed = 0; this.staggerT = 0; this.humT = 0; this.beamHold = 0;
    this.glitchT = rng.range(3, 7); this.glitchLeft = 0;
    this.deathDuration = 3.6; this.ashDone = false; this.deathFlickerSeed = Math.random() * 10;
    const poi = opts.poi ? ctx.world.poi(opts.poi) : null;
    this.poiR = poi ? Math.min(poi.r * 0.7, 40) : 25;
    this.setState('patrol');
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw; this.root.updateMatrixWorld(true);
    this.animate(0.016, 0, {});
  }
  playerAudibility() {
    const d = this.distanceToPlayer();
    const steps = d < 10 ? this.player.noise * (1 - d / 10) : 0;
    const shots = this.ctx.director?.recentShotAt(this.position, 60) || 0;
    if (shots > 0.05) { if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(this.player.position); this.lastSeenT = this.time; if (this.aware < 0.5) this.aware = 0.5; }
    return clamp01(steps + shots * 1.5);
  }
  // armour: a class-6 suit over everything, resolved like any armour (AP gets through, ball does not), except the
  // lens (top 12 % of the capsule, from the front): x3 and straight through
  armorPieces() { return this.pieces; }
  damage(amount, info = {}) {
    if (!this.alive) return false;
    const pt = info.point;
    if (pt && info.kind !== 'blast' && pt.y > this.position.y + this.height * 0.88) {
      _v.set(pt.x - this.position.x, 0, pt.z - this.position.z).normalize();
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (_v.x * fx + _v.z * fz > 0.25) { this.lensHit = 1; return super.damage(amount * 3, info); }
    }
    if (info.kind === 'blast') return super.damage(amount * 0.5, info);
    if (info.kind === 'melee' || info.kind === 'slash') return super.damage(amount * 0.2, info);
    // zone from the capsule; the shot's own ammunition when ballistics passes it, a rifle-class guess otherwise
    const v2 = info.h01 != null;
    const h01 = v2 ? info.h01 : pt ? clamp01((pt.y - this.position.y) / this.height) : 0.6;
    const zone = info.zone || zoneFromHit(h01, info.lateral01 ?? 0.3);
    const given = info.ammo ? (typeof info.ammo === 'string' ? AMMO[info.ammo] : info.ammo) : null;
    const headMult = !v2 && info.headshot ? 1.8 : 1;
    let a, mult = 1;
    if (given) { a = given; mult = amount > 0 && given.damage > 0 ? amount / (given.damage * headMult) : 1; }
    else a = { damage: amount / headMult, pen: info.pen ?? 3, kind: 'fmj' };
    const r = resolveHit(a, zone, this.pieces, { mult });
    if (r.armorHit && r.armorHit.inst) r.armorHit.inst.durability = Math.max(0, (r.armorHit.inst.durability ?? SUIT_DEF.durability) - r.armorDamage);
    this.stoppedHit = !r.penetrated;
    if (!r.penetrated) { this.sound('armor_hit', { gain: 0.9, max: 80, rate: 0.8 }); if (pt) { _v2.copy(info.dir || _dir.set(0, 0, 1)).negate(); this.ctx.vfx.spark?.(pt, _v2, 8, [1.0, 0.8, 0.5]); } }
    return super.damage(r.damage, info);
  }
  onSpotted() {
    this.sound('seeker_spot', { gain: 1.0, max: 120, ref: 6 });
    this.humLoop?.set?.('intensity', 1); this.humT = 1.5;
    if (this.inBeam && !this.flashed) { this.flashed = true; this.ctx.post.flash(0.25); }
    this.cooldown = 2.2; this.setState('engage'); this.alertPack();   // the tell: light, hiss, hum, then the gun
    this.callSquad();
  }
  // it does not fight alone: the nearest squad within 150 m is told where you are
  callSquad() {
    const sq = this.ctx.squads; if (!sq) return;
    const s = sq.nearest(this.position, 150, (s) => s.alive > 0);
    if (!s) return;
    s.know(this.player.position, this.time); if (!s.inCombat) s.enterCombat(); s.converge(); s.radioT = 0.3;
    this.calledSquad = true; this.sound('mimic_radio', { gain: 0.8, max: 100, rate: 0.7 });
  }
  onHit(amount) {
    if (!this.stoppedHit) this.sound(amount > 60 ? 'seeker_hiss' : 'mimic_hit', { gain: 0.7 });
    this.stoppedHit = false;
    this.rig.flinch = 0.6; this.staggerT = 0.12;
    if (this.lensHit) { this.lensHit = 0; this.flicker = 0.1; this.rig.startGlitch(1.2); this.glitchLeft = 0.1; }
  }
  onDeath() {
    this.sound('seeker_death', { gain: 1.0, max: 200, ref: 8 });
    this.sound('seeker_hiss', { gain: 0.9, rate: 0.7 });
    this.target = null;
  }
  deathTick(dt) {
    const t = this.deathT, rig = this.rig, B = rig.B, s = SCALE;
    // hydraulic collapse: knees give in two stages, torso slumps forward, head hangs
    const f1 = clamp01(t / 0.7), f2 = clamp01((t - 0.5) / 0.9);
    const e1 = 1 - Math.pow(1 - f1, 2), e2 = 1 - Math.pow(1 - f2, 3);
    B.thL.rotation.x = 0.55 * e1 + 0.5 * e2; B.thR.rotation.x = 0.7 * e1 + 0.3 * e2;
    B.snL.rotation.x = -(1.3 * e1 + 0.7 * e2); B.snR.rotation.x = -(1.5 * e1 + 0.5 * e2);
    // (a torso bone points up, so -x is the forward slump)
    B.hips.position.y = rig.rest.hips.y - (0.45 * e1 + 0.30 * e2) * s; B.hips.rotation.x = -(0.2 * e1 + 0.25 * e2); B.hips.rotation.z = 0.12 * e2;
    B.spine.rotation.x = -0.35 * e2; B.chest.rotation.x = -0.4 * e2; B.neck.rotation.x = -0.5 * e2; B.head.rotation.x = -0.4 * e2; B.head.rotation.y = 0.3 * e1;
    B.gun.rotation.x = -0.42 - 0.6 * e2; B.gun.position.y = rig.gunRest.y - 0.2 * s * e2; B.gun.updateMatrix();
    rig.solveArm(B.shL, B.foL, rig.shPosL, _v.copy(rig.gripL).applyMatrix4(B.gun.matrix), -1);
    rig.solveArm(B.shR, B.foR, rig.shPosR, _v.copy(rig.gripR).applyMatrix4(B.gun.matrix), 1);
    // the light dies with a flicker
    const fl = t < 1.1 ? (Math.sin(t * 47 + this.deathFlickerSeed) > (t / 1.1) * 1.6 - 0.6 ? 1 : 0.05) * (1 - t / 1.3) : 0;
    this.setLight(fl);
    this.bodyMat.userData.u.uTime.value = this.time; this.plateMat.userData.u.uTime.value = this.time; this.cone.material.uniforms.uTime.value = this.time;
    if (t >= 1.6) {
      if (!this.ashDone) { this.ashDone = true; this.ctx.vfx.ash(_v.set(this.position.x, this.position.y + 0.6, this.position.z), 160); rig.mesh.castShadow = false; this.plates.castShadow = false; this.setLight(0); }
      const dv = clamp01((t - 1.6) / 1.6);
      this.bodyMat.userData.u.uDissolve.value = dv; this.plateMat.userData.u.uDissolve.value = dv;
      this.bodyMat.userData.u.uShiver.value = 1 + dv * 2;
    }
    // what the suit leaves behind: the belt box, a barrel, an armour kit, sometimes the Crown
    if (t >= 3.1 && !this.piled) {
      this.piled = true;
      const drops = [];
      const box = this.weapon.mag && this.weapon.mag.rounds > 0 ? this.weapon.mag : (this.loadout.boxes[0] || null);
      if (box) drops.push({ kind: 'mag', inst: box, id: box.id, count: 1 });
      for (const id of SEEKER.drops || []) {
        if (id === box?.id) continue;
        if (id === 'art_crown') { if (Math.random() < 0.2) drops.push({ kind: 'item', id, count: 1 }); continue; }
        if (ITEMS[id]) drops.push({ kind: 'item', id, count: 1 });
      }
      this.drops = drops;
      if (this.ctx.loot?.spawnPile) { try { this.ctx.loot.spawnPile(_v.set(this.position.x, this.groundY, this.position.z).clone(), drops); } catch (e) { console.warn('loot.spawnPile failed', e); } }
    }
  }
  onDispose() { this.rig.dispose(); this.lensMat.dispose(); this.cone.material.dispose(); this.lens.geometry.dispose(); }
  // intensity only: toggling a light's visibility changes the scene's light count and makes three recompile
  // every material in view, so the lamp stays in the light list at zero while it is dark
  setLight(level) {
    this.light.intensity = 46 * level;
    this.cone.material.uniforms.uIntensity.value = 0.8 * level;
    this.cone.visible = level > 0.01;
    this.lensMat.color.setRGB(0.4 + 2.8 * level, 0.35 + 2.55 * level, 0.25 + 1.95 * level);
  }
  alertPack() {
    for (const e of this.ctx.enemies.list) {
      if (e === this || !e.alive || (e.type !== 'mimic' && e.type !== 'seeker')) continue;
      if (e.position.distanceTo(this.position) > 40) continue;
      if (e.aware < 0.6) e.aware = 0.6;
      if (!e.lastSeenPlayer) e.lastSeenPlayer = new THREE.Vector3(); e.lastSeenPlayer.copy(this.player.position); e.lastSeenT = this.time;
    }
  }
  faceAngleTo(x, z) { return angleDelta(this.yaw, Math.atan2(-(x - this.position.x), -(z - this.position.z))); }
  // is the player inside the beam (axis from the lens, angle + a little penumbra) with a line of sight?
  beamTest() {
    const p = this.player; if (p.dead || p.inBase) return false;
    this.syncRoot();
    this.lens.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(this.lens.matrixWorld);
    _axis.set(-this.lens.matrixWorld.elements[8], -this.lens.matrixWorld.elements[9], -this.lens.matrixWorld.elements[10]).normalize();
    _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.6, p.position.z);
    _dir.subVectors(_v2, _v); const d = _dir.length(); if (d > 60 || d < 0.5) return false; _dir.divideScalar(d);
    if (_dir.dot(_axis) < Math.cos(0.25 + 0.06)) return false;
    return this.ctx.world.lineOfSight(_v, _v2);
  }
  fireOne(muzzle, dist) {
    const p = this.player, ctx = this.ctx;
    _v3.set(p.position.x, p.position.y + p.eyeHeight * 0.6, p.position.z);
    _dir.subVectors(_v3, muzzle).normalize();
    // a heavy gun walked onto you: full-power rifle rounds, but a wide, climbing cone; few of a burst land
    const spread = 9 + this.burstN * 0.25 + (this.moveSpeed > 0.4 ? 3 : 0) + (p.moving ? 1.5 : 0);
    const ammo = this.ammo;
    if (ctx.ballistics && !ctx.ballistics.isStub) ctx.ballistics.shoot(muzzle, _dir, { source: 'enemy', damage: ammo.damage, ammo, ammoId: this.ammoId, shooter: this, spreadDeg: spread, pellets: 1, range: 90, cls: 'mg', kind: 'bullet', weapon: this.weapon, what: 'Seeker' });
    else enemyShoot(ctx, this, muzzle, _dir, ammo.damage, spread);
    consumeRound(this.weapon);
    this.burstN++;
    ctx.vfx.muzzleFlash(muzzle, _dir);
    playAny(ctx, this.shotNames, { pos: muzzle, gain: 1.0, max: 300, ref: 6 });
    this.rig.kick = 1;
    if (dist < 25) ctx.post.shake(0.06);
  }
  // the box is empty: a long, loud change (5 s) in which the gun is down and the light droops
  beginReload() {
    const spare = this.loadout.boxes.find((b) => b.rounds > 0);
    if (!spare) { this.dry = true; return false; }
    this.reloading = true; this.reloadT = 0; this.burstLeft = 0; this.reloadBox = spare;
    return true;
  }
  reloadTick(dt) {
    const t0 = this.reloadT; this.reloadT += dt; const t = this.reloadT;
    const at = (x) => t0 < x && t >= x;
    if (at(0.1)) { this.sound('reload_magout', { gain: 0.9, max: 70, rate: 0.6 }); this.sound('seeker_hiss', { gain: 0.5 }); }
    if (at(1.4) || at(2.2) || at(2.9)) this.sound('mag_load_round', { gain: 0.7, max: 60, rate: 0.7 });
    if (at(3.6)) this.sound('reload_magin', { gain: 0.9, max: 70, rate: 0.6 });
    if (at(4.4)) this.sound('bolt_open', { gain: 0.8, max: 60, rate: 0.7 });
    if (at(4.8)) this.sound('bolt_close', { gain: 0.8, max: 60, rate: 0.7 });
    if (t >= 5.0) {
      const w = this.weapon, old = w.mag;
      const i = this.loadout.boxes.indexOf(this.reloadBox); if (i >= 0) this.loadout.boxes.splice(i, 1);
      if (old) this.loadout.boxes.push(old);
      w.mag = this.reloadBox; w.chamber = w.mag.ammo; this.reloadBox = null; this.reloading = false; this.cooldown = 1.0; this.burstN = 0;
    }
  }
  syncRoot() { this.root.position.copy(this.position); this.root.rotation.y = this.yaw; }

  tick(dt) {
    const ctx = this.ctx, p = this.player, t = this.time;
    this.followGround(dt);
    const d = this.distanceToPlayer();
    // perception: the beam is the eye. outside it the seeker is slow to notice you.
    // flashbang: the lamp swings down, the gun stops, it stands
    if (this.stunned > 0) {
      this.stunned -= dt; this.aware = 0; this.engaged = false; this.burstLeft = 0; this.inBeam = false;
      this.animate(dt, d, { headYaw: Math.sin(t * 5) * 0.6, headPitch: -0.5, speed: 0 });
      return;
    }
    // smoke between the lens and the player hides them from the beam and the eyes
    const smoked = ctx.world.smokeBlocks && ctx.world.smoke && ctx.world.smoke.length && ctx.world.smokeBlocks(this.eyePos(_v), p.eye);
    this.inBeam = !smoked && this.beamTest();
    const { vis } = smoked ? { vis: 0 } : this.perceive(dt, { fov: 110, maxDay: 60, visGain: 0.7, hearGain: 1.0, decay: 0.06 });
    if (this.inBeam) { this.aware = clamp01(this.aware + dt * 2.2); if (!this.lastSeenPlayer) this.lastSeenPlayer = new THREE.Vector3(); this.lastSeenPlayer.copy(p.position); this.lastSeenT = t; this.lastVisT = t; if (this.aware >= 1 && !this.engaged) { this.engaged = true; ctx.director?.notify('spotted', { enemy: this }); this.onSpotted(); } }
    else if (vis > 0.05) this.lastVisT = t;
    if (!this.engaged) this.flashed = false;
    this.staggerT = Math.max(0, this.staggerT - dt);
    const prevX = this.position.x, prevZ = this.position.z;
    let headYaw = 0, headPitch = 0, aim = 0, aimPitch = 0, aimYaw = 0;
    if (this.engaged && t - this.lastVisT < 8 && this.state !== 'engage') this.setState('engage');
    else if (!this.engaged && this.aware >= 0.45 && (this.state === 'patrol' || this.state === 'watch')) { this.setState('search'); this.target = this.lastSeenPlayer ? this.lastSeenPlayer.clone() : null; this.waitT = 0; this.sound('seeker_hiss', { gain: 0.6 }); }

    switch (this.state) {
      case 'watch': {
        this.waitT -= dt;
        headYaw = this.sweep(dt, 40 * DEG, 0.55);
        if (this.waitT <= 0) { this.setState('patrol'); this.target = null; }
        break;
      }
      case 'patrol': {
        if (!this.target) { this.target = ctx.world.randomPoint(rng, this.home.x, this.home.z, this.poiR) || this.home.clone(); }
        if (this.staggerT <= 0) { const rem = this.moveToward(this.target, 1.2, dt, { stop: 1.0, turnRate: 2.2 }); if (rem <= 1.0 || this.stateT > 60) { this.target = null; this.setState('watch'); this.waitT = rng.range(4, 10); } }
        headYaw = this.sweep(dt, 40 * DEG, 0.45);
        break;
      }
      case 'search': {
        if (this.engaged && t - this.lastVisT < 1) { this.setState('engage'); break; }
        if (this.target) { const rem = this.staggerT > 0 ? 99 : this.moveToward(this.target, 1.2, dt, { stop: 2.5, turnRate: 2.2 }); if (rem <= 2.5) { this.target = null; this.waitT = 0; } headYaw = this.sweep(dt, 30 * DEG, 0.9); }
        else { this.waitT += dt; headYaw = this.sweep(dt, 60 * DEG, 0.8); if (this.waitT > 7) { if (this.aware < 0.4) { this.setState('patrol'); this.target = null; } else { const ls = this.lastSeenPlayer || this.home; this.target = ctx.world.randomPoint(rng, ls.x, ls.z, 10) || null; this.waitT = 0; } } }
        if (this.aware < 0.2 && this.stateT > 15) { this.setState('patrol'); this.target = null; }
        break;
      }
      case 'engage': {
        aim = 1;
        if (t - this.lastVisT > 8 || !this.engaged) { this.setState('search'); this.target = this.lastSeenPlayer ? this.lastSeenPlayer.clone() : null; this.waitT = 0; break; }
        if (t - this.lastAlertT > 3) { this.lastAlertT = t; this.alertPack(); }
        // relentless: advance on the player, body squared to them, light locked on
        if (this.staggerT <= 0 && d > 6) this.moveToward(p.position, 1.2, dt, { stop: 6, face: false, allowWater: true });
        this.faceToward(p.position.x, p.position.z, dt, 2.6);
        headYaw = this.faceAngleTo(p.position.x, p.position.z);
        headPitch = Math.atan2(p.eye.y - (this.position.y + 1.7 * SCALE), Math.max(1, d));
        aimPitch = Math.atan2(p.eye.y - 0.3 - (this.position.y + 1.5 * SCALE), Math.max(1, d));
        aimYaw = headYaw;
        if (!this.calledSquad && this.stateT > 1) this.callSquad();
        if (this.reloading) { aim = 0.25; this.reloadTick(dt); }
        else if (roundsInGun(this.weapon) === 0 && !this.dry) { this.beginReload(); }
        else if (!p.dead && d < 70 && this.staggerT <= 0 && !this.dry) {
          if (this.burstLeft > 0) {
            this.shotT -= dt;
            if (this.shotT <= 0) {
              this.syncRoot(); this.rig.muzzleWorld(_v3);
              _v2.set(p.position.x, p.position.y + p.eyeHeight * 0.6, p.position.z);
              if (ctx.world.lineOfSight(_v3, _v2) && Math.abs(headYaw) < 0.6) { this.fireOne(_v3, d); this.burstLeft--; this.shotT = Math.max(0.075, 60 / (this.wdef.rpm || 650)); if (roundsInGun(this.weapon) === 0) this.burstLeft = 0; }
              else this.burstLeft = 0;
              if (this.burstLeft === 0) this.cooldown = rng.range(2.0, 3.5);
            }
          } else { this.cooldown -= dt; if (this.cooldown <= 0 && (this.inBeam || vis > 0.05)) { this.burstLeft = rng.int(6, 12); this.burstN = 0; this.shotT = 0; } }
        }
        break;
      }
    }
    const mv = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.moveSpeed = damp(this.moveSpeed, dt > 0 ? mv / dt : 0, 8, dt);
    // hydraulics + hum
    this.hissT -= dt; if (this.hissT <= 0) { this.hissT = rng.range(4, 9); if (d < 90) this.sound('seeker_hiss', { gain: 0.5 + 0.3 * clamp01(this.moveSpeed), max: 90 }); }
    if (!this.humLoop) { this.loopRetry -= dt; if (this.loopRetry <= 0) { this.loopRetry = 1; if (ctx.audio.ready) this.humLoop = this.loopSound('seeker_hum', { gain: 0.3, max: 120, ref: 6 }); } }
    if (this.humLoop) {
      this.humLoop.setGain((0.3 + 0.6 * clamp01(this.aware)) * clamp01(1 - d / 110), 0.3);
      // the hum rises when the beam has you; the loop's 'intensity' setter is a smoothed target, so a few Hz is plenty
      this.humT -= dt; if (this.humT <= 0) { this.humT = 0.25; this.humLoop.set('intensity', clamp01(0.25 + 0.45 * this.aware + (this.inBeam ? 0.5 : 0))); }
    }
    // the light finding you: a sustained glare while you stand in the beam looking into the lamp
    if (this.inBeam && !p.dead) {
      _dir.set(this.position.x - p.eye.x, this.position.y + 1.7 * SCALE - p.eye.y, this.position.z - p.eye.z).normalize();
      const facing = clamp01((_dir.dot(ctx.player.forward) - 0.3) / 0.7);
      this.beamHold = damp(this.beamHold, facing, 4, dt);
      if (this.beamHold > 0.02) ctx.post.flash(0.04 + 0.16 * this.beamHold * clamp01(1.2 - d / 40));
    } else this.beamHold = damp(this.beamHold, 0, 4, dt);
    this.animate(dt, d, { headYaw, headPitch, aim, aimPitch, aimYaw, speed: this.moveSpeed });
  }
  // slow sweep of the head/searchlight: +-range, rate in rad/s, with pauses at the ends
  sweep(dt, range, rate) {
    this.sweepT += dt * rate;
    const s = Math.sin(this.sweepT);
    return range * Math.sign(s) * Math.pow(Math.abs(s), 0.7);
  }
  animate(dt, d, c) {
    const rig = this.rig, ctx = this.ctx, t = this.time;
    if (this.glitchLeft > 0) { this.glitchLeft -= dt; if (this.glitchLeft <= 0) rig.glitchOn = false; }
    else { this.glitchT -= dt; if (this.glitchT <= 0) { this.glitchT = rng.range(3, 7); this.glitchLeft = 0.06; rig.startGlitch(0.7); } }
    rig.pose({ dt, speed: c.speed || 0, stride: 1.5, aim: c.aim || 0, aimPitch: c.aimPitch || 0, aimYaw: c.aimYaw || 0, headYaw: c.headYaw || 0, headPitch: c.headPitch || 0, headRate: 2.5, chestYaw: clamp((c.headYaw || 0) * 0.3, -0.35, 0.35), lean: 0.06 });
    if (rig.stepFlag) {
      if (d < 90) this.sound('seeker_step', { gain: 0.6 + 0.4 * clamp01(1 - d / 40), max: 90, ref: 5, rate: 0.9 + Math.random() * 0.15 });
      if (d < 12) ctx.post.shake(0.15 * (1 - d / 12) + 0.03);
    }
    // light: flicker recovers after a lens hit; the beam breathes very slightly
    this.flicker = damp(this.flicker, 1, 3, dt);
    const breathe = 0.94 + 0.06 * Math.sin(t * 2.1) + (Math.sin(t * 37.0) > 0.97 ? -0.08 : 0);
    this.setLight(this.flicker * breathe * (this.reloading ? 0.3 : 1));
    this.cone.material.uniforms.uTime.value = t;
    this.bodyMat.userData.u.uTime.value = t; this.plateMat.userData.u.uTime.value = t;
    this.bodyMat.userData.u.uShiver.value = 1 + rig.flinch * 1.5;
  }
}

export function registerSeeker(ctx) {
  rng = ctx.rng.fork(37);
  ctx.enemies.registerType('seeker', Seeker);
}
