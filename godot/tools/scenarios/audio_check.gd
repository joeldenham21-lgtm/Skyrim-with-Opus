extends "res://tools/scenarios/_driver.gd"
## Audio catalogue check: every name in assets/audio/sfx_manifest.json (and every alias) must resolve through
## Audio.has(); every name the game code asks for by string must exist; then a sample of each category is played
## (2D and positional) and a loop started, so a broken import or a bad stream shows up as an error in the log.
## Run: tools/shot.sh tools/scenarios/audio_check.gd   (prints "[audio_check] OK" or the list of failures)

# names the game logic calls by string (browser build sfx.js/voices.js + the Godot scripts), kept here so the check
# does not depend on the manifest alone
const EXPECTED := [
	"ads_in", "ads_out", "arc_hum", "arc_zap", "artifact_hum", "artifact_pickup", "bandage_use", "base_hum", "bird", "bolt_close",
	"bolt_open", "break_close", "break_open", "breath", "bullet_whiz", "click", "container_open", "crow", "death", "detector_tick",
	"distant_shot", "door_close", "door_open", "drip", "drizzle", "dry_click", "flashlight", "fragment_approach", "fragment_chime",
	"fragment_explode", "fragment_pop", "gas_cough", "gas_hiss", "gravity_crush", "gravity_drone", "heartbeat", "hurt", "hurt_bullet",
	"impact_ash", "impact_concrete", "impact_dirt", "impact_glass", "impact_metal", "impact_water", "impact_wood", "jam", "jump", "land",
	"mag_load_round", "medkit_use", "mimic_death", "mimic_hit", "mimic_radio", "mimic_shot", "mimic_skip", "mimic_spot", "mimic_static",
	"mimic_step", "mission_complete", "pickup_ammo", "pickup_item", "probe_land", "probe_throw", "probe_trigger", "radius_hum",
	"reflector_hum", "reflector_whip", "reload_chamber", "reload_magin", "reload_magout", "ricochet", "seeker_death", "seeker_hiss",
	"seeker_hum", "seeker_shot", "seeker_spot", "seeker_step", "shell_insert", "shot_akm", "shot_mosin", "shot_pm", "shot_toz", "siren",
	"sleep", "slider_click", "slider_death", "slider_hit", "slider_lunge", "slider_screech", "slider_step", "spawn_bite", "spawn_death",
	"spawn_skitter", "step_concrete", "step_grass", "step_metal", "step_mud", "step_road", "step_rock", "step_water", "step_wood",
	"stim_use", "thunder", "tide_chord", "tide_warn", "ui_buy", "ui_click", "ui_close", "ui_deny", "ui_open", "ui_slip", "ui_stamp",
	"unjam", "weapon_draw", "weapon_holster", "wind",
	# Godot scripts
	"armor_pen", "battery_swap", "container_locked", "filter_swap", "headlamp", "lock_open", "lockpick_fail", "nvg_off", "nvg_on",
	"pickup_weapon", "thunder_near", "thunder_far", "use_med", "use_food", "use_tool", "use_battery", "use_filter", "use_grenade",
	"use_key", "use_melee", "use_mission", "use_part", "use_artifact",
	"step_dirt", "step_gravel", "step_sand", "step_snow",
]

const SAMPLE := ["fire_akm", "fire_pm_sup", "fire_mosin_far", "mag_in_ak", "rack_ak", "step_grass", "step_mud_sprint", "impact_metal",
	"casing_concrete", "bullet_crack", "explosion_frag", "mimic_radio", "mimic_scream", "slider_screech", "fragment_pop", "spawn_skitter",
	"arc_zap", "detector_near", "probe_trigger", "door_metal_open", "ui_stamp", "terminal_key", "tide_warn", "heartbeat", "breath_gasp"]
const LOOPS := ["arc_hum", "gas_hiss", "fragment_chime", "mimic_static", "heartbeat_loop", "breath_exhausted"]

func run() -> void:
	var failures := []
	var f := FileAccess.open("res://assets/audio/sfx_manifest.json", FileAccess.READ)
	if f == null:
		push_error("[audio_check] assets/audio/sfx_manifest.json missing (run tools/gen_sfx.py)")
		return
	var man: Variant = JSON.parse_string(f.get_as_text())
	if not (man is Dictionary):
		push_error("[audio_check] manifest is not valid JSON"); return
	var sounds: Dictionary = man.get("sounds", {})
	var aliases: Dictionary = man.get("aliases", {})
	var names: Array = sounds.keys()
	names.append_array(aliases.keys())
	var missing := []
	var files := 0
	for n in names:
		if Audio.has(n):
			var st: Variant = Audio._cache.get(n)
			if st is Array: files += (st as Array).size()
		else: missing.append(n)
	print("[audio_check] manifest: %d names (%d sounds + %d aliases), %d streams resolved, %d missing" % [names.size(), sounds.size(), aliases.size(), files, missing.size()])
	if not missing.is_empty(): failures.append("missing manifest names: " + str(missing))
	var missing_expected := []
	for n in EXPECTED:
		if not Audio.has(n): missing_expected.append(n)
	print("[audio_check] game-code names: %d checked, %d missing" % [EXPECTED.size(), missing_expected.size()])
	if not missing_expected.is_empty(): failures.append("missing game-code names: " + str(missing_expected))
	# every weapon in the catalogue has fire_<id>, _sup and _far
	var wmiss := []
	for wid in Data.weapons.keys() if ("weapons" in Data) else []:
		for suffix in ["", "_sup", "_far"]:
			if not Audio.has("fire_%s%s" % [wid, suffix]): wmiss.append("fire_%s%s" % [wid, suffix])
	print("[audio_check] weapon fire sets missing: %d" % wmiss.size())
	if not wmiss.is_empty(): failures.append("missing weapon fire names: " + str(wmiss))
	# stream sanity: the variant count in the manifest matches the files found
	var count_bad := []
	for n in sounds.keys():
		var st: Variant = Audio._cache.get(n)
		var got: int = (st as Array).size() if st is Array else 0
		var want: int = int((sounds[n] as Dictionary).get("variants", 1))
		if got != want: count_bad.append("%s %d/%d" % [n, got, want])
	if not count_bad.is_empty(): failures.append("variant count mismatch: " + str(count_bad.slice(0, 20)))
	# play a sample (2D and positional) and a few loops; a bad stream errors in the log
	var played := 0
	for s in SAMPLE:
		var p: Node = Audio.play(s, null, 0.8)
		var p3: Node = Audio.play(s, Vector3(2.0, 1.5, -3.0), 0.8)
		if p == null or p3 == null: failures.append("play returned null for " + s)
		else: played += 2
		await frames(3)
	var loops := []
	for l in LOOPS:
		var p: Node = Audio.loop(l, null, 0.5)
		if p == null: failures.append("loop returned null for " + l)
		else:
			loops.append(p)
			var stream: AudioStream = p.stream
			if stream is AudioStreamOggVorbis and not (stream as AudioStreamOggVorbis).loop:
				print("[audio_check] note: loop stream '%s' has loop=false (Audio.loop does not set it; request for the audio owner)" % l)
	await frames(30)
	var playing := 0
	for p in loops:
		if p.playing: playing += 1
	print("[audio_check] played %d one-shots, %d/%d loops still playing after 30 frames" % [played, playing, loops.size()])
	if playing != loops.size(): failures.append("some loops stopped early")
	for p in loops: p.stop(); p.queue_free()
	if failures.is_empty(): print("[audio_check] OK")
	else:
		for x in failures: print("[audio_check] FAIL: ", x)
	print("[stats] ", JSON.stringify({"names": names.size(), "streams": files, "failures": failures.size()}))
