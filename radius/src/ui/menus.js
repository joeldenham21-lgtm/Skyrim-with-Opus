// STUB (functional) — owned by the ui agent. Title / pause / death / settings screens.
export function createMenus(ctx) {
  const ui = document.getElementById('ui');
  const panel = document.createElement('div'); panel.className = 'panel'; panel.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:420px;display:none';
  ui.appendChild(panel);
  let current = null;
  const btn = (label, fn, disabled = false) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = label; b.disabled = disabled; b.onclick = fn; return b; };
  const api = {
    get current() { return current; },
    show(name, data) {
      current = name; panel.style.display = ''; panel.innerHTML = '';
      if (name === 'title') {
        panel.innerHTML = '<h1>Radius</h1><h2>Pechorsk Restricted Zone · UNPSC contract 61</h2>';
        panel.appendChild(btn('Begin contract', () => ctx.game.start(true)));
        panel.appendChild(btn('Continue', () => ctx.game.start(false), !ctx.state.hasSave()));
      } else if (name === 'pause') {
        panel.innerHTML = '<h2>Paused</h2>';
        panel.appendChild(btn('Resume', () => ctx.game.resume()));
        panel.appendChild(btn('Abandon to title', () => ctx.game.toTitle()));
      } else if (name === 'death') {
        panel.innerHTML = '<h2>UNPSC · Incident report</h2><p>EXPLORER 61 — STATUS: MISSING. Body not recovered. Contract void.</p>';
        panel.appendChild(btn('Return to Vanno', () => ctx.game.respawn()));
      }
    },
    hide() { current = null; panel.style.display = 'none'; },
    update(dt) {},
  };
  return api;
}
