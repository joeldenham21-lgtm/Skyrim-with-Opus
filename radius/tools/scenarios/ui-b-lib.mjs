// Shared helpers for the ui-b (base panel module) scenarios. The panels are mounted by ui/panels.js; when that router
// does not yet load the modules, the scratch harness's mini router (window.__uibInstall) is used instead.
export const R = 'window.__radius';
export const J = (api, expr) => api.run(`(() => { try { return JSON.stringify(${expr}); } catch (e) { return 'THREW ' + (e.stack || e); } })()`);
export const click = (api, x) => api.run(`(() => { const b = document.querySelector('#panels [data-x="${x}"]'); if (!b) return 'no button ${x}'; if (b.disabled) return 'disabled ${x}'; b.click(); return 'clicked ${x}'; })()`);
export const text = (api, sel) => api.run(`(() => { const e = document.querySelector('${sel}'); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
export const count = (api, sel) => api.run(`document.querySelectorAll('${sel}').length`);
export async function setup(page, api, patch = '') {
  await api.run(`${R}.ctx.debug.noEnemies = true`);
  await api.start();
  await api.run(`(() => { const c = ${R}.ctx; c.state.data.money = 40000; c.state.data.securityLevel = 3; c.state.data.earned = 20000; ${patch} })()`);
  await api.frames(1);
  // does the live router mount the modules? if not, install the harness router
  await api.run(`${R}.ctx.panels.open('supply')`); await api.frames(1);
  const mounted = await count(api, '#panels .p-supply');
  await api.run(`${R}.ctx.panels.close()`); await api.frames(1);
  if (!mounted) {
    const has = await api.run('typeof window.__uibInstall');
    if (has === 'function') { await api.run('window.__uibInstall()'); console.log('router: harness mini router installed'); }
    else console.log('router: modules NOT mounted by ui/panels.js and no harness router available');
  } else console.log('router: ui/panels.js mounts the modules');
}
export async function open(api, name, data = '{}') { await api.run(`${R}.ctx.panels.open('${name}', ${data})`); await api.frames(1); }
export async function close(api) { await api.run(`${R}.ctx.panels.close()`); await api.frames(1); }
