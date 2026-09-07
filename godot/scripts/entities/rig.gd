extends Node3D
## A built character rig (Contracts v2 "Rigs"): Skeleton3D + skinned meshes + AnimationPlayer with a generated
## library, a SkeletonModifier3D layer for aim/head tracking, recoil, pose glitches and the death settle, sockets
## (hand_r hand_l back hip head chest), hit-zone Area3Ds, worn gear, a ragdoll and the shader hooks.
signal footstep(foot: String)
var kind := ""
var def := {}
var skeleton: Skeleton3D = null
var anim: AnimationPlayer = null
var layer: SkeletonModifier3D = null
var sockets := {}
var body_meshes: Array[MeshInstance3D] = []
var gear_root: Node3D = null
var gear_meshes := {}          # slot -> MeshInstance3D
var loadout := {}
var attached := {}             # socket -> Array[Node]
var current := ""
var scale_factor := 1.0
var eye_bone := "head"
var eye_off := Vector3(0, 0.1, -0.09)
var _zones: Array[Area3D] = []
var _steps: Array = []
var _last_pos := 0.0
var _speed := 1.0
var _gun_hand := "r"
var _ragdoll: PhysicalBoneSimulator3D = null
var _ragdoll_on := false
var _shiver := 1.0
var _glitch_t := 0.0
var _glitch_cool := 2.5
var _dead := false
var stride_meta := {}
var entity: Node = null

func _ready() -> void:
	if entity == null:
		var p := get_parent()
		entity = p if (p and p.is_in_group("entities")) else self
	for z in _zones: z.set_meta("entity", entity)
	if anim and anim.has_animation("idle") and current == "": play("idle", 0.0)

func set_entity(n: Node) -> void:
	entity = n
	for z in _zones: z.set_meta("entity", n)

# ---------------------------------------------------------------- animation
func has_clip(name: String) -> bool: return anim != null and anim.has_animation(name)
func clip_length(name: String) -> float: return anim.get_animation(name).length if has_clip(name) else 0.0
func stride(name: String) -> float:
	if not has_clip(name): return 0.0
	var a := anim.get_animation(name)
	return float(a.get_meta("stride", 0.0)) * scale_factor
func clip_meta(name: String, key: String, default: Variant = null) -> Variant:
	if not has_clip(name): return default
	var a := anim.get_animation(name)
	return a.get_meta(key, default)

## Crossfade to a clip. Unknown clips fall back to the closest thing the kind has. Returns the clip actually played.
func play(name: String, blend: float = 0.2, speed: float = 1.0) -> String:
	if anim == null: return ""
	var n := _resolve(name)
	if n == "": return ""
	var restart := n == current and not anim.get_animation(n).loop_mode == Animation.LOOP_LINEAR
	if n != current or restart:
		anim.play(n, blend, speed)
		if restart: anim.seek(0.0, true)
		current = n; _last_pos = 0.0
		var a := anim.get_animation(n)
		_steps = a.get_meta("footsteps", [])
		_swap_gun_hand(str(a.get_meta("gun_hand", "r")))
		if layer: layer.on_clip(n)
	_speed = speed
	anim.speed_scale = speed
	return n

func _resolve(name: String) -> String:
	if anim.has_animation(name): return name
	var alias := {
		"idle_alert": ["idle"], "crouch_idle": ["idle"], "crouch_walk": ["walk"], "aim": ["idle_alert", "idle"], "fire": ["flinch", "idle"],
		"reload": ["search", "idle"], "hit_front": ["flinch", "hit"], "hit_back": ["hit_front", "flinch", "hit"], "death_back": ["death_front", "death"],
		"death_front": ["death"], "melee": ["fire", "flinch"], "throw": ["melee"], "peek_l": ["aim", "idle"], "peek_r": ["aim", "idle"],
		"search": ["idle_alert", "idle"], "flinch": ["hit_front", "idle"], "run": ["walk", "crawl", "hover"], "walk": ["crawl", "hover", "idle"],
		"crawl": ["walk"], "pounce": ["melee", "run"], "hover": ["idle"], "split": ["flinch"], "spit": ["melee"], "circle": ["walk"],
		"grab": ["melee"], "scream": ["idle_alert"], "hidden": ["crouch_idle", "idle"] }
	for a in alias.get(name, []):
		if anim.has_animation(a): return a
	return "idle" if anim.has_animation("idle") else ""

## Pick and pace a locomotion clip from a ground speed (m/s) so the feet do not slide.
func locomotion(speed_mps: float, crouched: bool = false, alert: bool = false, blend: float = 0.25) -> void:
	if speed_mps < 0.15:
		play("crouch_idle" if crouched else ("idle_alert" if alert else "idle"), blend); return
	var clip := "crouch_walk" if crouched else ("run" if speed_mps > 2.6 * scale_factor else "walk")
	var st := stride(clip)
	var cyc := float(clip_meta(clip, "cycle", 1.0))
	var sp := 1.0
	if st > 0.0: sp = clampf(speed_mps * cyc / st, 0.5, 2.2)
	play(clip, blend, sp)

func _process(dt: float) -> void:
	if anim == null or current == "": return
	# footsteps from the clip's plant times
	if _steps.size() > 0 and anim.is_playing():
		var pos := anim.current_animation_position
		var a := anim.get_animation(current)
		for s in _steps:
			var t: float = s[0]
			var crossed := (pos >= t and _last_pos < t) or (pos < _last_pos and (t > _last_pos or t <= pos))
			if crossed and a.loop_mode == Animation.LOOP_LINEAR or (crossed and pos >= t):
				footstep.emit(str(s[1]))
		_last_pos = pos
	# mimic pose glitches: every 1.5-4 s the pose snaps wrong for ~60 ms
	if layer and layer.glitch_enabled and not _dead:
		_glitch_cool -= dt
		if _glitch_cool <= 0.0:
			_glitch_cool = randf_range(1.5, 4.0)
			glitch(0.6)

# ---------------------------------------------------------------- aim and layers
## Layer the aim (radians) onto the current clip: spine twist for yaw, chest pitch for the gun, head look.
func set_aim(pitch: float, yaw: float) -> void:
	if layer: layer.set_aim(pitch, yaw)
func look_at_point(p: Vector3) -> void:
	# convenience: aim at a world point
	var from := eye_pos()
	var d := global_transform.basis.inverse() * (p - from)
	var yaw := atan2(-d.x, -d.z)
	var pitch := atan2(d.y, Vector2(d.x, d.z).length())
	set_aim(pitch, yaw)
func kick(amount: float = 1.0) -> void:
	if layer: layer.kick(amount)
func glitch(strength: float = 1.0, seconds: float = 0.06) -> void:
	if layer: layer.start_glitch(strength, seconds)
func set_dead(on: bool) -> void:
	_dead = on
	if layer: layer.dead = on

# ---------------------------------------------------------------- sockets, bones, zones
func attach(node: Node, socket: String) -> void:
	var s: Node3D = sockets.get(socket, null)
	if s == null: push_warning("rig: no socket " + socket); s = self
	if node.get_parent(): node.get_parent().remove_child(node)
	s.add_child(node)
	if node is Node3D: (node as Node3D).transform = Transform3D.IDENTITY
	if not attached.has(socket): attached[socket] = []
	attached[socket].append(node)
func detach(node: Node) -> void:
	for k in attached:
		if node in attached[k]: attached[k].erase(node)
	if node.get_parent(): node.get_parent().remove_child(node)
func socket(name: String) -> Node3D: return sockets.get(name, null)
func _swap_gun_hand(hand: String) -> void:
	if hand == _gun_hand: return
	var from := "hand_" + _gun_hand; var to := "hand_" + hand
	if not sockets.has(from) or not sockets.has(to): return
	for n in attached.get(from, []).duplicate():
		n.get_parent().remove_child(n); sockets[to].add_child(n)
		if n is Node3D: (n as Node3D).transform = Transform3D.IDENTITY
		attached[from].erase(n)
		if not attached.has(to): attached[to] = []
		attached[to].append(n)
	_gun_hand = hand

func bone_pos(name: String) -> Vector3:
	if skeleton == null: return global_position
	var i := skeleton.find_bone(name)
	if i < 0: return global_position
	return skeleton.global_transform * skeleton.get_bone_global_pose(i).origin
func bone_xf(name: String) -> Transform3D:
	var i := skeleton.find_bone(name)
	if i < 0: return global_transform
	return skeleton.global_transform * skeleton.get_bone_global_pose(i)
func eye_pos() -> Vector3:
	if skeleton == null: return global_position + Vector3(0, 1.6, 0)
	var i := skeleton.find_bone(eye_bone)
	if i < 0: return global_position + Vector3(0, 1.6, 0)
	return skeleton.global_transform * (skeleton.get_bone_global_pose(i) * eye_off)
func eye_dir() -> Vector3:
	var i := skeleton.find_bone(eye_bone) if skeleton else -1
	if i < 0: return -global_transform.basis.z
	return (skeleton.global_transform.basis * skeleton.get_bone_global_pose(i).basis * Vector3.FORWARD).normalized()
func zones() -> Array: return _zones.duplicate()
func height() -> float: return float(def.get("p", {}).get("height", 1.8)) * scale_factor if def.has("p") else float(def.get("height", 1.0)) * scale_factor

# ---------------------------------------------------------------- shaders
func set_shiver(amount: float) -> void:
	_shiver = amount
	for m in body_meshes: m.set_instance_shader_parameter("shiver", amount)
func set_dissolve(v: float) -> void:
	for m in body_meshes: m.set_instance_shader_parameter("dissolve", v)
	for k in gear_meshes:
		var gm: MeshInstance3D = gear_meshes[k]
		gm.transparency = clampf(v * 1.4 - 0.2, 0.0, 1.0)
func set_nvg(on: bool) -> void:
	for m in body_meshes: m.set_instance_shader_parameter("nvg", 1.0 if on else 0.0)
func set_reveal(v: float) -> void:
	for m in body_meshes: m.set_instance_shader_parameter("reveal", v)
func set_pulse(v: float) -> void:
	for m in body_meshes: m.set_instance_shader_parameter("pulse", v)
func set_param(name: String, v: Variant) -> void:
	for m in body_meshes: m.set_instance_shader_parameter(name, v)
func set_shadows(on: bool) -> void:
	for m in body_meshes: m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if on else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for k in gear_meshes: gear_meshes[k].cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if on else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
func set_visible_all(on: bool) -> void: visible = on

# ---------------------------------------------------------------- loadout
## dict keys: vest helmet backpack rig headgear mask (catalogue ids or null); also accepts an inventory
## "equipment" dictionary. Missing ids are ignored.
func set_loadout(d: Dictionary) -> void:
	var eq: Dictionary = d.get("equipment", d)
	var GB := load("res://scripts/entities/bodies/gear_body.gd")
	for slot in ["vest", "helmet", "backpack", "rig", "headgear", "mask"]:
		var id: Variant = eq.get(slot, null)
		if gear_meshes.has(slot):
			gear_meshes[slot].queue_free(); gear_meshes.erase(slot)
		loadout[slot] = id
		if id == null or str(id) == "" or str(id).ends_with("_none"): continue
		var mi: MeshInstance3D = GB.build(str(id), slot, self)
		if mi == null: continue
		gear_meshes[slot] = mi
	# gloves/boots are body geometry choices; the mask hides the face blot
	if has_node("Face"): get_node("Face").visible = not gear_meshes.has("mask")

# ---------------------------------------------------------------- ragdoll
func set_ragdoll(on: bool) -> void:
	if on == _ragdoll_on: return
	_ragdoll_on = on
	if on:
		if _ragdoll == null: _build_ragdoll()
		if _ragdoll:
			if anim: anim.pause()
			if layer: layer.active = false
			_ragdoll.physical_bones_start_simulation()
	else:
		if _ragdoll: _ragdoll.physical_bones_stop_simulation()
		if layer: layer.active = true

const RAGDOLL_BONES := {
	"hips": [0.14, 0.18], "spine": [0.13, 0.14], "chest": [0.15, 0.26], "head": [0.11, 0.2],
	"upper_arm_l": [0.05, 0.3], "upper_arm_r": [0.05, 0.3], "forearm_l": [0.045, 0.26], "forearm_r": [0.045, 0.26],
	"thigh_l": [0.08, 0.42], "thigh_r": [0.08, 0.42], "shin_l": [0.06, 0.4], "shin_r": [0.06, 0.4] }
func _build_ragdoll() -> void:
	if skeleton == null or not def.has("names"): return
	var sim := PhysicalBoneSimulator3D.new(); sim.name = "Ragdoll"
	skeleton.add_child(sim)
	var pos: Dictionary = def["pos"]
	for bn in RAGDOLL_BONES:
		var i := skeleton.find_bone(bn)
		if i < 0: continue
		var pb := PhysicalBone3D.new(); pb.name = "pb_" + bn; pb.bone_name = bn
		pb.collision_layer = 8; pb.collision_mask = 1
		pb.mass = 4.0 if bn in ["hips", "chest", "spine"] else 1.5
		pb.linear_damp = 0.4; pb.angular_damp = 1.5
		var sz: Array = RAGDOLL_BONES[bn]
		var cs := CollisionShape3D.new(); var cap := CapsuleShape3D.new(); cap.radius = sz[0] * scale_factor; cap.height = maxf(sz[1] * scale_factor, cap.radius * 2.05)
		cs.shape = cap
		# capsule along the bone: limbs run down -y from the joint; torso bones run up
		var up := bn in ["hips", "spine", "chest", "head"]
		var child_off := 0.0
		# find the child joint to center the capsule between joints
		var cname := _child_bone(bn)
		var L: float = (pos[cname] - pos[bn]).length() if cname != "" else sz[1]
		child_off = L * 0.5
		cs.position = Vector3(0, child_off if up else -child_off, 0)
		pb.add_child(cs)
		pb.joint_type = PhysicalBone3D.JOINT_TYPE_CONE if bn not in ["hips"] else PhysicalBone3D.JOINT_TYPE_NONE
		if bn in ["forearm_l", "forearm_r", "shin_l", "shin_r"]: pb.joint_type = PhysicalBone3D.JOINT_TYPE_HINGE
		sim.add_child(pb)
	_ragdoll = sim
func _child_bone(bn: String) -> String:
	match bn:
		"hips": return "spine"
		"spine": return "chest"
		"chest": return "neck"
		"head": return ""
		"upper_arm_l": return "forearm_l"
		"upper_arm_r": return "forearm_r"
		"forearm_l": return "hand_l"
		"forearm_r": return "hand_r"
		"thigh_l": return "shin_l"
		"thigh_r": return "shin_r"
		"shin_l": return "foot_l"
		"shin_r": return "foot_r"
	return ""

# ---------------------------------------------------------------- the pose layer
class PoseLayer extends SkeletonModifier3D:
	var rig: Node3D = null
	var aim_pitch := 0.0
	var aim_yaw := 0.0
	var _pitch := 0.0
	var _yaw := 0.0
	var _kick := 0.0
	var _kick_v := 0.0
	var glitch_enabled := false
	var _glitch_t := 0.0
	var _glitch := {}
	var dead := false
	var aim_clip := false
	var head_bones := ["neck", "head"]
	var spine_bones := ["hips", "spine", "chest"]
	var spine_share := [0.15, 0.3, 0.35]
	var head_share := 0.2
	var yaw_limit := deg_to_rad(70.0)
	var pitch_limit := deg_to_rad(55.0)
	var track_rate := 9.0
	var _last_t := 0.0
	var arms_pitch := true
	func set_aim(p: float, y: float) -> void:
		aim_pitch = clampf(p, -pitch_limit, pitch_limit); aim_yaw = clampf(y, -yaw_limit, yaw_limit)
	func kick(a: float) -> void: _kick_v += a * 6.0
	func start_glitch(strength: float, seconds: float) -> void:
		_glitch_t = seconds; _glitch = {}
		for b in ["hips", "spine", "chest", "neck", "head", "upper_arm_l", "upper_arm_r", "forearm_l", "forearm_r", "thigh_l", "thigh_r", "shin_l", "shin_r"]:
			var big := randf() < 0.35
			var s := strength * (0.5 if big else 0.12)
			_glitch[b] = Quaternion.from_euler(Vector3(randf_range(-s, s), randf_range(-s, s), randf_range(-s, s) * 0.5))
	func on_clip(n: String) -> void:
		aim_clip = n in ["aim", "fire", "peek_l", "peek_r", "crouch_aim"]
	func _process_modification_with_delta(delta: float) -> void:
		var sk := get_skeleton()
		if sk == null: return
		var dt := clampf(delta, 0.0, 0.1)
		var k := 1.0 - exp(-track_rate * dt)
		if dead:
			_pitch = lerpf(_pitch, 0.0, k); _yaw = lerpf(_yaw, 0.0, k)
		else:
			_pitch = lerpf(_pitch, aim_pitch, k); _yaw = lerpf(_yaw, aim_yaw, k)
		# recoil spring
		_kick_v += (-_kick * 900.0 - _kick_v * 34.0) * dt
		_kick += _kick_v * dt
		if _glitch_t > 0.0: _glitch_t -= dt
		var acc := 0.0
		if aim_clip:
			for i in spine_bones.size():
				var bi := sk.find_bone(spine_bones[i])
				if bi < 0: continue
				var share: float = spine_share[i]
				var pitch_part := _pitch * (0.0 if i < 2 else 0.85) + _kick * (0.02 if i == 2 else 0.0)
				_rotate_global(sk, bi, _yaw * share, pitch_part, acc)
				acc += _yaw * share
			for j in head_bones.size():
				var hi := sk.find_bone(head_bones[j])
				if hi < 0: continue
				_rotate_global(sk, hi, _yaw * head_share * 0.5, _pitch * 0.075 + _kick * 0.03, acc)
				acc += _yaw * head_share * 0.5
		else:
			# head look only, with a little of the chest following
			var ci := sk.find_bone("chest")
			if ci >= 0: _rotate_global(sk, ci, _yaw * 0.25, _pitch * 0.15, 0.0); acc = _yaw * 0.25
			for j in head_bones.size():
				var hi := sk.find_bone(head_bones[j])
				if hi < 0: continue
				_rotate_global(sk, hi, _yaw * 0.375, _pitch * 0.42, acc)
				acc += _yaw * 0.375
		if _glitch_t > 0.0:
			for b in _glitch:
				var gi := sk.find_bone(b)
				if gi >= 0: sk.set_bone_pose_rotation(gi, sk.get_bone_pose_rotation(gi) * _glitch[b])
			var hi := sk.find_bone("hips")
			if hi >= 0: sk.set_bone_pose_position(hi, sk.get_bone_pose_position(hi) + Vector3(randf_range(-0.02, 0.02), randf_range(0.0, 0.03), 0))
	## Rotate a bone in root space: pitch about the right axis of the accumulated yaw, then yaw about up.
	func _rotate_global(sk: Skeleton3D, bi: int, yaw: float, pitch: float, acc_yaw: float) -> void:
		if absf(yaw) < 1e-5 and absf(pitch) < 1e-5: return
		var parent := sk.get_bone_parent(bi)
		var pg: Basis = sk.get_bone_global_pose(parent).basis if parent >= 0 else Basis.IDENTITY
		var g: Basis = sk.get_bone_global_pose(bi).basis
		var axis := Basis(Vector3.UP, acc_yaw) * Vector3.RIGHT
		var rot := Basis(Vector3.UP, yaw) * Basis(axis, pitch)
		var new_g := rot * g
		var local := pg.inverse() * new_g
		sk.set_bone_pose_rotation(bi, local.get_rotation_quaternion())
