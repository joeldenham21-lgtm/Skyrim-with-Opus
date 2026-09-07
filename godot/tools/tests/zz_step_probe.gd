extends SceneTree
var rig: Node3D
var steps := []
func _initialize() -> void:
	var RB = load("res://scripts/entities/rig_builder.gd")
	rig = RB.build("mimic", {"seed": 3})
	root.add_child(rig)
	rig.footstep.connect(func(f): steps.append([f, rig.anim.current_animation_position]))
	rig.play("walk", 0.0)
	var dt := 1.0 / 60.0
	for i in 240:
		rig.anim.advance(dt)
		rig._process(dt)
	print("walk 4s -> footsteps: ", steps.size(), " ", steps)
	steps.clear()
	rig.locomotion(3.4)
	print("locomotion(3.4) picked clip=", rig.current, " speed_scale=", rig.anim.speed_scale)
	for i in 240:
		rig.anim.advance(dt * rig.anim.speed_scale)
		rig._process(dt)
	print("run 4s -> footsteps: ", steps.size())
	# aim layer sanity: does set_aim actually move the head bone?
	var sk: Skeleton3D = rig.skeleton
	rig.play("aim", 0.0)
	rig.set_aim(0.0, 0.0)
	for i in 60: rig.anim.advance(dt); rig.layer._process_modification_with_delta(dt)
	var a := sk.get_bone_global_pose(sk.find_bone("head")).origin
	rig.set_aim(0.5, -0.9)
	for i in 120: rig.anim.advance(dt); rig.layer._process_modification_with_delta(dt)
	var b := sk.get_bone_global_pose(sk.find_bone("head")).origin
	print("head pose delta after set_aim(0.5,-0.9): ", (b - a).length(), "  a=", a, " b=", b)
	print("eye_pos=", rig.eye_pos(), " height=", rig.height(), " bone_pos(hand_r)=", rig.bone_pos("hand_r"))
	# ragdoll
	rig.set_ragdoll(true)
	print("ragdoll node=", rig._ragdoll, " bones=", rig._ragdoll.get_child_count() if rig._ragdoll else -1)
	quit()
