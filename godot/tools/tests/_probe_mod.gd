extends SceneTree
## Probe 2: does a GDScript SkeletonModifier3D get _process_modification calls; does AnimationPlayer drive bone poses; process order.
class Mod extends SkeletonModifier3D:
	var calls := 0
	func _process_modification() -> void:
		calls += 1
		var sk := get_skeleton()
		if sk: sk.set_bone_pose_rotation(1, sk.get_bone_pose_rotation(1) * Quaternion(Vector3.UP, 0.5))
class ModD extends SkeletonModifier3D:
	var calls := 0
	func _process_modification_with_delta(_d: float) -> void: calls += 1
class Layer extends Node:
	var sk: Skeleton3D
	var seen := []
	func _process(_d: float) -> void: seen.append(sk.get_bone_pose_rotation(1))
var frames := 0
var sk: Skeleton3D
var mod: Mod
var modd: ModD
var layer: Layer
var ap: AnimationPlayer
func _initialize() -> void:
	var root := Node3D.new(); get_root().add_child(root)
	sk = Skeleton3D.new(); sk.name = "Skeleton3D"; root.add_child(sk)
	var a := sk.add_bone("a"); sk.set_bone_rest(a, Transform3D(Basis(), Vector3(0, 0, 0)))
	var b := sk.add_bone("b"); sk.set_bone_parent(b, a); sk.set_bone_rest(b, Transform3D(Basis(), Vector3(0, 1, 0)))
	sk.reset_bone_poses()
	mod = Mod.new(); sk.add_child(mod); modd = ModD.new(); sk.add_child(modd)
	ap = AnimationPlayer.new(); root.add_child(ap); ap.root_node = NodePath("..")
	var anim := Animation.new(); anim.length = 1.0; anim.loop_mode = Animation.LOOP_LINEAR
	var t := anim.add_track(Animation.TYPE_ROTATION_3D); anim.track_set_path(t, NodePath("Skeleton3D:b"))
	anim.rotation_track_insert_key(t, 0.0, Quaternion.IDENTITY); anim.rotation_track_insert_key(t, 0.5, Quaternion(Vector3.RIGHT, 1.0))
	var lib := AnimationLibrary.new(); lib.add_animation("walk", anim); ap.add_animation_library("", lib)
	ap.play("walk")
	layer = Layer.new(); layer.sk = sk; layer.process_priority = 10; root.add_child(layer)
	# ragdoll probe
	var sim := PhysicalBoneSimulator3D.new(); sk.add_child(sim)
	var pb := PhysicalBone3D.new(); pb.bone_name = "b"; var cs := CollisionShape3D.new(); cs.shape = CapsuleShape3D.new(); pb.add_child(cs); sim.add_child(pb)
	sim.physical_bones_start_simulation()
	print("sim ok, bones ", sim.get_child_count())
func _process(_d: float) -> bool:
	frames += 1
	if frames == 5:
		print("mod calls ", mod.calls, " modd calls ", modd.calls, " ap pos ", ap.current_animation_position, " b pose ", sk.get_bone_pose_rotation(1), " layer saw ", layer.seen.size(), " last ", layer.seen[-1] if layer.seen.size() else null, " global b ", sk.get_bone_global_pose(1).origin)
		quit()
	return false
