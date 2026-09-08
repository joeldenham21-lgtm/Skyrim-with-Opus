// WebAudio engine: buses, synthesized reverb, positional voices, and synthesis primitives.
// Sounds are registered by name (see audio/sfx.js) and played with audio.play(name, opts).
// opts: { pos: Vector3 | null (2D), gain, rate, hrtf, ref, max, rolloff, detune, ... passed to the generator }
import * as THREE from 'three';

export function createAudio(ctxGame) {
  let ac = null;
  const gens = new Map(), loops = new Map();
  const missing = new Set();
  const live = new Set();        // active loop handles
  const listenerPos = new THREE.Vector3(), listenerFwd = new THREE.Vector3(), listenerUp = new THREE.Vector3(0, 1, 0);
  let master, comp, sfxBus, musicBus, ambBus, reverb, reverbSend, lowpass;
  const buffers = {};
  let muted = false;

  function ensure() {
    if (ac) return ac;
    try { ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { console.warn('no audio', e); return null; }
    master = ac.createGain(); master.gain.value = ctxGame.state.data.settings.volume ?? 0.8;
    comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
    lowpass = ac.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 20000; lowpass.Q.value = 0.3;
    master.connect(lowpass); lowpass.connect(comp); comp.connect(ac.destination);
    sfxBus = ac.createGain(); musicBus = ac.createGain(); ambBus = ac.createGain();
    musicBus.gain.value = ctxGame.state.data.settings.music ?? 0.8;
    sfxBus.connect(master); musicBus.connect(master); ambBus.connect(master);
    // synthesized reverb: exponentially decaying noise, darker over time (open field, distant walls)
    reverb = ac.createConvolver(); reverb.buffer = makeIR(ac, 2.2, 0.9, 1.3); reverb.normalize = true;
    reverbSend = ac.createGain(); reverbSend.gain.value = 0.28; reverbSend.connect(reverb); reverb.connect(master);
    ac.listener.positionX && (ac.listener.positionX.value = 0);
    return ac;
  }
  function makeIR(ac, seconds, decay, tone) {
    const rate = ac.sampleRate, len = Math.floor(rate * seconds);
    const buf = ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay * 2.2) * (i < 200 ? i / 200 : 1);
        const w = (Math.random() * 2 - 1);
        // Darkening lowpass. The coefficient must stay inside (0, 1]: at tone 1.3 the raw
        // expression turns negative at t≈0.9, which puts the one-pole's pole outside the unit
        // circle and makes the tail grow exponentially — it overflowed to ±Infinity 2.13s into a
        // 2.2s buffer, and a convolver fed Infinity poisons every bus downstream of it.
        const k = Math.max(0.02, 0.35 - 0.3 * t * tone);
        lp += (w - lp) * k;
        d[i] = lp * env * (0.8 + 0.2 * Math.sin(i * 0.0007 + ch));
      }
    }
    return buf;
  }
  function noiseBuffer(type = 'white') {
    if (buffers[type]) return buffers[type];
    const rate = ac.sampleRate, len = rate * 2;
    const buf = ac.createBuffer(1, len, rate), d = buf.getChannelData(0);
    if (type === 'white') for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    else if (type === 'pink') { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; } }
    else if (type === 'brown') { let l = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } }
    else if (type === 'crackle') { for (let i = 0; i < len; i++) d[i] = Math.random() < 0.002 ? (Math.random() * 2 - 1) : 0; }
    buffers[type] = buf; return buf;
  }

  const api = {
    get ctx() { return ac; }, get now() { return ac ? ac.currentTime : 0; }, get ready() { return !!ac && ac.state === 'running'; },
    get sfxBus() { return sfxBus; }, get musicBus() { return musicBus; }, get ambBus() { return ambBus; }, get master() { return master; }, get reverbSend() { return reverbSend; },
    missing, listenerPos,
    ensure,
    resume() { const c = ensure(); if (c && c.state !== 'running') c.resume().catch(() => {}); if (ctxGame.camera) ctxGame.camera.getWorldPosition(listenerPos); },
    register(name, fn) { gens.set(name, fn); },
    registerLoop(name, fn) { loops.set(name, fn); },
    has(name) { return gens.has(name) || loops.has(name); },
    setVolume(v) { if (master) master.gain.setTargetAtTime(v, ac.currentTime, 0.05); },
    setMusicVolume(v) { if (musicBus) musicBus.gain.setTargetAtTime(v, ac.currentTime, 0.05); },
    // global tone: 1 = normal, 0 = muffled (death, stun, underwater)
    setMuffle(v) { if (lowpass) lowpass.frequency.setTargetAtTime(400 + 19600 * v * v, ac.currentTime, 0.08); },
    // ---- synthesis primitives (all require ensure() to have run) ----
    noise(type = 'white', rate = 1) { const s = ac.createBufferSource(); s.buffer = noiseBuffer(type); s.loop = true; s.playbackRate.value = rate; s.start(ac.currentTime + Math.random() * 0.01); return s; },
    osc(type = 'sine', freq = 440, detune = 0) { const o = ac.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune; return o; },
    gain(v = 1) { const g = ac.createGain(); g.gain.value = v; return g; },
    filter(type = 'lowpass', freq = 1000, q = 0.7) { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; },
    delay(t = 0.2, fb = 0.3) { const d = ac.createDelay(2); d.delayTime.value = t; const g = ac.createGain(); g.gain.value = fb; d.connect(g); g.connect(d); return d; },
    // piecewise envelope on an AudioParam: pts = [[time, value, 'lin'|'exp'], ...] relative to t0
    env(param, pts, t0 = ac.currentTime, start = null) {
      param.cancelScheduledValues(t0);
      param.setValueAtTime(start ?? Math.max(1e-4, pts[0][1]), t0);
      for (const [t, v, mode] of pts) { if (mode === 'exp') param.exponentialRampToValueAtTime(Math.max(1e-4, v), t0 + t); else param.linearRampToValueAtTime(v, t0 + t); }
    },
    // waveshaper distortion curve
    shaper(amount = 20) { const ws = ac.createWaveShaper(); const n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x)); } ws.curve = c; ws.oversample = '2x'; return ws; },
    // output node for a voice: 2D (direct) or positional panner
    out(opts = {}) {
      const bus = opts.bus === 'music' ? musicBus : opts.bus === 'amb' ? ambBus : sfxBus;
      const g = ac.createGain(); g.gain.value = opts.gain ?? 1;
      if (opts.pos) {
        const p = ac.createPanner();
        p.panningModel = opts.hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse';
        p.refDistance = opts.ref ?? 2.5; p.maxDistance = opts.max ?? 250; p.rolloffFactor = opts.rolloff ?? 1.15;
        api.setPannerPos(p, opts.pos);
        g.connect(p); p.connect(bus);
        if (opts.reverb !== false) { const rs = ac.createGain(); rs.gain.value = (opts.reverb ?? 1) * 0.6; p.connect(rs); rs.connect(reverbSend); }
        return { node: g, panner: p, bus };
      }
      g.connect(bus);
      if (opts.reverb) { const rs = ac.createGain(); rs.gain.value = opts.reverb * 0.6; g.connect(rs); rs.connect(reverbSend); }
      return { node: g, panner: null, bus };
    },
    setPannerPos(p, pos) {
      const t = ac.currentTime;
      if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, 0.02); p.positionY.setTargetAtTime(pos.y, t, 0.02); p.positionZ.setTargetAtTime(pos.z, t, 0.02); } else p.setPosition(pos.x, pos.y, pos.z);
    },
    // one-shot. Generators: fn(audio, out, opts) -> optional { stop() } ; must schedule their own stop times.
    play(name, opts) {
      opts = opts || {};
      if (!ac || ac.state !== 'running' || muted) return null;
      const fn = gens.get(name);
      if (!fn) { if (!missing.has(name)) { missing.add(name); } return null; }
      // Distance culling for positional one-shots. Accept any {x,y,z}: callers pass map anchors
      // and plain literals as well as Vector3s, and requiring .distanceTo turned a missed sound
      // into a thrown TypeError that took the rest of the caller's update with it.
      if (opts.pos) {
        const px = opts.pos.x || 0, py = opts.pos.y || 0, pz = opts.pos.z || 0;
        const dx = px - listenerPos.x, dy = py - listenerPos.y, dz = pz - listenerPos.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > (opts.max ?? 250)) return null;
      }
      try { const o = api.out(opts); const h = fn(api, o.node, opts) || {}; h.out = o; return h; } catch (e) { console.error('sfx ' + name, e); return null; }
    },
    // continuous. Loop generators: fn(audio, out, opts) -> { stop(fade), set(k, v), update?(dt) }
    loop(name, opts) {
      opts = opts || {};
      if (!ac || ac.state !== 'running') return null;
      const fn = loops.get(name);
      if (!fn) { if (!missing.has(name)) missing.add(name); return null; }
      try {
        const o = api.out(opts);
        const h = fn(api, o.node, opts) || {};
        const handle = {
          out: o, name, alive: true,
          setPos(p) { if (o.panner) api.setPannerPos(o.panner, p); },
          setGain(v, tc = 0.08) { o.node.gain.setTargetAtTime(v, ac.currentTime, tc); },
          set(k, v) { h.set?.(k, v); },
          update(dt) { h.update?.(dt); },
          stop(fade = 0.3) { if (!handle.alive) return; handle.alive = false; o.node.gain.setTargetAtTime(0, ac.currentTime, fade / 3); setTimeout(() => { try { h.stop?.(); o.node.disconnect(); } catch {} live.delete(handle); }, fade * 1000 + 100); },
        };
        live.add(handle); return handle;
      } catch (e) { console.error('loop ' + name, e); return null; }
    },
    stopAll(fade = 0.5) { for (const h of [...live]) h.stop(fade); },
    update(dt) {
      if (!ac) return;
      const cam = ctxGame.camera;
      cam.getWorldPosition(listenerPos); cam.getWorldDirection(listenerFwd);
      const L = ac.listener, t = ac.currentTime;
      if (L.positionX) { L.positionX.setTargetAtTime(listenerPos.x, t, 0.02); L.positionY.setTargetAtTime(listenerPos.y, t, 0.02); L.positionZ.setTargetAtTime(listenerPos.z, t, 0.02); L.forwardX.setTargetAtTime(listenerFwd.x, t, 0.02); L.forwardY.setTargetAtTime(listenerFwd.y, t, 0.02); L.forwardZ.setTargetAtTime(listenerFwd.z, t, 0.02); L.upX.setTargetAtTime(0, t, 0.02); L.upY.setTargetAtTime(1, t, 0.02); L.upZ.setTargetAtTime(0, t, 0.02); }
      else { L.setPosition(listenerPos.x, listenerPos.y, listenerPos.z); L.setOrientation(listenerFwd.x, listenerFwd.y, listenerFwd.z, 0, 1, 0); }
      for (const h of live) h.update(dt);
    },
  };
  return api;
}
