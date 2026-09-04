// STUB — owned by an enemies agent. Registers the 'slider' type. See DESIGN.md §6 and ARCHITECTURE.md §Enemies.
import * as THREE from 'three';
import { Enemy } from './common.js';
class Slider extends Enemy {
  constructor(ctx, position, opts) {
    super(ctx, 'slider', position, Object.assign({ hp: 90 }, opts));
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }));
    m.position.y = 0.9; m.castShadow = true; this.root.add(m);
  }
  tick(dt) { this.followGround(dt); this.perceive(dt); }
  onDeath() { this.ctx.vfx.ash(this.position); this.root.visible = false; }
}
export function registerSlider(ctx) { ctx.enemies.registerType('slider', Slider); }
