extends "res://tools/scenarios/_driver.gd"
## Sky, weather and lighting verification.
## Shots from the Vanno start looking north, from the church hill, over the marsh, along a low sun for shadow
## quality, and at the Column and the Pechorsk Anomaly, at the design's hours and per weather.
## SKY_SET=quick shoots a representative subset (iteration); unset shoots the whole plan.
## If the terrain agent's scenes/world/terrain.tscn does not exist yet, tools/scenarios/sky_terrain.gd stands in so
## there is real relief under the sky.
const HOURS := [5.5, 7.0, 12.0, 16.0, 19.5, 21.0, 23.5, 3.0]

var sky: Node = null
var start_x := 0.0
var start_z := 284.0

func setw(weather: String, hour: float, torch_on: bool = false) -> void:
	if sky: sky.set_weather(weather, 0.0)
	set_hour(hour); torch(torch_on)

func frame(w: String, h: float) -> String:
	return "%s-%02d%02d" % [w, int(h), int(fmod(h, 1.0) * 60.0)]

func at(x: float, z: float, yaw: float, pitch: float, n: int = 9) -> void:
	teleport(x, z); look(yaw, pitch)
	await frames(n)

func run() -> void:
	RenderingServer.environment_set_sdfgi_frames_to_converge(RenderingServer.ENV_SDFGI_CONVERGE_IN_5_FRAMES)
	RenderingServer.environment_set_sdfgi_frames_to_update_light(RenderingServer.ENV_SDFGI_UPDATE_LIGHT_IN_1_FRAME)
	await start(true)
	load("res://tools/scenarios/sky_terrain.gd").install()
	await frames(2)
	sky = Game.world.get_node_or_null("Sky")
	if sky == null:
		print("[sky] no Sky node; abort"); return
	if sky.has_method("refresh_terrain"): sky.refresh_terrain()
	var st: Dictionary = Data.map.get("START", {})
	if st.has("x"): start_x = float(st["x"]); start_z = float(st["z"])
	var quick := OS.get_environment("SKY_SET") == "quick"
	var church: Dictionary = Game.world.poi("church")
	var cx := float(church.get("x", 50)); var cz := float(church.get("z", -230))
	var marsh: Dictionary = Game.world.poi("marsh")
	var col: Dictionary = Data.map.get("COLUMN", { "x": 40, "z": -1100 })
	var col_yaw := atan2(-(float(col["x"]) - start_x), -(float(col["z"]) - start_z))

	# ---- 1. the start point, looking north over the zone
	var plan: Array = []
	if quick:
		for h in [5.5, 7.0, 12.0, 19.5, 23.5]: plan.append(["overcast", h])
		plan.append_array([["clear", 12.0], ["rain", 12.0], ["fog", 7.0], ["storm", 16.0]])
	else:
		for h in HOURS: plan.append(["overcast", h])
		plan.append_array([["clear", 7.0], ["clear", 12.0], ["clear", 16.0], ["clear", 19.5], ["clear", 23.5],
			["drizzle", 12.0], ["rain", 12.0], ["rain", 21.0], ["fog", 5.5], ["fog", 12.0],
			["storm", 16.0], ["storm", 23.5]])
	var first := true
	for p in plan:
		var w: String = p[0]; var h: float = p[1]
		setw(w, h, h >= 21.0 or h < 5.0)
		await at(start_x, start_z, col_yaw, 0.05, 16 if first else 9); first = false
		await shot("start-" + frame(w, h))
		print("[stats] start %s %.1f " % [w, h], JSON.stringify(stats()))
	if quick:
		# the Column and a low sun, then stop
		setw("overcast", 12.0)
		await at(0.0, -280.0, col_yaw, 0.16)
		await shot("column-" + frame("overcast", 12.0))
		setw("clear", 18.5)
		await at(22.0, 226.0, 0.5, -0.16)
		await shot("shadows-" + frame("clear", 18.5))
		print("[stats] quick end ", JSON.stringify(stats()))
		return

	# ---- 2. the church hill: the high point, looking back over the zone and north over the ridge
	for p in [["overcast", 7.0, 2.6], ["clear", 19.5, 2.6], ["overcast", 12.0, 0.1], ["rain", 16.0, 2.6], ["clear", 23.5, 0.1]]:
		setw(p[0], p[1], p[1] >= 21.0)
		await at(cx + 30.0, cz + 30.0, p[2], -0.08)
		await shot("hill-" + frame(p[0], p[1]))
		print("[stats] hill %s %.1f " % [p[0], p[1]], JSON.stringify(stats()))

	# ---- 3. shadow quality: the checkpoint under a low sun, along and across the light
	setw("clear", 18.5)
	await at(22.0, 226.0, 0.5, -0.16)
	await shot("shadows-clear-1830")
	await at(22.0, 226.0, -2.2, -0.30, 7)
	await shot("shadows-clear-1830-b")
	setw("clear", 12.0)
	await at(22.0, 226.0, 0.5, -0.16, 7)
	await shot("shadows-clear-1200")
	print("[stats] shadows ", JSON.stringify(stats()))

	# ---- 4. the marsh and the hollows: ground mist at dawn, at night and in fog weather
	var mx := float(marsh.get("x", -40)); var mz := float(marsh.get("z", 140))
	for p in [["overcast", 5.6], ["fog", 6.5], ["clear", 22.0], ["drizzle", 16.0]]:
		setw(p[0], p[1], p[1] >= 21.0)
		await at(mx + 70.0, mz + 70.0, -2.4, -0.05)
		await shot("marsh-" + frame(p[0], p[1]))
	print("[stats] marsh ", JSON.stringify(stats()))

	# ---- 5. the Column and the Pechorsk Anomaly from the northern ridge
	for p in [["overcast", 12.0], ["clear", 16.0], ["clear", 19.5], ["clear", 23.5], ["fog", 12.0], ["storm", 16.0]]:
		setw(p[0], p[1], p[1] >= 21.0)
		await at(0.0, -280.0, col_yaw, 0.16)
		await shot("column-" + frame(p[0], p[1]))
	setw("clear", 12.0)
	await at(0.0, -280.0, col_yaw - 0.42, 0.30)
	await shot("anomaly-clear-1200")
	print("[stats] column ", JSON.stringify(stats()))

	# ---- 6. the moon from the hill, and a lightning strike in the storm
	setw("clear", 23.5, true)
	teleport(cx + 30.0, cz + 30.0)
	await frames(2)
	var md: Vector3 = sky.moon_dir
	look(atan2(-md.x, -md.z), asin(md.y) - 0.15)
	await frames(9)
	await shot("moon-clear-2330")
	setw("storm", 23.5, true)
	await at(start_x, start_z, col_yaw, 0.10)
	sky.strike()
	sky._weather.bolt = 2.0; sky._weather.lightning_dir = Vector3(0.3, 0.35, -1.0).normalized()
	await frames(1)
	await shot("storm-strike-2330")
	setw("storm", 16.0)
	await at(start_x, start_z, col_yaw, 0.10, 7)
	sky.strike()
	sky._weather.bolt = 2.0; sky._weather.lightning_dir = Vector3(0.3, 0.35, -1.0).normalized()
	await frames(1)
	await shot("storm-strike-1600")
	print("[stats] storm ", JSON.stringify(stats()))

	# ---- 7. rain close up: the splashes on the ground and the drops on the lens
	setw("rain", 12.0)
	await at(start_x, start_z - 10.0, 0.0, -0.6, 26)
	await shot("rain-splashes-1200")
	look(0.0, 0.75)
	await frames(9)
	await shot("rain-lookup-1200")
	setw("drizzle", 19.0)
	await at(start_x, start_z - 10.0, 1.6, -0.1, 16)
	await shot("drizzle-street-1900")
	print("[stats] rain ", JSON.stringify(stats()))
	print("[sky] exposure %.2f horizon %s weather %s wind %s" % [sky.exposure, sky.horizon_color, sky.weather, sky.wind])
