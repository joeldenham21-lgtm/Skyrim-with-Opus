extends Node
## Scenario driver: attached by main.gd when --scenario <path> is on the command line. Subclasses implement run().
## Helpers: await frames(n), shot(name), teleport(x, z), look(yaw, pitch), set_hour(h), torch(on).
var out_dir := ""
var _shot := 0
func _ready() -> void:
	out_dir = OS.get_environment("RADIUS_SHOTS")
	if out_dir == "": out_dir = "user://shots"
	DirAccess.make_dir_recursive_absolute(out_dir)
	call_deferred("_go")
func _go() -> void:
	await frames(2)
	await run()
	print("[scenario] done"); get_tree().quit()
func run() -> void: pass
func frames(n: int) -> void:
	for i in n: await get_tree().process_frame
func shot(name: String) -> void:
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := "%s/%02d-%s.png" % [out_dir, _shot, name]; _shot += 1
	img.save_png(path); print("[shot] ", path)
func start(new_game: bool = true) -> void:
	Game.start(new_game); await frames(2)
func teleport(x: float, z: float) -> void: Game.player.teleport(x, z)
func look(yaw: float, pitch: float) -> void: Game.player.set_look(yaw, pitch)
func set_hour(h: float) -> void: Clock.hour = h
func torch(on: bool) -> void: Game.state["flashlight"]["on"] = on
func stats() -> Dictionary:
	return { "fps": Engine.get_frames_per_second(), "draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), "primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME), "mode": Game.mode, "hour": Clock.hour, "pos": Game.player.global_position, "entities": get_tree().get_nodes_in_group("entities").size() }
