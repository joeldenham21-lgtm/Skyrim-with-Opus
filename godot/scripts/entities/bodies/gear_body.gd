class_name GearBody
## Worn gear for the humanoid rigs, chosen by catalogue id (data/armor.json): vests and plate carriers, helmets,
## gas masks and respirators, backpacks, chest rigs and belts, headlamps and night-vision sets, plus the seeker's
## armour suit and searchlight. Every piece is a skinned mesh bound to the body bones so it deforms with the
## animation, built with SkinBuilder over the body's torso profile (HumanoidBody.PROF) so it sits outside the
## jacket, and cached to assets/cache/rig_gear_<id>_<kind>.res. Materials come from Mats (real PBR sets when the
## texture generator has run, flat weathered colours otherwise) with per-vertex grime so no two panels read flat.
const RB := preload("res://scripts/entities/rig_builder.gd")
static var _mats := {}

# ---------------------------------------------------------------- catalogue → recipe
static func recipe(id: String) -> Dictionary:
	match id:
		# vests: thick (m), y range (H=1.8 units), collar, shoulder pads, plates, pouches, arm guards, groin
		"vest_paca": return { "kind": "vest", "thick": 0.014, "y0": 1.04, "y1": 1.44, "colour": Color(0.36, 0.37, 0.30), "tex": "fabric", "pouches": 0 }
		"vest_6b2": return { "kind": "vest", "thick": 0.018, "y0": 1.00, "y1": 1.45, "colour": Color(0.33, 0.35, 0.26), "tex": "fabric", "pouches": 2, "collar": false, "flak": true }
		"vest_kirasa": return { "kind": "vest", "thick": 0.02, "y0": 0.98, "y1": 1.46, "colour": Color(0.30, 0.30, 0.27), "tex": "fabric", "pouches": 3, "flak": true }
		"vest_6b23_1": return { "kind": "vest", "thick": 0.022, "y0": 0.97, "y1": 1.47, "colour": Color(0.31, 0.34, 0.24), "tex": "fabric", "pouches": 3, "collar": true, "flak": true }
		"vest_6b23_2": return { "kind": "vest", "thick": 0.026, "y0": 0.96, "y1": 1.47, "colour": Color(0.30, 0.33, 0.23), "tex": "fabric", "pouches": 3, "collar": true, "flak": true, "plates": true }
		"vest_zhuk": return { "kind": "vest", "thick": 0.02, "y0": 1.05, "y1": 1.44, "colour": Color(0.22, 0.24, 0.20), "tex": "fabric", "pouches": 3, "plates": true, "cummerbund": true }
		"vest_iotv": return { "kind": "vest", "thick": 0.024, "y0": 0.98, "y1": 1.45, "colour": Color(0.42, 0.40, 0.30), "tex": "fabric", "pouches": 4, "plates": true, "cummerbund": true, "collar": true, "shoulder_pads": true }
		"vest_6b43": return { "kind": "vest", "thick": 0.028, "y0": 0.94, "y1": 1.47, "colour": Color(0.29, 0.33, 0.22), "tex": "fabric", "pouches": 4, "plates": true, "collar": true, "shoulder_pads": true, "arm_guards": true, "groin": true }
		"vest_fort": return { "kind": "vest", "thick": 0.026, "y0": 0.95, "y1": 1.47, "colour": Color(0.20, 0.21, 0.20), "tex": "fabric", "pouches": 3, "plates": true, "collar": true, "shoulder_pads": true, "arm_guards": true, "groin": true }
		# helmets
		"helm_ssh68": return { "kind": "helmet", "style": "steel", "colour": Color(0.30, 0.33, 0.24), "tex": "painted_metal" }
		"helm_6b7": return { "kind": "helmet", "style": "aramid", "colour": Color(0.33, 0.35, 0.27), "tex": "fabric" }
		"helm_6b47": return { "kind": "helmet", "style": "aramid", "rails": true, "colour": Color(0.31, 0.33, 0.25), "tex": "fabric" }
		"helm_kiver": return { "kind": "helmet", "style": "aramid", "colour": Color(0.24, 0.25, 0.22), "tex": "fabric", "deep": true }
		"helm_zsh": return { "kind": "helmet", "style": "titanium", "visor": true, "colour": Color(0.26, 0.27, 0.25), "tex": "painted_metal" }
		"helm_altyn": return { "kind": "helmet", "style": "titanium", "visor": true, "full": true, "colour": Color(0.28, 0.28, 0.26), "tex": "painted_metal" }
		"helm_ach": return { "kind": "helmet", "style": "aramid", "rails": true, "colour": Color(0.36, 0.34, 0.26), "tex": "fabric" }
		# masks
		"mask_resp": return { "kind": "mask", "style": "resp", "colour": Color(0.75, 0.72, 0.65), "tex": "rubber" }
		"mask_gp5": return { "kind": "mask", "style": "hood", "colour": Color(0.42, 0.44, 0.42), "tex": "rubber" }
		"mask_gp7": return { "kind": "mask", "style": "face", "colour": Color(0.16, 0.17, 0.16), "tex": "rubber" }
		# packs (w, h, d)
		"pack_tortilla": return { "kind": "backpack", "size": Vector3(0.28, 0.34, 0.15), "colour": Color(0.34, 0.33, 0.26), "tex": "fabric" }
		"pack_pilgrim": return { "kind": "backpack", "size": Vector3(0.32, 0.42, 0.19), "colour": Color(0.30, 0.32, 0.24), "tex": "fabric", "lid": true }
		"pack_attack2": return { "kind": "backpack", "size": Vector3(0.34, 0.48, 0.23), "colour": Color(0.26, 0.28, 0.21), "tex": "fabric", "lid": true, "side": true }
		"pack_6sh118": return { "kind": "backpack", "size": Vector3(0.38, 0.56, 0.27), "colour": Color(0.29, 0.32, 0.22), "tex": "fabric", "lid": true, "side": true, "roll": true }
		# rigs
		"rig_belt": return { "kind": "rig", "style": "belt", "colour": Color(0.28, 0.25, 0.18), "tex": "leather" }
		"rig_6sh112": return { "kind": "rig", "style": "chest", "pouches": 4, "colour": Color(0.31, 0.34, 0.24), "tex": "fabric" }
		"rig_alpha": return { "kind": "rig", "style": "chest", "pouches": 3, "utility": 2, "colour": Color(0.26, 0.27, 0.22), "tex": "fabric" }
		"rig_tv110": return { "kind": "rig", "style": "panel", "pouches": 3, "utility": 2, "colour": Color(0.22, 0.24, 0.20), "tex": "fabric" }
		"rig_smersh": return { "kind": "rig", "style": "chest", "pouches": 4, "utility": 3, "belt": true, "colour": Color(0.30, 0.33, 0.23), "tex": "fabric" }
		# headgear
		"head_lamp": return { "kind": "headgear", "style": "lamp", "colour": Color(0.15, 0.15, 0.14), "tex": "rubber" }
		"head_pnv57": return { "kind": "headgear", "style": "nvg", "tubes": 2, "colour": Color(0.17, 0.18, 0.16), "tex": "painted_metal" }
		"head_1pn138": return { "kind": "headgear", "style": "nvg", "tubes": 1, "colour": Color(0.14, 0.15, 0.14), "tex": "painted_metal" }
	return {}

# ---------------------------------------------------------------- entry points
## Build (or load from cache) the worn piece `id` for `slot` and add it to the rig's skeleton. Returns null for unknown ids.
static func build(id: String, slot: String, rig: Node3D) -> MeshInstance3D:
	var r := recipe(id)
	if r.is_empty():
		# unknown id: fall back on the catalogue kind so an unlisted vest still shows as a vest
		var d: Dictionary = Data.def(id) if Engine.has_singleton("Data") or true else {}
		var kind := str(d.get("kind", slot))
		match kind:
			"vest": r = recipe("vest_6b2")
			"helmet": r = recipe("helm_6b7")
			"mask": r = recipe("mask_gp5")
			"backpack": r = recipe("pack_pilgrim")
			"rig": r = recipe("rig_6sh112")
			"headgear": r = recipe("head_lamp")
			_: return null
	var def: Dictionary = rig.def
	var kind_key: String = rig.kind
	var key := "gear_%s_%s" % [id, kind_key]
	var mesh: ArrayMesh = RB.cached(key, func() -> Resource:
		return RB.with_lods(_build_mesh(r, def)))
	var mi := RB.skinned_instance(rig, mesh, _material(r), "Gear_" + slot, true)
	mi.set_meta("gear_id", id)
	# lamps and night-vision sets carry an emissive lens and, for the lamp, a real light
	if r.get("kind", "") == "headgear":
		var head: Node3D = rig.sockets.get("head", null)
		if head:
			var lens := MeshInstance3D.new(); lens.name = "Lens"
			var q := QuadMesh.new(); q.size = Vector2(0.03, 0.03); lens.mesh = q
			var lm := StandardMaterial3D.new(); lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			lm.emission_enabled = true
			if r.get("style", "") == "lamp":
				lm.albedo_color = Color(1.0, 0.92, 0.7); lm.emission = Color(1.0, 0.9, 0.65); lm.emission_energy_multiplier = 6.0
				lens.position = Vector3(0, -0.02, -0.125)
				var spot := SpotLight3D.new(); spot.name = "Headlamp"; spot.light_color = Color(1.0, 0.93, 0.78)
				spot.spot_angle = 24.0; spot.spot_range = 22.0; spot.light_energy = 0.0; spot.shadow_enabled = false
				spot.position = lens.position; spot.rotation = Vector3.ZERO; spot.visible = false
				spot.set_meta("energy", 7.0)
				head.add_child(spot); rig.lights.append(spot)
			else:
				lm.albedo_color = Color(0.1, 0.5, 0.25); lm.emission = Color(0.1, 0.6, 0.25); lm.emission_energy_multiplier = 1.4
				q.size = Vector2(0.012, 0.012)
				lens.position = Vector3(-0.032 if int(r.get("tubes", 1)) == 2 else 0.0, -0.045, -0.20)
			lens.material_override = lm; lens.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			head.add_child(lens)
	return mi

## The seeker: armour plates over the body, a domed helmet with a lamp housing, and the searchlight itself.
static func seeker_suit(rig: Node3D, def: Dictionary) -> void:
	var mesh: ArrayMesh = RB.cached("gear_seeker_suit", func() -> Resource:
		return RB.with_lods(_seeker_mesh(def)))
	var mat := _material({ "colour": Color(0.19, 0.21, 0.16), "tex": "painted_metal", "rough": 0.75, "metal": 0.35 })
	var mi := RB.skinned_instance(rig, mesh, mat, "Gear_suit", true)
	rig.gear_meshes["suit"] = mi
	# lens + searchlight at the head socket
	var head: Node3D = rig.sockets.get("head", null)
	if head == null: return
	var lens := MeshInstance3D.new(); lens.name = "Lens"
	var cm := CylinderMesh.new(); cm.top_radius = 0.052; cm.bottom_radius = 0.052; cm.height = 0.01; cm.radial_segments = 20
	lens.mesh = cm; lens.rotation_degrees = Vector3(90, 0, 0); lens.position = Vector3(0, 0.02, -0.155)
	var lm := StandardMaterial3D.new(); lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.albedo_color = Color(1.0, 0.95, 0.8); lm.emission_enabled = true; lm.emission = Color(1.0, 0.92, 0.72); lm.emission_energy_multiplier = 9.0
	lens.material_override = lm; lens.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	head.add_child(lens)
	var spot := SpotLight3D.new(); spot.name = "Searchlight"; spot.light_color = Color(1.0, 0.94, 0.78)
	spot.spot_angle = 17.0; spot.spot_angle_attenuation = 0.6; spot.spot_range = 60.0; spot.light_energy = 12.0
	spot.shadow_enabled = true; spot.light_volumetric_fog_energy = 2.5
	spot.position = Vector3(0, 0.02, -0.16); spot.set_meta("energy", 12.0)
	head.add_child(spot); rig.lights.append(spot)
	var ring := MeshInstance3D.new(); ring.name = "LensRing"
	var tm := TorusMesh.new(); tm.inner_radius = 0.052; tm.outer_radius = 0.07; tm.rings = 20; tm.ring_segments = 8
	ring.mesh = tm; ring.rotation_degrees = Vector3(90, 0, 0); ring.position = Vector3(0, 0.02, -0.15)
	ring.material_override = Mats.pbr("gunmetal", 1.0, Color(0.5, 0.5, 0.5))
	head.add_child(ring)

# ---------------------------------------------------------------- materials
static func _material(r: Dictionary) -> Material:
	var tex := str(r.get("tex", "fabric")); var c: Color = r.get("colour", Color(0.3, 0.3, 0.3))
	var key := "%s|%s|%.2f" % [tex, c.to_html(), float(r.get("rough", 0.9))]
	if _mats.has(key): return _mats[key]
	var base: StandardMaterial3D = Mats.pbr(tex, 2.5, c, { "roughness": float(r.get("rough", 0.9)), "metallic": float(r.get("metal", 0.0)) })
	var m: StandardMaterial3D = base.duplicate()
	m.vertex_color_use_as_albedo = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	if m.albedo_texture == null:
		# flat fallback: the tint is the colour, weathered a little darker and less saturated than the catalogue swatch
		m.albedo_color = c.darkened(0.15)
	_mats[key] = m
	return m

## Per-vertex weathering colour: darker toward the bottom of the piece, hashed grime, an occasional lighter worn edge.
static func _col(p: Vector3, y0: float, y1: float, seed: float = 1.0) -> Color:
	var t := clampf((p.y - y0) / maxf(y1 - y0, 1e-3), 0.0, 1.0)
	var h := SkinBuilder._hash(p.x * 37.1 + p.y * 91.7 + seed, p.z * 53.3 + p.y * 17.9)
	var h2 := SkinBuilder._hash(p.z * 71.3 + seed * 3.0, p.x * 23.7)
	var v := 0.62 + 0.28 * t + 0.14 * h - 0.08 * h2 * h2
	return Color(v, v * (0.98 + 0.03 * h2), v * (0.95 + 0.04 * h), 1.0)

# ---------------------------------------------------------------- geometry helpers
static func _cyl(sb: SkinBuilder, p0: Vector3, p1: Vector3, r0: float, r1: float, segs: int, c: Color, w: Array, caps: bool = true, sq: float = 0.0) -> void:
	var d := (p1 - p0)
	var L := d.length()
	if L < 1e-5: return
	d /= L
	var right := d.cross(Vector3.UP)
	if right.length_squared() < 1e-5: right = d.cross(Vector3.RIGHT)
	right = right.normalized()
	var fwd := d.cross(right).normalized()
	var rings := [{ "c": p0, "right": right, "fwd": fwd, "rx": r0, "rz": r0, "w": w, "v": 0.0, "col": c, "shape": { "sq": sq } },
		{ "c": p1, "right": right, "fwd": fwd, "rx": r1, "rz": r1, "w": w, "v": L * 4.0, "col": c, "shape": { "sq": sq } }]
	sb.group += 1
	sb.tube(rings, segs, caps, caps)

## A rounded box (superellipsoid) — pouches, plates, packs, housings.
static func _pad(sb: SkinBuilder, center: Vector3, size: Vector3, c: Color, w: Array, sq: float = 0.8, basis: Basis = Basis.IDENTITY, segs: int = 10, rows: int = 6) -> void:
	sb.group += 1
	sb.blob(center, size * 0.5, basis, segs, rows, c, w, { "sq": sq })

## A strap: a flattened tube through a list of points.
static func _strap(sb: SkinBuilder, pts: Array, width: float, thick: float, c: Color, ws: Array, segs: int = 6) -> void:
	var rings := []
	for i in pts.size():
		var p: Vector3 = pts[i]
		var d: Vector3 = (pts[mini(i + 1, pts.size() - 1)] - pts[maxi(i - 1, 0)]).normalized()
		var right := d.cross(Vector3.FORWARD) if absf(d.z) < 0.9 else d.cross(Vector3.RIGHT)
		right = right.normalized()
		var fwd := d.cross(right).normalized()
		# the strap's flat face follows the body: wide along `right`, thin along `fwd`
		rings.append({ "c": p, "right": right, "fwd": fwd, "rx": width * 0.5, "rz": thick * 0.5, "w": ws[mini(i, ws.size() - 1)], "v": float(i) * 0.5, "col": c, "shape": { "sq": 0.5 } })
	sb.group += 1
	sb.tube(rings, segs, true, true)

static func _B(def: Dictionary, n: String) -> int: return HumanoidDef.index(def, n)

# ---------------------------------------------------------------- dispatch
static func _build_mesh(r: Dictionary, def: Dictionary) -> ArrayMesh:
	var sb := SkinBuilder.new()
	match str(r.get("kind", "")):
		"vest": _vest(sb, r, def)
		"helmet": _helmet(sb, r, def)
		"mask": _mask(sb, r, def)
		"backpack": _pack(sb, r, def)
		"rig": _rig(sb, r, def)
		"headgear": _headgear(sb, r, def)
	return sb.commit(null, null, str(r.get("kind", "gear")))

# ---------------------------------------------------------------- vests
static func _vest(sb: SkinBuilder, r: Dictionary, def: Dictionary) -> void:
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var g: float = p["bulk"] * s
	var thick: float = r.get("thick", 0.02); var y0: float = r.get("y0", 1.0); var y1: float = r.get("y1", 1.45)
	var flak: bool = r.get("flak", false); var plates: bool = r.get("plates", false)
	var jacket := 0.022   # the body wears a jacket under it
	var rows := 7
	var rings := []
	var y0m := y0 * s; var y1m := y1 * s
	for i in rows + 1:
		var t := float(i) / float(rows)
		var y := lerpf(y0, y1, t)
		var rad := HumanoidBody.torso_radii(y)
		var add := jacket + thick + (0.012 if plates and t > 0.15 and t < 0.9 else 0.0)
		var rx := (rad.x + add) * g; var rz := (rad.y + add) * g
		# the hem flares a touch, the top pulls in under the arms
		if i == 0: rx += 0.006; rz += 0.006
		if i == rows: rx -= 0.01
		var c := _col(Vector3(0, y * s, 0), y0m, y1m)
		rings.append({ "c": Vector3(0, y * s, -p.get("slouch", 0.0) * clampf((y - 1.0) / 0.5, 0.0, 1.0)), "rx": rx, "rz": rz, "w": HumanoidBody.torso_weights(def, y * s), "v": t * 2.0, "col": c, "shape": { "back": 0.9, "sq": 0.4 if plates else 0.25 } })
	sb.group += 1
	var starts := sb.tube(rings, 22, false, false)
	# hem and top edges get a thin inward lip so the shell has thickness
	var r0: Dictionary = rings[0]; var lip0 := r0.duplicate(); lip0["rx"] = r0["rx"] - thick - 0.006; lip0["rz"] = r0["rz"] - thick - 0.006; lip0["c"] = r0["c"] + Vector3(0, 0.008, 0)
	var l0 := sb.ring(lip0["c"], Vector3.RIGHT, Vector3.FORWARD, lip0["rx"], lip0["rz"], 22, -0.1, r0["col"], r0["w"], r0["shape"])
	sb.join(l0, starts[0], 22)
	var r1: Dictionary = rings[-1]; var lip1 := r1.duplicate(); lip1["rx"] = r1["rx"] - thick - 0.006; lip1["rz"] = r1["rz"] - thick - 0.006; lip1["c"] = r1["c"] - Vector3(0, 0.008, 0)
	var l1 := sb.ring(lip1["c"], Vector3.RIGHT, Vector3.FORWARD, lip1["rx"], lip1["rz"], 22, 2.1, r1["col"], r1["w"], r1["shape"])
	sb.join(starts[-1], l1, 22)
	# shoulder straps / yoke over each shoulder
	var chest := _B(def, "chest"); var wch := SkinBuilder.bw(chest)
	var top_rad := HumanoidBody.torso_radii(y1)
	for side in [-1.0, 1.0]:
		var x := side * 0.095 * g
		var zf := -(top_rad.y + jacket + thick) * g * 0.75; var zb := (top_rad.y + jacket + thick) * g * 0.8
		var ys := 1.52 * s + (0.012 if flak else 0.0)
		var pts := [Vector3(x, y1m - 0.01, zf), Vector3(x, y1m + 0.05 * s, zf * 0.9), Vector3(x * 1.05, ys, zf * 0.35), Vector3(x * 1.08, ys + 0.008, 0.0), Vector3(x * 1.05, ys, zb * 0.35), Vector3(x, y1m + 0.05 * s, zb * 0.9), Vector3(x, y1m - 0.01, zb)]
		var width := 0.075 if flak else 0.055
		_strap(sb, pts, width * g, (0.02 if flak else 0.012) * g, _col(Vector3(x, ys, 0), y0m, y1m), [wch])
		if r.get("shoulder_pads", false):
			# a padded cap over the deltoid, half on the arm bone so it lifts with it
			var ua := _B(def, "upper_arm_" + ("l" if side < 0 else "r"))
			var sh: Vector3 = def["pos"]["upper_arm_" + ("l" if side < 0 else "r")]
			sb.group += 1
			sb.blob(sh + Vector3(side * 0.01, 0.03 * s, 0), Vector3(0.095, 0.075, 0.095) * g, Basis.IDENTITY, 14, 5, _col(sh, y0m, y1m), SkinBuilder.bw(ua, 0.6, chest, 0.4), { "lat0": 0.45, "sq": 0.2 })
		if r.get("arm_guards", false):
			var ua := _B(def, "upper_arm_" + ("l" if side < 0 else "r"))
			var sh: Vector3 = def["pos"]["upper_arm_" + ("l" if side < 0 else "r")]
			var el: Vector3 = def["pos"]["forearm_" + ("l" if side < 0 else "r")]
			_cyl(sb, sh + Vector3(0, -0.06 * s, 0), sh.lerp(el, 0.72), 0.085 * g, 0.075 * g, 12, _col(sh, y0m, y1m), SkinBuilder.bw(ua), false, 0.2)
	# collar
	if r.get("collar", false):
		var neck := _B(def, "neck")
		var cw := SkinBuilder.bw(neck, 0.55, chest, 0.45)
		var crings := []
		for i in 3:
			var yy := (1.505 + 0.04 * i) * s
			var rr := (0.105 + 0.008 * i + thick * 0.5) * g
			crings.append({ "c": Vector3(0, yy, -0.008 * s), "rx": rr, "rz": rr * 0.82, "w": cw, "v": 2.0 + i * 0.2, "col": _col(Vector3(0, yy, 0), y0m, y1m), "shape": { "back": 1.05, "front": 0.85, "sq": 0.2 } })
		sb.group += 1
		var cs := sb.tube(crings, 22, false, false)
		var lipc := crings[-1].duplicate(); lipc["rx"] = crings[-1]["rx"] - 0.014 * g; lipc["rz"] = crings[-1]["rz"] - 0.014 * g
		var lc := sb.ring(lipc["c"] - Vector3(0, 0.006, 0), Vector3.RIGHT, Vector3.FORWARD, lipc["rx"], lipc["rz"], 22, 2.7, lipc["col"], cw, lipc["shape"])
		sb.join(cs[-1], lc, 22)
	# plates: a rectangular front plate bulge and back plate
	if plates:
		var ym := lerpf(y0, y1, 0.55) * s
		var rad := HumanoidBody.torso_radii(lerpf(y0, y1, 0.55))
		var wmid := HumanoidBody.torso_weights(def, ym)
		_pad(sb, Vector3(0, ym, -(rad.y + jacket + thick + 0.012) * g), Vector3(0.26 * g, 0.30 * s, 0.03), _col(Vector3(0, ym, -1), y0m, y1m, 2.0), wmid, 0.85)
		_pad(sb, Vector3(0, ym + 0.02 * s, (rad.y * 0.9 + jacket + thick + 0.012) * g), Vector3(0.26 * g, 0.30 * s, 0.03), _col(Vector3(0, ym, 1), y0m, y1m, 2.0), wmid, 0.85)
	if r.get("cummerbund", false):
		var yb := (y0 + 0.06) * s
		var rad := HumanoidBody.torso_radii(y0 + 0.06)
		var wb := HumanoidBody.torso_weights(def, yb)
		for side in [-1.0, 1.0]:
			_pad(sb, Vector3(side * (rad.x + jacket + thick + 0.012) * g, yb + 0.04 * s, 0.0), Vector3(0.03, 0.16 * s, 0.17 * g), _col(Vector3(side, yb, 0), y0m, y1m, 3.0), wb, 0.7)
	# pouches across the front (magazines) below the plate line
	var np: int = int(r.get("pouches", 0))
	if np > 0:
		var yp := lerpf(y0, y1, 0.32) * s
		var rad := HumanoidBody.torso_radii(lerpf(y0, y1, 0.32))
		var wp := HumanoidBody.torso_weights(def, yp)
		var span := 0.075 * g * (np - 1)
		for i in np:
			var x := -span * 0.5 + i * 0.075 * g
			var zc := -(rad.y + jacket + thick + (0.012 if plates else 0.0)) * g
			var zz := zc - 0.03 - 0.008 * cos(x / maxf(rad.x * g, 0.05) * 1.3)
			_pad(sb, Vector3(x, yp, zz + 0.01 * absf(x)), Vector3(0.068 * g, 0.15 * s, 0.055), _col(Vector3(x, yp, -1), y0m, y1m, 4.0 + i), wp, 0.75)
			# flap
			_pad(sb, Vector3(x, yp + 0.065 * s, zz + 0.01 * absf(x) - 0.004), Vector3(0.072 * g, 0.03 * s, 0.062), _col(Vector3(x, yp, -1), y0m, y1m, 5.0 + i) * Color(0.9, 0.9, 0.9), wp, 0.85)
	if r.get("groin", false):
		var hips := _B(def, "hips")
		var yg := (y0 - 0.02) * s
		_pad(sb, Vector3(0, yg - 0.07 * s, -(HumanoidBody.torso_radii(y0).y + jacket + thick) * g), Vector3(0.18 * g, 0.16 * s, 0.03), _col(Vector3(0, yg, -1), y0m, y1m, 6.0), SkinBuilder.bw(hips), 0.8)

# ---------------------------------------------------------------- helmets
static func _helmet(sb: SkinBuilder, r: Dictionary, def: Dictionary) -> void:
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var hs: float = p["head_scale"] * s
	var head := _B(def, "head"); var w := SkinBuilder.bw(head)
	var hp: Vector3 = def["pos"]["head"]
	var head_c := hp + Vector3(0, 0.105 * hs, 0.0)
	var style := str(r.get("style", "aramid"))
	var rx := 0.079 * hs; var ry := 0.118 * hs; var rz := 0.094 * hs
	var c := _col(head_c, head_c.y - 0.1, head_c.y + 0.12)
	match style:
		"steel":
			# SSh-68: a shallow dome with a flared brim and a slight front peak
			var taper := func(t: float) -> Vector2:
				var flare := 1.0 + 0.16 * smoothstep(0.62, 0.42, t)
				return Vector2(flare, flare * (1.0 + 0.04 * smoothstep(0.5, 0.42, t)))
			var shift := func(t: float) -> Vector3: return Vector3(0, 0, -0.012 * smoothstep(0.7, 0.42, t))
			sb.group += 1
			sb.blob(head_c + Vector3(0, 0.02 * hs, 0.004), Vector3(rx + 0.022, ry * 0.92, rz + 0.02), Basis.IDENTITY, 24, 10, c, w, { "lat0": 0.42, "taper": taper, "shift": shift })
			# brim underside (a second, slightly smaller inverted ring band so the edge has thickness)
			sb.group += 1
			sb.blob(head_c + Vector3(0, 0.02 * hs, 0.004), Vector3(rx + 0.008, ry * 0.92, rz + 0.008), Basis.IDENTITY, 24, 3, c * Color(0.7, 0.7, 0.7), w, { "lat0": 0.40, "lat1": 0.52 })
		"titanium":
			# Altyn / ZSh: a deep round shell down over the ears and nape, with a visor plate in front
			var full: bool = r.get("full", false)
			var taper := func(t: float) -> Vector2: return Vector2(1.0 + 0.05 * smoothstep(0.6, 0.3, t), 1.0 + 0.08 * smoothstep(0.6, 0.3, t))
			sb.group += 1
			sb.blob(head_c + Vector3(0, 0.012 * hs, 0.006), Vector3(rx + 0.03, ry * 1.02, rz + 0.03), Basis.IDENTITY, 24, 12, c, w, { "lat0": 0.22 if full else 0.34, "taper": taper })
			if r.get("visor", false):
				var vc := head_c + Vector3(0, 0.005 * hs, -(rz + 0.045))
				var vis := _col(vc, 0, 1, 7.0) * Color(0.55, 0.6, 0.65)
				sb.group += 1
				sb.blob(vc, Vector3(rx + 0.012, 0.045 * hs, 0.012), Basis.IDENTITY, 16, 5, vis, w, { "sq": 0.85 })
				# hinge blocks at the temples
				for side in [-1.0, 1.0]:
					_pad(sb, head_c + Vector3(side * (rx + 0.034), 0.03 * hs, -0.01), Vector3(0.016, 0.05, 0.05), c * Color(0.8, 0.8, 0.8), w, 0.9, Basis.IDENTITY, 8, 4)
		_:
			# aramid: rounded, cut out over the ears, a short brim; optional side rails and a cover
			var deep: bool = r.get("deep", false)
			var taper := func(t: float) -> Vector2: return Vector2(1.0 + 0.03 * smoothstep(0.7, 0.45, t), 1.0 + 0.06 * smoothstep(0.7, 0.45, t))
			var shift := func(t: float) -> Vector3: return Vector3(0, 0, -0.008 * smoothstep(0.8, 0.45, t))
			sb.group += 1
			sb.blob(head_c + Vector3(0, 0.016 * hs, 0.004), Vector3(rx + 0.024, ry * 0.95, rz + 0.024), Basis.IDENTITY, 24, 10, c, w, { "lat0": 0.30 if deep else 0.40, "taper": taper, "shift": shift })
			if r.get("rails", false):
				for side in [-1.0, 1.0]:
					_pad(sb, head_c + Vector3(side * (rx + 0.03), 0.03 * hs, 0.005), Vector3(0.014, 0.022, 0.13), c * Color(0.6, 0.6, 0.6), w, 0.9, Basis.IDENTITY, 8, 4)
				# NVG shroud on the front
				_pad(sb, head_c + Vector3(0, 0.055 * hs, -(rz + 0.028)), Vector3(0.05, 0.045, 0.014), c * Color(0.55, 0.55, 0.55), w, 0.9, Basis.IDENTITY, 8, 4)
	# chin strap: down the jaw line on both sides and under the chin
	var jaw := head_c + Vector3(0, -0.075 * hs, -0.01)
	var pts := []
	for i in 7:
		var a := lerpf(-PI * 0.5, PI * 0.5, float(i) / 6.0)
		pts.append(head_c + Vector3(sin(a) * (rx + 0.012), -0.02 * hs - 0.055 * hs * cos(a), -0.012 - 0.03 * cos(a)))
	_strap(sb, pts, 0.018, 0.005, c * Color(0.55, 0.5, 0.45), [w], 5)
	jaw = jaw

# ---------------------------------------------------------------- masks
static func _mask(sb: SkinBuilder, r: Dictionary, def: Dictionary) -> void:
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var hs: float = p["head_scale"] * s
	var head := _B(def, "head"); var w := SkinBuilder.bw(head)
	var hp: Vector3 = def["pos"]["head"]
	var head_c := hp + Vector3(0, 0.105 * hs, 0.0)
	var rx := 0.079 * hs; var ry := 0.118 * hs; var rz := 0.094 * hs
	var c := _col(head_c, head_c.y - 0.12, head_c.y + 0.12, 9.0)
	var style := str(r.get("style", "hood"))
	var eye_y := head_c.y + 0.02 * hs
	var face_z := -(rz + 0.012)
	match style:
		"hood":
			# GP-5: the whole head in grey rubber, two round eyepieces, the filter on the mouth
			var taper := func(t: float) -> Vector2:
				var jaw := lerpf(0.78, 1.0, smoothstep(0.0, 0.42, t))
				return Vector2(jaw, jaw * (1.0 + 0.05 * smoothstep(0.3, 0.7, t)))
			var shift := func(t: float) -> Vector3: return Vector3(0, 0, -0.012 * exp(-pow((t - 0.42) / 0.1, 2.0)) + 0.01 * smoothstep(0.5, 0.95, t))
			sb.group += 1
			sb.blob(head_c, Vector3(rx + 0.012, ry + 0.01, rz + 0.012), Basis.IDENTITY, 24, 14, c, w, { "taper": taper, "shift": shift, "lat0": 0.02 })
			for side in [-1.0, 1.0]:
				var ec := Vector3(side * 0.032 * hs, eye_y, face_z - 0.01)
				_cyl(sb, ec + Vector3(0, 0, 0.012), ec + Vector3(0, 0, -0.008), 0.024 * hs, 0.026 * hs, 14, c * Color(0.7, 0.7, 0.7), w, true)
				_cyl(sb, ec + Vector3(0, 0, -0.006), ec + Vector3(0, 0, -0.009), 0.019 * hs, 0.019 * hs, 14, Color(0.25, 0.3, 0.32), w, true)
			var mouth := Vector3(0, head_c.y - 0.05 * hs, face_z - 0.02)
			_cyl(sb, mouth + Vector3(0, 0, 0.02), mouth + Vector3(0, -0.015, -0.055), 0.03 * hs, 0.04 * hs, 14, c * Color(0.75, 0.75, 0.72), w, true)
			_cyl(sb, mouth + Vector3(0, -0.015, -0.055), mouth + Vector3(0, -0.02, -0.065), 0.04 * hs, 0.036 * hs, 14, c * Color(0.55, 0.55, 0.52), w, true)
		"face":
			# GP-7: a black rubber face piece with a visor bar, a side canister and a strap harness
			var fc := Vector3(0, head_c.y - 0.01 * hs, face_z + 0.03)
			sb.group += 1
			sb.blob(fc, Vector3(rx * 0.92, ry * 0.68, rz * 0.62), Basis.IDENTITY, 20, 10, c, w, { "lat0": 0.05, "lat1": 0.95, "taper": func(t: float) -> Vector2: return Vector2(lerpf(0.75, 1.0, smoothstep(0.0, 0.5, t)), 1.0) })
			for side in [-1.0, 1.0]:
				var ec := Vector3(side * 0.034 * hs, eye_y, face_z - 0.016)
				_cyl(sb, ec + Vector3(0, 0, 0.01), ec + Vector3(0, 0, -0.006), 0.026 * hs, 0.028 * hs, 14, c * Color(0.8, 0.8, 0.8), w, true, 0.3)
				_cyl(sb, ec + Vector3(0, 0, -0.005), ec + Vector3(0, 0, -0.008), 0.021 * hs, 0.021 * hs, 14, Color(0.22, 0.26, 0.28), w, true, 0.3)
			var can := Vector3(-0.055 * hs, head_c.y - 0.05 * hs, face_z + 0.005)
			_cyl(sb, can, can + Vector3(-0.055, -0.02, -0.01), 0.026 * hs, 0.03 * hs, 14, c * Color(0.6, 0.62, 0.58), w, true)
			# harness straps around the head
			for k in 3:
				var yy := head_c.y + (0.05 - 0.04 * k) * hs
				var pts := []
				for i in 9:
					var a := lerpf(-PI * 0.45, PI * 0.45, float(i) / 8.0)
					pts.append(Vector3(sin(a) * (rx + 0.008), yy - 0.03 * k * cos(a), -cos(a) * (rz * 0.2) + 0.03 + 0.06 * absf(sin(a)) * 0.0 + (rz + 0.006) * (1.0 - cos(a) * 0.0) * 0.0 + cos(a) * 0.0))
				# straps run from the face piece around the back of the head
				pts = []
				for i in 9:
					var a := lerpf(-PI * 0.5, PI * 0.5, float(i) / 8.0)
					pts.append(Vector3(cos(a) * (rx + 0.008), yy + 0.01 * sin(a) * k, sin(a) * (rz + 0.008)))
				_strap(sb, pts, 0.014, 0.004, c * Color(0.75, 0.75, 0.75), [w], 5)
		_:
			# respirator: a half mask over the nose and mouth with two filter discs and two straps
			var mc := Vector3(0, head_c.y - 0.035 * hs, face_z + 0.02)
			sb.group += 1
			sb.blob(mc, Vector3(rx * 0.72, ry * 0.36, rz * 0.5), Basis.IDENTITY, 18, 8, c, w, { "lat0": 0.08, "lat1": 0.92, "sq": 0.2 })
			for side in [-1.0, 1.0]:
				var fc := Vector3(side * 0.05 * hs, mc.y - 0.01 * hs, face_z - 0.02)
				_cyl(sb, fc + Vector3(0, 0, 0.015), fc + Vector3(side * 0.012, 0, -0.012), 0.024 * hs, 0.026 * hs, 12, c * Color(0.85, 0.82, 0.78), w, true)
			for k in 2:
				var yy := head_c.y + (0.03 - 0.06 * k) * hs
				var pts := []
				for i in 9:
					var a := lerpf(-PI * 0.5, PI * 0.5, float(i) / 8.0)
					pts.append(Vector3(cos(a) * (rx + 0.006), yy, sin(a) * (rz + 0.006)))
				_strap(sb, pts, 0.012, 0.004, c * Color(0.8, 0.78, 0.75), [w], 5)

# ---------------------------------------------------------------- packs
static func _pack(sb: SkinBuilder, r: Dictionary, def: Dictionary) -> void:
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var g: float = p["bulk"] * s
	var chest := _B(def, "chest"); var spine := _B(def, "spine")
	var size: Vector3 = r.get("size", Vector3(0.3, 0.4, 0.18))
	var back_r := HumanoidBody.torso_radii(1.30).y * g + 0.025
	var cy := 1.27 * s + size.y * 0.5 * 0.1
	var c0 := Vector3(0, cy, back_r + size.z * 0.5)
	var y0 := cy - size.y * 0.5; var y1 := cy + size.y * 0.5
	var wb := SkinBuilder.bw(chest, 0.55, spine, 0.45)
	var wt := SkinBuilder.bw(chest)
	# main bag: two stacked rounded boxes so the lower part follows the spine
	sb.group += 1
	sb.blob(Vector3(c0.x, cy - size.y * 0.22, c0.z), Vector3(size.x * 0.5, size.y * 0.3, size.z * 0.5), Basis.IDENTITY, 12, 6, _col(c0 + Vector3(0, -0.1, 0), y0, y1), wb, { "sq": 0.75 })
	sb.group += 1
	sb.blob(Vector3(c0.x, cy + size.y * 0.22, c0.z - 0.005), Vector3(size.x * 0.5 * 0.97, size.y * 0.3, size.z * 0.5 * 0.96), Basis.IDENTITY, 12, 6, _col(c0 + Vector3(0, 0.1, 0), y0, y1), wt, { "sq": 0.75 })
	if r.get("lid", false):
		_pad(sb, Vector3(0, y1 - 0.01, c0.z + 0.012), Vector3(size.x * 0.95, 0.06, size.z * 0.95), _col(c0 + Vector3(0, 0.2, 0), y0, y1, 2.0) * Color(0.92, 0.92, 0.92), wt, 0.8, Basis.IDENTITY, 12, 5)
	if r.get("side", false):
		for side in [-1.0, 1.0]:
			_pad(sb, Vector3(side * (size.x * 0.5 + 0.03), cy - size.y * 0.08, c0.z + 0.01), Vector3(0.07, size.y * 0.5, size.z * 0.7), _col(c0 + Vector3(side, 0, 0), y0, y1, 3.0), wb, 0.75, Basis.IDENTITY, 10, 5)
	if r.get("roll", false):
		_cyl(sb, Vector3(-size.x * 0.5 - 0.02, y1 + 0.02, c0.z), Vector3(size.x * 0.5 + 0.02, y1 + 0.02, c0.z), 0.06, 0.06, 12, _col(c0 + Vector3(0, 0.3, 0), y0, y1, 4.0) * Color(0.85, 0.85, 0.85), wt, true, 0.1)
	# straps over the shoulders to the chest, and a sternum strap
	for side in [-1.0, 1.0]:
		var x := side * 0.09 * g
		var pts := [Vector3(x, y1 - 0.04, c0.z - size.z * 0.5 + 0.01), Vector3(x, 1.50 * s, 0.06 * s), Vector3(x * 1.06, 1.53 * s, 0.0), Vector3(x, 1.49 * s, -0.10 * s), Vector3(x * 0.9, 1.30 * s, -(HumanoidBody.torso_radii(1.30).y * g + 0.035)), Vector3(x * 0.85, 1.12 * s, -(HumanoidBody.torso_radii(1.12).y * g + 0.035))]
		_strap(sb, pts, 0.05 * g, 0.012, _col(Vector3(x, 1.4, 0), y0, y1, 5.0) * Color(0.9, 0.9, 0.9), [wt, wt, wt, wt, wt, HumanoidBody.torso_weights(def, 1.12 * s)], 6)
	var zs := -(HumanoidBody.torso_radii(1.30).y * g + 0.045)
	_strap(sb, [Vector3(-0.085 * g, 1.31 * s, zs), Vector3(0, 1.31 * s, zs - 0.006), Vector3(0.085 * g, 1.31 * s, zs)], 0.025, 0.008, _col(Vector3(0, 1.3, -1), y0, y1, 6.0) * Color(0.8, 0.8, 0.8), [wt], 5)

# ---------------------------------------------------------------- chest rigs and belts
static func _rig(sb: SkinBuilder, r: Dictionary, def: Dictionary) -> void:
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var g: float = p["bulk"] * s
	var chest := _B(def, "chest"); var hips := _B(def, "hips")
	var style := str(r.get("style", "chest"))
	var jacket := 0.024
	if style == "belt" or r.get("belt", false):
		var yb := 1.0 * s
		var rad := HumanoidBody.torso_radii(1.0)
		var wb := SkinBuilder.bw(hips, 0.8, _B(def, "spine"), 0.2)
		var pts := []
		for i in 25:
			var a := TAU * float(i) / 24.0
			pts.append(Vector3(cos(a) * (rad.x + jacket + 0.004) * g, yb, sin(a) * (rad.y + jacket + 0.004) * g))
		_strap(sb, pts, 0.05, 0.008, _col(Vector3(0, yb, 0), yb - 0.1, yb + 0.1, 11.0) * Color(0.75, 0.68, 0.55), [wb], 5)
		# pouches on the belt: two in front-left/right, one behind
		for a in [-1.05, 1.05, PI]:
			var cx := sin(a) * (rad.x + jacket + 0.04) * g; var cz := -cos(a) * (rad.y + jacket + 0.04) * g
			_pad(sb, Vector3(cx, yb - 0.035 * s, cz), Vector3(0.08 * g, 0.11 * s, 0.06), _col(Vector3(cx, yb, cz), yb - 0.1, yb + 0.1, 12.0 + a), wb, 0.75)
		if style == "belt": return
	# chest rig: a row of magazine pouches on a front panel, H-harness straps over the shoulders
	var yp := 1.22 * s
	var rad := HumanoidBody.torso_radii(1.22)
	var wp := HumanoidBody.torso_weights(def, yp)
	var np: int = int(r.get("pouches", 3))
	var span := 0.078 * g * (np - 1)
	var zf := -(rad.y + jacket) * g
	var c := _col(Vector3(0, yp, zf), yp - 0.2, yp + 0.3, 13.0)
	if style == "panel":
		_pad(sb, Vector3(0, yp + 0.02 * s, zf - 0.012), Vector3(span + 0.12 * g, 0.24 * s, 0.024), c, wp, 0.85, Basis.IDENTITY, 12, 5)
	else:
		_pad(sb, Vector3(0, yp + 0.01 * s, zf - 0.006), Vector3(span + 0.10 * g, 0.19 * s, 0.014), c * Color(0.92, 0.92, 0.92), wp, 0.85, Basis.IDENTITY, 12, 4)
	for i in np:
		var x := -span * 0.5 + i * 0.078 * g
		var zz := zf - 0.036 + 0.012 * absf(x) / maxf(span * 0.5, 0.05) * 0.5
		_pad(sb, Vector3(x, yp - 0.01 * s, zz), Vector3(0.07 * g, 0.155 * s, 0.055), _col(Vector3(x, yp, zz), yp - 0.2, yp + 0.3, 14.0 + i), wp, 0.75)
		_pad(sb, Vector3(x, yp + 0.06 * s, zz - 0.003), Vector3(0.074 * g, 0.03 * s, 0.062), _col(Vector3(x, yp + 0.1, zz), yp - 0.2, yp + 0.3, 15.0 + i) * Color(0.88, 0.88, 0.88), wp, 0.85)
	var nu: int = int(r.get("utility", 0))
	for i in nu:
		var side := -1.0 if i % 2 == 0 else 1.0
		var x := side * (span * 0.5 + 0.075 * g + 0.02 * (i / 2))
		var zz := zf - 0.02 + 0.03 * (i / 2)
		_pad(sb, Vector3(x, yp - 0.04 * s + 0.02 * (i / 2), zz), Vector3(0.06 * g, 0.09 * s, 0.05), _col(Vector3(x, yp, zz), yp - 0.2, yp + 0.3, 16.0 + i), wp, 0.75)
	# harness
	var wt := SkinBuilder.bw(chest)
	for side in [-1.0, 1.0]:
		var x := side * 0.075 * g
		var pts := [Vector3(x * 1.2, yp + 0.085 * s, zf - 0.01), Vector3(x, 1.40 * s, -(HumanoidBody.torso_radii(1.40).y + jacket) * g), Vector3(x * 1.15, 1.52 * s, -0.04 * s), Vector3(x * 1.2, 1.535 * s, 0.02 * s), Vector3(x * 1.1, 1.46 * s, (HumanoidBody.torso_radii(1.46).y + jacket) * g), Vector3(x * 0.5, 1.28 * s, (HumanoidBody.torso_radii(1.28).y + jacket) * g)]
		_strap(sb, pts, 0.04 * g, 0.008, c * Color(0.85, 0.85, 0.85), [wp, wt, wt, wt, wt, HumanoidBody.torso_weights(def, 1.28 * s)], 5)
	# waist strap round the back
	var pts := []
	for i in 13:
		var a := lerpf(-PI * 0.55, PI * 0.55, float(i) / 12.0)
		var rr := HumanoidBody.torso_radii(1.18)
		pts.append(Vector3(sin(a) * (rr.x + jacket + 0.004) * g, 1.18 * s, cos(a) * (rr.y + jacket + 0.004) * g))
	_strap(sb, pts, 0.03, 0.007, c * Color(0.85, 0.85, 0.85), [HumanoidBody.torso_weights(def, 1.18 * s)], 5)

# ---------------------------------------------------------------- headgear
static func _headgear(sb: SkinBuilder, r: Dictionary, def: Dictionary) -> void:
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var hs: float = p["head_scale"] * s
	var head := _B(def, "head"); var w := SkinBuilder.bw(head)
	var hp: Vector3 = def["pos"]["head"]
	var head_c := hp + Vector3(0, 0.105 * hs, 0.0)
	var rx := 0.079 * hs; var rz := 0.094 * hs
	var c := _col(head_c, head_c.y - 0.1, head_c.y + 0.1, 21.0)
	var style := str(r.get("style", "lamp"))
	# the head strap
	var yy := head_c.y + 0.045 * hs
	var pts := []
	for i in 25:
		var a := TAU * float(i) / 24.0
		pts.append(Vector3(cos(a) * (rx + 0.008), yy + 0.008 * sin(a), sin(a) * (rz + 0.008)))
	_strap(sb, pts, 0.026, 0.006, c * Color(0.8, 0.8, 0.8), [w], 5)
	if style == "lamp":
		_pad(sb, head_c + Vector3(0, 0.048 * hs, -(rz + 0.026)), Vector3(0.062, 0.04, 0.036), c, w, 0.85, Basis.IDENTITY, 10, 5)
		_cyl(sb, head_c + Vector3(0, 0.048 * hs, -(rz + 0.04)), head_c + Vector3(0, 0.048 * hs, -(rz + 0.05)), 0.02, 0.022, 14, c * Color(1.2, 1.2, 1.2), w, true)
	else:
		var tubes: int = int(r.get("tubes", 2))
		# bracket on the forehead, tubes hanging at eye level
		_pad(sb, head_c + Vector3(0, 0.055 * hs, -(rz + 0.02)), Vector3(0.05, 0.05, 0.03), c, w, 0.9, Basis.IDENTITY, 8, 4)
		_pad(sb, head_c + Vector3(0, 0.02 * hs, -(rz + 0.045)), Vector3(0.024, 0.07, 0.04), c, w, 0.9, Basis.IDENTITY, 8, 4)
		for k in tubes:
			var x := 0.0 if tubes == 1 else (-0.032 if k == 0 else 0.032)
			var t0 := head_c + Vector3(x, 0.02 * hs, -(rz + 0.02))
			_cyl(sb, t0, t0 + Vector3(0, 0, -0.095), 0.027, 0.03, 14, c * Color(0.95, 0.95, 0.95), w, true)
			_cyl(sb, t0 + Vector3(0, 0, -0.094), t0 + Vector3(0, 0, -0.102), 0.024, 0.02, 14, Color(0.12, 0.14, 0.12), w, true)
		# top strap
		_strap(sb, [Vector3(0, yy, -(rz + 0.006)), Vector3(0, head_c.y + 0.11 * hs, -0.03), Vector3(0, head_c.y + 0.12 * hs, 0.04), Vector3(0, yy + 0.01, rz + 0.006)], 0.022, 0.005, c * Color(0.8, 0.8, 0.8), [w], 5)

# ---------------------------------------------------------------- the seeker suit
static func _seeker_mesh(def: Dictionary) -> ArrayMesh:
	var sb := SkinBuilder.new()
	var p: Dictionary = def["p"]; var H: float = p["height"]; var s := H / 1.80; var g: float = p["bulk"] * s
	var pos: Dictionary = def["pos"]
	var B := func(n: String) -> int: return HumanoidDef.index(def, n)
	# plate list: [size, centre, bone, extra weights, sq]; positions in H = 1.8 root space, scaled by s
	var chest_r := HumanoidBody.torso_radii(1.38)
	var plates := [
		# chest and back
		[Vector3(0.44, 0.34, 0.09), Vector3(0, 1.36, -(chest_r.y * g + 0.05)), "chest", 0.85],
		[Vector3(0.42, 0.40, 0.16), Vector3(0, 1.33, chest_r.y * g + 0.09), "chest", 0.8],     # the pack / power unit
		[Vector3(0.16, 0.10, 0.12), Vector3(-0.10, 1.56, chest_r.y * g + 0.12), "chest", 0.9], # valve block
		[Vector3(0.18, 0.08, 0.08), Vector3(0.12, 1.52, chest_r.y * g + 0.14), "chest", 0.9],
		[Vector3(0.36, 0.09, 0.07), Vector3(0, 1.20, -(HumanoidBody.torso_radii(1.20).y * g + 0.05)), "spine", 0.85],
		[Vector3(0.34, 0.08, 0.07), Vector3(0, 1.10, -(HumanoidBody.torso_radii(1.10).y * g + 0.05)), "spine", 0.85],
		[Vector3(0.36, 0.15, 0.09), Vector3(0, 0.98, -(HumanoidBody.torso_radii(0.98).y * g + 0.05)), "hips", 0.85],
		[Vector3(0.34, 0.14, 0.09), Vector3(0, 0.99, HumanoidBody.torso_radii(0.98).y * g + 0.05), "hips", 0.85],
		[Vector3(0.14, 0.09, 0.14), Vector3(0, 1.545, 0.0), "neck", 0.6],
	]
	for side in ["l", "r"]:
		var sg := -1.0 if side == "l" else 1.0
		var sh: Vector3 = pos["upper_arm_" + side] / s; var el: Vector3 = pos["forearm_" + side] / s
		var hp: Vector3 = pos["thigh_" + side] / s; var kn: Vector3 = pos["shin_" + side] / s; var an: Vector3 = pos["foot_" + side] / s
		plates.append([Vector3(0.24, 0.16, 0.26), Vector3(sh.x + sg * 0.05, sh.y + 0.06, 0.0), "upper_arm_" + side, 0.55, "shoulder"])
		plates.append([Vector3(0.16, 0.24, 0.16), Vector3(sh.x + sg * 0.01, lerpf(sh.y, el.y, 0.55), 0.0), "upper_arm_" + side, 0.75])
		plates.append([Vector3(0.14, 0.22, 0.14), Vector3(el.x + sg * 0.005, lerpf(el.y, pos["hand_" + side].y / s, 0.5), 0.0), "forearm_" + side, 0.75])
		plates.append([Vector3(0.21, 0.32, 0.11), Vector3(hp.x, lerpf(hp.y, kn.y, 0.45), -0.09), "thigh_" + side, 0.8])
		plates.append([Vector3(0.17, 0.34, 0.09), Vector3(kn.x, lerpf(kn.y, an.y, 0.5), -0.085), "shin_" + side, 0.8])
		plates.append([Vector3(0.17, 0.12, 0.34), Vector3(an.x, 0.07, -0.07), "foot_" + side, 0.8])
	for pl in plates:
		var size: Vector3 = pl[0]; var c: Vector3 = pl[1] * Vector3(1, s, 1); var bone: String = pl[2]; var sq: float = pl[3]
		var w := SkinBuilder.bw(B.call(bone))
		if bone == "neck": w = SkinBuilder.bw(B.call("neck"), 0.5, B.call("chest"), 0.5)
		var col := _col(c, 0.0, 1.9, 31.0 + c.x * 7.0)
		if pl.size() > 4 and pl[4] == "shoulder":
			# pauldron: a half shell tilted outward
			var basis := Basis(Vector3.FORWARD, deg_to_rad(-25.0 * signf(c.x)))
			sb.group += 1
			sb.blob(c, size * Vector3(0.5, 0.6, 0.5), basis, 14, 6, col, SkinBuilder.bw(B.call(bone), 0.6, B.call("chest"), 0.4), { "lat0": 0.4, "sq": sq })
			continue
		_pad(sb, c, size * Vector3(g, 1.0, g), col, w, sq, Basis.IDENTITY, 12, 6)
	# helmet: a domed shell with a lamp housing on the front and a hood over it
	var head := B.call("head"); var hw := SkinBuilder.bw(head)
	var hs: float = p["head_scale"] * s
	var head_c: Vector3 = pos["head"] + Vector3(0, 0.105 * hs, 0.0)
	var colh := _col(head_c, 0, 2, 41.0)
	sb.group += 1
	sb.blob(head_c + Vector3(0, 0.01, 0.01), Vector3(0.079 * hs + 0.06, 0.118 * hs + 0.03, 0.094 * hs + 0.06), Basis.IDENTITY, 24, 12, colh, hw, { "lat0": 0.12, "sq": 0.25 })
	_cyl(sb, head_c + Vector3(0, 0.02, -0.02), head_c + Vector3(0, 0.02, -0.15), 0.075, 0.07, 18, colh * Color(0.85, 0.85, 0.85), hw, true, 0.2)   # lamp housing
	_pad(sb, head_c + Vector3(0, 0.10, -0.10), Vector3(0.20, 0.05, 0.16), colh, hw, 0.85, Basis.IDENTITY, 10, 4)                                  # hood over the lamp
	return sb.commit(null, null, "suit")
