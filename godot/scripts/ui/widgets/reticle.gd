extends Control
class_name Reticle
## Optic reticles, drawn at the centre of the glass. The weapons module hands the HUD an optic definition
## ({ "reticle": "pso", "zoom": 4.0, "illum": true }) and this paints it; the surround and the glass come
## from shaders/ui_scope.gdshader. Kinds: dot, holo, pso, pu, acog, chevron, mildot, duplex, binocular.

var kind := ""
var illum := false
var alpha := 1.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	if kind == "" or alpha <= 0.01:
		return
	var c := size * 0.5
	var s: float = minf(size.x, size.y)
	var ink := Color(0.035, 0.033, 0.030, 0.94 * alpha)
	var red := Color(0.92, 0.22, 0.14, 0.95 * alpha)
	match kind:
		"dot":
			draw_circle(c, 3.0, red)
			draw_circle(c, 5.0, Color(red.r, red.g, red.b, 0.20 * alpha))
		"holo":
			draw_circle(c, 2.2, red)
			draw_arc(c, s * 0.055, 0.0, TAU, 64, red, 1.6, false)
			for a in [0.0, PI * 0.5, PI, PI * 1.5]:
				var d := Vector2(cos(a), sin(a))
				draw_line(c + d * s * 0.055, c + d * s * 0.070, red, 1.6, false)
		"pso", "acog", "chevron":
			var chev := PackedVector2Array([c + Vector2(0.0, -s * 0.030), c + Vector2(-s * 0.024, s * 0.014), c + Vector2(s * 0.024, s * 0.014)])
			if kind == "acog":
				draw_colored_polygon(chev, red)
			else:
				draw_polyline(chev, ink, 2.0, false)
				draw_line(chev[2], chev[0], ink, 2.0, false)
			for i in range(1, 5):
				var y := c.y + s * 0.014 + float(i) * s * 0.042
				draw_line(Vector2(c.x - s * 0.013, y), Vector2(c.x + s * 0.013, y), ink, 2.0, false)
			draw_line(Vector2(c.x - s * 0.24, c.y), Vector2(c.x - s * 0.052, c.y), ink, 2.0, false)
			draw_line(Vector2(c.x + s * 0.052, c.y), Vector2(c.x + s * 0.24, c.y), ink, 2.0, false)
			if kind == "pso":
				# the stadiametric ladder along the lower left
				var p0 := Vector2(c.x - s * 0.22, c.y + s * 0.22)
				for i in 11:
					var t := float(i) / 10.0
					draw_line(p0 + Vector2(t * s * 0.20, 0.0), p0 + Vector2(t * s * 0.20, -sqrt(t) * s * 0.058), ink, 1.6, false)
				draw_line(p0, p0 + Vector2(s * 0.20, 0.0), ink, 1.6, false)
		"pu":
			draw_line(Vector2(c.x, c.y + s * 0.012), Vector2(c.x, c.y + s * 0.40), ink, 3.0, false)
			draw_line(Vector2(c.x - s * 0.40, c.y), Vector2(c.x - s * 0.024, c.y), ink, 3.0, false)
			draw_line(Vector2(c.x + s * 0.024, c.y), Vector2(c.x + s * 0.40, c.y), ink, 3.0, false)
			draw_colored_polygon(PackedVector2Array([c + Vector2(0.0, s * 0.012), c + Vector2(-s * 0.010, s * 0.048), c + Vector2(s * 0.010, s * 0.048)]), ink)
		"mildot", "duplex":
			draw_line(Vector2(c.x - s * 0.44, c.y), Vector2(c.x + s * 0.44, c.y), ink, 1.4, false)
			draw_line(Vector2(c.x, c.y - s * 0.44), Vector2(c.x, c.y + s * 0.44), ink, 1.4, false)
			if kind == "mildot":
				for i in range(-4, 5):
					if i == 0:
						continue
					draw_circle(Vector2(c.x + float(i) * s * 0.052, c.y), 2.4, ink)
					draw_circle(Vector2(c.x, c.y + float(i) * s * 0.052), 2.4, ink)
			else:
				for sgn in [-1.0, 1.0]:
					draw_line(Vector2(c.x + sgn * s * 0.22, c.y), Vector2(c.x + sgn * s * 0.44, c.y), ink, 4.0, false)
					draw_line(Vector2(c.x, c.y + sgn * s * 0.22), Vector2(c.x, c.y + sgn * s * 0.44), ink, 4.0, false)
		"binocular":
			for cx in [-s * 0.16, s * 0.16]:
				var o := c + Vector2(cx, 0.0)
				draw_line(o + Vector2(-s * 0.05, 0.0), o + Vector2(s * 0.05, 0.0), Color(0.85, 0.85, 0.80, 0.5 * alpha), 1.0, false)
				draw_line(o + Vector2(0.0, -s * 0.05), o + Vector2(0.0, s * 0.05), Color(0.85, 0.85, 0.80, 0.5 * alpha), 1.0, false)
			for i in range(-5, 6):
				var x := c.x + s * 0.16 + float(i) * s * 0.018
				var l: float = s * 0.012 if i % 5 == 0 else s * 0.007
				draw_line(Vector2(x, c.y - l), Vector2(x, c.y + l), Color(0.85, 0.85, 0.80, 0.45 * alpha), 1.0, false)
		_:
			draw_circle(c, 2.0, red)
