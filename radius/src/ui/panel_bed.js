// STUB — owned by the ui-b agent. Panel module: export default { id: 'bed', title, render(ctx, api, data) -> HTMLElement, onKey?(e), onClose?() }
// api: { close(), refresh(), notice(text, red), open(name, data), sound(name) } provided by ui/panels.js (router).
export default { id: 'bed', title: 'bed', render(ctx, api, data) { const d = document.createElement('div'); d.textContent = 'Panel bed is being built.'; return d; } };
