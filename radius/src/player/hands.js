// Viewmodel rig parented to the camera. Owns the gloved hands and the weapon child, and animates them
// procedurally: mouse-lag sway, walk bob (figure eight), low-stamina breathing, ADS transition (iron sights or the
// optic's eye point), recoil spring, sprint lowering, wall clearance (the muzzle pulls back from a wall), the bipod
// rest, draw/holster, and the staged reload/cycle animations weapons.js drives by name: magazines, belts (PKM top
// cover), stripper clips, tube shells, pumps, bolts (with scope clearance), break-open, jams, and the blade stab.
// The weapon light and the laser line live here, parented to the muzzle.
// Other modules may parent their own held items under hands.root; setWeaponMesh only touches the weapon child.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, clamp01, damp, lerp, easeInOut, easeOutCubic, easeInCubic, TAU } from '../core/math.js';
import { buildHands, HAND_GRIP, viewFill, materials as gunMaterials, handEuler } from '../weapons/gunmesh.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion();
const SPRING_K = 420, SPRING_AMP = Math.sqrt(SPRING_K);
const WALL_REACH = 0.8;
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const boltLift = (s) => (s.scoped ? 1.0 : 1.45);   // a scope over the receiver limits how far the handle can swing

// Animation library. Each fn(t, o, u, s) writes offsets into o (see makeOffsets) for t in 0..1; the last frame is
// held until the next animation starts, so a mag stays out between magOut and magIn. u = weapon userData,
// s = { lock, scoped } rig state.
const ANIMS = {
  draw(t, o) { const k = 1 - easeOutCubic(t); o.gunPos.set(0.02 * k, -0.32 * k, 0.06 * k); o.gunRot.set(-0.75 * k, 0.25 * k, 0.2 * k); },
  holster(t, o) { const k = easeInCubic(t); o.gunPos.set(0.02 * k, -0.32 * k, 0.06 * k); o.gunRot.set(-0.75 * k, 0.25 * k, 0.2 * k); },
  quickDraw(t, o) { const k = 1 - easeOutCubic(t); o.gunPos.set(0.06 * k, -0.2 * k, 0.1 * k); o.gunRot.set(-0.5 * k, 0.4 * k, 0.3 * k); },
  magOut(t, o, u) {
    const tilt = smooth(t * 2.5), drop = easeInCubic(seg(t, 0.25, 1));
    o.gunRot.set(-0.05 * tilt, 0.08 * tilt, 0.16 * tilt); o.gunPos.set(0, -0.015 * tilt, 0.01 * tilt);
    o.magPos.set(u.magTravel[0] * drop, u.magTravel[1] * drop, u.magTravel[2] * drop); o.magRot.set(-0.3 * drop, 0, 0.15 * drop);
  },
  magIn(t, o, u) {
    const rise = 1 - easeOutCubic(seg(t, 0, 0.72)), seat = Math.sin(Math.PI * seg(t, 0.72, 0.9)), settle = 1 - smooth(seg(t, 0.75, 1));
    o.gunRot.set(-0.05 * settle, 0.08 * settle, 0.16 * settle); o.gunPos.set(0, -0.015 * settle - 0.012 * seat, 0.01 * settle + 0.006 * seat);
    o.magPos.set(u.magTravel[0] * rise, u.magTravel[1] * rise + 0.004 * seat, u.magTravel[2] * rise); o.magRot.set(-0.3 * rise, 0, 0.15 * rise);
  },
  chamber(t, o, u, s) {
    const back = s.lock ? (t < 0.3 ? 1 : 1 - easeOutCubic(seg(t, 0.3, 0.75))) : (t < 0.4 ? easeOutCubic(t / 0.4) : 1 - easeInCubic(seg(t, 0.4, 0.8)));
    const tilt = Math.sin(Math.PI * clamp01(t));
    o.cycle = back; o.gunRot.set(0.02 * tilt, 0.06 * tilt, 0.12 * tilt); o.gunPos.set(0, -0.008 * tilt, 0.012 * back);
    o.hammer = back;
  },
  cycle(t, o) { const back = Math.sin(Math.PI * clamp01(t)); o.cycle = back; o.hammer = back; o.trigger = 1 - t; },
  dry(t, o) { o.trigger = 1 - t; o.gunRot.set(0.012 * Math.sin(Math.PI * t), 0, 0); },
  selector(t, o) { const k = Math.sin(Math.PI * t); o.gunRot.set(0.03 * k, 0.05 * k, 0.1 * k); o.gunPos.set(-0.006 * k, -0.004 * k, 0.006 * k); },
  lightTap(t, o) { const k = Math.sin(Math.PI * t); o.gunRot.set(-0.02 * k, -0.06 * k, -0.05 * k); o.gunPos.set(0.004 * k, -0.003 * k, 0.004 * k); },
  bolt(t, o, u, s) {
    // lift, pull, push, drop; with a scope the handle swings less and the rifle rolls further to clear it
    const lift = smooth(seg(t, 0, 0.18)) - smooth(seg(t, 0.8, 1));
    const pull = smooth(seg(t, 0.2, 0.42)) - smooth(seg(t, 0.55, 0.78));
    const roll = s.scoped ? 1.5 : 1;
    o.boltRot.set(0, 0, boltLift(s) * lift); o.boltPos.set(0, 0, (u.boltTravel || 0.07) * pull);
    const tilt = Math.sin(Math.PI * clamp01(t));
    o.gunRot.set(0.03 * tilt, 0.1 * tilt, -0.16 * tilt * roll); o.gunPos.set(-0.01 * tilt * roll, -0.006 * tilt, 0.02 * tilt);
  },
  pump(t, o) {
    const back = smooth(seg(t, 0.05, 0.4)) - smooth(seg(t, 0.55, 0.95));
    o.pump = back; const tilt = Math.sin(Math.PI * clamp01(t));
    o.gunRot.set(0.02 * tilt, 0.05 * tilt, 0.08 * tilt); o.gunPos.set(0, -0.006 * tilt, 0.015 * back);
  },
  breakOpen(t, o, u) {
    const k = easeOutCubic(seg(t, 0.15, 0.7)), tilt = smooth(seg(t, 0, 0.5));
    o.cycleRot.set((u.breakAngle || -0.55) * k, 0, 0);
    o.gunRot.set(-0.32 * tilt, 0.12 * tilt, 0.22 * tilt); o.gunPos.set(-0.02 * tilt, 0.01 * tilt, 0.02 * tilt);
  },
  shellIn(t, o, u) {
    const bump = Math.sin(Math.PI * seg(t, 0.55, 0.8));
    o.cycleRot.set((u.breakAngle || -0.55), 0, 0);
    o.gunRot.set(-0.32 - 0.03 * bump, 0.12, 0.22); o.gunPos.set(-0.02, 0.01 - 0.006 * bump, 0.02 + 0.008 * bump);
  },
  breakClose(t, o, u) {
    const k = 1 - easeInCubic(seg(t, 0, 0.55)), tilt = 1 - smooth(seg(t, 0.35, 1)), snap = Math.sin(Math.PI * seg(t, 0.55, 0.7));
    o.cycleRot.set((u.breakAngle || -0.55) * k, 0, 0);
    o.gunRot.set(-0.32 * tilt + 0.03 * snap, 0.12 * tilt, 0.22 * tilt); o.gunPos.set(-0.02 * tilt, 0.01 * tilt - 0.008 * snap, 0.02 * tilt);
  },
  // tube shotguns: the gun rolls to bring the loading port under the thumb, a shell pushed home per stage
  tubeStart(t, o) { const k = smooth(t); o.gunRot.set(-0.2 * k, 0.28 * k, 0.55 * k); o.gunPos.set(-0.04 * k, -0.06 * k, 0.04 * k); },
  tubeShell(t, o) { const push = Math.sin(Math.PI * seg(t, 0.35, 0.7)); o.gunRot.set(-0.2 - 0.03 * push, 0.28, 0.55 + 0.02 * push); o.gunPos.set(-0.04, -0.06 - 0.008 * push, 0.04 + 0.01 * push); },
  tubeEnd(t, o) { const k = 1 - smooth(t); o.gunRot.set(-0.2 * k, 0.28 * k, 0.55 * k); o.gunPos.set(-0.04 * k, -0.06 * k, 0.04 * k); },
  // belt-fed: top cover up, box off, box on, belt laid on the feed tray, cover slapped down
  coverOpen(t, o) { const k = easeOutCubic(seg(t, 0.2, 0.9)), tilt = smooth(seg(t, 0, 0.5)); o.cover = k; o.gunRot.set(-0.2 * tilt, 0.1 * tilt, 0.12 * tilt); o.gunPos.set(-0.02 * tilt, -0.02 * tilt, 0.03 * tilt); },
  boxOut(t, o, u) { const drop = easeInCubic(seg(t, 0.2, 1)); o.cover = 1; o.gunRot.set(-0.2, 0.1, 0.12); o.gunPos.set(-0.02, -0.02, 0.03); o.magPos.set(u.magTravel[0] * drop, u.magTravel[1] * drop, u.magTravel[2] * drop); o.magRot.set(-0.2 * drop, 0, 0.1 * drop); },
  boxIn(t, o, u) { const rise = 1 - easeOutCubic(seg(t, 0, 0.75)), seat = Math.sin(Math.PI * seg(t, 0.75, 0.92)); o.cover = 1; o.gunRot.set(-0.2, 0.1, 0.12); o.gunPos.set(-0.02, -0.02 - 0.01 * seat, 0.03); o.magPos.set(u.magTravel[0] * rise, u.magTravel[1] * rise + 0.004 * seat, u.magTravel[2] * rise); o.magRot.set(-0.2 * rise, 0, 0.1 * rise); },
  beltLay(t, o) { o.cover = 1; const press = Math.sin(Math.PI * seg(t, 0.3, 0.8)); o.gunRot.set(-0.2 - 0.03 * press, 0.1, 0.12); o.gunPos.set(-0.02, -0.02 - 0.008 * press, 0.03); },
  coverClose(t, o) { const k = 1 - easeInCubic(seg(t, 0, 0.5)), tilt = 1 - smooth(seg(t, 0.4, 1)), snap = Math.sin(Math.PI * seg(t, 0.5, 0.65)); o.cover = k; o.gunRot.set(-0.2 * tilt + 0.02 * snap, 0.1 * tilt, 0.12 * tilt); o.gunPos.set(-0.02 * tilt, -0.02 * tilt - 0.008 * snap, 0.03 * tilt); },
  jam(t, o) {
    const rattle = Math.sin(t * 60) * (1 - t) * 0.25;
    o.cycle = 0.42 + rattle * 0.3; o.gunRot.set(0.02 * rattle, 0.04 * rattle, 0.06 * rattle); o.gunPos.set(0, 0, 0.01 * (1 - t));
  },
  unjam(t, o) {
    const tilt = smooth(seg(t, 0, 0.25)) - smooth(seg(t, 0.82, 1));
    const tug = seg(t, 0.3, 0.7);
    const back = 0.42 + 0.58 * (Math.abs(Math.sin(tug * Math.PI * 2)) * (tug > 0 && tug < 1 ? 1 : 0));
    const release = smooth(seg(t, 0.72, 0.84));
    o.cycle = t < 0.72 ? back : 0.42 * (1 - release);
    o.gunRot.set(-0.18 * tilt, 0.14 * tilt, 0.38 * tilt); o.gunPos.set(-0.02 * tilt, -0.02 * tilt, 0.03 * tilt);
  },
  loadStart(t, o) { const k = smooth(t); o.gunRot.set(-0.28 * k, 0.2 * k, 0.32 * k); o.gunPos.set(-0.03 * k, -0.05 * k, 0.03 * k); },
  loadRound(t, o) { const bump = Math.sin(Math.PI * seg(t, 0.35, 0.65)); o.gunRot.set(-0.28 - 0.03 * bump, 0.2, 0.32 + 0.02 * bump); o.gunPos.set(-0.03, -0.05 - 0.006 * bump, 0.03); },
  loadEnd(t, o) { const k = 1 - smooth(t); o.gunRot.set(-0.28 * k, 0.2 * k, 0.32 * k); o.gunPos.set(-0.03 * k, -0.05 * k, 0.03 * k); },
  // stripper clip: action already open; the gun tilts toward the shooter and the clip is pressed in with a jolt
  clipIn(t, o, u, s) {
    const tilt = smooth(seg(t, 0, 0.3)) - smooth(seg(t, 0.8, 1)), press = Math.sin(Math.PI * seg(t, 0.45, 0.7));
    o.boltRot.set(0, 0, boltLift(s)); o.boltPos.set(0, 0, (u.boltTravel || 0.07)); o.cycle = 1;
    o.gunRot.set(0.04 * tilt - 0.02 * press, 0.12 * tilt, -0.2 * tilt); o.gunPos.set(-0.012 * tilt, -0.008 * tilt - 0.008 * press, 0.02 * tilt);
    o.magPos.set(0, 0.002 * press, 0);
  },
  boltOpen(t, o, u, s) {
    const lift = smooth(seg(t, 0, 0.45)), pull = smooth(seg(t, 0.5, 1));
    o.boltRot.set(0, 0, boltLift(s) * lift); o.boltPos.set(0, 0, (u.boltTravel || 0.07) * pull);
    o.gunRot.set(0.03 * lift, 0.1 * lift, -0.16 * lift); o.gunPos.set(-0.01 * lift, -0.006 * lift, 0.02 * lift);
  },
  boltClose(t, o, u, s) {
    const push = 1 - smooth(seg(t, 0, 0.5)), drop = 1 - smooth(seg(t, 0.55, 1));
    o.boltRot.set(0, 0, boltLift(s) * drop); o.boltPos.set(0, 0, (u.boltTravel || 0.07) * push);
    o.gunRot.set(0.03 * drop, 0.1 * drop, -0.16 * drop); o.gunPos.set(-0.01 * drop, -0.006 * drop, 0.02 * drop);
  },
  // blade: wind up back and right for 0.35 s, then the thrust and the return
  stab(t, o) {
    const wind = smooth(seg(t, 0, 0.5)), thrust = smooth(seg(t, 0.5, 0.62)) - smooth(seg(t, 0.72, 1));
    o.gunPos.set(0.05 * wind - 0.03 * thrust, -0.02 * wind + 0.01 * thrust, 0.12 * wind - 0.32 * thrust);
    o.gunRot.set(0.25 * wind - 0.15 * thrust, -0.35 * wind + 0.1 * thrust, 0.1 * wind);
  },
};

function makeOffsets() { return { gunPos: new THREE.Vector3(), gunRot: new THREE.Vector3(), magPos: new THREE.Vector3(), magRot: new THREE.Vector3(), boltPos: new THREE.Vector3(), boltRot: new THREE.Vector3(), cycleRot: new THREE.Vector3(), cycle: 0, hammer: 0, trigger: 0, pump: 0, cover: 0 }; }
function resetOffsets(o) { o.gunPos.set(0, 0, 0); o.gunRot.set(0, 0, 0); o.magPos.set(0, 0, 0); o.magRot.set(0, 0, 0); o.boltPos.set(0, 0, 0); o.boltRot.set(0, 0, 0); o.cycleRot.set(0, 0, 0); o.cycle = 0; o.hammer = 0; o.trigger = 0; o.pump = 0; o.cover = 0; }

// ---------------------------------------------------------------- blades (melee slot viewmodels)
// Built in the gun frame: blade forward along -z, grip down along -y like a pistol grip so the right-hand grip
// spec of the PM applies. Profiles are in (u = forward, v = up) and extruded across x, as in gunmesh.
function bladeSide(pts, width, bevel = 0.0012) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i === 0 ? s.moveTo(p[0], p[1]) : p[0] === 'q' ? s.quadraticCurveTo(p[1], p[2], p[3], p[4]) : s.lineTo(p[0], p[1])));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 8, steps: 1 });
  g.rotateY(Math.PI / 2); g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}
const cylZ = (rb, rf, len, seg = 12) => { const g = new THREE.CylinderGeometry(rf, rb, len, seg, 1); g.rotateX(-Math.PI / 2); return g; };
const cylY = (rb, rt, len, seg = 12) => new THREE.CylinderGeometry(rt, rb, len, seg, 1);
const at = (g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };
function merged(mat, geos, name) {
  const g = mergeGeometries(geos.map((x) => x.toNonIndexed()), false); g.deleteAttribute('uv');
  const c = toCreasedNormals(g, 40 * Math.PI / 180); c.computeBoundingSphere();
  const m = new THREE.Mesh(c, mat); m.name = name || 'body'; m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false; return m;
}
export function buildMeleeMesh(id) {
  const M = gunMaterials();
  const g = new THREE.Group(); g.name = id;
  const steel = [], grip = [], dark = [];
  let gripMat = M.wood, bladeLen = 0.16;
  // Knives are held like a pistol: hand at the guard, blade forward. A hafted tool is held down the
  // shaft with the head out front, so each weapon may move the grip and the carry pose.
  let gripP = [0.0, -0.062, -0.002];
  let pose = { p: [0.14, -0.15, -0.3], r: [0.12, -0.42, 0.18] };
  const HAFT = (len, r, mat) => { gripP = [0.0, -0.006, -0.01]; pose = { p: [0.17, -0.19, -0.34], r: [0.16, -0.5, 0.1] }; gripMat = mat; return len; };
  if (id === 'machete') {
    bladeLen = 0.36;
    // wide flat blade, clipped point, a slight belly toward the tip
    steel.push(bladeSide([[0.0, -0.02], [0.24, -0.028], ['q', 0.33, -0.03, 0.36, -0.004], [0.34, 0.012], [0.0, 0.014]], 0.0035, 0.001));
    steel.push(at(new THREE.BoxGeometry(0.018, 0.01, 0.045), 0, -0.008, 0.02)); // tang
    // wooden scales with three rivets
    for (const sx of [-1, 1]) grip.push(at(new THREE.BoxGeometry(0.009, 0.034, 0.11), sx * 0.007, -0.06, 0.035));
    for (const z of [0.0, 0.035, 0.07]) steel.push(at(cylZ(0.0025, 0.0025, 0.028), 0, -0.06, z, 0, Math.PI / 2, 0));
    gripMat = M.woodDark;
  } else if (id === 'bayonet') {
    bladeLen = 0.15;
    steel.push(bladeSide([[0.0, -0.011], [0.09, -0.013], [0.15, 0.001], [0.11, 0.011], [0.0, 0.012]], 0.0045, 0.0012));
    // crossguard with the muzzle ring on the top, bakelite grip with a latch button
    steel.push(at(new THREE.BoxGeometry(0.008, 0.05, 0.007), 0, -0.006, 0.004));
    steel.push(at(new THREE.TorusGeometry(0.0105, 0.0022, 8, 18), 0, 0.026, 0.004));
    grip.push(at(cylY(0.013, 0.011, 0.1, 10), 0, -0.065, 0.012));
    grip.push(at(new THREE.BoxGeometry(0.02, 0.098, 0.014), 0, -0.065, 0.016));
    steel.push(at(cylZ(0.004, 0.004, 0.006), 0.012, -0.05, 0.012, 0, Math.PI / 2, 0));
    steel.push(at(new THREE.BoxGeometry(0.02, 0.012, 0.03), 0, -0.117, 0.012));   // pommel with the mortise
    gripMat = M.bakelite;
  } else if (id === 'shiv') {
    // sharpened scrap with a taped handle: the thing you make in the first week
    bladeLen = 0.13;
    steel.push(bladeSide([[0.0, -0.009], [0.085, -0.015], [0.13, 0.002], [0.055, 0.011], [0.0, 0.011]], 0.0028, 0.0007));
    for (let i = 0; i < 4; i++) grip.push(at(cylY(0.0125, 0.0115, 0.024, 8), 0, -0.028 - i * 0.023, 0.002, 0, 0, (i % 2 ? 1 : -1) * 0.05));
    gripMat = M.rubber;
  } else if (id === 'kizlyar') {
    // modern combat knife: black coated drop point, finger-grooved polymer, glass breaker pommel
    bladeLen = 0.19;
    steel.push(bladeSide([[0.0, -0.014], [0.12, -0.017], [0.19, 0.0], [0.14, 0.014], [0.0, 0.015]], 0.0045, 0.0012));
    steel.push(bladeSide([[0.0, -0.008], [0.055, -0.009], [0.055, -0.004], [0.0, -0.003]], 0.0048, 0.0006));   // serrations block
    steel.push(at(new THREE.BoxGeometry(0.01, 0.042, 0.008), 0, -0.008, 0.005));                                // guard
    for (let i = 0; i < 4; i++) grip.push(at(cylY(0.0135, 0.0125, 0.023, 10), 0, -0.032 - i * 0.023, 0.006));
    steel.push(at(cylY(0.009, 0.006, 0.014, 8), 0, -0.128, 0.006));                                             // breaker
    gripMat = M.rubber;
  } else if (id === 'hatchet') {
    // Hafted tools: bladeSide profiles run along -z (forward), so the haft runs forward too and the
    // head sits at the far end of it. Building the haft along +z points it back over the shoulder.
    bladeLen = HAFT(0.4, 0.012, M.wood);
    const H = -0.3;
    steel.push(at(bladeSide([[0.0, -0.03], [0.055, -0.05], [0.075, -0.012], [0.07, 0.03], [0.02, 0.034], [0.0, 0.022]], 0.008, 0.0015), 0, 0.03, H));
    steel.push(at(new THREE.BoxGeometry(0.022, 0.05, 0.032), 0, 0.03, H + 0.012));      // eye and poll
    grip.push(at(cylZ(0.0115, 0.013, 0.3, 8), 0, 0, H / 2));                            // haft
    grip.push(at(cylZ(0.013, 0.016, 0.03, 8), 0, 0, 0.02));                             // swell at the butt
  } else if (id === 'spade') {
    // MPL-50 sapper spade: sharpened square blade on a short ash shaft, the Soviet trench weapon.
    bladeLen = HAFT(0.5, 0.014, M.wood);
    const H = -0.31;
    steel.push(at(bladeSide([[0.0, -0.075], [0.11, -0.085], [0.15, -0.03], [0.15, 0.03], [0.11, 0.085], [0.0, 0.075]], 0.006, 0.0012), 0, 0, H));
    steel.push(at(new THREE.BoxGeometry(0.03, 0.026, 0.06), 0, 0, H + 0.025));          // socket
    grip.push(at(cylZ(0.0135, 0.0145, 0.31, 8), 0, 0, H / 2));
    grip.push(at(cylY(0.019, 0.019, 0.026, 8), 0, 0, 0.018, Math.PI / 2, 0, 0));        // butt knob
  } else if (id === 'crowbar') {
    bladeLen = HAFT(0.62, 0.009, M.steelDark);
    grip.push(at(cylZ(0.0085, 0.0085, 0.5, 6), 0, 0, -0.23));                            // hex shaft
    grip.push(at(cylZ(0.0075, 0.008, 0.075, 6), 0, 0.022, -0.505, 0.42, 0, 0));          // gooseneck
    steel.push(at(new THREE.BoxGeometry(0.03, 0.011, 0.055), 0, 0.062, -0.545, 0.95, 0, 0));
    steel.push(at(new THREE.BoxGeometry(0.008, 0.013, 0.028), 0, 0.082, -0.566, 1.15, 0, 0));
    steel.push(at(new THREE.BoxGeometry(0.026, 0.0075, 0.04), 0, -0.002, 0.045, -0.2, 0, 0));   // chisel butt
  } else if (id === 'wrench') {
    // heavy pipe wrench: the industrial estate's contribution to close-quarters work
    bladeLen = HAFT(0.42, 0.012, M.steelDark);
    grip.push(at(new THREE.BoxGeometry(0.022, 0.03, 0.3), 0, 0, -0.14));
    steel.push(at(new THREE.BoxGeometry(0.026, 0.05, 0.05), 0, 0.012, -0.31));           // head
    steel.push(at(new THREE.BoxGeometry(0.024, 0.016, 0.075), 0, 0.045, -0.335, -0.25, 0, 0));  // fixed jaw
    steel.push(at(new THREE.BoxGeometry(0.022, 0.014, 0.06), 0, -0.012, -0.345, 0.2, 0, 0));    // moving jaw
    steel.push(at(cylZ(0.016, 0.016, 0.026, 10), 0, 0.012, -0.288));                     // adjuster nut
  } else if (id === 'fireaxe') {
    bladeLen = HAFT(0.8, 0.014, M.woodDark);
    const H = -0.62;
    steel.push(at(bladeSide([[0.0, -0.045], [0.07, -0.085], [0.095, -0.02], [0.09, 0.045], [0.03, 0.05], [0.0, 0.03]], 0.009, 0.0018), 0, 0.02, H));
    steel.push(at(new THREE.BoxGeometry(0.024, 0.03, 0.08), 0, 0.05, H + 0.03, 0.35, 0, 0));    // spike poll
    grip.push(at(cylZ(0.013, 0.0155, 0.62, 8), 0, 0, H / 2));
    grip.push(at(cylZ(0.0155, 0.019, 0.05, 8), 0, 0, 0.015));
  } else if (id === 'sledge') {
    bladeLen = HAFT(0.85, 0.016, M.wood);
    const H = -0.7;
    steel.push(at(cylZ(0.038, 0.038, 0.13, 12), 0, 0.028, H, 0, Math.PI / 2, 0));        // head across the haft
    steel.push(at(new THREE.BoxGeometry(0.05, 0.05, 0.052), 0, 0.028, H));               // eye block
    grip.push(at(cylZ(0.0145, 0.017, 0.7, 8), 0, 0, H / 2));
    grip.push(at(cylZ(0.017, 0.021, 0.055, 8), 0, 0, 0.018));
  } else {
    // NR-40 pattern: clipped point, S-guard, birch grip with a leather washer, steel pommel
    steel.push(bladeSide([[0.0, -0.012], [0.1, -0.015], [0.16, 0.003], [0.125, 0.013], [0.0, 0.012]], 0.004, 0.0012));
    steel.push(bladeSide([[-0.004, -0.028], [0.004, -0.028], [0.006, 0.0], [0.004, 0.024], [-0.004, 0.026], [-0.006, 0.0]], 0.006, 0.0008));  // S-guard profile
    grip.push(at(cylY(0.0135, 0.0125, 0.1, 10), 0, -0.058, 0.004));
    grip.push(at(cylY(0.0145, 0.0135, 0.012, 10), 0, -0.02, 0.004));
    dark.push(at(cylY(0.014, 0.014, 0.004, 10), 0, -0.012, 0.004));   // leather washer
    steel.push(at(cylY(0.012, 0.009, 0.012, 10), 0, -0.114, 0.004));
    gripMat = M.wood;
  }
  g.add(merged(M.steel, steel, 'blade'));
  g.add(merged(gripMat, grip, 'grip'));
  if (dark.length) g.add(merged(M.rubber, dark, 'washer'));
  g.userData = {
    id, melee: true, bladeLen,
    hip: { p: pose.p.slice(), r: pose.r.slice() },
    ads: { p: pose.p.slice(), r: pose.r.slice() },
    grips: { right: { p: gripP.slice(), r: handEuler([1, 0, 0], [0.15, -0.35, 0.92]) }, left: null },
    lowerRot: [0.3, 0.25, 0.2], magTravel: [0, 0, 0], cycle: 'none', ejectDir: [0, 0, 0],
  };
  return g;
}

export function createHands(ctx) {
  const root = new THREE.Group(); root.name = 'hands'; ctx.camera.add(root);
  const pivot = new THREE.Group(); pivot.name = 'weaponPivot'; root.add(pivot);      // sway, bob, kick
  const holder = new THREE.Group(); holder.name = 'weaponHolder'; pivot.add(holder); // pose + anim offsets
  const gloves = buildHands(); holder.add(gloves.right); holder.add(gloves.left);
  gloves.right.visible = gloves.left.visible = false;

  let weapon = null, parts = {}, ud = null, adsPose = null;
  const off = makeOffsets();
  let anim = null, animT = 0, animDur = 1, animFn = null;
  let bobT = 0, bobAmt = 0, lower = 0, breathe = 0, swayX = 0, swayY = 0, swayRX = 0, swayRY = 0, adsEase = 0, crouchK = 0, bipodK = 0, wallK = 0, wallTarget = 0, wallFrame = 0;
  // sight picture: the slow wander of a held weapon, the breath the shooter can hold, and the flinch when
  // rounds crack past. This moves the CAMERA, not the viewmodel, so the sights, the crosshair and the world
  // all drift together and the shot goes exactly where the picture says it will.
  let swayT = 0, swayAmp = 0, holdK = 0, holdT = 0, exhaleK = 0, hbCool = 0;
  // recoil spring (position back + rotation up), critically damped
  const kx = new THREE.Vector3(), kv = new THREE.Vector3(), kr = new THREE.Vector3(), krv = new THREE.Vector3();
  const state = { lock: false, scoped: false };

  // ---- laser: a thin beam and a dot, parented to the muzzle so they follow the bore ----
  const laserMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const laser = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), laserMat); laser.name = 'laserBeam'; laser.visible = false; laser.frustumCulled = false; laser.renderOrder = 12;
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,120,100,1)'); gr.addColorStop(0.3, 'rgba(255,40,20,0.9)'); gr.addColorStop(1, 'rgba(255,20,10,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const laserDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
  laserDot.name = 'laserDot'; laserDot.visible = false; laserDot.renderOrder = 21; laserDot.frustumCulled = false;
  let laserOn = false, lightOn = false, laserFrame = 0, laserDist = 30, selectorK = 0;
  const muzzleDir = new THREE.Vector3(0, 0, -1), muzzlePos = new THREE.Vector3();

  function placeHand(hand, spec, mirror) {
    if (!spec) { hand.visible = false; return; }
    hand.visible = true;
    _e.set(spec.r[0], spec.r[1], spec.r[2]);
    hand.rotation.copy(_e);
    _v.copy(HAND_GRIP); if (mirror) _v.x = -_v.x; _v.applyEuler(_e);
    hand.position.set(spec.p[0], spec.p[1], spec.p[2]).sub(_v);
  }
  // transform of an object relative to an ancestor (root by default), from local matrices only (no stale world matrices)
  function localToRoot(obj, out, stop = root) {
    out.identity();
    for (let o = obj; o && o !== stop; o = o.parent) { o.updateMatrix(); out.premultiply(o.matrix); }
    return out;
  }
  function attachLaser() {
    const m = parts.muzzle || weapon; if (!m) return;
    if (laser.parent !== m) { m.add(laser); m.add(laserDot); }
  }
  function updateLaser(dt) {
    if (!laserOn || !weapon) { laser.visible = laserDot.visible = false; return; }
    attachLaser();
    if ((laserFrame++ & 1) === 0) {
      // bore direction in world space: the muzzle's -z
      (parts.muzzle || weapon).getWorldPosition(muzzlePos);
      (parts.muzzle || weapon).getWorldQuaternion(_q); muzzleDir.set(0, 0, -1).applyQuaternion(_q);
      let d = 60;
      const eh = ctx.enemies?.raycast ? ctx.enemies.raycast(muzzlePos, muzzleDir, d) : null; if (eh) d = eh.distance;
      const wh = ctx.world.raycast(muzzlePos, muzzleDir, d); if (wh) d = wh.distance;
      laserDist = Math.max(0.05, d);
    }
    laser.visible = laserDot.visible = true;
    const w = 0.0022 + laserDist * 0.00012;
    laser.scale.set(w, w, laserDist); laser.position.set(0, 0, -laserDist * 0.5);
    laserDot.position.set(0, 0, -laserDist + 0.01); laserDot.scale.setScalar(0.014 + laserDist * 0.0035);
    laserMat.opacity = 0.35 + 0.1 * Math.sin(ctx.elapsed * 37);
  }
  function updateLight() {
    const L = ctx.lighting; if (!L || !L.weaponLight) return;
    if (!lightOn) return;
    const wl = L.weaponLight;
    if (wl.parent !== root) { root.add(wl); root.add(wl.target); }
    const m = parts.muzzle || weapon; if (!m) return;
    localToRoot(m, _m4);
    wl.position.setFromMatrixPosition(_m4);
    _v.set(0, 0, -1).transformDirection(_m4);
    wl.target.position.copy(wl.position).addScaledVector(_v, 8);
  }

  const api = {
    root, pivot, holder, adsBlend: 0, gloves, bipod: false, braced: false,
    get weapon() { return weapon; }, get parts() { return parts; },
    get animName() { return anim; }, get animT() { return animDur > 0 ? animT / animDur : 1; }, get animDone() { return !anim || animT >= animDur; },
    get wallBlocked() { return wallK > 0.6; }, get laserOn() { return laserOn; }, get lightOn() { return lightOn; }, get laserDistance() { return laserDist; },
    get holdingBreath() { return holdK > 0.5; }, get breathHold() { return holdK; }, get sway() { return swayAmp; }, get swayDeg() { return swayAmp * 1.27 / Math.PI * 180; },
    setWeaponMesh(group) {
      if (weapon) { weapon.remove(gloves.right); weapon.remove(gloves.left); holder.remove(weapon); }
      if (laser.parent) laser.parent.remove(laser);
      if (laserDot.parent) laserDot.parent.remove(laserDot);
      holder.add(gloves.right); holder.add(gloves.left);
      weapon = group || null; parts = {}; ud = null; adsPose = null; state.scoped = false;
      if (weapon) {
        holder.add(weapon);
        // the gloves ride inside the weapon group so they follow hip/ADS poses and every animation offset
        weapon.add(gloves.right); weapon.add(gloves.left);
        ud = weapon.userData;
        for (const n of ['mag', 'slide', 'bolt', 'barrels', 'trigger', 'hammer', 'muzzle', 'eject', 'pump', 'cover', 'handle', 'optic', 'lever', 'belt', 'bipod', 'selector']) { const o = weapon.getObjectByName(n); if (o) parts[n] = o; }
        parts.cycle = parts.slide || parts.bolt || parts.barrels || null;
        state.scoped = !!(ud.scoped ?? parts.optic);
        // ADS pose: through the optic's eye point when the mesh provides one, else the iron-sight pose
        const oe = ud.opticEye; const oeObj = parts.optic && weapon.getObjectByName('opticEye');
        if (oeObj) { localToRoot(oeObj, _m4, weapon); _v.setFromMatrixPosition(_m4); }
        const eye = oe ? (Array.isArray(oe) ? oe : [oe.x, oe.y, oe.z]) : oeObj ? [_v.x, _v.y, _v.z] : null;
        adsPose = eye ? { p: [-eye[0], -eye[1] - 0.004, -eye[2]], r: [0, 0, 0] } : (ud.ads || ud.hip);
        placeHand(gloves.right, ud.grips?.right, false);
        placeHand(gloves.left, ud.grips?.left, true);
      } else { gloves.right.visible = gloves.left.visible = false; }
      anim = null; animFn = null; state.lock = false; resetOffsets(off);
      if (laserOn) attachLaser();
      api.applyParts();
    },
    // named animation, duration in seconds; the last frame is held until the next call
    playAnim(name, duration = 0.5) { animFn = ANIMS[name] || null; anim = animFn ? name : null; animT = 0; animDur = Math.max(0.01, duration); },
    stopAnim() { anim = null; animFn = null; resetOffsets(off); },
    setSlideLock(v) { state.lock = !!v; },
    // fire selector lever position 0..1 (safe/first mode .. last mode)
    setSelector(k) { selectorK = clamp01(k); },
    setLaser(v) { laserOn = !!v; if (!laserOn) { laser.visible = laserDot.visible = false; } else attachLaser(); },
    setLight(v) { lightOn = !!v; const L = ctx.lighting; if (!lightOn && L && L.weaponLight) L.weaponLight.target.position.set(0, 0, -8); },
    // impulse into the spring; sqrt(K) turns a velocity impulse into roughly that peak displacement
    kick(pitch = 0, yaw = 0) {
      const s = (ctx.state.data.settings.motion ?? 1) * SPRING_AMP * (api.bipod ? 0.6 : 1);
      kv.z += (0.04 + pitch * 1.6) * s; kv.y += 0.008 * s; kv.x += yaw * 0.6 * s;
      krv.x += (0.08 + pitch * 3.2) * s; krv.z += (Math.random() - 0.5) * 0.12 * s; krv.y += yaw * 2.4 * s;
    },
    muzzleWorld(out) { if (parts.muzzle) return parts.muzzle.getWorldPosition(out); return ctx.camera.getWorldPosition(out); },
    ejectWorld(out) { if (parts.eject) return parts.eject.getWorldPosition(out); return api.muzzleWorld(out); },
    applyParts() {
      if (!weapon) return;
      const o = off;
      holder.position.copy(o.gunPos); holder.rotation.set(o.gunRot.x, o.gunRot.y, o.gunRot.z);
      const setBase = (p) => { if (!p || !p.userData.base) return; p.position.copy(p.userData.base.p); p.rotation.copy(p.userData.base.r); };
      setBase(parts.mag); setBase(parts.slide); setBase(parts.bolt); setBase(parts.barrels); setBase(parts.trigger); setBase(parts.hammer); setBase(parts.pump); setBase(parts.cover); setBase(parts.handle); setBase(parts.selector);
      if (parts.mag) { parts.mag.position.add(o.magPos); parts.mag.rotation.x += o.magRot.x; parts.mag.rotation.y += o.magRot.y; parts.mag.rotation.z += o.magRot.z; }
      const travel = ud.slideTravel || 0.03;
      let back = o.cycle; if (state.lock && anim !== 'chamber' && anim !== 'cycle' && anim !== 'jam' && anim !== 'unjam') back = Math.max(back, 0.85);
      const kind = ud.cycle || (parts.slide ? 'slide' : parts.barrels ? 'break' : parts.bolt ? 'bolt' : 'none');
      if (kind === 'slide' && parts.slide) parts.slide.position.z += travel * back;
      else if (kind === 'bolt' && parts.bolt) parts.bolt.position.z += travel * back;
      else if (kind === 'mosin' && parts.bolt) { parts.bolt.position.add(o.boltPos); parts.bolt.rotation.z += o.boltRot.z; }
      else if (kind === 'belt' && parts.bolt) parts.bolt.position.z += travel * back;
      else if (parts.barrels) { parts.barrels.rotation.x += o.cycleRot.x; }
      if (parts.handle && kind !== 'mosin') parts.handle.position.z += travel * back;
      if (parts.pump) parts.pump.position.z += (ud.pumpTravel || 0.08) * o.pump;
      if (parts.cover) parts.cover.rotation.x += (ud.coverAngle || 1.2) * o.cover;
      if (parts.selector) parts.selector.rotation.x += (ud.selectorTravel ?? -0.55) * selectorK;
      if (parts.trigger) parts.trigger.rotation.x -= 0.4 * o.trigger;
      if (parts.hammer) parts.hammer.rotation.x += 0.5 * o.hammer;
    },
    update(dt) {
      const p = ctx.player, input = ctx.input, s = ctx.state.data.settings, motion = s.motion ?? 1;
      const t = ctx.elapsed;
      // ---- animation ----
      if (animFn && animT < animDur) { animT = Math.min(animDur, animT + dt); }
      if (animFn) { resetOffsets(off); animFn(clamp01(animT / animDur), off, ud || {}, state); }
      // ---- wall clearance: a wall within reach of the muzzle pulls the gun up and back ----
      if (weapon && !(ud && ud.melee) && (wallFrame++ % 3) === 0) {
        ctx.camera.getWorldDirection(_w);
        const wh = ctx.world.raycast(p.eye, _w, WALL_REACH);
        wallTarget = wh ? clamp01(1 - wh.distance / WALL_REACH) : 0;
      }
      wallK = damp(wallK, wallTarget, 9, dt);
      // ---- pose: hip <-> ads <-> lowered <-> bipod ----
      const ads = easeInOut(clamp01(api.adsBlend)) * (1 - wallK);
      adsEase = damp(adsEase, ads, 40, dt);
      const wantLower = (p.sprinting || p.dead) && !(anim && animT < animDur && (anim === 'draw'));
      lower = damp(lower, wantLower ? 1 : 0, 7, dt);
      crouchK = damp(crouchK, p.crouched ? 1 : 0, 8, dt);
      bipodK = damp(bipodK, api.bipod ? 1 : 0, 6, dt);
      if (weapon && ud) {
        const hip = ud.hip, adsP = adsPose || ud.ads || ud.hip;
        _v.set(lerp(hip.p[0], adsP.p[0], adsEase), lerp(hip.p[1], adsP.p[1], adsEase), lerp(hip.p[2], adsP.p[2], adsEase));
        _e.set(lerp(hip.r[0], adsP.r[0], adsEase), lerp(hip.r[1], adsP.r[1], adsEase), lerp(hip.r[2], adsP.r[2], adsEase));
        const lr = ud.lowerRot || [0.4, 0.3, 0.2];
        _v.y -= lower * 0.12 + crouchK * 0.01 + bipodK * 0.035 * (1 - adsEase); _v.x += lower * 0.05; _v.z += lower * 0.06 - bipodK * 0.02;
        _e.x -= lr[0] * lower - bipodK * 0.05 * (1 - adsEase); _e.y += lr[1] * lower; _e.z += lr[2] * lower;
        // wall: muzzle up and the gun tucked back toward the chest
        _v.y -= wallK * 0.05; _v.z += wallK * 0.14; _v.x += wallK * 0.02;
        _e.x += wallK * 0.55; _e.z += wallK * 0.28; _e.y -= wallK * 0.12;
        weapon.position.copy(_v); weapon.rotation.copy(_e);
      }
      // ---- sway from mouse with lag (a rested rifle barely sways) ----
      const dx = input.enabled ? input.dx : 0, dy = input.enabled ? input.dy : 0;
      const swayK = lerp(1, 0.22, adsEase) * motion * lerp(1, 0.3, bipodK);
      swayX = damp(swayX, clamp(-dx * 0.00045, -0.025, 0.025) * swayK, 9, dt);
      swayY = damp(swayY, clamp(dy * 0.00035, -0.02, 0.02) * swayK, 9, dt);
      swayRY = damp(swayRY, clamp(-dx * 0.0011, -0.06, 0.06) * swayK, 8, dt);
      swayRX = damp(swayRX, clamp(-dy * 0.0009, -0.05, 0.05) * swayK, 8, dt);
      // ---- bob: figure eight from speed ----
      const speed = p.speed || 0;
      const target = p.grounded === false ? 0 : clamp01(speed / 3.6);
      bobAmt = damp(bobAmt, target, 6, dt);
      bobT += dt * (p.sprinting ? 12.5 : p.crouched ? 6.5 : 9.0) * clamp01(speed / 1.5);
      const bobK = (0.5 + 0.5 * clamp01(speed / 3.6)) * lerp(1, 0.25, adsEase) * motion * (p.sprinting ? 1.7 : 1);
      const bobX = Math.sin(bobT * 0.5) * 0.011 * bobAmt * bobK;
      const bobY = (Math.sin(bobT) * 0.007 - 0.003) * bobAmt * bobK;
      const bobRZ = Math.sin(bobT * 0.5) * 0.012 * bobAmt * bobK;
      // ---- breathing: always a little, much more when winded; steadied by a cigarette, stilled on the bipod ----
      breathe = damp(breathe, ctx.state.data.stamina < 25 ? 1 : 0, 1.5, dt);
      const steady = (ctx.damage ? ctx.damage.steadyMul : 1) * lerp(1, 0.25, bipodK);
      const brY = (Math.sin(t * TAU / 3.8) * 0.0018 * motion + Math.sin(t * TAU / 1.9) * 0.0065 * breathe * motion) * steady;
      const brRX = (Math.sin(t * TAU / 3.8 + 0.6) * 0.003 * motion + Math.sin(t * TAU / 1.9 + 0.4) * 0.012 * breathe * motion) * steady;
      const brRZ = (Math.sin(t * TAU / 5.1) * 0.002 * motion + Math.sin(t * TAU / 1.9 + 1.7) * 0.01 * breathe * motion) * steady;
      // ---- sight sway: breathing, load, fatigue, wounds, and whether you are holding your breath ----
      {
        const sd = ctx.state.data, inv = ctx.inventory;
        const stam = clamp01((sd.stamina ?? 100) / 100);
        const hurt = clamp01(1 - (sd.hp ?? 100) / 100);
        const wgt = ctx.weapons?.current?.def?.weight || 3;
        // holding the breath: Shift with the sights up and the feet still. It costs stamina fast and ends
        // in a forced exhale that throws the picture wide, so it is a window, not a switch.
        const wantHold = adsEase > 0.35 && input.enabled && input.down('sprint') && !p.sprinting && !p.dead
          && (sd.stamina ?? 0) > 0.5 && exhaleK <= 0 && !(anim === 'draw' && animT < animDur);
        if (wantHold) { holdT += dt; p.addStamina(-26 * dt); if ((sd.stamina ?? 0) <= 0.5) { exhaleK = 1; holdT = 0; } }
        else holdT = 0;
        holdK = damp(holdK, wantHold ? 1 : 0, wantHold ? 8 : 5, dt);
        exhaleK = Math.max(0, exhaleK - dt * 0.8);
        hbCool = Math.max(0, hbCool - dt);
        if (adsEase > 0.6 && stam < 0.45 && !sd.flags?.breathHint && hbCool <= 0 && sd.flags) {
          sd.flags.breathHint = true; ctx.hud?.hint?.('Hold your breath with Shift to steady the sights.', 3200);
        }
        let amp = 0.0016 * motion;
        amp *= lerp(2.6, 1.0, stam);                                   // winded is the single biggest term
        amp *= 1 + 0.8 * hurt;
        amp *= 1 + 1.6 * clamp01((p.speed || 0) / 3.6);                // walking is not a firing position
        amp *= p.crouched ? 0.72 : 1;
        amp *= lerp(1, 0.18, bipodK);
        if (api.braced && !api.bipod) amp *= 0.45;                     // rested on cover
        amp *= lerp(0.85, 1.35, clamp01((wgt - 2) / 5));               // a PKM wanders further than a PM
        amp *= ctx.damage ? ctx.damage.steadyMul : 1;
        amp *= lerp(0.28, 1, adsEase);
        amp *= lerp(1, 0.12, holdK);
        amp *= 1 + 2.6 * exhaleK * exhaleK;
        swayAmp = amp;
        swayT += dt * lerp(0.75, 1.9, 1 - stam);
        let cx = amp * (Math.sin(swayT * 0.90 + 1.7) * 0.55 + Math.sin(swayT * 2.15 + 0.4) * 0.22 + Math.sin(swayT * 0.37) * 0.5);
        let cy = amp * (Math.sin(swayT * 0.73) * 0.55 + Math.sin(swayT * 1.87 + 2.1) * 0.20 + Math.sin(swayT * 0.29 + 1.1) * 0.5);
        let cz = amp * Math.sin(swayT * 0.51 + 0.9) * 0.6;
        // suppression: a round past the ear does not nudge the aim, it jolts it
        const supp = ctx.ballistics ? (ctx.ballistics.suppression || 0) : 0;
        if (supp > 0.01) {
          const f = supp * 0.0055 * motion;
          cx += (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 71.3) * 0.4) * f;
          cy += (Math.sin(t * 43.7) * 0.6 + Math.sin(t * 63.1) * 0.4) * f;
          cz += Math.sin(t * 29.3) * f * 1.6;
        }
        ctx.camera.rotation.set(cx, cy, cz);
      }
      // ---- recoil spring ----
      const K = SPRING_K, C = 30, n = Math.min(8, Math.ceil(dt * 120)), h = n > 0 ? dt / n : 0;
      for (let i = 0; i < n; i++) {
        kv.addScaledVector(kx, -K * h).addScaledVector(kv, -C * h); kx.addScaledVector(kv, h);
        krv.addScaledVector(kr, -K * h).addScaledVector(krv, -C * h); kr.addScaledVector(krv, h);
      }
      const kick = lerp(1, 0.55, adsEase) * motion;
      pivot.position.set(swayX + bobX + kx.x * kick, swayY + bobY + brY + kx.y * kick, kx.z * kick);
      pivot.rotation.set(swayRX + brRX + kr.x * kick, swayRY + kr.y * kick, bobRZ + brRZ + kr.z * kick);
      api.applyParts();
      updateLaser(dt);
      updateLight();
      // ---- viewmodel fill: torch bounce off the ground ahead, a little sky by day, the weapon light's own spill ----
      const L = ctx.lighting;
      if (L) {
        const torch = L.flashlight && L.flashlight.visible ? clamp01(L.flashlight.intensity / 42) : 0;
        // irradiance units (three's Lambert divides by pi): the beam on the ground ahead measures ~4-6, so the bounce on
        // the hands sits at about two thirds of that; by day the sky adds a little so the gun never goes to silhouette
        viewFill.value.copy(L.hemi.color).multiplyScalar(L.hemi.intensity * 1.6);
        if (L.ambient) viewFill.value.addScalar(L.ambient.intensity * 0.4);
        if (torch > 0) viewFill.value.add(_c.copy(L.flashlight.color).multiplyScalar(torch * 6.0));
        if (lightOn && L.weaponLight) viewFill.value.add(_c.copy(L.weaponLight.color).multiplyScalar(clamp01(L.weaponLight.intensity / 30) * 2.5));
      }
    },
  };
  return api;
}
