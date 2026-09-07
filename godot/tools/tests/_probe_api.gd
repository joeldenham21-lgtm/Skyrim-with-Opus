extends SceneTree
## Probe: skeleton skinning, modifiers, LOD generation, animation bone tracks.
func _init() -> void:
	var sk := Skeleton3D.new()
	var a := sk.add_bone("a"); sk.set_bone_rest(a, Transform3D(Basis(), Vector3(0, 0, 0)))
	var b := sk.add_bone("b"); sk.set_bone_parent(b, a); sk.set_bone_rest(b, Transform3D(Basis(), Vector3(0, 1, 0)))
	sk.reset_bone_poses()
	var skin := sk.create_skin_from_rest_transforms()
	print("skin binds ", skin.get_bind_count(), " ", skin.get_bind_bone(1), " ", skin.get_bind_pose(1))
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_skin_weight_count(SurfaceTool.SKIN_4_WEIGHTS)
	for i in 3:
		st.set_bones(PackedInt32Array([0, 1, 0, 0])); st.set_weights(PackedFloat32Array([0.5, 0.5, 0, 0])); st.set_normal(Vector3.UP); st.set_uv(Vector2(0, 0)); st.set_tangent(Plane(1, 0, 0, 1)); st.add_vertex(Vector3(i, 0, 0))
	st.add_index(0); st.add_index(1); st.add_index(2)
	var mesh := st.commit()
	print("mesh surfaces ", mesh.get_surface_count(), " fmt has bones: ", (mesh.surface_get_format(0) & Mesh.ARRAY_FORMAT_BONES) != 0)
	# LOD via ImporterMesh
	var im := ImporterMesh.new()
	im.add_surface(Mesh.PRIMITIVE_TRIANGLES, mesh.surface_get_arrays(0))
	im.generate_lods(25.0, 60.0, [])
	var m2 := im.get_mesh()
	print("lods ", m2.surface_get_lod_count(0) if m2.has_method("surface_get_lod_count") else "n/a")
	# SkeletonModifier3D
	var mod := SkeletonModifier3D.new()
	print("modifier ok ", mod.has_method("_process_modification"), " ", ClassDB.class_has_method("SkeletonModifier3D", "_process_modification", true), " delta variant: ", ClassDB.class_has_method("SkeletonModifier3D", "_process_modification_with_delta", true))
	# Animation with bone tracks
	var anim := Animation.new(); anim.length = 1.0; anim.loop_mode = Animation.LOOP_LINEAR
	var t := anim.add_track(Animation.TYPE_ROTATION_3D); anim.track_set_path(t, NodePath("Skeleton3D:b"))
	anim.rotation_track_insert_key(t, 0.0, Quaternion.IDENTITY); anim.rotation_track_insert_key(t, 0.5, Quaternion(Vector3.RIGHT, 1.0))
	var lib := AnimationLibrary.new(); lib.add_animation("walk", anim)
	var ap := AnimationPlayer.new(); ap.add_animation_library("", lib)
	print("anim list ", ap.get_animation_list())
	print("PhysicalBoneSimulator3D: ", ClassDB.class_exists("PhysicalBoneSimulator3D"), " PhysicalBone3D: ", ClassDB.class_exists("PhysicalBone3D"))
	print("ShaderMaterial instance uniforms supported: ", ClassDB.class_has_method("GeometryInstance3D", "set_instance_shader_parameter"))
	print("RenderingServer.mesh_surface_get_arrays ok; Time ", Time.get_ticks_msec())
	quit()
