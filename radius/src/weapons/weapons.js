// Weapon state machine v2: carry slots (primary/secondary/sidearm/melee), fire modes, chamber + magazine bookkeeping,
// internal tubes, clips and belts, staged reloads from ready pouches or the pack, loose-round loading (T), attachment
// effects (optics, suppressors, lights, lasers, bipods), condition (wear, fouling, jams, misfires), the melee stab,
// ADS with scope overlays, HUD readouts and ejected casings. The inventory weapon instance is the save data and is
// mutated in place; it is re-resolved every frame.
import * as THREE from 'three';
import * as gunmesh from './gunmesh.js';
import { WEAPONS, AMMO, MAGAZINES, CALIBERS, def as defOf, defaultAmmo } from '../data/index.js';
import { weaponEffects } from '../player/inventory.js';
import { buildMeleeMesh } from '../player/hands.js';
import { clamp, clamp01, damp, lerp, easeInOut, DEG } from '../core/math.js';

const ADS_FOV_K = 58 / 75;                 // iron sights: 75 -> 58
const CASINGS = 24;
const SLOT_ORDER = ['primary', 'secondary', 'sidearm', 'melee'];
const RANGE_BY_CLS = { pistol: 50, smg: 80, rifle: 200, shotgun: 25, sniper: 400, mg: 300 };
const HOLD_OPEN = new Set(['pm', 'aps', 'tt', 'glock', 'm9', 'm1911', 'ar', 'sks', 'svd', 'sv98']);   // families whose action locks back on empty
const SHOT_FALLBACK = { pistol: ['shot_pm', 1], smg: ['shot_pm', 1.12], rifle: ['shot_akm', 1], shotgun: ['shot_toz', 1], sniper: ['shot_mosin', 1], mg: ['shot_akm', 0.92] };
const MODE_LABEL = { semi: 'SEMI', auto: 'AUTO', burst: 'BURST', bolt: 'BOLT', pump: 'PUMP', break: 'BREAK' };
const KIND_LABEL = { fmj: 'FMJ', hp: 'HP', ap: 'AP', sub: 'SUB', tracer: 'TR', buck: 'BUCK', slug: 'SLUG', flechette: 'FLECH' };
// per calibre: [diameter, length, r, g, b]  (Soviet rifle cases are lacquered steel, shotgun hulls red plastic)
const CASE = {
  '9x18': [0.0095, 0.018, 0.78, 0.6, 0.3], '9x19': [0.0099, 0.019, 0.78, 0.6, 0.3], '7.62x25': [0.0099, 0.025, 0.78, 0.6, 0.3], '.45': [0.012, 0.023, 0.78, 0.6, 0.3],
  '5.45x39': [0.010, 0.0396, 0.58, 0.52, 0.36], '7.62x39': [0.011, 0.039, 0.58, 0.52, 0.36], '5.56x45': [0.0095, 0.045, 0.78, 0.6, 0.3],
  '9x39': [0.011, 0.039, 0.58, 0.52, 0.36], '7.62x54': [0.0125, 0.053, 0.6, 0.55, 0.38], '12ga': [0.02, 0.07, 0.5, 0.12, 0.08],
};

const _m = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const _mat = new THREE.Matrix4(), _sc = new THREE.Vector3(), _rq = new THREE.Quaternion(), _col = new THREE.Color(), _n = new THREE.Vector3();

export function createWeapons(ctx) {
  const { input, hands, inventory, hud, audio } = ctx;
  const meshes = new Map();          // signature -> viewmodel group
  const meleeMeshes = new Map();
  let rec = null, view = null, slotName = null, fx = null, mesh = null, meshSig = null;
  let meleeInst = null, meleeView = null, meleeHeld = false, quickReturn = null, stabHit = false;
  let state = 'idle', stage = null, timer = 0, stageDur = 0, cool = 0, busy = 0, cycleT = 0, cycleStep = 0;
  let adsTarget = 0, adsBlend = 0, bloom = 0, spreadDeg = 2, lastFov = 0, adsSound = 0, zoomHigh = true;
  let pendingSwitch = null, pendingSlot = null, pendingHolster = false, userHolstered = false;
  let pendingMag = null, reloadK = 1, shellsToLoad = 0, spent = 0, loadTarget = null, burstLeft = 0;
  let scopeShown = false, nvgSet = false, bipodActive = false, lastStatus = '';

  // ---- ejected casings: one instanced mesh, pooled ----
  const casingMesh = new THREE.InstancedMesh(gunmesh.casingGeometry(), gunmesh.materials().brass, CASINGS);
  casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  casingMesh.frustumCulled = false; casingMesh.castShadow = false; casingMesh.receiveShadow = true; casingMesh.name = 'casings';
  casingMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CASINGS * 3), 3);
  const casings = [];
  for (let i = 0; i < CASINGS; i++) {
    casings.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), t: 0, life: 0, sx: 0.01, sz: 0.02, live: false, rest: false });
    _mat.makeScale(0, 0, 0); casingMesh.setMatrixAt(i, _mat);
  }
  let casingHead = 0;
  ctx.scene.add(casingMesh);
  function ejectCasing(cal, dirLocal, speed = 1) {
    const idx = casingHead, c = casings[idx]; casingHead = (casingHead + 1) % CASINGS;
    const spec = CASE[cal] || CASE['9x18'];
    hands.ejectWorld(c.pos);
    if (hands.weapon) hands.weapon.getWorldQuaternion(_q); else ctx.camera.getWorldQuaternion(_q);
    _v.set(dirLocal[0] + (Math.random() - 0.5) * 0.4, dirLocal[1] + (Math.random() - 0.5) * 0.3, dirLocal[2] + (Math.random() - 0.5) * 0.3).normalize().applyQuaternion(_q);
    c.vel.copy(_v).multiplyScalar((1.6 + Math.random() * 1.2) * speed).add(ctx.player.velocity);
    c.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.t = 0; c.life = 1.1 + Math.random() * 0.2; c.sx = spec[0]; c.sz = spec[1]; c.live = true; c.rest = false;
    casingMesh.setColorAt(idx, _col.setRGB(spec[2], spec[3], spec[4]));
    casingMesh.instanceColor.needsUpdate = true;
  }
  function updateCasings(dt) {
    let any = false;
    for (let i = 0; i < CASINGS; i++) {
      const c = casings[i]; if (!c.live) continue; any = true;
      c.t += dt;
      if (c.t >= c.life) { c.live = false; _mat.makeScale(0, 0, 0); casingMesh.setMatrixAt(i, _mat); continue; }
      if (!c.rest) {
        c.vel.y -= 9.8 * dt;
        c.pos.addScaledVector(c.vel, dt);
        c.rot.x += c.spin.x * dt; c.rot.y += c.spin.y * dt; c.rot.z += c.spin.z * dt;
        const g = ctx.world.groundHeight(c.pos.x, c.pos.z, c.pos.y + 0.2).y;
        if (c.pos.y < g + c.sx * 0.5) { c.pos.y = g + c.sx * 0.5; if (c.vel.y < -1.2) { c.vel.y *= -0.3; c.vel.x *= 0.5; c.vel.z *= 0.5; c.spin.multiplyScalar(0.3); } else { c.rest = true; c.rot.x = Math.PI / 2 + (Math.random() - 0.5) * 0.2; } }
      }
      const k = c.t > c.life - 0.2 ? (c.life - c.t) / 0.2 : 1;
      _rq.setFromEuler(c.rot); _sc.set(c.sx * k, c.sx * k, c.sz * k);
      _mat.compose(c.pos, _rq, _sc); casingMesh.setMatrixAt(i, _mat);
    }
    if (any) casingMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- helpers: design of the current weapon ----
  const live = () => ctx.mode === 'playing' && !ctx.panels.isOpen && !ctx.player.dead;
  const def = () => (rec ? WEAPONS[rec.id] : null);
  const mode = () => { const d = def(); if (!d) return 'semi'; return d.modes.includes(rec.fireMode) ? rec.fireMode : d.modes[0]; };
  const isBreak = () => def()?.modes[0] === 'break';
  const isBolt = () => def()?.modes[0] === 'bolt';
  const isPump = () => def()?.modes[0] === 'pump';
  const isBelt = () => def()?.family === 'pkm';
  const isClip = () => !!def()?.clip;
  const isTube = () => !!def()?.tube;
  const isInternal = () => (def()?.internal || 0) > 0;
  const holdsOpen = () => { const d = def(); if (!d) return false; if (mesh && mesh.userData.holdOpen != null) return !!mesh.userData.holdOpen; return HOLD_OPEN.has(d.family); };
  const suppressed = () => fx && fx.noise < 0.6;
  const capacity = () => { const d = def(); if (!d) return 0; if (d.internal) return d.internal; if (rec.mag) return MAGAZINES[rec.mag.id]?.cap || 0; return d.defaultMag ? MAGAZINES[d.defaultMag].cap : 0; };
  const roundsIn = () => { const d = def(); if (!d) return 0; if (d.internal) return rec.tube.length; return rec.mag ? rec.mag.rounds : 0; };
  const loaded = () => (isBreak() ? rec.tube.length > 0 : !!rec.chamber);
  const chamberedAmmo = () => { const id = isBreak() ? rec.tube[0] : rec.chamber; return AMMO[id] || AMMO[defaultAmmo(def().cal)]; };
  const signature = (w) => `${w.id}|${(w.rails || []).join(',')}|${Object.entries(w.attachments || {}).map(([k, v]) => k + ':' + v).sort().join(',')}`;
  const cycleTime = () => { const d = def(); if (isBolt()) return d.id === 'sv98' ? 0.9 : d.id === 'obrez' ? 1.0 : 1.1; if (isPump()) return 0.55; return 0; };

  function buildMesh(w) {
    let g = null;
    try { g = gunmesh.buildGun(w.id, { lod: 'hi', inst: w }); } catch (e) { console.warn('[weapons] buildGun failed for', w.id, e); }
    if (!g) g = gunmesh.buildGun(w.id);
    if (typeof gunmesh.applyAttachments === 'function') {
      try { const r = gunmesh.applyAttachments(g, w); if (r && r.opticEye) g.userData.opticEye = r.opticEye; } catch (e) { console.warn('[weapons] applyAttachments failed', e); }
    }
    return g;
  }
  function meshFor(w) {
    const sig = signature(w);
    if (!meshes.has(sig)) {
      if (meshes.size >= 6) { const [k0, g0] = meshes.entries().next().value; meshes.delete(k0); if (g0 !== hands.weapon) g0.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }
      meshes.set(sig, buildMesh(w));
    }
    return meshes.get(sig);
  }
  function meleeMeshFor(id) {
    if (!meleeMeshes.has(id)) { let g = null; if (typeof gunmesh.buildMelee === 'function') { try { g = gunmesh.buildMelee(id); } catch (e) { g = null; } } meleeMeshes.set(id, g || buildMeleeMesh(id)); }
    return meleeMeshes.get(id);
  }
  function makeView(w) {
    return {
      def: WEAPONS[w.id], record: w, inst: w, isMelee: false,
      get id() { return w.id; }, get uid() { return w.uid; },
      get chamber() { return w.chamber; }, set chamber(v) { w.chamber = v; },
      get mag() { return w.mag; }, get tube() { return w.tube; }, get fireMode() { return mode(); },
      get parts() { return w.parts; }, get attachments() { return w.attachments; }, get rails() { return w.rails; },
      get dirt() { return w.dirt; }, set dirt(v) { w.dirt = v; },
      get jammed() { return w.jammed; }, set jammed(v) { w.jammed = v; },
      get lightOn() { return !!w.lightOn; }, get laserOn() { return !!w.laserOn; },
      get effects() { return fx; }, get state() { return state; }, get stage() { return stage; }, get slot() { return slotName; },
    };
  }
  function makeMeleeView(g) {
    return { def: defOf(g.id), record: g, inst: g, isMelee: true, get id() { return g.id; }, get uid() { return g.uid; }, chamber: null, mag: null, tube: null, fireMode: null, get state() { return state; }, get stage() { return stage; }, get slot() { return 'melee'; } };
  }
  function ammoLabel(id) { const a = AMMO[id]; if (!a) return ''; return `${CALIBERS[a.cal]?.short || a.cal} ${KIND_LABEL[a.kind] || a.kind.toUpperCase()}`; }
  function ammoHtml() {
    if (meleeHeld && meleeInst) { const d = defOf(meleeInst.id); return `<div class="big">${d?.name || 'Knife'}</div><div class="mags">blade</div>`; }
    if (!rec) return '';
    const d = def(), w = rec, cal = d.cal, pref = inventory.preferredAmmo(cal), loose = inventory.count(pref);
    let big, line;
    const mags = inventory.magsForWeapon(w);
    if (isBreak()) { big = `${w.tube.length} / ${d.internal}`; line = `${inventory.ammoCount(cal)} shells`; }
    else if (isInternal()) {
      big = `${w.tube.length}${w.chamber ? '+1' : ''} / ${d.internal}`;
      if (isClip()) { const clips = mags.filter((m) => m.rounds > 0).length; line = `<b>${clips}</b> ${clips === 1 ? 'clip' : 'clips'} · ${loose} loose`; }
      else line = `${inventory.ammoCount(cal)} shells`;
    } else {
      const cap = capacity();
      big = `${w.mag ? w.mag.rounds : 0}${w.chamber ? '+1' : ''} / ${cap}`;
      const ready = mags.filter((m) => m.rounds > 0 && inventory.isReady(m.uid)).length, pack = mags.filter((m) => m.rounds > 0 && !inventory.isReady(m.uid)).length;
      const noun = isBelt() ? (ready + pack === 1 ? 'belt' : 'belts') : isClip() ? 'clips' : 'ready';
      line = isBelt() ? `<b>${ready + pack}</b> ${noun} · ${loose} loose` : `<b>${ready}</b> ${noun} · ${pack} pack · ${loose} loose`;
    }
    const typeId = isBreak() ? w.tube[0] : (w.chamber || w.mag?.ammo || w.tube?.[0] || pref);
    const type = `${ammoLabel(typeId)} · ${MODE_LABEL[mode()] || ''}`;
    let extra = '';
    if (w.jammed && stage !== 'unjam') extra = '<div class="jam">JAMMED</div>';
    else if (stage === 'unjam') extra = '<div class="state">clearing</div>';
    else if (state === 'loading') extra = '<div class="state">loading magazine</div>';
    else if (state === 'reloading' || state === 'breaking') extra = '<div class="state">reloading</div>';
    else if (state === 'bolt' || state === 'pump') extra = '<div class="state">cycling</div>';
    return `<div class="big">${big}</div><div class="mags">${line}</div><div class="mags">${type}</div>${extra}`;
  }
  function refresh(show = true) { hud.setAmmo(ammoHtml()); if (show && (rec || meleeHeld)) hud.showAmmo(); statusExtra(); }
  function statusExtra() {
    const parts = [];
    if (rec && rec.lightOn && fx && fx.light > 0) parts.push('<span class="on">weapon light</span>');
    if (rec && rec.laserOn && fx && fx.laser) parts.push('<span class="on">laser</span>');
    if (bipodActive) parts.push('<span class="on">bipod</span>');
    const html = parts.join('<br>');
    if (html !== lastStatus) { lastStatus = html; hud.setStatusExtra(html, 'weapons'); }
  }
  function recomputeFx() { fx = rec ? weaponEffects(rec) : null; }
  function setLock() {
    if (!rec || !def()) { hands.setSlideLock(false); return; }
    hands.setSlideLock(holdsOpen() && !rec.chamber && !isInternal() && (!rec.mag || rec.mag.rounds === 0));
  }
  function applyLights() {
    const on = !!(rec && rec.lightOn && fx && fx.light > 0), laser = !!(rec && rec.laserOn && fx && fx.laser);
    ctx.lighting.setWeaponLight?.(on, fx ? fx.light : 30);
    hands.setLight(on); hands.setLaser(laser);
    if (mesh) { mesh.userData.setLightOn?.(on); mesh.setLightOn?.(on); mesh.userData.setLaserOn?.(laser); mesh.setLaserOn?.(laser); }
    statusExtra();
  }
  function clearOverlays() {
    if (scopeShown) { scopeShown = false; hud.setScope(null); }
    if (nvgSet) { nvgSet = false; ctx.post.setNvg(ctx.gear?.nvgOn ? (ctx.gear.nvgGen || 1) : 0); }
    ctx.lighting.setWeaponLight?.(false); hands.setLight(false); hands.setLaser(false);
    if (bipodActive) { bipodActive = false; hands.bipod = false; }
    statusExtra();
  }
  // ---- equip ----
  function setCurrent(w, slot = null, meleeGear = null) {
    clearOverlays();
    rec = w || null; view = rec ? makeView(rec) : null; slotName = rec ? (slot || slotOf(rec)) : (meleeGear ? 'melee' : null);
    meleeInst = meleeGear || null; meleeView = meleeInst ? makeMeleeView(meleeInst) : null; meleeHeld = !!meleeInst; quickReturn = null;
    recomputeFx();
    state = rec && rec.jammed ? 'jammed' : 'idle'; stage = null; timer = 0; burstLeft = 0; zoomHigh = true;
    mesh = rec ? meshFor(rec) : meleeInst ? meleeMeshFor(meleeInst.id) : null; meshSig = rec ? signature(rec) : null;
    hands.setWeaponMesh(mesh);
    if (mesh) { hands.playAnim('draw', 0.35); busy = 0.35; audio.play('weapon_draw', { gain: 0.6, rate: meleeInst ? 1.2 : 1 }); setLock(); applyLights(); }
    refresh(true);
  }
  function beginHolster(next = null, nextSlot = null, nextMelee = null) {
    if (!rec && !meleeHeld) { if (next || nextMelee) setCurrent(next, nextSlot, nextMelee); return; }
    state = 'idle'; stage = null; timer = 0; adsTarget = 0; burstLeft = 0;
    pendingSwitch = next; pendingSlot = nextSlot; pendingHolster = true; busy = 0.28; api._nextMelee = nextMelee;
    clearOverlays();
    hands.playAnim('holster', 0.28); audio.play('weapon_holster', { gain: 0.5 });
  }
  function slotOf(w) { const e = inventory.equipment; for (const s of SLOT_ORDER) if (e[s] === w.uid) return s; return null; }
  function meleeGear() { const g = inventory.equipped('melee'); return g && defOf(g.id)?.kind === 'melee' ? g : null; }
  // toggle: a second press of the slot that is already out puts the item away (the keys); API callers get an idempotent equip
  function equipSlot(s, toggle = false) {
    const name = typeof s === 'number' ? SLOT_ORDER[s] : s;
    if (!name) return false;
    if (name === 'melee') {
      const g = meleeGear(); if (!g) return false;
      userHolstered = false;
      if (meleeHeld && meleeInst && meleeInst.uid === g.uid && !quickReturn) { if (pendingHolster) { pendingSwitch = null; api._nextMelee = g; } else if (toggle) { userHolstered = true; beginHolster(null); } return true; }
      if (pendingHolster) { pendingSwitch = null; pendingSlot = null; api._nextMelee = g; return true; }
      beginHolster(null, null, g); return true;
    }
    const w = inventory.weaponInSlot(name);
    if (!w) return false;
    userHolstered = false;
    if (rec && rec.uid === w.uid && !meleeHeld) {
      if (pendingHolster) { pendingSwitch = w; pendingSlot = name; api._nextMelee = null; }
      else if (toggle) { userHolstered = true; beginHolster(null); }
      return true;
    }
    if (pendingHolster) { pendingSwitch = w; pendingSlot = name; api._nextMelee = null; return true; }
    beginHolster(w, name, null);
    return true;
  }

  // ---- stages ----
  function setStage(s, t, sound, anim, animT = t, soundOpts = null) { stage = s; timer = t; stageDur = t; if (sound) audio.play(sound, Object.assign({ gain: 0.8 }, soundOpts || {})); if (anim) hands.playAnim(anim, animT); refresh(true); }
  function finish() { state = rec && rec.jammed ? 'jammed' : 'idle'; stage = null; timer = 0; loadTarget = null; pendingMag = null; setLock(); refresh(true); }
  const snd = (name, fallback) => (audio.has(name) ? name : fallback);

  // ---- firing ----
  function dryFire() { audio.play('dry_click', { gain: 0.7 }); hands.playAnim('dry', 0.12); cool = 0.25; refresh(true); }
  function misfire() { audio.play('dry_click', { gain: 0.8, rate: 0.85 }); hands.playAnim('dry', 0.14); cool = 0.4; hud.hint('Misfire. The round stays in the chamber.', 2200); refresh(true); }
  function jam() {
    rec.jammed = true; state = 'jammed'; stage = null; timer = 0; burstLeft = 0;
    audio.play('jam', { gain: 0.9 }); hands.playAnim('jam', 0.3);
    ctx.events.emit('weaponJammed', view); refresh(true);
    const f = ctx.state.data.flags; if (!f.jamHint) { f.jamHint = true; hud.hint('Committee advisory: a fouled action stops. Clear it (R). Strip and clean at the workbench.', 6000); }
  }
  function tryFire(edge) {
    if (meleeHeld) { if (edge) stab(); return; }
    if (!rec || busy > 0 || cool > 0) return;
    if (state === 'jammed' && !stage) { if (edge) dryFire(); return; }
    if (state !== 'idle') return;
    const w = rec;
    if (!loaded()) { if (edge) { dryFire(); if ((isPump() || isBolt()) && roundsIn() > 0) hud.hint('Chamber empty. Cycle the action (R).', 2000); } return; }
    if (w.parts.frame < 30 && Math.random() < 0.05) { misfire(); return; }
    const bolt = clamp01(w.parts.bolt / 100), jamP = 0.18 * w.dirt * w.dirt * w.dirt + 0.12 * (1 - bolt) * (1 - bolt);
    if (Math.random() < jamP) { jam(); return; }
    fire();
  }
  function fire() {
    const d = def(), w = rec, p = ctx.player, a = chamberedAmmo();
    recomputeFx();
    hands.muzzleWorld(_m);
    ctx.camera.getWorldPosition(_o); ctx.camera.getWorldDirection(_d);
    const pellets = a.pellets || 1;
    let spread = spreadDeg;
    if (pellets > 1) spread = (a.spread || 7) * lerp(1, 0.85, adsBlend) * (fx.moa > 1 ? Math.sqrt(fx.moa) : 1) + spreadDeg * 0.3;
    const range = d.range || RANGE_BY_CLS[d.cls] || 100;
    const noise = (a.noise || 1) * fx.noise;
    ctx.ballistics.shoot(_o, _d, { ammo: a, damage: a.damage * (0.85 + 0.15 * clamp01(w.parts.barrel / 100)), range, spreadDeg: spread, pellets, tracer: !!a.tracer || d.cls === 'mg', cls: d.cls, source: 'player', kind: 'bullet', shooter: p, tracerFrom: _m, noise });
    // consume the chambered round, then feed the next one from the magazine or the tube (auto-loaders)
    if (isBreak()) { w.tube.shift(); spent++; }
    else {
      w.chamber = null;
      if (!isBolt() && !isPump()) {
        if (w.mag && w.mag.rounds > 0) { w.mag.rounds--; w.chamber = w.mag.ammo; if (w.mag.rounds === 0) w.mag.ammo = null; }
        else if (isInternal() && w.tube.length) w.chamber = w.tube.shift();
      }
    }
    // condition: wear spread over the parts, fouling, faster with a can on the muzzle
    const wear = d.wear * (a.kind === 'ap' ? 1.3 : 1) * fx.wear;
    w.parts.barrel = Math.max(0, w.parts.barrel - wear * 0.5); w.parts.bolt = Math.max(0, w.parts.bolt - wear * 0.35); w.parts.frame = Math.max(0, w.parts.frame - wear * 0.15);
    w.dirt = Math.min(1, w.dirt + 0.012 * (suppressed() ? 1.5 : 1) * (d.cal === '12ga' ? 1.4 : 1));
    // recoil: pitch up with a little random yaw; steadier when aiming, crouched, braked or on the bipod
    const steady = lerp(1, 0.8, adsBlend) * (p.crouched ? 0.85 : 1) * fx.recoil * (bipodActive ? 0.6 : 1) * (ctx.damage?.steadyMul ?? 1) ** 0.5;
    const pitch = d.recoil[0] * 0.012 * (0.85 + Math.random() * 0.3) * steady;
    const yaw = d.recoil[1] * 0.0065 * (Math.random() - 0.5) * 2 * steady;
    p.kick(pitch, yaw); hands.kick(pitch, yaw);
    const auto = mode() === 'auto' || mode() === 'burst';
    bloom = Math.min(d.moa * 3, bloom + d.moa * (auto ? 0.42 : 0.7) * fx.recoil);
    if (fx.flash >= 0.3) ctx.vfx.muzzleFlash(_m, _d, fx.flash);
    else { ctx.vfx.light(_m, 0xffb070, 1.5 + 3 * fx.flash, 0.05, 3); ctx.vfx.spark(_m, _d, 2, [1.0, 0.75, 0.4]); }
    if (d.recoil[0] > 2.5) ctx.post.shake(0.12);
    const own = 'shot_' + w.id, fb = SHOT_FALLBACK[d.cls] || SHOT_FALLBACK.rifle;
    audio.play(audio.has(own) ? own : fb[0], { pos: _m, gain: suppressed() ? 0.45 * fx.noise / 0.35 : 1, rate: (audio.has(own) ? 1 : fb[1]) * (suppressed() ? 0.88 : 1) });
    ctx.director.notify('shot', { pos: _m, noise });
    ctx.state.data.stats.shots++;
    ctx.events.emit('weaponFired', view);
    cool = 60 / d.rpm;
    if (isBolt()) { state = 'bolt'; timer = cycleTime(); stageDur = timer; cycleT = 0; cycleStep = 0; hands.playAnim('bolt', timer); audio.play('bolt_open', { gain: 0.7 }); }
    else if (isPump()) { state = 'pump'; timer = cycleTime(); stageDur = timer; cycleT = 0; cycleStep = 0; hands.playAnim('pump', timer); }
    else if (isBreak()) hands.playAnim('dry', 0.1);
    else { hands.playAnim('cycle', auto ? 0.08 : 0.1); ejectCasing(d.cal, mesh?.userData.ejectDir || [1, 0.5, 0.3]); }
    setLock(); refresh(true);
  }
  // bolt-action and pump cycles: eject mid-way, feed at the end
  function updateCycle(dt) {
    const d = def(), w = rec, T = stageDur || cycleTime();
    cycleT += dt;
    if (state === 'bolt') {
      if (cycleStep === 0 && cycleT > T * 0.41) { cycleStep = 1; ejectCasing(d.cal, mesh?.userData.ejectDir || [1, 0.7, 0.2]); }
      if (cycleStep === 1 && cycleT > T * 0.56) { cycleStep = 2; audio.play('bolt_close', { gain: 0.7 }); }
    } else {
      if (cycleStep === 0 && cycleT > T * 0.35) { cycleStep = 1; audio.play(snd('pump_back', 'bolt_open'), { gain: 0.75 }); ejectCasing(d.cal, mesh?.userData.ejectDir || [1, 0.5, 0.3], 0.8); }
      if (cycleStep === 1 && cycleT > T * 0.7) { cycleStep = 2; audio.play(snd('pump_forward', 'bolt_close'), { gain: 0.75 }); }
    }
    timer -= dt;
    if (timer <= 0) { if (!w.chamber) { if (isInternal()) w.chamber = w.tube.shift() || null; else if (w.mag && w.mag.rounds > 0) { w.mag.rounds--; w.chamber = w.mag.ammo; if (!w.mag.rounds) w.mag.ammo = null; } } state = 'idle'; timer = 0; stageDur = 0; setLock(); refresh(true); }
  }

  // ---- reload (R) ----
  function reload() {
    if (meleeHeld || !rec || busy > 0) return;
    const w = rec;
    if (state === 'jammed' && !stage) { state = 'jammed'; setStage('unjam', 1.2, 'unjam', 'unjam'); return; }
    if (state !== 'idle') return;
    if (isBreak()) return breakReload();
    if (isTube()) return tubeReload();
    if (isClip()) return clipReload();
    if (isBelt()) return beltReload();
    const best = inventory.bestMag(w);
    const cur = w.mag ? w.mag.rounds : 0;
    if (!best || best.rounds <= cur) {
      if (!w.chamber && cur > 0) { state = 'reloading'; setStage('chamber', 0.5, 'reload_chamber', 'chamber'); return; }
      refresh(true);
      if (cur < capacity() && inventory.ammoCount(def().cal) > 0) hud.hint('No fuller magazine carried. Load rounds with T.', 3000);
      else if (!best && cur === 0) hud.hint(`No loaded ${isBelt() ? 'belt box' : 'magazine'} carried.`, 2500);
      return;
    }
    pendingMag = best; reloadK = inventory.isReady(best.uid) ? 1 : 1.8;
    state = 'reloading';
    if (reloadK > 1) audio.play(snd('reload_dig', 'pickup_item'), { gain: 0.6, rate: 0.9 });
    setStage('magOut', 0.45 * reloadK, 'reload_magout', 'magOut', 0.45 * reloadK);
  }
  function returnMag(m) { if (m) inventory.addMag(m); }
  function takeMag(m) { if (!m) return null; if (inventory.magByUid(m.uid)) inventory.removeMag(m.uid); return m; }
  function beltReload() {
    const w = rec, best = inventory.bestMag(w), cur = w.mag ? w.mag.rounds : 0;
    if (!best || best.rounds <= cur) { if (!w.chamber && cur > 0) { state = 'reloading'; setStage('beltClose', 0.5, snd('belt_close', 'bolt_close'), 'coverClose'); return; } hud.hint(cur ? 'No fuller belt box carried.' : 'No belt box carried.', 2500); return; }
    pendingMag = best; reloadK = inventory.isReady(best.uid) ? 1 : 1.8; state = 'reloading';
    if (reloadK > 1) audio.play(snd('reload_dig', 'pickup_item'), { gain: 0.6, rate: 0.9 });
    setStage('coverOpen', 0.6, snd('belt_open', 'bolt_open'), 'coverOpen');
  }
  function clipReload() {
    const w = rec, d = def(), cap = d.internal || (w.mag ? MAGAZINES[w.mag.id].cap : MAGAZINES[d.defaultMag].cap), count = roundsIn();
    const pref = inventory.preferredAmmo(d.cal);
    let clip = null, cs = -1;
    for (const m of inventory.magsForWeapon(w)) { if (!MAGAZINES[m.id].clip || m.rounds <= 0) continue; const s = m.rounds + (inventory.isReady(m.uid) ? 100 : 0); if (s > cs) { cs = s; clip = m; } }
    const detachable = !d.internal && inventory.bestMag(w);
    if (detachable && !MAGAZINES[detachable.id].clip && detachable.rounds > count) {
      // SKS with a detachable box: swap like any magazine
      pendingMag = detachable; reloadK = inventory.isReady(detachable.uid) ? 1 : 1.8; state = 'reloading';
      setStage('magOut', 0.45 * reloadK, 'reload_magout', 'magOut', 0.45 * reloadK); return;
    }
    const typeOk = (id) => d.internal || !w.mag || w.mag.rounds === 0 || w.mag.ammo === id;
    if (count === 0 && clip && typeOk(clip.ammo)) { pendingMag = clip; state = 'reloading'; openAction(); stage = 'clipOpen'; return; }
    if (count < cap && inventory.count(pref) > 0 && typeOk(pref)) { shellsToLoad = Math.min(cap - count, inventory.count(pref)); state = 'reloading'; openAction(); stage = 'roundsOpen'; return; }
    if (!w.chamber && count > 0) { state = 'reloading'; openAction(); stage = 'cycleOpen'; return; }
    refresh(true);
    if (count > 0 && clip) hud.hint('Clips go in on an empty magazine. Load single rounds or shoot it dry.', 3000);
    else if (count < cap) hud.hint(`No loose ${CALIBERS[d.cal].short} carried.`, 2500);
  }
  function openAction() {
    // bolt guns lift and draw the bolt; the SKS locks its carrier back
    if (rec.chamber) { inventory.add(rec.chamber, 1); rec.chamber = null; }   // the chambered round comes out with the bolt
    if (isBolt()) setStage('open', 0.45, 'bolt_open', 'boltOpen'); else setStage('open', 0.4, 'reload_chamber', 'chamber');
  }
  function closeAction() { if (isBolt()) setStage('close', 0.5, 'bolt_close', 'boltClose'); else setStage('close', 0.4, 'reload_chamber', 'chamber'); }
  function feedFromBox() { const w = rec; if (w.chamber) return; if (isInternal()) w.chamber = w.tube.shift() || null; else if (w.mag && w.mag.rounds > 0) { w.mag.rounds--; w.chamber = w.mag.ammo; if (!w.mag.rounds) w.mag.ammo = null; } }
  function pushRound(id) { const w = rec, d = def(); if (d.internal) { w.tube.push(id); return; } if (!w.mag) { const m = inventory.magsForWeapon(w).find((x) => MAGAZINES[x.id].clip) || null; if (!m) { inventory.add(id, 1); return; } takeMag(m); w.mag = m; } w.mag.ammo = id; w.mag.rounds++; }
  function tubeReload() {
    const w = rec, d = def(), pref = inventory.preferredAmmo(d.cal), room = d.internal - w.tube.length;
    if (room > 0 && inventory.count(pref) > 0) { shellsToLoad = Math.min(room, inventory.count(pref)); state = 'reloading'; setStage('tubeStart', 0.3, null, 'tubeStart'); return; }
    if (!w.chamber && w.tube.length) { if (isPump()) { state = 'pump'; timer = cycleTime(); stageDur = timer; cycleT = 0; cycleStep = 1; hands.playAnim('pump', timer); audio.play(snd('pump_back', 'bolt_open'), { gain: 0.75 }); } else { state = 'reloading'; setStage('chamber', 0.4, 'reload_chamber', 'chamber'); } return; }
    refresh(true);
    if (room > 0) hud.hint('No 12 gauge shells carried.', 2500);
  }
  function breakReload() {
    const w = rec, d = def(), pref = inventory.preferredAmmo(d.cal);
    const need = d.internal - w.tube.length, loose = inventory.count(pref);
    if (need <= 0) { refresh(true); return; }
    if (loose <= 0 && spent <= 0) { refresh(true); hud.hint('No 12 gauge shells carried.', 2500); return; }
    shellsToLoad = Math.min(need, loose);
    state = 'breaking'; setStage('breakOpen', 0.5, 'break_open', 'breakOpen');
  }
  function advance() {
    const d = def(), w = rec;
    switch (stage) {
      // detachable magazines
      case 'magOut': { const old = w.mag; w.mag = null; returnMag(old); setLock(); setStage('magIn', 0.7 * reloadK, 'reload_magin', 'magIn', 0.7 * reloadK); break; }
      case 'magIn': {
        const m = pendingMag && (inventory.magByUid(pendingMag.uid) ? pendingMag : null); pendingMag = null;
        if (m) { takeMag(m); w.mag = m; }
        if (!w.chamber && w.mag && w.mag.rounds > 0) setStage('chamber', 0.5, 'reload_chamber', 'chamber'); else finish();
        break;
      }
      case 'chamber': feedFromBox(); hands.setSlideLock(false); finish(); break;
      // belt box (PKM): cover up, box off, box on, belt laid on the tray, cover down, charge
      case 'coverOpen': { const old = w.mag; w.mag = null; returnMag(old); setStage('boxOut', 0.5, 'reload_magout', 'boxOut'); break; }
      case 'boxOut': setStage('boxIn', 0.9 * reloadK, 'reload_magin', 'boxIn', 0.9 * reloadK); break;
      case 'boxIn': { const m = pendingMag && (inventory.magByUid(pendingMag.uid) ? pendingMag : null); pendingMag = null; if (m) { takeMag(m); w.mag = m; } setStage('beltLay', 0.7, snd('belt_lay', 'mag_load_round'), 'beltLay'); break; }
      case 'beltLay': setStage('beltClose', 0.5, snd('belt_close', 'bolt_close'), 'coverClose'); break;
      case 'beltClose': if (!w.chamber && w.mag && w.mag.rounds > 0) setStage('chamber', 0.5, 'reload_chamber', 'chamber'); else finish(); break;
      // clips and single rounds through an open action
      case 'clipOpen': { setStage('clipIn', 0.7, 'reload_magin', 'clipIn'); break; }
      case 'clipIn': {
        const c = pendingMag; pendingMag = null;
        if (c && inventory.magByUid(c.uid)) { const cap = d.internal || MAGAZINES[w.mag?.id || d.defaultMag].cap; const n = Math.min(c.rounds, cap - roundsIn()); for (let i = 0; i < n; i++) pushRound(c.ammo); c.rounds -= n; if (c.rounds === 0) c.ammo = null; ctx.events.emit('inventoryChanged', { id: c.id, delta: 0 }); }
        closeAction(); stage = 'closeFeed'; break;
      }
      case 'roundsOpen': setStage('round', 0.55, 'shell_insert', 'tubeShell'); break;
      case 'round': {
        const pref = inventory.preferredAmmo(d.cal);
        if (inventory.takeAmmo(pref, 1) > 0) pushRound(pref);
        shellsToLoad--;
        const cap = d.internal || MAGAZINES[w.mag?.id || d.defaultMag].cap;
        if (shellsToLoad > 0 && roundsIn() < cap && inventory.count(pref) > 0) setStage('round', 0.55, 'shell_insert', 'tubeShell'); else { closeAction(); stage = 'closeFeed'; }
        break;
      }
      case 'cycleOpen': closeAction(); stage = 'closeFeed'; break;
      case 'closeFeed': feedFromBox(); hands.setSlideLock(false); finish(); break;
      // tube shotguns: shell by shell through the loading port
      case 'tubeStart': setStage('tubeShell', 0.55, 'shell_insert', 'tubeShell'); break;
      case 'tubeShell': {
        const pref = inventory.preferredAmmo(d.cal);
        if (inventory.takeAmmo(pref, 1) > 0) w.tube.push(pref);
        shellsToLoad--;
        if (shellsToLoad > 0 && w.tube.length < d.internal && inventory.count(pref) > 0) setStage('tubeShell', 0.55, 'shell_insert', 'tubeShell'); else setStage('tubeEnd', 0.3, null, 'tubeEnd');
        break;
      }
      case 'tubeEnd':
        if (!w.chamber && w.tube.length) { if (isPump()) { stage = null; state = 'pump'; timer = cycleTime(); stageDur = timer; cycleT = 0; cycleStep = 0; hands.playAnim('pump', timer); refresh(true); } else setStage('chamber', 0.4, 'reload_chamber', 'chamber'); }
        else finish();
        break;
      // break-open
      case 'breakOpen':
        for (let i = 0; i < spent; i++) ejectCasing(d.cal, mesh?.userData.ejectDir || [0.3, 1, 0.9], 0.7);
        spent = 0;
        if (shellsToLoad > 0 && w.tube.length < d.internal) setStage('shell', 0.55, 'shell_insert', 'shellIn'); else setStage('breakClose', 0.4, 'break_close', 'breakClose');
        break;
      case 'shell': {
        const pref = inventory.preferredAmmo(d.cal);
        if (inventory.takeAmmo(pref, 1) > 0) w.tube.push(pref);
        shellsToLoad--;
        if (shellsToLoad > 0 && w.tube.length < d.internal && inventory.count(pref) > 0) setStage('shell', 0.55, 'shell_insert', 'shellIn'); else setStage('breakClose', 0.4, 'break_close', 'breakClose');
        break;
      }
      case 'breakClose': finish(); break;
      case 'unjam': w.jammed = false; w.dirt = Math.max(0, w.dirt - 0.05); finish(); break;
      // T: loose rounds into a magazine
      case 'loadStart': setStage('loadRound', 0.6, null, 'loadRound'); break;
      case 'loadRound': {
        const pref = inventory.preferredAmmo(d.cal), cap = loadTarget ? MAGAZINES[loadTarget.id].cap : 0;
        if (loadTarget && inventory.loadMag(loadTarget, pref, 1) > 0) audio.play('mag_load_round', { gain: 0.7, rate: 0.95 + Math.random() * 0.1 });
        if (loadTarget && loadTarget.rounds < cap && inventory.count(pref) > 0) setStage('loadRound', 0.6, null, 'loadRound'); else setStage('loadEnd', 0.3, null, 'loadEnd');
        break;
      }
      case 'loadEnd': finish(); break;
      // melee
      case 'qDraw': stab(true); break;
      case 'stab': if (quickReturn) { const back = quickReturn; quickReturn = null; meleeHeld = false; meleeInst = null; meleeView = null; mesh = back.mesh; hands.setWeaponMesh(mesh); setLock(); applyLights(); setStage('qReturn', 0.25, null, 'draw'); } else finish(); break;
      case 'qReturn': finish(); break;
      case 'open': case 'close': default: finish();
    }
  }
  // ---- T: loose rounds into the emptiest compatible magazine ----
  function beginLoad() {
    if (meleeHeld || !rec || busy > 0 || state !== 'idle') return;
    const d = def(), w = rec;
    if (isBreak() || isTube()) { hud.hint(`The ${d.name} has no magazine. Reload with R.`, 2500); return; }
    const pref = inventory.preferredAmmo(d.cal);
    if (inventory.count(pref) <= 0) { hud.hint(`No loose ${CALIBERS[d.cal].short} carried.`, 2500); return; }
    if (ctx.player.moving) { hud.hint('Stand still to load rounds.', 2000); return; }
    let best = null, bn = Infinity;
    for (const m of inventory.magsForWeapon(w)) { const cap = MAGAZINES[m.id].cap; if (m.rounds >= cap || (m.rounds > 0 && m.ammo !== pref)) continue; if (m.rounds < bn) { bn = m.rounds; best = m; } }
    if (!best && w.mag && !d.internal && w.mag.rounds < MAGAZINES[w.mag.id].cap && (w.mag.rounds === 0 || w.mag.ammo === pref)) best = w.mag;
    if (!best) { hud.hint(inventory.magsForWeapon(w).some((m) => m.rounds > 0 && m.ammo !== pref) ? 'Magazines hold a different type. Empty one first at the workbench.' : `All ${isClip() ? 'clips' : 'magazines'} full.`, 2500); return; }
    loadTarget = best; state = 'loading'; setStage('loadStart', 0.3, null, 'loadStart');
  }
  function cancelLoad() { if (stage === 'loadStart' || stage === 'loadRound') setStage('loadEnd', 0.3, null, 'loadEnd'); }
  function interruptShells() { if (stage === 'tubeShell' || stage === 'tubeStart') { shellsToLoad = 0; setStage('tubeEnd', 0.25, null, 'tubeEnd'); } }

  // ---- fire mode (B) ----
  function cycleMode() {
    if (!rec) return;
    const d = def();
    if (fx && fx.zoomLow && adsTarget) { zoomHigh = !zoomHigh; audio.play(snd('weapon_select', 'click'), { gain: 0.5, rate: 1.3 }); if (scopeShown) hud.setScope({ zoom: zoomNow(), reticle: fx.reticle }); return; }
    if (d.modes.length < 2) { audio.play('click', { gain: 0.35 }); return; }
    const i = d.modes.indexOf(mode());
    rec.fireMode = d.modes[(i + 1) % d.modes.length]; burstLeft = 0;
    audio.play(snd('weapon_select', 'click'), { gain: 0.6 }); hands.playAnim('selector', 0.22);
    refresh(true);
  }
  const zoomNow = () => (fx ? (fx.zoomLow && !zoomHigh ? fx.zoomLow : fx.zoom) : 1);
  // ---- weapon light / laser (L) ----
  function toggleLight() {
    if (!rec || !fx) return;
    const hasLight = fx.light > 0, hasLaser = !!fx.laser;
    if (!hasLight && !hasLaser) { audio.play('click', { gain: 0.35 }); hud.hint('Nothing mounted to switch on.', 2000); return; }
    const combos = [];
    combos.push([false, false]);
    if (hasLight) combos.push([true, false]);
    if (hasLight && hasLaser) combos.push([true, true]);
    if (hasLaser) combos.push([false, true]);
    const cur = combos.findIndex(([l, z]) => l === !!rec.lightOn && z === !!rec.laserOn);
    const [l, z] = combos[(cur + 1) % combos.length];
    rec.lightOn = l; rec.laserOn = z;
    audio.play(snd('light_click', 'click'), { gain: 0.55, rate: l || z ? 1.05 : 0.95 }); hands.playAnim('lightTap', 0.22);
    applyLights();
  }
  // ---- melee: the blade in the melee slot ----
  function stab(fromQuick = false) {
    if (!meleeHeld || !meleeInst) return;
    if (!fromQuick && (state !== 'idle' || busy > 0)) return;
    state = 'melee'; stabHit = false;
    setStage('stab', 0.6, snd('melee_swing', 'weapon_draw'), 'stab', 0.6, { gain: 0.55, rate: 1.3 });
  }
  function meleeHit() {
    const d = defOf(meleeInst.id), reach = 1.6, dmg = d?.damage || 30;
    ctx.camera.getWorldPosition(_o); ctx.camera.getWorldDirection(_d);
    const eh = ctx.enemies.raycast(_o, _d, reach);
    const wh = ctx.world.raycast(_o, _d, eh ? eh.distance : reach);
    if (eh && (!wh || eh.distance < wh.distance)) {
      const e = eh.enemy; _n.copy(_d).negate();
      const h01 = clamp01((eh.point.y - e.position.y) / (e.height || 1.8));
      e.damage(dmg * (h01 > 0.86 ? 1.5 : 1), { kind: 'melee', point: eh.point, dir: _d.clone(), h01, lateral01: 0.2, source: 'player', headshot: h01 > 0.86 });
      audio.play(snd('melee_hit', 'impact_ash'), { pos: eh.point, gain: 0.9, hrtf: true });
      ctx.vfx.impact(eh.point, _n, 'ash'); hands.kick(0.004, 0.002);
    } else if (wh) {
      audio.play('impact_' + ({ grass: 'dirt', mud: 'dirt', road: 'concrete', rock: 'concrete', concrete: 'concrete', metal: 'metal', wood: 'wood', water: 'water', glass: 'glass' }[wh.surface] || 'dirt'), { pos: wh.point, gain: 0.4, hrtf: true, rate: 0.8 });
      ctx.vfx.impact(wh.point, wh.normal, wh.surface === 'road' || wh.surface === 'rock' ? 'concrete' : wh.surface); hands.kick(0.006, 0.004);
    }
    ctx.state.data.stats.melee = (ctx.state.data.stats.melee || 0) + 1;
  }
  function quickMelee() {
    const g = meleeGear();
    if (!g) { audio.play('click', { gain: 0.35 }); hud.hint('No blade in the melee slot.', 2000); return; }
    if (meleeHeld) { stab(); return; }
    if (!rec) { equipSlot('melee'); return; }
    if (state !== 'idle' || busy > 0 || pendingHolster) return;
    adsTarget = 0; burstLeft = 0;
    quickReturn = { mesh };
    meleeInst = g; meleeView = makeMeleeView(g); meleeHeld = true;
    mesh = meleeMeshFor(g.id); hands.setWeaponMesh(mesh); hands.setSlideLock(false);
    ctx.lighting.setWeaponLight?.(false); hands.setLight(false); hands.setLaser(false);
    state = 'melee'; setStage('qDraw', 0.14, 'weapon_draw', 'quickDraw', 0.14, { gain: 0.5, rate: 1.4 });
  }

  const api = {
    get current() { return meleeHeld ? meleeView : view; },
    get adsBlend() { return adsBlend; }, get spreadDeg() { return spreadDeg; }, get state() { return state; }, get stage() { return stage; },
    get effects() { return fx; }, get bipod() { return bipodActive; }, get zoom() { return zoomNow(); },
    // fov ratio for look sensitivity (1 at hip, 1/zoom through a scope)
    get lookScale() { const s = ctx.state.data.settings; const base = s.fov || 75; return lastFov > 0 ? lastFov / base : 1; },
    equipSlot,
    holster() { if ((rec || meleeHeld) && !pendingHolster) { userHolstered = true; beginHolster(null); } },
    fire() { if (live()) tryFire(true); },
    reload() { if (live()) reload(); },
    loadMag() { if (live()) beginLoad(); },
    melee() { if (live()) quickMelee(); },
    cycleFireMode() { if (live()) cycleMode(); },
    toggleLight() { if (live()) toggleLight(); },
    // the workbench mutates the instance (cleaning, repair, parts): re-read it
    refresh() { if (rec) { recomputeFx(); if (!stage) state = rec.jammed ? 'jammed' : 'idle'; setLock(); applyLights(); } refresh(false); },
    // attachments changed: a fresh viewmodel for the current instance
    rebuild() {
      if (!rec) return;
      const sig = signature(rec); const old = meshes.get(sig);
      if (old) { meshes.delete(sig); if (old !== hands.weapon) old.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }
      recomputeFx(); mesh = meshFor(rec); meshSig = sig; hands.setWeaponMesh(mesh); setLock(); applyLights(); refresh(false);
    },
    onInventoryChanged() {
      if (meleeHeld && !quickReturn) {
        const g = meleeGear();
        if (g && meleeInst && g.uid === meleeInst.uid) { refresh(false); return; }
      } else if (rec) {
        const still = inventory.weaponByUid(rec.uid);
        if (still) {
          if (still !== rec) { rec = still; view = makeView(rec); }
          slotName = slotOf(rec) || slotName;
          recomputeFx();
          if (!stage) state = rec.jammed ? 'jammed' : state === 'jammed' ? 'idle' : state;
          if (!quickReturn && mesh && signature(rec) !== meshSig) api.rebuild();
          setLock(); applyLights(); refresh(false); return;
        }
      }
      pendingHolster = false; pendingSwitch = null; pendingSlot = null; api._nextMelee = null; quickReturn = null;
      if (!userHolstered) {
        for (const s of ['primary', 'secondary', 'sidearm']) { const w = inventory.weaponInSlot(s); if (w) { setCurrent(w, s); return; } }
        const g = meleeGear(); if (g) { setCurrent(null, 'melee', g); return; }
      }
      if (rec || meleeHeld || hands.weapon) setCurrent(null);
    },
    update(dt) {
      if (rec && !meleeHeld) { const still = inventory.weaponByUid(rec.uid); if (still !== rec) api.onInventoryChanged(); }
      const p = ctx.player, s = ctx.state.data.settings;
      cool = Math.max(0, cool - dt); busy = Math.max(0, busy - dt);
      // holster / switch completion
      if (pendingHolster && busy <= 0) { pendingHolster = false; const next = pendingSwitch, ns = pendingSlot, nm = api._nextMelee; pendingSwitch = null; pendingSlot = null; api._nextMelee = null; if (next) setCurrent(next, ns || slotOf(next)); else if (nm) setCurrent(null, 'melee', nm); else setCurrent(null); }
      // ---- input ----
      if (live() && !pendingHolster) {
        for (let i = 0; i < 4; i++) if (input.pressed('slot' + (i + 1))) equipSlot(i, true);
        if (input.pressed('holster')) api.holster();
        if (input.wheel !== 0 && !pendingHolster) {
          const dir = input.wheel > 0 ? 1 : -1, ci = slotName ? SLOT_ORDER.indexOf(slotName) : (dir > 0 ? -1 : 0);
          for (let k = 1; k <= 4; k++) { const name = SLOT_ORDER[(ci + dir * k + 8) % 4]; const has = name === 'melee' ? !!meleeGear() : !!inventory.weaponInSlot(name); if (has && name !== slotName) { equipSlot(name); break; } }
        }
        if (input.pressed('melee')) quickMelee();
        if (meleeHeld) { if (input.pressed('fire')) tryFire(true); adsTarget = 0; }
        else if (rec) {
          if (input.pressed('reload')) { if (state === 'loading') cancelLoad(); else reload(); }
          if (input.pressed('loadMag')) { if (state === 'loading') cancelLoad(); else beginLoad(); }
          if (input.pressed('fireMode')) cycleMode();
          if (input.pressed('weaponLight')) toggleLight();
          const m = mode();
          const wantFire = m === 'auto' ? input.down('fire') : input.pressed('fire');
          if (m === 'burst' && input.pressed('fire') && state === 'idle' && loaded()) burstLeft = 3;
          if (burstLeft > 0 && state === 'idle') { if (cool <= 0) { burstLeft--; tryFire(true); if (!loaded()) burstLeft = 0; } }
          else if (wantFire) { if (state === 'loading') cancelLoad(); else if (stage === 'tubeShell' || stage === 'tubeStart') interruptShells(); else tryFire(input.pressed('fire')); }
          if (state === 'loading' && (p.speed > 0.5 || input.pressed('aim'))) cancelLoad();
          adsTarget = input.down('aim') && state !== 'reloading' && state !== 'breaking' && state !== 'loading' && !p.sprinting && busy <= 0 ? 1 : 0;
        } else adsTarget = 0;
      } else adsTarget = 0;
      // ---- stage timers ----
      if (stage === 'stab' && !stabHit && timer <= stageDur - 0.35) { stabHit = true; meleeHit(); }
      if (stage && timer > 0) { timer -= dt; if (timer <= 0) advance(); }
      if (state === 'bolt' || state === 'pump') updateCycle(dt);
      // ---- ADS: blend, fov, scope overlay, sounds ----
      if (adsTarget !== adsSound) { adsSound = adsTarget; audio.play(adsTarget ? 'ads_in' : 'ads_out', { gain: 0.35 }); }
      const d = def();
      const adsRate = 11 * (fx ? fx.adsSpeed : 1) * (d ? lerp(0.75, 1.15, clamp01(d.ergo + (fx ? fx.ergo : 0))) : 1);
      adsBlend = damp(adsBlend, adsTarget, adsRate, dt);
      if (Math.abs(adsBlend - adsTarget) < 0.004) adsBlend = adsTarget;
      hands.adsBlend = adsBlend;
      const baseFov = s.fov || 75, zoom = zoomNow();
      const adsFov = zoom > 1.5 ? baseFov / zoom : baseFov * ADS_FOV_K;
      const fov = lerp(baseFov, adsFov, easeInOut(adsBlend));
      if (Math.abs(fov - lastFov) > 0.01) { ctx.camera.fov = fov; ctx.camera.updateProjectionMatrix(); lastFov = fov; }
      const wantScope = !!(rec && fx && fx.reticle && adsBlend > 0.75);
      if (wantScope !== scopeShown) { scopeShown = wantScope; hud.setScope(wantScope ? { zoom, reticle: fx.reticle } : null); }
      const wantNvg = !!(rec && fx && fx.nvOptic && adsBlend > 0.85);
      if (wantNvg !== nvgSet) { nvgSet = wantNvg; ctx.post.setNvg(wantNvg ? 1 : (ctx.gear?.nvgOn ? (ctx.gear.nvgGen || 1) : 0)); }
      // ---- bipod: crouched and still ----
      const wantBipod = !!(rec && fx && fx.prone && p.crouched && p.speed < 0.3 && state !== 'reloading');
      if (wantBipod !== bipodActive) { bipodActive = wantBipod; hands.bipod = wantBipod; statusExtra(); }
      // ---- spread ----
      const base = d ? d.moa * (fx ? fx.moa : 1) : 2;
      let mult = p.crouched ? 0.8 : 1;
      mult *= lerp(1, 0.5, adsBlend);
      mult *= lerp(1, 1.5, clamp01(p.speed / 3.6));
      if (ctx.state.data.stamina < 20) mult *= 1.4;
      if (ctx.damage) mult *= ctx.damage.steadyMul;
      if (rec && rec.laserOn && fx && fx.laser) mult *= lerp(0.7, 1, adsBlend);
      if (bipodActive) mult *= 0.8;
      if (rec && !meleeHeld) { const a = AMMO[isBreak() ? rec.tube[0] : rec.chamber]; if (a && a.accuracy) mult *= a.accuracy; }
      bloom = damp(bloom, 0, 4.5, dt);
      spreadDeg = base * mult + bloom;
      const px = Math.tan(spreadDeg * 0.5 * DEG) / Math.tan(fov * 0.5 * DEG) * (window.innerHeight * 0.5);
      hud.setSpread(clamp(px, 2, 260), adsBlend > 0.6);
      updateCasings(dt);
    },
  };
  ctx.events.on('inventoryChanged', () => api.onInventoryChanged());
  ctx.events.on('gameStart', () => { userHolstered = false; pendingHolster = false; pendingSwitch = null; pendingSlot = null; api._nextMelee = null; adsTarget = 0; bloom = 0; cool = 0; burstLeft = 0; spent = 0; });
  api.onInventoryChanged();
  return api;
}
