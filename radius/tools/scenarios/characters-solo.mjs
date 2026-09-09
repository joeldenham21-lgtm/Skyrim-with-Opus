// Standalone character viewer. NOT a smoke scenario — run it directly:
//
//   node tools/scenarios/characters-solo.mjs --out .smoke/solo [--shots row,close,aim,walk,crouch,range]
//
// It bundles ONLY enemies/charmesh.js + enemies/gearmesh.js into a bare page with a ground plane and the game's
// overcast key/fill, renders a few framings and screenshots them. The full game renders at well under a frame a
// second under SwiftShader; this is a second a frame, which is the difference between iterating on a model and
// waiting on it. Judge form and proportion here, then confirm against the real world with characters-lineup.
import * as esbuild from 'esbuild';
import { spawnSync, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = resolve(root, opt('--out', '.smoke/solo'));
const W = +opt('--w', 900), H = +opt('--h', 620);
const only = opt('--shots', '').split(',').filter(Boolean);

// ---------------------------------------------------------------- the page
const PAGE = /* js */`
import * as THREE from 'three';
import { buildHumanoid } from './src/enemies/charmesh.js';
import { buildGun } from './src/weapons/gunmesh.js';

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(${W}, ${H}, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8d949b);
const camera = new THREE.PerspectiveCamera(52, ${W} / ${H}, 0.05, 200);

// the zone's light: a weak cool sun through cloud, a big grey-blue dome, an olive bounce
const sun = new THREE.DirectionalLight(0xd8dcE0, 1.35);
sun.position.set(-6, 9, 5); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -4; sun.shadow.camera.right = 4; sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -1;
sun.shadow.bias = -0.0008;
scene.add(sun); scene.add(sun.target);
scene.add(new THREE.HemisphereLight(0x9fb0bd, 0x4b5540, 1.6));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x59604a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const LOADOUTS = {
  none: { weapon: { id: 'akm' }, vest: null, helmet: null, kit: [] },
  belt: { weapon: { id: 'sks' }, vest: null, helmet: null, kit: [{ id: 'rig_belt' }] },
  paca: { weapon: { id: 'aks74u' }, vest: { id: 'vest_paca' }, helmet: { id: 'helm_ssh68' }, kit: [{ id: 'pack_tortilla' }] },
  b23: { weapon: { id: 'ak74m' }, vest: { id: 'vest_6b23_1' }, helmet: { id: 'helm_6b7' }, kit: [{ id: 'rig_6sh112' }] },
  zhuk: { weapon: { id: 'ak12' }, vest: { id: 'vest_zhuk' }, helmet: { id: 'helm_6b47' }, kit: [{ id: 'rig_alpha' }] },
  iotv: { weapon: { id: 'm4' }, vest: { id: 'vest_iotv' }, helmet: { id: 'helm_ach' }, kit: [{ id: 'head_pnv57' }] },
  b43: { weapon: { id: 'pkm' }, vest: { id: 'vest_6b43' }, helmet: { id: 'helm_altyn' }, kit: [{ id: 'mask_gp5' }] },
  fort: { weapon: { id: 'svd' }, vest: { id: 'vest_fort' }, helmet: { id: 'helm_zsh' }, kit: [{ id: 'pack_6sh118' }] },
};

const actors = [];
function make(key, x, z, yaw, state) {
  const lo = LOADOUTS[key];
  const r = buildHumanoid({ loadout: lo, height: 1.85 });
  r.root.position.set(x, 0, z); r.root.rotation.y = yaw;
  let gun = null;
  try { gun = buildGun(lo.weapon.id, { lod: 'lo' }); } catch (e) { gun = null; }
  if (gun) gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  r.attach(gun);
  r.wear(lo.vest ? lo.vest.id : null, lo.helmet ? lo.helmet.id : null, null);
  r.setState(state || {});
  for (let i = 0; i < 40; i++) r.update(0.05);
  scene.add(r.root);
  actors.push(r);
  return r;
}

const API = {
  clear() { for (const a of actors) { scene.remove(a.root); a.dispose(); } actors.length = 0; },
  make, actors,
  info() { return actors.map((a) => ({ build: a.build.id, head: a.headKind, coat: a.coat, worn: a.worn.length,
    tris: a.rig.mesh.geometry.index.count / 3 })); },
  look(px, py, pz, tx, ty, tz) { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); },
  render() { renderer.render(scene, camera); },
  stats() { const i = renderer.info.render; return { calls: i.calls, tris: i.triangles }; },
};
window.__solo = API;
window.__ready = true;
`;

const HTML = (js) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;overflow:hidden}canvas{display:block;width:${W}px;height:${H}px}
</style></head><body><canvas id="gl" width="${W}" height="${H}"></canvas><script>${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;

async function loadChromium() {
  const tried = [];
  for (const c of [process.env.PLAYWRIGHT, 'playwright'].filter(Boolean)) {
    try { const m = await import(c); return m.chromium ?? m.default?.chromium; } catch (e) { tried.push(String(e.message)); }
  }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const m = await import(pathToFileURL(resolve(globalRoot, 'playwright/index.mjs')).href);
  return m.chromium ?? m.default?.chromium;
}

mkdirSync(outDir, { recursive: true });
const built = await esbuild.build({
  stdin: { contents: PAGE, resolveDir: root, loader: 'js' },
  bundle: true, format: 'iife', target: ['es2022'], write: false, logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const htmlPath = resolve(outDir, 'solo.html');
writeFileSync(htmlPath, HTML(built.outputFiles[0].text));
console.log('bundled', htmlPath);

const chromium = await loadChromium();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.stack || e.message)));
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => errors.push('page never became ready'));

let n = 0;
const want = (name) => !only.length || only.includes(name);
async function shoot(name, setup) {
  if (!want(name)) return;
  const t = Date.now();
  const info = await page.evaluate(setup);
  await page.evaluate(() => { window.__solo.render(); });
  const p = resolve(outDir, `${String(n++).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: p, timeout: 120000 });
  console.log(name, Date.now() - t, 'ms', JSON.stringify(info));
}

// ---- eight loadouts in a row, standing
await shoot('row', () => {
  const A = window.__solo; A.clear();
  const keys = ['none', 'belt', 'paca', 'b23', 'zhuk', 'iotv', 'b43', 'fort'];
  keys.forEach((k, i) => A.make(k, (i - 3.5) * 0.95, 0, Math.PI, { speed: 0 }));
  A.look(0, 1.55, 6.4, 0, 1.05, 0);
  return A.info();
});
// ---- one man close, three quarter
await shoot('close', () => {
  const A = window.__solo; A.clear();
  A.make('b23', 0, 0, Math.PI + 0.7, { speed: 0, headYaw: -0.35 });
  A.look(0.55, 1.62, 2.15, 0.0, 1.15, 0);
  return A.info();
});
// ---- the same man from behind
await shoot('back', () => {
  const A = window.__solo; A.clear();
  A.make('fort', 0, 0, 0.35, { speed: 0 });
  A.look(0.3, 1.6, 2.2, 0, 1.15, 0);
  return A.info();
});
// ---- shouldered
await shoot('aim', () => {
  const A = window.__solo; A.clear();
  A.make('zhuk', 0, 0, Math.PI + 0.55, { speed: 0, aiming: 1, aimPitch: 0.02, headYaw: 0.1 });
  A.look(0.9, 1.62, 2.0, 0, 1.3, 0);
  return A.info();
});
// ---- mid stride, side on, plus a crouched man behind
await shoot('walk', () => {
  const A = window.__solo; A.clear();
  const a = A.make('b23', -0.5, 0, Math.PI * 0.5, { speed: 2.6, headYaw: 0.4 });
  for (let i = 0; i < 9; i++) a.update(0.05);
  const b = A.make('paca', 0.9, -1.4, Math.PI * 0.5 + 0.3, { speed: 0, crouch: 1, aiming: 1 });
  for (let i = 0; i < 30; i++) b.update(0.05);
  A.look(0.2, 1.5, 3.9, -0.1, 0.95, -0.6);
  return A.info();
});
// ---- the body types, no gear, so the builds themselves can be compared
await shoot('builds', () => {
  const A = window.__solo; A.clear();
  for (let i = 0; i < 8; i++) A.make('none', (i - 3.5) * 0.9, 0, Math.PI, { speed: 0 });
  A.look(0, 1.5, 6.0, 0, 1.0, 0);
  return A.info();
});
// ---- range: the same man at 10, 30 and 60 m
await shoot('range', () => {
  const A = window.__solo; A.clear();
  A.make('b23', -1.4, -10, Math.PI + 0.4, { speed: 0 });
  A.make('b23', 1.2, -30, Math.PI + 0.4, { speed: 0 });
  A.make('belt', 4.6, -60, Math.PI + 0.4, { speed: 0 });
  A.look(0, 1.65, 0, 0.4, 1.35, -30);
  return A.info();
});

console.log('render stats', JSON.stringify(await page.evaluate(() => window.__solo.stats())));
if (errors.length) console.log('ERRORS\\n' + errors.slice(0, 10).join('\\n'));
else console.log('no errors');
await browser.close();
