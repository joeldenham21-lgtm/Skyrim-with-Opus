// Keyboard/mouse with pointer lock. Actions are named so the rest of the game never sees key codes.
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'], jump: ['Space'],
  fire: ['Mouse0'], aim: ['Mouse2'], reload: ['KeyR'], loadMag: ['KeyT'], flashlight: ['KeyF'], probe: ['KeyG'],
  interact: ['KeyE'], watch: ['Tab'], inventory: ['KeyI'], pause: ['Escape'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'], holster: ['KeyH'],
  map: ['KeyM'], lean: ['KeyQ'],
  fireMode: ['KeyB'], weaponLight: ['KeyL'], melee: ['KeyV'], grenade: ['KeyX'], binoculars: ['KeyN'],
  quick1: ['Digit6'], quick2: ['Digit7'], quick3: ['Digit8'], quick4: ['Digit9'],
};

export function createInput(canvas, events) {
  const down = new Set();          // codes currently held
  const pressedThisFrame = new Set();
  const releasedThisFrame = new Set();
  const codeToActions = new Map();
  for (const [action, codes] of Object.entries(BINDINGS)) for (const c of codes) {
    if (!codeToActions.has(c)) codeToActions.set(c, []);
    codeToActions.get(c).push(action);
  }
  const input = {
    dx: 0, dy: 0, wheel: 0, locked: false, enabled: true, sensitivity: 1.0,
    softLook: false,   // pointer lock unavailable (embedded/sandboxed page): use raw mouse motion over the canvas instead
    down(action) { if (!input.enabled) return false; for (const c of BINDINGS[action]) if (down.has(c)) return true; return false; },
    pressed(action) { if (!input.enabled) return false; for (const c of BINDINGS[action]) if (pressedThisFrame.has(c)) return true; return false; },
    released(action) { for (const c of BINDINGS[action]) if (releasedThisFrame.has(c)) return true; return false; },
    // raw pressed regardless of enabled (menus use it)
    rawPressed(action) { for (const c of BINDINGS[action]) if (pressedThisFrame.has(c)) return true; return false; },
    endFrame() { pressedThisFrame.clear(); releasedThisFrame.clear(); input.dx = 0; input.dy = 0; input.wheel = 0; },
    lock() {
      if (input.locked) return;
      if (!canvas.requestPointerLock) { input.softLook = true; return; }
      try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(() => { input.softLook = true; }); } catch { input.softLook = true; } }); } catch { try { canvas.requestPointerLock(); } catch { input.softLook = true; } }
    },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
    releaseAll() { down.clear(); },
    // Test hook: synthetic look delta in pixels
    injectLook(dx, dy) { input.dx += dx; input.dy += dy; },
    bindings: BINDINGS,
  };
  const press = (code) => { if (!down.has(code)) pressedThisFrame.add(code); down.add(code); };
  const release = (code) => { down.delete(code); releasedThisFrame.add(code); };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (codeToActions.has(e.code)) { e.preventDefault(); }
    press(e.code);
    events.emit('keydown', e.code);
  });
  window.addEventListener('keyup', (e) => { release(e.code); });
  window.addEventListener('blur', () => { down.clear(); });
  canvas.addEventListener('mousedown', (e) => { press('Mouse' + e.button); if (!input.locked) events.emit('canvasClick'); });
  window.addEventListener('mouseup', (e) => release('Mouse' + e.button));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (!input.locked && !(input.softLook && input.enabled)) return;
    input.dx += e.movementX; input.dy += e.movementY;
  });
  window.addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    events.emit('pointerlock', input.locked);
  });
  document.addEventListener('pointerlockerror', () => { input.softLook = true; events.emit('pointerlock', false); });
  return input;
}
