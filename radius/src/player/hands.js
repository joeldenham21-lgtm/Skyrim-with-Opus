// STUB — owned by the weapons agent. Viewmodel rig parented to the camera: sway, bob, ADS, recoil kick.
import * as THREE from 'three';
export function createHands(ctx) {
  const root = new THREE.Group(); root.name = 'hands'; ctx.camera.add(root);
  return { root, adsBlend: 0, setWeaponMesh(mesh) {}, kick(pitch = 0, yaw = 0) {}, update(dt) {} };
}
