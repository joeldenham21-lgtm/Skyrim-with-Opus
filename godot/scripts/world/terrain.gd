extends Node3D
## Terrain (World child "Terrain"). Loads the offline data from assets/terrain/ — it never generates anything at
## runtime — and puts it on screen as a grid of GPU-displaced chunks.
##
##   height.f32   (N+1)^2 float32, 1 m grid, z-major: the single source of truth for geometry and queries
##   normal.png   world-space normal of that heightfield (the shader lights every LOD identically)
##   splat/splat2/roads.png   the eight ground layer weights
##   water.png    R mask / GB flow / A depth   (water.gd draws the surface; terrain uses the mask for get_surface)
##   flora/biome.png          density and biome regions, read by the flora agent through flora_at()/biome_at()
##
## Chunks: 8 x 8 of 160 m. Each is a MeshInstance3D sharing one of four flat grid meshes (1/2/4/8 m cells) that the
## vertex shader displaces from height_tex, so LOD changes cannot move the surface; the border ring of each grid is a
## downward skirt that hides the cracks between neighbouring levels. Godot frustum-culls them by a per-chunk custom
## AABB built from the block min/max in terrain.json. Collision is 4 x 4 HeightMapShape3D at the full 1 m resolution.
## Beyond the map a single 32 m ring mesh (far.f32, out to 2 km) closes the horizon.

const DIR := "res://assets/terrain/"
const CACHE := "res://assets/cache/"
const CACHE_VERSION := "t2"
const CHUNK := 160.0
const LOD_CELLS := [1.0, 2.0, 4.0, 8.0]
const LOD_SKIRT := [1.5, 3.0, 6.0, 14.0]
const LOD_DIST := [80.0, 240.0, 520.0]      # < d[0] -> LOD0, < d[1] -> LOD1, < d[2] -> LOD2, else LOD3
const COLLIDER_BLOCKS := 4
const SURFACE_NAMES := ["grass", "dirt", "mud", "rock", "gravel", "road", "sand", "moss"]

var meta: Dictionary = {}
var n: int = 1280                      # cells
var v: int = 1281                      # samples per side
var half: float = 640.0
var size: float = 1280.0
var water_level: float = -0.6
var heights := PackedFloat32Array()
var height_bytes := PackedByteArray()

var splat_img: Image = null
var splat2_img: Image = null
var roads_img: Image = null
var water_img: Image = null
var flora_img: Image = null
var biome_img: Image = null

var material: ShaderMaterial = null
var lod_meshes: Array[ArrayMesh] = []
var chunks: Array = []                 # {mi: MeshInstance3D, cx, cz, x0, z0, lod, min_y, max_y}
var far_mesh: MeshInstance3D = null
var _cam_pos := Vector3(1e9, 0.0, 1e9)
var _wet := 0.0
var _wet_target := 0.0
var _load_ms := 0

func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	_load_meta()
	_load_height()
	_load_maps()
	var t_data := Time.get_ticks_msec()
	_build_material()
	_build_lod_meshes()
	_build_chunks()
	var t_mesh := Time.get_ticks_msec()
	_build_collision()
	var t_coll := Time.get_ticks_msec()
	_build_far()
	_load_ms = Time.get_ticks_msec() - t0
	print("[terrain] %d chunks of %.0f m, %d colliders, load %d ms (data %d, meshes %d, collision %d, far %d)" % [
		chunks.size(), CHUNK, COLLIDER_BLOCKS * COLLIDER_BLOCKS, _load_ms,
		t_data - t0, t_mesh - t_data, t_coll - t_mesh, Time.get_ticks_msec() - t_coll])
	set_process(true)
	_update_lods(true)

# ---------------------------------------------------------------------------------------------------------------
# data
# ---------------------------------------------------------------------------------------------------------------
func _load_meta() -> void:
	var f := FileAccess.open(DIR + "terrain.json", FileAccess.READ)
	if f == null:
		push_error("[terrain] assets/terrain/terrain.json missing — run tools/gen_terrain.py")
		return
	meta = JSON.parse_string(f.get_as_text())
	if typeof(meta) != TYPE_DICTIONARY: meta = {}
	n = int(meta.get("n", 1280)); v = int(meta.get("samples", n + 1))
	size = float(meta.get("size", n)); half = size * 0.5
	water_level = float(meta.get("sea_level", -0.6))

func _load_height() -> void:
	var f := FileAccess.open(DIR + "height.f32", FileAccess.READ)
	if f == null:
		push_error("[terrain] height.f32 missing — run tools/gen_terrain.py")
		heights = PackedFloat32Array(); heights.resize(v * v)
		return
	height_bytes = f.get_buffer(f.get_length())
	heights = height_bytes.to_float32_array()
	if heights.size() != v * v:
		push_error("[terrain] height.f32 is %d samples, expected %d" % [heights.size(), v * v])

func _img(name: String) -> Image:
	var p := DIR + name
	if not ResourceLoader.exists(p): return null
	var tex: Texture2D = load(p)
	if tex == null: return null
	var im := tex.get_image()
	if im and im.is_compressed(): im.decompress()
	return im

func _load_maps() -> void:
	splat_img = _img("splat.png"); splat2_img = _img("splat2.png"); roads_img = _img("roads.png")
	water_img = _img("water.png"); flora_img = _img("flora.png"); biome_img = _img("biome.png")

# ---------------------------------------------------------------------------------------------------------------
# material
# ---------------------------------------------------------------------------------------------------------------
func _tex(name: String) -> Texture:
	## Texture, not Texture2D: layers_*.png import as CompressedTexture2DArray (TextureLayered).
	var p := DIR + name
	if not ResourceLoader.exists(p):
		push_warning("[terrain] missing " + p)
		return null
	var t: Texture = load(p)
	if t == null: push_warning("[terrain] could not load " + p)
	return t

func _build_material() -> void:
	material = ShaderMaterial.new()
	material.shader = load("res://shaders/terrain.gdshader")
	var img := Image.create_from_data(v, v, false, Image.FORMAT_RF, height_bytes)
	var htex := ImageTexture.create_from_image(img)
	material.set_shader_parameter("height_tex", htex)
	material.set_shader_parameter("normal_tex", _tex("normal.png"))
	material.set_shader_parameter("splat_tex", _tex("splat.png"))
	material.set_shader_parameter("splat2_tex", _tex("splat2.png"))
	material.set_shader_parameter("roads_tex", _tex("roads.png"))
	material.set_shader_parameter("noise_tex", _tex("noise.png"))
	material.set_shader_parameter("layer_alb", _tex("layers_alb.png"))
	material.set_shader_parameter("layer_nml", _tex("layers_nml.png"))
	material.set_shader_parameter("layer_orm", _tex("layers_orm.png"))
	material.set_shader_parameter("map_half", half)
	material.set_shader_parameter("map_texels", float(v))
	# per-layer tile size in metres and a tint that pulls the generated sheets toward the bible's palette
	var tiles := PackedFloat32Array([2.5, 3.0, 3.0, 4.0, 2.0, 4.0, 3.0, 2.0])
	var lj := FileAccess.open(DIR + "layers.json", FileAccess.READ)
	if lj:
		var d: Variant = JSON.parse_string(lj.get_as_text())
		if typeof(d) == TYPE_DICTIONARY:
			var arr: Array = d.get("layers", [])
			for i in mini(arr.size(), 8): tiles[i] = float(arr[i].get("tile_m", tiles[i]))
	material.set_shader_parameter("layer_tile", tiles)
	var tint := PackedColorArray([
		Color(0.99, 0.99, 0.90), Color(1.0, 0.98, 0.94), Color(0.92, 0.94, 0.96), Color(1.08, 1.07, 1.05),
		Color(1.0, 0.99, 0.96), Color(0.95, 0.96, 1.0), Color(1.0, 0.99, 0.95), Color(0.92, 1.0, 0.86)])
	material.set_shader_parameter("layer_tint", tint)
	material.set_shader_parameter("rain", 0.0)
	height_bytes = PackedByteArray()          # the GPU copy is made; drop the 6.5 MB staging buffer

# ---------------------------------------------------------------------------------------------------------------
# meshes
# ---------------------------------------------------------------------------------------------------------------
static func _grid_mesh(sz: float, cell: float, skirt: float) -> ArrayMesh:
	## Flat XZ grid 0..sz with a downward skirt ring; local y carries the skirt offset for the vertex shader.
	var q := int(round(sz / cell))
	var w := q + 1
	var verts := PackedVector3Array(); verts.resize(w * w)
	for j in w:
		var z := float(j) * cell
		for i in w:
			verts[j * w + i] = Vector3(float(i) * cell, 0.0, z)
	var idx := PackedInt32Array(); idx.resize(q * q * 6)
	var k := 0
	for j in q:
		for i in q:
			var a := j * w + i
			var b := a + 1
			var c := a + w
			var d := c + 1
			idx[k] = a; idx[k + 1] = b; idx[k + 2] = c
			idx[k + 3] = b; idx[k + 4] = d; idx[k + 5] = c
			k += 6
	# skirt: the border loop dropped by `skirt`, two-sided so the winding can never hide it
	var base := verts.size()
	var border := PackedInt32Array()
	for i in w: border.append(i)                                   # z = 0 edge, +x
	for j in range(1, w): border.append(j * w + (w - 1))            # x = max edge, +z
	for i in range(w - 2, -1, -1): border.append((w - 1) * w + i)   # z = max edge, -x
	for j in range(w - 2, 0, -1): border.append(j * w)              # x = 0 edge, -z
	border.append(0)
	for bi in border:
		var p := verts[bi]
		verts.append(Vector3(p.x, -skirt, p.z))
	for s in range(border.size() - 1):
		var t0 := border[s]
		var t1 := border[s + 1]
		var b0 := base + s
		var b1 := base + s + 1
		idx.append(t0); idx.append(t1); idx.append(b0)
		idx.append(t1); idx.append(b1); idx.append(b0)
		idx.append(t1); idx.append(t0); idx.append(b0)
		idx.append(b1); idx.append(t1); idx.append(b0)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	m.custom_aabb = AABB(Vector3(0.0, -4096.0, 0.0), Vector3(sz, 8192.0, sz))
	return m

func _build_lod_meshes() -> void:
	lod_meshes.clear()
	for i in LOD_CELLS.size():
		lod_meshes.append(_grid_mesh(CHUNK, float(LOD_CELLS[i]), float(LOD_SKIRT[i])))

func _block_range(x0: float, z0: float, sz: float) -> Vector2:
	## min/max height over a rect, from the 80 m block table in terrain.json (falls back to the map range).
	var blocks: Dictionary = meta.get("blocks", {})
	var bs := float(blocks.get("size", 80))
	var bn := int(blocks.get("n", 16))
	var mn: Array = blocks.get("min", [])
	var mx: Array = blocks.get("max", [])
	if mn.is_empty() or mx.is_empty():
		return Vector2(float(meta.get("min", -10.0)), float(meta.get("max", 60.0)))
	var i0 := int(floor((x0 + half) / bs))
	var j0 := int(floor((z0 + half) / bs))
	var i1 := int(ceil((x0 + sz + half) / bs)) - 1
	var j1 := int(ceil((z0 + sz + half) / bs)) - 1
	var lo := INF
	var hi := -INF
	for j in range(maxi(j0, 0), mini(j1, bn - 1) + 1):
		for i in range(maxi(i0, 0), mini(i1, bn - 1) + 1):
			lo = minf(lo, float(mn[j][i])); hi = maxf(hi, float(mx[j][i]))
	if lo == INF: return Vector2(float(meta.get("min", -10.0)), float(meta.get("max", 60.0)))
	return Vector2(lo, hi)

func _build_chunks() -> void:
	var cn := int(size / CHUNK)
	for cz in cn:
		for cx in cn:
			var x0 := -half + float(cx) * CHUNK
			var z0 := -half + float(cz) * CHUNK
			var mi := MeshInstance3D.new()
			mi.name = "C%d_%d" % [cx, cz]
			mi.position = Vector3(x0, 0.0, z0)
			mi.mesh = lod_meshes[3]
			mi.material_override = material
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			mi.gi_mode = GeometryInstance3D.GI_MODE_STATIC
			var r := _block_range(x0, z0, CHUNK)
			mi.custom_aabb = AABB(Vector3(0.0, r.x - 16.0, 0.0), Vector3(CHUNK, r.y - r.x + 32.0, CHUNK))
			add_child(mi)
			chunks.append({"mi": mi, "x0": x0, "z0": z0, "lod": 3, "min_y": r.x, "max_y": r.y})

# ---------------------------------------------------------------------------------------------------------------
# collision: 4 x 4 HeightMapShape3D at 1 m, physics layer 1 ("world")
# ---------------------------------------------------------------------------------------------------------------
func _build_collision() -> void:
	if heights.size() != v * v: return
	var body := StaticBody3D.new()
	body.name = "Collision"
	body.collision_layer = 1
	body.collision_mask = 0
	add_child(body)
	var b := COLLIDER_BLOCKS
	var step := n / b                      # cells per block (1280 / 4 = 320)
	var w := step + 1
	for bj in b:
		for bi in b:
			var data := PackedFloat32Array()
			data.resize(w * w)
			var i0 := bi * step
			var j0 := bj * step
			for j in w:
				var src := (j0 + j) * v + i0
				for i in w:
					data[j * w + i] = heights[src + i]
			var shape := HeightMapShape3D.new()
			shape.map_width = w
			shape.map_depth = w
			shape.map_data = data
			var cs := CollisionShape3D.new()
			cs.shape = shape
			cs.position = Vector3(-half + float(i0) + float(step) * 0.5, 0.0, -half + float(j0) + float(step) * 0.5)
			body.add_child(cs)

# ---------------------------------------------------------------------------------------------------------------
# far terrain: one 32 m ring out to 2 km so the horizon is land, not sky
# ---------------------------------------------------------------------------------------------------------------
func _build_far() -> void:
	var mesh: ArrayMesh = null
	var cache_path := CACHE + "terrain_far_%s.res" % CACHE_VERSION
	if ResourceLoader.exists(cache_path):
		mesh = load(cache_path)
	if mesh == null:
		mesh = _make_far_mesh()
		if mesh:
			DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CACHE))
			ResourceSaver.save(mesh, cache_path)
	if mesh == null: return
	far_mesh = MeshInstance3D.new()
	far_mesh.name = "Far"
	far_mesh.mesh = mesh
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 1.0
	m.metallic_specular = 0.15
	m.cull_mode = BaseMaterial3D.CULL_BACK
	far_mesh.material_override = m
	far_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	far_mesh.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	add_child(far_mesh)

func _make_far_mesh() -> ArrayMesh:
	var f := FileAccess.open(DIR + "far.f32", FileAccess.READ)
	if f == null: return null
	var far := f.get_buffer(f.get_length()).to_float32_array()
	var fm: Dictionary = meta.get("far", {})
	var fn := int(fm.get("n", 257))
	var fcell := float(fm.get("cell", 16.0))
	var fhalf := float(fm.get("half", 2048.0))
	if far.size() != fn * fn: return null
	var stride := 2                                  # 32 m cells
	var gw := (fn - 1) / stride + 1
	var verts := PackedVector3Array(); verts.resize(gw * gw)
	var cols := PackedColorArray(); cols.resize(gw * gw)
	var nrm := PackedVector3Array(); nrm.resize(gw * gw)
	var cell := fcell * float(stride)
	for j in gw:
		for i in gw:
			var si := i * stride
			var sj := j * stride
			var h := far[sj * fn + si]
			var x := -fhalf + float(si) * fcell
			var z := -fhalf + float(sj) * fcell
			verts[j * gw + i] = Vector3(x, h, z)
			var hx := far[sj * fn + mini(si + stride, fn - 1)] - far[sj * fn + maxi(si - stride, 0)]
			var hz := far[mini(sj + stride, fn - 1) * fn + si] - far[maxi(sj - stride, 0) * fn + si]
			var nv := Vector3(-hx, 2.0 * cell, -hz).normalized()
			nrm[j * gw + i] = nv
			# distance-graded ground colour: olive lowland, grey-green forest belt, pale rock on the high ground
			var t := clampf((h - 4.0) / 46.0, 0.0, 1.0)
			var lowland := Color(0.150, 0.150, 0.088)
			var forest := Color(0.088, 0.107, 0.072)
			var high := Color(0.163, 0.163, 0.152)
			var c := lowland.lerp(forest, smoothstep(0.06, 0.34, t)).lerp(high, smoothstep(0.55, 0.95, t))
			var rocky := clampf((1.0 - nv.y) * 3.2, 0.0, 1.0)
			c = c.lerp(Color(0.19, 0.185, 0.175), rocky * 0.7)
			var jitter := sin(float(si) * 0.7) * cos(float(sj) * 0.53) * 0.5 + sin(float(si + sj) * 0.21) * 0.5
			c = c * (1.0 + jitter * 0.10)
			cols[j * gw + i] = c
	var idx := PackedInt32Array()
	var hole := half - cell * 0.5
	for j in gw - 1:
		for i in gw - 1:
			var x0 := -fhalf + float(i * stride) * fcell
			var z0 := -fhalf + float(j * stride) * fcell
			if absf(x0 + cell * 0.5) < hole and absf(z0 + cell * 0.5) < hole:
				continue                                  # the map itself covers this
			var a := j * gw + i
			idx.append(a); idx.append(a + 1); idx.append(a + gw)
			idx.append(a + 1); idx.append(a + gw + 1); idx.append(a + gw)
	# an outer rampart of hills from the 2 km edge out to 3.8 km, so the horizon is land rising into the haze
	# instead of a razor-straight cut-off
	var ring := PackedInt32Array()
	for i in gw: ring.append(i)
	for j in range(1, gw): ring.append(j * gw + (gw - 1))
	for i in range(gw - 2, -1, -1): ring.append((gw - 1) * gw + i)
	for j in range(gw - 2, -1, -1): ring.append(j * gw)
	var outer := PackedInt32Array()
	var oscale := 3800.0 / fhalf
	for ri in ring:
		var p := verts[ri]
		var nz := sin(p.x * 0.0021 + 1.7) * cos(p.z * 0.0017 - 0.4) * 0.5 + sin((p.x + p.z) * 0.0009) * 0.5
		var rise := 26.0 + 34.0 * (0.5 + 0.5 * nz)
		verts.append(Vector3(p.x * oscale, p.y + rise, p.z * oscale))
		nrm.append(Vector3(0.0, 1.0, 0.0))
		cols.append(Color(0.105, 0.117, 0.122).lerp(Color(0.16, 0.16, 0.15), 0.5 + 0.5 * nz))
		outer.append(verts.size() - 1)
	for s2 in range(ring.size() - 1):
		idx.append(ring[s2]); idx.append(outer[s2]); idx.append(ring[s2 + 1])
		idx.append(ring[s2 + 1]); idx.append(outer[s2]); idx.append(outer[s2 + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = nrm
	arr[Mesh.ARRAY_COLOR] = cols
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

# ---------------------------------------------------------------------------------------------------------------
# per-frame: LOD and weather
# ---------------------------------------------------------------------------------------------------------------
func _camera_pos() -> Vector3:
	var vp := get_viewport()
	if vp:
		var cam := vp.get_camera_3d()
		if cam: return cam.global_position
	if Game.player: return Game.player.global_position
	return _cam_pos

func _process(dt: float) -> void:
	var p := _camera_pos()
	if p.distance_squared_to(_cam_pos) > 64.0:
		_cam_pos = p
		_update_lods(false)
	_update_weather(dt)

func _update_lods(force: bool) -> void:
	var p := _cam_pos
	for c in chunks:
		var dx := maxf(maxf(c.x0 - p.x, 0.0), p.x - (c.x0 + CHUNK))
		var dz := maxf(maxf(c.z0 - p.z, 0.0), p.z - (c.z0 + CHUNK))
		var d := sqrt(dx * dx + dz * dz)
		var lod := 3
		if d < LOD_DIST[0]: lod = 0
		elif d < LOD_DIST[1]: lod = 1
		elif d < LOD_DIST[2]: lod = 2
		if force or lod != c.lod:
			c.lod = lod
			c.mi.mesh = lod_meshes[lod]
			# only the near chunks feed the shadow atlas (the sun's shadow range is ~250 m)
			c.mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if lod <= 1 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _update_weather(dt: float) -> void:
	var w := "overcast"
	if Game.world and Game.world.has_method("weather"): w = Game.world.weather()
	_wet_target = {"clear": 0.0, "overcast": 0.05, "fog": 0.15, "drizzle": 0.5, "rain": 0.9, "storm": 1.0}.get(w, 0.05)
	if absf(_wet - _wet_target) > 0.001:
		_wet = move_toward(_wet, _wet_target, dt * (0.35 if _wet < _wet_target else 0.08))
		material.set_shader_parameter("rain", _wet)

# ---------------------------------------------------------------------------------------------------------------
# queries (Contracts v1)
# ---------------------------------------------------------------------------------------------------------------
func get_height(x: float, z: float) -> float:
	if heights.size() != v * v: return 0.0
	var fx := clampf(x + half, 0.0, float(n) - 0.0001)
	var fz := clampf(z + half, 0.0, float(n) - 0.0001)
	var i := int(fx)
	var j := int(fz)
	var tx := fx - float(i)
	var tz := fz - float(j)
	var o := j * v + i
	var h00 := heights[o]
	var h10 := heights[o + 1]
	var h01 := heights[o + v]
	var h11 := heights[o + v + 1]
	return lerpf(lerpf(h00, h10, tx), lerpf(h01, h11, tx), tz)

func get_normal(x: float, z: float) -> Vector3:
	var e := 1.0
	var hx := get_height(x + e, z) - get_height(x - e, z)
	var hz := get_height(x, z + e) - get_height(x, z - e)
	return Vector3(-hx, 2.0 * e, -hz).normalized()

func slope_at(x: float, z: float) -> float:
	return 1.0 - get_normal(x, z).y

func _pix(img: Image, x: float, z: float) -> Color:
	if img == null: return Color(0, 0, 0, 0)
	var i := clampi(int(round(x + half)), 0, img.get_width() - 1)
	var j := clampi(int(round(z + half)), 0, img.get_height() - 1)
	return img.get_pixel(i, j)

func get_surface(x: float, z: float) -> String:
	var wm := _pix(water_img, x, z)
	if wm.r > 0.5 and get_height(x, z) < water_height_at(x, z) - 0.05: return "water"
	var s1 := _pix(splat_img, x, z)
	var s2 := _pix(splat2_img, x, z)
	var rd := _pix(roads_img, x, z)
	if rd.a > 0.5: return "concrete"
	var w := [s1.r, s1.g * (1.0 - rd.g), s1.g * rd.g, s1.b, s1.a * (1.0 - rd.r), s1.a * rd.r, s2.r, s2.g]
	var best := 0
	for i in range(1, 8):
		if w[i] > w[best]: best = i
	if s2.a > 0.5: return "snow"
	return SURFACE_NAMES[best]

func water_height_at(x: float, z: float) -> float:
	var wt: Node = Game.world.water if Game.world else null
	if wt and wt.has_method("water_height"): return wt.water_height(x, z)
	return water_level

## Extra data for the flora / structures / anomaly agents (all sampled at 1 m, clamped at the edges).
func flora_at(x: float, z: float) -> Color:           # R trees, G bushes, B grass, A clutter
	return _pix(flora_img, x, z)
func biome_at(x: float, z: float) -> Color:           # R pine, G birch, B reeds, A farmland
	return _pix(biome_img, x, z)
func splat_at(x: float, z: float) -> Color:           # R grass, G dirt+mud, B rock, A gravel+road
	return _pix(splat_img, x, z)
func wetness_at(x: float, z: float) -> float:
	return _pix(splat2_img, x, z).b
func water_mask_at(x: float, z: float) -> float:
	return _pix(water_img, x, z).r
func on_road(x: float, z: float, margin: float = 0.0) -> bool:
	var s1 := _pix(splat_img, x, z)
	return s1.a > 0.45 or _pix(roads_img, x, z).a > 0.5 or (margin > 0.0 and s1.a > 0.25)
## Landform records the structures agent needs to sit its meshes on the ground the generator prepared
## (all of these are also in assets/terrain/terrain.json):
##   bridges()  [{id, kind road|rail, x, z, dx, dz, length, deck (deck height), width, broken, water}]
##   pier()     {x, z, dx, dz, length, deck, width}          dam()   {x, z, dx, dz, crest, reservoir, tail, chute_len}
##   quarry()   {x, z, rim, level, bench, bench_w, face}     landing() {x, z}
##   river()    {control: [[x,z]...], dense: [[x, z, surface, channel width] every 10 m]}
##   ditches()  [[[x,z],[x,z]] ...]     ravine() [[x,z]...]     escarpment() {z_top_samples, cliff_w, talus_w}
##   levels()   {poi id: plateau height}   water_levels() {marsh, lake, quarry, reservoir, tail}
func bridges() -> Array: return meta.get("bridges", [])
func pier() -> Dictionary: return meta.get("pier", {})
func dam() -> Dictionary: return meta.get("dam", {})
func quarry() -> Dictionary: return meta.get("quarry", {})
func landing() -> Dictionary: return meta.get("landing", {})
func river() -> Dictionary: return meta.get("river", {})
func ditches() -> Array: return meta.get("ditches", [])
func ravine() -> Array: return meta.get("ravine", [])
func escarpment() -> Dictionary: return meta.get("escarpment", {})
func levels() -> Dictionary: return meta.get("levels", {})
func water_levels() -> Dictionary: return meta.get("water_levels", {})
func height_range() -> Vector2:
	return Vector2(float(meta.get("min", -10.0)), float(meta.get("max", 60.0)))
func info() -> Dictionary:
	var by_lod := [0, 0, 0, 0]
	for c in chunks: by_lod[c.lod] += 1
	return {"chunks": chunks.size(), "chunk_m": CHUNK, "lod_counts": by_lod, "load_ms": _load_ms,
		"version": meta.get("version", "?"), "size": size, "wet": _wet}
