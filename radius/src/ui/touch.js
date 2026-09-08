// On-screen controls for touch devices: a floating move stick on the left, a look area on the
// right, and the action buttons the Committee issues you. Everything drives core/input.js through
// its virtual layer, so no other module knows whether a press came from a key or a thumb.
//
// Layout is landscape-first (the game is unplayable in portrait and says so). Buttons sit inside
// the safe area so a notch or a home indicator never covers one.

const DEAD = 0.14;          // stick deadzone, fraction of the radius
const STICK_R = 54;         // stick travel radius in CSS px, before --touch-scale
const TAP_MS = 260;         // a press shorter than this, with little movement, counts as a tap
const TAP_PX = 12;

// Buttons: [action, label, class]. Every one uses press/release semantics — `pressed()` fires on
// the press for taps (reload, jump, slots), `down()` stays true while held for fire/aim/interact/
// watch/sprint. One behaviour covers both, so nothing here needs to know which is which.
const PADS = [
  ['fire', 'FIRE', 'b-fire'],
  ['aim', 'AIM', 'b-aim'],
  ['reload', 'RE&shy;LOAD', 'b-reload'],
  ['interact', 'USE', 'b-use'],
  ['jump', 'JUMP', 'b-jump'],
  ['crouch', 'CROUCH', 'b-crouch'],
  ['sprint', 'RUN', 'b-sprint'],
  ['flashlight', 'TORCH', 'b-torch'],
  ['probe', 'PROBE', 'b-probe'],
  ['loadMag', 'LOAD', 'b-loadmag'],
];
// The top strip: screens and weapon selection, smaller and out of the way of the thumbs.
const TABS = [
  ['slot1', '1'], ['slot2', '2'], ['slot3', '3'], ['slot4', '4'], ['slot5', 'DET'], ['holster', 'STOW'],
];
const SCREENS = [
  ['watch', 'WATCH'], ['inventory', 'BAG'], ['map', 'MAP'], ['pause', 'MENU'],
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

  root.innerHTML = `
    <div class="t-move" data-zone="move"><div class="t-stick" hidden><div class="t-base"></div><div class="t-knob"></div></div></div>
    <div class="t-look" data-zone="look"></div>
    <div class="t-pads">${PADS.map(([a, l, c]) => `<button class="t-btn ${c}" data-a="${a}">${l}</button>`).join('')}</div>
    <div class="t-tabs">${TABS.map(([a, l]) => `<button class="t-tab" data-a="${a}">${l}</button>`).join('')}</div>
    <div class="t-screens">${SCREENS.map(([a, l]) => `<button class="t-tab" data-a="${a}">${l}</button>`).join('')}</div>`;

  const moveZone = root.querySelector('.t-move');
  const lookZone = root.querySelector('.t-look');
  const stick = root.querySelector('.t-stick');
  const knob = root.querySelector('.t-knob');

  const pointers = new Map();   // pointerId -> { kind, ... }
  const held = new Set();       // actions currently held by a finger

  const scale = () => S().touchScale || 1;

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
    else {
      // rescale past the deadzone so the first millimetre of travel is not a dead step
      const k = (m - DEAD) / (1 - DEAD) / m;
      ax *= k; az *= k;
    }
    ctx.input.setAxis(ax, az);
  }
  function stickUp() {
    stick.hidden = true;
    ctx.input.setAxis(0, 0);
  }

  // ---------------------------------------------------------------- looking
  function lookMove(p, e) {
    const k = 0.55 * (S().sensitivity || 1) * (S().touchLook || 1);
    ctx.input.injectLook((e.clientX - p.lx) * k, (e.clientY - p.ly) * k);
    p.lx = e.clientX; p.ly = e.clientY;
    if (Math.hypot(e.clientX - p.ox, e.clientY - p.oy) > TAP_PX) p.moved = true;
  }

  // ---------------------------------------------------------------- buttons
  function hold(action, on) {
    if (on) held.add(action); else held.delete(action);
    ctx.input.setVirtual(action, on);
  }
  for (const btn of root.querySelectorAll('[data-a]')) {
    const action = btn.dataset.a;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      pointers.set(e.pointerId, { kind: 'btn', action, btn });
      btn.classList.add('on');
      hold(action, true);
    });
    const release = (e) => {
      const p = pointers.get(e.pointerId);
      if (!p || p.kind !== 'btn') return;
      pointers.delete(e.pointerId);
      btn.classList.remove('on');
      hold(action, false);
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------- zone events
  function zoneDown(e) {
    if (e.target.closest('[data-a]')) return;      // a button already claimed it
    e.preventDefault();
    const zone = e.currentTarget.dataset.zone;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    if (zone === 'move') { stickDown(e); return; }
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
    // a quick tap in the look area that never travelled is a shot, the way a trigger-finger tap reads
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
    for (const a of held) ctx.input.setVirtual(a, false);
    held.clear();
    for (const b of root.querySelectorAll('.on')) b.classList.remove('on');
    pointers.clear();
    stickUp();
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
    rotate.innerHTML = '<div class="r-in"><span class="glyph">▭</span><h2>Turn your device</h2>'
      + '<p>The Radius is surveyed in landscape. Rotate the handset to continue.</p></div>';
    document.body.appendChild(rotate);
  }
  const onResize = () => {
    const portrait = innerHeight > innerWidth;
    document.body.classList.toggle('portrait', portrait);
  };
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
