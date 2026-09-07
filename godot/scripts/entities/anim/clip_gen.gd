class_name ClipGen
## Procedural animation baking. A clip is a sampler Callable(t) -> RigPose evaluated at a fixed rate into bone
## rotation tracks (every bone, so crossfades never leave stale poses) plus hips/root position tracks. Poses are
## authored with FK/IK helpers in root space; follow-through comes from a post pass that runs lagging bones
## through a damped spring over the sampled frames (looped clips are run around three times to converge).

class RigPose:
	var rot := {}      # bone -> Quaternion (bone-local, on top of the identity rest)
	var pos := {}      # bone -> Vector3 offset from the rest position (bone-local)
	func r(bone: String, x_deg: float, y_deg: float = 0.0, z_deg: float = 0.0) -> RigPose:
		var q := Quaternion.from_euler(Vector3(deg_to_rad(x_deg), deg_to_rad(y_deg), deg_to_rad(z_deg)))
		rot[bone] = (rot.get(bone, Quaternion.IDENTITY) as Quaternion) * q
		return self
	func rq(bone: String, q: Quaternion) -> RigPose:
		rot[bone] = (rot.get(bone, Quaternion.IDENTITY) as Quaternion) * q
		return self
	func set_rq(bone: String, q: Quaternion) -> RigPose:
		rot[bone] = q; return self
	func p(bone: String, v: Vector3) -> RigPose:
		pos[bone] = (pos.get(bone, Vector3.ZERO) as Vector3) + v
		return self
	func get_r(bone: String) -> Quaternion: return rot.get(bone, Quaternion.IDENTITY)
	func get_p(bone: String) -> Vector3: return pos.get(bone, Vector3.ZERO)
	func copy() -> RigPose:
		var o := RigPose.new(); o.rot = rot.duplicate(); o.pos = pos.duplicate(); return o
	## Compose: this then other (other's rotations applied after, offsets summed).
	func add(o: RigPose) -> RigPose:
		for b in o.rot: rot[b] = (rot.get(b, Quaternion.IDENTITY) as Quaternion) * o.rot[b]
		for b in o.pos: pos[b] = (pos.get(b, Vector3.ZERO) as Vector3) + o.pos[b]
		return self
	## Blend toward another pose (slerp / lerp) by t.
	func mix(o: RigPose, t: float) -> RigPose:
		var out := RigPose.new()
		var keys := {}
		for b in rot: keys[b] = true
		for b in o.rot: keys[b] = true
		for b in keys: out.rot[b] = (rot.get(b, Quaternion.IDENTITY) as Quaternion).slerp(o.rot.get(b, Quaternion.IDENTITY), t)
		keys = {}
		for b in pos: keys[b] = true
		for b in o.pos: keys[b] = true
		for b in keys: out.pos[b] = (pos.get(b, Vector3.ZERO) as Vector3).lerp(o.pos.get(b, Vector3.ZERO), t)
		return out
	## Scale every rotation/offset toward rest by k (0 = rest, 1 = unchanged).
	func scale(k: float) -> RigPose:
		for b in rot: rot[b] = Quaternion.IDENTITY.slerp(rot[b], k)
		for b in pos: pos[b] = pos[b] * k
		return self

# ---------------------------------------------------------------- easing
static func ease_io(t: float) -> float: t = clampf(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t)
static func ease_in(t: float) -> float: t = clampf(t, 0.0, 1.0); return t * t
static func ease_out(t: float) -> float: t = clampf(t, 0.0, 1.0); return 1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t)
static func ease_snap(t: float) -> float: t = clampf(t, 0.0, 1.0); return 1.0 - pow(1.0 - t, 5.0)
static func ease_back(t: float, k: float = 1.7) -> float:
	t = clampf(t, 0.0, 1.0); var u := t - 1.0
	return 1.0 + u * u * ((k + 1.0) * u + k)
static func ease_by(name: String, t: float) -> float:
	match name:
		"in": return ease_in(t)
		"out": return ease_out(t)
		"snap": return ease_snap(t)
		"back": return ease_back(t)
		"linear": return clampf(t, 0.0, 1.0)
		"hold": return 0.0 if t < 1.0 else 1.0
		_: return ease_io(t)
## 0..1..0 bump over [a, b]
static func bump(t: float, a: float, b: float) -> float:
	if t <= a or t >= b: return 0.0
	var u := (t - a) / (b - a)
	return sin(u * PI)
## smooth window: rises over [a, b], holds, falls over [c, d]
static func window(t: float, a: float, b: float, c: float, d: float) -> float:
	return ease_io((t - a) / maxf(b - a, 1e-4)) * (1.0 - ease_io((t - c) / maxf(d - c, 1e-4)))
static func hash1(x: float) -> float:
	var v := sin(x * 12.9898 + 78.233) * 43758.5453; return v - floor(v)
## smooth pseudo-random drift in -1..1 (sum of incommensurate sines)
static func drift(t: float, seed: float, rate: float = 1.0) -> float:
	return (sin(t * rate * 1.0 + seed) * 0.5 + sin(t * rate * 2.13 + seed * 1.7) * 0.3 + sin(t * rate * 0.47 + seed * 2.9) * 0.2)

# ---------------------------------------------------------------- FK / IK
## Global (root-space) transforms of every bone for a pose.
static func fk(def: Dictionary, pose: RigPose) -> Dictionary:
	var out := {}
	var pos: Dictionary = def["pos"]; var parent: Dictionary = def["parent"]
	for n in def["names"]:
		var pn: String = parent[n]
		var local_pos: Vector3 = pos[n] - (pos[pn] if pn != "" else Vector3.ZERO)
		var t := Transform3D(Basis(pose.get_r(n)), local_pos + pose.get_p(n))
		out[n] = (out[pn] * t) if pn != "" else t
	return out

static func _basis_down(d: Vector3, x_axis: Vector3) -> Basis:
	var y := -d.normalized()
	var x := (x_axis - y * y.dot(x_axis)).normalized()
	if x.length_squared() < 1e-6: x = y.cross(Vector3.FORWARD).normalized()
	var z := x.cross(y).normalized()
	return Basis(x, y, z)

## Two-bone IK: sets pose rotations for upper/lower so the end joint reaches target (root space). pole is a
## direction hint for the middle joint. Returns true when reached. end_basis (optional) fixes the end bone's
## global basis (e.g. a hand on a grip).
static func ik(def: Dictionary, pose: RigPose, upper: String, lower: String, end: String, target: Vector3, pole: Vector3, end_basis: Variant = null) -> bool:
	var g := fk(def, pose)
	var pos: Dictionary = def["pos"]
	var S: Vector3 = g[upper].origin
	var l1: float = pos[upper].distance_to(pos[lower]); var l2: float = pos[lower].distance_to(pos[end])
	var to := target - S; var d := to.length()
	var reached := true
	var maxd := (l1 + l2) * 0.995
	if d > maxd: d = maxd; reached = false
	d = maxf(d, 0.02)
	var u := to.normalized()
	var pp := pole - u * u.dot(pole)
	if pp.length_squared() < 1e-6: pp = u.cross(Vector3.UP)
	pp = pp.normalized()
	var cos_a := clampf((l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d), -1.0, 1.0)
	var a := acos(cos_a)
	var dir_u := (u * cos(a) + pp * sin(a)).normalized()
	var E := S + dir_u * l1
	var T := S + u * d
	var dir_l := (T - E).normalized()
	var n := dir_u.cross(dir_l)
	if n.length_squared() < 1e-6: n = u.cross(pp)
	n = n.normalized()
	var G_u := _basis_down(dir_u, n)
	var G_l := _basis_down(dir_l, n)
	var parent: Dictionary = def["parent"]
	var G_parent: Basis = (g[parent[upper]] as Transform3D).basis
	pose.set_rq(upper, (G_parent.inverse() * G_u).get_rotation_quaternion())
	pose.set_rq(lower, (G_u.inverse() * G_l).get_rotation_quaternion())
	if end_basis != null:
		pose.set_rq(end, (G_l.inverse() * (end_basis as Basis)).get_rotation_quaternion())
	return reached

# ---------------------------------------------------------------- keyed poses
## keys: [[time, RigPose, ease], ...] sorted by time. Returns a sampler.
static func keyed(keys: Array) -> Callable:
	return func(t: float) -> RigPose:
		if t <= keys[0][0]: return (keys[0][1] as RigPose).copy()
		for i in range(1, keys.size()):
			if t <= keys[i][0]:
				var a: Array = keys[i - 1]; var b: Array = keys[i]
				var u := (t - a[0]) / maxf(b[0] - a[0], 1e-5)
				return (a[1] as RigPose).mix(b[1], ease_by(b[2] if b.size() > 2 else "io", u))
		return (keys[-1][1] as RigPose).copy()

# ---------------------------------------------------------------- baking
## opts: {fps, loop, lag: {bone: seconds}, spring: {bone: [stiffness, damping]}, footsteps: [[t, "l"|"r"]], meta: {}}
static func bake(def: Dictionary, name: String, length: float, sampler: Callable, opts: Dictionary = {}) -> Animation:
	var fps: float = opts.get("fps", 30.0)
	var loop: bool = opts.get("loop", false)
	var n := maxi(2, int(round(length * fps)))
	var dt := 1.0 / fps
	var names: Array = def["names"]
	var rots := {}; var poss := {}
	for b in names: rots[b] = []
	poss["hips"] = []; poss["root"] = []
	for f in n:
		var t := f * dt
		var pose: RigPose = sampler.call(t)
		for b in names: rots[b].append(pose.get_r(b))
		poss["hips"].append(pose.get_p("hips")); poss["root"].append(pose.get_p("root"))
	# follow-through: lag / spring passes
	var lag: Dictionary = opts.get("lag", {})
	var spring: Dictionary = opts.get("spring", {})
	for b in lag:
		if not rots.has(b): continue
		rots[b] = _lag_pass(rots[b], float(lag[b]), dt, loop)
	for b in spring:
		if not rots.has(b): continue
		var sp: Array = spring[b]
		rots[b] = _spring_pass(rots[b], float(sp[0]), float(sp[1]), dt, loop)
	var anim := Animation.new()
	anim.length = n * dt if loop else (n - 1) * dt
	anim.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	for b in names:
		var tr := anim.add_track(Animation.TYPE_ROTATION_3D)
		anim.track_set_path(tr, NodePath("Skeleton3D:" + b))
		anim.track_set_interpolation_type(tr, Animation.INTERPOLATION_LINEAR)
		var arr: Array = rots[b]
		# skip redundant keys on bones that never move (keep first and last)
		var moving := false
		for q in arr:
			if not (q as Quaternion).is_equal_approx(arr[0]): moving = true; break
		if moving:
			for f in n: anim.rotation_track_insert_key(tr, f * dt, arr[f])
		else:
			anim.rotation_track_insert_key(tr, 0.0, arr[0])
	for b in ["hips", "root"]:
		var tr := anim.add_track(Animation.TYPE_POSITION_3D)
		anim.track_set_path(tr, NodePath("Skeleton3D:" + b))
		anim.track_set_interpolation_type(tr, Animation.INTERPOLATION_LINEAR)
		var rest_local: Vector3 = def["pos"][b] - (def["pos"][def["parent"][b]] if def["parent"][b] != "" else Vector3.ZERO)
		for f in n: anim.position_track_insert_key(tr, f * dt, rest_local + poss[b][f])
	if opts.has("footsteps"): anim.set_meta("footsteps", opts["footsteps"])
	if opts.has("meta"):
		for k in opts["meta"]: anim.set_meta(k, opts["meta"][k])
	anim.resource_name = name
	return anim

static func _lag_pass(arr: Array, lag: float, dt: float, loop: bool) -> Array:
	if lag <= 0.0: return arr
	var k := 1.0 - exp(-dt / lag)
	var cur: Quaternion = arr[0]
	var out := arr.duplicate()
	var passes := 3 if loop else 1
	for p in passes:
		for i in arr.size():
			cur = cur.slerp(arr[i], k)
			out[i] = cur
	return out

## Damped spring on the rotation vector: overshoot and settle.
static func _spring_pass(arr: Array, stiffness: float, damping: float, dt: float, loop: bool) -> Array:
	var out := arr.duplicate()
	var x := _rotvec(arr[0]); var v := Vector3.ZERO
	var passes := 3 if loop else 1
	for p in passes:
		for i in arr.size():
			var target := _rotvec(arr[i])
			# sub-step for stability
			for s in 4:
				var h := dt / 4.0
				var a := (target - x) * stiffness - v * damping
				v += a * h; x += v * h
			out[i] = _from_rotvec(x)
	return out
static func _rotvec(q: Quaternion) -> Vector3:
	var qq := q.normalized()
	if qq.w < 0.0: qq = -qq
	var ang := 2.0 * acos(clampf(qq.w, -1.0, 1.0))
	var s := sqrt(maxf(1.0 - qq.w * qq.w, 0.0))
	if s < 1e-5: return Vector3.ZERO
	return Vector3(qq.x, qq.y, qq.z) / s * ang
static func _from_rotvec(v: Vector3) -> Quaternion:
	var ang := v.length()
	if ang < 1e-6: return Quaternion.IDENTITY
	return Quaternion(v / ang, ang)

## Convenience: add every animation of a dictionary {name: Animation} to a library.
static func library(clips: Dictionary) -> AnimationLibrary:
	var lib := AnimationLibrary.new()
	for k in clips: lib.add_animation(k, clips[k])
	return lib
