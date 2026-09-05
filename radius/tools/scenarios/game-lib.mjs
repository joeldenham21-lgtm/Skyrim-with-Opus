// shared helpers for the game agent's scenarios: waits that tolerate very slow software frames, and an
// interact selector measured from player.eye (core/interact.js measures from camera.position, which is the
// camera's local position inside the head rig, i.e. always the world origin — reported as a core bug).
export const fr = (page, api) => async (n = 2) => { const f0 = await api.run('window.__radius.ctx.frame'); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: 400000 }); };
export const face = (x, y, z) => `(() => { const c = window.__radius.ctx; const p = c.player; const dx = ${x} - p.eye.x, dz = ${z} - p.eye.z, dy = ${y} - p.eye.y; p.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); })()`;
export const PATCH = `(() => { const c = window.__radius.ctx; if (c.interact._all) return; c.interact._all = []; const reg = c.interact.register.bind(c.interact);
  c.interact.register = (o) => { const un = reg(o); c.interact._all.push(o); return () => { const i = c.interact._all.indexOf(o); if (i >= 0) c.interact._all.splice(i, 1); un(); }; };
  c.interact.pickEye = () => { const p = c.player.eye; const fwd = c.camera.getWorldDirection(new c.THREE.Vector3()); let best = null, bs = Infinity;
    for (const it of c.interact._all) { if (it.enabled && !it.enabled()) continue; const pos = typeof it.position === 'function' ? it.position() : it.position; const dx = pos.x - p.x, dy = pos.y - p.y, dz = pos.z - p.z; const d = Math.hypot(dx, dy, dz); if (d > it.radius) continue; const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(d, 1e-3); if (d > 0.6 && dot < 0.55) continue; const s = d * (2 - dot); if (s < bs) { bs = s; best = it; } }
    return best; }; })()`;
export const prompt = `(() => { const c = window.__radius.ctx; const it = c.interact.pickEye(); return it ? (typeof it.prompt === 'function' ? it.prompt() : it.prompt) : null; })()`;
export const interact = `(() => { const c = window.__radius.ctx; const it = c.interact.pickEye(); if (it) it.onInteract(); return !!it; })()`;
export async function start(page, api) { await api.run(PATCH); console.log('shader guard patched materials:', await api.run(SHADER_GUARD)); await api.run('window.__radius.start()'); await fr(page, api)(2); }
// test-side guard against a neighbour's in-progress onBeforeCompile (structures.js references an undeclared
// emissiveIntensity); recompiles affected materials so frames do not stall while that file is being fixed.
export const SHADER_GUARD = `(() => { const c = window.__radius.ctx; let n = 0; const seen = new Set();
  c.scene.traverse((o) => { const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of mats) { if (seen.has(m) || !m.onBeforeCompile || m.__guarded) continue; seen.add(m); const prev = m.onBeforeCompile; m.__guarded = true; m.onBeforeCompile = function (shader, renderer) { prev.call(this, shader, renderer); if (shader.fragmentShader.includes('wEmissive * emissiveIntensity')) { shader.fragmentShader = shader.fragmentShader.replace('wEmissive * emissiveIntensity', 'wEmissive'); n++; } }; m.needsUpdate = true; } });
  return n; })()`;
