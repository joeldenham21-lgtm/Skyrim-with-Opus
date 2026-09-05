import * as THREE from 'three';

export function createRenderer(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;   // the post chain does grading + tone mapping
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = window.__radiusFast ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 1);
  renderer.info.autoReset = false;
  const api = {
    renderer,
    quality: settings.quality || 'high',
    resize() {
      const q = api.quality;
      const pr = window.__radiusFast ? 1 : Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'medium' ? 1.25 : 1.5);
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    },
  };
  api.resize();
  return api;
}
