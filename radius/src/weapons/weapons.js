// Weapon state machine: equip/holster, semi/auto fire, spread and recoil, fouling and jams, staged reloads,
// bolt-action and break-open cycles, loose-round loading (T), ADS, HUD ammo readout, ejected casings.
// The inventory weapon record is the save data; it is mutated directly and re-resolved every frame.
import * as THREE from 'three';
import { WEAPON_DEFS } from '../player/inventory.js';
import { buildGun, casingGeometry, materials } from './gunmesh.js';
import { clamp, clamp01, damp, lerp, easeInOut, DEG } from '../core/math.js';

const ADS_FOV = 58;
const CASINGS = 24;
// per calibre: [diameter, length, r, g, b]
const CASE = { '9x18': [0.0095, 0.018, 0.78, 0.6, 0.3], '7.62x39': [0.011, 0.039, 0.72, 0.56, 0.28], '12ga': [0.02, 0.07, 0.5, 0.12, 0.08], '7.62x54': [0.0125, 0.053, 0.74, 0.58, 0.3] };

const _m = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const _mat = new THREE.Matrix4(), _sc = new THREE.Vector3(), _rq = new THREE.Quaternion(), _col = new THREE.Color();

export function createWeapons(ctx) {
  const { input, hands, inventory, hud, audio } = ctx;
  const meshes = new Map();
  let rec = null, view = null, slotIndex = -1;
  let state = 'idle', stage = null, timer = 0, cool = 0, busy = 0, boltT = 0, boltStep = 0;
  let adsTarget = 0, adsBlend = 0, bloom = 0, spreadDeg = 2, lastFov = 0, adsSound = 0;
  let pendingSwitch = null, pendingHolster = false;
  let bestMag = -1, shellsToLoad = 0, spentShells = 0, loadIdx = -1;
  let userHolstered = false;   // the player put the gun away on purpose (H, slot toggle, detector): inventory changes must not redraw it

  // ---- ejected casings: one instanced mesh, pooled ----
  const casingMesh = new THREE.InstancedMesh(casingGeometry(), materials().brass, CASINGS);
  casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  casingMesh.frustumCulled = false; casingMesh.castShadow = false; casingMesh.receiveShadow = true; casingMesh.name = 'casings';
  casingMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CASINGS * 3), 3);
  const casings = [];
  for (let i = 0; i < CASINGS; i++) {
    casings.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), t: 0, life: 0, sx: 0.01, sz: 0.02, live: false, rest: false });
    _sc.set(0, 0, 0); _mat.makeScale(0, 0, 0); casingMesh.setMatrixAt(i, _mat);
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

  // ---- helpers ----
  const live = () => ctx.mode === 'playing' && !ctx.panels.isOpen && !ctx.player.dead;
  const def = () => (rec ? WEAPON_DEFS[rec.id] : null);
  function meshFor(id) { if (!meshes.has(id)) meshes.set(id, buildGun(id)); return meshes.get(id); }
  function makeView(w) {
    return {
      def: WEAPON_DEFS[w.id], record: w,
      get id() { return w.id; }, get uid() { return w.uid; },
      get chamber() { return w.chamber; }, set chamber(v) { w.chamber = v; },
      get mags() { return w.mags; }, get magIndex() { return w.magIndex; }, set magIndex(v) { w.magIndex = v; },
      get dirt() { return w.dirt; }, set dirt(v) { w.dirt = v; },
      get jammed() { return w.jammed; }, set jammed(v) { w.jammed = v; },
      get state() { return state; }, get stage() { return stage; },
    };
  }
  function ammoHtml() {
    if (!rec) return '';
    const d = def(), w = rec, loose = inventory.ammoCount(d.ammo);
    let big, line;
    if (d.breakOpen) { big = `${w.mags[0]} / ${d.magSize}`; line = `${loose} shells`; }
    else {
      const mag = w.mags[w.magIndex] ?? 0;
      big = `${mag}${w.chamber ? '+1' : ''} / ${d.magSize}`;
      const spare = w.mags.filter((m, i) => i !== w.magIndex && m > 0).length;
      const noun = d.bolt ? (spare === 1 ? 'clip' : 'clips') : (spare === 1 ? 'mag' : 'mags');
      line = `<b>${spare}</b> ${noun} · ${loose} loose`;
    }
    let extra = '';
    if (w.jammed) extra = '<div class="jam">JAMMED</div>';
    else if (state === 'reloading' && stage && stage.startsWith('load')) extra = '<div class="state">loading magazine</div>';
    else if (state === 'reloading' || state === 'breaking') extra = '<div class="state">reloading</div>';
    else if (state === 'bolt') extra = '<div class="state">cycling</div>';
    return `<div class="big">${big}</div><div class="mags">${line}</div>${extra}`;
  }
  function refresh(show = true) { hud.setAmmo(ammoHtml()); if (show && rec) hud.showAmmo(); }
  function setLock() {
    const d = def(); if (!d || !rec) { hands.setSlideLock(false); return; }
    // only pistols with a slide stop hold open on empty; the AKM carrier runs forward on an empty magazine
    hands.setSlideLock(meshFor(rec.id).userData.cycle === 'slide' && rec.chamber === 0 && (rec.mags[rec.magIndex] ?? 0) === 0);
  }
  function setCurrent(w, i = -1) {
    rec = w || null; view = rec ? makeView(rec) : null; slotIndex = rec ? i : -1;
    state = rec && rec.jammed ? 'jammed' : 'idle'; stage = null; timer = 0;
    hands.setWeaponMesh(rec ? meshFor(rec.id) : null);
    if (rec) { hands.playAnim('draw', 0.35); busy = 0.35; audio.play('weapon_draw', { gain: 0.6 }); setLock(); }
    refresh(true);
  }
  function beginHolster(next = null, nextSlot = -1) {
    if (!rec) { if (next) setCurrent(next, nextSlot); return; }
    state = 'idle'; stage = null; timer = 0; adsTarget = 0;
    pendingSwitch = next; pendingHolster = true; busy = 0.28;
    hands.playAnim('holster', 0.28); audio.play('weapon_holster', { gain: 0.5 });
    api._nextSlot = nextSlot;
  }
  function slotOf(w) { for (let i = 0; i < 4; i++) if (inventory.slots[i] === w.uid) return i; return -1; }
  // the fullest magazine that is not the one in the gun
  function fullestOther(w) { let b = -1, n = -1; for (let i = 0; i < w.mags.length; i++) { if (i === w.magIndex) continue; if (w.mags[i] > n) { n = w.mags[i]; b = i; } } return b; }
  function emptiestNonFull(w, size) { let b = -1, n = Infinity; for (let i = 0; i < w.mags.length; i++) { if (i === w.magIndex || w.mags[i] >= size) continue; if (w.mags[i] < n) { n = w.mags[i]; b = i; } } if (b < 0 && w.mags[w.magIndex] < size) b = w.magIndex; return b; }
  function setStage(s, t, sound, anim, animT = t) { stage = s; timer = t; if (sound) audio.play(sound, { gain: 0.8 }); if (anim) hands.playAnim(anim, animT); refresh(true); }
  function finish() { state = rec && rec.jammed ? 'jammed' : 'idle'; stage = null; timer = 0; setLock(); refresh(true); }

  // ---- firing ----
  function dryFire() { audio.play('dry_click', { gain: 0.7 }); hands.playAnim('dry', 0.12); cool = 0.25; refresh(true); }
  function jam() {
    rec.jammed = true; state = 'jammed'; stage = null; timer = 0;
    audio.play('jam', { gain: 0.9 }); hands.playAnim('jam', 0.3);
    ctx.events.emit('weaponJammed', view); refresh(true);
    const f = ctx.state.data.flags; if (!f.jamHint) { f.jamHint = true; hud.hint('Committee advisory: a fouled action stops. Clear it (R). Strip and clean at the workbench.', 6000); }
  }
  function tryFire(edge) {
    if (!rec || busy > 0 || cool > 0) return;
    if (state === 'jammed' && !stage) { if (edge) dryFire(); return; }
    if (state !== 'idle') return;
    const d = def(), w = rec;
    const loaded = d.breakOpen ? w.mags[0] > 0 : w.chamber > 0;
    if (!loaded) { if (edge) dryFire(); return; }
    if (Math.random() < 0.18 * w.dirt * w.dirt * w.dirt) { jam(); return; }
    fire();
  }
  function fire() {
    const d = def(), w = rec, p = ctx.player;
    hands.muzzleWorld(_m);
    ctx.camera.getWorldPosition(_o); ctx.camera.getWorldDirection(_d);
    ctx.ballistics.shoot(_o, _d, { damage: d.damage, range: d.range, spreadDeg, pellets: d.pellets || 1, tracer: true, source: 'player', kind: 'bullet', shooter: p, tracerFrom: _m });
    // consume + cycle
    if (d.breakOpen) { w.mags[0]--; spentShells++; }
    else {
      w.chamber = 0;
      if (!d.bolt && w.mags[w.magIndex] > 0) { w.mags[w.magIndex]--; w.chamber = 1; }
    }
    w.dirt = Math.min(1, w.dirt + (d.breakOpen ? 0.02 : 0.012));
    // recoil: pitch up with a little random yaw; steadier when aiming or crouched
    const steady = lerp(1, 0.8, adsBlend) * (p.crouched ? 0.85 : 1);
    const pitch = d.recoil * 0.012 * (0.85 + Math.random() * 0.3) * steady;
    const yaw = d.recoil * 0.0065 * (Math.random() - 0.5) * 2 * steady;
    p.kick(pitch, yaw); hands.kick(pitch, yaw);
    bloom = Math.min(d.spread * 3, bloom + d.spread * (d.auto ? 0.42 : 0.7));
    ctx.vfx.muzzleFlash(_m, _d);
    if (d.recoil > 3) ctx.post.shake(0.12);
    audio.play('shot_' + w.id, { pos: _m, gain: 1 });
    ctx.director.notify('shot', { pos: _m });
    ctx.state.data.stats.shots++;
    ctx.events.emit('weaponFired', view);
    cool = 60 / d.rpm;
    if (d.bolt) { state = 'bolt'; timer = 1.1; boltT = 0; boltStep = 0; hands.playAnim('bolt', 1.1); audio.play('bolt_open', { gain: 0.7 }); }
    else if (!d.breakOpen) { hands.playAnim('cycle', d.auto ? 0.08 : 0.1); ejectCasing(d.ammo, meshFor(w.id).userData.ejectDir || [1, 0.5, 0.3]); }
    else hands.playAnim('dry', 0.1);
    setLock(); refresh(true);
  }

  // ---- reload ----
  function reload() {
    if (!rec || busy > 0) return;
    const d = def(), w = rec;
    if (state === 'jammed' && !stage) { setStage('unjam', 1.2, 'unjam', 'unjam'); return; }
    if (state !== 'idle') return;
    if (d.breakOpen) {
      const need = d.magSize - w.mags[0], loose = inventory.ammoCount(d.ammo);
      if (need <= 0) { refresh(true); return; }
      if (loose <= 0 && spentShells <= 0) { refresh(true); hud.hint('No 12 gauge shells carried.', 2500); return; }
      shellsToLoad = Math.min(need, loose);
      state = 'breaking'; setStage('breakOpen', 0.5, 'break_open', 'breakOpen');
      return;
    }
    bestMag = fullestOther(w);
    const better = bestMag >= 0 && w.mags[bestMag] > (w.mags[w.magIndex] ?? 0);
    if (!better) {
      if (w.chamber === 0 && (w.mags[w.magIndex] ?? 0) > 0) { state = 'reloading'; setStage('chamber', 0.5, d.bolt ? 'bolt_open' : 'reload_chamber', d.bolt ? 'boltOpen' : 'chamber'); if (d.bolt) { stage = 'mosinChamberOpen'; timer = 0.45; } return; }
      refresh(true);
      if ((w.mags[w.magIndex] ?? 0) < d.magSize && inventory.ammoCount(d.ammo) > 0) hud.hint(`No fuller ${d.bolt ? 'clip' : 'magazine'} carried. Load rounds with T.`, 3000);
      return;
    }
    state = 'reloading';
    if (d.bolt) { setStage('boltOpen', 0.45, 'bolt_open', 'boltOpen'); if (w.chamber > 0) { w.chamber = 0; inventory.addAmmo(d.ammo, 1); } }
    else setStage('magOut', 0.45, 'reload_magout', 'magOut');
  }
  function advance() {
    const d = def(), w = rec;
    switch (stage) {
      case 'magOut': setStage('magIn', 0.7, 'reload_magin', 'magIn'); break;
      case 'magIn':
        w.magIndex = bestMag;
        if (w.chamber === 0 && w.mags[w.magIndex] > 0) setStage('chamber', 0.5, 'reload_chamber', 'chamber'); else finish();
        break;
      case 'chamber': w.chamber = 1; w.mags[w.magIndex]--; hands.setSlideLock(false); finish(); break;
      case 'boltOpen': setStage('clipIn', 0.7, 'reload_magin', 'clipIn'); break;
      case 'clipIn': w.magIndex = bestMag; setStage('boltClose', 0.5, 'bolt_close', 'boltClose'); break;
      case 'mosinChamberOpen': setStage('boltClose', 0.5, 'bolt_close', 'boltClose'); break;
      case 'boltClose': if (w.chamber === 0 && w.mags[w.magIndex] > 0) { w.mags[w.magIndex]--; w.chamber = 1; } finish(); break;
      case 'breakOpen':
        for (let i = 0; i < spentShells; i++) ejectCasing(d.ammo, meshFor(w.id).userData.ejectDir || [0.3, 1, 0.9], 0.7);
        spentShells = 0;
        if (shellsToLoad > 0 && w.mags[0] < d.magSize) setStage('shell', 0.55, 'shell_insert', 'shellIn'); else setStage('breakClose', 0.4, 'break_close', 'breakClose');
        break;
      case 'shell':
        if (inventory.takeAmmo(d.ammo, 1) > 0) w.mags[0] = Math.min(d.magSize, w.mags[0] + 1);
        shellsToLoad--;
        if (shellsToLoad > 0 && w.mags[0] < d.magSize && inventory.ammoCount(d.ammo) > 0) setStage('shell', 0.55, 'shell_insert', 'shellIn'); else setStage('breakClose', 0.4, 'break_close', 'breakClose');
        break;
      case 'breakClose': finish(); break;
      case 'unjam': w.jammed = false; w.dirt = Math.max(0, w.dirt - 0.05); finish(); break;
      case 'loadStart': setStage('loadRound', 0.6, null, 'loadRound'); break;
      case 'loadRound':
        if (inventory.takeAmmo(d.ammo, 1) > 0) { w.mags[loadIdx]++; audio.play('mag_load_round', { gain: 0.7, rate: 0.95 + Math.random() * 0.1 }); }
        if (w.mags[loadIdx] < d.magSize && inventory.ammoCount(d.ammo) > 0) setStage('loadRound', 0.6, null, 'loadRound'); else setStage('loadEnd', 0.3, null, 'loadEnd');
        break;
      case 'loadEnd': finish(); break;
      default: finish();
    }
  }
  function beginLoad() {
    if (!rec || busy > 0 || state !== 'idle') return;
    const d = def(), w = rec;
    if (d.breakOpen) { hud.hint('The TOZ has no magazine. Reload with R.', 2500); return; }
    if (inventory.ammoCount(d.ammo) <= 0) { hud.hint(`No loose ${d.ammo.replace('x', '×')} carried.`, 2500); return; }
    if (ctx.player.moving) { hud.hint('Stand still to load rounds.', 2000); return; }
    loadIdx = emptiestNonFull(w, d.magSize);
    if (loadIdx < 0) { hud.hint(`All ${d.bolt ? 'clips' : 'magazines'} full.`, 2500); return; }
    state = 'reloading'; setStage('loadStart', 0.3, null, 'loadStart');
  }
  function cancelLoad() { if (stage === 'loadStart' || stage === 'loadRound') setStage('loadEnd', 0.3, null, 'loadEnd'); }

  // ---- equip ----
  // toggle: a second press of the slot that is already out puts the gun away (the keys); API callers get an idempotent equip
  function equipSlot(i, toggle = false) {
    const w = inventory.weaponInSlot(i);
    if (!w) return false;
    userHolstered = false;
    if (rec && rec.uid === w.uid) {
      if (pendingHolster) { pendingSwitch = w; api._nextSlot = i; }     // caught mid-holster: bring it back out
      else if (toggle) { userHolstered = true; beginHolster(null); }
      return true;
    }
    if (pendingHolster) { pendingSwitch = w; api._nextSlot = i; return true; }
    beginHolster(w, i);
    return true;
  }

  const api = {
    get current() { return view; },
    get adsBlend() { return adsBlend; }, get spreadDeg() { return spreadDeg; }, get state() { return state; }, get stage() { return stage; },
    equipSlot,
    holster() { if (rec && !pendingHolster) { userHolstered = true; beginHolster(null); } },
    fire() { if (live()) tryFire(true); },
    reload() { if (live()) reload(); },
    loadMag() { if (live()) beginLoad(); },
    onInventoryChanged() {
      if (rec) {
        const still = inventory.weaponByUid(rec.uid);
        if (still) {
          if (still !== rec) { rec = still; view = makeView(rec); }
          slotIndex = slotOf(rec);
          // the workbench or a cleaning kit may have cleared a stoppage (or a panel changed the loaded state)
          if (!stage) state = rec.jammed ? 'jammed' : state === 'jammed' ? 'idle' : state;
          setLock(); refresh(false); return;
        }
      }
      pendingHolster = false; pendingSwitch = null;
      if (!userHolstered) for (let i = 0; i < 4; i++) { const w = inventory.weaponInSlot(i); if (w) { setCurrent(w, i); return; } }
      if (rec || hands.weapon) setCurrent(null);
    },
    update(dt) {
      // the record lives in state.data; make sure ours is still the live one
      if (rec) { const still = inventory.weaponByUid(rec.uid); if (still !== rec) api.onInventoryChanged(); }
      const p = ctx.player, s = ctx.state.data.settings;
      cool = Math.max(0, cool - dt); busy = Math.max(0, busy - dt);
      // holster / switch completion
      if (pendingHolster && busy <= 0) { pendingHolster = false; const next = pendingSwitch; pendingSwitch = null; const ns = api._nextSlot ?? -1; api._nextSlot = -1; if (next) setCurrent(next, ns >= 0 ? ns : slotOf(next)); else setCurrent(null); }
      // ---- input ----
      if (live() && !pendingHolster) {
        for (let i = 0; i < 4; i++) if (input.pressed('slot' + (i + 1))) equipSlot(i, true);
        if (input.pressed('holster')) api.holster();
        if (input.wheel !== 0 && !pendingHolster) {
          const dir = input.wheel > 0 ? 1 : -1;
          for (let k = 1; k <= 4; k++) { const i = ((slotIndex < 0 ? (dir > 0 ? -1 : 0) : slotIndex) + dir * k + 8) % 4; const w = inventory.weaponInSlot(i); if (w && (!rec || w.uid !== rec.uid)) { equipSlot(i); break; } }
        }
        if (rec) {
          if (input.pressed('reload')) { if (stage && stage.startsWith('load')) cancelLoad(); else reload(); }
          if (input.pressed('loadMag')) { if (stage && stage.startsWith('load')) cancelLoad(); else beginLoad(); }
          const d = def();
          if (d.auto ? input.down('fire') : input.pressed('fire')) { if (stage && stage.startsWith('load')) cancelLoad(); else tryFire(input.pressed('fire')); }
          if ((stage === 'loadStart' || stage === 'loadRound') && (p.speed > 0.5 || input.pressed('aim'))) cancelLoad();
          adsTarget = input.down('aim') && state !== 'reloading' && state !== 'breaking' && !p.sprinting && busy <= 0 ? 1 : 0;
        } else adsTarget = 0;
      } else adsTarget = 0;
      // ---- stage timers ----
      if (stage && timer > 0) { timer -= dt; if (timer <= 0) advance(); }
      if (state === 'bolt') {
        boltT += dt;
        if (boltStep === 0 && boltT > 0.45) { boltStep = 1; ejectCasing(def().ammo, meshFor(rec.id).userData.ejectDir || [1, 0.7, 0.2]); }
        if (boltStep === 1 && boltT > 0.62) { boltStep = 2; audio.play('bolt_close', { gain: 0.7 }); }
        timer -= dt;
        if (timer <= 0) { const w = rec; if (w.mags[w.magIndex] > 0) { w.mags[w.magIndex]--; w.chamber = 1; } state = 'idle'; timer = 0; refresh(true); }
      }
      // ---- ADS: blend, fov, sounds ----
      if (adsTarget !== adsSound) { adsSound = adsTarget; audio.play(adsTarget ? 'ads_in' : 'ads_out', { gain: 0.35 }); }
      adsBlend = damp(adsBlend, adsTarget, 11, dt);
      if (Math.abs(adsBlend - adsTarget) < 0.004) adsBlend = adsTarget;
      hands.adsBlend = adsBlend;
      const baseFov = s.fov || 75;
      const fov = lerp(baseFov, ADS_FOV, easeInOut(adsBlend));
      if (Math.abs(fov - lastFov) > 0.01) { ctx.camera.fov = fov; ctx.camera.updateProjectionMatrix(); lastFov = fov; }
      // ---- spread ----
      const d = def();
      const base = d ? d.spread : 2;
      let mult = p.crouched ? 0.8 : 1;
      mult *= lerp(1, 0.5, adsBlend);
      mult *= lerp(1, 1.5, clamp01(p.speed / 3.6));
      if (ctx.state.data.stamina < 20) mult *= 1.4;
      bloom = damp(bloom, 0, 4.5, dt);
      spreadDeg = base * mult + bloom;
      const px = Math.tan(spreadDeg * 0.5 * DEG) / Math.tan(fov * 0.5 * DEG) * (window.innerHeight * 0.5);
      hud.setSpread(clamp(px, 2, 260), adsBlend > 0.6);
      updateCasings(dt);
    },
  };
  ctx.events.on('inventoryChanged', () => api.onInventoryChanged());
  ctx.events.on('gameStart', () => { userHolstered = false; pendingHolster = false; pendingSwitch = null; adsTarget = 0; bloom = 0; cool = 0; });
  api.onInventoryChanged();
  return api;
}
