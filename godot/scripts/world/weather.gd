extends Node
## Weather of the Pechorsk zone: states clear / overcast / drizzle / rain / fog / storm with slow transitions,
## a schedule with an overcast bias (storms rare, fog at dawn), gusting wind, and the storm's lightning and thunder.
## Owned by the Sky node (scripts/world/sky.gd), which reads `params` every frame and drives lights, sky and fog.
## set_weather(name, seconds) starts a transition; the Director and the Tide may force states through force_weather().

const STATES := {
	# coverage: cloud cover; dark: lid darkening; soft: stratus softness; haze: Mie turbidity; fog: fog weather level;
	# vol: volumetric fog density; dist: distance fog density; rain: precipitation 0..1 (drizzle < 0.5 < rain);
	# wind: mean wind m/s; sun: sun energy factor under the lid; sky_affect: how much fog also veils the sky.
	"clear":    { "coverage": 0.30, "dark": 0.00, "soft": 0.05, "haze": 0.28, "fog": 0.00, "vol": 0.0055, "dist": 0.0011, "rain": 0.00, "wind": 1.8, "sun": 1.00, "sky_affect": 0.22, "storm": 0.0, "ambient": 1.0 },
	"overcast": { "coverage": 0.90, "dark": 0.18, "soft": 0.35, "haze": 0.46, "fog": 0.00, "vol": 0.0110, "dist": 0.0021, "rain": 0.00, "wind": 2.6, "sun": 0.40, "sky_affect": 0.35, "storm": 0.0, "ambient": 1.0 },
	"drizzle":  { "coverage": 0.97, "dark": 0.28, "soft": 0.70, "haze": 0.60, "fog": 0.12, "vol": 0.0170, "dist": 0.0032, "rain": 0.35, "wind": 3.2, "sun": 0.28, "sky_affect": 0.50, "storm": 0.0, "ambient": 0.92 },
	"rain":     { "coverage": 1.00, "dark": 0.45, "soft": 0.75, "haze": 0.72, "fog": 0.18, "vol": 0.0220, "dist": 0.0042, "rain": 1.00, "wind": 4.6, "sun": 0.20, "sky_affect": 0.60, "storm": 0.0, "ambient": 0.85 },
	"fog":      { "coverage": 0.92, "dark": 0.05, "soft": 0.95, "haze": 1.00, "fog": 1.00, "vol": 0.0500, "dist": 0.0140, "rain": 0.00, "wind": 0.8, "sun": 0.42, "sky_affect": 0.95, "storm": 0.0, "ambient": 1.5 },
	"storm":    { "coverage": 1.00, "dark": 0.80, "soft": 0.50, "haze": 0.80, "fog": 0.22, "vol": 0.0280, "dist": 0.0050, "rain": 1.00, "wind": 9.0, "sun": 0.12, "sky_affect": 0.65, "storm": 1.0, "ambient": 0.75 },
}
const NAMES := ["clear", "overcast", "drizzle", "rain", "fog", "storm"]

var state := "overcast"          # the state being transitioned to (or reached)
var prev_state := "overcast"
var params := {}                 # current interpolated parameters
var progress := 1.0              # 0..1 through the current transition
var forced := false
var _from := {}
var _to := {}
var _dur := 1.0
var _schedule_t := 300.0
var _force_t := 0.0
var rng := RandomNumberGenerator.new()

# wind
var wind := Vector2.ZERO         # m/s, world xz
var wind_speed := 2.6
var gust := 0.0
var _wind_angle := 0.9
var _wind_t := 0.0
var _gust_boost := 0.0

# lightning
var lightning := 0.0             # sky-wide flash 0..1
var bolt := 0.0                  # the bolt itself, for a few frames
var lightning_dir := Vector3(0.0, 0.0, 1.0)
var _strike_cool := 25.0
var _second := 0.0
var _thunder_in := 0.0
var _thunder_near := false
var _thunder_gain := 0.5

func _ready() -> void:
	rng.seed = int(Game.state.get("seed", 1987)) * 7919 + 17
	_from = STATES["overcast"].duplicate(); _to = _from.duplicate(); params = _from.duplicate()
	_schedule_t = 240.0 + rng.randf() * 240.0
	Events.director_state.connect(_on_director)
	Events.new_day.connect(func(_d: int) -> void: _schedule_t = minf(_schedule_t, 30.0))

func set_weather(name: String, seconds: float = 120.0) -> void:
	if not STATES.has(name):
		push_warning("weather: unknown state " + name); return
	var prev := state
	_from = params.duplicate()
	_to = STATES[name].duplicate()
	_dur = maxf(0.001, seconds)
	progress = 0.0 if seconds > 0.0 else 1.0
	prev_state = prev
	state = name
	if progress >= 1.0: params = _to.duplicate()
	if name != prev: Events.weather_changed.emit(name, prev)

## The Director/Tide force a state for a while; the schedule resumes afterwards.
func force_weather(name: String, seconds: float = 120.0, hold: float = 600.0) -> void:
	forced = true; _force_t = hold
	set_weather(name, seconds)

func _on_director(s: String, _prev: String) -> void:
	match s:
		"HUNT": _gust_boost = maxf(_gust_boost, 0.35)
		"COMBAT": _gust_boost = maxf(_gust_boost, 0.5)
		"UNEASE": _gust_boost = maxf(_gust_boost, 0.2)

func _pick_next(hour: float) -> String:
	var dawn := 1.0 if (hour >= 4.0 and hour <= 8.5) else 0.0
	var evening := 1.0 if (hour >= 14.0 or hour < 5.0) else 0.0
	var w := {
		"clear": 11.0, "overcast": 40.0, "drizzle": 17.0, "rain": 11.0,
		"fog": 4.0 + dawn * 14.0, "storm": 1.5 + evening * 3.0,
	}
	# stickiness and no immediate storm from clear
	w[state] = w[state] * 1.5
	if state == "clear": w["storm"] = 0.3
	if state == "storm": w["rain"] += 20.0; w["overcast"] += 10.0
	var total := 0.0
	for k in w: total += w[k]
	var r := rng.randf() * total
	for k in NAMES:
		r -= w[k]
		if r <= 0.0: return k
	return "overcast"

func _process(dt: float) -> void:
	# transition
	if progress < 1.0:
		progress = minf(1.0, progress + dt / _dur)
		var t := smoothstep(0.0, 1.0, progress)
		for k in _to: params[k] = lerpf(float(_from.get(k, _to[k])), float(_to[k]), t)
	# schedule (only while the game plays; forced states hold)
	if Game.mode == "playing":
		if forced:
			_force_t -= dt
			if _force_t <= 0.0: forced = false
		else:
			_schedule_t -= dt
			if _schedule_t <= 0.0:
				var next := _pick_next(Clock.hour)
				_schedule_t = 200.0 + rng.randf() * 380.0
				if next != state: set_weather(next, 60.0 + rng.randf() * 120.0)
	# wind: slow direction wander, gusts from incommensurate sines, storm bursts
	_wind_t += dt
	_wind_angle += dt * 0.004 * sin(_wind_t * 0.013 + 1.0)
	var base := float(params.get("wind", 2.6))
	var g := 0.5 + 0.5 * (sin(_wind_t * 0.37) * 0.5 + sin(_wind_t * 0.91 + 1.3) * 0.3 + sin(_wind_t * 2.3 + 0.4) * 0.2)
	_gust_boost = maxf(0.0, _gust_boost - dt * 0.05)
	gust = lerpf(gust, g * (0.6 + 0.8 * float(params.get("storm", 0.0))) + _gust_boost, 1.0 - exp(-dt * 0.8))
	wind_speed = base * (0.55 + 0.9 * gust)
	wind = Vector2(cos(_wind_angle), sin(_wind_angle)) * wind_speed
	_lightning(dt)

func _lightning(dt: float) -> void:
	var storm := float(params.get("storm", 0.0))
	if Game.mode == "playing" or lightning > 0.0 or _second > 0.0 or _thunder_in > 0.0:
		_strike_cool = maxf(0.0, _strike_cool - dt)
		if storm > 0.3 and _strike_cool <= 0.0 and lightning < 0.01 and Game.mode == "playing":
			if rng.randf() < dt / (30.0 / storm):
				strike()
		if _second > 0.0:
			_second -= dt
			if _second <= 0.0: _flash(0.35 + rng.randf() * 0.5, false)
		if _thunder_in > 0.0:
			_thunder_in -= dt
			if _thunder_in <= 0.0:
				var name := "thunder_near" if _thunder_near else "thunder_far"
				if Audio.has(name): Audio.play(name, null, _thunder_gain)
				elif Audio.has("thunder"): Audio.play("thunder", null, _thunder_gain)
	bolt = maxf(0.0, bolt - dt)
	lightning *= exp(-dt * 9.0)
	if lightning < 0.002: lightning = 0.0

## A strike: azimuth and distance chosen here; the flash now, a second flicker, thunder when the sound arrives.
func strike(distance_km: float = -1.0) -> void:
	var az := rng.randf() * TAU
	lightning_dir = Vector3(cos(az), 0.35, sin(az)).normalized()
	if distance_km < 0.0: distance_km = 0.6 + pow(rng.randf(), 1.5) * 6.0
	_flash(0.55 + rng.randf() * 0.45, true)
	_second = 0.08 + rng.randf() * 0.18
	_thunder_in = distance_km * 2.9
	_thunder_near = distance_km < 1.8
	_thunder_gain = clampf(1.0 - distance_km / 8.0, 0.25, 1.0)
	_strike_cool = 14.0 + rng.randf() * 36.0

func _flash(strength: float, first: bool) -> void:
	lightning = maxf(lightning, strength)
	bolt = 0.09 if first else 0.05
