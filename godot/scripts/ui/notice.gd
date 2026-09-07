extends Control
class_name NoticeQueue
## Committee notices, top left. Everything the world wants to tell the explorer arrives here through
## Events.notice(text, kind): rank-ups, contract updates, Tide warnings, field-log lines. They are typed
## out one line at a time, stack downward, hold for a few seconds and lift away. Four on screen at once;
## the rest wait in the queue so a burst never becomes a wall of text.
##
##   push(text, kind)   same as emitting Events.notice
##   clear()            drop everything (mode changes, death)

const MAX_ON_SCREEN := 4
const GAP := 7.0

var _live: Array[NoticeSlip] = []
var _pending: Array = []
var _slip_script: Script = null

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_slip_script = load("res://scripts/ui/widgets/notice_slip.gd")
	if not Events.notice.is_connected(_on_notice):
		Events.notice.connect(_on_notice)
	if not Events.tide_warning.is_connected(_on_tide_warning):
		Events.tide_warning.connect(_on_tide_warning)
	if not Events.mission_completed.is_connected(_on_mission_completed):
		Events.mission_completed.connect(_on_mission_completed)
	if not Events.mission_accepted.is_connected(_on_mission_accepted):
		Events.mission_accepted.connect(_on_mission_accepted)
	if not Events.new_day.is_connected(_on_new_day):
		Events.new_day.connect(_on_new_day)

func _on_notice(text: String, kind: String) -> void:
	push(text, kind)

func _on_tide_warning(kind: String) -> void:
	if kind == "hour":
		push("Tide front detected at the ring. One hour to arrival. Return to Vanno.", "tide")
	else:
		push("TIDE IMMINENT. RETURN TO VANNO.", "tide")

func _on_mission_accepted(m: Dictionary) -> void:
	var code := str(m.get("code", m.get("id", "")))
	var title := str(m.get("title", m.get("name", "")))
	push(UIStyle.dot_join([code, title, "accepted"]) + ".", "mission")

func _on_mission_completed(m: Dictionary) -> void:
	var code := str(m.get("code", m.get("id", "")))
	var pay := int(m.get("payment", m.get("pay", 0)))
	var line := UIStyle.dot_join([code, "discharged"])
	if pay > 0:
		line += ". Payment %s credited." % UIStyle.money(pay)
	else:
		line += "."
	push(line, "mission")

func _on_new_day(day: int) -> void:
	push("Day %d. Log your position at the next checkpoint." % day, "committee")

func push(text: String, kind: String = "") -> void:
	if text.strip_edges() == "":
		return
	_pending.append({ "text": text, "kind": kind })
	_pump()

func clear() -> void:
	_pending.clear()
	for s in _live:
		if is_instance_valid(s):
			s.queue_free()
	_live.clear()

func _pump() -> void:
	while _live.size() < MAX_ON_SCREEN and not _pending.is_empty():
		var item: Dictionary = _pending.pop_front()
		var slip: NoticeSlip = _slip_script.new()
		add_child(slip)
		slip.setup(str(item["text"]), str(item["kind"]))
		slip.life = clampf(3.4 + float(slip.total_chars()) * 0.045, 4.5, 11.0)
		slip.position = Vector2(0.0, _stack_height() - slip.size.y)
		slip.modulate.a = 0.0
		_live.append(slip)
		if Audio.has("ui_slip"):
			Audio.play("ui_slip", null, 0.30)

func _stack_height() -> float:
	var y := 0.0
	for s in _live:
		if is_instance_valid(s):
			y += s.size.y + GAP
	return y

func _process(dt: float) -> void:
	var y := 0.0
	for i in range(_live.size() - 1, -1, -1):
		var s: NoticeSlip = _live[i]
		if not is_instance_valid(s):
			_live.remove_at(i)
			continue
		if s.done():
			s.queue_free()
			_live.remove_at(i)
	for s in _live:
		s.advance(dt)
		s.modulate.a = s.alpha()
		s.position.x = lerpf(s.position.x, 0.0, 1.0 - exp(-14.0 * dt))
		s.position.y = lerpf(s.position.y, y, 1.0 - exp(-16.0 * dt))
		y += s.size.y + GAP
	if not _pending.is_empty():
		_pump()
