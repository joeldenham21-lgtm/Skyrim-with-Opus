extends Control
class_name StatsOverlay
## F3 telemetry. Reads Perf.stats() (scripts/render/perf.gd) plus the live world state, in the same register
## as the rest of the interface: a dark slab, hairline rules, tabular figures, no colour except a warning.
## Every figure here is one an agent has to answer for, so the budget line from GODOT.md is printed next to
## the live draw-call and primitive counts.

const W := 268.0
var _rows: Array = []
var _t := 0.0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	custom_minimum_size = Vector2(W, 260.0)
	size = custom_minimum_size

func _process(dt: float) -> void:
	if not visible:
		return
	_t += dt
	if _t < 0.25:
		return
	_t = 0.0
	_rows = _gather()
	queue_redraw()

func _gather() -> Array:
	var s := {}
	var perf: Node = Engine.get_main_loop().root.get_node_or_null("Perf") if Engine.get_main_loop() != null else null
	if perf != null and perf.has_method("stats"):
		s = perf.stats()
	var draw_calls := int(s.get("draw_calls", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)))
	var prims := int(s.get("primitives", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)))
	var vram := float(s.get("vram_mb", float(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED)) / 1048576.0))
	var fps := int(s.get("fps", Engine.get_frames_per_second()))
	var frame_ms := float(s.get("frame_ms", 0.0))
	if frame_ms <= 0.0:
		frame_ms = 1000.0 / maxf(1.0, float(fps))
	var scale := float(s.get("scale", get_viewport().scaling_3d_scale if get_viewport() != null else 1.0))
	var preset := str(s.get("preset", "—")).to_upper()
	var tree := get_tree()
	var ents := tree.get_nodes_in_group("entities").size() if tree != null else 0
	var out := [
		["FPS", "%d" % fps, fps < 60],
		["FRAME", "%.2f ms" % frame_ms, frame_ms > 16.7],
		["SCALE", "%.2f" % scale, false],
		["PRESET", preset, false],
		["DRAW", "%d / 1200" % draw_calls, draw_calls > 1200],
		["PRIM", "%.2f M / 4.00" % (float(prims) / 1e6), prims > 4000000],
		["VRAM", "%.0f MB" % vram, false],
		["ENTITIES", "%d" % ents, false],
		["", "", false],
	]
	var p: Node = Game.player
	if p != null and is_instance_valid(p):
		var pos: Vector3 = p.global_position
		out.append(["POS", "%.0f %.0f %.0f" % [pos.x, pos.y, pos.z], false])
		out.append(["HP", "%.0f" % float(Game.state.get("hp", 0.0)), float(Game.state.get("hp", 100.0)) < 30.0])
	out.append(["CLOCK", "D%d %s" % [Clock.day, Clock.clock_text()], false])
	out.append(["TIDE", Clock.tide_in_text(), Clock.tide_in() < 3600.0])
	var dir_state := str(Director.state)
	out.append(["DIRECTOR", "%s %.2f" % [dir_state, float(Director.tension)], dir_state == "COMBAT"])
	var world: Node = Game.world
	if world != null and world.has_method("weather"):
		out.append(["WEATHER", str(world.weather()).to_upper(), false])
	return out

func _draw() -> void:
	if _rows.is_empty():
		_rows = _gather()
	var fc := UIStyle.font(self, "caps")
	var fm := UIStyle.font(self, "mono")
	var h := 26.0 + float(_rows.size()) * 15.0 + 10.0
	size = Vector2(W, h)
	draw_rect(Rect2(Vector2.ZERO, Vector2(W, h)), Color(0.055, 0.052, 0.045, 0.80), true)
	draw_rect(Rect2(Vector2.ZERO, Vector2(W, h)), Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.18), false, 1.0)
	draw_string(fc, Vector2(10.0, 17.0), "TELEMETRY", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(UIStyle.AMBER.r, UIStyle.AMBER.g, UIStyle.AMBER.b, 0.85))
	draw_line(Vector2(10.0, 23.5), Vector2(W - 10.0, 23.5), Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.18), 1.0, false)
	var y := 38.0
	for r in _rows:
		var k: String = str(r[0])
		if k == "":
			draw_line(Vector2(10.0, y - 5.0), Vector2(W - 10.0, y - 5.0), Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.10), 1.0, false)
			y += 15.0
			continue
		var v: String = str(r[1])
		var warn: bool = bool(r[2])
		draw_string(fc, Vector2(10.0, y), k, HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.55))
		var col := UIStyle.RED if warn else Color(UIStyle.PAPER.r, UIStyle.PAPER.g, UIStyle.PAPER.b, 0.92)
		var sz := fm.get_string_size(v, HORIZONTAL_ALIGNMENT_LEFT, -1, 12)
		draw_string(fm, Vector2(W - 10.0 - sz.x, y), v, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, col)
		y += 15.0
