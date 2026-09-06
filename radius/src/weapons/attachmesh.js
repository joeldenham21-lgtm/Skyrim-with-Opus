// TEMPORARY STUB while attachmesh.js is written: minimal groups so gunmesh.js loads.
import * as THREE from 'three';
export function buildAttachment(id, opts = {}) { const g = new THREE.Group(); g.name = id; return g; }
export function buildMag(id, opts = {}) { const g = new THREE.Group(); g.name = id; return g; }
export function buildItemMesh(id, opts = {}) { const g = new THREE.Group(); g.name = id; return g; }
export function setLightOn(mesh, on) {}
