// Sky dome (two-layer cloud lid lit from the sun side, breaks to a paler zenith, sun and its gauze, a dusk pillar,
// stars and the moon, storm lightning), the Pechorsk Anomaly (inverted mountain) with orbiting debris, and the Column.
import * as THREE from 'three';
import { GLSL_NOISE } from './glsl.js';
import { mulberry32 } from '../core/rng.js';
import { glowTexture } from './textures.js';
import { clamp01 } from '../core/math.js';

export function createSky(ctx) {
  const { scene } = ctx;
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uHorizon: { value: new THREE.Color(0.55, 0.58, 0.6) },
    uZenith: { value: new THREE.Color(0.32, 0.36, 0.4) },
    uSunColor: { value: new THREE.Color(1.0, 0.92, 0.8) },
    uTide: { value: 0 },
    uCover: { value: 0.78 },
    uStorm: { value: 0 },        // written by lighting.js from lighting.storm
    uSunI: { value: 1 },         // sun strength (0 at night)
    uLightning: { value: 0 },    // sky-wide flash 0..1
    uBolt: { value: 0 },         // the bolt itself, for a few frames
    uLightningDir: { value: new THREE.Vector3(0, 0, 1) },   // horizontal direction of the strike
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1200, 48, 24),
    new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w; }`,
      fragmentShader: /* glsl */`
        ${GLSL_NOISE}
        uniform vec3 uSunDir, uMoonDir, uHorizon, uZenith, uSunColor, uLightningDir; uniform float uNight, uTime, uTide, uCover, uStorm, uSunI, uLightning, uBolt;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float up = clamp(d.y, -0.1, 1.0);
          float upp = max(up, 0.0);
          // base overcast gradient with a bright haze band at the horizon
          vec3 col = mix(uHorizon, uZenith, pow(upp, 0.55));
          col = mix(col, uHorizon * 1.08, exp(-upp * 9.0) * 0.6);
          // what shows through a break: the sky above the lid, paler and a shade bluer
          vec3 clear = mix(uHorizon * 1.12, uZenith * vec3(1.30, 1.36, 1.50) + 0.03, pow(upp, 0.7));
          col = mix(col, clear, smoothstep(0.0, 0.45, upp) * 0.55);
          // cloud lid: a low broken layer and a thin high veil on a flattened dome, drifting with the wind
          float wind = 1.0 + uStorm * 1.8;
          vec2 cuv = d.xz / (upp * 1.6 + 0.24);
          vec2 drift1 = vec2(uTime * 0.008, uTime * 0.004) * wind, drift2 = vec2(-uTime * 0.013, uTime * 0.006) * wind;
          float c1 = fbm(cuv * 1.7 + drift1);
          float c2 = fbm3(cuv * 3.9 + drift2 + 5.0);
          float dens = c1 * 0.7 + c2 * 0.45;
          float cover = clamp(uCover + uStorm * 0.18, 0.0, 1.0);
          float lo = 0.62 - cover * 0.385;
          float cloud = smoothstep(lo, lo + 0.40, dens);
          float veil = smoothstep(0.38, 0.8, fbm3(cuv * 0.8 - drift1 * 0.5 + 21.0));
          // lighting of the lid: the density gradient toward the sun lights the sun-side of every cell
          vec2 sunUv = normalize(uSunDir.xz + vec2(1e-4, 0.0)) * 0.07;
          float dSun = fbm3(cuv * 1.7 + drift1 + sunUv) * 0.7 + fbm3(cuv * 3.9 + drift2 + 5.0 + sunUv * 2.2) * 0.45;
          float lit = clamp((dens - dSun) * 7.0, -1.0, 1.0);
          float sunDot = max(dot(d, uSunDir), 0.0);
          float sunElev = clamp(uSunDir.y * 3.0 + 0.2, 0.0, 1.0);
          float lowSun = 1.0 - smoothstep(0.04, 0.42, uSunDir.y);
          vec3 lidDark = uZenith * (0.74 - uStorm * 0.28);
          vec3 lidLight = uHorizon * (1.06 - uStorm * 0.22);
          float thick = smoothstep(lo, lo + 0.75, dens);
          vec3 cloudCol = mix(lidLight, lidDark, thick);                         // thicker = darker belly
          cloudCol *= 1.0 + 0.16 * lit;                                           // sun-side edges, shadowed lee sides
          cloudCol += uSunColor * (0.05 + 0.04 * lit) * sunElev * uSunI;
          // undersides catch the low sun toward it: the pink-orange lid of a Pechorsk evening
          cloudCol += uSunColor * pow(sunDot, 2.0) * (0.10 + 0.55 * lowSun) * sunElev * (0.55 + 0.45 * lit) * uSunI * (1.0 - thick * 0.5);
          cloudCol += uSunColor * pow(sunDot, 3.0) * 0.18 * sunElev * uSunI;
          float horizonMask = smoothstep(-0.02, 0.12, d.y);
          col = mix(col, cloudCol, cloud * min(1.0, cover + 0.12) * horizonMask);
          col = mix(col, lidLight * 0.97, veil * (1.0 - cloud) * 0.55 * smoothstep(0.0, 0.15, d.y));
          float thin = 1.0 - cloud;
          // the sun: a coin behind gauze
          float disc = smoothstep(0.9985, 0.9993, sunDot);
          float halo = pow(sunDot, 60.0) * 0.55 + pow(sunDot, 8.0) * 0.16;
          col += uSunColor * (disc * 1.6 + halo) * sunElev * (0.35 + 0.65 * thin) * max(uSunI, 0.0);
          // a faint pillar above the low sun (ice in the lid)
          vec2 sxz = normalize(uSunDir.xz + vec2(1e-5, 0.0)); vec2 dxz = normalize(d.xz + vec2(1e-5, 0.0));
          float hAng = acos(clamp(dot(sxz, dxz), -1.0, 1.0));
          float vOff = d.y - uSunDir.y;
          float pillar = exp(-hAng * hAng * 900.0) * exp(-max(vOff, 0.0) * 9.0) * smoothstep(-0.02, 0.01, vOff) * lowSun * sunElev;
          col += uSunColor * pillar * 0.30 * (0.4 + 0.6 * thin) * uSunI;
          // night: stars through gaps, moon with a halo through the veil
          float moonDot = max(dot(d, uMoonDir), 0.0);
          float moon = smoothstep(0.9990, 0.9996, moonDot) * 0.9 + pow(moonDot, 120.0) * 0.25 + pow(moonDot, 14.0) * 0.06 * cloud;
          vec3 stars = vec3(smoothstep(0.985, 1.0, hash21(floor(d.xz / max(d.y, 0.02) * 260.0))) * (0.6 + 0.4 * sin(uTime * 3.0 + hash21(floor(d.xz * 400.0)) * 20.0)));
          col += (stars * thin * 0.35 + vec3(0.7, 0.75, 0.85) * moon * (0.35 + 0.65 * thin)) * uNight * smoothstep(0.0, 0.2, d.y);
          // storm lightning: the lid lights from within toward the strike, and the bolt itself under the cloud base
          if (uLightning > 0.001) {
            float ldot = max(dot(dxz, normalize(uLightningDir.xz + vec2(1e-5, 0.0))), 0.0);
            float lflash = uLightning * (0.2 + 0.8 * pow(ldot, 3.0)) * (0.3 + 0.7 * cloud) * smoothstep(-0.05, 0.2, d.y);
            col += vec3(0.8, 0.85, 1.0) * lflash;
            vec2 lxz = uLightningDir.xz;
            float lAng = atan(dxz.y, dxz.x) - atan(lxz.y, lxz.x); lAng = mod(lAng + 3.14159, 6.28318) - 3.14159;
            float jag = (vnoise(vec2(d.y * 30.0, uLightningDir.x * 7.0)) - 0.5) * 0.05 * (1.0 - smoothstep(0.0, 0.12, d.y));
            float bolt = exp(-pow((lAng - jag) * 140.0, 2.0)) * smoothstep(0.0, 0.01, d.y) * (1.0 - smoothstep(0.09, 0.14, d.y)) * uBolt;
            col += vec3(0.9, 0.92, 1.0) * bolt * 2.5;
          }
          // Tide white-out
          col = mix(col, vec3(1.0), uTide);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // --- The Pechorsk Anomaly: an inverted mountain hanging over the north horizon ---
  const rnd = mulberry32(4242);
  const anomalyGeo = new THREE.ConeGeometry(420, 520, 36, 12, false);
  anomalyGeo.rotateX(Math.PI);                 // point down
  {
    const p = anomalyGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, z);
      const ang = Math.atan2(z, x);
      const n = 1 + 0.22 * Math.sin(ang * 5 + y * 0.01) + 0.14 * Math.sin(ang * 13 + 1.7) + 0.12 * Math.sin(y * 0.03 + ang * 3);
      if (r > 1) { p.setX(i, x * n); p.setZ(i, z * n); }
      p.setY(i, y + Math.sin(ang * 7) * 12 + (rnd() - 0.5) * 18);
    }
    anomalyGeo.computeVertexNormals();
  }
  const distantUniforms = { uHorizon: uniforms.uHorizon, uNight: uniforms.uNight, uTime: uniforms.uTime, uTide: uniforms.uTide, uSunDir: uniforms.uSunDir, uLightning: uniforms.uLightning, uFade: { value: 0.5 } };
  const distantMat = (extra = '') => new THREE.ShaderMaterial({
    uniforms: distantUniforms, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW; varying float vH;
      void main(){ vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vH = position.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${GLSL_NOISE}
      uniform vec3 uHorizon, uSunDir; uniform float uNight, uTime, uTide, uFade, uLightning; varying vec3 vN; varying vec3 vW; varying float vH;
      void main(){
        vec3 base = vec3(0.10, 0.105, 0.115);
        float light = max(dot(vN, uSunDir), 0.0) * 0.35 + 0.25 * max(vN.y, 0.0);
        vec3 col = base * (0.5 + light);
        float strata = smoothstep(0.35, 0.65, vnoise(vec2(vH * 0.02, atan(vW.z, vW.x) * 6.0)));
        col *= 0.85 + 0.3 * strata;
        ${extra}
        col = mix(col, uHorizon * 0.82 + vec3(0.6, 0.65, 0.8) * uLightning * 0.35, uFade);
        col = mix(col, vec3(1.0), uTide);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const anomaly = new THREE.Mesh(anomalyGeo, distantMat(/* glsl */`
    // faint blue lights on the underside, flickering
    float pin = smoothstep(0.985, 1.0, hash21(floor(vec2(atan(vW.z, vW.x) * 40.0, vH * 0.08))));
    col += vec3(0.35, 0.6, 0.9) * pin * (0.5 + 0.5 * sin(uTime * 2.0 + vH)) * (1.0 - uFade) * 0.8;`));
  anomaly.position.set(-260, 620, -1500);
  anomaly.frustumCulled = false;
  scene.add(anomaly);

  // orbiting debris: shards circling the anomaly
  const debrisGeo = new THREE.IcosahedronGeometry(1, 1);
  { const p = debrisGeo.attributes.position; for (let i = 0; i < p.count; i++) { const s = 0.6 + rnd() * 0.9; p.setXYZ(i, p.getX(i) * s, p.getY(i) * (0.5 + rnd()), p.getZ(i) * s); } debrisGeo.computeVertexNormals(); }
  const DEBRIS = 90;
  const debris = new THREE.InstancedMesh(debrisGeo, distantMat(), DEBRIS);
  debris.frustumCulled = false;
  const orbits = [];
  for (let i = 0; i < DEBRIS; i++) orbits.push({ r: 300 + rnd() * 520, y: -80 + rnd() * 360, a: rnd() * Math.PI * 2, s: (0.004 + rnd() * 0.01) * (rnd() < 0.5 ? 1 : -1), sc: 6 + rnd() * 26, tilt: (rnd() - 0.5) * 0.4 });
  scene.add(debris);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), eu = new THREE.Euler();

  // --- The Column: a pillar of pale light at the far north ---
  const colUniforms = { uTime: uniforms.uTime, uHorizon: uniforms.uHorizon, uNight: uniforms.uNight, uTide: uniforms.uTide };
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 22, 1800, 24, 1, true),
    new THREE.ShaderMaterial({
      uniforms: colUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: /* glsl */`varying vec3 vN; varying vec3 vP; varying float vH;
        void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vP = mv.xyz; vH = uv.y; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`${GLSL_NOISE}
        uniform float uTime, uNight, uTide; varying vec3 vN; varying vec3 vP; varying float vH;
        void main(){
          vec3 vd = normalize(-vP);
          float edge = pow(abs(dot(vN, vd)), 1.4);           // bright core, soft edges
          float streaks = fbm(vec2(atan(vN.x, vN.z) * 3.0, vH * 40.0 - uTime * 0.05)) ;
          float a = edge * (0.35 + 0.65 * streaks) * (1.0 - pow(vH, 1.5) * 0.85) * 0.55;
          a *= 0.7 + 0.5 * uNight;
          vec3 col = mix(vec3(0.75, 0.82, 0.92), vec3(0.95, 0.9, 1.0), streaks);
          gl_FragColor = vec4(col * a * (1.0 - uTide), a);
        }`,
    })
  );
  column.position.set(40, 700, -1100);
  column.frustumCulled = false;
  scene.add(column);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xcfd8ee, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.scale.set(320, 220, 1);
  glow.position.set(40, 40, -1100);
  scene.add(glow);

  // storm lightning: rare, distant, at night; a double flash, the bolt for a few frames, thunder seconds later
  const bolt = { level: 0, boltT: 0, second: 0, thunderIn: 0, cool: 20, gain: 0 };
  const strikeRnd = mulberry32(9137);
  function strike(first = true) {
    const az = strikeRnd() * Math.PI * 2;
    if (first) uniforms.uLightningDir.value.set(Math.cos(az), 0, Math.sin(az));
    const strength = 0.45 + strikeRnd() * 0.55;
    bolt.level = Math.max(bolt.level, strength); bolt.boltT = 0.1;
    bolt.gain = strength;
    if (ctx.post && ctx.post.flash) ctx.post.flash(0.06 + 0.16 * strength);
    if (first) { bolt.second = 0.08 + strikeRnd() * 0.16; bolt.thunderIn = 1.2 + strikeRnd() * 4.5; }
  }

  const api = {
    uniforms, dome, anomaly, column,
    horizon: uniforms.uHorizon.value, zenith: uniforms.uZenith.value,
    columnPosition: column.position,
    tideBase: 0,    // written by game/tide.js
    tideBoost: 0,   // any module may add a temporary brightening (missions relay sequence)
    lightning: bolt,
    strike,         // debug: force a strike
    update(dt, t) {
      uniforms.uTime.value = t;
      uniforms.uTide.value = Math.min(1, api.tideBase + api.tideBoost);
      dome.position.copy(ctx.camera.position);
      // debris orbits
      for (let i = 0; i < DEBRIS; i++) {
        const o = orbits[i]; o.a += o.s * dt;
        v3.set(anomaly.position.x + Math.cos(o.a) * o.r, anomaly.position.y + o.y + Math.sin(o.a * 2.0) * 20 * o.tilt, anomaly.position.z + Math.sin(o.a) * o.r);
        eu.set(o.a * 0.7, o.a, o.a * 0.3); q.setFromEuler(eu);
        s3.setScalar(o.sc);
        m4.compose(v3, q, s3); debris.setMatrixAt(i, m4);
      }
      debris.instanceMatrix.needsUpdate = true;
      glow.material.opacity = 0.28 + 0.12 * uniforms.uNight.value + 0.05 * Math.sin(t * 0.7);
      // lightning schedule
      const L = ctx.lighting;
      const storm = L ? clamp01(L.storm) : 0;
      const night = ctx.time ? ctx.time.night : 0;
      const playing = ctx.mode === 'playing' && !(ctx.panels && ctx.panels.isOpen);
      if (playing && dt > 0) {
        bolt.cool = Math.max(0, bolt.cool - dt);
        if (bolt.cool <= 0 && night > 0.5 && storm > 0.25 && bolt.level < 0.01 && strikeRnd() < dt / 45) { strike(true); bolt.cool = 25 + strikeRnd() * 40; }
        if (bolt.second > 0) { bolt.second -= dt; if (bolt.second <= 0) strike(false); }
        if (bolt.thunderIn > 0) {
          bolt.thunderIn -= dt;
          if (bolt.thunderIn <= 0 && ctx.audio && typeof ctx.audio.has === 'function' && ctx.audio.has('thunder')) ctx.audio.play('thunder', { gain: 0.35 + 0.5 * bolt.gain });
        }
      }
      bolt.boltT = Math.max(0, bolt.boltT - dt);
      bolt.level *= Math.exp(-dt * 9);
      if (bolt.level < 0.002) bolt.level = 0;
      uniforms.uLightning.value = bolt.level;
      uniforms.uBolt.value = bolt.boltT > 0 ? 1 : 0;
      if (L) L.lightning = bolt.level;
    },
  };
  return api;
}
