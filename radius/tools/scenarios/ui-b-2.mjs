// ui-b: the terminal. Contracts (accept, deliver, abandon with the penalty), artifact submission at full price,
// status, and a promotion stamped at the terminal when rankFor(...) exceeds the current clearance.
// node tools/smoke.mjs --out .smoke/ui-b-2 --scenario tools/scenarios/ui-b-2.mjs --w 960 --h 540
import { R, J, click, text, count, setup, open, close } from './ui-b-lib.mjs';
export default async function (page, api) {
  await setup(page, api, `${R}.give('art_pearl', 2); ${R}.give('art_crown', 1);`);
  await open(api, 'terminal');
  console.log('terminal open:', await J(api, `({ open: ${R}.ctx.panels.isOpen, greet: (document.querySelector('#panels .p-term .greet') || {}).textContent, posted: document.querySelectorAll('#panels .p-term .mission').length })`));
  await api.screenshot('terminal-contracts');
  // accept a retrieval or clearance contract (both can be made deliverable from the test side)
  const pick = await J(api, `(() => { const ms = ${R}.ctx.missions.available(); const m = ms.find((x) => x.type === 'RETRIEVAL') || ms.find((x) => x.type === 'CLEARANCE') || ms[0]; return { id: m.id, type: m.type, payment: m.payment }; })()`);
  console.log('pick:', pick);
  const m = JSON.parse(pick);
  console.log(await click(api, `accept:${m.id}`)); await api.frames(1);
  console.log('accepted:', await J(api, `({ active: ${R}.ctx.missions.active.map((x) => x.id + ':' + x.status), notice: (document.querySelector('#panels .notice') || {}).textContent, deliverBtn: !!document.querySelector('#panels [data-x="deliver:${m.id}"]'), abandonBtn: !!document.querySelector('#panels [data-x="abandon:${m.id}"]') })`));
  await api.screenshot('terminal-active');
  // make it deliverable, reopen, deliver
  await api.run(`(() => { const c = ${R}.ctx; const x = c.missions.active.find((a) => a.id === '${m.id}'); if (x.type === 'RETRIEVAL') { x.recovered = true; c.inventory.add(x.item, 1); } else if (x.type === 'CLEARANCE') x.kills = x.count; else if (x.points) x.points.forEach((p) => p.done = true); else if (x.artifact) c.inventory.add(x.artifact, 1); })()`);
  await close(api); await open(api, 'terminal');
  console.log('deliverable:', await J(api, `({ d: ${R}.ctx.missions.deliverable(${R}.ctx.missions.active[0]), deliverBtn: !!document.querySelector('#panels [data-x="deliver:${m.id}"]'), st: (document.querySelector('#panels .p-term .mission .st') || {}).textContent })`));
  await api.screenshot('terminal-deliverable');
  const before = await api.run(`${R}.ctx.state.data.money`);
  console.log(await click(api, `deliver:${m.id}`)); await api.frames(1);
  console.log('delivered:', await J(api, `({ gained: ${R}.ctx.state.data.money - ${before}, completed: ${R}.ctx.missions.completed.length, active: ${R}.ctx.missions.active.length, earned: ${R}.ctx.state.data.earned, notice: (document.querySelector('#panels .notice') || {}).textContent })`));
  // abandon: accept another, first click asks, second charges a tenth
  const id2 = await api.run(`${R}.ctx.missions.available()[0].id`);
  console.log(await click(api, `accept:${id2}`)); await api.frames(1);
  console.log(await click(api, `abandon:${id2}`)); await api.frames(1);
  console.log('abandon asks:', await J(api, `({ pen: (document.querySelector('#panels .p-term .pen') || {}).textContent, confirmBtn: (document.querySelector('#panels [data-x="abandon:${id2}"]') || {}).textContent, keep: !!document.querySelector('#panels [data-x="keep"]') })`));
  await api.screenshot('terminal-abandon');
  const before2 = await api.run(`${R}.ctx.state.data.money`);
  console.log(await click(api, `abandon:${id2}`)); await api.frames(1);
  console.log('abandoned:', await J(api, `({ charged: ${before2} - ${R}.ctx.state.data.money, active: ${R}.ctx.missions.active.map((x) => x.id), beacons: ${R}.ctx.inventory.count('beacon'), hasAbandonApi: typeof ${R}.ctx.missions.abandon, notice: (document.querySelector('#panels .notice') || {}).textContent })`));
  // artifacts at full price
  console.log(await click(api, 'tab:artifacts')); await api.frames(1);
  await api.screenshot('terminal-artifacts');
  const b3 = await api.run(`${R}.ctx.state.data.money`);
  console.log(await click(api, 'sell:art_crown')); await api.frames(1);
  console.log('sold crown:', await J(api, `({ gained: ${R}.ctx.state.data.money - ${b3}, crown: ${R}.ctx.inventory.count('art_crown'), notice: (document.querySelector('#panels .notice') || {}).textContent })`));
  console.log(await click(api, 'sellall:art_pearl')); await api.frames(1);
  console.log('sold pearls:', await J(api, `({ pearls: ${R}.ctx.inventory.count('art_pearl'), earned: ${R}.ctx.state.data.earned, rows: document.querySelectorAll('#panels .p-term .row.art').length })`));
  // status
  console.log(await click(api, 'tab:status')); await api.frames(1);
  await api.screenshot('terminal-status');
  console.log('status:', await J(api, `({ level: (document.querySelector('#panels .p-term .level') || {}).textContent, bars: document.querySelectorAll('#panels .p-term .bar').length })`));
  // keyboard tabs
  await api.key('ArrowLeft'); await api.frames(1);
  console.log('after ArrowLeft:', await text(api, '#panels .tab.on'));
  await close(api);
  // promotion: clearance 2 on file, earnings and contracts for 3 -> stamped at the terminal
  await api.run(`(() => { const c = ${R}.ctx; c.state.data.securityLevel = 2; c.state.data.earned = 20000; const md = c.state.data.missions; while (md.completed.length < 6) md.completed.push({ code: 'PSC-0000', type: 'TEST', place: 'TEST', payment: 0, day: 1, chain: null }); })()`);
  await open(api, 'terminal');
  console.log('promotion:', await J(api, `({ level: ${R}.ctx.state.data.securityLevel, stamp: (document.querySelector('#panels .p-term .rubber') || {}).textContent, greet: (document.querySelector('#panels .p-term .greet') || {}).textContent, slips: [...${R}.ctx.hud.elements.notify.children].map((s) => s.textContent).slice(-1) })`));
  await api.screenshot('terminal-promoted');
  await close(api);
  console.log('closed:', await J(api, `({ open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled })`));
}
