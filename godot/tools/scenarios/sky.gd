extends "res://tools/scenarios/_driver.gd"
## Sky, weather and lighting verification. Shots from the Vanno start looking north and from the church hill, at the
## design's hours, per weather; a low-angle shot for shadow quality; the Column. SKY_SET=quick (default) shoots a
## representative subset, SKY_SET=full every hour x weather at the start point plus the specials.
const HOURS := [5.5, 7.0, 12.0, 16.0, 19.5, 21.0, 23.5, 3.0]
const WEATHERS := ["clear", "overcast", "rain", "fog", "storm"]

func _sky() -> Node:
	return Game.world.get_node_or_null("Sky")

func setw(weather: String, hour: float, torch_on: bool = false) -> void:
	var s := _sky()
	if s: s.set_weather(weather, 0.0)
	set_hour(hour); torch(torch_on)

func run() -> void:
	RenderingServer.environment_set_sdfgi_frames_to_converge(RenderingServer.ENV_SDFGI_CONVERGE_IN_5_FRAMES)
	RenderingServer.environment_set_sdfgi_frames_to_update_light(RenderingServer.ENV_SDFGI_UPDATE_LIGHT_IN_1_FRAME)
	await start(true)
	var s := _sky()
	if s == null:
		print("[sky] no Sky node; abort"); return
	var full := OS.get_environment("SKY_SET") == "full"
	var start_x := 0.0; var start_z := 284.0
	var st: Dictionary = Data.map.get("START", {})
	if st.has("x"): start_x = float(st["x"]); start_z = float(st["z"])
	# 1. the start point, looking north, every hour (overcast: the zone's default), then the other weathers
	var plan: Array = []
	if full:
		for w in WEATHERS:
			for h in HOURS: plan.append([w, h])
	else:
		for h in HOURS: plan.append(["overcast", h])
		for pair in [["clear", 7.0], ["clear", 12.0], ["clear", 19.5], ["clear", 23.5], ["rain", 12.0], ["rain", 21.0], ["fog", 5.5], ["fog", 7.0], ["storm", 16.0], ["storm", 23.5], ["drizzle", 12.0]]:
			plan.append(pair)
	var first := true
	for p in plan:
		var w: String = p[0]; var h: float = p[1]
		setw(w, h, h >= 21.0 or h < 5.0)
		teleport(start_x, start_z); look(0.0, 0.04)
		await frames(14 if first else 8); first = false
		await shot("start-%s-%02d%02d" % [w, int(h), int(fmod(h, 1.0) * 60.0)])
		print("[stats] %s %.1f " % [w, h], JSON.stringify(stats()))
	# 2. the church hill: a high point looking back over the zone (south-west) and toward the ridge
	var church: Dictionary = Game.world.poi("church")
	var cx := float(church.get("x", 50)); var cz := float(church.get("z", -230))
	for p in [["overcast", 7.0, 2.6], ["clear", 19.5, 2.6], ["overcast", 12.0, 0.0], ["rain", 16.0, 2.6], ["clear", 23.5, 2.6]]:
		setw(p[0], p[1], p[1] >= 21.0)
		teleport(cx + 30.0, cz + 30.0); look(p[2], -0.08)
		await frames(10)
		await shot("hill-%s-%02d%02d" % [p[0], int(p[1]), int(fmod(p[1], 1.0) * 60.0)])
		print("[stats] hill %s %.1f " % [p[0], p[1]], JSON.stringify(stats()))
	# 3. low sun for shadow quality: the checkpoint at 18:30, clear, looking along the road with the sun low
	setw("clear", 18.5)
	teleport(22.0, 226.0); look(0.4, -0.22)
	await frames(10)
	await shot("shadows-clear-1830")
	teleport(22.0, 226.0); look(-2.2, -0.35)
	await frames(6)
	await shot("shadows-clear-1830-b")
	print("[stats] shadows ", JSON.stringify(stats()))
	# 4. looking at the Column from the northern ridge, day and night, and a storm strike
	var col: Dictionary = Data.map.get("COLUMN", { "x": 40, "z": -1100 })
	var yaw := atan2(-(float(col["x"]) - 0.0), -(float(col["z"]) - (-300.0)))
	for p in [["overcast", 12.0], ["clear", 19.5], ["clear", 23.5]]:
		setw(p[0], p[1], p[1] >= 21.0)
		teleport(0.0, -300.0); look(yaw, 0.12)
		await frames(10)
		await shot("column-%s-%02d%02d" % [p[0], int(p[1]), int(fmod(p[1], 1.0) * 60.0)])
	# the moon, from the hill
	setw("clear", 23.5, true)
	teleport(cx + 30.0, cz + 30.0)
	await frames(2)
	var md: Vector3 = s.moon_dir
	look(atan2(-md.x, -md.z), asin(md.y) - 0.15)
	await frames(8)
	await shot("moon-clear-2330")
	setw("storm", 23.5, true)
	teleport(start_x, start_z); look(0.0, 0.1)
	await frames(8)
	s.strike()
	s._weather.bolt = 2.0; s._weather.lightning_dir = Vector3(0.3, 0.35, -1.0).normalized()
	await frames(1)
	await shot("storm-strike-2330")
	print("[stats] column/storm ", JSON.stringify(stats()))
	# 5. rain close-up: looking down at the splashes, and up into the drops
	setw("rain", 12.0)
	teleport(start_x, start_z - 10.0); look(0.0, -0.6)
	await frames(24)
	await shot("rain-splashes-1200")
	look(0.0, 0.7)
	await frames(8)
	await shot("rain-lookup-1200")
	print("[stats] rain ", JSON.stringify(stats()))
	print("[sky] exposure %.2f horizon %s weather %s" % [s.exposure, s.horizon_color, s.weather])
