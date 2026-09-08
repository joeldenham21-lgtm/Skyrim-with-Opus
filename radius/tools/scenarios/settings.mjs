// The frame rate target and the dynamic-resolution switch are new rows on the settings sheet, and
// dynamicResolution is a boolean shown as an off/on pair — the generic row machinery would otherwise
// store the string "false", which perf.js reads as truthy. Drive both from the sheet's own buttons.
export default async function (page, api) {
  await api.wait(600);
  const out = await api.run(`(() => {
    const ctx = window.__radius.ctx, s = ctx.state.data.settings;
    const before = { targetFps: s.targetFps, dynamicResolution: s.dynamicResolution, types: [typeof s.targetFps, typeof s.dynamicResolution] };
    ctx.menus.show('settings');
    const card = document.querySelector('#menus .sheet');
    const rowOf = (k) => card && card.querySelector('.stp[data-key="' + k + '"]');
    const click = (a) => { const b = card && card.querySelector('[data-a="' + a + '"]'); if (b) { b.click(); return true; } return false; };
    const rows = [...(card ? card.querySelectorAll('.stp') : [])].map((r) => r.dataset.key);
    // dynamic resolution off, then on again
    const offClicked = click('set:dynamicResolution:off');
    const afterOff = { v: s.dynamicResolution, type: typeof s.dynamicResolution, isFalse: s.dynamicResolution === false };
    const onClicked = click('set:dynamicResolution:on');
    const afterOn = { v: s.dynamicResolution, type: typeof s.dynamicResolution, isTrue: s.dynamicResolution === true };
    // and the frame-rate target steps
    const upClicked = click('step:targetFps:1');
    const afterUp = s.targetFps;
    click('step:targetFps:-1');
    const afterDown = s.targetFps;
    const label = rowOf('targetFps') ? rowOf('targetFps').querySelector('.val').textContent : null;
    const segOn = rowOf('dynamicResolution') ? [...rowOf('dynamicResolution').querySelectorAll('.seg button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')) : null;
    ctx.menus.hide();
    return { before, rows, offClicked, afterOff, onClicked, afterOn, upClicked, afterUp, afterDown, label, segOn };
  })()`);
  console.log('SETTINGS ' + JSON.stringify(out, null, 1));
  const ok = out.before.targetFps === 60 && out.afterOff.isFalse && out.afterOn.isTrue
    && out.afterUp === 66 && out.afterDown === 60 && out.label === '60 fps';
  console.log('SUMMARY ' + (ok ? 'PASS' : 'FAIL') + ` defaultTarget=${out.before.targetFps} boolStoresBoolean=${out.afterOff.type === 'boolean'} stepUp=${out.afterUp} stepBack=${out.afterDown} label=${out.label}`);
}
