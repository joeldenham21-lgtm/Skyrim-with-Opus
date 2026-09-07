extends "res://tools/scenarios/_driver.gd"
## Texture exhibit: every generated PBR set on a cube and a sphere, every foliage card, every decal, and a
## tiling check plane at uv scale 4. Renders with its own camera so it does not depend on terrain or the player.
##
##   tools/shot.sh tools/scenarios/textures.gd 1920x1080      (TIMEOUT=900 recommended)

const KINDS := [
	"concrete", "plaster", "brick", "rust", "painted_metal", "gunmetal",
	"wood", "logs", "birch_bark", "pine_bark", "fabric", "leather",
	"rubber", "mud", "gravel", "road", "asphalt", "roof_tile",
	"roof_metal", "grass", "dirt", "rock", "sand", "moss",
	"tarp", "paper", "glass", "tiles", "wallpaper", "linoleum",
	"roof_slate", "sheet_metal", "camo", "bone", "canvas",
]
const BASE := Vector3(0.0, 80.0, 0.0)   ## the exhibit floats well above any terrain another agent installs
const STEP := 6.0
const COLS := 5

var root: Node3D
var cam: Camera3D
var placed: Dictionary = {}          ## kind -> world position of its cube
var card_quads: Array = []           ## [{name, pos}]
var decal_quads: Array = []

func run() -> void:
	await start(true)
	_tune_environment()
	root = Node3D.new()
	root.name = "TextureExhibit"
	get_tree().current_scene.add_child(root)
	cam = Camera3D.new()
	cam.fov = 55.0
	cam.far = 400.0
	root.add_child(cam)
	cam.current = true
	_floor()
	_materials()
	_cards()
	_decals()
	_tiling()
	set_hour(11.0)
	await frames(8)

	# --- overview rows
	var rows := int(ceil(float(KINDS.size()) / COLS))
	for r in range(0, rows, 2):
		var z: float = BASE.z + r * STEP + STEP * 0.5
		_cam_at(Vector3(BASE.x + (COLS - 1) * STEP * 0.5, BASE.y + 3.4, z - 9.0), Vector3(BASE.x + (COLS - 1) * STEP * 0.5, BASE.y + 1.2, z + 2.0))
		await frames(4)
		await shot("mats-row%d" % r)

	# --- close-ups: the surfaces the player stands next to
	for k in ["concrete", "plaster", "brick", "wood", "logs", "rust", "birch_bark", "pine_bark",
			  "roof_tile", "gravel", "mud", "grass", "painted_metal", "roof_metal", "rock", "fabric"]:
		if not placed.has(k):
			continue
		var p: Vector3 = placed[k]
		_cam_at(p + Vector3(0.0, 0.55, -1.85), p + Vector3(0.0, 0.1, 0.0))
		await frames(3)
		await shot("close-%s" % k)

	# --- cards
	for i in range(card_quads.size()):
		var c: Dictionary = card_quads[i]
		var cp: Vector3 = c["pos"]
		_cam_at(cp + Vector3(0.0, 0.0, -2.6), cp)
		await frames(3)
		await shot("card-%s" % c["name"])

	# --- decals, four panels per frame
	var dz := 0
	while dz * 6 < decal_quads.size():
		var mid: Vector3 = decal_quads[min(dz * 6 + 2, decal_quads.size() - 1)]["pos"]
		_cam_at(Vector3(mid.x, mid.y, mid.z - 7.5), Vector3(mid.x, mid.y, mid.z))
		await frames(3)
		await shot("decals-%d" % dz)
		dz += 1

	# --- tiling: the same plane from grazing and from above
	_cam_at(BASE + Vector3(-26.0, 1.4, -34.0), BASE + Vector3(-14.0, 0.0, -22.0))
	await frames(4)
	await shot("tiling-graze")
	_cam_at(BASE + Vector3(-14.0, 11.0, -22.01), BASE + Vector3(-14.0, 0.0, -22.0))
	await frames(4)
	await shot("tiling-top")
	print("[stats] ", JSON.stringify(stats()))

# ---------------------------------------------------------------- helpers

func _cam_at(pos: Vector3, target: Vector3) -> void:
	cam.global_position = pos
	cam.look_at(target, Vector3.UP)

func _tune_environment() -> void:
	## Software Vulkan cannot afford SDFGI or volumetric fog for a 1920x1080 still; the exhibit only needs
	## a sun, sky ambient and a short shadow distance.
	for n in get_tree().current_scene.get_children():
		if n is WorldEnvironment:
			var e: Environment = (n as WorldEnvironment).environment
			e.sdfgi_enabled = false
			e.volumetric_fog_enabled = false
			e.fog_enabled = false
			e.ssao_enabled = true
			e.ssao_radius = 0.6
			e.ssao_intensity = 1.4
			e.adjustment_enabled = false
		if n is DirectionalLight3D:
			var l := n as DirectionalLight3D
			l.directional_shadow_max_distance = 60.0
			l.light_energy = 1.15

func _floor() -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(220, 220)
	mi.mesh = pm
	mi.position = BASE + Vector3(0, -1.0, 30)
	mi.material_override = Mats.flat(Color(0.20, 0.20, 0.19), 0.95)
	root.add_child(mi)

func _materials() -> void:
	for i in range(KINDS.size()):
		var kind: String = KINDS[i]
		if not Mats.has_set(kind):
			continue
		var col := i % COLS
		var row := i / COLS
		var p := BASE + Vector3(col * STEP, 1.0, row * STEP)
		var mat := Mats.pbr(kind, 1.0, Color.WHITE, {"parallax": true, "parallax_scale": 0.02})
		var cube := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(2.0, 2.0, 2.0)
		cube.mesh = bm
		cube.position = p
		cube.material_override = mat
		root.add_child(cube)
		var sph := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.95
		sm.height = 1.9
		sm.radial_segments = 64
		sm.rings = 32
		sph.mesh = sm
		sph.position = p + Vector3(2.6, 0.0, 0.0)
		sph.material_override = mat
		root.add_child(sph)
		var lab := Label3D.new()
		lab.text = kind
		lab.font_size = 96
		lab.pixel_size = 0.0022
		lab.position = p + Vector3(0.6, -1.25, -1.3)
		lab.modulate = Color(0.85, 0.84, 0.8)
		lab.billboard = BaseMaterial3D.BILLBOARD_DISABLED
		lab.rotation_degrees = Vector3(0, 180, 0)
		root.add_child(lab)
		placed[kind] = p + Vector3(0, 0, -1.0)

func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	var d: Variant = JSON.parse_string(f.get_as_text())
	return d if d is Dictionary else {}

func _cards() -> void:
	var doc := _read_json("res://assets/textures/cards/atlas.json")
	if doc.is_empty():
		push_warning("textures.gd: no cards/atlas.json")
		return
	var atlases: Dictionary = doc.get("atlases", {})
	var x := -14.0
	for name in atlases.keys():
		var a: Dictionary = atlases[name]
		var alb: String = "res://assets/textures/" + str(a.get("albedo", ""))
		if not ResourceLoader.exists(alb):
			continue
		var cards: Array = a.get("cards", [])
		for c in cards:
			var uv: Array = c.get("uv", [0, 0, 1, 1])
			var m := StandardMaterial3D.new()
			m.albedo_texture = load(alb)
			m.uv1_scale = Vector3(uv[2] - uv[0], uv[3] - uv[1], 1.0)
			m.uv1_offset = Vector3(uv[0], uv[1], 0.0)
			var nrm: String = "res://assets/textures/" + str(a.get("normal", ""))
			if ResourceLoader.exists(nrm):
				m.normal_enabled = true
				m.normal_texture = load(nrm)
			var orm: String = "res://assets/textures/" + str(a.get("orm", ""))
			if ResourceLoader.exists(orm):
				m.ao_enabled = true
				m.ao_texture = load(orm)
				m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
				m.roughness_texture = load(orm)
				m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
			m.alpha_scissor_threshold = 0.4
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
			m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
			var sz: Array = c.get("size_m", [1.0, 1.0])
			var q := MeshInstance3D.new()
			var qm := QuadMesh.new()
			var w := maxf(1.4, float(sz[0]) * 2.2)
			var hgt := maxf(1.0, float(sz[1]) * 2.2)
			qm.size = Vector2(w, hgt)
			q.mesh = qm
			var pos := BASE + Vector3(x, hgt * 0.5 - 0.6, -14.0)
			q.position = pos
			q.rotation_degrees = Vector3(0, 180, 0)
			q.material_override = m
			root.add_child(q)
			var lab := Label3D.new()
			lab.text = str(c.get("name", "card"))
			lab.font_size = 64
			lab.pixel_size = 0.0022
			lab.position = pos + Vector3(0, -hgt * 0.5 - 0.25, 0)
			lab.rotation_degrees = Vector3(0, 180, 0)
			root.add_child(lab)
			card_quads.append({"name": str(c.get("name", "card")), "pos": pos})
			x += w + 0.7

func _decals() -> void:
	var doc := _read_json("res://assets/textures/decals/decals.json")
	if doc.is_empty():
		push_warning("textures.gd: no decals/decals.json")
		return
	var list: Array = doc.get("decals", [])
	var i := 0
	for e in list:
		var alb: String = "res://assets/textures/" + str(e.get("albedo", ""))
		if not ResourceLoader.exists(alb):
			continue
		var m := StandardMaterial3D.new()
		m.albedo_texture = load(alb)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		var nrm: String = "res://assets/textures/" + str(e.get("normal", ""))
		if ResourceLoader.exists(nrm):
			m.normal_enabled = true
			m.normal_texture = load(nrm)
		# a backing panel of concrete so the decal is seen against a surface, as in game
		var back := MeshInstance3D.new()
		var bq := QuadMesh.new()
		bq.size = Vector2(2.6, 2.6)
		back.mesh = bq
		var px: Array = e.get("size_px", [512, 512])
		var pos := BASE + Vector3(-16.0 + (i % 6) * 3.0, 1.4 + float(i / 6) * 3.0, -22.0)
		back.position = pos
		back.rotation_degrees = Vector3(0, 180, 0)
		back.material_override = Mats.pbr("concrete", 1.3)
		root.add_child(back)
		var q := MeshInstance3D.new()
		var qm := QuadMesh.new()
		var ar := float(px[0]) / maxf(1.0, float(px[1]))
		qm.size = Vector2(2.3 * minf(1.0, ar), 2.3 / maxf(1.0, ar))
		q.mesh = qm
		q.position = pos + Vector3(0, 0, -0.02)
		q.rotation_degrees = Vector3(0, 180, 0)
		q.material_override = m
		root.add_child(q)
		var lab := Label3D.new()
		lab.text = str(e.get("name", ""))
		lab.font_size = 48
		lab.pixel_size = 0.0022
		lab.position = pos + Vector3(0, -1.45, -0.05)
		lab.rotation_degrees = Vector3(0, 180, 0)
		root.add_child(lab)
		decal_quads.append({"name": str(e.get("name", "")), "pos": pos})
		i += 1

func _tiling() -> void:
	## Four planes at uv scale 4: if the tile is not exact the seams show as a grid at this angle.
	var kinds := ["concrete", "brick", "grass", "gravel"]
	for i in range(kinds.size()):
		if not Mats.has_set(kinds[i]):
			continue
		var mi := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(9.0, 9.0)
		mi.mesh = pm
		mi.position = BASE + Vector3(-22.0 + (i % 2) * 10.0, 0.02, -26.0 - (i / 2) * 10.0)
		mi.material_override = Mats.pbr(kinds[i], 4.0)
		root.add_child(mi)
		var lab := Label3D.new()
		lab.text = kinds[i] + " uv4"
		lab.font_size = 64
		lab.pixel_size = 0.0025
		lab.position = mi.position + Vector3(0, 0.05, 4.8)
		lab.rotation_degrees = Vector3(-90, 180, 0)
		root.add_child(lab)
