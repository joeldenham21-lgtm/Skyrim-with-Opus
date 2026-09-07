extends SceneTree
var rig: Node3D
var f := 0
var base := {}
func snap() -> Dictionary:
	var sk: Skeleton3D = rig.skeleton
	var d := {}
	for b in ["hips", "spine", "chest", "neck", "head"]:
		var i := sk.find_bone(b)
		d[b] = sk.get_bone_global_pose(i).basis.get_euler()
	d["hand_r"] = rig.sockets["hand_r"].global_position
	d["muzzle_dir"] = rig.sockets["hand_r"].global_transform.basis * Vector3.FORWARD
	return d
func _initialize() -> void:
	var RB = load("res://scripts/entities/rig_builder.gd")
	rig = RB.build("mimic", {"seed": 3})
	root.add_child(rig)
	rig.play("aim", 0.0)
	rig.anim.seek(0.5, true)
	rig.anim.pause()
func _process(_dt: float) -> bool:
	f += 1
	if f == 40:
		rig.set_aim(0.0, 0.0)
	if f == 90:
		base = snap()
		rig.set_aim(0.5, -0.9)   # 28.6 deg up, 51.6 deg left
	if f == 260:
		var n := snap()
		for b in ["hips", "spine", "chest", "neck", "head"]:
			var d: Vector3 = n[b] - base[b]
			print("%-6s euler delta deg = (%.1f, %.1f, %.1f)" % [b, rad_to_deg(d.x), rad_to_deg(d.y), rad_to_deg(d.z)])
		print("hand_r moved %.3f m; gun dir turned %.1f deg" % [(n["hand_r"] - base["hand_r"]).length(), rad_to_deg(base["muzzle_dir"].angle_to(n["muzzle_dir"]))])
		print("layer skeleton now = ", rig.layer.get_skeleton())
		quit()
	return false
