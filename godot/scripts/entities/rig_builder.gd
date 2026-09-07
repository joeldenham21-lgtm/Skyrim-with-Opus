class_name RigBuilder
## Builds the entity rigs (Contracts v2 "Rigs"): static build(kind, variant) -> Node3D with script rig.gd.
## Kinds: mimic, seeker, phantom (humanoids), slider (crawler), fragment (shard cluster), spawn (nest; variant
## {"form": "crawler"} gives the six-legged crawler). Meshes and animation libraries are generated in code and
## cached to assets/cache/rig_*.res (regenerated when GEN_VERSION changes).
## variant keys: weapon ("rifle"|"pistol"|"mg"|"none"), clothing {jacket, trousers, boots, gloves}, loadout {vest,
## helmet, backpack, rig, headgear, mask}, seed, scale, detail (0.5..1), cache (bool).
const GEN_VERSION := 7
const RIG_SCRIPT := preload("res://scripts/entities/rig.gd")
const FACE_SHADER := """
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, unshaded;
instance uniform float fade : hint_range(0.0, 1.0) = 1.0;
instance uniform float seed = 0.0;
uniform float glow = 2.2;
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.1 + 3.0) * 0.3 + vnoise(p * 4.3 + 7.0) * 0.2; }
void fragment() {
	vec2 p = UV - 0.5;
	float t = TIME;
	float slot = floor(t * 14.0);
	float flick = 0.82 + 0.34 * hash11(slot + seed);
	p.x *= 1.0 + 0.36 * (hash11(seed + 1.0) - 0.5);
	p += 0.045 * vec2(sin(t * 1.7 + seed), cos(t * 1.1 + seed * 2.0));
	float n = fbm(p * 5.0 + seed + vec2(t * 0.15, -t * 0.1)) - 0.5;
	float d = length(p * vec2(1.0, 1.3)) / (0.30 * flick) + n * 0.6;
	float a = smoothstep(1.0, 0.42, d);
	vec2 q = p - vec2(0.12, -0.15);
	float tail = smoothstep(0.32, 0.0, length(q * vec2(1.0, 2.4))) * (0.45 + 0.35 * sin(t * 0.7 + seed));
	a = clamp(a + tail * 0.5, 0.0, 1.0);
	ALBEDO = vec3(1.0, 0.98, 0.94) * glow;
	ALPHA = a * fade;
}
"""
static var _shaders := {}
static var _face_shader: Shader = null
static var _mem := {}

static func build(kind: String, variant: Dictionary = {}) -> Node3D:
	var rig: Node3D = Node3D.new()
	rig.set_script(RIG_SCRIPT)
	rig.name = "Rig"
	rig.kind = kind
	var t0 := Time.get_ticks_msec()
	match kind:
		"mimic", "seeker", "phantom": _humanoid(rig, kind, variant)
		"slider": load("res://scripts/entities/bodies/slider_body.gd").assemble(rig, variant)
		"fragment": load("res://scripts/entities/bodies/fragment_body.gd").assemble(rig, variant)
		"spawn", "crawler":
			if kind == "crawler" or str(variant.get("form", "nest")) == "crawler": load("res://scripts/entities/bodies/crawler_body.gd").assemble(rig, variant)
			else: load("res://scripts/entities/bodies/spawn_body.gd").assemble(rig, variant)
		_:
			push_warning("RigBuilder: unknown kind " + kind + ", building a mimic")
			_humanoid(rig, "mimic", variant)
	if variant.has("loadout"): rig.set_loadout(variant["loadout"])
	if variant.get("verbose", false): print("[RigBuilder] %s built in %d ms" % [kind, Time.get_ticks_msec() - t0])
	return rig

# ---------------------------------------------------------------- shared helpers
static func shader(name: String) -> Shader:
	if not _shaders.has(name): _shaders[name] = load("res://shaders/%s.gdshader" % name)
	return _shaders[name]
static func body_material(name: String) -> ShaderMaterial:
	var key := "mat_" + name
	if _mem.has(key): return _mem[key]
	var m := ShaderMaterial.new(); m.shader = shader(name)
	_mem[key] = m
	return m

## Generate-or-load a resource cached under assets/cache/rig_<key>.res.
static func cached(key: String, gen: Callable, use_cache: bool = true) -> Resource:
	var mem_key := "res_" + key
	if _mem.has(mem_key): return _mem[mem_key]
	var path := "res://assets/cache/rig_%s.res" % key
	if use_cache and ResourceLoader.exists(path):
		var r: Resource = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
		if r and int(r.get_meta("gen_version", -1)) == GEN_VERSION:
			_mem[mem_key] = r; return r
	var t0 := Time.get_ticks_msec()
	var res: Resource = gen.call()
	res.set_meta("gen_version", GEN_VERSION)
	var ms := Time.get_ticks_msec() - t0
	if use_cache:
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://assets/cache"))
		var err := ResourceSaver.save(res, path)
		if err != OK: push_warning("RigBuilder: could not cache %s (%d)" % [path, err])
		else: print("[RigBuilder] generated %s in %d ms -> %s" % [key, ms, path])
	_mem[mem_key] = res
	return res

## Add LODs to a skinned ArrayMesh (Godot picks them by screen size). Keeps materials and surface names.
static func with_lods(mesh: ArrayMesh) -> ArrayMesh:
	var im := ImporterMesh.new()
	for s in mesh.get_surface_count():
		im.add_surface(mesh.surface_get_primitive_type(s), mesh.surface_get_arrays(s), [], {}, mesh.surface_get_material(s), mesh.surface_get_name(s), mesh.surface_get_format(s))
	im.generate_lods(25.0, 60.0, [])
	var out := im.get_mesh()
	return out

static func skinned_instance(rig: Node3D, mesh: ArrayMesh, mat: Material, name: String, shadows: bool = true) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); mi.name = name; mi.mesh = mesh
	mi.skin = rig.skeleton.create_skin_from_rest_transforms()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.lod_bias = 1.5
	rig.skeleton.add_child(mi)
	return mi

static func add_socket(rig: Node3D, name: String, bone: String, offset: Transform3D) -> Node3D:
	var ba := BoneAttachment3D.new(); ba.name = "att_" + name; ba.bone_name = bone
	rig.skeleton.add_child(ba)
	var s := Node3D.new(); s.name = "socket_" + name; s.transform = offset
	ba.add_child(s)
	rig.sockets[name] = s
	return s

static func add_zone(rig: Node3D, zone: String, bone: String, shape: Shape3D, offset: Transform3D) -> Area3D:
	var ba := BoneAttachment3D.new(); ba.name = "zatt_" + zone + "_" + bone; ba.bone_name = bone
	rig.skeleton.add_child(ba)
	var a := Area3D.new(); a.name = zone; a.collision_layer = 4; a.collision_mask = 0; a.monitoring = false; a.monitorable = true
	a.set_meta("zone", zone); a.set_meta("entity", rig.entity if rig.entity else rig)
	var cs := CollisionShape3D.new(); cs.shape = shape; cs.transform = offset
	a.add_child(cs); ba.add_child(a)
	rig._zones.append(a)
	return a

static func add_layer(rig: Node3D) -> void:
	var layer := RIG_SCRIPT.PoseLayer.new(); layer.name = "PoseLayer"; layer.rig = rig
	rig.skeleton.add_child(layer)
	rig.layer = layer

static func add_player(rig: Node3D, lib: AnimationLibrary) -> void:
	var ap := AnimationPlayer.new(); ap.name = "AnimationPlayer"
	rig.add_child(ap)
	ap.root_node = NodePath("..")
	ap.add_animation_library("", lib)
	ap.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_IDLE
	rig.anim = ap

static func face_material() -> ShaderMaterial:
	if _face_shader == null: _face_shader = Shader.new(); _face_shader.code = FACE_SHADER
	var m := ShaderMaterial.new(); m.shader = _face_shader
	m.render_priority = 2
	return m

static func capsule(r: float, h: float) -> CapsuleShape3D:
	var c := CapsuleShape3D.new(); c.radius = r; c.height = maxf(h, r * 2.0 + 0.01); return c
static func boxshape(sz: Vector3) -> BoxShape3D:
	var b := BoxShape3D.new(); b.size = sz; return b
static func sphere(r: float) -> SphereShape3D:
	var s := SphereShape3D.new(); s.radius = r; return s

# ---------------------------------------------------------------- humanoids
static func _humanoid(rig: Node3D, kind: String, variant: Dictionary) -> void:
	var params := HumanoidDef.params(kind, variant)
	var def := HumanoidDef.make(params)
	rig.def = def
	var sk := HumanoidDef.skeleton(def)
	rig.add_child(sk); rig.skeleton = sk
	var seed_v: float = float(variant.get("seed", randi() % 1000))
	var scale: float = float(variant.get("scale", 1.65 if kind == "seeker" else 1.0))
	rig.scale = Vector3.ONE * scale; rig.scale_factor = scale
	var use_cache: bool = variant.get("cache", true)
	var detail: float = float(variant.get("detail", 1.0))
	# body mesh
	var clothing: Dictionary
	match kind:
		"phantom": clothing = { "jacket": false, "trousers": false, "boots": false, "gloves": false }
		"seeker": clothing = { "jacket": true, "trousers": true, "boots": true, "gloves": true }
		_: clothing = { "jacket": true, "trousers": true, "boots": true, "gloves": false }
	if variant.has("clothing"):
		for k in variant["clothing"]: clothing[k] = variant["clothing"][k]
	var ckey := "%s_%s%s%s%s" % [kind, "j" if clothing["jacket"] else "", "t" if clothing["trousers"] else "", "b" if clothing["boots"] else "", "g" if clothing["gloves"] else ""]
	var mesh_key := "body_" + ckey + ("" if detail >= 1.0 else "_d%d" % int(detail * 10))
	var mesh: ArrayMesh = cached(mesh_key, func() -> Resource:
		var m := HumanoidBody.build(def, { "clothing": clothing, "jitter": 0.0025 if kind == "mimic" else 0.0, "seed": 3.0, "detail": detail })
		return with_lods(m), use_cache)
	var mat_name := "phantom" if kind == "phantom" else "mimic"
	var mat := body_material(mat_name)
	var body := skinned_instance(rig, mesh, mat, "Body", kind != "phantom")
	body.set_instance_shader_parameter("seed", seed_v)
	rig.body_meshes.append(body)
	if kind == "seeker":
		body.set_instance_shader_parameter("shiver", 0.7)
	# eyes
	rig.eye_bone = "head"; rig.eye_off = HumanoidDef.eye_offset(def)
	# animation library
	var weapon: String = str(variant.get("weapon", "none" if kind == "phantom" else ("mg" if kind == "seeker" else "rifle")))
	var lib_key := "anim_%s_%s" % [("phantom" if kind == "phantom" else ("seeker" if kind == "seeker" else "mimic")), weapon]
	var lib: AnimationLibrary = cached(lib_key, func() -> Resource:
		return HumanoidClips.build(def, { "weapon": weapon, "heavy": kind == "seeker", "phantom": kind == "phantom", "verbose": variant.get("verbose", false) }), use_cache)
	add_player(rig, lib)
	add_layer(rig)
	rig.layer.glitch_enabled = kind != "phantom"
	if kind == "seeker": rig.layer.track_rate = 4.0
	# sockets
	var s := 1.0
	var grip_r := HumanoidClips.hand_r_basis(Basis.IDENTITY, weapon).inverse()
	var grip_l := HumanoidClips.hand_l_basis(Basis.IDENTITY, weapon).inverse()
	add_socket(rig, "hand_r", "hand_r", Transform3D(grip_r, Vector3(0, -0.05 * s, 0)))
	add_socket(rig, "hand_l", "hand_l", Transform3D(grip_l, Vector3(0, -0.05 * s, 0)))
	add_socket(rig, "head", "head", Transform3D(Basis.IDENTITY, Vector3(0, 0.105 * s, -0.005)))
	add_socket(rig, "chest", "chest", Transform3D(Basis.IDENTITY, Vector3(0, 0.16 * s, -0.02)))
	add_socket(rig, "back", "chest", Transform3D(Basis.IDENTITY, Vector3(0, 0.12 * s, 0.15 * s)))
	add_socket(rig, "hip", "hips", Transform3D(Basis.IDENTITY, Vector3(0.17 * s, -0.03, 0.02)))
	# hit zones
	var pos: Dictionary = def["pos"]
	add_zone(rig, "head", "head", sphere(0.125), Transform3D(Basis.IDENTITY, Vector3(0, 0.105, -0.005)))
	add_zone(rig, "chest", "chest", boxshape(Vector3(0.38, 0.30, 0.26)), Transform3D(Basis.IDENTITY, Vector3(0, 0.15, 0)))
	add_zone(rig, "stomach", "spine", boxshape(Vector3(0.33, 0.20, 0.23)), Transform3D(Basis.IDENTITY, Vector3(0, 0.0, 0)))
	for side in ["l", "r"]:
		var lu: float = pos["upper_arm_" + side].distance_to(pos["forearm_" + side]); var lf: float = pos["forearm_" + side].distance_to(pos["hand_" + side])
		add_zone(rig, "arm_" + side, "upper_arm_" + side, capsule(0.065, lu + 0.08), Transform3D(Basis.IDENTITY, Vector3(0, -lu * 0.5, 0)))
		add_zone(rig, "arm_" + side, "forearm_" + side, capsule(0.05, lf + 0.16), Transform3D(Basis.IDENTITY, Vector3(0, -lf * 0.55, 0)))
		var lt: float = pos["thigh_" + side].distance_to(pos["shin_" + side]); var ls: float = pos["shin_" + side].distance_to(pos["foot_" + side])
		add_zone(rig, "leg_" + side, "thigh_" + side, capsule(0.09, lt + 0.06), Transform3D(Basis.IDENTITY, Vector3(0, -lt * 0.5, 0)))
		add_zone(rig, "leg_" + side, "shin_" + side, capsule(0.07, ls + 0.12), Transform3D(Basis.IDENTITY, Vector3(0, -ls * 0.55, 0)))
	# the face blot (mimics): a smeared, flickering white disc on the front of the head
	if kind == "mimic":
		var q := QuadMesh.new(); q.size = Vector2(0.15, 0.17)
		var fm := MeshInstance3D.new(); fm.name = "Face"; fm.mesh = q; fm.material_override = face_material()
		fm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fm.set_instance_shader_parameter("seed", seed_v)
		var ba := BoneAttachment3D.new(); ba.name = "att_face"; ba.bone_name = "head"; sk.add_child(ba)
		fm.position = Vector3(0.0, 0.10, -0.098); ba.add_child(fm)
		fm.rotation = Vector3.ZERO
		rig.set_meta("face", fm.get_path())
	if kind == "seeker":
		load("res://scripts/entities/bodies/gear_body.gd").seeker_suit(rig, def)
