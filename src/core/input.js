/**
 * WYRMHOLD — unified input.
 *
 * Keyboard + mouse (pointer lock), gamepad, and touch all funnel into one
 * action state so gameplay code never asks "which device is this?".
 */

import { clamp, damp } from './math.js';
import { settings } from './settings.js';

const ACTIONS = [
  'forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch', 'walk',
  'attack', 'block', 'power', 'cast', 'use', 'sheathe', 'swapSpell',
  'inventory', 'map', 'journal', 'stats', 'camera', 'wait', 'photo', 'menu',
  'quick1', 'quick2', 'quick3', 'quick4',
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = true;
    /** Raw physical keys currently held (KeyW, Mouse0, ...). */
    this.rawDown = new Set();
    this.rawPressedThisFrame = new Set();
    this.rawReleasedThisFrame = new Set();

    this.down = Object.create(null);
    this.justPressed = Object.create(null);
    this.justReleased = Object.create(null);
    for (const a of ACTIONS) { this.down[a] = false; this.justPressed[a] = false; this.justReleased[a] = false; }

    this.move = { x: 0, y: 0 };          // -1..1, y = forward
    this.lookDelta = { x: 0, y: 0 };     // consumed per frame
    this._lookAccum = { x: 0, y: 0 };
    this._lookSmooth = { x: 0, y: 0 };
    this.wheel = 0;
    this.pointerLocked = false;
    /** Set when pointer lock is unavailable — mouse-look then needs a held button. */
    this.dragLook = false;
    this._dragging = false;
    this._dragX = 0; this._dragY = 0;
    this.lastInputDevice = 'keyboard';
    this.anyInputAt = 0;

    // touch-driven virtual state (written by ui/touch.js)
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, buttons: Object.create(null), active: false };

    // gamepad
    this.gamepadIndex = -1;
    this.gpAxes = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
    this._gpPrev = [];

    /** When true (menus/dialogue open), gameplay actions are suppressed. */
    this.uiCapture = false;
    /** Callbacks fired for keys even while uiCapture is on. */
    this._keyHooks = new Set();

    this._bindDom();
  }

  onKeyHook(fn) { this._keyHooks.add(fn); return () => this._keyHooks.delete(fn); }

  // -------------------------------------------------------------------------
  _bindDom() {
    const c = this.canvas;

    addEventListener('keydown', e => {
      if (e.repeat) { return; }
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      this.lastInputDevice = 'keyboard';
      this.anyInputAt = performance.now();
      for (const fn of this._keyHooks) if (fn(e.code, e) === true) { e.preventDefault(); return; }
      this.rawDown.add(e.code);
      this.rawPressedThisFrame.add(e.code);
      // Stop the browser eating gameplay keys.
      if (['Space', 'Tab', 'F1', 'F5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', "Quote"].includes(e.code)) e.preventDefault();
    }, { passive: false });

    addEventListener('keyup', e => {
      this.rawDown.delete(e.code);
      this.rawReleasedThisFrame.add(e.code);
    });

    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });

    c.addEventListener('mousedown', e => {
      this.lastInputDevice = 'mouse'; this.anyInputAt = performance.now();
      const code = 'Mouse' + e.button;
      this.rawDown.add(code); this.rawPressedThisFrame.add(code);
      this._dragging = true; this._dragX = e.clientX; this._dragY = e.clientY;
      // Keyboard events only reach an embedded page once it has focus.
      try { c.focus({ preventScroll: true }); } catch (err) { }
      if (!this.uiCapture && settings.effectivePlatform === 'desktop') this.requestPointerLock();
    });
    addEventListener('mouseup', e => {
      const code = 'Mouse' + e.button;
      this.rawDown.delete(code); this.rawReleasedThisFrame.add(code);
      this._dragging = false;
    });
    c.addEventListener('contextmenu', e => e.preventDefault());

    addEventListener('mousemove', e => {
      if (this.uiCapture) return;
      if (this.pointerLocked) {
        this._lookAccum.x += e.movementX || 0;
        this._lookAccum.y += e.movementY || 0;
        this.lastInputDevice = 'mouse';
      } else if (this.dragLook && this._dragging) {
        // Pointer lock is unavailable (embedded page, or the browser refused
        // it). Fall back to hold-and-drag to look so the game stays playable.
        this._lookAccum.x += e.clientX - this._dragX;
        this._lookAccum.y += e.clientY - this._dragY;
        this._dragX = e.clientX; this._dragY = e.clientY;
        this.lastInputDevice = 'mouse';
      }
    });

    addEventListener('wheel', e => {
      if (this.uiCapture) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) { this.rawDown.delete('Mouse0'); this.rawDown.delete('Mouse2'); }
      this.onPointerLockChange?.(this.pointerLocked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
      this._lockRefused = true;
      this.dragLook = true;
      this.onPointerLockChange?.(false);
    });

    addEventListener('gamepadconnected', e => {
      this.gamepadIndex = e.gamepad.index;
      this.lastInputDevice = 'gamepad';
      this.onDeviceChange?.('gamepad');
    });
    addEventListener('gamepaddisconnected', e => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = -1;
    });
  }

  requestPointerLock() {
    if (this.pointerLocked || this._lockRefused || settings.effectivePlatform !== 'desktop') return;
    if (!this.canvas.requestPointerLock) { this.dragLook = true; return; }
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { this.canvas.requestPointerLock(); }
        catch (e) { this._lockRefused = true; this.dragLook = true; }
      });
    } catch (e) { this._lockRefused = true; this.dragLook = true; }
    // If the lock has not arrived shortly, assume it was denied (embedded page).
    clearTimeout(this._lockProbe);
    this._lockProbe = setTimeout(() => {
      if (!this.pointerLocked) this.dragLook = true;
    }, 700);
  }
  exitPointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  releaseAll() {
    for (const k of this.rawDown) this.rawReleasedThisFrame.add(k);
    this.rawDown.clear();
    this.touch.move.x = this.touch.move.y = 0;
    for (const k in this.touch.buttons) this.touch.buttons[k] = false;
  }

  // -------------------------------------------------------------------------
  _pollGamepad(dt) {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = this.gamepadIndex >= 0 ? pads[this.gamepadIndex] : null;
    if (!pad) { for (const p of pads) if (p && p.connected) { pad = p; this.gamepadIndex = p.index; break; } }
    if (!pad) { this.gpConnected = false; return; }
    this.gpConnected = true;

    const dz = settings.get('gamepadDeadzone');
    const ax = (v) => Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
    this.gpAxes.lx = ax(pad.axes[0] || 0); this.gpAxes.ly = ax(pad.axes[1] || 0);
    this.gpAxes.rx = ax(pad.axes[2] || 0); this.gpAxes.ry = ax(pad.axes[3] || 0);

    const btn = i => pad.buttons[i] ? (pad.buttons[i].pressed || pad.buttons[i].value > 0.5) : false;
    // Standard mapping → actions.
    const map = {
      jump: 0, use: 2, sheathe: 3, block: 6, attack: 7,
      sprint: 10, crouch: 1, cast: 5, power: 4, menu: 9, inventory: 8,
      map: 12, journal: 13, camera: 11, swapSpell: 14,
    };
    for (const [act, i] of Object.entries(map)) {
      const now = btn(i), prev = this._gpPrev[i] || false;
      if (now !== prev) {
        const code = 'Pad' + i;
        if (now) { this.rawDown.add(code); this.rawPressedThisFrame.add(code); }
        else { this.rawDown.delete(code); this.rawReleasedThisFrame.add(code); }
        this.lastInputDevice = 'gamepad'; this.anyInputAt = performance.now();
      }
      this._gpPrev[i] = now;
      if (now) this._padActions.add(act); else this._padActions.delete(act);
    }
    if (Math.hypot(this.gpAxes.lx, this.gpAxes.ly, this.gpAxes.rx, this.gpAxes.ry) > 0.12) {
      this.lastInputDevice = 'gamepad'; this.anyInputAt = performance.now();
    }
  }
  _padActions = new Set();

  // -------------------------------------------------------------------------
  /** Called once per frame before gameplay reads state. */
  update(dt) {
    this._padActions.clear?.();
    this._pollGamepad(dt);

    const binds = settings.binds;
    const capture = this.uiCapture;

    for (const a of ACTIONS) {
      const code = binds[a];
      const held = !capture && (
        this.rawDown.has(code) ||
        !!this.touch.buttons[a] ||
        this._padActions.has(a)
      );
      const wasDown = this.down[a];
      this.justPressed[a] = held && !wasDown;
      this.justReleased[a] = !held && wasDown;
      this.down[a] = held;
    }
    // Menu keys must work even while UI has capture (so Esc closes panels).
    for (const a of ['menu', 'inventory', 'map', 'journal', 'stats']) {
      const code = binds[a];
      if (capture) {
        const held = this.rawDown.has(code);
        this.justPressed[a] = held && !this._captureHeld?.[a];
        (this._captureHeld ||= {})[a] = held;
      } else if (this._captureHeld) this._captureHeld[a] = this.rawDown.has(code);
    }

    // --- movement axes -----------------------------------------------------
    let mx = 0, my = 0;
    if (!capture) {
      if (this.down.right) mx += 1;
      if (this.down.left) mx -= 1;
      if (this.down.forward) my += 1;
      if (this.down.back) my -= 1;
      if (mx || my) { const l = Math.hypot(mx, my); mx /= l; my /= l; }
      if (this.touch.active && (this.touch.move.x || this.touch.move.y)) { mx = this.touch.move.x; my = this.touch.move.y; }
      if (Math.hypot(this.gpAxes.lx, this.gpAxes.ly) > 0.02) { mx = this.gpAxes.lx; my = -this.gpAxes.ly; }
    }
    this.move.x = mx; this.move.y = my;
    this.moveMag = Math.min(1, Math.hypot(mx, my));

    // --- look --------------------------------------------------------------
    const sens = settings.get('sensitivity') * 0.0022;
    let lx = this._lookAccum.x * sens;
    let ly = this._lookAccum.y * sens * (settings.get('invertY') ? -1 : 1);
    this._lookAccum.x = 0; this._lookAccum.y = 0;

    if (this.touch.look.x || this.touch.look.y) {
      lx += this.touch.look.x * sens * 1.35;
      ly += this.touch.look.y * sens * 1.35 * (settings.get('invertY') ? -1 : 1);
      this.touch.look.x = 0; this.touch.look.y = 0;
    }
    if (Math.hypot(this.gpAxes.rx, this.gpAxes.ry) > 0.02) {
      const gs = settings.get('sensitivity') * 2.6 * dt;
      lx += this.gpAxes.rx * gs;
      ly += this.gpAxes.ry * gs * (settings.get('invertY') ? -1 : 1);
    }
    if (capture) { lx = 0; ly = 0; }

    const sm = settings.get('smoothing');
    if (sm > 0.001) {
      const lambda = 60 * (1 - sm) + 8;
      this._lookSmooth.x = damp(this._lookSmooth.x, lx / Math.max(dt, 1e-4), lambda, dt);
      this._lookSmooth.y = damp(this._lookSmooth.y, ly / Math.max(dt, 1e-4), lambda, dt);
      this.lookDelta.x = this._lookSmooth.x * dt;
      this.lookDelta.y = this._lookSmooth.y * dt;
    } else {
      this.lookDelta.x = lx; this.lookDelta.y = ly;
    }

    if (mx || my || Math.abs(lx) > 1e-4) this.anyInputAt = performance.now();
  }

  /** Clear edge flags — call at the very end of the frame. */
  endFrame() {
    this.rawPressedThisFrame.clear();
    this.rawReleasedThisFrame.clear();
    this.wheel = 0;
  }

  isDown(a) { return this.down[a]; }
  wasPressed(a) { return this.justPressed[a]; }
  wasReleased(a) { return this.justReleased[a]; }
  /**
   * True if the player wants the slow walk gait.
   * With "Always Run" on, the walk key is a modifier; with it off, running
   * requires holding the walk key instead (classic toggle semantics).
   */
  wantsWalk() {
    return settings.get('autoRun') ? this.down.walk : !this.down.walk;
  }
}

export { ACTIONS };
