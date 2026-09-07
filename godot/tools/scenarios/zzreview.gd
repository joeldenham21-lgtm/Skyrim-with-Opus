extends "res://tools/scenarios/_driver.gd"
## TEMPORARY reviewer harness (deleted after the audit): builds rigs through RigBuilder and photographs
## the animation clips, the aim layer and the sockets.
func run() -> void:
	await start(true)
	var st: Dictionary = Data.map.get("START", {"x": 0, "z": 284})
	var sx := float(st.get("x", 0)); var sz := float(st.get("z", 284))
	teleport(sx, sz); look(0.0, 0.0)
	await frames(30)
	var py: float = Game.player.global_position.y
	var ents: Node = get_tree().current_scene.get_node("Entities")
	var rigs: Array = []
	var kinds := ["mimic", "mimic", "mimic", "mimic", "phantom", "seeker"]
	var clips := ["idle", "walk", "aim", "reload", "idle_alert", "idle_alert"]
	for i in kinds.size():
		var r: Node3D = RigBuilder.build(kinds[i], {"seed": i * 13, "verbose": true})
		if r == null: print("[zz] build null for ", kinds[i]); continue
		ents.add_child(r)
		r.global_position = Vector3(sx - 3.6 + i * 1.45, py, sz - 5.0)
		r.rotation.y = PI
		r.play(clips[i], 0.0)
		r.set_aim(deg_to_rad(-6.0), deg_to_rad(18.0))
		rigs.append(r)
	set_hour(12.0)
	await frames(30)
	teleport(sx, sz + 0.5); look(PI, deg_to_rad(-4.0)); await frames(4)
	await shot("lineup")
	teleport(sx - 3.4, sz - 3.2); look(PI * 0.85, deg_to_rad(-2.0)); await frames(30)
	await shot("mimic-close")
	# a walk cycle photographed at 4 phases
	for r in rigs: r.play("walk", 0.0, 1.0)
	teleport(sx - 1.0, sz - 3.0); look(PI * 0.9, 0.0)
	for i in 3:
		await frames(9)
		await shot("walk-%d" % i)
	for r in rigs: r.play("death_front", 0.0, 1.0)
	await frames(20)
	await shot("death")
	print("[zz] stats ", JSON.stringify(stats()))
