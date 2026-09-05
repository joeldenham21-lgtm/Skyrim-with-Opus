// Death report typewriter. Written to survive a loaded machine: one frame waits, Enter completes the typing.
// node tools/smoke.mjs --out .smoke/ui-3 --scenario tools/scenarios/ui-3.mjs --w 960 --h 540
export default async function (page, api) {
  const R = 'window.__radius';
  await api.run(`${R}.ctx.debug.noEnemies = true; ${R}.start()`); await api.frames(1);
  await api.run(`(() => { const r = ${R}; r.ctx.state.data.stats.kills = 7; r.ctx.state.data.stats.shots = 213; r.ctx.state.data.stats.distance = 4180; r.ctx.state.data.stats.artifacts = 2; r.setTime(14.6); })()`);
  await api.run(`${R}.ctx.player.die({ kind: 'bullet' })`);
  await api.wait(4000); await api.frames(1); await api.wait(2500); await api.frames(1);
  await api.screenshot('death-typing');
  console.log('typing:', await api.run(`${R}.ctx.menus.current + ' / ' + ${R}.ctx.mode + ' / enabled=' + ${R}.ctx.input.enabled`));
  await api.key('Enter'); await api.wait(800); await api.frames(1);
  await api.screenshot('death-final');
  const btn = await api.run(`(() => { const b = document.querySelector('#menus .btns'); return b ? b.className + ' / focus=' + (document.activeElement === document.querySelector('#menus [data-a]')) : 'none'; })()`);
  console.log('button state:', btn);
  await api.key('Enter'); await api.wait(500); await api.frames(2);
  console.log('after Enter:', await api.run(`JSON.stringify({ mode: ${R}.ctx.mode, menu: ${R}.ctx.menus.current, day: ${R}.ctx.state.data.day, hp: ${R}.ctx.state.data.hp, enabled: ${R}.ctx.input.enabled })`));
  await api.frames(2);
  await api.screenshot('after-respawn');
}
