extends Control
class_name NoticeSlip
## One Committee notice: a code line and a body typed out a character at a time onto a dark slip with an
## amber edge. Kinds map to the code printed above the line (scripts/ui/notice.gd owns the queue).

var body := ""
var code := "UNPSC"
var accent := UIStyle.AMBER
var life := 7.0
var age := 0.0
var typed := 0.0          # characters revealed
var chars_per_second := 58.0
var _lines := PackedStringArray()
var _wrapped_for := -1.0

const PAD := Vector2(11.0, 8.0)
const WIDTH := 400.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	custom_minimum_size.x = WIDTH

func setup(text: String, kind: String) -> void:
	body = text
	match kind:
		"tide":
			code = "UNPSC · TIDE WARNING"
			accent = UIStyle.RED
		"warn", "danger":
			code = "UNPSC · ADVISORY"
			accent = UIStyle.RED
		"clearance", "rank":
			code = "UNPSC · PERSONNEL"
			accent = UIStyle.AMBER
		"mission", "contract":
			code = "UNPSC · CONTRACT"
			accent = UIStyle.AMBER
		"loot", "kit", "supply":
			code = "FIELD LOG"
			accent = Color(0.70, 0.70, 0.66)
		"artifact":
			code = "UNPSC · RECOVERY"
			accent = UIStyle.PINK.darkened(0.25)
		"committee":
			code = "UNPSC · COMMITTEE"
			accent = UIStyle.AMBER
		_:
			code = "UNPSC"
			accent = Color(0.70, 0.70, 0.66)
	_relayout()

func _relayout() -> void:
	var f := UIStyle.font(self, "mono")
	_lines = UIStyle.wrap_lines(f, 13, body, WIDTH - PAD.x * 2.0)
	custom_minimum_size = Vector2(WIDTH, PAD.y * 2.0 + 15.0 + float(_lines.size()) * 18.0)
	size = custom_minimum_size

func total_chars() -> int:
	var n := 0
	for l in _lines:
		n += l.length()
	return n

func advance(dt: float) -> void:
	age += dt
	typed = minf(typed + chars_per_second * dt, float(total_chars()))
	queue_redraw()

func alpha() -> float:
	var fade_in: float = clampf(age / 0.18, 0.0, 1.0)
	var fade_out: float = clampf((life - age) / 0.8, 0.0, 1.0)
	return minf(fade_in, fade_out)

func done() -> bool:
	return age > life

func _draw() -> void:
	var a := alpha()
	if a <= 0.01:
		return
	var h := size.y
	draw_rect(Rect2(Vector2.ZERO, Vector2(WIDTH, h)), Color(0.078, 0.074, 0.062, 0.62 * a), true)
	draw_rect(Rect2(Vector2.ZERO, Vector2(2.0, h)), Color(accent.r, accent.g, accent.b, 0.85 * a), true)
	draw_line(Vector2(2.0, 0.5), Vector2(WIDTH, 0.5), Color(1.0, 1.0, 1.0, 0.05 * a), 1.0, false)
	var fc := UIStyle.font(self, "caps")
	var fm := UIStyle.font(self, "mono")
	UIStyle.stencil(self, fc, Vector2(PAD.x, PAD.y + 9.0), code, 10, Color(accent.r, accent.g, accent.b, 0.92 * a), 0.5)
	var left := int(typed)
	var y := PAD.y + 27.0
	for line in _lines:
		if left <= 0:
			break
		var shown: String = line if left >= line.length() else line.substr(0, left)
		UIStyle.stencil(self, fm, Vector2(PAD.x, y), shown, 13, Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.95 * a), 0.6)
		if left < line.length():
			var w := fm.get_string_size(shown, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x
			if fmod(age, 0.9) < 0.55:
				draw_rect(Rect2(PAD.x + w + 1.0, y - 10.0, 6.0, 12.0), Color(accent.r, accent.g, accent.b, 0.8 * a), true)
		left -= line.length()
		y += 18.0
