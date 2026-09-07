extends SceneTree
func _initialize() -> void:
	var RB = load("res://scripts/entities/rig_builder.gd")
	var def := HumanoidDef.make(HumanoidDef.params("mimic"))
	var m := HumanoidBody.build(def, {"clothing": {"jacket": true, "trousers": true, "boots": true, "gloves": false}})
	var t0 := Time.get_ticks_msec()
	var out: ArrayMesh = RB.with_lods(m)
	print("with_lods ok in %d ms, surfaces=%d tris=%d" % [Time.get_ticks_msec()-t0, out.get_surface_count(), out.surface_get_arrays(0)[Mesh.ARRAY_INDEX].size()/3])
	var im := ImporterMesh.new()
	im.add_surface(m.surface_get_primitive_type(0), m.surface_get_arrays(0), [], {}, null, "s", m.surface_get_format(0))
	im.generate_lods(25.0, 60.0, [])
	print("importer lod count = ", im.get_surface_lod_count(0))
	for i in im.get_surface_lod_count(0):
		print("  lod %d: indices=%d screen=%f" % [i, im.get_surface_lod_indices(0, i).size(), im.get_surface_lod_size(0, i)])
	quit()
