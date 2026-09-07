class_name HumanoidBody
## The skinned humanoid body: smooth tubes along the bone chains (weights blended across the joints), a skull with
## a blank face, palms with five two-segment fingers, and the clothing silhouette built into the same surface
## (jacket with collar/hem/cuffs, trousers tucked into boots, gloves) so a mimic reads as a body in a dead man's
## gear and not a mannequin. Vertex colour: r shiver, g cloth, b grime, a tatter threshold.
const SEGS := 16          # ring segments for limbs
const SEGS_T := 22        # torso
const SEGS_F := 7         # fingers
# torso profile at H = 1.8: [y, rx, rz, back, sq]; shared with gear_body so worn gear sits outside the body
const PROF := [
	[0.86, 0.150, 0.100, 0.92, 0.1], [0.92, 0.168, 0.110, 0.90, 0.15], [0.99, 0.166, 0.112, 0.88, 0.15], [1.06, 0.156, 0.104, 0.88, 0.1],
	[1.13, 0.150, 0.100, 0.90, 0.1], [1.20, 0.158, 0.108, 0.90, 0.1], [1.28, 0.172, 0.118, 0.88, 0.15], [1.36, 0.184, 0.124, 0.86, 0.2],
	[1.43, 0.190, 0.124, 0.86, 0.25], [1.48, 0.170, 0.108, 0.90, 0.2], [1.515, 0.100, 0.080, 1.0, 0.0]]

## Body radii (rx, rz) of the torso profile at height y (H = 1.8 units), interpolated.
static func torso_radii(y: float) -> Vector2:
	if y <= PROF[0][0]: return Vector2(PROF[0][1], PROF[0][2])
	for i in range(1, PROF.size()):
		if y <= PROF[i][0]:
			var a: Array = PROF[i - 1]; var b: Array = PROF[i]
			var t: float = (y - a[0]) / maxf(b[0] - a[0], 1e-4)
			return Vector2(lerpf(a[1], b[1], t), lerpf(a[2], b[2], t))
	return Vector2(PROF[-1][1], PROF[-1][2])

## Bone weights of the torso at root-space height y (metres): hips → spine → chest → neck blends.
static func torso_weights(def: Dictionary, y: float) -> Array:
	var pos: Dictionary = def["pos"]; var s: float = def["p"]["height"] / 1.80
	var hips := HumanoidDef.index(def, "hips"); var spine := HumanoidDef.index(def, "spine"); var chest := HumanoidDef.index(def, "chest"); var neck := HumanoidDef.index(def, "neck")
	var y_hips: float = pos["hips"].y; var y_spine: float = pos["spine"].y; var y_chest: float = pos["chest"].y; var y_neck: float = pos["neck"].y
	if y < y_hips - 0.03 * s: return SkinBuilder.bw(hips)
	if y < y_spine: return SkinBuilder.bw_mix(SkinBuilder.bw(hips), SkinBuilder.bw(spine), smoothstep(y_hips - 0.03 * s, y_spine + 0.02 * s, y))
	if y < y_chest + 0.02 * s: return SkinBuilder.bw_mix(SkinBuilder.bw(spine), SkinBuilder.bw(chest), smoothstep(y_spine - 0.02 * s, y_chest + 0.04 * s, y))
	if y < y_neck - 0.03 * s: return SkinBuilder.bw(chest)
	return SkinBuilder.bw_mix(SkinBuilder.bw(chest), SkinBuilder.bw(neck), smoothstep(y_neck - 0.04 * s, y_neck + 0.03 * s, y))

static func build(def: Dictionary, opts: Dictionary = {}) -> ArrayMesh:
	var sb := SkinBuilder.new()
	sb.jitter = float(opts.get("jitter", 0.0)); sb.jitter_seed = float(opts.get("seed", 1.0))
	var cl: Dictionary = opts.get("clothing", { "jacket": true, "trousers": true, "boots": true, "gloves": false })
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var g: float = p["bulk"] * s
	var pos: Dictionary = def["pos"]
	var B := func(n: String) -> int: return HumanoidDef.index(def, n)
	var jacket: bool = cl.get("jacket", false); var trousers: bool = cl.get("trousers", false); var boots: bool = cl.get("boots", false); var gloves: bool = cl.get("gloves", false)
	var skin_c := Color(1.0, 0.0, 0.1, 1.0)
	var cloth_c := Color(0.7, 1.0, 0.35, 1.0)
	var boot_c := Color(0.45, 1.0, 0.7, 1.0)
	var lod: float = opts.get("detail", 1.0)
	var segs := maxi(8, int(SEGS * lod)); var segs_t := maxi(10, int(SEGS_T * lod)); var segs_f := maxi(5, int(SEGS_F * lod))
	# ---------------- torso ----------------
	var hips := B.call("hips"); var spine := B.call("spine"); var chest := B.call("chest"); var neck := B.call("neck"); var head := B.call("head")
	var y_hips: float = pos["hips"].y; var y_spine: float = pos["spine"].y; var y_chest: float = pos["chest"].y; var y_neck: float = pos["neck"].y
	var torso_w := func(y: float) -> Array:
		if y < y_hips - 0.03 * s: return SkinBuilder.bw(hips)
		if y < y_spine: return SkinBuilder.bw_mix(SkinBuilder.bw(hips), SkinBuilder.bw(spine), smoothstep(y_hips - 0.03 * s, y_spine + 0.02 * s, y))
		if y < y_chest + 0.02 * s: return SkinBuilder.bw_mix(SkinBuilder.bw(spine), SkinBuilder.bw(chest), smoothstep(y_spine - 0.02 * s, y_chest + 0.04 * s, y))
		if y < y_neck - 0.03 * s: return SkinBuilder.bw(chest)
		return SkinBuilder.bw_mix(SkinBuilder.bw(chest), SkinBuilder.bw(neck), smoothstep(y_neck - 0.04 * s, y_neck + 0.03 * s, y))
	var prof := PROF
	var rings := []
	var hem_y := 0.985
	var jacket_add := 0.022 if jacket else 0.0
	var slouch: float = p.get("slouch", 0.0)
	for r in prof:
		var y: float = r[0]
		var is_jacket := jacket and y >= hem_y
		var add := jacket_add if is_jacket else (0.012 if (trousers and y < hem_y) else 0.0)
		var rx: float = (r[1] + add) * g; var rz: float = (r[2] + add) * g
		var c := cloth_c if (is_jacket or (trousers and y < hem_y)) else skin_c
		var lean_z := -slouch * clampf((y - 1.0) / 0.5, 0.0, 1.0)      # the chest carried a little forward
		rings.append({ "c": Vector3(0, y * s, lean_z), "rx": rx, "rz": rz, "w": torso_w.call(y * s), "v": y * 2.0, "col": c, "shape": { "back": r[3], "sq": r[4] + (0.15 if is_jacket else 0.0) } })
	# hem step: insert a jacket hem ring pair (trouser ring then jacket hem ring at the same height)
	if jacket:
		var hem := hem_y
		var base := { "c": Vector3(0, hem * s, 0), "rx": (0.166 + 0.012) * g, "rz": (0.112 + 0.012) * g, "w": torso_w.call(hem * s), "v": hem * 2.0, "col": cloth_c, "shape": { "back": 0.88, "sq": 0.15 } }
		var outer := base.duplicate(); outer["rx"] = (0.166 + jacket_add + 0.01) * g; outer["rz"] = (0.112 + jacket_add + 0.01) * g
		var tat := cloth_c; tat.a = 0.42; outer["col"] = tat
		var lift := outer.duplicate(); lift["c"] = Vector3(0, (hem + 0.012) * s, 0); lift["col"] = cloth_c; lift["shape"] = { "back": 0.88, "sq": 0.3 }
		# find insert point
		var k := 0
		while k < rings.size() and rings[k]["c"].y < hem * s: k += 1
		rings.insert(k, base); rings.insert(k + 1, outer); rings.insert(k + 2, lift)
	var starts := sb.tube(rings, segs_t, true, false)
	# collar
	var top_ring: int = starts[-1]
	if jacket:
		var col_w := torso_w.call(1.53 * s)
		var c0 := sb.ring(Vector3(0, 1.535 * s, -0.005 * s), Vector3.RIGHT, Vector3.FORWARD, 0.094 * g, 0.078 * g, segs_t, 3.1, cloth_c, col_w, { "back": 1.05, "front": 0.85 })
		var c1 := sb.ring(Vector3(0, 1.575 * s, -0.012 * s), Vector3.RIGHT, Vector3.FORWARD, 0.10 * g, 0.082 * g, segs_t, 3.2, cloth_c, SkinBuilder.bw(neck, 0.6, chest, 0.4), { "back": 1.1, "front": 0.8 })
		var c2 := sb.ring(Vector3(0, 1.585 * s, -0.012 * s), Vector3.RIGHT, Vector3.FORWARD, 0.082 * g, 0.066 * g, segs_t, 3.25, cloth_c, SkinBuilder.bw(neck, 0.7, chest, 0.3), { "back": 1.1, "front": 0.8 })
		sb.join(top_ring, c0, segs_t); sb.join(c0, c1, segs_t); sb.join(c1, c2, segs_t)
		# inner neck seen inside the open collar
		var n0 := sb.ring(Vector3(0, 1.52 * s, 0.005 * s), Vector3.RIGHT, Vector3.FORWARD, 0.058 * g, 0.056 * g, segs, 3.0, skin_c, SkinBuilder.bw(neck, 0.7, chest, 0.3))
		sb.join(c2, n0, segs_t if segs_t == segs else segs)
		top_ring = n0
	# neck to skull base
	var neck_rings := []
	var head_pos: Vector3 = pos["head"]; var neck_pos: Vector3 = pos["neck"]
	for i in 4:
		var t := float(i) / 3.0
		var c := neck_pos.lerp(head_pos, t) + Vector3(0, 0.0, 0.0)
		var rr := lerpf(0.058, 0.062, t) * g
		neck_rings.append({ "c": c, "rx": rr, "rz": rr * 0.95, "w": SkinBuilder.bw_mix(SkinBuilder.bw(neck), SkinBuilder.bw(head), smoothstep(0.35, 1.0, t)), "v": 3.0 + t * 0.2, "col": skin_c })
	var ns := sb.tube(neck_rings, segs)
	sb.join(top_ring, ns[0], segs)
	# ---------------- head: skull with jaw and a faint nose, no features ----------------
	var hs: float = p["head_scale"] * s
	var head_c := head_pos + Vector3(0, 0.105 * hs, 0.0)
	var taper := func(t: float) -> Vector2:
		var jaw := lerpf(0.72, 1.0, smoothstep(0.0, 0.42, t))          # narrow chin
		var back := 1.0 + 0.06 * smoothstep(0.3, 0.7, t)                # occiput
		return Vector2(jaw, jaw * back)
	var shift := func(t: float) -> Vector3:
		var nose := 0.010 * exp(-pow((t - 0.42) / 0.09, 2.0))
		var chin := -0.012 * smoothstep(0.25, 0.0, t)
		return Vector3(0, 0, -nose - chin * 0.5 + 0.012 * smoothstep(0.5, 0.95, t))   # skull leans back, face pushes forward
	sb.blob(head_c, Vector3(0.079 * hs, 0.118 * hs, 0.094 * hs), Basis.IDENTITY, segs + 4, 12, skin_c, SkinBuilder.bw(head), { "taper": taper, "shift": shift })
	# ---------------- arms ----------------
	for side in ["l", "r"]:
		var sg := -1.0 if side == "l" else 1.0
		var ua := B.call("upper_arm_" + side); var fa := B.call("forearm_" + side); var hd := B.call("hand_" + side)
		var sh: Vector3 = pos["upper_arm_" + side]; var el: Vector3 = pos["forearm_" + side]; var wr: Vector3 = pos["hand_" + side]
		var lu := sh.distance_to(el); var lf := el.distance_to(wr)
		var sleeve := 0.012 if jacket else 0.0
		var arm_c := cloth_c if jacket else skin_c
		# [d, rx, rz]
		var aprof := [[0.0, 0.066, 0.064], [0.06, 0.062, 0.06], [0.14, 0.054, 0.052], [lu * 0.55, 0.049, 0.047], [lu - 0.05, 0.044, 0.045], [lu, 0.042, 0.046],
			[lu + 0.06, 0.047, 0.045], [lu + 0.13, 0.043, 0.04], [lu + lf * 0.7, 0.037, 0.033], [lu + lf - 0.02, 0.032, 0.026]]
		var rl := []
		for r in aprof:
			var d: float = r[0]
			var addr: float = sleeve if d < lu + lf - 0.03 else 0.0
			rl.append([d, (r[1] + addr) * g, (r[2] + addr) * g, arm_c if addr > 0.0 else skin_c])
		if jacket:
			var cuff := cloth_c; cuff.a = 0.55
			rl.append([lu + lf - 0.015, (0.032 + sleeve + 0.006) * g, (0.026 + sleeve + 0.006) * g, cuff])
			rl.append([lu + lf - 0.012, (0.031) * g, (0.025) * g, skin_c])
		rl.append([lu + lf + 0.005, 0.031 * g, 0.024 * g, skin_c])
		_chain(sb, [sh, el, wr], [ua, fa], hd, rl, segs, Vector3.FORWARD, 0.05 * s, 2.0)
		# deltoid cap over the shoulder joint
		sb.blob(sh + Vector3(sg * 0.005, 0.012 * s, 0), Vector3(0.072, 0.075, 0.07) * g, Basis.IDENTITY, segs, 6, arm_c, SkinBuilder.bw(ua, 0.55, chest, 0.45), { "lat0": 0.35, "sq": 0.1 })
		# hands
		_hand(sb, def, side, gloves, skin_c, cloth_c, segs_f, g)
	# ---------------- legs ----------------
	for side in ["l", "r"]:
		var sg := -1.0 if side == "l" else 1.0
		var th := B.call("thigh_" + side); var sn := B.call("shin_" + side); var ft := B.call("foot_" + side); var toe := B.call("toe_" + side)
		var hp: Vector3 = pos["thigh_" + side]; var kn: Vector3 = pos["shin_" + side]; var an: Vector3 = pos["foot_" + side]
		var lt := hp.distance_to(kn); var ls := kn.distance_to(an)
		var tr := 0.012 if trousers else 0.0
		var leg_c := cloth_c if trousers else skin_c
		var boot_top := an.y + 0.21 * s
		var lprof := [[-0.03, 0.084, 0.092], [0.06, 0.086, 0.094], [lt * 0.45, 0.076, 0.082], [lt - 0.07, 0.064, 0.068], [lt, 0.058, 0.064],
			[lt + 0.05, 0.056, 0.066], [lt + 0.12, 0.054, 0.070], [lt + ls * 0.55, 0.046, 0.056]]
		var rl := []
		for r in lprof:
			rl.append([r[0], (r[1] + tr) * g, (r[2] + tr) * g, leg_c])
		if boots:
			var d_top := lt + (kn.y - boot_top)
			var hem := cloth_c; hem.a = 0.5
			rl.append([d_top - 0.01, (0.046 + tr + 0.004) * g, (0.056 + tr + 0.004) * g, hem])
			rl.append([d_top, (0.052 + 0.006) * g, (0.058 + 0.006) * g, boot_c])
			rl.append([d_top + 0.03, (0.05) * g, (0.056) * g, boot_c])
			rl.append([lt + ls - 0.04, 0.044 * g, 0.052 * g, boot_c])
			rl.append([lt + ls + 0.01, 0.044 * g, 0.056 * g, boot_c])
		else:
			rl.append([lt + ls - 0.04, 0.038 * g, 0.045 * g, leg_c]); rl.append([lt + ls, 0.036 * g, 0.043 * g, skin_c])
		_chain(sb, [hp, kn, an], [th, sn], ft, rl, segs, Vector3.FORWARD, 0.05 * s, 2.0)
		# hip/glute cap blending into the pelvis
		sb.blob(hp + Vector3(sg * 0.01, 0.03 * s, 0.01 * s), Vector3(0.09, 0.085, 0.1) * g, Basis.IDENTITY, segs, 6, leg_c, SkinBuilder.bw(th, 0.5, hips, 0.5), { "lat0": 0.3, "sq": 0.15 })
		_foot(sb, an, ft, toe, sg, boots, boot_c if boots else skin_c, segs, g, s)
	return sb.commit(null, opts.get("material", null), "body")

## Tube along a joint chain: joints (n+1), bones (n) with a tail bone the last rings blend into. Profile rows are
## [d along the chain, rx, rz, colour]; d may run a little past the ends.
static func _chain(sb: SkinBuilder, joints: Array, bone_ids: Array, tail: int, profile: Array, segs: int, fwd_hint: Vector3, blend: float, uv_scale: float) -> void:
	var seg_len := []; var seg_dir := []; var cum := [0.0]
	for i in range(1, joints.size()):
		var d: Vector3 = joints[i] - joints[i - 1]
		seg_len.append(d.length()); seg_dir.append(d.normalized()); cum.append(cum[-1] + d.length())
	var total: float = cum[-1]
	var rings := []
	for r in profile:
		var d: float = r[0]
		var k := 0
		while k < seg_len.size() - 1 and d > cum[k + 1]: k += 1
		var axial: Vector3 = seg_dir[k]
		# soften the frame across joints
		if k > 0 and d - cum[k] < blend: axial = (seg_dir[k - 1] + seg_dir[k]).normalized()
		if k < seg_dir.size() - 1 and cum[k + 1] - d < blend: axial = (seg_dir[k] + seg_dir[k + 1]).normalized()
		var c: Vector3 = joints[k] + seg_dir[k] * (d - cum[k])
		var right := axial.cross(fwd_hint).normalized()
		if right.length_squared() < 1e-6: right = Vector3.RIGHT
		var fwd := right.cross(axial).normalized()
		var w: Array = SkinBuilder.bw(bone_ids[k])
		if k > 0:
			var t := smoothstep(cum[k] - blend, cum[k] + blend, d)
			w = SkinBuilder.bw_mix(SkinBuilder.bw(bone_ids[k - 1]), SkinBuilder.bw(bone_ids[k]), t)
		var next_bone: int = bone_ids[k + 1] if k + 1 < bone_ids.size() else tail
		if next_bone >= 0:
			var t2 := smoothstep(cum[k + 1] - blend, cum[k + 1] + blend, d)
			if t2 > 0.0: w = SkinBuilder.bw_mix(w, SkinBuilder.bw(next_bone), t2)
		rings.append({ "c": c, "right": right, "fwd": fwd, "rx": r[1], "rz": r[2], "w": w, "v": d * uv_scale, "col": r[3] })
	sb.tube(rings, segs, true, true)
	total = total

static func _hand(sb: SkinBuilder, def: Dictionary, side: String, gloves: bool, skin_c: Color, cloth_c: Color, segs_f: int, g: float) -> void:
	var pos: Dictionary = def["pos"]
	var sg := -1.0 if side == "l" else 1.0
	var hd := HumanoidDef.index(def, "hand_" + side)
	var wr: Vector3 = pos["hand_" + side]
	var kn_mid: Vector3 = pos["middle_" + side + "_1"]
	var palm_len := wr.distance_to(kn_mid)
	var hc := cloth_c if gloves else skin_c
	var add := 0.004 if gloves else 0.0
	# palm: a flattened tube from the wrist to the knuckles, palm normal ±x (facing the body)
	var rings := []
	var prof := [[0.0, 0.030, 0.024], [0.25, 0.017, 0.038], [0.55, 0.016, 0.044], [0.85, 0.015, 0.046], [1.0, 0.014, 0.045]]
	for r in prof:
		var t: float = r[0]
		var c := wr.lerp(kn_mid, t) + Vector3(0, 0, 0.0)
		var w: Array = SkinBuilder.bw(hd) if t > 0.15 else SkinBuilder.bw_mix(SkinBuilder.bw(HumanoidDef.index(def, "forearm_" + side)), SkinBuilder.bw(hd), 0.5 + t * 3.0)
		rings.append({ "c": c, "right": Vector3.RIGHT, "fwd": Vector3.FORWARD, "rx": (r[1] + add) * g, "rz": (r[2] + add) * g, "w": w, "v": t, "col": hc, "shape": { "sq": 0.35 } })
	sb.tube(rings, segs_f + 3, false, true)
	if gloves:
		var cuff := cloth_c; cuff.a = 0.6
		sb.ring(wr + Vector3(0, 0.02, 0), Vector3.RIGHT, Vector3.FORWARD, 0.037 * g, 0.03 * g, segs_f + 3, 0.0, cuff, SkinBuilder.bw(hd, 0.5, HumanoidDef.index(def, "forearm_" + side), 0.5), { "sq": 0.2 })
	# fingers: two segments each, tapering; thumb from the palm's front edge
	for f in ["index", "middle", "ring", "pinky", "thumb"]:
		var b1 := HumanoidDef.index(def, f + "_" + side + "_1"); var b2 := HumanoidDef.index(def, f + "_" + side + "_2")
		var p1: Vector3 = pos[f + "_" + side + "_1"]; var p2: Vector3 = pos[f + "_" + side + "_2"]
		var seg := p1.distance_to(p2)
		var tip := p2 + (p2 - p1).normalized() * seg * (0.9 if f != "thumb" else 0.8)
		var r0 := (0.0105 if f != "pinky" else 0.009) * g
		if f == "thumb": r0 = 0.012 * g
		r0 += add
		var fwd := Vector3.FORWARD if f != "thumb" else Vector3(sg, 0, -0.4).normalized()
		var fprof := [[-0.004, r0 * 1.05, r0], [seg * 0.5, r0 * 0.95, r0 * 0.92], [seg - 0.004, r0 * 0.92, r0 * 0.88], [seg + 0.004, r0 * 0.9, r0 * 0.85], [seg * 1.5, r0 * 0.82, r0 * 0.78], [seg * 1.85, r0 * 0.6, r0 * 0.6]]
		var rl := []
		for r in fprof: rl.append([r[0], r[1], r[2], hc])
		_chain(sb, [p1, p2, tip], [b1, b2], -1, rl, segs_f, fwd, 0.006, 1.0)
		# knuckle bump
		sb.blob(p1, Vector3(r0 * 1.15, r0 * 1.1, r0 * 1.15), Basis.IDENTITY, segs_f, 3, hc, SkinBuilder.bw(hd, 0.5, b1, 0.5), { "sq": 0.0 })

static func _foot(sb: SkinBuilder, ankle: Vector3, ft: int, toe: int, sg: float, boots: bool, c: Color, segs: int, g: float, s: float) -> void:
	# heel block and the foot body running forward to the toe, cross-sections oriented along -z
	var y_sole := 0.0 if not boots else 0.0
	var h := ankle.y
	var rings := []
	var wf := SkinBuilder.bw(ft)
	# ankle → heel (vertical part)
	rings.append({ "c": ankle + Vector3(0, 0.02 * s, 0.0), "right": Vector3.RIGHT, "fwd": Vector3.FORWARD, "rx": (0.046 if boots else 0.038) * g, "rz": (0.055 if boots else 0.046) * g, "w": wf, "v": 0.0, "col": c })
	rings.append({ "c": ankle + Vector3(0, -0.02 * s, 0.012 * s), "right": Vector3.RIGHT, "fwd": Vector3.FORWARD, "rx": (0.05 if boots else 0.04) * g, "rz": (0.07 if boots else 0.06) * g, "w": wf, "v": 0.1, "col": c, "shape": { "sq": 0.3, "back": 1.1 } })
	rings.append({ "c": ankle + Vector3(0, -h * 0.55, 0.02 * s), "right": Vector3.RIGHT, "fwd": Vector3.FORWARD, "rx": (0.052 if boots else 0.042) * g, "rz": (0.078 if boots else 0.066) * g, "w": wf, "v": 0.2, "col": c, "shape": { "sq": 0.5, "back": 1.05 } })
	sb.tube(rings, segs, false, false)
	# foot body: rings in vertical planes moving forward
	var frings := []
	var lengths := [[-0.06 * s, 0.052, 0.045, 0.55], [-0.02 * s, 0.05, 0.043, 0.55], [-0.06 * s, 0.05, 0.04, 0.55], [-0.11 * s, 0.05, 0.036, 0.6], [-0.15 * s, 0.047, 0.03, 0.6], [-0.185 * s, 0.043, 0.024, 0.7], [-0.205 * s, 0.03, 0.014, 0.8]]
	var k := 0
	for r in lengths:
		var z: float = r[0] if k > 0 else 0.055 * s   # first ring is the heel back
		var cy: float = y_sole + float(r[2]) * g
		var w := wf if z > -0.09 * s else SkinBuilder.bw_mix(wf, SkinBuilder.bw(toe), smoothstep(-0.09 * s, -0.16 * s, z))
		frings.append({ "c": Vector3(ankle.x + sg * 0.004 * s, cy + (0.01 if boots else 0.0) * s, ankle.z + z), "right": Vector3.RIGHT, "fwd": Vector3.UP, "rx": (r[1] + (0.008 if boots else 0.0)) * g, "rz": (r[2] + (0.006 if boots else 0.0)) * g, "w": w, "v": 0.3 + k * 0.1, "col": c, "shape": { "sq": r[3], "back": 0.95 } })
		k += 1
	sb.tube(frings, segs, true, true)
	# sole: a flat slab under the foot (boots) for a crisp ground contact
	if boots:
		var sole_c := Color(0.3, 1.0, 0.8, 1.0)
		sb.box(Vector3(ankle.x, 0.012 * s, ankle.z - 0.07 * s), Vector3(0.105 * g, 0.024 * s, 0.29 * s), Basis.IDENTITY, sole_c, SkinBuilder.bw(ft, 0.7, toe, 0.3))
