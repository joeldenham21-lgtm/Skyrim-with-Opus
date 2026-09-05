// Weapons review pass 4: hit test through the API and through a synthetic Mouse0 press, a captured shot frame
// (tracer + muzzle flash), then the night torch with in-page pixel probes and a light-cap sweep.
// node tools/smoke.mjs --out .smoke/weapons-rv-4 --scenario tools/scenarios/weapons-rv-4.mjs --w 640 --h 360
export default async function (page, api) {
  await api.run(`window.__radius.ctx.debug.noEnemies = true`);
  await api.start();
  const a = await api.run(`(() => {
    const r = window.__radius, c = r.ctx, W = c.weapons, p = c.player;
    r.god(); r.teleport(30, 130); r.setLook(0.2, -0.05); r.setTime(11);
    const step = (n) => { for (let i = 0; i < n; i++) { p.update(0.05); c.hands.update(0.05); W.update(0.05); c.input.endFrame(); } };
    step(9);
    const out = {};
    const e = r.spawn('mimic', p.position.x - Math.sin(p.yaw) * 10, p.position.z - Math.cos(p.yaw) * 10);
    const aim = () => { const dx = e.position.x - p.eye.x, dz = e.position.z - p.eye.z, dy = (e.position.y + e.height * 0.55) - p.eye.y; r.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); p.update(0); };
    aim();
    const hp0 = e.hp; W.fire(); step(1);
    out.apiShot = { hp0, hp: +e.hp.toFixed(1), shots: c.state.data.stats.shots, mag: W.current.mags[0], chamber: W.current.chamber };
    step(4); aim();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Mouse0' })); step(1); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Mouse0' })); step(1);
    out.keyShot = { hp: +e.hp.toFixed(1), shots: c.state.data.stats.shots, mag: W.current.mags[0] };
    // headshot: aim at the top of the capsule
    step(4); const dx = e.position.x - p.eye.x, dz = e.position.z - p.eye.z, dy = (e.position.y + e.height * 0.93) - p.eye.y; r.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); p.update(0);
    const hpH = e.hp; W.fire(); step(1); out.headShot = { before: +hpH.toFixed(1), after: +e.hp.toFixed(1) };
    // freeze vfx so the next real frame keeps the tracer and flash, then fire once more for the screenshot
    step(4); aim(); window.__vfxUpdate = c.vfx.update; c.vfx.update = () => {}; W.fire();
    out.after = { hp: +e.hp.toFixed(1), alive: e.alive, director: c.director.state, sfx: [...c.audio.missing] };
    return out;
  })()`);
  console.log('HITS', JSON.stringify(a));
  await api.frames(1);
  await api.screenshot('shot-frame');
  await api.run(`(() => { const c = window.__radius.ctx; c.vfx.update = window.__vfxUpdate; })()`);
  const b = await api.run(`(() => {
    const r = window.__radius, c = r.ctx, W = c.weapons, p = c.player;
    for (const e of c.enemies.list) e.kill?.({ kind: 'blast' });
    r.setTime(22.5); c.state.data.flashlight.on = true; r.setLook(0.2, -0.12); p.update(0);
    const step = (n) => { for (let i = 0; i < n; i++) { p.update(0.05); c.hands.update(0.05); W.update(0.05); c.lighting.update(0.05); c.input.endFrame(); } };
    step(24);
    const gl = c.renderer.getContext(); const Wd = gl.drawingBufferWidth, Hd = gl.drawingBufferHeight;
    const probe = (fx0, fy0, fx1, fy1) => { const x0 = Math.round(Wd * fx0), y0 = Math.round(Hd * fy0), w = Math.round(Wd * (fx1 - fx0)), h = Math.round(Hd * (fy1 - fy0)); const px = new Uint8Array(w * h * 4); gl.readPixels(x0, Hd - y0 - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); const s = [0, 0, 0]; for (let i = 0; i < w * h; i++) { s[0] += px[i * 4]; s[1] += px[i * 4 + 1]; s[2] += px[i * 4 + 2]; } return s.map((v) => Math.round(v / (w * h))); };
    const render = () => { c.lighting.update(0.05); c.sky.update(0.05, c.elapsed); c.vfx.update(0.05, c.elapsed); c.post.update(0.05, c.elapsed); c.post.render(); };
    const out = { torch: { intensity: +c.lighting.flashlight.intensity.toFixed(1), visible: c.lighting.flashlight.visible, distance: c.lighting.flashlight.distance, decay: c.lighting.flashlight.decay } };
    render();
    const mesh = c.hands.weapon.children.find((o) => o.isMesh); const M = mesh.material;
    const props = c.renderer.properties.get(M);
    const src = props.currentProgram ? gl.getShaderSource(props.currentProgram.fragmentShader) : '';
    out.shader = { hasCap: src.includes('uLightCap'), mins: (src.match(/min\\( directLight.color/g) || []).length, spot: (src.match(/NUM_SPOT_LIGHTS (\\d+)/) || [])[1], point: (src.match(/NUM_POINT_LIGHTS (\\d+)/) || [])[1], uniformKeys: props.uniforms ? Object.keys(props.uniforms).filter((k) => /^u[A-Z]/.test(k)) : null, capValue: props.uniforms && props.uniforms.uLightCap ? props.uniforms.uLightCap.value.toArray() : null };
    const boxes = { gun: [0.6, 0.66, 0.72, 0.86], hands: [0.53, 0.84, 0.75, 0.99], ground: [0.25, 0.75, 0.45, 0.95], sky: [0.2, 0.1, 0.5, 0.3] };
    const sample = () => { const o = {}; for (const k in boxes) o[k] = probe(...boxes[k]); return o; };
    out.default = sample();
    const cap = props.uniforms && props.uniforms.uLightCap ? props.uniforms.uLightCap.value : null;
    if (cap) { for (const v of [[50, 50], [12, 20], [2.5, 4], [4.5, 7]]) { cap.set(v[0], v[1]); render(); out['cap' + v[0]] = sample(); } }
    return out;
  })()`);
  console.log('NIGHT', JSON.stringify(b));
  await api.frames(2);
  await api.screenshot('night-torch');
  console.log('stats', JSON.stringify(await api.run('window.__radius.stats()')));
}
