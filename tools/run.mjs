// Point PLAYWRIGHT at your playwright install if it is not resolvable by name.
const PW = process.env.PLAYWRIGHT || 'playwright';
const pw = (await import(PW)).default ?? await import(PW);
const { chromium } = pw;
const url = process.argv[2] || 'http://localhost:8080/tools/shadertest.html';
const shot = process.argv[3] || '/tmp/shot.png';
const waitMs = Number(process.argv[4] || 25000);
const browser = await chromium.launch({
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox','--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:1 });
const logs=[];
page.on('console', m => logs.push('['+m.type()+'] '+m.text()));
page.on('pageerror', e => logs.push('[pageerror] '+e.message));
await page.goto(url, { waitUntil:'domcontentloaded' });
try {
  await page.waitForFunction('window.__done === true', { timeout: waitMs });
} catch(e){ logs.push('[timeout waiting for __done]'); }
const errors = await page.evaluate('window.__errors || []').catch(()=>[]);
await page.screenshot({ path: shot });
console.log(logs.join('\n'));
console.log('--- errors ---');
console.log((errors||[]).join('\n---\n'));
await browser.close();
