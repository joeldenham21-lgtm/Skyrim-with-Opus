// Builds a single self-contained HTML file: all modules + three.js + CSS inline.
//
// The game does not need this to run — `node serve.js` serves the source
// directly. This exists only to produce a one-file build for hosts that can
// serve a single document (and it is what the shared link is built from).
//
//   npm i -D esbuild && node tools/build/bundle.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');

// Resolve the bare "three" specifier to the vendored build.
const vendorPlugin = {
  name: 'vendor-three',
  setup(build) {
    build.onResolve({ filter: /^three$/ }, () => ({
      path: path.join(root, 'vendor/three/three.module.min.js'),
    }));
    build.onResolve({ filter: /^three\/addons\/csm\/CSM\.js$/ }, () => ({
      path: path.join(root, 'vendor/three/csm/CSM.js'),
    }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2021'],
  minify: true,
  legalComments: 'none',
  write: false,
  plugins: [vendorPlugin],
  logLevel: 'info',
});

const js = result.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, 'src/ui/styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Take the body markup from index.html, drop the stylesheet link, the import
// map and the module loader — everything is inlined here instead.
const body = html
  .slice(html.indexOf('<canvas id="viewport"'), html.indexOf('<script type="module">'))
  .replace(/<noscript>[\s\S]*?<\/noscript>/, '');

const out = `<style>
${css}
/* The single-file build lives inside a page that may already have a background. */
html, body { background: #05070a; }
</style>

${body}

<script>
(function () {
  var fatal = function (msg, stack) {
    // Once frames are on screen, log instead of replacing the world.
    if (window.__wyrmholdRunning) { console.error('[wyrmhold]', msg, stack || ''); return; }
    var el = document.getElementById('fatal');
    if (!el || !el.classList.contains('hidden')) return;
    document.getElementById('fatal-msg').textContent = msg || 'Unknown error';
    document.getElementById('fatal-stack').textContent = stack || '';
    el.classList.remove('hidden');
    var b = document.getElementById('boot'); if (b) b.classList.add('hidden');
  };
  document.getElementById('fatal-reload').onclick = function () { location.reload(); };
  window.addEventListener('error', function (e) { fatal(e.message, e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', function (e) {
    fatal(String(e.reason && e.reason.message || e.reason), e.reason && e.reason.stack);
  });
})();
</script>

<script type="module">
${js}
</script>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/wyrmhold.html'), out);
console.log('wrote dist/wyrmhold.html', (out.length / 1024 / 1024).toFixed(2), 'MB');
