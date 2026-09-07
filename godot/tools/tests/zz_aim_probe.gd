extends SceneTree
var rig: Node3D
var f := 0
var a := Vector3.ZERO
var ga := Vector3.ZERO
func _initialize() -> void:
	var RB = load("res://scripts/entities/rig_builder.gd")
	rig = RB.build("mimic", {"seed": 3})
	root.add_child(rig)
	rig.play("aim", 0.0)
	print("layer=", rig.layer, " active=", rig.layer.active, " influence=", rig.layer.influence, " skel=", rig.layer.get_skeleton())
func _process(dt: float) -> bool:
	f += 1
	var sk: Skeleton3D = rig.skeleton
	if f == 30:
		rig.set_aim(0.0, 0.0)
	if f == 60:
		a = sk.get_bone_global_pose(sk.find_bone("head")).origin
		ga = rig.sockets["hand_r"].global_position
		rig.set_aim(0.6, -1.0)
	if f == 200:
		var b := sk.get_bone_global_pose(sk.find_bone("head")).origin
		var gb: Vector3 = rig.sockets["hand_r"].global_position
		print("aim clip: head moved %.4f m  (a=%s b=%s)" % [(b - a).length(), a, b])
		print("aim clip: hand_r socket moved %.4f m" % (gb - ga).length())
		rig.play("idle", 0.0); rig.set_aim(0.0, 0.0)
	if f == 240:
		a = sk.get_bone_global_pose(sk.find_bone("head")).origin
		rig.set_aim(0.4, 1.0)
	if f == 380:
		var b := sk.get_bone_global_pose(sk.find_bone("head")).origin
		print("idle clip (head-look only): head moved %.4f m" % (b - a).length())
		rig.kick(1.0)
	if f == 400:
		print("glitch/kick ok; _kick=", rig.layer._kick)
		quit()
	return false
