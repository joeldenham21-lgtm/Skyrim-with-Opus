// Visual tour: screenshots at several places and times. node tools/smoke.mjs --scenario tools/scenarios/tour.mjs
export default async function (page, api) {
  await api.start();
  await api.frames(8);
  await api.screenshot('start-gate-north');
  const shots = [
    ['zarya', -130, 60, 0.8, 12],
    ['object12', 150, -60, -2.2, 12],
    ['church', 50, -230, 0.3, 12],
    ['marsh', -40, 140, 2.4, 12],
    ['rail', -60, -150, 1.4, 12],
    ['dusk-road', 30, 130, 0.2, 19.6],
    ['night-torch', 30, 130, 0.2, 22.5],
  ];
  for (const [name, x, z, yaw, hour] of shots) {
    await api.run(`(() => { const r = window.__radius; r.teleport(${x}, ${z}); r.setLook(${yaw}, -0.05); r.setTime(${hour}); ${name.includes('torch') ? 'r.ctx.state.data.flashlight.on = true;' : ''} })()`);
    await api.frames(8);
    await api.screenshot(name);
  }
}
