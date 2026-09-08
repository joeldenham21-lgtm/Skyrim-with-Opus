// Touch controls: drives the on-screen layer with real multi-touch and checks the game responds.
//   node tools/smoke.mjs --phone --scenario tools/scenarios/touch.mjs --out .smoke/touch
//
// Uses CDP Input.dispatchTouchEvent so these are genuine touch points with ids. The layout exists to
// solve four reported failures — too much screen covered, controls that cannot be combined, no way
// to look and shoot at once, and text labels — so each is asserted directly.
export default async function (page, api) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  const rect = (sel) => api.run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
    const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; })()`);

  await api.start();
  await api.frames(3);

  console.log('LAYER', JSON.stringify(await R(`return {
    inputTouch: c.input.touch, uiClass: document.getElementById('ui').classList.contains('touch'),
    pointerLocked: c.input.locked, softLook: c.input.softLook,
    quality: c.state.data.settings.quality, scale: c.state.data.settings.resolutionScale,
  };`)));

  // ---- failure 1: how much of the screen do the controls actually cover? ----
  console.log('COVERAGE', JSON.stringify(await R(`
    const vw = innerWidth, vh = innerHeight;
    let px = 0; const items = [];
    for (const el of document.querySelectorAll('#touch .t-pad, #touch .t-tray:not([hidden])')) {
      const b = el.getBoundingClientRect();
      if (!b.width) continue;
      px += b.width * b.height;
      items.push(el.className.replace('t-pad ', '') + ':' + Math.round(b.width) + 'x' + Math.round(b.height));
    }
    return { viewport: vw + 'x' + vh, controls: items.length, percentOfScreen: +(px / (vw * vh) * 100).toFixed(1), items };`)));

  // ---- placement: no pad may sit inside the stick's landing zone ----
  console.log('PAD_OVERLAP', JSON.stringify(await R(`
    const mz = document.querySelector('#touch .t-move').getBoundingClientRect();
    const hits = [];
    for (const el of document.querySelectorAll('#touch .t-pad')) {
      if (el.hidden) continue;
      const b = el.getBoundingClientRect();
      if (b.right > mz.left && b.left < mz.right && b.bottom > mz.top && b.top < mz.bottom) {
        hits.push(el.className.replace('t-pad ', ''));
      }
    }
    return { moveZone: [Math.round(mz.left), Math.round(mz.top), Math.round(mz.width), Math.round(mz.height)], overlapping: hits };`)));

  // ---- contextual: USE must be absent when nothing is in reach ----
  console.log('CONTEXTUAL_USE', JSON.stringify(await R(`
    const u = document.querySelector('#touch .p-use');
    return { exists: !!u, hiddenWithNoTarget: !!u && u.hidden, interactTarget: !!(c.interact && c.interact.current) };`)));

  // ---- failure 4: icons, not words ----
  console.log('ICONS_NOT_WORDS', JSON.stringify(await R(`
    const pads = [...document.querySelectorAll('#touch .t-pad')];
    return { pads: pads.length, withSvg: pads.filter(p => p.querySelector('svg')).length,
             withText: pads.filter(p => p.textContent.trim().length > 0).map(p => p.textContent.trim()) };`)));

  // ---- failure 3: LOOK AND SHOOT AT THE SAME TIME ----
  // finger 1 drags in the look area; finger 2 holds the left-thumb trigger. Both must work at once.
  const fire = await rect('#touch .p-fire');
  const yaw0 = await R(`return c.player.yaw;`);
  await touch('touchStart', [{ x: 600, y: 200, id: 10 }]);
  await touch('touchMove', [{ x: 660, y: 200, id: 10 }]);
  await touch('touchStart', [{ x: 660, y: 200, id: 10 }, { x: fire.x, y: fire.y, id: 11 }]);
  const during = await R(`return { fireHeld: c.input.down('fire') };`);
  await touch('touchMove', [{ x: 730, y: 205, id: 10 }, { x: fire.x, y: fire.y, id: 11 }]);
  await api.frames(3);
  const yaw1 = await R(`return c.player.yaw;`);
  const stillFiring = await R(`return { fireHeld: c.input.down('fire') };`);
  await touch('touchEnd', []);
  await api.frames(2);
  console.log('LOOK_AND_SHOOT', JSON.stringify({
    fireHeldWhileLooking: during.fireHeld && stillFiring.fireHeld,
    yawChangedWhileFiring: Math.abs(yaw1 - yaw0) > 0.01,
    yawDelta: +(yaw1 - yaw0).toFixed(3),
    released: await R(`return c.input.down('fire');`),
  }));

  // ---- failure 2: controls that must combine — aim + fire, on opposite shoulders ----
  const tl = await rect('#touch .p-trig-l'), tr = await rect('#touch .p-trig-r');
  await touch('touchStart', [{ x: tl.x, y: tl.y, id: 20 }]);
  await touch('touchStart', [{ x: tl.x, y: tl.y, id: 20 }, { x: tr.x, y: tr.y, id: 21 }]);
  const both = await R(`return { aim: c.input.down('aim'), fire: c.input.down('fire') };`);
  // and a third finger still looks while both shoulders are held
  await touch('touchStart', [{ x: tl.x, y: tl.y, id: 20 }, { x: tr.x, y: tr.y, id: 21 }, { x: 500, y: 250, id: 22 }]);
  await touch('touchMove', [{ x: tl.x, y: tl.y, id: 20 }, { x: tr.x, y: tr.y, id: 21 }, { x: 580, y: 250, id: 22 }]);
  await api.frames(2);
  const triple = await R(`return { aim: c.input.down('aim'), fire: c.input.down('fire'), yaw: +c.player.yaw.toFixed(3) };`);
  await touch('touchEnd', []);
  await api.frames(2);
  console.log('AIM_AND_FIRE', JSON.stringify({ bothShoulders: both, plusLooking: triple,
    allReleased: await R(`return { aim: c.input.down('aim'), fire: c.input.down('fire') };`) }));

  // ---- sprint has no button: the stick rim is a run ----
  await touch('touchStart', [{ x: 150, y: 300, id: 30 }]);
  await touch('touchMove', [{ x: 150, y: 296, id: 30 }]);
  const walk = await R(`return { axisZ: +c.input.axisZ.toFixed(2), sprint: c.input.down('sprint') };`);
  await touch('touchMove', [{ x: 150, y: 230, id: 30 }]);
  const run = await R(`return { axisZ: +c.input.axisZ.toFixed(2), sprint: c.input.down('sprint') };`);
  await touch('touchEnd', []);
  await api.frames(2);
  console.log('STICK_RIM_IS_SPRINT', JSON.stringify({ nudge: walk, rim: run,
    releasedSprint: await R(`return c.input.down('sprint');`) }));

  // ---- the tray holds the rare actions behind one button ----
  const more = await rect('#touch .p-more');
  await touch('touchStart', [{ x: more.x, y: more.y, id: 40 }]);
  await touch('touchEnd', []);
  await api.frames(2);
  console.log('TRAY', JSON.stringify(await R(`
    const t = document.querySelector('#touch .t-tray');
    return { open: !t.hidden, items: t.querySelectorAll('.t-tray-btn').length };`)));
  await api.screenshot('phone-tray');

  await touch('touchStart', [{ x: 500, y: 250, id: 41 }]);   // looking dismisses it
  await touch('touchEnd', []);
  await api.frames(2);
  console.log('TRAY_DISMISS', JSON.stringify(await R(`return { open: !document.querySelector('#touch .t-tray').hidden };`)));

  await api.screenshot('phone-hud');
  console.log('NOTHING_STUCK', JSON.stringify(await R(`
    return ['fire','aim','sprint','interact','crouch','jump','reload'].filter(a => c.input.down(a));`)));
  console.log('ERRORS', JSON.stringify(await R(`return [...(c._errors || [])];`)));
}
