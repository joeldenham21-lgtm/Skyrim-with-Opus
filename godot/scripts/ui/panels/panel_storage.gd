extends RadiusPanel
## Form 61-L — Locker 61. Two columns: what the Explorer carries and what is stowed at Vanno. Everything moves both
## ways and the instance itself travels, so a weapon keeps its attachments, its condition and the magazine in it.
## The locker is not subject to the Tide and is not carried into the Radius.

func panel_id() -> String: return "storage"
func title_text() -> String: return "Vanno · Locker 61"
func form_code() -> String: return "61-L"
func key_hint() -> String: return "Esc close · arrows move · Enter confirm"
func sheet_size(vp: Vector2) -> Vector2:
	return Vector2(minf(vp.x - 70.0, 1500.0), minf(vp.y - 50.0, 950.0))

func build() -> void:
	if not has_inv() or stash() == null:
		add_child(PaperUI.empty("The locker is sealed. No kit on file.")); return
	add_child(_strip())
	add_child(PaperUI.spacer(8))
	var cols := PaperUI.rowbox(0)
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(cols)
	cols.add_child(_column("Carried", inv(), true))
	var gut := HBoxContainer.new()
	gut.custom_minimum_size = Vector2(37, 0)
	gut.add_child(PaperUI.hspacer(18))
	gut.add_child(PaperUI.Rule.new("solid", Paper.ink(0.20), true))
	gut.add_child(PaperUI.hspacer(18))
	cols.add_child(gut)
	cols.add_child(_column("Locker", stash(), false))
	add_child(PaperUI.note("Locker contents are not subject to the Tide and are not carried into the Radius. Everything on the Explorer's person is forfeit on incident. Worn armour and magazines in the rig can be stowed; the slot empties."))

func _strip() -> Control:
	var i: Inventory = inv()
	var st: Inventory = stash()
	var h := PaperUI.rowbox(24)
	h.custom_minimum_size = Vector2(0, 20)
	var over: float = i.overweight()
	h.add_child(PaperUI.caps("Carried %s / %s kg%s" % [String.num(i.weight(), 1), String.num(i.capacity(), 0),
		(" · over by %s" % Paper.kg(over)) if over > 0.0 else ""], Paper.S_MICRO, Paper.RED if over > 0.0 else Paper.ink(0.62)))
	h.add_child(PaperUI.stretch())
	h.add_child(PaperUI.caps("Locker %s · no limit" % Paper.kg(_weight_of(st)), Paper.S_MICRO, Paper.ink(0.62)))
	return h

func _weight_of(x: Inventory) -> float:
	var kg := 0.0
	for w in x.weapons: kg += Inventory.weapon_weight(w)
	for m in x.mags: kg += Inventory.mag_weight(m)
	for g in x.gear: kg += Data.weight_of(str(g["id"]))
	for id in x.items.keys(): kg += Data.weight_of(str(id), int(x.items[id]))
	return kg

func _column(title: String, src: Inventory, carried: bool) -> Control:
	var col := PaperUI.column(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var head := PaperUI.rowbox(10)
	head.custom_minimum_size = Vector2(0, 26)
	head.add_child(PaperUI.caps(title, Paper.S_TINY, Paper.INK, true))
	head.add_child(PaperUI.stretch())
	head.add_child(PaperUI.caps(Paper.kg(_weight_of(src)), Paper.S_MICRO, Paper.ink(0.55)))
	col.add_child(head)
	col.add_child(PaperUI.Rule.new("solid", Paper.ink(0.30)))
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	var label := "Stow" if carried else "Take"
	# weapons
	v.add_child(PaperUI.section("Weapons", str(src.weapons.size()) if not src.weapons.is_empty() else ""))
	if src.weapons.is_empty(): v.add_child(PaperUI.empty("None."))
	for w in src.weapons:
		var slot := KitView.slot_of_uid(src, int(w["uid"])) if carried else ""
		var e := { "kind": "weapon", "id": str(w["id"]), "uid": int(w["uid"]), "count": 1, "inst": w }
		v.add_child(PaperUI.row(PaperUI.name_block(Paper.full_of(str(w["id"])), Paper.weapon_sub(w),
			[[KitView.SLOT_LABEL.get(slot, slot), Paper.AMBER]] if slot != "" else []),
			PaperUI.number(Paper.kg_num(Inventory.weapon_weight(w)), "kg"),
			[PaperUI.act(label, _move.bind(e, src, carried, -1))]))
	# magazines
	v.add_child(PaperUI.section("Magazines", str(src.mags.size()) if not src.mags.is_empty() else ""))
	if src.mags.is_empty(): v.add_child(PaperUI.empty("None."))
	for m in src.mags:
		var e2 := { "kind": "mag", "id": str(m["id"]), "uid": int(m["uid"]), "count": 1, "inst": m }
		var tags: Array = [["ready", Paper.AMBER]] if carried and src.is_ready(int(m["uid"])) else []
		v.add_child(PaperUI.row(PaperUI.name_block(Paper.name_of(str(m["id"])), Paper.mag_sub(m), tags),
			PaperUI.number(Paper.kg_num(Inventory.mag_weight(m), 2), "kg"),
			[PaperUI.act(label, _move.bind(e2, src, carried, -1))]))
	# gear
	v.add_child(PaperUI.section("Gear", str(src.gear.size()) if not src.gear.is_empty() else ""))
	if src.gear.is_empty(): v.add_child(PaperUI.empty("None."))
	for g in src.gear:
		var d := Data.def(str(g["id"]))
		var slot2 := KitView.slot_of_uid(src, int(g["uid"])) if carried else ""
		var e3 := { "kind": str(d.get("kind", "gear")), "id": str(g["id"]), "uid": int(g["uid"]), "count": 1, "inst": g }
		v.add_child(PaperUI.row(PaperUI.name_block(str(d.get("name", g["id"])), Paper.gear_sub(g),
			[[KitView.SLOT_LABEL.get(slot2, slot2), Paper.AMBER]] if slot2 != "" else []),
			PaperUI.number(Paper.kg_num(Data.weight_of(str(g["id"]))), "kg"),
			[PaperUI.act(label, _move.bind(e3, src, carried, -1))]))
	# stacks
	var ids: Array = src.items.keys()
	ids.sort_custom(func(a, b):
		var ca := Data.category_of(str(a)); var cb := Data.category_of(str(b))
		if ca != cb:
			if ca == "ammo": return true
			if cb == "ammo": return false
			return ca < cb
		return Paper.name_of(str(a)) < Paper.name_of(str(b)))
	v.add_child(PaperUI.section("Items", str(ids.size()) if not ids.is_empty() else ""))
	if ids.is_empty(): v.add_child(PaperUI.empty("None."))
	for id in ids:
		var n := int(src.items[id])
		if n <= 0: continue
		var d2 := Data.def(str(id))
		var e4 := { "kind": "item", "id": str(id), "count": n }
		var acts: Array = []
		if n > 1:
			acts.append(PaperUI.act("%s 1" % label, _move.bind(e4, src, carried, 1)))
			if n > 10: acts.append(PaperUI.act("10", _move.bind(e4, src, carried, 10)))
			acts.append(PaperUI.act("All %d" % n, _move.bind(e4, src, carried, n)))
		else:
			acts.append(PaperUI.act(label, _move.bind(e4, src, carried, 1)))
		var sub := "loose rounds" if Data.ammo.has(str(id)) else str(d2.get("desc", ""))
		var w2 := Data.weight_of(str(id), n)
		v.add_child(PaperUI.row(PaperUI.name_block(str(d2.get("name", id)), sub),
			PaperUI.number("%d × %s" % [n, Paper.kg_num(w2, 2 if w2 < 0.1 else 1)], "kg"), acts))
	return col

func _move(e: Dictionary, src: Inventory, carried: bool, n: int) -> void:
	var dst: Inventory = stash() if carried else inv()
	var name := KitView.entry_name(e)
	var count := n if n > 0 else int(e.get("count", 1))
	if not src.transfer(e, dst, n):
		deny("It stays where it is."); return
	var word := "stowed" if carried else "taken"
	notice("%s%s %s." % [("%d × " % count) if count > 1 and not e.has("uid") else "", name, word])
	if not carried:
		var over: float = inv().overweight()
		if over > 0.0: notice("%s taken. Load exceeds capacity by %s." % [name, Paper.kg(over)], true)
	snd("gear_rustle" if e.has("uid") else "pickup_item", 0.45)
	_changed()
	refresh()

func _changed() -> void:
	if Game.player == null or not is_instance_valid(Game.player): return
	var w: Variant = Game.player.get("weapons")
	if w != null and is_instance_valid(w) and w.has_method("on_inventory_changed"): w.on_inventory_changed()
