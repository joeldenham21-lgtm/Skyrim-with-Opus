extends Control
class_name Hud
## RADIUS in-world HUD. Into the Radius 2 has almost no interface: no ammo counter in the corner, no health
## bar, no minimap. The explorer reads their state off the world and off their gear — the wristwatch, the
## magazine in the gun, the detector, the paper map. This node builds exactly that:
##
##   · a faint dot while hip-firing, nothing at all down the sights (the optic owns the reticle)
##   · the interaction prompt from Game.player.focus_prompt, in the register's voice, fading in over 0.12 s
##   · damage as damage: directional impact smears, a bleed pulse on the heartbeat, the colour draining at
##     low health, blood on the glass, a bandage line when bleeding
##   · stamina as breath — sound, a shake and a closing vignette, never a bar
##   · overweight only when overweight
##   · Committee notices typed into the top-left corner (scripts/ui/notice.gd)
##   · the wristwatch on hold-Tab: hands, compass ring, day, Tide countdown, cell charges
##   · the screen-effect stack: gas mask, night vision, optic and binocular surrounds, rain and blood on
##     the glass, film grain and the Tide white-out (scripts/ui/widgets/screen_fx.gd)
##   · F3 telemetry from Perf.stats()
##
## PUBLIC API — other modules reach the HUD through the "hud" group or Engine.get_singleton("RadiusHud"):
##     var hud = get_tree().get_first_node_in_group("hud")
##   notice(text, kind)                    same as Events.notice
##   set_scope(def)  / clear_scope()       def = { reticle, zoom, kind: "optic"|"binocular"|"tube" }
##   set_ammo(text) / flash_ammo(seconds)  a brief arms readout; nothing is shown unless a module asks
##   set_objective(code, text)             one contract line, top right; "" clears it
##   fade_out(white) / fade_in(seconds)    door and Tide transitions
##   set_game_visible(on)                  panels and menus hide the HUD with this
##   shake(amount) / flash(amount, colour) / hit_from(world_pos, strength)
##   screen_dir(world_pos) -> Vector2      unit direction from the centre of the screen toward a position

signal watch_raised(up: bool)

const LOW_HP_AT := 45.0
const CRIT_HP := 30.0
const BLOOD_AT := 25.0
const BREATH_AT := 26.0

@onready var fx: ScreenFX = $Fx
@onready var scope_reticle: Reticle = $Reticle
@onready var crosshair: Crosshair = $Crosshair
@onready var prompt: PromptLine = $Prompt
@onready var notices: NoticeQueue = $Notices
@onready var watch: WatchFace = $Watch
@onready var stats: StatsOverlay = $Stats
@onready var readouts: HudReadouts = $Readouts
@onready var fade_rect: ColorRect = $Fade

var game_visible := true
var watch_t := 0.0            # 0 stowed .. 1 raised
var _watch_target := 0.0
var _hurt := 0.0
var _bleed_amt := 0.0
var _low := 0.0
var _breath := 0.0
var _prompt_fade := 0.0
var _ammo_text := ""
var _ammo_t := 0.0
var _objective := ["", ""]
var _fade_amount := 1.0
var _fade_target := 0.0
var _fade_white := false
var _fade_speed := 1.0
var _status: Array = []
var _scope_def: Variant = null
var _heart: Node = null
var _breath_t := 0.0
var _watch_tick := 0.0
var _pulse := 0.0
var _last_hp := 100.0
var _tide_siren_done := {}

func _ready() -> void:
	add_to_group("hud")
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	process_mode = Node.PROCESS_MODE_ALWAYS
	if theme == null:
		theme = UIStyle.theme()
	if not Engine.has_singleton("RadiusHud"):
		Engine.register_singleton("RadiusHud", self)
	stats.visible = false
	watch.visible = false
	fade_rect.color = Color(0, 0, 0, 1)
	if not Events.player_damaged.is_connected(_on_damaged):
		Events.player_damaged.connect(_on_damaged)
	if not Events.player_died.is_connected(_on_died):
		Events.player_died.connect(_on_died)
	if not Events.tide_now.is_connected(_on_tide_now):
		Events.tide_now.connect(_on_tide_now)
	if not Events.tide_rising.is_connected(_on_tide_rising):
		Events.tide_rising.connect(_on_tide_rising)
	if not Events.mode_changed.is_connected(_on_mode):
		Events.mode_changed.connect(_on_mode)
	if not Events.game_started.is_connected(_on_started):
		Events.game_started.connect(_on_started)
	# the whole effect stack is dropped on the cheapest presets
	var perf := _perf()
	if perf != null and str(perf.get("preset")) in ["mobile", "low"]:
		fx.enabled = false
	_layout()
	resized.connect(_layout)

func _exit_tree() -> void:
	if Engine.has_singleton("RadiusHud") and Engine.get_singleton("RadiusHud") == self:
		Engine.unregister_singleton("RadiusHud")

func _perf() -> Node:
	var tree := get_tree()
	return tree.root.get_node_or_null("Perf") if tree != null else null

func _layout() -> void:
	var w := size.x
	var h := size.y
	notices.position = Vector2(30.0, 26.0)
	notices.size = Vector2(400.0, h * 0.5)
	stats.position = Vector2(w - stats.size.x - 24.0, 24.0)
	prompt.position = Vector2(0.0, h * 0.60)
	prompt.size = Vector2(w, 60.0)
	watch.position = Vector2(46.0, h - 300.0)
	for c in [fx, scope_reticle, crosshair, readouts, fade_rect]:
		if c != null:
			c.position = Vector2.ZERO
			c.size = size

# ── public API ─────────────────────────────────────────────────────────────────────────────────────────
func notice(text: String, kind: String = "") -> void:
	notices.push(text, kind)

func set_scope(def: Variant) -> void:
	_scope_def = def

func clear_scope() -> void:
	_scope_def = null

func set_ammo(text: String) -> void:
	_ammo_text = text

func flash_ammo(seconds: float = 2.2) -> void:
	_ammo_t = maxf(_ammo_t, seconds)

func set_objective(code: String, text: String) -> void:
	_objective = [code, text]

func fade_out(white: bool = false, seconds: float = 0.9) -> void:
	_fade_white = white
	_fade_target = 1.0
	_fade_speed = 1.0 / maxf(0.05, seconds)

func fade_in(seconds: float = 1.2) -> void:
	_fade_target = 0.0
	_fade_speed = 1.0 / maxf(0.05, seconds)

func set_game_visible(on: bool) -> void:
	game_visible = on

func shake(amount: float) -> void:
	fx.shake(amount)

func flash(amount: float, col: Color = Color(1, 1, 1)) -> void:
	fx.flash(amount, col)

func screen_dir(world_pos: Vector3) -> Vector2:
	var p: Node = Game.player
	if p == null or not is_instance_valid(p):
		return Vector2(0.0, 1.0)
	var pos: Vector3 = p.global_position
	var bearing := atan2(world_pos.x - pos.x, -(world_pos.z - pos.z))
	var rel := bearing - float(p.get("yaw"))
	return Vector2(sin(rel), -cos(rel))

func hit_from(world_pos: Vector3, strength: float) -> void:
	fx.add_hit(screen_dir(world_pos), strength)

# ── events ─────────────────────────────────────────────────────────────────────────────────────────────
func _on_damaged(amount: float, info: Dictionary) -> void:
	_hurt = clampf(maxf(_hurt, amount / 30.0), 0.0, 1.0)
	fx.shake(clampf(amount / 22.0, 0.1, 1.4))
	var src: Variant = info.get("source", info.get("from_pos", null))
	var pos: Variant = null
	if src is Vector3:
		pos = src
	elif src is Node3D and is_instance_valid(src):
		pos = src.global_position
	elif info.get("pos") is Vector3:
		pos = info["pos"]
	if pos is Vector3:
		fx.add_hit(screen_dir(pos), clampf(0.35 + amount / 40.0, 0.25, 1.0))
	else:
		fx.add_hit(Vector2(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)), clampf(0.3 + amount / 50.0, 0.2, 0.8))
	if Audio.has("hurt"):
		Audio.play("hurt", null, clampf(0.35 + amount / 60.0, 0.3, 0.9))

func _on_died(_info: Dictionary) -> void:
	fx.clear_hits()
	notices.clear()

func _on_tide_rising() -> void:
	flash(0.25, Color(1, 1, 1))

func _on_tide_now() -> void:
	flash(1.0, Color(1, 1, 1))

func _on_mode(mode: String) -> void:
	if mode != "playing":
		_watch_target = 0.0
	if mode == "title":
		notices.clear()

func _on_started(_new_game: bool) -> void:
	notices.clear()
	_hurt = 0.0
	_bleed_amt = 0.0
	fx.clear_hits()
	_last_hp = float(Game.state.get("hp", 100.0))
	fade_in(1.4)

# ── input ──────────────────────────────────────────────────────────────────────────────────────────────
func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("stats"):
		stats.visible = not stats.visible
		get_viewport().set_input_as_handled()

# ── frame ──────────────────────────────────────────────────────────────────────────────────────────────
func _process(dt: float) -> void:
	_pulse += dt
	var playing := Game.mode == "playing"
	var p: Node = Game.player
	var alive: bool = p != null and is_instance_valid(p) and bool(p.get("alive"))
	var hp := float(Game.state.get("hp", 100.0))
	var stamina := float(Game.state.get("stamina", 100.0))
	var bleeding := bool(Game.state.get("bleeding", false))
	var kit: Node = Game.kit if Game.kit != null and is_instance_valid(Game.kit) else null
	var kit_state: Dictionary = kit.state() if kit != null and kit.has_method("state") else {}
	var dmg: Node = Game.damage if Game.damage != null and is_instance_valid(Game.damage) else null
	var painkiller: bool = bool(dmg.get("painkiller")) if dmg != null else false

	# ---- vitals ------------------------------------------------------------------------------------
	_hurt = maxf(0.0, _hurt - dt * 1.5)
	var low_target: float = clampf((LOW_HP_AT - hp) / LOW_HP_AT, 0.0, 1.0)
	if painkiller:
		low_target *= 0.3
	if not alive:
		low_target = 1.0
	_low = lerpf(_low, low_target, 1.0 - exp(-2.5 * dt))
	_bleed_amt = lerpf(_bleed_amt, 1.0 if bleeding else 0.0, 1.0 - exp(-1.6 * dt))
	var breath_target: float = clampf((BREATH_AT - stamina) / BREATH_AT, 0.0, 1.0)
	if not playing or not alive:
		breath_target = 0.0
	_breath = lerpf(_breath, breath_target, 1.0 - exp(-3.0 * dt))
	if _breath > 0.25:
		fx.shake(_breath * 0.30)
	var grain: float = float(Game.state.get("settings", {}).get("grain", 1.0)) * 0.85
	var aberration: float = 0.10
	fx.set_post(_low, _hurt, _bleed_amt, _breath, aberration, grain)
	_vitals_audio(dt, hp, stamina, alive and playing)

	# ---- the glass ---------------------------------------------------------------------------------
	var rain := 0.0
	var world: Node = Game.world
	if world != null and is_instance_valid(world) and world.has_method("weather") and alive:
		if not bool(p.get("in_base")):
			match str(world.weather()):
				"drizzle": rain = 0.42
				"rain": rain = 0.85
				"storm": rain = 1.0
				"fog": rain = 0.12
				_: rain = 0.0
	var blood: float = clampf((BLOOD_AT - hp) / BLOOD_AT, 0.0, 1.0) * 0.8
	if not alive:
		blood = maxf(blood, 0.55)
	fx.set_lens(rain, blood)

	# ---- kit-driven overlays -----------------------------------------------------------------------
	var nvg_on := bool(kit_state.get("nvg", false))
	fx.set_nvg(nvg_on, int(kit_state.get("nvg_gen", 1)), float(kit_state.get("nvg_blind", 0.0)))
	var mask_name := str(kit_state.get("mask", ""))
	var mask_on := mask_name != ""
	fx.set_mask(mask_on, _mask_kind(mask_name), clampf(0.18 + _breath * 0.5 + float(kit_state.get("gas", 0.0)) * 0.4, 0.0, 1.0))

	# ---- optic / binocular -------------------------------------------------------------------------
	_update_scope(kit_state)

	# ---- crosshair ---------------------------------------------------------------------------------
	var weapons: Node = p.get("weapons") if p != null else null
	var ads: float = float(weapons.get("ads")) if weapons != null and is_instance_valid(weapons) and "ads" in weapons else 0.0
	crosshair.ads = maxf(ads, 1.0 if _scope_def != null else 0.0)
	crosshair.visible_amount = clampf((1.0 - watch_t) * (1.0 if (playing and alive and game_visible) else 0.0), 0.0, 1.0)
	var focus: Variant = p.get("focus") if p != null else null
	crosshair.focus_hint = lerpf(crosshair.focus_hint, 1.0 if focus != null else 0.0, 1.0 - exp(-10.0 * dt))
	crosshair.queue_redraw()

	# ---- interaction prompt ------------------------------------------------------------------------
	var ptext := str(p.get("focus_prompt")) if p != null else ""
	if not (playing and alive and game_visible) or watch_t > 0.4:
		ptext = ""
	if ptext != "" and prompt.text != ptext:
		prompt.text = ptext
		_prompt_fade = 0.0
	if ptext == "":
		prompt.text = ""
	_prompt_fade = clampf(_prompt_fade + dt / 0.12 * (1.0 if ptext != "" else -2.4), 0.0, 1.0)
	prompt.fade = _prompt_fade
	var need_hold := 0.0
	if focus != null and is_instance_valid(focus) and "hold_time" in focus:
		need_hold = float(focus.get("hold_time"))
	prompt.hold_needed = need_hold > 0.0
	if need_hold > 0.0 and p != null:
		var held := float(p.get("_interact_hold"))
		prompt.hold = clampf(held / need_hold, 0.0, 1.0) if held > 0.0 else 0.0
	else:
		prompt.hold = 0.0
	prompt.queue_redraw()

	# ---- the watch ---------------------------------------------------------------------------------
	_update_watch(dt, playing and alive and game_visible, hp, kit_state)

	# ---- status lines ------------------------------------------------------------------------------
	_status = _build_status(hp, bleeding, kit_state, dmg, playing and alive and game_visible)
	_ammo_t = maxf(0.0, _ammo_t - dt)

	# ---- fade --------------------------------------------------------------------------------------
	_fade_amount = move_toward(_fade_amount, _fade_target, dt * _fade_speed)
	fade_rect.color = Color(1, 1, 1, _fade_amount) if _fade_white else Color(0, 0, 0, _fade_amount)
	fade_rect.visible = _fade_amount > 0.002

	notices.visible = game_visible or Game.mode != "playing"
	_push_readouts()

func _mask_kind(mask_name: String) -> int:
	var n := mask_name.to_lower()
	if n.contains("respirator") or n.contains("lepestok") or n.contains("half"):
		return 0
	if n.contains("gp-7") or n.contains("gp7") or n.contains("panoram"):
		return 2
	return 1

func _update_scope(kit_state: Dictionary) -> void:
	var def: Variant = _scope_def
	if def == null and bool(kit_state.get("binoculars", false)):
		def = { "reticle": "binocular", "kind": "binocular", "zoom": float(kit_state.get("zoom", 8.0)) }
	if def == null:
		var p: Node = Game.player
		var weapons: Node = p.get("weapons") if p != null and is_instance_valid(p) else null
		if weapons != null and is_instance_valid(weapons) and weapons.has_method("optic_def"):
			var od: Variant = weapons.optic_def()
			var ads: float = float(weapons.get("ads")) if "ads" in weapons else 0.0
			if od is Dictionary and not (od as Dictionary).is_empty() and ads > 0.75 and float((od as Dictionary).get("zoom", 1.0)) > 1.5:
				def = od
	if def is Dictionary:
		var d: Dictionary = def
		var kind_s := str(d.get("kind", "optic"))
		var k := 1 if kind_s == "binocular" else (2 if kind_s == "tube" else 0)
		var zoom := float(d.get("zoom", 4.0))
		var radius: float = clampf(0.46 - zoom * 0.014, 0.24, 0.46)
		fx.set_scope(true, k, radius, 0.30 if k == 0 else 0.16)
		scope_reticle.kind = str(d.get("reticle", "duplex"))
		scope_reticle.alpha = 1.0
		scope_reticle.visible = true
		scope_reticle.queue_redraw()
	else:
		fx.set_scope(false)
		scope_reticle.visible = false

func _update_watch(dt: float, can_show: bool, hp: float, kit_state: Dictionary) -> void:
	var want: bool = can_show and Input.is_action_pressed("watch")
	if want and _watch_target < 0.5:
		if Audio.has("watch_raise"):
			Audio.play("watch_raise", null, 0.5)
		watch_raised.emit(true)
	elif not want and _watch_target > 0.5:
		watch_raised.emit(false)
	_watch_target = 1.0 if want else 0.0
	watch_t = lerpf(watch_t, _watch_target, 1.0 - exp(-(14.0 if want else 11.0) * dt))
	watch.visible = watch_t > 0.01
	if not watch.visible:
		return
	var ease: float = 1.0 - pow(1.0 - clampf(watch_t, 0.0, 1.0), 3.0)
	watch.modulate.a = clampf(watch_t * 1.4, 0.0, 1.0)
	watch.pivot_offset = Vector2(172.0, 440.0)
	watch.position = Vector2(46.0, size.y - 300.0 + (1.0 - ease) * 330.0)
	watch.rotation = deg_to_rad(lerpf(-16.0, -6.5, ease))
	var p: Node = Game.player
	watch.heading = fposmod(-float(p.get("yaw")) if p != null else 0.0, TAU)
	watch.hour = Clock.hour
	watch.day = Clock.day
	watch.night = Clock.night()
	watch.hp = hp
	watch.explorer = int(Game.state.get("explorer", 61))
	var tide := Clock.tide_in()
	watch.tide_text = "NOW" if tide <= 0.0 else Clock.tide_in_text().to_upper()
	watch.tide_soon = tide < 3600.0
	watch.second_phase += dt * 60.0 * (Clock.TIME_SCALE / 60.0)
	var bat: Dictionary = kit_state.get("battery", {}) if kit_state.has("battery") else {}
	if bat.is_empty():
		bat = { "torch": float(Game.state.get("flashlight", {}).get("battery", 0.0)), "headlamp": -1.0, "nvg": -1.0, "cells": 0 }
	watch.cells = bat
	watch.queue_redraw()
	_watch_tick += dt
	if _watch_tick > 1.0:
		_watch_tick = 0.0
		if Audio.has("watch_tick"):
			Audio.play("watch_tick", null, 0.10)

func _vitals_audio(dt: float, hp: float, stamina: float, live: bool) -> void:
	# heartbeat under 30 HP, faster the closer to the floor
	var want_heart: bool = live and hp < CRIT_HP
	if want_heart and _heart == null:
		var name := "heartbeat_loop" if hp > 15.0 else "heartbeat_fast_loop"
		if Audio.has(name):
			_heart = Audio.loop(name, null, 0.0, "SFX")
	if _heart != null and is_instance_valid(_heart):
		if want_heart:
			var g: float = clampf((CRIT_HP - hp) / CRIT_HP, 0.0, 1.0) * 0.55
			_heart.volume_db = linear_to_db(maxf(0.02, g))
		else:
			_heart.queue_free()
			_heart = null
	elif _heart != null:
		_heart = null
	# breathing when the stamina is spent
	if live and _breath > 0.2:
		_breath_t -= dt
		if _breath_t <= 0.0:
			_breath_t = lerpf(1.5, 0.62, _breath)
			var n := "breath_exhausted" if _breath > 0.62 else "breath"
			if Audio.has(n):
				Audio.play(n, null, 0.16 + _breath * 0.34)
	else:
		_breath_t = 0.0

func _build_status(hp: float, bleeding: bool, kit_state: Dictionary, dmg: Node, live: bool) -> Array:
	var out: Array = []
	if not live or watch_t > 0.35:
		return out
	var inv: Variant = Game.inventory
	if inv != null and inv.has_method("overweight"):
		var over: float = float(inv.overweight())
		if over > 0.01:
			var can_sprint: bool = inv.can_sprint() if inv.has_method("can_sprint") else true
			out.append([("OVERLOADED" if can_sprint else "IMMOBILISED") + " · %.1f / %.0f KG" % [float(inv.weight()), float(inv.capacity())], UIStyle.RED])
	if bleeding:
		var key := _quick_key_for(["bandage", "bandage_field", "ifak"])
		out.append(["BLEEDING · " + (("[%s] BANDAGE" % key) if key != "" else "NO DRESSING"), UIStyle.RED])
	if hp < CRIT_HP and hp > 0.0:
		out.append(["CONDITION CRITICAL", UIStyle.RED])
	if Clock.tide_in() < 3600.0:
		out.append(["TIDE · " + Clock.tide_in_text().to_upper(), UIStyle.RED])
	if dmg != null:
		if bool(dmg.get("painkiller")):
			out.append(["PAINKILLER · %s" % _mmss(float(dmg.get("painkiller_t"))), UIStyle.AMBER])
		if bool(dmg.get("steady")):
			out.append(["STEADY · %s" % _mmss(float(dmg.get("steady_t"))), Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.7)])
	if bool(Game.state.get("flashlight", {}).get("on", false)):
		var b := float(Game.state.get("flashlight", {}).get("battery", 0.0))
		out.append(["TORCH · %d" % int(b), UIStyle.AMBER if b > 20.0 else UIStyle.RED])
	if bool(kit_state.get("headlamp", false)):
		out.append(["HEADLAMP · %d" % int(float(kit_state.get("battery", {}).get("headlamp", 0.0))), UIStyle.AMBER])
	if bool(kit_state.get("nvg", false)):
		out.append(["NVG GEN%d · %d" % [int(kit_state.get("nvg_gen", 1)), int(float(kit_state.get("battery", {}).get("nvg", 0.0)))], Color(0.62, 0.86, 0.68)])
	if str(kit_state.get("mask", "")) != "":
		var filt := float(kit_state.get("filter", 100.0))
		if filt < 45.0:
			out.append(["FILTER · %d" % int(filt), UIStyle.RED if filt < 20.0 else UIStyle.AMBER])
	if float(kit_state.get("gas", 0.0)) > 0.15:
		out.append(["GAS", UIStyle.RED])
	if bool(kit_state.get("detector_out", false)):
		out.append([UIStyle.dot_join(["DETECTOR", str(kit_state.get("detector", "")).to_upper()]), Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.7)])
	var using := str(kit_state.get("using", ""))
	if using != "":
		out.append([UIStyle.dot_join([Data.name_of(using).to_upper(), "%d%%" % int(float(kit_state.get("use_progress", 0.0)) * 100.0)]), UIStyle.AMBER])
	return out

func _mmss(seconds: float) -> String:
	var s := int(maxf(0.0, seconds))
	return "%d:%02d" % [s / 60, s % 60]

func _quick_key_for(ids: Array) -> String:
	var kit: Node = Game.kit
	if kit == null or not is_instance_valid(kit) or not kit.has_method("quick_id"):
		return ""
	for i in 4:
		var qid := str(kit.quick_id(i))
		if qid in ids:
			return str(6 + i)
	return ""

# ── readouts ───────────────────────────────────────────────────────────────────────────────────────────
func _push_readouts() -> void:
	readouts.rows = _status
	readouts.ammo = _ammo_text
	readouts.ammo_alpha = clampf(_ammo_t / 0.5, 0.0, 1.0) if game_visible else 0.0
	readouts.objective_code = str(_objective[0])
	readouts.objective_text = str(_objective[1]) if game_visible else ""
	readouts.objective_top = 26.0 if not stats.visible else stats.size.y + 42.0
	readouts.queue_redraw()
