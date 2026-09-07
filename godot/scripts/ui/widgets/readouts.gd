extends Control
class_name HudReadouts
## The few lines of text the HUD is allowed to print over the world: the status stack in the bottom-left
## corner (only what is currently wrong — overweight, bleeding, critical, tide, torch, filter), an arms
## readout that appears only when a module asks for it, and one contract line top right.
## scripts/ui/hud.gd fills the fields; this node exists so the text draws above the effect stack.

var rows: Array = []              # [[text, Color], ...] bottom-left, first row lowest
var ammo := ""
var ammo_alpha := 0.0
var objective_code := ""
var objective_text := ""
var objective_top := 26.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	var fc := UIStyle.font(self, "caps")
	var fm := UIStyle.font(self, "mono")
	var ff := UIStyle.font(self, "figure")
	var y := size.y - 34.0
	for i in rows.size():
		var row: Array = rows[i]
		var col: Color = row[1]
		UIStyle.stencil(self, fc, Vector2(34.0, y), str(row[0]), 12, Color(col.r, col.g, col.b, 0.94), 0.75)
		y -= 19.0
	if ammo_alpha > 0.01 and ammo != "":
		var sz := ff.get_string_size(ammo, HORIZONTAL_ALIGNMENT_LEFT, -1, 26)
		UIStyle.stencil(self, ff, Vector2(size.x - 40.0 - sz.x, size.y - 40.0), ammo, 26,
			Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.90 * ammo_alpha), 0.75)
	if objective_text != "":
		var oy := objective_top
		var code := objective_code.to_upper()
		if code != "":
			var cw := fc.get_string_size(code, HORIZONTAL_ALIGNMENT_LEFT, -1, 10).x
			UIStyle.stencil(self, fc, Vector2(size.x - 30.0 - cw, oy), code, 10,
				Color(UIStyle.AMBER.r, UIStyle.AMBER.g, UIStyle.AMBER.b, 0.88), 0.65)
			oy += 17.0
		for l in UIStyle.wrap_lines(fm, 12, objective_text, 330.0):
			var lw := fm.get_string_size(l, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
			UIStyle.stencil(self, fm, Vector2(size.x - 30.0 - lw, oy), l, 12,
				Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.80), 0.65)
			oy += 16.0
