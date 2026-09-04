// World interaction registry. Anything usable registers here; the HUD shows the nearest prompt in view.
// register({ position: Vector3 | () => Vector3, radius: 2.2, prompt: 'PICK UP · PM', hold: 0 | seconds, onInteract(), enabled: () => bool })
export function createInteract(ctx) {
  const items = new Set();
  let current = null, holdT = 0, holding = false;
  const tmp = { x: 0, y: 0, z: 0 };
  const api = {
    register(obj) { obj.radius = obj.radius ?? 2.2; obj.hold = obj.hold ?? 0; items.add(obj); return () => items.delete(obj); },
    unregister(obj) { items.delete(obj); },
    get current() { return current; },
    get holdProgress() { return current && current.hold > 0 ? holdT / current.hold : 0; },
    clear() { items.clear(); current = null; },
    update(dt) {
      const cam = ctx.camera;
      const p = cam.position;
      const fwd = ctx.camera.getWorldDirection(ctx._tmpDir);
      let best = null, bestScore = Infinity;
      for (const it of items) {
        if (it.enabled && !it.enabled()) continue;
        const pos = typeof it.position === 'function' ? it.position() : it.position;
        const dx = pos.x - p.x, dy = pos.y - p.y, dz = pos.z - p.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > it.radius) continue;
        // must be roughly in front of the camera
        const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(d, 1e-3);
        if (d > 0.6 && dot < 0.55) continue;
        const score = d * (2 - dot);
        if (score < bestScore) { bestScore = score; best = it; }
      }
      if (best !== current) { current = best; holdT = 0; holding = false; }
      if (!current) { ctx.hud.prompt(null); return; }
      const label = typeof current.prompt === 'function' ? current.prompt() : current.prompt;
      if (current.hold > 0) {
        if (ctx.input.down('interact')) { holding = true; holdT += dt; ctx.hud.prompt(label, holdT / current.hold); if (holdT >= current.hold) { holdT = 0; holding = false; current.onInteract?.(); if (!items.has(current)) { current = null; ctx.hud.prompt(null); } } }
        else { holdT = Math.max(0, holdT - dt * 2); ctx.hud.prompt(label, holdT / current.hold); }
      } else {
        ctx.hud.prompt(label, 0);
        if (ctx.input.pressed('interact')) { current.onInteract?.(); if (!items.has(current)) { current = null; ctx.hud.prompt(null); } }
      }
    },
  };
  return api;
}
