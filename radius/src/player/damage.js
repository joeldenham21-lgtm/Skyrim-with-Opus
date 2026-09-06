// Shared damage application for the player. Entities resolve their own armour with data/index.resolveHit.
// applyBullet(ammoDef, hitInfo) -> resolves zone + armour, damages armour durability, applies bleed/shock, returns the result.
import { resolveHit, zoneFromHit, def } from '../data/index.js';
import { clamp01 } from '../core/math.js';

export function createDamage(ctx) {
  const st = { painkiller: 0, steady: 0, speedT: 0, speedMul: 1, staminaRegenT: 0, staminaRegenMul: 1, healQueue: [] };
  const api = {
    st,
    // hit from a bullet: h01 = height fraction along the capsule, lateral01 = lateral offset fraction, ammo = ammo def or id
    bullet(ammo, h01 = 0.6, lateral01 = 0.3, info = {}) {
      const a = typeof ammo === 'string' ? def(ammo) : ammo;
      if (!a) return null;
      const zone = zoneFromHit(h01, lateral01);
      const pieces = ctx.inventory.armorPieces();
      const r = resolveHit(a, zone, pieces, { mult: info.mult || 1 });
      if (r.armorHit && r.armorHit.inst) {
        r.armorHit.inst.durability = Math.max(0, (r.armorHit.inst.durability ?? r.armorHit.def.durability) - r.armorDamage);
        ctx.audio.play(r.penetrated ? 'armor_pen' : (zone === 'head' ? 'helmet_ring' : 'armor_hit'), { gain: 0.8 });
        if (!r.penetrated) ctx.post.shake(0.25);
      }
      const dmg = r.damage * (st.painkiller > 0 ? 0.9 : 1);
      ctx.player.damage(dmg, { kind: 'bullet', source: info.source, bleed: r.penetrated && zone !== 'head' ? undefined : false, zone, penetrated: r.penetrated, what: info.what });
      ctx.events.emit('playerHit', { zone, penetrated: r.penetrated, damage: dmg, armor: r.armorHit?.def.id || null });
      return Object.assign(r, { zone });
    },
    // melee/slash/blast/shock: vests soften slashes on the torso a little
    other(amount, info = {}) {
      let dmg = amount;
      if (info.kind === 'slash' || info.kind === 'melee') { const v = ctx.inventory.equippedDef('vest'); if (v) { dmg *= 1 - Math.min(0.35, v.cls * 0.06); const g = ctx.inventory.equipped('vest'); if (g) g.durability = Math.max(0, g.durability - amount * 0.2); } }
      if (info.kind === 'blast') { const h = ctx.inventory.equippedDef('helmet'); if (h) dmg *= 0.9; }
      ctx.player.damage(dmg * (st.painkiller > 0 ? 0.9 : 1), info);
    },
    // consumables
    use(itemId) {
      const d = def(itemId); if (!d || !d.effect) return false;
      const e = d.effect;
      if (e.stopBleed) ctx.player.stopBleeding();
      if (e.heal) ctx.player.heal(e.heal);
      if (e.healOver) st.healQueue.push({ total: e.healOver[0], left: e.healOver[0], dur: e.healOver[1] });
      if (e.stamina) ctx.player.addStamina(e.stamina);
      if (e.painkiller) st.painkiller = Math.max(st.painkiller, e.painkiller);
      if (e.steady) st.steady = Math.max(st.steady, e.steady);
      if (e.speedFor) { st.speedT = e.speedFor[0]; st.speedMul = e.speedFor[1]; }
      if (e.staminaRegen) { st.staminaRegenT = e.staminaRegen[0]; st.staminaRegenMul = e.staminaRegen[1]; }
      if (e.cure) ctx.player.stopBleeding();
      ctx.events.emit('itemUsed', itemId);
      return true;
    },
    get speedMul() { return st.speedT > 0 ? st.speedMul : 1; },
    get staminaRegenMul() { return st.staminaRegenT > 0 ? st.staminaRegenMul : 1; },
    get steadyMul() { return st.steady > 0 ? 0.6 : 1; },      // spread/sway multiplier
    get painkiller() { return st.painkiller > 0; },
    update(dt) {
      st.painkiller = Math.max(0, st.painkiller - dt); st.steady = Math.max(0, st.steady - dt); st.speedT = Math.max(0, st.speedT - dt); st.staminaRegenT = Math.max(0, st.staminaRegenT - dt);
      for (let i = st.healQueue.length - 1; i >= 0; i--) { const h = st.healQueue[i]; const step = Math.min(h.left, (h.total / h.dur) * dt); if (step > 0) ctx.player.heal(step); h.left -= step; if (h.left <= 0.001) st.healQueue.splice(i, 1); }
    },
  };
  return api;
}
