// Headless playtest harness. Builds the game, opens it in Chromium (SwiftShader WebGL2),
// runs an optional scenario, screenshots, and reports console errors + FPS.
//
//   node tools/smoke.mjs                       # default: start game, wait 6s, screenshot
//   node tools/smoke.mjs --scenario my.mjs     # scenario module exporting async (page, api) => {}
//   node tools/smoke.mjs --out .smoke/run1     # output dir (default .smoke/<timestamp>)
//   node tools/smoke.mjs --seconds 10          # how long to run before final screenshot
//   node tools/smoke.mjs --w 1280 --h 720
//   node tools/smoke.mjs --full                # production render settings (default is a fast headless mode: no MSAA, 1024 shadows)
//
// Inside the page, window.__radius exposes the debug API (see ARCHITECTURE.md):
//   __radius.ctx, __radius.start(), __radius.teleport(x,z), __radius.look(yaw,pitch),
//   __radius.setTime(h), __radius.spawn(type,x,z), __radius.setTension(v), __radius.stats()
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = resolve(root, opt('--out', `.smoke/${Date.now()}`));
const seconds = +opt('--seconds', 6);
const W = +opt('--w', 1280), H = +opt('--h', 720);
const scenarioPath = opt('--scenario', null);
const fast = !args.includes('--full');   // --full: production render settings (MSAA, full shadow map, device pixel ratio)
mkdirSync(outDir, { recursive: true });

const html = resolve(outDir, 'game.html');
const b = spawnSync('node', [resolve(root, 'build.mjs'), '--out', html, '--no-minify'], { encoding: 'utf8' });
if (b.status !== 0) { console.error('BUILD FAILED\n' + b.stdout + b.stderr); process.exit(1); }
console.log(b.stdout.trim());

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
         '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
if (fast) await page.addInitScript(() => { window.__radiusFast = true; });
const errors = [], logs = [];
page.on('console', (m) => { const t = m.type(); const s = `[${t}] ${m.text()}`; logs.push(s); if (t === 'error' && !/Failed to load resource/.test(s)) errors.push(s); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)));

await page.goto(pathToFileURL(html).href);
await page.waitForFunction(() => window.__radius && window.__radius.ready, null, { timeout: 30000 }).catch(() => errors.push('[harness] __radius.ready never became true'));

let shot = 0;
const api = {
  page, outDir,
  async screenshot(name) { const p = resolve(outDir, `${String(shot++).padStart(2, '0')}-${name || 'shot'}.png`); await page.screenshot({ path: p, timeout: 180000 }); console.log('screenshot', p); return p; },
  async run(js) { return page.evaluate(js); },
  async wait(ms) { await page.waitForTimeout(ms); },
  // wait until N more frames have rendered (robust under slow software rendering)
  async frames(n = 5) { const f0 = await page.evaluate(() => window.__radius.ctx.frame); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: Math.max(60000, n * 8000) }); },
  async start() { await page.evaluate(() => window.__radius.start()); await api.frames(6); },
  async key(k, ms = 100) { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); },
  async mouse(dx, dy) { await page.evaluate(([dx, dy]) => window.__radius.look(dx, dy), [dx, dy]); },
};

try {
  if (scenarioPath) {
    const mod = await import(pathToFileURL(resolve(scenarioPath)).href);
    await (mod.default || mod.run)(page, api);
  } else {
    await api.start();
    await api.wait(seconds * 1000);
    await api.screenshot('final');
  }
} catch (e) { errors.push('[scenario] ' + (e.stack || e.message)); }

const stats = await page.evaluate(() => (window.__radius && window.__radius.stats) ? window.__radius.stats() : null).catch(() => null);
writeFileSync(resolve(outDir, 'console.log'), logs.join('\n'));
console.log('stats:', JSON.stringify(stats));
if (errors.length) { console.log(`ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n')); }
else console.log('no console errors');
await browser.close();
process.exit(errors.length ? 2 : 0);
