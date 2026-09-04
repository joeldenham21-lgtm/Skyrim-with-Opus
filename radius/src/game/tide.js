// The Tide: warnings, white-out, death outside, reset inside.
import { clamp01, smoothstep } from '../core/math.js';

export function createTide(ctx) {
  let phase = 'idle', t = 0, sirenT = 0;
  const api = {
    get phase() { return phase; }, get progress() { return t; },
    // called by time when the countdown crosses thresholds
    warn(kind) {
      if (kind === 'hour') { ctx.hud.notify('Tide in one hour. Return to Vanno.', { code: 'UNPSC · ADVISORY' }); ctx.audio.play('tide_warn', { gain: 0.6 }); }
      if (kind === 'minutes') { ctx.hud.notify('TIDE IMMINENT. RETURN TO VANNO.', { code: 'UNPSC · PRIORITY', ms: 9000 }); ctx.audio.play('tide_warn', { gain: 0.9, rate: 1.2 }); }
    },
    arrive() {
      if (phase !== 'idle') return;
      phase = 'rising'; t = 0;
      ctx.audio.play('tide_chord', { gain: 1.0 });
      ctx.events.emit('tideRising');
    },
    // after the white-out: the zone rearranges itself
    reset() {
      const d = ctx.state.data;
      d.tideLevel = Math.min(3, d.tideLevel + 1); d.tideDay += 3; d.stats.tides++;
      ctx.events.emit('tide', d.tideLevel);   // every module re-rolls its content on this
      ctx.hud.notify(`The Tide has passed. Anomalous activity index ${d.tideLevel}.`, { code: 'UNPSC · ZONE STATUS', ms: 8000 });
      ctx.state.save();
    },
    update(dt) {
      const tideS = ctx.time.tideIn();
      // sky whitening in the last 10 minutes
      const pre = tideS > 0 ? clamp01(1 - tideS / 600) : 1;
      if (phase === 'idle') {
        ctx.sky.uniforms.uTide.value = pre * pre * 0.45;
        if (tideS < 3600 && !ctx.player.inBase) { sirenT -= dt; if (sirenT <= 0) { sirenT = tideS < 600 ? 6 : 18; ctx.audio.play('siren', { pos: ctx.world.map.BASE, gain: 0.7, max: 900, ref: 60, rolloff: 0.6 }); } }
        if (tideS <= 0) api.arrive();
      } else if (phase === 'rising') {
        t += dt / 6;
        const v = smoothstep(0, 1, t);
        ctx.post.setTide(v); ctx.sky.uniforms.uTide.value = 0.45 + v * 0.55; ctx.post.shake(v * 0.6);
        ctx.lighting.storm = v;
        if (t >= 1) {
          phase = 'white'; t = 0;
          if (ctx.player.inBase) { api.reset(); } else { ctx.player.die({ kind: 'tide' }); }
        }
      } else if (phase === 'white') {
        t += dt / 4;
        ctx.post.setTide(1 - smoothstep(0, 1, t)); ctx.sky.uniforms.uTide.value = 1 - smoothstep(0, 1, t);
        ctx.lighting.storm = 1 - t;
        if (t >= 1) { phase = 'idle'; ctx.post.setTide(0); ctx.lighting.storm = 0; ctx.sky.uniforms.uTide.value = 0; }
      }
    },
  };
  ctx.events.on('tideWarning', api.warn);
  ctx.events.on('tideNow', api.arrive);
  return api;
}
