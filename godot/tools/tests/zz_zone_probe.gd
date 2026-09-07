extends SceneTree
var rig: Node3D
var f := 0
func _initialize() -> void:
	var RB = load("res://scripts/entities/rig_builder.gd")
	rig = RB.build("mimic", {"seed": 3})
	root.add_child(rig)
	rig.play("idle", 0.0)
func _physics_process(_dt: float) -> bool:
	f += 1
	if f < 20: return false
	var ss := root.world_3d.direct_space_state
	var hits := {}
	for spec in [["head", 1.60], ["chest", 1.35], ["stomach", 1.10], ["leg", 0.55], ["arm", 1.25]]:
		var y: float = spec[1]
		var p := PhysicsRayQueryParameters3D.create(Vector3(0, y, -3.0), Vector3(0, y, 3.0))
		p.collision_mask = 1 | 4 | 8      # layers 1,3,4
		p.collide_with_areas = true
		p.collide_with_bodies = true
		var r := ss.intersect_ray(p)
		if r.is_empty(): hits[spec[0]] = "MISS"
		else:
			var c = r["collider"]
			hits[spec[0]] = "%s zone=%s entity=%s" % [c.name, str(c.get_meta("zone", "-")), str(c.get_meta("entity", null))]
	for k in hits: print("ray y-scan %-8s -> %s" % [k, hits[k]])
	# also list the zone layers
	var z0: Area3D = rig.zones()[0]
	print("zone[0] name=%s layer=%d mask=%d monitorable=%s monitoring=%s" % [z0.name, z0.collision_layer, z0.collision_mask, z0.monitorable, z0.monitoring])
	print("zone names: ", rig.zones().map(func(a): return a.name))
	quit()
	return true
