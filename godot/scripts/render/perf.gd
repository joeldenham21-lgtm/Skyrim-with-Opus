extends Node
## Perf — quality presets, the dynamic-resolution governor (FSR2) and the frame budget.
## Autoloaded as "Perf". It owns the *toggles* (which expensive features are allowed) and the render scale;
## other systems own their own values and must ask Perf for permission and for density multipliers:
##   Perf.allow_volumetric_fog / allow_sdfgi / allow_ssao / allow_ssil / allow_ssr / allow_glow
##   Perf.flora_density, Perf.clutter_density, Perf.particle_scale, Perf.shadow_distance, Perf.view_distance
##   Perf.decal_budget, Perf.light_budget, Perf.entity_budget
## Presets: "low", "medium", "high", "ultra", "mobile" (auto-picked at boot, overridable in settings).
signal preset_changed(name: String)

const PRESETS := {
	"mobile": {
		"scale": 0.62, "scale_min": 0.5, "scale_max": 0.8, "msaa": 0, "taa": false, "fsr2": false, "shadow_size": 2048,
		"shadow_distance": 90.0, "splits": 2, "soft_shadows": 0, "sdfgi": false, "ssao": false, "ssil": false, "ssr": false,
		"glow": true, "vfog": false, "vfog_length": 0.0, "view_distance": 700.0, "flora": 0.35, "clutter": 0.4,
		"particles": 0.4, "decals": 32, "lights": 12, "entities": 8, "lod_threshold": 4.0, "aniso": 4,
	},
	"low": {
		"scale": 0.67, "scale_min": 0.5, "scale_max": 0.85, "msaa": 0, "taa": false, "fsr2": true, "shadow_size": 2048,
		"shadow_distance": 110.0, "splits": 2, "soft_shadows": 0, "sdfgi": false, "ssao": false, "ssil": false, "ssr": false,
		"glow": true, "vfog": false, "vfog_length": 0.0, "view_distance": 900.0, "flora": 0.5, "clutter": 0.55,
		"particles": 0.5, "decals": 48, "lights": 16, "entities": 12, "lod_threshold": 3.0, "aniso": 4,
	},
	"medium": {
		"scale": 0.72, "scale_min": 0.58, "scale_max": 1.0, "msaa": 0, "taa": true, "fsr2": true, "shadow_size": 4096,
		"shadow_distance": 160.0, "splits": 4, "soft_shadows": 1, "sdfgi": false, "ssao": true, "ssil": false, "ssr": false,
		"glow": true, "vfog": true, "vfog_length": 64.0, "view_distance": 1400.0, "flora": 0.75, "clutter": 0.8,
		"particles": 0.75, "decals": 96, "lights": 24, "entities": 18, "lod_threshold": 2.0, "aniso": 8,
	},
	"high": {
		"scale": 0.77, "scale_min": 0.6, "scale_max": 1.0, "msaa": 0, "taa": true, "fsr2": true, "shadow_size": 4096,
		"shadow_distance": 220.0, "splits": 4, "soft_shadows": 2, "sdfgi": true, "ssao": true, "ssil": false, "ssr": true,
		"glow": true, "vfog": true, "vfog_length": 96.0, "view_distance": 2000.0, "flora": 1.0, "clutter": 1.0,
		"particles": 1.0, "decals": 128, "lights": 32, "entities": 24, "lod_threshold": 1.0, "aniso": 16,
	},
	"ultra": {
		"scale": 1.0, "scale_min": 0.75, "scale_max": 1.0, "msaa": 0, "taa": true, "fsr2": true, "shadow_size": 8192,
		"shadow_distance": 300.0, "splits": 4, "soft_shadows": 3, "sdfgi": true, "ssao": true, "ssil": true, "ssr": true,
		"glow": true, "vfog": true, "vfog_length": 128.0, "view_distance": 2600.0, "flora": 1.25, "clutter": 1.2,
		"particles": 1.25, "decals": 192, "lights": 48, "entities": 32, "lod_threshold": 1.0, "aniso": 16,
	},
}

var preset := "high"
var dynamic := true
var target_fps := 100.0
var scale_now := 0.77
var scale_min := 0.6
var scale_max := 1.0
# permissions read by the other systems
var allow_sdfgi := true
var allow_ssao := true
var allow_ssil := false
var allow_ssr := true
var allow_glow := true
var allow_volumetric_fog := true
var volumetric_fog_length := 96.0
var flora_density := 1.0
var clutter_density := 1.0
var particle_scale := 1.0
var shadow_distance := 220.0
var view_distance := 2000.0
var decal_budget := 128
var light_budget := 32
var entity_budget := 24
var lod_threshold := 1.0
# governor state
var _frame_ms := 10.0
var _cool := 0.0
var _hitch := 0.0
var _sun: DirectionalLight3D = null

func _ready() -> void:
	process_priority = 100
	var s: Dictionary = Game.state.get("settings", {})
	preset = String(s.get("quality", ""))
	if preset == "" or not PRESETS.has(preset): preset = auto_preset()
	target_fps = float(s.get("targetFps", 100))
	dynamic = bool(s.get("dynamicResolution", true))
	apply_preset(preset)
	Events.world_ready.connect(_on_world_ready)

func auto_preset() -> String:
	if OS.has_feature("mobile") or OS.get_name() in ["Android", "iOS"]: return "mobile"
	var gpu := RenderingServer.get_video_adapter_name().to_lower()
	var vram := float(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED)) / 1048576.0
	if gpu.find("llvmpipe") >= 0 or gpu.find("lavapipe") >= 0 or gpu.find("swiftshader") >= 0: return "low"
	for tag in ["rtx 40", "rtx 50", "rtx 30", "rx 7", "rx 6", "arc a"]:
		if gpu.find(tag) >= 0: return "high"
	for tag in ["gtx 16", "gtx 10", "rx 5", "iris", "radeon graphics", "uhd"]:
		if gpu.find(tag) >= 0: return "medium"
	return "high" if vram > 0.0 else "medium"

func apply_preset(name: String) -> void:
	if not PRESETS.has(name): return
	preset = name
	var p: Dictionary = PRESETS[name]
	scale_min = float(p["scale_min"]); scale_max = float(p["scale_max"]); scale_now = float(p["scale"])
	allow_sdfgi = bool(p["sdfgi"]); allow_ssao = bool(p["ssao"]); allow_ssil = bool(p["ssil"]); allow_ssr = bool(p["ssr"])
	allow_glow = bool(p["glow"]); allow_volumetric_fog = bool(p["vfog"]); volumetric_fog_length = float(p["vfog_length"])
	flora_density = float(p["flora"]); clutter_density = float(p["clutter"]); particle_scale = float(p["particles"])
	shadow_distance = float(p["shadow_distance"]); view_distance = float(p["view_distance"])
	decal_budget = int(p["decals"]); light_budget = int(p["lights"]); entity_budget = int(p["entities"])
	lod_threshold = float(p["lod_threshold"])
	var vp := get_viewport()
	if vp:
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR2 if bool(p["fsr2"]) else Viewport.SCALING_3D_MODE_BILINEAR
		vp.scaling_3d_scale = scale_now
		vp.msaa_3d = int(p["msaa"]) as Viewport.MSAA
		# FSR2 supplies its own temporal pass; TAA on top is rejected by the engine.
		vp.use_taa = bool(p["taa"]) and not bool(p["fsr2"])
		vp.mesh_lod_threshold = lod_threshold
		vp.positional_shadow_atlas_size = int(p["shadow_size"])
	ProjectSettings.set_setting("rendering/textures/default_filters/anisotropic_filtering_level", int(p["aniso"]))
	RenderingServer.directional_soft_shadow_filter_set_quality(int(p["soft_shadows"]) as RenderingServer.ShadowQuality)
	RenderingServer.positional_soft_shadow_filter_set_quality(int(p["soft_shadows"]) as RenderingServer.ShadowQuality)
	Game.state["settings"]["quality"] = preset
	_apply_to_world()
	Events.quality_changed.emit(preset)
	preset_changed.emit(preset)

func _on_world_ready() -> void: _apply_to_world()

## Toggle the expensive environment features the preset forbids. Values (densities, colours, energies) stay with
## whoever owns them (the Sky module); Perf only switches features off and clamps distances.
func _apply_to_world() -> void:
	var env := _environment()
	if env:
		if not allow_sdfgi: env.sdfgi_enabled = false
		if not allow_ssao: env.ssao_enabled = false
		if not allow_ssil: env.ssil_enabled = false
		if not allow_ssr: env.ssr_enabled = false
		if not allow_glow: env.glow_enabled = false
		if not allow_volumetric_fog: env.volumetric_fog_enabled = false
		elif env.volumetric_fog_enabled: env.volumetric_fog_length = minf(env.volumetric_fog_length, volumetric_fog_length)
	_sun = _find_sun()
	if _sun:
		_sun.directional_shadow_max_distance = shadow_distance
		var p: Dictionary = PRESETS[preset]
		_sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if int(p["splits"]) == 4 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	var cam := _camera()
	if cam: cam.far = maxf(cam.far, view_distance)

func _environment() -> Environment:
	var w := get_viewport().world_3d if get_viewport() else null
	if w and w.environment: return w.environment
	for n in get_tree().get_nodes_in_group("world_environment"):
		if n is WorldEnvironment: return (n as WorldEnvironment).environment
	var found: Array = get_tree().get_nodes_in_group("_we")
	if found.size() > 0 and found[0] is WorldEnvironment: return found[0].environment
	var root := get_tree().current_scene
	if root:
		for c in root.find_children("*", "WorldEnvironment", true, false): return (c as WorldEnvironment).environment
	return null

func _find_sun() -> DirectionalLight3D:
	var root := get_tree().current_scene
	if root == null: return null
	for c in root.find_children("*", "DirectionalLight3D", true, false):
		if (c as DirectionalLight3D).light_energy > 0.0 or c.name == "Sun": return c
	return null

func _camera() -> Camera3D:
	return get_viewport().get_camera_3d() if get_viewport() else null

func _process(dt: float) -> void:
	var ms := 1000.0 / maxf(1.0, Engine.get_frames_per_second())
	_frame_ms = lerpf(_frame_ms, ms, 0.08)
	if ms > _frame_ms * 2.5 and ms > 30.0: _hitch += 1.0
	if not dynamic or Game.mode != "playing": return
	_cool -= dt
	if _cool > 0.0: return
	var target_ms := 1000.0 / maxf(30.0, target_fps)
	var vp := get_viewport()
	if vp == null: return
	var want := scale_now
	if _frame_ms > target_ms * 1.06: want = scale_now - (0.03 if _frame_ms < target_ms * 1.3 else 0.06)
	elif _frame_ms < target_ms * 0.88: want = scale_now + 0.02
	want = clampf(want, scale_min, scale_max)
	if absf(want - scale_now) > 0.001:
		scale_now = want
		vp.scaling_3d_scale = scale_now
		Events.render_scale.emit(scale_now)
		_cool = 0.5
	else: _cool = 0.25

func stats() -> Dictionary:
	return {
		"fps": Engine.get_frames_per_second(), "frame_ms": snappedf(_frame_ms, 0.01), "scale": snappedf(scale_now, 0.001),
		"preset": preset, "hitches": int(_hitch),
		"draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
		"vram_mb": snappedf(float(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED)) / 1048576.0, 0.1),
	}

func set_dynamic(on: bool) -> void:
	dynamic = on; Game.state["settings"]["dynamicResolution"] = on
	if not on:
		scale_now = float(PRESETS[preset]["scale"]); get_viewport().scaling_3d_scale = scale_now
func set_target_fps(v: float) -> void:
	target_fps = clampf(v, 30.0, 240.0); Game.state["settings"]["targetFps"] = int(target_fps)
