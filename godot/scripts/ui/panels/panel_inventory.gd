extends RadiusPanel
## Form 61-K — the kit manifest. Three columns of one sheet: what is worn (with the rig pouches, the load and the
## quick keys), the manifest itself by category, and the particulars of whatever is selected.
## Items move by keyboard (Equip / Ready / Prefer / Use / Drop on every line) or by dragging a line onto a slot.

var sel: Dictionary = {}
var slot_sel := ""

func panel_id() -> String: return "inventory"
func title_text() -> String: return "Kit manifest"
func form_code() -> String: return "61-K"
func close_action() -> String: return "inventory"
func key_hint() -> String: return "Esc or I close · arrows move · Enter select · drag a line onto a slot"
func sheet_size(vp: Vector2) -> Vector2:
	return Vector2(minf(vp.x - 60.0, 1640.0), minf(vp.y - 50.0, 1010.0))

# ------------------------------------------------------------------------------------------------------------------
func build() -> void:
	if not has_inv():
		add_child(PaperUI.empty("No kit on file. The manifest is drawn from the Explorer's own inventory."))
		return
	var cols := PaperUI.rowbox(0)
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(cols)
	cols.add_child(_worn_column())
	cols.add_child(_gutter())
	cols.add_child(_manifest_column())
	cols.add_child(_gutter())
	cols.add_child(_card_column())

func _gutter() -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 0)
	h.custom_minimum_size = Vector2(29, 0)
	h.add_child(PaperUI.hspacer(14))
	h.add_child(PaperUI.Rule.new("solid", Paper.ink(0.20), true))
	h.add_child(PaperUI.hspacer(14))
	return h

# ------------------------------------------------------------------------------------------------------------------
# left: what is worn
# ------------------------------------------------------------------------------------------------------------------
func _worn_column() -> Control:
	var col := PaperUI.pane(322, 0)
	col.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	v.add_child(PaperUI.caps("Worn and carried", Paper.S_MICRO, Paper.AMBER, true))
	v.add_child(PaperUI.spacer(6))
	for s in KitView.DOLL:
		v.add_child(_slot_button(s))
		v.add_child(PaperUI.spacer(3))
	v.add_child(_pouches())
	v.add_child(_load_block())
	v.add_child(_quick_block())
	col.add_child(sc)
	return col

func _slot_button(s: String) -> Control:
	var i: Inventory = inv()
	var uid: Variant = i.equipment.get(s)
	var instv: Variant = i.equipped(s) if uid != null else null
	var d: Dictionary = Data.def(str(instv["id"])) if instv is Dictionary else {}
	var b := Button.new()
	b.theme_type_variation = "PaperRow"
	b.focus_mode = Control.FOCUS_ALL
	b.custom_minimum_size = Vector2(0, 52)
	b.set_meta("fkey", "slot:" + s)
	b.pressed.connect(_pick_slot.bind(s))
	var sb := StyleBoxFlat.new()
	sb.bg_color = Paper.amber(0.13) if slot_sel == s else Paper.ink(0.035)
	sb.border_color = Paper.AMBER if slot_sel == s else Paper.ink(0.20)
	sb.set_border_width_all(1)
	if instv == null: sb.border_color = Paper.ink(0.13)
	sb.content_margin_left = 9; sb.content_margin_right = 9; sb.content_margin_top = 5; sb.content_margin_bottom = 5
	b.add_theme_stylebox_override("normal", sb)
	b.add_theme_stylebox_override("hover", sb)

	var row := HBoxContainer.new()
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 10; row.offset_right = -10; row.offset_top = 5; row.offset_bottom = -5
	row.add_theme_constant_override("separation", 8)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var left := PaperUI.column(1)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	left.add_child(PaperUI.caps(KitView.SLOT_LABEL.get(s, s), Paper.S_MICRO, Paper.ink(0.52)))
	if instv is Dictionary:
		var nl := PaperUI.label(str(d.get("name", instv["id"])), Paper.S_SMALL, Paper.INK, "mono_med")
		nl.clip_text = true
		left.add_child(nl)
		var sub := ""
		var frac := -1.0
		if str(d.get("kind", "")) == "weapon":
			frac = Paper.condition_of(instv) / 100.0
			sub = Paper.mag_text(instv)
		elif d.get("durability") != null:
			frac = float(instv.get("durability", d["durability"])) / maxf(1.0, float(d["durability"]))
			sub = "class %s · %d / %d" % [str(d.get("cls", "-")), roundi(float(instv.get("durability", d["durability"]))), int(d["durability"])]
		elif instv.get("charge") != null:
			frac = float(instv["charge"]) / 100.0
			sub = "%s %d %%" % ["filter" if d.get("filter") != null else "cell", roundi(float(instv["charge"]))]
		else:
			sub = Paper.gear_sub(instv)
		if sub != "":
			var sl := PaperUI.label(sub, Paper.S_TINY, Paper.ink(0.56))
			sl.clip_text = true
			left.add_child(sl)
		if frac >= 0.0:
			left.add_child(PaperUI.spacer(2))
			left.add_child(PaperUI.Bar.new(frac, Paper.cond_color(frac), 2.0))
	else:
		left.add_child(PaperUI.label("empty", Paper.S_SMALL, Paper.ink(0.34)))
	row.add_child(left)
	if instv is Dictionary:
		var w: float = Inventory.weapon_weight(instv) if str(d.get("kind", "")) == "weapon" else Data.weight_of(str(instv["id"]))
		var wl := PaperUI.caps(Paper.kg(w), Paper.S_MICRO, Paper.ink(0.50))
		wl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(wl)
	b.add_child(row)
	b.set_drag_forwarding(Callable(), _slot_can_drop.bind(s), _slot_drop.bind(s))
	return b

func _pouches() -> Control:
	var i: Inventory = inv()
	var slots := i.ready_slots()
	var v := PaperUI.column(0)
	v.add_child(PaperUI.spacer(10))
	v.add_child(PaperUI.caps("Rig pouches", Paper.S_MICRO, Paper.AMBER, true))
	v.add_child(PaperUI.spacer(4))
	if slots <= 0:
		v.add_child(PaperUI.label("No rig worn. Every reload comes out of the pack.", Paper.S_TINY, Paper.ink(0.48)))
		return v
	var grid := GridContainer.new()
	grid.columns = mini(6, maxi(3, slots))
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	var ready: Array = i.ready_mags
	for k in slots:
		var cell := PanelContainer.new()
		cell.custom_minimum_size = Vector2(0, 30)
		cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var sb := StyleBoxFlat.new()
		sb.set_border_width_all(1)
		sb.content_margin_left = 4; sb.content_margin_right = 4; sb.content_margin_top = 2; sb.content_margin_bottom = 2
		var txt := "free"
		var col := Paper.ink(0.34)
		if k < ready.size():
			var m: Variant = i.mag_by_uid(int(ready[k]))
			if m is Dictionary:
				txt = "%d" % int(m.get("rounds", 0))
				col = Paper.INK
				sb.bg_color = Paper.ink(0.05); sb.border_color = Paper.ink(0.30)
			else:
				sb.border_color = Paper.ink(0.13)
		else:
			sb.border_color = Paper.ink(0.13)
		cell.add_theme_stylebox_override("panel", sb)
		var cv := VBoxContainer.new()
		cv.add_theme_constant_override("separation", 0)
		cv.alignment = BoxContainer.ALIGNMENT_CENTER
		var l := PaperUI.label(txt, Paper.S_SMALL, col, "mono_med")
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cv.add_child(l)
		cell.add_child(cv)
		grid.add_child(cell)
	v.add_child(grid)
	v.add_child(PaperUI.spacer(3))
	v.add_child(PaperUI.label("%d of %d filled · fast reloads" % [mini(ready.size(), slots), slots], Paper.S_TINY, Paper.ink(0.52)))
	return v

func _load_block() -> Control:
	var i: Inventory = inv()
	var w := i.weight()
	var c := i.capacity()
	var over := w > c
	var hard := w > c * Inventory.SPRINT_LOAD
	var v := PaperUI.column(0)
	v.add_child(PaperUI.spacer(14))
	v.add_child(PaperUI.caps("Load", Paper.S_MICRO, Paper.AMBER, true))
	v.add_child(PaperUI.spacer(4))
	var h := PaperUI.rowbox(8)
	h.add_child(PaperUI.label("Carried", Paper.S_TINY, Paper.ink(0.60)))
	h.add_child(PaperUI.stretch())
	h.add_child(PaperUI.number("%s / %s" % [String.num(w, 1), String.num(c, 0)], "kg", Paper.RED if over else Paper.INK))
	v.add_child(h)
	v.add_child(PaperUI.spacer(4))
	v.add_child(PaperUI.Bar.new(minf(1.0, w / maxf(1.0, c)), Paper.RED if over else Paper.AMBER, 4.0, hard))
	v.add_child(PaperUI.spacer(4))
	var note := "%s to spare" % Paper.kg(c - w)
	var col := Paper.ink(0.55)
	if hard:
		note = "Over the limit · cannot sprint"; col = Paper.RED
	elif over:
		note = "Overweight · walking slowed"; col = Paper.AMBER
	v.add_child(PaperUI.label(note, Paper.S_TINY, col))
	return v

func _quick_block() -> Control:
	var i: Inventory = inv()
	var v := PaperUI.column(0)
	v.add_child(PaperUI.spacer(14))
	v.add_child(PaperUI.caps("Quick keys", Paper.S_MICRO, Paper.AMBER, true))
	v.add_child(PaperUI.spacer(4))
	for k in 4:
		var id: Variant = i.quick[k] if k < i.quick.size() else null
		var h := PaperUI.rowbox(8)
		h.custom_minimum_size = Vector2(0, 22)
		h.add_child(PaperUI.caps(str(k + 6), Paper.S_MICRO, Paper.AMBER))
		if id == null:
			h.add_child(PaperUI.label("free", Paper.S_TINY, Paper.ink(0.34)))
			h.add_child(PaperUI.stretch())
		else:
			var nl := PaperUI.label(Paper.name_of(str(id)), Paper.S_TINY, Paper.INK)
			nl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			nl.clip_text = true
			h.add_child(nl)
			h.add_child(PaperUI.caps("%d ×" % i.count(str(id)), Paper.S_MICRO, Paper.ink(0.55)))
		v.add_child(h)
		v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.18)))
	return v

# ------------------------------------------------------------------------------------------------------------------
# middle: the manifest
# ------------------------------------------------------------------------------------------------------------------
func _manifest_column() -> Control:
	var col := PaperUI.column(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.size_flags_stretch_ratio = 1.0
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	var i: Inventory = inv()
	var by := KitView.by_category(i)
	_weapons(v, by.get("weapon", []))
	_mags(v, by.get("mag", []))
	_ammo(v, by.get("ammo", []), by.get("weapon", []))
	_meds(v, by.get("med", []))
	_tools(v, by.get("tools", []))
	_kit(v, by.get("kit", []))
	_attachments(v, by.get("attachment", []))
	_parts(v, by.get("parts", []))
	_artifacts(v, by.get("artifact", []))
	_mission(v, by.get("mission", []))
	v.add_child(PaperUI.spacer(16))
	return col

func _line(e: Dictionary, name: String, sub: String, tags: Array, right: Variant, acts: Array) -> Control:
	var selected := _is_sel(e)
	var b := PaperUI.select_row(_pick_entry.bind(e), selected)
	b.set_meta("fkey", "e:" + KitView.key_of(e))
	PaperUI.row_body(b, PaperUI.name_block(name, sub, tags), right, acts)
	b.set_drag_forwarding(_entry_drag.bind(e), Callable(), Callable())
	var v := PaperUI.column(0)
	v.add_child(b)
	v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	return v

func _weapons(v: VBoxContainer, list: Array) -> void:
	v.add_child(PaperUI.section("Weapons", str(list.size()) if list.size() > 0 else ""))
	if list.is_empty():
		v.add_child(PaperUI.empty("No weapons carried.")); return
	var i: Inventory = inv()
	for e in list:
		var w: Dictionary = e["inst"]
		var slot := KitView.slot_of_uid(i, int(w["uid"]))
		var tags: Array = [[KitView.SLOT_LABEL.get(slot, slot), Paper.AMBER]] if slot != "" else [["in pack", Paper.ink(0.42)]]
		var acts: Array = []
		if slot != "": acts.append(PaperUI.act("Unequip", _unequip.bind(slot)))
		else: acts.append(PaperUI.act("Equip", _equip_weapon.bind(int(w["uid"]))))
		acts.append(_drop_button(e))
		v.add_child(_line(e, Paper.full_of(str(e["id"])), Paper.weapon_sub(w), tags,
			PaperUI.number(Paper.kg_num(Inventory.weapon_weight(w)), "kg"), acts))

func _mags(v: VBoxContainer, list: Array) -> void:
	var i: Inventory = inv()
	var slots := i.ready_slots()
	var head := "%d · ready %d / %d" % [list.size(), i.ready_mags.size(), slots] if not list.is_empty() else ""
	v.add_child(PaperUI.section("Magazines", head))
	if list.is_empty():
		v.add_child(PaperUI.empty("No magazines carried.")); return
	for e in list:
		var m: Dictionary = e["inst"]
		var ready := i.is_ready(int(m["uid"]))
		var tags: Array = [["ready", Paper.AMBER]] if ready else []
		var acts: Array = [PaperUI.act("Ready" if ready else "Stow", _toggle_ready.bind(int(m["uid"])), { "on": ready }), _drop_button(e)]
		v.add_child(_line(e, Paper.name_of(str(e["id"])), Paper.mag_sub(m), tags,
			PaperUI.number(Paper.kg_num(Inventory.mag_weight(m), 2), "kg"), acts))

func _ammo(v: VBoxContainer, list: Array, weapons: Array) -> void:
	var i: Inventory = inv()
	var cals: Array = []
	for e in list:
		var c := str(Data.ammo[str(e["id"])].get("cal", ""))
		if not cals.has(c): cals.append(c)
	for e in weapons:
		var c2 := str(Data.weapons.get(str(e["id"]), {}).get("cal", ""))
		if c2 != "" and not cals.has(c2): cals.append(c2)
	var total := 0
	for e in list: total += int(e.get("count", 0))
	v.add_child(PaperUI.section("Ammunition", "%d rounds" % total if total > 0 else ""))
	if cals.is_empty():
		v.add_child(PaperUI.empty("No ammunition carried.")); return
	for cal in cals:
		var head := PaperUI.rowbox(8)
		head.custom_minimum_size = Vector2(0, 22)
		head.add_child(PaperUI.caps(Paper.cal_name(cal), Paper.S_MICRO, Paper.ink(0.72)))
		head.add_child(PaperUI.stretch())
		var n := i.ammo_count(cal)
		head.add_child(PaperUI.caps("%d loose" % n, Paper.S_MICRO, Paper.ink(0.45)))
		v.add_child(head)
		var types: Array = []
		for e in list:
			if str(Data.ammo[str(e["id"])].get("cal", "")) == cal: types.append(e)
		if types.is_empty():
			v.add_child(PaperUI.empty("None carried for it.")); continue
		var pref := i.preferred_ammo(cal)
		for e in types:
			var a: Dictionary = Data.ammo[str(e["id"])]
			var on := pref == str(e["id"])
			var sub := "damage %d%s · penetration class %s" % [int(a.get("damage", 0)),
				(" × %d" % int(a["pellets"])) if int(a.get("pellets", 1)) > 1 else "", str(a.get("pen", 1))]
			if float(a.get("noise", 1.0)) != 1.0: sub += " · noise %d %%" % roundi(float(a["noise"]) * 100.0)
			var acts: Array = [PaperUI.act("Prefer", _prefer.bind(cal, str(e["id"])), { "on": on }), _drop_button(e, "Drop all")]
			v.add_child(_line(e, str(a.get("name", e["id"])), sub, [["preferred", Paper.AMBER]] if on else [],
				PaperUI.number(str(int(e.get("count", 0))), "rounds"), acts))

func _meds(v: VBoxContainer, list: Array) -> void:
	v.add_child(PaperUI.section("Medical and rations", str(list.size()) if not list.is_empty() else ""))
	if list.is_empty():
		v.add_child(PaperUI.empty("No medical stores. Bleeding does not stop on its own.")); return
	var i: Inventory = inv()
	for e in list:
		var d := Data.def(str(e["id"]))
		var q := i.quick.find(str(e["id"]))
		var tags: Array = [["key %d" % (q + 6), Paper.AMBER]] if q >= 0 else []
		var acts: Array = [PaperUI.act("Use", _use_item.bind(str(e["id"]))), _drop_button(e)]
		v.add_child(_line(e, str(d.get("name", e["id"])), str(d.get("desc", "")), tags,
			PaperUI.number(str(int(e.get("count", 1))), "×"), acts))

func _tools(v: VBoxContainer, list: Array) -> void:
	v.add_child(PaperUI.section("Grenades and tools", str(list.size()) if not list.is_empty() else ""))
	if list.is_empty():
		v.add_child(PaperUI.empty("None carried.")); return
	var i: Inventory = inv()
	for e in list:
		var id := str(e["id"])
		var d := Data.def(id)
		var q := i.quick.find(id)
		var slot := KitView.slot_of_uid(i, int(e.get("uid", -1))) if e.has("uid") else ""
		var tags: Array = []
		if q >= 0: tags.append(["key %d" % (q + 6), Paper.AMBER])
		if slot != "": tags.append([KitView.SLOT_LABEL.get(slot, slot), Paper.AMBER])
		var sub := str(d.get("desc", ""))
		if str(d.get("kind", "")) == "grenade":
			sub = "%s Fuse %s s · radius %s m%s" % [sub, str(d.get("fuse", "-")), str(d.get("radius", "-")),
				(" · %s damage" % str(d["damage"])) if d.get("damage") != null else ""]
		elif d.get("uses") != null and not e.has("uid"):
			sub = "%s %d of %d uses left on the open kit." % [sub, KitView.uses_left(id), int(d["uses"])]
		elif id == "torch":
			sub = "Battery %d %%." % roundi(float(Game.state.get("flashlight", {}).get("battery", 0.0)))
		var acts: Array = []
		if str(d.get("kind", "")) == "melee" and e.has("uid"):
			acts.append(PaperUI.act("Unequip", _unequip.bind("melee")) if slot != "" else PaperUI.act("Equip", _equip_gear.bind(int(e["uid"]))))
		acts.append(_drop_button(e))
		var right: Control = PaperUI.number(Paper.kg_num(Data.weight_of(id), 2), "kg") if e.has("uid") else PaperUI.number(str(int(e.get("count", 1))), "×")
		v.add_child(_line(e, str(d.get("name", id)), sub, tags, right, acts))

func _kit(v: VBoxContainer, list: Array) -> void:
	v.add_child(PaperUI.section("Armour and kit", str(list.size()) if not list.is_empty() else ""))
	if list.is_empty():
		v.add_child(PaperUI.empty("None carried.")); return
	var i: Inventory = inv()
	for e in list:
		var g: Dictionary = e["inst"]
		var d := Data.def(str(e["id"]))
		var slot := KitView.slot_of_uid(i, int(g["uid"]))
		var acts: Array = []
		if slot != "": acts.append(PaperUI.act("Unequip", _unequip.bind(slot)))
		else: acts.append(PaperUI.act("Equip", _equip_gear.bind(int(g["uid"]))))
		acts.append(_drop_button(e))
		v.add_child(_line(e, str(d.get("name", e["id"])), Paper.gear_sub(g), [["worn", Paper.AMBER]] if slot != "" else [],
			PaperUI.number(Paper.kg_num(Data.weight_of(str(e["id"]))), "kg"), acts))

func _attachments(v: VBoxContainer, list: Array) -> void:
	v.add_child(PaperUI.section("Attachments", str(list.size()) if not list.is_empty() else ""))
	if list.is_empty():
		v.add_child(PaperUI.empty("None carried. Attachments are fitted at the workbench.")); return
	var i: Inventory = inv()
	for e in list:
		var a := Data.def(str(e["id"]))
		var fits: Array = []
		for w in i.weapons:
			if Data.attachment_fits(a, Data.weapons.get(str(w["id"]), {}), w.get("rails", [])):
				fits.append(str(Data.weapons[str(w["id"])].get("name", w["id"])))
		var sub := "%s · %s" % [("rail" if str(a.get("slot", "")) == "rail" else str(a.get("slot", ""))),
			("fits " + ", ".join(fits)) if not fits.is_empty() else "fits nothing carried"]
		var fx := Paper.effects_text(a.get("effects", {}))
		if fx != "": sub += " · " + fx
		v.add_child(_line(e, str(a.get("name", e["id"])), sub, [],
			PaperUI.number(str(int(e.get("count", 1))), "×"), [_drop_button(e)]))

func _parts(v: VBoxContainer, list: Array) -> void:
	v.add_child(PaperUI.section("Parts, cells and filters", str(list.size()) if not list.is_empty() else ""))
	if list.is_empty():
		v.add_child(PaperUI.empty("None carried.")); return
	var i: Inventory = inv()
	for e in list:
		var id := str(e["id"])
		var d := Data.def(id)
		var acts: Array = []
		if str(d.get("kind", "")) == "battery": acts.append(PaperUI.act("Install", _install.bind(id)))
		elif str(d.get("kind", "")) == "filter": acts.append(PaperUI.act("Fit", _install.bind(id), { "disabled": i.equipped("mask") == null }))
		acts.append(_drop_button(e))
		var sub := str(d.get("desc", ""))
		if sub == "" and d.get("part") != null: sub = "Replaces the %s at the workbench." % str(d["part"])
		v.add_child(_line(e, str(d.get("name", id)), sub, [], PaperUI.number(str(int(e.get("count", 1))), "×"), acts))

func _artifacts(v: VBoxContainer, list: Array) -> void:
	v.add_child(PaperUI.section("Artifacts", str(list.size()) if not list.is_empty() else ""))
	if list.is_empty():
		v.add_child(PaperUI.empty("None recovered. Artifacts lie near anomalies and are found with a detector.")); return
	for e in list:
		var d := Data.def(str(e["id"]))
		var n := int(e.get("count", 1))
		v.add_child(_line(e, str(d.get("name", e["id"])), str(d.get("desc", "")), [],
			PaperUI.number(("%d × " % n if n > 1 else "") + Paper.money_num(int(d.get("price", 0))), "RUB", Paper.AMBER), [_drop_button(e)]))

func _mission(v: VBoxContainer, list: Array) -> void:
	if list.is_empty(): return
	v.add_child(PaperUI.section("Committee property", str(list.size())))
	for e in list:
		var d := Data.def(str(e["id"]))
		v.add_child(_line(e, str(d.get("name", e["id"])), str(d.get("desc", "")), [["not for return", Paper.ink(0.42)]],
			PaperUI.number(str(int(e.get("count", 1))), "×"), []))

func _drop_button(e: Dictionary, label := "Drop") -> Button:
	var can := Game.loot != null and Game.loot.has_method("drop") and Game.player != null and is_instance_valid(Game.player)
	return PaperUI.act(label, _drop_entry.bind(e), { "disabled": not can, "tooltip": "Set it down where you stand" if can else "Nothing to set it down on here" })

# ------------------------------------------------------------------------------------------------------------------
# right: the particulars
# ------------------------------------------------------------------------------------------------------------------
func _card_column() -> Control:
	var col := PaperUI.pane(408, 0)
	col.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	if slot_sel != "": _slot_card(v)
	else:
		var e := _find_sel()
		if e.is_empty(): _explorer_card(v)
		else: _item_card(v, e)
	return col

func _card_head(v: VBoxContainer, title: String, sub: String) -> void:
	var t := PaperUI.label(title, Paper.S_H2, Paper.INK, "display")
	t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(t)
	if sub != "":
		v.add_child(PaperUI.caps(sub, Paper.S_MICRO, Paper.ink(0.55)))
	v.add_child(PaperUI.spacer(6))
	v.add_child(PaperUI.Rule.new("solid", Paper.ink(0.35)))
	v.add_child(PaperUI.spacer(6))

func _explorer_card(v: VBoxContainer) -> void:
	var st: Dictionary = Game.state
	_card_head(v, "Explorer %d" % int(st.get("explorer", 61)), "condition")
	var hp := float(st.get("hp", 100.0))
	v.add_child(PaperUI.kv("Condition", "%d / 100" % roundi(hp), Paper.RED if hp < 30.0 else Paper.INK))
	v.add_child(PaperUI.kv("Stamina", "%d / 100" % roundi(float(st.get("stamina", 100.0)))))
	v.add_child(PaperUI.kv("Bleeding", "yes" if st.get("bleeding", false) else "no", Paper.RED if st.get("bleeding", false) else Paper.INK))
	v.add_child(PaperUI.kv("Torch battery", Paper.pct100(float(st.get("flashlight", {}).get("battery", 0.0)))))
	var buffs: Array[String] = []
	if Game.damage != null:
		if float(Game.damage.get("painkiller_t")) > 0.0: buffs.append("painkiller")
		if float(Game.damage.get("steady_t")) > 0.0: buffs.append("steady hands")
		if float(Game.damage.get("speed_t")) > 0.0: buffs.append("stimulant")
		if float(Game.damage.get("regen_t")) > 0.0: buffs.append("fed")
	if not buffs.is_empty(): v.add_child(PaperUI.kv("In effect", ", ".join(buffs), Paper.AMBER))
	v.add_child(PaperUI.kv("Contract funds", Paper.money(money())))
	v.add_child(PaperUI.kv("Clearance", "%d · %s" % [rank(), rank_title()]))
	v.add_child(PaperUI.spacer(12))
	v.add_child(PaperUI.note("Select a line for its particulars. Select a slot to change what is worn. A line can be dragged onto a slot."))

func _slot_card(v: VBoxContainer) -> void:
	var i: Inventory = inv()
	_card_head(v, KitView.SLOT_LABEL.get(slot_sel, slot_sel), "equipment slot")
	var uid: Variant = i.equipment.get(slot_sel)
	var cur: Variant = i.equipped(slot_sel) if uid != null else null
	v.add_child(PaperUI.caps("Worn", Paper.S_MICRO, Paper.AMBER, true))
	v.add_child(PaperUI.spacer(4))
	if cur is Dictionary:
		var d := Data.def(str(cur["id"]))
		v.add_child(PaperUI.row(PaperUI.name_block(str(d.get("name", cur["id"])),
			Paper.weapon_sub(cur) if cur.has("parts") else Paper.gear_sub(cur)), null, [PaperUI.act("Unequip", _unequip.bind(slot_sel))]))
	else:
		v.add_child(PaperUI.empty("Nothing worn."))
	v.add_child(PaperUI.spacer(10))
	v.add_child(PaperUI.caps("Carried and compatible", Paper.S_MICRO, Paper.AMBER, true))
	v.add_child(PaperUI.spacer(4))
	var cands := _slot_candidates(slot_sel)
	var any := false
	for c in cands:
		if uid != null and int(c["uid"]) == int(uid): continue
		any = true
		var d2 := Data.def(str(c["id"]))
		var sub: String = Paper.weapon_sub(c) if c.has("parts") else Paper.gear_sub(c)
		v.add_child(PaperUI.row(PaperUI.name_block(str(d2.get("name", c["id"])), sub), null,
			[PaperUI.act("Equip", _equip_into.bind(slot_sel, int(c["uid"])))]))
	if not any: v.add_child(PaperUI.empty("Nothing carried fits this slot."))

func _slot_candidates(s: String) -> Array:
	var i: Inventory = inv()
	var out: Array = []
	if s in ["primary", "secondary", "sidearm"]:
		for w in i.weapons:
			if s == "sidearm" and str(Data.weapons.get(str(w["id"]), {}).get("cls", "")) != "pistol": continue
			out.append(w)
	else:
		for g in i.gear:
			if str(Data.def(str(g["id"])).get("kind", "")) == (s if s != "backpack" else "backpack"): out.append(g)
	return out

func _item_card(v: VBoxContainer, e: Dictionary) -> void:
	var i: Inventory = inv()
	var id := str(e["id"])
	var d := Data.def(id)
	var c := KitView.category(e)
	var kicker := c
	if c == "weapon":
		var wd: Dictionary = Data.weapons.get(id, {})
		kicker = "%s · %s" % [str(wd.get("cls", "")), Paper.cal_name(str(wd.get("cal", "")))]
	elif c == "mag": kicker = "magazine"
	elif c == "ammo": kicker = "ammunition"
	elif d.get("kind") != null: kicker = str(d["kind"])
	_card_head(v, str(d.get("full", d.get("name", id))), kicker)
	if str(d.get("desc", "")) != "":
		v.add_child(PaperUI.para(str(d["desc"]), Paper.S_TINY, Paper.ink(0.62)))
		v.add_child(PaperUI.spacer(8))
	match c:
		"weapon": _card_weapon(v, e)
		"mag": _card_mag(v, e)
		"ammo": _card_ammo(v, e)
		"kit": _card_kit(v, e)
		"attachment": _card_attachment(v, e)
		_: _card_plain(v, e)
	if e.has("uid"):
		v.add_child(PaperUI.spacer(10))
		v.add_child(PaperUI.caps("Reference", Paper.S_MICRO, Paper.AMBER, true))
		v.add_child(PaperUI.spacer(4))
		v.add_child(PaperUI.kv("Serial", "%04d" % int(e["uid"])))

func _sub_head(v: VBoxContainer, t: String) -> void:
	v.add_child(PaperUI.spacer(10))
	v.add_child(PaperUI.caps(t, Paper.S_MICRO, Paper.AMBER, true))
	v.add_child(PaperUI.spacer(4))

func _card_weapon(v: VBoxContainer, e: Dictionary) -> void:
	var w: Dictionary = e["inst"]
	var wd: Dictionary = Data.weapons.get(str(e["id"]), {})
	var ef := Inventory.weapon_effects(w)
	var moa := float(wd.get("moa", 1.0)) * float(ef.get("moa", 1.0))
	v.add_child(PaperUI.kv("Rate", "%d rpm" % int(wd.get("rpm", 0))))
	v.add_child(PaperUI.kv("Modes", " / ".join(wd.get("modes", []))))
	v.add_child(PaperUI.kv("Dispersion", "%s°" % String.num(moa, 2)))
	var rc: Array = wd.get("recoil", [0, 0])
	v.add_child(PaperUI.kv("Recoil", "%s / %s" % [String.num(float(rc[0]) * float(ef.get("recoil", 1.0)), 2), String.num(float(rc[1]) * float(ef.get("recoil", 1.0)), 2)]))
	v.add_child(PaperUI.kv("Ergonomics", "%d" % roundi((float(wd.get("ergo", 0.8)) + float(ef.get("ergo", 0.0))) * 100.0)))
	v.add_child(PaperUI.kv("Noise", Paper.pct(float(ef.get("noise", 1.0)))))
	v.add_child(PaperUI.kv("Weight", Paper.kg(Inventory.weapon_weight(w), 2)))
	v.add_child(PaperUI.kv("Value", Paper.money(int(wd.get("price", 0)))))
	_sub_head(v, "Condition")
	for p in ["barrel", "bolt", "frame"]:
		var val := float(w.get("parts", {}).get(p, 100.0))
		v.add_child(PaperUI.kv(p, "%d %%" % roundi(val), Paper.cond_color(val / 100.0)))
		v.add_child(PaperUI.Bar.new(val / 100.0, Paper.cond_color(val / 100.0), 2.0))
		v.add_child(PaperUI.spacer(4))
	var dirt := float(w.get("dirt", 0.0))
	v.add_child(PaperUI.kv("fouling", Paper.pct(dirt), Paper.RED if dirt > 0.5 else (Paper.AMBER if dirt > 0.25 else Paper.INK)))
	v.add_child(PaperUI.Bar.new(dirt, Paper.RED if dirt > 0.5 else Paper.AMBER, 2.0))
	if w.get("jammed", false): v.add_child(PaperUI.kv("Action", "stoppage", Paper.RED))
	_sub_head(v, "Loaded")
	v.add_child(PaperUI.kv("Magazine", Paper.name_of(str(w["mag"]["id"])) if w.get("mag") is Dictionary else ("internal" if int(wd.get("internal", 0)) > 0 else "none")))
	v.add_child(PaperUI.kv("Rounds", Paper.mag_text(w)))
	v.add_child(PaperUI.kv("Chamber", Paper.ammo_label(str(w["chamber"])) if w.get("chamber") != null else "empty"))
	v.add_child(PaperUI.kv("Fire mode", str(w.get("fireMode", "-"))))
	_sub_head(v, "Attachments")
	var any := false
	for r in w.get("rails", []):
		v.add_child(PaperUI.kv("rail", Paper.name_of(str(r)))); any = true
	for s in w.get("attachments", {}).keys():
		v.add_child(PaperUI.kv(str(s), Paper.name_of(str(w["attachments"][s])))); any = true
	if not any: v.add_child(PaperUI.empty("None fitted. The workbench mounts them."))
	_sub_head(v, "Mounts")
	var mounts := Data.effective_mounts(wd, w.get("rails", []))
	for s in mounts.keys():
		v.add_child(PaperUI.kv(str(s), "—" if str(mounts[s]) == "none" else str(mounts[s])))

func _card_mag(v: VBoxContainer, e: Dictionary) -> void:
	var i: Inventory = inv()
	var m: Dictionary = e["inst"]
	var md: Dictionary = Data.magazines.get(str(e["id"]), {})
	var fits: Array = []
	for w in i.weapons:
		if str(Data.weapons.get(str(w["id"]), {}).get("family", "")) in md.get("fits", []):
			fits.append(str(Data.weapons[str(w["id"])].get("name", w["id"])))
	v.add_child(PaperUI.kv("Capacity", str(int(md.get("cap", 0)))))
	v.add_child(PaperUI.kv("Loaded", "%d%s" % [int(m.get("rounds", 0)), (" · " + Paper.name_of(str(m["ammo"]))) if m.get("ammo") != null else ""]))
	v.add_child(PaperUI.kv("Fits", ", ".join(fits) if not fits.is_empty() else ", ".join(md.get("fits", []))))
	v.add_child(PaperUI.kv("Ready", "in the rig · fast reload" if i.is_ready(int(m["uid"])) else "in the pack · slow reload"))
	v.add_child(PaperUI.kv("Weight", Paper.kg(Inventory.mag_weight(m), 2)))
	v.add_child(PaperUI.kv("Value", Paper.money(int(md.get("price", 0)))))

func _card_ammo(v: VBoxContainer, e: Dictionary) -> void:
	var i: Inventory = inv()
	var a: Dictionary = Data.ammo.get(str(e["id"]), {})
	var dmg := "%d" % int(a.get("damage", 0))
	if int(a.get("pellets", 1)) > 1: dmg += " × %d" % int(a["pellets"])
	v.add_child(PaperUI.kv("Damage", dmg))
	v.add_child(PaperUI.kv("Penetration class", str(a.get("pen", 1))))
	v.add_child(PaperUI.kv("Velocity", "%d m/s" % int(a.get("speed", 0))))
	v.add_child(PaperUI.kv("Noise", Paper.pct(float(a.get("noise", 1.0)))))
	v.add_child(PaperUI.kv("Weight", "%d g / round" % roundi(float(a.get("weight", 0.01)) * 1000.0)))
	v.add_child(PaperUI.kv("Value", "%s / round" % Paper.money(int(a.get("price", 0)))))
	v.add_child(PaperUI.kv("Carried", "%d rounds" % int(e.get("count", 0))))
	_sub_head(v, "Against armour")
	for cls in [2, 3, 4, 5, 6]:
		v.add_child(PaperUI.kv("class %d" % cls, Paper.pct(Paper.pen_chance(float(a.get("pen", 1)), float(cls)))))
	var vest: Variant = i.equipped("vest")
	if vest is Dictionary:
		var vd := Data.def(str(vest["id"]))
		if vd.get("cls") != null:
			var dur := float(vest.get("durability", vd.get("durability", 1))) / maxf(1.0, float(vd.get("durability", 1)))
			v.add_child(PaperUI.kv("your vest · %s" % str(vd.get("name", "")), Paper.pct(Paper.pen_chance(float(a.get("pen", 1)), float(vd["cls"]), dur)), Paper.AMBER))

func _card_kit(v: VBoxContainer, e: Dictionary) -> void:
	var i: Inventory = inv()
	var g: Dictionary = e["inst"]
	var d := Data.def(str(e["id"]))
	var slot := str(KitView.GEAR_SLOT.get(str(d.get("kind", "")), ""))
	var worn: Variant = i.equipped(slot) if slot != "" else null
	var other: Dictionary = Data.def(str(worn["id"])) if worn is Dictionary and int(worn["uid"]) != int(g["uid"]) else {}
	if d.get("cls") != null:
		var maxd := float(d.get("durability", 1))
		var dur := float(g.get("durability", maxd)) / maxf(1.0, maxd)
		v.add_child(PaperUI.kv("Armour class", str(d["cls"]) + _delta(float(d["cls"]) - float(other.get("cls", d["cls"])), 0)))
		v.add_child(PaperUI.kv("Covers", ", ".join(d.get("zones", []))))
		v.add_child(PaperUI.kv("Durability", "%d / %d" % [roundi(float(g.get("durability", maxd))), int(maxd)]))
		v.add_child(PaperUI.Bar.new(dur, Paper.cond_color(dur), 2.0))
		v.add_child(PaperUI.spacer(4))
		v.add_child(PaperUI.kv("Effective class", String.num(float(d["cls"]) * (0.55 + 0.45 * dur), 1)))
	if d.get("capacity") != null:
		v.add_child(PaperUI.kv("Carry", "+%s kg%s" % [str(d["capacity"]), _delta(float(d["capacity"]) - float(other.get("capacity", d["capacity"])), 0)]))
	if d.get("readyMags") != null:
		v.add_child(PaperUI.kv("Pouches", "%d%s" % [int(d["readyMags"]), _delta(float(int(d["readyMags"]) - int(other.get("readyMags", d["readyMags"]))), 0)]))
		if d.get("quick") != null: v.add_child(PaperUI.kv("Quick slots", str(d["quick"])))
		if d.get("armor") != null: v.add_child(PaperUI.kv("Soft insert", "class %s" % str(d["armor"])))
	if d.get("light") != null: v.add_child(PaperUI.kv("Lamp", str(d["light"])))
	if d.get("nvg") != null: v.add_child(PaperUI.kv("Night vision", "generation %s" % str(d["nvg"])))
	if g.get("charge") != null:
		v.add_child(PaperUI.kv("Filter" if d.get("filter") != null else "Cell", Paper.pct100(float(g["charge"]))))
		v.add_child(PaperUI.Bar.new(float(g["charge"]) / 100.0, Paper.cond_color(float(g["charge"]) / 100.0), 2.0))
		v.add_child(PaperUI.spacer(4))
	if d.get("gas") != null: v.add_child(PaperUI.kv("Gas protection", Paper.pct(float(d["gas"]))))
	if d.get("fov") != null: v.add_child(PaperUI.kv("Field of view", Paper.pct(float(d["fov"]))))
	v.add_child(PaperUI.kv("Weight", Paper.kg(float(d.get("weight", 0.0)))))
	if float(d.get("speed", 1.0)) != 1.0: v.add_child(PaperUI.kv("Movement", Paper.pct(float(d["speed"]))))
	if float(d.get("stamina", 1.0)) != 1.0: v.add_child(PaperUI.kv("Stamina drain", Paper.pct(float(d["stamina"]))))
	v.add_child(PaperUI.kv("Value", Paper.money(int(d.get("price", 0)))))
	if not other.is_empty():
		v.add_child(PaperUI.spacer(8))
		v.add_child(PaperUI.note("Compared with the %s worn." % str(other.get("name", ""))))

func _delta(x: float, digits: int) -> String:
	if absf(x) < 0.0001: return ""
	return "  %s%s" % ["+" if x > 0.0 else "−", String.num(absf(x), digits)]

func _card_attachment(v: VBoxContainer, e: Dictionary) -> void:
	var i: Inventory = inv()
	var a := Data.def(str(e["id"]))
	var fits: Array = []
	for w in i.weapons:
		if Data.attachment_fits(a, Data.weapons.get(str(w["id"]), {}), w.get("rails", [])):
			fits.append(str(Data.weapons[str(w["id"])].get("name", w["id"])))
	v.add_child(PaperUI.kv("Slot", "rail conversion" if str(a.get("slot", "")) == "rail" else str(a.get("slot", ""))))
	v.add_child(PaperUI.kv("Mount", ", ".join(a.get("fits", []))))
	if a.get("gives") is Dictionary:
		var parts: Array = []
		for s in a["gives"].keys(): parts.append("%s %s" % [str(s), str(a["gives"][s])])
		v.add_child(PaperUI.kv("Adds", ", ".join(parts)))
	var fx := Paper.effects_text(a.get("effects", {}))
	v.add_child(PaperUI.kv("Effect", fx if fx != "" else "—"))
	v.add_child(PaperUI.kv("Fits carried", ", ".join(fits) if not fits.is_empty() else "nothing"))
	v.add_child(PaperUI.kv("Weight", Paper.kg(float(a.get("weight", 0.0)), 2)))
	v.add_child(PaperUI.kv("Value", Paper.money(int(a.get("price", 0)))))

func _card_plain(v: VBoxContainer, e: Dictionary) -> void:
	var id := str(e["id"])
	var d := Data.def(id)
	var c := KitView.category(e)
	if str(d.get("kind", "")) == "grenade":
		v.add_child(PaperUI.kv("Fuse", "%s s" % str(d.get("fuse", "-"))))
		v.add_child(PaperUI.kv("Radius", "%s m" % str(d.get("radius", "-"))))
		v.add_child(PaperUI.kv("Damage", str(d.get("damage", "—"))))
		if d.get("flash") != null: v.add_child(PaperUI.kv("Effect", "blinds"))
		elif d.get("smoke") != null: v.add_child(PaperUI.kv("Effect", "%s s of smoke" % str(d["smoke"])))
	elif d.get("effect") is Dictionary:
		var ef: Dictionary = d["effect"]
		var lines: Array = []
		if ef.get("heal") != null: lines.append("+%s" % str(ef["heal"]))
		if ef.get("healOver") is Array: lines.append("+%s over %s s" % [str(ef["healOver"][0]), str(ef["healOver"][1])])
		if ef.get("stopBleed", false): lines.append("stops bleeding")
		if ef.get("stamina") != null: lines.append("stamina +%s" % str(ef["stamina"]))
		if ef.get("painkiller") != null: lines.append("%s s painkiller" % str(ef["painkiller"]))
		if ef.get("steady") != null: lines.append("%s s steady" % str(ef["steady"]))
		if ef.get("speedFor") is Array: lines.append("%s s faster" % str(ef["speedFor"][0]))
		if ef.get("staminaRegen") is Array: lines.append("%s s of better wind" % str(ef["staminaRegen"][0]))
		v.add_child(PaperUI.kv("Effect", ", ".join(lines) if not lines.is_empty() else "—"))
		if d.get("use") != null: v.add_child(PaperUI.kv("Use time", "%s s" % str(d["use"])))
	if d.get("uses") != null and not e.has("uid"):
		v.add_child(PaperUI.kv("Uses", "%d of %d on the open kit" % [KitView.uses_left(id), int(d["uses"])]))
	if d.get("damage") != null and str(d.get("kind", "")) != "grenade": v.add_child(PaperUI.kv("Damage", str(d["damage"])))
	if d.get("part") != null: v.add_child(PaperUI.kv("Replaces", str(d["part"])))
	if d.get("detect") is Dictionary:
		v.add_child(PaperUI.kv("Range", "%s m" % str(d["detect"].get("range", 0))))
		v.add_child(PaperUI.kv("Direction", "yes" if d["detect"].get("dir", false) else "no"))
	if d.get("zoom") != null: v.add_child(PaperUI.kv("Magnification", "%s×" % str(d["zoom"])))
	v.add_child(PaperUI.kv("Weight", Paper.kg(Data.weight_of(id), 2)))
	v.add_child(PaperUI.kv("Carried", str(int(e.get("count", 1)))))
	if int(d.get("price", 0)) > 0:
		if c == "artifact": v.add_child(PaperUI.kv("Committee purchase", Paper.money(int(d["price"])), Paper.AMBER))
		else: v.add_child(PaperUI.kv("Value", "%s · %s back" % [Paper.money(int(d["price"])), Paper.money(roundi(float(d["price"]) * 0.4))]))
	else:
		v.add_child(PaperUI.kv("Value", "Committee property"))
	if c == "med" or str(d.get("kind", "")) == "grenade":
		_sub_head(v, "Quick keys")
		var h := PaperUI.rowbox(6)
		var i: Inventory = inv()
		for k in 4:
			var on: bool = k < i.quick.size() and str(i.quick[k]) == id
			h.add_child(PaperUI.act("%d" % (k + 6), _set_quick.bind(k, id), { "on": on }))
		v.add_child(h)

# ------------------------------------------------------------------------------------------------------------------
# selection, drag, actions
# ------------------------------------------------------------------------------------------------------------------
func _is_sel(e: Dictionary) -> bool:
	if sel.is_empty(): return false
	return str(sel.get("kind", "")) == str(e.get("kind", "")) and str(sel.get("id", "")) == str(e.get("id", "")) \
		and str(sel.get("uid", "")) == str(e.get("uid", ""))

func _pick_entry(e: Dictionary) -> void:
	sel = { "kind": str(e.get("kind", "")), "id": str(e.get("id", "")) }
	if e.has("uid"): sel["uid"] = int(e["uid"])
	slot_sel = ""
	snd("ui_click", 0.3)
	refresh()

func _pick_slot(s: String) -> void:
	slot_sel = "" if slot_sel == s else s
	sel = {}
	snd("ui_click", 0.3)
	refresh()

func _find_sel() -> Dictionary:
	if sel.is_empty() or not has_inv(): return {}
	var i: Inventory = inv()
	var kind := str(sel.get("kind", ""))
	if kind == "weapon":
		var w: Variant = i.weapon_by_uid(int(sel.get("uid", -1)))
		return { "kind": "weapon", "id": str(w["id"]), "uid": int(w["uid"]), "inst": w, "count": 1 } if w is Dictionary else {}
	if kind == "mag":
		var m: Variant = i.mag_by_uid(int(sel.get("uid", -1)))
		return { "kind": "mag", "id": str(m["id"]), "uid": int(m["uid"]), "inst": m, "count": 1 } if m is Dictionary else {}
	if sel.has("uid"):
		var g: Variant = i.gear_by_uid(int(sel["uid"]))
		if g is Dictionary:
			return { "kind": str(Data.def(str(g["id"])).get("kind", "gear")), "id": str(g["id"]), "uid": int(g["uid"]), "inst": g, "count": 1 }
		return {}
	var n := i.count(str(sel.get("id", "")))
	return { "kind": kind, "id": str(sel["id"]), "count": n } if n > 0 else {}

func _entry_drag(_pos: Vector2, e: Dictionary) -> Variant:
	var chit := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Paper.PAPER_2; sb.border_color = Paper.AMBER; sb.set_border_width_all(1)
	sb.content_margin_left = 10; sb.content_margin_right = 10; sb.content_margin_top = 5; sb.content_margin_bottom = 5
	chit.add_theme_stylebox_override("panel", sb)
	chit.add_child(PaperUI.label(KitView.entry_name(e), Paper.S_TINY, Paper.INK, "mono_med"))
	chit.modulate = Color(1, 1, 1, 0.94)
	set_drag_preview(chit)
	return { "src": "kit", "entry": e }

func _slot_can_drop(_pos: Vector2, d: Variant, s: String) -> bool:
	if not (d is Dictionary) or str(d.get("src", "")) != "kit": return false
	var e: Dictionary = d.get("entry", {})
	if str(e.get("kind", "")) == "weapon":
		if not (s in ["primary", "secondary", "sidearm"]): return false
		if s == "sidearm": return str(Data.weapons.get(str(e["id"]), {}).get("cls", "")) == "pistol"
		return true
	if not e.has("uid"): return false
	return str(KitView.GEAR_SLOT.get(str(Data.def(str(e["id"])).get("kind", "")), "")) == s

func _slot_drop(_pos: Vector2, d: Variant, s: String) -> void:
	var e: Dictionary = d.get("entry", {})
	_equip_into(s, int(e.get("uid", -1)))

func _equip_into(s: String, uid: int) -> void:
	var i: Inventory = inv()
	if s in ["primary", "secondary", "sidearm", "melee"] and i.weapon_by_uid(uid) != null:
		var w: Dictionary = i.weapon_by_uid(uid)
		if s == "sidearm" and str(Data.weapons.get(str(w["id"]), {}).get("cls", "")) != "pistol":
			deny("Sidearm slot: pistols only."); return
		i.equip_weapon(uid, s)
		notice("%s carried as %s." % [Paper.name_of(str(w["id"])), str(KitView.SLOT_LABEL.get(s, s)).to_lower()])
	else:
		var g: Variant = i.gear_by_uid(uid)
		if not (g is Dictionary): deny("Not carried."); return
		var want := str(KitView.GEAR_SLOT.get(str(Data.def(str(g["id"])).get("kind", "")), ""))
		if want != s: deny("That does not go in the %s slot." % str(KitView.SLOT_LABEL.get(s, s)).to_lower()); return
		i.equip_gear(uid, s)
		if s == "rig":
			var cap := int(Data.def(str(g["id"])).get("readyMags", 0))
			while i.ready_mags.size() > cap: i.ready_mags.pop_back()
		notice("%s worn." % Paper.name_of(str(g["id"])))
	_weapons_changed()
	snd("gear_rustle", 0.5)
	refresh()

func _equip_weapon(uid: int) -> void:
	var i: Inventory = inv()
	var w: Variant = i.weapon_by_uid(uid)
	if not (w is Dictionary): return
	var e: Dictionary = i.equipment
	var s := "sidearm" if str(Data.weapons.get(str(w["id"]), {}).get("cls", "")) == "pistol" else ("primary" if e.get("primary") == null else ("secondary" if e.get("secondary") == null else "primary"))
	_equip_into(s, uid)

func _equip_gear(uid: int) -> void:
	var i: Inventory = inv()
	var g: Variant = i.gear_by_uid(uid)
	if not (g is Dictionary): return
	var s := str(KitView.GEAR_SLOT.get(str(Data.def(str(g["id"])).get("kind", "")), ""))
	if s == "": deny("Nothing wears that."); return
	_equip_into(s, uid)

func _unequip(s: String) -> void:
	var i: Inventory = inv()
	var inst: Variant = i.equipped(s)
	if inst == null: return
	i.unequip(s)
	if s == "rig": i.ready_mags.clear()
	notice("%s stowed in the pack." % Paper.name_of(str(inst["id"])))
	_weapons_changed()
	snd("gear_rustle", 0.45)
	refresh()

func _toggle_ready(uid: int) -> void:
	var i: Inventory = inv()
	var m: Variant = i.mag_by_uid(uid)
	if not (m is Dictionary): return
	if i.is_ready(uid):
		i.set_ready(uid, false)
		notice("%s moved to the pack." % Paper.name_of(str(m["id"])))
	else:
		var cap := i.ready_slots()
		if i.ready_mags.size() >= cap:
			deny("Rig pouches full (%d). Stow one first." % cap if cap > 0 else "No rig worn. Nothing holds a ready magazine.")
			return
		i.set_ready(uid, true)
		notice("%s in the rig." % Paper.name_of(str(m["id"])))
	_weapons_changed()
	snd("mag_pouch", 0.5)
	refresh()

func _prefer(cal: String, id: String) -> void:
	inv().set_preferred_ammo(cal, id)
	notice("%s preferred for %s." % [Paper.name_of(id), Paper.cal_short(cal)])
	_weapons_changed()
	snd("ui_click", 0.4)
	refresh()

func _use_item(id: String) -> void:
	var i: Inventory = inv()
	if not i.has(id): deny("None carried."); return
	var ok := false
	if Game.damage != null and Game.damage.has_method("use"): ok = Game.damage.use(id, true)
	if not ok:
		deny("%s: no use here." % Paper.name_of(id)); return
	if Game.player != null and Game.player.has_method("lock_movement") and Data.def(id).get("use") != null:
		Game.player.lock_movement(float(Data.def(id)["use"]))
	notice("%s used. %s" % [Paper.name_of(id), Paper.desc_of(id)])
	snd(str(KitView.USE_SOUND.get(id, "pickup_item")), 0.6)
	refresh()

func _install(id: String) -> void:
	var i: Inventory = inv()
	if not i.has(id): deny("None carried."); return
	if id == "battery":
		if Game.kit != null and Game.kit.has_method("insert_battery"):
			if not Game.kit.insert_battery(): deny("Nothing needs a cell."); return
		else:
			var f: Dictionary = Game.state.get("flashlight", {})
			if float(f.get("battery", 0.0)) >= 99.0: deny("Torch already at charge."); return
			i.remove(id, 1); f["battery"] = 100.0
		notice("Cell installed.")
	elif id == "filter":
		if i.equipped("mask") == null: deny("No mask worn."); return
		if Game.kit != null and Game.kit.has_method("replace_filter"):
			if not Game.kit.replace_filter(): deny("Filter still fresh."); return
		else:
			var m: Variant = i.equipped("mask")
			if m is Dictionary and float(m.get("charge", 0.0)) < 99.0:
				i.remove(id, 1); m["charge"] = 100.0
			else:
				deny("Filter still fresh."); return
		notice("Filter fitted.")
	else:
		return
	snd("ui_click", 0.45)
	refresh()

func _set_quick(k: int, id: String) -> void:
	var i: Inventory = inv()
	if k < i.quick.size() and str(i.quick[k]) == id:
		i.set_quick(k, null)
		notice("Key %d cleared." % (k + 6))
	else:
		for j in 4:
			if j < i.quick.size() and str(i.quick[j]) == id: i.set_quick(j, null)
		i.set_quick(k, id)
		notice("%s on key %d." % [Paper.name_of(id), k + 6])
	snd("ui_click", 0.4)
	refresh()

func _drop_entry(e: Dictionary) -> void:
	if Game.loot == null or not Game.loot.has_method("drop") or Game.player == null:
		deny("Nothing to set it down on here."); return
	var n := int(e.get("count", 1))
	var entry := e.duplicate()
	if Data.ammo.has(str(e.get("id", ""))): entry["count"] = inv().count(str(e["id"]))
	var pile: Variant = Game.loot.drop([entry], Game.player.global_position)
	if pile == null: deny("It could not be set down."); return
	if _is_sel(e): sel = {}
	notice("%s%s set down." % [KitView.entry_name(e), (" × %d" % n) if n > 1 else ""])
	_weapons_changed()
	snd("pickup_item", 0.45)
	refresh()

func _weapons_changed() -> void:
	if Game.player == null or not is_instance_valid(Game.player): return
	var w: Variant = Game.player.get("weapons")
	if w != null and is_instance_valid(w) and w.has_method("on_inventory_changed"): w.on_inventory_changed()
	if Game.kit != null and Game.kit.has_method("_on_inventory_changed"): pass
