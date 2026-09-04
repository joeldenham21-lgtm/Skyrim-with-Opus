// Small procedural textures shared by several modules (sprites, glows).
import * as THREE from 'three';
const cache = new Map();
// radial gradient: stops = [[t, 'rgba(...)'], ...]
export function radialTexture(key, stops, size = 128) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.userData.shared = true;
  cache.set(key, tex); return tex;
}
export const glowTexture = () => radialTexture('glow', [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.45)'], [0.7, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']]);
export const softDotTexture = () => radialTexture('softdot', [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64);
