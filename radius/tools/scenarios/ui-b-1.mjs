// ui-b: the supply crate. Every category, rank locks, buying an AK-74M / a vest / ammunition, the weight warning,
// the return tab (weapon with attachments, magazine, stack), keyboard category switching.
// node tools/smoke.mjs --out .smoke/ui-b-1 --scenario tools/scenarios/ui-b-1.mjs --w 960 --h 540
import { R, J, click, text, count, setup, open, close } from './ui-b-lib.mjs';
export default async function (page, api) {
  await setup(page, api);
  await open(api, 'supply');
  console.log('supply open:', await J(api, `({ open: ${R}.ctx.panels.isOpen, cur: ${R}.ctx.panels.current, enabled: ${R}.ctx.input.enabled, cats: document.querySelectorAll('#panels .p-supply .cat').length, rows: document.querySelectorAll('#panels .p-supply .row.shop').length })`));
  const cats = ['weapons', 'ammo', 'mags', 'attachments', 'armor', 'helmets', 'packs', 'head', 'med', 'food', 'tools', 'grenades', 'parts'];
  for (const c of cats) {
    console.log(await click(api, `cat:${c}`)); await api.frames(1);
    const info = await J(api, `(() => { const rows = [...document.querySelectorAll('#panels .p-supply .row.shop')]; return { cat: '${c}', rows: rows.length, locked: rows.filter((r) => r.classList.contains('dim')).length, first: rows[0] && rows[0].textContent.replace(/\\s+/g, ' ').trim().slice(0, 90) }; })()`);
    console.log(info);
    await api.screenshot(`supply-${c}`);
  }
  // rank lock: the AK-12 (rank 4) is greyed with no buy button; the AK-74M (rank 2) is offered
  await click(api, 'cat:weapons'); await api.frames(1);
  console.log('lock check:', await J(api, `({ ak12: !!document.querySelector('#panels [data-x="buy:ak12"]'), ak74m: !!document.querySelector('#panels [data-x="buy:ak74m"]'), lockText: [...document.querySelectorAll('#panels .p-supply .lock')].slice(0, 2).map((e) => e.textContent) })`));
  // buy: AK-74M, a Kirasa vest, 5.45 ammunition
  console.log(await click(api, 'buy:ak74m')); await api.frames(1);
  console.log('after ak74m:', await J(api, `({ weapons: ${R}.ctx.inventory.weapons.map((w) => w.id + ':' + (w.mag ? w.mag.rounds : 0)), money: ${R}.ctx.state.data.money, notice: (document.querySelector('#panels .notice') || {}).textContent })`));
  await api.screenshot('supply-bought-ak');
  await click(api, 'cat:armor'); await api.frames(1);
  console.log(await click(api, 'buy:vest_kirasa')); await api.frames(1);
  console.log('after vest:', await J(api, `({ gear: ${R}.ctx.inventory.gear.map((g) => g.id), vest: ${R}.ctx.inventory.equipment.vest, money: ${R}.ctx.state.data.money })`));
  await click(api, 'cat:ammo'); await api.frames(1);
  console.log(await click(api, 'buy:545_fmj')); console.log(await click(api, 'buy:545_fmj')); await api.frames(1);
  console.log('after ammo:', await J(api, `({ n545: ${R}.ctx.inventory.count('545_fmj'), money: ${R}.ctx.state.data.money, notice: (document.querySelector('#panels .notice') || {}).textContent })`));
  // deny: not enough money
  await api.run(`${R}.ctx.state.data.money = 10`); await click(api, 'cat:weapons'); await api.frames(1);
  console.log(await click(api, 'buy:pm')); await api.frames(1);
  console.log('deny:', await J(api, `({ money: ${R}.ctx.state.data.money, notice: (document.querySelector('#panels .notice') || {}).textContent, red: !!document.querySelector('#panels .notice.red') })`));
  await api.run(`${R}.ctx.state.data.money = 40000`);
  // weight warning: a PKM plus a 6B43 pushes past capacity
  await api.run(`${R}.ctx.state.data.securityLevel = 5`); await click(api, 'cat:weapons'); await api.frames(1);
  console.log(await click(api, 'buy:pkm')); await api.frames(1);
  console.log('weight:', await J(api, `({ w: +${R}.ctx.inventory.weight().toFixed(1), cap: ${R}.ctx.inventory.capacity(), notice: (document.querySelector('#panels .notice') || {}).textContent, strip: document.querySelector('#panels .p-supply .strip').textContent.replace(/\\s+/g, ' ') })`));
  await api.screenshot('supply-overweight');
  await api.run(`${R}.ctx.state.data.securityLevel = 3`);
  // keyboard: ArrowRight moves to the next category
  await api.key('ArrowRight'); await api.frames(1);
  console.log('after ArrowRight:', await text(api, '#panels .p-supply .cat.on'));
  // return tab: the PKM (with its belt), a magazine and a stack
  console.log(await click(api, 'tab:sell')); await api.frames(1);
  await api.screenshot('supply-return');
  const pkm = await api.run(`${R}.ctx.inventory.weapons.find((w) => w.id === 'pkm').uid`);
  const magUid = await api.run(`${R}.ctx.inventory.mags[0].uid`);
  const before = await api.run(`${R}.ctx.state.data.money`);
  console.log(await click(api, `sell:w:${pkm}`)); await api.frames(1);
  console.log('sold pkm:', await J(api, `({ weapons: ${R}.ctx.inventory.weapons.map((w) => w.id), money: ${R}.ctx.state.data.money, gained: ${R}.ctx.state.data.money - ${before}, loose754: ${R}.ctx.inventory.count('754_fmj'), notice: (document.querySelector('#panels .notice') || {}).textContent })`));
  await click(api, 'cat:mags'); await api.frames(1);
  console.log(await click(api, `sell:m:${magUid}`)); await api.frames(1);
  console.log('sold mag:', await J(api, `({ mags: ${R}.ctx.inventory.mags.length, loose918: ${R}.ctx.inventory.count('9x18_fmj'), money: ${R}.ctx.state.data.money })`));
  await click(api, 'cat:ammo'); await api.frames(1);
  console.log(await click(api, 'sell:i:545_fmj')); await api.frames(1);
  console.log('sold ammo:', await J(api, `({ n545: ${R}.ctx.inventory.count('545_fmj'), money: ${R}.ctx.state.data.money })`));
  await api.screenshot('supply-return-after');
  await close(api);
  console.log('closed:', await J(api, `({ open: ${R}.ctx.panels.isOpen, enabled: ${R}.ctx.input.enabled, mode: ${R}.ctx.mode })`));
}
