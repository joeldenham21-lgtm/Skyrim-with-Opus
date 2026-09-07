extends Control
class_name Meter
## A hairline meter: a 1 px well and a solid fill. No rounded ends, no gradient, no glow. Used by the HUD
## for battery and filter charges and by the panels for durability and condition.
##   value 0..1, warn below `warn_at` turns amber, `bad_at` turns red; `label` prints above in caps.

@export var value := 1.0:
	set(v):
		value = clampf(v, 0.0, 1.0)
		queue_redraw()
@export var label := "":
	set(v):
		label = v
		queue_redraw()
@export var warn_at := 0.5
@export var bad_at := 0.2
@export var dark := true
@export var thickness := 4.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	custom_minimum_size.y = 16.0 if label != "" else thickness

func _draw() -> void:
	var base := UIStyle.PAPER if dark else UIStyle.INK
	var y := size.y - thickness
	if label != "":
		var f := UIStyle.font(self, "caps")
		draw_string(f, Vector2(0.0, size.y - thickness - 5.0), label.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, 10,
			Color(base.r, base.g, base.b, 0.66))
	draw_rect(Rect2(0.0, y, size.x, thickness), Color(base.r, base.g, base.b, 0.16), true)
	var col := base
	if value < bad_at:
		col = UIStyle.RED if dark else UIStyle.RED_INK
	elif value < warn_at:
		col = UIStyle.AMBER if dark else UIStyle.AMBER_INK
	draw_rect(Rect2(0.0, y, size.x * value, thickness), col, true)
