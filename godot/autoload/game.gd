extends Node
## Modes, the persistent state, save/load, and the debug API used by headless scenarios.
var mode := "title"
var elapsed := 0.0
var player: Node = null
var world: Node = null
var state := {}
# gameplay systems (created by _setup_systems on start/load; scripts under scripts/inventory, scripts/loot, scripts/player, scripts/base)
var inventory = null      # Inventory over state["inventory"]
var storage = null        # Inventory over state["storage"] (the base stash)
var loot: Node = null     # Loot (containers, piles, corpses)
var economy: Node = null  # Economy (ranks, supply crate, artifacts)
var damage: Node = null   # Damage node under the player (Game.player.dmg)
var kit: Node = null      # Kit node under the player (Game.player.kit)
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
	_setup_systems()
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
		state = default_state(); state.merge(parsed, true)
		if inventory != null: _setup_systems()
		return true
	return false

## Inventory/Storage/Loot/Economy instances plus the Damage and Kit nodes under the player. Idempotent: on a
## reload the wrappers re-read the new state (JSON numbers coerced, uid counter lifted).
func _setup_systems() -> void:
	var inv_script: Variant = load("res://scripts/inventory/inventory.gd")
	if inventory == null: inventory = inv_script.new("inventory")
	else: inventory.sync()
	if storage == null: storage = inv_script.new("storage")
	else: storage.sync()
	if economy == null:
		economy = load("res://scripts/base/economy.gd").new(); economy.name = "Economy"; add_child(economy)
	if loot == null:
		loot = load("res://scripts/loot/loot.gd").new(); loot.name = "Loot"; add_child(loot)
	if player != null and is_instance_valid(player):
		damage = player.get_node_or_null("Damage")
		if damage == null:
			damage = load("res://scripts/player/damage.gd").new(); damage.name = "Damage"; player.add_child(damage)
		kit = player.get_node_or_null("Kit")
		if kit == null:
			kit = load("res://scripts/player/kit.gd").new(); kit.name = "Kit"; player.add_child(kit)
		if "dmg" in player: player.dmg = damage
		if "kit" in player: player.kit = kit

func has_save() -> bool: return FileAccess.file_exists(SAVE_PATH)
