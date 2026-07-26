/**
 * WYRMHOLD — character sheet: attributes, skills, perks and levelling.
 */

import { clamp, saturate, lerp } from '../core/math.js';
import { settings } from '../core/settings.js';

export const SKILLS = {
  oneHanded: { name: 'One-Handed', icon: '🗡️', desc: 'Swords, axes and maces.' },
  archery: { name: 'Archery', icon: '🏹', desc: 'Bows and the patience to use them.' },
  block: { name: 'Block', icon: '🛡️', desc: 'Turning a blow aside.' },
  destruction: { name: 'Destruction', icon: '🔥', desc: 'Fire, frost and lightning.' },
  restoration: { name: 'Restoration', icon: '✨', desc: 'Mending flesh and warding harm.' },
  sneak: { name: 'Sneak', icon: '👣', desc: 'Moving unseen and unheard.' },
  lightArmor: { name: 'Light Armour', icon: '🥾', desc: 'Leather, hide and fur.' },
  heavyArmor: { name: 'Heavy Armour', icon: '⚙️', desc: 'Iron and steel plate.' },
  alchemy: { name: 'Alchemy', icon: '⚗️', desc: 'Reading what grows.' },
  smithing: { name: 'Smithing', icon: '🔨', desc: 'Steel, and how to improve it.' },
};

export const PERKS = [
  { id: 'bladesman', skill: 'oneHanded', req: 20, name: 'Bladesman', icon: '🗡️', desc: '+20% one-handed damage.' },
  { id: 'savagery', skill: 'oneHanded', req: 45, name: 'Savage Strike', icon: '💥', desc: 'Power attacks stagger and deal +40%.' },
  { id: 'blooddrinker', skill: 'oneHanded', req: 70, name: 'Blooddrinker', icon: '🩸', desc: 'Killing blows restore 15 health.' },
  { id: 'eagleEye', skill: 'archery', req: 20, name: 'Eagle Eye', icon: '🎯', desc: 'Hold block while aiming to steady the shot.' },
  { id: 'deadeye', skill: 'archery', req: 45, name: 'Deadeye', icon: '🏹', desc: '+30% bow damage and faster draw.' },
  { id: 'ranger', skill: 'archery', req: 70, name: 'Ranger', icon: '🦌', desc: 'Move at full speed while drawing.' },
  { id: 'shieldwall', skill: 'block', req: 20, name: 'Shield Wall', icon: '🛡️', desc: 'Blocking absorbs 25% more.' },
  { id: 'bash', skill: 'block', req: 45, name: 'Power Bash', icon: '🔨', desc: 'Bashing staggers and deals damage.' },
  { id: 'novice', skill: 'destruction', req: 15, name: 'Apprentice Destruction', icon: '🔥', desc: 'Spells cost 20% less magicka.' },
  { id: 'augFire', skill: 'destruction', req: 40, name: 'Augmented Flames', icon: '🌋', desc: 'Fire damage +40%.' },
  { id: 'augFrost', skill: 'destruction', req: 55, name: 'Deep Freeze', icon: '❄️', desc: 'Frost slows targets much harder.' },
  { id: 'regen', skill: 'restoration', req: 20, name: 'Recovery', icon: '💚', desc: 'Magicka regenerates 40% faster.' },
  { id: 'ward', skill: 'restoration', req: 45, name: 'Ward Absorb', icon: '🔰', desc: 'Blocking with a spell absorbs magic.' },
  { id: 'shadow', skill: 'sneak', req: 20, name: 'Stealth', icon: '👤', desc: 'You are 30% harder to detect.' },
  { id: 'backstab', skill: 'sneak', req: 40, name: 'Backstab', icon: '🗡️', desc: 'Sneak attacks deal 4× damage.' },
  { id: 'silence', skill: 'sneak', req: 65, name: 'Silent Roll', icon: '🌀', desc: 'Sprinting while sneaking makes no sound.' },
  { id: 'agile', skill: 'lightArmor', req: 20, name: 'Agile Defender', icon: '🥾', desc: '+20% armour from light gear.' },
  { id: 'juggernaut', skill: 'heavyArmor', req: 20, name: 'Juggernaut', icon: '⚙️', desc: '+20% armour from heavy gear.' },
  { id: 'herbalist', skill: 'alchemy', req: 15, name: 'Herbalist', icon: '⚗️', desc: 'Potions you brew are 30% stronger.' },
  { id: 'steelsmith', skill: 'smithing', req: 20, name: 'Steel Smithing', icon: '🔨', desc: 'Improve weapons one grade further.' },
];

const DIFFICULTY = {
  novice: { dmgTaken: 0.5, dmgDealt: 1.6 },
  adept: { dmgTaken: 1.0, dmgDealt: 1.0 },
  expert: { dmgTaken: 1.5, dmgDealt: 0.75 },
  master: { dmgTaken: 2.2, dmgDealt: 0.55 },
  legend: { dmgTaken: 3.0, dmgDealt: 0.4 },
};

export class Stats {
  constructor() {
    this.level = 1;
    this.xp = 0;
    this.xpNext = 120;
    this.perkPoints = 1;

    this.maxHealth = 120;
    this.maxStamina = 110;
    this.maxMagicka = 100;
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.magicka = this.maxMagicka;

    this.skills = {};
    this.skillXp = {};
    for (const k of Object.keys(SKILLS)) { this.skills[k] = 12; this.skillXp[k] = 0; }

    this.perks = new Set();
    this.armorRating = 0;
    this.speedMultiplier = 1;
    this.overEncumbered = false;

    this.regenDelay = 0;
    this.staminaDelay = 0;
    this.effects = [];             // { id, type, dur, power, tick }
    this.onLevelUp = null;
    this.onSkillUp = null;
    this.onDamage = null;
    this.onDeath = null;
    this.dead = false;
    this.lastDamageAt = -99;
  }

  get diff() { return DIFFICULTY[settings.get('difficulty')] || DIFFICULTY.adept; }
  hasPerk(id) { return this.perks.has(id); }

  // -------------------------------------------------------------------------
  damage(amount, kind = 'physical', source = null) {
    if (this.dead || amount <= 0) return 0;
    let dmg = amount * this.diff.dmgTaken;
    if (kind !== 'fall' && kind !== 'drown') {
      const dr = saturate(this.armorRating / (this.armorRating + 220));
      dmg *= (1 - dr * 0.72);
    }
    this.health = Math.max(0, this.health - dmg);
    this.regenDelay = 3.2;
    this.lastDamageAt = performance.now() / 1000;
    this.onDamage?.(dmg, kind, source);
    if (this.health <= 0 && !this.dead) { this.dead = true; this.onDeath?.(kind, source); }
    return dmg;
  }

  heal(amount) {
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  useStamina(amount) {
    this.stamina = Math.max(0, this.stamina - amount);
    this.staminaDelay = 0.8;
    return this.stamina > 0;
  }
  useMagicka(amount) {
    if (this.magicka < amount) return false;
    this.magicka -= amount;
    this.magickaDelay = 1.1;
    return true;
  }

  addEffect(eff) {
    const existing = this.effects.find(e => e.id === eff.id);
    if (existing) { existing.dur = Math.max(existing.dur, eff.dur); existing.power = Math.max(existing.power, eff.power); }
    else this.effects.push({ ...eff });
  }
  hasEffect(id) { return this.effects.some(e => e.id === id); }

  // -------------------------------------------------------------------------
  gainSkill(skill, amount) {
    if (!(skill in this.skills)) return;
    const lvl = this.skills[skill];
    // Higher skills advance more slowly.
    const scaled = amount / (1 + lvl * 0.035);
    this.skillXp[skill] += scaled;
    const need = 8 + lvl * 1.9;
    while (this.skillXp[skill] >= need && this.skills[skill] < 100) {
      this.skillXp[skill] -= need;
      this.skills[skill]++;
      this.gainXp(12 + this.skills[skill] * 0.7);
      this.onSkillUp?.(skill, this.skills[skill]);
    }
  }

  gainXp(amount) {
    this.xp += amount;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.perkPoints++;
      this.xpNext = Math.round(120 * Math.pow(1.22, this.level - 1));
      this.onLevelUp?.(this.level);
    }
  }

  /** Spends the level-up attribute choice. */
  chooseAttribute(which) {
    if (which === 'health') { this.maxHealth += 12; this.health += 12; }
    else if (which === 'stamina') { this.maxStamina += 12; this.stamina += 12; }
    else { this.maxMagicka += 12; this.magicka += 12; }
  }

  takePerk(id) {
    const p = PERKS.find(p => p.id === id);
    if (!p || this.perks.has(id)) return false;
    if (this.perkPoints <= 0) return false;
    if (this.skills[p.skill] < p.req) return false;
    this.perks.add(id);
    this.perkPoints--;
    return true;
  }

  // -------------------------------------------------------------------------
  update(dt, ctx = {}) {
    if (this.dead) return;
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    this.magickaDelay = Math.max(0, (this.magickaDelay || 0) - dt);

    // Effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.dur -= dt;
      if (e.type === 'dot') this.damage(e.power * dt, e.element || 'magic');
      if (e.type === 'hot') this.heal(e.power * dt);
      if (e.dur <= 0) this.effects.splice(i, 1);
    }

    const slowed = this.effects.find(e => e.type === 'slow');
    this.speedMultiplier = slowed ? clamp(1 - slowed.power, 0.35, 1) : 1;

    // Regeneration
    const restRate = ctx.resting ? 6 : 1;
    if (this.regenDelay <= 0) {
      const rate = (0.62 + this.maxHealth * 0.0035) * restRate;
      this.health = Math.min(this.maxHealth, this.health + rate * dt);
    }
    if (this.staminaDelay <= 0 && !ctx.sprinting) {
      this.stamina = Math.min(this.maxStamina, this.stamina + (this.maxStamina * 0.22) * dt * restRate);
    }
    if (this.magickaDelay <= 0) {
      const mult = this.hasPerk('regen') ? 1.4 : 1;
      this.magicka = Math.min(this.maxMagicka, this.magicka + (this.maxMagicka * 0.085) * mult * dt * restRate);
    }
  }

  // -------------------------------------------------------------------------
  serialize() {
    return {
      level: this.level, xp: this.xp, xpNext: this.xpNext, perkPoints: this.perkPoints,
      maxHealth: this.maxHealth, maxStamina: this.maxStamina, maxMagicka: this.maxMagicka,
      health: this.health, stamina: this.stamina, magicka: this.magicka,
      skills: this.skills, skillXp: this.skillXp, perks: [...this.perks],
    };
  }
  deserialize(d) {
    if (!d) return;
    Object.assign(this, {
      level: d.level, xp: d.xp, xpNext: d.xpNext, perkPoints: d.perkPoints,
      maxHealth: d.maxHealth, maxStamina: d.maxStamina, maxMagicka: d.maxMagicka,
      health: d.health, stamina: d.stamina, magicka: d.magicka,
    });
    Object.assign(this.skills, d.skills || {});
    Object.assign(this.skillXp, d.skillXp || {});
    this.perks = new Set(d.perks || []);
    this.dead = this.health <= 0;
  }
}
