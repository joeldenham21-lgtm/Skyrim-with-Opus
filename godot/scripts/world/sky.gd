extends Node3D
## Sky, weather, lighting and atmosphere of the Pechorsk zone (scenes/world/sky.tscn, child "Sky" of the World).
## Owns the WorldEnvironment (SDFGI, SSAO/SSIL, SSR, glow, volumetric and height fog, ACES with exposure keys, the
## colour-correction LUT), the "Sun" and "Moon" directional lights (plus a shadowless "Flash" light for lightning),
## the sky shader (single-scattering atmosphere, cloud lid, sun, moon, stars), FogVolumes in the hollows and the marsh,
## precipitation (drizzle, rain, ground splashes, rain on the lens), the storm's lightning and thunder, the Tide's
## whitening and the far landmarks (scripts/world/column.gd).
## Contract: `weather` (clear|overcast|drizzle|rain|fog|storm), set_weather(name, seconds) and Events.weather_changed;
## plus `wind` (Vector2, m/s, gusting), `rain` (0..1), `fog_level` (0..1), `sun_dir`, `sun_color`, `sun_energy`,
## `horizon_color`, `tide` (0..1 white-out), `lightning` (0..1), light_level() (0..1 outdoor light for perception).

const KEYS := [
	# hour, clear-sky sun energy, sun colour, exposure, art tint (applied to the sky and the fog)
	[0.0, 0.0, Color(0.60, 0.66, 0.82), 2.60, Color(0.84, 0.89, 1.08)],
	[3.8, 0.0, Color(0.60, 0.66, 0.82), 2.60, Color(0.84, 0.89, 1.08)],
	[4.8, 0.03, Color(0.66, 0.72, 0.88), 2.20, Color(0.83, 0.90, 1.10)],
	[5.5, 0.22, Color(0.88, 0.83, 0.86), 1.55, Color(0.85, 0.92, 1.09)],
	[6.5, 0.70, Color(1.00, 0.86, 0.74), 1.05, Color(0.90, 0.95, 1.05)],
	[8.0, 1.28, Color(1.00, 0.91, 0.82), 0.80, Color(0.96, 0.98, 1.02)],
	[12.0, 1.70, Color(1.00, 0.96, 0.92), 0.62, Color(1.00, 1.00, 1.00)],
	[16.0, 1.35, Color(1.00, 0.92, 0.82), 0.70, Color(1.00, 0.98, 0.96)],
	[18.3, 0.78, Color(1.00, 0.75, 0.52), 0.92, Color(1.03, 0.97, 0.90)],
	[19.5, 0.32, Color(1.00, 0.56, 0.33), 1.35, Color(1.05, 0.95, 0.86)],
	[20.4, 0.06, Color(0.92, 0.52, 0.42), 1.95, Color(0.94, 0.93, 1.02)],
	[21.4, 0.0, Color(0.60, 0.66, 0.82), 2.60, Color(0.84, 0.89, 1.08)],
	[24.0, 0.0, Color(0.60, 0.66, 0.82), 2.60, Color(0.84, 0.89, 1.08)],
]
const BETA_R := Vector3(5.8e-6, 13.5e-6, 33.1e-6)
const BETA_M := 2.1e-5
const VOL_ALBEDO := Color(0.72, 0.76, 0.80)
const FAR_PLANE := 3200.0

# public state
var weather: String:
	get: return _weather.state if _weather else "overcast"
var wind := Vector2(2.0, 1.0)
var rain := 0.0
var fog_level := 0.0
var tide := 0.0
var sick := 0.0
var lightning := 0.0
var sun_dir := Vector3(0.0, 1.0, 0.0)
var moon_dir := Vector3(0.0, -1.0, 0.0)
var moon_phase := 0.45
var sun_color := Color(1.0, 0.95, 0.9)
var sun_energy := 0.0          # effective energy of the Sun light this frame
var sun_energy_clear := 0.0    # energy above the clouds (the hour key)
var horizon_color := Color(0.6, 0.62, 0.65)
var exposure := 1.0
var quality := "high"

# nodes
var env: WorldEnvironment
var environment: Environment
var sun: DirectionalLight3D
var moon: DirectionalLight3D
var flash: DirectionalLight3D
var sky_mat: ShaderMaterial
var _sky_res: Sky
var _weather: Node
var _column: Node3D
var _rain: GPUParticles3D
var _drizzle: GPUParticles3D
var _splash: GPUParticles3D
var _rain_pm: ParticleProcessMaterial
var _drizzle_pm: ParticleProcessMaterial
var _splash_pm: ParticleProcessMaterial
var _rain_mat: ShaderMaterial
var _drizzle_mat: ShaderMaterial
var _splash_mat: ShaderMaterial
var _splash_img: Image
var _splash_tex: ImageTexture
var _splash_t := 0.0
var _lens: MeshInstance3D
var _lens_mat: ShaderMaterial
var _lens_amount := 0.0
var _fog_volumes: Array[FogVolume] = []
var _fog_base: Array[float] = []
var _hollow_mat: FogMaterial
var _marsh_mat: FogMaterial
var _cloud_travel := Vector2.ZERO
var _tide_phase := "idle"
var _tide_t := 0.0
var _rng := RandomNumberGenerator.new()
var _placed_fog := false
var _ground_median := 5.0
var _ground_low := 2.0
var _far_warned := false

func _ready() -> void:
	_rng.seed = 91
	_weather = Node.new(); _weather.name = "Weather"; _weather.set_script(load("res://scripts/world/weather.gd")); add_child(_weather)
	_build_environment()
	_build_lights()
	_build_precipitation()
	_build_lens()
	_column = Node3D.new(); _column.name = "Landmarks"; _column.set_script(load("res://scripts/world/column.gd")); add_child(_column)
	var c: Dictionary = Data.map.get("COLUMN", { "x": 40, "z": -1100 })
	_column.setup(Vector2(float(c.get("x", 40)), float(c.get("z", -1100))), 0.0)
	Events.world_ready.connect(_on_world_ready)
	Events.tide_rising.connect(_on_tide_rising)
	Events.tide.connect(_on_tide)
	Events.quality_changed.connect(set_quality)
	Events.game_started.connect(func(_new: bool) -> void: _tide_phase = "idle"; tide = 0.0)
	if Game.world and Game.world.get("ready_done"): call_deferred("_on_world_ready")
	_update(0.0)

# ---------------------------------------------------------------- contract
func set_weather(name: String, seconds: float = 120.0) -> void:
	_weather.set_weather(name, seconds)
func force_weather(name: String, seconds: float = 120.0, hold: float = 600.0) -> void:
	_weather.force_weather(name, seconds, hold)
func strike() -> void: _weather.strike()
func weather_params() -> Dictionary: return _weather.params
## 0..1 outdoor light for perception: overcast noon ~0.75, dusk ~0.3, moonlit night ~0.08, overcast night ~0.03
func light_level() -> float:
	var day := clampf(sun_energy / 1.2, 0.0, 1.0) * 0.6 + clampf(sun_energy_clear / 1.7, 0.0, 1.0) * 0.3
	var moonlit := moon.light_energy * 1.2
	return clampf(day + moonlit + 0.02 + lightning * 0.6, 0.0, 1.0)
func set_quality(preset: String) -> void:
	quality = preset
	var low := preset == "low"; var medium := preset == "medium"
	environment.sdfgi_enabled = not low
	environment.sdfgi_cascades = 3 if medium else 4
	environment.ssil_enabled = not (low or medium)
	environment.ssr_enabled = not low
	environment.volumetric_fog_enabled = not low
	environment.ssao_enabled = true
	if _rain: _rain.amount = 2200 if low else (3600 if medium else 5200)
	if _drizzle: _drizzle.amount = 1200 if low else (1800 if medium else 2600)

# ---------------------------------------------------------------- build
func _build_environment() -> void:
	env = WorldEnvironment.new(); env.name = "Environment"
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	_sky_res = Sky.new()
	sky_mat = ShaderMaterial.new(); sky_mat.shader = load("res://shaders/sky.gdshader")
	_sky_res.sky_material = sky_mat
	# INCREMENTAL: one cubemap face per frame instead of the whole thing every frame (the sky changes slowly)
	_sky_res.process_mode = Sky.PROCESS_MODE_INCREMENTAL
	_sky_res.radiance_size = Sky.RADIANCE_SIZE_128
	var cloud_tex: Texture2D = load("res://assets/lut/cloud_noise.png") if ResourceLoader.exists("res://assets/lut/cloud_noise.png") else null
	if cloud_tex: sky_mat.set_shader_parameter("cloud_tex", cloud_tex)
	else: push_warning("sky: assets/lut/cloud_noise.png missing (run assets/lut/gen_cloud_noise.py)")
	e.sky = _sky_res
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY; e.ambient_light_sky_contribution = 1.0; e.ambient_light_energy = 1.0
	e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	# tone mapping: ACES, exposure keyed by hour (no auto exposure)
	e.tonemap_mode = Environment.TONE_MAPPER_ACES; e.tonemap_exposure = 1.0; e.tonemap_white = 5.5
	# global illumination
	e.sdfgi_enabled = true; e.sdfgi_cascades = 4; e.sdfgi_min_cell_size = 0.3
	e.sdfgi_y_scale = Environment.SDFGI_Y_SCALE_75_PERCENT
	e.sdfgi_use_occlusion = true; e.sdfgi_bounce_feedback = 0.4; e.sdfgi_read_sky_light = true; e.sdfgi_energy = 1.0
	e.sdfgi_normal_bias = 1.1; e.sdfgi_probe_bias = 1.1
	e.ssao_enabled = true; e.ssao_radius = 1.2; e.ssao_intensity = 2.2; e.ssao_power = 1.6; e.ssao_detail = 0.5; e.ssao_horizon = 0.06; e.ssao_sharpness = 0.98
	e.ssao_light_affect = 0.0; e.ssao_ao_channel_affect = 0.0
	e.ssil_enabled = true; e.ssil_radius = 4.0; e.ssil_intensity = 1.0; e.ssil_sharpness = 0.98; e.ssil_normal_rejection = 1.0
	e.ssr_enabled = true; e.ssr_max_steps = 48; e.ssr_fade_in = 0.15; e.ssr_fade_out = 2.0; e.ssr_depth_tolerance = 0.2
	# glow: soft, high threshold, no bloom soup; only sources bloom (sun through gauze, artifacts, muzzle flash, the Column)
	e.glow_enabled = true; e.glow_normalized = false; e.glow_intensity = 0.32; e.glow_strength = 0.9; e.glow_bloom = 0.0; e.glow_mix = 0.05
	e.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	e.glow_hdr_threshold = 1.6; e.glow_hdr_scale = 2.0; e.glow_hdr_luminance_cap = 14.0
	for i in 7: e.set_glow_level(i, 0.0)
	e.set_glow_level(1, 0.35); e.set_glow_level(2, 0.6); e.set_glow_level(4, 0.4); e.set_glow_level(6, 0.15)
	# fog: exponential distance fog with height fog at ground level, tinted by the horizon colour from the sky model
	e.fog_enabled = true; e.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	e.fog_light_color = Color(0.58, 0.6, 0.62); e.fog_light_energy = 1.0; e.fog_sun_scatter = 0.25; e.fog_density = 0.002
	e.fog_aerial_perspective = 0.55; e.fog_sky_affect = 0.35; e.fog_height = 0.0; e.fog_height_density = 0.12
	# volumetric fog: the medium the torch and the sun shafts live in
	e.volumetric_fog_enabled = true; e.volumetric_fog_density = 0.011; e.volumetric_fog_albedo = VOL_ALBEDO
	e.volumetric_fog_emission = Color.BLACK; e.volumetric_fog_emission_energy = 0.0
	e.volumetric_fog_gi_inject = 0.6; e.volumetric_fog_anisotropy = 0.62; e.volumetric_fog_length = 120.0; e.volumetric_fog_detail_spread = 2.0
	e.volumetric_fog_ambient_inject = 0.35; e.volumetric_fog_sky_affect = 0.5
	e.volumetric_fog_temporal_reprojection_enabled = true; e.volumetric_fog_temporal_reprojection_amount = 0.9
	# adjustments and the film LUT
	e.adjustment_enabled = true; e.adjustment_brightness = 1.0; e.adjustment_contrast = 1.03; e.adjustment_saturation = 0.86
	var lut := _load_lut("res://assets/lut/pechorsk.png")
	if lut: e.adjustment_color_correction = lut
	environment = e; env.environment = e
	add_child(env)

## The LUT is imported as a Texture3D (assets/lut/pechorsk.png.import: 32 horizontal slices); if the import has not run
## (or the resource comes back 2D) the strip is sliced here.
func _load_lut(path: String) -> Texture3D:
	if not ResourceLoader.exists(path): return null
	var res: Variant = load(path)
	if res is Texture3D: return res
	var img: Image = null
	if res is Texture2D: img = res.get_image()
	if img == null and FileAccess.file_exists(path):
		img = Image.new()
		if img.load_png_from_buffer(FileAccess.get_file_as_bytes(path)) != OK: img = null
	if img == null: return null
	img.decompress()
	var n := img.get_height()
	if img.get_width() != n * n: return null
	img.convert(Image.FORMAT_RGB8)
	var slices: Array[Image] = []
	for k in n: slices.append(img.get_region(Rect2i(k * n, 0, n, n)))
	var t := ImageTexture3D.new()
	t.create(Image.FORMAT_RGB8, n, n, n, false, slices)
	return t

func _build_lights() -> void:
	sun = DirectionalLight3D.new(); sun.name = "Sun"
	sun.light_energy = 1.2; sun.light_color = Color(1.0, 0.95, 0.9)
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 250.0
	sun.directional_shadow_split_1 = 0.06; sun.directional_shadow_split_2 = 0.16; sun.directional_shadow_split_3 = 0.4
	sun.directional_shadow_blend_splits = true; sun.directional_shadow_fade_start = 0.85
	sun.directional_shadow_pancake_size = 30.0
	sun.shadow_bias = 0.02; sun.shadow_normal_bias = 1.3; sun.shadow_blur = 1.0; sun.shadow_opacity = 1.0
	sun.light_angular_distance = 0.5
	sun.light_volumetric_fog_energy = 1.0
	sun.light_bake_mode = Light3D.BAKE_DYNAMIC
	add_child(sun)
	moon = DirectionalLight3D.new(); moon.name = "Moon"
	moon.light_energy = 0.0; moon.light_color = Color(0.62, 0.7, 0.92)
	moon.shadow_enabled = false
	moon.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	moon.directional_shadow_max_distance = 120.0; moon.directional_shadow_split_1 = 0.15
	moon.shadow_bias = 0.03; moon.shadow_normal_bias = 1.6; moon.shadow_blur = 2.0
	moon.light_angular_distance = 1.0; moon.light_volumetric_fog_energy = 0.8
	add_child(moon)
	flash = DirectionalLight3D.new(); flash.name = "Flash"
	flash.light_energy = 0.0; flash.light_color = Color(0.82, 0.86, 1.0); flash.shadow_enabled = false; flash.visible = false
	flash.light_volumetric_fog_energy = 2.5
	add_child(flash)

func _build_precipitation() -> void:
	var drop_shader: Shader = load("res://shaders/rain_drop.gdshader")
	# rain
	_rain = GPUParticles3D.new(); _rain.name = "Rain"
	_rain.amount = 5200; _rain.lifetime = 2.4; _rain.local_coords = false; _rain.emitting = true; _rain.amount_ratio = 0.0
	_rain.fixed_fps = 30; _rain.interpolate = true; _rain.randomness = 0.3
	_rain.visibility_aabb = AABB(Vector3(-40.0, -30.0, -40.0), Vector3(80.0, 60.0, 80.0))
	_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; _rain.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	_rain_pm = ParticleProcessMaterial.new()
	_rain_pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX; _rain_pm.emission_box_extents = Vector3(22.0, 6.0, 22.0)
	_rain_pm.direction = Vector3(0.0, -1.0, 0.0); _rain_pm.spread = 0.0
	_rain_pm.initial_velocity_min = 9.0; _rain_pm.initial_velocity_max = 11.5; _rain_pm.gravity = Vector3.ZERO
	_rain_pm.scale_min = 0.7; _rain_pm.scale_max = 1.35
	_rain.process_material = _rain_pm
	var q := QuadMesh.new(); q.size = Vector2(1.0, 1.0)
	_rain_mat = ShaderMaterial.new(); _rain_mat.shader = drop_shader
	_rain_mat.set_shader_parameter("len", 0.5); _rain_mat.set_shader_parameter("width", 0.014); _rain_mat.set_shader_parameter("alpha", 0.33)
	q.material = _rain_mat; _rain.draw_pass_1 = q
	add_child(_rain)
	# drizzle: smaller, slower, denser near the camera
	_drizzle = GPUParticles3D.new(); _drizzle.name = "Drizzle"
	_drizzle.amount = 2600; _drizzle.lifetime = 2.8; _drizzle.local_coords = false; _drizzle.emitting = true; _drizzle.amount_ratio = 0.0
	_drizzle.fixed_fps = 30; _drizzle.interpolate = true; _drizzle.randomness = 0.4
	_drizzle.visibility_aabb = AABB(Vector3(-30.0, -20.0, -30.0), Vector3(60.0, 40.0, 60.0))
	_drizzle.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; _drizzle.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	_drizzle_pm = ParticleProcessMaterial.new()
	_drizzle_pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX; _drizzle_pm.emission_box_extents = Vector3(14.0, 5.0, 14.0)
	_drizzle_pm.direction = Vector3(0.0, -1.0, 0.0); _drizzle_pm.spread = 4.0
	_drizzle_pm.initial_velocity_min = 3.2; _drizzle_pm.initial_velocity_max = 4.8; _drizzle_pm.gravity = Vector3.ZERO
	_drizzle_pm.scale_min = 0.5; _drizzle_pm.scale_max = 1.0
	_drizzle_pm.turbulence_enabled = true; _drizzle_pm.turbulence_noise_strength = 0.6; _drizzle_pm.turbulence_noise_scale = 4.0
	_drizzle_pm.turbulence_influence_min = 0.02; _drizzle_pm.turbulence_influence_max = 0.06
	_drizzle.process_material = _drizzle_pm
	var q2 := QuadMesh.new(); q2.size = Vector2(1.0, 1.0)
	_drizzle_mat = ShaderMaterial.new(); _drizzle_mat.shader = drop_shader
	_drizzle_mat.set_shader_parameter("len", 0.14); _drizzle_mat.set_shader_parameter("width", 0.009); _drizzle_mat.set_shader_parameter("alpha", 0.28)
	q2.material = _drizzle_mat; _drizzle.draw_pass_1 = q2
	add_child(_drizzle)
	# splashes on the ground within 10 m: emission points refreshed from height queries
	_splash = GPUParticles3D.new(); _splash.name = "Splashes"
	_splash.amount = 340; _splash.lifetime = 0.4; _splash.local_coords = false; _splash.emitting = true; _splash.amount_ratio = 0.0
	_splash.fixed_fps = 30; _splash.interpolate = true; _splash.randomness = 0.5
	_splash.visibility_aabb = AABB(Vector3(-40.0, -30.0, -40.0), Vector3(80.0, 60.0, 80.0))
	_splash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; _splash.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	_splash_img = Image.create(128, 1, false, Image.FORMAT_RGBF)
	_splash_tex = ImageTexture.create_from_image(_splash_img)
	_splash_pm = ParticleProcessMaterial.new()
	_splash_pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_POINTS
	_splash_pm.emission_point_texture = _splash_tex; _splash_pm.emission_point_count = 128
	_splash_pm.direction = Vector3.ZERO; _splash_pm.spread = 0.0; _splash_pm.initial_velocity_min = 0.0; _splash_pm.initial_velocity_max = 0.0; _splash_pm.gravity = Vector3.ZERO
	_splash_pm.scale_min = 0.6; _splash_pm.scale_max = 1.5
	_splash.process_material = _splash_pm
	var pl := PlaneMesh.new(); pl.size = Vector2(0.12, 0.12)
	_splash_mat = ShaderMaterial.new(); _splash_mat.shader = load("res://shaders/rain_splash.gdshader")
	_splash_mat.set_shader_parameter("alpha", 0.5)
	pl.material = _splash_mat; _splash.draw_pass_1 = pl
	add_child(_splash)

func _build_lens() -> void:
	_lens = MeshInstance3D.new(); _lens.name = "LensRain"
	var q := QuadMesh.new(); q.size = Vector2(1.0, 1.0)
	_lens_mat = ShaderMaterial.new(); _lens_mat.shader = load("res://shaders/rain_lens.gdshader")
	q.material = _lens_mat; _lens.mesh = q
	_lens.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
	_lens.extra_cull_margin = 16384.0
	_lens.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; _lens.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	_lens.visible = false
	add_child(_lens)

# ---------------------------------------------------------------- fog volumes
func _on_world_ready() -> void:
	if _placed_fog: return
	_placed_fog = true
	_place_fog_volumes()
	var c: Dictionary = Data.map.get("COLUMN", { "x": 40, "z": -1100 })
	var cx := float(c.get("x", 40)); var cz := float(c.get("z", -1100))
	# the Column's base sits at the ground level of the map edge nearest to it (the terrain ends before it)
	var half := float(Data.map.get("SIZE", 640)) * 0.5
	var gy: float = Game.world.get_height(clampf(cx, -half + 4.0, half - 4.0), clampf(cz, -half + 4.0, half - 4.0)) if Game.world else 0.0
	_column.setup_ground(gy)

## Re-scan the terrain: the World may install a Terrain after the Sky (the verification scenarios do), and the fog
## volumes and the Column's footing are both derived from the ground.
func refresh_terrain() -> void:
	_placed_fog = false
	_on_world_ready()

## Low areas: sample the height on a 16 m grid, take the local minima below the median, size each volume by the
## number of connected cells within ~2 m of the minimum. The marsh POI always gets a wide, low volume.
func _place_fog_volumes() -> void:
	for v in _fog_volumes: v.queue_free()
	_fog_volumes.clear(); _fog_base.clear()
	if Game.world == null: return
	_hollow_mat = FogMaterial.new(); _hollow_mat.density = 0.1; _hollow_mat.albedo = Color(0.84, 0.87, 0.92); _hollow_mat.emission = Color.BLACK
	_hollow_mat.height_falloff = 1.8; _hollow_mat.edge_fade = 0.3
	_marsh_mat = FogMaterial.new(); _marsh_mat.density = 0.08; _marsh_mat.albedo = Color(0.82, 0.86, 0.9); _marsh_mat.emission = Color.BLACK
	_marsh_mat.height_falloff = 2.2; _marsh_mat.edge_fade = 0.25
	var size := float(Data.map.get("SIZE", 640)); var half := size * 0.5
	var step := 16.0; var n := int(size / step) + 1
	var hs := PackedFloat32Array(); hs.resize(n * n)
	for j in n:
		for i in n:
			hs[j * n + i] = Game.world.get_height(-half + i * step, -half + j * step)
	var sorted := hs.duplicate(); sorted.sort()
	var median := sorted[n * n / 2]
	_ground_median = median
	_ground_low = sorted[n * n * 12 / 100]
	var spread := sorted[n * n * 95 / 100] - sorted[n * n * 5 / 100]
	var mins: Array = []
	if spread > 0.8:
		for j in range(1, n - 1):
			for i in range(1, n - 1):
				var h := hs[j * n + i]
				if h > median - 0.8: continue
				var ok := true
				for dj in [-1, 0, 1]:
					for di in [-1, 0, 1]:
						if (di != 0 or dj != 0) and hs[(j + dj) * n + i + di] < h: ok = false
				if not ok: continue
				# extent: cells within 4 steps that are no more than 2.2 m above the minimum
				var count := 0
				for dj in range(-4, 5):
					for di in range(-4, 5):
						var jj := j + dj; var ii := i + di
						if jj < 0 or ii < 0 or jj >= n or ii >= n: continue
						if hs[jj * n + ii] < h + 2.2: count += 1
				mins.append({ "x": -half + i * step, "z": -half + j * step, "h": h, "count": count, "depth": median - h })
		mins.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["depth"] * sqrt(a["count"]) > b["depth"] * sqrt(b["count"]))
		var kept: Array = []
		for m in mins:
			var near := false
			for k in kept:
				if Vector2(m["x"] - k["x"], m["z"] - k["z"]).length() < 48.0: near = true; break
			if not near: kept.append(m)
			if kept.size() >= 22: break
		for m in kept:
			var w := clampf(sqrt(float(m["count"])) * step * 1.15, 28.0, 130.0)
			var v := FogVolume.new(); v.shape = RenderingServer.FOG_VOLUME_SHAPE_ELLIPSOID
			v.size = Vector3(w, 5.0 + float(m["depth"]) * 0.6, w)
			v.position = Vector3(float(m["x"]), float(m["h"]) + 1.2, float(m["z"]))
			v.material = _hollow_mat
			add_child(v); _fog_volumes.append(v); _fog_base.append(clampf(0.5 + float(m["depth"]) * 0.18, 0.5, 1.5))
	# the marsh
	var marsh: Dictionary = Game.world.poi("marsh") if Game.world.has_method("poi") else {}
	if not marsh.is_empty():
		var r := float(marsh.get("r", 90.0))
		var mx := float(marsh.get("x", 0.0)); var mz := float(marsh.get("z", 0.0))
		var my: float = Game.world.get_height(mx, mz)
		var v := FogVolume.new(); v.shape = RenderingServer.FOG_VOLUME_SHAPE_BOX
		v.size = Vector3(r * 2.2, 7.0, r * 2.2); v.position = Vector3(mx, my + 1.5, mz); v.material = _marsh_mat
		add_child(v); _fog_volumes.append(v); _fog_base.append(-1.0)   # -1: marsh material
	print("[sky] fog volumes: %d (median ground %.1f m, spread %.1f m)" % [_fog_volumes.size(), median, spread])

# ---------------------------------------------------------------- tide
func _on_tide_rising() -> void:
	_tide_phase = "rising"; _tide_t = 0.0
func _on_tide(_level: int) -> void:
	if _tide_phase != "white": _tide_phase = "white"; _tide_t = 0.0
func _update_tide(dt: float) -> void:
	var tide_s: float = Clock.tide_in()
	var pre := clampf(1.0 - tide_s / 600.0, 0.0, 1.0) if tide_s > 0.0 else 1.0
	match _tide_phase:
		"idle":
			tide = pre * pre * 0.45
			sick = pre
		"rising":
			_tide_t += dt / 6.0
			var v := smoothstep(0.0, 1.0, _tide_t)
			tide = 0.45 + v * 0.55; sick = 1.0
			if _tide_t >= 1.0: _tide_phase = "white"; _tide_t = 0.0
		"white":
			_tide_t += dt / 4.0
			tide = 1.0 - smoothstep(0.0, 1.0, _tide_t); sick = 1.0 - _tide_t
			if _tide_t >= 1.0: _tide_phase = "idle"; tide = 0.0; sick = 0.0

# ---------------------------------------------------------------- per frame
func _process(dt: float) -> void:
	_update(dt)

func _key(hour: float) -> Dictionary:
	var i := 0
	while i < KEYS.size() - 2 and float(KEYS[i + 1][0]) <= hour: i += 1
	var a: Array = KEYS[i]; var b: Array = KEYS[i + 1]
	var t := smoothstep(float(a[0]), float(b[0]), hour)
	return { "energy": lerpf(float(a[1]), float(b[1]), t), "color": (a[2] as Color).lerp(b[2], t), "exposure": lerpf(float(a[3]), float(b[3]), t), "tint": (a[4] as Color).lerp(b[4], t) }

## Sun direction: azimuth from Clock.sun_angle() (rises east, noon to the north, sets west), elevation on a curve
## that puts sunrise at ~05:15 and sunset at ~19:45: the design's 05:30 dawn and 19:30 dusk are the golden minutes.
func compute_sun_dir(hour: float) -> Vector3:
	var a := ((hour - 6.0) / 24.0) * TAU
	var p := (hour - 12.5) / 24.0 * TAU
	var elev := cos(p) * 0.62 + 0.196
	var horiz := sqrt(maxf(0.0, 1.0 - elev * elev))
	var az := Vector2(cos(a), -0.42).normalized()
	return Vector3(az.x * horiz, elev, az.y * horiz).normalized()
func compute_moon_dir(hour: float) -> Vector3:
	var a := ((hour - 6.0) / 24.0) * TAU
	var p := (hour - 0.5) / 24.0 * TAU
	var elev := cos(p) * 0.5 + 0.12
	var horiz := sqrt(maxf(0.0, 1.0 - elev * elev))
	var az := Vector2(-cos(a) * 0.8, 0.55).normalized()
	return Vector3(az.x * horiz, elev, az.y * horiz).normalized()

func _airmass(c: float) -> float:
	var cc := maxf(c, 0.0)
	var zdeg := rad_to_deg(acos(clampf(cc, 0.0, 1.0)))
	return 1.0 / (cc + 0.15 * pow(maxf(93.885 - zdeg, 0.5), -1.253))
## The sky shader's single-scattering model, on the CPU, so the fog colour matches the sky exactly.
func _mie_beta(haze: float) -> float: return BETA_M * (0.15 + 1.2 * haze)
func _atmo(d: Vector3, s: Vector3, e: Color, haze: float) -> Color:
	var bM := _mie_beta(haze)
	var am_v := _airmass(d.y)
	var am_s := _airmass(s.y)
	var up := smoothstep(-0.12, 0.05, s.y)
	var mu := d.dot(s)
	var phase_r := 3.0 / (16.0 * PI) * (1.0 + mu * mu)
	var g := 0.76
	var hg := 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5))
	var phase_m := hg * 0.8 + 0.2 / (4.0 * PI)
	var tau_m := bM * 1200.0 * minf(am_v, 12.0)
	var out := Color.BLACK
	for ch in 3:
		var br := BETA_R[ch]
		var tau_r := br * 8000.0 * am_v
		var tau_s := (br * 8000.0 + bM * 1200.0) * am_s * 0.5
		var t_s := exp(-tau_s) * up
		out[ch] = e[ch] * t_s * (phase_r * (1.0 - exp(-tau_r)) + phase_m * (1.0 - exp(-tau_m))) * 4.0 * PI
	return out
func _sun_t(s: Vector3, haze: float, scale: float = 1.0) -> Color:
	var bM := _mie_beta(haze); var am := _airmass(s.y) * scale
	return Color(exp(-(BETA_R.x * 8000.0 + bM * 1200.0) * am), exp(-(BETA_R.y * 8000.0 + bM * 1200.0) * am), exp(-(BETA_R.z * 8000.0 + bM * 1200.0) * am))

func _update(dt: float) -> void:
	var hour: float = Clock.hour
	var night: float = Clock.night()
	var k := _key(hour)
	var P: Dictionary = _weather.params
	var coverage := float(P.get("coverage", 0.85)); var dark := float(P.get("dark", 0.1)); var soft := float(P.get("soft", 0.3))
	var haze := float(P.get("haze", 0.45)); var storm := float(P.get("storm", 0.0))
	fog_level = float(P.get("fog", 0.0)); rain = float(P.get("rain", 0.0))
	wind = _weather.wind; lightning = _weather.lightning
	_update_tide(dt)
	sun_dir = compute_sun_dir(hour); moon_dir = compute_moon_dir(hour)
	moon_phase = fmod(0.42 + float(Clock.day) * 0.055, 1.0)
	var t: float = Game.elapsed
	_cloud_travel += wind * dt * 2.6
	_cloud_travel = Vector2(fposmod(_cloud_travel.x, 262144.0), fposmod(_cloud_travel.y, 262144.0))
	# ---- sun
	sun_energy_clear = float(k["energy"])
	var sun_factor := float(P.get("sun", 0.4))
	sun_color = k["color"]
	var elev_fade := smoothstep(-0.005, 0.06, sun_dir.y)   # the light goes out as the disc sets; the sky keeps glowing
	var e := sun_energy_clear * elev_fade * sun_factor * (1.0 - sick * 0.55) * (1.0 - tide)
	sun_energy = e
	sun.light_energy = e
	sun.light_color = sun_color
	if sun_dir.y > -0.2: sun.global_transform = Transform3D(Basis.looking_at(-sun_dir, Vector3.UP), Vector3.ZERO)
	sun.shadow_enabled = e > 0.02
	sun.light_angular_distance = 0.5 + coverage * 2.5 + dark * 1.5
	sun.shadow_blur = 1.0 + coverage * 0.8
	sun.light_volumetric_fog_energy = 1.0 + storm * 0.3
	# ---- moon
	var moon_up := smoothstep(-0.05, 0.12, moon_dir.y)
	var phase_f := sin(moon_phase * PI)
	var me := night * moon_up * (0.03 + 0.11 * phase_f) * (1.0 - coverage * 0.75) * (1.0 - dark * 0.5) * (1.0 - tide)
	moon.light_energy = me
	if moon_dir.y > -0.2: moon.global_transform = Transform3D(Basis.looking_at(-moon_dir, Vector3.UP), Vector3.ZERO)
	moon.shadow_enabled = (not sun.shadow_enabled) and me > 0.015
	# ---- lightning light
	if lightning > 0.01:
		flash.visible = true; flash.light_energy = lightning * 2.4
		var ld: Vector3 = _weather.lightning_dir
		flash.global_transform = Transform3D(Basis.looking_at(-ld, Vector3.UP), Vector3.ZERO)
	else:
		flash.visible = false; flash.light_energy = 0.0
	# ---- exposure and tint keys
	var tint: Color = k["tint"]
	exposure = float(k["exposure"]) * (1.0 + fog_level * 0.25) * (1.0 - dark * 0.05)
	environment.tonemap_exposure = exposure
	# ---- horizon colour (fog) from the same atmosphere model as the sky
	var sun_rad := sun_color * sun_energy_clear
	var sun_t := _sun_t(sun_dir, haze, 0.55)
	var side90 := Vector3(-sun_dir.z, 0.0, sun_dir.x).normalized()
	var amb := _atmo(Vector3(0.0, 0.55, 0.0), sun_dir, sun_rad, haze) * 0.6 + _atmo(Vector3(side90.x, 0.10, side90.z).normalized(), sun_dir, sun_rad, haze) * 0.4
	amb += Color(0.010, 0.014, 0.026) * night
	var sun_up := smoothstep(-0.10, 0.05, sun_dir.y)
	var direct := sun_t * sun_energy_clear * sun_up
	# the belly of the deck, at the shader's typical optical depth: direct light through the cloud plus ambient
	var lid := (direct * 0.30 * (1.0 - dark * 0.55) + amb * 1.05) * (1.0 - dark * 0.45) * 0.93
	# clear horizon: 70 degrees off the sun azimuth (what most of the horizon looks like). The shader dissolves the
	# lid into this same colour near the horizon, so the fog matches whatever the sky does there.
	var side := Vector3(sun_dir.x, 0.0, sun_dir.z).normalized().rotated(Vector3.UP, 1.2)
	var clear_h := _atmo(Vector3(side.x, 0.04, side.z).normalized(), sun_dir, sun_rad, haze) + Color(0.010, 0.014, 0.026) * night
	var lid_w := clampf(coverage * (0.50 + 0.45 * dark), 0.0, 0.95)
	horizon_color = clear_h.lerp(lid, lid_w)
	# fog weather: the fog itself is a luminous grey lit by the whole sky, never the dark horizon colour
	if fog_level > 0.001:
		var day01 := clampf(sun_energy_clear / 1.4, 0.0, 1.0)
		var lit_fog := Color(0.56, 0.585, 0.62) * (0.030 + 0.95 * day01) + Color(0.014, 0.018, 0.032) * night
		horizon_color = horizon_color.lerp(lit_fog, fog_level * 0.8)
	var horizon_raw := horizon_color
	horizon_color = horizon_color * tint
	var hl := horizon_color.get_luminance()
	horizon_color = horizon_color.lerp(Color(hl * 0.95, hl * 0.88, hl * 0.62), sick * 0.55)
	horizon_color = horizon_color.lerp(Color.WHITE, tide)
	# ---- sky shader
	sky_mat.set_shader_parameter("sun_dir", sun_dir)
	sky_mat.set_shader_parameter("sun_color", sun_color)
	sky_mat.set_shader_parameter("sun_energy", sun_energy_clear)
	sky_mat.set_shader_parameter("moon_dir", moon_dir)
	sky_mat.set_shader_parameter("moon_phase", moon_phase)
	sky_mat.set_shader_parameter("moon_energy", night * (0.5 + 0.5 * phase_f))
	sky_mat.set_shader_parameter("night", night)
	sky_mat.set_shader_parameter("coverage", coverage)
	sky_mat.set_shader_parameter("cloud_dark", dark)
	sky_mat.set_shader_parameter("cloud_soft", soft)
	sky_mat.set_shader_parameter("haze", haze)
	sky_mat.set_shader_parameter("fog_level", fog_level)
	sky_mat.set_shader_parameter("fog_color", horizon_color * (1.0 + fog_level * 0.45))
	sky_mat.set_shader_parameter("horizon_col", Vector3(horizon_raw.r, horizon_raw.g, horizon_raw.b))
	sky_mat.set_shader_parameter("cloud_travel", _cloud_travel)
	sky_mat.set_shader_parameter("scud", float(P.get("scud", 0.0)))
	sky_mat.set_shader_parameter("rain_amount", rain)
	var wd := wind.normalized() if wind.length() > 0.01 else Vector2(1.0, 0.0)
	sky_mat.set_shader_parameter("wind_dir_x", wd.x)
	sky_mat.set_shader_parameter("wind_dir_z", wd.y)
	sky_mat.set_shader_parameter("storm", storm)
	sky_mat.set_shader_parameter("lightning", lightning)
	sky_mat.set_shader_parameter("bolt", 1.0 if _weather.bolt > 0.0 else 0.0)
	sky_mat.set_shader_parameter("lightning_dir", _weather.lightning_dir)
	sky_mat.set_shader_parameter("tide", tide)
	sky_mat.set_shader_parameter("sick", sick)
	sky_mat.set_shader_parameter("art_tint", tint)
	sky_mat.set_shader_parameter("time", t)
	# ---- fog and volumetrics
	var dawn := clampf(1.0 - absf(hour - 6.0) / 2.5, 0.0, 1.0)
	environment.fog_light_color = horizon_color * (1.0 + fog_level * 0.45)
	environment.fog_density = float(P.get("dist", 0.002)) * (1.0 + night * 0.35 + dawn * 0.3)
	environment.fog_sky_affect = float(P.get("sky_affect", 0.35))
	environment.fog_sun_scatter = 0.35 * (1.0 - coverage * 0.7) * sun_up
	# height fog is a layer lying on the low ground (Godot fogs fragments below fog_height): the marsh, the river
	# and the hollows sit in it, the plain and the ridge stand out of it. It thickens at dawn, at night and in fog.
	environment.fog_height = _ground_low + 3.0 + dawn * 3.5 + night * 1.5 + fog_level * 16.0 + rain * 1.0
	environment.fog_height_density = 0.055 + dawn * 0.10 + night * 0.035 + fog_level * 0.32 + rain * 0.035
	environment.fog_aerial_perspective = 0.55 - fog_level * 0.3
	var vol := float(P.get("vol", 0.011)) * (1.0 + night * 0.45 + dawn * 0.35)
	environment.volumetric_fog_density = vol * (1.0 - tide * 0.5)
	environment.volumetric_fog_albedo = VOL_ALBEDO.lerp(Color(0.8, 0.78, 0.6), sick * 0.5)
	environment.volumetric_fog_anisotropy = 0.5 + 0.2 * (1.0 - coverage) + storm * 0.1
	environment.volumetric_fog_sky_affect = 0.4 + fog_level * 0.5
	environment.ambient_light_energy = float(P.get("ambient", 1.0)) * (1.0 + lightning * 1.5)
	environment.glow_intensity = 0.32 + night * 0.12 + fog_level * 0.08
	# ---- fog volumes: ground mist at dawn, at night, in fog weather
	if _fog_volumes.size() > 0:
		var mist := 0.22 + 0.9 * dawn + 0.35 * night + 1.4 * fog_level + 0.25 * rain
		_hollow_mat.density = 0.09 * mist
		_marsh_mat.density = 0.07 * mist
		_hollow_mat.albedo = Color(0.84, 0.87, 0.92).lerp(Color(0.8, 0.8, 0.62), sick * 0.5)
	# ---- precipitation, lens, landmarks
	_update_precipitation(dt)
	var cam := get_viewport().get_camera_3d()
	if cam:
		_lens.global_position = cam.global_position
		# the far landmarks stand 1.5-2.5 km out; a short far plane would slice them
		if cam.far < FAR_PLANE:
			if not _far_warned: _far_warned = true; print("[sky] raising camera far %.0f -> %.0f for the far landmarks" % [cam.far, FAR_PLANE])
			cam.far = FAR_PLANE
	# aerial perspective for the landmarks: extinction per metre, tied to the same distance fog the engine uses,
	# and washed toward the sky colour in their own direction (a little above the horizon in the north) so a
	# kilometres-away mass sits in the haze exactly as the sky behind it does.
	var ap_density := 0.00016 + float(P.get("dist", 0.002)) * 0.17 + fog_level * 0.0012
	var cpos := cam.global_position if cam else Vector3.ZERO
	var cdir := Vector3(_column.base.x - cpos.x, 0.0, _column.base.z - cpos.z)
	cdir = cdir.normalized() if cdir.length() > 1.0 else Vector3(0.0, 0.0, -1.0)
	var lm_dir := Vector3(cdir.x * 0.972, 0.235, cdir.z * 0.972).normalized()
	var lm_clear := _atmo(lm_dir, sun_dir, sun_rad, haze) + Color(0.010, 0.014, 0.026) * night
	var lm_haze := lm_clear.lerp(lid, lid_w) * tint
	var lml := lm_haze.get_luminance()
	lm_haze = lm_haze.lerp(Color(lml * 0.95, lml * 0.88, lml * 0.62), sick * 0.55).lerp(Color.WHITE, tide)
	if fog_level > 0.001: lm_haze = lm_haze.lerp(horizon_color, fog_level * 0.9)
	_column.update(night, lm_haze, sun_dir, tide, lightning, t, sun_energy_clear, exposure, fog_level, sun_color, ap_density)

## The level the ground mist lies on: a little above the lowest twelfth of the map (the marsh, the river, the
## hollows), so the plain and the ridge stand clear of it.
func _ground_level() -> float:
	return _ground_low

func _update_precipitation(dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null: return
	var cp := cam.global_position
	var fall := Vector3(wind.x * 0.42, -9.6, wind.y * 0.42).normalized()
	var fall_slow := Vector3(wind.x * 0.5, -4.0, wind.y * 0.5).normalized()
	var heavy := smoothstep(0.45, 1.0, rain)
	var light := smoothstep(0.02, 0.4, rain) * (1.0 - heavy * 0.6)
	var tint := horizon_color * 1.15 + Color(0.06, 0.06, 0.07)
	tint = tint.lerp(Color.WHITE, lightning)
	# how much specular the sky puts on the drops: bright by day, almost nothing at night
	var bright := clampf(0.18 + horizon_color.get_luminance() * 3.2 + lightning, 0.10, 1.8)
	_rain.amount_ratio = heavy; _rain.emitting = heavy > 0.001
	_drizzle.amount_ratio = light; _drizzle.emitting = light > 0.001
	if heavy > 0.001:
		_rain.global_position = cp + Vector3(-fall.x, 0.0, -fall.z) * 10.0 + Vector3(0.0, 10.0, 0.0)
		_rain_pm.direction = fall
		_rain_mat.set_shader_parameter("fall_dir", fall); _rain_mat.set_shader_parameter("tint", tint)
		_rain_mat.set_shader_parameter("bright", bright)
	if light > 0.001:
		_drizzle.global_position = cp + Vector3(-fall_slow.x, 0.0, -fall_slow.z) * 5.0 + Vector3(0.0, 6.0, 0.0)
		_drizzle_pm.direction = fall_slow
		_drizzle_mat.set_shader_parameter("fall_dir", fall_slow); _drizzle_mat.set_shader_parameter("tint", tint)
		_drizzle_mat.set_shader_parameter("bright", bright)
	# splashes
	var splash_amt := smoothstep(0.1, 1.0, rain)
	_splash.amount_ratio = splash_amt; _splash.emitting = splash_amt > 0.001
	if splash_amt > 0.001:
		_splash_mat.set_shader_parameter("tint", tint)
		_splash_t -= dt
		if _splash_t <= 0.0:
			_splash_t = 0.35
			var w: Node = Game.world
			for i in 128:
				var r := sqrt(_rng.randf()) * 10.0; var a := _rng.randf() * TAU
				var x := cp.x + cos(a) * r; var z := cp.z + sin(a) * r
				var y: float = w.get_height(x, z) if w else cp.y - 1.7
				if w and w.has_method("in_water") and w.in_water(x, z): y = w.water_height(x, z)
				_splash_img.set_pixel(i, 0, Color(x, y + 0.03, z))
			_splash_tex.update(_splash_img)
	# rain on the lens: only when looking up into it
	var look_up := smoothstep(0.0, 0.6, -cam.global_transform.basis.z.y)
	var target := smoothstep(0.05, 0.6, rain) * (0.04 + 0.96 * look_up)
	_lens_amount = lerpf(_lens_amount, target, 1.0 - exp(-dt * 1.5))
	_lens.visible = _lens_amount > 0.01
	if _lens.visible:
		var vs := get_viewport().get_visible_rect().size
		_lens_mat.set_shader_parameter("amount", _lens_amount)
		_lens_mat.set_shader_parameter("t", Game.elapsed)
		_lens_mat.set_shader_parameter("aspect", vs.x / maxf(vs.y, 1.0))
		_lens_mat.set_shader_parameter("tint", tint)
