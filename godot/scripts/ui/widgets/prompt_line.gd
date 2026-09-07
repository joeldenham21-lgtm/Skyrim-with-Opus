extends Control
class_name PromptLine
## The interaction prompt in the register's voice: a key glyph in a hairline box, then the action and the
## subject in letterspaced caps — "[E] SEARCH · CRATE" (GEAR.md §6). Fades in over 0.12 s; a hold action
## draws a hairline that fills as the reach completes.

var text := ""
var fade := 0.0        # 0..1
var hold := 0.0        # 0..1 progress, <0 = no hold
var hold_needed := false

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _parse() -> Array:
	var key := "E"
	var body := text
	if text.begins_with("["):
		var i := text.find("]")
		if i > 0:
			key = text.substr(1, i - 1)
			body = text.substr(i + 1).strip_edges()
	return [key.to_upper(), body.to_upper()]

func _draw() -> void:
	if fade <= 0.01 or text == "":
		return
	var parts := _parse()
	var key: String = parts[0]
	var body: String = parts[1]
	var fk := UIStyle.font(self, "mono_semibold")
	var fb := UIStyle.font(self, "caps")
	var ks := 12
	var bs := 14
	var key_w := maxf(20.0, fk.get_string_size(key, HORIZONTAL_ALIGNMENT_LEFT, -1, ks).x + 12.0)
	var body_w := fb.get_string_size(body, HORIZONTAL_ALIGNMENT_LEFT, -1, bs).x
	var total := key_w + 12.0 + body_w
	var x := (size.x - total) * 0.5
	var y := size.y * 0.5
	var a := fade

	# key glyph: a hairline box, amber ink
	var box := Rect2(x, y - 11.0, key_w, 22.0)
	draw_rect(box, Color(0.02, 0.02, 0.02, 0.36 * a), true)
	draw_rect(box, Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.30 * a), false, 1.0)
	var ksz := fk.get_string_size(key, HORIZONTAL_ALIGNMENT_LEFT, -1, ks)
	UIStyle.stencil(self, fk, Vector2(box.position.x + (key_w - ksz.x) * 0.5, y + 5.0), key, ks,
		Color(UIStyle.AMBER.r, UIStyle.AMBER.g, UIStyle.AMBER.b, a))
	# body
	UIStyle.stencil(self, fb, Vector2(x + key_w + 12.0, y + 5.0), body, bs,
		Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.94 * a))
	# hold reach
	if hold_needed:
		var w := 132.0
		var hx := (size.x - w) * 0.5
		var hy := y + 20.0
		draw_line(Vector2(hx, hy), Vector2(hx + w, hy), Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.22 * a), 1.0, false)
		if hold > 0.0:
			draw_line(Vector2(hx, hy), Vector2(hx + w * clampf(hold, 0.0, 1.0), hy), Color(UIStyle.AMBER.r, UIStyle.AMBER.g, UIStyle.AMBER.b, 0.95 * a), 2.0, false)
