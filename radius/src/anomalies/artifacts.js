// Artifacts: pearl, ember, tear, crown. Hovering, glowing, humming; picked with a 0.6 s reach via ctx.interact.
// Spawned near anomalies (and two loose ones somewhere remote) on gameStart/tide; everything disposed on reset().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fogUniforms } from '../render/fog.js';
import { glowTexture } from '../render/textures.js';
import { noise2 } from '../core/rng.js';
import { buildHands, handEuler } from '../weapons/gunmesh.js';
import { clamp, clamp01, damp, lerp, easeOutCubic, TAU } from '../core/math.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _reachDir = new THREE.Vector3(0, -0.3, -1);
const UP = new THREE.Vector3(0, 1, 0);
// the reach: the left glove comes up from below the frame and opens toward the artifact while E is held
const REACH_REST = new THREE.Vector3(-0.17, -0.3, -0.16), REACH_LEN = 0.5;
const REACH_R0 = handEuler([0.35, -0.35, -0.85], [-0.55, -0.35, 0.75]), REACH_R1 = handEuler([0.1, -0.55, -0.85], [-0.4, -0.5, 0.75]);
const TYPES = ['pearl', 'ember', 'tear', 'crown'];
const DEF = {
  pearl: { id: 'art_pearl', name: 'PEARL', light: 0x9fd0ff, lightI: 1.6, lightD: 7, hover: 0.32, spark: [0.6, 0.85, 1.0] },
  ember: { id: 'art_ember', name: 'EMBER', light: 0xff8a3c, lightI: 2.2, lightD: 8, hover: 0.28, spark: [1.0, 0.55, 0.2] },
  tear:  { id: 'art_tear',  name: 'TEAR',  light: 0xffa0c8, lightI: 1.2, lightD: 6, hover: 0.4,  spark: [1.0, 0.6, 0.8] },
  crown: { id: 'art_crown', name: 'CROWN', light: 0xc9a0ff, lightI: 1.8, lightD: 8, hover: 0.36, spark: [0.85, 0.7, 1.0] },
};

let shared = null;
function sharedGeo() {
  if (shared) return shared;
  const pearl = new THREE.SphereGeometry(0.13, 26, 18);
  // ember: a rough sphere with a crack mask (thin bands around a noise iso-line) that glows from inside
  const ember = new THREE.IcosahedronGeometry(0.13, 3);
  const ep = ember.attributes.position, mask = new Float32Array(ep.count);
  for (let i = 0; i < ep.count; i++) {
    const x = ep.getX(i), y = ep.getY(i), z = ep.getZ(i);
    const bump = 1 + 0.06 * noise2(x * 31 + 3.1, y * 29 + z * 17);
    ep.setXYZ(i, x * bump, y * bump * 0.94, z * bump);
    const n = 0.5 + 0.5 * noise2(x * 11 + z * 4.5 + 9.7, y * 12 - x * 5.2);
    const n2 = 0.5 + 0.5 * noise2(y * 13 - z * 6 + 21.3, x * 10 + z * 7);
    const d = Math.min(Math.abs(n - 0.5), Math.abs(n2 - 0.52));
    mask[i] = 1 - clamp01((d - 0.02) / 0.06);
  }
  ember.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
  ember.computeVertexNormals();
  // tear: a sphere stretched into an elongated drop with a pointed tail upward
  const tear = new THREE.SphereGeometry(0.1, 24, 24);
  const tp = tear.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
    const u = clamp01((y + 0.1) / 0.2);
    const pinch = 1 - 0.78 * Math.pow(clamp01((u - 0.45) / 0.55), 1.4);
    tp.setXYZ(i, x * pinch, y * 1.9 + Math.max(0, u - 0.5) * 0.14, z * pinch);
  }
  tear.computeVertexNormals();
  const ring = new THREE.RingGeometry(0.82, 1.0, 40).rotateX(-Math.PI / 2);
  // crown: a torus with five spikes leaning outward
  const parts = [new THREE.TorusGeometry(0.14, 0.028, 10, 26).rotateX(Math.PI / 2)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const c = new THREE.ConeGeometry(0.02, 0.13 + (i % 2) * 0.03, 6);
    c.translate(0, 0.06, 0).rotateZ(-0.35).rotateY(-a).translate(Math.cos(a) * 0.14, 0.01, Math.sin(a) * 0.14);
    parts.push(c);
  }
  const crown = mergeGeometries(parts, false); for (const p of parts) p.dispose();
  const core = new THREE.SphereGeometry(0.045, 12, 10);
  for (const g of [pearl, ember, tear, ring, crown, core]) g.userData.shared = true;
  shared = { pearl, ember, tear, ring, crown, core };
  return shared;
}

function pearlMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xe6f0ff, roughness: 0.22, metalness: 0.05, emissive: 0x9fd0ff, emissiveIntensity: 1.3 });
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    // the light sits inside: brightest through the centre; the shell is nacre, turning rose then blue toward the rim
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float c = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0); float fres = 1.0 - c;
        vec3 nacre = mix(vec3(1.0, 0.72, 0.84), vec3(0.62, 0.8, 1.0), smoothstep(0.35, 0.85, fres));
        totalEmissiveRadiance = mix(totalEmissiveRadiance * (0.25 + 1.3 * pow(c, 2.4)), nacre * 0.55, smoothstep(0.2, 0.75, fres));
        diffuseColor.rgb = mix(diffuseColor.rgb, nacre, fres * 0.6); }`);
  };
  return m;
}
function emberMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x1c110b, roughness: 0.88, metalness: 0.0, emissive: 0xff8a3c, emissiveIntensity: 1.8 });
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMask; varying float vMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = aMask;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMask;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ totalEmissiveRadiance *= 0.04 + vMask * vMask; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.2, 0.08), vMask * 0.7); }');
  };
  return m;
}
// glass without a transmission pass (that renders the whole scene a second time): the drop is see-through in the
// middle and catches light at the rim, with the pink held inside like a bead of coloured water
function tearMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffd8e6, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0xff6fa8, emissiveIntensity: 0.7, transparent: true, opacity: 1, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    for (const k in fogUniforms) shader.uniforms[k] = fogUniforms[k];
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float c = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0); float fres = pow(1.0 - c, 2.5);
          totalEmissiveRadiance *= 0.35 + 0.65 * fres + 0.5 * pow(c, 6.0);
          diffuseColor.a = 0.3 + 0.7 * fres; }`);
  };
  return m;
}
function crownMaterial() { return new THREE.MeshStandardMaterial({ color: 0x17141c, roughness: 0.5, metalness: 0.65, emissive: 0x3a2a55, emissiveIntensity: 0.4 }); }
function coreMaterial(col) { return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: col, emissiveIntensity: 2.4 }); }
function glowSprite(r, g, b, scale) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(r, g, b), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.setScalar(scale); s.renderOrder = 4; return s;
}

export function createArtifacts(ctx) {
  const list = [];
  let pending = 0;

  function build(a) {
    const g = sharedGeo(), d = DEF[a.type];
    const root = new THREE.Group(); root.name = 'artifact_' + a.type;
    a.mats = [];
    if (a.type === 'pearl') {
      const m = pearlMaterial(); a.mats.push(m);
      a.mesh = new THREE.Mesh(g.pearl, m); root.add(a.mesh);
      a.glow = glowSprite(0.7, 0.9, 1.25, 0.5); root.add(a.glow);
    } else if (a.type === 'ember') {
      const m = emberMaterial(); a.mats.push(m);
      a.mesh = new THREE.Mesh(g.ember, m); a.mesh.castShadow = true; root.add(a.mesh);
      a.glow = glowSprite(1.2, 0.55, 0.2, 0.42); a.glow.material.opacity = 0.35; root.add(a.glow);
    } else if (a.type === 'tear') {
      const m = tearMaterial(); a.mats.push(m);
      a.mesh = new THREE.Mesh(g.tear, m); root.add(a.mesh);
      const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.5, 0.75), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      a.mats.push(rm);
      a.ring = new THREE.Mesh(g.ring, rm); a.ring.renderOrder = 3; root.add(a.ring);
      a.glow = glowSprite(1.1, 0.6, 0.85, 0.3); a.glow.material.opacity = 0.3; root.add(a.glow);
    } else {
      const m = crownMaterial(), cm = coreMaterial(0xd8c0ff); a.mats.push(m, cm);
      a.mesh = new THREE.Mesh(g.crown, m); a.mesh.castShadow = true; root.add(a.mesh);
      a.core = new THREE.Mesh(g.core, cm); a.core.position.y = 0.02; root.add(a.core);
      a.glow = glowSprite(0.9, 0.7, 1.3, 0.6); a.glow.material.opacity = 0.45; root.add(a.glow);
    }
    a.mats.push(a.glow.material);
    a.light = new THREE.PointLight(d.light, d.lightI, d.lightD, 1.9); a.light.visible = false; a.light.position.y = 0.05; root.add(a.light);
    root.position.copy(a.position); root.position.y += d.hover;
    a.root = root; ctx.scene.add(root);
    a.unregister = ctx.interact.register({ position: root.position, radius: 2.3, prompt: 'PICK UP · ' + d.name, hold: 0.6, onInteract: () => pick(a), artifact: a });
  }
  // the reach hand rides under hands.pivot (sway and bob) only while a hold is in progress or still retracting
  let reach = null, reachK = 0;
  function updateReach(dt) {
    const cur = ctx.interact.current, target = cur && cur.artifact && !cur.artifact.picked ? cur.artifact : null;
    const want = target ? ctx.interact.holdProgress : 0;
    reachK = want > reachK ? want : damp(reachK, want, 8, dt);
    if (reachK <= 0.005) { if (reach && reach.parent) reach.parent.remove(reach); reachK = 0; return; }
    if (!reach) { reach = buildHands().left; reach.name = 'artifactReach'; }
    if (!reach.parent) ctx.hands.pivot.add(reach);
    if (target) { _v.copy(target.root.position); ctx.camera.worldToLocal(_v); if (_v.lengthSq() > 1e-4) _reachDir.copy(_v).normalize(); }
    const k = easeOutCubic(clamp01(reachK));
    _w.copy(_reachDir).multiplyScalar(REACH_LEN); _w.x -= 0.03; _w.y -= 0.04;
    reach.position.copy(REACH_REST).lerp(_w, k);
    reach.rotation.set(lerp(REACH_R0[0], REACH_R1[0], k), lerp(REACH_R0[1], REACH_R1[1], k), lerp(REACH_R0[2], REACH_R1[2], k));
  }
  function pick(a) {
    if (a.picked) return; a.picked = true;
    const d = DEF[a.type];
    _v.copy(a.root.position);
    ctx.vfx.spark(_v, UP, 28, d.spark);
    ctx.vfx.light(_v, d.light, 14, 0.4, 9);
    ctx.audio.play('artifact_pickup', { pos: _v, hrtf: true, gain: 0.9 });
    ctx.inventory.add(d.id, 1);
    const st = ctx.state.data.stats; if (st) st.artifacts = (st.artifacts || 0) + 1;
    ctx.events.emit('artifactPicked', d.id, a);
    // the saved flag is the only record that matters: a module-level one survived state.reset() and
    // swallowed the advisory for every new game after the first in a session
    { const f = ctx.state.data.flags; if (f && !f.artifactHint) { f.artifactHint = true; ctx.hud.hint?.('Committee advisory: artifacts are UNPSC property. Tender at the terminal for payment.', 6000); } }
    dispose(a);
  }
  function dispose(a) {
    if (a.unregister) { a.unregister(); a.unregister = null; }
    if (a.loop) { a.loop.stop(0.3); a.loop = null; }
    if (a.root) { ctx.scene.remove(a.root); a.root = null; }
    for (const m of a.mats) m.dispose();
    a.mats.length = 0;
    const i = list.indexOf(a); if (i >= 0) list.splice(i, 1);
  }
  function groundY(x, z) { return ctx.world.groundHeight(x, z, ctx.world.getHeight(x, z) + 3).y; }
  function placeable(x, z, refY = null) {
    const w = ctx.world, M = w.map;
    if (Math.abs(x) > M.HALF - 8 || Math.abs(z) > M.HALF - 8) return false;
    if (w.isWater(x, z)) return false;
    const y = w.getHeight(x, z);
    if (y < M.WATER_LEVEL + 0.25) return false;
    if (w.pointInSolid(x, y + 0.4, z) || w.pointInSolid(x, y + 1.2, z)) return false;
    if (refY != null && Math.abs(groundY(x, z) - refY) > 3) return false;
    for (const a of list) if (Math.hypot(a.position.x - x, a.position.z - z) < 3) return false;
    return true;
  }
  function rollType(rng) {
    if (rng.chance(0.06)) return 'crown';
    const k = rng();
    return k < 0.42 ? 'pearl' : k < 0.76 ? 'ember' : 'tear';
  }

  const api = {
    list,
    spawn(type, position) {
      const rng = ctx.rng.fork(0x7c00 + list.length * 3 + (ctx.state.data.tideLevel | 0) * 37 + Math.floor(ctx.elapsed * 7));
      if (!DEF[type]) type = rollType(rng);
      const a = { type, id: DEF[type].id, position: new THREE.Vector3(position.x, groundY(position.x, position.z), position.z), t: rng() * 20, ph: rng() * TAU, picked: false, dist: Infinity, loop: null, mats: [], root: null, unregister: null };
      build(a);
      list.push(a);
      return a;
    },
    populate() {
      api.reset();
      const anomalies = ctx.anomalies?.list || [];
      if (!anomalies.length) { pending = 6; return; }
      pending = 0;
      const d = ctx.state.data, M = ctx.world.map;
      const rng = ctx.rng.fork(0x3b1 + (d.tideLevel | 0) * 23 + ((d.stats && d.stats.tides) | 0) * 5);
      for (const an of anomalies) {
        const chance = rng.range(0.3, 0.6), n = rng.int(1, 2);
        for (let i = 0; i < n; i++) {
          if (!rng.chance(chance)) continue;
          let lo = 2, hi = 6;
          if (an.type === 'electric') { lo = an.radius - 1; hi = an.radius + 1.5; }
          else if (an.type === 'gravity') { lo = 3; hi = 6; }
          for (let tries = 0; tries < 10; tries++) {
            const ang = rng() * TAU, dist = rng.range(lo, hi);
            const x = an.position.x + Math.cos(ang) * dist, z = an.position.z + Math.sin(ang) * dist;
            if (!placeable(x, z, an.position.y)) continue;
            api.spawn(rollType(rng), _v.set(x, 0, z)); break;
          }
        }
      }
      // two loose ones, somewhere remote
      const remote = M.POIS.filter((p) => ['forest', 'rail', 'church', 'ridge', 'industrial', 'village'].includes(p.kind) && Math.hypot(p.x - M.BASE.x, p.z - M.BASE.z) > 200);
      let loose = 0;
      for (let tries = 0; tries < 60 && loose < 2; tries++) {
        const poi = rng.pick(remote.length ? remote : M.POIS);
        const ang = rng() * TAU, dist = Math.sqrt(rng()) * poi.r * 0.9;
        const x = poi.x + Math.cos(ang) * dist, z = poi.z + Math.sin(ang) * dist;
        if (!placeable(x, z)) continue;
        api.spawn(rollType(rng), _v.set(x, 0, z)); loose++;
      }
    },
    reset() { for (const a of [...list]) dispose(a); list.length = 0; reachK = 0; if (reach && reach.parent) reach.parent.remove(reach); },
    nearest(pos) {
      let best = null, bd = Infinity;
      for (const a of list) { const d = a.position.distanceTo(pos); if (d < bd) { bd = d; best = a; } }
      return best;
    },
    nearestDistance(pos) {
      let bd = Infinity;
      for (const a of list) { const d = a.position.distanceTo(pos); if (d < bd) bd = d; }
      return bd;
    },
    update(dt) {
      if (pending > 0 && --pending === 0) api.populate();
      updateReach(dt);
      const pl = ctx.player, p = pl.position, now = ctx.elapsed;
      for (const a of list) {
        const root = a.root; if (!root) continue;
        const d = Math.hypot(a.position.x - p.x, a.position.z - p.z);
        a.dist = d;
        if (d > 160) { root.visible = false; if (a.loop) { a.loop.stop(0.5); a.loop = null; } continue; }
        root.visible = true;
        a.t += dt;
        const t = a.t, def = DEF[a.type];
        root.position.y = a.position.y + def.hover + Math.sin(t * 1.25 + a.ph) * 0.045 + Math.sin(t * 3.1 + a.ph * 2) * 0.008;
        if (a.type === 'pearl') {
          const k = 0.5 + 0.5 * Math.sin(t * 1.6 + a.ph);
          a.mats[0].emissiveIntensity = 1.1 + 0.7 * k;
          a.glow.material.opacity = 0.35 + 0.3 * k; a.glow.scale.setScalar(0.42 + 0.12 * k);
          a.mesh.rotation.y = t * 0.2;
          a.light.intensity = def.lightI * (0.8 + 0.4 * k);
        } else if (a.type === 'ember') {
          const beat = Math.pow(0.5 + 0.5 * Math.sin(t * 4.6 + a.ph), 3);
          a.mats[0].emissiveIntensity = 1.2 + 1.8 * beat;
          a.glow.material.opacity = 0.2 + 0.45 * beat; a.glow.scale.setScalar(0.36 + 0.16 * beat);
          a.mesh.rotation.y = t * 0.35; a.mesh.rotation.x = Math.sin(t * 0.4) * 0.2;
          a.light.intensity = def.lightI * (0.6 + 0.8 * beat);
          if (d < 15 && Math.random() < 0.18) {
            const ang = Math.random() * TAU, rr = 0.08 + Math.random() * 0.1;
            ctx.vfx.sparks.emit(root.position.x + Math.cos(ang) * rr, root.position.y + (Math.random() - 0.3) * 0.15, root.position.z + Math.sin(ang) * rr,
              (Math.random() - 0.5) * 0.25, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.25, 1.0, 0.5 + Math.random() * 0.2, 0.15, 1.0 + Math.random() * 0.8, 0.03, -0.35, 0, now);
          }
        } else if (a.type === 'tear') {
          const k = 0.5 + 0.5 * Math.sin(t * 1.1 + a.ph);
          a.mats[0].emissiveIntensity = 0.45 + 0.9 * k;
          a.mesh.rotation.y = t * 0.5; a.mesh.rotation.z = Math.sin(t * 0.9) * 0.06;
          a.mesh.visible = d < 45;   // transmission costs a scene pass; only when it can be seen
          const rt = (t * 0.55 + a.ph) % 1;
          a.ring.scale.setScalar(0.12 + rt * 0.95); a.ring.position.y = a.position.y - root.position.y + 0.03;
          a.mats[1].opacity = (1 - rt) * (1 - rt) * 0.45;
          a.glow.material.opacity = 0.2 + 0.2 * k;
          a.light.intensity = def.lightI * (0.7 + 0.5 * k);
        } else {
          const k = 0.5 + 0.5 * Math.sin(t * 2.2 + a.ph), k2 = 0.5 + 0.5 * Math.sin(t * 7.3);
          a.mesh.rotation.y = t * 0.45; a.mesh.rotation.x = Math.sin(t * 0.7) * 0.12;
          a.mats[1].emissiveIntensity = 1.8 + 1.4 * k + 0.3 * k2;
          a.glow.material.opacity = 0.3 + 0.35 * k; a.glow.scale.setScalar(0.5 + 0.2 * k);
          a.light.intensity = def.lightI * (0.7 + 0.6 * k);
        }
        a.light.visible = d < 40 && !pl.inBase;
        // hum: quiet, audible under 8 m or so
        if (d < 12) {
          const gain = 0.55 * Math.pow(1 - d / 12, 1.4);
          if (!a.loop || !a.loop.alive) a.loop = ctx.audio.loop('artifact_hum', { pos: root.position, hrtf: true, gain, ref: 1.2, max: 20, rolloff: 1.6, variant: a.type });
          else a.loop.setGain(gain, 0.15);
        } else if (a.loop) { a.loop.stop(0.6); a.loop = null; }
      }
    },
  };
  ctx.events.on('gameStart', () => api.populate());
  ctx.events.on('tide', () => api.populate());
  return api;
}
