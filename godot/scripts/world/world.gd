extends Node3D
## World root (Game.world). Instantiates the optional subsystem scenes in order (each is owned by one agent and may
## not exist yet): Terrain, Water, Sky, Structures, Flora, Anomalies. Terrain queries delegate to the Terrain child.
## Registries are filled by structures/terrain via register(): cover_points, spawn_spots, loot_spots, hiding_spots,
## footprints ({x,z,r} areas flora keeps clear). Emits Events.world_ready when all children exist.
const CHILD_SCENES := [
	["Terrain", "res://scenes/world/terrain.tscn"], ["Water", "res://scenes/world/water.tscn"], ["Sky", "res://scenes/world/sky.tscn"],
	["Structures", "res://scenes/world/structures.tscn"], ["Flora", "res://scenes/world/flora.tscn"], ["Anomalies", "res://scenes/world/anomalies.tscn"]]
var cover_points: Array[Dictionary] = []
var spawn_spots: Array[Dictionary] = []
var loot_spots: Array[Dictionary] = []
var hiding_spots: Array[Dictionary] = []
var footprints: Array[Dictionary] = []
var terrain: Node = null
var water: Node = null
var sky: Node = null
var ready_done := false
var size: float = 640.0
var water_level: float = -0.6

func _ready() -> void:
	Game.world = self
	size = float(Data.map.get("SIZE", 640)); water_level = float(Data.map.get("WATER_LEVEL", -0.6))
	for pair in CHILD_SCENES:
		if has_node(pair[0]): continue
		if ResourceLoader.exists(pair[1]):
			var t0 := Time.get_ticks_msec()
			var n: Node = load(pair[1]).instantiate(); n.name = pair[0]; add_child(n)
			print("[world] %s ready in %d ms" % [pair[0], Time.get_ticks_msec() - t0])
	terrain = get_node_or_null("Terrain"); water = get_node_or_null("Water"); sky = get_node_or_null("Sky")
	ready_done = true
	Events.world_ready.emit()

func get_height(x: float, z: float) -> float:
	if terrain and terrain.has_method("get_height"): return terrain.get_height(x, z)
	return 5.5
func get_normal(x: float, z: float) -> Vector3:
	if terrain and terrain.has_method("get_normal"): return terrain.get_normal(x, z)
	return Vector3.UP
func get_surface(x: float, z: float) -> String:
	if terrain and terrain.has_method("get_surface"): return terrain.get_surface(x, z)
	return "grass"
func in_water(x: float, z: float) -> bool:
	if water and water.has_method("in_water"): return water.in_water(x, z)
	return get_height(x, z) < water_level
func water_height(x: float, z: float) -> float:
	if water and water.has_method("water_height"): return water.water_height(x, z)
	return water_level
func poi(id: String) -> Dictionary:
	for p in Data.map.get("POIS", []):
		if p.get("id", "") == id: return p
	return {}
func pois() -> Array: return Data.map.get("POIS", [])
func nearest_poi(x: float, z: float) -> Dictionary:
	var best := {}; var bd := INF
	for p in pois():
		var d := Vector2(x - float(p.x), z - float(p.z)).length() - float(p.get("r", 0.0))
		if d < bd: bd = d; best = p
	return best
func poi_at(x: float, z: float) -> Dictionary:
	for p in pois():
		if Vector2(x - float(p.x), z - float(p.z)).length() <= float(p.get("r", 0.0)): return p
	return {}
func register(kind: String, d: Dictionary) -> void:
	match kind:
		"cover": cover_points.append(d)
		"spawn": spawn_spots.append(d)
		"loot": loot_spots.append(d)
		"hiding": hiding_spots.append(d)
		"footprint": footprints.append(d)
		_: push_warning("World.register: unknown kind " + kind)
func in_footprint(x: float, z: float, margin: float = 0.0) -> bool:
	for f in footprints:
		if Vector2(x - float(f.x), z - float(f.z)).length() <= float(f.r) + margin: return true
	return false
func weather() -> String:
	if sky and "weather" in sky: return sky.weather
	return "overcast"
