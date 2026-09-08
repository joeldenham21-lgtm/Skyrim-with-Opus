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
      // Pixel ratio is NOT a quality-tier concern. Tying them meant 'low' capped a phone with a 3x
      // display to 1x — a 9x pixel deficit — and with render scale on top the 3D chain ran at
      // 633x293, or 317x146 once dynamic resolution hit its floor, upscaled onto a 2532x1170 screen.
      // The tier now governs effects (shadows, AO, post); resolution is governed by the pixel-ratio
      // cap below and by the dynamic-resolution governor, which scales the 3D chain to hold the
      // frame-rate target while the DOM HUD stays native and crisp.
      const q = api.quality;
      const cap = settings.pixelRatio || (q === 'low' ? 1.5 : q === 'medium' ? 2 : 2);
      const pr = window.__radiusFast ? 1 : Math.min(window.devicePixelRatio || 1, cap);
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    },
  };
  api.resize();
  return api;
}
