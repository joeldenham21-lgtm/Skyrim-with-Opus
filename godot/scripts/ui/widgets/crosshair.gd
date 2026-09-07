extends Control
class_name Crosshair
## The whole crosshair: one faint dot, and only while hip-firing. Aiming down sights hides it — the reticle
## then belongs to the optic (scripts/ui/widgets/reticle.gd). Nothing else is ever drawn here: no brackets,
## no spread petals, no hit markers.

var ads := 0.0        # 0 hip .. 1 fully aimed
var visible_amount := 1.0
var focus_hint := 0.0 # rises a little when an interactable is under the dot

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	var a: float = clampf((1.0 - ads) * visible_amount, 0.0, 1.0)
	if a <= 0.01:
		return
	var c := size * 0.5
	var r: float = 1.7 + focus_hint * 0.8
	draw_circle(c, r + 1.4, Color(0.02, 0.02, 0.02, 0.45 * a))
	var col := UIStyle.PAPER.lerp(UIStyle.AMBER, focus_hint * 0.5)
	draw_circle(c, r, Color(col.r, col.g, col.b, (0.52 + focus_hint * 0.22) * a))
