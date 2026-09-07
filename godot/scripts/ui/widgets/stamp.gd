extends Control
class_name Stamp
## A rubber stamp: letterspaced caps inside a double rule, rotated a few degrees, with the ink broken up so
## it never reads as a clean vector box. Panels use it for VOID / PAID / RECOVERED / CLEARANCE 2.

@export var text := "VOID":
	set(v):
		text = v
		_measure()
		queue_redraw()
@export var accent := UIStyle.AMBER_INK:
	set(v):
		accent = v
		queue_redraw()
@export var angle_deg := -6.0:
	set(v):
		angle_deg = v
		queue_redraw()
@export var font_size := 16

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_measure()

func _measure() -> void:
	var f := UIStyle.font(self, "caps_wide")
	var s := f.get_string_size(text.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	custom_minimum_size = Vector2(s.x + 34.0, font_size + 20.0)
	size = custom_minimum_size

func _draw() -> void:
	var f := UIStyle.font(self, "caps_wide")
	var t := text.to_upper()
	var s := f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	var w := s.x + 34.0
	var h := float(font_size) + 20.0
	draw_set_transform(Vector2(w, h) * 0.5, deg_to_rad(angle_deg), Vector2.ONE)
	var r := Rect2(-w * 0.5, -h * 0.5, w, h)
	# broken ink: the rule is drawn as short dashes with jitter
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(t)
	for pass_i in 2:
		var inset := 0.0 if pass_i == 0 else 3.0
		var rr := r.grow(-inset)
		var corners := [rr.position, Vector2(rr.end.x, rr.position.y), rr.end, Vector2(rr.position.x, rr.end.y)]
		for i in 4:
			var a: Vector2 = corners[i]
			var b: Vector2 = corners[(i + 1) % 4]
			var n := int(a.distance_to(b) / 5.0)
			for k in n:
				if rng.randf() < 0.16:
					continue
				var t0: float = float(k) / float(n)
				var t1: float = float(k + 1) / float(n)
				draw_line(a.lerp(b, t0), a.lerp(b, t1 - 0.08), Color(accent.r, accent.g, accent.b, 0.86), 2.0, false)
	# the word, with a few bites out of it
	draw_string(f, Vector2(-s.x * 0.5, s.y * 0.32), t, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, Color(accent.r, accent.g, accent.b, 0.88))
	for i in 9:
		var p := Vector2(rng.randf_range(-w * 0.45, w * 0.45), rng.randf_range(-h * 0.32, h * 0.32))
		draw_circle(p, rng.randf_range(0.8, 2.2), Color(accent.r, accent.g, accent.b, 0.16))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
