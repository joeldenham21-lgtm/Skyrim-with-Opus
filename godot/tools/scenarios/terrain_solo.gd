extends "res://tools/scenarios/_driver.gd"
## Terrain look check in isolation: drops the Sky scene and installs a plain, known-good overcast environment so the
## ground reads on its own (the Sky agent's exposure/fog is still in flux). Not the integration test — that is
## tools/scenarios/terrain.gd — this is for judging albedo, tiling, blends and the water surface.
var t: Node = null

func _neutral_env() -> void:
	var sky_node: Node = Game.world.get_node_or_null("Sky")
	if sky_node:
		Game.world.remove_child(sky_node)
		sky_node.queue_free()
		Game.world.sky = null
	for c in Game.world.get_parent().get_children():
		if c is WorldEnvironment or c is DirectionalLight3D: c.queue_free()
	var we := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	var sk := Sky.new()
	var pm := ProceduralSkyMaterial.new()
	pm.sky_top_color = Color(0.42, 0.46, 0.52)
	pm.sky_horizon_color = Color(0.62, 0.63, 0.63)
	pm.ground_bottom_color = Color(0.24, 0.24, 0.22)
	pm.ground_horizon_color = Color(0.5, 0.5, 0.48)
	pm.sun_angle_max = 12.0
	pm.energy_multiplier = 1.0
	sk.sky_material = pm
	e.sky = sk
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.ambient_light_sky_contribution = 1.0
	e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	e.tonemap_exposure = 1.0
	e.tonemap_white = 6.0
	e.ssao_enabled = true
	e.ssao_radius = 1.2
	e.ssao_intensity = 1.6
	e.fog_enabled = true
	e.fog_mode = Environment.FOG_MODE_DEPTH
	e.fog_light_color = Color(0.60, 0.62, 0.63)
	e.fog_density = 0.0016
	e.fog_sky_affect = 0.2
	e.adjustment_enabled = true
	e.adjustment_saturation = 0.9
	e.adjustment_contrast = 1.06
	we.environment = e
	Game.world.get_parent().add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 1.6
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 260.0
	sun.shadow_normal_bias = 1.5
	sun.rotation_degrees = Vector3(-38.0, 145.0, 0.0)
	Game.world.get_parent().add_child(sun)

func _view(name: String, x: float, z: float, eye: float, tx: float, tz: float, pitch_deg: float = -4.0) -> void:
	## stand at (x, z) with the eye `eye` m above the ground and look toward (tx, tz).
	var y: float = Game.world.get_height(x, z) + eye
	Game.player.teleport(x, z, y - 0.1)
	var yaw := atan2(-(tx - x), -(tz - z))
	Game.player.set_look(yaw, deg_to_rad(pitch_deg))
	Game.player.lock_movement(true)
	await frames(6)
	await shot(name)
	var s := stats()
	print("[stats] %-18s draws %5d prims %8d pos %s" % [name, s.draw_calls, s.primitives, s.pos])

func run() -> void:
	await start()
	_neutral_env()
	await frames(10)
	t = Game.world.get_node_or_null("Terrain")
	if t and t.has_method("info"): print("[terrain] ", t.info())
	var w: Node = Game.world.get_node_or_null("Water")
	if w and w.has_method("info"): print("[water] ", w.info())
	set_hour(12.0)
	#            name                 from x     z   eye   look at x     z   pitch
	await _view("solo-ground-1m",        20,   250,  1.0,        22,   246, -40.0)
	await _view("solo-vanno-north",       0,   300,  1.7,         0,     0,  -2.0)
	await _view("solo-road-north",       14,   150,  1.7,        -5,  -140,  -1.0)
	await _view("solo-marsh",           -18,   118,  1.7,       -60,   165,  -3.0)
	await _view("solo-river",           -95,   -20,  1.7,       -70,    69,  -6.0)
	await _view("solo-bridge",          -60,    30,  1.7,       -78,   100,  -3.0)
	await _view("solo-escarpment",       10,  -250,  1.7,        10,  -330,   6.0)
	await _view("solo-cliff-edge",        0,  -318,  1.9,         0,  -100,  -7.0)
	await _view("solo-quarry",          345,   125,  1.8,       460,   135, -10.0)
	await _view("solo-lake",           -378,   200,  1.7,      -470,   220,  -2.0)
	await _view("solo-mast",            445,  -255,  2.0,        50,  -230,  -2.0)
	await _view("solo-dam",            -215,  -400,  2.0,      -245,  -448,  -5.0)
	await _view("solo-rail",            -60,  -150,  1.7,       200,  -175,  -2.0)
	await _view("solo-water-edge",      -55,   132,  1.5,       -75,   170, -12.0)
	await _view("solo-water-river",     -74,    50,  1.6,       -72,    80, -10.0)
	await _view("solo-underwater",      430,   130,  1.2,       470,   135,  -4.0)
	if w and w.has_method("info"): print("[water] ", w.info())
