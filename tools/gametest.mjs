// Point PLAYWRIGHT at your playwright install if it is not resolvable by name.
const PW = process.env.PLAYWRIGHT || 'playwright';
const pw = (await import(PW)).default ?? await import(PW);
const { chromium } = pw;
const shot = process.argv[2] || '/tmp/game.png';
const script = process.argv[3] || '';
const browser = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport:{width:1000,height:600}, deviceScaleFactor:1 });
const logs=[];
page.on('console', m => { const t=m.text(); if(!t.includes('GPU stall')) logs.push('['+m.type()+'] '+t); });
page.on('pageerror', e => logs.push('[pageerror] '+e.message+'\n'+(e.stack||'')));
await page.goto('http://localhost:8080/?lowspec=1', { waitUntil:'domcontentloaded' });
// wait for boot to finish
try {
  await page.waitForFunction("window.WYRMHOLD && window.WYRMHOLD.ui", { timeout: 420000 });
} catch(e){ logs.push('[timeout] boot never completed'); }
const fatal = await page.evaluate(`(()=>{const f=document.getElementById('fatal');return f && !f.classList.contains('hidden') ? (document.getElementById('fatal-msg').textContent+'\\n'+document.getElementById('fatal-stack').textContent) : null;})()`).catch(e=>'eval failed '+e.message);
if (fatal) { console.log('FATAL:\n'+fatal); console.log(logs.join('\n')); await page.screenshot({path:shot}); await browser.close(); process.exit(1); }
if (script) await page.evaluate(script).catch(e=>logs.push('[script] '+e.message));
await page.waitForTimeout(Number(process.env.WAIT||9000));
const diag = await page.evaluate(`(()=>{const e=window.WYRMHOLD;return {
  frame:e.frame, actors:e.game.actors.length, chunks:e.world.terrain.stats.chunks,
  inst:e.world.scatter.stats.instances, draws:e.pipeline.stats.drawCalls,
  tris:e.pipeline.stats.triangles, hp:Math.round(e.game.stats.health),
  pos:[e.player.pos.x.toFixed(1),e.player.pos.y.toFixed(1),e.player.pos.z.toFixed(1)].join(','),
  hour:e.world.env.hour.toFixed(2), weather:e.world.env.weather,
  glErr:e.renderer.getContext().getError()};})()`).catch(e=>({err:e.message}));
await page.screenshot({ path: shot });
console.log(logs.join('\n'));
console.log('--- diag ---');
console.log(JSON.stringify(diag,null,1));
await browser.close();
