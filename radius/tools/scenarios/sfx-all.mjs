// sfx smoke: plays every canonical sound name (one-shots + loops) headless and asserts none are missing or throw.
// node tools/smoke.mjs --out .smoke/sfx-1 --scenario tools/scenarios/sfx-all.mjs --w 640 --h 360
export const ONE_SHOTS = ['step_grass', 'step_mud', 'step_road', 'step_rock', 'step_water', 'step_concrete', 'step_metal', 'step_wood', 'land', 'jump', 'hurt', 'hurt_bullet', 'death', 'flashlight', 'click', 'ui_slip', 'tide_warn', 'tide_chord', 'siren',
  'shot_pm', 'shot_akm', 'shot_toz', 'shot_mosin', 'dry_click', 'reload_magout', 'reload_magin', 'reload_chamber', 'bolt_open', 'bolt_close', 'break_open', 'break_close', 'shell_insert', 'jam', 'unjam', 'mag_load_round', 'weapon_draw', 'weapon_holster', 'ads_in', 'ads_out', 'bullet_whiz', 'impact_metal', 'impact_concrete', 'impact_dirt', 'impact_wood', 'impact_ash', 'impact_glass', 'impact_water',
  'mimic_radio', 'mimic_spot', 'mimic_shot', 'mimic_hit', 'mimic_death', 'mimic_skip', 'mimic_step', 'slider_click', 'slider_screech', 'slider_lunge', 'slider_hit', 'slider_death', 'slider_step', 'fragment_pop', 'fragment_explode', 'fragment_approach', 'spawn_skitter', 'spawn_bite', 'spawn_death', 'seeker_step', 'seeker_shot', 'seeker_hiss', 'seeker_death', 'seeker_spot',
  'arc_zap', 'reflector_whip', 'gravity_crush', 'gas_cough', 'probe_throw', 'probe_land', 'probe_trigger', 'artifact_pickup', 'detector_tick',
  'crow', 'bird', 'distant_shot', 'drip',
  'ui_click', 'ui_open', 'ui_close', 'ui_buy', 'ui_deny', 'ui_stamp', 'door_open', 'door_close', 'sleep', 'mission_complete', 'container_open', 'pickup_item', 'pickup_ammo', 'bandage_use', 'medkit_use', 'stim_use'];
export const LOOPS = ['mimic_static', 'fragment_chime', 'seeker_hum', 'arc_hum', 'reflector_hum', 'gravity_drone', 'gas_hiss', 'artifact_hum', 'wind', 'radius_hum', 'base_hum', 'drizzle'];

export default async function (page, api) {
  // frame-independent: audio does not need the software renderer, and the loop update is driven by hand below
  await api.run('window.__radius.start()');
  const result = await api.run(`(async () => {
    const ONE = ${JSON.stringify(ONE_SHOTS)}, LOOPS = ${JSON.stringify(LOOPS)};
    const r = window.__radius, a = r.ctx.audio, THREE = r.ctx.THREE;
    a.ensure(); await a.ctx.resume();
    const fails = [], unregistered = [];
    for (const n of [...ONE, ...LOOPS]) if (!a.has(n)) unregistered.push(n);
    const pos = r.ctx.player.position.clone().add(new THREE.Vector3(3, 1.5, -2));
    const variants = [{ gain: 0.5 }, { gain: 0.4, rate: 0.7 }, { gain: 0.4, rate: 1.4, pos, hrtf: true }, { gain: 0.3, variant: 'crate' }, {}, null];
    for (const n of ONE) for (const o of variants) {
      try { const h = a.play(n, o == null ? undefined : o); if (!h) fails.push(n + ':null'); else if (o && o.rate === 1.4) h.stop?.(); }
      catch (e) { fails.push(n + ':' + (e && e.message)); }
    }
    const handles = [];
    for (const n of LOOPS) {
      try {
        const h = a.loop(n, { gain: 0.4 }), hp = a.loop(n, { gain: 0.3, pos, rate: 1.2 });
        if (!h || !hp) { fails.push(n + ':loop-null'); continue; }
        for (const k of ['level', 'rate', 'gust', 'intensity', 'near', 'pulse']) { h.set(k, 0.6); hp.set(k, 2.5); }
        h.set('bogus', NaN);
        handles.push(h, hp);
      } catch (e) { fails.push(n + ':' + (e && e.message)); }
    }
    for (let i = 0; i < 10; i++) { a.update(0.35); await new Promise((res) => setTimeout(res, 30)); }   // exercise loop tick()s
    for (const h of handles) h.stop(0.1);
    await new Promise((res) => setTimeout(res, 500));
    return { fails, unregistered, missing: [...a.missing], state: a.ctx.state, registered: ONE.length + LOOPS.length };
  })()`);
  const after = await api.run(`(() => { const a = window.__radius.ctx.audio; return { missing: [...a.missing], live: a.stopAll ? 'ok' : 'no' }; })()`);
  console.log('sfx result', JSON.stringify({ ...result, after }));
  if (result.state !== 'running') throw new Error('audio context not running: ' + result.state);
  if (result.unregistered.length) throw new Error('unregistered sounds: ' + result.unregistered.join(' '));
  if (result.fails.length) throw new Error('sound failures: ' + result.fails.join(' '));
  if (result.missing.length || after.missing.length) throw new Error('audio.missing not empty: ' + [...result.missing, ...after.missing].join(' '));
}
