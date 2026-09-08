// Stroked 24x24 glyphs for the touch controls. Words on a control are a translation problem and a
// size problem at once — "RELOAD" needs six characters of legible type, a circular arrow needs 20px.
// Everything here draws in currentColor so a pressed control tints its icon with it.
export const ICON = {
  // a trigger: the dot you put on the target, with the reticle ticks around it
  fire: '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/><path d="M12 2.4v3.4M12 18.2v3.4M2.4 12h3.4M18.2 12h3.4"/>',
  // ADS: the full reticle, hollow, because you are looking through it rather than pulling it
  aim: '<circle cx="12" cy="12" r="6.8"/><path d="M12 1.6v4.2M12 18.2v4.2M1.6 12h4.2M18.2 12h4.2"/>',
  reload: '<path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"/><path d="M20.4 3v5h-5"/>',
  // an open hand for interact
  use: '<path d="M9.1 11.4V5.3a1.45 1.45 0 0 1 2.9 0v5.3m0-1.3V4.3a1.45 1.45 0 0 1 2.9 0v6.1m0-.9a1.45 1.45 0 0 1 2.9 0v2.2"/><path d="M6.2 12.6V9.7a1.45 1.45 0 0 1 2.9 0v4.1"/><path d="M6.2 12.6c0 4.8 1.7 8.2 5.8 8.2s5.9-2.7 5.9-7.2"/>',
  crouch: '<path d="M6.6 7.4 12 12.8l5.4-5.4"/><path d="M6.6 13.6 12 19l5.4-5.4"/>',
  jump: '<path d="M6.6 16.6 12 11.2l5.4 5.4"/><path d="M6.6 10.4 12 5l5.4 5.4"/>',
  meds: '<rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.2"/><path d="M12 9v6M9 12h6"/>',
  torch: '<path d="M9.2 3.4h5.6l-.7 3.2H9.9l-.7-3.2Z"/><path d="M9.9 6.6h4.2l.6 3.3v9.9a.8.8 0 0 1-.8.8h-3.8a.8.8 0 0 1-.8-.8V9.9l.6-3.3Z"/><path d="M11.4 13.2h1.2"/>',
  probe: '<path d="M3.2 19c3.8-9.2 9.8-13 17.2-13.8"/><circle cx="18.4" cy="7" r="2.2" fill="currentColor" stroke="none"/><path d="M3 19.2h3.2"/>',
  mag: '<rect x="8.6" y="9.8" width="6.8" height="10.6" rx="1"/><path d="M12 2.6v5.4"/><path d="M9.8 5.8 12 8l2.2-2.2"/>',
  det: '<path d="M12 20.6V10"/><circle cx="12" cy="7.8" r="1.9"/><path d="M7.4 20.6h9.2"/><path d="M6.9 6.4a7.3 7.3 0 0 1 10.2 0M9.2 8.7a4 4 0 0 1 5.6 0"/>',
  stow: '<path d="M12 3.4v9.4"/><path d="M8.6 9.4 12 12.8l3.4-3.4"/><path d="M4.6 15.2v3.4a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-3.4"/>',
  watch: '<circle cx="12" cy="12" r="5.4"/><path d="M12 9.4V12l1.7 1.3"/><path d="M9.5 6.8 9.9 3.2h4.2l.4 3.6M9.5 17.2l.4 3.6h4.2l.4-3.6"/>',
  bag: '<path d="M5.6 8.6h12.8l1 11H4.6l1-11Z"/><path d="M9 8.6V6.2a3 3 0 0 1 6 0v2.4"/>',
  map: '<path d="M3.6 6.6 9 4.4v13.4l-5.4 2.2V6.6Z"/><path d="M9 4.4 15 6.6V20L9 17.8"/><path d="M15 6.6l5.4-2.2v13.4L15 20"/>',
  menu: '<path d="M4.4 7.4h15.2M4.4 12h15.2M4.4 16.6h15.2"/>',
  more: '<circle cx="5.6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/>',
};

/** Inline SVG for an icon name, sized by CSS (width/height 100%). */
export function svg(name) {
  const d = ICON[name];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
