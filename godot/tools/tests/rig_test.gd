extends SceneTree
## Logic test for the rigs: builds every kind, plays every clip, steps frames, checks sockets/zones/bones/aim,
## ragdoll on/off and the loadout path. Run: $GODOT --headless --path . -s tools/tests/rig_test.gd
var KINDS := ["mimic", "seeker", "phantom", "slider", "fragment", "spawn", "crawler"]
const CLIPS := ["idle", "idle_alert", "walk", "run", "crouch_idle", "crouch_walk", "aim", "fire", "reload", "hit_front", "hit_back",
	"death_front", "death_back", "melee", "throw", "peek_l", "peek_r", "search", "flinch", "crawl", "pounce", "hover", "split", "spit", "circle", "grab", "scream", "hidden"]
var rigs := {}
var frame := 0
var fails := 0
var steps := {}
var clip_i := 0

func _initialize() -> void:
	var t0 := Time.get_ticks_msec()
	var env := OS.get_environment("RIG_KINDS")
	if env != "": KINDS = env.split(",")
	var RB = load("res://scripts/entities/rig_builder.gd")
	var loadouts := { "mimic": { "vest": "vest_6b23_1", "helmet": "helm_ssh68", "backpack": "pack_pilgrim", "rig": "rig_6sh112", "mask": "mask_gp5", "headgear": null },
		"seeker": {}, "phantom": {}, "slider": {}, "fragment": {}, "spawn": {}, "crawler": {} }
	for k in KINDS:
		var t1 := Time.get_ticks_msec()
		var v := { "seed": 3, "verbose": true }
		if k == "crawler": v["form"] = "crawler"
		var kind: String = "spawn" if k == "crawler" else k
		var rig: Node3D = RB.build(kind, v)
		if rig == null: print("FAIL build ", k); fails += 1; continue
		root.add_child(rig)
		rig.position = Vector3(KINDS.find(k) * 2.0, 0, 0)
		rig.footstep.connect(func(f): steps[k] = steps.get(k, 0) + 1)
		rigs[k] = rig
		if loadouts[k].size() > 0: rig.set_loadout(loadouts[k])
		var names := []
		if rig.anim: names = rig.anim.get_animation_list()
		var tris := 0
		for m in rig.body_meshes:
			for s in m.mesh.get_surface_count(): tris += m.mesh.surface_get_array_index_len(s) / 3
		print("[rig_test] %s: %d ms, clips=%s, zones=%d, sockets=%s, body_tris=%d, gear=%s" % [k, Time.get_ticks_msec() - t1, str(names), rig.zones().size(), str(rig.sockets.keys()), tris, str(rig.gear_meshes.keys())])
		for z in rig.zones():
			if not z.has_meta("zone") or not z.has_meta("entity"): print("FAIL zone meta ", k, " ", z.name); fails += 1
		for s in ["hand_r", "hand_l", "back", "hip", "head", "chest"]:
			if not rig.sockets.has(s): print("WARN no socket ", s, " on ", k)
		var e: Vector3 = rig.eye_pos()
		if e.y < 0.05: print("FAIL eye_pos ", k, " ", e); fails += 1
	print("[rig_test] all built in %d ms" % (Time.get_ticks_msec() - t0))

func _process(_dt: float) -> bool:
	frame += 1
	# every 6 frames switch every rig to the next clip in the list (unknown clips resolve to a fallback)
	if frame % 6 == 1:
		if clip_i < CLIPS.size():
			for k in rigs:
				var r = rigs[k]
				var played: String = r.play(CLIPS[clip_i], 0.1)
				if played == "" and r.anim != null: print("FAIL play ", k, " ", CLIPS[clip_i]); fails += 1
			clip_i += 1
		elif clip_i == CLIPS.size():
			for k in rigs:
				var r = rigs[k]
				r.set_aim(0.3, -0.5); r.set_shiver(1.5); r.kick(1.0)
				r.play("walk", 0.2, 1.3)
				var hp: Vector3 = r.bone_pos("head")
				if hp == r.global_position and k in ["mimic", "seeker", "phantom"]: print("FAIL bone_pos head ", k); fails += 1
			clip_i += 1
		elif clip_i == CLIPS.size() + 1:
			for k in rigs:
				var r = rigs[k]
				r.locomotion(3.0); r.set_ragdoll(true)
			clip_i += 1
		elif clip_i == CLIPS.size() + 2:
			for k in rigs:
				var r = rigs[k]
				r.set_ragdoll(false); r.play("death_front"); r.set_dissolve(0.5); r.set_nvg(true)
			clip_i += 1
		elif clip_i == CLIPS.size() + 3:
			for k in rigs:
				var r = rigs[k]
				r.set_loadout({ "vest": "vest_paca", "helmet": "helm_6b47", "backpack": null, "rig": "rig_alpha" })
				var n := Node3D.new(); r.attach(n, "hand_r"); r.detach(n); n.queue_free()
			clip_i += 1
		else:
			print("[rig_test] footsteps: ", steps)
			for k in rigs:
				var r = rigs[k]
				var hits := 0
				for z in r.zones(): hits += 1
				print("[rig_test] %s zones=%d final clip=%s" % [k, hits, r.current])
			print("[rig_test] %s (%d fails, %d frames)" % ["OK" if fails == 0 else "FAILED", fails, frame])
			quit(0 if fails == 0 else 1)
			return true
	return false
