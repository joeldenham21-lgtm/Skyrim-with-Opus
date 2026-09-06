extends Node
## Tension state machine: CALM -> UNEASE -> HUNT -> COMBAT -> AFTERMATH -> CALM, with guaranteed rest.
var state := "CALM"
var state_t := 0.0
var tension := 0.0
var engaged := 0
var threat_near := 0.0
var _calm_guard := 0.0
var _last_combat := -1e9
var _last_shot := -1e9
var _unease := 0.0
var _unease_timer := 150.0
var _shots: Array = []

func set_state(s: String) -> void:
	if s == state: return
	var prev := state; state = s; state_t = 0.0
	if s == "CALM": _calm_guard = 90.0
	Events.director_state.emit(s, prev)

func recent_shot_at(pos: Vector3, range_m: float = 120.0) -> float:
	var t := Game.elapsed; var s := 0.0
	for sh in _shots:
		var age: float = t - sh["t"]
		if age > 6.0: continue
		var d: float = sh["pos"].distance_to(pos)
		if d > range_m: continue
		s += (1.0 - d / range_m) * (1.0 - age / 6.0)
	return clampf(s, 0.0, 1.0)

func notify(kind: String, data: Dictionary = {}) -> void:
	var t := Game.elapsed
	match kind:
		"shot":
			_shots.append({ "pos": data.get("pos", Vector3.ZERO), "t": t, "noise": data.get("noise", 1.0) })
			if _shots.size() > 24: _shots.pop_front()
			_last_shot = t
			if state != "COMBAT" and engaged > 0: set_state("COMBAT")
		"spotted": if state in ["CALM", "UNEASE", "AFTERMATH"]: set_state("HUNT")
		"damaged":
			_last_combat = t
			if data.has("source") and state != "COMBAT": set_state("COMBAT")
		"kill":
			_last_combat = t
			if state != "COMBAT": set_state("COMBAT")
		"unease":
			_unease = maxf(_unease, float(data.get("amount", 0.6)))
			if state == "CALM": set_state("UNEASE")
		"anomaly":
			_unease = maxf(_unease, 0.3)
			if state == "CALM" and _calm_guard <= 0.0: set_state("UNEASE")
	Events.director_notify.emit(kind, data)

func rest() -> void:
	set_state("CALM"); tension = 0.0; _unease = 0.0; _calm_guard = 120.0

func _process(dt: float) -> void:
	if Game.mode != "playing": return
	state_t += dt; _calm_guard = maxf(0.0, _calm_guard - dt)
	var t := Game.elapsed
	var player := Game.player
	if player == null: return
	engaged = 0; var nearest := INF; var aware_sum := 0.0
	for e in get_tree().get_nodes_in_group("entities"):
		if not e.get("alive"): continue
		var d: float = e.global_position.distance_to(player.global_position)
		if float(e.get("aware")) >= 1.0: engaged += 1
		if float(e.get("aware")) > 0.3 and d < 70.0: aware_sum += float(e.get("aware"))
		nearest = minf(nearest, d)
	threat_near = clampf((60.0 - nearest) / 60.0, 0.0, 1.0)
	_unease = maxf(0.0, _unease - dt * 0.03)
	_unease_timer -= dt
	if _unease_timer <= 0.0 and state == "CALM" and not player.in_base and _calm_guard <= 0.0:
		_unease_timer = 150.0 + randf() * 200.0; _unease = 0.5 + randf() * 0.3; set_state("UNEASE"); Events.director_event.emit("unease")
	var night := Clock.night()
	match state:
		"CALM":
			if engaged > 0: set_state("HUNT")
			elif _calm_guard <= 0.0 and (aware_sum > 0.4 or (threat_near > 0.55 and night > 0.5) or _unease > 0.4): set_state("UNEASE")
		"UNEASE":
			if engaged > 0: set_state("HUNT")
			elif aware_sum < 0.1 and _unease < 0.2 and threat_near < 0.4 and state_t > 25.0: set_state("CALM")
		"HUNT":
			if t - _last_shot < 4.0 or t - _last_combat < 4.0: set_state("COMBAT")
			elif engaged == 0 and state_t > 12.0: set_state("AFTERMATH")
		"COMBAT":
			if engaged == 0 and t - _last_shot > 8.0 and t - _last_combat > 8.0: set_state("AFTERMATH")
		"AFTERMATH":
			if engaged > 0: set_state("HUNT")
			elif state_t > 20.0: set_state("CALM")
	if player.in_base and state != "CALM" and state != "AFTERMATH": set_state("AFTERMATH")
	var target: float = { "CALM": 0.05 + night * 0.12, "UNEASE": 0.35 + _unease * 0.2, "HUNT": 0.62, "COMBAT": 1.0, "AFTERMATH": 0.3 }[state] + threat_near * 0.15
	var lambda := 4.0 if state == "COMBAT" else 0.6
	tension = lerpf(tension, clampf(target, 0.0, 1.0), 1.0 - exp(-lambda * dt))
