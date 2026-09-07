extends "res://tools/scenarios/_driver.gd"
## HUD verification. Starts a game, installs the UI root and photographs every state the HUD can be in:
## the clean walk, the interaction prompt (with a hold reach in progress), the damage state at 30 HP while
## bleeding, three stacked notices, the wristwatch by day and at night, the gas mask with the night-vision
## tube behind it, the optic surround, rain on the glass and the F3 telemetry.

var hud: Node = null
var ui: Node = null

func _ui() -> void:
	var main := get_parent()
	var scr: GDScript = load("res://scripts/ui/ui_root.gd")
	ui = scr.install(main)
	await frames(3)
	hud = get_tree().get_first_node_in_group("hud")

func _dummy_interactable(prompt_text: String, hold: float) -> Node3D:
	var src := "extends StaticBody3D\nvar hold_time := %f\nfunc prompt() -> String: return \"%s\"\nfunc interact(_p) -> void: pass\n" % [hold, prompt_text]
	var scr := GDScript.new()
	scr.source_code = src
	scr.reload()
	var body := StaticBody3D.new()
	body.set_script(scr)
	body.collision_layer = 8
	body.collision_mask = 0
	body.add_to_group("interactable")
	var col := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(0.9, 0.7, 0.7)
	col.shape = box
	body.add_child(col)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.9, 0.7, 0.7)
	mi.mesh = bm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.24, 0.21, 0.16)
	mat.roughness = 0.95
	mi.material_override = mat
	body.add_child(mi)
	Game.world.add_child(body)
	var p: Node3D = Game.player
	body.global_position = p.eye_pos() + p.look_dir() * 1.7 + Vector3(0.0, -0.25, 0.0)
	return body

func run() -> void:
	await start(true)
	await _ui()
	if hud == null:
		print("FAIL no hud in group")
		return
	set_hour(9.5)
	await frames(4)
	print("[hud] stats ", stats())

	# ── 1. the clean walk: a dot, and nothing else ────────────────────────────────────────────────────
	look(0.55, -0.05)
	await frames(30)
	await shot("clean")

	# ── 2. interaction prompt, mid-reach ──────────────────────────────────────────────────────────────
	var crate := _dummy_interactable("[E] SEARCH · CRATE", 0.9)
	await frames(6)
	Input.action_press("interact")
	await frames(18)
	await shot("prompt")
	Input.action_release("interact")
	crate.queue_free()
	await frames(4)

	# ── 3. damage: 30 HP, bleeding, two impacts from behind and the left ──────────────────────────────
	Game.state["hp"] = 30.0
	Game.state["bleeding"] = true
	if Game.inventory != null:
		Game.inventory.add("bandage", 3)
		Game.inventory.set_quick(0, "bandage")
	var p: Node3D = Game.player
	hud.hit_from(p.global_position + Vector3(-6.0, 0.0, 2.0), 0.95)
	hud.hit_from(p.global_position + Vector3(2.0, 0.0, 7.0), 0.7)
	await frames(26)
	await shot("damage-30hp-bleeding")

	# ── 4. deeper: 8 HP, blood on the glass, everything draining ──────────────────────────────────────
	Game.state["hp"] = 8.0
	hud.hit_from(p.global_position + Vector3(0.0, 0.0, -5.0), 1.0)
	await frames(90)
	await shot("damage-critical")
	Game.state["hp"] = 74.0
	Game.state["bleeding"] = false
	await frames(60)

	# ── 5. the notice queue ───────────────────────────────────────────────────────────────────────────
	Events.notice.emit("PSC-0417 / RETRIEVAL / OBJECT 12 accepted. Anomalous activity index 3.", "mission")
	await frames(30)
	Events.notice.emit("Clearance 2 granted. Grade: Explorer. Requisition and contract tiers widened.", "clearance")
	await frames(26)
	Events.notice.emit("Tide front detected at the ring. One hour to arrival. Return to Vanno.", "tide")
	await frames(40)
	await shot("notices")

	# ── 6. the wristwatch, day ────────────────────────────────────────────────────────────────────────
	set_hour(9.5)
	Clock.day = 2
	look(2.4, -0.02)
	Input.action_press("watch")
	await frames(70)
	await shot("watch-day")

	# ── 7. the wristwatch, night, low battery, one hour to the Tide ───────────────────────────────────
	set_hour(23.2)
	Clock.day = 3
	Clock.tide_day = 4
	Clock.hour = 4.4
	Game.state["hp"] = 46.0
	Game.state["flashlight"]["battery"] = 18.0
	Game.state["flashlight"]["on"] = true
	if Game.inventory != null:
		Game.inventory.add("battery", 2)
	await frames(40)
	await shot("watch-night")
	Input.action_release("watch")
	Clock.hour = 22.6
	Clock.tide_day = 6
	await frames(20)

	# ── 8. mask and night vision ──────────────────────────────────────────────────────────────────────
	if Game.inventory != null:
		var inv_script: GDScript = load("res://scripts/inventory/inventory.gd")
		for gid in ["mask_gp5", "head_1pn138"]:
			var g: Dictionary = inv_script.make_gear(gid)
			if not g.is_empty():
				Game.inventory.add_gear(g)
				Game.inventory.equip_gear(int(g["uid"]))
	if Game.kit != null and Game.kit.has_method("toggle_nvg"):
		Game.kit.toggle_nvg()
	torch(false)
	await frames(30)
	await shot("mask-nvg")

	# ── 9. optic surround and reticle ─────────────────────────────────────────────────────────────────
	if Game.kit != null and Game.kit.has_method("toggle_nvg"):
		Game.kit.toggle_nvg()
	if Game.inventory != null:
		for slot in ["mask", "headgear"]:
			Game.inventory.unequip(slot)
	set_hour(10.0)
	hud.set_scope({ "reticle": "pso", "zoom": 4.0, "kind": "optic" })
	await frames(24)
	await shot("optic-pso")
	hud.clear_scope()
	await frames(10)

	# ── 10. rain on the glass ─────────────────────────────────────────────────────────────────────────
	var sky: Node = Game.world.get_node_or_null("Sky") if Game.world != null else null
	if sky != null and sky.has_method("set_weather"):
		sky.set_weather("rain", 0.5)
		await frames(90)
		await shot("rain-lens")
		sky.set_weather("overcast", 0.5)
		await frames(30)

	# ── 11. F3 telemetry ──────────────────────────────────────────────────────────────────────────────
	hud.stats.visible = true
	hud.set_objective("PSC-0417 · RETRIEVAL", "Recover the data recorder from the substation control room. Do not engage unless necessary.")
	await frames(40)
	await shot("telemetry")
	hud.stats.visible = false
	hud.set_objective("", "")

	# ── 12. overweight + torch + detector status stack ────────────────────────────────────────────────
	if Game.inventory != null:
		var guard := 0
		while float(Game.inventory.overweight()) <= 3.0 and guard < 60:
			Game.inventory.add("battery", 8)
			guard += 1
	Game.state["flashlight"]["on"] = true
	Game.state["flashlight"]["battery"] = 44.0
	Game.state["bleeding"] = true
	Game.state["hp"] = 22.0
	await frames(40)
	await shot("status-stack")

	print("[hud] final stats ", stats())
