extends "res://tools/scenarios/_driver.gd"
## Raw body probe: the skinned humanoid body with the mimic shader, rest pose and a posed frame, front and side.
func run() -> void:
	await start(true)
	var start: Dictionary = Data.map.get("START", {"x": 0, "z": 284})
	var sx := float(start.get("x", 0)); var sz := float(start.get("z", 284))
	teleport(sx, sz); look(0.0, 0.0)
	await frames(40)
	var py: float = Game.player.global_position.y
	var kinds := ["mimic", "phantom", "seeker"]
	var t0 := Time.get_ticks_msec()
	var i := 0
	for kind in kinds:
		var def := HumanoidDef.make(HumanoidDef.params(kind))
		var root := Node3D.new(); get_tree().current_scene.get_node("Entities").add_child(root)
		root.global_position = Vector3(sx - 1.6 + i * 1.6, py, sz - 4.0)
		var sk := HumanoidDef.skeleton(def); root.add_child(sk)
		var clothing := { "jacket": kind != "phantom", "trousers": kind != "phantom", "boots": kind != "phantom", "gloves": kind == "seeker" }
		var mesh := HumanoidBody.build(def, { "clothing": clothing, "jitter": 0.003 if kind == "mimic" else 0.0 })
		var mi := MeshInstance3D.new(); mi.mesh = mesh; mi.skin = sk.create_skin_from_rest_transforms(); sk.add_child(mi)
		var mat := ShaderMaterial.new(); mat.shader = load("res://shaders/mimic.gdshader"); mi.material_override = mat
		print("[rigs_body] %s tris=%d verts=%d" % [kind, mesh.surface_get_array_index_len(0) / 3, mesh.surface_get_array_len(0)])
		# pose the middle one: arm forward, head turned, knee bent
		if kind == "phantom":
			sk.set_bone_pose_rotation(sk.find_bone("upper_arm_r"), Quaternion(Vector3.RIGHT, deg_to_rad(70)))
			sk.set_bone_pose_rotation(sk.find_bone("forearm_r"), Quaternion(Vector3.RIGHT, deg_to_rad(60)))
			sk.set_bone_pose_rotation(sk.find_bone("head"), Quaternion(Vector3.UP, deg_to_rad(40)))
			sk.set_bone_pose_rotation(sk.find_bone("thigh_l"), Quaternion(Vector3.RIGHT, deg_to_rad(35)))
			sk.set_bone_pose_rotation(sk.find_bone("shin_l"), Quaternion(Vector3.RIGHT, deg_to_rad(-50)))
			sk.set_bone_pose_rotation(sk.find_bone("index_r_1"), Quaternion(Vector3.BACK, deg_to_rad(-60)))
			sk.set_bone_pose_rotation(sk.find_bone("index_r_2"), Quaternion(Vector3.BACK, deg_to_rad(-60)))
		i += 1
	print("[rigs_body] built in %d ms" % (Time.get_ticks_msec() - t0))
	set_hour(12.0)
	await frames(4)
	await shot("front")
	teleport(sx + 3.0, sz - 4.0); look(deg_to_rad(90), 0.0); await frames(3)
	await shot("side")
	teleport(sx - 0.2, sz - 2.6); look(deg_to_rad(10), deg_to_rad(20)); await frames(3)
	await shot("close-head")
	teleport(sx + 1.0, sz - 3.2); look(deg_to_rad(40), deg_to_rad(15)); await frames(3)
	await shot("close-hand")
	print("[stats] ", JSON.stringify(stats()))
