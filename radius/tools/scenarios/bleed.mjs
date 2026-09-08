// Bleeding: it must be visible while it happens, and stoppable with the key the UI promises.
//   node tools/smoke.mjs --scenario tools/scenarios/bleed.mjs --out .smoke/bleed
//
// Regression for "died of exsanguination about five minutes in with nothing visibly wrong": the
// bleed tick used to write hp directly, so 99 points of damage arrived with no flash, no sound and
// no playerDamaged event, and keys 6-9 were never read so the bandage could not be reached.
export default async function (page, api) {
  const R = (js) => api.run(`(() => { const c = window.__radius.ctx; const r = window.__radius; ${js} })()`);
  await api.start();
  await api.frames(3);

  // count the feedback a bleeding player actually receives
  await R(`window.__bleedEvents = 0; window.__flashes = 0;
    c.events.on('playerDamaged', (n, info) => { if (info && info.kind === 'bleed') window.__bleedEvents++; });
    const f = c.post.damageFlash.bind(c.post); c.post.damageFlash = (v) => { window.__flashes++; return f(v); };`);

  console.log('START', JSON.stringify(await R(`return {
    hp: c.state.data.hp, bleeding: !!c.state.data.bleeding,
    quickSlots: c.inventory.quick, bandages: c.inventory.count('bandage'),
    quickBarFilled: !!document.getElementById('quick') && document.getElementById('quick').children.length > 0,
  };`)));

  // ---- start bleeding, then run the clock past several ticks (one tick per 3s) ----
  await R(`c.state.data.bleeding = true; c.state.data.hp = 60;`);
  await R(`for (let i = 0; i < 400; i++) c.player.update(0.05);`);   // 20 simulated seconds ~ 6 ticks
  const bled = await R(`return { hp: c.state.data.hp, events: window.__bleedEvents, flashes: window.__flashes, bleeding: !!c.state.data.bleeding };`);
  console.log('BLED', JSON.stringify(bled));
  console.log('FEEDBACK_OK', JSON.stringify({
    lostHp: 60 - bled.hp > 0,
    reportedEveryTick: bled.events >= 5,
    flashedEveryTick: bled.flashes >= 5,
  }));

  // ---- the quick bar must now be drawn, and key 6 must reach the bandage ----
  const barBefore = await R(`return { html: document.getElementById('quick').textContent.replace(/\\s+/g, ' ').trim() };`);
  console.log('QUICKBAR', JSON.stringify(barBefore));

  const b0 = await R(`return c.inventory.count('bandage');`);
  await page.keyboard.press('Digit6');
  await api.frames(3);
  const after = await R(`return { hp: c.state.data.hp, bleeding: !!c.state.data.bleeding, bandages: c.inventory.count('bandage') };`);
  console.log('QUICK_USE', JSON.stringify({ bandagesBefore: b0, ...after, stoppedBleeding: !after.bleeding, consumed: b0 - after.bandages === 1 }));

  // ---- and an empty slot must not throw or consume anything ----
  await R(`c.inventory.setQuick(1, 'medkit');`);
  await page.keyboard.press('Digit7');
  await api.frames(2);
  console.log('EMPTY_SLOT', JSON.stringify(await R(`return { medkits: c.inventory.count('medkit'), errors: [...(c._errors || [])].length };`)));

  await api.screenshot('bleed-hud');
  console.log('ERRORS', JSON.stringify(await R(`return [...(c._errors || [])];`)));
}
