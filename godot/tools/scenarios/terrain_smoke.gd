extends "res://tools/scenarios/_driver.gd"
## Headless smoke test for the terrain/water data path (no rendering): timings, queries and sanity checks.
func run() -> void:
	await start()
	await frames(5)
	var t: Node = Game.world.get_node_or_null("Terrain")
	var w: Node = Game.world.get_node_or_null("Water")
	print("[smoke] terrain=", t != null, " water=", w != null)
	if t and t.has_method("info"): print("[smoke] info ", t.info())
	var pts := [[0, 300, "vanno"], [-70, 69, "bridge"], [430, 130, "quarry"], [0, -300, "ridge"], [-40, 140, "marsh"],
		[-470, 220, "lake"], [440, -262, "mast"], [-235, -435, "dam"], [-140, -134, "railbridge"], [-130, 60, "zarya"]]
	for p in pts:
		var x := float(p[0]); var z := float(p[1])
		var hh: float = Game.world.get_height(x, z)
		var nn: Vector3 = Game.world.get_normal(x, z)
		var s: String = Game.world.get_surface(x, z)
		var inw: bool = Game.world.in_water(x, z)
		var wh: float = Game.world.water_height(x, z)
		print("[smoke] %-10s h %7.2f slope %.3f surf %-8s water %s (%.2f)" % [p[2], hh, 1.0 - nn.y, s, inw, wh])
	# query throughput
	var t0 := Time.get_ticks_usec()
	var acc := 0.0
	for i in 20000: acc += Game.world.get_height(randf_range(-600, 600), randf_range(-600, 600))
	print("[smoke] 20k get_height in %.1f ms" % ((Time.get_ticks_usec() - t0) / 1000.0))
	t0 = Time.get_ticks_usec()
	for i in 5000: Game.world.get_surface(randf_range(-600, 600), randf_range(-600, 600))
	print("[smoke] 5k get_surface in %.1f ms" % ((Time.get_ticks_usec() - t0) / 1000.0))
	# a physics probe: does the collider agree with get_height?
	var space := Game.player.get_world_3d().direct_space_state
	var bad := 0
	var maxerr := 0.0
	for i in 200:
		var x := randf_range(-620, 620); var z := randf_range(-620, 620)
		var hq: float = Game.world.get_height(x, z)
		var q := PhysicsRayQueryParameters3D.create(Vector3(x, hq + 60.0, z), Vector3(x, hq - 60.0, z))
		q.collision_mask = 1
		var r := space.intersect_ray(q)
		if r.is_empty(): bad += 1
		else: maxerr = maxf(maxerr, absf(r.position.y - hq))
	print("[smoke] collider: %d/200 misses, max |dy| %.3f m" % [bad, maxerr])
