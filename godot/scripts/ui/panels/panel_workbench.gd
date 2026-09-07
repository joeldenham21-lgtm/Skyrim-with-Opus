extends RadiusPanel
## Form 61-W — the bench at Vanno. A weapon is picked from the rack on the left (with a turntable view of it as it
## is actually built), and worked on under four headings: attachments, maintenance, magazines, armour.
##   Attachments respect the mount standards and the rails that convert them; removing a rail drops what it carried.
##   Maintenance strips fouling (free at the bench, a kit use in the field), repairs a part by 35 or replaces it.
##   Magazines load one ammunition type at a time from loose rounds; tube guns take shells one at a time.

const TABS := [["attachments", "Attachments"], ["maintenance", "Maintenance"], ["magazines", "Magazines"], ["armour", "Armour"]]
const MOUNTS := ["top", "muzzle", "under", "side", "stock"]

var tab := "attachments"
var wuid := -1
var picks := {}                      # calibre -> chosen ammunition id
var job: Dictionary = {}
var _preview: SubViewport = null
var _turn: Node3D = null
var _bar: PaperUI.Bar = null
var _job_label: Label = null

func panel_id() -> String: return "workbench"
func title_text() -> String: return "Vanno · Workbench"
func form_code() -> String: return "61-W"
func key_hint() -> String: return "Esc close · arrows move · Enter select · 1-4 headings"
func sheet_size(vp: Vector2) -> Vector2:
	return Vector2(minf(vp.x - 60.0, 1520.0), minf(vp.y - 50.0, 960.0))

func on_open() -> void:
	if data.has("tab") and str(data["tab"]) != "": tab = str(data["tab"])
	if data.has("weapon"): wuid = int(data["weapon"])

# ------------------------------------------------------------------------------------------------------------------
func build() -> void:
	if not has_inv():
		add_child(PaperUI.empty("The bench is bare. No kit on file.")); return
	var cols := PaperUI.rowbox(0)
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(cols)
	cols.add_child(_rack())
	var gut := HBoxContainer.new()
	gut.custom_minimum_size = Vector2(29, 0)
	gut.add_child(PaperUI.hspacer(14))
	gut.add_child(PaperUI.Rule.new("solid", Paper.ink(0.20), true))
	gut.add_child(PaperUI.hspacer(14))
	cols.add_child(gut)
	cols.add_child(_work())

func _weapons_sorted() -> Array:
	var i: Inventory = inv()
	var list: Array = i.weapons.duplicate()
	list.sort_custom(func(a, b):
		var sa := KitView.slot_of_uid(i, int(a["uid"]))
		var sb := KitView.slot_of_uid(i, int(b["uid"]))
		var ra := Inventory.SLOTS.find(sa) if sa != "" else 9
		var rb := Inventory.SLOTS.find(sb) if sb != "" else 9
		return ra < rb)
	return list

func _current() -> Dictionary:
	var i: Inventory = inv()
	var w: Variant = i.weapon_by_uid(wuid) if wuid >= 0 else null
	if not (w is Dictionary):
		var list := _weapons_sorted()
		if list.is_empty(): return {}
		w = list[0]; wuid = int(w["uid"])
	return w

# ------------------------------------------------------------------------------------------------------------------
# left: the rack and the turntable
# ------------------------------------------------------------------------------------------------------------------
func _rack() -> Control:
	var col := PaperUI.pane(400, 0)
	col.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(PaperUI.caps("On the bench", Paper.S_MICRO, Paper.AMBER, true))
	col.add_child(PaperUI.spacer(6))
	col.add_child(_view())
	col.add_child(PaperUI.spacer(10))
	var list := _weapons_sorted()
	if list.is_empty():
		col.add_child(PaperUI.empty("No weapon carried. The bench is bare."))
	else:
		var sc := PaperUI.scroll()
		var v := PaperUI.column(0)
		sc.add_child(v)
		var i: Inventory = inv()
		for w in list:
			var slot := KitView.slot_of_uid(i, int(w["uid"]))
			var b := PaperUI.select_row(_pick_weapon.bind(int(w["uid"])), int(w["uid"]) == wuid)
			b.set_meta("fkey", "w:%d" % int(w["uid"]))
			var cond := Paper.condition_of(w) / 100.0
			var tags: Array = [[KitView.SLOT_LABEL.get(slot, slot), Paper.AMBER]] if slot != "" else [["in pack", Paper.ink(0.42)]]
			PaperUI.row_body(b, PaperUI.name_block(Paper.full_of(str(w["id"])), Paper.weapon_sub(w), tags),
				PaperUI.number("%d" % roundi(cond * 100.0), "%", Paper.cond_color(cond)))
			v.add_child(b)
			v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
		col.add_child(sc)
	return col

## A turntable of the weapon as it is actually built, when the gun builder exists; a plate of figures otherwise.
func _view() -> Control:
	var w := _current()
	var frame := PanelContainer.new()
	frame.custom_minimum_size = Vector2(0, 232)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Paper.ink(0.055); sb.border_color = Paper.ink(0.26); sb.set_border_width_all(1); sb.corner_detail = 1
	sb.content_margin_left = 10; sb.content_margin_right = 10; sb.content_margin_top = 8; sb.content_margin_bottom = 8
	frame.add_theme_stylebox_override("panel", sb)
	if w.is_empty():
		frame.add_child(PaperUI.empty("Nothing on the bench."))
		return frame
	var built := _build_preview(w)
	if built != null:
		frame.add_child(built)
		return frame
	# no builder yet: the bench card prints the figures instead of a picture
	var v := PaperUI.column(0)
	var wd: Dictionary = Data.weapons.get(str(w["id"]), {})
	v.add_child(PaperUI.label(str(wd.get("full", w["id"])), Paper.S_H2, Paper.INK, "display"))
	v.add_child(PaperUI.caps("%s · %s" % [str(wd.get("cls", "")), Paper.cal_name(str(wd.get("cal", "")))], Paper.S_MICRO, Paper.ink(0.55)))
	v.add_child(PaperUI.spacer(8))
	v.add_child(PaperUI.kv("Rate", "%d rpm" % int(wd.get("rpm", 0))))
	v.add_child(PaperUI.kv("Modes", " / ".join(wd.get("modes", []))))
	v.add_child(PaperUI.kv("Loaded", Paper.mag_text(w)))
	v.add_child(PaperUI.kv("Weight as built", Paper.kg(Inventory.weapon_weight(w), 2)))
	v.add_child(PaperUI.kv("Condition", "%d %%" % roundi(Paper.condition_of(w)), Paper.cond_color(Paper.condition_of(w) / 100.0)))
	frame.add_child(v)
	return frame

func _build_preview(w: Dictionary) -> Control:
	if not ResourceLoader.exists("res://scripts/weapons/gun_builder.gd"): return null
	var scr: Variant = load("res://scripts/weapons/gun_builder.gd")
	if scr == null or not scr.has_method("build"): return null
	var wd: Dictionary = Data.weapons.get(str(w["id"]), {})
	var mesh: Variant = null
	mesh = scr.build(wd, w)
	if not (mesh is Node3D): return null
	var vc := SubViewportContainer.new()
	vc.stretch = true
	vc.custom_minimum_size = Vector2(0, 214)
	vc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_preview = SubViewport.new()
	_preview.transparent_bg = true
	_preview.own_world_3d = true
	_preview.size = Vector2i(380, 214)
	_preview.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vc.add_child(_preview)
	var world := Node3D.new()
	_preview.add_child(world)
	_turn = Node3D.new()
	world.add_child(_turn)
	_turn.add_child(mesh)
	var aabb: AABB = _node_aabb(mesh)
	var centre := aabb.get_center()
	mesh.position = -centre
	var span := maxf(0.2, aabb.size.length())
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = span * 0.85
	cam.position = Vector3(0.0, 0.18 * span, span * 1.4)
	cam.look_at(Vector3.ZERO, Vector3.UP)
	world.add_child(cam)
	var key := DirectionalLight3D.new()
	key.light_energy = 2.2
	key.rotation_degrees = Vector3(-36, 38, 0)
	world.add_child(key)
	var fill := DirectionalLight3D.new()
	fill.light_energy = 0.7
	fill.light_color = Color(0.78, 0.82, 0.88)
	fill.rotation_degrees = Vector3(-8, -128, 0)
	world.add_child(fill)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0, 0, 0, 0)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.62, 0.60, 0.55)
	e.ambient_light_energy = 0.55
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.environment = e
	world.add_child(env)
	return vc

func _node_aabb(n: Node3D) -> AABB:
	var out := AABB()
	var first := true
	for c in _all_meshes(n):
		var a: AABB = c.get_aabb()
		a = c.global_transform * a if c.is_inside_tree() else c.transform * a
		if first: out = a; first = false
		else: out = out.merge(a)
	if first: return AABB(Vector3(-0.2, -0.05, -0.2), Vector3(0.4, 0.1, 0.4))
	return out

func _all_meshes(n: Node) -> Array:
	var out: Array = []
	if n is MeshInstance3D: out.append(n)
	for c in n.get_children(): out.append_array(_all_meshes(c))
	return out

func on_tick(dt: float) -> void:
	if _turn != null and is_instance_valid(_turn): _turn.rotate_y(dt * 0.5)
	if job.is_empty(): return
	job["t"] = float(job["t"]) + dt
	var k: float = clampf(float(job["t"]) / maxf(0.1, float(job["dur"])), 0.0, 1.0)
	if _bar != null and is_instance_valid(_bar):
		_bar.value = k; _bar.queue_redraw()
	if _job_label != null and is_instance_valid(_job_label):
		_job_label.text = "%s / %s s" % [String.num(float(job["t"]), 1), String.num(float(job["dur"]), 0)]
	if float(job["t"]) >= float(job["dur"]):
		var cb: Callable = job["cb"]
		job = {}
		if cb.is_valid(): cb.call()

# ------------------------------------------------------------------------------------------------------------------
# right: the four headings
# ------------------------------------------------------------------------------------------------------------------
func _work() -> Control:
	var col := PaperUI.column(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var counts := TABS.duplicate(true)
	col.add_child(PaperUI.tabs(counts, tab, _pick_tab))
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	var w := _current()
	match tab:
		"armour": _armour(v)
		"attachments":
			if w.is_empty(): v.add_child(PaperUI.empty("No weapon carried. The bench is bare."))
			else: _attachments(v, w)
		"maintenance":
			if w.is_empty(): v.add_child(PaperUI.empty("No weapon carried. The bench is bare."))
			else: _maintenance(v, w)
		_:
			if w.is_empty(): v.add_child(PaperUI.empty("No weapon carried. The bench is bare."))
			else: _magazines(v, w)
	return col

# ---- attachments ---------------------------------------------------------------------------------------------------
func _carried_attachments() -> Array:
	var i: Inventory = inv()
	var out: Array = []
	for id in i.items.keys():
		if Data.attachments.has(str(id)) and i.count(str(id)) > 0: out.append(Data.attachments[str(id)])
	return out

func _mount_block(v: VBoxContainer, title: String, sub: String) -> VBoxContainer:
	v.add_child(PaperUI.spacer(12))
	var h := PaperUI.rowbox(10)
	h.add_child(PaperUI.caps(title, Paper.S_MICRO, Paper.AMBER, true))
	h.add_child(PaperUI.caps(sub, Paper.S_MICRO, Paper.ink(0.50)))
	var r := PaperUI.Rule.new("solid", Paper.ink(0.22))
	r.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(r)
	v.add_child(h)
	v.add_child(PaperUI.spacer(3))
	var inner := PaperUI.column(0)
	v.add_child(inner)
	return inner

func _attachments(v: VBoxContainer, w: Dictionary) -> void:
	var i: Inventory = inv()
	var wd: Dictionary = Data.weapons.get(str(w["id"]), {})
	var carried := _carried_attachments()
	var rails: Array = w.get("rails", [])
	# rails first: they are what makes the other mounts possible
	var fitted_desc: Array = []
	for rid in rails:
		var rd: Dictionary = Data.attachments.get(str(rid), {})
		for s in rd.get("gives", {}).keys(): fitted_desc.append("%s %s" % [str(rd["gives"][s]), str(s)])
	var block := _mount_block(v, "Rails", " · ".join(fitted_desc) if not fitted_desc.is_empty() else "factory mounts")
	var any := false
	for rid in rails:
		var rd: Dictionary = Data.attachments.get(str(rid), {})
		var would: Array = []
		var without: Array = rails.duplicate(); without.erase(rid)
		for s in w.get("attachments", {}).keys():
			var aid := str(w["attachments"][s])
			if not Data.attachment_fits(Data.attachments.get(aid, {}), wd, without): would.append(Paper.name_of(aid))
		var sub := "fitted"
		if not would.is_empty(): sub += " · removing it drops " + ", ".join(would)
		block.add_child(PaperUI.row(PaperUI.name_block(str(rd.get("name", rid)), sub), null,
			[PaperUI.act("Remove", _unfit.bind(str(rid)))]))
		any = true
	for a in carried:
		if str(a.get("slot", "")) != "rail" or str(a["id"]) in rails: continue
		if not Data.attachment_fits(a, wd, rails): continue
		var gives: Array = []
		for s2 in a.get("gives", {}).keys(): gives.append("%s %s" % [str(a["gives"][s2]), str(s2)])
		block.add_child(PaperUI.row(PaperUI.name_block(str(a.get("name", a["id"])), "%s · %d carried" % [" · ".join(gives), i.count(str(a["id"]))]),
			null, [PaperUI.act("Fit", _fit.bind(str(a["id"])))]))
		any = true
	if not any: block.add_child(PaperUI.empty("No rail carried that fits this weapon."))

	var mounts := Data.effective_mounts(wd, rails)
	for slot in MOUNTS:
		if not mounts.has(slot) and not wd.get("mounts", {}).has(slot): continue
		var std := str(mounts.get(slot, "none"))
		var head := "mount · %s" % std if std != "none" else "no mount"
		if std == "integral": head = "integral suppressor"
		var b := _mount_block(v, slot, head)
		var cur: Variant = w.get("attachments", {}).get(slot)
		if cur != null:
			var ad: Dictionary = Data.attachments.get(str(cur), {})
			var fx := Paper.effects_text(ad.get("effects", {}))
			b.add_child(PaperUI.row(PaperUI.name_block(str(ad.get("name", cur)), "fitted · %s" % (fx if fx != "" else "no change")), null,
				[PaperUI.act("Detach", _unfit.bind(str(cur)))]))
		elif std != "none" and std != "integral":
			var fits := 0
			for a2 in carried:
				if str(a2.get("slot", "")) != slot or not Data.attachment_fits(a2, wd, rails): continue
				var fx2 := Paper.effects_text(a2.get("effects", {}))
				b.add_child(PaperUI.row(PaperUI.name_block(str(a2.get("name", a2["id"])),
					"%s · %s · %d carried" % [fx2 if fx2 != "" else "no change", Paper.kg(float(a2.get("weight", 0.0)), 2), i.count(str(a2["id"]))]),
					null, [PaperUI.act("Fit", _fit.bind(str(a2["id"])))]))
				fits += 1
			if fits == 0: b.add_child(PaperUI.empty("Nothing carried fits a %s mount." % std))
		else:
			b.add_child(PaperUI.empty("Nothing fits over it." if std == "integral" else "No mount here. A rail may add one."))
	_as_built(v, w)

## What the weapon actually does once everything on it is counted, against the factory figures.
func _as_built(v: VBoxContainer, w: Dictionary) -> void:
	var wd: Dictionary = Data.weapons.get(str(w["id"]), {})
	var ef := Inventory.weapon_effects(w)
	v.add_child(PaperUI.section("As built", Paper.full_of(str(w["id"]))))
	var moa := float(wd.get("moa", 1.0)) * float(ef.get("moa", 1.0))
	v.add_child(PaperUI.kv("Dispersion", "%s° of %s° factory" % [String.num(moa, 2), String.num(float(wd.get("moa", 1.0)), 2)],
		Paper.RED if moa > float(wd.get("moa", 1.0)) * 1.25 else Paper.INK))
	var rc: Array = wd.get("recoil", [0, 0])
	v.add_child(PaperUI.kv("Recoil", "%s / %s" % [String.num(float(rc[0]) * float(ef.get("recoil", 1.0)), 2), String.num(float(rc[1]) * float(ef.get("recoil", 1.0)), 2)]))
	v.add_child(PaperUI.kv("Ergonomics", "%d" % roundi((float(wd.get("ergo", 0.8)) + float(ef.get("ergo", 0.0))) * 100.0)))
	v.add_child(PaperUI.kv("Noise", Paper.pct(float(ef.get("noise", 1.0)))))
	v.add_child(PaperUI.kv("Muzzle flash", Paper.pct(float(ef.get("flash", 1.0)))))
	if float(ef.get("zoom", 1.0)) != 1.0: v.add_child(PaperUI.kv("Optic", "%s× magnification" % String.num(float(ef["zoom"]), 1)))
	elif ef.get("reticle") != null: v.add_child(PaperUI.kv("Optic", "%s sight" % str(ef["reticle"])))
	if float(ef.get("light", 0.0)) > 0.0: v.add_child(PaperUI.kv("Weapon light", "fitted · L"))
	if ef.get("laser", false): v.add_child(PaperUI.kv("Laser", "fitted"))
	v.add_child(PaperUI.kv("Weight as built", Paper.kg(Inventory.weapon_weight(w), 2)))
	v.add_child(PaperUI.kv("Loaded", Paper.mag_text(w)))
	var txt := Paper.effects_text(ef)
	v.add_child(PaperUI.note("In effect: %s. Mounts are standards, not opinions: a rail converts one, and taking the rail off takes whatever was on it." % (txt if txt != "" else "factory")))

# ---- maintenance ---------------------------------------------------------------------------------------------------
func _in_base() -> bool:
	if Game.player == null or not is_instance_valid(Game.player): return true
	var v: Variant = Game.player.get("in_base")
	return true if v == null else bool(v)

func _part_row(v: VBoxContainer, w: Dictionary, part: String) -> void:
	var i: Inventory = inv()
	var val := float(w.get("parts", {}).get(part, 100.0))
	var item := str(KitView.PART_ITEM.get(part, ""))
	var busy := not job.is_empty()
	var line := PaperUI.column(0)
	var h := PaperUI.rowbox(12)
	h.custom_minimum_size = Vector2(0, 30)
	h.add_child(PaperUI.caps(part, Paper.S_MICRO, Paper.ink(0.66)))
	var bar := PaperUI.Bar.new(val / 100.0, Paper.cond_color(val / 100.0), 3.0)
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.custom_minimum_size = Vector2(120, 3)
	h.add_child(bar)
	var num := PaperUI.number("%d" % roundi(val), "%", Paper.cond_color(val / 100.0))
	num.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(num)
	var acts := PaperUI.rowbox(6)
	acts.size_flags_horizontal = Control.SIZE_SHRINK_END
	acts.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	acts.add_child(PaperUI.act("Repair +35", _repair.bind(part),
		{ "disabled": busy or val >= 100.0 or not i.has("repairkit"), "tooltip": "Weapon repair kit · %d uses" % KitView.uses_left("repairkit") }))
	acts.add_child(PaperUI.act("Replace", _replace.bind(part),
		{ "disabled": busy or val >= 100.0 or not i.has(item), "tooltip": Paper.name_of(item) }))
	h.add_child(acts)
	line.add_child(h)
	line.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	v.add_child(line)

func _maintenance(v: VBoxContainer, w: Dictionary) -> void:
	var i: Inventory = inv()
	var wd: Dictionary = Data.weapons.get(str(w["id"]), {})
	var busy := not job.is_empty()
	v.add_child(PaperUI.section("Parts", Paper.full_of(str(w["id"]))))
	for p in ["barrel", "bolt", "frame"]: _part_row(v, w, p)
	var dirt := float(w.get("dirt", 0.0))
	var h := PaperUI.rowbox(12)
	h.custom_minimum_size = Vector2(0, 30)
	h.add_child(PaperUI.caps("fouling", Paper.S_MICRO, Paper.ink(0.66)))
	var db := PaperUI.Bar.new(dirt, Paper.RED if dirt > 0.5 else Paper.AMBER, 3.0)
	db.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	db.custom_minimum_size = Vector2(120, 3)
	h.add_child(db)
	var dn := PaperUI.number("%d" % roundi(dirt * 100.0), "%", Paper.RED if dirt > 0.5 else (Paper.AMBER if dirt > 0.25 else Paper.INK))
	dn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(dn)
	var in_base := _in_base()
	var ca := PaperUI.rowbox(6)
	ca.size_flags_horizontal = Control.SIZE_SHRINK_END
	ca.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	ca.add_child(PaperUI.act("Clean · 4 s" if in_base else "Clean · kit use", _clean,
		{ "disabled": busy or dirt < 0.005 or (not in_base and not i.has("cleankit")) }))
	if bool(w.get("jammed", false)):
		ca.add_child(PaperUI.act("Clear stoppage", _unjam, { "disabled": busy }))
	h.add_child(ca)
	v.add_child(h)
	v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	if bool(w.get("jammed", false)):
		v.add_child(PaperUI.row(PaperUI.name_block("Action", "a round is caught in the receiver", [["stoppage", Paper.RED]]), null, []))
	if busy:
		v.add_child(PaperUI.spacer(10))
		var jh := PaperUI.rowbox(10)
		jh.add_child(PaperUI.caps(str(job.get("label", "")), Paper.S_MICRO, Paper.AMBER))
		jh.add_child(PaperUI.stretch())
		_job_label = PaperUI.label("0.0 / %s s" % String.num(float(job["dur"]), 0), Paper.S_TINY, Paper.ink(0.60))
		jh.add_child(_job_label)
		v.add_child(jh)
		v.add_child(PaperUI.spacer(4))
		_bar = PaperUI.Bar.new(float(job["t"]) / maxf(0.1, float(job["dur"])), Paper.AMBER, 4.0)
		v.add_child(_bar)

	var ef := Inventory.weapon_effects(w)
	var barrel := float(w.get("parts", {}).get("barrel", 100.0))
	var bolt := float(w.get("parts", {}).get("bolt", 100.0))
	var frame := float(w.get("parts", {}).get("frame", 100.0))
	var jam := 0.18 * dirt * dirt * dirt + 0.12 * pow(1.0 - bolt / 100.0, 2.0)
	v.add_child(PaperUI.section("Effect of wear"))
	v.add_child(PaperUI.kv("Dispersion", "%s° of %s°" % [String.num(float(wd.get("moa", 1.0)) * float(ef.get("moa", 1.0)), 2), String.num(float(wd.get("moa", 1.0)), 2)]))
	v.add_child(PaperUI.kv("Damage", Paper.pct(1.0 - 0.15 * (1.0 - barrel / 100.0))))
	v.add_child(PaperUI.kv("Stoppage per shot", "%s %%" % String.num(jam * 100.0, 1), Paper.RED if jam > 0.05 else Paper.INK))
	v.add_child(PaperUI.kv("Misfire", "possible · frame worn" if frame < 30.0 else "none", Paper.RED if frame < 30.0 else Paper.INK))
	v.add_child(PaperUI.note("%s A repair kit adds 35 to one part; a replacement part restores it. Carried: %s." % [
		"At Vanno the bench is stocked and cleaning is free." if in_base else "In the field a clean spends one use of a cleaning kit.",
		_kit_line()]))

func _kit_line() -> String:
	var i: Inventory = inv()
	var parts: Array = []
	for id in ["cleankit", "repairkit", "armorkit"]:
		var n := i.count(id)
		parts.append("%s ×%d%s" % [Paper.name_of(id), n, (" (%d uses)" % KitView.uses_left(id)) if n > 0 else ""])
	parts.append("barrels ×%d" % i.count("part_barrel"))
	parts.append("bolts ×%d" % i.count("part_bolt"))
	parts.append("springs ×%d" % i.count("part_spring"))
	return " · ".join(parts)

# ---- magazines -----------------------------------------------------------------------------------------------------
func _pick_for(cal: String) -> String:
	var i: Inventory = inv()
	var p := str(picks.get(cal, ""))
	if p != "" and i.count(p) > 0: return p
	return i.preferred_ammo(cal)

func _magazines(v: VBoxContainer, w: Dictionary) -> void:
	var i: Inventory = inv()
	var wd: Dictionary = Data.weapons.get(str(w["id"]), {})
	var cal := str(wd.get("cal", ""))
	var types: Array = []
	for id in i.items.keys():
		if Data.ammo.has(str(id)) and str(Data.ammo[str(id)].get("cal", "")) == cal and i.count(str(id)) > 0:
			types.append(Data.ammo[str(id)])
	var pick := _pick_for(cal)
	v.add_child(PaperUI.section("Load with", Paper.cal_name(cal)))
	if types.is_empty():
		v.add_child(PaperUI.empty("No loose %s carried. The crate sells it in lots of ten." % Paper.cal_short(cal)))
	else:
		var strip := PaperUI.rowbox(6)
		strip.custom_minimum_size = Vector2(0, 30)
		for a in types:
			strip.add_child(PaperUI.act("%s · %d" % [str(a.get("name", a["id"])), i.count(str(a["id"]))],
				_pick_ammo.bind(cal, str(a["id"])), { "on": str(a["id"]) == pick }))
		v.add_child(strip)
	var internal := int(wd.get("internal", 0))
	if internal > 0:
		var tube: Array = w.get("tube", [])
		var last: String = str(tube[tube.size() - 1]) if not tube.is_empty() else ""
		var other := last != "" and last != pick
		var sub := ("%s" % Paper.ammo_tag(last)) if last != "" else "empty"
		if w.get("chamber") != null: sub += " · one chambered"
		if other: sub += " · holds %s: unload first" % Paper.ammo_tag(last)
		v.add_child(PaperUI.section("Internal magazine" if bool(wd.get("clip", false)) else "Tube"))
		v.add_child(PaperUI.row(PaperUI.name_block(Paper.full_of(str(w["id"])), sub),
			PaperUI.number("%d / %d" % [tube.size(), internal]),
			[PaperUI.act("Load", _tube_load, { "disabled": tube.size() >= internal or other or pick == "" or i.count(pick) <= 0 }),
			 PaperUI.act("Unload", _tube_unload, { "disabled": tube.is_empty() })]))
	var mags: Array = []
	if w.get("mag") is Dictionary: mags.append(w["mag"])
	mags.append_array(i.mags_for_weapon(w))
	v.add_child(PaperUI.section("Clips" if bool(wd.get("clip", false)) else "Magazines", str(mags.size()) if not mags.is_empty() else ""))
	if mags.is_empty():
		v.add_child(PaperUI.empty("No magazine carried for the %s." % str(wd.get("name", w["id"]))))
	var need := 0
	for m in mags:
		var md: Dictionary = Data.magazines.get(str(m["id"]), {})
		var cap := int(md.get("cap", 0))
		need += maxi(0, cap - int(m.get("rounds", 0)))
		var in_gun: bool = w.get("mag") is Dictionary and int(w["mag"].get("uid", -1)) == int(m.get("uid", -2))
		var full := int(m.get("rounds", 0)) >= cap
		var other2: bool = int(m.get("rounds", 0)) > 0 and m.get("ammo") != null and str(m["ammo"]) != pick
		var tags: Array = []
		if in_gun: tags.append(["in weapon", Paper.AMBER])
		elif i.is_ready(int(m["uid"])): tags.append(["ready", Paper.AMBER])
		var sub2 := Paper.mag_sub(m)
		if other2: sub2 += " · holds %s: unload before loading %s" % [Paper.ammo_tag(str(m["ammo"])), Paper.ammo_tag(pick)]
		v.add_child(PaperUI.row(PaperUI.name_block(str(md.get("name", m["id"])), sub2, tags),
			PaperUI.number("%d" % int(m.get("rounds", 0)), "/ %d" % cap),
			[PaperUI.act("Load", _load_mag.bind(int(m["uid"])), { "disabled": full or other2 or pick == "" or i.count(pick) <= 0, "deny": not full and pick != "" and i.count(pick) <= 0 }),
			 PaperUI.act("Unload", _unload_mag.bind(int(m["uid"])), { "disabled": int(m.get("rounds", 0)) <= 0 })]))
	var strip2 := PaperUI.rowbox(12)
	strip2.custom_minimum_size = Vector2(0, 36)
	strip2.add_child(PaperUI.act("Fill every magazine", _fill_all, { "disabled": need <= 0 or types.is_empty() }))
	strip2.add_child(PaperUI.label("%d rounds would fill them" % need, Paper.S_TINY, Paper.ink(0.55)))
	v.add_child(strip2)
	var loose: Array = []
	for a2 in types: loose.append("%s ×%d" % [str(a2.get("name", a2["id"])), i.count(str(a2["id"]))])
	v.add_child(PaperUI.note("Loose rounds: %s. One ammunition type per magazine." % (" · ".join(loose) if not loose.is_empty() else "none for this calibre")))

# ---- armour --------------------------------------------------------------------------------------------------------
func _armour(v: VBoxContainer) -> void:
	var i: Inventory = inv()
	var pieces: Array = []
	for g in i.gear:
		var d := Data.def(str(g["id"]))
		if str(d.get("kind", "")) in ["vest", "helmet"] and d.get("durability") != null: pieces.append(g)
	v.add_child(PaperUI.section("Armour carried", str(pieces.size()) if not pieces.is_empty() else ""))
	if pieces.is_empty():
		v.add_child(PaperUI.empty("No armour carried."))
	for g in pieces:
		var d := Data.def(str(g["id"]))
		var maxd := float(d.get("durability", 1))
		var val := float(g.get("durability", maxd))
		var frac := val / maxf(1.0, maxd)
		var slot := KitView.slot_of_uid(i, int(g["uid"]))
		var h := PaperUI.rowbox(12)
		h.custom_minimum_size = Vector2(0, 34)
		var nb := PaperUI.name_block(str(d.get("name", g["id"])),
			"class %s · covers %s · effective class %s" % [str(d.get("cls", "-")), ", ".join(d.get("zones", [])), String.num(float(d.get("cls", 1)) * (0.55 + 0.45 * frac), 1)],
			[["worn", Paper.AMBER]] if slot != "" else [])
		nb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		h.add_child(nb)
		var bar := PaperUI.Bar.new(frac, Paper.cond_color(frac), 3.0)
		bar.custom_minimum_size = Vector2(110, 3)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		bar.size_flags_horizontal = Control.SIZE_FILL
		h.add_child(bar)
		var num := PaperUI.number("%d / %d" % [roundi(val), int(maxd)], "", Paper.cond_color(frac))
		num.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		h.add_child(num)
		h.add_child(PaperUI.act("Repair +40", _repair_armour.bind(int(g["uid"])),
			{ "disabled": not job.is_empty() or val >= maxd or not i.has("armorkit"), "tooltip": "Armour repair kit" }))
		v.add_child(h)
		v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	v.add_child(PaperUI.note("An armour repair kit restores 40 durability to one piece per use. Effective class falls with damage: a class 3 vest at half durability stops as class %s. Carried: %s ×%d%s." % [
		String.num(3.0 * (0.55 + 0.45 * 0.5), 1), Paper.name_of("armorkit"), i.count("armorkit"),
		(" (%d uses)" % KitView.uses_left("armorkit")) if i.count("armorkit") > 0 else ""]))

# ------------------------------------------------------------------------------------------------------------------
# actions
# ------------------------------------------------------------------------------------------------------------------
func _pick_tab(id: String) -> void:
	tab = id
	snd("ui_tab", 0.4)
	refresh()

func _pick_weapon(uid: int) -> void:
	wuid = uid
	snd("ui_click", 0.35)
	refresh()

func _pick_ammo(cal: String, id: String) -> void:
	picks[cal] = id
	inv().set_preferred_ammo(cal, id)
	snd("ui_click", 0.35)
	refresh()

func _fit(att_id: String) -> void:
	var i: Inventory = inv()
	var w := _current()
	if w.is_empty() or not i.has(att_id): return
	if not Inventory.attach(w, att_id):
		deny("%s does not fit the %s." % [Paper.name_of(att_id), Paper.name_of(str(w["id"]))]); return
	i.remove(att_id, 1)
	notice("%s fitted to the %s." % [Paper.name_of(att_id), Paper.name_of(str(w["id"]))])
	_changed(); snd("attach_on", 0.6); refresh()

func _unfit(att_id: String) -> void:
	var i: Inventory = inv()
	var w := _current()
	if w.is_empty(): return
	var r: Variant = Inventory.detach(w, att_id)
	if r is bool and not r:
		deny("It is not fitted."); return
	i.add(att_id, 1)
	var dropped: Array = r["dropped"] if r is Dictionary else []
	for x in dropped: i.add(str(x), 1)
	var extra := ""
	if not dropped.is_empty():
		var names: Array = []
		for x in dropped: names.append(Paper.name_of(str(x)))
		extra = " Came off with it: %s." % ", ".join(names)
	notice("%s removed.%s" % [Paper.name_of(att_id), extra])
	_changed(); snd("attach_off", 0.6); refresh()

func _clean() -> void:
	var i: Inventory = inv()
	var w := _current()
	if w.is_empty() or not job.is_empty(): return
	var in_base := _in_base()
	if not in_base and not i.use_charge("cleankit"):
		deny("No cleaning kit carried."); return
	var name := Paper.name_of(str(w["id"]))
	var uid := int(w["uid"])
	job = { "label": "Stripping the %s" % name, "t": 0.0, "dur": 4.0, "cb": _clean_done.bind(uid, name, in_base) }
	notice("%s on the bench." % name)
	snd("reload_magout", 0.5)
	refresh()

func _clean_done(uid: int, name: String, in_base: bool) -> void:
	var w: Variant = inv().weapon_by_uid(uid)
	if w is Dictionary:
		w["dirt"] = 0.0
		w["jammed"] = false
	notice("%s stripped, cleaned and oiled.%s" % [name, "" if in_base else " Kit use spent."])
	_changed(); snd("weapon_clean", 0.6); refresh()

func _unjam() -> void:
	var w := _current()
	if w.is_empty() or not bool(w.get("jammed", false)): return
	w["jammed"] = false
	notice("%s: stoppage cleared." % Paper.name_of(str(w["id"])))
	_changed(); snd("unjam", 0.6); refresh()

func _repair(part: String) -> void:
	var i: Inventory = inv()
	var w := _current()
	if w.is_empty() or not w.get("parts", {}).has(part): return
	if float(w["parts"][part]) >= 100.0:
		deny("%s: nothing to repair." % part); return
	if not i.use_charge("repairkit"):
		deny("No repair kit carried."); return
	var add := float(Data.def("repairkit").get("repair", 35))
	w["parts"][part] = minf(100.0, float(w["parts"][part]) + add)
	notice("%s %s: %d %%. Kit use spent." % [Paper.name_of(str(w["id"])), part, roundi(float(w["parts"][part]))])
	_changed(); snd("wrench", 0.55); refresh()

func _replace(part: String) -> void:
	var i: Inventory = inv()
	var w := _current()
	var item := str(KitView.PART_ITEM.get(part, ""))
	if w.is_empty() or item == "": return
	if not i.has(item):
		deny("No %s carried." % Paper.lower_first(Paper.name_of(item))); return
	i.remove(item, 1)
	w["parts"][part] = 100.0
	notice("%s: %s replaced." % [Paper.name_of(str(w["id"])), part])
	_changed(); snd("reload_magin", 0.55); refresh()

func _mag_by_uid(uid: int) -> Variant:
	var i: Inventory = inv()
	var m: Variant = i.mag_by_uid(uid)
	if m != null: return m
	for w in i.weapons:
		if w.get("mag") is Dictionary and int(w["mag"].get("uid", -1)) == uid: return w["mag"]
	return null

func _load_mag(uid: int) -> void:
	var i: Inventory = inv()
	var m: Variant = _mag_by_uid(uid)
	if not (m is Dictionary): return
	var ammo := _pick_for(str(m.get("cal", "")))
	if ammo == "": deny("No ammunition of that calibre carried."); return
	if int(m.get("rounds", 0)) > 0 and m.get("ammo") != null and str(m["ammo"]) != ammo:
		deny("It holds %s. Unload it first." % Paper.name_of(str(m["ammo"]))); return
	var n := i.load_mag(m, ammo, 999)
	if n <= 0: deny("No loose %s." % Paper.name_of(ammo)); return
	notice("%d round%s of %s loaded." % [n, "" if n == 1 else "s", Paper.name_of(ammo)])
	_changed(); snd("mag_load_round", 0.6); refresh()

func _unload_mag(uid: int) -> void:
	var i: Inventory = inv()
	var m: Variant = _mag_by_uid(uid)
	if not (m is Dictionary) or int(m.get("rounds", 0)) <= 0: return
	var n := int(m["rounds"])
	var a: String = str(m["ammo"]) if m.get("ammo") != null else ""
	i.unload_mag(m)
	notice("%d round%s of %s returned to the pack." % [n, "" if n == 1 else "s", Paper.name_of(a) if a != "" else "ammunition"])
	_changed(); snd("reload_magout", 0.5); refresh()

func _fill_all() -> void:
	var i: Inventory = inv()
	var w := _current()
	if w.is_empty(): return
	var n := i.fill_mags(w)
	if n <= 0: deny("Nothing to load."); return
	notice("%d round%s loaded across the magazines." % [n, "" if n == 1 else "s"])
	_changed(); snd("mag_load_round", 0.6); refresh()

func _tube_load() -> void:
	var i: Inventory = inv()
	var w := _current()
	var wd: Dictionary = Data.weapons.get(str(w.get("id", "")), {})
	var internal := int(wd.get("internal", 0))
	if internal <= 0: return
	var ammo := _pick_for(str(wd.get("cal", "")))
	if ammo == "": return
	var tube: Array = w.get("tube", [])
	if not tube.is_empty() and str(tube[tube.size() - 1]) != ammo:
		deny("It holds %s. Unload it first." % Paper.name_of(str(tube[0]))); return
	var n := 0
	while tube.size() < internal and i.count(ammo) > 0:
		i.remove(ammo, 1); tube.append(ammo); n += 1
	w["tube"] = tube
	if n <= 0: deny("No loose rounds."); return
	notice("%d round%s of %s loaded." % [n, "" if n == 1 else "s", Paper.name_of(ammo)])
	_changed(); snd("shell_insert", 0.6); refresh()

func _tube_unload() -> void:
	var i: Inventory = inv()
	var w := _current()
	var tube: Array = w.get("tube", [])
	if tube.is_empty(): return
	var n := tube.size()
	for a in tube: i.add(str(a), 1)
	w["tube"] = []
	notice("%d round%s returned to the pack." % [n, "" if n == 1 else "s"])
	_changed(); snd("reload_magout", 0.5); refresh()

func _repair_armour(uid: int) -> void:
	var i: Inventory = inv()
	var g: Variant = i.gear_by_uid(uid)
	if not (g is Dictionary): return
	var d := Data.def(str(g["id"]))
	var maxd := float(d.get("durability", 0))
	if maxd <= 0.0: return
	if float(g.get("durability", maxd)) >= maxd:
		deny("Nothing to repair."); return
	if not i.use_charge("armorkit"):
		deny("No armour repair kit carried."); return
	var add := float(Data.def("armorkit").get("repair", 40))
	g["durability"] = minf(maxd, float(g.get("durability", maxd)) + add)
	notice("%s: %d / %d. Kit use spent." % [str(d.get("name", g["id"])), roundi(float(g["durability"])), int(maxd)])
	snd("wrench", 0.55); refresh()

func _changed() -> void:
	if Game.player == null or not is_instance_valid(Game.player): return
	var w: Variant = Game.player.get("weapons")
	if w != null and is_instance_valid(w) and w.has_method("on_inventory_changed"): w.on_inventory_changed()
