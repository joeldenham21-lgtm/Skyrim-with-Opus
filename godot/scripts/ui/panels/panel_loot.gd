extends RadiusPanel
## Form 61-S — the search. What is in the container, the corpse or the pile on the left; what the Explorer is
## carrying on the right; the load line between them. Nothing is taken that cannot be carried.
## Data: { source: Node, kind, name, title, items: [entry], locked, table } as Loot._panel_data builds it.

var _entries: Array = []

func panel_id() -> String: return "loot"
func title_text() -> String:
	var t := str(data.get("title", data.get("name", "Cache")))
	return "Search · %s" % t.capitalize() if t != "" else "Search"
func form_code() -> String: return "61-S"
func key_hint() -> String: return "Esc close · arrows move · Enter take · A take all"
func sheet_size(vp: Vector2) -> Vector2:
	return Vector2(minf(vp.x - 80.0, 1420.0), minf(vp.y - 60.0, 930.0))

func handle_key(e: InputEventKey) -> bool:
	if e.keycode == KEY_A:
		_take_all(); return true
	return false

func _items() -> Array:
	var src: Variant = data.get("source")
	if src != null and is_instance_valid(src) and Game.loot != null and Game.loot.has_method("contents"):
		return Game.loot.contents(src)
	if not (data.get("items") is Array): data["items"] = []
	return data["items"]

func _locked() -> bool: return bool(data.get("locked", false))

# ------------------------------------------------------------------------------------------------------------------
func build() -> void:
	if not has_inv():
		add_child(PaperUI.empty("No kit on file.")); return
	if _locked():
		_locked_plate()
		return
	var cols := PaperUI.rowbox(0)
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(cols)
	cols.add_child(_cache_column())
	var gut := HBoxContainer.new()
	gut.custom_minimum_size = Vector2(37, 0)
	gut.add_child(PaperUI.hspacer(18))
	gut.add_child(PaperUI.Rule.new("solid", Paper.ink(0.20), true))
	gut.add_child(PaperUI.hspacer(18))
	cols.add_child(gut)
	cols.add_child(_carried_column())

func _locked_plate() -> void:
	var i: Inventory = inv()
	var v := PaperUI.column(0)
	v.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(v)
	v.add_child(PaperUI.spacer(40))
	var h := PaperUI.rowbox(20)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(PaperUI.stamp("Locked", Paper.RED, -7.0, 20))
	v.add_child(h)
	v.add_child(PaperUI.spacer(16))
	var t := PaperUI.para("%s is locked. A key opens it at once; a pick has three tries at three in five." % str(data.get("name", "The container")).capitalize(), Paper.S_BODY, Paper.ink(0.72))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	v.add_child(PaperUI.spacer(18))
	var keys := i.count("key_locker")
	var picks := i.count("lockpick")
	var row := PaperUI.rowbox(10)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_child(PaperUI.act("Use key" if keys > 0 else "No key carried", _force, { "disabled": keys <= 0 }))
	row.add_child(PaperUI.act("Pick the lock · %d tries" % KitView.uses_left("lockpick") if picks > 0 else "No picks carried", _force, { "disabled": picks <= 0 }))
	row.add_child(PaperUI.act("Leave it", close_self))
	v.add_child(row)
	v.add_child(PaperUI.spacer(20))
	v.add_child(PaperUI.note("Keys turn up in desks. Picks are stocked at the crate from clearance 2."))

func _force() -> void:
	var src: Variant = data.get("source")
	if src == null or not is_instance_valid(src) or Game.loot == null or not Game.loot.has_method("open_container"):
		deny("It will not give."); return
	var before := _locked()
	Game.loot.open_container(src)
	var rec: Variant = src.get_meta("loot") if src.has_meta("loot") else null
	if rec is Dictionary: data["locked"] = bool(rec.get("locked", false))
	if before and _locked():
		snd("lockpick_fail", 0.6)
	else:
		notice("The lock gives.")
	refresh()

# ------------------------------------------------------------------------------------------------------------------
func _cache_column() -> Control:
	var col := PaperUI.column(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var items := _items()
	var total := 0.0
	for e in items: total += KitView.entry_weight(e)
	var head := PaperUI.rowbox(10)
	head.custom_minimum_size = Vector2(0, 26)
	head.add_child(PaperUI.caps(str(data.get("name", "Cache")), Paper.S_TINY, Paper.INK, true))
	head.add_child(PaperUI.stretch())
	head.add_child(PaperUI.caps("%d lines · %s" % [items.size(), Paper.kg(total)], Paper.S_MICRO, Paper.ink(0.55)))
	col.add_child(head)
	col.add_child(PaperUI.Rule.new("solid", Paper.ink(0.30)))
	col.add_child(PaperUI.spacer(6))
	var bar := PaperUI.rowbox(8)
	bar.custom_minimum_size = Vector2(0, 30)
	bar.add_child(PaperUI.act("Take all", _take_all, { "disabled": items.is_empty() }))
	bar.add_child(PaperUI.label(_source_line(), Paper.S_TINY, Paper.ink(0.52)))
	col.add_child(bar)
	col.add_child(PaperUI.spacer(4))
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	if items.is_empty():
		v.add_child(PaperUI.empty("Nothing left."))
	for k in items.size():
		var e: Dictionary = items[k]
		var w := KitView.entry_weight(e)
		var n := int(e.get("count", 1))
		var tags: Array = [["× %d" % n, Paper.ink(0.55)]] if n > 1 else []
		var can := _can_carry(w)
		var b := PaperUI.select_row(_take.bind(k), false)
		b.set_meta("fkey", "cache:%d" % k)
		PaperUI.row_body(b, PaperUI.name_block(KitView.entry_name(e), KitView.entry_sub(e), tags),
			PaperUI.number(Paper.kg_num(w, 2 if w < 1.0 else 1), "kg"),
			[PaperUI.act("Take", _take.bind(k), { "deny": not can, "tooltip": "" if can else "Over the load limit" })])
		v.add_child(b)
		v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	return col

func _source_line() -> String:
	match str(data.get("kind", "")):
		"corpse": return "An explorer who did not get back. Tags, letters, a pack."
		"mimic": return "What it was carrying when it folded."
		"safe", "locker": return "Committee stores."
	return "Searched once. It does not refill until the Tide."

func _carried_column() -> Control:
	var i: Inventory = inv()
	var col := PaperUI.column(0)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var w := i.weight()
	var c := i.capacity()
	var head := PaperUI.rowbox(10)
	head.custom_minimum_size = Vector2(0, 26)
	head.add_child(PaperUI.caps("Carried", Paper.S_TINY, Paper.INK, true))
	head.add_child(PaperUI.stretch())
	head.add_child(PaperUI.number("%s / %s" % [String.num(w, 1), String.num(c, 0)], "kg", Paper.RED if w > c else Paper.INK))
	col.add_child(head)
	col.add_child(PaperUI.Rule.new("solid", Paper.ink(0.30)))
	col.add_child(PaperUI.spacer(6))
	col.add_child(PaperUI.Bar.new(minf(1.0, w / maxf(1.0, c)), Paper.RED if w > c else Paper.AMBER, 3.0, w > c * Inventory.SPRINT_LOAD))
	col.add_child(PaperUI.spacer(4))
	col.add_child(PaperUI.label("Hard limit %s. Over %s walking slows; over the limit nothing more is taken." % [Paper.kg(c * Inventory.SPRINT_LOAD, 0), Paper.kg(c, 0)], Paper.S_TINY, Paper.ink(0.52)))
	col.add_child(PaperUI.spacer(6))
	var sc := PaperUI.scroll()
	var v := PaperUI.column(0)
	sc.add_child(v)
	col.add_child(sc)
	var entries := KitView.entries(i)
	var any := false
	for e in entries:
		if KitView.category(e) == "mission": continue
		any = true
		var slot := KitView.slot_of_uid(i, int(e.get("uid", -1))) if e.has("uid") else ""
		var tags: Array = []
		if int(e.get("count", 1)) > 1: tags.append(["× %d" % int(e["count"]), Paper.ink(0.55)])
		if slot != "": tags.append([KitView.SLOT_LABEL.get(slot, slot), Paper.AMBER])
		var b := PaperUI.select_row(_put.bind(e), false)
		b.set_meta("fkey", "kit:" + KitView.key_of(e))
		PaperUI.row_body(b, PaperUI.name_block(KitView.entry_name(e), KitView.entry_sub(e), tags),
			PaperUI.number(Paper.kg_num(KitView.entry_weight(e), 2), "kg"),
			[PaperUI.act("Put", _put.bind(e))])
		v.add_child(b)
		v.add_child(PaperUI.Rule.new("dotted", Paper.ink(0.20)))
	if not any: v.add_child(PaperUI.empty("Nothing carried."))
	return col

# ------------------------------------------------------------------------------------------------------------------
func _can_carry(extra: float) -> bool:
	var i: Inventory = inv()
	return i.weight() + extra <= i.capacity() * Inventory.SPRINT_LOAD + 0.0001

func _take(index: int) -> void:
	var items := _items()
	if index < 0 or index >= items.size(): return
	var e: Dictionary = items[index]
	var w := KitView.entry_weight(e)
	if not _can_carry(w):
		var i: Inventory = inv()
		deny("Load limit. %s weighs %s; %s left." % [KitView.entry_name(e), Paper.kg(w), Paper.kg(maxf(0.0, i.capacity() * Inventory.SPRINT_LOAD - i.weight()))])
		return
	var n := int(e.get("count", 1))
	var name := KitView.entry_name(e)
	if not _grant(e, index):
		deny("It cannot be taken."); return
	notice("Taken: %s%s." % [name, (" × %d" % n) if n > 1 else ""])
	snd("pickup_ammo" if Data.ammo.has(str(e.get("id", ""))) else "pickup_item", 0.5)
	_changed()
	refresh()

func _take_all() -> void:
	var items := _items()
	if items.is_empty(): return
	var names: Array = []
	var stuck := false
	var guard := 0
	while not items.is_empty() and guard < 200:
		guard += 1
		var e: Dictionary = items[0]
		if not _can_carry(KitView.entry_weight(e)):
			stuck = true
			break
		var n := int(e.get("count", 1))
		var name := KitView.entry_name(e)
		if not _grant(e, 0): break
		names.append(name + ((" × %d" % n) if n > 1 else ""))
	if names.is_empty():
		deny("Load limit. Nothing more can be carried."); return
	notice("Taken: %s.%s" % [", ".join(names), " Left behind: over the load limit." if stuck else ""], stuck)
	snd("pickup_item", 0.5)
	_changed()
	refresh()

## Give one entry to the kit. Prefers the loot system (it owns piles and containers); falls back to the inventory
## directly so the form still works over a plain list.
func _grant(e: Dictionary, index: int) -> bool:
	var src: Variant = data.get("source")
	if src != null and is_instance_valid(src) and Game.loot != null and Game.loot.has_method("take"):
		return not Game.loot.take(src, index).is_empty()
	var i: Inventory = inv()
	var items := _items()
	match str(e.get("kind", "")):
		"weapon":
			if not (e.get("inst") is Dictionary): return false
			i.add_weapon(e["inst"])
		"mag":
			if not (e.get("inst") is Dictionary): return false
			i.add_mag(e["inst"])
		"gear":
			if not (e.get("inst") is Dictionary): return false
			i.add_gear(e["inst"])
		_:
			var id := str(e.get("id", ""))
			if Data.def(id).is_empty(): return false
			if e.get("inst") is Dictionary: i.add_gear(e["inst"])
			else: i.add(id, int(e.get("count", 1)))
			if str(Data.def(id).get("kind", "")) == "artifact": Events.artifact_picked.emit(id)
	if index >= 0 and index < items.size(): items.remove_at(index)
	return true

func _put(e: Dictionary) -> void:
	var src: Variant = data.get("source")
	var name := KitView.entry_name(e)
	if src != null and is_instance_valid(src) and Game.loot != null and Game.loot.has_method("put"):
		if not Game.loot.put(src, e, 1 if not Data.ammo.has(str(e.get("id", ""))) else int(e.get("count", 1))):
			deny("It stays where it is."); return
	else:
		var i: Inventory = inv()
		var items := _items()
		match str(e.get("kind", "")):
			"weapon":
				var w: Variant = i.remove_weapon(int(e.get("uid", -1)))
				if w == null: return
				items.append({ "kind": "weapon", "id": str(w["id"]), "count": 1, "inst": w })
			"mag":
				var m: Variant = i.remove_mag(int(e.get("uid", -1)))
				if m == null: return
				items.append({ "kind": "mag", "id": str(m["id"]), "count": 1, "inst": m })
			_:
				if e.has("uid"):
					var g: Variant = i.remove_gear(int(e["uid"]))
					if g == null: return
					items.append({ "kind": "gear", "id": str(g["id"]), "count": 1, "inst": g })
				else:
					var id := str(e.get("id", ""))
					var n := int(e.get("count", 1)) if Data.ammo.has(id) else 1
					if not i.remove(id, n): return
					var merged := false
					for x in items:
						if str(x.get("kind", "")) == "item" and str(x.get("id", "")) == id:
							x["count"] = int(x.get("count", 1)) + n; merged = true; break
					if not merged: items.append({ "kind": "item", "id": id, "count": n })
	notice("%s left in the %s." % [name, Paper.lower_first(str(data.get("name", "cache")))])
	snd("pickup_item", 0.4)
	_changed()
	refresh()

func _changed() -> void:
	if Game.player == null or not is_instance_valid(Game.player): return
	var w: Variant = Game.player.get("weapons")
	if w != null and is_instance_valid(w) and w.has_method("on_inventory_changed"): w.on_inventory_changed()
