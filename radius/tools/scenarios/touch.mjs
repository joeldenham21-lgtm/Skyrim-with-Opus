// Touch controls: drives the on-screen layer with real multi-touch and checks the game responds.
//   node tools/smoke.mjs --phone --scenario tools/scenarios/touch.mjs --out .smoke/touch
//
// Uses CDP Input.dispatchTouchEvent so these are genuine touch points with ids — a mouse drag
// would not prove multi-touch works, and multi-touch (walk while looking) is the whole point.
export default async function (page, api) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  // centre of an on-screen control, in CSS pixels
  const rect = (sel) => api.run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
    const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; })()`);

  await api.start();
  await api.frames(3);

  // ---- the layer is present and actually driving input ----
  console.log('LAYER', JSON.stringify(await R(`return {
    exists: !!document.getElementById('touch'),
    visible: !!document.getElementById('touch') && !document.getElementById('touch').hidden,
    inputTouch: c.input.touch,
    uiClass: document.getElementById('ui').classList.contains('touch'),
    pointerLocked: c.input.locked,
    softLook: c.input.softLook,
    quality: c.state.data.settings.quality,
    scale: c.state.data.settings.resolutionScale,
  };`)));
  await api.screenshot('phone-hud');

  // ---- left stick: walk forward, and keep looking at the same time ----
  const before = await R(`return { x: c.player.position.x, z: c.player.position.z, yaw: c.player.yaw };`);
  await touch('touchStart', [{ x: 150, y: 300, id: 1 }]);
  await touch('touchMove', [{ x: 150, y: 300, id: 1 }]);          // settle, then deflect
  await touch('touchMove', [{ x: 150, y: 240, id: 1 }]);
  // second finger in the look area at the same time: this is the multi-touch case
  await touch('touchStart', [{ x: 150, y: 240, id: 1 }, { x: 620, y: 200, id: 2 }]);
  await touch('touchMove', [{ x: 150, y: 240, id: 1 }, { x: 700, y: 200, id: 2 }]);
  console.log('STICK', JSON.stringify(await R(`return { axisX: +c.input.axisX.toFixed(3), axisZ: +c.input.axisZ.toFixed(3), hasAxis: c.input.hasAxis };`)));
  await api.frames(6);
  await touch('touchEnd', [{ x: 150, y: 240, id: 1 }]);
  await touch('touchEnd', []);
  await api.frames(2);
  const after = await R(`return { x: c.player.position.x, z: c.player.position.z, yaw: c.player.yaw };`);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  console.log('MOVED', JSON.stringify({ metres: +moved.toFixed(2), yawDelta: +(after.yaw - before.yaw).toFixed(3) }));
  console.log('AXIS_CLEARED', JSON.stringify(await R(`return { axisX: c.input.axisX, axisZ: c.input.axisZ, hasAxis: c.input.hasAxis };`)));

  // ---- partial deflection must be partial speed, not a snap to full run ----
  await touch('touchStart', [{ x: 150, y: 300, id: 3 }]);
  await touch('touchMove', [{ x: 150, y: 286, id: 3 }]);      // ~26% of a 54px radius
  const partial = await R(`return { axisZ: +c.input.axisZ.toFixed(3) };`);
  await touch('touchEnd', []);
  console.log('PARTIAL', JSON.stringify(partial));

  // ---- fire button: a held pad must actually put a round downrange ----
  const fireBtn = await rect('#touch .b-fire');
  // a weapon instance has `mag` (one object) and `tube` (an array) — there is no `mags`
  const rounds = `const w = c.weapons.current; return w ? ((w.chamber ? 1 : 0) + (w.mag ? w.mag.rounds : 0) + (w.tube ? w.tube.length : 0)) : -1;`;
  const ammo0 = await R(rounds);
  if (fireBtn) {
    await touch('touchStart', [{ x: fireBtn.x, y: fireBtn.y, id: 4 }]);
    await api.frames(3);
    await touch('touchEnd', []);
    await api.frames(3);
  }
  const ammo1 = await R(rounds);
  console.log('FIRE', JSON.stringify({ btn: !!fireBtn, ammoBefore: ammo0, ammoAfter: ammo1, fired: ammo0 > ammo1 }));

  // ---- a screen button opens its panel, and the controls get out of the way ----
  const bag = await rect('#touch .t-screens .t-tab:nth-child(2)');
  if (bag) {
    await touch('touchStart', [{ x: bag.x, y: bag.y, id: 5 }]);
    await api.frames(2);
    await touch('touchEnd', []);
    await api.frames(3);
  }
  console.log('PANEL', JSON.stringify(await R(`return {
    open: !!c.panels.isOpen, which: c.panels.current,
    controlsHidden: document.getElementById('touch').hidden,
    stuckActions: ['fire','aim','sprint','interact'].filter(a => c.input.down(a)),
  };`)));
  await api.screenshot('phone-panel');

  await R(`c.panels.close();`);
  await api.frames(3);
  await api.screenshot('phone-final');
  console.log('AFTER_PANEL', JSON.stringify(await R(`return { mode: c.mode, controlsHidden: document.getElementById('touch').hidden };`)));

  // ---- portrait must raise the rotate notice rather than render a letterbox ----
  await page.setViewportSize({ width: 390, height: 844 });
  await api.frames(2);
  console.log('PORTRAIT', JSON.stringify(await R(`return {
    bodyPortrait: document.body.classList.contains('portrait'),
    noticeShown: getComputedStyle(document.getElementById('rotate')).display !== 'none',
  };`)));
  await api.screenshot('phone-portrait');
  await page.setViewportSize({ width: 844, height: 390 });
  await api.frames(2);
}
