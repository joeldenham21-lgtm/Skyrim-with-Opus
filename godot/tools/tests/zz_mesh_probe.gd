extends SceneTree
func _initialize() -> void:
	for p in ["res://assets/cache/rig_body_mimic_jtb.res", "res://assets/cache/rig_body_phantom_.res", "res://assets/cache/rig_body_seeker_jtbg.res"]:
		var m: ArrayMesh = ResourceLoader.load(p, "", ResourceLoader.CACHE_MODE_IGNORE)
		if m == null: print("MISSING ", p); continue
		var tris := 0; var verts := 0
		for s in m.get_surface_count():
			var a := m.surface_get_arrays(s)
			tris += a[Mesh.ARRAY_INDEX].size() / 3
			verts += a[Mesh.ARRAY_VERTEX].size()
			var has_bones = a[Mesh.ARRAY_BONES] != null
			var has_col = a[Mesh.ARRAY_COLOR] != null
			var has_tan = a[Mesh.ARRAY_TANGENT] != null
			var lods: Dictionary = {}
			print("%s surf %d: tris=%d verts=%d bones=%s color=%s tangent=%s lods=%s aabb=%s" % [p.get_file(), s, a[Mesh.ARRAY_INDEX].size()/3, a[Mesh.ARRAY_VERTEX].size(), has_bones, has_col, has_tan, str(lods.keys() if lods else []), m.get_aabb()])
		print("  total tris=%d verts=%d surfaces=%d" % [tris, verts, m.get_surface_count()])
	quit()
