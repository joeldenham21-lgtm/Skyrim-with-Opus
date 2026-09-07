class_name HumanoidDef
## Proportions and rest skeleton of the humanoid rigs (mimic, seeker, phantom). Every bone rests with an identity
## basis (bone-local axes = root axes: +X right, +Y up, -Z forward) so clip rotations are intuitive: rotating a
## hanging limb about +X swings it forward, the head about +X tilts it back. Positions are in root space, the root
## at the ground between the feet. About 7.5 heads tall at 1.80 m; the mimic variant has slightly long arms and a
## head carried forward.
const BONES := ["root", "hips", "spine", "chest", "neck", "head",
	"shoulder_l", "upper_arm_l", "forearm_l", "hand_l", "shoulder_r", "upper_arm_r", "forearm_r", "hand_r",
	"thumb_l_1", "thumb_l_2", "index_l_1", "index_l_2", "middle_l_1", "middle_l_2", "ring_l_1", "ring_l_2", "pinky_l_1", "pinky_l_2",
	"thumb_r_1", "thumb_r_2", "index_r_1", "index_r_2", "middle_r_1", "middle_r_2", "ring_r_1", "ring_r_2", "pinky_r_1", "pinky_r_2",
	"thigh_l", "shin_l", "foot_l", "toe_l", "thigh_r", "shin_r", "foot_r", "toe_r"]

static func params(kind: String, variant: Dictionary = {}) -> Dictionary:
	var p := { "height": 1.80, "arm_scale": 1.0, "head_forward": 0.0, "shoulder_half": 0.19, "hip_half": 0.09, "bulk": 1.0,
		"leg_scale": 1.0, "hand_scale": 1.0, "head_scale": 1.0, "neck_len": 1.0, "slouch": 0.0, "seed": 1 }
	match kind:
		"mimic":
			p["arm_scale"] = 1.08; p["head_forward"] = 0.035; p["slouch"] = 0.05; p["bulk"] = 0.98; p["hand_scale"] = 1.05
		"seeker":
			p["height"] = 1.80; p["arm_scale"] = 1.06; p["head_forward"] = 0.02; p["bulk"] = 1.18; p["shoulder_half"] = 0.215; p["hip_half"] = 0.1
		"phantom":
			p["arm_scale"] = 1.12; p["bulk"] = 0.9; p["head_forward"] = 0.02; p["hand_scale"] = 1.12
	for k in variant:
		if p.has(k): p[k] = variant[k]
	return p

## Returns { "names": [...], "parent": {name: parent_name}, "pos": {name: Vector3 rest position}, "p": params }
static func make(p: Dictionary) -> Dictionary:
	var H: float = p["height"]; var s := H / 1.80
	var arm: float = p["arm_scale"]; var hf: float = p["head_forward"]
	var shw: float = p["shoulder_half"] * s; var hipw: float = p["hip_half"] * s
	var pos := {}
	var parent := {}
	var ankle_y := 0.05 * H; var knee_y := 0.285 * H; var hip_y := 0.53 * H
	pos["root"] = Vector3.ZERO; parent["root"] = ""
	pos["hips"] = Vector3(0, 0.545 * H, 0); parent["hips"] = "root"
	pos["spine"] = Vector3(0, 0.615 * H, 0.005 * s); parent["spine"] = "hips"
	pos["chest"] = Vector3(0, 0.69 * H, 0.0); parent["chest"] = "spine"
	pos["neck"] = Vector3(0, 0.835 * H, 0.01 * s - hf * 0.5); parent["neck"] = "chest"
	pos["head"] = Vector3(0, (0.835 + 0.045 * p["neck_len"]) * H, 0.012 * s - hf); parent["head"] = "neck"
	for side in ["l", "r"]:
		var sg := -1.0 if side == "l" else 1.0
		var sh_y := 0.82 * H
		pos["shoulder_" + side] = Vector3(sg * 0.03 * H, 0.825 * H, -0.01 * s); parent["shoulder_" + side] = "chest"
		pos["upper_arm_" + side] = Vector3(sg * shw, sh_y, 0.0); parent["upper_arm_" + side] = "shoulder_" + side
		var elbow_y := sh_y - 0.19 * H * arm
		pos["forearm_" + side] = Vector3(sg * shw, elbow_y, 0.0); parent["forearm_" + side] = "upper_arm_" + side
		var wrist_y := elbow_y - 0.152 * H * arm
		pos["hand_" + side] = Vector3(sg * shw, wrist_y, 0.0); parent["hand_" + side] = "forearm_" + side
		var hs: float = p["hand_scale"] * s
		var palm := 0.085 * hs; var seg := 0.04 * hs
		# palm faces the body (+x for the left hand, -x for the right); fingers continue down, thumb forward
		var kx := sg * shw
		var knuckle_y := wrist_y - palm
		var fingers := { "index": -0.026, "middle": -0.009, "ring": 0.008, "pinky": 0.026 }
		for f in fingers:
			var fz: float = fingers[f] * hs
			var l1 := seg * (0.85 if f == "pinky" else 1.0)
			pos[f + "_" + side + "_1"] = Vector3(kx, knuckle_y, fz); parent[f + "_" + side + "_1"] = "hand_" + side
			pos[f + "_" + side + "_2"] = Vector3(kx, knuckle_y - l1, fz); parent[f + "_" + side + "_2"] = f + "_" + side + "_1"
		pos["thumb_" + side + "_1"] = Vector3(kx - sg * 0.012 * hs, wrist_y - 0.03 * hs, -0.03 * hs); parent["thumb_" + side + "_1"] = "hand_" + side
		pos["thumb_" + side + "_2"] = Vector3(kx - sg * 0.018 * hs, wrist_y - 0.055 * hs, -0.06 * hs); parent["thumb_" + side + "_2"] = "thumb_" + side + "_1"
		# legs
		var ls: float = p["leg_scale"]
		pos["thigh_" + side] = Vector3(sg * hipw, hip_y, 0.0); parent["thigh_" + side] = "hips"
		pos["shin_" + side] = Vector3(sg * hipw, hip_y - (hip_y - knee_y) * ls, 0.0); parent["shin_" + side] = "thigh_" + side
		pos["foot_" + side] = Vector3(sg * hipw, hip_y - (hip_y - ankle_y) * ls, 0.0); parent["foot_" + side] = "shin_" + side
		pos["toe_" + side] = Vector3(sg * hipw, 0.015 * s, -0.135 * s); parent["toe_" + side] = "foot_" + side
	return { "names": BONES, "parent": parent, "pos": pos, "p": p }

## Build the Skeleton3D (identity rest bases, positions relative to the parent).
static func skeleton(def: Dictionary) -> Skeleton3D:
	var sk := Skeleton3D.new(); sk.name = "Skeleton3D"
	var pos: Dictionary = def["pos"]; var parent: Dictionary = def["parent"]
	for n in def["names"]:
		var i := sk.add_bone(n)
		var pn: String = parent[n]
		var local: Vector3 = pos[n] - (pos[pn] if pn != "" else Vector3.ZERO)
		sk.set_bone_rest(i, Transform3D(Basis.IDENTITY, local))
		if pn != "": sk.set_bone_parent(i, sk.find_bone(pn))
	sk.reset_bone_poses()
	return sk

static func index(def: Dictionary, name: String) -> int: return def["names"].find(name)

## Landmark helpers used by the clips and the rig.
static func eye_offset(def: Dictionary) -> Vector3:
	var H: float = def["p"]["height"]; return Vector3(0, 0.055 * H, -0.045 * H / 1.8)
