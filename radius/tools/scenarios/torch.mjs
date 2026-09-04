export default async function (page, api) {
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, -0.45); r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(10);
  const info = await api.run(`(() => { const L = window.__radius.ctx.lighting.flashlight; const p = new window.__radius.ctx.THREE.Vector3(); const t = new window.__radius.ctx.THREE.Vector3(); L.getWorldPosition(p); L.target.getWorldPosition(t); return { i: L.intensity, v: L.visible, pos: p.toArray(), tgt: t.toArray(), parent: L.parent && L.parent.type, angle: L.angle, dist: L.distance, decay: L.decay, cam: window.__radius.ctx.camera.position.toArray() }; })()`);
  console.log('flashlight', JSON.stringify(info));
  await api.screenshot('torch-down');
}
