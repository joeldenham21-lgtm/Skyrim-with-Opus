// Close inspection shots of the mimic and seeker in daylight at 1280x720: stance, aim, side silhouette, death.
import { boot, frames, spawnRel, shot } from './enemies-core-lib.mjs';
export default async function (page, api) {
  await boot(api, { noEnemies: true, lighten: 1 });
  await api.run(`(() => { const r = window.__radius; r.teleport(30, 130); r.setLook(0.2, 0.06); r.setTime(11); })()`);
  await api.run(`window.__m = ${spawnRel('mimic', 3.6, 0.5, '{ idle: true }')}`);
  const step = (n, aiOff) => api.run(`(() => { const ctx = window.__radius.ctx; const m = window.__m; for (let i = 0; i < ${n}; i++) { ctx.elapsed += 0.05; ${aiOff ? 'm.animate(0.05, m.distanceToPlayer(), window.__pose || {});' : 'ctx.enemies.update(0.05);'} ctx.vfx.update(0.05, ctx.elapsed); } return m.state; })()`);
  await step(10);
  await frames(api, 2);
  await shot(api, 'look-mimic-idle');
  // aiming pose, frozen in place
  await api.run(`window.__pose = { aim: 1, aimPitch: 0.05, aimYaw: 0.1, headYaw: 0.1, speed: 0 }`);
  await step(30, true);
  await frames(api, 2);
  await shot(api, 'look-mimic-aim');
  // side silhouette, walking
  await api.run(`(() => { const m = window.__m; m.yaw += Math.PI / 2; window.__pose = { aim: 0, speed: 2.2 }; })()`);
  await step(12, true);
  await frames(api, 2);
  await shot(api, 'look-mimic-side-walk');
  // death fold and dissolve
  await api.run(`(() => { const m = window.__m; m.yaw -= Math.PI / 2; m.damage(200, { kind: 'bullet' }); })()`);
  await step(9);
  await frames(api, 2);
  await shot(api, 'look-mimic-fold');
  await step(14);
  await frames(api, 2);
  await shot(api, 'look-mimic-dissolve');
  await step(40);
  // seeker close, day
  await api.run(`window.__s = ${spawnRel('seeker', 7, 1.2)}`);
  await api.run(`(() => { window.__radius.setLook(0.2, 0.25); })()`);
  await step(6);
  await frames(api, 2);
  await shot(api, 'look-seeker-day');
  await api.run(`(() => { const s = window.__s; s.yaw += Math.PI / 2; })()`);
  await frames(api, 2);
  await shot(api, 'look-seeker-side');
}
