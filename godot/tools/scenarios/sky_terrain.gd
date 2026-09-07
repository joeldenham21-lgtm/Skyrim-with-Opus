extends Node3D
## VERIFICATION ONLY (sky scenarios). When scenes/world/terrain.tscn does not exist yet, this stands in for the Terrain
## child of the World so sky, fog, shadow and aerial-perspective screenshots have real relief under them: a mesh built
## from assets/terrain/height.f32 (4 m grid, vertex colours from splat.png), a far ring from far.f32, a
## HeightMapShape3D collider, and get_height/get_normal/get_surface. Not part of the game; the terrain agent's scene
## replaces it. Build with `SkyTerrain.install()` from a scenario.

var n := 0                 # samples per axis (N + 1)
var half := 640.0
var heights := PackedFloat32Array()
var far_n := 0
var far_cell := 16.0
var far_half := 2048.0
var far_heights := PackedFloat32Array()

static func install() -> Node3D:
	var world: Node = Game.world
	if world == null: return null
	if world.get_node_or_null("Terrain") != null: return world.get_node("Terrain")
	if not FileAccess.file_exists("res://assets/terrain/height.f32"):
		print("[sky_terrain] no assets/terrain/height.f32; keeping the placeholder plane"); return null
	# drop main.gd's placeholder plane and its collider
	for c in world.get_children():
		if (c is MeshInstance3D or c is StaticBody3D) and c.name.begins_with("@"): c.queue_free()
	var t := load("res://tools/scenarios/sky_terrain.gd").new() as Node3D
	t.name = "Terrain"
	world.add_child(t)
	world.move_child(t, 0)
	world.terrain = t
	return t

func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	var bytes := FileAccess.get_file_as_bytes("res://assets/terrain/height.f32")
	heights = bytes.to_float32_array()
	n = int(round(sqrt(float(heights.size()))))
	half = float(n - 1) * 0.5
	if FileAccess.file_exists("res://assets/terrain/far.f32"):
		far_heights = FileAccess.get_file_as_bytes("res://assets/terrain/far.f32").to_float32_array()
		far_n = int(round(sqrt(float(far_heights.size()))))
		var meta := {}
		if FileAccess.file_exists("res://assets/terrain/terrain.json"):
			var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://assets/terrain/terrain.json"))
			if parsed is Dictionary: meta = parsed.get("far", {})
		far_cell = float(meta.get("cell", 16.0)); far_half = float(meta.get("half", 2048.0))
	_build_near(4)
	if far_n > 0: _build_far(2)
	_build_collision()
	print("[sky_terrain] %d samples, far %d, built in %d ms" % [n, far_n, Time.get_ticks_msec() - t0])

func _h(i: int, j: int) -> float:
	i = clampi(i, 0, n - 1); j = clampi(j, 0, n - 1)
	return heights[j * n + i]

func get_height(x: float, z: float) -> float:
	var fx := clampf(x + half, 0.0, float(n - 1) - 0.001); var fz := clampf(z + half, 0.0, float(n - 1) - 0.001)
	var i := int(fx); var j := int(fz); var tx := fx - i; var tz := fz - j
	var a := _h(i, j); var b := _h(i + 1, j); var c := _h(i, j + 1); var d := _h(i + 1, j + 1)
	return lerpf(lerpf(a, b, tx), lerpf(c, d, tx), tz)
func get_normal(x: float, z: float) -> Vector3:
	var e := 1.0
	var dx := get_height(x + e, z) - get_height(x - e, z); var dz := get_height(x, z + e) - get_height(x, z - e)
	return Vector3(-dx, 2.0 * e, -dz).normalized()
func get_surface(x: float, z: float) -> String:
	return "grass" if get_normal(x, z).y > 0.8 else "rock"

func _build_near(step: int) -> void:
	var splat: Image = null
	if FileAccess.file_exists("res://assets/terrain/splat.png"):
		splat = Image.new(); splat.load(ProjectSettings.globalize_path("res://assets/terrain/splat.png"))
		if splat.is_empty(): splat = null
	var m := (n - 1) / step + 1
	var verts := PackedVector3Array(); var norms := PackedVector3Array(); var cols := PackedColorArray(); var idx := PackedInt32Array()
	verts.resize(m * m); norms.resize(m * m); cols.resize(m * m)
	for j in m:
		for i in m:
			var x := -half + i * step; var z := -half + j * step
			var y := _h(i * step, j * step)
			var nrm := get_normal(x, z)
			verts[j * m + i] = Vector3(x, y, z); norms[j * m + i] = nrm
			var c := Color(0.055, 0.056, 0.033)   # linear-space albedo (vertex colours are not sRGB-decoded)
			if splat:
				var s := splat.get_pixel(clampi(i * step, 0, splat.get_width() - 1), clampi(j * step, 0, splat.get_height() - 1))
				c = Color(0.055, 0.058, 0.028) * s.r + Color(0.045, 0.034, 0.022) * s.g + Color(0.062, 0.060, 0.056) * s.b + Color(0.070, 0.068, 0.062) * s.a
				var tot := s.r + s.g + s.b + s.a
				if tot > 0.05: c = c / tot
			# dead-grass warmth on the flats, bare on steep ground
			c = c.lerp(Color(0.052, 0.050, 0.046), 1.0 - clampf((nrm.y - 0.7) / 0.3, 0.0, 1.0))
			# break the flatness so the light has something to read on
			var vj := 0.80 + 0.40 * absf(fmod(sin(float(i) * 12.9898 + float(j) * 78.233) * 43758.5453, 1.0))
			c = Color(c.r * vj, c.g * vj, c.b * vj)
			cols[j * m + i] = c
	for j in m - 1:
		for i in m - 1:
			var a := j * m + i; var b := a + 1; var c := a + m; var d := c + 1
			idx.append_array([a, c, b, b, c, d])
	var arr := []; arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts; arr[Mesh.ARRAY_NORMAL] = norms; arr[Mesh.ARRAY_COLOR] = cols; arr[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new(); mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new(); mi.name = "Near"; mi.mesh = mesh
	var mat := StandardMaterial3D.new(); mat.vertex_color_use_as_albedo = true; mat.roughness = 1.0; mat.metallic = 0.0
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mi)

func _build_far(step: int) -> void:
	var m := (far_n - 1) / step + 1
	var verts := PackedVector3Array(); var cols := PackedColorArray(); var idx := PackedInt32Array()
	verts.resize(m * m); cols.resize(m * m)
	for j in m:
		for i in m:
			var x := -far_half + i * step * far_cell; var z := -far_half + j * step * far_cell
			var y: float = far_heights[clampi(j * step, 0, far_n - 1) * far_n + clampi(i * step, 0, far_n - 1)] - 0.5
			verts[j * m + i] = Vector3(x, y, z)
			cols[j * m + i] = Color(0.050, 0.052, 0.034)
	for j in m - 1:
		for i in m - 1:
			var a := j * m + i; var b := a + 1; var c := a + m; var d := c + 1
			# hole where the near mesh is
			var x := -far_half + (i + 0.5) * step * far_cell; var z := -far_half + (j + 0.5) * step * far_cell
			if absf(x) < half - step * far_cell and absf(z) < half - step * far_cell: continue
			idx.append_array([a, c, b, b, c, d])
	var arr := []; arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts; arr[Mesh.ARRAY_COLOR] = cols; arr[Mesh.ARRAY_INDEX] = idx
	var st := SurfaceTool.new(); st.create_from_arrays(arr); st.generate_normals()
	var mi := MeshInstance3D.new(); mi.name = "Far"; mi.mesh = st.commit()
	var mat := StandardMaterial3D.new(); mat.vertex_color_use_as_albedo = true; mat.roughness = 1.0
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

func _build_collision() -> void:
	var body := StaticBody3D.new(); body.name = "Collision"; body.collision_layer = 1; body.collision_mask = 0
	var shape := HeightMapShape3D.new()
	shape.map_width = n; shape.map_depth = n
	shape.map_data = heights
	var cs := CollisionShape3D.new(); cs.shape = shape
	body.add_child(cs)
	add_child(body)
