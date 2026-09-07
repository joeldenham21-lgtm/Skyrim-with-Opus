// Build: bundles src/main.js (+ three) into one self-contained HTML file.
//   node build.mjs              -> dist/radius.html (single file, works from file://)
//   node build.mjs --out X.html -> custom output path (used by tools/smoke.mjs)
//   node build.mjs --serve      -> dev server on :8080 with rebuild on request
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : resolve(root, 'dist/radius.html');
const serve = args.includes('--serve');
const minify = !args.includes('--no-minify');
const artifact = args.includes('--artifact');   // page body only (no doctype/html/head/body) for hosted artifact pages

export async function bundle() {
  const t0 = performance.now();
  const result = await esbuild.build({
    entryPoints: [resolve(root, 'src/main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    minify,
    sourcemap: false,
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
  });
  const js = result.outputFiles[0].text;
  const css = readFileSync(resolve(root, 'src/ui/style.css'), 'utf8') + '\n' + readFileSync(resolve(root, 'src/ui/ui.css'), 'utf8');
  const shell = readFileSync(resolve(root, 'src/index.html'), 'utf8');
  const script = `<script>\n${js.replace(/<\/script>/g, '<\\/script>')}\n</script>`;
  const html = artifact
    ? `<title>RADIUS</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Oswald:wght@300;400;500&display=swap" rel="stylesheet">\n<style>\n${css}\n</style>\n<canvas id="gl"></canvas>\n<div id="ui"></div>\n${script}`
    : shell
      // NB: function replacers, never strings — a string replacement interprets $&, $`, $' and $1
      // as pattern references, and the minified bundle legitimately contains sequences like `$&&`.
      .replace('<!--STYLE-->', () => `<style>\n${css}\n</style>`)
      .replace('<!--SCRIPT-->', () => script);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`built ${outPath} (${(html.length / 1024).toFixed(0)} KB) in ${ms}ms`);
  return html;
}

if (serve) {
  http.createServer(async (req, res) => {
    try {
      const html = await bundle();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e.stack || e));
    }
  }).listen(8080, () => console.log('dev server: http://localhost:8080 (rebuilds on every request)'));
} else {
  bundle().catch((e) => { console.error(e.message || e); process.exit(1); });
}
