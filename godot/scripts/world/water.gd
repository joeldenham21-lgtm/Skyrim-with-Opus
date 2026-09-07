extends Node3D
## Water (World child "Water"). Builds the river, marsh, lake, quarry and reservoir surfaces from the offline data —
## assets/terrain/water.f32 (per-sample surface height, NaN where there is no water) and water.png (mask, flow,
## depth) — as 2 m meshes split into 96 m chunks so Godot can frustum-cull them, all sharing shaders/water.gdshader.
## Vertex colours carry the character of each body (tannin, flow, clarity) so one shader covers peat marsh, running
## river and the clear flooded quarry. Also owns the underwater screen tint (a CanvasLayer built in code).
## API: in_water(x, z), water_height(x, z), plus depth_at / flow_at / body_at for the other world agents.

const DIR := "res://assets/terrain/"
const CACHE := "res://assets/cache/"
const CACHE_VERSION := "w1"
const CHUNK := 96.0          # metres per water chunk
const STEP := 2              # metres per quad

var v: int = 1281
var half: float = 640.0
var water_level: float = -0.6
var surf := PackedFloat32Array()      # (v*v) surface height, NaN where dry
var mask_img: Image = null            # water.png
var meta: Dictionary = {}
var material: ShaderMaterial = null
var chunks: Array[MeshInstance3D] = []
var _tris := 0
var _under: CanvasLayer = null
var _under_rect: ColorRect = null
var _wet := 0.0
var _submerged := false

func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	_load()
	if surf.size() != v * v:
		push_warning("[water] no assets/terrain/water.f32 — run tools/gen_terrain.py"); return
	_build_material()
	_build_chunks()
	_build_underwater()
	print("[water] %d chunks, %d triangles, build %d ms" % [chunks.size(), _tris, Time.get_ticks_msec() - t0])
	set_process(true)

func _load() -> void:
	var mj := FileAccess.open(DIR + "terrain.json", FileAccess.READ)
	if mj:
		var d: Variant = JSON.parse_string(mj.get_as_text())
		if d is Dictionary: meta = d
	v = int(meta.get("samples", 1281))
	half = float(meta.get("size", v - 1)) * 0.5
	water_level = float(meta.get("sea_level", -0.6))
	var f := FileAccess.open(DIR + "water.f32", FileAccess.READ)
	if f: surf = f.get_buffer(f.get_length()).to_float32_array()
	# reuse the terrain's decoded copy of water.png when it is there (saves 6.5 MB and a decode)
	var terr: Node = Game.world.terrain if Game.world else null
	if terr and "water_img" in terr and terr.water_img != null:
		mask_img = terr.water_img
	elif ResourceLoader.exists(DIR + "water.png"):
		var tex: Texture2D = load(DIR + "water.png")
		mask_img = tex.get_image()
		if mask_img and mask_img.is_compressed(): mask_img.decompress()

func _build_material() -> void:
	material = ShaderMaterial.new()
	material.shader = load("res://shaders/water.gdshader")
	material.render_priority = 1
	for pair in [["flow_tex", "water.png"], ["normal_tex", "water_normal.png"], ["ripple_tex", "water_ripple.png"], ["noise_tex", "noise.png"]]:
		if ResourceLoader.exists(DIR + pair[1]): material.set_shader_parameter(pair[0], load(DIR + pair[1]))
	material.set_shader_parameter("map_half", half)
	material.set_shader_parameter("map_texels", float(v))
	material.set_shader_parameter("rain", 0.0)
	material.set_shader_parameter("wind", 0.5)

# ---------------------------------------------------------------------------------------------------------------
# body classification: tannin (peat), flow strength, clarity — read by the shader from COLOR
# ---------------------------------------------------------------------------------------------------------------
func _poi(id: String) -> Dictionary:
	for p in Data.map.get("POIS", []):
		if p.get("id", "") == id: return p
	return {}

var _bodies: Array = []
func _prepare_bodies() -> void:
	_bodies.clear()
	for spec in [["quarry", Color(0.0, 0.0, 1.0), 1.15], ["lake", Color(0.12, 0.0, 0.62), 1.2], ["marsh", Color(1.0, 0.0, 0.04), 1.15], ["vents", Color(1.0, 0.0, 0.02), 1.1], ["dam", Color(0.22, 0.0, 0.5), 1.4]]:
		var p := _poi(spec[0])
		if p.is_empty(): continue
		_bodies.append({"x": float(p.x), "z": float(p.z), "r": float(p.r) * float(spec[2]), "c": spec[1]})

func _body_color(x: float, z: float, s: float) -> Color:
	# default: running river water — mid tannin, some clarity
	var c := Color(0.45, 0.0, 0.35)
	var best := INF
	for b in _bodies:
		var d: float = Vector2(x - b.x, z - b.z).length()
		if d < b.r and d < best:
			best = d
			c = b.c
	if s > 24.0: c = Color(0.2, 0.0, 0.55)          # the reservoir behind the dam
	var fl := 0.0
	if mask_img:
		var px := _pix(x, z)
		fl = clampf(Vector2((px.g - 0.5) * 4.0, (px.b - 0.5) * 4.0).length() * 0.6, 0.0, 1.0)
	return Color(c.r, fl, c.b, 1.0)

func _pix(x: float, z: float) -> Color:
	if mask_img == null: return Color(0, 0, 0, 0)
	var i := clampi(int(round(x + half)), 0, mask_img.get_width() - 1)
	var j := clampi(int(round(z + half)), 0, mask_img.get_height() - 1)
	return mask_img.get_pixel(i, j)

# ---------------------------------------------------------------------------------------------------------------
# meshes
# ---------------------------------------------------------------------------------------------------------------
func _s(i: int, j: int) -> float:
	if i < 0 or j < 0 or i >= v or j >= v: return NAN
	return surf[j * v + i]

func _build_chunks() -> void:
	_prepare_bodies()
	var lib: MeshLibrary = null
	var cache_path := CACHE + "terrain_water_%s.res" % CACHE_VERSION
	if ResourceLoader.exists(cache_path): lib = load(cache_path)
	if lib == null:
		lib = _make_library()
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CACHE))
		ResourceSaver.save(lib, cache_path)
	for id in lib.get_item_list():
		var m := lib.get_item_mesh(id)
		if m == null: continue
		var mi := MeshInstance3D.new()
		mi.name = lib.get_item_name(id)
		mi.mesh = m
		mi.material_override = material
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		mi.extra_cull_margin = 1.0
		add_child(mi)
		chunks.append(mi)
		_tris += int(m.get_faces().size() / 3)

func _make_library() -> MeshLibrary:
	var lib := MeshLibrary.new()
	var cn := int(ceil((half * 2.0) / CHUNK))
	var id := 0
	for cj in cn:
		for ci in cn:
			var m := _chunk_mesh(ci, cj)
			if m == null: continue
			lib.create_item(id)
			lib.set_item_mesh(id, m)
			lib.set_item_name(id, "W%d_%d" % [ci, cj])
			id += 1
	return lib

func _chunk_mesh(ci: int, cj: int) -> ArrayMesh:
	var i0 := int(ci * CHUNK)
	var j0 := int(cj * CHUNK)
	var i1 := mini(i0 + int(CHUNK), v - 1)
	var j1 := mini(j0 + int(CHUNK), v - 1)
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var lookup := {}
	for j in range(j0, j1, STEP):
		for i in range(i0, i1, STEP):
			var h00 := _s(i, j)
			var h10 := _s(i + STEP, j)
			var h01 := _s(i, j + STEP)
			var h11 := _s(i + STEP, j + STEP)
			var cnt := 0
			var sum := 0.0
			for hv in [h00, h10, h01, h11]:
				if not is_nan(hv): cnt += 1; sum += hv
			if cnt == 0: continue
			var avg := sum / float(cnt)
			var corner := [Vector2i(i, j), Vector2i(i + STEP, j), Vector2i(i, j + STEP), Vector2i(i + STEP, j + STEP)]
			var hs := [h00, h10, h01, h11]
			var ids := [0, 0, 0, 0]
			for k in 4:
				var key: Vector2i = corner[k]
				if lookup.has(key):
					ids[k] = lookup[key]
					continue
				var hv2: float = hs[k]
				if is_nan(hv2): hv2 = avg
				var x := float(key.x) - half
				var z := float(key.y) - half
				verts.append(Vector3(x, hv2, z))
				cols.append(_body_color(x, z, hv2))
				ids[k] = verts.size() - 1
				lookup[key] = ids[k]
			idx.append(ids[0]); idx.append(ids[1]); idx.append(ids[2])
			idx.append(ids[1]); idx.append(ids[3]); idx.append(ids[2])
	if verts.is_empty(): return null
	var nrm := PackedVector3Array(); nrm.resize(verts.size())
	nrm.fill(Vector3.UP)
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
# underwater tint (a CanvasLayer the water owns, so the Sky agent's Environment is left alone)
# ---------------------------------------------------------------------------------------------------------------
const UNDER_SHADER := """
shader_type canvas_item;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
uniform vec3 tint : source_color = vec3(0.085, 0.135, 0.125);
uniform float depth_amt : hint_range(0.0, 1.0) = 0.5;
void fragment() {
	vec2 uv = SCREEN_UV;
	float t = TIME;
	uv += vec2(sin(uv.y * 26.0 + t * 1.7), cos(uv.x * 22.0 - t * 1.3)) * 0.0025 * (0.4 + depth_amt);
	vec3 c = textureLod(screen_tex, clamp(uv, vec2(0.001), vec2(0.999)), 0.4 + depth_amt * 1.1).rgb;
	float vig = smoothstep(1.05, 0.25, length(SCREEN_UV - vec2(0.5)) * 1.6);
	c = mix(c, tint, clamp(0.34 + depth_amt * 0.30, 0.0, 0.72));
	c *= mix(0.72, 1.0, vig);
	COLOR = vec4(c, 1.0);
}
"""

func _build_underwater() -> void:
	_under = CanvasLayer.new()
	_under.name = "Underwater"
	_under.layer = 2
	add_child(_under)
	_under_rect = ColorRect.new()
	_under_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_under_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = UNDER_SHADER
	var sm := ShaderMaterial.new()
	sm.shader = sh
	_under_rect.material = sm
	_under_rect.visible = false
	_under.add_child(_under_rect)

func _process(dt: float) -> void:
	if material == null: return
	var w := "overcast"
	if Game.world and Game.world.has_method("weather"): w = Game.world.weather()
	var target: float = {"clear": 0.0, "overcast": 0.06, "fog": 0.1, "drizzle": 0.45, "rain": 0.9, "storm": 1.0}.get(w, 0.06)
	if absf(_wet - target) > 0.002:
		_wet = move_toward(_wet, target, dt * 0.4)
		material.set_shader_parameter("rain", _wet)
		material.set_shader_parameter("wind", 0.35 + _wet * 1.1)
	# underwater tint follows the camera
	var vp := get_viewport()
	if vp == null or _under_rect == null: return
	var cam := vp.get_camera_3d()
	if cam == null: return
	var p := cam.global_position
	var sub := false
	var d := 0.0
	if in_water(p.x, p.z):
		var s := water_height(p.x, p.z)
		sub = p.y < s - 0.02
		d = clampf((s - p.y) / 5.0, 0.0, 1.0)
	if sub != _submerged:
		_submerged = sub
		_under_rect.visible = sub
	if sub: _under_rect.material.set_shader_parameter("depth_amt", minf(d, 0.7))

# ---------------------------------------------------------------------------------------------------------------
# queries (Contracts v1)
# ---------------------------------------------------------------------------------------------------------------
func water_height(x: float, z: float) -> float:
	if surf.size() != v * v: return water_level
	var fx := clampf(x + half, 0.0, float(v - 2))
	var fz := clampf(z + half, 0.0, float(v - 2))
	var i := int(fx)
	var j := int(fz)
	var tx := fx - float(i)
	var tz := fz - float(j)
	var a := _s(i, j)
	var b := _s(i + 1, j)
	var c := _s(i, j + 1)
	var d := _s(i + 1, j + 1)
	var sum := 0.0
	var wsum := 0.0
	for pair in [[a, (1.0 - tx) * (1.0 - tz)], [b, tx * (1.0 - tz)], [c, (1.0 - tx) * tz], [d, tx * tz]]:
		var hv: float = pair[0]
		if is_nan(hv): continue
		sum += hv * float(pair[1]); wsum += float(pair[1])
	if wsum < 0.001:
		for hv in [a, b, c, d]:
			if not is_nan(hv): return hv
		return water_level
	return sum / wsum

func in_water(x: float, z: float) -> bool:
	if surf.size() != v * v: return false
	var i := clampi(int(round(x + half)), 0, v - 1)
	var j := clampi(int(round(z + half)), 0, v - 1)
	if is_nan(surf[j * v + i]): return false
	var g := -1e9
	if Game.world and Game.world.terrain: g = Game.world.terrain.get_height(x, z)
	return g < water_height(x, z) - 0.02

func depth_at(x: float, z: float) -> float:
	if mask_img == null: return 0.0
	return _pix(x, z).a * 16.0

func flow_at(x: float, z: float) -> Vector2:
	if mask_img == null: return Vector2.ZERO
	var p := _pix(x, z)
	return Vector2((p.g - 0.5) * 4.0, (p.b - 0.5) * 4.0)

func submerged() -> bool: return _submerged

func info() -> Dictionary:
	return {"chunks": chunks.size(), "tris": _tris, "chunk_m": CHUNK, "step_m": STEP, "submerged": _submerged}
