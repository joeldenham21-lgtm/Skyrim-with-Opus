// Shared helpers for the enemies-core scenarios. The full zone renders at well under 1 fps under SwiftShader
// once the world content is in, so these tests start the game directly, thin the scene down to terrain, sky,
// structures and entities (test-only, in-page; nothing on disk changes), and wait for frames with a long timeout.
export async function boot(api, { noEnemies = true, lighten = 1 } = {}) {
  await api.run(`window.__radius.ctx.debug.noEnemies = ${noEnemies}; window.__radius.start();`);
  await api.wait(300);
  if (lighten) await thin(api, lighten);
  await frames(api, 2, 400000);
}
// level 1: hide flora, instanced crowds, particles; level 2: also hide structures and props; shrink the shadow map
export async function thin(api, level = 1) {
  return api.run(`(() => { const ctx = window.__radius.ctx; let hidden = 0;
    ctx.scene.traverse((o) => { if (o.userData.__enemy) return; if (!o.geometry && !o.isPoints) return; const n = (o.name || '') + '|' + (o.parent && o.parent.name || '');
      const flora = /flora|grass|tree|bush|reed|debris/i.test(n) || o.isInstancedMesh || (o.geometry && o.geometry.isInstancedBufferGeometry);
      const struct = /:/.test(n) || /zarya|object12|church|convoy|checkpoint|rail|base|bunker|vanno/i.test(n);
      if (flora || (${level} >= 2 && struct)) { o.visible = false; hidden++; } });
    const sun = ctx.lighting.sun; if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } sun.shadow.mapSize.set(1024, 1024);
    return hidden; })()`);
}
export async function frames(api, n = 5, timeout = 400000) {
  const f0 = await api.run('window.__radius.ctx.frame');
  await api.page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout, polling: 300 });
}
// place a mimic/seeker relative to the player: dist ahead (+) or behind (-), side offset, facing the player
export function spawnRel(type, dist, side = 0, extra = '{}') {
  return `(() => { const r = window.__radius, p = r.ctx.player; p.update(0); const f = p.forward; const x = p.position.x + f.x * ${dist} + f.z * ${side}, z = p.position.z + f.z * ${dist} - f.x * ${side};
    const e = r.spawn('${type}', x, z, Object.assign({ yaw: Math.atan2(-(p.position.x - x), -(p.position.z - z)) }, ${extra})); e.root.userData.__enemy = true; e.root.traverse((o) => { o.userData.__enemy = true; }); return e; })()`;
}
export const fpsProbe = `(() => { const ctx = window.__radius.ctx; const gl = ctx.renderer.getContext(); const t0 = performance.now(); ctx.post.render(); gl.finish(); return +(performance.now() - t0).toFixed(0); })()`;
// screenshot with a long timeout (the harness default of 30 s is too short under load)
let shotN = 0;
export async function shot(api, name) { const p = `${api.outDir}/${String(shotN++).padStart(2, '0')}-${name}.png`; await api.page.screenshot({ path: p, timeout: 240000 }); console.log('screenshot', p); return p; }
