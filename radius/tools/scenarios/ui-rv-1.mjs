// Review pass, screens: title, settings (live apply + Esc unwind), pause + confirm, death report (typing, finished, respawn).
// node tools/smoke.mjs --out .smoke/ui-rv-1 --scenario tools/scenarios/ui-rv-1.mjs --w 640 --h 360
export default async function (page, api) {
  const R = 'window.__radius';
  const J = (expr) => api.run(`(() => { try { return JSON.stringify(${expr}); } catch (e) { return 'THREW ' + (e.stack || e); } })()`);
  const click = (a) => api.run(`(() => { const b = [...document.querySelectorAll('#menus [data-a], #panels [data-a]')].find((x) => x.dataset.a === '${a}'); if (!b) return 'no button ${a}'; b.click(); return 'clicked ${a}'; })()`);
  await api.run(`${R}.ctx.debug.noEnemies = true`);
  await api.frames(2);
  console.log('title:', await J(`({ menu: ${R}.ctx.menus.current, mode: ${R}.ctx.mode, continueDisabled: document.querySelector('#menus [data-a=continue]').disabled, focused: document.activeElement && document.activeElement.dataset.a })`));
  await api.screenshot('title');
  await api.run(`${R}.ctx.menus.show('settings')`); await api.frames(1);
  await api.key('ArrowDown'); await api.key('ArrowRight'); await api.key('ArrowRight'); await api.frames(1);
  console.log('settings fov after two steps:', await J(`${R}.ctx.state.data.settings.fov + '/' + ${R}.ctx.camera.fov + ' saved=' + (localStorage.getItem('radius.save.v1.settings') || '').slice(0, 60)`));
  await api.screenshot('settings');
  await api.key('Escape'); await api.frames(1);
  console.log('after Esc from settings:', await J(`${R}.ctx.menus.current`));

  await api.start();
  await api.run(`(() => { const r = ${R}; r.give('art_pearl', 2); r.give('medkit'); r.ctx.state.data.money = 5000; r.ctx.state.data.hp = 62; r.ctx.state.data.bleeding = true; const s = r.ctx.state.data.stats; s.kills = 7; s.shots = 213; s.distance = 4180; s.artifacts = 2; })()`);
  await api.run(`${R}.ctx.game.pause()`); await api.frames(2);
  console.log('pause:', await J(`({ menu: ${R}.ctx.menus.current, mode: ${R}.ctx.mode, enabled: ${R}.ctx.input.enabled })`));
  await api.screenshot('pause');
  await api.key('ArrowDown'); await api.key('ArrowDown'); await api.key('Enter'); await api.frames(1);
  await api.screenshot('pause-confirm');
  console.log(await click('cancel'));
  await api.run(`${R}.ctx.game.resume()`); await api.frames(1);
  console.log('resumed:', await J(`({ menu: ${R}.ctx.menus.current, mode: ${R}.ctx.mode, enabled: ${R}.ctx.input.enabled })`));

  await api.run(`${R}.ctx.player.die({ kind: 'bullet' })`);
  await api.wait(3600); await api.frames(2);
  console.log('death menu:', await J(`({ menu: ${R}.ctx.menus.current, mode: ${R}.ctx.mode, lines: [...document.querySelectorAll('#menus .ln')].map((e) => e.textContent).filter(Boolean).length })`));
  await api.screenshot('death-typing');
  await api.key('Enter'); await api.frames(1);
  console.log('death final:', await J(`({ text: [...document.querySelectorAll('#menus .ln')].map((e) => e.textContent).join(' | '), btnOn: !!document.querySelector('#menus .btns.on'), focused: document.activeElement && document.activeElement.dataset.a })`));
  await api.screenshot('death-final');
  console.log(await click('respawn')); await api.frames(2);
  console.log('after respawn:', await J(`({ menu: ${R}.ctx.menus.current, mode: ${R}.ctx.mode, hp: ${R}.ctx.state.data.hp, day: ${R}.ctx.state.data.day, hour: ${R}.ctx.state.data.hour, weapons: ${R}.ctx.inventory.weapons.map((w) => w.id), enabled: ${R}.ctx.input.enabled })`));
  await api.run(`${R}.ctx.game.toTitle()`); await api.frames(1);
  console.log('toTitle:', await J(`({ menu: ${R}.ctx.menus.current, continueDisabled: document.querySelector('#menus [data-a=continue]').disabled })`));
}
