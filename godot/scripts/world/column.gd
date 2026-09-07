extends Node3D
## The far landmarks of the north, owned and updated by the Sky: the Column (a pillar of pale light kilometres tall at
## Data.map.COLUMN with a sphere of distortion hanging on it, refracting the scene behind it), the Pechorsk Anomaly
## (an inverted mountain over the north-west horizon with debris orbiting it) and the Column's rising motes. All are
## far meshes: depth-tested so the ridges occlude them, never fogged by the engine (they carry their own aerial
## perspective from the horizon colour), and cheap (5 draw calls, no shadows).

const HEIGHT := 2200.0
const SPHERE_Y := 640.0
const MOUNTAIN_OFFSET := Vector3(-380.0, 560.0, -520.0)   # relative to the column base
const MOUNTAIN_SCALE := 0.55
const DEBRIS := 80
var base := Vector3(40.0, 0.0, -1100.0)
var column: MeshInstance3D
var sphere: MeshInstance3D
var mountain: MeshInstance3D
var debris: MultiMeshInstance3D
var motes: GPUParticles3D
var glow: MeshInstance3D
var _glow_mat: StandardMaterial3D
var _col_mat: ShaderMaterial
var _sph_mat: ShaderMaterial
var _mtn_mat: ShaderMaterial
var _deb_mat: ShaderMaterial
var _mote_mat: StandardMaterial3D

const MOUNTAIN_SHADER := """
shader_type spatial;
render_mode unshaded, cull_back, fog_disabled, shadows_disabled;
uniform vec3 horizon : source_color = vec3(0.6, 0.62, 0.65);
uniform float fade = 0.55;
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform float night = 0.0;
uniform float t = 0.0;
uniform float tide = 0.0;
uniform float lightning = 0.0;
varying vec3 v_local;
varying vec3 v_n;
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() { v_local = VERTEX; v_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz); }
void fragment() {
	vec3 base = vec3(0.10, 0.105, 0.115);
	float light = max(dot(v_n, sun_dir), 0.0) * 0.35 + 0.25 * max(v_n.y, 0.0);
	vec3 col = base * (0.5 + light) * (1.0 - night * 0.75);
	float ang = atan(v_local.z, v_local.x);
	float strata = smoothstep(0.35, 0.65, vnoise(vec2(v_local.y * 0.02, ang * 6.0)));
	col *= 0.85 + 0.3 * strata;
	float pin = smoothstep(0.985, 1.0, hash21(floor(vec2(ang * 40.0, v_local.y * 0.08))));
	col += vec3(0.35, 0.6, 0.9) * pin * (0.5 + 0.5 * sin(t * 2.0 + v_local.y)) * (1.0 - fade) * 0.8;
	col = mix(col, horizon * 0.82 + vec3(0.6, 0.65, 0.8) * lightning * 0.35, fade);
	col = mix(col, vec3(1.0), tide);
	ALBEDO = col;
}
"""

const DEBRIS_SHADER := """
shader_type spatial;
render_mode unshaded, cull_back, fog_disabled, shadows_disabled, world_vertex_coords;
uniform vec3 center = vec3(0.0);
uniform vec3 horizon : source_color = vec3(0.6, 0.62, 0.65);
uniform float fade = 0.55;
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform float night = 0.0;
uniform float t = 0.0;
uniform float tide = 0.0;
varying vec3 v_n;
void vertex() {
	vec4 c = INSTANCE_CUSTOM;   // x orbit radius, y height offset, z phase, w signed angular speed
	float ang = c.z + t * c.w;
	vec3 orbit = center + vec3(cos(ang) * c.x, c.y + sin(ang * 2.0 + c.z) * 18.0, sin(ang) * c.x);
	float ra = t * c.w * 6.0 + c.z * 3.0;
	mat3 rot = mat3(vec3(cos(ra), 0.0, sin(ra)), vec3(0.0, 1.0, 0.0), vec3(-sin(ra), 0.0, cos(ra)));
	VERTEX = orbit + rot * VERTEX;
	v_n = rot * NORMAL;
	NORMAL = v_n;
}
void fragment() {
	vec3 base = vec3(0.10, 0.105, 0.115);
	float light = max(dot(normalize(v_n), sun_dir), 0.0) * 0.35 + 0.25 * max(v_n.y, 0.0);
	vec3 col = base * (0.5 + light) * (1.0 - night * 0.75);
	col = mix(col, horizon * 0.82, fade);
	col = mix(col, vec3(1.0), tide);
	ALBEDO = col;
}
"""

func setup(column_xz: Vector2, ground_y: float) -> void:
	base = Vector3(column_xz.x, ground_y, column_xz.y)
	var shader: Shader = load("res://shaders/column.gdshader")
	# the Column
	var cyl := CylinderMesh.new()
	cyl.top_radius = 16.0; cyl.bottom_radius = 44.0; cyl.height = HEIGHT; cyl.radial_segments = 36; cyl.rings = 12; cyl.cap_top = false; cyl.cap_bottom = false
	column = MeshInstance3D.new(); column.name = "Column"; column.mesh = cyl
	_col_mat = ShaderMaterial.new(); _col_mat.shader = shader
	_col_mat.set_shader_parameter("mode", 0); _col_mat.set_shader_parameter("height", HEIGHT)
	column.material_override = _col_mat
	column.position = base + Vector3(0.0, HEIGHT * 0.5 - 80.0, 0.0)
	column.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	column.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	column.extra_cull_margin = 400.0
	add_child(column)
	# the sphere of distortion
	var sph := SphereMesh.new(); sph.radius = 120.0; sph.height = 240.0; sph.radial_segments = 40; sph.rings = 20
	sphere = MeshInstance3D.new(); sphere.name = "Anomaly"; sphere.mesh = sph
	_sph_mat = ShaderMaterial.new(); _sph_mat.shader = shader
	_sph_mat.set_shader_parameter("mode", 1); _sph_mat.set_shader_parameter("height", 240.0)
	sphere.material_override = _sph_mat
	sphere.position = base + Vector3(0.0, SPHERE_Y, 0.0)
	sphere.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sphere.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	sphere.extra_cull_margin = 200.0
	add_child(sphere)
	# the inverted mountain
	mountain = MeshInstance3D.new(); mountain.name = "Mountain"; mountain.mesh = _build_mountain()
	_mtn_mat = ShaderMaterial.new(); var msh := Shader.new(); msh.code = MOUNTAIN_SHADER; _mtn_mat.shader = msh
	mountain.material_override = _mtn_mat
	mountain.position = base + MOUNTAIN_OFFSET
	mountain.scale = Vector3.ONE * MOUNTAIN_SCALE
	mountain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mountain.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	mountain.extra_cull_margin = 600.0
	add_child(mountain)
	# orbiting debris
	debris = MultiMeshInstance3D.new(); debris.name = "Debris"
	var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.use_custom_data = true; mm.instance_count = DEBRIS
	mm.mesh = _build_rock()
	var rnd := RandomNumberGenerator.new(); rnd.seed = 4242
	for i in DEBRIS:
		var sc := 2.5 + pow(rnd.randf(), 2.0) * 12.0
		mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(sc, sc * (0.5 + rnd.randf()), sc)), Vector3.ZERO))
		var r := 170.0 + rnd.randf() * 300.0
		var y := -60.0 + rnd.randf() * 220.0
		var speed := (0.004 + rnd.randf() * 0.01) * (1.0 if rnd.randf() < 0.5 else -1.0)
		mm.set_instance_custom_data(i, Color(r, y, rnd.randf() * TAU, speed))
	debris.multimesh = mm
	_deb_mat = ShaderMaterial.new(); var dsh := Shader.new(); dsh.code = DEBRIS_SHADER; _deb_mat.shader = dsh
	_deb_mat.set_shader_parameter("center", mountain.position)
	debris.material_override = _deb_mat
	debris.custom_aabb = AABB(mountain.position - Vector3(600.0, 300.0, 600.0), Vector3(1200.0, 700.0, 1200.0))
	debris.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	debris.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	add_child(debris)
	# the glow of the Column in the haze at its foot: a large soft additive billboard
	glow = MeshInstance3D.new(); glow.name = "Glow"
	var gq := QuadMesh.new(); gq.size = Vector2(420.0, 300.0)
	_glow_mat = StandardMaterial3D.new()
	_glow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; _glow_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_glow_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD; _glow_mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	_glow_mat.disable_fog = true; _glow_mat.no_depth_test = false
	var gg := Gradient.new(); gg.set_color(0, Color(1, 1, 1, 1)); gg.set_color(1, Color(1, 1, 1, 0)); gg.add_point(0.35, Color(1, 1, 1, 0.35))
	var ggt := GradientTexture2D.new(); ggt.gradient = gg; ggt.fill = GradientTexture2D.FILL_RADIAL; ggt.fill_from = Vector2(0.5, 0.5); ggt.fill_to = Vector2(0.5, 0.0); ggt.width = 128; ggt.height = 128
	_glow_mat.albedo_texture = ggt; _glow_mat.albedo_color = Color(0.8, 0.86, 1.0, 0.3)
	gq.material = _glow_mat; glow.mesh = gq
	glow.position = base + Vector3(0.0, 60.0, 0.0)
	glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; glow.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	glow.extra_cull_margin = 300.0
	add_child(glow)
	# rising motes
	motes = GPUParticles3D.new(); motes.name = "Motes"
	motes.amount = 360; motes.lifetime = 60.0; motes.preprocess = 60.0; motes.local_coords = false; motes.fixed_fps = 20; motes.interpolate = true
	motes.visibility_aabb = AABB(Vector3(-120.0, -300.0, -120.0), Vector3(240.0, 1200.0, 240.0))
	motes.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	motes.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	pm.emission_ring_axis = Vector3.UP; pm.emission_ring_radius = 30.0; pm.emission_ring_inner_radius = 2.0; pm.emission_ring_height = 520.0
	pm.direction = Vector3.UP; pm.spread = 6.0; pm.initial_velocity_min = 6.0; pm.initial_velocity_max = 14.0; pm.gravity = Vector3.ZERO
	pm.scale_min = 0.6; pm.scale_max = 1.6
	pm.turbulence_enabled = true; pm.turbulence_noise_strength = 1.2; pm.turbulence_noise_scale = 6.0; pm.turbulence_influence_min = 0.05; pm.turbulence_influence_max = 0.12
	var ramp := Gradient.new(); ramp.set_color(0, Color(1, 1, 1, 0)); ramp.set_color(1, Color(1, 1, 1, 0)); ramp.add_point(0.15, Color(1, 1, 1, 1)); ramp.add_point(0.7, Color(1, 1, 1, 0.8))
	var ramp_tex := GradientTexture1D.new(); ramp_tex.gradient = ramp; pm.color_ramp = ramp_tex
	motes.process_material = pm
	var q := QuadMesh.new(); q.size = Vector2(4.0, 4.0)
	_mote_mat = StandardMaterial3D.new()
	_mote_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; _mote_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mote_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD; _mote_mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	_mote_mat.vertex_color_use_as_albedo = true; _mote_mat.disable_fog = true; _mote_mat.no_depth_test = false
	var g := Gradient.new(); g.set_color(0, Color(1, 1, 1, 1)); g.set_color(1, Color(1, 1, 1, 0))
	var gt := GradientTexture2D.new(); gt.gradient = g; gt.fill = GradientTexture2D.FILL_RADIAL; gt.fill_from = Vector2(0.5, 0.5); gt.fill_to = Vector2(0.5, 0.0); gt.width = 64; gt.height = 64
	_mote_mat.albedo_texture = gt
	_mote_mat.albedo_color = Color(0.82, 0.88, 1.0, 0.35)
	q.material = _mote_mat
	motes.draw_pass_1 = q
	motes.position = base + Vector3(0.0, 270.0, 0.0)
	add_child(motes)

## Once the terrain exists: put the base of the Column at the ground level of the map edge nearest to it.
func setup_ground(ground_y: float) -> void:
	base.y = ground_y
	column.position = base + Vector3(0.0, HEIGHT * 0.5 - 80.0, 0.0)
	sphere.position = base + Vector3(0.0, SPHERE_Y, 0.0)
	mountain.position = base + MOUNTAIN_OFFSET
	_deb_mat.set_shader_parameter("center", mountain.position)
	debris.custom_aabb = AABB(mountain.position - Vector3(600.0, 300.0, 600.0), Vector3(1200.0, 700.0, 1200.0))
	motes.position = base + Vector3(0.0, 270.0, 0.0)
	glow.position = base + Vector3(0.0, 60.0, 0.0)

func _build_mountain() -> ArrayMesh:
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rnd := RandomNumberGenerator.new(); rnd.seed = 1211
	var segs := 40; var rings := 12
	var pts: Array = []
	for j in rings + 1:
		var f := float(j) / rings
		var ring: Array = []
		for i in segs:
			var ang := TAU * i / segs
			var n := 1.0 + 0.22 * sin(ang * 5.0 + f * 3.0) + 0.14 * sin(ang * 13.0 + 1.7) + 0.12 * sin(f * 7.0 + ang * 3.0)
			var r := 420.0 * (1.0 - f) * n
			if j == rings: r = 0.0
			var y := -520.0 * pow(f, 0.85) + sin(ang * 7.0) * 12.0 * (1.0 - f) + (rnd.randf() - 0.5) * 18.0 * (1.0 - f)
			ring.append(Vector3(cos(ang) * r, y, sin(ang) * r))
		pts.append(ring)
	for j in rings:
		for i in segs:
			var a: Vector3 = pts[j][i]; var b: Vector3 = pts[j][(i + 1) % segs]
			var c: Vector3 = pts[j + 1][i]; var d: Vector3 = pts[j + 1][(i + 1) % segs]
			st.add_vertex(a); st.add_vertex(c); st.add_vertex(b)
			st.add_vertex(b); st.add_vertex(c); st.add_vertex(d)
	# the top: a rough mesa slightly above the rim, seen edge-on from the ground
	var top := Vector3(0.0, 45.0, 0.0)
	for i in segs:
		var a: Vector3 = pts[0][i]; var b: Vector3 = pts[0][(i + 1) % segs]
		var ma := a * 0.6 + Vector3(0.0, 30.0 + (rnd.randf() - 0.5) * 20.0, 0.0)
		var mb := b * 0.6 + Vector3(0.0, 30.0 + (rnd.randf() - 0.5) * 20.0, 0.0)
		st.add_vertex(a); st.add_vertex(b); st.add_vertex(ma)
		st.add_vertex(b); st.add_vertex(mb); st.add_vertex(ma)
		st.add_vertex(ma); st.add_vertex(mb); st.add_vertex(top)
	st.generate_normals()
	return st.commit()

func _build_rock() -> ArrayMesh:
	var sm := SphereMesh.new(); sm.radius = 1.0; sm.height = 2.0; sm.radial_segments = 7; sm.rings = 4
	var arrays := sm.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var rnd := RandomNumberGenerator.new(); rnd.seed = 77
	var jitter := {}
	for i in verts.size():
		var key := Vector3i(roundi(verts[i].x * 50.0), roundi(verts[i].y * 50.0), roundi(verts[i].z * 50.0))
		if not jitter.has(key): jitter[key] = 0.55 + rnd.randf() * 0.8
		verts[i] = verts[i] * jitter[key]
	arrays[Mesh.ARRAY_VERTEX] = verts
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	for k in idx.size():
		st.add_vertex(verts[idx[k]])
	st.generate_normals()
	return st.commit()

## Called by the Sky every frame.
func update(night: float, horizon: Color, sun_dir: Vector3, tide: float, lightning: float, t: float, sun_energy: float, exposure: float, fog: float = 0.0) -> void:
	# emission scale: faint by day against a bright sky, glowing at night; keep it steady through the exposure keys
	var energy := (0.30 + 0.35 * sun_energy) * (1.0 - night) + 0.16 * night
	energy /= maxf(exposure, 0.3)
	for m in [_col_mat, _sph_mat]:
		m.set_shader_parameter("night", night); m.set_shader_parameter("tide", tide); m.set_shader_parameter("lightning", lightning)
		m.set_shader_parameter("t", t); m.set_shader_parameter("energy", energy)
	for m in [_mtn_mat, _deb_mat]:
		m.set_shader_parameter("horizon", horizon); m.set_shader_parameter("sun_dir", sun_dir); m.set_shader_parameter("night", night)
		m.set_shader_parameter("fade", clampf(0.62 + fog * 0.38, 0.0, 1.0))
		m.set_shader_parameter("t", t); m.set_shader_parameter("tide", tide)
	_mtn_mat.set_shader_parameter("lightning", lightning)
	_mote_mat.albedo_color = Color(0.82, 0.88, 1.0, (0.10 + 0.2 * night) / maxf(exposure, 0.3))
	_glow_mat.albedo_color = Color(0.8, 0.86, 1.0, (0.10 + 0.22 * night) * (0.7 + 0.5 * sun_energy) / maxf(exposure, 0.3) * (1.0 - fog))
