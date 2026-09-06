extends Node
## Modes, the persistent state, save/load, and the debug API used by headless scenarios.
var mode := "title"
var elapsed := 0.0
var player: Node = null
var world: Node = null
var state := {}
const SAVE_PATH := "user://save.json"

func _ready() -> void:
	state = default_state()

func default_state() -> Dictionary:
	return { "version": 2, "explorer": 61, "hp": 100.0, "stamina": 100.0, "bleeding": false, "money": 600, "earned": 0, "securityLevel": 1,
		"day": 1, "hour": 7.0, "tideLevel": 1, "tideDay": 4, "flashlight": { "on": false, "battery": 100.0 }, "inventory": null, "storage": null,
		"missions": { "active": [], "completed": [], "chainStep": 0 }, "stats": { "kills": 0, "shots": 0, "artifacts": 0, "deaths": 0, "tides": 0, "distance": 0.0 },
		"flags": {}, "settings": { "sensitivity": 1.0, "fov": 75.0, "volume": 0.8, "music": 0.8, "quality": "high", "grain": 1.0, "motion": 1.0, "targetFps": 100, "resolutionScale": 1.0, "dynamicResolution": true, "touch": "auto" }, "seed": 1987 }

func _process(dt: float) -> void:
	elapsed += dt

func set_mode(m: String) -> void:
	if m == mode: return
	mode = m; Events.mode_changed.emit(m)
	get_tree().paused = (m == "paused")
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if m == "playing" else Input.MOUSE_MODE_VISIBLE

func start(new_game: bool = true) -> void:
	if new_game: state = default_state()
	else: load_game()
	Clock.day = int(state["day"]); Clock.hour = float(state["hour"]); Clock.tide_day = int(state["tideDay"])
	Events.game_started.emit(new_game)
	Director.rest()
	set_mode("playing")

func save_game() -> bool:
	state["day"] = Clock.day; state["hour"] = Clock.hour; state["tideDay"] = Clock.tide_day
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null: return false
	f.store_string(JSON.stringify(state)); return true

func load_game() -> bool:
	if not FileAccess.file_exists(SAVE_PATH): return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if parsed is Dictionary and int(parsed.get("version", 0)) == 2:
		state = default_state(); state.merge(parsed, true); return true
	return false

func has_save() -> bool: return FileAccess.file_exists(SAVE_PATH)
