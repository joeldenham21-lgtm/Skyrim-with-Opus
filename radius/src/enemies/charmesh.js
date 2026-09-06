// STUB — owned by the characters agent. Rigged, skinned procedural characters and their animation.
//   buildHumanoid(opts) -> Rig { root: Group, bones: {hips,spine,chest,neck,head,shoulderL,upperArmL,lowerArmL,handL,...R, upperLegL,lowerLegL,footL,...R},
//                              attach(weaponGroup) (parents to the right hand and poses the left), wear(vestId, helmetId, packId),
//                              setState(s: {speed, aiming, aimAt: Vector3|null, crouch, hit, dead, glitch}), update(dt), dispose(), material }
//   buildQuadruped(opts) -> Rig for the slider; buildCrawler(opts) -> Rig for the spawn; buildHeavy(opts) -> Rig for the seeker.
// Until the real module lands, this returns a simple capsule rig so entity code can be written against the API.
import * as THREE from 'three';
function simpleRig(height, radius, color = 0x0a0a0c) {
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.1, height - radius * 2), 4, 8), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.position.y = height / 2; m.castShadow = true; root.add(m);
  const hand = new THREE.Object3D(); hand.position.set(radius, height * 0.62, -radius * 0.5); root.add(hand);
  const head = new THREE.Object3D(); head.position.set(0, height * 0.93, 0); root.add(head);
  return {
    root, bones: { handR: hand, head, hips: root }, material: m.material, stub: true,
    attach(g) { if (g) hand.add(g); }, wear() {}, setState() {}, update() {}, dispose() { m.geometry.dispose(); m.material.dispose(); },
  };
}
export function buildHumanoid(opts = {}) { return simpleRig(opts.height || 1.8, 0.28); }
export function buildQuadruped(opts = {}) { return simpleRig(0.9, 0.3); }
export function buildCrawler(opts = {}) { return simpleRig(0.35, 0.3); }
export function buildHeavy(opts = {}) { return simpleRig(3.0, 0.6, 0x1a1c18); }
