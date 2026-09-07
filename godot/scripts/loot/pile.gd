extends StaticBody3D
## A loot pile on the ground. Three kinds:
##   mimic     what is left when a mimic folds: a heap of ash on a soot ring, its rifle across it, spare magazines and
##             whatever fell out of its pockets lying around;
##   explorer  an explorer who did not make it back: the skinned humanoid body (scripts/entities/bodies, the same mesh
##             the mimics wear, dressed as a person and posed on the ground), a dark stain, the pack thrown down, the
##             gun by the hand, tags and letters in the record;
##   pile      kit the player dropped: a canvas duffel with the loose things beside it.
## Interactable ("[E] SEARCH · MIMIC"); contents live in Loot's record for this node and open in the loot panel.
## Small props are built from the entries (magazines, cartridges, tins, pouches, grenades, helmets, artifacts) so
## what you see is what is there; they rebuild on refresh(). The dropped weapon is the real GunBuilder model when
## that script exists.
var kind := "pile"           # mimic | explorer | pile
var label := "PILE"
var items: Array = []
var born := 0.0
var _weapon_node: Node3D = null
var _prop_root: Node3D = null
var _seed := 0.0
var _rng := RandomNumberGenerator.new()
var _flung_left := true
static var _mats := {}
static var _shaders := {}
static var _body_mesh: ArrayMesh = null
const BODY_CACHE := "res://assets/cache/loot_corpse_body.res"
const BODY_GEN := 3
const PROP_LIMIT := 9

# ------------------------------------------------------------------------------------------------------------------
# shaders (inline: the pile owns its looks; Mats supplies the textured canvas/leather/metal when the sets exist)
# ------------------------------------------------------------------------------------------------------------------
const NOISE_GLSL := """
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p) {
	vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
	float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
	return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm3(vec3 p) { return vnoise3(p) * 0.55 + vnoise3(p * 2.03 + 7.1) * 0.3 + vnoise3(p * 4.1 + 3.3) * 0.15; }
float vnoise2(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p) { return vnoise2(p) * 0.5 + vnoise2(p * 2.1 + 3.0) * 0.3 + vnoise2(p * 4.3 + 7.0) * 0.2; }
"""
## Ash: near-black matte with a mottle and sparse pale flakes; creases darkened by the vertex colour.
const ASH_SHADER := """
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;
uniform vec3 base_color : source_color = vec3(0.052, 0.050, 0.049);
uniform vec3 flake_color : source_color = vec3(0.34, 0.33, 0.31);
uniform float seed = 0.0;
varying vec3 v_pos;
%s
void vertex() { v_pos = VERTEX; }
void fragment() {
	float n = fbm3(v_pos * 7.0 + seed);
	float fl = vnoise3(v_pos * 70.0 + seed * 3.0) * 0.6 + vnoise3(v_pos * 140.0 + seed) * 0.4;
	float flakes = smoothstep(0.66, 0.78, fl);
	vec3 c = base_color * (0.7 + 0.7 * n);
	c = mix(c, flake_color * (0.8 + 0.4 * n), flakes * 0.85);
	c *= COLOR.rgb;
	ALBEDO = c;
	ROUGHNESS = 0.95 - flakes * 0.25;
	METALLIC = 0.0;
	SPECULAR = 0.2;
}
"""
## Ground stain (soot ring, blood, darkened earth): a soft irregular disc that receives light.
const STAIN_SHADER := """
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, diffuse_burley, specular_disabled;
uniform vec3 color : source_color = vec3(0.03, 0.03, 0.03);
uniform float strength = 0.8;
uniform float inner = 0.25;
uniform float seed = 0.0;
%s
void fragment() {
	vec2 p = UV - 0.5;
	float d = length(p) * 2.0;
	float n = fbm2(p * 7.0 + seed) - 0.5;
	float a = smoothstep(1.0, inner, d + n * 0.55) * strength;
	a *= 0.75 + 0.5 * vnoise2(p * 40.0 + seed);
	ALBEDO = color;
	ALPHA = clamp(a, 0.0, 1.0);
	ROUGHNESS = 1.0;
}
"""
## The explorer's body: maps the body mesh's vertex-colour convention (r shiver, g cloth, b grime/boot, a tatter)
## to dead skin, worn canvas and boots with grime.
const CORPSE_SHADER := """
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;
uniform vec3 skin_color : source_color = vec3(0.50, 0.46, 0.41);
uniform vec3 cloth_color : source_color = vec3(0.30, 0.30, 0.22);
uniform vec3 cloth_color2 : source_color = vec3(0.22, 0.21, 0.16);
uniform vec3 boot_color : source_color = vec3(0.085, 0.07, 0.055);
uniform vec3 mud_color : source_color = vec3(0.16, 0.13, 0.09);
uniform float seed = 0.0;
varying vec3 v_pos;
%s
void vertex() { v_pos = VERTEX; }
void fragment() {
	float cloth = clamp(COLOR.g, 0.0, 1.0);
	float boot = smoothstep(0.5, 0.65, COLOR.b) * cloth;
	float n = fbm3(v_pos * 5.0 + seed);
	float grime = fbm3(v_pos * 16.0 + seed * 2.0 + 11.0);
	float weave = vnoise3(v_pos * 260.0) * 0.12;
	vec3 cl = mix(cloth_color, cloth_color2, smoothstep(0.3, 0.7, n));
	cl = mix(cl, mud_color, smoothstep(0.55, 0.85, grime) * 0.7);
	cl *= 0.82 + 0.3 * grime + weave;
	vec3 sk = skin_color * (0.85 + 0.25 * n) * (0.9 + 0.2 * grime);
	vec3 c = mix(sk, cl, cloth);
	c = mix(c, boot_color * (0.8 + 0.5 * grime), boot);
	ALBEDO = c;
	ROUGHNESS = mix(0.72, 0.96, cloth) - boot * 0.35;
	SPECULAR = mix(0.35, 0.2, cloth) + boot * 0.2;
	METALLIC = 0.0;
}
"""

static func _shader(name: String) -> Shader:
	if _shaders.has(name): return _shaders[name]
	var s := Shader.new()
	match name:
		"ash": s.code = ASH_SHADER % NOISE_GLSL
		"stain": s.code = STAIN_SHADER % NOISE_GLSL
		"corpse": s.code = CORPSE_SHADER % NOISE_GLSL
	_shaders[name] = s
	return s

static func _shader_mat(name: String, params: Dictionary = {}) -> ShaderMaterial:
	var m := ShaderMaterial.new(); m.shader = _shader(name)
	for k in params: m.set_shader_parameter(k, params[k])
	return m

## Textured (or flat fallback) PBR material with vertex colours as an albedo multiplier, cached per look.
static func _std(kind_tex: String, uv: float, tint: Color, rough: float = 0.95, metal: float = 0.0) -> StandardMaterial3D:
	var key := "%s|%.2f|%s|%.2f|%.2f" % [kind_tex, uv, tint.to_html(), rough, metal]
	if _mats.has(key): return _mats[key]
	var m := Mats.pbr(kind_tex, uv, tint, { "roughness": rough, "metallic": metal }).duplicate() as StandardMaterial3D
	m.vertex_color_use_as_albedo = true
	_mats[key] = m
	return m

# ------------------------------------------------------------------------------------------------------------------
# lifecycle
# ------------------------------------------------------------------------------------------------------------------
func _ready() -> void:
	add_to_group("interactable"); add_to_group("loot_piles")
	collision_layer = 8; collision_mask = 0
	born = Game.elapsed
	_seed = float(absi(int(position.x * 7.0 + position.z * 13.0 + position.y * 3.0)) % 977)
	_rng.seed = int(_seed) * 31 + 7
	_flung_left = _rng.randf() < 0.5
	rotation.y = _rng.randf() * TAU
	var shape := CollisionShape3D.new()
	if kind == "explorer":
		var box := BoxShape3D.new(); box.size = Vector3(1.4, 0.5, 2.2); shape.shape = box; shape.position = Vector3(0.0, 0.2, 0.0)
	else:
		var sph := SphereShape3D.new(); sph.radius = 0.75; shape.shape = sph; shape.position.y = 0.25
	add_child(shape)
	_build()

func prompt() -> String:
	if items.is_empty():
		return "[E] SEARCH · %s · SEARCHED" % label if kind == "explorer" else "[E] SEARCH · %s · NOTHING LEFT" % label
	return "[E] SEARCH · %s" % label
func interact(_player: Node) -> void:
	if Game.loot != null: Game.loot.open_pile(self)
func vanish(delay: float = 0.25) -> void:
	collision_layer = 0
	remove_from_group("interactable")
	get_tree().create_timer(delay).timeout.connect(queue_free)
## Rebuild the props and the weapon after the contents changed.
func refresh() -> void:
	_build_dynamic()

## Sit on the ground: keep the yaw, tilt to the terrain normal (a body on a slope lies along it).
func align_to_ground() -> void:
	var n := Vector3.UP
	if Game.world != null and is_instance_valid(Game.world) and Game.world.has_method("get_normal"):
		var v: Variant = Game.world.get_normal(global_position.x, global_position.z)
		if v is Vector3 and v.length() > 0.5: n = v.normalized()
	if n.dot(Vector3.UP) < 0.7: n = Vector3.UP
	var yaw := rotation.y
	global_basis = Basis(Quaternion(Vector3.UP, n)) * Basis(Vector3.UP, yaw)

# ------------------------------------------------------------------------------------------------------------------
# noise and mesh helpers
# ------------------------------------------------------------------------------------------------------------------
static func _hash(x: float, y: float, z: float) -> float:
	var h := sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
	return h - floor(h)
static func _vnoise3(x: float, y: float, z: float) -> float:
	var ix := floor(x); var iy := floor(y); var iz := floor(z)
	var fx := x - ix; var fy := y - iy; var fz := z - iz
	fx = fx * fx * (3.0 - 2.0 * fx); fy = fy * fy * (3.0 - 2.0 * fy); fz = fz * fz * (3.0 - 2.0 * fz)
	var c000 := _hash(ix, iy, iz); var c100 := _hash(ix + 1, iy, iz); var c010 := _hash(ix, iy + 1, iz); var c110 := _hash(ix + 1, iy + 1, iz)
	var c001 := _hash(ix, iy, iz + 1); var c101 := _hash(ix + 1, iy, iz + 1); var c011 := _hash(ix, iy + 1, iz + 1); var c111 := _hash(ix + 1, iy + 1, iz + 1)
	var x00 := lerpf(c000, c100, fx); var x10 := lerpf(c010, c110, fx); var x01 := lerpf(c001, c101, fx); var x11 := lerpf(c011, c111, fx)
	return lerpf(lerpf(x00, x10, fy), lerpf(x01, x11, fy), fz)
static func _fbm3(x: float, y: float, z: float) -> float:
	return _vnoise3(x, y, z) * 0.55 + _vnoise3(x * 2.1 + 5.0, y * 2.1, z * 2.1 + 3.0) * 0.3 + _vnoise3(x * 4.3, y * 4.3 + 7.0, z * 4.3) * 0.15

## A heap: a flattened dome (rx, rz footprint, h high) with smooth noise on the rim and the surface, an edge that
## flares out to the ground, vertex colours darker in the hollows and at the base.
static func _mound(rx: float, rz: float, h: float, base: Color, seed_v: float, rings: int = 10, segs: int = 30, bump: float = 0.18) -> ArrayMesh:
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := []
	for i in rings + 1:
		var t := float(i) / rings
		var row := []
		for j in segs:
			var a := TAU * float(j) / segs
			var cx := cos(a); var sz := sin(a)
			var rim := _fbm3(cx * 1.7 + seed_v, 0.3, sz * 1.7 + seed_v * 0.3) - 0.5
			var surf := _fbm3(cx * t * 3.0 + seed_v * 0.7, t * 2.5, sz * t * 3.0) - 0.5
			var r := t * (1.0 + rim * bump * 1.6)
			var prof := pow(maxf(0.0, 1.0 - t * t), 1.25)
			var y := h * prof * (1.0 + surf * bump * 1.4) + h * 0.06 * surf * (1.0 - t)
			if i == rings: y = 0.0
			row.append(Vector3(cx * rx * r, maxf(0.0, y), sz * rz * r))
		pts.append(row)
	for i in rings:
		for j in segs:
			var j2 := (j + 1) % segs
			var a: Vector3 = pts[i][j]; var b: Vector3 = pts[i][j2]; var c: Vector3 = pts[i + 1][j2]; var d: Vector3 = pts[i + 1][j]
			var tris := [[a, b, c], [a, c, d]] if i > 0 else [[a, b, c], [a, c, d]]
			for tri in tris:
				var nrm: Vector3 = ((tri[1] - tri[0]).cross(tri[2] - tri[0]))
				if nrm.length() < 1e-9: continue
				nrm = nrm.normalized()
				if nrm.y < 0.0:
					nrm = -nrm; tri = [tri[0], tri[2], tri[1]]
				for v in tri:
					var hollow := _fbm3(v.x * 6.0 + seed_v, v.y * 6.0, v.z * 6.0 + seed_v)
					var shade := (0.72 + 0.4 * hollow) * (0.82 + 0.18 * clampf(v.y / maxf(0.01, h), 0.0, 1.0))
					st.set_color(base * shade); st.set_normal(nrm); st.set_uv(Vector2(v.x, v.z) * 2.0)
					st.add_vertex(v)
	st.index()
	return st.commit()

## A soft rounded box (a pack, a pouch, a duffel): faces bulge outward with smooth noise so it reads as stuffed cloth.
static func _puff(w: float, h: float, d: float, base: Color, seed_v: float, bulge: float = 0.03, n: int = 4) -> ArrayMesh:
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces := [[Vector3.UP, Vector3.RIGHT, Vector3.BACK], [Vector3.DOWN, Vector3.RIGHT, Vector3.FORWARD], [Vector3.RIGHT, Vector3.UP, Vector3.FORWARD],
		[Vector3.LEFT, Vector3.UP, Vector3.BACK], [Vector3.BACK, Vector3.UP, Vector3.RIGHT], [Vector3.FORWARD, Vector3.UP, Vector3.LEFT]]
	var half := Vector3(w, h, d) * 0.5
	for f in faces:
		var nrm: Vector3 = f[0]; var u: Vector3 = f[1]; var v: Vector3 = f[2]
		var grid := []
		for i in n + 1:
			var row := []
			for j in n + 1:
				var s := float(i) / n * 2.0 - 1.0; var t := float(j) / n * 2.0 - 1.0
				var p := (nrm + u * s + v * t) * half
				var edge := maxf(absf(s), absf(t))
				var k := pow(1.0 - edge, 1.4)
				p += nrm * bulge * k * (0.7 + 0.6 * _fbm3(p.x * 9.0 + seed_v, p.y * 9.0, p.z * 9.0 + seed_v))
				# round the corners a little so it is not a box with pillows on it
				p -= (u * s + v * t) * half * 0.06 * (1.0 - k)
				row.append(p)
			grid.append(row)
		for i in n:
			for j in n:
				var a: Vector3 = grid[i][j]; var b: Vector3 = grid[i + 1][j]; var c: Vector3 = grid[i + 1][j + 1]; var dd: Vector3 = grid[i][j + 1]
				for tri in [[a, b, c], [a, c, dd]]:
					var fn: Vector3 = ((tri[1] - tri[0]).cross(tri[2] - tri[0]))
					if fn.length() < 1e-9: continue
					fn = fn.normalized()
					if fn.dot(nrm) < 0.0: fn = -fn; tri = [tri[0], tri[2], tri[1]]
					for p in tri:
						var g := _fbm3(p.x * 11.0, p.y * 11.0 + seed_v, p.z * 11.0)
						st.set_color(base * (0.8 + 0.3 * g))
						st.set_normal(fn); st.set_uv(Vector2(p.x + p.z, p.y) * 2.0); st.add_vertex(p)
	st.index()
	var m := st.commit()
	# smooth the lighting across the bulges
	var mdt := MeshDataTool.new()
	if mdt.create_from_surface(m, 0) == OK:
		for i in mdt.get_vertex_count():
			var vpos := mdt.get_vertex(i)
			var away := vpos / half
			mdt.set_vertex_normal(i, (mdt.get_vertex_normal(i) * 0.55 + away.normalized() * 0.45).normalized())
		m = ArrayMesh.new(); mdt.commit_to_surface(m)
	return m

func _mesh(mesh: Mesh, mat: Material, pos: Vector3 = Vector3.ZERO, rot: Vector3 = Vector3.ZERO, parent: Node = null, shadows: bool = true) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); mi.mesh = mesh; mi.material_override = mat; mi.position = pos; mi.rotation = rot
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	(parent if parent != null else self).add_child(mi)
	return mi

func _stain(radius: float, color: Color, strength: float, pos: Vector3 = Vector3.ZERO, inner: float = 0.25, parent: Node = null) -> MeshInstance3D:
	var pm := PlaneMesh.new(); pm.size = Vector2(radius * 2.0, radius * 2.0); pm.subdivide_depth = 2; pm.subdivide_width = 2
	var mi := _mesh(pm, _shader_mat("stain", { "color": color, "strength": strength, "inner": inner, "seed": _seed * 0.01 }), pos + Vector3(0, 0.012, 0), Vector3.ZERO, parent, false)
	return mi

# ------------------------------------------------------------------------------------------------------------------
# build
# ------------------------------------------------------------------------------------------------------------------
func _build() -> void:
	match kind:
		"mimic": _build_mimic()
		"explorer": _build_explorer()
		_: _build_dropped()
	_build_dynamic()

## The ash heap: two overlapping mounds (the fold), a scatter of flakes and a wide soot ring.
func _build_mimic() -> void:
	var ash := _shader_mat("ash", { "seed": _seed * 0.013 })
	_stain(1.05, Color(0.035, 0.033, 0.032), 0.85, Vector3.ZERO, 0.15)
	_mesh(_mound(0.62, 0.46, 0.17, Color(1, 1, 1), _seed, 10, 30, 0.22), ash)
	_mesh(_mound(0.36, 0.27, 0.12, Color(0.92, 0.92, 0.92), _seed + 3.0, 7, 22, 0.3), ash, Vector3(0.22, 0.02, -0.14), Vector3(0, 0.6, 0))
	_mesh(_mound(0.28, 0.2, 0.08, Color(0.85, 0.85, 0.85), _seed + 9.0, 6, 18, 0.35), ash, Vector3(-0.34, 0.0, 0.18), Vector3(0, -0.4, 0))
	# flakes: thin dark chips blown a little way out
	var chip := BoxMesh.new(); chip.size = Vector3(0.05, 0.006, 0.035)
	var flake_mat := _shader_mat("ash", { "seed": _seed * 0.031 + 2.0, "base_color": Color(0.09, 0.088, 0.085) })
	for i in 14:
		var a := _rng.randf() * TAU; var r := 0.45 + _rng.randf() * 0.55
		var p := Vector3(cos(a) * r, 0.004, sin(a) * r * 0.8)
		var mi := _mesh(chip, flake_mat, p, Vector3(0, _rng.randf() * TAU, 0), null, false)
		mi.scale = Vector3(0.6 + _rng.randf() * 0.9, 1.0, 0.6 + _rng.randf() * 0.9)

## Dropped kit: a canvas duffel on its side with a webbing strap and a rolled end, the loose things beside it.
func _build_dropped() -> void:
	var canvas := _std("fabric", 3.0, Color(0.9, 0.87, 0.74), 0.95)
	var webbing := _std("fabric", 6.0, Color(0.45, 0.42, 0.34), 0.9)
	_stain(0.55, Color(0.08, 0.07, 0.06), 0.35, Vector3.ZERO, 0.4)
	var bag := _mesh(_puff(0.58, 0.24, 0.28, Color(0.40, 0.38, 0.28), _seed, 0.05), canvas, Vector3(0, 0.12, 0), Vector3(0.04, 0.35, 0.06))
	var cyl := CylinderMesh.new(); cyl.top_radius = 0.09; cyl.bottom_radius = 0.1; cyl.height = 0.1; cyl.radial_segments = 14
	_mesh(cyl, canvas, Vector3(0.3, 0.0, 0.0), Vector3(0, 0, PI * 0.5), bag)
	var strap := BoxMesh.new(); strap.size = Vector3(0.05, 0.26, 0.3)
	_mesh(strap, webbing, Vector3(-0.08, 0.0, 0.0), Vector3(0, 0, 0), bag)
	var strap2 := BoxMesh.new(); strap2.size = Vector3(0.03, 0.02, 0.36)
	_mesh(strap2, webbing, Vector3(0.05, 0.13, 0.02), Vector3(0.1, 0.0, 0.0), bag)

## The explorer: body, stain, pack; the weapon and the props come from the record.
func _build_explorer() -> void:
	var sg := 1.0 if _flung_left else -1.0
	_stain(0.7, Color(0.13, 0.04, 0.025), 0.75, Vector3(sg * 0.12, 0.0, 0.05), 0.2)
	_stain(1.1, Color(0.06, 0.05, 0.04), 0.35, Vector3(0, 0, 0.1), 0.3)
	if not _explorer_body():
		_explorer_fallback()
	_pack(Vector3(-sg * 0.72, 0.0, -0.25), Vector3(1.35, -sg * 0.5 + 0.2, 0.15))

## A rucksack thrown down on its side: stuffed body, lid flap, two shoulder straps, a bedroll under the lid.
func _pack(pos: Vector3, rot: Vector3) -> void:
	var canvas := _std("fabric", 3.0, Color(0.9, 0.86, 0.72), 0.95)
	var webbing := _std("fabric", 6.0, Color(0.5, 0.46, 0.36), 0.9)
	var root := Node3D.new(); root.position = pos + Vector3(0, 0.16, 0); root.rotation = rot; add_child(root)
	_mesh(_puff(0.36, 0.44, 0.22, Color(0.37, 0.35, 0.25), _seed + 2.0, 0.045), canvas, Vector3.ZERO, Vector3.ZERO, root)
	_mesh(_puff(0.34, 0.07, 0.24, Color(0.35, 0.33, 0.24), _seed + 4.0, 0.02), canvas, Vector3(0, 0.23, -0.02), Vector3(0.12, 0, 0), root)
	var roll := CylinderMesh.new(); roll.top_radius = 0.055; roll.bottom_radius = 0.055; roll.height = 0.36; roll.radial_segments = 12
	_mesh(roll, _std("fabric", 4.0, Color(0.62, 0.66, 0.58), 0.95), Vector3(0, 0.2, 0.1), Vector3(0, 0, PI * 0.5), root)
	var strap := BoxMesh.new(); strap.size = Vector3(0.05, 0.4, 0.018)
	_mesh(strap, webbing, Vector3(-0.1, 0.0, -0.12), Vector3(0.0, 0, 0.08), root)
	_mesh(strap, webbing, Vector3(0.1, 0.0, -0.12), Vector3(0.0, 0, -0.08), root)
	var buckle := BoxMesh.new(); buckle.size = Vector3(0.03, 0.03, 0.01)
	_mesh(buckle, _std("gunmetal", 2.0, Color(0.6, 0.6, 0.62), 0.5, 0.7), Vector3(0.1, 0.18, -0.12), Vector3.ZERO, root)

# ------------------------------------------------------------------------------------------------------------------
# the explorer's body
# ------------------------------------------------------------------------------------------------------------------
func _explorer_body() -> bool:
	if not ResourceLoader.exists("res://scripts/entities/bodies/humanoid_def.gd") or not ResourceLoader.exists("res://scripts/entities/bodies/humanoid_body.gd"): return false
	var HD: Variant = load("res://scripts/entities/bodies/humanoid_def.gd")
	var HB: Variant = load("res://scripts/entities/bodies/humanoid_body.gd")
	if HD == null or HB == null: return false
	var def: Dictionary = HD.make(HD.params("mimic", { "slouch": 0.0, "head_forward": 0.0, "arm_scale": 1.0, "bulk": 1.0, "hand_scale": 1.0 }))
	var mesh := _corpse_mesh(HB, def)
	if mesh == null: return false
	var root := Node3D.new(); root.name = "Body"
	var sk: Skeleton3D = HD.skeleton(def)
	root.add_child(sk)
	var mi := MeshInstance3D.new(); mi.name = "Skin"; mi.mesh = mesh; mi.skin = sk.create_skin_from_rest_transforms()
	mi.material_override = _shader_mat("corpse", { "seed": _seed * 0.017 })
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON; mi.lod_bias = 1.5
	sk.add_child(mi)
	add_child(root)
	_pose_corpse(sk)
	var sg := 1.0 if _flung_left else -1.0
	# lie down (about X), then roll a little onto the side of the arm across the belly (about the body's long axis)
	root.basis = Basis(Vector3.BACK, -sg * 0.2) * Basis(Vector3.RIGHT, PI * 0.5)
	root.position = Vector3(0.0, 0.1, -0.86)
	return true

func _corpse_mesh(HB: Variant, def: Dictionary) -> ArrayMesh:
	if _body_mesh != null: return _body_mesh
	if ResourceLoader.exists(BODY_CACHE):
		var r: Variant = ResourceLoader.load(BODY_CACHE, "", ResourceLoader.CACHE_MODE_IGNORE)
		if r is ArrayMesh and int(r.get_meta("gen", -1)) == BODY_GEN:
			_body_mesh = r
			return r
	var t0 := Time.get_ticks_msec()
	var m: ArrayMesh = HB.build(def, { "clothing": { "jacket": true, "trousers": true, "boots": true, "gloves": false }, "jitter": 0.0, "seed": 5.0, "detail": 0.85 })
	if m == null: return null
	var im := ImporterMesh.new()
	for s in m.get_surface_count():
		im.add_surface(m.surface_get_primitive_type(s), m.surface_get_arrays(s), [], {}, null, m.surface_get_name(s), m.surface_get_format(s))
	im.generate_lods(25.0, 60.0, [])
	var out: ArrayMesh = im.get_mesh()
	out.set_meta("gen", BODY_GEN)
	DirAccess.make_dir_recursive_absolute("res://assets/cache")
	var err := ResourceSaver.save(out, BODY_CACHE)
	print("[pile] explorer body built in %d ms (%d tris)%s" % [Time.get_ticks_msec() - t0, out.surface_get_array_index_len(0) / 3, "" if err == OK else " (cache not written)"])
	_body_mesh = out
	return out

func _rot(sk: Skeleton3D, bone: String, q: Quaternion) -> void:
	var i := sk.find_bone(bone)
	if i >= 0: sk.set_bone_pose_rotation(i, q.normalized())

## On the back, one arm flung above the head, the other across the belly, one knee up, head turned to the flung side.
## Bones rest with identity bases (+X right, +Y up, -Z forward) so the angles are readable.
func _pose_corpse(sk: Skeleton3D) -> void:
	var sg := 1.0 if _flung_left else -1.0
	var L := "l" if _flung_left else "r"
	var R := "r" if _flung_left else "l"
	var j := _rng.randf_range(-6.0, 6.0)
	# flung arm: out to the side and above the shoulder, forearm folded toward the head, hand open
	_rot(sk, "upper_arm_" + L, Quaternion(Vector3.BACK, -sg * deg_to_rad(112.0 + j)) * Quaternion(Vector3.RIGHT, deg_to_rad(-12.0)))
	_rot(sk, "forearm_" + L, Quaternion(Vector3.BACK, sg * deg_to_rad(-38.0 + j * 0.5)) * Quaternion(Vector3.RIGHT, deg_to_rad(10.0)))
	_rot(sk, "hand_" + L, Quaternion(Vector3.BACK, sg * deg_to_rad(-15.0)))
	# the other arm along the body, forearm across the belly
	_rot(sk, "upper_arm_" + R, Quaternion(Vector3.RIGHT, deg_to_rad(18.0)) * Quaternion(Vector3.BACK, -sg * deg_to_rad(14.0)))
	_rot(sk, "forearm_" + R, Quaternion(Vector3.UP, -sg * deg_to_rad(62.0)) * Quaternion(Vector3.RIGHT, deg_to_rad(96.0)))
	_rot(sk, "hand_" + R, Quaternion(Vector3.RIGHT, deg_to_rad(-20.0)))
	# head turned toward the flung arm, chin a little up
	_rot(sk, "neck", Quaternion(Vector3.UP, -sg * deg_to_rad(18.0)))
	_rot(sk, "head", Quaternion(Vector3.UP, -sg * deg_to_rad(28.0 + j)) * Quaternion(Vector3.RIGHT, deg_to_rad(-12.0)) * Quaternion(Vector3.BACK, -sg * deg_to_rad(8.0)))
	# spine twisted a touch with the roll
	_rot(sk, "spine", Quaternion(Vector3.UP, -sg * deg_to_rad(6.0)))
	# legs: the knee on the across-arm side up, the other leg straight and splayed
	_rot(sk, "thigh_" + R, Quaternion(Vector3.RIGHT, deg_to_rad(36.0 + j)) * Quaternion(Vector3.BACK, sg * deg_to_rad(10.0)))
	_rot(sk, "shin_" + R, Quaternion(Vector3.RIGHT, deg_to_rad(-70.0 - j * 1.5)))
	_rot(sk, "foot_" + R, Quaternion(Vector3.RIGHT, deg_to_rad(30.0)))
	_rot(sk, "thigh_" + L, Quaternion(Vector3.BACK, -sg * deg_to_rad(9.0)) * Quaternion(Vector3.RIGHT, deg_to_rad(4.0)))
	_rot(sk, "foot_" + L, Quaternion(Vector3.RIGHT, deg_to_rad(18.0)) * Quaternion(Vector3.BACK, -sg * deg_to_rad(25.0)))
	# fingers half curled
	for side in ["l", "r"]:
		var curl := 22.0 if side == L else 40.0
		for f in ["index", "middle", "ring", "pinky"]:
			_rot(sk, "%s_%s_1" % [f, side], Quaternion(Vector3.RIGHT, deg_to_rad(curl)))
			_rot(sk, "%s_%s_2" % [f, side], Quaternion(Vector3.RIGHT, deg_to_rad(curl * 1.2)))
		_rot(sk, "thumb_%s_1" % side, Quaternion(Vector3.UP, deg_to_rad(15.0 if side == "l" else -15.0)))

## Without the rigs scripts: a body-shaped set of mounds under a tarp, so the beat still reads from a distance.
func _explorer_fallback() -> void:
	var tarp := _std("tarp", 2.5, Color(0.72, 0.78, 0.68), 0.9)
	_mesh(_mound(0.95, 0.4, 0.28, Color(0.34, 0.4, 0.3), _seed, 10, 30, 0.12), tarp, Vector3(0, 0, 0), Vector3(0, PI * 0.5, 0))
	_mesh(_mound(0.2, 0.2, 0.2, Color(0.34, 0.4, 0.3), _seed + 7.0, 6, 18, 0.15), tarp, Vector3(0.02, 0.05, 0.85))
	_mesh(_mound(0.16, 0.25, 0.12, Color(0.32, 0.38, 0.29), _seed + 11.0, 5, 16, 0.2), tarp, Vector3(-0.1, 0.02, -0.75))
	_mesh(_mound(0.16, 0.25, 0.12, Color(0.32, 0.38, 0.29), _seed + 13.0, 5, 16, 0.2), tarp, Vector3(0.14, 0.02, -0.8))

# ------------------------------------------------------------------------------------------------------------------
# dynamic: the weapon and the props for what the pile holds
# ------------------------------------------------------------------------------------------------------------------
func _build_dynamic() -> void:
	if _prop_root != null and is_instance_valid(_prop_root): _prop_root.queue_free()
	_prop_root = Node3D.new(); _prop_root.name = "Props"; add_child(_prop_root)
	_weapon_node = null
	var prng := RandomNumberGenerator.new(); prng.seed = int(_seed) * 17 + 3
	var sg := 1.0 if _flung_left else -1.0
	match kind:
		"mimic": _weapon_on_top(Vector3(0.0, 0.17, 0.02), Vector3(0.05, 0.35, 0.12), true)
		"explorer": _weapon_on_top(Vector3(sg * 0.82, 0.03, 0.55), Vector3(0.0, sg * 0.25 + PI * 0.5, 0.0), false)
		_: _weapon_on_top(Vector3(-0.05, 0.25, 0.0), Vector3(0.0, 0.5, 0.0), false)
	var n := 0
	for e in items:
		if n >= PROP_LIMIT: break
		if str(e.get("kind", "")) == "weapon": continue
		var made := _prop_for(e, prng, n)
		if made: n += 1

## Where a prop sits: a ring around the heap for the mimic and the duffel, along the body's free side for the explorer.
func _prop_spot(prng: RandomNumberGenerator, i: int) -> Vector3:
	if kind == "explorer":
		var sg := 1.0 if _flung_left else -1.0
		var z := -0.55 + 0.32 * i + prng.randf_range(-0.08, 0.08)
		return Vector3(-sg * (0.55 + prng.randf_range(0.0, 0.35)), 0.0, z)
	var a := (0.9 + i * 1.1) + prng.randf_range(-0.3, 0.3)
	var r := 0.5 + prng.randf_range(0.0, 0.3)
	return Vector3(cos(a) * r, 0.0, sin(a) * r)

func _prop_for(e: Dictionary, prng: RandomNumberGenerator, i: int) -> bool:
	var id := str(e.get("id", ""))
	var d := Data.def(id)
	if d.is_empty(): return false
	var cat := Data.category_of(id)
	var p := _prop_spot(prng, i)
	var yaw := prng.randf() * TAU
	var gun := _std("gunmetal", 3.0, Color(0.72, 0.72, 0.74), 0.55, 0.65)
	match cat:
		"mag":
			var body := _puff(0.028, 0.16 + 0.004 * int(d.get("cap", 20)), 0.055, Color(0.28, 0.28, 0.3), _seed + i, 0.004, 2)
			var mi := _mesh(body, gun, p + Vector3(0, 0.03, 0), Vector3(PI * 0.5 - 0.12, yaw, 0.35), _prop_root)
			mi.scale = Vector3.ONE
			return true
		"ammo":
			var brass := _std("gunmetal", 2.0, Color(0.85, 0.66, 0.32), 0.35, 0.85)
			var cyl := CylinderMesh.new(); cyl.top_radius = 0.0045; cyl.bottom_radius = 0.0055; cyl.height = 0.036; cyl.radial_segments = 8
			var count := clampi(int(e.get("count", 1)) / 4, 2, 6)
			for k in count:
				var q := p + Vector3(prng.randf_range(-0.09, 0.09), 0.006, prng.randf_range(-0.09, 0.09))
				_mesh(cyl, brass, q, Vector3(PI * 0.5, prng.randf() * TAU, 0.0), _prop_root, false)
			return true
		"med":
			var pouch := _puff(0.13, 0.05, 0.09, Color(0.78, 0.76, 0.68), _seed + 20 + i, 0.012, 3)
			var mi := _mesh(pouch, _std("fabric", 5.0, Color(0.95, 0.94, 0.9), 0.9), p + Vector3(0, 0.025, 0), Vector3(0, yaw, 0.05), _prop_root)
			var band := BoxMesh.new(); band.size = Vector3(0.135, 0.052, 0.02)
			_mesh(band, _std("fabric", 5.0, Color(0.5, 0.16, 0.14), 0.9), Vector3(0, 0, 0), Vector3.ZERO, mi)
			return true
		"grenade":
			var sph := SphereMesh.new(); sph.radius = 0.028; sph.height = 0.07; sph.radial_segments = 12; sph.rings = 7
			var mi := _mesh(sph, _std("painted_metal", 3.0, Color(0.32, 0.36, 0.28), 0.7, 0.3), p + Vector3(0, 0.028, 0), Vector3(PI * 0.4, yaw, 0.0), _prop_root)
			var fuze := CylinderMesh.new(); fuze.top_radius = 0.007; fuze.bottom_radius = 0.009; fuze.height = 0.03; fuze.radial_segments = 8
			_mesh(fuze, gun, Vector3(0, 0.045, 0), Vector3.ZERO, mi)
			return true
		"helmet":
			var dome := SphereMesh.new(); dome.radius = 0.135; dome.height = 0.22; dome.radial_segments = 18; dome.rings = 9
			var mi := _mesh(dome, _std("painted_metal", 3.0, Color(0.36, 0.4, 0.3), 0.75, 0.35), p + Vector3(0, 0.04, 0), Vector3(2.6 + prng.randf_range(-0.3, 0.3), yaw, 0.2), _prop_root)
			var brim := TorusMesh.new(); brim.inner_radius = 0.12; brim.outer_radius = 0.15; brim.rings = 20; brim.ring_segments = 6
			_mesh(brim, _std("painted_metal", 3.0, Color(0.33, 0.37, 0.28), 0.75, 0.35), Vector3(0, -0.02, 0), Vector3.ZERO, mi)
			return true
		"armor", "rig", "pack", "mask", "headgear":
			var pad := _puff(0.38, 0.08, 0.3, Color(0.3, 0.32, 0.24), _seed + 30 + i, 0.02, 3)
			_mesh(pad, _std("fabric", 3.0, Color(0.9, 0.9, 0.82), 0.95), p + Vector3(0, 0.04, 0), Vector3(0.06, yaw, 0.0), _prop_root)
			return true
		"artifact":
			var orb := SphereMesh.new(); orb.radius = 0.045; orb.height = 0.09; orb.radial_segments = 14; orb.rings = 8
			var m := Mats.flat(Color(0.95, 0.55, 0.75), 0.25, 0.0, Color(1.0, 0.44, 0.66), 2.2)
			var mi := _mesh(orb, m, p + Vector3(0, 0.045, 0), Vector3.ZERO, _prop_root, false)
			var light := OmniLight3D.new(); light.light_color = Color(1.0, 0.45, 0.66); light.light_energy = 0.7; light.omni_range = 1.6; light.shadow_enabled = false
			mi.add_child(light)
			return true
		"mission", "key":
			var slip := BoxMesh.new(); slip.size = Vector3(0.11, 0.004, 0.15)
			_mesh(slip, _std("paper", 2.0, Color(0.9, 0.87, 0.78), 0.9), p + Vector3(0, 0.003, 0), Vector3(0, yaw, 0), _prop_root, false)
			return true
		"weapon":
			return false
		_:
			# tins, cells, tools, food: a small dented can with a paper label band
			var tin := CylinderMesh.new(); tin.top_radius = 0.036; tin.bottom_radius = 0.037; tin.height = 0.09; tin.radial_segments = 14
			var mi := _mesh(tin, gun, p + Vector3(0, 0.037, 0), Vector3(PI * 0.5, yaw, 0.15), _prop_root)
			var lab := CylinderMesh.new(); lab.top_radius = 0.0375; lab.bottom_radius = 0.0375; lab.height = 0.05; lab.radial_segments = 14
			_mesh(lab, _std("paper", 2.0, Color(0.7, 0.66, 0.55), 0.9), Vector3.ZERO, Vector3.ZERO, mi)
			return true

## The dropped weapon: GunBuilder's model when the weapons agent has landed it, else a shaped silhouette (receiver,
## barrel and front sight, curved magazine, handguard, pistol grip, stock) sized from the catalogue.
func _weapon_on_top(pos: Vector3, rot: Vector3, on_side: bool) -> void:
	var w: Dictionary = {}
	for e in items:
		if str(e.get("kind", "")) == "weapon" and e.get("inst") is Dictionary: w = e["inst"]; break
	if w.is_empty(): return
	var d: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
	var node: Node3D = null
	if ResourceLoader.exists("res://scripts/weapons/gun_builder.gd"):
		var gb: Variant = load("res://scripts/weapons/gun_builder.gd")
		if gb != null:
			var built: Variant = gb.build(d, w)
			if built is Node3D: node = built
	if node == null: node = _gun_silhouette(d, w)
	node.position = pos; node.rotation = rot
	if on_side: node.rotation.x += 1.45   # rolled onto its side across the ash
	_prop_root.add_child(node); _weapon_node = node

func _gun_silhouette(d: Dictionary, w: Dictionary) -> Node3D:
	var node := Node3D.new()
	var kg := float(d.get("weight", 3.0)); var cls := str(d.get("cls", "rifle"))
	var pistol := cls == "pistol" and int(d.get("internal", 0)) == 0
	var length := 0.24 if pistol else clampf(0.55 + kg * 0.12, 0.62, 1.25)
	var gun := _std("gunmetal", 3.0, Color(0.7, 0.7, 0.72), 0.5, 0.7)
	var wood := _std("wood", 3.0, Color(0.62, 0.5, 0.34), 0.75)
	var recv := BoxMesh.new(); recv.size = Vector3(length * 0.4, 0.062, 0.036)
	_mesh(recv, gun, Vector3(0, 0, 0), Vector3.ZERO, node)
	var barrel := CylinderMesh.new(); barrel.top_radius = 0.0095; barrel.bottom_radius = 0.011; barrel.height = length * 0.52; barrel.radial_segments = 10
	_mesh(barrel, gun, Vector3(length * 0.45, 0.014, 0), Vector3(0, 0, PI * 0.5), node)
	var sight := BoxMesh.new(); sight.size = Vector3(0.012, 0.04, 0.012)
	_mesh(sight, gun, Vector3(length * 0.68, 0.04, 0), Vector3.ZERO, node)
	if not pistol:
		var hg := BoxMesh.new(); hg.size = Vector3(length * 0.22, 0.05, 0.04)
		_mesh(hg, wood, Vector3(length * 0.3, 0.0, 0), Vector3.ZERO, node)
		var stock := BoxMesh.new(); stock.size = Vector3(length * 0.28, 0.055, 0.03)
		_mesh(stock, wood, Vector3(-length * 0.33, -0.012, 0), Vector3(0, 0, -0.1), node)
		var butt := BoxMesh.new(); butt.size = Vector3(0.03, 0.1, 0.035)
		_mesh(butt, wood, Vector3(-length * 0.46, -0.025, 0), Vector3(0, 0, -0.1), node)
	var grip := BoxMesh.new(); grip.size = Vector3(0.03, 0.075, 0.026)
	_mesh(grip, wood if not pistol else gun, Vector3(-length * 0.1, -0.055, 0), Vector3(0, 0, 0.35), node)
	var guard := BoxMesh.new(); guard.size = Vector3(0.06, 0.004, 0.02)
	_mesh(guard, gun, Vector3(-length * 0.03, -0.05, 0), Vector3.ZERO, node)
	if w.get("mag") is Dictionary:
		var cap := int(Data.magazines.get(str(w["mag"].get("id", "")), {}).get("cap", 10))
		var mh := clampf(0.05 + cap * 0.0035, 0.06, 0.19)
		var mag := BoxMesh.new(); mag.size = Vector3(0.028, mh, 0.024)
		_mesh(mag, gun, Vector3(length * 0.06, -mh * 0.5 - 0.02, 0), Vector3(0, 0, 0.3), node)
		if cap >= 20:
			var mag2 := BoxMesh.new(); mag2.size = Vector3(0.028, mh * 0.45, 0.024)
			_mesh(mag2, gun, Vector3(length * 0.06 + mh * 0.32, -mh * 0.82 - 0.02, 0), Vector3(0, 0, 0.75), node)
	return node
