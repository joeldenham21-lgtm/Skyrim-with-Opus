// Detector "Veer": slot 5 holsters the weapon and raises a boxy Soviet meter in the off hand. It ticks faster the
// closer the nearest artifact is (2.0 s at 30 m to 0.08 s under 2 m); the needle and a small LED answer each tick.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { grimeMaterial } from './probe.js';
import { def } from '../data/index.js';
import { buildHands, HAND_GRIP, handEuler } from '../weapons/gunmesh.js';
import { clamp01, damp, lerp, easeOutCubic } from '../core/math.js';

// camera-local: the meter sits low in the left hand, tilted back so the dial faces the eye
const REST = { p: [-0.13, -0.12, -0.27], r: [0.72, 0.38, 0.12] };
// where the left glove closes on the pistol grip (detector-local), and how the wrist leaves it
const GRIP_P = new THREE.Vector3(0, -0.07, 0.03), GRIP_R = handEuler([1, 0, 0], [0.05, -0.3, 0.95]);
const _e = new THREE.Euler(), _g = new THREE.Vector3();

function dialTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 192; const g = c.getContext('2d');
  g.fillStyle = '#cfc7b2'; g.fillRect(0, 0, 256, 192);
  // paper yellowing and a foxed corner
  const gr = g.createRadialGradient(128, 200, 20, 128, 200, 220); gr.addColorStop(0, 'rgba(120,95,50,0)'); gr.addColorStop(1, 'rgba(120,95,50,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 192);
  g.fillStyle = 'rgba(90,70,40,0.18)'; g.beginPath(); g.arc(238, 14, 26, 0, Math.PI * 2); g.fill();
  // arc scale: pivot at the bottom centre
  const cx = 128, cy = 176, R = 128;
  g.strokeStyle = '#1e1c19'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, R - 26, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  g.fillStyle = '#1e1c19'; g.font = 'bold 15px Georgia, serif'; g.textAlign = 'center';
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1.17 + 0.66 * i / 10);
    const major = i % 2 === 0, len = major ? 16 : 9;
    g.lineWidth = major ? 2.2 : 1.2; g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len)); g.stroke();
    if (major) g.fillText(String(i * 5), cx + Math.cos(a) * (R - 34), cy + Math.sin(a) * (R - 34) + 5);
  }
  // red danger band at the top of the scale
  g.strokeStyle = '#8c2a1e'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R - 6, Math.PI * 1.68, Math.PI * 1.83); g.stroke();
  g.fillStyle = '#1e1c19'; g.font = 'bold 14px Georgia, serif'; g.fillText('ВЕЕР-2', cx, 118);
  g.font = '11px Georgia, serif'; g.fillText('ИНДИКАТОР АРТЕФАКТОВ', cx, 136);
  g.font = '9px Georgia, serif'; g.textAlign = 'left'; g.fillText('№ 0417', 12, 184); g.textAlign = 'right'; g.fillText('ПСК · 1986', 244, 184);
  // stamp
  g.strokeStyle = 'rgba(140,42,30,0.55)'; g.lineWidth = 1.5; g.save(); g.translate(60, 150); g.rotate(-0.25); g.strokeRect(-26, -10, 52, 20);
  g.fillStyle = 'rgba(140,42,30,0.6)'; g.font = 'bold 9px Georgia, serif'; g.textAlign = 'center'; g.fillText('ПРОВЕРЕНО', 0, 4); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function buildDetector() {
  const root = new THREE.Group(); root.name = 'detector';
  const enamel = grimeMaterial(0x596047, 0.58, 0.28, 11.3);
  const steel = grimeMaterial(0x7f8286, 0.42, 0.9, 5.1);
  const bakelite = grimeMaterial(0x2b1d15, 0.45, 0.05, 2.7);
  const W = 0.092, H = 0.046, D = 0.15;
  // body with faked bevels: main block + slightly inset top/bottom plates, plus a raised dial bezel
  const bodyParts = [
    new THREE.BoxGeometry(W, H, D),
    new THREE.BoxGeometry(W - 0.006, 0.006, D - 0.006).translate(0, H / 2 + 0.002, 0),
    new THREE.BoxGeometry(W - 0.006, 0.006, D - 0.006).translate(0, -H / 2 - 0.002, 0),
    new THREE.BoxGeometry(0.076, 0.008, 0.056).translate(0, H / 2 + 0.008, 0.012),
    new THREE.BoxGeometry(W - 0.004, 0.012, 0.01).translate(0, H / 2 + 0.004, -D / 2 + 0.02),
  ];
  const body = new THREE.Mesh(mergeGeometries(bodyParts, false), enamel); bodyParts.forEach((b) => b.dispose());
  root.add(body);
  // steel: four screws on the top plate, an antenna stub, the belt loop
  const steelParts = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) steelParts.push(new THREE.CylinderGeometry(0.0032, 0.0032, 0.003, 8).translate(x * (W / 2 - 0.008), H / 2 + 0.006, z * (D / 2 - 0.009)));
  steelParts.push(new THREE.CylinderGeometry(0.0022, 0.003, 0.06, 6).translate(0, 0.03, 0).rotateX(0.35).translate(-W / 2 + 0.012, H / 2, -D / 2 + 0.03));
  steelParts.push(new THREE.CylinderGeometry(0.004, 0.004, 0.01, 8).rotateX(0.35).translate(-W / 2 + 0.012, H / 2 + 0.004, -D / 2 + 0.03));
  steelParts.push(new THREE.TorusGeometry(0.006, 0.0015, 6, 10).rotateY(Math.PI / 2).translate(W / 2 + 0.002, 0, D / 2 - 0.03));
  const steelMesh = new THREE.Mesh(mergeGeometries(steelParts, false), steel); steelParts.forEach((b) => b.dispose());
  root.add(steelMesh);
  // bakelite: a pistol grip below (oval section, leaning back, finger swells), a range knob, a switch toggle
  const gripGeo = new THREE.CylinderGeometry(0.0125, 0.0155, 0.1, 14);
  { const gp = gripGeo.attributes.position; for (let i = 0; i < gp.count; i++) { const y = gp.getY(i); const swell = 1 + 0.08 * Math.sin(y * 190); gp.setX(i, gp.getX(i) * swell); gp.setZ(i, gp.getZ(i) * 1.4 * swell); } gripGeo.computeVertexNormals(); }
  gripGeo.rotateX(0.3).translate(GRIP_P.x, GRIP_P.y, GRIP_P.z);
  const bakParts = [
    gripGeo,
    new THREE.CylinderGeometry(0.016, 0.018, 0.008, 14).scale(1, 1, 1.4).rotateX(0.3).translate(GRIP_P.x, GRIP_P.y + 0.048, GRIP_P.z - 0.015),   // grip collar under the body
    new THREE.CylinderGeometry(0.009, 0.0075, 0.012, 12).translate(-0.028, H / 2 + 0.01, -0.045),
    new THREE.BoxGeometry(0.004, 0.012, 0.004).rotateX(0.5).translate(0.03, H / 2 + 0.008, -0.052),
  ];
  const bak = new THREE.Mesh(mergeGeometries(bakParts, false), bakelite); bakParts.forEach((b) => b.dispose());
  root.add(bak);
  // dial face inside the bezel, under a dark glass
  const dialMat = new THREE.MeshStandardMaterial({ map: dialTexture(), roughness: 0.85, metalness: 0 });
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.048).rotateX(-Math.PI / 2), dialMat); dial.position.set(0, H / 2 + 0.0125, 0.012); root.add(dial);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.28 });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.052).rotateX(-Math.PI / 2), glassMat); glass.position.set(0, H / 2 + 0.0155, 0.012); glass.renderOrder = 3; root.add(glass);
  // needle: pivot at the bottom centre of the dial, swings about y
  const needle = new THREE.Group(); needle.position.set(0, H / 2 + 0.0138, 0.012 + 0.02); root.add(needle);
  const needleMat = new THREE.MeshStandardMaterial({ color: 0x1a1917, roughness: 0.6, metalness: 0.2 });
  const nb = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0008, 0.04).translate(0, 0, -0.02), needleMat); needle.add(nb);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.0012, 8), needleMat); needle.add(hub);
  // LED: a small domed lamp on the top-right
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x2a0a06, roughness: 0.3, emissive: 0xff3a1a, emissiveIntensity: 0.15 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 10, 8), ledMat); led.position.set(0.03, H / 2 + 0.009, -0.062); root.add(led);
  const ledRing = new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.004, 10), steel); ledRing.position.set(0.03, H / 2 + 0.007, -0.062); root.add(ledRing);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  // the left glove closes on the grip: same rule as hands.js (the mirrored grip point lands on GRIP_P)
  const glove = buildHands().left; glove.name = 'detectorHand';
  _e.set(GRIP_R[0], GRIP_R[1], GRIP_R[2]); glove.rotation.copy(_e);
  _g.copy(HAND_GRIP); _g.x = -_g.x; _g.applyEuler(_e);
  glove.position.copy(GRIP_P).sub(_g);
  root.add(glove);
  return { root, needle, ledMat, mats: [enamel, steel, bakelite, dialMat, glassMat, needleMat, ledMat] };
}

export function createDetector(ctx) {
  let dev = null, equipped = false, armed = false, equipT = 0, drawK = 0;
  let tickT = 0, led = 0, needleA = 0, needleV = 0, kick = 0, jitterT = 0, jitter = 0;

  function equip() {
    if (equipped) return;
    if (!dev) dev = buildDetector();
    ctx.weapons.holster?.();
    ctx.hands.pivot.add(dev.root);
    dev.root.position.set(REST.p[0], REST.p[1] - 0.3, REST.p[2]); dev.root.rotation.set(REST.r[0] - 0.7, REST.r[1], REST.r[2]);
    equipped = true; armed = !ctx.weapons.current; equipT = 0; drawK = 0; tickT = 0.4;
    ctx.audio.play('weapon_draw', { gain: 0.5, rate: 1.15 });
  }
  function unequip(silent = false) {
    if (!equipped) return;
    equipped = false; armed = false;
    if (dev && dev.root.parent) dev.root.parent.remove(dev.root);
    if (!silent) ctx.audio.play('weapon_holster', { gain: 0.4, rate: 1.15 });
  }
  function interval(d) {
    if (d >= 30) return 3.0 + Math.random() * 1.5;
    const t = clamp01((d - 2) / 28);
    return 0.08 + 1.92 * Math.pow(t, 1.5);
  }

  // The inventory v2 rewrite moved every stack:1 tool out of the stackable `items` map and into
  // typed instances in `inventory.gear`, but this module kept gating on inventory.has('detector'),
  // which only reads `items`. The detector you bought was therefore invisible to slot 5 and the
  // whole artifact-hunting loop was unreachable. Match on the def's `detect` field so every tier
  // counts, and keep the stack lookup as a fallback for debug gives and looted copies.
  const hasDetector = () => ctx.inventory.gear.some((g) => !!def(g.id)?.detect)
    || ['detector', 'detector2', 'detector3'].some((id) => ctx.inventory.has(id));

  const api = {
    get equipped() { return equipped; },
    equip, unequip,
    update(dt) {
      const live = ctx.mode === 'playing' && !ctx.panels.isOpen && !ctx.player.dead;
      if (live && ctx.input.pressed('slot5')) {
        if (equipped) unequip();
        else if (hasDetector()) equip();
        else ctx.audio.play('click', { gain: 0.4 });
      }
      if (!equipped) return;
      if (ctx.player.dead || !hasDetector()) { unequip(true); return; }
      if (live && ctx.input.pressed('holster')) { unequip(); return; }
      // a weapon coming out (slot 1-4, wheel) puts the meter away; the pending holster right after equip does not count
      const cur = ctx.weapons.current;
      equipT += dt;
      if (!cur) armed = true;
      else if (armed || equipT > 0.6) { unequip(true); return; }
      // draw-in and idle
      drawK = damp(drawK, 1, 9, dt);
      const k = easeOutCubic(drawK), t = ctx.elapsed;
      const breathe = Math.sin(t * 1.7) * 0.004;
      dev.root.position.set(REST.p[0] + Math.sin(t * 0.9) * 0.002, lerp(REST.p[1] - 0.3, REST.p[1], k) + breathe, REST.p[2]);
      dev.root.rotation.set(lerp(REST.r[0] - 0.7, REST.r[0], k) + Math.sin(t * 1.3) * 0.01, REST.r[1] + Math.sin(t * 0.7) * 0.012, REST.r[2]);
      // ticks
      const d = ctx.artifacts.nearestDistance(ctx.player.position);
      const near = d < 30 ? 1 - clamp01((d - 2) / 28) : 0;
      if (dt > 0) {
        tickT -= dt;
        if (tickT <= 0) {
          tickT = interval(d);
          ctx.audio.play('detector_tick', { gain: d < 30 ? 0.55 : 0.28, rate: 1 + near * 0.35 });
          led = 1; kick += 0.12 + near * 0.35;
        }
      }
      led = damp(led, 0, 14, dt);
      dev.ledMat.emissiveIntensity = 0.15 + led * 3.5;
      dev.ledMat.color.setRGB(0.16 + led * 0.6, 0.04 + led * 0.1, 0.02);
      // needle: a damped spring toward the proximity reading, kicked by each tick, with a nervous tremor
      jitterT -= dt; if (jitterT <= 0) { jitterT = 0.06 + Math.random() * 0.08; jitter = (Math.random() - 0.5) * (0.03 + near * 0.12); }
      const target = -1.05 + (near * 1.6 + kick + jitter) * 1.0;
      kick = damp(kick, 0, 9, dt);
      needleV += (target - needleA) * 180 * dt; needleV *= Math.exp(-11 * dt); needleA += needleV * dt;
      dev.needle.rotation.y = -Math.max(-1.12, Math.min(1.1, needleA));   // +y rotation sweeps left; the scale reads to the right
    },
  };
  ctx.events.on('gameStart', () => unequip(true));
  ctx.events.on('playerDied', () => unequip(true));
  return api;
}
