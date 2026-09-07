extends Control
class_name ScreenFX
## The screen-effect stack: everything between the rendered world and the explorer's eye. Each layer is a
## full-screen ColorRect with one of the ui_*.gdshader passes and is only visible while it has something to
## do, so a clean walk costs exactly one pass (the vitals pass) and a masked NVG night costs four.
##
## Order, back to front: post (vitals, grain, damage) → lens (rain and blood on the glass) →
## nvg (tube) → scope (optic surround) → mask (rubber).
##
## API (scripts/ui/hud.gd drives it every frame):
##   set_post(low_hp, hurt, bleed, breath, pulse, shake, aberration, grain)
##   flash(amount, colour)             Tide white-out / flashbang
##   add_hit(screen_dir, strength)     directional impact smear, screen_dir is a unit Vector2
##   set_lens(rain, blood)
##   set_nvg(on, gen, blind)
##   set_mask(on, kind, fog)
##   set_scope(on, kind, radius)
##   enabled = false                   drops the whole stack (Perf low/mobile presets)

var enabled := true:
	set(v):
		enabled = v
		_sync_visibility()

var _post: ColorRect = null
var _lens: ColorRect = null
var _nvg: ColorRect = null
var _scope: ColorRect = null
var _mask: ColorRect = null

var _hits: Array = []          # [{ dir: Vector2, strength: float, age: float, seed: float }]
var _flash := 0.0
var _flash_col := Color(1, 1, 1)
var _breath_phase := 0.0
var _pulse := 0.0
var _shake := Vector2.ZERO
var _shake_amt := 0.0
var _want := { "post": false, "lens": false, "nvg": false, "scope": false, "mask": false }

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_post = _layer("Post", "res://shaders/ui_post.gdshader")
	_lens = _layer("Lens", "res://shaders/ui_lens.gdshader")
	_nvg = _layer("Nvg", "res://shaders/ui_nvg.gdshader")
	_scope = _layer("Scope", "res://shaders/ui_scope.gdshader")
	_mask = _layer("Mask", "res://shaders/ui_mask.gdshader")
	resized.connect(_on_resized)
	_on_resized()

func _layer(n: String, shader_path: String) -> ColorRect:
	var cr := ColorRect.new()
	cr.name = n
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cr.set_anchors_preset(Control.PRESET_FULL_RECT)
	cr.color = Color(1, 1, 1, 1)
	cr.visible = false
	if ResourceLoader.exists(shader_path):
		var m := ShaderMaterial.new()
		m.shader = load(shader_path)
		cr.material = m
	add_child(cr)
	return cr

func _on_resized() -> void:
	var a: float = maxf(0.1, size.x / maxf(1.0, size.y))
	for cr in [_post, _lens, _nvg, _scope, _mask]:
		if cr != null and cr.material is ShaderMaterial:
			cr.material.set_shader_parameter("aspect", a)

func _pset(cr: ColorRect, key: String, v: Variant) -> void:
	if cr != null and cr.material is ShaderMaterial:
		cr.material.set_shader_parameter(key, v)

func _sync_visibility() -> void:
	for pair in [[_post, "post"], [_lens, "lens"], [_nvg, "nvg"], [_scope, "scope"], [_mask, "mask"]]:
		var cr: ColorRect = pair[0]
		if cr != null:
			cr.visible = enabled and bool(_want[str(pair[1])])

# ── vitals ─────────────────────────────────────────────────────────────────────────────────────────────
func set_post(low_hp: float, hurt: float, bleed: float, breath: float, aberration: float, grain: float) -> void:
	var on := enabled and (grain > 0.001 or low_hp > 0.001 or hurt > 0.001 or bleed > 0.001 or breath > 0.001
		or aberration > 0.001 or _flash > 0.001 or not _hits.is_empty() or _shake_amt > 0.0001)
	_want["post"] = on
	if not on:
		_sync_visibility()
		return
	_pset(_post, "low_hp", low_hp)
	_pset(_post, "hurt", hurt)
	_pset(_post, "bleed", bleed)
	_pset(_post, "breath", breath)
	_pset(_post, "aberration", aberration)
	_pset(_post, "grain_amt", grain)
	_pset(_post, "pulse", _pulse)
	_pset(_post, "pulse_rate", lerpf(1.05, 2.1, clampf(low_hp, 0.0, 1.0)))
	_pset(_post, "shake", _shake)
	_pset(_post, "flash", _flash)
	_pset(_post, "flash_color", Vector3(_flash_col.r, _flash_col.g, _flash_col.b))
	var names := ["hit_a", "hit_b", "hit_c", "hit_d"]
	for i in 4:
		if i < _hits.size():
			var h: Dictionary = _hits[i]
			var d: Vector2 = h["dir"]
			var s: float = float(h["strength"]) * clampf(1.0 - float(h["age"]) / 1.6, 0.0, 1.0)
			_pset(_post, names[i], Vector4(d.x, d.y, s, float(h["seed"])))
		else:
			_pset(_post, names[i], Vector4(0, 0, 0, 0))
	_sync_visibility()

func flash(amount: float, col: Color = Color(1, 1, 1)) -> void:
	_flash = maxf(_flash, clampf(amount, 0.0, 1.0))
	_flash_col = col

func shake(amount: float) -> void:
	_shake_amt = maxf(_shake_amt, amount)

func add_hit(screen_dir: Vector2, strength: float) -> void:
	_hits.append({ "dir": screen_dir.normalized(), "strength": clampf(strength, 0.0, 1.0), "age": 0.0, "seed": randf() * 10.0 })
	while _hits.size() > 4:
		_hits.pop_front()

func clear_hits() -> void:
	_hits.clear()

# ── other layers ───────────────────────────────────────────────────────────────────────────────────────
func set_lens(rain: float, blood: float) -> void:
	_want["lens"] = enabled and (rain > 0.005 or blood > 0.005)
	_pset(_lens, "rain", rain)
	_pset(_lens, "blood", blood)
	_sync_visibility()

func set_nvg(on: bool, gen: int, blind: float) -> void:
	_want["nvg"] = enabled and on
	_pset(_nvg, "amount", 1.0 if on else 0.0)
	_pset(_nvg, "gen", float(clampi(gen, 1, 3)))
	_pset(_nvg, "blind", clampf(blind, 0.0, 1.0))
	_sync_visibility()

func set_mask(on: bool, kind: int, fog: float) -> void:
	_want["mask"] = enabled and on
	_pset(_mask, "amount", 1.0 if on else 0.0)
	_pset(_mask, "kind", clampi(kind, 0, 2))
	_pset(_mask, "fog", clampf(fog, 0.0, 1.0))
	_pset(_mask, "breath", _breath_phase)
	_sync_visibility()

func set_scope(on: bool, kind: int = 0, radius: float = 0.36, shadow: float = 0.32) -> void:
	_want["scope"] = enabled and on
	_pset(_scope, "amount", 1.0 if on else 0.0)
	_pset(_scope, "kind", clampi(kind, 0, 2))
	_pset(_scope, "radius", radius)
	_pset(_scope, "shadow", shadow)
	_sync_visibility()

func _process(dt: float) -> void:
	_pulse += dt
	_breath_phase += dt
	_flash = maxf(0.0, _flash - dt * 1.6)
	for i in range(_hits.size() - 1, -1, -1):
		_hits[i]["age"] = float(_hits[i]["age"]) + dt
		if float(_hits[i]["age"]) > 1.6:
			_hits.remove_at(i)
	if _shake_amt > 0.0001:
		var t := Time.get_ticks_msec() * 0.001
		_shake = Vector2(sin(t * 41.0) * 0.55 + sin(t * 17.3) * 0.45, cos(t * 37.0) * 0.5 + sin(t * 23.7) * 0.5) * _shake_amt * 0.006
		_shake_amt = maxf(0.0, _shake_amt - dt * 1.8)
	else:
		_shake = Vector2.ZERO
