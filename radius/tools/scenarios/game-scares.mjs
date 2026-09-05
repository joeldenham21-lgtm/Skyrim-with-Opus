import { fr as mk, start } from './game-lib.mjs';
export default async function (page, api) {
  const fr = mk(page, api);
  await start(page, api);
  await api.run(`(() => { const r = window.__radius; r.ctx.enemies.removeAll(); r.ctx.debug.noEnemies = false; r.teleport(0, 250); r.setLook(0, 0.02); r.setTime(10); })()`);
  await fr(1);
  const ridge = await api.run(`(() => { const c = window.__radius.ctx; const ok = c.scares.trigger('ridge'); const e = c.enemies.list[c.enemies.list.length - 1]; return { ok, enemies: c.enemies.list.length, pos: e ? e.position.toArray().map(v => +v.toFixed(1)) : null, player: c.player.position.toArray().map(v => +v.toFixed(1)), pending: c.scares.pending, director: c.director.state }; })()`);
  console.log('RIDGE', JSON.stringify(ridge));
  if (ridge.pos) { await api.run(`(() => { const c = window.__radius.ctx; const p = c.player; const dx = ${ridge.pos[0]} - p.eye.x, dz = ${ridge.pos[2]} - p.eye.z, dy = ${ridge.pos[1]} + 1.0 - p.eye.y; p.setLook(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)) * 0.6); })()`); }
  await fr(2);
  await api.screenshot('scare-ridge');
  console.log('RIDGE HELD', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; const e = c.enemies.list[0]; return { enemies: c.enemies.list.length, aware: e && e.aware, observed: e && e.observedByPlayer(34), pending: c.scares.pending }; })()`)));
  await api.run(`window.__radius.setLook(Math.PI, 0)`);
  await api.run(`(() => { const c = window.__radius.ctx; for (let i = 0; i < 30; i++) { c.scares.update(0.05); } c.enemies.update(0.05); })()`);
  await fr(1);
  console.log('RIDGE GONE', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; return { enemies: c.enemies.list.length, pending: c.scares.pending, director: c.director.state, tension: c.director.tension }; })()`)));
  for (const n of ['gunfire', 'clicks', 'radio', 'footsteps', 'torch', 'fragments']) {
    const r = await api.run(`(() => { const c = window.__radius.ctx; c.state.data.flashlight.on = true; if ('${n}' === 'torch') c.state.data.hour = 23; c.director.rest(); const ok = c.scares.trigger('${n}'); const before = c.lighting.flashTarget; for (let i = 0; i < 12; i++) c.scares.update(0.1); return { ok, pending: c.scares.pending, flashTarget: c.lighting.flashTarget, enemies: c.enemies.list.map(e => e.type) }; })()`);
    console.log('SCARE', n, JSON.stringify(r));
  }
  console.log('AUTO', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; c.director.rest(); c.state.data.hour = 12; c.player.inBase = false; let fired = 0; const off = c.events.on('directorNotify', (k) => { if (k === 'unease') fired++; }); for (let i = 0; i < 9000; i++) c.scares.update(0.05); off(); return { fired, pending: c.scares.pending, director: c.director.state }; })()`)));
  console.log('TIDE', JSON.stringify(await api.run(`(() => { const c = window.__radius.ctx; c.events.emit('tide', 2); c.enemies.update(0.05); return { enemies: c.enemies.list.length, pending: c.scares.pending }; })()`)));
}
