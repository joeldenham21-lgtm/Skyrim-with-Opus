// PLACEHOLDER — the gunbuilder agent replaces this file. Minimal exports so the bundle resolves while it is being written.
import * as THREE from 'three';
const dark = () => new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 });
export function buildAttachment(id) { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.08), dark())); g.name = id; return g; }
export function buildMag(id) { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.06), dark())); g.name = id; return g; }
export function buildItemMesh(id) { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), dark())); g.name = id; return g; }
export function setLightOn(mesh, on) {}
