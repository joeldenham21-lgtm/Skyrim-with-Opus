extends Node3D
## The far landmarks of the north, built and driven by the Sky (scripts/world/sky.gd):
##
##  * the **Column** at Data.map.COLUMN — a pillar of pale light nearly two kilometres tall standing where the Radius
##    is thickest, with a lens of distortion hanging on it and motes rising out of the haze at its foot;
##  * the **Pechorsk Anomaly** — an inverted mountain the size of a city over the northern horizon, a craggy mass of
##    rock hanging point-down under the sheared-off plate of ground it took with it, with slabs and boulders in slow
##    orbit around it;
##  * a few **black geometric anomalies** far off in the sky, turning slowly.
##
## Everything here is depth-tested but writes no depth, casts no shadow, takes no engine fog and carries its own
## aerial perspective (distance to the camera against a density the Sky sets from the weather), so the ridges occlude
## it correctly, it sits in the haze like the rest of the distance, and the fog swallows it when the fog rolls in.
## Cost: 6 draw calls, ~11 k triangles.

const HEIGHT := 1900.0                                    # the Column
const LENS_Y := 620.0
const LENS_R := 130.0
const MOUNTAIN_OFFSET := Vector3(-520.0, 640.0, -420.0)   # relative to the Column's foot
const MTN_R := 560.0
const MTN_DEPTH := 900.0
const MESH_VERSION := "landmark-v2"
const DEBRIS := 96
const SHARDS := 7

var base := Vector3(40.0, 0.0, -1100.0)
var column: MeshInstance3D
var lens: MeshInstance3D
var mountain: MeshInstance3D
var debris: MultiMeshInstance3D
var shards: MultiMeshInstance3D
var motes: GPUParticles3D
var glow: MeshInstance3D
var _glow_mat: StandardMaterial3D
var _col_mat: ShaderMaterial
var _lens_mat: ShaderMaterial
var _mtn_mat: ShaderMaterial
var _deb_mat: ShaderMaterial
var _shard_mat: ShaderMaterial
var _mote_mat: StandardMaterial3D

## Rock of the Radius: manual lighting (sun lambert + sky dome ambient + a cold rim), strata and gully shading from
## the local position, a few seams that hold light at night, and aerial perspective by true distance to the camera.
const ROCK_SHADER := """
shader_type spatial;
render_mode unshaded, cull_back, fog_disabled, shadows_disabled, specular_disabled;
uniform vec3 horizon : source_color = vec3(0.6, 0.62, 0.65);
uniform vec3 sun_col : source_color = vec3(1.0, 0.95, 0.9);
uniform float sun_energy = 1.0;
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform float ap_density = 0.0004;    // aerial perspective per metre
uniform float ap_max = 0.94;
uniform float night = 0.0;
uniform float t = 0.0;
uniform float tide = 0.0;
uniform float lightning = 0.0;
uniform float seam = 1.0;             // strength of the glowing seams
varying vec3 v_local;
varying vec3 v_world;
varying vec3 v_n;
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.11 + vec2(11.3, 7.9); a *= 0.5; } return s; }
void vertex() {
	v_local = VERTEX;
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}
void fragment() {
	vec3 n = normalize(v_n);
	float ang = atan(v_local.z, v_local.x);
	// rock: dark, cool, with strata bands across the mass and vertical erosion streaks down the gullies
	float strata = fbm(vec2(v_local.y * 0.020, ang * 2.2));
	float streak = fbm(vec2(ang * 26.0, v_local.y * 0.006 + 4.0));
	vec3 rock = vec3(0.052, 0.055, 0.062) * (0.75 + 0.55 * strata) * (0.85 + 0.30 * streak);
	rock *= 0.80 + 0.40 * smoothstep(-0.2, 0.6, n.y);      // the tops of ledges catch dust and light
	// light: the sun, a sky dome term, and a cold rim that keeps the silhouette readable against the lid
	float lam = max(dot(n, sun_dir), 0.0);
	vec3 lit = rock * (sun_col * sun_energy * lam * 0.55 + horizon * (0.30 + 0.55 * max(n.y, 0.0)));
	lit += horizon * 0.10 * pow(1.0 - abs(dot(n, normalize(v_world - CAMERA_POSITION_WORLD))), 3.0);
	// seams of Radius light in the deepest cracks, breathing slowly
	float crack = smoothstep(0.62, 0.90, fbm(vec2(ang * 7.0, v_local.y * 0.03 - t * 0.006)));
	lit += vec3(0.30, 0.52, 0.86) * crack * seam * (0.05 + 0.30 * night) * (0.6 + 0.4 * sin(t * 0.7 + v_local.y * 0.01));
	lit += vec3(0.55, 0.60, 0.78) * lightning * 0.35 * (0.3 + 0.7 * lam);
	// aerial perspective by true distance
	float dist = length(v_world - CAMERA_POSITION_WORLD);
	float ap = min(1.0 - exp(-dist * ap_density), ap_max);
	vec3 col = mix(lit, horizon, ap);
	col = mix(col, vec3(1.0), tide);
	ALBEDO = col;
}
"""

## Debris in orbit: the instance transform holds the shape, INSTANCE_CUSTOM the orbit (radius, height, phase, speed).
const DEBRIS_SHADER := """
shader_type spatial;
render_mode unshaded, cull_back, fog_disabled, shadows_disabled, specular_disabled, world_vertex_coords;
uniform vec3 center = vec3(0.0);
uniform vec3 horizon : source_color = vec3(0.6, 0.62, 0.65);
uniform vec3 sun_col : source_color = vec3(1.0, 0.95, 0.9);
uniform float sun_energy = 1.0;
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform float ap_density = 0.0004;
uniform float ap_max = 0.94;
uniform float t = 0.0;
uniform float tide = 0.0;
varying vec3 v_n;
varying vec3 v_world;
void vertex() {
	vec4 c = INSTANCE_CUSTOM;   // x orbit radius, y height offset, z phase, w signed angular speed
	float a = c.z + t * c.w;
	vec3 orbit = center + vec3(cos(a) * c.x, c.y + sin(a * 2.0 + c.z) * 22.0, sin(a) * c.x);
	float ra = t * c.w * 5.0 + c.z * 3.0;
	float cs = cos(ra); float sn = sin(ra);
	mat3 rot = mat3(vec3(cs, 0.0, sn), vec3(0.0, 1.0, 0.0), vec3(-sn, 0.0, cs));
	mat3 tilt = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, cos(c.z), -sin(c.z)), vec3(0.0, sin(c.z), cos(c.z)));
	mat3 m = rot * tilt;
	VERTEX = orbit + m * VERTEX;
	v_n = normalize(m * NORMAL);
	NORMAL = v_n;
	v_world = VERTEX;
}
void fragment() {
	vec3 n = normalize(v_n);
	vec3 rock = vec3(0.055, 0.058, 0.065) * (0.8 + 0.4 * max(n.y, 0.0));
	vec3 lit = rock * (sun_col * sun_energy * max(dot(n, sun_dir), 0.0) * 0.6 + horizon * (0.32 + 0.5 * max(n.y, 0.0)));
	float dist = length(v_world - CAMERA_POSITION_WORLD);
	float ap = min(1.0 - exp(-dist * ap_density), ap_max);
	vec3 col = mix(lit, horizon, ap);
	ALBEDO = mix(col, vec3(1.0), tide);
}
"""

## The black geometric anomalies hanging far off in the sky: flat, near-lightless solids that only the haze reveals.
const SHARD_SHADER := """
shader_type spatial;
render_mode unshaded, cull_back, fog_disabled, shadows_disabled, specular_disabled;
uniform vec3 horizon : source_color = vec3(0.6, 0.62, 0.65);
uniform float ap_density = 0.0004;
uniform float ap_max = 0.94;
uniform float t = 0.0;
uniform float tide = 0.0;
varying vec3 v_n;
varying vec3 v_world;
void vertex() {
	vec4 c = INSTANCE_CUSTOM;   // x,y,z rotation axis-ish, w speed
	float a = t * c.w;
	float cs = cos(a); float sn = sin(a);
	mat3 ry = mat3(vec3(cs, 0.0, sn), vec3(0.0, 1.0, 0.0), vec3(-sn, 0.0, cs));
	float b = t * c.w * 0.61 + c.x * 6.0;
	float cb = cos(b); float sb = sin(b);
	mat3 rx = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, cb, -sb), vec3(0.0, sb, cb));
	mat3 m = ry * rx;
	VERTEX = m * VERTEX;
	v_n = normalize((MODEL_MATRIX * vec4(m * NORMAL, 0.0)).xyz);
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
	vec3 n = normalize(v_n);
	vec3 col = vec3(0.012, 0.013, 0.016) * (0.7 + 0.6 * max(n.y, 0.0));
	float dist = length(v_world - CAMERA_POSITION_WORLD);
	float ap = min(1.0 - exp(-dist * ap_density), ap_max);
	col = mix(col, horizon, ap * 0.96);
	ALBEDO = mix(col, vec3(1.0), tide);
}
"""

func setup(column_xz: Vector2, ground_y: float) -> void:
	base = Vector3(column_xz.x, ground_y, column_xz.y)
	var shader: Shader = load("res://shaders/column.gdshader")
	# ---- the Column
	var cyl := CylinderMesh.new()
	cyl.top_radius = 26.0; cyl.bottom_radius = 62.0; cyl.height = HEIGHT
	cyl.radial_segments = 40; cyl.rings = 10; cyl.cap_top = false; cyl.cap_bottom = false
	column = MeshInstance3D.new(); column.name = "Column"; column.mesh = cyl
	_col_mat = ShaderMaterial.new(); _col_mat.shader = shader
	_col_mat.set_shader_parameter("mode", 0); _col_mat.set_shader_parameter("height", HEIGHT)
	column.material_override = _col_mat
	column.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	column.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	column.extra_cull_margin = 600.0
	column.sorting_offset = -400.0
	add_child(column)
	# ---- the lens of distortion hanging on it
	var sph := SphereMesh.new(); sph.radius = LENS_R; sph.height = LENS_R * 2.1; sph.radial_segments = 36; sph.rings = 18
	lens = MeshInstance3D.new(); lens.name = "Lens"; lens.mesh = sph
	_lens_mat = ShaderMaterial.new(); _lens_mat.shader = shader
	_lens_mat.set_shader_parameter("mode", 1); _lens_mat.set_shader_parameter("height", LENS_R * 2.1)
	lens.material_override = _lens_mat
	lens.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	lens.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	lens.extra_cull_margin = 200.0
	lens.sorting_offset = -380.0
	add_child(lens)
	# ---- the inverted mountain
	mountain = MeshInstance3D.new(); mountain.name = "PechorskAnomaly"; mountain.mesh = _mountain_mesh()
	_mtn_mat = ShaderMaterial.new(); var msh := Shader.new(); msh.code = ROCK_SHADER; _mtn_mat.shader = msh
	mountain.material_override = _mtn_mat
	mountain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mountain.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	mountain.extra_cull_margin = 900.0
	add_child(mountain)
	# ---- slabs and boulders in orbit around it
	debris = MultiMeshInstance3D.new(); debris.name = "Debris"
	var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.use_custom_data = true; mm.instance_count = DEBRIS
	mm.mesh = _rock_mesh()
	var rnd := RandomNumberGenerator.new(); rnd.seed = 4242
	for i in DEBRIS:
		var sc := 3.0 + pow(rnd.randf(), 2.2) * 26.0
		var slab := rnd.randf() < 0.3
		var sv := Vector3(sc, sc * (0.5 + rnd.randf() * 0.7), sc * (0.7 + rnd.randf() * 0.6))
		if slab: sv = Vector3(sc * 2.2, sc * 0.22, sc * 1.7)
		mm.set_instance_transform(i, Transform3D(Basis.from_scale(sv), Vector3.ZERO))
		var r := 190.0 + pow(rnd.randf(), 0.8) * 460.0
		var y := -180.0 + rnd.randf() * 380.0
		var speed := (0.003 + rnd.randf() * 0.009) * (1.0 if rnd.randf() < 0.5 else -1.0)
		mm.set_instance_custom_data(i, Color(r, y, rnd.randf() * TAU, speed))
	debris.multimesh = mm
	_deb_mat = ShaderMaterial.new(); var dsh := Shader.new(); dsh.code = DEBRIS_SHADER; _deb_mat.shader = dsh
	debris.material_override = _deb_mat
	debris.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	debris.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	add_child(debris)
	# ---- black geometric anomalies far off in the sky
	shards = MultiMeshInstance3D.new(); shards.name = "SkyAnomalies"
	var sm := MultiMesh.new(); sm.transform_format = MultiMesh.TRANSFORM_3D; sm.use_custom_data = true; sm.instance_count = SHARDS
	sm.mesh = _shard_mesh()
	var srnd := RandomNumberGenerator.new(); srnd.seed = 8181
	for i in SHARDS:
		var ang := -1.9 + float(i) / float(SHARDS) * 3.6 + srnd.randf() * 0.25
		var dist := 1500.0 + srnd.randf() * 900.0
		var sz := 40.0 + pow(srnd.randf(), 1.6) * 130.0
		var pos := Vector3(sin(ang) * dist, 260.0 + srnd.randf() * 620.0, -cos(ang) * dist)
		var b := Basis.from_scale(Vector3(sz, sz * (0.6 + srnd.randf() * 1.1), sz * (0.7 + srnd.randf() * 0.7)))
		b = b.rotated(Vector3(0.3, 0.8, 0.5).normalized(), srnd.randf() * TAU)
		sm.set_instance_transform(i, Transform3D(b, pos))
		sm.set_instance_custom_data(i, Color(srnd.randf(), srnd.randf(), srnd.randf(), 0.004 + srnd.randf() * 0.012))
	shards.multimesh = sm
	_shard_mat = ShaderMaterial.new(); var ssh := Shader.new(); ssh.code = SHARD_SHADER; _shard_mat.shader = ssh
	shards.material_override = _shard_mat
	shards.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	shards.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	shards.custom_aabb = AABB(Vector3(-2600.0, -200.0, -2600.0), Vector3(5200.0, 1600.0, 5200.0))
	add_child(shards)
	# ---- the glow of the Column standing in the haze at its foot
	glow = MeshInstance3D.new(); glow.name = "Glow"
	var gq := QuadMesh.new(); gq.size = Vector2(560.0, 380.0)
	_glow_mat = StandardMaterial3D.new()
	_glow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; _glow_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_glow_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD; _glow_mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	_glow_mat.disable_fog = true; _glow_mat.no_depth_test = false
	var gg := Gradient.new(); gg.set_color(0, Color(1, 1, 1, 1)); gg.set_color(1, Color(1, 1, 1, 0)); gg.add_point(0.3, Color(1, 1, 1, 0.4))
	var ggt := GradientTexture2D.new(); ggt.gradient = gg; ggt.fill = GradientTexture2D.FILL_RADIAL; ggt.fill_from = Vector2(0.5, 0.5); ggt.fill_to = Vector2(0.5, 0.0); ggt.width = 128; ggt.height = 128
	_glow_mat.albedo_texture = ggt; _glow_mat.albedo_color = Color(0.8, 0.86, 1.0, 0.3)
	gq.material = _glow_mat; glow.mesh = gq
	glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; glow.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	glow.extra_cull_margin = 400.0
	glow.sorting_offset = -420.0
	add_child(glow)
	# ---- motes rising out of the foot of the Column
	motes = GPUParticles3D.new(); motes.name = "Motes"
	motes.amount = 320; motes.lifetime = 55.0; motes.preprocess = 55.0; motes.local_coords = false; motes.fixed_fps = 15; motes.interpolate = true
	motes.visibility_aabb = AABB(Vector3(-160.0, -320.0, -160.0), Vector3(320.0, 1300.0, 320.0))
	motes.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	motes.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
	pm.emission_ring_axis = Vector3.UP; pm.emission_ring_radius = 46.0; pm.emission_ring_inner_radius = 3.0; pm.emission_ring_height = 460.0
	pm.direction = Vector3.UP; pm.spread = 7.0; pm.initial_velocity_min = 5.0; pm.initial_velocity_max = 13.0; pm.gravity = Vector3.ZERO
	pm.scale_min = 0.5; pm.scale_max = 1.7
	pm.turbulence_enabled = true; pm.turbulence_noise_strength = 1.1; pm.turbulence_noise_scale = 6.0
	pm.turbulence_influence_min = 0.05; pm.turbulence_influence_max = 0.12
	var ramp := Gradient.new(); ramp.set_color(0, Color(1, 1, 1, 0)); ramp.set_color(1, Color(1, 1, 1, 0))
	ramp.add_point(0.12, Color(1, 1, 1, 1)); ramp.add_point(0.7, Color(1, 1, 1, 0.75))
	var ramp_tex := GradientTexture1D.new(); ramp_tex.gradient = ramp; pm.color_ramp = ramp_tex
	motes.process_material = pm
	var q := QuadMesh.new(); q.size = Vector2(5.0, 5.0)
	_mote_mat = StandardMaterial3D.new()
	_mote_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; _mote_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mote_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD; _mote_mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	_mote_mat.vertex_color_use_as_albedo = true; _mote_mat.disable_fog = true
	var g := Gradient.new(); g.set_color(0, Color(1, 1, 1, 1)); g.set_color(1, Color(1, 1, 1, 0))
	var gt := GradientTexture2D.new(); gt.gradient = g; gt.fill = GradientTexture2D.FILL_RADIAL; gt.fill_from = Vector2(0.5, 0.5); gt.fill_to = Vector2(0.5, 0.0); gt.width = 64; gt.height = 64
	_mote_mat.albedo_texture = gt
	_mote_mat.albedo_color = Color(0.82, 0.88, 1.0, 0.3)
	q.material = _mote_mat
	motes.draw_pass_1 = q
	add_child(motes)
	setup_ground(ground_y)

## Once the terrain exists: stand everything on the ground level nearest the Column.
func setup_ground(ground_y: float) -> void:
	base.y = ground_y
	column.position = base + Vector3(0.0, HEIGHT * 0.5 - 70.0, 0.0)
	lens.position = base + Vector3(0.0, LENS_Y, 0.0)
	mountain.position = base + MOUNTAIN_OFFSET
	_deb_mat.set_shader_parameter("center", mountain.position)
	debris.custom_aabb = AABB(mountain.position - Vector3(900.0, 500.0, 900.0), Vector3(1800.0, 1000.0, 1800.0))
	motes.position = base + Vector3(0.0, 240.0, 0.0)
	glow.position = base + Vector3(0.0, 70.0, 0.0)

# ---------------------------------------------------------------- meshes
func _cache_path(name: String) -> String: return "res://assets/cache/%s_%s.res" % [name, MESH_VERSION]

func _mountain_mesh() -> ArrayMesh:
	var path := _cache_path("mountain")
	if ResourceLoader.exists(path):
		var res: Variant = load(path)
		if res is ArrayMesh: return res
	var mesh := _build_mountain()
	DirAccess.make_dir_recursive_absolute("res://assets/cache")
	ResourceSaver.save(mesh, path)
	return mesh

## A mountain torn out of the ground and hung upside down: a sheared plate of land on top, a craggy inverted mass
## below it with ridges and gullies running down to a broken point. Radial field, ridged noise, flat-shaded.
func _build_mountain() -> ArrayMesh:
	var rnd := RandomNumberGenerator.new(); rnd.seed = 1211
	var segs := 88; var rings := 26
	var rows: Array = []
	# per-angle ridge field: ridged sines (sharp gullies) plus a hashed jitter, slowly twisting with depth
	var jit := PackedFloat32Array(); jit.resize(segs)
	for i in segs: jit[i] = rnd.randf()
	for j in rings + 1:
		var v := float(j) / rings
		var row: Array = []
		for i in segs:
			var ang := TAU * i / segs
			var ridge := 0.0
			ridge += 0.46 * (1.0 - absf(sin(ang * 3.0 + v * 1.6)))
			ridge += 0.26 * (1.0 - absf(sin(ang * 7.0 - v * 2.4 + 1.1)))
			ridge += 0.15 * (1.0 - absf(sin(ang * 15.0 + v * 3.3 + 2.4)))
			ridge += 0.09 * (1.0 - absf(sin(ang * 29.0 - v * 1.2 + 0.7)))
			ridge = ridge * 0.9 + (jit[i] - 0.5) * 0.16 * (1.0 - v * 0.5)
			var r := MTN_R * pow(1.0 - v, 0.72) * (0.72 + 0.45 * ridge)
			# terraces: strata that survived the tearing
			r *= 1.0 + 0.035 * sin(v * 26.0 + ang * 0.7)
			if j == rings: r = 6.0 + jit[i] * 10.0
			var y := -MTN_DEPTH * pow(v, 1.22) + sin(ang * 5.0 + v * 4.0) * 26.0 * (1.0 - v) + (jit[(i + j) % segs] - 0.5) * 30.0 * (1.0 - v * 0.7)
			row.append(Vector3(cos(ang) * r, y, sin(ang) * r))
		rows.append(row)
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for j in rings:
		for i in segs:
			var a: Vector3 = rows[j][i]; var b: Vector3 = rows[j][(i + 1) % segs]
			var c: Vector3 = rows[j + 1][i]; var d: Vector3 = rows[j + 1][(i + 1) % segs]
			st.add_vertex(a); st.add_vertex(c); st.add_vertex(b)
			st.add_vertex(b); st.add_vertex(c); st.add_vertex(d)
	# the sheared plate on top: a broken lip around the rim and a shallow, cratered plain inside it
	var lip: Array = []
	var plate: Array = []
	for i in segs:
		var a: Vector3 = rows[0][i]
		var up := 34.0 + jit[i] * 46.0
		lip.append(a + Vector3(0.0, up, 0.0))
		plate.append(a * 0.78 + Vector3(0.0, up * 0.55 + 6.0, 0.0))
	for i in segs:
		var a: Vector3 = rows[0][i]; var b: Vector3 = rows[0][(i + 1) % segs]
		var la: Vector3 = lip[i]; var lb: Vector3 = lip[(i + 1) % segs]
		st.add_vertex(a); st.add_vertex(b); st.add_vertex(la)
		st.add_vertex(b); st.add_vertex(lb); st.add_vertex(la)
	var rings_in := 4
	var prev: Array = plate
	for k in range(1, rings_in + 1):
		var f := float(k) / rings_in
		var cur: Array = []
		for i in segs:
			var p: Vector3 = plate[i] * (1.0 - f)
			var h := lerpf(plate[i].y, -18.0 + jit[(i * 3 + k) % segs] * 26.0, f)
			cur.append(Vector3(p.x, h + sin(float(i) * 0.7 + f * 5.0) * 8.0 * (1.0 - f), p.z))
		for i in segs:
			var a: Vector3 = prev[i]; var b: Vector3 = prev[(i + 1) % segs]
			var c: Vector3 = cur[i]; var d: Vector3 = cur[(i + 1) % segs]
			st.add_vertex(a); st.add_vertex(b); st.add_vertex(c)
			st.add_vertex(b); st.add_vertex(d); st.add_vertex(c)
		prev = cur
	for i in segs:
		var a: Vector3 = lip[i]
		var b: Vector3 = plate[i]
		var b2: Vector3 = plate[(i + 1) % segs]
		var a2: Vector3 = lip[(i + 1) % segs]
		st.add_vertex(a); st.add_vertex(b); st.add_vertex(a2)
		st.add_vertex(a2); st.add_vertex(b); st.add_vertex(b2)
	st.generate_normals()
	return st.commit()

func _rock_mesh() -> ArrayMesh:
	var sm := SphereMesh.new(); sm.radius = 1.0; sm.height = 2.0; sm.radial_segments = 7; sm.rings = 4
	var arrays := sm.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var rnd := RandomNumberGenerator.new(); rnd.seed = 77
	var jitter := {}
	for i in verts.size():
		var key := Vector3i(roundi(verts[i].x * 50.0), roundi(verts[i].y * 50.0), roundi(verts[i].z * 50.0))
		if not jitter.has(key): jitter[key] = 0.55 + rnd.randf() * 0.8
		verts[i] = verts[i] * jitter[key]
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	for k in idx.size(): st.add_vertex(verts[idx[k]])
	st.generate_normals()
	return st.commit()

## An angular solid for the sky anomalies: a sheared octahedron, flat-shaded.
func _shard_mesh() -> ArrayMesh:
	var rnd := RandomNumberGenerator.new(); rnd.seed = 3131
	var p := [Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 1.35, 0), Vector3(0, -1.35, 0), Vector3(0, 0, 1), Vector3(0, 0, -1)]
	for i in p.size(): p[i] = (p[i] as Vector3) + Vector3(rnd.randf() - 0.5, rnd.randf() - 0.5, rnd.randf() - 0.5) * 0.35
	var faces := [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for f in faces:
		st.add_vertex(p[f[0]]); st.add_vertex(p[f[1]]); st.add_vertex(p[f[2]])
	st.generate_normals()
	return st.commit()

# ---------------------------------------------------------------- per frame
## Called by the Sky every frame. ap_density is the aerial-perspective extinction per metre (weather + haze) and
## fade is how far the fog has swallowed the far distance.
func update(night: float, horizon: Color, sun_dir: Vector3, tide: float, lightning: float, t: float,
		sun_energy: float, exposure: float, fog: float = 0.0, sun_col: Color = Color.WHITE, ap_density: float = 0.0004) -> void:
	# the Column reads as pale light by day and glows at night; the exposure keys must not change how bright it looks
	var energy := (0.16 + 0.30 * clampf(sun_energy / 1.7, 0.0, 1.0)) * (1.0 - night * 0.55) + 0.20 * night
	energy /= maxf(exposure, 0.3)
	var fade := clampf(fog * 1.15, 0.0, 1.0)
	for m in [_col_mat, _lens_mat]:
		m.set_shader_parameter("night", night); m.set_shader_parameter("tide", tide); m.set_shader_parameter("lightning", lightning)
		m.set_shader_parameter("t", t); m.set_shader_parameter("energy", energy); m.set_shader_parameter("fade", fade)
	var ap_max := clampf(0.86 + fog * 0.14, 0.0, 1.0)
	for m in [_mtn_mat, _deb_mat, _shard_mat]:
		m.set_shader_parameter("horizon", horizon)
		m.set_shader_parameter("ap_density", ap_density)
		m.set_shader_parameter("ap_max", ap_max)
		m.set_shader_parameter("t", t); m.set_shader_parameter("tide", tide)
	for m in [_mtn_mat, _deb_mat]:
		m.set_shader_parameter("sun_dir", sun_dir); m.set_shader_parameter("sun_col", sun_col)
		m.set_shader_parameter("sun_energy", sun_energy)
	_mtn_mat.set_shader_parameter("night", night)
	_mtn_mat.set_shader_parameter("lightning", lightning)
	_mote_mat.albedo_color = Color(0.82, 0.88, 1.0, (0.07 + 0.16 * night) * (1.0 - fade) / maxf(exposure, 0.3))
	_glow_mat.albedo_color = Color(0.80, 0.86, 1.0, (0.09 + 0.20 * night) * (0.7 + 0.5 * clampf(sun_energy / 1.7, 0.0, 1.0)) / maxf(exposure, 0.3) * (1.0 - fade))
