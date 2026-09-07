extends StaticBody3D
## A loot pile on the ground: what a mimic leaves when it folds (ash and its gun), an explorer who did not make it back
## (a body under a tarp with a pack), or dropped kit. Interactable ("[E] SEARCH · MIMIC"); contents live in Loot's
## record for this node and open in the loot panel. Meshes are built here in a few hundred triangles; the dropped
## weapon is the real GunBuilder model when that script exists.
var kind := "pile"           # mimic | explorer | pile
var label := "PILE"
var items: Array = []
var born := 0.0
var _weapon_node: Node3D = null

func _ready() -> void:
	add_to_group("interactable"); add_to_group("loot_piles")
	collision_layer = 8; collision_mask = 0
	born = Game.elapsed
	var shape := CollisionShape3D.new(); var sph := SphereShape3D.new(); sph.radius = 0.6 if kind != "explorer" else 0.9
	shape.shape = sph; shape.position.y = 0.25; add_child(shape)
	_build()

func prompt() -> String:
	if items.is_empty() and kind != "explorer": return "[E] SEARCH · %s · NOTHING LEFT" % label
	return "[E] SEARCH · %s" % label
func interact(_player: Node) -> void:
	if Game.loot != null: Game.loot.open_pile(self)
func vanish(delay: float = 0.25) -> void:
	collision_layer = 0
	remove_from_group("interactable")
	get_tree().create_timer(delay).timeout.connect(queue_free)
func refresh() -> void:
	# the weapon on top goes when it is taken
	if _weapon_node != null and is_instance_valid(_weapon_node):
		var still := false
		for e in items: if str(e.get("kind", "")) == "weapon": still = true
		if not still: _weapon_node.queue_free(); _weapon_node = null

# ------------------------------------------------------------------------------------------------------------------
# meshes
# ------------------------------------------------------------------------------------------------------------------
static func _hash(x: float, y: float, z: float) -> float:
	var h := sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
	return h - floor(h)

## A mound: a flattened dome (rx, rz footprint, h high) with hashed bumps, vertex colours darkened in the creases.
static func _mound(rx: float, rz: float, h: float, base: Color, seed_v: float, rings: int = 7, segs: int = 22, bump: float = 0.25) -> ArrayMesh:
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := []
	for i in rings + 1:
		var t := float(i) / rings
		var row := []
		for j in segs:
			var a := TAU * float(j) / segs
			var n := _hash(cos(a) * 3.0 + seed_v, t * 5.0, sin(a) * 3.0)
			var n2 := _hash(cos(a) * 7.0, t * 11.0 + seed_v, sin(a) * 7.0 + seed_v)
			var r := t * (1.0 + (n - 0.5) * bump * 0.8)
			var y := h * (1.0 - t * t) * (1.0 + (n2 - 0.5) * bump) + (1.0 - t) * h * 0.08 * (n - 0.5)
			if i == rings: y = 0.0
			row.append(Vector3(cos(a) * rx * r, maxf(0.0, y), sin(a) * rz * r))
		pts.append(row)
	for i in rings:
		for j in segs:
			var j2 := (j + 1) % segs
			var a: Vector3 = pts[i][j]; var b: Vector3 = pts[i][j2]; var c: Vector3 = pts[i + 1][j2]; var d: Vector3 = pts[i + 1][j]
			for tri in [[a, b, c], [a, c, d]]:
				var nrm: Vector3 = ((tri[1] - tri[0]).cross(tri[2] - tri[0])).normalized()
				if nrm.y < 0.0:
					# Godot front faces wind counter-clockwise: flip the triangle so the dome faces the sky
					nrm = -nrm; tri = [tri[0], tri[2], tri[1]]
				for v in tri:
					var shade := 0.82 + 0.18 * _hash(v.x * 9.0, v.y * 9.0 + seed_v, v.z * 9.0) * clampf(v.y / maxf(0.01, h) + 0.5, 0.0, 1.0)
					st.set_color(base * shade); st.set_normal(nrm); st.set_uv(Vector2(v.x, v.z))
					st.add_vertex(v)
	st.index()
	return st.commit()

## A soft rounded box (a pack, a pouch): a box whose faces bulge outward.
static func _puff(w: float, h: float, d: float, base: Color, seed_v: float, bulge: float = 0.03) -> ArrayMesh:
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces := [[Vector3.UP, Vector3.RIGHT, Vector3.BACK], [Vector3.DOWN, Vector3.RIGHT, Vector3.FORWARD], [Vector3.RIGHT, Vector3.UP, Vector3.FORWARD],
		[Vector3.LEFT, Vector3.UP, Vector3.BACK], [Vector3.BACK, Vector3.UP, Vector3.RIGHT], [Vector3.FORWARD, Vector3.UP, Vector3.LEFT]]
	var half := Vector3(w, h, d) * 0.5
	var n := 3
	for f in faces:
		var nrm: Vector3 = f[0]; var u: Vector3 = f[1]; var v: Vector3 = f[2]
		var grid := []
		for i in n + 1:
			var row := []
			for j in n + 1:
				var s := float(i) / n * 2.0 - 1.0; var t := float(j) / n * 2.0 - 1.0
				var p := (nrm + u * s + v * t) * half
				var edge := maxf(absf(s), absf(t))
				p += nrm * bulge * pow(1.0 - edge, 1.5) * (0.8 + 0.4 * _hash(p.x * 5.0 + seed_v, p.y * 5.0, p.z * 5.0))
				row.append(p)
			grid.append(row)
		for i in n:
			for j in n:
				var a: Vector3 = grid[i][j]; var b: Vector3 = grid[i + 1][j]; var c: Vector3 = grid[i + 1][j + 1]; var dd: Vector3 = grid[i][j + 1]
				for tri in [[a, b, c], [a, c, dd]]:
					var fn: Vector3 = ((tri[1] - tri[0]).cross(tri[2] - tri[0])).normalized()
					if fn.dot(nrm) < 0.0: fn = -fn; tri = [tri[0], tri[2], tri[1]]
					for p in tri:
						st.set_color(base * (0.86 + 0.14 * _hash(p.x * 13.0, p.y * 13.0 + seed_v, p.z * 13.0)))
						st.set_normal(fn); st.set_uv(Vector2(p.x + p.z, p.y) * 2.0); st.add_vertex(p)
	st.index()
	return st.commit()

func _mat(kind_tex: String, uv: float, tint: Color, rough: float = 0.95) -> StandardMaterial3D:
	var m := Mats.pbr(kind_tex, uv, tint, { "roughness": rough }).duplicate() as StandardMaterial3D
	m.vertex_color_use_as_albedo = true
	return m

func _mesh(mesh: Mesh, mat: Material, pos: Vector3 = Vector3.ZERO, rot: Vector3 = Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); mi.mesh = mesh; mi.material_override = mat; mi.position = pos; mi.rotation = rot
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mi); return mi

func _build() -> void:
	var seed_v := float(absi(int(global_position.x * 7.0 + global_position.z * 13.0)) % 977)
	rotation.y = _hash(seed_v, 1.0, 2.0) * TAU
	match kind:
		"mimic":
			# ash: a dark grey mound with a paler crust, and the gun lying across it
			_mesh(_mound(0.6, 0.46, 0.19, Color(0.16, 0.155, 0.15), seed_v, 7, 24, 0.35), _mat("dirt", 4.0, Color(0.42, 0.4, 0.38), 1.0))
			_mesh(_mound(0.34, 0.28, 0.12, Color(0.22, 0.21, 0.2), seed_v + 3.0, 5, 18, 0.5), _mat("dirt", 6.0, Color(0.5, 0.48, 0.46), 1.0), Vector3(0.08, 0.03, -0.05))
			_weapon_on_top(Vector3(0.0, 0.17, 0.02), Vector3(0.05, 0.35, 0.12))
		"explorer":
			# a body under a tarp: the long mound with a head and a boot end, the tarp's hem flaring to the ground; the
			# pack thrown down beside it
			var tarp := _mat("tarp", 2.5, Color(0.72, 0.78, 0.68), 0.9)
			_mesh(_mound(0.95, 0.4, 0.3, Color(0.34, 0.4, 0.3), seed_v, 8, 26, 0.18), tarp)
			_mesh(_mound(0.22, 0.2, 0.2, Color(0.34, 0.4, 0.3), seed_v + 7.0, 5, 16, 0.2), tarp, Vector3(0.7, 0.06, 0.02))
			_mesh(_mound(0.24, 0.17, 0.13, Color(0.32, 0.38, 0.29), seed_v + 11.0, 4, 14, 0.25), tarp, Vector3(-0.76, 0.03, -0.06), Vector3(0, 0.3, 0))
			_mesh(_puff(0.34, 0.2, 0.44, Color(0.36, 0.34, 0.26), seed_v + 2.0, 0.035), _mat("fabric", 3.0, Color(0.9, 0.86, 0.72), 0.95), Vector3(0.35, 0.1, 0.52), Vector3(0.1, 0.7, 0.15))
			_mesh(_puff(0.12, 0.05, 0.16, Color(0.5, 0.46, 0.38), seed_v + 5.0, 0.01), _mat("leather", 3.0, Color(0.9, 0.85, 0.8), 0.7), Vector3(-0.2, 0.03, 0.42), Vector3(0, 1.2, 0))
			_weapon_on_top(Vector3(0.1, 0.05, -0.5), Vector3(0.0, 0.2, 0.0))
		_:
			# dropped kit: a canvas bag and a couple of loose pouches
			_mesh(_puff(0.42, 0.22, 0.3, Color(0.4, 0.38, 0.28), seed_v, 0.04), _mat("fabric", 3.0, Color(0.9, 0.87, 0.74), 0.95), Vector3(0, 0.11, 0), Vector3(0.05, 0.4, 0.08))
			_mesh(_puff(0.16, 0.08, 0.12, Color(0.32, 0.3, 0.22), seed_v + 1.0, 0.015), _mat("fabric", 4.0, Color(0.8, 0.78, 0.66), 0.95), Vector3(0.3, 0.04, 0.12), Vector3(0, 1.0, 0))
			_weapon_on_top(Vector3(-0.05, 0.24, 0.0), Vector3(0.0, 0.5, 0.0))

## The dropped weapon lies on the pile: GunBuilder's model when the weapons agent has landed it, else a plain
## gunmetal silhouette (receiver, barrel, stock) sized from the catalogue weight so it still reads as a rifle or a pistol.
func _weapon_on_top(pos: Vector3, rot: Vector3) -> void:
	var w: Dictionary = {}
	for e in items:
		if str(e.get("kind", "")) == "weapon" and e.get("inst") is Dictionary: w = e["inst"]; break
	if w.is_empty(): return
	var d: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
	var node: Node3D = null
	if ResourceLoader.exists("res://scripts/weapons/gun_builder.gd"):
		var gb: Variant = load("res://scripts/weapons/gun_builder.gd")
		if gb != null and gb.has_method("build"):
			var built: Variant = gb.build(d, w)
			if built is Node3D: node = built
	if node == null:
		node = Node3D.new()
		var kg := float(d.get("weight", 3.0)); var cls := str(d.get("cls", "rifle"))
		var length := 0.28 if cls == "pistol" else clampf(0.55 + kg * 0.12, 0.6, 1.2)
		var gun := Mats.pbr("gunmetal", 3.0, Color(0.7, 0.7, 0.72), { "roughness": 0.55, "metallic": 0.6 })
		var wood := Mats.pbr("wood", 3.0, Color(0.6, 0.5, 0.36))
		var recv := BoxMesh.new(); recv.size = Vector3(length * 0.42, 0.06, 0.035)
		var mi := MeshInstance3D.new(); mi.mesh = recv; mi.material_override = gun; node.add_child(mi)
		var barrel := CylinderMesh.new(); barrel.top_radius = 0.011; barrel.bottom_radius = 0.011; barrel.height = length * 0.5
		var b := MeshInstance3D.new(); b.mesh = barrel; b.material_override = gun; b.rotation.z = PI / 2; b.position = Vector3(length * 0.42, 0.012, 0); node.add_child(b)
		if cls != "pistol":
			var stock := BoxMesh.new(); stock.size = Vector3(length * 0.3, 0.05, 0.03)
			var s := MeshInstance3D.new(); s.mesh = stock; s.material_override = wood; s.position = Vector3(-length * 0.34, -0.01, 0); s.rotation.z = -0.08; node.add_child(s)
		var grip := BoxMesh.new(); grip.size = Vector3(0.03, 0.07, 0.025)
		var g := MeshInstance3D.new(); g.mesh = grip; g.material_override = wood; g.position = Vector3(-length * 0.08, -0.05, 0); g.rotation.z = 0.35; node.add_child(g)
		if w.get("mag") is Dictionary:
			var mag := BoxMesh.new(); mag.size = Vector3(0.03, 0.09, 0.025)
			var m := MeshInstance3D.new(); m.mesh = mag; m.material_override = gun; m.position = Vector3(length * 0.05, -0.06, 0); m.rotation.z = 0.2; node.add_child(m)
	node.position = pos; node.rotation = rot
	if kind == "mimic": node.rotation.x += 1.45   # rolled onto its side across the ash
	add_child(node); _weapon_node = node
