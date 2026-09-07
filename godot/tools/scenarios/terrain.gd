extends "res://tools/scenarios/_driver.gd"
## Terrain verification: the eight views named in the brief, each with stats(). Run:
##   tools/shot.sh tools/scenarios/terrain.gd 1280x720
var t: Node = null

func _at(x: float, z: float, eye: float, yaw_deg: float, pitch_deg: float) -> void:
	var y: float = Game.world.get_height(x, z) + eye
	Game.player.teleport(x, z, y - 0.1)
	Game.player.set_look(deg_to_rad(yaw_deg), deg_to_rad(pitch_deg))
	Game.player.velocity = Vector3.ZERO
	Game.player.lock_movement(true)

func _report(name: String) -> void:
	var s := stats()
	var extra := ""
	if t and t.has_method("info"): extra = " " + str(t.info())
	print("[stats] %-14s draws %5d prims %8d fps %5.1f pos %s%s" % [name, s.draw_calls, s.primitives, s.fps, s.pos, extra])

func _view(name: String, x: float, z: float, eye: float, yaw_deg: float, pitch_deg: float, hour: float = 11.0) -> void:
	set_hour(hour)
	_at(x, z, eye, yaw_deg, pitch_deg)
	await frames(6)
	await shot(name)
	_report(name)

func run() -> void:
	await start()
	await frames(20)
	t = Game.world.get_node_or_null("Terrain")
	if t and t.has_method("info"): print("[terrain] ", t.info())
	print("[terrain] surface at Vanno: ", Game.world.get_surface(0, 300), "  height ", Game.world.get_height(0, 300))
	# 1 Vanno looking north up the road into the zone
	await _view("vanno-north", 0, 300, 1.7, 0.0, -3.0, 10.5)
	# 2 the river valley from the west bank, looking downstream
	await _view("river-valley", -95, -20, 1.7, 160.0, -6.0, 9.0)
	# 3 the road bridge from the north bank
	await _view("bridge", -60, 30, 1.7, 190.0, -5.0, 15.0)
	# 4 the flooded quarry from the rim
	await _view("quarry", 355, 120, 1.7, 95.0, -12.0, 13.0)
	# 5 the northern escarpment from the fields below
	await _view("escarpment", 10, -240, 1.7, 0.0, 4.0, 8.0)
	# 6 on top of the escarpment looking back south over the zone (the 300 m vista)
	await _view("vista-south", 0, -340, 2.2, 180.0, -6.0, 16.0)
	# 7 the marsh at dusk
	await _view("marsh-dusk", -30, 175, 1.7, 200.0, -4.0, 19.6)
	# 8 ground close-up: eye 1 m, looking down at the grass and mud
	await _view("ground-1m", 20, 250, 1.0, 30.0, -42.0, 12.0)
	# 9 the lake and pier
	await _view("lake", -380, 205, 1.7, 250.0, -3.0, 17.5)
	# 10 the radio mast hill looking west across the whole map
	await _view("mast-vista", 445, -255, 2.0, 250.0, -4.0, 11.0)
	# 11 the rail cutting
	await _view("rail", -60, -150, 1.7, 90.0, -3.0, 12.0)
	# 12 the dam
	await _view("dam", -215, -400, 2.0, 210.0, -6.0, 14.0)
