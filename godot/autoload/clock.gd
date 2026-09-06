extends Node
## In-game clock: one day = 24 real minutes. The Tide comes at 05:00 on tide_day.
const DAY_SECONDS := 24.0 * 60.0
const TIME_SCALE := 86400.0 / DAY_SECONDS
const TIDE_HOUR := 5.0
var day := 1
var hour := 7.0
var tide_day := 4
var paused := false

func night() -> float:
	var dawn := 1.0 - smoothstep(4.8, 6.3, hour)
	var dusk := smoothstep(18.8, 20.6, hour)
	return clampf(maxf(dawn, dusk), 0.0, 1.0)
func is_night() -> bool: return night() > 0.6
func sun_angle() -> float: return ((hour - 6.0) / 24.0) * TAU
func sun_dir() -> Vector3:
	var a := sun_angle()
	return Vector3(cos(a), sin(a) * 0.72 + 0.04, -0.42).normalized()
func tide_in() -> float:
	var now := (day - 1) * 86400.0 + hour * 3600.0
	var tide := (tide_day - 1) * 86400.0 + TIDE_HOUR * 3600.0
	return tide - now
func tide_in_text() -> String:
	var s := maxf(0.0, tide_in())
	var d := int(s / 86400.0); var h := int(fmod(s, 86400.0) / 3600.0); var m := int(fmod(s, 3600.0) / 60.0)
	if d > 0: return "%dd %dh" % [d, h]
	if h > 0: return "%dh %02dm" % [h, m]
	return "%dm" % m
func clock_text() -> String: return "%02d:%02d" % [int(hour), int((hour - floor(hour)) * 60.0)]
func advance(seconds: float) -> void:
	var before := tide_in()
	hour += seconds / 3600.0
	while hour >= 24.0:
		hour -= 24.0; day += 1; Events.new_day.emit(day)
	var after := tide_in()
	if before > 0.0 and after <= 0.0: Events.tide_now.emit()
	if before > 3600.0 and after <= 3600.0: Events.tide_warning.emit("hour")
	if before > 600.0 and after <= 600.0: Events.tide_warning.emit("minutes")
func sleep_to_morning() -> void:
	var target := (7.0 - hour) if hour < 6.5 else (24.0 - hour + 7.0)
	advance(target * 3600.0)
func _process(delta: float) -> void:
	if not paused and Game.mode == "playing": advance(delta * TIME_SCALE)
