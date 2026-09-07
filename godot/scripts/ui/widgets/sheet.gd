extends PanelContainer
class_name SheetPanel
## A piece of Committee stock: the "Sheet" stylebox plus the paper grain shader (shaders/ui_paper.gdshader)
## and a torn top rule. Every paper panel in the game (terminal, supply, register, map) should use this so
## the stock matches. Set `grain` to 0 for a clean sheet, `seed_v` to vary the foxing between sheets.

@export var grain := 0.5:
	set(v):
		grain = v
		if _wash != null:
			_wash.material.set_shader_parameter("strength", grain)
@export var seed_v := 0.0:
	set(v):
		seed_v = v
		if _wash != null:
			_wash.material.set_shader_parameter("seed", Vector2(v * 0.37, v * 0.11))
@export var top_rule := true

var _wash: ColorRect = null

func _ready() -> void:
	theme_type_variation = "Sheet"
	_wash = ColorRect.new()
	_wash.name = "Grain"
	_wash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_wash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_wash.color = Color(1, 1, 1, 1)
	var path := "res://shaders/ui_paper.gdshader"
	if ResourceLoader.exists(path):
		var m := ShaderMaterial.new()
		m.shader = load(path)
		m.set_shader_parameter("strength", grain)
		m.set_shader_parameter("seed", Vector2(seed_v * 0.37, seed_v * 0.11))
		m.set_shader_parameter("tint", Vector3(0.10, 0.09, 0.08))
		_wash.material = m
	else:
		_wash.color = Color(0, 0, 0, 0)
	add_child(_wash)
	move_child(_wash, 0)

func _draw() -> void:
	if not top_rule:
		return
	# a perforated top edge: the sheet was torn from a pad
	var x := 0.0
	while x < size.x:
		draw_rect(Rect2(x, 0.0, 7.0, 2.0), Color(UIStyle.INK.r, UIStyle.INK.g, UIStyle.INK.b, 0.18), true)
		x += 11.0
