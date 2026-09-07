class_name SkinBuilder
## Skinned-mesh assembly for the code-built character bodies. Geometry is described as rings (cross-sections) joined
## into tubes, ellipsoids/superellipsoids and boxes; every vertex carries up to four bone weights, a UV, a colour and
## a tangent. Normals are smoothed by position (so ring seams and touching parts blend), tangents follow the UVs.
## Colour channels are a convention shared with the shaders: r = shiver weight, g = cloth (0 skin .. 1 cloth),
## b = grime/wear, a = tatter threshold (1 = solid; lower values fray in the mimic shader).
var pos := PackedVector3Array()
var nrm := PackedVector3Array()
var uv := PackedVector2Array()
var col := PackedColorArray()
var bones := PackedInt32Array()
var weights := PackedFloat32Array()
var idx := PackedInt32Array()
var jitter := 0.0                 # per-vertex hashed displacement (metres) applied at commit
var jitter_seed := 0.0
var _smooth_groups := PackedInt32Array()   # vertices in different groups do not share normals
var group := 0

static func bw(a: int, wa: float = 1.0, b: int = -1, wb: float = 0.0, c: int = -1, wc: float = 0.0) -> Array:
	var out := [[a, wa]]
	if b >= 0 and wb > 0.0: out.append([b, wb])
	if c >= 0 and wc > 0.0: out.append([c, wc])
	return out

## Blend two bone weight sets: t = 0 → a, t = 1 → b.
static func bw_mix(a: Array, b: Array, t: float) -> Array:
	if t <= 0.0: return a
	if t >= 1.0: return b
	var acc := {}
	for p in a: acc[p[0]] = acc.get(p[0], 0.0) + p[1] * (1.0 - t)
	for p in b: acc[p[0]] = acc.get(p[0], 0.0) + p[1] * t
	var out := []
	for k in acc: out.append([k, acc[k]])
	return out

func vertex(p: Vector3, n: Vector3, t: Vector2, c: Color, w: Array) -> int:
	var i := pos.size()
	pos.append(p); nrm.append(n); uv.append(t); col.append(c)
	# normalise up to four weights
	var ws := w.duplicate()
	ws.sort_custom(func(x, y): return x[1] > y[1])
	var total := 0.0
	for k in mini(4, ws.size()): total += ws[k][1]
	if total <= 0.0: total = 1.0
	for k in 4:
		if k < ws.size(): bones.append(int(ws[k][0])); weights.append(float(ws[k][1]) / total)
		else: bones.append(0); weights.append(0.0)
	_smooth_groups.append(group)
	return i

func tri(a: int, b: int, c: int) -> void:
	idx.append(a); idx.append(b); idx.append(c)
func quad(a: int, b: int, c: int, d: int) -> void:
	tri(a, b, c); tri(a, c, d)

## One cross-section ring of segs+1 vertices (seam duplicated for UVs). Frame: right, fwd; the ring lies in the
## plane spanned by them. shape: {back: z scale on the back half, front, sq: squareness 0..1, lean: fwd shear}
func ring(center: Vector3, right: Vector3, fwd: Vector3, rx: float, rz: float, segs: int, v: float, c: Color, w: Array, shape: Dictionary = {}) -> int:
	var first := pos.size()
	var back: float = shape.get("back", 1.0); var front: float = shape.get("front", 1.0); var sq: float = shape.get("sq", 0.0)
	var flat_top: float = shape.get("flat", 0.0)
	var up := fwd.cross(right).normalized()
	for s in segs + 1:
		var a := TAU * float(s) / float(segs)
		var cx := cos(a); var sz := sin(a)
		if sq > 0.0:
			# superellipse: push toward a rounded square
			var ex := signf(cx) * pow(absf(cx), 1.0 - sq * 0.6); var ez := signf(sz) * pow(absf(sz), 1.0 - sq * 0.6)
			cx = lerpf(cx, ex, sq); sz = lerpf(sz, ez, sq)
		var zscale := front if sz > 0.0 else back
		var p := center + right * (rx * cx) + fwd * (rz * sz * zscale) + up * (flat_top * absf(cx))
		var n := (right * (cx / maxf(rx, 1e-4)) + fwd * (sz / maxf(rz, 1e-4))).normalized()
		vertex(p, n, Vector2(float(s) / float(segs), v), c, w)
	return first

func join(r0: int, r1: int, segs: int, flip: bool = false) -> void:
	for s in segs:
		var a := r0 + s; var b := r0 + s + 1; var c := r1 + s + 1; var d := r1 + s
		if flip: quad(a, d, c, b)
		else: quad(a, b, c, d)

## Close a ring with a fan to a centre vertex (normal along ±axial).
func cap(r: int, segs: int, center: Vector3, axial: Vector3, c: Color, w: Array, flip: bool = false, v: float = 0.0) -> int:
	var ci := vertex(center, axial if flip else -axial, Vector2(0.5, v), c, w)
	for s in segs:
		if flip: tri(ci, r + s + 1, r + s)
		else: tri(ci, r + s, r + s + 1)
	return ci

## A tube through a list of ring descriptors: {c: Vector3, right, fwd, rx, rz, w, v, col, shape}. Returns ring starts.
func tube(rings: Array, segs: int, close_start: bool = false, close_end: bool = false) -> Array:
	var starts := []
	for r in rings:
		starts.append(ring(r["c"], r.get("right", Vector3.RIGHT), r.get("fwd", Vector3.FORWARD), r["rx"], r["rz"], segs, r.get("v", 0.0), r.get("col", Color.WHITE), r["w"], r.get("shape", {})))
	for i in range(1, starts.size()): join(starts[i - 1], starts[i], segs)
	if close_start:
		var r0: Dictionary = rings[0]; var ax: Vector3 = r0.get("fwd", Vector3.FORWARD).cross(r0.get("right", Vector3.RIGHT)).normalized()
		cap(starts[0], segs, r0["c"], ax, r0.get("col", Color.WHITE), r0["w"], true)
	if close_end:
		var r1: Dictionary = rings[-1]; var ax1: Vector3 = r1.get("fwd", Vector3.FORWARD).cross(r1.get("right", Vector3.RIGHT)).normalized()
		cap(starts[-1], segs, r1["c"], ax1, r1.get("col", Color.WHITE), r1["w"], false, 1.0)
	return starts

## Ellipsoid / superellipsoid (sq 0 = sphere, 1 ≈ rounded box) with its axis along basis.y; lat range in 0..1 (0 = bottom).
func blob(center: Vector3, radii: Vector3, basis: Basis, segs: int, rows: int, c: Color, w: Array, opts: Dictionary = {}) -> Array:
	var sq: float = opts.get("sq", 0.0); var lat0: float = opts.get("lat0", 0.0); var lat1: float = opts.get("lat1", 1.0)
	var taper: Callable = opts.get("taper", Callable())      # func(t 0..1 bottom→top) -> Vector2 (x scale, z scale)
	var shift: Callable = opts.get("shift", Callable())      # func(t) -> Vector3 local offset
	var starts := []
	var right := basis.x.normalized(); var up := basis.y.normalized(); var fwd := -basis.z.normalized()
	for r in rows + 1:
		var t := lerpf(lat0, lat1, float(r) / float(rows))
		var phi := (t - 0.5) * PI
		var y := sin(phi); var rr := cos(phi)
		if sq > 0.0:
			var ey := signf(y) * pow(absf(y), 1.0 - sq * 0.6); var er := pow(absf(rr), 1.0 - sq * 0.6)
			y = lerpf(y, ey, sq); rr = lerpf(rr, er, sq)
		var sx := 1.0; var sz := 1.0
		if taper.is_valid(): var ts: Vector2 = taper.call(t); sx = ts.x; sz = ts.y
		var off := Vector3.ZERO
		if shift.is_valid(): off = shift.call(t)
		var cc := center + up * (y * radii.y) + right * off.x + up * off.y + fwd * off.z
		var rx := maxf(rr * radii.x * sx, 0.0005); var rz := maxf(rr * radii.z * sz, 0.0005)
		var first := pos.size()
		for s in segs + 1:
			var a := TAU * float(s) / float(segs)
			var cx := cos(a); var szn := sin(a)
			if sq > 0.0:
				var ex := signf(cx) * pow(absf(cx), 1.0 - sq * 0.6); var ez := signf(szn) * pow(absf(szn), 1.0 - sq * 0.6)
				cx = lerpf(cx, ex, sq); szn = lerpf(szn, ez, sq)
			var p := cc + right * (rx * cx) + fwd * (rz * szn)
			var n := (right * (cx / radii.x) + fwd * (szn / radii.z) + up * (y / radii.y)).normalized()
			vertex(p, n, Vector2(float(s) / float(segs), t), c, w)
		starts.append(first)
	for i in range(1, starts.size()): join(starts[i - 1], starts[i], segs)
	if lat0 <= 0.0: cap(starts[0], segs, center - up * radii.y, up, c, w, true)
	if lat1 >= 1.0: cap(starts[-1], segs, center + up * radii.y, up, c, w, false, 1.0)
	return starts

## Flat-shaded box (each face its own smoothing group). For rounded boxes use blob() with sq ≈ 0.8.
func box(center: Vector3, size: Vector3, basis: Basis, c: Color, w: Array) -> void:
	var h := size * 0.5
	var faces := [
		[Vector3(0, 0, 1), Vector3(1, 0, 0), Vector3(0, 1, 0)], [Vector3(0, 0, -1), Vector3(-1, 0, 0), Vector3(0, 1, 0)],
		[Vector3(1, 0, 0), Vector3(0, 0, -1), Vector3(0, 1, 0)], [Vector3(-1, 0, 0), Vector3(0, 0, 1), Vector3(0, 1, 0)],
		[Vector3(0, 1, 0), Vector3(1, 0, 0), Vector3(0, 0, -1)], [Vector3(0, -1, 0), Vector3(1, 0, 0), Vector3(0, 0, 1)]]
	for f in faces:
		group += 1
		var n: Vector3 = f[0]; var u: Vector3 = f[1]; var v: Vector3 = f[2]
		var hn := n * h; var hu := u * h; var hv := v * h
		var corners := [hn - hu - hv, hn + hu - hv, hn + hu + hv, hn - hu + hv]
		var uvs := [Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]
		var ids := []
		for k in 4: ids.append(vertex(center + basis * corners[k], (basis * n).normalized(), uvs[k], c, w))
		quad(ids[0], ids[1], ids[2], ids[3])

## Smooth normals by shared position (within 0.5 mm) inside the same smoothing group. Face winding is checked
## against the analytic normals first (Godot front faces are clockwise) and flipped when the majority disagrees.
func smooth_normals() -> void:
	var acc := {}
	var fn := PackedVector3Array(); fn.resize(pos.size())
	var agree := 0.0
	for i in range(0, idx.size(), 3):
		var a := idx[i]; var b := idx[i + 1]; var c := idx[i + 2]
		var n := (pos[b] - pos[a]).cross(pos[c] - pos[a])
		agree += signf(n.dot(nrm[a] + nrm[b] + nrm[c]))
		fn[a] += n; fn[b] += n; fn[c] += n
	if agree > 0.0:
		# geometric normal (right-handed cross) agrees with the analytic one: winding is CCW, flip to Godot's CW
		for i in range(0, idx.size(), 3):
			var t := idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t
	else:
		for i in fn.size(): fn[i] = -fn[i]   # fn now points outward in both cases
	for i in pos.size():
		var key := "%d,%d,%d,%d" % [roundi(pos[i].x * 2000.0), roundi(pos[i].y * 2000.0), roundi(pos[i].z * 2000.0), _smooth_groups[i]]
		acc[key] = acc.get(key, Vector3.ZERO) + fn[i]
	for i in pos.size():
		var key := "%d,%d,%d,%d" % [roundi(pos[i].x * 2000.0), roundi(pos[i].y * 2000.0), roundi(pos[i].z * 2000.0), _smooth_groups[i]]
		var n: Vector3 = acc[key]
		if n.length_squared() < 1e-12: n = nrm[i]
		nrm[i] = n.normalized()

func _tangents() -> PackedFloat32Array:
	var tan := PackedVector3Array(); tan.resize(pos.size())
	for i in range(0, idx.size(), 3):
		var a := idx[i]; var b := idx[i + 1]; var c := idx[i + 2]
		var e1 := pos[b] - pos[a]; var e2 := pos[c] - pos[a]
		var d1 := uv[b] - uv[a]; var d2 := uv[c] - uv[a]
		var det := d1.x * d2.y - d2.x * d1.y
		if absf(det) < 1e-9: continue
		var r := 1.0 / det
		var t := (e1 * d2.y - e2 * d1.y) * r
		tan[a] += t; tan[b] += t; tan[c] += t
	var out := PackedFloat32Array(); out.resize(pos.size() * 4)
	for i in pos.size():
		var n := nrm[i]
		var t := tan[i] - n * n.dot(tan[i])
		if t.length_squared() < 1e-10: t = n.cross(Vector3.UP if absf(n.y) < 0.9 else Vector3.RIGHT)
		t = t.normalized()
		out[i * 4] = t.x; out[i * 4 + 1] = t.y; out[i * 4 + 2] = t.z; out[i * 4 + 3] = 1.0
	return out

func _apply_jitter() -> void:
	if jitter <= 0.0: return
	for i in pos.size():
		var p := pos[i]
		var h := Vector3(_hash(p.x * 71.3 + p.y * 13.1 + jitter_seed, p.z * 37.7), _hash(p.y * 51.9 + p.z * 7.3 + jitter_seed, p.x * 29.1), _hash(p.z * 61.1 + p.x * 17.7 + jitter_seed, p.y * 43.3))
		pos[i] = p + (h - Vector3(0.5, 0.5, 0.5)) * jitter * weights[i * 4]
static func _hash(a: float, b: float) -> float:
	var v := sin(a * 12.9898 + b * 78.233) * 43758.5453
	return v - floor(v)

func triangle_count() -> int: return idx.size() / 3

## Commit as a new surface on mesh (created when null). Uses SurfaceTool so the skin format is set up properly.
func commit(mesh: ArrayMesh = null, material: Material = null, surface_name: String = "") -> ArrayMesh:
	_apply_jitter()
	smooth_normals()
	var tangents := _tangents()
	var st := SurfaceTool.new()
	st.set_skin_weight_count(SurfaceTool.SKIN_4_WEIGHTS)
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in pos.size():
		st.set_normal(nrm[i]); st.set_tangent(Plane(tangents[i * 4], tangents[i * 4 + 1], tangents[i * 4 + 2], tangents[i * 4 + 3]))
		st.set_uv(uv[i]); st.set_color(col[i])
		st.set_bones(PackedInt32Array([bones[i * 4], bones[i * 4 + 1], bones[i * 4 + 2], bones[i * 4 + 3]]))
		st.set_weights(PackedFloat32Array([weights[i * 4], weights[i * 4 + 1], weights[i * 4 + 2], weights[i * 4 + 3]]))
		st.add_vertex(pos[i])
	for i in idx: st.add_index(i)
	var out := st.commit(mesh)
	var si := out.get_surface_count() - 1
	if material: out.surface_set_material(si, material)
	if surface_name != "": out.surface_set_name(si, surface_name)
	return out

## Merge another builder's geometry into this one (bone indices unchanged).
func append(o: SkinBuilder) -> void:
	var base := pos.size()
	pos.append_array(o.pos); nrm.append_array(o.nrm); uv.append_array(o.uv); col.append_array(o.col); bones.append_array(o.bones); weights.append_array(o.weights)
	for g in o._smooth_groups: _smooth_groups.append(g + group + 1)
	group += o.group + 2
	for i in o.idx: idx.append(i + base)
