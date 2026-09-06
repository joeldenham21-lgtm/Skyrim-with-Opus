extends Node3D
## Root: builds the world, wires the player, drives the sky/lighting each frame, and exposes the debug API (Game.debug).
@onready var world_root: Node3D = $World
@onready var entities_root: Node3D = $Entities
@onready var player: CharacterBody3D = $Player
var sky: Node = null
var env: WorldEnvironment = null
var sun: DirectionalLight3D = null

func _ready() -> void:
	Game.player = player
	Game.world = world_root
	_build_environment()
	var terrain_scene := load("res://scenes/world/terrain.tscn") if ResourceLoader.exists("res://scenes/world/terrain.tscn") else null
	if terrain_scene: world_root.add_child(terrain_scene.instantiate())
	else: _placeholder_ground()
	player.global_position = Vector3(0, 8.0, 284)
	Game.set_mode("title")
	var args := OS.get_cmdline_user_args()
	var all_args := OS.get_cmdline_args()
	var idx := all_args.find("--scenario")
	if idx >= 0 and idx + 1 < all_args.size():
		var path: String = all_args[idx + 1]
		if not path.begins_with("res://"): path = "res://" + path
		var scr: Variant = load(path)
		if scr:
			var drv: Node = scr.new(); drv.name = "Scenario"; add_child(drv)

func _build_environment() -> void:
	env = WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	var sky_res := Sky.new(); var sky_mat := PhysicalSkyMaterial.new()
	sky_mat.rayleigh_coefficient = 3.0; sky_mat.mie_coefficient = 0.02; sky_mat.turbidity = 12.0; sky_mat.ground_color = Color(0.32, 0.33, 0.3)
	sky_res.sky_material = sky_mat; e.sky = sky_res
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY; e.ambient_light_sky_contribution = 1.0
	e.tonemap_mode = Environment.TONE_MAPPER_ACES; e.tonemap_exposure = 1.0; e.tonemap_white = 6.0
	e.ssao_enabled = true; e.ssao_radius = 1.5; e.ssao_intensity = 2.0
	e.ssil_enabled = false
	e.sdfgi_enabled = true; e.sdfgi_cascades = 4; e.sdfgi_min_cell_size = 0.3
	e.glow_enabled = true; e.glow_intensity = 0.35; e.glow_bloom = 0.05; e.glow_hdr_threshold = 1.2; e.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	e.volumetric_fog_enabled = true; e.volumetric_fog_density = 0.012; e.volumetric_fog_albedo = Color(0.75, 0.78, 0.8); e.volumetric_fog_length = 96.0; e.volumetric_fog_anisotropy = 0.55
	e.fog_enabled = true; e.fog_light_color = Color(0.58, 0.6, 0.62); e.fog_density = 0.0015; e.fog_sky_affect = 0.4; e.fog_height = -2.0; e.fog_height_density = 0.15
	e.adjustment_enabled = true; e.adjustment_saturation = 0.78; e.adjustment_contrast = 1.05
	env.environment = e
	add_child(env)
	sun = DirectionalLight3D.new()
	sun.light_energy = 1.2; sun.light_color = Color(1.0, 0.95, 0.9); sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS; sun.directional_shadow_max_distance = 220.0; sun.directional_shadow_split_1 = 0.08; sun.directional_shadow_split_2 = 0.2; sun.directional_shadow_split_3 = 0.5; sun.shadow_bias = 0.03; sun.shadow_normal_bias = 1.5
	sun.light_volumetric_fog_energy = 1.0
	add_child(sun)

func _placeholder_ground() -> void:
	var m := MeshInstance3D.new(); var pm := PlaneMesh.new(); pm.size = Vector2(640, 640); m.mesh = pm; m.position.y = 5.5
	var mat := StandardMaterial3D.new(); mat.albedo_color = Color(0.33, 0.32, 0.2); mat.roughness = 1.0; m.material_override = mat
	var body := StaticBody3D.new(); var shape := CollisionShape3D.new(); var box := BoxShape3D.new(); box.size = Vector3(640, 1, 640); shape.shape = box; shape.position.y = 5.0; body.add_child(shape)
	world_root.add_child(m); world_root.add_child(body)

func _process(_dt: float) -> void:
	# sun from the clock; the sky module (when present) refines colours
	var d := Clock.sun_dir()
	sun.global_transform = Transform3D(Basis.looking_at(-d, Vector3.UP), Vector3.ZERO)
	var elev := clampf(d.y * 3.0 + 0.2, 0.0, 1.0)
	sun.light_energy = 1.3 * elev
	var night := Clock.night()
	env.environment.volumetric_fog_density = 0.010 + night * 0.006
