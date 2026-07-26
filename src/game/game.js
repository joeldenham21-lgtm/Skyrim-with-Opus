/**
 * WYRMHOLD — game layer.
 *
 * Owns the player's sheet and pack, populates the world with buildings and
 * people, runs interaction, weather particles, the light budget, dungeon
 * transitions and saves. The renderer knows nothing about any of this; it just
 * draws whatever scene this module has assembled.
 */

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { Stats, SKILLS, PERKS } from './stats.js';
import { Inventory, ITEMS, SLOT, buildItemMesh, rollLoot } from './items.js';
import { Actor, Dragon, ACTOR_DEFS, FACTION } from './actors.js';
import { Combat, SPELLS } from './combat.js';
import { QuestLog, QUESTS, NPCS, DIALOGUE } from './quests.js';
import { Builder, mergeStatic, buildHearthwatch, buildBanditCamp, buildLodge, buildDungeon, makeWatchtower, makeStandingStones, makeShrine, makeShipwreck, makeMineEntrance, makeBarrowEntrance, makeCampfire, makeChest } from '../world/props.js';
import { clamp, saturate, lerp, damp, mod, TAU, PI, Rand, clockString } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Game {
  constructor(engine) {
    this.engine = engine;
    this.world = engine.world;
    this.player = engine.player;
    this.input = engine.input;
    this.audio = engine.audio;
    this.scene = this.world.scene;
    this.rand = new Rand(777);

    this.stats = new Stats();
    this.inventory = new Inventory(300);
    this.quests = new QuestLog(this);
    this.combat = new Combat(this);

    this.actors = [];
    this.dragon = null;
    this.interactables = [];
    this.colliders = [];
    this.propLights = [];
    this.activeLights = [];

    this.time = 0;
    this.dt = 0.016;
    this.hurtFlash = 0;
    this.focusDistance = 14;
    this.bounty = 0;
    this.wanted = false;
    this.lightExposure = 0;
    this.lastNoise = 0;
    this.drawing = false;
    this.drawTime = 0;
    this.wardActive = 0;
    this.dialogueOpen = false;
    this.currentSpell = 'firebolt';
    this.knownSpells = ['firebolt', 'flames', 'healing', 'frostbite', 'sparks', 'ward'];
    this.interior = null;
    this.exteriorState = null;
    this.resting = false;
    this.autoSaveTimer = 0;
    this.playerTarget = {
      pos: this.player.pos, height: 1.8, radius: 0.4, dead: false, faction: 'player',
    };

    this._weatherAccum = 0;
    this._lightPool = [];
    this._bindStats();
  }

  _bindStats() {
    const s = this.stats;
    s.onLevelUp = (lvl) => {
      this.notify(`LEVEL ${lvl}`, 'Choose an attribute in your character sheet', 'quest');
      this.audio.play('levelUp');
      this.ui?.showLevelUp?.(lvl);
      s.health = s.maxHealth; s.stamina = s.maxStamina; s.magicka = s.maxMagicka;
    };
    s.onSkillUp = (skill, lvl) => {
      this.notify(`${SKILLS[skill].name} increased to ${lvl}`, '', 'skill');
    };
    s.onDamage = (dmg) => {
      this.hurtFlash = Math.min(1, this.hurtFlash + dmg / 45);
      this.player.addShake(Math.min(0.55, dmg / 60));
      this.ui?.onPlayerHurt?.(dmg);
    };
    s.onDeath = () => {
      this.audio.setMood('sad', 1);
      this.ui?.showDeath?.();
    };
    this.inventory.onChange = () => {
      this.stats.armorRating = this.inventory.armorRating(this.stats);
      this.stats.overEncumbered = this.inventory.overEncumbered;
      this._syncEquipment();
      this.ui?.refreshInventory?.();
    };
  }

  // -------------------------------------------------------------------------
  // World population
  // -------------------------------------------------------------------------
  async build(onProgress) {
    const hf = this.world.hf;
    const P = this.world.palette;
    const B = new Builder(P);

    onProgress?.(0.05);
    buildHearthwatch(B, hf, hf.loc('hearthwatch'));
    onProgress?.(0.35);

    const wt = hf.loc('watchtower');
    makeWatchtower(B, wt.x, hf.heightAt(wt.x, wt.z), wt.z, 0.4);
    const ws = hf.loc('wardstone');
    makeStandingStones(B, ws.x, hf.heightAt(ws.x, ws.z), ws.z, hf);
    const sh = hf.loc('shrine');
    makeShrine(B, sh.x, hf.heightAt(sh.x, sh.z), sh.z, 1.2);
    const wr = hf.loc('wreck');
    makeShipwreck(B, wr.x, hf.heightAt(wr.x, wr.z), wr.z, 0.8);
    const mn = hf.loc('mine');
    makeMineEntrance(B, mn.x, hf.heightAt(mn.x, mn.z), mn.z, 2.4);
    const bw = hf.loc('barrow');
    makeBarrowEntrance(B, bw.x, hf.heightAt(bw.x, bw.z), bw.z, 3.3);
    onProgress?.(0.6);

    buildBanditCamp(B, hf, hf.loc('banditcamp'));
    buildLodge(B, hf, hf.loc('lodge'));
    onProgress?.(0.75);

    // A handful of roadside camps and chests to reward wandering.
    for (let i = 0; i < 7; i++) {
      const a = this.rand.float(0, TAU), r = this.rand.float(320, 1400);
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8;
      if (hf.isWater(x, z) || hf.fastSlope(x, z) > 0.3) continue;
      const y = hf.heightAt(x, z);
      makeCampfire(B, x, y, z, this.rand.bool(0.6));
      makeChest(B, x + 2.2, y, z + 1.4, this.rand.float(0, TAU), 'chest', 0);
      if (this.rand.bool(0.55)) {
        for (let k = 0; k < this.rand.int(1, 3); k++) {
          this.spawnEnemy('bandit', x + this.rand.float(-6, 6), z + this.rand.float(-6, 6));
        }
      }
    }

    // Batch the ~1500 primitives that make up the settlements into a few
    // dozen draw calls before anything else is even in the scene.
    const merged = mergeStatic(B.group);
    console.info(`[wyrmhold] props batched: ${merged.source} meshes -> ${merged.batches} draw calls`);
    this.world.props.add(merged.group);
    this._propsGroup = merged.group;
    this.colliders = B.colliders;
    this.interactables = B.interactables;
    this.propLights = B.lights;
    this._registerBuilderMaterials({ group: merged.group });

    // NPCs & spawns
    for (const sp of B.spawns) {
      if (sp.kind === 'npc') this.spawnNPC(sp.id, sp.x, sp.z);
      else this.spawnEnemy(sp.id, sp.x, sp.z);
    }
    onProgress?.(0.85);

    // wildlife
    for (let i = 0; i < 22; i++) {
      const a = this.rand.float(0, TAU), r = this.rand.float(120, 1500);
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.85;
      if (hf.isWater(x, z) || hf.fastSlope(x, z) > 0.4) continue;
      this.spawnEnemy(this.rand.bool(0.55) ? 'deer' : 'wolf', x, z);
    }
    // roaming bandits & the odd draugr near the barrow
    for (let i = 0; i < 6; i++) {
      const a = this.rand.float(0, TAU), r = this.rand.float(200, 1200);
      this.spawnEnemy('banditArcher', Math.cos(a) * r, Math.sin(a) * r * 0.8);
    }

    // The dragon sleeps on the peak until the ritual wakes it.
    const pk = hf.loc('peak');
    this.dragon = new Dragon(this.world, { x: pk.x, z: pk.z });
    this.dragon.pos.y = hf.heightAt(pk.x, pk.z) + 3;
    this.dragon.grounded = true;
    this.dragon.state = 'roost';
    this.scene.add(this.dragon.model);
    this._registerActorMaterials();

    // starting kit
    this.inventory.add('ironSword', 1);
    this.inventory.add('woodShield', 1);
    this.inventory.add('hideArmor', 1);
    this.inventory.add('leatherBoots', 1);
    this.inventory.add('furHood', 1);
    this.inventory.add('potionHealth', 3);
    this.inventory.add('bread', 2);
    this.inventory.add('huntingBow', 1);
    this.inventory.add('arrow', 24);
    this.inventory.add('lockpick', 5);
    for (const slot of ['weapon', 'shield', 'body', 'feet', 'head']) {
      const e = this.inventory.items.find(i => ITEMS[i.id].slot === slot);
      if (e) this.inventory.equip(e.uid);
    }
    onProgress?.(1);
  }

  _registerBuilderMaterials(B) {
    const seen = new Set();
    B.group.traverse(o => {
      if (o.isMesh && o.material && !seen.has(o.material)) {
        seen.add(o.material);
        this.world.registerMaterial(o.material);
      }
    });
  }
  _registerActorMaterials() {
    const seen = new Set();
    for (const a of [...this.actors, this.dragon, this.player]) {
      a?.model?.traverse(o => {
        if (o.isMesh && o.material && !seen.has(o.material)) {
          seen.add(o.material);
          this.world.registerMaterial(o.material);
        }
      });
    }
  }
  onMaterialsChanged() { this._registerActorMaterials(); }

  // -------------------------------------------------------------------------
  spawnNPC(id, x, z) {
    const def = NPCS[id];
    if (!def) return null;
    const P = this.world.palette;
    const a = new Actor(this.world, def.guard ? 'guard' : 'villager', {
      x, z, name: def.name, dialogue: id, essential: true,
      torsoMat: P[def.torso] || P.cloth,
      hoodMat: P[def.torso] || P.cloth,
      cloak: !!def.cloak,
    });
    a.npcId = id;
    a.merchant = def.merchant || null;
    a.title = def.title || '';
    a.interactable = true;
    this.actors.push(a);
    this.scene.add(a.model);
    return a;
  }

  spawnEnemy(defId, x, z, opts = {}) {
    if (!ACTOR_DEFS[defId]) return null;
    const hf = this.world.hf;
    const a = new Actor(this.world, defId, { x, z, ...opts });
    a.pos.y = opts.interior ? (opts.y ?? 0) : hf.heightAt(x, z);
    if (opts.interior) { a.interior = true; a.interiorY = opts.y ?? 0; }
    this.actors.push(a);
    (opts.parent || this.scene).add(a.model);
    return a;
  }

  spawnTroll() {
    const hf = this.world.hf;
    const lodge = hf.loc('lodge');
    const spot = hf.findFlat(lodge.x + 30, lodge.z + 24, 30, 0.35, 30, () => this.rand.next());
    const t = this.spawnEnemy('troll', spot.x, spot.z);
    if (t) { t.questId = 'hunter'; this.notify('Something is out there', '', 'quest'); }
    this._registerActorMaterials();
  }

  allTargets() {
    if (this.dragon && !this.dragon.dead && this.dragon.awakened) return [...this.actors, this.dragon];
    return this.actors;
  }

  hitsProp(pos) {
    for (const c of this.colliders) {
      if (pos.y < c.y - 0.2 || pos.y > c.y + c.h) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Equipment visuals
  // -------------------------------------------------------------------------
  _syncEquipment() {
    const p = this.player;
    const wDef = this.inventory.equippedDef(SLOT.WEAPON);
    const sDef = this.inventory.equippedDef(SLOT.SHIELD);

    if (this._weaponId !== (wDef?.id || null)) {
      this._weaponId = wDef?.id || null;
      if (p.weaponMesh) { p.weaponMesh.parent?.remove(p.weaponMesh); p.weaponMesh = null; }
      if (wDef) {
        p.weaponMesh = buildItemMesh(wDef, this.world.palette);
        if (wDef.build === 'bow') {
          p.weaponMesh.rotation.set(0, 0, Math.PI / 2);
          p.weaponMesh.position.set(0, -0.06, 0.02);
          p.handL.add(p.weaponMesh);
        } else {
          // hilt in the fist, blade forward along the character's facing
          p.weaponMesh.rotation.set(1.32, 0, 0);
          p.weaponMesh.position.set(0, -0.09, 0.02);
          p.handR.add(p.weaponMesh);
        }
        this._registerActorMaterials();
      }
    }
    if (this._shieldId !== (sDef?.id || null)) {
      this._shieldId = sDef?.id || null;
      if (p.shieldMesh) { p.shieldMesh.parent?.remove(p.shieldMesh); p.shieldMesh = null; }
      if (sDef) {
        p.shieldMesh = buildItemMesh(sDef, this.world.palette);
        p.shieldMesh.rotation.set(1.42, 0, 0);
        p.shieldMesh.position.set(0.05, -0.15, 0.02);
        p.handL.add(p.shieldMesh);
        this._registerActorMaterials();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Damage in
  // -------------------------------------------------------------------------
  applyPlayerDamage(amount, kind = 'physical', source = null) {
    if (this.stats.dead) return 0;
    let dmg = amount;
    if (this.player.blocking) {
      const sDef = this.inventory.equippedDef(SLOT.SHIELD);
      let block = sDef ? sDef.block : 0.18;
      block *= 1 + this.stats.skills.block * 0.006;
      if (this.stats.hasPerk('shieldwall')) block *= 1.25;
      // blocking costs stamina; a spent guard folds
      const cost = dmg * 0.9;
      if (this.stats.stamina > cost * 0.4) {
        this.stats.useStamina(cost);
        dmg *= clamp(1 - block, 0.12, 1);
        this.audio.play('block');
        this.player.addShake(0.25);
        this.stats.gainSkill('block', 12);
        this.combat.particles.spark(
          this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z, 12, [1, 0.85, 0.5], 2.5, 0.4, 0.05);
      } else {
        this.player.anim.play('stagger', 0.6);
      }
    }
    if (this.wardActive > 0 && (kind !== 'physical')) {
      dmg *= 1 - this.wardActive;
      this.stats.gainSkill('restoration', 8);
    }
    const resist = this.stats.effects.find(e => e.type === 'resist');
    if (resist && kind !== 'physical') dmg *= 1 - resist.power;

    const dealt = this.stats.damage(dmg, kind, source);
    if (dealt > 0) {
      this.combat.particles.blood(this.player.pos.x, this.player.pos.y + 1.3, this.player.pos.z, 6);
      const armorSkill = this.inventory.equippedDef(SLOT.BODY)?.skill;
      if (armorSkill) this.stats.gainSkill(armorSkill, 8);
    }
    return dealt;
  }

  onActorDied(actor, source) {
    if (source === this.player || source === 'player') {
      this.stats.gainXp(actor.def.xp || 0);
      if (actor.def.xp) this.notify(`${actor.name} slain`, `+${actor.def.xp} XP`, 'skill');
    }
    this.quests.onEvent('killed', {
      defId: actor.defId, faction: actor.faction, dragon: actor === this.dragon,
    });
    if (actor.faction === FACTION.TOWN && source === this.player) {
      this.bounty += 1000;
      this.wanted = true;
      this.notify('MURDER', `Bounty ${this.bounty}`, 'quest');
    }
    if (actor === this.dragon) {
      this.notify('SKARNVALD FALLS', 'The Ash-Wing is dead', 'quest');
      this.audio.setMood('explore', 1);
    }
    // Any survivors nearby stop caring after a while.
    setTimeout(() => this.audio.setMood(this.anyHostileNear() ? 'combat' : 'explore', 1), 2500);
  }

  anyHostileNear(range = 40) {
    const p = this.player.pos;
    for (const a of this.allTargets()) {
      if (a.dead || !a.isHostileToPlayer) continue;
      if (a.state === 'idle' || a.state === 'wander' || a.state === 'dormant') continue;
      if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < range) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------
  _findInteraction() {
    const p = this.player;
    const eye = p.eyePos;
    const dir = p.aimDir(_v);
    let best = null, bestScore = -1;

    const consider = (obj, x, y, z, radius, label, sub) => {
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius + 1.4) return;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(d, 1e-4);
      if (dot < 0.35) return;
      const score = dot * 2 - d * 0.12;
      if (score > bestScore) { bestScore = score; best = { obj, label, sub, x, y, z, dist: d }; }
    };

    const list = this.interior ? this.interior.interactables : this.interactables;
    for (const it of list) {
      if (it.taken) continue;
      consider(it, it.x, it.y, it.z, it.radius,
        it.label || it.type,
        it.type === 'container' ? (it.opened ? 'Search' : 'Open') :
          it.type === 'door' ? 'Open' :
            it.type === 'bed' ? 'Rest' :
              it.type === 'fire' ? 'Rest by the fire' :
                it.type === 'dungeon' ? 'Enter' :
                  it.type === 'exit' ? 'Leave' :
                    it.type === 'wardstone' ? 'Touch the stone' :
                      it.type === 'shrine' ? 'Pray' :
                        it.type === 'forge' ? 'Smelt' :
                          it.type === 'smith' ? 'Forge' :
                            it.type === 'questItem' ? 'Take' : 'Use');
    }

    for (const a of this.actors) {
      if (a.dead) {
        if (a.looted || !a.lootItems || !a.lootItems.length) continue;
        consider(a, a.pos.x, a.pos.y + 0.4, a.pos.z, 2.2, a.name, 'Search');
      } else if (a.interactable && !a.isHostileToPlayer) {
        consider(a, a.pos.x, a.pos.y + 1.5, a.pos.z, 2.6, a.name, a.merchant ? 'Talk / Trade' : 'Talk');
      }
    }
    if (this.dragon && this.dragon.dead && !this.dragon.looted) {
      consider(this.dragon, this.dragon.pos.x, this.dragon.pos.y, this.dragon.pos.z, 6, this.dragon.name, 'Search');
    }
    return best;
  }

  interact(target) {
    if (!target) return;
    const o = target.obj;
    if (o instanceof Actor || o === this.dragon) {
      if (o.dead) { this._lootActor(o); return; }
      this.openDialogue(o);
      return;
    }
    switch (o.type) {
      case 'container': this._openContainer(o); break;
      case 'door': this._toggleDoor(o); break;
      case 'bed': this.ui?.openRest?.(o); break;
      case 'fire': this.ui?.openRest?.(o); break;
      case 'dungeon': this.enterDungeon(o.dungeon || 'barrow'); break;
      case 'exit': this.leaveDungeon(); break;
      case 'wardstone': this._useWardstone(o); break;
      case 'shrine':
        this.stats.heal(this.stats.maxHealth);
        this.stats.magicka = this.stats.maxMagicka;
        this.stats.addEffect({ id: 'blessing', type: 'resist', power: 0.15, dur: 600 });
        this.notify('Blessing of the Wanderer', 'Resist 15% magic for 10 minutes', 'quest');
        this.audio.play('levelUp');
        break;
      case 'forge': this.ui?.openCrafting?.('smelt'); break;
      case 'smith': this.ui?.openCrafting?.('forge'); break;
      case 'water': this.stats.stamina = this.stats.maxStamina; this.audio.play('drink'); break;
      case 'questItem':
        this.inventory.add(o.item, 1);
        o.taken = true;
        this.audio.play('loot');
        this.notify(ITEMS[o.item].name, 'Taken', 'quest');
        this.quests.onEvent('itemTaken', { id: o.item });
        break;
    }
  }

  _openContainer(o) {
    if (o.locked && !o.opened) {
      if (this.inventory.count('lockpick') <= 0) {
        this.notify('Locked', 'You need a lockpick', 'skill');
        return;
      }
      this.inventory.remove('lockpick', 1);
      this.notify('Lock picked', '', 'skill');
      this.stats.gainXp(15);
      o.locked = 0;
    }
    if (!o.opened) {
      o.opened = true;
      o.contents = rollLoot(o.loot || 'chest', this.rand, 1);
      this.audio.play('door', { open: true });
      if (o.lid) o.lid.rotation.x = -1.5;
    }
    this.ui?.openLoot?.(o.label || 'Container', o.contents, () => { o.contents = []; });
  }

  _lootActor(a) {
    this.ui?.openLoot?.(a.name, a.lootItems || [], () => { a.lootItems = []; a.looted = true; });
  }

  _toggleDoor(o) {
    o.open = !o.open;
    if (o.pivot) o.pivot.rotation.y = o.open ? -1.9 : 0;
    this.audio.play('door', { open: o.open });
  }

  _useWardstone(o) {
    const q = this.quests.state('wardstone');
    if (q.stage === 1) { this.quests.onEvent('visited', { id: 'wardstone' }); return; }
    if (q.stage === 3) {
      if (!this.inventory.has('wardstoneShard')) { this.notify('The socket is empty', '', 'quest'); return; }
      this.inventory.remove('wardstoneShard', 1);
      this.quests.onEvent('wardstoneUsed');
      return;
    }
    this.notify('The stone is cold', '', 'quest');
  }

  onRitual() {
    this.notify('THE STONES ANSWER', 'Something on the peak has heard', 'quest');
    this.audio.play('dragonRoar');
    this.player.addShake(1.2, 1.2);
    if (this.dragon) this.dragon.awaken(this);
  }

  openDialogue(actor) {
    const fn = DIALOGUE[actor.npcId];
    if (!fn) return;
    actor._setState('talk');
    this.dialogueOpen = true;
    this.ui?.openDialogue?.(actor, fn(this));
  }
  closeDialogue() { this.dialogueOpen = false; }

  openShop(npcId) {
    const npc = NPCS[npcId];
    if (!npc?.merchant) return;
    this.ui?.openShop?.(npc, npcId);
  }

  // -------------------------------------------------------------------------
  // Dungeons
  // -------------------------------------------------------------------------
  enterDungeon(kind) {
    if (this.interior) return;
    this.audio.play('door', { open: true });
    const seed = kind === 'mine' ? 4242 : 8080;
    const built = buildDungeon(this.world.palette, seed, kind);
    const B = built.builder;
    const mergedDungeon = mergeStatic(B.group);
    const dgroup = mergedDungeon.group;
    dgroup.position.set(0, -3000, 0);          // tuck the interior far below the map
    this.scene.add(dgroup);
    this._registerBuilderMaterials({ group: dgroup });

    this.exteriorState = {
      pos: this.player.pos.clone(),
      colliders: this.colliders,
      interactables: this.interactables,
      lights: this.propLights,
      actors: this.actors,
    };
    for (const a of this.actors) a.model.visible = false;
    if (this.dragon) this.dragon.model.visible = false;

    const offY = -3000;
    this.interior = {
      kind, group: dgroup, offY,
      colliders: B.colliders.map(c => ({ ...c, y: c.y + offY })),
      interactables: B.interactables.map(c => ({ ...c, y: c.y + offY })),
      lights: B.lights.map(l => ({ ...l, y: l.y + offY })),
      entry: built.entry,
    };
    this.colliders = this.interior.colliders;
    this.interactables = this.interior.interactables;
    this.propLights = this.interior.lights;

    this.actors = [];
    for (const sp of B.spawns) {
      const a = this.spawnEnemy(sp.id, sp.x, sp.z, { interior: true, y: offY, parent: this.scene });
      if (a) { a.pos.y = offY; a.interiorY = offY; }
    }
    this._registerActorMaterials();

    // hide the outdoors
    this.world.terrain.group.visible = false;
    this.world.water.group.visible = false;
    this.world.scatter.group.visible = false;
    this.world.grass.group.visible = false;
    this.world.env.interior = true;

    this.player.pos.set(built.entry.x, offY, built.entry.z + 2);
    this.player.vel.set(0, 0, 0);
    this.player.floorY = offY;
    this.audio.setMood('danger', 1);
    this.ui?.showCellLoad?.(kind === 'mine' ? 'Ashenvein Mine' : 'Hollowmere Barrow');
  }

  leaveDungeon() {
    if (!this.interior) return;
    this.scene.remove(this.interior.group);
    for (const a of this.actors) this.scene.remove(a.model);
    this.actors = this.exteriorState.actors;
    for (const a of this.actors) a.model.visible = true;
    if (this.dragon) this.dragon.model.visible = true;
    this.colliders = this.exteriorState.colliders;
    this.interactables = this.exteriorState.interactables;
    this.propLights = this.exteriorState.lights;
    this.player.floorY = null;
    this.player.pos.copy(this.exteriorState.pos);
    this.player.pos.y = this.world.hf.heightAt(this.player.pos.x, this.player.pos.z);
    this.world.terrain.group.visible = true;
    this.world.water.group.visible = true;
    this.world.scatter.group.visible = true;
    this.world.grass.group.visible = true;
    this.world.env.interior = false;
    this.interior = null;
    this.exteriorState = null;
    this.audio.setMood('explore', 1);
    this.ui?.showCellLoad?.('Wyrmhold');
  }

  // -------------------------------------------------------------------------
  // Lights
  // -------------------------------------------------------------------------
  _updateLights(dt) {
    const budget = settings.get('maxLights');
    while (this._lightPool.length < budget) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      l.visible = false;
      this.scene.add(l);
      this._lightPool.push(l);
    }
    while (this._lightPool.length > budget) {
      const l = this._lightPool.pop();
      this.scene.remove(l);
      l.dispose?.();
    }

    const p = this.player.pos;
    const cand = [];
    for (const src of this.propLights) {
      const d = Math.hypot(src.x - p.x, src.z - p.z);
      if (d > src.distance * 2.2) continue;
      cand.push({ src, d });
    }
    cand.sort((a, b) => a.d - b.d);

    let exposure = 0;
    for (let i = 0; i < this._lightPool.length; i++) {
      const l = this._lightPool[i];
      const c = cand[i];
      if (!c) { l.visible = false; continue; }
      const s = c.src;
      l.visible = true;
      l.position.set(s.x, s.y, s.z);
      l.color.setHex(s.color);
      const flick = s.flicker
        ? 0.82 + 0.18 * (Math.sin(this.time * 11 + s.x) * 0.5 + Math.sin(this.time * 17.3 + s.z) * 0.5)
        : 1;
      l.intensity = s.intensity * flick;
      l.distance = s.distance;
      l.decay = 2;
      if (c.d < s.distance) exposure += (1 - c.d / s.distance) * 0.6;
      // fire particles
      if (s.kind === 'fire' && c.d < 40 && this.rand.bool(dt * 22 * settings.get('particleQuality'))) {
        this.combat.particles.fire(s.x, s.y - 0.25, s.z, 1, 0.7);
        if (this.rand.bool(0.25)) this.combat.particles.smoke(s.x, s.y + 0.3, s.z, 1, [0.2, 0.19, 0.18], 0.5, 2.2);
      }
      if (s.kind === 'magic' && c.d < 40 && this.rand.bool(dt * 8)) {
        this.combat.particles.magic(s.x, s.y, s.z, 1, [0.4, 0.85, 1.0], 0.5, 1.4, 0.09);
      }
    }
    this.lightExposure = saturate(exposure);
  }

  // -------------------------------------------------------------------------
  // Weather particles
  // -------------------------------------------------------------------------
  _updateWeatherFx(dt) {
    if (this.interior) return;
    const env = this.world.env;
    const q = settings.get('particleQuality');
    const p = this.player.camera.position;
    const rate = (env.rain * 320 + env.snow * 160) * q;
    this._weatherAccum += rate * dt;
    const n = Math.floor(this._weatherAccum);
    this._weatherAccum -= n;
    const R = this.rand;
    for (let i = 0; i < n; i++) {
      const a = R.float(0, TAU), r = Math.sqrt(R.next()) * 22;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const y = p.y + R.float(6, 14);
      if (env.rain > env.snow) {
        this.combat.particles.alpha.emit(x, y, z,
          env.windX * 3 * env.windStrength, -22, env.windZ * 3 * env.windStrength,
          0.85, 0.035, 0.05, 0.62, 0.70, 0.80, 0.42, this.combat.particles.time);
      } else {
        this.combat.particles.alpha.emit(x, y, z,
          env.windX * 2.2 * env.windStrength + R.gauss(0, 0.5), -1.6 - R.float(0, 1.2),
          env.windZ * 2.2 * env.windStrength + R.gauss(0, 0.5),
          5.5, 0.075, 0.25, 0.92, 0.95, 1.0, 0.8, this.combat.particles.time);
      }
    }
    // ambient motes on a still, bright day
    if (env.rain < 0.05 && env.snow < 0.05 && this.rand.bool(dt * 10 * q)) {
      const a = R.float(0, TAU), r = Math.sqrt(R.next()) * 10;
      this.combat.particles.additive.emit(p.x + Math.cos(a) * r, p.y + R.float(-1, 2), p.z + Math.sin(a) * r,
        R.gauss(0, 0.12), R.float(0.02, 0.2), R.gauss(0, 0.12), 4.0, 0.03, 0.4,
        1.0, 0.95, 0.8, 0.5, this.combat.particles.time);
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  _handleInput(dt) {
    const inp = this.input, p = this.player, st = this.stats;
    if (st.dead) return;

    const wDef = this.inventory.equippedDef(SLOT.WEAPON);
    const isBow = !!(wDef && wDef.ranged);

    // attack / draw
    if (isBow) {
      if (inp.isDown('attack')) {
        if (!this.drawing) this.combat.startDraw();
        else {
          this.drawTime += dt;
          if (!st.hasPerk('ranger')) p.aiming = true;
        }
      } else if (this.drawing) this.combat.releaseDraw();
      p.aiming = this.drawing;
    } else {
      if (inp.wasPressed('attack')) this.combat.playerAttack(false);
      if (inp.wasPressed('power')) this.combat.playerAttack(true);
      p.aiming = false;
    }

    // block
    const shield = this.inventory.equippedDef(SLOT.SHIELD);
    if (settings.get('toggleBlock')) {
      if (inp.wasPressed('block')) p.blocking = !p.blocking;
    } else {
      p.blocking = inp.isDown('block') && !isBow;
    }
    if (isBow) p.blocking = false;

    // spells
    const sp = SPELLS[this.currentSpell];
    p.casting = false;
    this.wardActive = 0;
    if (inp.isDown('cast') && sp) {
      if (sp.stream || sp.self || sp.sustain) { p.casting = true; this.combat.castSpell(this.currentSpell); }
      else if (inp.wasPressed('cast')) { p.casting = true; this.combat.castSpell(this.currentSpell); }
      else p.casting = true;
    }
    if (inp.wasPressed('swapSpell') || (inp.wheel && !this.ui?.anyPanelOpen?.())) {
      const i = this.knownSpells.indexOf(this.currentSpell);
      const dir = inp.wheel < 0 ? -1 : 1;
      this.currentSpell = this.knownSpells[mod(i + dir, this.knownSpells.length)];
      this.notify(SPELLS[this.currentSpell].name, '', 'skill');
      this.audio.play('ui', { kind: 'move' });
    }

    // interact
    this.focusTarget = this._findInteraction();
    if (inp.wasPressed('use') && this.focusTarget) this.interact(this.focusTarget);

    // view + quick slots
    if (inp.wasPressed('camera')) p.toggleView();
    for (let i = 1; i <= 4; i++) {
      if (inp.wasPressed('quick' + i)) this.useQuickSlot(i - 1);
    }
    if (inp.wasPressed('sheathe')) {
      this.sheathed = !this.sheathed;
      this.notify(this.sheathed ? 'Weapon sheathed' : 'Weapon drawn', '', 'skill');
    }

    // noise for stealth
    this.lastNoise = p.sprinting ? 0.35 : (p.speed01 > 0.4 && !p.crouching ? 0.12 : 0);
  }

  useQuickSlot(i) {
    const slots = ['potionHealth', 'potionStamina', 'potionMagicka', 'bread'];
    const id = slots[i];
    if (!id || !this.inventory.has(id)) { this.notify('Nothing in that slot', '', 'skill'); return; }
    this.useItem(this.inventory.items.find(it => it.id === id));
  }

  useItem(entry) {
    if (!entry) return;
    const d = ITEMS[entry.id];
    if (!d) return;
    if (d.slot) { this.inventory.equip(entry.uid); this.audio.play('ui', { kind: 'accept' }); return; }
    if (d.use) {
      if (d.use.heal) this.stats.heal(d.use.heal);
      if (d.use.stamina) this.stats.stamina = Math.min(this.stats.maxStamina, this.stats.stamina + d.use.stamina);
      if (d.use.magicka) this.stats.magicka = Math.min(this.stats.maxMagicka, this.stats.magicka + d.use.magicka);
      if (d.use.effect) this.stats.addEffect(d.use.effect);
      this.inventory.remove(entry.uid, 1);
      this.audio.play('drink');
      this.notify(d.name, 'Used', 'skill');
      return;
    }
    if (d.text) { this.ui?.openBook?.(d); if (d.teaches) this.stats.gainSkill(d.teaches, 60); return; }
    this.notify(d.name, 'Nothing happens', 'skill');
  }

  /** Sleeps or waits until the given hour. */
  rest(hours, inBed) {
    const env = this.world.env;
    this.world.setTime(env.hour + hours, env.day + (env.hour + hours >= 24 ? 1 : 0));
    const heal = inBed ? this.stats.maxHealth : this.stats.maxHealth * 0.35 * hours / 8;
    this.stats.heal(heal);
    this.stats.stamina = this.stats.maxStamina;
    this.stats.magicka = this.stats.maxMagicka;
    if (inBed) this.stats.addEffect({ id: 'rested', type: 'rested', power: 0.1, dur: 480 });
    this.notify(inBed ? 'Well rested' : 'Time passes', clockString(this.world.env.hour), 'skill');
  }

  // -------------------------------------------------------------------------
  // UI hooks
  // -------------------------------------------------------------------------
  notify(title, sub, kind) { this.ui?.notify?.(title, sub, kind); }
  subtitle(who, text, dur) { this.ui?.subtitle?.(who, text, dur); }
  floatDamage(x, y, z, amount, kind) { this.ui?.floatDamage?.(x, y, z, amount, kind); }

  // -------------------------------------------------------------------------
  update(dt) {
    if (this.combat.hitStop > 0) dt *= 0.12;
    this.dt = dt;
    this.time += dt;

    this._handleInput(dt);

    this.stats.update(dt, { sprinting: this.player.sprinting, resting: this.resting });
    this.player.update(dt, this.stats, this.colliders);
    this.playerTarget.pos = this.player.pos;

    for (const a of this.actors) a.update(dt, this);
    if (this.dragon) this.dragon.update(dt, this);

    this.combat.update(dt);
    this._updateLights(dt);
    this._updateWeatherFx(dt);

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    this.focusDistance = this.focusTarget ? this.focusTarget.dist : (this.player.thirdPerson ? 4.5 : 14);

    // combat music
    const near = this.anyHostileNear(45);
    if (near !== this._wasNear) {
      this._wasNear = near;
      this.audio.setMood(near ? 'combat' : (this.interior ? 'danger' : this._townNear() ? 'town' : (this.world.env.sunDir.y < -0.05 ? 'night' : 'explore')), 1);
    }
    this.audio.updateAmbience({
      windStrength: this.world.env.windStrength,
      rain: this.world.env.rain,
      snow: this.world.env.snow,
      nearWater: this._nearWater(),
      interior: !!this.interior,
      night: this.world.env.sunDir.y < -0.05,
      exposed: this.interior ? 0.1 : 1,
    }, dt);

    // discovery
    if (!this.interior) this._checkDiscovery();

    // autosave
    if (settings.get('autoSave')) {
      this.autoSaveTimer += dt;
      if (this.autoSaveTimer > settings.get('autoSaveMinutes') * 60) {
        this.autoSaveTimer = 0;
        this.save('auto');
        this.notify('Auto-saved', '', 'skill');
      }
    }
  }

  _townNear() {
    const t = this.world.hf.loc('hearthwatch');
    return Math.hypot(this.player.pos.x - t.x, this.player.pos.z - t.z) < 90;
  }
  _nearWater() {
    const p = this.player.pos;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU;
      if (this.world.hf.isWater(p.x + Math.cos(a) * 12, p.z + Math.sin(a) * 12)) return 1;
    }
    return this.player.submerged > 0 ? 1 : 0;
  }

  _checkDiscovery() {
    const p = this.player.pos;
    for (const L of this.world.hf.locations) {
      if (L.discovered) continue;
      if (Math.hypot(p.x - L.x, p.z - L.z) < L.radius * 1.1) {
        L.discovered = true;
        this.ui?.showDiscovery?.(L);
        this.stats.gainXp(25);
        this.quests.onEvent('visited', { id: L.id });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Save / load
  // -------------------------------------------------------------------------
  save(slot = 'auto') {
    try {
      const data = {
        v: 1, t: Date.now(),
        player: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, yaw: this.player.yaw },
        stats: this.stats.serialize(),
        inv: this.inventory.serialize(),
        quests: this.quests.serialize(),
        world: {
          hour: this.world.env.hour, day: this.world.env.day,
          weather: this.world.env.weather,
          discovered: this.world.hf.locations.filter(l => l.discovered).map(l => l.id),
        },
        bounty: this.bounty,
        spell: this.currentSpell,
        dragon: this.dragon ? { dead: this.dragon.dead, awakened: this.dragon.awakened, health: this.dragon.health } : null,
        deadActors: this.actors.filter(a => a.dead).map(a => a.id),
      };
      localStorage.setItem('wyrmhold.save.' + slot, JSON.stringify(data));
      return true;
    } catch (e) { console.warn('save failed', e); return false; }
  }

  listSaves() {
    const out = [];
    for (const slot of ['auto', '1', '2', '3']) {
      try {
        const raw = localStorage.getItem('wyrmhold.save.' + slot);
        if (!raw) { out.push({ slot, empty: true }); continue; }
        const d = JSON.parse(raw);
        out.push({ slot, empty: false, level: d.stats?.level ?? 1, time: d.t, day: d.world?.day ?? 1, hour: d.world?.hour ?? 0 });
      } catch (e) { out.push({ slot, empty: true }); }
    }
    return out;
  }

  load(slot = 'auto') {
    try {
      const raw = localStorage.getItem('wyrmhold.save.' + slot);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (this.interior) this.leaveDungeon();
      this.player.pos.set(d.player.x, d.player.y, d.player.z);
      this.player.yaw = d.player.yaw || 0;
      this.player.vel.set(0, 0, 0);
      this.stats.deserialize(d.stats);
      this.inventory.deserialize(d.inv);
      this.quests.deserialize(d.quests);
      this.world.setTime(d.world.hour, d.world.day);
      this.world.forceWeather(d.world.weather, true);
      for (const L of this.world.hf.locations) L.discovered = (d.world.discovered || []).includes(L.id);
      this.bounty = d.bounty || 0;
      this.wanted = this.bounty > 0;
      this.currentSpell = d.spell || 'firebolt';
      if (d.dragon && this.dragon) {
        this.dragon.dead = d.dragon.dead;
        this.dragon.awakened = d.dragon.awakened;
        this.dragon.health = d.dragon.health;
        if (this.dragon.dead) this.dragon.state = 'dead';
      }
      const deadSet = new Set(d.deadActors || []);
      for (const a of this.actors) if (deadSet.has(a.id) && !a.dead) a.die(this, null);
      this.stats.dead = this.stats.health <= 0;
      this.ui?.refreshAll?.();
      return true;
    } catch (e) { console.warn('load failed', e); return false; }
  }
}
