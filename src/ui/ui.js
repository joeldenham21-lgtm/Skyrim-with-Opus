/**
 * WYRMHOLD — user interface.
 *
 * Main menu, the full settings panel (generated from the settings schema so a
 * new option only has to be declared once), the HUD, inventory, character
 * sheet, world map, journal, dialogue, trading, and the on-screen controls for
 * touch devices.
 */

import * as THREE from 'three';
import { settings, SCHEMA, PRESETS, PRESET_ORDER, BIND_LABELS, DEFAULT_BINDS } from '../core/settings.js';
import { SKILLS, PERKS } from '../game/stats.js';
import { ITEMS, SLOT } from '../game/items.js';
import { SPELLS } from '../game/combat.js';
import { QUESTS } from '../game/quests.js';
import { WORLD_SIZE, WORLD_HALF } from '../world/heightfield.js';
import { clamp, saturate, lerp, mod, TAU, clockString } from '../core/math.js';

// ---------------------------------------------------------------------------
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const on = (e, ev, fn) => { e.addEventListener(ev, fn); return e; };

const COMPASS_CARDS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];

export class UI {
  constructor(engine) {
    this.engine = engine;
    this.game = engine.game;
    this.player = engine.player;
    this.world = engine.world;
    this.audio = engine.audio;
    this.root = document.getElementById('ui-root');
    this.game.ui = this;

    this.panel = null;         // currently open full-screen panel
    this.menuOpen = false;
    this.dialogue = null;
    this.floaters = [];
    this.notices = [];
    this.hudHidden = false;
    this._invSel = null;
    this._journalSel = null;
    this._listening = null;
    this.mapPan = { x: 0, y: 0, zoom: 1 };

    this._buildHud();
    this._buildTouch();
    this._bindKeys();
    this.applyScale();
  }

  applyScale() {
    document.documentElement.style.setProperty('--ui-scale', String(settings.get('uiScale')));
    document.documentElement.style.setProperty('--hud-opacity', String(settings.get('hudOpacity')));
  }

  // =========================================================================
  // HUD
  // =========================================================================
  _buildHud() {
    const hud = el('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <div id="worldinfo"><div class="loc">—</div><div class="tm">—</div></div>
      <div id="compass"><div id="compass-strip"></div></div>
      <div id="compass-needle"></div>
      <div id="enemy-bar"><div class="name">—</div><div class="vital wide"><div class="fill"></div></div><div class="lvl"></div></div>
      <div id="crosshair"><div class="ch-arc"></div><div class="ch-dot"></div></div>
      <div id="stealth">Hidden</div>
      <div id="notices"></div>
      <div id="tracker"></div>
      <div id="interact"><span><span class="key">E</span><span class="txt">Use</span></span><span class="sub"></span></div>
      <div id="subtitles"></div>
      <div id="floaters"></div>
      <div id="dmg-vignette"></div>
      <div id="low-hp"></div>
      <div id="discover"><div class="d-t">—</div><div class="d-s">Location discovered</div></div>
      <div id="levelup"><div class="lu-in"><div class="lu-t">LEVEL UP</div></div></div>
      <div id="vitals">
        <div class="vital" id="v-magicka"><div class="ghost"></div><div class="fill"></div></div>
        <div class="vital wide" id="v-health"><div class="ghost"></div><div class="fill"></div></div>
        <div class="vital" id="v-stam"><div class="ghost"></div><div class="fill"></div></div>
      </div>
      <div id="quickbar"></div>
      <div id="perf"></div>
    `;
    this.root.appendChild(hud);
    this.hud = hud;
    this.$ = id => hud.querySelector(id);

    // compass strip: 720 px covering 360°, duplicated for wrap-around
    const strip = this.$('#compass-strip');
    for (let rep = -1; rep <= 1; rep++) {
      for (let deg = 0; deg < 360; deg += 15) {
        const t = el('div', 'cmp-tick');
        t.style.left = `${(deg + rep * 360) * 2}px`;
        strip.appendChild(t);
      }
      for (const [name, deg] of COMPASS_CARDS) {
        const c = el('div', 'cmp-card', name);
        c.style.left = `${(deg + rep * 360) * 2}px`;
        strip.appendChild(c);
      }
    }
    this._compassMarkers = [];

    // quick slots
    const qb = this.$('#quickbar');
    const icons = ['🧪', '🧴', '⚗️', '🍞'];
    for (let i = 0; i < 4; i++) {
      const s = el('div', 'qslot', `<span class="k">${i + 1}</span><span>${icons[i]}</span>`);
      s.style.pointerEvents = 'auto';
      on(s, 'click', () => this.game.useQuickSlot(i));
      qb.appendChild(s);
    }
    this._perf = this.$('#perf');
    this._perfT = 0;
  }

  _bindKeys() {
    this.engine.input.onKeyHook((code, e) => {
      if (this._listening) {
        if (code === 'Escape') { this._cancelBind(); return true; }
        settings.binds[this._listening.action] = code;
        settings.saveDeferred();
        this._listening.btn.textContent = this._keyName(code);
        this._listening.btn.classList.remove('listening');
        this._listening = null;
        return true;
      }
      if (this.dialogue) {
        if (code === 'Escape') { this.closeDialogue(); return true; }
        const n = parseInt(code.replace('Digit', ''), 10);
        if (n >= 1 && n <= 9) { this._pickDialogue(n - 1); return true; }
        return false;
      }
      if (code === settings.binds.menu) {
        if (this.panel) { this.closePanel(); return true; }
        if (this.menuOpen && this.game.started) { this.hideMainMenu(); return true; }
        if (!this.menuOpen) { this.showPauseMenu(); return true; }
        return true;
      }
      if (this.panel) {
        // let the panel's own hotkey close it
        if (code === settings.binds[this.panel.hotkey]) { this.closePanel(); return true; }
        return false;
      }
      if (this.menuOpen) return false;
      if (code === settings.binds.inventory) { this.openInventory(); return true; }
      if (code === settings.binds.map) { this.openMap(); return true; }
      if (code === settings.binds.journal) { this.openJournal(); return true; }
      if (code === settings.binds.stats) { this.openCharacter(); return true; }
      if (code === settings.binds.wait) { this.openRest(null); return true; }
      if (code === settings.binds.photo) { this.togglePhotoMode(); return true; }
      return false;
    });
  }

  _keyName(code) {
    if (!code) return '—';
    return code
      .replace('Key', '').replace('Digit', '').replace('Left', ' L').replace('Right', ' R')
      .replace('Mouse0', 'LMB').replace('Mouse1', 'MMB').replace('Mouse2', 'RMB')
      .replace('Shift', 'Shift').replace('Alt', 'Alt').replace('Control', 'Ctrl');
  }

  // =========================================================================
  // State helpers
  // =========================================================================
  isPaused() { return this.menuOpen || (!!this.panel && this.panel.pauses !== false) || !!this._restOpen; }
  capturesInput() { return this.menuOpen || !!this.panel || !!this.dialogue || !!this._restOpen; }
  anyPanelOpen() { return !!this.panel || !!this.dialogue || this.menuOpen; }
  dofStrength() {
    const mode = settings.get('dof');
    if (mode === 'off') return 0;
    if (mode === 'cinematic') return this.photoMode ? 1.0 : 0.55;
    return this.dialogue ? 0.9 : 0;
  }

  // =========================================================================
  // Main menu
  // =========================================================================
  showMainMenu() {
    if (this._menuEl) return;
    this.menuOpen = true;
    this.engine.input.exitPointerLock();
    const m = el('div');
    m.id = 'menu-root';
    const started = !!this.game.started;
    m.innerHTML = `
      <h1 class="menu-title">WYRMHOLD</h1>
      <div class="menu-sub">Crown of the North</div>
      <div class="menu-list"></div>
      <div class="menu-foot">v1.0 · procedural · no downloads · <span class="gold">${settings.gpuName || ''}</span></div>
    `;
    const list = m.querySelector('.menu-list');
    const add = (label, fn, disabled) => {
      const b = el('button', 'menu-item', label);
      if (disabled) b.disabled = true;
      on(b, 'click', () => { this.audio.resume(); this.audio.play('ui', { kind: 'accept' }); fn(); });
      list.appendChild(b);
      return b;
    };
    if (started) add('Continue', () => this.hideMainMenu());
    add(started ? 'New Game' : 'Begin', () => this.startGame());
    add('Load', () => this.openLoadMenu());
    add('Settings', () => this.openSettings());
    add('Controls', () => this.openSettings('Controls'));
    add('Credits', () => this.openCredits());
    this.root.appendChild(m);
    this._menuEl = m;
    this.hud.classList.add('hidden');
    this.audio.setMood('explore', 0.7);
  }

  hideMainMenu() {
    if (!this._menuEl) return;
    this._menuEl.remove();
    this._menuEl = null;
    this.menuOpen = false;
    this.hud.classList.remove('hidden');
    if (settings.effectivePlatform === 'desktop') this.engine.input.requestPointerLock();
  }

  showPauseMenu() {
    this.showMainMenu();
  }

  startGame() {
    this.audio.init();
    this.audio.resume();
    this.game.started = true;
    const hw = this.world.hf.loc('hearthwatch');
    this.player.spawn(hw.x + 30, hw.z + 46);
    this.player.yaw = Math.PI * 1.1;
    this.world.setTime(8.2, 1);
    this.game.stats.health = this.game.stats.maxHealth;
    this.hideMainMenu();
    this.notify('WYRMHOLD', 'The road to Hearthwatch', 'quest');
    if (settings.get('tutorials')) {
      setTimeout(() => this.notify('Find the Jarl', 'Speak with Jarl Halvard in Hearthwatch', 'quest'), 3500);
    }
    this.audio.setMood('explore', 1);
  }

  openCredits() {
    this.openPanel('The Making Of', [{ name: 'Credits' }], () => {
      const w = el('div');
      w.innerHTML = `
        <div class="group"><div class="group-title">Wyrmhold</div>
        <p class="muted" style="line-height:1.8;font-size:14px;max-width:720px">
        Every mountain, tree, texture, sound and note of music in this game is generated at runtime.
        There are no image files, no models, no audio files — only code.<br><br>
        <b class="gold">Terrain</b> — eroded fractal noise carved by rivers, roads and settlement pads, streamed as a distance-driven quadtree.<br>
        <b class="gold">Materials</b> — 24 procedural PBR sets baked on the GPU at boot into seamless albedo / ORM / normal maps.<br>
        <b class="gold">Sky</b> — Rayleigh and Mie single scattering, raymarched volumetric clouds, a star field, two moons and an aurora, re-projected into the world's image-based lighting every few frames.<br>
        <b class="gold">Rendering</b> — HDR forward pass, cascaded shadows, SSAO, screen-space reflections, volumetric fog, temporal anti-aliasing with upscaling, physically-scaled bloom and an AgX film transform.<br>
        <b class="gold">Animation</b> — no keyframes: every gait, swing and stagger is a blended pose generator.<br>
        <b class="gold">Audio</b> — synthesised on the fly, including the adaptive score.<br><br>
        Built with three.js. Play well.
        </p></div>`;
      return w;
    });
  }

  openLoadMenu() {
    this.openPanel('Load Game', [{ name: 'Saves' }], () => {
      const w = el('div', 'group');
      for (const s of this.game.listSaves()) {
        const row = el('div', 'row');
        const when = s.empty ? '—' : new Date(s.time).toLocaleString();
        row.innerHTML = `<div class="row-label">${s.slot === 'auto' ? 'Autosave' : 'Slot ' + s.slot}
          <small>${s.empty ? 'Empty' : `Level ${s.level} · Day ${s.day}, ${clockString(s.hour)} · ${when}`}</small></div>`;
        const ctl = el('div', 'row-ctl');
        const bl = el('button', 'btn small', 'Load');
        bl.disabled = s.empty;
        on(bl, 'click', () => {
          if (this.game.load(s.slot)) {
            this.game.started = true;
            this.closePanel(); this.hideMainMenu();
            this.notify('Loaded', '', 'quest');
          }
        });
        const bs = el('button', 'btn small', 'Save Here');
        on(bs, 'click', () => { this.game.save(s.slot); this.closePanel(); this.openLoadMenu(); });
        ctl.appendChild(bl); ctl.appendChild(bs);
        row.appendChild(ctl);
        w.appendChild(row);
      }
      return w;
    });
  }

  // =========================================================================
  // Generic panel
  // =========================================================================
  openPanel(title, tabs, renderTab, opts = {}) {
    this.closePanel();
    const scrim = el('div', 'panel-scrim');
    const panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    head.appendChild(el('h2', null, title));
    const tabBar = el('div', 'panel-tabs');
    head.appendChild(tabBar);
    const close = el('button', 'btn small', 'Close');
    on(close, 'click', () => this.closePanel());
    head.appendChild(close);
    const body = el('div', 'panel-body');
    const foot = el('div', 'panel-foot');
    foot.appendChild(el('div', 'hint', opts.hint || 'Esc to close'));
    if (opts.footRight) foot.appendChild(opts.footRight);
    panel.appendChild(head); panel.appendChild(body); panel.appendChild(foot);
    scrim.appendChild(panel);
    this.root.appendChild(scrim);

    let active = opts.activeTab || tabs[0].name;
    const renderNow = () => {
      body.innerHTML = '';
      const content = renderTab(active, body);
      if (content) body.appendChild(content);
      for (const b of tabBar.children) b.classList.toggle('active', b.textContent === active);
    };
    for (const t of tabs) {
      const b = el('button', 'tab', t.name);
      on(b, 'click', () => { active = t.name; this.audio.play('ui', { kind: 'move' }); renderNow(); });
      tabBar.appendChild(b);
    }
    renderNow();

    this.panel = { scrim, body, renderNow, hotkey: opts.hotkey, pauses: opts.pauses !== false };
    this.engine.input.exitPointerLock();
    on(scrim, 'mousedown', e => { if (e.target === scrim) this.closePanel(); });
    return this.panel;
  }

  closePanel() {
    if (!this.panel) return;
    this.panel.scrim.remove();
    this.panel = null;
    this.audio.play('ui', { kind: 'back' });
    if (!this.menuOpen && !this.dialogue && settings.effectivePlatform === 'desktop') {
      this.engine.input.requestPointerLock();
    }
  }

  // =========================================================================
  // Settings
  // =========================================================================
  openSettings(startTab) {
    const tabs = [];
    for (const g of SCHEMA) if (!tabs.find(t => t.name === g.tab)) tabs.push({ name: g.tab });

    const reset = el('button', 'btn small danger', 'Reset All');
    on(reset, 'click', () => {
      settings.resetAll();
      this.engine.onSettingChanged('*');
      this.panel.renderNow();
    });

    this.openPanel('Settings', tabs, (tab) => {
      const wrap = el('div');
      for (const group of SCHEMA) {
        if (group.tab !== tab) continue;
        const gEl = el('div', 'group');
        gEl.appendChild(el('div', 'group-title', group.title));
        for (const item of group.items) gEl.appendChild(this._settingRow(item));
        wrap.appendChild(gEl);
      }
      return wrap;
    }, { activeTab: startTab, hint: 'Changes apply immediately and are saved', footRight: reset, hotkey: null });
  }

  _settingRow(item) {
    if (item.key === '__keybinds') return this._keybindRows();
    if (item.type === 'preset') return this._presetCards();

    const row = el('div', 'row');
    if (item.showIf && !item.showIf(settings)) row.classList.add('disabled');
    const label = el('div', 'row-label');
    label.innerHTML = `${item.label}${item.tip ? `<small>${item.tip}</small>` : ''}`;
    row.appendChild(label);
    const ctl = el('div', 'row-ctl');
    const change = (v) => {
      settings.set(item.key, v);
      this.engine.onSettingChanged(item.key);
      this.applyScale();
      if (item.showIf || item.type === 'select') setTimeout(() => this.panel?.renderNow(), 0);
    };

    switch (item.type) {
      case 'toggle': {
        const sw = el('div', 'switch' + (settings.get(item.key) ? ' on' : ''));
        on(sw, 'click', () => {
          const v = !settings.get(item.key);
          sw.classList.toggle('on', v);
          change(v);
          this.audio.play('ui', { kind: 'move' });
        });
        ctl.appendChild(sw);
        break;
      }
      case 'slider': {
        const val = el('div', 'row-val', item.fmt ? item.fmt(settings.get(item.key)) : String(settings.get(item.key)));
        const inp = el('input');
        inp.type = 'range'; inp.min = item.min; inp.max = item.max; inp.step = item.step;
        inp.value = settings.get(item.key);
        on(inp, 'input', () => {
          const v = Number(inp.value);
          val.textContent = item.fmt ? item.fmt(v) : String(v);
          change(v);
        });
        ctl.appendChild(inp);
        ctl.appendChild(val);
        break;
      }
      case 'select': {
        const seg = el('div', 'seg');
        for (const [v, lab] of item.options) {
          const b = el('button', settings.get(item.key) === v ? 'active' : '', lab);
          on(b, 'click', () => { change(v); this.audio.play('ui', { kind: 'move' }); });
          seg.appendChild(b);
        }
        ctl.appendChild(seg);
        break;
      }
      case 'action': {
        const b = el('button', 'btn small', item.btn || 'Go');
        on(b, 'click', () => {
          if (item.action === 'fullscreen') {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen?.().catch(() => { });
          }
        });
        ctl.appendChild(b);
        break;
      }
    }
    row.appendChild(ctl);
    return row;
  }

  _presetCards() {
    const wrap = el('div');
    const cards = el('div', 'preset-cards');
    for (const key of PRESET_ORDER) {
      const p = PRESETS[key];
      const c = el('button', 'preset-card' + (settings.get('preset') === key ? ' active' : ''),
        `<b>${p.label}</b><span>${p.blurb}</span>`);
      on(c, 'click', () => {
        settings.applyPreset(key);
        this.engine.onSettingChanged('preset');
        this.audio.play('ui', { kind: 'accept' });
        this.panel.renderNow();
      });
      cards.appendChild(c);
    }
    wrap.appendChild(cards);
    const note = el('div', 'row');
    note.innerHTML = `<div class="row-label muted" style="flex:1 1 100%">
      Current: <b class="gold">${settings.get('preset') === 'custom' ? 'Custom' : PRESETS[settings.get('preset')]?.label}</b>
      · Detected device tier: <b class="gold">${PRESETS[settings.deviceTier]?.label || settings.deviceTier}</b>
      · GPU: <b class="gold">${settings.gpuName || 'unknown'}</b>
      <small>Adjusting any option below switches the preset to Custom. Nothing is lost — presets just fill in every value at once.</small></div>`;
    wrap.appendChild(note);
    return wrap;
  }

  _keybindRows() {
    const wrap = el('div');
    for (const [action, label] of Object.entries(BIND_LABELS)) {
      const row = el('div', 'row');
      row.appendChild(el('div', 'row-label', label));
      const ctl = el('div', 'row-ctl');
      const b = el('button', 'keybind', this._keyName(settings.binds[action]));
      on(b, 'click', () => {
        if (this._listening) this._cancelBind();
        this._listening = { action, btn: b };
        b.classList.add('listening');
        b.textContent = 'Press a key…';
      });
      ctl.appendChild(b);
      const r = el('button', 'btn small', 'Default');
      on(r, 'click', () => {
        settings.binds[action] = DEFAULT_BINDS[action];
        settings.saveDeferred();
        b.textContent = this._keyName(settings.binds[action]);
      });
      ctl.appendChild(r);
      row.appendChild(ctl);
      wrap.appendChild(row);
    }
    return wrap;
  }
  _cancelBind() {
    if (!this._listening) return;
    this._listening.btn.classList.remove('listening');
    this._listening.btn.textContent = this._keyName(settings.binds[this._listening.action]);
    this._listening = null;
  }

  // =========================================================================
  // Inventory
  // =========================================================================
  openInventory() {
    const g = this.game;
    const cats = [
      { name: 'All', f: () => true },
      { name: 'Weapons', f: d => d.type === 'weapon' || d.type === 'shield' },
      { name: 'Apparel', f: d => d.type === 'armor' },
      { name: 'Potions', f: d => d.type === 'potion' || d.type === 'food' },
      { name: 'Books', f: d => d.type === 'book' },
      { name: 'Misc', f: d => ['ingredient', 'material', 'ammo', 'tool', 'quest'].includes(d.type) },
    ];
    this.openPanel('Inventory', cats, (tab) => {
      const cat = cats.find(c => c.name === tab);
      const wrap = el('div', 'inv-wrap');
      const list = el('div', 'inv-list');
      const detail = el('div', 'inv-detail');

      const entries = g.inventory.items.filter(e => cat.f(ITEMS[e.id]));
      entries.sort((a, b) => ITEMS[a.id].name.localeCompare(ITEMS[b.id].name));
      if (!entries.length) list.appendChild(el('div', 'muted', 'Nothing here.'));

      const showDetail = (e) => {
        detail.innerHTML = '';
        if (!e) return;
        const d = ITEMS[e.id];
        detail.appendChild(el('h3', null, d.name));
        detail.appendChild(el('div', 'type', `${d.type}${d.slot ? ' · ' + d.slot : ''}`));
        if (d.desc) detail.appendChild(el('div', 'desc', d.desc));
        const stat = (k, v, cls) => {
          const s = el('div', 'stat-line');
          s.innerHTML = `<span>${k}</span><b class="${cls || ''}">${v}</b>`;
          detail.appendChild(s);
        };
        if (d.damage) stat('Damage', d.damage);
        if (d.armor) stat('Armour', d.armor);
        if (d.block) stat('Block', `${Math.round(d.block * 100)}%`);
        if (d.speed) stat('Speed', d.speed.toFixed(2));
        if (d.reach) stat(d.ranged ? 'Range' : 'Reach', `${d.reach} m`);
        if (d.enchant) stat('Enchantment', `${d.enchant.element} ${d.enchant.power}`);
        if (d.bonus) for (const [k, v] of Object.entries(d.bonus)) stat(SKILLS[k]?.name || k, `+${v}`, 'up');
        stat('Weight', d.weight);
        stat('Value', `${d.value} 🪙`);
        stat('Quantity', e.qty);

        const acts = el('div', 'inv-actions');
        if (d.slot) {
          const b = el('button', 'btn small primary', g.inventory.isEquipped(e.uid) ? 'Unequip' : 'Equip');
          on(b, 'click', () => { g.inventory.equip(e.uid); this.panel.renderNow(); });
          acts.appendChild(b);
        }
        if (d.use || d.text) {
          const b = el('button', 'btn small primary', d.text ? 'Read' : 'Use');
          on(b, 'click', () => { g.useItem(e); this.panel.renderNow(); });
          acts.appendChild(b);
        }
        if (!d.quest) {
          const b = el('button', 'btn small danger', 'Drop');
          on(b, 'click', () => { g.inventory.remove(e.uid, 1); this.panel.renderNow(); });
          acts.appendChild(b);
        }
        detail.appendChild(acts);
      };

      for (const e of entries) {
        const d = ITEMS[e.id];
        const row = el('div', 'inv-item' + (g.inventory.isEquipped(e.uid) ? ' equipped' : ''));
        row.innerHTML = `<span class="ic">${d.icon || '▪'}</span><span class="nm">${d.name}</span>
          <span class="qt">${e.qty > 1 ? '×' + e.qty : ''}</span>
          <span class="wt">${(d.weight * e.qty).toFixed(1)}</span>
          <span class="vl">${d.value * e.qty}</span>`;
        on(row, 'click', () => {
          for (const c of list.children) c.classList.remove('sel');
          row.classList.add('sel');
          showDetail(e);
        });
        on(row, 'dblclick', () => { if (d.slot) g.inventory.equip(e.uid); else g.useItem(e); this.panel.renderNow(); });
        list.appendChild(row);
      }
      if (entries.length) { list.children[0].classList.add('sel'); showDetail(entries[0]); }
      wrap.appendChild(list); wrap.appendChild(detail);
      return wrap;
    }, {
      hotkey: 'inventory',
      hint: `Carrying <b class="${g.inventory.overEncumbered ? 'carry over' : 'carry'}">${g.inventory.weight.toFixed(1)} / ${g.inventory.capacity}</b> · Gold <b class="gold">${g.inventory.gold} 🪙</b>`,
    });
  }
  refreshInventory() { if (this.panel && this.panel.hotkey === 'inventory') this.panel.renderNow(); }

  // =========================================================================
  // Character sheet
  // =========================================================================
  openCharacter() {
    const g = this.game, st = g.stats;
    this.openPanel('Character', [{ name: 'Skills' }, { name: 'Perks' }, { name: 'Magic' }, { name: 'Effects' }], (tab) => {
      const wrap = el('div');
      if (tab === 'Skills') {
        const head = el('div', 'group');
        head.appendChild(el('div', 'group-title', `Level ${st.level} · ${Math.round(st.xp)} / ${st.xpNext} XP`));
        const bar = el('div', 'skill-bar');
        bar.innerHTML = `<i style="width:${saturate(st.xp / st.xpNext) * 100}%"></i>`;
        head.appendChild(bar);
        wrap.appendChild(head);

        if (st.perkPoints > 0) {
          const box = el('div', 'group');
          box.appendChild(el('div', 'group-title', `Level-up: choose an attribute (${st.perkPoints} perk point${st.perkPoints > 1 ? 's' : ''} available)`));
          const row = el('div', 'row');
          const ctl = el('div', 'row-ctl');
          for (const [k, label] of [['health', '+12 Health'], ['stamina', '+12 Stamina'], ['magicka', '+12 Magicka']]) {
            const b = el('button', 'btn small primary', label);
            on(b, 'click', () => { st.chooseAttribute(k); st.perkPoints--; this.audio.play('levelUp'); this.panel.renderNow(); });
            ctl.appendChild(b);
          }
          row.appendChild(ctl);
          box.appendChild(row);
          wrap.appendChild(box);
        }

        const grid = el('div', 'stat-grid');
        for (const [k, s] of Object.entries(SKILLS)) {
          const lvl = st.skills[k];
          const need = 8 + lvl * 1.9;
          const card = el('div', 'skill-card');
          card.innerHTML = `<div class="sn"><span>${s.icon} ${s.name}</span><b>${lvl}</b></div>
            <div class="skill-bar"><i style="width:${saturate(st.skillXp[k] / need) * 100}%"></i></div>
            <div class="muted" style="font-size:11.5px;margin-top:7px">${s.desc}</div>`;
          grid.appendChild(card);
        }
        wrap.appendChild(grid);

        const vitals = el('div', 'group');
        vitals.appendChild(el('div', 'group-title', 'Vitals'));
        for (const [label, cur, max] of [['Health', st.health, st.maxHealth], ['Stamina', st.stamina, st.maxStamina], ['Magicka', st.magicka, st.maxMagicka]]) {
          const r = el('div', 'row');
          r.innerHTML = `<div class="row-label">${label}</div><div class="row-ctl"><b class="gold">${Math.round(cur)} / ${Math.round(max)}</b></div>`;
          vitals.appendChild(r);
        }
        const r = el('div', 'row');
        r.innerHTML = `<div class="row-label">Armour Rating</div><div class="row-ctl"><b class="gold">${Math.round(st.armorRating)}</b></div>`;
        vitals.appendChild(r);
        wrap.appendChild(vitals);

      } else if (tab === 'Perks') {
        const box = el('div', 'group');
        box.appendChild(el('div', 'group-title', `Perk points: ${st.perkPoints}`));
        for (const p of PERKS) {
          const owned = st.hasPerk(p.id);
          const can = !owned && st.perkPoints > 0 && st.skills[p.skill] >= p.req;
          const locked = !owned && st.skills[p.skill] < p.req;
          const d = el('div', 'perk' + (owned ? ' owned' : locked ? ' locked' : ''));
          d.innerHTML = `<div class="pi">${p.icon}</div><div><b>${p.name}</b>
            <span>${p.desc}<br><span class="muted">${SKILLS[p.skill].name} ${p.req}${owned ? ' · owned' : ''}</span></span></div>`;
          if (can) on(d, 'click', () => { if (st.takePerk(p.id)) { this.audio.play('levelUp'); this.panel.renderNow(); } });
          box.appendChild(d);
        }
        wrap.appendChild(box);

      } else if (tab === 'Magic') {
        const box = el('div', 'group');
        box.appendChild(el('div', 'group-title', 'Known spells — click to equip'));
        for (const id of g.knownSpells) {
          const sp = SPELLS[id];
          const d = el('div', 'perk' + (g.currentSpell === id ? ' owned' : ''));
          d.innerHTML = `<div class="pi">${sp.icon}</div><div><b>${sp.name}</b>
            <span>${sp.desc}<br><span class="muted">${sp.school} · ${sp.cost} magicka${sp.stream ? ' / sec' : ''}</span></span></div>`;
          on(d, 'click', () => { g.currentSpell = id; this.audio.play('ui', { kind: 'accept' }); this.panel.renderNow(); });
          box.appendChild(d);
        }
        wrap.appendChild(box);

      } else {
        const box = el('div', 'group');
        box.appendChild(el('div', 'group-title', 'Active effects'));
        if (!st.effects.length) box.appendChild(el('div', 'muted', 'None.'));
        for (const e of st.effects) {
          const r = el('div', 'row');
          r.innerHTML = `<div class="row-label">${e.id || e.type}</div>
            <div class="row-ctl"><b class="gold">${e.dur.toFixed(0)}s</b></div>`;
          box.appendChild(r);
        }
        if (g.bounty > 0) {
          const r = el('div', 'row');
          r.innerHTML = `<div class="row-label">Bounty</div><div class="row-ctl"><b class="gold">${g.bounty} 🪙</b></div>`;
          box.appendChild(r);
        }
        wrap.appendChild(box);
      }
      return wrap;
    }, { hotkey: 'stats' });
  }

  // =========================================================================
  // Journal
  // =========================================================================
  openJournal() {
    const g = this.game;
    this.openPanel('Journal', [{ name: 'Active' }, { name: 'Completed' }], (tab) => {
      const wrap = el('div', 'jr-wrap');
      const list = el('div', 'jr-list');
      const detail = el('div', 'jr-detail');
      const items = Object.keys(QUESTS).map(id => ({ id, s: g.quests.state(id), d: QUESTS[id] }))
        .filter(q => q.s.started && (tab === 'Active' ? !q.s.done : q.s.done));
      if (!items.length) list.appendChild(el('div', 'muted', tab === 'Active' ? 'No active quests.' : 'Nothing completed yet.'));

      const show = (q) => {
        detail.innerHTML = '';
        detail.appendChild(el('h3', null, q.d.name));
        detail.appendChild(el('div', 'jd', q.d.blurb));
        q.d.stages.forEach((stage, i) => {
          if (i > q.s.stage) return;
          for (const o of stage.objectives) {
            const done = i < q.s.stage || q.s.done;
            const c = o.count ? ` (${Math.min(o.count, q.s.counters[o.id] || 0)}/${o.count})` : '';
            detail.appendChild(el('div', 'jr-obj' + (done ? ' done' : ''), o.text + c));
          }
        });
        if (!q.s.done) {
          const b = el('button', 'btn small primary', g.quests.tracked === q.id ? 'Tracked' : 'Track');
          on(b, 'click', () => { g.quests.tracked = q.id; this.refreshTracker(); this.panel.renderNow(); });
          detail.appendChild(el('div', null, '')).appendChild(b);
        }
      };

      for (const q of items) {
        const r = el('div', 'jr-q' + (q.s.done ? ' done' : ''));
        r.innerHTML = `${q.d.name}<small>${q.d.main ? 'Main Quest' : 'Side Quest'}</small>`;
        on(r, 'click', () => {
          for (const c of list.children) c.classList.remove('sel');
          r.classList.add('sel'); show(q);
        });
        list.appendChild(r);
      }
      if (items.length) { list.children[0].classList.add('sel'); show(items[0]); }
      wrap.appendChild(list); wrap.appendChild(detail);
      return wrap;
    }, { hotkey: 'journal' });
  }
  refreshJournal() { if (this.panel && this.panel.hotkey === 'journal') this.panel.renderNow(); this.refreshTracker(); }

  // =========================================================================
  // Map
  // =========================================================================
  _buildMapCanvas() {
    if (this._mapCanvas) return this._mapCanvas;
    const N = 512;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    const hf = this.world.hf;
    const step = WORLD_SIZE / (N - 1);
    const sun = [-0.55, 0.62, -0.55];
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * step;
        const h = hf.fastHeight(x, z);
        const hl = hf.fastHeight(x - step, z), hr = hf.fastHeight(x + step, z);
        const hd = hf.fastHeight(x, z - step), hu = hf.fastHeight(x, z + step);
        let nx = hl - hr, ny = 2 * step, nz = hd - hu;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const lam = saturate(nx * sun[0] + ny * sun[1] + nz * sun[2]) * 0.85 + 0.22;

        let r, g, b;
        const w = hf.waterAt(x, z);
        if (w !== null && h < w) {
          const d = saturate((w - h) / 25);
          r = lerp(46, 12, d); g = lerp(86, 30, d); b = lerp(104, 52, d);
        } else if (h > 300) { const t = saturate((h - 300) / 220); r = lerp(150, 232, t); g = lerp(155, 238, t); b = lerp(162, 246, t); }
        else if (h > 170) { const t = saturate((h - 170) / 130); r = lerp(104, 150, t); g = lerp(100, 155, t); b = lerp(92, 162, t); }
        else {
          const bio = hf.sampleBiome(x, z);
          const t = saturate(bio.forest);
          r = lerp(96, 52, t); g = lerp(110, 82, t); b = lerp(66, 48, t);
          if (bio.road > 0.3) { r = 122; g = 106; b = 82; }
        }
        const o = (j * N + i) * 4;
        img.data[o] = clamp(r * lam, 0, 255);
        img.data[o + 1] = clamp(g * lam, 0, 255);
        img.data[o + 2] = clamp(b * lam, 0, 255);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // parchment vignette
    const grad = ctx.createRadialGradient(N / 2, N / 2, N * 0.32, N / 2, N / 2, N * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(8,10,14,0.72)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, N, N);
    this._mapCanvas = c;
    return c;
  }

  openMap() {
    const g = this.game;
    const src = this._buildMapCanvas();
    this.openPanel('World Map', [{ name: 'Wyrmhold' }], () => {
      const wrap = el('div', 'map-wrap');
      const cv = el('canvas');
      cv.id = 'map-canvas';
      wrap.appendChild(cv);
      const legend = el('div', 'map-legend',
        'Drag to pan · Scroll to zoom<br>Click a discovered marker to travel');
      wrap.appendChild(legend);

      const pins = [];
      const draw = () => {
        const rect = wrap.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height) * this.mapPan.zoom;
        cv.width = Math.max(1, Math.round(rect.width));
        cv.height = Math.max(1, Math.round(rect.height));
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        const ox = (rect.width - size) / 2 + this.mapPan.x;
        const oy = (rect.height - size) / 2 + this.mapPan.y;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(src, ox, oy, size, size);
        ctx.strokeStyle = 'rgba(216,180,106,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox, oy, size, size);

        for (const p of pins) p.remove();
        pins.length = 0;
        const place = (wx, wz, cls, icon, title, sub, onClick) => {
          const px = ox + ((wx + WORLD_HALF) / WORLD_SIZE) * size;
          const py = oy + ((wz + WORLD_HALF) / WORLD_SIZE) * size;
          if (px < -20 || py < -20 || px > rect.width + 20 || py > rect.height + 20) return;
          const pin = el('div', 'map-pin ' + cls, icon);
          pin.style.left = px + 'px';
          pin.style.top = py + 'px';
          pin.title = title;
          if (onClick) on(pin, 'click', onClick);
          on(pin, 'mouseenter', () => {
            const tip = el('div', 'map-tip', `<b>${title}</b>${sub || ''}`);
            tip.style.left = px + 'px'; tip.style.top = py + 'px';
            wrap.appendChild(tip);
            pin._tip = tip;
          });
          on(pin, 'mouseleave', () => { pin._tip?.remove(); });
          wrap.appendChild(pin);
          pins.push(pin);
        };

        for (const L of this.world.hf.locations) {
          if (L.kind === 'water') continue;
          place(L.x, L.z, L.discovered ? '' : 'undisc', L.icon, L.discovered ? L.name : 'Undiscovered',
            L.discovered ? L.blurb : 'You have not been here yet.',
            L.discovered ? () => {
              if (g.interior) g.leaveDungeon();
              const spot = this.world.hf.findFlat(L.x, L.z, L.radius * 0.8, 0.35, 40, () => Math.random());
              this.player.pos.set(spot.x, spot.y, spot.z);
              this.player.vel.set(0, 0, 0);
              this.world.scatter.markDirty();
              this.world.grass.markDirty();
              g.rest(2, false);
              this.closePanel();
              this.showDiscovery(L);
            } : null);
        }
        // objectives
        for (const o of g.quests.activeObjectives()) {
          if (!o.marker) continue;
          const L = this.world.hf.loc(o.marker);
          if (L) place(L.x, L.z, '', '❖', o.name, o.text, null);
        }
        place(this.player.pos.x, this.player.pos.z, 'player', '➤', 'You', '', null);
      };

      requestAnimationFrame(draw);
      let dragging = false, lastX = 0, lastY = 0;
      on(cv, 'mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; cv.style.cursor = 'grabbing'; });
      on(window, 'mouseup', () => { dragging = false; cv.style.cursor = 'grab'; });
      on(cv, 'mousemove', e => {
        if (!dragging) return;
        this.mapPan.x += e.clientX - lastX;
        this.mapPan.y += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        draw();
      });
      on(cv, 'wheel', e => {
        e.preventDefault();
        this.mapPan.zoom = clamp(this.mapPan.zoom * (e.deltaY < 0 ? 1.15 : 0.87), 0.8, 6);
        draw();
      });
      this._mapDraw = draw;
      return wrap;
    }, { hotkey: 'map', hint: 'Fast travel costs two hours of daylight' });
    setTimeout(() => this._mapDraw?.(), 30);
  }

  // =========================================================================
  // Dialogue / shops / loot
  // =========================================================================
  openDialogue(actor, node) {
    this.closeDialogue(true);
    const d = el('div');
    d.id = 'dialogue';
    d.innerHTML = `<div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-opts"></div>`;
    this.root.appendChild(d);
    this.dialogue = { el: d, actor, node, options: [] };
    this._renderDialogue(node);
    this.engine.input.exitPointerLock();
  }

  _renderDialogue(node) {
    const d = this.dialogue;
    if (!d) return;
    d.node = node;
    d.el.querySelector('.dlg-name').textContent = d.actor.name + (d.actor.title ? `, ${d.actor.title}` : '');
    const txt = d.el.querySelector('.dlg-text');
    txt.textContent = '';
    const full = node.text || '';
    let i = 0;
    clearInterval(this._typer);
    this._typer = setInterval(() => {
      i += 2;
      txt.textContent = full.slice(0, i);
      if (i >= full.length) clearInterval(this._typer);
    }, 12);

    const opts = d.el.querySelector('.dlg-opts');
    opts.innerHTML = '';
    d.options = [];
    (node.options || []).forEach((o, idx) => {
      const ok = !o.cond || o.cond(this.game);
      const b = el('button', 'dlg-opt' + (ok ? '' : ' disabled'));
      b.innerHTML = `${o.tag ? `<span class="tag${ok ? '' : ' fail'}">[${o.tag}${ok ? '' : ' — failed'}]</span>` : ''}${idx + 1}. ${o.text}`;
      if (ok) on(b, 'click', () => this._pickDialogue(idx));
      else b.style.opacity = 0.45;
      opts.appendChild(b);
      d.options.push({ o, ok });
    });
  }

  _pickDialogue(i) {
    const d = this.dialogue;
    if (!d || !d.options[i] || !d.options[i].ok) return;
    const o = d.options[i].o;
    this.audio.play('ui', { kind: 'accept' });
    if (o.act) o.act(this.game);
    if (o.next) { this._renderDialogue(typeof o.next === 'function' ? o.next(this.game) : o.next); return; }
    this.closeDialogue();
  }

  closeDialogue(silent) {
    clearInterval(this._typer);
    if (!this.dialogue) return;
    const actor = this.dialogue.actor;
    this.dialogue.el.remove();
    this.dialogue = null;
    if (actor && actor.state === 'talk') actor._setState('idle');
    this.game.closeDialogue();
    if (!silent && !this.panel && !this.menuOpen && settings.effectivePlatform === 'desktop') {
      this.engine.input.requestPointerLock();
    }
  }

  openLoot(title, contents, onEmpty) {
    const g = this.game;
    if (!contents || !contents.length) { this.notify(title, 'Empty', 'skill'); return; }
    this.openPanel(title, [{ name: 'Contents' }], () => {
      const wrap = el('div', 'inv-list');
      const takeAll = () => {
        for (const c of contents) g.inventory.add(c.id, c.qty);
        contents.length = 0;
        onEmpty?.();
        this.audio.play('loot');
        this.closePanel();
      };
      for (const c of contents.slice()) {
        const d = ITEMS[c.id];
        if (!d) continue;
        const row = el('div', 'inv-item');
        row.innerHTML = `<span class="ic">${d.icon || '▪'}</span><span class="nm">${d.name}</span>
          <span class="qt">${c.qty > 1 ? '×' + c.qty : ''}</span><span class="vl">${d.value * c.qty}</span>`;
        on(row, 'click', () => {
          g.inventory.add(c.id, c.qty);
          const i = contents.indexOf(c);
          if (i >= 0) contents.splice(i, 1);
          this.audio.play('loot');
          if (!contents.length) { onEmpty?.(); this.closePanel(); }
          else this.panel.renderNow();
        });
        wrap.appendChild(row);
      }
      const b = el('button', 'btn small primary', 'Take All');
      on(b, 'click', takeAll);
      wrap.appendChild(b);
      return wrap;
    }, { hint: 'Click an item to take it' });
  }

  openShop(npc, npcId) {
    const g = this.game;
    const m = npc.merchant;
    const stock = m.stock.map(id => ({ id, qty: 99 }));
    this.openPanel(`${npc.name} — Trade`, [{ name: 'Buy' }, { name: 'Sell' }], (tab) => {
      const wrap = el('div', 'inv-list');
      if (tab === 'Buy') {
        for (const s of stock) {
          const d = ITEMS[s.id];
          const price = Math.max(1, Math.round(d.value * m.markup));
          const row = el('div', 'inv-item');
          row.innerHTML = `<span class="ic">${d.icon || '▪'}</span><span class="nm">${d.name}</span>
            <span class="qt muted">${d.desc || ''}</span><span class="vl">${price} 🪙</span>`;
          on(row, 'click', () => {
            if (g.inventory.gold < price) { this.notify('Not enough gold', '', 'skill'); return; }
            g.inventory.gold -= price;
            g.inventory.add(s.id, 1);
            this.audio.play('loot');
            this.panel.renderNow();
          });
          wrap.appendChild(row);
        }
      } else {
        for (const e of g.inventory.items.slice()) {
          const d = ITEMS[e.id];
          if (d.quest) continue;
          const price = Math.max(1, Math.round(d.value * 0.45));
          const row = el('div', 'inv-item');
          row.innerHTML = `<span class="ic">${d.icon || '▪'}</span><span class="nm">${d.name}</span>
            <span class="qt">${e.qty > 1 ? '×' + e.qty : ''}</span><span class="vl">${price} 🪙</span>`;
          on(row, 'click', () => {
            g.inventory.remove(e.uid, 1);
            g.inventory.gold += price;
            this.audio.play('loot');
            this.panel.renderNow();
          });
          wrap.appendChild(row);
        }
      }
      return wrap;
    }, { hint: `Your gold: <b class="gold">${g.inventory.gold} 🪙</b>` });
  }

  openBook(def) {
    this.openPanel(def.name, [{ name: 'Read' }], () => {
      const w = el('div', 'group');
      w.innerHTML = `<p style="font-size:15px;line-height:2;white-space:pre-wrap;max-width:640px;font-style:italic">${def.text}</p>`;
      return w;
    });
  }

  openCrafting(kind) {
    const g = this.game;
    const recipes = kind === 'smelt'
      ? [{ out: 'ironIngot', need: [['ironOre', 1]] }, { out: 'steelIngot', need: [['ironIngot', 1], ['ironOre', 1]] }]
      : [
        { out: 'ironSword', need: [['ironIngot', 2], ['leatherStrips', 1]] },
        { out: 'steelSword', need: [['steelIngot', 2], ['leatherStrips', 1]] },
        { out: 'ironCuirass', need: [['ironIngot', 4], ['leatherStrips', 2]] },
        { out: 'woodShield', need: [['ironIngot', 1], ['leatherStrips', 2]] },
        { out: 'steelArrow', need: [['steelIngot', 1]], qty: 12 },
      ];
    this.openPanel(kind === 'smelt' ? 'Smelter' : 'Forge', [{ name: 'Recipes' }], () => {
      const wrap = el('div', 'inv-list');
      for (const r of recipes) {
        const d = ITEMS[r.out];
        const can = r.need.every(([id, n]) => g.inventory.count(id) >= n);
        const row = el('div', 'inv-item');
        row.innerHTML = `<span class="ic">${d.icon}</span><span class="nm">${d.name}${r.qty ? ' ×' + r.qty : ''}</span>
          <span class="qt ${can ? 'gold' : 'muted'}">${r.need.map(([id, n]) => `${ITEMS[id].name} ×${n} (${g.inventory.count(id)})`).join(', ')}</span>`;
        if (can) on(row, 'click', () => {
          for (const [id, n] of r.need) g.inventory.remove(id, n);
          g.inventory.add(r.out, r.qty || 1);
          g.stats.gainSkill('smithing', 30);
          this.audio.play('forge');
          this.notify(d.name, 'Crafted', 'skill');
          this.panel.renderNow();
        });
        else row.style.opacity = 0.45;
        wrap.appendChild(row);
      }
      return wrap;
    });
  }

  openRest(obj) {
    const inBed = !!obj;
    this._restOpen = true;
    const scrim = el('div', 'panel-scrim');
    const p = el('div', 'panel');
    p.style.height = 'auto';
    p.style.maxWidth = '520px';
    p.innerHTML = `<div class="panel-head"><h2>${inBed ? 'Rest' : 'Wait'}</h2></div>
      <div class="panel-body"><div class="group"><div class="group-title">Hours</div><div class="row"><div class="row-ctl" id="rest-btns"></div></div></div></div>`;
    scrim.appendChild(p);
    this.root.appendChild(scrim);
    const btns = p.querySelector('#rest-btns');
    for (const h of [1, 2, 4, 8, 12]) {
      const b = el('button', 'btn small', `${h}h`);
      on(b, 'click', () => {
        this.game.rest(h, inBed);
        this._closeRest(scrim);
      });
      btns.appendChild(b);
    }
    const c = el('button', 'btn small danger', 'Cancel');
    on(c, 'click', () => this._closeRest(scrim));
    btns.appendChild(c);
    on(scrim, 'mousedown', e => { if (e.target === scrim) this._closeRest(scrim); });
  }
  _closeRest(scrim) {
    scrim.remove();
    this._restOpen = false;
    if (settings.effectivePlatform === 'desktop' && !this.panel && !this.menuOpen) this.engine.input.requestPointerLock();
  }

  showDeath() {
    const scrim = el('div', 'panel-scrim');
    scrim.innerHTML = `<div style="text-align:center">
      <div style="font-family:var(--font-title);font-size:clamp(34px,6vw,72px);letter-spacing:.3em;color:var(--blood);
        text-shadow:0 0 60px rgba(143,43,37,.6)">YOU DIED</div>
      <div class="muted" style="margin:18px 0 30px;letter-spacing:.2em">The north keeps what it takes</div>
      <div id="death-btns"></div></div>`;
    this.root.appendChild(scrim);
    const b = scrim.querySelector('#death-btns');
    const load = el('button', 'btn primary', 'Load Last Save');
    on(load, 'click', () => {
      scrim.remove();
      if (!this.game.load('auto')) {
        this.game.stats.dead = false;
        this.game.stats.health = this.game.stats.maxHealth * 0.4;
        const hw = this.world.hf.loc('hearthwatch');
        this.player.spawn(hw.x, hw.z + 40);
      }
      this.game.stats.dead = this.game.stats.health <= 0;
    });
    const menu = el('button', 'btn', 'Main Menu');
    on(menu, 'click', () => { scrim.remove(); this.showMainMenu(); });
    b.appendChild(load); b.appendChild(menu);
  }

  showLevelUp(lvl) {
    const e = this.$('#levelup');
    e.querySelector('.lu-t').textContent = `LEVEL ${lvl}`;
    e.style.transition = 'none';
    e.style.opacity = '1';
    e.style.transform = 'scale(1.06)';
    requestAnimationFrame(() => {
      e.style.transition = 'opacity 1.6s ease 0.9s, transform 2.4s cubic-bezier(.16,1,.3,1)';
      e.style.opacity = '0';
      e.style.transform = 'scale(1)';
    });
  }

  showDiscovery(L) {
    const e = this.$('#discover');
    e.querySelector('.d-t').textContent = L.name;
    e.style.transition = 'none';
    e.style.opacity = '1';
    e.style.transform = 'translateX(-50%) scale(1.04)';
    this.audio.play('ui', { kind: 'accept' });
    requestAnimationFrame(() => {
      e.style.transition = 'opacity 1.4s ease 1.4s, transform 2.6s cubic-bezier(.16,1,.3,1)';
      e.style.opacity = '0';
      e.style.transform = 'translateX(-50%) scale(1)';
    });
  }

  showCellLoad(name) {
    let e = document.getElementById('loadcell');
    if (!e) {
      e = el('div');
      e.id = 'loadcell';
      e.innerHTML = `<div class="lc-t"></div><div class="lc-tip"></div>`;
      this.root.appendChild(e);
    }
    e.querySelector('.lc-t').textContent = name;
    e.querySelector('.lc-tip').textContent = 'Loading…';
    e.classList.add('on');
    setTimeout(() => e.classList.remove('on'), 700);
  }

  togglePhotoMode() {
    this.photoMode = !this.photoMode;
    this.hud.classList.toggle('hidden', this.photoMode);
    this.notify(this.photoMode ? 'Photo mode' : 'Photo mode off', this.photoMode ? 'HUD hidden · press G to exit' : '', 'skill');
  }

  // =========================================================================
  // Notices, subtitles, damage numbers
  // =========================================================================
  notify(title, sub, kind = 'quest') {
    const n = el('div', 'notice ' + kind, `${title}${sub ? `<small>${sub}</small>` : ''}`);
    this.$('#notices').appendChild(n);
    this.notices.push({ el: n, t: 0 });
    while (this.notices.length > 5) { const o = this.notices.shift(); o.el.remove(); }
  }

  subtitle(who, text, dur = 3) {
    if (!settings.get('subtitles')) return;
    const s = this.$('#subtitles');
    s.innerHTML = `<span class="spk">${who}</span><br>${text}`;
    s.style.opacity = '1';
    clearTimeout(this._subT);
    this._subT = setTimeout(() => { s.style.opacity = '0'; }, dur * 1000);
  }

  floatDamage(x, y, z, amount, kind) {
    if (!settings.get('damageNumbers')) return;
    const f = el('div', 'floater ' + kind, String(amount));
    this.$('#floaters').appendChild(f);
    this.floaters.push({ el: f, x, y, z, t: 0, ox: (Math.random() - 0.5) * 40 });
    if (this.floaters.length > 40) { const o = this.floaters.shift(); o.el.remove(); }
  }

  onPlayerHurt(dmg) {
    const v = this.$('#dmg-vignette');
    v.style.transition = 'none';
    v.style.opacity = String(Math.min(0.9, dmg / 40));
    requestAnimationFrame(() => { v.style.transition = 'opacity .5s ease'; v.style.opacity = '0'; });
  }

  refreshAll() {
    this.refreshTracker();
    if (this.panel) this.panel.renderNow();
  }

  refreshTracker() {
    const t = this.$('#tracker');
    if (!settings.get('questMarkers')) { t.innerHTML = ''; return; }
    const objs = this.game.quests.activeObjectives().slice(0, 4);
    t.innerHTML = '';
    let lastQuest = null;
    for (const o of objs) {
      if (o.name !== lastQuest) { t.appendChild(el('div', 'qt', o.name)); lastQuest = o.name; }
      t.appendChild(el('div', 'qo', o.text));
    }
  }

  onResize() { this._mapDraw?.(); }
  onPlatformChanged() {
    const touch = settings.effectivePlatform === 'mobile';
    this._touchRoot.classList.toggle('on', touch);
    this.applyScale();
    if (touch) this.engine.input.exitPointerLock();
  }

  // =========================================================================
  // Touch controls
  // =========================================================================
  _buildTouch() {
    const t = el('div');
    t.id = 'touch';
    t.innerHTML = `
      <div class="tstick" id="tmove"><div class="knob"></div></div>
      <div id="tlook"></div>
      <div class="tbtn lg" id="tb-attack"><span class="ic">⚔</span></div>
      <div class="tbtn md" id="tb-block"><span class="ic">🛡</span></div>
      <div class="tbtn md" id="tb-jump"><span class="ic">⤒</span></div>
      <div class="tbtn md" id="tb-cast"><span class="ic">✷</span></div>
      <div class="tbtn sm" id="tb-sprint">RUN</div>
      <div class="tbtn sm" id="tb-crouch">SNEAK</div>
      <div class="tbtn md" id="tb-use"><span class="ic">✋</span></div>
      <div class="tbtn sm" id="tb-swap">SPELL</div>
      <div id="tmenu">
        <div class="tbtn sm" id="tb-inv">BAG</div>
        <div class="tbtn sm" id="tb-map">MAP</div>
        <div class="tbtn sm" id="tb-menu">☰</div>
      </div>`;
    this.root.appendChild(t);
    this._touchRoot = t;
    if (settings.effectivePlatform === 'mobile') t.classList.add('on');

    const input = this.engine.input;
    input.touch.active = true;

    // --- movement stick ---
    const stick = t.querySelector('#tmove');
    const knob = stick.querySelector('.knob');
    let moveId = null;
    const stickRect = () => stick.getBoundingClientRect();
    const setMove = (cx, cy) => {
      const r = stickRect();
      const dx = cx - (r.left + r.width / 2);
      const dy = cy - (r.top + r.height / 2);
      const max = r.width * 0.42;
      const d = Math.hypot(dx, dy);
      const k = d > max ? max / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      input.touch.move.x = clamp((dx * k) / max, -1, 1);
      input.touch.move.y = clamp((-dy * k) / max, -1, 1);
    };
    stick.addEventListener('touchstart', e => {
      e.preventDefault();
      const to = e.changedTouches[0];
      moveId = to.identifier;
      setMove(to.clientX, to.clientY);
    }, { passive: false });
    stick.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const to of e.changedTouches) if (to.identifier === moveId) setMove(to.clientX, to.clientY);
    }, { passive: false });
    const endMove = e => {
      for (const to of e.changedTouches) {
        if (to.identifier !== moveId) continue;
        moveId = null;
        knob.style.transform = 'translate(0,0)';
        input.touch.move.x = 0; input.touch.move.y = 0;
      }
    };
    stick.addEventListener('touchend', endMove);
    stick.addEventListener('touchcancel', endMove);

    // --- look area ---
    const look = t.querySelector('#tlook');
    let lookId = null, lx = 0, ly = 0, lookMoved = 0;
    look.addEventListener('touchstart', e => {
      e.preventDefault();
      const to = e.changedTouches[0];
      lookId = to.identifier; lx = to.clientX; ly = to.clientY; lookMoved = 0;
    }, { passive: false });
    look.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const to of e.changedTouches) {
        if (to.identifier !== lookId) continue;
        const dx = to.clientX - lx, dy = to.clientY - ly;
        input.touch.look.x += dx;
        input.touch.look.y += dy;
        lookMoved += Math.abs(dx) + Math.abs(dy);
        lx = to.clientX; ly = to.clientY;
      }
    }, { passive: false });
    look.addEventListener('touchend', e => {
      for (const to of e.changedTouches) {
        if (to.identifier !== lookId) continue;
        lookId = null;
        // a tap (not a drag) attacks
        if (lookMoved < 12) { input.touch.buttons.attack = true; setTimeout(() => input.touch.buttons.attack = false, 80); }
      }
    });

    // --- buttons ---
    const hold = (id, action) => {
      const b = t.querySelector('#' + id);
      if (!b) return;
      const down = e => { e.preventDefault(); b.classList.add('down'); input.touch.buttons[action] = true; };
      const up = e => { e.preventDefault(); b.classList.remove('down'); input.touch.buttons[action] = false; };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
    };
    hold('tb-attack', 'attack');
    hold('tb-block', 'block');
    hold('tb-jump', 'jump');
    hold('tb-cast', 'cast');
    hold('tb-sprint', 'sprint');
    hold('tb-use', 'use');

    const tap = (id, fn) => {
      const b = t.querySelector('#' + id);
      if (!b) return;
      const go = e => { e.preventDefault(); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120); fn(); };
      b.addEventListener('touchstart', go, { passive: false });
      b.addEventListener('click', go);
    };
    tap('tb-crouch', () => { this.player.crouching = !this.player.crouching; });
    tap('tb-swap', () => {
      const g = this.game;
      const i = g.knownSpells.indexOf(g.currentSpell);
      g.currentSpell = g.knownSpells[(i + 1) % g.knownSpells.length];
      this.notify(SPELLS[g.currentSpell].name, '', 'skill');
    });
    tap('tb-inv', () => this.openInventory());
    tap('tb-map', () => this.openMap());
    tap('tb-menu', () => this.showMainMenu());
  }

  // =========================================================================
  // Per-frame HUD update
  // =========================================================================
  update(dt) {
    const g = this.game, st = g.stats, p = this.player, env = this.world.env;
    if (this.menuOpen) return;

    // scale touch controls
    if (settings.effectivePlatform === 'mobile') {
      this._touchRoot.style.transform = `scale(${settings.get('touchScale')})`;
      this._touchRoot.style.transformOrigin = 'bottom left';
    }

    // ---- vitals ----
    const setBar = (id, cur, max) => {
      const e = this.$(id);
      const t = saturate(cur / Math.max(max, 1e-3));
      e.querySelector('.fill').style.transform = `scaleX(${t})`;
      const gh = e.querySelector('.ghost');
      if (gh) {
        const prev = Number(gh.dataset.v || t);
        const nv = t < prev ? prev : t;
        gh.dataset.v = String(t < prev ? Math.max(t, prev - dt * 0.25) : t);
        gh.style.transform = `scaleX(${Number(gh.dataset.v)})`;
      }
      e.classList.toggle('low', t < 0.28);
    };
    setBar('#v-health', st.health, st.maxHealth);
    setBar('#v-stam', st.stamina, st.maxStamina);
    setBar('#v-magicka', st.magicka, st.maxMagicka);
    this.$('#low-hp').style.opacity = String(saturate((0.32 - st.health / st.maxHealth) * 3) * (0.4 + 0.25 * Math.sin(g.time * 3)));

    // ---- compass ----
    if (settings.get('compass')) {
      this.$('#compass').style.display = '';
      const deg = mod(-p.yaw * 180 / Math.PI, 360);
      const strip = this.$('#compass-strip');
      const w = this.$('#compass').clientWidth;
      strip.style.transform = `translateX(${w / 2 - deg * 2}px)`;
      // markers
      for (const m of this._compassMarkers) m.remove();
      this._compassMarkers.length = 0;
      const addMarker = (wx, wz, icon) => {
        const a = mod(Math.atan2(wx - p.pos.x, wz - p.pos.z) * 180 / Math.PI, 360);
        const mk = el('div', 'cmp-marker', icon);
        mk.style.left = `${a * 2}px`;
        strip.appendChild(mk);
        this._compassMarkers.push(mk);
      };
      for (const o of g.quests.activeObjectives()) {
        if (!o.marker) continue;
        const L = this.world.hf.loc(o.marker);
        if (L) addMarker(L.x, L.z, '❖');
      }
      for (const L of this.world.hf.locations) {
        if (!L.discovered || L.kind === 'water') continue;
        if (Math.hypot(L.x - p.pos.x, L.z - p.pos.z) > 700) continue;
        addMarker(L.x, L.z, '◇');
      }
      for (const a of g.allTargets()) {
        if (a.dead || !a.isHostileToPlayer) continue;
        if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) > 60) continue;
        addMarker(a.pos.x, a.pos.z, '▾');
      }
    } else this.$('#compass').style.display = 'none';

    // ---- world info ----
    const wi = this.$('#worldinfo');
    wi.querySelector('.loc').textContent = g.interior
      ? (g.interior.kind === 'mine' ? 'Ashenvein Mine' : 'Hollowmere Barrow')
      : this.world.locationName(p.pos.x, p.pos.z);
    wi.querySelector('.tm').textContent = `Day ${env.day} · ${clockString(env.hour)} · ${this._weatherLabel()}`;

    // ---- crosshair / stealth ----
    const ch = this.$('#crosshair');
    ch.style.display = settings.get('crosshair') && !p.thirdPerson || g.drawing ? '' : 'none';
    if (g.drawing) {
      const spread = 1 - saturate(g.drawTime * 1.6);
      ch.querySelector('.ch-arc').style.transform = `scale(${1 + spread * 1.6})`;
    } else ch.querySelector('.ch-arc').style.transform = 'scale(1)';

    const stealth = this.$('#stealth');
    if (p.crouching) {
      let seen = 0;
      for (const a of g.allTargets()) {
        if (a.dead || !a.isHostileToPlayer) continue;
        seen = Math.max(seen, a.alertness);
      }
      stealth.style.opacity = '1';
      stealth.textContent = seen > 1.0 ? 'DETECTED' : seen > 0.45 ? 'Searching' : 'Hidden';
      stealth.style.color = seen > 1.0 ? '#e08a80' : seen > 0.45 ? '#e0c080' : '#cfd4da';
    } else stealth.style.opacity = '0';

    // ---- enemy bar ----
    const eb = this.$('#enemy-bar');
    let focus = null;
    const dir = p.aimDir(new THREE.Vector3());
    let bestDot = 0.94;
    for (const a of g.allTargets()) {
      if (a.dead || !a.isHostileToPlayer) continue;
      const dx = a.pos.x - p.camera.position.x, dy = (a.pos.y + a.height * 0.6) - p.camera.position.y, dz = a.pos.z - p.camera.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 60) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (dot > bestDot) { bestDot = dot; focus = a; }
    }
    if (!focus) {
      for (const a of g.allTargets()) {
        if (a.dead || !a.isHostileToPlayer || a.health >= a.maxHealth) continue;
        if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) > 24) continue;
        focus = a; break;
      }
    }
    if (focus) {
      eb.style.opacity = '1';
      eb.querySelector('.name').textContent = focus.name;
      eb.querySelector('.fill').style.transform = `scaleX(${saturate(focus.health / focus.maxHealth)})`;
      eb.querySelector('.lvl').textContent = `Level ${focus.level || 1}`;
    } else eb.style.opacity = '0';

    // ---- interact prompt ----
    const ip = this.$('#interact');
    const ft = g.focusTarget;
    if (ft && !this.dialogue) {
      ip.style.opacity = '1';
      ip.querySelector('.key').textContent = settings.effectivePlatform === 'mobile' ? '✋' : this._keyName(settings.binds.use);
      ip.querySelector('.txt').textContent = ft.label;
      ip.querySelector('.sub').textContent = ft.sub || '';
    } else ip.style.opacity = '0';

    // ---- quick slots ----
    const qb = this.$('#quickbar');
    const ids = ['potionHealth', 'potionStamina', 'potionMagicka', 'bread'];
    for (let i = 0; i < 4; i++) {
      const n = g.inventory.count(ids[i]);
      qb.children[i].classList.toggle('active', n > 0);
      qb.children[i].style.opacity = n > 0 ? '1' : '0.35';
    }

    // ---- notices ----
    for (let i = this.notices.length - 1; i >= 0; i--) {
      const n = this.notices[i];
      n.t += dt;
      if (n.t > 4.5) {
        n.el.style.transition = 'opacity .6s'; n.el.style.opacity = '0';
        setTimeout(() => n.el.remove(), 620);
        this.notices.splice(i, 1);
      }
    }

    // ---- floaters ----
    const cam = p.camera;
    const v = new THREE.Vector3();
    const rect = { w: window.innerWidth, h: window.innerHeight };
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t > 1.25) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      v.set(f.x, f.y + f.t * 1.1, f.z).project(cam);
      if (v.z > 1) { f.el.style.opacity = '0'; continue; }
      const sx = (v.x * 0.5 + 0.5) * rect.w + f.ox;
      const sy = (-v.y * 0.5 + 0.5) * rect.h;
      f.el.style.transform = `translate(${sx}px, ${sy}px)`;
      f.el.style.opacity = String(saturate(1 - f.t / 1.25));
    }

    // ---- pointer-lock fallback hint ----
    if (this.engine.input.dragLook && !this._dragHintShown && settings.effectivePlatform === 'desktop') {
      this._dragHintShown = true;
      this.notify('Hold the left mouse button to look', 'This page cannot capture the cursor', 'skill');
    }

    // ---- HUD auto-hide ----
    if (settings.get('hudAutoHide')) {
      const idle = (performance.now() - this.engine.input.anyInputAt) > 6000 && !g.anyHostileNear(50);
      this.hud.classList.toggle('dimmed', idle);
    } else this.hud.classList.remove('dimmed');

    // ---- perf overlay ----
    this._perfT += dt;
    if (settings.get('showFps')) {
      this._perf.style.display = '';
      if (this._perfT > 0.25) {
        this._perfT = 0;
        const fps = Math.round(1 / Math.max(dt, 1e-4));
        const st2 = this.engine.pipeline.stats;
        const warn = fps < settings.get('targetFps') * 0.8 ? ' class="warn"' : '';
        this._perf.innerHTML = `<span${warn}>${fps} fps</span><br>
          <b>${this.engine.pipeline.renW}×${this.engine.pipeline.renH}</b> → ${this.engine.outW}×${this.engine.outH}<br>
          scale <b>${Math.round(settings.get('renderScale') * this.engine.dynScale * 100)}%</b><br>
          draws <b>${st2.drawCalls}</b> · tris <b>${(st2.triangles / 1000).toFixed(0)}k</b><br>
          chunks <b>${this.world.terrain.stats.chunks}</b> · inst <b>${this.world.scatter.stats.instances}</b><br>
          actors <b>${g.actors.length}</b>`;
      }
    } else this._perf.style.display = 'none';
  }

  _weatherLabel() {
    const env = this.world.env;
    const W = { clear: 'Clear', fair: 'Fair', overcast: 'Overcast', mist: 'Mist', rain: 'Rain', storm: 'Storm', snow: 'Snowfall', blizzard: 'Blizzard' };
    return W[env.weather] || env.weather;
  }
}
