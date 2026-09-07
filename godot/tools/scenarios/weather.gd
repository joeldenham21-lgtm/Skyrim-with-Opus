extends "res://tools/scenarios/_driver.gd"
## Weather logic test: transitions, wind gusting, schedule picks, lightning/thunder scheduling, fog volumes and the
## Tide's sky. Prints the interpolated parameters through a 20-second transition and a few frames of storm.
func run() -> void:
	await start(true)
	var s: Node = Game.world.get_node_or_null("Sky")
	if s == null:
		print("[weather] no Sky node; abort"); return
	var w: Node = s.get_node("Weather")
	print("[weather] initial state %s rain %.2f fog %.2f wind %s" % [s.weather, s.rain, s.fog_level, s.wind])
	var got := []
	Events.weather_changed.connect(func(n: String, p: String) -> void: got.append([n, p]))
	s.set_weather("rain", 2.0)
	for i in 6:
		await frames(20)
		print("[weather] t+%d frames: progress %.2f coverage %.2f rain %.2f vol %.4f wind %.2f m/s sun %.2f" % [(i + 1) * 20, w.progress, w.params["coverage"], s.rain, w.params["vol"], s.wind.length(), s.sun_energy])
	print("[weather] events: ", JSON.stringify(got))
	s.set_weather("storm", 0.0)
	await frames(2)
	s.strike()
	for i in 4:
		await frames(1)
		print("[weather] strike frame %d: lightning %.2f bolt %.2f flash light %.2f thunder in %.1f s" % [i, s.lightning, w.bolt, s.flash.light_energy, w._thunder_in])
	# schedule statistics: 400 picks at 06:00 and at 15:00
	var counts := {}
	for hour in [6.0, 15.0]:
		counts = {}
		for i in 400:
			var n: String = w._pick_next(hour)
			counts[n] = counts.get(n, 0) + 1
		print("[weather] schedule at %02d:00 -> %s" % [int(hour), JSON.stringify(counts)])
	# fog volumes and dawn mist
	set_hour(6.0); await frames(2)
	print("[weather] fog volumes %d, hollow density %.3f at 06:00" % [s._fog_volumes.size(), s._hollow_mat.density if s._hollow_mat else -1.0])
	set_hour(13.0); await frames(2)
	print("[weather] hollow density %.3f at 13:00" % (s._hollow_mat.density if s._hollow_mat else -1.0))
	# the Tide approaching: sick sky, dim sun
	Clock.day = Clock.tide_day; Clock.hour = 4.9
	await frames(2)
	print("[weather] tide in %.0f s: sick %.2f tide %.2f sun %.3f" % [Clock.tide_in(), s.sick, s.tide, s.sun_energy])
	Events.tide_rising.emit()
	await frames(30)
	print("[weather] rising: tide %.2f phase %s" % [s.tide, s._tide_phase])
	print("[weather] light_level day/night: ", s.light_level())
	print("[stats] ", JSON.stringify(stats()))
