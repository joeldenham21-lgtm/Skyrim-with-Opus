// Persistent game state. Everything that survives a reload lives in state.data and is plain JSON.
const KEY = 'radius.save.v1';

export function defaultData() {
  return {
    version: 1,
    explorer: 61,
    hp: 100, stamina: 100, bleeding: false,
    money: 600, earned: 0, securityLevel: 1,
    day: 1, hour: 7.0, tideLevel: 1, tideDay: 4,   // Tide arrives at 05:00 on tideDay
    flashlight: { on: false, battery: 100 },
    inventory: null,       // filled by inventory.js
    storage: null,         // base stash
    missions: { active: [], completed: [], chainStep: 0 },
    stats: { kills: 0, shots: 0, artifacts: 0, deaths: 0, tides: 0, distance: 0 },
    flags: {},             // arbitrary story/tutorial flags
    settings: { sensitivity: 1.0, fov: 75, volume: 0.8, music: 0.8, quality: 'high', grain: 1.0, motion: 1.0, targetFps: 100, resolutionScale: 1.0, dynamicResolution: true },
    seed: 1987,
  };
}

export function createState() {
  const state = {
    data: defaultData(),
    loaded: false,
    hasSave() { try { return !!localStorage.getItem(KEY); } catch { return false; } },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(state.data)); return true; } catch (e) { console.warn('save failed', e); return false; }
    },
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return false;
        const d = JSON.parse(raw);
        if (d.version !== 1) return false;
        state.data = Object.assign(defaultData(), d);
        state.data.settings = Object.assign(defaultData().settings, d.settings || {});
        state.loaded = true;
        return true;
      } catch (e) { console.warn('load failed', e); return false; }
    },
    // persist settings without touching a saved game
    saveSettings() {
      try { const raw = localStorage.getItem(KEY); const d = raw ? JSON.parse(raw) : null; if (d && d.version === 1) { d.settings = state.data.settings; localStorage.setItem(KEY, JSON.stringify(d)); } else { localStorage.setItem(KEY + '.settings', JSON.stringify(state.data.settings)); } } catch {}
    },
    loadSettingsOnly() {
      try { const raw = localStorage.getItem(KEY + '.settings'); if (raw) Object.assign(state.data.settings, JSON.parse(raw)); } catch {}
      try { const raw = localStorage.getItem(KEY); if (!raw) return; const d = JSON.parse(raw); if (d.settings) Object.assign(state.data.settings, d.settings); } catch {}
    },
    reset() { const s = state.data.settings; state.data = defaultData(); state.data.settings = s; state.loaded = false; },
    clear() { try { localStorage.removeItem(KEY); } catch {} },
  };
  return state;
}
