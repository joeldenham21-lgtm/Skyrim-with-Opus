// Headless playtest harness. Builds the game, opens it in Chromium (SwiftShader WebGL2),
// runs an optional scenario, screenshots, and reports console errors + FPS.
//
//   node tools/smoke.mjs                       # default: start game, wait 6s, screenshot
//   node tools/smoke.mjs --scenario my.mjs     # scenario module exporting async (page, api) => {}
//   node tools/smoke.mjs --out .smoke/run1     # output dir (default .smoke/<timestamp>)
//   node tools/smoke.mjs --seconds 10          # how long to run before final screenshot
//   node tools/smoke.mjs --w 1280 --h 720
//   node tools/smoke.mjs --full                # production render settings (default is a fast headless mode: no MSAA, 1024 shadows)
//   node tools/smoke.mjs --phone               # 844x390 handset viewport, touch events, on-screen controls forced on
//   node tools/smoke.mjs --audio               # leave the browser unmuted so audio output can be measured
//   node tools/smoke.mjs --budget 900          # wall-clock budget for the scenario (default 600s; 0 disables)
//
// Inside the page, window.__radius exposes the debug API (see ARCHITECTURE.md):
//   __radius.ctx, __radius.start(), __radius.teleport(x,z), __radius.look(yaw,pitch),
//   __radius.setTime(h), __radius.spawn(type,x,z), __radius.setTension(v), __radius.stats()
import { spawnSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Playwright is a dev tool, not a dependency of the game, so it may live anywhere: in this
// project, installed globally, or nowhere at all. Try the bare specifier first and fall back to
// the global npm root, so the harness runs on a laptop and in CI without editing this file.
// Set PLAYWRIGHT=/path/to/playwright/index.mjs to override.
async function loadChromium() {
  const tried = [];
  const candidates = [process.env.PLAYWRIGHT, 'playwright'].filter(Boolean);
  for (const c of candidates) {
    try { const m = await import(c); return m.chromium ?? m.default?.chromium; }
    catch (e) { tried.push(`${c}: ${e.message}`); }
  }
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (globalRoot) {
      const p = pathToFileURL(resolve(globalRoot, 'playwright/index.mjs')).href;
      const m = await import(p); return m.chromium ?? m.default?.chromium;
    }
  } catch (e) { tried.push(`npm root -g: ${e.message}`); }
  throw new Error('smoke.mjs could not load playwright.\n  ' + tried.join('\n  ')
    + '\nInstall it (npm i -D playwright) or set PLAYWRIGHT to its index.mjs.');
}
const chromium = await loadChromium();

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = resolve(root, opt('--out', `.smoke/${Date.now()}`));
const seconds = +opt('--seconds', 6);
const W = +opt('--w', 1280), H = +opt('--h', 720);
const scenarioPath = opt('--scenario', null);
const prebuilt = opt('--html', null);   // run an existing bundle instead of building
const budgetS = +opt('--budget', 600);   // wall-clock seconds a scenario may take before it is abandoned; 0 disables
const fast = !args.includes('--full');   // --full: production render settings (MSAA, full shadow map, device pixel ratio)
const phone = args.includes('--phone');  // --phone: handset viewport with touch events and the on-screen controls forced on
const audio = args.includes('--audio');  // --audio: do not mute the browser, so output can actually be measured
mkdirSync(outDir, { recursive: true });

const html = prebuilt ? resolve(prebuilt) : resolve(outDir, 'game.html');
if (!prebuilt) {
  const b = spawnSync('node', [resolve(root, 'build.mjs'), '--out', html, '--no-minify'], { encoding: 'utf8' });
  if (b.status !== 0) { console.error('BUILD FAILED\n' + b.stdout + b.stderr); process.exit(1); }
  console.log(b.stdout.trim());
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
         '--autoplay-policy=no-user-gesture-required', ...(audio ? [] : ['--mute-audio'])],
});
const page = phone
  // a handset held in landscape: touch events, mobile UA hints, and a 3x display
  ? await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  : await browser.newPage({ viewport: { width: W, height: H } });
if (fast) await page.addInitScript(() => { window.__radiusFast = true; });
if (phone) await page.addInitScript(() => { window.__radiusForceTouch = true; });
const errors = [], logs = [];
page.on('console', (m) => { const t = m.type(); const s = `[${t}] ${m.text()}`; logs.push(s); if (t === 'error' && !/Failed to load resource/.test(s)) errors.push(s); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)));

await page.goto(pathToFileURL(html).href, { timeout: 300000 });
await page.waitForFunction(() => window.__radius && window.__radius.ready, null, { timeout: 300000 }).catch(() => errors.push('[harness] __radius.ready never became true'));

let shot = 0;
const api = {
  page, outDir,
  async screenshot(name) { const p = resolve(outDir, `${String(shot++).padStart(2, '0')}-${name || 'shot'}.png`); await page.screenshot({ path: p, timeout: 180000 }); console.log('screenshot', p); return p; },
  async run(js) { return page.evaluate(js); },
  async wait(ms) { await page.waitForTimeout(ms); },
  // wait until N more frames have rendered (robust under slow software rendering)
  async frames(n = 5) { const f0 = await page.evaluate(() => window.__radius.ctx.frame); await page.waitForFunction((f) => window.__radius.ctx.frame >= f, f0 + n, { timeout: Math.max(240000, n * 40000) }); },
  async start() { await page.evaluate(() => window.__radius.start()); await api.frames(6); },
  async key(k, ms = 100) { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); },
  async mouse(dx, dy) { await page.evaluate(([dx, dy]) => window.__radius.look(dx, dy), [dx, dy]); },
};

// A scenario that hangs used to hang forever: the run sat holding a Chromium and blocking whoever launched
// it until their own timeout fired tens of minutes later, having produced nothing. Five such runs were once
// found alive for up to two and a half hours on an otherwise idle machine. The usual cause is one
// page.evaluate() doing an enormous amount of synchronous work — thousands of ticks of enemy update in a
// single call — which took seconds when it was written and takes hours once the AI grows heavier. Chunk long
// simulations across several api.run() calls; and if you do hang, fail in minutes instead of never.
let watchdog = null;
const budget = budgetS > 0
  ? new Promise((_, rej) => { watchdog = setTimeout(() => rej(new Error(
      `scenario exceeded its ${budgetS}s budget and was abandoned. This is almost always a single `
      + `page.evaluate() running too much synchronous work: split the simulation across several api.run() `
      + `calls, or raise the budget deliberately with --budget <seconds>.`)), budgetS * 1000); })
  : new Promise(() => {});

try {
  const work = (async () => {
    if (scenarioPath) {
      const mod = await import(pathToFileURL(resolve(scenarioPath)).href);
      await (mod.default || mod.run)(page, api);
    } else {
      await api.start();
      await api.wait(seconds * 1000);
      await api.screenshot('final');
    }
  })();
  await Promise.race([work, budget]);
} catch (e) { errors.push('[scenario] ' + (e.stack || e.message)); }
finally { if (watchdog) clearTimeout(watchdog); }

const stats = await page.evaluate(() => (window.__radius && window.__radius.stats) ? window.__radius.stats() : null).catch(() => null);
writeFileSync(resolve(outDir, 'console.log'), logs.join('\n'));
console.log('stats:', JSON.stringify(stats));
if (errors.length) { console.log(`ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n')); }
else console.log('no console errors');
await browser.close();
process.exit(errors.length ? 2 : 0);
