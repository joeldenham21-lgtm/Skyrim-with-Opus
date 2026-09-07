extends SceneTree
func _initialize() -> void:
	for p in ["res://assets/cache/rig_anim_mimic_rifle.res", "res://assets/cache/rig_anim_phantom_none.res"]:
		var lib: AnimationLibrary = ResourceLoader.load(p, "", ResourceLoader.CACHE_MODE_IGNORE)
		if lib == null: print("no lib ", p); continue
		for n in lib.get_animation_list():
			var a: Animation = lib.get_animation(n)
			print("%s / %-12s len=%.2f loop=%d tracks=%d footsteps=%s stride=%s cycle=%s" % [p.get_file(), n, a.length, a.loop_mode, a.get_track_count(), str(a.get_meta("footsteps", "NONE")), str(a.get_meta("stride", "NONE")), str(a.get_meta("cycle", "NONE"))])
	quit()
