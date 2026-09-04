// The Director: tension state machine that shapes ebb and flow. It never spawns by itself (population.js does)
// but it decides the mood: CALM -> UNEASE -> HUNT -> COMBAT -> AFTERMATH -> CALM, with guaranteed rest.
import * as THREE from 'three';
import { clamp01, damp } from '../core/math.js';

export const STATES = ['CALM', 'UNEASE', 'HUNT', 'COMBAT', 'AFTERMATH'];

export function createDirector(ctx) {
  const shots = [];     // { pos, t } recent player gunshots (for hearing)
  let state = 'CALM', stateT = 0, tension = 0, calmGuard = 0, lastCombat = -1e9, lastShot = -1e9, unease = 0, uneaseTimer = 120 + Math.random() * 120;
  let threatNear = 0, engaged = 0, scheduledUnease = 0;
  const api = {
    get state() { return state; }, get stateT() { return stateT; }, get tension() { return tension; },
    get threatNear() { return threatNear; }, get engaged() { return engaged; }, get lastCombat() { return lastCombat; },
    // strength of recent gunfire heard at a position (0..1), decays over 6 s
    recentShotAt(pos, range = 120) {
      let s = 0; const t = ctx.elapsed;
      for (const sh of shots) { const age = t - sh.t; if (age > 6) continue; const d = sh.pos.distanceTo(pos); if (d > range) continue; s += (1 - d / range) * (1 - age / 6); }
      return clamp01(s);
    },
    setState(s) {
      if (s === state) return;
      const prev = state; state = s; stateT = 0;
      if (s === 'CALM') calmGuard = 90;
      ctx.events.emit('directorState', s, prev);
    },
    // kinds: 'shot' {pos}, 'spotted' {enemy}, 'lost' {enemy}, 'kill' {enemy}, 'damaged' {amount}, 'unease' (external scare), 'anomaly' (near)
    notify(kind, data = {}) {
      const t = ctx.elapsed;
      switch (kind) {
        case 'shot': shots.push({ pos: data.pos.clone(), t }); if (shots.length > 24) shots.shift(); lastShot = t; if (state !== 'COMBAT' && engaged > 0) api.setState('COMBAT'); break;
        case 'spotted': if (state === 'CALM' || state === 'UNEASE' || state === 'AFTERMATH') api.setState('HUNT'); break;
        case 'damaged': lastCombat = t; if (data.source && state !== 'COMBAT') api.setState('COMBAT'); break;
        case 'kill': lastCombat = t; if (state !== 'COMBAT') api.setState('COMBAT'); break;
        case 'unease': unease = Math.max(unease, data.amount ?? 0.6); if (state === 'CALM') api.setState('UNEASE'); break;
        case 'lost': break;
      }
      ctx.events.emit('directorNotify', kind, data);
    },
    // Force a period of calm (after sleeping, entering base)
    rest() { api.setState('CALM'); tension = 0; unease = 0; calmGuard = 120; },
    update(dt) {
      stateT += dt; calmGuard = Math.max(0, calmGuard - dt);
      const t = ctx.elapsed;
      const p = ctx.player.position;
      // survey entities
      engaged = 0; let nearest = Infinity, awareSum = 0;
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        const d = e.position.distanceTo(p);
        if (e.aware >= 1) engaged++;
        if (e.aware > 0.3 && d < 70) awareSum += e.aware;
        if (d < nearest) nearest = d;
      }
      threatNear = clamp01((60 - nearest) / 60);
      unease = Math.max(0, unease - dt * 0.03);
      // scheduled unease: the zone breathes even when nothing is there
      uneaseTimer -= dt;
      if (uneaseTimer <= 0 && state === 'CALM' && !ctx.player.inBase && calmGuard <= 0) { uneaseTimer = 150 + Math.random() * 200; unease = 0.5 + Math.random() * 0.3; api.setState('UNEASE'); ctx.events.emit('directorEvent', 'unease'); }
      const night = ctx.time.night;
      // transitions
      switch (state) {
        case 'CALM':
          if (engaged > 0) api.setState('HUNT');
          else if (calmGuard <= 0 && (awareSum > 0.4 || (threatNear > 0.55 && night > 0.5) || unease > 0.4)) api.setState('UNEASE');
          break;
        case 'UNEASE':
          if (engaged > 0) api.setState('HUNT');
          else if (awareSum < 0.1 && unease < 0.2 && threatNear < 0.4 && stateT > 25) api.setState('CALM');
          break;
        case 'HUNT':
          if (t - lastShot < 4 || t - lastCombat < 4) api.setState('COMBAT');
          else if (engaged === 0 && stateT > 12) api.setState('AFTERMATH');
          break;
        case 'COMBAT':
          if (engaged === 0 && t - lastShot > 8 && t - lastCombat > 8) api.setState('AFTERMATH');
          break;
        case 'AFTERMATH':
          if (engaged > 0) api.setState('HUNT');
          else if (stateT > 20) api.setState('CALM');
          break;
      }
      if (ctx.player.inBase && state !== 'CALM' && state !== 'AFTERMATH') api.setState('AFTERMATH');
      const target = { CALM: 0.05 + night * 0.12, UNEASE: 0.35 + unease * 0.2, HUNT: 0.62, COMBAT: 1.0, AFTERMATH: 0.3 }[state] + threatNear * 0.15;
      tension = damp(tension, clamp01(target), state === 'COMBAT' ? 4 : 0.6, dt);
    },
  };
  return api;
}
