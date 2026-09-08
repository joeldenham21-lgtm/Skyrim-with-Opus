// On-screen controls for touch devices.
//
// The governing constraint: held in landscape, the LEFT thumb owns the movement stick and the RIGHT
// thumb owns looking. Both are busy during normal play, so anything placed under either thumb steals
// from movement or from aiming. The first version put FIRE under the right thumb, which made looking
// and shooting at the same time impossible.
//
// So firing is never on the looking thumb. It has three independent paths, any of which works while
// the right thumb keeps dragging to look:
//   * a trigger under the LEFT thumb, beside the stick
//   * a shoulder trigger at each top corner, for the index fingers of a two-handed grip
//   * a tap inside the look area itself, for a quick snap shot
// Aim sits on the opposite shoulder from fire, so ADS and firing are always two different fingers.
//
// Sprint has no button: pushing the stick past 92% is a run, which removes a control and makes
// sprinting while moving free. Everything rare lives in a tray behind one button.
//
// Controls are icons, not words: a word needs legible type and a language, a glyph needs 20px.
import { svg } from './icons.js';

const DEAD = 0.14;          // stick deadzone, fraction of the radius
const RUN_AT = 0.92;        // stick deflection past this is a sprint
const STICK_R = 46;         // stick travel radius in CSS px, before --touch-scale
const TAP_MS = 220;         // a press shorter than this, that barely moved, is a tap
const TAP_PX = 10;

// [action, icon, class]. Every pad uses press/release semantics, which covers both kinds of action:
// pressed() fires on the transition for taps (reload, jump, slots) and down() persists for holds
// (fire, aim, interact, watch).
const PADS = [
  ['fire', 'fire', 'p-fire'],            // left thumb, beside the stick
  ['fire', 'fire', 'p-trig-r'],          // right shoulder, right index
  ['aim', 'aim', 'p-trig-l'],            // left shoulder, left index
  ['reload', 'reload', 'p-reload'],
  ['interact', 'use', 'p-use'],
  ['quick1', 'meds', 'p-meds'],
  ['crouch', 'crouch', 'p-crouch'],
  ['jump', 'jump', 'p-jump'],
];
// Behind the tray button: everything you reach for deliberately, not in a firefight.
const TRAY = [
  ['slot1', null, '1'], ['slot2', null, '2'], ['slot3', null, '3'], ['slot4', null, '4'],
  ['slot5', 'det', null], ['holster', 'stow', null], ['flashlight', 'torch', null], ['probe', 'probe', null],
  ['loadMag', 'mag', null], ['watch', 'watch', null], ['inventory', 'bag', null], ['map', 'map', null],
  ['pause', 'menu', null],
];

/** True when this looks like a device whose primary input is a finger. */
export function detectTouch() {
  try {
    if (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches) return true;
    return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  } catch { return false; }
}

export function createTouch(ctx) {
  const S = () => ctx.state.data.settings;
  const root = document.createElement('div');
  root.id = 'touch';
  root.hidden = true;
  (document.getElementById('ui') || document.body).appendChild(root);

  const pad = ([a, icon, cls]) => `<button class="t-pad ${cls}" data-a="${a}">${svg(icon)}</button>`;
  const trayItem = ([a, icon, text]) =>
    `<button class="t-tray-btn" data-a="${a}">${icon ? svg(icon) : `<span class="n">${text}</span>`}</button>`;

  root.innerHTML = `
    <div class="t-look" data-zone="look"></div>
    <div class="t-move" data-zone="move"><div class="t-stick" hidden><div class="t-base"></div><div class="t-knob"></div></div></div>
    ${PADS.map(pad).join('')}
    <button class="t-pad p-more" data-tray="1">${svg('more')}</button>
    <div class="t-tray" hidden>${TRAY.map(trayItem).join('')}</div>`;

  const moveZone = root.querySelector('.t-move');
  const lookZone = root.querySelector('.t-look');
  const stick = root.querySelector('.t-stick');
  const knob = root.querySelector('.t-knob');
  const tray = root.querySelector('.t-tray');
  const moreBtn = root.querySelector('[data-tray]');

  const pointers = new Map();   // pointerId -> { kind, ... }
  const held = new Set();       // actions currently held by a finger
  let running = false;          // sprint, driven by stick deflection rather than a button

  const scale = () => S().touchScale || 1;

  function hold(action, on) {
    if (on) held.add(action); else held.delete(action);
    ctx.input.setVirtual(action, on);
  }

  // ---------------------------------------------------------------- the stick
  function stickDown(e) {
    const r = scale() * STICK_R;
    pointers.set(e.pointerId, { kind: 'move', ox: e.clientX, oy: e.clientY, r });
    stick.hidden = false;
    stick.style.left = `${e.clientX}px`;
    stick.style.top = `${e.clientY}px`;
    knob.style.transform = 'translate(-50%,-50%)';
  }
  function stickMove(p, e) {
    let dx = e.clientX - p.ox, dy = e.clientY - p.oy;
    const d = Math.hypot(dx, dy);
    if (d > p.r) { dx = dx / d * p.r; dy = dy / d * p.r; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    let ax = dx / p.r, az = dy / p.r;
    const m = Math.hypot(ax, az);
    if (m < DEAD) { ax = 0; az = 0; }
    else { const k = (m - DEAD) / (1 - DEAD) / m; ax *= k; az *= k; }   // rescale past the deadzone
    ctx.input.setAxis(ax, az);
    // push the stick to its rim to run: no sprint button, and sprinting while moving costs nothing
    const wantRun = m >= RUN_AT && az < 0;
    if (wantRun !== running) { running = wantRun; hold('sprint', wantRun); }
    stick.classList.toggle('run', running);
  }
  function stickUp() {
    stick.hidden = true;
    stick.classList.remove('run');
    ctx.input.setAxis(0, 0);
    if (running) { running = false; hold('sprint', false); }
  }

  // ---------------------------------------------------------------- looking
  function lookMove(p, e) {
    const k = 0.55 * (S().sensitivity || 1) * (S().touchLook || 1);
    ctx.input.injectLook((e.clientX - p.lx) * k, (e.clientY - p.ly) * k);
    p.lx = e.clientX; p.ly = e.clientY;
    if (Math.hypot(e.clientX - p.ox, e.clientY - p.oy) > TAP_PX) p.moved = true;
  }

  // ---------------------------------------------------------------- buttons
  for (const btn of root.querySelectorAll('[data-a]')) {
    const action = btn.dataset.a;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      pointers.set(e.pointerId, { kind: 'btn', action, btn });
      btn.classList.add('on');
      hold(action, true);
      if (btn.closest('.t-tray')) setTray(false);   // a tray choice closes the tray
    });
    const release = (e) => {
      const p = pointers.get(e.pointerId);
      if (!p || p.kind !== 'btn' || p.btn !== btn) return;
      pointers.delete(e.pointerId);
      btn.classList.remove('on');
      // another pad may hold the same action (fire has three); only release when none still do
      const stillHeld = [...pointers.values()].some((q) => q.kind === 'btn' && q.action === action);
      if (!stillHeld) hold(action, false);
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  function setTray(open) {
    tray.hidden = !open;
    moreBtn.classList.toggle('on', open);
  }
  moreBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    setTray(tray.hidden);
  });
  moreBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // ------------------------------------------------------------- zone events
  function zoneDown(e) {
    if (e.target.closest('[data-a],[data-tray]')) return;      // a control already claimed it
    e.preventDefault();
    const zone = e.currentTarget.dataset.zone;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    if (zone === 'move') { stickDown(e); return; }
    if (!tray.hidden) setTray(false);                          // looking dismisses the tray
    pointers.set(e.pointerId, { kind: 'look', ox: e.clientX, oy: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), moved: false });
  }
  function zoneMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'move') stickMove(p, e);
    else if (p.kind === 'look') lookMove(p, e);
  }
  function zoneUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (p.kind === 'move') stickUp();
    // a quick tap in the look area that never travelled is a snap shot
    else if (p.kind === 'look' && !p.moved && performance.now() - p.t < TAP_MS && S().touchTapFire !== false) {
      ctx.input.tapVirtual('fire');
    }
  }
  for (const z of [moveZone, lookZone]) {
    z.addEventListener('pointerdown', zoneDown);
    z.addEventListener('pointermove', zoneMove);
    z.addEventListener('pointerup', zoneUp);
    z.addEventListener('pointercancel', zoneUp);
    z.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Drop every finger: called when the controls hide, so nothing sticks down behind a panel. */
  function releaseAll() {
    for (const a of [...held]) ctx.input.setVirtual(a, false);
    held.clear();
    for (const b of root.querySelectorAll('.on')) b.classList.remove('on');
    pointers.clear();
    running = false;
    stickUp();
    setTray(false);
  }

  let shown = false;
  const api = {
    el: root,
    get active() { return api.enabled; },
    enabled: false,
    /** Turn the whole layer on or off (settings, or a non-touch device). */
    setEnabled(on) {
      api.enabled = !!on;
      ctx.input.touch = !!on;
      if (!on) { releaseAll(); root.hidden = true; shown = false; }
    },
    update() {
      if (!api.enabled) return;
      root.style.setProperty('--touch-scale', String(scale()));
      // visible only while actually playing: panels and menus are DOM and take real taps
      const want = ctx.mode === 'playing' && !(ctx.panels && ctx.panels.isOpen);
      if (want !== shown) {
        shown = want;
        root.hidden = !want;
        if (!want) releaseAll();
      }
    },
    releaseAll,
  };
  return api;
}

/**
 * Phone housekeeping that has nothing to do with the game loop: a viewport that fills the notch,
 * a portrait warning, fullscreen and orientation lock on the first gesture, and a wake lock so the
 * screen does not sleep mid-contract. Everything here is best-effort — iOS Safari refuses several
 * of these on iPhone — so every call is guarded and a refusal is never fatal.
 */
export function installMobileChrome(ctx) {
  // The artifact build supplies its own <head>, so set the viewport from script rather than markup.
  try {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.appendChild(vp); }
    vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  } catch {}

  // Portrait warning. Landscape-only is a design decision, not a limitation to hide.
  let rotate = document.getElementById('rotate');
  if (!rotate) {
    rotate = document.createElement('div');
    rotate.id = 'rotate';
    rotate.innerHTML = '<div class="r-in"><span class="glyph">&#9645;</span><h2>Turn your device</h2>'
      + '<p>The Radius is surveyed in landscape. Rotate the handset to continue.</p></div>';
    document.body.appendChild(rotate);
  }
  const onResize = () => document.body.classList.toggle('portrait', innerHeight > innerWidth);
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => setTimeout(onResize, 120));
  onResize();

  // Fullscreen + orientation lock + wake lock, all on a real gesture and all optional.
  let wakeLock = null;
  async function claimScreen() {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
    try { await screen.orientation?.lock?.('landscape'); } catch {}
    try { wakeLock = await navigator.wakeLock?.request?.('screen'); } catch {}
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock === null) {
      try { wakeLock = await navigator.wakeLock?.request?.('screen'); } catch {}
    }
  });
  ctx.events.on('gameStart', () => { claimScreen(); });
  return { claimScreen, onResize };
}
