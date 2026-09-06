// STUB — owned by the enemies-fast agent. The Phantom: near-invisible refractive mimic, visible in night vision.
import * as THREE from 'three';
import { Enemy } from './common.js';
class Phantom extends Enemy {
  constructor(ctx, position, opts) { super(ctx, 'phantom', position, Object.assign({ hp: 70 }, opts)); this.root.visible = false; }
  tick(dt) { this.followGround(dt); this.perceive(dt); }
  onDeath() { this.ctx.vfx.ash(this.position); }
}
export function registerPhantom(ctx) { ctx.enemies.registerType('phantom', Phantom); }
