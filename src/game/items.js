/**
 * WYRMHOLD — items, equipment, inventory and loot.
 *
 * Weapon and armour meshes are built procedurally from the same material
 * palette as everything else, so a "steel sword" is real geometry you can see
 * in your hand, not an icon.
 */

import * as THREE from 'three';
import { Rand, clamp, lerp } from '../core/math.js';

export const SLOT = { WEAPON: 'weapon', SHIELD: 'shield', BODY: 'body', HEAD: 'head', HANDS: 'hands', FEET: 'feet', AMULET: 'amulet', RING: 'ring' };

/**
 * @typedef {object} ItemDef
 * @property {string} id, name, type, icon
 * @property {number} value, weight
 */
export const ITEMS = {
  // ---- weapons -----------------------------------------------------------
  ironSword: { name: 'Iron Sword', type: 'weapon', slot: SLOT.WEAPON, icon: '🗡️', damage: 12, speed: 1.0, reach: 1.55, weight: 9, value: 25, skill: 'oneHanded', build: 'sword', mat: 'iron', desc: 'Serviceable. Heavy in the wrist.' },
  steelSword: { name: 'Steel Sword', type: 'weapon', slot: SLOT.WEAPON, icon: '⚔️', damage: 17, speed: 1.05, reach: 1.6, weight: 10, value: 90, skill: 'oneHanded', build: 'sword', mat: 'steel', desc: 'Folded steel with a fuller down the blade.' },
  ironAxe: { name: 'Iron War Axe', type: 'weapon', slot: SLOT.WEAPON, icon: '🪓', damage: 15, speed: 0.85, reach: 1.4, weight: 12, value: 40, skill: 'oneHanded', build: 'axe', mat: 'iron', desc: 'Bites deep, swings slow.' },
  steelMace: { name: 'Steel Mace', type: 'weapon', slot: SLOT.WEAPON, icon: '🔨', damage: 19, speed: 0.78, reach: 1.35, weight: 15, value: 110, skill: 'oneHanded', build: 'mace', mat: 'steel', armorPierce: 0.35, desc: 'Ignores a good deal of armour.' },
  ancientBlade: { name: 'Nordic Ancient Blade', type: 'weapon', slot: SLOT.WEAPON, icon: '🗡️', damage: 22, speed: 1.0, reach: 1.62, weight: 11, value: 340, skill: 'oneHanded', build: 'sword', mat: 'steel', enchant: { element: 'frost', power: 9 }, desc: 'Cold to the touch, even in summer.' },
  huntingBow: { name: 'Hunting Bow', type: 'weapon', slot: SLOT.WEAPON, icon: '🏹', damage: 14, speed: 0.9, reach: 60, weight: 7, value: 60, skill: 'archery', build: 'bow', mat: 'plank', ranged: true, desc: 'Ash and sinew.' },
  longBow: { name: 'Elk-Horn Longbow', type: 'weapon', slot: SLOT.WEAPON, icon: '🏹', damage: 21, speed: 0.72, reach: 90, weight: 9, value: 210, skill: 'archery', build: 'bow', mat: 'bone', ranged: true, desc: 'Draws slow. Reaches far.' },
  staffOfFlame: { name: 'Staff of Flame', type: 'weapon', slot: SLOT.WEAPON, icon: '🔥', damage: 16, speed: 0.9, reach: 40, weight: 8, value: 280, skill: 'destruction', build: 'staff', mat: 'plank', castsSpell: 'firebolt', desc: 'A bound flame atlas, still burning.' },

  // ---- shields -------------------------------------------------------------
  woodShield: { name: 'Banded Wood Shield', type: 'shield', slot: SLOT.SHIELD, icon: '🛡️', armor: 14, block: 0.42, weight: 10, value: 45, skill: 'block', build: 'shield', mat: 'plank', desc: 'Planks, hide and an iron boss.' },
  steelShield: { name: 'Steel Shield', type: 'shield', slot: SLOT.SHIELD, icon: '🛡️', armor: 26, block: 0.58, weight: 16, value: 180, skill: 'block', build: 'shield', mat: 'steel', desc: 'Heavy, and worth every stone of it.' },

  // ---- armour ---------------------------------------------------------------
  hideArmor: { name: 'Hide Armour', type: 'armor', slot: SLOT.BODY, icon: '🥋', armor: 20, weight: 12, value: 50, skill: 'lightArmor', desc: 'Boiled hide over a wool gambeson.' },
  leatherArmor: { name: 'Leather Armour', type: 'armor', slot: SLOT.BODY, icon: '🥋', armor: 30, weight: 14, value: 130, skill: 'lightArmor', desc: 'Supple and quiet.' },
  ironCuirass: { name: 'Iron Cuirass', type: 'armor', slot: SLOT.BODY, icon: '🛡️', armor: 44, weight: 30, value: 180, skill: 'heavyArmor', desc: 'Loud, but it turns an axe.' },
  steelCuirass: { name: 'Steel Plate Cuirass', type: 'armor', slot: SLOT.BODY, icon: '🛡️', armor: 62, weight: 38, value: 425, skill: 'heavyArmor', desc: 'Plate over mail. A smith\'s pride.' },
  furHood: { name: 'Fur-Lined Hood', type: 'armor', slot: SLOT.HEAD, icon: '🧢', armor: 8, weight: 3, value: 30, skill: 'lightArmor', warmth: 1, desc: 'The north is unkind to bare heads.' },
  ironHelm: { name: 'Horned Iron Helm', type: 'armor', slot: SLOT.HEAD, icon: '⛑️', armor: 16, weight: 8, value: 95, skill: 'heavyArmor', desc: 'The horns are for the enemy\'s morale.' },
  leatherBoots: { name: 'Leather Boots', type: 'armor', slot: SLOT.FEET, icon: '🥾', armor: 7, weight: 4, value: 25, skill: 'lightArmor', desc: 'Broken in by someone else first.' },
  ironGauntlets: { name: 'Iron Gauntlets', type: 'armor', slot: SLOT.HANDS, icon: '🧤', armor: 10, weight: 8, value: 60, skill: 'heavyArmor', desc: '' },
  amuletWarrior: { name: 'Amulet of the Warrior', type: 'armor', slot: SLOT.AMULET, icon: '📿', armor: 0, weight: 1, value: 320, bonus: { oneHanded: 12 }, desc: 'One-handed skill is keener while worn.' },
  ringMage: { name: 'Ring of the Kindled', type: 'armor', slot: SLOT.RING, icon: '💍', armor: 0, weight: 0.5, value: 300, bonus: { magicka: 35 }, desc: '+35 magicka.' },

  // ---- consumables ----------------------------------------------------------
  potionHealth: { name: 'Potion of Healing', type: 'potion', icon: '🧪', weight: 0.5, value: 45, use: { heal: 65 }, desc: 'Restores 65 health.' },
  potionStamina: { name: 'Potion of Vigour', type: 'potion', icon: '🧴', weight: 0.5, value: 38, use: { stamina: 80 }, desc: 'Restores 80 stamina.' },
  potionMagicka: { name: 'Potion of Magicka', type: 'potion', icon: '⚗️', weight: 0.5, value: 42, use: { magicka: 70 }, desc: 'Restores 70 magicka.' },
  potionResist: { name: 'Draught of Warding', type: 'potion', icon: '🍶', weight: 0.5, value: 90, use: { effect: { id: 'ward', type: 'resist', power: 0.35, dur: 60 } }, desc: 'Resist 35% of magic for a minute.' },
  bread: { name: 'Black Bread', type: 'food', icon: '🍞', weight: 0.4, value: 3, use: { heal: 12 }, desc: 'Dense. Filling.' },
  venison: { name: 'Roast Venison', type: 'food', icon: '🍖', weight: 1, value: 12, use: { heal: 28, stamina: 30 }, desc: '' },
  mead: { name: 'Honningbrew Mead', type: 'food', icon: '🍺', weight: 1, value: 14, use: { stamina: 50, heal: 8 }, desc: 'Warms you from the ribs out.' },

  // ---- ingredients & misc ------------------------------------------------------
  mountainFlower: { name: 'Mountain Flower', type: 'ingredient', icon: '🌸', weight: 0.1, value: 4, desc: 'Restores health when brewed.' },
  frostMirriam: { name: 'Frost Mirriam', type: 'ingredient', icon: '🌿', weight: 0.1, value: 6, desc: 'Resist frost.' },
  glowCap: { name: 'Glowcap', type: 'ingredient', icon: '🍄', weight: 0.1, value: 8, desc: 'Restores magicka.' },
  ironOre: { name: 'Iron Ore', type: 'material', icon: '🪨', weight: 4, value: 8, desc: 'Wants a forge.' },
  ironIngot: { name: 'Iron Ingot', type: 'material', icon: '🧱', weight: 2, value: 16, desc: '' },
  steelIngot: { name: 'Steel Ingot', type: 'material', icon: '🧱', weight: 2, value: 32, desc: '' },
  leatherStrips: { name: 'Leather Strips', type: 'material', icon: '🎗️', weight: 0.2, value: 4, desc: '' },
  arrow: { name: 'Iron Arrow', type: 'ammo', icon: '➶', weight: 0.05, value: 1, damage: 6, desc: '' },
  steelArrow: { name: 'Steel Arrow', type: 'ammo', icon: '➶', weight: 0.05, value: 3, damage: 10, desc: '' },
  gold: { name: 'Gold', type: 'currency', icon: '🪙', weight: 0, value: 1, desc: '' },
  lockpick: { name: 'Lockpick', type: 'tool', icon: '🔑', weight: 0.05, value: 6, desc: '' },
  dragonScale: { name: 'Dragon Scale', type: 'material', icon: '🐉', weight: 3, value: 400, desc: 'Warm. It has not cooled in a hundred years.' },
  barrowKey: { name: 'Hollowmere Key', type: 'quest', icon: '🗝️', weight: 0, value: 0, desc: 'Iron, and far too cold.', quest: true },
  wardstoneShard: { name: 'Wardstone Shard', type: 'quest', icon: '💎', weight: 0.5, value: 0, desc: 'It hums when the sun is down.', quest: true },
  huntersNote: { name: 'Torvald\'s Note', type: 'book', icon: '📜', weight: 0.1, value: 0, desc: 'A hunter\'s cramped hand.', text: 'Tracks by the mere, three days old. Bigger than a bear.\nIf I do not return, the lodge is Sigrid\'s.\n— Torvald' },
  bookNords: { name: 'Songs of the Nine Stones', type: 'book', icon: '📕', weight: 1, value: 40, desc: 'A collection of hall-songs.', text: 'They set the nine and named them each,\nand bound the dark beneath the beach.\nWhat sleeps in stone will wake in stone,\nand call the wyrm to claim its own.', teaches: 'destruction' },
};

for (const [id, it] of Object.entries(ITEMS)) { it.id = id; if (it.weight === undefined) it.weight = 1; if (it.value === undefined) it.value = 1; }

// ---------------------------------------------------------------------------
// Procedural weapon / armour geometry
// ---------------------------------------------------------------------------

function boxGeo(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Builds the mesh for an item held in the hand. */
export function buildItemMesh(def, palette) {
  const g = new THREE.Group();
  const matOf = { iron: palette.iron, steel: palette.steel, plank: palette.plank, bone: palette.bone, gold: palette.gold };
  const M = matOf[def.mat] || palette.iron;
  const grip = palette.leather;

  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };

  switch (def.build) {
    case 'sword': {
      // `reach` is the hit range, not the blade length — a one-handed blade is ~0.8 m.
      const len = (def.bladeLen ?? 1.05);
      // blade: a flattened, tapering box with a bevel
      const blade = new THREE.BufferGeometry();
      const w = 0.055, t = 0.014, bl = len * 0.72;
      const pos = [];
      const push = (x, y, z) => pos.push(x, y, z);
      const ring = (y, hw, ht) => [[-hw, y, 0], [0, y, ht], [hw, y, 0], [0, y, -ht]];
      const rings = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        const hw = w * (1 - s * 0.55) * (s > 0.88 ? (1 - (s - 0.88) / 0.12) : 1);
        const ht = t * (1 - s * 0.4) * (s > 0.88 ? (1 - (s - 0.88) / 0.12) : 1);
        rings.push(ring(0.14 + s * bl, Math.max(hw, 0.002), Math.max(ht, 0.001)));
      }
      const idx = [];
      rings.forEach(r => r.forEach(p => push(p[0], p[1], p[2])));
      for (let i = 0; i < steps; i++) {
        for (let k = 0; k < 4; k++) {
          const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
          idx.push(a, c, b, b, c, d);
        }
      }
      blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      blade.setIndex(idx);
      blade.computeVertexNormals();
      add(blade, M);
      add(boxGeo(0.20, 0.028, 0.045, 0, 0.13, 0), M);            // crossguard
      add(boxGeo(0.036, 0.16, 0.036, 0, 0.05, 0), grip);          // grip
      add(new THREE.SphereGeometry(0.032, 8, 6).translate(0, -0.035, 0), M); // pommel
      break;
    }
    case 'axe': {
      add(boxGeo(0.032, 0.62, 0.032, 0, 0.24, 0), palette.plank);
      const head = new THREE.Group();
      const hm = add(boxGeo(0.07, 0.20, 0.026, 0.075, 0.50, 0), M);
      hm.rotation.z = -0.12;
      add(boxGeo(0.10, 0.06, 0.034, 0.02, 0.50, 0), M);
      add(boxGeo(0.045, 0.05, 0.03, -0.035, 0.50, 0), M);
      add(new THREE.SphereGeometry(0.026, 8, 6).translate(0, -0.03, 0), M);
      break;
    }
    case 'mace': {
      add(boxGeo(0.034, 0.56, 0.034, 0, 0.22, 0), grip);
      add(new THREE.CylinderGeometry(0.062, 0.062, 0.15, 8).translate(0, 0.50, 0), M);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const f = add(boxGeo(0.03, 0.14, 0.05, Math.cos(a) * 0.062, 0.50, Math.sin(a) * 0.062), M);
        f.rotation.y = -a;
      }
      add(new THREE.SphereGeometry(0.03, 8, 6).translate(0, -0.02, 0), M);
      break;
    }
    case 'bow': {
      const h = 0.78;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -h, 0.02), new THREE.Vector3(0, -h * 0.5, -0.10),
        new THREE.Vector3(0, 0, -0.14), new THREE.Vector3(0, h * 0.5, -0.10),
        new THREE.Vector3(0, h, 0.02),
      ]);
      add(new THREE.TubeGeometry(curve, 16, 0.016, 6, false), M);
      add(boxGeo(0.03, 0.20, 0.05, 0, 0, -0.13), grip);
      // string
      const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -h, 0.02), new THREE.Vector3(0, h, 0.02)]);
      const line = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xcfc6ae }));
      g.add(line);
      g.userData.string = line;
      break;
    }
    case 'staff': {
      add(new THREE.CylinderGeometry(0.020, 0.026, 1.5, 8).translate(0, 0.45, 0), palette.plank);
      add(new THREE.TorusGeometry(0.075, 0.016, 6, 14).translate(0, 1.24, 0), palette.iron);
      const orb = add(new THREE.IcosahedronGeometry(0.055, 1).translate(0, 1.24, 0), palette.emFire);
      g.userData.orb = orb;
      break;
    }
    case 'shield': {
      const r = 0.34;
      const sh = new THREE.CylinderGeometry(r, r * 0.92, 0.055, 20);
      sh.rotateX(Math.PI / 2);
      add(sh, def.mat === 'steel' ? palette.steel : palette.plank);
      add(new THREE.TorusGeometry(r * 0.99, 0.022, 6, 22), palette.iron);
      add(new THREE.SphereGeometry(0.075, 12, 8).translate(0, 0, -0.045), palette.iron);
      for (let i = 0; i < 3; i++) {
        const b = add(boxGeo(r * 1.9, 0.035, 0.02, 0, (i - 1) * r * 0.5, -0.035), palette.iron);
      }
      break;
    }
    default:
      add(boxGeo(0.12, 0.12, 0.12), M);
  }
  g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export class Inventory {
  constructor(capacity = 300) {
    /** @type {Array<{id:string, qty:number, uid:number}>} */
    this.items = [];
    this.equipped = {};
    this.capacity = capacity;
    this.gold = 40;
    this._uid = 1;
    this.onChange = null;
  }

  def(id) { return ITEMS[id]; }

  add(id, qty = 1) {
    const d = ITEMS[id];
    if (!d) return null;
    if (id === 'gold') { this.gold += qty; this.onChange?.(); return null; }
    const stackable = ['potion', 'food', 'ingredient', 'material', 'ammo', 'tool'].includes(d.type);
    if (stackable) {
      const e = this.items.find(i => i.id === id);
      if (e) { e.qty += qty; this.onChange?.(); return e; }
    }
    const entry = { id, qty, uid: this._uid++ };
    this.items.push(entry);
    this.onChange?.();
    return entry;
  }

  remove(uidOrId, qty = 1) {
    const idx = typeof uidOrId === 'number'
      ? this.items.findIndex(i => i.uid === uidOrId)
      : this.items.findIndex(i => i.id === uidOrId);
    if (idx < 0) return false;
    const e = this.items[idx];
    e.qty -= qty;
    if (e.qty <= 0) {
      for (const [slot, uid] of Object.entries(this.equipped)) if (uid === e.uid) delete this.equipped[slot];
      this.items.splice(idx, 1);
    }
    this.onChange?.();
    return true;
  }

  count(id) { const e = this.items.find(i => i.id === id); return e ? e.qty : 0; }
  has(id, qty = 1) { return this.count(id) >= qty; }
  entry(uid) { return this.items.find(i => i.uid === uid); }

  get weight() {
    let w = 0;
    for (const it of this.items) w += (ITEMS[it.id]?.weight ?? 0) * it.qty;
    return w;
  }
  get overEncumbered() { return this.weight > this.capacity; }

  isEquipped(uid) { return Object.values(this.equipped).includes(uid); }

  equip(uid) {
    const e = this.entry(uid);
    if (!e) return false;
    const d = ITEMS[e.id];
    if (!d.slot) return false;
    if (this.equipped[d.slot] === uid) { delete this.equipped[d.slot]; this.onChange?.(); return true; }
    this.equipped[d.slot] = uid;
    // Two-handed weapons and bows knock the shield off.
    if (d.slot === SLOT.WEAPON && (d.ranged || d.build === 'bow' || d.build === 'staff')) delete this.equipped[SLOT.SHIELD];
    if (d.slot === SLOT.SHIELD) {
      const w = this.equippedDef(SLOT.WEAPON);
      if (w && (w.ranged || w.build === 'bow')) delete this.equipped[SLOT.WEAPON];
    }
    this.onChange?.();
    return true;
  }

  equippedEntry(slot) { const uid = this.equipped[slot]; return uid ? this.entry(uid) : null; }
  equippedDef(slot) { const e = this.equippedEntry(slot); return e ? ITEMS[e.id] : null; }

  /** Total armour rating from worn gear. */
  armorRating(stats) {
    let total = 0;
    for (const slot of Object.keys(this.equipped)) {
      const d = this.equippedDef(slot);
      if (!d || !d.armor) continue;
      let a = d.armor;
      if (d.skill === 'lightArmor') a *= 1 + (stats?.skills.lightArmor ?? 0) * 0.006 + (stats?.hasPerk('agile') ? 0.2 : 0);
      if (d.skill === 'heavyArmor') a *= 1 + (stats?.skills.heavyArmor ?? 0) * 0.006 + (stats?.hasPerk('juggernaut') ? 0.2 : 0);
      total += a;
    }
    return total;
  }

  serialize() {
    return { items: this.items, equipped: this.equipped, gold: this.gold, uid: this._uid };
  }
  deserialize(d) {
    if (!d) return;
    this.items = d.items || [];
    this.equipped = d.equipped || {};
    this.gold = d.gold ?? 0;
    this._uid = d.uid ?? (this.items.reduce((m, i) => Math.max(m, i.uid), 0) + 1);
    this.onChange?.();
  }
}

// ---------------------------------------------------------------------------
// Loot tables
// ---------------------------------------------------------------------------

export const LOOT = {
  bandit: [
    { id: 'gold', min: 5, max: 45, chance: 0.9 },
    { id: 'ironSword', chance: 0.18 }, { id: 'ironAxe', chance: 0.14 },
    { id: 'potionHealth', chance: 0.22 }, { id: 'bread', chance: 0.3 },
    { id: 'arrow', min: 3, max: 12, chance: 0.3 }, { id: 'lockpick', min: 1, max: 3, chance: 0.25 },
    { id: 'hideArmor', chance: 0.10 }, { id: 'mead', chance: 0.2 },
  ],
  wolf: [
    { id: 'venison', min: 1, max: 2, chance: 0.55 },
    { id: 'leatherStrips', min: 1, max: 3, chance: 0.5 },
  ],
  draugr: [
    { id: 'gold', min: 8, max: 60, chance: 0.7 },
    { id: 'ancientBlade', chance: 0.08 }, { id: 'ironSword', chance: 0.2 },
    { id: 'steelArrow', min: 4, max: 14, chance: 0.3 },
    { id: 'potionMagicka', chance: 0.18 }, { id: 'ironHelm', chance: 0.12 },
  ],
  troll: [
    { id: 'gold', min: 20, max: 90, chance: 0.5 },
    { id: 'venison', min: 2, max: 4, chance: 0.8 },
    { id: 'potionHealth', min: 1, max: 2, chance: 0.4 },
  ],
  chest: [
    { id: 'gold', min: 15, max: 120, chance: 1.0 },
    { id: 'potionHealth', chance: 0.45 }, { id: 'potionMagicka', chance: 0.3 },
    { id: 'steelSword', chance: 0.12 }, { id: 'steelShield', chance: 0.09 },
    { id: 'leatherArmor', chance: 0.14 }, { id: 'ironIngot', min: 1, max: 3, chance: 0.3 },
    { id: 'lockpick', min: 1, max: 5, chance: 0.4 }, { id: 'bookNords', chance: 0.12 },
    { id: 'amuletWarrior', chance: 0.05 }, { id: 'ringMage', chance: 0.05 },
  ],
  urn: [
    { id: 'gold', min: 3, max: 30, chance: 0.8 },
    { id: 'potionHealth', chance: 0.2 }, { id: 'glowCap', chance: 0.25 },
    { id: 'steelArrow', min: 2, max: 8, chance: 0.2 },
  ],
  herb: [
    { id: 'mountainFlower', chance: 0.5 }, { id: 'frostMirriam', chance: 0.3 }, { id: 'glowCap', chance: 0.25 },
  ],
};

export function rollLoot(table, rand, levelScale = 1) {
  const out = [];
  for (const e of LOOT[table] || []) {
    if (rand.next() > e.chance * clamp(levelScale, 0.6, 1.6)) continue;
    const qty = e.min !== undefined ? rand.int(e.min, e.max) : 1;
    if (qty > 0) out.push({ id: e.id, qty });
  }
  return out;
}
