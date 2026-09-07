class_name HumanoidClips
## Clip library for the humanoid rigs. Poses are built in root space (character faces -Z, +X right): the legs and
## torso are authored as angle curves with real gait timing (heel strike, loading response, toe-off, swing), the
## hands are placed on a virtual weapon by two-bone IK so both stay on the grips through every pose, and the whole
## clip is run through lag/spring passes so heads, hands and the gun follow through instead of snapping.
## opts: weapon "rifle"|"pistol"|"mg"|"none", heavy: bool (seeker), phantom: bool, tempo: float
const P := preload("res://scripts/entities/anim/clip_gen.gd")

# weapon-space grips: the right hand at the origin (pistol grip), the left hand forward on the fore-end
const GRIP_L := { "rifle": Vector3(0.0, 0.035, -0.30), "mg": Vector3(-0.01, 0.02, -0.26), "pistol": Vector3(-0.02, -0.03, -0.02) }

static func build(def: Dictionary, opts: Dictionary = {}) -> AnimationLibrary:
	var w: String = opts.get("weapon", "rifle")
	var free := w == "none"
	var clips := {}
	var t0 := Time.get_ticks_msec()
	clips["idle"] = _idle(def, opts)
	clips["idle_alert"] = _idle_alert(def, opts)
	clips["walk"] = _walk(def, opts, false)
	clips["run"] = _walk(def, opts, true)
	clips["crouch_idle"] = _crouch_idle(def, opts)
	clips["crouch_walk"] = _crouch_walk(def, opts)
	clips["search"] = _search(def, opts)
	clips["flinch"] = _flinch(def, opts)
	clips["hit_front"] = _hit(def, opts, true)
	clips["hit_back"] = _hit(def, opts, false)
	clips["death_front"] = _death(def, opts, true)
	clips["death_back"] = _death(def, opts, false)
	clips["melee"] = _melee(def, opts)
	if not free:
		clips["aim"] = _aim(def, opts)
		clips["fire"] = _fire(def, opts)
		clips["reload"] = _reload(def, opts)
		clips["throw"] = _throw(def, opts)
		clips["peek_l"] = _peek(def, opts, -1.0)
		clips["peek_r"] = _peek(def, opts, 1.0)
	if opts.get("phantom", false):
		clips["circle"] = _circle(def, opts)
		clips["scream"] = _scream(def, opts)
		clips["grab"] = _grab(def, opts)
		clips["aim"] = clips["idle_alert"]
	if opts.get("verbose", false): print("[HumanoidClips] %d clips in %d ms" % [clips.size(), Time.get_ticks_msec() - t0])
	return P.library(clips)

# ---------------------------------------------------------------- shared pose pieces
static func _stance(def: Dictionary, pose: P.RigPose, o: Dictionary = {}) -> void:
	# neutral standing: a little slouch, weight on the right leg, feet slightly turned out
	var slouch: float = def["p"].get("slouch", 0.0) * 100.0
	pose.r("spine", -1.5 - slouch * 0.6, 0, 0).r("chest", -1.0 - slouch * 0.6, 0, 0).r("neck", 2.0 + slouch * 0.5, 0, 0).r("head", 2.0 + slouch * 0.8, 0, 0)
	pose.r("thigh_l", 0, 6, 1.0).r("thigh_r", 0, -6, -1.0).r("shin_l", -3, 0, 0).r("shin_r", -2, 0, 0)
	pose.r("foot_l", 0, -6, 0).r("foot_r", 0, 6, 0)

static func _hips_over_feet(def: Dictionary, pose: P.RigPose, drop: float, feet: Dictionary, lean_deg: float, knee_out: float = 0.15) -> void:
	# lower the pelvis and plant both feet by IK (used by crouches, deaths and hits)
	pose.p("hips", Vector3(feet.get("hx", 0.0), -drop, feet.get("hz", 0.0)))
	pose.r("hips", lean_deg, 0, 0)
	for side in ["l", "r"]:
		var sg := -1.0 if side == "l" else 1.0
		var target: Vector3 = feet[side]
		var pole := Vector3(sg * knee_out, 0.0, -1.0)
		P.ik(def, pose, "thigh_" + side, "shin_" + side, "foot_" + side, target, pole, Basis.IDENTITY)

## Weapon transform in root space for a hold style. Returns Transform3D (origin = right grip, -Z = barrel).
static func _gun_xf(style: String, w: String, k: float = 1.0) -> Transform3D:
	var o := Vector3.ZERO; var e := Vector3.ZERO
	match style:
		"low": o = Vector3(0.15, 1.08, -0.17); e = Vector3(-35, -10, 6)
		"high": o = Vector3(0.13, 1.25, -0.19); e = Vector3(-16, -8, 4)
		"aim": o = Vector3(0.15, 1.375, -0.26); e = Vector3(0, 0, 0)
		"hip": o = Vector3(0.17, 1.06, -0.24); e = Vector3(-4, -2, 2)
		"port": o = Vector3(0.12, 1.20, -0.22); e = Vector3(22, -42, -8)
		"reload": o = Vector3(0.12, 1.20, -0.24); e = Vector3(-18, -20, 32)
		"crouch_low": o = Vector3(0.15, 0.78, -0.22); e = Vector3(-30, -10, 6)
		"crouch_aim": o = Vector3(0.15, 1.02, -0.28); e = Vector3(0, 0, 0)
		"sling": o = Vector3(0.16, 0.92, -0.05); e = Vector3(-70, -5, 0)
		"hang_l": o = Vector3(-0.22, 0.90, -0.08); e = Vector3(-75, 10, 0)
		_: o = Vector3(0.15, 1.08, -0.17); e = Vector3(-35, -10, 6)
	if w == "pistol":
		match style:
			"low", "crouch_low", "high": o = Vector3(0.10, 1.02 if style != "crouch_low" else 0.72, -0.28); e = Vector3(-45, -6, 0)
			"aim", "hip", "crouch_aim": o = Vector3(0.06, 1.34 if style != "crouch_aim" else 1.0, -0.44); e = Vector3(0, 0, 0)
			"port": o = Vector3(0.12, 1.24, -0.22); e = Vector3(35, -20, 0)
	if w == "mg":
		match style:
			"aim", "hip": o = Vector3(0.17, 1.08, -0.22); e = Vector3(-3, -2, 2)
			"low": o = Vector3(0.17, 1.02, -0.18); e = Vector3(-30, -8, 4)
			"port": o = Vector3(0.14, 1.12, -0.22); e = Vector3(18, -35, -6)
	var b := Basis.from_euler(Vector3(deg_to_rad(e.x), deg_to_rad(e.y), deg_to_rad(e.z)))
	return Transform3D(b, o * Vector3(1, k, 1))

static func hand_r_basis(gun: Basis, w: String) -> Basis:
	# fingers down the grip (angled back), palm toward the gun's left side
	return gun * P._basis_down(Vector3(0.0, -0.9, 0.42).normalized(), Vector3(1, 0, 0))
static func hand_l_basis(gun: Basis, w: String) -> Basis:
	if w == "pistol":
		return gun * P._basis_down(Vector3(0.75, -0.55, 0.3).normalized(), Vector3(1.0, 0.0, 0.0))
	return gun * P._basis_down(Vector3(0.55, 0.8, -0.05).normalized(), Vector3(0.7, 0.7, 0.0))

## Place both hands on the weapon (IK) and curl the fingers. w: weapon class. gun: root-space transform.
static func _hold(def: Dictionary, pose: P.RigPose, gun: Transform3D, w: String, loose: float = 0.0) -> void:
	var sg := 1.0
	var grip_l: Vector3 = GRIP_L.get(w, GRIP_L["rifle"])
	var tr: Vector3 = gun.origin
	var tl: Vector3 = gun * grip_l
	var pole_r := Vector3(0.9, -0.35, 0.55)
	var pole_l := Vector3(-0.7, -0.5, 0.35)
	P.ik(def, pose, "upper_arm_r", "forearm_r", "hand_r", tr, pole_r, hand_r_basis(gun.basis, w))
	P.ik(def, pose, "upper_arm_l", "forearm_l", "hand_l", tl, pole_l, hand_l_basis(gun.basis, w))
	_grip(pose, "r", 1.0 - loose * 0.5); _grip(pose, "l", 0.85 - loose * 0.5)
	sg = sg

## Finger curl: 0 open, 1 fist. Right hand curls about -Z, left about +Z (toward the palm).
static func _grip(pose: P.RigPose, side: String, amount: float, spread: float = 0.0) -> void:
	var sg := -1.0 if side == "r" else 1.0
	var a := clampf(amount, 0.0, 1.0)
	for f in ["index", "middle", "ring", "pinky"]:
		var k: float = { "index": 0.9, "middle": 1.0, "ring": 1.0, "pinky": 0.95 }[f]
		var sp: float = { "index": -1.0, "middle": -0.3, "ring": 0.3, "pinky": 1.0 }[f] * spread * 10.0
		pose.r(f + "_" + side + "_1", sp, 0, sg * 70.0 * a * k)
		pose.r(f + "_" + side + "_2", 0, 0, sg * 80.0 * a * k)
	# thumb folds across
	pose.r("thumb_" + side + "_1", 30.0 * a, -sg * 25.0 * a, sg * 20.0 * a)
	pose.r("thumb_" + side + "_2", 0, 0, sg * 35.0 * a)

static func _free_arms(pose: P.RigPose, o: Dictionary = {}) -> void:
	# arms hanging, elbows a little bent, hands half open
	var lx: float = o.get("l_x", 0.0); var rx: float = o.get("r_x", 0.0)
	pose.r("upper_arm_l", 4 + lx, 0, -6).r("upper_arm_r", 4 + rx, 0, 6)
	pose.r("forearm_l", 12 + o.get("l_bend", 0.0), 8, 0).r("forearm_r", 12 + o.get("r_bend", 0.0), -8, 0)
	pose.r("hand_l", 0, 0, 4).r("hand_r", 0, 0, -4)
	_grip(pose, "l", 0.25, 0.3); _grip(pose, "r", 0.25, 0.3)

static func _breath(pose: P.RigPose, t: float, rate: float = 0.28, amt: float = 1.0) -> void:
	var b := sin(t * TAU * rate)
	pose.r("chest", 1.6 * b * amt, 0, 0).r("spine", -0.6 * b * amt, 0, 0).r("neck", -0.5 * b * amt, 0, 0)
	pose.r("shoulder_l", 0, 0, -1.0 * b * amt).r("shoulder_r", 0, 0, 1.0 * b * amt)
	pose.p("hips", Vector3(0, 0.003 * b * amt, 0))

static func _head(pose: P.RigPose, yaw: float, pitch: float, roll: float = 0.0) -> void:
	pose.r("neck", pitch * 0.35, yaw * 0.35, roll * 0.3).r("head", pitch * 0.65, yaw * 0.65, roll * 0.7)

# ---------------------------------------------------------------- gait
## Full-body gait pose at cycle phase u (0..1, left heel strike at 0). o: swing, knee, bob, lean, run 0..1, crouch
static func _gait(def: Dictionary, pose: P.RigPose, u: float, o: Dictionary) -> void:
	var ph := u * TAU
	var run: float = o.get("run", 0.0)
	var sw: float = o.get("swing", 22.0)
	var knee_sw: float = o.get("knee", 62.0)
	var bob: float = o.get("bob", 0.018)
	var lean: float = o.get("lean", 3.0)
	var heavy: float = o.get("heavy", 0.0)
	var hips_drop: float = o.get("hips_drop", 0.0)
	for side in ["l", "r"]:
		var sg := -1.0 if side == "l" else 1.0
		var t := u if side == "l" else fmod(u + 0.5, 1.0)
		var p := t * TAU
		var thigh := sw * 0.2 + sw * cos(p) - run * 6.0
		var knee := knee_sw * pow(maxf(0.0, -sin(p)), 1.3) + 14.0 * (1.0 + run) * P.bump(t, -0.02, 0.3) + 3.0
		var ankle := 8.0 * P.bump(t, -0.02, 0.22) - (22.0 + run * 12.0) * P.bump(t, 0.4, 0.68) + 4.0 * pow(maxf(0.0, -sin(p)), 2.0)
		var toe := 25.0 * P.bump(t, 0.45, 0.62)
		pose.r("thigh_" + side, thigh + o.get("thigh_base", 0.0), sg * -4.0, sg * 1.5)
		pose.r("shin_" + side, -(knee + o.get("knee_base", 0.0)), 0, 0)
		pose.r("foot_" + side, ankle + o.get("foot_base", 0.0), sg * -5.0, 0)
		pose.r("toe_" + side, toe, 0, 0)
	# pelvis
	var sway: float = 0.02 + run * 0.01
	pose.p("hips", Vector3(-sway * sin(ph), -0.01 - hips_drop + (bob + run * 0.03) * (-cos(2.0 * ph)), 0.0))
	pose.r("hips", -(lean * 0.4) - heavy * 2.0, -6.0 * cos(ph) * (1.0 + run * 0.5), -4.0 * sin(ph))
	# torso counter-rotation and lean, head kept level
	pose.r("spine", -lean * 0.3, 3.0 * cos(ph), 1.5 * sin(ph))
	pose.r("chest", -lean * 0.3 - run * 6.0, 5.0 * cos(ph) * (1.0 + run), 2.0 * sin(ph))
	pose.r("neck", lean * 0.2 + run * 3.0, -2.0 * cos(ph), -1.5 * sin(ph))
	pose.r("head", lean * 0.4 + run * 3.0, -2.5 * cos(ph), -1.5 * sin(ph) + 1.5 * cos(2.0 * ph) * run)
	pose.r("shoulder_l", 0, -3.0 * cos(ph), 0).r("shoulder_r", 0, -3.0 * cos(ph), 0)

## Free-arm swing for the phantom / unarmed walk.
static func _arm_swing(pose: P.RigPose, u: float, amp: float, run: float) -> void:
	var ph := u * TAU
	var l := -amp * cos(ph); var r := amp * cos(ph)
	pose.r("upper_arm_l", l, 6, -8 - run * 6).r("upper_arm_r", r, -6, 8 + run * 6)
	pose.r("forearm_l", 18 + run * 55 + 12 * (-cos(ph)), 6, 0).r("forearm_r", 18 + run * 55 + 12 * cos(ph), -6, 0)
	pose.r("hand_l", 0, 0, 6).r("hand_r", 0, 0, -6)
	_grip(pose, "l", 0.3 + run * 0.4, 0.2); _grip(pose, "r", 0.3 + run * 0.4, 0.2)

# ---------------------------------------------------------------- clips
static func _idle(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 4.0
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var s := sin(t * TAU / L)
		pose.p("hips", Vector3(0.012 * s, -0.004 * (1.0 - cos(t * TAU / L)), 0)).r("hips", 0, 0, 1.5 * s)
		pose.r("chest", 0, -2.0 * s, -1.0 * s)
		_breath(pose, t, 0.26)
		_head(pose, 7.0 * P.drift(t, 1.3, 0.55), 2.0 + 2.5 * P.drift(t, 4.1, 0.4))
		if free: _free_arms(pose, { "l_bend": 4.0 * s, "r_bend": -3.0 * s })
		else:
			var gun := _gun_xf("low", w)
			gun.origin += Vector3(0.004 * s, 0.006 * sin(t * TAU * 0.26), 0)
			_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "idle", L, f, { "loop": true, "lag": { "head": 0.12, "hand_l": 0.05 } })

static func _idle_alert(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 3.0
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		pose.r("thigh_l", 8, 0, 0).r("thigh_r", 6, 0, 0).r("shin_l", -12, 0, 0).r("shin_r", -10, 0, 0).r("foot_l", 5, 0, 0).r("foot_r", 5, 0, 0)
		pose.p("hips", Vector3(0, -0.035, 0.0)).r("hips", -4, 0, 0)
		pose.r("chest", -6, 0, 0)
		_breath(pose, t, 0.4, 1.3)
		var yaw := 22.0 * P.drift(t, 2.2, 0.9); var pitch := -3.0 + 4.0 * P.drift(t, 5.7, 0.7)
		_head(pose, yaw, pitch)
		pose.r("chest", 0, yaw * 0.25, 0)
		if free:
			_free_arms(pose, { "l_x": 10, "r_x": 10, "l_bend": 20, "r_bend": 20 })
		else:
			var gun := _gun_xf("high", w)
			gun.basis = Basis(Vector3.UP, deg_to_rad(yaw * 0.35)) * gun.basis
			gun.origin = Basis(Vector3.UP, deg_to_rad(yaw * 0.3)) * gun.origin
			_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "idle_alert", L, f, { "loop": true, "lag": { "head": 0.08 } })

static func _walk(def: Dictionary, o: Dictionary, run: bool) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var heavy: float = 1.0 if o.get("heavy", false) else 0.0
	var L := (0.72 if run else 1.12) * (1.15 if heavy > 0.0 else 1.0) * float(o.get("tempo", 1.0))
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		var u := fmod(t / L, 1.0)
		if run:
			_gait(def, pose, u, { "swing": 34.0 - heavy * 8.0, "knee": 88.0, "bob": 0.03, "lean": 12.0, "run": 1.0, "heavy": heavy })
		else:
			_gait(def, pose, u, { "swing": 22.0 - heavy * 4.0, "knee": 60.0, "bob": 0.016, "lean": 3.0 + heavy * 4.0, "heavy": heavy })
		var ph := u * TAU
		if free:
			_arm_swing(pose, u, 34.0 if run else 20.0, 1.0 if run else 0.0)
		else:
			var gun := _gun_xf("port" if run else "low", w)
			gun.origin += Vector3(0.012 * sin(ph), 0.014 * (-cos(2.0 * ph)) * (1.0 + (1.0 if run else 0.0)), 0.01 * sin(ph))
			gun.basis = Basis(Vector3.RIGHT, deg_to_rad(2.5 * sin(2.0 * ph))) * gun.basis
			_hold(def, pose, gun, w)
		return pose
	var steps := [[0.0, "l"], [L * 0.5, "r"]]
	return P.bake(def, "run" if run else "walk", L, f, { "loop": true, "footsteps": steps, "lag": { "head": 0.06, "hand_l": 0.03 }, "spring": { "neck": [900.0, 40.0] }, "meta": { "stride": (2.6 if run else 1.75) * (1.0 if heavy == 0.0 else 1.15), "cycle": L } })

static func _crouch_feet(def: Dictionary) -> Dictionary:
	var pos: Dictionary = def["pos"]
	var hw: float = pos["thigh_r"].x
	var ay: float = pos["foot_l"].y
	return { "l": Vector3(-hw - 0.06, ay, -0.16), "r": Vector3(hw + 0.07, ay, 0.05) }

static func _crouch_idle(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 4.0
	var feet := _crouch_feet(def)
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		var s := sin(t * TAU / L)
		_hips_over_feet(def, pose, 0.40 + 0.006 * s, feet, -8.0)
		pose.r("spine", -8, 0, 0).r("chest", -6, 0, 0)
		_breath(pose, t, 0.3)
		_head(pose, 6.0 * P.drift(t, 3.3, 0.5), 12.0 + 3.0 * P.drift(t, 1.1, 0.4))
		if free: _free_arms(pose, { "l_x": 25, "r_x": 25, "l_bend": 40, "r_bend": 40 })
		else: _hold(def, pose, _gun_xf("crouch_low", w), w)
		return pose
	return P.bake(def, "crouch_idle", L, f, { "loop": true, "lag": { "head": 0.1 } })

static func _crouch_walk(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 1.05
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		var u := fmod(t / L, 1.0)
		_gait(def, pose, u, { "swing": 16.0, "knee": 30.0, "bob": 0.012, "lean": 14.0, "thigh_base": 48.0, "knee_base": 62.0, "foot_base": 14.0, "hips_drop": 0.27 })
		pose.r("spine", -6, 0, 0)
		if free: _free_arms(pose, { "l_x": 20, "r_x": 20, "l_bend": 35, "r_bend": 35 })
		else:
			var gun := _gun_xf("crouch_low", w); gun.origin.y += 0.06
			gun.origin += Vector3(0.008 * sin(u * TAU), 0.01 * (-cos(2.0 * u * TAU)), 0)
			_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "crouch_walk", L, f, { "loop": true, "footsteps": [[0.0, "l"], [L * 0.5, "r"]], "lag": { "head": 0.06 }, "meta": { "stride": 1.2, "cycle": L } })

static func _aim(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle")
	var L := 2.0
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		# bladed stance: right shoulder back, left foot forward, cheek on the stock
		pose.r("hips", -2, -12, 0).r("spine", -2, -6, 0).r("chest", -3, -8, 0)
		pose.r("thigh_l", 8, 4, 0).r("thigh_r", -4, -10, 0).r("shin_l", -8, 0, 0).r("shin_r", -3, 0, 0).r("foot_r", 0, 12, 0)
		_breath(pose, t, 0.33, 0.6)
		var head_y := 24.0 if w != "pistol" else 12.0
		_head(pose, head_y, -4.0, -10.0 if w != "pistol" else 0.0)
		var gun := _gun_xf("aim", w)
		var sway := Vector3(0.003 * sin(t * 2.1), 0.003 * sin(t * 1.7 + 1.0), 0.0)
		gun.origin += sway
		_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "aim", L, f, { "loop": true })

static func _fire(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle")
	var L := 0.32
	var aim: Animation = null
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		pose.r("hips", -2, -12, 0).r("spine", -2, -6, 0).r("chest", -3, -8, 0)
		pose.r("thigh_l", 8, 4, 0).r("thigh_r", -4, -10, 0).r("shin_l", -8, 0, 0).r("shin_r", -3, 0, 0).r("foot_r", 0, 12, 0)
		var head_y := 24.0 if w != "pistol" else 12.0
		var k := (1.0 - P.ease_out(t / 0.14)) if t < 0.14 else 0.0
		var kick := exp(-t * 14.0) * (1.0 if t > 0.0 else 0.0)
		_head(pose, head_y, -4.0 + 3.0 * kick, -10.0 if w != "pistol" else 0.0)
		pose.r("chest", 3.5 * kick, 0, 0).r("spine", 1.5 * kick, 0, 0)
		var gun := _gun_xf("aim", w)
		gun.origin += Vector3(0, 0.012 * kick, 0.045 * kick * (1.6 if w == "mg" else 1.0))
		gun.basis = Basis(Vector3.RIGHT, deg_to_rad(4.5 * kick)) * gun.basis
		_hold(def, pose, gun, w)
		k = k
		return pose
	aim = aim
	return P.bake(def, "fire", L, f, { "spring": { "hand_r": [1600.0, 40.0], "hand_l": [1600.0, 40.0], "head": [700.0, 30.0] } })

static func _reload(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle")
	var L := 2.4
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		pose.r("chest", -8, 6, 0).r("spine", -4, 2, 0)
		_head(pose, 8.0, -28.0 + 6.0 * P.window(t, 1.55, 1.8, 2.05, 2.3), -6.0)
		var gun := _gun_xf("reload", w)
		# the gun rocks as the mag is struck out and seated, and rolls for the charging handle
		var seat := P.bump(t, 1.2, 1.45)
		var chamber := P.window(t, 1.6, 1.8, 2.0, 2.2)
		gun.basis = Basis(Vector3.RIGHT, deg_to_rad(-6.0 * seat + 4.0 * chamber)) * Basis(Vector3.BACK, deg_to_rad(-12.0 * chamber)) * gun.basis
		gun.origin += Vector3(0, -0.02 * seat, 0.04 * chamber * sin(t * 40.0) * 0.2)
		var grip_l: Vector3 = GRIP_L.get(w, GRIP_L["rifle"])
		# left hand path: fore-end -> mag well -> pulled out and down -> hip pouch -> mag well (seat) -> charging handle -> fore-end
		var mag_well := Vector3(0.0, -0.11, -0.07) if w != "pistol" else Vector3(0.0, -0.12, 0.0)
		var pulled := mag_well + Vector3(0.02, -0.16, 0.03)
		var handle := Vector3(0.05, 0.05, -0.02) if w != "pistol" else Vector3(0.03, 0.03, -0.1)
		var racked := handle + Vector3(0.0, 0.0, 0.12)
		var hip := Vector3(-0.16, 0.98, -0.10)   # root space
		var keys := [[0.0, gun * grip_l], [0.32, gun * mag_well], [0.5, gun * pulled], [0.85, hip], [1.2, gun * (mag_well + Vector3(0, -0.06, 0.02))], [1.42, gun * mag_well], [1.6, gun * handle], [1.72, gun * racked], [1.95, gun * handle], [2.3, gun * grip_l]]
		var tl: Vector3 = keys[0][1]
		for i in range(1, keys.size()):
			if t <= keys[i][0]:
				var u: float = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])
				var ease := P.ease_snap(u) if i in [2, 5, 8] else P.ease_io(u)
				tl = (keys[i - 1][1] as Vector3).lerp(keys[i][1], ease)
				break
			tl = keys[i][1]
		P.ik(def, pose, "upper_arm_r", "forearm_r", "hand_r", gun.origin, Vector3(0.9, -0.35, 0.55), hand_r_basis(gun.basis, w))
		var lb := hand_l_basis(gun.basis, w)
		if t > 0.25 and t < 2.1: lb = gun.basis * P._basis_down(Vector3(0.2, -0.9, -0.3).normalized(), Vector3(1, 0, 0))
		P.ik(def, pose, "upper_arm_l", "forearm_l", "hand_l", tl, Vector3(-0.7, -0.6, 0.3), lb)
		_grip(pose, "r", 1.0); _grip(pose, "l", 0.7 if (t > 0.3 and t < 1.5) else 0.85)
		return pose
	var meta := { "stages": [[0.05, "magout"], [1.3, "magin"], [1.85, "chamber"]] }
	return P.bake(def, "reload", L, f, { "lag": { "hand_l": 0.03, "head": 0.08 }, "spring": { "forearm_l": [1200.0, 45.0] }, "meta": meta })

static func _search(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 5.0
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		# scan: pauses and sweeps, the torso following late
		var u := t / L
		var yaw := 45.0 * sin(u * TAU) * (0.55 + 0.45 * absf(sin(u * TAU * 2.0 + 0.4)))
		var pitch := -4.0 + 6.0 * sin(u * TAU * 3.0 + 1.0)
		pose.p("hips", Vector3(0.02 * sin(u * TAU), -0.02, 0)).r("hips", -2, yaw * 0.15, 0)
		pose.r("spine", -3, yaw * 0.2, 0).r("chest", -4, yaw * 0.3, 0)
		_breath(pose, t, 0.35, 1.2)
		_head(pose, yaw * 0.5, pitch)
		if free: _free_arms(pose, { "l_x": 12, "r_x": 12, "l_bend": 25, "r_bend": 25 })
		else:
			var gun := _gun_xf("high", w)
			gun.basis = Basis(Vector3.UP, deg_to_rad(yaw * 0.25)) * gun.basis
			_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "search", L, f, { "loop": true, "lag": { "head": 0.15, "chest": 0.1 } })

static func _flinch(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 0.5
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var k := P.ease_snap(t / 0.08) * (1.0 - P.ease_io((t - 0.18) / 0.3))
		pose.p("hips", Vector3(0, -0.05 * k, 0.02 * k)).r("hips", -4 * k, 0, 0)
		pose.r("spine", -8 * k, 0, 0).r("chest", -12 * k, 5 * k, 0)
		pose.r("shoulder_l", 0, 0, -12 * k).r("shoulder_r", 0, 0, 12 * k)
		_head(pose, 15 * k, -30 * k, 8 * k)
		pose.r("thigh_l", 8 * k, 0, 0).r("thigh_r", 6 * k, 0, 0).r("shin_l", -14 * k, 0, 0).r("shin_r", -10 * k, 0, 0)
		if free: _free_arms(pose, { "l_x": 30 * k, "r_x": 30 * k, "l_bend": 60 * k, "r_bend": 60 * k })
		else:
			var gun := _gun_xf("low", w)
			gun.origin += Vector3(-0.03 * k, 0.05 * k, 0.03 * k)
			_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "flinch", L, f, { "spring": { "head": [600.0, 26.0], "neck": [600.0, 26.0] } })

static func _hit(def: Dictionary, o: Dictionary, front: bool) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 0.7
	var sgn := 1.0 if front else -1.0    # front: thrown back
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var k := P.ease_snap(t / 0.1) * (1.0 - P.ease_io((t - 0.25) / 0.45))
		var stag := P.ease_out(t / 0.35)
		pose.p("hips", Vector3(0, -0.06 * k, sgn * 0.09 * stag)).r("hips", -sgn * 6 * k, 0, 0)
		pose.r("spine", sgn * 12 * k, 4 * k, 0).r("chest", sgn * 20 * k, 6 * k, 3 * k)
		_head(pose, 10 * k, sgn * 28 * k, -6 * k)
		# a stagger step
		if front:
			pose.r("thigh_r", -22 * stag * (1.0 - 0.5 * stag), 0, 0).r("shin_r", -10 * k, 0, 0).r("thigh_l", 10 * k, 0, 0).r("shin_l", -25 * k, 0, 0)
		else:
			pose.r("thigh_l", 24 * stag * (1.0 - 0.5 * stag), 0, 0).r("shin_l", -30 * k, 0, 0).r("thigh_r", 4 * k, 0, 0).r("shin_r", -12 * k, 0, 0)
		if free: _free_arms(pose, { "l_x": 40 * k, "r_x": 35 * k, "l_bend": 50 * k, "r_bend": 45 * k })
		else:
			var gun := _gun_xf("low", w)
			gun.origin += Vector3(0.04 * k, 0.12 * k, sgn * 0.05 * k)
			gun.basis = Basis(Vector3.RIGHT, deg_to_rad(sgn * 25 * k)) * gun.basis
			_hold(def, pose, gun, w, 0.4 * k)
		return pose
	return P.bake(def, "hit_front" if front else "hit_back", L, f, { "spring": { "head": [500.0, 22.0], "neck": [500.0, 22.0], "hand_l": [900.0, 30.0] } })

static func _death(def: Dictionary, o: Dictionary, front: bool) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 2.2
	var pos: Dictionary = def["pos"]
	var hip_y: float = pos["hips"].y
	# key poses
	var k0 := P.RigPose.new(); _stance(def, k0)
	if free: _free_arms(k0)
	else: _hold(def, k0, _gun_xf("low", w), w)
	var k1 := P.RigPose.new()   # knees give, torso arches
	k1.p("hips", Vector3(0, -0.30, 0.05 if front else -0.05)).r("hips", 10 if front else -14, 0, 0)
	k1.r("thigh_l", 28, 6, 0).r("thigh_r", 32, -6, 0).r("shin_l", -75, 0, 0).r("shin_r", -85, 0, 0).r("foot_l", 30, 0, 0).r("foot_r", 30, 0, 0)
	k1.r("spine", 12 if front else -16, 5, 0).r("chest", 18 if front else -22, 6, 4).r("neck", 14 if front else -18, 0, 0).r("head", 20 if front else -22, 8, 6)
	k1.r("upper_arm_l", 30, 0, -35).r("upper_arm_r", 20, 0, 40).r("forearm_l", 40, 0, 0).r("forearm_r", 30, 0, 0)
	_grip(k1, "l", 0.4); _grip(k1, "r", 0.9)
	var k2 := P.RigPose.new()   # on the ground
	if front:
		k2.p("hips", Vector3(0.05, -(hip_y - 0.16), 0.32)).r("hips", 84, 6, 4)
		k2.r("thigh_l", 12, 8, 4).r("thigh_r", 26, -14, -6).r("shin_l", -22, 0, 0).r("shin_r", -48, 0, 0).r("foot_l", -30, 0, 10).r("foot_r", -20, 0, -15)
		k2.r("spine", 4, 0, 3).r("chest", 4, 4, 5).r("neck", 6, 10, 0).r("head", 8, 22, 12)
		k2.r("upper_arm_l", 30, 0, -70).r("upper_arm_r", 10, 0, 55).r("forearm_l", 20, 0, -20).r("forearm_r", 70, 0, 0)
	else:
		k2.p("hips", Vector3(-0.04, -(hip_y - 0.15), -0.30)).r("hips", -86, -5, 3)
		k2.r("thigh_l", -6, 10, 6).r("thigh_r", 8, -12, -8).r("shin_l", -12, 0, 0).r("shin_r", -30, 0, 0).r("foot_l", -30, 0, 0).r("foot_r", -25, 0, 0)
		k2.r("spine", -4, 0, -3).r("chest", -6, -6, -5).r("neck", -8, -14, 0).r("head", -6, -30, -10)
		k2.r("upper_arm_l", 40, 0, -60).r("upper_arm_r", 60, 0, 30).r("forearm_l", 40, 0, 0).r("forearm_r", 45, 0, 0)
	_grip(k2, "l", 0.3, 0.4); _grip(k2, "r", 0.6)
	var k3 := k2.copy()   # settle: a last slump
	k3.r("head", 2, 4, 3).r("upper_arm_r", 3, 0, 4).r("foot_r", -4, 0, 0)
	k3.p("hips", Vector3(0, -0.01, 0))
	var sampler := P.keyed([[0.0, k0, "io"], [0.28, k1, "out"], [0.75, k2, "in"], [1.0, k3, "out"], [L, k3, "io"]])
	return P.bake(def, "death_front" if front else "death_back", L, sampler, { "spring": { "head": [260.0, 14.0], "neck": [300.0, 16.0], "upper_arm_l": [220.0, 14.0], "upper_arm_r": [220.0, 14.0], "forearm_l": [260.0, 16.0], "forearm_r": [260.0, 16.0], "hips": [420.0, 24.0], "chest": [380.0, 20.0] }, "meta": { "ground": 0.85 } })

static func _melee(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle"); var free := w == "none"
	var L := 0.85
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var wind := P.window(t, 0.0, 0.22, 0.24, 0.34)
		var strike := P.window(t, 0.24, 0.34, 0.5, 0.75)
		var lunge := P.ease_out(clampf((t - 0.2) / 0.2, 0.0, 1.0)) * (1.0 - P.ease_io((t - 0.55) / 0.3))
		pose.p("hips", Vector3(0, -0.06 * lunge, -0.16 * lunge)).r("hips", -6 * lunge, -18 * wind + 22 * strike, 0)
		pose.r("spine", -6 * lunge, -8 * wind + 12 * strike, 0).r("chest", -10 * lunge, -12 * wind + 16 * strike, 0)
		pose.r("thigh_l", 34 * lunge, 0, 0).r("shin_l", -30 * lunge, 0, 0).r("thigh_r", -18 * lunge, 0, 0).r("foot_r", -18 * lunge, 0, 0)
		_head(pose, 0.0, -6.0 * strike, 0.0)
		if free:
			# a clawing swipe with the right arm
			pose.r("upper_arm_l", 20 * strike, 0, -20).r("forearm_l", 30, 0, 0)
			pose.r("upper_arm_r", -70 * wind + 95 * strike, -20 * wind + 30 * strike, 40 * wind + 10 * strike).r("forearm_r", 90 * wind + 15 * strike, 0, 0)
			_grip(pose, "r", 0.5, 0.4); _grip(pose, "l", 0.3)
		else:
			# muzzle thrust
			var gun := _gun_xf("hip", w)
			gun.origin += Vector3(-0.02 * wind, 0.06 * wind, 0.12 * wind - 0.30 * strike)
			gun.basis = Basis(Vector3.RIGHT, deg_to_rad(-10 * wind + 8 * strike)) * gun.basis
			_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "melee", L, f, { "spring": { "head": [600.0, 26.0], "hand_l": [900.0, 32.0] }, "meta": { "impact": 0.34 } })

static func _throw(def: Dictionary, o: Dictionary) -> Animation:
	var w: String = o.get("weapon", "rifle")
	var L := 1.25
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var wind := P.window(t, 0.05, 0.4, 0.42, 0.62)
		var rel := P.window(t, 0.45, 0.62, 0.8, 1.1)
		var recover := P.ease_io((t - 0.85) / 0.35)
		pose.p("hips", Vector3(0.02 * wind, -0.03 * wind - 0.05 * rel, 0.04 * wind - 0.14 * rel)).r("hips", 4 * wind - 8 * rel, -22 * wind + 24 * rel, 0)
		pose.r("spine", 5 * wind - 10 * rel, -10 * wind + 14 * rel, 0).r("chest", 8 * wind - 14 * rel, -14 * wind + 18 * rel, 0)
		pose.r("thigh_l", -10 * wind + 36 * rel, 0, 0).r("shin_l", -8 * wind - 28 * rel, 0, 0).r("thigh_r", 8 * wind - 12 * rel, 0, 0).r("foot_r", -10 * rel, 0, 0)
		_head(pose, -20 * wind + 14 * rel, 6 * wind - 10 * rel)
		# right arm: over the shoulder, then whipped forward
		pose.r("upper_arm_r", -75 * wind + 100 * rel, -15 * wind + 20 * rel, 55 * wind + 20 * rel)
		pose.r("forearm_r", 120 * wind + 20 * rel, 0, 0)
		pose.r("hand_r", 10 * wind - 30 * rel, 0, 0)
		_grip(pose, "r", 1.0 - rel * 0.95, rel * 0.4)
		# the gun hangs from the left hand meanwhile
		var gun := _gun_xf("hang_l", w)
		gun.origin += Vector3(-0.02 * wind, 0.02 * rel, 0)
		var lb := gun.basis * P._basis_down(Vector3(0.0, -0.9, 0.42).normalized(), Vector3(-1, 0, 0))
		P.ik(def, pose, "upper_arm_l", "forearm_l", "hand_l", gun.origin, Vector3(-0.8, -0.5, 0.4), lb)
		_grip(pose, "l", 1.0)
		recover = recover
		return pose
	return P.bake(def, "throw", L, f, { "spring": { "hand_r": [700.0, 26.0], "forearm_r": [900.0, 34.0], "head": [600.0, 26.0] }, "meta": { "gun_hand": "l", "release": 0.58 } })

static func _peek(def: Dictionary, o: Dictionary, dir: float) -> Animation:
	var w: String = o.get("weapon", "rifle")
	var L := 2.0
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var s := 0.5 + 0.5 * sin(t * TAU / L - PI * 0.5)   # eases out and back once per loop
		var lean := 1.0
		pose.p("hips", Vector3(dir * 0.10 * lean, -0.03, 0)).r("hips", -2, 0, -dir * 6 * lean)
		pose.r("spine", -2, 0, -dir * 14 * lean).r("chest", -3, -dir * 6, -dir * 12 * lean)
		pose.r("thigh_l", 4, 0, (8 if dir < 0 else -4) * lean).r("thigh_r", 4, 0, (-8 if dir > 0 else 4) * lean)
		_breath(pose, t, 0.4, 0.6)
		_head(pose, dir * 6.0 + 20.0 * s * 0.1, -3.0, dir * 8.0)
		var gun := _gun_xf("aim", w)
		gun.origin += Vector3(dir * 0.10 * lean, -0.02, 0.0)
		gun.basis = Basis(Vector3.BACK, deg_to_rad(-dir * 10 * lean)) * gun.basis
		_hold(def, pose, gun, w)
		return pose
	return P.bake(def, "peek_l" if dir < 0 else "peek_r", L, f, { "loop": true, "lag": { "head": 0.08 } })

# ---------------------------------------------------------------- phantom
static func _circle(def: Dictionary, o: Dictionary) -> Animation:
	# a sideways stalking walk to the right, the head locked on the target (the entity faces the player)
	var L := 1.2
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		var u := fmod(t / L, 1.0)
		var ph := u * TAU
		# crossover step: legs swing sideways (about z) instead of forward
		for side in ["l", "r"]:
			var sg := -1.0 if side == "l" else 1.0
			var tt := u if side == "l" else fmod(u + 0.5, 1.0)
			var p := tt * TAU
			var swing := 22.0 * cos(p)
			pose.r("thigh_" + side, 10.0 + 6.0 * cos(p), sg * 10.0, swing)
			pose.r("shin_" + side, -(20.0 + 45.0 * pow(maxf(0.0, -sin(p)), 1.3)), 0, 0)
			pose.r("foot_" + side, 8.0 * pow(maxf(0.0, -sin(p)), 2.0), sg * 20.0, -swing * 0.6)
		pose.p("hips", Vector3(0.02 * sin(ph), -0.05 + 0.02 * (-cos(2.0 * ph)), 0)).r("hips", -8, 0, 5.0 * sin(ph))
		pose.r("spine", -10, 0, -3.0 * sin(ph)).r("chest", -12, -4, -3.0 * sin(ph))
		pose.r("neck", 10, 0, 0).r("head", 14, 0, 2.0 * sin(ph))
		# long arms hanging, swaying, fingers flexing
		pose.r("upper_arm_l", 14 + 8 * sin(ph), 4, -12).r("upper_arm_r", 14 - 8 * sin(ph), -4, 12)
		pose.r("forearm_l", 16, 10, 0).r("forearm_r", 16, -10, 0)
		_grip(pose, "l", 0.35 + 0.15 * sin(ph * 2.0), 0.3); _grip(pose, "r", 0.35 - 0.15 * sin(ph * 2.0), 0.3)
		return pose
	return P.bake(def, "circle", L, f, { "loop": true, "footsteps": [[0.0, "l"], [L * 0.5, "r"]], "lag": { "hand_l": 0.08, "hand_r": 0.08, "head": 0.05 }, "meta": { "stride": 1.3, "cycle": L } })

static func _scream(def: Dictionary, o: Dictionary) -> Animation:
	var L := 1.0
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var k := P.ease_back(t / 0.22, 2.2) * (1.0 - P.ease_io((t - 0.7) / 0.3))
		var tremor := sin(t * 60.0) * 0.6 * k
		pose.p("hips", Vector3(0, -0.06 * k, -0.02 * k)).r("hips", -4 * k, 0, 0)
		pose.r("spine", 10 * k, 0, 0).r("chest", 18 * k + tremor, 0, tremor)
		pose.r("neck", 16 * k, 0, 0).r("head", 26 * k + tremor * 2.0, 0, 0)
		pose.r("thigh_l", 12 * k, 8 * k, 4 * k).r("thigh_r", 12 * k, -8 * k, -4 * k).r("shin_l", -20 * k, 0, 0).r("shin_r", -20 * k, 0, 0)
		# arms thrown wide and up, fingers splayed
		pose.r("upper_arm_l", 20 * k, 0, -110 * k - tremor).r("upper_arm_r", 20 * k, 0, 110 * k + tremor)
		pose.r("forearm_l", 30 * k, 0, -20 * k).r("forearm_r", 30 * k, 0, 20 * k)
		pose.r("hand_l", -20 * k, 0, 10 * k).r("hand_r", -20 * k, 0, -10 * k)
		_grip(pose, "l", 0.1, 1.0 * k); _grip(pose, "r", 0.1, 1.0 * k)
		return pose
	return P.bake(def, "scream", L, f, { "spring": { "hand_l": [500.0, 20.0], "hand_r": [500.0, 20.0], "head": [400.0, 18.0] }, "meta": { "peak": 0.25 } })

static func _grab(def: Dictionary, o: Dictionary) -> Animation:
	var L := 0.9
	var f := func(t: float) -> P.RigPose:
		var pose := P.RigPose.new()
		_stance(def, pose)
		var reach := P.ease_snap(t / 0.18) * (1.0 - P.ease_io((t - 0.5) / 0.35))
		var lunge := P.ease_out(t / 0.25) * (1.0 - P.ease_io((t - 0.55) / 0.3))
		pose.p("hips", Vector3(0, -0.10 * lunge, -0.22 * lunge)).r("hips", -14 * lunge, 0, 0)
		pose.r("spine", -12 * lunge, 0, 0).r("chest", -16 * lunge, 0, 0).r("neck", 14 * lunge, 0, 0).r("head", 18 * lunge, 0, 0)
		pose.r("thigh_l", 40 * lunge, 4, 0).r("shin_l", -45 * lunge, 0, 0).r("thigh_r", -24 * lunge, -4, 0).r("shin_r", -8 * lunge, 0, 0).r("foot_r", -25 * lunge, 0, 0)
		pose.r("upper_arm_l", 100 * reach, 15 * reach, -20 * reach).r("upper_arm_r", 100 * reach, -15 * reach, 20 * reach)
		pose.r("forearm_l", 10 + 20 * reach, 0, 0).r("forearm_r", 10 + 20 * reach, 0, 0)
		pose.r("hand_l", -10 * reach, 0, 0).r("hand_r", -10 * reach, 0, 0)
		var close := P.ease_snap((t - 0.3) / 0.12)
		_grip(pose, "l", 0.15 + 0.8 * close, 0.8 * reach * (1.0 - close)); _grip(pose, "r", 0.15 + 0.8 * close, 0.8 * reach * (1.0 - close))
		return pose
	return P.bake(def, "grab", L, f, { "spring": { "hand_l": [900.0, 30.0], "hand_r": [900.0, 30.0], "head": [500.0, 22.0] }, "meta": { "impact": 0.3 } })
