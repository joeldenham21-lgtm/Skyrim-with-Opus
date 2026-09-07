extends "res://tools/scenarios/_driver.gd"
## REVIEW-ONLY probe (not owned by the rigs agent): renders RigBuilder output for every kind.
var rigs := {}
func run() -> void:
	await start(true)
	var st: Dictionary = Data.map.get("START", {"x": 0, "z": 284})
	var sx := float(st.get("x", 0)); var sz := float(st.get("z", 284))
	teleport(sx, sz); look(0.0, 0.0)
	await frames(40)
	var py: float = Game.player.global_position.y
	var RB = load("res://scripts/entities/rig_builder.gd")
	var ents: Node3D = get_tree().current_scene.get_node("Entities")
	var kinds := ["mimic", "seeker", "phantom", "slider", "fragment", "spawn"]
	var i := 0
	for k in kinds:
		var r: Node3D = null
		var ok = true
		r = RB.build(k, {"seed": 3})
		if r == null: print("[zz] build FAILED ", k); i += 1; continue
		ents.add_child(r)
		r.global_position = Vector3(sx - 4.0 + i * 1.7, py, sz - 5.0)
		rigs[k] = r
		i += 1
	await frames(4)
	# mimic loadout test
	if rigs.has("mimic"):
		rigs["mimic"].set_loadout({"vest": "vest_6b43", "helmet": "helm_ssh68", "backpack": "pack_pilgrim", "rig": "rig_smersh", "mask": "mask_gp5"})
		print("[zz] mimic gear meshes = ", rigs["mimic"].gear_meshes.keys())
	set_hour(12.0)
	for k in rigs: rigs[k].play("idle", 0.0)
	await frames(10)
	await shot("all-idle")
	# aim + face toward camera
	for k in rigs:
		rigs[k].play("aim", 0.15)
		rigs[k].set_aim(0.0, 0.0)
	await frames(30)
	await shot("all-aim")
	# walk mid-cycle
	for k in rigs: rigs[k].locomotion(1.6)
	await frames(35)
	await shot("all-walk-a")
	await frames(12)
	await shot("all-walk-b")
	# close on the mimic head (face blot)
	teleport(sx - 4.0, sz - 3.4); look(0.0, deg_to_rad(8.0)); await frames(6)
	await shot("mimic-close")
	# death + ragdoll
	for k in rigs:
		rigs[k].play("death_front", 0.1); rigs[k].set_dead(true)
	teleport(sx - 0.5, sz - 1.5); look(0.0, deg_to_rad(20.0)); await frames(45)
	await shot("death")
	for k in rigs: rigs[k].set_ragdoll(true)
	await frames(60)
	await shot("ragdoll")
	print("[stats] ", JSON.stringify(stats()))
