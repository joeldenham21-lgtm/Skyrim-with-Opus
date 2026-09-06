// Render diagnostics: cascaded shadows A/B (cascades on, then castShadow off), torch beam at night, low sun shafts.
export default async function (page, api) {
  await api.run('window.__radius.ctx.debug.noEnemies = true');
  await api.start();
  await api.run(`(() => { const r = window.__radius; r.teleport(-130, 60); r.setLook(0.8, -0.18); r.setTime(17.0); })()`);
  await api.frames(4);
  await api.screenshot('zarya-1700-shadows');
  const info = await api.run(`(() => { const c = window.__radius.ctx; const L = c.lighting; const l0 = L.csm ? L.csm.lights[0] : L.sun; const sc = l0.shadow.camera;
    return { cascades: L.cascades, breaks: L.csm ? L.csm.breaks : null, map: !!l0.shadow.map, bounds: [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far].map((v) => +v.toFixed(1)), pos: l0.position.toArray().map((v) => +v.toFixed(1)), tgt: l0.target.position.toArray().map((v) => +v.toFixed(1)), inten: +l0.intensity.toFixed(2), nb: l0.shadow.normalBias, bias: l0.shadow.bias, pars: c.THREE.ShaderChunk.lights_pars_begin.slice(0, 220), body: c.THREE.ShaderChunk.lights_fragment_begin.indexOf('csmCascades') }; })()`);
  console.log('shadow-info', JSON.stringify(info));
  await api.run(`(() => { const L = window.__radius.ctx.lighting; (L.csm ? L.csm.lights : [L.sun]).forEach((l) => { l.castShadow = false; }); })()`);
  await api.frames(4);
  await api.screenshot('zarya-1700-noshadow');
  await api.run(`(() => { const L = window.__radius.ctx.lighting; (L.csm ? L.csm.lights : [L.sun]).forEach((l) => { l.castShadow = true; }); })()`);
  // torch beam at night in the forest
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(22.5); r.ctx.state.data.flashlight.on = true; })()`);
  await api.frames(5);
  await api.screenshot('forest-2230-torch');
  const beam = await api.run(`(() => { const c = window.__radius.ctx; const b = c.lighting.beams[0]; return { vis: b.mesh.visible, inten: +b.intensity.toFixed(4), depth: !!(c.post.st.sceneTarget && c.post.st.sceneTarget.depthTexture), errs: c._errors ? [...c._errors.keys()].slice(0, 4) : [] }; })()`);
  console.log('beam-info', JSON.stringify(beam));
  // low sun through the birches at the gate
  await api.run(`(() => { const r = window.__radius; r.ctx.state.data.flashlight.on = false; r.teleport(0, 284); r.setLook(1.2, 0.12); r.setTime(17.6); })()`);
  await api.frames(4);
  await api.screenshot('gate-1736-shafts');
  const rays = await api.run(`(() => { const c = window.__radius.ctx; return { rays: c.post.rays.enabled, col: c.post.uniforms.uRaysColor.value.toArray().map((v) => +v.toFixed(3)), sunUv: c.post.st.sunUv.toArray().map((v) => +v.toFixed(2)) }; })()`);
  console.log('rays-info', JSON.stringify(rays));
}
