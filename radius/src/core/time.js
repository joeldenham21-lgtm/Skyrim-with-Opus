// In-game clock. One day = 24 real minutes (60x). Tide at 05:00 on data.tideDay.
import { clamp01, smoothstep, TAU } from './math.js';

export const DAY_SECONDS = 24 * 60;         // real seconds per in-game day
export const TIME_SCALE = 86400 / DAY_SECONDS; // 60
export const TIDE_HOUR = 5;

export function createTime(state, events) {
  const time = {
    scale: TIME_SCALE, paused: false,
    get day() { return state.data.day; },
    get hour() { return state.data.hour; },
    get dayFrac() { return state.data.hour / 24; },
    // 0 = full day, 1 = full night, smooth through dawn/dusk
    get night() {
      const h = state.data.hour;
      const dawn = 1 - smoothstep(4.8, 6.3, h);
      const dusk = smoothstep(18.8, 20.6, h);
      return clamp01(Math.max(dawn, dusk));
    },
    get isNight() { return time.night > 0.6; },
    // Sun elevation in radians (negative at night); azimuth sweeps east->west
    sunAngle() { return ((state.data.hour - 6) / 24) * TAU; },
    // seconds (in-game) until the Tide
    tideIn() {
      const now = (state.data.day - 1) * 86400 + state.data.hour * 3600;
      const tide = (state.data.tideDay - 1) * 86400 + TIDE_HOUR * 3600;
      return tide - now;
    },
    tideInText() {
      const s = Math.max(0, time.tideIn());
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
      return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    },
    clockText() {
      const h = Math.floor(state.data.hour), m = Math.floor((state.data.hour - h) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },
    // advance by in-game seconds
    advance(seconds) {
      const before = time.tideIn();
      state.data.hour += seconds / 3600;
      while (state.data.hour >= 24) { state.data.hour -= 24; state.data.day += 1; events.emit('newday', state.data.day); }
      const after = time.tideIn();
      if (before > 0 && after <= 0) events.emit('tideNow');
      if (before > 3600 && after <= 3600) events.emit('tideWarning', 'hour');
      if (before > 600 && after <= 600) events.emit('tideWarning', 'minutes');
    },
    update(dt) { if (!time.paused) time.advance(dt * time.scale); },
    // sleep: jump to 07:00 next day (or today if before 7)
    sleepToMorning() {
      const h = state.data.hour;
      const target = h < 6.5 ? 7 - h : 24 - h + 7;
      time.advance(target * 3600);
    },
  };
  return time;
}
